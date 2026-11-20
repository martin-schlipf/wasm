// The page: runs every check, shows the result, and with ?report=<path> also
// POSTs it as JSON to that path of the same server (tools/serve.mjs), which is
// how CI collects results from browsers it cannot script.
//
// URL parameters:
//   workers=<n>   workers in the job (default 4)
//   grow=<MiB>    how much the first worker grows its memory by (default 512)
//   report=<path> where to POST the result
import { PROBES } from './probes.js';

const params = new URLSearchParams(location.search);
const WORKERS = Math.max(1, parseInt(params.get('workers') || '4', 10));
const GROW_MB = Math.max(0, parseInt(params.get('grow') || '512', 10));
const REPORT = params.get('report');

// The two builds of the test module, preferred first.
const BUILDS = [
  { name: 'relaxed', label: 'build with relaxed SIMD', script: 'module-relaxed.js' },
  { name: 'simd', label: 'build with SIMD128 only', script: 'module-simd.js' },
];
// What a build needs beyond what every build needs.
const NEEDS = { relaxed: ['relaxed-simd'], simd: [] };
// Probes every build needs; the others are for information only.
const REQUIRED = ['simd128', 'threads', 'bulk-memory', 'exceptions-legacy', 'sign-ext'];

const result = {
  userAgent: navigator.userAgent,
  platform: navigator.userAgentData ? navigator.userAgentData.platform : navigator.platform,
  hardwareConcurrency: navigator.hardwareConcurrency || null,
  deviceMemory: navigator.deviceMemory || null,
  workers: WORKERS, growMB: GROW_MB,
  started: new Date().toISOString(),
  groups: [], builds: {}, verdict: null,
};

function group(title) {
  const g = { title, checks: [] };
  result.groups.push(g);
  return g;
}
function add(g, name, status, detail = '') {
  g.checks.push({ name, status, detail: String(detail) });
  render();
}

function render() {
  const root = document.getElementById('groups');
  root.textContent = '';
  for (const g of result.groups) {
    const h = document.createElement('h2');
    h.textContent = g.title;
    const t = document.createElement('table');
    for (const c of g.checks) {
      const tr = t.insertRow();
      const s = tr.insertCell(); s.className = 's ' + c.status; s.textContent = c.status;
      const n = tr.insertCell(); n.className = 'n'; n.textContent = c.name;
      const d = tr.insertCell(); d.className = 'd'; d.textContent = c.detail;
    }
    root.append(h, t);
  }
  document.getElementById('raw').textContent = JSON.stringify(result, null, 2);
}

function setVerdict(status, text) {
  result.verdict = { status, text };
  const v = document.getElementById('verdict');
  v.className = status;
  v.querySelector('strong').textContent = text;
}

const errorText = (e) => (e && e.message) ? `${e.name}: ${e.message}` : String(e);

function fromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function environment() {
  const g = group('Environment');
  add(g, 'WebAssembly', typeof WebAssembly === 'object' ? 'pass' : 'fail');
  add(g, 'Secure context', window.isSecureContext ? 'pass' : 'fail',
      window.isSecureContext ? '' : 'serve the page over https or from localhost');
  add(g, 'Cross-origin isolated', window.crossOriginIsolated ? 'pass' : 'fail',
      window.crossOriginIsolated ? '' : 'the server must send COOP/COEP headers; without them there is no shared memory');
  add(g, 'SharedArrayBuffer', typeof SharedArrayBuffer === 'function' ? 'pass' : 'fail');
  add(g, 'Web Workers', typeof Worker === 'function' ? 'pass' : 'fail');
  add(g, 'Logical processors', 'info', navigator.hardwareConcurrency || 'unknown');
  if (navigator.deviceMemory) add(g, 'Device memory', 'info', `${navigator.deviceMemory} GB (rounded by the browser)`);
}

const probeResult = {};
function probes() {
  const g = group('WebAssembly features');
  for (const p of PROBES) {
    let ok = false, detail = '';
    try {
      ok = WebAssembly.validate(fromBase64(p.wasm));
      // validate() says nothing about why; compiling does.
      if (!ok) try { new WebAssembly.Module(fromBase64(p.wasm)); } catch (e) { detail = errorText(e); }
    } catch (e) { detail = errorText(e); }
    probeResult[p.name] = ok;
    const required = REQUIRED.includes(p.name);
    add(g, p.title, ok ? 'pass' : (required ? 'fail' : (p.name === 'relaxed-simd' ? 'warn' : 'info')),
        detail || (required ? '' : (p.name === 'relaxed-simd' ? 'needed by the faster build' : 'not needed')));
  }
}

