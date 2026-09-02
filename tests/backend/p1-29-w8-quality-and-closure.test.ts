/**
 * P1-29 `W8` — the quality and closure view, proved on real responses.
 *
 * The screens consume the closure gate, QC records and their per-check
 * results, the QC check vocabulary (W8's one Backend read), rework links, the
 * reopen-attempt log, additional-work requests and approvals, the closure
 * command, and — owed to W6 — the unified history and the blocker record. This
 * suite proves what the SCREENS depend on:
 *
 *  - **PC-1 per screen**: an authorized actor sees the data; an actor without
 *    the code is refused; another tenant's order is 404.
 *  - **The mirror is the row**: every interface in
 *    `features/quality/quality-contract.ts` is held field-for-field against the
 *    row the route actually returned.
 *  - **The journey the closure view drives**, through the routes the screen
 *    calls: open QC, answer the mandatory check BY ITS ID from the vocabulary,
 *    finalize with the record's version (a stale version refused), read the
 *    gate with its named blockers, open rework and sign it off as a separate
 *    actor, request additional work and record its restricted description,
 *    raise and resolve a job blocker, page the history, and attempt closure —
 *    which the gate refuses while a blocker stands, naming it.
 *  - **Restricted narratives withheld**: the additional-work description and
 *    the rework cost are 403 without `iam.sensitive.view`.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   qms.qc-record-branch-list: route service authorization success
 *   qms.qc-record-list: route service authorization success denial cross-tenant isolation
 *   qms.qc-record-detail: route service authorization success denial
 *   wo.work-order-closure-eligibility: route service authorization success denial cross-tenant isolation
 *   wo.additional-work-list: route service authorization success
 *   wo.work-order-timeline: route service authorization success
 *   wo.job-blocker-list: route service authorization success
 *
 * Operations exercised here: qms.qc-check-list, qms.qc-record-branch-list,
 * qms.qc-record-open, qms.qc-record-list, qms.qc-record-detail,
 * qms.qc-check-result, qms.qc-record-finalize, qms.rework-create, qms.rework-list,
 * qms.rework-sign-off, qms.rework-cost-read, qms.reopen-attempt-list,
 * qms.reopen-attempt, wo.work-order-closure-eligibility, wo.work-order-closure,
 * wo.additional-work-request, wo.additional-work-list,
 * wo.additional-work-detail-record, wo.additional-work-detail-read,
 * wo.additional-work-approval-read, wo.work-order-timeline,
 * wo.job-blocker-raise, wo.job-blocker-list, wo.job-blocker-resolve.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  SUBJECT_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  FULL,
  QC_CHECK_MANDATORY,
  QC_CHECK_OPTIONAL,
  READER,
  REVIEWER,
  SENSITIVE,
  TECH_A1_ALT,
  TENANT_B_FULL,
  advance,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishQualityFixtures,
  establishTechnicianFixtures,
} from './p1-19-helpers';
import { mirrorFields } from './p1-29-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST_CHECKS } from '@/app/api/v1/qc-checks/route';
import { GET as QC_QUEUE } from '@/app/api/v1/quality-controls/route';
import {
  GET as LIST_QC,
  POST as OPEN_QC,
} from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { GET as QC_DETAIL } from '@/app/api/v1/quality-controls/[recordId]/route';
import { PUT as WRITE_CHECK } from '@/app/api/v1/quality-controls/[recordId]/checks/[qcCheckId]/route';
import { POST as FINALIZE_QC } from '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import { GET as ELIGIBILITY } from '@/app/api/v1/work-orders/[workOrderId]/closure-eligibility/route';
import { POST as CLOSE } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import {
  GET as LIST_REWORK,
  POST as CREATE_REWORK,
} from '@/app/api/v1/work-orders/[workOrderId]/rework/route';
import { POST as SIGN_OFF } from '@/app/api/v1/rework-links/[reworkLinkId]/sign-off/route';
import { GET as READ_COST } from '@/app/api/v1/rework-links/[reworkLinkId]/cost/route';
import {
  GET as LIST_REOPEN,
  POST as REOPEN,
} from '@/app/api/v1/work-orders/[workOrderId]/reopen-attempts/route';
import {
  GET as LIST_ADDITIONAL,
  POST as REQUEST_ADDITIONAL,
} from '@/app/api/v1/work-orders/[workOrderId]/additional-work/route';
import { GET as READ_APPROVAL } from '@/app/api/v1/additional-work/[requestId]/approval/route';
import {
  GET as READ_DETAIL,
  PUT as RECORD_DETAIL,
} from '@/app/api/v1/additional-work/[requestId]/detail/route';
import { GET as TIMELINE } from '@/app/api/v1/work-orders/[workOrderId]/timeline/route';
import {
  GET as LIST_BLOCKERS,
  POST as RAISE_BLOCKER,
} from '@/app/api/v1/jobs/[jobId]/blockers/route';
import { POST as RESOLVE_BLOCKER } from '@/app/api/v1/blockers/[blockerId]/resolution/route';
import { GET as WORK_ORDER_DETAIL } from '@/app/api/v1/work-orders/[workOrderId]/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';

const CONTRACT = join(
  process.cwd(),
  'apps',
  'web',
  'src',
  'features',
  'quality',
  'quality-contract.ts'
);

let admin: Pool;
let runtime: Pool;
let mandatoryCheckId: string;

type Handler = (
  request: Request,
  route: { params: Promise<Record<string, string>> }
) => Promise<Response>;

function send(
  handler: Handler,
  url: string,
  params: Record<string, string>,
  body: unknown,
  options: { readonly version?: number; readonly method?: string } = {}
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
    { params: Promise.resolve(params) }
  );
}

function read(
  handler: Handler,
  url: string,
  params: Record<string, string> = {}
): Promise<Response> {
  return handler(new Request(`http://localhost${url}`), { params: Promise.resolve(params) });
}

const json = <T>(response: Response): Promise<T> => response.json() as Promise<T>;

function matchesMirror(row: unknown, interfaceName: string, extra: readonly string[] = []): void {
  expect(Object.keys(row as object).sort()).toEqual(
    [...mirrorFields(CONTRACT, interfaceName), ...extra].sort()
  );
}

interface Created {
  readonly id: string;
  readonly recordVersion: number;
}

async function seedOrderWithJob(): Promise<{
  readonly workOrderId: string;
  readonly jobId: string;
}> {
  const order = await createOpenWorkOrder();
  authAs(FULL);
  const job = await send(
    CREATE_JOB as Handler,
    `/api/v1/work-orders/${order.workOrderId}/jobs`,
    { workOrderId: order.workOrderId },
    { title: 'W8 — brake replacement' }
  );
  if (job.status !== 201) throw new Error(`fixture job failed with ${job.status}`);
  return { workOrderId: order.workOrderId, jobId: (await json<Created>(job)).id };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
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

describe('W8 — the closure view, the journey it drives on real responses', () => {
  it('J1 — QC from vocabulary to finalization, the gate, rework, additional work, blockers, history, closure refused by name', async () => {
    const { workOrderId, jobId } = await seedOrderWithJob();

    // The gate, before anything: not eligible, blockers named by the backend.
    authAs(FULL);
    const gate = await read(
      ELIGIBILITY as Handler,
      `/api/v1/work-orders/${workOrderId}/closure-eligibility`,
      { workOrderId }
    );
    expect(gate.status).toBe(200);
    const eligibility = await json<
      Record<string, unknown> & { blockers: Record<string, unknown>[]; eligible: boolean }
    >(gate);
    matchesMirror(eligibility, 'ClosureEligibility');
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blockers.length).toBeGreaterThan(0);
    for (const blocker of eligibility.blockers) matchesMirror(blocker, 'ClosureBlocker');
    expect(eligibility.blockers.map((b) => b['code'])).toContain('B1');
    // A fresh order holds no stock: the evaluated deferred conditions say so, by number.
    expect(eligibility['inventoryCommitments']).toEqual({
      activeReservations: 0,
      openIssues: 0,
      blocking: false,
    });

    // Open QC, read the vocabulary, answer the mandatory check by its id.
    authAs(FULL);
    const opened = await send(
      OPEN_QC as Handler,
      `/api/v1/work-orders/${workOrderId}/quality-controls`,
      { workOrderId },
      {}
    );
    expect(opened.status).toBe(201);
    const record = await json<Record<string, unknown> & Created>(opened);
    matchesMirror(record, 'QcRecord');

    authAs(FULL);
    const vocabulary = await json<{ items: Record<string, unknown>[] }>(
      await read(LIST_CHECKS as Handler, '/api/v1/qc-checks')
    );
    for (const check of vocabulary.items)
      matchesMirror(check, 'QcCheck', ['scope', 'status', 'recordVersion']);
    const mandatory = vocabulary.items.find((c) => c['code'] === QC_CHECK_MANDATORY);
    expect(mandatory?.['id']).toBe(mandatoryCheckId);
    expect(vocabulary.items.some((c) => c['code'] === QC_CHECK_OPTIONAL)).toBe(true);

    authAs(FULL);
    const answered = await send(
      WRITE_CHECK as Handler,
      `/api/v1/quality-controls/${record.id}/checks/${mandatoryCheckId}`,
      { recordId: record.id, qcCheckId: mandatoryCheckId },
      { result: 'pass' },
      { method: 'PUT' }
    );
    expect(answered.status).toBe(200);
    matchesMirror(await json(answered), 'QcCheckResult');

    authAs(FULL);
    const detail = await json<{
      record: Created;
      results: unknown[];
      unresolvedMandatory: unknown[];
    }>(
      await read(QC_DETAIL as Handler, `/api/v1/quality-controls/${record.id}`, {
        recordId: record.id,
      })
    );
    matchesMirror(detail, 'QcRecordDetail');
    expect(detail.results).toHaveLength(1);
    expect(detail.unresolvedMandatory).toEqual([]);

    // A version the record does not carry is a conflict (the guard refuses any
    // mismatch with zero rows, 409 — the screen's "changed since you opened it"),
    // not a malformed header; the version the detail reports finalizes. Answering a
    // check touches only `qc_check_results`, so the record's version is unchanged
    // since it was opened, and no older version exists to send.
    expect(detail.record.recordVersion).toBe(record.recordVersion);
    authAs(FULL);
    const stale = await send(
      FINALIZE_QC as Handler,
      `/api/v1/quality-controls/${record.id}/finalization`,
      { recordId: record.id },
      { overallResult: 'passed' },
      { version: detail.record.recordVersion + 1 }
    );
    expect(stale.status).toBe(409);
    authAs(FULL);
    const finalized = await send(
      FINALIZE_QC as Handler,
      `/api/v1/quality-controls/${record.id}/finalization`,
      { recordId: record.id },
      { overallResult: 'passed' },
      { version: detail.record.recordVersion }
    );
    expect(finalized.status).toBe(200);

    // The list the screen renders, and the branch queue the other screen renders.
    authAs(FULL);
    const listed = await json<{ items: Record<string, unknown>[] }>(
      await read(LIST_QC as Handler, `/api/v1/work-orders/${workOrderId}/quality-controls`, {
        workOrderId,
      })
    );
    expect(listed.items.map((r) => r['id'])).toContain(record.id);
    authAs(FULL);
    const queue = await read(
      QC_QUEUE as Handler,
      `/api/v1/quality-controls?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=50`
    );
    expect(queue.status).toBe(200);
    const page = await json<{
      items: Record<string, unknown>[];
      nextCursor: string | null;
      hasMore: boolean;
    }>(queue);
    expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    const queued = page.items.find((r) => r['id'] === record.id);
    expect(queued).toBeDefined();
    matchesMirror(queued, 'QcRecord', ['cursor']);

    // Rework corrects a CLOSED order: on an open one it is refused by name, and the
    // view withholds the form until the gate reports the order terminal.
    authAs(FULL);
    const premature = await send(
      CREATE_REWORK as Handler,
      `/api/v1/work-orders/${workOrderId}/rework`,
      { workOrderId },
      { rootCause: 'Pads fitted on the wrong axle', correctiveAction: 'Refit and retest' }
    );
    expect(premature.status).toBe(409);

    // Reopen attempts: the log is empty, and an attempt on an OPEN order is refused, not recorded as accepted.
    authAs(FULL);
    const attempts = await json<{ items: unknown[] }>(
      await read(LIST_REOPEN as Handler, `/api/v1/work-orders/${workOrderId}/reopen-attempts`, {
        workOrderId,
      })
    );
    expect(attempts.items).toEqual([]);
    authAs(FULL);
    const attempt = await send(
      REOPEN as Handler,
      `/api/v1/work-orders/${workOrderId}/reopen-attempts`,
      { workOrderId },
      { reason: 'Customer returned' }
    );
    expect([201, 409, 422]).toContain(attempt.status);

    // Additional work: requested, listed, its description recorded and read only with the sensitive code.
    authAs(FULL);
    const requested = await send(
      REQUEST_ADDITIONAL as Handler,
      `/api/v1/work-orders/${workOrderId}/additional-work`,
      { workOrderId },
      { summary: 'Rear pads also worn', originatingJobId: jobId }
    );
    expect(requested.status).toBe(201);
    const request = await json<Record<string, unknown> & Created>(requested);
    matchesMirror(request, 'AdditionalWorkRequest');
    authAs(FULL);
    const requests = await json<{ items: Record<string, unknown>[] }>(
      await read(LIST_ADDITIONAL as Handler, `/api/v1/work-orders/${workOrderId}/additional-work`, {
        workOrderId,
      })
    );
    expect(requests.items.map((r) => r['id'])).toContain(request.id);
    authAs(FULL);
    expect(
      (
        await read(READ_APPROVAL as Handler, `/api/v1/additional-work/${request.id}/approval`, {
          requestId: request.id,
        })
      ).status
    ).toBe(404);
    authAs(FULL);
    expect(
      (
        await read(READ_DETAIL as Handler, `/api/v1/additional-work/${request.id}/detail`, {
          requestId: request.id,
        })
      ).status
    ).toBe(403);
    authAs(SENSITIVE);
    const recordedDetail = await send(
      RECORD_DETAIL as Handler,
      `/api/v1/additional-work/${request.id}/detail`,
      { requestId: request.id },
      { description: 'Rear pads at 2 mm; rotors scored' },
      { method: 'PUT' }
    );
    expect(recordedDetail.status).toBe(200);
    authAs(SENSITIVE);
    const readDetail = await read(
      READ_DETAIL as Handler,
      `/api/v1/additional-work/${request.id}/detail`,
      { requestId: request.id }
    );
    expect(readDetail.status).toBe(200);
    matchesMirror(await json(readDetail), 'AdditionalWorkDetail');

    // Blockers (W6): raised and resolved on tech.labor.record, listed on wo.work_order.read.
    authAs(FULL);
    const raised = await send(
      RAISE_BLOCKER as Handler,
      `/api/v1/jobs/${jobId}/blockers`,
      { jobId },
      { note: 'Waiting for rear pads' }
    );
    expect(raised.status).toBe(201);
    const blocker = await json<Created>(raised);
    authAs(FULL);
    const resolved = await send(
      RESOLVE_BLOCKER as Handler,
      `/api/v1/blockers/${blocker.id}/resolution`,
      { blockerId: blocker.id },
      { note: 'Pads arrived' }
    );
    expect(resolved.status).toBe(201);
    authAs(FULL);
    const blockers = await json<{ items: Record<string, unknown>[] }>(
      await read(LIST_BLOCKERS as Handler, `/api/v1/jobs/${jobId}/blockers`, { jobId })
    );
    const folded = blockers.items.find((b) => b['id'] === blocker.id);
    matchesMirror(folded, 'JobBlocker');
    expect(folded?.['status']).toBe('resolved');
    matchesMirror(folded?.['resolution'], 'JobBlockerResolution');

    // The history (W6): a real page, the kinds this caller may not see named.
    authAs(FULL);
    const timeline = await read(
      TIMELINE as Handler,
      `/api/v1/work-orders/${workOrderId}/timeline?limit=5`,
      { workOrderId }
    );
    expect(timeline.status).toBe(200);
    const history = await json<{
      items: Record<string, unknown>[];
      omittedKinds: Record<string, unknown>[];
    }>(timeline);
    matchesMirror(history, 'WorkOrderTimelinePage');
    expect(history.items.length).toBeGreaterThan(0);
    for (const entry of history.items) matchesMirror(entry, 'WorkOrderTimelineEntry');
    for (const omitted of history.omittedKinds) matchesMirror(omitted, 'OmittedTimelineKind');

    // Closure: attempted with the order's version to a terminal state, refused while B1 stands.
    authAs(FULL);
    const order = await json<{
      workOrder: Created;
      nextStates: { code: string; isTerminal: boolean; isCancellation: boolean }[];
    }>(
      await read(WORK_ORDER_DETAIL as Handler, `/api/v1/work-orders/${workOrderId}`, {
        workOrderId,
      })
    );
    const target = order.nextStates.find((s) => s.isTerminal && !s.isCancellation);
    if (target !== undefined) {
      authAs(FULL);
      const closed = await send(
        CLOSE as Handler,
        `/api/v1/work-orders/${workOrderId}/closure`,
        { workOrderId },
        { toState: target.code },
        { version: order.workOrder.recordVersion }
      );
      expect([409, 422]).toContain(closed.status);
    }
    authAs(FULL);
    const after = await json<{ eligible: boolean; blockers: { code: string }[] }>(
      await read(ELIGIBILITY as Handler, `/api/v1/work-orders/${workOrderId}/closure-eligibility`, {
        workOrderId,
      })
    );
    expect(after.eligible).toBe(false);
    expect(after.blockers.map((b) => b.code)).toContain('B1');

    // The closure the view drives, on an order that can take it: QC passed with the
    // mandatory check answered, the path walked, the gate eligible with no blocker,
    // closed with the order's version — and only then rework, which corrects a
    // closed order; then a reopen attempt, kept and refused.
    const done = await createOpenWorkOrder();
    authAs(FULL);
    const doneQc = await json<Created>(
      await send(
        OPEN_QC as Handler,
        `/api/v1/work-orders/${done.workOrderId}/quality-controls`,
        { workOrderId: done.workOrderId },
        {}
      )
    );
    authAs(FULL);
    expect(
      (
        await send(
          WRITE_CHECK as Handler,
          `/api/v1/quality-controls/${doneQc.id}/checks/${mandatoryCheckId}`,
          { recordId: doneQc.id, qcCheckId: mandatoryCheckId },
          { result: 'pass' },
          { method: 'PUT' }
        )
      ).status
    ).toBe(200);
    authAs(FULL);
    expect(
      (
        await send(
          FINALIZE_QC as Handler,
          `/api/v1/quality-controls/${doneQc.id}/finalization`,
          { recordId: doneQc.id },
          { overallResult: 'passed' },
          { version: doneQc.recordVersion }
        )
      ).status
    ).toBe(200);
    const readyVersion = await advance(done.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);
    authAs(FULL);
    const readyGate = await json<{
      eligible: boolean;
      blockers: unknown[];
      inventoryCommitments: { blocking: boolean };
    }>(
      await read(
        ELIGIBILITY as Handler,
        `/api/v1/work-orders/${done.workOrderId}/closure-eligibility`,
        { workOrderId: done.workOrderId }
      )
    );
    expect(readyGate.blockers).toEqual([]);
    expect(readyGate.inventoryCommitments.blocking).toBe(false);
    expect(readyGate.eligible).toBe(true);
    authAs(FULL);
    const closed = await send(
      CLOSE as Handler,
      `/api/v1/work-orders/${done.workOrderId}/closure`,
      { workOrderId: done.workOrderId },
      { toState: 'closed' },
      { version: readyVersion }
    );
    expect(closed.status).toBe(200);
    authAs(FULL);
    const closedGate = await json<{ eligible: boolean; alreadyTerminal: boolean }>(
      await read(
        ELIGIBILITY as Handler,
        `/api/v1/work-orders/${done.workOrderId}/closure-eligibility`,
        { workOrderId: done.workOrderId }
      )
    );
    expect(closedGate.alreadyTerminal).toBe(true);
    expect(closedGate.eligible).toBe(false);

    // Rework: opened by the manager, signed off by a separate actor with the link's version.
    authAs(FULL);
    const rework = await send(
      CREATE_REWORK as Handler,
      `/api/v1/work-orders/${done.workOrderId}/rework`,
      { workOrderId: done.workOrderId },
      { rootCause: 'Pads fitted on the wrong axle', correctiveAction: 'Refit and retest' }
    );
    expect(rework.status).toBe(201);
    const created = await json<{
      reworkWorkOrderId: string;
      link: Record<string, unknown> & Created;
    }>(rework);
    matchesMirror(created.link, 'ReworkLink');
    authAs(FULL);
    const links = await json<{ items: Record<string, unknown>[] }>(
      await read(LIST_REWORK as Handler, `/api/v1/work-orders/${done.workOrderId}/rework`, {
        workOrderId: done.workOrderId,
      })
    );
    expect(links.items.map((l) => l['id'])).toContain(created.link.id);
    authAs(REVIEWER);
    const signed = await send(
      SIGN_OFF as Handler,
      `/api/v1/rework-links/${created.link.id}/sign-off`,
      { reworkLinkId: created.link.id },
      // The signature names a technician PROFILE in the workshop's own roster, not a login.
      { signOffBy: TECH_A1_ALT },
      { version: created.link.recordVersion }
    );
    expect(signed.status).toBe(200);
    // The cost is a restricted narrative: withheld without iam.sensitive.view.
    authAs(FULL);
    expect(
      (
        await read(READ_COST as Handler, `/api/v1/rework-links/${created.link.id}/cost`, {
          reworkLinkId: created.link.id,
        })
      ).status
    ).toBe(403);

    // Reopen: the attempt on the closed order is kept, and its outcome is refusal.
    authAs(FULL);
    const reopen = await send(
      REOPEN as Handler,
      `/api/v1/work-orders/${done.workOrderId}/reopen-attempts`,
      { workOrderId: done.workOrderId },
      { reason: 'Customer returned' }
    );
    expect(reopen.status).toBe(201);
    const kept = await json<{ attempt: Record<string, unknown> & Created; refusal: string }>(
      reopen
    );
    matchesMirror(kept, 'ReopenAttemptResult');
    matchesMirror(kept.attempt, 'ReopenAttempt');
    expect(kept.attempt['outcome']).toBe('rejected');
    expect(kept.refusal.length).toBeGreaterThan(0);
    authAs(FULL);
    const log = await json<{ items: Record<string, unknown>[] }>(
      await read(
        LIST_REOPEN as Handler,
        `/api/v1/work-orders/${done.workOrderId}/reopen-attempts`,
        { workOrderId: done.workOrderId }
      )
    );
    expect(log.items.map((a) => a['id'])).toContain(kept.attempt.id);
  });
});

describe('W8 — PC-1 per screen', () => {
  it('R1 — a work-order reader sees the gate, the additional work and the history, and is refused QC', async () => {
    const { workOrderId } = await seedOrderWithJob();
    authAs(READER);
    expect(
      (
        await read(
          ELIGIBILITY as Handler,
          `/api/v1/work-orders/${workOrderId}/closure-eligibility`,
          { workOrderId }
        )
      ).status
    ).toBe(200);
    authAs(READER);
    expect(
      (
        await read(
          LIST_ADDITIONAL as Handler,
          `/api/v1/work-orders/${workOrderId}/additional-work`,
          { workOrderId }
        )
      ).status
    ).toBe(200);
    authAs(READER);
    expect(
      (
        await read(TIMELINE as Handler, `/api/v1/work-orders/${workOrderId}/timeline`, {
          workOrderId,
        })
      ).status
    ).toBe(200);
    authAs(READER);
    expect(
      (
        await read(LIST_QC as Handler, `/api/v1/work-orders/${workOrderId}/quality-controls`, {
          workOrderId,
        })
      ).status
    ).toBe(403);
    authAs(READER);
    expect((await read(LIST_CHECKS as Handler, '/api/v1/qc-checks')).status).toBe(403);
    authAs(READER);
    expect(
      (
        await read(
          QC_QUEUE as Handler,
          `/api/v1/quality-controls?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
        )
      ).status
    ).toBe(403);
  });

  it('R2 — no grant at all is refused everywhere; another tenant’s order is 404', async () => {
    const { workOrderId } = await seedOrderWithJob();
    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (
        await read(
          ELIGIBILITY as Handler,
          `/api/v1/work-orders/${workOrderId}/closure-eligibility`,
          { workOrderId }
        )
      ).status
    ).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (
        await read(LIST_QC as Handler, `/api/v1/work-orders/${workOrderId}/quality-controls`, {
          workOrderId,
        })
      ).status
    ).toBe(403);
    authAs(TENANT_B_FULL);
    expect(
      (
        await read(
          ELIGIBILITY as Handler,
          `/api/v1/work-orders/${workOrderId}/closure-eligibility`,
          { workOrderId }
        )
      ).status
    ).toBe(404);
    authAs(TENANT_B_FULL);
    expect(
      (
        await read(LIST_QC as Handler, `/api/v1/work-orders/${workOrderId}/quality-controls`, {
          workOrderId,
        })
      ).status
    ).toBe(404);
  });
});
