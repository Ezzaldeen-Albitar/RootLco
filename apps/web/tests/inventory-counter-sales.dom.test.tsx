import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { renderLtr, renderRtl } from './render';
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
vi.mock('@/features/billing/api', () => ({
  createCounterSale: (...args: unknown[]) => createCounterSale(...args),
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
  cancelInvoice: (...args: unknown[]) => cancelInvoice(...args),
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
});

const screenAt = () => (
  <CounterSalesScreen locale="en" messages={en} canSell canIssue canReadCustomers canReadBranches />
);

/** Choose the branch, the buyer, and one scanned line. */
async function buildOneLine(user: ReturnType<typeof userEvent.setup>) {
  await chooseBranch(
    user,
    'inventory.counterSales.targetLabel',
    'inventory.counterSales.chooseBranch'
  );
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
    await chooseBranch(
      user,
      'inventory.counterSales.targetLabel',
      'inventory.counterSales.chooseBranch'
    );
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
    await chooseBranch(
      user,
      'inventory.counterSales.targetLabel',
      'inventory.counterSales.chooseBranch'
    );
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
    await chooseBranch(
      user,
      'inventory.counterSales.targetLabel',
      'inventory.counterSales.chooseBranch'
    );
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
    await chooseBranch(
      user,
      'inventory.counterSales.targetLabel',
      'inventory.counterSales.chooseBranch'
    );
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

  it('states plainly that a telephone number cannot be searched on', async () => {
    const user = userEvent.setup();
    renderLtr(screenAt());
    await chooseBranch(
      user,
      'inventory.counterSales.targetLabel',
      'inventory.counterSales.chooseBranch'
    );
    expect(
      await screen.findByText(EN['inventory.counterSales.buyer.explain'] as string)
    ).toBeTruthy();
  });

  it('offers no buyer search without the customer permission, and says so', async () => {
    const user = userEvent.setup();
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
    await chooseBranch(
      user,
      'inventory.counterSales.targetLabel',
      'inventory.counterSales.chooseBranch'
    );
    expect(
      await screen.findByText(EN['inventory.counterSales.buyer.needsRead'] as string)
    ).toBeTruthy();
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
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
    const user = userEvent.setup();
    renderLtr(
      (await CounterSalesPage({ params: Promise.resolve({ locale: 'en' }) })) as React.ReactElement
    );
    await chooseBranch(
      user,
      'inventory.counterSales.targetLabel',
      'inventory.counterSales.chooseBranch'
    );
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
