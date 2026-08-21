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

test.describe('no screen renders a raw message key', () => {
  for (const locale of LOCALES) {
    test(`${locale}: nothing that looks like a translation key reaches the page`, async ({
      page,
    }) => {
      // `translate()` is `messages[key] ?? key`, so a value with no label
      // renders `vehicles.field.color` to the operator and NOTHING fails —
      // not typecheck, not lint, not a test, not the build.
      //
      // Two of these shipped in this phase and were caught only by an
      // adversarial review of the finished branch: `vehicles.field.*` had zero
      // entries in either catalogue, and `ADDRESS_TYPES` was invented so two
      // real values had no label.
      //
      // WHAT THIS COVERS, AND WHAT IT DOES NOT.
      //
      // A missing label for a LITERAL key is already a build error —
      // `translate()` takes `keyof Messages`, so renaming one fails typecheck
      // and the application cannot be built. Verified: that mutation does not
      // compile.
      //
      // The runtime risk is `translateDynamic`, whose key is built from server
      // data and cannot be typed. This assertion covers exactly that, and it
      // covers it only for values that render on an EMPTY database — a status
      // filter renders every one of its options, so it is caught here; a
      // `vehicles.field.*` label needs a vehicle with attribute history and is
      // not. `apps/web/tests/server-vocabularies.test.ts` is what covers those,
      // by comparing the catalogues to the migrations that own the vocabularies.
      //
      // Mutation-verified: deleting `vehicles.duplicateStatus.dismissed` and
      // rebuilding makes this fail with the raw key in the message.
      const routes = [
        `/${locale}/crm/customers`,
        `/${locale}/crm/customers/new/individual`,
        `/${locale}/crm/customer-duplicates`,
        `/${locale}/vehicles`,
        `/${locale}/vehicles/new`,
        `/${locale}/vehicles/duplicates`,
      ];

      for (const route of routes) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        const text = (await page.locator('body').innerText()) ?? '';
        // A key is `segment.segment[.segment]` in lower camel with no spaces,
        // anchored to this product's own namespaces so an ordinary sentence
        // containing a full stop cannot match.
        //
        // The lookbehind excludes an email host: the acceptance account is
        // `owner.acceptance@crm.local`, whose domain matched the first version
        // of this pattern and made the guard fail on real content. A guard that
        // cries wolf gets deleted, so it is narrowed rather than loosened.
        const keys =
          text.match(/(?<![@\w.])(?:crm|vehicles|nav|state|form|action)\.[a-zA-Z]+\.?\w*/g) ?? [];
        expect(keys, `${route} rendered raw message key(s): ${keys.join(', ')}`).toEqual([]);
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
    /*
     * Observed on the channel the browser actually uses.
     *
     * This test filtered on `/api/v1/vehicles?`, a URL the browser never
     * requests — every API call is made by the Next.js server process — so the
     * list was empty whatever happened and the assertion could not fail. The
     * same vacuity as the two observers further down (`P1-27-QA-003`).
     *
     * A search on this screen is a Server Action, which reaches the network as a
     * POST to the WEB origin. That is visible here, and it is the thing worth
     * counting: seventeen keystrokes against a 30-per-minute budget.
     */
    const observed: string[] = [];
    const posts: string[] = [];
    page.on('request', (request) => {
      observed.push(request.url());
      if (request.method() === 'POST') posts.push(request.url());
    });

    await page.goto('/en/vehicles');
    const before = posts.length;
    await page.getByLabel(/VIN/i).fill('JH4KA7561PC008269');
    await page.waitForTimeout(500);

    expect(observed.length, 'the listener saw no requests at all').toBeGreaterThan(0);
    expect(posts.length - before, 'typing must not search').toBe(0);
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

/*
 * Both observers below watch what the BROWSER does, and the browser in this
 * architecture only ever talks to the web origin: every API call is made by the
 * Next.js server process, on the server side of a Server Action or a page
 * render.
 *
 * Both used to filter on `/api/v1/`, which the browser therefore never requests.
 * They observed an emptiness they could not have found otherwise, and asserted
 * it — the shape of a proof whose subject is not what it claims to observe
 * (`P1-27-QA-003`).
 *
 * Two corrections, and the first is the load-bearing one:
 *
 *   1. A POSITIVE CONTROL. Each test now fails if the listener saw nothing at
 *      all, so "the page made no requests" can no longer pass as "the page made
 *      no bad requests".
 *   2. The `/api/v1/` filter is gone. What the browser actually issues —
 *      navigations, RSC payload fetches and Server Action POSTs to the web
 *      origin — is what these tests can see, and it is worth seeing: a scope in
 *      a Server Action's URL would be just as wrong there.
 *
 * API-wire evidence is asserted where it can be: `p1-27-qa.test.ts` drives every
 * read adapter and three write adapters and asserts on the actual call. This
 * tier cannot see that traffic and no longer claims to.
 */
test.describe('no screen fires an audited write just by being opened', () => {
  test('opening either duplicate queue issues no write beyond its own Server Action', async ({
    page,
  }) => {
    const observed: string[] = [];
    const writes: string[] = [];
    page.on('request', (request) => {
      observed.push(request.url());
      if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
    });

    await page.goto('/en/crm/customer-duplicates');
    await page.waitForLoadState('networkidle');
    await page.goto('/en/vehicles/duplicates');
    await page.waitForLoadState('networkidle');

    expect(observed.length, 'the listener saw no requests at all').toBeGreaterThan(0);

    /*
     * A Server Action IS an HTTP POST to the page's own URL.
     *
     * This case previously demanded ZERO non-GET requests, and that is
     * unsatisfiable by construction here. Both queues read through `'use server'`
     * modules — `crm/customers/identity-api.ts` and `vehicles/duplicates-api.ts`
     * — and a client component calling one issues, by the App Router's protocol,
     * a POST to the current URL carrying a `Next-Action` header. The module then
     * performs a GET against the API from the server, which the browser never
     * sees at all. So the observed method carries no information about whether an
     * audited write happened, and the assertion could only ever have passed on a
     * screen that loaded no data.
     *
     * The docblock above this describe already said the `/api/v1/` filter was
     * removed so the listener would see "Server Action POSTs to the web origin".
     * The file asked to see them and then required there to be none.
     *
     * What this tier CAN prove is that no write leaves the browser for anywhere
     * other than the page's own action endpoint. That no review screen calls
     * `crm.duplicate-scan` or its vehicle twin is proved where it is visible —
     * `p1-27-security.test.ts` and `vehicle-duplicates.test.ts` read the source —
     * and the ownership gate's `no-duplicate-scan-on-a-queue` rule enforces it.
     */
    const foreign = writes.filter(
      (w) => !/^POST \S+\/(en|ar)\/(crm\/customer-duplicates|vehicles\/duplicates)$/.test(w)
    );
    expect(foreign, foreign.join('\n')).toHaveLength(0);
  });
});

test.describe('the client asserts no scope on the wire', () => {
  test('no request carries a tenant, company or branch parameter', async ({ page }) => {
    const observed: string[] = [];
    const scoped: string[] = [];
    page.on('request', (request) => {
      observed.push(request.url());
      if (/[?&](tenant|company|branch)[_A-Za-z]*=/i.test(request.url())) scoped.push(request.url());
    });

    await page.goto('/en/crm/customers');
    await page.goto('/en/vehicles');
    await page.goto('/en/vehicles/duplicates');
    await page.waitForLoadState('networkidle');

    expect(observed.length, 'the listener saw no requests at all').toBeGreaterThan(0);
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
