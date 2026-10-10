import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  RETIRED_BOX,
  WorkingBranchProbe,
} from './render';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  INVOICE_ID,
  OPEN_RECEIPT,
  PARTNER_ID,
  RECEIPT_ID,
  chooseBranch,
  labelled,
  money,
  okPage,
  paymentsHarness,
  pickerFilters,
  receipt,
  renderLtr,
  seedPaymentDefaults,
  valueOf,
  type RoutePage,
} from './support/payments-screen';

/**
 * Payments and receipts, rendered — the working branch, a half-filled form across a branch switch, and the receipts of the branch.
 *
 * One of four files cut from one by its top-level `describe` blocks, so the
 * cases spread across workers; the properties under test, and the fixtures and
 * helpers the four share, are in `support/payments-screen.tsx`.
 */

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

const notifyActionResult = vi.fn<(...args: unknown[]) => boolean>(() => true);
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
const PaymentsPage = (await import('@/app/[locale]/(dashboard)/payments/page'))
  .default as unknown as RoutePage;

const { screenFor, renderScreen, choosePayer, chooseInvoice } = paymentsHarness({
  PaymentsScreen,
  PaymentsPage,
  searchCustomerDirectory,
  listInvoices,
  allocatePayment,
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
  seedPaymentDefaults({
    listReceipts,
    readReceiptPayer,
    readReceipt,
    listPaymentMethods,
    listBranches,
    searchCustomerDirectory,
    listInvoices,
    readOutstanding,
    recordPayment,
    allocatePayment,
  });
});

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
