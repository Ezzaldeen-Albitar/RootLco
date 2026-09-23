import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import type { ReactElement } from 'react';
import {
  inBranch,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
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
vi.mock('@/features/billing/api', () => ({
  createCounterSale: (...args: unknown[]) => createCounterSale(...args),
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
  cancelInvoice: (...args: unknown[]) => cancelInvoice(...args),
  listCounterSales: (...args: unknown[]) => listCounterSales(...args),
  readInvoice: (...args: unknown[]) => readInvoice(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
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
});

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
    const addEventListener = vi.spyOn(window, 'addEventListener');
    renderLtr(screenAt());
    await toDraft(user);
    expect(screen.getByText(EN['inventory.counterSales.sale.draftListed'] as string)).toBeTruthy();
    // The sentence is now true because the list exists, so the browser is no
    // longer asked to confirm a navigation that costs nothing.
    expect(addEventListener.mock.calls.some(([name]) => name === 'beforeunload')).toBe(false);
    addEventListener.mockRestore();
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
    expect(screen.getByText(/12\.5/)).toBeTruthy();
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
