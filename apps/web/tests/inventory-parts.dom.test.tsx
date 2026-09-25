import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import type { ReactElement } from 'react';
import {
  TEST_BRANCH,
  inBranch,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
  RETIRED_BOX,
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

/*
 * Every screen in this file is addressed by the WORKING CONTEXT: the branch it
 * reads is the header's own named selection, not a pair typed into the screen
 * (Owner directive, `P1-32-PRE-OD-UX`). So each render goes inside a provider.
 *
 * The two names are shadowed rather than changed at every call site, which
 * keeps the default snapshot — one authorized branch, selected for the operator
 * — true for every case below. A case that needs a different snapshot builds
 * one and renders it explicitly.
 */
const renderLtr = (ui: ReactElement, options?: Parameters<typeof renderInLtr>[1]) =>
  renderInLtr(inBranch(ui), options);
const renderRtl = (ui: ReactElement, options?: Parameters<typeof renderInRtl>[1]) =>
  renderInRtl(inBranch(ui, { locale: 'ar' }), options);
import { PLATFORM_WORK_ORDER_STATES } from '@/features/work-orders/work-orders-contract';

/**
 * The parts of a work order, rendered (P1-30, `W5`, FE-011 and FE-012).
 *
 * The properties under test: the screen is reached from a work order and
 * lists its issues on first paint; required parts are requested only with
 * `wo.work_order.read`; each issue shows `quantity` and `returnedQty` as the
 * server's strings and nothing is subtracted; issuing sends the quantity as
 * typed with the work order's branch as the pickers' target, and a refusal
 * (an over-issue) renders as a refusal with its reference; returning names
 * only the issue and the echo's running figures are stated above the panels
 * that re-read; and the route page decides before it reads.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listPartIssues = vi.fn();
const listItems = vi.fn();
const listRequiredParts = vi.fn();
const listReservations = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const createIssue = vi.fn();
const createReturn = vi.fn();
const createReservation = vi.fn();
const listMaterialRequirements = vi.fn();
const readMaterialRequirement = vi.fn();
const closeMaterialRequest = vi.fn();
const cancelMaterialRequest = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listPartIssues: (...args: unknown[]) => listPartIssues(...args),
  listRequiredParts: (...args: unknown[]) => listRequiredParts(...args),
  listReservations: (...args: unknown[]) => listReservations(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  // `./shared` names this export; this screen never calls it.
  listItemCategories: vi.fn(),
  createIssue: (...args: unknown[]) => createIssue(...args),
  createReturn: (...args: unknown[]) => createReturn(...args),
  listItems: (...args: unknown[]) => listItems(...args),
  listAvailability: vi.fn(),
  listMovements: vi.fn(),
  createReservation: (...args: unknown[]) => createReservation(...args),
  releaseReservation: vi.fn(),
  // P1-32: the material requirements panel this screen now mounts. The list is
  // answered with an empty page by default so the panel settles; the tests that
  // are about requirements give it rows of their own.
  listMaterialRequirements: (...args: unknown[]) => listMaterialRequirements(...args),
  readMaterialRequirement: (...args: unknown[]) => readMaterialRequirement(...args),
  createMaterialRequirement: vi.fn(),
  decideMaterialRequirement: vi.fn(),
  recheckMaterialRequirement: vi.fn(),
  cancelMaterialRequirement: vi.fn(),
  requestMaterialException: vi.fn(),
  decideMaterialException: vi.fn(),
  closeMaterialRequest: (...args: unknown[]) => closeMaterialRequest(...args),
  cancelMaterialRequest: (...args: unknown[]) => cancelMaterialRequest(...args),
  listUnitsOfMeasure: vi.fn(),
}));

const readWorkOrderDetail = vi.fn();
const listWorkOrders = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
  listWorkOrders: (...args: unknown[]) => listWorkOrders(...args),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    permissions: PERMISSIONS,
    email: 'operator@test.local',
    userId: USER_ID,
  }),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { PartsScreen } = await import('@/features/inventory/components/PartsScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const PartsPage = (await import('@/app/[locale]/(dashboard)/inventory/parts/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const RESERVATION_ID = '55555555-5555-4555-8555-555555555555';
const ISSUE_ID = '66666666-6666-4666-8666-666666666666';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const REQUIRED_PART_ID = '88888888-8888-4888-8888-888888888888';
const USER_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUIREMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERVICE_LINE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SPECIFICATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UOM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MATERIAL_REQUEST_ID = '12121212-1212-4212-8212-121212121212';
const CATEGORY_ID = '13131313-1313-4313-8313-131313131313';

const workOrder = {
  id: WORK_ORDER_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
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

function partIssue(over: Record<string, unknown> = {}) {
  return {
    id: ISSUE_ID,
    workOrderId: WORK_ORDER_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    itemId: ITEM_ID,
    sku: 'BRK-001',
    locationId: LOCATION_ID,
    locationCode: 'WH-1',
    reservationId: null,
    quantity: '2.500',
    returnedQty: '1.000',
    issuedAt: '2026-09-01T09:00:00Z',
    ...over,
  };
}
const requiredPart = {
  id: REQUIRED_PART_ID,
  workOrderId: WORK_ORDER_ID,
  jobId: null,
  description: 'Front brake pads',
  quantity: '2.000',
  unit: 'set',
  reference: ITEM_ID,
  recordVersion: 1,
};
const reservation = {
  id: RESERVATION_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  itemId: ITEM_ID,
  sku: 'BRK-001',
  locationId: LOCATION_ID,
  locationCode: 'WH-1',
  workOrderId: WORK_ORDER_ID,
  quantity: '2.000',
  status: 'active',
  expiresAt: null,
  createdAt: '2026-09-01T08:30:00Z',
  recordVersion: 1,
};
const location = {
  id: LOCATION_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  locationCode: 'WH-1',
  name: 'Main warehouse',
  locationType: 'warehouse',
  parentLocationId: null,
  status: 'active',
};

function page(rows: readonly unknown[]) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore: false, correlationId: 'corr' };
}
const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

/**
 * One approved requirement, with every figure as the exact decimal string the
 * server publishes. `remainingQuantity` is the SERVER's figure and is
 * deliberately not the difference of the two beside it in every case: the screen
 * must render what it was sent.
 */
function materialRequirement(over: Record<string, unknown> = {}) {
  return {
    id: REQUIREMENT_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    workOrderId: WORK_ORDER_ID,
    serviceLineId: SERVICE_LINE_ID,
    itemId: ITEM_ID,
    itemCategoryId: null,
    basis: 'specification',
    specificationId: SPECIFICATION_ID,
    serviceCondition: 'oil_change',
    engineVariant: null,
    uomId: UOM_ID,
    sourceReference: null,
    status: 'approved',
    approvalRequiredReason: null,
    requestedBy: OTHER_USER_ID,
    approvedBy: USER_ID,
    approvedAt: '2026-09-01T09:00:00Z',
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    allowanceQuantity: '4.250',
    approvedExceptionQuantity: '0.500',
    effectiveAllowance: '4.750',
    requestedQuantity: '0.000',
    reservedQuantity: '1.000',
    issuedQuantity: '0.250',
    returnedQuantity: '0.000',
    committedQuantity: '1.250',
    remainingQuantity: '3.500',
    recordVersion: 1,
    createdAt: '2026-09-01T08:30:00Z',
    ...over,
  };
}

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <PartsScreen
      locale="en"
      messages={en}
      workOrderId={WORK_ORDER_ID}
      workOrder={workOrder as never}
      workOrderRefused={false}
      canOperate={false}
      canReadWorkOrder={true}
      canReadBranches={false}
      currentUserId={USER_ID}
      canRequestMaterial={false}
      canApproveMaterial={false}
      canDecideMaterialException={false}
      {...over}
    />
  );
}

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await PartsPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

