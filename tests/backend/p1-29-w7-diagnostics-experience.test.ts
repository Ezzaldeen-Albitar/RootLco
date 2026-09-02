/**
 * P1-29 `W7` — the diagnostics experience, proved on real responses.
 *
 * Three screens consume 23 operations. This suite does not re-prove the
 * operations' own rules — BR-04 (`br-04-template-authoring`) and P1-19
 * (`p1-19-diagnostics`) hold those — it proves what the SCREENS depend on:
 *
 *  - **PC-1 per screen.** An authorized actor retrieves and sees the data; an
 *    actor without the code is refused; another tenant's record is not visible.
 *    For the catalogue (`dia.template-list`), the template detail
 *    (`dia.template-detail` + `dia.template-version-item-list`), and the job
 *    workbench (`dia.diagnostic-list` + `dia.diagnostic-detail`).
 *  - **The mirror is the row.** Every interface in
 *    `features/diagnostics/diagnostics-contract.ts` is held field-for-field
 *    against the row the route actually returned, so a renamed or dropped
 *    field fails here before a screen renders `undefined`.
 *  - **The journey the workbench drives**, through the routes the screen calls,
 *    in the order the screen offers them: start a report from a publishable
 *    version, answer the mandatory item by its ID (the join W7's seam makes
 *    possible), record a measurement, a DTC, a finding and a recommendation,
 *    move to `in_progress`, complete with the version the detail carried, and
 *    review — then read the history the screen pages.
 *  - **What the screen must not offer**: recording on a completed report is
 *    refused, and a stale version is refused with a conflict.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   dia.template-list: route service authorization success denial cross-tenant isolation
 *   dia.template-detail: route service authorization success denial cross-tenant isolation
 *   dia.template-version-item-list: route service authorization success
 *   dia.diagnostic-list: route service authorization success denial cross-tenant isolation
 *   dia.diagnostic-detail: route service authorization success denial cross-tenant isolation
 *
 * Operations exercised here: dia.diagnostic-type-list, dia.template-list,
 * dia.template-create, dia.template-detail, dia.template-version-create,
 * dia.template-item-create, dia.template-version-item-list,
 * dia.template-version-status-set, dia.template-version-list-publishable,
 * dia.diagnostic-list, dia.diagnostic-create, dia.diagnostic-detail,
 * dia.diagnostic-item-result, dia.diagnostic-measurement-record,
 * dia.diagnostic-dtc-record, dia.diagnostic-finding-record,
 * dia.diagnostic-recommendation-record, dia.diagnostic-transition,
 * dia.diagnostic-complete, dia.diagnostic-review, dia.diagnostic-history.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SUBJECT_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  FULL,
  REVIEWER,
  authAs as authAsP119,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import {
  DIAGNOSTIC_RECORDER,
  TEMPLATE_ADMIN,
  TEMPLATE_READER,
  TEMPLATE_TENANT_B,
  authAs,
  diagnosticTypes,
  establishBr04Fixtures,
  resetTemplates,
} from './br-04-helpers';
import { mirrorFields } from './p1-29-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST_TYPES } from '@/app/api/v1/diagnostic-types/route';
import {
  GET as LIST_TEMPLATES,
  POST as CREATE_TEMPLATE,
} from '@/app/api/v1/inspection-templates/route';
import { GET as TEMPLATE_DETAIL } from '@/app/api/v1/inspection-templates/[templateId]/route';
import { POST as CREATE_VERSION } from '@/app/api/v1/inspection-templates/[templateId]/versions/route';
import {
  GET as LIST_ITEMS,
  POST as CREATE_ITEM,
} from '@/app/api/v1/template-versions/[versionId]/items/route';
import { POST as SET_VERSION_STATUS } from '@/app/api/v1/template-versions/[versionId]/status/route';
import { GET as LIST_PUBLISHABLE } from '@/app/api/v1/jobs/[jobId]/inspection-templates/route';
import {
  GET as LIST_REPORTS,
  POST as CREATE_REPORT,
} from '@/app/api/v1/jobs/[jobId]/inspections/route';
import { GET as READ_REPORT } from '@/app/api/v1/inspections/[inspectionId]/route';
import { GET as READ_HISTORY } from '@/app/api/v1/inspections/[inspectionId]/history/route';
import { PUT as WRITE_ITEM } from '@/app/api/v1/inspections/[inspectionId]/items/[templateItemId]/route';
import { POST as RECORD_MEASUREMENT } from '@/app/api/v1/inspections/[inspectionId]/measurements/route';
import { POST as RECORD_DTC } from '@/app/api/v1/inspections/[inspectionId]/dtcs/route';
import { POST as RECORD_FINDING } from '@/app/api/v1/inspections/[inspectionId]/findings/route';
import { POST as RECORD_RECOMMENDATION } from '@/app/api/v1/inspections/[inspectionId]/recommendations/route';
import { POST as TRANSITION_REPORT } from '@/app/api/v1/inspections/[inspectionId]/transition/route';
import { POST as COMPLETE_REPORT } from '@/app/api/v1/inspections/[inspectionId]/completion/route';
import { POST as RECORD_REVIEW } from '@/app/api/v1/inspections/[inspectionId]/reviews/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';

const CONTRACT = join(
  process.cwd(),
  'apps',
  'web',
  'src',
  'features',
  'diagnostics',
  'diagnostics-contract.ts'
);

let admin: Pool;
let runtime: Pool;

/* ------------------------------------------------------------------ *
 * Transport — the request shapes the adapters build
 * ------------------------------------------------------------------ */

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

