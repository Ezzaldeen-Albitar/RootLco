/**
 * Quality control, reopen refusal and rework (Phase 1-19, P1-19-BE-017…019).
 *
 * Four claims carry this suite.
 *
 * **A failed check is never edited into a pass.** `qms.guard_qc_finalize` freezes a
 * finalized record's result, checker and time, so clearing closure blocker B5 means
 * opening a NEW record — which the schema permits because there is no unique index on
 * `(work_order_id)`. The failure stays in the ledger, and the suite proves both halves.
 *
 * **A closed work order never reopens.** `qms.attempt_reopen` records the attempt and
 * never mutates the order, so the endpoint's success path is a REFUSAL carrying the
 * recorded attempt's id. The suite asserts the order is byte-for-byte unchanged
 * afterwards, because "we refused" and "we refused and changed nothing" are different
 * claims.
 *
 * **A rework work order can now be created at all.** Before this wave nothing in the
 * platform could produce `kind = 'rework'` — reception's conversion writes seven
 * columns and leaves `kind` to its default — so `qms.rework_links` was unreachable and
 * B6 could never fire. The suite proves the new order is `kind = 'rework'`, shares the
 * original's reception visit, and that order and link commit together or not at all.
 *
 * **BR-QMS-001 is a CHECK.** `ck_rework_links_signoff_distinct` refuses a signer equal
 * to the lead technician — the database, not this code — and the suite drives it
 * through the real route as well as asserting the readable pre-refusal.
 *
 * Operations exercised here: qms.qc-record-open, qms.qc-record-list,
 * qms.qc-record-detail, qms.qc-check-result, qms.qc-record-finalize,
 * qms.reopen-attempt, qms.reopen-attempt-list, qms.rework-create, qms.rework-list,
 * qms.rework-detail, qms.rework-sign-off, qms.rework-cost-record,
 * qms.rework-cost-read.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   qms.qc-record-open: route service authorization success denial cross-tenant isolation audit idempotency
 *   qms.qc-record-list: route service authorization success denial cross-tenant isolation
 *   qms.qc-record-detail: route service authorization success denial cross-tenant isolation
 *   qms.qc-check-result: route service authorization success denial cross-tenant isolation audit idempotency
 *   qms.qc-record-finalize: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency
 *   qms.reopen-attempt: route service authorization success denial cross-tenant isolation audit idempotency
 *   qms.reopen-attempt-list: route service authorization success denial cross-tenant isolation
 *   qms.rework-create: route service authorization success denial cross-tenant isolation audit outbox idempotency rollback
 *   qms.rework-list: route service authorization success denial cross-tenant isolation
 *   qms.rework-detail: route service authorization success denial cross-tenant isolation
 *   qms.rework-sign-off: route service authorization success denial cross-tenant isolation audit stale-version idempotency
 *   qms.rework-cost-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   qms.rework-cost-read: route service authorization success denial cross-tenant isolation audit
 */
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
  PERMISSION_ELSEWHERE,
  QC_CHECKER,
  QC_CHECK_MANDATORY,
  READER,
  REVIEWER,
  SCOPED_ELSEWHERE,
  SENSITIVE,
  TECH_A1,
  TECH_A1_ALT,
  TENANT_B_FULL,
  advance,
  auditCount,
  authAs,
  authAsSubject,
  count,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishQualityFixtures,
  establishTechnicianFixtures,
  outboxCount,
  readWorkOrder,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  GET as LIST_QC,
  POST as OPEN_QC,
} from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { GET as READ_QC } from '@/app/api/v1/quality-controls/[recordId]/route';
import { PUT as WRITE_CHECK } from '@/app/api/v1/quality-controls/[recordId]/checks/[qcCheckId]/route';
import { POST as FINALIZE_QC } from '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import {
  GET as LIST_REOPEN,
  POST as ATTEMPT_REOPEN,
} from '@/app/api/v1/work-orders/[workOrderId]/reopen-attempts/route';
import {
  GET as LIST_REWORK,
  POST as CREATE_REWORK,
} from '@/app/api/v1/work-orders/[workOrderId]/rework/route';
import { GET as READ_REWORK } from '@/app/api/v1/rework-links/[reworkLinkId]/route';
import { POST as SIGN_OFF } from '@/app/api/v1/rework-links/[reworkLinkId]/sign-off/route';
import {
  GET as READ_COST,
  PUT as WRITE_COST,
} from '@/app/api/v1/rework-links/[reworkLinkId]/cost/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';

const QC_OPENED = 'qms.quality_control.opened';
const QC_CHECK_RECORDED = 'qms.quality_control.check_recorded';
const QC_FINALIZED = 'qms.quality_control.finalized';
const REOPEN_REFUSED = 'qms.work_order.reopen_refused';
const REWORK_CREATED = 'qms.rework.created';
const REWORK_SIGNED = 'qms.rework.signed_off';
const COST_RECORDED = 'qms.rework.cost_recorded';
const COST_READ = 'qms.rework.cost_read';
const QC_EVENT = 'quality-control.finalized';
const REWORK_EVENT = 'rework.linked';

let admin: Pool;
let runtime: Pool;
let mandatoryCheckId: string;
let optionalCheckId: string;

interface Problem {
  readonly code?: string;
  readonly violations?: readonly { readonly path?: string; readonly rule?: string }[];
}

interface QcBody extends Problem {
  readonly id: string;
  readonly workOrderId: string;
  readonly overallResult: string;
  readonly checkerId: string | null;
  readonly finalizedAt: string | null;
  readonly recordVersion: number;
}

