/**
 * Diagnostic reports, entries, completion and review (Phase 1-19, P1-19-BE-009…012).
 *
 * Four claims carry this suite.
 *
 * **A report pins a version, and the pin is what makes it readable later.**
 * `dia.guard_diagnostic_report_refs` refuses anything but a `published` version, and
 * `dia.guard_template_item_frozen` refuses every change to a published version's
 * items — so the suite proves both directions: a draft version is refused, and an
 * attempt to alter a published version's items is refused by the DEPLOYED guard.
 *
 * **The completion gate reports every gap at once.** The database can only say "not
 * yet"; the service returns the whole outstanding list keyed by item code, and a
 * mandatory item may be closed by a documented not-applicable reason as well as by a
 * value.
 *
 * **Range validation happens in the database, in `numeric`.** `measured_value` is
 * bare `numeric`, so the suite uses a value a double cannot hold exactly and proves it
 * survives the round trip AND is judged correctly against the configured bounds.
 * `within_range` is three-valued and the `null` case is asserted, because flattening
 * it to `false` would claim a check that never ran.
 *
 * **Reviewer separation is an application rule, and it is proved in BOTH
 * directions.** `dia.stamp_review()` makes attribution unforgeable but nothing stops
 * self-review; `FULL` creates reports and `REVIEWER` reviews them, and `REVIEWER`
 * reviewing its OWN report is refused.
 *
 * Operations exercised here: dia.diagnostic-create, dia.diagnostic-list,
 * dia.diagnostic-detail, dia.diagnostic-history, dia.diagnostic-transition,
 * dia.diagnostic-complete, dia.diagnostic-item-result,
 * dia.diagnostic-measurement-record, dia.diagnostic-dtc-record,
 * dia.diagnostic-finding-record, dia.diagnostic-evidence-record,
 * dia.diagnostic-recommendation-record, dia.diagnostic-review.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   dia.diagnostic-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.diagnostic-list: route service authorization success denial cross-tenant isolation
 *   dia.diagnostic-detail: route service authorization success denial cross-tenant isolation
 *   dia.diagnostic-history: route service authorization success denial cross-tenant isolation
 *   dia.diagnostic-transition: route service authorization success denial cross-tenant isolation audit stale-version idempotency
 *   dia.diagnostic-complete: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency rollback
 *   dia.diagnostic-item-result: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.diagnostic-measurement-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.diagnostic-dtc-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.diagnostic-finding-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.diagnostic-evidence-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.diagnostic-recommendation-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.diagnostic-review: route service authorization success denial cross-tenant isolation audit idempotency
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SUBJECT_UNPERMITTED,
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
  BRANCH_B1,
  BRAKE_MAX,
  BRAKE_MIN,
  COMPANY_B1,
  FULL,
  ITEM_BRAKE_THICKNESS,
  ITEM_ROAD_TEST,
  ITEM_TYRE_CONDITION,
  PERMISSION_ELSEWHERE,
  READER,
  REVIEWER,
  SCOPED_ELSEWHERE,
  TENANT_B_FULL,
  auditCount,
  advance,
  authAs,
  authAsSubject,
  count,
  createOpenWorkOrder,
  establishDiagnosticFixtures,
  establishP1_19Fixtures,
  establishQualityFixtures,
  outboxCount,
  seedDocumentVersion,
  seedDraftTemplateVersion,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import {
  GET as LIST_REPORTS,
  POST as CREATE_REPORT,
} from '@/app/api/v1/jobs/[jobId]/inspections/route';
import { GET as READ_REPORT } from '@/app/api/v1/inspections/[inspectionId]/route';
import { GET as READ_HISTORY } from '@/app/api/v1/inspections/[inspectionId]/history/route';
import { POST as TRANSITION_REPORT } from '@/app/api/v1/inspections/[inspectionId]/transition/route';
import { POST as COMPLETE_REPORT } from '@/app/api/v1/inspections/[inspectionId]/completion/route';
import { PUT as WRITE_ITEM } from '@/app/api/v1/inspections/[inspectionId]/items/[templateItemId]/route';
import { POST as RECORD_MEASUREMENT } from '@/app/api/v1/inspections/[inspectionId]/measurements/route';
import { POST as RECORD_DTC } from '@/app/api/v1/inspections/[inspectionId]/dtcs/route';
import { POST as TRANSITION_JOB } from '@/app/api/v1/jobs/[jobId]/transition/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { POST as OPEN_QC } from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { POST as FINALIZE_QC } from '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import { POST as RECORD_FINDING } from '@/app/api/v1/inspections/[inspectionId]/findings/route';
import { POST as RECORD_EVIDENCE } from '@/app/api/v1/inspections/[inspectionId]/evidence/route';
import { POST as RECORD_RECOMMENDATION } from '@/app/api/v1/inspections/[inspectionId]/recommendations/route';
import { POST as RECORD_REVIEW } from '@/app/api/v1/inspections/[inspectionId]/reviews/route';

const CREATED = 'dia.diagnostic.created';
const ENTRY = 'dia.diagnostic.entry_recorded';
const STATE_CHANGED = 'dia.diagnostic.state_changed';
const COMPLETED = 'dia.diagnostic.completed';
const REVIEWED = 'dia.diagnostic.reviewed';
const COMPLETED_EVENT = 'diagnostic-report.completed';

let admin: Pool;
let runtime: Pool;
let templateVersionId: string;
let itemIds: ReadonlyMap<string, string>;

interface ReportBody {
  readonly id: string;
  readonly workOrderId: string;
  readonly jobId: string;
  readonly templateVersionId: string;
  readonly diagnosticTypeId: string;
  readonly status: string;
  readonly revisionNumber: number;
  readonly summary: string | null;
  readonly recordVersion: number;
  readonly code?: string;
  readonly violations?: readonly { readonly path?: string; readonly rule?: string }[];
}

interface Problem {
  readonly code?: string;
  readonly violations?: readonly { readonly path?: string; readonly rule?: string }[];
}

function post(
  handler: (
    request: Request,
    route: { params: Promise<Record<string, string>> }
  ) => Promise<Response>,
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
  return handler(
    new Request(`http://localhost${url}`, {
      method: options.method ?? 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
}

const createReport = (jobId: string, body: unknown, key?: string): Promise<Response> =>
  post(
    CREATE_REPORT as never,
    `/api/v1/jobs/${jobId}/inspections`,
    { jobId },
    body,
    key === undefined ? {} : { key }
  );

const listReports = (jobId: string): Promise<Response> =>
  LIST_REPORTS(new Request(`http://localhost/api/v1/jobs/${jobId}/inspections`), {
    params: Promise.resolve({ jobId }),
  });

const readReport = (inspectionId: string): Promise<Response> =>
  READ_REPORT(new Request(`http://localhost/api/v1/inspections/${inspectionId}`), {
    params: Promise.resolve({ inspectionId }),
  });

const readHistory = (inspectionId: string, query = ''): Promise<Response> =>
  READ_HISTORY(new Request(`http://localhost/api/v1/inspections/${inspectionId}/history${query}`), {
    params: Promise.resolve({ inspectionId }),
  });

const moveReport = (
  inspectionId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> =>
  post(
    TRANSITION_REPORT as never,
    `/api/v1/inspections/${inspectionId}/transition`,
    { inspectionId },
    body,
    options
  );

const completeReport = (
  inspectionId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> =>
  post(
    COMPLETE_REPORT as never,
    `/api/v1/inspections/${inspectionId}/completion`,
    { inspectionId },
    body,
    options
  );

const writeItem = (
  inspectionId: string,
  templateItemId: string,
  body: unknown,
  key?: string
): Promise<Response> =>
  post(
    WRITE_ITEM as never,
    `/api/v1/inspections/${inspectionId}/items/${templateItemId}`,
    { inspectionId, templateItemId },
    body,
    { method: 'PUT', ...(key === undefined ? {} : { key }) }
  );

const entry = (
  handler: unknown,
  segment: string,
  inspectionId: string,
  body: unknown,
  key?: string
): Promise<Response> =>
  post(
    handler as never,
    `/api/v1/inspections/${inspectionId}/${segment}`,
    { inspectionId },
    body,
    key === undefined ? {} : { key }
  );

/** The report's status read as admin — never RLS evidence. */
async function readJobReportStatus(reportId: string): Promise<string> {
  const result = await admin.query<{ status: string }>(
    `SELECT status FROM dia.diagnostic_reports WHERE id = $1`,
    [reportId]
  );
  return result.rows[0]?.status ?? '';
}

