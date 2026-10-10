// The module entitlement inventory (P1-32-PRE-OD-LIC): the read-only guard, the
// mapping rules R1 to R6 and the no-change proof, on synthetic in-test data only.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CANDIDATE_MODULES,
  FORCED_DEPENDENCIES,
  MODULE_KEYS,
  TRANSACTION_BEGIN,
  TRANSACTION_END,
  assertReadOnlySql,
  classifyAuditAction,
  classifyCode,
  classifyOperation,
  closeOverDependencies,
  effectiveCodesByUser,
  proposeEntitlements,
  proveReachability,
  reachableOperations,
  rowCountQuery,
  stableStringify,
  tableCountQuery,
} from '../../scripts/platform/entitlement-inventory-model.mjs';
import {
  QUERIES,
  SNAPSHOT_TABLES,
  assertOutsideRepository,
  computeInventory,
  inReadOnlyTransaction,
  parseArguments,
  parseOperationsFromSource,
  readOperations,
  runInventory,
} from '../../scripts/platform/entitlement-inventory.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';

// ---------------------------------------------------------------------------
// Synthetic inputs. Identifiers are opaque test strings, not records.
// ---------------------------------------------------------------------------

const NOW = '1800000000000000';
const PAST = '1700000000000000';
const FUTURE = '1900000000000000';

const OPERATIONS = [
  { id: 'crm.synthetic-one', module: 'crm', permissions: ['crm.customer.read'], public: false },
  {
    id: 'apt.synthetic-two',
    module: 'reception',
    permissions: ['apt.appointment.read'],
    public: false,
  },
  {
    id: 'rec.synthetic-three',
    module: 'reception',
    permissions: ['rec.reception.read', 'crm.customer.read'],
    public: false,
  },
  {
    id: 'quo.synthetic-four',
    module: 'quotation',
    permissions: ['quo.quotation.read'],
    public: false,
  },
  {
    id: 'wo.synthetic-five',
    module: 'work-order',
    permissions: ['wo.work_order.read'],
    public: false,
  },
  { id: 'inv.synthetic-six', module: 'inventory', permissions: ['inv.item.read'], public: false },
  { id: 'iam.synthetic-seven', module: 'iam', permissions: ['iam.user.read'], public: false },
  { id: 'meta.synthetic-eight', module: 'meta', permissions: [], public: true },
];

const CODES = [
  'apt.appointment.read',
  'crm.customer.read',
  'iam.user.read',
  'inv.item.read',
  'quo.quotation.read',
  'rec.reception.read',
  'wo.work_order.read',
];

const mapping = (userId: string, tenantId: string, code: string, extra: object = {}) => ({
  tenantId,
  userId,
  code,
  effect: 'allow',
  grantStatus: 'active',
  validFromMicros: PAST,
  validToMicros: null,
  ...extra,
});

function syntheticData() {
  return {
    nowMicros: NOW,
    tenants: [
      { tenantId: 'tenant-a', tenantCode: 'code_a', status: 'active' },
      { tenantId: 'tenant-b', tenantCode: 'code_b', status: 'active' },
      { tenantId: 'tenant-op', tenantCode: 'code_op', status: 'active' },
    ],
    operatorTenantIds: ['tenant-op'],
    users: [
      { userId: 'user-a1', tenantId: 'tenant-a', status: 'active', live: true },
      { userId: 'user-b1', tenantId: 'tenant-b', status: 'active', live: true },
      { userId: 'user-op', tenantId: 'tenant-op', status: 'active', live: true },
    ],
    permissionCodes: CODES,
    mappings: [
      mapping('user-a1', 'tenant-a', 'crm.customer.read'),
      mapping('user-a1', 'tenant-a', 'rec.reception.read'),
      mapping('user-a1', 'tenant-a', 'apt.appointment.read'),
      mapping('user-b1', 'tenant-b', 'quo.quotation.read'),
      mapping('user-b1', 'tenant-b', 'wo.work_order.read'),
      mapping('user-op', 'tenant-op', 'iam.user.read'),
    ],
    administratorRoles: [
      { tenantId: 'tenant-a', allowCount: 78 },
      { tenantId: 'tenant-b', allowCount: 78 },
    ],
    auditActions: [{ tenantId: 'tenant-b', action: 'inv.item.created', n: 2 }],
    plans: { plans: 1, plans_with_entitlements: 0 },
    configuration: {
      feature_flags: 0,
      tenant_overrides: 0,
      company_settings: 0,
      branch_settings: 0,
      tenants_with_active_subscription: 0,
    },
    rowCounts: { 'veh.vehicles': [{ tenantId: 'tenant-a', n: 3 }] },
  };
}

