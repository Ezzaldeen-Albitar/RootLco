import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { formatMoney } from '../src/lib/money';
import { inBranch, renderLtr as renderLtrBare, renderRtl as renderRtlBare } from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';

/**
 * P1-32-PRE-OD-FD5 — the work-order invoice screen bills approved quantities only
 * (ADR-023 D5 and D15).
 *
 * The properties under test, each failing when the screen stops doing it:
 *
 *  - every line the invoice would bill shows what was approved, what live
 *    invoices already hold and what this invoice bills; a line part of which an
 *    earlier revision billed says so;
 *  - every line left off is listed with WHY, in words — not approved yet,
 *    refused, already invoiced — in English and in Arabic, right to left;
 *  - when nothing approved remains, the screen says so and offers no create form
 *    and no zero figure;
 *  - a work order with several live invoices lists them by number and opens the
 *    one chosen; while approved work remains and no draft is open, what remains is
 *    previewed and offered beneath them, and an open draft withholds that offer;
 *  - the printed copy of an invoice that billed PART of its revision states no
 *    revision subtotal or discount it did not bill, and still describes its lines;
 *  - the printed copy is described from the invoice's OWN source lines: an earlier
 *    quotation's invoice keeps its descriptions, line discount and revision totals
 *    after a later quotation of the work order is billed — while the work order's
 *    preview names the later revision, and once two fully invoiced quotations make
 *    that preview a conflict.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
const money = (amount: string, currency = 'USD') => formatMoney({ amount, currency }, 'en');

const readWorkOrderInvoice = vi.fn();
const readInvoicePreview = vi.fn();
const readInvoice = vi.fn();
const readOutstanding = vi.fn();
const createInvoice = vi.fn();
const listInvoices = vi.fn();
vi.mock('@/features/billing/api', () => ({
  readWorkOrderInvoice: (...args: unknown[]) => readWorkOrderInvoice(...args),
  readInvoicePreview: (...args: unknown[]) => readInvoicePreview(...args),
  readInvoice: (...args: unknown[]) => readInvoice(...args),
  readOutstanding: (...args: unknown[]) => readOutstanding(...args),
  createInvoice: (...args: unknown[]) => createInvoice(...args),
  issueInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  listInvoices: (...args: unknown[]) => listInvoices(...args),
}));
vi.mock('@/features/billing/outstanding-read', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readOutstandingCancellable: (invoiceId: string) => readOutstanding(invoiceId),
}));
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: vi.fn(),
}));
vi.mock('@/features/work-orders/api', () => ({ readWorkOrderDetail: vi.fn() }));
vi.mock('@/features/work-orders/work-order-list-read', () => ({
  listWorkOrdersCancellable: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: vi.fn(() => true),
}));

const { InvoiceScreen } = await import('@/features/billing/components/InvoiceScreen');
const { InvoiceDocument } = await import('@/features/billing/components/InvoiceDocument');

function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderLtrBare(withMui(inBranch(ui), 'en'));
const renderRtl = (ui: ReactElement) =>
  renderRtlBare(withMui(inBranch(ui, { locale: 'ar' }), 'ar'));

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const SERVICE_ITEM = '66666666-6666-4666-8666-666666666661';
const PART_ITEM = '66666666-6666-4666-8666-666666666662';
const FIRST_INVOICE = '99999999-9999-4999-8999-999999999991';
const SECOND_INVOICE = '99999999-9999-4999-8999-999999999992';

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

function invoice(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    companyId: 'c',
    branchId: 'b',
    workOrderId: WORK_ORDER_ID,
    saleKind: 'work_order',
    quotationRevisionId: REVISION_ID,
    payerPartnerId: 'p',
    currency: 'USD',
    status: 'issued',
    invoiceNumber: id === FIRST_INVOICE ? 'INV-000101' : 'INV-000102',
    issuedAt: '2026-10-01T08:00:00Z',
    recordVersion: 3,
    totals: {
      net: { amount: '50.0000', currency: 'USD' },
      tax: { amount: '5.0000', currency: 'USD' },
      gross: { amount: '55.0000', currency: 'USD' },
    },
    ...over,
  };
}

function revisionLine(over: Record<string, unknown>) {
  return {
    sourceQuotationItemId: SERVICE_ITEM,
    lineNumber: 1,
    lineType: 'service',
    description: 'Wheel alignment',
    item: null,
    unit: null,
    decision: 'approved',
    quotedQuantity: '1.000',
    approvedQuantity: '1.000',
    invoicedQuantity: '0.000',
    remainingQuantity: '1.000',
    billingStatus: 'billable',
    unitPrice: '50.0000',
    discount: '0.0000',
    taxRate: '0.100000',
    netAmount: '50.0000',
    taxAmount: '5.0000',
    grossAmount: '55.0000',
    ...over,
  };
}

const PART_LINE = revisionLine({
  sourceQuotationItemId: PART_ITEM,
  lineNumber: 2,
  lineType: 'part',
  description: null,
  item: { id: 'part-1', code: 'FLT-07', name: 'Oil filter' },
  unit: { code: 'each', name: 'Each' },
  decision: null,
  quotedQuantity: '3.000',
  approvedQuantity: '0.000',
  remainingQuantity: '0.000',
  billingStatus: 'not_approved',
  unitPrice: '12.3450',
  taxRate: '0.000000',
  netAmount: '37.0350',
  taxAmount: '0.0000',
  grossAmount: '37.0350',
});

/** A preview billing the approved service line; the part line is undecided. */
function partlyApproved(over: Record<string, unknown> = {}) {
  return {
    workOrderId: WORK_ORDER_ID,
    quotationId: 'q-1',
    quotationRevisionId: REVISION_ID,
    currency: 'USD',
    subtotal: '50.0000',
    discountTotal: '0.0000',
    taxTotal: '5.0000',
    netTotal: '50.0000',
    grossTotal: '55.0000',
    lines: [
      {
        sourceQuotationItemId: SERVICE_ITEM,
        lineNumber: 1,
        lineType: 'service',
        description: 'Wheel alignment',
        serviceId: 's',
        itemId: null,
        item: null,
        unit: null,
        quantity: '1.000',
        unitPrice: '50.0000',
        discount: '0.0000',
        taxRate: '0.100000',
        netAmount: '50.0000',
        taxAmount: '5.0000',
        grossAmount: '55.0000',
        approvedQuantity: '4.000',
        invoicedQuantity: '3.000',
        partlyInvoicedEarlier: true,
      },
    ],
    revisionLines: [
      revisionLine({
        quotedQuantity: '4.000',
        approvedQuantity: '4.000',
        invoicedQuantity: '3.000',
      }),
      PART_LINE,
    ],
    revisionTotals: {
      subtotal: '237.0350',
      discountTotal: '0.0000',
      taxTotal: '20.0000',
      netTotal: '237.0350',
      grossTotal: '257.0350',
    },
    ...over,
  };
}

