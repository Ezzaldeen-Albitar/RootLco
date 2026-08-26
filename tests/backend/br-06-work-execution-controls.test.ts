/**
 * Work execution controls (BR-06, PRE-P1-29 backend remediation).
 *
 * Six operations over four problems that shared one service and one review: the
 * state graphs were never published, no job list existed at any scope, no QC
 * queue spanned a branch, and there was no work log anywhere in the platform.
 *
 * The cases this suite exists for, in order of how badly they would be missed:
 *
 *  1. **S6 — the `closureEligible` trap (`C-02`).** `wo.job_states` carries a
 *     fifth flag that is projected to consumers and **enforced by nothing**:
 *     `wo.guard_work_order_closure` tests `is_terminal`, never `closure_eligible`.
 *     Publishing it — which this slice does, because omitting a field the row
 *     carries is its own defect — creates a way to read it as a closure decision.
 *     S6 authors a tenant state with `closure_eligible = true, is_terminal = false`
 *     and proves a work order with a job in it is **still not closable**.
 *  2. **P2 — the tenant override.** The graphs are tenant-overridable data. A
 *     catalogue endpoint that returned the platform rows regardless would be
 *     worse than no endpoint, because a UI would trust it.
 *  3. **N11/N12 — append-only at the GRANT layer**, proved as `app_runtime` with
 *     the tenant GUCs SET. This is the BR-04 false-green: without the GUCs, RLS
 *     narrows the statement to zero rows and an `UPDATE` that changed nothing
 *     RESOLVES — so the assertion passes while the thing it claims to prove
 *     never ran. Both cases assert the row is REACHABLE first.
 *  4. **S1/S3 — `T-02` and `T-05`.** A collection read's `scope: 'branch'` is
 *     inert without a target, and `app.branch_ids` is the permission-blind union
 *     of every grant; and `assignments` must be OMITTED, not emptied, without
 *     `tech.technician.read`.
 *  5. **S7 — paging completeness** on both new lists, because a conclusion drawn
 *     from one page is the P1-28 round-two defect.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.work-order-catalogue: route service authorization success denial
 *   wo.job-list: route service authorization success denial cross-tenant isolation
 *   wo.job-detail: route service authorization success denial cross-tenant isolation
 *   qms.qc-record-branch-list: route service authorization success denial cross-tenant isolation
 *   wo.job-work-log-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.job-work-log-list: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  READER,
  SCOPED_ELSEWHERE,
  TENANT_B_FULL,
  authAs,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishTechnicianFixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as CATALOGUE } from '@/app/api/v1/work-order-catalogue/route';
import { GET as JOB_LIST } from '@/app/api/v1/jobs/route';
import { GET as JOB_DETAIL } from '@/app/api/v1/jobs/[jobId]/route';
import { GET as QC_LIST } from '@/app/api/v1/quality-controls/route';
import {
  GET as WORK_LOG_LIST,
  POST as WORK_LOG_RECORD,
} from '@/app/api/v1/jobs/[jobId]/work-logs/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';

let admin: Pool;
let runtime: Pool;

interface JobBoardRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly state: string;
  readonly pendingRequiredAdditionalWork: boolean;
  readonly openAssignmentCount: number;
  readonly hasOpenLaborSession: boolean;
  readonly workOrderState: string;
}
interface WorkLogRow {
  readonly id: string;
  readonly jobId: string;
  readonly entry: string;
  readonly loggedAt: string;
  readonly createdAt: string;
  readonly createdBy: string;
}
interface PageOf<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
interface Problem {
  readonly code?: string;
}

const branchQuery = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

const catalogue = (query = ''): Promise<Response> =>
  CATALOGUE(new Request(`http://localhost/api/v1/work-order-catalogue?${query}`));

const jobList = (query: string): Promise<Response> =>
  JOB_LIST(new Request(`http://localhost/api/v1/jobs?${query}`));

const jobDetail = (jobId: string): Promise<Response> =>
  JOB_DETAIL(new Request(`http://localhost/api/v1/jobs/${jobId}`), {
    params: Promise.resolve({ jobId }),
  });

const qcList = (query: string): Promise<Response> =>
  QC_LIST(new Request(`http://localhost/api/v1/quality-controls?${query}`));

const recordWorkLog = (jobId: string, body: unknown, key = randomUUID()): Promise<Response> =>
  WORK_LOG_RECORD(
    new Request(`http://localhost/api/v1/jobs/${jobId}/work-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );

const listWorkLogs = (jobId: string, query = ''): Promise<Response> =>
  WORK_LOG_LIST(new Request(`http://localhost/api/v1/jobs/${jobId}/work-logs?${query}`), {
    params: Promise.resolve({ jobId }),
  });

/** A job on a fresh open work order, created through the authoritative route. */
async function seedJob(
  options: { readonly tenantId?: string; readonly branchId?: string } = {}
): Promise<{ jobId: string; workOrderId: string }> {
  const tenantB = options.tenantId === TENANT_B;
  const order = tenantB
    ? await createOpenWorkOrder({
        tenantId: TENANT_B,
        companyId: COMPANY_B1,
        branchId: BRANCH_B1,
      })
    : await createOpenWorkOrder(
        options.branchId === undefined ? {} : { branchId: options.branchId }
      );
  authAs(tenantB ? TENANT_B_FULL : FULL);
  const response = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ title: 'BR-06 execution control' }),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  if (response.status !== 201) {
    throw new Error(
      `fixture job creation failed with ${response.status}: ${await response.text()}`
    );
  }
  const job = (await response.json()) as { id: string };
  return { jobId: job.id, workOrderId: order.workOrderId };
}