/** Holds a row against the mirror interface, field for field, no more and no less. */
function matchesMirror(row: unknown, interfaceName: string): void {
  expect(Object.keys(row as object).sort()).toEqual(
    [...mirrorFields(CONTRACT, interfaceName)].sort()
  );
}

interface Created {
  readonly id: string;
  readonly recordVersion: number;
}

/* ------------------------------------------------------------------ *
 * Fixtures — through the routes the screens call
 * ------------------------------------------------------------------ */

async function seedPublishedTemplate(code: string): Promise<{
  readonly templateId: string;
  readonly versionId: string;
  readonly mandatoryItemId: string;
  readonly optionalItemId: string;
}> {
  authAs(TEMPLATE_ADMIN);
  const template = await send(
    CREATE_TEMPLATE as Handler,
    '/api/v1/inspection-templates',
    {},
    {
      code,
      name: `W7 ${code}`,
      diagnosticTypeId: diagnosticTypes.typeTenantA,
    }
  );
  if (template.status !== 201) throw new Error(`template failed with ${template.status}`);
  const templateId = (await json<Created>(template)).id;

  authAs(TEMPLATE_ADMIN);
  const version = await send(
    CREATE_VERSION as Handler,
    `/api/v1/inspection-templates/${templateId}/versions`,
    { templateId },
    {}
  );
  if (version.status !== 201) throw new Error(`version failed with ${version.status}`);
  const created = await json<Created>(version);

  const items: string[] = [];
  for (const item of [
    { itemCode: 'pad_depth', prompt: 'Measure the pad depth', responseType: 'numeric', unit: 'mm' },
    {
      itemCode: 'road_test',
      prompt: 'Road test performed',
      responseType: 'boolean',
      isMandatory: false,
    },
  ]) {
    authAs(TEMPLATE_ADMIN);
    const added = await send(
      CREATE_ITEM as Handler,
      `/api/v1/template-versions/${created.id}/items`,
      { versionId: created.id },
      item
    );
    if (added.status !== 201)
      throw new Error(`item failed with ${added.status}: ${await added.text()}`);
    items.push((await json<Created>(added)).id);
  }

  authAs(TEMPLATE_ADMIN);
  const published = await send(
    SET_VERSION_STATUS as Handler,
    `/api/v1/template-versions/${created.id}/status`,
    { versionId: created.id },
    { toStatus: 'published' },
    { version: created.recordVersion }
  );
  if (published.status !== 200) throw new Error(`publish failed with ${published.status}`);
  return {
    templateId,
    versionId: created.id,
    mandatoryItemId: items[0] ?? '',
    optionalItemId: items[1] ?? '',
  };
}

