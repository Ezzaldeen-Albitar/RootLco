import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../origin';
import { readSignedInAccount, sameAddress } from './account-manifest';

/**
 * What the P1-31 acceptance harness hands the browser half, and how to read it.
 *
 * `orchestration/acceptance/p1-31-journey.mjs` — held OUTSIDE this repository, for the
 * reason §1.7 of the acceptance plan gives — walks the whole delivery, warranty and
 * reporting chain over HTTP and then writes one JSON document naming the records it made.
 * The six `*-p1-31.spec.ts` files read it and walk the SCREENS over those same records.
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
/** One report domain's figures, as the harness read them from the server. */
export interface P131ReportFigures {
  readonly rows: number;
  readonly groups: number;
  readonly timezone: string | null;
}

/**
 * Who provides one report, and what the catalogue calls it.
 *
 * `source` is the operation's own word: `platform` for a code-registered baseline,
 * `tenant` for a configuration a workshop published. A baseline is titled by
 * `titleKey` and shown in the reader's language; a workshop's row carries the
 * operator's own `name` and is shown as written, in both locales, because
 * translating somebody's own label is inventing one.
 *
 * It is published by the harness so a browser case can pin the exact string the
 * catalogue must render. Reading the provenance off the page instead — counting the
 * origin cell and branching on what it said — let the screen answer a question about
 * itself: a catalogue that reported every row as the platform's would simply have
 * taken the other branch.
 */
export interface P131ReportProvenance {
  readonly source: string | null;
  readonly titleKey: string | null;
  readonly name: string | null;
  readonly executable: boolean;
}

/** One overview section's figures — the same run, at the overview's own page size. */
export interface P131OverviewFigures {
  readonly rows: number;
  readonly groups: number;
  readonly groupsPublished: boolean;
  readonly timezone: string | null;
  readonly freshness: string | null;
}

/**
 * What the harness recorded for FE-010 and FE-016.
 *
 * `generic` is the reading an operator gets by naming a company and a branch on the
 * overview's own form; `branchFixed` is the reading `?branchId=` produces. The
 * harness takes both and records a step asserting they agree, because "the same
 * overview for the selected branch" is exactly the claim FE-016 makes.
 */
export interface P131Overview {
  readonly period: { readonly from: string; readonly to: string };
  readonly limit: number;
  readonly directory: {
    readonly companies: number;
    readonly branches: number;
    readonly branchResolved: boolean;
  };
  readonly generic: Readonly<Record<string, P131OverviewFigures>>;
  readonly branchFixed: Readonly<Record<string, P131OverviewFigures>>;
}

/** One checklist template item the browser fixtures reserve for a case. */
export interface P131FixtureItem {
  readonly id: string;
  readonly itemCode: string;
  readonly label: string | null;
}

/**
 * One handover the harness left mid-flight for a browser case that WRITES.
 *
 * `unansweredItem` is the mandatory checklist item that case is expected to answer
 * through the interface, and it is `null` on a fixture where every item is already
 * answered.
 *
 * `startOdometer` is `null` for every fixture: the harness builds a bare vehicle
 * and records no reading against it, and it asserts that emptiness rather than
 * assuming it. That is what makes `finalOdometerValue` safe to publish
 * unconditionally — `guard_odometer_reading` refuses a normal reading below the
 * vehicle's current one, so a value chosen above an unknown reading would fail a
 * case for a reason that is not about the product.
 */
export interface P131FixtureDelivery {
  readonly deliveryId: string;
  readonly workOrderId: string;
  readonly vehicleId: string;
  readonly receptionVisitId: string;
  readonly customerId: string;
  readonly unansweredItem: P131FixtureItem | null;
  readonly blockers: readonly string[] | null;
  readonly recordVersion: number | null;
  readonly startOdometer: string | null;
  readonly finalOdometerValue: string | null;
}

