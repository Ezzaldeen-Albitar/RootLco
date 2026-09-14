#!/usr/bin/env node
/**
 * The P1-31 export companion's LOCAL identity fixture — one scoped, expiring role on one
 * named acceptance principal, installed by an operator act.
 *
 * ## What this is for
 *
 * P-12's report export is gated on `rpt.export`. Owner decision **CC-04** withheld that
 * code from the tenant administrator bundle
 * (`apps/api/src/modules/iam/domain/bootstrap-roles.ts:199-224` lists what the bundle
 * holds, and `rpt.export` is not in it), so **no principal the acceptance journey creates
 * holds it, and no principal inside the tenant can be given it over HTTP**. The Owner's
 * D-6 instruction nevertheless requires the export contract to be completed *with explicit
 * authorization and explicit auditability*. The acceptance therefore needs exactly one
 * holder, made deliberately, recorded as what it is.
 *
 * ## Why a script and not a route
 *
 * Not preference — measurement, the same measurement
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs:27-45` records for its own
 * case. The published administration routes cannot produce this fixture:
 *
 *   - `POST /iam/roles/{roleId}/permissions` writes `iam.role_permissions` under
 *     `ins_role_permissions_delegable`
 *     (`supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:301-312`),
 *     whose WITH CHECK admits a mapping only when the acting administrator **already holds
 *     the code being mapped**. No administrator holds `rpt.export`, so the mapping is
 *     refused by the database rather than by a check in application code.
 *   - `ins_role_permissions_platform_bootstrap`
 *     (`20260831093000_iam_platform_privilege_graph.sql:370-384`) is `TO app_platform` and
 *     additionally requires the tenant to be `provisioning`. The journey's organisation is
 *     `active` by the time it has records to export.
 *
 * A route that could do this would have to widen one of those policies permanently, which
 * is a standing escalation surface bought to set up a test. So this is an operator act on a
 * privileged connection — deployment infrastructure, not an application capability — and it
 * **adds no migration and changes no bundle**. Nothing here confers anything on any other
 * principal, and nothing here is claimed to be HTTP delegation.
 *
 * ## What it will not do
 *
 *   - It refuses anything but the LOCAL acceptance target. `assertLocalTarget()` (imported
 *     from `context.mjs`) requires `ROOTLCO_ENV=local-acceptance` and a loopback host on
 *     port 54322, and `ROOTLCO_ACCEPTANCE_CONFIRM` must be exactly `p1-31`. **Both are
 *     checked inside the writer**, not only in the CLI wrapper below, so a caller that
 *     imported `installExportFixture` could not step around them. There is deliberately no
 *     `production-maintenance` mode: the backfill precedent has one because it repairs real
 *     organisations; this installs a test fixture and has no business anywhere else.
 *   - It refuses anything but the ONE fresh identity the run just made: the tenant code
 *     `p31_journey_a_<stamp>`, the address `p31.export.<stamp>@rootlco.local` — or, on a
 *     retry, `p31.export.<stamp>-a<N>@rootlco.local` for the attempt `--attempt <N>` names —
 *     and a company and branch of that tenant, each predicate evaluated and **named
 *     separately** when it fails, so a refusal says which fact was not true.
 *   - It refuses a fourth attempt. `--attempt` is a whole number 1 to 3 (Astra's bound,
 *     `orchestration/P1-31-ASTRA-HANDOFF-20260914.md:93-101` at 2026-09-14T12:18Z): a retry
 *     is a bounded recovery for a run that already cost 520 HTTP steps, not a loop.
 *   - It creates **no unrestricted grant and no reusable shared role**. The role code
 *     carries the run's stamp, the grant is `scoped` to one branch, and it expires.
 *   - It invents **no approval**. `approval_ref` stays NULL, the writer is the existing
 *     `SYSTEM_ACTOR`, and no human is named anywhere in what it writes.
 *
 * ## The scope, stated truthfully rather than flatteringly
 *
 * The grant is branch-scoped, and a branch scope binds the checks that ASK about a scope:
 * `iam.has_permission_in_scope`
 * (`supabase/migrations/20260718097000_iam_permission_resolution.sql:192`). The unscoped
 * resolver `iam.has_permission` (`:105-113`) has no scope predicate at all, so for an
 * operation that requires only `rpt.export` with no scope claim — `shared.export-catalogue`
 * and `shared.export-authorize` are the two on the contract — the code is effectively
 * **tenant-wide** for this principal while the grant lives. That is recorded here and in the
 * evidence rather than described as narrower than it is.
 *
 * Likewise the expiry. `valid_to` is NOT in the immutability guard
 * (`20260718092000_iam_role_grants_and_scopes.sql:110-113`), and
 * `upd_role_grants_delegable` (`20260726090000:388-389`) lets a tenant administrator update
 * a grant. So **two hours is an operator time box, not a tamper-proof limit**; it bounds an
 * acceptance run, and it is not offered as a security control.
 *
 * ## The lease this TAKES
 *
 * `FOR UPDATE OF t, u` locks the tenant and the account rows. It does **not** exclude a
 * concurrent insert into `iam.role_grants` for the same principal, because a row that does
 * not exist yet cannot be locked. So exclusive use of the shared local database is no longer
 * merely asserted here: this script TAKES the one shared lease before it writes anything,
 * including before the dry run's `BEGIN` — `acquireDatabaseLease` on the advisory key
 * `DATABASE_LEASE_KEY` of `scripts/lib/database-lease.mjs`, the same key and the same
 * protocol the backend outbox suite speaks. Contention is a refusal with its own exit code,
 * never a wait, and closing the connection releases the lease.
 *
 * A lease binds only those who speak the protocol. The frozen main journey
 * `orchestration/acceptance/p1-31-journey.mjs` does **not** take it, and is deliberately not
 * modified to: the acceptance protocol still admits one writer at a time, so that is a
 * consistency gap between the two instruments and not a run breaker. What the lease buys
 * here is that a second writer which DOES speak the protocol cannot interleave with this
 * transaction.
 *
 * ## The deferred constraints, and the connection that can prove them
 *
 * THREE deferred constraint triggers can fire on this insert-only path:
 * `tg_role_grants_require_scope`
 * (`supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:205-208`),
 * `tg_role_grants_delegation_authority`
 * (`20260727090000_iam_grant_delegation_scope_backstop.sql:248-251`) and
 * `tg_grant_scopes_delegation_authority` (`:253-256`). A fourth deferred trigger guards these
 * tables — `tg_grant_scopes_require_scope`
 * (`20260718092000_iam_role_grants_and_scopes.sql:210-213`) — but it fires `AFTER DELETE ON
 * iam.grant_scopes` and this tool issues no delete, so it never fires here. **`ROLLBACK` never
 * fires a deferred constraint**, so a rehearsal that only rolled back would establish
 * nothing whatever about the scope rows. `SET CONSTRAINTS ALL IMMEDIATE` therefore runs
 * inside the transaction after the writes — before the rehearsal's `ROLLBACK` and before the
 * real `COMMIT` — and the evidence carries `deferredConstraintsForced` as the witness.
 *
 * The delegation backstop returns true — that is, declines to constrain — under more than one
 * condition: a superuser or `BYPASSRLS` connection
 * (`20260727090000_iam_grant_delegation_scope_backstop.sql:108-113`), and equally a caller that
 * is not a member of `app_runtime` (`:114-116`). So the privileged connection this fixture
 * requires is **sufficient, not necessary**: what requiring it buys is that the proof does not
 * rest on which role happens to be connected. The fixture asks whether its own connection is
 * superuser or `BYPASSRLS`, refuses with its own exit code when it is not, and records the
 * answer as `connectionRole`. Without that question a rehearsal could pass on a connection
 * under which the real commit would fail.
 *
 * Even with both, a rehearsal cannot prove the COMMIT-time state of a DIFFERENT connection.
 * What it establishes is narrower and is stated in those words: the same statements ran, and
 * the deferred constraints were forced and passed, before the rollback.
 *
 * ## What it records
 *
 * One `iam.audit_append` row in the tenant, under the **already registered** action
 * `iam.grant.issued` (`apps/api/src/server/auth/audit-actions.ts:161-165`, class
 * `privileged`, entity type `iam.role_grant`) — which is exactly what happened: a role was
 * granted to a user, scoped to a branch. A new action string was considered and rejected: it
 * would have needed a catalogue entry of its own to describe a fact the catalogue already
 * describes, and an audit vocabulary that grows per fixture is a vocabulary nobody can read.
 * The details quads name the principal, the role, the codes, the expiry, the environment and
 * — in plain words — that this row is an acceptance fixture.
 *
 * Plus one evidence JSON, RESERVED IMMEDIATELY BEFORE the transaction opens and AFTER every
 * guard: created `wx` with a `status: 'pending'` record once the target, the confirmation, the
 * connection's privilege and the shared lease are all settled, and then finalized in place —
 * the same reserved file, never a second exclusive create. It carries identifiers and
 * permission codes only.
 *
 * That order is the point, and it is the order the exit codes assume:
 *
 *   - a refusal BEFORE the reservation — a wrong environment, a wrong confirmation token, a
 *     connection that cannot prove the deferred constraints, a contended lease — leaves **no
 *     evidence file at all**, so the same attempt number can simply be run again;
 *   - a refusal AFTER the reservation, the ones inside the transaction included, **finalizes
 *     the reserved file** with `status: 'refused'` and the reason, so the record says what
 *     happened rather than sitting at `pending`;
 *   - exit 8 therefore means what it says: a genuine prior attempt already owns that file, and
 *     the attempt number must advance.
 *
 * Two cases can leave `pending` behind and no others: a CRASH between the reservation and the
 * finalize — a killed process, a lost machine — and a finalize that itself failed, which is
 * exit 11 and prints under its own prefix saying the work committed. A `pending` file is read as
 * exactly that, and the audit rows are where to establish whether the transaction committed.
 *
 * ## Inputs
 *
 *     ROOTLCO_ENV                        local-acceptance   (enforced)
 *     ROOTLCO_ACCEPTANCE_CONFIRM         p1-31              (enforced)
 *     DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   the privileged connection
 *     EXPORT_FIXTURE_OPERATOR_EMAIL      the operator whose authority is used
 *
 *     npm run acceptance:export-fixture -- --confirm <operator-email> \
 *       --stamp <run> --tenant <uuid> --principal <email> --user <uuid> \
 *       --company <uuid> --branch <uuid> [--attempt <1..3>] [--evidence <path>] [--dry-run]
 *
 * Exit codes: 2 a guard or a usage error, 3 the declared identity is not there or not
 * fresh, 4 the operator's authority, 5 the permission catalogue, 6 a fixture that already
 * exists, 7 an attempt outside 1 to 3, 8 the evidence file could not be reserved
 * exclusively, 9 another harness holds the shared-database lease, 10 the connection cannot
 * prove the deferred constraints, 11 a failure AFTER the commit — the role, the grant and
 * the audit row are installed, so the operator inspects those rows before any retry.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { GuardFailure, SYSTEM_ACTOR, assertLocalTarget } from './context.mjs';
// The field names of the result, from the one module the consumer loads too. Building the
// object through `buildExportFixtureResult` is what makes a rename here a thrown error instead
// of a null in the companion's summary.
import { buildExportFixtureResult } from './export-fixture-result-contract.mjs';
import {
  DATABASE_LEASE_KEY,
  acquireDatabaseLease,
  releaseDatabaseLease,
} from '../../lib/database-lease.mjs';

/** The one value that opts a run in, beside the loopback check. */
export const REQUIRED_CONFIRMATION = 'p1-31';

