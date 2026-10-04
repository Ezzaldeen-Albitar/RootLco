/**
 * Module entitlement inventory: the pure half.
 *
 * Everything in this file is a function of its arguments. It reads no database,
 * no file and no clock, so every rule the inventory applies can be tested with
 * synthetic, in-test data (`tests/unit/entitlement-inventory.test.ts`). The
 * read-only database half lives in `entitlement-inventory.mjs`.
 *
 * ## What it answers
 *
 * The Owner decided on 2026-10-03 HOW module entitlements are to be introduced
 * for existing organisations (ADR-024, amendment of that date): no company is
 * given every module, no package is assigned silently, and before anything is
 * enforced an explicit mapping from today's access to initial entitlements is
 * prepared and reviewed, proving that no access is removed and none is added.
 * This file holds the candidate module catalogue, the mapping rules R1 to R6 and
 * the proof. It decides nothing and enforces nothing: the module names below are
 * CANDIDATES, not approved names.
 *
 * ## The rules, as code
 *
 *   R1  the unit is the tenant.
 *   R2  a module is entitled iff an active user of the tenant effectively holds
 *       one of its codes (the has_permission semantics: an active, live account
 *       in the tenant, an active grant inside its validity window, an allow
 *       mapping and no deny mapping for the code), OR the tenant has business
 *       rows in one of the module's main tables, OR the tenant's audit trail
 *       holds an action of the module, OR the module is a forced dependency of
 *       a module entitled by the first three.
 *   R3  core (iam, org, platform, shared) is not a flag, and the platform
 *       operator's tenant is given no module.
 *   R4  the result is an explicit row per tenant and module, true or false, so
 *       it never depends on a flag default or on a plan document.
 *   R5  the mapping writes no role, grant or permission row (nothing here can).
 *   R6  forced dependencies close the entitled set, and the closure reports
 *       exactly what it added.
 */

/** Candidate licensable modules. Names are candidates, not approved names. */
export const CANDIDATE_MODULES = Object.freeze([
  {
    key: 'crm',
    apiModules: ['crm'],
    codePrefixes: ['crm.'],
    auditPrefixes: ['crm.'],
    mainTables: ['crm.business_partners'],
  },
  {
    key: 'vehicle',
    apiModules: ['vehicle'],
    codePrefixes: ['veh.'],
    auditPrefixes: ['veh.'],
    mainTables: ['veh.vehicles'],
  },
  {
    key: 'appointments',
    apiModules: [],
    operationIdPrefixes: ['apt.'],
    codePrefixes: ['apt.'],
    auditPrefixes: ['apt.'],
    mainTables: ['apt.appointments'],
  },
  {
    key: 'reception',
    apiModules: ['reception'],
    codePrefixes: ['rec.'],
    auditPrefixes: ['rec.'],
    mainTables: ['rec.reception_visits'],
  },
  {
    key: 'work-order',
    apiModules: ['work-order'],
    codePrefixes: ['wo.'],
    auditPrefixes: ['wo.'],
    mainTables: ['wo.work_orders'],
  },
  {
    key: 'technician',
    apiModules: ['technician'],
    codePrefixes: ['tech.'],
    auditPrefixes: ['tech.'],
    mainTables: ['tech.technician_profiles', 'tech.labor_sessions'],
  },
  {
    key: 'diagnostics',
    apiModules: ['diagnostics'],
    codePrefixes: ['dia.'],
    auditPrefixes: ['dia.'],
    mainTables: ['dia.diagnostic_reports', 'dia.inspection_templates'],
  },
  {
    key: 'quality',
    apiModules: ['quality'],
    codePrefixes: ['qms.'],
    auditPrefixes: ['qms.'],
    mainTables: ['qms.quality_control_records'],
  },
  {
    key: 'delivery',
    apiModules: ['delivery'],
    codePrefixes: ['sal.delivery.'],
    auditPrefixes: ['sal.delivery', 'sal.authorized_receiver'],
    mainTables: ['sal.delivery_records'],
  },
  {
    key: 'warranty',
    apiModules: ['warranty'],
    codePrefixes: ['wty.'],
    auditPrefixes: ['wty.'],
    mainTables: ['wty.warranty_records', 'wty.warranty_policies'],
  },
  {
    key: 'service-catalog',
    apiModules: ['service-catalog'],
    codePrefixes: ['svc.service.'],
    auditPrefixes: ['svc.service', 'svc.branch_availability', 'svc.branch_service_availability'],
    mainTables: ['svc.services'],
  },
  {
    key: 'pricing',
    apiModules: ['pricing'],
    codePrefixes: ['svc.price.'],
    auditPrefixes: ['svc.price', 'svc.discount', 'svc.pricing'],
    mainTables: ['svc.price_lists'],
  },
  {
    key: 'quotation',
    apiModules: ['quotation'],
    codePrefixes: ['quo.'],
    auditPrefixes: ['quo.'],
    mainTables: ['quo.quotations'],
  },
  {
    key: 'billing',
    apiModules: ['billing'],
    codePrefixes: ['sal.invoice.', 'sal.credit.', 'sal.finance.'],
    auditPrefixes: ['sal.invoice', 'sal.credit_note', 'sal.counter_sale'],
    mainTables: ['sal.invoices', 'sal.credit_notes'],
  },
  {
    key: 'payments',
    apiModules: ['payments'],
    codePrefixes: ['sal.payment.', 'sal.reversal.'],
    auditPrefixes: ['sal.payment', 'sal.receipt'],
    mainTables: ['sal.receipts'],
  },
  {
    key: 'inventory',
    apiModules: ['inventory'],
    codePrefixes: ['inv.'],
    auditPrefixes: ['inv.'],
    mainTables: ['inv.item_master', 'inv.stock_movements'],
  },
  {
    key: 'reporting',
    apiModules: ['reporting'],
    codePrefixes: ['rpt.'],
    auditPrefixes: ['rpt.'],
    mainTables: ['rpt.report_configurations', 'rpt.saved_filters'],
  },
]);