function orderRead(
  invoices: readonly ReturnType<typeof invoice>[],
  approvedWorkToInvoice: boolean
) {
  return okRead({
    workOrderId: WORK_ORDER_ID,
    invoice: invoices[0] ?? null,
    invoices,
    invoicesTruncated: false,
    approvedWorkToInvoice,
  });
}

function screenFor(
  initial: ReturnType<typeof orderRead>,
  locale: 'en' | 'ar' = 'en'
): ReactElement {
  return (
    <InvoiceScreen
      locale={locale}
      messages={locale === 'en' ? en : ar}
      workOrderId={WORK_ORDER_ID}
      workOrder={null}
      workOrderRefused={null}
      initialInvoice={initial as never}
      canViewFinance={true}
      canIssue={false}
    />
  );
}

const outstanding = {
  invoiceId: FIRST_INVOICE,
  status: 'issued',
  outstanding: { amount: '0.0000', currency: 'USD' },
  isSettled: true,
  settlement: null,
  asOf: '2026-10-01T09:00:00.000Z',
};

const usd = (amount: string) => ({ amount, currency: 'USD' });

/** The revision an invoice was made from, as the detail carries it (ADR-023 D5/D15). */
function sourceRevision(lineCount: number, subtotal: string, discountTotal = '0.0000') {
  return {
    quotationRevisionId: REVISION_ID,
    lineCount,
    subtotal: usd(subtotal),
    discountTotal: usd(discountTotal),
  };
}

function detailOf(
  id: string,
  lines: readonly Record<string, unknown>[],
  source: Record<string, unknown> | null = sourceRevision(2, '237.0350'),
  over: Record<string, unknown> = {}
) {
  const inv = invoice(id, over);
  return { invoice: inv, lines, source, recordVersion: inv.recordVersion };
}