/**
 * The records the three delivery WRITE cases act on, one set per PROJECT that runs them.
 *
 * ## Why one set per project, and one handover per act
 *
 * `apps/web/playwright.config.ts` pins `workers: 1`, and `authenticated-en`,
 * `authenticated-ar` and `authenticated-tablet` run in that order over the same
 * database. A case that records a checklist result CONSUMES the gap it acted on, so a
 * shared fixture would be spent by whichever project ran first and the next would
 * assert on a record that no longer looks the way its case describes.
 *
 * So the sets are keyed by FIXTURE KEY, not by locale: `'en'`, `'ar'` and `'tablet'`.
 * The tablet project renders in English and asserts English text, and it still needs
 * its own records — `fixtureKeyOf` is where those two facts are separated.
 *
 * Each handover carries exactly ONE gap, which is what lets its case prove the gap
 * closing:
 *
 *   - `checklist` — signed, receiver verified, one mandatory item unanswered. The
 *     release control is disabled while that item stands and enabled once it is
 *     answered, and neither is true unless the checklist reason is the only
 *     non-overridable one left.
 *   - `signature` — every item answered, receiver verified, no signature.
 *   - `release` — answered and signed, so the only reason left is the financial
 *     one: the single blocker the delivery domain declares overridable, which is
 *     what puts the release control within reach of the odometer case.
 *
 * The harness reads each handover's eligibility and refuses to finish the run if one
 * carries any other reason, so a fixture that reaches a spec is one its case can act
 * on.
 */
export interface P131BrowserFixtures {
  readonly template: {
    readonly id: string;
    readonly templateCode: string;
    readonly mandatory: Readonly<Record<string, P131FixtureItem>>;
    readonly optional: P131FixtureItem | null;
  };
  /** A decodable 1x1 PNG, base64. The bytes the harness itself puts on file. */
  readonly signaturePngBase64: string;
  readonly companyId: string;
  readonly branchId: string | null;
  readonly checklist: Readonly<Record<string, P131FixtureDelivery>>;
  readonly signature: Readonly<Record<string, P131FixtureDelivery>>;
  readonly release: Readonly<Record<string, P131FixtureDelivery>>;
}

/**
 * One transition of the warranty ledger, as the harness read it back over HTTP.
 *
 * The identifier, the actor and the stamp are deliberately NOT carried. A browser case
 * comparing a rendered timestamp against one the harness recorded would be asserting on
 * the reader's locale formatting rather than on the ledger, and an actor reference the
 * spec pinned would make the case fail the day the journey signs in as somebody else.
 * What is pinned is what the panel is FOR: how many transitions there are, and what each
 * one moved from and to.
 */
export interface P131WarrantyTransition {
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
}

/**
 * FE-009 — one page of the warranty's transition ledger, at the observation point.
 *
 * Expected to hold exactly ONE row today, the genesis `null -> issued` that
 * `wty.issue_warranty` writes with the record, because nothing in this phase advances a
 * warranty's state. The count is published rather than assumed so the browser case
 * asserts against what the server actually answered: a spec that hard-coded "one row"
 * would keep passing on the day a writer lands and the screen silently dropped the rest.
 */
export interface P131WarrantyHistory {
  readonly items: readonly P131WarrantyTransition[];
  readonly hasMore: boolean;
}

/** A ledger prerequisite that ran and failed; acceptance must fail, not skip. */
export interface P131WarrantyHistoryFailure {
  readonly status: 'failed';
  readonly faults: readonly string[];
}