/** The name this harness takes the shared-database lease under. */
export const FIXTURE_LEASE_HARNESS = 'p1-31 export fixture setup';

/**
 * The highest attempt this tool will install, and why there is a ceiling at all.
 *
 * A retry exists because the companion's 520-step journey is expensive: a failure after the
 * fixture committed used to be unrecoverable without re-running the whole thing. It is a
 * bounded recovery and not a loop — the bound is Astra's, recorded at
 * `orchestration/P1-31-ASTRA-HANDOFF-20260914.md:93-101` on 2026-09-14T12:18Z — so a fourth
 * attempt is refused rather than accommodated. Each attempt names its OWN principal, its own
 * role code and its own evidence file, and never reuses or overwrites an earlier attempt's.
 */
export const MAX_FIXTURE_ATTEMPT = 3;

/**
 * The authority the run is gated on — an EXISTING platform permission, none minted.
 *
 * The same code `platform.organization-provision` declares, which is the operation that
 * created this organisation in the first place. The fixture therefore confers nothing on
 * the operator that provisioning did not already confer.
 */
export const REQUIRED_OPERATOR_CODE = 'platform.organization.provision';

/**
 * The nine codes, as an explicit literal.
 *
 * Not derived at runtime, deliberately: a fixture that computed its own permission list
 * from the dataset registry would silently widen the day a dataset gained a code, and the
 * thing an acceptance fixture must never do is grow without anybody deciding. The list is
 * pinned against the registry by `tests/ci/p1-31-export-fixture-permissions.test.ts` in the
 * DB-free tier instead, so a drift is a failing test rather than a wider grant.
 *
 *   - `iam.user.read`      — the session the principal reads about itself
 *   - `org.company.read`   — the company picker on the report screens
 *   - `org.branch.read`    — the branch picker
 *   - `rpt.report.read`    — every reporting operation declares it, and the export route
 *                            requires it beside `rpt.export`
 *   - `wo.work_order.read` — `work_orders_by_status`, and `technician_labor_time`
 *   - `tech.technician.read` — `technician_labor_time`
 *   - `inv.stock.read`    — `inventory_movements`
 *   - `sal.finance.view`  — `invoice_payment_summary`
 *   - `rpt.export`        — the export itself
 */
