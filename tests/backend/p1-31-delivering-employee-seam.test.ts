/**
 * The P1-31 delivering-employee identity seam (prerequisite **P-17**).
 *
 * ## What was measured, and what this suite has to prove
 *
 * `sal.delivery_records.delivering_employee_id` landed in P1-11 as NOT NULL **with
 * no foreign key**. Any uuid at all was a legal handover officer, so the column
 * recorded a claim rather than an identity, and every fixture in this repository
 * passed either a LOGIN ACCOUNT id or `randomUUID()` — both of which the database
 * accepted without complaint.
 *
 * Closing it needed an employee, and the platform had none. The reuse question was
 * MEASURED rather than argued: `tech.technician_profiles.user_id` and
 * `iam.user_employee_links.user_id` are both NOT NULL foreign keys into
 * `iam.user_accounts`, so neither can represent a person who has no reason to sign
 * in — which is exactly the person a workshop most often sends out to hand a
 * vehicle over. `org.employees` exists for that one property, and the case that
 * creates an employee with no `userAccountId` and then completes a handover with
 * them is the proof that the property is real rather than asserted.
 *
 * ## The three refusals are DISTINCT, and that is the substantive decision
 *
 * `sal.delivery-create` reports `inactive_employee`, `employee_branch_mismatch` and
 * a bare `custom` as three different rules on `body.deliveringEmployeeId`, because
 * an operator's correction differs in each case: reinstate, choose someone from
 * this branch, or check the id. `custom` is reserved for "not visible", because
 * naming a more specific rule there would confirm that an id exists somewhere the
 * caller cannot see.
 *
 * The trigger underneath is the authority and this suite treats it that way. The
 * application's three refusals are a translation of `sal.stamp_delivering_employee_identity`
 * for a caller, not a second rule, and the database's own refusals — a foreign key
 * against a random uuid, a direct INSERT naming a retired employee — are pinned in
 * `tests/db/org-employees.test.ts` against the primitive rather than here.
 *
 * ## The permission split is proved, not asserted
 *
 * `org.employee.read` and `org.employee.manage` are both MINTED by this slice. A
 * principal holding only the manage code is REFUSED the list, and a principal
 * holding only the read code is refused the create, so collapsing the two into one
 * code goes red here rather than passing silently.
 *
 * COVERAGE-EVIDENCE (P1-31 delivering employee identity seam):
 *   org.employee-list: route service authorization success denial isolation
 *   org.employee-detail: route service authorization success denial cross-tenant isolation
 *   org.employee-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   org.employee-status-set: route service authorization success denial cross-tenant isolation audit stale-version
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
import { BRANCH_B1, COMPANY_B1, establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  SAL_FULL,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedWorkOrderChain,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  EMPLOYEE_CREATE_OPERATION,
  EMPLOYEE_LIST_OPERATION,
  GET as LIST_EMPLOYEES,
  POST as CREATE_EMPLOYEE,
} from '@/app/api/v1/org/employees/route';
import {
  EMPLOYEE_DETAIL_OPERATION,
  GET as READ_EMPLOYEE,
} from '@/app/api/v1/org/employees/[employeeId]/route';
import {
  EMPLOYEE_STATUS_SET_OPERATION,
  POST as SET_EMPLOYEE_STATUS,
} from '@/app/api/v1/org/employees/[employeeId]/status/route';
import {
  DELIVERY_LIST_OPERATION,
  GET as LIST_DELIVERIES,
  POST as CREATE_DELIVERY,
} from '@/app/api/v1/deliveries/route';
import { GET as READ_DELIVERY } from '@/app/api/v1/deliveries/[deliveryId]/route';

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// The four operation ids, written out as literals so the coverage gate can see
// this file INVOKE each one: for an `org.` id the gate strips every comment
// before it looks, so naming them in a header proves nothing.
// ---------------------------------------------------------------------------

const SEAM_OPERATION_IDS = Object.freeze({
  list: 'org.employee-list',
  detail: 'org.employee-detail',
  create: 'org.employee-create',
  status: 'org.employee-status-set',
} as const);

const EMPLOYEE_READ_CODE = 'org.employee.read';
const EMPLOYEE_MANAGE_CODE = 'org.employee.manage';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface EmployeeBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly displayName: string;
  readonly userAccountId: string | null;
  readonly employmentRef: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

interface EmployeePage {
  readonly items: readonly EmployeeBody[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface DeliveryBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly deliveringEmployeeId: string;
  readonly deliveringEmployeeDisplayName: string;
  readonly status: string;
}

interface DeliveryPage {
  readonly items: readonly DeliveryBody[];
}

interface ProblemBody {
  readonly code: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
  readonly details?: { readonly violations?: readonly { path: string; rule: string }[] };
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

/**
 * The violation list, wherever the problem document carries it.
 *
 * `AppFailure.safeDetails` is rendered under `details` by the shared problem
 * writer and some catalogue entries lift it to the top level. Reading both is not
 * defensive vagueness: the assertion that matters is the RULE NAME, and a helper
 * that guessed one shape would go green on an empty array if the writer moved.
 */
