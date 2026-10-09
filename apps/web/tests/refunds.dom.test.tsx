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
 *
 * On the Material UI wrappers (P1-32-PRE-OD-REPB), each also failing when removed:
 * one write per press (two presses inside ONE act() send once), typed entries are
 * unsaved work a branch switch asks about, the payout day is checked on the
 * branch's calendar before it is sent, a request's moment is written on the
 * branch's clock with the clock named, and an empty list says which empty it is.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { formatMoney } from '../src/lib/money';
import { addDays, dayIn, formatInZone, zoneLabelAt } from '../src/lib/branch-time';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  WorkingBranchProbe,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
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
    // The day is written for reading, as a calendar day (not the stored text).
    expect(history).toHaveTextContent(
      formatMessage(EN['refunds.history.paidOut'] as string, {
        reference: 'TRF-1',
        day: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium' }).format(
          new Date('2026-10-02T00:00:00Z')
        ),
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

  it('says in Arabic that nothing has been asked for yet, apart from a list the choices narrowed', async () => {
    listRefundRequests.mockResolvedValue(page([]));
    list('ar');
    const empty = await screen.findByTestId('refunds-empty');
    expect(empty).toHaveTextContent(AR['refunds.list.empty'] as string);
    expect(screen.queryByText(AR['refunds.list.none'] as string)).toBeNull();
  });

  it('says when the choices match nothing, and clearing them reads the whole list again', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(page([]));
    list();
    expect(await screen.findByTestId('refunds-empty')).toHaveTextContent(
      EN['refunds.list.empty'] as string
    );
    await user.click(
      within(screen.getByTestId('refunds-toolbar')).getByRole('button', {
        name: EN['refunds.state.approved'] as string,
      })
    );
    const none = await screen.findByTestId('refunds-no-matches');
    expect(none).toHaveTextContent(EN['refunds.list.none'] as string);
    expect(screen.queryByTestId('refunds-empty')).toBeNull();
    await user.click(
      within(none).getByRole('button', { name: EN['refunds.list.clearChoices'] as string })
    );
    await waitFor(() => expect(listRefundRequests.mock.calls.at(-1)?.[1]).toEqual({}));
    expect(await screen.findByTestId('refunds-empty')).toBeVisible();
  });

  it('writes when a refund was asked for on the branch clock, naming the clock', async () => {
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    list();
    const grid = await screen.findByTestId('refunds-grid');
    await within(grid).findByText('Paid twice');
    const when = formatInZone('2026-10-08T09:00:00Z', 'en-GB', TEST_BRANCH.timezone);
    const clock = zoneLabelAt('2026-10-08T09:00:00Z', 'en-GB', TEST_BRANCH.timezone);
    expect(grid).toHaveTextContent(`${when} ${clock}`);
  });

  it('names the working branch it lists, and reads nothing until one branch is chosen', async () => {
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    forgetRememberedBranch();
    const ui = withMui(
      inBranch(
        <RefundsScreen
          locale="en"
          messages={getMessages('en')}
          currentUserId={SIGNED_IN}
          canReadCustomers={false}
          canSearchInvoices
        />,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      ),
      'en'
    );
    renderLtr(ui);
    expect(await screen.findByTestId('refunds-branch-target')).toBeVisible();
    expect(screen.queryByTestId('refunds-grid')).toBeNull();
    expect(listRefundRequests).not.toHaveBeenCalled();
    forgetRememberedBranch();
  });
});

