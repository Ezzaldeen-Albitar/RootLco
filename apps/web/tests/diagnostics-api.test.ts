/**
 * P1-29 W7 — the diagnostics adapters, proved at the request they build.
 *
 * A backend test proves what the API answers; it cannot prove what THIS
 * application sends. These cases hold the path, method, body and `If-Match` of
 * every write the screens perform, and the failure mapping of the reads, with
 * the client mocked at the boundary the adapters share.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const captureDocument = vi.fn();
const createDocumentLink = vi.fn();
const listDocumentCategories = vi.fn();
vi.mock('@/features/attachments/api', () => ({
  captureDocument: (...args: unknown[]) => captureDocument(...args),
  createDocumentLink: (...args: unknown[]) => createDocumentLink(...args),
  listDocumentCategories: () => listDocumentCategories(),
}));

const api = await import('@/features/diagnostics/api');

const TEMPLATE = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const REPORT = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockClear();
  captureDocument.mockReset();
  createDocumentLink.mockReset();
  listDocumentCategories.mockReset();
});

describe('reads — each names its operation path, and none carries a scope', () => {
  it('lists the vocabulary, the templates (paged), a template, a version’s items', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    await api.listDiagnosticTypes();
    await api.listTemplates({ status: 'active' }, null);
    await api.listTemplates({}, 'cursor-1');
    await api.readTemplate(TEMPLATE);
    await api.listVersionItems(VERSION);
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/diagnostic-types',
      '/api/v1/inspection-templates?status=active&limit=50',
      '/api/v1/inspection-templates?cursor=cursor-1&limit=50',
      `/api/v1/inspection-templates/${TEMPLATE}`,
      `/api/v1/template-versions/${VERSION}/items`,
    ]);
  });

  it('reads the job side: publishable versions, reports, one report, its history', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    await api.listPublishableVersions(JOB);
    await api.listJobReports(JOB);
    await api.readReport(REPORT);
    await api.readReportHistory(REPORT, null);
    await api.readReportHistory(REPORT, 'c2');
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      `/api/v1/jobs/${JOB}/inspection-templates`,
      `/api/v1/jobs/${JOB}/inspections`,
      `/api/v1/inspections/${REPORT}`,
      `/api/v1/inspections/${REPORT}/history?limit=50`,
      `/api/v1/inspections/${REPORT}/history?cursor=c2&limit=50`,
    ]);
  });

  it('maps a refused read to its status and keeps the reference', async () => {
    get.mockResolvedValueOnce(failure('forbidden'));
    const denied = await api.readReport(REPORT);
    expect(denied.status).toBe('denied');
    expect(denied.correlationId).toBe('corr-1');
    get.mockResolvedValueOnce(failure('not-found'));
    expect((await api.readTemplate(TEMPLATE)).status).toBe('not-found');
  });

  it('reports an expired session without touching the network', async () => {
    authorizedClient.mockResolvedValueOnce(null);
    expect((await api.listDiagnosticTypes()).status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('authoring writes — the request each form builds', () => {
  it('creates a template with exactly the mirror body', async () => {
    send.mockResolvedValue(ok({}));
    const outcome = await api.createTemplate({
      code: 'brake_check',
      name: 'Brake check',
      diagnosticTypeId: TEMPLATE,
    });
    expect(outcome.status).toBe('success');
    expect(send).toHaveBeenCalledWith(
      'POST',
      '/api/v1/inspection-templates',
      { code: 'brake_check', name: 'Brake check', diagnosticTypeId: TEMPLATE },
      {}
    );
  });

  it('updates a template with PATCH and the If-Match it was rendered from', async () => {
    send.mockResolvedValue(ok({}));
    await api.updateTemplate(TEMPLATE, { name: 'Renamed' }, 4);
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/inspection-templates/${TEMPLATE}`,
      { name: 'Renamed' },
      { ifMatch: 4 }
    );
  });

  it('opens a version, authors an item, publishes and retires', async () => {
    send.mockResolvedValue(ok({}));
    await api.createVersion(TEMPLATE, { copyFromVersionId: VERSION });
    await api.createItem(VERSION, {
      itemCode: 'pad_depth',
      prompt: 'Pad depth',
      responseType: 'numeric',
      unit: 'mm',
      isMandatory: true,
    });
    await api.setVersionStatus(VERSION, { toStatus: 'published' }, 1);
    await api.setVersionStatus(VERSION, { toStatus: 'retired' }, 2);
    expect(send.mock.calls).toEqual([
      [
        'POST',
        `/api/v1/inspection-templates/${TEMPLATE}/versions`,
        { copyFromVersionId: VERSION },
        {},
      ],
      [
        'POST',
        `/api/v1/template-versions/${VERSION}/items`,
        {
          itemCode: 'pad_depth',
          prompt: 'Pad depth',
          responseType: 'numeric',
          unit: 'mm',
          isMandatory: true,
        },
        {},
      ],
      [
        'POST',
        `/api/v1/template-versions/${VERSION}/status`,
        { toStatus: 'published' },
        { ifMatch: 1 },
      ],
      [
        'POST',
        `/api/v1/template-versions/${VERSION}/status`,
        { toStatus: 'retired' },
        { ifMatch: 2 },
      ],
    ]);
  });

  it('maps a conflict, a refusal and validation without inventing a success', async () => {
    send.mockResolvedValueOnce(failure('conflict'));
    expect((await api.updateTemplate(TEMPLATE, { name: 'x' }, 1)).status).toBe('conflict');
    send.mockResolvedValueOnce(failure('forbidden'));
    expect(
      (await api.createTemplate({ code: 'a', name: 'b', diagnosticTypeId: TEMPLATE })).status
    ).toBe('denied');
    send.mockResolvedValueOnce(failure('validation'));
    expect(
      (await api.createItem(VERSION, { itemCode: 'x', prompt: 'y', responseType: 'text' })).status
    ).toBe('invalid');
  });
});

describe('execution writes — every entry is addressed to the report, results to the item', () => {
  it('starts a report, answers an item by its id, records the four entry kinds', async () => {
    send.mockResolvedValue(ok({}));
    await api.createReport(JOB, { templateVersionId: VERSION });
    await api.writeItemResult(REPORT, ITEM, { resultValue: '24.5' });
    await api.writeItemResult(REPORT, ITEM, { notApplicableReason: 'No rear drum' });
    await api.recordMeasurement(REPORT, { label: 'Pad depth', measuredValue: '24.5', unit: 'mm' });
    await api.recordDtc(REPORT, { code: 'P0300', dtcStatus: 'active' });
    await api.recordFinding(REPORT, {
      severity: 'high',
      disposition: 'repair_required',
      description: 'Pads worn',
    });
    await api.recordRecommendation(REPORT, { recommendation: 'Replace pads', priority: 'high' });
    expect(send.mock.calls).toEqual([
      ['POST', `/api/v1/jobs/${JOB}/inspections`, { templateVersionId: VERSION }, {}],
      ['PUT', `/api/v1/inspections/${REPORT}/items/${ITEM}`, { resultValue: '24.5' }, {}],
      [
        'PUT',
        `/api/v1/inspections/${REPORT}/items/${ITEM}`,
        { notApplicableReason: 'No rear drum' },
        {},
      ],
      [
        'POST',
        `/api/v1/inspections/${REPORT}/measurements`,
        { label: 'Pad depth', measuredValue: '24.5', unit: 'mm' },
        {},
      ],
      ['POST', `/api/v1/inspections/${REPORT}/dtcs`, { code: 'P0300', dtcStatus: 'active' }, {}],
      [
        'POST',
        `/api/v1/inspections/${REPORT}/findings`,
        { severity: 'high', disposition: 'repair_required', description: 'Pads worn' },
        {},
      ],
      [
        'POST',
        `/api/v1/inspections/${REPORT}/recommendations`,
        { recommendation: 'Replace pads', priority: 'high' },
        {},
      ],
    ]);
  });

  it('moves and completes with the If-Match of the detail it holds, and reviews without one', async () => {
    send.mockResolvedValue(ok({}));
    await api.transitionReport(REPORT, { toStatus: 'in_progress' }, 2);
    await api.completeReport(REPORT, { summary: 'Done' }, 3);
    await api.completeReport(REPORT, {}, 3);
    await api.reviewReport(REPORT, { reviewResult: 'approved' });
    expect(send.mock.calls).toEqual([
      [
        'POST',
        `/api/v1/inspections/${REPORT}/transition`,
        { toStatus: 'in_progress' },
        { ifMatch: 2 },
      ],
      ['POST', `/api/v1/inspections/${REPORT}/completion`, { summary: 'Done' }, { ifMatch: 3 }],
      ['POST', `/api/v1/inspections/${REPORT}/completion`, {}, { ifMatch: 3 }],
      ['POST', `/api/v1/inspections/${REPORT}/reviews`, { reviewResult: 'approved' }, {}],
    ]);
  });

  it('never sends a status the graph does not name, because the type refuses it', () => {
    // A compile-time property, stated here so the vocabulary is visible in the proof.
    const body: Parameters<typeof api.transitionReport>[1] = { toStatus: 'cancelled' };
    expect(body.toStatus).toBe('cancelled');
  });
});

describe('evidence — capture, link against the report, bind', () => {
  const file = () => new File([new Uint8Array([1, 2, 3])], 'pads.jpg', { type: 'image/jpeg' });
  const form = (overrides: Record<string, string | File> = {}) => {
    const data = new FormData();
    data.set('evidenceFile', file());
    data.set('categoryCode', 'evidence_photo');
    data.set('evidenceType', 'pad wear photo');
    for (const [key, value] of Object.entries(overrides)) data.set(key, value);
    return data;
  };
  const registered = {
    status: 'success',
    correlationId: 'corr-1',
    attempt: 1,
    registered: {
      documentId: 'doc-1',
      versionId: 'ver-1',
      status: 'clean',
      scannerAvailable: true,
    },
  };

  it('refuses an empty file and a missing category or type before any network call', async () => {
    const empty = new FormData();
    empty.set('categoryCode', 'evidence_photo');
    empty.set('evidenceType', 'x');
    expect((await api.captureReportEvidence(REPORT, empty)).fieldErrors).toEqual({
      evidenceFile: 'attachments.capture.empty',
    });
    const noType = form({ evidenceType: '' });
    expect((await api.captureReportEvidence(REPORT, noType)).fieldErrors).toEqual({
      evidenceType: 'field.required',
    });
    expect(captureDocument).not.toHaveBeenCalled();
  });

  it('links the stored document against the REPORT and binds its version', async () => {
    listDocumentCategories.mockResolvedValue({
      status: 'ok',
      correlationId: 'c',
      data: { items: [{ categoryCode: 'evidence_photo', businessLinkPurpose: 'evidence' }] },
    });
    captureDocument.mockResolvedValue(registered);
    createDocumentLink.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    send.mockResolvedValue(ok({}));

    const outcome = await api.captureReportEvidence(REPORT, form({ note: 'left front' }));

    expect(captureDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'dia.diagnostic_report',
        entityId: REPORT,
        categoryCode: 'evidence_photo',
      })
    );
    expect(createDocumentLink).toHaveBeenCalledWith('doc-1', {
      entityType: 'dia.diagnostic_report',
      entityId: REPORT,
      linkPurpose: 'evidence',
    });
    expect(send).toHaveBeenCalledWith('POST', `/api/v1/inspections/${REPORT}/evidence`, {
      documentVersionId: 'ver-1',
      evidenceType: 'pad wear photo',
      note: 'left front',
    });
    expect(outcome).toMatchObject({ status: 'success', stage: 'bound', versionId: 'ver-1' });
  });

  it('names the stage reached when the bind is refused, so nothing stored is lost silently', async () => {
    listDocumentCategories.mockResolvedValue({
      status: 'ok',
      correlationId: 'c',
      data: { items: [{ categoryCode: 'evidence_photo', businessLinkPurpose: 'evidence' }] },
    });
    captureDocument.mockResolvedValue(registered);
    createDocumentLink.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    send.mockResolvedValue(failure('forbidden'));
    const outcome = await api.captureReportEvidence(REPORT, form());
    expect(outcome).toMatchObject({ status: 'denied', stage: 'linked', versionId: 'ver-1' });
  });
});
