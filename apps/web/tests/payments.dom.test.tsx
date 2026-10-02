import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { formatMoney } from '../src/lib/money';
import type { ReactElement } from 'react';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
  RETIRED_BOX,
  WorkingBranchProbe,
} from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { formatMessage, getMessages } from '@/i18n/get-messages';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
import { findSearchedOption } from './support/picker-option';

/*
 * The branch the receipts belong to is the working context's own named
 * selection — chosen once in the header, never typed on this screen (Owner
 * directive, `P1-32-PRE-OD-UX`). So a screen render goes inside a provider,
 * holding one branch unless a case says otherwise.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
// On the shared Material UI wrappers since the sales and finance slice
// (ADR-022): every render goes inside the Material foundation.
const renderLtr = (ui: ReactElement) => renderLtrBare(withMui(ui, 'en'));
const renderRtl = (ui: ReactElement) =>
  renderRtlBare(withMui(inBranch(ui, { locale: 'ar' }), 'ar'));

/**
 * Payments and receipts, rendered (P1-30, `W7`, FE-016, FE-017, FE-018,
 * FE-021).
 *
 * The properties under test: nothing is read until the working context names
 * one branch, both halves of that branch travel with every read, and no box
 * asks for a company or branch reference; the record form is offered only
 * with the recording code AND a method this tenant owns, and an organisation
 * with only platform methods is TOLD so rather than shown a choice the server
 * would refuse; one transport key per opened form, and a replay is stated as
 * the server's flag and never inferred from the key; the allocate form says an
 * entry cannot be undone BEFORE it is used, sends the receipt's own currency,
 * and reads the invoice balance afterwards because the echo does not carry it;
 * the receipt names its payer (browser QA row 5.6b) and says it holds no invoice
 * number or cashier; the printable copy names the payer, prints invoices by
 * reference and takes no figure of its own; and the route page decides before
 * it reads.
 *
 * On the shared Material UI wrappers since the sales and finance slice: the
 * receipts are a grid whose rows are opened with a pressed "Open" action, the
 * state filter is chips, the payer and the invoice are comboboxes whose matches
 * are options, amounts are money fields, and applying money asks first.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
const money = (amount: string, currency = 'USD') => formatMoney({ amount, currency }, 'en');

const listReceipts = vi.fn();
const readReceipt = vi.fn();
const listPaymentMethods = vi.fn();
const listBranches = vi.fn();
const readOutstanding = vi.fn();
const recordPayment = vi.fn();
const allocatePayment = vi.fn();
const readReceiptPayer = vi.fn();
const requestReceiptReversal = vi.fn();
const approveReceiptReversal = vi.fn();
const rejectReceiptReversal = vi.fn();
const withdrawReceiptReversal = vi.fn();
const recordReplacementReceipt = vi.fn();
vi.mock('@/features/payments/api', () => ({
  requestReceiptReversal: (...args: unknown[]) => requestReceiptReversal(...args),
  approveReceiptReversal: (...args: unknown[]) => approveReceiptReversal(...args),
  rejectReceiptReversal: (...args: unknown[]) => rejectReceiptReversal(...args),
  withdrawReceiptReversal: (...args: unknown[]) => withdrawReceiptReversal(...args),
  recordReplacementReceipt: (...args: unknown[]) => recordReplacementReceipt(...args),
  readReceiptPayer: (...args: unknown[]) => readReceiptPayer(...args),
  listReceipts: (...args: unknown[]) => listReceipts(...args),
  readReceipt: (...args: unknown[]) => readReceipt(...args),
  listPaymentMethods: (...args: unknown[]) => listPaymentMethods(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  readOutstanding: (...args: unknown[]) => readOutstanding(...args),
  recordPayment: (...args: unknown[]) => recordPayment(...args),
  allocatePayment: (...args: unknown[]) => allocatePayment(...args),
}));

// The payer and the invoice are FOUND, through the customer directory and the
// branch invoice list; both adapters are replaced here, never the pickers.
const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: (...args: unknown[]) => searchCustomerDirectory(...args),
}));
const listInvoices = vi.fn();
vi.mock('@/features/billing/api', () => ({
  listInvoices: (...args: unknown[]) => listInvoices(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'cashier@test.local' }),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { PaymentsScreen, __resetUncertainAllocationsForTests } =
  await import('@/features/payments/components/PaymentsScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const PaymentsPage = (await import('@/app/[locale]/(dashboard)/payments/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const PARTNER_ID = '55555555-5555-4555-8555-555555555555';
const METHOD_ID = '66666666-6666-4666-8666-666666666666';
const ALLOCATION_ID = '88888888-8888-4888-8888-888888888888';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tenantMethod = {
  id: METHOD_ID,
  scope: 'tenant',
  methodCode: 'cash',
  kind: 'cash',
  displayName: 'Front desk cash',
  status: 'active',
  recordable: true,
};
const platformMethod = {
  id: '77777777-7777-4777-8777-777777777777',
  scope: 'platform',
  methodCode: 'cash',
  kind: 'cash',
  displayName: 'Cash',
  status: 'active',
  recordable: false,
};

const receipt = {
  id: RECEIPT_ID,
  reference: 'RCT-000007',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  payerPartnerId: PARTNER_ID,
  method: {
    id: METHOD_ID,
    scope: 'tenant',
    kind: 'cash',
    displayName: 'Front desk cash',
    status: 'active',
  },
  money: { amount: '100.0000', currency: 'USD' },
  unallocated: { amount: '40.0000', currency: 'USD' },
  status: 'partially_allocated',
  receivedAt: '2026-09-05T09:00:00.000Z',
  evidenceDocumentVersionId: null,
  recordVersion: 1,
  // The list names the payer beside the id, for a caller who may read customers.
  payer: { displayName: 'Layla Haddad', displayNumber: 'C-000482', partyType: 'individual' },
};

const detail = (over: Record<string, unknown> = {}) => ({
  ...receipt,
  allocations: [
    {
      id: ALLOCATION_ID,
      sequence: '1',
      invoiceId: INVOICE_ID,
      // The receipt read names the invoice beside its id (finance retest DF-R2-2).
      invoiceNumber: 'INV-000123',
      invoicePayerName: 'Layla Haddad',
      money: { amount: '60.0000', currency: 'USD' },
      allocatedAt: '2026-09-05T09:05:00.000Z',
    },
  ],
  allocationsTruncated: false,
  // ADR-023 D4: nobody asked to reverse it, and it replaces none.
  reversal: null,
  replaces: null,
  replacedBy: null,
  ...over,
});

const okRead = (data: unknown) => ({ status: 'ok', data, correlationId: 'corr-1' });

const customerHit = {
  id: PARTNER_ID,
  displayNumber: 'C-000482',
  displayName: 'Layla Haddad',
  partyType: 'individual',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  primaryPhone: null,
  phoneMasked: false,
  vehicleCount: 1,
};

const invoiceEntry = {
  id: INVOICE_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  workOrderId: null,
  saleKind: 'work_order',
  quotationRevisionId: null,
  payerPartnerId: PARTNER_ID,
  currency: 'USD',
  status: 'issued',
  invoiceNumber: 'INV-000123',
  issuedAt: '2026-09-04T09:00:00.000Z',
  recordVersion: 2,
  totals: null,
  payer: { displayName: 'Layla Haddad', displayNumber: 'C-000482', partyType: 'individual' },
  outstanding: { amount: '40.0000', currency: 'USD' },
};
const refusedRead = (status: string, correlationId = 'corr-403') => ({ status, correlationId });
const okPage = (rows: readonly unknown[]) => ({
  status: 'ok',
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-1',
});

/*
 * The allocation attempts whose answer was lost live in module memory beyond a
 * mounted screen (M-09), so no test may inherit another's. Cleared before each
 * test as well as after, so late work from a previous test cannot leak in.
 */
afterEach(() => __resetUncertainAllocationsForTests());

beforeEach(() => {
  __resetUncertainAllocationsForTests();
  vi.clearAllMocks();
  PERMISSIONS = [];
  listReceipts.mockResolvedValue(okPage([receipt]));
  readReceiptPayer.mockResolvedValue({
    displayName: 'Layla Haddad',
    displayNumber: 'C-000482',
    partyType: 'individual',
  });
  readReceipt.mockResolvedValue(okRead(detail()));
  listPaymentMethods.mockResolvedValue(okRead({ items: [tenantMethod, platformMethod] }));
  listBranches.mockResolvedValue(okRead({ items: [] }));
  searchCustomerDirectory.mockResolvedValue({
    status: 'ok',
    rows: [customerHit],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-c',
  });
  listInvoices.mockResolvedValue(
    okRead({ items: [invoiceEntry], nextCursor: null, hasMore: false })
  );
  readOutstanding.mockResolvedValue(
    okRead({
      invoiceId: INVOICE_ID,
      status: 'issued',
      outstanding: { amount: '40.0000', currency: 'USD' },
      isSettled: false,
    })
  );
  recordPayment.mockResolvedValue({
    state: { status: 'success', messageKey: 'payments.record.success', attempt: 1 },
    created: {
      id: RECEIPT_ID,
      reference: 'RCT-000007',
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      paymentMethodId: METHOD_ID,
      payerPartnerId: PARTNER_ID,
      money: { amount: '100.0000', currency: 'USD' },
      status: 'recorded',
      receivedAt: '2026-09-05T09:00:00.000Z',
      recordVersion: 1,
      replayed: false,
    },
  });
  allocatePayment.mockResolvedValue({
    state: { status: 'success', messageKey: 'payments.allocate.success', attempt: 1 },
    created: {
      id: 'alloc-2',
      sequence: '2',
      receiptId: RECEIPT_ID,
      invoiceId: INVOICE_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      money: { amount: '40.0000', currency: 'USD' },
      allocatedAt: '2026-09-05T09:10:00.000Z',
      receiptStatus: 'allocated',
      receiptUnallocated: { amount: '0.0000', currency: 'USD' },
    },
  });
});

function screenFor(over: Record<string, unknown> = {}) {
  return (
    <PaymentsScreen
      locale="en"
      messages={en}
      initialReceiptId={null}
      initialInvoiceId={null}
      canRecord={true}
      canAllocate={true}
      canReadCustomers={true}
      canListInvoices={true}
      {...over}
    />
  );
}

function renderScreen(
  over: Record<string, unknown> = {},
  snapshot: ReturnType<typeof branchSnapshot> = branchSnapshot()
) {
  return renderLtr(inBranch(screenFor(over), { snapshot }));
}

/**
 * The working branch, as the screen states it.
 *
 * It used to be CHOSEN here — two references typed and a submit pressed —
 * which is what opened every other panel. The header holds it now, so this
 * only confirms the screen is addressed to it; kept as a step so the
 * cases that named a branch read the same.
 */
async function chooseBranch() {
  expect(await screen.findByTestId('payments-branch-target')).toHaveTextContent(TEST_BRANCH.name);
}

/**
 * The payer, found by name and chosen — the way an operator names one now.
 * `label` is the picker's own question, so the same helper serves the record
 * form, the list filter and the Arabic screen.
 */
async function choosePayer(
  user: ReturnType<typeof userEvent.setup>,
  form: HTMLElement,
  label: RegExp = labelled('payments.record.payer')
) {
  await user.type(within(form).getByLabelText(label), 'Layla');
  await user.click(await findSearchedOption(searchCustomerDirectory, 'Layla', /Layla Haddad/));
}

/** The invoice, found by its number among the receipt branch's invoices and chosen. */
async function chooseInvoice(
  user: ReturnType<typeof userEvent.setup>,
  form: HTMLElement,
  label: RegExp = labelled('payments.allocate.invoice')
) {
  await user.type(within(form).getByLabelText(label), 'INV-0001');
  await user.click(await findSearchedOption(listInvoices, 'INV-0001', /INV-000123/));
}

/** A combobox's text: the chosen record's name once one is chosen. */
const valueOf = (element: HTMLElement) => (element as HTMLInputElement).value;

