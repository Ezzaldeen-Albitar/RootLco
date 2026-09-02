/**
 * P1-29 `W3` — the work-order detail, proved on real responses.
 *
 * The screen makes four load-bearing claims and each one is proved here against
 * a real database through the real route handlers, because a mocked UI test
 * cannot: it would assert that the component renders whatever it was handed.
 *
 *   detail        a seeded work order is fetched through `wo.work-order-detail`
 *                 and the WEB MIRROR is held against the row that came back
 *   job graph     seeded jobs appear in that response, as jobs, with routing
 *   routing       a real persisted `wo.job-update`, re-read, department changed
 *   assignment    a real persisted assignment, re-read, relationship present
 *
 * Access and concurrency are proved the same way — on responses, never on the
 * existence of a route.
 *
 * `p1-19-*` already proves these operations in depth. What is new here is the
 * chain W3 introduces: the mirror the adapter types itself against, and the
 * version the screen sends back. A drifted mirror or a dropped `If-Match` is
 * invisible to every structural gate in the repository and to every one of those
 * tests, which is the gap this file closes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import ts from 'typescript';
import {
  BRANCH_A1,
  COMPANY_A1,
  SUBJECT_UNPERMITTED,
  TENANT_A,
  TENANT_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  READER,
  TECH_A1,
  TENANT_B_FULL,
  authAs,
  authAsSubject,
  SPLIT_WINDOW,
  createOpenWorkOrder,
  createWorkOrder,
  establishP1_19Fixtures,
  establishTechnicianFixtures,
} from './p1-19-helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { FakeIdentityProvider, setIdentityProvider } from '@/modules/iam';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as DETAIL } from '@/app/api/v1/work-orders/[workOrderId]/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { PATCH as UPDATE_JOB } from '@/app/api/v1/jobs/[jobId]/route';
import {
  GET as LIST_ASSIGNMENTS,
  POST as ASSIGN,
} from '@/app/api/v1/jobs/[jobId]/assignments/route';
import { GET as LIST_DEPARTMENTS } from '@/app/api/v1/org/departments/route';

const WEB = join(process.cwd(), 'apps', 'web', 'src');
const FEATURE_CONTRACT = join(WEB, 'features', 'work-orders', 'work-orders-contract.ts');
const PAYLOAD_MIRROR = join(WEB, 'lib', 'contracts', 'work-order-contract.ts');

/**
 * The window the technician fixtures are actually available for.
 *
 * Taken from the fixtures rather than invented: an interval outside their
 * availability is refused with a 422, which would look like a broken assignment
 * path when it is a correct refusal of an unavailable technician.
 */
const WINDOW = SPLIT_WINDOW;

/**
 * A principal seeded by THIS file, holding `org.department.read`.
 *
 * The `p1-19` fixtures predate Wave C, so none of them carries the code the
 * department picker needs — and adding it to a shared principal would change
 * what every other `p1-19` test is authorised to do. This one is local, has its
 * own ids, and is removed in `afterAll`.
 */
const DEPT_READER = {
  roleId: '29300000-0000-4000-8000-0000000000a1',
  userId: '29300000-0000-4000-8000-0000000000a2',
  subject: 'fx_p1_29_w3_department_reader',
  codes: ['wo.work_order.read', 'org.department.read'] as const,
} as const;

let admin: Pool;
let runtime: Pool;

const detail = (workOrderId: string): Promise<Response> =>
  DETAIL(new Request(`http://localhost/api/v1/work-orders/${workOrderId}`), {
    params: Promise.resolve({ workOrderId }),
  });

const createJob = (workOrderId: string, title: string): Promise<Response> =>
  CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ title }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );

const patchJob = (jobId: string, body: unknown, version: number | null): Promise<Response> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (version !== null) headers['if-match'] = String(version);
  return UPDATE_JOB(
    new Request(`http://localhost/api/v1/jobs/${jobId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );
};

const assign = (jobId: string, body: unknown): Promise<Response> =>
  ASSIGN(
    new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );

const assignments = (jobId: string): Promise<Response> =>
  LIST_ASSIGNMENTS(new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`), {
    params: Promise.resolve({ jobId }),
  });

interface DetailBody {
  readonly workOrder: Record<string, unknown> & {
    readonly id: string;
    readonly recordVersion: number;
  };
  readonly jobs: readonly (Record<string, unknown> & {
    readonly id: string;
    readonly title: string;
    readonly departmentId: string | null;
    readonly recordVersion: number;
  })[];
  readonly nextStates: readonly Record<string, unknown>[];
}

const body = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/**
 * The property names of one interface in a web contract, PARSED.
 *
 * A regular expression would answer for a name inside a comment or a
 * neighbouring interface. This walks the real syntax tree, which is the rule
 * this repository applies to its gate scanners and applies here for the same
 * reason.
 */