export interface P131Handoff {
  readonly api: string;
  readonly login: { readonly email: string; readonly password: string };
  /**
   * WHO the login is. Written by the harness, which knows: the account it created
   * is the first administrator of the organisation it provisioned, and holds the
   * whole tenant-administrator bundle. `auth.setup.ts` derives the same fact from
   * the address it signed in with; this field is what that derivation is checked
   * against.
   */
  readonly account?: { readonly kind: string; readonly email: string };
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string | null;
  readonly deliveryId: string | null;
  readonly vehicleId: string | null;
  readonly warrantyId: string | null;
  /**
   * The transition ledger of `warrantyId`, read through `wty.warranty-status-history`.
   *
   * Optional, because a handoff written before the harness published this step is a
   * handoff from a run that recorded no ledger — and the case that reads it must skip
   * with that stated rather than assert against a field that is not there.
   */
  readonly warrantyHistory?: P131WarrantyHistory | P131WarrantyHistoryFailure | null;
  readonly warrantyPolicyId: string | null;
  readonly invoiceId: string | null;
  readonly reportPeriod: { readonly from: string; readonly to: string } | null;
  /**
   * The four datasets, READ AFTER THE LAST WRITE OF THE JOURNEY.
   *
   * The harness runs the reports twice: once in its own section 13, where the figure
   * belongs to the record's narrative, and once at the very end, which is the figure
   * published here. The two differ, and the difference is not noise — section 15
   * opens a second work order and a second delivery in the same branch, section 15b
   * opens six more for the write cases below, and `work_orders_by_status` counts
   * every non-deleted work order opened in the period with no state filter. Both
   * sections are INSIDE what the final pass observes, which is why the figures here
   * still describe the world a browser opens. A case comparing a screen against the
   * mid-journey figure asserts a world that no longer exists.
   */
  readonly reportRuns: Readonly<Record<string, P131ReportFigures>> | null;
  /** The catalogue's own answer for each dataset, at the same observation point. */
  readonly reportProvenance: Readonly<Record<string, P131ReportProvenance>> | null;
  /** FE-010 and FE-016, read at the same observation point. */
  readonly overview: P131Overview | null;
  /**
   * The mid-flight handovers the WRITE cases act on, or absent.
   *
   * Optional because a handoff written by an earlier harness carries none, and a
   * case that finds none must say so and assert nothing rather than invent a
   * record to act on.
   */
  readonly browserFixtures?: P131BrowserFixtures | null;
}

/** The environment variable the harness prints and these specs read. */
export const HANDOFF_ENV = 'ROOTLCO_P131_HANDOFF';

/**
 * The reason a skip states, written once so all six specs say the same thing.
 *
 * A skip whose message does not say what is missing is indistinguishable from a test
 * nobody finished writing, which is the failure mode the test-honesty rule exists for.
 */
export const NO_HANDOFF_REASON =
  `no P1-31 acceptance handoff: set ${HANDOFF_ENV} to the handoff.json that ` +
  'orchestration/acceptance/p1-31-journey.mjs wrote. These cases assert on the records ' +
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

/**
 * The handoff's own login, validated, or nothing.
 *
 * `readHandoff` proves the document names a company and a branch; this proves it
 * names a usable credential. Both `auth.setup.ts` — which may sign in with it — and
 * every case that has to decide whether the signed-in account IS that credential go
 * through this one reader, so the two can never disagree about what the file says.
 */
export function handoffLogin(): { readonly email: string; readonly password: string } | null {
  const handoff = readHandoff();
  if (handoff === null) return null;
  const login: unknown = handoff.login;
  if (typeof login !== 'object' || login === null) return null;
  const { email, password } = login as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || email.length === 0) return null;
  if (typeof password !== 'string' || password.length === 0) return null;
  return { email, password };
}

/**
 * The reason a case states when the handoff exists but somebody else is signed in.
 *
 * A case that asserts on the journey's own records needs the journey's own
 * administrator in the browser: the acceptance owner holds neither `rpt.report.read`
 * nor `wty.policy.manage`, and is a member of a different organisation entirely, so
 * the records simply are not theirs to see. Asserting a refusal instead would be a
 * different case wearing this one's name.
 */
