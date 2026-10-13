import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { E2E_STORAGE_STATE } from '../origin';
import manifest from './account-manifest.json';

/**
 * WHICH account is signed in, and what that account is entitled to see.
 *
 * ## Why this file exists
 *
 * Two different credentials reach the P1-31 screens. The governed browser job signs
 * in as the acceptance owner; a local acceptance run overrides that with the first
 * administrator of the organisation the HTTP journey provisioned. They hold
 * different permission sets, so the two callers are entitled to see different
 * things — and the specs used to answer that by asserting "either the surface or a
 * complete refusal", which passes whichever way the screen answers and therefore
 * cannot fail for the reason the case exists.
 *
 * The replacement is: the suite KNOWS which credential is in front of it, looks up
 * what that credential holds, and pins the ONE outcome it is entitled to. A screen
 * that refuses a holder fails; a screen that serves a non-holder fails. Neither is
 * expressible in the shape this replaces.
 *
 * ## Where each half comes from
 *
 *   - the KIND is derived by `auth.setup.ts`, from the address it actually signed
 *     in with, and written to `account-kind.json` beside the storage state. Never
 *     read off the page, never read out of an environment variable a spec chose to
 *     trust, and never defaulted: an unrecognised address is a hard failure there.
 *   - the CODES come from `account-manifest.json`, generated from the two
 *     authorities by `scripts/dev/owner-acceptance/emit-account-manifest.mjs` and
 *     checked against them by `tests/ci/p1-31-account-manifest.test.ts`. Nothing is
 *     typed into this directory by hand, because a hand-written copy of a
 *     permission set is a copy that drifts.
 */

/** The two credentials this tier can be signed in as. */
export type AccountKind = 'owner-acceptance' | 'org-administrator';

export const ACCOUNT_KINDS: readonly AccountKind[] = ['owner-acceptance', 'org-administrator'];

/** How the credential was found, recorded so a run can be read back. */
export type AccountSource = 'environment' | 'p1-31-handoff' | 'owner-acceptance-file';

export interface SignedInAccount {
  readonly kind: AccountKind;
  readonly email: string;
  readonly source: AccountSource;
}

/**
 * Beside the storage state, and for the same reason it is there.
 *
 * `auth.setup.ts` writes both; every authenticated project depends on that setup, so
 * a spec that finds this file missing has been run outside the tier it belongs to,
 * which is a failure and not a state to accommodate.
 */
export const ACCOUNT_KIND_FILE = join(dirname(E2E_STORAGE_STATE), 'account-kind.json');

const CODES: Readonly<Record<AccountKind, readonly string[]>> = manifest;

/** True when the named credential kind holds the permission code. */
export function holds(kind: AccountKind, code: string): boolean {
  return CODES[kind].includes(code);
}

/** Every code the named credential kind holds. */
export function codesOf(kind: AccountKind): readonly string[] {
  return CODES[kind];
}

/** True when the value is one of the two kinds — the parse, written once. */
export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

/**
 * The account this run signed in as, or a hard failure.
 *
 * There is no default. A missing or unreadable file means the sign-in setup did not
 * run or could not name the account, and a spec that guessed a kind at that point
 * would assert the entitlements of an account nobody signed in as.
 */
export function readSignedInAccount(): SignedInAccount {
  if (!existsSync(ACCOUNT_KIND_FILE)) {
    throw new Error(
      `${ACCOUNT_KIND_FILE} is not there, so this suite cannot tell which account it is ` +
        'signed in as. It is written by authenticated/auth.setup.ts, which every ' +
        'authenticated project depends on; run the tier rather than the spec on its own.'
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(ACCOUNT_KIND_FILE, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${ACCOUNT_KIND_FILE} is not an object; this suite cannot read it`);
  }
  const record = parsed as { kind?: unknown; email?: unknown; source?: unknown };
  if (!isAccountKind(record.kind)) {
    throw new Error(
      `${ACCOUNT_KIND_FILE} names no known account kind, so no case here knows what the ` +
        'signed-in caller is entitled to see.'
    );
  }
  if (typeof record.email !== 'string' || record.email.length === 0) {
    throw new Error(`${ACCOUNT_KIND_FILE} names no address for the account it signed in as`);
  }
  const source = record.source;
  if (
    source !== 'environment' &&
    source !== 'p1-31-handoff' &&
    source !== 'owner-acceptance-file'
  ) {
    throw new Error(`${ACCOUNT_KIND_FILE} does not say where the credential came from`);
  }
  return { kind: record.kind, email: record.email, source };
}

/** The kind alone, for the many cases that need nothing else. */
export function readAccountKind(): AccountKind {
  return readSignedInAccount().kind;
}

/**
 * An address compared the way an identity provider compares one.
 *
 * Case and surrounding space are not part of an address, and the journey lowercases
 * the one it creates. Comparing raw strings would make a case difference read as a
 * different person, and the whole credential-kind derivation turns on this test.
 */
export function sameAddress(left: string | null | undefined, right: string | null | undefined) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
