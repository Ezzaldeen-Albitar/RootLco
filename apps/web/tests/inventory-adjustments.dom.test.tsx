import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { renderLtr, renderRtl } from './render';
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  ITEM_ID,
  LOCATION_ID,
  OTHER_USER_ID,
  USER_ID,
  branch,
  chooseBranch,
  chooseItem,
  item,
  itemPage,
  labelled,
  okPage,
  refusedWith,
  seriousViolations,
  succeeded,
  warehouse,
} from './support/stock-operations';

/**
 * Stock adjustments, rendered (P1-32).
 *
 * The properties under test: the list is addressed to the branch and to the
 * chosen status; a request someone ELSE made is offered to an approver, and one
 * the signed-in person made is not — with the reason said on the row; a
 * decision sends its reason; a refusal that arrives anyway is said in words;
 * nothing is offered without the matching permission; and the route page binds
 * the signed-in person and each capability.
 */

const AR = ar as Record<string, string>;

const listAdjustments = vi.fn();
const createAdjustment = vi.fn();
const decideAdjustment = vi.fn();
const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listAdjustments: (...args: unknown[]) => listAdjustments(...args),
  createAdjustment: (...args: unknown[]) => createAdjustment(...args),
  decideAdjustment: (...args: unknown[]) => decideAdjustment(...args),
  listItems: (...args: unknown[]) => listItems(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  // `./shared` names this export; this screen never calls it.
  listItemCategories: vi.fn(),
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
    userId: USER_ID,
    permissions: PERMISSIONS,
    email: 'operator@test.local',
  }),
}));

const notifyActionResult = vi.fn<(...args: unknown[]) => boolean>(() => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { AdjustmentsScreen } = await import('@/features/inventory/components/AdjustmentsScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const AdjustmentsPage = (await import('@/app/[locale]/(dashboard)/inventory/adjustments/page'))
  .default as unknown as RoutePage;

const THEIRS_ID = '12121212-1212-4212-8212-121212121212';
const MINE_ID = '13131313-1313-4313-8313-131313131313';

function adjustment(over: Record<string, unknown> = {}) {
  return {
    id: THEIRS_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    itemId: ITEM_ID,
    locationId: LOCATION_ID,
    direction: 'out',
    quantity: '1.000',
    reason: 'Broken on the shelf',
    status: 'pending',
    requestedBy: OTHER_USER_ID,
    approvedBy: null,
    approvedAt: null,
    recordVersion: 1,
    createdAt: '2026-09-17T08:00:00Z',
    sku: 'BRK-001',
    locationCode: 'WH-1',
    ...over,
  };
}

const TARGET_FORM = 'inventory.adjustments.targetLabel';
const TARGET_SUBMIT = 'inventory.adjustments.chooseBranch';
const listRegion = () =>
  screen.getByRole('region', { name: EN['inventory.adjustments.list.heading'] as string });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <AdjustmentsScreen
      locale="en"
      messages={en}
      currentUserId={USER_ID}
      canOperate={true}
      canApprove={true}
      canReadBranches={true}
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listAdjustments.mockResolvedValue(
    okPage([
      adjustment(),
      adjustment({ id: MINE_ID, requestedBy: USER_ID, sku: 'OIL-5W30', direction: 'in' }),
    ])
  );
  listLocations.mockResolvedValue(okPage([warehouse]));
  listBranches.mockResolvedValue({ status: 'ok', data: { items: [branch] }, correlationId: 'c' });
  listItems.mockResolvedValue(itemPage([item]));
});

