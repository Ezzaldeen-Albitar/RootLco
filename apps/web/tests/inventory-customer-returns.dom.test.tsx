import { screen, waitFor, within } from '@testing-library/react';
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
const listIssuedParts = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listIssuedParts: (...args: unknown[]) => listIssuedParts(...args),
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
const ISSUE_ID = 'abababab-abab-4bab-8bab-abababababab';

/** One part handed to a job in the branch, as `inv.part-issue-list` states it. */
const issuedPart = {
  id: ISSUE_ID,
  workOrderId: '12121212-1212-4212-8212-121212121212',
  workOrderDisplayNumber: 'WO-000042',
  item: { id: ITEM_ID, code: 'BRK-001', name: 'Brake pad' },
  quantity: '4.000',
  returnedQuantity: '1.000',
  returnableQuantity: '3.000',
  unitCode: 'EA',
  issuedAt: '2026-09-02T10:00:00.000Z',
  issuedBy: { id: '13131313-1313-4313-8313-131313131313', displayName: null },
  branchId: BRANCH_ID,
};

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
  listIssuedParts.mockResolvedValue(
    okRead({ items: [issuedPart], nextCursor: null, hasMore: false })
  );
});

const operable = () => (
  <CustomerReturnsScreen locale="en" messages={en} canOperate canReadBranches />
);

async function openBranch() {
  await chooseBranch('inventory.returns.targetLabel');
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
    await openBranch();
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
    await openBranch();
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
    await openBranch();
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
    await openBranch();
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
    await openBranch();
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
    await openBranch();
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
    renderLtr(operable());
    await openBranch();
    expect(await screen.findByText(EN['inventory.returns.create.explain'] as string)).toBeTruthy();
  });

  it('says in words that the server refused a return the ceiling no longer allows', async () => {
    const user = userEvent.setup();
    createSalesReturn.mockResolvedValue(refusedWith('inventory.returns.create.refused'));
    renderLtr(operable());
    await openBranch();
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
    await openBranch();
    await lookUpSource(user);
    expect(
      screen.queryByLabelText(labelled('inventory.returns.create.quarantineLocation'))
    ).toBeNull();
  });

  it('DEMANDS a place to hold a damaged part apart, and refuses without one', async () => {
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch();
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
    await openBranch();
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
    await openBranch();
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
    await openBranch();
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
    listSalesReturns.mockResolvedValue(
      okPage([received({ creditNoteId: CREDIT_NOTE_ID, status: 'credited' })])
    );
    renderLtr(operable());
    await openBranch();
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returns.creditPending'] as string)).toBeTruthy()
    );
    expect(screen.getByText(EN['inventory.returnStatus.credited'] as string)).toBeTruthy();
  });

  it('marks a damaged row as held apart in the list', async () => {
    listSalesReturns.mockResolvedValue(
      okPage([received({ condition: 'damaged', quarantineLocationId: OTHER_LOCATION_ID })])
    );
    renderLtr(operable());
    await openBranch();
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
    renderLtr(operable());
    await openBranch();
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
    await openBranch();
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
    await openBranch();
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
    renderLtr(operable());
    await openBranch();
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
    renderLtr(operable());
    await openBranch();
    expect(await screen.findByText(EN['inventory.returns.sale.truncated'] as string)).toBeTruthy();
    // Both controls, together: choose it if it is listed, name it if it is not.
    expect(screen.getByLabelText(labelled('inventory.returns.sale.label'))).toBeTruthy();
    expect(screen.getByLabelText(labelled('inventory.returns.source.id'))).toBeTruthy();
  });

  it('says nothing about truncation, and offers no identifier field, on a whole page', async () => {
    renderLtr(operable());
    await openBranch();
    expect(await screen.findByLabelText(labelled('inventory.returns.sale.label'))).toBeTruthy();
    expect(screen.queryByText(EN['inventory.returns.sale.truncated'] as string)).toBeNull();
    expect(screen.queryByLabelText(labelled('inventory.returns.source.id'))).toBeNull();
  });
});

