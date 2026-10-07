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
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
import { findSearchedOption } from './support/picker-option';
import {
  ALLOCATION_ID,
  AR,
  BRANCH_ID,
  COMPANY_ID,
  EN,
  INVOICE_ID,
  METHOD_ID,
  OPEN_RECEIPT,
  PARTNER_ID,
  RECEIPT_ID,
  UUID_SHAPE,
  chooseBranch,
  customerHit,
  detail,
  escape,
  labelled,
  money,
  okRead,
  paymentsHarness,
  platformMethod,
  receipt,
  renderLtr,
  renderRtl,
  seedPaymentDefaults,
  tenantMethod,
  valueOf,
  type RoutePage,
} from './support/payments-screen';

/**
 * Payments and receipts, rendered — the printable receipt, the route page, Arabic, the finance retest fixes and the receipt reversal.
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

const { screenFor, renderScreen, choosePayer, chooseInvoice, confirmApply, renderPage } =
  paymentsHarness({
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

  it('names itself, title and receipt reference, in a head row drawn only on paper', async () => {
    // Every printed page after the first otherwise said nothing about which
    // receipt it belonged to (2026-10-07 browser retest).
    const user = userEvent.setup();
    const document = await openPrint(user);
    const identity = within(document).getByTestId('print-document-identity');
    expect(identity.tagName).toBe('THEAD');
    const classes = identity.className.split(/\s+/);
    expect(classes).toContain('hidden');
    expect(classes).toContain('print:table-header-group');
    expect(identity).toHaveTextContent(`${EN['payments.print.title']} · RCT-000007`);
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