async function violationsOf(
  response: Response
): Promise<readonly { readonly path: string; readonly rule: string }[]> {
  const problem = (await response.json()) as ProblemBody;
  const found = problem.violations ?? problem.details?.violations ?? [];
  expect(found.length).toBeGreaterThan(0);
  return found;
}

// ---------------------------------------------------------------------------
// Route drivers. Every call goes through the real route handler, so the
// permission gate, the deferred scope check, the version guard, the idempotency
// reservation and the validation all run.
// ---------------------------------------------------------------------------

const BASE = 'http://localhost/api/v1/org/employees';

const jsonHeaders = (options: {
  readonly key?: string | null;
  readonly version?: number | null;
}): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null && options.key !== undefined) headers['idempotency-key'] = options.key;
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return headers;
};

const listEmployees = (query: {
  readonly companyId?: string;
  readonly branchId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly cursor?: string;
}): Promise<Response> => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return LIST_EMPLOYEES(new Request(`${BASE}?${parts.join('&')}`));
};

const readEmployee = (employeeId: string): Promise<Response> =>
  READ_EMPLOYEE(new Request(`${BASE}/${employeeId}`), {
    params: Promise.resolve({ employeeId }),
  });

const createEmployee = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_EMPLOYEE(
    new Request(BASE, { method: 'POST', headers: jsonHeaders({ key }), body: JSON.stringify(body) })
  );

