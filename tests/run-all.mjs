// Runs every JavaScript test suite, even after one fails, and prints a summary.
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  ['geometry.test.mjs', 'constraint maths'],
  ['data.test.mjs', 'generated data bundles'],
  ['ui.test.mjs', 'app behaviour'],
  ['features.test.mjs', 'every layer, control and question card'],
  ['share.test.mjs', 'two phones sharing a map']
];

const results = suites.map(([file, about]) => {
  console.log(`\n████ ${file} — ${about}`);
  const run = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' });
  return { file, ok: run.status === 0 };
});

console.log('\n════ summary');
for (const { file, ok } of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${file}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