describe('naming the part handed to a job instead of typing its reference (route sweep B2)', () => {
  async function partIssueKind(user: ReturnType<typeof userEvent.setup>) {
    renderLtr(operable());
    await openBranch();
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.returns.source.kind')),
      'part_issue'
    );
  }
  it('finds the line by what the clerk holds, says what may still come back, and asks the server', async () => {
    const user = userEvent.setup();
    await partIssueKind(user);
    expect(screen.queryByLabelText(labelled('inventory.returns.source.id'))).toBeNull();
    expect(screen.queryByLabelText(labelled('inventory.returns.sale.label'))).toBeNull();
    await user.type(
      screen.getByLabelText(EN['inventory.returns.issue.label'] as string),
      'Brake{Enter}'
    );
    await waitFor(() => expect(listIssuedParts).toHaveBeenCalled());
    expect(listIssuedParts.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    expect(listIssuedParts.mock.calls[0]?.[1]).toEqual({ q: 'Brake' });
    const match = await screen.findByRole('button', { name: /BRK-001 — Brake pad/ });
    // The job's number and both figures, as the server stated them, in the unit.
    expect(match).toHaveTextContent('WO-000042');
    expect(match).toHaveTextContent('4.000 EA');
    expect(match).toHaveTextContent('3.000 EA');
    expect(match).not.toHaveTextContent(ISSUE_ID);
    await user.click(match);
    await waitFor(() => expect(readReturnable).toHaveBeenCalledWith('part_issue', ISSUE_ID));
  });

  it('sends the chosen line, and with nothing chosen marks the picker instead of sending', async () => {
    const user = userEvent.setup();
    await partIssueKind(user);
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      warehouse.id
    );
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '1');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    expect(await screen.findByText(EN['inventory.returns.issue.required'] as string)).toBeTruthy();
    expect(createSalesReturn).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText(EN['inventory.returns.issue.label'] as string),
      'WO-42{Enter}'
    );
    await user.click(await screen.findByRole('button', { name: /BRK-001 — Brake pad/ }));
    await waitFor(() => expect(readReturnable).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    await waitFor(() => expect(createSalesReturn).toHaveBeenCalled());
    expect(createSalesReturn.mock.calls[0]?.[0]).toMatchObject({
      sourceKind: 'part_issue',
      sourceId: ISSUE_ID,
      quantity: '1',
    });
  });

  it('when the branch\u2019s issued parts are refused, puts the typed reference beside the refusal', async () => {
    listIssuedParts.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    const user = userEvent.setup();
    await partIssueKind(user);
    expect(screen.queryByLabelText(labelled('inventory.returns.source.id'))).toBeNull();
    await user.type(
      screen.getByLabelText(EN['inventory.returns.issue.label'] as string),
      'Brake{Enter}'
    );
    expect(await screen.findByText(EN['inventory.returns.issue.fallback'] as string)).toBeTruthy();
    const box = screen.getByLabelText(labelled('inventory.returns.source.id'));
    await user.type(box, ISSUE_ID);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.source.look'] as string })
    );
    await waitFor(() => expect(readReturnable).toHaveBeenCalledWith('part_issue', ISSUE_ID));
  });

  it('the typed reference is checked by the server’s own identifier rule, not a looser copy (route sweep B2 review)', async () => {
    listIssuedParts.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    const user = userEvent.setup();
    await partIssueKind(user);
    await user.type(
      screen.getByLabelText(EN['inventory.returns.issue.label'] as string),
      'Brake{Enter}'
    );
    const box = await screen.findByLabelText(labelled('inventory.returns.source.id'));
    // 8-4-4-4-12 hexadecimal, but neither a version nor a variant the route accepts.
    await user.type(box, 'abababab-abab-abab-abab-abababababab');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.source.look'] as string })
    );
    expect(await screen.findByText(EN['inventory.common.idFormat'] as string)).toBeTruthy();
    expect(readReturnable).not.toHaveBeenCalled();
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.create.receivedLocation')),
      warehouse.id
    );
    await user.type(screen.getByLabelText(labelled('inventory.returns.create.quantity')), '1');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.create.submit'] as string })
    );
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(createSalesReturn).not.toHaveBeenCalled();
  });

  it('a late reply is never drawn: not a search for an earlier term, and not what may come back for a part no longer chosen (route sweep B2 review)', async () => {
    const OTHER_ISSUE_ID = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    const otherPart = {
      ...issuedPart,
      id: OTHER_ISSUE_ID,
      item: { id: ITEM_ID, code: 'OIL-002', name: 'Oil filter' },
      quantity: '8.000',
      returnedQuantity: '1.000',
      returnableQuantity: '7.000',
    };
    const stale = {
      ...issuedPart,
      id: 'efefefef-efef-4fef-8fef-efefefefefef',
      item: { id: ITEM_ID, code: 'BRA-900', name: 'Bracket' },
    };
    const heldSearches: ((value: unknown) => void)[] = [];
    listIssuedParts.mockImplementation((_target: unknown, criteria: { q: string }) =>
      criteria.q === 'Bra'
        ? new Promise((resolve) => heldSearches.push(resolve))
        : Promise.resolve(
            okRead({
              items: [criteria.q === 'Oil' ? otherPart : issuedPart],
              nextCursor: null,
              hasMore: false,
            })
          )
    );
    const heldReturnable: ((value: unknown) => void)[] = [];
    readReturnable.mockImplementation((_kind: string, id: string) =>
      id === ISSUE_ID
        ? new Promise((resolve) => heldReturnable.push(resolve))
        : Promise.resolve(
            returnable({
              sourceKind: 'part_issue',
              sourceId: OTHER_ISSUE_ID,
              sourceQuantity: '8.000',
              returnedQuantity: '1.000',
              remainingQuantity: '7.000',
            })
          )
    );
    const user = userEvent.setup();
    await partIssueKind(user);
    const search = () => screen.getByLabelText(EN['inventory.returns.issue.label'] as string);

    // The search: the reply for "Bra" lands after the one for "Brake".
    await user.type(search(), 'Bra{Enter}');
    await waitFor(() => expect(heldSearches.length).toBeGreaterThan(0));
    await user.type(search(), 'ke{Enter}');
    expect(await screen.findByRole('button', { name: /BRK-001 — Brake pad/ })).toBeVisible();
    for (const resolve of heldSearches) {
      resolve(okRead({ items: [stale], nextCursor: null, hasMore: false }));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: /BRA-900/ })).toBeNull();

    // What may come back: the clerk changes their mind before the first answer arrives.
    await user.click(screen.getByRole('button', { name: /BRK-001 — Brake pad/ }));
    await waitFor(() => expect(heldReturnable).toHaveLength(1));
    await user.click(
      screen.getByRole('button', { name: EN['inventory.returns.issue.change'] as string })
    );
    await user.type(search(), 'Oil{Enter}');
    await user.click(await screen.findByRole('button', { name: /OIL-002 — Oil filter/ }));
    await waitFor(() => expect(screen.getAllByText('7.000').length).toBeGreaterThan(0));
    // The first part's answer lands last: it is not the part on the form.
    heldReturnable[0]?.(returnable({ sourceKind: 'part_issue', sourceId: ISSUE_ID }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('5.000')).toBeNull();
    expect(screen.queryByText('2.000')).toBeNull();
    expect(screen.getAllByText('7.000').length).toBeGreaterThan(0);
  });

  it('a reply about a sale line is not drawn once the clerk has switched to a part handed to a job (route sweep B3)', async () => {
    const held: ((value: unknown) => void)[] = [];
    readReturnable.mockImplementation(() => new Promise((resolve) => held.push(resolve)));
    const user = userEvent.setup();
    renderLtr(operable());
    await openBranch();
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.returns.sale.label')),
      SALE_ID
    );
    await user.selectOptions(
      await screen.findByLabelText(labelled('inventory.returns.sale.lineLabel')),
      SOURCE_ID
    );
    await waitFor(() => expect(held).toHaveLength(1));
    // The kind changes before the answer about the sale line arrives.
    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.returns.source.kind')),
      'part_issue'
    );
    held[0]?.(returnable());
    await new Promise((resolve) => setTimeout(resolve, 50));
    // None of the three figures of the sale line is shown under the new kind.
    expect(screen.queryByText('5.000')).toBeNull();
    expect(screen.queryByText('3.000')).toBeNull();
    expect(screen.queryByText(EN['inventory.returns.source.looking'] as string)).toBeNull();
  });
});

