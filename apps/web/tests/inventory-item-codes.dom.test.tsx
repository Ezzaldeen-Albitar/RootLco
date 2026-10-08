import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import type { ReactElement } from 'react';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  TEST_BRANCH,
  TEST_COMPANY,
  inBranch,
  messagesFor,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
} from './render';

/*
 * The sale-price form scopes a price to a company and a branch, and both are
 * chosen from the NAMED lists the working context publishes (Owner directive,
 * `P1-32-PRE-OD-UX`). They used to be typed as references. So every render
 * here goes inside a provider.
 *
 * Since `P1-32-PRE-OD-MUI7A1` it also goes under the product's Material
 * provider, as the locale layout mounts it: the screen's fields, buttons, tables
 * and read states are Material's now.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement, options?: Parameters<typeof renderInLtr>[1]) =>
  renderInLtr(withMui(inBranch(ui), 'en'), options);
const renderRtl = (ui: ReactElement, options?: Parameters<typeof renderInRtl>[1]) =>
  renderInRtl(withMui(inBranch(ui, { locale: 'ar' }), 'ar'), options);
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  ITEM_ID,
  USER_ID,
  labelled,
  okRead,
  refusedWith,
  seriousViolations,
  succeeded,
} from './support/stock-operations';

/**
 * One item's codes and selling prices, rendered (P1-32).
 *
 * The properties under test:
 *
 *  - An INTERNAL code is named as one wherever it appears, so nobody mistakes a
 *    number this workshop printed for a manufacturer's.
 *  - The kinds on offer for typing EXCLUDE the internal one: it is allocated by
 *    the server, never entered, and a form that offered it would be offering an
 *    act the server refuses.
 *  - A price row says what it applies to, and no figure is recomputed here.
 *  - Nothing is offered without the permission that owns it.
 */

const AR = ar as Record<string, string>;

const listIdentifiers = vi.fn();
const addIdentifier = vi.fn();
const retireIdentifier = vi.fn();
const assignInternalBarcode = vi.fn();
const listSalePrices = vi.fn();
const setSalePrice = vi.fn();
const listUnitsOfMeasure = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listIdentifiers: (...args: unknown[]) => listIdentifiers(...args),
  addIdentifier: (...args: unknown[]) => addIdentifier(...args),
  retireIdentifier: (...args: unknown[]) => retireIdentifier(...args),
  assignInternalBarcode: (...args: unknown[]) => assignInternalBarcode(...args),
  listSalePrices: (...args: unknown[]) => listSalePrices(...args),
  setSalePrice: (...args: unknown[]) => setSalePrice(...args),
  listUnitsOfMeasure: (...args: unknown[]) => listUnitsOfMeasure(...args),
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

const { ItemCodesScreen } = await import('@/features/inventory/components/ItemCodesScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const ItemCodesPage = (await import('@/app/[locale]/(dashboard)/inventory/items/[itemId]/page'))
  .default as unknown as RoutePage;

const MANUFACTURER_CODE = '4006381333931';
const INTERNAL_CODE = 'WS-000123';

function identifier(over: Record<string, unknown> = {}) {
  return {
    id: 'ident-1',
    itemId: ITEM_ID,
    kind: 'ean',
    value: MANUFACTURER_CODE,
    normalizedValue: MANUFACTURER_CODE,
    unit: { id: 'u', code: 'EA' },
    packQuantity: '1.000',
    isPrimary: true,
    symbology: 'ean13',
    retired: false,
    retiredAt: null,
    recordVersion: 1,
    createdAt: '2026-09-01T09:00:00.000Z',
    ...over,
  };
}

const identifierList = (rows: readonly unknown[]) =>
  okRead({ itemId: ITEM_ID, sku: 'BRK-001', isSerialized: false, identifiers: rows });

function price(over: Record<string, unknown> = {}) {
  return {
    id: 'price-1',
    itemId: ITEM_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    currencyCode: 'JOD',
    unitPrice: '12.5000',
    taxClassId: null,
    taxClassCode: null,
    status: 'active',
    recordVersion: 1,
    ...over,
  };
}

const priceList = (rows: readonly unknown[]) =>
  okRead({ itemId: ITEM_ID, sku: 'BRK-001', prices: rows });

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = ['inv.item.read', 'inv.item.manage'];
  listIdentifiers.mockResolvedValue(identifierList([identifier()]));
  listSalePrices.mockResolvedValue(priceList([price()]));
  listUnitsOfMeasure.mockResolvedValue(okRead({ items: [{ id: 'u', code: 'EA', name: 'Each' }] }));
  addIdentifier.mockResolvedValue(succeeded('inventory.identifiers.add.success', identifier()));
  retireIdentifier.mockResolvedValue(
    succeeded('inventory.identifiers.retire.success', identifier({ retired: true }))
  );
  assignInternalBarcode.mockResolvedValue(
    succeeded(
      'inventory.identifiers.internal.success',
      identifier({ id: 'ident-2', kind: 'internal', value: INTERNAL_CODE, symbology: 'code128' })
    )
  );
  setSalePrice.mockResolvedValue(succeeded('inventory.prices.set.success', price()));
});

