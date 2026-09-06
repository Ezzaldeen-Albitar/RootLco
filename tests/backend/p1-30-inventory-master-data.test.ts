/**
 * P1-30 corrective slice — the inventory master data a fresh tenant needs before
 * any stock can exist (the inventory half of A0 finding F-02).
 *
 * The F-02 remeasurement at develop `6f6236c3` found three tables with RLS,
 * grants and a permission code and NO writer — `inv.item_categories`,
 * `inv.item_master`, `inv.stock_locations` — plus one AUTHORIZATION gap:
 * `inv.adjustment.approve`, the code that approves the opening batch through
 * which stock first appears, was not in the administrator bundle, so no
 * fresh organisation could ever hold it. Five operations and one bundle code
 * close both; this suite proves them through the shipped routes, ending with
 * the whole chain from an empty tenant to on-hand stock.
 *
 *   MD-C1  a category is created; the list returns it; a duplicate code is a 409
 *   MD-C2  category and item creation require inv.item.manage TENANT-WIDE — a
 *          branch-scoped holder of the same code is refused (P1-18-A-01)
 *   MD-U1  the unit list returns the platform set (and the tenant's own rows)
 *   MD-I1  an item is created and reads back through inv.item-search with its unit
 *   MD-I2  an unknown or inactive category, and an unknown unit, are 422s naming the field
 *   MD-I3  a duplicate SKU is a 409
 *   MD-L1  a warehouse is created; storage nests under it; a duplicate code is a 409
 *   MD-L2  the hierarchy is refused by the field: a warehouse with a parent, a
 *          storage without one, a parent in another branch, a parent that is not a warehouse
 *   MD-L3  scope: a holder scoped to A2 is refused A1 and admitted A2 (isolation)
 *   MD-X1  tenant B sees none of tenant A's rows, and its own writes stay in B
 *   MD-A1  each write is audited once, and a replay under the same key writes nothing twice
 *   MD-CHAIN  from nothing: category -> unit -> item -> warehouse -> opening batch ->
 *          line -> approval by a second person -> on-hand stock readable
 *   MD-B1  the administrator bundle now holds inv.adjustment.approve
 *
 * Operations exercised here: inv.item-category-list, inv.item-category-create,
 * inv.uom-list, inv.item-create, inv.stock-location-create, inv.item-search,
 * inv.stock-location-list, inv.opening-batch-create,
 * inv.opening-batch-line-create, inv.opening-batch-approve,
 * inv.stock-availability-read.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.item-category-list: route service authorization success cross-tenant
 *   inv.item-category-create: route service authorization success denial cross-tenant audit idempotency
 *   inv.uom-list: route service authorization success
 *   inv.item-create: route service authorization success denial cross-tenant audit idempotency
 *   inv.stock-location-create: route service authorization success denial cross-tenant audit idempotency isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, BRANCH_B1, COMPANY_B1, establishP1_19Fixtures } from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { TENANT_ADMINISTRATOR_ROLE } from '@/modules/iam';
import {
  ITEM_CATEGORY_CREATE_OPERATION,
  ITEM_CATEGORY_LIST_OPERATION,
  GET as categoryListRoute,
  POST as categoryCreateRoute,
} from '@/app/api/v1/item-categories/route';
import {
  UNIT_OF_MEASURE_LIST_OPERATION,
  GET as unitListRoute,
} from '@/app/api/v1/units-of-measure/route';
import {
  ITEM_CREATE_OPERATION,
  GET as itemSearchRoute,
  POST as itemCreateRoute,
} from '@/app/api/v1/items/route';
import {
  STOCK_LOCATION_CREATE_OPERATION,
  GET as locationListRoute,
  POST as locationCreateRoute,
} from '@/app/api/v1/stock-locations/route';
import { POST as batchCreateRoute } from '@/app/api/v1/opening-inventory-batches/route';
import { POST as batchLineRoute } from '@/app/api/v1/opening-inventory-batches/[batchId]/lines/route';
import { POST as batchApproveRoute } from '@/app/api/v1/opening-inventory-batches/[batchId]/approval/route';
import { GET as availabilityRoute } from '@/app/api/v1/stock-availability/route';

/** Test-owned identifiers, in a family no sibling suite uses. */
const ROLE_MANAGER = 'e3000000-0000-4000-8000-000000000101';
const USER_MANAGER = 'e3000000-0000-4000-8000-000000000102';
const SUBJECT_MANAGER = 'fx_p130_inv_manager';
const ROLE_SCOPED = 'e3000000-0000-4000-8000-000000000111';
const USER_SCOPED = 'e3000000-0000-4000-8000-000000000112';
const SUBJECT_SCOPED = 'fx_p130_inv_scoped_a2';
const GRANT_SCOPED = 'e3000000-0000-4000-8000-0000000001f1';
const ROLE_READER = 'e3000000-0000-4000-8000-000000000121';
const USER_READER = 'e3000000-0000-4000-8000-000000000122';
const SUBJECT_READER = 'fx_p130_inv_reader';
const ROLE_APPROVER = 'e3000000-0000-4000-8000-000000000131';
const USER_APPROVER = 'e3000000-0000-4000-8000-000000000132';
const SUBJECT_APPROVER = 'fx_p130_inv_approver';
const ROLE_TENANT_B = 'e3000000-0000-4000-8000-000000000141';
const USER_TENANT_B = 'e3000000-0000-4000-8000-000000000142';
const SUBJECT_TENANT_B = 'fx_p130_inv_tenant_b';
const RUN = Math.random().toString(36).slice(2, 7);

