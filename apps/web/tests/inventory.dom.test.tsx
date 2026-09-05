import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Inventory, rendered (P1-30, `W4`, FE-008/009/010).
 *
 * The properties under test: the item search reads on first paint and a
 * refusal is never "no items"; no stock read is issued until a branch is
 * named, and every one is addressed to that branch; availability cells are
 * the server's strings, shown as they are, with quarantine excluded until
 * asked for; reserving sends the quantity as typed and a replay is stated as
 * one; releasing is offered only on an active reservation to an operator
 * who may; and the route page decides before it reads.
 *
 * Labels are matched ANCHORED (the field frame decorates them) and scoped to
 * the region they live in — three panels share "Item identifier".
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listItems = vi.fn();
const listAvailability = vi.fn();
const listReservations = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const createReservation = vi.fn();
const releaseReservation = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listItems: (...args: unknown[]) => listItems(...args),
  listAvailability: (...args: unknown[]) => listAvailability(...args),
  listReservations: (...args: unknown[]) => listReservations(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  createReservation: (...args: unknown[]) => createReservation(...args),
  releaseReservation: (...args: unknown[]) => releaseReservation(...args),
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

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { InventoryScreen } = await import('@/features/inventory/components/InventoryScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const InventoryPage = (await import('@/app/[locale]/(dashboard)/inventory/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const RESERVATION_ID = '55555555-5555-4555-8555-555555555555';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';

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
const cell = {
  itemId: ITEM_ID,
  sku: 'BRK-001',
  locationId: LOCATION_ID,
  locationCode: 'WH-1',
  locationType: 'warehouse',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  onHand: '12.500',
  reserved: '2.000',
  available: '10.500',
};
function reservation(over: Record<string, unknown> = {}) {
  return {
    id: RESERVATION_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    itemId: ITEM_ID,
    sku: 'BRK-001',
    locationId: LOCATION_ID,
    locationCode: 'WH-1',
    workOrderId: null,
    quantity: '2.000',
    status: 'active',
    expiresAt: null,
    createdAt: '2026-09-01T08:00:00Z',
    recordVersion: 1,
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
const denied = () => ({
  status: 'denied' as const,
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr',
});
const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <InventoryScreen
      locale="en"
      messages={en}
      initialWorkOrderId={null}
      canReadStock={false}
      canOperate={false}
      canReadBranches={false}
      {...over}
    />
  );
}

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await InventoryPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

const region = (key: string) => screen.getByRole('region', { name: EN[key] as string });
const targetForm = () =>
  screen.getByRole('form', { name: EN['inventory.target.formLabel'] as string });

/** Chooses the one listed branch and asks for its stock. */
async function chooseBranch(user: ReturnType<typeof userEvent.setup>) {
  // Until the branch list arrives the picker is two identifier fields, one of
  // them labelled "Branch identifier" — an anchored "Branch" would match it.
  const select = await within(targetForm()).findByRole('combobox');
  await user.selectOptions(select, BRANCH_ID);
  await user.click(
    within(targetForm()).getByRole('button', { name: EN['inventory.target.show'] as string })
  );
  await waitFor(() => expect(listAvailability).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listItems.mockResolvedValue(page([item]));
  listAvailability.mockResolvedValue(page([cell]));
  listReservations.mockResolvedValue(page([reservation()]));
  listLocations.mockResolvedValue(okRead({ items: [location], nextCursor: null, hasMore: false }));
  listBranches.mockResolvedValue(okRead({ items: [branch] }));
});

describe('FE-008 — the item search', () => {
  it('reads on first paint and shows the catalogue without any cost', async () => {
    renderScreen();
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(listItems.mock.calls[0]?.[0]).toEqual({});
    const table = await within(region('inventory.items.heading')).findByRole('table');
    expect(within(table).getByText('BRK-001')).toBeVisible();
    expect(within(table).getByText('Brake pad')).toBeVisible();
    expect(within(table).getByText('EA')).toBeVisible();
    expect(within(table).getByText(EN['inventory.itemType.part'] as string)).toBeVisible();
    expect(within(table).getByText(EN['inventory.items.tracked'] as string)).toBeVisible();
    expect(within(table).getByText(EN['inventory.lifecycle.active'] as string)).toBeVisible();
    expect(within(table).queryByText(/cost|price/i)).toBeNull();
    expect(screen.getByText(EN['inventory.items.noCostNote'] as string)).toBeVisible();
  });

  it('sends the typed search and chosen type as criteria', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    const items = region('inventory.items.heading');
    await user.type(within(items).getByLabelText(labelled('inventory.items.search')), 'brake');
    await user.selectOptions(
      within(items).getByLabelText(labelled('inventory.items.type')),
      'part'
    );
    await user.click(within(items).getByLabelText(labelled('inventory.items.trackedOnly')));
    await user.click(
      within(items).getByRole('button', { name: EN['inventory.items.show'] as string })
    );
    await waitFor(() =>
      expect(listItems.mock.calls.at(-1)?.[0]).toEqual({
        search: 'brake',
        itemType: 'part',
        stockTrackedOnly: 'true',
      })
    );
  });

  it('refuses a malformed category identifier before reading', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    const items = region('inventory.items.heading');
    await user.type(within(items).getByLabelText(labelled('inventory.items.categoryId')), 'nope');
    await user.click(
      within(items).getByRole('button', { name: EN['inventory.items.show'] as string })
    );
    expect(await within(items).findByText(EN['inventory.common.idFormat'] as string)).toBeVisible();
    expect(listItems).toHaveBeenCalledTimes(1);
  });

  it('renders the denied state instead of an empty catalogue', async () => {
    listItems.mockResolvedValue(denied());
    renderScreen();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['inventory.items.none'] as string)).toBeNull();
  });

  it('says there are none, and why there may be none, when the server answers none', async () => {
    listItems.mockResolvedValue(page([]));
    renderScreen();
    expect(await screen.findByText(EN['inventory.items.none'] as string)).toBeVisible();
  });
});

