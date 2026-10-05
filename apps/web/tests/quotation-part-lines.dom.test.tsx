import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  WorkingBranchProbe,
  branchSnapshot,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
} from './render';
import {
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
} from './support/branch-switch';
import { PICKER_OPTION_WAIT_MS } from './support/picker-option';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';

/**
 * Part lines in the quotation builder and on the quotation (P1-32-PRE-OD-FD6,
 * Owner decision D6, ADR-023).
 *
 * The properties under test:
 *
 *  - a line may quote a PART only where the operator holds `inv.item.read`, the
 *    code the part search needs; without it the builder is the service builder it
 *    was, and a service line is sent exactly as before (no `kind`);
 *  - a part is FOUND by its stock code or name and chosen, never typed, and the
 *    line says what unit its quantity is in — by the unit's NAME, isolated, as the
 *    saved tables say it — and how it is priced, a note the part box points at; the
 *    body names the item and the quantity and nothing that prices it;
 *  - the editor's explanation covers part lines where they are offered, and only
 *    services where they are not;
 *  - a part line with no part chosen is refused before anything is sent, on the
 *    part box, with the cursor there;
 *  - the server's refusal of a part with no selling price for the branch is said
 *    in words on that line's part box, focused, with the typed quantity kept, and
 *    withdrawn once another part is chosen — in English and in Arabic; and so is
 *    the refusal of a part whose price or tax changed while it was being saved;
 *  - choosing a part is unsaved work: a branch switch asks first;
 *  - the quotation shows a part line by the part's name, its stock code isolated
 *    left to right, and the unit its quantity is in, never an identifier.
 */

function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderLtrBare(withMui(ui, 'en'));
const renderRtl = (ui: ReactElement) => renderRtlBare(withMui(ui, 'ar'));

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelledIn = (catalogue: Record<string, string>, key: string) =>
  new RegExp(`^${escape(catalogue[key] as string)}`);
const labelled = (key: string) => labelledIn(EN, key);

const createQuotation = vi.fn();
vi.mock('@/features/quotations/api', () => ({
  listQuotations: vi.fn(async () => ({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  })),
  createQuotation: (...args: unknown[]) => createQuotation(...args),
  listDiscountApprovals: vi.fn(async () => ({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  })),
  decideDiscountApproval: vi.fn(),
  readQuotation: vi.fn(),
  listRevisions: vi.fn(),
  readRevision: vi.fn(),
  readRevisionDecisions: vi.fn(),
  createQuotationRevision: vi.fn(),
  issueQuotation: vi.fn(),
  decideRevision: vi.fn(),
  decideItem: vi.fn(),
}));

const listServices = vi.fn();
vi.mock('@/features/services/api', () => ({
  listServices: (...args: unknown[]) => listServices(...args),
}));

const listItems = vi.fn();
const listUnitsOfMeasure = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listItems: (...args: unknown[]) => listItems(...args),
  listUnitsOfMeasure: (...args: unknown[]) => listUnitsOfMeasure(...args),
}));

vi.mock('@/features/work-orders/api', () => ({ readWorkOrderDetail: vi.fn() }));
vi.mock('@/features/work-orders/work-order-list-read', () => ({
  listWorkOrdersCancellable: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: vi.fn(() => true),
}));

const { QuotationsScreen } = await import('@/features/quotations/components/QuotationsScreen');
const { LinesTable } = await import('@/features/quotations/components/shared');

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const BRAKES = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const FILTER = 'aaaaaaaa-0000-4000-8000-0000000000f1';

const workOrder = {
  id: WORK_ORDER_ID,
  companyId: 'c',
  branchId: 'b',
  receptionVisitId: 'r',
  vehicleId: 'v',
  kind: 'ordinary',
  state: 'open',
  partsForwardState: 'none',
  displayNumber: 'WO-000042',
  openedAt: '2026-09-01T08:00:00Z',
  recordVersion: 2,
  customer: null,
  vehicle: null,
};