export const MODULE_KEYS = Object.freeze(CANDIDATE_MODULES.map((candidate) => candidate.key));

/** Core: never a flag (R3). */
export const CORE = 'core';
export const CORE_API_MODULES = Object.freeze([
  'iam',
  'platform',
  'shared-services',
  'meta',
  'overview',
]);
export const CORE_PREFIXES = Object.freeze(['iam.', 'org.', 'platform.', 'shared.']);

/**
 * Forced dependencies (R6). Each edge says: a tenant entitled to `from` cannot
 * use it today without `to`, because the code calls or reads `to`
 * unconditionally. The basis names the coupling in the architecture assessment
 * of 2026-10-01 where one exists.
 */
export const FORCED_DEPENDENCIES = Object.freeze([
  { from: 'work-order', to: 'inventory', basis: 'C-06 closure calls inventory' },
  { from: 'delivery', to: 'inventory', basis: 'C-06 delivery readiness calls inventory' },
  { from: 'billing', to: 'inventory', basis: 'C-11 billing imports inventory' },
  { from: 'delivery', to: 'billing', basis: 'delivery reads the open receivable' },
  { from: 'quotation', to: 'work-order', basis: 'C-09 a quotation requires a work order' },
  { from: 'payments', to: 'billing', basis: 'receipts are allocated to invoices' },
  { from: 'billing', to: 'crm', basis: 'counter sales name a customer' },
]);

/** Longest-prefix match over a list of [prefix, value] pairs; null when none. */
function longestPrefix(text, pairs) {
  let best = null;
  let bestLength = -1;
  for (const [prefix, value] of pairs) {
    if (text.startsWith(prefix) && prefix.length > bestLength) {
      best = value;
      bestLength = prefix.length;
    }
  }
  return best;
}

const CODE_PAIRS = [
  ...CORE_PREFIXES.map((prefix) => [prefix, CORE]),
  ...CANDIDATE_MODULES.flatMap((candidate) =>
    candidate.codePrefixes.map((prefix) => [prefix, candidate.key])
  ),
];
const AUDIT_PAIRS = [
  ...CORE_PREFIXES.map((prefix) => [prefix, CORE]),
  ...CANDIDATE_MODULES.flatMap((candidate) =>
    candidate.auditPrefixes.map((prefix) => [prefix, candidate.key])
  ),
];