const manage = () => <ItemCodesScreen locale="en" messages={en} itemId={ITEM_ID} canManage />;

describe('the codes panel', () => {
  it('names an internal code as one, and a manufacturer code as one', async () => {
    listIdentifiers.mockResolvedValue(
      identifierList([
        identifier(),
        identifier({ id: 'ident-2', kind: 'internal', value: INTERNAL_CODE, isPrimary: false }),
      ])
    );
    renderLtr(manage());
    const rows = await screen.findByRole('table', {
      name: EN['inventory.identifiers.caption'] as string,
    });
    // Scoped to the table: the kind list also spells these words, and a match
    // there would prove nothing about what the item actually carries.
    expect(within(rows).getByText(EN['inventory.identifierKind.internal'] as string)).toBeTruthy();
    expect(within(rows).getByText(EN['inventory.identifierKind.ean'] as string)).toBeTruthy();
    // More than once: the code labels its own withdraw control, so a screen
    // reader hears which code the button is for.
    expect(within(rows).getAllByText(INTERNAL_CODE).length).toBeGreaterThan(0);
  });

  it('shows the pack quantity a single scan stands for, as the server stated it', async () => {
    listIdentifiers.mockResolvedValue(identifierList([identifier({ packQuantity: '12.000' })]));
    renderLtr(manage());
    await waitFor(() => expect(screen.getByText('12.000')).toBeTruthy());
  });

  it('does NOT offer the internal kind for typing — it is allocated, never entered', async () => {
    renderLtr(manage());
    const kind = await screen.findByLabelText(labelled('inventory.identifiers.add.kind'));
    const offered = within(kind)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).not.toContain(EN['inventory.identifierKind.internal'] as string);
    expect(offered).toContain(EN['inventory.identifierKind.gtin'] as string);
  });

  it('sends the typed code with a key, so a doubled scan replays rather than collides', async () => {
    const user = userEvent.setup();
    renderLtr(manage());
    await user.type(
      await screen.findByLabelText(labelled('inventory.identifiers.add.value')),
      MANUFACTURER_CODE
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.identifiers.add.submit'] as string })
    );
    await waitFor(() => expect(addIdentifier).toHaveBeenCalledTimes(1));
    const [itemId, body, key] = addIdentifier.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(itemId).toBe(ITEM_ID);
    expect(body['kind']).toBe('gtin');
    expect(body['value']).toBe(MANUFACTURER_CODE);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(10);
  });

  it('refuses a pack quantity that is not a decimal before anything is sent', async () => {
    const user = userEvent.setup();
    renderLtr(manage());
    await user.type(
      await screen.findByLabelText(labelled('inventory.identifiers.add.value')),
      MANUFACTURER_CODE
    );
    await user.type(screen.getByLabelText(labelled('inventory.identifiers.add.pack')), 'twelve');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.identifiers.add.submit'] as string })
    );
    expect(screen.getByText(EN['inventory.stockOps.quantityFormat'] as string)).toBeTruthy();
    expect(addIdentifier).not.toHaveBeenCalled();
  });

  it('says in words why a code the server refused was refused', async () => {
    const user = userEvent.setup();
    addIdentifier.mockResolvedValue(refusedWith('inventory.identifiers.add.refused'));
    renderLtr(manage());
    await user.type(
      await screen.findByLabelText(labelled('inventory.identifiers.add.value')),
      MANUFACTURER_CODE
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.identifiers.add.submit'] as string })
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.identifiers.add.refused'] as string)).toBeTruthy()
    );
  });

  it('says a code already in use is in use, beside the box, and never says where', async () => {
    const user = userEvent.setup();
    addIdentifier.mockResolvedValue({
      state: {
        status: 'conflict',
        messageKey: 'form.formError',
        fieldErrors: { value: 'form.violation.duplicate_identifier' },
        attempt: 1,
      },
      created: null,
    });
    renderLtr(manage());
    await user.type(
      await screen.findByLabelText(labelled('inventory.identifiers.add.value')),
      MANUFACTURER_CODE
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.identifiers.add.submit'] as string })
    );
    const sentence = EN['form.violation.duplicate_identifier'] as string;
    expect(await screen.findByText(sentence)).toBeTruthy();
    // The code the operator scanned is still in the box to be corrected.
    expect(screen.getByLabelText(labelled('inventory.identifiers.add.value'))).toHaveValue(
      MANUFACTURER_CODE
    );
    // The rule, and not the record that holds the code: nothing names an item,
    // a branch or a location.
    expect(sentence).not.toMatch(/item|branch|location|part|warehouse/i);
  });

  it('withdraws a code and says a scan will no longer find it', async () => {
    const user = userEvent.setup();
    renderLtr(manage());
    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(EN['inventory.identifiers.retire.action'] as string),
      })
    );
    await waitFor(() => expect(retireIdentifier).toHaveBeenCalledWith(ITEM_ID, 'ident-1'));
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.identifiers.retire.done'] as string)).toBeTruthy()
    );
  });

  it('allocates an internal code with no body at all', async () => {
    const user = userEvent.setup();
    renderLtr(manage());
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.identifiers.internal.action'] as string,
      })
    );
    await waitFor(() => expect(assignInternalBarcode).toHaveBeenCalledWith(ITEM_ID));
  });

  it('says a serialised item still resolves to the item, not to one unit', async () => {
    listIdentifiers.mockResolvedValue(
      okRead({ itemId: ITEM_ID, sku: 'BRK-001', isSerialized: true, identifiers: [identifier()] })
    );
    renderLtr(manage());
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.identifiers.serializedNote'] as string)).toBeTruthy()
    );
  });

  it('offers no write at all without the catalogue write permission', async () => {
    renderLtr(<ItemCodesScreen locale="en" messages={en} itemId={ITEM_ID} canManage={false} />);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.identifiers.needsManage'] as string)).toBeTruthy()
    );
    expect(
      screen.queryByRole('button', { name: EN['inventory.identifiers.add.submit'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: EN['inventory.identifiers.internal.action'] as string,
      })
    ).toBeNull();
  });

  it('says a refused read is a refusal, not an empty item', async () => {
    listIdentifiers.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    renderLtr(manage());
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.identifiers.refused'] as string)).toBeTruthy()
    );
  });
});

