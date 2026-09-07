/**
 * P1-30 W10 — opening stock (`/inventory/opening-stock`), change-control
 * CC-05: the batch, its lines, and the second person's approval.
 *
 * The adapter is mocked at the module boundary. What is asserted is the
 * chain as the screen walks it — the branch is chosen before a batch can be
 * opened; the batch body carries the code and date as typed and omits empty
 * notes; a line is sent with the found item, the chosen location and the
 * quantity as typed (a zero or malformed one is refused before any request);
 * every echo is rendered as sent; the approval is offered only to holders of
 * `inv.adjustment.approve`; and the server's maker ≠ checker refusal is shown
 * as a refusal and leaves the batch a draft.
 *
 * The RECOVERY half is asserted below it: the branch's batches are listed with
 * the status and the line count the server gave them; opening one renders
 * `inv.opening-batch-read`'s answer rather than anything this tab typed; an
 * empty branch, a refused list and an unreadable batch are three different
 * sentences; and a person who never counted the batch reaches it from the list
 * and approves it, which is the maker-and-checker rule satisfied without a
 * shared browser tab. Both languages, including right to left.
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

const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const listOpeningBatches = vi.fn();
const readOpeningBatch = vi.fn();
const createOpeningBatch = vi.fn();
const createOpeningBatchLine = vi.fn();
const approveOpeningBatch = vi.fn();

vi.mock('@/features/inventory/api', () => ({
  listItems: (...args: unknown[]) => listItems(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  listOpeningBatches: (...args: unknown[]) => listOpeningBatches(...args),
  readOpeningBatch: (...args: unknown[]) => readOpeningBatch(...args),
  // `./shared` names this export; this screen never calls it.
  listItemCategories: vi.fn(),
  createOpeningBatch: (...args: unknown[]) => createOpeningBatch(...args),
  createOpeningBatchLine: (...args: unknown[]) => createOpeningBatchLine(...args),
  approveOpeningBatch: (...args: unknown[]) => approveOpeningBatch(...args),
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

const { OpeningStockScreen } = await import('@/features/inventory/components/OpeningStockScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const OpeningStockPage = (await import('@/app/[locale]/(dashboard)/inventory/opening-stock/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';
const LINE_ID = '66666666-6666-4666-8666-666666666666';

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
const draft = {
  id: BATCH_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  batchCode: 'OPEN-2026',
  status: 'draft',
  countedBy: 'user-1',
  approvedBy: null,
  recordVersion: 1,
};
const line = {
  id: LINE_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  locationId: LOCATION_ID,
  quantity: '12.000',
};

/*
 * The RECOVERY fixtures — what the server holds, as opposed to what this tab
 * happened to type. The SKU, the item name, the location code and the quantity
 * below appear NOWHERE in the create path above, so a test that finds them on
 * screen has proved the screen rendered `inv.opening-batch-read`'s answer and
 * not its own memory of a line it added.
 */
const OTHER_BATCH_ID = '99999999-9999-4999-8999-999999999999';
const SERVER_LINE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const summary = {
  id: BATCH_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  batchCode: 'OPEN-2026',
  asOfDate: '2026-09-06',
  status: 'draft',
  countedBy: 'user-1',
  approvedBy: null,
  approvedAt: null,
  lineCount: 1,
  createdAt: '2026-09-06T08:00:00.000Z',
  recordVersion: 1,
};
const approvedSummary = {
  ...summary,
  id: OTHER_BATCH_ID,
  batchCode: 'OPEN-2025',
  asOfDate: '2025-01-02',
  status: 'approved',
  approvedBy: 'user-2',
  approvedAt: '2025-01-03T09:00:00.000Z',
  lineCount: 4,
  recordVersion: 2,
};
const serverLine = {
  id: SERVER_LINE_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  sku: 'FLT-009',
  itemName: 'Oil filter',
  locationId: LOCATION_ID,
  locationCode: 'WH-9',
  quantity: '7.250',
};
const detail = { batch: summary, lines: [serverLine] };

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const cursor = (items: readonly unknown[]) => okRead({ items, nextCursor: null, hasMore: false });
const page = (rows: readonly unknown[]) => ({
  status: 'ok' as const,
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr',
});
const success = (created: unknown, messageKey: string) => ({
  state: { status: 'success' as const, messageKey, attempt: 1, correlationId: 'corr' },
  created,
});
const conflict = () => ({
  state: {
    status: 'conflict' as const,
    messageKey: 'state.conflict.title',
    attempt: 1,
    correlationId: 'corr',
  },
  created: null,
});

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <OpeningStockScreen
      locale="en"
      messages={en}
      canOperate={true}
      canApprove={false}
      canReadBranches={true}
      {...over}
    />
  );
}
async function renderPage(params: Record<string, string>) {
  const tree = await OpeningStockPage({ params: Promise.resolve(params) });
  return renderLtr(tree as React.ReactElement);
}
const form = (key: string) => screen.getByRole('form', { name: EN[key] as string });
const targetForm = () =>
  screen.getByRole('form', { name: EN['inventory.opening.targetLabel'] as string });

