/**
 * Shared context for the local Owner-acceptance tooling.
 *
 * Everything in this directory exists so the Product Owner can sign in to a
 * running local system and inspect what P1-26 delivered. None of it ships, none
 * of it runs in CI, and none of it can be pointed at anything but a loopback
 * development database.
 *
 * ## Why the guards are three independent conditions
 *
 * A single environment variable is one typo away from being wrong. These
 * scripts write to `org.tenants` and to the GoTrue admin API as the database
 * owner, which is exactly the capability that must never reach a real
 * deployment. So the target has to prove it is local three separate ways —
 * an explicit opt-in value, a loopback database, and a loopback identity
 * provider — and any one of them failing refuses the whole run.
 *
 * ## Why the connection is built as an object
 *
 * `scripts/check-tracked-secrets.mjs` matches a database connection URL that
 * carries an inline password, and `scripts/ci/scan-history.mjs` re-checks the
 * same pattern over the entire history — a credential committed once fails for
 * ever. Building the client config field by field means that string never
 * exists.
 *
 * This paragraph originally quoted the offending shape verbatim, and the scan
 * duly failed on the sentence explaining why it must not appear. Third time in
 * this phase that a rule was broken inside the file that states it; the lesson
 * keeps being the same one, so it is written down again here.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  collectSources,
  consultedPermissions,
  permissionConstants,
  phaseRoutes,
} from '../../ci/check-p1-28-access.mjs';

/**
 * How everything here refuses.
 *
 * Declared before the first constant rather than beside the guard functions,
 * because `P1_28_SCREEN_PERMISSIONS` is derived at module evaluation and throws
 * one of these when the derivation comes back short. A class is hoisted but not
 * initialised, so a declaration further down this file would be in its temporal
 * dead zone at exactly the moment the failure needed reporting.
 */
export class GuardFailure extends Error {}

function refuse(message) {
  throw new GuardFailure(message);
}

/** The one value that opts a run in. Anything else refuses. */
export const REQUIRED_ENVIRONMENT = 'local-acceptance';

/** The Supabase local database port, from `supabase/config.toml`. */
export const LOCAL_DB_PORT = 54322;

/** Hosts that count as this machine. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * The platform-system actor the seeds themselves use.
 *
 * `created_by` and `granted_by` carry no foreign key to `iam.user_accounts`,
 * so this is a legal author for rows that predate any real operator — which is
 * what a bootstrap is.
 */
export const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

/**
 * Deterministic identifiers, so every run reconciles instead of duplicating.
 *
 * The `c…` prefix is deliberate and load-bearing. `tests/db/helpers.ts` owns
 * `aaaaaaaa-…` and `bbbbbbbb-…` and deletes exactly those in `cleanFixtures`,
 * which `npm run test:db` and `npm run test:backend` both call. Reusing them
 * would let a routine test run delete the Owner's account halfway through an
 * acceptance session.
 */
export const IDS = Object.freeze({
  tenantA: 'c0000000-0000-4000-8000-00000000000a',
  tenantB: 'c0000000-0000-4000-8000-00000000000b',
  tenantC: 'c0000000-0000-4000-8000-00000000000c',
  companyA: 'c1000000-0000-4000-8000-00000000000a',
  companyB: 'c1000000-0000-4000-8000-00000000000b',
  companyC: 'c1000000-0000-4000-8000-00000000000c',
  branchA: 'c1100000-0000-4000-8000-00000000000a',
  branchB: 'c1100000-0000-4000-8000-00000000000b',
  branchC: 'c1100000-0000-4000-8000-00000000000c',
  ownerUser: 'c2000000-0000-4000-8000-00000000000a',
  readerUser: 'c2000000-0000-4000-8000-00000000000b',
  invitedUser: 'c2000000-0000-4000-8000-00000000000c',
  lockedUser: 'c2000000-0000-4000-8000-00000000000d',
  tenantBUser: 'c2000000-0000-4000-8000-00000000000e',
  configuredUser: 'c2000000-0000-4000-8000-00000000000f',
  adminRoleA: 'c3000000-0000-4000-8000-00000000000a',
  readerRoleA: 'c3000000-0000-4000-8000-00000000000b',
  adminRoleB: 'c3000000-0000-4000-8000-00000000000c',
  adminRoleC: 'c3000000-0000-4000-8000-00000000000d',
});

