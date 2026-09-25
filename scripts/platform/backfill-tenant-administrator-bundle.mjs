#!/usr/bin/env node
/**
 * The tenant administrator bundle backfill — Owner decision **D-2** of the
 * P1-31 A0 preflight, answered on 2026-09-08 (P1-31 CC-11; CC-03 and CC-08 are
 * the residuals it closes).
 *
 * ## The problem it exists for
 *
 * `TENANT_ADMINISTRATOR_ROLE.permissionCodes` is written ONCE, by
 * `platform.organization-provision`, at the moment an organisation is created.
 * Nothing re-applies it. Every organisation provisioned before a widening keeps
 * the set it was given, and because `ins_role_permissions_delegable` admits a
 * mapping only when the acting administrator ALREADY HOLDS the code being
 * mapped, that is a closure rather than an inconvenience: no principal in such
 * an organisation can hold a newer code, or ever be granted one by anybody
 * inside the tenant. Measured on the shared acceptance stack on 2026-09-08:
 * twenty-four administrator roles at 44, 46, 48, 65 and 67 codes against a
 * current bundle of 74.
 *
 * P1-31 sharpened it. Re-pointing `wty.warranty-detail` off `wty.warranty.issue`
 * onto the newly minted `wty.warranty.read` (P-7) did not merely withhold
 * something new from those organisations — it WITHDREW a read their
 * administrator could perform the day before. That is P1-31 CC-08.
 *
 * ## Why this is a script and not a route
 *
 * Not preference — measurement. The only application-layer path that writes
 * `iam.role_permissions` on the platform's authority is
 * `ins_role_permissions_platform_bootstrap` (20260831093000), whose WITH CHECK
 * reads:
 *
 *     tenant_id = iam.current_tenant_id()
 *     AND EXISTS (SELECT 1 FROM org.tenants t
 *                  WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
 *     AND iam.has_platform_authority('platform.organization.provision')
 *
 * Every organisation this backfill is for is `active`, never `provisioning`, and
 * `iam.role_permissions` is `FORCE ROW LEVEL SECURITY`. A route would therefore
 * be refused by the database, and publishing one would require WIDENING that
 * policy by migration — permanently opening the bootstrap insert path to
 * non-provisioning tenants, which is a standing escalation surface bought to
 * perform a one-off correction. The repository already has the right shape for
 * exactly this case: `scripts/platform/genesis-platform-operator.mjs`, an
 * operator act on a privileged connection, deployment infrastructure rather
 * than an application route. This is its sibling, and no migration is added.
 *
 * ## Authority
 *
 * An EXISTING platform permission, none minted: the run is refused unless the
 * named operator account holds an unrevoked `platform.organization.provision`
 * grant in `iam.platform_grants`. That is precisely the authority that already
 * sanctions writing this exact bundle — provisioning writes all 74 codes onto a
 * new organisation's administrator role — so the backfill confers nothing on
 * the operator that provisioning did not already confer, and the writes are
 * attributed to that operator's account.
 *
 * ## The four properties, enforced rather than described
 *
 *   - **additive only.** This file contains no DELETE and no UPDATE against
 *     `iam.role_permissions`, and no statement that changes an existing row's
 *     `effect`. The only write is an INSERT of `effect = 'allow'` for a code the
 *     role does not map at all. Nothing is ever revoked, from anyone.
 *   - **idempotent.** The work is the set difference `bundle − mapped`. A second
 *     run computes an empty difference, writes nothing, and appends no audit
 *     record — `unchanged`, exit 0.
 *   - **narrow.** It touches exactly one role per organisation: the STANDARD
 *     administrator role the provisioning path wrote. That role is identified by
 *     its server-owned `role_code` (`tenant_administrator`) — immutable and unique
 *     among an organisation's live roles, unlike the display name, which a tenant
 *     may edit through `iam.role-update` — and by having been created by a
 *     principal OUTSIDE the organisation (the platform operator the provisioning
 *     and administrator-establishing paths act as). Every other role in the
 *     tenant — cashier, employee and every role the tenant has built for itself —
 *     is never read for writing and never written. An organisation with no such
 *     role is REPORTED and SKIPPED; the role is not created, because creating one
 *     would be provisioning, not a backfill.
 *   - **never overwrites a customised role.** The Owner's rule, recorded with the
 *     `sal.credit.manage` widening: a backfill completes the STANDARD role and
 *     does not re-decide a tenant's own choices about it. So an administrator role
 *     showing ANY sign of having been customised is SKIPPED WHOLE — nothing is
 *     added to it, not even the codes it lacks — and REPORTED as `customised`,
 *     with every reason found:
 *       · `created-inside-organisation` — the role was created by one of the
 *         organisation's own principals, so it is the tenant's role wearing the
 *         standard code, not the one provisioning wrote;
 *       · `deny:<code>` — the tenant mapped a code as `effect = 'deny'`;
 *       · `beyond-bundle:<code>` — the role allows a code the bundle does not
 *         carry, which provisioning never writes;
 *       · `tenant-edit:<action>` — the organisation's own audit trail records a
 *         mapping on this role added, re-decided or removed through the shipped
 *         role-management operations (`iam.role.permission_added`,
 *         `iam.role.permission_changed`, `iam.role.permission_removed`). This is
 *         the one signal that also catches a bundle code the tenant REMOVED, which
 *         the role's current rows alone cannot tell apart from a role that was
 *         simply provisioned on an older bundle.
 *     Whether a customised role should gain a newly approved code is the tenant's
 *     own decision, taken through the role editor by an administrator who holds
 *     it — or, where nobody does, an explicit operator act this tool refuses to
 *     take implicitly.
 *
 * ## Scope is explicit
 *
 * `--tenant <uuid|tenant_code>` (repeatable) names the organisations, or `--all`
 * sweeps every organisation — and a sweep REPORTS the list it acted on, per
 * organisation, in the evidence file and on stdout. There is no silent sweep.
 *
 * ## What it records
 *
 * Per organisation that changed: one `iam.audit_append` record IN THAT TENANT,
 * action `platform.tenant_administrator_bundle.backfilled`, actor the operator
 * account, entity the administrator role, with the codes added, the count
 * before and after, and the environment. Plus one evidence JSON naming every
 * organisation considered, its outcome, and the codes added to each — identifiers
 * and permission codes only, never a password, key or token.
 *
 * ## Inputs
 *
 *   ROOTLCO_ENV                  'local-acceptance' | 'production-maintenance'
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   the privileged connection
 *   BACKFILL_OPERATOR_EMAIL      the platform operator whose authority is used
 *   BACKFILL_EVIDENCE_PATH       where to write the evidence JSON
 *                                (default .tmp/tenant-administrator-backfill-<ts>.json)
 *
 *   node scripts/platform/backfill-tenant-administrator-bundle.mjs \
 *     --confirm <operator-email> (--all | --tenant <uuid|code> ...) [--dry-run]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import pg from 'pg';
import { parseModule } from '../lib/typescript-source.mjs';
import { API_SRC_ROOT } from '../lib/repository-paths.mjs';

const ALLOWED_ENVIRONMENTS = new Set(['local-acceptance', 'production-maintenance']);

/**
 * The authority the run is gated on. ONE existing platform permission — the same
 * one `platform.organization-provision` declares, because writing this bundle is
 * what that operation already does.
 */
