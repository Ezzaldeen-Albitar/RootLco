import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import type { ReactElement } from 'react';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
  WorkingBranchProbe,
} from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { formatMessage, getMessages } from '@/i18n/get-messages';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  switchExpectingQuestion,
} from './support/branch-switch';
import { findSearchedOption } from './support/picker-option';

/**
 * A receipt applied to someone else's invoice (Owner decision D14, ADR-023),
 * rendered.
 *
 * The properties under test: when the chosen invoice bills a different customer
 * from the receipt's payer the form says so at once; a caller without the
 * third-party code is offered no way round it and the attempt is refused on the
 * invoice box before anything is sent; a holder of the code is offered "This is a
 * third-party payment" with who the payer is, the authorisation reference and the
 * reason, each refused on its own field, focused first, kept as typed and cleared
 * when corrected; the request carries the trimmed statement and the question says
 * it is a third-party payment; an invoice named in the address learns it from the
 * server's refusal; the new fields are unsaved work; and the receipt reads "Paid by
 * <payer> (<relationship>) for <customer>" with the authorisation, in English and
 * in Arabic.
 *
 * Kept apart from `payments.dom.test.tsx`, whose cases already run for twenty
 * seconds each under coverage: every case here is one short journey.
 */

function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderLtrBare(withMui(ui, 'en'));
const renderRtl = (ui: ReactElement) =>
  renderRtlBare(withMui(inBranch(ui, { locale: 'ar' }), 'ar'));

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/**
 * The status region announcing that the invoice is someone else's, with the
 * sentence under it — found by its role, so the notice is announced to a screen
 * reader while focus stays in the invoice picker.
 */
function announcedStatus(form: HTMLElement, sentence: string): HTMLElement | undefined {
  return within(form)
    .getAllByRole('status')
    .find(
      (region) =>
        region.textContent?.includes(EN['payments.thirdParty.otherCustomer'] as string) &&
        region.textContent.includes(EN[sentence] as string)
    );
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listReceipts = vi.fn();
const readReceipt = vi.fn();
const readOutstanding = vi.fn();
const allocatePayment = vi.fn();
const readReceiptPayer = vi.fn();
vi.mock('@/features/payments/api', () => ({
  requestReceiptReversal: vi.fn(),
  approveReceiptReversal: vi.fn(),
  rejectReceiptReversal: vi.fn(),
  withdrawReceiptReversal: vi.fn(),
  recordReplacementReceipt: vi.fn(),
  readReceiptPayer: (...args: unknown[]) => readReceiptPayer(...args),
  listReceipts: (...args: unknown[]) => listReceipts(...args),
  readReceipt: (...args: unknown[]) => readReceipt(...args),
  listPaymentMethods: vi.fn(async () => ({ status: 'ok', data: { items: [] } })),
  listBranches: vi.fn(),
  readOutstanding: (...args: unknown[]) => readOutstanding(...args),
  recordPayment: vi.fn(),
  allocatePayment: (...args: unknown[]) => allocatePayment(...args),
}));
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: vi.fn(),
}));
const listInvoices = vi.fn();
vi.mock('@/features/billing/api', () => ({
  listInvoices: (...args: unknown[]) => listInvoices(...args),
}));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: vi.fn(() => true),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { PaymentsScreen, __resetUncertainAllocationsForTests } =
  await import('@/features/payments/components/PaymentsScreen');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const PAYER_ID = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_ID = '99999999-9999-4999-8999-999999999999';

const receipt = {
  id: RECEIPT_ID,
  reference: 'RCT-000007',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  payerPartnerId: PAYER_ID,
  method: null,
  money: { amount: '100.0000', currency: 'USD', minorUnit: 2 },
  unallocated: { amount: '100.0000', currency: 'USD', minorUnit: 2 },
  status: 'recorded',
  receivedAt: '2026-10-02T09:00:00.000Z',
  evidenceDocumentVersionId: null,
  recordVersion: 1,
  allocations: [],
  allocationsTruncated: false,
  reversal: null,
  replaces: null,
  replacedBy: null,
};

/** An issued invoice of ANOTHER customer, in the receipt's branch. */
const otherInvoice = {
  id: INVOICE_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  workOrderId: null,
  saleKind: 'work_order',
  quotationRevisionId: null,
  payerPartnerId: CUSTOMER_ID,
  currency: 'USD',
  status: 'issued',
  invoiceNumber: 'INV-000124',
  issuedAt: '2026-10-01T09:00:00.000Z',
  recordVersion: 2,
  totals: null,
  payer: { displayName: 'Omar Saleh', displayNumber: 'C-000501', partyType: 'individual' },
  outstanding: { amount: '100.0000', currency: 'USD' },
};

