#!/usr/bin/env node
/**
 * Module entitlement inventory and proposed mapping: a READ-ONLY analysis.
 *
 * The Owner decided on 2026-10-03 how module entitlements are to be introduced
 * for existing organisations (ADR-024, amendment of that date): before anything
 * is enforced, inventory what each existing company actually uses and depends
 * on, and prepare a reviewed, explicit mapping from existing access to initial
 * entitlements that proves no access is removed and none is added. This tool
 * produces that inventory, the proposed mapping (rules R1 to R6 in
 * `entitlement-inventory-model.mjs`) and the proof. The analysis that quotes its
 * aggregated result is `docs/platform/module-entitlement-inventory-2026-10-04.md`.
 *
 * ## What it never does
 *
 *   - It writes nothing to any database. Every statement runs inside
 *     `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` and ends with
 *     `ROLLBACK`; every statement other than those two passes
 *     `assertReadOnlySql` first, which refuses anything but a single SELECT or
 *     WITH with side-effect-free calls. Each transaction also confirms the
 *     server reports it read-only and that no transaction id was assigned.
 *   - It enforces nothing, applies nothing and registers no flag.
 *   - It writes no file inside a git work tree: `--out` inside this repository,
 *     or under any directory holding `.git`, is refused. The output names
 *     tenants by id and code, so it belongs in a private evidence folder.
 *   - It holds no tenant identifier. Tenant classes beyond what the database
 *     says (status, platform operator) come from an optional private label file.
 *
 * ## Usage
 *
 *   node scripts/platform/entitlement-inventory.mjs --out <file.json>
 *     [--db-host 127.0.0.1] [--db-port 54322] [--db-name postgres]
 *     [--labels <tenant-class-labels.json>]
 *
 *   DB_USER / DB_PASSWORD   the connection's account (default postgres)
 *
 * The label file is a JSON object from tenant id to a short class label.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import pg from 'pg';
import { parseModule } from '../lib/typescript-source.mjs';
import { API_ROUTES_ROOT, REPOSITORY_ROOT, toRepositoryPath } from '../lib/repository-paths.mjs';
import {
  CANDIDATE_MODULES,
  CORE,
  MODULE_KEYS,
  TRANSACTION_BEGIN,
  TRANSACTION_END,
  aggregate,
  assertReadOnlySql,
  classifyAuditAction,
  classifyCode,
  classifyOperation,
  effectiveCodesByUser,
  proposeEntitlements,
  proveReachability,
  rowCountQuery,
  stableStringify,
  tableCountQuery,
} from './entitlement-inventory-model.mjs';

/** Every fixed statement the inventory sends. Dynamic ones are built by the model. */
export const QUERIES = Object.freeze({
  transactionState:
    "SELECT current_setting('transaction_read_only') AS read_only, " +
    'pg_current_xact_id_if_assigned()::text AS xid, ' +
    '(extract(epoch FROM now()) * 1000000)::bigint::text AS now_micros',
  ledgerPresent:
    "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present",
  ledger:
    'SELECT count(*)::int AS migrations, max(version) AS latest ' +
    'FROM supabase_migrations.schema_migrations',
  tenants: 'SELECT id::text AS tenant_id, tenant_code, status FROM org.tenants ORDER BY id',
  operatorTenants:
    'SELECT DISTINCT a.tenant_id::text AS tenant_id FROM iam.platform_grants g ' +
    'JOIN iam.user_accounts a ON a.id = g.account_id WHERE g.revoked_at IS NULL',
  users:
    'SELECT id::text AS user_id, tenant_id::text AS tenant_id, status, ' +
    '(deleted_at IS NULL) AS live FROM iam.user_accounts ORDER BY id',
  permissions: 'SELECT permission_code AS code FROM iam.permissions ORDER BY permission_code',
  grantMappings:
    'SELECT g.tenant_id::text AS tenant_id, g.user_id::text AS user_id, ' +
    'p.permission_code AS code, rp.effect, g.status AS grant_status, ' +
    '(extract(epoch FROM g.valid_from) * 1000000)::bigint::text AS valid_from_micros, ' +
    '(extract(epoch FROM g.valid_to) * 1000000)::bigint::text AS valid_to_micros ' +
    'FROM iam.role_grants g ' +
    'JOIN iam.role_permissions rp ON rp.tenant_id = g.tenant_id AND rp.role_id = g.role_id ' +
    'JOIN iam.permissions p ON p.id = rp.permission_id',
  administratorRoles:
    'SELECT r.tenant_id::text AS tenant_id, ' +
    "count(rp.role_id) FILTER (WHERE rp.effect = 'allow')::int AS allow_count " +
    'FROM iam.roles r LEFT JOIN iam.role_permissions rp ' +
    'ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id ' +
    "WHERE r.role_code = 'tenant_administrator' AND r.deleted_at IS NULL " +
    'GROUP BY r.tenant_id, r.id',
  auditActions:
    'SELECT tenant_id::text AS tenant_id, action, count(*)::int AS n ' +
    'FROM iam.audit_records GROUP BY tenant_id, action',
  plans:
    'SELECT count(*)::int AS plans, ' +
    "count(*) FILTER (WHERE entitlement_document <> '{}'::jsonb)::int AS plans_with_entitlements " +
    'FROM org.subscription_plans',
  configuration:
    'SELECT (SELECT count(*) FROM org.feature_flags)::int AS feature_flags, ' +
    '(SELECT count(*) FROM org.tenant_feature_overrides)::int AS tenant_overrides, ' +
    '(SELECT count(*) FROM org.company_settings)::int AS company_settings, ' +
    '(SELECT count(*) FROM org.branch_settings)::int AS branch_settings, ' +
    "(SELECT count(DISTINCT tenant_id) FROM org.tenant_subscriptions WHERE status = 'active')::int " +
    'AS tenants_with_active_subscription',
  tenantScopedTables:
    "SELECT table_schema || '.' || table_name AS qualified FROM information_schema.columns " +
    "WHERE column_name = 'tenant_id'",
});

