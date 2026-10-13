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
 * typed entries are unsaved work a branch switch asks about, the payout day is
 * checked on the branch's calendar before it is sent, a request's moment is
 * written on the branch's clock with the clock named, and an empty list says
 * which empty it is.
 *
 * One write per press, for each of the five writes — asking, approving,
 * rejecting, withdrawing and recording the payout. Each has a case that sends
 * twice once its hold is taken out of `RefundsPanel.tsx`: asking and approving
 * since P1-32-PRE-OD-REPB, the other three since P1-32-PRE-OD-REPB-05, each run
 * that way. For a decision the two presses arrive before React has rendered the
 * held action, the only moment the hold is what stops the second; the payout's
 * are two separate interactions, the second a submission of the form itself.
 *
 * A request's moment under a branch zone this browser does not know is written
 * on UTC and followed by the visible label UTC, in English and Arabic, in the
 * list and in the invoice's history (P1-32-PRE-OD-REPB-05).
 *
 * The payout day is the day typed, on any clock (P1-32-PRE-OD-REPB-04): shown and
 * sent as typed for a branch whose zone is known, for one whose zone is not, and
 * when the zone changes under the open form — literal days, on zones east and
 * west of any machine that runs this file, under a pinned "now" so that the
 * field's "no day after today" bound never depends on the runner's date.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { intlLocale } from '../src/lib/format';
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

/*
 * The transport, for the payout's two-press case only.
 *
 * A REAL `ApiClient` over a stubbed `fetch`, and the real payout sender beside
 * the spy that stands in for it, so that one case can read the request itself:
 * how many were sent, and the `If-Match` and `Idempotency-Key` each carries.
 * Every other case drives the writes through the module mock above and never
 * reaches this.
 */
const fetchImpl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server-client', async () => {
  const { ApiClient } = await import('@/lib/api/client');
  return {
    authorizedClient: async () =>
      new ApiClient({
        baseUrl: 'http://api.test',
        fetchImpl: (input: unknown, init: unknown) => fetchImpl(input, init),
      }),
  };
});
const actualBillingApi =
  await vi.importActual<typeof import('@/features/billing/api')>('@/features/billing/api');

/*
 * What each operational grid of the screen was handed, by its test id. The real
 * grid is drawn untouched: this only keeps the column definitions, because the
 * width a column ASKS for is the one thing about widths a DOM test can see
 * (jsdom lays nothing out — see `operational-grid-actions-width.dom.test.tsx`).
 */
const handedColumns = new Map<string, readonly { id: string; minChars?: number }[]>();
vi.mock('@/components/data/OperationalGrid', async (original) => {
  const real = await original<typeof import('@/components/data/OperationalGrid')>();
  const Real = real.OperationalGrid as unknown as (props: Record<string, unknown>) => ReactElement;
  return {
    ...real,
    OperationalGrid: (props: Record<string, unknown>) => {
      if (typeof props['testId'] === 'string') {
        handedColumns.set(
          props['testId'],
          props['columns'] as readonly { id: string; minChars?: number }[]
        );
      }
      return <Real {...props} />;
    },
  };
});

const { RefundsPanel } = await import('@/features/billing/components/RefundsPanel');
const { RefundsScreen } = await import('@/features/billing/components/RefundsScreen');
const { REASON_COLUMN_CHARS } = await import('@/features/billing/components/shared');
const { columnMinWidth } = await import('@/components/data/OperationalGrid');

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

/**
 * Pins "now" for a case that types a payout day.
 *
 * The day field offers no day after the branch's today, so a case that types a
 * literal day would otherwise pass or fail by the date of the machine running
 * it. Only `Date` is replaced — timers stay real — so typing, waiting and the
 * picker behave exactly as in every other case; the file's `afterEach` puts the
 * real clock back. Mid-month and midday on UTC: the 15th or the 16th of
 * September 2026 on every zone on the map, so the 1st is behind today anywhere.
 */
const PINNED_NOW = '2026-09-15T12:00:00Z';
function pinToday(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(PINNED_NOW));
}

