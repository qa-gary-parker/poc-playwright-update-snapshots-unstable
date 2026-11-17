// Records the walkthrough from results/runs-*.json on stage.html, timed to the narration.
import { test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(here, 'out');
const SPEED = process.env.SPEED ?? '1.15';
const VOICE = process.env.VOICE ?? '';
// Cache key for a cloned voice includes the reference clip, so a new reference re-renders every line.
const voiceRef = path.join(os.homedir(), '.local/share/voice', VOICE + '.wav');
const VOICE_KEY = VOICE && fs.existsSync(voiceRef) ? `${VOICE}:${crypto.createHash('sha1').update(fs.readFileSync(voiceRef)).digest('hex').slice(0, 8)}` : VOICE;
// HQ=1: 2x-DPR CDP screencast instead of recordVideo, voice chain, -14 LUFS, variable pauses, room tone
const HQ = !!process.env.HQ;
const GAP = 550;
const GAP_IN = 380; // HQ: pause within a chapter
const GAP_OUT = 1000; // HQ: pause before a new chapter
// FAST=1: no narration, one screenshot per step in out/frames, no video
const FAST = !!process.env.FAST;

type Run = { ms: number; version: string; mask?: string | null; page: string; flag: string; exit: number; status: string; error: string | null; baselineChanged: boolean; changedPixels: number | null; nextStableRun: string };
const runs: Run[] = fs.readdirSync(path.join(root, 'results')).filter((f) => /^runs-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(root, 'results', f), 'utf8')));
const MOVING = ['js-animation', 'live-clock'];
const UPDATE = ['changed', 'all'];
const plain = runs.filter((r) => !r.mask);
const update = plain.filter((r) => MOVING.includes(r.page) && UPDATE.includes(r.flag));
const noUpdate = plain.filter((r) => MOVING.includes(r.page) && !UPDATE.includes(r.flag));
const control = plain.filter((r) => !MOVING.includes(r.page));
const masked = (mask: string) => runs.filter((r) => r.mask === mask && MOVING.includes(r.page) && UPDATE.includes(r.flag));
const count = (rs: Run[], pred: (r: Run) => boolean) => rs.filter(pred).length;
const pixels = (page: string) => update.filter((r) => r.page === page).map((r) => r.changedPixels!);
const missing = noUpdate.filter((r) => r.flag === 'missing');
const maskedAll = (mask: string) => runs.filter((r) => r.mask === mask);
const median = (rs: Run[]) => { const v = rs.map((r) => r.ms).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
const VERSIONS = [...new Set(plain.map((r) => r.version))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const shot = (name: string) => 'data:image/png;base64,' + fs.readFileSync(path.join(here, 'assets', `${name}.png`)).toString('base64');
const pageUrl = (name: string) => 'file://' + path.join(root, 'pages', `${name}.html`);
// Lines of a recorded terminal run, first match per needle, in file order
const term = (file: string, ...needles: string[]) => {
  const seen = new Set<string>();
  return fs.readFileSync(path.join(here, 'assets', `term-${file}.txt`), 'utf8').split('\n').filter((l) => {
    const n = needles.find((x) => l.includes(x) && !seen.has(x));
    return n ? !!seen.add(n) : false;
  }).map((l) => l.replace(/^ {2}/, '')).join('\n');
};
// Lines of toMatchSnapshot.ts v1.65.1 by source line number (the excerpt starts at line 396)
const SRC = fs.readFileSync(path.join(here, 'assets', 'toMatchSnapshot-1.65.1.ts.txt'), 'utf8').split('\n');
const src = (from: number, to: number) => SRC.slice(from - 396, to - 395).map((l) => l.replace(/^ {4}/, '')).join('\n');

// Every number the narration says, checked against the data before recording
const SPOKEN: [string, number, number][] = [
  ['runs in total', runs.length, 988],
  ['update runs on moving pages', update.length, 226],
  ['update runs passed', count(update, (r) => r.status === 'passed' && r.exit === 0), 226],
  ['update runs overwrote', count(update, (r) => r.baselineChanged), 226],
  ['next run failed after update', count(update, (r) => r.nextStableRun !== 'passed'), 226],
  ['no-update runs on moving pages', noUpdate.length, 202],
  ['no-update runs passed', count(noUpdate, (r) => r.status === 'passed'), 0],
  ['no-update runs overwrote', count(noUpdate, (r) => r.baselineChanged), 0],
  ['control runs', control.length, 320],
  ['control runs passed', count(control, (r) => r.status === 'passed'), 320],
  ['control pixels changed', Math.max(...control.map((r) => r.changedPixels ?? 0)), 0],
  ['animation min px', Math.min(...pixels('js-animation')), 692],
  ['animation max px', Math.max(...pixels('js-animation')), 1412],
  ['clock min px', Math.min(...pixels('live-clock')), 114],
  ['clock max px', Math.max(...pixels('live-clock')), 231],
  ['versions', VERSIONS.length, 11],
  ['old error text runs', count(noUpdate, (r) => /comparison failed/.test(r.error ?? '') && ['1.40.0', '1.45.0'].includes(r.version)), count(noUpdate, (r) => /comparison failed/.test(r.error ?? ''))],
  ['mask #bar,#clock runs', masked('#bar,#clock').length, 40],
  ['mask #bar,#clock overwrote', count(masked('#bar,#clock'), (r) => r.baselineChanged), 20],
  ['mask #bar,#clock overwrote on animation', count(masked('#bar,#clock'), (r) => r.baselineChanged && r.page === 'js-animation'), 20],
  ['mask .track,#clock runs', masked('.track,#clock').length, 40],
  ['mask .track,#clock overwrote', count(masked('.track,#clock'), (r) => r.baselineChanged), 0],
  ['1.65.1 unmasked update runs overwrote', count(update, (r) => r.version === '1.65.1' && r.baselineChanged), 40],
  ['missing runs on moving pages', missing.length, 122],
  ['missing runs passed or overwrote', count(missing, (r) => r.status === 'passed' || r.baselineChanged), 0],
  ['changed runs overwrote', count(update, (r) => r.flag === 'changed' && r.baselineChanged), 104],
  ['all runs overwrote', count(update, (r) => r.flag === 'all' && r.baselineChanged), 122],
  ['update runs', update.length, 104 + 122],
  ['stable median seconds', Math.round(median(plain.filter((r) => r.page === 'stable')) / 1000), 1],
  ['moving no-update median seconds', Math.round(median(noUpdate) / 1000), 6],
  ['moving update median seconds', Math.round(median(update) / 1000), 6],
  ['moving update faster than 5.5 s', count(update, (r) => r.ms <= 5500), 0],
  ['stable update slower than 2.5 s', count(plain, (r) => r.page === 'stable' && UPDATE.includes(r.flag) && r.ms >= 2500), 0],
  ['#bar mask no-flag animation failed', count(maskedAll('#bar,#clock'), (r) => r.page === 'js-animation' && !UPDATE.includes(r.flag) && r.status !== 'passed'), 20],
  ['#bar mask no-flag clock passed', count(maskedAll('#bar,#clock'), (r) => r.page === 'live-clock' && !UPDATE.includes(r.flag) && r.status === 'passed'), 20],
  ['.track mask no-flag moving passed', count(maskedAll('.track,#clock'), (r) => MOVING.includes(r.page) && !UPDATE.includes(r.flag) && r.status === 'passed'), 40],
  ['newest versions with 40 update runs', VERSIONS.filter((v) => update.filter((r) => r.version === v).length === 40).length, 4],
  ['versions before 1.50 with 6 update runs', VERSIONS.filter((v) => Number(v.split('.')[1]) < 50 && update.filter((r) => r.version === v).length === 6).length, 3],
  ['1.50 to 1.57 with 12 update runs', VERSIONS.filter((v) => /^1\.5[0-7]\./.test(v) && update.filter((r) => r.version === v).length === 12).length, 4],
];
for (const [what, got, said] of SPOKEN) if (got !== said) throw new Error(`narration says ${said} for ${what}, data has ${got}`);
if (!term('next', 'pixels (ratio').includes('1412 pixels')) throw new Error('narration says 1,412 pixels for the next run');
if (VERSIONS[0] !== '1.40.0' || VERSIONS.at(-1) !== '1.65.1') throw new Error('narration says 1.40 to 1.65.1');

function speech(text: string) {
  if (FAST) return { wav: '', seconds: 0.3 };
  const dir = path.join(outDir, 'tts');
  fs.mkdirSync(dir, { recursive: true });
  const wav = path.join(dir, crypto.createHash('sha1').update(VOICE_KEY + SPEED + text).digest('hex').slice(0, 12) + '.wav');
  if (!fs.existsSync(wav)) execFileSync(path.join(os.homedir(), 'bin/tts'), [...(VOICE ? ['-v', VOICE] : []), '-s', SPEED, '-o', wav, text]);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }));
  return { wav, seconds };
}