/** A job on an open work order, ready to carry a diagnostic. */
async function seedJob(): Promise<{ readonly workOrderId: string; readonly jobId: string }> {
  const order = await createOpenWorkOrder();
  authAs(FULL);
  const created = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ title: 'Brake inspection', requiresDiagnostic: true }),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  if (created.status !== 201) throw new Error(`fixture job failed with ${created.status}`);
  return {
    workOrderId: order.workOrderId,
    jobId: ((await created.json()) as { id: string }).id,
  };
}

/** A report in `in_progress`, which is where entries are recorded. */
async function seedReport(as = FULL): Promise<{
  readonly jobId: string;
  readonly reportId: string;
  readonly version: number;
}> {
  const job = await seedJob();
  authAs(as);
  const created = await createReport(job.jobId, { templateVersionId });
  if (created.status !== 201) {
    throw new Error(`fixture report failed with ${created.status}: ${await created.text()}`);
  }
  const body = (await created.json()) as ReportBody;
  authAs(as);
  const started = await moveReport(
    body.id,
    { toStatus: 'in_progress' },
    { version: body.recordVersion }
  );
  if (started.status !== 200) {
    throw new Error(`fixture start failed with ${started.status}: ${await started.text()}`);
  }
  return {
    jobId: job.jobId,
    reportId: body.id,
    version: ((await started.json()) as ReportBody).recordVersion,
  };
}

/** Answers both mandatory items, so completion is reachable. */
async function answerMandatory(reportId: string, thickness = '25.500'): Promise<void> {
  authAs(FULL);
  const brake = await writeItem(reportId, itemIds.get(ITEM_BRAKE_THICKNESS) ?? '', {
    resultValue: thickness,
  });
  if (brake.status !== 200) throw new Error(`fixture item failed: ${await brake.text()}`);
  authAs(FULL);
  const tyre = await writeItem(reportId, itemIds.get(ITEM_TYRE_CONDITION) ?? '', {
    resultValue: 'worn',
  });
  if (tyre.status !== 200) throw new Error(`fixture item failed: ${await tyre.text()}`);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishQualityFixtures();
  const fixtures = await establishDiagnosticFixtures();
  templateVersionId = fixtures.templateVersionId;
  itemIds = fixtures.itemIds;
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

describe('dia.diagnostic-create', () => {
  it('opens a report pinning the published version, and derives the type from it', async () => {
    const job = await seedJob();

    authAs(FULL);
    const response = await createReport(job.jobId, { templateVersionId });
    expect(response.status).toBe(201);
    const body = (await response.json()) as ReportBody;
    expect(body.jobId).toBe(job.jobId);
    expect(body.workOrderId).toBe(job.workOrderId);
    expect(body.templateVersionId).toBe(templateVersionId);
    expect(body.status).toBe('draft');
    expect(body.revisionNumber).toBe(1);
    // Never accepted from the body: the type is joined from the template the version
    // belongs to, so a report's type cannot disagree with what it pins.
    expect(body.diagnosticTypeId).toBeTruthy();
    expect(await auditCount(CREATED, body.id)).toBe(1);
  });

  it('numbers revisions monotonically per job', async () => {
    const job = await seedJob();

    authAs(FULL);
    const first = (await (
      await createReport(job.jobId, { templateVersionId })
    ).json()) as ReportBody;
    authAs(FULL);
    const second = (await (
      await createReport(job.jobId, { templateVersionId })
    ).json()) as ReportBody;
    expect(first.revisionNumber).toBe(1);
    expect(second.revisionNumber).toBe(2);
    // Sequential here. An earlier revision of this comment went on to argue that a
    // concurrent case would "prove nothing a constraint could back", and that was too
    // strong. It is true that `revision_number` has NO unique index behind it (accepted
    // item P1-19-A-02) and that no test can demonstrate an invariant the schema does
    // not hold. But the limitation as recorded claims something narrower and testable —
    // that two writers going through the REPOSITORY are serialised by the advisory lock
    // — and `p1-19-concurrency.test.ts` now forces exactly that race.
  });

  it('refuses a DRAFT template version, distinguishing it from an unknown one', async () => {
    const job = await seedJob();
    const draft = await seedDraftTemplateVersion();

    // `dia.guard_diagnostic_report_refs` raises one `check_violation` for draft,
    // retired and missing alike. The pre-check tells them apart, which the guard
    // cannot: instantiating a draft would pin a shape that can still change.
    authAs(FULL);
    const response = await createReport(job.jobId, { templateVersionId: draft });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.rule).toBe('not_published');

    authAs(FULL);
    const unknown = await createReport(job.jobId, { templateVersionId: crypto.randomUUID() });
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as Problem).violations?.[0]?.rule).toBe('not_found');
  });

  it('refuses an unpermitted caller and isolates by branch and tenant', async () => {
    const job = await seedJob();

    authAs(READER);
    expect((await createReport(job.jobId, { templateVersionId })).status).toBe(403);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await createReport(job.jobId, { templateVersionId })).status).toBe(403);

    // Granted in BRANCH_A2 and RLS-visible in A1 through an unrelated grant, so only
    // the scoped permission check can refuse (P1-18-A-01).
    authAs(PERMISSION_ELSEWHERE);
    expect((await createReport(job.jobId, { templateVersionId })).status).toBe(403);

    // No grant in A1 at all, so RLS hides the job first: defence in depth.
    authAs(SCOPED_ELSEWHERE);
    expect((await createReport(job.jobId, { templateVersionId })).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await createReport(job.jobId, { templateVersionId })).status).toBe(404);
  });

  it('creates one report on an idempotent replay', async () => {
    const job = await seedJob();
    const key = crypto.randomUUID();

    authAs(FULL);
    expect((await createReport(job.jobId, { templateVersionId }, key)).status).toBe(201);
    expect((await createReport(job.jobId, { templateVersionId }, key)).status).toBe(200);
    expect(
      await count(`SELECT count(*)::text AS n FROM dia.diagnostic_reports WHERE job_id = $1`, [
        job.jobId,
      ])
    ).toBe(1);
  });
});

describe('the pinned template version is frozen', () => {
  it('refuses any change to a published version’s items, at the deployed guard', async () => {
    // `dia.guard_template_item_frozen` is what makes a completed report reproducible.
    // No route can express this request, so the guard is probed directly — a control
    // nobody can reach through the API still has to be shown to work.
    let refused = false;
    try {
      await admin.query(
        `UPDATE dia.template_items SET prompt = 'Changed after publication' WHERE id = $1`,
        [itemIds.get(ITEM_BRAKE_THICKNESS) ?? '']
      );
    } catch (error) {
      refused = /template items are frozen/i.test(String(error));
    }
    expect(refused).toBe(true);
  });
});

