import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  TEST_BRANCH,
  inBranch,
  renderLtr,
  renderRtl,
  BranchSwitch,
  OTHER_BRANCH,
  TEST_COMPANY,
  WorkingBranchProbe,
  branchSnapshot,
} from './render';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';

/**
 * The quotations of a work order and the builder, rendered (P1-30, `W3`,
 * FE-003 and FE-005).
 *
 * The properties under test: the list is reached from a work order and reads
 * on first paint; a refusal is never "no quotations"; the builder sends lines
 * as strings and prices nothing; a refused discount renders as a refusal with
 * its reference and hint, never as a quotation; and the route page decides
 * before it reads.
 *
 * Labels are matched ANCHORED (the field frame decorates them) and scoped.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
// The line discount is labelled "Discount" and the requester "Discount requested by":
// an anchored prefix answers for both, so this one is matched whole.
const labelledExactly = (key: string) => new RegExp(`^${escape(EN[key] as string)}$`);

const listQuotations = vi.fn();
const createQuotation = vi.fn();
vi.mock('@/features/quotations/api', () => ({
  listQuotations: (...args: unknown[]) => listQuotations(...args),
  createQuotation: (...args: unknown[]) => createQuotation(...args),
  readQuotation: vi.fn(),
  listRevisions: vi.fn(),
  readRevision: vi.fn(),
  readRevisionDecisions: vi.fn(),
  createQuotationRevision: vi.fn(),
  issueQuotation: vi.fn(),
  decideRevision: vi.fn(),
  decideItem: vi.fn(),
}));

const listServices = vi.fn();
vi.mock('@/features/services/api', () => ({
  listServices: (...args: unknown[]) => listServices(...args),
}));

const readWorkOrderDetail = vi.fn();
const listWorkOrders = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
  listWorkOrders: (...args: unknown[]) => listWorkOrders(...args),
}));

// The discount requester is FOUND among the tenant's accounts; the adapter is
// replaced here, never the picker.
const listUsers = vi.fn();
vi.mock('@/features/administration/users/api', () => ({
  listUsers: (...args: unknown[]) => listUsers(...args),
}));
const COLLEAGUE_ID = '99999999-9999-4999-8999-999999999999';
const colleaguePage = {
  status: 'ok',
  rows: [
    {
      id: COLLEAGUE_ID,
      email: 'omar@test.local',
      displayName: 'Omar Saleh',
      status: 'active',
      mfaRequired: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      recordVersion: 1,
    },
  ],
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-u',
};

/** The colleague who asked for the discount, found by name and chosen. */
async function chooseRequester(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
  await user.type(within(form).getByLabelText(labelled('quotations.build.requestedBy')), 'Omar');
  await user.click(await within(form).findByRole('button', { name: /Omar Saleh/ }));
}

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

const { QuotationsScreen } = await import('@/features/quotations/components/QuotationsScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const QuotationsPage = (await import('@/app/[locale]/(dashboard)/quotations/page'))
  .default as unknown as RoutePage;

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const QUOTATION_ID = '33333333-3333-4333-8333-333333333333';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';

function summary(over: Record<string, unknown> = {}) {
  return {
    id: QUOTATION_ID,
    quotationNumber: 'QUO-000001',
    workOrderId: WORK_ORDER_ID,
    companyId: 'c',
    branchId: 'b',
    currency: 'JOD',
    status: 'draft',
    payerPartnerRef: null,
    currentRevisionId: null,
    recordVersion: 1,
    ...over,
  };
}

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
    partnerId: PARTNER_ID,
    displayName: 'Layla Haddad',
    relationshipRole: 'vehicle_owner',
    hasAdditionalParties: false,
  },
  vehicle: { vehicleId: 'v', registrationPlate: '12-34567', makeModel: 'Toyota Corolla' },
};

function page(rows: readonly unknown[]) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore: false, correlationId: 'corr' };
}
const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <QuotationsScreen
      locale="en"
      messages={en}
      workOrderId={WORK_ORDER_ID}
      workOrder={workOrder as never}
      canManage={false}
      canReadServices={false}
      {...over}
    />
  );
}

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await QuotationsPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

