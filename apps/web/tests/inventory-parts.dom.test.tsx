import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

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
const listRequiredParts = vi.fn();
const listReservations = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const createIssue = vi.fn();
const createReturn = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listPartIssues: (...args: unknown[]) => listPartIssues(...args),
  listRequiredParts: (...args: unknown[]) => listRequiredParts(...args),
  listReservations: (...args: unknown[]) => listReservations(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  createIssue: (...args: unknown[]) => createIssue(...args),
  createReturn: (...args: unknown[]) => createReturn(...args),
  listItems: vi.fn(),
  listAvailability: vi.fn(),
  listMovements: vi.fn(),
  createReservation: vi.fn(),
  releaseReservation: vi.fn(),
}));

const readWorkOrderDetail = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
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
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
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
});

describe('reached from a work order', () => {
  it('without a work order, explains and takes an identifier', async () => {
    const user = userEvent.setup();
    renderScreen({ workOrderId: null, workOrder: null });
    expect(screen.getByText(EN['inventory.parts.choose.explain'] as string)).toBeVisible();
    expect(listPartIssues).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText(labelled('inventory.parts.choose.workOrderId')),
      WORK_ORDER_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.parts.choose.submit'] as string })
    );
    expect(push).toHaveBeenCalledWith(`/en/inventory/parts?workOrderId=${WORK_ORDER_ID}`);
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
    await user.click(
      await within(requiredRegion()).findByRole('button', {
        name: EN['inventory.parts.required.issueThis'] as string,
      })
    );
    const form = await issueForm();
    expect(within(form).getByLabelText(labelled('inventory.issue.itemId'))).toHaveValue(ITEM_ID);
    expect(within(form).getByLabelText(labelled('inventory.issue.requiredPartRef'))).toHaveValue(
      REQUIRED_PART_ID
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
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    await within(form).findByRole('option', { name: 'BRK-001 — WH-1 — 2.000' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.issue.reservation')),
      RESERVATION_ID
    );
    expect(within(form).getByLabelText(labelled('inventory.issue.itemId'))).toHaveValue(ITEM_ID);
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
      reservationId: RESERVATION_ID,
    });
    expect(typeof (createIssue.mock.calls[0]?.[0] as { quantity: unknown }).quantity).toBe(
      'string'
    );
  });

  it('refuses a zero quantity before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: true });
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    await user.type(within(form).getByLabelText(labelled('inventory.issue.itemId')), ITEM_ID);
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
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    await user.type(within(form).getByLabelText(labelled('inventory.issue.itemId')), ITEM_ID);
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

  it('when the work order cannot be read, takes the branch as identifiers and requests no list', async () => {
    const user = userEvent.setup();
    renderScreen({
      canOperate: true,
      canReadWorkOrder: false,
      workOrder: null,
      canReadBranches: false,
    });
    await user.click(screen.getByRole('button', { name: EN['inventory.issue.open'] as string }));
    const form = await issueForm();
    expect(within(form).getByText(EN['inventory.issue.branchUnknown'] as string)).toBeVisible();
    expect(listBranches).not.toHaveBeenCalled();
    expect(listLocations).not.toHaveBeenCalled();
    await user.type(
      within(form).getByLabelText(labelled('inventory.common.companyIdField')),
      COMPANY_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.common.branchIdField')),
      BRANCH_ID
    );
    await waitFor(() =>
      expect(listLocations).toHaveBeenCalledWith({ companyId: COMPANY_ID, branchId: BRANCH_ID })
    );
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await waitFor(() => expect(listReservations).toHaveBeenCalledTimes(1));
    // Once the pair is complete the locations are read ONCE — not on every
    // render the answer itself causes, and not again when another field changes.
    expect(listLocations).toHaveBeenCalledTimes(1);
    await user.type(within(form).getByLabelText(labelled('inventory.issue.itemId')), ITEM_ID);
    await user.type(within(form).getByLabelText(labelled('inventory.issue.quantity')), '1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listLocations).toHaveBeenCalledTimes(1);
    expect(listReservations).toHaveBeenCalledTimes(1);
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
      />
    );
    await waitFor(() => expect(listPartIssues).toHaveBeenCalled());
    const table = await screen.findByRole('table');
    expect(within(table).getByText('2.500')).toBeVisible();
    expect(screen.getByText(AR['inventory.parts.issues.heading'] as string)).toBeVisible();
  });
});
