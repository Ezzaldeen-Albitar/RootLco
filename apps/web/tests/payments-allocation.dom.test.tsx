import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import { formatMoney } from '../src/lib/money';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  WorkingBranchProbe,
} from './render';
import { formatMessage } from '@/i18n/get-messages';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  switchExpectingQuestion,
} from './support/branch-switch';
import { findSearchedOption } from './support/picker-option';
import {
  ALLOCATION_ID,
  AR,
  BRANCH_ID,
  COMPANY_ID,
  EN,
  INVOICE_ID,
  OPEN_RECEIPT,
  PARTNER_ID,
  RECEIPT_ID,
  UUID_SHAPE,
  chooseBranch,
  detail,
  escape,
  invoiceEntry,
  labelled,
  money,
  okRead,
  paymentsHarness,
  pickerFilters,
  receipt,
  refusedRead,
  renderLtr,
  renderRtl,
  seedPaymentDefaults,
  type RoutePage,
} from './support/payments-screen';

/**
 * Payments and receipts, rendered — the receipt and its allocations, and applying a receipt to an invoice.
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

const { screenFor, renderScreen, chooseInvoice, confirmApply } = paymentsHarness({
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
