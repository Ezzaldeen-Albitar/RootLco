import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { formatInZone } from '../src/lib/branch-time';
import { formatMessage } from '../src/i18n/get-messages';
import type { ReactElement } from 'react';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  inBranch,
  messagesFor,
  renderLtr as renderBareLtr,
  renderRtl as renderBareRtl,
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  WorkingBranchProbe,
  branchSnapshot,
} from './render';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';

/*
 * Every screen in this file is addressed by the WORKING CONTEXT: the branch it
 * reads is the header's own named selection, not a pair typed into the screen
 * (Owner directive, `P1-32-PRE-OD-UX`). So each render goes inside a provider.
 *
 * The two names are shadowed rather than changed at every call site, which
 * keeps the default snapshot — one authorized branch, selected for the operator
 * — true for every case below. A case that needs a different snapshot builds
 * one and renders it explicitly.
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
const renderLtr = (ui: ReactElement, options?: Parameters<typeof renderInLtr>[1]) =>
  renderInLtr(inBranch(ui), options);
const renderRtl = (ui: ReactElement, options?: Parameters<typeof renderInRtl>[1]) =>
  renderInRtl(inBranch(ui, { locale: 'ar' }), options);
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  ITEM_ID,
  LOCATION_ID,
  USER_ID,
  branch,
  chooseBranch,
  item,
  itemPage,
  labelled,
  okRead,
  refusedWith,
  succeeded,
  warehouse,
} from './support/stock-operations';

/**
 * Selling over the counter, rendered (P1-32).
 *
 * The properties under test:
 *
 *  - A scan adds a LINE and writes nothing. The write waits for the person at
 *    the counter to say the sale is complete.
 *  - The body carries no price, no total and no tax — there is no field through
 *    which a client-supplied amount could travel, and the screen must not
 *    invent one.
 *  - The key is derived once per confirmation, so a second press after a lost
 *    answer replays rather than opening a second sale.
 *  - Issuing carries the INVOICE's own version, and only issuing moves stock.
 *  - An issued sale says it cannot be undone and points at the returns desk.
 *  - The money is reached by a LINK carrying the invoice, not by an instruction
 *    to go and find the sale again on another screen.
 */

const AR = ar as Record<string, string>;

const resolveBarcode = vi.fn();
const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  resolveBarcode: (...args: unknown[]) => resolveBarcode(...args),
  listItems: (...args: unknown[]) => listItems(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  listItemCategories: vi.fn(),
}));

const createCounterSale = vi.fn();
const issueInvoice = vi.fn();
const cancelInvoice = vi.fn();
const listCounterSales = vi.fn();
const readInvoice = vi.fn();
const listInvoices = vi.fn();
const readInvoicePreview = vi.fn();
// The issued sale's balance (finance checkpoint, DF-2 / DF-B1).
const readOutstanding = vi.fn();
vi.mock('@/features/billing/api', () => ({
  readOutstanding: (...args: unknown[]) => readOutstanding(...args),
  createCounterSale: (...args: unknown[]) => createCounterSale(...args),
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
  cancelInvoice: (...args: unknown[]) => cancelInvoice(...args),
  listCounterSales: (...args: unknown[]) => listCounterSales(...args),
  readInvoice: (...args: unknown[]) => readInvoice(...args),
  // The printable copy (GAP-09) finds the payer's name through the invoice list,
  // and must never ask for a work-order preview a counter sale does not have.
  listInvoices: (...args: unknown[]) => listInvoices(...args),
  readInvoicePreview: (...args: unknown[]) => readInvoicePreview(...args),
}));

// DX-2 (finance QA fixes E): the balance is read through the cancellable route
// rather than a Server Action. Its browser half is forwarded to the same stand-in
// the action had, so every case below asks and answers exactly as before.
vi.mock('@/features/billing/outstanding-read', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readOutstandingCancellable: (invoiceId: string) => readOutstanding(invoiceId),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: USER_ID,
    permissions: PERMISSIONS,
    email: 'operator@test.local',
  }),
}));