export const EXPORT_FIXTURE_PERMISSIONS = Object.freeze([
  'iam.user.read',
  'org.company.read',
  'org.branch.read',
  'rpt.report.read',
  'wo.work_order.read',
  'tech.technician.read',
  'inv.stock.read',
  'sal.finance.view',
  'rpt.export',
]);

/**
 * How old the run's identities may be.
 *
 * This is NOT a security bound; it is a statement that the fixture belongs to the
 * acceptance run that is happening now. The journey provisions its organisation, its
 * company, its branch and this principal within minutes of each other, so anything older
 * than this window is a different run's world and is refused rather than reused.
 */
export const FIXTURE_FRESHNESS_HOURS = 2;

/** How long the grant lives. An operator time box — see the docblock on tamper-resistance. */
export const FIXTURE_GRANT_HOURS = 2;

/**
 * The audit action, already in the registry.
 *
 * `iam.grant.issued` describes "a role was granted to a user, optionally scoped to
 * companies or branches", which is precisely the write below.
 */
export const FIXTURE_AUDIT_ACTION = 'iam.grant.issued';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^[a-z0-9]{6,16}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ATTEMPT = /^[1-9][0-9]*$/;

/**
 * The ONE address each attempt may install for, derived rather than accepted.
 *
 * Attempt 1 keeps the plain address the companion has always published, so the normal case
 * is unchanged. A retry carries `-a<N>` before the `@`, which is what lets the second attempt
 * invite a principal at all: `iam.invitation-create` refuses a duplicate address, so a retry
 * on the SAME address could never get past its own invitation step.
 */
export function fixturePrincipalAddress(stamp, attempt) {
  return attempt === 1
    ? `p31.export.${stamp}@rootlco.local`
    : `p31.export.${stamp}-a${String(attempt)}@rootlco.local`;
}

/**
 * The private role code, which carries the attempt for the same reason.
 *
 * An existing fixture role is refused outright (exit 6), so a retry that reused the code
 * could not install anything. The attempt in the code is what keeps each attempt's grant a
 * separate, separately auditable row rather than a reuse of an earlier one.
 */
export function fixtureRoleCode(stamp, attempt) {
  return attempt === 1
    ? `p31_${stamp}_export_fixture`
    : `p31_${stamp}_export_fixture_a${String(attempt)}`;
}

/** A refusal that carries its own exit code, so the caller can tell the kinds apart. */
export class FixtureRefused extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'FixtureRefused';
    this.exitCode = exitCode;
  }
}

function refuse(message, exitCode = 2) {
  throw new FixtureRefused(message, exitCode);
}

/**
 * The exit code a thrown error becomes — in ONE place.
 *
 * The CLI handler at the foot of this file and
 * `tests/ci/p1-31-export-fixture-refusals.test.ts` both read this function, so the code a
 * refusal is DOCUMENTED with is the code the process actually exits with. Stating it twice —
 * once in a handler and once as a number typed into a test — is how a refusal matrix comes to
 * assert something the command does not do.
 */
export function exitCodeFor(error) {
  if (error instanceof FixtureRefused) return error.exitCode;
  if (error instanceof GuardFailure) return 2;
  return 1;
}

