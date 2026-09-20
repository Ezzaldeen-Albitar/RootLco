/**
 * P1-30 W10 — the inventory setup surface (`/inventory/setup`), change-control
 * CC-05: categories, units, items and stock locations.
 *
 * The adapter is mocked at the module boundary, as every P1-30 DOM suite does;
 * what is asserted is what the SCREEN does with the server's answers — which
 * reads it issues and when, which body a form sends (and that a malformed one
 * is refused before any request), that a refusal by the field lands on that
 * field, that every listed row is rendered as sent, and that the route page
 * denies before it reads. The real request shapes are proved in
 * `inventory-api.test.ts`; the server's own rules in
 * `tests/backend/p1-30-inventory-master-data.test.ts`.
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
const labelledAr = (key: string) => new RegExp(`^${escape(AR[key] as string)}`);
/** The one listed branch, as the picker labels it. */
const OPTION_NAME = 'AMM-1 — Amman';

const listItemCategories = vi.fn();
const listUnitsOfMeasure = vi.fn();
const createItemCategory = vi.fn();
const createItem = vi.fn();
const createStockLocation = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const listItems = vi.fn();
const listReorderLevels = vi.fn();
const setReorderLevel = vi.fn();
const retireReorderLevel = vi.fn();

vi.mock('@/features/inventory/api', () => ({
  listItemCategories: (...args: unknown[]) => listItemCategories(...args),
  listUnitsOfMeasure: (...args: unknown[]) => listUnitsOfMeasure(...args),
  createItemCategory: (...args: unknown[]) => createItemCategory(...args),
  createItem: (...args: unknown[]) => createItem(...args),
  createStockLocation: (...args: unknown[]) => createStockLocation(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  listItems: (...args: unknown[]) => listItems(...args),
  listReorderLevels: (...args: unknown[]) => listReorderLevels(...args),
  setReorderLevel: (...args: unknown[]) => setReorderLevel(...args),
  retireReorderLevel: (...args: unknown[]) => retireReorderLevel(...args),
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

const { SetupScreen } = await import('@/features/inventory/components/SetupScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const SetupPage = (await import('@/app/[locale]/(dashboard)/inventory/setup/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const UNIT_ID = '44444444-4444-4444-8444-444444444444';
const LOCATION_ID = '55555555-5555-4555-8555-555555555555';
const CREATED_ID = '66666666-6666-4666-8666-666666666666';

const category = {
  id: CATEGORY_ID,
  code: 'brakes',
  name: 'Brakes',
  description: null,
  parentCategoryId: null,
  status: 'active',
  recordVersion: 1,
};
const unit = { id: UNIT_ID, scope: 'platform', code: 'EA', name: 'Each', dimension: 'count' };
const warehouse = {
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
const ITEM_ID = '77777777-7777-4777-8777-777777777777';
const LEVEL_ID = '88888888-8888-4888-8888-888888888888';
const catalogueItem = {
  id: ITEM_ID,
  itemCategoryId: CATEGORY_ID,
  sku: 'BRK-001',
  name: 'Front brake pads',
  description: null,
  unitOfMeasure: { id: UNIT_ID, code: 'EA', name: 'Each' },
  itemType: 'part',
  isStockTracked: true,
  isSerialized: false,
  lifecycleStatus: 'active',
  recordVersion: 1,
};
const reorderLevel = {
  id: LEVEL_ID,
  itemId: ITEM_ID,
  sku: 'BRK-001',
  itemName: 'Front brake pads',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  locationId: null,
  locationCode: null,
  reorderLevelQty: '4.000',
  preferredOrderQty: '12.000',
  status: 'active',
  retiredAt: null,
  recordVersion: 3,
};

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const cursor = (items: readonly unknown[]) => okRead({ items, nextCursor: null, hasMore: false });
const denied = () => ({ status: 'denied' as const, correlationId: 'corr' });
const success = (created: unknown, messageKey: string) => ({
  state: { status: 'success' as const, messageKey, attempt: 1, correlationId: 'corr' },
  created,
});
const invalid = (fieldErrors: Record<string, string>) => ({
  state: {
    status: 'invalid' as const,
    messageKey: 'form.formError',
    fieldErrors,
    attempt: 1,
    correlationId: 'corr',
  },
  created: null,
});

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <SetupScreen
      locale="en"
      messages={en}
      canManage={false}
      canReadStock={false}
      canReadBranches={false}
      {...over}
    />
  );
}
async function renderPage(params: Record<string, string>) {
  const tree = await SetupPage({ params: Promise.resolve(params) });
  return renderLtr(tree as React.ReactElement);
}
const form = (key: string) => screen.getByRole('form', { name: EN[key] as string });
const targetForm = () =>
  screen.getByRole('form', { name: EN['inventory.setup.locations.targetLabel'] as string });

async function chooseBranch(user: ReturnType<typeof userEvent.setup>) {
  const select = await within(targetForm()).findByRole('combobox');
  await user.selectOptions(select, BRANCH_ID);
  await user.click(
    within(targetForm()).getByRole('button', {
      name: EN['inventory.setup.locations.show'] as string,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listItemCategories.mockResolvedValue(cursor([category]));
  listUnitsOfMeasure.mockResolvedValue(okRead({ items: [unit] }));
  listLocations.mockResolvedValue(cursor([warehouse]));
  listBranches.mockResolvedValue(okRead({ items: [branch] }));
  listItems.mockResolvedValue({
    status: 'ok' as const,
    rows: [catalogueItem],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  });
  listReorderLevels.mockResolvedValue(
    okRead({ asOf: '2026-09-20T08:00:00Z', levels: { items: [], nextCursor: null, hasMore: false } })
  );
});

describe('categories and units', () => {
  it('reads both on first paint and renders every row as the server sent it', async () => {
    renderScreen();
    expect(await screen.findByText('brakes')).toBeVisible();
    expect(screen.getByText('Brakes')).toBeVisible();
    expect(await screen.findByText('EA')).toBeVisible();
    expect(screen.getByText(EN['inventory.setup.units.scope.platform'] as string)).toBeVisible();
    expect(listItemCategories).toHaveBeenCalledTimes(1);
    expect(listUnitsOfMeasure).toHaveBeenCalledTimes(1);
    // No tenant unit writer exists; the section says so instead of offering a form.
    expect(screen.getByText(EN['inventory.setup.units.noWriter'] as string)).toBeVisible();
  });

  it('offers no create form without inv.item.manage, and says what is needed', async () => {
    renderScreen();
    await screen.findByText('brakes');
    expect(
      screen.queryByRole('form', { name: EN['inventory.setup.category.new'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('form', { name: EN['inventory.setup.item.new'] as string })
    ).toBeNull();
    expect(screen.getByText(EN['inventory.setup.needsManage'] as string)).toBeVisible();
  });

  it('creates a category with the typed code and name, sending no empty optional field, and lists the echo', async () => {
    const user = userEvent.setup();
    createItemCategory.mockResolvedValue(
      success(
        { ...category, id: CREATED_ID, code: 'filters', name: 'Filters' },
        'inventory.setup.category.success'
      )
    );
    renderScreen({ canManage: true });
    const panel = form('inventory.setup.category.new');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.category.code')),
      'filters'
    );
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.category.name')),
      'Filters'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.category.submit'] as string })
    );
    await waitFor(() =>
      expect(createItemCategory).toHaveBeenCalledWith({ code: 'filters', name: 'Filters' })
    );
    expect(await screen.findByText('filters')).toBeVisible();
    expect(notifyActionResult).toHaveBeenCalled();
  });

  it('refuses a code the server would refuse before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    const panel = form('inventory.setup.category.new');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.category.code')),
      'Filters!'
    );
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.category.name')),
      'Filters'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.category.submit'] as string })
    );
    expect(
      await within(panel).findByText(EN['inventory.setup.category.codeFormat'] as string)
    ).toBeVisible();
    expect(createItemCategory).not.toHaveBeenCalled();
  });

  it('a refusal by the field lands on that field, in the words the server chose', async () => {
    const user = userEvent.setup();
    createItemCategory.mockResolvedValue(
      invalid({ parentCategoryId: 'form.violation.unknown_category' })
    );
    renderScreen({ canManage: true });
    const panel = form('inventory.setup.category.new');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.category.code')),
      'pads'
    );
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.category.name')),
      'Pads'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.category.submit'] as string })
    );
    expect(
      await within(panel).findByText(EN['form.violation.unknown_category'] as string)
    ).toBeVisible();
  });
});