const notifyActionResult = vi.fn<(...args: unknown[]) => boolean>(() => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { CounterSalesScreen } = await import('@/features/inventory/components/CounterSalesScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const CounterSalesPage = (await import('@/app/[locale]/(dashboard)/inventory/counter-sales/page'))
  .default as unknown as RoutePage;

const BUYER_ID = '55555555-5555-4555-8555-555555555555';
const INVOICE_ID = '66666666-6666-4666-8666-666666666666';
const CODE = '4006381333931';

const buyer = {
  id: BUYER_ID,
  displayNumber: 'C-0001',
  displayName: 'Another garage',
  partyType: 'company',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    workOrderId: null,
    saleKind: 'counter_sale',
    quotationRevisionId: null,
    payerPartnerId: BUYER_ID,
    currency: 'JOD',
    status: 'draft',
    invoiceNumber: null,
    issuedAt: null,
    recordVersion: 1,
    totals: {
      net: { amount: '12.5000', currency: 'JOD' },
      tax: { amount: '0.0000', currency: 'JOD' },
      gross: { amount: '12.5000', currency: 'JOD' },
    },
    ...over,
  };
}

const drafted = (over: Record<string, unknown> = {}) => ({
  invoice: invoice(),
  lines: [],
  recordVersion: 1,
  replayed: false,
  ...over,
});

const resolution = {
  scannedValue: CODE,
  normalizedValue: CODE,
  item: {
    id: ITEM_ID,
    sku: 'BRK-001',
    name: 'Brake pad',
    isSerialized: false,
    isStockTracked: true,
    lifecycleStatus: 'active',
  },
  identifier: { id: 'ident-1', kind: 'ean', isPrimary: true, symbology: 'ean13' },
  unit: { id: 'u', code: 'EA' },
  packQuantity: '1.000',
  availability: [
    {
      itemId: ITEM_ID,
      sku: 'BRK-001',
      locationId: LOCATION_ID,
      locationCode: 'WH-1',
      locationType: 'warehouse',
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      onHand: '9.000',
      reserved: '0.000',
      available: '9.000',
      inTransitQty: '0.000',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [
    'sal.invoice.manage',
    'sal.finance.view',
    'sal.invoice.issue',
    'crm.customer.read',
    'org.branch.read',
  ];
  resolveBarcode.mockResolvedValue(okRead(resolution));
  listItems.mockResolvedValue(itemPage([item]));
  listLocations.mockResolvedValue(okRead({ items: [warehouse], nextCursor: null, hasMore: false }));
  listBranches.mockResolvedValue(okRead({ items: [branch] }));
  searchCustomerDirectory.mockResolvedValue({
    status: 'ok',
    rows: [buyer],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  });
  createCounterSale.mockResolvedValue(succeeded('invoices.counterSale.create.success', drafted()));
  issueInvoice.mockResolvedValue(
    succeeded('invoices.issue.success', {
      invoice: invoice({ status: 'issued', invoiceNumber: 'CS-0001', recordVersion: 2 }),
      invoiceNumber: 'CS-0001',
      replayed: false,
      recordVersion: 2,
    })
  );
  cancelInvoice.mockResolvedValue(
    succeeded('invoices.cancel.success', {
      invoice: invoice({ status: 'void_before_issue', recordVersion: 2 }),
      replayed: false,
      recordVersion: 2,
    })
  );
  // DEF-T-13: the branch's drafted sales. Empty by default, so the cases that
  // are not about the list see exactly what they saw before it existed.
  listCounterSales.mockResolvedValue(okRead({ items: [], nextCursor: null, hasMore: false }));
  readInvoice.mockResolvedValue(okRead(drafted()));
  // Two callers of the invoice list: the printable copy finds the payer's name
  // by the sale's number, and the issued-sales list asks for this branch's
  // counter sales (DF-B3) — empty by default, so the cases that are not about it
  // see exactly what they saw before it existed.
  listInvoices.mockImplementation(
    async (_target: unknown, filter: { readonly saleKind?: string } | undefined) =>
      filter?.saleKind === 'counter_sale'
        ? okRead({ items: [], nextCursor: null, hasMore: false })
        : okRead({
            items: [{ id: INVOICE_ID, payer: { displayName: 'Another garage' } }],
            nextCursor: null,
            hasMore: false,
          })
  );
  readOutstanding.mockResolvedValue(okRead(balanceOf()));
});

/** The balance read of the issued sale: 5.000 paid of 12.500, nothing credited. */
function balanceOf(over: Record<string, unknown> = {}) {
  return {
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
    },
    asOf: '2026-10-01T07:30:00.000Z',
    ...over,
  };
}

/** A counter-sale line as `sal.invoice-detail` publishes it: it names its item. */
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

const screenAt = () => (
  <CounterSalesScreen locale="en" messages={en} canSell canIssue canReadCustomers canReadBranches />
);

/** Choose the branch, the buyer, and one scanned line. */
async function buildOneLine(user: ReturnType<typeof userEvent.setup>) {
  await chooseBranch('inventory.counterSales.targetLabel');
  await user.type(
    await screen.findByLabelText(labelled('inventory.counterSales.buyer.term')),
    'garage'
  );
  await user.click(
    screen.getByRole('button', { name: EN['inventory.counterSales.buyer.search'] as string })
  );
  await user.selectOptions(
    await screen.findByLabelText(labelled('inventory.counterSales.buyer.label')),
    BUYER_ID
  );
  const box = screen.getByLabelText(labelled('inventory.scan.label'));
  await user.click(box);
  await user.keyboard(`${CODE}{Enter}`);
  await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
  await user.selectOptions(
    screen.getByLabelText(labelled('inventory.counterSales.line.location')),
    LOCATION_ID
  );
  await user.type(screen.getByLabelText(labelled('inventory.counterSales.line.quantity')), '2');
  await user.click(
    screen.getByRole('button', { name: EN['inventory.counterSales.line.add'] as string })
  );
}

describe('building a sale', () => {
  it('resolves a scan to the item and shows what is on the shelf, writing nothing', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    const box = await screen.findByLabelText(labelled('inventory.scan.label'));
    await user.click(box);
    await user.keyboard(`${CODE}{Enter}`);
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
    // Branch-targeted, so the availability comes back with the answer.
    expect(resolveBarcode.mock.calls[0]?.[1]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    await waitFor(() => expect(screen.getByText(/WH-1: 9\.000/)).toBeTruthy());
    expect(createCounterSale).not.toHaveBeenCalled();
  });

  it('IGNORES a doubled scanner frame of the same code', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    const box = await screen.findByLabelText(labelled('inventory.scan.label'));
    await user.click(box);
    await user.keyboard(`${CODE}{Enter}`);
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
    await user.keyboard(`${CODE}{Enter}`);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.scan.repeatIgnored'] as string)).toBeTruthy()
    );
    expect(resolveBarcode).toHaveBeenCalledTimes(1);
  });

  it('refuses to make a sale with no buyer', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.counterSales.create.submit'] as string,
      })
    );
    expect(screen.getByText(EN['inventory.counterSales.create.needsBuyer'] as string)).toBeTruthy();
    expect(createCounterSale).not.toHaveBeenCalled();
  });

  it('sends the buyer and the lines, and NO amount of any kind', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await buildOneLine(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.create.submit'] as string })
    );
    await waitFor(() => expect(createCounterSale).toHaveBeenCalledTimes(1));
    const [body, key] = createCounterSale.mock.calls[0] as [Record<string, unknown>, string];
    expect(body).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      customerPartnerId: BUYER_ID,
      lines: [{ itemId: ITEM_ID, locationId: LOCATION_ID, quantity: '2' }],
    });
    const sent = JSON.stringify(body);
    for (const forbidden of ['price', 'amount', 'total', 'tax', 'discount']) {
      expect(sent.toLowerCase().includes(forbidden), `the body carried a ${forbidden}`).toBe(false);
    }
    expect(typeof key).toBe('string');
  });

  it('says a drafted sale has moved nothing yet', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await buildOneLine(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.create.submit'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.counterSales.create.done'] as string)).toBeTruthy()
    );
  });

  it('says a replayed draft was not opened twice', async () => {
    const user = userEvent.setup();
    createCounterSale.mockResolvedValue(
      succeeded('invoices.counterSale.create.success', drafted({ replayed: true }))
    );
    renderLtr(screenAt());
    await buildOneLine(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.create.submit'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.counterSales.create.replayed'] as string)).toBeTruthy()
    );
  });

  it('says in words that an item with no price refuses the whole sale', async () => {
    const user = userEvent.setup();
    createCounterSale.mockResolvedValue(refusedWith('inventory.counterSales.create.refused'));
    renderLtr(screenAt());
    await buildOneLine(user);
    expect(screen.getByText(EN['inventory.counterSales.draft.priceNote'] as string)).toBeTruthy();
  });
});

describe('a sale being built and a branch switch', () => {
  /*
   * The counter is keyed on the branch, so a switch used to drop a chosen buyer,
   * the lines added and a half-entered line without a word. It now asks first.
   */
  afterEach(forgetRememberedBranch);

  async function openTwoBranches(user: ReturnType<typeof userEvent.setup>) {
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          {screenAt()}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByLabelText(labelled('inventory.counterSales.line.quantity'));
  }
  const field = () =>
    screen.getByLabelText(labelled('inventory.counterSales.line.quantity')) as HTMLInputElement;

  it('asks before switching; staying keeps what was typed and the branch', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), '2');
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(field().value).toBe('2');
  });

  it('discarding switches the branch and opens the form empty under it', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), '2');
    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await waitFor(() =>
      expect(listCounterSales.mock.lastCall?.[0]).toEqual({
        companyId: OTHER_BRANCH.companyId,
        branchId: OTHER_BRANCH.id,
      })
    );
    expect(field().value).toBe('');
  });

  it('an untouched form switches without asking', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });

  it('a chosen buyer alone is unsaved work too', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(
      await screen.findByLabelText(labelled('inventory.counterSales.buyer.term')),
      'garage'
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.buyer.search'] as string })
    );
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.counterSales.buyer.label')),
      BUYER_ID
    );
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(screen.getByLabelText(labelled('inventory.counterSales.buyer.label'))).toHaveValue(
      BUYER_ID
    );
  });
});

