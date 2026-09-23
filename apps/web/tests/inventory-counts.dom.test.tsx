import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
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
  BRANCH_ID,
  COMPANY_ID,
  EN,
  ITEM_ID,
  LOCATION_ID,
  branch,
  chooseBranch,
  labelled,
  okPage,
  okRead,
  refusedWith,
  seriousViolations,
  succeeded,
  warehouse,
} from './support/stock-operations';

/**
 * Stock counts, rendered (P1-32).
 *
 * The properties under test: a count line shows the snapshot, what moved during
 * the count, what was counted and the server's variance — four strings, none
 * derived; a line not yet counted says so instead of showing a variance;
 * recording sends the count's version exactly as the last answer stated it and
 * the next record uses the version the record answered; reconciling states how
 * many adjustments now wait for approval; a refusal is said in words; nothing
 * that writes is offered without `inv.stock.operate`; and the route page decides
 * before it reads.
 */

const AR = ar as Record<string, string>;

const listStockCounts = vi.fn();
const readStockCount = vi.fn();
const openStockCount = vi.fn();
const recordStockCountLine = vi.fn();
const reconcileStockCount = vi.fn();
const cancelStockCount = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listStockCounts: (...args: unknown[]) => listStockCounts(...args),
  readStockCount: (...args: unknown[]) => readStockCount(...args),
  openStockCount: (...args: unknown[]) => openStockCount(...args),
  recordStockCountLine: (...args: unknown[]) => recordStockCountLine(...args),
  reconcileStockCount: (...args: unknown[]) => reconcileStockCount(...args),
  cancelStockCount: (...args: unknown[]) => cancelStockCount(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  // `./shared` and `./stock-operations` name these exports; this screen never calls them.
  listItemCategories: vi.fn(),
  listItems: vi.fn(),
  /*
   * The stock-signal indicator this screen mounts reads both alert lists. Its
   * own behaviour is proved in `attention.dom.test.tsx`; here it answers with
   * nothing to report so it cannot change what these cases are about.
   */
  readLowStockAlerts: async () => ({
    status: 'ok',
    data: {
      asOf: '2026-09-18T09:00:00.000Z',
      rule: { statement: 'rule', excludedLocationTypes: [] },
      findings: { items: [], nextCursor: null, hasMore: false },
    },
    correlationId: null,
  }),
  readCountDiscrepancyAlerts: async () => ({
    status: 'ok',
    data: {
      asOf: '2026-09-18T09:00:00.000Z',
      rule: { statement: 'rule' },
      findings: { items: [], nextCursor: null, hasMore: false },
    },
    correlationId: null,
  }),
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

const notifyActionResult = vi.fn<(...args: unknown[]) => boolean>(() => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { StockCountsScreen } = await import('@/features/inventory/components/StockCountsScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const CountsPage = (await import('@/app/[locale]/(dashboard)/inventory/counts/page'))
  .default as unknown as RoutePage;

const COUNT_ID = '77777777-7777-4777-8777-777777777777';
const SECOND_ITEM_ID = '34343434-3434-4434-8434-343434343434';

const summary = {
  id: COUNT_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  locationId: LOCATION_ID,
  locationCode: 'WH-1',
  status: 'counting',
  snapshotAt: '2026-09-17T08:00:00Z',
  countedBy: 'user-1',
  reconciledAt: null,
  cancelledAt: null,
  cancelReason: null,
  notes: null,
  recordVersion: 6,
  createdAt: '2026-09-17T08:00:00Z',
  lineCount: 2,
  countedLineCount: 1,
  varianceLineCount: 1,
  absoluteVarianceQty: '1.000',
};

function detail(over: Record<string, unknown> = {}, lines?: readonly unknown[]) {
  const rest = Object.fromEntries(
    Object.entries(summary).filter(([key]) => key !== 'locationCode')
  );
  return {
    ...rest,
    ...over,
    lines: lines ?? [
      {
        id: 'line-1',
        itemId: ITEM_ID,
        sku: 'BRK-001',
        snapshotQty: '10.000',
        countedQty: '7.000',
        movementDeltaDuringCount: '-2.000',
        varianceQty: '-1.000',
        adjustmentId: null,
        adjustmentStatus: null,
      },
      {
        id: 'line-2',
        itemId: SECOND_ITEM_ID,
        sku: 'OIL-5W30',
        snapshotQty: '4.000',
        countedQty: null,
        movementDeltaDuringCount: '0.000',
        varianceQty: null,
        adjustmentId: null,
        adjustmentStatus: null,
      },
    ],
  };
}

const TARGET_FORM = 'inventory.counts.targetLabel';
const listRegion = () =>
  screen.getByRole('region', { name: EN['inventory.counts.list.heading'] as string });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <StockCountsScreen
      locale="en"
      messages={en}
      canOperate={true}
      canReadBranches={true}
      {...over}
    />
  );
}

async function openCount(user: ReturnType<typeof userEvent.setup>) {
  const table = await within(listRegion()).findByRole('table');
  await user.click(
    within(table).getByRole('button', { name: `${EN['inventory.counts.open'] as string} WH-1` })
  );
  return screen.findByRole('region', { name: /Count of WH-1/ });
}

const lineRow = (panel: HTMLElement, sku: string) =>
  within(within(panel).getByRole('table'))
    .getAllByRole('row')
    .find((row) => within(row).queryAllByText(sku).length > 0) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listStockCounts.mockResolvedValue(okPage([summary]));
  readStockCount.mockResolvedValue(okRead(detail()));
  listLocations.mockResolvedValue(okPage([warehouse]));
  listBranches.mockResolvedValue({ status: 'ok', data: { items: [branch] }, correlationId: 'c' });
});

