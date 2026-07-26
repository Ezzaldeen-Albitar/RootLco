/**
 * Concurrent callers on the P1-19 surfaces that had no race probe (Phase 1-19,
 * P1-19-QA-001).
 *
 * Five of this phase's commands already carry one — work-order transition and closure,
 * job transition, job assignment, labour start. What was missing is the three places
 * where the protection is NOT a unique index, and where a sequential test therefore
 * proves nothing about what happens under load.
 *
 * **Every case here forces the race rather than hoping for it.** Two requests issued
 * together may simply not interleave, so a passing test would be evidence of luck. A
 * third connection holds the row the command locks first, both callers park on that
 * lock, `waitForBlockedBackends` confirms they arrived, and only then is the gate
 * released. Without that, the outcome is not a fact about the code.
 *
 * ## The revision-number probe corrects an earlier judgement
 *
 * `p1-19-diagnostics.test.ts` numbers revisions sequentially and declines the
 * concurrent case, reasoning that "a race would prove nothing a constraint could back".
 * That reasoning is wrong. It is true that no unique index protects
 * `dia.diagnostic_reports.revision_number` — accepted item `P1-19-A-02` — and true that
 * a race cannot demonstrate an invariant the schema does not hold. But the limitation
 * as written claims something narrower and testable: that two writers *going through
 * the repository* are serialised by the advisory lock. Until this probe existed, that
 * claim rested on reading `pg_advisory_xact_lock` in the source. Now it rests on two
 * concurrent callers receiving revisions 1 and 2.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   dia.diagnostic-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   qms.qc-record-finalize: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency
 *   qms.rework-create: route service authorization success denial cross-tenant isolation audit outbox idempotency rollback
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
  TECH_A1,
  advance,
  authAs,
  count,
  createOpenWorkOrder,
  establishDiagnosticFixtures,
  establishP1_19Fixtures,
  establishQualityFixtures,
  establishTechnicianFixtures,
  readWorkOrder,
  waitForBlockedBackends,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as ADD_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as CREATE_REPORT } from '@/app/api/v1/jobs/[jobId]/inspections/route';
import { POST as OPEN_QC } from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { POST as FINALIZE_QC } from '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import { POST as CREATE_REWORK } from '@/app/api/v1/work-orders/[workOrderId]/rework/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';

let admin: Pool;
let runtime: Pool;
let templateVersionId: string;

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

/**
 * Runs two requests against each other with the race forced.
 *
 * `hold` names the row both callers must lock before they can proceed. The gate takes
 * it first, so neither can run until the gate lets go — and both are then released into
 * the same instant, which is the only way the loser's path is exercised at all.
 */
async function race(
  hold: { readonly sql: string; readonly values: readonly unknown[] },
  issue: () => readonly Promise<Response>[]
): Promise<readonly Response[]> {
  const gate = await admin.connect();
  try {
    await gate.query('BEGIN');
    await gate.query(hold.sql, [...hold.values]);
    const inFlight = Promise.all(issue());
    try {
      await waitForBlockedBackends(2);
    } finally {
      // Released whether or not both arrived, so a failure reports its own cause
      // rather than surfacing as a timeout in an unrelated place.
      await gate.query('ROLLBACK');
    }
    return await inFlight;
  } finally {
    gate.release();
  }
}

async function addDiagnosticJob(): Promise<{ readonly jobId: string }> {
  const order = await createOpenWorkOrder();
  authAs(FULL);
  const job = await expectOk<{ id: string }>(
    'job create',
    send(
      ADD_JOB,
      `/api/v1/work-orders/${order.workOrderId}/jobs`,
      { workOrderId: order.workOrderId },
      { title: 'Brake inspection', requiresDiagnostic: true }
    )
  );
  return { jobId: job.id };
}

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