async function chooseBranch(user: ReturnType<typeof userEvent.setup>) {
  const select = await within(targetForm()).findByRole('combobox');
  await user.selectOptions(select, BRANCH_ID);
  await user.click(
    within(targetForm()).getByRole('button', {
      name: EN['inventory.opening.chooseBranch'] as string,
    })
  );
  await waitFor(() => expect(listLocations).toHaveBeenCalled());
}

async function openBatch(user: ReturnType<typeof userEvent.setup>) {
  const panel = form('inventory.opening.batch.new');
  await user.type(
    within(panel).getByLabelText(labelled('inventory.opening.batch.code')),
    'OPEN-2026'
  );
  await user.type(
    within(panel).getByLabelText(labelled('inventory.opening.batch.asOfDate')),
    '2026-09-06'
  );
  await user.click(
    within(panel).getByRole('button', { name: EN['inventory.opening.batch.open'] as string })
  );
  await waitFor(() => expect(createOpeningBatch).toHaveBeenCalled());
  await screen.findByText(EN['inventory.opening.batch.serverNote'] as string);
}

/** One row's cells as text, so a column assertion is about columns. */
const cells = (row: HTMLElement | undefined): readonly string[] =>
  within(row as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => (cell.textContent ?? '').trim());

/** Open a listed batch by its code, which is part of every open button's name. */
async function openListed(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(escape(code)) }));
  await waitFor(() => expect(readOpeningBatch).toHaveBeenCalled());
}

async function addLine(user: ReturnType<typeof userEvent.setup>, quantity = '12.000') {
  const panel = form('inventory.opening.line.heading');
  await user.type(within(panel).getByLabelText(labelled('inventory.opening.line.find')), 'brk');
  await user.click(
    within(panel).getByRole('button', { name: EN['inventory.opening.line.search'] as string })
  );
  await waitFor(() => expect(listItems).toHaveBeenCalled());
  await user.selectOptions(
    await within(panel).findByLabelText(labelled('inventory.opening.line.item')),
    ITEM_ID
  );
  await user.selectOptions(
    within(panel).getByLabelText(labelled('inventory.opening.line.location')),
    LOCATION_ID
  );
  await user.type(
    within(panel).getByLabelText(labelled('inventory.opening.line.quantity')),
    quantity
  );
  await user.click(
    within(panel).getByRole('button', { name: EN['inventory.opening.line.add'] as string })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listItems.mockResolvedValue(page([item]));
  listLocations.mockResolvedValue(cursor([warehouse]));
  listBranches.mockResolvedValue(okRead({ items: [branch] }));
  // Empty by default so the chain tests below describe a fresh branch; the
  // recovery tests give this read rows of their own.
  listOpeningBatches.mockResolvedValue(cursor([]));
  readOpeningBatch.mockResolvedValue(okRead(detail));
  createOpeningBatch.mockResolvedValue(success(draft, 'inventory.opening.batch.success'));
  createOpeningBatchLine.mockResolvedValue(success(line, 'inventory.opening.line.success'));
  approveOpeningBatch.mockResolvedValue(
    success(
      { ...draft, status: 'approved', approvedBy: 'user-2', recordVersion: 2 },
      'inventory.opening.approve.success'
    )
  );
});

