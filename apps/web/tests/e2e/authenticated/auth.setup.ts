import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { E2E_STORAGE_STATE, REPO_ROOT } from '../origin';
import {
  ACCOUNT_KIND_FILE,
  sameAddress,
  type AccountKind,
  type AccountSource,
} from './account-manifest';
import { handoffLogin } from './p1-31-handoff';

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

/** The address the bootstrap wrote, or nothing when this checkout has no such account. */
function ownerAcceptanceLogin(): { email: string; password: string } | null {
  if (!existsSync(HANDOFF)) return null;
  const parsed: unknown = JSON.parse(readFileSync(HANDOFF, 'utf8'));
  const login = (parsed as { login?: { email?: unknown; password?: unknown } }).login;
  if (typeof login?.email !== 'string' || typeof login.password !== 'string') return null;
  return { email: login.email, password: login.password };
}

/**
 * Credentials come from the environment, from the P1-31 acceptance handoff, or from
 * the bootstrap's own account file — in that order. Never from a literal: a password
 * in a tracked file fails the tracked-secret scan, and it fails it permanently
 * because the scan also runs over history.
 *
 * ## Why the environment stays FIRST
 *
 * CC-44 documents `ROOTLCO_E2E_EMAIL` / `ROOTLCO_E2E_PASSWORD` as the operator's
 * deliberate override. An override that a second source could displace is not one.
 *
 * ## Why the acceptance handoff was added, and where
 *
 * A local P1-31 acceptance run used to be driven by exporting the journey's
 * credentials into those two variables by hand, which is an undocumented step the
 * run either remembered or silently did without — and doing without it meant the
 * browser half signed in as the acceptance owner while the specs asserted on records
 * only the journey's organisation administrator can see. Reading
 * `ROOTLCO_P131_HANDOFF` here removes the step. It sits BELOW the environment and
 * ABOVE the bootstrap account, so an operator can still override it and a checkout
 * that has never run an acceptance is unaffected.
 */
function credentials(): { email: string; password: string; source: AccountSource } {
  const fromEnv = {
    email: process.env.ROOTLCO_E2E_EMAIL,
    password: process.env.ROOTLCO_E2E_PASSWORD,
  };
  if (fromEnv.email && fromEnv.password) {
    return { email: fromEnv.email, password: fromEnv.password, source: 'environment' };
  }

  const journey = handoffLogin();
  if (journey !== null) {
    return { email: journey.email, password: journey.password, source: 'p1-31-handoff' };
  }

  const bootstrap = ownerAcceptanceLogin();
  if (bootstrap === null) {
    throw new Error(
      'No credentials. Set ROOTLCO_E2E_EMAIL / ROOTLCO_E2E_PASSWORD, point ' +
        'ROOTLCO_P131_HANDOFF at an acceptance handoff, or run: npm run acceptance:create-owner'
    );
  }
  return { ...bootstrap, source: 'owner-acceptance-file' };
}

/**
 * WHICH of the two accounts just signed in, decided by the address and nothing else.
 *
 * The two credential kinds hold different permission sets, and every rewritten P1-31
 * case pins the one outcome the signed-in kind is entitled to. So the kind has to be
 * a FACT about this run rather than a guess, and the only fact available is the
 * address the sign-in actually used: it is matched against the address in the
 * acceptance handoff and against the address in the bootstrap's account file.
 *
 * An address that is neither is a HARD FAILURE. There is no default kind, and there
 * could not be a safe one — defaulting to the acceptance owner would make every case
 * assert refusals against a caller who may hold everything, and defaulting the other
 * way would assert surfaces against a caller who holds almost nothing. Both would be
 * green suites over unexamined screens, which is the failure mode this whole change
 * exists to end.
 */
function deriveAccountKind(email: string): AccountKind {
  const journey = handoffLogin();
  if (journey !== null && sameAddress(journey.email, email)) return 'org-administrator';

  const bootstrap = ownerAcceptanceLogin();
  if (bootstrap !== null && sameAddress(bootstrap.email, email)) return 'owner-acceptance';

  throw new Error(
    `signed in as an address this suite cannot place: it is neither the P1-31 acceptance ` +
      "handoff's login nor the account npm run acceptance:create-owner wrote. Every P1-31 " +
      'case pins the outcome the signed-in account is entitled to, so an unplaceable ' +
      'account is refused here rather than guessed at.'
  );
}

setup('sign in and persist the session', async ({ page, context }) => {
  // No tenant. The suite signs in exactly the way an operator does, which is the
  // only way this test can notice if the Workspace field ever comes back.
  const { email, password, source } = credentials();

  await page.goto('/en/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Workspace identifier')).toHaveCount(0);

  await page.getByLabel('Email address').fill(email);
  // By ROLE and exact name. `getByLabel` matches an accessible name as a
  // substring, and the reveal control inside the field is named "Show password"
  // — which contains "Password", so the loose locator resolves to two elements
  // and strict mode refuses to guess. Role is what separates a textbox named
  // "Password" from a button named "Show password", and it is also what a
  // screen reader announces.
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
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

  /*
   * The account, named beside the session it belongs to.
   *
   * Derived AFTER the sign-in succeeded, so what is recorded is the account that
   * really reached the dashboard rather than the one this file intended to use. It
   * carries no password — only the address, which every audit row already carries,
   * and the two facts a spec needs: which kind it is and where the credential came
   * from.
   */
  const kind = deriveAccountKind(email);
  writeFileSync(ACCOUNT_KIND_FILE, `${JSON.stringify({ kind, email, source }, null, 2)}\n`, 'utf8');
});