async function seedJob(): Promise<string> {
  const order = await createOpenWorkOrder();
  authAsP119(FULL);
  const job = await send(
    CREATE_JOB as Handler,
    `/api/v1/work-orders/${order.workOrderId}/jobs`,
    { workOrderId: order.workOrderId },
    { title: 'W7 — brake inspection', requiresDiagnostic: true }
  );
  if (job.status !== 201) throw new Error(`job failed with ${job.status}`);
  return (await json<Created>(job)).id;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishBr04Fixtures(admin);
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
  await resetTemplates();
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

/* ------------------------------------------------------------------ *
 * The catalogue and the template detail
 * ------------------------------------------------------------------ */

describe('W7 — the catalogue screen, on real responses', () => {
  it('C1 — a reader sees the vocabulary and the templates, each row the mirror declares', async () => {
    const seeded = await seedPublishedTemplate('w7_catalogue');

    authAs(TEMPLATE_READER);
    const types = await read(LIST_TYPES as Handler, '/api/v1/diagnostic-types');
    expect(types.status).toBe(200);
    const vocabulary = await json<{ items: readonly Record<string, unknown>[] }>(types);
    const own = vocabulary.items.find((row) => row['id'] === diagnosticTypes.typeTenantA);
    expect(own).toBeDefined();
    matchesMirror(own, 'DiagnosticType');

    authAs(TEMPLATE_READER);
    const list = await read(LIST_TEMPLATES as Handler, '/api/v1/inspection-templates?limit=50');
    expect(list.status).toBe(200);
    const page = await json<{
      items: readonly Record<string, unknown>[];
      nextCursor: string | null;
      hasMore: boolean;
    }>(list);
    expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    const template = page.items.find((row) => row['id'] === seeded.templateId);
    expect(template).toBeDefined();
    // A LIST row carries its keyset cursor; the detail's template row does not (C2).
    // `mirrorFields` reads one interface's own members, so the extension is joined here.
    expect(Object.keys(template as object).sort()).toEqual(
      [
        ...mirrorFields(CONTRACT, 'InspectionTemplate'),
        ...mirrorFields(CONTRACT, 'InspectionTemplateListRow'),
      ].sort()
    );
    expect(typeof template?.['createdAt']).toBe('string');
  });

  it('C2 — a reader opens a template and its version’s items; the detail is the mirror’s shape', async () => {
    const seeded = await seedPublishedTemplate('w7_detail');

    authAs(TEMPLATE_READER);
    const detail = await read(
      TEMPLATE_DETAIL as Handler,
      `/api/v1/inspection-templates/${seeded.templateId}`,
      { templateId: seeded.templateId }
    );
    expect(detail.status).toBe(200);
    const body = await json<{
      template: Record<string, unknown>;
      versions: Record<string, unknown>[];
    }>(detail);
    matchesMirror(body, 'TemplateDetail');
    matchesMirror(body.template, 'InspectionTemplate');
    expect(body.versions).toHaveLength(1);
    matchesMirror(body.versions[0], 'TemplateVersion');
    expect(body.versions[0]?.['status']).toBe('published');
    expect(body.versions[0]?.['itemCount']).toBe(2);

    authAs(TEMPLATE_READER);
    const items = await read(
      LIST_ITEMS as Handler,
      `/api/v1/template-versions/${seeded.versionId}/items`,
      { versionId: seeded.versionId }
    );
    expect(items.status).toBe(200);
    const list = await json<{ items: readonly Record<string, unknown>[] }>(items);
    expect(list.items.map((row) => row['id'])).toEqual([
      seeded.mandatoryItemId,
      seeded.optionalItemId,
    ]);
    for (const item of list.items) matchesMirror(item, 'TemplateItem');
  });

  it('C3 — no dia.diagnostic.read is a 403 on every catalogue read; no grant at all likewise', async () => {
    const seeded = await seedPublishedTemplate('w7_refused');
    // Every P1-19 principal with a diagnostics role holds dia.diagnostic.read, so
    // the refusal actor is the one with no grant at all — the honest "no code" case.
    const { authAsSubject } = await import('./p1-19-helpers');
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await read(LIST_TEMPLATES as Handler, '/api/v1/inspection-templates')).status).toBe(
      403
    );
    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (
        await read(
          TEMPLATE_DETAIL as Handler,
          `/api/v1/inspection-templates/${seeded.templateId}`,
          {
            templateId: seeded.templateId,
          }
        )
      ).status
    ).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (
        await read(LIST_ITEMS as Handler, `/api/v1/template-versions/${seeded.versionId}/items`, {
          versionId: seeded.versionId,
        })
      ).status
    ).toBe(403);
  });

  it('C4 — another tenant does not see the template: absent from its list, 404 on the detail', async () => {
    const seeded = await seedPublishedTemplate('w7_foreign');
    authAs(TEMPLATE_TENANT_B);
    const list = await read(LIST_TEMPLATES as Handler, '/api/v1/inspection-templates?limit=50');
    expect(list.status).toBe(200);
    const page = await json<{ items: readonly Record<string, unknown>[] }>(list);
    expect(page.items.find((row) => row['id'] === seeded.templateId)).toBeUndefined();
    authAs(TEMPLATE_TENANT_B);
    expect(
      (
        await read(
          TEMPLATE_DETAIL as Handler,
          `/api/v1/inspection-templates/${seeded.templateId}`,
          {
            templateId: seeded.templateId,
          }
        )
      ).status
    ).toBe(404);
  });
});