const issuesRegion = () =>
  screen.getByRole('region', { name: EN['inventory.parts.issues.heading'] as string });
const requiredRegion = () =>
  screen.getByRole('region', { name: EN['inventory.parts.required.heading'] as string });
const issueForm = () =>
  screen.findByRole('form', { name: EN['inventory.issue.heading'] as string });

/**
 * Choose what this job is allowed to use. Every work-order draw is measured
 * against a requirement and neither draw form can be submitted before one is
 * chosen, so the issuing tests below do this first — exactly as an operator does.
 */
const chooseRequirement = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole('button', { name: EN['inventory.material.use'] as string }));

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  // Fresh objects on every call, as a Server Action's deserialised answer is:
  // a stable mock would let a re-render loop hide behind React's bail-out.
  listPartIssues.mockImplementation(async () => page([partIssue()]));
  listRequiredParts.mockImplementation(async () => okRead({ items: [{ ...requiredPart }] }));
  listReservations.mockImplementation(async () => page([{ ...reservation }]));
  listLocations.mockImplementation(async () =>
    okRead({ items: [{ ...location }], nextCursor: null, hasMore: false })
  );
  listBranches.mockImplementation(async () => okRead({ items: [] }));
  readWorkOrderDetail.mockImplementation(async () =>
    okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] })
  );
  // A work order with material control on has a requirement per service line, so
  // the default listing carries one. It covers a GROUP rather than a named part,
  // which is what keeps the issue form unprefilled for the tests below that type
  // the part themselves.
  listMaterialRequirements.mockImplementation(async () =>
    okRead({
      items: [materialRequirement({ itemId: null, itemCategoryId: CATEGORY_ID })],
      nextCursor: null,
      hasMore: false,
    })
  );
  readMaterialRequirement.mockImplementation(async () =>
    okRead({ ...materialRequirement(), exceptions: [] })
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
    renderScreen({ workOrderId: null, workOrder: null });
    expect(screen.getByText(EN['inventory.parts.choose.explain'] as string)).toBeVisible();
    expect(listPartIssues).not.toHaveBeenCalled();
    const box = screen.getByLabelText(EN['inventory.parts.choose.workOrderId'] as string);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.choose.submit'] as string })
    );
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(push).not.toHaveBeenCalled();
    await user.type(box, 'Corolla{Enter}');
    await user.click(await screen.findByRole('button', { name: /WO-000042/ }));
    expect(listWorkOrders).toHaveBeenCalledWith(
      { companyId: TEST_BRANCH.companyId, branchId: TEST_BRANCH.id },
      { q: 'Corolla' },
      expect.objectContaining({ page: 1 }),
      null
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.choose.submit'] as string })
    );
    expect(push).toHaveBeenCalledWith(`/en/inventory/parts?workOrderId=${WORK_ORDER_ID}`);
  });

  it('without the work-order code, keeps a labelled job reference, checks it, and opens that job', async () => {
    /*
     * The parts of a job are read with `inv.stock.read` alone, so the chooser
     * must not take the way in away from a stock clerk without the job read
     * (route sweep B2): the labelled reference they had before the picker.
     */
    const user = userEvent.setup();
    renderScreen({ workOrderId: null, workOrder: null, canReadWorkOrder: false });
    expect(screen.queryByRole('searchbox')).toBeNull();
    const box = screen.getByLabelText(labelled('inventory.workOrderReference.label'));
    const submit = screen.getByRole('button', {
      name: EN['inventory.parts.choose.submit'] as string,
    });
    expect(submit).toBeEnabled();
    // Every id the submit is described by exists on the page.
    for (const id of (submit.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    await user.type(box, 'WO-000042');
    await user.click(submit);
    expect(
      await screen.findByText(EN['inventory.workOrderReference.format'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(push).not.toHaveBeenCalled();
    await user.clear(box);
    await user.type(box, WORK_ORDER_ID);
    await user.click(submit);
    expect(push).toHaveBeenCalledWith(`/en/inventory/parts?workOrderId=${WORK_ORDER_ID}`);
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('lists the issues on first paint with two figures as strings, and names the work order', async () => {
    renderScreen();
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    expect(listPartIssues.mock.calls[0]?.[0]).toBe(WORK_ORDER_ID);
    expect(screen.getByText('WO-000042')).toBeVisible();
    expect(screen.getByText('Layla Haddad')).toBeVisible();
    const table = await within(issuesRegion()).findByRole('table');
    expect(within(table).getByText('2.500')).toBeVisible();
    expect(within(table).getByText('1.000')).toBeVisible();
    expect(within(table).getByText('BRK-001')).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.parts.issues.noReservation'] as string)
    ).toBeVisible();
    // Every numeric-looking cell of the row IS one of the two server strings:
    // a third figure taken from them (1.5, 1.500, whatever its header) would
    // land in this list and fail the equality.
    const dataRow = within(table).getAllByRole('row')[1] as HTMLElement;
    const cells = within(dataRow).getAllByRole('cell');
    expect(cells).toHaveLength(7);
    const figures = cells
      .map((cell) => (cell.textContent ?? '').trim())
      .filter((text) => /^-?\d+(\.\d+)?$/.test(text));
    expect(figures).toEqual(['2.500', '1.000']);
  });

  /**
   * DEF-M-04. The header printed the state code itself, so English read
   * "State in_progress" and Arabic carried the same Latin token inside an RTL
   * sentence. Every code the platform seeds now has a sentence; a code a tenant
   * invented has none and is rendered as the token it is rather than guessed at.
   */
  it('names every platform work-order state in words, in both languages', async () => {
    for (const code of PLATFORM_WORK_ORDER_STATES) {
      const key = `workOrders.state.${code}`;
      expect(EN[key], `en is missing ${key}`).toBeTypeOf('string');
      expect(AR[key], `ar is missing ${key}`).toBeTypeOf('string');
    }
    renderScreen({ workOrder: { ...workOrder, state: 'in_progress' } });
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    expect(screen.getByText(EN['workOrders.state.in_progress'] as string)).toBeVisible();
    expect(screen.queryByText('in_progress')).toBeNull();
  });

  it('renders a state the platform does not define as the code it is, not as a key', async () => {
    renderScreen({ workOrder: { ...workOrder, state: 'awaiting_paint_booth' } });
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    expect(screen.getByText('awaiting_paint_booth')).toBeVisible();
    expect(screen.queryByText('workOrders.state.awaiting_paint_booth')).toBeNull();
  });

  it('says a refused work-order read was refused, not that the operator lacks access', async () => {
    renderScreen({ workOrder: null, workOrderRefused: true });
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    expect(screen.getByText(EN['inventory.parts.workOrderRefused'] as string)).toBeVisible();
    expect(screen.queryByText(EN['inventory.parts.workOrderNotReadable'] as string)).toBeNull();
  });

  it('requests the required parts only with wo.work_order.read', async () => {
    renderScreen({ canReadWorkOrder: false, workOrder: null, workOrderRefused: false });
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    expect(listRequiredParts).not.toHaveBeenCalled();
    expect(screen.getByText(EN['inventory.parts.workOrderNotReadable'] as string)).toBeVisible();
  });

  it('shows the required parts with their item reference', async () => {
    renderScreen();
    await waitFor(() => expect(listRequiredParts).toHaveBeenCalledWith(WORK_ORDER_ID));
    const region = requiredRegion();
    expect(await within(region).findByText('Front brake pads')).toBeVisible();
    expect(within(region).getByText('2.000')).toBeVisible();
    expect(within(region).getByText(ITEM_ID)).toBeVisible();
  });

  it('renders the denied state instead of an empty list', async () => {
    listPartIssues.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr',
    });
    renderScreen();
    expect(
      await within(issuesRegion()).findByText(EN['state.denied.title'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['inventory.parts.issues.none'] as string)).toBeNull();
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
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <BranchSwitch to="all" label="everywhere" />
          <WorkingBranchProbe />
          <PartsScreen
            locale="en"
            messages={en}
            workOrderId={null}
            workOrder={null}
            workOrderRefused={false}
            canOperate={false}
            canReadWorkOrder={true}
            canReadBranches={false}
            currentUserId={USER_ID}
            canRequestMaterial={false}
            canApproveMaterial={false}
            canDecideMaterialException={false}
          />
        </>,
        { snapshot }
      )
    );
  }
  const box = () => screen.getByLabelText(EN['inventory.parts.choose.workOrderId'] as string);
  const submit = () =>
    screen.getByRole('button', { name: EN['inventory.parts.choose.submit'] as string });

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

describe('a confirmed "Discard and change branch" opens the draw forms empty', () => {
  /*
   * The typed item reference is what makes the issue form unsaved work, and the
   * quantity beside it is part of the same draw. Neither lives in a picker that
   * forgets its choice on a switch, so without a reset the form would keep the
   * previous branch's draw on screen, ready to send, after the operator had
   * answered that it could go.
   */
  function renderInTwo() {
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <PartsScreen
            locale="en"
            messages={en}
            workOrderId={WORK_ORDER_ID}
            workOrder={workOrder as never}
            workOrderRefused={false}
            canOperate={true}
            canReadWorkOrder={true}
            canReadBranches={false}
            currentUserId={USER_ID}
            canRequestMaterial={false}
            canApproveMaterial={false}
            canDecideMaterialException={false}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
  }

  it('empties the typed item reference and the quantity once the operator confirms', async () => {
    const user = userEvent.setup();
    renderInTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.issue.open'] as string })
    );
    const reference = async () =>
      within(await issueForm()).getByLabelText(labelled('inventory.itemPicker.reference'));
    const quantity = async () =>
      within(await issueForm()).getByLabelText(labelled('inventory.issue.quantity'));
    try {
      await user.type(await reference(), ITEM_ID);
      await user.type(await quantity(), '3');

      await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
      expect(heldBranch()).toBe(TEST_BRANCH.id);
      expect(await reference()).toHaveValue(ITEM_ID);

      await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      await waitFor(async () => expect(await reference()).toHaveValue(''));
      expect(await quantity()).toHaveValue('');
      // Nothing is left to lose, so the next switch asks nothing.
      await switchWithoutQuestion(user, 'first');
      expect(createIssue).not.toHaveBeenCalled();
    } finally {
      forgetRememberedBranch();
    }
  });
});

describe('FE-011 — issuing', () => {
  it('offers neither issuing nor returning without inv.stock.operate', async () => {
    renderScreen({ canOperate: false });
    await within(issuesRegion()).findByRole('table');
    expect(screen.queryByRole('button', { name: EN['inventory.issue.open'] as string })).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['inventory.return.action'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['inventory.parts.required.issueThis'] as string })
    ).toBeNull();
  });

  it('issues from a required part: prefilled item, line and quantity; the pickers target the work order’s branch', async () => {
    const user = userEvent.setup();
    createIssue.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.issue.success', attempt: 1 },
      // Deliberately NOT the typed quantity: the notice must show the echo.
      created: { id: 'new-issue', quantity: '7.000', reservationId: null },
    });
    renderScreen({ canOperate: true });
    // The requirement is chosen FIRST: choosing one clears any prefill, so an
    // operator who picks the allowance after the line would lose the line.
    await chooseRequirement(user);
    await user.click(
      await within(requiredRegion()).findByRole('button', {
        name: EN['inventory.parts.required.issueThis'] as string,
      })
    );
    const form = await issueForm();
    // Without the catalogue read the item stays in its labelled reference box,
    // prefilled from the row; the line is chosen from the job's own list.
    expect(within(form).getByLabelText(labelled('inventory.itemPicker.reference'))).toHaveValue(
      ITEM_ID
    );
    await waitFor(() =>
      expect(within(form).getByLabelText(labelled('inventory.issue.requiredPart'))).toHaveValue(
        REQUIRED_PART_ID
      )
    );
    expect(within(form).getByLabelText(labelled('inventory.issue.quantity'))).toHaveValue('2.000');
    await waitFor(() =>
      expect(listLocations).toHaveBeenCalledWith({ companyId: COMPANY_ID, branchId: BRANCH_ID })
    );
    await waitFor(() => expect(listReservations).toHaveBeenCalled());
    expect(listReservations.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    expect(listReservations.mock.calls[0]?.[1]).toEqual({
      workOrderId: WORK_ORDER_ID,
      status: 'active',
    });
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    const before = listPartIssues.mock.calls.length;
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    await waitFor(() => expect(createIssue).toHaveBeenCalled());
    expect(createIssue.mock.calls[0]?.[0]).toEqual({
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.000',
      materialRequirementId: REQUIREMENT_ID,
      requiredPartRef: REQUIRED_PART_ID,
    });
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(EN['inventory.issue.recorded'] as string);
    expect(note).toHaveTextContent('7.000');
    expect(note).not.toHaveTextContent('2.000');
    await waitFor(() => expect(listPartIssues.mock.calls.length).toBeGreaterThan(before));
    // The pickers were read once for the order's branch, and not again on the re-render.
    expect(listLocations).toHaveBeenCalledTimes(1);
  });

  it('a refused reservation list is a refusal inside the form, not "no reservations"', async () => {
    const user = userEvent.setup();
    listReservations.mockImplementation(async () => ({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'ref-res',
    }));
    renderScreen({ canOperate: true });
    await chooseRequirement(user);
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    expect(
      await within(form).findByText(EN['inventory.issue.reservationsRefused'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(within(form).getByText('ref-res', { exact: false })).toBeVisible();
    expect(within(form).queryByText(EN['inventory.issue.reservationHelp'] as string)).toBeNull();
  });

  it('choosing a reservation fills the item and location, and the reservation travels with the issue', async () => {
    const user = userEvent.setup();
    createIssue.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.issue.success', attempt: 1 },
      created: { id: 'new-issue', quantity: '1.5', reservationId: RESERVATION_ID },
    });
    renderScreen({ canOperate: true });
    await chooseRequirement(user);
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    await within(form).findByRole('option', { name: 'BRK-001 — WH-1 — 2.000' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.reservation')),
      RESERVATION_ID
    );
    expect(within(form).getByLabelText(labelled('inventory.itemPicker.reference'))).toHaveValue(
      ITEM_ID
    );
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    expect(within(form).getByLabelText(labelled('inventory.issue.location'))).toHaveValue(
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.issue.quantity')), '1.5');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    await waitFor(() => expect(createIssue).toHaveBeenCalled());
    expect(createIssue.mock.calls[0]?.[0]).toEqual({
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '1.5',
      materialRequirementId: REQUIREMENT_ID,
      reservationId: RESERVATION_ID,
    });
    expect(typeof (createIssue.mock.calls[0]?.[0] as { quantity: unknown }).quantity).toBe(
      'string'
    );
  });

  it('refuses a zero quantity before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: true });
    await chooseRequirement(user);
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    await user.type(
      within(form).getByLabelText(labelled('inventory.itemPicker.reference')),
      ITEM_ID
    );
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.issue.quantity')), '0');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['inventory.reserve.quantityFormat'] as string)
    ).toBeVisible();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('an over-issue refused by the server is a refusal inside the form, with its reference', async () => {
    const user = userEvent.setup();
    createIssue.mockResolvedValue({
      state: {
        status: 'conflict',
        messageKey: 'state.conflict.title',
        attempt: 1,
        correlationId: 'ref-409',
      },
      created: null,
    });
    renderScreen({ canOperate: true });
    await chooseRequirement(user);
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    await user.type(
      within(form).getByLabelText(labelled('inventory.itemPicker.reference')),
      ITEM_ID
    );
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.issue.quantity')), '5');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('ref-409');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('when the work order cannot be read, names the working branch instead of asking for one', async () => {
    /*
     * The work order's own branch is what a draw is addressed to. When that
     * read is refused the screen falls back — and the fallback used to be two
     * free-text boxes asking for a company reference and a branch reference,
     * offered to the operator whose read had just been refused.
     *
     * It is the working context's named branch now (Owner directive,
     * `P1-32-PRE-OD-UX`): a list, never a box, and the locations of that branch
     * are read ONCE without anything being typed at all.
     */
    const user = userEvent.setup();
    renderScreen({
      canOperate: true,
      canReadWorkOrder: false,
      workOrder: null,
    });
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    expect(within(form).getByText(EN['inventory.issue.branchUnknown'] as string)).toBeVisible();
    // The shell already holds the named branches, so no directory is requested.
    expect(listBranches).not.toHaveBeenCalled();
    // Nothing to type: the branch is chosen, so the locations read themselves.
    expect(within(form).queryAllByRole('textbox')).not.toContain(
      within(form).queryByLabelText(RETIRED_BOX.en.company)
    );
    await waitFor(() =>
      expect(listLocations).toHaveBeenCalledWith({ companyId: COMPANY_ID, branchId: BRANCH_ID })
    );
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await waitFor(() => expect(listReservations).toHaveBeenCalledTimes(1));
    // Read ONCE — not on every render the answer itself causes, and not again
    // when another field changes.
    expect(listLocations).toHaveBeenCalledTimes(1);
    await user.type(within(form).getByLabelText(labelled('inventory.issue.quantity')), '1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listLocations).toHaveBeenCalledTimes(1);
    expect(listReservations).toHaveBeenCalledTimes(1);
  });
});

describe('the item and the required part are found, not typed (route sweep B2)', () => {
  it('with the catalogue read, a required part opens the form on that part by name, and it is sent', async () => {
    const user = userEvent.setup();
    createIssue.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.issue.success', attempt: 1 },
      created: { id: 'new-issue', quantity: '2.000', reservationId: null },
    });
    renderScreen({ canOperate: true, canReadItems: true });
    await chooseRequirement(user);
    await user.click(
      await within(requiredRegion()).findByRole('button', {
        name: EN['inventory.parts.required.issueThis'] as string,
      })
    );
    const form = await issueForm();
    expect(within(form).getByTestId('issue-item-picker-chosen')).toHaveTextContent(
      'Front brake pads'
    );
    expect(within(form).queryByDisplayValue(ITEM_ID)).toBeNull();
    expect(
      await within(form).findByRole('option', { name: 'Front brake pads — 2.000 set' })
    ).toBeInTheDocument();
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    await waitFor(() => expect(createIssue).toHaveBeenCalled());
    expect(createIssue.mock.calls[0]?.[0]).toMatchObject({
      itemId: ITEM_ID,
      requiredPartRef: REQUIRED_PART_ID,
    });
  });

  it('with the catalogue read, an item is found by name; with none chosen, the control says so', async () => {
    const user = userEvent.setup();
    listItems.mockResolvedValue(
      page([
        {
          id: ITEM_ID,
          itemCategoryId: 'cat',
          sku: 'BRK-001',
          name: 'Brake pad',
          description: null,
          unitOfMeasure: { id: 'u', code: 'EA' },
          itemType: 'part',
          isStockTracked: true,
          isSerialized: false,
          lifecycleStatus: 'active',
          recordVersion: 1,
        },
      ])
    );
    createIssue.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.issue.success', attempt: 1 },
      created: { id: 'new-issue', quantity: '1', reservationId: null },
    });
    renderScreen({ canOperate: true, canReadItems: true });
    await chooseRequirement(user);
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.issue.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['inventory.itemPicker.required'] as string)
    ).toBeVisible();
    expect(createIssue).not.toHaveBeenCalled();
    await user.type(
      within(form).getByLabelText(EN['inventory.issue.item'] as string),
      'BRK{Enter}'
    );
    await user.click(await within(form).findByRole('button', { name: 'BRK-001 — Brake pad' }));
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    await waitFor(() => expect(createIssue).toHaveBeenCalled());
    expect(createIssue.mock.calls[0]?.[0]).toMatchObject({ itemId: ITEM_ID });
    expect(listItems).toHaveBeenCalledWith(
      { search: 'BRK', lifecycleStatus: 'active' },
      expect.objectContaining({ pageSize: 10 }),
      null
    );
  });

  it('without the job read, the required-part line stays a labelled reference, checked before it is sent', async () => {
    const user = userEvent.setup();
    createIssue.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.issue.success', attempt: 1 },
      created: { id: 'new-issue', quantity: '1', reservationId: null },
    });
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    renderScreen({ canOperate: true, canReadWorkOrder: false });
    await chooseRequirement(user);
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    expect(listRequiredParts).not.toHaveBeenCalled();
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.issue.quantity')), '1');
    const line = within(form).getByLabelText(
      labelled('inventory.parts.requiredPartReference.label')
    );
    await user.type(line, 'line-1');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['inventory.parts.requiredPartReference.format'] as string)
    ).toBeVisible();
    expect(createIssue).not.toHaveBeenCalled();
    await user.clear(line);
    await user.type(line, REQUIRED_PART_ID);
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    await waitFor(() => expect(createIssue).toHaveBeenCalled());
    // The requirement names the item, which the reference box opened on.
    expect(createIssue.mock.calls[0]?.[0]).toMatchObject({
      itemId: ITEM_ID,
      requiredPartRef: REQUIRED_PART_ID,
    });
  });

  it('a required part carried from "Issue" stays linked while the job’s list cannot be read, and is not sent once the operator unlinks it (route sweep B2 review)', async () => {
    const user = userEvent.setup();
    // Refused, so the form stays open for the second attempt below.
    createIssue.mockResolvedValue({
      state: { status: 'failed', messageKey: 'action.failed', attempt: 1 },
    });
    renderScreen({ canOperate: true, canReadItems: true });
    await chooseRequirement(user);
    const issueThis = await within(requiredRegion()).findByRole('button', {
      name: EN['inventory.parts.required.issueThis'] as string,
    });
    // The panel's list answered; the form's own read of the same list does not.
    listRequiredParts.mockImplementation(async () => ({
      status: 'unavailable',
      correlationId: 'ref-503',
    }));
    await user.click(issueThis);
    const form = await issueForm();
    const carried = await within(form).findByText(
      (EN['inventory.issue.requiredPartCarried'] as string).replace('{part}', 'Front brake pads'),
      { exact: false }
    );
    expect(carried).toBeVisible();
    expect(carried).toHaveTextContent(EN['inventory.parts.required.unavailable'] as string);
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    const submit = () =>
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string });
    await user.click(submit());
    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(1));
    // Kept, and sent: never dropped because the select had nothing to show it in.
    expect(createIssue.mock.calls[0]?.[0]).toMatchObject({ requiredPartRef: REQUIRED_PART_ID });

    // The operator's own choice: unlinked, the line is not sent.
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.issue.requiredPartUnlink'] as string,
      })
    );
    expect(
      within(form).queryByRole('button', {
        name: EN['inventory.issue.requiredPartUnlink'] as string,
      })
    ).toBeNull();
    await user.click(submit());
    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(2));
    expect(createIssue.mock.calls[1]?.[0]).not.toHaveProperty('requiredPartRef');
  });

  it('a carried part the job’s list no longer holds is said to be dropped, not dropped silently (route sweep B2 review)', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: true, canReadItems: true });
    await chooseRequirement(user);
    const issueThis = await within(requiredRegion()).findByRole('button', {
      name: EN['inventory.parts.required.issueThis'] as string,
    });
    listRequiredParts.mockImplementation(async () => okRead({ items: [] }));
    createIssue.mockResolvedValue({
      state: { status: 'failed', messageKey: 'action.failed', attempt: 1 },
    });
    await user.click(issueThis);
    const form = await issueForm();
    expect(
      await within(form).findByText(EN['inventory.issue.requiredPartGone'] as string)
    ).toBeVisible();
    // Said to be dropped, and dropped: the draw goes out without the line
    // (route sweep B3, the carried review nit).
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(1));
    expect(createIssue.mock.calls[0]?.[0]).not.toHaveProperty('requiredPartRef');
  });

  it('a required part carried from "Issue" stays linked while the job’s list is still being read, and is shown in the select once it answers (route sweep B3)', async () => {
    const user = userEvent.setup();
    createIssue.mockResolvedValue({
      state: { status: 'failed', messageKey: 'action.failed', attempt: 1 },
    });
    renderScreen({ canOperate: true, canReadItems: true });
    await chooseRequirement(user);
    const issueThis = await within(requiredRegion()).findByRole('button', {
      name: EN['inventory.parts.required.issueThis'] as string,
    });
    // The form's own read of the job's list is held open.
    let answer: (value: unknown) => void = () => undefined;
    listRequiredParts.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    await user.click(issueThis);
    const form = await issueForm();
    const carried = await within(form).findByText(
      (EN['inventory.issue.requiredPartCarried'] as string).replace('{part}', 'Front brake pads'),
      { exact: false }
    );
    expect(carried).toBeVisible();
    // Still loading is not a refusal: no refusal is said beside it.
    expect(carried).not.toHaveTextContent(EN['inventory.parts.required.unavailable'] as string);
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.location')),
      LOCATION_ID
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    );
    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(1));
    // Sent while the list was still being read: never dropped for want of a select.
    expect(createIssue.mock.calls[0]?.[0]).toMatchObject({ requiredPartRef: REQUIRED_PART_ID });

    answer(okRead({ items: [{ ...requiredPart }] }));
    await waitFor(() =>
      expect(
        within(form).getByRole('combobox', { name: labelled('inventory.issue.requiredPart') })
      ).toHaveValue(REQUIRED_PART_ID)
    );
  });

  it('a late reply for an earlier item search is not drawn under a later one (route sweep B2 review)', async () => {
    const held: Record<string, ((value: unknown) => void)[]> = { BR: [], BRK: [] };
    const found = (sku: string, name: string) =>
      page([
        {
          id: sku === 'BRK-001' ? ITEM_ID : '14141414-1414-4414-8414-141414141414',
          itemCategoryId: 'cat',
          sku,
          name,
          description: null,
          unitOfMeasure: { id: 'u', code: 'EA' },
          itemType: 'part',
          isStockTracked: true,
          isSerialized: false,
          lifecycleStatus: 'active',
          recordVersion: 1,
        },
      ]);
    listItems.mockImplementation(
      (criteria: { search: string }) =>
        new Promise((resolve) => held[criteria.search]?.push(resolve))
    );
    const user = userEvent.setup();
    renderScreen({ canOperate: true, canReadItems: true });
    await chooseRequirement(user);
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    const box = within(form).getByLabelText(EN['inventory.issue.item'] as string);
    await user.type(box, 'BR{Enter}');
    await waitFor(() => expect(held['BR']?.length).toBeGreaterThan(0));
    await user.type(box, 'K{Enter}');
    await waitFor(() => expect(held['BRK']?.length).toBeGreaterThan(0));
    for (const resolve of held['BRK'] ?? []) resolve(found('BRK-001', 'Brake pad'));
    expect(await within(form).findByRole('button', { name: 'BRK-001 — Brake pad' })).toBeVisible();
    for (const resolve of held['BR'] ?? []) resolve(found('BRA-900', 'Bracket'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(form).queryByRole('button', { name: /BRA-900/ })).toBeNull();
  });

  it('with the catalogue read, the reserve form opens on the item the requirement names, in words', async () => {
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    renderScreen({ canOperate: true, canReadItems: true });
    await chooseRequirement(user);
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.parts.reserve.heading'] as string,
    });
    expect(within(form).getByTestId('parts-reserve-item-picker-chosen')).toHaveTextContent(
      EN['inventory.itemPicker.fromRequirement'] as string
    );
    expect(within(form).queryByDisplayValue(ITEM_ID)).toBeNull();
  });
});

