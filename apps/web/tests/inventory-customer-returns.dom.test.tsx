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
  OTHER_LOCATION_ID,
  USER_ID,
  branch,
  chooseBranch,
  labelled,
  okPage,
  okRead,
  refusedWith,
  seriousViolations,
  shelf,
  succeeded,
  warehouse,
} from './support/stock-operations';

/**
 * Taking a part back, rendered (P1-32).
 *
 * The properties under test — each one a way a returns desk goes wrong:
 *
 *  - **All three figures are shown.** What left, what has already come back and
 *    the remainder. A bare remainder cannot be reconciled by the person holding
 *    the part.
 *  - **The quantity is capped at the remainder**, compared as exact decimal
 *    strings, and refused BEFORE anything is sent — while the screen still says
 *    the real ceiling is re-checked when it is saved.
 *  - **Damaged demands a quarantine place**, and the screen states honestly that
 *    a damaged return does not rejoin sellable stock.
 *  - **The credit note is pending**, and nothing claims a refund was made.
 */

const AR = ar as Record<string, string>;

const readReturnable = vi.fn();
const createSalesReturn = vi.fn();
const listSalesReturns = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  readReturnable: (...args: unknown[]) => readReturnable(...args),
  createSalesReturn: (...args: unknown[]) => createSalesReturn(...args),
  listSalesReturns: (...args: unknown[]) => listSalesReturns(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  listItemCategories: vi.fn(),
  listItems: vi.fn(),
}));

/*
 * DEF-T-06. The sale and its lines are now OFFERED, so the two invoice reads
 * the picker uses are mocked here: the branch's issued counter sales, and the
 * lines of the chosen one.
 */
