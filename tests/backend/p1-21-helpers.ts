/**
 * Phase 1-21 backend fixtures — inventory.
 *
 * Builds the minimum protected-schema state the inventory surface needs, in BOTH
 * tenants and in two tenant-A branches, so cross-tenant and cross-branch isolation
 * can be asserted rather than assumed.
 *
 * Principals are seeded here rather than reused from `p1-19-helpers` or
 * `p1-20-helpers` because neither carries an `inv.*` permission, and widening them
 * would change what those suites prove.
 *
 * The scoped principals are the point of the file:
 *
 *  - `INV_SCOPED_A2` holds every `inv.*` permission scoped to branch A2 **only**.
 *  - `INV_PERMISSION_ELSEWHERE` holds them scoped to A2 *and* an unrelated
 *    permission scoped to A1. That second grant puts A1 into its
 *    `iam.allowed_branch_ids()` union without giving it inventory authority there —
 *    the only way to prove that a *scoped permission check*, and not RLS, is what
 *    refuses the request (P1-18-A-01). Without it, an A2-scoped principal has A1
 *    outside the union, the row is invisible to RLS, and the test would pass against
 *    a scope-blind implementation.
 *  - `INV_NO_COST` holds every inventory permission **except** `inv.cost.view`, so
 *    the restricted external-purchase cost can be proved unreachable by a caller who
 *    is otherwise fully authorized.
 */
import type { Pool } from 'pg';
import { BRANCH_A1, COMPANY_A1, IDENTITY_PROVIDER, TENANT_A, TENANT_B, USER_A } from './helpers';
import { BRANCH_A2, BRANCH_B1, COMPANY_B1, type Principal } from './p1-19-helpers';
import { StaticClaimsAuthenticator, setSessionAuthenticator } from '@/server/context/principal';

/** An unrelated permission used only to widen a grant union. */
const WIDENING_PERMISSION = 'org.tenant.read';
const WIDENING_ROLE = 'e1000000-0000-4000-8000-0000000000f0';

export const ITEM_READ = 'inv.item.read';
export const STOCK_READ = 'inv.stock.read';
export const STOCK_OPERATE = 'inv.stock.operate';
export const ADJUSTMENT_APPROVE = 'inv.adjustment.approve';
export const COST_VIEW = 'inv.cost.view';
export const CUSTODY_MANAGE = 'inv.custody.manage';
export const EXTERNAL_PURCHASE_RECORD = 'inv.external_purchase.record';
export const AUDIT_READ = 'inv.audit.read';
/** Needed to create the work orders stock is issued to. */
export const WORK_ORDER_READ = 'wo.work_order.read';
/** P1-32 preparatory slice 2: the catalogue authority identifier writes require. */
export const ITEM_MANAGE = 'inv.item.manage';
/**
 * P1-32 preparatory slice 2: the three `sal` codes a counter sale needs.
 *
 * A counter sale is sold from stock and invoiced in one act, so the principal that
 * performs it holds inventory AND billing authority. They are named here rather
 * than imported from `p1-22-helpers.ts` because that module seeds its own tenant-A
 * fixtures, principals and payment methods, and a suite that wanted three codes
 * would inherit all of it.
 */
export const INVOICE_MANAGE = 'sal.invoice.manage';
export const INVOICE_ISSUE = 'sal.invoice.issue';
export const FINANCE_VIEW = 'sal.finance.view';

const ALL_INVENTORY = [
  ITEM_READ,
  STOCK_READ,
  STOCK_OPERATE,
  ADJUSTMENT_APPROVE,
  COST_VIEW,
  CUSTODY_MANAGE,
  EXTERNAL_PURCHASE_RECORD,
  AUDIT_READ,
  WORK_ORDER_READ,
];

// ---- Fixture ids -----------------------------------------------------------

export const UOM_EACH = 'e1000000-0000-4000-8000-000000000001';
export const CATEGORY_A = 'e1000000-0000-4000-8000-000000000011';
export const CATEGORY_B = 'e1000000-0000-4000-8000-000000000012';

export const ITEM_A = 'e1000000-0000-4000-8000-0000000000a1';
export const ITEM_A_ALT = 'e1000000-0000-4000-8000-0000000000a2';
/** Archived, so it must never appear in a default (active) listing. */
export const ITEM_A_ARCHIVED = 'e1000000-0000-4000-8000-0000000000a3';
/** Not stock-tracked, so no balance may be built against it. */
export const ITEM_A_UNTRACKED = 'e1000000-0000-4000-8000-0000000000a4';
/** SKU contains a literal LIKE metacharacter, to prove the search escapes it. */
export const ITEM_A_WILDCARD = 'e1000000-0000-4000-8000-0000000000a5';
export const ITEM_B = 'e1000000-0000-4000-8000-0000000000b1';

export const WAREHOUSE_A1 = 'e1000000-0000-4000-8000-0000000000c1';
export const QUARANTINE_A1 = 'e1000000-0000-4000-8000-0000000000c2';
/** A second SELLABLE location in A1, so a non-quarantine damage target exists. */
export const STORAGE_A1 = 'e1000000-0000-4000-8000-0000000000c3';
export const WAREHOUSE_A2 = 'e1000000-0000-4000-8000-0000000000c4';
export const QUARANTINE_A2 = 'e1000000-0000-4000-8000-0000000000c5';
export const WAREHOUSE_B1 = 'e1000000-0000-4000-8000-0000000000c6';

