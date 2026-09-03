/**
 * P1-29 `W7` (Backend seam) — `dia.template-version-item-list`, the items of one
 * inspection template version.
 *
 * The diagnostics experience cannot be built on the surface `develop` carried,
 * and this file says exactly why before it proves the read that closes the gap:
 *
 *  1. **G1 — the gap, on real responses.** `dia.template-detail` returns the
 *     template and its versions and NO items; `dia.diagnostic-detail` returns
 *     the report's results, each naming `templateItemId` and `itemCode` and
 *     NOT the prompt, the response type, the unit or whether the item is
 *     mandatory. A screen that executes an inspection cannot show what each
 *     item asks, and a screen that authors one cannot show what was authored.
 *     Asserted, not narrated: if a later change enriches either response this
 *     case goes red and the seam can be retired.
 *  2. **P1 — the items come back in checklist order with the full shape**,
 *     from the published fixture version, and the shape is the row the
 *     authoring write already returns — one vocabulary for both verbs.
 *  3. **P2 — a draft version's items are readable on the same permission**:
 *     the authoring screen renders them on `dia.diagnostic.read`; status gates
 *     the WRITE, not this read.
 *  4. **N1 — an unknown query parameter is a 422**, not a silent ignore.
 *  5. **N2 — no `dia.diagnostic.read`, no items** (403), and no grant at all.
 *  6. **S1 — another tenant's version is a 404**, the same answer
 *     `dia.template-item-create` gives, so the two verbs agree about what exists.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   dia.template-version-item-list: route service authorization success denial cross-tenant isolation
 */
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
  ITEM_BRAKE_THICKNESS,
  ITEM_ROAD_TEST,
  ITEM_TYRE_CONDITION,
  READER,
  TENANT_B_FULL,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  establishDiagnosticFixtures,
  establishP1_19Fixtures,
  seedDraftTemplateVersion,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  GET as LIST_ITEMS,
  TEMPLATE_VERSION_ITEM_LIST_OPERATION,
} from '@/app/api/v1/template-versions/[versionId]/items/route';
import { GET as TEMPLATE_DETAIL } from '@/app/api/v1/inspection-templates/[templateId]/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as CREATE_REPORT } from '@/app/api/v1/jobs/[jobId]/inspections/route';
import { GET as REPORT_DETAIL } from '@/app/api/v1/inspections/[inspectionId]/route';

let admin: Pool;
let runtime: Pool;
let publishedVersionId: string;
let publishedTemplateId: string;

/** The wire shape, field for field the row `dia.template-item-create` returns. */
const ITEM_FIELDS = [
  'id',
  'itemCode',
  'prompt',
  'responseType',
  'unit',
  'isMandatory',
  'validationRule',
  'sequence',
  'recordVersion',
] as const;

interface ItemRow {
  readonly id: string;
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: string;
  readonly unit: string | null;
  readonly isMandatory: boolean;
  readonly validationRule: unknown;
  readonly sequence: number;
  readonly recordVersion: number;
}
interface Items {
  readonly items: readonly ItemRow[];
}
interface Problem {
  readonly code?: string;
}

const json = <T>(response: Response): Promise<T> => response.json() as Promise<T>;

function send(
  handler: (request: Request, route: { params: Promise<never> }) => Promise<Response>,
  url: string,
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  return handler(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params as never) }
  );
}

const listItems = (versionId: string, query = ''): Promise<Response> =>
  LIST_ITEMS(
    new Request(
      `http://localhost/api/v1/template-versions/${versionId}/items${query ? `?${query}` : ''}`
    ),
    { params: Promise.resolve({ versionId }) }
  );

const templateDetail = (templateId: string): Promise<Response> =>
  TEMPLATE_DETAIL(new Request(`http://localhost/api/v1/inspection-templates/${templateId}`), {
    params: Promise.resolve({ templateId }),
  });

const reportDetail = (inspectionId: string): Promise<Response> =>
  REPORT_DETAIL(new Request(`http://localhost/api/v1/inspections/${inspectionId}`), {
    params: Promise.resolve({ inspectionId }),
  });

