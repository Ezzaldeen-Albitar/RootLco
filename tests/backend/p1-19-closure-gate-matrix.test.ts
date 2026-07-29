/**
 * The closure gate, one blocker at a time (Phase 1-19, P1-19-QA-001).
 *
 * `wo.guard_work_order_closure` raises `check_violation` on the FIRST blocker it hits
 * and aborts, so a caller driven by the trigger alone learns about B1, fixes it,
 * retries, learns about B2, and so on. `GET /closure-eligibility` exists to answer the
 * whole question at once, which means it re-evaluates all six blockers independently in
 * a read-only path while the closure TRANSITION still relies on the trigger as the
 * authority.
 *
 * That design has a failure mode this suite exists to close: an eligibility check that
 * reports the union of "something is wrong" would pass every test written against an
 * order with one problem. So each case here arranges **exactly one** blocker on an
 * order that is otherwise fully clear, and asserts the endpoint names that blocker and
 * no other. Getting there means clearing the other five first — which is itself the
 * point, because B5b fires on every order in this tenant until a QC pass exists, and a
 * suite that never noticed would be reporting B5b as B1.
 *
 * ## What this suite does NOT do
 *
 * It does not prove each blocker is *clearable*. Some are raised and cleared in
 * different orders — a `requires_diagnostic` job that has been cancelled still demands
 * a completed report (B4 reads the job regardless of its state), and a report cannot
 * always be worked afterwards. Clearing all six in the legitimate sequence is
 * `p1-19-operational-journey.test.ts`, which drives one vehicle from reception to a
 * closed rework. This suite proves **reporting isolation**; that one proves resolution.
 *
 * ## B6 is on the rework order, not the original
 *
 * The guard's B6 predicate is `rl.rework_work_order_id = NEW.id` — it blocks the
 * closure of the REWORK order that lacks independent sign-off, not the original it
 * corrects. The original is already closed by the time a rework link can exist, so
 * reading B6 as a blocker on the original would be reading it backwards.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.work-order-closure-eligibility: route service authorization success denial cross-tenant isolation
 *   wo.work-order-closure: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency
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
  READER,
  TECH_A1,
  advance,
  authAs,
  SPLIT_WINDOW,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishQualityFixtures,
  establishTechnicianFixtures,
  readWorkOrder,
  transitionRequest,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { GET as ELIGIBILITY } from '@/app/api/v1/work-orders/[workOrderId]/closure-eligibility/route';
import { POST as ADD_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as JOB_TRANSITION } from '@/app/api/v1/jobs/[jobId]/transition/route';
import { POST as ASSIGN } from '@/app/api/v1/jobs/[jobId]/assignments/route';
import { POST as START_LABOR } from '@/app/api/v1/jobs/[jobId]/labor-sessions/route';
import { POST as REQUEST_WORK } from '@/app/api/v1/work-orders/[workOrderId]/additional-work/route';
import { POST as OPEN_QC } from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { POST as FINALIZE_QC } from '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import { POST as CREATE_REWORK } from '@/app/api/v1/work-orders/[workOrderId]/rework/route';

/** The path from `open` to the last state before closure. */
const TO_READY = [
  { toState: 'in_progress' },
  { toState: 'qc_pending' },
  { toState: 'ready_to_close' },
] as const;

let admin: Pool;
let runtime: Pool;

interface Blocker {
  readonly code: string;
  readonly enforcedBy: string;
}

interface Eligibility {
  readonly state: string;
  readonly eligible: boolean;
  readonly blockers: readonly Blocker[];
  readonly alreadyTerminal: boolean;
}

