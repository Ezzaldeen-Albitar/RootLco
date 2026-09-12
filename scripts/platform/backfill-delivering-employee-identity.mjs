#!/usr/bin/env node
/**
 * The legacy delivering-employee mint — the operator half of P1-31 P-17
 * (Owner clarification of 2026-09-10; P1-31 **CC-29**, **CC-29b**).
 *
 * ## Why this is a command and not a migration
 *
 * Not preference — a gate. `scripts/ci/migration-replay-checks.mjs` refuses a
 * top-level `INSERT INTO <module schema>.<table>` in any migration, because
 * migrations create STRUCTURE and business rows are the tenant's. The first
 * draft of `20260910091000_sal_delivery_delivering_employee_identity.sql`
 * carried the mint and the review write inline and was refused by that check on
 * the hosted run. The rule is right and stays: a migration that writes rows into
 * `org.employees` is indistinguishable, to any scanner and to any reviewer, from
 * a migration that ships fabricated people.
 *
 * So the migration keeps everything structural — the register, the foreign key
 * added `NOT VALID`, the review table, the snapshot column, the eligibility
 * trigger, and the `DO` block that validates the key when `sal.delivery_records`
 * is empty (a fresh database, where `VALIDATE CONSTRAINT` is DDL over no rows)
 * — and the row-level work moves here, where it is an operator act with an
 * explicit target, a dry run and a printed count.
 *
 * ## What it does, per tenant, in one transaction
 *
 *   1. **mints** one `org.employees` row for each distinct legacy
 *      `(tenant_id, delivering_employee_id)` that resolves to an
 *      `iam.user_accounts` id of the SAME tenant, carrying THE LEGACY UUID AS
 *      ITS OWN `id` so every historical delivery goes on pointing at exactly the
 *      person it always pointed at, named from that account, `status`
 *      `'inactive'` (A-3), `created_by` that same account because there is no
 *      other honest actor to name;
 *   2. **stamps** `delivering_employee_display_name` on the deliveries whose
 *      identity is now resolved and whose snapshot is still `NULL`, so `NULL`
 *      keeps the single meaning the migration and the seam document give it:
 *      this handover's delivering identity was never resolved;
 *   3. **lists** every delivery whose value still resolves to nobody in
 *      `sal.delivery_legacy_identity_review`. It is never replaced, never
 *      substituted with the operator, and no person is fabricated for it;
 *   4. and, once every named tenant is done and only when NOTHING anywhere is
 *      unresolved, attempts
 *      `ALTER TABLE sal.delivery_records VALIDATE CONSTRAINT
 *      fk_delivery_records_delivering_employee`.
 *
 * ## The properties, enforced rather than described
 *
 *   - **never invents a person.** The mint JOINs `iam.user_accounts`; a value
 *     matching no account produces no employee, and the delivery is reported.
 *   - **additive only.** This file contains no `DELETE` and no `UPDATE` against
 *     `org.employees`, `sal.delivery_legacy_identity_review` or any delivery
 *     column other than the `NULL` snapshot of step 2. Nothing is rewritten to
 *     make the foreign key validate — a green constraint over a falsified
 *     custody history is the one outcome this slice exists to prevent.
 *   - **idempotent.** The mint skips a legacy value that already has its
 *     employee, the stamp touches only a `NULL` snapshot, and the review write
 *     is `ON CONFLICT DO NOTHING`. A second run reports zeros and writes nothing.
 *   - **explicit scope.** `--tenant <uuid|tenant_code>` (repeatable) names the
 *     organisations, or `--all` sweeps every one — and a sweep REPORTS the list
 *     it acted on, per organisation, on stdout and in the evidence file.
 *   - **validates only when entitled to.** The key is validated only when the
 *     review table is empty AND no delivery row anywhere is unresolved, so a
 *     tenant this run did not touch cannot be validated over.
 *
 * ## Why the immutability guard is disabled for the stamp, and why that is safe
 *
 * `tg_delivery_records_immutable` freezes `delivering_employee_display_name`, by
 * design: no application write may fill in a name for a handover. Step 2 is not
 * an application write — it is the same statement the migration used to run,
 * before the guard was recreated over the new column, performed by the role that
 * owns the table. It is disabled and re-enabled INSIDE the tenant's transaction,
 * which holds `ACCESS EXCLUSIVE` on `sal.delivery_records` for that window, so
 * there is no moment in which another session writes the table unguarded, and a
 * failure rolls the disable back with everything else. The disable is skipped
 * entirely when there is nothing to stamp.
 *
 * ## Authority
 *
 * An EXISTING platform permission, none minted: the run is refused unless the
 * named operator account holds an unrevoked `platform.organization.provision`
 * grant in `iam.platform_grants` — the same gate
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs` uses, and the only
 * platform code that sanctions writing an organisation's own structural rows on
 * the platform's behalf. It is a REFUSAL surface and nothing more: provisioning
 * has never written an employee, and this file makes no claim that it did.
 * Minting a code of this command's own would be a permission-catalogue decision,
 * which is the Owner's (A-6), not this remediation's.
 *
 * ## Inputs
 *
 *   ROOTLCO_ENV                  'local-acceptance' | 'production-maintenance'
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   the privileged connection
 *   BACKFILL_OPERATOR_EMAIL      the platform operator whose authority is used
 *   BACKFILL_EVIDENCE_PATH       where to write the evidence JSON
 *                                (default .tmp/delivering-employee-backfill-<ts>.json)
 *
 *   node scripts/platform/backfill-delivering-employee-identity.mjs \
 *     --confirm <operator-email> (--all | --tenant <uuid|code> ...) [--dry-run]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ALLOWED_ENVIRONMENTS = new Set(['local-acceptance', 'production-maintenance']);

/** The authority the run is gated on. One EXISTING platform permission. */
export const REQUIRED_PLATFORM_CODE = 'platform.organization.provision';

