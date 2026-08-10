import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { E2E_API_ORIGIN } from '../origin';

/**
 * Cross-tenant isolation, end to end, with a real session.
 *
 * P1-26 recorded this as NOT proven: the Database tier proves RLS, but nothing
 * had ever established that a real signed-in browser session cannot reach
 * another workspace through the running API. It needed two live tenants, and
 * the no-fake-data policy forbade creating them. The Owner has since authorised
 * local synthetic fixtures, so this is now measurable rather than argued.
 *
 * Tenant A is the Owner's workspace. Tenant B exists and is populated, and the
 * Owner holds NO membership in it. Every assertion below is of the form "a
 * Tenant A session asks for a Tenant B thing and does not get it".
 */

/** Fixed by `scripts/dev/owner-acceptance/context.mjs`. */
const TENANT_B = 'c0000000-0000-4000-8000-00000000000b';
const COMPANY_B = 'c1000000-0000-4000-8000-00000000000b';
const BRANCH_B = 'c1100000-0000-4000-8000-00000000000b';
const TENANT_B_USER = 'c2000000-0000-4000-8000-00000000000e';
const TENANT_B_NAME = 'CRM Isolation Tenant B';

// Stated once, in `tests/e2e/origin.ts`, alongside the browser origin.
const API = E2E_API_ORIGIN;
const HANDOFF = join(resolve(process.cwd(), '..', '..'), '.local', 'owner-acceptance-account.json');

interface Credentials {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
}

/** The Tenant A owner's own credentials, from the environment or the handoff. */
function credentialsForTenantA(): Credentials {
  const fromEnv = {
    tenantId: process.env.ROOTLCO_E2E_TENANT_ID,
    email: process.env.ROOTLCO_E2E_EMAIL,
    password: process.env.ROOTLCO_E2E_PASSWORD,
  };
  if (fromEnv.tenantId && fromEnv.email && fromEnv.password) return fromEnv as Credentials;
  if (!existsSync(HANDOFF)) {
    throw new Error('No credentials. Run: npm run acceptance:create-owner');
  }
  const handoff = JSON.parse(readFileSync(HANDOFF, 'utf8'));
  return {
    tenantId: handoff.tenantId,
    email: handoff.login.email,
    password: handoff.login.password,
  };
}

/** Signs in as the Tenant A owner and returns a real bearer token. */
async function bearerForTenantA(request: APIRequestContext): Promise<string> {
  const credentials = credentialsForTenantA();

  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: credentials,
    failOnStatusCode: false,
  });
  expect(login.status(), 'the Tenant A owner must be able to sign in').toBe(200);
  const body = await login.json();
  const token = body.accessToken;
  expect(token, 'login must issue an access token').toBeTruthy();
  return token as string;
}

/**
 * Loads a route, proves it really rendered for Tenant A, and returns its text.
 *
 * ## Why every browser case in this file needs this
 *
 * The two cases below were `expect(body).not.toContain(…)` and nothing else. A
 * blank page, a redirect to sign-in, the dashboard error boundary and a 404 all
 * satisfy that assertion perfectly — so did a route that had been renamed. Only
 * the API case had a control, and the whole point of a control is that a
 * negative assertion is worthless without one.
 *
 * Three things are established before any leak assertion runs:
 *
 * - the session is Tenant A's, because the shell prints the signed-in address
 *   of the account this file logged in with (`AccountMenu` renders it on every
 *   dashboard page). A redirect to sign-in loses it.
 * - the route rendered its own content, not the error or not-found boundary,
 *   both of which render inside the same shell and would otherwise pass.
 * - `main` holds a real amount of text, so an empty shell is not mistaken for a
 *   screen that legitimately shows nothing of Tenant B.
 */
async function renderedForTenantA(
  page: import('@playwright/test').Page,
  route: string
): Promise<string> {
  const { email } = credentialsForTenantA();
  await page.goto(route);
  const main = page.getByRole('main');
  await expect(main, `${route} rendered no main landmark`).toBeVisible();

  /*
   * WAIT FOR THE SEGMENT, then read the body. The order is the point.
   *
   * `page.goto` resolves at `load`. Every screen here is an async server
   * component, so Next streams `(dashboard)/loading.tsx` into `main` first —
   * and that fallback's entire text is the `sr-only` `state.loading`, "Loading",
   * seven characters. `main` belongs to the LAYOUT, so `toBeVisible()` above is
   * satisfied by the skeleton and says nothing about the segment.
   *
   * The length check used to sit below the body assertions and read exactly
   * those seven characters on the first hosted run of this tier. That was the
   * visible half of the defect.
   *
   * The half that matters more: `body` was captured before anything guaranteed
   * the segment had streamed, so on a PASSING route the `not.toContain` checks
   * for Tenant B could have been evaluated against a page whose main was still a
   * skeleton — an isolation proof that passed by looking at nothing. Polling
   * here, above the capture, closes both.
   *
   * `expect.poll` keeps the control's full strength: a genuinely blank main
   * still fails, at the configured expect timeout. Retries stay at 0 — the
   * config pins them there deliberately.
   */
  await expect
    .poll(async () => (await main.innerText()).trim().length, {
      message: `${route} never rendered past the loading skeleton`,
    })
    .toBeGreaterThan(40);

  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body, `${route} does not show the signed-in Tenant A account`).toContain(
    email.toLowerCase()
  );
  expect(body, `${route} rendered the error boundary`).not.toContain('something went wrong');
  expect(body, `${route} rendered the not-found boundary`).not.toContain('not found');

  return body;
}

/**
 * Every P1-27 screen, plus the administration screens this file already had.
 *
 * The CRM and vehicle routes were absent: all four routes named here were
 * `/en/administration/*`, so the phase under acceptance had no web-tier tenant
 * isolation evidence of any kind. These are the screens that read customer and
 * vehicle records — the ones where a cross-tenant read would matter most.
 */
