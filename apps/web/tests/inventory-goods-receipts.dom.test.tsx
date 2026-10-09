import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import type { ReactElement } from 'react';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  WorkingBranchProbe,
  branchSnapshot,
  inBranch,
  messagesFor,
  renderLtr as renderBareLtr,
  renderRtl as renderBareRtl,
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
 *
 * Since `P1-32-PRE-OD-INV3` every render also goes under the product's Material
 * provider, as the locale layout mounts it: the screen's own fields, buttons and
 * tables are Material's, and a calendar day is an MIT picker (a group of parts,
 * typed part by part, read back from the picker's own value input). The
 * selectors below moved with that structure; what each case asserts did not.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderInLtr = (ui: ReactElement, options?: Parameters<typeof renderBareLtr>[1]) =>
  renderBareLtr(withMui(ui, 'en'), options);
const renderInRtl = (ui: ReactElement, options?: Parameters<typeof renderBareRtl>[1]) =>
  renderBareRtl(withMui(ui, 'ar'), options);
const renderLtr = (ui: ReactElement, options?: Parameters<typeof renderInLtr>[1]) =>
  renderInLtr(inBranch(ui), options);
const renderRtl = (ui: ReactElement, options?: Parameters<typeof renderInRtl>[1]) =>
  renderInRtl(inBranch(ui, { locale: 'ar' }), options);
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  FAR_ZONE,
  ITEM_ID,
  LOCATION_ID,
  branch,
  chooseBranch,
  chooseItem,
  expectOnClock,
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
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/**
 * Types a calendar day into a date picker inside `scope`, part by part, as an
 * operator does (day, month, year in both catalogues). Returns the picker's
 * group, which its label names.
 */
async function typeDay(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement,
  label: RegExp,
  digits: string
): Promise<HTMLElement> {
  const group = within(scope).getByRole('group', { name: label });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
  return group;
}

