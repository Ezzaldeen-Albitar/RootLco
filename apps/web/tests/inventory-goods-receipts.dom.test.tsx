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
  branch,
  chooseBranch,
  chooseItem,
  item,
  itemPage,
  labelled,
  okPage,
  okRead,
  refusedWith,
  seriousViolations,
  succeeded,
  warehouse,
} from './support/stock-operations';

/**
 * Goods receipts and the cost history, rendered (P1-32).
 *
 * The properties under test: a receipt is created as a draft with the lines the
 * operator added, quantities and costs as typed; the cost fields exist only for a
 * holder of `inv.cost.view`; posting sends the receipt's version exactly as the
 * read answered it; a refused posting is said in words; the cost history shows
 * the server's latest and average figures and says why an average is absent for
 * mixed currencies; and the route page decides before it reads.
 */

const AR = ar as Record<string, string>;

const listGoodsReceipts = vi.fn();
const readGoodsReceipt = vi.fn();
const createGoodsReceipt = vi.fn();
const postGoodsReceipt = vi.fn();
const readItemCostHistory = vi.fn();
const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listGoodsReceipts: (...args: unknown[]) => listGoodsReceipts(...args),
  readGoodsReceipt: (...args: unknown[]) => readGoodsReceipt(...args),
  createGoodsReceipt: (...args: unknown[]) => createGoodsReceipt(...args),
  postGoodsReceipt: (...args: unknown[]) => postGoodsReceipt(...args),
  readItemCostHistory: (...args: unknown[]) => readItemCostHistory(...args),
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
    userId: 'user-1',
    permissions: PERMISSIONS,
    email: 'operator@test.local',
  }),
}));

const notifyActionResult = vi.fn<(...args: unknown[]) => boolean>(() => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { GoodsReceiptsScreen } = await import('@/features/inventory/components/GoodsReceiptsScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const ReceiptsPage = (await import('@/app/[locale]/(dashboard)/inventory/goods-receipts/page'))
  .default as unknown as RoutePage;

const RECEIPT_ID = '66666666-6666-4666-8666-666666666666';

function receipt(over: Record<string, unknown> = {}) {
  return {
    id: RECEIPT_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    reference: 'GR-100',
    supplierReference: 'Supplier note 7',
    receivedOn: '2026-09-17',
    status: 'draft',
    notes: null,
    postedAt: null,
    lineCount: 1,
    recordVersion: 4,
    createdAt: '2026-09-17T08:00:00Z',
    ...over,
  };
}
const detail = (over: Record<string, unknown> = {}) => ({
  ...receipt(over),
  lines: [
    {
      id: 'line-1',
      lineNo: 1,
      itemId: ITEM_ID,
      sku: 'BRK-001',
      locationId: LOCATION_ID,
      locationCode: 'WH-1',
      quantity: '4.000',
      hasUnitCost: true,
    },
  ],
});

const TARGET_FORM = 'inventory.receipts.targetLabel';
const TARGET_SUBMIT = 'inventory.receipts.chooseBranch';
const listRegion = () =>
  screen.getByRole('region', { name: EN['inventory.receipts.list.heading'] as string });
const createForm = () =>
  screen.getByRole('form', { name: EN['inventory.receipts.create.heading'] as string });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <GoodsReceiptsScreen
      locale="en"
      messages={en}
      canOperate={true}
      canViewCost={false}
      canReadBranches={true}
      {...over}
    />
  );
}