describe('what a count shows', () => {
  it('lists the counts of the branch with the server’s variance figures', async () => {
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await waitFor(() =>
      expect(listStockCounts).toHaveBeenCalledWith({ companyId: COMPANY_ID, branchId: BRANCH_ID })
    );
    const table = await within(listRegion()).findByRole('table');
    expect(within(table).getByText('1 / 2')).toBeVisible();
    expect(within(table).getByText('1.000')).toBeVisible();
    expect(within(table).getByText(EN['inventory.countStatus.counting'] as string)).toBeVisible();
  });

  it('carries the branch stock signals beside the counts that raise half of them', async () => {
    renderScreen();
    expect(screen.queryByTestId('stock-alert-indicator')).toBeNull();
    await chooseBranch(TARGET_FORM);

    const indicator = await screen.findByTestId('stock-alert-indicator');
    expect(indicator).toHaveTextContent(EN['inventory.signals.quiet'] as string);
    expect(
      within(indicator).getByRole('link', { name: EN['inventory.signals.open'] as string })
    ).toHaveAttribute('href', '/en/attention');
  });

  it('shows snapshot, counted and variance, and says what is not counted', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: false });
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    expect(readStockCount).toHaveBeenCalledWith(COUNT_ID);
    const counted = lineRow(panel, 'BRK-001');
    expect(within(counted).getByText('10.000')).toBeVisible();
    expect(within(counted).getByText('7.000')).toBeVisible();
    expect(within(counted).getByText('-1.000')).toBeVisible();
    const pending = lineRow(panel, 'OIL-5W30');
    expect(
      within(pending).getAllByText(EN['inventory.counts.line.notCounted'] as string)
    ).toHaveLength(2);
    expect(
      within(panel).getByText(EN['inventory.counts.detail.varianceExplainOpen'] as string)
    ).toBeVisible();
  });

  /**
   * DEF-T-04. `movement_delta_during_count` defaults to zero and is written by
   * the reconciliation and by nothing else, so an OPEN count held a zero nobody
   * measured. Printed beside three measured quantities it read as "nothing
   * moved", and the campaign read it that way over five units received into the
   * same place while the count was open.
   */
  it('does not present the unwritten movement figure as measured while the count is open', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: false });
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    const counted = lineRow(panel, 'BRK-001');
    expect(within(counted).queryByText('-2.000')).toBeNull();
    expect(
      within(counted).getByText(EN['inventory.counts.line.movementsAtReconcile'] as string)
    ).toBeVisible();
    const pending = lineRow(panel, 'OIL-5W30');
    expect(within(pending).queryByText('0.000')).toBeNull();
    expect(
      within(panel).getByText(EN['inventory.counts.detail.movementsPending'] as string)
    ).toBeVisible();
    // The difference is generated from the same unwritten zero, so the screen
    // must not carry the sentence that says it already accounts for movements.
    expect(
      within(panel).queryByText(EN['inventory.counts.detail.varianceExplain'] as string)
    ).toBeNull();
    expect(
      within(panel).getByText(EN['inventory.counts.detail.varianceExplainOpen'] as string)
    ).toBeVisible();
  });

  it('shows the movement figure once the count is reconciled, and drops the caveat', async () => {
    const user = userEvent.setup();
    readStockCount.mockResolvedValue(okRead(detail({ status: 'reconciled' })));
    renderScreen({ canOperate: false });
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    const counted = lineRow(panel, 'BRK-001');
    expect(within(counted).getByText('-2.000')).toBeVisible();
    expect(
      within(counted).queryByText(EN['inventory.counts.line.movementsAtReconcile'] as string)
    ).toBeNull();
    expect(
      within(panel).queryByText(EN['inventory.counts.detail.movementsPending'] as string)
    ).toBeNull();
    expect(
      within(panel).queryByText(EN['inventory.counts.detail.varianceExplainOpen'] as string)
    ).toBeNull();
    expect(
      within(panel).getByText(EN['inventory.counts.detail.varianceExplain'] as string)
    ).toBeVisible();
  });
});

