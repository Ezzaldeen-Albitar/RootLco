import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ar from '../src/i18n/messages/ar.json';
import { PermissionDeniedState } from '@/components/states/States';
import { messagesFor, renderLtr, renderRtl } from './render';
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  ITEM_ID,
  LOCATION_ID,
  OTHER_LOCATION_ID,
  branch,
  labelled,
  okRead,
  seriousViolations,
} from './support/stock-operations';

/**
 * The Attention area, rendered (Owner directive, operational alerts).
 *
 * The properties under test, one per card and then across them:
 *
 *  - every row comes from the READ, with the server's own strings — no card
 *    computes a quantity, a shortfall or a percentage of its own;
 *  - a refusal is a SENTENCE with its reference, never a table with no rows,
 *    because "nothing is low" and "we could not find out" are different
 *    statements and only one of them is about the stock;
 *  - an empty answer says so in its own words;
 *  - the preferred order quantity is drawn under a label naming it a suggestion;
 *  - every row links to the screen where the work is done;
 *  - every card states the instant the database answered, and says when its list
 *    was capped;
 *  - NOTHING on the screen writes: no write adapter is reached however the cards
 *    are filled, and the feature holds no write at all.
 */

const AR = ar as Record<string, string>;
const AS_OF = '2026-09-18T09:00:00.000Z';

const readLowStockAlerts = vi.fn();
const readCountDiscrepancyAlerts = vi.fn();
const readUnusualConsumptionAlerts = vi.fn();
const readAgedInTransitAlerts = vi.fn();
const listBranches = vi.fn();
const readCapacityAlerts = vi.fn();

/** Three writers of the inventory surface, mocked ONLY so silence is provable. */
const createReservation = vi.fn();
const createAdjustment = vi.fn();
const openStockCount = vi.fn();
const WRITERS = { createReservation, createAdjustment, openStockCount };

vi.mock('@/features/inventory/api', () => ({
  readLowStockAlerts: (...args: unknown[]) => readLowStockAlerts(...args),
  readCountDiscrepancyAlerts: (...args: unknown[]) => readCountDiscrepancyAlerts(...args),
  readUnusualConsumptionAlerts: (...args: unknown[]) => readUnusualConsumptionAlerts(...args),
  readAgedInTransitAlerts: (...args: unknown[]) => readAgedInTransitAlerts(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  // `./shared` names these; this screen never calls them.
  listItemCategories: vi.fn(),
  listLocations: vi.fn(),
  createReservation: (...args: unknown[]) => createReservation(...args),
  createAdjustment: (...args: unknown[]) => createAdjustment(...args),
  openStockCount: (...args: unknown[]) => openStockCount(...args),
}));

vi.mock('@/features/attention/api', () => ({
  readCapacityAlerts: (...args: unknown[]) => readCapacityAlerts(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: 'user-1',
    permissions: PERMISSIONS,
    email: 'operator@test.local',
  }),
}));

const { AttentionScreen } = await import('@/features/attention/components/AttentionScreen');
const { StockAlertIndicator } = await import('@/features/inventory/components/StockAlertIndicator');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const AttentionPage = (await import('@/app/[locale]/(dashboard)/attention/page'))
  .default as unknown as RoutePage;

const lowStockRow = (over: Record<string, unknown> = {}) => ({
  reorderLevelId: 'level-1',
  itemId: ITEM_ID,
  sku: 'BRK-001',
  itemName: 'Brake pad',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  scope: 'location',
  locationId: LOCATION_ID,
  locationCode: 'A-01',
  onHandQty: '4.000',
  reservedQty: '1.000',
  availableQty: '3.000',
  reorderLevelQty: '10.000',
  shortfallQty: '7.000',
  preferredOrderQty: '25.000',
  ...over,
});

const discrepancyRow = (over: Record<string, unknown> = {}) => ({
  countId: 'count-1',
  lineId: 'line-1',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  locationId: LOCATION_ID,
  locationCode: 'A-01',
  itemId: ITEM_ID,
  sku: 'BRK-001',
  itemName: 'Brake pad',
  snapshotQty: '10.000',
  countedQty: '8.000',
  movementDeltaDuringCount: '0.000',
  varianceQty: '-2.000',
  countedOn: '2026-09-17T08:00:00.000Z',
  adjustmentId: 'adjustment-1',
  adjustmentStatus: 'pending',
  adjustmentApprovedAt: null,
  ...over,
});