function send(
  handler: unknown,
  url: string,
  params: Record<string, string>,
  body: unknown,
  options: {
    readonly version?: number | null;
    readonly key?: string;
    readonly method?: string;
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? crypto.randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  const call = handler as (
    request: Request,
    route: { params: Promise<Record<string, string>> }
  ) => Promise<Response>;
  return call(
    new Request(`http://localhost${url}`, {
      method: options.method ?? 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
}

function read(handler: unknown, url: string, params: Record<string, string>): Promise<Response> {
  const call = handler as (
    request: Request,
    route: { params: Promise<Record<string, string>> }
  ) => Promise<Response>;
  return call(new Request(`http://localhost${url}`), { params: Promise.resolve(params) });
}

const openQc = (workOrderId: string, body: unknown = {}, key?: string): Promise<Response> =>
  send(
    OPEN_QC,
    `/api/v1/work-orders/${workOrderId}/quality-controls`,
    { workOrderId },
    body,
    key === undefined ? {} : { key }
  );

const listQc = (workOrderId: string): Promise<Response> =>
  read(LIST_QC, `/api/v1/work-orders/${workOrderId}/quality-controls`, { workOrderId });

const readQc = (recordId: string): Promise<Response> =>
  read(READ_QC, `/api/v1/quality-controls/${recordId}`, { recordId });

const writeCheck = (
  recordId: string,
  qcCheckId: string,
  body: unknown,
  key?: string
): Promise<Response> =>
  send(
    WRITE_CHECK,
    `/api/v1/quality-controls/${recordId}/checks/${qcCheckId}`,
    { recordId, qcCheckId },
    body,
    { method: 'PUT', ...(key === undefined ? {} : { key }) }
  );

const finalizeQc = (
  recordId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> =>
  send(
    FINALIZE_QC,
    `/api/v1/quality-controls/${recordId}/finalization`,
    { recordId },
    body,
    options
  );

const attemptReopen = (workOrderId: string, body: unknown, key?: string): Promise<Response> =>
  send(
    ATTEMPT_REOPEN,
    `/api/v1/work-orders/${workOrderId}/reopen-attempts`,
    { workOrderId },
    body,
    key === undefined ? {} : { key }
  );

const listReopen = (workOrderId: string): Promise<Response> =>
  read(LIST_REOPEN, `/api/v1/work-orders/${workOrderId}/reopen-attempts`, { workOrderId });

const createRework = (workOrderId: string, body: unknown, key?: string): Promise<Response> =>
  send(
    CREATE_REWORK,
    `/api/v1/work-orders/${workOrderId}/rework`,
    { workOrderId },
    body,
    key === undefined ? {} : { key }
  );

const listRework = (workOrderId: string): Promise<Response> =>
  read(LIST_REWORK, `/api/v1/work-orders/${workOrderId}/rework`, { workOrderId });

const readRework = (reworkLinkId: string): Promise<Response> =>
  read(READ_REWORK, `/api/v1/rework-links/${reworkLinkId}`, { reworkLinkId });

const signOff = (
  reworkLinkId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> =>
  send(SIGN_OFF, `/api/v1/rework-links/${reworkLinkId}/sign-off`, { reworkLinkId }, body, options);

const writeCost = (reworkLinkId: string, body: unknown, key?: string): Promise<Response> =>
  send(WRITE_COST, `/api/v1/rework-links/${reworkLinkId}/cost`, { reworkLinkId }, body, {
    method: 'PUT',
    ...(key === undefined ? {} : { key }),
  });

const readCost = (reworkLinkId: string): Promise<Response> =>
  read(READ_COST, `/api/v1/rework-links/${reworkLinkId}/cost`, { reworkLinkId });

/**
 * A work order driven all the way to CLOSED through the real routes.
 *
 * The closure gate is live throughout, so this doubles as proof that B1–B6 are clear
 * on an order with no jobs, no labour, no required additional work and no diagnostics —
 * except B5b, which the mandatory fixture check makes bite until a QC passes.
 */
async function closedWorkOrder(): Promise<{
  readonly workOrderId: string;
  readonly version: number;
}> {
  const order = await createOpenWorkOrder();
  // B5b: a mandatory check is configured tenant-wide, so a passed record is required.
  authAs(FULL);
  const record = (await (await openQc(order.workOrderId)).json()) as QcBody;
  authAs(FULL);
  const passed = await finalizeQc(
    record.id,
    { overallResult: 'passed' },
    { version: record.recordVersion }
  );
  if (passed.status !== 200) {
    throw new Error(`fixture QC pass failed with ${passed.status}: ${await passed.text()}`);
  }
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
    { version }
  );
  if (closed.status !== 200) {
    throw new Error(`fixture closure failed with ${closed.status}: ${await closed.text()}`);
  }
  return {
    workOrderId: order.workOrderId,
    version: ((await closed.json()) as { recordVersion: number }).recordVersion,
  };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  const checks = await establishQualityFixtures();
  mandatoryCheckId = checks.mandatoryId;
  optionalCheckId = checks.optionalId;
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

describe('qms.qc-record-open, qms.qc-record-list and qms.qc-record-detail', () => {
  it('opens a pending record with no checker and no finalization time', async () => {
    const order = await createOpenWorkOrder();

    authAs(FULL);
    const response = await openQc(order.workOrderId, { notes: 'Pre-release check' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as QcBody;
    expect(body.overallResult).toBe('pending');
    // `ck_quality_control_records_finalized` pins the coupling: pending implies both
    // are NULL, so a record cannot claim a checker before anyone checked.
    expect(body.checkerId).toBeNull();
    expect(body.finalizedAt).toBeNull();
    expect(await auditCount(QC_OPENED, body.id)).toBe(1);
  });

  it('allows a SECOND record on the same work order, which is how a failure is cleared', async () => {
    const order = await createOpenWorkOrder();

    authAs(FULL);
    const first = (await (await openQc(order.workOrderId)).json()) as QcBody;
    authAs(FULL);
    await finalizeQc(first.id, { overallResult: 'failed' }, { version: first.recordVersion });
    authAs(FULL);
    const second = await openQc(order.workOrderId);
    expect(second.status).toBe(201);

    // No unique index on `(work_order_id)` — deliberately. B5 reads the SET, so a
    // later pass clears closure while the failure stays in the ledger.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.quality_control_records WHERE work_order_id = $1`,
        [order.workOrderId]
      )
    ).toBe(2);

    authAs(FULL);
    const listed = (await (await listQc(order.workOrderId)).json()) as {
      items: readonly QcBody[];
    };
    expect(listed.items).toHaveLength(2);
    // OLDEST first: the failure came first and reads first, so the list tells the story
    // in the order it happened. The manifest note said "newest first" for one revision.
    expect(listed.items[0]?.overallResult).toBe('failed');
    expect(listed.items[1]?.overallResult).toBe('pending');
  });

  it('refuses every READ on this surface to an unpermitted, out-of-branch or cross-tenant caller', async () => {
    // The four reads — the QC list, the QC detail, the rework list and the reopen
    // ledger — each claim authorization, denial and isolation evidence in the coverage
    // manifest, and an earlier revision of this file produced none of it: every read
    // was made as FULL. A gate that only checks the operation id appears in executable
    // code cannot catch that, which is how P1-17 credited eight operations falsely.
    const closed = await closedWorkOrder();
    // The closure fixture already passed a record — reading it back is the only way to
    // get one here, because `open()` refuses a terminal order (a record opened after
    // release could never gate the closure it exists to gate).
    authAs(FULL);
    const records = (await (await listQc(closed.workOrderId)).json()) as {
      items: readonly QcBody[];
    };
    const record = records.items[0];
    expect(record?.overallResult).toBe('passed');
    authAs(FULL);
    const rework = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string } };
    authAs(FULL);
    await attemptReopen(closed.workOrderId, { reason: 'Recorded' });

    for (const [name, send] of [
      ['qc list', () => listQc(closed.workOrderId)],
      ['qc detail', () => readQc(record!.id)],
      ['rework list', () => listRework(closed.workOrderId)],
      ['rework detail', () => readRework(rework.link.id)],
      ['reopen list', () => listReopen(closed.workOrderId)],
    ] as const) {
      authAsSubject(SUBJECT_UNPERMITTED);
      expect((await send()).status, `${name} unpermitted`).toBe(403);
      // Granted in BRANCH_A2 and RLS-visible in A1 through an unrelated grant, so only
      // the scoped permission check can refuse (P1-18-A-01).
      authAs(PERMISSION_ELSEWHERE);
      expect((await send()).status, `${name} scoped elsewhere with reach`).toBe(403);
      // No grant in A1 at all, so RLS hides the row first: defence in depth.
      authAs(SCOPED_ELSEWHERE);
      expect((await send()).status, `${name} scoped elsewhere`).toBe(404);
      authAs(TENANT_B_FULL);
      expect((await send()).status, `${name} cross-tenant`).toBe(404);
    }
  });

  it('reports which mandatory checks have no result yet', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;

    authAs(FULL);
    const before = (await (await readQc(record.id)).json()) as {
      unresolvedMandatory: readonly { code: string }[];
      results: readonly unknown[];
    };
    expect(before.unresolvedMandatory.map((c) => c.code)).toEqual([QC_CHECK_MANDATORY]);

    authAs(FULL);
    await writeCheck(record.id, mandatoryCheckId, { result: 'pass' });
    authAs(FULL);
    const after = (await (await readQc(record.id)).json()) as {
      unresolvedMandatory: readonly unknown[];
      results: readonly unknown[];
    };
    expect(after.unresolvedMandatory).toEqual([]);
    expect(after.results).toHaveLength(1);
  });

  it('refuses a terminal work order, an unpermitted caller, and cross-scope callers', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const late = await openQc(closed.workOrderId);
    // Not a schema rule: `qms.quality_control_records` references the order and never
    // reads its state, so a record opened after release could never gate the closure
    // it was meant to certify.
    expect(late.status).toBe(409);
    expect(((await late.json()) as Problem).code).toBe('ERR-TRN-001');

    const order = await createOpenWorkOrder();
    authAs(READER);
    expect((await openQc(order.workOrderId)).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await openQc(order.workOrderId)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await openQc(order.workOrderId)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await openQc(order.workOrderId)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await openQc(order.workOrderId)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await listQc(order.workOrderId)).status).toBe(404);
  });

  it('isolates the record read by branch and by tenant', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await readQc(record.id)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await readQc(record.id)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await readQc(record.id)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await readQc(record.id)).status).toBe(404);
  });

  it('opens one record on an idempotent replay', async () => {
    const order = await createOpenWorkOrder();
    const key = crypto.randomUUID();

    authAs(FULL);
    expect((await openQc(order.workOrderId, {}, key)).status).toBe(201);
    expect((await openQc(order.workOrderId, {}, key)).status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.quality_control_records WHERE work_order_id = $1`,
        [order.workOrderId]
      )
    ).toBe(1);
  });
});

describe('qms.qc-check-result', () => {
  it('records and replaces one check outcome while the record is pending', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;

    authAs(FULL);
    const first = await writeCheck(record.id, mandatoryCheckId, { result: 'fail', note: 'Play' });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { result: string }).result).toBe('fail');

    authAs(FULL);
    const corrected = await writeCheck(record.id, mandatoryCheckId, { result: 'pass' });
    expect(corrected.status).toBe(200);
    expect(((await corrected.json()) as { result: string }).result).toBe('pass');
    // 1:1 through the partial unique index — a correction is not a second row.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.qc_check_results
          WHERE quality_control_record_id = $1 AND deleted_at IS NULL`,
        [record.id]
      )
    ).toBe(1);
    expect(await auditCount(QC_CHECK_RECORDED, record.id)).toBe(2);
  });

  it('accepts `na` as a recorded fact, and refuses a value outside the vocabulary', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;

    authAs(FULL);
    const na = await writeCheck(record.id, optionalCheckId, { result: 'na', note: 'No paintwork' });
    expect(na.status).toBe(200);
    expect(((await na.json()) as { result: string }).result).toBe('na');

    authAs(FULL);
    // `not_applicable` is the phrase the brief uses; the CHECK says `na`.
    expect(
      (await writeCheck(record.id, optionalCheckId, { result: 'not_applicable' })).status
    ).toBe(422);
  });

  it('refuses a check outside the tenant catalog and a finalized record', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;

    // `fk_qc_check_results_check` references `qms.qc_checks (id)` with NO tenant
    // column, so a check belonging to another tenant satisfies the foreign key. Only
    // the catalog read refuses it.
    const foreign = await establishQualityFixtures(TENANT_B);
    authAs(FULL);
    const crossTenantCheck = await writeCheck(record.id, foreign.mandatoryId, { result: 'pass' });
    expect(crossTenantCheck.status).toBe(404);

    authAs(FULL);
    await finalizeQc(record.id, { overallResult: 'passed' }, { version: record.recordVersion });
    authAs(FULL);
    const late = await writeCheck(record.id, optionalCheckId, { result: 'pass' });
    // `qms.guard_qc_finalize` freezes the RECORD, not its children: without this rule
    // a finalized record would accept new outcomes and change what it says.
    expect(late.status).toBe(409);
    expect(((await late.json()) as Problem).code).toBe('ERR-QMS-001');
  });

  it('refuses an unpermitted or cross-scope caller, and writes once on replay', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;
    const key = crypto.randomUUID();

    authAs(READER);
    expect((await writeCheck(record.id, mandatoryCheckId, { result: 'pass' })).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await writeCheck(record.id, mandatoryCheckId, { result: 'pass' })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await writeCheck(record.id, mandatoryCheckId, { result: 'pass' })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await writeCheck(record.id, mandatoryCheckId, { result: 'pass' })).status).toBe(404);

    authAs(FULL);
    expect((await writeCheck(record.id, mandatoryCheckId, { result: 'pass' }, key)).status).toBe(
      200
    );
    expect((await writeCheck(record.id, mandatoryCheckId, { result: 'pass' }, key)).status).toBe(
      200
    );
    expect(await auditCount(QC_CHECK_RECORDED, record.id)).toBe(1);
  });
});