describe('the prices panel', () => {
  it('says what each price row applies to, and shows the exact figure sent', async () => {
    listSalePrices.mockResolvedValue(
      priceList([
        price(),
        price({ id: 'price-2', branchId: null, unitPrice: '13.0000' }),
        price({ id: 'price-3', companyId: null, branchId: null, unitPrice: '14.2500' }),
      ])
    );
    renderLtr(manage());
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.prices.appliesBranch'] as string)).toBeTruthy()
    );
    expect(screen.getByText(EN['inventory.prices.appliesCompany'] as string)).toBeTruthy();
    expect(screen.getByText(EN['inventory.prices.appliesTenant'] as string)).toBeTruthy();
    // Through the one money formatter, in JOD's own three decimals (GAP-15).
    expect(screen.getByText('12.500 JOD')).toBeTruthy();
    expect(screen.getByText('14.250 JOD')).toBeTruthy();
  });

  it('says an item with no price refuses a counter sale of it', async () => {
    listSalePrices.mockResolvedValue(priceList([]));
    renderLtr(manage());
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.prices.none'] as string)).toBeTruthy()
    );
  });

  it('sends the price as the exact string that was typed', async () => {
    const user = userEvent.setup();
    renderLtr(manage());
    await user.type(await screen.findByLabelText(labelled('inventory.prices.set.currency')), 'jod');
    await user.type(screen.getByLabelText(labelled('inventory.prices.set.price')), '12.5000');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.prices.set.submit'] as string })
    );
    await waitFor(() => expect(setSalePrice).toHaveBeenCalledTimes(1));
    const [, body] = setSalePrice.mock.calls[0] as [string, Record<string, unknown>];
    expect(body['unitPrice']).toBe('12.5000');
    expect(body['currencyCode']).toBe('JOD');
    expect(body).not.toHaveProperty('companyId');
    expect(body).not.toHaveProperty('branchId');
  });

  it('cannot be given a branch without a company, because the control will not offer one', async () => {
    /*
     * The rule has not changed — the route refuses a branch with no company —
     * but it is now enforced by the SHAPE of the controls rather than by a
     * sentence after a rejected submission. Both were typed references; the
     * company is a named list and the branch is the branches of THAT company,
     * so the invalid pair is not expressible.
     */
    const user = userEvent.setup();
    renderLtr(manage());
    const branch = await screen.findByLabelText(labelled('inventory.prices.set.branchField'));
    expect(branch).toBeDisabled();

    await user.selectOptions(
      screen.getByLabelText(labelled('inventory.prices.set.companyField')),
      TEST_COMPANY.id
    );
    expect(branch).toBeEnabled();
    await user.selectOptions(branch, TEST_BRANCH.id);

    await user.type(screen.getByLabelText(labelled('inventory.prices.set.currency')), 'JOD');
    await user.type(screen.getByLabelText(labelled('inventory.prices.set.price')), '12.5000');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.prices.set.submit'] as string })
    );
    await waitFor(() => expect(setSalePrice).toHaveBeenCalled());
    expect(setSalePrice.mock.calls[0]?.[1]).toEqual({
      companyId: TEST_COMPANY.id,
      branchId: TEST_BRANCH.id,
      currencyCode: 'JOD',
      unitPrice: '12.5000',
    });
  });

  it('names the company and the branch, and shows neither as a reference', async () => {
    renderLtr(manage());
    const company = await screen.findByLabelText(labelled('inventory.prices.set.companyField'));
    const labels = Array.from(company.querySelectorAll('option'))
      .map((option) => option.textContent ?? '')
      .filter((text) => text.length > 0);
    expect(labels).toContain(TEST_COMPANY.name);
    expect(labels).not.toContain(TEST_COMPANY.id);
    // "Every company" is a real choice this operation publishes, not an absence.
    expect(labels).toContain(EN['inventory.prices.set.everyCompany'] as string);
  });

  /**
   * DEF-T-14. All three scopes were refused with the bare words "Not found" and
   * a correlation reference, with no field message, when the currency was one
   * the organisation does not carry. The adapter now carries the server's own
   * distinction (`inventory-api.test.ts`); what this asserts is that the form
   * puts it where the operator is looking, and that the box says the constraint
   * up front rather than leaving it to be discovered from a refusal.
   */
  it('says which currencies are allowed before the refusal, and where the refusal belongs', async () => {
    const user = userEvent.setup();
    setSalePrice.mockResolvedValue({
      state: {
        status: 'error' as const,
        messageKey: 'inventory.prices.set.notInOrganisation',
        fieldErrors: { currencyCode: 'inventory.prices.set.currencyNotCarried' },
        attempt: 1,
        correlationId: 'corr',
      },
      created: null,
    });
    renderLtr(manage());
    expect(await screen.findByText(EN['inventory.prices.set.currencyHelp'] as string)).toBeTruthy();
    await user.type(screen.getByLabelText(labelled('inventory.prices.set.currency')), 'SAR');
    await user.type(screen.getByLabelText(labelled('inventory.prices.set.price')), '12.5000');
    await user.click(
      screen.getByRole('button', { name: EN['inventory.prices.set.submit'] as string })
    );
    await waitFor(() => expect(setSalePrice).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(EN['inventory.prices.set.currencyNotCarried'] as string)
    ).toBeTruthy();
    expect(screen.getByText(EN['inventory.prices.set.notInOrganisation'] as string)).toBeTruthy();
    expect(screen.queryByText(EN['state.notFound.title'] as string)).toBeNull();
  });

  it('offers no price form without the catalogue write permission', async () => {
    renderLtr(<ItemCodesScreen locale="en" messages={en} itemId={ITEM_ID} canManage={false} />);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.prices.needsManage'] as string)).toBeTruthy()
    );
  });
});