const setEmployeeStatus = (
  employeeId: string,
  status: string,
  version: number | null
): Promise<Response> =>
  SET_EMPLOYEE_STATUS(
    new Request(`${BASE}/${employeeId}/status`, {
      method: 'POST',
      headers: jsonHeaders({ version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ employeeId }) }
  );

const createDelivery = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_DELIVERY(
    new Request('http://localhost/api/v1/deliveries', {
      method: 'POST',
      headers: jsonHeaders({ key }),
      body: JSON.stringify(body),
    })
  );

const readDelivery = (deliveryId: string): Promise<Response> =>
  READ_DELIVERY(new Request(`http://localhost/api/v1/deliveries/${deliveryId}`), {
    params: Promise.resolve({ deliveryId }),
  });

const listDeliveries = (companyId: string, branchId: string): Promise<Response> =>
  LIST_DELIVERIES(
    new Request(`http://localhost/api/v1/deliveries?companyId=${companyId}&branchId=${branchId}`)
  );

// ---------------------------------------------------------------------------
// Fixture authoring — through the routes, never by admin SQL
// ---------------------------------------------------------------------------

/** A reference no other suite uses, and one matching no suite's tenant-prefix cleanup. */
let refSequence = 0;
const nextRef = (): string => {
  refSequence += 1;
  return `fx_p131_p17_${String(refSequence)}`;
};

/** Creates an employee as `EMP_FULL` and returns what the response actually carried. */
async function authorEmployee(
  input: {
    readonly companyId?: string;
    readonly branchId?: string;
    readonly displayName?: string;
    readonly userAccountId?: string;
    readonly employmentRef?: string | null;
  } = {}
): Promise<EmployeeBody> {
  authAs(EMP_FULL);
  const employmentRef =
    input.employmentRef === null ? undefined : (input.employmentRef ?? nextRef());
  const response = await createEmployee({
    companyId: input.companyId ?? COMPANY_A1,
    branchId: input.branchId ?? BRANCH_A1,
    displayName: input.displayName ?? 'Handover officer',
    ...(input.userAccountId === undefined ? {} : { userAccountId: input.userAccountId }),
    ...(employmentRef === undefined ? {} : { employmentRef }),
  });
  if (response.status !== 201) {
    throw new Error(`fixture employee failed with ${response.status}: ${await response.text()}`);
  }
  return bodyOf<EmployeeBody>(response);
}

/** Retires an employee through the published command, and returns the new version. */
async function retire(employee: EmployeeBody): Promise<number> {
  authAs(EMP_FULL);
  const response = await setEmployeeStatus(employee.id, 'inactive', employee.recordVersion);
  if (response.status !== 200) {
    throw new Error(`fixture retirement failed with ${response.status}: ${await response.text()}`);
  }
  return (await bodyOf<EmployeeBody>(response)).recordVersion;
}

const auditCount = async (action: string, entityId: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
  return Number(result.rows[0]?.n ?? '0');
};

const employeeRow = async (
  employeeId: string
): Promise<{ status: string; record_version: number } | undefined> => {
  const result = await admin.query<{ status: string; record_version: number }>(
    `SELECT status, record_version FROM org.employees WHERE id = $1`,
    [employeeId]
  );
  return result.rows[0];
};

const employeeCount = async (tenantId: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM org.employees WHERE tenant_id = $1`,
    [tenantId]
  );
  return Number(result.rows[0]?.n ?? '0');
};

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

/** Tenant A, unrestricted, both minted codes. */
const EMP_FULL: Principal = {
  roleId: 'f1310000-0000-4000-8000-00000017a001',
  userId: 'f1310000-0000-4000-8000-00000017a002',
  subject: 'fx_p1_31_p17_full',
  tenantId: TENANT_A,
  permissions: [EMPLOYEE_READ_CODE, EMPLOYEE_MANAGE_CODE],
};

/** Read only. Its refusal of a write is about authority, not tenancy or scope. */
const EMP_READER: Principal = {
  roleId: 'f1310000-0000-4000-8000-00000017b001',
  userId: 'f1310000-0000-4000-8000-00000017b002',
  subject: 'fx_p1_31_p17_reader',
  tenantId: TENANT_A,
  permissions: [EMPLOYEE_READ_CODE],
};

/**
 * Manage WITHOUT read. The whole point of the read-authorization case: its
 * refusal is the MISSING PERMISSION and nothing else. It can author an employee
 * and cannot list one back, which without this principal would be
 * indistinguishable from a scope or a tenancy refusal.
 */
const EMP_MANAGER_NO_READ: Principal = {
  roleId: 'f1310000-0000-4000-8000-00000017c001',
  userId: 'f1310000-0000-4000-8000-00000017c002',
  subject: 'fx_p1_31_p17_manager_no_read',
  tenantId: TENANT_A,
  permissions: [EMPLOYEE_MANAGE_CODE],
};

/** Both codes, but only inside `COMPANY_A1` / `BRANCH_A1`. */
const EMP_BRANCH_A1: Principal = {
  roleId: 'f1310000-0000-4000-8000-00000017d001',
  userId: 'f1310000-0000-4000-8000-00000017d002',
  subject: 'fx_p1_31_p17_branch_a1',
  tenantId: TENANT_A,
  permissions: [EMPLOYEE_READ_CODE, EMPLOYEE_MANAGE_CODE],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A1 },
  grantId: 'f1310000-0000-4000-8000-00000017d0f1',
};

/** Tenant B, unrestricted. A refusal from it is the tenant boundary, not authority. */
const EMP_TENANT_B: Principal = {
  roleId: 'f1310000-0000-4000-8000-00000017e001',
  userId: 'f1310000-0000-4000-8000-00000017e002',
  subject: 'fx_p1_31_p17_tenant_b',
  tenantId: TENANT_B,
  permissions: [EMPLOYEE_READ_CODE, EMPLOYEE_MANAGE_CODE],
};

const LOCAL_PRINCIPALS: readonly Principal[] = [
  EMP_FULL,
  EMP_READER,
  EMP_MANAGER_NO_READ,
  EMP_BRANCH_A1,
  EMP_TENANT_B,
];

async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 P-17 principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 P-17 fixture',$4) ON CONFLICT (id) DO NOTHING`,
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
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [principal.tenantId, principal.userId, principal.roleId]
  );
  if (existing.rowCount !== 0) return;
  if (principal.scope === undefined) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    return;
  }
  // `tg_role_grants_require_scope` is DEFERRABLE, so a scoped grant and its scope
  // row have to land in ONE transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** The employee every branch-scoped case reads. Created once, never retired. */