type Stage = (fn: string, ...args: unknown[]) => Promise<void>;
type Step = { ch?: string; cap: string; say: string; act?: (S: Stage) => Promise<unknown> };
const versionRuns = (v: string) => update.filter((r) => r.version === v);

const steps: Step[] = [
  {
    ch: 'The question',
    cap: '--update-snapshots passed. The baseline was a random frame.',
    say: 'A Playwright test updated its screenshot baseline, and passed. The new baseline was a random frame of an animation.',
    act: (S) => S('card', '<h1>--update-snapshots</h1><h2><span class="g">passed</span>, <span class="r">and wrote a random frame</span></h2>'),
  },
  {
    cap: 'Playwright issue #44128',
    say: 'That is the claim in Playwright issue forty-four one two eight. On a page that never stops moving, an update run can replace a good baseline, and still pass.',
    act: async (S) => {
      await S('clear');
      await S('card', '<blockquote>On a page that never becomes stable, --update-snapshots can replace a good baseline with a random frame, and pass.</blockquote><div class="src">paraphrased · github.com/microsoft/playwright/issues/44128</div>');
    },
  },
  {
    cap: 'A CI job that runs this command',
    say: 'This one matters to me. In twenty twenty-four, I wrote about a C I job that runs this exact command, and opens a pull request with the new images.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>CI: update the baselines</h1><ul><li><b>1</b>npx playwright test --update-snapshots</li><li><b>2</b>open a pull request with the new images</li></ul>');
    },
  },
  {
    cap: '226 of 226 update runs: passed and overwrote',
    say: 'So I measured it. On a page with a JavaScript animation, or a live clock, every update run passed, and overwrote the baseline. Two hundred and twenty-six of two hundred and twenty-six.',
    act: async (S) => { await S('clear'); await S('card', '<h1><span class="r">226</span> of 226 update runs</h1><h2>passed, and overwrote a good baseline</h2><h2 class="m" id="h2"></h2>'); },
  },
  {
    cap: 'Every version from 1.40 to 1.65.1. One mask stopped it.',
    say: 'It happened on every version I tested, from one forty to one sixty-five point one. And one mask setting stopped it.',
    act: (S) => S('append', '#h2', '1.40.0 → 1.65.1 · one mask: <span class="g">0</span> of 40'),
  },
  {
    cap: 'In this video',
    say: 'In this video: how I ran it, what happened with and without the update flag, why the code does it, and the mask that stopped it.',
    act: async (S) => { await S('clear'); await S('card', '<h1>In this video</h1><ul><li><b>1</b>the setup</li><li><b>2</b>with and without the update flag</li><li><b>3</b>why the code does it</li><li><b>4</b>the mask that stopped it</li></ul>'); },
  },

  {
    ch: 'The setup',
    cap: 'One test. Default options.',
    say: 'Here is the setup. One test loads a small build status card, and calls to have screenshot. Default options. A five second timeout, and CSS animations turned off.',
    act: async (S) => {
      await S('clear');
      await S('term', 'c', 'template/card.spec.ts', 'blue', 'big');
      await S('code', 'c', "test('build status card', async ({ page }) => {\n  await page.setContent(html);\n  await expect(page).toHaveScreenshot('card.png');\n});");
      await S('mark', 'c', 'toHaveScreenshot');
    },
  },
  {
    cap: 'Four versions of the card',
    say: 'There are four versions of the card. In the first one, nothing moves.',
    act: async (S) => { await S('clear'); await S('livegrid'); await S('live', pageUrl('stable'), 'stable', 'nothing moves'); },
  },
  {
    cap: 'css-animation: a CSS animation',
    say: 'The second one moves the progress bar with a CSS animation.',
    act: (S) => S('live', pageUrl('css-animation'), 'css-animation', 'CSS @keyframes'),
  },
  {
    cap: 'js-animation: moved by JavaScript',
    say: 'The third one moves the same bar from JavaScript, on every animation frame.',
    act: (S) => S('live', pageUrl('js-animation'), 'js-animation', 'requestAnimationFrame'),
  },
  {
    cap: 'live-clock: updates every 20 ms',
    say: 'And the fourth one has a clock with milliseconds. It updates every twenty milliseconds.',
    act: (S) => S('live', pageUrl('live-clock'), 'live-clock', 'every 20 ms'),
  },
  {
    cap: 'CSS animations are turned off. JavaScript is not.',
    say: 'Before each screenshot, Playwright turns off CSS animations. It does not stop JavaScript. So two of these pages never sit still.',
  },
  {
    cap: 'css-animation is the control: it moves, but Playwright stops it',
    say: 'The CSS animation is the control for that. It moves too, but Playwright stops it before the screenshot, so the page is stable.',
  },
  {
    cap: 'One run, three steps',
    say: 'Each run has three steps. One. Write a good baseline from the stable card.',
    act: async (S) => { await S('clear'); await S('card', '<h1>One run</h1><ul id="steps"><li><b>1</b>write a good baseline<span>stable card · --update-snapshots=all</span></li></ul>'); },
  },
  {
    cap: '2. Run one card with one update setting',
    say: 'Two. Run one version of the card, with one update setting. None, missing, changed, or all.',
    act: (S) => S('append', '#steps', '<li><b>2</b>run one card, one update setting<span>none · missing · changed · all</span></li>'),
  },
  {
    cap: '3. Run the stable card again, with no update',
    say: 'Three. Run the stable card again, with no update. That is the next normal C I run.',
    act: (S) => S('append', '#steps', '<li><b>3</b>run the stable card again, no update<span>the next normal CI run</span></li>'),
  },
  {
    cap: 'Then count the pixels that changed',
    say: 'After step two, I compare the baseline with the good one, and count the pixels that changed.',
    act: (S) => S('append', '#steps', '<li><b>=</b>compare with the good baseline<span>pixelmatch · changed pixels</span></li>'),
  },
  {
    cap: '11 versions, 988 runs',
    say: 'I ran four recent versions with every page and every setting, ten times each. And seven older versions, back to one forty, with the two moving pages, three times each. With the mask runs that come later, that is nine hundred and eighty-eight runs.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>11 versions · 988 runs</h1><div class="cols"><div class="col"><b class="g">10 runs each</b><span>1.58.2 · 1.59.0 · 1.59.1 · 1.65.1<br>4 pages × 4 settings</span></div><div class="col"><b class="b">3 runs each</b><span>1.40.0 · 1.45.0 · 1.49.1 · 1.50.0 · 1.52.0 · 1.55.0 · 1.57.0<br>the 2 moving pages</span></div></div>');
    },
  },
  {
    cap: 'Before 1.50: -u means all',
    say: 'Before one fifty, the flag took no value. So on those versions, dash u stands for all, and no flag stands for missing.',
  },

  {
    ch: 'Without an update',
    cap: 'The moving card, no update flag',
    say: 'First, the moving card with no update flag. This is a real run on one sixty-five point one, recorded for this video.',
    act: async (S) => {
      await S('clear');
      await S('term', 'a', 'work/1.65.1 · js-animation', 'pass', 'big');
      await S('type', 'a', 'npx playwright test');
      await S('code', 'a', term('none', '✘', 'Error:', 'Timeout:', 'Failed to take', '1 failed', 'exit'));
    },
  },
  {
    cap: '"Failed to take two consecutive stable screenshots"',
    say: 'It fails after five seconds. Playwright takes screenshots until two in a row match. On this page, they never do.',
    act: (S) => S('mark', 'a', 'consecutive'),
  },
  {
    cap: 'none / missing: 0 of 202 passed',
    say: 'Across all versions, all two hundred and two runs without an update failed. No baseline changed.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'No update: none or missing', 'the two moving pages, all 11 versions');
      await S('bar', 'runs', noUpdate.length, noUpdate.length, 'muted');
      await S('bar', 'passed', count(noUpdate, (r) => r.status === 'passed'), noUpdate.length, 'pass');
      await S('bar', 'baseline overwritten', count(noUpdate, (r) => r.baselineChanged), noUpdate.length, 'fail');
    },
  },
  {
    cap: 'missing: 0 of 122 passed, 0 written',
    say: 'Missing only writes a baseline when there is none. Here a good baseline exists, so missing acts like none. All one hundred and twenty-two missing runs on the moving pages failed, and wrote nothing.',
  },
  {
    cap: '1.40 and 1.45: "Screenshot comparison failed"',
    say: 'On one forty and one forty-five, the error text was different. Screenshot comparison failed. But it still failed.',
  },
  {
    cap: 'A failure is the right answer here',
    say: 'That is the right answer. The page is not stable, so the test should not pass.',
  },

  {
    ch: 'With an update',
    cap: 'Same card, --update-snapshots=changed',
    say: 'Now the same card, with update snapshots set to changed.',
    act: async (S) => {
      await S('clear');
      await S('term', 'a', 'work/1.65.1 · js-animation', 'pass', 'big');
      await S('type', 'a', 'npx playwright test --update-snapshots=changed');
      await S('code', 'a', term('changed', 're-generated', '✓', '1 passed', 'exit'));
    },
  },
  {
    cap: '1 passed. Exit code 0.',
    say: 'One passed. Exit code zero. The same five seconds, on the same moving card. The only sign is this line. Re-generated, writing actual.',
    act: (S) => S('mark', 'a', 're-generated'),
  },
  {
    cap: 'The good baseline',
    say: 'Here is the good baseline. The progress bar is at the left of the track, and the clock shows a fixed time.',
    act: async (S) => { await S('clear'); await S('shot', shot('update-snapshots-baseline'), 'before · snapshots/card.png'); },
  },
  {
    cap: 'After one update run on js-animation',
    say: 'And here it is after one update run on the animation. The bar has moved to the middle of the track. That frame is now the baseline.',
    act: (S) => S('shot', shot('update-snapshots-js-animation-overwritten'), 'after js-animation · --update-snapshots'),
  },
  {
    cap: 'After one update run on live-clock',
    say: 'On the clock page, the baseline now shows the time of the run.',
    act: async (S) => {
      await S('clear');
      await S('shot', shot('update-snapshots-baseline'), 'before · snapshots/card.png');
      await S('shot', shot('update-snapshots-live-clock-overwritten'), 'after live-clock · --update-snapshots');
    },
  },
  {
    cap: 'Changed pixels: 692 to 1,412 (animation), 114 to 231 (clock)',
    say: 'On the animation, from six hundred and ninety-two to fourteen hundred and twelve pixels changed. On the clock, from one hundred and fourteen to two hundred and thirty-one.',
  },
  {
    cap: 'The next normal run: the stable card fails',
    say: 'Then the next normal run. The card is stable again. Nothing on the page changed. And the test fails, because the baseline is now a frame of the animation.',
    act: async (S) => {
      await S('clear');
      await S('term', 'a', 'work/1.65.1 · stable', 'pass', 'big');
      await S('type', 'a', 'npx playwright test');
      await S('code', 'a', term('next', '✘', 'Error:', 'pixels (ratio', '1 failed', 'exit'));
      await S('shot', shot('next-run-diff'), 'card-diff.png');
    },
  },
  {
    cap: '1,412 pixels different',
    say: 'Fourteen hundred and twelve pixels are different. The failure shows up in the next run, not in the update run that caused it.',
    act: (S) => S('mark', 'a', '1412 pixels'),
  },
  {
    cap: 'changed / all: 226 of 226 passed and overwrote',
    say: 'Across all versions, there were two hundred and twenty-six update runs on the moving pages. Every one passed. Every one overwrote the baseline. And every next run failed.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'Update: changed or all', 'the two moving pages, all 11 versions');
      await S('bar', 'runs', update.length, update.length, 'muted');
      await S('bar', 'passed, exit code 0', count(update, (r) => r.status === 'passed' && r.exit === 0), update.length, 'pass');
      await S('bar', 'baseline overwritten', count(update, (r) => r.baselineChanged), update.length, 'fail');
      await S('bar', 'next normal run failed', count(update, (r) => r.nextStableRun !== 'passed'), update.length, 'fail');
    },
  },
  {
    cap: 'stable + css-animation: 320 of 320 passed, 0 pixels changed',
    say: 'The control pages behaved. The stable card and the CSS animation passed in all three hundred and twenty runs, and not one baseline pixel changed.',
  },
  {
    cap: 'changed: 104 of 104 · all: 122 of 122',
    say: 'Changed and all did the same thing. One hundred and four changed runs, and one hundred and twenty-two all runs. Every one replaced the baseline.',
  },

  {
    ch: 'How long it took',
    cap: 'Stable card: about 1 second',
    say: 'The run times tell the same story. A run on the stable card took about one second.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'Run time, median', 'milliseconds per run');
      await S('bar', 'stable card', median(plain.filter((r) => r.page === 'stable')), 7000, 'pass', 'ms');
    },
  },
  {
    cap: 'Moving page, no flag: about 6 seconds, failed',
    say: 'A run on a moving page without the flag took about six seconds. It used up the five second timeout, and failed.',
    act: (S) => S('bar', 'moving page, no flag · failed', median(noUpdate), 7000, 'muted', 'ms'),
  },
  {
    cap: 'Moving page, update: about 6 seconds, passed',
    say: 'An update run on a moving page took the same six seconds. It used up the same timeout. Then it wrote the file, and passed.',
    act: (S) => S('bar', 'moving page, update · passed', median(update), 7000, 'fail', 'ms'),
  },
  {
    cap: 'Every moving-page update: over 5.5 s · stable updates: under 2.5 s',
    say: 'Every update run on a moving page took more than five and a half seconds. On the stable card, the slowest update took less than two and a half seconds. So a slow update run is one sign to look for.',
  },

  {
    ch: 'Every version',
    cap: 'Overwritten in every update run, on every version',
    say: 'No version behaved differently. Here is every version I tested. Each bar is the update runs on the moving pages, and how many of them overwrote the baseline.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'Baseline overwritten, per version', 'update runs on the two moving pages');
      for (const v of VERSIONS) {
        const rs = versionRuns(v);
        await S('bar', v + (Number(v.split('.')[1]) < 50 ? ' (-u)' : ''), count(rs, (r) => r.baselineChanged), rs.length, 'fail', `of ${rs.length}`);
      }
    },
  },
  {
    cap: '4 newest versions: 10 runs each · older: 3 runs each',
    say: 'From one fifty on, the changed setting did the same as all, on every version. The four newest versions show forty, because they ran ten times per page and setting. The older ones show six or twelve, at three runs each. Before one fifty there was only dash u, so one setting instead of two.',
  },
  {
    cap: '1.59.1 is when the reporter saw it, not when it began',
    say: 'The issue reporter first saw this on one fifty-nine point one. That is when they saw it, not when it started. One forty did the same thing, with dash u.',
  },

  {
    ch: 'Why it happens',
    cap: 'toMatchSnapshot.ts, Playwright v1.65.1',
    say: 'So why does it happen? The answer is in the screenshot code, in Playwright one sixty-five point one.',
    act: async (S) => {
      await S('clear');
      await S('term', 'c', 'packages/playwright/src/matchers/toMatchSnapshot.ts', 'blue', 'big');
      await S('code', 'c', src(416, 418));
    },
  },
  {
    cap: 'With all: no expected image',
    say: 'With all, the matcher passes no expected image. It only waits for two matching screenshots in a row.',
    act: (S) => S('mark', 'c', 'undefined'),
  },
  {
    cap: 'Never stable: an error, and the last screenshot',
    say: 'A page that never stops moving never gives two. So the call comes back with an error message, and the last screenshot it took.',
    act: (S) => S('mark', 'c', 'errorMessage'),
  },
  {
    cap: 'changed or all + an error + a screenshot = write it, pass',
    say: 'And here is the branch. With changed or all, if there is an error and a screenshot, write that screenshot as the baseline, and pass.',
    act: async (S) => {
      await S('clear');
      await S('term', 'c', 'packages/playwright/src/matchers/toMatchSnapshot.ts', 'blue');
      await S('code', 'c', src(418, 420) + '\n  …\n' + src(424, 425) + '\n…\n' + src(436, 438));
      await S('mark', 'c', 'return writeFiles');
      await S('mark', 'c', 'createMatcherResult');
    },
  },
  {
    cap: 'With missing: the same error, nothing written, fail',
    say: 'With missing, the same error goes the other way. A baseline exists, so nothing is written, and the test fails.',
  },
  {
    cap: 'It does not check which error it was',
    say: 'It does not check which kind of error it was. A page that never became stable takes the same path as a page that really changed.',
  },
  {
    cap: 'With no baseline yet, the same case fails',
    say: 'The code already knows about this case. When there is no baseline yet, and the page never settles, it fails. The comment says: this can be due to a spinning animation.',
    act: async (S) => {
      await S('clear');
      await S('term', 'c', 'toMatchSnapshot.ts · no baseline yet', 'blue', 'big');
      await S('code', 'c', src(398, 403) + '\n  …\n' + src(405, 406));
      await S('mark', 'c', 'spinning');
    },
  },
  {
    cap: 'The same update branch in 1.49.1, for -u',
    say: 'The same update branch is in the one forty-nine point one source, for dash u.',
  },

  {
    ch: 'What stopped it',
    cap: 'A mask paints a box over an element',
    say: 'Can you stop it from the test? The usual tool is a mask. A mask paints a pink box over an element before the screenshot.',
    act: async (S) => {
      await S('clear');
      await S('term', 'c', 'mask option', 'blue', 'big');
      await S('code', 'c', "await expect(page).toHaveScreenshot('card.png', {\n  mask: [page.locator('#bar'), page.locator('#clock')],\n});");
    },
  },
  {
    cap: 'Mask 1: the moving elements, #bar and #clock',
    say: 'I tried two masks on one sixty-five point one, ten runs per page and setting. The first one masks the moving elements. The bar, and the clock.',
    act: async (S) => {
      await S('clear');
      await S('shot', shot('mask-bar-a'), 'mask #bar, #clock · frame 1');
      await S('shot', shot('mask-bar-b'), 'mask #bar, #clock · frame 2');
    },
  },
  {
    cap: '20 of 40 still overwritten, all on js-animation',
    say: 'Twenty out of forty update runs still replaced the baseline. All twenty were on the animation. On the clock page, the mask worked.',
  },
  {
    cap: 'No flag: animation failed 20 of 20, clock passed 20 of 20',
    say: 'Without a flag, the animation still failed every run with that mask. Twenty of twenty. The clock passed every run.',
  },
  {
    cap: 'The mask box moves with the bar',
    say: 'These are two screenshots with that mask, taken one after the other. The mask box moves with the bar, and part of the bar is outside it. So, likely, two screenshots still never match. I did not measure that step inside the matcher.',
  },
  {
    cap: 'Mask 2: the track the bar moves in',
    say: 'The second mask covers the track that the bar moves in, and the clock.',
    act: async (S) => {
      await S('clear');
      await S('shot', shot('mask-track-a'), 'mask .track, #clock · frame 1');
      await S('shot', shot('mask-track-b'), 'mask .track, #clock · frame 2');
    },
  },
  {
    cap: '0 of 40 overwritten',
    say: 'Zero of forty overwritten. The masked area does not move, so two screenshots match.',
  },
  {
    cap: 'No flag: 40 of 40 passed',
    say: 'And with that mask, the moving pages also passed without any update flag. All forty passed. The mask did not only stop the overwrite. It made the test pass on its own.',
  },
  {
    cap: 'Mask the area it moves in, not the element',
    say: 'So mask the area that a moving element moves in, not the element itself.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'Baseline overwritten, 1.65.1', 'update runs on the two moving pages, 40 per mask');
      await S('bar', 'no mask', count(update, (r) => r.version === '1.65.1' && r.baselineChanged), 40, 'fail');
      await S('bar', '#bar, #clock', count(masked('#bar,#clock'), (r) => r.baselineChanged), 40, 'warn');
      await S('bar', '.track, #clock', count(masked('.track,#clock'), (r) => r.baselineChanged), 40, 'pass');
    },
  },

  {
    ch: 'Limits',
    cap: 'One test, one page, Chromium, one machine',
    say: 'Now the limits. One test, one small page, Chromium only, on one machine.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>Limits</h1><ul><li><b>-</b>one test, one small page<span>Chromium only · one machine</span></li><li><b>-</b>baseline written just before each run<span>a real job uses a committed baseline · same code path</span></li><li><b>-</b>older versions: 3 runs per setting, not 10</li><li><b>-</b>pages that never settle<span>not tested: a page that settles slowly · a larger timeout</span></li></ul>');
    },
  },
  {
    cap: 'Baseline written just before each run',
    say: 'Each run writes its baseline just before the measured run. A real update job runs against a committed baseline. It takes the same code path.',
  },
  {
    cap: 'Older versions: 3 runs per setting',
    say: 'And the older versions ran three times per setting, not ten.',
  },
  {
    cap: 'Not tested: a page that settles slowly, a larger timeout',
    say: 'I only tested pages that never settle. I did not test a page that settles slowly, or a larger timeout.',
  },

  {
    ch: 'Try it',
    cap: 'Clone it and run one version',
    say: 'To try it yourself, clone the repository, and run the harness for one version. Each version installs into its own folder.',
    act: async (S) => {
      await S('clear');
      await S('term', 'a', 'your terminal', 'pass', 'big');
      await S('type', 'a', 'git clone https://github.com/qa-gary-parker/poc-playwright-update-snapshots-unstable');
      await S('type', 'a', 'npm install');
      await S('type', 'a', 'node harness/run.mjs --version 1.65.1 --reps 10');
    },
  },
  {
    cap: 'Add a mask, then print the table',
    say: 'Add a mask with the mask option. Then print the table with N P M run summary.',
    act: async (S) => {
      await S('type', 'a', "node harness/run.mjs --version 1.65.1 --pages js-animation,live-clock --mask '.track,#clock'");
      await S('type', 'a', 'npm run summary');
    },
  },
  {
    cap: 'One JSON record per run',
    say: 'Every run is one record in the results folder. The version, the page, the setting, the exit code, how long it took, whether the baseline changed, and how many pixels changed.',
    act: async (S) => {
      await S('clear');
      await S('term', 'c', 'results/runs-1.65.1.json', 'blue', 'big');
      await S('code', 'c', JSON.stringify(update.find((r) => r.version === '1.65.1' && r.page === 'js-animation' && r.flag === 'changed'), null, 2));
    },
  },

  {
    ch: 'What to do',
    cap: '1. A green update run means "files written"',
    say: 'What would I do with this? One. Treat a green update run as files written, not as the page was stable. The exit code does not tell you which.',
    act: async (S) => { await S('clear'); await S('card', '<h1>What I would do</h1><ul id="todo"><li><b>1</b>A green update run means "files written"<span>226 of 226 passed on a page that never settled</span></li></ul>'); },
  },
  {
    cap: '2. Run once more without the flag',
    say: 'Two. After an update, run the same tests once more without the flag, before you commit the new baselines. In this experiment, a run without the flag failed on the moving pages every time.',
    act: (S) => S('append', '#todo', '<li><b>2</b>Run once more without the flag<span>no flag: 0 of 202 passed on the moving pages</span></li>'),
  },
  {
    cap: 'In CI: one more test command after the update',
    say: 'In a C I job, that is one more test command after the update. If it fails, do not open the pull request.',
  },
  {
    cap: '3. Mask the area, not the element',
    say: 'Three. Mask the area that a moving element moves in, not the element itself.',
    act: (S) => S('append', '#todo', '<li><b>3</b>Mask the area, not the element<span>.track, #clock: 0 of 40 · #bar, #clock: 20 of 40</span></li>'),
  },
  {
    cap: '4. Look at the images',
    say: 'Four. In a job that opens a pull request with new baselines, look at the images, not only the green check.',
    act: (S) => S('append', '#todo', '<li><b>4</b>Look at the images, not only the check<span>the next run failed in 226 of 226</span></li>'),
  },
  {
    cap: '5. Only need new baselines? Use missing',
    say: 'Five. If a job only needs to add new baselines, use missing. In these runs, it never overwrote one.',
    act: (S) => S('append', '#todo', '<li><b>5</b>Only adding baselines? Use missing<span>missing: 0 of 122 overwritten on the moving pages</span></li>'),
  },
];

