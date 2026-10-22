import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  WorkingBranchProbe,
} from './render';
import {
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
  METHOD_ID,
  PARTNER_ID,
  RECEIPT_ID,
  UUID_SHAPE,
  chooseBranch,
  customerHit,
  invoiceEntry,
  labelled,
  okRead,
  paymentsHarness,
  pickerFilters,
  platformMethod,
  refusedRead,
  renderLtr,
  seedPaymentDefaults,
  valueOf,
  type RoutePage,
} from './support/payments-screen';

/**
 * Payments and receipts, rendered — recording a payment, and how its payer is found or typed.
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
