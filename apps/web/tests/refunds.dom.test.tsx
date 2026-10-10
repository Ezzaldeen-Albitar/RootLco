/**
 * Refunds on the screen (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B): the invoice's
 * refunds panel and the branch's refunds list.
 *
 * Every case is written so it FAILS when the behaviour it names is removed:
 *
 *  - asking: the form sends the amount, the method and the reason with one transport
 *    key; an amount above what is still owed is refused on the box, compared with the
 *    server's figure and never computed;
 *  - deciding: another person's pending request offers Approve and Reject to a holder
 *    of `sal.refund.approve`, each sending the request's own version; the requester is
 *    offered Withdraw and never Approve; a reader without the codes is offered nothing;
 *  - paying out: an approved request offers the payout form to a payment recorder,
 *    sending the approved method, the reference, the day and the version;
 *  - a refusal by rule is said in its own words, in English and Arabic;
 *  - the list: narrowed by state through the server, every figure the server's.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { formatMoney } from '../src/lib/money';
import { inBranch, renderLtr, renderRtl, TEST_BRANCH, TEST_COMPANY } from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { formatMessage, getMessages } from '@/i18n/get-messages';

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string, messages: Record<string, string> = EN) =>
  new RegExp(`^${escape(messages[key] as string)}`);
const money = (amount: string) => formatMoney({ amount, currency: 'USD' }, 'en');

const listRefundObligations = vi.fn();
const listRefundRequests = vi.fn();
const requestRefund = vi.fn();
const approveRefund = vi.fn();
const rejectRefund = vi.fn();
const withdrawRefund = vi.fn();
const executeRefund = vi.fn();
vi.mock('@/features/billing/api', () => ({
  listRefundObligations: (...args: unknown[]) => listRefundObligations(...args),
  listRefundRequests: (...args: unknown[]) => listRefundRequests(...args),
  requestRefund: (...args: unknown[]) => requestRefund(...args),
  approveRefund: (...args: unknown[]) => approveRefund(...args),
  rejectRefund: (...args: unknown[]) => rejectRefund(...args),
  withdrawRefund: (...args: unknown[]) => withdrawRefund(...args),
  executeRefund: (...args: unknown[]) => executeRefund(...args),
  listInvoices: vi.fn(),
}));
const listPaymentMethods = vi.fn();
vi.mock('@/features/payments/api', () => ({
  listPaymentMethods: (...args: unknown[]) => listPaymentMethods(...args),
}));
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: vi.fn(),
}));
const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { RefundsPanel } = await import('@/features/billing/components/RefundsPanel');
const { RefundsScreen } = await import('@/features/billing/components/RefundsScreen');

const INVOICE_ID = '99999999-9999-4999-8999-999999999999';
const OBLIGATION_ID = 'aaaa0000-0000-4000-8000-000000000001';
const REQUEST_ID = 'bbbb0000-0000-4000-8000-000000000001';
const METHOD_ID = 'cccc0000-0000-4000-8000-000000000001';
const SIGNED_IN = 'u-signed-in';
const SOMEBODY_ELSE = 'u-somebody-else';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ok = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const page = (items: readonly unknown[]) => ok({ items, nextCursor: null, hasMore: false });

const obligation = (over: Record<string, unknown> = {}) => ({
  id: OBLIGATION_ID,
  invoiceId: INVOICE_ID,
  creditNoteId: 'dddd0000-0000-4000-8000-000000000001',
  companyId: TEST_COMPANY.id,
  branchId: TEST_BRANCH.id,
  partnerId: 'eeee0000-0000-4000-8000-000000000001',
  amount: { amount: '30.0000', currency: 'USD', minorUnit: 2 },
  paidOut: { amount: '10.0000', currency: 'USD', minorUnit: 2 },
  stillOwed: { amount: '20.0000', currency: 'USD', minorUnit: 2 },
  state: 'open',
  createdAt: '2026-10-08T08:00:00Z',
  recordVersion: 1,
  ...over,
});

const refundRequest = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  obligationId: OBLIGATION_ID,
  invoiceId: INVOICE_ID,
  invoiceNumber: 'INV-000123',
  workOrderId: '77777777-7777-4777-8777-777777777777',
  companyId: TEST_COMPANY.id,
  branchId: TEST_BRANCH.id,
  payeePartnerId: 'eeee0000-0000-4000-8000-000000000001',
  state: 'pending',
  amount: { amount: '15.0000', currency: 'USD', minorUnit: 2 },
  paymentMethod: { id: METHOD_ID, kind: 'cash', displayName: 'Cash' },
  reason: 'Paid twice',
  requestedBy: SOMEBODY_ELSE,
  requestedAt: '2026-10-08T09:00:00Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  executedBy: null,
  executedAt: null,
  payoutReference: null,
  payoutDate: null,
  recordVersion: 3,
  ...over,
});

const echo = (request = refundRequest()) => ({
  state: { status: 'success', messageKey: 'refunds.request.success', attempt: 1 },
  created: {
    refundRequest: request,
    obligation: {
      id: OBLIGATION_ID,
      state: 'open',
      amount: { amount: '30.0000', currency: 'USD' },
      paidOut: { amount: '10.0000', currency: 'USD' },
      stillOwed: { amount: '20.0000', currency: 'USD' },
      recordVersion: 1,
    },
    replayed: false,
  },
});

function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

const panel = (
  options: {
    readonly canRequest?: boolean;
    readonly canDecide?: boolean;
    readonly locale?: 'en' | 'ar';
    readonly onChanged?: (key: string) => void;
  } = {}
) => {
  const locale = options.locale ?? 'en';
  const ui = withMui(
    inBranch(
      <RefundsPanel
        locale={locale}
        messages={getMessages(locale)}
        invoice={{ id: INVOICE_ID, companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id }}
        currentUserId={SIGNED_IN}
        canRequest={options.canRequest ?? true}
        canDecide={options.canDecide ?? true}
        onChanged={options.onChanged ?? (() => undefined)}
      />,
      { locale }
    ),
    locale
  );
  return locale === 'ar' ? renderRtl(ui) : renderLtr(ui);
};

const region = (messages: Record<string, string> = EN) =>
  screen.findByRole('region', { name: messages['refunds.panel.heading'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  listRefundObligations.mockResolvedValue(page([obligation()]));
  listRefundRequests.mockResolvedValue(page([]));
  listPaymentMethods.mockResolvedValue(
    ok({
      items: [
        {
          id: METHOD_ID,
          scope: 'tenant',
          methodCode: 'cash',
          kind: 'cash',
          displayName: 'Cash',
          status: 'active',
          recordable: true,
        },
      ],
    })
  );
  requestRefund.mockResolvedValue(echo());
  approveRefund.mockResolvedValue(echo(refundRequest({ state: 'approved', recordVersion: 4 })));
  rejectRefund.mockResolvedValue(echo(refundRequest({ state: 'rejected' })));
  withdrawRefund.mockResolvedValue(echo(refundRequest({ state: 'withdrawn' })));
  executeRefund.mockResolvedValue(echo(refundRequest({ state: 'executed' })));
});

describe('the invoice refunds panel — what is owed and asking for a refund', () => {
  it('states the server figures for each obligation, and reads them for this invoice in its branch', async () => {
    panel();
    const section = await region();
    expect(await within(section).findByTestId('refund-still-owed')).toHaveTextContent(
      money('20.0000')
    );
    expect(within(section).getByTestId('refund-paid-out')).toHaveTextContent(money('10.0000'));
    expect(listRefundObligations).toHaveBeenCalledWith(
      { companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id },
      { invoiceId: INVOICE_ID }
    );
    expect(listRefundRequests).toHaveBeenCalledWith(
      { companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id },
      { invoiceId: INVOICE_ID }
    );
  });

  it('asks for a refund with the amount, the method and the reason, under one transport key', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    panel({ onChanged });
    const form = await screen.findByRole('form', { name: EN['refunds.request.heading'] as string });
    await user.type(within(form).getByLabelText(labelled('refunds.request.amount')), '12.50');
    await user.selectOptions(
      within(form).getByLabelText(labelled('refunds.request.method')),
      METHOD_ID
    );
    await user.type(within(form).getByLabelText(labelled('refunds.request.reason')), 'Paid twice');
    await user.click(
      within(form).getByRole('button', { name: EN['refunds.request.submit'] as string })
    );
    await waitFor(() => expect(requestRefund).toHaveBeenCalledTimes(1));
    expect(requestRefund.mock.calls[0]?.[0]).toBe(OBLIGATION_ID);
    expect(requestRefund.mock.calls[0]?.[1]).toEqual({
      amount: '12.5000',
      paymentMethodId: METHOD_ID,
      reason: 'Paid twice',
    });
    expect(requestRefund.mock.calls[0]?.[2]).toMatch(UUID_SHAPE);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('refunds.request.recorded'));
    expect(await screen.findByText(EN['refunds.request.recorded'] as string)).toBeVisible();
  });

  it('refuses on the box an amount above what is still owed, compared with the server figure', async () => {
    const user = userEvent.setup();
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.request.heading'] as string });
    await user.type(within(form).getByLabelText(labelled('refunds.request.amount')), '20.01');
    await user.selectOptions(
      within(form).getByLabelText(labelled('refunds.request.method')),
      METHOD_ID
    );
    await user.type(within(form).getByLabelText(labelled('refunds.request.reason')), 'Too much');
    await user.click(
      within(form).getByRole('button', { name: EN['refunds.request.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['form.violation.refund_exceeds_obligation'] as string)
    ).toBeInTheDocument();
    expect(requestRefund).not.toHaveBeenCalled();
  });

  it('says a refusal by rule in its own words', async () => {
    const user = userEvent.setup();
    requestRefund.mockResolvedValueOnce({
      state: {
        status: 'conflict',
        messageKey: 'form.violation.refund_request_live_exists',
        correlationId: 'ref-409',
        attempt: 1,
      },
      created: null,
    });
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.request.heading'] as string });
    await user.type(within(form).getByLabelText(labelled('refunds.request.amount')), '5');
    await user.selectOptions(
      within(form).getByLabelText(labelled('refunds.request.method')),
      METHOD_ID
    );
    await user.type(within(form).getByLabelText(labelled('refunds.request.reason')), 'Again');
    await user.click(
      within(form).getByRole('button', { name: EN['refunds.request.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['form.violation.refund_request_live_exists'] as string)
    ).toBeInTheDocument();
  });

  it('offers no form, no decision and no payout to a reader without the codes', async () => {
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    panel({ canRequest: false, canDecide: false });
    const section = await region();
    await within(section).findByTestId('refund-live-request');
    expect(within(section).queryByRole('form')).toBeNull();
    for (const key of [
      'refunds.approve.action',
      'refunds.reject.action',
      'refunds.withdraw.action',
      'refunds.execute.submit',
    ]) {
      expect(within(section).queryByRole('button', { name: EN[key] as string })).toBeNull();
    }
    expect(within(section).getByText(EN['refunds.live.waits'] as string)).toBeVisible();
    expect(listPaymentMethods).not.toHaveBeenCalled();
  });
});

describe('the invoice refunds panel — deciding and paying out', () => {
  it('offers another person pending request to a holder of the code, and approves it with its own version', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    panel();
    const section = await region();
    expect(
      within(section).queryByRole('form', { name: EN['refunds.request.heading'] as string })
    ).toBeNull();
    await user.click(
      await within(section).findByRole('button', { name: EN['refunds.approve.action'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['refunds.approve.confirmTitle'] as string,
    });
    expect(dialog).toHaveTextContent(
      formatMessage(EN['refunds.approve.confirmExplain'] as string, { amount: money('15.0000') })
    );
    await user.click(
      within(dialog).getByRole('button', { name: EN['refunds.approve.action'] as string })
    );
    await waitFor(() => expect(approveRefund).toHaveBeenCalledWith(REQUEST_ID, 3));
    expect(await screen.findByText(EN['refunds.approve.done'] as string)).toBeVisible();
  });

  it('rejects with the reason typed, and the version read', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    panel();
    const section = await region();
    await user.click(
      await within(section).findByRole('button', { name: EN['refunds.reject.action'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['refunds.reject.confirmTitle'] as string,
    });
    await user.type(within(dialog).getByLabelText(labelled('refunds.reject.reason')), 'Not owed');
    await user.click(
      within(dialog).getByRole('button', { name: EN['refunds.reject.action'] as string })
    );
    await waitFor(() =>
      expect(rejectRefund).toHaveBeenCalledWith(REQUEST_ID, { reason: 'Not owed' }, 3)
    );
  });

  it('offers the requester Withdraw and never Approve', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(page([refundRequest({ requestedBy: SIGNED_IN })]));
    panel();
    const section = await region();
    expect(await within(section).findByText(EN['refunds.live.ownRequest'] as string)).toBeVisible();
    expect(
      within(section).queryByRole('button', { name: EN['refunds.approve.action'] as string })
    ).toBeNull();
    await user.click(
      within(section).getByRole('button', { name: EN['refunds.withdraw.action'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['refunds.withdraw.confirmTitle'] as string,
    });
    await user.click(
      within(dialog).getByRole('button', { name: EN['refunds.withdraw.action'] as string })
    );
    await waitFor(() => expect(withdrawRefund).toHaveBeenCalledWith(REQUEST_ID, 3));
  });

  it('records the payout of an approved request with the approved method, the reference, the day and the version', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(
      page([refundRequest({ state: 'approved', recordVersion: 4 })])
    );
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.execute.heading'] as string });
    expect(within(form).getByText('Cash')).toBeVisible();
    await user.type(within(form).getByLabelText(labelled('refunds.execute.reference')), 'TRF-55');
    const day = within(form).getByRole('group', { name: labelled('refunds.execute.date') });
    await user.click(within(day).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('01102026');
    await user.click(
      within(form).getByRole('button', { name: EN['refunds.execute.submit'] as string })
    );
    await waitFor(() => expect(executeRefund).toHaveBeenCalledTimes(1));
    expect(executeRefund.mock.calls[0]?.[0]).toBe(REQUEST_ID);
    expect(executeRefund.mock.calls[0]?.[1]).toEqual({
      paymentMethodId: METHOD_ID,
      payoutReference: 'TRF-55',
      payoutDate: '2026-10-01',
    });
    expect(executeRefund.mock.calls[0]?.[2]).toBe(4);
    expect(executeRefund.mock.calls[0]?.[3]).toMatch(UUID_SHAPE);
    expect(await screen.findByText(EN['refunds.execute.done'] as string)).toBeVisible();
  });

  it('shows the history with its decision and payout', async () => {
    listRefundRequests.mockResolvedValue(
      page([
        refundRequest({
          id: 'bbbb0000-0000-4000-8000-000000000002',
          state: 'executed',
          payoutReference: 'TRF-1',
          payoutDate: '2026-10-02',
        }),
        refundRequest({
          id: 'bbbb0000-0000-4000-8000-000000000003',
          state: 'rejected',
          decisionReason: 'Duplicate',
        }),
      ])
    );
    panel();
    const history = await screen.findByTestId('refund-history');
    expect(history).toHaveTextContent(EN['refunds.state.executed'] as string);
    expect(history).toHaveTextContent(
      formatMessage(EN['refunds.history.paidOut'] as string, {
        reference: 'TRF-1',
        day: '2026-10-02',
      })
    );
    expect(history).toHaveTextContent('Duplicate');
  });

  it('says it in Arabic, right to left', async () => {
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    panel({ locale: 'ar' });
    const section = await region(AR);
    expect(section.closest('[dir="rtl"]')).not.toBeNull();
    expect(
      await within(section).findByRole('button', { name: AR['refunds.approve.action'] as string })
    ).toBeVisible();
    expect(within(section).getByText(AR['refunds.panel.explain'] as string)).toBeVisible();
    expect(AR['form.violation.refund_self_approval']).not.toBe(
      EN['form.violation.refund_self_approval']
    );
  });
});

describe('the refunds list', () => {
  const list = (locale: 'en' | 'ar' = 'en') => {
    const ui = withMui(
      inBranch(
        <RefundsScreen
          locale={locale}
          messages={getMessages(locale)}
          currentUserId={SIGNED_IN}
          canReadCustomers={false}
          canSearchInvoices
        />,
        { locale }
      ),
      locale
    );
    return locale === 'ar' ? renderRtl(ui) : renderLtr(ui);
  };

  it('lists the branch requests with the server figures and narrows by state through the server', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    list();
    const grid = await screen.findByTestId('refunds-grid');
    expect(await within(grid).findByText('Paid twice')).toBeVisible();
    expect(within(grid).getByText(money('15.0000'))).toBeVisible();
    expect(listRefundRequests.mock.calls.at(-1)?.[0]).toEqual({
      companyId: TEST_COMPANY.id,
      branchId: TEST_BRANCH.id,
    });
    expect(listRefundRequests.mock.calls.at(-1)?.[1]).toEqual({});
    const toolbar = screen.getByTestId('refunds-toolbar');
    await user.click(
      within(toolbar).getByRole('button', { name: EN['refunds.state.approved'] as string })
    );
    await waitFor(() =>
      expect(listRefundRequests.mock.calls.at(-1)?.[1]).toEqual({ state: 'approved' })
    );
  });

  it('says in Arabic when nothing matches', async () => {
    listRefundRequests.mockResolvedValue(page([]));
    list('ar');
    expect(await screen.findByText(AR['refunds.list.none'] as string)).toBeVisible();
  });
});
