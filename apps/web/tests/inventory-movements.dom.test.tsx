import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import type { ReactElement } from 'react';
import {
  inBranch,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
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
import {
  DIRECTIONS,
  MOVEMENT_TYPES,
  REFERENCE_KINDS,
} from '@/features/inventory/inventory-contract';

/**
 * Stock movements, rendered (P1-30, `W5`, FE-013).
 *
 * The properties under test: the ledger reads the working branch's last seven
 * days on arrival (route sweep B2) and says the reading is recorded; every read
 * is addressed to the named branch; the rows render in the order served with
 * `sequence`, `quantity` and `signedQuantity` as the server's strings; a
 * location is named from the branch's own list; the item and the job are found
 * by name, or given as labelled references by a caller without the read; applied
 * filters are not unsaved work; instants travel as full ISO strings; and the
 * route page decides before it reads.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listMovements = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const listItems = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listMovements: (...args: unknown[]) => listMovements(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  // `./shared` names this export; this screen never calls it.
  listItemCategories: vi.fn(),
  listItems: (...args: unknown[]) => listItems(...args),
  listAvailability: vi.fn(),
  listReservations: vi.fn(),
  listPartIssues: vi.fn(),
  listRequiredParts: vi.fn(),
  createReservation: vi.fn(),
  releaseReservation: vi.fn(),
  createIssue: vi.fn(),
  createReturn: vi.fn(),
}));

const listWorkOrders = vi.fn();
const readWorkOrderDetail = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  listWorkOrders: (...args: unknown[]) => listWorkOrders(...args),
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

const { MovementsScreen } = await import('@/features/inventory/components/MovementsScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const MovementsPage = (await import('@/app/[locale]/(dashboard)/inventory/movements/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';

function movement(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    sequence: '1042',
    itemId: ITEM_ID,
    sku: 'BRK-001',
    locationId: LOCATION_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    movementType: 'issue',
    direction: 'out',
    quantity: '2.500',
    signedQuantity: '-2.500',
    reference: { kind: 'part_issue', id: 'pi-1' },
    occurredAt: '2026-09-01T08:00:00Z',
    correlationId: null,
    ...over,
  };
}
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
const branch = { id: BRANCH_ID, companyId: COMPANY_ID, branchCode: 'AMM-1', name: 'Amman' };

function page(rows: readonly unknown[]) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore: false, correlationId: 'corr' };
}
const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

const item = {
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
};
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

/** The instant the ledger's arrival window starts: local midnight, six days before today. */
function recentStart(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
}

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <MovementsScreen
      locale="en"
      messages={en}
      initialWorkOrderId={null}
      canReadBranches={true}
      {...over}
    />
  );
}

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await MovementsPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

const targetForm = () =>
  screen.getByRole('region', { name: EN['inventory.target.formLabel'] as string });
const ledger = () =>
  screen.getByRole('region', { name: EN['inventory.movements.heading'] as string });

/**
 * Wait for the branch this screen is addressed to.
 *
 * It used to choose one from a select and press a submit. Both are gone (Owner
 * directive, `P1-32-PRE-OD-UX`): the branch is the working context own named
 * selection, so the screen is addressed the moment it mounts and what is left
 * to do is wait for what follows.
 */
async function chooseBranch() {
  await screen.findByRole('region', { name: EN['inventory.movements.heading'] as string });
}

const showButton = () =>
  within(ledger()).getByRole('button', { name: EN['inventory.movements.show'] as string });

/** The read made on arrival, before anything is touched. */
async function firstRead() {
  await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  // Served deliberately OUT of sequence order: the screen must render the
  // order the server chose, so a client-side re-sort would fail the order case.
  listMovements.mockResolvedValue(
    page([
      movement({
        id: 'm-0',
        sequence: '1041',
        movementType: 'return',
        direction: 'in',
        quantity: '1.000',
        signedQuantity: '1.000',
        reference: { kind: 'part_return', id: 'pr-1' },
      }),
      movement(),
    ])
  );
  listLocations.mockResolvedValue(okRead({ items: [location], nextCursor: null, hasMore: false }));
  listBranches.mockResolvedValue(okRead({ items: [branch] }));
  listItems.mockResolvedValue(page([item]));
  listWorkOrders.mockResolvedValue(page([workOrder]));
  readWorkOrderDetail.mockResolvedValue(
    okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] })
  );
});

