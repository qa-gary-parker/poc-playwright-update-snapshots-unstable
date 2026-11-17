// node harness/run.mjs --version 1.65.1 [--reps 10] [--pages a,b] [--flags a,b] [--mask '.track,#clock']
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const exec = promisify(execFile);
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VERSION = arg('version');
if (!VERSION) throw new Error('--version is required');
const REPS = Number(arg('reps', 10));
const PAGES = arg('pages', 'stable,css-animation,js-animation,live-clock').split(',');
const FLAGS = arg('flags', 'none,missing,changed,all').split(',');
const MASK = arg('mask', '');
const ROOT = resolve('.');
const DIR = join(ROOT, 'work', VERSION);
const SNAP = join(DIR, 'snapshots', 'card.png');
const ORIG = join(DIR, 'baseline.orig.png');
// Before 1.50 the flag took no value: -u meant "all" and no flag meant "missing".
const LEGACY = Number(VERSION.split('.')[1]) < 50;
const flagArgs = (flag) => (!LEGACY ? [`--update-snapshots=${flag}`] : flag === 'all' ? ['-u'] : flag === 'missing' ? [] : null);

async function setup() {
  if (existsSync(join(DIR, 'node_modules', '@playwright', 'test'))) return;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'package.json'), JSON.stringify({ private: true, devDependencies: { '@playwright/test': VERSION } }, null, 2));
    await exec('npm', ['install', '--silent', '--no-audit', '--no-fund'], { cwd: DIR });
  await exec('npx', ['playwright', 'install', 'chromium'], { cwd: DIR });
}

async function pw(page, flag) {
  const args = flagArgs(flag);
  if (!args) throw new Error(`--update-snapshots=${flag} does not exist in ${VERSION}`);
  rmSync(join(DIR, 'report.json'), { force: true });
  const t0 = Date.now();
  let code = 0;
  try {
    await exec('npx', ['playwright', 'test', ...args], {
      cwd: DIR,
      env: { ...process.env, CI: '', MASK, PAGE_FILE: join(ROOT, 'pages', `${page}.html`) },
    });
  } catch (e) {
    code = e.code ?? 1;
  }
  const report = JSON.parse(readFileSync(join(DIR, 'report.json'), 'utf8'));
  const result = report.suites[0]?.specs[0]?.tests[0]?.results[0];
  const lines = result?.error?.message?.replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean) ?? [];
  const error = lines.find((l) => /stable|pixels|different|snapshot/i.test(l) && !l.startsWith('Error:')) ?? lines[0] ?? null;
  return { exit: code, status: result?.status ?? null, error, ms: Date.now() - t0 };
}

const sha = (f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12) : null);

function diffPixels(a, b) {
  if (!existsSync(b)) return null;
  const x = PNG.sync.read(readFileSync(a));
  const y = PNG.sync.read(readFileSync(b));
  if (x.width !== y.width || x.height !== y.height) return x.width * x.height;
  return pixelmatch(x.data, y.data, null, x.width, x.height, { threshold: 0.1 });
}

await setup();
cpSync(join(ROOT, 'template'), DIR, { recursive: true });
const runs = [];
for (const page of PAGES) {
  for (const flag of FLAGS) {
    for (let rep = 1; rep <= REPS; rep++) {
      rmSync(join(DIR, 'snapshots'), { recursive: true, force: true });
      const seed = await pw('stable', 'all');
      if (!existsSync(SNAP)) throw new Error(`baseline not written: ${JSON.stringify(seed)}`);
      copyFileSync(SNAP, ORIG);
      const before = sha(SNAP);
      const run = await pw(page, flag);
      const after = sha(SNAP);
      const changedPixels = diffPixels(ORIG, SNAP);
      if (after !== before) copyFileSync(SNAP, join(DIR, `after-${page}-${flag}-${rep}.png`));
      const next = await pw('stable', LEGACY ? 'missing' : 'none');
      const row = { version: VERSION, mask: MASK || null, page, flag, rep, ...run, baselineChanged: after !== before, changedPixels, nextStableRun: next.status };
      runs.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
mkdirSync(join(ROOT, 'results'), { recursive: true });
writeFileSync(join(ROOT, 'results', `runs-${VERSION}${MASK ? `-mask-${MASK.replace(/[^a-z]+/gi, '')}` : ''}.json`), JSON.stringify(runs, null, 2));