/** The payer and invoice filters, beside the state chips. */
const pickerFilters = () =>
  screen.getByRole('group', { name: EN['payments.list.moreFilters'] as string });

/** A receipt row's own action: "Open", named by the receipt it opens. */
const OPEN_RECEIPT = `${EN['payments.list.open']} RCT-000007`;

/** The allocation question, answered: nothing is applied before it. */
async function confirmApply(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('alertdialog', {
    name: EN['payments.allocate.confirmTitle'] as string,
  });
  expect(allocatePayment).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole('button', { name: EN['payments.allocate.submit'] as string })
  );
}

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await PaymentsPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

describe('nothing is read until the working context names one branch', () => {
  it('with several branches and none chosen, asks for one right there and reads nothing', () => {
    renderScreen({}, branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    expect(screen.getByText(EN['payments.target.explain'] as string)).toBeVisible();
    // The branch section offers the named branches, so it says to choose here.
    expect(screen.getByText(EN['workingContext.chooseBranchHere'] as string)).toBeVisible();
    expect(screen.getByTestId('concrete-branch-chooser')).toHaveValue('');
    expect(listReceipts).not.toHaveBeenCalled();
    expect(readReceipt).not.toHaveBeenCalled();
    expect(listPaymentMethods).not.toHaveBeenCalled();
  });

  it('sends BOTH halves of the working branch to the list, without being asked', async () => {
    renderScreen();
    await waitFor(() => expect(listReceipts).toHaveBeenCalled());
    expect(listReceipts.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
  });

  it('names the branch and offers no box to type a company or branch reference into', async () => {
    renderScreen();
    await chooseBranch();
    expect(screen.queryByLabelText(RETIRED_BOX.en.company)).toBeNull();
    expect(screen.queryByLabelText(RETIRED_BOX.en.branch)).toBeNull();
    // The directory read is not how the branch is found any more.
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('with no branch authorized, says so and reads nothing', () => {
    renderScreen({}, branchSnapshot([], 'none'));
    expect(screen.getByText(EN['workingContext.noBranch'] as string)).toBeVisible();
    expect(listReceipts).not.toHaveBeenCalled();
  });

  it('a different branch re-reads under its own name and closes the previous branch’s receipt', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          {screenFor()}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(await within(list).findByRole('button', { name: OPEN_RECEIPT }));
    await waitFor(() => expect(readReceipt).toHaveBeenCalledWith(RECEIPT_ID));
    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() =>
      expect(listReceipts.mock.lastCall?.[0]).toEqual({
        companyId: OTHER_BRANCH.companyId,
        branchId: OTHER_BRANCH.id,
      })
    );
    expect(
      screen.queryByRole('region', { name: EN['payments.receipt.heading'] as string })
    ).toBeNull();
  });
});

describe('a half-filled form and a branch switch', () => {
  afterEach(forgetRememberedBranch);
  /*
   * The record panel is keyed on the branch, so a switch used to drop a
   * half-filled payment without a word — and the next one typed would go to a
   * different branch's cash. The form now declares its unsaved work, and the
   * switch asks.
   */
  async function openTwoBranches(user: ReturnType<typeof userEvent.setup>) {
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          {screenFor()}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    return screen.findByRole('form', { name: EN['payments.record.formLabel'] as string });
  }

  const amountBox = () =>
    within(
      screen.getByRole('form', { name: EN['payments.record.formLabel'] as string })
    ).getByLabelText(labelled('payments.record.amount')) as HTMLInputElement;

  it('asks before switching; staying keeps the typed amount and the branch', async () => {
    const user = userEvent.setup();
    const form = await openTwoBranches(user);
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '25.0000');
    const dialog = await switchExpectingQuestion(user, 'second');
    await stayOnBranch(user, dialog);
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(amountBox().value).toBe('25.0000');
    expect(listReceipts.mock.lastCall?.[0]).toEqual({
      companyId: TEST_BRANCH.companyId,
      branchId: TEST_BRANCH.id,
    });
  });

  it('discarding switches the branch and opens the form empty under it', async () => {
    const user = userEvent.setup();
    const form = await openTwoBranches(user);
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '25.0000');
    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await screen.findByRole('form', { name: EN['payments.record.formLabel'] as string });
    expect(amountBox().value).toBe('');
    await waitFor(() =>
      expect(listReceipts.mock.lastCall?.[0]).toEqual({
        companyId: OTHER_BRANCH.companyId,
        branchId: OTHER_BRANCH.id,
      })
    );
  });

  it('an untouched form switches without asking', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });

  it('a half-typed allocation asks too, because the switch closes the receipt', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    const list = await screen.findByRole('region', { name: EN['payments.list.heading'] as string });
    await user.click(await within(list).findByRole('button', { name: OPEN_RECEIPT }));
    const allocate = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, allocate);
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(
      valueOf(within(allocate).getByLabelText(labelled('payments.allocate.invoice')))
    ).toContain('INV-000123');
  });

  it('a chosen payer asks too, and staying keeps the choice', async () => {
    const user = userEvent.setup();
    const form = await openTwoBranches(user);
    await choosePayer(user, form);
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(valueOf(within(form).getByLabelText(labelled('payments.record.payer')))).toContain(
      'Layla Haddad'
    );
  });

  it('discarding a chosen payer switches the branch and leaves the picker empty', async () => {
    const user = userEvent.setup();
    const form = await openTwoBranches(user);
    await choosePayer(user, form);
    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    const reopened = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    expect(within(reopened).getByLabelText(labelled('payments.record.payer'))).toHaveValue('');
    // Nothing is left to lose, so the next switch does not ask.
    await switchWithoutQuestion(user, 'first');
    await waitFor(() => expect(heldBranch()).toBe(TEST_BRANCH.id));
  });

  it('a list filter chosen by name is not unsaved work: the switch does not ask', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    const filters = pickerFilters();
    await choosePayer(user, filters, labelled('payments.list.payerFilter'));
    await chooseInvoice(user, filters, labelled('payments.list.invoiceFilter'));
    expect(
      valueOf(within(filters).getByLabelText(labelled('payments.list.invoiceFilter')))
    ).toContain('INV-000123');
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });
});

describe('the receipts of the branch', () => {
  it('renders the server’s strings and computes no figure of its own', async () => {
    renderScreen();
    await chooseBranch();
    const region = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    const grid = within(region).getByRole('grid', { name: EN['payments.list.caption'] as string });
    expect(
      await within(grid).findByText('RCT-000007', { selector: 'span.font-mono' })
    ).toBeVisible();
    expect(within(grid).getByText(money('100.0000'))).toBeVisible();
    expect(within(grid).getByText(money('40.0000'))).toBeVisible();
    // The same word is a CHIP in the state filter, so the row is asserted
    // inside the grid rather than anywhere in the panel.
    expect(
      within(grid).getByText(EN['payments.status.partially_allocated'] as string)
    ).toBeVisible();
    // The payer by name (browser QA row 5.6b), never by the reference.
    expect(within(grid).getByText('Layla Haddad')).toBeVisible();
    expect(region.textContent).not.toContain(PARTNER_ID);
  });

  it('a payer the server does not name for this reader is said not to be shown, never printed as a reference', async () => {
    listReceipts.mockResolvedValue(
      okPage([{ ...receipt, payer: { displayName: null, displayNumber: null, partyType: null } }])
    );
    renderScreen({ canReadCustomers: false });
    await chooseBranch();
    const region = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    const grid = within(region).getByRole('grid');
    expect(
      await within(grid).findByText(EN['payments.list.payerNotShown'] as string)
    ).toBeVisible();
    expect(region.textContent).not.toContain(PARTNER_ID);
  });

  it('opens a receipt with its row’s own action, pressed on the receipt that is open', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    const open = await within(list).findByRole('button', { name: OPEN_RECEIPT });
    expect(open).toHaveAttribute('aria-pressed', 'false');
    await user.click(open);
    await waitFor(() => expect(readReceipt).toHaveBeenCalledWith(RECEIPT_ID));
    await waitFor(() =>
      expect(within(list).getByRole('button', { name: OPEN_RECEIPT })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
  });

  it('states that the list takes no date range', async () => {
    renderScreen();
    await chooseBranch();
    expect(await screen.findByText(EN['payments.list.noDateFilter'] as string)).toBeVisible();
  });

  it('passes the filters it was given, and only those', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await waitFor(() => expect(listReceipts).toHaveBeenCalled());
    // A payer chosen by name applies as it is chosen: a new read, nothing more.
    await choosePayer(user, pickerFilters(), labelled('payments.list.payerFilter'));
    await waitFor(() =>
      expect(listReceipts.mock.calls.at(-1)?.[1]).toEqual({
        payerPartnerId: PARTNER_ID,
        status: null,
        invoiceId: null,
      })
    );
    // A state is a chip, and applies as it is pressed, beside the payer.
    const chips = screen.getByRole('group', { name: EN['payments.list.statusFilter'] as string });
    await user.click(
      within(chips).getByRole('button', { name: EN['payments.status.allocated'] as string })
    );
    await waitFor(() =>
      expect(listReceipts.mock.calls.at(-1)?.[1]).toEqual({
        payerPartnerId: PARTNER_ID,
        status: 'allocated',
        invoiceId: null,
      })
    );
  });

  it('filters by an invoice FOUND among the branch’s invoices, never typed', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await waitFor(() => expect(listReceipts).toHaveBeenCalled());
    await chooseInvoice(user, pickerFilters(), labelled('payments.list.invoiceFilter'));
    // The filter searches the list's own branch, in any state.
    expect(listInvoices.mock.calls.at(-1)?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    expect(listInvoices.mock.calls.at(-1)?.[1]).toEqual({
      q: 'INV-0001',
      status: undefined,
      allocatable: false,
    });
    await waitFor(() => expect(listReceipts.mock.calls.at(-1)?.[1]?.invoiceId).toBe(INVOICE_ID));
  });

  it('keeps the operator’s filters when a write re-reads the list', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await waitFor(() => expect(listReceipts).toHaveBeenCalled());
    await choosePayer(user, pickerFilters(), labelled('payments.list.payerFilter'));
    await waitFor(() =>
      expect(listReceipts.mock.calls.at(-1)?.[1]?.payerPartnerId).toBe(PARTNER_ID)
    );

    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '10.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    await waitFor(() => expect(recordPayment).toHaveBeenCalled());
    // The write re-reads the list; it must not silently discard the filter the
    // operator applied, nor the typed value that produced it.
    await waitFor(() =>
      expect(listReceipts.mock.calls.at(-1)?.[1]?.payerPartnerId).toBe(PARTNER_ID)
    );
    expect(
      valueOf(within(pickerFilters()).getByLabelText(labelled('payments.list.payerFilter')))
    ).toContain('Layla Haddad');
  });

  it('says a withdrawn method is withdrawn rather than leaving a blank', async () => {
    listReceipts.mockResolvedValue(okPage([{ ...receipt, method: null }]));
    renderScreen();
    await chooseBranch();
    expect(await screen.findByText(EN['payments.list.methodGone'] as string)).toBeVisible();
  });

  it('renders a refused list as a refusal, not as an empty branch', async () => {
    listReceipts.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-403',
    });
    renderScreen();
    await chooseBranch();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['payments.list.empty'] as string)).toBeNull();
  });

  it('says when the branch holds no receipt', async () => {
    listReceipts.mockResolvedValue(okPage([]));
    renderScreen();
    await chooseBranch();
    expect(await screen.findByText(EN['payments.list.empty'] as string)).toBeVisible();
  });
});

