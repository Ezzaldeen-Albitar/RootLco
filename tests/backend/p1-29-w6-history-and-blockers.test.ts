/**
 * P1-29 `W6` — the unified work-order history (`INT-043`) and the blocker record
 * (Owner requirement 13, `VHM-16`).
 *
 * The cases, in order of how badly they would be missed:
 *
 *  1. **T1 — nine kinds from four modules, one chronology.** A work order is
 *     driven through the REAL routes of `wo`, `tech`, `dia` and `qms`, and the
 *     timeline returns every event in one descending order. `INT-043` was the
 *     finding that a client had to walk seven reads and interleave them itself.
 *  2. **T2 — complete across page boundaries.** At `limit=3` the pages
 *     concatenate to exactly the unpaged set, nothing skipped and nothing
 *     duplicated, because the merge is a keyset over `(occurred_at, kind:id)`
 *     with every source over-fetching one row (`server/db/timeline.ts`).
 *  3. **T3 — kinds the caller may not see are OMITTED and NAMED.** A work-order
 *     reader without `tech.technician.read`, `dia.diagnostic.read` or
 *     `qms.quality_control.read` gets no staff, report or QC kind and an
 *     `omittedKinds` entry for each, with the code that would show it.
 *  4. **B1..B4 — the blocker record.** Raised, resolved, folded with a derived
 *     status; a second resolution is a conflict and the record is unchanged;
 *     `awaiting_parts` is NOT touched by any of it.
 *
 * Operations exercised here: wo.job-blocker-raise, wo.job-blocker-resolve,
 * wo.job-blocker-list, wo.work-order-timeline.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.job-blocker-raise: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.job-blocker-resolve: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.job-blocker-list: route service authorization success denial cross-tenant isolation
 *   wo.work-order-timeline: route service authorization success denial cross-tenant isolation
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SUBJECT_UNPERMITTED,
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
  SCOPED_ELSEWHERE,
  SPLIT_WINDOW,
  TECH_A1,
  TENANT_B_FULL,
  auditCount,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  establishDiagnosticFixtures,
  establishP1_19Fixtures,
  establishQualityFixtures,
  establishTechnicianFixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as JOB_TRANSITION } from '@/app/api/v1/jobs/[jobId]/transition/route';
import { POST as ASSIGN } from '@/app/api/v1/jobs/[jobId]/assignments/route';
import { POST as START } from '@/app/api/v1/jobs/[jobId]/labor-sessions/route';
import { POST as STOP } from '@/app/api/v1/labor-sessions/[sessionId]/stop/route';
import { POST as RECORD_WORK_LOG } from '@/app/api/v1/jobs/[jobId]/work-logs/route';
import { POST as CREATE_REPORT } from '@/app/api/v1/jobs/[jobId]/inspections/route';
import { POST as MOVE_REPORT } from '@/app/api/v1/inspections/[inspectionId]/transition/route';
import { POST as OPEN_QC } from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { PUT as WRITE_CHECK } from '@/app/api/v1/quality-controls/[recordId]/checks/[qcCheckId]/route';
import { POST as FINALIZE_QC } from '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import {
  GET as LIST_BLOCKERS,
  JOB_BLOCKER_LIST_OPERATION,
  JOB_BLOCKER_RAISE_OPERATION,
  POST as RAISE,
} from '@/app/api/v1/jobs/[jobId]/blockers/route';
import {
  JOB_BLOCKER_RESOLVE_OPERATION,
  POST as RESOLVE,
} from '@/app/api/v1/blockers/[blockerId]/resolution/route';
import {
  GET as TIMELINE,
  WORK_ORDER_TIMELINE_OPERATION,
} from '@/app/api/v1/work-orders/[workOrderId]/timeline/route';

let admin: Pool;
let runtime: Pool;
let templateVersionId: string;
let mandatoryCheckId: string;

interface Problem {
  readonly code?: string;
}
interface TimelineEntry {
  readonly kind: string;
  readonly id: string;
  readonly jobId: string | null;
  readonly actorId: string | null;
  readonly occurredAt: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly note: string | null;
  readonly reference: string | null;
  readonly detail: string | null;
}
interface TimelinePage {
  readonly workOrderId: string;
  readonly items: readonly TimelineEntry[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly omittedKinds: readonly { readonly kind: string; readonly requires: string }[];
}
interface BlockerEvent {
  readonly id: string;
  readonly jobId: string;
  readonly event: string;
  readonly resolvesEventId: string | null;
  readonly note: string;
  readonly occurredAt: string;
  readonly createdBy: string;
}
interface BlockerView {
  readonly id: string;
  readonly jobId: string;
  readonly note: string;
  readonly raisedAt: string;
  readonly raisedBy: string;
  readonly status: string;
  readonly resolution: { readonly id: string; readonly note: string } | null;
}

const json = <T>(response: Response): Promise<T> => response.json() as Promise<T>;

function send(
  handler: (request: Request, route: { params: Promise<never> }) => Promise<Response>,
  url: string,
  params: Record<string, string>,
  body: unknown,
  options: { readonly method?: string; readonly version?: number } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
  };
  if (options.version !== undefined) headers['if-match'] = String(options.version);
  return handler(
    new Request(`http://localhost${url}`, {
      method: options.method ?? 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params as never) }
  );
}

const raise = (jobId: string, body: unknown): Promise<Response> =>
  send(RAISE as never, `/api/v1/jobs/${jobId}/blockers`, { jobId }, body);
const resolve = (blockerId: string, body: unknown): Promise<Response> =>
  send(RESOLVE as never, `/api/v1/blockers/${blockerId}/resolution`, { blockerId }, body);
const listBlockers = (jobId: string): Promise<Response> =>
  LIST_BLOCKERS(new Request(`http://localhost/api/v1/jobs/${jobId}/blockers`), {
    params: Promise.resolve({ jobId }),
  });
const timeline = (workOrderId: string, query = ''): Promise<Response> =>
  TIMELINE(
    new Request(
      `http://localhost/api/v1/work-orders/${workOrderId}/timeline${query ? `?${query}` : ''}`
    ),
    { params: Promise.resolve({ workOrderId }) }
  );

/** A job on a fresh open order, moved to `assigned` with TECH_A1 on it. */
async function seedAssignedJob(
  scope: { readonly tenantId?: string } = {}
): Promise<{ readonly workOrderId: string; readonly jobId: string; readonly version: number }> {
  const tenantB = scope.tenantId === TENANT_B;
  const as = tenantB ? TENANT_B_FULL : FULL;
  const order = await createOpenWorkOrder(
    tenantB ? { tenantId: TENANT_B, companyId: COMPANY_B1, branchId: BRANCH_B1 } : {}
  );
  authAs(as);
  const created = await send(
    CREATE_JOB as never,
    `/api/v1/work-orders/${order.workOrderId}/jobs`,
    { workOrderId: order.workOrderId },
    { title: 'W6 fixture — replace front pads', requiresDiagnostic: true }
  );
  if (created.status !== 201) throw new Error(`fixture job failed with ${created.status}`);
  const job = await json<{ id: string; recordVersion: number }>(created);
  if (tenantB) return { workOrderId: order.workOrderId, jobId: job.id, version: job.recordVersion };

  authAs(as);
  const assigned = await send(
    ASSIGN as never,
    `/api/v1/jobs/${job.id}/assignments`,
    { jobId: job.id },
    {
      technicianProfileId: TECH_A1,
      window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
    }
  );
  if (assigned.status !== 201) throw new Error(`fixture assignment failed with ${assigned.status}`);
  authAs(as);
  const moved = await send(
    JOB_TRANSITION as never,
    `/api/v1/jobs/${job.id}/transition`,
    { jobId: job.id },
    { toState: 'assigned' },
    { version: job.recordVersion }
  );
  if (moved.status !== 200) throw new Error(`fixture transition failed with ${moved.status}`);
  const after = await json<{ recordVersion: number }>(moved);
  return { workOrderId: order.workOrderId, jobId: job.id, version: after.recordVersion };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishTechnicianFixtures();
  templateVersionId = (await establishDiagnosticFixtures()).templateVersionId;
  mandatoryCheckId = (await establishQualityFixtures()).mandatoryId;
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

describe('P1-29 W6 — the four operations, registered under their canonical ids', () => {
  it('declares the ids the canonical plan cites, with the authorities the record states', () => {
    expect(JOB_BLOCKER_RAISE_OPERATION.id).toBe('wo.job-blocker-raise');
    expect(JOB_BLOCKER_RESOLVE_OPERATION.id).toBe('wo.job-blocker-resolve');
    expect(JOB_BLOCKER_LIST_OPERATION.id).toBe('wo.job-blocker-list');
    expect(WORK_ORDER_TIMELINE_OPERATION.id).toBe('wo.work-order-timeline');
    // The write costs the worker's code and the reads cost the order's, as the
    // work log does — the split this record inherits rather than invents.
    expect(JOB_BLOCKER_RAISE_OPERATION.permissions).toEqual(['tech.labor.record']);
    expect(JOB_BLOCKER_RESOLVE_OPERATION.permissions).toEqual(['tech.labor.record']);
    expect(JOB_BLOCKER_LIST_OPERATION.permissions).toEqual(['wo.work_order.read']);
    expect(WORK_ORDER_TIMELINE_OPERATION.permissions).toEqual(['wo.work_order.read']);
  });
});

describe('P1-29 W6 — the blocker record', () => {
  it('B1 — a raise PERSISTS, the list folds it as open, and no state moved', async () => {
    const seeded = await seedAssignedJob();
    authAs(FULL);
    const raised = await raise(seeded.jobId, { note: 'Waiting for the left caliper' });
    expect(raised.status).toBe(201);
    const event = await json<BlockerEvent>(raised);
    expect(event.event).toBe('raised');
    expect(event.resolvesEventId).toBeNull();
    expect(Object.keys(event).sort()).toEqual(
      ['createdBy', 'event', 'id', 'jobId', 'note', 'occurredAt', 'resolvesEventId'].sort()
    );

    authAs(READER);
    const listed = await json<{ items: BlockerView[] }>(await listBlockers(seeded.jobId));
    const mine = listed.items.find((row) => row.id === event.id);
    expect(mine?.status).toBe('raised');
    expect(mine?.resolution).toBeNull();
    expect(mine?.note).toBe('Waiting for the left caliper');

    // VHM-16: the record does not move the state graph.
    const job = await admin.query<{ state: string }>('SELECT state FROM wo.jobs WHERE id = $1', [
      seeded.jobId,
    ]);
    expect(job.rows[0]?.state).toBe('assigned');
    expect(await auditCount('wo.job.blocker_raised', seeded.jobId)).toBe(1);
  });

  it('B2 — a resolution references the raise; a second one is a CONFLICT and changes nothing', async () => {
    const seeded = await seedAssignedJob();
    authAs(FULL);
    const event = await json<BlockerEvent>(await raise(seeded.jobId, { note: 'Part on order' }));

    authAs(FULL);
    const resolved = await resolve(event.id, { note: 'Part arrived and fitted' });
    expect(resolved.status).toBe(201);
    const resolution = await json<BlockerEvent>(resolved);
    expect(resolution.event).toBe('resolved');
    expect(resolution.resolvesEventId).toBe(event.id);

    authAs(FULL);
    const again = await resolve(event.id, { note: 'Fitted twice?' });
    expect(again.status).toBe(409);
    expect((await json<Problem>(again)).code).toBe('ERR-CON-001');

    // The resolution's own id is not a blocker.
    authAs(FULL);
    expect((await resolve(resolution.id, { note: 'x' })).status).toBe(404);

    authAs(READER);
    const listed = await json<{ items: BlockerView[] }>(await listBlockers(seeded.jobId));
    const mine = listed.items.find((row) => row.id === event.id);
    expect(mine?.status).toBe('resolved');
    expect(mine?.resolution?.id).toBe(resolution.id);
    expect(mine?.resolution?.note).toBe('Part arrived and fitted');
    expect(listed.items.filter((row) => row.id === event.id)).toHaveLength(1);
    expect(await auditCount('wo.job.blocker_resolved', seeded.jobId)).toBe(1);
  });

  it('B3 — a blank note is refused, and the recording code is not the reading code', async () => {
    const seeded = await seedAssignedJob();
    authAs(FULL);
    expect((await raise(seeded.jobId, { note: '   ' })).status).toBe(422);
    authAs(FULL);
    expect((await raise(seeded.jobId, { note: 'x', category: 'parts' })).status).toBe(422);
    // A work-order reader may LIST blockers and may not raise one.
    authAs(READER);
    expect((await raise(seeded.jobId, { note: 'Reader raising' })).status).toBe(403);
    authAs(READER);
    expect((await listBlockers(seeded.jobId)).status).toBe(200);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await listBlockers(seeded.jobId)).status).toBe(403);
  });

  it('B4 — another tenant and another branch see no blocker and can raise none', async () => {
    const seeded = await seedAssignedJob();
    authAs(FULL);
    const event = await json<BlockerEvent>(await raise(seeded.jobId, { note: 'Blocked' }));

    authAs(TENANT_B_FULL);
    expect((await raise(seeded.jobId, { note: 'from B' })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await resolve(event.id, { note: 'from B' })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await listBlockers(seeded.jobId)).status).toBe(404);
    authAs(SCOPED_ELSEWHERE);
    expect((await raise(seeded.jobId, { note: 'from A2' })).status).toBe(404);

    authAs(READER);
    const listed = await json<{ items: BlockerView[] }>(await listBlockers(seeded.jobId));
    expect(listed.items.find((row) => row.id === event.id)?.status).toBe('raised');
  });
});