const okRead = (data: unknown) => ({ status: 'ok', data, correlationId: 'corr-1' });

afterEach(() => __resetUncertainAllocationsForTests());

beforeEach(() => {
  __resetUncertainAllocationsForTests();
  vi.clearAllMocks();
  listReceipts.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-1',
  });
  readReceiptPayer.mockResolvedValue({
    displayName: 'Layla Haddad',
    displayNumber: 'C-000482',
    partyType: 'individual',
  });
  readReceipt.mockResolvedValue(okRead(receipt));
  listInvoices.mockResolvedValue(
    okRead({ items: [otherInvoice], nextCursor: null, hasMore: false })
  );
  readOutstanding.mockResolvedValue(
    okRead({
      invoiceId: INVOICE_ID,
      status: 'issued',
      outstanding: { amount: '30.0000', currency: 'USD' },
      isSettled: false,
    })
  );
  allocatePayment.mockResolvedValue({
    state: { status: 'success', messageKey: 'payments.allocate.success', attempt: 1 },
    created: {
      id: 'alloc-1',
      sequence: '1',
      receiptId: RECEIPT_ID,
      invoiceId: INVOICE_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      money: { amount: '70.0000', currency: 'USD' },
      allocatedAt: '2026-10-02T09:10:00.000Z',
      receiptStatus: 'partially_allocated',
      receiptUnallocated: { amount: '30.0000', currency: 'USD' },
      thirdParty: null,
    },
  });
});

function screenFor(over: Record<string, unknown> = {}) {
  return (
    <PaymentsScreen
      locale="en"
      messages={en}
      initialReceiptId={RECEIPT_ID}
      initialInvoiceId={null}
      canRecord={false}
      canAllocate={true}
      canReadCustomers={true}
      canListInvoices={true}
      {...over}
    />
  );
}

async function openForm(over: Record<string, unknown> = {}) {
  renderLtr(inBranch(screenFor(over)));
  return screen.findByRole('form', { name: EN['payments.allocate.formLabel'] as string });
}

async function chooseOtherInvoice(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
  await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), 'INV-0001');
  await user.click(await findSearchedOption(listInvoices, 'INV-0001', /INV-000124/));
}

const submit = (user: ReturnType<typeof userEvent.setup>, form: HTMLElement) =>
  user.click(within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string }));

describe('someone else’s invoice, without the third-party code', () => {
  it('says whose invoice it is, offers no way round it, and refuses on the invoice box before sending', async () => {
    const user = userEvent.setup();
    const form = await openForm({ canAllocateThirdParty: false });
    await chooseOtherInvoice(user, form);
    const notice = await within(form).findByTestId('payments-third-party-notice');
    expect(notice).toHaveTextContent(EN['payments.thirdParty.otherCustomer'] as string);
    expect(notice).toHaveTextContent(EN['payments.thirdParty.blocked'] as string);
    expect(announcedStatus(form, 'payments.thirdParty.blocked')).toBe(notice);
    expect(within(form).queryByTestId('payments-third-party-option')).toBeNull();
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '10.00');
    await submit(user, form);
    const invoiceBox = within(form).getByLabelText(labelled('payments.allocate.invoice'));
    await waitFor(() => expect(invoiceBox).toHaveAttribute('aria-invalid', 'true'));
    expect(form).toHaveTextContent(EN['form.violation.allocation_payer_mismatch'] as string);
    await waitFor(() => expect(invoiceBox).toHaveFocus());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(allocatePayment).not.toHaveBeenCalled();
  });
});