describe('qms.qc-record-finalize', () => {
  it('stamps the checker and the time from the session, and publishes once', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;

    authAs(FULL);
    const response = await finalizeQc(
      record.id,
      { overallResult: 'passed' },
      { version: record.recordVersion }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as QcBody;
    expect(body.overallResult).toBe('passed');
    // Stamped by `qms.guard_qc_finalize` from `iam.current_user_id()`, never sent.
    expect(body.checkerId).toBe(FULL.userId);
    expect(body.finalizedAt).toBeTruthy();
    expect(await auditCount(QC_FINALIZED, record.id)).toBe(1);
    expect(await outboxCount(QC_EVENT, record.id)).toBe(1);
  });

  it('freezes a finalized record against re-judgement, at the deployed guard', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;
    authAs(FULL);
    const failed = await finalizeQc(
      record.id,
      { overallResult: 'failed' },
      { version: record.recordVersion }
    );
    const version = ((await failed.json()) as QcBody).recordVersion;

    authAs(FULL);
    const rejudge = await finalizeQc(record.id, { overallResult: 'passed' }, { version });
    expect(rejudge.status).toBe(409);
    expect(((await rejudge.json()) as Problem).code).toBe('ERR-QMS-001');

    // And the guard itself refuses it, not only the service. No route can express this
    // request, so it is probed directly — a control nobody can reach through the API
    // still has to be shown to work.
    let refused = false;
    try {
      await admin.query(
        `UPDATE qms.quality_control_records SET overall_result = 'passed' WHERE id = $1`,
        [record.id]
      );
    } catch (error) {
      refused = /is finalized; result\/checker\/time are immutable/i.test(String(error));
    }
    expect(refused).toBe(true);
  });

  it('refuses `pending` as a target, a stale version and a missing If-Match', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;

    authAs(FULL);
    expect(
      (await finalizeQc(record.id, { overallResult: 'pending' }, { version: record.recordVersion }))
        .status
    ).toBe(422);
    authAs(FULL);
    const stale = await finalizeQc(
      record.id,
      { overallResult: 'passed' },
      { version: record.recordVersion + 5 }
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Problem).code).toBe('ERR-CON-001');
    authAs(FULL);
    expect(
      (await finalizeQc(record.id, { overallResult: 'passed' }, { version: null })).status
    ).toBe(428);
  });

  it('refuses a caller with qms.quality_control.record but not .finalize', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;
    const body = { overallResult: 'passed' };

    // THE control: `QC_CHECKER` holds `qms.quality_control.record` and NOT
    // `.finalize`, so it can tick every check off and cannot declare the vehicle fit
    // to release. Until this principal existed the test named for the split probed
    // only the read-only principal, which holds neither — and could not have failed if
    // the split were removed. (`REVIEWER` holds both through WAVE_8_COMMANDS, so it is
    // no use here either; an earlier comment claimed it held neither, which was false.)
    authAs(QC_CHECKER);
    const canRecord = await writeCheck(record.id, mandatoryCheckId, { result: 'pass' });
    expect(canRecord.status).toBe(200);
    authAs(QC_CHECKER);
    expect((await finalizeQc(record.id, body, { version: record.recordVersion })).status).toBe(403);

    authAs(READER);
    expect((await finalizeQc(record.id, body, { version: record.recordVersion })).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await finalizeQc(record.id, body, { version: record.recordVersion })).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await finalizeQc(record.id, body, { version: record.recordVersion })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await finalizeQc(record.id, body, { version: record.recordVersion })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await finalizeQc(record.id, body, { version: record.recordVersion })).status).toBe(404);
  });

  it('finalizes once on an idempotent replay', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const record = (await (await openQc(order.workOrderId)).json()) as QcBody;
    const key = crypto.randomUUID();

    authAs(FULL);
    expect(
      (
        await finalizeQc(
          record.id,
          { overallResult: 'passed' },
          { version: record.recordVersion, key }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await finalizeQc(
          record.id,
          { overallResult: 'passed' },
          { version: record.recordVersion, key }
        )
      ).status
    ).toBe(200);
    expect(await outboxCount(QC_EVENT, record.id)).toBe(1);
    expect(await auditCount(QC_FINALIZED, record.id)).toBe(1);
  });
});

