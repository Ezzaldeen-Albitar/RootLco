import { expect, test } from '@playwright/test';

/**
 * The Platform Owner Console, end to end: sign in → console → organisation list
 * → organisation detail (P1-32-PRE-069).
 *
 * ## Why this spec is not under `authenticated/`
 *
 * Every spec in `tests/e2e/authenticated/` must contribute at least one EXECUTED
 * test on the governed `authenticated-browser` job, and that job signs in as the
 * tenant operator — it has no platform operator. A spec skipped there would turn
 * the governed job red. So this spec signs in for itself, with its own
 * credentials, and the signed-in journey runs only when both are supplied:
 *
 *   ROOTLCO_E2E_PLATFORM_EMAIL     the platform operator's email address
 *   ROOTLCO_E2E_PLATFORM_PASSWORD  its password
 *
 * Without them that case is skipped with that reason, which is the same opt-in
 * shape `playwright.config.ts` uses for `ROOTLCO_E2E_AUTH`. The anonymous
 * refusal case needs no credentials and always runs.
 *
 * ## What that costs, stated rather than left to be discovered
 *
 * NEITHER VARIABLE IS SET BY ANY JOB UNDER `.github/` TODAY. So on every hosted
 * run of this branch the signed-in journey SKIPS, and the only case this file
 * executes anywhere is the anonymous refusal. The browser evidence that a
 * platform operator signs in and lands on the console is therefore PENDING an
 * environment that holds such an operator — it is not evidence this branch
 * carries. What does run meanwhile is the vitest proof of the same decision at
 * the seam that makes it: `apps/web/tests/platform-login-routing.test.ts` drives
 * the real `loginAction`, `requireSession` and `requirePlatformSession` against a
 * stand-in for the backend. That is a narrower claim — it proves the routing
 * rule, not the journey through a running product — and the difference is the
 * reason this paragraph exists instead of a green tick.
 *
 * The journey reads whatever organisations the environment holds. It creates
 * nothing, and when the environment holds no organisation it says so and stops
 * at the list rather than inventing one.
 */

const EMAIL = process.env.ROOTLCO_E2E_PLATFORM_EMAIL ?? '';
const PASSWORD = process.env.ROOTLCO_E2E_PLATFORM_PASSWORD ?? '';
const CONFIGURED = EMAIL.length > 0 && PASSWORD.length > 0;
const NOT_CONFIGURED =
  'ROOTLCO_E2E_PLATFORM_EMAIL and ROOTLCO_E2E_PLATFORM_PASSWORD are not both set, so there is no platform operator to sign in as.';

test.describe('Platform Owner Console', () => {
  test('signs in, lands on the console, lists organisations and opens one', async ({ page }) => {
    // test-honesty-allow: TH-002 -- no platform operator credentials in this environment; see NOT_CONFIGURED
    test.skip(!CONFIGURED, NOT_CONFIGURED);

    await page.goto('/en/login');
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The destination is decided on the server: a platform operator whose
    // workspace session is refused lands on the console, not on sign-in.
    await expect(page).toHaveURL(/\/en\/platform$/);
    await expect(page.getByTestId('shell-context-label')).toHaveText('Platform Owner Console');

    // Opening the workspace root routes the operator back to the console.
    await page.goto('/en');
    await expect(page).toHaveURL(/\/en\/platform$/);

    await page.goto('/en/platform/organizations');
    await expect(page.getByRole('heading', { level: 1, name: 'Organisations' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Organisations' });
    await expect(table).toBeVisible();

    const first = table.getByRole('link').first();
    const count = await table.getByRole('link').count();
    // test-honesty-allow: TH-002 -- the environment holds no organisation to open; nothing is created to fill it
    test.skip(count === 0, 'The environment holds no organisation, so there is no detail to open.');

    const name = (await first.textContent())?.trim() ?? '';
    await first.click();
    await expect(page).toHaveURL(/\/en\/platform\/organizations\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Usage against the plan' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Subscription', exact: true })).toBeVisible();
  });

  test('refuses the console to a visitor who is not signed in', async ({ page }) => {
    // Needs no credentials: with no session cookie the console layout redirects
    // before it asks the backend anything.
    await page.goto('/en/platform');
    await expect(page).toHaveURL(/\/en\/login\?reason=signed-out$/);
  });
});