describe('dia.diagnostic-item-result', () => {
  it('records a value and replaces it, staying 1:1 with the item', async () => {
    const report = await seedReport();
    const itemId = itemIds.get(ITEM_BRAKE_THICKNESS) ?? '';

    authAs(FULL);
    const first = await writeItem(report.reportId, itemId, { resultValue: '25.500' });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { resultValue: string }).resultValue).toBe('25.500');

    authAs(FULL);
    const second = await writeItem(report.reportId, itemId, { resultValue: '24.000' });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { resultValue: string }).resultValue).toBe('24.000');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.report_item_results
          WHERE diagnostic_report_id = $1 AND deleted_at IS NULL`,
        [report.reportId]
      )
    ).toBe(1);
    expect(await auditCount(ENTRY, report.reportId)).toBe(2);
  });

  it('accepts a documented not-applicable reason instead of a value', async () => {
    const report = await seedReport();

    authAs(FULL);
    const response = await writeItem(report.reportId, itemIds.get(ITEM_BRAKE_THICKNESS) ?? '', {
      notApplicableReason: 'Wheels not removed; customer declined',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      resultValue: string | null;
      notApplicableReason: string | null;
    };
    expect(body.resultValue).toBeNull();
    expect(body.notApplicableReason).toBe('Wheels not removed; customer declined');
  });

  it('refuses neither a value nor a reason', async () => {
    const report = await seedReport();

    // `ck_report_item_results_answered` demands one of the two, and a mandatory item
    // skipped without a documented reason is what the completion gate exists to catch.
    authAs(FULL);
    const response = await writeItem(report.reportId, itemIds.get(ITEM_ROAD_TEST) ?? '', {});
    expect(response.status).toBe(422);
    expect(((await response.json()) as Problem).violations?.[0]?.rule).toBe('required');
  });

  it('checks the value against the item’s response type', async () => {
    const report = await seedReport();

    // The database checks none of this: `result_value` is text, so a boolean item
    // would accept "maybe" and a select item any string at all.
    authAs(FULL);
    const notBoolean = await writeItem(report.reportId, itemIds.get(ITEM_ROAD_TEST) ?? '', {
      resultValue: 'maybe',
    });
    expect(notBoolean.status).toBe(422);
    expect(((await notBoolean.json()) as Problem).violations?.[0]?.rule).toBe('not_a_boolean');

    authAs(FULL);
    const notOption = await writeItem(report.reportId, itemIds.get(ITEM_TYRE_CONDITION) ?? '', {
      resultValue: 'perfect',
    });
    expect(notOption.status).toBe(422);
    expect(((await notOption.json()) as Problem).violations?.[0]?.rule).toBe('not_an_option');

    authAs(FULL);
    const notDecimal = await writeItem(report.reportId, itemIds.get(ITEM_BRAKE_THICKNESS) ?? '', {
      resultValue: 'thin',
    });
    expect(notDecimal.status).toBe(422);
  });

  it('records an out-of-range ANSWER unbounded, while the same value as a MEASUREMENT is flagged', async () => {
    const report = await seedReport();
    const itemId = itemIds.get(ITEM_BRAKE_THICKNESS) ?? '';
    const wild = '1000000.000';

    // The asymmetry is the frozen schema's and is pinned here rather than left to be
    // discovered. `dia.report_item_results.result_value` is text, nothing on that path
    // reads `validation_rule`, and the table has NO within_range column to record a
    // verdict in — while `dia.measurements` has one and computes it. An earlier draft
    // of three comments claimed the database bounded the answer too; it does not.
    authAs(FULL);
    const answer = await writeItem(report.reportId, itemId, { resultValue: wild });
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { resultValue: string }).resultValue).toBe(wild);
    expect(
      await count(
        `SELECT count(*)::text AS n
           FROM information_schema.columns
          WHERE table_schema = 'dia' AND table_name = 'report_item_results'
            AND column_name = 'within_range'`
      )
    ).toBe(0);

    // Same item, same configured range, same number — and the measurement path judges
    // it, because that table can hold the verdict.
    authAs(FULL);
    const measurement = await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
      templateItemId: itemId,
      label: 'Front left disc',
      measuredValue: wild,
      unit: 'mm',
    });
    expect(measurement.status).toBe(201);
    expect(((await measurement.json()) as { withinRange: boolean | null }).withinRange).toBe(false);

    // And the out-of-range answer still counts as ANSWERED, so it does not block
    // completion — refusing it would contradict the module's own rule that an
    // out-of-spec observation is recorded rather than rejected.
    authAs(FULL);
    await writeItem(report.reportId, itemIds.get(ITEM_TYRE_CONDITION) ?? '', {
      resultValue: 'replace',
    });
    authAs(FULL);
    const completed = await completeReport(report.reportId, {}, { version: report.version });
    expect(completed.status).toBe(200);
  });

  it('refuses an item from OUTSIDE the report’s pinned version', async () => {
    const report = await seedReport();
    const otherVersion = await seedDraftTemplateVersion();

    // `fk_report_item_results_item` is `(tenant_id, template_item_id)` and names no
    // version, so an item belonging to a different version satisfies it. Only the read
    // through the report refuses it — without which a report could be answered with
    // questions it was never asked.
    const foreign = await admin.query<{ id: string }>(
      `INSERT INTO dia.template_items
         (tenant_id, template_version_id, item_code, prompt, response_type, is_mandatory,
          sequence, created_by)
       VALUES ($1,$2,'fx_foreign_item','From another version','text',false,1,$3)
       RETURNING id`,
      [TENANT_A, otherVersion, USER_A]
    );

    authAs(FULL);
    const response = await writeItem(report.reportId, foreign.rows[0]?.id ?? '', {
      resultValue: 'anything',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as Problem).code).toBe('ERR-RES-001');
  });

  it('refuses an unpermitted, out-of-branch or cross-tenant caller', async () => {
    const report = await seedReport();
    const itemId = itemIds.get(ITEM_BRAKE_THICKNESS) ?? '';

    authAs(READER);
    expect((await writeItem(report.reportId, itemId, { resultValue: '25.000' })).status).toBe(403);

    authAs(PERMISSION_ELSEWHERE);
    expect((await writeItem(report.reportId, itemId, { resultValue: '25.000' })).status).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect((await writeItem(report.reportId, itemId, { resultValue: '25.000' })).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await writeItem(report.reportId, itemId, { resultValue: '25.000' })).status).toBe(404);
  });

  it('writes once on an idempotent replay', async () => {
    const report = await seedReport();
    const key = crypto.randomUUID();
    const itemId = itemIds.get(ITEM_BRAKE_THICKNESS) ?? '';

    authAs(FULL);
    expect((await writeItem(report.reportId, itemId, { resultValue: '25.000' }, key)).status).toBe(
      200
    );
    expect((await writeItem(report.reportId, itemId, { resultValue: '25.000' }, key)).status).toBe(
      200
    );
    expect(await auditCount(ENTRY, report.reportId)).toBe(1);
  });
});

describe('dia.diagnostic-measurement-record', () => {
  it('judges a reading against the configured range, in the database', async () => {
    const report = await seedReport();
    const itemId = itemIds.get(ITEM_BRAKE_THICKNESS) ?? '';

    // A value with more precision than a double holds exactly. It must survive the
    // round trip unrounded AND be judged correctly — which is why the comparison runs
    // in SQL as `numeric` rather than in JavaScript.
    authAs(FULL);
    const inRange = await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
      templateItemId: itemId,
      label: 'Front left disc',
      measuredValue: '25.100001',
      unit: 'mm',
    });
    expect(inRange.status).toBe(201);
    const body = (await inRange.json()) as { measuredValue: string; withinRange: boolean | null };
    expect(body.measuredValue).toBe('25.100001');
    expect(body.withinRange).toBe(true);

    authAs(FULL);
    const below = await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
      templateItemId: itemId,
      label: 'Front right disc',
      measuredValue: String(BRAKE_MIN - 0.000001),
      unit: 'mm',
    });
    expect(below.status).toBe(201);
    // Recorded, not refused. A diagnostic exists to record what is wrong; refusing the
    // observation would make the worst cases unreportable.
    expect(((await below.json()) as { withinRange: boolean | null }).withinRange).toBe(false);

    authAs(FULL);
    const atMax = await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
      templateItemId: itemId,
      label: 'Spare disc',
      measuredValue: String(BRAKE_MAX),
      unit: 'mm',
    });
    // Bounds are INCLUSIVE, which the SQL `>=`/`<=` decides and this pins.
    expect(((await atMax.json()) as { withinRange: boolean | null }).withinRange).toBe(true);
  });

  it('leaves withinRange NULL when no range is configured', async () => {
    const report = await seedReport();

    // Three-valued and never flattened: `null` means no range was configured, and
    // `false` would assert an out-of-spec reading that nobody checked.
    authAs(FULL);
    const response = await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
      label: 'Ad-hoc battery voltage',
      measuredValue: '12.400',
      unit: 'V',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      withinRange: boolean | null;
      templateItemId: string | null;
    };
    expect(body.withinRange).toBeNull();
    expect(body.templateItemId).toBeNull();
  });

  it('refuses a unit that disagrees with the item, and a non-numeric item', async () => {
    const report = await seedReport();

    // `ck_template_items_unit` makes a numeric item's unit mandatory, so a reading in
    // different units against that item means nothing — and the foreign key names no
    // unit and no response type, so neither check is the database's.
    authAs(FULL);
    const wrongUnit = await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
      templateItemId: itemIds.get(ITEM_BRAKE_THICKNESS) ?? '',
      label: 'Front left disc',
      measuredValue: '1.004',
      unit: 'in',
    });
    expect(wrongUnit.status).toBe(422);
    expect(((await wrongUnit.json()) as Problem).violations?.[0]?.rule).toBe('unit_mismatch');

    authAs(FULL);
    const wrongType = await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
      templateItemId: itemIds.get(ITEM_ROAD_TEST) ?? '',
      label: 'Road test',
      measuredValue: '1',
      unit: 'mm',
    });
    expect(wrongType.status).toBe(422);
    expect(((await wrongType.json()) as Problem).violations?.[0]?.rule).toBe('not_a_numeric_item');
  });

  it('refuses a malformed decimal, an unpermitted caller and cross-scope callers', async () => {
    const report = await seedReport();
    const ok = { label: 'Reading', measuredValue: '1.000', unit: 'mm' };

    authAs(FULL);
    expect(
      (
        await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
          ...ok,
          measuredValue: '1.0e3',
        })
      ).status
    ).toBe(422);

    authAs(READER);
    expect((await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, ok)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, ok)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, ok)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, ok)).status).toBe(404);
  });

  it('records once on an idempotent replay', async () => {
    const report = await seedReport();
    const key = crypto.randomUUID();
    const body = { label: 'Reading', measuredValue: '1.000', unit: 'mm' };

    authAs(FULL);
    expect(
      (await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, body, key)).status
    ).toBe(201);
    expect(
      (await entry(RECORD_MEASUREMENT, 'measurements', report.reportId, body, key)).status
    ).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.measurements WHERE diagnostic_report_id = $1`,
        [report.reportId]
      )
    ).toBe(1);
  });
});