describe('items', () => {
  it('creates an item from the chosen category and unit, the type, and the tracked flag as ticked', async () => {
    const user = userEvent.setup();
    createItem.mockResolvedValue(
      success(
        {
          id: CREATED_ID,
          itemCategoryId: CATEGORY_ID,
          sku: 'BRK-001',
          name: 'Brake pad',
          description: null,
          unitOfMeasure: { id: UNIT_ID, code: 'EA' },
          itemType: 'part',
          isStockTracked: true,
          isSerialized: false,
          lifecycleStatus: 'active',
          recordVersion: 1,
        },
        'inventory.setup.item.success'
      )
    );
    renderScreen({ canManage: true });
    await screen.findByText('brakes');
    const panel = form('inventory.setup.item.new');
    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.setup.item.category')),
      CATEGORY_ID
    );
    await user.type(within(panel).getByLabelText(labelled('inventory.setup.item.sku')), 'BRK-001');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.item.name')),
      'Brake pad'
    );
    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.setup.item.unit')),
      UNIT_ID
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.item.submit'] as string })
    );
    await waitFor(() =>
      expect(createItem).toHaveBeenCalledWith({
        itemCategoryId: CATEGORY_ID,
        sku: 'BRK-001',
        name: 'Brake pad',
        uomId: UNIT_ID,
        itemType: 'part',
        isStockTracked: true,
        isSerialized: false,
      })
    );
    expect(await screen.findByText('BRK-001')).toBeVisible();
    expect(screen.getByText(EN['inventory.setup.items.findInSearch'] as string)).toBeVisible();
  });

  it('refuses an item with no category or unit chosen before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await screen.findByText('brakes');
    const panel = form('inventory.setup.item.new');
    await user.type(within(panel).getByLabelText(labelled('inventory.setup.item.sku')), 'BRK-001');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.item.name')),
      'Brake pad'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.item.submit'] as string })
    );
    expect(await within(panel).findAllByText(EN['field.required'] as string)).toHaveLength(2);
    expect(createItem).not.toHaveBeenCalled();
  });

  it('says a category is needed first when the organisation has none', async () => {
    listItemCategories.mockResolvedValue(cursor([]));
    renderScreen({ canManage: true });
    expect(await screen.findByText(EN['inventory.setup.categories.none'] as string)).toBeVisible();
    expect(screen.getByText(EN['inventory.setup.item.needsCategory'] as string)).toBeVisible();
  });
});

