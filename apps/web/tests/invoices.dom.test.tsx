import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { formatMoney } from '../src/lib/money';
import { formatInZone } from '../src/lib/branch-time';
import accountManifest from './e2e/authenticated/account-manifest.json';
import type { ReactElement } from 'react';
import {
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
  BranchSwitch,
  TEST_COMPANY,
  WorkingBranchProbe,
} from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { formatMessage, getMessages } from '@/i18n/get-messages';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
import { findSearchedOption } from './support/picker-option';
import { CLIENT_READ_TIMEOUT_MS } from '@/lib/api/read-budget';
import type { BranchPermissions } from '@/features/working-context/working-context-contract';

/*
 * On the shared Material UI wrappers since the sales and finance slice
 * (ADR-022): every render goes inside the Material foundation, as the locale
 * layout mounts the screens.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderInLtr = (ui: ReactElement, options?: Parameters<typeof renderLtrBare>[1]) =>
  renderLtrBare(withMui(ui, 'en'), options);
const renderInRtl = (ui: ReactElement, options?: Parameters<typeof renderRtlBare>[1]) =>
  renderRtlBare(withMui(ui, 'ar'), options);

/*
 * The credit-notes list is addressed to a branch, and that branch is the
 * working context's own named selection now — chosen once in the header,
 * never on the screen (Owner directive, `P1-32-PRE-OD-UX`). So every render
 * here goes inside a provider.
 */
const renderLtr = (ui: ReactElement, options?: Parameters<typeof renderInLtr>[1]) =>
  renderInLtr(inBranch(ui), options);
const renderRtl = (ui: ReactElement, options?: Parameters<typeof renderInRtl>[1]) =>
  renderInRtl(inBranch(ui, { locale: 'ar' }), options);

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
// DEF-T-07: the two credit-note reads, on the same module surface — and the two
// writes that raise and approve one, with the invoice list the raise form finds
// its invoice through.
const listCreditNotes = vi.fn();
const readCreditNote = vi.fn();
const requestCreditNote = vi.fn();
const approveCreditNote = vi.fn();
// ADR-023 D3: the requester withdraws, somebody else rejects.
const withdrawCreditNote = vi.fn();
const rejectCreditNote = vi.fn();
const listInvoices = vi.fn();
vi.mock('@/features/billing/api', () => ({
  readWorkOrderInvoice: (...args: unknown[]) => readWorkOrderInvoice(...args),
  readInvoicePreview: (...args: unknown[]) => readInvoicePreview(...args),
  readInvoice: (...args: unknown[]) => readInvoice(...args),
  readOutstanding: (...args: unknown[]) => readOutstanding(...args),
  createInvoice: (...args: unknown[]) => createInvoice(...args),
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
  cancelInvoice: (...args: unknown[]) => cancelInvoice(...args),
  listCreditNotes: (...args: unknown[]) => listCreditNotes(...args),
  readCreditNote: (...args: unknown[]) => readCreditNote(...args),
  requestCreditNote: (...args: unknown[]) => requestCreditNote(...args),
  approveCreditNote: (...args: unknown[]) => approveCreditNote(...args),
  withdrawCreditNote: (...args: unknown[]) => withdrawCreditNote(...args),
  rejectCreditNote: (...args: unknown[]) => rejectCreditNote(...args),
  listInvoices: (...args: unknown[]) => listInvoices(...args),
}));

// DX-2 (finance QA fixes E): the balance is read through the cancellable route
// rather than a Server Action. Its browser half is forwarded to the same stand-in
// the action had, so every case below asks and answers exactly as before.
vi.mock('@/features/billing/outstanding-read', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readOutstandingCancellable: (invoiceId: string) => readOutstanding(invoiceId),
}));

// A different payer is FOUND among customers; the directory adapter is replaced.
const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: (...args: unknown[]) => searchCustomerDirectory(...args),
}));
const OTHER_PAYER = '99999999-9999-4999-8999-999999999999';

/*
 * The credit-note screen names its branch through the SAME picker the stock
 * screens use, so the branch list it reads belongs to the inventory adapter.
 */
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listBranches: (...args: unknown[]) => listBranches(...args),
  listLocations: vi.fn(),
  listItems: vi.fn(),
  listItemCategories: vi.fn(),
}));

const readWorkOrderDetail = vi.fn();
const listWorkOrders = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
}));
vi.mock('@/features/work-orders/work-order-list-read', () => ({
  listWorkOrdersCancellable: (...args: unknown[]) => listWorkOrders(...args),
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
/** The person the session names; the credit-note fixtures are raised by someone else. */
const SIGNED_IN = 'u2';
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    permissions: PERMISSIONS,
    email: 'operator@test.local',
    userId: SIGNED_IN,
  }),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { InvoiceScreen } = await import('@/features/billing/components/InvoiceScreen');
const { CreditNotesScreen } = await import('@/features/billing/components/CreditNotesScreen');
const { WorkOrderPicker } = await import('@/features/work-orders/components/WorkOrderPicker');
const CreditNotesPage = (await import('@/app/[locale]/(dashboard)/credit-notes/page'))
  .default as unknown as RoutePage;
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const InvoicesPage = (await import('@/app/[locale]/(dashboard)/invoices/page'))
  .default as unknown as RoutePage;

const COMPANY_ID_FIXTURE = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID_FIXTURE = '22222222-2222-4222-8222-222222222222';
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
  settlement: {
    creditStatus: 'none',
    paymentStatus: 'open',
    refundStatus: 'none',
    credited: { amount: '0.0000', currency: 'USD' },
    paid: { amount: '0.0000', currency: 'USD' },
  },
  asOf: '2026-10-01T07:30:00.000Z',
};

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

/**
 * What `sal.credit-note-detail` traces a note to (finance checkpoint, DF-B4):
 * a job's invoice, raised by hand, requested by a person the reader may name.
 */
function trace(over: Record<string, unknown> = {}) {
  return {
    requestedAt: '2026-09-19T08:00:00Z',
    requestedByName: 'Rana Saleh',
    approvedByName: null,
    decidedByName: null,
    invoice: {
      invoiceNumber: 'INV-000123',
      saleKind: 'work_order',
      workOrderId: WORK_ORDER_ID,
      payerName: 'Layla Haddad',
    },
    sourceReturn: null,
    ...over,
  };
}
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

/** The screen with no work order named: the chooser, able to search by default. */
function chooser(over: Record<string, unknown> = {}) {
  return (
    <InvoiceScreen
      locale="en"
      messages={en}
      workOrderId={null}
      workOrder={null}
      workOrderRefused={null}
      initialInvoice={null}
      canViewFinance={true}
      canIssue={false}
      canSearchWorkOrders={true}
      {...over}
    />
  );
}

function renderChooser(over: Record<string, unknown> = {}) {
  return renderLtr(chooser(over));
}