describe('recording a payment', () => {
  it('offers the form only with the recording code', async () => {
    renderScreen({ canRecord: false });
    await chooseBranch();
    expect(await screen.findByText(EN['payments.record.needsCode'] as string)).toBeVisible();
    expect(listPaymentMethods).not.toHaveBeenCalled();
  });

  it('offers only the methods this tenant may cite', async () => {
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    const options = within(form)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toContain(METHOD_ID);
    expect(options).not.toContain(platformMethod.id);
  });

  it('says an organisation with only platform methods cannot record, and offers no form', async () => {
    listPaymentMethods.mockResolvedValue(okRead({ items: [platformMethod] }));
    renderScreen();
    await chooseBranch();
    expect(await screen.findByText(EN['payments.methods.noneRecordable'] as string)).toBeVisible();
    expect(
      screen.queryByRole('form', { name: EN['payments.record.formLabel'] as string })
    ).toBeNull();
  });

  it('says a refused method list is a refusal, and offers no form', async () => {
    listPaymentMethods.mockResolvedValue(refusedRead('denied'));
    renderScreen();
    await chooseBranch();
    expect(await screen.findByText(EN['payments.methods.refused'] as string)).toBeVisible();
    expect(screen.getByText('corr-403')).toBeVisible();
    expect(
      screen.queryByRole('form', { name: EN['payments.record.formLabel'] as string })
    ).toBeNull();
  });

  it('sends the branch target and the typed amount as a string, with one key', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'usd');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '100.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    await waitFor(() => expect(recordPayment).toHaveBeenCalled());
    expect(recordPayment.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      paymentMethodId: METHOD_ID,
      payerPartnerId: PARTNER_ID,
      currency: 'USD',
      amount: '100.0000',
    });
    expect(String(recordPayment.mock.calls[0]?.[1])).toMatch(UUID_SHAPE);
  });

  it('shows the currency refusal beside the currency box, with the amount still typed', async () => {
    // What the service publishes for a currency it cannot read, as the adapter
    // files it: under `currency`, the control this form draws.
    recordPayment.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { currency: 'form.violation.invalid_string' },
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '100.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['form.violation.invalid_string'] as string)
    ).toBeVisible();
    // Nothing the cashier typed was thrown away by the refusal.
    expect(
      (within(form).getByLabelText(labelled('payments.record.amount')) as HTMLInputElement).value
    ).toBe('100.0000');
    expect(
      (within(form).getByLabelText(labelled('payments.record.currency')) as HTMLInputElement).value
    ).toBe('USD');
  });

  it('refuses a malformed amount before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '-5');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    expect(await screen.findByText(EN['payments.common.amountFormat'] as string)).toBeVisible();
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('states a replay as "already recorded", not as a second receipt', async () => {
    recordPayment.mockResolvedValue({
      state: { status: 'success', messageKey: 'payments.record.success', attempt: 1 },
      created: {
        id: RECEIPT_ID,
        reference: 'RCT-000007',
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        paymentMethodId: METHOD_ID,
        payerPartnerId: PARTNER_ID,
        money: { amount: '100.0000', currency: 'USD' },
        status: 'recorded',
        receivedAt: '2026-09-05T09:00:00.000Z',
        recordVersion: 1,
        replayed: true,
      },
    });
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '100.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    expect(
      await screen.findByText(EN['payments.record.replayed'] as string, { exact: false })
    ).toBeVisible();
    expect(
      screen.queryByText(EN['payments.record.recorded'] as string, { exact: false })
    ).toBeNull();
  });

  it('states a fresh recording as recorded, with the receipt’s reference', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '100.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    const notice = await screen.findByText(EN['payments.record.recorded'] as string, {
      exact: false,
    });
    expect(within(notice).getByText('RCT-000007')).toBeVisible();
  });

  it('lets a cashier record a SECOND payment after the first succeeds', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const fill = async () => {
      const form = await screen.findByRole('form', {
        name: EN['payments.record.formLabel'] as string,
      });
      await choosePayer(user, form);
      await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
      await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '10.0000');
      await user.click(
        within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
      );
    };
    await fill();
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    // The form must come back usable: an empty draft, a fresh key, and a
    // button that is not still busy from the payment that succeeded.
    await fill();
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2));
    expect(recordPayment.mock.calls[1]?.[1]).not.toBe(recordPayment.mock.calls[0]?.[1]);
  });

  it('refuses a zero amount before sending, because the server refuses it too', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '0');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    expect(await screen.findByText(EN['payments.common.amountFormat'] as string)).toBeVisible();
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('a second opened form carries a different key than the first', async () => {
    recordPayment.mockResolvedValue({
      state: {
        status: 'unavailable',
        messageKey: 'state.unavailable.title',
        attempt: 1,
        correlationId: 'r',
      },
      created: null,
    });
    const user = userEvent.setup();
    const fill = async () => {
      const form = await screen.findByRole('form', {
        name: EN['payments.record.formLabel'] as string,
      });
      await choosePayer(user, form);
      await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
      await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '10.0000');
      await user.click(
        within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
      );
    };
    const first = renderScreen();
    await chooseBranch();
    await fill();
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    first.unmount();
    renderScreen();
    await chooseBranch();
    await fill();
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2));
    expect(recordPayment.mock.calls[1]?.[1]).not.toBe(recordPayment.mock.calls[0]?.[1]);
  });
});

describe('the payer is found by name, and the form says when it cannot be', () => {
  it('asks the directory for the typed words and names the customer it chose', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    // No box on this form asks for a partner reference any more.
    expect(within(form).queryByDisplayValue(UUID_SHAPE)).toBeNull();
    await choosePayer(user, form);
    expect(searchCustomerDirectory.mock.calls.at(-1)?.[2]).toEqual({ q: 'Layla' });
    expect(within(form).getByLabelText(labelled('payments.record.payer'))).toHaveValue(
      'Layla Haddad — C-000482'
    );
  });

  it('still names the payer when the directory answers well after the search pause', async () => {
    // A loaded runner once spent the default one-second wait on the pause, the
    // read and the render, and a correct screen failed (PR #485). The answer is
    // held back past that second here, so the picker helper must wait for the
    // search to be asked and answered rather than for a fixed interval.
    const answer = {
      status: 'ok',
      rows: [customerHit],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-slow',
    };
    searchCustomerDirectory.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(answer), 1_500))
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form);
    expect(within(form).getByLabelText(labelled('payments.record.payer'))).toHaveValue(
      'Layla Haddad — C-000482'
    );
  });

  it('marks the payer, moves the cursor there, and stops complaining once one is chosen', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '10.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    const box = within(form).getByLabelText(labelled('payments.record.payer'));
    expect(
      await within(form).findByText(EN['payments.record.payerRequired'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(recordPayment).not.toHaveBeenCalled();
    // What was typed elsewhere survives the refusal.
    expect(within(form).getByLabelText(labelled('payments.record.amount'))).toHaveValue('10.0000');

    await choosePayer(user, form);
    expect(within(form).queryByText(EN['payments.record.payerRequired'] as string)).toBeNull();
  });

  it('with the customer read offers no reference box at all', async () => {
    renderScreen();
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    expect(within(form).queryByLabelText(labelled('payments.record.payerReference'))).toBeNull();
  });

  it('without the customer read a recorder STILL records, through the labelled payer reference', async () => {
    // `sal.payment-record` declares the recording and finance codes only, so a
    // recorder without `crm.customer.read` must not lose the payment the server
    // accepts from them.
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: false });
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    expect(within(form).queryByRole('searchbox')).toBeNull();
    expect(
      within(form).getByText(EN['payments.record.payerReferenceHelp'] as string)
    ).toBeVisible();
    const submit = within(form).getByRole('button', {
      name: EN['payments.record.submit'] as string,
    });
    expect(submit).toBeEnabled();

    const box = within(form).getByLabelText(labelled('payments.record.payerReference'));
    await user.type(box, 'not-a-reference');
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '10.0000');
    await user.click(submit);
    expect(
      await within(form).findByText(EN['payments.record.payerReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(recordPayment).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, PARTNER_ID);
    await user.click(submit);
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    expect(recordPayment.mock.calls[0]?.[0]).toMatchObject({
      payerPartnerId: PARTNER_ID,
      currency: 'USD',
      amount: '10.0000',
    });
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('a typed payer reference is unsaved work: a branch switch asks first', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          {screenFor({ canReadCustomers: false })}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('payments.record.payerReference')),
      PARTNER_ID
    );
    try {
      await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
      expect(heldBranch()).toBe(TEST_BRANCH.id);
    } finally {
      forgetRememberedBranch();
    }
  });
});

/**
 * Eight-four-four-four-twelve hexadecimal, and still not an identifier the server
 * accepts: the third group has no RFC version digit and the fourth no variant, so
 * `z.string().uuid()` refuses it. The boxes must refuse it too, on the box.
 */
const HEX_BUT_NOT_UUID = '12345678-1234-0234-7234-123456789abc';

describe('without the customer read: the typed payer boxes', () => {
  it('the receipt list keeps a labelled, shape-checked payer reference as its filter', async () => {
    // `sal.receipt-list` accepts a payer with `sal.finance.view` alone, and the
    // filter was a typed box before the pickers: a finance viewer without
    // `crm.customer.read` must not lose it.
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: false });
    await chooseBranch();
    await waitFor(() => expect(listReceipts).toHaveBeenCalled());
    const filters = pickerFilters();
    expect(within(filters).queryByTestId('payments-payer-filter')).toBeNull();
    expect(
      within(filters).getByText(EN['payments.list.payerReferenceHelp'] as string)
    ).toBeVisible();
    const box = within(filters).getByLabelText(labelled('payments.list.payerReference'));
    const apply = within(filters).getByRole('button', {
      name: EN['payments.list.apply'] as string,
    });
    const readsBefore = listReceipts.mock.calls.length;

    await user.type(box, HEX_BUT_NOT_UUID);
    await user.click(apply);
    expect(
      await within(filters).findByText(EN['payments.record.payerReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    // Nothing was applied: the list was not re-read under a filter it ignored.
    expect(listReceipts.mock.calls.length).toBe(readsBefore);

    await user.clear(box);
    expect(
      within(filters).queryByText(EN['payments.record.payerReferenceFormat'] as string)
    ).toBeNull();
    await user.type(box, PARTNER_ID);
    await user.click(apply);
    await waitFor(() =>
      expect(listReceipts.mock.calls.at(-1)?.[1]).toEqual({
        payerPartnerId: PARTNER_ID,
        status: null,
        invoiceId: null,
      })
    );
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('a typed filter reference is not unsaved work: the switch does not ask', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          {screenFor({ canReadCustomers: false })}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByRole('region', { name: EN['payments.list.heading'] as string });
    await user.type(
      within(pickerFilters()).getByLabelText(labelled('payments.list.payerReference')),
      PARTNER_ID
    );
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });

  it('the record form refuses a reference the server would refuse, on the box', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: false });
    await chooseBranch();
    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    const box = within(form).getByLabelText(labelled('payments.record.payerReference'));
    await user.type(box, HEX_BUT_NOT_UUID);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '10.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['payments.record.payerReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(recordPayment).not.toHaveBeenCalled();
  });
});

describe('an invoice whose payer is withheld', () => {
  it('is chosen by its number and says the customer is not shown, never a blank', async () => {
    // A finance viewer without `crm.customer.read` is sent the payer block with
    // every field null; the choice names the invoice and says so.
    listInvoices.mockResolvedValue(
      okRead({
        items: [
          {
            ...invoiceEntry,
            payer: { displayName: null, displayNumber: null, partyType: null },
          },
        ],
        nextCursor: null,
        hasMore: false,
      })
    );
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: false });
    await chooseBranch();
    const filters = pickerFilters();
    await chooseInvoice(user, filters, labelled('payments.list.invoiceFilter'));
    const chosen = valueOf(within(filters).getByLabelText(labelled('payments.list.invoiceFilter')));
    expect(chosen).toContain('INV-000123');
    expect(chosen).toContain(EN['invoices.picker.payerHidden'] as string);
    expect(chosen).not.toContain('Layla');
  });
});