describe('FE-009 — stock is read only for a named branch', () => {
  it('without inv.stock.read, offers no stock and issues no stock read', async () => {
    renderScreen({ canReadStock: false });
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(screen.getByText(EN['inventory.stock.noPermission'] as string)).toBeVisible();
    expect(
      screen.queryByRole('form', { name: EN['inventory.target.formLabel'] as string })
    ).toBeNull();
    expect(listAvailability).not.toHaveBeenCalled();
    expect(listReservations).not.toHaveBeenCalled();
    expect(listLocations).not.toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('issues no stock read until a branch is chosen, then addresses every read to it', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: true });
    expect(targetForm()).toBeVisible();
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    expect(listAvailability).not.toHaveBeenCalled();
    expect(listReservations).not.toHaveBeenCalled();
    await chooseBranch(user);
    const target = { companyId: COMPANY_ID, branchId: BRANCH_ID };
    expect(listAvailability.mock.calls[0]?.[0]).toEqual(target);
    expect(listAvailability.mock.calls[0]?.[1]).toEqual({});
    await waitFor(() => expect(listReservations).toHaveBeenCalled());
    expect(listReservations.mock.calls[0]?.[0]).toEqual(target);
    await waitFor(() => expect(listLocations).toHaveBeenCalledWith(target));
  });

  it('without org.branch.read, takes the branch as two identifiers and requests no list', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: false });
    expect(listBranches).not.toHaveBeenCalled();
    const form = targetForm();
    await user.type(
      within(form).getByLabelText(labelled('inventory.common.companyIdField')),
      COMPANY_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.common.branchIdField')),
      'nope'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.target.show'] as string })
    );
    expect(await within(form).findByText(EN['inventory.common.idFormat'] as string)).toBeVisible();
    expect(listAvailability).not.toHaveBeenCalled();
    await user.clear(within(form).getByLabelText(labelled('inventory.common.branchIdField')));
    await user.type(
      within(form).getByLabelText(labelled('inventory.common.branchIdField')),
      BRANCH_ID
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.target.show'] as string })
    );
    await waitFor(() => expect(listAvailability).toHaveBeenCalled());
    expect(listAvailability.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
  });

  it('shows the three quantities exactly as the server sent them and sums nothing', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    const table = await within(region('inventory.availability.heading')).findByRole('table');
    expect(within(table).getByText('12.500')).toBeVisible();
    expect(within(table).getByText('2.000')).toBeVisible();
    expect(within(table).getByText('10.500')).toBeVisible();
    expect(within(table).getByText('WH-1')).toBeVisible();
    expect(within(table).getByText(EN['inventory.locationType.warehouse'] as string)).toBeVisible();
    expect(
      within(table).getByRole('columnheader', {
        name: EN['inventory.availability.column.available'] as string,
      })
    ).toBeVisible();
    expect(within(table).queryByText(/total/i)).toBeNull();
    expect(screen.getByText(EN['inventory.availability.cellNote'] as string)).toBeVisible();
  });

  it('excludes quarantine until asked for, then asks for it', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    expect(listAvailability.mock.calls[0]?.[1]).toEqual({});
    const availability = region('inventory.availability.heading');
    await user.click(
      within(availability).getByLabelText(labelled('inventory.availability.includeQuarantine'))
    );
    await user.click(
      within(availability).getByRole('button', {
        name: EN['inventory.availability.show'] as string,
      })
    );
    await waitFor(() =>
      expect(listAvailability.mock.calls.at(-1)?.[1]).toEqual({ includeQuarantine: 'true' })
    );
  });

  it('a refused stock read is a refusal, and says so where the read lives', async () => {
    const user = userEvent.setup();
    listAvailability.mockResolvedValue(denied());
    listLocations.mockResolvedValue({ status: 'denied' as const, correlationId: 'corr' });
    renderScreen({ canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    const availability = region('inventory.availability.heading');
    expect(await within(availability).findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(
      within(availability).queryByText(EN['inventory.availability.none'] as string)
    ).toBeNull();
    expect(
      await within(availability).findByText(EN['inventory.locations.refused'] as string)
    ).toBeVisible();
  });

  it('says when a branch has more locations than the picker can list', async () => {
    const user = userEvent.setup();
    listLocations.mockResolvedValue(
      okRead({ items: [location], nextCursor: 'more', hasMore: true })
    );
    renderScreen({ canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    expect(
      (await screen.findAllByText(EN['inventory.locations.truncated'] as string)).length
    ).toBeGreaterThan(0);
  });
});

describe('FE-010 — reservations', () => {
  it('lists the reservations of the branch with the quantity as a string and no work order named honestly', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    const table = await within(region('inventory.reservations.heading')).findByRole('table');
    expect(within(table).getByText('2.000')).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.reservationStatus.active'] as string)
    ).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.reservations.noWorkOrder'] as string)
    ).toBeVisible();
    expect(within(table).getByText(EN['inventory.reservations.noExpiry'] as string)).toBeVisible();
  });

  it('links a reservation to its work order when it has one', async () => {
    const user = userEvent.setup();
    listReservations.mockResolvedValue(page([reservation({ workOrderId: WORK_ORDER_ID })]));
    renderScreen({ canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    const table = await within(region('inventory.reservations.heading')).findByRole('table');
    const link = within(table).getByRole('link', { name: WORK_ORDER_ID });
    expect(link).toHaveAttribute('href', `/en/work-orders/${WORK_ORDER_ID}`);
  });

  it('prefills the work order from the address and filters by it from the first read', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: true, initialWorkOrderId: WORK_ORDER_ID });
    await chooseBranch(user);
    await waitFor(() => expect(listReservations).toHaveBeenCalled());
    expect(listReservations.mock.calls[0]?.[1]).toEqual({ workOrderId: WORK_ORDER_ID });
    expect(
      within(region('inventory.reservations.heading')).getByLabelText(
        labelled('inventory.reservations.workOrderId')
      )
    ).toHaveValue(WORK_ORDER_ID);
  });

  it('offers neither reserving nor releasing without inv.stock.operate', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: true, canOperate: false });
    await chooseBranch(user);
    const reservations = region('inventory.reservations.heading');
    await within(reservations).findByRole('table');
    expect(
      within(reservations).queryByRole('button', { name: EN['inventory.reserve.open'] as string })
    ).toBeNull();
    expect(
      within(reservations).queryByRole('button', { name: EN['inventory.release.action'] as string })
    ).toBeNull();
  });

  it('offers release only on an active reservation', async () => {
    const user = userEvent.setup();
    listReservations.mockResolvedValue(
      page([reservation(), reservation({ id: 'r-2', status: 'consumed', quantity: '1.000' })])
    );
    renderScreen({ canReadStock: true, canReadBranches: true, canOperate: true });
    await chooseBranch(user);
    const table = await within(region('inventory.reservations.heading')).findByRole('table');
    expect(
      within(table).getAllByRole('button', { name: EN['inventory.release.action'] as string })
    ).toHaveLength(1);
    expect(
      within(table).getByText(EN['inventory.reservationStatus.consumed'] as string)
    ).toBeVisible();
  });

  it('releases by identifier, says when the reservation had already ended, and re-reads', async () => {
    const user = userEvent.setup();
    releaseReservation.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.release.success', attempt: 1 },
      created: { id: RESERVATION_ID, status: 'released', replayed: true },
    });
    renderScreen({ canReadStock: true, canReadBranches: true, canOperate: true });
    await chooseBranch(user);
    const table = await within(region('inventory.reservations.heading')).findByRole('table');
    const before = listReservations.mock.calls.length;
    await user.click(
      within(table).getByRole('button', { name: EN['inventory.release.action'] as string })
    );
    await waitFor(() => expect(releaseReservation).toHaveBeenCalledWith(RESERVATION_ID, {}));
    expect(await screen.findByText(EN['inventory.release.replayed'] as string)).toBeVisible();
    await waitFor(() => expect(listReservations.mock.calls.length).toBeGreaterThan(before));
    expect(notifyActionResult).toHaveBeenCalled();
  });

  it('a refused release is shown beside the list with its reference', async () => {
    const user = userEvent.setup();
    releaseReservation.mockResolvedValue({
      state: {
        status: 'denied',
        messageKey: 'state.denied.title',
        attempt: 1,
        correlationId: 'ref-77',
      },
      created: null,
    });
    renderScreen({ canReadStock: true, canReadBranches: true, canOperate: true });
    await chooseBranch(user);
    const table = await within(region('inventory.reservations.heading')).findByRole('table');
    await user.click(
      within(table).getByRole('button', { name: EN['inventory.release.action'] as string })
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(EN['state.denied.title'] as string);
    expect(alert).toHaveTextContent('ref-77');
  });

  it('reserves with the quantity as typed, the chosen location and the work order, then states the booking', async () => {
    const user = userEvent.setup();
    createReservation.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.reserve.success', attempt: 1 },
      created: { id: 'new-res', quantity: '2.500', status: 'active', replayed: false },
    });
    renderScreen({
      canReadStock: true,
      canReadBranches: true,
      canOperate: true,
      initialWorkOrderId: WORK_ORDER_ID,
    });
    await chooseBranch(user);
    const reservations = region('inventory.reservations.heading');
    await user.click(
      within(reservations).getByRole('button', { name: EN['inventory.reserve.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.reserve.heading'] as string,
    });
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.itemId')), ITEM_ID);
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '2.5');
    expect(within(form).getByLabelText(labelled('inventory.reserve.workOrderId'))).toHaveValue(
      WORK_ORDER_ID
    );
    const before = listAvailability.mock.calls.length;
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.reserve.submit'] as string })
    );
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(createReservation.mock.calls[0]?.[0]).toEqual({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.5',
      workOrderId: WORK_ORDER_ID,
      idempotencyKey: expect.stringMatching(UUID_SHAPE),
    });
    expect(typeof (createReservation.mock.calls[0]?.[0] as { quantity: unknown }).quantity).toBe(
      'string'
    );
    // The screen re-reads availability rather than adjusting a figure itself.
    await waitFor(() => expect(listAvailability.mock.calls.length).toBeGreaterThan(before));
  });

  it('refuses a zero or malformed quantity before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen({ canReadStock: true, canReadBranches: true, canOperate: true });
    await chooseBranch(user);
    await user.click(
      within(region('inventory.reservations.heading')).getByRole('button', {
        name: EN['inventory.reserve.open'] as string,
      })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.reserve.heading'] as string,
    });
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.itemId')), ITEM_ID);
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '0');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.reserve.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['inventory.reserve.quantityFormat'] as string)
    ).toBeVisible();
    await user.clear(within(form).getByLabelText(labelled('inventory.reserve.quantity')));
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '1.2345');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.reserve.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['inventory.reserve.quantityFormat'] as string)
    ).toBeVisible();
    expect(createReservation).not.toHaveBeenCalled();
  });

  it('states a replayed reservation as a repeat, not a second booking', async () => {
    const user = userEvent.setup();
    createReservation.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.reserve.success', attempt: 1 },
      created: { id: 'same-res', quantity: '1.000', status: 'active', replayed: true },
    });
    renderScreen({ canReadStock: true, canReadBranches: true, canOperate: true });
    await chooseBranch(user);
    await user.click(
      within(region('inventory.reservations.heading')).getByRole('button', {
        name: EN['inventory.reserve.open'] as string,
      })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.reserve.heading'] as string,
    });
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.itemId')), ITEM_ID);
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.reserve.submit'] as string })
    );
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(EN['inventory.reserve.replayed'] as string);
    expect(note).toHaveTextContent('same-res');
  });

  it('a refused reservation is a refusal inside the form, with its reference', async () => {
    const user = userEvent.setup();
    createReservation.mockResolvedValue({
      state: {
        status: 'denied',
        messageKey: 'state.denied.title',
        attempt: 1,
        correlationId: 'ref-88',
      },
      created: null,
    });
    renderScreen({ canReadStock: true, canReadBranches: true, canOperate: true });
    await chooseBranch(user);
    await user.click(
      within(region('inventory.reservations.heading')).getByRole('button', {
        name: EN['inventory.reserve.open'] as string,
      })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.reserve.heading'] as string,
    });
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.itemId')), ITEM_ID);
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.reserve.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.reserve.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.reserve.submit'] as string })
    );
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(EN['state.denied.title'] as string);
    expect(alert).toHaveTextContent('ref-88');
    expect(screen.queryByRole('status')).toBeNull();
    // Pressing Reserve again after a refusal carries the SAME body key, so the
    // server can answer with the reservation already made instead of a second.
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.reserve.submit'] as string })
    );
    await waitFor(() => expect(createReservation).toHaveBeenCalledTimes(2));
    const first = createReservation.mock.calls[0]?.[0] as { idempotencyKey: string };
    const second = createReservation.mock.calls[1]?.[0] as { idempotencyKey: string };
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});