/** Codes and display names. Every code matches `^[a-z][a-z0-9_]{1,62}$`. */
export const NAMES = Object.freeze({
  tenantCodeA: 'acceptance_a',
  tenantCodeB: 'acceptance_b',
  tenantCodeC: 'acceptance_c',
  tenantNameA: 'CRM Owner Acceptance Tenant',
  tenantNameB: 'CRM Isolation Tenant B',
  tenantNameC: 'CRM Configured Acceptance Tenant',
  companyCodeA: 'acceptance_co_a',
  companyCodeB: 'acceptance_co_b',
  companyCodeC: 'acceptance_co_c',
  companyNameA: 'CRM Owner Acceptance Company',
  companyNameB: 'CRM Isolation Company B',
  companyNameC: 'CRM Configured Acceptance Company',
  branchCode: 'main',
  branchNameA: 'Main Acceptance Branch',
  branchNameB: 'Isolation Branch B',
  branchNameC: 'Configured Acceptance Branch',
  adminRoleCode: 'acceptance_administrator',
  adminRoleName: 'Owner Acceptance Administrator',
  readerRoleCode: 'acceptance_reader',
  readerRoleName: 'Acceptance Reader',
  ownerEmail: 'owner.acceptance@crm.local',
  ownerDisplayName: 'CRM Owner Acceptance',
  readerEmail: 'reader.acceptance@crm.local',
  readerDisplayName: 'Acceptance Reader Operator',
  invitedEmail: 'invited.acceptance@crm.local',
  invitedDisplayName: 'Acceptance Invited Operator',
  lockedEmail: 'locked.acceptance@crm.local',
  lockedDisplayName: 'Acceptance Locked Operator',
  tenantBEmail: 'operator.tenantb@crm.local',
  tenantBDisplayName: 'Isolation Tenant B Operator',
  configuredEmail: 'operator.configured@crm.local',
  configuredDisplayName: 'Configured Acceptance Operator',
});

/**
 * The complete permission set the eleven Administration screens gate on.
 *
 * Mirrors `apps/web/src/features/administration/shared/permissions.ts`.
 * `iam.user.read` is not optional: `GET /api/v1/auth/session` declares it, and
 * without it every screen renders as though the caller were signed out.
 */
export const ADMIN_PERMISSIONS = Object.freeze([
  'iam.user.read',
  'iam.user.manage',
  'iam.role.read',
  'iam.role.manage',
  'iam.grant.manage',
  'iam.approval.manage',
  'iam.audit.view',
  'iam.session.view_all',
  'iam.sensitive.view',
  'org.tenant.read',
  'org.company.read',
  'org.branch.read',
  'org.settings.manage',
  'org.tax.manage',
]);

/**
 * What the P1-27 CRM and Vehicle screens gate on — `P1-27-FE-001` … `FE-029`.
 *
 * Added because the Owner-acceptance account held **only** the fourteen
 * Administration codes above, so the Owner could sign in, reach the sidebar, and
 * find that every CRM and Vehicle screen rendered "you do not have permission".
 * The screens were correct; the account could not exercise one of them. An
 * acceptance environment that cannot reach the phase under acceptance is not an
 * acceptance environment.
 *
 * Mirrors `apps/web/src/features/crm/permissions.ts`, which was read out of the
 * route registrations. Every code here is one a P1-27 screen actually checks —
 * not a convenient superset, because a superset would hide a screen that gates
 * on the wrong code.
 */
