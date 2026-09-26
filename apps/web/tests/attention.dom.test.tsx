import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ar from '../src/i18n/messages/ar.json';
import { PermissionDeniedState } from '@/components/states/States';
import { flattenNavigation } from '@/config/navigation';
import { formatMessage } from '@/i18n/get-messages';
import { CLIENT_READ_TIMEOUT_MS, SERVER_READ_WORST_CASE_MS } from '@/lib/api/use-search-request';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  messagesFor,
  renderLtr,
  renderRtl,
} from './render';
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

/**
 * The dashboard's one read, mocked here for the same reason the five alert
 * reads are: this file is where the screens that tell an operator what needs
 * attention are proved, and the dashboard is now the first of them.
 */
const readDashboardSummary = vi.fn();
vi.mock('@/features/overview/dashboard-summary-read', () => ({
  readDashboardSummaryCancellable: (...args: unknown[]) => readDashboardSummary(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
  redirect: (target: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { target });
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
const { DashboardScreen } = await import('@/features/overview/components/DashboardScreen');
const { CHART_WIDTH, LABEL_FONT_SIZE, LABEL_TEXT_WIDTH, estimatedTextWidth, fitLabel } =
  await import('@/features/overview/components/charts');
const { StockAlertIndicator } = await import('@/features/inventory/components/StockAlertIndicator');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const AttentionPage = (await import('@/app/[locale]/(dashboard)/attention/page'))
  .default as unknown as RoutePage;
type SearchedRoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<React.ReactNode>;
const DashboardPage = (await import('@/app/[locale]/(dashboard)/page'))
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

  it('opens on the branch the address names, once its list holds it', async () => {
    // The dashboard sends the branch its low-stock figure was counted for.
    renderLtr(
      <AttentionScreen
        locale="en"
        messages={messagesFor('en')}
        canReadStock
        canReadCapacity
        canReadBranches
        initialBranchId={BRANCH_ID}
      />
    );

    const pair = { companyId: COMPANY_ID, branchId: BRANCH_ID };
    await waitFor(() => expect(readLowStockAlerts).toHaveBeenCalledWith(pair));
    expect(
      ((await screen.findByLabelText(labelled('attention.target.branch'))) as HTMLSelectElement)
        .value
    ).toBe(BRANCH_ID);
  });

  it('ignores a branch its own list does not hold, and asks as it always did', async () => {
    renderLtr(
      <AttentionScreen
        locale="en"
        messages={messagesFor('en')}
        canReadStock
        canReadCapacity
        canReadBranches
        initialBranchId="99999999-9999-4999-8999-999999999999"
      />
    );
    await screen.findByLabelText(labelled('attention.target.branch'));

    expect(readLowStockAlerts).not.toHaveBeenCalled();
    expect(
      within(card('attention.lowStock.title')).getByText(EN['attention.state.noBranch'] as string)
    ).toBeInTheDocument();
  });

  it('believes only an identifier-shaped branch from the address', async () => {
    PERMISSIONS = ['inv.stock.read', 'org.branch.read'];
    const page = AttentionPage as unknown as SearchedRoutePage;

    const named = await page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ branchId: BRANCH_ID }),
    });
    expect(findScreenProps(named)?.['initialBranchId']).toBe(BRANCH_ID);

    for (const junk of ['brake pads', '../admin', '', ['a', 'b']]) {
      const dropped = await page({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ branchId: junk }),
      });
      expect(findScreenProps(dropped)?.['initialBranchId'], String(junk)).toBeNull();
    }
  });
});