/** The audit action each changed organisation gets, in its own tenant. */
export const BACKFILL_AUDIT_ACTION = 'platform.delivering_employee_identity.backfilled';

/** The constraint the run attempts to validate, and only when entitled to. */
export const TARGET_CONSTRAINT = 'fk_delivery_records_delivering_employee';

/**
 * The mint, for ONE tenant ($1).
 *
 * `DISTINCT ON (tenant, legacy value)` is what makes the legacy uuid usable as a
 * primary key: a value cited by two deliveries becomes exactly one employee. The
 * home branch comes from that value's EARLIEST delivery and is informational
 * only (Owner decision A-2), so a value appearing in two branches is not
 * ambiguous and is not a reason to refuse. The `NOT EXISTS` is what makes a
 * second run a no-op instead of a primary-key violation.
 */
export const MINT_EMPLOYEES = `
INSERT INTO org.employees
  (id, tenant_id, company_id, branch_id, display_name, user_account_id, status, created_by)
SELECT legacy.delivering_employee_id,
       legacy.tenant_id,
       legacy.company_id,
       legacy.branch_id,
       account.display_name,
       account.id,
       'inactive',
       account.id
  FROM (
    SELECT DISTINCT ON (record.tenant_id, record.delivering_employee_id)
           record.tenant_id,
           record.delivering_employee_id,
           record.company_id,
           record.branch_id
      FROM sal.delivery_records AS record
     WHERE record.tenant_id = $1
     ORDER BY record.tenant_id, record.delivering_employee_id, record.created_at, record.id
  ) AS legacy
  JOIN iam.user_accounts AS account
    ON account.tenant_id = legacy.tenant_id
   AND account.id = legacy.delivering_employee_id
 WHERE NOT EXISTS (
   SELECT 1
     FROM org.employees AS existing
    WHERE existing.tenant_id = legacy.tenant_id
      AND existing.id = legacy.delivering_employee_id
 )
RETURNING id`;

/**
 * How many deliveries of ONE tenant ($1) are now resolved but unstamped.
 *
 * Read before the guard is touched at all, so the common case — nothing to
 * stamp — never disables a trigger or takes the lock that goes with it.
 */
export const COUNT_UNSTAMPED = `
SELECT count(*)::text AS n
  FROM sal.delivery_records AS record
  JOIN org.employees AS employee
    ON employee.tenant_id = record.tenant_id
   AND employee.id = record.delivering_employee_id
 WHERE record.tenant_id = $1
   AND record.delivering_employee_display_name IS NULL`;

/**
 * The snapshot, for ONE tenant ($1) — the migration's own statement, narrowed.
 *
 * `IS NULL` in the predicate is deliberate: an already stamped snapshot is
 * historical evidence and is never recomputed, so this can only ever fill a gap.
 */
export const STAMP_SNAPSHOTS = `
UPDATE sal.delivery_records AS record
   SET delivering_employee_display_name = employee.display_name
  FROM org.employees AS employee
 WHERE record.tenant_id = $1
   AND employee.tenant_id = record.tenant_id
   AND employee.id = record.delivering_employee_id
   AND record.delivering_employee_display_name IS NULL
RETURNING record.id`;