const listCounterSales = vi.fn();
const readInvoice = vi.fn();
vi.mock('@/features/billing/api', () => ({
  listCounterSales: (...args: unknown[]) => listCounterSales(...args),
  readInvoice: (...args: unknown[]) => readInvoice(...args),
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

const { CustomerReturnsScreen } =
  await import('@/features/inventory/components/CustomerReturnsScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const CustomerReturnsPage = (
  await import('@/app/[locale]/(dashboard)/inventory/customer-returns/page')
).default as unknown as RoutePage;

const SOURCE_ID = '77777777-7777-4777-8777-777777777777';
const CREDIT_NOTE_ID = '88888888-8888-4888-8888-888888888888';
const SALE_ID = '99999999-9999-4999-8999-999999999999';

/** One issued counter sale of the branch, as `sal.counter-sale-list` states it. */
const sale = {
  id: SALE_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  workOrderId: null,
  saleKind: 'counter_sale',
  quotationRevisionId: null,
  payerPartnerId: '55555555-5555-4555-8555-555555555555',
  currency: 'JOD',
  status: 'issued',
  invoiceNumber: 'CS-0001',
  issuedAt: '2026-09-01T08:00:00.000Z',
  recordVersion: 2,
  totals: {
    net: { amount: '12.5000', currency: 'JOD' },
    tax: { amount: '0.0000', currency: 'JOD' },
    gross: { amount: '12.5000', currency: 'JOD' },
  },
};

/** The line of that sale the part is coming back from. */
const saleLine = {
  id: SOURCE_ID,
  lineNumber: 1,
  lineType: 'part',
  quantity: '5.000',
  currency: 'JOD',
  sourceQuotationItemId: null,
  recordVersion: 1,
  money: {
    unitPrice: { amount: '2.5000', currency: 'JOD' },
    net: { amount: '12.5000', currency: 'JOD' },
    tax: { amount: '0.0000', currency: 'JOD' },
    gross: { amount: '12.5000', currency: 'JOD' },
    payerSplit: {
      customer: { amount: '12.5000', currency: 'JOD' },
      warranty: { amount: '0.0000', currency: 'JOD' },
    },
  },
};

const returnable = (over: Record<string, unknown> = {}) =>
  okRead({
    sourceKind: 'invoice_line',
    sourceId: SOURCE_ID,
    itemId: ITEM_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    sourceQuantity: '5.000',
    returnedQuantity: '2.000',
    remainingQuantity: '3.000',
    ...over,
  });

function received(over: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    sourceKind: 'invoice_line',
    sourceId: SOURCE_ID,
    itemId: ITEM_ID,
    sku: 'BRK-001',
    quantity: '1.000',
    condition: 'restockable',
    receivedLocationId: LOCATION_ID,
    quarantineLocationId: null,
    reason: null,
    creditNoteId: null,
    status: 'received',
    recordVersion: 1,
    createdAt: '2026-09-01T09:00:00.000Z',
    replayed: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = ['inv.stock.read', 'inv.stock.operate', 'sal.finance.view', 'org.branch.read'];
  readReturnable.mockResolvedValue(returnable());
  listSalesReturns.mockResolvedValue(okPage([received()]));
  listLocations.mockResolvedValue(
    okRead({ items: [warehouse, shelf], nextCursor: null, hasMore: false })
  );
  listBranches.mockResolvedValue(okRead({ items: [branch] }));
  createSalesReturn.mockResolvedValue(succeeded('inventory.returns.create.success', received()));
  listCounterSales.mockResolvedValue(okPage([sale]));
  readInvoice.mockResolvedValue(okRead({ invoice: sale, lines: [saleLine], recordVersion: 2 }));
});

const operable = () => (
  <CustomerReturnsScreen locale="en" messages={en} canOperate canReadBranches />
);

async function openBranch(user: ReturnType<typeof userEvent.setup>) {
  await chooseBranch(user, 'inventory.returns.targetLabel', 'inventory.returns.chooseBranch');
}

/**
 * DEF-T-06. Names the source by PICKING it — the sale, then the line — which is
 * what the operator now does. Nothing is typed: the reference the form used to
 * demand is published on no screen in the product, and the acceptance campaign
 * had to copy one out of the raw column of the movement table by hand.
 */
async function lookUpSource(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText(labelled('inventory.returns.sale.label')),
    SALE_ID
  );
  await user.selectOptions(
    await screen.findByLabelText(labelled('inventory.returns.sale.lineLabel')),
    SOURCE_ID
  );
  await waitFor(() => expect(readReturnable).toHaveBeenCalledTimes(1));
}

describe('what may still come back', () => {
  it('reads the source and shows all three figures, not just the remainder', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    expect(readReturnable).toHaveBeenCalledWith('invoice_line', SOURCE_ID);
    await waitFor(() => expect(screen.getByText('5.000')).toBeTruthy());
    expect(screen.getByText('2.000')).toBeTruthy();
    expect(screen.getByText('3.000')).toBeTruthy();
  });

  it('refuses a badly formed reference without asking the server', async () => {
    // The typed box survives only where the picker cannot reach: here the sale
    // reads are refused, so the fallback is what is on screen.
    listCounterSales.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await user.type(
      await screen.findByLabelText(labelled('inventory.returns.source.id')),
      'not-a-reference'
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.source.look'] as string })
    );
    expect(screen.getByText(EN['inventory.common.idFormat'] as string)).toBeTruthy();
    expect(readReturnable).not.toHaveBeenCalled();
  });

  it('says a reference that matched nothing matched nothing', async () => {
    const user = userEvent.setup();
    readReturnable.mockResolvedValue({ status: 'not-found', correlationId: 'corr' });
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returns.source.missing'] as string)).toBeTruthy()
    );
  });
});

describe('the cap on the quantity', () => {
  it('REFUSES more than what may still come back, before anything is sent', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '3.001');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    expect(screen.getByText(EN['inventory.returns.overRemaining'] as string)).toBeTruthy();
    expect(createSalesReturn).not.toHaveBeenCalled();
  });

  it('accepts exactly the remainder', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '3.000');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    await waitFor(() => expect(createSalesReturn).toHaveBeenCalledTimes(1));
    const [body] = createSalesReturn.mock.calls[0] as [Record<string, unknown>];
    expect(body['quantity']).toBe('3.000');
  });

  it('compares the digits, so a longer decimal below the remainder is accepted', async () => {
    const user = userEvent.setup();
    readReturnable.mockResolvedValue(returnable({ remainingQuantity: '10.000' }));
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    // `9.5` against `10.000`: a textual comparison would call this too much.
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '9.5');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    await waitFor(() => expect(createSalesReturn).toHaveBeenCalledTimes(1));
  });

  it('says the ceiling is checked again when it is saved', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    expect(await screen.findByText(EN['inventory.returns.create.explain'] as string)).toBeTruthy();
  });

  it('says in words that the server refused a return the ceiling no longer allows', async () => {
    const user = userEvent.setup();
    createSalesReturn.mockResolvedValue(refusedWith('inventory.returns.create.refused'));
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '1');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returns.create.refused'] as string)).toBeTruthy()
    );
  });
});