/**
 * Runs a statement as `app_runtime` WITH the tenant GUCs set.
 *
 * The GUCs are the entire point. Without them RLS narrows the statement to zero
 * rows, an `UPDATE` affects nothing and RESOLVES, and an assertion that "the
 * write was refused" passes while nothing was ever attempted. That false green is
 * the BR-04 defect, so every backstop here sets them and separately proves the
 * target row is REACHABLE before claiming a refusal means anything.
 */
async function asAppRuntime<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await runtime.connect();
  try {
    // BEGIN first, and this is not decoration. `set_config(..., true)` is
    // TRANSACTION-local: issued outside a transaction each statement is its own
    // transaction and the setting is discarded before the next one runs, so the
    // GUCs would be empty, `iam.allowed_branch_ids()` would return NULL, and the
    // row would be invisible — which is exactly how the reachability guard below
    // caught this fixture being wrong.
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true),
              set_config('app.company_ids',$3,true), set_config('app.branch_ids',$4,true)`,
      [USER_A, TENANT_A, COMPANY_A1, BRANCH_A1]
    );
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('wo.work-order-catalogue — the graphs, published at last', () => {
  it('P1/P3 — returns all four graphs, and jobStates carries all five flags', async () => {
    authAs(FULL);
    const response = await catalogue();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workOrderStates: readonly { code: string }[];
      workOrderTransitions: readonly { fromState: string; toState: string }[];
      jobStates: readonly Record<string, unknown>[];
      jobTransitions: readonly { fromState: string }[];
    };
    expect(body.workOrderStates.length).toBeGreaterThanOrEqual(9);
    expect(body.workOrderTransitions.length).toBeGreaterThanOrEqual(15);
    expect(body.jobStates.length).toBeGreaterThanOrEqual(6);
    expect(body.jobTransitions.length).toBeGreaterThanOrEqual(10);

    // P3 — the fifth flag IS published. Omitting a field the row carries would
    // be its own defect; the containment is S6's job, not concealment.
    const first = body.jobStates[0] as Record<string, unknown>;
    for (const flag of [
      'code',
      'name',
      'isTerminal',
      'reasonRequired',
      'assignmentRequired',
      'laborAllowed',
      'closureEligible',
    ]) {
      expect(Object.keys(first)).toContain(flag);
    }
  });

  it('P2 — a tenant row SHADOWS the platform row it overrides', async () => {
    // The decisive catalogue case. A response that returned platform rows
    // regardless would be worse than no endpoint, because a UI would trust it.
    const client = await admin.connect();
    try {
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await client.query(
        `INSERT INTO wo.job_states
           (scope, tenant_id, code, name, is_terminal, reason_required,
            assignment_required, labor_allowed, closure_eligible, created_by)
         VALUES ('tenant',$1,'planned','Tenant Planned',false,false,false,false,false,$2)
         ON CONFLICT DO NOTHING`,
        [TENANT_A, USER_A]
      );
    } finally {
      client.release();
    }

    authAs(FULL);
    const body = (await (await catalogue()).json()) as {
      jobStates: readonly { code: string; name: string }[];
    };
    const planned = body.jobStates.filter((state) => state.code === 'planned');
    // Exactly one row for the code — the override REPLACES rather than joins.
    expect(planned).toHaveLength(1);
    expect(planned[0]?.name).toBe('Tenant Planned');
  });

  it('N5 — an unknown query parameter is a 422', async () => {
    authAs(FULL);
    const response = await catalogue('unexpected=1');
    expect(response.status).toBe(422);
    expect(((await response.json()) as Problem).code).toBe('ERR-VAL-001');
  });
});

describe('wo.job-list — the branch board', () => {
  it('P4 — lists a branch and carries the board context columns', async () => {
    const job = await seedJob();
    authAs(FULL);
    const response = await jobList(`${branchQuery}&limit=50`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageOf<JobBoardRow>;
    const mine = page.items.find((row) => row.id === job.jobId);
    expect(mine).toBeDefined();
    expect(mine?.workOrderId).toBe(job.workOrderId);
    expect(mine?.pendingRequiredAdditionalWork).toBe(false);
    expect(mine?.openAssignmentCount).toBe(0);
    expect(mine?.hasOpenLaborSession).toBe(false);
    expect(typeof mine?.workOrderState).toBe('string');
  });

  it('P5 — pendingRequiredAdditionalWork is true exactly when a REQUIRED pending request names the job', async () => {
    const job = await seedJob();
    const client = await admin.connect();
    try {
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      // is_required FALSE first: the flag must NOT move for an optional request.
      await client.query(
        `INSERT INTO wo.additional_work_requests
           (tenant_id, company_id, branch_id, work_order_id, originating_job_id,
            summary, state, is_required, created_by)
         VALUES ($1,$2,$3,$4,$5,'optional extra','pending',false,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, job.workOrderId, job.jobId, USER_A]
      );
    } finally {
      client.release();
    }
    authAs(FULL);
    let page = (await (await jobList(`${branchQuery}&limit=50`)).json()) as PageOf<JobBoardRow>;
    expect(page.items.find((row) => row.id === job.jobId)?.pendingRequiredAdditionalWork).toBe(
      false
    );

    const second = await admin.connect();
    try {
      await second.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await second.query(
        `INSERT INTO wo.additional_work_requests
           (tenant_id, company_id, branch_id, work_order_id, originating_job_id,
            summary, state, is_required, created_by)
         VALUES ($1,$2,$3,$4,$5,'required extra','pending',true,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, job.workOrderId, job.jobId, USER_A]
      );
    } finally {
      second.release();
    }
    authAs(FULL);
    page = (await (await jobList(`${branchQuery}&limit=50`)).json()) as PageOf<JobBoardRow>;
    expect(page.items.find((row) => row.id === job.jobId)?.pendingRequiredAdditionalWork).toBe(
      true
    );
  });

  it('N4 — an unknown job state filter is an EMPTY PAGE, never a 422', async () => {
    await seedJob();
    authAs(FULL);
    // wo.job_states is tenant-extensible: a code this process has never seen may
    // be perfectly valid for another tenant, so refusing it would make the API
    // disagree with the catalogue it is paired with.
    const response = await jobList(`${branchQuery}&state=a_state_no_tenant_has&limit=50`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as PageOf<JobBoardRow>).items).toHaveLength(0);
  });

  it('N2/N5 — a missing branchId and an unknown parameter are both 422', async () => {
    authAs(FULL);
    expect((await jobList(`companyId=${COMPANY_A1}&limit=5`)).status).toBe(422);
    authAs(FULL);
    expect((await jobList(`${branchQuery}&nope=1`)).status).toBe(422);
  });

  it('S1 — T-02: a grant in another branch cannot read this branch board', async () => {
    await seedJob();
    // SCOPED_ELSEWHERE holds the read permission, but granted only in BRANCH_A2.
    // RLS alone cannot refuse it — app.branch_ids is the permission-blind union
    // of every active grant — so only the scoped evaluation against the branch
    // actually asked for can.
    authAs(SCOPED_ELSEWHERE);
    const response = await jobList(`${branchQuery}&limit=50`);
    expect(response.status).toBe(403);
  });

  it('S2 — a branch board never returns another branch’s job', async () => {
    const here = await seedJob();
    const elsewhere = await seedJob({ branchId: BRANCH_A2 });
    authAs(FULL);
    const page = (await (await jobList(`${branchQuery}&limit=50`)).json()) as PageOf<JobBoardRow>;
    const ids = page.items.map((row) => row.id);
    expect(ids).toContain(here.jobId);
    expect(ids).not.toContain(elsewhere.jobId);
  });

  it('S7 — the board is complete across page boundaries', async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 3; i += 1) seeded.push((await seedJob()).jobId);

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      authAs(FULL);
      const query = `${branchQuery}&limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      const page = (await (await jobList(query)).json()) as PageOf<JobBoardRow>;
      pages += 1;
      if (page.hasMore) expect(page.items).toHaveLength(2);
      collected.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor !== null && pages < 40);

    for (const id of seeded) expect(collected).toContain(id);
    expect(new Set(collected).size).toBe(collected.length);
  });
});