describe('the ledger reads the recent movements on arrival (route sweep B2)', () => {
  it('reads the working branch\u2019s last seven days on first paint, and says the reading is recorded', async () => {
    renderScreen();
    await chooseBranch();
    await firstRead();
    // The shell holds the named branches, so no directory is requested.
    expect(listBranches).not.toHaveBeenCalled();
    expect(listMovements.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    const criteria = listMovements.mock.calls[0]?.[1] as Record<string, string>;
    expect(Object.keys(criteria)).toEqual(['occurredFrom']);
    expect(Date.parse(criteria['occurredFrom'] as string)).toBe(recentStart());
    // The window is stated where it can be changed, not hidden.
    expect(within(ledger()).getByLabelText(labelled('inventory.movements.from'))).not.toHaveValue(
      ''
    );
    expect(within(ledger()).getByText(EN['inventory.movements.audited'] as string)).toBeVisible();
    expect(await within(ledger()).findByRole('table')).toBeVisible();
  });

  it('asking again with the same filters reads again — each read is the operator’s own act', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await firstRead();
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(2));
  });

  it('renders the rows in the order served with the server’s strings, and names the location from the branch list', async () => {
    renderScreen();
    await chooseBranch();
    const table = await within(ledger()).findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('1041')).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText('1042')).toBeVisible();
    expect(within(table).getByText('-2.500')).toBeVisible();
    expect(within(table).getByText('2.500')).toBeVisible();
    expect(within(table).getAllByText('1.000')).toHaveLength(2);
    expect(within(table).getByText(EN['inventory.movementType.issue'] as string)).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.referenceKind.part_return'] as string)
    ).toBeVisible();
    await waitFor(() => expect(within(table).getAllByText('Main warehouse')).toHaveLength(2));
    expect(within(table).getAllByText('WH-1')).toHaveLength(2);
    expect(within(table).queryByText(LOCATION_ID)).toBeNull();
    expect(
      within(ledger()).getByText(EN['inventory.movements.locationNote'] as string)
    ).toBeVisible();
  });

  it('a location the branch list does not hold is shown as the reference it is, never a name', async () => {
    const OTHER_LOCATION = '45454545-4545-4545-8545-454545454545';
    listMovements.mockResolvedValue(page([movement({ locationId: OTHER_LOCATION })]));
    renderScreen();
    await chooseBranch();
    const table = await within(ledger()).findByRole('table');
    expect(within(table).getByText(OTHER_LOCATION)).toHaveAttribute('dir', 'ltr');
  });

  it('sends the filters found by name, with instants as full ISO strings', async () => {
    const user = userEvent.setup();
    renderScreen({
      initialWorkOrderId: WORK_ORDER_ID,
      initialWorkOrder: workOrder,
      canReadWorkOrders: true,
      canReadItems: true,
    });
    await chooseBranch();
    await firstRead();
    const panel = ledger();
    expect(within(panel).getByTestId('movements-work-order-picker-chosen')).toHaveTextContent(
      'WO-000042'
    );
    expect((listMovements.mock.calls[0]?.[1] as Record<string, string>)['workOrderId']).toBe(
      WORK_ORDER_ID
    );
    await user.type(
      within(panel).getByLabelText(EN['inventory.movements.item'] as string),
      'BRK{Enter}'
    );
    await user.click(await within(panel).findByRole('button', { name: 'BRK-001 — Brake pad' }));
    // The panel itself is named "Movements", which an anchored "Movement" would match; the role narrows it.
    await user.selectOptions(
      within(panel).getByRole('combobox', { name: labelled('inventory.movements.type') }),
      'issue'
    );
    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.movements.referenceKind')),
      'part_issue'
    );
    await within(panel).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.movements.location')),
      LOCATION_ID
    );
    const from = within(panel).getByLabelText(labelled('inventory.movements.from'));
    await user.clear(from);
    await user.type(from, '2026-09-01T08:00');
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(2));
    const criteria = listMovements.mock.calls[1]?.[1] as Record<string, string>;
    expect(criteria).toMatchObject({
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      movementType: 'issue',
      referenceKind: 'part_issue',
    });
    expect(criteria['occurredFrom']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The instant sent is the one typed (zone-safe: both parsed the same way).
    expect(Date.parse(criteria['occurredFrom'] as string)).toBe(Date.parse('2026-09-01T08:00'));
    expect(criteria['occurredTo']).toBeUndefined();
  });

  it('without the item and job reads, keeps two labelled reference boxes and refuses a malformed one before asking', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await firstRead();
    const itemBox = within(ledger()).getByLabelText(labelled('inventory.itemPicker.reference'));
    expect(
      within(ledger()).getByLabelText(labelled('inventory.workOrderReference.label'))
    ).toBeVisible();
    await user.type(itemBox, 'nope');
    await user.click(showButton());
    expect(
      await within(ledger()).findByText(EN['inventory.itemPicker.referenceFormat'] as string)
    ).toBeVisible();
    expect(listMovements).toHaveBeenCalledTimes(1);
    await user.clear(itemBox);
    await user.type(itemBox, ITEM_ID);
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(2));
    expect((listMovements.mock.calls[1]?.[1] as Record<string, string>)['itemId']).toBe(ITEM_ID);
    // Neither lookup is attempted for a caller who may not make it.
    expect(listItems).not.toHaveBeenCalled();
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('a refused read is a refusal, never an empty ledger', async () => {
    listMovements.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr',
    });
    renderScreen();
    await chooseBranch();
    expect(await within(ledger()).findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(within(ledger()).queryByText(EN['inventory.movements.none'] as string)).toBeNull();
  });

  it('says there are none when the server answers none', async () => {
    listMovements.mockResolvedValue(page([]));
    renderScreen();
    await chooseBranch();
    expect(
      await within(ledger()).findByText(EN['inventory.movements.none'] as string)
    ).toBeVisible();
  });
});