export const CRM_VEHICLE_PERMISSIONS = Object.freeze([
  // CRM: one read code fans out to eight distinct write codes.
  'crm.customer.read',
  'crm.customer.create',
  'crm.customer.profile.write',
  'crm.customer.consent.write',
  'crm.customer.note.write',
  'crm.customer.governance.manage',
  'crm.customer.restriction.manage',
  'crm.customer.duplicate.review',
  'crm.customer.vehicle.manage',
  // Vehicles: one read code fans out to five.
  //
  // There is NO `veh.vehicle.create`. `POST /vehicles` registers
  // `veh.vehicle.manage` — the same code that gates editing — which is not the
  // shape CRM uses, where creating and editing are separate codes. The first
  // version of this list assumed the symmetry and invented the code; the
  // platform catalogue check refused it, which is exactly what that check is
  // for.
  'veh.vehicle.read',
  'veh.vehicle.manage',
  'veh.vehicle.status.manage',
  'veh.vehicle.relationship.manage',
  'veh.vehicle.odometer.record',
  'veh.vehicle.duplicate.review',
  // The document list is gated by a MANAGE capability from a different module —
  // inverted relative to every other vehicle sub-resource, and the one code an
  // Administration-shaped permission set would never have suggested.
  'shared.document.manage',
  'shared.document.read',
]);

/**
 * `crm.customer.merge` and `veh.vehicle.merge` are DELIBERATELY absent.
 *
 * `P1-OD-017` is an open Owner decision and no P1-27 screen calls either
 * operation. Granting them would let an acceptance run pass while the affordance
 * that must not exist quietly did.
 */
export const WITHHELD_PERMISSIONS = Object.freeze(['crm.customer.merge', 'veh.vehicle.merge']);

/**
 * What the P1-28 Appointment and Reception screens gate on — DERIVED, not
 * written down.
 *
 * ## The finding
 *
 * This account held the fourteen Administration codes and the sixteen CRM and
 * Vehicle codes, and not one `apt.*` or `rec.*` code. An Owner signing in to
 * accept P1-28 would have reached the calendar, the booking form, the walk-in
 * intake, the reception queue, all three check-in wizard screens and the
 * acknowledgement, and been told on every one of them that they do not have
 * permission — the exact failure P1-27 met before `CRM_VEHICLE_PERMISSIONS`
 * was added, one phase later and with the lesson already written down.
 *
 * ## Why it is derived and the two lists above are not
 *
 * `ADMIN_PERMISSIONS` and `CRM_VEHICLE_PERMISSIONS` are hand-written mirrors of
 * a contract file, and each was wrong on its first attempt: the CRM list
 * invented a `veh.vehicle.create` that does not exist, and only the catalogue
 * check caught it. A mirror is a second statement of a fact, and this
 * repository's whole finding register is second statements drifting from firsts.
 *
 * So this one is read out of the screens themselves. `check-p1-28-access.mjs`
 * already resolves, for every route page P1-28 owns, the permission codes that
 * page consults — including through an aliased import, which is how the check-in
 * screen reaches `iam.user.read`. Those codes ARE the answer to "what must the
 * acceptance account hold", and they cannot drift from the screens because they
 * are the screens. A route added tomorrow is granted tomorrow, with no edit here.
 *
 * The set is not narrowed to `apt.*`/`rec.*`: a P1-28 screen also consults CRM,
 * Vehicle, `iam.user.read` and `wo.work_order.read` codes, and the union is what
 * the phase needs. Overlap with the two lists above is expected and harmless —
 * `OWNER_PERMISSIONS` deduplicates.
 *
 * Fails closed. A derivation that returned nothing, or that returned something
 * `WITHHELD_PERMISSIONS` deliberately refuses, throws here rather than seeding a
 * role that is quietly wrong in either direction.
 */