function mirrorFields(file: string, interfaceName: string): readonly string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          found.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found.length === 0) throw new Error(`no interface ${interfaceName} in ${file}`);
  return found;
}

/** A department of one branch, seeded directly — it is test scaffolding, not product data. */
async function seedDepartment(
  scope: { readonly companyId: string; readonly branchId: string; readonly tenantId?: string },
  code: string
): Promise<string> {
  const row = await admin.query<{ id: string }>(
    `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      scope.tenantId ?? TENANT_A,
      scope.companyId,
      scope.branchId,
      code,
      'W3 fixture department',
      FULL.userId,
    ]
  );
  return row.rows[0]!.id;
}

/** An open work order carrying one job, through the real routes. */
async function seedWorkOrderWithJob(title = 'Replace front pads'): Promise<{
  readonly workOrderId: string;
  readonly jobId: string;
  readonly jobVersion: number;
}> {
  const order = await createOpenWorkOrder();
  authAs(FULL);
  const created = await createJob(order.workOrderId, title);
  if (created.status !== 201) throw new Error(`fixture job failed with ${created.status}`);
  const job = await body<{ id: string; recordVersion: number }>(created);
  return { workOrderId: order.workOrderId, jobId: job.id, jobVersion: job.recordVersion };
}

/** Seeds `DEPT_READER` — an unrestricted grant carrying exactly its two codes. */
async function seedDepartmentReader(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','W3 department reader','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [DEPT_READER.userId, TENANT_A, 'test_harness', DEPT_READER.subject, FULL.userId]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'W3 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [DEPT_READER.roleId, TENANT_A, DEPT_READER.subject, FULL.userId]
  );
  for (const code of DEPT_READER.codes) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [TENANT_A, DEPT_READER.roleId, FULL.userId, code]
    );
  }
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_A, DEPT_READER.userId, DEPT_READER.roleId, FULL.userId]
  );
}

beforeAll(async () => {
  /*
   * `org.department-list` lives in the `iam` module, and composing that module
   * reads Supabase credentials — which a backend test process has no reason to
   * carry, so the route answered 500 `ERR-SYS-001` with an
   * `EnvironmentValidationError` instead of a department list. Setting the
   * client environment does NOT fix it: the configuration is read from a
   * snapshot taken before this hook runs.
   *
   * The seam the platform documents is the provider itself (ADR-019):
   * `installIamRuntime()` reads those credentials only when no identity provider
   * is present, so installing a fake one FIRST lets this whole route surface run
   * with no credentials at all. It is the same thing Wave C's own suite does,
   * and it must happen before the composition root is touched.
   */
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  __resetBackendConfigForTests();
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'p1-29-w3-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishTechnicianFixtures();
  await seedDepartmentReader();
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    // This file's own principal, removed by this file. Grants first: the role
    // and the account are what it hangs off.
    await admin.query('DELETE FROM iam.role_grants WHERE user_id = $1', [DEPT_READER.userId]);
    await admin.query('DELETE FROM iam.role_permissions WHERE role_id = $1', [DEPT_READER.roleId]);
    await admin.query('DELETE FROM iam.roles WHERE id = $1', [DEPT_READER.roleId]);
    await admin.query('DELETE FROM iam.user_accounts WHERE id = $1', [DEPT_READER.userId]);
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('P1-29 W3 — the detail answers a real actor with the real record', () => {
  it('W3-1 a permitted actor reads the work order, and the web mirror is its shape', async () => {
    const seeded = await seedWorkOrderWithJob();

    authAs(READER);
    const response = await detail(seeded.workOrderId);
    expect(response.status).toBe(200);

    const payload = await body<DetailBody>(response);
    expect(payload.workOrder.id).toBe(seeded.workOrderId);

    // The three shapes the screen types itself against, each held against the
    // response that really came back. A mirror can name a field the response
    // lacks or miss one it carries, and every gate in this repository would
    // still be green — `check-p1-29-payload-parity` covers REQUESTS only and
    // says so in its own output.
    expect(Object.keys(payload).sort()).toEqual(
      [...mirrorFields(FEATURE_CONTRACT, 'WorkOrderDetail')].sort()
    );
    expect(Object.keys(payload.workOrder).sort()).toEqual(
      [...mirrorFields(FEATURE_CONTRACT, 'WorkOrderListEntry')].sort()
    );

    const first = payload.jobs[0];
    expect(first, 'the fixture seeded no job').toBeDefined();
    expect(Object.keys(first as object).sort()).toEqual(
      [...mirrorFields(FEATURE_CONTRACT, 'WorkOrderJob')].sort()
    );

    // The ETag is what lets the screen drive a guarded write without a second
    // read, so its absence would be a silent capability loss.
    expect(response.headers.get('etag')).toBe(`"${payload.workOrder.recordVersion}"`);
  });

  it('W3-2 the job graph is the real one, and reachable states come from the backend', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const one = await body<{ id: string }>(await createJob(order.workOrderId, 'Bleed brakes'));
    const two = await body<{ id: string }>(await createJob(order.workOrderId, 'Road test'));

    authAs(READER);
    const payload = await body<DetailBody>(await detail(order.workOrderId));

    // ANTI-VACUITY: an empty graph would satisfy a "renders jobs" assertion
    // while proving nothing, so the seeded ids are named.
    expect(payload.jobs.length).toBeGreaterThanOrEqual(2);
    const ids = payload.jobs.map((job) => job.id);
    expect(ids).toContain(one.id);
    expect(ids).toContain(two.id);
    expect(payload.jobs.map((job) => job.title)).toContain('Road test');

    // The lifecycle the screen offers is DATA. If this ever came back empty for
    // an open work order the screen would correctly offer nothing, so the
    // graph's presence is asserted rather than assumed.
    expect(payload.nextStates.length).toBeGreaterThan(0);
    for (const state of payload.nextStates) {
      expect(Object.keys(state).sort()).toEqual(
        [...mirrorFields(FEATURE_CONTRACT, 'WorkOrderReachableState')].sort()
      );
    }
  });

  it('W3-3 department routing PERSISTS, and the re-read proves it changed', async () => {
    const seeded = await seedWorkOrderWithJob();
    const department = await seedDepartment(
      { companyId: COMPANY_A1, branchId: BRANCH_A1 },
      `w3_route_${Date.now().toString(36)}`
    );

    // Unrouted to begin with — asserted, so "it changed" is a real change.
    authAs(READER);
    const before = await body<DetailBody>(await detail(seeded.workOrderId));
    expect(before.jobs.find((job) => job.id === seeded.jobId)?.departmentId).toBeNull();

    // Exactly the body the adapter sends: the title back unchanged (the PATCH
    // replaces it) plus the routing, guarded by the version the screen holds.
    authAs(FULL);
    const routed = await patchJob(
      seeded.jobId,
      { title: 'Replace front pads', departmentId: department },
      seeded.jobVersion
    );
    expect(routed.status).toBe(200);

    authAs(READER);
    const after = await body<DetailBody>(await detail(seeded.workOrderId));
    const job = after.jobs.find((each) => each.id === seeded.jobId);
    expect(job?.departmentId, 'the routing did not persist').toBe(department);

    // And CLEARING is a different instruction from leaving it alone: `null`
    // unroutes, `undefined` would not. The screen sends `null` for an empty
    // choice, so the difference has to be real at the backend too.
    authAs(FULL);
    const cleared = await patchJob(
      seeded.jobId,
      { title: 'Replace front pads', departmentId: null },
      job!.recordVersion
    );
    expect(cleared.status).toBe(200);

    authAs(READER);
    const unrouted = await body<DetailBody>(await detail(seeded.workOrderId));
    expect(unrouted.jobs.find((each) => each.id === seeded.jobId)?.departmentId).toBeNull();
  });

  it('W3-4 the department picker reads the branch’s own departments, and a foreign one is refused', async () => {
    const seeded = await seedWorkOrderWithJob();
    const mine = await seedDepartment(
      { companyId: COMPANY_A1, branchId: BRANCH_A1 },
      `w3_mine_${Date.now().toString(36)}`
    );
    const theirs = await seedDepartment(
      { companyId: COMPANY_B1, branchId: BRANCH_B1, tenantId: TENANT_B },
      `w3_theirs_${Date.now().toString(36)}`
    );

    // The list the picker renders, through the operation the screen calls, as
    // an actor that actually holds `org.department.read`.
    authAsSubject(DEPT_READER.subject);
    const url = new URL('http://localhost/api/v1/org/departments');
    url.searchParams.set('companyId', COMPANY_A1);
    url.searchParams.set('branchId', BRANCH_A1);
    const listed = await LIST_DEPARTMENTS(new Request(url));
    expect(listed.status).toBe(200);
    const departments = await body<{ items: readonly { id: string }[] }>(listed);
    expect(departments.items.map((each) => each.id)).toContain(mine);
    expect(departments.items.map((each) => each.id)).not.toContain(theirs);

    // The BACKEND is the authority, not the picker: a department from another
    // tenant is refused at the write even though nothing stopped a caller
    // naming it.
    authAs(FULL);
    const refused = await patchJob(
      seeded.jobId,
      { title: 'Replace front pads', departmentId: theirs },
      seeded.jobVersion
    );
    expect(refused.status).toBe(422);
    expect((await body<{ code: string }>(refused)).code).toBe('ERR-VAL-001');
  });

  it('W3-5 technician assignment PERSISTS, and the re-read proves the relationship', async () => {
    const seeded = await seedWorkOrderWithJob();

    authAs(FULL);
    const created = await assign(seeded.jobId, {
      technicianProfileId: TECH_A1,
      assignmentRole: 'primary',
      window: WINDOW,
    });
    expect(created.status).toBe(201);

    const listed = await assignments(seeded.jobId);
    expect(listed.status).toBe(200);
    const payload = await body<{ items: readonly Record<string, unknown>[] }>(listed);

    expect(payload.items.length).toBeGreaterThan(0);
    const open = payload.items.find((item) => item['technicianProfileId'] === TECH_A1);
    expect(open, 'the assignment did not persist').toBeDefined();
    // `validTo === null` is what the panel renders as "still assigned".
    expect(open?.['validTo']).toBeNull();

    expect(Object.keys(open as object).sort()).toEqual(
      [...mirrorFields(FEATURE_CONTRACT, 'JobAssignment')].sort()
    );
  });

  it('W3-6 a stale version is REFUSED and a fresh one succeeds', async () => {
    const seeded = await seedWorkOrderWithJob();
    const department = await seedDepartment(
      { companyId: COMPANY_A1, branchId: BRANCH_A1 },
      `w3_stale_${Date.now().toString(36)}`
    );

    authAs(FULL);
    // The first write moves the version. A screen that did not re-read now holds
    // a stale one — exactly the state this guard exists for.
    const first = await patchJob(
      seeded.jobId,
      { title: 'Replace front pads', departmentId: department },
      seeded.jobVersion
    );
    expect(first.status).toBe(200);

    const stale = await patchJob(
      seeded.jobId,
      { title: 'Renamed by somebody else', departmentId: null },
      seeded.jobVersion
    );
    expect(stale.status, 'a stale write was accepted').toBe(409);

    // And the refusal LEFT THE RECORD ALONE. A conflict that half-applied would
    // be worse than one that overwrote.
    authAs(READER);
    const after = await body<DetailBody>(await detail(seeded.workOrderId));
    const job = after.jobs.find((each) => each.id === seeded.jobId);
    expect(job?.departmentId).toBe(department);
    expect(job?.title).toBe('Replace front pads');

    // Missing entirely is a different refusal from stale, and the screen must
    // never produce it: the adapter takes `ifMatch` as a required parameter.
    authAs(FULL);
    const unguarded = await patchJob(seeded.jobId, { title: 'No version' }, null);
    expect([428, 400]).toContain(unguarded.status);
  });

  it('W3-7 access: refused without the code, invisible across a tenant, read is not write', async () => {
    const seeded = await seedWorkOrderWithJob();

    // 1. no permission at all
    authAsSubject(SUBJECT_UNPERMITTED);
    const denied = await detail(seeded.workOrderId);
    expect(denied.status).toBe(403);
    expect(denied.status).not.toBe(200);

    // 2. another tenant's actor learns nothing about this work order
    authAs(TENANT_B_FULL);
    const foreign = await detail(seeded.workOrderId);
    expect(foreign.status).not.toBe(200);

    // 3. and this tenant learns nothing about theirs
    const theirs = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    authAs(READER);
    expect((await detail(theirs.workOrderId)).status).not.toBe(200);

    // 4. READ IS NOT WRITE. `READER` holds `wo.work_order.read` and reads the
    //    record; the same actor may not route its job. This is the assertion
    //    that stops a screen's affordance being mistaken for an authority.
    const readable = await detail(seeded.workOrderId);
    expect(readable.status).toBe(200);
    const refused = await patchJob(
      seeded.jobId,
      { title: 'Replace front pads', departmentId: null },
      seeded.jobVersion
    );
    expect(refused.status).toBe(403);

    // 5. nor assign a technician
    const cannotAssign = await assign(seeded.jobId, {
      technicianProfileId: TECH_A1,
      window: WINDOW,
    });
    expect(cannotAssign.status).toBe(403);
  });

  it('W3-8 the payload mirror carries departmentId, which the routing write depends on', async () => {
    // BR-02 added the field to the API and could not add it to the mirror; the
    // gap was carried as the `wo.job-update.departmentId` PENDING disposition.
    // W3 is the caller, so the field must be present — and this asserts the
    // mirror rather than the disposition table, because a disposition can be
    // re-added while the field stays missing.
    expect(mirrorFields(PAYLOAD_MIRROR, 'JobUpdateBody')).toContain('departmentId');
  });
});