describe('the route page', () => {
  it('denies without the catalogue read permission and issues no read', async () => {
    PERMISSIONS = [];
    renderLtr(
      (await ItemCodesPage({
        params: Promise.resolve({ locale: 'en', itemId: ITEM_ID }),
      })) as React.ReactElement
    );
    expect(listIdentifiers).not.toHaveBeenCalled();
    expect(listSalePrices).not.toHaveBeenCalled();
  });

  it('hands the write capability to the screen only when it is held', async () => {
    PERMISSIONS = ['inv.item.read'];
    renderLtr(
      (await ItemCodesPage({
        params: Promise.resolve({ locale: 'en', itemId: ITEM_ID }),
      })) as React.ReactElement
    );
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.identifiers.needsManage'] as string)).toBeTruthy()
    );
  });

  it('says a badly formed item reference is one rather than asking the server', async () => {
    PERMISSIONS = ['inv.item.read'];
    renderLtr(
      (await ItemCodesPage({
        params: Promise.resolve({ locale: 'en', itemId: 'not-an-item' }),
      })) as React.ReactElement
    );
    expect(screen.getByText(EN['inventory.common.idFormat'] as string)).toBeTruthy();
    expect(listIdentifiers).not.toHaveBeenCalled();
  });
});

describe('accessibility and Arabic', () => {
  it('has no serious or critical accessibility finding', async () => {
    const { container } = renderLtr(manage());
    await waitFor(() => expect(screen.getByText('BRK-001')).toBeTruthy());
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders right to left with its own words', async () => {
    renderRtl(<ItemCodesScreen locale="ar" messages={ar} itemId={ITEM_ID} canManage />);
    expect(document.documentElement.dir).toBe('rtl');
    await waitFor(() =>
      expect(screen.getByText(AR['inventory.identifiers.explain'] as string)).toBeTruthy()
    );
  });
});