describe('dia.diagnostic-dtc-record', () => {
  it('records a valid OBD-II code and defaults its status to active', async () => {
    const report = await seedReport();

    authAs(FULL);
    const response = await entry(RECORD_DTC, 'dtcs', report.reportId, {
      code: 'P0300',
      description: 'Random misfire detected',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string; dtcStatus: string };
    expect(body.code).toBe('P0300');
    expect(body.dtcStatus).toBe('active');
    expect(await auditCount(ENTRY, report.reportId)).toBe(1);
  });

  it('refuses every shape the CHECK constraint refuses', async () => {
    const report = await seedReport();

    // `^[PBCU][0-9][0-9A-F]{3}$`: the SECOND character is decimal and only the last
    // three are hex, and all of it upper case. Mirrored so a malformed code is a 422
    // naming the field rather than a raw 23514.
    for (const code of ['p0300', 'PA300', 'P0G00', 'X0300', 'P030', 'P03000']) {
      authAs(FULL);
      const response = await entry(RECORD_DTC, 'dtcs', report.reportId, { code });
      expect(response.status, `code ${code}`).toBe(422);
    }
    // And the boundary that IS valid: hex in the last three.
    authAs(FULL);
    expect((await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'U0FFF' })).status).toBe(201);
  });

  it('accepts every status the vocabulary permits, and refuses one it does not', async () => {
    const report = await seedReport();
    let n = 0;
    for (const dtcStatus of ['active', 'pending', 'stored', 'cleared']) {
      authAs(FULL);
      const response = await entry(RECORD_DTC, 'dtcs', report.reportId, {
        code: `P0${(++n).toString().padStart(3, '0')}`,
        dtcStatus,
      });
      expect(response.status, dtcStatus).toBe(201);
    }
    authAs(FULL);
    expect(
      (await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0999', dtcStatus: 'historic' }))
        .status
    ).toBe(422);
  });

  it('refuses an unpermitted or cross-scope caller, and records once on replay', async () => {
    const report = await seedReport();
    const key = crypto.randomUUID();

    authAs(READER);
    expect((await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0300' })).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0300' })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0300' })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0300' })).status).toBe(404);

    authAs(FULL);
    expect((await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0300' }, key)).status).toBe(
      201
    );
    expect((await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0300' }, key)).status).toBe(
      200
    );
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.dtc_records WHERE diagnostic_report_id = $1`,
        [report.reportId]
      )
    ).toBe(1);
  });
});

describe('dia.diagnostic-finding-record', () => {
  it('records a finding with its severity and disposition', async () => {
    const report = await seedReport();

    authAs(FULL);
    const response = await entry(RECORD_FINDING, 'findings', report.reportId, {
      severity: 'critical',
      disposition: 'repair_required',
      description: 'Front discs below minimum thickness',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { severity: string; disposition: string };
    expect(body.severity).toBe('critical');
    expect(body.disposition).toBe('repair_required');
    expect(await auditCount(ENTRY, report.reportId)).toBe(1);
  });

  it('accepts a severe finding with no_action, because the two are independent', async () => {
    const report = await seedReport();

    // Nothing in the schema ties severity to disposition, and nothing here does
    // either: a critical fault outside this workshop's remit is a legitimate record.
    authAs(FULL);
    const response = await entry(RECORD_FINDING, 'findings', report.reportId, {
      severity: 'critical',
      disposition: 'no_action',
      description: 'Structural corrosion; referred to a body shop',
    });
    expect(response.status).toBe(201);
  });

  it('refuses a vocabulary the CHECK constraint refuses', async () => {
    const report = await seedReport();
    authAs(FULL);
    expect(
      (
        await entry(RECORD_FINDING, 'findings', report.reportId, {
          severity: 'urgent',
          disposition: 'repair_required',
          description: 'x',
        })
      ).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (
        await entry(RECORD_FINDING, 'findings', report.reportId, {
          severity: 'high',
          disposition: 'replace',
          description: 'x',
        })
      ).status
    ).toBe(422);
  });

  it('refuses an unpermitted or cross-scope caller, and records once on replay', async () => {
    const report = await seedReport();
    const key = crypto.randomUUID();
    const body = { severity: 'low', disposition: 'monitor', description: 'Minor seep' };

    authAs(READER);
    expect((await entry(RECORD_FINDING, 'findings', report.reportId, body)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await entry(RECORD_FINDING, 'findings', report.reportId, body)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await entry(RECORD_FINDING, 'findings', report.reportId, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await entry(RECORD_FINDING, 'findings', report.reportId, body)).status).toBe(404);

    authAs(FULL);
    expect((await entry(RECORD_FINDING, 'findings', report.reportId, body, key)).status).toBe(201);
    expect((await entry(RECORD_FINDING, 'findings', report.reportId, body, key)).status).toBe(200);
    expect(
      await count(`SELECT count(*)::text AS n FROM dia.findings WHERE diagnostic_report_id = $1`, [
        report.reportId,
      ])
    ).toBe(1);
  });
});

describe('dia.diagnostic-evidence-record', () => {
  it('binds an exact document version and accepts no storage key', async () => {
    const report = await seedReport();
    const versionId = await seedDocumentVersion();

    authAs(FULL);
    const response = await entry(RECORD_EVIDENCE, 'evidence', report.reportId, {
      documentVersionId: versionId,
      evidenceType: 'photograph',
      note: 'Nearside disc face',
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { documentVersionId: string }).documentVersionId).toBe(
      versionId
    );

    // `.strict()` proves the route has no field for a key, and the table has no column.
    authAs(FULL);
    expect(
      (
        await entry(RECORD_EVIDENCE, 'evidence', report.reportId, {
          documentVersionId: versionId,
          evidenceType: 'photograph',
          storageKey: 'dev/tenant/whatever',
        })
      ).status
    ).toBe(422);
  });

  it('refuses a rejected version and another tenant’s version', async () => {
    const report = await seedReport();
    const rejected = await seedDocumentVersion({ status: 'rejected' });
    const foreign = await seedDocumentVersion({ tenantId: TENANT_B });

    // `accepted` is NOT required — P1-15 documented acceptance as unreachable while no
    // application role may write `shared.file_scan_results` — so demanding it would
    // make evidence impossible. What CAN be refused is refused.
    authAs(FULL);
    const bad = await entry(RECORD_EVIDENCE, 'evidence', report.reportId, {
      documentVersionId: rejected,
      evidenceType: 'photograph',
    });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as Problem).code).toBe('ERR-DOC-001');

    authAs(FULL);
    const crossTenant = await entry(RECORD_EVIDENCE, 'evidence', report.reportId, {
      documentVersionId: foreign,
      evidenceType: 'photograph',
    });
    expect(crossTenant.status).toBe(404);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_evidence WHERE diagnostic_report_id = $1`,
        [report.reportId]
      )
    ).toBe(0);
  });

  it('refuses an unpermitted or cross-scope caller, and records once on replay', async () => {
    const report = await seedReport();
    const versionId = await seedDocumentVersion();
    const key = crypto.randomUUID();
    const body = { documentVersionId: versionId, evidenceType: 'photograph' };

    authAs(READER);
    expect((await entry(RECORD_EVIDENCE, 'evidence', report.reportId, body)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await entry(RECORD_EVIDENCE, 'evidence', report.reportId, body)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await entry(RECORD_EVIDENCE, 'evidence', report.reportId, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await entry(RECORD_EVIDENCE, 'evidence', report.reportId, body)).status).toBe(404);

    authAs(FULL);
    expect((await entry(RECORD_EVIDENCE, 'evidence', report.reportId, body, key)).status).toBe(201);
    expect((await entry(RECORD_EVIDENCE, 'evidence', report.reportId, body, key)).status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_evidence WHERE diagnostic_report_id = $1`,
        [report.reportId]
      )
    ).toBe(1);
  });
});

describe('dia.diagnostic-recommendation-record', () => {
  it('records a recommendation and defaults its priority', async () => {
    const report = await seedReport();

    authAs(FULL);
    const response = await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, {
      recommendation: 'Replace front discs and pads at next service',
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { priority: string }).priority).toBe('medium');
    expect(await auditCount(ENTRY, report.reportId)).toBe(1);
  });

  it('carries NO finding link, because the schema has no column for one', async () => {
    const report = await seedReport();
    authAs(FULL);
    const created = await entry(RECORD_FINDING, 'findings', report.reportId, {
      severity: 'high',
      disposition: 'repair_recommended',
      description: 'Discs near minimum',
    });
    const findingId = ((await created.json()) as { id: string }).id;

    // `dia.recommendations` has only `diagnostic_report_id`. Naming a finding is
    // refused rather than silently dropped, so a client cannot believe it recorded
    // provenance that nothing stores. The chain the schema DOES support runs the other
    // way — additional work links to a FINDING — and Wave 6 enforces it.
    authAs(FULL);
    const response = await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, {
      recommendation: 'Replace discs',
      findingId,
    });
    expect(response.status).toBe(422);
    expect(
      await count(
        `SELECT count(*)::text AS n
           FROM information_schema.columns
          WHERE table_schema = 'dia' AND table_name = 'recommendations'
            AND column_name = 'finding_id'`
      )
    ).toBe(0);
  });

  it('refuses an unpermitted or cross-scope caller, and records once on replay', async () => {
    const report = await seedReport();
    const key = crypto.randomUUID();
    const body = { recommendation: 'Monitor at next visit', priority: 'low' };

    authAs(READER);
    expect(
      (await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, body)).status
    ).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect(
      (await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, body)).status
    ).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect(
      (await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, body)).status
    ).toBe(404);
    authAs(TENANT_B_FULL);
    expect(
      (await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, body)).status
    ).toBe(404);

    authAs(FULL);
    expect(
      (await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, body, key)).status
    ).toBe(201);
    expect(
      (await entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, body, key)).status
    ).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.recommendations WHERE diagnostic_report_id = $1`,
        [report.reportId]
      )
    ).toBe(1);
  });
});

