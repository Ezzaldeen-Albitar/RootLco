import { describe, expect, it, vi } from 'vitest';

/**
 * The receipt list names its payer (Owner directive, the sales and finance
 * Material UI slice; browser QA row 5.6b).
 *
 * `sal.receipt-list` used to publish `payerPartnerId` and nothing else, so the
 * payments screen printed the payer as a 36-character reference. Each row now
 * carries a payer block beside the id, read from the live partner row, and the
 * block is filled ONLY for a caller holding `crm.customer.read` — the question
 * the invoice list already asks, answered the same way. So the code that reaches
 * money (`sal.finance.view`) never becomes a way to read customer names.
 *
 * The repository is a stand-in and the permission question is answered by a
 * stand-in database, so what is observed is exactly what the read asks and what
 * it hands back. The scope is authorized before any row is read.
 */

const { PaymentReadService } =
  await import('@api/modules/payments/application/payment-read-service');
const { moneyView } = await import('@api/modules/pricing');
const { toInvoiceView } = await import('@api/modules/billing/application/billing-read-service');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const PAYER = '33333333-3333-4333-8333-333333333333';
const METHOD = '44444444-4444-4444-8444-444444444444';

function receiptRow(over: Record<string, unknown> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    companyId: COMPANY,
    branchId: BRANCH,
    receiptNumber: '000001',
    paymentMethodId: METHOD,
    payerPartnerId: PAYER,
    currencyCode: 'JOD',
    amount: '35.0000',
    receivedAt: new Date('2026-09-24T18:38:00Z'),
    evidenceDocumentVersionId: null,
    status: 'recorded',
    idempotencyKey: null,
    deletedAt: null,
    recordVersion: 1,
    unallocated: '35.0000',
    payerDisplayName: 'Layla Haddad',
    payerDisplayNumber: '000006',
    payerPartyType: 'individual',
    ...over,
  };
}

function harness(options: { readonly mayReadCustomers: boolean; readonly rows?: unknown[] }) {
  const order: string[] = [];
  const repository = {
    listReceipts: vi.fn(async () => {
      order.push('read');
      return {
        items: options.rows ?? [receiptRow()],
        nextCursor: null,
        hasMore: false,
      };
    }),
    listPaymentMethods: vi.fn(async () => [
      {
        id: METHOD,
        scope: 'tenant',
        tenantId: 't',
        methodCode: 'cash',
        kind: 'cash',
        displayName: 'Cash',
        status: 'active',
        deletedAt: null,
        recordVersion: 1,
      },
    ]),
    // The platform register: JOD is written with three decimals.
    minorUnitsFor: vi.fn(async (_db: unknown, codes: readonly string[]) => {
      order.push('units');
      return new Map(codes.filter((code) => code === 'JOD').map((code) => [code, 3]));
    }),
  };
  const asked: unknown[][] = [];
  const db = {
    query: vi.fn(async (sql: string, values: unknown[]) => {
      asked.push([sql, values]);
      return { rows: [{ allowed: options.mayReadCustomers }] };
    }),
  };
  const authorizeScope = vi.fn(async () => {
    order.push('authorize');
  });
  const service = new PaymentReadService(repository as never);
  const list = () =>
    service.listReceipts(
      db as never,
      { companyId: COMPANY, branchId: BRANCH },
      {},
      authorizeScope as never
    );
  return { list, repository, asked, order, authorizeScope };
}