/** The day a picker shows, as the picker writes it into its own value input. */
function dayShown(group: HTMLElement): string {
  const input = group.parentElement?.querySelector('input');
  if (!input) throw new Error('the picker has no value input');
  return input.value;
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
    await chooseBranch(TARGET_FORM);
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
    await typeDay(user, form, labelled('inventory.receipts.create.receivedOn'), '17092026');
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
    await chooseBranch(TARGET_FORM);
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
    await typeDay(user, form, labelled('inventory.receipts.create.receivedOn'), '17092026');
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
    await chooseBranch(TARGET_FORM);
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
    await typeDay(user, form, labelled('inventory.receipts.create.receivedOn'), '17092026');
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
    await chooseBranch(TARGET_FORM);
    const form = createForm();
    await typeDay(user, form, labelled('inventory.receipts.create.receivedOn'), '17092026');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.create.submit'] as string })
    );
    expect(within(form).getByText(EN['inventory.receipts.noLines'] as string)).toHaveClass(
      'text-error'
    );
    expect(createGoodsReceipt).not.toHaveBeenCalled();
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`refuses a day received only partly typed as a date, and sends nothing (${locale})`, async () => {
      const catalogue = locale === 'ar' ? AR : EN;
      const named = (key: string) => new RegExp(`^${escape(catalogue[key] as string)}`);
      const user = userEvent.setup();
      if (locale === 'ar') {
        renderRtl(
          <GoodsReceiptsScreen locale="ar" messages={ar} canOperate={true} canViewCost={false} />
        );
      } else {
        renderScreen();
      }
      await screen.findByRole('region', { name: catalogue[TARGET_FORM] as string });
      const form = screen.getByRole('form', {
        name: catalogue['inventory.receipts.create.heading'] as string,
      });
      const supplier = within(form).getByLabelText(named('inventory.receipts.create.supplier'));
      await user.type(supplier, 'Supplier note 7');
      // The day and the month, and not the year.
      const day = await typeDay(user, form, named('inventory.receipts.create.receivedOn'), '1709');
      await user.click(
        within(form).getByRole('button', {
          name: catalogue['inventory.receipts.create.submit'] as string,
        })
      );
      await waitFor(() => expect(day).toHaveAttribute('aria-invalid', 'true'));
      expect(day).toHaveAccessibleDescription(
        new RegExp(escape(catalogue['inventory.opening.batch.dateFormat'] as string))
      );
      expect(supplier).toHaveValue('Supplier note 7');
      expect(createGoodsReceipt).not.toHaveBeenCalled();
    });

    /*
     * P1-32-PRE-OD-INVR — a day typed whole but impossible (31/02) holds no day
     * either; it is refused as the impossible date it is, not as a missing one
     * and not as unfinished.
     */
    it(`refuses an impossible day received as one, not as missing, and sends nothing (${locale})`, async () => {
      const catalogue = locale === 'ar' ? AR : EN;
      const named = (key: string) => new RegExp(`^${escape(catalogue[key] as string)}`);
      const user = userEvent.setup();
      if (locale === 'ar') {
        renderRtl(
          <GoodsReceiptsScreen locale="ar" messages={ar} canOperate={true} canViewCost={false} />
        );
      } else {
        renderScreen();
      }
      await screen.findByRole('region', { name: catalogue[TARGET_FORM] as string });
      const form = screen.getByRole('form', {
        name: catalogue['inventory.receipts.create.heading'] as string,
      });
      const supplier = within(form).getByLabelText(named('inventory.receipts.create.supplier'));
      await user.type(supplier, 'Supplier note 7');
      // Every part typed: the thirty-first of February.
      const day = await typeDay(
        user,
        form,
        named('inventory.receipts.create.receivedOn'),
        '31022026'
      );
      await user.click(
        within(form).getByRole('button', {
          name: catalogue['inventory.receipts.create.submit'] as string,
        })
      );
      await waitFor(() => expect(day).toHaveAttribute('aria-invalid', 'true'));
      expect(day).toHaveAccessibleDescription(
        new RegExp(escape(catalogue['inventory.opening.batch.dateInvalid'] as string))
      );
      expect(day).not.toHaveAccessibleDescription(
        new RegExp(escape(catalogue['field.required'] as string))
      );
      expect(supplier).toHaveValue('Supplier note 7');
      expect(createGoodsReceipt).not.toHaveBeenCalled();
    });

    it(`says a receipt with no reference in the page's own direction, not forced left to right (${locale})`, async () => {
      const catalogue = locale === 'ar' ? AR : EN;
      listGoodsReceipts.mockResolvedValue(okPage([receipt({ reference: null })]));
      if (locale === 'ar') {
        renderRtl(
          <GoodsReceiptsScreen locale="ar" messages={ar} canOperate={true} canViewCost={false} />
        );
      } else {
        renderScreen();
      }
      const sentence = await screen.findByText(
        catalogue['inventory.receipts.noReference'] as string
      );
      // The nearest direction it is written in is the page's own, not a code's.
      const table = sentence.closest('table') as HTMLElement;
      expect(sentence.closest('[dir]')).toBe(table.closest('[dir]'));
      expect(sentence.closest('[dir]')?.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    });

    it(`a refused quantity is marked on its own field and kept (${locale})`, async () => {
      const catalogue = locale === 'ar' ? AR : EN;
      const named = (key: string) => new RegExp(`^${escape(catalogue[key] as string)}`);
      const user = userEvent.setup();
      if (locale === 'ar') {
        renderRtl(
          <GoodsReceiptsScreen locale="ar" messages={ar} canOperate={true} canViewCost={true} />
        );
      } else {
        renderScreen({ canViewCost: true });
      }
      await screen.findByRole('region', { name: catalogue[TARGET_FORM] as string });
      const form = screen.getByRole('form', {
        name: catalogue['inventory.receipts.create.heading'] as string,
      });
      const quantity = within(form).getByLabelText(named('inventory.receipts.line.quantity'));
      const cost = within(form).getByLabelText(named('inventory.receipts.line.unitCost'));
      // Left to right in both languages, with a decimal keypad, never a spin box.
      expect(quantity).toHaveAttribute('dir', 'ltr');
      expect(quantity).toHaveAttribute('inputmode', 'decimal');
      expect(quantity).not.toHaveAttribute('type', 'number');
      expect(cost).toHaveAttribute('dir', 'ltr');
      await user.type(quantity, '0');
      await user.click(
        within(form).getByRole('button', {
          name: catalogue['inventory.receipts.line.add'] as string,
        })
      );
      await waitFor(() => expect(quantity).toHaveAttribute('aria-invalid', 'true'));
      expect(quantity).toHaveAccessibleDescription(
        new RegExp(escape(catalogue['inventory.stockOps.quantityFormat'] as string))
      );
      expect(quantity).toHaveValue('0');
      expect(cost).not.toHaveAttribute('aria-invalid');
    });
  }

  it('a second press while the receipt is being saved sends nothing more', async () => {
    let answer: (value: unknown) => void = () => undefined;
    createGoodsReceipt.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const form = createForm();
    await chooseItem(user, form);
    await within(form).findByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.receipts.line.location')),
      LOCATION_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.receipts.line.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.receipts.line.add'] as string })
    );
    await typeDay(user, form, labelled('inventory.receipts.create.receivedOn'), '17092026');
    const save = within(form).getByRole('button', {
      name: EN['inventory.receipts.create.submit'] as string,
    });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(createGoodsReceipt).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    answer(succeeded('inventory.receipts.create.success', detail({ recordVersion: 1 })));
    expect(await screen.findByRole('region', { name: /Goods receipt GR-100/ })).toBeVisible();
    expect(createGoodsReceipt).toHaveBeenCalledTimes(1);
  });
});