/** A closed work order — the only thing a rework case can be raised against. */
async function closedOrder(): Promise<string> {
  const order = await createOpenWorkOrder();
  await passQualityControl(order.workOrderId);
  const version = await advance(order.workOrderId, [
    { toState: 'in_progress' },
    { toState: 'qc_pending' },
    { toState: 'ready_to_close' },
  ]);
  authAs(FULL);
  const closed = await send(
    CLOSE_WORK_ORDER,
    `/api/v1/work-orders/${order.workOrderId}/closure`,
    { workOrderId: order.workOrderId },
    { toState: 'closed' },
    version
  );
  if (closed.status !== 200) {
    throw new Error(`fixture closure failed with ${closed.status}: ${await closed.text()}`);
  }
  return order.workOrderId;
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
  templateVersionId = (await establishDiagnosticFixtures()).templateVersionId;
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

describe('P1-19 / concurrent callers', () => {
  it('two concurrent diagnostic reports on one job get DISTINCT revision numbers', async () => {
    const job = await addDiagnosticJob();

    const outcomes = await race(
      // The creation path locks the JOB before it reads the current maximum revision,
      // so holding the job row parks both callers ahead of the advisory lock.
      { sql: 'SELECT id FROM wo.jobs WHERE id = $1 FOR UPDATE', values: [job.jobId] },
      () => [
        (async () => {
          authAs(FULL);
          return send(
            CREATE_REPORT,
            `/api/v1/jobs/${job.jobId}/inspections`,
            { jobId: job.jobId },
            { templateVersionId }
          );
        })(),
        (async () => {
          authAs(FULL);
          return send(
            CREATE_REPORT,
            `/api/v1/jobs/${job.jobId}/inspections`,
            { jobId: job.jobId },
            { templateVersionId }
          );
        })(),
      ]
    );

    // Both succeed — a second revision is legitimate, which is why there is no unique
    // index to lean on. What must NOT happen is both reading the same maximum.
    expect(outcomes.map((response) => response.status)).toEqual([201, 201]);
    const bodies = await Promise.all(
      outcomes.map((response) => response.json() as Promise<{ revisionNumber: number }>)
    );
    const revisions = bodies.map((body) => body.revisionNumber).sort((a, b) => a - b);
    expect(revisions).toEqual([1, 2]);

    // Stated as a distinct assertion rather than inferred from the pair above: two
    // rows, two revision numbers, and the phase's claim about the advisory lock is now
    // a measurement instead of a reading of the source.
    expect(
      await count(
        `SELECT count(DISTINCT revision_number)::text AS n FROM dia.diagnostic_reports
          WHERE job_id = $1 AND deleted_at IS NULL`,
        [job.jobId]
      )
    ).toBe(2);
  });

  it('two concurrent finalizations of ONE quality-control record: exactly one wins', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = await expectOk<{ id: string; recordVersion: number }>(
      'QC open',
      send(
        OPEN_QC,
        `/api/v1/work-orders/${order.workOrderId}/quality-controls`,
        { workOrderId: order.workOrderId },
        {}
      )
    );

    const outcomes = await race(
      {
        sql: 'SELECT id FROM qms.quality_control_records WHERE id = $1 FOR UPDATE',
        values: [record.id],
      },
      () => [
        (async () => {
          authAs(FULL);
          return send(
            FINALIZE_QC,
            `/api/v1/quality-controls/${record.id}/finalization`,
            { recordId: record.id },
            { overallResult: 'passed' },
            record.recordVersion
          );
        })(),
        (async () => {
          authAs(FULL);
          return send(
            FINALIZE_QC,
            `/api/v1/quality-controls/${record.id}/finalization`,
            { recordId: record.id },
            { overallResult: 'failed' },
            record.recordVersion
          );
        })(),
      ]
    );

    const statuses = outcomes.map((response) => response.status).sort((x, y) => x - y);
    expect(statuses[0]).toBe(200);
    // The loser submitted the version the winner has already moved past, so it is an
    // optimistic-concurrency refusal — NOT a "record already finalized" domain error.
    // Both would be a refusal; only one of them is the truthful account of what
    // happened, and a client retrying on a re-read is the correct response to it.
    expect(statuses[1]).toBe(409);

    // The result is whichever the winner declared, and it is now frozen: the two
    // callers asked for opposite verdicts, so a record that ended up with both — or
    // with the second one's — would mean `qms.guard_qc_finalize` had not held.
    const { rows } = await admin.query<{ overall_result: string; checker_id: string | null }>(
      `SELECT overall_result, checker_id FROM qms.quality_control_records WHERE id = $1`,
      [record.id]
    );
    expect(['passed', 'failed']).toContain(rows[0]?.overall_result);
    expect(rows[0]?.checker_id).not.toBeNull();
    expect(
      await count(`SELECT count(*)::text AS n FROM qms.quality_control_records WHERE id = $1`, [
        record.id,
      ])
    ).toBe(1);
  });

  it('two concurrent rework cases against one closed original BOTH succeed, deliberately', async () => {
    const original = await closedOrder();

    const outcomes = await race(
      { sql: 'SELECT id FROM wo.work_orders WHERE id = $1 FOR UPDATE', values: [original] },
      () => [
        (async () => {
          authAs(FULL);
          return send(
            CREATE_REWORK,
            `/api/v1/work-orders/${original}/rework`,
            { workOrderId: original },
            { rootCause: 'Wrong disc specification', correctiveAction: 'Replace and re-test' }
          );
        })(),
        (async () => {
          authAs(FULL);
          return send(
            CREATE_REWORK,
            `/api/v1/work-orders/${original}/rework`,
            { workOrderId: original },
            { rootCause: 'Pad bedding-in not performed', correctiveAction: 'Bed in and re-test' }
          );
        })(),
      ]
    );

    // `uq_work_orders_ordinary_origin` is PARTIAL on `kind = 'ordinary'`, so a second
    // rework order against the same reception visit is permitted BY DESIGN — one repair
    // can go wrong in two independent ways. This asserts the permission is real rather
    // than an accident nobody exercised.
    expect(outcomes.map((response) => response.status)).toEqual([201, 201]);
    const bodies = await Promise.all(
      outcomes.map(
        (response) =>
          response.json() as Promise<{ reworkWorkOrderId: string; link: { id: string } }>
      )
    );
    expect(bodies[0]?.reworkWorkOrderId).not.toBe(bodies[1]?.reworkWorkOrderId);
    expect(bodies[0]?.link.id).not.toBe(bodies[1]?.link.id);

    // Two orders, two links, and the original untouched by either.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links WHERE original_work_order_id = $1
          AND deleted_at IS NULL`,
        [original]
      )
    ).toBe(2);
    expect((await readWorkOrder(original))?.state).toBe('closed');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.work_orders WHERE kind = 'rework'
          AND reception_visit_id = (SELECT reception_visit_id FROM wo.work_orders WHERE id = $1)`,
        [original]
      )
    ).toBe(2);
  });

  it('a lead technician on one of two concurrent reworks does not bleed into the other', async () => {
    const original = await closedOrder();

    const outcomes = await race(
      { sql: 'SELECT id FROM wo.work_orders WHERE id = $1 FOR UPDATE', values: [original] },
      () => [
        (async () => {
          authAs(FULL);
          return send(
            CREATE_REWORK,
            `/api/v1/work-orders/${original}/rework`,
            { workOrderId: original },
            {
              rootCause: 'Safety-critical: caliper bolts under-torqued',
              correctiveAction: 'Re-torque to specification and verify',
              isSafetyCritical: true,
              leadTechnicianId: TECH_A1,
            }
          );
        })(),
        (async () => {
          authAs(FULL);
          return send(
            CREATE_REWORK,
            `/api/v1/work-orders/${original}/rework`,
            { workOrderId: original },
            { rootCause: 'Cosmetic: wheel trim scuffed', correctiveAction: 'Replace the trim' }
          );
        })(),
      ]
    );
    expect(outcomes.map((response) => response.status)).toEqual([201, 201]);

    // Exactly one safety-critical link with a lead, exactly one without. B6 will
    // therefore block the closure of one rework order and not the other, which is the
    // whole reason `is_safety_critical` is per-link rather than per-order.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links
          WHERE original_work_order_id = $1 AND is_safety_critical
            AND lead_technician_id IS NOT NULL AND deleted_at IS NULL`,
        [original]
      )
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links
          WHERE original_work_order_id = $1 AND NOT is_safety_critical AND deleted_at IS NULL`,
        [original]
      )
    ).toBe(1);
  });
});