export const REQUIRED_PLATFORM_CODE = 'platform.organization.provision';

/** The one role code this tool will ever write to. */
export const TARGET_ROLE_CODE = 'tenant_administrator';

/** The audit action every changed organisation gets, in its own tenant. */
export const BACKFILL_AUDIT_ACTION = 'platform.tenant_administrator_bundle.backfilled';

/**
 * The audit actions the shipped role-management operations append when a tenant
 * principal changes a role's mappings. Any one of them against the administrator
 * role marks that role as customised.
 */
export const ROLE_MAPPING_EDIT_ACTIONS = Object.freeze([
  'iam.role.permission_added',
  'iam.role.permission_changed',
  'iam.role.permission_removed',
]);

/** The bundle's single definition, read from the source the provisioning path uses. */
const BOOTSTRAP_ROLES_SOURCE = join(API_SRC_ROOT, 'modules', 'iam', 'domain', 'bootstrap-roles.ts');

class BackfillRefused extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new BackfillRefused(message, exitCode);
}

/**
 * The bundle, from `bootstrap-roles.ts` itself.
 *
 * PARSED, never pattern-matched: this repository has recorded a scanner reading
 * prose as code often enough that the rule is standing. A second hand-written
 * copy of 74 codes would be worse still — it would drift from the constant the
 * provisioning path actually writes, and a backfill that widened to a stale list
 * is the very defect it exists to repair.
 */