describe('FE-012 — returning', () => {
  it('returns against the issue only, and states the server’s running figures above the panels', async () => {
    const user = userEvent.setup();
    createReturn.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.return.success', attempt: 1 },
      created: {
        id: 'ret-1',
        partIssueId: ISSUE_ID,
        quantity: '0.500',
        totalReturned: '1.500',
        issuedQuantity: '2.500',
      },
    });
    renderScreen({ canOperate: true });
    const table = await within(issuesRegion()).findByRole('table');
    await user.click(
      within(table).getByRole('button', { name: EN['inventory.return.action'] as string })
    );
    const form = await screen.findByRole('form', { name: labelled('inventory.return.heading') });
    expect(
      within(form).getByText(EN['inventory.return.issuedLabel'] as string, { exact: false })
    ).toBeVisible();
    await user.type(within(form).getByLabelText(labelled('inventory.return.quantity')), '0.5');
    await user.type(within(form).getByLabelText(labelled('inventory.return.reason')), 'not needed');
    const before = listPartIssues.mock.calls.length;
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.return.submit'] as string })
    );
    await waitFor(() => expect(createReturn).toHaveBeenCalled());
    expect(createReturn.mock.calls[0]?.[0]).toEqual({
      partIssueId: ISSUE_ID,
      quantity: '0.5',
      reason: 'not needed',
    });
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(EN['inventory.return.recorded'] as string);
    expect(note).toHaveTextContent('0.500');
    expect(note).toHaveTextContent('1.500');
    expect(note).toHaveTextContent('2.500');
    await waitFor(() => expect(listPartIssues.mock.calls.length).toBeGreaterThan(before));
  });

  it('an over-return refused by the server is a refusal in the form', async () => {
    const user = userEvent.setup();
    createReturn.mockResolvedValue({
      state: {
        status: 'conflict',
        messageKey: 'state.conflict.title',
        attempt: 1,
        correlationId: 'ref-77',
      },
      created: null,
    });
    renderScreen({ canOperate: true });
    const table = await within(issuesRegion()).findByRole('table');
    await user.click(
      within(table).getByRole('button', { name: EN['inventory.return.action'] as string })
    );
    const form = await screen.findByRole('form', { name: labelled('inventory.return.heading') });
    await user.type(within(form).getByLabelText(labelled('inventory.return.quantity')), '9');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.return.submit'] as string })
    );
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('ref-77');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the /inventory/parts route page decides before it reads', () => {
  it('refuses without inv.stock.read, and reads nothing — not even the work order', async () => {
    PERMISSIONS = ['wo.work_order.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(listPartIssues).not.toHaveBeenCalled();
  });

  it('with wo.work_order.read but a refused read, says the read was refused and still lists', async () => {
    PERMISSIONS = ['inv.stock.read', 'wo.work_order.read'];
    readWorkOrderDetail.mockImplementation(async () => ({
      status: 'denied',
      correlationId: 'ref-wo',
    }));
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(screen.getByText(EN['inventory.parts.workOrderRefused'] as string)).toBeVisible();
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
  });

  it('reads the work order only with wo.work_order.read, and lists either way', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(screen.getByText(EN['inventory.parts.workOrderNotReadable'] as string)).toBeVisible();
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    expect(listRequiredParts).not.toHaveBeenCalled();
  });

  it('with wo.work_order.read names the work order and lists the required parts; with operate, offers issuing', async () => {
    PERMISSIONS = ['inv.stock.read', 'wo.work_order.read', 'inv.stock.operate'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(screen.getByText('WO-000042')).toBeVisible();
    await waitFor(() => expect(listRequiredParts).toHaveBeenCalledWith(WORK_ORDER_ID));
    expect(
      screen.getByRole('button', { name: EN['inventory.issue.open'] as string })
    ).toBeVisible();
  });

  it('without a work order in the address, offers the chooser', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await renderPage({ locale: 'en' });
    expect(screen.getByText(EN['inventory.parts.choose.explain'] as string)).toBeVisible();
    expect(listPartIssues).not.toHaveBeenCalled();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound');
  });
});