describe('the stock cards open on the working branch (route sweep B3)', () => {
  function renderIn(snapshot = branchSnapshot(), initialBranchId: string | null = null) {
    return renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <AttentionScreen
            locale="en"
            messages={messagesFor('en')}
            canReadStock
            canReadCapacity
            canReadBranches
            initialBranchId={initialBranchId}
          />
        </>,
        { snapshot }
      )
    );
  }

  it('reads the working branch on arrival, with no branch to choose first', async () => {
    renderIn();
    const pair = { companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id };
    await waitFor(() => expect(readLowStockAlerts).toHaveBeenCalledWith(pair));
    await waitFor(() => expect(readAgedInTransitAlerts).toHaveBeenCalledWith(pair));
    expect(
      ((await screen.findByLabelText(labelled('attention.target.branch'))) as HTMLSelectElement)
        .value
    ).toBe(TEST_BRANCH.id);
  });

  it('follows a switch of the working branch to the new branch', async () => {
    const user = userEvent.setup();
    try {
      renderIn(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
      // Several branches and none chosen in the header: nothing is read yet.
      await screen.findByLabelText(labelled('attention.target.branch'));
      expect(readLowStockAlerts).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'second' }));
      await waitFor(() =>
        expect(readLowStockAlerts).toHaveBeenLastCalledWith({
          companyId: TEST_COMPANY.id,
          branchId: OTHER_BRANCH.id,
        })
      );
    } finally {
      window.localStorage.clear();
    }
  });

  it('an address that names a branch wins on arrival', async () => {
    renderIn(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]), OTHER_BRANCH.id);
    await waitFor(() =>
      expect(readLowStockAlerts).toHaveBeenCalledWith({
        companyId: TEST_COMPANY.id,
        branchId: OTHER_BRANCH.id,
      })
    );
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

  it('names the count each difference came from, so two of them are not one row', async () => {
    /*
     * Two counts, same shelf, same item, same day. The card used to draw a
     * generic label beside a date on both, which made a row that cannot be
     * matched to the count it came from — and a link to a list of counts is not
     * a link to THE count until the row says which one.
     */
    readCountDiscrepancyAlerts.mockResolvedValue(
      discrepancies([
        discrepancyRow({ countId: 'aaaaaaaa-1111', lineId: 'line-1', varianceQty: '-2.000' }),
        discrepancyRow({ countId: 'bbbbbbbb-2222', lineId: 'line-2', varianceQty: '-5.000' }),
      ])
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.discrepancy.title');
    const first = await within(frame).findByText('Count reference aaaaaaaa');
    const second = within(frame).getByText('Count reference bbbbbbbb');
    expect(first.closest('tr')).not.toBe(second.closest('tr'));
    // And the count is placed, not only numbered: where it was taken is on the
    // row beside the reference rather than filed under the item.
    expect(first.closest('tr')).toHaveTextContent('A-01');
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

  it('names both BRANCHES, and says so when one is not in the list it was given', async () => {
    /*
     * The column asks which two branches a transfer runs between. It used to
     * answer with two stock LOCATION codes, which is a different question: the
     * read carries the branches as identifiers only, so the names come from the
     * branch list the picker already loaded. A branch outside that list is
     * named as outside it — never replaced by a shelf code, which would read as
     * an answer.
     */
    readAgedInTransitAlerts.mockResolvedValue(
      inTransit([transitRow({ fromBranchId: BRANCH_ID, toBranchId: 'branch-elsewhere' })])
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseTheBranch(user);

    const frame = card('attention.inTransit.title');
    const row = await within(frame).findByRole('row', { name: /Brake pad/ });
    expect(row).toHaveTextContent(`From ${branch.name} to a branch not in your list`);
    // The shelf codes stay, below, as the detail they are.
    expect(row).toHaveTextContent('A-01');
    expect(row).toHaveTextContent('B-02');
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

/* -------------------------------------------------------------------------- *
 * The dashboard (Owner directive, `P1-32-PRE-OD-UX`)
 *
 * It lives in this file because it is the same question this suite already
 * asks of the Attention area: does a screen that summarises a workshop state
 * only what it was told, and does it say the difference between "none",
 * "not yours to see" and "we could not find out"?
 * -------------------------------------------------------------------------- */

/** A section the platform computed. */
function figure<T>(value: T) {
  return { status: 'ok' as const, value };
}
/** A section this reader may not see. NEVER to be rendered as a zero. */
const WITHHELD = { status: 'unauthorized' as const };
/** A section the platform cannot answer at all. */
function unanswerable(reason: string) {
  return { status: 'unavailable' as const, reason };
}

const GENERATED_AT = '2026-09-22T09:00:00.000Z';

function dashboardSummary(over: Record<string, unknown> = {}) {
  return {
    period: {
      kind: 'today',
      from: '2026-09-22',
      to: '2026-09-22',
      timezone: 'Asia/Riyadh',
    },
    generatedAt: GENERATED_AT,
    branchIds: [TEST_BRANCH.id],
    sections: {
      receptionsOpened: figure(4),
      activeWorkOrders: figure(7),
      awaitingApproval: figure(2),
      awaitingParts: figure(1),
      // Withheld on purpose: the delivery code gates it, and plenty of readers
      // of this screen do not hold it.
      readyForDelivery: WITHHELD,
      completedInPeriod: figure(5),
      workOrdersByState: figure([
        { state: 'in_progress', label: 'In progress', count: 5, isTerminal: false },
        // A code the platform does not define: the workshop's own word for it
        // is what must appear, never the code and never a guess.
        { state: 'awaiting_insurer', label: 'With the insurer', count: 2, isTerminal: false },
        { state: 'closed', label: 'Closed', count: 3, isTerminal: true },
      ]),
      intakeCompletionTrend: figure([
        { date: '2026-09-21', opened: 2, completed: 1 },
        { date: '2026-09-22', opened: 3, completed: 4 },
      ]),
      technicianWorkload: figure([
        { technicianId: 'tech-1', displayName: 'Technician one', activeCount: 3 },
        { technicianId: 'tech-2', displayName: null, activeCount: 1 },
      ]),
      lowStock: figure(6),
      pendingApprovalsCount: figure(2),
      overdue: unanswerable('nothing records when a work order was promised'),
      ...over,
    },
  };
}

/** The tile for one figure, found by the section it renders. */
function tile(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector(`[data-figure="${id}"]`);
  if (!element) throw new Error(`no tile for ${id}`);
  return element as HTMLElement;
}

/** The chart section under a heading, by the heading's own words. */
function chart(headingKey: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: EN[headingKey] as string });
  const section = heading.closest('section');
  if (!section) throw new Error(`no chart under ${headingKey}`);
  return section as HTMLElement;
}

describe('the dashboard reads once for the branch it is addressed to', () => {
  beforeEach(() => {
    // The working branch is REMEMBERED between visits, and the store outlives a
    // single case. Cleared here so each one starts where a first-time reader
    // does: nothing chosen, and nothing read until something is.
    window.localStorage.clear();
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue(okRead(dashboardSummary()));
  });

  it('asks for today, for the working branch, exactly once', async () => {
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));

    await screen.findByText('7');
    expect(readDashboardSummary).toHaveBeenCalledTimes(1);
    expect(readDashboardSummary).toHaveBeenCalledWith(
      { companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id },
      { period: 'today' },
      // The read is cancellable: it carries the signal its effect aborts.
      expect.any(AbortSignal)
    );
  });

  it('states the period it covers and the moment the figures were taken', async () => {
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );

    await screen.findByText('7');
    // The zone the days were counted in travels in the answer and is said, so a
    // reader in another one knows which midnight the figures stop at.
    expect(container.textContent).toContain('Asia/Riyadh');
    expect(screen.getByText(/Figures as they stood at/)).toBeTruthy();
  });

  it('asks again, for the new period, when the period changes', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    await user.click(
      screen.getByRole('button', { name: EN['dashboard.period.yesterday'] as string })
    );

    await waitFor(() => {
      expect(readDashboardSummary).toHaveBeenCalledTimes(2);
    });
    expect(readDashboardSummary).toHaveBeenLastCalledWith(
      { companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id },
      { period: 'yesterday' },
      // The read is cancellable: it carries the signal its effect aborts.
      expect.any(AbortSignal)
    );
  });

  it('refuses a period that ends before it starts, at the field', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    await user.click(screen.getByRole('button', { name: EN['dashboard.period.custom'] as string }));
    const from = screen.getByLabelText(EN['dashboard.period.from'] as string);
    const to = screen.getByLabelText(EN['dashboard.period.to'] as string);
    await user.type(from, '2026-09-10');
    await user.type(to, '2026-09-01');
    await user.click(screen.getByRole('button', { name: EN['dashboard.period.apply'] as string }));

    expect(screen.getByText(EN['dashboard.period.inverted'] as string)).toBeTruthy();
    // Refused here, so nothing was sent: the first read is still the only one.
    expect(readDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('refuses a period longer than the operation accepts, at the field', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    await user.click(screen.getByRole('button', { name: EN['dashboard.period.custom'] as string }));
    await user.type(screen.getByLabelText(EN['dashboard.period.from'] as string), '2026-01-01');
    await user.type(screen.getByLabelText(EN['dashboard.period.to'] as string), '2026-12-31');
    await user.click(screen.getByRole('button', { name: EN['dashboard.period.apply'] as string }));

    expect(screen.getByText(EN['dashboard.period.tooLong'] as string)).toBeTruthy();
    expect(readDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('never shows the previous branch figures under the new branch', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first branch" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second branch" />
          <DashboardScreen locale="en" messages={messagesFor('en')} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );

    // Two branches and none chosen: the header asks, and nothing is read.
    expect(readDashboardSummary).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'first branch' }));
    await screen.findByText('7');

    // The next answer never arrives. The figures of the branch just left must
    // not sit under the new branch's heading while it is in flight.
    readDashboardSummary.mockReturnValueOnce(new Promise(() => undefined));
    await user.click(screen.getByRole('button', { name: 'second branch' }));

    await waitFor(() => {
      expect(screen.queryByText('7')).toBeNull();
    });
    expect(readDashboardSummary).toHaveBeenLastCalledWith(
      { companyId: TEST_COMPANY.id, branchId: OTHER_BRANCH.id },
      { period: 'today' },
      // The read is cancellable: it carries the signal its effect aborts.
      expect.any(AbortSignal)
    );
  });

  /*
   * Browser QA part 7, row 7.4: a refresh whose call failed left the figures
   * gone and the header reading "Reading the figures for this period." eight
   * seconds later — no sentence, no retry. The Server Action call REJECTED
   * (a 503 from the web tier), nothing caught it, and no answer was ever held.
   */
  it('says a failed refresh is unavailable, stops "Reading", and offers the read again', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    readDashboardSummary.mockRejectedValueOnce(
      new Error('An unexpected response was received from the server.')
    );
    await user.click(screen.getByRole('button', { name: EN['dashboard.refresh'] as string }));

    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeTruthy();
    expect(screen.queryByText(EN['dashboard.period.pending'] as string)).toBeNull();
    expect(screen.queryByText('7')).toBeNull();

    await user.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    await screen.findByText('7');
    expect(readDashboardSummary).toHaveBeenCalledTimes(3);
  });

  it('says a read that failed at the network is unavailable, not still being read', async () => {
    readDashboardSummary.mockReset();
    readDashboardSummary.mockRejectedValue(new TypeError('Failed to fetch'));
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));

    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeTruthy();
    expect(screen.queryByText(EN['dashboard.period.pending'] as string)).toBeNull();
    expect(screen.getByRole('button', { name: EN['state.retry'] as string })).toBeTruthy();
  });

  it('offers the read again beside a fault the service answered', async () => {
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue({ status: 'error', correlationId: 'corr-dash' });
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));

    expect(await screen.findByText(EN['state.error.title'] as string)).toBeTruthy();
    expect(screen.getByText('corr-dash')).toBeTruthy();
    expect(screen.getByRole('button', { name: EN['state.retry'] as string })).toBeTruthy();
  });

  it('shows no outage while a branch switch abandons the read in flight', async () => {
    // Abandoning the old branch's read settles it with the failure value. That
    // is the operator moving on, not the service failing, so the new branch
    // reads "Reading the figures" — never "unavailable", not even for a frame.
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first branch" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second branch" />
          <DashboardScreen locale="en" messages={messagesFor('en')} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    readDashboardSummary.mockReturnValueOnce(new Promise(() => undefined));
    await user.click(screen.getByRole('button', { name: 'first branch' }));
    await waitFor(() => expect(readDashboardSummary).toHaveBeenCalledTimes(1));

    const unavailable = EN['state.unavailable.title'] as string;
    let flashed = false;
    const observer = new MutationObserver(() => {
      if (document.body.textContent?.includes(unavailable)) flashed = true;
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    try {
      readDashboardSummary.mockReturnValueOnce(new Promise(() => undefined));
      await user.click(screen.getByRole('button', { name: 'second branch' }));
      await waitFor(() => expect(readDashboardSummary).toHaveBeenCalledTimes(2));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText(EN['dashboard.period.pending'] as string)).toBeTruthy();
      expect(screen.queryByText(unavailable)).toBeNull();
      expect(flashed).toBe(false);
    } finally {
      observer.disconnect();
    }
  });

  it('gives up on a read that never answers at the client ceiling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      readDashboardSummary.mockReset();
      readDashboardSummary.mockReturnValue(new Promise(() => undefined));
      renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
      await waitFor(() => expect(readDashboardSummary).toHaveBeenCalledTimes(1));
      expect(screen.getByText(EN['dashboard.period.pending'] as string)).toBeTruthy();

      // Not abandoned while the server may still be retrying it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SERVER_READ_WORST_CASE_MS);
      });
      expect(screen.getByText(EN['dashboard.period.pending'] as string)).toBeTruthy();
      expect(screen.queryByText(EN['state.unavailable.title'] as string)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - SERVER_READ_WORST_CASE_MS);
      });
      expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeTruthy();
      expect(screen.queryByText(EN['dashboard.period.pending'] as string)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for nothing, and says why, when the branches span two companies', async () => {
    const elsewhere = { ...OTHER_BRANCH, companyId: '99999999-9999-4999-8999-999999999999' };
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="everywhere" />
          <DashboardScreen locale="en" messages={messagesFor('en')} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, elsewhere]) }
      )
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'everywhere' }));

    expect(await screen.findByText(EN['workingContext.spansCompanies'] as string)).toBeTruthy();
    expect(readDashboardSummary).not.toHaveBeenCalled();
  });
});