describe('the item filter and the job from the link (route sweep B2 review)', () => {
  it('a job the page could not read can be read again, and an archived item can be chosen — the ledger still answers for both', async () => {
    const ARCHIVED_ID = '33333333-3333-4333-8333-333333333399';
    listItems.mockImplementation(async (criteria: { lifecycleStatus?: string }) =>
      page(
        criteria.lifecycleStatus === 'archived'
          ? [{ ...item, id: ARCHIVED_ID, sku: 'OLD-001', name: 'Retired pad' }]
          : [item]
      )
    );
    const user = userEvent.setup();
    readWorkOrderDetail.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'ref-503' });
    renderScreen({
      initialWorkOrderId: WORK_ORDER_ID,
      initialWorkOrder: null,
      canReadWorkOrders: true,
      canReadItems: true,
    });
    await chooseBranch();
    await firstRead();
    const panel = ledger();

    // The job from the link: a failure says so, with its reference, and keeps the offer.
    expect(
      within(panel).getByText(EN['inventory.workOrderLink.unreadable'] as string)
    ).toBeVisible();
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.workOrderLink.readAgain'] as string })
    );
    expect(await within(panel).findByText('ref-503')).toBeVisible();
    expect(readWorkOrderDetail).toHaveBeenLastCalledWith(WORK_ORDER_ID);
    // The next attempt answers: the job is chosen again.
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.workOrderLink.readAgain'] as string })
    );
    expect(
      await within(panel).findByTestId('movements-work-order-picker-chosen')
    ).toHaveTextContent('WO-000042');
    expect(
      within(panel).queryByText(EN['inventory.workOrderLink.unreadable'] as string)
    ).toBeNull();

    // The item: an archived one, found when asked for and labelled as such.
    await user.click(
      within(panel).getByRole('checkbox', {
        name: EN['inventory.itemPicker.searchArchived'] as string,
      })
    );
    await user.type(
      within(panel).getByLabelText(EN['inventory.movements.item'] as string),
      'OLD{Enter}'
    );
    await user.click(
      await within(panel).findByRole('button', { name: 'OLD-001 — Retired pad (archived)' })
    );
    expect(listItems).toHaveBeenCalledWith(
      { search: 'OLD', lifecycleStatus: 'archived' },
      expect.objectContaining({ pageSize: 10 }),
      null
    );

    // Both are applied on Show.
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(2));
    expect(listMovements.mock.calls[1]?.[1]).toMatchObject({
      workOrderId: WORK_ORDER_ID,
      itemId: ARCHIVED_ID,
    });
  });
});