function parseArgs(argv) {
  const parsed = {
    confirm: undefined,
    stamp: undefined,
    tenantId: undefined,
    principal: undefined,
    userId: undefined,
    companyId: undefined,
    branchId: undefined,
    attempt: undefined,
    evidencePath: undefined,
    dryRun: false,
  };
  const single = new Map([
    ['--confirm', 'confirm'],
    ['--stamp', 'stamp'],
    ['--tenant', 'tenantId'],
    ['--principal', 'principal'],
    ['--user', 'userId'],
    ['--company', 'companyId'],
    ['--branch', 'branchId'],
    ['--attempt', 'attempt'],
    ['--evidence', 'evidencePath'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    const key = single.get(arg);
    if (key === undefined) refuse(`Unknown argument: ${arg}`);
    // A repeated flag is refused rather than resolved. Silently taking the last one means a
    // caller that named two tenants installs the fixture in whichever the shell happened to
    // put second, which is the one thing a fixture that refuses everything else must not do.
    if (parsed[key] !== undefined) refuse(`${arg} is given more than once`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) refuse(`${arg} requires a value`);
    parsed[key] = value.trim();
    index += 1;
  }
  return parsed;
}

/**
 * Everything the run needs, validated without touching a database.
 *
 * Exported so the DB-free tier can drive the whole refusal matrix: a guard that can only be
 * exercised by connecting to a database is a guard nobody exercises.
 * `tests/ci/p1-31-export-fixture-refusals.test.ts` is where that matrix is actually driven —
 * every refusal below, plus the environment guard, the exclusive reservation, the lease and
 * the connection-privilege precondition. Each case asserts its exit code; the cases that run
 * with a client additionally assert what reached it, which is no write statement for every
 * refusal before `BEGIN` and a finalized `refused` record for the one raised inside the
 * transaction. The earlier cases cannot make that second assertion because no client exists
 * yet — the input is parsed before anything connects — and that file names which ones do.
 */
export function readFixtureInput(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.stamp === undefined || !STAMP.test(args.stamp)) {
    refuse('--stamp must be the acceptance run stamp, 6 to 16 lowercase letters or digits');
  }
  for (const [flag, key] of [
    ['--tenant', 'tenantId'],
    ['--user', 'userId'],
    ['--company', 'companyId'],
    ['--branch', 'branchId'],
  ]) {
    if (args[key] === undefined || !UUID.test(args[key])) {
      refuse(`${flag} must be the identifier the acceptance run answered, as a uuid`);
    }
  }
  const attemptGiven = args.attempt ?? '1';
  if (!ATTEMPT.test(attemptGiven)) {
    refuse('--attempt must be a whole number', 7);
  }
  const attempt = Number.parseInt(attemptGiven, 10);
  if (attempt > MAX_FIXTURE_ATTEMPT) {
    refuse(
      `Refused: attempt ${String(attempt)} is beyond the bound of ` +
        `${String(MAX_FIXTURE_ATTEMPT)}. A retry is a bounded recovery for a run that has ` +
        'already cost 520 HTTP steps, not a loop; a fourth failure is a defect to read, not ' +
        'an attempt to repeat.',
      7
    );
  }
  if (args.principal === undefined || !EMAIL.test(args.principal)) {
    refuse('--principal must be the export principal’s address');
  }
  const expectedEmail = fixturePrincipalAddress(args.stamp, attempt);
  if (args.principal.toLowerCase() !== expectedEmail) {
    refuse(
      `Refused: this tool installs the fixture for ${expectedEmail} and nothing else. ` +
        'The address is derived from the run stamp and the attempt, so a different one means ' +
        'a different principal than the run created.',
      3
    );
  }
  const operator = (env.EXPORT_FIXTURE_OPERATOR_EMAIL ?? '').trim().toLowerCase();
  if (!EMAIL.test(operator)) {
    refuse('EXPORT_FIXTURE_OPERATOR_EMAIL is not an address');
  }
  if ((args.confirm ?? '').toLowerCase() !== operator) {
    refuse('--confirm must exactly match EXPORT_FIXTURE_OPERATOR_EMAIL');
  }
  return Object.freeze({
    stamp: args.stamp,
    attempt,
    tenantId: args.tenantId,
    tenantCode: `p31_journey_a_${args.stamp}`,
    principal: expectedEmail,
    userId: args.userId,
    companyId: args.companyId,
    branchId: args.branchId,
    roleCode: fixtureRoleCode(args.stamp, attempt),
    operator: { email: operator },
    dryRun: args.dryRun,
    evidencePath: args.evidencePath ?? '',
    environment: env.ROOTLCO_ENV ?? '',
    confirmation: env.ROOTLCO_ACCEPTANCE_CONFIRM ?? '',
  });
}

/**
 * The two locks, checked HERE — inside the writer.
 *
 * `main` below calls `assertLocalTarget()` too, because it needs the connection settings it
 * returns. This is not a duplicate: it is the check being on the path that writes, so that
 * an importer of `installExportFixture` cannot arrive without it.
 *
 * ## Why the guard is a parameter, and why that is not a bypass
 *
 * `assertTarget` defaults to the real `assertLocalTarget` and the CLI never passes anything
 * else — there is no flag, no environment variable and no argument that substitutes it, so
 * nothing an operator can type relaxes it. What the parameter buys is that an IN-PROCESS
 * caller — the disposable-database proof, which must run the real SQL against an isolated
 * database on a different port — can supply the target it is actually using and have the run
 * record it, instead of the proof being impossible or the command growing a switch that would
 * live in it forever.
 */
export function assertLocalAndConfirmed(input, assertTarget = assertLocalTarget) {
  const target = assertTarget();
  if (input.confirmation !== REQUIRED_CONFIRMATION) {
    refuse(
      `Fail closed: ROOTLCO_ACCEPTANCE_CONFIRM must be exactly '${REQUIRED_CONFIRMATION}'. ` +
        `Received ${input.confirmation === '' ? '(unset)' : `'${input.confirmation}'`}.`
    );
  }
  return target;
}

/**
 * Whether this connection can prove the deferred delegation backstop.
 *
 * `tg_role_grants_delegation_authority` returns true only under a superuser or `BYPASSRLS`
 * connection, so on any other role the grant insert would be refused the moment the deferred
 * constraints fire. Asking first turns that into a named refusal before the transaction
 * instead of a constraint violation inside it — and it closes the gap where a rehearsal
 * passed on a connection under which the real commit could not.
 */
async function assertPrivilegedConnection(client) {
  const answered = await client.query(
    `SELECT rolname AS name, (rolsuper OR rolbypassrls) AS privileged
       FROM pg_roles
      WHERE rolname = current_user`
  );
  const row = answered.rows[0];
  if (row === undefined) {
    refuse(
      'Refused: this connection’s own role is not readable, so whether it can prove the ' +
        'deferred delegation backstop is unknown. The fixture does not guess.',
      10
    );
  }
  if (row.privileged !== true) {
    refuse(
      `Refused: the connection role ${String(row.name)} is neither a superuser nor ` +
        'BYPASSRLS, and the deferred delegation backstop returns true only for one of those. ' +
        'The grant would be refused when the constraints fire. Connect as the local ' +
        'acceptance owner.',
      10
    );
  }
  return { name: String(row.name), privileged: true };
}

/**
 * Each freshness predicate on its own, so a refusal names the fact that was not true.
 *
 * Astra's reference draft asked all of them in one statement, which is correct and
 * unreadable when it refuses: `rowCount !== 1` cannot distinguish "the tenant is not the
 * one you named" from "the branch belongs to another company". Four statements cost four
 * round trips against a loopback database and buy a message an operator can act on.
 */
async function resolveTarget(client, input) {
  const window = `${String(FIXTURE_FRESHNESS_HOURS)} hours`;

  const tenant = await client.query(
    `SELECT id, tenant_code, status, created_at
       FROM org.tenants
      WHERE id = $1 AND tenant_code = $2 AND status = 'active'
        AND created_at > now() - $3::interval`,
    [input.tenantId, input.tenantCode, window]
  );
  if (tenant.rowCount !== 1) {
    refuse(
      `Refused: no organisation ${input.tenantCode} (${input.tenantId}) is active and younger ` +
        `than ${window}. This fixture belongs to the acceptance run happening now.`,
      3
    );
  }

  const account = await client.query(
    `SELECT id, email::text AS email, status, created_at
       FROM iam.user_accounts
      WHERE id = $1 AND tenant_id = $2 AND email = $3::extensions.citext
        AND status = 'active' AND deleted_at IS NULL
        AND created_at > now() - $4::interval`,
    [input.userId, input.tenantId, input.principal, window]
  );
  if (account.rowCount !== 1) {
    refuse(
      `Refused: ${input.principal} (${input.userId}) is not an active, undeleted account of ` +
        `${input.tenantCode} younger than ${window}. The companion invites and ACTIVATES the ` +
        'principal over HTTP before this step; run it in that order.',
      3
    );
  }

  const company = await client.query(
    `SELECT id FROM org.legal_companies
      WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
    [input.companyId, input.tenantId]
  );
  if (company.rowCount !== 1) {
    refuse(
      `Refused: company ${input.companyId} is not an active, undeleted company of ` +
        `${input.tenantCode}.`,
      3
    );
  }

  const branch = await client.query(
    `SELECT id FROM org.branches
      WHERE id = $1 AND tenant_id = $2 AND company_id = $3
        AND status = 'active' AND deleted_at IS NULL`,
    [input.branchId, input.tenantId, input.companyId]
  );
  if (branch.rowCount !== 1) {
    refuse(
      `Refused: branch ${input.branchId} is not an active, undeleted branch of company ` +
        `${input.companyId}.`,
      3
    );
  }

  // The rows the write depends on, held for the rest of the transaction. It does not
  // exclude a concurrent grant insert — see the lease this file ASSUMES.
  await client.query(
    `SELECT 1
       FROM org.tenants t
       JOIN iam.user_accounts u ON u.tenant_id = t.id
      WHERE t.id = $1 AND u.id = $2
        FOR UPDATE OF t, u`,
    [input.tenantId, input.userId]
  );

  return {
    tenantCreatedAt: tenant.rows[0].created_at,
    accountCreatedAt: account.rows[0].created_at,
  };
}

/**
 * The operator whose authority the writes are attributed to.
 *
 * ACTIVE and undeleted, not merely undeleted. A suspended or invited account is not an
 * authority: `deleted_at IS NULL` alone would let the fixture be attributed to somebody who
 * cannot sign in, which is precisely the attribution an audit row must not carry.
 */
async function resolveOperator(client, input) {
  const operator = await client.query(
    `SELECT id, tenant_id FROM iam.user_accounts
      WHERE email = $1::extensions.citext AND status = 'active' AND deleted_at IS NULL`,
    [input.operator.email]
  );
  if (operator.rowCount === 0) {
    refuse(`Refused: no active, undeleted account exists for ${input.operator.email}`, 4);
  }
  if (operator.rowCount > 1) {
    refuse(
      `Refused: ${String(operator.rowCount)} accounts share ${input.operator.email}; name the ` +
        'operator unambiguously',
      4
    );
  }
  const accountId = operator.rows[0].id;
  const authority = await client.query(
    `SELECT 1 FROM iam.platform_grants
      WHERE account_id = $1 AND permission_code = $2 AND revoked_at IS NULL`,
    [accountId, REQUIRED_OPERATOR_CODE]
  );
  if (authority.rowCount === 0) {
    refuse(
      `Refused: account ${accountId} does not hold ${REQUIRED_OPERATOR_CODE}; installing an ` +
        'acceptance fixture is platform maintenance, not a tenant action',
      4
    );
  }
  return accountId;
}

/** The shared-database lease, taken before anything is written, or a typed refusal. */
async function takeFixtureLease(client) {
  try {
    await acquireDatabaseLease(client, FIXTURE_LEASE_HARNESS);
  } catch (error) {
    refuse(
      'Refused: another harness holds the RootLco shared-database lease (advisory key ' +
        `${String(DATABASE_LEASE_KEY)}). Two writers on one database is how one run’s records ` +
        'end up inside another’s evidence. Stop the other harness and run again. ' +
        `Reported as: ${error instanceof Error ? error.name : 'lease refused'}.`,
      9
    );
  }
  return { key: DATABASE_LEASE_KEY, harness: FIXTURE_LEASE_HARNESS, acquired: true };
}

/**
 * The whole fixture: every guard, then the reservation, then one transaction.
 *
 * Exported so a proof can drive it against a database without spawning a process, and so
 * `--dry-run` is the same code path as the real run with a different ending.
 *
 * ## The order, which is the whole design
 *
 *   1. `assertLocalAndConfirmed` — the loopback target and the confirmation token;
 *   2. `assertPrivilegedConnection` — whether this connection can prove the deferred
 *      constraints at all (exit 10);
 *   3. `takeFixtureLease` — the one shared-database lease, contention refused not awaited
 *      (exit 9);
 *   4. **reserve the evidence file `wx`** (exit 8);
 *   5. `writeExportFixture` — `BEGIN`, the writes, `SET CONSTRAINTS ALL IMMEDIATE`, then
 *      `COMMIT` or the rehearsal's `ROLLBACK`;
 *   6. finalize the reserved file — `applied`, `dry-run`, or `refused` with the reason.
 *
 * The reservation sits at 4 and not at 1 because an attempt that refused at 1, 2 or 3 granted
 * nothing, wrote nothing and cost nothing: it must leave no residue, so the operator re-runs the
 * SAME attempt number instead of spending one of three bounded attempts on a run that never
 * opened a transaction. It sits before 5 and not after because a path that cannot be written
 * must refuse while there is still nothing installed to inspect.
 *
 * Anything that refuses from 4 onwards finalizes the reserved file as `refused`. A file left at
 * `pending` therefore means one of exactly two things: the process died between the reservation
 * and the finalize, or step 6 ITSELF failed — which is exit 11, and stderr says so in words.
 */
export async function installExportFixture(client, input, options = {}) {
  const { assertTarget = assertLocalTarget } = options;
  const target = assertLocalAndConfirmed(input, assertTarget);
  const connectionRole = await assertPrivilegedConnection(client);
  const lease = await takeFixtureLease(client);
  try {
    const evidencePath = reserveFixtureEvidence(input);
    let result;
    try {
      result = await writeExportFixture(client, input, {
        dbTarget: {
          host: target?.host ?? null,
          port: target?.port ?? null,
          database: target?.database ?? null,
        },
        connectionRole,
        lease,
      });
    } catch (error) {
      // The reservation exists and the transaction did not survive, so the record says so.
      // Never `pending`: a reader cannot tell a refused run from a dead machine.
      recordRefusedEvidence(evidencePath, input, error);
      throw error;
    }
    try {
      finalizeFixtureEvidence(evidencePath, input, result);
    } catch (error) {
      /*
       * AFTER the commit on a real pass.
       *
       * So this is not a failure to install: the role, the grant and the audit row exist. The
       * message says so in those words and never implies a rollback, because an operator who
       * read "failed" and re-ran would be told the principal already holds a live grant
       * (exit 6) and would have to work out why from first principles. On a rehearsal there is
       * nothing committed, so the original error travels unchanged.
       */
      if (input.dryRun) throw error;
      throw new FixtureRefused(
        'committed — inspect the audit row(s) before any retry. The role ' +
          `${result.roleCode} (${result.roleId}), the grant ${result.grantId} and the audit ` +
          `record ${result.auditRecordId} ARE installed for ${result.principal}; what failed is ` +
          `the evidence file (${String(error?.code ?? 'write failed')}). Nothing was rolled ` +
          `back. Read those rows first; then, if a retry is still wanted, run --attempt ` +
          `${String(input.attempt + 1)}.`,
        11
      );
    }
    return result;
  } finally {
    try {
      await releaseDatabaseLease(client);
    } catch {
      // Closing the connection releases it too; a failure here is not worth masking the
      // outcome of the fixture with.
    }
  }
}

/** The transaction itself, with the preconditions already established. */
async function writeExportFixture(client, input, { dbTarget, connectionRole, lease }) {
  const roleId = randomUUID();
  const grantId = randomUUID();

  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '15s'");

    const operatorAccountId = await resolveOperator(client, input);
    const freshness = await resolveTarget(client, input);

    // A grant that is still alive is the tenant's state, not this tool's to duplicate. An
    // EXPIRED row is not an existing grant: `valid_to` in the past means the principal
    // holds nothing, and refusing on it would make a re-run impossible for no reason.
    const live = await client.query(
      `SELECT id, valid_to FROM iam.role_grants
        WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
          AND (valid_to IS NULL OR valid_to > now())`,
      [input.tenantId, input.userId]
    );
    if (live.rowCount > 0) {
      refuse(
        `Refused: ${input.principal} already holds ${String(live.rowCount)} live grant(s) ` +
          `(first ${live.rows[0].id}). This tool installs a fixture on a principal that holds ` +
          'nothing. Revoke it through iam.grant-revoke, or let it expire, and run again.',
        6
      );
    }

    const existingRole = await client.query(
      `SELECT id FROM iam.roles
        WHERE tenant_id = $1 AND role_code = $2 AND deleted_at IS NULL`,
      [input.tenantId, input.roleCode]
    );
    if (existingRole.rowCount > 0) {
      refuse(
        `Refused: ${input.tenantCode} already carries the role ${input.roleCode} ` +
          `(${existingRole.rows[0].id}). The fixture role is never reused.`,
        6
      );
    }

    const catalogue = await client.query(
      'SELECT id, permission_code FROM iam.permissions WHERE permission_code = ANY($1::text[])',
      [[...EXPORT_FIXTURE_PERMISSIONS]]
    );
    const ids = new Map(catalogue.rows.map((row) => [row.permission_code, row.id]));
    const absent = EXPORT_FIXTURE_PERMISSIONS.filter((code) => !ids.has(code));
    if (absent.length > 0) {
      refuse(
        `Refused: the permission catalogue lacks ${String(absent.length)} code(s) this fixture ` +
          `requires: ${absent.join(', ')}. Apply the seeds before the acceptance run.`,
        5
      );
    }

    /*
     * The tenant and actor context the triggers read, transaction-local.
     *
     * The connection is the privileged one and is not subject to the application policies,
     * so this is not what authorises the writes — it is what makes the rows carry the right
     * context, exactly as the backfill precedent does.
     */
    await client.query("SELECT set_config('app.user_id', $1, true)", [SYSTEM_ACTOR]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [input.tenantId]);

    await client.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        roleId,
        input.tenantId,
        input.roleCode,
        'LOCAL acceptance fixture: report export only',
        'Installed by scripts/dev/owner-acceptance/export-fixture-setup.mjs for the P1-31 ' +
          'export companion. Not a product role; expires with its grant.',
        SYSTEM_ACTOR,
      ]
    );

    const mapped = await client.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, p.id, 'allow', $3
         FROM iam.permissions p
        WHERE p.permission_code = ANY($4::text[])
       RETURNING permission_id`,
      [input.tenantId, roleId, SYSTEM_ACTOR, [...EXPORT_FIXTURE_PERMISSIONS]]
    );
    if (mapped.rowCount !== EXPORT_FIXTURE_PERMISSIONS.length) {
      refuse(
        `Refused: mapped ${String(mapped.rowCount)} of ` +
          `${String(EXPORT_FIXTURE_PERMISSIONS.length)} codes; the fixture is all or nothing.`,
        5
      );
    }

    const grant = await client.query(
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, valid_to, granted_by, created_by)
       VALUES ($1, $2, $3, $4, 'scoped', now() + $5::interval, $6, $6)
       RETURNING valid_to`,
      [
        grantId,
        input.tenantId,
        input.userId,
        roleId,
        `${String(FIXTURE_GRANT_HOURS)} hours`,
        SYSTEM_ACTOR,
      ]
    );

    // The scope row the deferred `tg_role_grants_require_scope` requires, in the same
    // transaction: a scoped active grant with no scope never reaches a committed state.
    await client.query(
      `INSERT INTO iam.grant_scopes
         (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1, $2, 'branch', $3, $4, $5)`,
      [input.tenantId, grantId, input.companyId, input.branchId, SYSTEM_ACTOR]
    );

    const audit = await client.query(
      `SELECT iam.audit_append(
          p_tenant => $1, p_actor => $2, p_actor_kind => 'system',
          p_action => $3, p_entity_type => 'iam.role_grant', p_entity_id => $4,
          p_company => $5, p_branch => $6, p_request_ref => $7,
          p_details => $8::jsonb
       ) AS id`,
      [
        input.tenantId,
        SYSTEM_ACTOR,
        FIXTURE_AUDIT_ACTION,
        grantId,
        input.companyId,
        input.branchId,
        `p1-31 export companion fixture, run ${input.stamp}`,
        JSON.stringify([
          {
            field: 'fixture',
            old: null,
            new: 'P1-31 export companion: local acceptance test fixture, not a product grant',
            class: 'public',
          },
          { field: 'role_code', old: null, new: input.roleCode, class: 'public' },
          // The attempt, so the audit trail of a retried run says which principal holds
          // which grant without anybody having to read the addresses back to front.
          { field: 'attempt', old: null, new: String(input.attempt), class: 'public' },
          {
            field: 'permission_codes_granted',
            old: null,
            new: [...EXPORT_FIXTURE_PERMISSIONS].sort().join(','),
            class: 'public',
          },
          { field: 'scope', old: null, new: 'branch', class: 'public' },
          {
            field: 'valid_to',
            old: null,
            new: new Date(grant.rows[0].valid_to).toISOString(),
            class: 'public',
          },
          { field: 'environment', old: null, new: input.environment, class: 'public' },
          { field: 'grantee_account_id', old: null, new: input.userId, class: 'internal' },
          { field: 'operator_account_id', old: null, new: operatorAccountId, class: 'internal' },
        ]),
      ]
    );

    /*
     * The deferred constraints, FORCED — the one statement without which the rehearsal is
     * theatre.
     *
     * Four of the triggers guarding these rows are DEFERRABLE INITIALLY DEFERRED, and
     * `ROLLBACK` never fires a deferred constraint. So this runs after every write and before
     * either ending: the rehearsal learns whether the scope rows and the delegation backstop
     * actually accept the grant, and the real pass learns it a statement earlier than the
     * commit would have told it.
     */
    const forced = await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    /*
     * ASSEMBLED FROM THE CONTRACT, not typed out as a literal.
     *
     * `buildExportFixtureResult` refuses an object whose keys are not exactly the contract's,
     * so a field renamed, dropped or added here throws on this line — inside the transaction,
     * before either ending — rather than reaching the companion as a null it would record
     * without complaint. The names are spelled in
     * `scripts/dev/owner-acceptance/export-fixture-result-contract.mjs` and checked against
     * this object by `tests/ci/p1-31-export-fixture-refusals.test.ts`, which drives this very
     * function with a stub client and compares the key set of what it returns.
     */
    const result = buildExportFixtureResult({
      kind:
        'privileged LOCAL identity fixture setup — an operator act. Not HTTP delegation of ' +
        'rpt.export, not a bundle change, and not a human approval.',
      outcome: input.dryRun ? 'dry-run' : 'applied',
      attempt: input.attempt,
      attemptBound: MAX_FIXTURE_ATTEMPT,
      lease,
      connectionRole,
      dbTarget,
      deferredConstraintsForced: true,
      deferredConstraints: {
        statement: 'SET CONSTRAINTS ALL IMMEDIATE',
        command: forced.command ?? null,
        when: 'inside the transaction, after every write, before the rollback or the commit',
        proves: input.dryRun
          ? 'the deferred scope and delegation constraints ran and passed before the rollback'
          : 'the deferred scope and delegation constraints ran and passed before the commit',
      },
      tenantId: input.tenantId,
      tenantCode: input.tenantCode,
      principal: input.principal,
      userId: input.userId,
      companyId: input.companyId,
      branchId: input.branchId,
      roleId,
      roleCode: input.roleCode,
      grantId,
      scope: 'branch',
      permissions: [...EXPORT_FIXTURE_PERMISSIONS],
      validTo: new Date(grant.rows[0].valid_to).toISOString(),
      setupActor: SYSTEM_ACTOR,
      operatorAccountId,
      approvalRef: null,
      auditAction: FIXTURE_AUDIT_ACTION,
      auditRecordId: audit.rows[0].id,
      freshness: {
        windowHours: FIXTURE_FRESHNESS_HOURS,
        tenantCreatedAt: new Date(freshness.tenantCreatedAt).toISOString(),
        accountCreatedAt: new Date(freshness.accountCreatedAt).toISOString(),
      },
    });

    if (input.dryRun) {
      /*
       * END TO END, then undone — and stated for exactly what that is worth.
       *
       * Every statement above ran, the audit append included, and `SET CONSTRAINTS ALL
       * IMMEDIATE` forced the deferred scope and delegation checks, which passed, before this
       * rollback. None of it persists. What this does NOT establish is the commit-time state
       * of a DIFFERENT connection: another writer may take the address, the role code or a
       * grant in between, and this rehearsal cannot see that. It says the same statements ran
       * and the deferred constraints held — not that the run that follows will succeed.
       */
      await client.query('ROLLBACK');
      return result;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is being discarded anyway.
    }
    throw error;
  }
}

/** Where this attempt's evidence goes. The attempt is in the default name for a reason. */
export function fixtureEvidencePath(input) {
  if (input.evidencePath !== '') return resolve(input.evidencePath);
  const suffix = input.attempt === 1 ? '' : `-a${String(input.attempt)}`;
  return resolve(`.tmp/p1-31-export-fixture-${input.stamp}${suffix}.json`);
}

/**
 * The evidence document, for both the pending record and the final one.
 *
 * ONE builder, so the reserved record and the finalized record cannot drift into two shapes
 * — and so the DB-free tier can assert the shape the companion reads without a database.
 * `result` is `null` while the record is pending and the run's own object afterwards; it stays
 * NESTED under `result` because
 * `orchestration/acceptance/p1-31-export-companion.mjs` reads `parsed.result`, and flattening
 * it would break the consumer for no gain.
 */
export function fixtureEvidenceDocument(input, result, status, now = new Date(), refusal = null) {
  return {
    what: 'P1-31 export companion — privileged LOCAL identity fixture setup',
    /**
     * `pending` between the reservation and the ending, then `dry-run`, `applied` or `refused`.
     *
     * Every refusal from the reservation onwards finalizes this file as `refused`, so a record
     * that stays `pending` means either the process died in between or this very write failed —
     * the second of which exits 11 and says on stderr that the work committed.
     */
    status,
    /** The refusal that ended the run, or `null`. Never a driver message — see below. */
    refusal,
    at: now.toISOString(),
    attempt: input.attempt,
    attemptBound: MAX_FIXTURE_ATTEMPT,
    environment: input.environment,
    dryRun: input.dryRun,
    authority: REQUIRED_OPERATOR_CODE,
    operatorEmail: input.operator.email,
    principal: input.principal,
    roleCode: input.roleCode,
    result,
    scopeTruth:
      'The grant is branch-scoped, which binds iam.has_permission_in_scope. The unscoped ' +
      'iam.has_permission has no scope predicate, so for an operation requiring only ' +
      'rpt.export with no scope claim this code is effectively tenant-wide for this ' +
      'principal while the grant lives.',
    expiryTruth:
      'valid_to is not in the grant immutability guard and a tenant administrator may ' +
      'update a grant, so the two-hour window is an operator time box and not a ' +
      'tamper-proof limit.',
    leaseTaken:
      'The shared-database lease (advisory key from scripts/lib/database-lease.mjs) is ' +
      'ACQUIRED before any write, including before the rehearsal transaction, and contention ' +
      'is a refusal rather than a wait. It binds only writers that speak the protocol: the ' +
      'main journey does not take it, and nothing here claims a stranger cannot write.',
    deferredConstraintTruth:
      'ROLLBACK never fires a deferred constraint, so SET CONSTRAINTS ALL IMMEDIATE runs ' +
      'inside the transaction after every write and before either ending. The rehearsal ' +
      'therefore establishes that the same statements ran and the deferred scope and ' +
      'delegation constraints passed before the rollback — not the commit-time state of a ' +
      'different connection.',
    retryTruth:
      'A failed post-commit attempt may leave its scoped test grant alive until expiry, so a ' +
      'journey may temporarily have up to three such principals. These are synthetic local ' +
      'fixture identities, not a production grant or a rollback claim.',
    revoked: 'nothing — this tool issues no DELETE and no UPDATE',
    secrets: 'none — no password, key or token is recorded here',
  };
}

/**
 * The evidence file, RESERVED immediately before the transaction opens — and after every guard.
 *
 * Two orderings are wrong and this is the third. Reserving AFTER the transaction meant a path
 * that already existed, or a directory that could not be written, refused after the grant had
 * committed: a run that granted and then could not say so. Reserving BEFORE the guards meant a
 * wrong environment, an unprivileged connection or a contended lease left a `pending` file
 * behind having granted nothing, so the natural re-run collided with that residue on exit 8 and
 * the only documented recovery spent one of three bounded attempts. So `wx` runs here, once the
 * target, the confirmation, the connection's privilege and the lease are all settled and
 * immediately before `BEGIN`: a refusal earlier than this leaves nothing at all, and a refusal
 * from here on finalizes this file as `refused`.
 *
 * The finalize step below overwrites this same reserved file and never takes a second exclusive
 * create.
 */
export function reserveFixtureEvidence(input, now = new Date()) {
  const path = fixtureEvidencePath(input);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify(fixtureEvidenceDocument(input, null, 'pending', now), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    );
  } catch (error) {
    // The CODE, never the driver or filesystem message: a bounded refusal an operator can act
    // on, with no path echoed beyond the one they passed in.
    refuse(
      `Refused: the evidence file for attempt ${String(input.attempt)} could not be reserved ` +
        `exclusively (${String(error?.code ?? 'write refused')}). Every attempt writes its own ` +
        'file and never overwrites another; name a free path, or run the next attempt.',
      8
    );
  }
  return path;
}

/** The same reserved file, finalized in place. Never a second `wx`. */
export function finalizeFixtureEvidence(path, input, result, now = new Date()) {
  const status = result.outcome === 'dry-run' ? 'dry-run' : 'applied';
  writeFileSync(
    path,
    `${JSON.stringify(fixtureEvidenceDocument(input, result, status, now), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'w' }
  );
  return path;
}