export function derivePhaseScreenPermissions() {
  const sources = collectSources();
  const constants = permissionConstants([...sources.entries()]);
  const routes = phaseRoutes((file) => sources.get(file) ?? null);
  const codes = new Set();
  const unreadable = [];

  for (const route of routes) {
    const { codes: consulted, unresolved } = consultedPermissions(
      sources.get(route) ?? '',
      constants
    );
    for (const code of consulted) codes.add(code);
    for (const expression of unresolved) unreadable.push(`${route}: ${expression}`);
  }

  if (routes.length < 8 || codes.size < 15) {
    throw new GuardFailure(
      `Only ${codes.size} permission code(s) could be read from ${routes.length} P1-28 route ` +
        'page(s). The acceptance role would be seeded short and every appointment and reception ' +
        'screen would render a permission denial — which is the defect this derivation closes.'
    );
  }
  if (unreadable.length > 0) {
    throw new GuardFailure(
      `A P1-28 route consults a permission this derivation cannot resolve to a literal code: ` +
        `${unreadable.join('; ')}. Fail closed rather than seed a role missing it.`
    );
  }
  const refused = [...codes].filter((code) => WITHHELD_PERMISSIONS.includes(code));
  if (refused.length > 0) {
    throw new GuardFailure(
      `A P1-28 screen consults [${refused.join(', ')}], which WITHHELD_PERMISSIONS deliberately ` +
        'refuses. Granting it would let an acceptance run pass while an affordance that must not ' +
        'exist quietly did; refusing it silently would deny a screen for a reason nobody wrote ' +
        'down. Decide, and record the decision.'
    );
  }
  return [...codes].sort();
}

/** The derived set, resolved once. */
export const P1_28_SCREEN_PERMISSIONS = Object.freeze(derivePhaseScreenPermissions());

/**
 * The two intake-catalogue administration codes — held HERE and by no seed.
 *
 * ## Why they are not in `P1_28_SCREEN_PERMISSIONS`, and must not be
 *
 * That set is DERIVED from the phase's route pages, and no P1-28 route page
 * consults either code. That is not an oversight: `canonical-plan.md` §7
 * (`P1-28-OD-001`, "capability shipped, surface withheld") records that the
 * 35-task register is the OPERATOR surface and that **no canonical P1-28 task
 * binds a catalogue-administration screen**. PR #227 published 21 management
 * writes behind `apt.catalogue.manage` / `rec.catalogue.manage`, and
 * `supabase/seeds/04_iam_permission_catalog.sql` defines both codes while
 * **granting neither to any role** — so in the product as shipped the capability
 * is granted to nobody until the Owner decides who should hold it.
 *
 * ## Why the ACCEPTANCE administrator holds them anyway
 *
 * A tenant whose intake catalogues are empty cannot book, cannot cancel, cannot
 * offer a fuel level and cannot record a warning lamp — every one of those is a
 * REQUIRED or catalogued reference. An acceptance environment that can only ever
 * show the unconfigured state can evidence exactly half of what those screens
 * do, and the missing half is the half that matters: whether the configured path
 * works at all.
 *
 * So the acceptance administrator is granted the two codes **in this tooling**,
 * which ships with nothing and runs only against a loopback development
 * database. It is the acceptance environment's operator standing in for whichever
 * principal `P1-28-OD-001` eventually names. Nothing here pre-empts that
 * decision, nothing here reaches `supabase/` or `apps/`, and no screen in the
 * product consults either code — so granting them changes no rendering anywhere.
 *
 * The rows those grants then create are made at RUN TIME through the product's
 * own published contracts (`acceptance-fixtures.mjs`), never seeded. The
 * permanent no-fake-data policy forbids fabricated business rows SHIPPING as
 * product defaults; it does not forbid an acceptance environment configuring
 * itself the way a real tenant's administrator would.
 */
export const CATALOGUE_ADMIN_PERMISSIONS = Object.freeze([
  'apt.catalogue.manage',
  'rec.catalogue.manage',
]);

/**
 * Everything the Owner-acceptance administrator role carries.
 *
 * Administration (P1-26), CRM and Vehicles (P1-27), every code a P1-28 screen
 * consults, and the two intake-catalogue administration codes above.
 * Deduplicated, because `iam.user.read` legitimately appears in three of those
 * readings and a duplicate would make the role's own count assertion fail for a
 * reason that is not a defect.
 */
export const OWNER_PERMISSIONS = Object.freeze([
  ...new Set([
    ...ADMIN_PERMISSIONS,
    ...CRM_VEHICLE_PERMISSIONS,
    ...P1_28_SCREEN_PERMISSIONS,
    ...CATALOGUE_ADMIN_PERMISSIONS,
  ]),
]);