const serviceInvoiceLine = (quantity: string) => ({
  id: 'line-1',
  lineNumber: 1,
  lineType: 'service',
  quantity,
  currency: 'USD',
  sourceQuotationItemId: SERVICE_ITEM,
  item: null,
  unit: null,
  // The quotation line it was copied from: four quoted, so one billed is not whole.
  source: { description: 'Wheel alignment', quotedQuantity: '4.000', discount: usd('0.0000') },
  recordVersion: 1,
  money: {
    unitPrice: { amount: '50.0000', currency: 'USD' },
    net: { amount: '50.0000', currency: 'USD' },
    tax: { amount: '5.0000', currency: 'USD' },
    gross: { amount: '55.0000', currency: 'USD' },
    payerSplit: {
      customer: { amount: '55.0000', currency: 'USD' },
      warranty: { amount: '0.0000', currency: 'USD' },
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  readInvoicePreview.mockImplementation(async () => okRead(partlyApproved()));
  readInvoice.mockImplementation(async (id: string) =>
    okRead(detailOf(id, [serviceInvoiceLine('1.000')]))
  );
  readOutstanding.mockImplementation(async () => okRead(outstanding));
  listInvoices.mockImplementation(async () => ({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  }));
});

const region = (name: string) => screen.getByRole('region', { name });

describe('what would be billed, line by line (D5/D15)', () => {
  it('shows approved, already invoiced and to invoice, and says when part was invoiced before', async () => {
    renderLtr(screenFor(orderRead([], false)));
    const panel = region(EN['invoices.preview.heading'] as string);
    const description = await within(panel).findByText('Wheel alignment');
    const row = description.closest('tr') as HTMLElement;
    const headers = within(panel)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        EN['invoices.preview.column.approved'],
        EN['invoices.preview.column.invoiced'],
        EN['invoices.preview.column.quantity'],
      ])
    );
    for (const quantity of ['4.000', '3.000', '1.000']) {
      expect(within(row).getByText(quantity)).toHaveAttribute('dir', 'ltr');
    }
    expect(within(row).getByText(EN['invoices.preview.partlyInvoiced'] as string)).toBeVisible();
    expect(within(panel).getAllByText(money('55.0000')).length).toBeGreaterThanOrEqual(1);
    // And the form that bills it.
    expect(
      within(panel).getByRole('button', { name: EN['invoices.create.submit'] as string })
    ).toBeVisible();
  });

  it('lists every line left off with why, in words, never as a code', async () => {
    readInvoicePreview.mockImplementation(async () =>
      okRead(
        partlyApproved({
          revisionLines: [
            revisionLine({}),
            PART_LINE,
            revisionLine({
              sourceQuotationItemId: '66666666-6666-4666-8666-666666666663',
              lineNumber: 3,
              description: 'Brake fluid flush',
              decision: 'rejected',
              approvedQuantity: '0.000',
              billingStatus: 'rejected',
            }),
          ],
        })
      )
    );
    renderLtr(screenFor(orderRead([], false)));
    const panel = region(EN['invoices.preview.heading'] as string);
    const table = await within(panel).findByRole('table', {
      name: EN['invoices.preview.notBilled.caption'] as string,
    });
    const part = within(table).getByText('Oil filter').closest('tr') as HTMLElement;
    expect(
      within(part).getByText(EN['invoices.billing.reason.not_approved'] as string)
    ).toBeVisible();
    expect(within(part).getByText('3.000')).toBeVisible();
    const refused = within(table).getByText('Brake fluid flush').closest('tr') as HTMLElement;
    expect(
      within(refused).getByText(EN['invoices.billing.reason.rejected'] as string)
    ).toBeVisible();
    // The billable line is not in this table, and no status code leaks.
    expect(within(table).queryByText('Wheel alignment')).toBeNull();
    expect(table.textContent).not.toMatch(/not_approved|rejected\b|billable/);
  });

  it('reads the same in Arabic, right to left', async () => {
    renderRtl(screenFor(orderRead([], false), 'ar'));
    const panel = screen.getByRole('region', { name: AR['invoices.preview.heading'] as string });
    const table = await within(panel).findByRole('table', {
      name: AR['invoices.preview.notBilled.caption'] as string,
    });
    const part = within(table).getByText('Oil filter').closest('tr') as HTMLElement;
    expect(
      within(part).getByText(AR['invoices.billing.reason.not_approved'] as string)
    ).toBeVisible();
    expect(within(part).getByText('FLT-07')).toHaveAttribute('dir', 'ltr');
    expect(within(panel).getByText(AR['invoices.preview.partlyInvoiced'] as string)).toBeVisible();
    expect(table.closest('[dir="rtl"]')).not.toBeNull();
  });

  it('when everything approved is invoiced: says so, offers no form and shows no zero', async () => {
    readInvoicePreview.mockImplementation(async () =>
      okRead(
        partlyApproved({
          lines: [],
          subtotal: '0.0000',
          taxTotal: '0.0000',
          netTotal: '0.0000',
          grossTotal: '0.0000',
          revisionLines: [
            revisionLine({
              invoicedQuantity: '1.000',
              remainingQuantity: '0.000',
              billingStatus: 'fully_invoiced',
            }),
          ],
        })
      )
    );
    renderLtr(screenFor(orderRead([], false)));
    const panel = region(EN['invoices.preview.heading'] as string);
    expect(
      await within(panel).findByText(EN['invoices.preview.nothingToBill'] as string)
    ).toBeVisible();
    expect(
      within(panel).getByText(EN['invoices.billing.reason.fully_invoiced'] as string)
    ).toBeVisible();
    expect(
      within(panel).queryByRole('button', { name: EN['invoices.create.submit'] as string })
    ).toBeNull();
    expect(within(panel).queryByText(money('0.0000'))).toBeNull();
  });
});