async function openReceipt(user: ReturnType<typeof userEvent.setup>) {
  const table = await within(listRegion()).findByRole('table');
  await user.click(
    within(table).getByRole('button', {
      name: `${EN['inventory.receipts.open'] as string} GR-100`,
    })
  );
  return screen.findByRole('region', { name: /Goods receipt GR-100/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listGoodsReceipts.mockResolvedValue(okPage([receipt()]));
  readGoodsReceipt.mockResolvedValue(okRead(detail()));
  listLocations.mockResolvedValue(okPage([warehouse]));
  listBranches.mockResolvedValue({ status: 'ok', data: { items: [branch] }, correlationId: 'c' });
  listItems.mockResolvedValue(itemPage([item]));
});

describe('recording a receipt', () => {
  it('creates a draft with the added line, the quantity as typed and no cost field without cost permission', async () => {
    const user = userEvent.setup();
    createGoodsReceipt.mockResolvedValue(
      succeeded('inventory.receipts.create.success', detail({ recordVersion: 1 }))
    );
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const form = createForm();
    expect(within(form).queryByLabelText(labelled('inventory.receipts.line.unitCost'))).toBeNull();
    expect(
      within(form).getByText(EN['inventory.receipts.line.costHidden'] as string)
    ).toBeVisible();
    await chooseItem(user, form);
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.receipts.line.location')),
      LOCATION_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.line.quantity')),
      '4.000'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.line.add'] as string })
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.create.receivedOn')),
      '2026-09-17'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.create.submit'] as string })
    );
    await waitFor(() => expect(createGoodsReceipt).toHaveBeenCalledTimes(1));
    const body = createGoodsReceipt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      receivedOn: '2026-09-17',
      lines: [{ itemId: ITEM_ID, locationId: LOCATION_ID, quantity: '4.000' }],
    });
    expect((body['lines'] as Record<string, unknown>[])[0]).not.toHaveProperty('unitCost');
    expect(typeof body['idempotencyKey']).toBe('string');
    // The created draft is shown from the server's answer.
    expect(await screen.findByRole('region', { name: /Goods receipt GR-100/ })).toBeVisible();
  });

  it('a cost holder sends the unit cost and currency together as strings', async () => {
    const user = userEvent.setup();
    createGoodsReceipt.mockResolvedValue(succeeded('inventory.receipts.create.success', detail()));
    renderScreen({ canViewCost: true });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const form = createForm();
    await chooseItem(user, form);
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.receipts.line.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.receipts.line.quantity')), '2');
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.line.unitCost')),
      '12.5000'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.line.currency')),
      'usd'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.line.add'] as string })
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.create.receivedOn')),
      '2026-09-17'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.create.submit'] as string })
    );
    await waitFor(() => expect(createGoodsReceipt).toHaveBeenCalledTimes(1));
    const body = createGoodsReceipt.mock.calls[0]?.[0] as { lines: Record<string, string>[] };
    expect(body.lines[0]).toEqual({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2',
      unitCost: '12.5000',
      currencyCode: 'USD',
    });
  });

  it('says beside the cost box that recording a purchase cost is not permitted', async () => {
    // CC-OD-32. The server refused a priced line with rule `custom`, which the
    // catalogue renders as "This value is not accepted here" — true of nothing
    // the operator typed, and silent about the one thing they can do: take the
    // cost out. The named rule puts the real reason on the control.
    const user = userEvent.setup();
    createGoodsReceipt.mockResolvedValue({
      state: {
        status: 'invalid' as const,
        messageKey: 'inventory.receipts.create.refused',
        fieldErrors: { unitCost: 'form.violation.stock_receipt_cost_permission' },
        attempt: 1,
        correlationId: 'corr-refused',
      },
      created: null,
    });
    renderScreen({ canViewCost: true });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const form = createForm();
    await chooseItem(user, form);
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.receipts.line.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.receipts.line.quantity')), '2');
    const cost = within(form).getByLabelText(labelled('inventory.receipts.line.unitCost'));
    await user.type(cost, '12.5000');
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.line.currency')),
      'usd'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.line.add'] as string })
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.create.receivedOn')),
      '2026-09-17'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.create.submit'] as string })
    );
    await waitFor(() => expect(createGoodsReceipt).toHaveBeenCalledTimes(1));
    const sentence = EN['form.violation.stock_receipt_cost_permission'] as string;
    expect(await within(form).findByText(sentence)).toBeVisible();
    expect(sentence).not.toBe(EN['form.violation.invalid']);
    // The control the sentence belongs to is the one that names it, so a screen
    // reader reaches the reason from the box rather than from the banner.
    const described = within(form).getByLabelText(labelled('inventory.receipts.line.unitCost'));
    expect(described.getAttribute('aria-describedby') ?? '').not.toBe('');
  });

  it('refuses to save a receipt with no line', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const form = createForm();
    await user.type(
      within(form).getByLabelText(labelled('inventory.receipts.create.receivedOn')),
      '2026-09-17'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.create.submit'] as string })
    );
    expect(within(form).getByText(EN['inventory.receipts.noLines'] as string)).toHaveClass(
      'text-error'
    );
    expect(createGoodsReceipt).not.toHaveBeenCalled();
  });
});