describe('a withheld figure is not a zero, and an unanswerable one is not either', () => {
  beforeEach(() => {
    // The working branch is REMEMBERED between visits, and the store outlives a
    // single case. Cleared here so each one starts where a first-time reader
    // does: nothing chosen, and nothing read until something is.
    window.localStorage.clear();
    readDashboardSummary.mockReset();
  });

  it('renders the three section states as three different statements', async () => {
    readDashboardSummary.mockResolvedValue(
      okRead(
        dashboardSummary({
          completedInPeriod: unanswerable('the platform cannot work this out'),
        })
      )
    );
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    // Computed: the number, and nothing else.
    expect(tile(container, 'activeWorkOrders').textContent).toContain('7');

    // Withheld: said in words, and NEVER as a figure of any kind.
    const withheld = tile(container, 'readyForDelivery');
    expect(withheld.textContent).toContain(EN['dashboard.card.withheld']);
    expect(withheld.textContent).not.toContain('0');

    // Unanswerable: a third sentence, distinct from the refusal above.
    const cannot = tile(container, 'completedInPeriod');
    expect(cannot.textContent).toContain(EN['dashboard.card.unavailable']);
    expect(cannot.textContent).not.toContain('0');
    expect(cannot.textContent).not.toContain(EN['dashboard.card.withheld']);
  });

  it('says nothing at all about lateness', async () => {
    readDashboardSummary.mockResolvedValue(okRead(dashboardSummary()));
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    // The summary publishes `overdue` as permanently unanswerable, and this
    // screen draws no card for it: the platform records no promised date, so
    // there is nothing here that could be late.
    expect(container.querySelector('[data-figure="overdue"]')).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain('overdue');
  });

  it('withholds a whole chart in words when its section is withheld', async () => {
    readDashboardSummary.mockResolvedValue(
      okRead(dashboardSummary({ technicianWorkload: WITHHELD }))
    );
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    expect(screen.getByText(EN['dashboard.section.withheld'] as string)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EN['dashboard.workload.title'] as string })).toBe(
      null
    );
  });

  it('says a refusal of the whole read with its reference', async () => {
    readDashboardSummary.mockResolvedValue({ status: 'denied', correlationId: 'ref-77' });
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );

    await screen.findByText(EN['state.denied.title'] as string);
    expect(container.textContent).toContain('ref-77');
  });
});