describe('recording and reconciling', () => {
  it('records with the count version as answered, then uses the version the record returned', async () => {
    const user = userEvent.setup();
    recordStockCountLine
      .mockResolvedValueOnce(
        succeeded(
          'inventory.counts.line.success',
          detail({ recordVersion: 7, countedLineCount: 2 }, [
            {
              id: 'line-1',
              itemId: ITEM_ID,
              sku: 'BRK-001',
              snapshotQty: '10.000',
              countedQty: '7.000',
              movementDeltaDuringCount: '-2.000',
              varianceQty: '-1.000',
              adjustmentId: null,
              adjustmentStatus: null,
            },
            {
              id: 'line-2',
              itemId: SECOND_ITEM_ID,
              sku: 'OIL-5W30',
              snapshotQty: '4.000',
              countedQty: '0',
              movementDeltaDuringCount: '0.000',
              varianceQty: '-4.000',
              adjustmentId: null,
              adjustmentStatus: null,
            },
          ])
        )
      )
      .mockResolvedValueOnce(
        succeeded('inventory.counts.line.success', detail({ recordVersion: 8 }))
      );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    const pending = lineRow(panel, 'OIL-5W30');
    await user.type(
      within(pending).getByLabelText(labelled('inventory.counts.line.countedField')),
      '0'
    );
    await user.click(
      within(pending).getByRole('button', {
        name: `${EN['inventory.counts.line.save'] as string} OIL-5W30`,
      })
    );
    await waitFor(() =>
      expect(recordStockCountLine).toHaveBeenCalledWith(
        COUNT_ID,
        SECOND_ITEM_ID,
        { countedQty: '0' },
        6
      )
    );
    // The server's new variance for the line replaces what was shown.
    expect(await within(lineRow(panel, 'OIL-5W30')).findByText('-4.000')).toBeVisible();
    const counted = lineRow(panel, 'BRK-001');
    await user.click(
      within(counted).getByRole('button', {
        name: `${EN['inventory.counts.line.save'] as string} BRK-001`,
      })
    );
    await waitFor(() => expect(recordStockCountLine).toHaveBeenCalledTimes(2));
    expect(recordStockCountLine.mock.calls[1]?.[3]).toBe(7);
  });

  it('reconciling says how many adjustments now wait for approval', async () => {
    const user = userEvent.setup();
    reconcileStockCount.mockResolvedValue(
      succeeded(
        'inventory.counts.reconcile.success',
        detail({ status: 'reconciled', recordVersion: 7, adjustmentsRaised: 1 })
      )
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.counts.reconcile.action'] as string })
    );
    await waitFor(() => expect(reconcileStockCount).toHaveBeenCalledWith(COUNT_ID));
    const said = await screen.findByText(EN['inventory.counts.reconcile.raised'] as string, {
      exact: false,
    });
    expect(said).toHaveTextContent('1');
    expect(
      screen.getByRole('link', { name: EN['inventory.counts.reconcile.seeAdjustments'] as string })
    ).toHaveAttribute('href', '/en/inventory/adjustments');
    // A reconciled count takes no more records.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: EN['inventory.counts.reconcile.action'] as string })
      ).toBeNull()
    );
  });

  it('a refused record is said in words', async () => {
    const user = userEvent.setup();
    recordStockCountLine.mockResolvedValue(refusedWith('inventory.counts.closed'));
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    const row = lineRow(panel, 'BRK-001');
    await user.click(
      within(row).getByRole('button', {
        name: `${EN['inventory.counts.line.save'] as string} BRK-001`,
      })
    );
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      EN['inventory.counts.closed'] as string
    );
  });

  it('cancelling sends its reason, and a cancelled count takes no more records', async () => {
    const user = userEvent.setup();
    cancelStockCount.mockResolvedValue(
      succeeded(
        'inventory.counts.cancel.success',
        detail({
          status: 'cancelled',
          recordVersion: 7,
          cancelledAt: '2026-09-17T09:00:00Z',
          cancelReason: 'Shelf is being rebuilt',
        })
      )
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.counts.cancel.action'] as string })
    );
    const form = within(panel).getByRole('form', {
      name: EN['inventory.counts.cancel.heading'] as string,
    });
    // Nothing is sent without a reason.
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.counts.cancel.submit'] as string })
    );
    expect(cancelStockCount).not.toHaveBeenCalled();
    await user.type(
      within(form).getByLabelText(labelled('inventory.stockOps.reason')),
      'Shelf is being rebuilt'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.counts.cancel.submit'] as string })
    );
    await waitFor(() =>
      expect(cancelStockCount).toHaveBeenCalledWith(COUNT_ID, { reason: 'Shelf is being rebuilt' })
    );
    expect(
      await within(panel).findByText(EN['inventory.countStatus.cancelled'] as string)
    ).toBeVisible();
    expect(within(panel).getByText('Shelf is being rebuilt')).toBeVisible();
    expect(
      within(panel).queryByRole('button', { name: EN['inventory.counts.cancel.action'] as string })
    ).toBeNull();
    expect(
      within(panel).queryByLabelText(labelled('inventory.counts.line.countedField'))
    ).toBeNull();
  });

  it('a refused cancel is said in words and leaves the count open', async () => {
    const user = userEvent.setup();
    cancelStockCount.mockResolvedValue(refusedWith('inventory.counts.closed'));
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.counts.cancel.action'] as string })
    );
    const form = within(panel).getByRole('form', {
      name: EN['inventory.counts.cancel.heading'] as string,
    });
    await user.type(within(form).getByLabelText(labelled('inventory.stockOps.reason')), 'Mistake');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.counts.cancel.submit'] as string })
    );
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      EN['inventory.counts.closed'] as string
    );
    expect(within(panel).getByText(EN['inventory.countStatus.counting'] as string)).toBeVisible();
  });

  it('opens a count of a chosen location with one key per form', async () => {
    const user = userEvent.setup();
    openStockCount.mockResolvedValue(
      succeeded('inventory.counts.open.success', detail({ status: 'open' }))
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const form = screen.getByRole('form', {
      name: EN['inventory.counts.openForm.heading'] as string,
    });
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.counts.openForm.location')),
      LOCATION_ID
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.counts.openForm.submit'] as string })
    );
    await waitFor(() => expect(openStockCount).toHaveBeenCalledTimes(1));
    const body = openStockCount.mock.calls[0]?.[0] as Record<string, string>;
    expect(body['locationId']).toBe(LOCATION_ID);
    expect(typeof body['idempotencyKey']).toBe('string');
    expect(await screen.findByRole('region', { name: /Count of WH-1/ })).toBeVisible();
  });
});

