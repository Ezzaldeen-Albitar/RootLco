/**
 * The complete P1-19 backend journey (Phase 1-19, Wave 9, P1-19-QA-001).
 *
 * ONE work order, driven end to end through the REAL shipped routes — no admin SQL on
 * any step a route exists for, and no fixture shortcut past a guard.
 *
 * Reception conversion → work-order transition → job creation → technician eligibility
 * → assignment → labour start/pause/resume/stop → diagnostic report → measurement, DTC,
 * finding, evidence → diagnostic completion → recommendation → additional-work request
 * → customer approval → execution gate cleared → fulfilment → job completion → quality
 * control → closure eligibility → closure → reopen refusal → rework case → independent
 * sign-off → rework resolution.
 *
 * ## Why this exists when every wave already has its own suite
 *
 * Each wave proves its own operations in isolation, with fixtures that put the world
 * into the state that operation needs. That is the right shape for finding defects in
 * an operation, and it is exactly the shape that cannot find a defect BETWEEN two
 * operations — a state one wave leaves behind that the next cannot consume, a blocker
 * that never clears because nothing clears it, an ordering that only works when a
 * fixture arranges it.
 *
 * So this file arranges almost nothing. It starts from a reception visit and asks
 * whether the shipped surface can actually get a vehicle through a workshop. Every
 * assertion along the way is about the handover, not about the operation.
 *
 * The two places it does use admin SQL are the ones with no write route in this phase
 * and are labelled: the technician roster and the diagnostic/QC catalogs, which are
 * operator configuration P1-19 only reads.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  FULL,
  ITEM_BRAKE_THICKNESS,
  ITEM_TYRE_CONDITION,
  REVIEWER,
  SENSITIVE,
  SPLIT_WINDOW,
  TECH_A1,
  TECH_A1_ALT,
  advance,
  auditCount,
  authAs,
  count,
  createOpenWorkOrder,
  establishDiagnosticFixtures,
  establishP1_19Fixtures,
  establishQualityFixtures,
  establishTechnicianFixtures,
  outboxCount,
  partyRoleFor,
  readJob,
  readWorkOrder,
  seedDocumentVersion,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as TRANSITION_JOB } from '@/app/api/v1/jobs/[jobId]/transition/route';
import { POST as ASSIGN } from '@/app/api/v1/jobs/[jobId]/assignments/route';
import { POST as START_LABOUR } from '@/app/api/v1/jobs/[jobId]/labor-sessions/route';
import { POST as STOP_LABOUR } from '@/app/api/v1/labor-sessions/[sessionId]/stop/route';
import { POST as CREATE_REPORT } from '@/app/api/v1/jobs/[jobId]/inspections/route';
import { POST as MOVE_REPORT } from '@/app/api/v1/inspections/[inspectionId]/transition/route';
import { PUT as WRITE_ITEM } from '@/app/api/v1/inspections/[inspectionId]/items/[templateItemId]/route';
import { POST as RECORD_MEASUREMENT } from '@/app/api/v1/inspections/[inspectionId]/measurements/route';
import { POST as RECORD_DTC } from '@/app/api/v1/inspections/[inspectionId]/dtcs/route';
import { POST as RECORD_FINDING } from '@/app/api/v1/inspections/[inspectionId]/findings/route';
import { POST as RECORD_DIA_EVIDENCE } from '@/app/api/v1/inspections/[inspectionId]/evidence/route';
import { POST as COMPLETE_REPORT } from '@/app/api/v1/inspections/[inspectionId]/completion/route';
import { POST as RECORD_RECOMMENDATION } from '@/app/api/v1/inspections/[inspectionId]/recommendations/route';
import { POST as REVIEW_REPORT } from '@/app/api/v1/inspections/[inspectionId]/reviews/route';
import { POST as RAISE_ADDITIONAL_WORK } from '@/app/api/v1/work-orders/[workOrderId]/additional-work/route';
import { PUT as WRITE_DETAIL } from '@/app/api/v1/additional-work/[requestId]/detail/route';
import { POST as RECORD_APPROVAL } from '@/app/api/v1/additional-work/[requestId]/approval/route';
import { POST as SET_FULFILLMENT } from '@/app/api/v1/additional-work/[requestId]/fulfillment/route';
import { POST as OPEN_QC } from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { PUT as WRITE_CHECK } from '@/app/api/v1/quality-controls/[recordId]/checks/[qcCheckId]/route';
import { POST as FINALIZE_QC } from '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import { GET as CLOSURE_ELIGIBILITY } from '@/app/api/v1/work-orders/[workOrderId]/closure-eligibility/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { POST as ATTEMPT_REOPEN } from '@/app/api/v1/work-orders/[workOrderId]/reopen-attempts/route';
import { POST as CREATE_REWORK } from '@/app/api/v1/work-orders/[workOrderId]/rework/route';
import { POST as SIGN_OFF } from '@/app/api/v1/rework-links/[reworkLinkId]/sign-off/route';

let admin: Pool;
let runtime: Pool;
let templateVersionId: string;
let itemIds: ReadonlyMap<string, string>;
let mandatoryCheckId: string;

function call(
  handler: unknown,
  url: string,
  params: Record<string, string>,
  body?: unknown,
  options: { readonly version?: number; readonly method?: string } = {}
): Promise<Response> {
  const fn = handler as (
    request: Request,
    route: { params: Promise<Record<string, string>> }
  ) => Promise<Response>;
  if (body === undefined) {
    return fn(new Request(`http://localhost${url}`), { params: Promise.resolve(params) });
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
  if (options.version !== undefined) headers['if-match'] = String(options.version);
  return fn(
    new Request(`http://localhost${url}`, {
      method: options.method ?? 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
}

/** Sends a request as a principal and fails loudly with the body if it is refused. */
async function step<T>(
  label: string,
  principal: typeof FULL,
  expected: number,
  send: () => Promise<Response>
): Promise<T> {
  authAs(principal);
  const response = await send();
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected ${expected}, got ${response.status} — ${await response.text()}`
    );
  }
  return (await response.json()) as T;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  // Operator configuration with no write route in this phase: the technician roster,
  // the diagnostic template catalog and the QC check catalog. P1-19 only reads them.
  await establishTechnicianFixtures();
  const diagnostics = await establishDiagnosticFixtures();
  templateVersionId = diagnostics.templateVersionId;
  itemIds = diagnostics.itemIds;
  mandatoryCheckId = (await establishQualityFixtures()).mandatoryId;
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

describe('the complete P1-19 backend journey', () => {
  it('takes one vehicle from reception conversion to a signed-off rework, through real routes', async () => {
    // --- Reception conversion opens the shell -------------------------------
    // Not inserted: `createOpenWorkOrder` drives the P1-18 conversion route and then
    // the P1-19 transition route. The order arrives in `draft`, which is where the
    // shipped conversion leaves it.
    const order = await createOpenWorkOrder();
    expect((await readWorkOrder(order.workOrderId))?.state).toBe('open');

    // --- A job, and the technician who may take it --------------------------
    const job = await step<{ id: string; recordVersion: number }>('create job', FULL, 201, () =>
      call(
        CREATE_JOB,
        `/api/v1/work-orders/${order.workOrderId}/jobs`,
        {
          workOrderId: order.workOrderId,
        },
        { title: 'Front brake overhaul', requiresDiagnostic: true }
      )
    );

    await step('assign technician', FULL, 201, () =>
      call(
        ASSIGN,
        `/api/v1/jobs/${job.id}/assignments`,
        { jobId: job.id },
        {
          technicianProfileId: TECH_A1,
          window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
        }
      )
    );

    // `planned → assigned` is a configured, reason-free edge that STILL fails without
    // an active assignment: the assignments migration replaced
    // `wo.guard_job_transition` to require one. So the order of these two steps is
    // itself part of the contract.
    let jobVersion = (await readJob(job.id))?.version ?? 0;
    const assigned = await step<{ recordVersion: number }>('job → assigned', FULL, 200, () =>
      call(
        TRANSITION_JOB,
        `/api/v1/jobs/${job.id}/transition`,
        { jobId: job.id },
        { toState: 'assigned' },
        { version: jobVersion }
      )
    );
    jobVersion = assigned.recordVersion;

    const started = await step<{ recordVersion: number }>('job → in_progress', FULL, 200, () =>
      call(
        TRANSITION_JOB,
        `/api/v1/jobs/${job.id}/transition`,
        { jobId: job.id },
        { toState: 'in_progress' },
        { version: jobVersion }
      )
    );
    jobVersion = started.recordVersion;

    // --- Labour: start, pause, resume, stop ---------------------------------
    const session = await step<{ id: string; recordVersion: number }>(
      'start labour',
      FULL,
      201,
      () =>
        call(
          START_LABOUR,
          `/api/v1/jobs/${job.id}/labor-sessions`,
          { jobId: job.id },
          {
            technicianProfileId: TECH_A1,
          }
        )
    );
    // A PAUSE is stopping the session plus a job transition into `paused`, because
    // `tech.labor_sessions` has no pause column — so the pause REASON lives in
    // `wo.job_status_history`. Two requests because they are two facts.
    await step('stop labour for the pause', FULL, 200, () =>
      call(
        STOP_LABOUR,
        `/api/v1/labor-sessions/${session.id}/stop`,
        { sessionId: session.id },
        {},
        { version: session.recordVersion }
      )
    );
    const paused = await step<{ recordVersion: number }>('job → paused', FULL, 200, () =>
      call(
        TRANSITION_JOB,
        `/api/v1/jobs/${job.id}/transition`,
        { jobId: job.id },
        { toState: 'paused', reason: 'Awaiting a diagnostic' },
        { version: jobVersion }
      )
    );
    jobVersion = paused.recordVersion;
    const resumed = await step<{ recordVersion: number }>(
      'job → in_progress (resume)',
      FULL,
      200,
      () =>
        call(
          TRANSITION_JOB,
          `/api/v1/jobs/${job.id}/transition`,
          { jobId: job.id },
          { toState: 'in_progress' },
          { version: jobVersion }
        )
    );
    jobVersion = resumed.recordVersion;
    const second = await step<{ id: string; recordVersion: number }>(
      'restart labour',
      FULL,
      201,
      () =>
        call(
          START_LABOUR,
          `/api/v1/jobs/${job.id}/labor-sessions`,
          { jobId: job.id },
          {
            technicianProfileId: TECH_A1,
          }
        )
    );

    // --- The diagnostic ------------------------------------------------------
    const report = await step<{ id: string; recordVersion: number }>(
      'open diagnostic',
      FULL,
      201,
      () =>
        call(
          CREATE_REPORT,
          `/api/v1/jobs/${job.id}/inspections`,
          { jobId: job.id },
          {
            templateVersionId,
          }
        )
    );
    const inProgress = await step<{ recordVersion: number }>(
      'diagnostic → in_progress',
      FULL,
      200,
      () =>
        call(
          MOVE_REPORT,
          `/api/v1/inspections/${report.id}/transition`,
          { inspectionId: report.id },
          { toStatus: 'in_progress' },
          { version: report.recordVersion }
        )
    );

    const measurement = await step<{ withinRange: boolean | null }>(
      'record measurement',
      FULL,
      201,
      () =>
        call(
          RECORD_MEASUREMENT,
          `/api/v1/inspections/${report.id}/measurements`,
          { inspectionId: report.id },
          {
            templateItemId: itemIds.get(ITEM_BRAKE_THICKNESS) ?? '',
            label: 'Front left disc',
            measuredValue: '19.500',
            unit: 'mm',
          }
        )
    );
    // Below the configured minimum, judged in the database as `numeric` — and RECORDED
    // rather than refused, which is the whole reason a diagnostic exists.
    expect(measurement.withinRange).toBe(false);

    await step('record DTC', FULL, 201, () =>
      call(
        RECORD_DTC,
        `/api/v1/inspections/${report.id}/dtcs`,
        { inspectionId: report.id },
        {
          code: 'C0035',
          description: 'Left front wheel speed sensor',
        }
      )
    );

    const finding = await step<{ id: string }>('record finding', FULL, 201, () =>
      call(
        RECORD_FINDING,
        `/api/v1/inspections/${report.id}/findings`,
        { inspectionId: report.id },
        {
          severity: 'high',
          disposition: 'repair_required',
          description: 'Front discs below minimum thickness',
        }
      )
    );

    const versionId = await seedDocumentVersion();
    await step('bind diagnostic evidence', FULL, 201, () =>
      call(
        RECORD_DIA_EVIDENCE,
        `/api/v1/inspections/${report.id}/evidence`,
        { inspectionId: report.id },
        { documentVersionId: versionId, evidenceType: 'photograph' }
      )
    );

    // Both mandatory items — one by value, one by a documented not-applicable reason —
    // because the completion gate counts either.
    await step('answer brake item', FULL, 200, () =>
      call(
        WRITE_ITEM,
        `/api/v1/inspections/${report.id}/items/${itemIds.get(ITEM_BRAKE_THICKNESS) ?? ''}`,
        { inspectionId: report.id, templateItemId: itemIds.get(ITEM_BRAKE_THICKNESS) ?? '' },
        { resultValue: '19.500' },
        { method: 'PUT' }
      )
    );
    await step('skip tyre item with a reason', FULL, 200, () =>
      call(
        WRITE_ITEM,
        `/api/v1/inspections/${report.id}/items/${itemIds.get(ITEM_TYRE_CONDITION) ?? ''}`,
        { inspectionId: report.id, templateItemId: itemIds.get(ITEM_TYRE_CONDITION) ?? '' },
        { notApplicableReason: 'Wheels off for the brake work' },
        { method: 'PUT' }
      )
    );

    // BEFORE completion, and the journey is what established that this ordering is
    // real rather than incidental: a recommendation is report CONTENT — the outcome
    // the diagnostic exists to produce — so it belongs in the report before the report
    // is declared finished. `assertRecordable` refuses it afterwards, which is the same
    // rule that stops a completed report acquiring new findings. A reviewer who wants
    // to say something later has `dia.diagnostic_reviews.notes`, which is a different
    // fact by a different person and is recorded as one.
    await step('record recommendation', FULL, 201, () =>
      call(
        RECORD_RECOMMENDATION,
        `/api/v1/inspections/${report.id}/recommendations`,
        { inspectionId: report.id },
        { recommendation: 'Replace front discs and pads', priority: 'high' }
      )
    );

    const completed = await step<{ status: string }>('complete diagnostic', FULL, 200, () =>
      call(
        COMPLETE_REPORT,
        `/api/v1/inspections/${report.id}/completion`,
        { inspectionId: report.id },
        { summary: 'Front discs below minimum; recommend replacement' },
        { version: inProgress.recordVersion }
      )
    );
    expect(completed.status).toBe('completed');
    expect(await outboxCount('diagnostic-report.completed', report.id)).toBe(1);

    // Reviewed by someone who did not create it — separation against `created_by`.
    await step('review diagnostic', REVIEWER, 201, () =>
      call(
        REVIEW_REPORT,
        `/api/v1/inspections/${report.id}/reviews`,
        { inspectionId: report.id },
        {
          reviewResult: 'approved',
        }
      )
    );

    // --- Additional work, and the execution gate ----------------------------
    // Raised from the FINDING alone: the originating job is derived from the finding's
    // report, which is what makes the gate apply to diagnostic-discovered work.
    const request = await step<{
      id: string;
      originatingJobId: string;
      recordVersion: number;
    }>('raise additional work', FULL, 201, () =>
      call(
        RAISE_ADDITIONAL_WORK,
        `/api/v1/work-orders/${order.workOrderId}/additional-work`,
        { workOrderId: order.workOrderId },
        { originatingFindingId: finding.id, summary: 'Replace front discs and pads' }
      )
    );
    expect(request.originatingJobId).toBe(job.id);

    await step('record the restricted description', SENSITIVE, 200, () =>
      call(
        WRITE_DETAIL,
        `/api/v1/additional-work/${request.id}/detail`,
        { requestId: request.id },
        { description: 'Quoted to the customer as a pair of discs plus pads and labour' },
        { method: 'PUT' }
      )
    );

    // The gate bites: a required pending request blocks the job re-entering a
    // labour-allowed state. Stop the session and pause first, so the refusal is about
    // the gate rather than about the graph.
    await step('stop labour before the gate', FULL, 200, () =>
      call(
        STOP_LABOUR,
        `/api/v1/labor-sessions/${second.id}/stop`,
        { sessionId: second.id },
        {},
        { version: second.recordVersion }
      )
    );
    const pausedAgain = await step<{ recordVersion: number }>(
      'job → paused for the customer',
      FULL,
      200,
      () =>
        call(
          TRANSITION_JOB,
          `/api/v1/jobs/${job.id}/transition`,
          { jobId: job.id },
          { toState: 'paused', reason: 'Awaiting the customer decision' },
          { version: jobVersion }
        )
    );
    jobVersion = pausedAgain.recordVersion;

    authAs(FULL);
    const gated = await call(
      TRANSITION_JOB,
      `/api/v1/jobs/${job.id}/transition`,
      { jobId: job.id },
      { toState: 'in_progress' },
      { version: jobVersion }
    );
    expect(gated.status).toBe(409);
    expect(((await gated.json()) as { code?: string }).code).toBe('ERR-WO-002');

    // The customer decides, on a party role from the order's own reception visit.
    const decided = await step<{ request: { state: string; recordVersion: number } }>(
      'record the approval',
      FULL,
      201,
      async () =>
        call(
          RECORD_APPROVAL,
          `/api/v1/additional-work/${request.id}/approval`,
          { requestId: request.id },
          {
            decision: 'approved',
            channel: 'phone',
            decidingPartyRoleId: await partyRoleFor(order.visitId),
            presentedScope: 'Front discs and pads, parts and labour',
          },
          { version: request.recordVersion }
        )
    );
    expect(decided.request.state).toBe('approved');

    // The gate is clear, and the job resumes.
    const resumedAfterApproval = await step<{ recordVersion: number }>(
      'job → in_progress after approval',
      FULL,
      200,
      () =>
        call(
          TRANSITION_JOB,
          `/api/v1/jobs/${job.id}/transition`,
          { jobId: job.id },
          { toState: 'in_progress' },
          { version: jobVersion }
        )
    );
    jobVersion = resumedAfterApproval.recordVersion;

    // The approved work is done. Without this, B3's second limb blocks closure for ever.
    await step('mark the approved work fulfilled', FULL, 200, () =>
      call(
        SET_FULFILLMENT,
        `/api/v1/additional-work/${request.id}/fulfillment`,
        { requestId: request.id },
        { fulfillmentState: 'fulfilled' },
        { version: decided.request.recordVersion }
      )
    );

    // --- Finish the job, then quality control -------------------------------
    await step('job → completed', FULL, 200, () =>
      call(
        TRANSITION_JOB,
        `/api/v1/jobs/${job.id}/transition`,
        { jobId: job.id },
        { toState: 'completed' },
        { version: jobVersion }
      )
    );

    const qc = await step<{ id: string; recordVersion: number }>('open QC', FULL, 201, () =>
      call(
        OPEN_QC,
        `/api/v1/work-orders/${order.workOrderId}/quality-controls`,
        {
          workOrderId: order.workOrderId,
        },
        {}
      )
    );
    await step('record the mandatory check', FULL, 200, () =>
      call(
        WRITE_CHECK,
        `/api/v1/quality-controls/${qc.id}/checks/${mandatoryCheckId}`,
        { recordId: qc.id, qcCheckId: mandatoryCheckId },
        { result: 'pass' },
        { method: 'PUT' }
      )
    );
    await step('finalize QC as passed', FULL, 200, () =>
      call(
        FINALIZE_QC,
        `/api/v1/quality-controls/${qc.id}/finalization`,
        { recordId: qc.id },
        { overallResult: 'passed' },
        { version: qc.recordVersion }
      )
    );

    // --- Closure -------------------------------------------------------------
    const version = await advance(order.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);

    const eligibility = await step<{ eligible: boolean; blockers: readonly unknown[] }>(
      'closure eligibility',
      FULL,
      200,
      () =>
        call(CLOSURE_ELIGIBILITY, `/api/v1/work-orders/${order.workOrderId}/closure-eligibility`, {
          workOrderId: order.workOrderId,
        })
    );
    // Every one of B1–B6 cleared by real work rather than by a fixture.
    expect(eligibility.blockers).toEqual([]);
    expect(eligibility.eligible).toBe(true);

    await step('close the work order', FULL, 200, () =>
      call(
        CLOSE_WORK_ORDER,
        `/api/v1/work-orders/${order.workOrderId}/closure`,
        { workOrderId: order.workOrderId },
        { toState: 'closed' },
        { version }
      )
    );
    expect(await outboxCount('work-order.closed', order.workOrderId)).toBe(1);

    // --- Reopen is refused, and the refusal is recorded ----------------------
    const closedState = await readWorkOrder(order.workOrderId);
    const attempt = await step<{ attempt: { outcome: string }; refusal: string }>(
      'attempt a reopen',
      FULL,
      201,
      () =>
        call(
          ATTEMPT_REOPEN,
          `/api/v1/work-orders/${order.workOrderId}/reopen-attempts`,
          { workOrderId: order.workOrderId },
          { reason: 'Customer reports a noise' }
        )
    );
    expect(attempt.attempt.outcome).toBe('rejected');
    // BR-WO-002 in the database, not in this code: the order did not move.
    expect(await readWorkOrder(order.workOrderId)).toEqual(closedState);

    // --- Rework corrects it by standing beside it ---------------------------
    const rework = await step<{
      reworkWorkOrderId: string;
      link: { id: string; recordVersion: number };
    }>('open a rework case', FULL, 201, () =>
      call(
        CREATE_REWORK,
        `/api/v1/work-orders/${order.workOrderId}/rework`,
        {
          workOrderId: order.workOrderId,
        },
        {
          rootCause: 'Discs replaced with the wrong specification',
          correctiveAction: 'Replace with the correct discs and re-test',
          responsibility: 'workshop',
          isSafetyCritical: true,
          leadTechnicianId: TECH_A1,
        }
      )
    );

    // The rework order is a real work order on the same visit, and it must be worked
    // and closed like any other — its own QC, and B6 on top.
    const reworkQc = await step<{ id: string; recordVersion: number }>(
      'open QC on the rework',
      FULL,
      201,
      () =>
        call(
          OPEN_QC,
          `/api/v1/work-orders/${rework.reworkWorkOrderId}/quality-controls`,
          {
            workOrderId: rework.reworkWorkOrderId,
          },
          {}
        )
    );
    await step('finalize the rework QC', FULL, 200, () =>
      call(
        FINALIZE_QC,
        `/api/v1/quality-controls/${reworkQc.id}/finalization`,
        { recordId: reworkQc.id },
        { overallResult: 'passed' },
        { version: reworkQc.recordVersion }
      )
    );
    const reworkVersion = await advance(rework.reworkWorkOrderId, [
      { toState: 'open' },
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);

    authAs(FULL);
    const blockedByB6 = await call(
      CLOSE_WORK_ORDER,
      `/api/v1/work-orders/${rework.reworkWorkOrderId}/closure`,
      { workOrderId: rework.reworkWorkOrderId },
      { toState: 'closed' },
      { version: reworkVersion }
    );
    expect(blockedByB6.status).toBe(409);
    const b6 = (await blockedByB6.json()) as {
      code?: string;
      violations?: readonly { path?: string }[];
    };
    expect(b6.code).toBe('ERR-WO-001');
    expect(b6.violations?.some((v) => v.path === 'closure.B6')).toBe(true);

    // Signed by a DIFFERENT technician — the CHECK, not this code.
    await step('independent sign-off', REVIEWER, 200, () =>
      call(
        SIGN_OFF,
        `/api/v1/rework-links/${rework.link.id}/sign-off`,
        { reworkLinkId: rework.link.id },
        { signOffBy: TECH_A1_ALT },
        { version: rework.link.recordVersion }
      )
    );

    // --- Rework resolution: the rework order closes --------------------------
    await step('close the rework work order', FULL, 200, () =>
      call(
        CLOSE_WORK_ORDER,
        `/api/v1/work-orders/${rework.reworkWorkOrderId}/closure`,
        { workOrderId: rework.reworkWorkOrderId },
        { toState: 'closed' },
        { version: reworkVersion }
      )
    );

    // --- What the journey left behind ---------------------------------------
    // Two closed work orders on ONE reception visit — the ordinary one and its rework —
    // which is exactly what `uq_work_orders_ordinary_origin` being partial on
    // `kind = 'ordinary'` exists to permit.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.work_orders
          WHERE reception_visit_id = (SELECT reception_visit_id FROM wo.work_orders WHERE id = $1)
            AND state = 'closed'`,
        [order.workOrderId]
      )
    ).toBe(2);
    // The original is untouched by the rework: one is `ordinary`, one is `rework`.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.work_orders WHERE id = $1 AND kind = 'ordinary'`,
        [order.workOrderId]
      )
    ).toBe(1);
    // Two labour sessions, both closed — the pause is a stop and a restart.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM tech.labor_sessions
          WHERE job_id = $1 AND ended_at IS NOT NULL AND deleted_at IS NULL`,
        [job.id]
      )
    ).toBe(2);
    // The refusal is on the record, and it is the only outcome the vocabulary has.
    expect(await auditCount('qms.work_order.reopen_refused', order.workOrderId)).toBe(1);
    // The closed order's own closure audit exists exactly once.
    expect(await auditCount('wo.work_order.closed', order.workOrderId)).toBe(1);
  }, 180_000);
});