describe('the /inventory route page decides before it reads', () => {
  it('refuses without inv.item.read, and issues no read', async () => {
    PERMISSIONS = [];
    await renderPage({ locale: 'en' });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listItems).not.toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('with inv.item.read alone, searches items and offers no stock', async () => {
    PERMISSIONS = ['inv.item.read'];
    await renderPage({ locale: 'en' });
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(screen.getByText(EN['inventory.stock.noPermission'] as string)).toBeVisible();
    expect(
      screen.queryByRole('form', { name: EN['inventory.target.formLabel'] as string })
    ).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('with inv.stock.read and org.branch.read, offers the branch picker and lists branches', async () => {
    PERMISSIONS = ['inv.item.read', 'inv.stock.read', 'org.branch.read'];
    await renderPage({ locale: 'en' });
    expect(targetForm()).toBeVisible();
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    expect(listAvailability).not.toHaveBeenCalled();
  });

  it('carries a well-formed work order from the address into the reservations, and drops a malformed one', async () => {
    const user = userEvent.setup();
    PERMISSIONS = ['inv.item.read', 'inv.stock.read', 'org.branch.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    await chooseBranch(user);
    await waitFor(() => expect(listReservations).toHaveBeenCalled());
    expect(listReservations.mock.calls[0]?.[1]).toEqual({ workOrderId: WORK_ORDER_ID });
  });

  it('a malformed work order in the address is not sent', async () => {
    const user = userEvent.setup();
    PERMISSIONS = ['inv.item.read', 'inv.stock.read', 'org.branch.read'];
    await renderPage({ locale: 'en' }, { workOrderId: 'nope' });
    await chooseBranch(user);
    await waitFor(() => expect(listReservations).toHaveBeenCalled());
    expect(listReservations.mock.calls[0]?.[1]).toEqual({});
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['inv.item.read'];
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound');
  });
});

describe('Arabic, right to left', () => {
  it('renders the catalogue in Arabic with the same behaviour', async () => {
    renderRtl(
      <InventoryScreen
        locale="ar"
        messages={ar}
        initialWorkOrderId={null}
        canReadStock={false}
        canOperate={false}
        canReadBranches={false}
      />
    );
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(await screen.findByText(AR['inventory.items.heading'] as string)).toBeVisible();
    expect(screen.getByText(AR['inventory.stock.noPermission'] as string)).toBeVisible();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('BRK-001')).toBeVisible();
    expect(within(table).getByText(AR['inventory.itemType.part'] as string)).toBeVisible();
  });
});
