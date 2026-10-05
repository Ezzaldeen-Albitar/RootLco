/**
 * P1-32-PRE-OD-FD5 — invoice approved quantities only, tracked across superseding
 * revisions (ADR-023 D5/D15), without a database.
 *
 * Held here:
 *
 *  - The vocabularies the application and its migration share are the SAME set,
 *    read from the migration rather than restated: every billing status
 *    `sal.billable_quotation_lines` can answer is in `BILLING_STATUSES` and the
 *    other way round, and every refusal token the three guards raise is in
 *    `INVOICE_SOURCE_REFUSALS` and the other way round. A status or a token added
 *    on one side only fails here.
 *  - `invoiceSourceRefusalOf` reads exactly the leading token of a guard's message.
 *  - `resolveCommercialSource` takes a revision with at least one approved line —
 *    a partly approved or partly refused one included — and refuses none or two.
 *    Only a quotation with something left to bill competes, so one whose approved
 *    lines are all invoiced does not block another's approved work.
 *  - `billableLines` bills only `billable` lines, at what remains of each, and
 *    refuses one whose remaining amounts were withheld rather than billing zero.
 *  - `openReceivableForWorkOrder` judges EVERY live invoice and answers the most
 *    blocking, and approved work no invoice holds keeps a paid work order
 *    outstanding.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BILLING_STATUSES,
  INVOICE_SOURCE_REFUSALS,
  invoiceSourceRefusalOf,
} from '@api/modules/billing/domain/billing';
import type {
  CommercialSourceLineRow,
  CommercialSourceRow,
  InvoiceRow,
} from '@api/modules/billing/data/billing-repository';

const { BillingReadService, billableLines, resolveCommercialSource } =
  await import('@api/modules/billing/application/billing-read-service');

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    'supabase',
    'migrations',
    '20261006090000_sal_invoiced_quotation_quantities.sql'
  ),
  'utf8'
);

/** The body of one `CREATE OR REPLACE FUNCTION <name>(…) … $$ … $$;` in the migration. */
function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not in the migration`);
  const open = MIGRATION.indexOf('$$', start);
  const close = MIGRATION.indexOf('$$', open + 2);
  if (open < 0 || close < 0) throw new Error(`${name} has no $$ body`);
  return MIGRATION.slice(open + 2, close);
}

describe('the vocabularies shared with the migration', () => {
  it('BILLING_STATUSES is exactly what sal.billable_quotation_lines can answer', () => {
    const body = functionBody('sal.billable_quotation_lines');
    const caseStart = body.indexOf('WHEN NOT m.is_source');
    const caseEnd = body.indexOf('END AS status', caseStart);
    expect(caseStart).toBeGreaterThan(0);
    expect(caseEnd).toBeGreaterThan(caseStart);
    const answers = [...body.slice(caseStart, caseEnd).matchAll(/(?:THEN|ELSE) '([a-z_]+)'/g)].map(
      (match) => match[1]
    );
    expect([...answers].sort()).toEqual([...BILLING_STATUSES].sort());
  });

  it('INVOICE_SOURCE_REFUSALS is exactly what the three guards raise', () => {
    const raised = new Set<string>();
    for (const guard of [
      'sal.guard_invoice_work_order_source',
      'sal.guard_invoice_line_source',
      'sal.guard_invoice_line_amount_source',
    ]) {
      for (const match of functionBody(guard).matchAll(/RAISE EXCEPTION '([a-z_]+):/g)) {
        raised.add(match[1] as string);
      }
    }
    expect([...raised].sort()).toEqual([...INVOICE_SOURCE_REFUSALS].sort());
  });
});

describe('invoiceSourceRefusalOf', () => {
  it('reads a known leading token, and nothing else', () => {
    expect(
      invoiceSourceRefusalOf(
        'invoice_quantity_exceeds_approved: quotation line x has 1.000 approved and not yet invoiced, not 2.000'
      )
    ).toBe('invoice_quantity_exceeds_approved');
    expect(invoiceSourceRefusalOf('invoice_line_not_billable: quotation line x is rejected')).toBe(
      'invoice_line_not_billable'
    );
    expect(invoiceSourceRefusalOf('part_line_tax: something else')).toBeNull();
    expect(invoiceSourceRefusalOf('a message naming invoice_line_not_billable: later')).toBeNull();
    expect(invoiceSourceRefusalOf(undefined)).toBeNull();
  });
});

function candidate(over: Partial<CommercialSourceRow> = {}): CommercialSourceRow {
  return {
    quotationId: 'q1',
    revisionId: 'r1',
    companyId: 'c',
    branchId: 'b',
    currencyCode: 'USD',
    payerPartnerRef: null,
    itemCount: 2,
    approvedCount: 2,
    rejectedCount: 0,
    billableCount: 2,
    subtotal: '0.0000',
    discountTotal: '0.0000',
    taxTotal: '0.0000',
    netTotal: '0.0000',
    grossTotal: '0.0000',
    revisionSubtotal: '0.0000',
    revisionDiscountTotal: '0.0000',
    revisionTaxTotal: '0.0000',
    revisionNetTotal: '0.0000',
    revisionGrossTotal: '0.0000',
    ...over,
  };
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe('resolveCommercialSource — a revision with an approved line', () => {
  it('takes a partly approved revision, and one whose refused line rejected it', () => {
    const partly = candidate({ approvedCount: 1, rejectedCount: 0 });
    expect(resolveCommercialSource([partly], 'wo')).toBe(partly);
    const refusedOne = candidate({ approvedCount: 1, rejectedCount: 1 });
    expect(resolveCommercialSource([refusedOne], 'wo')).toBe(refusedOne);
  });

  it('refuses a work order with no approved line as a missing source, and two as a conflict', () => {
    expect(
      codeOf(() =>
        resolveCommercialSource([candidate({ approvedCount: 0, rejectedCount: 2 })], 'wo')
      )
    ).toBe('ERR-RES-001');
    expect(codeOf(() => resolveCommercialSource([], 'wo'))).toBe('ERR-RES-001');
    expect(
      codeOf(() =>
        resolveCommercialSource(
          [candidate(), candidate({ quotationId: 'q2', revisionId: 'r2' })],
          'wo'
        )
      )
    ).toBe('ERR-CON-001');
  });

  it('lets only a quotation with something left to bill compete', () => {
    // Q1's approved lines are all invoiced; Q2 has an approved line still to bill.
    const spent = candidate({ billableCount: 0 });
    const pending = candidate({
      quotationId: 'q2',
      revisionId: 'r2',
      approvedCount: 1,
      billableCount: 1,
    });
    expect(resolveCommercialSource([spent, pending], 'wo')).toBe(pending);
    // Nothing left to bill anywhere: one approved source still answers (as
    // "nothing to bill"), two still conflict.
    expect(resolveCommercialSource([spent], 'wo')).toBe(spent);
    expect(
      codeOf(() =>
        resolveCommercialSource(
          [spent, candidate({ quotationId: 'q2', revisionId: 'r2', billableCount: 0 })],
          'wo'
        )
      )
    ).toBe('ERR-CON-001');
  });

  it('refuses a wholly accepted quotation beside a partly approved one, both with work to bill (Owner open point)', () => {
    // Base billed the wholly accepted one and ignored the other; D5 makes both
    // sources of approved work, and choosing between them is left to the Owner.
    const accepted = candidate();
    const partly = candidate({
      quotationId: 'q2',
      revisionId: 'r2',
      approvedCount: 1,
      rejectedCount: 1,
      billableCount: 1,
    });
    expect(codeOf(() => resolveCommercialSource([accepted, partly], 'wo'))).toBe('ERR-CON-001');
  });
});

function sourceLine(over: Partial<CommercialSourceLineRow> = {}): CommercialSourceLineRow {
  return {
    quotationItemId: 'i1',
    lineNumber: 1,
    itemKind: 'service',
    serviceId: 's1',
    itemRef: null,
    description: null,
    quotedPart: null,
    currencyCode: 'USD',
    unitPrice: '50.0000',
    quantity: '3.000',
    discount: '0.0000',
    taxRate: '0.100000',
    netAmount: '150.0000',
    taxAmount: '15.0000',
    grossAmount: '165.0000',
    decision: 'approved',
    billingStatus: 'billable',
    approvedQuantity: '3.000',
    invoicedQuantity: '2.000',
    remainingQuantity: '1.000',
    carried: true,
    remainingNet: '50.0000',
    remainingTax: '5.0000',
    remainingGross: '55.0000',
    remainingDiscount: '0.0000',
    ...over,
  };
}

describe('billableLines — what a new invoice bills', () => {
  it('keeps only billable lines, each at what remains of it', () => {
    const billed = billableLines([
      sourceLine(),
      sourceLine({ quotationItemId: 'i2', billingStatus: 'not_approved', remainingNet: null }),
      sourceLine({ quotationItemId: 'i3', billingStatus: 'rejected', remainingNet: null }),
      sourceLine({ quotationItemId: 'i4', billingStatus: 'fully_invoiced', remainingNet: null }),
    ]);
    expect(billed.map(({ line }) => line.quotationItemId)).toEqual(['i1']);
    expect(billed[0]?.money).toEqual({
      net: '50.0000',
      tax: '5.0000',
      gross: '55.0000',
      discount: '0.0000',
    });
  });

  it('refuses a billable line whose remaining amounts were withheld, and an unknown status', () => {
    expect(codeOf(() => billableLines([sourceLine({ remainingNet: null })]))).toBe('ERR-IAM-001');
    expect(codeOf(() => billableLines([sourceLine({ billingStatus: 'maybe' })]))).toBe(
      'ERR-SYS-001'
    );
  });
});

// ---------------------------------------------------------------------------
// The delivery port
// ---------------------------------------------------------------------------

function invoice(over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'inv-1',
    companyId: 'c',
    branchId: 'b',
    workOrderId: 'wo',
    saleKind: 'work_order',
    quotationRevisionId: 'r1',
    payerPartnerId: 'p',
    currencyCode: 'USD',
    status: 'issued',
    invoiceNumber: 'INV-1',
    issuedAt: new Date('2026-10-01T08:00:00Z'),
    idempotencyKey: null,
    recordVersion: 2,
    money: { netTotal: '100.0000', taxTotal: '0.0000', grossTotal: '100.0000' },
    ...over,
  };
}

function port(options: {
  readonly invoices: readonly InvoiceRow[];
  readonly open: Readonly<Record<string, string>>;
  readonly unbilled: boolean;
}) {
  const repository = {
    findWorkOrderScope: vi.fn(async () => ({
      workOrderId: 'wo',
      companyId: 'c',
      branchId: 'b',
      state: 'open',
      receptionVisitId: 'v',
      openedAt: new Date(),
    })),
    liveInvoicesForWorkOrder: vi.fn(async () => options.invoices),
    hasApprovedWorkToInvoice: vi.fn(async () => options.unbilled),
    openReceivable: vi.fn(async (_db: unknown, where: { invoiceId: string }) => ({
      invoiceId: where.invoiceId,
      amount: options.open[where.invoiceId] ?? '0.0000',
      currencyCode: 'USD',
      status: 'issued',
      asOf: new Date(),
    })),
  };
  const service = new BillingReadService(repository as never);
  return { read: () => service.openReceivableForWorkOrder({} as never, 'wo'), repository };
}

describe('openReceivableForWorkOrder — every live invoice, the most blocking answer', () => {
  it('no live invoice is null, as before', async () => {
    expect(await port({ invoices: [], open: {}, unbilled: true }).read()).toBeNull();
  });

  it('a paid invoice beside an unpaid one is outstanding, naming the unpaid one', async () => {
    const { read, repository } = port({
      invoices: [invoice({ id: 'paid' }), invoice({ id: 'unpaid' })],
      open: { unpaid: '40.0000' },
      unbilled: false,
    });
    const answer = await read();
    expect(answer).toMatchObject({ invoiceId: 'unpaid', hasOutstanding: true, amount: '40.0000' });
    // Both were judged; the gate does not stop at the first.
    expect(repository.openReceivable).toHaveBeenCalledTimes(2);
    expect(repository.liveInvoicesForWorkOrder).toHaveBeenCalledWith(expect.anything(), {
      workOrderId: 'wo',
      companyId: 'c',
      branchId: 'b',
    });
  });

  it('a draft beside paid invoices is not collectable', async () => {
    const answer = await port({
      invoices: [invoice({ id: 'draft', status: 'draft', invoiceNumber: null }), invoice()],
      open: {},
      unbilled: false,
    }).read();
    expect(answer).toMatchObject({ invoiceId: 'draft', collectable: false, hasOutstanding: true });
  });

  it('every invoice paid, but approved work still unbilled: outstanding, and says why', async () => {
    const answer = await port({ invoices: [invoice()], open: {}, unbilled: true }).read();
    expect(answer).toMatchObject({
      invoiceId: 'inv-1',
      amount: '0.0000',
      hasOutstanding: true,
      unbilledApprovedWork: true,
    });
  });

  it('every invoice paid and nothing approved left unbilled: settled', async () => {
    const answer = await port({ invoices: [invoice()], open: {}, unbilled: false }).read();
    expect(answer).toMatchObject({ hasOutstanding: false, unbilledApprovedWork: false });
  });
});
