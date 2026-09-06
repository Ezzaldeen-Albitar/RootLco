import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The invoice ADAPTERS (P1-30, `W6`).
 *
 * The DOM tests mock this module wholesale and the backend proof calls the
 * routes directly, so neither says what request an adapter builds. That is
 * asserted HERE, with only the transport mocked.
 *
 * The properties this file protects: every read names its subject in the
 * path and sends no query; the two guarded writes carry the INVOICE's version
 * as `ifMatch` (issue with no body at all); create carries the caller's own
 * transport key so a retry replays instead of asking for a second invoice; and
 * money crosses this boundary as the strings it arrived as.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  cancelInvoice,
  createInvoice,
  issueInvoice,
  readInvoice,
  readInvoicePreview,
  readOutstanding,
  readWorkOrderInvoice,
} = await import('@/features/billing/api');
const { requiresIdempotencyKey, resolveOperation } = await import('@/lib/api/operation-contract');

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const INVOICE_ID = '99999999-9999-4999-8999-999999999999';
const KEY = '12121212-1212-4121-8121-121212121212';

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

const invoice = {
  id: INVOICE_ID,
  companyId: 'c',
  branchId: 'b',
  workOrderId: WORK_ORDER_ID,
  quotationRevisionId: 'rev-1',
  payerPartnerId: 'p',
  currency: 'USD',
  status: 'draft',
  invoiceNumber: null,
  issuedAt: null,
  recordVersion: 3,
  totals: {
    net: { amount: '150.0000', currency: 'USD' },
    tax: { amount: '15.0000', currency: 'USD' },
    gross: { amount: '165.0000', currency: 'USD' },
  },
};

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('every read names its subject in the path and sends no query', () => {
  it('reads the live invoice of a work order', async () => {
    get.mockResolvedValue(ok({ workOrderId: WORK_ORDER_ID, invoice: null }));
    const state = await readWorkOrderInvoice(WORK_ORDER_ID);
    expect(state.status).toBe('ok');
    if (state.status === 'ok') expect(state.data.invoice).toBeNull();
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/work-orders/${WORK_ORDER_ID}/invoice`);
  });

  it('reads the preview under the work order, and a 404 arrives as not-found, never as an empty preview', async () => {
    get.mockResolvedValue(failure('not-found'));
    const state = await readInvoicePreview(WORK_ORDER_ID);
    expect(state.status).toBe('not-found');
    expect(state.correlationId).toBe('corr-1');
    expect(String(get.mock.calls[0]?.[0])).toBe(
      `/api/v1/work-orders/${WORK_ORDER_ID}/invoice-preview`
    );
  });

  it('reads the detail and the outstanding balance by invoice id', async () => {
    get.mockResolvedValue(ok({ invoice, lines: [], recordVersion: 3 }));
    const detail = await readInvoice(INVOICE_ID);
    expect(detail.status).toBe('ok');
    if (detail.status === 'ok') expect(detail.data.recordVersion).toBe(3);
    get.mockResolvedValue(
      ok({
        invoiceId: INVOICE_ID,
        status: 'issued',
        outstanding: { amount: '100.0000', currency: 'USD' },
        isSettled: false,
      })
    );
    const outstanding = await readOutstanding(INVOICE_ID);
    expect(outstanding.status).toBe('ok');
    if (outstanding.status === 'ok') {
      expect(typeof outstanding.data.outstanding.amount).toBe('string');
      expect(outstanding.data.outstanding.amount).toBe('100.0000');
    }
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/invoices/${INVOICE_ID}`);
    expect(String(get.mock.calls[1]?.[0])).toBe(`/api/v1/invoices/${INVOICE_ID}/outstanding`);
  });

  it('a refused read is a refusal with its reference', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const state = await readOutstanding(INVOICE_ID);
    expect(state.status).toBe('denied');
    expect(state.correlationId).toBe('corr-1');
  });

  it('passes the money strings through untouched, and a null total as null', async () => {
    const hidden = { ...invoice, totals: null };
    get.mockResolvedValue(
      ok({
        invoice: hidden,
        lines: [
          {
            id: 'l',
            lineNumber: 1,
            lineType: 'service',
            quantity: '2.000',
            currency: 'USD',
            sourceQuotationItemId: 'q',
            recordVersion: 1,
            money: null,
          },
        ],
        recordVersion: 3,
      })
    );
    const state = await readInvoice(INVOICE_ID);
    expect(state.status).toBe('ok');
    if (state.status === 'ok') {
      expect(state.data.invoice.totals).toBeNull();
      expect(state.data.lines[0]?.money).toBeNull();
      expect(state.data.lines[0]?.quantity).toBe('2.000');
    }
  });

  it('an ended session is reported before any request is made', async () => {
    authorizedClient.mockResolvedValue(null);
    const state = await readInvoice(INVOICE_ID);
    expect(state.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the transport contract for the writes', () => {
  it('marks create, issue and cancel idempotent, so a key is attached to every send', () => {
    expect(resolveOperation('POST', '/api/v1/invoices')?.operationId).toBe('sal.invoice-create');
    expect(resolveOperation('POST', `/api/v1/invoices/${INVOICE_ID}/issuance`)?.operationId).toBe(
      'sal.invoice-issue'
    );
    expect(
      resolveOperation('POST', `/api/v1/invoices/${INVOICE_ID}/cancellation`)?.operationId
    ).toBe('sal.invoice-cancel');
    expect(requiresIdempotencyKey('POST', '/api/v1/invoices')).toBe(true);
    expect(requiresIdempotencyKey('POST', `/api/v1/invoices/${INVOICE_ID}/issuance`)).toBe(true);
    expect(requiresIdempotencyKey('POST', `/api/v1/invoices/${INVOICE_ID}/cancellation`)).toBe(
      true
    );
  });
});

describe('create carries the attempt key and no version', () => {
  it('sends the work order and the optional payer, with the caller’s own key', async () => {
    send.mockResolvedValue(ok({ invoice, lines: [], recordVersion: 3, replayed: false }));
    const outcome = await createInvoice({ workOrderId: WORK_ORDER_ID, payerPartnerId: 'p' }, KEY);
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('invoices.create.success');
    expect(outcome.created?.invoice.id).toBe(INVOICE_ID);
    const [method, path, body, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/invoices');
    expect(body).toEqual({ workOrderId: WORK_ORDER_ID, payerPartnerId: 'p' });
    expect(options).toEqual({ idempotencyKey: KEY });
    expect((options as { ifMatch?: unknown }).ifMatch).toBeUndefined();
  });

  it('sends no amount of its own, ever', async () => {
    send.mockResolvedValue(ok({ invoice, lines: [], recordVersion: 3, replayed: false }));
    await createInvoice({ workOrderId: WORK_ORDER_ID }, KEY);
    const body = send.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['workOrderId']);
  });

  it('passes a replay through as a replay', async () => {
    send.mockResolvedValue(ok({ invoice, lines: [], recordVersion: 3, replayed: true }));
    const outcome = await createInvoice({ workOrderId: WORK_ORDER_ID }, KEY);
    expect(outcome.created?.replayed).toBe(true);
  });

  it('a conflict (an invoice already exists) is a conflict with its reference and nothing created', async () => {
    send.mockResolvedValue(failure('conflict'));
    const outcome = await createInvoice({ workOrderId: WORK_ORDER_ID }, KEY);
    expect(outcome.state.status).toBe('conflict');
    expect(outcome.state.correlationId).toBe('corr-1');
    expect(outcome.created).toBeNull();
  });
});

describe('issue and cancel carry the invoice’s version', () => {
  it('issues with no body and If-Match = the version given', async () => {
    send.mockResolvedValue(
      ok({
        invoice: { ...invoice, status: 'issued', invoiceNumber: 'FXINV-000001' },
        invoiceNumber: 'FXINV-000001',
        replayed: false,
        recordVersion: 4,
      })
    );
    const outcome = await issueInvoice(INVOICE_ID, 3);
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('invoices.issue.success');
    expect(outcome.created?.invoiceNumber).toBe('FXINV-000001');
    const [method, path, body, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/invoices/${INVOICE_ID}/issuance`);
    expect(body).toBeUndefined();
    expect(options).toEqual({ ifMatch: 3 });
  });

  it('cancels with the reason and If-Match = the version given', async () => {
    send.mockResolvedValue(
      ok({
        invoice: { ...invoice, status: 'void_before_issue' },
        replayed: false,
        recordVersion: 4,
      })
    );
    const outcome = await cancelInvoice(INVOICE_ID, { reason: 'wrong customer' }, 3);
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('invoices.cancel.success');
    const [method, path, body, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/invoices/${INVOICE_ID}/cancellation`);
    expect(body).toEqual({ reason: 'wrong customer' });
    expect(options).toEqual({ ifMatch: 3 });
  });

  it('a stale version is a conflict with its reference and nothing changed', async () => {
    send.mockResolvedValue(failure('conflict'));
    const outcome = await issueInvoice(INVOICE_ID, 2);
    expect(outcome.state.status).toBe('conflict');
    expect(outcome.state.correlationId).toBe('corr-1');
    expect(outcome.created).toBeNull();
  });

  it('a repeat on an invoice already past draft is passed through as replayed', async () => {
    send.mockResolvedValue(
      ok({
        invoice: { ...invoice, status: 'issued' },
        invoiceNumber: 'FXINV-000001',
        replayed: true,
        recordVersion: 4,
      })
    );
    const outcome = await issueInvoice(INVOICE_ID, 4);
    expect(outcome.created?.replayed).toBe(true);
  });

  it('an ended session is reported before any write is sent', async () => {
    authorizedClient.mockResolvedValue(null);
    const issued = await issueInvoice(INVOICE_ID, 3);
    const cancelled = await cancelInvoice(INVOICE_ID, { reason: 'x' }, 3);
    const created = await createInvoice({ workOrderId: WORK_ORDER_ID }, KEY);
    expect(issued.state.status).toBe('expired');
    expect(cancelled.state.status).toBe('expired');
    expect(created.state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});