describe('posting a receipt', () => {
  it('sends the version the read answered and shows the posted receipt', async () => {
    const user = userEvent.setup();
    postGoodsReceipt.mockResolvedValue(
      succeeded(
        'inventory.receipts.post.success',
        detail({ status: 'posted', postedAt: '2026-09-17T10:00:00Z', recordVersion: 5 })
      )
    );
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const panel = await openReceipt(user);
    expect(readGoodsReceipt).toHaveBeenCalledWith(RECEIPT_ID);
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.receipts.post.action'] as string })
    );
    await waitFor(() => expect(postGoodsReceipt).toHaveBeenCalledWith(RECEIPT_ID, 4));
    expect(await screen.findByText(EN['inventory.receipts.post.posted'] as string)).toBeVisible();
    await waitFor(() => expect(listGoodsReceipts).toHaveBeenCalledTimes(2));
  });

  it('a refused posting is said in words', async () => {
    const user = userEvent.setup();
    postGoodsReceipt.mockResolvedValue(refusedWith('inventory.receipts.post.refused'));
    renderScreen();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const panel = await openReceipt(user);
    await user.click(
      within(panel).getByRole('button', { name: EN['inventory.receipts.post.action'] as string })
    );
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      EN['inventory.receipts.post.refused'] as string
    );
  });

  it('without the operate permission there is no posting and no receipt form', async () => {
    const user = userEvent.setup();
    renderScreen({ canOperate: false });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const panel = await openReceipt(user);
    expect(
      within(panel).queryByRole('button', { name: EN['inventory.receipts.post.action'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('form', { name: EN['inventory.receipts.create.heading'] as string })
    ).toBeNull();
  });
});

describe('the cost history', () => {
  it('is offered only to a cost holder, and shows the server figures', async () => {
    const user = userEvent.setup();
    readItemCostHistory.mockResolvedValue(
      okRead({
        itemId: ITEM_ID,
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        latestUnitCost: '13.0000',
        weightedAverageCost: '12.7500',
        currencyCode: 'USD',
        mixedCurrencies: false,
        layerCount: 2,
        totalQuantity: '8.000',
        layers: { items: [], nextCursor: null, hasMore: false },
      })
    );
    renderScreen({ canViewCost: true });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const panel = await openReceipt(user);
    await user.click(
      within(panel).getByRole('button', {
        name: `${EN['inventory.receipts.costHistory.show'] as string} BRK-001`,
      })
    );
    const history = await screen.findByRole('region', { name: /Cost history of BRK-001/ });
    expect(readItemCostHistory).toHaveBeenCalledWith(ITEM_ID, {
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    expect(await within(history).findByText('13.0000 USD')).toBeVisible();
    expect(within(history).getByText('12.7500 USD')).toBeVisible();
  });

  it('says why no average is shown when the costs span currencies', async () => {
    const user = userEvent.setup();
    readItemCostHistory.mockResolvedValue(
      okRead({
        itemId: ITEM_ID,
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        latestUnitCost: '13.0000',
        weightedAverageCost: null,
        currencyCode: null,
        mixedCurrencies: true,
        layerCount: 2,
        totalQuantity: '8.000',
        layers: { items: [], nextCursor: null, hasMore: false },
      })
    );
    renderScreen({ canViewCost: true });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const panel = await openReceipt(user);
    await user.click(
      within(panel).getByRole('button', {
        name: `${EN['inventory.receipts.costHistory.show'] as string} BRK-001`,
      })
    );
    expect(
      await screen.findByText(EN['inventory.receipts.costHistory.mixed'] as string)
    ).toBeVisible();
  });

  it('is not offered without the cost permission', async () => {
    const user = userEvent.setup();
    renderScreen({ canViewCost: false });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    const panel = await openReceipt(user);
    expect(
      within(panel).queryByRole('button', {
        name: `${EN['inventory.receipts.costHistory.show'] as string} BRK-001`,
      })
    ).toBeNull();
    expect(
      within(panel).getByText(EN['inventory.receipts.line.pricedYes'] as string)
    ).toBeVisible();
  });
});

describe('the /inventory/goods-receipts route page decides before it reads', () => {
  async function renderPage(locale = 'en') {
    const tree = await ReceiptsPage({ params: Promise.resolve({ locale }) });
    return renderLtr(tree as React.ReactElement);
  }

  it('refuses without inv.stock.read and issues no read', async () => {
    PERMISSIONS = ['inv.stock.operate', 'inv.cost.view'];
    await renderPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listGoodsReceipts).not.toHaveBeenCalled();
  });

  it('binds the cost fields to inv.cost.view and the forms to inv.stock.operate', async () => {
    const user = userEvent.setup();
    PERMISSIONS = ['inv.stock.read', 'inv.stock.operate', 'inv.cost.view', 'org.branch.read'];
    const { unmount } = await renderPage();
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    expect(
      within(createForm()).getByLabelText(labelled('inventory.receipts.line.unitCost'))
    ).toBeVisible();
    unmount();

    PERMISSIONS = ['inv.stock.read'];
    await renderPage();
    expect(screen.getByText(EN['inventory.receipts.needsOperate'] as string)).toBeVisible();
  });
});

describe('accessibility and Arabic', () => {
  it('the listed branch and its form have no serious or critical accessibility finding', async () => {
    const user = userEvent.setup();
    const { container } = renderScreen({ canViewCost: true });
    await chooseBranch(user, TARGET_FORM, TARGET_SUBMIT);
    await within(listRegion()).findByRole('table');
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders in Arabic, right to left', () => {
    renderRtl(
      <GoodsReceiptsScreen
        locale="ar"
        messages={ar}
        canOperate={true}
        canViewCost={true}
        canReadBranches={false}
      />
    );
    expect(screen.getByText(AR['inventory.receipts.explain'] as string)).toBeVisible();
    expect(listGoodsReceipts).not.toHaveBeenCalled();
  });
});