const foundPage = (rows: readonly unknown[]) => ({
  status: 'ok' as const,
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-wo',
});

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
  it('without a work order, FINDS the job on the working branch and opens it by name', async () => {
    listWorkOrders.mockResolvedValue(foundPage([workOrder]));
    const user = userEvent.setup();
    renderChooser();
    expect(screen.getByText(EN['invoices.choose.explain'] as string)).toBeVisible();
    expect(readInvoicePreview).not.toHaveBeenCalled();
    // No box asks for a reference: the only box is the job search.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    await user.type(
      screen.getByLabelText(EN['invoices.choose.workOrderId'] as string),
      'Layla{Enter}'
    );
    const match = await findSearchedOption(listWorkOrders, 'Layla', /WO-000042/);
    // Server-side, addressed to the branch the header holds, with the term as `q`.
    expect(listWorkOrders).toHaveBeenCalledWith(
      { companyId: TEST_BRANCH.companyId, branchId: TEST_BRANCH.id },
      { q: 'Layla' },
      expect.objectContaining({ page: 1 }),
      null,
      // The read is cancellable: it carries the signal its search aborts.
      expect.any(AbortSignal)
    );
    expect(match).toHaveTextContent('12-34567');
    expect(match).toHaveTextContent('Layla Haddad');
    await user.click(match);
    expect(
      (screen.getByLabelText(EN['invoices.choose.workOrderId'] as string) as HTMLInputElement).value
    ).toContain('WO-000042');
    await user.click(screen.getByRole('button', { name: EN['invoices.choose.submit'] as string }));
    // The CHOSEN record travels; the search term never reaches the address.
    expect(push).toHaveBeenCalledWith(`/en/invoices?workOrderId=${WORK_ORDER_ID}`);
    expect(String(push.mock.calls[0]?.[0])).not.toContain('Layla');
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

describe('finding the job when none is named (WorkOrderPicker)', () => {
  it('submitting with nothing chosen marks the box, says why, and moves the cursor there', async () => {
    const user = userEvent.setup();
    renderChooser();
    await user.click(screen.getByRole('button', { name: EN['invoices.choose.submit'] as string }));
    const box = screen.getByLabelText(EN['invoices.choose.workOrderId'] as string);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(EN['workOrders.picker.required'] as string);
    await waitFor(() => expect(box).toHaveFocus());
    expect(push).not.toHaveBeenCalled();
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('keeps what was typed after a refusal, and the complaint goes once a job is chosen', async () => {
    listWorkOrders.mockResolvedValue(foundPage([workOrder]));
    const user = userEvent.setup();
    renderChooser();
    const box = screen.getByLabelText(EN['invoices.choose.workOrderId'] as string);
    await user.type(box, 'WO-42');
    await user.click(screen.getByRole('button', { name: EN['invoices.choose.submit'] as string }));
    expect(box).toHaveValue('WO-42');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    // The matches reopen under the box once the operator is back in it.
    await user.click(box);
    await user.click(await findSearchedOption(listWorkOrders, 'WO-42', /WO-000042/));
    expect(screen.queryByText(EN['workOrders.picker.required'] as string)).toBeNull();
  });

  it('a single character is not searched, and says how many are needed', async () => {
    const user = userEvent.setup();
    renderChooser();
    await user.type(screen.getByLabelText(EN['invoices.choose.workOrderId'] as string), 'W{Enter}');
    expect(screen.getByText(EN['workOrders.picker.tooShort'] as string)).toBeVisible();
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('a refused search is a refusal with its reference, never "nothing matched"', async () => {
    listWorkOrders.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'ref-wo-403',
    });
    const user = userEvent.setup();
    renderChooser();
    await user.type(
      screen.getByLabelText(EN['invoices.choose.workOrderId'] as string),
      'WO-42{Enter}'
    );
    expect(await screen.findByText('ref-wo-403', { exact: false })).toBeVisible();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();
  });

  it('without the work-order code keeps a labelled reference box and a submit, checked as the server checks it, and the invoice of the typed job is created (route sweep B2)', async () => {
    /*
     * `sal.invoice-create` needs `sal.invoice.manage` and `sal.finance.view`
     * only, so a caller without `wo.work_order.read` must not lose the way in:
     * no search, but the box they had before the picker, and a submit.
     */
    PERMISSIONS = ['sal.invoice.manage', 'sal.finance.view'];
    const user = userEvent.setup();
    const first = await renderPage({ locale: 'en' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(listWorkOrders).not.toHaveBeenCalled();
    const box = screen.getByLabelText(labelled('invoices.choose.referenceLabel'));
    expect(box).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(EN['invoices.choose.referenceHelp'] as string)).toBeVisible();
    const submit = screen.getByRole('button', { name: EN['invoices.choose.submit'] as string });
    expect(submit).toBeEnabled();
    // Empty: refused on the box, the cursor goes there, nothing opens.
    await user.click(submit);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(
      EN['invoices.choose.referenceFormat'] as string
    );
    await waitFor(() => expect(box).toHaveFocus());
    // Shaped 8-4-4-4-12 in hex but with no valid version or variant: the
    // server's identifier rule refuses it, so this box does too.
    await user.type(box, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(box).not.toHaveAttribute('aria-invalid', 'true');
    await user.click(submit);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(push).not.toHaveBeenCalled();
    await user.clear(box);
    await user.type(box, ` ${WORK_ORDER_ID} `);
    await user.click(submit);
    expect(push).toHaveBeenCalledWith(`/en/invoices?workOrderId=${WORK_ORDER_ID}`);
    first.unmount();
    // The address the chooser opened: the job is not read, the invoice is made.
    createInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.create.success', attempt: 1 },
      created: { ...detail(), replayed: false },
    });
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    expect(createInvoice.mock.calls[0]?.[0]).toEqual({ workOrderId: WORK_ORDER_ID });
  });

  it('with several branches and none chosen, asks for the branch and reads nothing', () => {
    renderInLtr(inBranch(chooser(), { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }));
    // The desk names its branch nowhere else, so the ask carries the chooser.
    expect(screen.getByText(EN['workingContext.chooseBranchHere'] as string)).toBeVisible();
    expect(screen.getByTestId('concrete-branch-chooser')).toHaveValue('');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('in Arabic, the question, the example and the complaint are Arabic', async () => {
    const user = userEvent.setup();
    renderRtl(chooser({ locale: 'ar', messages: ar }));
    expect(screen.getByText(AR['workOrders.picker.searchExample'] as string)).toBeVisible();
    await user.click(screen.getByRole('button', { name: AR['invoices.choose.submit'] as string }));
    expect(screen.getByLabelText(AR['invoices.choose.workOrderId'] as string)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('alert')).toHaveTextContent(AR['workOrders.picker.required'] as string);
  });
});

describe('the job picker and the working context', () => {
  /*
   * The picker searches what the header holds when it is ONE branch, and
   * nothing under "All my branches" or before a branch is chosen: the screen
   * writes against the job it finds, so it is a concrete route and asks for one
   * named branch instead (PR #467 review). A switch forgets the job
   * found under the previous branch, asks first when one was chosen, and drops
   * a reply that was still in flight.
   */
  afterEach(forgetRememberedBranch);

  const FAR_COMPANY = {
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Far Operations',
    code: 'FAR',
  };
  const FAR_BRANCH = {
    ...OTHER_BRANCH,
    id: '77777777-7777-4777-8777-777777777777',
    companyId: FAR_COMPANY.id,
    name: 'Far workshop',
  };
  const found = (rows: readonly unknown[]) => ({
    status: 'ok' as const,
    rows,
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-wo',
  });

  function renderWith(
    snapshot: ReturnType<typeof branchSnapshot>,
    over: Record<string, unknown> = {}
  ) {
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <BranchSwitch to="all" label="everywhere" />
          <WorkingBranchProbe />
          {chooser(over)}
        </>,
        { snapshot }
      )
    );
  }
  const box = () => screen.getByLabelText(EN['invoices.choose.workOrderId'] as string);
  const submit = () => screen.getByRole('button', { name: EN['invoices.choose.submit'] as string });

  it('under "All my branches" searches nothing, asks for one named branch right there, and disables the submit (PR #467 review)', async () => {
    listWorkOrders.mockResolvedValue(found([workOrder]));
    const user = userEvent.setup();
    renderWith(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    const panel = await screen.findByTestId('work-order-picker-needs-branch');
    expect(panel).toHaveTextContent(EN['workingContext.chooseBranchHere'] as string);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(submit()).toBeDisabled();
    // No request at all — above all, none for every branch of the company.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listWorkOrders).not.toHaveBeenCalled();
    // The named chooser beside the ask is the working context's own switch,
    // and nothing is pre-selected in it.
    const chooser = screen.getByTestId('concrete-branch-chooser') as HTMLSelectElement;
    expect(chooser.value).toBe('');
    await user.selectOptions(chooser, OTHER_BRANCH.id);
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await user.type(box(), 'Layla{Enter}');
    expect(await findSearchedOption(listWorkOrders, 'Layla', /WO-000042/)).toBeVisible();
    expect(listWorkOrders).toHaveBeenCalledWith(
      { companyId: TEST_COMPANY.id, branchId: OTHER_BRANCH.id },
      { q: 'Layla' },
      expect.objectContaining({ page: 1 }),
      null,
      expect.any(AbortSignal)
    );
    for (const call of listWorkOrders.mock.calls) {
      expect((call[0] as { branchId: string | null }).branchId).not.toBeNull();
    }
  });

  it('under "All my branches" across companies, says why, reads nothing, and disables the submit with that reason', async () => {
    const user = userEvent.setup();
    renderWith({
      ...branchSnapshot([TEST_BRANCH, FAR_BRANCH]),
      companies: [TEST_COMPANY, FAR_COMPANY],
    });
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    const panel = await screen.findByTestId('work-order-picker-needs-branch');
    expect(panel).toHaveTextContent(EN['workingContext.chooseBranchHere'] as string);
    expect(screen.queryByRole('searchbox')).toBeNull();
    // A submit that would refuse with no control to point at is disabled
    // instead, and described by the sentence that says why.
    expect(submit()).toBeDisabled();
    const describedBy = submit().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      EN['workingContext.chooseBranchHere'] as string
    );
    expect(listWorkOrders).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('a reply still in flight when the branch changes is dropped, and the term goes with it', async () => {
    let answer: (value: unknown) => void = () => undefined;
    listWorkOrders.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const user = userEvent.setup();
    renderWith(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.type(box(), 'Layla{Enter}');
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    // Nothing chosen yet, so nothing to lose: the switch does not ask.
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    answer(found([workOrder]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('option', { name: /WO-000042/ })).toBeNull();
    expect(box()).toHaveValue('');
    expect(listWorkOrders).toHaveBeenCalledTimes(1);
  });

  it('a chosen job is not unsaved work — the form only opens a page — so the switch does not ask, and forgets it (route sweep B3)', async () => {
    listWorkOrders.mockResolvedValue(found([workOrder]));
    const user = userEvent.setup();
    renderWith(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.type(box(), 'Layla{Enter}');
    await user.click(await findSearchedOption(listWorkOrders, 'Layla', /WO-000042/));
    expect((box() as HTMLInputElement).value).toContain('WO-000042');

    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await waitFor(() => expect(box()).toHaveValue(''));
    // Nothing is opened for a job that belonged to the previous branch.
    await user.click(submit());
    expect(push).not.toHaveBeenCalled();
  });

  it('a typed job reference is not unsaved work either: the same rule as the picker, and the reference is kept', async () => {
    const user = userEvent.setup();
    renderWith(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]), { canSearchWorkOrders: false });
    await user.click(screen.getByRole('button', { name: 'first' }));
    const typed = screen.getByLabelText(labelled('invoices.choose.referenceLabel'));
    await user.type(typed, WORK_ORDER_ID);
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    // A reference names one job whatever the branch, so it stays for the submit.
    expect(typed).toHaveValue(WORK_ORDER_ID);
  });
});

describe('the job picker without the work-order code', () => {
  it('says the job cannot be looked up in a sentence carrying the id its caller describes a control with', () => {
    /*
     * The invoice desk now keeps a typed reference in this case, so the sentence
     * is rendered by the picker itself here. A caller that describes its submit
     * by `needsBranchId` must find an element with that id, never a blank one.
     */
    renderInLtr(
      inBranch(
        <WorkOrderPicker
          messages={en}
          label="Job"
          value={null}
          onChange={() => undefined}
          canSearch={false}
          needsBranchId="job-why"
        />
      )
    );
    const sentence = screen.getByText(EN['workOrders.picker.notPermitted'] as string);
    expect(sentence).toBeVisible();
    expect(sentence.id).not.toBe('');
    expect(sentence.id).toBe('job-why');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(listWorkOrders).not.toHaveBeenCalled();
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
    const note = await screen.findByText(EN['invoices.create.recorded'] as string);
    // A draft has no number yet, and its reference is never printed in its place.
    expect(note.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(
      await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string })
    ).toBeVisible();
    expect(refresh).toHaveBeenCalled();
  });

  it('bills a different payer found by name, and sends only that customer', async () => {
    searchCustomerDirectory.mockResolvedValue({
      status: 'ok',
      rows: [
        {
          id: OTHER_PAYER,
          displayNumber: 'C-000900',
          displayName: 'Fleet Partner',
          partyType: 'organization',
          lifecycleStatus: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          primaryPhone: null,
          phoneMasked: false,
          vehicleCount: 3,
        },
      ],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-c',
    });
    createInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.create.success', attempt: 1 },
      created: { ...detail(), replayed: false },
    });
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: true });
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    // No box on this form asks for a partner reference.
    expect(within(form).queryByDisplayValue(UUID_SHAPE)).toBeNull();
    await user.type(within(form).getByLabelText(labelled('invoices.create.payer')), 'Fleet');
    await user.click(await findSearchedOption(searchCustomerDirectory, 'Fleet', /Fleet Partner/));
    expect(searchCustomerDirectory.mock.calls.at(-1)?.[2]).toEqual({ q: 'Fleet' });
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await waitFor(() => expect(createInvoice).toHaveBeenCalled());
    expect(createInvoice.mock.calls[0]?.[0]).toEqual({
      workOrderId: WORK_ORDER_ID,
      payerPartnerId: OTHER_PAYER,
    });
  });

  it('with the customer read offers the search and no reference box at all', async () => {
    renderScreen({ canReadCustomers: true });
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    expect(within(form).getByTestId('invoice-payer-picker')).toBeVisible();
    expect(within(form).queryByLabelText(labelled('invoices.create.payerReference'))).toBeNull();
  });

  it('without the customer read offers no search, and still bills the work order’s customer', async () => {
    createInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.create.success', attempt: 1 },
      created: { ...detail(), replayed: false },
    });
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: false });
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    expect(within(form).queryByRole('searchbox')).toBeNull();
    expect(within(form).queryByTestId('invoice-payer-picker')).toBeNull();
    await user.click(
      within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
    );
    await waitFor(() => expect(createInvoice).toHaveBeenCalled());
    expect(createInvoice.mock.calls[0]?.[0]).toEqual({ workOrderId: WORK_ORDER_ID });
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('without the customer read a different payer is STILL named, through the labelled reference', async () => {
    // `sal.invoice-create` declares the invoice and finance codes only, and the
    // server REQUIRES a payer here when the quotation names none, so a caller
    // without `crm.customer.read` must not lose the invoice it could create.
    createInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.create.success', attempt: 1 },
      created: { ...detail(), replayed: false },
    });
    const user = userEvent.setup();
    renderScreen({ canReadCustomers: false });
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    expect(
      within(form).getByText(EN['invoices.create.payerReferenceHelp'] as string)
    ).toBeVisible();
    const box = within(form).getByLabelText(labelled('invoices.create.payerReference'));
    const submit = within(form).getByRole('button', {
      name: EN['invoices.create.submit'] as string,
    });
    expect(submit).toBeEnabled();

    await user.type(box, 'not-a-reference');
    await user.click(submit);
    expect(
      await within(form).findByText(EN['invoices.create.payerReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(createInvoice).not.toHaveBeenCalled();

    // Eight-four-four-four-twelve hex with no RFC version digit or variant: the
    // server's `z.string().uuid()` refuses it, so the box refuses it first.
    await user.clear(box);
    await user.type(box, '12345678-1234-0234-7234-123456789abc');
    await user.click(submit);
    expect(
      await within(form).findByText(EN['invoices.create.payerReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(createInvoice).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, OTHER_PAYER);
    await user.click(submit);
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    expect(createInvoice.mock.calls[0]?.[0]).toEqual({
      workOrderId: WORK_ORDER_ID,
      payerPartnerId: OTHER_PAYER,
    });
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('a typed payer reference is unsaved work: a branch switch asks first', async () => {
    const user = userEvent.setup();
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <InvoiceScreen
            locale="en"
            messages={en}
            workOrderId={WORK_ORDER_ID}
            workOrder={workOrder as never}
            workOrderRefused={null}
            initialInvoice={okRead({ workOrderId: WORK_ORDER_ID, invoice: null }) as never}
            canViewFinance={true}
            canIssue={false}
            canReadCustomers={false}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    try {
      // Nothing typed yet, so nothing to lose.
      await switchWithoutQuestion(user, 'second');
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      await user.type(
        within(form).getByLabelText(labelled('invoices.create.payerReference')),
        OTHER_PAYER
      );
      await stayOnBranch(user, await switchExpectingQuestion(user, 'first'));
      expect(heldBranch()).toBe(OTHER_BRANCH.id);
    } finally {
      forgetRememberedBranch();
    }
  });

  it('a confirmed discard empties the typed payer reference, so nothing typed before the switch is sent after it', async () => {
    /*
     * The form is the work order's and nothing on it is keyed on the branch, so
     * the switch alone would leave the reference where it was — on a form the
     * question had just said was being thrown away.
     */
    const user = userEvent.setup();
    createInvoice.mockResolvedValue({
      state: { status: 'success', messageKey: 'invoices.create.success', attempt: 1 },
      created: { ...detail(), replayed: false },
    });
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <InvoiceScreen
            locale="en"
            messages={en}
            workOrderId={WORK_ORDER_ID}
            workOrder={workOrder as never}
            workOrderRefused={null}
            initialInvoice={okRead({ workOrderId: WORK_ORDER_ID, invoice: null }) as never}
            canViewFinance={true}
            canIssue={false}
            canReadCustomers={false}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    const form = await screen.findByRole('form', { name: EN['invoices.create.heading'] as string });
    const box = () => within(form).getByLabelText(labelled('invoices.create.payerReference'));
    try {
      await user.type(box(), OTHER_PAYER);
      await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      await waitFor(() => expect(box()).toHaveValue(''));
      // Nothing is left to lose, so the next switch asks nothing.
      await switchWithoutQuestion(user, 'first');
      await waitFor(() => expect(heldBranch()).toBe(TEST_BRANCH.id));
      // And a create sent now names no payer: the discarded one is gone.
      await user.click(
        within(form).getByRole('button', { name: EN['invoices.create.submit'] as string })
      );
      await waitFor(() => expect(createInvoice).toHaveBeenCalled());
      expect(createInvoice.mock.calls[0]?.[0]).toEqual({ workOrderId: WORK_ORDER_ID });
    } finally {
      forgetRememberedBranch();
    }
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
    expect(await screen.findByText(EN['invoices.create.replayed'] as string)).toBeVisible();
  });
});

describe('FE-015 / FE-019 — the invoice, split by finance view', () => {
  const live = () => {
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() })
    );
    return { initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() }) };
  };

  /** The issue question, answered: nothing is sent before it. */
  async function confirmIssue(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['invoices.issue.confirmTitle'] as string,
    });
    expect(issueInvoice).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', { name: EN['invoices.issue.action'] as string })
    );
  }

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
    // D7: the credit, payment and refund positions, each the server's, each named.
    expect(within(balance).getByTestId('invoice-credit-status')).toHaveTextContent(
      EN['invoices.creditStatus.none'] as string
    );
    expect(within(balance).getByTestId('invoice-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.open'] as string
    );
    expect(within(balance).getByTestId('invoice-refund-status')).toHaveTextContent(
      EN['invoices.refundStatus.none'] as string
    );
  });

  it('a fully credited invoice reads "fully credited" and "nothing to pay" — never settled or paid (D7)', async () => {
    readOutstanding.mockImplementation(async () =>
      okRead({
        ...outstanding,
        outstanding: { amount: '0.0000', currency: 'USD' },
        isSettled: true,
        settlement: {
          creditStatus: 'credited',
          paymentStatus: 'nothing_due',
          refundStatus: 'none',
          credited: { amount: '165.0000', currency: 'USD' },
          paid: { amount: '0.0000', currency: 'USD' },
        },
      })
    );
    renderScreen({ ...live() });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    expect(await within(balance).findByTestId('invoice-credit-status')).toHaveTextContent(
      EN['invoices.creditStatus.credited'] as string
    );
    expect(within(balance).getByTestId('invoice-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.nothing_due'] as string
    );
    expect(within(balance).getByText(money('165.0000'))).toBeVisible();
    expect(within(balance).queryByText(EN['invoices.outstanding.settled'] as string)).toBeNull();
    expect(within(balance).queryByText(EN['invoices.paymentStatus.paid'] as string)).toBeNull();
  });

  it('a partly credited invoice says so in Arabic, apart from its payment position (D7)', async () => {
    readOutstanding.mockImplementation(async () =>
      okRead({
        ...outstanding,
        outstanding: { amount: '60.0000', currency: 'USD' },
        settlement: {
          creditStatus: 'partly_credited',
          paymentStatus: 'open',
          refundStatus: 'none',
          credited: { amount: '40.0000', currency: 'USD' },
          paid: { amount: '0.0000', currency: 'USD' },
        },
      })
    );
    renderRtl(
      <InvoiceScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        workOrderRefused={null}
        initialInvoice={live().initialInvoice as never}
        canViewFinance={true}
        canIssue={false}
      />
    );
    const balance = await screen.findByRole('region', {
      name: AR['invoices.outstanding.heading'] as string,
    });
    expect(await within(balance).findByTestId('invoice-credit-status')).toHaveTextContent(
      AR['invoices.creditStatus.partly_credited'] as string
    );
    expect(within(balance).getByTestId('invoice-payment-status')).toHaveTextContent(
      AR['invoices.paymentStatus.open'] as string
    );
  });

  /** A settlement of which 70 was paid by an insurer for this invoice's customer (D14). */
  const paidByInsurer = {
    ...outstanding,
    outstanding: { amount: '30.0000', currency: 'USD' },
    settlement: {
      ...outstanding.settlement,
      paid: { amount: '70.0000', currency: 'USD' },
      thirdPartyPayments: [
        {
          receipt: { id: 'r-1', reference: 'RCT-000031' },
          payerName: 'Gulf Mutual Insurance',
          relationship: 'insurer',
          authorisationReference: 'CLM-2026-0042',
          reason: 'Covered under the policy',
          money: { amount: '70.0000', currency: 'USD' },
          allocatedAt: '2026-10-02T09:00:00.000Z',
        },
      ],
      thirdPartyPaymentsTruncated: false,
    },
  };

  it('says who paid for whom when somebody else paid part of the invoice, with the authorisation (D14)', async () => {
    readOutstanding.mockImplementation(async () => okRead(paidByInsurer));
    renderScreen({ ...live() });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    const payment = await within(balance).findByTestId('invoice-third-party-payment');
    expect(payment).toHaveTextContent(
      formatMessage(EN['invoices.thirdParty.paidBy'] as string, {
        payer: 'Gulf Mutual Insurance',
        relationship: EN['invoices.thirdParty.relationship.insurer'] as string,
        customer: 'Layla Haddad',
      })
    );
    expect(payment).toHaveTextContent('CLM-2026-0042');
    expect(payment).toHaveTextContent('RCT-000031');
    expect(payment).toHaveTextContent(money('70.0000'));
  });

  it('says who paid for whom in Arabic, a withheld payer said as withheld (D14)', async () => {
    readOutstanding.mockImplementation(async () =>
      okRead({
        ...paidByInsurer,
        settlement: {
          ...paidByInsurer.settlement,
          thirdPartyPayments: [
            { ...paidByInsurer.settlement.thirdPartyPayments[0], payerName: null },
          ],
        },
      })
    );
    renderRtl(
      <InvoiceScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        workOrderRefused={null}
        initialInvoice={live().initialInvoice as never}
        canViewFinance={true}
        canIssue={false}
      />
    );
    const balance = await screen.findByRole('region', {
      name: AR['invoices.outstanding.heading'] as string,
    });
    const payment = await within(balance).findByTestId('invoice-third-party-payment');
    expect(payment).toHaveTextContent(
      formatMessage(AR['invoices.thirdParty.paidBy'] as string, {
        payer: AR['invoices.thirdParty.payerNotShown'] as string,
        relationship: AR['invoices.thirdParty.relationship.insurer'] as string,
        customer: 'Layla Haddad',
      })
    );
    expect(payment).toHaveTextContent('CLM-2026-0042');
  });

  it('shows a part line copied from the quotation by the part’s name and stock code, with its unit (D6)', async () => {
    readInvoice.mockImplementation(async () =>
      okRead(
        detail(
          {},
          {
            lineType: 'part',
            quantity: '1.500',
            item: { id: 'part-1', code: 'BRK-01', name: 'Brake pads' },
            unit: { code: 'each', name: 'Each' },
          }
        )
      )
    );
    renderScreen({ ...live() });
    const panel = await screen.findByRole('region', {
      name: EN['invoices.detail.heading'] as string,
    });
    const quantity = await within(panel).findByText('1.500');
    const row = quantity.closest('tr') as HTMLElement;
    expect(within(row).getByText(EN['invoices.lineType.part'] as string)).toBeVisible();
    expect(within(row).getByText('Brake pads')).toBeVisible();
    expect(within(row).getByText('BRK-01')).toHaveAttribute('dir', 'ltr');
    expect(within(row).getByText('Each')).toBeVisible();
    // Named, never identified.
    expect(row.textContent).not.toContain('part-1');
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
        settlement: null,
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
    await confirmIssue(user);
    await waitFor(() => expect(issueInvoice).toHaveBeenCalledWith(INVOICE_ID, 5));
    const note = await screen.findByText(EN['invoices.issue.recorded'] as string, {
      exact: false,
    });
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
    await confirmIssue(user);
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
    await confirmIssue(user);
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
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['invoices.cancel.heading'] as string,
    });
    const confirm = () =>
      within(dialog).getByRole('button', { name: EN['invoices.cancel.submit'] as string });
    // No reason, no cancel: the confirmation is held, and the box says why.
    expect(confirm()).toBeDisabled();
    const reason = within(dialog).getByLabelText(labelled('invoices.cancel.reason'));
    await user.click(reason);
    await user.tab();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(EN['overlay.reasonRequired'] as string)).toBeVisible();
    expect(cancelInvoice).not.toHaveBeenCalled();
    await user.type(reason, 'wrong customer');
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: null })
    );
    await user.click(confirm());
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
    // The payer by name (the job's customer pays), and the job by its number —
    // never the payer's or the invoice's reference (browser QA OBS-4).
    expect(within(document).getByTestId('invoice-print-payer')).toHaveTextContent('Layla Haddad');
    expect(within(document).getByText('WO-000042')).toBeVisible();
    expect(document.textContent).not.toContain(INVOICE_ID);
    await user.click(screen.getByRole('button', { name: EN['invoices.print.print'] as string }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    /*
     * The copy prints alone (the residual #478 recorded): the screen opts into
     * the print scope, and the copy is reached through the one child of the
     * scope that holds it — every other panel is a sibling the print sheet
     * leaves off the paper.
     */
    const scope = document.closest('[data-print-scope]') as HTMLElement;
    expect(scope).not.toBeNull();
    const holders = [...scope.children].filter((child) => child.contains(document));
    expect(holders).toHaveLength(1);
    expect(scope.children.length).toBeGreaterThan(1);
  });

  it('prints the credit and payment positions the balance panel read (D7)', async () => {
    const user = userEvent.setup();
    readOutstanding.mockImplementation(async () =>
      okRead({
        ...outstanding,
        settlement: { ...outstanding.settlement, creditStatus: 'partly_credited' },
      })
    );
    renderScreen({ ...live() });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    await within(balance).findByTestId('invoice-credit-status');
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(within(document).getByTestId('invoice-print-credit-status')).toHaveTextContent(
      EN['invoices.creditStatus.partly_credited'] as string
    );
    expect(within(document).getByTestId('invoice-print-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.open'] as string
    );
  });

  it('DF-B1: prints each line discount and the discount total as issued, from the matched revision', async () => {
    const user = userEvent.setup();
    renderScreen({ ...live() });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    await within(document).findByText('Front brake service');
    // 2 × 100.00 less 50.00 → net 150.00: the discount is on the paper.
    expect(
      within(document).getByRole('columnheader', {
        name: EN['invoices.print.column.discount'] as string,
      })
    ).toBeTruthy();
    expect(within(document).getByTestId('invoice-print-line-discount')).toHaveTextContent(
      money('50.0000')
    );
    const issued = within(document).getByTestId('invoice-print-issued-totals');
    expect(within(issued).getByTestId('invoice-print-subtotal')).toHaveTextContent(
      money('200.0000')
    );
    expect(within(issued).getByTestId('invoice-print-discount-total')).toHaveTextContent(
      money('50.0000')
    );
    expect(within(issued).getByText(money('150.0000'))).toBeTruthy();
    expect(within(issued).getByText(money('165.0000'))).toBeTruthy();
  });

  it('DF-B1: a discount the matched revision cannot vouch for is said to be unavailable, never zero', async () => {
    const user = userEvent.setup();
    readInvoicePreview.mockImplementation(async () =>
      okRead({ ...structuredClone(preview), quotationRevisionId: 'other-revision' })
    );
    renderScreen({ ...live() });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    await within(document).findByText(EN['invoices.print.descriptionsUnavailable'] as string);
    expect(within(document).queryByTestId('invoice-print-line-discount')).toBeNull();
    expect(within(document).getByTestId('invoice-print-discount-total')).toHaveTextContent(
      EN['invoices.money.unavailable'] as string
    );
    expect(within(document).queryByText(money('50.0000'))).toBeNull();
  });

  it('DF-B1: prints paid, credited and balance due as of the read, apart from the issued totals', async () => {
    const user = userEvent.setup();
    readOutstanding.mockImplementation(async () =>
      okRead({
        ...outstanding,
        outstanding: { amount: '100.0000', currency: 'USD' },
        settlement: {
          ...outstanding.settlement,
          paymentStatus: 'partly_paid',
          paid: { amount: '65.0000', currency: 'USD' },
        },
      })
    );
    renderScreen({ ...live() });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    await within(balance).findByTestId('invoice-credit-status');
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    const settlement = within(document).getByTestId('invoice-print-settlement');
    expect(settlement.textContent).toContain(EN['invoices.print.settlementAsOf'] as string);
    expect(within(settlement).getByTestId('invoice-print-paid')).toHaveTextContent(
      money('65.0000')
    );
    expect(within(settlement).getByTestId('invoice-print-credited')).toHaveTextContent(
      money('0.0000')
    );
    expect(within(settlement).getByTestId('invoice-print-balance-due')).toHaveTextContent(
      money('100.0000')
    );
    expect(within(settlement).getByTestId('invoice-print-payment-status')).toHaveTextContent(
      EN['invoices.paymentStatus.partly_paid'] as string
    );
    // The fixture's branch is not one of the working context's, so its clock is
    // not known here: the moment is written on UTC and says so.
    expect(within(settlement).getByTestId('invoice-print-settlement-as-of')).toHaveTextContent(
      formatInZone('2026-10-01T07:30:00.000Z', 'en-GB', 'UTC')
    );
    expect(within(settlement).getByTestId('invoice-print-settlement-clock')).toHaveTextContent(
      'UTC'
    );
    expect(within(document).getByTestId('invoice-print-issued-totals').contains(settlement)).toBe(
      false
    );
  });

  it('DF-B1: the as-of moment is written on the invoice branch clock when the context knows it', async () => {
    const user = userEvent.setup();
    const inBranchInvoice = { companyId: TEST_BRANCH.companyId, branchId: TEST_BRANCH.id };
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice(inBranchInvoice) })
    );
    readInvoice.mockImplementation(async () => okRead(detail(inBranchInvoice)));
    renderScreen({
      initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice(inBranchInvoice) }),
    });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await waitFor(() => expect(readOutstanding).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    const settlement = await within(document).findByTestId('invoice-print-settlement');
    expect(within(settlement).getByTestId('invoice-print-settlement-as-of')).toHaveTextContent(
      formatInZone('2026-10-01T07:30:00.000Z', 'en-GB', TEST_BRANCH.timezone)
    );
    expect(within(settlement).getByTestId('invoice-print-settlement-clock')).toHaveTextContent(
      'GMT+3'
    );
  });

  it('DF-B1 in Arabic: discount, settlement and the as-of line read right to left', async () => {
    const user = userEvent.setup();
    renderRtl(
      <InvoiceScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        workOrderRefused={null}
        initialInvoice={live().initialInvoice as never}
        canViewFinance
        canIssue={false}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    await screen.findByRole('region', { name: AR['invoices.detail.heading'] as string });
    await waitFor(() => expect(readOutstanding).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: AR['invoices.print.open'] as string }));
    const paper = await screen.findByRole('article');
    await within(paper).findByText('Front brake service');
    expect(
      within(paper).getByRole('columnheader', {
        name: AR['invoices.print.column.discount'] as string,
      })
    ).toBeTruthy();
    const settlement = await within(paper).findByTestId('invoice-print-settlement');
    expect(settlement.textContent).toContain(AR['invoices.print.settlementAsOf'] as string);
    expect(settlement.textContent).toContain(AR['invoices.print.balanceDue'] as string);
    expect(within(settlement).getByTestId('invoice-print-payment-status')).toHaveTextContent(
      AR['invoices.paymentStatus.open'] as string
    );
    expect(within(settlement).getByTestId('invoice-print-settlement-as-of')).toHaveAttribute(
      'dir',
      'rtl'
    );
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
    // No balance was read, so no credit or payment position is printed or guessed —
    // and no settlement section at all (DF-B1: the finance view's own rule).
    expect(readOutstanding).not.toHaveBeenCalled();
    expect(within(document).queryByTestId('invoice-print-credit-status')).toBeNull();
    expect(within(document).queryByTestId('invoice-print-payment-status')).toBeNull();
    expect(within(document).queryByTestId('invoice-print-settlement')).toBeNull();
    expect(within(document).queryByTestId('invoice-print-balance-due')).toBeNull();
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

/**
 * DEF-T-07 — credit notes, reachable at last.
 *
 * A customer return raised a credit note, the screen said a second person had
 * to approve it, and nothing in the tenant navigation opened one: the approval
 * operation took an id no screen published. These cases are folded into this
 * suite because a credit note belongs to an invoice and to the same module.
 */
describe('credit notes are reachable', () => {
  const CREDIT_NOTE_ID = '33333333-3333-4333-8333-333333333333';

  const note = (over: Record<string, unknown> = {}) => ({
    id: CREDIT_NOTE_ID,
    invoiceId: INVOICE_ID,
    companyId: COMPANY_ID_FIXTURE,
    branchId: BRANCH_ID_FIXTURE,
    amount: { amount: '40.0000', currency: 'USD' },
    reason: 'A part was billed twice on the same job',
    approvalState: 'pending',
    requestedBy: 'u1',
    approvedBy: null,
    approvedAt: null,
    issuedAt: null,
    recordVersion: 1,
    // What the detail read traces the note to (DF-B4).
    ...trace(),
    ...over,
  });

  beforeEach(() => {
    listCreditNotes.mockResolvedValue({
      status: 'ok',
      data: { items: [note()], nextCursor: null, hasMore: false },
      correlationId: 'corr',
    });
    readCreditNote.mockResolvedValue({ status: 'ok', data: note(), correlationId: 'corr' });
    listBranches.mockResolvedValue({
      status: 'ok',
      data: {
        items: [
          {
            id: BRANCH_ID_FIXTURE,
            companyId: COMPANY_ID_FIXTURE,
            branchCode: 'AMM-1',
            name: 'Amman',
          },
        ],
      },
      correlationId: 'corr',
    });
  });

  const creditNotesScreen = (initial: string | null = null, currentUserId = SIGNED_IN) => (
    <CreditNotesScreen
      locale="en"
      messages={en}
      initialCreditNoteId={initial}
      currentUserId={currentUserId}
      canDecide
      canSearchInvoices
    />
  );

  it('lists the working branch notes with the server amount and the state in words', async () => {
    /*
     * This used to choose a branch from a select on the screen and press a
     * submit. Both are gone: the branch is stated, the list reads on arrival,
     * and what is asserted is that it is the branch the header holds.
     */
    renderLtr(creditNotesScreen());
    const section = await screen.findByRole('region', {
      name: EN['creditNotes.targetLabel'] as string,
    });
    expect(section).toHaveTextContent(TEST_BRANCH.name);
    expect(within(section).queryAllByRole('combobox')).toEqual([]);

    expect(await screen.findByText('A part was billed twice on the same job')).toBeTruthy();
    const grid = screen.getByRole('grid', { name: EN['creditNotes.list.caption'] as string });
    expect(within(grid).getByText(money('40.0000'))).toBeTruthy();
    expect(within(grid).getByText(EN['creditNotes.state.pending'] as string)).toBeTruthy();
    // And the read itself is addressed to that branch: both halves travel, and
    // they are the header's, not a pair the screen made up. It opens on the
    // notes waiting for approval, which is the work the screen is for, and it
    // walks the route's own pages with its cursor.
    expect(listCreditNotes).toHaveBeenCalledWith(
      { companyId: TEST_BRANCH.companyId, branchId: TEST_BRANCH.id },
      { approvalState: 'pending' },
      { cursor: null, limit: expect.any(Number) }
    );
  });

  it('reads every state when asked, and the chosen state again when it changes', async () => {
    const user = userEvent.setup();
    renderLtr(creditNotesScreen());
    await screen.findByText('A part was billed twice on the same job');
    const chips = screen.getByRole('group', { name: EN['creditNotes.list.status'] as string });
    // The state the list opens on is the pressed chip.
    expect(
      within(chips).getByRole('button', { name: EN['creditNotes.state.pending'] as string })
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(
      within(chips).getByRole('button', { name: EN['filters.chips.all'] as string })
    );
    await waitFor(() =>
      expect(listCreditNotes).toHaveBeenLastCalledWith(
        { companyId: TEST_BRANCH.companyId, branchId: TEST_BRANCH.id },
        {},
        expect.objectContaining({ cursor: null })
      )
    );
    await user.click(
      within(chips).getByRole('button', { name: EN['creditNotes.state.approved'] as string })
    );
    await waitFor(() =>
      expect(listCreditNotes).toHaveBeenLastCalledWith(
        { companyId: TEST_BRANCH.companyId, branchId: TEST_BRANCH.id },
        { approvalState: 'approved' },
        expect.objectContaining({ cursor: null })
      )
    );
  });

  it('opens a note named in the address even when no branch can be resolved', async () => {
    /*
     * The list read is what needs a branch; the detail does not, and that is
     * what makes the link from a return's result work at all. The case used to
     * establish it by never choosing a branch — which no longer withholds the
     * list, since the header holds one — so it establishes it where the
     * distinction still bites: an operator with no authorized branch at all.
     */
    renderInLtr(
      inBranch(creditNotesScreen(CREDIT_NOTE_ID), { snapshot: branchSnapshot([], 'none') })
    );
    await waitFor(() => expect(readCreditNote).toHaveBeenCalledWith(CREDIT_NOTE_ID));
    expect(await screen.findByText(EN['creditNotes.detail.notApproved'] as string)).toBeTruthy();
    expect(listCreditNotes).not.toHaveBeenCalled();
  });

  it('states who approved it and when, once it has been approved', async () => {
    readCreditNote.mockResolvedValue({
      status: 'ok',
      data: note({
        approvalState: 'approved',
        approvedBy: 'u2',
        approvedAt: '2026-09-02T10:00:00Z',
        issuedAt: '2026-09-02T10:00:00Z',
      }),
      correlationId: 'corr',
    });
    renderLtr(creditNotesScreen(CREDIT_NOTE_ID));
    const detail = await screen.findByRole('region', {
      name: EN['creditNotes.detail.heading'] as string,
    });
    expect(
      await within(detail).findByText(EN['creditNotes.state.approved'] as string)
    ).toBeTruthy();
    expect(within(detail).queryByText(EN['creditNotes.detail.notApproved'] as string)).toBeNull();
    // A decided note offers no approval to anyone.
    expect(
      within(detail).queryByRole('button', { name: EN['creditNotes.approve.action'] as string })
    ).toBeNull();
  });

  it('states that approving is a second person act', async () => {
    renderLtr(creditNotesScreen(CREDIT_NOTE_ID));
    expect(await screen.findByText(EN['creditNotes.detail.approvalNote'] as string)).toBeTruthy();
  });

  it('shows a refusal as a refusal rather than as a branch that credited nothing', async () => {
    listCreditNotes.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    renderLtr(creditNotesScreen());
    expect(await screen.findByText(EN['creditNotes.list.refused'] as string)).toBeTruthy();
    expect(screen.queryByText(EN['creditNotes.list.none'] as string)).toBeNull();
  });

  it('refuses the page and issues no read without BOTH declared permissions', async () => {
    for (const held of [[], ['sal.credit.manage'], ['sal.finance.view']]) {
      PERMISSIONS = held;
      renderLtr(
        (await CreditNotesPage({
          params: Promise.resolve({ locale: 'en' }),
          searchParams: Promise.resolve({}),
        })) as React.ReactElement
      );
      expect(listCreditNotes, held.join()).not.toHaveBeenCalled();
      expect(readCreditNote, held.join()).not.toHaveBeenCalled();
      expect(listBranches, held.join()).not.toHaveBeenCalled();
    }
  });

  it('opens the page for a caller holding both, and carries the named note through', async () => {
    PERMISSIONS = ['sal.credit.manage', 'sal.finance.view', 'org.branch.read'];
    renderLtr(
      (await CreditNotesPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ creditNoteId: CREDIT_NOTE_ID }),
      })) as React.ReactElement
    );
    await waitFor(() => expect(readCreditNote).toHaveBeenCalledWith(CREDIT_NOTE_ID));
  });

  it('opens the list for the first administrator of a newly provisioned organisation, on the set it is given', async () => {
    /*
     * QA result matrix part 7 row 5.9: the administrator of a provisioned
     * organisation met the refusal here, because the set it is given did not
     * carry the credit code. The set below is GENERATED from that bundle
     * (emit-account-manifest.mjs) rather than typed, so taking the code out of
     * the bundle takes it out of this case and the page refuses again.
     */
    PERMISSIONS = accountManifest['org-administrator'];
    renderLtr(
      (await CreditNotesPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      })) as React.ReactElement
    );
    expect(await screen.findByText('A part was billed twice on the same job')).toBeTruthy();
    expect(listCreditNotes).toHaveBeenCalled();
    expect(screen.queryByText(EN['creditNotes.list.refused'] as string)).toBeNull();
  });

  it('offers the decision on somebody else\u2019s note only to a holder of the credit-approval permission (D13)', async () => {
    const decide = () =>
      screen.queryByRole('button', { name: EN['creditNotes.approve.action'] as string });
    const turnDown = () =>
      screen.queryByRole('button', { name: EN['creditNotes.reject.action'] as string });

    // The request code and the finance view: the note is read, and no decision offered.
    PERMISSIONS = ['sal.credit.manage', 'sal.finance.view', 'org.branch.read'];
    const { unmount } = renderLtr(
      (await CreditNotesPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ creditNoteId: CREDIT_NOTE_ID }),
      })) as React.ReactElement
    );
    expect(await screen.findByTestId('credit-note-cannot-decide')).toHaveTextContent(
      EN['creditNotes.detail.cannotDecide'] as string
    );
    expect(decide()).toBeNull();
    expect(turnDown()).toBeNull();
    unmount();

    // With sal.credit.approve beside them, both decisions are offered.
    PERMISSIONS = [
      'sal.credit.manage',
      'sal.credit.approve',
      'sal.finance.view',
      'org.branch.read',
    ];
    renderLtr(
      (await CreditNotesPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ creditNoteId: CREDIT_NOTE_ID }),
      })) as React.ReactElement
    );
    expect(
      await screen.findByRole('button', { name: EN['creditNotes.approve.action'] as string })
    ).toBeVisible();
    expect(turnDown()).not.toBeNull();
    expect(screen.queryByTestId('credit-note-cannot-decide')).toBeNull();
    expect(screen.getByText(EN['creditNotes.approve.limitExplain'] as string)).toBeVisible();
  });

  describe('DF-B4 — what a note is traceable to', () => {
    const detailOf = (props: Record<string, unknown> = {}) => (
      <CreditNotesScreen
        locale="en"
        messages={en}
        initialCreditNoteId={CREDIT_NOTE_ID}
        currentUserId={SIGNED_IN}
        canDecide
        canSearchInvoices
        canOpenReturns
        {...props}
      />
    );
    const returned = {
      id: 'return-reference-1',
      itemCode: 'BRK-001',
      itemName: 'Brake pad',
      quantity: '1.000',
      receivedAt: '2026-09-19T07:55:00Z',
    };

    it('names the invoice, its customer, the return and the requester, each linked where allowed', async () => {
      readCreditNote.mockResolvedValue(okRead(note({ sourceReturn: returned })));
      renderLtr(detailOf());
      const trace = await screen.findByTestId('credit-note-trace');
      const invoiceLink = within(trace).getByRole('link', { name: 'INV-000123' });
      expect(invoiceLink).toHaveAttribute('href', `/en/invoices?workOrderId=${WORK_ORDER_ID}`);
      expect(within(trace).getByTestId('credit-note-customer')).toHaveTextContent('Layla Haddad');
      const source = within(trace).getByTestId('credit-note-source');
      expect(source).toHaveTextContent(EN['creditNotes.detail.sourceReturn'] as string);
      expect(source).toHaveTextContent('BRK-001');
      expect(source).toHaveTextContent('Brake pad');
      expect(source).toHaveTextContent('1.000');
      expect(
        within(source).getByRole('link', { name: EN['creditNotes.detail.openReturns'] as string })
      ).toHaveAttribute('href', '/en/inventory/customer-returns');
      expect(within(trace).getByTestId('credit-note-requested-by')).toHaveTextContent('Rana Saleh');
      expect(within(trace).getByTestId('credit-note-requested-at').textContent).not.toBe('');
      // Names, never references: no person, invoice, return or item id is shown.
      const shown = trace.textContent ?? '';
      for (const reference of ['u1', INVOICE_ID, WORK_ORDER_ID, 'return-reference-1']) {
        expect(shown).not.toContain(reference);
      }
      // Still pending: nobody has decided it, so nobody is named as deciding it.
      expect(within(trace).queryByTestId('credit-note-decided-by')).toBeNull();
    });

    it('a note raised by hand says so, and a counter sale links to the counter', async () => {
      readCreditNote.mockResolvedValue(
        okRead(
          note({
            invoice: {
              invoiceNumber: 'CS-0007',
              saleKind: 'counter_sale',
              workOrderId: null,
              payerName: 'Another garage',
            },
          })
        )
      );
      renderLtr(detailOf());
      const trace = await screen.findByTestId('credit-note-trace');
      expect(within(trace).getByRole('link', { name: 'CS-0007' })).toHaveAttribute(
        'href',
        `/en/inventory/counter-sales?invoiceId=${INVOICE_ID}`
      );
      expect(within(trace).getByTestId('credit-note-invoice')).toHaveTextContent(
        EN['creditNotes.detail.counterSale'] as string
      );
      expect(within(trace).getByTestId('credit-note-source')).toHaveTextContent(
        EN['creditNotes.detail.sourceByHand'] as string
      );
    });

    it('without the right to open them, names the invoice and the return without links', async () => {
      readCreditNote.mockResolvedValue(okRead(note({ sourceReturn: returned })));
      renderLtr(detailOf({ canSearchInvoices: false, canOpenReturns: false }));
      const trace = await screen.findByTestId('credit-note-trace');
      expect(within(trace).queryAllByRole('link')).toEqual([]);
      expect(within(trace).getByTestId('credit-note-invoice')).toHaveTextContent('INV-000123');
      expect(within(trace).getByTestId('credit-note-source')).toHaveTextContent('BRK-001');
    });

    it('a name the server withholds is said to be not shown, never replaced by a reference', async () => {
      readCreditNote.mockResolvedValue(
        okRead(
          note({
            requestedByName: null,
            invoice: {
              invoiceNumber: 'INV-000123',
              saleKind: 'work_order',
              workOrderId: WORK_ORDER_ID,
              payerName: null,
            },
          })
        )
      );
      renderLtr(detailOf());
      const trace = await screen.findByTestId('credit-note-trace');
      expect(within(trace).getByTestId('credit-note-requested-by')).toHaveTextContent(
        EN['creditNotes.detail.nameNotShown'] as string
      );
      expect(within(trace).getByTestId('credit-note-customer')).toHaveTextContent(
        EN['creditNotes.detail.customerNotShown'] as string
      );
      expect(trace.textContent).not.toContain('u1');
    });

    it('a decided note names who decided it', async () => {
      readCreditNote.mockResolvedValue(
        okRead(
          note({
            approvalState: 'rejected',
            decidedBy: 'u3',
            decidedByName: 'Omar Khalil',
            decidedAt: '2026-09-20T10:00:00Z',
            decisionReason: 'Not billed twice',
          })
        )
      );
      renderLtr(detailOf());
      const decided = await screen.findByTestId('credit-note-decided-by');
      expect(decided).toHaveTextContent('Omar Khalil');
      expect(decided.closest('div')).toHaveTextContent(
        EN['creditNotes.detail.rejectedBy'] as string
      );
      expect((await screen.findByTestId('credit-note-trace')).textContent).not.toContain('u3');
    });

    it('a withdrawn note names who withdrew it, under its own label', async () => {
      readCreditNote.mockResolvedValue(
        okRead(
          note({
            approvalState: 'withdrawn',
            decidedBy: 'u3',
            decidedByName: 'Omar Khalil',
            decidedAt: '2026-09-20T10:00:00Z',
          })
        )
      );
      renderLtr(detailOf());
      const decided = await screen.findByTestId('credit-note-decided-by');
      expect(decided).toHaveTextContent('Omar Khalil');
      const row = decided.closest('div');
      expect(row).toHaveTextContent(EN['creditNotes.detail.withdrawnBy'] as string);
      expect(row).not.toHaveTextContent(EN['creditNotes.detail.rejectedBy'] as string);
      expect(row).not.toHaveTextContent(EN['creditNotes.detail.approvedBy'] as string);
      expect((await screen.findByTestId('credit-note-trace')).textContent).not.toContain('u3');
    });

    it('an invoice the detail read does not trace is said in words, with no link or reference', async () => {
      readCreditNote.mockResolvedValue(okRead(note({ invoice: null })));
      renderLtr(detailOf());
      const trace = await screen.findByTestId('credit-note-trace');
      const shown = within(trace).getByTestId('credit-note-invoice');
      expect(shown).toHaveTextContent(EN['creditNotes.detail.invoiceUnavailable'] as string);
      expect(within(shown).queryAllByRole('link')).toEqual([]);
      expect(within(trace).queryByTestId('credit-note-customer')).toBeNull();
      expect(trace.textContent).not.toContain(INVOICE_ID);
    });

    it('in Arabic, the trace reads right to left with its own words', async () => {
      readCreditNote.mockResolvedValue(okRead(note({ sourceReturn: returned })));
      renderRtl(detailOf({ locale: 'ar', messages: ar }));
      expect(document.documentElement.dir).toBe('rtl');
      const trace = await screen.findByTestId('credit-note-trace');
      for (const key of [
        'creditNotes.detail.invoice',
        'creditNotes.detail.source',
        'creditNotes.detail.requestedBy',
        'creditNotes.detail.requestedAt',
        'creditNotes.detail.sourceReturn',
      ]) {
        expect(trace.textContent).toContain(AR[key] as string);
      }
      expect(within(trace).getByRole('link', { name: 'INV-000123' })).toHaveAttribute(
        'href',
        `/ar/invoices?workOrderId=${WORK_ORDER_ID}`
      );
    });

    it('the page links the return only for a reader the returns screen admits', async () => {
      readCreditNote.mockResolvedValue(okRead(note({ sourceReturn: returned })));
      const openReturns = () =>
        screen.queryByRole('link', { name: EN['creditNotes.detail.openReturns'] as string });
      PERMISSIONS = ['sal.credit.manage', 'sal.finance.view'];
      const { unmount } = renderLtr(
        (await CreditNotesPage({
          params: Promise.resolve({ locale: 'en' }),
          searchParams: Promise.resolve({ creditNoteId: CREDIT_NOTE_ID }),
        })) as React.ReactElement
      );
      await screen.findByTestId('credit-note-trace');
      expect(openReturns()).toBeNull();
      // Nor the invoice, without the invoice screens' own code.
      expect(screen.queryByRole('link', { name: 'INV-000123' })).toBeNull();
      unmount();
      PERMISSIONS = [
        'sal.credit.manage',
        'sal.finance.view',
        'inv.stock.read',
        'sal.invoice.manage',
      ];
      renderLtr(
        (await CreditNotesPage({
          params: Promise.resolve({ locale: 'en' }),
          searchParams: Promise.resolve({ creditNoteId: CREDIT_NOTE_ID }),
        })) as React.ReactElement
      );
      await screen.findByTestId('credit-note-trace');
      expect(openReturns()).not.toBeNull();
      expect(screen.getByRole('link', { name: 'INV-000123' })).toBeTruthy();
    });
  });

  it('ignores an address that names something that is not a reference', async () => {
    PERMISSIONS = ['sal.credit.manage', 'sal.finance.view', 'org.branch.read'];
    renderLtr(
      (await CreditNotesPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ creditNoteId: 'not-a-reference' }),
      })) as React.ReactElement
    );
    await screen.findByText(EN['creditNotes.explain'] as string);
    expect(readCreditNote).not.toHaveBeenCalled();
  });
});

