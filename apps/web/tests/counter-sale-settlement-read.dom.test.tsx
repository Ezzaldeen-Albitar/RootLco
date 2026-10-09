import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import type { ReactElement } from 'react';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  inBranch,
  messagesFor,
  renderLtr as renderBareLtr,
  renderRtl as renderBareRtl,
} from './render';
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  ITEM_ID,
  USER_ID,
  branch,
  item,
  itemPage,
  okRead,
  warehouse,
} from './support/stock-operations';

/**
 * The counter-sale copy and its settlement (DX-2, finance QA fixes E).
 *
 * The signed-in retest held the buyer-name lookup unanswered and saw the sale's
 * balance read wait behind it: after the 60 s ceiling the copy offered Print
 * without its "Payments and credits as of" section and without the third-party
 * line, while the sale panel still said "Reading what has been paid…".
 *
 * The cause is the framework, measured in its source: the Next.js router runs
 * Server Actions one at a time (`app-router-instance.js` — `dispatchAction`
 * appends to the queue while one is pending, and `runRemainingActions` starts
 * the next only when it settles), and both reads were actions. A jsdom render
 * has no such queue — a mocked action is a plain function — so a case that
 * stalls the lookup and answers an action-backed balance would pass with or
 * without the fix. What these cases pin instead is what removes the cause: the
 * balance is read through the cancellable route with `fetch`, never through the
 * `readOutstanding` action, and the real browser half (`browserRead`, with its
 * own bounded wait) is what answers here.
 *
 * And the copy waits for its settlement as it waits for the name: Print is
 * never offered while what was paid is still being read, and a read that fails
 * or runs out of time is said on the copy, with a way to read it again.
 */

/*
 * Since `P1-32-PRE-OD-INV6` every render also goes under the product's Material
 * provider, as the locale layout mounts it: the screen's own fields, buttons and
 * tables are Material's. No selector of an existing case moved: the fields are
 * still labelled boxes and native selects, the lists still tables, the actions
 * still buttons with the same names.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderInLtr = (ui: ReactElement, options?: Parameters<typeof renderBareLtr>[1]) =>
  renderBareLtr(withMui(ui, 'en'), options);
const renderInRtl = (ui: ReactElement, options?: Parameters<typeof renderBareRtl>[1]) =>
  renderBareRtl(withMui(ui, 'ar'), options);
const renderLtr = (ui: ReactElement) => renderInLtr(inBranch(ui));
const renderRtl = (ui: ReactElement) => renderInRtl(inBranch(ui, { locale: 'ar' }));
const AR = ar as Record<string, string>;

vi.mock('@/features/inventory/api', () => ({
  resolveBarcode: vi.fn(),
  listItems: vi.fn(async () => itemPage([item])),
  listLocations: vi.fn(async () =>
    okRead({ items: [warehouse], nextCursor: null, hasMore: false })
  ),
  listBranches: vi.fn(async () => okRead({ items: [branch] })),
  listItemCategories: vi.fn(),
}));

const readInvoice = vi.fn();
const listInvoices = vi.fn();
const readOutstandingAction = vi.fn();
vi.mock('@/features/billing/api', () => ({
  // The action the balance USED to be read through. Nothing may call it now.
  readOutstanding: (...args: unknown[]) => readOutstandingAction(...args),
  createCounterSale: vi.fn(),
  issueInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  listCounterSales: vi.fn(async () => okRead({ items: [], nextCursor: null, hasMore: false })),
  readInvoice: (...args: unknown[]) => readInvoice(...args),
  listInvoices: (...args: unknown[]) => listInvoices(...args),
  readInvoicePreview: vi.fn(),
}));

vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: USER_ID,
    permissions: ['sal.invoice.manage', 'sal.finance.view', 'sal.invoice.issue'],
    email: 'operator@test.local',
  }),
}));

vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: vi.fn(() => true),
}));

const { CounterSalesScreen } = await import('@/features/inventory/components/CounterSalesScreen');
const { CLIENT_READ_TIMEOUT_MS } = await import('@/lib/api/read-budget');

const INVOICE_ID = '66666666-6666-4666-8666-666666666666';
const BUYER_ID = '55555555-5555-4555-8555-555555555555';

const issuedInvoice = {
  id: INVOICE_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  workOrderId: null,
  saleKind: 'counter_sale',
  quotationRevisionId: null,
  payerPartnerId: BUYER_ID,
  currency: 'JOD',
  status: 'issued',
  invoiceNumber: 'CS-0007',
  issuedAt: '2026-10-01T07:00:00Z',
  recordVersion: 2,
  totals: {
    net: { amount: '12.5000', currency: 'JOD' },
    tax: { amount: '0.0000', currency: 'JOD' },
    gross: { amount: '12.5000', currency: 'JOD' },
  },
};

const soldLine = {
  id: 'line-1',
  lineNumber: 1,
  lineType: 'part',
  quantity: '2.000',
  currency: 'JOD',
  sourceQuotationItemId: null,
  item: { id: ITEM_ID, code: 'BRK-001', name: 'Brake pad' },
  recordVersion: 1,
  money: {
    unitPrice: { amount: '6.2500', currency: 'JOD' },
    net: { amount: '12.5000', currency: 'JOD' },
    tax: { amount: '0.0000', currency: 'JOD' },
    gross: { amount: '12.5000', currency: 'JOD' },
    payerSplit: {
      customer: { amount: '12.5000', currency: 'JOD' },
      warranty: { amount: '0.0000', currency: 'JOD' },
    },
  },
};

/** Paid in part, some of it by an insurer for the buyer — the line the retest missed. */
const balance = {
  invoiceId: INVOICE_ID,
  status: 'issued',
  outstanding: { amount: '7.5000', currency: 'JOD' },
  isSettled: false,
  settlement: {
    creditStatus: 'none',
    paymentStatus: 'partly_paid',
    refundStatus: 'none',
    credited: { amount: '0.0000', currency: 'JOD' },
    paid: { amount: '5.0000', currency: 'JOD' },
    thirdPartyPayments: [
      {
        receipt: { id: 'receipt-1', reference: 'RC-0001' },
        payerName: 'Gulf Mutual Insurance',
        relationship: 'insurer',
        authorisationReference: 'AUTH-1',
        reason: 'Covered by the policy',
        money: { amount: '5.0000', currency: 'JOD' },
        allocatedAt: '2026-10-01T07:20:00.000Z',
      },
    ],
    thirdPartyPaymentsTruncated: false,
  },
  asOf: '2026-10-01T07:30:00.000Z',
};