function send(
  handler: unknown,
  url: string,
  params: Record<string, string>,
  body: unknown,
  version?: number
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
  if (version !== undefined) headers['if-match'] = String(version);
  const call = handler as (
    request: Request,
    route: { params: Promise<Record<string, string>> }
  ) => Promise<Response>;
  return call(
    new Request(`http://localhost${url}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve(params) }
  );
}

async function expectOk<T>(label: string, response: Promise<Response>): Promise<T> {
  const settled = await response;
  if (settled.status !== 200 && settled.status !== 201) {
    throw new Error(`${label} failed with ${settled.status}: ${await settled.text()}`);
  }
  return (await settled.json()) as T;
}

/** Reads the eligibility report as a caller who may only read. */
async function eligibility(workOrderId: string): Promise<Eligibility> {
  authAs(READER);
  const call = ELIGIBILITY as (
    request: Request,
    route: { params: Promise<{ workOrderId: string }> }
  ) => Promise<Response>;
  const response = await call(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/closure-eligibility`),
    { params: Promise.resolve({ workOrderId }) }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Eligibility;
}

/** Attempts the real closure and returns the response. */
async function close(workOrderId: string, version: number): Promise<Response> {
  authAs(FULL);
  return send(
    CLOSE_WORK_ORDER,
    `/api/v1/work-orders/${workOrderId}/closure`,
    { workOrderId },
    { toState: 'closed' },
    version
  );
}

/** Clears B5b: a mandatory check is configured tenant-wide, so a pass is required. */
async function passQualityControl(workOrderId: string): Promise<void> {
  authAs(FULL);
  const record = await expectOk<{ id: string; recordVersion: number }>(
    'QC open',
    send(OPEN_QC, `/api/v1/work-orders/${workOrderId}/quality-controls`, { workOrderId }, {})
  );
  authAs(FULL);
  await expectOk(
    'QC finalize',
    send(
      FINALIZE_QC,
      `/api/v1/quality-controls/${record.id}/finalization`,
      { recordId: record.id },
      { overallResult: 'passed' },
      record.recordVersion
    )
  );
}

async function addJob(
  workOrderId: string,
  input: { readonly title: string; readonly requiresDiagnostic?: boolean }
): Promise<{ readonly id: string; readonly recordVersion: number }> {
  authAs(FULL);
  return expectOk<{ id: string; recordVersion: number }>(
    'job create',
    send(ADD_JOB, `/api/v1/work-orders/${workOrderId}/jobs`, { workOrderId }, input)
  );
}

/** Moves a job to a terminal state so it stops holding B1. */
async function cancelJob(jobId: string, version: number): Promise<void> {
  authAs(FULL);
  await expectOk(
    'job cancel',
    send(
      JOB_TRANSITION,
      `/api/v1/jobs/${jobId}/transition`,
      { jobId },
      { toState: 'cancelled', reason: 'closure-gate matrix fixture' },
      version
    )
  );
}

/**
 * An order at `ready_to_close` with all six blockers clear.
 *
 * Every case starts from this, adds ONE condition, and asserts the report. Building it
 * needs only the QC pass — a bare converted order has no jobs, no labour, no additional
 * work and no rework, so B1, B2, B3, B4 and B6 are vacuously clear and only B5b bites.
 */
async function clearOrder(): Promise<{ readonly workOrderId: string; readonly version: number }> {
  const order = await createOpenWorkOrder();
  await passQualityControl(order.workOrderId);
  const version = await advance(order.workOrderId, [...TO_READY]);
  return { workOrderId: order.workOrderId, version };
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  await ensureBackendFixtures(admin);
  await ensureTestLogins(admin);
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  await establishQualityFixtures();
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  await cleanBackendFixtures(admin);
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.end();
});