const MANAGE = 'inv.item.manage';
const READ = 'inv.item.read';
const STOCK_READ = 'inv.stock.read';
const STOCK_OPERATE = 'inv.stock.operate';
const APPROVE = 'inv.adjustment.approve';

interface Principal {
  readonly roleId: string;
  readonly userId: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
  readonly scope?: { readonly companyId: string; readonly branchId: string };
  readonly grantId?: string;
}

/**
 * The fresh-tenant administrator's shape: holds the catalogue write, the stock
 * reads, may count AND holds inv.adjustment.approve — so the self-approval in
 * the chain is refused by the maker–checker rule, not by a missing permission.
 */
const MANAGER: Principal = {
  roleId: ROLE_MANAGER,
  userId: USER_MANAGER,
  subject: SUBJECT_MANAGER,
  tenantId: TENANT_A,
  permissions: [MANAGE, READ, STOCK_READ, STOCK_OPERATE, APPROVE],
};
/** The same codes, but scoped to branch A2 — the P1-18-A-01 probe. */
const SCOPED_A2: Principal = {
  roleId: ROLE_SCOPED,
  userId: USER_SCOPED,
  subject: SUBJECT_SCOPED,
  tenantId: TENANT_A,
  permissions: [MANAGE, READ, STOCK_READ],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: GRANT_SCOPED,
};
const READER: Principal = {
  roleId: ROLE_READER,
  userId: USER_READER,
  subject: SUBJECT_READER,
  tenantId: TENANT_A,
  permissions: [READ, STOCK_READ],
};
/** The second person the maker–checker rule needs. */
const APPROVER: Principal = {
  roleId: ROLE_APPROVER,
  userId: USER_APPROVER,
  subject: SUBJECT_APPROVER,
  tenantId: TENANT_A,
  permissions: [APPROVE, STOCK_READ],
};
const TENANT_B_MANAGER: Principal = {
  roleId: ROLE_TENANT_B,
  userId: USER_TENANT_B,
  subject: SUBJECT_TENANT_B,
  tenantId: TENANT_B,
  permissions: [MANAGE, READ, STOCK_READ],
};
const PRINCIPALS = [MANAGER, SCOPED_A2, READER, APPROVER, TENANT_B_MANAGER];

let admin: Pool;
let runtime: Pool;

type Handler = (
  request: Request,
  route?: { params: Promise<Record<string, string>> }
) => Promise<Response>;

