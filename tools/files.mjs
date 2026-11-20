// The file operations of the Makefile, in node, so that make works without a
// Unix shell (on Windows, make runs commands directly, and there is no cp).
//
//   node tools/files.mjs cp <file>... <dir>
//   node tools/files.mjs mkdir <dir>
//   node tools/files.mjs rm <path>
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

const [op, ...args] = process.argv.slice(2);
if (op === 'cp') {
  const dir = args.pop();
  for (const f of args) copyFileSync(f, join(dir, basename(f)));
} else if (op === 'mkdir') {
  for (const d of args) mkdirSync(d, { recursive: true });
} else if (op === 'rm') {
  for (const p of args) rmSync(p, { recursive: true, force: true });
} else {
  console.error(`files.mjs: unknown operation ${op}`);
  process.exit(2);
}