describe('on Material UI, in both languages (P1-32-PRE-OD-MUI7A1)', () => {
  /*
   * What the move onto the shared wrappers must keep, in English and Arabic:
   * both lists are tables named by their captions; each withdraw control names
   * the code it withdraws; a read that does not answer is the shared state
   * carrying this screen's sentence — "unavailable" with a retry that reads
   * again, a refusal with none; and a refused field is marked on itself and only
   * while it is refused.
   */
  const CATALOGUES = { en: EN, ar: AR } as const;
  const renderIn = (locale: 'en' | 'ar') =>
    locale === 'en'
      ? renderLtr(<ItemCodesScreen locale="en" messages={en} itemId={ITEM_ID} canManage />)
      : renderRtl(<ItemCodesScreen locale="ar" messages={ar} itemId={ITEM_ID} canManage />);

  it.each(['en', 'ar'] as const)(
    'draws both lists as tables named by their captions, and names each withdraw by its code (%s)',
    async (locale) => {
      const T = CATALOGUES[locale];
      renderIn(locale);
      const codes = await screen.findByRole('table', {
        name: T['inventory.identifiers.caption'] as string,
      });
      expect(
        within(codes).getByRole('button', {
          name: `${T['inventory.identifiers.retire.action'] as string} ${MANUFACTURER_CODE}`,
        })
      ).toBeVisible();
      expect(
        await screen.findByRole('table', { name: T['inventory.prices.caption'] as string })
      ).toBeVisible();
      expect(document.documentElement.dir).toBe(locale === 'en' ? 'ltr' : 'rtl');
    }
  );

  it.each(['en', 'ar'] as const)(
    'an outage of the codes is "unavailable" in this screen\u2019s words, and the retry reads again (%s)',
    async (locale) => {
      const T = CATALOGUES[locale];
      const user = userEvent.setup();
      listIdentifiers.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'ref-503' });
      renderIn(locale);
      expect(await screen.findByText(T['state.unavailable.title'] as string)).toBeVisible();
      expect(screen.getByText(T['inventory.identifiers.unavailable'] as string)).toBeVisible();
      expect(screen.getByText('ref-503')).toBeVisible();
      await user.click(screen.getByRole('button', { name: T['state.retry'] as string }));
      await waitFor(() => expect(listIdentifiers).toHaveBeenCalledTimes(2));
      expect(
        await screen.findByRole('table', { name: T['inventory.identifiers.caption'] as string })
      ).toBeVisible();
    }
  );

  it.each(['en', 'ar'] as const)(
    'a refused read is the refusal in this screen\u2019s words, with no retry (%s)',
    async (locale) => {
      const T = CATALOGUES[locale];
      listSalePrices.mockResolvedValueOnce({ status: 'denied', correlationId: 'corr' });
      renderIn(locale);
      expect(await screen.findByText(T['inventory.prices.refused'] as string)).toBeVisible();
      expect(screen.getByText(T['state.denied.title'] as string)).toBeVisible();
      expect(screen.queryByRole('button', { name: T['state.retry'] as string })).toBeNull();
    }
  );

  it('an outage of the prices now offers a retry too, which reads them again', async () => {
    const user = userEvent.setup();
    listSalePrices.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'ref-504' });
    renderIn('en');
    expect(await screen.findByText(EN['inventory.prices.unavailable'] as string)).toBeVisible();
    await user.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    await waitFor(() => expect(listSalePrices).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('table', { name: EN['inventory.prices.caption'] as string })
    ).toBeVisible();
  });

  it.each(['en', 'ar'] as const)(
    'says what each panel is reading while it waits, in this screen’s own words (%s, INV1b)',
    async (locale) => {
      const T = CATALOGUES[locale];
      // Neither read answers while the waits are looked at.
      listIdentifiers.mockReturnValueOnce(new Promise(() => {}));
      listSalePrices.mockReturnValueOnce(new Promise(() => {}));
      renderIn(locale);
      const codes = await screen.findByText(T['inventory.identifiers.loading'] as string);
      const prices = screen.getByText(T['inventory.prices.loading'] as string);
      expect(codes.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
      expect(prices.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
      expect(screen.queryByText(T['state.loading'] as string)).toBeNull();
    }
  );

  it.each(['en', 'ar'] as const)(
    'marks a refused code on its own field, and only while it is refused (%s)',
    async (locale) => {
      const T = CATALOGUES[locale];
      const user = userEvent.setup();
      renderIn(locale);
      const value = await screen.findByRole('textbox', {
        name: new RegExp(
          `^${(T['inventory.identifiers.add.value'] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
        ),
      });
      expect(value).not.toHaveAttribute('aria-invalid');
      expect(value).toHaveAttribute('dir', 'ltr');
      await user.click(
        screen.getByRole('button', { name: T['inventory.identifiers.add.submit'] as string })
      );
      await waitFor(() => expect(value).toHaveAttribute('aria-invalid', 'true'));
      const errorId = value.getAttribute('aria-errormessage');
      expect(document.getElementById(errorId as string)).toHaveTextContent(
        T['field.required'] as string
      );
      expect(addIdentifier).not.toHaveBeenCalled();
    }
  );
});