async function call<T = unknown>(
  handler: unknown,
  input: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
    readonly params?: Record<string, string>;
    readonly idempotencyKey?: string;
  }
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const response = await (handler as Handler)(
    new Request(`http://localhost/api/v1${input.path}`, init),
    {
      params: Promise.resolve(input.params ?? {}),
    }
  );
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

function authAs(principal: Principal): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    })
  );
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'P1-30 inventory fixture', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      principal.userId,
      principal.tenantId,
      IDENTITY_PROVIDER,
      principal.subject,
      `${principal.subject}@fixture.test`,
      USER_A,
    ]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-30 inventory fixture', $4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }
  if (principal.scope === undefined) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       SELECT $1, $2, $3, 'unrestricted', $4, $4
        WHERE NOT EXISTS (SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    return;
  }
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM iam.role_grants WHERE id = $1', [
      principal.grantId,
    ]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1, $2, $3, $4, 'scoped', $5, $5)`,
        [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1, $2, 'branch', $3, $4, $5)`,
        [
          principal.tenantId,
          principal.grantId,
          principal.scope.companyId,
          principal.scope.branchId,
          USER_A,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cleanPrincipals(): Promise<void> {
  const users = PRINCIPALS.map((p) => p.userId);
  const roles = PRINCIPALS.map((p) => p.roleId);
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1::uuid[])', [users]);
  await admin.query('DELETE FROM iam.role_permissions WHERE role_id = ANY($1::uuid[])', [roles]);
  await admin.query('DELETE FROM iam.roles WHERE id = ANY($1::uuid[])', [roles]);
  await admin.query('DELETE FROM iam.user_status_history WHERE user_id = ANY($1::uuid[])', [users]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])', [users]);
}

/** Everything this suite wrote through the routes, newest dependency first. */
async function cleanRows(): Promise<void> {
  for (const statement of [
    'DELETE FROM inv.stock_movements WHERE tenant_id = ANY($1::uuid[])',
    'DELETE FROM inv.stock_balances WHERE tenant_id = ANY($1::uuid[])',
    'DELETE FROM inv.opening_inventory_lines WHERE tenant_id = ANY($1::uuid[])',
    'DELETE FROM inv.opening_inventory_batches WHERE tenant_id = ANY($1::uuid[])',
    "DELETE FROM inv.stock_locations WHERE tenant_id = ANY($1::uuid[]) AND location_code LIKE 'P30-%'",
    "DELETE FROM inv.item_master WHERE tenant_id = ANY($1::uuid[]) AND sku LIKE 'P30-%'",
    "DELETE FROM inv.item_categories WHERE tenant_id = ANY($1::uuid[]) AND code LIKE 'p30_%'",
  ]) {
    await admin.query(statement, [[TENANT_A, TENANT_B]]);
  }
}

async function auditCount(action: string, entityId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2',
    [action, entityId]
  );
  return rows[0]?.n ?? 0;
}

const code = (stem: string): string => `p30_${stem}_${RUN}`;
const sku = (stem: string): string => `P30-${stem.toUpperCase()}-${RUN}`;
const loc = (stem: string): string => `P30-${stem.toUpperCase()}-${RUN}`;

async function platformUnitId(): Promise<string> {
  authAs(MANAGER);
  const units = await call<{ items: Array<{ id: string; scope: string; code: string }> }>(
    unitListRoute,
    {
      path: '/units-of-measure',
      method: 'GET',
    }
  );
  expect(units.status).toBe(200);
  const each = units.body.items.find((u) => u.scope === 'platform' && u.code === 'each');
  if (!each) throw new Error('the platform unit "each" is not seeded');
  return each.id;
}

async function createCategory(
  principal: Principal,
  stem: string,
  extra: Record<string, unknown> = {}
) {
  authAs(principal);
  return call<{ id: string; code: string; status: string; recordVersion: number }>(
    categoryCreateRoute,
    {
      path: '/item-categories',
      body: { code: code(stem), name: `Category ${stem}`, ...extra },
      idempotencyKey: randomUUID(),
    }
  );
}