/** The candidate module a permission code belongs to, `core`, or null. */
export function classifyCode(code) {
  return longestPrefix(String(code), CODE_PAIRS);
}

/** The candidate module an audit action belongs to, `core`, or null. */
export function classifyAuditAction(action) {
  return longestPrefix(String(action), AUDIT_PAIRS);
}

/**
 * The candidate module an operation belongs to, `core`, or null. An operation
 * id prefix wins over the API module, which is how the appointment operations
 * that live inside the reception API module are told apart.
 */
export function classifyOperation(operation) {
  for (const candidate of CANDIDATE_MODULES) {
    for (const prefix of candidate.operationIdPrefixes ?? []) {
      if (operation.id.startsWith(prefix)) return candidate.key;
    }
  }
  if (CORE_API_MODULES.includes(operation.module)) return CORE;
  const owner = CANDIDATE_MODULES.find((candidate) =>
    candidate.apiModules.includes(operation.module)
  );
  return owner ? owner.key : null;
}

const toBigInt = (value) => (value === null || value === undefined ? null : BigInt(value));

/**
 * Effective permission codes per user, with the has_permission semantics:
 * the account is active, not deleted and in the grant's tenant; the grant is
 * active and inside its validity window at `nowMicros`; an allow mapping exists
 * and no deny mapping exists for the code across all of the user's live grants.
 *
 * `users`: [{ userId, tenantId, status, live }]
 * `mappings`: [{ tenantId, userId, code, effect, grantStatus, validFromMicros,
 *               validToMicros }]  (micros as decimal strings or null)
 * Returns Map(userId -> sorted array of codes).
 */
export function effectiveCodesByUser(users, mappings, nowMicros) {
  const now = BigInt(nowMicros);
  const accounts = new Map(users.map((user) => [user.userId, user]));
  const allow = new Map();
  const deny = new Map();
  for (const row of mappings) {
    const account = accounts.get(row.userId);
    if (!account || account.status !== 'active' || account.live !== true) continue;
    if (account.tenantId !== row.tenantId) continue;
    if (row.grantStatus !== 'active') continue;
    const from = toBigInt(row.validFromMicros);
    const to = toBigInt(row.validToMicros);
    if (from === null || from > now) continue;
    if (to !== null && to <= now) continue;
    const target = row.effect === 'allow' ? allow : row.effect === 'deny' ? deny : null;
    if (!target) continue;
    if (!target.has(row.userId)) target.set(row.userId, new Set());
    target.get(row.userId).add(row.code);
  }
  const result = new Map();
  for (const user of users) {
    if (user.status !== 'active' || user.live !== true) continue;
    const allowed = allow.get(user.userId) ?? new Set();
    const denied = deny.get(user.userId) ?? new Set();
    result.set(user.userId, [...allowed].filter((code) => !denied.has(code)).sort());
  }
  return result;
}

/**
 * Operations a holder of `codes` can reach: every declared code held
 * (conjunction, the operation registry's semantics). Public operations and
 * operations with no codes are not part of the comparison. `allow`, when
 * given, is an extra filter (the proposed entitlements).
 */
export function reachableOperations(codes, operations, allow = () => true) {
  const held = new Set(codes);
  return operations
    .filter((operation) => !operation.public && operation.permissions.length > 0)
    .filter((operation) => operation.permissions.every((code) => held.has(code)))
    .filter((operation) => allow(operation))
    .map((operation) => operation.id)
    .sort();
}

/** The closure of `base` under the forced dependencies, and what it added. */
export function closeOverDependencies(base, dependencies = FORCED_DEPENDENCIES) {
  const entitled = new Set(base);
  const forced = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of dependencies) {
      if (entitled.has(edge.from) && !entitled.has(edge.to)) {
        entitled.add(edge.to);
        forced.set(edge.to, `${edge.from} -> ${edge.to} (${edge.basis})`);
        changed = true;
      }
    }
  }
  return {
    entitled: [...entitled].sort(),
    forced: [...forced.keys()].sort(),
    forcedBy: Object.fromEntries([...forced.entries()].sort()),
  };
}