// ---------------------------------------------------------------------------
// The read-only guard
// ---------------------------------------------------------------------------

describe('entitlement inventory: every statement it sends is read-only', () => {
  it('accepts every fixed and every built statement', () => {
    for (const sql of Object.values(QUERIES)) expect(assertReadOnlySql(sql)).toBe(true);
    for (const table of CANDIDATE_MODULES.flatMap((m) => m.mainTables)) {
      expect(assertReadOnlySql(rowCountQuery(table))).toBe(true);
    }
    for (const table of SNAPSHOT_TABLES)
      expect(assertReadOnlySql(tableCountQuery(table))).toBe(true);
  });

  it.each([
    ['INSERT INTO org.tenants (id) VALUES (1)', 'start'],
    ['SELECT 1; DROP TABLE org.tenants', 'more than one'],
    ['WITH gone AS (DELETE FROM org.tenants RETURNING id) SELECT id FROM gone', 'delete'],
    ['SELECT id FROM org.tenants FOR UPDATE', 'update'],
    ['SELECT id FROM org.tenants FOR KEY SHARE', 'locking'],
    ["SELECT nextval('seq')", 'nextval'],
    ["SELECT set_config('app.x', 'y', false)", 'set_config'],
    ["SELECT iam.audit_append('x')", 'schema-qualified'],
    ['SELECT pg_advisory_lock(1)', 'pg_advisory_lock'],
    ['SELECT pg_sleep(1)', 'pg_sleep'],
    ['SELECT $$text$$', 'dollar'],
    ['SELECT id INTO copy_of FROM org.tenants', 'into'],
    ['SHOW transaction_read_only', 'start'],
    ['', 'empty'],
  ])('refuses %s', (sql, reason) => {
    expect(() => assertReadOnlySql(sql)).toThrow(new RegExp(reason, 'i'));
  });

  it('does not mistake a keyword inside a string literal or a comment for a statement', () => {
    expect(assertReadOnlySql("SELECT 'DELETE; DROP' AS word -- UPDATE\n FROM org.tenants")).toBe(
      true
    );
    expect(assertReadOnlySql('SELECT /* INSERT */ 1')).toBe(true);
  });

  it('builds row counts only from validated table names', () => {
    expect(() => rowCountQuery('org.tenants; DROP TABLE x')).toThrow(/bad table name/);
    expect(() => tableCountQuery('tenants')).toThrow(/bad table name/);
  });
});

// A recording client: answers each statement with synthetic rows and keeps the
// exact text of everything it was sent.
function recordingClient(options: { readOnly?: string; xid?: string | null } = {}) {
  const sent: string[] = [];
  const data = syntheticData();
  const answer = (sql: string): Record<string, unknown>[] => {
    if (sql === TRANSACTION_BEGIN || sql === TRANSACTION_END) return [];
    if (sql === QUERIES.transactionState) {
      return [{ read_only: options.readOnly ?? 'on', xid: options.xid ?? null, now_micros: NOW }];
    }
    if (sql === QUERIES.ledgerPresent) return [{ present: true }];
    if (sql === QUERIES.ledger) return [{ migrations: 3, latest: '3' }];
    if (sql === QUERIES.tenantScopedTables) {
      return CANDIDATE_MODULES.flatMap((m) => m.mainTables).map((qualified) => ({ qualified }));
    }
    if (sql === QUERIES.tenants) {
      return data.tenants.map((t) => ({
        tenant_id: t.tenantId,
        tenant_code: t.tenantCode,
        status: t.status,
      }));
    }
    if (sql === QUERIES.operatorTenants) return [{ tenant_id: 'tenant-op' }];
    if (sql === QUERIES.users) {
      return data.users.map((u) => ({
        user_id: u.userId,
        tenant_id: u.tenantId,
        status: u.status,
        live: u.live,
      }));
    }
    if (sql === QUERIES.permissions) return CODES.map((code) => ({ code }));
    if (sql === QUERIES.grantMappings) {
      return data.mappings.map((m) => ({
        tenant_id: m.tenantId,
        user_id: m.userId,
        code: m.code,
        effect: m.effect,
        grant_status: m.grantStatus,
        valid_from_micros: m.validFromMicros,
        valid_to_micros: m.validToMicros,
      }));
    }
    if (sql === QUERIES.administratorRoles) {
      return data.administratorRoles.map((r) => ({
        tenant_id: r.tenantId,
        allow_count: r.allowCount,
      }));
    }
    if (sql === QUERIES.auditActions) {
      return data.auditActions.map((a) => ({ tenant_id: a.tenantId, action: a.action, n: a.n }));
    }
    if (sql === QUERIES.plans) return [data.plans];
    if (sql === QUERIES.configuration) return [data.configuration];
    for (const table of SNAPSHOT_TABLES) if (sql === tableCountQuery(table)) return [{ n: '5' }];
    if (sql === rowCountQuery('veh.vehicles')) return [{ tenant_id: 'tenant-a', n: 3 }];
    for (const table of CANDIDATE_MODULES.flatMap((m) => m.mainTables)) {
      if (sql === rowCountQuery(table)) return [];
    }
    throw new Error(`the fake has no answer for: ${sql}`);
  };
  return {
    sent,
    client: {
      async query(sql: string) {
        sent.push(sql);
        return { rows: answer(sql) };
      },
    },
  };
}