describe('closure blocker B5', () => {
  it('blocks closure while a mandatory check is configured and no record has passed', async () => {
    const order = await createOpenWorkOrder();
    const version = await advance(order.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);

    // B5b: a mandatory check IS configured tenant-wide by the fixture, so a passed
    // record is required. The eligibility endpoint and the closure command must agree.
    authAs(FULL);
    const blocked = await send(
      CLOSE_WORK_ORDER,
      `/api/v1/work-orders/${order.workOrderId}/closure`,
      { workOrderId: order.workOrderId },
      { toState: 'closed' },
      { version }
    );
    expect(blocked.status).toBe(409);
    const problem = (await blocked.json()) as Problem;
    expect(problem.code).toBe('ERR-WO-001');
    expect(problem.violations?.some((v) => v.path === 'closure.B5')).toBe(true);
  });

  it('clears B5 with a NEW passing record after a failure, leaving the failure recorded', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const failed = (await (await openQc(order.workOrderId)).json()) as QcBody;
    authAs(FULL);
    await finalizeQc(failed.id, { overallResult: 'failed' }, { version: failed.recordVersion });

    const version = await advance(order.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);
    authAs(FULL);
    const stillBlocked = await send(
      CLOSE_WORK_ORDER,
      `/api/v1/work-orders/${order.workOrderId}/closure`,
      { workOrderId: order.workOrderId },
      { toState: 'closed' },
      { version }
    );
    expect(stillBlocked.status).toBe(409);

    // A re-check is a NEW record. The failure is never edited.
    authAs(FULL);
    const retry = (await (await openQc(order.workOrderId)).json()) as QcBody;
    authAs(FULL);
    await finalizeQc(retry.id, { overallResult: 'passed' }, { version: retry.recordVersion });

    authAs(FULL);
    const closed = await send(
      CLOSE_WORK_ORDER,
      `/api/v1/work-orders/${order.workOrderId}/closure`,
      { workOrderId: order.workOrderId },
      { toState: 'closed' },
      { version }
    );
    expect(closed.status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.quality_control_records
          WHERE work_order_id = $1 AND overall_result = 'failed'`,
        [order.workOrderId]
      )
    ).toBe(1);
  });
});

describe('qms.reopen-attempt and qms.reopen-attempt-list', () => {
  it('records the attempt, refuses it, and leaves the work order untouched', async () => {
    const closed = await closedWorkOrder();
    const before = await readWorkOrder(closed.workOrderId);

    authAs(FULL);
    const response = await attemptReopen(closed.workOrderId, {
      reason: 'Customer reports the fault has returned',
    });
    // 201, not 409, and the difference is load-bearing: a thrown refusal aborts the
    // request's transaction and takes the ledger row with it. The request to RECORD an
    // attempt succeeded; the reopen it asked for is refused, and the body says so.
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      attempt: { outcome: string; requestedBy: string };
      refusal: string;
    };
    expect(body.attempt.outcome).toBe('rejected');
    expect(body.refusal).toMatch(/cannot be reopened \(BR-WO-002\)/);
    // The refusal names the alternative rather than leaving the caller stuck.
    expect(body.refusal).toMatch(/rework/);

    // "We refused" and "we refused and changed nothing" are different claims.
    expect(await readWorkOrder(closed.workOrderId)).toEqual(before);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.reopen_attempts
          WHERE work_order_id = $1 AND outcome = 'rejected'`,
        [closed.workOrderId]
      )
    ).toBe(1);
    expect(await auditCount(REOPEN_REFUSED, closed.workOrderId)).toBe(1);

    authAs(FULL);
    const listed = (await (await listReopen(closed.workOrderId)).json()) as {
      items: readonly { outcome: string; requestedBy: string }[];
    };
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.outcome).toBe('rejected');
    // Stamped from the session by `qms.stamp_reopen_attempt`, never claimed.
    expect(listed.items[0]?.requestedBy).toBe(FULL.userId);
  });

  it('refuses an order that is NOT closed as a different fact', async () => {
    const order = await createOpenWorkOrder();

    authAs(FULL);
    const response = await attemptReopen(order.workOrderId, { reason: 'Too early' });
    expect(response.status).toBe(409);
    // `ERR-TRN-001`, not `ERR-QMS-001`: there is nothing to reopen, which is not the
    // same as "you may not reopen it". `qms.attempt_reopen` says which.
    expect(((await response.json()) as Problem).code).toBe('ERR-TRN-001');
    expect(
      await count(`SELECT count(*)::text AS n FROM qms.reopen_attempts WHERE work_order_id = $1`, [
        order.workOrderId,
      ])
    ).toBe(0);
  });

  it('refuses a blank reason, an unpermitted caller and cross-scope callers', async () => {
    const closed = await closedWorkOrder();
    const body = { reason: 'Anything' };

    authAs(FULL);
    expect((await attemptReopen(closed.workOrderId, { reason: '  ' })).status).toBe(422);

    authAs(READER);
    expect((await attemptReopen(closed.workOrderId, body)).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await attemptReopen(closed.workOrderId, body)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await attemptReopen(closed.workOrderId, body)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await attemptReopen(closed.workOrderId, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await attemptReopen(closed.workOrderId, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await listReopen(closed.workOrderId)).status).toBe(404);
  });

  it('records one attempt on an idempotent replay', async () => {
    const closed = await closedWorkOrder();
    const key = crypto.randomUUID();

    authAs(FULL);
    expect((await attemptReopen(closed.workOrderId, { reason: 'Once' }, key)).status).toBe(201);
    expect((await attemptReopen(closed.workOrderId, { reason: 'Once' }, key)).status).toBe(200);
    // One row rather than two: a retrying client must not inflate the very record an
    // auditor reads to count how many times somebody tried.
    expect(
      await count(`SELECT count(*)::text AS n FROM qms.reopen_attempts WHERE work_order_id = $1`, [
        closed.workOrderId,
      ])
    ).toBe(1);
  });
});