describe('someone else’s invoice, for a holder of the third-party code', () => {
  it('refuses each missing statement on its field, focuses the first, keeps what was typed and clears a corrected field', async () => {
    const user = userEvent.setup();
    const form = await openForm({ canAllocateThirdParty: true });
    await chooseOtherInvoice(user, form);
    const notice = await within(form).findByTestId('payments-third-party-notice');
    expect(notice).toHaveTextContent(EN['payments.thirdParty.mayRecord'] as string);
    expect(announcedStatus(form, 'payments.thirdParty.mayRecord')).toBe(notice);
    await user.click(within(form).getByLabelText(EN['payments.thirdParty.option'] as string));
    const relationship = within(form).getByLabelText(labelled('payments.thirdParty.relationship'));
    const reference = within(form).getByLabelText(labelled('payments.thirdParty.reference'));
    await user.type(reference, 'CLM-9');
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '70.0000');
    await submit(user, form);
    await waitFor(() => expect(relationship).toHaveAttribute('aria-invalid', 'true'));
    await waitFor(() => expect(relationship).toHaveFocus());
    expect(form).toHaveTextContent(EN['form.violation.third_party_relationship_invalid'] as string);
    expect(form).toHaveTextContent(EN['form.violation.third_party_reason_required'] as string);
    expect(reference).toHaveValue('CLM-9');
    expect(reference).not.toHaveAttribute('aria-invalid', 'true');
    // 'other' asks the reason to say who the payer is, in those words.
    await user.selectOptions(relationship, 'other');
    expect(relationship).not.toHaveAttribute('aria-invalid', 'true');
    await submit(user, form);
    const reason = within(form).getByLabelText(labelled('payments.thirdParty.reason'));
    await waitFor(() => expect(reason).toHaveAttribute('aria-invalid', 'true'));
    expect(form).toHaveTextContent(EN['form.violation.third_party_other_unexplained'] as string);
    await user.type(reason, 'x');
    expect(reason).not.toHaveAttribute('aria-invalid', 'true');
    expect(allocatePayment).not.toHaveBeenCalled();
  });

  it('asks as a third-party payment and sends the trimmed statement with the receipt’s currency', async () => {
    const user = userEvent.setup();
    const form = await openForm({ canAllocateThirdParty: true });
    await chooseOtherInvoice(user, form);
    await user.click(
      await within(form).findByLabelText(EN['payments.thirdParty.option'] as string)
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('payments.thirdParty.relationship')),
      'insurer'
    );
    await user.type(
      within(form).getByLabelText(labelled('payments.thirdParty.reference')),
      '  CLM-2026-0042 '
    );
    await user.type(
      within(form).getByLabelText(labelled('payments.thirdParty.reason')),
      'Covered by the policy'
    );
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '70.0000');
    await submit(user, form);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('INV-000124');
    expect(dialog).toHaveTextContent(/third-party payment/);
    await user.click(
      within(dialog).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    await waitFor(() => expect(allocatePayment).toHaveBeenCalledTimes(1));
    expect(allocatePayment.mock.calls[0]?.[1]).toEqual({
      invoiceId: INVOICE_ID,
      amount: '70.0000',
      currency: 'USD',
      thirdParty: {
        relationship: 'insurer',
        authorisationReference: 'CLM-2026-0042',
        reason: 'Covered by the policy',
      },
    });
  });

  it('withdraws the choice when another invoice is chosen, so its statement is never booked unseen', async () => {
    listInvoices.mockResolvedValue(
      okRead({
        items: [
          otherInvoice,
          {
            ...otherInvoice,
            id: '66666666-6666-4666-8666-666666666666',
            payerPartnerId: '77777777-7777-4777-8777-777777777777',
            invoiceNumber: 'INV-000125',
            payer: {
              displayName: 'Sami Nasser',
              displayNumber: 'C-000502',
              partyType: 'individual',
            },
          },
        ],
        nextCursor: null,
        hasMore: false,
      })
    );
    const user = userEvent.setup();
    const form = await openForm({ canAllocateThirdParty: true });
    await chooseOtherInvoice(user, form);
    await user.click(
      await within(form).findByLabelText(EN['payments.thirdParty.option'] as string)
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('payments.thirdParty.relationship')),
      'insurer'
    );
    await user.type(
      within(form).getByLabelText(labelled('payments.thirdParty.reference')),
      'CLM-FOR-124'
    );
    await user.type(
      within(form).getByLabelText(labelled('payments.thirdParty.reason')),
      'Covered by the policy'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.picker.change'] as string })
    );
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), 'INV-0002');
    await user.click(await findSearchedOption(listInvoices, 'INV-0002', /INV-000125/));
    await within(form).findByTestId('payments-third-party-notice');
    const option = within(form).getByLabelText(EN['payments.thirdParty.option'] as string);
    expect(option).not.toBeChecked();
    expect(within(form).queryByLabelText(labelled('payments.thirdParty.reference'))).toBeNull();
    // Unticked, the allocation is refused before anything is sent.
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '70.0000');
    await submit(user, form);
    await waitFor(() =>
      expect(within(form).getByLabelText(labelled('payments.allocate.invoice'))).toHaveAttribute(
        'aria-invalid',
        'true'
      )
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(allocatePayment).not.toHaveBeenCalled();
    // Ticked again, the statement typed earlier is shown for review, not lost.
    await user.click(option);
    expect(within(form).getByLabelText(labelled('payments.thirdParty.reference'))).toHaveValue(
      'CLM-FOR-124'
    );
  });

  it('offers nothing for the payer’s own invoice', async () => {
    listInvoices.mockResolvedValue(
      okRead({
        items: [{ ...otherInvoice, payerPartnerId: PAYER_ID }],
        nextCursor: null,
        hasMore: false,
      })
    );
    const user = userEvent.setup();
    const form = await openForm({ canAllocateThirdParty: true });
    await chooseOtherInvoice(user, form);
    expect(within(form).queryByTestId('payments-third-party-notice')).toBeNull();
    expect(within(form).queryByTestId('payments-third-party-option')).toBeNull();
  });
});

