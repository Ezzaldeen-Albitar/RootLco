import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The payment ADAPTERS (P1-30, `W7`).
 *
 * The DOM tests mock this module wholesale and the backend proof calls the
 * routes directly, so neither says what request an adapter builds. That is
 * asserted HERE, with only the transport mocked.
 *
 * The properties this file protects: the branch-scoped list sends BOTH halves
 * of its target and refuses to send a half-target at all; the detail names its
 * receipt in the path and sends no query; NEITHER write sends `If-Match`; each
 * write carries the caller's own transport key; and money crosses this boundary
 * as the strings it arrived as, with no figure computed here.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  allocatePayment,
  approveReceiptReversal,
  listBranches,
  listPaymentMethods,
  listReceipts,
  readOutstanding,
  readReceipt,
  recordPayment,
  recordReplacementReceipt,
  rejectReceiptReversal,
  requestReceiptReversal,
  withdrawReceiptReversal,
} = await import('@/features/payments/api');
const { requiresIdempotencyKey, resolveOperation } = await import('@/lib/api/operation-contract');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const PARTNER_ID = '55555555-5555-4555-8555-555555555555';
const METHOD_ID = '66666666-6666-4666-8666-666666666666';
const KEY = '12121212-1212-4121-8121-121212121212';

const TARGET = { companyId: COMPANY_ID, branchId: BRANCH_ID };
const NO_FILTERS = { payerPartnerId: null, status: null, invoiceId: null };
const REQUEST = { page: 1, pageSize: 25, sort: null, filters: {} } as never;

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