describe('qms.rework-create, qms.rework-list and qms.rework-detail', () => {
  it('opens a rework work order sharing the original’s visit, and links the two', async () => {
    const closed = await closedWorkOrder();

    authAs(FULL);
    const response = await createRework(closed.workOrderId, {
      rootCause: 'Incorrect torque on the caliper bolts',
      correctiveAction: 'Re-torque to specification and re-test',
      responsibility: 'workshop',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      reworkWorkOrderId: string;
      link: { id: string; originalWorkOrderId: string; isSafetyCritical: boolean };
    };
    expect(body.link.originalWorkOrderId).toBe(closed.workOrderId);

    // The whole reason this path had to exist: nothing else in the platform can
    // produce `kind = 'rework'`, so without it `qms.rework_links` is unreachable and
    // B6 can never fire.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.work_orders w
           JOIN wo.work_orders o ON o.id = $1
          WHERE w.id = $2 AND w.kind = 'rework'
            AND w.reception_visit_id = o.reception_visit_id
            AND w.vehicle_id = o.vehicle_id`,
        [closed.workOrderId, body.reworkWorkOrderId]
      )
    ).toBe(1);
    expect(await auditCount(REWORK_CREATED, body.link.id)).toBe(1);
    expect(await outboxCount(REWORK_EVENT, body.link.id)).toBe(1);

    authAs(FULL);
    const listed = (await (await listRework(closed.workOrderId)).json()) as {
      items: readonly { id: string }[];
    };
    expect(listed.items.map((l) => l.id)).toEqual([body.link.id]);

    authAs(FULL);
    const detail = await readRework(body.link.id);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { rootCause: string }).rootCause).toBe(
      'Incorrect torque on the caliper bolts'
    );
  });

  it('refuses an original that is not CLOSED', async () => {
    const order = await createOpenWorkOrder();

    authAs(FULL);
    const response = await createRework(order.workOrderId, {
      rootCause: 'Too early',
      correctiveAction: 'None',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Problem).code).toBe('ERR-TRN-001');
  });

  it('refuses a CANCELLED original, which the database alone would accept', async () => {
    const order = await createOpenWorkOrder();
    await advance(order.workOrderId, [
      { toState: 'cancelled', reason: 'Customer took the vehicle away' },
    ]);

    // The seeded `cancelled` row carries `is_closed = true` as well as
    // `is_cancellation = true`, so `qms.guard_rework_link_coherence` — which reads only
    // `is_closed` — would let this through. An earlier revision of the service asserted
    // the opposite ("cancelled is terminal and NOT closed") in five places and was
    // wrong about the seed, which means it would have created a rework case against
    // abandoned work. Rework corrects work that was DONE badly.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.work_order_states
          WHERE code = 'cancelled' AND scope = 'platform' AND is_closed AND is_cancellation`
      )
    ).toBe(1);

    authAs(FULL);
    const response = await createRework(order.workOrderId, {
      rootCause: 'Nothing was done',
      correctiveAction: 'Nothing to correct',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Problem).code).toBe('ERR-TRN-001');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links WHERE original_work_order_id = $1`,
        [order.workOrderId]
      )
    ).toBe(0);
  });

  it('refuses safety-critical rework with no lead technician, writing nothing', async () => {
    const closed = await closedWorkOrder();

    // `ck_rework_links_safety_lead` is the enforcement; the pre-check makes it a 422
    // naming the field rather than a `23514`. Nothing may be written, because a rework
    // work order without its link would be an unattached order nobody could find.
    authAs(FULL);
    const response = await createRework(closed.workOrderId, {
      rootCause: 'Brake failure after release',
      correctiveAction: 'Full brake system re-inspection',
      isSafetyCritical: true,
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Problem).violations?.[0]?.rule).toBe('required');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.work_orders WHERE kind = 'rework'
           AND reception_visit_id = (SELECT reception_visit_id FROM wo.work_orders WHERE id = $1)`,
        [closed.workOrderId]
      )
    ).toBe(0);
  });

  it('refuses an out-of-scope lead technician', async () => {
    const closed = await closedWorkOrder();

    // The composite foreign key would refuse an out-of-branch profile with a bare
    // 23503; the module read tells the caller which of the two things was wrong.
    authAs(FULL);
    const response = await createRework(closed.workOrderId, {
      rootCause: 'Brake failure',
      correctiveAction: 'Re-inspect',
      isSafetyCritical: true,
      leadTechnicianId: crypto.randomUUID(),
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as Problem).code).toBe('ERR-RES-001');
  });

  it('refuses an unpermitted or cross-scope caller, and creates once on replay', async () => {
    const closed = await closedWorkOrder();
    const body = { rootCause: 'Cause', correctiveAction: 'Action' };
    const key = crypto.randomUUID();

    authAs(READER);
    expect((await createRework(closed.workOrderId, body)).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await createRework(closed.workOrderId, body)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await createRework(closed.workOrderId, body)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await createRework(closed.workOrderId, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await createRework(closed.workOrderId, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await listRework(closed.workOrderId)).status).toBe(404);

    authAs(FULL);
    expect((await createRework(closed.workOrderId, body, key)).status).toBe(201);
    expect((await createRework(closed.workOrderId, body, key)).status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links WHERE original_work_order_id = $1`,
        [closed.workOrderId]
      )
    ).toBe(1);
  });

  it('rollback: a failed creation leaves neither the rework order nor a link', async () => {
    const closed = await closedWorkOrder();

    // A genuine failure on the real path, and one the service cannot pre-check:
    // `wo.guard_work_order_refs` requires an `accepted` custody event on the reception
    // visit, and that is checked by the trigger on the INSERT. Removing it makes the
    // rework order's insert fail AFTER the display number has been allocated — three
    // statements into the transaction — so this proves the allocation rolls back too,
    // not merely that a refused request writes nothing.
    const before = await count(
      `SELECT count(*)::text AS n FROM wo.work_orders WHERE kind = 'rework'`
    );
    const sequenceBefore = await count(
      `SELECT next_value::text AS n FROM shared.number_sequences
        WHERE sequence_code = 'work_order'
          AND tenant_id = (SELECT tenant_id FROM wo.work_orders WHERE id = $1)`,
      [closed.workOrderId]
    );
    await admin.query(
      `UPDATE rec.custody_history SET to_state = 'released'
        WHERE reception_visit_id = (
          SELECT reception_visit_id FROM wo.work_orders WHERE id = $1)
          AND to_state = 'accepted'`,
      [closed.workOrderId]
    );

    authAs(FULL);
    const response = await createRework(closed.workOrderId, {
      rootCause: 'C',
      correctiveAction: 'D',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Problem).code).toBe('ERR-TRN-001');

    // No rework order, no link — and the sequence's advance rolled back with them, so
    // a later legitimate allocation does not skip a number.
    expect(
      await count(`SELECT count(*)::text AS n FROM wo.work_orders WHERE kind = 'rework'`)
    ).toBe(before);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links WHERE original_work_order_id = $1`,
        [closed.workOrderId]
      )
    ).toBe(0);
    expect(
      await count(
        `SELECT next_value::text AS n FROM shared.number_sequences
          WHERE sequence_code = 'work_order'
            AND tenant_id = (SELECT tenant_id FROM wo.work_orders WHERE id = $1)`,
        [closed.workOrderId]
      )
    ).toBe(sequenceBefore);
  });
});