describe('reading the job from the link again (route sweep B3)', () => {
  afterEach(forgetRememberedBranch);

  const OTHER_JOB = {
    ...workOrder,
    id: '42424242-4242-4424-8424-424242424242',
    displayNumber: 'WO-000077',
  };

  it('does not replace a job the operator chose while the read was out', async () => {
    const user = userEvent.setup();
    renderScreen({
      initialWorkOrderId: WORK_ORDER_ID,
      initialWorkOrder: null,
      canReadWorkOrders: true,
    });
    await chooseBranch();
    await firstRead();
    const panel = ledger();
    let answer: (value: unknown) => void = () => undefined;
    readWorkOrderDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.workOrderLink.readAgain'] as string })
    );
    // Meanwhile the operator finds and chooses another job.
    listWorkOrders.mockResolvedValue(page([OTHER_JOB]));
    await user.type(
      within(panel).getByLabelText(EN['inventory.movements.workOrder'] as string),
      'WO-77{Enter}'
    );
    await user.click(await within(panel).findByRole('button', { name: /WO-000077/ }));
    expect(within(panel).getByTestId('movements-work-order-picker-chosen')).toHaveTextContent(
      'WO-000077'
    );

    answer(okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] }));
    await waitFor(() =>
      expect(
        within(panel).queryByText(EN['inventory.workOrderLink.unreadable'] as string)
      ).toBeNull()
    );
    expect(within(panel).getByTestId('movements-work-order-picker-chosen')).toHaveTextContent(
      'WO-000077'
    );
  });

  it('drops an answer that lands after a branch switch replaced the panel', async () => {
    const user = userEvent.setup();
    readWorkOrderDetail.mockResolvedValue({ status: 'unavailable', correlationId: 'ref-503' });
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <MovementsScreen
            locale="en"
            messages={en}
            initialWorkOrderId={WORK_ORDER_ID}
            initialWorkOrder={null}
            canReadWorkOrders={true}
            canReadBranches={true}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await chooseBranch();
    let answer: (value: unknown) => void = () => undefined;
    readWorkOrderDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    await user.click(
      within(ledger()).getByRole('button', {
        name: EN['inventory.workOrderLink.readAgain'] as string,
      })
    );
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await chooseBranch();

    answer(okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The panel under the new branch still says the link could not be read,
    // and no job from the earlier panel's read is chosen in it.
    expect(within(ledger()).queryByTestId('movements-work-order-picker-chosen')).toBeNull();
    expect(
      within(ledger()).getByText(EN['inventory.workOrderLink.unreadable'] as string)
    ).toBeVisible();
  });
});