describe('issuing and voiding', () => {
  async function toDraft(user: ReturnType<typeof userEvent.setup>) {
    await buildOneLine(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.create.submit'] as string })
    );
    await screen.findByText(EN['inventory.counterSales.sale.heading'] as string);
  }

  it('issues with the invoice version the draft published', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    );
    await waitFor(() => expect(issueInvoice).toHaveBeenCalledWith(INVOICE_ID, 1));
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.counterSales.issue.done'] as string)).toBeTruthy()
    );
  });

  /**
   * DEF-T-13 (the web half). The draft used to live only in component state, so
   * a reload stranded it and one draft of the acceptance campaign became
   * permanently unreachable. The branch's drafted sales are now listed, and the
   * panel says where the draft will be instead of what leaving costs.
   */
  it('tells the operator where a drafted sale will be, and no longer blocks leaving', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await buildOneLine(user);
    await waitFor(() => expect(leavingIsQuestioned()).toBe(true));
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.create.submit'] as string })
    );
    await screen.findByText(EN['inventory.counterSales.sale.heading'] as string);
    expect(screen.getByText(EN['inventory.counterSales.sale.draftListed'] as string)).toBeTruthy();
    // The sentence is now true because the list exists, so the browser is no
    // longer asked to confirm a navigation that costs nothing. (A buyer or a
    // line not yet drafted IS unsaved work, and the shell's leave-page question
    // covers it until the draft is stored — DEF-S2b.) Asked of the page as the
    // browser asks it, rather than by counting listeners: what matters is
    // whether leaving would be questioned now.
    await waitFor(() => expect(leavingIsQuestioned()).toBe(false));
  });

  it('drops the sentence once the sale is issued, because it is no longer a draft', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.counterSales.sale.issuedNote'] as string)).toBeTruthy()
    );
    expect(screen.queryByText(EN['inventory.counterSales.sale.draftListed'] as string)).toBeNull();
  });

  it('says an issued sale cannot be undone and points at the returns desk', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.counterSales.sale.issuedNote'] as string)).toBeTruthy()
    );
    expect(
      screen.queryByRole('button', { name: EN['inventory.counterSales.void.action'] as string })
    ).toBeNull();
  });

  it('offers no payment link beside a DRAFT, because there is nothing to settle yet', async () => {
    /*
     * A draft has no number and no receivable; `sal.payment-record` refuses to
     * allocate against one. A link offered here sends the operator to a screen
     * that can only refuse them, which is the defect this case exists to keep
     * shut. The sentence beside the link goes with it.
     */
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    expect(
      screen.queryByRole('link', {
        name: EN['inventory.counterSales.sale.takePayment'] as string,
      })
    ).toBeNull();
    expect(screen.queryByText(EN['inventory.counterSales.sale.paymentNote'] as string)).toBeNull();
  });

  it('links the payments screen AT this invoice once it is ISSUED', async () => {
    /*
     * The payments page reads an `invoiceId` from the address and prefills the
     * allocation with it, so a sentence saying "settle it on the payments
     * screen" throws away a mechanism the repository already has. The href is
     * asserted rather than the words: the words are what the previous spelling
     * had, and they are what this case exists to refuse.
     */
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    );
    await screen.findByText(EN['inventory.counterSales.sale.issuedNote'] as string);
    const link = await screen.findByRole('link', {
      name: EN['inventory.counterSales.sale.takePayment'] as string,
    });
    expect(link.getAttribute('href')).toBe(`/en/payments?invoiceId=${INVOICE_ID}`);
  });

  it('voids a draft with a reason and the invoice version', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    await user.type(
      screen.getByLabelText(labelled('inventory.counterSales.void.reason')),
      'Customer changed their mind'
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.void.action'] as string })
    );
    await waitFor(() =>
      expect(cancelInvoice).toHaveBeenCalledWith(
        INVOICE_ID,
        { reason: 'Customer changed their mind' },
        1
      )
    );
  });

  it('refuses a void with no reason before anything is sent', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.void.action'] as string })
    );
    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it('shows the total the server computed and never one of its own', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toDraft(user);
    // In the currency's own minor unit: JOD is written with three decimals
    // (GAP-15), so 12.5000 reads 12.500 and never 12.50.
    expect(screen.getByText('12.500 JOD')).toBeTruthy();
  });

  it('prints an issued counter sale: no preview is waited for, each line names its item', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    createCounterSale.mockResolvedValue(
      succeeded('invoices.counterSale.create.success', drafted({ lines: [soldLine] }))
    );
    renderLtr(screenAt());
    await toDraft(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.counterSales.sale.issuedNote'] as string)).toBeTruthy()
    );
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    // Ready at once: a counter sale has no work-order preview, and none is asked for.
    expect(readInvoicePreview).not.toHaveBeenCalled();
    expect(within(document).getByText('Brake pad')).toBeTruthy();
    expect(within(document).getByText('BRK-001')).toBeTruthy();
    expect(
      within(document).getByText(EN['invoices.print.descriptionsFromItems'] as string)
    ).toBeTruthy();
    expect(within(document).queryByText(EN['invoices.print.noDescription'] as string)).toBeNull();
    expect(within(document).getAllByText('12.500 JOD').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(within(document).getByTestId('invoice-print-payer')).toHaveTextContent(
        'Another garage'
      )
    );
    await user.click(screen.getByRole('button', { name: EN['invoices.print.print'] as string }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    // The copy prints alone: it is held by exactly one direct child of the print
    // scope, beside the working panel the print sheet leaves off the paper.
    const scope = document.closest('[data-print-scope]') as HTMLElement;
    expect(scope).not.toBeNull();
    const holders = [...scope.children].filter((child) => child.contains(document));
    expect(holders).toHaveLength(1);
    expect(scope.children.length).toBeGreaterThan(1);
  });

  it('says amounts are not visible rather than showing a zero', async () => {
    const user = userEvent.setup();
    createCounterSale.mockResolvedValue(
      succeeded('invoices.counterSale.create.success', {
        invoice: invoice({ totals: null }),
        lines: [],
        recordVersion: 1,
        replayed: false,
      })
    );
    renderLtr(screenAt());
    await toDraft(user);
    expect(screen.getByText(EN['inventory.counterSales.sale.noAmounts'] as string)).toBeTruthy();
  });

  it('offers no issue to somebody who may not issue, and says who can', async () => {
    const user = userEvent.setup();
    renderLtr(
      <CounterSalesScreen
        locale="en"
        messages={en}
        canSell
        canIssue={false}
        canReadCustomers
        canReadBranches
      />
    );
    await toDraft(user);
    expect(
      screen.queryByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    ).toBeNull();
    expect(screen.getByText(EN['inventory.counterSales.issue.needsIssue'] as string)).toBeTruthy();
  });
});

describe('the buyer search', () => {
  it('searches by name, and by customer number when asked to', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.counterSales.buyer.searchBy')),
      'customerNumber'
    );
    await user.type(screen.getByLabelText(labelled('inventory.counterSales.buyer.term')), 'C-0001');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.buyer.search'] as string })
    );
    await waitFor(() => expect(searchCustomerDirectory).toHaveBeenCalledTimes(1));
    expect(searchCustomerDirectory.mock.calls[0]?.[2]).toEqual({ customerNumber: 'C-0001' });
  });

  it('searches by telephone number, sending it as typed under `phone`', async () => {
    /*
     * `crm.customer-search` publishes a `phone` parameter — the whole number or
     * a tail of at least seven digits — and this screen sends it through the one
     * customer-search authority rather than folding or reshaping it here. The
     * criterion object is asserted, because a number smuggled into `name` would
     * still produce a request and still find nobody.
     */
    const user = userEvent.setup();
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.counterSales.buyer.searchBy')),
      'phone'
    );
    await user.type(
      screen.getByLabelText(labelled('inventory.counterSales.buyer.term')),
      '0791234567'
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.buyer.search'] as string })
    );
    await waitFor(() => expect(searchCustomerDirectory).toHaveBeenCalledTimes(1));
    expect(searchCustomerDirectory.mock.calls[0]?.[2]).toEqual({ phone: '0791234567' });
  });

  it('offers the telephone number as a search field rather than refusing it', async () => {
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    const chooser = await screen.findByLabelText(labelled('inventory.counterSales.buyer.searchBy'));
    expect(
      [...chooser.querySelectorAll('option')].map((option) => option.getAttribute('value'))
    ).toEqual(['name', 'customerNumber', 'phone']);
  });

  it('offers no buyer search without the customer permission, and says so', async () => {
    renderLtr(
      <CounterSalesScreen
        locale="en"
        messages={en}
        canSell
        canIssue
        canReadCustomers={false}
        canReadBranches
      />
    );
    await chooseBranch('inventory.counterSales.targetLabel');
    expect(
      await screen.findByText(EN['inventory.counterSales.buyer.needsRead'] as string)
    ).toBeTruthy();
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });
});