/**
 * A SECOND company inside tenant A, with its own branch, location and stock.
 *
 * H6 needs it. Every other tenant-A fixture hangs off `COMPANY_A1`, so a (company,
 * branch) pair could never be INCOHERENT — and the leak only exists for an
 * incoherent pair. With one company in the tenant the hole is unreachable by
 * construction, which is exactly why nothing caught it.
 */
export const COMPANY_A9 = 'e1000000-0000-4000-8000-0000000009c1';
export const BRANCH_A9 = 'e1000000-0000-4000-8000-0000000009b1';
export const WAREHOUSE_A9 = 'e1000000-0000-4000-8000-0000000009d1';

const COMPANY_SCOPED_GRANT = 'e1000000-0000-4000-8000-0000000009f1';
const COMPANY_SCOPED_WIDENING_ROLE = 'e1000000-0000-4000-8000-0000000009e3';
const COMPANY_SCOPED_WIDENING_GRANT = 'e1000000-0000-4000-8000-0000000009f2';

export const INV_FULL: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000101',
  userId: 'e1000000-0000-4000-8000-000000000102',
  subject: 'fx_p1_21_full',
  tenantId: TENANT_A,
  permissions: ALL_INVENTORY,
};

/** A second unrestricted tenant-A principal, so maker <> approver is satisfiable. */
export const INV_APPROVER: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000111',
  userId: 'e1000000-0000-4000-8000-000000000112',
  subject: 'fx_p1_21_approver',
  tenantId: TENANT_A,
  permissions: ALL_INVENTORY,
};

/** Reads only. Proves an operate/approve refusal is about authority, not tenancy. */
export const INV_READER: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000121',
  userId: 'e1000000-0000-4000-8000-000000000122',
  subject: 'fx_p1_21_reader',
  tenantId: TENANT_A,
  permissions: [ITEM_READ, STOCK_READ, WORK_ORDER_READ],
};

/** Everything except `inv.cost.view`, for the restricted-cost control. */
export const INV_NO_COST: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000131',
  userId: 'e1000000-0000-4000-8000-000000000132',
  subject: 'fx_p1_21_no_cost',
  tenantId: TENANT_A,
  permissions: ALL_INVENTORY.filter((code) => code !== COST_VIEW),
};

export const INV_SCOPED_A2: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000141',
  userId: 'e1000000-0000-4000-8000-000000000142',
  subject: 'fx_p1_21_scoped_a2',
  tenantId: TENANT_A,
  permissions: ALL_INVENTORY,
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'e1000000-0000-4000-8000-0000000001f1',
};

/**
 * Scoped to A2, but with A1 inside its permission-blind allowed-branch union.
 *
 * The decisive isolation principal: A1's rows ARE visible to RLS for this caller,
 * so the only thing that can refuse an A1 request is the scoped permission check.
 */
export const INV_PERMISSION_ELSEWHERE: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000151',
  userId: 'e1000000-0000-4000-8000-000000000152',
  subject: 'fx_p1_21_permission_elsewhere',
  tenantId: TENANT_A,
  permissions: ALL_INVENTORY,
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'e1000000-0000-4000-8000-0000000001f2',
};

/**
 * H6 — inventory permissions held COMPANY-scoped to `COMPANY_A1`, plus an unrelated
 * BRANCH-scoped grant on `BRANCH_A9` (a branch of the OTHER company).
 *
 * `iam.has_permission_in_scope` matches
 *   (scope_type='company' AND company_id = p_company)
 *   OR (scope_type='branch' AND branch_id = p_branch)
 * so naming `companyId=COMPANY_A1&branchId=BRANCH_A9` satisfies the check on the
 * COMPANY half while pointing the query at company A9 — and the widening grant puts
 * A9 inside `iam.allowed_branch_ids()`, so RLS admits the rows too. Only a
 * `company_id` SQL predicate refuses it.
 *
 * Its grant is built by hand rather than through `Principal.scope`, which always
 * writes `scope_type='branch'`. No other P1-21 principal has a company-scoped grant,
 * which is the second reason the hole survived every existing isolation test.
 */
export const INV_COMPANY_SCOPED: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000009e1',
  userId: 'e1000000-0000-4000-8000-0000000009e2',
  subject: 'fx_p1_21_company_scoped',
  tenantId: TENANT_A,
  permissions: ALL_INVENTORY,
};

/** Tenant B, unrestricted. A refusal from it is the tenant boundary, not authority. */
export const INV_TENANT_B: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000161',
  userId: 'e1000000-0000-4000-8000-000000000162',
  subject: 'fx_p1_21_tenant_b',
  tenantId: TENANT_B,
  permissions: ALL_INVENTORY,
};

/**
 * P1-32 preparatory slice 2. Every inventory permission plus `inv.item.manage`,
 * UNRESTRICTED — the tenant-wide catalogue authority an identifier write requires.
 */
export const INV_CATALOG: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000171',
  userId: 'e1000000-0000-4000-8000-000000000172',
  subject: 'fx_p1_21_catalog',
  tenantId: TENANT_A,
  permissions: [...ALL_INVENTORY, ITEM_MANAGE],
};