describe('stock locations', () => {
  it('reads the locations of the chosen branch and creates a warehouse with no parent', async () => {
    const user = userEvent.setup();
    createStockLocation.mockResolvedValue(
      success(
        { ...warehouse, id: CREATED_ID, locationCode: 'WH-2', name: 'Annex', recordVersion: 1 },
        'inventory.setup.location.success'
      )
    );
    renderScreen({ canManage: true, canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    await waitFor(() =>
      expect(listLocations).toHaveBeenCalledWith({ companyId: COMPANY_ID, branchId: BRANCH_ID })
    );
    expect(await screen.findByText('WH-1')).toBeVisible();
    const panel = form('inventory.setup.location.new');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.location.code')),
      'WH-2'
    );
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.location.name')),
      'Annex'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.location.submit'] as string })
    );
    await waitFor(() =>
      expect(createStockLocation).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        locationCode: 'WH-2',
        name: 'Annex',
        locationType: 'warehouse',
      })
    );
    expect(await screen.findByText('WH-2')).toBeVisible();
  });

  it('a storage place needs a warehouse: refused before sending, then sent with the chosen parent', async () => {
    const user = userEvent.setup();
    createStockLocation.mockResolvedValue(
      success(
        {
          ...warehouse,
          id: CREATED_ID,
          locationCode: 'RACK-A',
          name: 'Rack A',
          locationType: 'storage',
          parentLocationId: LOCATION_ID,
          recordVersion: 1,
        },
        'inventory.setup.location.success'
      )
    );
    renderScreen({ canManage: true, canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    await screen.findByText('WH-1');
    const panel = form('inventory.setup.location.new');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.location.code')),
      'RACK-A'
    );
    await user.type(
      within(panel).getByLabelText(labelled('inventory.setup.location.name')),
      'Rack A'
    );
    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.setup.location.type')),
      'storage'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.location.submit'] as string })
    );
    expect(
      await within(panel).findByText(EN['inventory.setup.location.parentRequired'] as string)
    ).toBeVisible();
    expect(createStockLocation).not.toHaveBeenCalled();

    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.setup.location.parent')),
      LOCATION_ID
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.setup.location.submit'] as string })
    );
    await waitFor(() =>
      expect(createStockLocation).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        locationCode: 'RACK-A',
        name: 'Rack A',
        locationType: 'storage',
        parentLocationId: LOCATION_ID,
      })
    );
    expect(await screen.findByText('RACK-A')).toBeVisible();
  });

  it('without inv.stock.read, requests no location list and says why', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true, canReadStock: false, canReadBranches: true });
    await chooseBranch(user);
    expect(
      await screen.findByText(EN['inventory.setup.locations.noPermission'] as string)
    ).toBeVisible();
    expect(listLocations).not.toHaveBeenCalled();
  });

  it('a refused location read is a refusal, where the list would have been', async () => {
    const user = userEvent.setup();
    listLocations.mockResolvedValue(denied());
    renderScreen({ canManage: false, canReadStock: true, canReadBranches: true });
    await chooseBranch(user);
    expect(await screen.findByText(EN['inventory.locations.refused'] as string)).toBeVisible();
  });
});