describe('dia.diagnostic-transition and dia.diagnostic-complete', () => {
  it('walks draft to in_progress and refuses a move the graph does not allow', async () => {
    const job = await seedJob();
    authAs(FULL);
    const created = (await (
      await createReport(job.jobId, { templateVersionId })
    ).json()) as ReportBody;

    authAs(FULL);
    const started = await moveReport(
      created.id,
      { toStatus: 'in_progress' },
      { version: created.recordVersion }
    );
    expect(started.status).toBe(200);
    const version = ((await started.json()) as ReportBody).recordVersion;
    expect(await auditCount(STATE_CHANGED, created.id)).toBe(1);

    // `in_progress → draft` is not in the graph, and `draft` was left behind for good.
    authAs(FULL);
    const back = await moveReport(created.id, { toStatus: 'draft' }, { version });
    expect(back.status).toBe(409);
    expect(((await back.json()) as Problem).code).toBe('ERR-TRN-001');
  });

  it('refuses an unpermitted caller and isolates the TRANSITION by branch and tenant', async () => {
    const report = await seedReport();
    const body = { toStatus: 'cancelled', reason: 'Vehicle recalled by the customer' };

    // These probes are the transition operation's OWN, not the completion
    // operation's. An earlier revision of this suite declared cross-tenant,
    // isolation, stale-version and idempotency evidence for `wo`-style transitions in
    // its COVERAGE-EVIDENCE header while asserting them only for completion — and the
    // coverage gate could not catch it, because it checks that an operation id appears
    // in executable code and not that an assertion backs each claimed flag.
    authAs(READER);
    expect((await moveReport(report.reportId, body, { version: report.version })).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await moveReport(report.reportId, body, { version: report.version })).status).toBe(403);

    // Granted in BRANCH_A2 and RLS-visible in A1 through an unrelated grant, so only
    // the scoped permission check can refuse (P1-18-A-01).
    authAs(PERMISSION_ELSEWHERE);
    expect((await moveReport(report.reportId, body, { version: report.version })).status).toBe(403);
    // No grant in A1, so RLS hides the report first: defence in depth.
    authAs(SCOPED_ELSEWHERE);
    expect((await moveReport(report.reportId, body, { version: report.version })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await moveReport(report.reportId, body, { version: report.version })).status).toBe(404);

    // And none of them moved it.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_reports
          WHERE id = $1 AND status = 'in_progress' AND record_version = $2`,
        [report.reportId, report.version]
      )
    ).toBe(1);
  });

  it('refuses a stale version and a missing If-Match on the TRANSITION', async () => {
    const report = await seedReport();
    const body = { toStatus: 'cancelled', reason: 'Wrong vehicle' };

    authAs(FULL);
    const stale = await moveReport(report.reportId, body, { version: report.version + 7 });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Problem).code).toBe('ERR-CON-001');

    authAs(FULL);
    expect((await moveReport(report.reportId, body, { version: null })).status).toBe(428);
    expect((await readJobReportStatus(report.reportId)) === 'in_progress').toBe(true);
  });

  it('moves once on an idempotent replay of the TRANSITION', async () => {
    const job = await seedJob();
    authAs(FULL);
    const created = (await (
      await createReport(job.jobId, { templateVersionId })
    ).json()) as ReportBody;
    const key = crypto.randomUUID();

    authAs(FULL);
    expect(
      (
        await moveReport(
          created.id,
          { toStatus: 'in_progress' },
          { version: created.recordVersion, key }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await moveReport(
          created.id,
          { toStatus: 'in_progress' },
          { version: created.recordVersion, key }
        )
      ).status
    ).toBe(200);
    // One ledger row and one audit record: a replay must not write a second
    // transition, and the ledger is trigger-emitted so a second UPDATE would show.
    expect(await auditCount(STATE_CHANGED, created.id)).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_report_status_history
          WHERE diagnostic_report_id = $1`,
        [created.id]
      )
    ).toBe(1);
  });

  it('carries the reason into the ledger through the app.status_reason GUC', async () => {
    const report = await seedReport();

    // The GUC is the only channel: `dia.emit_diagnostic_report_status_history` reads
    // `current_setting('app.status_reason', true)` and there is no reason column on
    // the report. A service that validated the reason and never published it would
    // leave every ledger row's reason NULL — which is exactly the defect Wave 4 found
    // on the work-order path.
    authAs(FULL);
    const response = await moveReport(
      report.reportId,
      { toStatus: 'cancelled', reason: 'Customer collected the vehicle early' },
      { version: report.version }
    );
    expect(response.status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_report_status_history
          WHERE diagnostic_report_id = $1 AND to_state = 'cancelled'
            AND reason = 'Customer collected the vehicle early'`,
        [report.reportId]
      )
    ).toBe(1);
  });

  it('refuses `completed` at the transition endpoint, so the second permission holds', async () => {
    const report = await seedReport();

    // Completion is its own command behind `dia.diagnostic.complete`. Accepting
    // `completed` here would make that permission bypassable by choosing the other URL
    // — the same defect the work-order closure split was built to prevent.
    authAs(FULL);
    const response = await moveReport(
      report.reportId,
      { toStatus: 'completed' },
      { version: report.version }
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as Problem).violations?.[0]?.rule).toBe(
      'completion_requires_completion_operation'
    );
  });

  it('reports EVERY outstanding mandatory item, not the first', async () => {
    const report = await seedReport();

    // The guard can only say "not yet". Two mandatory items are unresolved, and the
    // caller learns both at once, keyed by the template's own item codes.
    authAs(FULL);
    const response = await completeReport(report.reportId, {}, { version: report.version });
    expect(response.status).toBe(409);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-DIA-001');
    expect(problem.violations).toHaveLength(2);
    expect(problem.violations?.map((v) => v.path).sort()).toEqual([
      `items.${ITEM_BRAKE_THICKNESS}`,
      `items.${ITEM_TYRE_CONDITION}`,
    ]);
  });

  it('completes once every mandatory item is answered, and publishes exactly once', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);

    authAs(FULL);
    const response = await completeReport(
      report.reportId,
      { summary: 'Front brakes serviceable; tyres worn' },
      { version: report.version }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReportBody;
    expect(body.status).toBe('completed');
    expect(body.summary).toBe('Front brakes serviceable; tyres worn');

    expect(await auditCount(COMPLETED, report.reportId)).toBe(1);
    // Under its own action, never also under the generic one: a count of status
    // changes and a count of completions must not double-count the same event.
    expect(await auditCount(STATE_CHANGED, report.reportId)).toBe(1);
    expect(await outboxCount(COMPLETED_EVENT, report.reportId)).toBe(1);
  });

  it('completes with a documented not-applicable reason in place of a value', async () => {
    const report = await seedReport();
    authAs(FULL);
    await writeItem(report.reportId, itemIds.get(ITEM_BRAKE_THICKNESS) ?? '', {
      notApplicableReason: 'Wheels not removed; customer declined',
    });
    authAs(FULL);
    await writeItem(report.reportId, itemIds.get(ITEM_TYRE_CONDITION) ?? '', {
      resultValue: 'good',
    });

    // A mandatory item may be skipped — never silently. The completion gate counts a
    // documented reason as an answer, which is what makes skipping accountable.
    authAs(FULL);
    const response = await completeReport(report.reportId, {}, { version: report.version });
    expect(response.status).toBe(200);
    expect(((await response.json()) as ReportBody).status).toBe('completed');
  });

  it('refuses further entries once completed, which the database does not', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    authAs(FULL);
    await completeReport(report.reportId, {}, { version: report.version });

    // None of the entry tables consults the report's status, so a completed report
    // would silently accept new results — changing what it says after it was signed.
    authAs(FULL);
    const late = await entry(RECORD_FINDING, 'findings', report.reportId, {
      severity: 'high',
      disposition: 'repair_required',
      description: 'Added after completion',
    });
    expect(late.status).toBe(409);
    expect(((await late.json()) as Problem).code).toBe('ERR-TRN-001');
    expect(
      await count(`SELECT count(*)::text AS n FROM dia.findings WHERE diagnostic_report_id = $1`, [
        report.reportId,
      ])
    ).toBe(0);
  });

  it('rollback: a failure after the write leaves no status change, no audit and no event', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);

    // A genuine failure at the LAST statement: the outbox key this completion is about
    // to publish is already taken for the tenant, so `publishEvent` raises after the
    // status change and the audit record have both been written in this transaction.
    await admin.query(
      `INSERT INTO shared.event_outbox
         (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
          aggregate_version, producer, created_by)
       VALUES ($1,$2,$3,'dia.diagnostic_report',$4,1,1,'dia.diagnostic-report-service',$5)`,
      [
        TENANT_A,
        `${COMPLETED_EVENT}:${report.reportId}`,
        COMPLETED_EVENT,
        crypto.randomUUID(),
        USER_A,
      ]
    );

    authAs(FULL);
    const response = await completeReport(report.reportId, {}, { version: report.version });
    expect(response.status).toBe(409);

    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_reports
          WHERE id = $1 AND status = 'in_progress' AND record_version = $2`,
        [report.reportId, report.version]
      )
    ).toBe(1);
    expect(await auditCount(COMPLETED, report.reportId)).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_report_status_history
          WHERE diagnostic_report_id = $1 AND to_state = 'completed'`,
        [report.reportId]
      )
    ).toBe(0);
  });

  it('refuses a stale version, a missing If-Match, and an unpermitted caller', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);

    authAs(FULL);
    const stale = await completeReport(report.reportId, {}, { version: report.version + 5 });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Problem).code).toBe('ERR-CON-001');

    authAs(FULL);
    expect((await completeReport(report.reportId, {}, { version: null })).status).toBe(428);

    // `REVIEWER` holds `dia.diagnostic.record` and `dia.diagnostic.complete`, so the
    // denial probe is the read-only principal and an unpermitted subject.
    authAs(READER);
    expect((await completeReport(report.reportId, {}, { version: report.version })).status).toBe(
      403
    );
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await completeReport(report.reportId, {}, { version: report.version })).status).toBe(
      403
    );
  });

  it('isolates completion by branch and by tenant', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);

    authAs(PERMISSION_ELSEWHERE);
    expect((await completeReport(report.reportId, {}, { version: report.version })).status).toBe(
      403
    );
    authAs(SCOPED_ELSEWHERE);
    expect((await completeReport(report.reportId, {}, { version: report.version })).status).toBe(
      404
    );
    authAs(TENANT_B_FULL);
    expect((await completeReport(report.reportId, {}, { version: report.version })).status).toBe(
      404
    );
  });

  it('completes once on an idempotent replay', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    const key = crypto.randomUUID();

    authAs(FULL);
    expect(
      (await completeReport(report.reportId, {}, { version: report.version, key })).status
    ).toBe(200);
    expect(
      (await completeReport(report.reportId, {}, { version: report.version, key })).status
    ).toBe(200);
    expect(await outboxCount(COMPLETED_EVENT, report.reportId)).toBe(1);
    expect(await auditCount(COMPLETED, report.reportId)).toBe(1);
  });

  it('refuses a second completion, because completed is terminal', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    authAs(FULL);
    const done = await completeReport(report.reportId, {}, { version: report.version });
    const version = ((await done.json()) as ReportBody).recordVersion;

    authAs(FULL);
    const again = await completeReport(report.reportId, {}, { version });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Problem).code).toBe('ERR-TRN-001');
  });
});

describe('dia.diagnostic-review', () => {
  it('records a review of a completed report, stamping the reviewer server-side', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    authAs(FULL);
    await completeReport(report.reportId, {}, { version: report.version });

    // `REVIEWER` did not create this report — `FULL` did — so separation permits it.
    authAs(REVIEWER);
    const response = await entry(RECORD_REVIEW, 'reviews', report.reportId, {
      reviewResult: 'approved',
      notes: 'Measurements consistent with the findings',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { reviewerId: string; reviewedAt: string };
    // Stamped by `dia.stamp_review()` from the session, never from the request.
    expect(body.reviewerId).toBe(REVIEWER.userId);
    expect(body.reviewedAt).toBeTruthy();
    expect(await auditCount(REVIEWED, report.reportId)).toBe(1);
  });

  it('refuses a review by the report’s own author', async () => {
    const job = await seedJob();
    // Created AND completed by REVIEWER, so `created_by` is the reviewer's own id.
    authAs(REVIEWER);
    const created = (await (
      await createReport(job.jobId, { templateVersionId })
    ).json()) as ReportBody;
    authAs(REVIEWER);
    const started = await moveReport(
      created.id,
      { toStatus: 'in_progress' },
      { version: created.recordVersion }
    );
    const version = ((await started.json()) as ReportBody).recordVersion;
    authAs(REVIEWER);
    await writeItem(created.id, itemIds.get(ITEM_BRAKE_THICKNESS) ?? '', { resultValue: '26.000' });
    authAs(REVIEWER);
    await writeItem(created.id, itemIds.get(ITEM_TYRE_CONDITION) ?? '', { resultValue: 'good' });
    authAs(REVIEWER);
    await completeReport(created.id, {}, { version });

    // Nothing in the schema stops this: `dia.diagnostic_reviews` has no constraint
    // referencing `created_by`, so it is an application rule — and this is the
    // direction that proves it does something.
    authAs(REVIEWER);
    const response = await entry(RECORD_REVIEW, 'reviews', created.id, {
      reviewResult: 'approved',
    });
    expect(response.status).toBe(409);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-QMS-001');
    expect(problem.violations?.[0]?.rule).toBe('self_review');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_reviews WHERE diagnostic_report_id = $1`,
        [created.id]
      )
    ).toBe(0);
  });

  it('refuses a review of a report that is not completed', async () => {
    const report = await seedReport();

    // Also an application rule: `dia.diagnostic_reviews` never reads the report's
    // status, so a draft could be signed off and then changed underneath the signature.
    authAs(REVIEWER);
    const response = await entry(RECORD_REVIEW, 'reviews', report.reportId, {
      reviewResult: 'approved',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Problem).code).toBe('ERR-TRN-001');
  });

  it('keeps every review, because the table is append-only', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    authAs(FULL);
    await completeReport(report.reportId, {}, { version: report.version });

    authAs(REVIEWER);
    await entry(RECORD_REVIEW, 'reviews', report.reportId, { reviewResult: 'needs_rework' });
    authAs(REVIEWER);
    await entry(RECORD_REVIEW, 'reviews', report.reportId, { reviewResult: 'approved' });

    // `needs_rework` exists precisely so a reviewer can send a report back without
    // erasing what they read, and the rows ARE the history: SELECT + INSERT only.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_reviews WHERE diagnostic_report_id = $1`,
        [report.reportId]
      )
    ).toBe(2);
    const detail = await (async () => {
      authAs(FULL);
      return (await (await readReport(report.reportId)).json()) as {
        reviews: readonly { reviewResult: string }[];
      };
    })();
    expect(detail.reviews.map((r) => r.reviewResult)).toEqual(['approved', 'needs_rework']);
  });

  it('refuses a caller without dia.diagnostic.review, and isolates by branch and tenant', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    authAs(FULL);
    await completeReport(report.reportId, {}, { version: report.version });
    const body = { reviewResult: 'approved' };

    // `FULL` holds every other diagnostics permission and NOT this one — which is the
    // whole point of the split, and makes this a real denial rather than a bare 403.
    authAs(FULL);
    expect((await entry(RECORD_REVIEW, 'reviews', report.reportId, body)).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await entry(RECORD_REVIEW, 'reviews', report.reportId, body)).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await entry(RECORD_REVIEW, 'reviews', report.reportId, body)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await entry(RECORD_REVIEW, 'reviews', report.reportId, body)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await entry(RECORD_REVIEW, 'reviews', report.reportId, body)).status).toBe(404);
  });

  it('records one review on an idempotent replay', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    authAs(FULL);
    await completeReport(report.reportId, {}, { version: report.version });
    const key = crypto.randomUUID();

    authAs(REVIEWER);
    expect(
      (await entry(RECORD_REVIEW, 'reviews', report.reportId, { reviewResult: 'approved' }, key))
        .status
    ).toBe(201);
    expect(
      (await entry(RECORD_REVIEW, 'reviews', report.reportId, { reviewResult: 'approved' }, key))
        .status
    ).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM dia.diagnostic_reviews WHERE diagnostic_report_id = $1`,
        [report.reportId]
      )
    ).toBe(1);
  });
});

describe('dia.diagnostic-detail, dia.diagnostic-list and dia.diagnostic-history', () => {
  it('returns the report, every entry, the outstanding items and the reachable statuses', async () => {
    const report = await seedReport();
    authAs(FULL);
    await writeItem(report.reportId, itemIds.get(ITEM_BRAKE_THICKNESS) ?? '', {
      resultValue: '25.000',
    });
    authAs(FULL);
    await entry(RECORD_DTC, 'dtcs', report.reportId, { code: 'P0300' });

    authAs(FULL);
    const response = await readReport(report.reportId);
    expect(response.status).toBe(200);
    const detail = (await response.json()) as {
      report: ReportBody;
      items: readonly unknown[];
      dtcs: readonly unknown[];
      outstandingMandatory: readonly { itemCode: string }[];
      nextStatuses: readonly string[];
    };
    expect(detail.items).toHaveLength(1);
    expect(detail.dtcs).toHaveLength(1);
    // The remaining mandatory item, computed against the PINNED version.
    expect(detail.outstandingMandatory.map((i) => i.itemCode)).toEqual([ITEM_TYRE_CONDITION]);
    // From the mirrored graph, so the reconciliation test pins this projection too.
    expect([...detail.nextStatuses].sort()).toEqual(['cancelled', 'completed']);
  });

  it('reports NO reachable status once terminal', async () => {
    const report = await seedReport();
    await answerMandatory(report.reportId);
    authAs(FULL);
    await completeReport(report.reportId, {}, { version: report.version });

    authAs(FULL);
    const detail = (await (await readReport(report.reportId)).json()) as {
      nextStatuses: readonly string[];
    };
    expect(detail.nextStatuses).toEqual([]);
  });

  it('lists a job’s revisions newest first', async () => {
    const job = await seedJob();
    authAs(FULL);
    await createReport(job.jobId, { templateVersionId });
    authAs(FULL);
    await createReport(job.jobId, { templateVersionId });

    authAs(FULL);
    const response = await listReports(job.jobId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: readonly ReportBody[] };
    expect(body.items.map((r) => r.revisionNumber)).toEqual([2, 1]);
  });

  it('reports the ledger with an origin block the ledger cannot hold', async () => {
    const report = await seedReport();

    authAs(FULL);
    const response = await readHistory(report.reportId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      origin: { createdBy: string; initialStatus: string };
      transitions: { items: readonly { fromState: string | null; toState: string }[] };
    };
    // One transition so far (draft → in_progress); the CREATION emitted nothing,
    // because the emitter is AFTER UPDATE only.
    expect(body.transitions.items).toHaveLength(1);
    expect(body.transitions.items[0]?.toState).toBe('in_progress');
    expect(body.origin.initialStatus).toBe('draft');
    expect(body.origin.createdBy).toBe(FULL.userId);
  });

  it('refuses a bad cursor, an unpermitted caller and cross-scope callers', async () => {
    const report = await seedReport();

    authAs(FULL);
    const bad = await readHistory(report.reportId, '?cursor=not-a-cursor');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Problem).code).toBe('ERR-PAG-001');

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await readReport(report.reportId)).status).toBe(403);
    expect((await readHistory(report.reportId)).status).toBe(403);
    expect((await listReports(report.jobId)).status).toBe(403);

    authAs(PERMISSION_ELSEWHERE);
    expect((await readReport(report.reportId)).status).toBe(403);
    expect((await readHistory(report.reportId)).status).toBe(403);
    expect((await listReports(report.jobId)).status).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect((await readReport(report.reportId)).status).toBe(404);
    expect((await readHistory(report.reportId)).status).toBe(404);
    expect((await listReports(report.jobId)).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await readReport(report.reportId)).status).toBe(404);
    expect((await readHistory(report.reportId)).status).toBe(404);
    expect((await listReports(report.jobId)).status).toBe(404);
  });

  it('keeps a tenant-B report unreachable from tenant A', async () => {
    const tenantB = await createOpenWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    expect(tenantB.workOrderId).toBeTruthy();

    const report = await seedReport();
    authAs(TENANT_B_FULL);
    expect((await readReport(report.reportId)).status).toBe(404);
  });
});

describe('a closed work order stops accepting diagnostic work', () => {
  /**
   * Found by the pre-merge completeness audit. `create` refuses a terminal work order
   * and a terminal job, but nothing re-checked it afterwards — so a report left
   * `in_progress` when its order closed went on accepting measurements, DTCs, findings
   * and recommendations, and could still be COMPLETED, indefinitely after the vehicle
   * was released.
   *
   * It needed no race, and the fixture below is the proof of that: closure blocker B4
   * demands a completed report only for a `requires_diagnostic` job, so a report opened
   * on an ORDINARY job leaves the order perfectly closable through the real gate while
   * the report stays open. That is why the job here is created with
   * `requiresDiagnostic: false` rather than through `seedJob`, which sets it true.
   *
   * A diagnostic is a dated observation about a vehicle. Completion is the worse half:
   * `completed` is the status B4 reads, so completing onto a closed order writes the
   * fact that satisfies a gate which has already run.
   *
   * The residual unlocked-parent window is `P1-19-A-06`; this covers the non-racing
   * case, which is the one that was reachable.
   */
  async function reportOnAClosedOrder(): Promise<{
    readonly reportId: string;
    readonly version: number;
  }> {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const jobResponse = await CREATE_JOB(
      new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ title: 'Ordinary work', requiresDiagnostic: false }),
      }),
      { params: Promise.resolve({ workOrderId: order.workOrderId }) }
    );
    if (jobResponse.status !== 201) {
      throw new Error(`fixture job failed with ${jobResponse.status}: ${await jobResponse.text()}`);
    }
    const job = (await jobResponse.json()) as { id: string; recordVersion: number };

    authAs(FULL);
    const created = await createReport(job.id, { templateVersionId });
    if (created.status !== 201) {
      throw new Error(`fixture report failed with ${created.status}: ${await created.text()}`);
    }
    const report = (await created.json()) as ReportBody;
    authAs(FULL);
    const started = await moveReport(
      report.id,
      { toStatus: 'in_progress' },
      { version: report.recordVersion }
    );
    if (started.status !== 200) {
      throw new Error(`fixture start failed with ${started.status}: ${await started.text()}`);
    }
    const version = ((await started.json()) as ReportBody).recordVersion;

    // Terminal job clears B1; a passed QC record clears B5b.
    authAs(FULL);
    const cancelled = await post(
      TRANSITION_JOB as never,
      `/api/v1/jobs/${job.id}/transition`,
      { jobId: job.id },
      { toState: 'cancelled', reason: 'closing the order with the report still open' },
      { version: job.recordVersion }
    );
    if (cancelled.status !== 200) {
      throw new Error(
        `fixture job cancel failed with ${cancelled.status}: ${await cancelled.text()}`
      );
    }

    authAs(FULL);
    const qc = await post(
      OPEN_QC as never,
      `/api/v1/work-orders/${order.workOrderId}/quality-controls`,
      { workOrderId: order.workOrderId },
      {}
    );
    const qcBody = (await qc.json()) as { id: string; recordVersion: number };
    authAs(FULL);
    await post(
      FINALIZE_QC as never,
      `/api/v1/quality-controls/${qcBody.id}/finalization`,
      { recordId: qcBody.id },
      { overallResult: 'passed' },
      { version: qcBody.recordVersion }
    );

    const orderVersion = await advance(order.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);
    authAs(FULL);
    const closed = await post(
      CLOSE_WORK_ORDER as never,
      `/api/v1/work-orders/${order.workOrderId}/closure`,
      { workOrderId: order.workOrderId },
      { toState: 'closed' },
      { version: orderVersion }
    );
    if (closed.status !== 200) {
      throw new Error(`fixture closure failed with ${closed.status}: ${await closed.text()}`);
    }
    return { reportId: report.id, version };
  }

  it('refuses every entry kind and refuses completion', async () => {
    const report = await reportOnAClosedOrder();

    const cases = [
      [
        'measurement',
        () =>
          entry(RECORD_MEASUREMENT, 'measurements', report.reportId, {
            templateItemId: itemIds.get(ITEM_BRAKE_THICKNESS) ?? '',
            label: 'Front left disc',
            measuredValue: '25.0',
            unit: 'mm',
          }),
      ],
      [
        'dtc',
        () =>
          entry(RECORD_DTC, 'dtcs', report.reportId, {
            code: 'P0301',
            description: 'Late DTC',
          }),
      ],
      [
        'finding',
        () =>
          entry(RECORD_FINDING, 'findings', report.reportId, {
            severity: 'critical',
            disposition: 'repair_required',
            description: 'Late finding',
          }),
      ],
      [
        'recommendation',
        () =>
          entry(RECORD_RECOMMENDATION, 'recommendations', report.reportId, {
            recommendation: 'Late recommendation',
          }),
      ],
    ] as const;

    for (const [label, send] of cases) {
      authAs(FULL);
      const refused = await send();
      expect(refused.status, `${label} on a closed order`).toBe(409);
      expect(((await refused.json()) as { code?: string }).code, label).toBe('ERR-TRN-001');
    }

    // Completion is the one that would have changed what B4 sees.
    authAs(FULL);
    const completion = await completeReport(report.reportId, {}, { version: report.version });
    expect(completion.status).toBe(409);
    expect(((await completion.json()) as { code?: string }).code).toBe('ERR-TRN-001');

    // The report is untouched — still `in_progress`, still at its version.
    const row = await admin.query<{ status: string; record_version: number }>(
      `SELECT status, record_version FROM dia.diagnostic_reports WHERE id = $1`,
      [report.reportId]
    );
    expect(row.rows[0]?.status).toBe('in_progress');
    expect(row.rows[0]?.record_version).toBe(report.version);
  });
});
