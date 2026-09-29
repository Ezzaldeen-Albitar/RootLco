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
    expect(order).toEqual(['authorize', 'read']);
    expect(row?.money).toEqual({ amount: '35.0000', currency: 'JOD' });
    expect(row?.unallocated).toEqual({ amount: '35.0000', currency: 'JOD' });
  });
});
