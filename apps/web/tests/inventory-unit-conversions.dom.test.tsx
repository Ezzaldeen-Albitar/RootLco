import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Unit conversions, rendered (P1-32).
 *
 * The properties under test: the factor is the server exact string and the
 * screen states one direction only; stating a conversion sends the figure as
 * typed with its source and refuses to send one without a source; the same unit
 * on both sides is refused before anything is sent; retiring is offered only on
 * a line that is in force and only to a holder of the write authority; and the
 * route page decides before it reads.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listUnitConversions = vi.fn();
const setUnitConversion = vi.fn();
const retireUnitConversion = vi.fn();
const listUnitsOfMeasure = vi.fn();
const listItems = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listUnitConversions: (...args: unknown[]) => listUnitConversions(...args),
  setUnitConversion: (...args: unknown[]) => setUnitConversion(...args),
  retireUnitConversion: (...args: unknown[]) => retireUnitConversion(...args),
  listUnitsOfMeasure: (...args: unknown[]) => listUnitsOfMeasure(...args),
  // The item is chosen by NAME from the catalogue now, not typed as a
  // reference, so the finder reads it.
  listItems: (...args: unknown[]) => listItems(...args),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { UnitConversionsScreen } =
  await import('@/features/inventory/components/UnitConversionsScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const ConversionsPage = (await import('@/app/[locale]/(dashboard)/inventory/unit-conversions/page'))
  .default as unknown as RoutePage;

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const CONVERSION_ID = '44444444-4444-4444-8444-444444444444';
const LITRE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PACK_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const listing = (rows: readonly unknown[]) =>
  okRead({ items: rows, nextCursor: null, hasMore: false });

function conversion(over: Record<string, unknown> = {}) {
  return {
    id: CONVERSION_ID,
    itemId: null,
    itemSku: null,
    fromUomId: PACK_ID,
    fromUomCode: 'PACK',
    toUomId: LITRE_ID,
    toUomCode: 'L',
    factor: '4.500',
    sourceReference: 'Supplier packing note',
    status: 'active',
    createdBy: 'someone',
    createdAt: '2026-09-01T08:00:00Z',
    retiredBy: null,
    retiredAt: null,
    recordVersion: 1,
    ...over,
  };
}

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(<UnitConversionsScreen locale="en" messages={en} canManage={false} {...over} />);
}

const setForm = () =>
  screen.findByRole('form', { name: EN['inventory.conversions.set.heading'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listUnitConversions.mockImplementation(async () => listing([conversion()]));
  listItems.mockResolvedValue({
    status: 'ok' as const,
    rows: [{ id: ITEM_ID, sku: 'BRK-001', name: 'Front brake pads' }],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  });
  listUnitsOfMeasure.mockImplementation(async () =>
    okRead({
      items: [
        { id: PACK_ID, scope: 'platform', code: 'PACK', name: 'Pack', dimension: 'count' },
        { id: LITRE_ID, scope: 'platform', code: 'L', name: 'Litre', dimension: 'volume' },
      ],
    })
  );
});

describe('the list', () => {
  it('states one direction, with the factor as the server sent it', async () => {
    renderScreen();
    await waitFor(() => expect(listUnitConversions).toHaveBeenCalled());
    const table = await screen.findByRole('table');
    expect(within(table).getByText('4.500')).toBeVisible();
    expect(within(table).getByText(EN['inventory.conversions.tenantWide'] as string)).toBeVisible();
    expect(within(table).getByText('Supplier packing note')).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.conversions.status.active'] as string)
    ).toBeVisible();
  });

  it('says a refused read is a refusal, not an empty list', async () => {
    listUnitConversions.mockImplementation(async () => ({
      status: 'denied' as const,
      correlationId: 'corr',
    }));
    renderScreen();
    expect(await screen.findByText(EN['inventory.conversions.refused'] as string)).toBeVisible();
    expect(screen.queryByText(EN['inventory.conversions.list.none'] as string)).toBeNull();
  });

  it('offers no writes, and says so, without the authority for them', async () => {
    renderScreen();
    await waitFor(() => expect(listUnitConversions).toHaveBeenCalled());
    expect(screen.getByText(EN['inventory.conversions.readOnly'] as string)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['inventory.conversions.set.open'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['inventory.conversions.retire.action'] as string })
    ).toBeNull();
  });

  it('retires a line that is in force', async () => {
    const user = userEvent.setup();
    retireUnitConversion.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.conversions.retire.success' },
      created: null,
    });
    renderScreen({ canManage: true });
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.conversions.retire.action'] as string,
      })
    );
    await waitFor(() => expect(retireUnitConversion).toHaveBeenCalledWith(CONVERSION_ID));
  });

  it('offers no retirement on a line already retired', async () => {
    listUnitConversions.mockImplementation(async () =>
      listing([conversion({ status: 'retired', retiredAt: '2026-09-02T08:00:00Z' })])
    );
    renderScreen({ canManage: true });
    expect(
      await screen.findByText(EN['inventory.conversions.status.retired'] as string)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['inventory.conversions.retire.action'] as string })
    ).toBeNull();
  });
});