/**
 * DEF-T-13. A drafted counter sale could not be found again after a reload:
 * the control that issues it lived on the panel the draft rendered, and the
 * screen published no list of drafted sales. One draft of the acceptance
 * campaign was left stranded and is still named in the defect record.
 */
describe('the sales started here and not finished', () => {
  const stranded = invoice({
    id: '77777777-7777-4777-8777-777777777777',
    status: 'draft',
    invoiceNumber: null,
  });

  it('asks only for the drafts of the chosen branch', async () => {
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    await waitFor(() => expect(listCounterSales).toHaveBeenCalled());
    expect(listCounterSales.mock.calls[0]).toEqual([
      { companyId: COMPANY_ID, branchId: BRANCH_ID },
      { status: 'draft' },
    ]);
  });

  it('says so plainly when every sale started here was finished', async () => {
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    expect(
      await screen.findByText(EN['inventory.counterSales.drafts.none'] as string)
    ).toBeTruthy();
  });

  it('reopens a stranded draft onto the panel that can issue or void it', async () => {
    listCounterSales.mockResolvedValue(
      okRead({ items: [stranded], nextCursor: null, hasMore: false })
    );
    readInvoice.mockResolvedValue(okRead({ invoice: stranded, lines: [], recordVersion: 1 }));
    const user = userEvent.setup();
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.counterSales.drafts.reopen'] as string,
      })
    );

    // The detail read is what reopens it: the panel needs the lines and the
    // INVOICE's own version, and the list publishes a header only.
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(stranded.id));
    expect(
      await screen.findByText(EN['inventory.counterSales.drafts.reopened'] as string)
    ).toBeTruthy();
    // Reopened as a draft, so both acts are offered — which is exactly what the
    // stranded draft could not be given.
    expect(
      screen.getByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: EN['inventory.counterSales.void.action'] as string })
    ).toBeTruthy();
    // Nothing was written to reach it.
    expect(createCounterSale).not.toHaveBeenCalled();
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it('says a refusal is a refusal rather than showing an empty list', async () => {
    listCounterSales.mockResolvedValue({ status: 'denied' as const, correlationId: 'corr' });
    renderLtr(screenAt());
    await chooseBranch('inventory.counterSales.targetLabel');
    expect(
      await screen.findByText(EN['inventory.counterSales.drafts.refused'] as string)
    ).toBeTruthy();
    expect(screen.queryByText(EN['inventory.counterSales.drafts.none'] as string)).toBeNull();
  });
});