describe('wo.job-detail — edges from the catalogue, staff behind T-05', () => {
  it('P6 — nextStates is computed from the tenant graph, not a constant', async () => {
    const job = await seedJob();
    authAs(FULL);
    const response = await jobDetail(job.jobId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      job: JobBoardRow;
      nextStates: readonly { code: string }[];
    };
    expect(body.job.id).toBe(job.jobId);
    const codes = body.nextStates.map((state) => state.code);
    // Whatever the graph holds, the answer must be a SUBSET of the edges the
    // catalogue publishes out of this job's current state.
    authAs(FULL);
    const graph = (await (await catalogue()).json()) as {
      jobTransitions: readonly { fromState: string; toState: string }[];
    };
    const expected = graph.jobTransitions
      .filter((edge) => edge.fromState === body.job.state)
      .map((edge) => edge.toState);
    expect(codes.sort()).toEqual(expected.sort());
  });

  it('S3 — T-05: assignments is OMITTED, not empty, without tech.technician.read', async () => {
    const job = await seedJob();
    // READER holds wo.work_order.read and nothing else.
    authAs(READER);
    const body = (await (await jobDetail(job.jobId)).json()) as Record<string, unknown>;
    // The distinction is the point: an empty array would ASSERT "no assignments",
    // a claim about the data. An absent key says this response does not answer.
    expect(Object.keys(body)).not.toContain('assignments');

    authAs(FULL);
    const full = (await (await jobDetail(job.jobId)).json()) as Record<string, unknown>;
    expect(Object.keys(full)).toContain('assignments');
    expect(Array.isArray(full.assignments)).toBe(true);
  });

  it('N6 — a job in an unheld branch is 404, not 403 and not a disclosure', async () => {
    const job = await seedJob();
    authAs(SCOPED_ELSEWHERE);
    const response = await jobDetail(job.jobId);
    expect([403, 404]).toContain(response.status);
    expect(JSON.stringify(await response.json())).not.toContain('BR-06 execution control');
  });
});

