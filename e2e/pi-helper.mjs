// Starts the Raspberry Pi kiosk helper (apps/kiosk-pi/helper) for the browser tests, pointed at
// the test server, with its settings in a fresh temporary folder.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noor-pi-'));
fs.writeFileSync(path.join(dir, 'kiosk.json'), JSON.stringify({ server: 'http://127.0.0.1:8790', autoHotspot: false }));
const helper = spawn('python3', ['apps/kiosk-pi/helper/noor_kiosk.py'], {
  stdio: 'inherit',
  env: {
    ...process.env, NOOR_KIOSK_CONFIG: path.join(dir, 'kiosk.json'), NOOR_KIOSK_STATE: path.join(dir, 'state.json'),
    NOOR_KIOSK_PORT: '8798', NOOR_SETUP_PORT: '8797',
  },
});
const stop = () => { helper.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
helper.on('exit', (code) => process.exit(code ?? 0));
