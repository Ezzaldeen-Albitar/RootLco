import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { E2E_STORAGE_STATE, REPO_ROOT } from '../origin';

/**
 * Signs in through the real user interface and keeps the session.
 *
 * Deliberately a UI sign-in rather than an API call plus a hand-built cookie.
 * The session is an `httpOnly` cookie set by a Server Action, so driving the
 * actual form is both the simplest route and the strongest evidence: it proves
 * the form, the action, the API contract, the cookie attributes and the
 * post-login redirect all agree. A hand-built cookie would prove only that this
 * file can build a cookie.
 *
 * `context.storageState()` captures `httpOnly` cookies, which is what makes the
 * remaining specs able to start already signed in.
 */

// The path this writes and the path the projects read must be the same string.
// It is stated once, in `tests/e2e/origin.ts`, and imported by both.
const STATE = E2E_STORAGE_STATE;
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');

/**
 * Credentials come from the environment, or from the bootstrap's own handoff
 * file. Never from a literal: a password in a tracked file fails the
 * tracked-secret scan, and it fails it permanently because the scan also runs
 * over history.
 */
function credentials() {
  const fromEnv = {
    tenantId: process.env.ROOTLCO_E2E_TENANT_ID,
    email: process.env.ROOTLCO_E2E_EMAIL,
    password: process.env.ROOTLCO_E2E_PASSWORD,
  };
  if (fromEnv.tenantId && fromEnv.email && fromEnv.password) return fromEnv;

  if (!existsSync(HANDOFF)) {
    throw new Error(
      'No credentials. Set ROOTLCO_E2E_TENANT_ID / ROOTLCO_E2E_EMAIL / ROOTLCO_E2E_PASSWORD, ' +
        'or run: npm run acceptance:create-owner'
    );
  }
  const handoff = JSON.parse(readFileSync(HANDOFF, 'utf8'));
  return {
    tenantId: handoff.tenantId,
    email: handoff.login.email,
    password: handoff.login.password,
  };
}

setup('sign in and persist the session', async ({ page, context }) => {
  const { tenantId, email, password } = credentials();

  await page.goto('/en/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Workspace identifier').fill(tenantId);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The dashboard is `/en`; the sidebar landmark is what `foundation.spec.ts`
  // asserts is ABSENT when signed out, so the two suites are complements.
  await page.waitForURL(/\/en(\?.*)?$/, { timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'rootlco.session');
  expect(
    session,
    'no rootlco.session cookie was stored. If the build was produced without ' +
      'apps/web/.env.local, NEXT_PUBLIC_APP_ENV defaults to production and the cookie is ' +
      'marked Secure — which a plain-HTTP localhost silently discards. Rebuild with the ' +
      'env file present.'
  ).toBeTruthy();

  // The attributes that make the session unreadable by page script. Asserted
  // here because this is the only place a real one exists.
  expect(session?.httpOnly, 'the session cookie must be httpOnly').toBe(true);
  expect(session?.sameSite, 'the session cookie must be SameSite=Lax').toBe('Lax');
  expect(session?.secure, 'a plain-HTTP local run must not mark the cookie Secure').toBe(false);

  mkdirSync(dirname(STATE), { recursive: true });
  await context.storageState({ path: STATE });
});