const SCREENS = [
  '/en/administration/organization',
  '/en/administration/users',
  '/en/administration/roles',
  '/en/administration/audit-log',
  '/en/crm/customers',
  '/en/crm/customer-duplicates',
  '/en/crm/customers/new',
  '/en/vehicles',
  '/en/vehicles/duplicates',
  '/en/vehicles/new',
];

test.describe('cross-tenant isolation', () => {
  for (const route of SCREENS) {
    test(`Tenant B never appears on ${route}`, async ({ page }) => {
      const body = await renderedForTenantA(page, route);
      expect(body, `${route} must not disclose Tenant B`).not.toContain(
        TENANT_B_NAME.toLowerCase()
      );
      expect(body, `${route} must not disclose a Tenant B identifier`).not.toContain(TENANT_B);
      expect(body, `${route} must not name the Tenant B company`).not.toContain(
        'isolation company b'
      );
      expect(body, `${route} must not name the Tenant B branch`).not.toContain(
        'isolation branch b'
      );
    });
  }

  /*
   * Scope is resolved by the Backend from the bearer token on every request. A
   * query parameter is a request, not a decision — and each of these screens
   * reads a different module, so each is a separate attempt.
   */
  for (const [route, parameter] of [
    ['/en/administration/organization', `companyId=${COMPANY_B}`],
    ['/en/crm/customers', `companyId=${COMPANY_B}`],
    ['/en/vehicles', `branchId=${BRANCH_B}`],
    ['/en/crm/customer-duplicates', `tenantId=${TENANT_B}`],
  ] as const) {
    test(`a Tenant B identifier in the URL does not widen ${route}`, async ({ page }) => {
      const body = await renderedForTenantA(page, `${route}?${parameter}`);

      // The parameter reaches the server — this is a real attempt, not a no-op.
      expect(page.url(), 'the query parameter must actually have been sent').toContain(
        parameter.split('=')[1] as string
      );
      expect(body, 'Tenant B must not be named').not.toContain(TENANT_B_NAME.toLowerCase());
      expect(body, 'Tenant B company must not be named').not.toContain('isolation company b');
      expect(body, 'Tenant B branch must not be named').not.toContain('isolation branch b');
    });
  }

  test('the control itself can fail — a missing account marker is not tolerated', async ({
    page,
  }) => {
    /*
     * The positive control for the positive control.
     *
     * `renderedForTenantA` is the only thing standing between these cases and
     * the vacuous pass they used to be, so it must be demonstrably capable of
     * failing. Signed out, the same route redirects to the sign-in screen: the
     * shell and the account address are gone, and every `not.toContain`
     * assertion above would still hold on that page.
     */
    await page.context().clearCookies();
    await expect(renderedForTenantA(page, '/en/crm/customers')).rejects.toThrow();
  });

  test('the API refuses Tenant B records to a Tenant A bearer token', async ({ request }) => {
    // A REAL bearer token, obtained the way the web tier obtains one.
    //
    // The first version of this test drove the API through `page.request`,
    // assuming the browser's session cookie would authenticate it. It does not
    // and must not: the session cookie belongs to the WEB origin and is
    // `httpOnly` precisely so the browser never holds a bearer token. Every
    // probe therefore returned 401 for want of an Authorization header, and the
    // test passed while proving nothing about tenancy at all.
    //
    // That is the difference between "was refused" and "was refused BECAUSE it
    // belongs to another tenant", and only the second one is isolation.
    const token = await bearerForTenantA(request);

    const probes = [
      `${API}/api/v1/iam/users/${TENANT_B_USER}`,
      `${API}/api/v1/org/companies/${COMPANY_B}/settings`,
      `${API}/api/v1/org/branches/${BRANCH_B}/settings`,
    ];

    for (const url of probes) {
      const response = await request.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      expect(
        response.status(),
        `${url} must not return 200 to a token issued for another tenant`
      ).not.toBe(200);
      expect([401, 403, 404]).toContain(response.status());

      // A refusal must not describe what it is refusing.
      const text = await response.text();
      expect(text.toLowerCase(), 'a denial must not disclose the other tenant').not.toContain(
        TENANT_B_NAME.toLowerCase()
      );
      expect(text.toLowerCase(), 'a denial must not echo the other tenant id').not.toContain(
        TENANT_B.toLowerCase()
      );
    }
  });

  test('the same token reads Tenant A, so the denials above mean something', async ({
    request,
  }) => {
    // The control. Without it every assertion in this file would also pass
    // against an API that refuses absolutely everything.
    const token = await bearerForTenantA(request);

    const session = await request.get(`${API}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    });
    expect(session.status(), 'the Tenant A token must be able to read its own session').toBe(200);

    const own = await request.get(`${API}/api/v1/iam/users`, {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    });
    expect(own.status(), 'the Tenant A token must be able to list its own users').toBe(200);

    // The two modules this phase ships, so the control covers the surface the
    // screens above actually read. Without these, the CRM and vehicle screens
    // would be asserted against an API that had never been shown to answer them
    // at all — which is the same hole, one layer down.
    for (const path of ['/api/v1/customers?limit=1', '/api/v1/vehicles?limit=1']) {
      const response = await request.get(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      expect(response.status(), `the Tenant A token must be able to read ${path}`).toBe(200);
    }
  });

  test('no token at all is refused too', async ({ request }) => {
    const anonymous = await request.get(`${API}/api/v1/iam/users/${TENANT_B_USER}`, {
      failOnStatusCode: false,
    });
    expect(anonymous.status()).not.toBe(200);
  });
});