/**
 * DEF-T-07. The credit a return raised was named on this list and reachable
 * nowhere: nothing in the tenant navigation opened a credit note, so the second
 * person had nothing to approve.
 */
describe('reaching the credit a return raised', () => {
  it('links the waiting credit to the screen that shows it', async () => {
    listSalesReturns.mockResolvedValue(
      okPage([received({ creditNoteId: CREDIT_NOTE_ID, status: 'credited' })])
    );
    renderLtr(operable());
    await openBranch();
    const link = await screen.findByRole('link', {
      name: EN['inventory.returns.openCredit'] as string,
    });
    expect(link.getAttribute('href')).toBe(`/en/credit-notes?creditNoteId=${CREDIT_NOTE_ID}`);
  });

  it('offers no such link where no credit was raised', async () => {
    renderLtr(operable());
    await openBranch();
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.returnStatus.received'] as string)).toBeTruthy()
    );
    expect(
      screen.queryByRole('link', { name: EN['inventory.returns.openCredit'] as string })
    ).toBeNull();
  });
});

describe('a return being received and a branch switch', () => {
  /*
   * The return lands in this branch's locations and the form is keyed on the branch,
   * so a switch used to drop it without a word. It now asks first.
   */
  afterEach(forgetRememberedBranch);

  async function openTwoBranches(user: ReturnType<typeof userEvent.setup>) {
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          {operable()}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByRole('form', { name: EN['inventory.returns.create.heading'] as string });
  }
  const field = () =>
    within(
      screen.getByRole('form', { name: EN['inventory.returns.create.heading'] as string })
    ).getByLabelText(labelled('inventory.returns.create.quantity')) as HTMLInputElement;

  it('asks before switching; staying keeps what was typed and the branch', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), '1');
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(field().value).toBe('1');
  });

  it('discarding switches the branch and opens the form empty under it', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), '1');
    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await waitFor(() =>
      expect(listLocations.mock.lastCall?.[0]).toEqual({
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
});

describe('permissions and the route page', () => {
  it('offers no form without the permission to take a part back', async () => {
    renderLtr(
      <CustomerReturnsScreen locale="en" messages={en} canOperate={false} canReadBranches />
    );
    await openBranch();
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
    renderLtr(
      (await CustomerReturnsPage({
        params: Promise.resolve({ locale: 'en' }),
      })) as React.ReactElement
    );
    await openBranch();
    expect(await screen.findByText(EN['inventory.returns.needsOperate'] as string)).toBeTruthy();
  });
});

describe('accessibility and Arabic', () => {
  it('has no serious or critical accessibility finding', async () => {
    const user = userEvent.setup();
    const { container } = renderLtr(operable());
    await openBranch();
    await lookUpSource(user);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders right to left with its own words', () => {
    renderRtl(<CustomerReturnsScreen locale="ar" messages={ar} canOperate canReadBranches />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['inventory.returns.explain'] as string)).toBeTruthy();
  });
});
