import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke for the FOUNDATION only.
 *
 * The shell, the gallery, direction, keyboard reachability and print emulation.
 * There is deliberately no business journey here: P1-25 builds no business
 * screens, and an E2E test that pretends otherwise would be a fixture describing
 * a product that does not exist.
 *
 * Projects cover the viewports the Product Owner named plus both directions,
 * because an RTL layout defect is invisible in an LTR run and vice versa.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Fail the run if a test was left focused. `test.only` committed by accident
  // silently reduces the suite to one case while still reporting success.
  forbidOnly: Boolean(process.env.CI),
  // ONE worker. All five projects share a single `next start` server, and running
  // them concurrently produced 11 flaky results that all passed on retry — the
  // contention was in the harness, not the application. A retry budget would
  // have hidden that rather than fixed it, so the concurrency is pinned instead
  // and retries stay at zero: a flake here should fail and be diagnosed.
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'playwright-report.json' }]]
    : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-en',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        locale: 'en-GB',
      },
    },
    {
      name: 'desktop-ar',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        locale: 'ar-JO',
      },
    },
    {
      name: 'laptop-en',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'en-GB',
      },
    },
    {
      name: 'tablet-ar',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 768 },
        locale: 'ar-JO',
      },
    },
    {
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        // Through contextOptions: the browser context is what carries the media
        // preference, and this Playwright version does not expose it as a
        // top-level use option.
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],
  webServer: {
    // `next start` against a real production build, not `next dev`. A dev server
    // hides the hydration and bundle problems this smoke exists to catch.
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // The gallery is CLOSED in production by default, and `next start` is a
    // production server — so without this opt-in every gallery test would 404.
    // That the first run failed exactly that way is the gate working: the
    // documented escape hatch is used here rather than the gate being weakened.
    env: { ROOTLCO_ENABLE_GALLERY: 'true' },
  },
});