describe('every figure opens the list it counted', () => {
  beforeEach(() => {
    // The working branch is REMEMBERED between visits, and the store outlives a
    // single case. Cleared here so each one starts where a first-time reader
    // does: nothing chosen, and nothing read until something is.
    window.localStorage.clear();
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue(okRead(dashboardSummary()));
  });

  it('carries the view a work-order figure was counted over', async () => {
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    expect(tile(container, 'activeWorkOrders').getAttribute('href')).toBe('/en/work-orders');
    expect(tile(container, 'awaitingApproval').getAttribute('href')).toBe(
      '/en/work-orders?view=awaitingApproval'
    );
    expect(tile(container, 'awaitingParts').getAttribute('href')).toBe(
      '/en/work-orders?view=awaitingParts'
    );
  });

  it('carries the period a reception figure was counted over', async () => {
    const user = userEvent.setup();
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    expect(tile(container, 'receptionsOpened').getAttribute('href')).toBe(
      '/en/receptions?period=today'
    );

    await user.click(screen.getByRole('button', { name: EN['dashboard.period.last7'] as string }));
    await waitFor(() => {
      expect(tile(container, 'receptionsOpened').getAttribute('href')).toBe(
        '/en/receptions?period=last7'
      );
    });
  });

  it('sends a stock figure to that branch on the page where stock is acted on', async () => {
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    // The branch the figure was counted for travels, so the page opens on it.
    const stock = tile(container, 'lowStock');
    expect(stock.getAttribute('href')).toBe(`/en/attention?branchId=${TEST_BRANCH.id}`);
    // A RELATED destination, never "the list": the figure counts distinct items
    // and the page lists findings, one per reorder level, capped.
    expect(stock.textContent).toContain(EN['dashboard.card.reviewBranchStock']);
    expect(stock.textContent).not.toContain(EN['dashboard.card.openTheList']);
  });

  it('claims no list for a stock figure counted across every branch', async () => {
    const user = userEvent.setup();
    const { container } = renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="everywhere" />
          <DashboardScreen locale="en" messages={messagesFor('en')} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    await screen.findByText('7');
    expect(readDashboardSummary).toHaveBeenLastCalledWith(
      { companyId: TEST_COMPANY.id, branchId: null },
      { period: 'today' },
      // The read is cancellable: it carries the signal its effect aborts.
      expect.any(AbortSignal)
    );

    // No one branch to open on, and words that say the warnings are reviewed
    // branch by branch rather than implying a company-wide list of this figure.
    const stock = tile(container, 'lowStock');
    expect(stock.getAttribute('href')).toBe('/en/attention');
    expect(stock.textContent).toContain(EN['dashboard.card.reviewStockByBranch']);
    expect(stock.textContent).not.toContain(EN['dashboard.card.openTheList']);
    // The work-order figures still open their lists: the board reads the same
    // authorized branch set the summary counted.
    expect(tile(container, 'awaitingParts').textContent).toContain(
      EN['dashboard.card.openTheList']
    );
  });

  it('offers no link for a figure no list can be narrowed to', async () => {
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    // The board takes an OPENED window and no completed one. A link to the
    // unfiltered board would answer a different question from the one the
    // figure asked, so the tile is not a link at all.
    expect(tile(container, 'completedInPeriod').tagName).toBe('DIV');
  });

  it('puts what is waiting for someone beside where it is dealt with', async () => {
    readDashboardSummary.mockResolvedValue(
      okRead(
        dashboardSummary({
          // Two ORDERS held up by five REQUESTS: different numbers on purpose,
          // so the case can tell which one sits beside the link.
          awaitingApproval: figure(2),
          pendingApprovalsCount: figure(5),
        })
      )
    );
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    const panel = screen
      .getByRole('heading', { name: EN['dashboard.actions.title'] as string })
      .closest('section') as HTMLElement;

    // The link opens a list of WORK ORDERS, so the figure beside it is the
    // number of work orders — never the number of requests.
    const orders = container.querySelector('[data-actionable="approvalOrders"]') as HTMLElement;
    expect(orders.textContent).toContain(EN['dashboard.actions.approvalOrders']);
    expect(orders.querySelector('strong')?.textContent).toBe('2');
    expect(
      within(orders)
        .getByRole('link', { name: EN['dashboard.actions.openApprovals'] as string })
        .getAttribute('href')
    ).toBe('/en/work-orders?view=awaitingApproval');

    // The requests are said on their own line, and that line offers no link.
    const requests = container.querySelector('[data-actionable="approvalRequests"]') as HTMLElement;
    expect(requests.textContent).toContain(EN['dashboard.actions.approvals']);
    expect(requests.querySelector('strong')?.textContent).toBe('5');
    expect(within(requests).queryByRole('link')).toBeNull();

    expect(
      within(panel)
        .getAllByRole('link', { name: EN['dashboard.actions.openAttention'] as string })[0]
        ?.getAttribute('href')
    ).toBe(`/en/attention?branchId=${TEST_BRANCH.id}`);
  });
});

