import { expect, test } from '@playwright/test';

/**
 * The P1-27 CRM and Vehicle screens, against the **running application and the
 * running API** — `P1-27-QA-005`, and the adversarial review that precedes Owner
 * acceptance.
 *
 * Everything else in this phase mocks the transport. That is correct for a unit
 * or component test and it is not integration evidence: a screen can satisfy
 * every mocked expectation and still fail against the real backend, because the
 * mock returns what the test author believed the operation returns.
 *
 * So nothing here is mocked. A real session reaches the real Next.js server,
 * which calls the real API, which queries the real database under RLS. The
 * claims below are the ones that would embarrass this phase if they were false
 * in front of the Owner.
 */

const LOCALES = ['en', 'ar'] as const;

test.describe('every P1-27 route is reachable and renders', () => {
  for (const locale of LOCALES) {
    test(`${locale}: the six screens load without an error state`, async ({ page }) => {
      const routes = [
        `/${locale}/crm/customers`,
        `/${locale}/crm/customers/new/individual`,
        `/${locale}/crm/customer-duplicates`,
        `/${locale}/vehicles`,
        `/${locale}/vehicles/new`,
        `/${locale}/vehicles/duplicates`,
      ];
      for (const route of routes) {
        const response = await page.goto(route);
        // A 404 here means a route that exists in the repository and not in the
        // running application — the exact failure a build-time test cannot see.
        expect(response?.status(), route).toBeLessThan(400);
        // Next renders its own error overlay on a server exception; the app
        // renders its own error card on a failed read. Neither is acceptable on
        // a first load with a valid session.
        await expect(page.locator('body'), route).not.toContainText('Application error');
        await expect(page.locator('body'), route).not.toContainText('Unhandled Runtime Error');
      }
    });
  }
});

test.describe('both duplicate queues are reachable from the sidebar', () => {
  test('a signed-in operator can navigate to them without typing a URL', async ({ page }) => {
    // Both screens shipped with routes and no way in. Every test passed, the
    // build compiled, and no operator could have found them. This is the
    // assertion that could not have been made from inside the repository.
    await page.goto('/en');
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: /duplicate customers/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /duplicate vehicles/i })).toBeVisible();

    await nav.getByRole('link', { name: /duplicate vehicles/i }).click();
    await expect(page).toHaveURL(/\/en\/vehicles\/duplicates/);
  });
});

test.describe('search asks the real backend only when asked', () => {
  test('vehicle search issues no request until a criterion is supplied', async ({ page }) => {
    const searches: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/vehicles?')) searches.push(request.url());
    });

    await page.goto('/en/vehicles');
    await page.getByLabel(/VIN/i).fill('JH4KA7561PC008269');
    await page.waitForTimeout(500);
    // Seventeen keystrokes against a 30-per-minute budget.
    expect(searches, 'typing must not search').toHaveLength(0);
  });

  test('customer search reaches the API and renders a real result state', async ({ page }) => {
    await page.goto('/en/crm/customers');
    await page.getByLabel(/name/i).first().fill('zzz-no-such-customer');
    await page.keyboard.press('Enter');

    // Whatever comes back, it must be a STATE and not a blank region. The
    // database is empty of business data by policy, so "no results" is the
    // expected outcome and it must say so.
    await expect(page.locator('main')).not.toBeEmpty();
    await expect(page.locator('main')).toContainText(/no|result|found|empty/i, {
      timeout: 15_000,
    });
  });
});

test.describe('the merge affordance is absent in the running application', () => {
  for (const route of ['/en/crm/customer-duplicates', '/en/vehicles/duplicates']) {
    test(`${route} renders no merge control of any kind`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Not "disabled" — absent. `P1-OD-017` is an open Owner decision, and a
      // disabled button asserts the capability exists and this operator lacks
      // permission, which is a different and false statement. Wave 6 shipped a
      // working merge form; this is the assertion that would have caught it in
      // front of the Owner rather than after.
      await expect(page.getByRole('button', { name: /merge/i })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /merge/i })).toHaveCount(0);
      // And no rescan control either: the scan operation is a privileged audited
      // write throttled at 30/min.
      await expect(page.getByRole('button', { name: /scan|rescan/i })).toHaveCount(0);
    });
  }
});

test.describe('no screen fires an audited write just by being opened', () => {
  test('opening either duplicate queue issues no POST at all', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/api/v1/')) {
        writes.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto('/en/crm/customer-duplicates');
    await page.waitForLoadState('networkidle');
    await page.goto('/en/vehicles/duplicates');
    await page.waitForLoadState('networkidle');

    // A queue that "refreshed" by scanning would write audit history every time
    // somebody looked at it. Reads are GETs; nothing here may be anything else.
    expect(writes, writes.join('\n')).toHaveLength(0);
  });
});

test.describe('the client asserts no scope on the wire', () => {
  test('no request carries a tenant, company or branch parameter', async ({ page }) => {
    const scoped: string[] = [];
    page.on('request', (request) => {
      if (!request.url().includes('/api/v1/')) return;
      if (/[?&](tenant|company|branch)[_A-Za-z]*=/i.test(request.url())) scoped.push(request.url());
    });

    await page.goto('/en/crm/customers');
    await page.goto('/en/vehicles');
    await page.goto('/en/vehicles/duplicates');
    await page.waitForLoadState('networkidle');

    // Scope is resolved server-side from the session on every operation. A
    // client-supplied scope is at best ignored and at worst believed.
    expect(scoped, scoped.join('\n')).toHaveLength(0);
  });
});

test.describe('no free-text search term reaches the address bar', () => {
  test('a VIN typed into search never appears in the URL', async ({ page }) => {
    await page.goto('/en/vehicles');
    await page.getByLabel(/VIN/i).fill('JH4KA7561PC008269');
    await page
      .getByRole('button', { name: /search/i })
      .first()
      .click();
    await page.waitForLoadState('networkidle');

    // The browser URL becomes history, proxy logs and the `Referer` header. The
    // API path is a different URL with a different policy and it does carry the
    // VIN — that distinction is the whole of `P1-27-SEC-002`.
    expect(page.url()).not.toContain('JH4KA7561PC008269');
  });
});