/**
 * The same authority scoped to branch A1 only. An identifier resolves its item in
 * every branch, so a branch-scoped `inv.item.manage` must be refused.
 */
export const INV_CATALOG_SCOPED_A1: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000181',
  userId: 'e1000000-0000-4000-8000-000000000182',
  subject: 'fx_p1_21_catalog_scoped_a1',
  tenantId: TENANT_A,
  permissions: [...ALL_INVENTORY, ITEM_MANAGE],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A1 },
  grantId: 'e1000000-0000-4000-8000-0000000001f3',
};

/** Tenant B with the same unrestricted catalogue authority: a refusal is the tenant boundary. */
export const INV_TENANT_B_CATALOG: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000191',
  userId: 'e1000000-0000-4000-8000-000000000192',
  subject: 'fx_p1_21_tenant_b_catalog',
  tenantId: TENANT_B,
  permissions: [...ALL_INVENTORY, ITEM_MANAGE],
};

/**
 * P1-32 preparatory slice 2. Everything the counter needs: the inventory codes, the
 * tenant-wide catalogue authority a selling price requires, and the three `sal`
 * codes that create and issue the invoice.
 */
export const INV_COUNTER: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001a1',
  userId: 'e1000000-0000-4000-8000-0000000001a2',
  subject: 'fx_p1_21_counter',
  tenantId: TENANT_A,
  permissions: [...ALL_INVENTORY, ITEM_MANAGE, INVOICE_MANAGE, INVOICE_ISSUE, FINANCE_VIEW],
};

/**
 * The same authority scoped to branch A2.
 *
 * A2 is a real branch of the same company, so RLS does not hide A1's rows from a
 * caller whose union includes them — which is what makes a refusal here a statement
 * about the scoped permission check and not about row visibility.
 */
export const INV_COUNTER_SCOPED_A2: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001b1',
  userId: 'e1000000-0000-4000-8000-0000000001b2',
  subject: 'fx_p1_21_counter_scoped_a2',
  tenantId: TENANT_A,
  permissions: [...ALL_INVENTORY, ITEM_MANAGE, INVOICE_MANAGE, INVOICE_ISSUE, FINANCE_VIEW],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'e1000000-0000-4000-8000-0000000001f4',
};

/** Tenant B with the same authority: a refusal is the tenant boundary. */
export const INV_TENANT_B_COUNTER: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001c1',
  userId: 'e1000000-0000-4000-8000-0000000001c2',
  subject: 'fx_p1_21_tenant_b_counter',
  tenantId: TENANT_B,
  permissions: [...ALL_INVENTORY, ITEM_MANAGE, INVOICE_MANAGE, INVOICE_ISSUE, FINANCE_VIEW],
};

/**
 * P1-32 preparatory slice 3b. The five material-demand codes on top of every
 * inventory code, UNRESTRICTED — a requester who can also operate stock, and the
 * tenant-wide authority reference-data writes require.
 */
export const MATERIAL_REQUEST = 'inv.material.request';
export const MATERIAL_APPROVE = 'inv.material.approve';
export const MATERIAL_EXCEPTION_APPROVE = 'inv.material.exception.approve';
export const UNIT_CONVERSION_MANAGE = 'inv.unit_conversion.manage';
export const SPECIFICATION_MANAGE = 'inv.specification.manage';
const ALL_MATERIAL = [
  ...ALL_INVENTORY,
  MATERIAL_REQUEST,
  MATERIAL_APPROVE,
  MATERIAL_EXCEPTION_APPROVE,
  UNIT_CONVERSION_MANAGE,
  SPECIFICATION_MANAGE,
];

export const INV_MATERIAL: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001d1',
  userId: 'e1000000-0000-4000-8000-0000000001d2',
  subject: 'fx_p1_21_material',
  tenantId: TENANT_A,
  permissions: ALL_MATERIAL,
};

/** The same codes held by a second person, so requester <> approver is satisfiable. */
export const INV_MATERIAL_APPROVER: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001e1',
  userId: 'e1000000-0000-4000-8000-0000000001e2',
  subject: 'fx_p1_21_material_approver',
  tenantId: TENANT_A,
  permissions: ALL_MATERIAL,
};

/**
 * The same codes scoped to branch A2. A2 is a real branch of the same company, so a
 * refusal of an A1 request is the scoped check; a reference-data write is refused
 * because the authority is not held tenant-wide.
 */
export const INV_MATERIAL_SCOPED_A2: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001d3',
  userId: 'e1000000-0000-4000-8000-0000000001d4',
  subject: 'fx_p1_21_material_scoped_a2',
  tenantId: TENANT_A,
  permissions: ALL_MATERIAL,
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'e1000000-0000-4000-8000-0000000001f5',
};

/**
 * Every material code and `inv.stock.operate`, but NOT `inv.stock.read`
 * (CC-OD-32).
 *
 * The two are independent codes in the catalogue: nothing makes holding one
 * imply the other, and a store operator who draws stock for jobs without being
 * able to open the demand records is an ordinary shape of grant. That is what
 * makes the draw refusal's figures a leak worth closing — the allowance and the
 * quantity already committed are contents of a requirement this actor cannot
 * read, and a refusal that published them would hand out exactly what the read
 * permission withholds.
 */