describe('qms.rework-sign-off and closure blocker B6', () => {
  it('blocks the rework order’s closure until safety-critical rework is signed off', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, {
        rootCause: 'Brake failure after release',
        correctiveAction: 'Full brake system re-inspection',
        isSafetyCritical: true,
        leadTechnicianId: TECH_A1,
      })
    ).json()) as { reworkWorkOrderId: string; link: { id: string; recordVersion: number } };

    // The rework order needs its own QC pass for B5b, then B6 is what remains.
    authAs(FULL);
    const qc = (await (await openQc(created.reworkWorkOrderId)).json()) as QcBody;
    authAs(FULL);
    await finalizeQc(qc.id, { overallResult: 'passed' }, { version: qc.recordVersion });
    const version = await advance(created.reworkWorkOrderId, [
      { toState: 'open' },
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);

    authAs(FULL);
    const blocked = await send(
      CLOSE_WORK_ORDER,
      `/api/v1/work-orders/${created.reworkWorkOrderId}/closure`,
      { workOrderId: created.reworkWorkOrderId },
      { toState: 'closed' },
      { version }
    );
    expect(blocked.status).toBe(409);
    const problem = (await blocked.json()) as Problem;
    expect(problem.code).toBe('ERR-WO-001');
    expect(problem.violations?.some((v) => v.path === 'closure.B6')).toBe(true);

    // Signed by a DIFFERENT technician — `ck_rework_links_signoff_distinct`.
    authAs(REVIEWER);
    const signed = await signOff(
      created.link.id,
      { signOffBy: TECH_A1_ALT },
      { version: created.link.recordVersion }
    );
    expect(signed.status).toBe(200);
    const link = (await signed.json()) as { independentSignOffBy: string; signOffAt: string };
    expect(link.independentSignOffBy).toBe(TECH_A1_ALT);
    // Stamped by `qms.guard_rework_signoff`, never sent.
    expect(link.signOffAt).toBeTruthy();
    expect(await auditCount(REWORK_SIGNED, created.link.id)).toBe(1);

    authAs(FULL);
    const closedNow = await send(
      CLOSE_WORK_ORDER,
      `/api/v1/work-orders/${created.reworkWorkOrderId}/closure`,
      { workOrderId: created.reworkWorkOrderId },
      { toState: 'closed' },
      { version }
    );
    expect(closedNow.status).toBe(200);
  });

  it('refuses a sign-off by the technician who did the work — the CHECK, driven end to end', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, {
        rootCause: 'Safety fault',
        correctiveAction: 'Re-inspect',
        isSafetyCritical: true,
        leadTechnicianId: TECH_A1,
      })
    ).json()) as { link: { id: string; recordVersion: number } };

    authAs(REVIEWER);
    const response = await signOff(
      created.link.id,
      { signOffBy: TECH_A1 },
      { version: created.link.recordVersion }
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as Problem).code).toBe('ERR-QMS-001');
    // Nothing was signed: the refusal is not merely a status code.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links
          WHERE id = $1 AND independent_sign_off_by IS NULL AND sign_off_at IS NULL`,
        [created.link.id]
      )
    ).toBe(1);
  });

  it('reaches the CHECK itself on a NON-safety-critical link, where the pre-check declines to look', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, {
        rootCause: 'Ordinary correction',
        correctiveAction: 'Redo the adjustment',
        // NOT safety-critical, and with a lead technician. `assertIndependentSignOff`
        // returns immediately for a non-safety-critical link — deliberately, because
        // imposing independence on routine corrections would block a single-technician
        // branch — so this is the case where the application pre-check does NOT fire
        // and `ck_rework_links_signoff_distinct` is the only thing left.
        isSafetyCritical: false,
        leadTechnicianId: TECH_A1,
      })
    ).json()) as { link: { id: string; recordVersion: number } };

    authAs(REVIEWER);
    const response = await signOff(
      created.link.id,
      { signOffBy: TECH_A1 },
      { version: created.link.recordVersion }
    );
    // The CHECK constraint, mapped rather than surfaced as a bare 23514. Without this
    // case the constraint was never exercised: every other sign-off refusal in the
    // suite stopped at the pre-check, so removing the CHECK would have left the whole
    // suite green.
    expect(response.status).toBe(409);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-QMS-001');
    expect(problem.violations?.[0]?.rule).toBe('not_independent');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_links
          WHERE id = $1 AND independent_sign_off_by IS NULL`,
        [created.link.id]
      )
    ).toBe(1);
  });

  it('makes the signature write-once', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, {
        rootCause: 'Fault',
        correctiveAction: 'Fix',
        isSafetyCritical: true,
        leadTechnicianId: TECH_A1,
      })
    ).json()) as { link: { id: string; recordVersion: number } };

    authAs(REVIEWER);
    const first = await signOff(
      created.link.id,
      { signOffBy: TECH_A1_ALT },
      { version: created.link.recordVersion }
    );
    expect(first.status).toBe(200);
    const version = ((await first.json()) as { recordVersion: number }).recordVersion;

    authAs(REVIEWER);
    const again = await signOff(created.link.id, { signOffBy: TECH_A1_ALT }, { version });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Problem).code).toBe('ERR-TRN-001');
  });

  it('refuses a caller without qms.rework.sign_off, a stale version and cross-scope callers', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string; recordVersion: number } };
    const body = { signOffBy: TECH_A1_ALT };
    const version = created.link.recordVersion;

    // `FULL` creates rework cases and does NOT hold the sign-off permission — the two
    // halves BR-QMS-001 keeps apart.
    authAs(FULL);
    expect((await signOff(created.link.id, body, { version })).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await signOff(created.link.id, body, { version })).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await signOff(created.link.id, body, { version })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await signOff(created.link.id, body, { version })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await signOff(created.link.id, body, { version })).status).toBe(404);

    authAs(REVIEWER);
    const stale = await signOff(created.link.id, body, { version: version + 5 });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Problem).code).toBe('ERR-CON-001');
    authAs(REVIEWER);
    expect((await signOff(created.link.id, body, { version: null })).status).toBe(428);
  });

  it('signs off once on an idempotent replay', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string; recordVersion: number } };
    const key = crypto.randomUUID();

    authAs(REVIEWER);
    expect(
      (
        await signOff(
          created.link.id,
          { signOffBy: TECH_A1_ALT },
          { version: created.link.recordVersion, key }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await signOff(
          created.link.id,
          { signOffBy: TECH_A1_ALT },
          { version: created.link.recordVersion, key }
        )
      ).status
    ).toBe(200);
    expect(await auditCount(REWORK_SIGNED, created.link.id)).toBe(1);
  });
});