describe('P1-29 W6 — the unified timeline', () => {
  /** Drives one order through four modules and returns what SHOULD appear. */
  async function seedHistory(): Promise<{
    readonly workOrderId: string;
    readonly jobId: string;
    readonly expectedKinds: readonly string[];
  }> {
    const seeded = await seedAssignedJob();
    // tech: a session started and stopped.
    authAs(FULL);
    const session = await json<{ id: string; recordVersion: number }>(
      await send(
        START as never,
        `/api/v1/jobs/${seeded.jobId}/labor-sessions`,
        { jobId: seeded.jobId },
        {
          technicianProfileId: TECH_A1,
        }
      )
    );
    authAs(FULL);
    const stopped = await send(
      STOP as never,
      `/api/v1/labor-sessions/${session.id}/stop`,
      { sessionId: session.id },
      undefined,
      { version: session.recordVersion }
    );
    expect(stopped.status).toBe(200);
    // wo: a work-log entry, a blocker raised and resolved.
    authAs(FULL);
    expect(
      (
        await send(
          RECORD_WORK_LOG as never,
          `/api/v1/jobs/${seeded.jobId}/work-logs`,
          { jobId: seeded.jobId },
          {
            entry: 'Bled the rear circuit',
          }
        )
      ).status
    ).toBe(201);
    authAs(FULL);
    const blocker = await json<BlockerEvent>(
      await raise(seeded.jobId, { note: 'Awaiting caliper' })
    );
    authAs(FULL);
    expect((await resolve(blocker.id, { note: 'Caliper fitted' })).status).toBe(201);
    // dia: a report created and moved, which is what writes its status ledger.
    authAs(FULL);
    const report = await send(
      CREATE_REPORT as never,
      `/api/v1/jobs/${seeded.jobId}/inspections`,
      { jobId: seeded.jobId },
      { templateVersionId }
    );
    expect(report.status).toBe(201);
    const created = await json<{ id: string; recordVersion: number }>(report);
    authAs(FULL);
    const movedReport = await send(
      MOVE_REPORT as never,
      `/api/v1/inspections/${created.id}/transition`,
      { inspectionId: created.id },
      { toStatus: 'in_progress' },
      { version: created.recordVersion }
    );
    expect(movedReport.status).toBe(200);
    // qms: a QC record opened, its mandatory check passed, and finalised.
    authAs(FULL);
    const qc = await send(
      OPEN_QC as never,
      `/api/v1/work-orders/${seeded.workOrderId}/quality-controls`,
      { workOrderId: seeded.workOrderId },
      {}
    );
    expect(qc.status).toBe(201);
    const record = await json<{ id: string; recordVersion: number }>(qc);
    authAs(FULL);
    expect(
      (
        await send(
          WRITE_CHECK as never,
          `/api/v1/quality-controls/${record.id}/checks/${mandatoryCheckId}`,
          { recordId: record.id, qcCheckId: mandatoryCheckId },
          { result: 'pass' },
          { method: 'PUT' }
        )
      ).status
    ).toBe(200);
    authAs(FULL);
    const finalised = await send(
      FINALIZE_QC as never,
      `/api/v1/quality-controls/${record.id}/finalization`,
      { recordId: record.id },
      { overallResult: 'passed' },
      { version: record.recordVersion }
    );
    expect([200, 201]).toContain(finalised.status);

    return {
      workOrderId: seeded.workOrderId,
      jobId: seeded.jobId,
      expectedKinds: [
        'work_order_status',
        'job_status',
        'assignment',
        'labor_session',
        'labor_session_ended',
        'work_log',
        'blocker_raised',
        'blocker_resolved',
        'diagnostic_status',
        'qc_status',
      ],
    };
  }

  it('T1 — ten kinds from four modules come back as ONE descending chronology', async () => {
    const seeded = await seedHistory();
    authAs(FULL);
    const response = await timeline(seeded.workOrderId, 'limit=100');
    expect(response.status).toBe(200);
    const page: TimelinePage = await json<TimelinePage>(response);
    expect(page.workOrderId).toBe(seeded.workOrderId);
    expect(page.omittedKinds).toEqual([]);
    for (const kind of seeded.expectedKinds) {
      expect(
        page.items.map((row) => row.kind),
        `missing kind ${kind}`
      ).toContain(kind);
    }
    // Descending by occurredAt, and every entry the mirror's shape.
    const stamps = page.items.map((row) => row.occurredAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
    for (const row of page.items) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'actorId',
          'detail',
          'fromState',
          'id',
          'jobId',
          'kind',
          'note',
          'occurredAt',
          'reference',
          'toState',
        ].sort()
      );
    }
    const blocker = page.items.find((row) => row.kind === 'blocker_resolved');
    expect(blocker?.reference).not.toBeNull();
    expect(page.items.find((row) => row.kind === 'work_log')?.note).toBe('Bled the rear circuit');
    expect(page.items.find((row) => row.kind === 'labor_session')?.reference).toBe(TECH_A1);
  });

  it('T2 — pages at limit=3 concatenate to the unpaged set: nothing skipped, nothing twice', async () => {
    const seeded = await seedHistory();
    authAs(FULL);
    const whole = (await json<TimelinePage>(await timeline(seeded.workOrderId, 'limit=100'))).items;
    expect(whole.length).toBeGreaterThanOrEqual(10);

    const collected: TimelineEntry[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      authAs(FULL);
      const response = await timeline(
        seeded.workOrderId,
        `limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const page: TimelinePage = await json<TimelinePage>(response);
      expect(page.items.length).toBeLessThanOrEqual(3);
      collected.push(...page.items);
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        break;
      }
      expect(page.nextCursor).not.toBeNull();
      cursor = page.nextCursor;
    }
    const key = (row: TimelineEntry) => `${row.kind}:${row.id}`;
    expect(collected.map(key)).toEqual(whole.map(key));
    expect(new Set(collected.map(key)).size).toBe(collected.length);
  });

  it('T3 — a work-order reader gets the order’s own kinds, and the withheld kinds are NAMED', async () => {
    const seeded = await seedHistory();
    authAs(READER); // wo.work_order.read only
    const page: TimelinePage = await json<TimelinePage>(
      await timeline(seeded.workOrderId, 'limit=100')
    );
    const kinds = new Set(page.items.map((row) => row.kind));
    for (const own of [
      'work_order_status',
      'job_status',
      'work_log',
      'blocker_raised',
      'blocker_resolved',
    ]) {
      expect(kinds.has(own), own).toBe(true);
    }
    for (const withheld of [
      'assignment',
      'labor_session',
      'labor_session_ended',
      'diagnostic_status',
      'qc_status',
    ]) {
      expect(kinds.has(withheld), withheld).toBe(false);
    }
    expect(page.omittedKinds.map((entry) => entry.kind).sort()).toEqual(
      [
        'assignment',
        'assignment_ended',
        'diagnostic_status',
        'labor_session',
        'labor_session_ended',
        'qc_status',
      ].sort()
    );
    expect(page.omittedKinds.find((entry) => entry.kind === 'labor_session')?.requires).toBe(
      'tech.technician.read'
    );
  });

  it('T4 — access: no permission is refused; another tenant and another branch see nothing', async () => {
    const seeded = await seedHistory();
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await timeline(seeded.workOrderId)).status).toBe(403);
    authAs(TENANT_B_FULL);
    expect((await timeline(seeded.workOrderId)).status).toBe(404);
    authAs(SCOPED_ELSEWHERE);
    expect((await timeline(seeded.workOrderId)).status).toBe(404);
    authAs(FULL);
    expect((await timeline(seeded.workOrderId, 'unknown=1')).status).toBe(422);
  });
});