describe('the charts are drawings with the figures written out beside them', () => {
  beforeEach(() => {
    // The working branch is REMEMBERED between visits, and the store outlives a
    // single case. Cleared here so each one starts where a first-time reader
    // does: nothing chosen, and nothing read until something is.
    window.localStorage.clear();
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue(okRead(dashboardSummary()));
  });

  it('names what each drawing is, for a reader who cannot see it', async () => {
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    const drawings = container.querySelectorAll('svg[role="img"]');
    expect(drawings.length).toBe(3);
    for (const drawing of Array.from(drawings)) {
      expect(drawing.querySelector('title')?.textContent).toBeTruthy();
      expect(drawing.querySelector('desc')?.textContent).toBeTruthy();
    }
  });

  it('offers the states as a table, each row opening its own list', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    const section = chart('dashboard.byState.title');
    await user.click(
      within(section).getByRole('button', { name: EN['dashboard.chart.showTable'] as string })
    );

    const table = within(section).getByRole('table');
    // The platform's own word for its own state, and the workshop's word for
    // the state the platform does not define.
    expect(within(table).getByText('In progress')).toBeTruthy();
    expect(within(table).getByText('With the insurer')).toBeTruthy();
    expect(
      within(table)
        .getByRole('link', { name: /With the insurer/ })
        .getAttribute('href')
    ).toBe('/en/work-orders?state=awaiting_insurer');
    // A finished state is marked in words, not by colour alone.
    expect(within(table).getAllByText(EN['dashboard.byState.finished'] as string).length).toBe(1);
  });

  it('offers the trend as a table with a row for every day', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    const section = chart('dashboard.trend.title');
    await user.click(
      within(section).getByRole('button', { name: EN['dashboard.chart.showTable'] as string })
    );

    const rows = within(within(section).getByRole('table')).getAllByRole('row');
    // One head row and one row per day of the answer.
    expect(rows.length).toBe(3);
  });

  it('says a technician whose name is withheld, rather than inventing one', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    const section = chart('dashboard.workload.title');
    await user.click(
      within(section).getByRole('button', { name: EN['dashboard.chart.showTable'] as string })
    );

    expect(
      within(section).getAllByText(EN['dashboard.workload.unnamed'] as string).length
    ).toBeGreaterThan(0);
  });

  it('draws nothing at all for a period in which nothing happened', async () => {
    readDashboardSummary.mockResolvedValue(
      okRead(
        dashboardSummary({
          workOrdersByState: figure([]),
          intakeCompletionTrend: figure([
            { date: '2026-09-21', opened: 0, completed: 0 },
            { date: '2026-09-22', opened: 0, completed: 0 },
          ]),
        })
      )
    );
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    expect(screen.getByText(EN['dashboard.byState.emptyTitle'] as string)).toBeTruthy();
    expect(screen.getByText(EN['dashboard.trend.emptyTitle'] as string)).toBeTruthy();
  });
});