/**
 * The reason a refusal is bounded to a class and a code when it is not one of ours.
 *
 * A `FixtureRefused` message is written in this file and is safe to keep. Anything else may be a
 * `pg` error, whose message carries the host, the port, the user and sometimes the password —
 * and this evidence file is archived. So the same rule the CLI handler follows applies here: the
 * class and the code, never the message, never a stack.
 */
function refusalRecordFor(error) {
  if (error instanceof FixtureRefused) {
    return { exitCode: error.exitCode, kind: error.name, reason: error.message };
  }
  const kind = error instanceof Error ? error.name : 'Error';
  return {
    exitCode: exitCodeFor(error),
    kind,
    code: error?.code === undefined ? null : String(error.code),
    reason:
      'The underlying message is deliberately not recorded: a driver error carries the ' +
      'connection settings and this file is kept. The class and the code above are what this ' +
      'record may safely hold; the audit rows are where to establish the database state.',
  };
}

/**
 * The reserved file, finalized as REFUSED rather than left at `pending`.
 *
 * Called for every refusal from the reservation onwards, the ones raised inside the transaction
 * included, so `pending` means a crash and nothing else. A failure to write this record is
 * swallowed on purpose: the refusal that brought us here is the outcome the caller must see, and
 * replacing it with a filesystem error would hide the fault behind its own bookkeeping. That is
 * the one path that can still leave `pending` behind, and it is the same path a killed process
 * takes.
 */