describe('the condition decides the shelf', () => {
  it('asks for nowhere to hold a good part apart', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    expect(
      screen.queryByLabelText(labelled('inventory.returns.create.quarantineLocation'))
    ).toBeNull();
  });

  it('DEMANDS a place to hold a damaged part apart, and refuses without one', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.condition')),
      'damaged'
    );
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '1');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    expect(screen.getByText(EN['inventory.returns.quarantineRequired'] as string)).toBeTruthy();
    expect(createSalesReturn).not.toHaveBeenCalled();
  });

  it('states honestly that a damaged part does not go back on the shelf', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.condition')),
      'damaged'
    );
    expect(screen.getByText(EN['inventory.returns.damagedExplain'] as string)).toBeTruthy();
  });

  it('sends the quarantine place with a damaged return, and none with a good one', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.condition')),
      'damaged'
    );
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '1');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.quarantineLocation')),
      OTHER_LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    await waitFor(() => expect(createSalesReturn).toHaveBeenCalledTimes(1));
    const [body, key] = createSalesReturn.mock.calls[0] as [Record<string, unknown>, string];
    expect(body['condition']).toBe('damaged');
    expect(body['quarantineLocationId']).toBe(OTHER_LOCATION_ID);
    expect(typeof key).toBe('string');
  });
});

describe('the credit note', () => {
  it('says a credit note is waiting for a second person, not that money was refunded', async () => {
    const user = userEvent.setup();
    createSalesReturn.mockResolvedValue(
      succeeded(
        'inventory.returns.create.success',
        received({ creditNoteId: CREDIT_NOTE_ID, status: 'credited' })
      )
    );
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '1');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returns.create.credited'] as string)).toBeTruthy()
    );
  });

  it('marks a returned row that raised a credit note as waiting for approval', async () => {
    const user = userEvent.setup();
    listSalesReturns.mockResolvedValue(
      okPage([received({ creditNoteId: CREDIT_NOTE_ID, status: 'credited' })])
    );
    renderLtr(operable());
    await openBranch(user);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returns.creditPending'] as string)).toBeTruthy()
    );
    expect(screen.getByText(EN['inventory.returnStatus.credited'] as string)).toBeTruthy();
  });

  it('marks a damaged row as held apart in the list', async () => {
    const user = userEvent.setup();
    listSalesReturns.mockResolvedValue(
      okPage([received({ condition: 'damaged', quarantineLocationId: OTHER_LOCATION_ID })])
    );
    renderLtr(operable());
    await openBranch(user);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returns.quarantined'] as string)).toBeTruthy()
    );
  });
});

/**
 * DEF-T-06. The form asked for "the reference of the sale line", and no sale
 * screen, invoice screen or list in the product publishes one — the acceptance
 * campaign copied a 36-character identifier out of the raw column of the
 * movement table by hand to finish the journey. The sale is offered now, and so
 * are its lines.
 */