/** The issued-sales list answers one row; the buyer-name lookup is `lookup`. */
function lists(lookup: () => Promise<unknown>) {
  listInvoices.mockImplementation(
    (_target: unknown, filter: { readonly saleKind?: string } | undefined) =>
      filter?.saleKind === 'counter_sale'
        ? Promise.resolve(
            okRead({
              items: [
                {
                  ...issuedInvoice,
                  payer: { displayName: 'Another garage', displayNumber: 'C-0001' },
                  outstanding: { amount: '7.5000', currency: 'JOD' },
                },
              ],
              nextCursor: null,
              hasMore: false,
            })
          )
        : lookup()
  );
}

const named = () =>
  Promise.resolve(
    okRead({
      items: [{ id: INVOICE_ID, payer: { displayName: 'Another garage' } }],
      nextCursor: null,
      hasMore: false,
    })
  );
const never = () => new Promise<never>(() => undefined);

/** A route answer, as `serveBrowserRead` sends one. */
function answered(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-read' },
  });
}

/** A route that never answers, and gives up when the read is aborted. */
function held(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('The read was aborted.', 'AbortError'))
    );
  });
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const settlementReads = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/reads/invoice-outstanding'));

beforeEach(() => {
  vi.clearAllMocks();
  readInvoice.mockResolvedValue(
    okRead({ invoice: issuedInvoice, lines: [soldLine], recordVersion: 2 })
  );
  readOutstandingAction.mockImplementation(() => {
    throw new Error('the balance was read through a Server Action');
  });
  fetchMock.mockImplementation(async () =>
    answered({ status: 'ok', data: balance, correlationId: 'corr-read' })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const screenAt = (locale: 'en' | 'ar' = 'en') => (
  <CounterSalesScreen
    locale={locale}
    messages={locale === 'en' ? en : ar}
    canSell
    canIssue
    canReadCustomers
    canReadBranches
  />
);

/** Open the one issued sale from the list; its copy opens at once (DF-B3). */
async function openTheSale(messages: Record<string, string>) {
  const grid = await screen.findByTestId('counter-issued-grid');
  await within(grid).findAllByText('CS-0007');
  fireEvent.click(
    within(grid).getByRole('button', {
      name: new RegExp(`^${messages['inventory.counterSales.issued.open'] as string}`),
    })
  );
  const heading = await waitFor(() => {
    const found = document.getElementById('invoice-print-heading');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
  return heading.closest('section') as HTMLElement;
}

const printButton = (panel: HTMLElement, messages: Record<string, string>) =>
  within(panel).queryByRole('button', { name: messages['invoices.print.print'] as string });

describe('the settlement is read apart from the name (DX-2)', () => {
  it('reads it through the cancellable route while the name lookup is held, never through an action', async () => {
    lists(never);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLtr(screenAt());
    const panel = await openTheSale(EN);

    // The sale panel has what was paid although the name has not come back.
    expect(await screen.findByTestId('counter-sale-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.partly_paid'] as string
    );
    expect(settlementReads()).toHaveLength(1);
    expect(String(settlementReads()[0]?.[0])).toBe(
      `/reads/invoice-outstanding?invoiceId=${INVOICE_ID}`
    );
    expect(readOutstandingAction).not.toHaveBeenCalled();
    // Still waiting for the name, so nothing is offered for printing yet.
    expect(printButton(panel, EN)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS);
    });
    // The name ran out of time; the copy is printable, and it carries the
    // settlement with the third-party line.
    const copy = await screen.findByRole('article');
    expect(printButton(panel, EN)).toBeVisible();
    const settlement = within(copy).getByTestId('invoice-print-settlement');
    expect(settlement).toHaveTextContent('Gulf Mutual Insurance');
    expect(within(settlement).getByTestId('invoice-print-paid')).toHaveTextContent('5.000 JOD');
    expect(within(copy).getByTestId('invoice-print-payer')).toHaveTextContent(
      EN['invoices.detail.payerUnavailable'] as string
    );
  });
});

describe('the copy is never offered without its settlement (DX-2)', () => {
  it('waits while the settlement is read, says when it could not be, and reads it again', async () => {
    lists(named);
    fetchMock.mockImplementationOnce(async (_url, init) => held(init));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLtr(screenAt());
    const panel = await openTheSale(EN);
    await waitFor(() => expect(settlementReads()).toHaveLength(1));
    expect(
      screen.getByText(EN['inventory.counterSales.sale.positionLoading'] as string)
    ).toBeTruthy();

    // The name is found, but what was paid is still being read: no copy, no Print.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - 1_000);
    });
    expect(screen.queryByRole('article')).toBeNull();
    expect(printButton(panel, EN)).toBeNull();

    // The read's own ceiling: it is given up on and said, never printed as nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const copy = await screen.findByRole('article');
    expect(within(copy).queryByTestId('invoice-print-settlement')).toBeNull();
    expect(within(copy).getByTestId('invoice-print-settlement-unavailable')).toHaveTextContent(
      EN['invoices.print.settlementUnavailable'] as string
    );
    expect(printButton(panel, EN)).toBeVisible();
    expect(panel).toHaveTextContent(EN['invoices.print.settlementTimedOut'] as string);

    fireEvent.click(
      within(panel).getByRole('button', { name: EN['invoices.print.retrySettlement'] as string })
    );
    await waitFor(() => expect(settlementReads()).toHaveLength(2));
    const settlement = await within(screen.getByRole('article')).findByTestId(
      'invoice-print-settlement'
    );
    expect(settlement).toHaveTextContent('Gulf Mutual Insurance');
    expect(
      within(panel).queryByRole('button', { name: EN['invoices.print.retrySettlement'] as string })
    ).toBeNull();
    expect(readOutstandingAction).not.toHaveBeenCalled();
  });

  it('says the same in Arabic, right to left', async () => {
    lists(named);
    fetchMock.mockImplementationOnce(async () =>
      answered({ status: 'unavailable', correlationId: 'corr-503' })
    );
    renderRtl(screenAt('ar'));
    expect(document.documentElement.dir).toBe('rtl');
    const panel = await openTheSale(AR);
    const copy = await screen.findByRole('article');
    expect(within(copy).getByTestId('invoice-print-settlement-unavailable')).toHaveTextContent(
      AR['invoices.print.settlementUnavailable'] as string
    );
    expect(panel).toHaveTextContent(AR['invoices.print.settlementTimedOut'] as string);
    expect(
      within(panel).getByRole('button', { name: AR['invoices.print.retrySettlement'] as string })
    ).toBeVisible();
  });
});

describe('the credit-note copy (finance QA fixes E)', () => {
  it('gives an amount example that is exact in every currency, in both languages', () => {
    for (const messages of [EN, AR]) {
      for (const key of ['creditNotes.request.amountHelp', 'creditNotes.request.amountFormat']) {
        // "25.50" assumed two decimals in a three-decimal currency.
        expect(messages[key], key).not.toMatch(/\d\.\d/);
      }
    }
  });

  it('says a missing approval applies to this branch, in both languages', () => {
    expect(EN['creditNotes.detail.cannotDecide']).toContain('in this branch');
    expect(AR['creditNotes.detail.cannotDecide']).toContain('في هذا الفرع');
  });
});
