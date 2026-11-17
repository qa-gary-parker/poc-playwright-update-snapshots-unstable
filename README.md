# poc-playwright-update-snapshots-unstable

**The question:** when a page never becomes stable, does `toHaveScreenshot` with `--update-snapshots=changed` or `all` keep a good baseline, or does it overwrite it and pass?

**The answer:** it overwrites it and passes. In 226 of 226 update runs on a page with a JS animation or a live clock, the test passed with exit code 0 and replaced a good baseline with a random frame. The same pages failed in 202 of 202 runs without an update flag ("Failed to take two consecutive stable screenshots" from 1.49.1, "Screenshot comparison failed" on 1.40.0 and 1.45.0). The next normal run of the unchanged page then failed in 226 of 226 runs. This happens on every version tested, from 1.40.0 (`-u`) to 1.65.1. Masking the moving element did not help for the animation (10 of 10 runs still overwrote). Masking its static container did: 0 overwrites in 40 update runs.

> Exploratory PoC, throwaway by default. Upstream issue: [microsoft/playwright#44128](https://github.com/microsoft/playwright/issues/44128).

## Method

- One test, `template/card.spec.ts`, loads a page with `page.setContent` and calls `expect(page).toHaveScreenshot('card.png')` with default options (5 s timeout, CSS animations disabled). Viewport 400x160, Chromium headless shell, 1 worker, 0 retries.
- `pages/` has four versions of a "Build status" card:

| page | what moves |
|---|---|
| stable | nothing |
| css-animation | the progress bar, with a CSS `@keyframes` animation |
| js-animation | the progress bar, moved by `requestAnimationFrame` |
| live-clock | an "Updated HH:MM:SS.mmm" line, updated every 20 ms |

- `harness/run.mjs` runs one cell like this:
  1. Delete the snapshots, run the stable page with `--update-snapshots=all`, and keep a copy of the baseline.
  2. Run the test page with one update setting: `none`, `missing`, `changed` or `all`. Before 1.50 the flag took no value, so `-u` stands for `all` and no flag for `missing`.
  3. Record the status, the exit code, the error line, and the number of baseline pixels that changed (`pixelmatch`, threshold 0.1).
  4. Run the stable page again with no update. This is the next normal CI run.
- Versions: 1.58.2, 1.59.0, 1.59.1 and 1.65.1 with all 4 pages and 4 settings, 10 runs each. 1.40.0, 1.45.0, 1.49.1, 1.50.0, 1.52.0, 1.55.0 and 1.57.0 with the two unstable pages, 3 runs each.
- Two mask arms on 1.65.1, 10 runs each: `mask: ['#bar', '#clock']` (the moving elements) and `mask: ['.track', '#clock']` (the bar's static container).
- macOS 15.7.4, Node 24.14.1. 988 runs in total.

## Results

Every run is in `results/runs-*.json`. `npm run summary` writes `results/summary.json` and prints the table.

Unstable pages (js-animation and live-clock), no mask:

| setting | runs | passed | baseline overwritten | next normal run failed |
|---|---|---|---|---|
| none / missing | 202 | 0 | 0 | 0 |
| changed / all | 226 | **226** | **226** | **226** |

- Pixels changed per overwrite: 692 to 1,412 for the animation, 114 to 231 for the clock.
- The stable and css-animation pages passed in all 320 runs and no baseline pixel changed. Playwright disables CSS animations by default, so they were stable.
- No version behaved differently. Issue #44128 says it first appeared on 1.59.1; 1.40.0 to 1.58.2 do the same.

Mask arms on 1.65.1 (js-animation and live-clock with `changed` or `all`, 40 runs per arm):

| mask | overwritten | why |
|---|---|---|
| none | 40 | both pages never stable |
| `#bar`, `#clock` | 20 (all js-animation) | the mask box moves with the bar, so the frames still differ |
| `.track`, `#clock` | **0** | the masked area does not move |

## Why

In `packages/playwright/src/matchers/toMatchSnapshot.ts` (v1.65.1), when `updateSnapshots` is `changed` or `all`, any `errorMessage` from `_expectScreenshot` that comes with an `actual` buffer writes that buffer as the new baseline and returns a pass. A stability timeout returns an error and the last captured frame, so it takes the same path as a real visual change. v1.49.1 has the same branch for `-u`.

## Limits

- One test, one small page, Chromium only, one machine.
- Each cell creates its baseline in a separate run just before the measured run. A real update job runs against a committed baseline; the code path is the same.
- The older versions ran 3 times per cell, not 10.

## Run it

```bash
npm install
node harness/run.mjs --version 1.65.1 --reps 10
node harness/run.mjs --version 1.65.1 --reps 10 --pages js-animation,live-clock --mask '.track,#clock'
npm run summary
```

Each version installs into `work/<version>/`. Do not install browsers for two versions at the same time: one install can remove another version's browser.