export const WRONG_ACCOUNT_REASON =
  'this case asserts on the records the P1-31 journey made, and they belong to the ' +
  'organisation administrator that run created. The browser is signed in as a different ' +
  'account, so there is nothing here for it to see and nothing is claimed.';

/**
 * True when the browser is signed in as the very account the journey's records
 * belong to.
 *
 * BOTH halves are required, and neither implies the other. The kind says what the
 * caller may see; the address says whose organisation they are in. A second local
 * organisation administrator would satisfy the first and none of the records — and
 * would then fail every gated case on a truth about the fixture rather than about
 * the product.
 */
export function signedInAsJourneyAdministrator(): boolean {
  const login = handoffLogin();
  if (login === null) return false;
  const account = readSignedInAccount();
  return account.kind === 'org-administrator' && sameAddress(login.email, account.email);
}

/**
 * The three fixture handovers under one fixture KEY, or `null` when this handoff has
 * none. `fixtureKeyOf` below is what a case reads the key with; the key is a locale
 * for the two locale projects and `'tablet'` for the tablet one, which is why the
 * parameter is a plain string rather than the locale union — the three maps on
 * `P131BrowserFixtures` have always been string-keyed, and an unknown key answers
 * `null` here exactly as a missing one always did.
 *
 * Validated here rather than at three call sites: a fixture document that names no
 * delivery is not a fixture, and a case that read one field and trusted the rest
 * would fail deep inside an interaction with a message about a missing element
 * instead of about a missing record.
 */
export function browserFixtures(
  handoff: P131Handoff | null,
  key: string
): {
  readonly checklist: P131FixtureDelivery;
  readonly signature: P131FixtureDelivery;
  readonly release: P131FixtureDelivery;
  readonly signaturePngBase64: string;
} | null {
  const fixtures = handoff?.browserFixtures;
  if (fixtures === undefined || fixtures === null) return null;
  const checklist = fixtures.checklist[key];
  const signature = fixtures.signature[key];
  const release = fixtures.release[key];
  if (checklist === undefined || signature === undefined || release === undefined) return null;
  for (const fixture of [checklist, signature, release]) {
    if (typeof fixture.deliveryId !== 'string' || fixture.deliveryId.length === 0) return null;
  }
  if (typeof fixtures.signaturePngBase64 !== 'string' || fixtures.signaturePngBase64.length === 0) {
    return null;
  }
  return { checklist, signature, release, signaturePngBase64: fixtures.signaturePngBase64 };
}

/** The locale a project drives, from its name. The same rule `administration.spec.ts` uses. */
export function localeOf(projectName: string): 'en' | 'ar' {
  return projectName.endsWith('-ar') ? 'ar' : 'en';
}

/**
 * WHICH FIXTURE SET a project consumes, from its name — a different question from
 * which locale it renders in, and the reason both functions exist.
 *
 * `authenticated-tablet` renders in English, so `localeOf` answers `'en'` for it and
 * every text assertion is right to ask that. But the handover fixtures are SINGLE
 * USE: a mandatory checklist item cannot be answered twice, a vehicle cannot be
 * released twice. `playwright.config.ts` pins `workers: 1` and runs the projects in
 * order, so by the time the tablet project reaches a write case, the `'en'` set is
 * already spent by `authenticated-en` and the case would act on a handover that no
 * longer carries the gap it was built with.
 *
 * So the harness publishes a THIRD set under the key `'tablet'`, and this is the
 * function that picks it. Content locale is decided by the locale suffix; fixture
 * identity is decided by the PROJECT, because the project is what consumes.
 *
 * Stated as a suffix rule rather than a list of project names for the reason
 * `localeOf` is: a new tablet project would be `<something>-tablet` and would need
 * its own set on the same argument, and a name this rule does not recognise falls
 * back to its content locale, which is the behaviour every read-only case wants.
 */
export function fixtureKeyOf(projectName: string): string {
  return projectName.endsWith('-tablet') ? 'tablet' : localeOf(projectName);
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