describe('entitlement inventory: the run is read-only end to end', () => {
  it('opens every transaction read-only, rolls every one back, and sends nothing else unguarded', async () => {
    const { sent, client } = recordingClient();
    const outcome = await runInventory(client, OPERATIONS, {});
    const begins = sent.filter((sql) => sql === TRANSACTION_BEGIN).length;
    const ends = sent.filter((sql) => sql === TRANSACTION_END).length;
    expect(begins).toBe(4);
    expect(ends).toBe(4);
    expect(sent[0]).toBe(TRANSACTION_BEGIN);
    expect(sent[sent.length - 1]).toBe(TRANSACTION_END);
    for (const sql of sent) {
      if (sql === TRANSACTION_BEGIN || sql === TRANSACTION_END) continue;
      expect(() => assertReadOnlySql(sql)).not.toThrow();
    }
    expect(outcome.readOnlyProof.ledgerUnchanged).toBe(true);
    expect(outcome.readOnlyProof.rowCountsUnchanged).toBe(true);
    expect(outcome.idempotency.sameDataTwiceIdentical).toBe(true);
    expect(outcome.idempotency.secondReadMappingIdentical).toBe(true);
  });

  it('refuses when the server does not report the transaction read-only, and still rolls back', async () => {
    const { sent, client } = recordingClient({ readOnly: 'off' });
    await expect(inReadOnlyTransaction(client, async () => 1)).rejects.toThrow(/read-only/);
    expect(sent[sent.length - 1]).toBe(TRANSACTION_END);
  });

  it('refuses when a transaction id was assigned, because that means something wrote', async () => {
    const { client } = recordingClient({ xid: '991' });
    await expect(inReadOnlyTransaction(client, async () => 1)).rejects.toThrow(/assigned/);
  });

  it('refuses a statement the guard does not accept before it reaches the server', async () => {
    const { sent, client } = recordingClient();
    await expect(
      inReadOnlyTransaction(client, (query: (sql: string) => Promise<unknown>) =>
        query('DELETE FROM org.tenants')
      )
    ).rejects.toThrow(/SELECT or WITH/);
    expect(sent).not.toContain('DELETE FROM org.tenants');
    expect(sent[sent.length - 1]).toBe(TRANSACTION_END);
  });
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe('entitlement inventory: classification into candidate modules', () => {
  it.each([
    ['sal.delivery.view', 'delivery'],
    ['sal.finance.view', 'billing'],
    ['sal.credit.approve', 'billing'],
    ['sal.payment.third_party', 'payments'],
    ['sal.reversal.approve', 'payments'],
    ['svc.price.read', 'pricing'],
    ['svc.service.read', 'service-catalog'],
    ['apt.catalogue.manage', 'appointments'],
    ['rec.catalogue.manage', 'reception'],
    ['org.tax.manage', 'core'],
    ['platform.audit.read', 'core'],
    ['xyz.anything', null],
  ])('code %s belongs to %s', (code, module) => {
    expect(classifyCode(code)).toBe(module);
  });

  it.each([
    ['sal.receipt_reversal.requested', 'payments'],
    ['sal.delivery_checklist_template.created', 'delivery'],
    ['sal.authorized_receiver.created', 'delivery'],
    ['sal.counter_sale.created', 'billing'],
    ['sal.credit_note.approved', 'billing'],
    ['svc.branch_service_availability.changed', 'service-catalog'],
    ['svc.price_list.created', 'pricing'],
    ['svc.discount_threshold.changed', 'pricing'],
    ['iam.role.created', 'core'],
    ['business.unknown', null],
  ])('audit action %s belongs to %s', (action, module) => {
    expect(classifyAuditAction(action)).toBe(module);
  });

  it('places appointment operations inside the reception API module under appointments', () => {
    expect(classifyOperation({ id: 'apt.synthetic-two', module: 'reception' })).toBe(
      'appointments'
    );
    expect(classifyOperation({ id: 'rec.synthetic-three', module: 'reception' })).toBe('reception');
    expect(classifyOperation({ id: 'ovw.synthetic-nine', module: 'overview' })).toBe('core');
    expect(classifyOperation({ id: 'new.thing', module: 'new-module' })).toBe(null);
  });

  it('classifies every operation of the real route tree, and appointments live in reception', () => {
    const operations = readOperations();
    expect(operations.length).toBeGreaterThan(300);
    const appointments = operations.filter((o: { id: string; module: string }) =>
      o.id.startsWith('apt.')
    );
    expect(appointments.length).toBeGreaterThan(0);
    expect(new Set(appointments.map((o: { module: string }) => o.module))).toEqual(
      new Set(['reception'])
    );
    for (const operation of operations) expect(classifyOperation(operation)).not.toBeNull();
  });
});

describe('entitlement inventory: the operation registry is parsed, not pattern-matched', () => {
  const source = `
    import { defineOperation } from '@/server/auth/operation-registry';
    // defineOperation({ id: 'in.a-comment', module: 'crm', permissions: ['crm.customer.read'] })
    export const A = defineOperation({ id: 'crm.a', module: 'crm', permissions: ['crm.customer.read', 'crm.customer.create'] });
    export const B = defineOperation({ id: 'meta.b', module: 'meta', public: true, publicReason: 'probe' });
  `;

  it('reads literal declarations and ignores a commented one', () => {
    const operations = parseOperationsFromSource(source, 'route.ts');
    expect(operations.map((o: { id: string }) => o.id)).toEqual(['crm.a', 'meta.b']);
    expect(operations[0]?.permissions).toEqual(['crm.customer.read', 'crm.customer.create']);
    expect(operations[1]?.public).toBe(true);
  });

  it('fails closed on a computed declaration', () => {
    expect(() =>
      parseOperationsFromSource(
        "const base = {}; export const C = defineOperation({ ...base, id: 'x.c', module: 'crm' });",
        'route.ts'
      )
    ).toThrow(/computed member/);
    expect(() =>
      parseOperationsFromSource(
        "const id = 'x.d'; export const D = defineOperation({ id, module: 'crm' });",
        'route.ts'
      )
    ).toThrow(/computed member/);
    expect(() =>
      parseOperationsFromSource(
        "const code = 'crm.customer.read'; export const E = defineOperation({ id: 'x.e', module: 'crm', permissions: [code] });",
        'route.ts'
      )
    ).toThrow(/computed code/);
  });
});

// ---------------------------------------------------------------------------
// R2: effective codes with the has_permission semantics
// ---------------------------------------------------------------------------

describe('entitlement inventory: effective codes follow has_permission', () => {
  const users = [
    { userId: 'u1', tenantId: 't1', status: 'active', live: true },
    { userId: 'u2', tenantId: 't1', status: 'inactive', live: true },
    { userId: 'u3', tenantId: 't1', status: 'active', live: false },
  ];

  it('deny wins over allow across grants', () => {
    const codes = effectiveCodesByUser(
      users,
      [
        mapping('u1', 't1', 'crm.customer.read'),
        mapping('u1', 't1', 'crm.customer.read', { effect: 'deny' }),
        mapping('u1', 't1', 'veh.vehicle.read'),
      ],
      NOW
    );
    expect(codes.get('u1')).toEqual(['veh.vehicle.read']);
  });

  it('honours the validity window, the grant status, the account and the tenant', () => {
    const codes = effectiveCodesByUser(
      users,
      [
        mapping('u1', 't1', 'a.not-yet', { validFromMicros: FUTURE }),
        mapping('u1', 't1', 'a.ended', { validToMicros: NOW }),
        mapping('u1', 't1', 'a.open-ended', { validToMicros: FUTURE }),
        mapping('u1', 't1', 'a.revoked', { grantStatus: 'revoked' }),
        mapping('u1', 't2', 'a.other-tenant'),
        mapping('u2', 't1', 'a.inactive-user'),
        mapping('u3', 't1', 'a.deleted-user'),
      ],
      NOW
    );
    expect(codes.get('u1')).toEqual(['a.open-ended']);
    expect(codes.has('u2')).toBe(false);
    expect(codes.has('u3')).toBe(false);
  });
});

describe('entitlement inventory: reachable operations', () => {
  it('needs every declared code and leaves public operations out', () => {
    expect(reachableOperations(['crm.customer.read'], OPERATIONS)).toEqual(['crm.synthetic-one']);
    expect(reachableOperations(['crm.customer.read', 'rec.reception.read'], OPERATIONS)).toEqual([
      'crm.synthetic-one',
      'rec.synthetic-three',
    ]);
    expect(reachableOperations([], OPERATIONS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R1 to R6 and the proof
// ---------------------------------------------------------------------------

describe('entitlement inventory: the proposed mapping', () => {
  const heldModules = new Map([
    ['t-held', new Set(['crm', 'core'])],
    ['t-op', new Set(['crm'])],
    ['t-quote', new Set(['quotation'])],
  ]);
  const rowModules = new Map([['t-rows', new Set(['vehicle'])]]);
  const auditModules = new Map([['t-audit', new Set(['warranty'])]]);
  const tenants = ['t-held', 't-rows', 't-audit', 't-none', 't-op', 't-quote'].map((id) => ({
    tenantId: id,
    status: 'active',
    operator: id === 't-op',
  }));
  const rows = proposeEntitlements({ tenants, heldModules, rowModules, auditModules });
  const of = (id: string) => rows.find((row: { tenantId: string }) => row.tenantId === id);

  it('R2: entitles by held code, by business rows and by audit actions, and nothing else', () => {
    expect(of('t-held')?.modules.crm).toBe(true);
    expect(of('t-rows')?.modules.vehicle).toBe(true);
    expect(of('t-audit')?.modules.warranty).toBe(true);
    expect(Object.values(of('t-none')?.modules ?? {}).some(Boolean)).toBe(false);
  });

  it('R3: core is never a module, and the operator tenant gets none even with codes', () => {
    expect(MODULE_KEYS).not.toContain('core');
    expect(Object.values(of('t-op')?.modules ?? {}).some(Boolean)).toBe(false);
  });

  it('R4: every tenant has an explicit true or false for every candidate module', () => {
    for (const row of rows) {
      expect(Object.keys(row.modules).sort()).toEqual([...MODULE_KEYS].sort());
      for (const value of Object.values(row.modules)) expect(typeof value).toBe('boolean');
    }
  });

  it('R6: forced dependencies close the set and say what they added', () => {
    expect(of('t-quote')?.forced).toEqual(['inventory', 'work-order']);
    expect(of('t-quote')?.modules.inventory).toBe(true);
    expect(closeOverDependencies(['work-order', 'inventory']).forced).toEqual([]);
    for (const edge of FORCED_DEPENDENCIES) {
      expect(MODULE_KEYS).toContain(edge.from);
      expect(MODULE_KEYS).toContain(edge.to);
    }
  });
});

describe('entitlement inventory: the proof that no access changes', () => {
  it('finds every reachable set identical when entitlements follow the held codes', () => {
    const data = syntheticData();
    const result = computeInventory(data, OPERATIONS, {});
    expect(result.aggregates.proof.different).toBe(0);
    expect(result.aggregates.proof.identical).toBe(3);
    expect(result.aggregates.mapping.tenantsWithForcedAdditions).toBe(0);
    expect(result.aggregates.mapping.operatorTenantsWithAnyModule).toBe(0);
  });

  it('detects a removal when an entitlement the users rely on is withheld (falsification)', () => {
    const users = [{ userId: 'user-a1', tenantId: 'tenant-a' }];
    const codesByUser = new Map([['user-a1', ['crm.customer.read', 'rec.reception.read']]]);
    const withheld = [
      {
        tenantId: 'tenant-a',
        modules: Object.fromEntries(MODULE_KEYS.map((key: string) => [key, key === 'reception'])),
      },
    ];
    const [outcome] = proveReachability({
      users,
      codesByUser,
      operations: OPERATIONS,
      entitlements: withheld,
    });
    expect(outcome?.identical).toBe(false);
    expect(outcome?.removed).toEqual(['crm.synthetic-one', 'rec.synthetic-three']);
    expect(outcome?.added).toEqual([]);
  });

  it('is idempotent: the same data gives the same bytes, whatever the key order', () => {
    const first = computeInventory(syntheticData(), OPERATIONS, {});
    const second = computeInventory(syntheticData(), OPERATIONS, {});
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 })
    );
  });

  it('keeps every tenant and user identifier out of the aggregates', () => {
    const data = syntheticData();
    const text = stableStringify(computeInventory(data, OPERATIONS, {}).aggregates);
    for (const tenant of data.tenants) {
      expect(text).not.toContain(tenant.tenantId);
      expect(text).not.toContain(tenant.tenantCode);
    }
    for (const user of data.users) expect(text).not.toContain(user.userId);
  });

  it('fails closed on a permission code that belongs to no module', () => {
    const data = { ...syntheticData(), permissionCodes: [...CODES, 'zzz.unknown.code'] };
    expect(() => computeInventory(data, OPERATIONS, {})).toThrow(/no module: zzz.unknown.code/);
  });
});

// ---------------------------------------------------------------------------
// Inputs and the output location
// ---------------------------------------------------------------------------

describe('entitlement inventory: inputs and where it may write', () => {
  it('refuses to write inside the repository or inside any git work tree', () => {
    expect(() => assertOutsideRepository(join(REPOSITORY_ROOT, 'docs', 'out.json'))).toThrow(
      /inside the repository/
    );
    const outside = join(tmpdir(), 'inventory-out', 'out.json');
    const marked = resolve(tmpdir(), 'inventory-out');
    expect(() =>
      assertOutsideRepository(outside, {
        repositoryRoot: REPOSITORY_ROOT,
        exists: (path: unknown) => String(path) === join(marked, '.git'),
      })
    ).toThrow(/git work tree/);
    expect(
      assertOutsideRepository(outside, { repositoryRoot: REPOSITORY_ROOT, exists: () => false })
    ).toBe(resolve(outside));
  });

  it('requires --out and a real port, and leaves an unstated target to the shared resolver', () => {
    expect(() => parseArguments([])).toThrow(/--out is required/);
    expect(() => parseArguments(['--out', 'x.json', '--db-port', 'abc'])).toThrow(/port/);
    expect(() => parseArguments(['--out'])).toThrow(/needs a value/);
    const unstated = parseArguments(['--out', 'x.json']);
    expect(unstated.port).toBeUndefined();
    expect(unstated.host).toBeUndefined();
    expect(parseArguments(['--out', 'x.json', '--db-port', '55441']).port).toBe(55441);
  });
});

// ---------------------------------------------------------------------------
// The record of the Owner's 2026-10-03 method. The directive record words the
// prohibition as "do not grant every company every module": a blanket grant is
// forbidden, not a company being entitled to many modules by its own evidence.
// The ADR and the script must record that decision and not a stronger one, and
// the inventory must explain to the Owner any tenant it entitles to everything.
// ---------------------------------------------------------------------------

function prose(relativePath: string): string {
  const text = readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8');
  return text.replace(/^\s*\*(?!\*)\s?/gm, '').replace(/\s+/g, ' ');
}

describe('entitlement inventory: the recorded Owner decision is the decision made', () => {
  const directive = prose('docs/product/owner-directive-2026-09-16/README.md');
  const records = {
    adr: prose('docs/adr/ADR-024-module-entitlements-and-commercial-packaging.md'),
    script: prose('scripts/platform/entitlement-inventory-model.mjs'),
  };
  const inventory = prose('docs/platform/module-entitlement-inventory-2026-10-04.md');

  it('records the prohibition in the words of the directive record: no blanket grant', () => {
    expect(directive).toContain('Do not grant every company every module');
    for (const record of Object.values(records)) {
      expect(record.toLowerCase()).toContain('grant every company every module (no blanket grant)');
      expect(record).toMatch(/do not assign packages silently/i);
      expect(record).not.toMatch(/no company is given every module/i);
    }
  });

  it('explains to the Owner why tenants are entitled to every candidate module', () => {
    const measured = /(\d+) tenants to all (\d+)/.exec(inventory);
    expect(measured).not.toBeNull();
    const [, tenants = '0', modules = '0'] = measured ?? [];
    expect(Number(modules)).toBe(CANDIDATE_MODULES.length);
    expect(Number(tenants)).toBeGreaterThan(0);
    expect(inventory).toContain("Why the result is near-universal, for the Owner's review.");
    expect(inventory).toContain('forbids a blanket grant of every module to every company');
    expect(inventory).toContain('For the Owner to review:');
  });
});