describe('P1-19 / the closure gate reports each blocker in isolation', () => {
  it('the baseline order closes, so every later refusal is the condition added and not the fixture', async () => {
    const order = await clearOrder();

    const report = await eligibility(order.workOrderId);
    expect(report.state).toBe('ready_to_close');
    expect(report.eligible).toBe(true);
    expect(report.blockers).toEqual([]);

    expect((await close(order.workOrderId, order.version)).status).toBe(200);
    expect((await readWorkOrder(order.workOrderId))?.state).toBe('closed');
  });

  it('B5b alone: without the QC pass, the SAME fixture reports exactly B5', async () => {
    // The control for the baseline above. If B5b did not bite here, `clearOrder`'s QC
    // pass would be arranging nothing and every isolation claim below would be void.
    const order = await createOpenWorkOrder();
    const version = await advance(order.workOrderId, [...TO_READY]);

    const report = await eligibility(order.workOrderId);
    expect(report.eligible).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(['B5']);

    const refused = await close(order.workOrderId, version);
    expect(refused.status).toBe(409);
    const problem = (await refused.json()) as {
      code?: string;
      violations?: readonly { path?: string }[];
    };
    expect(problem.code).toBe('ERR-WO-001');
    expect(problem.violations?.map((violation) => violation.path)).toEqual(['closure.B5']);
    // The refusal changed nothing: the order is still where it was.
    expect((await readWorkOrder(order.workOrderId))?.state).toBe('ready_to_close');
  });

  it('B1 alone: a non-terminal job', async () => {
    const order = await createOpenWorkOrder();
    await addJob(order.workOrderId, { title: 'Replace brake pads' });
    await passQualityControl(order.workOrderId);
    const version = await advance(order.workOrderId, [...TO_READY]);

    const report = await eligibility(order.workOrderId);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(['B1']);
    expect(report.blockers[0]?.enforcedBy).toContain('guard_work_order_closure');

    const refused = await close(order.workOrderId, version);
    expect(refused.status).toBe(409);
    expect(
      ((await refused.json()) as { violations?: readonly { path?: string }[] }).violations?.map(
        (violation) => violation.path
      )
    ).toEqual(['closure.B1']);
  });

  it('B1 clears when the job reaches a terminal state, and then the order closes', async () => {
    const order = await createOpenWorkOrder();
    const job = await addJob(order.workOrderId, { title: 'Replace brake pads' });
    await passQualityControl(order.workOrderId);
    const version = await advance(order.workOrderId, [...TO_READY]);
    expect((await eligibility(order.workOrderId)).blockers.map((b) => b.code)).toEqual(['B1']);

    await cancelJob(job.id, job.recordVersion);

    expect((await eligibility(order.workOrderId)).eligible).toBe(true);
    expect((await close(order.workOrderId, version)).status).toBe(200);
  });

  it('B2: an open-ended labour session, reported alongside B1 because the job cannot be terminal while it runs', async () => {
    const order = await createOpenWorkOrder();
    const job = await addJob(order.workOrderId, { title: 'Diagnose noise' });
    authAs(FULL);
    await expectOk(
      'assign',
      send(
        ASSIGN,
        `/api/v1/jobs/${job.id}/assignments`,
        { jobId: job.id },
        { technicianProfileId: TECH_A1, window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to } }
      )
    );
    // `in_progress` is the only job state that allows labour, and it is reachable only
    // as `planned → assigned → in_progress` — `wo.guard_job_transition` requires an
    // active assignment before `assigned`, which is why the assignment came first.
    let jobVersion = job.recordVersion;
    for (const toState of ['assigned', 'in_progress']) {
      authAs(FULL);
      jobVersion = (
        await expectOk<{ recordVersion: number }>(
          `job move to ${toState}`,
          send(
            JOB_TRANSITION,
            `/api/v1/jobs/${job.id}/transition`,
            { jobId: job.id },
            { toState },
            jobVersion
          )
        )
      ).recordVersion;
    }
    authAs(FULL);
    await expectOk(
      'start labour',
      send(
        START_LABOR,
        `/api/v1/jobs/${job.id}/labor-sessions`,
        { jobId: job.id },
        { technicianProfileId: TECH_A1 }
      )
    );
    await passQualityControl(order.workOrderId);
    const version = await advance(order.workOrderId, [...TO_READY]);

    // Both, in registry order. B2 is deliberately NOT isolated: an open session
    // requires a job in a labour-allowed state, and `wo.guard_job_transition` will not
    // let that job reach a terminal state while the session is open — so an order that
    // reports B2 alone is not a state the platform can produce. Asserting an isolated
    // B2 would mean arranging one by hand, which proves the fixture, not the gate.
    const report = await eligibility(order.workOrderId);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(['B1', 'B2']);

    const refused = await close(order.workOrderId, version);
    expect(refused.status).toBe(409);
    // The TRIGGER still reports only its first hit — which is exactly the asymmetry the
    // eligibility endpoint exists to remove.
    expect(
      ((await refused.json()) as { violations?: readonly { path?: string }[] }).violations?.map(
        (violation) => violation.path
      )
    ).toEqual(['closure.B1', 'closure.B2']);
  });

  it('B3 alone: a required additional-work request left pending', async () => {
    const order = await createOpenWorkOrder();
    const job = await addJob(order.workOrderId, { title: 'Inspect suspension' });
    authAs(FULL);
    await expectOk(
      'additional work',
      send(
        REQUEST_WORK,
        `/api/v1/work-orders/${order.workOrderId}/additional-work`,
        { workOrderId: order.workOrderId },
        {
          summary: 'Upper control arm bushings are perished',
          isRequired: true,
          originatingJobId: job.id,
        }
      )
    );
    // Cancelling the origin job clears B1 and is permitted: the unapproved-work
    // execution gate refuses movement INTO a labour-allowed state, and `cancelled` is
    // not one — the job may wait, or stop, while the customer is asked.
    await cancelJob(job.id, job.recordVersion);
    await passQualityControl(order.workOrderId);
    const version = await advance(order.workOrderId, [...TO_READY]);

    const report = await eligibility(order.workOrderId);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(['B3']);

    const refused = await close(order.workOrderId, version);
    expect(refused.status).toBe(409);
    expect(
      ((await refused.json()) as { violations?: readonly { path?: string }[] }).violations?.map(
        (violation) => violation.path
      )
    ).toEqual(['closure.B3']);
  });

  it('B4 alone: a requires_diagnostic job with no completed report — cancelling the job does NOT excuse it', async () => {
    const order = await createOpenWorkOrder();
    const job = await addJob(order.workOrderId, {
      title: 'Intermittent electrical fault',
      requiresDiagnostic: true,
    });
    await cancelJob(job.id, job.recordVersion);
    await passQualityControl(order.workOrderId);
    const version = await advance(order.workOrderId, [...TO_READY]);

    // B4's predicate reads `j.requires_diagnostic` with no reference to the job's
    // state, so a cancelled job still demands its report. That is the guard's rule and
    // not an oversight to route around: the order claimed a diagnostic was required.
    const report = await eligibility(order.workOrderId);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(['B4']);

    const refused = await close(order.workOrderId, version);
    expect(refused.status).toBe(409);
    expect(
      ((await refused.json()) as { violations?: readonly { path?: string }[] }).violations?.map(
        (violation) => violation.path
      )
    ).toEqual(['closure.B4']);
  });

  it('B5a alone: a failed QC record, superseded by a pass, closes', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const failed = await expectOk<{ id: string; recordVersion: number }>(
      'QC open',
      send(
        OPEN_QC,
        `/api/v1/work-orders/${order.workOrderId}/quality-controls`,
        { workOrderId: order.workOrderId },
        {}
      )
    );
    authAs(FULL);
    await expectOk(
      'QC fail',
      send(
        FINALIZE_QC,
        `/api/v1/quality-controls/${failed.id}/finalization`,
        { recordId: failed.id },
        { overallResult: 'failed' },
        failed.recordVersion
      )
    );
    const version = await advance(order.workOrderId, [...TO_READY]);

    // One code, two limbs: B5a (a failure stands unsuperseded) AND B5b (no pass exists
    // while a mandatory check is configured) are both unmet, and both report as B5.
    expect((await eligibility(order.workOrderId)).blockers.map((b) => b.code)).toEqual(['B5']);

    // A NEW record is the only way forward — `qms.guard_qc_finalize` froze the failed
    // one — and it clears both limbs at once while the failure stays in the ledger.
    await passQualityControl(order.workOrderId);

    expect((await eligibility(order.workOrderId)).eligible).toBe(true);
    expect((await close(order.workOrderId, version)).status).toBe(200);
  });

  it('B6 alone: an unsigned safety-critical rework blocks the REWORK order, not the original', async () => {
    const original = await clearOrder();
    expect((await close(original.workOrderId, original.version)).status).toBe(200);

    authAs(FULL);
    const rework = await expectOk<{ reworkWorkOrderId: string }>(
      'rework create',
      send(
        CREATE_REWORK,
        `/api/v1/work-orders/${original.workOrderId}/rework`,
        { workOrderId: original.workOrderId },
        {
          rootCause: 'Discs replaced with the wrong specification',
          correctiveAction: 'Replace with the correct discs and re-test',
          isSafetyCritical: true,
          leadTechnicianId: TECH_A1,
        }
      )
    );

    // The original stays closed. B6's predicate names `rework_work_order_id`, so
    // creating an unsigned safety-critical rework cannot retroactively block the order
    // it corrects — and the original is terminal, so the gate never re-runs on it.
    expect((await readWorkOrder(original.workOrderId))?.state).toBe('closed');

    await passQualityControl(rework.reworkWorkOrderId);
    const reworkVersion = await advance(rework.reworkWorkOrderId, [
      { toState: 'open' },
      ...TO_READY,
    ]);

    const report = await eligibility(rework.reworkWorkOrderId);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(['B6']);

    const refused = await close(rework.reworkWorkOrderId, reworkVersion);
    expect(refused.status).toBe(409);
    expect(
      ((await refused.json()) as { violations?: readonly { path?: string }[] }).violations?.map(
        (violation) => violation.path
      )
    ).toEqual(['closure.B6']);
  });

  it('cancellation bypasses all six while still recording history', async () => {
    const order = await createOpenWorkOrder();
    // Four blockers at once, and none of them is consulted.
    const job = await addJob(order.workOrderId, {
      title: 'Unfinished work',
      requiresDiagnostic: true,
    });
    authAs(FULL);
    await expectOk(
      'additional work',
      send(
        REQUEST_WORK,
        `/api/v1/work-orders/${order.workOrderId}/additional-work`,
        { workOrderId: order.workOrderId },
        { summary: 'Never answered', isRequired: true, originatingJobId: job.id }
      )
    );
    const version = await advance(order.workOrderId, [{ toState: 'in_progress' }]);

    const report = await eligibility(order.workOrderId);
    expect(report.eligible).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(['B1', 'B3', 'B4', 'B5']);

    // Through the TRANSITION route, not the closure command. The closure command
    // refuses a cancellation target outright (`not_a_closing_state`), which is what
    // stops the closing authority from using it to abandon work without a
    // completeness check — the guard's own exemption would have allowed exactly that.
    authAs(FULL);
    const cancelled = await transitionRequest(
      order.workOrderId,
      { toState: 'cancelled', reason: 'customer withdrew the vehicle' },
      { version }
    );
    expect(cancelled.status).toBe(200);
    expect((await readWorkOrder(order.workOrderId))?.state).toBe('cancelled');

    // History is still written. "The gate was bypassed" must not mean "nothing is
    // recorded" — abandoning a job is a fact someone has to answer for later.
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.work_order_status_history
        WHERE work_order_id = $1 AND to_state = 'cancelled'`,
      [order.workOrderId]
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