function item(id: string, sku: string, name: string) {
  return {
    id,
    itemCategoryId: 'cat',
    sku,
    name,
    description: null,
    unitOfMeasure: { id: 'u', code: 'each' },
    itemType: 'part',
    isStockTracked: true,
    isSerialized: false,
    lifecycleStatus: 'active',
    recordVersion: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listServices.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  });
  listItems.mockImplementation(async (criteria: { search: string }) => ({
    status: 'ok',
    rows: [item(BRAKES, 'BRK-01', 'Brake pads'), item(FILTER, 'FLT-02', 'Oil filter')].filter(
      (row) => `${row.sku} ${row.name}`.toLowerCase().includes(criteria.search.toLowerCase())
    ),
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  }));
  listUnitsOfMeasure.mockResolvedValue({
    status: 'ok',
    data: { items: [{ id: 'u', scope: 'tenant', code: 'each', name: 'Each', dimension: 'count' }] },
    correlationId: 'corr',
  });
});

const screenProps = (over: Record<string, unknown> = {}) => ({
  workOrderId: WORK_ORDER_ID,
  workOrder: workOrder as never,
  canManage: true,
  canReadServices: false,
  canReadItems: true,
  ...over,
});

async function openBuilder(user: ReturnType<typeof userEvent.setup>, catalogue = EN) {
  await user.click(
    screen.getByRole('button', { name: catalogue['quotations.list.create'] as string })
  );
  return screen.findByRole('form', { name: catalogue['quotations.build.heading'] as string });
}

/** Searches the line's part box and chooses the option the search answers. */
async function choosePart(
  user: ReturnType<typeof userEvent.setup>,
  form: HTMLElement,
  term: string,
  option: RegExp,
  catalogue = EN
) {
  const box = within(form).getByRole('combobox', {
    name: labelledIn(catalogue, 'quotations.picker.item'),
  });
  await user.type(box, term);
  await waitFor(
    () =>
      expect(
        listItems.mock.calls.some(([criteria]) => (criteria as { search?: string }).search === term)
      ).toBe(true),
    { timeout: PICKER_OPTION_WAIT_MS }
  );
  await user.click(
    await screen.findByRole('option', { name: option }, { timeout: PICKER_OPTION_WAIT_MS })
  );
  return box;
}

const neutral = {
  state: { status: 'invalid', messageKey: 'form.formError', attempt: 1 },
  created: null,
};

const refusal = (key: string) => ({
  state: {
    status: 'invalid',
    messageKey: 'form.formError',
    fieldErrors: { itemId: key, 'lines.0.itemId': key },
    attempt: 1,
  },
  created: null,
});