/**
 * Owner requirement: credit notes usable through the application.
 *
 * Before this, a credit note could be raised only by a customer return and
 * approved only through the API. These cases hold the two acts the screens now
 * carry: raising one against an invoice (found in the working branch on the
 * credit-notes screen, or from the invoice itself), and approving one — by a
 * DIFFERENT person, the one who raised it being shown the note as waiting for
 * another approver and, if the server refuses anyway, told why in words.
 */
describe('raising and approving a credit note', () => {
  const NOTE_ID = '55555555-5555-4555-8555-555555555555';
  const RAISED_BY = 'u1';

  const pendingNote = (over: Record<string, unknown> = {}) => ({
    id: NOTE_ID,
    invoiceId: INVOICE_ID,
    companyId: TEST_BRANCH.companyId,
    branchId: TEST_BRANCH.id,
    amount: { amount: '15.5000', currency: 'USD' },
    reason: 'Wrong part fitted',
    approvalState: 'pending',
    requestedBy: RAISED_BY,
    approvedBy: null,
    approvedAt: null,
    issuedAt: null,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    recordVersion: 1,
    ...trace(),
    ...over,
  });
  const approvedNote = pendingNote({
    approvalState: 'approved',
    approvedBy: SIGNED_IN,
    approvedByName: 'Omar Khalil',
    approvedAt: '2026-09-20T10:00:00Z',
    issuedAt: '2026-09-20T10:00:00Z',
    recordVersion: 2,
  });

  const invoiceEntry = {
    ...invoice({
      companyId: TEST_BRANCH.companyId,
      branchId: TEST_BRANCH.id,
      status: 'issued',
      invoiceNumber: 'INV-000123',
      issuedAt: '2026-09-04T09:00:00Z',
    }),
    saleKind: 'work_order',
    payer: { displayName: 'Layla Haddad', displayNumber: 'C-000482', partyType: 'individual' },
    outstanding: { amount: '100.0000', currency: 'USD' },
  };

  const raised = (replayed = false) => ({
    state: { status: 'success', messageKey: 'creditNotes.request.success', attempt: 1 },
    created: { creditNote: pendingNote(), replayed },
  });

  beforeEach(() => {
    listCreditNotes.mockResolvedValue({
      status: 'ok',
      data: { items: [pendingNote()], nextCursor: null, hasMore: false },
      correlationId: 'corr',
    });
    readCreditNote.mockResolvedValue({ status: 'ok', data: pendingNote(), correlationId: 'corr' });
    listInvoices.mockResolvedValue(
      okRead({ items: [invoiceEntry], nextCursor: null, hasMore: false })
    );
    requestCreditNote.mockResolvedValue(raised());
    approveCreditNote.mockResolvedValue({
      state: { status: 'success', messageKey: 'creditNotes.approve.success', attempt: 1 },
      created: { creditNote: approvedNote, replayed: false },
    });
  });

  const notesScreen = (
    currentUserId: string,
    initial: string | null = null,
    canSearchInvoices = true,
    canDecide = true
  ) => (
    <CreditNotesScreen
      locale="en"
      messages={en}
      initialCreditNoteId={initial}
      currentUserId={currentUserId}
      canDecide={canDecide}
      canSearchInvoices={canSearchInvoices}
    />
  );

  const requestForm = () =>
    screen.findByRole('form', { name: EN['creditNotes.request.heading'] as string });
  const invoiceSearch = (form: HTMLElement) =>
    within(form).getByLabelText(labelled('creditNotes.request.invoice'));
  const amountBox = (form: HTMLElement) =>
    within(form).getByLabelText(labelled('creditNotes.request.amount')) as HTMLInputElement;
  const reasonBox = (form: HTMLElement) =>
    within(form).getByLabelText(labelled('creditNotes.request.reason')) as HTMLTextAreaElement;
  const submitIn = (form: HTMLElement) =>
    within(form).getByRole('button', { name: EN['creditNotes.request.submit'] as string });

  async function chooseInvoice(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
    await user.type(invoiceSearch(form), 'INV-0001');
    await user.click(await findSearchedOption(listInvoices, 'INV-0001', /INV-000123/));
  }

  it('raises a note against an invoice FOUND in the working branch, and opens it as pending', async () => {
    const user = userEvent.setup();
    renderLtr(notesScreen(SIGNED_IN));
    const form = await requestForm();
    await chooseInvoice(user, form);
    // Found in the header's branch, among the invoices that can still be credited.
    expect(listInvoices.mock.calls.at(-1)?.[0]).toEqual({
      companyId: TEST_BRANCH.companyId,
      branchId: TEST_BRANCH.id,
    });
    expect(listInvoices.mock.calls.at(-1)?.[1]).toEqual({
      q: 'INV-0001',
      status: undefined,
      allocatable: true,
    });
    // The open balance the server published stands beside the amount.
    expect(within(form).getByText(money('100.0000'))).toBeVisible();
    await user.type(amountBox(form), '15.50');
    await user.type(reasonBox(form), 'Wrong part fitted');
    await user.click(submitIn(form));

    await waitFor(() => expect(requestCreditNote).toHaveBeenCalledTimes(1));
    expect(requestCreditNote.mock.calls[0]?.[0]).toBe(INVOICE_ID);
    // The amount is a string throughout, written back canonically as it leaves the box.
    expect(requestCreditNote.mock.calls[0]?.[1]).toEqual({
      amount: '15.5000',
      reason: 'Wrong part fitted',
    });
    expect(requestCreditNote.mock.calls[0]?.[2]).toMatch(UUID_SHAPE);
    expect(
      await screen.findByText(EN['creditNotes.request.recorded'] as string)
    ).toBeInTheDocument();
    // The new note opens, and it is the caller's own — so it is not offered to them.
    await waitFor(() => expect(readCreditNote).toHaveBeenCalledWith(NOTE_ID));
    expect(amountBox(form).value).toBe('');
  });

  it('marks every missing field, moves the cursor to the first, keeps what was typed, and stops complaining once corrected', async () => {
    const user = userEvent.setup();
    renderLtr(notesScreen(SIGNED_IN));
    const form = await requestForm();
    await user.type(reasonBox(form), 'Kept as typed');
    await user.click(submitIn(form));

    expect(requestCreditNote).not.toHaveBeenCalled();
    await waitFor(() => expect(invoiceSearch(form)).toHaveAttribute('aria-invalid', 'true'));
    expect(amountBox(form)).toHaveAttribute('aria-invalid', 'true');
    expect(amountBox(form)).toHaveAccessibleDescription(
      expect.stringContaining(EN['field.required'] as string)
    );
    await waitFor(() => expect(invoiceSearch(form)).toHaveFocus());
    expect(reasonBox(form).value).toBe('Kept as typed');
    expect(reasonBox(form)).not.toHaveAttribute('aria-invalid');

    // A correction clears the complaint about that field alone.
    await user.type(amountBox(form), '0');
    expect(amountBox(form)).not.toHaveAttribute('aria-invalid');
    expect(invoiceSearch(form)).toHaveAttribute('aria-invalid', 'true');

    // Zero is not an amount to credit, and the form says what is.
    await chooseInvoice(user, form);
    await user.click(submitIn(form));
    expect(requestCreditNote).not.toHaveBeenCalled();
    await waitFor(() => expect(amountBox(form)).toHaveAttribute('aria-invalid', 'true'));
    expect(
      within(form).getByText(EN['creditNotes.request.amountFormat'] as string)
    ).toBeInTheDocument();
    await waitFor(() => expect(amountBox(form)).toHaveFocus());

    await user.clear(amountBox(form));
    await user.type(amountBox(form), '12.5');
    await user.click(submitIn(form));
    await waitFor(() =>
      expect(requestCreditNote.mock.calls[0]?.[1]).toEqual({
        amount: '12.5000',
        reason: 'Kept as typed',
      })
    );
  });

  it('files the server’s refusal of the amount beside it, keeps the form, and retries with the SAME key', async () => {
    const user = userEvent.setup();
    requestCreditNote.mockResolvedValueOnce({
      state: {
        status: 'conflict',
        messageKey: 'form.formError',
        fieldErrors: { amount: 'creditNotes.request.overOpen' },
        correlationId: 'ref-409',
        attempt: 1,
      },
      created: null,
    });
    renderLtr(notesScreen(SIGNED_IN));
    const form = await requestForm();
    await chooseInvoice(user, form);
    // Within the open receivable the form knows of, so it is SENT — and the server,
    // which also counts what is already credited, refuses it.
    await user.type(amountBox(form), '90');
    await user.type(reasonBox(form), 'Too much');
    await user.click(submitIn(form));

    expect(
      await within(form).findByText(EN['creditNotes.request.overOpen'] as string)
    ).toBeInTheDocument();
    expect(amountBox(form)).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(amountBox(form)).toHaveFocus());
    // What the operator typed stays in the box after the refusal (DF-6), while the
    // request carried the canonical amount.
    expect(amountBox(form).value).toBe('90');
    expect(requestCreditNote.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ amount: '90.0000' })
    );
    expect(reasonBox(form).value).toBe('Too much');
    expect(within(form).getByText('ref-409')).toBeInTheDocument();

    await user.clear(amountBox(form));
    expect(amountBox(form)).not.toHaveAttribute('aria-invalid');
    await user.type(amountBox(form), '60');
    await user.click(submitIn(form));
    await waitFor(() => expect(requestCreditNote).toHaveBeenCalledTimes(2));
    expect(requestCreditNote.mock.calls[1]?.[2]).toBe(requestCreditNote.mock.calls[0]?.[2]);
  });

  it('refuses an amount above the open receivable before sending, and says pending notes may lower what can be approved', async () => {
    const user = userEvent.setup();
    renderLtr(notesScreen(SIGNED_IN));
    const form = await requestForm();
    await chooseInvoice(user, form);
    // The open receivable the server stated, and the sentence beside it: the form
    // does not subtract pending notes, it says they may reduce what can be approved.
    expect(within(form).getByText(money('100.0000'))).toBeVisible();
    expect(
      within(form).getByText(EN['creditNotes.request.pendingMayReduce'] as string)
    ).toBeVisible();

    // One ten-thousandth above the open amount, compared digit by digit.
    await user.type(amountBox(form), '100.0001');
    await user.type(reasonBox(form), 'Too much');
    await user.click(submitIn(form));
    expect(requestCreditNote).not.toHaveBeenCalled();
    await waitFor(() => expect(amountBox(form)).toHaveAttribute('aria-invalid', 'true'));
    expect(
      within(form).getByText(EN['creditNotes.request.aboveOpen'] as string)
    ).toBeInTheDocument();
    await waitFor(() => expect(amountBox(form)).toHaveFocus());

    // Exactly the open amount is allowed through; the server remains the authority.
    await user.clear(amountBox(form));
    await user.type(amountBox(form), '100');
    await user.click(submitIn(form));
    await waitFor(() => expect(requestCreditNote).toHaveBeenCalledTimes(1));
    expect(requestCreditNote.mock.calls[0]?.[1]).toEqual({
      amount: '100.0000',
      reason: 'Too much',
    });
  });

  it('a half-written credit is unsaved work: a branch switch asks first', async () => {
    const user = userEvent.setup();
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          {notesScreen(SIGNED_IN)}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    const form = await requestForm();
    try {
      await user.type(amountBox(form), '10');
      await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
      expect(heldBranch()).toBe(TEST_BRANCH.id);
      expect(amountBox(form).value).toMatch(/^10(\.0000)?$/);
    } finally {
      forgetRememberedBranch();
    }
  });

  it('shows a note the caller raised as waiting for another approver, and offers them no approval', async () => {
    renderLtr(notesScreen(RAISED_BY, NOTE_ID));
    const grid = await screen.findByRole('grid');
    expect(
      await within(grid).findByText(EN['creditNotes.ownRequest'] as string)
    ).toBeInTheDocument();
    expect(within(grid).getByText(EN['creditNotes.byYou'] as string)).toBeInTheDocument();
    const detail = await screen.findByRole('region', {
      name: EN['creditNotes.detail.heading'] as string,
    });
    expect(
      await within(detail).findByText(EN['creditNotes.detail.ownRequest'] as string)
    ).toBeVisible();
    expect(
      within(detail).queryByRole('button', { name: EN['creditNotes.approve.action'] as string })
    ).toBeNull();
    expect(approveCreditNote).not.toHaveBeenCalled();
  });

  it('a different person approves it: the approval is sent, the note reads approved, and the list reads again', async () => {
    const user = userEvent.setup();
    renderLtr(notesScreen(SIGNED_IN, NOTE_ID));
    const detail = await screen.findByRole('region', {
      name: EN['creditNotes.detail.heading'] as string,
    });
    const grid = await screen.findByRole('grid');
    // Nothing on the list says it is the caller's own.
    await within(grid).findByText('Wrong part fitted');
    expect(within(grid).queryByText(EN['creditNotes.ownRequest'] as string)).toBeNull();
    const reads = listCreditNotes.mock.calls.length;
    await user.click(
      await within(detail).findByRole('button', {
        name: EN['creditNotes.approve.action'] as string,
      })
    );
    // Approving asks first, naming the amount and the reason.
    const dialog = await screen.findByRole('alertdialog', {
      name: EN['creditNotes.approve.confirmTitle'] as string,
    });
    expect(dialog).toHaveTextContent('Wrong part fitted');
    expect(approveCreditNote).not.toHaveBeenCalled();
    // What the note reads as once it is read again.
    readCreditNote.mockResolvedValue({ status: 'ok', data: approvedNote, correlationId: 'corr' });
    await user.click(
      within(dialog).getByRole('button', { name: EN['creditNotes.approve.action'] as string })
    );
    await waitFor(() => expect(approveCreditNote).toHaveBeenCalledWith(NOTE_ID));
    expect(await screen.findByText(EN['creditNotes.approve.done'] as string)).toBeInTheDocument();
    expect(
      await within(detail).findByText(EN['creditNotes.state.approved'] as string)
    ).toBeVisible();
    expect(
      within(detail).queryByRole('button', { name: EN['creditNotes.approve.action'] as string })
    ).toBeNull();
    await waitFor(() => expect(listCreditNotes.mock.calls.length).toBeGreaterThan(reads));
  });

  const selfRefusal = {
    state: {
      status: 'conflict',
      messageKey: 'form.violation.credit_note_self_approval',
      correlationId: 'ref-409',
      attempt: 1,
    },
    created: null,
  };

  it('says the server’s self-approval refusal in words, and reads the note again', async () => {
    const user = userEvent.setup();
    approveCreditNote.mockResolvedValueOnce(selfRefusal);
    renderLtr(notesScreen(SIGNED_IN, NOTE_ID));
    const detail = await screen.findByRole('region', {
      name: EN['creditNotes.detail.heading'] as string,
    });
    await user.click(
      await within(detail).findByRole('button', {
        name: EN['creditNotes.approve.action'] as string,
      })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: EN['creditNotes.approve.action'] as string })
    );
    const alert = await within(detail).findByRole('alert');
    expect(alert).toHaveTextContent(EN['form.violation.credit_note_self_approval'] as string);
    expect(alert).toHaveTextContent('ref-409');
    await waitFor(() => expect(readCreditNote).toHaveBeenCalledTimes(2));
  });

  it('says the same refusal in Arabic', async () => {
    const user = userEvent.setup();
    approveCreditNote.mockResolvedValueOnce(selfRefusal);
    renderRtl(
      <CreditNotesScreen
        locale="ar"
        messages={ar}
        initialCreditNoteId={NOTE_ID}
        currentUserId={SIGNED_IN}
        canDecide
      />
    );
    const detail = await screen.findByRole('region', {
      name: AR['creditNotes.detail.heading'] as string,
    });
    await user.click(
      await within(detail).findByRole('button', {
        name: AR['creditNotes.approve.action'] as string,
      })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: AR['creditNotes.approve.action'] as string })
    );
    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      AR['form.violation.credit_note_self_approval'] as string
    );
  });

  it('the named rule the server sends becomes that sentence, in both catalogues', async () => {
    const { fromFailure } = await import('@/lib/forms/action-result');
    const state = fromFailure(
      {
        ok: false,
        kind: 'conflict',
        status: 409,
        correlationId: 'ref-409',
        problem: {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'ERR-TRN-001',
          correlationId: 'ref-409',
          violations: [{ path: 'path.creditNoteId', rule: 'credit_note_self_approval' }],
        },
      } as never,
      1
    );
    expect(state.messageKey).toBe('form.violation.credit_note_self_approval');
    expect(EN['form.violation.credit_note_self_approval']).toBeTruthy();
    expect(AR['form.violation.credit_note_self_approval']).toBeTruthy();
  });

  it('offers somebody else\u2019s note neither approval nor rejection without the credit-approval permission, and says why', async () => {
    renderLtr(notesScreen(SIGNED_IN, NOTE_ID, true, false));
    const detail = await screen.findByRole('region', {
      name: EN['creditNotes.detail.heading'] as string,
    });
    expect(await within(detail).findByTestId('credit-note-cannot-decide')).toHaveTextContent(
      EN['creditNotes.detail.cannotDecide'] as string
    );
    for (const key of ['creditNotes.approve.action', 'creditNotes.reject.action']) {
      expect(within(detail).queryByRole('button', { name: EN[key] as string })).toBeNull();
    }
    expect(approveCreditNote).not.toHaveBeenCalled();
    expect(rejectCreditNote).not.toHaveBeenCalled();
  });

  const limitRefusal = {
    state: {
      status: 'denied',
      messageKey: 'form.violation.credit_limit_exceeded',
      correlationId: 'ref-403',
      attempt: 1,
    },
    created: null,
  };

  it('says a credit-limit refusal in words, with its reference, and the note stays pending', async () => {
    const user = userEvent.setup();
    approveCreditNote.mockResolvedValueOnce(limitRefusal);
    renderLtr(notesScreen(SIGNED_IN, NOTE_ID));
    const detail = await screen.findByRole('region', {
      name: EN['creditNotes.detail.heading'] as string,
    });
    await user.click(
      await within(detail).findByRole('button', {
        name: EN['creditNotes.approve.action'] as string,
      })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: EN['creditNotes.approve.action'] as string })
    );
    const alert = await within(detail).findByRole('alert');
    expect(alert).toHaveTextContent(EN['form.violation.credit_limit_exceeded'] as string);
    expect(alert).toHaveTextContent('ref-403');
    expect(within(detail).getByText(EN['creditNotes.state.pending'] as string)).toBeVisible();
    // A D13 refusal changed nothing on the server, so the note is not read again:
    // the one read is the screen opening the note.
    expect(readCreditNote).toHaveBeenCalledTimes(1);
  });

  it('says the same credit-limit refusal in Arabic, right to left', async () => {
    const user = userEvent.setup();
    approveCreditNote.mockResolvedValueOnce(limitRefusal);
    renderRtl(
      <CreditNotesScreen
        locale="ar"
        messages={ar}
        initialCreditNoteId={NOTE_ID}
        currentUserId={SIGNED_IN}
        canDecide
      />
    );
    const detail = await screen.findByRole('region', {
      name: AR['creditNotes.detail.heading'] as string,
    });
    await user.click(
      await within(detail).findByRole('button', {
        name: AR['creditNotes.approve.action'] as string,
      })
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.closest('[dir="rtl"]')).not.toBeNull();
    await user.click(
      within(dialog).getByRole('button', { name: AR['creditNotes.approve.action'] as string })
    );
    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      AR['form.violation.credit_limit_exceeded'] as string
    );
  });

  it('each credit-approval rule the server names becomes its own sentence, in both catalogues', async () => {
    const { fromFailure } = await import('@/lib/forms/action-result');
    const rules = [
      'credit_approval_permission_missing',
      'credit_no_approval_limit',
      'credit_limit_self_created',
      'credit_limit_currency_mismatch',
      'credit_limit_exceeded',
    ];
    const sentences = new Set<string>();
    for (const rule of rules) {
      const state = fromFailure(
        {
          ok: false,
          kind: 'forbidden',
          status: 403,
          correlationId: 'ref-403',
          problem: {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            code: 'ERR-IAM-001',
            correlationId: 'ref-403',
            violations: [{ path: 'path.creditNoteId', rule }],
          },
        } as never,
        1
      );
      expect(state.messageKey).toBe(`form.violation.${rule}`);
      const english = EN[`form.violation.${rule}`] as string;
      const arabic = AR[`form.violation.${rule}`] as string;
      expect(english).toBeTruthy();
      expect(arabic).toBeTruthy();
      // Plain words: no rule token, no field name, no code leaks into the sentence.
      for (const sentence of [english, arabic]) {
        expect(sentence).not.toMatch(/credit_|sal\.|ERR-/);
      }
      sentences.add(english);
    }
    expect(sentences.size).toBe(rules.length);
  });

  /**
   * ADR-023 D3. The requester may withdraw their own pending request; somebody
   * else may reject it, stating why. Each decision is offered only to the person
   * the server lets take it, sends the note's version exactly as the detail read
   * published it, and is final.
   */
  describe('withdrawing and rejecting a pending credit note', () => {
    const detailRegion = (name = EN['creditNotes.detail.heading'] as string) =>
      screen.findByRole('region', { name });
    const withdrawnNote = pendingNote({
      approvalState: 'withdrawn',
      decidedBy: RAISED_BY,
      decidedAt: '2026-09-30T08:00:00Z',
      recordVersion: 2,
    });
    const rejectedNote = pendingNote({
      approvalState: 'rejected',
      decidedBy: SIGNED_IN,
      decidedAt: '2026-09-30T09:00:00Z',
      decisionReason: 'Raised twice for one return',
      recordVersion: 2,
    });

    beforeEach(() => {
      withdrawCreditNote.mockResolvedValue({
        state: { status: 'success', messageKey: 'creditNotes.withdraw.success', attempt: 1 },
        created: { creditNote: withdrawnNote, replayed: false },
      });
      rejectCreditNote.mockResolvedValue({
        state: { status: 'success', messageKey: 'creditNotes.reject.success', attempt: 1 },
        created: { creditNote: rejectedNote, replayed: false },
      });
    });

    it('offers the requester a withdrawal and nothing else, and withdraws under the version read', async () => {
      const user = userEvent.setup();
      readCreditNote.mockResolvedValue({
        status: 'ok',
        data: pendingNote({ recordVersion: 3 }),
        correlationId: 'corr',
      });
      renderLtr(notesScreen(RAISED_BY, NOTE_ID));
      const detail = await detailRegion();
      const withdraw = await within(detail).findByRole('button', {
        name: EN['creditNotes.withdraw.action'] as string,
      });
      expect(
        within(detail).queryByRole('button', { name: EN['creditNotes.approve.action'] as string })
      ).toBeNull();
      expect(
        within(detail).queryByRole('button', { name: EN['creditNotes.reject.action'] as string })
      ).toBeNull();

      await user.click(withdraw);
      const dialog = await screen.findByRole('alertdialog', {
        name: EN['creditNotes.withdraw.confirmTitle'] as string,
      });
      expect(dialog).toHaveTextContent('Wrong part fitted');
      expect(withdrawCreditNote).not.toHaveBeenCalled();
      readCreditNote.mockResolvedValue({
        status: 'ok',
        data: withdrawnNote,
        correlationId: 'corr',
      });
      await user.click(
        within(dialog).getByRole('button', { name: EN['creditNotes.withdraw.action'] as string })
      );
      // The version is the one the detail read published — never computed.
      await waitFor(() => expect(withdrawCreditNote).toHaveBeenCalledWith(NOTE_ID, 3));
      expect(
        await screen.findByText(EN['creditNotes.withdraw.done'] as string)
      ).toBeInTheDocument();
      expect(
        await within(detail).findByText(EN['creditNotes.state.withdrawn'] as string)
      ).toBeVisible();
      expect(
        within(detail).getByText(EN['creditNotes.detail.withdrawnAt'] as string)
      ).toBeVisible();
      expect(
        within(detail).getByText(new RegExp(escape(EN['creditNotes.detail.final'] as string)))
      ).toBeVisible();
      expect(
        within(detail).queryByRole('button', { name: EN['creditNotes.withdraw.action'] as string })
      ).toBeNull();
    });

    it('offers somebody else approval and rejection, and no withdrawal', async () => {
      renderLtr(notesScreen(SIGNED_IN, NOTE_ID));
      const detail = await detailRegion();
      expect(
        await within(detail).findByRole('button', {
          name: EN['creditNotes.reject.action'] as string,
        })
      ).toBeVisible();
      expect(
        within(detail).getByRole('button', { name: EN['creditNotes.approve.action'] as string })
      ).toBeVisible();
      expect(
        within(detail).queryByRole('button', { name: EN['creditNotes.withdraw.action'] as string })
      ).toBeNull();
    });

    it('refuses a blank reason on the reason box itself, keeps what was typed, and rejects once there is one', async () => {
      const user = userEvent.setup();
      renderLtr(notesScreen(SIGNED_IN, NOTE_ID));
      const detail = await detailRegion();
      await user.click(
        await within(detail).findByRole('button', {
          name: EN['creditNotes.reject.action'] as string,
        })
      );
      const dialog = await screen.findByRole('alertdialog', {
        name: EN['creditNotes.reject.confirmTitle'] as string,
      });
      const reason = within(dialog).getByLabelText(labelled('creditNotes.reject.reason'));
      const confirm = within(dialog).getByRole('button', {
        name: EN['creditNotes.reject.action'] as string,
      });
      expect(confirm).toBeDisabled();
      await user.type(reason, '   ');
      await user.tab();
      await waitFor(() => expect(reason).toHaveAttribute('aria-invalid', 'true'));
      expect(reason).toHaveAccessibleDescription(
        expect.stringContaining(EN['overlay.reasonRequired'] as string)
      );
      expect(rejectCreditNote).not.toHaveBeenCalled();

      await user.type(reason, 'Raised twice for one return');
      expect(reason).not.toHaveAttribute('aria-invalid', 'true');
      readCreditNote.mockResolvedValue({ status: 'ok', data: rejectedNote, correlationId: 'corr' });
      await user.click(confirm);
      await waitFor(() =>
        expect(rejectCreditNote).toHaveBeenCalledWith(
          NOTE_ID,
          { reason: 'Raised twice for one return' },
          1
        )
      );
      expect(await screen.findByText(EN['creditNotes.reject.done'] as string)).toBeInTheDocument();
      expect(await within(detail).findByText('Raised twice for one return')).toBeVisible();
      expect(within(detail).getByText(EN['creditNotes.detail.rejectedAt'] as string)).toBeVisible();
    });

    it('keeps the server’s refusal of the reason on the box, with the typed text', async () => {
      const user = userEvent.setup();
      rejectCreditNote.mockResolvedValueOnce({
        state: {
          status: 'invalid',
          messageKey: 'form.formError',
          fieldErrors: { reason: 'form.violation.too_small' },
          correlationId: 'ref-422',
          attempt: 1,
        },
        created: null,
      });
      renderLtr(notesScreen(SIGNED_IN, NOTE_ID));
      const detail = await detailRegion();
      await user.click(
        await within(detail).findByRole('button', {
          name: EN['creditNotes.reject.action'] as string,
        })
      );
      const dialog = await screen.findByRole('alertdialog');
      const reason = within(dialog).getByLabelText(labelled('creditNotes.reject.reason'));
      await user.type(reason, 'x');
      await user.click(
        within(dialog).getByRole('button', { name: EN['creditNotes.reject.action'] as string })
      );
      await waitFor(() => expect(reason).toHaveAttribute('aria-invalid', 'true'));
      expect(reason).toHaveAccessibleDescription(
        expect.stringContaining(EN['form.violation.too_small'] as string)
      );
      expect((reason as HTMLTextAreaElement).value).toBe('x');

      // DF-4 residual: the refusal is about THAT text, so editing it withdraws it.
      await user.type(reason, 'y');
      expect(reason).not.toHaveAttribute('aria-invalid', 'true');
      expect(reason).not.toHaveAccessibleDescription(
        expect.stringContaining(EN['form.violation.too_small'] as string)
      );
      // Typing the refused text back shows the refusal again.
      await user.type(reason, '{Backspace}');
      expect(reason).toHaveAttribute('aria-invalid', 'true');
    });

    it('says a conflict in words, offers the latest version, and reads the list again (DF-4)', async () => {
      const user = userEvent.setup();
      withdrawCreditNote.mockResolvedValueOnce({
        state: {
          status: 'conflict',
          messageKey: 'creditNotes.decision.conflict',
          correlationId: 'ref-409',
          attempt: 1,
        },
        created: null,
      });
      renderLtr(notesScreen(RAISED_BY, NOTE_ID));
      const detail = await detailRegion();
      const grid = await screen.findByRole('grid', {
        name: EN['creditNotes.list.caption'] as string,
      });
      await within(grid).findByText(EN['creditNotes.state.pending'] as string);
      const listReads = listCreditNotes.mock.calls.length;
      // The other tab withdrew it: the list now answers with the note withdrawn.
      listCreditNotes.mockResolvedValue({
        status: 'ok',
        data: { items: [withdrawnNote], nextCursor: null, hasMore: false },
        correlationId: 'corr',
      });
      const withdraw = await within(detail).findByRole('button', {
        name: EN['creditNotes.withdraw.action'] as string,
      });
      await user.click(withdraw);
      const dialog = await screen.findByRole('alertdialog');
      await user.click(
        within(dialog).getByRole('button', { name: EN['creditNotes.withdraw.action'] as string })
      );
      const alert = await within(detail).findByRole('alert');
      expect(alert).toHaveTextContent(EN['creditNotes.decision.conflict'] as string);
      expect(alert).toHaveTextContent('ref-409');

      // The list row follows at once: no longer "Waiting for a second person".
      await waitFor(() => expect(listCreditNotes.mock.calls.length).toBeGreaterThan(listReads));
      expect(
        await within(grid).findByText(EN['creditNotes.state.withdrawn'] as string)
      ).toBeVisible();
      expect(within(grid).queryByText(EN['creditNotes.state.pending'] as string)).toBeNull();

      // The shared conflict's way out; the stale decisions wait for it.
      const latest = within(detail).getByRole('button', { name: EN['form.loadLatest'] as string });
      expect(withdraw).toBeDisabled();
      expect(readCreditNote).toHaveBeenCalledTimes(1);
      readCreditNote.mockResolvedValue({
        status: 'ok',
        data: withdrawnNote,
        correlationId: 'corr',
      });
      await user.click(latest);
      await waitFor(() => expect(readCreditNote).toHaveBeenCalledTimes(2));
      expect(
        await within(detail).findByText(EN['creditNotes.state.withdrawn'] as string)
      ).toBeVisible();
      expect(
        within(detail).queryByRole('button', { name: EN['form.loadLatest'] as string })
      ).toBeNull();
      expect(within(detail).queryByRole('alert')).toBeNull();
      expect(withdrawCreditNote).toHaveBeenCalledTimes(1);
    });

    it('offers the latest version in Arabic after a conflict (DF-4)', async () => {
      const user = userEvent.setup();
      approveCreditNote.mockResolvedValueOnce({
        state: {
          status: 'conflict',
          messageKey: 'creditNotes.approve.conflict',
          correlationId: 'ref-409',
          attempt: 1,
        },
        created: null,
      });
      renderRtl(
        <CreditNotesScreen
          locale="ar"
          messages={ar}
          initialCreditNoteId={NOTE_ID}
          currentUserId={SIGNED_IN}
          canDecide
        />
      );
      const detail = await detailRegion(AR['creditNotes.detail.heading'] as string);
      await user.click(
        await within(detail).findByRole('button', {
          name: AR['creditNotes.approve.action'] as string,
        })
      );
      const dialog = await screen.findByRole('alertdialog');
      await user.click(
        within(dialog).getByRole('button', { name: AR['creditNotes.approve.action'] as string })
      );
      expect(await within(detail).findByRole('alert')).toHaveTextContent(
        AR['creditNotes.approve.conflict'] as string
      );
      expect(
        within(detail).getByRole('button', { name: AR['form.loadLatest'] as string })
      ).toBeVisible();
    });

    it('shows a rejected note’s reason and offers nothing on it', async () => {
      readCreditNote.mockResolvedValue({ status: 'ok', data: rejectedNote, correlationId: 'corr' });
      renderLtr(notesScreen(RAISED_BY, NOTE_ID));
      const detail = await detailRegion();
      expect(await within(detail).findByText('Raised twice for one return')).toBeVisible();
      expect(within(detail).getByText(EN['creditNotes.state.rejected'] as string)).toBeVisible();
      for (const key of [
        'creditNotes.withdraw.action',
        'creditNotes.approve.action',
        'creditNotes.reject.action',
      ]) {
        expect(within(detail).queryByRole('button', { name: EN[key] as string }), key).toBeNull();
      }
      // A declined note never reads as "not approved yet".
      expect(within(detail).queryByText(EN['creditNotes.detail.notApproved'] as string)).toBeNull();
    });

    it('offers the withdrawal and its question in Arabic, right to left', async () => {
      const user = userEvent.setup();
      renderRtl(
        <CreditNotesScreen
          locale="ar"
          messages={ar}
          initialCreditNoteId={NOTE_ID}
          currentUserId={RAISED_BY}
          canDecide
        />
      );
      const detail = await detailRegion(AR['creditNotes.detail.heading'] as string);
      await user.click(
        await within(detail).findByRole('button', {
          name: AR['creditNotes.withdraw.action'] as string,
        })
      );
      const dialog = await screen.findByRole('alertdialog', {
        name: AR['creditNotes.withdraw.confirmTitle'] as string,
      });
      expect(dialog.closest('[dir="rtl"]')).not.toBeNull();
    });

    it('lists withdrawn among the states the list can show', async () => {
      renderLtr(notesScreen(SIGNED_IN));
      const toolbar = await screen.findByTestId('credit-notes-toolbar');
      expect(
        within(toolbar).getByRole('button', { name: EN['creditNotes.state.withdrawn'] as string })
      ).toBeInTheDocument();
      expect(
        within(toolbar).getByRole('button', { name: EN['creditNotes.state.rejected'] as string })
      ).toBeInTheDocument();
    });
  });

  describe('from the invoice itself', () => {
    const issued = () => invoice({ status: 'issued', invoiceNumber: 'INV-000123' });
    beforeEach(() => {
      readWorkOrderInvoice.mockImplementation(async () =>
        okRead({ workOrderId: WORK_ORDER_ID, invoice: issued() })
      );
      readInvoice.mockImplementation(async () =>
        okRead(detail({ status: 'issued', invoiceNumber: 'INV-000123' }))
      );
    });
    const issuedScreen = (over: Record<string, unknown> = {}) =>
      renderScreen({
        initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: issued() }),
        ...over,
      });
    const balanceRead = async () => {
      const balance = await screen.findByRole('region', {
        name: EN['invoices.outstanding.heading'] as string,
      });
      await within(balance).findByText(money('100.0000'));
    };

    it('offers the credit on an issued invoice with money open, and raises it against that invoice', async () => {
      const user = userEvent.setup();
      issuedScreen({ canRaiseCredit: true });
      const form = await requestForm();
      // The invoice is known: nothing to find, and the open balance is the server's.
      expect(within(form).queryByLabelText(labelled('creditNotes.request.invoice'))).toBeNull();
      expect(within(form).getByText(money('100.0000'))).toBeVisible();
      await user.type(amountBox(form), '40');
      await user.type(reasonBox(form), 'Labour billed twice');
      await user.click(submitIn(form));
      await waitFor(() =>
        expect(requestCreditNote).toHaveBeenCalledWith(
          INVOICE_ID,
          { amount: '40.0000', reason: 'Labour billed twice' },
          expect.stringMatching(UUID_SHAPE)
        )
      );
      expect(
        await screen.findByText(EN['creditNotes.request.recorded'] as string)
      ).toBeInTheDocument();
      await waitFor(() => expect(readWorkOrderInvoice).toHaveBeenCalledWith(WORK_ORDER_ID));
    });

    it('offers nothing to a cashier without the credit permission', async () => {
      issuedScreen({ canRaiseCredit: false });
      await balanceRead();
      expect(
        screen.queryByRole('form', { name: EN['creditNotes.request.heading'] as string })
      ).toBeNull();
    });

    it('offers nothing on a settled invoice, even with the permission', async () => {
      readOutstanding.mockImplementation(async () =>
        okRead({
          ...outstanding,
          outstanding: { amount: '0.0000', currency: 'USD' },
          isSettled: true,
          settlement: {
            ...outstanding.settlement,
            paymentStatus: 'paid',
            paid: { amount: '165.0000', currency: 'USD' },
          },
        })
      );
      issuedScreen({ canRaiseCredit: true });
      const balance = await screen.findByRole('region', {
        name: EN['invoices.outstanding.heading'] as string,
      });
      expect(await within(balance).findByTestId('invoice-payment-status')).toHaveTextContent(
        EN['invoices.paymentStatus.paid'] as string
      );
      expect(
        screen.queryByRole('form', { name: EN['creditNotes.request.heading'] as string })
      ).toBeNull();
    });

    it('offers nothing on a draft, even with the permission', async () => {
      readInvoice.mockImplementation(async () => okRead(detail()));
      renderScreen({
        initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: invoice() }),
        canRaiseCredit: true,
      });
      await balanceRead();
      expect(
        screen.queryByRole('form', { name: EN['creditNotes.request.heading'] as string })
      ).toBeNull();
    });

    it('the /invoices page does not offer it to a cashier holding finance view alone', async () => {
      PERMISSIONS = ['sal.invoice.manage', 'sal.finance.view', 'wo.work_order.read'];
      await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
      await balanceRead();
      expect(
        screen.queryByRole('form', { name: EN['creditNotes.request.heading'] as string })
      ).toBeNull();
    });

    it('the /invoices page offers it with the credit permission beside finance view', async () => {
      PERMISSIONS = [
        'sal.invoice.manage',
        'sal.finance.view',
        'wo.work_order.read',
        'sal.credit.manage',
      ];
      await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
      expect(await requestForm()).toBeInTheDocument();
    });
  });

  describe('finance QA fixes D — the decision is offered only where the code is held', () => {
    /** The working context's per-branch answer for the credit-approval code. */
    const answer = (heldInNoteBranch: boolean): BranchPermissions => ({
      codes: ['sal.credit.approve', 'sal.reversal.approve', 'sal.payment.third_party'],
      branches: [
        {
          branchId: TEST_BRANCH.id,
          permissions: heldInNoteBranch ? ['sal.credit.approve'] : [],
        },
        { branchId: OTHER_BRANCH.id, permissions: ['sal.credit.approve'] },
      ],
    });
    const renderWith = (branchPermissions: BranchPermissions) =>
      renderInLtr(
        inBranch(notesScreen(SIGNED_IN, NOTE_ID), {
          snapshot: { ...branchSnapshot([TEST_BRANCH]), branchPermissions },
        })
      );

    it('a holder of the code in another branch only is told it waits, and offers neither decision', async () => {
      renderWith(answer(false));
      const detail = await screen.findByRole('region', {
        name: EN['creditNotes.detail.heading'] as string,
      });
      expect(await within(detail).findByTestId('credit-note-cannot-decide')).toHaveTextContent(
        EN['creditNotes.detail.cannotDecide'] as string
      );
      for (const key of ['creditNotes.approve.action', 'creditNotes.reject.action']) {
        expect(within(detail).queryByRole('button', { name: EN[key] as string })).toBeNull();
      }
    });

    it('a holder of the code in the note branch is offered both decisions', async () => {
      renderWith(answer(true));
      const detail = await screen.findByRole('region', {
        name: EN['creditNotes.detail.heading'] as string,
      });
      for (const key of ['creditNotes.approve.action', 'creditNotes.reject.action']) {
        expect(
          await within(detail).findByRole('button', { name: EN[key] as string })
        ).toBeVisible();
      }
      expect(within(detail).queryByTestId('credit-note-cannot-decide')).toBeNull();
    });
  });

  it('finance QA fixes D: refuses an amount finer than the currency minor unit on the box, before sending', async () => {
    listInvoices.mockResolvedValue(
      okRead({
        items: [
          { ...invoiceEntry, outstanding: { amount: '100.0000', currency: 'USD', minorUnit: 2 } },
        ],
        nextCursor: null,
        hasMore: false,
      })
    );
    const user = userEvent.setup();
    renderLtr(notesScreen(SIGNED_IN));
    const form = await requestForm();
    await chooseInvoice(user, form);
    await user.type(amountBox(form), '10.005');
    await user.type(reasonBox(form), 'Wrong part fitted');
    await user.click(submitIn(form));
    await waitFor(() => expect(amountBox(form)).toHaveAttribute('aria-invalid', 'true'));
    expect(form).toHaveTextContent(EN['form.violation.minor_unit_scale'] as string);
    await waitFor(() => expect(amountBox(form)).toHaveFocus());
    expect(amountBox(form)).toHaveValue('10.005');
    expect(requestCreditNote).not.toHaveBeenCalled();
    // Corrected, the complaint goes, and a whole number of cents is sent.
    await user.clear(amountBox(form));
    expect(amountBox(form)).not.toHaveAttribute('aria-invalid', 'true');
    await user.type(amountBox(form), '10.01');
    await user.click(submitIn(form));
    await waitFor(() => expect(requestCreditNote).toHaveBeenCalledTimes(1));
    expect(requestCreditNote.mock.calls[0]?.[1]).toEqual({
      amount: '10.0100',
      reason: 'Wrong part fitted',
    });
  });
});