/**
 * Applies R1 to R6.
 *
 * `tenants`: [{ tenantId, status, operator }]
 * `heldModules`, `rowModules`, `auditModules`: Map(tenantId -> Set(module))
 * Returns [{ tenantId, operator, base: {...}, modules: {key: boolean},
 *            forced: [...] }] sorted by tenant id, with every module key present.
 */
export function proposeEntitlements({ tenants, heldModules, rowModules, auditModules }) {
  const sorted = [...tenants].sort((a, b) => (a.tenantId < b.tenantId ? -1 : 1));
  return sorted.map((tenant) => {
    const held = [...(heldModules.get(tenant.tenantId) ?? [])].filter((m) => m !== CORE).sort();
    const rows = [...(rowModules.get(tenant.tenantId) ?? [])].filter((m) => m !== CORE).sort();
    const audit = [...(auditModules.get(tenant.tenantId) ?? [])].filter((m) => m !== CORE).sort();
    const base = new Set([...held, ...rows, ...audit]);
    const closure = tenant.operator
      ? { entitled: [], forced: [], forcedBy: {} }
      : closeOverDependencies(base);
    const modules = Object.fromEntries(
      MODULE_KEYS.map((key) => [key, closure.entitled.includes(key)])
    );
    return {
      tenantId: tenant.tenantId,
      operator: tenant.operator === true,
      evidence: { held, rows, audit },
      modules,
      forced: closure.forced,
      forcedBy: closure.forcedBy,
    };
  });
}

/**
 * The proof that applying the proposed entitlements as a filter changes no
 * user's reachable operations. An operation survives the filter iff its own
 * module and the module of every code it declares are core or entitled.
 *
 * `users`: [{ userId, tenantId }] (active users)
 * `codesByUser`: Map(userId -> codes)
 * `entitlements`: the result of proposeEntitlements
 */
export function proveReachability({ users, codesByUser, operations, entitlements }) {
  const byTenant = new Map(entitlements.map((row) => [row.tenantId, row.modules]));
  const outcomes = [];
  for (const user of [...users].sort((a, b) => (a.userId < b.userId ? -1 : 1))) {
    const codes = codesByUser.get(user.userId) ?? [];
    const modules = byTenant.get(user.tenantId) ?? {};
    const isOpen = (key) => key === CORE || modules[key] === true;
    const before = reachableOperations(codes, operations);
    const after = reachableOperations(
      codes,
      operations,
      (operation) =>
        isOpen(classifyOperation(operation)) &&
        operation.permissions.every((code) => isOpen(classifyCode(code)))
    );
    const removed = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    outcomes.push({
      userId: user.userId,
      tenantId: user.tenantId,
      before,
      after,
      identical: removed.length === 0 && added.length === 0 && before.length === after.length,
      removed,
      added,
    });
  }
  return outcomes;
}

/** JSON with object keys sorted at every depth, so equal data is equal bytes. */
export function stableStringify(value) {
  const sortValue = (input) => {
    if (Array.isArray(input)) return input.map(sortValue);
    if (input instanceof Map) return sortValue(Object.fromEntries(input));
    if (input instanceof Set) return [...input].map(sortValue);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, sortValue(input[key])])
      );
    }
    return input;
  };
  return JSON.stringify(sortValue(value));
}

/* ------------------------------------------------------------------------- *
 * The read-only SQL guard.
 *
 * Every statement the inventory sends, other than the two transaction-control
 * constants, passes through `assertReadOnlySql`. It tokenises the text (string
 * literals and comments removed, dollar quoting refused), requires a single
 * statement that starts with SELECT or WITH, refuses every data- or
 * schema-changing keyword and every locking clause, and allows a call only to a
 * function on a short list of side-effect-free built-ins. A schema-qualified
 * call is refused outright, because a database function can write.
 * ------------------------------------------------------------------------- */

export const TRANSACTION_BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
export const TRANSACTION_END = 'ROLLBACK';

const FORBIDDEN_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'upsert',
  'truncate',
  'create',
  'alter',
  'drop',
  'grant',
  'revoke',
  'copy',
  'call',
  'do',
  'lock',
  'vacuum',
  'analyze',
  'reindex',
  'cluster',
  'refresh',
  'comment',
  'security',
  'set',
  'reset',
  'listen',
  'notify',
  'unlisten',
  'prepare',
  'execute',
  'deallocate',
  'discard',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'into',
  'nowait',
  'skip',
]);

