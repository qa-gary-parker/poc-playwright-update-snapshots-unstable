import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './out',
  snapshotPathTemplate: './snapshots/{arg}{ext}',
  workers: 1,
  retries: 0,
  reporter: [['json', { outputFile: 'report.json' }]],
  use: { viewport: { width: 400, height: 160 } },
});