describe('naming the sale instead of typing its reference', () => {
  it('offers the branch ISSUED sales, because a draft has taken nothing off the shelf', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await waitFor(() => expect(listCounterSales).toHaveBeenCalled());
    expect(listCounterSales.mock.calls[0]).toEqual([
      { companyId: COMPANY_ID, branchId: BRANCH_ID },
      { status: 'issued' },
    ]);
    // No naked identifier field while the picker is on screen.
    expect(screen.queryByLabelText(labelled('inventory.returns.source.id'))).toBeNull();
  });

  it('reads the chosen sale lines and asks the server what is left of the chosen one', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.returns.sale.label')),
      SALE_ID
    );
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(SALE_ID));

    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.returns.sale.lineLabel')),
      SOURCE_ID
    );
    // Choosing the line is what names the source, and the returnable quantity
    // is the SERVER's figure for that line — not one the screen worked out.
    await waitFor(() => expect(readReturnable).toHaveBeenCalledWith('invoice_line', SOURCE_ID));
    await waitFor(() => expect(screen.getByText('3.000')).toBeTruthy());
  });

  it('sends the line the operator picked, with the quantity as the string it typed', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '1.000');
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      LOCATION_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    await waitFor(() => expect(createSalesReturn).toHaveBeenCalledTimes(1));
    const [body] = createSalesReturn.mock.calls[0] as [Record<string, unknown>];
    expect(body['sourceKind']).toBe('invoice_line');
    expect(body['sourceId']).toBe(SOURCE_ID);
    expect(body['quantity']).toBe('1.000');
  });

  it('falls back to the typed reference when the sales cannot be read, and says why', async () => {
    listCounterSales.mockResolvedValue({ status: 'error', correlationId: 'corr' });
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    expect(
      await screen.findByText(EN['inventory.returns.sale.unavailable'] as string)
    ).toBeTruthy();
    expect(screen.getByLabelText(labelled('inventory.returns.source.id'))).toBeTruthy();
  });

  /**
   * The read answers ONE page. A branch with more issued sales than fit it used
   * to get a silently short list and no identifier field — neither offered the
   * sale nor able to name it, which is the dead end the picker removed for
   * everybody else.
   */
  it('says the list is partial and keeps the typed reference when the page is truncated', async () => {
    listCounterSales.mockResolvedValue(okPage([sale], true));
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    expect(await screen.findByText(EN['inventory.returns.sale.truncated'] as string)).toBeTruthy();
    // Both controls, together: choose it if it is listed, name it if it is not.
    expect(screen.getByLabelText(labelled('inventory.returns.sale.label'))).toBeTruthy();
    expect(screen.getByLabelText(labelled('inventory.returns.source.id'))).toBeTruthy();
  });

  it('says nothing about truncation, and offers no identifier field, on a whole page', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    expect(await screen.findByLabelText(labelled('inventory.returns.sale.label'))).toBeTruthy();
    expect(screen.queryByText(EN['inventory.returns.sale.truncated'] as string)).toBeNull();
    expect(screen.queryByLabelText(labelled('inventory.returns.source.id'))).toBeNull();
  });

  it('keeps the typed reference for parts handed to a job, which no branch list covers', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.returns.source.kind')),
      'part_issue'
    );
    expect(screen.getByLabelText(labelled('inventory.returns.source.id'))).toBeTruthy();
    expect(screen.queryByLabelText(labelled('inventory.returns.sale.label'))).toBeNull();
  });
});

/**
 * DEF-T-07. The credit a return raised was named on this list and reachable
 * nowhere: nothing in the tenant navigation opened a credit note, so the second
 * person had nothing to approve.
 */
describe('reaching the credit a return raised', () => {
  it('links the waiting credit to the screen that shows it', async () => {
    const user = userEvent.setup();
    listSalesReturns.mockResolvedValue(
      okPage([received({ creditNoteId: CREDIT_NOTE_ID, status: 'credited' })])
    );
    renderLtr(operable());
    await openBranch(user);
    const link = await screen.findByRole('link', {
      name: EN['inventory.returns.openCredit'] as string,
    });
    expect(link.getAttribute('href')).toBe(`/en/credit-notes?creditNoteId=${CREDIT_NOTE_ID}`);
  });

  it('offers no such link where no credit was raised', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch(user);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returnStatus.received'] as string)).toBeTruthy()
    );
    expect(
      screen.queryByRole('link', { name: EN['inventory.returns.openCredit'] as string })
    ).toBeNull();
  });
});

describe('permissions and the route page', () => {
  it('offers no form without the permission to take a part back', async () => {
    const user = userEvent.setup();
    renderLtr(
      <CustomerReturnsScreen locale="en" messages={en} canOperate={false} canReadBranches />
    );
    await openBranch(user);
    expect(await screen.findByText(EN['inventory.returns.needsOperate'] as string)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    ).toBeNull();
  });

  it('denies the page without the stock permission and issues no read', async () => {
    PERMISSIONS = [];
    renderLtr(
      (await CustomerReturnsPage({
        params: Promise.resolve({ locale: 'en' }),
      })) as React.ReactElement
    );
    expect(listSalesReturns).not.toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('withholds the form from a caller who may not see amounts', async () => {
    PERMISSIONS = ['inv.stock.read', 'inv.stock.operate', 'org.branch.read'];
    const user = userEvent.setup();
    renderLtr(
      (await CustomerReturnsPage({
        params: Promise.resolve({ locale: 'en' }),
      })) as React.ReactElement
    );
    await openBranch(user);
    expect(await screen.findByText(EN['inventory.returns.needsOperate'] as string)).toBeTruthy();
  });
});

describe('accessibility and Arabic', () => {
  it('has no serious or critical accessibility finding', async () => {
    const user = userEvent.setup();
    const { container } = renderLtr(operable());
    await openBranch(user);
    await lookUpSource(user);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders right to left with its own words', () => {
    renderRtl(<CustomerReturnsScreen locale="ar" messages={ar} canOperate canReadBranches />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['inventory.returns.explain'] as string)).toBeTruthy();
  });
});
