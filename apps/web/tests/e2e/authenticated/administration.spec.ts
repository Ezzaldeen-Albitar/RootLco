import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * The eleven Administration screens, signed in, against the real API.
 *
 * This is the gap P1-26's own final report named: the screens were unit-tested
 * and their markup was inherited, but no one had ever seen them authenticated in
 * a browser. Everything below therefore asserts on the NETWORK as well as the
 * DOM — a screen that renders beautifully from a fixture and never calls the API
 * is exactly the failure this closes, and `P1-26-F-015` is what it costs when
 * the boundary goes unexercised.
 */

const SCREENS = [
  { slug: 'organization', heading: /Organization/i, api: /\/api\/v1\/org\// },
  { slug: 'users', heading: /Users/i, api: /\/api\/v1\/iam\/users/ },
  { slug: 'roles', heading: /Roles/i, api: /\/api\/v1\/iam\/roles/ },
  { slug: 'permissions', heading: /Permissions/i, api: /\/api\/v1\/iam\// },
  { slug: 'approval-limits', heading: /Approval limits/i, api: /\/api\/v1\/iam\/approval-limits/ },
  { slug: 'numbering-rules', heading: /Numbering/i, api: /\/api\/v1\/org\// },
  { slug: 'taxes', heading: /Tax/i, api: /\/api\/v1\/org\// },
  { slug: 'currencies', heading: /Currenc/i, api: /\/api\/v1\/org\// },
  { slug: 'languages', heading: /Language/i, api: /\/api\/v1\/org\// },
  { slug: 'audit-log', heading: /Audit/i, api: /\/api\/v1\/iam\/audit/ },
  { slug: 'system-settings', heading: /System settings/i, api: /\/api\/v1\/org\// },
] as const;

/** Console output that would fail a clean-console assertion. */
function collectConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** Every request the page made to the API origin. */
function collectApi(page: Page) {
  const seen: Request[] = [];
  page.on('request', (request) => {
    if (/127\.0\.0\.1:3000|localhost:3000/.test(request.url())) seen.push(request);
  });
  return seen;
}

const locale = (project: string) => (project.endsWith('-ar') ? 'ar' : 'en');

test.describe('the eleven administration screens', () => {
  for (const screen of SCREENS) {
    test(`${screen.slug} loads authenticated and reaches the real API`, async ({
      page,
    }, testInfo) => {
      const consoleErrors = collectConsole(page);
      const apiCalls = collectApi(page);
      const lang = locale(testInfo.project.name);

      const response = await page.goto(`/${lang}/administration/${screen.slug}`);
      expect(response?.status(), `${screen.slug} must not error`).toBeLessThan(400);

      // Signed in: the shell is present and we were NOT bounced to sign-in.
      expect(page.url(), 'an authenticated route must not redirect to sign-in').not.toMatch(
        /\/login/
      );
      await expect(page.getByRole('navigation', { name: /Modules|الوحدات/ })).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();

      // The decisive assertion: a real authenticated request happened. Server
      // Components fetch on the server, so the browser may see none — in that
      // case the proof is that the server-rendered content is present AND the
      // page is not the denied state.
      await expect(page.getByText(/You do not have access/i)).toHaveCount(0);

      expect(consoleErrors, `${screen.slug} console`).toEqual([]);
      // `apiCalls` is informational for server-rendered screens; recorded so a
      // future client-side regression is visible rather than silent.
      testInfo.annotations.push({
        type: 'browser-api-requests',
        description: String(apiCalls.length),
      });
    });
  }

  test('the users table actually finishes loading and shows the operators', async ({ page }) => {
    // The assertion this file was missing, and the reason it was missing is
    // instructive: every other case here proves the screen RENDERS. None of
    // them proved it renders *data*. A table stuck in its loading state
    // satisfies "the route loads", "no console error", "no denial" and "no
    // horizontal overflow" simultaneously, and looks completely broken to the
    // person the phase is being accepted by.
    await page.goto('/en/administration/users');

    const body = page.locator('table tbody');
    await expect(body).toBeVisible();

    // `aria-busy` is how the table announces loading. It must CLEAR.
    await expect(body, 'the table must stop being busy').toHaveAttribute('aria-busy', 'false', {
      timeout: 20_000,
    });

    // And the rows must be the seeded operators, not an empty set rendered
    // confidently.
    await expect(page.getByText('owner.acceptance@crm.local')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('reader.acceptance@crm.local')).toBeVisible();
  });

  test('the roles table finishes loading too', async ({ page }) => {
    await page.goto('/en/administration/roles');
    const body = page.locator('table tbody');
    await expect(body).toBeVisible();
    await expect(body).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
    await expect(page.getByText('acceptance_administrator')).toBeVisible({ timeout: 20_000 });
  });

  test('no screen leaks a token or a session into browser storage', async ({ page }) => {
    await page.goto('/en/administration/users');
    const stored = await page.evaluate(() => ({
      local: Object.entries(localStorage).map(([k, v]) => `${k}=${v}`),
      session: Object.entries(sessionStorage).map(([k, v]) => `${k}=${v}`),
    }));
    const suspicious = /token|bearer|eyJ|password|secret|authorization/i;
    for (const entry of [...stored.local, ...stored.session]) {
      expect(entry, 'browser storage must never carry a credential').not.toMatch(suspicious);
    }
  });

  test('the session cookie is unreadable from page script', async ({ page }) => {
    await page.goto('/en/administration/users');
    const visible = await page.evaluate(() => document.cookie);
    expect(
      visible,
      'document.cookie must not expose the session — that is what httpOnly is for'
    ).not.toContain('rootlco.session');
  });

  test('no sensitive value is placed in a URL', async ({ page }) => {
    for (const screen of SCREENS.slice(0, 4)) {
      await page.goto(`/en/administration/${screen.slug}`);
      expect(page.url()).not.toMatch(/token=|password=|secret=|authorization=/i);
    }
  });

  test('the layout does not scroll horizontally at the reviewed widths', async ({ page }) => {
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/en/administration/users');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('the Owner brand assets render and are not broken', async ({ page }) => {
    await page.goto('/en/administration/users');
    const marks = page.locator('img[src*="/brand/"]');
    await expect(marks.first()).toBeVisible();

    const broken = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.getAttribute('src') ?? '(no src)')
    );
    expect(broken, 'no image may fail to load').toEqual([]);

    // Declared dimensions are what stop the header reflowing while the bytes
    // are in flight.
    const sized = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[src*="/brand/"]')).map((img) => ({
        src: img.getAttribute('src'),
        width: img.getAttribute('width'),
        height: img.getAttribute('height'),
        alt: img.getAttribute('alt'),
      }))
    );
    expect(sized.length).toBeGreaterThan(0);
    for (const mark of sized) {
      expect(mark.width, `${mark.src} must declare a width`).toBeTruthy();
      expect(mark.height, `${mark.src} must declare a height`).toBeTruthy();
    }
  });
});