const consumptionRow = (over: Record<string, unknown> = {}) => ({
  itemId: ITEM_ID,
  sku: 'BRK-001',
  itemName: 'Brake pad',
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  observedQty: '40.000',
  baselineMedianQty: '5.000',
  observedPeriod: { from: '2026-09-11', to: '2026-09-18', issuedQty: '40.000' },
  baselinePeriods: [
    { from: '2026-08-14', to: '2026-08-21', issuedQty: '4.000' },
    { from: '2026-08-21', to: '2026-08-28', issuedQty: '5.000' },
    { from: '2026-08-28', to: '2026-09-04', issuedQty: '5.000' },
    { from: '2026-09-04', to: '2026-09-11', issuedQty: '6.000' },
  ],
  ...over,
});

const transitRow = (over: Record<string, unknown> = {}) => ({
  transferId: 'transfer-1',
  itemId: ITEM_ID,
  sku: 'BRK-001',
  itemName: 'Brake pad',
  status: 'partially_received',
  companyId: COMPANY_ID,
  fromBranchId: BRANCH_ID,
  fromLocationId: LOCATION_ID,
  fromLocationCode: 'A-01',
  toBranchId: BRANCH_ID,
  toLocationId: OTHER_LOCATION_ID,
  toLocationCode: 'B-02',
  quantity: '5.000',
  receivedQuantity: '1.000',
  outstandingQuantity: '4.000',
  dispatchedAt: '2026-09-01T00:00:00.000Z',
  ageDays: 17,
  ...over,
});

const page = (items: readonly unknown[], hasMore = false) => ({
  items,
  nextCursor: null,
  hasMore,
});

const lowStock = (items: readonly unknown[], hasMore = false) =>
  okRead({
    asOf: AS_OF,
    rule: { statement: 'available at or below the recorded level', excludedLocationTypes: [] },
    findings: page(items, hasMore),
  });

const discrepancies = (items: readonly unknown[], hasMore = false) =>
  okRead({
    asOf: AS_OF,
    rule: { statement: 'reconciled counts carrying a variance' },
    findings: page(items, hasMore),
  });

const consumption = (items: readonly unknown[], hasMore = false) =>
  okRead({
    asOf: AS_OF,
    rule: {
      statement: 'issued far above the median of the preceding windows',
      periodDays: 7,
      baselinePeriods: 4,
      multiple: '3',
      minimumQty: '1',
      baselineStatistic: 'median',
    },
    findings: page(items, hasMore),
  });

const inTransit = (items: readonly unknown[], hasMore = false) =>
  okRead({
    asOf: AS_OF,
    rule: { statement: 'dispatched long ago and not fully received', minimumAgeDays: 7 },
    findings: page(items, hasMore),
  });

const capacity = (alerts: readonly unknown[]) =>
  okRead({
    asOf: AS_OF,
    rule: { statement: 'at, near or over the limit', nearLimitRatio: 0.9 },
    alerts,
    capacity: {
      companies: { used: 1, limit: 5 },
      branches: { used: 2, limit: 5 },
      users: { used: 11, limit: 10 },
    },
    subscription: {
      planCode: 'test_plan_one',
      displayName: 'Test plan',
      status: 'active',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-12-31T00:00:00.000Z',
    },
  });

const refused = (status: string, correlationId: string | null = 'corr-1') => ({
  status,
  correlationId,
});

/** Everything answers with nothing to report, unless a case says otherwise. */
function everythingQuiet(): void {
  readLowStockAlerts.mockResolvedValue(lowStock([]));
  readCountDiscrepancyAlerts.mockResolvedValue(discrepancies([]));
  readUnusualConsumptionAlerts.mockResolvedValue(consumption([]));
  readAgedInTransitAlerts.mockResolvedValue(inTransit([]));
  readCapacityAlerts.mockResolvedValue(capacity([]));
  listBranches.mockResolvedValue(okRead({ items: [branch] }));
}

beforeEach(() => {
  for (const spy of [
    readLowStockAlerts,
    readCountDiscrepancyAlerts,
    readUnusualConsumptionAlerts,
    readAgedInTransitAlerts,
    readCapacityAlerts,
    listBranches,
    ...Object.values(WRITERS),
  ]) {
    spy.mockReset();
  }
  everythingQuiet();
  PERMISSIONS = [];
});