describe('the dashboard in Arabic, and reachable from the keyboard', () => {
  beforeEach(() => {
    // The working branch is REMEMBERED between visits, and the store outlives a
    // single case. Cleared here so each one starts where a first-time reader
    // does: nothing chosen, and nothing read until something is.
    window.localStorage.clear();
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue(okRead(dashboardSummary()));
  });

  it('is written in Arabic, in a right-to-left document', async () => {
    renderRtl(
      inBranch(<DashboardScreen locale="ar" messages={messagesFor('ar')} />, { locale: 'ar' })
    );

    expect(
      await screen.findByRole('button', { name: AR['dashboard.period.today'] as string })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: AR['dashboard.refresh'] as string })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: AR['dashboard.byState.title'] as string })
    ).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('reaches the period controls and the refresh in the order they are read', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: EN['dashboard.period.today'] as string })
    );
    for (let step = 0; step < 3; step += 1) await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: EN['dashboard.period.custom'] as string })
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: EN['dashboard.refresh'] as string })
    );
  });

  it('asks again when the refresh is pressed', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    await user.click(screen.getByRole('button', { name: EN['dashboard.refresh'] as string }));

    await waitFor(() => {
      expect(readDashboardSummary).toHaveBeenCalledTimes(2);
    });
  });
});