/**
 * The report, for ONE tenant ($1). Run AFTER the mint, so a value the mint could
 * resolve is not listed as unresolved.
 */
export const RECORD_UNRESOLVED = `
INSERT INTO sal.delivery_legacy_identity_review (tenant_id, delivery_id, legacy_value)
SELECT record.tenant_id, record.id, record.delivering_employee_id
  FROM sal.delivery_records AS record
 WHERE record.tenant_id = $1
   AND NOT EXISTS (
     SELECT 1
       FROM org.employees AS employee
      WHERE employee.tenant_id = record.tenant_id
        AND employee.id = record.delivering_employee_id
   )
ON CONFLICT (tenant_id, delivery_id) DO NOTHING
RETURNING delivery_id`;

/** Every delivery, in every tenant, whose delivering identity resolves to nobody. */
export const COUNT_UNRESOLVED_EVERYWHERE = `
SELECT count(*)::text AS n
  FROM sal.delivery_records AS record
 WHERE NOT EXISTS (
   SELECT 1
     FROM org.employees AS employee
    WHERE employee.tenant_id = record.tenant_id
      AND employee.id = record.delivering_employee_id
 )`;

class BackfillRefused extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new BackfillRefused(message, exitCode);
}

function parseArgs(argv) {
  const parsed = { confirm: undefined, dryRun: false, all: false, tenants: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--all') parsed.all = true;
    else if (arg === '--tenant') {
      const value = argv[++index];
      if (!value) fail('--tenant requires an organisation uuid or tenant_code');
      parsed.tenants.push(value.trim());
    } else if (arg === '--confirm') {
      parsed.confirm = argv[++index];
      if (!parsed.confirm) fail('--confirm requires the operator address');
    } else fail(`Unknown argument: ${arg}`);
  }
  if (!parsed.confirm) fail('Missing required --confirm <operator-email>');
  if (parsed.all && parsed.tenants.length > 0) {
    fail('Pass either --all or one or more --tenant, never both: the scope must be unambiguous');
  }
  if (!parsed.all && parsed.tenants.length === 0) {
    fail('Missing scope: pass --all to sweep every organisation, or --tenant <uuid|code>');
  }
  return parsed;
}