/** Tables counted before and after, to show the run changed nothing. */
export const SNAPSHOT_TABLES = Object.freeze([
  'org.tenants',
  'org.feature_flags',
  'org.tenant_feature_overrides',
  'org.subscription_plans',
  'org.tenant_subscriptions',
  'iam.user_accounts',
  'iam.roles',
  'iam.role_permissions',
  'iam.role_grants',
  'iam.grant_scopes',
  'iam.platform_grants',
  'iam.audit_records',
  'iam.security_events',
  ...CANDIDATE_MODULES.flatMap((module) => module.mainTables),
]);

export class InventoryRefused extends Error {}

/* ------------------------------------------------------------------------- *
 * Inputs
 * ------------------------------------------------------------------------- */

export function parseArguments(argv) {
  const options = { host: '127.0.0.1', port: 54322, database: 'postgres', out: '', labels: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const take = () => {
      if (value === undefined || value.startsWith('--')) {
        throw new InventoryRefused(`${flag} needs a value`);
      }
      index += 1;
      return value;
    };
    if (flag === '--db-host') options.host = take();
    else if (flag === '--db-port') options.port = Number(take());
    else if (flag === '--db-name') options.database = take();
    else if (flag === '--out') options.out = take();
    else if (flag === '--labels') options.labels = take();
    else throw new InventoryRefused(`unknown argument ${flag}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new InventoryRefused('--db-port must be a port number');
  }
  if (options.out === '') throw new InventoryRefused('--out is required');
  return options;
}

/**
 * Refuses an output path inside this repository or inside any git work tree:
 * the output names tenants, and no tenant identifier may enter a tracked file.
 */
export function assertOutsideRepository(
  outPath,
  { repositoryRoot = REPOSITORY_ROOT, exists = existsSync } = {}
) {
  const target = resolve(outPath);
  const fromRoot = relative(resolve(repositoryRoot), target);
  if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) {
    throw new InventoryRefused(`refusing to write inside the repository: ${target}`);
  }
  let directory = dirname(target);
  for (;;) {
    if (exists(join(directory, '.git'))) {
      throw new InventoryRefused(`refusing to write inside a git work tree: ${directory}`);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return target;
}

const LABEL = /^[a-z][a-z0-9-]{0,30}$/;

export function readLabels(path) {
  if (!path) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InventoryRefused('the label file must be a JSON object');
  }
  for (const [tenantId, label] of Object.entries(parsed)) {
    if (typeof label !== 'string' || !LABEL.test(label)) {
      throw new InventoryRefused(`bad label for ${tenantId}`);
    }
  }
  return parsed;
}

/* ------------------------------------------------------------------------- *
 * The operation registry, parsed (never pattern-matched)
 * ------------------------------------------------------------------------- */

const literalText = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** Every `defineOperation({...})` literal in one source text. Fails closed. */
export function parseOperationsFromSource(source, file) {
  const sourceFile = parseModule(source);
  if (!sourceFile) throw new InventoryRefused(`${file}: does not parse`);
  const operations = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineOperation'
    ) {
      const argument = node.arguments[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) {
        throw new InventoryRefused(`${file}: defineOperation without an object literal`);
      }
      const fields = {};
      for (const property of argument.properties) {
        if (!ts.isPropertyAssignment(property)) {
          throw new InventoryRefused(`${file}: defineOperation with a computed member`);
        }
        const name = ts.isIdentifier(property.name)
          ? property.name.text
          : literalText(property.name);
        if (name === null) throw new InventoryRefused(`${file}: computed property name`);
        fields[name] = property.initializer;
      }
      const id = literalText(fields.id);
      const module = literalText(fields.module);
      if (id === null || module === null) {
        throw new InventoryRefused(`${file}: defineOperation without a literal id and module`);
      }
      let permissions = [];
      if (fields.permissions !== undefined) {
        if (!ts.isArrayLiteralExpression(fields.permissions)) {
          throw new InventoryRefused(`${file}: ${id} permissions are not a literal array`);
        }
        permissions = fields.permissions.elements.map((element) => {
          const code = literalText(element);
          if (code === null) throw new InventoryRefused(`${file}: ${id} has a computed code`);
          return code;
        });
      }
      const isPublic =
        fields.public !== undefined && fields.public.kind === ts.SyntaxKind.TrueKeyword;
      operations.push({ id, module, permissions, public: isPublic, file });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return operations;
}

function routeFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(path));
    else if (entry.isFile() && entry.name === 'route.ts') found.push(path);
  }
  return found.sort();
}

export function readOperations(root = API_ROUTES_ROOT) {
  const operations = [];
  for (const file of routeFiles(root)) {
    operations.push(
      ...parseOperationsFromSource(readFileSync(file, 'utf8'), toRepositoryPath(file))
    );
  }
  const unmapped = operations.filter((operation) => classifyOperation(operation) === null);
  if (unmapped.length > 0) {
    throw new InventoryRefused(
      `operations with no candidate module: ${unmapped.map((o) => o.id).join(', ')}`
    );
  }
  return operations.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/* ------------------------------------------------------------------------- *
 * Reading, always read-only
 * ------------------------------------------------------------------------- */

/**
 * Runs `work(query)` inside one read-only transaction. `query` refuses any
 * statement the guard does not accept. The transaction is rolled back always.
 */
export async function inReadOnlyTransaction(client, work) {
  await client.query(TRANSACTION_BEGIN);
  try {
    const query = async (sql) => {
      assertReadOnlySql(sql);
      const result = await client.query(sql);
      return result.rows;
    };
    const [opening] = await query(QUERIES.transactionState);
    if (opening?.read_only !== 'on') {
      throw new InventoryRefused('the server does not report the transaction read-only');
    }
    const result = await work(query, opening);
    const [closing] = await query(QUERIES.transactionState);
    if (closing?.xid !== null && closing?.xid !== undefined) {
      throw new InventoryRefused('a transaction id was assigned: something wrote');
    }
    return { result, readOnly: opening.read_only, xidAssigned: closing?.xid ?? null };
  } finally {
    await client.query(TRANSACTION_END);
  }
}

/** Migration ledger and whole-table row counts, for the before and after proof. */
export async function readSnapshot(query) {
  const [presence] = await query(QUERIES.ledgerPresent);
  const ledger = presence?.present ? ((await query(QUERIES.ledger))[0] ?? null) : null;
  const counts = {};
  for (const table of SNAPSHOT_TABLES) {
    const [row] = await query(tableCountQuery(table));
    counts[table] = row?.n ?? null;
  }
  return { ledger, counts };
}

/** Every input the computation needs, read in one snapshot. */
export async function readInventoryData(query, opening) {
  const tenantScoped = new Set(
    (await query(QUERIES.tenantScopedTables)).map((row) => row.qualified)
  );
  const missing = CANDIDATE_MODULES.flatMap((module) => module.mainTables).filter(
    (table) => !tenantScoped.has(table)
  );
  if (missing.length > 0) {
    throw new InventoryRefused(`main tables without a tenant column: ${missing.join(', ')}`);
  }
  const rowCounts = {};
  for (const module of CANDIDATE_MODULES) {
    for (const table of module.mainTables) {
      rowCounts[table] = (await query(rowCountQuery(table))).map((row) => ({
        tenantId: row.tenant_id,
        n: Number(row.n),
      }));
    }
  }
  return {
    nowMicros: opening.now_micros,
    tenants: (await query(QUERIES.tenants)).map((row) => ({
      tenantId: row.tenant_id,
      tenantCode: row.tenant_code,
      status: row.status,
    })),
    operatorTenantIds: (await query(QUERIES.operatorTenants)).map((row) => row.tenant_id).sort(),
    users: (await query(QUERIES.users)).map((row) => ({
      userId: row.user_id,
      tenantId: row.tenant_id,
      status: row.status,
      live: row.live === true,
    })),
    permissionCodes: (await query(QUERIES.permissions)).map((row) => row.code),
    mappings: (await query(QUERIES.grantMappings)).map((row) => ({
      tenantId: row.tenant_id,
      userId: row.user_id,
      code: row.code,
      effect: row.effect,
      grantStatus: row.grant_status,
      validFromMicros: row.valid_from_micros,
      validToMicros: row.valid_to_micros,
    })),
    administratorRoles: (await query(QUERIES.administratorRoles)).map((row) => ({
      tenantId: row.tenant_id,
      allowCount: Number(row.allow_count),
    })),
    auditActions: (await query(QUERIES.auditActions)).map((row) => ({
      tenantId: row.tenant_id,
      action: row.action,
      n: Number(row.n),
    })),
    plans: (await query(QUERIES.plans))[0] ?? null,
    configuration: (await query(QUERIES.configuration))[0] ?? null,
    rowCounts,
  };
}

/* ------------------------------------------------------------------------- *
 * The computation: pure, so running it twice must give the same bytes
 * ------------------------------------------------------------------------- */

const addTo = (map, key, value) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
};

export function computeInventory(data, operations, labels = {}) {
  const unmappedCodes = data.permissionCodes.filter((code) => classifyCode(code) === null);
  if (unmappedCodes.length > 0) {
    throw new InventoryRefused(`permission codes with no module: ${unmappedCodes.join(', ')}`);
  }
  const operatorIds = new Set(data.operatorTenantIds);
  const tenants = data.tenants.map((tenant) => ({
    ...tenant,
    operator: operatorIds.has(tenant.tenantId),
  }));
  const classOf = (tenantId) => {
    const tenant = tenants.find((row) => row.tenantId === tenantId);
    if (!tenant) return 'unknown';
    if (tenant.operator) return 'operator';
    if (tenant.status !== 'active') return tenant.status;
    return labels[tenantId] ?? 'unlabelled';
  };

  const activeUsers = data.users.filter((user) => user.status === 'active' && user.live);
  const codesByUser = effectiveCodesByUser(data.users, data.mappings, data.nowMicros);

  const heldModules = new Map();
  for (const user of activeUsers) {
    for (const code of codesByUser.get(user.userId) ?? []) {
      const module = classifyCode(code);
      if (module !== CORE) addTo(heldModules, user.tenantId, module);
    }
  }
  const rowModules = new Map();
  for (const module of CANDIDATE_MODULES) {
    for (const table of module.mainTables) {
      for (const row of data.rowCounts[table] ?? []) {
        if (row.n > 0) addTo(rowModules, row.tenantId, module.key);
      }
    }
  }
  const auditModules = new Map();
  const unmappedAudit = new Map();
  for (const row of data.auditActions) {
    const module = classifyAuditAction(row.action);
    if (module === null)
      unmappedAudit.set(row.action, (unmappedAudit.get(row.action) ?? 0) + row.n);
    else if (module !== CORE) addTo(auditModules, row.tenantId, module);
  }

  const entitlements = proposeEntitlements({ tenants, heldModules, rowModules, auditModules });
  const proof = proveReachability({ users: activeUsers, codesByUser, operations, entitlements });

  const operationsByModule = {};
  const codesByModule = {};
  for (const operation of operations) {
    const key = classifyOperation(operation);
    operationsByModule[key] = (operationsByModule[key] ?? 0) + 1;
  }
  for (const code of data.permissionCodes) {
    const key = classifyCode(code);
    codesByModule[key] = (codesByModule[key] ?? 0) + 1;
  }
  const apiModulesByCandidate = {};
  for (const operation of operations) {
    const key = classifyOperation(operation);
    apiModulesByCandidate[key] = [
      ...new Set([...(apiModulesByCandidate[key] ?? []), operation.module]),
    ].sort();
  }

  const aggregates = aggregate({
    tenants,
    classOf,
    entitlements,
    proof,
    adminRoles: data.administratorRoles,
    activeUsers,
    codesByUser,
  });
  aggregates.configuration = {
    plans: data.plans?.plans ?? null,
    plansWithEntitlements: data.plans?.plans_with_entitlements ?? null,
    featureFlags: data.configuration?.feature_flags ?? null,
    tenantOverrides: data.configuration?.tenant_overrides ?? null,
    companySettings: data.configuration?.company_settings ?? null,
    branchSettings: data.configuration?.branch_settings ?? null,
    tenantsWithActiveSubscription: data.configuration?.tenants_with_active_subscription ?? null,
  };
  aggregates.audit = {
    distinctActions: new Set(data.auditActions.map((row) => row.action)).size,
    unmappedActions: unmappedAudit.size,
    unmappedRecords: [...unmappedAudit.values()].reduce((sum, n) => sum + n, 0),
  };
  aggregates.catalogue = {
    operations: operations.length,
    operationsWithCodes: operations.filter((o) => !o.public && o.permissions.length > 0).length,
    operationsByModule,
    apiModulesByCandidate,
    permissionCodes: data.permissionCodes.length,
    codesByModule,
  };
  aggregates.proof.tenantsWhereEntitledExceedsEvidence = entitlements.filter(
    (row) => row.forced.length > 0
  ).length;

  return {
    aggregates,
    mapping: entitlements.map((row) => ({ tenantId: row.tenantId, modules: row.modules })),
    privateDetail: {
      tenants: entitlements.map((row) => {
        const tenant = tenants.find((entry) => entry.tenantId === row.tenantId);
        return {
          ...row,
          tenantCode: tenant?.tenantCode ?? null,
          status: tenant?.status ?? null,
          class: classOf(row.tenantId),
          entitledModules: MODULE_KEYS.filter((key) => row.modules[key]),
        };
      }),
      differingUsers: proof
        .filter((outcome) => !outcome.identical)
        .map(({ userId, tenantId, removed, added }) => ({ userId, tenantId, removed, added })),
      unmappedAuditActions: Object.fromEntries([...unmappedAudit.entries()].sort()),
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Main
 * ------------------------------------------------------------------------- */

export async function runInventory(client, operations, labels) {
  const before = await inReadOnlyTransaction(client, (query) => readSnapshot(query));
  const first = await inReadOnlyTransaction(client, (query, opening) =>
    readInventoryData(query, opening)
  );
  const second = await inReadOnlyTransaction(client, (query, opening) =>
    readInventoryData(query, opening)
  );
  const after = await inReadOnlyTransaction(client, (query) => readSnapshot(query));

  const computed = computeInventory(first.result, operations, labels);
  const recomputed = computeInventory(first.result, operations, labels);
  const fromSecondRead = computeInventory(second.result, operations, labels);
  const digest = (value) => stableStringify(value);

  return {
    computed,
    idempotency: {
      sameDataTwiceIdentical: digest(computed) === digest(recomputed),
      secondReadMappingIdentical: digest(computed.mapping) === digest(fromSecondRead.mapping),
      secondReadAggregatesIdentical:
        digest(computed.aggregates) === digest(fromSecondRead.aggregates),
    },
    readOnlyProof: {
      transactions: [before, first, second, after].map((run) => ({
        readOnly: run.readOnly,
        xidAssigned: run.xidAssigned,
      })),
      before: before.result,
      after: after.result,
      ledgerUnchanged: digest(before.result.ledger) === digest(after.result.ledger),
      rowCountsUnchanged: digest(before.result.counts) === digest(after.result.counts),
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outPath = assertOutsideRepository(options.out);
  const labels = readLabels(options.labels);
  const operations = readOperations();
  const client = new pg.Client({
    host: options.host,
    port: options.port,
    database: options.database,
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  });
  await client.connect();
  let outcome;
  try {
    outcome = await runInventory(client, operations, labels);
  } finally {
    await client.end();
  }
  const document = {
    tool: 'scripts/platform/entitlement-inventory.mjs',
    generatedAt: new Date().toISOString(),
    database: { host: options.host, port: options.port, name: options.database },
    statement: 'Read-only analysis. Nothing was enforced, applied or written to any database.',
    ...outcome,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const { aggregates } = outcome.computed;
  const { idempotency, readOnlyProof } = outcome;
  console.log(`Entitlement inventory written to ${outPath}`);
  console.log(`  tenants ${aggregates.tenants.total}; active users ${aggregates.users.active}`);
  console.log(
    `  proof: ${aggregates.proof.identical}/${aggregates.proof.usersCompared} users identical; ` +
      `tenants with forced additions ${aggregates.mapping.tenantsWithForcedAdditions}`
  );
  console.log(
    `  idempotent ${idempotency.sameDataTwiceIdentical && idempotency.secondReadMappingIdentical}; ` +
      `ledger unchanged ${readOnlyProof.ledgerUnchanged}; row counts unchanged ${readOnlyProof.rowCountsUnchanged}`
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Entitlement inventory refused: ${error.message}`);
    process.exit(error instanceof InventoryRefused ? 3 : 1);
  });
}
