import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The quotation ADAPTERS (P1-30, `W3`).
 *
 * The DOM tests mock this module wholesale and the backend proof calls the
 * routes directly, so neither says whether an adapter sends the version, the
 * body or the query at all. The request each adapter builds is asserted HERE,
 * with only the transport mocked.
 *
 * Three properties this file protects: the list is addressed to its work
 * order and asserts no scope; the two guarded writes carry the QUOTATION's
 * version; and money crosses this boundary as the strings it arrived as.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  createQuotation,
  createQuotationRevision,
  decideItem,
  decideRevision,
  issueQuotation,
  listQuotations,
  listRevisions,
  readQuotation,
  readRevision,
  readRevisionDecisions,
} = await import('@/features/quotations/api');

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const QUOTATION_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '66666666-6666-4666-8666-666666666666';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';

const REQUEST = { pageSize: 25 } as never;
const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

const SUMMARY = {
  id: QUOTATION_ID,
  quotationNumber: 'QUO-000001',
  workOrderId: WORK_ORDER_ID,
  companyId: 'c',
  branchId: 'b',
  currency: 'JOD',
  status: 'draft',
  payerPartnerRef: null,
  currentRevisionId: null,
  recordVersion: 1,
};

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the list is addressed to its work order and asserts no scope', () => {
  it('reads the work order’s quotations with the page size and the cursor', async () => {
    get.mockResolvedValue(ok({ items: [SUMMARY], nextCursor: 'c2', hasMore: true }));
    const page = await listQuotations(WORK_ORDER_ID, REQUEST, 'c1');
    expect(page.status).toBe('ok');
    expect(page.rows).toEqual([SUMMARY]);
    expect(page.nextCursor).toBe('c2');
    expect(page.hasMore).toBe(true);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith(`/api/v1/work-orders/${WORK_ORDER_ID}/quotations?`)).toBe(true);
    const search = new URLSearchParams(path.slice(path.indexOf('?')));
    expect(search.get('limit')).toBe('25');
    expect(search.get('cursor')).toBe('c1');
    expect(search.has('companyId')).toBe(false);
    expect(search.has('branchId')).toBe(false);
    expect(search.has('tenantId')).toBe(false);
  });

  it('a refusal is a refusal, never an empty list', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const page = await listQuotations(WORK_ORDER_ID, REQUEST, null);
    expect(page.status).toBe('denied');
    expect(page.rows).toEqual([]);
    expect(page.correlationId).toBe('corr-1');
  });

  it('an ended session is reported before any request is made', async () => {
    authorizedClient.mockResolvedValue(null);
    const page = await listQuotations(WORK_ORDER_ID, REQUEST, null);
    expect(page.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the other reads address the right resource', () => {
  it('reads one quotation by id', async () => {
    get.mockResolvedValue(ok({ ...SUMMARY, currentRevision: null }));
    const state = await readQuotation(QUOTATION_ID);
    expect(state.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/quotations/${QUOTATION_ID}`);
  });

  it('reads the revision history under its quotation', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listRevisions(QUOTATION_ID, REQUEST, null);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith(`/api/v1/quotations/${QUOTATION_ID}/revisions?`)).toBe(true);
  });

  it('reads one revision and its decisions by revision id', async () => {
    get.mockResolvedValue(ok({}));
    await readRevision(REVISION_ID);
    await readRevisionDecisions(REVISION_ID);
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/quotation-revisions/${REVISION_ID}`);
    expect(String(get.mock.calls[1]?.[0])).toBe(
      `/api/v1/quotation-revisions/${REVISION_ID}/decisions`
    );
  });

  it('passes the captured figures through untouched', async () => {
    const revision = {
      id: REVISION_ID,
      revisionNumber: 1,
      status: 'issued',
      currency: 'JOD',
      issuedAt: null,
      expiresAt: null,
      subtotal: '200.0000',
      discountTotal: '0.0000',
      taxTotal: '20.0000',
      grandTotal: '220.0000',
      recordVersion: 1,
      lines: [],
    };
    get.mockResolvedValue(ok(revision));
    const state = await readRevision(REVISION_ID);
    if (state.status === 'ok') {
      expect(state.data.grandTotal).toBe('220.0000');
      expect(typeof state.data.taxTotal).toBe('string');
    } else {
      throw new Error('expected ok');
    }
  });
});

describe('the guarded writes carry the QUOTATION version, and the others carry none', () => {
  it('createQuotationRevision sends If-Match with the body unchanged', async () => {
    send.mockResolvedValue(ok({ id: REVISION_ID, revisionNumber: 2 }));
    const body = { lines: [{ serviceId: SERVICE_ID, quantity: '2.000', discount: '5.0000' }] };
    const outcome = await createQuotationRevision(QUOTATION_ID, body, 3);
    expect(outcome.state.status).toBe('success');
    expect(outcome.created).toEqual({ id: REVISION_ID, revisionNumber: 2 });
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/quotations/${QUOTATION_ID}/revisions`,
      body,
      {
        ifMatch: 3,
      }
    );
    // Strings in, strings out: nothing here turned a quantity or a discount into a number.
    const sent = send.mock.calls[0]?.[2] as { lines: { quantity: unknown; discount: unknown }[] };
    expect(typeof sent.lines[0]?.quantity).toBe('string');
    expect(typeof sent.lines[0]?.discount).toBe('string');
  });

  it('issueQuotation sends If-Match to the issue path', async () => {
    send.mockResolvedValue(ok({ id: REVISION_ID, status: 'issued' }));
    const state = await issueQuotation(QUOTATION_ID, { revisionId: REVISION_ID }, 3);
    expect(state.status).toBe('success');
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/quotations/${QUOTATION_ID}/issue`,
      { revisionId: REVISION_ID },
      { ifMatch: 3 }
    );
  });

  it('a stale version is a conflict, reported as one', async () => {
    send.mockResolvedValue(failure('conflict'));
    const state = await issueQuotation(QUOTATION_ID, { revisionId: REVISION_ID }, 2);
    expect(state.status).toBe('conflict');
    expect(state.correlationId).toBe('corr-1');
  });

  it('createQuotation posts the lines as given and passes no version', async () => {
    send.mockResolvedValue(ok({ ...SUMMARY, currentRevision: null }));
    const body = {
      workOrderId: WORK_ORDER_ID,
      lines: [{ serviceId: SERVICE_ID, quantity: '1' }],
    };
    const outcome = await createQuotation(body);
    expect(outcome.state.status).toBe('success');
    expect(outcome.created?.id).toBe(QUOTATION_ID);
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/quotations', body);
    expect(send.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('a refused discount comes back as a denial with its reference, never as a created quotation', async () => {
    send.mockResolvedValue(failure('forbidden'));
    const outcome = await createQuotation({
      workOrderId: WORK_ORDER_ID,
      lines: [{ serviceId: SERVICE_ID, quantity: '1', discount: '1000.0000' }],
    });
    expect(outcome.state.status).toBe('denied');
    expect(outcome.state.correlationId).toBe('corr-1');
    expect(outcome.created).toBeNull();
  });

  it('decideRevision and decideItem post the decision bodies unchanged, and no version', async () => {
    send.mockResolvedValue(ok({ decision: 'approved' }));
    const body = {
      decision: 'approved' as const,
      channel: 'in_person' as const,
      presentedRevisionId: REVISION_ID,
      evidence: { evidenceKind: 'verbal' as const, referenceNote: 'agreed at the counter' },
    };
    await decideRevision(REVISION_ID, body);
    await decideItem(ITEM_ID, body);
    expect(send).toHaveBeenNthCalledWith(
      1,
      'POST',
      `/api/v1/quotation-revisions/${REVISION_ID}/decisions`,
      body
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'POST',
      `/api/v1/quotation-items/${ITEM_ID}/decisions`,
      body
    );
    expect(send.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('every write reports an ended session without sending anything', async () => {
    authorizedClient.mockResolvedValue(null);
    expect((await createQuotation({ workOrderId: WORK_ORDER_ID, lines: [] })).state.status).toBe(
      'expired'
    );
    expect((await createQuotationRevision(QUOTATION_ID, { lines: [] }, 1)).state.status).toBe(
      'expired'
    );
    expect((await issueQuotation(QUOTATION_ID, { revisionId: REVISION_ID }, 1)).status).toBe(
      'expired'
    );
    expect(
      (
        await decideRevision(REVISION_ID, {
          decision: 'approved',
          channel: 'phone',
          presentedRevisionId: REVISION_ID,
        })
      ).state.status
    ).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});