describe('a line may quote a part, found and chosen', () => {
  it('without the item read, the builder is the service builder it was and sends no kind', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue(neutral);
    renderLtr(
      <QuotationsScreen locale="en" messages={en} {...screenProps({ canReadItems: false })} />
    );
    const form = await openBuilder(user);
    expect(within(form).queryByRole('radiogroup')).toBeNull();
    expect(
      within(form).queryByText(EN['quotations.lines.partsExplain'] as string, { exact: false })
    ).toBeNull();
    // Without parts on offer, the explanation speaks of services only.
    expect(
      within(form).getByText(EN['quotations.lines.explainServices'] as string, { exact: false })
    ).toBeVisible();
    expect(
      within(form).queryByText(EN['quotations.lines.explain'] as string, { exact: false })
    ).toBeNull();
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceReference')),
      '55555555-5555-4555-8555-555555555555'
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    await waitFor(() => expect(createQuotation).toHaveBeenCalled());
    const body = createQuotation.mock.calls[0]?.[0] as { lines: Record<string, unknown>[] };
    expect(body.lines).toEqual([
      { serviceId: '55555555-5555-4555-8555-555555555555', quantity: '1' },
    ]);
  });

  it('chooses a part by its words, says its unit and how it is priced, and sends the item and quantity only', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue(neutral);
    renderLtr(<QuotationsScreen locale="en" messages={en} {...screenProps()} />);
    const form = await openBuilder(user);
    await user.click(
      within(form).getByRole('radio', { name: EN['quotations.lines.kindPart'] as string })
    );
    // The part box replaces the service box on this line.
    expect(within(form).queryByLabelText(labelled('pricing.picker.serviceReference'))).toBeNull();
    // The explanation covers part lines where they are offered.
    expect(
      within(form).getByText(EN['quotations.lines.explain'] as string, { exact: false })
    ).toBeVisible();
    const box = await choosePart(user, form, 'brake', /BRK-01 — Brake pads/);
    expect(box).toHaveValue('BRK-01 — Brake pads');
    // The unit by its NAME, as the saved tables show it, isolated from the sentence.
    const unit = within(form).getByText('Each');
    expect(unit.tagName).toBe('BDI');
    const help = unit.closest('p') as HTMLElement;
    expect(help.textContent).toContain('Counted in Each.');
    expect(help.textContent).not.toContain('each.');
    expect(help.textContent).toContain(EN['quotations.lines.partPriceHelp'] as string);
    // The part box points at the note, so it is heard with the box.
    expect(help.id).not.toBe('');
    expect((box.getAttribute('aria-describedby') ?? '').split(' ')).toContain(help.id);
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '2.5');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    await waitFor(() => expect(createQuotation).toHaveBeenCalled());
    const body = createQuotation.mock.calls[0]?.[0] as { lines: Record<string, unknown>[] };
    // Strings, and nothing that prices the line: the server takes the selling price.
    expect(body.lines).toEqual([{ kind: 'part', itemId: BRAKES, quantity: '2.5' }]);
  });

  it('refuses a part line with no part chosen before sending, on the part box, with the cursor there', async () => {
    const user = userEvent.setup();
    renderLtr(<QuotationsScreen locale="en" messages={en} {...screenProps()} />);
    const form = await openBuilder(user);
    await user.click(
      within(form).getByRole('radio', { name: EN['quotations.lines.kindPart'] as string })
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    const box = within(form).getByRole('combobox', { name: labelled('quotations.picker.item') });
    expect(
      await within(form).findByText(EN['quotations.lines.itemRequired'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(createQuotation).not.toHaveBeenCalled();
  });
});

describe('a part with no selling price is refused in words, on its line', () => {
  it('marks the part box, keeps the quantity, and withdraws the refusal once another part is chosen', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue(refusal('form.violation.no_authorised_sale_price'));
    renderLtr(<QuotationsScreen locale="en" messages={en} {...screenProps()} />);
    const form = await openBuilder(user);
    await user.click(
      within(form).getByRole('radio', { name: EN['quotations.lines.kindPart'] as string })
    );
    const box = await choosePart(user, form, 'filter', /FLT-02 — Oil filter/);
    const quantity = within(form).getByLabelText(labelled('quotations.lines.quantity'));
    await user.type(quantity, '3');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );

    const sentence = EN['form.violation.no_authorised_sale_price'] as string;
    expect(await within(form).findByText(sentence)).toBeVisible();
    expect(within(form).getAllByText(sentence)).toHaveLength(1);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(quantity).toHaveValue('3');
    // No developer text: neither the rule token nor an identifier reaches the page.
    expect(form.textContent).not.toMatch(/no_authorised_sale_price|itemId/);

    await user.click(
      within(form).getByRole('button', { name: EN['inventory.itemPicker.change'] as string })
    );
    await choosePart(user, form, 'brake', /BRK-01 — Brake pads/);
    await waitFor(() => expect(within(form).queryByText(sentence)).toBeNull());
  });

  it('says it in Arabic, right to left, with the Arabic labels', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue(refusal('form.violation.no_authorised_sale_price'));
    renderRtl(<QuotationsScreen locale="ar" messages={ar} {...screenProps()} />);
    const form = await openBuilder(user, AR);
    await user.click(
      within(form).getByRole('radio', { name: AR['quotations.lines.kindPart'] as string })
    );
    await choosePart(user, form, 'brake', /BRK-01 — Brake pads/, AR);
    await user.type(within(form).getByLabelText(labelledIn(AR, 'quotations.lines.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: AR['quotations.build.submit'] as string })
    );
    expect(
      await within(form).findByText(AR['form.violation.no_authorised_sale_price'] as string)
    ).toBeVisible();
    expect(form.closest('[dir="rtl"]')).not.toBeNull();
  });
});

describe('a part whose price or tax changed while it was saved is refused on its line', () => {
  it('says so on the part box in words, keeps the quantity, and shows no developer text', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue(refusal('form.violation.part_price_changed'));
    renderLtr(<QuotationsScreen locale="en" messages={en} {...screenProps()} />);
    const form = await openBuilder(user);
    await user.click(
      within(form).getByRole('radio', { name: EN['quotations.lines.kindPart'] as string })
    );
    const box = await choosePart(user, form, 'brake', /BRK-01 — Brake pads/);
    const quantity = within(form).getByLabelText(labelled('quotations.lines.quantity'));
    await user.type(quantity, '2');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    const sentence = EN['form.violation.part_price_changed'] as string;
    expect(await within(form).findByText(sentence)).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box).toHaveFocus());
    expect(quantity).toHaveValue('2');
    expect(form.textContent).not.toMatch(/part_price_changed|itemId/);
  });

  it('says it in Arabic, with the unit named and isolated in the Arabic sentence', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue(refusal('form.violation.part_price_changed'));
    renderRtl(<QuotationsScreen locale="ar" messages={ar} {...screenProps()} />);
    const form = await openBuilder(user, AR);
    await user.click(
      within(form).getByRole('radio', { name: AR['quotations.lines.kindPart'] as string })
    );
    await choosePart(user, form, 'brake', /BRK-01 — Brake pads/, AR);
    expect(within(form).getByText('Each').tagName).toBe('BDI');
    await user.type(within(form).getByLabelText(labelledIn(AR, 'quotations.lines.quantity')), '1');
    await user.click(
      within(form).getByRole('button', { name: AR['quotations.build.submit'] as string })
    );
    expect(
      await within(form).findByText(AR['form.violation.part_price_changed'] as string)
    ).toBeVisible();
    expect(form.closest('[dir="rtl"]')).not.toBeNull();
  });
});