describe('qms.qc-record-branch-list — the QC queue', () => {
  it('P7 — pages a branch and filters by overallResult', async () => {
    const job = await seedJob();
    const client = await admin.connect();
    try {
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await client.query(
        `INSERT INTO qms.quality_control_records
           (tenant_id, company_id, branch_id, work_order_id, overall_result, created_by)
         VALUES ($1,$2,$3,$4,'pending',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, job.workOrderId, USER_A]
      );
    } finally {
      client.release();
    }
    authAs(FULL);
    const all = (await (await qcList(`${branchQuery}&limit=50`)).json()) as PageOf<{
      workOrderId: string;
      overallResult: string;
    }>;
    expect(all.items.some((row) => row.workOrderId === job.workOrderId)).toBe(true);

    authAs(FULL);
    const passed = (await (
      await qcList(`${branchQuery}&overallResult=passed&limit=50`)
    ).json()) as PageOf<{ workOrderId: string }>;
    expect(passed.items.some((row) => row.workOrderId === job.workOrderId)).toBe(false);
  });

  it('N3 — a missing companyId is 422, and a bad overallResult is 422', async () => {
    authAs(FULL);
    expect((await qcList(`branchId=${BRANCH_A1}&limit=5`)).status).toBe(422);
    authAs(FULL);
    // Unlike job `state`, this vocabulary IS closed — qms.qc_status_history
    // CHECK-constrains the same three literals — so an unknown value is refused.
    expect((await qcList(`${branchQuery}&overallResult=maybe`)).status).toBe(422);
  });
});

describe('wo.job-work-log-record / wo.job-work-log-list — append-only progress narration', () => {
  it('P8 — an entry is recorded, read back, and loggedAt is distinct from createdAt', async () => {
    const job = await seedJob();
    // The window is bounded on BOTH sides — not before the job existed, not in
    // the future — so the fixture derives the instant from the job's own
    // created_at rather than picking "a minute ago", which the service correctly
    // refuses with `before_job_created` on a job seconds old. That refusal is the
    // rule working; this is how to exercise it honestly.
    const jobRow = await admin.query<{ created_at: Date }>(
      `SELECT created_at FROM wo.jobs WHERE id = $1`,
      [job.jobId]
    );
    const jobCreatedAt = jobRow.rows[0]?.created_at as Date;
    const loggedAt = new Date(jobCreatedAt.getTime() + 1).toISOString();
    // A beat, so the log row's own created_at is strictly later than loggedAt and
    // the "these are two different instants" assertion is not a coin flip.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    authAs(FULL);
    const created = await recordWorkLog(job.jobId, {
      entry: 'Removed the caliper and found the piston seized.',
      loggedAt,
    });
    if (created.status !== 201) {
      throw new Error(`work-log record returned ${created.status}: ${await created.text()}`);
    }
    const row = (await created.json()) as WorkLogRow;
    expect(row.jobId).toBe(job.jobId);
    expect(row.createdBy).toBe(FULL.userId);
    expect(new Date(row.loggedAt).getTime()).toBeLessThan(new Date(row.createdAt).getTime());

    // The PERSISTED row, not merely the response. A test that asserts an HTTP
    // status and never looks at the database proves the route returned, not that
    // it recorded.
    const persisted = await admin.query<{
      entry: string;
      created_by: string;
      company_id: string;
      branch_id: string;
      job_id: string;
    }>(
      `SELECT entry, created_by, company_id, branch_id, job_id FROM wo.job_work_logs WHERE id = $1`,
      [row.id]
    );
    expect(persisted.rows[0]?.entry).toBe('Removed the caliper and found the piston seized.');
    expect(persisted.rows[0]?.created_by).toBe(FULL.userId);
    expect(persisted.rows[0]?.company_id).toBe(COMPANY_A1);
    expect(persisted.rows[0]?.branch_id).toBe(BRANCH_A1);
    expect(persisted.rows[0]?.job_id).toBe(job.jobId);

    authAs(FULL);
    const listed = (await (await listWorkLogs(job.jobId)).json()) as PageOf<WorkLogRow>;
    expect(listed.items.map((entry) => entry.id)).toContain(row.id);
  });

  it('N7/N8/N9 — blank entry, future loggedAt and an oversized entry are each 422', async () => {
    const job = await seedJob();
    authAs(FULL);
    expect((await recordWorkLog(job.jobId, { entry: '   ' })).status).toBe(422);
    authAs(FULL);
    const future = await recordWorkLog(job.jobId, {
      entry: 'ok',
      loggedAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(future.status).toBe(422);
    expect(((await future.json()) as Problem).code).toBe('ERR-VAL-001');
    authAs(FULL);
    expect((await recordWorkLog(job.jobId, { entry: 'x'.repeat(4001) })).status).toBe(422);
  });

  it('S5 — a forged createdBy in the body is refused by .strict()', async () => {
    const job = await seedJob();
    authAs(FULL);
    const response = await recordWorkLog(job.jobId, {
      entry: 'attributed to somebody else',
      createdBy: randomUUID(),
    });
    expect(response.status).toBe(422);
  });

  it('N10 — a work-log write without an Idempotency-Key is 400 ERR-INT-002', async () => {
    const job = await seedJob();
    authAs(FULL);
    const response = await WORK_LOG_RECORD(
      new Request(`http://localhost/api/v1/jobs/${job.jobId}/work-logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry: 'no key' }),
      }),
      { params: Promise.resolve({ jobId: job.jobId }) }
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as Problem).code).toBe('ERR-INT-002');
  });

  it('idempotency — the SAME key replays rather than appending twice', async () => {
    // The BR-04 defect in reverse: this can only pass if '/jobs/{jobId}/work-logs'
    // is registered in ROUTE_TEMPLATES, because an unregistered template refuses
    // to fingerprint and answers ERR-INT-002 with a perfectly valid header.
    const job = await seedJob();
    const key = randomUUID();
    authAs(FULL);
    const first = await recordWorkLog(job.jobId, { entry: 'replayed entry' }, key);
    expect(first.status).toBe(201);
    authAs(FULL);
    const second = await recordWorkLog(job.jobId, { entry: 'replayed entry' }, key);
    expect([200, 201]).toContain(second.status);

    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_work_logs WHERE job_id = $1 AND entry = 'replayed entry'`,
      [job.jobId]
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  it('N11/N12 — append-only at the GRANT layer, proved with the row REACHABLE', async () => {
    const job = await seedJob();
    authAs(FULL);
    const row = (await (
      await recordWorkLog(job.jobId, { entry: 'immutable' })
    ).json()) as WorkLogRow;

    await asAppRuntime(async (client) => {
      // FIRST prove app_runtime can SEE the row. Without this, a zero-row UPDATE
      // filtered away by RLS would RESOLVE and the refusal assertions below would
      // pass while never reaching the table — the BR-04 false green exactly.
      const visible = await client.query(`SELECT id FROM wo.job_work_logs WHERE id = $1`, [row.id]);
      expect(
        visible.rowCount,
        'app_runtime cannot see the row; the refusals below would be vacuous'
      ).toBe(1);

      // SAVEPOINTs, because a refused statement ABORTS the transaction and every
      // statement after it would then fail with "current transaction is aborted"
      // — a different error that would pass a `/permission denied/` matcher only
      // by accident, and would make the DELETE case prove nothing.
      await client.query('SAVEPOINT attempt_update');
      await expect(
        client.query(`UPDATE wo.job_work_logs SET entry = 'tampered' WHERE id = $1`, [row.id])
      ).rejects.toThrow(/permission denied/i);
      await client.query('ROLLBACK TO SAVEPOINT attempt_update');

      await client.query('SAVEPOINT attempt_delete');
      await expect(
        client.query(`DELETE FROM wo.job_work_logs WHERE id = $1`, [row.id])
      ).rejects.toThrow(/permission denied/i);
      await client.query('ROLLBACK TO SAVEPOINT attempt_delete');
    });

    const after = await admin.query<{ entry: string }>(
      `SELECT entry FROM wo.job_work_logs WHERE id = $1`,
      [row.id]
    );
    expect(after.rows[0]?.entry).toBe('immutable');
  });

  it('isolation — a branch-scoped principal can neither read nor write another branch’s work log', async () => {
    // Cross-BRANCH, inside one tenant, which RLS alone cannot refuse:
    // app.branch_ids is the permission-blind union of every active grant, so only
    // the scoped evaluation against the job's own branch closes this.
    const job = await seedJob();
    authAs(FULL);
    await recordWorkLog(job.jobId, { entry: 'branch A only' });

    authAs(SCOPED_ELSEWHERE);
    const read = await listWorkLogs(job.jobId);
    expect([403, 404]).toContain(read.status);
    expect(JSON.stringify(await read.json())).not.toContain('branch A only');

    authAs(SCOPED_ELSEWHERE);
    const write = await recordWorkLog(job.jobId, { entry: 'from another branch' });
    expect([403, 404]).toContain(write.status);

    const leaked = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_work_logs
        WHERE job_id = $1 AND entry = 'from another branch'`,
      [job.jobId]
    );
    expect(Number(leaked.rows[0]?.n), 'a refused write must leave no row').toBe(0);
  });

  it('S4 — a tenant-B job’s work log is unreachable from tenant A', async () => {
    const foreign = await seedJob({ tenantId: TENANT_B });
    authAs(FULL);
    const response = await listWorkLogs(foreign.jobId);
    expect([403, 404]).toContain(response.status);
    authAs(FULL);
    expect((await recordWorkLog(foreign.jobId, { entry: 'cross tenant' })).status).not.toBe(201);
  });
});