describe('a count being opened and a branch switch', () => {
  /*
   * The open form names one of this branch's locations and is keyed on the branch,
   * so a switch used to drop it without a word. It now asks first.
   */
  afterEach(forgetRememberedBranch);

  async function openTwoBranches(user: ReturnType<typeof userEvent.setup>) {
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <StockCountsScreen locale="en" messages={en} canOperate={true} canReadBranches={true} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByRole('form', { name: EN['inventory.counts.openForm.heading'] as string });
  }
  const field = () =>
    within(
      screen.getByRole('form', { name: EN['inventory.counts.openForm.heading'] as string })
    ).getByLabelText(labelled('inventory.counts.openForm.notes')) as HTMLInputElement;

  it('asks before switching; staying keeps what was typed and the branch', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), 'Front shelf');
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(field().value).toBe('Front shelf');
  });

  it('discarding switches the branch and opens the form empty under it', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await user.type(field(), 'Front shelf');
    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await waitFor(() =>
      expect(listLocations.mock.lastCall?.[0]).toEqual({
        companyId: OTHER_BRANCH.companyId,
        branchId: OTHER_BRANCH.id,
      })
    );
    expect(field().value).toBe('');
  });

  it('an untouched form switches without asking', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });
});

describe('permission decides what is offered', () => {
  it('without the operate permission there is no record, reconcile, cancel or open', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: false });
    expect(screen.getByText(EN['inventory.counts.needsOperate'] as string)).toBeVisible();
    await chooseBranch(TARGET_FORM);
    const panel = await openCount(user);
    expect(
      within(panel).queryByLabelText(labelled('inventory.counts.line.countedField'))
    ).toBeNull();
    expect(
      within(panel).queryByRole('button', {
        name: EN['inventory.counts.reconcile.action'] as string,
      })
    ).toBeNull();
    expect(
      screen.queryByRole('form', { name: EN['inventory.counts.openForm.heading'] as string })
    ).toBeNull();
  });
});

