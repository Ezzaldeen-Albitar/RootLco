import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

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

const API = process.env.ROOTLCO_API_BASE_URL ?? 'http://127.0.0.1:3000';
const HANDOFF = join(resolve(process.cwd(), '..', '..'), '.local', 'owner-acceptance-account.json');

/** Signs in as the Tenant A owner and returns a real bearer token. */
async function bearerForTenantA(request: APIRequestContext): Promise<string> {
  const fromEnv = {
    tenantId: process.env.ROOTLCO_E2E_TENANT_ID,
    email: process.env.ROOTLCO_E2E_EMAIL,
    password: process.env.ROOTLCO_E2E_PASSWORD,
  };
  const credentials =
    fromEnv.tenantId && fromEnv.email && fromEnv.password
      ? fromEnv
      : (() => {
          if (!existsSync(HANDOFF)) {
            throw new Error('No credentials. Run: npm run acceptance:create-owner');
          }
          const handoff = JSON.parse(readFileSync(HANDOFF, 'utf8'));
          return {
            tenantId: handoff.tenantId,
            email: handoff.login.email,
            password: handoff.login.password,
          };
        })();

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

test.describe('cross-tenant isolation', () => {
  test('Tenant B never appears in any Tenant A screen', async ({ page }) => {
    const routes = [
      '/en/administration/organization',
      '/en/administration/users',
      '/en/administration/roles',
      '/en/administration/audit-log',
    ];
    for (const route of routes) {
      await page.goto(route);
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(body, `${route} must not disclose Tenant B`).not.toContain(
        TENANT_B_NAME.toLowerCase()
      );
      expect(body, `${route} must not disclose a Tenant B identifier`).not.toContain(TENANT_B);
    }
  });

  test('a Tenant B identifier in the URL does not widen the session', async ({ page }) => {
    // Scope is resolved by the Backend from the bearer token on every request.
    // A query parameter is a request, not a decision.
    await page.goto(`/en/administration/organization?companyId=${COMPANY_B}`);
    const body = (await page.locator('body').innerText()).toLowerCase();

    // The parameter reaches the server — this is a real attempt, not a
    // no-op — and none of Tenant B's content comes back.
    expect(page.url(), 'the query parameter must actually have been sent').toContain(COMPANY_B);
    expect(body, 'Tenant B must not be named').not.toContain(TENANT_B_NAME.toLowerCase());
    expect(body, 'Tenant B company must not be named').not.toContain('isolation company b');
    expect(body, 'Tenant B branch must not be named').not.toContain('isolation branch b');
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
  });

  test('no token at all is refused too', async ({ request }) => {
    const anonymous = await request.get(`${API}/api/v1/iam/users/${TENANT_B_USER}`, {
      failOnStatusCode: false,
    });
    expect(anonymous.status()).not.toBe(200);
  });
});