let MAIN: EmployeeBody;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);

  // The two codes this slice mints, idempotently. `04_iam_permission_catalog.sql`
  // ships both; this insert exists so a database missing the seed still resolves
  // what the routes declare, and `ON CONFLICT DO NOTHING` means a seeded database
  // sees no drift.
  for (const code of [EMPLOYEE_READ_CODE, EMPLOYEE_MANAGE_CODE]) {
    await admin.query(
      `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
       VALUES ($1,'org',$2,'medium',$3) ON CONFLICT (permission_code) DO NOTHING`,
      [code, `P1-31 P-17 ${code}`, USER_A]
    );
  }
  for (const principal of LOCAL_PRINCIPALS) await seedLocalPrincipal(principal);

  MAIN = await authorEmployee({ displayName: 'Handover officer' });
  __resetAuthenticatorForTests();
}, 240_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await admin
      .query(`DELETE FROM org.employees WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]])
      .catch(() => undefined);
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ===========================================================================
describe('the four registrations', () => {
  it('P17-R1 declares the two MINTED codes, split read from manage', () => {
    expect(EMPLOYEE_LIST_OPERATION.id).toBe(SEAM_OPERATION_IDS.list);
    expect(EMPLOYEE_DETAIL_OPERATION.id).toBe(SEAM_OPERATION_IDS.detail);
    expect(EMPLOYEE_CREATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.create);
    expect(EMPLOYEE_STATUS_SET_OPERATION.id).toBe(SEAM_OPERATION_IDS.status);

    for (const read of [EMPLOYEE_LIST_OPERATION, EMPLOYEE_DETAIL_OPERATION]) {
      expect(read.permissions).toEqual([EMPLOYEE_READ_CODE]);
      expect(read.method).toBe('GET');
      expect(read.auditClass).toBe('none');
      expect(read.scope).toBe('branch');
    }
    for (const write of [EMPLOYEE_CREATE_OPERATION, EMPLOYEE_STATUS_SET_OPERATION]) {
      expect(write.permissions).toEqual([EMPLOYEE_MANAGE_CODE]);
      expect(write.method).toBe('POST');
      expect(write.auditClass).toBe('privileged');
      expect(write.scope).toBe('branch');
    }

    // The two guards, asserted the way they differ. The create is idempotent and
    // not version-guarded because there is no row to have a version yet; the
    // status command is version-guarded and deliberately NOT idempotent, because
    // a stored replay would hide a conflict raised by a change written since.
    expect(EMPLOYEE_CREATE_OPERATION.successStatus).toBe(201);
    expect(EMPLOYEE_CREATE_OPERATION.idempotent).toBe(true);
    expect(EMPLOYEE_CREATE_OPERATION.versionGuarded ?? false).toBe(false);
    expect(EMPLOYEE_STATUS_SET_OPERATION.versionGuarded).toBe(true);
    expect(EMPLOYEE_STATUS_SET_OPERATION.idempotent ?? false).toBe(false);

    expect(EMPLOYEE_CREATE_OPERATION.auditAction).toBe('org.employee.created');
    expect(EMPLOYEE_STATUS_SET_OPERATION.auditAction).toBe('org.employee.status_changed');
  });
});

// ===========================================================================
describe('org.employee-list and org.employee-detail', () => {
  it('P17-L1 a read-only principal lists the branch register (success)', async () => {
    authAs(EMP_READER);
    const response = await listEmployees({ companyId: COMPANY_A1, branchId: BRANCH_A1 });
    expect(response.status).toBe(200);
    const page = await bodyOf<EmployeePage>(response);
    expect(page.items.map((row) => row.id)).toContain(MAIN.id);
    for (const row of page.items) {
      expect(row.companyId).toBe(COMPANY_A1);
      expect(row.branchId).toBe(BRANCH_A1);
    }
  });

  it('P17-L2 a read-only principal reads one employee, and gets the version as an ETag (success)', async () => {
    authAs(EMP_READER);
    const response = await readEmployee(MAIN.id);
    expect(response.status).toBe(200);
    const employee = await bodyOf<EmployeeBody>(response);
    expect(employee.id).toBe(MAIN.id);
    expect(employee.displayName).toBe('Handover officer');
    expect(response.headers.get('etag')).toContain(String(employee.recordVersion));
  });

  it('P17-L3 refuses the LIST to a principal holding only the manage code (authorization)', async () => {
    authAs(EMP_MANAGER_NO_READ);
    const response = await listEmployees({ companyId: COMPANY_A1, branchId: BRANCH_A1 });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe('ERR-IAM-001');
  });

  it('P17-L4 refuses the CREATE to a principal holding only the read code (denial)', async () => {
    const before = await employeeCount(TENANT_A);
    authAs(EMP_READER);
    const response = await createEmployee({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'Refused officer',
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe('ERR-IAM-001');
    // The refusal wrote nothing. A status code alone would not show that.
    expect(await employeeCount(TENANT_A)).toBe(before);
  });

  it('P17-L5 the list is paged, and the two pages are disjoint (success)', async () => {
    await authorEmployee({ displayName: 'Second officer' });
    await authorEmployee({ displayName: 'Third officer' });

    authAs(EMP_READER);
    const first = await listEmployees({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: 2 });
    expect(first.status).toBe(200);
    const firstPage = await bodyOf<EmployeePage>(first);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).not.toBeNull();

    authAs(EMP_READER);
    const second = await listEmployees({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      limit: 2,
      cursor: firstPage.nextCursor ?? '',
    });
    expect(second.status).toBe(200);
    const secondPage = await bodyOf<EmployeePage>(second);
    const firstIds = new Set(firstPage.items.map((row) => row.id));
    for (const row of secondPage.items) expect(firstIds.has(row.id)).toBe(false);
  });

  it('P17-L6 the status filter is optional, and unfiltered still shows the retired (success)', async () => {
    const retiring = await authorEmployee({ displayName: 'Retiring officer' });
    await retire(retiring);

    authAs(EMP_READER);
    const active = await listEmployees({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      status: 'active',
      limit: 50,
    });
    expect((await bodyOf<EmployeePage>(active)).items.map((row) => row.id)).not.toContain(
      retiring.id
    );

    authAs(EMP_READER);
    const all = await listEmployees({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: 50 });
    expect((await bodyOf<EmployeePage>(all)).items.map((row) => row.id)).toContain(retiring.id);
  });

  it('P17-L7 the other tenant reads a tenant-A employee as NOT FOUND (cross-tenant)', async () => {
    authAs(EMP_TENANT_B);
    const response = await readEmployee(MAIN.id);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');

    // The SAME answer a random uuid gets, which is the point: the two are
    // indistinguishable, so the register is not an existence oracle.
    authAs(EMP_TENANT_B);
    const absent = await readEmployee(randomUUID());
    expect(absent.status).toBe(404);
    expect(await codeOf(absent)).toBe('ERR-RES-001');
  });

  it('P17-L8 a BRANCH_A1-scoped principal cannot read an employee of another branch (isolation)', async () => {
    const elsewhere = await authorEmployee({ companyId: COMPANY_A9, branchId: BRANCH_A9 });
    authAs(EMP_BRANCH_A1);
    const response = await readEmployee(elsewhere.id);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
  });
});

// ===========================================================================
describe('org.employee-create', () => {
  it('P17-C1 creates an active employee and appends exactly one audit record (success, audit)', async () => {
    authAs(EMP_FULL);
    const employmentRef = nextRef();
    const response = await createEmployee({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'Created officer',
      employmentRef,
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<EmployeeBody>(response);
    expect(created.status).toBe('active');
    expect(created.employmentRef).toBe(employmentRef);
    // `status` is absent from the body schema, so an employee cannot be born
    // retired; the response proves the default rather than the schema.
    expect(created.recordVersion).toBe(1);
    expect(await auditCount('org.employee.created', created.id)).toBe(1);
  });

  it('P17-C2 creates an employee with NO user account, which is the reason this table exists (success)', async () => {
    authAs(EMP_FULL);
    const response = await createEmployee({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'Officer without a login',
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<EmployeeBody>(response);
    expect(created.userAccountId).toBeNull();

    // The measurement behind the whole slice: neither existing table could hold
    // this row, because both require an account.
    const links = await admin.query(
      `SELECT a.attnotnull FROM pg_attribute a
        WHERE a.attrelid = 'iam.user_employee_links'::regclass AND a.attname = 'user_id'`
    );
    expect(links.rows[0]).toEqual({ attnotnull: true });
    const profiles = await admin.query(
      `SELECT a.attnotnull FROM pg_attribute a
        WHERE a.attrelid = 'tech.technician_profiles'::regclass AND a.attname = 'user_id'`
    );
    expect(profiles.rows[0]).toEqual({ attnotnull: true });
  });

  it('P17-C3 replays one idempotency key without creating a second employee (idempotency)', async () => {
    const key = randomUUID();
    const payload = {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'Replayed officer',
      employmentRef: nextRef(),
    };

    authAs(EMP_FULL);
    const first = await createEmployee(payload, key);
    expect(first.status).toBe(201);
    const created = await bodyOf<EmployeeBody>(first);

    authAs(EMP_FULL);
    const replay = await createEmployee(payload, key);
    // 200, not 201: the replay is the STORED response being handed back, and the
    // shared idempotency layer answers a replay with 200 whatever the original
    // success status was. The precedent is the checklist-template create, whose
    // suite pins the same 201-then-200 pair.
    expect(replay.status).toBe(200);
    expect((await bodyOf<EmployeeBody>(replay)).id).toBe(created.id);

    const rows = await admin.query(
      `SELECT 1 FROM org.employees WHERE tenant_id = $1 AND employment_ref = $2`,
      [TENANT_A, payload.employmentRef]
    );
    expect(rows.rowCount).toBe(1);
    // One row, and one audit record: a replay that re-appended would double the trail.
    expect(await auditCount('org.employee.created', created.id)).toBe(1);
  });

  it('P17-C4 refuses the same key with a DIFFERENT body (idempotency)', async () => {
    const key = randomUUID();
    authAs(EMP_FULL);
    const first = await createEmployee(
      {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        displayName: 'Key holder',
        employmentRef: nextRef(),
      },
      key
    );
    expect(first.status).toBe(201);

    authAs(EMP_FULL);
    const conflicting = await createEmployee(
      {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        displayName: 'A different person entirely',
        employmentRef: nextRef(),
      },
      key
    );
    expect(await codeOf(conflicting)).toBe('ERR-INT-001');
  });

  it('P17-C5 a BRANCH_A1-scoped principal cannot create in another branch (isolation)', async () => {
    const before = await employeeCount(TENANT_A);
    authAs(EMP_BRANCH_A1);
    const response = await createEmployee({
      companyId: COMPANY_A9,
      branchId: BRANCH_A9,
      displayName: 'Officer in a branch this caller may not reach',
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe('ERR-IAM-001');
    expect(await employeeCount(TENANT_A)).toBe(before);

    // The SAME principal succeeds in its OWN branch, so the refusal above is the
    // scope and not the authority.
    authAs(EMP_BRANCH_A1);
    const allowed = await createEmployee({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'Officer in this caller own branch',
    });
    expect(allowed.status).toBe(201);
  });

  it('P17-C6 refuses a company/branch pair from ANOTHER TENANT as a client error, not a fault (cross-tenant)', async () => {
    authAs(EMP_FULL);
    const response = await createEmployee({
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      displayName: 'Officer in the other tenant',
    });
    // Never a 500. Before the reachability check the composite foreign key would
    // have refused this at the INSERT, which reaches the exception monitor as an
    // incident and tells the caller nothing.
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
    expect(await employeeCount(TENANT_B)).toBe(0);
  });

  it('P17-C7 refuses a duplicate employment reference inside the tenant (denial)', async () => {
    const employmentRef = nextRef();
    authAs(EMP_FULL);
    expect(
      (
        await createEmployee({
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          displayName: 'First holder of the reference',
          employmentRef,
        })
      ).status
    ).toBe(201);

    authAs(EMP_FULL);
    const duplicate = await createEmployee({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'Second holder of the reference',
      employmentRef,
    });
    // A caller conflict rather than a server fault: the 23505 is translated here
    // rather than allowed to abort the transaction and the audit append with it.
    expect(duplicate.status).toBe(409);
    expect(await codeOf(duplicate)).toBe('ERR-RES-002');
  });

  it('P17-C8 refuses a user account that is not visible in this tenant (denial)', async () => {
    authAs(EMP_FULL);
    const response = await createEmployee({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      displayName: 'Officer naming an unknown account',
      userAccountId: randomUUID(),
    });
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
describe('org.employee-status-set', () => {
  it('P17-S1 retires and reinstates, appending one audit record each time (success, audit)', async () => {
    const employee = await authorEmployee({ displayName: 'Officer to retire' });

    authAs(EMP_FULL);
    const retired = await setEmployeeStatus(employee.id, 'inactive', employee.recordVersion);
    expect(retired.status).toBe(200);
    const afterRetire = await bodyOf<EmployeeBody>(retired);
    expect(afterRetire.status).toBe('inactive');
    // The version comes from the DATABASE row rather than from expectedVersion + 1,
    // so the caller's next If-Match is not an assumption about touch_row_metadata.
    expect((await employeeRow(employee.id))?.record_version).toBe(afterRetire.recordVersion);

    authAs(EMP_FULL);
    const reinstated = await setEmployeeStatus(employee.id, 'active', afterRetire.recordVersion);
    expect(reinstated.status).toBe(200);
    expect((await bodyOf<EmployeeBody>(reinstated)).status).toBe('active');
    expect(await auditCount('org.employee.status_changed', employee.id)).toBe(2);
  });

  it('P17-S2 refuses a request with NO If-Match (denial)', async () => {
    const employee = await authorEmployee({ displayName: 'Officer with a guard' });
    authAs(EMP_FULL);
    const response = await setEmployeeStatus(employee.id, 'inactive', null);
    expect(await codeOf(response)).toBe('ERR-CON-002');
    expect((await employeeRow(employee.id))?.status).toBe('active');
  });

  it('P17-S3 refuses a STALE If-Match and burns no version (stale-version)', async () => {
    const employee = await authorEmployee({ displayName: 'Officer with a stale version' });
    const afterFirst = await retire(employee);

    authAs(EMP_FULL);
    const stale = await setEmployeeStatus(employee.id, 'active', employee.recordVersion);
    expect(await codeOf(stale)).toBe('ERR-CON-001');

    const row = await employeeRow(employee.id);
    expect(row?.status).toBe('inactive');
    expect(row?.record_version).toBe(afterFirst);
  });

  it('P17-S4 the other tenant cannot retire a tenant-A employee (cross-tenant)', async () => {
    const employee = await authorEmployee({ displayName: 'Officer of tenant A only' });
    authAs(EMP_TENANT_B);
    const response = await setEmployeeStatus(employee.id, 'inactive', employee.recordVersion);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
    expect((await employeeRow(employee.id))?.status).toBe('active');
  });

  it('P17-S5 a BRANCH_A1-scoped principal cannot retire an employee of another branch (isolation)', async () => {
    const elsewhere = await authorEmployee({ companyId: COMPANY_A9, branchId: BRANCH_A9 });
    authAs(EMP_BRANCH_A1);
    const response = await setEmployeeStatus(elsewhere.id, 'inactive', elsewhere.recordVersion);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
    expect((await employeeRow(elsewhere.id))?.status).toBe('active');
  });

  it('P17-S6 refuses a status the CHECK constraint does not admit (denial)', async () => {
    const employee = await authorEmployee({ displayName: 'Officer with a bad status' });
    authAs(EMP_FULL);
    const response = await setEmployeeStatus(employee.id, 'archived', employee.recordVersion);
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
describe('sal.delivery-create now names a real person', () => {
  it('P17-D1 opens a delivery with an active same-branch employee and stamps the snapshot (success)', async () => {
    const chain = await seedWorkOrderChain('p17_ok');
    const employee = await authorEmployee({
      companyId: chain.companyId,
      branchId: chain.branchId,
      displayName: 'Officer on duty',
    });

    authAs(SAL_FULL);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: employee.id,
    });
    expect(response.status).toBe(201);
    const delivery = await bodyOf<DeliveryBody>(response);
    expect(delivery.deliveringEmployeeId).toBe(employee.id);
    // Server-stamped, never echoed from the request: the create body carries no
    // name at all, so this value can only have come from the trigger.
    expect(delivery.deliveringEmployeeDisplayName).toBe('Officer on duty');

    const stored = await admin.query<{ delivering_employee_display_name: string }>(
      `SELECT delivering_employee_display_name FROM sal.delivery_records WHERE id = $1`,
      [delivery.id]
    );
    expect(stored.rows[0]?.delivering_employee_display_name).toBe('Officer on duty');
  });

  it('P17-D2 the snapshot outlives a retirement, on both published reads (success)', async () => {
    const chain = await seedWorkOrderChain('p17_snapshot');
    const employee = await authorEmployee({
      companyId: chain.companyId,
      branchId: chain.branchId,
      displayName: 'Officer who later leaves',
    });
    authAs(SAL_FULL);
    const created = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: employee.id,
    });
    expect(created.status).toBe(201);
    const delivery = await bodyOf<DeliveryBody>(created);

    await retire(employee);

    authAs(SAL_FULL);
    const read = await readDelivery(delivery.id);
    expect(read.status).toBe(200);
    expect((await bodyOf<DeliveryBody>(read)).deliveringEmployeeDisplayName).toBe(
      'Officer who later leaves'
    );

    authAs(SAL_FULL);
    const listed = await listDeliveries(chain.companyId, chain.branchId);
    expect(listed.status).toBe(200);
    const page = await bodyOf<DeliveryPage>(listed);
    const row = page.items.find((item) => item.id === delivery.id);
    expect(row?.deliveringEmployeeDisplayName).toBe('Officer who later leaves');
  });

  it('P17-D3 refuses a RETIRED employee with rule inactive_employee (denial)', async () => {
    const chain = await seedWorkOrderChain('p17_inactive');
    const employee = await authorEmployee({
      companyId: chain.companyId,
      branchId: chain.branchId,
      displayName: 'Officer already retired',
    });
    await retire(employee);

    authAs(SAL_FULL);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: employee.id,
    });
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
    // Re-read for the violation, because the body has been consumed above.
    authAs(SAL_FULL);
    const again = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: employee.id,
    });
    expect(await violationsOf(again)).toEqual([
      { path: 'body.deliveringEmployeeId', rule: 'inactive_employee' },
    ]);

    const rows = await admin.query(`SELECT 1 FROM sal.delivery_records WHERE work_order_id = $1`, [
      chain.workOrderId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('P17-D4 refuses an employee of ANOTHER BRANCH with rule employee_branch_mismatch (denial)', async () => {
    const chain = await seedWorkOrderChain('p17_branch');
    const elsewhere = await authorEmployee({
      companyId: COMPANY_A9,
      branchId: BRANCH_A9,
      displayName: 'Officer of the other branch',
    });

    authAs(SAL_FULL);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: elsewhere.id,
    });
    expect(response.status).toBe(422);
    expect(await violationsOf(response)).toEqual([
      { path: 'body.deliveringEmployeeId', rule: 'employee_branch_mismatch' },
    ]);
  });

  it('P17-D5 refuses the ACTOR own user id, which every fixture used to pass (denial)', async () => {
    const chain = await seedWorkOrderChain('p17_actor');
    authAs(SAL_FULL);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: SAL_FULL.userId,
    });
    // The regression this whole slice exists to make impossible: a LOGIN ACCOUNT
    // id is not an employee id, and the platform used to store it without a word.
    expect(response.status).toBe(422);
    expect(await violationsOf(response)).toEqual([
      { path: 'body.deliveringEmployeeId', rule: 'custom' },
    ]);
  });

  it('P17-D6 refuses an arbitrary uuid, and an employee of ANOTHER TENANT identically (cross-tenant)', async () => {
    const chain = await seedWorkOrderChain('p17_random');
    authAs(SAL_FULL);
    const random = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: randomUUID(),
    });
    expect(random.status).toBe(422);
    expect(await violationsOf(random)).toEqual([
      { path: 'body.deliveringEmployeeId', rule: 'custom' },
    ]);

    // An employee that DOES exist, in tenant B. The refusal is identical, because
    // the lookup runs under the caller's own RLS and the row is simply not there.
    authAs(EMP_TENANT_B);
    const foreignResponse = await createEmployee({
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      displayName: 'Officer of the other tenant',
    });
    expect(foreignResponse.status).toBe(201);
    const foreign = await bodyOf<EmployeeBody>(foreignResponse);

    authAs(SAL_FULL);
    const crossTenant = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: foreign.id,
    });
    expect(crossTenant.status).toBe(422);
    expect(await violationsOf(crossTenant)).toEqual([
      { path: 'body.deliveringEmployeeId', rule: 'custom' },
    ]);
  });

  it('P17-D7 an employee with NO user account can hand a vehicle over (success)', async () => {
    const chain = await seedWorkOrderChain('p17_no_account');
    const employee = await authorEmployee({
      companyId: chain.companyId,
      branchId: chain.branchId,
      displayName: 'Officer with no login at all',
    });
    expect(employee.userAccountId).toBeNull();

    authAs(SAL_FULL);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: employee.id,
    });
    expect(response.status).toBe(201);
    const delivery = await bodyOf<DeliveryBody>(response);
    expect(delivery.deliveringEmployeeDisplayName).toBe('Officer with no login at all');

    // The actor is still the session principal. The person handing the vehicle
    // over and the person recording it are different people, and the row says so.
    const actor = await admin.query<{ created_by: string }>(
      `SELECT created_by FROM sal.delivery_records WHERE id = $1`,
      [delivery.id]
    );
    expect(actor.rows[0]?.created_by).toBe(SAL_FULL.userId);
    expect(actor.rows[0]?.created_by).not.toBe(delivery.deliveringEmployeeId);
  });

  it('P17-D8 the delivery list read exposes the operation it is gated on', () => {
    expect(DELIVERY_LIST_OPERATION.id).toBe('sal.delivery-list');
    expect(DELIVERY_LIST_OPERATION.permissions).toEqual(['sal.delivery.view']);
  });
});
