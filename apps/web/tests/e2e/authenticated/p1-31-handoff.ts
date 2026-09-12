import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../origin';

/**
 * What the P1-31 acceptance harness hands the browser half, and how to read it.
 *
 * `scripts/dev/owner-acceptance/p1-31-journey.mjs` walks the whole delivery, warranty and
 * reporting chain over HTTP and then writes one JSON document naming the records it made.
 * The four `*-p1-31.spec.ts` files read it and walk the SCREENS over those same records.
 *
 * ## Why the specs read a file instead of building their own world
 *
 * The screens under acceptance answer for a work order that is complete, quality-passed,
 * invoiced, paid, closed, handed over and under warranty. Driving that chain through the
 * user interface would take a browser suite half an hour and would put the whole of the
 * platform's write surface inside a Frontend test. The harness establishes the world; the
 * browser proves the screens render it.
 *
 * ## Why the path comes from the environment
 *
 * `ROOTLCO_P131_HANDOFF`. The harness writes the document OUTSIDE the repository, because
 * it carries single-use credentials and an acceptance artefact inside the working tree is
 * one `git add -A` away from being committed. Nothing here has a default inside the repo.
 *
 * ## Why absence is a skip and not a failure
 *
 * These specs are committed, and the committed suite has to stay green on a checkout that
 * has never run an acceptance. So absence is a SKIP with the reason stated in the skip
 * message — never a silent pass, and never an assertion rewritten to be satisfiable
 * without the world it is about.
 */
export interface P131Handoff {
  readonly api: string;
  readonly login: { readonly email: string; readonly password: string };
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string | null;
  readonly deliveryId: string | null;
  readonly vehicleId: string | null;
  readonly warrantyId: string | null;
  readonly warrantyPolicyId: string | null;
  readonly invoiceId: string | null;
  readonly reportPeriod: { readonly from: string; readonly to: string } | null;
  readonly reportRuns: Readonly<
    Record<
      string,
      { readonly rows: number; readonly groups: number; readonly timezone: string | null }
    >
  > | null;
}

/** The environment variable the harness prints and these specs read. */
export const HANDOFF_ENV = 'ROOTLCO_P131_HANDOFF';

/**
 * The reason a skip states, written once so all four specs say the same thing.
 *
 * A skip whose message does not say what is missing is indistinguishable from a test
 * nobody finished writing, which is the failure mode the test-honesty rule exists for.
 */
export const NO_HANDOFF_REASON =
  `no P1-31 acceptance handoff: set ${HANDOFF_ENV} to the handoff.json that ` +
  'scripts/dev/owner-acceptance/p1-31-journey.mjs wrote. These cases assert on the records ' +
  'that run made, so without it there is nothing to assert and nothing is claimed.';

/** The handoff, or `null` when this checkout has not run an acceptance. */
export function readHandoff(): P131Handoff | null {
  const path = process.env[HANDOFF_ENV];
  if (path === undefined || path === '') return null;
  if (!existsSync(path)) return null;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return null;
  const handoff = parsed as P131Handoff;
  if (typeof handoff.companyId !== 'string' || typeof handoff.branchId !== 'string') return null;
  return handoff;
}

/** The locale a project drives, from its name. The same rule `administration.spec.ts` uses. */
export function localeOf(projectName: string): 'en' | 'ar' {
  return projectName.endsWith('-ar') ? 'ar' : 'en';
}

/**
 * The message catalogues the running application renders from.
 *
 * Read rather than quoted, for the reason `appointments-and-receptions.spec.ts` states: an
 * English sentence typed into a spec is a second statement of a fact the catalogue owns,
 * and a copy edit to the product would make the spec assert text no screen shows.
 */
const MESSAGES: Record<'en' | 'ar', Record<string, string>> = {
  en: JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps', 'web', 'src', 'i18n', 'messages', 'en.json'), 'utf8')
  ) as Record<string, string>,
  ar: JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps', 'web', 'src', 'i18n', 'messages', 'ar.json'), 'utf8')
  ) as Record<string, string>,
};

/**
 * One catalogue entry, or a hard failure.
 *
 * `translate()` is `messages[key] ?? key`, so a missing key would silently turn an
 * assertion into one that passes only when the screen is BROKEN. Failing here means a
 * renamed key breaks the suite loudly, at the line that names it.
 */
export function say(locale: 'en' | 'ar', key: string): string {
  const value = MESSAGES[locale][key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${locale}.json has no entry for "${key}"; this suite cannot assert on it`);
  }
  return value;
}

/** True when the catalogue has the key at all — for a key a merge may not have landed. */
export function hasMessage(locale: 'en' | 'ar', key: string): boolean {
  const value = MESSAGES[locale][key];
  return typeof value === 'string' && value.length > 0;
}

/**
 * The reasons `test.skip` may state, other than an absent handoff.
 *
 * Each names a record the harness did not make. A screen that cannot be reached because
 * the world behind it does not exist is not a screen that failed, and saying so is the
 * honest answer; saying nothing would be a green tick over an unmeasured surface.
 */
export function missingReason(what: string): string {
  return (
    `the P1-31 handoff names no ${what}, so this case has nothing to open. The HTTP ` +
    'journey records why; this browser case asserts nothing rather than asserting something ' +
    'weaker.'
  );
}