describe('several live invoices on one work order', () => {
  const two = () => [invoice(SECOND_INVOICE), invoice(FIRST_INVOICE)];

  it('lists them by number, opens the one chosen, and offers what remains beneath them', async () => {
    const user = userEvent.setup();
    readWorkOrderInvoice.mockImplementation(async () => orderRead(two(), true));
    renderLtr(screenFor(orderRead(two(), true)));
    const list = region(EN['invoices.list.heading'] as string);
    const newest = within(list).getByRole('button', { name: /INV-000102/ });
    const older = within(list).getByRole('button', { name: /INV-000101/ });
    expect(newest).toHaveAttribute('aria-pressed', 'true');
    expect(older).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(SECOND_INVOICE));

    await user.click(older);
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(FIRST_INVOICE));
    expect(older).toHaveAttribute('aria-pressed', 'true');

    // Approved work remains and no draft is open: previewed and offered beneath.
    const remaining = region(EN['invoices.remaining.heading'] as string);
    await waitFor(() => expect(readInvoicePreview).toHaveBeenCalledWith(WORK_ORDER_ID));
    expect(await within(remaining).findByText('Wheel alignment')).toBeVisible();
    expect(
      within(remaining).getByRole('button', { name: EN['invoices.create.submit'] as string })
    ).toBeVisible();
  });

  it('an open draft withholds the offer, and nothing remaining shows none', async () => {
    const draft = [
      invoice(SECOND_INVOICE, { status: 'draft', invoiceNumber: null }),
      invoice(FIRST_INVOICE),
    ];
    renderLtr(screenFor(orderRead(draft, true)));
    const list = region(EN['invoices.list.heading'] as string);
    expect(
      within(list).getByRole('button', {
        name: new RegExp(EN['invoices.list.unnumbered'] as string),
      })
    ).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(SECOND_INVOICE));
    expect(
      screen.queryByRole('region', { name: EN['invoices.remaining.heading'] as string })
    ).toBeNull();
    expect(readInvoicePreview).not.toHaveBeenCalled();
  });

  it('a single invoice with nothing approved left shows no list and no offer', async () => {
    renderLtr(screenFor(orderRead([invoice(FIRST_INVOICE)], false)));
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(FIRST_INVOICE));
    expect(
      screen.queryByRole('region', { name: EN['invoices.list.heading'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('region', { name: EN['invoices.remaining.heading'] as string })
    ).toBeNull();
  });
});

describe('the printed copy of an invoice that billed part of its revision', () => {
  function renderCopy(
    lines: readonly Record<string, unknown>[],
    source: Record<string, unknown> | null = sourceRevision(2, '237.0350')
  ) {
    return renderLtr(
      <InvoiceDocument
        locale="en"
        messages={en}
        detail={detailOf(FIRST_INVOICE, lines, source) as never}
        descriptions={{ kind: 'source' }}
        workOrderNumber="WO-000042"
        payer={{ kind: 'named', name: 'Layla Haddad' } as never}
      />
    );
  }

  it('describes its lines, and states no revision subtotal or discount it did not bill', () => {
    // One unit of a four-unit line: not the revision billed whole.
    renderCopy([serviceInvoiceLine('1.000')]);
    expect(screen.getByText('Wheel alignment')).toBeVisible();
    expect(screen.getByTestId('invoice-print-subtotal').textContent).not.toContain(
      money('237.0350')
    );
    expect(screen.getByTestId('invoice-print-discount-total').textContent).not.toContain(
      money('0.0000')
    );
    expect(screen.queryByTestId('invoice-print-line-discount')).toBeNull();
  });

  it('states the revision subtotal when it billed every line of the revision whole', () => {
    const whole = {
      ...serviceInvoiceLine('1.000'),
      source: { description: 'Wheel alignment', quotedQuantity: '1.000', discount: usd('0.0000') },
    };
    renderCopy([whole], sourceRevision(1, '50.0000'));
    expect(screen.getByTestId('invoice-print-subtotal').textContent).toContain(money('50.0000'));
    expect(screen.getByTestId('invoice-print-line-discount').textContent).toContain(
      money('0.0000')
    );
  });
});