/** Words that may stand before an opening parenthesis. */
const ALLOWED_CALLS = new Set([
  // SQL syntax that takes a parenthesis
  'in',
  'exists',
  'as',
  'any',
  'all',
  'over',
  'filter',
  'on',
  'and',
  'or',
  'not',
  'using',
  'where',
  'select',
  'from',
  'join',
  'by',
  'values',
  'cast',
  'with',
  'then',
  'else',
  'when',
  'distinct',
  // side-effect-free built-ins
  'count',
  'bool_or',
  'bool_and',
  'coalesce',
  'now',
  'lower',
  'upper',
  'extract',
  'max',
  'min',
  'sum',
  'array_agg',
  'string_agg',
  'jsonb_typeof',
  'current_setting',
  'pg_current_xact_id_if_assigned',
  'to_regclass',
]);

function tokenise(sql) {
  let text = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '-' && next === '-') {
      while (index < sql.length && sql[index] !== '\n') index += 1;
      text += ' ';
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      if (end < 0) throw new Error('unterminated comment');
      index = end + 2;
      text += ' ';
      continue;
    }
    if (char === "'") {
      index += 1;
      for (;;) {
        if (index >= sql.length) throw new Error('unterminated string literal');
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") break;
        index += 1;
      }
      index += 1;
      text += " '' ";
      continue;
    }
    if (char === '$' && /[A-Za-z_$]/.test(next ?? '')) {
      const rest = sql.slice(index);
      if (/^\$[A-Za-z_]*\$/.test(rest)) throw new Error('dollar quoting is refused');
    }
    if (char === '"') {
      const end = sql.indexOf('"', index + 1);
      if (end < 0) throw new Error('unterminated quoted identifier');
      text += ` ${sql.slice(index + 1, end).toLowerCase()} `;
      index = end + 1;
      continue;
    }
    text += char;
    index += 1;
  }
  return text;
}

/** Throws unless `sql` is a single, read-only SELECT or WITH statement. */
export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') throw new Error('empty statement');
  const text = tokenise(sql).trim().replace(/;\s*$/, '');
  if (text.includes(';')) throw new Error('more than one statement');
  const words = text.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? [];
  if (words[0] !== 'select' && words[0] !== 'with') {
    throw new Error(`statement must start with SELECT or WITH, not ${words[0] ?? 'nothing'}`);
  }
  for (const word of words) {
    if (FORBIDDEN_KEYWORDS.has(word)) throw new Error(`forbidden keyword: ${word}`);
  }
  if (/\bfor\s+(update|share|no\s+key|key)\b/i.test(text)) throw new Error('locking clause');
  const calls = text.matchAll(/([a-z_][a-z0-9_$]*)(\s*\.\s*[a-z_][a-z0-9_$]*)?\s*\(/gi);
  for (const call of calls) {
    if (call[2]) throw new Error(`schema-qualified call refused: ${call[0].replace(/\s+/g, '')}`);
    const name = call[1].toLowerCase();
    if (!ALLOWED_CALLS.has(name)) throw new Error(`call refused: ${name}`);
  }
  return true;
}

const QUALIFIED_TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/** A per-tenant row count over one main table, built from a validated name. */
export function rowCountQuery(qualifiedTable) {
  if (!QUALIFIED_TABLE.test(qualifiedTable)) throw new Error(`bad table name ${qualifiedTable}`);
  return `SELECT tenant_id::text AS tenant_id, count(*)::int AS n FROM ${qualifiedTable} GROUP BY tenant_id`;
}

/** A whole-table row count, for the before and after snapshot. */
export function tableCountQuery(qualifiedTable) {
  if (!QUALIFIED_TABLE.test(qualifiedTable)) throw new Error(`bad table name ${qualifiedTable}`);
  return `SELECT count(*)::text AS n FROM ${qualifiedTable}`;
}

/* ------------------------------------------------------------------------- *
 * Aggregation: counts only, no identifier of any tenant, user or role.
 * ------------------------------------------------------------------------- */