const builderForm = () =>
  screen.findByRole('form', { name: EN['quotations.build.heading'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  listQuotations.mockResolvedValue(page([summary()]));
  readWorkOrderDetail.mockResolvedValue(
    okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] })
  );
  listServices.mockResolvedValue(
    page([
      {
        id: SERVICE_ID,
        serviceCode: 'OIL-CHANGE',
        name: 'Oil change',
        description: null,
        categoryId: 'c',
        lifecycleStatus: 'active',
        recordVersion: 1,
      },
    ])
  );
});

describe('reached from a work order', () => {
  it('without a work order, finds the job on the working branch instead of asking for a reference', async () => {
    listWorkOrders.mockResolvedValue({
      status: 'ok',
      rows: [workOrder],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-wo',
    });
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <QuotationsScreen
          locale="en"
          messages={en}
          workOrderId={null}
          workOrder={null}
          canManage={false}
          canReadServices={false}
          canSearchWorkOrders={true}
        />
      )
    );
    expect(screen.getByText(EN['quotations.choose.explain'] as string)).toBeVisible();
    expect(listQuotations).not.toHaveBeenCalled();
    const box = screen.getByLabelText(EN['quotations.choose.workOrderId'] as string);
    // Nothing chosen: the box is marked and says why, and nothing is opened.
    await user.click(
      screen.getByRole('button', { name: EN['quotations.choose.submit'] as string })
    );
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(EN['workOrders.picker.required'] as string)).toBeVisible();
    expect(push).not.toHaveBeenCalled();
    await user.type(box, '12-34{Enter}');
    await user.click(await screen.findByRole('button', { name: /WO-000042/ }));
    expect(listWorkOrders).toHaveBeenCalledWith(
      { companyId: TEST_BRANCH.companyId, branchId: TEST_BRANCH.id },
      { q: '12-34' },
      expect.objectContaining({ page: 1 }),
      null
    );
    await user.click(
      screen.getByRole('button', { name: EN['quotations.choose.submit'] as string })
    );
    expect(push).toHaveBeenCalledWith(`/en/quotations?workOrderId=${WORK_ORDER_ID}`);
  });

  it('without the work-order code, offers no search and no submit', () => {
    renderLtr(
      inBranch(
        <QuotationsScreen
          locale="en"
          messages={en}
          workOrderId={null}
          workOrder={null}
          canManage={false}
          canReadServices={false}
          canSearchWorkOrders={false}
        />
      )
    );
    expect(screen.getByText(EN['workOrders.picker.notPermitted'] as string)).toBeVisible();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['quotations.choose.submit'] as string })
    ).toBeNull();
  });

  it('with a work order, reads on first paint and names the work order and customer', async () => {
    renderScreen();
    await waitFor(() => expect(listQuotations).toHaveBeenCalled());
    expect(listQuotations.mock.calls[0]?.[0]).toBe(WORK_ORDER_ID);
    expect(screen.getByText('WO-000042')).toBeVisible();
    expect(screen.getByText('Layla Haddad')).toBeVisible();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('QUO-000001')).toBeVisible();
    expect(within(table).getByText(EN['quotations.status.draft'] as string)).toBeVisible();
  });

  it('says when the work order itself could not be read, and still lists', async () => {
    renderScreen({ workOrder: null });
    expect(screen.getByText(EN['quotations.list.workOrderNotReadable'] as string)).toBeVisible();
    expect(await screen.findByRole('table')).toBeVisible();
  });

  it('renders the denied state instead of an empty list', async () => {
    listQuotations.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr',
    });
    renderScreen();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['quotations.list.none'] as string)).toBeNull();
  });

  it('says there are none when the server answers none', async () => {
    listQuotations.mockResolvedValue(page([]));
    renderScreen();
    expect(await screen.findByText(EN['quotations.list.none'] as string)).toBeVisible();
  });
});