export const INV_MATERIAL_NO_STOCK_READ: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001e5',
  userId: 'e1000000-0000-4000-8000-0000000001e6',
  subject: 'fx_p1_21_material_no_stock_read',
  tenantId: TENANT_A,
  permissions: ALL_MATERIAL.filter((code) => code !== STOCK_READ),
};

/** The identity-directory code an actor name is resolved behind. */
export const USER_READ = 'iam.user.read';

/**
 * Stock reads PLUS the identity-directory code (Owner directive,
 * P1-32-PRE-OD-UX).
 *
 * `inv.part-issue-list` names who issued each part through
 * `iamDirectory().directory`, which checks `iam.user.read` itself and hands back
 * an EMPTY map to a caller without it. No other P1-21 principal holds that code,
 * so without this one the read's null branch would be the only branch any case
 * could reach — and an assertion that the name is absent proves nothing if the
 * resolution is broken for everybody. This principal is what makes the negative
 * case falsifiable.
 */
export const INV_READER_NAMED: Principal = {
  roleId: 'e1000000-0000-4000-8000-000000000201',
  userId: 'e1000000-0000-4000-8000-000000000202',
  subject: 'fx_p1_21_reader_named',
  tenantId: TENANT_A,
  permissions: [ITEM_READ, STOCK_READ, WORK_ORDER_READ, USER_READ],
};

/** Tenant B with the same authority: a refusal is the tenant boundary. */
export const INV_TENANT_B_MATERIAL: Principal = {
  roleId: 'e1000000-0000-4000-8000-0000000001e3',
  userId: 'e1000000-0000-4000-8000-0000000001e4',
  subject: 'fx_p1_21_tenant_b_material',
  tenantId: TENANT_B,
  permissions: ALL_MATERIAL,
};

export const P1_21_PRINCIPALS: readonly Principal[] = [
  INV_FULL,
  INV_APPROVER,
  INV_READER,
  INV_NO_COST,
  INV_SCOPED_A2,
  INV_PERMISSION_ELSEWHERE,
  INV_COMPANY_SCOPED,
  INV_TENANT_B,
  INV_CATALOG,
  INV_CATALOG_SCOPED_A1,
  INV_TENANT_B_CATALOG,
  INV_COUNTER,
  INV_COUNTER_SCOPED_A2,
  INV_TENANT_B_COUNTER,
  INV_MATERIAL,
  INV_MATERIAL_APPROVER,
  INV_MATERIAL_SCOPED_A2,
  INV_MATERIAL_NO_STOCK_READ,
  INV_READER_NAMED,
  INV_TENANT_B_MATERIAL,
];

let admin: Pool;
/** Monotonic, so every seeded batch carries a distinct `batch_code`. */
let seedSeq = 0;

export function authAs(principal: Principal): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    })
  );
}

export async function countRowsOf(sql: string, values: readonly unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

export function auditCountFor(action: string, entityId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
}

export function outboxCountFor(eventKey: string): Promise<number> {
  return countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_key = $1`, [
    eventKey,
  ]);
}

/** Movement rows for a cell — the ledger fact a stock assertion must rest on. */
export function movementCountFor(itemId: string, locationId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM inv.stock_movements WHERE item_id = $1 AND location_id = $2`,
    [itemId, locationId]
  );
}

export async function balanceOf(
  itemId: string,
  locationId: string
): Promise<{ onHand: string; reserved: string; available: string } | null> {
  const result = await admin.query<{
    on_hand_qty: string;
    reserved_qty: string;
    available_qty: string;
  }>(
    `SELECT on_hand_qty, reserved_qty, available_qty FROM inv.stock_balances
      WHERE item_id = $1 AND location_id = $2`,
    [itemId, locationId]
  );
  const row = result.rows[0];
  return row
    ? { onHand: row.on_hand_qty, reserved: row.reserved_qty, available: row.available_qty }
    : null;
}