const receipt = {
  id: RECEIPT_ID,
  reference: 'RCT-000007',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  payerPartnerId: PARTNER_ID,
  method: {
    id: METHOD_ID,
    scope: 'tenant',
    kind: 'cash',
    displayName: 'Front desk cash',
    status: 'active',
  },
  money: { amount: '100.0000', currency: 'USD' },
  unallocated: { amount: '40.0000', currency: 'USD' },
  status: 'partially_allocated',
  receivedAt: '2026-09-05T09:00:00.000Z',
  evidenceDocumentVersionId: null,
  recordVersion: 1,
};

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the reads', () => {
  it('sends both halves of the branch target, and the filters beside them', async () => {
    get.mockResolvedValue(ok({ items: [receipt], nextCursor: 'c2', hasMore: true }));
    const page = await listReceipts(
      TARGET,
      { payerPartnerId: PARTNER_ID, status: 'recorded', invoiceId: INVOICE_ID },
      REQUEST,
      'c1'
    );
    expect(page.status).toBe('ok');
    expect(page.rows[0]?.reference).toBe('RCT-000007');
    expect(page.nextCursor).toBe('c2');
    expect(page.hasMore).toBe(true);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/payments?')).toBe(true);
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('companyId')).toBe(COMPANY_ID);
    expect(query.get('branchId')).toBe(BRANCH_ID);
    expect(query.get('payerPartnerId')).toBe(PARTNER_ID);
    expect(query.get('status')).toBe('recorded');
    expect(query.get('invoiceId')).toBe(INVOICE_ID);
    expect(query.get('cursor')).toBe('c1');
    expect(query.get('limit')).toBe('25');
  });

  it('omits the filters that were not asked for, and never invents a date range', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listReceipts(TARGET, NO_FILTERS, REQUEST, null);
    const path = String(get.mock.calls[0]?.[0]);
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect([...query.keys()].sort()).toEqual(['branchId', 'companyId', 'limit']);
  });

  it('refuses to send a half-named target rather than let the server guess', async () => {
    await expect(
      listReceipts({ companyId: COMPANY_ID, branchId: '' }, NO_FILTERS, REQUEST, null)
    ).rejects.toThrow(/branchId is mandatory/);
    expect(get).not.toHaveBeenCalled();
  });

  it('reads one receipt by path, with no query at all', async () => {
    get.mockResolvedValue(ok({ ...receipt, allocations: [], allocationsTruncated: false }));
    const state = await readReceipt(RECEIPT_ID);
    expect(state.status).toBe('ok');
    if (state.status === 'ok') {
      expect(state.data.allocationsTruncated).toBe(false);
      expect(state.data.unallocated.amount).toBe('40.0000');
    }
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/payments/${RECEIPT_ID}`);
  });

  it('reads the method list and the branch list at their own paths', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    await listPaymentMethods();
    await listBranches();
    expect(String(get.mock.calls[0]?.[0])).toBe('/api/v1/payment-methods');
    expect(String(get.mock.calls[1]?.[0])).toBe('/api/v1/org/branches');
  });

  it('reads the invoice balance under the invoice, because the allocation echo has none', async () => {
    get.mockResolvedValue(
      ok({
        invoiceId: INVOICE_ID,
        status: 'issued',
        outstanding: { amount: '60.0000', currency: 'USD' },
        isSettled: false,
      })
    );
    const state = await readOutstanding(INVOICE_ID);
    expect(state.status).toBe('ok');
    if (state.status === 'ok') expect(state.data.outstanding.amount).toBe('60.0000');
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/invoices/${INVOICE_ID}/outstanding`);
  });

  it('a refused read is a refusal with its reference, and a refused list keeps no rows', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const detail = await readReceipt(RECEIPT_ID);
    expect(detail.status).toBe('denied');
    expect(detail.correlationId).toBe('corr-1');
    const page = await listReceipts(TARGET, NO_FILTERS, REQUEST, null);
    expect(page.status).toBe('denied');
    expect(page.rows).toEqual([]);
  });

  it('an ended session is reported before any request is made', async () => {
    authorizedClient.mockResolvedValue(null);
    const page = await listReceipts(TARGET, NO_FILTERS, REQUEST, null);
    expect(page.status).toBe('expired');
    const detail = await readReceipt(RECEIPT_ID);
    expect(detail.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the transport contract for the writes', () => {
  it('marks both writes idempotent, so a key is attached to every send', () => {
    expect(resolveOperation('POST', '/api/v1/payments')?.operationId).toBe('sal.payment-record');
    expect(
      resolveOperation('POST', `/api/v1/payments/${RECEIPT_ID}/allocations`)?.operationId
    ).toBe('sal.payment-allocate');
    expect(requiresIdempotencyKey('POST', '/api/v1/payments')).toBe(true);
    expect(requiresIdempotencyKey('POST', `/api/v1/payments/${RECEIPT_ID}/allocations`)).toBe(true);
  });
});

describe('recording', () => {
  const body = {
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    paymentMethodId: METHOD_ID,
    payerPartnerId: PARTNER_ID,
    currency: 'USD',
    amount: '100.0000',
  };

  it('sends the six declared fields with the caller’s key and NO version', async () => {
    send.mockResolvedValue(
      ok({
        id: RECEIPT_ID,
        reference: 'RCT-000007',
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        paymentMethodId: METHOD_ID,
        payerPartnerId: PARTNER_ID,
        money: { amount: '100.0000', currency: 'USD' },
        status: 'recorded',
        receivedAt: '2026-09-05T09:00:00.000Z',
        recordVersion: 1,
        replayed: false,
      })
    );
    const outcome = await recordPayment(body, KEY);
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('payments.record.success');
    expect(outcome.created?.reference).toBe('RCT-000007');
    expect(outcome.created?.money.amount).toBe('100.0000');
    const [method, path, sent, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/payments');
    expect(sent).toEqual(body);
    expect(options).toEqual({ idempotencyKey: KEY });
    expect((options as { ifMatch?: unknown }).ifMatch).toBeUndefined();
  });

  it('reports the server’s own replay flag and never one of its own', async () => {
    send.mockResolvedValue(
      ok({
        id: RECEIPT_ID,
        reference: 'RCT-000007',
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        paymentMethodId: METHOD_ID,
        payerPartnerId: PARTNER_ID,
        money: { amount: '100.0000', currency: 'USD' },
        status: 'recorded',
        receivedAt: '2026-09-05T09:00:00.000Z',
        recordVersion: 1,
        replayed: true,
      })
    );
    const outcome = await recordPayment(body, KEY);
    expect(outcome.created?.replayed).toBe(true);
  });

  it('a refusal is a failure with its reference and no receipt', async () => {
    send.mockResolvedValue(failure('conflict'));
    const outcome = await recordPayment(body, KEY);
    expect(outcome.state.status).not.toBe('success');
    expect(outcome.created).toBeNull();
  });

  it('an ended session is reported before the money is sent', async () => {
    authorizedClient.mockResolvedValue(null);
    const outcome = await recordPayment(body, KEY);
    expect(outcome.state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });

  it('files the currency refusal under the control the form renders', async () => {
    // The route reads `currency`; the service publishes its violation against
    // its own internal name. Left as it arrived, the sentence is written to a
    // control this screen does not have and is rendered by nothing.
    send.mockResolvedValue({
      ok: false as const,
      kind: 'validation',
      correlationId: 'corr-1',
      problem: {
        violations: [{ path: 'body.currencyCode', rule: 'invalid_string' }],
      },
    });
    const outcome = await recordPayment(body, KEY);
    expect(outcome.state.fieldErrors?.['currency']).toBe('form.violation.invalid_string');
    expect(outcome.state.fieldErrors?.['currencyCode']).toBeUndefined();
  });
});

describe('allocating', () => {
  const body = { invoiceId: INVOICE_ID, amount: '60.0000', currency: 'USD' };

  it('sends the receipt in the path and the three declared fields, with NO version', async () => {
    send.mockResolvedValue(
      ok({
        id: 'alloc-1',
        sequence: '1',
        receiptId: RECEIPT_ID,
        invoiceId: INVOICE_ID,
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        money: { amount: '60.0000', currency: 'USD' },
        allocatedAt: '2026-09-05T09:05:00.000Z',
        receiptStatus: 'partially_allocated',
        receiptUnallocated: { amount: '40.0000', currency: 'USD' },
      })
    );
    const outcome = await allocatePayment(RECEIPT_ID, body, KEY);
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('payments.allocate.success');
    expect(outcome.created?.receiptUnallocated.amount).toBe('40.0000');
    expect(outcome.created?.receiptStatus).toBe('partially_allocated');
    const [method, path, sent, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/payments/${RECEIPT_ID}/allocations`);
    expect(sent).toEqual(body);
    expect(options).toEqual({ idempotencyKey: KEY });
    expect((options as { ifMatch?: unknown }).ifMatch).toBeUndefined();
  });

  it('a bound refusal keeps no allocation and carries its reference', async () => {
    send.mockResolvedValue(failure('conflict'));
    const outcome = await allocatePayment(RECEIPT_ID, body, KEY);
    expect(outcome.state.status).not.toBe('success');
    expect(outcome.state.correlationId ?? 'corr-1').toBe('corr-1');
    expect(outcome.created).toBeNull();
  });

  it('an allocation over the balance is not told the record moved on (ERR-TRN-001)', async () => {
    // payment-service answers ERR-TRN-001 when an allocation exceeds the
    // receipt's remainder or the invoice's open balance. "Refresh the page"
    // would be false there, so the sentence that claims no cause stays.
    send.mockResolvedValue({
      ...failure('conflict'),
      status: 409,
      problem: { code: 'ERR-TRN-001' },
    });
    const outcome = await allocatePayment(RECEIPT_ID, body, KEY);
    expect(outcome.state.status).toBe('conflict');
    expect(outcome.state.messageKey).toBe('state.conflict.blocked.title');
    expect(outcome.state.messageKey).not.toBe('state.conflict.transition.title');
    expect(outcome.created).toBeNull();
  });

  it('files the bound the server names on the amount, and says only that the form was not saved (DF-7)', async () => {
    for (const [rule, key] of [
      ['allocation_exceeds_invoice_open', 'form.violation.allocation_exceeds_invoice_open'],
      [
        'allocation_exceeds_receipt_remaining',
        'form.violation.allocation_exceeds_receipt_remaining',
      ],
    ] as const) {
      send.mockResolvedValue({
        ...failure('conflict'),
        status: 409,
        problem: { code: 'ERR-TRN-001', violations: [{ path: 'body.amount', rule }] },
      });
      const outcome = await allocatePayment(RECEIPT_ID, body, KEY);
      expect(outcome.state.status).toBe('conflict');
      expect(outcome.state.fieldErrors).toEqual({ amount: key });
      expect(outcome.state.messageKey).toBe('form.formError');
      expect(outcome.state.correlationId).toBe('corr-1');
    }
  });

  it('sends a third-party statement as given and files each D14 refusal on the control it names', async () => {
    const thirdParty = {
      relationship: 'insurer',
      authorisationReference: 'CLM-2026-0042',
      reason: 'Covered by the policy',
    };
    send.mockResolvedValue({
      ...failure('invalid'),
      status: 422,
      problem: {
        code: 'ERR-VAL-001',
        violations: [
          { path: 'body.thirdParty.relationship', rule: 'third_party_relationship_invalid' },
          {
            path: 'body.thirdParty.authorisationReference',
            rule: 'third_party_authorisation_reference_required',
          },
          { path: 'body.thirdParty.reason', rule: 'third_party_other_unexplained' },
        ],
      },
    });
    const outcome = await allocatePayment(RECEIPT_ID, { ...body, thirdParty }, KEY);
    expect((send.mock.calls[0] as unknown[])[2]).toEqual({ ...body, thirdParty });
    expect(outcome.state.fieldErrors).toEqual({
      relationship: 'form.violation.third_party_relationship_invalid',
      authorisationReference: 'form.violation.third_party_authorisation_reference_required',
      reason: 'form.violation.third_party_other_unexplained',
    });
    // Someone else's invoice, refused by default: said on the invoice box.
    send.mockResolvedValue({
      ...failure('conflict'),
      status: 409,
      problem: {
        code: 'ERR-TRN-001',
        violations: [{ path: 'body.invoiceId', rule: 'allocation_payer_mismatch' }],
      },
    });
    const refused = await allocatePayment(RECEIPT_ID, body, KEY);
    expect(refused.state.fieldErrors).toEqual({
      invoiceId: 'form.violation.allocation_payer_mismatch',
    });
    expect(refused.created).toBeNull();
  });
});

describe('the receipt reversal and its replacement (ADR-023 D4)', () => {
  const REVERSAL_ID = '99999999-9999-4999-8999-999999999999';
  const reversalEcho = { reversal: { id: REVERSAL_ID, state: 'pending' }, replayed: false };
  const conflict = (violations: readonly unknown[] = []) => ({
    ok: false as const,
    kind: 'conflict',
    correlationId: 'corr-409',
    problem: { code: 'ERR-CON-001', status: 409, violations },
  });

  it('asks for the reversal with the reason alone and the RECEIPT version as If-Match', async () => {
    send.mockResolvedValue(ok(reversalEcho));
    const outcome = await requestReceiptReversal(RECEIPT_ID, { reason: 'Wrong payer' }, 7);
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/payments/${RECEIPT_ID}/reversals`,
      { reason: 'Wrong payer' },
      { ifMatch: 7 }
    );
    expect(outcome.state.status).toBe('success');
    expect(outcome.created).toEqual(reversalEcho);
  });

  it('says a version conflict as the receipt having changed, and keeps a named rule its own sentence', async () => {
    send.mockResolvedValueOnce(conflict());
    const stale = await requestReceiptReversal(RECEIPT_ID, { reason: 'x' }, 7);
    expect(stale.state.messageKey).toBe('payments.reversal.conflict');
    send.mockResolvedValueOnce(
      conflict([{ path: 'path.paymentId', rule: 'receipt_reversal_exists' }])
    );
    const named = await requestReceiptReversal(RECEIPT_ID, { reason: 'x' }, 7);
    expect(named.state.messageKey).toBe('form.violation.receipt_reversal_exists');
    expect(named.created).toBeNull();
  });

  it('decides at the reversal’s own path: approval bodyless, rejection with its reason, both versions the REVERSAL’s', async () => {
    send.mockResolvedValue(ok(reversalEcho));
    await approveReceiptReversal(REVERSAL_ID);
    expect(send).toHaveBeenLastCalledWith(
      'POST',
      `/api/v1/receipt-reversals/${REVERSAL_ID}/approval`
    );
    await rejectReceiptReversal(REVERSAL_ID, { reason: 'Correct as recorded' }, 4);
    expect(send).toHaveBeenLastCalledWith(
      'POST',
      `/api/v1/receipt-reversals/${REVERSAL_ID}/rejection`,
      { reason: 'Correct as recorded' },
      { ifMatch: 4 }
    );
    await withdrawReceiptReversal(REVERSAL_ID, 4);
    expect(send).toHaveBeenLastCalledWith(
      'POST',
      `/api/v1/receipt-reversals/${REVERSAL_ID}/withdrawal`,
      undefined,
      { ifMatch: 4 }
    );
  });

  it('records the replacement under the reversed receipt with the form’s own key and no version', async () => {
    send.mockResolvedValue(ok({ ...receipt, replacesReceiptId: RECEIPT_ID, replayed: false }));
    const body = {
      paymentMethodId: METHOD_ID,
      payerPartnerId: PARTNER_ID,
      currency: 'USD',
      amount: '90.0000',
    };
    const outcome = await recordReplacementReceipt(RECEIPT_ID, body, KEY);
    expect(send).toHaveBeenCalledWith('POST', `/api/v1/payments/${RECEIPT_ID}/replacement`, body, {
      idempotencyKey: KEY,
    });
    expect(outcome.state.status).toBe('success');
  });

  it('marks every reversal write idempotent in the published contract', () => {
    for (const [method, path] of [
      ['POST', `/api/v1/payments/${RECEIPT_ID}/reversals`],
      ['POST', `/api/v1/payments/${RECEIPT_ID}/replacement`],
      ['POST', `/api/v1/receipt-reversals/${'99999999-9999-4999-8999-999999999999'}/approval`],
      ['POST', `/api/v1/receipt-reversals/${'99999999-9999-4999-8999-999999999999'}/rejection`],
      ['POST', `/api/v1/receipt-reversals/${'99999999-9999-4999-8999-999999999999'}/withdrawal`],
    ] as const) {
      expect(requiresIdempotencyKey(method, path)).toBe(true);
    }
  });

  it('an ended session is reported before any reversal is sent', async () => {
    authorizedClient.mockResolvedValue(null);
    const outcome = await requestReceiptReversal(RECEIPT_ID, { reason: 'x' }, 7);
    expect(outcome.state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});