describe('filters being set and a branch switch', () => {
  /*
   * The ledger panel is keyed on the branch and its location filter names one of
   * this branch's locations, so a switch used to drop the filters without a word.
   * It now asks first; a confirmed switch opens the panel with its first filters.
   */
  afterEach(forgetRememberedBranch);

  async function openTwoBranches(user: ReturnType<typeof userEvent.setup>) {
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <MovementsScreen
            locale="en"
            messages={en}
            initialWorkOrderId={null}
            canReadBranches={true}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByRole('region', { name: EN['inventory.movements.heading'] as string });
  }
  const field = () =>
    within(ledger()).getByLabelText(labelled('inventory.itemPicker.reference')) as HTMLInputElement;

  it('asks before switching; staying keeps what was typed and the branch', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), 'BRK-001');
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(field().value).toBe('BRK-001');
  });

  it('discarding switches the branch and opens the form empty under it', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), 'BRK-001');
    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await screen.findByRole('region', { name: EN['inventory.movements.heading'] as string });
    expect(field().value).toBe('');
  });

  it('filters that were applied are not unsaved work: the switch goes through', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.selectOptions(
      within(ledger()).getByRole('combobox', { name: labelled('inventory.movements.type') }),
      'issue'
    );
    await user.click(showButton());
    await waitFor(() =>
      expect(listMovements.mock.calls.at(-1)?.[1]).toMatchObject({ movementType: 'issue' })
    );
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });

  it('a filter found by name and not yet applied still asks', async () => {
    const user = userEvent.setup();
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <MovementsScreen
            locale="en"
            messages={en}
            initialWorkOrderId={null}
            canReadItems={true}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByRole('region', { name: EN['inventory.movements.heading'] as string });
    await user.type(
      within(ledger()).getByLabelText(EN['inventory.movements.item'] as string),
      'BRK{Enter}'
    );
    await user.click(await within(ledger()).findByRole('button', { name: 'BRK-001 — Brake pad' }));
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    await user.click(showButton());
    await waitFor(() =>
      expect(listMovements.mock.calls.at(-1)?.[1]).toMatchObject({ itemId: ITEM_ID })
    );
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });

  it('an untouched form switches without asking', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });

  it('the arrival read of the previous branch is not drawn after a switch (route sweep B2 review)', async () => {
    const held: ((value: unknown) => void)[] = [];
    listMovements.mockImplementation((target: { branchId: string }) =>
      target.branchId === TEST_BRANCH.id
        ? new Promise((resolve) => held.push(resolve))
        : Promise.resolve(page([movement({ id: 'm-new', sequence: '2001' })]))
    );
    const user = userEvent.setup();
    await openTwoBranches(user);
    await waitFor(() => expect(held).toHaveLength(1));
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    expect(await within(ledger()).findByText('2001')).toBeVisible();
    // The first branch answers last: its rows belong to a branch no longer held.
    held[0]?.(page([movement({ id: 'm-old', sequence: '9999' })]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(ledger()).queryByText('9999')).toBeNull();
    expect(within(ledger()).getByText('2001')).toBeVisible();
  });
});

describe('the /inventory/movements route page decides before it reads', () => {
  it('refuses without inv.stock.read, and issues no read', async () => {
    PERMISSIONS = [];
    await renderPage({ locale: 'en' });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listBranches).not.toHaveBeenCalled();
    expect(listMovements).not.toHaveBeenCalled();
  });

  it('with inv.stock.read alone, states the branch and reads its recent movements', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await renderPage({ locale: 'en' });
    expect(targetForm()).toBeVisible();
    await firstRead();
    expect(listBranches).not.toHaveBeenCalled();
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
  });

  it('a well-formed work order in the address prefills the labelled reference without the job read', async () => {
    PERMISSIONS = ['inv.stock.read', 'org.branch.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    await chooseBranch();
    expect(listBranches).not.toHaveBeenCalled();
    expect(
      within(ledger()).getByLabelText(labelled('inventory.workOrderReference.label'))
    ).toHaveValue(WORK_ORDER_ID);
    await firstRead();
    expect((listMovements.mock.calls[0]?.[1] as Record<string, string>)['workOrderId']).toBe(
      WORK_ORDER_ID
    );
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
  });

  it('with the job and item reads, names the address\u2019s job and offers the item search', async () => {
    PERMISSIONS = ['inv.stock.read', 'inv.item.read', 'wo.work_order.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    await chooseBranch();
    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(await screen.findByTestId('movements-work-order-picker-chosen')).toHaveTextContent(
      'WO-000042'
    );
    expect(within(ledger()).getByLabelText(EN['inventory.movements.item'] as string)).toBeVisible();
  });

  it('a job the page could not read narrows nothing, and says so', async () => {
    PERMISSIONS = ['inv.stock.read', 'wo.work_order.read'];
    readWorkOrderDetail.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    await chooseBranch();
    await firstRead();
    expect((listMovements.mock.calls[0]?.[1] as Record<string, string>)['workOrderId']).toBe(
      undefined
    );
    expect(
      within(ledger()).getByText(EN['inventory.workOrderLink.unreadable'] as string)
    ).toBeVisible();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound');
  });
});