export async function reservationStatusOf(reservationId: string): Promise<string | null> {
  const result = await admin.query<{ status: string }>(
    `SELECT status FROM inv.stock_reservations WHERE id = $1`,
    [reservationId]
  );
  return result.rows[0]?.status ?? null;
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-21 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-21 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }

  // Its grant is COMPANY-scoped and built by hand below; `Principal.scope` can only
  // express a branch scope, and an unrestricted grant here would defeat H6 entirely.
  if (principal.userId === INV_COMPANY_SCOPED.userId) return;

  if (principal.scope === undefined) {
    const existing = await admin.query(
      `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
      [principal.tenantId, principal.userId, principal.roleId]
    );
    if (existing.rowCount === 0) {
      await admin.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
        [principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
    }
    return;
  }
  // A scoped active grant must carry at least one scope, enforced by a DEFERRABLE
  // constraint trigger — so the grant and its scope land in one transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      principal.grantId,
    ]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
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

/**
 * Seeds the catalog and locations.
 *
 * Runs as the admin role with the actor GUC set, because `created_by` is NOT NULL
 * everywhere and several `inv` triggers read `iam.current_user_id()`.
 */
export async function establishP1_21Fixtures(pool: Pool): Promise<void> {
  admin = pool;
  for (const principal of P1_21_PRINCIPALS) await seedPrincipal(principal);

  // The widening grant. See the file header: without A1 in the allowed-branch union
  // an isolation refusal proves nothing, because RLS would have hidden the row anyway.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_21_widening','P1-21 widening',$3) ON CONFLICT (id) DO NOTHING`,
    [WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  const wideningGrant = 'e1000000-0000-4000-8000-0000000001f9';
  const widening = await admin.connect();
  try {
    await widening.query('BEGIN');
    const existing = await widening.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      wideningGrant,
    ]);
    if (existing.rowCount === 0) {
      await widening.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [wideningGrant, TENANT_A, INV_PERMISSION_ELSEWHERE.userId, WIDENING_ROLE, USER_A]
      );
      await widening.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [TENANT_A, wideningGrant, COMPANY_A1, BRANCH_A1, USER_A]
      );
    }
    await widening.query('COMMIT');
  } catch (error) {
    await widening.query('ROLLBACK');
    throw error;
  } finally {
    widening.release();
  }

  // ---- H6: a second company in tenant A, and a COMPANY-scoped principal ----------
  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p1_21_company_a9','P1-21 Second Company','JOD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A9, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'fx_p1_21_branch_a9','P1-21 Second Branch','Asia/Amman',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A9, TENANT_A, COMPANY_A9, USER_A]
  );

  const companyScoped = await admin.connect();
  try {
    await companyScoped.query('BEGIN');
    const existing = await companyScoped.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      COMPANY_SCOPED_GRANT,
    ]);
    if (existing.rowCount === 0) {
      await companyScoped.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [
          COMPANY_SCOPED_GRANT,
          TENANT_A,
          INV_COMPANY_SCOPED.userId,
          INV_COMPANY_SCOPED.roleId,
          USER_A,
        ]
      );
      // scope_type = 'company' — deliberately, and uniquely among P1-21 principals.
      await companyScoped.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
         VALUES ($1,$2,'company',$3,$4)`,
        [TENANT_A, COMPANY_SCOPED_GRANT, COMPANY_A1, USER_A]
      );
    }
    await companyScoped.query('COMMIT');
  } catch (error) {
    await companyScoped.query('ROLLBACK');
    throw error;
  } finally {
    companyScoped.release();
  }

  // ...and an UNRELATED permission branch-scoped to A9, so A9 is inside this caller's
  // permission-blind allowed-branch union and RLS is not what refuses the request.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_21_widening_a9','P1-21 widening A9',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_SCOPED_WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, COMPANY_SCOPED_WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  const widenA9 = await admin.connect();
  try {
    await widenA9.query('BEGIN');
    const existing = await widenA9.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      COMPANY_SCOPED_WIDENING_GRANT,
    ]);
    if (existing.rowCount === 0) {
      await widenA9.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [
          COMPANY_SCOPED_WIDENING_GRANT,
          TENANT_A,
          INV_COMPANY_SCOPED.userId,
          COMPANY_SCOPED_WIDENING_ROLE,
          USER_A,
        ]
      );
      await widenA9.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [TENANT_A, COMPANY_SCOPED_WIDENING_GRANT, COMPANY_A9, BRANCH_A9, USER_A]
      );
    }
    await widenA9.query('COMMIT');
  } catch (error) {
    await widenA9.query('ROLLBACK');
    throw error;
  } finally {
    widenA9.release();
  }

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );

    // A tenant-scoped UoM. The platform catalog is seeded by 07_inv_units_of_measure,
    // but relying on a seeded row would couple these fixtures to that file's contents.
    await client.query(
      `INSERT INTO inv.units_of_measure (id, scope, tenant_id, code, name, dimension, created_by)
       VALUES ($1,'tenant',$2,'fx_each','Fixture each','count',$3) ON CONFLICT (id) DO NOTHING`,
      [UOM_EACH, TENANT_A, USER_A]
    );
    await client.query(
      `INSERT INTO inv.item_categories (id, tenant_id, code, name, created_by)
       VALUES ($1,$2,'fx_p1_21_parts','P1-21 parts',$3) ON CONFLICT (id) DO NOTHING`,
      [CATEGORY_A, TENANT_A, USER_A]
    );

    const items: readonly [string, string, string, boolean, string][] = [
      [ITEM_A, 'FX-P121-A', 'Fixture brake pad', true, 'active'],
      [ITEM_A_ALT, 'FX-P121-B', 'Fixture oil filter', true, 'active'],
      [ITEM_A_ARCHIVED, 'FX-P121-ARCH', 'Fixture archived part', true, 'archived'],
      [ITEM_A_UNTRACKED, 'FX-P121-UNTRACKED', 'Fixture untracked part', false, 'active'],
      // The underscore is a LIKE single-character wildcard. A search for the literal
      // must not match `FX-P121-A`, which is what proves the term is escaped.
      [ITEM_A_WILDCARD, 'FX_P121_WILD', 'Fixture wildcard part', true, 'active'],
    ];
    for (const [id, sku, name, tracked, lifecycle] of items) {
      await client.query(
        `INSERT INTO inv.item_master
           (id, tenant_id, item_category_id, sku, name, uom_id, is_stock_tracked,
            lifecycle_status, archived_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 CASE WHEN $8 = 'archived' THEN now() ELSE NULL END,$9)
         ON CONFLICT (id) DO NOTHING`,
        [id, TENANT_A, CATEGORY_A, sku, name, UOM_EACH, tracked, lifecycle, USER_A]
      );
    }

    const locations: readonly [string, string, string, string, string][] = [
      [WAREHOUSE_A1, COMPANY_A1, BRANCH_A1, 'FX-WH-A1', 'warehouse'],
      [STORAGE_A1, COMPANY_A1, BRANCH_A1, 'FX-ST-A1', 'storage'],
      [QUARANTINE_A1, COMPANY_A1, BRANCH_A1, 'FX-QR-A1', 'quarantine'],
      [WAREHOUSE_A2, COMPANY_A1, BRANCH_A2, 'FX-WH-A2', 'warehouse'],
      [QUARANTINE_A2, COMPANY_A1, BRANCH_A2, 'FX-QR-A2', 'quarantine'],
      // In the OTHER company, so H6 has real stock to disclose or refuse.
      [WAREHOUSE_A9, COMPANY_A9, BRANCH_A9, 'FX-WH-A9', 'warehouse'],
    ];
    for (const [id, companyId, branchId, code, type] of locations) {
      // The parent is resolved HERE rather than in SQL. Deciding it in a CASE would
      // have made one placeholder serve as both a uuid column value and a comparison
      // operand, which `pg` refuses with "inconsistent types deduced for parameter".
      // A warehouse has no parent; storage and quarantine nest under the warehouse in
      // their own branch (`inv.guard_stock_location_hierarchy`).
      const parentId =
        type === 'warehouse' ? null : branchId === BRANCH_A1 ? WAREHOUSE_A1 : WAREHOUSE_A2;
      await client.query(
        `INSERT INTO inv.stock_locations
           (id, tenant_id, company_id, branch_id, location_code, name, location_type,
            parent_location_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [id, TENANT_A, companyId, branchId, code, type, parentId, USER_A]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Tenant B, so a cross-tenant refusal has a REAL row behind it rather than an
  // absent one — an empty result proves nothing about the tenant boundary.
  const bClient = await admin.connect();
  try {
    await bClient.query('BEGIN');
    await bClient.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_B]
    );
    await bClient.query(
      `INSERT INTO inv.item_categories (id, tenant_id, code, name, created_by)
       VALUES ($1,$2,'fx_p1_21_parts','P1-21 parts',$3) ON CONFLICT (id) DO NOTHING`,
      [CATEGORY_B, TENANT_B, USER_A]
    );
    await bClient.query(
      `INSERT INTO inv.units_of_measure (id, scope, tenant_id, code, name, dimension, created_by)
       VALUES ($1,'tenant',$2,'fx_each','Fixture each','count',$3) ON CONFLICT (id) DO NOTHING`,
      ['e1000000-0000-4000-8000-0000000000f1', TENANT_B, USER_A]
    );
    await bClient.query(
      `INSERT INTO inv.item_master
         (id, tenant_id, item_category_id, sku, name, uom_id, created_by)
       VALUES ($1,$2,$3,'FX-P121-TENANT-B','Tenant B part',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [ITEM_B, TENANT_B, CATEGORY_B, 'e1000000-0000-4000-8000-0000000000f1', USER_A]
    );
    await bClient.query(
      `INSERT INTO inv.stock_locations
         (id, tenant_id, company_id, branch_id, location_code, name, location_type, created_by)
       VALUES ($1,$2,$3,$4,'FX-WH-B1','FX-WH-B1','warehouse',$5)
       ON CONFLICT (id) DO NOTHING`,
      [WAREHOUSE_B1, TENANT_B, COMPANY_B1, BRANCH_B1, USER_A]
    );
    await bClient.query('COMMIT');
  } catch (error) {
    await bClient.query('ROLLBACK');
    throw error;
  } finally {
    bClient.release();
  }
}

/**
 * A brand-new sellable location in a branch, and therefore a NEVER-OPENED cell.
 *
 * `uq_stock_movements_opening_cell` allows one `opening` movement per
 * (tenant, company, branch, item, location), so a file that approves several
 * batches needs several cells. The fixture catalogue holds four usable tenant-A
 * cells (two stock-tracked items across two sellable locations) — fewer than
 * `p1-21-inventory-intake.test.ts` alone approves — and adding more constants
 * would put a fixed ceiling one test further away rather than removing it.
 *
 * A location, not an item: `location_code` is unique per branch and nothing else
 * about a warehouse row is asserted anywhere, whereas an item carries a SKU, a
 * category, a unit and a lifecycle that several read suites do assert on.
 * `cleanP1_21Fixtures` already deletes every `inv.stock_locations` row of both
 * tenants, so these need no cleanup of their own.
 */
export async function freshLocation(
  branchId: string = BRANCH_A1,
  companyId: string = COMPANY_A1
): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id',$1,true)`, [USER_A]);
    const row = await client.query<{ id: string }>(
      `INSERT INTO inv.stock_locations
         (tenant_id, company_id, branch_id, location_code, name, location_type, created_by)
       VALUES ($1,$2,$3,$4,$4,'warehouse',$5) RETURNING id`,
      [TENANT_A, companyId, branchId, `FX-CELL-${(seedSeq += 1)}`, USER_A]
    );
    await client.query('COMMIT');
    return row.rows[0]?.id ?? '';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Puts stock into a cell the way the platform does — an approved opening batch the
 * FIRST time that cell is stocked, and an approved stock ADJUSTMENT every time
 * after.
 *
 * Deliberately NOT a direct `stock_balances` write: `inv.guard_stock_balance_coherence`
 * would reject one, and a fixture that bypassed the ledger would let a test assert a
 * balance the movement history does not support. Runs as the admin role with the
 * actor GUC set, and uses two different actors so the maker-checker CHECK is met.
 *
 * ## Why the second call is an adjustment
 *
 * `uq_stock_movements_opening_cell` allows ONE `opening` movement per
 * (tenant, company, branch, item, location). This helper is called many times per
 * file against a small set of fixed cells — (ITEM_A, WAREHOUSE_A1) more than a
 * dozen times in `p1-21-inventory-stock.test.ts` alone — and every call after the
 * first used to mint a SECOND opening count of a cell already opened, which is
 * exactly the double-count the index now forbids.
 *
 * Topping the cell up by an approved adjustment is what the product tells an
 * operator to do, so the fixture now takes the same route. Nothing an assertion
 * reads changes: `inv.post_stock_movement` adds an `adjustment`/`in` movement of
 * the same quantity, `on_hand` lands on the same figure, and the coherence guard
 * re-derives it from the ledger either way. What differs is `movement_type`, and
 * only two callers look at that — both of them read their own issue/return/damage
 * movements, never the seed.
 */