export function readTenantAdministratorBundle(sourcePath = BOOTSTRAP_ROLES_SOURCE) {
  const file = parseModule(readFileSync(sourcePath, 'utf8'));
  if (file === null) fail(`Could not parse ${sourcePath} as TypeScript`);
  let codes = null;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== 'TENANT_ADMINISTRATOR_ROLE') continue;
      codes = permissionCodesOf(declaration.initializer);
    }
  }
  if (codes === null) {
    fail(`${sourcePath} declares no TENANT_ADMINISTRATOR_ROLE with a permissionCodes array`);
  }
  if (codes.length === 0) fail('The tenant administrator bundle is empty; refusing to proceed');
  const unique = [...new Set(codes)];
  if (unique.length !== codes.length) {
    fail('The tenant administrator bundle lists a code twice; refusing to proceed');
  }
  return Object.freeze(unique);
}

/** `permissionCodes: Object.freeze([...])` (or a bare array) inside the role literal. */
function permissionCodesOf(initializer) {
  if (initializer === undefined) return null;
  const literal = unwrapFreeze(initializer);
  if (literal === null || !ts.isObjectLiteralExpression(literal)) return null;
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
    if (key !== 'permissionCodes') continue;
    const array = unwrapFreeze(property.initializer);
    if (array === null || !ts.isArrayLiteralExpression(array)) return null;
    const values = [];
    for (const element of array.elements) {
      // Fail closed: anything that is not a plain string literal — a spread, a
      // reference, a template — means the list is not fully readable here, and a
      // partially read bundle must never be treated as the whole one.
      if (!ts.isStringLiteral(element)) return null;
      values.push(element.text);
    }
    return values;
  }
  return null;
}

/** `Object.freeze(x)` → `x`; anything else → itself. */
function unwrapFreeze(node) {
  if (node === undefined) return null;
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Object' &&
    node.expression.name.text === 'freeze' &&
    node.arguments.length === 1
  ) {
    return node.arguments[0];
  }
  return node;
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
 * Runs the backfill on an open client. Exported so the proof suite can drive it
 * against the real database without spawning a process; `main` below is the only
 * other caller. `bundle` is injected so the suite can pass the very constant the
 * provisioning path imports, and prove the parser above agrees with it.
 */
export async function runBackfill(client, input, bundle) {
  await client.query('BEGIN');
  try {
    // 1. The authority. An operator account holding the platform code that
    //    already sanctions writing this bundle — never a tenant principal.
    const operator = await client.query(
      `SELECT a.id, a.tenant_id
         FROM iam.user_accounts a
        WHERE lower(a.email) = $1 AND a.deleted_at IS NULL`,
      [input.operator.email]
    );
    if (operator.rowCount === 0) fail(`Refused: no account exists for ${input.operator.email}`, 4);
    if (operator.rowCount > 1) {
      fail(
        `Refused: ${operator.rowCount} accounts share ${input.operator.email}; name the operator unambiguously`,
        4
      );
    }
    const operatorAccountId = operator.rows[0].id;
    const authority = await client.query(
      `SELECT 1 FROM iam.platform_grants
        WHERE account_id = $1 AND permission_code = $2 AND revoked_at IS NULL`,
      [operatorAccountId, REQUIRED_PLATFORM_CODE]
    );
    if (authority.rowCount === 0) {
      fail(
        `Refused: account ${operatorAccountId} does not hold ${REQUIRED_PLATFORM_CODE}; this is platform maintenance, not a tenant action`,
        4
      );
    }

    // 2. The scope, resolved and named. `--all` still produces a list.
    const targets = await resolveTargets(client, input);

    // 3. One organisation at a time. Additive only; the difference is the work.
    const organisations = [];
    for (const target of targets) {
      organisations.push(await widenOne(client, input, bundle, target, operatorAccountId));
    }

    const summary = {
      operatorAccountId,
      operatorTenantId: operator.rows[0].tenant_id,
      bundleSize: bundle.length,
      considered: organisations.length,
      widened: organisations.filter((o) => o.outcome === 'widened').length,
      unchanged: organisations.filter((o) => o.outcome === 'unchanged').length,
      skipped: organisations.filter((o) => o.outcome === 'no-administrator-role').length,
      customised: organisations.filter((o) => o.outcome === 'customised').length,
      organisations,
    };

    if (input.dryRun) {
      await client.query('ROLLBACK');
      return { outcome: 'dry-run', ...summary };
    }
    await client.query('COMMIT');
    return { outcome: 'applied', ...summary };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is being discarded anyway.
    }
    throw error;
  }
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
 * ONE organisation's administrator role, widened by the set difference.
 *
 * Every statement below is a SELECT or an INSERT. There is deliberately no
 * DELETE and no UPDATE in this function, and none anywhere in this file.
 */