function renderScreen() {
  return renderLtr(
    <AttentionScreen
      locale="en"
      messages={messagesFor('en')}
      canReadStock
      canReadCapacity
      canReadBranches
    />
  );
}

/** Choose the one listed branch, which is what starts every stock read. */
async function chooseTheBranch(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const select = await screen.findByLabelText(labelled('attention.target.branch'));
  await user.selectOptions(select, BRANCH_ID);
}

/** The card under a heading, by the heading's own text. */
function card(headingKey: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: EN[headingKey] as string });
  const section = heading.closest('section');
  if (!section) throw new Error(`no card under ${headingKey}`);
  return section as HTMLElement;
}

describe('the branch is chosen once and every stock card is addressed to it', () => {
  it('asks for nothing until a branch is named, and says so', async () => {
    renderScreen();
    await screen.findByLabelText(labelled('attention.target.branch'));

    expect(readLowStockAlerts).not.toHaveBeenCalled();
    expect(readCountDiscrepancyAlerts).not.toHaveBeenCalled();
    expect(readUnusualConsumptionAlerts).not.toHaveBeenCalled();
    expect(readAgedInTransitAlerts).not.toHaveBeenCalled();
    expect(
      within(card('attention.lowStock.title')).getByText(EN['attention.state.noBranch'] as string)
    ).toBeInTheDocument();
    // The allowance is tenant-wide and has no branch to wait for.
    expect(readCapacityAlerts).toHaveBeenCalledTimes(1);
  });

  it('sends the chosen pair to all four stock reads', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const pair = { companyId: COMPANY_ID, branchId: BRANCH_ID };
    await waitFor(() => expect(readLowStockAlerts).toHaveBeenCalledWith(pair));
    await waitFor(() => expect(readCountDiscrepancyAlerts).toHaveBeenCalledWith(pair));
    await waitFor(() => expect(readUnusualConsumptionAlerts).toHaveBeenCalledWith(pair));
    await waitFor(() => expect(readAgedInTransitAlerts).toHaveBeenCalledWith(pair));
  });
});

describe('running low', () => {
  it('draws the row from the read and labels the order quantity as a suggestion', async () => {
    readLowStockAlerts.mockResolvedValue(lowStock([lowStockRow()]));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.lowStock.title');
    const row = await within(frame).findByRole('row', { name: /Brake pad/ });
    // The server's own strings, including the shortfall it computed.
    expect(row).toHaveTextContent('3.000');
    expect(row).toHaveTextContent('10.000');
    expect(row).toHaveTextContent('7.000');
    expect(row).toHaveTextContent('25.000');
    expect(row).toHaveTextContent(EN['attention.lowStock.suggestionOnly'] as string);
    expect(within(frame).getByRole('link', { name: 'Brake pad' })).toHaveAttribute(
      'href',
      `/en/inventory/items/${ITEM_ID}`
    );
    expect(within(frame).getByText(/As of/)).toBeInTheDocument();
  });

  it('says a level-less row has no suggestion rather than showing a quantity', async () => {
    readLowStockAlerts.mockResolvedValue(lowStock([lowStockRow({ preferredOrderQty: null })]));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.lowStock.title');
    const row = await within(frame).findByRole('row', { name: /Brake pad/ });
    expect(row).toHaveTextContent(EN['attention.lowStock.noSuggestion'] as string);
    expect(row).not.toHaveTextContent(EN['attention.lowStock.suggestionOnly'] as string);
  });

  it('says a refusal in words, with its reference, and draws no table', async () => {
    readLowStockAlerts.mockResolvedValue(refused('denied'));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.lowStock.title');
    const alert = await within(frame).findByRole('alert');
    expect(alert).toHaveTextContent(EN['attention.state.denied'] as string);
    expect(alert).toHaveTextContent('corr-1');
    expect(within(frame).queryByRole('table')).toBeNull();
    // A refusal is not an empty branch, and must not be reported as one.
    expect(within(frame).queryByText(EN['attention.lowStock.empty'] as string)).toBeNull();
    expect(within(frame).queryByText(/As of/)).toBeNull();
  });

  it('reports an empty answer as empty, and still stamps it', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.lowStock.title');
    expect(
      await within(frame).findByText(EN['attention.lowStock.empty'] as string)
    ).toBeInTheDocument();
    expect(within(frame).getByText(/As of/)).toBeInTheDocument();
    expect(within(frame).queryByRole('alert')).toBeNull();
  });

  it('says when the list it shows was capped', async () => {
    readLowStockAlerts.mockResolvedValue(lowStock([lowStockRow()], true));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    expect(
      await within(card('attention.lowStock.title')).findByText(EN['attention.capped'] as string)
    ).toBeInTheDocument();
  });
});

