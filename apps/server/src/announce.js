// Tells screens on the home network where this server is, so a new frame finds it without anyone
// typing an address. It's announced as _noor-frame._tcp (DNS-SD over multicast DNS, also known as
// Bonjour or Avahi) with the system's own tool, so nothing extra is installed:
//   macOS: dns-sd (built in) · Linux: avahi-publish (avahi-utils) · Windows: dns-sd (Bonjour)
// A Raspberry Pi set up with apps/kiosk-pi/install.sh already announces it through Avahi.
// NOOR_ANNOUNCE=0 turns it off.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

export const SERVICE = '_noor-frame._tcp';
const AVAHI_FILE = '/etc/avahi/services/noor-frame.service';

// The command that announces this server, or null when there's no way to (or no need).
export function announcement({ platform = process.platform, port, host = hostname(), has = onPath, exists = fs.existsSync } = {}) {
  const name = 'noor-frame on ' + String(host).replace(/\.local\.?$/i, '');
  if (platform === 'darwin' || platform === 'win32') {
    return has('dns-sd') ? { cmd: 'dns-sd', args: ['-R', name, SERVICE, 'local', String(port)] } : null;
  }
  if (exists(AVAHI_FILE)) return null;
  return has('avahi-publish') ? { cmd: 'avahi-publish', args: ['-s', name, SERVICE, String(port)] } : null;
}

function onPath(cmd) {
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  return String(process.env.PATH || '').split(path.delimiter).some((dir) => exts.some((e) => dir && fs.existsSync(path.join(dir, cmd + e))));
}

// Starts announcing and keeps it going while the server runs.
export function announce({ port, log = console, env = process.env } = {}) {
  if (env.NOOR_ANNOUNCE === '0') return null;
  const how = announcement({ port });
  if (!how) {
    log.log?.('Not announcing on the network (no dns-sd or avahi-publish). Screens can still be given the address.');
    return null;
  }
  const child = spawn(how.cmd, how.args, { stdio: 'ignore' });
  child.on('error', (err) => log.warn?.(`Couldn't announce on the network: ${err.message}`));
  child.on('exit', (code, signal) => { if (!stopping && code) log.warn?.(`Network announcement stopped (${how.cmd} exited ${code ?? signal}).`); });
  let stopping = false;
  const stop = () => { stopping = true; child.kill(); };
  process.once('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { stop(); process.exit(0); });
  return { stop, name: how.args[1] };
}