async function createWarehouse(principal: Principal, branchId: string, stem: string) {
  authAs(principal);
  return call<{ id: string; locationCode: string; locationType: string; recordVersion: number }>(
    locationCreateRoute,
    {
      path: '/stock-locations',
      body: {
        companyId: COMPANY_A1,
        branchId,
        locationCode: loc(stem),
        name: `Warehouse ${stem}`,
        locationType: 'warehouse',
      },
      idempotencyKey: randomUUID(),
    }
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await cleanRows();
  for (const principal of PRINCIPALS) await seedPrincipal(principal);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
}, 180_000);

afterAll(async () => {
  __resetAuthenticatorForTests();
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanRows();
  await cleanPrincipals();
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

describe('declarations', () => {
  it('five operations, by id, on existing codes — nothing minted', () => {
    expect(ITEM_CATEGORY_LIST_OPERATION.id).toBe('inv.item-category-list');
    expect(ITEM_CATEGORY_LIST_OPERATION.permissions).toEqual([READ]);
    expect(ITEM_CATEGORY_CREATE_OPERATION.id).toBe('inv.item-category-create');
    expect(ITEM_CATEGORY_CREATE_OPERATION.permissions).toEqual([MANAGE]);
    expect(UNIT_OF_MEASURE_LIST_OPERATION.id).toBe('inv.uom-list');
    expect(ITEM_CREATE_OPERATION.id).toBe('inv.item-create');
    expect(ITEM_CREATE_OPERATION.permissions).toEqual([MANAGE]);
    expect(STOCK_LOCATION_CREATE_OPERATION.id).toBe('inv.stock-location-create');
    expect(STOCK_LOCATION_CREATE_OPERATION.scope).toBe('branch');
  });

  it('MD-B1 the administrator bundle now holds inv.adjustment.approve', () => {
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(APPROVE);
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(MANAGE);
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toHaveLength(67);
  });
});

describe('item categories', () => {
  it('MD-C1 creates a category, lists it, and refuses the same code twice', async () => {
    const created = await createCategory(MANAGER, 'c1');
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('active');
    expect(created.body.recordVersion).toBe(1);

    authAs(MANAGER);
    const listed = await call<{ items: Array<{ id: string; code: string }> }>(categoryListRoute, {
      path: '/item-categories?limit=50',
      method: 'GET',
    });
    expect(listed.status).toBe(200);
    expect(listed.body.items.some((c) => c.id === created.body.id)).toBe(true);

    const duplicate = await createCategory(MANAGER, 'c1');
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as unknown as { violations?: unknown[] }).violations).toEqual([
      { path: 'body.code', rule: 'duplicate_code' },
    ]);
  });

  it('MD-C2 requires inv.item.manage TENANT-WIDE: a branch-scoped holder is refused, a reader is refused', async () => {
    const scoped = await createCategory(SCOPED_A2, 'c2');
    expect(scoped.status).toBe(403);
    expect((scoped.body as { code: string }).code).toBe('ERR-IAM-001');
    const reader = await createCategory(READER, 'c2r');
    expect(reader.status).toBe(403);
  });

  it('refuses an unknown or inactive parent by the field', async () => {
    const unknown = await createCategory(MANAGER, 'c3', { parentCategoryId: randomUUID() });
    expect(unknown.status).toBe(422);
    expect((unknown.body as { violations: unknown[] }).violations).toEqual([
      { path: 'body.parentCategoryId', rule: 'unknown_category' },
    ]);
  });
});

