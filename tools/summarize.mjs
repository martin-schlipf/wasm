// Prints the results of a CI run (the JSON files tools/run.mjs wrote) as one
// Markdown table: a row per browser, a column per check that failed anywhere.
//
//   node tools/summarize.mjs <results-dir>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'results';
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.json')) files.push(p);
  }
})(dir);

const results = files.map((f) => JSON.parse(readFileSync(f, 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name));
const mark = { pass: '✅', warn: '⚠️', fail: '❌', error: '💥' };

// Only the checks that did not pass somewhere are worth a column.
const failing = new Set();
for (const r of results)
  for (const g of r.groups)
    for (const c of g.checks)
      if (c.status === 'fail' || c.status === 'warn') failing.add(`${g.title}: ${c.name}`);

const browser = (ua = '') => {
  const m = ua.match(/(Edg|Firefox|Chrome|Version)\/([\d.]+)/g);
  return m ? m.filter((x) => !x.startsWith('Chrome') || !/Edg\//.test(ua)).slice(-1)[0] : '';
};

const lines = [];
lines.push('| Browser | Version | Verdict | relaxed SIMD speed-up |');
lines.push('|---|---|---|---|');
for (const r of results) {
  const v = r.verdict || { status: 'error', text: 'no verdict' };
  const speed = r.relaxedSpeedup ? `${r.relaxedSpeedup.toFixed(2)}×` : '';
  lines.push(`| ${r.name} | ${browser(r.userAgent)} | ${mark[v.status] || ''} ${v.text} | ${speed} |`);
}
if (failing.size) {
  lines.push('', '### Checks that did not pass', '');
  for (const r of results) {
    const bad = [];
    for (const g of r.groups)
      for (const c of g.checks)
        if (c.status === 'fail' || c.status === 'warn')
          bad.push(`- ${mark[c.status]} ${g.title}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    if (bad.length) lines.push(`**${r.name}**`, '', ...bad, '');
  }
}
console.log(lines.join('\n'));