describe('names, not references, and dates that read in order (browser QA 5.1b, OBS-3, OBS-4)', () => {
  const issuedInvoice = () =>
    invoice({
      status: 'issued',
      invoiceNumber: 'INV-000123',
      issuedAt: '2026-09-24T18:37:00Z',
      payerPartnerId: OTHER_PAYER,
    });
  const issuedDetail = () => {
    const inv = { ...issuedInvoice(), recordVersion: 5 };
    return { invoice: inv, lines: [line()], recordVersion: 5 };
  };
  const listEntry = (payerName: string | null) => ({
    ...issuedInvoice(),
    saleKind: 'work_order',
    payer: { displayName: payerName, displayNumber: null, partyType: null },
    outstanding: { amount: '100.0000', currency: 'USD' },
  });

  beforeEach(() => {
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: issuedInvoice() })
    );
    readInvoice.mockImplementation(async () => okRead(issuedDetail()));
  });

  const issuedScreen = (render = renderLtr, over: Record<string, unknown> = {}) =>
    render(
      <InvoiceScreen
        locale={render === renderRtl ? 'ar' : 'en'}
        messages={render === renderRtl ? ar : en}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        workOrderRefused={null}
        initialInvoice={okRead({ workOrderId: WORK_ORDER_ID, invoice: issuedInvoice() }) as never}
        canViewFinance={true}
        canIssue={false}
        {...over}
      />
    );

  it('a payer who is not the job’s customer is named from this invoice’s row of the branch list', async () => {
    listInvoices.mockResolvedValue(
      okRead({ items: [listEntry('Fleet Partner')], nextCursor: null, hasMore: false })
    );
    issuedScreen();
    const panel = await screen.findByRole('region', {
      name: EN['invoices.detail.heading'] as string,
    });
    expect(await within(panel).findByText('Fleet Partner')).toBeVisible();
    // Found by its number, in its own branch, under the list's own rule.
    expect(listInvoices).toHaveBeenCalledWith(
      { companyId: 'c', branchId: 'b' },
      { q: 'INV-000123' },
      null
    );
    // Neither the payer's reference nor the invoice's is on the screen.
    expect(panel.textContent).not.toContain(OTHER_PAYER);
    expect(panel.textContent).not.toContain(INVOICE_ID);
    expect(panel.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  it('a payer the list does not name for this reader is said not to be shown, never printed as a reference', async () => {
    listInvoices.mockResolvedValue(
      okRead({ items: [listEntry(null)], nextCursor: null, hasMore: false })
    );
    const user = userEvent.setup();
    issuedScreen();
    const panel = await screen.findByRole('region', {
      name: EN['invoices.detail.heading'] as string,
    });
    expect(
      await within(panel).findByText(EN['invoices.detail.payerNotShown'] as string)
    ).toBeVisible();
    expect(panel.textContent).not.toContain(OTHER_PAYER);
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(within(document).getByTestId('invoice-print-payer')).toHaveTextContent(
      EN['invoices.detail.payerNotShown'] as string
    );
    expect(document.textContent).not.toContain(OTHER_PAYER);
  });

  it('without finance view the branch list is not asked, and the payer is not shown', async () => {
    readInvoice.mockImplementation(async () =>
      okRead({ ...issuedDetail(), invoice: { ...issuedDetail().invoice, totals: null } })
    );
    issuedScreen(renderLtr, { canViewFinance: false });
    const panel = await screen.findByRole('region', {
      name: EN['invoices.detail.heading'] as string,
    });
    expect(
      await within(panel).findByText(EN['invoices.detail.payerNotShown'] as string)
    ).toBeVisible();
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it('prints the Arabic issue moment isolated right to left, so the day, month and year stay in order', async () => {
    listInvoices.mockResolvedValue(
      okRead({ items: [listEntry('Fleet Partner')], nextCursor: null, hasMore: false })
    );
    const user = userEvent.setup();
    issuedScreen(renderRtl);
    await screen.findByRole('region', { name: AR['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: AR['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    const issued = within(document).getByTestId('invoice-print-issued-at');
    const moment = issued.querySelector('bdi');
    expect(moment).not.toBeNull();
    // Never boxed left to right: that is what put the day at the end on paper.
    expect(moment).toHaveAttribute('dir', 'rtl');
    expect(issued).not.toHaveAttribute('dir', 'ltr');
    expect(moment?.textContent).toMatch(/2026/);
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

/*
 * Finance retest fixes C (`P1-32-PRE-OD-FQC`). The signed-in retest at 9bd21460
 * printed the work-order invoice with the page title and its description above
 * the document (DF-R2-1, result matrix R2 rows 11 and 12), and a printable copy
 * could say "not shown" while the payer's name was still being found.
 */
describe('finance retest fixes C', () => {
  /*
   * Whether the print sheet keeps an element on the paper — the rules of
   * `styles/print/_index.scss`, which `gallery-and-print.dom.test.tsx` holds
   * against the compiled sheet: a direct child of a print scope that holds an
   * open document is left off unless it is or holds that document, and `hide`,
   * navigation and buttons never print. The counter-sales DF-B2 case reads the
   * paper the same way.
   */
  function onPaper(element: Element): boolean {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      if (node.matches('[data-print="hide"], nav, button:not([data-print="keep"])')) return false;
      const parent = node.parentElement;
      if (
        parent !== null &&
        parent.matches('[data-print-scope]') &&
        parent.querySelector('[data-print="document"]') !== null &&
        !node.matches('[data-print="document"]') &&
        node.querySelector('[data-print="document"]') === null
      ) {
        return false;
      }
    }
    return true;
  }

  const issuedForWorkOrder = () =>
    invoice({ status: 'issued', invoiceNumber: 'INV-000001', issuedAt: '2026-10-01T07:00:00Z' });

  async function pageWithInvoice(locale: 'en' | 'ar') {
    PERMISSIONS = ['sal.invoice.manage', 'sal.finance.view', 'wo.work_order.read'];
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: issuedForWorkOrder() })
    );
    readInvoice.mockImplementation(async () =>
      okRead(detail({ status: 'issued', invoiceNumber: 'INV-000001' }))
    );
    const tree = (await InvoicesPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({ workOrderId: WORK_ORDER_ID }),
    })) as React.ReactElement;
    return locale === 'en' ? renderLtr(tree) : renderRtl(tree);
  }

  it('DF-R2-1: only the document reaches the paper — no page title or description', async () => {
    const user = userEvent.setup();
    await pageWithInvoice('en');
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(onPaper(document)).toBe(true);
    expect(onPaper(within(document).getByText('WO-000042'))).toBe(true);
    // The page's own title, not the copy's heading of the same word.
    const title = screen
      .getAllByRole('heading', { level: 1, name: EN['invoices.page.title'] as string })
      .find((heading) => !document.contains(heading));
    expect(title).toBeDefined();
    expect(onPaper(title as HTMLElement)).toBe(false);
    expect(onPaper(screen.getByText(EN['invoices.page.description'] as string))).toBe(false);
    // The working panels stay off as before: the detail and the balance.
    expect(
      onPaper(screen.getByRole('region', { name: EN['invoices.detail.heading'] as string }))
    ).toBe(false);
  });

  it('DF-R2-1: the Arabic page prints the document alone too', async () => {
    const user = userEvent.setup();
    await pageWithInvoice('ar');
    await screen.findByRole('region', { name: AR['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: AR['invoices.print.open'] as string }));
    const document = await screen.findByRole('article');
    expect(onPaper(document)).toBe(true);
    const title = screen
      .getAllByRole('heading', { level: 1, name: AR['invoices.page.title'] as string })
      .find((heading) => !document.contains(heading));
    expect(title).toBeDefined();
    expect(onPaper(title as HTMLElement)).toBe(false);
    expect(onPaper(screen.getByText(AR['invoices.page.description'] as string))).toBe(false);
  });

  it('DF-R2-1: with no copy open, printing the page still prints the page', async () => {
    await pageWithInvoice('en');
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    expect(onPaper(screen.getByText(EN['invoices.page.description'] as string))).toBe(true);
    expect(
      onPaper(screen.getByRole('heading', { level: 1, name: EN['invoices.page.title'] as string }))
    ).toBe(true);
  });

  it('the printable copy waits for the payer name: loading and no Print until the lookup settles', async () => {
    // The payer is not the job's customer, so the name is found through the list.
    const billed = invoice({
      status: 'issued',
      invoiceNumber: 'INV-000001',
      issuedAt: '2026-10-01T07:00:00Z',
      payerPartnerId: OTHER_PAYER,
    });
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: billed })
    );
    readInvoice.mockImplementation(async () =>
      okRead(detail({ status: 'issued', invoiceNumber: 'INV-000001', payerPartnerId: OTHER_PAYER }))
    );
    let answer: (page: unknown) => void = () => undefined;
    listInvoices.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderScreen({ initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: billed }) });
    await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const panel = document.getElementById('invoice-print-heading')?.closest('section');
    expect(panel).not.toBeNull();
    const section = panel as HTMLElement;
    // Still finding the name: a loading state, no copy, and nothing to print.
    await waitFor(() => expect(readInvoicePreview).toHaveBeenCalled());
    expect(within(section).getByRole('status')).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
    expect(
      within(section).queryByRole('button', { name: EN['invoices.print.print'] as string })
    ).toBeNull();
    answer(
      okRead({
        items: [{ id: INVOICE_ID, payer: { displayName: 'Omar Khalil' } }],
        nextCursor: null,
        hasMore: false,
      })
    );
    const copy = await screen.findByRole('article');
    expect(within(copy).getByTestId('invoice-print-payer')).toHaveTextContent('Omar Khalil');
    await user.click(
      within(section).getByRole('button', { name: EN['invoices.print.print'] as string })
    );
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('writes the balance with the minor unit the server published, where the locale data disagrees', async () => {
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: issuedForWorkOrder() })
    );
    readInvoice.mockImplementation(async () =>
      okRead(detail({ status: 'issued', invoiceNumber: 'INV-000001' }))
    );
    readOutstanding.mockImplementation(async () =>
      okRead({
        ...outstanding,
        outstanding: { amount: '100.5000', currency: 'IQD', minorUnit: 3 },
      })
    );
    renderScreen({
      initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: issuedForWorkOrder() }),
    });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    expect(await within(balance).findByText('100.500 IQD')).toBeVisible();
    // The browser's locale data alone writes the Iraqi dinar without decimals.
    expect(formatMoney({ amount: '100.5000', currency: 'IQD' }, 'en')).toBe('100.5 IQD');
  });
});