/* ------------------------------------------------------------------ *
 * The job workbench
 * ------------------------------------------------------------------ */

describe('W7 — the job workbench, the journey the screen drives', () => {
  it('J1 — start, answer by item id, record four entry kinds, move, complete, review, page the history', async () => {
    const seeded = await seedPublishedTemplate('w7_journey');
    const jobId = await seedJob();

    // The start form offers exactly the publishable set, in the mirror's shape.
    authAs(DIAGNOSTIC_RECORDER);
    const publishable = await read(
      LIST_PUBLISHABLE as Handler,
      `/api/v1/jobs/${jobId}/inspection-templates`,
      { jobId }
    );
    expect(publishable.status).toBe(200);
    const offered = await json<{ items: readonly Record<string, unknown>[] }>(publishable);
    const version = offered.items.find((row) => row['versionId'] === seeded.versionId);
    expect(version).toBeDefined();
    matchesMirror(version, 'PublishableVersion');

    authAs(DIAGNOSTIC_RECORDER);
    const started = await send(
      CREATE_REPORT as Handler,
      `/api/v1/jobs/${jobId}/inspections`,
      { jobId },
      { templateVersionId: seeded.versionId }
    );
    expect(started.status).toBe(201);
    const report = await json<Record<string, unknown> & Created>(started);
    matchesMirror(report, 'DiagnosticReport');
    const reportId = report.id;

    // The list the screen renders carries the report, in the same shape.
    authAs(DIAGNOSTIC_RECORDER);
    const reports = await read(LIST_REPORTS as Handler, `/api/v1/jobs/${jobId}/inspections`, {
      jobId,
    });
    expect(reports.status).toBe(200);
    const listed = await json<{ items: readonly Record<string, unknown>[] }>(reports);
    expect(listed.items.map((row) => row['id'])).toEqual([reportId]);

    // The detail, before anything is answered: results empty, mandatory outstanding.
    authAs(DIAGNOSTIC_RECORDER);
    const fresh = await json<
      Record<string, unknown> & {
        outstandingMandatory: readonly Record<string, unknown>[];
        items: readonly unknown[];
        report: Created;
      }
    >(
      await read(READ_REPORT as Handler, `/api/v1/inspections/${reportId}`, {
        inspectionId: reportId,
      })
    );
    matchesMirror(fresh, 'DiagnosticReportDetail');
    expect(fresh.items).toEqual([]);
    expect(fresh.outstandingMandatory.map((o) => o['itemCode'])).toEqual(['pad_depth']);
    matchesMirror(fresh.outstandingMandatory[0], 'OutstandingItem');

    // Answer the mandatory item BY ITS ID — the join the seam read makes possible.
    authAs(DIAGNOSTIC_RECORDER);
    const answered = await send(
      WRITE_ITEM as Handler,
      `/api/v1/inspections/${reportId}/items/${seeded.mandatoryItemId}`,
      { inspectionId: reportId, templateItemId: seeded.mandatoryItemId },
      { resultValue: '24.5' },
      { method: 'PUT' }
    );
    expect(answered.status).toBe(200);
    matchesMirror(await json(answered), 'ItemResult');

    // The four entry kinds, each in the mirror's shape.
    const entries: readonly [Handler, string, unknown, string][] = [
      [
        RECORD_MEASUREMENT as Handler,
        'measurements',
        { label: 'Pad depth', measuredValue: '24.5', unit: 'mm' },
        'Measurement',
      ],
      [RECORD_DTC as Handler, 'dtcs', { code: 'P0300', dtcStatus: 'active' }, 'DtcRecord'],
      [
        RECORD_FINDING as Handler,
        'findings',
        { severity: 'high', disposition: 'repair_required', description: 'Pads at the wear limit' },
        'Finding',
      ],
      [
        RECORD_RECOMMENDATION as Handler,
        'recommendations',
        { recommendation: 'Replace front pads', priority: 'high' },
        'Recommendation',
      ],
    ];
    for (const [handler, tail, body, interfaceName] of entries) {
      authAs(DIAGNOSTIC_RECORDER);
      const recorded = await send(
        handler,
        `/api/v1/inspections/${reportId}/${tail}`,
        { inspectionId: reportId },
        body
      );
      expect(recorded.status, `${tail}: ${await recorded.clone().text()}`).toBe(201);
      matchesMirror(await json(recorded), interfaceName);
    }

    // Move with the version the detail carried; a stale version is a conflict.
    authAs(DIAGNOSTIC_RECORDER);
    const moved = await send(
      TRANSITION_REPORT as Handler,
      `/api/v1/inspections/${reportId}/transition`,
      { inspectionId: reportId },
      { toStatus: 'in_progress' },
      { version: fresh.report.recordVersion }
    );
    expect(moved.status).toBe(200);
    authAs(DIAGNOSTIC_RECORDER);
    const stale = await send(
      COMPLETE_REPORT as Handler,
      `/api/v1/inspections/${reportId}/completion`,
      { inspectionId: reportId },
      {},
      { version: fresh.report.recordVersion }
    );
    expect(stale.status).toBe(409);

    // Complete with the renewed version, then review.
    authAs(DIAGNOSTIC_RECORDER);
    const current = await json<{ report: Created; nextStatuses: readonly string[] }>(
      await read(READ_REPORT as Handler, `/api/v1/inspections/${reportId}`, {
        inspectionId: reportId,
      })
    );
    expect(current.nextStatuses).toContain('completed');
    authAs(DIAGNOSTIC_RECORDER);
    const completed = await send(
      COMPLETE_REPORT as Handler,
      `/api/v1/inspections/${reportId}/completion`,
      { inspectionId: reportId },
      { summary: 'Front pads at the wear limit; replace.' },
      { version: current.report.recordVersion }
    );
    expect(completed.status).toBe(200);
    // Reviewer separation: the platform stamps the reviewer from the session and
    // refuses the recorder reviewing their own report, so the review is another actor's.
    authAsP119(REVIEWER);
    const reviewed = await send(
      RECORD_REVIEW as Handler,
      `/api/v1/inspections/${reportId}/reviews`,
      { inspectionId: reportId },
      { reviewResult: 'approved', notes: 'Agreed' }
    );
    expect(reviewed.status).toBe(201);
    matchesMirror(await json(reviewed), 'ReportReview');

    // The finished detail carries everything the workbench renders.
    authAs(DIAGNOSTIC_RECORDER);
    const finished = await json<
      Record<string, readonly unknown[]> & { report: Record<string, unknown> }
    >(
      await read(READ_REPORT as Handler, `/api/v1/inspections/${reportId}`, {
        inspectionId: reportId,
      })
    );
    expect(finished.report['status']).toBe('completed');
    expect(finished['items']).toHaveLength(1);
    expect(finished['measurements']).toHaveLength(1);
    expect(finished['dtcs']).toHaveLength(1);
    expect(finished['findings']).toHaveLength(1);
    expect(finished['recommendations']).toHaveLength(1);
    expect(finished['reviews']).toHaveLength(1);
    expect(finished['outstandingMandatory']).toEqual([]);

    // Recording on a completed report is refused — the screen withholds the forms for this reason.
    authAs(DIAGNOSTIC_RECORDER);
    const late = await send(
      RECORD_DTC as Handler,
      `/api/v1/inspections/${reportId}/dtcs`,
      { inspectionId: reportId },
      { code: 'P0301' }
    );
    expect(late.status).toBe(409);

    // The history the screen pages: origin plus the two moves, each in the mirror's shape.
    authAs(DIAGNOSTIC_RECORDER);
    const history = await read(
      READ_HISTORY as Handler,
      `/api/v1/inspections/${reportId}/history?limit=1`,
      { inspectionId: reportId }
    );
    expect(history.status).toBe(200);
    const first = await json<{
      diagnosticReportId: string;
      origin: Record<string, unknown>;
      transitions: {
        items: readonly Record<string, unknown>[];
        nextCursor: string | null;
        hasMore: boolean;
      };
    }>(history);
    matchesMirror(first, 'ReportHistory');
    expect(Object.keys(first.origin).sort()).toEqual(['createdAt', 'createdBy', 'initialStatus']);
    expect(first.transitions.items).toHaveLength(1);
    matchesMirror(first.transitions.items[0], 'ReportHistoryEntry');
    expect(first.transitions.hasMore).toBe(true);
    authAs(DIAGNOSTIC_RECORDER);
    const second = await json<{
      transitions: { items: readonly Record<string, unknown>[]; hasMore: boolean };
    }>(
      await read(
        READ_HISTORY as Handler,
        `/api/v1/inspections/${reportId}/history?limit=1&cursor=${encodeURIComponent(first.transitions.nextCursor ?? '')}`,
        { inspectionId: reportId }
      )
    );
    const all = [...first.transitions.items, ...second.transitions.items].map((e) => e['toState']);
    expect(all).toEqual(expect.arrayContaining(['in_progress', 'completed']));
  });

  it('J2 — a reader sees the job’s reports and a report; a recorder’s writes are refused to the reader', async () => {
    const seeded = await seedPublishedTemplate('w7_reader');
    const jobId = await seedJob();
    authAs(DIAGNOSTIC_RECORDER);
    const started = await send(
      CREATE_REPORT as Handler,
      `/api/v1/jobs/${jobId}/inspections`,
      { jobId },
      { templateVersionId: seeded.versionId }
    );
    expect(started.status).toBe(201);
    const reportId = (await json<Created>(started)).id;

    authAs(TEMPLATE_READER);
    expect(
      (await read(LIST_REPORTS as Handler, `/api/v1/jobs/${jobId}/inspections`, { jobId })).status
    ).toBe(200);
    authAs(TEMPLATE_READER);
    expect(
      (
        await read(READ_REPORT as Handler, `/api/v1/inspections/${reportId}`, {
          inspectionId: reportId,
        })
      ).status
    ).toBe(200);
    authAs(TEMPLATE_READER);
    const refused = await send(
      RECORD_DTC as Handler,
      `/api/v1/inspections/${reportId}/dtcs`,
      { inspectionId: reportId },
      { code: 'P0300' }
    );
    expect(refused.status).toBe(403);
  });

  it('J3 — no dia.diagnostic.read is a 403; another tenant’s job and report are 404', async () => {
    const seeded = await seedPublishedTemplate('w7_isolation');
    const jobId = await seedJob();
    authAs(DIAGNOSTIC_RECORDER);
    const started = await send(
      CREATE_REPORT as Handler,
      `/api/v1/jobs/${jobId}/inspections`,
      { jobId },
      { templateVersionId: seeded.versionId }
    );
    const reportId = (await json<Created>(started)).id;

    const { authAsSubject } = await import('./p1-19-helpers');
    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (await read(LIST_REPORTS as Handler, `/api/v1/jobs/${jobId}/inspections`, { jobId })).status
    ).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (
        await read(READ_REPORT as Handler, `/api/v1/inspections/${reportId}`, {
          inspectionId: reportId,
        })
      ).status
    ).toBe(403);

    authAs(TEMPLATE_TENANT_B);
    expect(
      (await read(LIST_REPORTS as Handler, `/api/v1/jobs/${jobId}/inspections`, { jobId })).status
    ).toBe(404);
    authAs(TEMPLATE_TENANT_B);
    expect(
      (
        await read(READ_REPORT as Handler, `/api/v1/inspections/${reportId}`, {
          inspectionId: reportId,
        })
      ).status
    ).toBe(404);
  });
});