/** An open work order with one diagnostic-requiring job and one report on it. */
async function seedReport(): Promise<string> {
  const order = await createOpenWorkOrder();
  authAs(FULL);
  const job = await send(
    CREATE_JOB as never,
    `/api/v1/work-orders/${order.workOrderId}/jobs`,
    { workOrderId: order.workOrderId },
    { title: 'W7 seam fixture — brake inspection', requiresDiagnostic: true }
  );
  if (job.status !== 201) throw new Error(`fixture job failed with ${job.status}`);
  const { id: jobId } = await json<{ id: string }>(job);
  authAs(FULL);
  const report = await send(
    CREATE_REPORT as never,
    `/api/v1/jobs/${jobId}/inspections`,
    { jobId },
    { templateVersionId: publishedVersionId }
  );
  if (report.status !== 201) throw new Error(`fixture report failed with ${report.status}`);
  return (await json<{ id: string }>(report)).id;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
  publishedVersionId = (await establishDiagnosticFixtures()).templateVersionId;
  const owner = await admin.query<{ template_id: string }>(
    'SELECT template_id FROM dia.template_versions WHERE id = $1',
    [publishedVersionId]
  );
  publishedTemplateId = owner.rows[0]?.template_id ?? '';
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

describe('dia.template-version-item-list — the gap it closes, on real responses', () => {
  it('declares the id and authority the canonical record states', () => {
    expect(TEMPLATE_VERSION_ITEM_LIST_OPERATION.id).toBe('dia.template-version-item-list');
    expect(TEMPLATE_VERSION_ITEM_LIST_OPERATION.permissions).toEqual(['dia.diagnostic.read']);
    expect(TEMPLATE_VERSION_ITEM_LIST_OPERATION.method).toBe('GET');
    expect(TEMPLATE_VERSION_ITEM_LIST_OPERATION.path).toBe('/template-versions/{versionId}/items');
  });

  it('G1 — the template detail carries no items, and the report results carry no prompt', async () => {
    // The authoring side: versions, each counted, none itemised.
    authAs(FULL);
    const detail = await templateDetail(publishedTemplateId);
    expect(detail.status).toBe(200);
    const template = await json<{
      readonly template: Record<string, unknown>;
      readonly versions: readonly Record<string, unknown>[];
    }>(detail);
    expect(Object.keys(template).sort()).toEqual(['template', 'versions']);
    const pinned = template.versions.find((v) => v['id'] === publishedVersionId);
    expect(pinned).toBeDefined();
    expect(pinned?.['itemCount']).toBe(3);
    expect(pinned).not.toHaveProperty('items');

    // The execution side. `items` is the RESULTS ledger: a fresh report has
    // answered nothing, so it is empty — the screen is handed no checklist at
    // all. `outstandingMandatory` names the mandatory items still open (one of
    // the fixture's three) by code and prompt, and carries no id, so even the
    // items it does name cannot be answered: `dia.diagnostic-item-result` is
    // keyed by `templateItemId`, which nothing here supplies.
    const reportId = await seedReport();
    authAs(FULL);
    const report = await reportDetail(reportId);
    expect(report.status).toBe(200);
    const body = await json<{
      readonly items: readonly Record<string, unknown>[];
      readonly outstandingMandatory: readonly Record<string, unknown>[];
    }>(report);
    expect(body.items).toEqual([]);
    const outstandingCodes = body.outstandingMandatory.map((o) => o['itemCode']);
    expect(outstandingCodes).toContain(ITEM_BRAKE_THICKNESS);
    // The road test is optional in the fixture, so the one place the detail
    // names items by prompt does not name it: the checklist is incomplete here.
    expect(outstandingCodes).not.toContain(ITEM_ROAD_TEST);
    for (const outstanding of body.outstandingMandatory) {
      expect(Object.keys(outstanding).sort()).toEqual(['itemCode', 'prompt', 'responseType']);
    }
  });
});

describe('dia.template-version-item-list — the read', () => {
  it('P1 — the published version answers its items in checklist order, full shape', async () => {
    authAs(FULL);
    const response = await listItems(publishedVersionId);
    expect(response.status).toBe(200);
    const { items } = await json<Items>(response);
    expect(items.map((item) => item.itemCode)).toEqual([
      ITEM_BRAKE_THICKNESS,
      ITEM_ROAD_TEST,
      ITEM_TYRE_CONDITION,
    ]);
    expect(items.map((item) => item.sequence)).toEqual([1, 2, 3]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([...ITEM_FIELDS].sort());
    }
    const brake = items[0];
    expect(brake?.responseType).toBe('numeric');
    expect(brake?.unit).toBe('mm');
    expect(brake?.isMandatory).toBe(true);
    expect(brake?.prompt.length).toBeGreaterThan(0);
  });

  it('P2 — a DRAFT version is readable on the same permission; status gates the write', async () => {
    const draftId = await seedDraftTemplateVersion();
    authAs(FULL);
    const response = await listItems(draftId);
    expect(response.status).toBe(200);
    expect((await json<Items>(response)).items).toEqual([]);
  });

  it('N1 — an unknown query parameter is a 422, not a silent ignore', async () => {
    authAs(FULL);
    const response = await listItems(publishedVersionId, 'limit=5');
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).code).toBe('ERR-VAL-001');
  });

  it('N2 — without dia.diagnostic.read the read is refused, and so is no grant at all', async () => {
    authAs(READER);
    expect((await listItems(publishedVersionId)).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await listItems(publishedVersionId)).status).toBe(403);
  });

  it('S1 — another tenant’s version is a 404, as the write verb already answers', async () => {
    authAs(TENANT_B_FULL);
    const response = await listItems(publishedVersionId);
    expect(response.status).toBe(404);
    expect((await json<Problem>(response)).code).toBe('ERR-RES-001');
  });
});
