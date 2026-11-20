// Runs the page in one browser and writes its result. Starts the server, runs
// the command with {url} replaced by the page's address, waits for the page to
// report, and ends the command. Any way of opening a URL works: a headless
// browser, a WebDriver client (tools/safari.mjs), Playwright
// (tools/playwright.mjs), or `xcrun simctl openurl` for an iOS simulator.
//
//   node tools/run.mjs --name <label> --out <file.json> [--root build/site]
//        [--timeout 600] [--query workers=4] -- <command> [args with {url}]
//
// Exits 0 when the page reported, whatever it found: a browser that cannot run
// the application is a result, not an error. Exits 1 when no report came, and
// then writes a result that says so.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { startServer } from './serve.mjs';

const opt = { name: null, out: null, root: 'build/site', timeout: '600', query: '' };
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 0 || sep === argv.length - 1) {
  console.error('usage: run.mjs --name <label> --out <file> [options] -- <command> {url}');
  process.exit(2);
}
for (let i = 0; i < sep; i += 2) {
  const k = argv[i].replace(/^--/, '');
  if (!(k in opt)) { console.error(`run.mjs: unknown option ${argv[i]}`); process.exit(2); }
  opt[k] = argv[i + 1];
}
if (!opt.name || !opt.out) { console.error('run.mjs: --name and --out are required'); process.exit(2); }

let finish;
const reported = new Promise((resolve) => { finish = resolve; });
const server = await startServer({ root: opt.root, onReport: finish });
const query = ['report=/report', opt.query].filter(Boolean).join('&');
const url = `http://127.0.0.1:${server.address().port}/?${query}`;
const [cmd, ...args] = argv.slice(sep + 1).map((a) => a.replaceAll('{url}', url));
console.log(`run: ${opt.name}: ${cmd} ${args.join(' ')}`);

const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
let childError = null;
child.on('error', (e) => { childError = e; });
child.on('exit', (code, signal) => {
  // Some commands only hand the URL over and exit (simctl openurl, open -a);
  // that is fine. A command that fails before the page reports is not.
  if (code) childError = childError || new Error(`${cmd} exited with ${code}`);
});

const timeout = new Promise((resolve) => setTimeout(() => resolve(null), Number(opt.timeout) * 1000));
const failed = new Promise((resolve) => {
  const tick = setInterval(() => { if (childError) { clearInterval(tick); resolve(null); } }, 500);
});
let result = await Promise.race([reported, timeout, failed]);

if (child.exitCode === null) child.kill();
server.close();
mkdirSync(dirname(opt.out) || '.', { recursive: true });
const ok = !!result;
if (!result) {
  const why = childError ? String(childError.message) : `no report within ${opt.timeout} s`;
  console.error(`run: ${opt.name}: ${why}`);
  result = { verdict: { status: 'error', text: `No result: ${why}` }, groups: [], builds: {} };
}
result.name = opt.name;
result.runner = process.env.RUNNER_OS ? `${process.env.RUNNER_OS} ${process.env.ImageOS || ''}`.trim() : null;
writeFileSync(opt.out, JSON.stringify(result, null, 2) + '\n');
console.log(`run: ${opt.name}: ${result.verdict.text}`);
process.exit(ok ? 0 : 1);