/** Reads what the run needs. Secrets stay in this object and are never logged. */
export function readBackfillInput(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const environment = env.ROOTLCO_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    fail("Fail closed: ROOTLCO_ENV must be exactly 'local-acceptance' or 'production-maintenance'");
  }
  const email = (env.BACKFILL_OPERATOR_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('BACKFILL_OPERATOR_EMAIL is not an address');
  if (args.confirm.trim().toLowerCase() !== email) {
    fail('--confirm must exactly match BACKFILL_OPERATOR_EMAIL');
  }
  return {
    environment,
    dryRun: args.dryRun,
    all: args.all,
    tenants: Object.freeze([...args.tenants]),
    db: {
      host: env.DB_HOST ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 54322),
      database: env.DB_NAME ?? 'postgres',
      user: env.DB_USER ?? 'postgres',
      password: env.DB_PASSWORD ?? 'postgres',
    },
    operator: { email },
    evidencePath: env.BACKFILL_EVIDENCE_PATH ?? '',
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The operator's authority, resolved to one account id. Exported so the proof
 * suites drive the same gate the command does.
 */
export async function resolveOperator(client, email) {
  const operator = await client.query(
    `SELECT a.id, a.tenant_id
       FROM iam.user_accounts a
      WHERE lower(a.email) = $1 AND a.deleted_at IS NULL`,
    [email]
  );
  if (operator.rowCount === 0) fail(`Refused: no account exists for ${email}`, 4);
  if (operator.rowCount > 1) {
    fail(
      `Refused: ${operator.rowCount} accounts share ${email}; name the operator unambiguously`,
      4
    );
  }
  const accountId = operator.rows[0].id;
  const authority = await client.query(
    `SELECT 1 FROM iam.platform_grants
      WHERE account_id = $1 AND permission_code = $2 AND revoked_at IS NULL`,
    [accountId, REQUIRED_PLATFORM_CODE]
  );
  if (authority.rowCount === 0) {
    fail(
      `Refused: account ${accountId} does not hold ${REQUIRED_PLATFORM_CODE}; this is platform maintenance, not a tenant action`,
      4
    );
  }
  return { accountId, tenantId: operator.rows[0].tenant_id };
}

/** Every organisation named, or every organisation there is — always as a list. */
async function resolveTargets(client, input) {
  if (input.all) {
    const { rows } = await client.query(
      'SELECT id, tenant_code, status FROM org.tenants ORDER BY created_at, tenant_code'
    );
    if (rows.length === 0) fail('Refused: --all matched no organisation', 4);
    return rows;
  }
  const resolved = [];
  for (const reference of input.tenants) {
    const { rows } = UUID.test(reference)
      ? await client.query('SELECT id, tenant_code, status FROM org.tenants WHERE id = $1', [
          reference,
        ])
      : await client.query(
          'SELECT id, tenant_code, status FROM org.tenants WHERE tenant_code = $1',
          [reference]
        );
    if (rows.length === 0) fail(`Refused: no organisation matches "${reference}"`, 4);
    resolved.push(rows[0]);
  }
  const seen = new Set();
  for (const row of resolved) {
    if (seen.has(row.id)) fail(`Refused: organisation ${row.tenant_code} was named twice`, 4);
    seen.add(row.id);
  }
  return resolved;
}

/**
 * ONE organisation, in ONE transaction on an already-open client.
 *
 * Exported as the command's core so the proof suites drive exactly what an
 * operator drives, on real rows, rather than a transcription of it. The caller
 * owns the transaction: `runBackfill` opens one per tenant and the suites open a
 * rolled-back one, which is how the matched and unmatched cases are proved
 * without leaving a row behind.
 */
export async function backfillOneTenant(client, tenant, options = {}) {
  const minted = await client.query(MINT_EMPLOYEES, [tenant.id]);

  const [{ n: unstamped }] = (await client.query(COUNT_UNSTAMPED, [tenant.id])).rows;
  let stamped = 0;
  if (unstamped !== '0') {
    // See the header: the guard is off only inside this transaction, which holds
    // ACCESS EXCLUSIVE on the table, and only when there is a gap to fill.
    await client.query(
      'ALTER TABLE sal.delivery_records DISABLE TRIGGER tg_delivery_records_immutable'
    );
    try {
      stamped = (await client.query(STAMP_SNAPSHOTS, [tenant.id])).rowCount;
    } finally {
      await client.query(
        'ALTER TABLE sal.delivery_records ENABLE TRIGGER tg_delivery_records_immutable'
      );
    }
  }

  const listed = await client.query(RECORD_UNRESOLVED, [tenant.id]);

  const outcome =
    minted.rowCount === 0 && listed.rowCount === 0 && stamped === 0 ? 'unchanged' : 'processed';

  if (outcome === 'processed' && options.operatorAccountId !== undefined) {
    await client.query("SELECT set_config('app.user_id', $1, true)", [options.operatorAccountId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
    await client.query(
      `SELECT iam.audit_append(
          p_tenant => $1, p_actor => $2, p_actor_kind => 'system',
          p_action => $3, p_entity_type => 'sal.delivery_record',
          p_details => $4::jsonb
       ) AS id`,
      [
        tenant.id,
        options.operatorAccountId,
        BACKFILL_AUDIT_ACTION,
        JSON.stringify([
          {
            field: 'minted_employee_count',
            old: null,
            new: String(minted.rowCount),
            class: 'public',
          },
          { field: 'stamped_snapshot_count', old: null, new: String(stamped), class: 'public' },
          {
            field: 'unresolved_listed_count',
            old: null,
            new: String(listed.rowCount),
            class: 'public',
          },
          {
            field: 'environment',
            old: null,
            new: String(options.environment ?? ''),
            class: 'public',
          },
        ]),
      ]
    );
  }

  return {
    tenantId: tenant.id,
    tenantCode: tenant.tenant_code,
    status: tenant.status,
    outcome,
    minted: minted.rows.map((row) => row.id),
    stamped,
    unresolved: listed.rows.map((row) => row.delivery_id),
  };
}

/**
 * Is the run entitled to claim the HISTORY satisfies the key?
 *
 * Only when nothing is unresolved ANYWHERE — a tenant this run never named
 * included. Validation is a statement about every row in the table, so a scoped
 * run must not make it on a tenant it did not read.
 */
export async function validationVerdict(client) {
  const [{ n: unresolved }] = (await client.query(COUNT_UNRESOLVED_EVERYWHERE)).rows;
  const [{ n: review }] = (
    await client.query('SELECT count(*)::text AS n FROM sal.delivery_legacy_identity_review')
  ).rows;
  const [validated] = (
    await client.query(
      `SELECT convalidated FROM pg_constraint WHERE conname = $1 AND conrelid = 'sal.delivery_records'::regclass`,
      [TARGET_CONSTRAINT]
    )
  ).rows;
  if (validated === undefined) {
    fail(`Refused: ${TARGET_CONSTRAINT} does not exist; apply the P-17 migrations first`, 5);
  }
  if (validated.convalidated === true) return { verdict: 'already-validated', unresolved, review };
  if (unresolved !== '0' || review !== '0') {
    return { verdict: 'withheld', unresolved, review };
  }
  return { verdict: 'eligible', unresolved, review };
}

/** The whole run: authority, scope, one transaction per tenant, then the key. */
export async function runBackfill(client, input) {
  const operator = await resolveOperator(client, input.operator.email);
  const targets = await resolveTargets(client, input);

  const organisations = [];
  for (const target of targets) {
    await client.query('BEGIN');
    try {
      organisations.push(
        await backfillOneTenant(client, target, {
          operatorAccountId: operator.accountId,
          environment: input.environment,
        })
      );
      await client.query(input.dryRun ? 'ROLLBACK' : 'COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  const verdict = await validationVerdict(client);
  let validation = verdict.verdict;
  if (verdict.verdict === 'eligible') {
    if (input.dryRun) {
      validation = 'eligible-not-attempted';
    } else {
      await client.query(
        `ALTER TABLE sal.delivery_records VALIDATE CONSTRAINT ${TARGET_CONSTRAINT}`
      );
      validation = 'validated';
    }
  }

  return {
    outcome: input.dryRun ? 'dry-run' : 'applied',
    operatorAccountId: operator.accountId,
    considered: organisations.length,
    mintedTotal: organisations.reduce((sum, one) => sum + one.minted.length, 0),
    stampedTotal: organisations.reduce((sum, one) => sum + one.stamped, 0),
    unresolvedTotal: organisations.reduce((sum, one) => sum + one.unresolved.length, 0),
    validation,
    unresolvedEverywhere: verdict.unresolved,
    reviewRowsEverywhere: verdict.review,
    organisations,
  };
}

function writeEvidence(input, result) {
  const path =
    input.evidencePath !== ''
      ? resolve(input.evidencePath)
      : resolve(
          `.tmp/delivering-employee-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );
  mkdirSync(dirname(path), { recursive: true });
  const evidence = {
    what: 'legacy delivering-employee identity mint (P1-31 P-17, CC-29b)',
    at: new Date().toISOString(),
    environment: input.environment,
    scope: input.all ? 'all organisations' : input.tenants.join(', '),
    authority: REQUIRED_PLATFORM_CODE,
    database: {
      host: input.db.host,
      port: input.db.port,
      name: input.db.database,
      user: input.db.user,
    },
    result,
    invented:
      'nothing — a legacy value matching no same-tenant account is reported, never replaced',
    secrets: 'none — no password, key or token is recorded here',
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

async function main() {
  const input = readBackfillInput();
  const client = new pg.Client(input.db);
  await client.connect();
  let result;
  try {
    result = await runBackfill(client, input);
  } finally {
    await client.end();
  }
  const path = writeEvidence(input, result);
  console.log(`Delivering-employee identity backfill: ${result.outcome}`);
  console.log(`  operator account  ${result.operatorAccountId}`);
  console.log(
    `  organisations     ${result.considered} considered, ${result.mintedTotal} employee(s) minted, ${result.stampedTotal} snapshot(s) stamped, ${result.unresolvedTotal} delivery(ies) listed for review`
  );
  for (const organisation of result.organisations) {
    console.log(
      `    ${String(organisation.tenantCode).padEnd(24)} ${organisation.outcome.padEnd(12)} minted ${organisation.minted.length}, stamped ${organisation.stamped}, unresolved ${organisation.unresolved.length}`
    );
  }
  console.log(
    `  ${TARGET_CONSTRAINT}: ${result.validation} (${result.unresolvedEverywhere} unresolved delivery row(s), ${result.reviewRowsEverywhere} review row(s), platform-wide)`
  );
  console.log(`  evidence          ${path}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Delivering-employee identity backfill refused: ${error.message}`);
    process.exit(error instanceof BackfillRefused ? error.exitCode : 1);
  });
}