describe('differences found by a count', () => {
  it('draws the difference with the state of the correction, and links to the counts', async () => {
    readCountDiscrepancyAlerts.mockResolvedValue(discrepancies([discrepancyRow()]));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.discrepancy.title');
    const row = await within(frame).findByRole('row', { name: /Brake pad/ });
    expect(row).toHaveTextContent('-2.000');
    expect(row).toHaveTextContent(EN['inventory.adjustmentStatus.pending'] as string);
    expect(
      within(frame).getByRole('link', { name: EN['attention.discrepancy.openCount'] as string })
    ).toHaveAttribute('href', '/en/inventory/counts');
  });

  it('says when no correction was raised instead of leaving the decision blank', async () => {
    readCountDiscrepancyAlerts.mockResolvedValue(
      discrepancies([discrepancyRow({ adjustmentId: null, adjustmentStatus: null })])
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    expect(
      await within(card('attention.discrepancy.title')).findByText(
        EN['attention.discrepancy.noAdjustment'] as string
      )
    ).toBeInTheDocument();
  });

  it('reports a failure as a failure and an empty count list as empty', async () => {
    readCountDiscrepancyAlerts.mockResolvedValue(refused('unavailable', null));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.discrepancy.title');
    expect(await within(frame).findByRole('alert')).toHaveTextContent(
      EN['attention.state.unavailable'] as string
    );
    expect(within(frame).queryByText(EN['attention.discrepancy.empty'] as string)).toBeNull();
  });
});

describe('leaving faster than usual', () => {
  it('states the rule from the numbers the read carried, and shows both quantities', async () => {
    readUnusualConsumptionAlerts.mockResolvedValue(consumption([consumptionRow()]));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.consumption.title');
    const row = await within(frame).findByRole('row', { name: /Brake pad/ });
    expect(row).toHaveTextContent('40.000');
    expect(row).toHaveTextContent('5.000');
    // The rule in words, with the server's own multiple, window and floor.
    const rule = within(frame).getByText(/Listed when the quantity issued/);
    expect(rule).toHaveTextContent('7 days');
    expect(rule).toHaveTextContent('3 times');
    expect(rule).toHaveTextContent('4 periods');
    expect(within(frame).getByRole('link', { name: 'Brake pad' })).toHaveAttribute(
      'href',
      '/en/inventory/movements'
    );
  });

  it('does not state the rule as fact when the read did not answer', async () => {
    readUnusualConsumptionAlerts.mockResolvedValue(refused('error'));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.consumption.title');
    expect(await within(frame).findByRole('alert')).toHaveTextContent(
      EN['attention.state.error'] as string
    );
    expect(within(frame).queryByText(/Listed when the quantity issued/)).toBeNull();
    expect(
      within(frame).getByText(EN['attention.consumption.ruleUnread'] as string)
    ).toBeInTheDocument();
  });
});

describe('still on their way', () => {
  it('shows the age, what is still outstanding and both ends, and links to the transfers', async () => {
    readAgedInTransitAlerts.mockResolvedValue(inTransit([transitRow()]));
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.inTransit.title');
    const row = await within(frame).findByRole('row', { name: /Brake pad/ });
    expect(row).toHaveTextContent('17 days');
    expect(row).toHaveTextContent('4.000');
    expect(row).toHaveTextContent('A-01');
    expect(row).toHaveTextContent('B-02');
    expect(within(frame).getByRole('link', { name: 'Brake pad' })).toHaveAttribute(
      'href',
      '/en/inventory/transfers'
    );
    expect(within(frame).getByText(/sent more than 7 days ago/)).toBeInTheDocument();
  });

  it('reports an empty answer as empty', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    expect(
      await within(card('attention.inTransit.title')).findByText(
        EN['attention.inTransit.empty'] as string
      )
    ).toBeInTheDocument();
  });
});