/**
 * What a read-only, branch-scoped operator holds.
 *
 * ## Why the CRM and Vehicle read codes were added
 *
 * This set used to be five Administration read codes and nothing else. That
 * made the reader account useless for the review the Product Owner asked for
 * after `OWNER ACCEPTANCE: FAIL`: §29 lists customer search, customer profile,
 * vehicle search and both duplicate queues among the surfaces to check as a
 * read-only user, and with no CRM or Vehicle code every one of them was a
 * permission denial. "Everything is denied" evidences the denial state; it
 * evidences nothing about whether a read-only operator can USE the product.
 *
 * With `crm.customer.read` and `veh.vehicle.read` the account browses customers
 * and vehicles and the write affordances are absent — which is the distinction
 * worth looking at, and the one an operator would actually notice.
 *
 * ## What is still deliberately withheld, and what each absence proves
 *
 *   - `crm.customer.create` — the Add Customer actions must NOT render. That is
 *     the permission rule of the control this remediation added, checked in a
 *     real browser rather than only in a unit test.
 *   - every `*.write`, `*.manage` and `*.record` code — no mutation surface.
 *   - `crm.customer.duplicate.review` and `veh.vehicle.duplicate.review` — both
 *     queues must be absent from the sidebar entirely. Each queue is gated on
 *     its OWN code precisely because reviewing whether two records are the same
 *     person is a different capability from reading a customer.
 *
 * The account is also branch-scoped (Company A, Branch A), so it carries both
 * properties §29 names. They are not separable on this one account, and that is
 * stated rather than presented as two independent checks.
 *
 * ## Why the two P1-28 read codes were added, and only those two
 *
 * The same argument, one phase later. Without `apt.appointment.read` and
 * `rec.reception.read` the reader account meets a permission denial on the
 * calendar and the queue, and "everything is denied" evidences nothing about
 * whether a read-only operator can use the product.
 *
 * `rec.reception.read` also makes this account the negative control `SEC-002`
 * needs. The sensitive-narrative rule is that a reader WITHOUT
 * `iam.sensitive.view` reaches the check-in wizard and sees the restricted
 * narrative fields withheld — which is unobservable on an account that cannot
 * open the wizard at all. So the read code lands and `iam.sensitive.view`
 * pointedly does not: the pair is what the control is made of.
 *
 * Deliberately still absent: `rec.reception.manage` and every other write or
 * approval code (`party.manage`, `authorization.verify`, `evidence.manage`,
 * `signature.manage`, `approve`, `convert`, `close`), `apt.appointment.manage`
 * and `apt.appointment.lifecycle.manage`, and `veh.vehicle.odometer.record`.
 * The queue's New reception control, the calendar's booking and check-in
 * affordances and every wizard command must be absent for this operator, and
 * each absence is the permission rule of a control this phase built.
 *
 * This list stays hand-written where `P1_28_SCREEN_PERMISSIONS` is derived, and
 * that asymmetry is the point: the administrator must hold whatever the screens
 * consult, so deriving it is correct; the reader is a set of DECISIONS about
 * what must not render, and a derived reader would grant itself every code and
 * evidence nothing.
 */
export const READER_PERMISSIONS = Object.freeze([
  'iam.user.read',
  'iam.role.read',
  'org.tenant.read',
  'org.company.read',
  'org.branch.read',
  'crm.customer.read',
  'veh.vehicle.read',
  'apt.appointment.read',
  'rec.reception.read',
]);

/**
 * The database login the API runs as during acceptance.
 *
 * It is a MEMBER of `app_runtime` and holds nothing else: no superuser, no
 * BYPASSRLS, no CREATEDB, no CREATEROLE. That is the whole point — if row-level
 * security or a grant is wrong, this login discovers it exactly as a deployed
 * one would. Connecting the API as `postgres` would make every authorization
 * check in the Owner's session meaningless, because `postgres` carries
 * BYPASSRLS in the Supabase local stack.
 *
 * Deliberately distinct from `rootlco_test_runtime`, which `tests/db/helpers.ts`
 * owns and recreates: two owners for one role is one owner too many.
 */
