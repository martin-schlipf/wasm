// One worker of a job: loads the emscripten loader with importScripts,
// instantiates the module the page compiled and posted, hands its shared memory
// to the page, gets the memories of all other workers back, and then runs the
// checks. Classic worker on purpose: that is how emscripten's MODULARIZE
// loaders are loaded into workers.
//
// Messages from the page:  {type: 'start', ...}  {type: 'mems', mems}
// Messages to the page:    {type: 'mem', mem}  {type: 'done', checks, bench}
//                          {type: 'log', line}
'use strict';

// Slots of the control array (Int32Array over a SharedArrayBuffer).
const ARRIVED = 0, MAILBOX = 8; // MAILBOX + rank: address of that worker's mailbox
const BOX = 1 << 20;                        // bytes one worker writes into the next

let start, gotMems;
const memsArrived = new Promise((resolve) => { gotMems = resolve; });

self.onmessage = ({ data: m }) => {
  if (m.type === 'start') { start = m; run(m).catch(fatal); }
  else if (m.type === 'mems') gotMems(m.mems);
};

function fatal(e) {
  postMessage({ type: 'done', checks: [{ name: 'Worker ' + (start ? start.rank : '?'),
    status: 'fail', detail: describe(e) }], bench: null });
}

function log(line) { postMessage({ type: 'log', line }); }

// An error as text. An exception thrown by wasm code and not caught there is
// a WebAssembly.Exception, which has no message of its own.
function describe(e) {
  if (typeof WebAssembly.Exception === 'function' && e instanceof WebAssembly.Exception)
    return 'uncaught WebAssembly exception' + (e.stack ? `: ${e.stack.split('\n').slice(0, 3).join(' | ')}` : '');
  return e && e.message ? `${e.name}: ${e.message}` : String(e);
}

async function run(o) {
  const checks = [];
  const add = (name, ok, detail = '', bad = 'fail') =>
    checks.push({ name, status: ok ? 'pass' : bad, detail });
  const ctl = new Int32Array(o.ctl);

  importScripts(o.script);
  const factory = self[o.exportName];
  let memory;
  const Module = await factory({
    print: log, printErr: log,
    locateFile: (p) => new URL(p, o.script).href,
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(o.module, imports).then(async (instance) => {
        memory = imports.env && imports.env.memory || instance.exports.memory;
        postMessage({ type: 'mem', mem: memory });
        o.mems = await memsArrived;
        receive(instance, o.module);
      }, fatal);
      return {};
    },
  });
  add('Shared memory of the module', memory instanceof WebAssembly.Memory
      && memory.buffer instanceof SharedArrayBuffer,
      memory ? `${memory.buffer.byteLength >> 20} MiB initially` : 'no memory');

  // Every worker waits (Atomics.wait, which only workers may do) until all
  // have arrived: a barrier on a SharedArrayBuffer the page made.
  const barrier = (round) => {
    Atomics.add(ctl, ARRIVED, 1);
    Atomics.notify(ctl, ARRIVED);
    const deadline = Date.now() + 20000;
    let v;
    while ((v = Atomics.load(ctl, ARRIVED)) < round * o.size) {
      if (Date.now() > deadline) throw new Error('barrier timed out');
      Atomics.wait(ctl, ARRIVED, v, 100);
    }
  };

  // Ring exchange: every worker writes 1 MiB straight into the memory of the
  // next one, then the next one checks it from inside its own module.
  const box = Module._mailbox(BOX);
  Atomics.store(ctl, MAILBOX + o.rank, box);
  barrier(1);
  {
    const next = (o.rank + 1) % o.size;
    const dst = new Uint8Array(o.mems[next].buffer, Atomics.load(ctl, MAILBOX + next), BOX);
    for (let i = 0; i < BOX; i++) dst[i] = (i * 7 + o.rank) & 255;
  }
  barrier(2);
  {
    const prev = (o.rank + o.size - 1) % o.size;
    const ref = new Uint8Array(BOX);
    for (let i = 0; i < BOX; i++) ref[i] = (i * 7 + prev) & 255;
    let s = 0;
    for (let i = 0; i < BOX; i++) s = (Math.imul(s, 31) + ref[i]) >>> 0;
    add('Write into another worker\'s memory', (Module._checksum(box, BOX) >>> 0) === s,
        `${o.size} workers in a ring, 1 MiB each`);
  }

  // A synchronous request, as code that cannot wait asynchronously needs.
  // Browsers allow it only in workers.
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', new URL('data.json', o.script).href, false);
    xhr.send();
    const ok = xhr.status === 200 && JSON.parse(xhr.responseText).payload.length > 0;
    add('Synchronous request in a worker', ok, `HTTP ${xhr.status}`);
    // Into the in-memory file system, and read back by C stdio.
    const bytes = new TextEncoder().encode(xhr.responseText);
    Module.FS.writeFile('/input.json', bytes);
    let s = 0;
    for (const b of bytes) s = (Math.imul(s, 31) + b) >>> 0;
    const path = Module.stringToNewUTF8 ? Module.stringToNewUTF8('/input.json') : null;
    if (path) add('File system, read by the module', Module._read_file(path) === (s & 0x7fffffff));
  } catch (e) {
    add('Synchronous request in a worker', false, String(e.message || e));
  }

  // Each check on its own: one that throws must not hide the others.
  const check = (name, fn, detail = '', bad = 'fail') => {
    try {
      const r = fn();
      add(name, r === true || (typeof r === 'object' && r.ok), typeof r === 'object' ? r.detail : detail, bad);
    } catch (e) { add(name, false, describe(e), bad); }
  };
  const n = 1001;
  let ref = 0;
  for (let i = 0; i < n; i++) ref += (i % 5) * 0.25 + (n % 2 && i === n - 1 ? 0 : 2 * (i % 7) * 0.5);
  check('SIMD arithmetic', () => {
    const got = Module._axpy(n);
    return { ok: Math.abs(got - ref) < 1e-9 * Math.abs(ref), detail: `${got} (expected ${ref})` };
  });
  // A warning only: whether a C++ exception is caught depends on the C++
  // runtime the toolchain links, not on the browser. The browser's part, wasm
  // exception handling, is what setjmp/longjmp below exercises.
  check('C++ exception, thrown and caught', () => Module._cxx_exception() === 1,
        '', 'warn');
  check('setjmp/longjmp', () => Module._long_jump() === 1);
  check('Atomics inside the module', () => Module._atomic_add(1000) >= 1000);
  check('memory.atomic.wait32 in a worker', () => Module._atomic_wait_timeout() === 2,
        'returns 2 = timed out');

  barrier(3);
  if (o.rank === 0 && o.growMB > 0) {
    const before = memory.buffer.byteLength;
    let ok = false, detail;
    try {
      ok = Module._grow(o.growMB) === 1;
      detail = `${before >> 20} → ${memory.buffer.byteLength >> 20} MiB`;
    } catch (e) { detail = String(e.message || e); }
    add(`Grow the shared memory by ${o.growMB} MiB`, ok, detail || 'allocation failed');
  }

  let bench = null;
  if (o.rank === 0) {
    Module._matmul(64, 2); // warm up
    const t0 = performance.now();
    const flops = Module._matmul(128, 20);
    const dt = (performance.now() - t0) / 1000;
    bench = { gflops: flops / dt / 1e9, relaxed: Module._relaxed_build() === 1 };
  }
  postMessage({ type: 'done', checks, bench });
}