describe('stating a conversion', () => {
  it('sends the figure as typed, with its source', async () => {
    const user = userEvent.setup();
    setUnitConversion.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.conversions.set.success' },
      created: null,
    });
    renderScreen({ canManage: true });
    await user.click(
      screen.getByRole('button', { name: EN['inventory.conversions.set.open'] as string })
    );
    const form = await setForm();
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.conversions.set.fromUom')),
      PACK_ID
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.conversions.set.toUom')),
      LITRE_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.conversions.set.factor')),
      '4.500'
    );
    // The item is FOUND and chosen, never typed: the finder searches the
    // catalogue and the option carries the code and the name.
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.stockOps.item.search'] as string })
    );
    await within(form).findByRole('option', { name: 'BRK-001 — Front brake pads' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.stockOps.item.label')),
      ITEM_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.conversions.set.sourceReference')),
      'Supplier packing note'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.conversions.set.submit'] as string })
    );
    await waitFor(() => expect(setUnitConversion).toHaveBeenCalled());
    expect(setUnitConversion.mock.calls[0]?.[0]).toEqual({
      itemId: ITEM_ID,
      fromUomId: PACK_ID,
      toUomId: LITRE_ID,
      factor: '4.500',
      sourceReference: 'Supplier packing note',
    });
  });

  it('sends nothing without a source, and nothing with the same unit on both sides', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(
      screen.getByRole('button', { name: EN['inventory.conversions.set.open'] as string })
    );
    const form = await setForm();
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.conversions.set.fromUom')),
      LITRE_ID
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.conversions.set.toUom')),
      LITRE_ID
    );
    await user.type(within(form).getByLabelText(labelled('inventory.conversions.set.factor')), '1');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.conversions.set.submit'] as string })
    );
    expect(setUnitConversion).not.toHaveBeenCalled();
    expect(
      within(form).getByText(EN['inventory.conversions.set.sameUnit'] as string)
    ).toBeVisible();
    expect(within(form).getByText(EN['field.required'] as string)).toBeVisible();
  });
});

describe('the route page', () => {
  it('refuses before it reads anything', async () => {
    PERMISSIONS = [];
    const tree = await ConversionsPage({ params: Promise.resolve({ locale: 'en' }) });
    renderLtr(tree as React.ReactElement);
    expect(listUnitConversions).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: EN['inventory.conversions.set.open'] as string })
    ).toBeNull();
  });

  it('a locale it does not serve is not found', async () => {
    await expect(ConversionsPage({ params: Promise.resolve({ locale: 'xx' }) })).rejects.toThrow(
      'notFound'
    );
  });
});

describe('Arabic, right to left', () => {
  it('states the same factor in Arabic', async () => {
    renderRtl(<UnitConversionsScreen locale="ar" messages={ar} canManage={false} />);
    await waitFor(() => expect(listUnitConversions).toHaveBeenCalled());
    expect(
      screen.getAllByText(AR['inventory.conversions.heading'] as string).length
    ).toBeGreaterThan(0);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('4.500')).toBeVisible();
  });
});
