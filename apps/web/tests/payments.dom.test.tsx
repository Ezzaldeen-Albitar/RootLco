import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  renderLtr,
  renderRtl as renderInRtl,
} from './render';

/*
 * The branch the receipts belong to is the working context's own named
 * selection — chosen once in the header, never typed on this screen (Owner
 * directive, `P1-32-PRE-OD-UX`). So a screen render goes inside a provider,
 * holding one branch unless a case says otherwise.
 */
const renderRtl = (ui: ReactElement) => renderInRtl(inBranch(ui, { locale: 'ar' }));

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
 * the receipt says it holds no names; the printable copy names identifiers and
 * takes no figure of its own; and the route page decides before it reads.
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
vi.mock('@/features/payments/api', () => ({
  listReceipts: (...args: unknown[]) => listReceipts(...args),
  readReceipt: (...args: unknown[]) => readReceipt(...args),
  listPaymentMethods: (...args: unknown[]) => listPaymentMethods(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  readOutstanding: (...args: unknown[]) => readOutstanding(...args),
  recordPayment: (...args: unknown[]) => recordPayment(...args),
  allocatePayment: (...args: unknown[]) => allocatePayment(...args),
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

const { PaymentsScreen } = await import('@/features/payments/components/PaymentsScreen');
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
};

const detail = (over: Record<string, unknown> = {}) => ({
  ...receipt,
  allocations: [
    {
      id: 'alloc-1',
      sequence: '1',
      invoiceId: INVOICE_ID,
      money: { amount: '60.0000', currency: 'USD' },
      allocatedAt: '2026-09-05T09:05:00.000Z',
    },
  ],
  allocationsTruncated: false,
  ...over,
});

const okRead = (data: unknown) => ({ status: 'ok', data, correlationId: 'corr-1' });
const refusedRead = (status: string, correlationId = 'corr-403') => ({ status, correlationId });
const okPage = (rows: readonly unknown[]) => ({
  status: 'ok',
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-1',
});

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listReceipts.mockResolvedValue(okPage([receipt]));
  readReceipt.mockResolvedValue(okRead(detail()));
  listPaymentMethods.mockResolvedValue(okRead({ items: [tenantMethod, platformMethod] }));
  listBranches.mockResolvedValue(okRead({ items: [] }));
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

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await PaymentsPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

describe('nothing is read until the working context names one branch', () => {
  it('with several branches and none chosen, asks in the header and reads nothing', () => {
    renderScreen({}, branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    expect(screen.getByText(EN['payments.target.explain'] as string)).toBeVisible();
    expect(screen.getByText(EN['workingContext.chooseFirst'] as string)).toBeVisible();
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
    expect(screen.queryByLabelText(labelled('payments.common.companyIdField'))).toBeNull();
    expect(screen.queryByLabelText(labelled('payments.common.branchIdField'))).toBeNull();
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
    await user.click(await within(list).findByRole('button', { name: 'RCT-000007' }));
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

describe('the receipts of the branch', () => {
  it('renders the server’s strings and computes no figure of its own', async () => {
    renderScreen();
    await chooseBranch();
    const region = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    expect(within(region).getByText('RCT-000007')).toBeVisible();
    expect(within(region).getByText(money('100.0000'))).toBeVisible();
    expect(within(region).getByText(money('40.0000'))).toBeVisible();
    // The same word is an OPTION in the status filter, so the row is asserted
    // inside the table rather than anywhere in the panel.
    expect(
      within(within(region).getByRole('table')).getByText(
        EN['payments.status.partially_allocated'] as string
      )
    ).toBeVisible();
    expect(within(region).getByText(PARTNER_ID)).toBeVisible();
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
    const filters = screen.getByRole('form', {
      name: EN['payments.list.filtersLabel'] as string,
    });
    await user.type(
      within(filters).getByLabelText(labelled('payments.list.payerFilter')),
      PARTNER_ID
    );
    await user.click(
      within(filters).getByRole('button', { name: EN['payments.list.apply'] as string })
    );
    await waitFor(() =>
      expect(listReceipts.mock.calls.at(-1)?.[1]).toEqual({
        payerPartnerId: PARTNER_ID,
        status: null,
        invoiceId: null,
      })
    );
  });

  it('keeps the operator’s filters when a write re-reads the list', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await waitFor(() => expect(listReceipts).toHaveBeenCalled());
    const filters = screen.getByRole('form', {
      name: EN['payments.list.filtersLabel'] as string,
    });
    await user.type(
      within(filters).getByLabelText(labelled('payments.list.payerFilter')),
      PARTNER_ID
    );
    await user.click(
      within(filters).getByRole('button', { name: EN['payments.list.apply'] as string })
    );
    await waitFor(() =>
      expect(listReceipts.mock.calls.at(-1)?.[1]?.payerPartnerId).toBe(PARTNER_ID)
    );

    const form = await screen.findByRole('form', {
      name: EN['payments.record.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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
      (
        within(
          screen.getByRole('form', { name: EN['payments.list.filtersLabel'] as string })
        ).getByLabelText(labelled('payments.list.payerFilter')) as HTMLInputElement
      ).value
    ).toBe(PARTNER_ID);
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
    await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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
    await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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
    await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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
    await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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
    await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
    await user.type(within(form).getByLabelText(labelled('payments.record.currency')), 'USD');
    await user.type(within(form).getByLabelText(labelled('payments.record.amount')), '100.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.record.submit'] as string })
    );
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(EN['payments.record.recorded'] as string);
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
      await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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
    await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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
      await user.type(within(form).getByLabelText(labelled('payments.record.payer')), PARTNER_ID);
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

describe('the receipt and its allocations', () => {
  async function openReceipt(user: ReturnType<typeof userEvent.setup>) {
    renderScreen();
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(within(list).getByRole('button', { name: 'RCT-000007' }));
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

  it('renders the receipt’s figures and its allocation history', async () => {
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText(money('100.0000'))).toBeVisible();
    expect(within(region).getByText(money('40.0000'))).toBeVisible();
    expect(within(region).getByText(money('60.0000'))).toBeVisible();
    expect(within(region).getAllByText(INVOICE_ID).length).toBeGreaterThan(0);
  });

  it('says the reads carry no payer name and no cashier', async () => {
    const user = userEvent.setup();
    const region = await openReceipt(user);
    expect(within(region).getByText(EN['payments.receipt.noNames'] as string)).toBeVisible();
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
    await user.click(within(list).getByRole('button', { name: 'RCT-000007' }));
    return screen.findByRole('region', { name: EN['payments.receipt.heading'] as string });
  }

  async function apply(user: ReturnType<typeof userEvent.setup>, amount: string) {
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), INVOICE_ID);
    await user.type(
      within(form).getByLabelText(new RegExp(escape(EN['payments.allocate.amount'] as string))),
      amount
    );
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
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

  it('sends the RECEIPT’s own currency, its own key, and no version', async () => {
    const user = userEvent.setup();
    await openReceipt(user);
    const form = await screen.findByRole('form', {
      name: EN['payments.allocate.formLabel'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), INVOICE_ID);
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '40.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
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
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), INVOICE_ID);
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
    expect(
      within(form).getByLabelText(new RegExp(`\\(${receipt.money.currency}\\)`))
    ).toBeVisible();
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
    await user.type(within(form).getByLabelText(labelled('payments.allocate.invoice')), INVOICE_ID);
    await user.type(within(form).getByLabelText(labelled('payments.allocate.amount')), '90.0000');
    await user.click(
      within(form).getByRole('button', { name: EN['payments.allocate.submit'] as string })
    );
    // Rendered, not merely present on the outcome object.
    expect(await screen.findByText('corr-409')).toBeVisible();
    expect(
      screen.queryByText(EN['payments.allocate.invoiceOpen'] as string, { exact: false })
    ).toBeNull();
    expect(readOutstanding).not.toHaveBeenCalled();
  });
});

describe('the printable receipt (FE-021)', () => {
  async function openPrint(user: ReturnType<typeof userEvent.setup>) {
    renderScreen();
    await chooseBranch();
    const list = await screen.findByRole('region', {
      name: EN['payments.list.heading'] as string,
    });
    await user.click(within(list).getByRole('button', { name: 'RCT-000007' }));
    await screen.findByRole('region', { name: EN['payments.receipt.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['payments.print.open'] as string }));
    return screen.findByRole('article');
  }

  it('names the payer and each invoice by identifier, and says why', async () => {
    const user = userEvent.setup();
    const document = await openPrint(user);
    expect(within(document).getByText(PARTNER_ID)).toBeVisible();
    expect(within(document).getByText(INVOICE_ID)).toBeVisible();
    expect(
      within(document).getByText(EN['payments.print.identifiersOnly'] as string, { exact: false })
    ).toBeVisible();
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
    await user.click(within(list).getByRole('button', { name: 'RCT-000007' }));
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
    expect(
      (within(form).getByLabelText(labelled('payments.allocate.invoice')) as HTMLInputElement).value
    ).toBe('');
  });
});

describe('Arabic', () => {
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
      />
    );
    const form = await screen.findByRole('form', {
      name: AR['payments.record.formLabel'] as string,
    });
    await user.type(
      within(form).getByLabelText(new RegExp(`^${escape(AR['payments.record.payer'] as string)}`)),
      PARTNER_ID
    );
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