describe('an invoice named in the address', () => {
  it('learns from the server’s refusal that it is someone else’s, opens the option, and counts the statement as unsaved work', async () => {
    allocatePayment.mockResolvedValueOnce({
      state: {
        status: 'conflict',
        messageKey: 'form.formError',
        fieldErrors: { invoiceId: 'form.violation.allocation_payer_mismatch' },
        attempt: 1,
        correlationId: 'corr-409',
      },
      created: null,
    });
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <WorkingBranchProbe />
          {screenFor({ initialInvoiceId: INVOICE_ID, canAllocateThirdParty: true })}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    const amount = within(form).getByLabelText(labelled('payments.allocate.amount'));
    try {
      await user.type(amount, '10.00');
      await submit(user, form);
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: EN['payments.allocate.submit'] as string,
        })
      );
      const option = await within(form).findByLabelText(EN['payments.thirdParty.option'] as string);
      expect(within(form).getByTestId('payments-third-party-notice')).toBeVisible();
      // Only the statement is left typed: it alone is unsaved work.
      await user.clear(amount);
      await user.click(option);
      await user.type(
        within(form).getByLabelText(labelled('payments.thirdParty.reference')),
        'CLM-1'
      );
      await discardAndSwitch(user, await switchExpectingQuestion(user, 'first'));
      await waitFor(() => expect(heldBranch()).toBe(TEST_BRANCH.id));
      await waitFor(() =>
        expect(within(form).queryByLabelText(labelled('payments.thirdParty.reference'))).toBeNull()
      );
    } finally {
      forgetRememberedBranch();
    }
  });
});

describe('the receipt says who paid for whom', () => {
  const paidForOther = {
    ...receipt,
    status: 'partially_allocated',
    unallocated: { amount: '30.0000', currency: 'USD', minorUnit: 2 },
    allocations: [
      {
        id: 'alloc-1',
        sequence: '1',
        invoiceId: INVOICE_ID,
        invoiceNumber: 'INV-000124',
        invoicePayerName: 'Omar Saleh',
        money: { amount: '70.0000', currency: 'USD', minorUnit: 2 },
        allocatedAt: '2026-10-02T09:10:00.000Z',
        thirdParty: {
          relationship: 'insurer',
          authorisationReference: 'CLM-2026-0042',
          reason: 'Covered by the policy',
          authorisedByName: 'Finance Officer',
        },
      },
    ],
  };

  it('in English, with the authorisation', async () => {
    readReceipt.mockResolvedValue(okRead(paidForOther));
    renderLtr(inBranch(screenFor()));
    const line = await screen.findByTestId('third-party-paid-by');
    await waitFor(() =>
      expect(line).toHaveTextContent(
        formatMessage(EN['payments.thirdParty.paidBy'] as string, {
          payer: 'Layla Haddad',
          relationship: EN['payments.thirdParty.relationship.insurer'] as string,
          customer: 'Omar Saleh',
        })
      )
    );
    expect(line).toHaveTextContent('CLM-2026-0042');
  });

  it('in Arabic, right to left, a withheld customer said as withheld', async () => {
    readReceipt.mockResolvedValue(
      okRead({
        ...paidForOther,
        allocations: [{ ...paidForOther.allocations[0], invoicePayerName: null }],
      })
    );
    renderRtl(screenFor({ locale: 'ar', messages: ar }));
    const line = await screen.findByTestId('third-party-paid-by');
    await waitFor(() =>
      expect(line).toHaveTextContent(
        formatMessage(AR['payments.thirdParty.paidBy'] as string, {
          payer: 'Layla Haddad',
          relationship: AR['payments.thirdParty.relationship.insurer'] as string,
          customer: AR['payments.thirdParty.customerNotShown'] as string,
        })
      )
    );
    expect(line).toHaveTextContent('CLM-2026-0042');
    expect(line.closest('[dir="rtl"]')).not.toBeNull();
  });
});