describe('subscription limits', () => {
  it('draws a breached ceiling as the worst state, with its numbers and share', async () => {
    readCapacityAlerts.mockResolvedValue(
      capacity([{ kind: 'users', used: 11, limit: 10, severity: 'over-limit', headroom: -1 }])
    );
    renderScreen();

    const frame = card('attention.capacity.title');
    const entry = await within(frame).findByText(/11 of 10 in use/);
    expect(entry).toHaveTextContent('100%');
    expect(entry).toHaveTextContent(EN['attention.capacity.overLimit'] as string);
    expect(entry.textContent).not.toContain(EN['attention.capacity.nearLimit'] as string);
    const line = entry.closest('li');
    expect(line?.className).toContain('bg-error-subtle');
    expect(line?.className).not.toContain('bg-warning-subtle');
    expect(
      within(frame).getByRole('link', { name: EN['attention.capacity.open'] as string })
    ).toHaveAttribute('href', '/en/administration/organization');
  });

  it('says nothing is close rather than drawing an empty list of limits', async () => {
    renderScreen();
    const frame = card('attention.capacity.title');
    expect(
      await within(frame).findByText(EN['attention.capacity.empty'] as string)
    ).toBeInTheDocument();
    expect(within(frame).getByText(/As of/)).toBeInTheDocument();
  });

  it('says the allowance could not be read rather than reporting no limit reached', async () => {
    readCapacityAlerts.mockResolvedValue(refused('denied'));
    renderScreen();
    const frame = card('attention.capacity.title');
    expect(await within(frame).findByRole('alert')).toHaveTextContent(
      EN['attention.state.denied'] as string
    );
    expect(within(frame).queryByText(EN['attention.capacity.empty'] as string)).toBeNull();
  });
});

describe('nothing on this screen writes', () => {
  it('reaches no write adapter, however full the cards are', async () => {
    readLowStockAlerts.mockResolvedValue(lowStock([lowStockRow()]));
    readCountDiscrepancyAlerts.mockResolvedValue(discrepancies([discrepancyRow()]));
    readUnusualConsumptionAlerts.mockResolvedValue(consumption([consumptionRow()]));
    readAgedInTransitAlerts.mockResolvedValue(inTransit([transitRow()]));
    readCapacityAlerts.mockResolvedValue(
      capacity([{ kind: 'users', used: 11, limit: 10, severity: 'over-limit', headroom: -1 }])
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);
    await within(card('attention.lowStock.title')).findByRole('row', { name: /Brake pad/ });

    // Every control the cards offer, exercised.
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    for (const [name, spy] of Object.entries(WRITERS)) {
      expect(spy, `${name} was called from a screen that only reads`).not.toHaveBeenCalled();
    }
  });

  it('holds no writer at all: the feature is one read and four presentational files', () => {
    /*
     * Read off disk rather than imported: the point is what the module CONTAINS,
     * and a mocked module would answer for itself. `api.ts` may export nothing
     * but async functions — it carries the Server Action directive — so the one
     * export it has is the whole of its surface.
     */
    const root = join(process.cwd(), 'src', 'features', 'attention');
    const adapter = readFileSync(join(root, 'api.ts'), 'utf8');
    expect([...adapter.matchAll(/export async function (\w+)/g)].map((match) => match[1])).toEqual([
      'readCapacityAlerts',
    ]);
    expect(adapter, 'a non-function export in a Server Action module').not.toMatch(
      /export (const|function|let|var|class)\s/
    );

    const sources = [
      'api.ts',
      'attention-contract.ts',
      'components/AttentionScreen.tsx',
      'components/cards.tsx',
    ].map((file) => readFileSync(join(root, file), 'utf8'));
    for (const source of sources) {
      // No transport verb, and no form that could carry one.
      expect(source).not.toMatch(/'POST'|"POST"|<form|useActionState|formAction/);
    }
  });
});