/* -------------------------------------------------------------------- *
 * P1-30 CC-15 — the branch picker says which of six states it is in
 *
 * The defect: `items` was `null` both before a read started and while it was
 * in flight, so a PERMITTED operator met two free-text identifier fields on
 * every first paint — the same rendering an operator refused the branch read
 * gets by design. Five failure reasons flattened into one sentence, and a
 * zero-row list rendered a select holding only its placeholder.
 * -------------------------------------------------------------------- */
describe('CC-15 — the branch picker says which of six states it is in', () => {
  const permitted = { canManage: true, canReadStock: true, canReadBranches: true };
  const showButton = () =>
    within(targetForm()).getByRole('button', {
      name: EN['inventory.setup.locations.show'] as string,
    });

  it('while a permitted read is in flight, waits — and offers no field at all', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderScreen(permitted);

    const target = targetForm();
    expect(within(target).getByRole('status')).toHaveTextContent(
      EN['inventory.common.branchesLoading'] as string
    );
    // THE finding: not a select with nothing in it, and not the identifier
    // fields either. There is no control to type into while the answer is
    // still coming.
    expect(within(target).queryByRole('combobox')).toBeNull();
    expect(within(target).queryByLabelText(labelled('inventory.common.companyIdField'))).toBeNull();
    expect(within(target).queryByLabelText(labelled('inventory.common.branchIdField'))).toBeNull();
    expect(showButton()).toBeDisabled();

    release(okRead({ items: [branch] }));
    expect(await within(targetForm()).findByRole('combobox')).toBeVisible();
    expect(within(targetForm()).queryByRole('status')).toBeNull();
    expect(showButton()).toBeEnabled();
  });

  it('with rows, offers the list and carries the chosen branch its own company', async () => {
    const user = userEvent.setup();
    renderScreen(permitted);
    const select = await within(targetForm()).findByRole('combobox');
    expect(within(select).getByRole('option', { name: OPTION_NAME })).toBeVisible();
    expect(
      within(targetForm()).queryByLabelText(labelled('inventory.common.companyIdField'))
    ).toBeNull();
    await user.selectOptions(select, BRANCH_ID);
    await user.click(showButton());
    // The affordance the identifier fields cannot give: the company comes from
    // the branch's own row.
    await waitFor(() =>
      expect(listLocations).toHaveBeenCalledWith({ companyId: COMPANY_ID, branchId: BRANCH_ID })
    );
  });

  it('with no row, says so and KEEPS the identifiers, so no permitted operator is blocked', async () => {
    listBranches.mockResolvedValue(okRead({ items: [] }));
    renderScreen(permitted);
    const target = targetForm();
    expect(
      await within(target).findByText(EN['inventory.common.branchesNone'] as string)
    ).toBeVisible();
    expect(
      within(target).getByLabelText(labelled('inventory.common.companyIdField'))
    ).toBeVisible();
    expect(within(target).getByLabelText(labelled('inventory.common.branchIdField'))).toBeVisible();
    expect(within(target).queryByRole('combobox')).toBeNull();
    // Not a dead end: the operator may still be authorised for a branch this
    // screen cannot name, and the server re-authorizes the pair anyway.
    expect(showButton()).toBeEnabled();
  });

  it('a failure that a second attempt could clear offers one, and the retry reconciles the pair', async () => {
    const user = userEvent.setup();
    listBranches
      .mockResolvedValueOnce({ status: 'unavailable', correlationId: 'corr' })
      .mockResolvedValueOnce(okRead({ items: [branch] }));
    renderScreen(permitted);
    expect(
      await within(targetForm()).findByText(EN['inventory.common.branchesUnavailable'] as string)
    ).toBeVisible();
    await user.type(
      within(targetForm()).getByLabelText(labelled('inventory.common.companyIdField')),
      COMPANY_ID
    );
    await user.click(
      within(targetForm()).getByRole('button', { name: EN['state.retry'] as string })
    );
    const select = await within(targetForm()).findByRole('combobox');
    expect(within(select).getByRole('option', { name: OPTION_NAME })).toBeVisible();
    expect(listBranches).toHaveBeenCalledTimes(2);
    // The corruption path: a pair the arriving list cannot contain is
    // discarded, so the control and the form agree about what will be sent.
    expect(select).toHaveValue('');
  });

  it('a retry that fails again does not cost the operator what they typed', async () => {
    const user = userEvent.setup();
    listBranches.mockResolvedValue({ status: 'unavailable', correlationId: 'corr' });
    renderScreen(permitted);
    const company = await within(targetForm()).findByLabelText(
      labelled('inventory.common.companyIdField')
    );
    await user.type(company, COMPANY_ID);
    await user.click(
      within(targetForm()).getByRole('button', { name: EN['state.retry'] as string })
    );
    await waitFor(() => expect(listBranches).toHaveBeenCalledTimes(2));
    expect(
      within(targetForm()).getByLabelText(labelled('inventory.common.companyIdField'))
    ).toHaveValue(COMPANY_ID);
  });

  it('a refusal is stated as a refusal, and is not offered a retry', async () => {
    listBranches.mockResolvedValue(denied());
    renderScreen(permitted);
    const target = targetForm();
    expect(
      await within(target).findByText(EN['inventory.common.branchesRefused'] as string)
    ).toBeVisible();
    expect(within(target).getByLabelText(labelled('inventory.common.branchIdField'))).toBeVisible();
    // A refusal retried is a refusal.
    expect(within(target).queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('an ended session is stated as one, and is not offered a retry either', async () => {
    listBranches.mockResolvedValue({ status: 'expired', correlationId: 'corr' });
    renderScreen(permitted);
    const target = targetForm();
    expect(await within(target).findByText(EN['state.expired.title'] as string)).toBeVisible();
    expect(
      within(target).getByLabelText(labelled('inventory.common.companyIdField'))
    ).toBeVisible();
    expect(within(target).queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('without org.branch.read, the identifiers are the design and no list is requested', async () => {
    renderScreen({ canManage: true, canReadStock: true, canReadBranches: false });
    const target = targetForm();
    expect(listBranches).not.toHaveBeenCalled();
    expect(
      within(target).getByLabelText(labelled('inventory.common.companyIdField'))
    ).toBeVisible();
    expect(within(target).getByLabelText(labelled('inventory.common.branchIdField'))).toBeVisible();
    expect(within(target).getByText(EN['inventory.common.identifierHelp'] as string)).toBeVisible();
    expect(within(target).queryByRole('status')).toBeNull();
    expect(within(target).queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
    expect(showButton()).toBeEnabled();
  });

  /* ---- Arabic, right to left: the state the CC-15 screenshot captured ---- */

  function renderArabic(over: Record<string, unknown> = {}) {
    return renderRtl(
      <SetupScreen
        locale="ar"
        messages={ar}
        canManage={true}
        canReadStock={true}
        canReadBranches={true}
        {...over}
      />
    );
  }
  const arabicTarget = () =>
    screen.getByRole('form', { name: AR['inventory.setup.locations.targetLabel'] as string });

  it('in Arabic, a read in flight is a wait and not two identifier boxes', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderArabic();
    expect(document.documentElement.dir).toBe('rtl');
    const target = arabicTarget();
    expect(within(target).getByRole('status')).toHaveTextContent(
      AR['inventory.common.branchesLoading'] as string
    );
    expect(
      within(target).queryByLabelText(labelledAr('inventory.common.companyIdField'))
    ).toBeNull();
    release(okRead({ items: [branch] }));
    expect(await within(arabicTarget()).findByRole('combobox')).toBeVisible();
  });

  it('in Arabic without the branch read, the identifier fields stay left to right', async () => {
    renderArabic({ canReadBranches: false });
    const target = arabicTarget();
    const company = within(target).getByLabelText(labelledAr('inventory.common.companyIdField'));
    expect(company).toHaveAttribute('dir', 'ltr');
    expect(within(target).getByText(AR['inventory.common.identifierHelp'] as string)).toBeVisible();
  });

  it('in Arabic, a zero-row list says so and keeps the identifiers', async () => {
    listBranches.mockResolvedValue(okRead({ items: [] }));
    renderArabic();
    const target = arabicTarget();
    expect(
      await within(target).findByText(AR['inventory.common.branchesNone'] as string)
    ).toBeVisible();
    expect(
      within(target).getByLabelText(labelledAr('inventory.common.branchIdField'))
    ).toBeVisible();
  });

  it('in Arabic, a failure offers the Arabic retry and then the list', async () => {
    const user = userEvent.setup();
    listBranches
      .mockResolvedValueOnce({ status: 'unavailable', correlationId: 'corr' })
      .mockResolvedValueOnce(okRead({ items: [branch] }));
    renderArabic();
    expect(
      await within(arabicTarget()).findByText(AR['inventory.common.branchesUnavailable'] as string)
    ).toBeVisible();
    await user.click(
      within(arabicTarget()).getByRole('button', { name: AR['state.retry'] as string })
    );
    expect(await within(arabicTarget()).findByRole('combobox')).toBeVisible();
    expect(listBranches).toHaveBeenCalledTimes(2);
  });
});

describe('the route page', () => {
  it('refuses without inv.item.read, and issues no read', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await renderPage({ locale: 'en' });
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listItemCategories).not.toHaveBeenCalled();
    expect(listUnitsOfMeasure).not.toHaveBeenCalled();
  });

  it('with inv.item.read alone, lists and offers no form', async () => {
    PERMISSIONS = ['inv.item.read'];
    await renderPage({ locale: 'en' });
    expect(await screen.findByText('brakes')).toBeVisible();
    expect(
      screen.queryByRole('form', { name: EN['inventory.setup.category.new'] as string })
    ).toBeNull();
  });

  it('with inv.item.manage, offers the three forms', async () => {
    PERMISSIONS = ['inv.item.read', 'inv.item.manage', 'inv.stock.read', 'org.branch.read'];
    await renderPage({ locale: 'en' });
    await screen.findByText('brakes');
    expect(form('inventory.setup.category.new')).toBeVisible();
    expect(form('inventory.setup.item.new')).toBeVisible();
    expect(targetForm()).toBeVisible();
  });

  it('a locale it does not serve is not found', async () => {
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound() was called');
  });

  it('renders in Arabic, right to left, with the same reads', async () => {
    const { container } = renderRtl(
      <SetupScreen
        locale="ar"
        messages={ar}
        canManage={true}
        canReadStock={false}
        canReadBranches={false}
      />
    );
    expect(
      await screen.findByText(AR['inventory.setup.categories.heading'] as string)
    ).toBeVisible();
    expect(await screen.findByText('brakes')).toBeVisible();
    expect(container.querySelector('[dir="rtl"], [dir="ltr"]')).not.toBeNull();
  });
});

/**
 * DEF-T-08 — the reorder level, without which the low-stock rule is inert.
 *
 * The attention screen states the rule and its one input: an item with no
 * recorded level is never listed. No screen recorded one, so for every
 * organisation the platform provisions the rule could never fire. What is
 * asserted here is that a level can be recorded, that what is recorded is
 * listed with its narrowing said in words rather than left blank, that the
 * quantities travel as the operator's own strings, that retiring sends the
 * LEVEL's own version, and that the reads are gated.
 */
describe('reorder levels', () => {
  const setForm = () => form('inventory.reorderLevels.set.heading');

  it('reads the levels once with inv.stock.read, and not at all without it', async () => {
    renderScreen({ canReadStock: false });
    await screen.findByText('brakes');
    expect(listReorderLevels).not.toHaveBeenCalled();
    expect(
      screen.getByText(EN['inventory.reorderLevels.noPermission'] as string)
    ).toBeVisible();
  });

  it('says none is recorded, which is why nothing can be reported as running low', async () => {
    renderScreen({ canReadStock: true });
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(EN['inventory.reorderLevels.none'] as string)).toBeVisible();
  });

  it('lists a level with its narrowing in words and its quantities as the server strings', async () => {
    listReorderLevels.mockResolvedValue(
      okRead({
        asOf: '2026-09-20T08:00:00Z',
        levels: { items: [reorderLevel], nextCursor: null, hasMore: false },
      })
    );
    renderScreen({ canReadStock: true });
    expect(await screen.findByText('Front brake pads')).toBeVisible();
    expect(
      screen.getByText(EN['inventory.reorderLevels.appliesTo.branch'] as string)
    ).toBeVisible();
    expect(screen.getByText('4.000')).toBeVisible();
    expect(screen.getByText('12.000')).toBeVisible();
  });

  it('names the organisation-wide narrowing rather than leaving the cell blank', async () => {
    listReorderLevels.mockResolvedValue(
      okRead({
        asOf: '2026-09-20T08:00:00Z',
        levels: {
          items: [{ ...reorderLevel, companyId: null, branchId: null }],
          nextCursor: null,
          hasMore: false,
        },
      })
    );
    renderScreen({ canReadStock: true });
    expect(
      await screen.findByText(EN['inventory.reorderLevels.appliesTo.organisation'] as string)
    ).toBeVisible();
  });

  it('offers no form without inv.item.manage', async () => {
    renderScreen({ canReadStock: true });
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalled());
    expect(
      screen.queryByRole('form', { name: EN['inventory.reorderLevels.set.heading'] as string })
    ).toBeNull();
  });

  it('asks for the catalogue only when the operator asks, then offers what it answered', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true, canReadStock: true });
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalled());
    expect(listItems).not.toHaveBeenCalled();
    await user.click(
      within(setForm()).getByRole('button', {
        name: EN['inventory.reorderLevels.items.find'] as string,
      })
    );
    await waitFor(() => expect(listItems).toHaveBeenCalledTimes(1));
    expect(
      await within(setForm()).findByRole('option', { name: 'BRK-001 — Front brake pads' })
    ).toBeInTheDocument();
  });

  it('records a level for the whole organisation, sending no narrowing it was not given', async () => {
    const user = userEvent.setup();
    setReorderLevel.mockResolvedValue(
      success({ ...reorderLevel, replayed: false }, 'inventory.reorderLevels.set.success')
    );
    renderScreen({ canManage: true, canReadStock: true });
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalled());
    const panel = setForm();
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.reorderLevels.items.find'] as string })
    );
    await within(panel).findByRole('option', { name: 'BRK-001 — Front brake pads' });
    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.reorderLevels.set.item')),
      ITEM_ID
    );
    await user.type(
      within(panel).getByLabelText(labelled('inventory.reorderLevels.set.level')),
      '4.000'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.reorderLevels.set.submit'] as string })
    );
    await waitFor(() => expect(setReorderLevel).toHaveBeenCalledTimes(1));
    expect(setReorderLevel.mock.calls[0]?.[0]).toEqual({
      itemId: ITEM_ID,
      reorderLevelQty: '4.000',
    });
    // The list is read again, so what was recorded is what is shown.
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalledTimes(2));
  });

  it('accepts zero as a level: tell me the moment this runs out', async () => {
    const user = userEvent.setup();
    setReorderLevel.mockResolvedValue(
      success(
        { ...reorderLevel, reorderLevelQty: '0.000', replayed: false },
        'inventory.reorderLevels.set.success'
      )
    );
    renderScreen({ canManage: true, canReadStock: true });
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalled());
    const panel = setForm();
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.reorderLevels.items.find'] as string })
    );
    await within(panel).findByRole('option', { name: 'BRK-001 — Front brake pads' });
    await user.selectOptions(
      within(panel).getByLabelText(labelled('inventory.reorderLevels.set.item')),
      ITEM_ID
    );
    await user.type(
      within(panel).getByLabelText(labelled('inventory.reorderLevels.set.level')),
      '0'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.reorderLevels.set.submit'] as string })
    );
    await waitFor(() => expect(setReorderLevel).toHaveBeenCalledTimes(1));
    expect(setReorderLevel.mock.calls[0]?.[0]).toMatchObject({ reorderLevelQty: '0' });
  });

  it('refuses a malformed quantity and an unchosen item before any request', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true, canReadStock: true });
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalled());
    const panel = setForm();
    await user.type(
      within(panel).getByLabelText(labelled('inventory.reorderLevels.set.level')),
      '1.2345'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.reorderLevels.set.submit'] as string })
    );
    expect(
      await within(panel).findByText(EN['inventory.reorderLevels.qtyFormat'] as string)
    ).toBeVisible();
    expect(within(panel).getByText(EN['field.required'] as string)).toBeVisible();
    expect(setReorderLevel).not.toHaveBeenCalled();
  });

  it('retires a level with the LEVEL own version, then reads the list again', async () => {
    const user = userEvent.setup();
    listReorderLevels.mockResolvedValue(
      okRead({
        asOf: '2026-09-20T08:00:00Z',
        levels: { items: [reorderLevel], nextCursor: null, hasMore: false },
      })
    );
    retireReorderLevel.mockResolvedValue(
      success(
        { ...reorderLevel, status: 'retired', replayed: false },
        'inventory.reorderLevels.retire.success'
      )
    );
    renderScreen({ canManage: true, canReadStock: true });
    await screen.findByText('Front brake pads');
    await user.click(
      screen.getByRole('button', {
        name: `${EN['inventory.reorderLevels.retire.action']} BRK-001`,
      })
    );
    await waitFor(() => expect(retireReorderLevel).toHaveBeenCalledTimes(1));
    expect(retireReorderLevel.mock.calls[0]?.[0]).toBe(LEVEL_ID);
    expect(retireReorderLevel.mock.calls[0]?.[1]).toBe(3);
    await waitFor(() => expect(listReorderLevels).toHaveBeenCalledTimes(2));
  });
});
