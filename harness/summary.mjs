// node harness/summary.mjs -> results/summary.json + a table on stdout
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const runs = readdirSync('results')
  .filter((f) => /^runs-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(`results/${f}`, 'utf8')));

const label = (r) => (r.mask ? `${r.version} mask ${r.mask}` : r.version);
const cells = new Map();
for (const r of runs) {
  const version = label(r);
  const key = `${version}|${r.page}|${r.flag}`;
  const c = cells.get(key) ?? { version, page: r.page, flag: r.flag, runs: 0, passed: 0, exit0: 0, baselineOverwritten: 0, nextStableFailed: 0, maxChangedPixels: 0, errors: {} };
  c.runs++;
  if (r.status === 'passed') c.passed++;
  if (r.exit === 0) c.exit0++;
  if (r.changedPixels > 0) c.baselineOverwritten++;
  if (r.nextStableRun === 'failed') c.nextStableFailed++;
  c.maxChangedPixels = Math.max(c.maxChangedPixels, r.changedPixels ?? 0);
  if (r.error) c.errors[r.error] = (c.errors[r.error] ?? 0) + 1;
  cells.set(key, c);
}

const summary = [...cells.values()];
const silent = {};
for (const r of runs) if (r.status === 'passed' && r.changedPixels > 0) silent[label(r)] = (silent[label(r)] ?? 0) + 1;
writeFileSync('results/summary.json', JSON.stringify({ totalRuns: runs.length, silentOverwritesByVersion: silent, cells: summary }, null, 2));

console.log(`runs: ${runs.length}`);
console.log('version                    page           flag     passed  overwritten  next-stable-failed  error');
for (const c of summary) {
  console.log(
    [c.version.padEnd(26), c.page.padEnd(14), c.flag.padEnd(8), `${c.passed}/${c.runs}`.padEnd(7), `${c.baselineOverwritten}/${c.runs}`.padEnd(12), `${c.nextStableFailed}/${c.runs}`.padEnd(19), Object.keys(c.errors).join('; ')].join(' '),
  );
}
console.log('silent overwrites (passed + baseline pixels changed):', JSON.stringify(silent));