function memory() {
  const g = group('Memory');
  // What a module declares: 256 MiB to start with, up to 4 GiB, shared, one
  // per worker. Some browsers reserve the maximum up front, and refuse when
  // the reservations do not fit. If this fails, find what does fit: the same
  // memories with a smaller maximum, largest first (a failed attempt holds
  // nothing, a successful one holds its memories until they are collected),
  // and one that starts smaller.
  const attempt = (initialMiB, maximumMiB) => {
    const mems = [];
    let error = null;
    try {
      for (let i = 0; i < WORKERS; i++)
        mems.push(new WebAssembly.Memory({ initial: initialMiB * 16, maximum: maximumMiB * 16, shared: true }));
    } catch (e) { error = e; }
    return { created: mems.length, error };
  };
  const label = (init, max) => `${WORKERS} × shared memory, ${init} MiB, maximum ${max >= 1024 ? max / 1024 + ' GiB' : max + ' MiB'}`;
  const detail = (r) => `${r.created} of ${WORKERS} created` + (r.error ? `, then ${errorText(r.error)}` : '');
  const full = attempt(256, 4096);
  add(g, label(256, 4096), full.error ? 'fail' : 'pass', full.error ? detail(full) : '');
  if (!full.error) return;
  const small = attempt(16, 4096);
  add(g, label(16, 4096), 'info', detail(small));
  for (const max of [2048, 1024, 512]) {
    const r = attempt(256, max);
    add(g, label(256, max), 'info', detail(r));
    if (!r.error) break;
  }
}

async function compileBuild(b) {
  const url = new URL(b.script.replace(/\.js$/, '.wasm'), location.href).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const type = res.headers.get('Content-Type') || '';
  if (type.startsWith('application/wasm') && WebAssembly.compileStreaming)
    return { module: await WebAssembly.compileStreaming(res), streaming: true };
  return { module: await WebAssembly.compile(await res.arrayBuffer()), streaming: false };
}

function runJob(b, module) {
  const ctl = new SharedArrayBuffer(4 * (8 + WORKERS));
  const script = new URL(b.script, location.href).href;
  return new Promise((resolve) => {
    const workers = [], mems = [], checks = [];
    let posted = 0, done = 0, bench = null, ended = false;
    const end = (extra) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      for (const w of workers) w.terminate();
      if (extra) checks.push(extra);
      resolve({ checks, bench });
    };
    const timer = setTimeout(() => end({ name: 'Job finished in time', status: 'fail',
      detail: `${posted} of ${WORKERS} workers started, ${done} finished within 120 s` }), 120000);
    for (let r = 0; r < WORKERS; r++) {
      const w = new Worker('worker.js');
      w.onmessage = ({ data: m }) => {
        if (m.type === 'mem') {
          mems[r] = m.mem;
          if (++posted === WORKERS) for (const x of workers) x.postMessage({ type: 'mems', mems });
        } else if (m.type === 'done') {
          for (const c of m.checks) {
            // Report each check once, with the worst status any worker saw.
            const have = checks.find((x) => x.name === c.name);
            if (!have) checks.push({ ...c });
            else if (c.status === 'fail' && have.status !== 'fail') Object.assign(have, c);
          }
          if (m.bench) bench = m.bench;
          if (++done === WORKERS) end();
        } else if (m.type === 'log') console.log(`[${b.name} ${r}] ${m.line}`);
      };
      w.onerror = (e) => { e.preventDefault(); end({ name: `Worker ${r}`, status: 'fail', detail: e.message || 'error' }); };
      workers.push(w);
      w.postMessage({ type: 'start', rank: r, size: WORKERS, ctl, module, script,
                      exportName: 'createModule', growMB: GROW_MB });
    }
  });
}

async function builds() {
  for (const b of BUILDS) {
    const g = group(`Test application, ${b.label}`);
    const r = result.builds[b.name] = { compiled: false, ran: false, gflops: null };
    let compiled;
    try {
      compiled = await compileBuild(b);
      r.compiled = true;
      add(g, 'Compile', 'pass', compiled.streaming ? 'streaming' : 'from a buffer (server sent no application/wasm)');
    } catch (e) {
      add(g, 'Compile', 'fail', errorText(e));
      continue;
    }
    if (!window.crossOriginIsolated) { add(g, 'Run', 'fail', 'needs cross-origin isolation'); continue; }
    const { checks, bench } = await runJob(b, compiled.module);
    for (const c of checks) add(g, c.name, c.status, c.detail);
    r.ran = checks.length > 0 && checks.every((c) => c.status !== 'fail');
    if (bench) {
      r.gflops = bench.gflops;
      add(g, 'Matrix product, one worker', 'info', `${bench.gflops.toFixed(2)} GFLOP/s`);
    }
  }
}

function verdict() {
  const ok = (n) => result.builds[n] && result.builds[n].ran;
  if (ok('relaxed')) setVerdict('pass', 'This browser can run the application.');
  else if (ok('simd')) setVerdict('warn', 'This browser can run the application only from a build without relaxed SIMD.');
  else setVerdict('fail', 'This browser cannot run the application.');
  const rel = result.builds.relaxed, simd = result.builds.simd;
  if (rel && simd && rel.gflops && simd.gflops)
    result.relaxedSpeedup = rel.gflops / simd.gflops;
}

async function report() {
  if (!REPORT) return;
  try {
    await fetch(REPORT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(result) });
  } catch (e) { console.error('report failed', e); }
}

async function main() {
  document.getElementById('browser').textContent = navigator.userAgent;
  document.getElementById('copy').onclick = () =>
    navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  if (window.coiPending) { setVerdict('', 'Enabling cross-origin isolation, the page reloads…'); return; }
  try {
    environment();
    probes();
    await builds();
    memory(); // last: what it allocates must not take memory from the jobs
    verdict();
  } catch (e) {
    result.error = errorText(e);
    setVerdict('fail', `The check itself failed: ${result.error}`);
  }
  result.finished = new Date().toISOString();
  render();
  window.checkResult = result;
  await report();
}

main();