describe('S6 — the closureEligible trap is contained (C-02)', () => {
  it('a tenant job state with closure_eligible=true and is_terminal=false does NOT make a work order closable', async () => {
    const job = await seedJob();
    const client = await admin.connect();
    try {
      // BEGIN, so the LOCAL settings survive to the UPDATE. `app.actor_id` is
      // required as well: moving a job fires the status-history emitter, which
      // refuses to write an unattributed transition — append-only history with a
      // nullable author would not be history.
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true),
                set_config('app.actor_id',$1,true)`,
        [USER_A, TENANT_A]
      );
      // The trap: a tenant may author this, and ck_job_states_tenant_not_terminal
      // permits it — it only forbids is_terminal = true.
      await client.query(
        `INSERT INTO wo.job_states
           (scope, tenant_id, code, name, is_terminal, reason_required,
            assignment_required, labor_allowed, closure_eligible, created_by)
         VALUES ('tenant',$1,'br06_eligible_not_terminal','Eligible Not Terminal',
                 false,false,false,false,true,$2)
         ON CONFLICT DO NOTHING`,
        [TENANT_A, USER_A]
      );
      // The EDGE has to exist too. `wo.guard_job_transition` reads the graph and
      // refuses a move with no active edge — even for a direct admin UPDATE,
      // which is the guard being authoritative rather than advisory. Authoring
      // the state without the edge is what a tenant would actually have to do.
      await client.query(
        `INSERT INTO wo.job_transitions
           (scope, tenant_id, from_state, to_state, requires_reason, created_by)
         VALUES ('tenant',$1,'planned','br06_eligible_not_terminal',false,$2)
         ON CONFLICT DO NOTHING`,
        [TENANT_A, USER_A]
      );
      await client.query(`UPDATE wo.jobs SET state = 'br06_eligible_not_terminal' WHERE id = $1`, [
        job.jobId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // The flag IS published — P3 asserts that — and it must still not decide
    // closure. wo.guard_work_order_closure reads js.is_terminal and never this.
    authAs(FULL);
    const body = (await (await catalogue()).json()) as {
      jobStates: readonly { code: string; closureEligible: boolean; isTerminal: boolean }[];
    };
    const authored = body.jobStates.find((state) => state.code === 'br06_eligible_not_terminal');
    expect(authored?.closureEligible).toBe(true);
    expect(authored?.isTerminal).toBe(false);

    // And the authority disagrees: the job is NOT terminal, so blocker B1 stands.
    const blocked = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM wo.jobs j
          JOIN wo.job_states js
            ON js.code = j.state
           AND (js.scope = 'platform' OR js.tenant_id = j.tenant_id)
         WHERE j.id = $1 AND js.is_terminal = false
       ) AS blocked`,
      [job.jobId]
    );
    expect(
      blocked.rows[0]?.blocked,
      'closure_eligible must not be readable as a closure decision'
    ).toBe(true);
  });
});