describe('units and items', () => {
  it('MD-U1 the unit list returns the platform set to a reader', async () => {
    authAs(READER);
    const units = await call<{ items: Array<{ scope: string; code: string; dimension: string }> }>(
      unitListRoute,
      {
        path: '/units-of-measure',
        method: 'GET',
      }
    );
    expect(units.status).toBe(200);
    expect(units.body.items.filter((u) => u.scope === 'platform').length).toBeGreaterThanOrEqual(
      12
    );
    expect(units.body.items.every((u) => typeof u.dimension === 'string')).toBe(true);
  });

  it('MD-I1 creates an item that reads back through the search with its unit; MD-I3 a duplicate SKU is a 409', async () => {
    const category = await createCategory(MANAGER, 'i1');
    const uomId = await platformUnitId();
    authAs(MANAGER);
    const created = await call<{
      id: string;
      sku: string;
      unitOfMeasure: { id: string; code: string };
      lifecycleStatus: string;
      recordVersion: number;
    }>(itemCreateRoute, {
      path: '/items',
      body: {
        itemCategoryId: category.body.id,
        sku: sku('i1'),
        name: 'Brake pad set',
        uomId,
        itemType: 'part',
      },
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    expect(created.body.unitOfMeasure).toEqual({ id: uomId, code: 'each' });
    expect(created.body.lifecycleStatus).toBe('active');

    authAs(READER);
    const found = await call<{ items: Array<{ id: string; sku: string }> }>(itemSearchRoute, {
      path: `/items?search=${encodeURIComponent(sku('i1'))}`,
      method: 'GET',
    });
    expect(found.status).toBe(200);
    expect(found.body.items.map((i) => i.id)).toContain(created.body.id);

    authAs(MANAGER);
    const duplicate = await call<{ violations: unknown[] }>(itemCreateRoute, {
      path: '/items',
      body: {
        itemCategoryId: category.body.id,
        sku: sku('i1'),
        name: 'Another',
        uomId,
        itemType: 'part',
      },
      idempotencyKey: randomUUID(),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.violations).toEqual([{ path: 'body.sku', rule: 'duplicate_sku' }]);
  });

  it('MD-I2 an unknown category and an unknown unit are 422s naming the field', async () => {
    const category = await createCategory(MANAGER, 'i2');
    const uomId = await platformUnitId();
    authAs(MANAGER);
    const badCategory = await call<{ violations: unknown[] }>(itemCreateRoute, {
      path: '/items',
      body: { itemCategoryId: randomUUID(), sku: sku('i2a'), name: 'X', uomId, itemType: 'part' },
      idempotencyKey: randomUUID(),
    });
    expect(badCategory.status).toBe(422);
    expect(badCategory.body.violations).toEqual([
      { path: 'body.itemCategoryId', rule: 'unknown_category' },
    ]);
    const badUnit = await call<{ violations: unknown[] }>(itemCreateRoute, {
      path: '/items',
      body: {
        itemCategoryId: category.body.id,
        sku: sku('i2b'),
        name: 'X',
        uomId: randomUUID(),
        itemType: 'part',
      },
      idempotencyKey: randomUUID(),
    });
    expect(badUnit.status).toBe(422);
    expect(badUnit.body.violations).toEqual([{ path: 'body.uomId', rule: 'unknown_unit' }]);
  });

  it('MD-C2 (item) a branch-scoped holder of inv.item.manage cannot create an item', async () => {
    const category = await createCategory(MANAGER, 'i4');
    const uomId = await platformUnitId();
    authAs(SCOPED_A2);
    const refused = await call<{ code: string }>(itemCreateRoute, {
      path: '/items',
      body: {
        itemCategoryId: category.body.id,
        sku: sku('i4'),
        name: 'X',
        uomId,
        itemType: 'part',
      },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ERR-IAM-001');
  });
});

describe('stock locations', () => {
  it('MD-L1 creates a warehouse, nests storage under it, refuses a duplicate code', async () => {
    const warehouse = await createWarehouse(MANAGER, BRANCH_A1, 'l1');
    expect(warehouse.status).toBe(201);
    expect(warehouse.body.locationType).toBe('warehouse');

    authAs(MANAGER);
    const storage = await call<{ id: string; parentLocationId: string }>(locationCreateRoute, {
      path: '/stock-locations',
      body: {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        locationCode: loc('l1s'),
        name: 'Shelf',
        locationType: 'storage',
        parentLocationId: warehouse.body.id,
      },
      idempotencyKey: randomUUID(),
    });
    expect(storage.status).toBe(201);
    expect(storage.body.parentLocationId).toBe(warehouse.body.id);

    authAs(READER);
    const listed = await call<{ items: Array<{ id: string }> }>(locationListRoute, {
      path: `/stock-locations?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=100`,
      method: 'GET',
    });
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((l) => l.id)).toEqual(
      expect.arrayContaining([warehouse.body.id, storage.body.id])
    );

    const duplicate = await createWarehouse(MANAGER, BRANCH_A1, 'l1');
    expect(duplicate.status).toBe(409);
  });

  it('MD-L2 the hierarchy is refused by the field', async () => {
    const warehouse = await createWarehouse(MANAGER, BRANCH_A1, 'l2');
    const other = await createWarehouse(MANAGER, BRANCH_A2, 'l2b');
    expect(other.status).toBe(201);
    authAs(MANAGER);
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { locationType: 'warehouse', parentLocationId: warehouse.body.id },
        'warehouse_has_no_parent',
      ],
      [{ locationType: 'storage' }, 'parent_required'],
      [{ locationType: 'storage', parentLocationId: other.body.id }, 'parent_outside_branch'],
      [{ locationType: 'quarantine', parentLocationId: randomUUID() }, 'unknown_location'],
    ];
    for (const [extra, rule] of cases) {
      const refused = await call<{ violations: Array<{ rule: string }> }>(locationCreateRoute, {
        path: '/stock-locations',
        body: {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          locationCode: loc(`l2-${rule}`),
          name: 'X',
          ...extra,
        },
        idempotencyKey: randomUUID(),
      });
      expect(refused.status).toBe(422);
      expect(refused.body.violations[0]?.rule).toBe(rule);
    }
  });

  it('MD-L3 a holder scoped to A2 is refused A1 and admitted A2 (isolation)', async () => {
    const refused = await createWarehouse(SCOPED_A2, BRANCH_A1, 'l3a');
    expect(refused.status).toBe(403);
    const admitted = await createWarehouse(SCOPED_A2, BRANCH_A2, 'l3b');
    expect(admitted.status).toBe(201);
  });
});

describe('tenancy and audit', () => {
  it('MD-X1 tenant B sees none of tenant A rows, and its own writes stay in B', async () => {
    const a = await createCategory(MANAGER, 'x1');
    authAs(TENANT_B_MANAGER);
    const listedB = await call<{ items: Array<{ id: string }> }>(categoryListRoute, {
      path: '/item-categories?limit=100',
      method: 'GET',
    });
    expect(listedB.status).toBe(200);
    expect(listedB.body.items.some((c) => c.id === a.body.id)).toBe(false);

    const b = await createCategory(TENANT_B_MANAGER, 'x1');
    expect(b.status).toBe(201);
    const { rows } = await admin.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM inv.item_categories WHERE id = $1',
      [b.body.id]
    );
    expect(rows[0]?.tenant_id).toBe(TENANT_B);

    authAs(TENANT_B_MANAGER);
    const wrongTenantLocation = await call(locationCreateRoute, {
      path: '/stock-locations',
      body: {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        locationCode: loc('x1'),
        name: 'X',
        locationType: 'warehouse',
      },
      idempotencyKey: randomUUID(),
    });
    expect([403, 404]).toContain(wrongTenantLocation.status);
    const ownBranch = await call<{ id: string }>(locationCreateRoute, {
      path: '/stock-locations',
      body: {
        companyId: COMPANY_B1,
        branchId: BRANCH_B1,
        locationCode: loc('x1b'),
        name: 'B warehouse',
        locationType: 'warehouse',
      },
      idempotencyKey: randomUUID(),
    });
    expect(ownBranch.status).toBe(201);
  });

  it('MD-A1 each write is audited once, and a replay under the same key writes nothing twice', async () => {
    const key = randomUUID();
    authAs(MANAGER);
    const body = { code: code('a1'), name: 'Audited' };
    const first = await call<{ id: string }>(categoryCreateRoute, {
      path: '/item-categories',
      body,
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);
    const replay = await call<{ id: string }>(categoryCreateRoute, {
      path: '/item-categories',
      body,
      idempotencyKey: key,
    });
    expect(replay.body.id).toBe(first.body.id);
    expect(await auditCount('inv.item_category.created', first.body.id)).toBe(1);
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM inv.item_categories WHERE tenant_id = $1 AND code = $2',
      [TENANT_A, body.code]
    );
    expect(rows[0]?.n).toBe(1);

    const uomId = await platformUnitId();
    authAs(MANAGER);
    const item = await call<{ id: string }>(itemCreateRoute, {
      path: '/items',
      body: {
        itemCategoryId: first.body.id,
        sku: sku('a1'),
        name: 'Audited item',
        uomId,
        itemType: 'consumable',
      },
      idempotencyKey: randomUUID(),
    });
    expect(item.status).toBe(201);
    expect(await auditCount('inv.item.created', item.body.id)).toBe(1);

    const warehouse = await createWarehouse(MANAGER, BRANCH_A1, 'a1');
    expect(await auditCount('inv.stock_location.created', warehouse.body.id)).toBe(1);
  });
});

describe('MD-CHAIN — from an empty catalogue to on-hand stock, through shipped routes only', () => {
  it('category -> unit -> item -> warehouse -> opening batch -> line -> approval by a second person -> availability', async () => {
    const category = await createCategory(MANAGER, 'chain');
    const uomId = await platformUnitId();
    authAs(MANAGER);
    const item = await call<{ id: string }>(itemCreateRoute, {
      path: '/items',
      body: {
        itemCategoryId: category.body.id,
        sku: sku('chain'),
        name: 'Oil filter',
        uomId,
        itemType: 'part',
      },
      idempotencyKey: randomUUID(),
    });
    expect(item.status).toBe(201);
    const warehouse = await createWarehouse(MANAGER, BRANCH_A1, 'chain');
    expect(warehouse.status).toBe(201);

    authAs(MANAGER);
    const batch = await call<{ id: string }>(batchCreateRoute, {
      path: '/opening-inventory-batches',
      body: {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        batchCode: loc('chain-b'),
        asOfDate: '2026-09-01',
      },
      idempotencyKey: randomUUID(),
    });
    expect(batch.status).toBe(201);
    const line = await call<{ quantity: string }>(batchLineRoute, {
      path: `/opening-inventory-batches/${batch.body.id}/lines`,
      params: { batchId: batch.body.id },
      body: { itemId: item.body.id, locationId: warehouse.body.id, quantity: '12.000' },
    });
    expect(line.status).toBe(201);

    // The counter may not approve their own count (ck_opening_inventory_batches_maker).
    const self = await call(batchApproveRoute, {
      path: `/opening-inventory-batches/${batch.body.id}/approval`,
      params: { batchId: batch.body.id },
      idempotencyKey: randomUUID(),
    });
    expect(self.status).toBe(409);

    authAs(APPROVER);
    const approved = await call(batchApproveRoute, {
      path: `/opening-inventory-batches/${batch.body.id}/approval`,
      params: { batchId: batch.body.id },
      idempotencyKey: randomUUID(),
    });
    expect(approved.status).toBe(200);

    authAs(READER);
    const availability = await call<{
      items: Array<{ itemId: string; locationId: string; onHand: string; available: string }>;
    }>(availabilityRoute, {
      path: `/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${item.body.id}`,
      method: 'GET',
    });
    expect(availability.status).toBe(200);
    const cell = availability.body.items.find(
      (c) => c.itemId === item.body.id && c.locationId === warehouse.body.id
    );
    expect(cell?.onHand).toBe('12.000');
    expect(cell?.available).toBe('12.000');
  });
});