describe('the chain, in order', () => {
  it('states that a batch is reachable after this page, and offers no batch form before a branch is chosen', async () => {
    renderScreen();
    expect(screen.getByText(EN['inventory.opening.batchesReadable'] as string)).toBeVisible();
    // Nothing is read before a branch is named: the list is branch-targeted.
    expect(listOpeningBatches).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('form', { name: EN['inventory.opening.batch.new'] as string })
    ).toBeNull();
    expect(createOpeningBatch).not.toHaveBeenCalled();
  });

  it('without inv.stock.operate or inv.adjustment.approve, explains and offers nothing', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: false, canApprove: false });
    expect(screen.getByText(EN['inventory.opening.needsOperate'] as string)).toBeVisible();
    await chooseBranch(user);
    expect(
      screen.queryByRole('form', { name: EN['inventory.opening.batch.new'] as string })
    ).toBeNull();
  });

  it('opens a batch for the chosen branch with the code and date as typed and no empty notes, then shows the echo', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(user);
    await openBatch(user);
    expect(createOpeningBatch).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      batchCode: 'OPEN-2026',
      asOfDate: '2026-09-06',
    });
    expect(screen.getByText('OPEN-2026')).toBeVisible();
    expect(screen.getByText(EN['inventory.opening.status.draft'] as string)).toBeVisible();
    expect(screen.getByText(BATCH_ID)).toBeVisible();
    // The batch form is gone; the line form has taken its place.
    expect(
      screen.queryByRole('form', { name: EN['inventory.opening.batch.new'] as string })
    ).toBeNull();
    expect(form('inventory.opening.line.heading')).toBeVisible();
  });

  it('refuses a malformed batch code and an empty date before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(user);
    const panel = form('inventory.opening.batch.new');
    await user.type(
      within(panel).getByLabelText(labelled('inventory.opening.batch.code')),
      'bad code!'
    );
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.opening.batch.open'] as string })
    );
    expect(
      await within(panel).findByText(EN['inventory.opening.batch.codeFormat'] as string)
    ).toBeVisible();
    expect(within(panel).getByText(EN['field.required'] as string)).toBeVisible();
    expect(createOpeningBatch).not.toHaveBeenCalled();
  });

  it('adds a line with the found item, the chosen location and the quantity as typed, and lists the echo', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(user);
    await openBatch(user);
    await addLine(user);
    await waitFor(() =>
      expect(createOpeningBatchLine).toHaveBeenCalledWith(BATCH_ID, {
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        quantity: '12.000',
      })
    );
    expect(listItems).toHaveBeenCalledWith(
      { search: 'brk', lifecycleStatus: 'active' },
      expect.objectContaining({ pageSize: 25 }),
      null
    );
    const lines = screen.getByRole('table', {
      name: EN['inventory.opening.lines.caption'] as string,
    });
    expect(within(lines).getByText('BRK-001')).toBeVisible();
    expect(within(lines).getByText('WH-1')).toBeVisible();
    expect(within(lines).getByText('12.000')).toBeVisible();
  });

  it('refuses a zero or malformed quantity before sending anything', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(user);
    await openBatch(user);
    await addLine(user, '0');
    const panel = form('inventory.opening.line.heading');
    expect(
      await within(panel).findByText(EN['inventory.opening.line.quantityFormat'] as string)
    ).toBeVisible();
    expect(createOpeningBatchLine).not.toHaveBeenCalled();
  });

  it('offers approval only to inv.adjustment.approve holders, and says a second person is needed otherwise', async () => {
    const user = userEvent.setup();
    renderScreen({ canApprove: false });
    await chooseBranch(user);
    await openBatch(user);
    await addLine(user);
    await screen.findByText('12.000');
    expect(await screen.findByText(EN['inventory.opening.needsApprove'] as string)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['inventory.opening.approve.action'] as string })
    ).toBeNull();
  });

  it('approves the batch, shows it approved, and links to the stock and the movements', async () => {
    const user = userEvent.setup();
    renderScreen({ canApprove: true });
    await chooseBranch(user);
    await openBatch(user);
    await addLine(user);
    await screen.findByText('12.000');
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.opening.approve.action'] as string })
    );
    await waitFor(() => expect(approveOpeningBatch).toHaveBeenCalledWith(BATCH_ID));
    expect(
      await screen.findByText(EN['inventory.opening.approve.approved'] as string)
    ).toBeVisible();
    expect(screen.getByText(EN['inventory.opening.status.approved'] as string)).toBeVisible();
    expect(
      screen.getByRole('link', { name: EN['inventory.opening.approve.seeStock'] as string })
    ).toHaveAttribute('href', '/en/inventory');
    expect(
      screen.getByRole('link', { name: EN['inventory.opening.approve.seeMovements'] as string })
    ).toHaveAttribute('href', '/en/inventory/movements');
    // An approved batch takes no more lines.
    expect(
      screen.queryByRole('form', { name: EN['inventory.opening.line.heading'] as string })
    ).toBeNull();
  });

  it('a refused approval — the counter may not approve — is shown as the refusal it is, and the batch stays a draft', async () => {
    const user = userEvent.setup();
    approveOpeningBatch.mockResolvedValue(conflict());
    renderScreen({ canApprove: true });
    await chooseBranch(user);
    await openBatch(user);
    await addLine(user);
    await screen.findByText('12.000');
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.opening.approve.action'] as string })
    );
    expect(
      await screen.findByText(EN['inventory.opening.approve.secondPerson'] as string)
    ).toBeVisible();
    expect(screen.getByText(EN['inventory.opening.status.draft'] as string)).toBeVisible();
    expect(form('inventory.opening.line.heading')).toBeVisible();
  });
});