describe('the route page', () => {
  it('denies without the invoice permission and renders no screen', async () => {
    PERMISSIONS = [];
    renderLtr(
      (await CounterSalesPage({ params: Promise.resolve({ locale: 'en' }) })) as React.ReactElement
    );
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('withholds the sale from a caller who may not see amounts', async () => {
    PERMISSIONS = ['sal.invoice.manage', 'org.branch.read'];
    renderLtr(
      (await CounterSalesPage({ params: Promise.resolve({ locale: 'en' }) })) as React.ReactElement
    );
    await chooseBranch('inventory.counterSales.targetLabel');
    expect(
      await screen.findByText(EN['inventory.counterSales.needsManage'] as string)
    ).toBeTruthy();
  });
});

describe('Arabic', () => {
  it('renders right to left with its own words', () => {
    renderRtl(
      <CounterSalesScreen
        locale="ar"
        messages={ar}
        canSell
        canIssue
        canReadCustomers
        canReadBranches
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['inventory.counterSales.explain'] as string)).toBeTruthy();
  });
});

/*
 * Finance checkpoint fixes B (`P1-32-PRE-OD-FQB`). The signed-in checkpoint at
 * f130fc06 printed a counter sale with no paid, credited or due figure (DF-B1),
 * put the screen's own text on the paper above the invoice (DF-B2), offered no
 * way back to an issued sale once the operator left the counter (DF-B3), and
 * never said how far a counter sale was paid (DF-2).
 */
describe('finance checkpoint fixes B', () => {
  /** Draft one line, then issue it, as the person at the counter does. */
  async function toIssued(user: ReturnType<typeof userEvent.setup>) {
    createCounterSale.mockResolvedValue(
      succeeded('invoices.counterSale.create.success', drafted({ lines: [soldLine] }))
    );
    await buildOneLine(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.create.submit'] as string })
    );
    await screen.findByText(EN['inventory.counterSales.sale.heading'] as string);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    );
    await screen.findByText(EN['inventory.counterSales.sale.issuedNote'] as string);
  }

  /*
   * Whether the print sheet keeps an element on the paper — the rules of
   * `styles/print/_index.scss`, which `gallery-and-print.dom.test.tsx` holds
   * against the compiled sheet: a direct child of a print scope that holds an
   * open document is left off unless it is or holds that document, and `hide`,
   * navigation and buttons never print.
   */
  function onPaper(element: Element): boolean {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      if (node.matches('[data-print="hide"], nav, button:not([data-print="keep"])')) return false;
      const parent = node.parentElement;
      if (
        parent !== null &&
        parent.matches('[data-print-scope]') &&
        parent.querySelector('[data-print="document"]') !== null &&
        !node.matches('[data-print="document"]') &&
        node.querySelector('[data-print="document"]') === null
      ) {
        return false;
      }
    }
    return true;
  }

  const issuedRow = (over: Record<string, unknown> = {}) => ({
    ...invoice({ status: 'issued', invoiceNumber: 'CS-0007', issuedAt: '2026-10-01T07:00:00Z' }),
    payer: { displayName: 'Another garage', displayNumber: 'C-0001', partyType: 'company' },
    outstanding: { amount: '7.5000', currency: 'JOD' },
    ...over,
  });
  const issuedDetail = () => ({
    invoice: invoice({
      status: 'issued',
      invoiceNumber: 'CS-0007',
      issuedAt: '2026-10-01T07:00:00Z',
      recordVersion: 2,
    }),
    lines: [soldLine],
    recordVersion: 2,
  });
  /** The issued-sales list answers these pages, in order; the payer lookup is answered apart. */
  function issuedPages(...pages: readonly (readonly unknown[])[]) {
    let call = 0;
    listInvoices.mockImplementation(
      async (_target: unknown, filter: { readonly saleKind?: string } | undefined) => {
        if (filter?.saleKind !== 'counter_sale') {
          return okRead({
            items: [{ id: INVOICE_ID, payer: { displayName: 'Another garage' } }],
            nextCursor: null,
            hasMore: false,
          });
        }
        const index = Math.min(call, pages.length - 1);
        call += 1;
        const last = index === pages.length - 1;
        return okRead({
          items: pages[index] ?? [],
          nextCursor: last ? null : `cursor-${index + 1}`,
          hasMore: !last,
        });
      }
    );
  }
  const issuedCalls = () =>
    listInvoices.mock.calls.filter(
      (call) => (call[1] as { readonly saleKind?: string } | undefined)?.saleKind === 'counter_sale'
    );

  it('DF-B1: the printed copy carries the settlement as of the read, on the branch clock', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toIssued(user);
    await waitFor(() => expect(readOutstanding).toHaveBeenCalledWith(INVOICE_ID));
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    const settlement = await within(document).findByTestId('invoice-print-settlement');
    expect(within(settlement).getByTestId('invoice-print-paid')).toHaveTextContent('5.000 JOD');
    expect(within(settlement).getByTestId('invoice-print-credited')).toHaveTextContent('0.000 JOD');
    expect(within(settlement).getByTestId('invoice-print-balance-due')).toHaveTextContent(
      '7.500 JOD'
    );
    expect(within(settlement).getByTestId('invoice-print-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.partly_paid'] as string
    );
    expect(within(settlement).getByTestId('invoice-print-credit-status')).toHaveTextContent(
      EN['invoices.creditStatus.none'] as string
    );
    // As of the SERVER's moment, on the branch's clock (Asia/Riyadh), named.
    expect(within(settlement).getByTestId('invoice-print-settlement-as-of')).toHaveTextContent(
      formatInZone('2026-10-01T07:30:00.000Z', 'en-GB', 'Asia/Riyadh')
    );
    expect(within(settlement).getByTestId('invoice-print-settlement-clock')).toHaveTextContent(
      'GMT+3'
    );
    // The issued totals are a section of their own, and the settlement is not in it.
    const issued = within(document).getByTestId('invoice-print-issued-totals');
    expect(issued.contains(settlement)).toBe(false);
    expect(within(issued).getAllByText('12.500 JOD').length).toBeGreaterThan(0);
    // A counter sale takes no discount, so its copy has no discount column.
    expect(
      within(document).queryByRole('columnheader', {
        name: EN['invoices.print.column.discount'] as string,
      })
    ).toBeNull();
  });

  it('DF-2: the sale panel says how far the issued sale is paid, from the server', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await toIssued(user);
    expect(await screen.findByTestId('counter-sale-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.partly_paid'] as string
    );
    expect(screen.getByTestId('counter-sale-due')).toHaveTextContent('7.500 JOD');
    // A draft claims nothing, so its balance was never asked for.
    expect(readOutstanding).toHaveBeenCalledTimes(1);
  });

  it('DF-2: a balance that cannot be read is said, never shown as a zero', async () => {
    const user = userEvent.setup();
    readOutstanding.mockResolvedValue({ status: 'unavailable', correlationId: 'ref-503' });
    renderLtr(screenAt());
    await toIssued(user);
    expect(await screen.findByTestId('counter-sale-position-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('counter-sale-payment-status')).toBeNull();
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(within(document).queryByTestId('invoice-print-settlement')).toBeNull();
  });

  it('DF-B2: only the document reaches the paper — no title, explanation, branch panel or notice', async () => {
    const user = userEvent.setup();
    renderLtr(
      (await CounterSalesPage({
        params: Promise.resolve({ locale: 'en' }),
      })) as React.ReactElement
    );
    await toIssued(user);
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(onPaper(document)).toBe(true);
    expect(onPaper(within(document).getByText('Brake pad'))).toBe(true);
    const title = screen.getByRole('heading', {
      level: 1,
      name: EN['inventory.counterSales.title'] as string,
    });
    expect(onPaper(title)).toBe(false);
    expect(onPaper(screen.getByText(EN['inventory.counterSales.description'] as string))).toBe(
      false
    );
    expect(onPaper(screen.getByText(EN['inventory.counterSales.explain'] as string))).toBe(false);
    expect(onPaper(screen.getByText(EN['inventory.counterSales.issue.done'] as string))).toBe(
      false
    );
    expect(
      onPaper(
        screen.getByRole('region', { name: EN['inventory.counterSales.targetLabel'] as string })
      )
    ).toBe(false);
    expect(onPaper(screen.getByText(EN['inventory.counterSales.sale.issuedNote'] as string))).toBe(
      false
    );
  });

  it('DF-B2: with no copy open, printing the screen still prints the screen', async () => {
    renderLtr(
      (await CounterSalesPage({
        params: Promise.resolve({ locale: 'en' }),
      })) as React.ReactElement
    );
    const explain = await screen.findByText(EN['inventory.counterSales.explain'] as string);
    expect(onPaper(explain)).toBe(true);
  });

  it('DF-B3: lists the branch issued sales by the server search, a page at a time', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()], [issuedRow({ id: 'second-sale', invoiceNumber: 'CS-0006' })]);
    renderLtr(screenAt());
    const grid = await screen.findByTestId('counter-issued-grid');
    expect((await within(grid).findAllByText('CS-0007')).length).toBeGreaterThan(0);
    expect(within(grid).getAllByText('Another garage').length).toBeGreaterThan(0);
    expect(within(grid).getAllByText('7.500 JOD').length).toBeGreaterThan(0);
    // Issued counter sales of the working branch, asked of the server.
    expect(issuedCalls()[0]).toEqual([
      { companyId: COMPANY_ID, branchId: BRANCH_ID },
      { saleKind: 'counter_sale', status: 'issued', q: undefined },
      null,
    ]);
    // The server's cursor walks to the next page.
    await user.click(screen.getByRole('button', { name: EN['table.nextPage'] as string }));
    expect(
      (await within(await screen.findByTestId('counter-issued-grid')).findAllByText('CS-0006'))
        .length
    ).toBeGreaterThan(0);
    expect(issuedCalls().at(-1)?.[2]).toBe('cursor-1');
  });

  it('DF-B3: the box is sent as typed — Arabic-Indic digits included — and refuses one character', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()]);
    renderLtr(screenAt());
    await screen.findByTestId('counter-issued-grid');
    const box = screen.getByLabelText(labelled('inventory.counterSales.issued.search'));
    await user.type(box, 'C');
    expect(
      await screen.findByText(EN['inventory.counterSales.issued.tooShort'] as string)
    ).toBeTruthy();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(issuedCalls().some((call) => (call[1] as { q?: string }).q === 'C')).toBe(false);
    await user.clear(box);
    await user.type(box, '٠٠٧');
    await waitFor(() =>
      expect(issuedCalls().some((call) => (call[1] as { q?: string }).q === '٠٠٧')).toBe(true)
    );
  });

  it('DF-B3: opening an issued sale shows it read-only with its copy open and its position', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    issuedPages([issuedRow()]);
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    renderLtr(screenAt());
    const grid = await screen.findByTestId('counter-issued-grid');
    await within(grid).findAllByText('CS-0007');
    await user.click(
      within(grid).getByRole('button', {
        name: new RegExp(`^${EN['inventory.counterSales.issued.open'] as string}`),
      })
    );
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(INVOICE_ID));
    expect(
      await screen.findByText(EN['inventory.counterSales.issued.opened'] as string)
    ).toBeTruthy();
    // Read-only: no issue and no void are offered for an issued sale.
    expect(
      screen.queryByRole('button', { name: EN['inventory.counterSales.issue.action'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['inventory.counterSales.void.action'] as string })
    ).toBeNull();
    // The copy is open without asking, and prints.
    const document = await screen.findByRole('article');
    expect(within(document).getByText('CS-0007')).toBeTruthy();
    expect(await screen.findByTestId('counter-sale-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.partly_paid'] as string
    );
    await user.click(screen.getByRole('button', { name: EN['invoices.print.print'] as string }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    expect(document.textContent).not.toContain(INVOICE_ID);
  });

  it('DF-B3: the page opens the sale named in the address, and ignores anything else', async () => {
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    renderLtr(
      (await CounterSalesPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ invoiceId: INVOICE_ID }),
      } as never)) as React.ReactElement
    );
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(INVOICE_ID));
    expect(await screen.findByRole('article')).toBeTruthy();
  });

  it('DF-B3: an address that names no sale opens nothing', async () => {
    renderLtr(
      (await CounterSalesPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ invoiceId: 'not-a-sale' }),
      } as never)) as React.ReactElement
    );
    await screen.findByTestId('counter-issued-toolbar');
    expect(readInvoice).not.toHaveBeenCalled();
  });

  /** The issued-sales list's Open action on its one row. */
  async function openFromList(user: ReturnType<typeof userEvent.setup>) {
    const grid = await screen.findByTestId('counter-issued-grid');
    await within(grid).findAllByText('CS-0007');
    await user.click(
      within(grid).getByRole('button', {
        name: new RegExp(`^${EN['inventory.counterSales.issued.open'] as string}`),
      })
    );
  }
  const heldLines = () =>
    screen.queryByRole('table', { name: EN['inventory.counterSales.draft.caption'] as string });

  it('DF-B3: opening an issued sale mid-sale keeps the unsaved sale protected and kept', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()]);
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    renderLtr(screenAt());
    await buildOneLine(user);
    await waitFor(() => expect(leavingIsQuestioned()).toBe(true));
    await openFromList(user);
    expect(await screen.findByRole('article')).toBeTruthy();
    // The buyer and the line are not saved anywhere, so leaving still asks while
    // the reprint is on screen.
    expect(leavingIsQuestioned()).toBe(true);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.sale.next'] as string })
    );
    // Back at the counter, what was being built is still there, and still guarded.
    const lines = heldLines();
    expect(lines).not.toBeNull();
    expect(within(lines as HTMLElement).getAllByText('BRK-001').length).toBeGreaterThan(0);
    expect(within(lines as HTMLElement).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByLabelText(labelled('inventory.counterSales.buyer.label'))).toHaveValue(
      BUYER_ID
    );
    expect(leavingIsQuestioned()).toBe(true);
    expect(createCounterSale).not.toHaveBeenCalled();
  });

  it('reopening a stored draft mid-sale keeps the unsaved sale protected and kept too', async () => {
    const stranded = invoice({ id: '77777777-7777-4777-8777-777777777777' });
    listCounterSales.mockResolvedValue(
      okRead({ items: [stranded], nextCursor: null, hasMore: false })
    );
    readInvoice.mockResolvedValue(okRead({ invoice: stranded, lines: [], recordVersion: 1 }));
    const user = userEvent.setup();
    renderLtr(screenAt());
    await buildOneLine(user);
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.counterSales.drafts.reopen'] as string,
      })
    );
    expect(
      await screen.findByText(EN['inventory.counterSales.drafts.reopened'] as string)
    ).toBeTruthy();
    expect(leavingIsQuestioned()).toBe(true);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.sale.next'] as string })
    );
    expect(within(heldLines() as HTMLElement).getAllByText('BRK-001').length).toBeGreaterThan(0);
    expect(leavingIsQuestioned()).toBe(true);
  });

  it('a Draft retried after a lost answer and a reprint detour replays the same attempt', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()]);
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    // The answer is lost: the server may already have made the draft.
    createCounterSale.mockResolvedValueOnce({
      state: {
        status: 'unavailable',
        messageKey: 'state.unavailable.message',
        attempt: 1,
        correlationId: 'corr-lost',
      },
      created: null,
    });
    renderLtr(screenAt());
    await buildOneLine(user);
    const draft = () =>
      user.click(
        screen.getByRole('button', { name: EN['inventory.counterSales.create.submit'] as string })
      );
    await draft();
    await waitFor(() => expect(createCounterSale).toHaveBeenCalledTimes(1));
    const lost = EN['state.unavailable.message'] as string;
    expect(await screen.findByText(lost)).toHaveAttribute('role', 'alert');
    // A detour: open an issued sale to print it again, then come back.
    await openFromList(user);
    expect(await screen.findByRole('article')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.sale.next'] as string })
    );
    // The lost answer is still said beside the composition it belongs to.
    expect(screen.getByText(lost)).toHaveAttribute('role', 'alert');
    await draft();
    await waitFor(() => expect(createCounterSale).toHaveBeenCalledTimes(2));
    const [firstBody, firstKey] = createCounterSale.mock.calls[0] as [unknown, string];
    const [secondBody, secondKey] = createCounterSale.mock.calls[1] as [unknown, string];
    // Same composition, same key: the server replays the draft rather than making a second.
    expect(secondBody).toEqual(firstBody);
    expect(secondKey).toBe(firstKey);
    await screen.findByText(EN['inventory.counterSales.sale.heading'] as string);
    expect(screen.queryByText(lost)).toBeNull();
    // Once a draft is made, the next composition is a new attempt with a key of its own.
    await user.click(
      screen.getByRole('button', { name: EN['inventory.counterSales.sale.next'] as string })
    );
    expect(screen.queryByText(lost)).toBeNull();
    resolveBarcode.mockClear();
    await buildOneLine(user);
    await draft();
    await waitFor(() => expect(createCounterSale).toHaveBeenCalledTimes(3));
    const [, thirdKey] = createCounterSale.mock.calls[2] as [unknown, string];
    expect(thirdKey).not.toBe(firstKey);
  });

  /** What `readInvoice` answers, and the plain-language notice each answer gives. */
  const refusals: readonly (readonly [string, () => unknown, string])[] = [
    ['refused', () => ({ status: 'denied', correlationId: 'ref-403' }), 'openRefused'],
    ['missing', () => ({ status: 'not-found', correlationId: 'ref-404' }), 'openMissing'],
    ['unavailable', () => ({ status: 'unavailable', correlationId: 'ref-503' }), 'openUnavailable'],
    [
      'an invoice of a job',
      () =>
        okRead({
          ...issuedDetail(),
          invoice: invoice({
            status: 'issued',
            invoiceNumber: 'INV-0009',
            workOrderId: '88888888-8888-4888-8888-888888888888',
            saleKind: 'work_order',
          }),
        }),
      'notCounterSale',
    ],
  ];

  it.each(refusals)(
    'DF-B3: opening from the list (%s) is said in words and opens nothing',
    async (_label, answer, noticeKey) => {
      const user = userEvent.setup();
      issuedPages([issuedRow()]);
      readInvoice.mockResolvedValue(answer());
      renderLtr(screenAt());
      await openFromList(user);
      await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(INVOICE_ID));
      const notice = await screen.findByText(
        EN[`inventory.counterSales.issued.${noticeKey}`] as string
      );
      expect(notice).toHaveAttribute('role', 'status');
      expect(screen.queryByRole('article')).toBeNull();
      expect(screen.queryByText(EN['inventory.counterSales.sale.heading'] as string)).toBeNull();
      // Still at the counter, with the list in place to try another.
      expect(screen.getByTestId('counter-issued-grid')).toBeTruthy();
      expect(document.body.textContent).not.toContain('ref-');
    }
  );

  it.each(refusals)(
    'DF-B3: a sale named in the address (%s) is said in words and opens nothing',
    async (_label, answer, noticeKey) => {
      readInvoice.mockResolvedValue(answer());
      renderLtr(
        (await CounterSalesPage({
          params: Promise.resolve({ locale: 'en' }),
          searchParams: Promise.resolve({ invoiceId: INVOICE_ID }),
        } as never)) as React.ReactElement
      );
      await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(INVOICE_ID));
      expect(
        await screen.findByText(EN[`inventory.counterSales.issued.${noticeKey}`] as string)
      ).toHaveAttribute('role', 'status');
      expect(screen.queryByRole('article')).toBeNull();
      expect(screen.queryByText(EN['inventory.counterSales.sale.heading'] as string)).toBeNull();
      // Asked once: the address is consumed, not read again on every render.
      expect(readInvoice).toHaveBeenCalledTimes(1);
    }
  );

  it('DF-2: while the balance is being read, the panel says so and claims nothing', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()]);
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    readOutstanding.mockReturnValue(new Promise(() => undefined));
    renderLtr(screenAt());
    await openFromList(user);
    expect(
      await screen.findByText(EN['inventory.counterSales.sale.positionLoading'] as string)
    ).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('counter-sale-payment-status')).toBeNull();
    expect(screen.queryByTestId('counter-sale-due')).toBeNull();
    expect(screen.queryByTestId('counter-sale-position-unavailable')).toBeNull();
  });

  it('Arabic: the issued sale, its position and its settlement are in Arabic, right to left', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()]);
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    renderRtl(
      <CounterSalesScreen
        locale="ar"
        messages={ar}
        canSell
        canIssue
        canReadCustomers
        canReadBranches
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const grid = await screen.findByTestId('counter-issued-grid');
    await within(grid).findAllByText('CS-0007');
    await user.click(
      within(grid).getByRole('button', {
        name: new RegExp(`^${AR['inventory.counterSales.issued.open'] as string}`),
      })
    );
    expect(await screen.findByTestId('counter-sale-payment-status')).toHaveTextContent(
      AR['invoices.paymentStatus.partly_paid'] as string
    );
    const paper = await screen.findByRole('article');
    const settlement = await within(paper).findByTestId('invoice-print-settlement');
    expect(settlement.textContent).toContain(AR['invoices.print.settlementAsOf'] as string);
    expect(within(settlement).getByTestId('invoice-print-payment-status')).toHaveTextContent(
      AR['invoices.paymentStatus.partly_paid'] as string
    );
    expect(within(settlement).getByTestId('invoice-print-settlement-as-of')).toHaveAttribute(
      'dir',
      'rtl'
    );
  });

  /** What an insurer paid for the buyer (ADR-023 D14), as the balance read states it. */
  const insurerPayment = {
    receipt: { id: 'r-31', reference: 'RCT-000031' },
    payerName: 'Gulf Mutual Insurance' as string | null,
    relationship: 'insurer',
    authorisationReference: 'CLM-2026-0042',
    reason: 'Covered under the policy',
    money: { amount: '5.0000', currency: 'JOD' },
    allocatedAt: '2026-10-01T07:20:00.000Z',
  };
  /** The balance read of a sale a third party paid part of for the buyer. */
  const paidByInsurer = (payment = insurerPayment) =>
    balanceOf({
      settlement: {
        ...balanceOf().settlement,
        thirdPartyPayments: [payment],
        thirdPartyPaymentsTruncated: false,
      },
    });

  it('finance QA fixes D: the sale panel and the copy say who paid for whom, with the authorisation', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()]);
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    readOutstanding.mockResolvedValue(okRead(paidByInsurer()));
    renderLtr(screenAt());
    await openFromList(user);
    const expected = formatMessage(EN['invoices.thirdParty.paidBy'] as string, {
      payer: 'Gulf Mutual Insurance',
      relationship: EN['invoices.thirdParty.relationship.insurer'] as string,
      customer: 'Another garage',
    });
    const panel = await screen.findByTestId('counter-sale-third-party-payments');
    await waitFor(() => expect(panel).toHaveTextContent(expected));
    expect(panel).toHaveTextContent('CLM-2026-0042');
    expect(panel).toHaveTextContent('RCT-000031');
    const paper = await screen.findByRole('article');
    const printed = within(paper).getByTestId('invoice-print-third-party-payments');
    expect(within(paper).getByTestId('invoice-print-settlement')).toContainElement(printed);
    expect(printed).toHaveTextContent(expected);
    expect(printed).toHaveTextContent('CLM-2026-0042');
    // One lookup names the buyer for the panel and the copy alike.
    expect(
      listInvoices.mock.calls.filter(
        (call) =>
          (call[1] as { readonly saleKind?: string } | undefined)?.saleKind !== 'counter_sale'
      )
    ).toHaveLength(1);
  });

  it('finance QA fixes D: in Arabic, right to left, a payer the reader may not see said as not shown', async () => {
    const user = userEvent.setup();
    issuedPages([issuedRow()]);
    readInvoice.mockResolvedValue(okRead(issuedDetail()));
    readOutstanding.mockResolvedValue(
      okRead(paidByInsurer({ ...insurerPayment, payerName: null }))
    );
    renderRtl(
      <CounterSalesScreen
        locale="ar"
        messages={ar}
        canSell
        canIssue
        canReadCustomers
        canReadBranches
      />
    );
    const grid = await screen.findByTestId('counter-issued-grid');
    await within(grid).findAllByText('CS-0007');
    await user.click(
      within(grid).getByRole('button', {
        name: new RegExp(`^${AR['inventory.counterSales.issued.open'] as string}`),
      })
    );
    const expected = formatMessage(AR['invoices.thirdParty.paidBy'] as string, {
      payer: AR['invoices.thirdParty.payerNotShown'] as string,
      relationship: AR['invoices.thirdParty.relationship.insurer'] as string,
      customer: 'Another garage',
    });
    const panel = await screen.findByTestId('counter-sale-third-party-payments');
    await waitFor(() => expect(panel).toHaveTextContent(expected));
    expect(panel).toHaveTextContent(AR['invoices.thirdParty.heading'] as string);
    const paper = await screen.findByRole('article');
    const printed = within(paper).getByTestId('invoice-print-third-party-payments');
    expect(printed).toHaveTextContent(expected);
    expect(printed.closest('[dir="rtl"]')).not.toBeNull();
  });
});