describe('the compact signal on the inventory screens', () => {
  it('states both counts from the reads, with the instant they were read', async () => {
    readLowStockAlerts.mockResolvedValue(lowStock([lowStockRow(), lowStockRow()]));
    readCountDiscrepancyAlerts.mockResolvedValue(discrepancies([discrepancyRow()]));
    renderLtr(
      <StockAlertIndicator
        messages={messagesFor('en')}
        locale="en"
        target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
      />
    );

    const indicator = await screen.findByTestId('stock-alert-indicator');
    expect(indicator).toHaveTextContent('2 items have reached their reorder level');
    expect(indicator).toHaveTextContent('1 differences found by a count are recorded');
    expect(indicator).toHaveTextContent(/As of/);
    expect(
      within(indicator).getByRole('link', { name: EN['inventory.signals.open'] as string })
    ).toHaveAttribute('href', '/en/attention');
    // A compact read of the head of each list, not the whole of it.
    expect(readLowStockAlerts).toHaveBeenCalledWith(
      { companyId: COMPANY_ID, branchId: BRANCH_ID },
      5
    );
  });

  it('says a capped list is capped instead of publishing a total nobody counted', async () => {
    readLowStockAlerts.mockResolvedValue(lowStock([lowStockRow()], true));
    renderLtr(
      <StockAlertIndicator
        messages={messagesFor('en')}
        locale="en"
        target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
      />
    );
    expect(await screen.findByTestId('stock-alert-indicator')).toHaveTextContent(
      'At least 1 items have reached their reorder level'
    );
  });

  it('says the signals could not be read rather than reporting none', async () => {
    readLowStockAlerts.mockResolvedValue(refused('unavailable'));
    renderLtr(
      <StockAlertIndicator
        messages={messagesFor('en')}
        locale="en"
        target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
      />
    );

    const indicator = await screen.findByTestId('stock-alert-indicator');
    expect(indicator).toHaveTextContent(EN['inventory.signals.unavailable'] as string);
    expect(indicator).not.toHaveTextContent(EN['inventory.signals.quiet'] as string);
    expect(indicator).not.toHaveTextContent('0 items');
    expect(indicator).toHaveTextContent(EN['inventory.signals.asOfMissing'] as string);
  });

  it('claims nothing about a branch nobody has named', () => {
    renderLtr(<StockAlertIndicator messages={messagesFor('en')} locale="en" target={null} />);
    expect(screen.queryByTestId('stock-alert-indicator')).toBeNull();
    expect(readLowStockAlerts).not.toHaveBeenCalled();
    expect(readCountDiscrepancyAlerts).not.toHaveBeenCalled();
  });
});

describe('the screen in Arabic, and the page that mounts it', () => {
  it('renders right to left with no serious accessibility finding', async () => {
    readLowStockAlerts.mockResolvedValue(lowStock([lowStockRow()]));
    readCapacityAlerts.mockResolvedValue(
      capacity([{ kind: 'branches', used: 5, limit: 5, severity: 'at-limit', headroom: 0 }])
    );
    const user = userEvent.setup();
    const { container } = renderRtl(
      <AttentionScreen
        locale="ar"
        messages={messagesFor('ar')}
        canReadStock
        canReadCapacity
        canReadBranches
      />
    );
    const select = await screen.findByLabelText(
      new RegExp(`^${AR['attention.target.branch'] as string}`)
    );
    await user.selectOptions(select, BRANCH_ID);
    await screen.findAllByText(/Brake pad/);

    expect(document.documentElement.dir).toBe('rtl');
    expect(container.textContent).toContain(AR['attention.lowStock.title']);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('refuses the page to a session holding neither code, and offers each half by its own', async () => {
    PERMISSIONS = [];
    const denied = await AttentionPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(rendersType(denied, PermissionDeniedState)).toBe(true);
    expect(findScreenProps(denied)).toBeNull();

    PERMISSIONS = ['org.tenant.read'];
    const capacityOnly = await AttentionPage({ params: Promise.resolve({ locale: 'en' }) });
    const props = findScreenProps(capacityOnly);
    expect(props?.['canReadStock']).toBe(false);
    expect(props?.['canReadCapacity']).toBe(true);

    PERMISSIONS = ['inv.stock.read', 'org.branch.read'];
    const stockOnly = await AttentionPage({ params: Promise.resolve({ locale: 'en' }) });
    const stockProps = findScreenProps(stockOnly);
    expect(stockProps?.['canReadStock']).toBe(true);
    expect(stockProps?.['canReadCapacity']).toBe(false);
    expect(stockProps?.['canReadBranches']).toBe(true);
  });
});

/** Whether a route's returned element tree renders one particular component. */
function rendersType(node: unknown, type: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) return true;
  const children = element.props?.['children'];
  return (Array.isArray(children) ? children : [children]).some((child) =>
    rendersType(child, type)
  );
}

/** The screen's props inside a route's returned element tree. */
function findScreenProps(node: unknown): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === AttentionScreen) return element.props ?? null;
  const children = element.props?.['children'];
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findScreenProps(child);
    if (found) return found;
  }
  return null;
}