/**
 * DEF-T-05. The two vocabulary columns render through `translateDynamic`, which
 * answers with the KEY when the catalogue has no entry — so a value the schema
 * admits and the catalogue has never heard of reaches the operator as
 * `inventory.movementType.sale`. The check below is DERIVED from the contract
 * arrays rather than written out, so a value added to the mirror without a
 * label fails here instead of on a screen.
 */
describe('every movement vocabulary value has a label in both languages', () => {
  it('is not vacuous: the derived lists are non-empty', () => {
    expect(MOVEMENT_TYPES.length).toBeGreaterThan(0);
    expect(REFERENCE_KINDS.length).toBeGreaterThan(0);
    expect(DIRECTIONS.length).toBeGreaterThan(0);
  });

  it.each([
    ['inventory.movementType.', MOVEMENT_TYPES as readonly string[]],
    ['inventory.referenceKind.', REFERENCE_KINDS as readonly string[]],
    ['inventory.direction.', DIRECTIONS as readonly string[]],
  ])('labels every %s value in en and ar', (prefix, values) => {
    const missing = values
      .flatMap((value) => [
        EN[`${prefix}${value}`] === undefined ? `en:${prefix}${value}` : null,
        AR[`${prefix}${value}`] === undefined ? `ar:${prefix}${value}` : null,
      ])
      .filter((entry): entry is string => entry !== null);
    expect(missing, 'vocabulary values with no catalogue entry').toEqual([]);
  });

  it('renders a counter-sale row as words rather than as its keys', async () => {
    listMovements.mockResolvedValue(
      page([
        movement({
          id: 'm-sale',
          sequence: '1043',
          movementType: 'sale',
          direction: 'out',
          reference: { kind: 'invoice_line', id: 'il-1' },
        }),
      ])
    );
    renderScreen();
    await chooseBranch();
    const table = await within(ledger()).findByRole('table');
    expect(within(table).getByText(EN['inventory.movementType.sale'] as string)).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.referenceKind.invoice_line'] as string)
    ).toBeVisible();
    expect(within(table).queryByText('inventory.movementType.sale')).toBeNull();
    expect(within(table).queryByText('inventory.referenceKind.invoice_line')).toBeNull();
  });

  it('offers every vocabulary value as a filter choice', async () => {
    renderScreen();
    await chooseBranch();
    const panel = ledger();
    const types = within(panel).getByRole('combobox', {
      name: labelled('inventory.movements.type'),
    });
    const kinds = within(panel).getByLabelText(labelled('inventory.movements.referenceKind'));
    const optionValues = (element: HTMLElement) =>
      within(element)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value) => value.length > 0);
    expect(optionValues(types)).toEqual([...MOVEMENT_TYPES]);
    expect(optionValues(kinds)).toEqual([...REFERENCE_KINDS]);
  });
});

describe('Arabic, right to left', () => {
  it('renders in Arabic with the same behaviour', async () => {
    // The Arabic screen reads on arrival too, and states the window in Arabic.
    renderRtl(
      <MovementsScreen
        locale="ar"
        messages={ar}
        initialWorkOrderId={null}
        canReadBranches={false}
      />
    );
    expect(
      screen.getByText(AR['inventory.movements.explain'] as string, { exact: false })
    ).toBeVisible();
    expect(
      screen.getByRole('region', { name: AR['inventory.target.formLabel'] as string })
    ).toBeVisible();
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(1));
    expect(screen.getByText(AR['inventory.movements.fromHelp'] as string)).toBeVisible();
  });
});
