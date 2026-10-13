import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect, type Mock } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import en from '../../src/i18n/messages/en.json';
import ar from '../../src/i18n/messages/ar.json';
import { formatMoney } from '../../src/lib/money';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import type { PaymentsScreen } from '@/features/payments/components/PaymentsScreen';
import {
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
} from '../render';
import { findSearchedOption } from './picker-option';

/**
 * Payments and receipts, rendered (P1-30, `W7`, FE-016, FE-017, FE-018,
 * FE-021) — the fixtures and helpers the four `payments-*.dom.test.tsx` files
 * share.
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
 *
 * ## What stays in each file
 *
 * The replaced adapters — every `vi.fn()` and the `vi.mock` that routes to it —
 * are declared in each test file, because `vi.mock` is hoisted above the
 * imports of the file that calls it. The screen and the route page are imported
 * there too, after those mocks. Everything here that needs one of them takes it
 * as an argument (`seedPaymentDefaults`, `paymentsHarness`).
 */

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
export const renderLtr = (ui: ReactElement) => renderLtrBare(withMui(ui, 'en'));
export const renderRtl = (ui: ReactElement) =>
  renderRtlBare(withMui(inBranch(ui, { locale: 'ar' }), 'ar'));

export const EN = en as Record<string, string>;
export const AR = ar as Record<string, string>;

export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
export const money = (amount: string, currency = 'USD') => formatMoney({ amount, currency }, 'en');

export const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
export const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
export const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
export const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
export const PARTNER_ID = '55555555-5555-4555-8555-555555555555';
export const METHOD_ID = '66666666-6666-4666-8666-666666666666';
export const ALLOCATION_ID = '88888888-8888-4888-8888-888888888888';
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const tenantMethod = {
  id: METHOD_ID,
  scope: 'tenant',
  methodCode: 'cash',
  kind: 'cash',
  displayName: 'Front desk cash',
  status: 'active',
  recordable: true,
};
export const platformMethod = {
  id: '77777777-7777-4777-8777-777777777777',
  scope: 'platform',
  methodCode: 'cash',
  kind: 'cash',
  displayName: 'Cash',
  status: 'active',
  recordable: false,
};

export const receipt = {
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

export const detail = (over: Record<string, unknown> = {}) => ({
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

export const okRead = (data: unknown) => ({ status: 'ok', data, correlationId: 'corr-1' });

export const customerHit = {
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

export const invoiceEntry = {
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
export const refusedRead = (status: string, correlationId = 'corr-403') => ({
  status,
  correlationId,
});
export const okPage = (rows: readonly unknown[]) => ({
  status: 'ok',
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-1',
});

/** The replaced reads and writes whose answers every case starts from. */
export interface PaymentDefaultMocks {
  readonly listReceipts: Mock;
  readonly readReceiptPayer: Mock;
  readonly readReceipt: Mock;
  readonly listPaymentMethods: Mock;
  readonly listBranches: Mock;
  readonly searchCustomerDirectory: Mock;
  readonly listInvoices: Mock;
  readonly readOutstanding: Mock;
  readonly recordPayment: Mock;
  readonly allocatePayment: Mock;
}

/**
 * The answers every case starts from, set on the calling file's own mocks.
 * Called from that file's `beforeEach`, after `vi.clearAllMocks()`.
 */
export function seedPaymentDefaults(mocks: PaymentDefaultMocks): void {
  mocks.listReceipts.mockResolvedValue(okPage([receipt]));
  mocks.readReceiptPayer.mockResolvedValue({
    displayName: 'Layla Haddad',
    displayNumber: 'C-000482',
    partyType: 'individual',
  });
  mocks.readReceipt.mockResolvedValue(okRead(detail()));
  mocks.listPaymentMethods.mockResolvedValue(okRead({ items: [tenantMethod, platformMethod] }));
  mocks.listBranches.mockResolvedValue(okRead({ items: [] }));
  mocks.searchCustomerDirectory.mockResolvedValue({
    status: 'ok',
    rows: [customerHit],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-c',
  });
  mocks.listInvoices.mockResolvedValue(
    okRead({ items: [invoiceEntry], nextCursor: null, hasMore: false })
  );
  mocks.readOutstanding.mockResolvedValue(
    okRead({
      invoiceId: INVOICE_ID,
      status: 'issued',
      outstanding: { amount: '40.0000', currency: 'USD' },
      isSettled: false,
    })
  );
  mocks.recordPayment.mockResolvedValue({
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
  mocks.allocatePayment.mockResolvedValue({
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
}

/** The payments route page, called the way Next.js calls it. */
export type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<ReactNode>;

/**
 * The working branch, as the screen states it.
 *
 * It used to be CHOSEN here — two references typed and a submit pressed —
 * which is what opened every other panel. The header holds it now, so this
 * only confirms the screen is addressed to it; kept as a step so the
 * cases that named a branch read the same.
 */
export async function chooseBranch() {
  expect(await screen.findByTestId('payments-branch-target')).toHaveTextContent(TEST_BRANCH.name);
}

/** A combobox's text: the chosen record's name once one is chosen. */
export const valueOf = (element: HTMLElement) => (element as HTMLInputElement).value;

/** The payer and invoice filters, beside the state chips. */
export const pickerFilters = () =>
  screen.getByRole('group', { name: EN['payments.list.moreFilters'] as string });

/** A receipt row's own action: "Open", named by the receipt it opens. */
export const OPEN_RECEIPT = `${EN['payments.list.open']} RCT-000007`;

/**
 * The helpers that render the screen or reach a replaced adapter, bound to the
 * calling file's own screen, route page and mocks.
 */
export function paymentsHarness(deps: {
  readonly PaymentsScreen: typeof PaymentsScreen;
  readonly PaymentsPage: RoutePage;
  readonly searchCustomerDirectory: Mock;
  readonly listInvoices: Mock;
  readonly allocatePayment: Mock;
}) {
  const { PaymentsScreen: Screen, PaymentsPage, searchCustomerDirectory, listInvoices } = deps;

  function screenFor(over: Record<string, unknown> = {}) {
    return (
      <Screen
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

  /** The allocation question, answered: nothing is applied before it. */
  async function confirmApply(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['payments.allocate.confirmTitle'] as string,
    });
    expect(deps.allocatePayment).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
  }

  async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
    const tree = await PaymentsPage({
      params: Promise.resolve(params),
      searchParams: Promise.resolve(search),
    });
    return renderLtr(tree as ReactElement);
  }

  return { screenFor, renderScreen, choosePayer, chooseInvoice, confirmApply, renderPage };
}