afterEach(() => {
  vi.useRealTimers();
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

/**
 * A grid row has one fixed height, and a cell gives its text a line as tall as
 * the row. Two stacked lines fit only when each has a compact line height of
 * its own; a first line left to inherit the cell's hides the second below it
 * (P1-32-PRE-OD-INVH). jsdom lays nothing out, so this holds the classes that
 * carry the two line heights — the fit itself is seen only in a browser.
 */
function expectBothLinesFit(inCell: HTMLElement, second: string | RegExp): void {
  const cell = inCell.closest('[data-grid-cell="two-line"]');
  expect(cell, 'not a two-line cell').not.toBeNull();
  const lines = [...(cell as HTMLElement).children];
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveClass('text-table-cell');
  expect(lines[0]).toContainElement(inCell.closest('[data-grid-line="primary"]') as HTMLElement);
  expect(lines[1]).toHaveClass('text-caption');
  expect(lines[1]).toHaveTextContent(second);
}

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

  it('draws a paid request with its state and, under it, the payout reference', async () => {
    listRefundRequests.mockResolvedValue(
      page([refundRequest({ state: 'executed', payoutReference: 'TRF-55' })])
    );
    list();
    const grid = await screen.findByTestId('refunds-grid');
    await within(grid).findByText('TRF-55');
    // The state, and under it the payout reference, which the row used to cut off.
    expectBothLinesFit(within(grid).getByText(EN['refunds.state.executed'] as string), 'TRF-55');
  });

  /*
   * P1-32-PRE-OD-UXQ, Q-2. At 1440 px the reason of every refund of the retest
   * was longer than its column and was cut at the cell's edge with nothing to
   * show for it; in Arabic a reason in Latin letters lost its beginning. What a
   * DOM test can hold: the line is cut at the side with an ellipsis, is laid
   * out in its own direction, and says its whole text as its title.
   */
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: a reason longer than its column keeps its beginning and is whole in its title`, async () => {
      const latin =
        'FQA-1015 ar: refund q2 of the 4.000 owed, for the branch-midnight payout check (QA)';
      const arabic = 'أعاد المشتري شفرة مساحة تالفة بعد أسبوع من الشراء وطلب استرداد ثمنها كاملا';
      listRefundRequests.mockResolvedValue(
        page([
          refundRequest({ reason: latin }),
          refundRequest({ id: 'aaaa1111-0000-4000-8000-000000000002', reason: arabic }),
        ])
      );
      list(locale);
      const grid = await screen.findByTestId('refunds-grid');
      for (const [reason, direction] of [
        [latin, 'ltr'],
        [arabic, 'rtl'],
      ] as const) {
        const line = (await within(grid).findByText(reason)).closest(
          '[data-grid-line="primary"]'
        ) as HTMLElement;
        expect(line, 'the reason is not the first line of a two-line cell').not.toBeNull();
        expect(line).toHaveClass('overflow-x-clip', 'text-ellipsis', 'whitespace-nowrap');
        // Its own direction in both interfaces: what is cut is its end.
        expect(line).toHaveAttribute('dir', direction);
        expect(line).toHaveAttribute('title', reason);
        expect(line.textContent).toBe(reason);
        // The moment under it still fits: it has its own line height.
        expectBothLinesFit(within(grid).getByText(reason), /2026/);
      }
    });
  }

  it('asks for a reason column an ordinary reason fits in, and leaves the other columns theirs', async () => {
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    list();
    await within(await screen.findByTestId('refunds-grid')).findByText('Paid twice');
    const columns = handedColumns.get('refunds-grid') ?? [];
    expect(columns.map((column) => column.id)).toEqual([
      'reason',
      'invoice',
      'amount',
      'method',
      'state',
    ]);
    const reason = columns.find((column) => column.id === 'reason');
    expect(reason?.minChars).toBe(REASON_COLUMN_CHARS);
    // 380 px: wider than the 297 to 301 px the column was drawn at when every
    // reason of the retest was cut, and room for a sentence of fifty-five
    // characters as they are drawn (about six and a third pixels each).
    expect(columnMinWidth(reason?.minChars ?? 0)).toBe(380);
    expect(columnMinWidth(reason?.minChars ?? 0)).toBeGreaterThan(55 * 6.34 + 20);
    for (const column of columns.filter((entry) => entry.id !== 'reason')) {
      expect(column.minChars, column.id).toBeUndefined();
    }
  });

  it('lists the branch requests with the server figures and narrows by state through the server', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    list();
    const grid = await screen.findByTestId('refunds-grid');
    expect(await within(grid).findByText('Paid twice')).toBeVisible();
    expect(within(grid).getByText(money('15.0000'))).toBeVisible();
    // The reason and, under it, when it was asked for: the second line was cut
    // off by the row, so the date was not on the screen at all.
    expectBothLinesFit(within(grid).getByText('Paid twice'), /2026/);
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

  it('says in Arabic when nothing matches the choices, offering to clear them', async () => {
    const user = userEvent.setup();
    listRefundRequests.mockResolvedValue(page([]));
    list('ar');
    await screen.findByTestId('refunds-empty');
    await user.click(
      within(screen.getByTestId('refunds-toolbar')).getByRole('button', {
        name: AR['refunds.state.approved'] as string,
      })
    );
    const none = await screen.findByTestId('refunds-no-matches');
    expect(await screen.findByText(AR['refunds.list.none'] as string)).toBeVisible();
    expect(none).toHaveTextContent(AR['refunds.list.none'] as string);
    expect(
      within(none).getByRole('button', { name: AR['refunds.list.clearChoices'] as string })
    ).toBeVisible();
    expect(screen.queryByTestId('refunds-empty')).toBeNull();
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

  /*
   * P1-32-PRE-OD-REPB-05 — the other three writes. Each case fails when its
   * hold is taken out of `RefundsPanel.tsx`; each was run that way.
   *
   * For a decision the hold is the only thing between a second press and a
   * second request for as long as React has not rendered the dialog's held
   * action — so the two presses that prove it arrive before that render. Once
   * it has rendered, the action is disabled and a press cannot reach the
   * sender at all; each case presses once more then, on its own, with the
   * request still open, and the count stays at one.
   */
  /** A further press, on its own, of an action the screen is by now holding. */
  const pressHeld = (button: HTMLElement) => {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  };
  /** One turn of the event loop, so anything a press started has reached the transport. */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it('rejects once however often the reason is confirmed', async () => {
    const user = userEvent.setup();
    const answer = gate<unknown>();
    rejectRefund.mockReturnValue(answer.promise);
    listRefundRequests.mockResolvedValue(page([refundRequest()]));
    panel();
    const section = await region();
    await user.click(
      await within(section).findByRole('button', { name: EN['refunds.reject.action'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['refunds.reject.confirmTitle'] as string,
    });
    await user.type(within(dialog).getByLabelText(labelled('refunds.reject.reason')), 'Duplicate');
    const confirm = within(dialog).getByRole('button', {
      name: EN['refunds.reject.action'] as string,
    });
    twice(confirm);
    expect(rejectRefund).toHaveBeenCalledTimes(1);
    expect(rejectRefund).toHaveBeenCalledWith(REQUEST_ID, { reason: 'Duplicate' }, 3);
    pressHeld(confirm);
    await settle();
    expect(rejectRefund).toHaveBeenCalledTimes(1);
    await act(async () => answer.open(echo(refundRequest({ state: 'rejected' }))));
    expect(await screen.findByText(EN['refunds.reject.done'] as string)).toBeVisible();
    expect(rejectRefund).toHaveBeenCalledTimes(1);
  });

  it('withdraws once however often the confirmation is pressed', async () => {
    const user = userEvent.setup();
    const answer = gate<unknown>();
    withdrawRefund.mockReturnValue(answer.promise);
    listRefundRequests.mockResolvedValue(page([refundRequest({ requestedBy: SIGNED_IN })]));
    panel();
    const section = await region();
    await user.click(
      await within(section).findByRole('button', { name: EN['refunds.withdraw.action'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['refunds.withdraw.confirmTitle'] as string,
    });
    const confirm = within(dialog).getByRole('button', {
      name: EN['refunds.withdraw.action'] as string,
    });
    twice(confirm);
    expect(withdrawRefund).toHaveBeenCalledTimes(1);
    expect(withdrawRefund).toHaveBeenCalledWith(REQUEST_ID, 3);
    pressHeld(confirm);
    await settle();
    expect(withdrawRefund).toHaveBeenCalledTimes(1);
    await act(async () => answer.open(echo(refundRequest({ state: 'withdrawn' }))));
    expect(await screen.findByText(EN['refunds.withdraw.done'] as string)).toBeVisible();
    expect(withdrawRefund).toHaveBeenCalledTimes(1);
  });

  it('records the payout once: a second submission while the first is open sends nothing, and the one request carries its version and its key', async () => {
    /*
     * Two separate interactions, the screen rendered between them. The first is
     * a press of the button. The button is held after it, so the second is a
     * submission of the form itself — where Enter in one of its boxes lands —
     * which reaches the sender whether or not the button is held: only the
     * form's own hold stops it. The request is read at the transport.
     */
    pinToday();
    const user = userEvent.setup();
    const answer = gate<Response>();
    fetchImpl.mockReturnValue(answer.promise);
    executeRefund.mockImplementation((...args: unknown[]) =>
      (actualBillingApi.executeRefund as (...sent: unknown[]) => unknown)(...args)
    );
    listRefundRequests.mockResolvedValue(
      page([refundRequest({ state: 'approved', recordVersion: 4 })])
    );
    panel();
    const form = await screen.findByRole('form', { name: EN['refunds.execute.heading'] as string });
    await user.type(within(form).getByLabelText(labelled('refunds.execute.reference')), 'TRF-55');
    const day = within(form).getByRole('group', { name: labelled('refunds.execute.date') });
    await user.click(within(day).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('01092026');
    const submit = within(form).getByRole('button', {
      name: EN['refunds.execute.submit'] as string,
    });

    await user.click(submit);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();

    fireEvent.submit(form);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      {
        readonly method: string;
        readonly headers: Readonly<Record<string, string>>;
        readonly body: string;
      },
    ];
    expect(url).toBe(`http://api.test/api/v1/refund-requests/${REQUEST_ID}/execution`);
    expect(init.method).toBe('POST');
    // If-Match: the version the request was read at. Idempotency-Key: the form's one key.
    expect(init.headers['if-match']).toBe('4');
    expect(init.headers['idempotency-key']).toMatch(UUID_SHAPE);
    expect(JSON.parse(init.body)).toEqual({
      paymentMethodId: METHOD_ID,
      payoutReference: 'TRF-55',
      payoutDate: '2026-09-01',
    });

    await act(async () =>
      answer.open(
        new Response(JSON.stringify(echo(refundRequest({ state: 'executed' })).created), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    expect(await screen.findByText(EN['refunds.execute.done'] as string)).toBeVisible();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

describe('the payout day is the day typed, on any clock (P1-32-PRE-OD-REPB-04)', () => {
  /*
   * A calendar day has no clock, so the day typed is the day shown and the day
   * sent — for an invoice branch whose zone is known, for one whose zone is
   * not, and when the working context is read again and the zone changes under
   * the open form. The picker holds a day as an instant on some zone: a zone
   * that changed under a mounted picker, and the browser's clock taken as the
   * fallback, each moved a typed day by one in the report scope form
   * (P1-32-PRE-OD-REPA-04), and the payout day stood on the same two legs.
   *
   * Nothing here is computed from the clock of the machine running the test:
   * the days are literals and "now" is pinned (`pinToday`), so the field's
   * bound — no day after the branch's today — is the same on every runner. The zones are chosen so the cases mean something on
   * ANY machine clock — the region the product is used in (Asia/Riyadh), one
   * far east of every likely runner (Pacific/Auckland), one far west
   * (Pacific/Honolulu), and the two ends of the map to change from.
   */
  const UNKNOWN_ZONE = 'Mars/Base';
  const FAR_EAST = 'Pacific/Kiritimati';
  const FAR_WEST = 'Pacific/Pago_Pago';
  const SENT = { paymentMethodId: METHOD_ID, payoutReference: 'TRF-55', payoutDate: '2026-09-01' };

  /** The panel of an invoice whose branch the working context puts on `zone`. */
  const payoutPanel = (zone: string) =>
    withMui(
      inBranch(
        <RefundsPanel
          locale="en"
          messages={getMessages('en')}
          invoice={{ id: INVOICE_ID, companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id }}
          currentUserId={SIGNED_IN}
          canRequest
          canDecide
          onChanged={() => undefined}
        />,
        { snapshot: branchSnapshot([{ ...TEST_BRANCH, timezone: zone }]) }
      ),
      'en'
    );
  const payoutForm = () =>
    screen.findByRole('form', { name: EN['refunds.execute.heading'] as string });
  const dayGroup = (form: HTMLElement) =>
    within(form).getByRole('group', { name: labelled('refunds.execute.date') });
  /** The day the picker holds, as it writes it into its own value input: `DD/MM/YYYY`. */
  function dayShown(form: HTMLElement): string {
    const input = dayGroup(form).parentElement?.querySelector('input');
    if (!input) throw new Error('the picker has no value input');
    return input.value;
  }
  async function typeParts(
    user: ReturnType<typeof userEvent.setup>,
    form: HTMLElement,
    parts: string
  ): Promise<void> {
    await user.click(within(dayGroup(form)).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard(parts);
  }
  const typeReference = (user: ReturnType<typeof userEvent.setup>, form: HTMLElement) =>
    user.type(within(form).getByLabelText(labelled('refunds.execute.reference')), 'TRF-55');
  const record = (user: ReturnType<typeof userEvent.setup>, form: HTMLElement) =>
    user.click(within(form).getByRole('button', { name: EN['refunds.execute.submit'] as string }));

  beforeEach(() => {
    pinToday();
    listRefundRequests.mockResolvedValue(
      page([refundRequest({ state: 'approved', recordVersion: 4 })])
    );
  });

  describe.each(['Asia/Riyadh', 'Pacific/Auckland', 'Pacific/Honolulu'])(
    'with the invoice branch on %s',
    (knownZone) => {
      it.each([
        ['a branch whose zone is known', knownZone, null],
        ['a branch whose zone is not known', UNKNOWN_ZONE, null],
        ['a change from a known zone to an unknown one', knownZone, UNKNOWN_ZONE],
        ['a change from an unknown zone to a known one', UNKNOWN_ZONE, knownZone],
        ['a change from a clock far to the east', FAR_EAST, knownZone],
        ['a change from a clock far to the west', FAR_WEST, knownZone],
      ])('for %s', async (_what, startOn, changeTo) => {
        const view = renderLtr(payoutPanel(startOn));
        const user = userEvent.setup();
        await typeReference(user, await payoutForm());
        // The change, when there is one, is made with the day field mounted
        // and empty — the state the report scope form's failure was in.
        if (changeTo !== null) view.rerender(payoutPanel(changeTo));
        const form = await payoutForm();
        const standsOn = changeTo ?? startOn;
        const note = screen.queryByTestId('refund-payout-zone-unknown');
        if (standsOn === UNKNOWN_ZONE) {
          expect(note).toHaveTextContent(EN['refunds.execute.zoneUnknownNote'] as string);
        } else {
          expect(note).toBeNull();
        }

        await typeParts(user, form, '01092026');
        expect(dayShown(form)).toBe('01/09/2026');
        await record(user, form);
        await waitFor(() => expect(executeRefund).toHaveBeenCalledTimes(1));
        expect(executeRefund.mock.calls[0]?.[1]).toEqual(SENT);
      });

      it('keeps a whole day across a change of clock, and drops a half-typed one with its complaint', async () => {
        const view = renderLtr(payoutPanel(knownZone));
        const user = userEvent.setup();
        let form = await payoutForm();
        await typeReference(user, form);
        // The day and the month, and no year.
        await typeParts(user, form, '0109');
        await record(user, form);
        expect(
          await within(form).findByText(EN['refunds.execute.dateIncomplete'] as string)
        ).toBeVisible();
        expect(dayGroup(form)).toHaveAttribute('aria-invalid', 'true');
        expect(executeRefund).not.toHaveBeenCalled();

        for (const next of [UNKNOWN_ZONE, knownZone]) {
          view.rerender(payoutPanel(next));
          form = await payoutForm();
          // The half-typed day went with the picker it was typed into, and
          // nothing complains about an empty box.
          expect(dayShown(form)).toBe('');
          expect(dayGroup(form)).not.toHaveAttribute('aria-invalid', 'true');
          expect(
            within(form).queryByText(EN['refunds.execute.dateIncomplete'] as string)
          ).toBeNull();
        }

        await typeParts(user, form, '01092026');
        for (const next of [UNKNOWN_ZONE, FAR_WEST, FAR_EAST, knownZone]) {
          view.rerender(payoutPanel(next));
          form = await payoutForm();
          // The whole day is the form's, and stays the day typed on every clock.
          expect(dayShown(form)).toBe('01/09/2026');
        }
        await record(user, form);
        await waitFor(() => expect(executeRefund).toHaveBeenCalledTimes(1));
        expect(executeRefund.mock.calls[0]?.[1]).toEqual(SENT);
      });
    }
  );
});

describe('a refund moment under a branch zone this browser does not know (P1-32-PRE-OD-REPB-05)', () => {
  /*
   * The ruling for the refund screens: a time on UTC that SAYS it is on UTC is
   * acceptable; a time with no clock named is not. So where the branch's zone
   * is not known, the time is written on UTC and is followed by the visible
   * literal `UTC` — in English and in Arabic, in the list and in the invoice's
   * history. Each case fails if the label is dropped, and if the time is
   * written on any other clock.
   */
  const INSTANT = '2026-10-08T09:00:00Z';
  const unknownZone = () => branchSnapshot([{ ...TEST_BRANCH, timezone: 'Mars/Base' }]);
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
  /** The instant on UTC as the reader's language writes it, from `Intl` and nothing of the screen's. */
  const onUtc = (locale: 'en' | 'ar') =>
    squash(
      new Intl.DateTimeFormat(intlLocale(locale), {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(INSTANT))
    );
  /** Every moment drawn inside `root` is that time followed by the label, and can be seen. */
  function expectNamedUtc(root: HTMLElement, locale: 'en' | 'ar'): void {
    const when = onUtc(locale);
    const moments = Array.from(root.querySelectorAll<HTMLElement>('bdi')).filter((node) =>
      squash(node.textContent ?? '').startsWith(when)
    );
    expect(moments.length).toBeGreaterThan(0);
    for (const moment of moments) {
      expect(squash(moment.textContent ?? '')).toBe(`${when} UTC`);
      expect(moment).toBeVisible();
    }
  }
  const show = (ui: ReactElement, locale: 'en' | 'ar') => {
    const framed = withMui(inBranch(ui, { snapshot: unknownZone(), locale }), locale);
    return locale === 'ar' ? renderRtl(framed) : renderLtr(framed);
  };

  beforeEach(() => {
    listRefundRequests.mockResolvedValue(page([refundRequest({ requestedAt: INSTANT })]));
  });

  it.each(['en', 'ar'] as const)(
    'the list writes it on UTC, followed by the label UTC (%s)',
    async (locale) => {
      show(
        <RefundsScreen
          locale={locale}
          messages={getMessages(locale)}
          currentUserId={SIGNED_IN}
          canReadCustomers={false}
          canSearchInvoices
        />,
        locale
      );
      const grid = await screen.findByTestId('refunds-grid');
      await within(grid).findByText('Paid twice');
      expectNamedUtc(grid, locale);
    }
  );

  it.each(['en', 'ar'] as const)(
    'the invoice history writes it on UTC, followed by the label UTC (%s)',
    async (locale) => {
      show(
        <RefundsPanel
          locale={locale}
          messages={getMessages(locale)}
          invoice={{ id: INVOICE_ID, companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id }}
          currentUserId={SIGNED_IN}
          canRequest
          canDecide
          onChanged={() => undefined}
        />,
        locale
      );
      expectNamedUtc(await screen.findByTestId('refund-history'), locale);
    }
  );
});