describe('the job picker and the working context', () => {
  /*
   * The picker searches what the header holds: one branch, or every branch of
   * the company under "All my branches" (the union the server enforces), or
   * nothing when "All my branches" spans companies. A switch forgets the job
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

  function renderWith(snapshot: ReturnType<typeof branchSnapshot>) {
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <BranchSwitch to="all" label="everywhere" />
          <WorkingBranchProbe />
          <QuotationsScreen
            locale="en"
            messages={en}
            workOrderId={null}
            workOrder={null}
            canManage={false}
            canReadServices={false}
            canSearchWorkOrders={true}
          />
        </>,
        { snapshot }
      )
    );
  }
  const box = () => screen.getByLabelText(EN['quotations.choose.workOrderId'] as string);
  const submit = () =>
    screen.getByRole('button', { name: EN['quotations.choose.submit'] as string });

  it('under "All my branches" in one company, searches the whole company', async () => {
    listWorkOrders.mockResolvedValue(found([workOrder]));
    const user = userEvent.setup();
    renderWith(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    await user.type(box(), 'Layla{Enter}');
    expect(await screen.findByRole('button', { name: /WO-000042/ })).toBeVisible();
    expect(listWorkOrders).toHaveBeenCalledWith(
      { companyId: TEST_COMPANY.id, branchId: null },
      { q: 'Layla' },
      expect.objectContaining({ page: 1 }),
      null
    );
  });

  it('under "All my branches" across companies, says why, reads nothing, and disables the submit with that reason', async () => {
    const user = userEvent.setup();
    renderWith({
      ...branchSnapshot([TEST_BRANCH, FAR_BRANCH]),
      companies: [TEST_COMPANY, FAR_COMPANY],
    });
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    const panel = await screen.findByTestId('work-order-picker-needs-branch');
    expect(panel).toHaveTextContent(EN['workingContext.needsOneBranch'] as string);
    expect(screen.queryByRole('searchbox')).toBeNull();
    // A submit that would refuse with no control to point at is disabled
    // instead, and described by the sentence that says why.
    expect(submit()).toBeDisabled();
    const describedBy = submit().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      EN['workingContext.needsOneBranch'] as string
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
    expect(screen.queryByRole('button', { name: /WO-000042/ })).toBeNull();
    expect(box()).toHaveValue('');
    expect(listWorkOrders).toHaveBeenCalledTimes(1);
  });

  it('a chosen job is unsaved work: the switch asks, staying keeps it, discarding clears it', async () => {
    listWorkOrders.mockResolvedValue(found([workOrder]));
    const user = userEvent.setup();
    renderWith(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.type(box(), 'Layla{Enter}');
    await user.click(await screen.findByRole('button', { name: /WO-000042/ }));
    expect(screen.getByTestId('work-order-picker-chosen')).toHaveTextContent('WO-000042');

    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(screen.getByTestId('work-order-picker-chosen')).toHaveTextContent('WO-000042');

    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await waitFor(() => expect(screen.queryByTestId('work-order-picker-chosen')).toBeNull());
    expect(box()).toHaveValue('');
    // Nothing is opened for a job that belonged to the previous branch.
    await user.click(submit());
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the builder names its people rather than asking for references', () => {
  it('attributes the discount to a colleague found by name, and sends only the account', async () => {
    listUsers.mockResolvedValue(colleaguePage);
    const user = userEvent.setup();
    createQuotation.mockResolvedValue({
      state: { status: 'success', messageKey: 'quotations.create.success', attempt: 1 },
      created: { ...summary({ id: 'new-id' }), currentRevision: null },
    });
    renderScreen({ canManage: true, canReadUsers: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    await chooseRequester(user, form);
    // Only ACTIVE accounts are asked for: only an active one is accepted.
    expect(listUsers.mock.calls.at(-1)?.[0]).toMatchObject({
      search: 'Omar',
      filters: [{ key: 'status', value: 'active' }],
    });
    expect(within(form).getByTestId('requester-picker-chosen')).toHaveTextContent('Omar Saleh');
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    await waitFor(() => expect(createQuotation).toHaveBeenCalled());
    const body = createQuotation.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['discountRequestedBy']).toBe(COLLEAGUE_ID);
  });

  it('without the directory, offers no box for the requester and says why', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true, canReadUsers: false });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    expect(within(form).getByText(EN['quotations.requester.notPermitted'] as string)).toBeVisible();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('with the customer read, names the payer through the search and offers no reference box', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true, canReadCustomers: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    expect(within(form).getByTestId('quotation-payer-picker-chosen')).toHaveTextContent(
      'Layla Haddad'
    );
    expect(within(form).queryByLabelText(labelled('quotations.build.payerReference'))).toBeNull();
  });

  it('without the customer read, a DIFFERENT payer is still named through the labelled reference', async () => {
    // `quo.quotation-create` declares the quotation and work-order codes only, so
    // a manager without `crm.customer.read` keeps the payer box they had before.
    const OTHER_PAYER = '66666666-6666-4666-8666-666666666666';
    const user = userEvent.setup();
    createQuotation.mockResolvedValue({
      state: { status: 'success', messageKey: 'quotations.create.success', attempt: 1 },
      created: { ...summary({ id: 'new-id' }), currentRevision: null },
    });
    renderScreen({ canManage: true, canReadCustomers: false });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    expect(within(form).queryByTestId('quotation-payer-picker')).toBeNull();
    expect(
      within(form).getByText(EN['quotations.build.payerReferenceHelp'] as string)
    ).toBeVisible();
    // It opens on the work order's own customer, as it always did.
    const box = within(form).getByLabelText(labelled('quotations.build.payerReference'));
    expect(box).toHaveValue(PARTNER_ID);
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '1');
    const submit = within(form).getByRole('button', {
      name: EN['quotations.build.submit'] as string,
    });

    await user.clear(box);
    await user.type(box, 'not-a-reference');
    await user.click(submit);
    expect(
      await within(form).findByText(EN['quotations.build.payerReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(createQuotation).not.toHaveBeenCalled();

    // Eight-four-four-four-twelve hex with no RFC version digit or variant: the
    // server's `z.string().uuid()` refuses it, so the box refuses it first.
    await user.clear(box);
    await user.type(box, '12345678-1234-0234-7234-123456789abc');
    await user.click(submit);
    expect(
      await within(form).findByText(EN['quotations.build.payerReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(createQuotation).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, OTHER_PAYER);
    await user.click(submit);
    await waitFor(() => expect(createQuotation).toHaveBeenCalledTimes(1));
    const body = createQuotation.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['payerPartnerRef']).toBe(OTHER_PAYER);
    expect((body['lines'] as Record<string, unknown>[])[0]?.['serviceId']).toBe(SERVICE_ID);
  });

  it('without the customer read, a changed payer reference is unsaved work: a branch switch asks first', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <QuotationsScreen
            locale="en"
            messages={en}
            workOrderId={WORK_ORDER_ID}
            workOrder={workOrder as never}
            canManage={true}
            canReadServices={false}
            canReadCustomers={false}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    try {
      // Opened on the work order's customer: a default, not unsaved work.
      await switchWithoutQuestion(user, 'second');
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      const box = within(form).getByLabelText(labelled('quotations.build.payerReference'));
      await user.clear(box);
      await user.type(box, '66666666-6666-4666-8666-666666666666');
      await stayOnBranch(user, await switchExpectingQuestion(user, 'first'));
      expect(heldBranch()).toBe(OTHER_BRANCH.id);
    } finally {
      forgetRememberedBranch();
    }
  });
});

describe('the builder sends lines as strings and prices nothing', () => {
  it('is not offered without quo.quotation.manage', () => {
    renderScreen({ canManage: false });
    expect(
      screen.queryByRole('button', { name: EN['quotations.list.create'] as string })
    ).toBeNull();
  });

  it('creates a quotation from a line, prefilling the payer from the work order, then moves to it', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue({
      state: { status: 'success', messageKey: 'quotations.create.success', attempt: 1 },
      created: { ...summary({ id: 'new-id' }), currentRevision: null },
    });
    renderScreen({ canManage: true, canReadCustomers: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    // The payer opens on the work order's own customer, NAMED rather than shown
    // as a reference.
    expect(within(form).getByTestId('quotation-payer-picker-chosen')).toHaveTextContent(
      'Layla Haddad'
    );
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '2.5');
    await user.type(within(form).getByLabelText(labelledExactly('quotations.lines.discount')), '5');
    await user.type(
      within(form).getByLabelText(labelled('quotations.lines.description')),
      'Front pads'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );

    await waitFor(() => expect(createQuotation).toHaveBeenCalled());
    const body = createQuotation.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['workOrderId']).toBe(WORK_ORDER_ID);
    expect(body['payerPartnerRef']).toBe(PARTNER_ID);
    const lines = body['lines'] as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.['serviceId']).toBe(SERVICE_ID);
    // Strings, as typed: the server prices the line; nothing here multiplied anything.
    expect(lines[0]?.['quantity']).toBe('2.5');
    expect(typeof lines[0]?.['discount']).toBe('string');
    expect(lines[0]?.['discount']).toMatch(/^5(\.0000)?$/);
    expect(lines[0]?.['description']).toBe('Front pads');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/quotations/new-id'));
  });

  it('refuses a zero quantity and a malformed service before any request', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    await user.type(within(form).getByLabelText(labelled('quotations.picker.serviceIdField')), 'x');
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '0');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['quotations.lines.quantityFormat'] as string)
    ).toBeVisible();
    expect(
      within(form).getAllByText(EN['quotations.common.idFormat'] as string).length
    ).toBeGreaterThan(0);
    expect(createQuotation).not.toHaveBeenCalled();
  });

  it('shows a refused line quantity above the lines, with the draft line still filled in', async () => {
    // The API refuses `body.lines[0].quantity`; only the LEAF survives the
    // client, so the line it belonged to is no longer in the message. It is
    // stated over the lines rather than guessed onto one of them.
    createQuotation.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { quantity: 'form.violation.quantity' },
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '2.5');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    expect(await within(form).findByText(EN['form.violation.quantity'] as string)).toBeVisible();
    expect(within(form).getByLabelText(labelled('quotations.lines.quantity'))).toHaveValue('2.5');
    expect(within(form).getByLabelText(labelled('quotations.picker.serviceIdField'))).toHaveValue(
      SERVICE_ID
    );
  });

  it('adds and removes lines, never below one', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    const removeButtons = () =>
      within(form).getAllByRole('button', { name: EN['quotations.lines.remove'] as string });
    expect(removeButtons()[0]).toBeDisabled();
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.lines.add'] as string })
    );
    expect(removeButtons()).toHaveLength(2);
    expect(removeButtons()[0]).toBeEnabled();
    await user.click(removeButtons()[1] as HTMLElement);
    expect(removeButtons()).toHaveLength(1);
  });

  it('a refused discount renders as a refusal with its reference and the hint, and no quotation', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue({
      state: {
        status: 'denied',
        messageKey: 'state.denied.title',
        correlationId: 'corr-d',
        attempt: 1,
      },
      created: null,
    });
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '1');
    await user.type(
      within(form).getByLabelText(labelledExactly('quotations.lines.discount')),
      '900'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    await waitFor(() => expect(createQuotation).toHaveBeenCalled());
    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toContain(EN['state.denied.title'] as string);
    expect(alert.textContent).toContain(EN['quotations.build.discountRefusedHint'] as string);
    expect(alert.textContent).toContain('corr-d');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the /quotations route page decides before it reads', () => {
  it('refuses without quo.quotation.read, and issues no read', async () => {
    PERMISSIONS = [];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listQuotations).not.toHaveBeenCalled();
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
  });

  it('reads the work order only with wo.work_order.read, and lists either way', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(screen.getByText(EN['quotations.list.workOrderNotReadable'] as string)).toBeVisible();
    await waitFor(() => expect(listQuotations).toHaveBeenCalled());
  });

  it('with wo.work_order.read, names the work order; with manage, offers the builder', async () => {
    PERMISSIONS = ['quo.quotation.read', 'wo.work_order.read', 'quo.quotation.manage'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(screen.getByText('WO-000042')).toBeVisible();
    expect(
      screen.getByRole('button', { name: EN['quotations.list.create'] as string })
    ).toBeVisible();
  });

  it('without a work order in the address, offers the chooser', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await renderPage({ locale: 'en' });
    expect(screen.getByText(EN['quotations.choose.explain'] as string)).toBeVisible();
    expect(listQuotations).not.toHaveBeenCalled();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound');
  });
});

describe('Arabic, right to left', () => {
  it('renders the list in Arabic with the same behaviour', async () => {
    renderRtl(
      <QuotationsScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        canManage={false}
        canReadServices={false}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('QUO-000001')).toBeVisible();
    expect(within(table).getByText(AR['quotations.status.draft'] as string)).toBeVisible();
  });
});
