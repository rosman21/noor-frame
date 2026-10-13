// `npm run dev`: the API server (restarts on changes) and the dashboard with hot reload.
//   API      http://localhost:8787
//   frame    http://localhost:5174   (open this one; /api is proxied to the server)
//   phone    http://localhost:5174/companion/   (via the frame's dev server; QR codes point here)
// PORT / API_PORT change the server port.
import { spawn } from 'node:child_process';

const port = process.env.PORT || process.env.API_PORT || '8787';
const env = { ...process.env, PORT: port, API_PORT: port };
const run = (args) => spawn('npm', args, { stdio: 'inherit', env });
const children = ['@noor-frame/server', '@noor-frame/frame', '@noor-frame/companion'].map((w) => run(['run', 'dev', '-w', w]));
const stop = () => { for (const c of children) c.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => { if (code) stop(); });