describe('sal.receipt-list names the payer beside the id', () => {
  it('for a caller who may read customers, carries the payer name, number and party type', async () => {
    const { list } = harness({ mayReadCustomers: true });
    const page = await list();
    expect(page.items).toHaveLength(1);
    const [row] = page.items;
    expect(row?.payerPartnerId).toBe(PAYER);
    expect(row?.payer).toEqual({
      displayName: 'Layla Haddad',
      displayNumber: '000006',
      partyType: 'individual',
    });
  });

  it('for a caller without the customer read, withholds every field and keeps the block and the id', async () => {
    const { list } = harness({ mayReadCustomers: false });
    const page = await list();
    const [row] = page.items;
    expect(row?.payerPartnerId).toBe(PAYER);
    expect(row?.payer).toEqual({ displayName: null, displayNumber: null, partyType: null });
  });

  it('asks the scope-blind customer question once per page, with the customer code', async () => {
    const { list, asked } = harness({
      mayReadCustomers: true,
      rows: [receiptRow(), receiptRow({ id: '66666666-6666-4666-8666-666666666666' })],
    });
    await list();
    expect(asked).toHaveLength(1);
    expect(String(asked[0]?.[0])).toContain('iam.has_permission');
    expect(asked[0]?.[1]).toEqual(['crm.customer.read']);
  });

  it('a payer that is no live partner is not named, even for a caller who may read customers', async () => {
    const { list } = harness({
      mayReadCustomers: true,
      rows: [
        receiptRow({ payerDisplayName: null, payerDisplayNumber: null, payerPartyType: null }),
      ],
    });
    const [row] = (await list()).items;
    expect(row?.payer).toEqual({ displayName: null, displayNumber: null, partyType: null });
  });

  it('authorizes the branch before any row is read, and money stays the exact string', async () => {
    const { list, order, authorizeScope } = harness({ mayReadCustomers: true });
    const [row] = (await list()).items;
    expect(authorizeScope).toHaveBeenCalledWith({ companyId: COMPANY, branchId: BRANCH });
    expect(order).toEqual(['authorize', 'read', 'units']);
    // Each amount carries the minor unit the platform records for its currency.
    expect(row?.money).toEqual({ amount: '35.0000', currency: 'JOD', minorUnit: 3 });
    expect(row?.unallocated).toEqual({ amount: '35.0000', currency: 'JOD', minorUnit: 3 });
  });
});

/**
 * Finance retest fixes C (`P1-32-PRE-OD-FQC`).
 *
 * DF-R2-2: the receipt's "applied to" list printed a raw reference, because
 * `sal.receipt-detail` published each allocation's invoice id and nothing else.
 * Each allocation now carries the invoice's number, and the customer it bills
 * only for a caller holding `crm.customer.read` — the question the receipt list
 * asks, answered the same way.
 *
 * D1: every amount a read publishes carries its currency's minor unit, looked up
 * in `shared.currencies`, so the browser does not fall back on locale data that
 * disagrees with the platform's register.
 */