const END_SECONDS = 10;
const END_SAY = 'The code, every run, and the write-up are linked in the description.';

test('record the walkthrough', async ({ browser }, testInfo) => {
  const says = [...steps.map((s) => s.say), END_SAY];
  let lines = says.map(speech);
  if (VOICE && !FAST) {
    const tsv = path.join(outDir, 'narration-pre.tsv');
    fs.writeFileSync(tsv, says.map((s) => `0\t${s}`).join('\n') + '\n');
    execFileSync(path.join(os.homedir(), 'bin/tts-check'), [tsv, path.join(outDir, 'tts'), VOICE, SPEED, '4'], { stdio: 'inherit' });
    lines = says.map(speech);
  }
  const viewport = testInfo.project.use.viewport!;
  const context = await browser.newContext(HQ
    ? { viewport, deviceScaleFactor: 2 }
    : { viewport, recordVideo: { dir: testInfo.outputDir, size: viewport } });
  const page: Page = await context.newPage();
  const frames: { t: number; file: string }[] = [];
  const frameDir = path.join(outDir, 'hq-frames');
  let cdp: Awaited<ReturnType<typeof context.newCDPSession>> | undefined;
  if (HQ && !FAST) {
    fs.rmSync(frameDir, { recursive: true, force: true });
    fs.mkdirSync(frameDir, { recursive: true });
    cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(frameDir, `${String(frames.length).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ t: metadata.timestamp! * 1000, file });
      cdp!.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
  }
  await page.goto('file://' + path.join(here, 'stage.html'));
  await page.evaluate(() => document.fonts.ready);
  const S: Stage = (fn, ...args) => page.evaluate(([f, a]) => (window as any).S[f as string](...(a as unknown[])), [fn, args] as const);

  if (cdp) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
  const start = Date.now();
  const at = () => (Date.now() - start) / 1000;
  const cues: { at: number; wav: string; say: string }[] = [];
  const chapters: string[] = [];
  let chapter = 0;
  if (FAST) fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  await page.waitForTimeout(400);
  for (const [i, step] of steps.entries()) {
    if (step.ch) {
      await S('chapter', ++chapter, step.ch);
      const t = Math.floor(at());
      chapters.push(`${chapter === 1 ? '0:00' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`} ${step.ch}`);
    }
    const began = Date.now();
    cues.push({ at: at(), wav: lines[i].wav, say: step.say });
    await S('caption', step.cap);
    await step.act?.(S);
    const gap = HQ ? (steps[i + 1]?.ch || i === steps.length - 1 ? GAP_OUT : GAP_IN) : GAP;
    await page.waitForTimeout(Math.max(0, lines[i].seconds * 1000 + gap - (Date.now() - began)));
    if (FAST) await page.screenshot({ path: path.join(outDir, 'frames', `${String(i + 1).padStart(2, '0')}.png`) });
  }
  await S('end', [
    ['write-up', 'garyparker.dev/blog/\nplaywright-update-snapshots-unstable-page'],
    ['source', 'github.com/qa-gary-parker/\npoc-playwright-update-snapshots-unstable'],
    ['issue', 'github.com/microsoft/playwright/issues/44128'],
  ], 'update runs on moving pages: 226 of 226 overwrote and passed · mask the track: 0 of 40');
  cues.push({ at: at(), wav: lines[steps.length].wav, say: END_SAY });
  if (FAST) {
    await page.screenshot({ path: path.join(outDir, 'frames', 'end.png') });
    await context.close();
    return;
  }
  await page.waitForTimeout(END_SECONDS * 1000);
  const length = at();

  const webm = path.join(outDir, 'walkthrough.webm');
  let videoIn: string[];
  if (HQ) {
    await cdp!.send('Page.stopScreencast');
    await context.close();
    // Frames arrive only when the page changes: hold each until the next one.
    const list = frames.map((f, i) => {
      const end = i + 1 < frames.length ? frames[i + 1].t : start + length * 1000;
      return `file '${f.file}'\nduration ${(Math.max(1, end - Math.max(f.t, start)) / 1000).toFixed(4)}`;
    });
    const concat = path.join(frameDir, 'list.txt');
    fs.writeFileSync(concat, list.join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`);
    const firstAt = Math.max(0, (frames[0].t - start) / 1000);
    videoIn = ['-f', 'concat', '-safe', '0', '-i', concat];
    if (firstAt > 0.01) videoIn = ['-itsoffset', firstAt.toFixed(3), ...videoIn];
  } else {
    const video = page.video()!;
    await context.close();
    await video.saveAs(webm);
    videoIn = ['-i', webm];
  }
  fs.writeFileSync(path.join(outDir, 'chapters.txt'), chapters.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'narration.tsv'), cues.map((c) => `${c.at.toFixed(2)}\t${c.say}`).join('\n') + '\n');

  const inputs = cues.flatMap((c) => ['-i', c.wav]);
  const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`).join(';');
  const mix = cues.map((_, i) => `[a${i}]`).join('');
  // HQ voice chain: rumble cut, less boxiness, presence, de-ess, gentle compression, faint room tone, -14 LUFS (YouTube)
  const voice = HQ
    ? 'highpass=f=80,equalizer=f=300:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=2.5,deesser=i=0.4,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2'
    : 'anull';
  const room = HQ ? `;anoisesrc=colour=brown:amplitude=0.0035:sample_rate=48000:duration=${length.toFixed(3)},lowpass=f=3000[room]` : '';
  const voiceMix = `${mix}amix=inputs=${cues.length}:normalize=0:duration=longest,apad,${voice}`;
  const audio = HQ
    ? `${delays}${room};${voiceMix}[v];[v][room]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=11[aout]`
    : `${delays};${voiceMix},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  const video = HQ ? ['-vf', 'fps=30', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-tune', 'stillimage'] : ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium'];
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...videoIn, ...inputs,
    '-filter_complex', audio,
    '-map', '0:v', '-map', '[aout]', ...video, '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', length.toFixed(3), '-movflags', '+faststart', path.join(outDir, 'walkthrough.mp4')]);
  if (HQ) {
    const LIMIT = 'alimiter=limit=0.5:attack=3:release=60:level=false';
    // Second loudness pass: measure the mix, then apply linear gain to exactly -14 LUFS / -1 dBTP.
    const mp4 = path.join(outDir, 'walkthrough.mp4');
    const tmp = path.join(outDir, 'walkthrough.pre-loudnorm.mp4');
    fs.renameSync(mp4, tmp);
    const err = spawnSync('ffmpeg', ['-hide_banner', '-i', tmp, '-af', `${LIMIT},loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const m = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-c:v', 'copy', '-af',
      `${LIMIT},loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4]);
    fs.rmSync(tmp);
  }
  console.log(`walkthrough.mp4 ${length.toFixed(1)} s, ${cues.length} lines, ${lines.reduce((a, l) => a + l.seconds, 0).toFixed(1)} s of speech`);
  console.log(chapters.join('\n'));
});