describe('a half-written receipt and a branch switch', () => {
  /*
   * The form is keyed on the branch, so a switch used to drop a half-written
   * receipt without a word. It now declares its unsaved work and the switch
   * asks first.
   */
  afterEach(forgetRememberedBranch);

  async function openTwoBranches(user: ReturnType<typeof userEvent.setup>) {
    renderInLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <GoodsReceiptsScreen
            locale="en"
            messages={en}
            canOperate={true}
            canViewCost={false}
            canReadBranches={true}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    return screen.findByRole('form', { name: EN['inventory.receipts.create.heading'] as string });
  }
  // The day received is an MIT picker: a group of parts named by its label.
  const receivedOn = () =>
    within(createForm()).getByRole('group', {
      name: labelled('inventory.receipts.create.receivedOn'),
    });

  it('asks before switching; staying keeps what was typed and the branch', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await typeDay(user, createForm(), labelled('inventory.receipts.create.receivedOn'), '17092026');
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(dayShown(receivedOn())).toBe('17/09/2026');
  });

  it('a day only partly typed is unsaved work too, and the switch asks first', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await typeDay(user, createForm(), labelled('inventory.receipts.create.receivedOn'), '1709');
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
  });

  it('discarding switches the branch and opens the form empty under it', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await typeDay(user, createForm(), labelled('inventory.receipts.create.receivedOn'), '17092026');
    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
    await waitFor(() =>
      expect(listGoodsReceipts.mock.lastCall?.[0]).toEqual({
        companyId: OTHER_BRANCH.companyId,
        branchId: OTHER_BRANCH.id,
      })
    );
    expect(dayShown(receivedOn())).toBe('');
  });

  it('an untouched form switches without asking', async () => {
    const user = userEvent.setup();
    await openTwoBranches(user);
    await switchWithoutQuestion(user, 'second');
    await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
  });
});