describe('the receipt and its allocations', () => {
  async function openReceipt(user: ReturnType<typeof userEvent.setup>) {
    renderScreen();
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(within(list).getByRole('button', { name: OPEN_RECEIPT }));
    return screen.findByRole('region', { name: EN['payments.receipt.heading'] as string });
  }

  it('opens a receipt named in the address without asking for a branch first', async () => {
    // The detail read names its receipt in the PATH and takes no target, so a
    // link into one must not wait for a branch to be chosen.
    // Two branches and none chosen: no list may be read, and the receipt opens.
    renderScreen({ initialReceiptId: RECEIPT_ID }, branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    await waitFor(() => expect(readReceipt).toHaveBeenCalledWith(RECEIPT_ID));
    expect(
      await screen.findByRole('region', { name: EN['payments.receipt.heading'] as string })
    ).toBeVisible();
    expect(listReceipts).not.toHaveBeenCalled();
  });

  it('a confirmed discard empties the allocation amount on a receipt the first branch choice keeps open', async () => {
    /*
     * A receipt named in the address survives the FIRST choice of a branch —
     * that choice is what its reads were waiting for, not a move away from it.
     * So nothing closes the allocation form, and the amount typed before the
     * question has to be emptied by the discard itself.
     */
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <WorkingBranchProbe />
          {screenFor({ initialReceiptId: RECEIPT_ID })}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    const amount = () => within(form).getByLabelText(labelled('payments.allocate.amount'));
    try {
      await user.type(amount(), '10.0000');
      await discardAndSwitch(user, await switchExpectingQuestion(user, 'first'));
      await waitFor(() => expect(heldBranch()).toBe(TEST_BRANCH.id));
      // The receipt is still open, and its form is empty.
      expect(
        screen.getByRole('region', { name: EN['payments.receipt.heading'] as string })
      ).toBeVisible();
      await waitFor(() => expect(amount()).toHaveValue(''));
      expect(allocatePayment).not.toHaveBeenCalled();
    } finally {
      forgetRememberedBranch();
    }
  });

  it('renders the receipt’s figures and its allocation history', async () => {
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText(money('100.0000'))).toBeVisible();
    expect(within(region).getByText(money('40.0000'))).toBeVisible();
    expect(within(region).getByText(money('60.0000'))).toBeVisible();
    // Named by its number and the customer it bills — never by a reference.
    const named = within(region).getByTestId('receipt-allocation-invoice');
    expect(named).toHaveTextContent('INV-000123');
    expect(named).toHaveTextContent('Layla Haddad');
    expect(region.textContent).not.toContain(INVOICE_ID);
    expect(region.textContent).not.toContain(ALLOCATION_ID);
  });

  it('names the payer, asked of the receipt list in the receipt’s own branch, and says there is no cashier', async () => {
    const user = userEvent.setup();
    const region = await openReceipt(user);
    // The payer's own row (the allocation below names the customer it billed too).
    const payerRow = within(region).getByText(EN['payments.receipt.payer'] as string)
      .parentElement as HTMLElement;
    expect(await within(payerRow).findByText('Layla Haddad')).toBeVisible();
    expect(readReceiptPayer).toHaveBeenCalledWith(
      { companyId: COMPANY_ID, branchId: BRANCH_ID },
      PARTNER_ID
    );
    expect(region.textContent).not.toContain(PARTNER_ID);
    expect(within(region).getByText(EN['payments.receipt.noCashier'] as string)).toBeVisible();
  });

  it('without the customer read asks for no name, and says the payer is not shown', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: false });
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(await within(list).findByRole('button', { name: OPEN_RECEIPT }));
    const region = await screen.findByRole('region', {
      name: EN['payments.receipt.heading'] as string,
    });
    expect(
      await within(region).findByText(EN['payments.list.payerNotShown'] as string)
    ).toBeVisible();
    expect(readReceiptPayer).not.toHaveBeenCalled();
    expect(region.textContent).not.toContain(PARTNER_ID);
  });

  it('says a truncated history is truncated', async () => {
    readReceipt.mockResolvedValue(okRead(detail({ allocationsTruncated: true })));
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText(EN['payments.allocations.truncated'] as string)).toBeVisible();
  });

  it('says a refused receipt is a refusal with its reference', async () => {
    readReceipt.mockResolvedValue(refusedRead('denied'));
    const user = userEvent.setup();
    await openReceipt(user);
    expect(await screen.findByText(EN['payments.receipt.denied'] as string)).toBeVisible();
    expect(screen.getByText('corr-403')).toBeVisible();
  });

  it('says a receipt that is not there is not there, not that access was denied', async () => {
    readReceipt.mockResolvedValue(refusedRead('not-found', 'corr-404'));
    const user = userEvent.setup();
    await openReceipt(user);
    expect(await screen.findByText(EN['payments.receipt.notFound'] as string)).toBeVisible();
  });
});