const increment = (record, key) => {
  record[key] = (record[key] ?? 0) + 1;
};

/**
 * Anonymised aggregates over one computation. `classOf(tenantId)` returns the
 * tenant's class label; the labels themselves are not identifiers.
 */
export function aggregate({
  tenants,
  classOf,
  entitlements,
  proof,
  adminRoles,
  activeUsers,
  codesByUser,
}) {
  const tenantClasses = {};
  const tenantStatuses = {};
  for (const tenant of tenants) {
    increment(tenantClasses, classOf(tenant.tenantId));
    increment(tenantStatuses, tenant.status);
  }

  const nonOperator = entitlements.filter((row) => !row.operator);
  const modules = {};
  for (const key of MODULE_KEYS) {
    const counts = { granted: 0, used: 0, both: 0, none: 0, entitled: 0, forced: 0 };
    for (const row of nonOperator) {
      const granted = row.evidence.held.includes(key);
      const used = row.evidence.rows.includes(key) || row.evidence.audit.includes(key);
      if (granted && used) counts.both += 1;
      else if (granted) counts.granted += 1;
      else if (used) counts.used += 1;
      else counts.none += 1;
      if (row.modules[key]) counts.entitled += 1;
      if (row.forced.includes(key)) counts.forced += 1;
    }
    modules[key] = counts;
  }

  const dependencies = FORCED_DEPENDENCIES.map((edge) => {
    let fromInBase = 0;
    let toAlreadyInBase = 0;
    for (const row of nonOperator) {
      const base = new Set([...row.evidence.held, ...row.evidence.rows, ...row.evidence.audit]);
      if (base.has(edge.from)) {
        fromInBase += 1;
        if (base.has(edge.to)) toAlreadyInBase += 1;
      }
    }
    return { from: edge.from, to: edge.to, basis: edge.basis, fromInBase, toAlreadyInBase };
  });

  const bundleSizes = {};
  const adminRolesPerTenant = {};
  const rolesByTenant = new Map();
  for (const role of adminRoles) {
    increment(bundleSizes, String(role.allowCount));
    rolesByTenant.set(role.tenantId, (rolesByTenant.get(role.tenantId) ?? 0) + 1);
  }
  for (const count of rolesByTenant.values()) increment(adminRolesPerTenant, String(count));

  const holding = activeUsers.filter((user) => (codesByUser.get(user.userId) ?? []).length > 0);
  const distinctSets = new Set(proof.map((outcome) => outcome.before.join('|')));
  const distinctHolderSets = new Set(
    proof
      .filter((outcome) => (codesByUser.get(outcome.userId) ?? []).length > 0)
      .map((outcome) => outcome.before.join('|'))
  );

  const entitledCounts = {};
  for (const row of nonOperator) {
    increment(entitledCounts, String(MODULE_KEYS.filter((key) => row.modules[key]).length));
  }

  return {
    tenants: { total: tenants.length, byStatus: tenantStatuses, byClass: tenantClasses },
    administratorBundles: { tenantsBySize: bundleSizes, rolesPerTenant: adminRolesPerTenant },
    users: {
      active: activeUsers.length,
      holdingCodes: holding.length,
      distinctReachableSets: distinctSets.size,
      distinctReachableSetsAmongHolders: distinctHolderSets.size,
    },
    modules,
    dependencies,
    mapping: {
      tenantsMapped: entitlements.length,
      operatorTenants: entitlements.filter((row) => row.operator).length,
      operatorTenantsWithAnyModule: entitlements.filter(
        (row) => row.operator && MODULE_KEYS.some((key) => row.modules[key])
      ).length,
      tenantsByEntitledModuleCount: entitledCounts,
      tenantsWithForcedAdditions: nonOperator.filter((row) => row.forced.length > 0).length,
      explicitRows: entitlements.length * MODULE_KEYS.length,
    },
    proof: {
      usersCompared: proof.length,
      identical: proof.filter((outcome) => outcome.identical).length,
      different: proof.filter((outcome) => !outcome.identical).length,
      operationsRemoved: proof.reduce((sum, outcome) => sum + outcome.removed.length, 0),
      operationsAdded: proof.reduce((sum, outcome) => sum + outcome.added.length, 0),
    },
  };
}