async function widenOne(client, input, bundle, target, operatorAccountId) {
  // The creator's home organisation is read alongside the role: a role created
  // by one of this organisation's own principals is the tenant's role, not the
  // one provisioning wrote, whatever code it carries.
  const roles = await client.query(
    `SELECT r.id, COALESCE(a.tenant_id = r.tenant_id, false) AS created_inside
       FROM iam.roles r
       LEFT JOIN iam.user_accounts a ON a.id = r.created_by
      WHERE r.tenant_id = $1 AND r.role_code = $2 AND r.deleted_at IS NULL`,
    [target.id, TARGET_ROLE_CODE]
  );
  if (roles.rowCount === 0) {
    // Reported, not repaired. Creating the role would be provisioning, and
    // would hand authority to an organisation that never held any.
    return {
      tenantId: target.id,
      tenantCode: target.tenant_code,
      status: target.status,
      outcome: 'no-administrator-role',
      roleId: null,
      heldBefore: 0,
      heldAfter: 0,
      added: [],
      blockedByDeny: [],
      customisations: [],
    };
  }
  if (roles.rowCount > 1) {
    fail(
      `Refused: organisation ${target.tenant_code} has ${roles.rowCount} live roles named ${TARGET_ROLE_CODE}; resolve by hand`,
      4
    );
  }
  const roleId = roles.rows[0].id;
  const createdInside = roles.rows[0].created_inside === true;

  const mapped = await client.query(
    `SELECT p.permission_code, rp.effect
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.tenant_id = $1 AND rp.role_id = $2`,
    [target.id, roleId]
  );
  const allow = new Set(
    mapped.rows.filter((r) => r.effect === 'allow').map((r) => r.permission_code)
  );
  const deny = new Set(
    mapped.rows.filter((r) => r.effect === 'deny').map((r) => r.permission_code)
  );

  // A deny is the tenant's own decision about its own role. Re-deciding it would
  // be an UPDATE, which this tool does not do.
  const blockedByDeny = bundle.filter((code) => deny.has(code)).sort();
  const missing = bundle.filter((code) => !allow.has(code) && !deny.has(code)).sort();

  // Every sign that the tenant has customised this role. Any one of them means
  // the role is skipped whole and reported; see "never overwrites a customised
  // role" above.
  const edits = await client.query(
    `SELECT DISTINCT r.action
       FROM iam.audit_records r
      WHERE r.tenant_id = $1
        AND r.action = ANY($3::text[])
        AND (
          EXISTS (
            SELECT 1 FROM iam.audit_record_details d
             WHERE d.tenant_id = r.tenant_id
               AND d.audit_record_id = r.id
               AND d.field_name = 'role_id'
               AND (d.new_value_masked = $2::text OR d.old_value_masked = $2::text)
          )
          OR r.entity_id IN (
            SELECT rp.id FROM iam.role_permissions rp
             WHERE rp.tenant_id = $1 AND rp.role_id = $2::uuid
          )
        )
      ORDER BY r.action`,
    [target.id, roleId, [...ROLE_MAPPING_EDIT_ACTIONS]]
  );
  const customisations = [
    ...(createdInside ? ['created-inside-organisation'] : []),
    ...[...deny].sort().map((code) => `deny:${code}`),
    ...[...allow]
      .filter((code) => !bundle.includes(code))
      .sort()
      .map((code) => `beyond-bundle:${code}`),
    ...edits.rows.map((row) => `tenant-edit:${row.action}`),
  ];

  if (customisations.length > 0) {
    // Reported, not written. `missing` is what the standard role would have
    // gained, recorded so the Owner can see exactly what was withheld and why.
    return {
      tenantId: target.id,
      tenantCode: target.tenant_code,
      status: target.status,
      outcome: 'customised',
      roleId,
      heldBefore: allow.size,
      heldAfter: allow.size,
      added: [],
      withheld: missing,
      blockedByDeny,
      customisations,
    };
  }

  if (missing.length === 0) {
    return {
      tenantId: target.id,
      tenantCode: target.tenant_code,
      status: target.status,
      outcome: 'unchanged',
      roleId,
      heldBefore: allow.size,
      heldAfter: allow.size,
      added: [],
      blockedByDeny,
      customisations,
    };
  }

  const catalogue = await client.query(
    'SELECT id, permission_code FROM iam.permissions WHERE permission_code = ANY($1::text[])',
    [missing]
  );
  const ids = new Map(catalogue.rows.map((r) => [r.permission_code, r.id]));
  const absent = missing.filter((code) => !ids.has(code));
  if (absent.length > 0) {
    // The same refusal the bootstrap makes: a role mapped to fewer codes than
    // its definition states is a silent narrowing nobody asked for.
    fail(
      `Refused: the permission catalogue lacks ${absent.length} code(s) the bundle requires: ${absent.join(', ')}`,
      5
    );
  }

  await client.query("SELECT set_config('app.user_id', $1, true)", [operatorAccountId]);
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [target.id]);
  for (const code of missing) {
    await client.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       VALUES ($1, $2, $3, 'allow', $4)`,
      [target.id, roleId, ids.get(code), operatorAccountId]
    );
  }

  const audit = await client.query(
    `SELECT iam.audit_append(
        p_tenant => $1, p_actor => $2, p_actor_kind => 'system',
        p_action => $3, p_entity_type => 'iam.role', p_entity_id => $4,
        p_details => $5::jsonb
     ) AS id`,
    [
      target.id,
      operatorAccountId,
      BACKFILL_AUDIT_ACTION,
      roleId,
      JSON.stringify([
        { field: 'permission_codes_added', old: null, new: missing.join(','), class: 'public' },
        {
          field: 'allow_mapping_count',
          old: String(allow.size),
          new: String(allow.size + missing.length),
          class: 'public',
        },
        { field: 'role_code', old: null, new: TARGET_ROLE_CODE, class: 'public' },
        { field: 'environment', old: null, new: input.environment, class: 'public' },
      ]),
    ]
  );

  return {
    tenantId: target.id,
    tenantCode: target.tenant_code,
    status: target.status,
    outcome: 'widened',
    roleId,
    heldBefore: allow.size,
    heldAfter: allow.size + missing.length,
    added: missing,
    blockedByDeny,
    customisations,
    auditRecordId: audit.rows[0].id,
  };
}

function writeEvidence(input, bundle, result) {
  const path =
    input.evidencePath !== ''
      ? resolve(input.evidencePath)
      : resolve(
          `.tmp/tenant-administrator-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );
  mkdirSync(dirname(path), { recursive: true });
  const evidence = {
    what: 'tenant administrator bundle backfill (P1-31 Owner decision D-2, CC-11)',
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
    bundle: { size: bundle.length, codes: [...bundle].sort() },
    result,
    revoked: 'nothing — this tool issues no DELETE and no UPDATE',
    secrets: 'none — no password, key or token is recorded here',
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

async function main() {
  const input = readBackfillInput();
  const bundle = readTenantAdministratorBundle();
  const client = new pg.Client(input.db);
  await client.connect();
  let result;
  try {
    result = await runBackfill(client, input, bundle);
  } finally {
    await client.end();
  }
  const path = writeEvidence(input, bundle, result);
  console.log(`Tenant administrator bundle backfill: ${result.outcome}`);
  console.log(`  operator account  ${result.operatorAccountId}`);
  console.log(`  bundle            ${result.bundleSize} codes`);
  console.log(
    `  organisations     ${result.considered} considered, ${result.widened} widened, ${result.unchanged} already current, ${result.customised} customised and left alone, ${result.skipped} without a ${TARGET_ROLE_CODE} role`
  );
  for (const organisation of result.organisations) {
    const detail =
      organisation.outcome === 'widened'
        ? `${organisation.heldBefore} -> ${organisation.heldAfter} (+${organisation.added.length}: ${organisation.added.join(', ')})`
        : organisation.outcome === 'unchanged'
          ? `${organisation.heldBefore} codes, already current`
          : organisation.outcome === 'customised'
            ? `${organisation.heldBefore} codes, customised, nothing written (would have added: ${organisation.withheld.join(', ') || 'nothing'})`
            : `no ${TARGET_ROLE_CODE} role`;
    console.log(
      `    ${organisation.tenantCode.padEnd(24)} ${organisation.outcome.padEnd(22)} ${detail}`
    );
    if (organisation.customisations.length > 0) {
      console.log(`      customised: ${organisation.customisations.join(', ')}`);
    }
  }
  console.log(`  evidence          ${path}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Tenant administrator bundle backfill refused: ${error.message}`);
    process.exit(error instanceof BackfillRefused ? error.exitCode : 1);
  });
}