export const ACCEPTANCE_DB_LOGIN = 'rootlco_acceptance_runtime';

/** Local-only, and never a secret: this database accepts loopback connections only. */
export const ACCEPTANCE_DB_PASSWORD = 'rootlco-local-acceptance-only';

/**
 * Proves the target is this machine, or refuses.
 *
 * Returns the resolved target so callers cannot accidentally connect to
 * something other than what was checked.
 */
export function assertLocalTarget() {
  if (process.env.ROOTLCO_ENV !== REQUIRED_ENVIRONMENT) {
    refuse(
      `Fail closed: ROOTLCO_ENV must be exactly '${REQUIRED_ENVIRONMENT}'. ` +
        `Received ${process.env.ROOTLCO_ENV ? `'${process.env.ROOTLCO_ENV}'` : '(unset)'}.`
    );
  }

  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? LOCAL_DB_PORT);
  if (!LOOPBACK.has(host)) {
    refuse(`Fail closed: DB_HOST must be a loopback address. Received '${host}'.`);
  }
  if (port !== LOCAL_DB_PORT) {
    refuse(
      `Fail closed: DB_PORT must be ${LOCAL_DB_PORT}, the Supabase local database port. ` +
        `Received '${port}'.`
    );
  }

  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  if (appEnv !== undefined && appEnv !== 'local') {
    refuse(`Fail closed: NEXT_PUBLIC_APP_ENV must be 'local' when set. Received '${appEnv}'.`);
  }

  return {
    host,
    port,
    database: process.env.DB_NAME ?? 'postgres',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  };
}

/**
 * Reads the local Supabase endpoint and keys from the CLI.
 *
 * Never from a file and never from a committed default: the CLI is the only
 * thing that knows what the running stack actually issued, and reading it here
 * means no key is ever written down.
 */
export function readSupabase(repoRoot) {
  let raw;
  try {
    // A constant command STRING, not an argument array. `execFile` cannot
    // launch `npx.cmd` on Windows without a shell (EINVAL), and passing an
    // array through a shell is precisely what Node deprecates — it concatenates
    // rather than escapes. A literal with no interpolation has neither problem.
    raw = execSync('npx --no-install supabase status -o json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    refuse(
      'Could not read `supabase status`. Start the local stack first: npm run supabase:start\n' +
        String(error.message ?? error)
    );
  }

  // The CLI prints a "Stopped services: [...]" preamble on stdout before the
  // JSON, and `-o json` pretty-prints across lines. Slice from the first brace
  // to the last rather than hunting for a single-line object.
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) {
    refuse('`supabase status` produced no JSON object. Is the local stack running?');
  }

  let status;
  try {
    status = JSON.parse(raw.slice(first, last + 1));
  } catch (error) {
    refuse(`Could not parse \`supabase status\` output: ${error.message}`);
  }
  const apiUrl = status.API_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  const anonKey = status.ANON_KEY;
  if (!apiUrl || !serviceRoleKey || !anonKey) {
    refuse('`supabase status` did not report API_URL, ANON_KEY and SERVICE_ROLE_KEY.');
  }

  const parsed = new URL(apiUrl);
  if (!LOOPBACK.has(parsed.hostname)) {
    refuse(`Fail closed: the Supabase API must be loopback. Received '${parsed.hostname}'.`);
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    serviceRoleKey,
    anonKey,
    jwtSecret: status.JWT_SECRET,
    mailUrl: status.MAILPIT_URL ?? status.INBUCKET_URL,
    studioUrl: status.STUDIO_URL,
  };
}

/**
 * The exact character set an acceptance password may contain.
 *
 * `0/O` and `1/l/I` are absent on purpose — the Owner will type this from a
 * terminal into a browser, and a password that is strong but unreadable gets
 * pasted into a chat window instead.
 *
 * Exported because it is two things at once: the alphabet `generatePassword`
 * draws from, and the allow-list `reconstructPassword` re-checks a stored
 * password against before anything is done with it.
 */