describe('posting a receipt', () => {
  /*
   * P1-32-PRE-OD-INVR — both presses inside ONE act(), so the second arrives
   * before React has re-rendered the disabled button: what is tested is the
   * panel's own hold on the posting (`sending`), not the disabled button.
   */
  it('two presses inside one act post the receipt once', async () => {
    let answer: (value: unknown) => void = () => undefined;
    postGoodsReceipt.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const panel = await openReceipt(user);
    const post = within(panel).getByRole('button', {
      name: EN['inventory.receipts.post.action'] as string,
    });
    act(() => {
      post.click();
      post.click();
    });
    expect(postGoodsReceipt).toHaveBeenCalledTimes(1);
    await act(async () =>
      answer(
        succeeded(
          'inventory.receipts.post.success',
          detail({ status: 'posted', postedAt: '2026-09-17T10:00:00Z', recordVersion: 5 })
        )
      )
    );
    expect(await screen.findByText(EN['inventory.receipts.post.posted'] as string)).toBeVisible();
    expect(postGoodsReceipt).toHaveBeenCalledTimes(1);
  });

  it('sends the version the read answered and shows the posted receipt', async () => {
    const user = userEvent.setup();
    postGoodsReceipt.mockResolvedValue(
      succeeded(
        'inventory.receipts.post.success',
        detail({ status: 'posted', postedAt: '2026-09-17T10:00:00Z', recordVersion: 5 })
      )
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
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
    await chooseBranch(TARGET_FORM);
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
    await chooseBranch(TARGET_FORM);
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
    await chooseBranch(TARGET_FORM);
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
    // Through the one money formatter, in USD's own two decimals (GAP-15).
    expect(await within(history).findByText('13.00 USD')).toBeVisible();
    expect(within(history).getByText('12.75 USD')).toBeVisible();
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
    await chooseBranch(TARGET_FORM);
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
    await chooseBranch(TARGET_FORM);
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
    PERMISSIONS = ['inv.stock.read', 'inv.stock.operate', 'inv.cost.view', 'org.branch.read'];
    const { unmount } = await renderPage();
    await chooseBranch(TARGET_FORM);
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
    const { container } = renderScreen({ canViewCost: true });
    await chooseBranch(TARGET_FORM);
    await within(listRegion()).findByRole('table');
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders in Arabic, right to left, and reads its branch there too', async () => {
    renderRtl(
      <GoodsReceiptsScreen locale="ar" messages={ar} canOperate={true} canViewCost={true} />
    );
    expect(screen.getByText(AR['inventory.receipts.explain'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
    await waitFor(() => expect(listGoodsReceipts).toHaveBeenCalled());
  });
});

/**
 * `P1-32-PRE-OD-INV5` — a receipt's posting and each cost layer are written on
 * the branch's clock, named, never on the browser's (the branch keeps a clock no
 * test environment keeps, so the two cannot read alike).
 */
describe('a receipt\u2019s moments are shown on the branch\u2019s clock (P1-32-PRE-OD-INV5)', () => {
  const POSTED = '2026-09-17T12:00:00Z';
  const LAYERED = '2026-09-18T12:30:00Z';
  for (const locale of ['en', 'ar'] as const) {
    it(`writes the posting and each cost layer on the branch's clock with its name (${locale})`, async () => {
      const T = locale === 'en' ? EN : (ar as Record<string, string>);
      readGoodsReceipt.mockResolvedValue(okRead(detail({ status: 'posted', postedAt: POSTED })));
      readItemCostHistory.mockResolvedValue(
        okRead({
          itemId: ITEM_ID,
          companyId: COMPANY_ID,
          branchId: BRANCH_ID,
          latestUnitCost: '13.0000',
          weightedAverageCost: '13.0000',
          currencyCode: 'USD',
          mixedCurrencies: false,
          layerCount: 1,
          totalQuantity: '4.000',
          layers: {
            items: [
              {
                id: 'layer-1',
                sourceKind: 'goods_receipt',
                sourceId: RECEIPT_ID,
                quantity: '4.000',
                unitCost: '13.0000',
                currencyCode: 'USD',
                effectiveAt: LAYERED,
              },
            ],
            nextCursor: null,
            hasMore: false,
          },
        })
      );
      const user = userEvent.setup();
      const render = locale === 'en' ? renderInLtr : renderInRtl;
      render(
        inBranch(
          <GoodsReceiptsScreen
            locale={locale}
            messages={locale === 'en' ? en : ar}
            canOperate={false}
            canViewCost={true}
            canReadBranches={true}
          />,
          { snapshot: branchSnapshot([{ ...TEST_BRANCH, timezone: FAR_ZONE }]), locale }
        )
      );
      const list = await screen.findByRole('region', {
        name: T['inventory.receipts.list.heading'] as string,
      });
      await user.click(
        await within(list).findByRole('button', {
          name: `${T['inventory.receipts.open'] as string} GR-100`,
        })
      );
      const panel = await screen.findByRole('region', { name: /GR-100/ });
      expectOnClock(panel, POSTED, locale);
      await user.click(
        within(panel).getByRole('button', {
          name: `${T['inventory.receipts.costHistory.show'] as string} BRK-001`,
        })
      );
      const history = await screen.findByRole('region', { name: /BRK-001/ });
      const table = await within(history).findByRole('table');
      expectOnClock(within(table).getAllByRole('row')[1] as HTMLElement, LAYERED, locale);
    });
  }
});
