// The parts of the home server that read raw requests: where a request comes from, and which
// built file a path names. Kept apart from node.js (which starts the server) so tests can call them.

import path from 'node:path';

const FORWARDING = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for', 'forwarded'];

// Where a request really comes from, for approving screens on the home network automatically.
// A request from this computer that carries forwarding headers came through a tunnel or reverse
// proxy (cloudflared, nginx…), and those headers are written by whoever sent it. So by default
// such a request counts as coming from outside and is never approved automatically. Tell the
// server which proxy you run, and only the header that proxy sets is believed:
//   NOOR_TRUST_PROXY=cloudflare   Cloudflare Tunnel: cf-connecting-ip
//   NOOR_TRUST_PROXY=1            any other proxy: the last X-Forwarded-For entry (the one it added)
// NOOR_AUTO_APPROVE=0 turns automatic approval off altogether ('' is never a home address).
export function callerAddress({ socket, headers }, env = process.env) {
  if (env.NOOR_AUTO_APPROVE === '0') return '';
  const from = String(socket || '').replace(/^::ffff:/, '');
  const loopback = from === '::1' || from.startsWith('127.');
  if (!loopback || !FORWARDING.some((h) => headers[h] != null)) return from;
  const trust = env.NOOR_TRUST_PROXY;
  if (trust === 'cloudflare') return one(headers['cf-connecting-ip']);
  if (trust === '1') return one(String(headers['x-forwarded-for'] || '').split(',').pop());
  return '';
}
function one(value) { return String(value || '').trim(); }

// The built file a request path names, or null when the path is malformed (`/%`) or reaches
// outside the dashboard folder.
export function staticPath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  const rel = path.relative(root, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : file;
}