describe('qms.rework-cost-record and qms.rework-cost-read', () => {
  it('records and reads the restricted cost for a caller holding iam.sensitive.view', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string } };

    authAs(SENSITIVE);
    const written = await writeCost(created.link.id, {
      reworkCost: '1234.5678',
      costCurrency: 'JOD',
    });
    expect(written.status).toBe(200);
    const cost = (await written.json()) as { reworkCost: string; classification: string };
    // A decimal STRING all the way through: `numeric(14,4)` holds values IEEE-754
    // cannot, so the scale must survive the round trip exactly.
    expect(cost.reworkCost).toBe('1234.5678');
    expect(cost.classification).toBe('restricted');
    expect(await auditCount(COST_RECORDED, created.link.id)).toBe(1);

    authAs(SENSITIVE);
    const readBack = await readCost(created.link.id);
    expect(readBack.status).toBe(200);
    expect(((await readBack.json()) as { reworkCost: string }).reworkCost).toBe('1234.5678');
    expect(await auditCount(COST_READ, created.link.id)).toBe(1);
  });

  it('refuses a caller with the functional permission but WITHOUT iam.sensitive.view', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string } };

    // `FULL` holds `qms.rework.manage` and `qms.quality_control.read` and differs from
    // `SENSITIVE` by exactly one permission — the control, checked before any row is
    // touched, with the RLS policy as defence in depth behind it.
    authAs(FULL);
    expect(
      (await writeCost(created.link.id, { reworkCost: '1.0000', costCurrency: 'JOD' })).status
    ).toBe(403);
    expect((await readCost(created.link.id)).status).toBe(403);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_link_details WHERE rework_link_id = $1`,
        [created.link.id]
      )
    ).toBe(0);
  });

  it('does not put the figure into the audit trail', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string } };
    authAs(SENSITIVE);
    await writeCost(created.link.id, { reworkCost: '98765.4321', costCurrency: 'JOD' });

    // `iam.audit_records` is NOT gated by `iam.sensitive.view`, so a figure copied
    // there would be readable by every auditor.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM iam.audit_record_details d
           JOIN iam.audit_records r ON r.id = d.audit_record_id
          WHERE r.entity_id = $1 AND (d.new_value_masked LIKE '%98765%'
                                      OR d.old_value_masked LIKE '%98765%')`,
        [created.link.id]
      )
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_link_details
          WHERE rework_link_id = $1 AND rework_cost = 98765.4321`,
        [created.link.id]
      )
    ).toBe(1);
  });

  it('refuses a malformed figure and an unknown currency', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string } };

    authAs(SENSITIVE);
    expect(
      (await writeCost(created.link.id, { reworkCost: '-1.0000', costCurrency: 'JOD' })).status
    ).toBe(422);
    authAs(SENSITIVE);
    expect(
      (await writeCost(created.link.id, { reworkCost: '1.00000', costCurrency: 'JOD' })).status
    ).toBe(422);
    authAs(SENSITIVE);
    expect(
      (await writeCost(created.link.id, { reworkCost: '1.0000', costCurrency: 'jod' })).status
    ).toBe(422);
  });

  it('isolates the cost surface by branch and by tenant, and writes once on replay', async () => {
    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string } };
    const body = { reworkCost: '5.0000', costCurrency: 'JOD' };
    const key = crypto.randomUUID();

    // Both narrowed principals hold `iam.sensitive.view` scoped to BRANCH_A2, so their
    // refusal is the SCOPE check and not a missing permission.
    authAs(PERMISSION_ELSEWHERE);
    expect((await writeCost(created.link.id, body)).status).toBe(403);
    expect((await readCost(created.link.id)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await writeCost(created.link.id, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await readCost(created.link.id)).status).toBe(404);

    authAs(SENSITIVE);
    expect((await writeCost(created.link.id, body, key)).status).toBe(200);
    expect((await writeCost(created.link.id, body, key)).status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM qms.rework_link_details
          WHERE rework_link_id = $1 AND deleted_at IS NULL`,
        [created.link.id]
      )
    ).toBe(1);
  });

  it('keeps a tenant-B rework case out of tenant A’s reach', async () => {
    const tenantB = await createOpenWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    expect(tenantB.workOrderId).toBeTruthy();

    const closed = await closedWorkOrder();
    authAs(FULL);
    const created = (await (
      await createRework(closed.workOrderId, { rootCause: 'X', correctiveAction: 'Y' })
    ).json()) as { link: { id: string } };

    authAs(TENANT_B_FULL);
    expect((await readRework(created.link.id)).status).toBe(404);
  });
});
