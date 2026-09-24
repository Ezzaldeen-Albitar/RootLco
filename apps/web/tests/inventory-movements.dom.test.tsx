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
 * The properties under test: the ledger is NEVER read on first paint nor on
 * naming a branch — only on "Show movements", and the screen says the read is
 * recorded; every read is addressed to the named branch; the rows render in
 * the order served with `sequence`, `quantity` and `signedQuantity` as the
 * server's strings; a location is an identifier and the screen says no code
 * is published; instants travel as full ISO strings; and the route page
 * decides before it reads.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listMovements = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listMovements: (...args: unknown[]) => listMovements(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  // `./shared` names this export; this screen never calls it.
  listItemCategories: vi.fn(),
  listItems: vi.fn(),
  listAvailability: vi.fn(),
  listReservations: vi.fn(),
  listPartIssues: vi.fn(),
  listRequiredParts: vi.fn(),
  createReservation: vi.fn(),
  releaseReservation: vi.fn(),
  createIssue: vi.fn(),
  createReturn: vi.fn(),
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
});

describe('the ledger is read only when asked', () => {
  it('reads nothing on first paint, and only on Show movements', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    // The shell holds the named branches, so no directory is requested.
    expect(listBranches).not.toHaveBeenCalled();
    expect(listMovements).not.toHaveBeenCalled();
    expect(within(ledger()).getByText(EN['inventory.movements.notAsked'] as string)).toBeVisible();
    expect(within(ledger()).getByText(EN['inventory.movements.audited'] as string)).toBeVisible();
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(1));
    expect(listMovements.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    expect(listMovements.mock.calls[0]?.[1]).toEqual({});
  });

  it('asking again with the same filters reads again — each read is the operator’s own act', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(1));
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalledTimes(2));
  });

  it('renders the rows in the order served with the server’s strings, and names the location by identifier', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await user.click(showButton());
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
    expect(within(table).getAllByText(LOCATION_ID)).toHaveLength(2);
    expect(
      within(ledger()).getByText(EN['inventory.movements.locationNote'] as string)
    ).toBeVisible();
  });

  it('sends the filters, with instants as full ISO strings', async () => {
    const user = userEvent.setup();
    renderScreen({ initialWorkOrderId: WORK_ORDER_ID });
    await chooseBranch();
    const panel = ledger();
    expect(within(panel).getByLabelText(labelled('inventory.movements.workOrderId'))).toHaveValue(
      WORK_ORDER_ID
    );
    await user.type(within(panel).getByLabelText(labelled('inventory.movements.itemId')), ITEM_ID);
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
    await user.type(
      within(panel).getByLabelText(labelled('inventory.movements.from')),
      '2026-09-01T08:00'
    );
    await user.click(showButton());
    await waitFor(() => expect(listMovements).toHaveBeenCalled());
    const criteria = listMovements.mock.calls[0]?.[1] as Record<string, string>;
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

  it('refuses a malformed identifier before asking', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch();
    await user.type(
      within(ledger()).getByLabelText(labelled('inventory.movements.itemId')),
      'nope'
    );
    await user.click(showButton());
    expect(
      await within(ledger()).findByText(EN['inventory.common.idFormat'] as string)
    ).toBeVisible();
    expect(listMovements).not.toHaveBeenCalled();
  });

  it('a refused read is a refusal, never an empty ledger', async () => {
    const user = userEvent.setup();
    listMovements.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr',
    });
    renderScreen();
    await chooseBranch();
    await user.click(showButton());
    expect(await within(ledger()).findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(within(ledger()).queryByText(EN['inventory.movements.none'] as string)).toBeNull();
  });

  it('says there are none when the server answers none', async () => {
    const user = userEvent.setup();
    listMovements.mockResolvedValue(page([]));
    renderScreen();
    await chooseBranch();
    await user.click(showButton());
    expect(
      await within(ledger()).findByText(EN['inventory.movements.none'] as string)
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
    within(ledger()).getByLabelText(labelled('inventory.movements.itemId')) as HTMLInputElement;

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

  it('an untouched form switches without asking', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
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

  it('with inv.stock.read alone, offers the target as identifiers and reads no ledger', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await renderPage({ locale: 'en' });
    expect(targetForm()).toBeVisible();
    expect(listBranches).not.toHaveBeenCalled();
    expect(listMovements).not.toHaveBeenCalled();
  });

  it('a well-formed work order in the address prefills the filter, and no directory is read', async () => {
    PERMISSIONS = ['inv.stock.read', 'org.branch.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    await chooseBranch();
    expect(listBranches).not.toHaveBeenCalled();
    expect(
      within(ledger()).getByLabelText(labelled('inventory.movements.workOrderId'))
    ).toHaveValue(WORK_ORDER_ID);
    expect(listMovements).not.toHaveBeenCalled();
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
    const user = userEvent.setup();
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
    await user.click(showButton());
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
    expect(listMovements).not.toHaveBeenCalled();
  });
});