function recordRefusedEvidence(path, input, error, now = new Date()) {
  try {
    writeFileSync(
      path,
      `${JSON.stringify(
        fixtureEvidenceDocument(input, null, 'refused', now, refusalRecordFor(error)),
        null,
        2
      )}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'w' }
    );
  } catch {
    // See the docblock: the original refusal wins.
  }
  return path;
}

async function main() {
  const input = readFixtureInput();

  /*
   * NO RESERVATION HERE.
   *
   * The evidence file is reserved inside `installExportFixture`, after the target, the
   * confirmation, the connection's privilege and the lease, and immediately before `BEGIN` —
   * see that function's docblock for why each of the other two orderings was wrong. `main`
   * only needs the PATH for its own output, and that is a pure function of the input.
   */
  const target = assertLocalTarget();
  const client = new pg.Client(target);
  await client.connect();
  let result;
  try {
    result = await installExportFixture(client, input);
  } finally {
    try {
      await client.end();
    } catch {
      // The fixture's outcome is already decided; a failure closing the connection does not
      // get to replace it. Closing also releases the lease.
    }
  }

  const evidencePath = fixtureEvidencePath(input);
  process.stdout.write('P1-31 export fixture setup\n');
  process.stdout.write(`  outcome     ${result.outcome}\n`);
  process.stdout.write(
    `  attempt     ${String(result.attempt)} of at most ${String(result.attemptBound)}\n`
  );
  process.stdout.write(`  organisation ${result.tenantCode} (${result.tenantId})\n`);
  process.stdout.write(`  principal   ${result.principal}\n`);
  process.stdout.write(`  role        ${result.roleCode} (${result.roleId})\n`);
  process.stdout.write(`  grant       ${result.grantId}, branch-scoped, until ${result.validTo}\n`);
  process.stdout.write(`  codes       ${String(result.permissions.length)}\n`);
  process.stdout.write(`  audit       ${result.auditAction} ${result.auditRecordId}\n`);
  process.stdout.write(
    `  lease       advisory key ${String(result.lease.key)}, acquired by ${result.lease.harness}\n`
  );
  process.stdout.write(
    `  connection  ${result.connectionRole.name} (superuser or BYPASSRLS: required, confirmed)\n`
  );
  process.stdout.write('  constraints SET CONSTRAINTS ALL IMMEDIATE ran before the ending\n');
  process.stdout.write(`  evidence    ${evidencePath}\n`);
  process.stdout.write('\n  LOCAL ACCEPTANCE FIXTURE — an operator act, not a product grant.\n');
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    if (error instanceof FixtureRefused) {
      /*
       * Exit 11 is NOT a refusal and must not be printed as one.
       *
       * It travels as a `FixtureRefused` because that is how this command carries an exit code,
       * but what it means is the opposite: the transaction COMMITTED and something after it
       * failed. Printing it under "refused" invited exactly the misreading the whole ordering
       * exists to prevent, so it gets its own prefix, which states the truth.
       */
      const prefix =
        error.exitCode === 11
          ? 'Export fixture setup COMMITTED, then failed after commit:'
          : 'Export fixture setup refused:';
      process.stderr.write(`\n${prefix} ${error.message}\n\n`);
      process.exit(exitCodeFor(error));
    }
    if (error instanceof GuardFailure) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(exitCodeFor(error));
    }
    /*
     * BOUNDED, and one line: the error's class and its code, never its message and never a
     * stack.
     *
     * A `pg` failure puts the host, the port and the user into `error.message` — and a
     * misconfigured connection string can put the password there too. An acceptance run's
     * stderr is archived beside its evidence, so this is the one place where printing what
     * the driver said would put connection settings into a kept record.
     */
    const kind = error instanceof Error ? error.name : 'Error';
    const code = error?.code === undefined ? '' : ` (${String(error.code)})`;
    process.stderr.write(
      `\nExport fixture setup failed: ${kind}${code}. The underlying message is deliberately ` +
        'not printed — a driver error carries the connection settings and this output is kept. ' +
        'Reaching here means the transaction was rolled back or never opened; a failure AFTER ' +
        'the commit exits 11 and says so in words.\n\n'
    );
    process.exit(1);
  });
}