describe('a chosen part is unsaved work', () => {
  it('a branch switch asks first once a part is chosen', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <QuotationsScreen locale="en" messages={en} {...screenProps()} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    const form = await openBuilder(user);
    try {
      await user.click(
        within(form).getByRole('radio', { name: EN['quotations.lines.kindPart'] as string })
      );
      await choosePart(user, form, 'brake', /BRK-01 — Brake pads/);
      await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
      expect(heldBranch()).toBe(TEST_BRANCH.id);
    } finally {
      forgetRememberedBranch();
    }
  });
});

describe('the quotation shows a part line by name and unit', () => {
  const partLine = {
    id: 'line-1',
    lineNumber: 1,
    itemKind: 'part' as const,
    serviceId: null,
    item: { id: BRAKES, code: 'BRK-01', name: 'Brake pads' },
    unit: { code: 'each', name: 'Each' },
    description: null,
    currency: 'JOD',
    unitPrice: '7.5000',
    quantity: '2.000',
    discount: '0.0000',
    taxRate: '0.000000',
    taxAmount: '0.0000',
    lineTotal: '15.0000',
    priceRuleRef: null,
  };

  it('names the part and its unit, the stock code isolated left to right, and no identifier', () => {
    render(
      withMui(<LinesTable locale="en" messages={en} lines={[partLine]} caption="Lines" />, 'en')
    );
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('Brake pads')).toBeVisible();
    expect(within(row).getByText('BRK-01')).toHaveAttribute('dir', 'ltr');
    expect(within(row).getByText('Each')).toBeVisible();
    expect(within(row).getByText(EN['quotations.itemKind.part'] as string)).toBeVisible();
    expect(row.textContent).not.toContain(BRAKES);
  });

  it('reads the same in Arabic', () => {
    render(
      withMui(<LinesTable locale="ar" messages={ar} lines={[partLine]} caption="البنود" />, 'ar')
    );
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText(AR['quotations.itemKind.part'] as string)).toBeVisible();
    expect(within(row).getByText('BRK-01')).toHaveAttribute('dir', 'ltr');
    expect(within(row).getByText('Each')).toBeVisible();
  });
});
