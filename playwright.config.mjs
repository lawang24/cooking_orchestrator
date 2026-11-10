import { defineConfig } from '@playwright/test';

const port = Number(process.env.RECIPE_TEST_PORT || 18766);
export default defineConfig({
  testDir: './tests/browser',
  outputDir: './tmp/browser-tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // A dedicated static server and fresh browser context; no personal browser or
  // profile, application endpoints, or live services are used by this suite.
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
