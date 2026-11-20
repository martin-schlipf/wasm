// Opens a URL in Safari on macOS through safaridriver (WebDriver) and keeps it
// open until this process is ended. Needs `sudo safaridriver --enable` once.
//
//   node tools/safari.mjs <url>
// Used as the command of tools/run.mjs.
import { spawn } from 'node:child_process';

const url = process.argv[2];
const port = 4444 + Math.floor(Math.random() * 1000);
const driver = spawn('safaridriver', ['-p', String(port)], { stdio: 'inherit' });
const base = `http://127.0.0.1:${port}`;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json.value;
}

let session = null;
async function quit() {
  if (session) await call('DELETE', `/session/${session}`).catch(() => {});
  driver.kill();
  process.exit(0);
}
process.on('SIGTERM', quit);
process.on('SIGINT', quit);

// safaridriver takes a moment to listen.
for (let i = 0; ; i++) {
  try { await call('GET', '/status'); break; } catch (e) {
    if (i === 50) { console.error(`safari.mjs: safaridriver does not answer: ${e.message}`); driver.kill(); process.exit(1); }
    await new Promise((r) => setTimeout(r, 200));
  }
}
const s = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
session = s.sessionId;
console.log(`safari.mjs: Safari ${s.capabilities && s.capabilities.browserVersion}`);
await call('POST', `/session/${session}/url`, { url });
// Stay until tools/run.mjs ends us.
setInterval(() => {}, 1 << 30);
