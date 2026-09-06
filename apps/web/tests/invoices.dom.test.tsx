import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { formatMoney } from '../src/lib/money';
import { renderLtr, renderRtl } from './render';

/**
 * The invoice of a work order, rendered (P1-30, `W6`, FE-014, FE-015, FE-019,
 * FE-020).
 *
 * The properties under test: without a live invoice the preview is read only
 * with finance view and a 404 renders as "no accepted quotation revision",
 * never as an empty preview; creating carries one transport key per opened
 * form and a conflict re-reads; with a live invoice the detail renders the
 * server's strings, and WITHOUT finance view every amount area says it is
 * not available and no zero appears; the outstanding balance is read only
 * with finance view and a refusal is a refusal; issue and cancel send the
 * detail's `recordVersion` and a stale version re-reads; the printable copy
 * takes descriptions from the preview only when its revision matches; and the
 * route page decides before it reads.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
const money = (amount: string, currency = 'USD') => formatMoney({ amount, currency }, 'en');

const readWorkOrderInvoice = vi.fn();
const readInvoicePreview = vi.fn();
const readInvoice = vi.fn();
const readOutstanding = vi.fn();
const createInvoice = vi.fn();
const issueInvoice = vi.fn();
const cancelInvoice = vi.fn();
vi.mock('@/features/billing/api', () => ({
  readWorkOrderInvoice: (...args: unknown[]) => readWorkOrderInvoice(...args),
  readInvoicePreview: (...args: unknown[]) => readInvoicePreview(...args),
  readInvoice: (...args: unknown[]) => readInvoice(...args),
  readOutstanding: (...args: unknown[]) => readOutstanding(...args),
  createInvoice: (...args: unknown[]) => createInvoice(...args),
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
  cancelInvoice: (...args: unknown[]) => cancelInvoice(...args),
}));

const readWorkOrderDetail = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { InvoiceScreen } = await import('@/features/billing/components/InvoiceScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const InvoicesPage = (await import('@/app/[locale]/(dashboard)/invoices/page'))
  .default as unknown as RoutePage;

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const INVOICE_ID = '99999999-9999-4999-8999-999999999999';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '66666666-6666-4666-8666-666666666666';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const workOrder = {
  id: WORK_ORDER_ID,
  companyId: 'c',
  branchId: 'b',
  receptionVisitId: 'r',
  vehicleId: 'v',
  kind: 'ordinary',
  state: 'open',
  partsForwardState: 'none',
  displayNumber: 'WO-000042',
  openedAt: '2026-09-01T08:00:00Z',
  recordVersion: 2,
  customer: {
    partnerId: 'p',
    displayName: 'Layla Haddad',
    relationshipRole: 'vehicle_owner',
    hasAdditionalParties: false,
  },
  vehicle: { vehicleId: 'v', registrationPlate: '12-34567', makeModel: 'Toyota Corolla' },
};

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    companyId: 'c',
    branchId: 'b',
    workOrderId: WORK_ORDER_ID,
    quotationRevisionId: REVISION_ID,
    payerPartnerId: 'p',
    currency: 'USD',
    status: 'draft',
    invoiceNumber: null,
    issuedAt: null,
    recordVersion: 3,
    totals: {
      net: { amount: '150.0000', currency: 'USD' },
      tax: { amount: '15.0000', currency: 'USD' },
      gross: { amount: '165.0000', currency: 'USD' },
    },
    ...over,
  };
}
function line(over: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    lineNumber: 1,
    lineType: 'service',
    quantity: '2.000',
    currency: 'USD',
    sourceQuotationItemId: ITEM_ID,
    recordVersion: 1,
    money: {
      unitPrice: { amount: '100.0000', currency: 'USD' },
      net: { amount: '150.0000', currency: 'USD' },
      tax: { amount: '15.0000', currency: 'USD' },
      gross: { amount: '165.0000', currency: 'USD' },
      payerSplit: {
        customer: { amount: '165.0000', currency: 'USD' },
        warranty: { amount: '0.0000', currency: 'USD' },
      },
    },
    ...over,
  };
}
// The detail read's version deliberately differs from the work-order read's (3):
// issue and cancel must send THIS one.
function detail(over: Record<string, unknown> = {}, lineOver: Record<string, unknown> = {}) {
  const inv = invoice({ recordVersion: 5, ...over });
  return { invoice: inv, lines: [line(lineOver)], recordVersion: inv.recordVersion };
}
const preview = {
  workOrderId: WORK_ORDER_ID,
  quotationId: 'q-1',
  quotationRevisionId: REVISION_ID,
  currency: 'USD',
  subtotal: '200.0000',
  discountTotal: '50.0000',
  taxTotal: '15.0000',
  netTotal: '150.0000',
  grossTotal: '165.0000',
  lines: [
    {
      sourceQuotationItemId: ITEM_ID,
      lineNumber: 1,
      lineType: 'service',
      description: 'Front brake service',
      serviceId: 's',
      itemId: null,
      quantity: '2.000',
      unitPrice: '100.0000',
      discount: '50.0000',
      taxRate: '0.100000',
      netAmount: '150.0000',
      taxAmount: '15.0000',
      grossAmount: '165.0000',
    },
  ],
};
const outstanding = {
  invoiceId: INVOICE_ID,
  status: 'issued',
  outstanding: { amount: '100.0000', currency: 'USD' },
  isSettled: false,
};

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const denied = () => ({ status: 'denied' as const, correlationId: 'ref-403' });
const notFound = () => ({ status: 'not-found' as const, correlationId: 'ref-404' });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <InvoiceScreen
      locale="en"
      messages={en}
      workOrderId={WORK_ORDER_ID}
      workOrder={workOrder as never}
      workOrderRefused={null}
      initialInvoice={okRead({ workOrderId: WORK_ORDER_ID, invoice: null }) as never}
      canViewFinance={true}
      canIssue={false}
      {...over}
    />
  );
}

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await InvoicesPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

const region = (key: string) => screen.getByRole('region', { name: EN[key] as string });

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  readWorkOrderInvoice.mockImplementation(async () =>
    okRead({ workOrderId: WORK_ORDER_ID, invoice: null })
  );
  readInvoicePreview.mockImplementation(async () => okRead(structuredClone(preview)));
  readInvoice.mockImplementation(async () => okRead(detail()));
  readOutstanding.mockImplementation(async () => okRead({ ...outstanding }));
  readWorkOrderDetail.mockImplementation(async () =>
    okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] })
  );
});

describe('reached from a work order', () => {
  it('without a work order, explains and takes an identifier', async () => {
    const user = userEvent.setup();
    renderScreen({ workOrderId: null, workOrder: null, initialInvoice: null });
    expect(screen.getByText(EN['invoices.choose.explain'] as string)).toBeVisible();
    expect(readInvoicePreview).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(labelled('invoices.choose.workOrderId')), WORK_ORDER_ID);
    await user.click(screen.getByRole('button', { name: EN['invoices.choose.submit'] as string }));
    expect(push).toHaveBeenCalledWith(`/en/invoices?workOrderId=${WORK_ORDER_ID}`);
  });

  it('names the work order and customer, and says when the order read was refused', () => {
    renderScreen();
    expect(screen.getByText('WO-000042')).toBeVisible();
    expect(screen.getByText('Layla Haddad')).toBeVisible();
    renderScreen({ workOrder: null, workOrderRefused: { reference: 'ref-wo' } });
    expect(
      screen.getByText(EN['invoices.workOrder.refused'] as string, { exact: false })
    ).toBeVisible();
    expect(screen.getByText('ref-wo')).toBeVisible();
  });

  it('a refused work-order invoice read is a refusal, never "no invoice"', () => {
    renderScreen({ initialInvoice: denied() });
    expect(screen.getByText(EN['invoices.invoice.refused'] as string)).toBeVisible();
    expect(screen.getByText('ref-403')).toBeVisible();
    expect(
      screen.queryByRole('region', { name: EN['invoices.preview.heading'] as string })
    ).toBeNull();
  });
});

describe('FE-014 — no invoice yet: the preview and creating one', () => {
  it('reads the preview on first paint and renders the server’s figures with the document currency', async () => {
    renderScreen();
    await waitFor(() => expect(readInvoicePreview).toHaveBeenCalledWith(WORK_ORDER_ID));
    const panel = region('invoices.preview.heading');
    expect(await within(panel).findByText('Front brake service')).toBeVisible();
    expect(within(panel).getAllByText(money('165.0000')).length).toBeGreaterThanOrEqual(2);
    expect(within(panel).getAllByText(money('50.0000'))).toHaveLength(2);
    expect(within(panel).getByText(money('200.0000'))).toBeVisible();
    expect(within(panel).getByText('0.100000')).toBeVisible();
    expect(within(panel).getByText('2.000')).toBeVisible();
    expect(within(panel).queryByText(/10\s?%/)).toBeNull();
  });

  it('without finance view reads no preview and offers no create', async () => {
    renderScreen({ canViewFinance: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readInvoicePreview).not.toHaveBeenCalled();
    const panel = region('invoices.preview.heading');
    expect(within(panel).getByText(EN['invoices.preview.needsFinance'] as string)).toBeVisible();
    expect(within(panel).queryByRole('form')).toBeNull();
  });

  it('a work order with no accepted quotation revision says so with its reference, and offers no create', async () => {
    readInvoicePreview.mockImplementation(async () => notFound());
    renderScreen();
    const panel = region('invoices.preview.heading');
    expect(
      await within(panel).findByText(EN['invoices.preview.noAcceptedRevision'] as string)
    ).toBeVisible();
    expect(within(panel).getByText('ref-404')).toBeVisible();
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).queryByText(money('0.0000'))).toBeNull();
  });

  it('creates with one transport key per opened form, then re-reads and shows the invoice', async () => {
    const user = userEvent.setup();
    createInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.create.success', attempt: 1 },
      created: { ...detail(), replayed: false },
    });
    renderScreen();
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() })
    );
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await waitFor(() => expect(createInvoice).toHaveBeenCalled());
    expect(createInvoice.mock.calls[0]?.[0]).toEqual({ workOrderId: WORK_ORDER_ID });
    expect(createInvoice.mock.calls[0]?.[1]).toMatch(UUID_SHAPE);
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(EN['invoices.create.recorded'] as string);
    expect(note).toHaveTextContent(INVOICE_ID);
    expect(
      await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string })
    ).toBeVisible();
    expect(refresh).toHaveBeenCalled();
  });

  it('a refused create re-tries with the SAME key, and a conflict re-reads the work order’s invoice', async () => {
    const user = userEvent.setup();
    createInvoice.mockResolvedValueOnce({
      state: {
        status: 'unavailable',
        messageKey: 'state.unavailable.title',
        attempt: 1,
        correlationId: 'ref-503',
      },
      created: null,
    });
    renderScreen();
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await within(form).findByRole('alert');
    createInvoice.mockResolvedValueOnce({
      state: {
        status: 'conflict',
        messageKey: 'state.conflict.title',
        attempt: 2,
        correlationId: 'ref-409',
      },
      created: null,
    });
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() })
    );
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(2));
    expect(createInvoice.mock.calls[1]?.[1]).toBe(createInvoice.mock.calls[0]?.[1]);
    expect(await screen.findByText(EN['invoices.create.conflict'] as string)).toBeVisible();
    expect(
      await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string })
    ).toBeVisible();
  });

  it('a second opened form carries a different key than the first', async () => {
    const user = userEvent.setup();
    createInvoice.mockResolvedValue({
      state: {
        status: 'unavailable',
        messageKey: 'state.unavailable.title',
        attempt: 1,
        correlationId: 'r',
      },
      created: null,
    });
    const first = renderScreen();
    await user.click(
      within(
        await screen.findByRole('form', { name: EN['invoices.create.heading'] as string })
      ).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    first.unmount();
    renderScreen();
    await user.click(
      within(
        await screen.findByRole('form', { name: EN['invoices.create.heading'] as string })
      ).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(2));
    expect(createInvoice.mock.calls[1]?.[1]).not.toBe(createInvoice.mock.calls[0]?.[1]);
  });

  it('states a replayed create as "already existed", not as a new invoice', async () => {
    const user = userEvent.setup();
    createInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.create.success', attempt: 1 },
      created: { ...detail(), replayed: true },
    });
    renderScreen();
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() })
    );
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(EN['invoices.create.replayed'] as string);
  });
});

describe('FE-015 / FE-019 — the invoice, split by finance view', () => {
  const live = () => {
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() })
    );
    return { initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() }) };
  };

  it('renders the detail with the server’s strings, and the open balance', async () => {
    renderScreen({ ...live() });
    await waitFor(() => expect(readInvoice).toHaveBeenCalledWith(INVOICE_ID));
    const panel = await screen.findByRole('region', {
      name: EN['invoices.detail.heading'] as string,
    });
    expect(within(panel).getByText(EN['invoices.detail.notIssued'] as string)).toBeVisible();
    expect(within(panel).getByText(EN['invoices.status.draft'] as string)).toBeVisible();
    expect(within(panel).getAllByText(money('165.0000')).length).toBeGreaterThanOrEqual(2);
    expect(within(panel).getByText(money('100.0000'))).toBeVisible();
    expect(within(panel).getByText(money('0.0000'))).toBeVisible();
    expect(within(panel).getByText('2.000')).toBeVisible();
    await waitFor(() => expect(readOutstanding).toHaveBeenCalledWith(INVOICE_ID));
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    expect(await within(balance).findByText(money('100.0000'))).toBeVisible();
    expect(within(balance).getByText(EN['invoices.outstanding.open'] as string)).toBeVisible();
  });

  it('without finance view every amount area says not available, no zero appears, and the balance is not read', async () => {
    readInvoice.mockImplementation(async () => okRead(detail({ totals: null }, { money: null })));
    renderScreen({ ...live(), canViewFinance: false });
    const panel = await screen.findByRole('region', {
      name: EN['invoices.detail.heading'] as string,
    });
    await within(panel).findByText(EN['invoices.detail.totalsUnavailable'] as string);
    expect(
      within(panel).getAllByText(EN['invoices.money.unavailable'] as string).length
    ).toBeGreaterThanOrEqual(1);
    expect(within(panel).queryByText(/0\.00/)).toBeNull();
    expect(within(panel).getByText('2.000')).toBeVisible();
    expect(within(panel).getByText(EN['invoices.status.draft'] as string)).toBeVisible();
    const balance = screen.getByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    expect(
      within(balance).getByText(EN['invoices.outstanding.needsFinance'] as string)
    ).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readOutstanding).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: EN['invoices.issue.action'] as string })
    ).toBeNull();
  });

  it('a refused balance read is a refusal with its reference, never a zero', async () => {
    readOutstanding.mockImplementation(async () => denied());
    renderScreen({ ...live() });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    expect(
      await within(balance).findByText(EN['invoices.outstanding.refused'] as string)
    ).toBeVisible();
    expect(within(balance).getByText('ref-403')).toBeVisible();
    expect(within(balance).queryByText(money('0.0000'))).toBeNull();
  });

  it('a draft’s balance shows the server’s zero with "not issued yet" beside it', async () => {
    readOutstanding.mockImplementation(async () =>
      okRead({
        ...outstanding,
        status: 'draft',
        outstanding: { amount: '0.0000', currency: 'USD' },
        isSettled: true,
      })
    );
    renderScreen({ ...live() });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    expect(await within(balance).findByText(money('0.0000'))).toBeVisible();
    expect(within(balance).getByText(EN['invoices.outstanding.notIssued'] as string)).toBeVisible();
  });

  it('issues with the detail’s recordVersion, states the number, and re-reads', async () => {
    const user = userEvent.setup();
    issueInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.issue.success', attempt: 1 },
      created: {
        invoice: invoice({ status: 'issued', invoiceNumber: 'FXINV-000007' }),
        invoiceNumber: 'FXINV-000007',
        replayed: false,
        recordVersion: 4,
      },
    });
    renderScreen({ ...live(), canIssue: true });
    const button = await screen.findByRole('button', {
      name: EN['invoices.issue.action'] as string,
    });
    const before = readInvoice.mock.calls.length;
    await user.click(button);
    await waitFor(() => expect(issueInvoice).toHaveBeenCalledWith(INVOICE_ID, 5));
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(EN['invoices.issue.recorded'] as string);
    expect(note).toHaveTextContent('FXINV-000007');
    await waitFor(() => expect(readInvoice.mock.calls.length).toBeGreaterThan(before));
    expect(refresh).toHaveBeenCalled();
  });

  it('a stale version on issue says the invoice changed and re-reads', async () => {
    const user = userEvent.setup();
    issueInvoice.mockResolvedValue({
      state: {
        status: 'conflict',
        messageKey: 'state.conflict.title',
        attempt: 1,
        correlationId: 'ref-409',
      },
      created: null,
    });
    renderScreen({ ...live(), canIssue: true });
    const before = readInvoice.mock.calls.length;
    await user.click(
      await screen.findByRole('button', { name: EN['invoices.issue.action'] as string })
    );
    expect(await screen.findByText(EN['invoices.detail.conflict'] as string)).toBeVisible();
    await waitFor(() => expect(readInvoice.mock.calls.length).toBeGreaterThan(before));
  });

  it('offers no issue on an issued invoice, and states a replayed issue as already issued', async () => {
    const user = userEvent.setup();
    readInvoice.mockImplementation(async () => okRead(detail()));
    issueInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.issue.success', attempt: 1 },
      created: {
        invoice: invoice({ status: 'issued', invoiceNumber: 'FXINV-000007' }),
        invoiceNumber: 'FXINV-000007',
        replayed: true,
        recordVersion: 3,
      },
    });
    renderScreen({ ...live(), canIssue: true });
    await user.click(
      await screen.findByRole('button', { name: EN['invoices.issue.action'] as string })
    );
    expect(
      await screen.findByText(EN['invoices.issue.replayed'] as string, { exact: false })
    ).toBeVisible();
    readInvoice.mockImplementation(async () =>
      okRead(
        detail({
          status: 'issued',
          invoiceNumber: 'FXINV-000007',
          issuedAt: '2026-09-05T10:00:00Z',
        })
      )
    );
    renderScreen({
      initialInvoice: okRead({
        workOrderId: WORK_ORDER_ID,
        invoice: invoice({ status: 'issued', invoiceNumber: 'FXINV-000007' }),
      }),
      canIssue: true,
    });
    await screen.findAllByText('FXINV-000007');
    expect(
      screen.queryAllByRole('button', { name: EN['invoices.issue.action'] as string })
    ).toHaveLength(1);
  });

  it('cancels a draft with a reason and the detail’s recordVersion, then re-reads the work order’s invoice', async () => {
    const user = userEvent.setup();
    cancelInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.cancel.success', attempt: 1 },
      created: {
        invoice: invoice({ status: 'void_before_issue', recordVersion: 4 }),
        replayed: false,
        recordVersion: 4,
      },
    });
    renderScreen({ ...live() });
    await user.click(
      await screen.findByRole('button', { name: EN['invoices.cancel.open'] as string })
    );
    const form = await screen.findByRole('form', { name: EN['invoices.cancel.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.cancel.submit'] as string })
    );
    expect(await within(form).findByText(EN['field.required'] as string)).toBeVisible();
    expect(cancelInvoice).not.toHaveBeenCalled();
    await user.type(
      within(form).getByLabelText(labelled('invoices.cancel.reason')),
      'wrong customer'
    );
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: null })
    );
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.cancel.submit'] as string })
    );
    await waitFor(() =>
      expect(cancelInvoice).toHaveBeenCalledWith(INVOICE_ID, { reason: 'wrong customer' }, 5)
    );
    expect(await screen.findByText(EN['invoices.cancel.recorded'] as string)).toBeVisible();
    expect(
      await screen.findByRole('region', { name: EN['invoices.preview.heading'] as string })
    ).toBeVisible();
  });
});

describe('FE-020 — the printable copy', () => {
  const live = () => {
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() })
    );
    return { initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() }) };
  };

  it('takes descriptions from the preview only when its revision matches, and prints', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderScreen({ ...live() });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    expect(readInvoicePreview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    await waitFor(() => expect(readInvoicePreview).toHaveBeenCalledWith(WORK_ORDER_ID));
    const document = await screen.findByRole('article');
    expect(within(document).getByText('Front brake service')).toBeVisible();
    expect(
      within(document).getByText(EN['invoices.print.descriptionsFromQuotation'] as string)
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: EN['invoices.print.print'] as string }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('with a preview of another revision, prints without descriptions and says so', async () => {
    const user = userEvent.setup();
    readInvoicePreview.mockImplementation(async () =>
      okRead({ ...structuredClone(preview), quotationRevisionId: 'other-revision' })
    );
    renderScreen({ ...live() });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(within(document).queryByText('Front brake service')).toBeNull();
    expect(within(document).getByText(EN['invoices.print.noDescription'] as string)).toBeVisible();
    expect(
      within(document).getByText(EN['invoices.print.descriptionsUnavailable'] as string)
    ).toBeVisible();
  });

  it('a refused preview is said on the paper view with its reference, never as a mismatch', async () => {
    const user = userEvent.setup();
    readInvoicePreview.mockImplementation(async () => denied());
    renderScreen({ ...live() });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(
      within(document).getByText(EN['invoices.print.previewRefused'] as string, { exact: false })
    ).toBeVisible();
    expect(within(document).getByText('ref-403')).toBeVisible();
    expect(
      within(document).queryByText(EN['invoices.print.descriptionsUnavailable'] as string)
    ).toBeNull();
  });

  it('without finance view reads no preview, prints no amount, and says so', async () => {
    const user = userEvent.setup();
    readInvoice.mockImplementation(async () => okRead(detail({ totals: null }, { money: null })));
    renderScreen({ ...live(), canViewFinance: false });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(readInvoicePreview).not.toHaveBeenCalled();
    expect(
      within(document).getByText(EN['invoices.print.descriptionsNeedFinance'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(
      within(document).getByText(EN['invoices.print.amountsUnavailable'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(within(document).queryByText(/0\.00/)).toBeNull();
  });
});

describe('the /invoices route page decides before it reads', () => {
  it('refuses without sal.invoice.manage, and reads nothing — not even the work order', async () => {
    PERMISSIONS = ['sal.finance.view', 'wo.work_order.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(readWorkOrderInvoice).not.toHaveBeenCalled();
  });

  it('with sal.invoice.manage alone reads the invoice, not the work order, and offers no amounts', async () => {
    PERMISSIONS = ['sal.invoice.manage'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderInvoice).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(screen.getByText(EN['invoices.workOrder.notReadable'] as string)).toBeVisible();
    expect(screen.getByText(EN['invoices.preview.needsFinance'] as string)).toBeVisible();
  });

  it('with finance view and work-order read, names the order and reads the preview; with issue, offers issuing on a draft', async () => {
    PERMISSIONS = [
      'sal.invoice.manage',
      'sal.finance.view',
      'wo.work_order.read',
      'sal.invoice.issue',
    ];
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() })
    );
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(screen.getByText('WO-000042')).toBeVisible();
    expect(
      await screen.findByRole('button', { name: EN['invoices.issue.action'] as string })
    ).toBeVisible();
  });

  it('without a work order in the address, offers the chooser and reads nothing', async () => {
    PERMISSIONS = ['sal.invoice.manage'];
    await renderPage({ locale: 'en' });
    expect(screen.getByText(EN['invoices.choose.explain'] as string)).toBeVisible();
    expect(readWorkOrderInvoice).not.toHaveBeenCalled();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['sal.invoice.manage'];
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound');
  });
});

describe('Arabic, right to left', () => {
  it('renders the preview in Arabic with the same behaviour', async () => {
    renderRtl(
      <InvoiceScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        workOrderRefused={null}
        initialInvoice={okRead({ workOrderId: WORK_ORDER_ID, invoice: null }) as never}
        canViewFinance={true}
        canIssue={false}
      />
    );
    await waitFor(() => expect(readInvoicePreview).toHaveBeenCalled());
    expect(await screen.findByText('Front brake service')).toBeVisible();
    expect(screen.getByText(AR['invoices.preview.heading'] as string)).toBeVisible();
  });
});