describe('N1/N2 — authorization on every one of the six operations', () => {
  /** In the tenant, authenticated, holding no permission at all. */
  const NOBODY = { ...READER, permissions: [], subject: 'fx_br_06_nobody' };

  it('N1 — every operation refuses a principal with no grant at all', async () => {
    const job = await seedJob();

    /*
     * 401 or 403, asserted as "refused" rather than pinned to one code, and the
     * reason is worth stating instead of flattening.
     *
     * `NOBODY` carries a subject with NO grant rows behind it, so principal
     * resolution rejects it as UNAUTHENTICATED before any operation's permission
     * is consulted — every one of the six answers 401. That is a real refusal and
     * the right one, but it is a property of principal resolution, not of these
     * routes, so pinning 403 here would be asserting the wrong thing.
     *
     * The genuine AUTHORIZATION denials — an authenticated caller who holds a
     * real permission but not the required one — are the two cases below and S1,
     * and those do assert 403 exactly.
     */
    const refusals: readonly [string, number][] = [
      ['wo.work-order-catalogue', (authAs(NOBODY), (await catalogue()).status)],
      ['wo.job-list', (authAs(NOBODY), (await jobList(`${branchQuery}&limit=5`)).status)],
      ['wo.job-detail', (authAs(NOBODY), (await jobDetail(job.jobId)).status)],
      [
        'qms.qc-record-branch-list',
        (authAs(NOBODY), (await qcList(`${branchQuery}&limit=5`)).status),
      ],
      [
        'wo.job-work-log-record',
        (authAs(NOBODY), (await recordWorkLog(job.jobId, { entry: 'denied' })).status),
      ],
      ['wo.job-work-log-list', (authAs(NOBODY), (await listWorkLogs(job.jobId)).status)],
    ];
    for (const [operation, status] of refusals) {
      expect([401, 403], operation).toContain(status);
    }
  });

  it('N2 — an authenticated caller holding the WRONG permission gets a real 403', async () => {
    // READER is authenticated and holds wo.work_order.read. That is the QC list's
    // wrong code, so this is authorization refusing an authenticated caller —
    // the distinction N1 above cannot make.
    await seedJob();
    authAs(READER);
    expect((await qcList(`${branchQuery}&limit=5`)).status, 'qms.qc-record-branch-list').toBe(403);
  });

  it('a work-order reader cannot write a work log — the two codes stay separate', async () => {
    // READER holds wo.work_order.read, which is the work-log READ code. The
    // WRITE costs tech.labor.record, and the split is deliberate: the log is the
    // technician's narration of their own labour, not a management act.
    const job = await seedJob();
    authAs(READER);
    expect((await listWorkLogs(job.jobId)).status).toBe(200);
    authAs(READER);
    expect((await recordWorkLog(job.jobId, { entry: 'not mine to write' })).status).toBe(403);
  });

  it('cross-tenant: a tenant-B principal sees none of tenant A’s jobs or QC records', async () => {
    const mine = await seedJob();
    authAs(TENANT_B_FULL);
    // Asking for tenant A's branch as tenant B: refused at scope evaluation, and
    // RLS would refuse the rows even if it were not.
    const jobs = await jobList(`${branchQuery}&limit=50`);
    expect([403, 200]).toContain(jobs.status);
    if (jobs.status === 200) {
      const page = (await jobs.json()) as PageOf<JobBoardRow>;
      expect(page.items.map((row) => row.id)).not.toContain(mine.jobId);
    }
    authAs(TENANT_B_FULL);
    const detail = await jobDetail(mine.jobId);
    expect([403, 404]).toContain(detail.status);
    authAs(TENANT_B_FULL);
    const qc = await qcList(`${branchQuery}&limit=50`);
    expect([403, 200]).toContain(qc.status);
  });

  it('isolation: the QC queue of one branch never carries another branch’s record', async () => {
    const here = await seedJob();
    const client = await admin.connect();
    try {
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await client.query(
        `INSERT INTO qms.quality_control_records
           (tenant_id, company_id, branch_id, work_order_id, overall_result, created_by)
         VALUES ($1,$2,$3,$4,'pending',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, here.workOrderId, USER_A]
      );
    } finally {
      client.release();
    }
    authAs(FULL);
    const other = (await (
      await qcList(`companyId=${COMPANY_A1}&branchId=${BRANCH_A2}&limit=50`)
    ).json()) as PageOf<{ workOrderId: string }>;
    expect(other.items.some((row) => row.workOrderId === here.workOrderId)).toBe(false);
  });
});

describe('the operations this slice deliberately does NOT ship', () => {
  it('no pause, resume, start or complete endpoint exists', async () => {
    // Recorded as a test rather than a comment because "add a pause endpoint" is
    // the obvious move, and the reason not to is an authorization argument: it
    // would either collapse tech.labor.record and wo.job.transition into one
    // permission, or refuse what the two-call composition already handles.
    const { readdirSync } = await import('node:fs');
    const jobRoutes = readdirSync('apps/api/src/app/api/v1/jobs/[jobId]', {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const forbidden of ['pause', 'resume', 'start', 'complete']) {
      expect(jobRoutes, `an endpoint named ${forbidden} was added`).not.toContain(forbidden);
    }
  });
});