describe('sal.receipt-detail names each allocation by invoice number (DF-R2-2)', () => {
  const RECEIPT = '55555555-5555-4555-8555-555555555555';
  const INVOICE = '77777777-7777-4777-8777-777777777777';

  function detailHarness(options: {
    readonly mayReadCustomers: boolean;
    readonly allocations?: readonly Record<string, unknown>[];
  }) {
    const order: string[] = [];
    const allocation = (over: Record<string, unknown> = {}) => ({
      id: '88888888-8888-4888-8888-888888888888',
      seq: '1',
      companyId: COMPANY,
      branchId: BRANCH,
      receiptId: RECEIPT,
      invoiceId: INVOICE,
      currencyCode: 'JOD',
      amount: '12.5000',
      allocatedAt: new Date('2026-10-02T03:58:37Z'),
      correlationId: null,
      invoiceNumber: '000010',
      invoicePayerDisplayName: 'Layla Haddad',
      ...over,
    });
    const repository = {
      findReceipt: vi.fn(async () => {
        order.push('find');
        return receiptRow({ id: RECEIPT });
      }),
      receiptUnallocated: vi.fn(async () => ({
        receiptId: RECEIPT,
        unallocated: '22.5000',
        currencyCode: 'JOD',
        status: 'partially_allocated',
      })),
      listAllocations: vi.fn(async () => {
        order.push('allocations');
        return options.allocations ?? [allocation()];
      }),
      findPaymentMethod: vi.fn(async () => null),
      minorUnitsFor: vi.fn(
        async (_db: unknown, codes: readonly string[]) =>
          new Map(codes.filter((code) => code === 'JOD').map((code) => [code, 3]))
      ),
    };
    const asked: unknown[][] = [];
    const db = {
      query: vi.fn(async (sql: string, values: unknown[]) => {
        asked.push([sql, values]);
        return { rows: [{ allowed: options.mayReadCustomers }] };
      }),
    };
    const authorizeScope = vi.fn(async () => {
      order.push('authorize');
    });
    const service = new PaymentReadService(repository as never);
    const read = () => service.readReceipt(db as never, RECEIPT, authorizeScope as never);
    return { read, order, asked, authorizeScope, allocation, repository };
  }

  it('carries the invoice number and, for a caller who may read customers, the customer it bills', async () => {
    const { read } = detailHarness({ mayReadCustomers: true });
    const [entry] = (await read()).allocations;
    expect(entry?.invoiceId).toBe(INVOICE);
    expect(entry?.invoiceNumber).toBe('000010');
    expect(entry?.invoicePayerName).toBe('Layla Haddad');
  });

  it('withholds the customer name without the customer read, and keeps the number', async () => {
    const { read, asked } = detailHarness({ mayReadCustomers: false });
    const [entry] = (await read()).allocations;
    expect(entry?.invoiceNumber).toBe('000010');
    expect(entry?.invoicePayerName).toBeNull();
    expect(asked).toHaveLength(1);
    expect(String(asked[0]?.[0])).toContain('iam.has_permission');
    expect(asked[0]?.[1]).toEqual(['crm.customer.read']);
  });

  it('asks nothing about customers for a receipt applied to nothing', async () => {
    const { read, asked } = detailHarness({ mayReadCustomers: true, allocations: [] });
    expect((await read()).allocations).toEqual([]);
    expect(asked).toHaveLength(0);
  });

  it('says plainly when the invoice is not visible: no number, no name', async () => {
    const { read, allocation } = detailHarness({ mayReadCustomers: true });
    const { read: readHidden } = detailHarness({
      mayReadCustomers: true,
      allocations: [allocation({ invoiceNumber: null, invoicePayerDisplayName: null })],
    });
    expect((await read()).allocations[0]?.invoiceNumber).toBe('000010');
    const [hidden] = (await readHidden()).allocations;
    expect(hidden?.invoiceNumber).toBeNull();
    expect(hidden?.invoicePayerName).toBeNull();
  });

  it('authorizes the receipt scope before reading its allocations, and stamps every amount with the minor unit', async () => {
    const { read, order } = detailHarness({ mayReadCustomers: true });
    const receipt = await read();
    expect(order.slice(0, 3)).toEqual(['find', 'authorize', 'allocations']);
    expect(receipt.money).toEqual({ amount: '35.0000', currency: 'JOD', minorUnit: 3 });
    expect(receipt.unallocated).toEqual({ amount: '22.5000', currency: 'JOD', minorUnit: 3 });
    expect(receipt.allocations[0]?.money).toEqual({
      amount: '12.5000',
      currency: 'JOD',
      minorUnit: 3,
    });
  });
});

describe('every published amount carries the minor unit of its currency (D1)', () => {
  it('moneyView stamps the minor unit it was given, and stays the exact string', () => {
    const units = new Map([
      ['IQD', 3],
      ['JOD', 3],
    ]);
    expect(moneyView('12.5000', 'IQD', units)).toEqual({
      amount: '12.5000',
      currency: 'IQD',
      minorUnit: 3,
    });
    // A currency the register does not hold is published unstamped, never guessed.
    expect(moneyView('12.5000', 'USD', units)).toEqual({ amount: '12.5000', currency: 'USD' });
    expect(moneyView('12.5000', 'USD')).toEqual({ amount: '12.5000', currency: 'USD' });
  });

  it('the invoice mapper stamps each total with the invoice currency minor unit', () => {
    const view = toInvoiceView(
      {
        id: '0f000000-0000-4000-8000-00000000c001',
        companyId: COMPANY,
        branchId: BRANCH,
        workOrderId: null,
        saleKind: 'counter_sale',
        quotationRevisionId: null,
        payerPartnerId: PAYER,
        currencyCode: 'IQD',
        status: 'issued',
        invoiceNumber: '000011',
        issuedAt: new Date('2026-10-02T03:37:31Z'),
        idempotencyKey: null,
        recordVersion: 2,
        money: { netTotal: '12.3460', taxTotal: '0.0000', grossTotal: '12.3460' },
      } as never,
      new Map([['IQD', 3]])
    );
    expect(view.totals?.gross).toEqual({ amount: '12.3460', currency: 'IQD', minorUnit: 3 });
    expect(view.totals?.net).toEqual({ amount: '12.3460', currency: 'IQD', minorUnit: 3 });
  });
});