describe('the adjustments of a branch', () => {
  it('lists the pending requests of the branch first, and reads again for another status', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    await waitFor(() => expect(listAdjustments).toHaveBeenCalledTimes(1));
    expect(listAdjustments.mock.calls[0]).toEqual([
      { companyId: COMPANY_ID, branchId: BRANCH_ID },
      'pending',
    ]);
    await within(listRegion()).findByRole('table');
    await user.selectOptions(
      within(listRegion()).getByLabelText(labelled('inventory.adjustments.list.status')),
      'all'
    );
    await waitFor(() => expect(listAdjustments).toHaveBeenCalledTimes(2));
    expect(listAdjustments.mock.calls[1]?.[1]).toBeNull();
  });

  it('offers the decision on someone else’s request and says why not on your own', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const table = await within(listRegion()).findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    const theirs = rows[0] as HTMLElement;
    const mine = rows[1] as HTMLElement;
    expect(
      within(theirs).getByRole('button', {
        name: `${EN['inventory.adjustments.decide.action'] as string} BRK-001`,
      })
    ).toBeVisible();
    expect(within(mine).queryByRole('button')).toBeNull();
    expect(within(mine).getByText(EN['inventory.adjustments.ownRequest'] as string)).toBeVisible();
    expect(within(mine).getByText(EN['inventory.adjustments.byYou'] as string)).toBeVisible();
  });

  it('approving someone else’s request sends the approval and says the stock moved', async () => {
    const user = userEvent.setup();
    decideAdjustment.mockResolvedValue(
      succeeded('inventory.adjustments.decide.approved', adjustment({ status: 'approved' }))
    );
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const table = await within(listRegion()).findByRole('table');
    await user.click(
      within(table).getByRole('button', {
        name: `${EN['inventory.adjustments.decide.action'] as string} BRK-001`,
      })
    );
    const form = screen.getByRole('form', { name: /Decide the adjustment for/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.adjustments.decide.reason')),
      'Counted it myself'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.adjustments.decide.approve'] as string,
      })
    );
    await waitFor(() =>
      expect(decideAdjustment).toHaveBeenCalledWith(THEIRS_ID, {
        decision: 'approved',
        reason: 'Counted it myself',
      })
    );
    expect(
      await screen.findByText(EN['inventory.adjustments.decide.approvedDone'] as string)
    ).toBeVisible();
    expect(
      screen.queryByText(EN['inventory.adjustments.decide.rejectedDone'] as string)
    ).toBeNull();
  });

  it('rejecting sends the rejection with its reason and reads the list again', async () => {
    const user = userEvent.setup();
    decideAdjustment.mockResolvedValue(
      succeeded('inventory.adjustments.decide.rejected', adjustment({ status: 'rejected' }))
    );
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const table = await within(listRegion()).findByRole('table');
    await user.click(
      within(table).getByRole('button', {
        name: `${EN['inventory.adjustments.decide.action'] as string} BRK-001`,
      })
    );
    const form = screen.getByRole('form', { name: /Decide the adjustment for/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.adjustments.decide.reason')),
      'Checked the shelf'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.adjustments.decide.reject'] as string,
      })
    );
    await waitFor(() =>
      expect(decideAdjustment).toHaveBeenCalledWith(THEIRS_ID, {
        decision: 'rejected',
        reason: 'Checked the shelf',
      })
    );
    expect(
      await screen.findByText(EN['inventory.adjustments.decide.rejectedDone'] as string)
    ).toBeVisible();
    await waitFor(() => expect(listAdjustments).toHaveBeenCalledTimes(2));
  });

  it('a refused decision is said in words', async () => {
    const user = userEvent.setup();
    decideAdjustment.mockResolvedValue(refusedWith('inventory.adjustments.decide.refused'));
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const table = await within(listRegion()).findByRole('table');
    await user.click(
      within(table).getByRole('button', {
        name: `${EN['inventory.adjustments.decide.action'] as string} BRK-001`,
      })
    );
    const form = screen.getByRole('form', { name: /Decide the adjustment for/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.adjustments.decide.reason')),
      'ok'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.adjustments.decide.approve'] as string,
      })
    );
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      EN['inventory.adjustments.decide.refused'] as string
    );
  });

  it('a request sends the item, location, change, quantity and reason', async () => {
    const user = userEvent.setup();
    createAdjustment.mockResolvedValue(
      succeeded('inventory.adjustments.create.success', adjustment())
    );
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const form = screen.getByRole('form', {
      name: EN['inventory.adjustments.create.heading'] as string,
    });
    await chooseItem(user, form);
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.adjustments.create.location')),
      LOCATION_ID
    );
    await user.click(
      within(form).getByLabelText(EN['inventory.adjustments.direction.in'] as string)
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.adjustments.create.quantity')),
      '3'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.stockOps.reason')),
      'Found in the back'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.adjustments.create.submit'] as string,
      })
    );
    await waitFor(() =>
      expect(createAdjustment).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        direction: 'in',
        quantity: '3',
        reason: 'Found in the back',
      })
    );
    expect(
      await screen.findByText(EN['inventory.adjustments.create.done'] as string)
    ).toBeVisible();
  });
});

describe('permission decides what is offered', () => {
  it('without the approval permission no decision is offered, and the row says why', async () => {
    const user = userEvent.setup();
    renderScreen({ canApprove: false, canOperate: false });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const table = await within(listRegion()).findByRole('table');
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(
      within(table).getAllByText(EN['inventory.adjustments.needsApprove'] as string)
    ).toHaveLength(2);
    expect(screen.getByText(EN['inventory.adjustments.needsOperate'] as string)).toBeVisible();
  });
});

describe('the /inventory/adjustments route page decides before it reads', () => {
  async function renderPage(locale = 'en') {
    const tree = await AdjustmentsPage({ params: Promise.resolve({ locale }) });
    return renderLtr(tree as React.ReactElement);
  }

  it('refuses without inv.stock.read and issues no read', async () => {
    PERMISSIONS = ['inv.adjustment.approve'];
    await renderPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listAdjustments).not.toHaveBeenCalled();
  });

  it('binds the signed-in person and the approval permission', async () => {
    const user = userEvent.setup();
    PERMISSIONS = ['inv.stock.read', 'inv.adjustment.approve', 'org.branch.read'];
    await renderPage();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const table = await within(listRegion()).findByRole('table');
    // The session's person requested the second row, so only the first is decidable.
    expect(within(table).getAllByRole('button')).toHaveLength(1);
    expect(within(table).getByText(EN['inventory.adjustments.ownRequest'] as string)).toBeVisible();
    expect(screen.getByText(EN['inventory.adjustments.needsOperate'] as string)).toBeVisible();
  });
});

describe('accessibility and Arabic', () => {
  it('the listed branch has no serious or critical accessibility finding', async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    await within(listRegion()).findByRole('table');
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders in Arabic, right to left', () => {
    renderRtl(
      <AdjustmentsScreen
        locale="ar"
        messages={ar}
        currentUserId={USER_ID}
        canOperate={true}
        canApprove={true}
        canReadBranches={false}
      />
    );
    expect(screen.getByText(AR['inventory.adjustments.explain'] as string)).toBeVisible();
    expect(listAdjustments).not.toHaveBeenCalled();
  });
});