describe('finance QA fixes D — the printed copy', () => {
  const issued = (over: Record<string, unknown> = {}) =>
    invoice({
      status: 'issued',
      invoiceNumber: 'INV-000001',
      issuedAt: '2026-10-01T07:00:00Z',
      ...over,
    });
  const paidByInsurer = {
    ...outstanding,
    outstanding: { amount: '30.0000', currency: 'USD' },
    settlement: {
      ...outstanding.settlement,
      paid: { amount: '70.0000', currency: 'USD' },
      thirdPartyPayments: [
        {
          receipt: { id: 'r-1', reference: 'RCT-000031' },
          payerName: 'Gulf Mutual Insurance',
          relationship: 'insurer',
          authorisationReference: 'CLM-2026-0042',
          reason: 'Covered under the policy',
          money: { amount: '70.0000', currency: 'USD' },
          allocatedAt: '2026-10-02T09:00:00.000Z',
        },
      ],
      thirdPartyPaymentsTruncated: false,
    },
  };

  it('prints who paid for whom, with the authorisation, inside the settlement (D14)', async () => {
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: issued() })
    );
    readInvoice.mockImplementation(async () =>
      okRead(detail({ status: 'issued', invoiceNumber: 'INV-000001' }))
    );
    readOutstanding.mockImplementation(async () => okRead(paidByInsurer));
    const user = userEvent.setup();
    renderScreen({ initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: issued() }) });
    const balance = await screen.findByRole('region', {
      name: EN['invoices.outstanding.heading'] as string,
    });
    await within(balance).findByTestId('invoice-third-party-payment');
    await user.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
    const copy = await screen.findByRole('article');
    const block = within(copy).getByTestId('invoice-print-third-party-payments');
    expect(within(copy).getByTestId('invoice-print-settlement')).toContainElement(block);
    expect(block).toHaveTextContent(EN['invoices.thirdParty.heading'] as string);
    expect(block).toHaveTextContent(
      formatMessage(EN['invoices.thirdParty.paidBy'] as string, {
        payer: 'Gulf Mutual Insurance',
        relationship: EN['invoices.thirdParty.relationship.insurer'] as string,
        customer: 'Layla Haddad',
      })
    );
    expect(block).toHaveTextContent('CLM-2026-0042');
    expect(block).toHaveTextContent('RCT-000031');
  });

  it('a payer lookup that never answers settles as not available after the bounded wait, and finding it again names the payer', async () => {
    const billed = issued({ payerPartnerId: OTHER_PAYER });
    readWorkOrderInvoice.mockImplementation(async () =>
      okRead({ workOrderId: WORK_ORDER_ID, invoice: billed })
    );
    readInvoice.mockImplementation(async () =>
      okRead(detail({ status: 'issued', invoiceNumber: 'INV-000001', payerPartnerId: OTHER_PAYER }))
    );
    // The first lookup never answers; the one asked again does.
    listInvoices.mockImplementationOnce(() => new Promise<never>(() => undefined));
    listInvoices.mockResolvedValue(
      okRead({
        items: [{ id: INVOICE_ID, payer: { displayName: 'Omar Khalil' } }],
        nextCursor: null,
        hasMore: false,
      })
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderScreen({ initialInvoice: okRead({ workOrderId: WORK_ORDER_ID, invoice: billed }) });
      await screen.findByRole('region', { name: EN['invoices.detail.heading'] as string });
      fireEvent.click(screen.getByRole('button', { name: EN['invoices.print.open'] as string }));
      const section = document.getElementById('invoice-print-heading')?.closest('section');
      expect(section).not.toBeNull();
      const panel = section as HTMLElement;
      await waitFor(() => expect(listInvoices).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('article')).toBeNull();
      expect(
        within(panel).queryByRole('button', { name: EN['invoices.print.print'] as string })
      ).toBeNull();
      // Just short of the ceiling it is still waiting.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - 1_000);
      });
      expect(screen.queryByRole('article')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      const copy = await screen.findByRole('article');
      expect(within(copy).getByTestId('invoice-print-payer')).toHaveTextContent(
        EN['invoices.detail.payerUnavailable'] as string
      );
      expect(
        within(panel).getByRole('button', { name: EN['invoices.print.print'] as string })
      ).toBeVisible();
      expect(panel).toHaveTextContent(EN['invoices.print.payerTimedOut'] as string);
      fireEvent.click(
        within(panel).getByRole('button', { name: EN['invoices.print.retryPayer'] as string })
      );
      await waitFor(() => expect(listInvoices).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(
          within(screen.getByRole('article')).getByTestId('invoice-print-payer')
        ).toHaveTextContent('Omar Khalil')
      );
      expect(
        within(panel).queryByRole('button', { name: EN['invoices.print.retryPayer'] as string })
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