describe('the dashboard answers for the period and the branch it is showing', () => {
  beforeEach(() => {
    window.localStorage.clear();
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue(okRead(dashboardSummary()));
  });

  it('discards an answer that arrives after the one that replaced it', async () => {
    // The ordering that makes a screen lie: a slow read for the OLD period
    // lands after the fast read for the new one, and the reader sees figures
    // for a period the heading no longer names.
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    readDashboardSummary.mockReturnValueOnce(slow);
    readDashboardSummary.mockResolvedValue(
      okRead(dashboardSummary({ activeWorkOrders: figure(99) }))
    );

    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await user.click(
      screen.getByRole('button', { name: EN['dashboard.period.yesterday'] as string })
    );
    await screen.findByText('99');

    release(okRead(dashboardSummary({ activeWorkOrders: figure(7) })));
    await act(async () => {
      await slow;
    });

    expect(screen.queryByText('7')).toBeNull();
    expect(screen.getByText('99')).toBeTruthy();
  });

  it('says which period the figures still cover while dates are being chosen', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    await user.click(screen.getByRole('button', { name: EN['dashboard.period.custom'] as string }));

    // Pressing the control changes no figure — no days have been named yet —
    // so the screen must not read as though it had.
    expect(
      screen.getByText(
        formatMessage(EN['dashboard.period.notApplied'] as string, {
          period: EN['dashboard.period.today'] as string,
        })
      )
    ).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(readDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('drops that line once the chosen days are applied', async () => {
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    await user.click(screen.getByRole('button', { name: EN['dashboard.period.custom'] as string }));
    await user.type(screen.getByLabelText(EN['dashboard.period.from'] as string), '2026-09-01');
    await user.type(screen.getByLabelText(EN['dashboard.period.to'] as string), '2026-09-10');
    await user.click(screen.getByRole('button', { name: EN['dashboard.period.apply'] as string }));

    await waitFor(() => {
      expect(readDashboardSummary).toHaveBeenLastCalledWith(
        { companyId: TEST_COMPANY.id, branchId: TEST_BRANCH.id },
        { period: 'custom', from: '2026-09-01', to: '2026-09-10' },
        // The read is cancellable: it carries the signal its effect aborts.
        expect.any(AbortSignal)
      );
    });
    expect(
      screen.queryByText(
        formatMessage(EN['dashboard.period.notApplied'] as string, {
          period: EN['dashboard.period.today'] as string,
        })
      )
    ).toBeNull();
  });

  it('puts every state within reach of a keyboard, outside the drawing', async () => {
    const { container } = renderLtr(
      inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />)
    );
    await screen.findByText('7');

    // Nothing inside the drawing is a control: a shape under `role="img"` is
    // pruned from the accessibility tree along with anything nested in it, so a
    // link drawn there would exist for a mouse and for nobody else.
    expect(container.querySelectorAll('svg a').length).toBe(0);

    const link = screen.getByRole('link', { name: /With the insurer/ });
    expect(link.closest('svg')).toBeNull();
    expect(link.getAttribute('href')).toBe('/en/work-orders?state=awaiting_insurer');
    (link as HTMLElement).focus();
    expect(document.activeElement).toBe(link);

    // One per state, and the table is not the only way to any of them.
    for (const label of ['In progress', 'Closed']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
  });
});

describe('the charts anchor their words to a side, whatever the document direction', () => {
  beforeEach(() => {
    window.localStorage.clear();
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue(okRead(dashboardSummary()));
  });

  /** The `<text>` elements of the state chart, in document order. */
  function stateChartTexts(headingText: string): readonly SVGTextElement[] {
    const heading = screen.getByRole('heading', { name: headingText });
    const drawing = heading.closest('section')?.querySelector('svg');
    if (!drawing) throw new Error('no state chart drawing');
    expect(drawing.getAttribute('direction')).toBe('ltr');
    return Array.from(drawing.querySelectorAll('text'));
  }

  /** x, anchor and direction of one text element — what jsdom CAN observe. */
  const geometry = (text: SVGTextElement | undefined) => ({
    x: text?.getAttribute('x'),
    anchor: text?.getAttribute('text-anchor'),
    direction: text?.getAttribute('direction'),
  });

  /**
   * The physical extent of a count's text in drawing units, from its anchor:
   * `start` grows rightwards from `x`, `end` leftwards. Budgeted by the same
   * conservative estimate the chart lays out with, since jsdom measures nothing.
   */
  function extent(text: SVGTextElement | undefined): { left: number; right: number } {
    const x = Number(text?.getAttribute('x'));
    const width = estimatedTextWidth(text?.textContent ?? '', LABEL_FONT_SIZE);
    return text?.getAttribute('text-anchor') === 'end'
      ? { left: x - width, right: x }
      : { left: x, right: x + width };
  }

  it('puts a label at the left margin and its count past the bar, left to right', async () => {
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    // Row one is "In progress", the longest bar (5 of 5): label at the left
    // inset, count just past the bar's right end, both growing rightwards —
    // and the bar stops short of the far margin by the count gutter, so the
    // count is inside the drawing rather than starting at its last 4 units.
    const [label, count] = stateChartTexts(EN['dashboard.byState.title'] as string);
    expect(geometry(label)).toEqual({ x: '4', anchor: 'start', direction: 'ltr' });
    expect(geometry(count)).toEqual({ x: '532', anchor: 'start', direction: 'ltr' });
    expect(extent(count).left).toBeGreaterThanOrEqual(0);
    expect(extent(count).right).toBeLessThanOrEqual(CHART_WIDTH);
    // The words sit in an isolate that takes its own direction from its text —
    // as the presentation attribute AND as the CSS declaration.
    const words = label?.querySelector('tspan');
    expect(words?.getAttribute('unicode-bidi')).toBe('plaintext');
    expect(words?.style.unicodeBidi).toBe('plaintext');
  });

  it('keeps the largest count wholly inside the drawing, in both directions', async () => {
    // A figure with many digits on the longest bar of each bar chart: the
    // gutter widens to fit it, so it can never be clipped by the viewBox.
    readDashboardSummary.mockResolvedValue(
      okRead(
        dashboardSummary({
          workOrdersByState: figure([
            { state: 'in_progress', label: 'In progress', count: 1234567, isTerminal: false },
            { state: 'awaiting_parts', label: 'Waiting for parts', count: 3, isTerminal: false },
          ]),
          technicianWorkload: figure([
            { technicianId: 'tech-1', displayName: 'Technician', activeCount: 9876543 },
            { technicianId: 'tech-2', displayName: 'Second', activeCount: 1 },
          ]),
        })
      )
    );
    for (const [render, locale] of [
      [renderLtr, 'en'],
      [renderRtl, 'ar'],
    ] as const) {
      window.localStorage.clear();
      const { unmount } = render(
        inBranch(<DashboardScreen locale={locale} messages={messagesFor(locale)} />, { locale })
      );
      const messages = locale === 'en' ? EN : AR;
      for (const headingKey of ['dashboard.byState.title', 'dashboard.workload.title']) {
        // The drawing appears once the read has answered.
        const [, count] = await waitFor(() => {
          const texts = stateChartTexts(messages[headingKey] as string);
          expect(texts.length).toBeGreaterThan(1);
          return texts;
        });
        const where = `${locale} ${headingKey}`;
        expect(count?.textContent?.length, where).toBeGreaterThan(6);
        expect(extent(count).left, where).toBeGreaterThanOrEqual(0);
        expect(extent(count).right, where).toBeLessThanOrEqual(CHART_WIDTH);
      }
      unmount();
    }
  });

  it('mirrors both to the other side in Arabic, with the anchor naming the RIGHT edge', async () => {
    renderRtl(
      inBranch(<DashboardScreen locale="ar" messages={messagesFor('ar')} />, { locale: 'ar' })
    );
    await screen.findByRole('heading', { name: AR['dashboard.byState.title'] as string });
    expect(document.documentElement.dir).toBe('rtl');

    // `direction="ltr"` on the element is what makes `end` mean the right edge
    // here; inherited from the rtl document it would have meant the left one,
    // and the label would have hung off the drawing.
    const [label, count] = stateChartTexts(AR['dashboard.byState.title'] as string);
    expect(geometry(label)).toEqual({ x: '596', anchor: 'end', direction: 'ltr' });
    // The count ends 68 units from the left edge — the mirror of 532 — so the
    // whole of it is drawn, rather than ending at x = 4 and running off.
    expect(geometry(count)).toEqual({ x: '68', anchor: 'end', direction: 'ltr' });
    expect(extent(count).left).toBeGreaterThanOrEqual(0);
    expect(extent(count).right).toBeLessThanOrEqual(CHART_WIDTH);
  });

  it('cuts a label that cannot fit the label column, and keeps the whole of it', async () => {
    const long = 'Waiting for the insurance assessor to call back';
    readDashboardSummary.mockResolvedValue(
      okRead(
        dashboardSummary({
          workOrdersByState: figure([
            { state: 'awaiting_assessor', label: long, count: 2, isTerminal: false },
          ]),
          technicianWorkload: figure([
            { technicianId: 'tech-1', displayName: long, activeCount: 1 },
          ]),
        })
      )
    );
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    for (const headingKey of ['dashboard.byState.title', 'dashboard.workload.title']) {
      const [label] = stateChartTexts(EN[headingKey] as string);
      const drawn = label?.querySelector('tspan')?.textContent ?? '';
      expect(drawn.endsWith('…'), headingKey).toBe(true);
      expect(Array.from(drawn).length).toBeLessThanOrEqual(25);
      expect(long.startsWith(drawn.slice(0, -1))).toBe(true);
      // The whole wording stays with the label for a pointer...
      expect(label?.querySelector('title')?.textContent).toBe(long);
    }

    // ...and in the table alternative, uncut.
    const section = chart('dashboard.byState.title');
    await user.click(
      within(section).getByRole('button', { name: EN['dashboard.chart.showTable'] as string })
    );
    expect(within(within(section).getByRole('table')).getByText(long)).toBeTruthy();
  });

  it('cuts an all-capitals label to the column, however wide its glyphs run', async () => {
    const shouted = 'WAITING FOR THE INSURANCE ASSESSOR TO CALL BACK';
    readDashboardSummary.mockResolvedValue(
      okRead(
        dashboardSummary({
          workOrdersByState: figure([
            { state: 'awaiting_assessor', label: shouted, count: 2, isTerminal: false },
          ]),
        })
      )
    );
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    const [label] = stateChartTexts(EN['dashboard.byState.title'] as string);
    const drawn = label?.querySelector('tspan')?.textContent ?? '';
    expect(drawn.endsWith('…')).toBe(true);
    expect(shouted.startsWith(drawn.slice(0, -1))).toBe(true);
    // Within the column by the conservative budget...
    expect(estimatedTextWidth(drawn, LABEL_FONT_SIZE)).toBeLessThanOrEqual(LABEL_TEXT_WIDTH);
    // ...and fewer characters than the old 0.6-em average would have kept
    // (25), which is what let a line of capitals run into the bars.
    expect(Array.from(drawn).length).toBeLessThan(25);
    expect(label?.querySelector('title')?.textContent).toBe(shouted);
  });

  it('budgets wide glyphs, capitals and ordinary letters apart', () => {
    // A run of the widest glyphs is cut sooner than capitals, and capitals
    // sooner than lower case, and every cut fits the column.
    const cut = (text: string) => fitLabel(text);
    const wide = cut('W'.repeat(40));
    const capitals = cut('H'.repeat(40));
    const lower = cut('h'.repeat(40));
    expect(wide.length).toBeLessThan(capitals.length);
    expect(capitals.length).toBeLessThan(lower.length);
    for (const drawn of [wide, capitals, lower]) {
      expect(estimatedTextWidth(drawn, LABEL_FONT_SIZE)).toBeLessThanOrEqual(LABEL_TEXT_WIDTH);
    }
    // A label within the budget is returned as it is.
    expect(cut('In progress')).toBe('In progress');
  });

  it('leaves a label that fits exactly as it is, with no second copy', async () => {
    renderLtr(inBranch(<DashboardScreen locale="en" messages={messagesFor('en')} />));
    await screen.findByText('7');

    const [label] = stateChartTexts(EN['dashboard.byState.title'] as string);
    expect(label?.querySelector('tspan')?.textContent).toBe('In progress');
    expect(label?.querySelector('title')).toBeNull();
  });
});

describe('the dashboard page lands a reader somewhere they can work', () => {
  const landing = async (): Promise<string | null> => {
    try {
      await DashboardPage({ params: Promise.resolve({ locale: 'en' }) });
    } catch (error) {
      if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
        return (error as Error & { target: string }).target;
      }
      throw error;
    }
    return null;
  };

  it('renders the dashboard for a session holding its code', async () => {
    PERMISSIONS = ['wo.work_order.read'];
    expect(await landing()).toBeNull();
    const page = await DashboardPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(rendersType(page, DashboardScreen)).toBe(true);
    expect(rendersType(page, PermissionDeniedState)).toBe(false);
  });

  it('sends a session without it to the first screen its codes open', async () => {
    // Not a full-page refusal on the screen they land on after signing in.
    PERMISSIONS = ['inv.stock.read'];
    expect(await landing()).toBe('/en/attention');

    PERMISSIONS = ['crm.customer.read'];
    expect(await landing()).toBe('/en/reception/walk-in');
  });

  it('refuses a session with no usable code on the page itself, sending it nowhere', async () => {
    // Not to the design gallery (a 404 in production), and not back to this
    // page: no redirect at all, and the refusal is stated here.
    for (const permissions of [[], ['not.a.real.code']]) {
      PERMISSIONS = permissions;
      expect(await landing(), permissions.join(',')).toBeNull();
      const page = await DashboardPage({ params: Promise.resolve({ locale: 'en' }) });
      expect(rendersType(page, PermissionDeniedState), permissions.join(',')).toBe(true);
      expect(rendersType(page, DashboardScreen), permissions.join(',')).toBe(false);
    }
  });

  it('gates on exactly the code its own navigation entry names', async () => {
    const entry = flattenNavigation().find((item) => item.href === '/');
    const code = entry?.permission ?? null;
    expect(code).not.toBeNull();

    // That code alone opens the page...
    PERMISSIONS = code === null ? [] : [code];
    expect(await landing()).toBeNull();
    const page = await DashboardPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(rendersType(page, DashboardScreen)).toBe(true);

    // ...and every OTHER code the navigation names does not: the page sends the
    // session on to a real screen, never to itself and never to the root.
    PERMISSIONS = [
      ...new Set(
        flattenNavigation()
          .map((item) => item.permission)
          .filter((other): other is string => other !== null && other !== code)
      ),
    ];
    const elsewhere = await landing();
    expect(elsewhere).not.toBeNull();
    expect(elsewhere).not.toBe('/en');
    expect(elsewhere).not.toBe('/en/gallery');
  });
});