describe('the refunds panel — one write per press, unsaved entries and the payout day', () => {
  /*
   * Both presses go inside ONE act(), so the second arrives before React has
   * re-rendered the disabled button: what is tested is the panel's own hold on
   * the write, not the button's disabled state.
   */
  function gate<T>() {
    let open: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
      open = resolve;
    });
    return { promise, open: (value: T) => open(value) };
  }
  const twice = (button: HTMLElement) =>
    act(() => {
      button.click();
      button.click();
    });

  it('asks for a refund once however often it is pressed', async () => {
    const user = userEvent.setup();
    const answer = gate<unknown>();
    requestRefund.mockReturnValue(answer.promise);
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.request.heading'] as string });
    await user.type(within(form).getByLabelText(labelled('refunds.request.amount')), '5');
    await user.selectOptions(
      within(form).getByLabelText(labelled('refunds.request.method')),
      METHOD_ID
    );
    await user.type(within(form).getByLabelText(labelled('refunds.request.reason')), 'Twice');
    twice(within(form).getByRole('button', { name: EN['refunds.request.submit'] as string }));
    expect(requestRefund).toHaveBeenCalledTimes(1);
    await act(async () => answer.open(echo()));
    expect(await screen.findByText(EN['refunds.request.recorded'] as string)).toBeVisible();
    expect(requestRefund).toHaveBeenCalledTimes(1);
  });

  it('approves once however often the confirmation is pressed', async () => {
    const user = userEvent.setup();
    const answer = gate<unknown>();
    approveRefund.mockReturnValue(answer.promise);
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    panel();
    const section = await region();
    await user.click(
      await within(section).findByRole('button', { name: EN['refunds.approve.action'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['refunds.approve.confirmTitle'] as string,
    });
    twice(within(dialog).getByRole('button', { name: EN['refunds.approve.action'] as string }));
    expect(approveRefund).toHaveBeenCalledTimes(1);
    await act(async () =>
      answer.open(echo(refundRequest({ state: 'approved', recordVersion: 4 })))
    );
    expect(await screen.findByText(EN['refunds.approve.done'] as string)).toBeVisible();
    expect(approveRefund).toHaveBeenCalledTimes(1);
  });

  it('puts the cursor on the first field to fix when the request is refused', async () => {
    const user = userEvent.setup();
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.request.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['refunds.request.submit'] as string })
    );
    const amount = within(form).getByLabelText(labelled('refunds.request.amount'));
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect(requestRefund).not.toHaveBeenCalled();
  });

  it('offers to read a decided request again when a decision finds it moved on', async () => {
    const user = userEvent.setup();
    approveRefund.mockResolvedValueOnce({
      state: {
        status: 'conflict',
        messageKey: 'refunds.decision.conflict',
        correlationId: 'ref-409',
        attempt: 1,
      },
      created: null,
    });
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    panel();
    const section = await region();
    await user.click(
      await within(section).findByRole('button', { name: EN['refunds.approve.action'] as string })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: EN['refunds.approve.action'] as string })
    );
    expect(
      await within(section).findByText(EN['refunds.decision.conflict'] as string)
    ).toBeVisible();
    const reads = listRefundRequests.mock.calls.length;
    await user.click(
      within(section).getByRole('button', { name: EN['form.loadLatest'] as string })
    );
    await waitFor(() => expect(listRefundRequests.mock.calls.length).toBeGreaterThan(reads));
  });

  it('refuses a payout day after the branch today on the field, and sends nothing', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(
      page([refundRequest({ state: 'approved', recordVersion: 4 })])
    );
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.execute.heading'] as string });
    await user.type(within(form).getByLabelText(labelled('refunds.execute.reference')), 'TRF-9');
    const tomorrow = addDays(dayIn(TEST_BRANCH.timezone), 1);
    const [year, month, date] = tomorrow.split('-') as [string, string, string];
    const day = within(form).getByRole('group', { name: labelled('refunds.execute.date') });
    await user.click(within(day).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard(`${date}${month}${year}`);
    await user.click(
      within(form).getByRole('button', { name: EN['refunds.execute.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['form.violation.refund_payout_date_invalid'] as string)
    ).toBeVisible();
    expect(executeRefund).not.toHaveBeenCalled();
  });

  it('refuses a payout day typed only in part, on the field, and sends nothing', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(
      page([refundRequest({ state: 'approved', recordVersion: 4 })])
    );
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.execute.heading'] as string });
    await user.type(within(form).getByLabelText(labelled('refunds.execute.reference')), 'TRF-9');
    const day = within(form).getByRole('group', { name: labelled('refunds.execute.date') });
    await user.click(within(day).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('0110');
    await user.click(
      within(form).getByRole('button', { name: EN['refunds.execute.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['refunds.execute.dateIncomplete'] as string)
    ).toBeVisible();
    expect(executeRefund).not.toHaveBeenCalled();
  });

  it.each(['en', 'ar'] as const)(
    'asks before a branch switch loses a typed request; staying keeps it, discarding empties it (%s)',
    async (locale) => {
      const user = userEvent.setup();
      const text = locale === 'ar' ? AR : EN;
      forgetRememberedBranch();
      const ui = withMui(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="first" />
            <BranchSwitch to={OTHER_BRANCH.id} label="second" />
            <WorkingBranchProbe />
            <RefundsPanel
              locale={locale}
              messages={getMessages(locale)}
              invoice={{ id: INVOICE_ID, companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id }}
              currentUserId={SIGNED_IN}
              canRequest
              canDecide
              onChanged={() => undefined}
            />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]), locale }
        ),
        locale
      );
      if (locale === 'ar') renderRtl(ui);
      else renderLtr(ui);
      await switchWithoutQuestion(user, 'first');
      const form = await screen.findByRole('form', {
        name: text['refunds.request.heading'] as string,
      });
      const reason = within(form).getByLabelText(labelled('refunds.request.reason', text));
      await user.type(reason, 'Paid twice');

      await stayOnBranch(user, await switchExpectingQuestion(user, 'second', text), text);
      expect(heldBranch()).toBe(TEST_BRANCH.id);
      expect(reason).toHaveValue('Paid twice');

      await discardAndSwitch(user, await switchExpectingQuestion(user, 'second', text), text);
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      await waitFor(() => expect(reason).toHaveValue(''));
      expect(requestRefund).not.toHaveBeenCalled();
      forgetRememberedBranch();
    }
  );
});