export async function seedStock(input: {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly tenantId?: string;
  readonly companyId?: string;
  readonly branchId?: string;
}): Promise<void> {
  const tenantId = input.tenantId ?? TENANT_A;
  const companyId = input.companyId ?? COMPANY_A1;
  const branchId = input.branchId ?? BRANCH_A1;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    // Has this cell already been opened? The question the index answers, asked
    // the same way it is indexed.
    const opened = await client.query(
      `SELECT 1 FROM inv.stock_movements
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND item_id = $4 AND location_id = $5 AND movement_type = 'opening'`,
      [tenantId, companyId, branchId, input.itemId, input.locationId]
    );
    if (opened.rowCount === 0) {
      const batch = await client.query<{ id: string }>(
        `INSERT INTO inv.opening_inventory_batches
           (tenant_id, company_id, branch_id, batch_code, as_of_date, counted_by, created_by)
         VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$5) RETURNING id`,
        [tenantId, companyId, branchId, `FX-OPEN-${(seedSeq += 1)}`, USER_A]
      );
      const batchId = batch.rows[0]?.id ?? '';
      await client.query(
        `INSERT INTO inv.opening_inventory_lines
           (tenant_id, company_id, branch_id, batch_id, item_id, location_id, quantity, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8)`,
        [
          tenantId,
          companyId,
          branchId,
          batchId,
          input.itemId,
          input.locationId,
          input.quantity,
          USER_A,
        ]
      );
      // A DIFFERENT actor approves: ck_opening_inventory_batches_maker.
      await client.query(`SELECT set_config('app.user_id',$1,true)`, [INV_APPROVER.userId]);
      await client.query(`SELECT inv.approve_opening_batch($1)`, [batchId]);
    } else {
      const adjustment = await client.query<{ id: string }>(
        `INSERT INTO inv.stock_adjustments
           (tenant_id, company_id, branch_id, item_id, location_id, direction, quantity,
            reason, requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'in',$6::numeric,$7,$8,$8) RETURNING id`,
        [
          tenantId,
          companyId,
          branchId,
          input.itemId,
          input.locationId,
          input.quantity,
          `Fixture top-up ${(seedSeq += 1)}`,
          USER_A,
        ]
      );
      // The same maker-checker split: ck_stock_adjustments_maker.
      await client.query(`SELECT set_config('app.user_id',$1,true)`, [INV_APPROVER.userId]);
      await client.query(`SELECT inv.approve_adjustment($1)`, [adjustment.rows[0]?.id ?? '']);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The approved demand a work-order draw needs (P1-32-PRE-132).
 *
 * Since `20260917099000_inv_material_draw_enforcement.sql` every reservation and
 * issue for a work order draws on an APPROVED material requirement that covers the
 * item, and one with none is refused — by the API with `ERR-INV-001`
 * (`no_requirement`) and by the database whatever the path. A suite that exercises
 * stock rather than material demand still owes that fact, and it is created here the
 * way the product creates it, never by exempting the draw: a service line on the
 * work order, an ENTERED allowance in the item's own stock unit with its source,
 * proposed by `USER_A` and approved by a second person (`INV_APPROVER`) through
 * `inv.approve_material_requirement`. Returns the requirement a draw names in
 * `materialRequirementId`.
 */
export async function seedApprovedMaterialRequirement(input: {
  readonly workOrderId: string;
  readonly itemId: string;
  readonly allowance?: string;
  readonly tenantId?: string;
}): Promise<string> {
  const tenantId = input.tenantId ?? TENANT_A;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const line = await client.query<{ id: string }>(
      `INSERT INTO wo.work_order_service_lines
         (tenant_id, company_id, branch_id, work_order_id, description, created_by)
       SELECT tenant_id, company_id, branch_id, id, 'Parts for the job', $3
         FROM wo.work_orders WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [tenantId, input.workOrderId, USER_A]
    );
    const requirement = await client.query<{ id: string }>(
      `SELECT inv.propose_material_requirement($1, $2, NULL, $3::numeric,
                (SELECT uom_id FROM inv.item_master WHERE tenant_id = $4 AND id = $2),
                'Job card parts list') AS id`,
      [line.rows[0]?.id ?? '', input.itemId, input.allowance ?? '1000', tenantId]
    );
    const requirementId = requirement.rows[0]?.id ?? '';
    await client.query(`SELECT set_config('app.user_id',$1,true)`, [INV_APPROVER.userId]);
    await client.query(`SELECT inv.approve_material_requirement($1)`, [requirementId]);
    await client.query('COMMIT');
    return requirementId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Removes only what this file created, newest dependency first. */
/**
 * Removes the counter sales this slice's suites create, and the returns that cite
 * them, in ONE transaction.
 *
 * One transaction because of `tg_invoice_line_amounts_reconcile`, which is
 * DEFERRABLE INITIALLY DEFERRED: deleting an issued sale's line amounts in its own
 * statement commits a document whose header totals no longer match its (now absent)
 * lines, and the trigger raises at that COMMIT. With the header, the lines and the
 * INVOICE removed together, the trigger finds no invoice at commit time and has
 * nothing to reconcile.
 *
 * Only `counter_sale` invoices are removed: a work-order invoice in this tenant
 * belongs to another suite's fixtures.
 */
async function removeCounterSales(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const sales = `SELECT id FROM sal.invoices WHERE tenant_id IN ($1,$2) AND sale_kind = 'counter_sale'`;
    // The returns go first: they cite the credit note and the invoice line.
    await client.query(`DELETE FROM inv.sales_returns WHERE tenant_id IN ($1,$2)`, [
      TENANT_A,
      TENANT_B,
    ]);
    for (const table of [
      'sal.credit_notes',
      'sal.invoice_status_history',
      'sal.invoice_line_amounts',
      'sal.invoice_lines',
      'sal.invoice_amounts',
    ]) {
      await client.query(
        `DELETE FROM ${table} WHERE tenant_id IN ($1,$2) AND invoice_id IN (${sales})`,
        [TENANT_A, TENANT_B]
      );
    }
    await client.query(
      `DELETE FROM sal.invoices WHERE tenant_id IN ($1,$2) AND sale_kind = 'counter_sale'`,
      [TENANT_A, TENANT_B]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanP1_21Fixtures(): Promise<void> {
  await removeCounterSales();
  for (const statement of [
    // P1-32 preparatory slice 3b: a fulfillment cites a reservation or an issue, a
    // request its requirement, a requirement a specification, a unit and an item.
    `DELETE FROM inv.material_request_fulfillments WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.material_requests WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.material_requirement_exceptions WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.material_requirements WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.vehicle_fluid_specifications WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.item_unit_conversions WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.external_purchase_part_details WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.external_purchase_parts WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.customer_supplied_parts WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.part_returns WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.part_issues WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.damaged_stock WHERE tenant_id IN ($1,$2)`,
    // P1-32 preparatory slice: count lines cite adjustments, receipt lines their
    // receipts, and every one of these cites an item or a location below.
    `DELETE FROM inv.stock_count_lines WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_counts WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.goods_receipt_lines WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.goods_receipts WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.item_cost_layers WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_transfer_settlements WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_transfers WHERE tenant_id IN ($1,$2)`,
    // P1-32 preparatory slice 2: identifiers cite an item and a unit below.
    `DELETE FROM inv.item_identifiers WHERE tenant_id IN ($1,$2)`,
    // Selling prices cite the item, a company, a branch and a tax class.
    `DELETE FROM inv.item_sale_prices WHERE tenant_id IN ($1,$2)`,
    // Owner directive: a reorder level cites the item, a company, a branch and a
    // stock location, and is cited by nothing.
    `DELETE FROM inv.item_reorder_levels WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_movements WHERE tenant_id IN ($1,$2)`,
    // After the movements that cite them: a top-up seed approves an adjustment,
    // and a leftover row would keep the item and location rows below undeletable.
    `DELETE FROM inv.stock_adjustment_details WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_adjustments WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_reservations WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_balances WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.opening_inventory_lines WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.opening_inventory_batches WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.stock_locations WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.item_master WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.item_categories WHERE tenant_id IN ($1,$2)`,
    `DELETE FROM inv.units_of_measure WHERE tenant_id IN ($1,$2)`,
  ]) {
    await admin.query(statement, [TENANT_A, TENANT_B]);
  }

  // The H6 second company, newest dependency first. The grants go before the org rows
  // they reference, and `fk_grant_scopes_grant` is ON DELETE CASCADE — so the scope
  // rows leave with their grant rather than in a separate statement, which would trip
  // the DEFERRABLE "a scoped active grant must carry at least one scope" trigger.
  await admin.query(`DELETE FROM iam.role_grants WHERE id = ANY($1)`, [
    [COMPANY_SCOPED_GRANT, COMPANY_SCOPED_WIDENING_GRANT],
  ]);
  await admin.query(`DELETE FROM org.branches WHERE id = $1`, [BRANCH_A9]);
  await admin.query(`DELETE FROM org.legal_companies WHERE id = $1`, [COMPANY_A9]);
}
