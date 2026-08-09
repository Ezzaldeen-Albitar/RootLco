import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_HOST, E2E_PORT, E2E_STORAGE_STATE } from './tests/e2e/origin';

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
// The origin, the port and the captured-session path all come from
// `tests/e2e/origin.ts`, which `auth.setup.ts` reads too — see that file for
// why one statement of the origin matters more than it looks.
const PORT = E2E_PORT;
const HOST = E2E_HOST;
const BASE_URL = E2E_BASE_URL;

/**
 * The authenticated tier, added by the P1-26 Owner-acceptance remediation.
 *
 * It is OPT-IN because it needs three things a hosted runner is not given: a
 * running local Supabase, a running API, and a real account with a real
 * password. Enabled by `ROOTLCO_E2E_AUTH=1` together with the credentials the
 * acceptance bootstrap prints.
 *
 * The five anonymous projects below therefore carry `testIgnore` for this
 * directory. Without it Playwright's `testDir` sweep would hand every
 * authenticated spec to five projects that have no credentials, and CI would go
 * red on a capability that only exists on the Owner's machine.
 */
const AUTHENTICATED = process.env.ROOTLCO_E2E_AUTH === '1';
const AUTH_DIR = /authenticated[\\/]/;

/**
 * When the authenticated tier is off, SAY SO — here, in the run itself.
 *
 * The opt-in above is correct and the silence around it was not. No workflow has
 * ever set `ROOTLCO_E2E_AUTH`, so `npm run test:web-e2e` has always reported a
 * green browser tier while `isolation.spec.ts` — the repository's only
 * end-to-end tenant-isolation proof — and `accessibility.spec.ts` — its only
 * route-level accessibility proof — sat unexecuted. Playwright prints the number
 * of tests it ran; nothing printed the number it did not.
 *
 * The declaration this reads is the same one the hosted job renders into its
 * summary and `tests/ci/e2e-tier-coverage.test.ts` holds against the real spec
 * files, so the three cannot drift apart.
 */
if (!AUTHENTICATED) {
  const specs = readdirSync(join(__dirname, 'tests', 'e2e', 'authenticated'))
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();
  process.stderr.write(
    `\nROOTLCO_E2E_AUTH is not set, so the AUTHENTICATED browser tier is not running.\n` +
      `${specs.length} spec file(s) skipped: ${specs.join(', ')}\n` +
      'What that leaves unproven is declared in .github/ci-baselines/unrun-test-tiers.json.\n\n'
  );
}

/**
 * The captured session lives under the REPOSITORY-ROOT `.local/`.
 *
 * `.gitignore` anchors that directory with a leading slash, so `/.local/`
 * ignores only the root one — an `apps/web/.local/` would be tracked, and what
 * it would carry is a live session cookie.
 *
 * The filename carries the ORIGIN because a cookie jar belongs to one. Cookies
 * are scoped by host string, so a jar captured against `127.0.0.1` presents
 * nothing at all to `localhost`: the authenticated projects would start
 * "signed in", land on `/en/login`, and fail as though authentication had
 * regressed. Naming the file after the origin means changing the origin cannot
 * silently reuse a jar belonging to a different one — the state is simply
 * absent and `auth.setup` captures a fresh one.
 */
const STORAGE_STATE = E2E_STORAGE_STATE;

export default defineConfig({
  testDir: './tests/e2e',
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
    // The owner acceptance run uses the machine-installed Google Chrome
    // (ROOTLCO_E2E_CHANNEL=chrome); CI runs the pinned Playwright chromium so
    // the hosted result does not drift with the runner image Chrome version.
    ...(process.env.ROOTLCO_E2E_CHANNEL ? { channel: process.env.ROOTLCO_E2E_CHANNEL } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-en',
      testIgnore: AUTH_DIR,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        locale: 'en-GB',
      },
    },
    {
      name: 'desktop-ar',
      testIgnore: AUTH_DIR,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        locale: 'ar-JO',
      },
    },
    {
      name: 'laptop-en',
      testIgnore: AUTH_DIR,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'en-GB',
      },
    },
    {
      name: 'tablet-ar',
      testIgnore: AUTH_DIR,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 768 },
        locale: 'ar-JO',
      },
    },
    {
      name: 'reduced-motion',
      testIgnore: AUTH_DIR,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        // Through contextOptions: the browser context is what carries the media
        // preference, and this Playwright version does not expose it as a
        // top-level use option.
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
    // --- the authenticated tier, only when explicitly enabled ---------------
    ...(AUTHENTICATED
      ? [
          {
            name: 'auth-setup',
            testMatch: /authenticated[\\/]auth\.setup\.ts/,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
          },
          {
            name: 'authenticated-en',
            testMatch: /authenticated[\\/].*\.spec\.ts/,
            dependencies: ['auth-setup'],
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1440, height: 900 },
              locale: 'en-GB',
              storageState: STORAGE_STATE,
            },
          },
          {
            name: 'authenticated-ar',
            testMatch: /authenticated[\\/].*\.spec\.ts/,
            dependencies: ['auth-setup'],
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1440, height: 900 },
              locale: 'ar-JO',
              storageState: STORAGE_STATE,
            },
          },
          {
            name: 'authenticated-tablet',
            testMatch: /authenticated[\\/]administration\.spec\.ts/,
            dependencies: ['auth-setup'],
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1024, height: 768 },
              locale: 'en-GB',
              storageState: STORAGE_STATE,
            },
          },
        ]
      : []),
  ],
  webServer: {
    // `next start` against a real production build, not `next dev`. A dev server
    // hides the hydration and bundle problems this smoke exists to catch.
    command: `npx next start --hostname ${HOST} -p ${PORT}`,
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