describe('printing an earlier quotation’s invoice after a later quotation is billed (D5/D15)', () => {
  const LATER_REVISION = '44444444-4444-4444-8444-444444444445';
  /** Q1's invoice: one wheel alignment, quoted at 50.00 less 5.00, billed whole. */
  const q1Line = {
    ...serviceInvoiceLine('1.000'),
    money: {
      unitPrice: usd('50.0000'),
      net: usd('45.0000'),
      tax: usd('4.5000'),
      gross: usd('49.5000'),
      payerSplit: { customer: usd('49.5000'), warranty: usd('0.0000') },
    },
    source: { description: 'Wheel alignment', quotedQuantity: '1.000', discount: usd('5.0000') },
  };
  /** Q2's invoice: the oil filter of a later quotation. */
  const q2Line = {
    ...serviceInvoiceLine('3.000'),
    lineType: 'part',
    sourceQuotationItemId: PART_ITEM,
    item: { id: 'part-1', code: 'FLT-07', name: 'Oil filter' },
    unit: { code: 'each', name: 'Each' },
    source: { description: 'Synthetic', quotedQuantity: '3.000', discount: usd('0.0000') },
  };
  const invoices = () => [
    invoice(SECOND_INVOICE, { quotationRevisionId: LATER_REVISION }),
    invoice(FIRST_INVOICE),
  ];

  beforeEach(() => {
    readInvoice.mockImplementation(async (id: string) =>
      okRead(
        id === FIRST_INVOICE
          ? detailOf(id, [q1Line], sourceRevision(1, '50.0000', '5.0000'))
          : detailOf(
              id,
              [q2Line],
              { ...sourceRevision(1, '37.0350'), quotationRevisionId: LATER_REVISION },
              { quotationRevisionId: LATER_REVISION }
            )
      )
    );
  });

  async function printFirst(approvedWorkToInvoice: boolean) {
    const user = userEvent.setup();
    readWorkOrderInvoice.mockImplementation(async () =>
      orderRead(invoices(), approvedWorkToInvoice)
    );
    renderLtr(screenFor(orderRead(invoices(), approvedWorkToInvoice)));
    const list = region(EN['invoices.list.heading'] as string);
    await user.click(within(list).getByRole('button', { name: /INV-000101/ }));
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(FIRST_INVOICE));
    await user.click(
      await screen.findByRole('button', { name: EN['invoices.print.open'] as string })
    );
    const paper = await screen.findByRole('article');
    await within(paper).findByText('INV-000101');
    return paper;
  }

  function expectQ1Copy(paper: HTMLElement) {
    expect(within(paper).getByText('Wheel alignment')).toBeVisible();
    expect(within(paper).queryByText(EN['invoices.print.noDescription'] as string)).toBeNull();
    expect(within(paper).getByTestId('invoice-print-line-discount')).toHaveTextContent(
      money('5.0000')
    );
    expect(within(paper).getByTestId('invoice-print-subtotal')).toHaveTextContent(money('50.0000'));
    expect(within(paper).getByTestId('invoice-print-discount-total')).toHaveTextContent(
      money('5.0000')
    );
    expect(
      within(paper).getByText(EN['invoices.print.descriptionsFromQuotation'] as string)
    ).toBeVisible();
    // Nothing of the later quotation reaches this copy.
    expect(within(paper).queryByText('Oil filter')).toBeNull();
  }

  it('while the work order previews the later revision, Q1’s copy keeps its own figures', async () => {
    // A part of the later revision still waits to be billed, so the work order's
    // preview names THAT revision.
    readInvoicePreview.mockImplementation(async () =>
      okRead(partlyApproved({ quotationRevisionId: LATER_REVISION }))
    );
    const paper = await printFirst(true);
    expectQ1Copy(paper);
  });

  it('once both quotations are fully invoiced and the preview is a conflict, Q1’s copy keeps its own figures', async () => {
    readInvoicePreview.mockImplementation(async () => ({
      status: 'error' as const,
      correlationId: 'ref-409',
    }));
    const paper = await printFirst(false);
    expectQ1Copy(paper);
    expect(within(paper).queryByText('ref-409')).toBeNull();
  });
});