describe('applying a receipt to an invoice', () => {
  async function openReceipt(user: ReturnType<typeof userEvent.setup>, over = {}) {
    renderScreen(over);
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(within(list).getByRole('button', { name: OPEN_RECEIPT }));
    return screen.findByRole('region', { name: EN['payments.receipt.heading'] as string });
  }

  async function apply(user: ReturnType<typeof userEvent.setup>, amount: string) {
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, form);
    await user.type(
      within(form).getByLabelText(new RegExp(escape(EN['payments.allocate.amount'] as string))),
      amount
    );
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    await confirmApply(user);
  }

  it('warns that an entry cannot be undone BEFORE it is used', async () => {
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText(EN['payments.allocate.explain'] as string)).toBeVisible();
  });

  it('offers the form only with the allocation code', async () => {
    const user = userEvent.setup();
    const region = await openReceipt(user, { canAllocate: false });
    expect(within(region).getByText(EN['payments.allocate.needsCode'] as string)).toBeVisible();
    expect(
      screen.queryByRole('form', { name: EN['payments.allocate.formLabel'] as string })
    ).toBeNull();
  });

  it('searches the RECEIPT’s own branch for allocatable invoices and names each by number, payer and balance', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), 'INV-0001');
    const option = await findSearchedOption(listInvoices, 'INV-0001', /INV-000123/);
    expect(listInvoices.mock.calls.at(-1)?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    // The SERVER decides what can still take money — issued, or credited with a
    // balance open — so no single status is asked for.
    expect(listInvoices.mock.calls.at(-1)?.[1]).toEqual({
      q: 'INV-0001',
      status: undefined,
      allocatable: true,
    });
    expect(option).toHaveTextContent('Layla Haddad');
    // Formatted as every money figure is, never the raw wire string.
    expect(option).toHaveTextContent(money('40.0000'));
    expect(option).not.toHaveTextContent('40.0000 USD');
  });

  it('offers a credited invoice with money open, and names its balance', async () => {
    listInvoices.mockResolvedValue(
      okRead({
        items: [
          {
            ...invoiceEntry,
            status: 'credited',
            outstanding: { amount: '15.5000', currency: 'USD' },
          },
        ],
        nextCursor: null,
        hasMore: false,
      })
    );
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), 'INV-0001');
    const option = await findSearchedOption(listInvoices, 'INV-0001', /INV-000123/);
    expect(option).toHaveTextContent(EN['invoices.status.credited'] as string);
    expect(option).toHaveTextContent(money('15.5000'));
    expect(within(form).getByText(EN['payments.allocate.invoiceHelp'] as string)).toBeVisible();
  });

  it('shows no balance beside a draft, whose zero would read as paid', async () => {
    listInvoices.mockResolvedValue(
      okRead({
        items: [
          {
            ...invoiceEntry,
            status: 'draft',
            invoiceNumber: null,
            outstanding: { amount: '0.0000', currency: 'USD' },
          },
        ],
        nextCursor: null,
        hasMore: false,
      })
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await user.type(
      within(pickerFilters()).getByLabelText(labelled('payments.list.invoiceFilter')),
      'Layla'
    );
    const option = await findSearchedOption(
      listInvoices,
      'Layla',
      new RegExp(escape(EN['invoices.picker.unnumbered'] as string))
    );
    expect(option).toHaveTextContent(EN['invoices.status.draft'] as string);
    expect(option).not.toHaveTextContent(EN['invoices.picker.open'] as string);
    expect(option).not.toHaveTextContent(money('0.0000'));
  });

  it('says nothing about money for an invoice whose balance the server withheld', async () => {
    listInvoices.mockResolvedValue(
      okRead({ items: [{ ...invoiceEntry, outstanding: null }], nextCursor: null, hasMore: false })
    );
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), 'INV-0001');
    const option = await findSearchedOption(listInvoices, 'INV-0001', /INV-000123/);
    expect(option).not.toHaveTextContent(EN['invoices.picker.open'] as string);
    expect(option).not.toHaveTextContent('0.0000');
  });

  it('refuses to apply with no invoice chosen, on the invoice box', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '10.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['payments.allocate.invoiceRequired'] as string)
    ).toBeVisible();
    expect(within(form).getByLabelText(labelled('payments.allocate.invoice'))).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(allocatePayment).not.toHaveBeenCalled();
  });

  it('applies to the invoice it was reached from without asking for it again', async () => {
    const user = userEvent.setup();
    await openReceipt(user, { initialInvoiceId: INVOICE_ID });
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    expect(
      within(form).getByText(EN['payments.allocate.invoiceFromAddress'] as string)
    ).toBeVisible();
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '5.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    // Reached from an invoice, the question names no number it was never given.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(money('5.0000'));
    await confirmApply(user);
    await waitFor(() => expect(allocatePayment).toHaveBeenCalled());
    expect(allocatePayment.mock.calls[0]?.[1]).toMatchObject({ invoiceId: INVOICE_ID });
  });

  it('asks before applying, naming the amount and the invoice; cancelling applies nothing', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '40.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['payments.allocate.confirmTitle'] as string,
    });
    expect(dialog).toHaveTextContent('INV-000123');
    expect(dialog).toHaveTextContent(money('40.0000'));
    await user.click(within(dialog).getByRole('button', { name: EN['overlay.cancel'] as string }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(allocatePayment).not.toHaveBeenCalled();
    // What was typed is still there to send.
    expect(within(form).getByLabelText(labelled('payments.allocate.amount'))).toHaveValue(
      '40.0000'
    );
  });

  it('sends the RECEIPT’s own currency, its own key, and no version', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '40.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    await confirmApply(user);
    await waitFor(() => expect(allocatePayment).toHaveBeenCalled());
    expect(allocatePayment.mock.calls[0]?.[0]).toBe(RECEIPT_ID);
    expect(allocatePayment.mock.calls[0]?.[1]).toEqual({
      invoiceId: INVOICE_ID,
      amount: '40.0000',
      currency: 'USD',
    });
    expect(String(allocatePayment.mock.calls[0]?.[2])).toMatch(UUID_SHAPE);
  });

  it('reads the invoice balance afterwards and RENDERS it, surviving the re-read the same act causes', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    await apply(user, '40.0000');
    await waitFor(() => expect(readOutstanding).toHaveBeenCalledWith(INVOICE_ID));
    // The figure must outlive the panels the write remounts: it is stated
    // above them, beside the write notice.
    const line = await screen.findByText(EN['payments.allocate.invoiceOpen'] as string, {
      exact: false,
    });
    // The same figure appears in the receipt's own column, so the balance is
    // asserted inside the sentence that states it.
    expect(within(line).getByText(money('40.0000'))).toBeVisible();
  });

  it('says so when the balance could not be read, rather than showing nothing', async () => {
    readOutstanding.mockResolvedValue(refusedRead('unavailable', 'corr-503'));
    const user = userEvent.setup();
    await openReceipt(user);
    await apply(user, '40.0000');
    expect(
      await screen.findByText(EN['payments.allocate.invoiceOpenUnavailable'] as string)
    ).toBeVisible();
    expect(screen.getByText('corr-503')).toBeVisible();
  });

  it('refuses a zero amount before sending, because the server refuses it too', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '0.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    expect(await screen.findByText(EN['payments.common.amountFormat'] as string)).toBeVisible();
    expect(allocatePayment).not.toHaveBeenCalled();
  });

  it('names the currency it declares on the operator’s behalf', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    // The receipt's currency stands beside the amount and is part of its description.
    const amount = within(form).getByLabelText(labelled('payments.allocate.amount'));
    expect(amount).toHaveAccessibleDescription(expect.stringContaining(receipt.money.currency));
  });

  it('puts a server violation on the field it names', async () => {
    allocatePayment.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'state.invalid.title',
        attempt: 1,
        correlationId: 'corr-422',
        fieldErrors: { amount: 'payments.common.amountFormat' },
      },
      created: null,
    });
    const user = userEvent.setup();
    await openReceipt(user);
    await apply(user, '90.0000');
    await waitFor(() => expect(allocatePayment).toHaveBeenCalled());
    const field = screen.getByLabelText(
      new RegExp(escape(EN['payments.allocate.amount'] as string))
    );
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('says a REVERSED receipt was reversed, not that it is fully applied', async () => {
    readReceipt.mockResolvedValue(
      okRead(detail({ status: 'reversed', unallocated: { amount: '0.0000', currency: 'USD' } }))
    );
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText(EN['payments.allocate.reversed'] as string)).toBeVisible();
    expect(within(region).queryByText(EN['payments.allocate.nothingLeft'] as string)).toBeNull();
  });

  it('says there is nothing left to apply on a fully applied receipt', async () => {
    readReceipt.mockResolvedValue(
      okRead(detail({ status: 'allocated', unallocated: { amount: '0.0000', currency: 'USD' } }))
    );
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText(EN['payments.allocate.nothingLeft'] as string)).toBeVisible();
  });

  /**
   * M-09. An allocation cannot be undone, and its answer can be lost. A retry of
   * the SAME request after a lost answer goes under the SAME key — even from a
   * form that was closed and opened again — so the server answers with the
   * allocation it may already have made instead of booking a second one.
   *
   * Each case is kept to at most two opened forms: every opening chooses a branch,
   * a receipt and an invoice through the pickers, and a case that did that three
   * times ran past the per-test budget on the hosted runner. The remembered
   * attempts are cleared around every test (see the file's hooks).
   *
   * Even two openings are the costliest cases in this file: late in the file one
   * measured 13-15 s on a development machine (about 3.5 s run alone), and this
   * file runs about 2.3 times slower on the hosted runner, which puts a case near
   * the project's 30 s budget there. So each case carries its own documented
   * budget, sized for the hosted runner with margin. No case is retried.
   */
  const LOST_ANSWER_CASE_TIMEOUT_MS = 60_000;

  describe('an allocation whose answer was lost (M-09)', () => {
    const findForm = () =>
      screen.findByRole('form', { name: EN['payments.allocate.formLabel'] as string });

    /** Submits the form as it stands and answers the question. */
    async function submitAndConfirm(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
      await user.click(
        within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
      );
      const dialog = await screen.findByRole('alertdialog', {
        name: EN['payments.allocate.confirmTitle'] as string,
      });
      await user.click(
        within(dialog).getByRole('button', { name: EN['payments.allocate.submit'] as string })
      );
    }

    /** A whole request from a freshly opened form: the invoice, the amount, the question. */
    async function send(user: ReturnType<typeof userEvent.setup>, amount: string) {
      const form = await findForm();
      await chooseInvoice(user, form);
      await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), amount);
      await submitAndConfirm(user, form);
    }

    /** The operator closes everything and comes back to the same receipt. */
    async function reopen(user: ReturnType<typeof userEvent.setup>) {
      cleanup();
      await openReceipt(user);
    }

    const keyOf = (call: number) => String(allocatePayment.mock.calls[call]?.[2]);

    it(
      'retries the same request under the same key, even from a reopened form',
      async () => {
        allocatePayment.mockRejectedValueOnce(new Error('the answer was lost'));
        const user = userEvent.setup();
        await openReceipt(user);
        await send(user, '41.0000');
        await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(1));
        const lostKey = keyOf(0);
        expect(lostKey).toMatch(UUID_SHAPE);

        await reopen(user);
        await send(user, '41.0000');
        await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(2));
        expect(keyOf(1)).toBe(lostKey);
      },
      LOST_ANSWER_CASE_TIMEOUT_MS
    );

    it(
      'a definite answer spends the remembered key: the next allocation is a new one',
      async () => {
        allocatePayment.mockRejectedValueOnce(new Error('the answer was lost'));
        const user = userEvent.setup();
        await openReceipt(user);
        await send(user, '41.0000');
        await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(1));
        const lostKey = keyOf(0);

        // Retried from the same form, whose invoice and amount are kept; this time
        // the answer arrives and is definite (the default mock books it).
        await submitAndConfirm(user, await findForm());
        await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(2));
        expect(keyOf(1)).toBe(lostKey);
        await waitFor(() => expect(readOutstanding).toHaveBeenCalled());

        // Even the same amount on the same invoice is now a new allocation.
        await reopen(user);
        await send(user, '41.0000');
        await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(3));
        expect(keyOf(2)).toMatch(UUID_SHAPE);
        expect(keyOf(2)).not.toBe(lostKey);
      },
      LOST_ANSWER_CASE_TIMEOUT_MS
    );

    it(
      'a different request after a lost answer is a new allocation under a new key',
      async () => {
        allocatePayment.mockResolvedValueOnce({
          state: { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 },
          created: null,
        });
        const user = userEvent.setup();
        await openReceipt(user);
        await send(user, '42.0000');
        await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(1));
        const lostKey = keyOf(0);

        await reopen(user);
        await send(user, '43.0000');
        await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(2));
        expect(keyOf(1)).not.toBe(lostKey);
      },
      LOST_ANSWER_CASE_TIMEOUT_MS
    );
  });

  it('a refused allocation is stated with its reference and nothing is claimed', async () => {
    allocatePayment.mockResolvedValue({
      state: {
        status: 'conflict',
        messageKey: 'state.conflict.title',
        attempt: 1,
        correlationId: 'corr-409',
      },
      created: null,
    });
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '90.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    await confirmApply(user);
    // Rendered, not merely present on the outcome object — and a bound the
    // server refused is never told as "someone changed this" (#473).
    expect(await screen.findByText('corr-409')).toBeVisible();
    expect(screen.queryByText(EN['state.conflict.transition.title'] as string)).toBeNull();
    expect(
      screen.queryByText(EN['payments.allocate.invoiceOpen'] as string, { exact: false })
    ).toBeNull();
    expect(readOutstanding).not.toHaveBeenCalled();
  });

  /** The server's over-allocation refusal, naming the bound on the amount (DF-7). */
  const boundRefusal = (rule: 'invoice_open' | 'receipt_remaining') => ({
    state: {
      status: 'conflict',
      messageKey: 'form.formError',
      fieldErrors: { amount: `form.violation.allocation_exceeds_${rule}` },
      attempt: 1,
      correlationId: 'corr-409',
    },
    created: null,
  });

  it('says an amount over what the invoice still has open AT the amount, with that figure, and moves the cursor there (DF-7)', async () => {
    allocatePayment.mockResolvedValue(boundRefusal('invoice_open'));
    readOutstanding.mockResolvedValue(
      okRead({
        invoiceId: INVOICE_ID,
        status: 'issued',
        outstanding: { amount: '20.8640', currency: 'USD' },
        isSettled: false,
      })
    );
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await apply(user, '25.000');
    const box = within(form).getByLabelText(labelled('payments.allocate.amount'));
    const sentence = formatMessage(EN['payments.allocate.overInvoiceOpen'] as string, {
      amount: money('20.8640'),
    });
    await waitFor(() => expect(box).toHaveAccessibleDescription(expect.stringContaining(sentence)));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(readOutstanding).toHaveBeenCalledWith(INVOICE_ID);
    // What was typed stays, never a server-normalised four-place figure (DF-6).
    expect(box).toHaveValue('25.000');
    // The generic "cannot be saved" sentence is not the only thing said.
    expect(within(form).getByText('corr-409')).toBeVisible();

    // A correction withdraws the complaint.
    await user.type(box, '{Backspace}');
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(within(form).queryByText(sentence)).toBeNull();
  });

  it('says an amount over what is left on the receipt with the receipt figure, without reading the invoice (DF-7)', async () => {
    allocatePayment.mockResolvedValue(boundRefusal('receipt_remaining'));
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await apply(user, '45');
    const box = within(form).getByLabelText(labelled('payments.allocate.amount'));
    const sentence = formatMessage(EN['payments.allocate.overReceiptLeft'] as string, {
      amount: money('40.0000'),
    });
    await waitFor(() => expect(box).toHaveAccessibleDescription(expect.stringContaining(sentence)));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(readOutstanding).not.toHaveBeenCalled();
    expect(box).toHaveValue('45');
  });

  it('says the bound in plain words when the invoice balance cannot be read (DF-7)', async () => {
    allocatePayment.mockResolvedValue(boundRefusal('invoice_open'));
    readOutstanding.mockResolvedValue(refusedRead('unavailable', 'corr-503'));
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await apply(user, '25');
    const box = within(form).getByLabelText(labelled('payments.allocate.amount'));
    await waitFor(() =>
      expect(box).toHaveAccessibleDescription(
        expect.stringContaining(EN['form.violation.allocation_exceeds_invoice_open'] as string)
      )
    );
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('says the receipt bound in Arabic, at the amount, right to left (DF-7)', async () => {
    allocatePayment.mockResolvedValue(boundRefusal('receipt_remaining'));
    const user = userEvent.setup();
    const arLabel = (key: string) => new RegExp(`^${escape(AR[key] as string)}`);
    renderRtl(screenFor({ locale: 'ar', messages: ar }));
    const list = await screen.findByRole('region', { name: AR['payments.list.heading'] as string });
    await user.click(
      within(list).getByRole('button', { name: `${AR['payments.list.open']} RCT-000007` })
    );
    const form = await screen.findByRole('form', {
      name: AR['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, form, arLabel('payments.allocate.invoice'));
    const box = within(form).getByLabelText(arLabel('payments.allocate.amount'));
    await user.type(box, '45.000');
    await user.click(
      within(form).getByRole('button', { name: AR['payments.allocate.submit'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: AR['payments.allocate.confirmTitle'] as string,
    });
    await user.click(
      within(dialog).getByRole('button', { name: AR['payments.allocate.submit'] as string })
    );
    const sentence = formatMessage(AR['payments.allocate.overReceiptLeft'] as string, {
      amount: formatMoney({ amount: '40.0000', currency: 'USD' }, 'ar'),
    });
    await waitFor(() => expect(box).toHaveAccessibleDescription(expect.stringContaining(sentence)));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue('45.000');
  });
});

describe('the printable receipt (FE-021)', () => {
  async function openPrint(user: ReturnType<typeof userEvent.setup>) {
    renderScreen();
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(within(list).getByRole('button', { name: OPEN_RECEIPT }));
    await screen.findByRole('region', { name: EN['payments.receipt.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['payments.print.open'] as string }));
    return screen.findByRole('article');
  }

  it('names the payer by name and each invoice by its number, never by a reference', async () => {
    const user = userEvent.setup();
    const document = await openPrint(user);
    expect(within(document).getByTestId('receipt-print-payer')).toHaveTextContent('Layla Haddad');
    expect(document.textContent).not.toContain(PARTNER_ID);
    const named = within(document).getByTestId('receipt-allocation-invoice');
    expect(named).toHaveTextContent('INV-000123');
    expect(named).toHaveTextContent('Layla Haddad');
    expect(document.textContent).not.toContain(INVOICE_ID);
    expect(document.textContent).not.toContain(ALLOCATION_ID);
    expect(
      within(document).getByText(EN['payments.print.noCashier'] as string, { exact: false })
    ).toBeVisible();
  });

  it('prints the copy alone: the screen is a print scope and the copy one child of it', async () => {
    // The residual #478 recorded: the receipt's printable copy printed the
    // screen around it. The screen opts into the print scope, so the print
    // sheet leaves off every child of it that holds no copy.
    const user = userEvent.setup();
    const document = await openPrint(user);
    const scope = document.closest('[data-print-scope]') as HTMLElement;
    expect(scope).not.toBeNull();
    const holders = [...scope.children].filter((child) => child.contains(document));
    expect(holders).toHaveLength(1);
    expect(scope.children.length).toBeGreaterThan(1);
  });

  it('prints the server’s figures and nothing computed', async () => {
    const user = userEvent.setup();
    const document = await openPrint(user);
    expect(within(document).getByText(money('100.0000'))).toBeVisible();
    expect(within(document).getByText(money('40.0000'))).toBeVisible();
    expect(within(document).getByText(money('60.0000'))).toBeVisible();
  });

  it('states whether the printable copy is open', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(within(list).getByRole('button', { name: OPEN_RECEIPT }));
    await screen.findByRole('region', { name: EN['payments.receipt.heading'] as string });
    const toggle = screen.getByRole('button', { name: EN['payments.print.open'] as string });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(
      screen
        .getByRole('button', { name: EN['payments.print.close'] as string })
        .getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('hides every working panel from the printed page', async () => {
    const user = userEvent.setup();
    await openPrint(user);
    for (const key of ['payments.target.heading', 'payments.list.heading']) {
      const region = screen.getByRole('region', { name: EN[key] as string });
      expect(region.getAttribute('data-print')).toBe('hide');
    }
  });

  it('says a receipt applied to nothing has been applied to nothing', async () => {
    readReceipt.mockResolvedValue(
      okRead(detail({ allocations: [], status: 'recorded', unallocated: receipt.money }))
    );
    const user = userEvent.setup();
    const document = await openPrint(user);
    expect(within(document).getByText(EN['payments.print.noAllocations'] as string)).toBeVisible();
  });
});

describe('the route page decides before it reads', () => {
  it('refuses without finance view: the refusal is rendered, the screen is not, and nothing is read', async () => {
    PERMISSIONS = ['sal.payment.record', 'sal.payment.allocate'];
    await renderPage({ locale: 'en' }, { paymentId: RECEIPT_ID });
    // Asserting "no read happened" alone would stay green with the gate
    // deleted, because nothing is read before a branch is named.
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['payments.target.explain'] as string)).toBeNull();
    expect(listReceipts).not.toHaveBeenCalled();
    expect(listPaymentMethods).not.toHaveBeenCalled();
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it('renders the screen for a cashier holding finance view', async () => {
    PERMISSIONS = ['sal.finance.view', 'sal.payment.record'];
    await renderPage({ locale: 'en' });
    expect(screen.getByText(EN['payments.target.explain'] as string)).toBeVisible();
  });

  it('takes a receipt and an invoice from the address, and ignores a malformed one', async () => {
    PERMISSIONS = ['sal.finance.view', 'sal.payment.allocate'];
    await renderPage({ locale: 'en' }, { paymentId: RECEIPT_ID, invoiceId: 'not-a-uuid' });
    await waitFor(() => expect(readReceipt).toHaveBeenCalledWith(RECEIPT_ID));
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    // The malformed reference is not taken as a choice…
    expect(within(form).queryByTestId('payments-invoice-from-address')).toBeNull();
    // …and a cashier holding finance view and the allocation code — no
    // `sal.invoice.manage` — still FINDS the invoice and applies to it.
    expect(PERMISSIONS).not.toContain('sal.invoice.manage');
    expect(within(form).queryByText(EN['invoices.picker.notPermitted'] as string)).toBeNull();
    const user = userEvent.setup();
    await chooseInvoice(user, form);
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '5.0000');
    const submit = within(form).getByRole('button', {
      name: EN['payments.allocate.submit'] as string,
    });
    expect(submit).toBeEnabled();
    await user.click(submit);
    await confirmApply(user);
    await waitFor(() => expect(allocatePayment).toHaveBeenCalled());
    expect(allocatePayment.mock.calls[0]?.[1]).toMatchObject({ invoiceId: INVOICE_ID });
  });
});

describe('Arabic', () => {
  it('prints the receipt’s moments isolated right to left, so they read in order', async () => {
    const user = userEvent.setup();
    renderRtl(
      <PaymentsScreen
        locale="ar"
        messages={ar}
        initialReceiptId={RECEIPT_ID}
        initialInvoiceId={null}
        canRecord={false}
        canAllocate={false}
        canReadCustomers={true}
      />
    );
    await screen.findByRole('region', { name: AR['payments.receipt.heading'] as string });
    await user.click(screen.getByRole('button', { name: AR['payments.print.open'] as string }));
    const document = await screen.findByRole('article');
    const received = within(document).getByTestId('receipt-print-received-at');
    expect(received.querySelector('bdi')).toHaveAttribute('dir', 'rtl');
    expect(received).not.toHaveAttribute('dir', 'ltr');
    expect(within(document).getByTestId('receipt-print-payer')).toHaveTextContent('Layla Haddad');
  });

  it('renders the branch panel in Arabic', () => {
    renderRtl(
      <PaymentsScreen
        locale="ar"
        messages={ar}
        initialReceiptId={null}
        initialInvoiceId={null}
        canRecord={false}
        canAllocate={false}
      />
    );
    expect(screen.getByText(AR['payments.target.explain'] as string)).toBeVisible();
    expect(screen.getByText(AR['workingContext.changeInHeader'] as string)).toBeVisible();
  });

  it('states the currency refusal in Arabic, beside the same box', async () => {
    recordPayment.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { currency: 'form.violation.invalid_string' },
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderRtl(
      <PaymentsScreen
        locale="ar"
        messages={ar}
        initialReceiptId={null}
        initialInvoiceId={null}
        canRecord={true}
        canAllocate={false}
        canReadCustomers={true}
      />
    );
    const form = await screen.findByRole('form', {
      name: AR['payments.record.formLabel'] as string,
    });
    await choosePayer(user, form, new RegExp(`^${escape(AR['payments.record.payer'] as string)}`));
    await user.type(
      within(form).getByLabelText(
        new RegExp(`^${escape(AR['payments.record.currency'] as string)}`)
      ),
      'USD'
    );
    await user.type(
      within(form).getByLabelText(new RegExp(`^${escape(AR['payments.record.amount'] as string)}`)),
      '100.0000'
    );
    await user.click(
      within(form).getByRole('button', { name: AR['payments.record.submit'] as string })
    );
    expect(
      await within(form).findByText(AR['form.violation.invalid_string'] as string)
    ).toBeVisible();
  });
});

/*
 * Finance retest fixes C (`P1-32-PRE-OD-FQC`). The signed-in retest at 9bd21460
 * found the receipt's "applied to" list printing a raw reference (DF-R2-2), a
 * printable copy that could say "not shown" while the payer's name was still
 * being found, and amounts written with the browser's locale data instead of
 * the minor unit the platform records for their currency (Owner decision D1).
 */
describe('finance retest fixes C', () => {
  async function openReceipt(user: ReturnType<typeof userEvent.setup>, over = {}) {
    renderScreen(over);
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(within(list).getByRole('button', { name: OPEN_RECEIPT }));
    return screen.findByRole('region', { name: EN['payments.receipt.heading'] as string });
  }

  it('DF-R2-2: an invoice this scope cannot see is said to be not shown, never referenced', async () => {
    readReceipt.mockResolvedValue(
      okRead(
        detail({
          allocations: [
            {
              id: ALLOCATION_ID,
              sequence: '1',
              invoiceId: INVOICE_ID,
              invoiceNumber: null,
              invoicePayerName: null,
              money: { amount: '60.0000', currency: 'USD' },
              allocatedAt: '2026-09-05T09:05:00.000Z',
            },
          ],
        })
      )
    );
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(
      within(region).getByText(EN['payments.allocations.invoiceNotShown'] as string)
    ).toBeVisible();
    expect(region.textContent).not.toContain(INVOICE_ID);
    await user.click(screen.getByRole('button', { name: EN['payments.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(
      within(document).getByText(EN['payments.allocations.invoiceNotShown'] as string)
    ).toBeVisible();
    expect(document.textContent).not.toContain(INVOICE_ID);
  });

  it('DF-R2-2: a withheld customer leaves the invoice number alone, with no stand-in', async () => {
    readReceipt.mockResolvedValue(
      okRead(
        detail({
          allocations: [
            {
              id: ALLOCATION_ID,
              sequence: '1',
              invoiceId: INVOICE_ID,
              invoiceNumber: 'INV-000123',
              invoicePayerName: null,
              money: { amount: '60.0000', currency: 'USD' },
              allocatedAt: '2026-09-05T09:05:00.000Z',
            },
          ],
        })
      )
    );
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByTestId('receipt-allocation-invoice').textContent).toBe('INV-000123');
  });

  it('DF-R2-2: the Arabic receipt and its copy name the invoice by number, never by reference', async () => {
    const user = userEvent.setup();
    renderRtl(
      <PaymentsScreen
        locale="ar"
        messages={ar}
        initialReceiptId={RECEIPT_ID}
        initialInvoiceId={null}
        canRecord={false}
        canAllocate={false}
        canReadCustomers={true}
      />
    );
    const region = await screen.findByRole('region', {
      name: AR['payments.receipt.heading'] as string,
    });
    const named = within(region).getByTestId('receipt-allocation-invoice');
    expect(named).toHaveTextContent('INV-000123');
    expect(named).toHaveTextContent('Layla Haddad');
    // The number is isolated left to right, so its digits keep their order.
    expect(named.querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(region.textContent).not.toContain(INVOICE_ID);
    expect(within(region).getByText(AR['payments.receipt.noCashier'] as string)).toBeVisible();
    await user.click(screen.getByRole('button', { name: AR['payments.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(within(document).getByTestId('receipt-allocation-invoice')).toHaveTextContent(
      'INV-000123'
    );
    expect(document.textContent).not.toContain(INVOICE_ID);
    expect(document.textContent).not.toContain(ALLOCATION_ID);
  });

  it('the printable receipt waits for the payer name: loading and no Print until the lookup settles', async () => {
    let answer: (payer: unknown) => void = () => undefined;
    readReceiptPayer.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    await openReceipt(user);
    await user.click(screen.getByRole('button', { name: EN['payments.print.open'] as string }));
    const panel = screen.getByRole('region', { name: EN['payments.print.heading'] as string });
    // Still finding the name: a loading state, no copy, and nothing to print.
    expect(within(panel).getByRole('status')).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: EN['payments.print.print'] as string })
    ).toBeNull();
    expect(panel.textContent).not.toContain(EN['payments.list.payerNotShown'] as string);
    answer({ displayName: 'Layla Haddad', displayNumber: 'C-000482', partyType: 'individual' });
    const document = await screen.findByRole('article');
    expect(within(document).getByTestId('receipt-print-payer')).toHaveTextContent('Layla Haddad');
    await user.click(
      within(panel).getByRole('button', { name: EN['payments.print.print'] as string })
    );
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('a payer lookup that settles without a name prints the honest not-shown text', async () => {
    readReceiptPayer.mockResolvedValue(null);
    const user = userEvent.setup();
    await openReceipt(user);
    await user.click(screen.getByRole('button', { name: EN['payments.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(within(document).getByTestId('receipt-print-payer')).toHaveTextContent(
      EN['payments.list.payerNotShown'] as string
    );
  });

  /*
   * The browser's locale data writes the Iraqi dinar with no decimals; the
   * platform's register (`shared.currencies`) may record three. The server's
   * figure is the one written and the one the amount box checks against.
   */
  const iqd = (amount: string) => ({ amount, currency: 'IQD', minorUnit: 3 });

  it('writes the receipt with the minor unit the server published, where the locale data disagrees', async () => {
    readReceipt.mockResolvedValue(
      okRead(
        detail({
          money: iqd('100.0000'),
          unallocated: iqd('40.5000'),
          allocations: [
            {
              id: ALLOCATION_ID,
              sequence: '1',
              invoiceId: INVOICE_ID,
              invoiceNumber: 'INV-000123',
              invoicePayerName: 'Layla Haddad',
              money: iqd('59.5000'),
              allocatedAt: '2026-09-05T09:05:00.000Z',
            },
          ],
        })
      )
    );
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText('100.000 IQD')).toBeVisible();
    expect(within(region).getByText('40.500 IQD')).toBeVisible();
    expect(within(region).getByText('59.500 IQD')).toBeVisible();
    // The locale data alone would have written these differently.
    expect(formatMoney({ amount: '100.0000', currency: 'IQD' }, 'en')).not.toBe('100.000 IQD');
  });

  it('refuses an amount finer than the minor unit the server published, at the box, before sending', async () => {
    readReceipt.mockResolvedValue(
      okRead(detail({ money: iqd('100.0000'), unallocated: iqd('40.0000') }))
    );
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await chooseInvoice(user, form);
    const box = within(form).getByLabelText(
      new RegExp(escape(EN['payments.allocate.amount'] as string))
    );
    await user.type(box, '1.0005');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['form.violation.minor_unit_scale'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue('1.0005');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(allocatePayment).not.toHaveBeenCalled();
    // Corrected to the currency's three decimals, the complaint goes and the question is asked.
    await user.clear(box);
    await user.type(box, '1.500');
    expect(within(form).queryByText(EN['form.violation.minor_unit_scale'] as string)).toBeNull();
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    expect(
      await screen.findByRole('alertdialog', {
        name: EN['payments.allocate.confirmTitle'] as string,
      })
    ).toBeVisible();
  });
});

/* ------------------------------------------------------------------ *
 * ADR-023 D4 — the receipt reversal and its replacement
 * ------------------------------------------------------------------ */

describe('the receipt reversal (ADR-023 D4)', () => {
  const REQUESTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const APPROVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const REVERSAL_ID = '99999999-9999-4999-8999-999999999999';
  const REPLACEMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

  const pendingReversal = (over: Record<string, unknown> = {}) => ({
    id: REVERSAL_ID,
    receiptId: RECEIPT_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    state: 'pending',
    amount: { amount: '100.0000', currency: 'USD' },
    reason: 'Recorded against the wrong payer',
    requestedBy: REQUESTER,
    requestedAt: '2026-10-02T08:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    reversedAt: null,
    recordVersion: 4,
    requestedByName: 'Rana Saleh',
    decidedByName: null,
    ...over,
  });

  const echo = (state: string, messageKey: string) => ({
    state: { status: 'success', messageKey, attempt: 1 },
    created: { reversal: pendingReversal({ state }), replayed: false },
  });

  function openOn(over: Record<string, unknown>, screenOver: Record<string, unknown> = {}) {
    readReceipt.mockResolvedValue(okRead(detail(over)));
    renderScreen({ initialReceiptId: RECEIPT_ID, currentUserId: APPROVER, ...screenOver });
    return screen.findByRole('region', { name: EN['payments.reversal.heading'] as string });
  }

  it('offers the request to a payment recorder, with the reason asked and the RECEIPT version sent', async () => {
    const user = userEvent.setup();
    requestReceiptReversal.mockResolvedValue(echo('pending', 'payments.reversal.requested'));
    const section = await openOn({ recordVersion: 7 });
    expect(within(section).getByText(EN['payments.reversal.explain'] as string)).toBeVisible();
    await user.click(
      within(section).getByRole('button', { name: EN['payments.reversal.request'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['payments.reversal.requestTitle'] as string,
    });
    const confirm = within(dialog).getByRole('button', {
      name: EN['payments.reversal.request'] as string,
    });
    // No reason, nothing to send.
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText(labelled('payments.reversal.reason')),
      '  Wrong payer '
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(requestReceiptReversal).toHaveBeenCalledWith(RECEIPT_ID, { reason: 'Wrong payer' }, 7)
    );
    // The amount is never the screen's: the body is the reason alone.
    expect(Object.keys(requestReceiptReversal.mock.calls[0]?.[1] as object)).toEqual(['reason']);
    // A landed request re-reads the receipt and says so above it.
    expect(await screen.findByText(EN['payments.reversal.requested'] as string)).toBeVisible();
    await waitFor(() => expect(readReceipt.mock.calls.length).toBeGreaterThan(1));
  });

  it('offers no request without the recording code, and none for a reversed receipt', async () => {
    const section = await openOn({}, { canRecord: false });
    expect(
      within(section).queryByRole('button', { name: EN['payments.reversal.request'] as string })
    ).toBeNull();
    cleanup();
    const reversed = await openOn({
      status: 'reversed',
      reversal: pendingReversal({
        state: 'approved',
        decidedBy: APPROVER,
        decidedAt: '2026-10-02T09:00:00.000Z',
        reversedAt: '2026-10-02T09:00:00.000Z',
        decidedByName: 'Omar Nasser',
      }),
    });
    expect(
      within(reversed).queryByRole('button', { name: EN['payments.reversal.request'] as string })
    ).toBeNull();
  });

  it('keeps a refused reason on the reason box, and offers the latest version after a conflict', async () => {
    const user = userEvent.setup();
    requestReceiptReversal.mockResolvedValueOnce({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { reason: 'form.violation.too_small' },
        attempt: 1,
      },
      created: null,
    });
    const section = await openOn({});
    await user.click(
      within(section).getByRole('button', { name: EN['payments.reversal.request'] as string })
    );
    let dialog = await screen.findByRole('alertdialog', {
      name: EN['payments.reversal.requestTitle'] as string,
    });
    const box = within(dialog).getByLabelText(labelled('payments.reversal.reason'));
    await user.type(box, 'x');
    await user.click(
      within(dialog).getByRole('button', { name: EN['payments.reversal.request'] as string })
    );
    await waitFor(() => expect(box).toHaveAttribute('aria-invalid', 'true'));
    expect(box).toHaveValue('x');

    // The receipt moved on: said in words, and the latest version offered.
    requestReceiptReversal.mockResolvedValueOnce({
      state: { status: 'conflict', messageKey: 'payments.reversal.conflict', attempt: 1 },
      created: null,
    });
    await user.type(box, 'y');
    await user.click(
      within(dialog).getByRole('button', { name: EN['payments.reversal.request'] as string })
    );
    expect(await screen.findByText(EN['payments.reversal.conflict'] as string)).toBeVisible();
    const latest = await screen.findByTestId('payments-reversal-load-latest');
    expect(
      within(section).getByRole('button', { name: EN['payments.reversal.request'] as string })
    ).toBeDisabled();
    const reads = readReceipt.mock.calls.length;
    await user.click(latest);
    await waitFor(() => expect(readReceipt.mock.calls.length).toBe(reads + 1));
    dialog = screen.queryByRole('alertdialog') as HTMLElement;
    expect(dialog).toBeNull();
  });

  it('shows a pending reversal, closes the allocation form with the reason, and names people instead of ids', async () => {
    const section = await openOn({ reversal: pendingReversal() });
    expect(within(section).getByTestId('payments-reversal-pending')).toHaveTextContent(
      EN['payments.reversal.pendingBanner'] as string
    );
    expect(within(section).getByText('Rana Saleh')).toBeVisible();
    expect(within(section).getByText('Recorded against the wrong payer')).toBeVisible();
    expect(screen.queryByText(REQUESTER)).toBeNull();
    // Allocation is closed, with the explanation in its place.
    expect(await screen.findByTestId('payments-allocate-reversal-pending')).toHaveTextContent(
      EN['payments.allocate.reversalPending'] as string
    );
    expect(screen.queryByLabelText(labelled('payments.allocate.amount'))).toBeNull();
    // Without the decision code and not the requester: it waits for someone who may decide.
    expect(within(section).getByTestId('payments-reversal-cannot-decide')).toBeVisible();
    expect(
      within(section).queryByRole('button', { name: EN['payments.reversal.approve'] as string })
    ).toBeNull();
  });

  it('says a name is not shown rather than printing an id', async () => {
    const section = await openOn({ reversal: pendingReversal({ requestedByName: null }) });
    expect(within(section).getByText(EN['payments.reversal.nameNotShown'] as string)).toBeVisible();
    expect(screen.queryByText(REQUESTER)).toBeNull();
  });

  it('lets the requester withdraw, sending the REVERSAL version, and offers them no decision', async () => {
    const user = userEvent.setup();
    withdrawReceiptReversal.mockResolvedValue(echo('withdrawn', 'payments.reversal.withdrawn'));
    const section = await openOn(
      { reversal: pendingReversal() },
      { currentUserId: REQUESTER, canDecideReversals: true }
    );
    expect(within(section).getByText(EN['payments.reversal.ownRequest'] as string)).toBeVisible();
    expect(
      within(section).queryByRole('button', { name: EN['payments.reversal.approve'] as string })
    ).toBeNull();
    await user.click(
      within(section).getByRole('button', { name: EN['payments.reversal.withdraw'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['payments.reversal.withdrawTitle'] as string,
    });
    await user.click(
      within(dialog).getByRole('button', { name: EN['payments.reversal.withdraw'] as string })
    );
    await waitFor(() => expect(withdrawReceiptReversal).toHaveBeenCalledWith(REVERSAL_ID, 4));
    expect(await screen.findByText(EN['payments.reversal.withdrawn'] as string)).toBeVisible();
  });

  it('lets another holder of the decision code reject, with a reason and the REVERSAL version', async () => {
    const user = userEvent.setup();
    rejectReceiptReversal.mockResolvedValue(echo('rejected', 'payments.reversal.rejected'));
    const section = await openOn(
      { reversal: pendingReversal() },
      { currentUserId: APPROVER, canDecideReversals: true }
    );
    await user.click(
      within(section).getByRole('button', { name: EN['payments.reversal.reject'] as string })
    );
    const reject = await screen.findByRole('alertdialog', {
      name: EN['payments.reversal.rejectTitle'] as string,
    });
    await user.type(within(reject).getByLabelText(labelled('payments.reversal.reason')), 'Correct');
    await user.click(
      within(reject).getByRole('button', { name: EN['payments.reversal.reject'] as string })
    );
    await waitFor(() =>
      expect(rejectReceiptReversal).toHaveBeenCalledWith(REVERSAL_ID, { reason: 'Correct' }, 4)
    );
    expect(approveReceiptReversal).not.toHaveBeenCalled();
    expect(await screen.findByText(EN['payments.reversal.rejected'] as string)).toBeVisible();
  });

  it('lets another holder of the decision code approve, naming the whole amount first', async () => {
    const user = userEvent.setup();
    approveReceiptReversal.mockResolvedValue(echo('approved', 'payments.reversal.approved'));
    const section = await openOn(
      { reversal: pendingReversal() },
      { currentUserId: APPROVER, canDecideReversals: true }
    );
    await user.click(
      within(section).getByRole('button', { name: EN['payments.reversal.approve'] as string })
    );
    const approve = await screen.findByRole('alertdialog', {
      name: EN['payments.reversal.approveTitle'] as string,
    });
    // The whole receipt's amount is named before anything is sent.
    expect(approve).toHaveTextContent(money('100.0000'));
    expect(approveReceiptReversal).not.toHaveBeenCalled();
    await user.click(
      within(approve).getByRole('button', { name: EN['payments.reversal.approve'] as string })
    );
    await waitFor(() => expect(approveReceiptReversal).toHaveBeenCalledWith(REVERSAL_ID));
    expect(rejectReceiptReversal).not.toHaveBeenCalled();
  });

  it('states a refused self-approval in plain words, never the rule name', async () => {
    const user = userEvent.setup();
    approveReceiptReversal.mockResolvedValue({
      state: {
        status: 'conflict',
        messageKey: 'form.violation.receipt_reversal_self_approval',
        attempt: 1,
      },
      created: null,
    });
    const section = await openOn(
      { reversal: pendingReversal() },
      { currentUserId: APPROVER, canDecideReversals: true }
    );
    await user.click(
      within(section).getByRole('button', { name: EN['payments.reversal.approve'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['payments.reversal.approveTitle'] as string,
    });
    await user.click(
      within(dialog).getByRole('button', { name: EN['payments.reversal.approve'] as string })
    );
    expect(
      await screen.findByText(EN['form.violation.receipt_reversal_self_approval'] as string)
    ).toBeVisible();
    expect(document.body.textContent).not.toContain('receipt_reversal_self_approval');
  });

  it('links a reversed receipt to its replacement both ways, and opens the linked receipt', async () => {
    const user = userEvent.setup();
    const approved = pendingReversal({
      state: 'approved',
      decidedBy: APPROVER,
      decidedAt: '2026-10-02T09:00:00.000Z',
      reversedAt: '2026-10-02T09:00:00.000Z',
      decidedByName: 'Omar Nasser',
    });
    readReceipt.mockImplementation(async (id: string) =>
      id === RECEIPT_ID
        ? okRead(
            detail({
              status: 'reversed',
              reversal: approved,
              replacedBy: { id: REPLACEMENT_ID, reference: 'RCT-000009' },
            })
          )
        : okRead(
            detail({
              id: REPLACEMENT_ID,
              reference: 'RCT-000009',
              replaces: { id: RECEIPT_ID, reference: 'RCT-000007' },
            })
          )
    );
    renderScreen({ initialReceiptId: RECEIPT_ID, currentUserId: APPROVER });
    const links = await screen.findByTestId('payments-replacement-links');
    expect(links).toHaveTextContent(EN['payments.replacement.replacedBy'] as string);
    expect(links).toHaveTextContent('RCT-000009');
    expect(links).not.toHaveTextContent(REPLACEMENT_ID);
    // Already replaced: no second replacement is offered.
    expect(screen.queryByTestId('payments-replacement')).toBeNull();
    await user.click(
      within(links).getByRole('button', { name: EN['payments.replacement.openLinked'] as string })
    );
    await waitFor(() => expect(readReceipt).toHaveBeenCalledWith(REPLACEMENT_ID));
    const back = await screen.findByTestId('payments-replacement-links');
    await waitFor(() =>
      expect(back).toHaveTextContent(EN['payments.replacement.replaces'] as string)
    );
    expect(back).toHaveTextContent('RCT-000007');
  });

  it('records the replacement with the payer and currency prefilled, linked to the reversed receipt', async () => {
    const user = userEvent.setup();
    recordReplacementReceipt.mockResolvedValue({
      state: { status: 'success', messageKey: 'payments.replacement.success', attempt: 1 },
      created: {
        id: REPLACEMENT_ID,
        reference: 'RCT-000009',
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        paymentMethodId: METHOD_ID,
        payerPartnerId: PARTNER_ID,
        money: { amount: '90.0000', currency: 'USD' },
        status: 'recorded',
        receivedAt: '2026-10-02T10:00:00.000Z',
        recordVersion: 1,
        replacesReceiptId: RECEIPT_ID,
        replayed: false,
      },
    });
    readReceipt.mockResolvedValue(
      okRead(
        detail({
          status: 'reversed',
          reversal: pendingReversal({
            state: 'approved',
            decidedBy: APPROVER,
            decidedAt: '2026-10-02T09:00:00.000Z',
            reversedAt: '2026-10-02T09:00:00.000Z',
          }),
        })
      )
    );
    renderScreen({ initialReceiptId: RECEIPT_ID, currentUserId: APPROVER });
    const panel = await screen.findByTestId('payments-replacement');
    await user.click(
      within(panel).getByRole('button', { name: EN['payments.replacement.open'] as string })
    );
    const form = await within(panel).findByRole('form', {
      name: EN['payments.replacement.heading'] as string,
    });
    await waitFor(() =>
      expect(valueOf(within(form).getByLabelText(labelled('payments.record.payer')))).toContain(
        'Layla Haddad'
      )
    );
    expect(within(form).getByLabelText(labelled('payments.record.currency'))).toHaveValue('USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '90.00');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.replacement.submit'] as string })
    );
    await waitFor(() =>
      expect(recordReplacementReceipt).toHaveBeenCalledWith(
        RECEIPT_ID,
        {
          paymentMethodId: METHOD_ID,
          payerPartnerId: PARTNER_ID,
          currency: 'USD',
          // The money field writes the amount at the column's scale.
          amount: '90.0000',
        },
        expect.stringMatching(UUID_SHAPE)
      )
    );
    // The new receipt opens, and the notice names it by number.
    await waitFor(() => expect(readReceipt).toHaveBeenCalledWith(REPLACEMENT_ID));
    expect(await screen.findByText(EN['payments.replacement.recorded'] as string)).toBeVisible();
  });

  it('refuses an empty amount on the field, before anything is sent', async () => {
    const user = userEvent.setup();
    readReceipt.mockResolvedValue(
      okRead(
        detail({
          status: 'reversed',
          reversal: pendingReversal({
            state: 'approved',
            decidedBy: APPROVER,
            decidedAt: '2026-10-02T09:00:00.000Z',
            reversedAt: '2026-10-02T09:00:00.000Z',
          }),
        })
      )
    );
    renderScreen({ initialReceiptId: RECEIPT_ID, currentUserId: APPROVER });
    const panel = await screen.findByTestId('payments-replacement');
    await user.click(
      within(panel).getByRole('button', { name: EN['payments.replacement.open'] as string })
    );
    const form = await within(panel).findByRole('form', {
      name: EN['payments.replacement.heading'] as string,
    });
    await user.click(
      within(form).getByRole('button', { name: EN['payments.replacement.submit'] as string })
    );
    const amount = within(form).getByLabelText(labelled('payments.record.amount'));
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    expect(recordReplacementReceipt).not.toHaveBeenCalled();
  });

  it('renders the pending reversal in Arabic, right to left', async () => {
    readReceipt.mockResolvedValue(okRead(detail({ reversal: pendingReversal() })));
    renderRtl(
      <PaymentsScreen
        locale="ar"
        messages={ar}
        initialReceiptId={RECEIPT_ID}
        initialInvoiceId={null}
        canRecord={true}
        canAllocate={true}
        canReadCustomers={true}
        canDecideReversals={true}
        currentUserId={APPROVER}
      />
    );
    const section = await screen.findByRole('region', {
      name: AR['payments.reversal.heading'] as string,
    });
    expect(within(section).getByTestId('payments-reversal-pending')).toHaveTextContent(
      AR['payments.reversal.pendingBanner'] as string
    );
    expect(
      within(section).getByRole('button', { name: AR['payments.reversal.approve'] as string })
    ).toBeVisible();
    expect(
      within(section).getByRole('button', { name: AR['payments.reversal.reject'] as string })
    ).toBeVisible();
    expect(await screen.findByTestId('payments-allocate-reversal-pending')).toHaveTextContent(
      AR['payments.allocate.reversalPending'] as string
    );
  });

  describe('the replacement form and a branch switch', () => {
    afterEach(forgetRememberedBranch);
    /*
     * Another payer or another method is the usual reason to replace a
     * receipt, so each is unsaved work against the PREFILLED form, as a typed
     * amount is. A receipt named in the address survives the first choice of
     * a branch, which is what lets these cases switch with the form open.
     */
    const SECOND_METHOD_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const OTHER_PAYER_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';

    async function openReplacement(user: ReturnType<typeof userEvent.setup>) {
      listPaymentMethods.mockResolvedValue(
        okRead({
          items: [
            tenantMethod,
            { ...tenantMethod, id: SECOND_METHOD_ID, kind: 'card', displayName: 'Counter card' },
            platformMethod,
          ],
        })
      );
      readReceipt.mockResolvedValue(
        okRead(
          detail({
            status: 'reversed',
            reversal: pendingReversal({
              state: 'approved',
              decidedBy: APPROVER,
              decidedAt: '2026-10-02T09:00:00.000Z',
              reversedAt: '2026-10-02T09:00:00.000Z',
            }),
          })
        )
      );
      renderLtr(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="first" />
            <BranchSwitch to={OTHER_BRANCH.id} label="second" />
            <WorkingBranchProbe />
            {screenFor({ initialReceiptId: RECEIPT_ID, currentUserId: APPROVER })}
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        )
      );
      const panel = await screen.findByTestId('payments-replacement');
      await user.click(
        within(panel).getByRole('button', { name: EN['payments.replacement.open'] as string })
      );
      const form = await within(panel).findByRole('form', {
        name: EN['payments.replacement.heading'] as string,
      });
      await waitFor(() => expect(payerBox(form)).toHaveValue('Layla Haddad'));
      return form;
    }

    const payerBox = (form: HTMLElement) =>
      within(form).getByLabelText(labelled('payments.record.payer'));
    const methodBox = (form: HTMLElement) =>
      within(form).getByLabelText(labelled('payments.record.method'));

    it('the untouched prefilled form switches without asking, and keeps its payer', async () => {
      const user = userEvent.setup();
      const form = await openReplacement(user);
      await switchWithoutQuestion(user, 'first');
      await waitFor(() => expect(heldBranch()).toBe(TEST_BRANCH.id));
      // The receipt's payer is put back after the switch, so nothing reads as changed.
      await waitFor(() => expect(payerBox(form)).toHaveValue('Layla Haddad'));
      await switchWithoutQuestion(user, 'second');
    });

    /*
     * The method cases are two, not one: a single case making three switches
     * with the form open outran the per-case budget under hosted coverage.
     */
    it('another method asks first, and staying keeps the method chosen', async () => {
      const user = userEvent.setup();
      const form = await openReplacement(user);
      await user.selectOptions(methodBox(form), SECOND_METHOD_ID);
      await stayOnBranch(user, await switchExpectingQuestion(user, 'first'));
      expect(heldBranch()).not.toBe(TEST_BRANCH.id);
      expect(methodBox(form)).toHaveValue(SECOND_METHOD_ID);
      expect(recordReplacementReceipt).not.toHaveBeenCalled();
    });

    it('another method asks first, and discarding puts the prefilled method and payer back', async () => {
      const user = userEvent.setup();
      const form = await openReplacement(user);
      await user.selectOptions(methodBox(form), SECOND_METHOD_ID);
      await discardAndSwitch(user, await switchExpectingQuestion(user, 'first'));
      await waitFor(() => expect(heldBranch()).toBe(TEST_BRANCH.id));
      await waitFor(() => expect(methodBox(form)).toHaveValue(METHOD_ID));
      expect(payerBox(form)).toHaveValue('Layla Haddad');
      await switchWithoutQuestion(user, 'second');
      expect(recordReplacementReceipt).not.toHaveBeenCalled();
    });

    it('another payer asks first, and staying keeps the payer chosen', async () => {
      const user = userEvent.setup();
      searchCustomerDirectory.mockResolvedValue({
        status: 'ok',
        rows: [{ ...customerHit, id: OTHER_PAYER_ID, displayName: 'Sami Khoury' }],
        nextCursor: null,
        hasMore: false,
        correlationId: 'corr-c',
      });
      const form = await openReplacement(user);
      await user.click(
        within(form).getByRole('button', { name: EN['customerSelector.change'] as string })
      );
      await user.type(payerBox(form), 'Sami');
      await user.click(await findSearchedOption(searchCustomerDirectory, 'Sami', /Sami Khoury/));
      await waitFor(() => expect(valueOf(payerBox(form))).toContain('Sami Khoury'));
      await stayOnBranch(user, await switchExpectingQuestion(user, 'first'));
      expect(heldBranch()).not.toBe(TEST_BRANCH.id);
      expect(valueOf(payerBox(form))).toContain('Sami Khoury');
      expect(recordReplacementReceipt).not.toHaveBeenCalled();
    });
  });
});