describe('Arabic, right to left', () => {
  it('renders the issues in Arabic with the same behaviour', async () => {
    renderRtl(
      <PartsScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        workOrderRefused={false}
        canOperate={false}
        canReadWorkOrder={false}
        canReadBranches={false}
        currentUserId={USER_ID}
        canRequestMaterial={false}
        canApproveMaterial={false}
        canDecideMaterialException={false}
      />
    );
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    const table = await screen.findByRole('table');
    expect(within(table).getByText('2.500')).toBeVisible();
    expect(screen.getByText(AR['inventory.parts.issues.heading'] as string)).toBeVisible();
  });
});

/**
 * P1-32 — a work-order draw is measured against a material requirement.
 *
 * The properties under test: neither draw form can be submitted before a
 * requirement is chosen and both say so with the act to perform first; choosing
 * one sends its identifier with the draw; a refusal the server published as a
 * material-draw reason is rendered as a plain sentence naming the next step; and
 * the material request a governed draw opened can be settled or withdrawn.
 */
describe('a work-order draw needs a requirement', () => {
  const reserveForm = () =>
    screen.findByRole('form', { name: EN['inventory.parts.reserve.heading'] as string });

  it('offers no submit until a requirement is chosen, and names the act to do first', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: true, canReadWorkOrder: false });
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await reserveForm();
    expect(
      within(form).getByRole('button', { name: EN['inventory.parts.reserve.submit'] as string })
    ).toBeDisabled();
    expect(
      within(form).getByText(EN['inventory.parts.draw.needRequirement'] as string)
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const issue = await issueForm();
    expect(
      within(issue).getByRole('button', { name: EN['inventory.issue.submit'] as string })
    ).toBeDisabled();
    expect(createReservation).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('sends the chosen requirement with the reservation', async () => {
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    createReservation.mockImplementation(async () => ({
      state: { status: 'success', messageKey: 'inventory.reserve.success' },
      created: {
        id: RESERVATION_ID,
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        workOrderId: WORK_ORDER_ID,
        quantity: '1.000',
        status: 'active',
        expiresAt: null,
        recordVersion: 1,
        materialRequestId: MATERIAL_REQUEST_ID,
        replayed: false,
      },
    }));
    renderScreen({ canOperate: true, canReadWorkOrder: false });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.use'] as string })
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await reserveForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '1.000');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.parts.reserve.submit'] as string })
    );

    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(createReservation.mock.calls[0]?.[0]).toMatchObject({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '1.000',
      workOrderId: WORK_ORDER_ID,
      materialRequirementId: REQUIREMENT_ID,
    });
  });

  it('states a reservation drawn on another service line beside the requirement, keeping the entry', async () => {
    // The refusal is published against `body.materialRequirementId`, and the
    // requirement note is the only place on this form that names one.
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    createReservation.mockImplementation(async () => ({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { materialRequirementId: 'form.violation.other_requirement' },
        attempt: 1,
      },
      created: null,
    }));
    renderScreen({ canOperate: true, canReadWorkOrder: false });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.use'] as string })
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await reserveForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '1.000');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.parts.reserve.submit'] as string })
    );

    expect(
      await within(form).findByText(EN['form.violation.other_requirement'] as string)
    ).toBeVisible();
    expect(within(form).getByLabelText(labelled('inventory.reserve.quantity'))).toHaveValue(
      '1.000'
    );
  });

  it('renders a refused draw as the reason the server published, with its next step', async () => {
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    createReservation.mockImplementation(async () => ({
      state: {
        status: 'error',
        messageKey: 'inventory.refusal.materialDraw.exceeds_requirement',
        correlationId: 'corr',
      },
      created: null,
    }));
    renderScreen({ canOperate: true, canReadWorkOrder: false });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.use'] as string })
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await reserveForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '9.000');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.parts.reserve.submit'] as string })
    );

    const refusal = await screen.findByRole('alert');
    expect(refusal).toHaveTextContent(
      EN['inventory.refusal.materialDraw.exceeds_requirement'] as string
    );
    // The sentence names the remedy, not a code.
    expect(EN['inventory.refusal.materialDraw.exceeds_requirement']).toContain('exception');
  });

  it('spends the three figures and their unit when the server published them', async () => {
    // CC-OD-32. "More than the work order is approved to use" left the operator
    // to guess by how much. The figures are the server's strings, filled into
    // the sentence by the catalogue; nothing here is added up in the browser.
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    createReservation.mockImplementation(async () => ({
      state: {
        status: 'error',
        messageKey: 'inventory.refusal.materialDraw.exceeds_requirement.figures',
        messageValues: {
          allowance: '4.000',
          used: '3.500',
          requested: '9.000',
          unit: 'L',
        },
        correlationId: 'corr',
      },
      created: null,
    }));
    renderScreen({ canOperate: true, canReadWorkOrder: false });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.use'] as string })
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await reserveForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '9.000');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.parts.reserve.submit'] as string })
    );

    const refusal = await screen.findByRole('alert');
    expect(refusal).toHaveTextContent('approved 4.000 L');
    expect(refusal).toHaveTextContent('already used 3.500 L');
    expect(refusal).toHaveTextContent('requested 9.000 L');
    // A placeholder left on screen is the defect this case was written against.
    expect(refusal.textContent ?? '').not.toContain('{');
    // What the operator typed is still there to correct.
    expect(within(form).getByLabelText(labelled('inventory.reserve.quantity'))).toHaveValue(
      '9.000'
    );
  });

  it('says the same refusal in Arabic, figures and all', async () => {
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    createReservation.mockImplementation(async () => ({
      state: {
        status: 'error',
        messageKey: 'inventory.refusal.materialDraw.exceeds_requirement.figures',
        messageValues: {
          allowance: '4.000',
          used: '3.500',
          requested: '9.000',
          unit: 'L',
        },
        correlationId: 'corr',
      },
      created: null,
    }));
    renderRtl(
      <PartsScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        workOrderRefused={false}
        canOperate={true}
        canReadWorkOrder={false}
        canReadBranches={false}
        currentUserId={USER_ID}
        canRequestMaterial={false}
        canApproveMaterial={false}
        canDecideMaterialException={false}
      />
    );

    await user.click(
      await screen.findByRole('button', { name: AR['inventory.material.use'] as string })
    );
    await user.click(
      screen.getByRole('button', { name: AR['inventory.parts.reserve.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: AR['inventory.parts.reserve.heading'] as string,
    });
    await user.selectOptions(
      within(form).getByLabelText(
        new RegExp(`^${escape(AR['inventory.reserve.location'] as string)}`)
      ),
      LOCATION_ID
    );
    await user.type(
      within(form).getByLabelText(
        new RegExp(`^${escape(AR['inventory.reserve.quantity'] as string)}`)
      ),
      '9.000'
    );
    await user.click(
      within(form).getByRole('button', { name: AR['inventory.parts.reserve.submit'] as string })
    );

    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent ?? '').toContain('4.000 L');
    expect(refusal.textContent ?? '').toContain('3.500 L');
    expect(refusal.textContent ?? '').toContain('9.000 L');
    expect(refusal.textContent ?? '').not.toContain('{');
    expect(refusal).not.toHaveTextContent(
      EN['inventory.refusal.materialDraw.exceeds_requirement.figures'] as string
    );
  });

  it('settles the material the draw opened, naming that request', async () => {
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    createReservation.mockImplementation(async () => ({
      state: { status: 'success', messageKey: 'inventory.reserve.success' },
      created: {
        id: RESERVATION_ID,
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        workOrderId: WORK_ORDER_ID,
        quantity: '1.000',
        status: 'active',
        expiresAt: null,
        recordVersion: 1,
        materialRequestId: MATERIAL_REQUEST_ID,
        replayed: false,
      },
    }));
    closeMaterialRequest.mockImplementation(async () => ({
      state: { status: 'success', messageKey: 'inventory.material.request.close.success' },
      created: null,
    }));
    renderScreen({ canOperate: true, canReadWorkOrder: false });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.use'] as string })
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await reserveForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '1.000');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.parts.reserve.submit'] as string })
    );

    const region = await screen.findByRole('region', {
      name: EN['inventory.parts.request.heading'] as string,
    });
    expect(within(region).getByText(MATERIAL_REQUEST_ID)).toBeVisible();
    await user.click(
      within(region).getByRole('button', { name: EN['inventory.parts.request.close'] as string })
    );
    await waitFor(() => expect(closeMaterialRequest).toHaveBeenCalledWith(MATERIAL_REQUEST_ID, {}));
    expect(cancelMaterialRequest).not.toHaveBeenCalled();
  });

  it('refuses to withdraw the material without a reason', async () => {
    const user = userEvent.setup();
    listMaterialRequirements.mockImplementation(async () =>
      okRead({ items: [materialRequirement()], nextCursor: null, hasMore: false })
    );
    createReservation.mockImplementation(async () => ({
      state: { status: 'success', messageKey: 'inventory.reserve.success' },
      created: {
        id: RESERVATION_ID,
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        workOrderId: WORK_ORDER_ID,
        quantity: '1.000',
        status: 'active',
        expiresAt: null,
        recordVersion: 1,
        materialRequestId: MATERIAL_REQUEST_ID,
        replayed: false,
      },
    }));
    renderScreen({ canOperate: true, canReadWorkOrder: false });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.use'] as string })
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.reserve.open'] as string })
    );
    const form = await reserveForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '1.000');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.parts.reserve.submit'] as string })
    );

    const region = await screen.findByRole('region', {
      name: EN['inventory.parts.request.heading'] as string,
    });
    await user.click(
      within(region).getByRole('button', { name: EN['inventory.parts.request.cancel'] as string })
    );
    expect(cancelMaterialRequest).not.toHaveBeenCalled();
    expect(within(region).getByText(EN['field.required'] as string)).toBeVisible();
  });
});