export const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const PASSWORD_GROUPS = 4;
export const PASSWORD_GROUP_SIZE = 5;

/** `XXXXX-XXXXX-XXXXX-XXXXX` — 20 characters and 3 separators. */
export const PASSWORD_LENGTH = PASSWORD_GROUPS * PASSWORD_GROUP_SIZE + (PASSWORD_GROUPS - 1);

/**
 * Rebuilds a stored password out of the known alphabet, or refuses it.
 *
 * ## Why this exists — `js/file-access-to-http`
 *
 * `status-owner-account.mjs` reads `.local/owner-acceptance-account.json` and
 * signs in with what it finds, which is a file read reaching an outbound
 * request. The obvious defence is "the file is local", and that is exactly the
 * assumption worth not granting: anything able to write that file would
 * otherwise choose what the process transmits and where the transmitted value
 * ends up in the Backend's logs.
 *
 * So nothing stored is forwarded verbatim. Each character is looked up in the
 * constant alphabet and the *constant's* copy is emitted, the separators must
 * sit at the exact positions this generator puts them, and the length is pinned.
 * A value that is not a password this tooling could have produced does not
 * become a shorter or stranger password — it throws.
 *
 * This is an allow-list, not a reformat: the output is provably a string over
 * `PASSWORD_ALPHABET` in the documented shape, whatever the input was.
 *
 * @param {unknown} value the password as read from disk
 * @returns {string} an identical password rebuilt from constants
 */
export function reconstructPassword(value) {
  if (typeof value !== 'string') {
    throw new GuardFailure(
      `The stored password is ${value === undefined ? 'absent' : typeof value}, not a string. ` +
        'Re-run `npm run acceptance:create-owner`.'
    );
  }
  if (value.length !== PASSWORD_LENGTH) {
    throw new GuardFailure(
      `The stored password is ${value.length} characters, expected ${PASSWORD_LENGTH}. ` +
        'Re-run `npm run acceptance:create-owner`.'
    );
  }

  const out = [];
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) {
    // Every (group size + 1)th position is a separator, and only a separator.
    if ((i + 1) % (PASSWORD_GROUP_SIZE + 1) === 0) {
      if (value[i] !== '-') {
        throw new GuardFailure(
          `The stored password has no group separator at position ${i + 1}. ` +
            'Re-run `npm run acceptance:create-owner`.'
        );
      }
      out.push('-');
      continue;
    }
    const index = PASSWORD_ALPHABET.indexOf(value[i]);
    if (index < 0) {
      throw new GuardFailure(
        `The stored password contains a character outside the acceptance alphabet at ` +
          `position ${i + 1}. Re-run \`npm run acceptance:create-owner\`.`
      );
    }
    // The alphabet's own character, not the file's.
    out.push(PASSWORD_ALPHABET[index]);
  }
  return out.join('');
}

/**
 * A strong password a human can retype without misreading it.
 */
export function generatePassword() {
  const alphabet = PASSWORD_ALPHABET;
  const groups = PASSWORD_GROUPS;
  const perGroup = PASSWORD_GROUP_SIZE;
  const length = groups * perGroup;

  // Rejection sampling, not modulo.
  //
  // `byte % 57` is biased: 256 is not a multiple of 57, so the first
  // 256 mod 57 = 28 characters of the alphabet come up more often than the
  // rest. The bias is small, but it is real, it is measurable, and removing it
  // costs nothing — `js/biased-cryptographic-random` is right to flag it.
  //
  // Bytes at or above the largest whole multiple of the alphabet size are
  // discarded and redrawn, so every character is exactly equally likely.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const chars = [];
  while (chars.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      chars.push(alphabet[byte % alphabet.length]);
      if (chars.length === length) break;
    }
  }

  const out = [];
  for (let g = 0; g < groups; g += 1) {
    out.push(chars.slice(g * perGroup, (g + 1) * perGroup).join(''));
  }
  return out.join('-');
}

/** The GoTrue admin surface, service-role only. */
export async function goTrue(supabase, method, path, body) {
  const response = await fetch(`${supabase.apiUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${supabase.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, body: parsed };
}