/** Whether the browser would be told to ask before this page is left, now. */
function leavingIsQuestioned(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/*
 * P1-32-PRE-OD-INV6: the counter on Material UI. What the move must keep, in
 * both languages: a line's quantity is a decimal box read left to right and a
 * refused one is marked on its own box with what was typed kept; one press, one
 * write, for the draft, the issue and the void; and the screen's own sentences
 * are never drawn inside a left-to-right figure.
 */
describe('the counter on Material UI (INV6)', () => {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const catalogueOf = (locale: 'en' | 'ar') => (locale === 'ar' ? AR : EN);
  const namedIn = (catalogue: Record<string, string>) => (key: string) =>
    new RegExp(`^${escape(catalogue[key] as string)}`);
  function renderIn(locale: 'en' | 'ar') {
    const ui = (
      <CounterSalesScreen
        locale={locale}
        messages={locale === 'ar' ? ar : en}
        canSell
        canIssue
        canReadCustomers
        canReadBranches
      />
    );
    return locale === 'ar' ? renderRtl(ui) : renderLtr(ui);
  }

  /** The buyer and one scanned line, in the screen's own words; answers the Draft button. */
  async function composeIn(
    user: ReturnType<typeof userEvent.setup>,
    catalogue: Record<string, string>
  ): Promise<HTMLElement> {
    const named = namedIn(catalogue);
    await screen.findByRole('region', {
      name: catalogue['inventory.counterSales.targetLabel'] as string,
    });
    await user.type(
      await screen.findByLabelText(named('inventory.counterSales.buyer.term')),
      'garage'
    );
    await user.click(
      screen.getByRole('button', {
        name: catalogue['inventory.counterSales.buyer.search'] as string,
      })
    );
    await user.selectOptions(
      await screen.findByLabelText(named('inventory.counterSales.buyer.label')),
      BUYER_ID
    );
    await user.click(screen.getByLabelText(named('inventory.scan.label')));
    await user.keyboard(`${CODE}{Enter}`);
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
    await user.selectOptions(
      screen.getByLabelText(named('inventory.counterSales.line.location')),
      LOCATION_ID
    );
    await user.type(screen.getByLabelText(named('inventory.counterSales.line.quantity')), '2');
    await user.click(
      screen.getByRole('button', { name: catalogue['inventory.counterSales.line.add'] as string })
    );
    return screen.getByRole('button', {
      name: catalogue['inventory.counterSales.create.submit'] as string,
    });
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`a line's quantity is a decimal box read left to right; a refused one is marked on it and kept (${locale})`, async () => {
      const catalogue = catalogueOf(locale);
      const named = namedIn(catalogue);
      const user = userEvent.setup();
      renderIn(locale);
      await screen.findByRole('region', {
        name: catalogue['inventory.counterSales.targetLabel'] as string,
      });
      const quantity = await screen.findByLabelText(named('inventory.counterSales.line.quantity'));
      expect(quantity).toHaveAttribute('dir', 'ltr');
      expect(quantity).toHaveAttribute('inputmode', 'decimal');
      expect(quantity).not.toHaveAttribute('type', 'number');
      await user.click(screen.getByLabelText(named('inventory.scan.label')));
      await user.keyboard(`${CODE}{Enter}`);
      await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
      await user.selectOptions(
        screen.getByLabelText(named('inventory.counterSales.line.location')),
        LOCATION_ID
      );
      await user.type(quantity, '1.2.3');
      await user.click(
        screen.getByRole('button', { name: catalogue['inventory.counterSales.line.add'] as string })
      );
      await waitFor(() => expect(quantity).toHaveAttribute('aria-invalid', 'true'));
      expect(quantity).toHaveAccessibleDescription(
        new RegExp(escape(catalogue['inventory.stockOps.quantityFormat'] as string))
      );
      expect(quantity).toHaveValue('1.2.3');
      // Nothing was added to the sale, and nothing was written.
      expect(
        screen.queryByRole('table', {
          name: catalogue['inventory.counterSales.draft.caption'] as string,
        })
      ).toBeNull();
      expect(createCounterSale).not.toHaveBeenCalled();
    });

    it(`a second press of Draft while the draft is out sends nothing more (${locale})`, async () => {
      const catalogue = catalogueOf(locale);
      let answer: (value: unknown) => void = () => undefined;
      createCounterSale.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        })
      );
      const user = userEvent.setup();
      renderIn(locale);
      const draft = await composeIn(user, catalogue);
      // The line is in the sale's own table, its removal named with the stock code.
      const lines = screen.getByRole('table', {
        name: catalogue['inventory.counterSales.draft.caption'] as string,
      });
      expect(
        within(lines).getByRole('button', {
          name: `${catalogue['inventory.counterSales.draft.remove'] as string} BRK-001`,
        })
      ).toBeVisible();
      fireEvent.click(draft);
      fireEvent.click(draft);
      expect(createCounterSale).toHaveBeenCalledTimes(1);
      expect(draft).toBeDisabled();
      answer(succeeded('invoices.counterSale.create.success', drafted()));
      expect(
        await screen.findByText(catalogue['inventory.counterSales.create.done'] as string)
      ).toBeVisible();
      expect(createCounterSale).toHaveBeenCalledTimes(1);
    });
  }

  it('a second press of Issue while the issue is out sends nothing more, and Void waits too', async () => {
    let answer: (value: unknown) => void = () => undefined;
    issueInvoice.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const user = userEvent.setup();
    renderIn('en');
    await user.click(await composeIn(user, EN));
    await screen.findByText(EN['inventory.counterSales.sale.heading'] as string);
    const issue = screen.getByRole('button', {
      name: EN['inventory.counterSales.issue.action'] as string,
    });
    const voidIt = screen.getByRole('button', {
      name: EN['inventory.counterSales.void.action'] as string,
    });
    fireEvent.click(issue);
    fireEvent.click(issue);
    expect(issueInvoice).toHaveBeenCalledTimes(1);
    expect(issue).toBeDisabled();
    expect(voidIt).toBeDisabled();
    answer(
      succeeded('invoices.issue.success', {
        invoice: invoice({ status: 'issued', invoiceNumber: 'CS-0001', recordVersion: 2 }),
        invoiceNumber: 'CS-0001',
        replayed: false,
        recordVersion: 2,
      })
    );
    expect(
      await screen.findByText(EN['inventory.counterSales.issue.done'] as string)
    ).toBeVisible();
    expect(issueInvoice).toHaveBeenCalledTimes(1);
  });

  it('a second press of Void while the void is out sends nothing more; a missing reason is said on its box', async () => {
    let answer: (value: unknown) => void = () => undefined;
    cancelInvoice.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const user = userEvent.setup();
    renderIn('en');
    await user.click(await composeIn(user, EN));
    await screen.findByText(EN['inventory.counterSales.sale.heading'] as string);
    const reason = screen.getByLabelText(labelled('inventory.counterSales.void.reason'));
    const voidIt = screen.getByRole('button', {
      name: EN['inventory.counterSales.void.action'] as string,
    });
    await user.click(voidIt);
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveAccessibleDescription(new RegExp(escape(EN['field.required'] as string)));
    expect(cancelInvoice).not.toHaveBeenCalled();
    await user.type(reason, 'Customer changed their mind');
    fireEvent.click(voidIt);
    fireEvent.click(voidIt);
    expect(cancelInvoice).toHaveBeenCalledTimes(1);
    expect(voidIt).toBeDisabled();
    answer(
      succeeded('invoices.cancel.success', {
        invoice: invoice({ status: 'void_before_issue', recordVersion: 2 }),
        replayed: false,
        recordVersion: 2,
      })
    );
    expect(await screen.findByText(EN['inventory.counterSales.void.done'] as string)).toBeVisible();
    expect(cancelInvoice).toHaveBeenCalledTimes(1);
  });

  it('keeps the screen own sentences out of the left-to-right figures, in Arabic', async () => {
    listCounterSales.mockResolvedValue(
      okRead({ items: [invoice({ totals: null })], nextCursor: null, hasMore: false })
    );
    const user = userEvent.setup();
    renderIn('ar');
    // A drafted sale whose amounts this reader may not see says so in Arabic,
    // in the page's direction, inside the drafts' own table.
    const drafts = await screen.findByRole('table', {
      name: AR['inventory.counterSales.drafts.caption'] as string,
    });
    const notShown = within(drafts).getByText(
      AR['inventory.counterSales.sale.noAmounts'] as string
    );
    expect(notShown.closest('[dir="ltr"]')).toBeNull();
    // What is on the shelf: the sentence in the page's direction, the figures left to right.
    await user.click(screen.getByLabelText(namedIn(AR)('inventory.scan.label')));
    await user.keyboard(`${CODE}{Enter}`);
    const figures = await screen.findByText('WH-1: 9.000');
    expect(figures).toHaveAttribute('dir', 'ltr');
    const sentence = figures.parentElement as HTMLElement;
    expect(sentence).toHaveTextContent(AR['inventory.counterSales.line.onShelf'] as string);
    expect(sentence.closest('[dir="ltr"]')).toBeNull();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