describe('the recovery path — a batch is reachable after the page is left', () => {
  it('lists the branch batches with the status and the line count the server gave them', async () => {
    const user = userEvent.setup();
    listOpeningBatches.mockResolvedValue(cursor([summary, approvedSummary]));
    renderScreen();
    await chooseBranch(user);
    const table = await screen.findByRole('table', {
      name: EN['inventory.opening.batches.caption'] as string,
    });
    expect(listOpeningBatches).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    const rows = within(table).getAllByRole('row');
    // Cell by cell, because the batch code also appears inside the row's own
    // open button — that is deliberate (it is what names the button) and a
    // by-text lookup would find two nodes and say nothing about the columns.
    expect(cells(rows[1])).toEqual([
      'OPEN-2026',
      '2026-09-06',
      EN['inventory.opening.status.draft'] as string,
      // The server's own line count, rendered as given — nothing is counted here.
      '1',
      `${EN['inventory.opening.batches.open'] as string} OPEN-2026`,
    ]);
    expect(cells(rows[2])).toEqual([
      'OPEN-2025',
      '2025-01-02',
      EN['inventory.opening.status.approved'] as string,
      '4',
      `${EN['inventory.opening.batches.open'] as string} OPEN-2025`,
    ]);
  });

  it('an operator who left the page opens their draft again and sees the lines the server holds', async () => {
    const user = userEvent.setup();
    listOpeningBatches.mockResolvedValue(cursor([summary]));
    renderScreen();
    await chooseBranch(user);
    // Nothing was created in this render: this is the reload case.
    expect(createOpeningBatch).not.toHaveBeenCalled();
    await openListed(user, 'OPEN-2026');
    expect(readOpeningBatch).toHaveBeenCalledWith(BATCH_ID);
    const lines = await screen.findByRole('table', {
      name: EN['inventory.opening.lines.caption'] as string,
    });
    expect(within(lines).getByText('FLT-009')).toBeVisible();
    expect(within(lines).getByText(/Oil filter/)).toBeVisible();
    expect(within(lines).getByText('WH-9')).toBeVisible();
    // The decimal string exactly as the server published it.
    expect(within(lines).getByText('7.250')).toBeVisible();
    expect(screen.getByText(EN['inventory.opening.batch.serverNote'] as string)).toBeVisible();
  });

  it('a second person, who may approve but not count, reaches the batch and approves it', async () => {
    const user = userEvent.setup();
    listOpeningBatches.mockResolvedValue(cursor([summary]));
    renderScreen({ canOperate: false, canApprove: true });
    await chooseBranch(user);
    const readsBefore = listOpeningBatches.mock.calls.length;
    await openListed(user, 'OPEN-2026');
    // The approver counts nothing: no batch form and no line form are offered.
    expect(
      screen.queryByRole('form', { name: EN['inventory.opening.batch.new'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('form', { name: EN['inventory.opening.line.heading'] as string })
    ).toBeNull();
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.opening.approve.action'] as string })
    );
    await waitFor(() => expect(approveOpeningBatch).toHaveBeenCalledWith(BATCH_ID));
    expect(
      await screen.findByText(EN['inventory.opening.approve.approved'] as string)
    ).toBeVisible();
    // The list is read again, so it cannot go on calling an approved batch a draft.
    await waitFor(() => expect(listOpeningBatches.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('a branch with no batch says so, and offers no table to read', async () => {
    const user = userEvent.setup();
    listOpeningBatches.mockResolvedValue(cursor([]));
    renderScreen();
    await chooseBranch(user);
    expect(await screen.findByText(EN['inventory.opening.batches.none'] as string)).toBeVisible();
    expect(
      screen.queryByRole('table', { name: EN['inventory.opening.batches.caption'] as string })
    ).toBeNull();
    expect(screen.queryByText(EN['inventory.opening.batches.refused'] as string)).toBeNull();
  });

  it('a list that could not be read offers another attempt; a refused one says so and does not', async () => {
    const user = userEvent.setup();
    listOpeningBatches.mockResolvedValue({ status: 'unavailable' as const, correlationId: 'corr' });
    const unavailable = renderScreen();
    await chooseBranch(user);
    expect(
      await screen.findByText(EN['inventory.opening.batches.unavailable'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['inventory.opening.batches.none'] as string)).toBeNull();
    const attempts = listOpeningBatches.mock.calls.length;
    await user.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    await waitFor(() => expect(listOpeningBatches.mock.calls.length).toBeGreaterThan(attempts));
    unavailable.unmount();

    listOpeningBatches.mockResolvedValue({ status: 'denied' as const, correlationId: 'corr' });
    renderScreen();
    await chooseBranch(user);
    expect(
      await screen.findByText(EN['inventory.opening.batches.refused'] as string)
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('a batch that cannot be read is said as that, and no line is invented', async () => {
    const user = userEvent.setup();
    listOpeningBatches.mockResolvedValue(cursor([summary]));
    readOpeningBatch.mockResolvedValue({ status: 'not-found' as const, correlationId: 'corr' });
    renderScreen();
    await chooseBranch(user);
    await openListed(user, 'OPEN-2026');
    expect(await screen.findByText(EN['inventory.opening.detail.gone'] as string)).toBeVisible();
    expect(
      screen.queryByRole('table', { name: EN['inventory.opening.lines.caption'] as string })
    ).toBeNull();
    expect(screen.queryByText(EN['inventory.opening.batch.serverNote'] as string)).toBeNull();
  });

  it('in Arabic, right to left, the batch is listed and read back in the same words', async () => {
    const user = userEvent.setup();
    listOpeningBatches.mockResolvedValue(cursor([summary]));
    renderRtl(
      <OpeningStockScreen
        locale="ar"
        messages={ar}
        canOperate={false}
        canApprove={true}
        canReadBranches={true}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const target = screen.getByRole('form', {
      name: AR['inventory.opening.targetLabel'] as string,
    });
    await user.selectOptions(await within(target).findByRole('combobox'), BRANCH_ID);
    await user.click(
      within(target).getByRole('button', {
        name: AR['inventory.opening.chooseBranch'] as string,
      })
    );
    const table = await screen.findByRole('table', {
      name: AR['inventory.opening.batches.caption'] as string,
    });
    expect(screen.getByText(AR['inventory.opening.batches.heading'] as string)).toBeVisible();
    expect(within(table).getByText(AR['inventory.opening.status.draft'] as string)).toBeVisible();
    await openListed(user, 'OPEN-2026');
    const lines = await screen.findByRole('table', {
      name: AR['inventory.opening.lines.caption'] as string,
    });
    expect(within(lines).getByText('7.250')).toBeVisible();
    expect(within(lines).getByText('WH-9')).toBeVisible();
    expect(screen.getByText(AR['inventory.opening.batch.serverNote'] as string)).toBeVisible();
    expect(
      screen.getByRole('button', { name: AR['inventory.opening.approve.action'] as string })
    ).toBeVisible();
  });
});

describe('the route page', () => {
  it('refuses without inv.stock.read, and issues no read', async () => {
    PERMISSIONS = ['inv.stock.operate', 'inv.adjustment.approve'];
    await renderPage({ locale: 'en' });
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listBranches).not.toHaveBeenCalled();
    expect(listLocations).not.toHaveBeenCalled();
  });

  it('with inv.stock.read alone, explains that operating and approving are not held', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await renderPage({ locale: 'en' });
    expect(await screen.findByText(EN['inventory.opening.needsOperate'] as string)).toBeVisible();
  });

  it('with the three codes and org.branch.read, offers the chain from the branch picker', async () => {
    PERMISSIONS = [
      'inv.stock.read',
      'inv.stock.operate',
      'inv.adjustment.approve',
      'org.branch.read',
    ];
    await renderPage({ locale: 'en' });
    expect(await within(targetForm()).findByRole('combobox')).toBeVisible();
    expect(screen.queryByText(EN['inventory.opening.needsOperate'] as string)).toBeNull();
  });

  it('a locale it does not serve is not found', async () => {
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound() was called');
  });

  /*
   * P1-30 CC-15. The finding was taken FROM THIS SCREEN: the W9 Arabic
   * opening-stock screenshot, at first paint, shows the two identifier fields
   * the branch list then replaces. Both languages are pinned here because the
   * evidence that the defect existed was an Arabic one.
   */
  it('while the permitted branch read is in flight, waits rather than asking for identifiers', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderScreen({ canReadBranches: true });
    const target = targetForm();
    expect(within(target).getByRole('status')).toHaveTextContent(
      EN['inventory.common.branchesLoading'] as string
    );
    expect(within(target).queryByLabelText(labelled('inventory.common.companyIdField'))).toBeNull();
    expect(within(target).queryByRole('combobox')).toBeNull();
    expect(
      within(target).getByRole('button', { name: EN['inventory.opening.chooseBranch'] as string })
    ).toBeDisabled();
    release(okRead({ items: [branch] }));
    expect(await within(targetForm()).findByRole('combobox')).toBeVisible();
  });

  it('in Arabic, the first paint of this screen is a wait, not two identifier boxes', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderRtl(
      <OpeningStockScreen
        locale="ar"
        messages={ar}
        canOperate={true}
        canApprove={false}
        canReadBranches={true}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const target = screen.getByRole('form', {
      name: AR['inventory.opening.targetLabel'] as string,
    });
    expect(within(target).getByRole('status')).toHaveTextContent(
      AR['inventory.common.branchesLoading'] as string
    );
    expect(
      within(target).queryByLabelText(
        new RegExp(`^${escape(AR['inventory.common.companyIdField'] as string)}`)
      )
    ).toBeNull();
    release(okRead({ items: [branch] }));
    expect(
      await within(
        screen.getByRole('form', { name: AR['inventory.opening.targetLabel'] as string })
      ).findByRole('combobox')
    ).toBeVisible();
  });

  it('renders in Arabic, right to left, with the same statement about reaching a batch again', async () => {
    const { container } = renderRtl(
      <OpeningStockScreen
        locale="ar"
        messages={ar}
        canOperate={true}
        canApprove={false}
        canReadBranches={false}
      />
    );
    expect(screen.getByText(AR['inventory.opening.batchesReadable'] as string)).toBeVisible();
    expect(container.querySelector('[dir="rtl"], [dir="ltr"]')).not.toBeNull();
  });
});