describe('the /inventory/counts route page decides before it reads', () => {
  async function renderPage(locale = 'en') {
    const tree = await CountsPage({ params: Promise.resolve({ locale }) });
    return renderLtr(tree as React.ReactElement);
  }

  it('refuses without inv.stock.read and issues no read', async () => {
    PERMISSIONS = ['inv.stock.operate'];
    await renderPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listStockCounts).not.toHaveBeenCalled();
  });

  it('binds the operate capability to inv.stock.operate', async () => {
    PERMISSIONS = ['inv.stock.read'];
    const { unmount } = await renderPage();
    expect(screen.getByText(EN['inventory.counts.needsOperate'] as string)).toBeVisible();
    unmount();
    PERMISSIONS = ['inv.stock.read', 'inv.stock.operate'];
    await renderPage();
    expect(screen.queryByText(EN['inventory.counts.needsOperate'] as string)).toBeNull();
  });
});

describe('accessibility and Arabic', () => {
  it('an open count has no serious or critical accessibility finding', async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    await chooseBranch(TARGET_FORM);
    await openCount(user);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders in Arabic, right to left, and reads its branch there too', async () => {
    renderRtl(<StockCountsScreen locale="ar" messages={ar} canOperate={true} />);
    expect(screen.getByText(AR['inventory.counts.explain'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
    await waitFor(() => expect(listStockCounts).toHaveBeenCalled());
  });
});
