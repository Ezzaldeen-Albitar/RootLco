import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  inBranch,
  messagesFor,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
} from './render';

/*
 * Every render goes under `UiFoundationProvider` and a working context, as the
 * locale layout mounts them (the screen is on Material UI since
 * P1-32-PRE-OD-INV2A).
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderInLtr(withMui(inBranch(ui), 'en'));
const renderRtl = (ui: ReactElement) => renderInRtl(withMui(inBranch(ui, { locale: 'ar' }), 'ar'));

/**
 * Vehicle service capacities, rendered (P1-32).
 *
 * The properties under test: a recorded capacity is marked as not yet confirmed
 * and only a recorded one may be confirmed; recording sends the figure as typed
 * with the source it was read from, and refuses to send one without a source;
 * the make catalogue is requested only with the authority to read it, and the
 * screen says so when it falls back to a reference; and the route page decides
 * before it reads.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listVehicleSpecifications = vi.fn();
const createVehicleSpecification = vi.fn();
const confirmVehicleSpecification = vi.fn();
const retireVehicleSpecification = vi.fn();
const listUnitsOfMeasure = vi.fn();
const listItemCategories = vi.fn();
const listItemCategoryPage = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listVehicleSpecifications: (...args: unknown[]) => listVehicleSpecifications(...args),
  createVehicleSpecification: (...args: unknown[]) => createVehicleSpecification(...args),
  confirmVehicleSpecification: (...args: unknown[]) => confirmVehicleSpecification(...args),
  retireVehicleSpecification: (...args: unknown[]) => retireVehicleSpecification(...args),
  listUnitsOfMeasure: (...args: unknown[]) => listUnitsOfMeasure(...args),
  // The part category is chosen by NAME now, from the catalogue the platform
  // publishes, so the screen reads it.
  listItemCategories: (...args: unknown[]) => listItemCategories(...args),
  // Since P1-32-PRE-OD-INV2A the category is chosen from the whole tree, read
  // page by page.
  listItemCategoryPage: (...args: unknown[]) => listItemCategoryPage(...args),
}));

const listMakes = vi.fn();
const listModels = vi.fn();
vi.mock('@/features/vehicles/catalogue-api', () => ({
  listMakes: (...args: unknown[]) => listMakes(...args),
  listModels: (...args: unknown[]) => listModels(...args),
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

const { VehicleSpecificationsScreen } =
  await import('@/features/inventory/components/VehicleSpecificationsScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const SpecificationsPage = (
  await import('@/app/[locale]/(dashboard)/inventory/vehicle-specifications/page')
).default as unknown as RoutePage;

const SPECIFICATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MAKE_ID = '55555555-5555-4555-8555-555555555555';
const MODEL_ID = '66666666-6666-4666-8666-666666666666';
const UOM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const listing = (rows: readonly unknown[]) =>
  okRead({ items: rows, nextCursor: null, hasMore: false });

function specification(over: Record<string, unknown> = {}) {
  return {
    id: SPECIFICATION_ID,
    makeId: MAKE_ID,
    modelId: MODEL_ID,
    modelYearFrom: 2018,
    modelYearTo: 2024,
    engineVariant: null,
    serviceCondition: 'oil_change',
    itemCategoryId: null,
    capacity: '4.250',
    uomId: UOM_ID,
    uomCode: 'L',
    sourceReference: 'Workshop manual, page 41',
    status: 'recorded',
    createdBy: 'someone',
    createdAt: '2026-09-01T08:00:00Z',
    confirmedBy: null,
    confirmedAt: null,
    retiredBy: null,
    retiredAt: null,
    recordVersion: 1,
    ...over,
  };
}

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <VehicleSpecificationsScreen
      locale="en"
      messages={en}
      canManage={false}
      canReadCatalogue={false}
      {...over}
    />
  );
}

const createForm = () =>
  screen.findByRole('form', { name: EN['inventory.specifications.create.heading'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listVehicleSpecifications.mockImplementation(async () => listing([specification()]));
  listItemCategories.mockResolvedValue(okRead({ items: [], nextCursor: null, hasMore: false }));
  listItemCategoryPage.mockResolvedValue(okRead({ items: [], nextCursor: null, hasMore: false }));
  listUnitsOfMeasure.mockImplementation(async () =>
    okRead({
      items: [{ id: UOM_ID, scope: 'platform', code: 'L', name: 'Litre', dimension: 'volume' }],
    })
  );
  listMakes.mockImplementation(async () => ({
    status: 'ok' as const,
    options: [{ id: MAKE_ID, scope: 'platform', code: 'TOY', name: 'A make', status: 'active' }],
    truncated: false,
    correlationId: 'corr',
  }));
  listModels.mockImplementation(async () => ({
    status: 'ok' as const,
    options: [{ id: MODEL_ID, scope: 'platform', code: 'MOD', name: 'A model', status: 'active' }],
    truncated: false,
    correlationId: 'corr',
  }));
});

describe('recorded is not confirmed', () => {
  it('marks a recorded capacity as not yet confirmed and shows its exact figure', async () => {
    renderScreen();
    await waitFor(() => expect(listVehicleSpecifications).toHaveBeenCalled());
    const table = await screen.findByRole('table');
    expect(within(table).getByText('4.250')).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.specifications.status.recorded'] as string)
    ).toBeVisible();
    expect(within(table).getByText('Workshop manual, page 41')).toBeVisible();
  });

  it('confirms a recorded capacity', async () => {
    const user = userEvent.setup();
    confirmVehicleSpecification.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.specifications.confirm.success' },
      created: null,
    });
    renderScreen({ canManage: true });
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.specifications.confirm.action'] as string,
      })
    );
    await waitFor(() => expect(confirmVehicleSpecification).toHaveBeenCalledWith(SPECIFICATION_ID));
  });

  it('offers no confirmation on one that is already confirmed, but still offers retirement', async () => {
    listVehicleSpecifications.mockImplementation(async () =>
      listing([specification({ status: 'confirmed', confirmedAt: '2026-09-02T08:00:00Z' })])
    );
    renderScreen({ canManage: true });
    expect(
      await screen.findByText(EN['inventory.specifications.status.confirmed'] as string)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: EN['inventory.specifications.confirm.action'] as string,
      })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: EN['inventory.specifications.retire.action'] as string })
    ).toBeVisible();
  });

  it('says a refused read is a refusal, not an empty list', async () => {
    listVehicleSpecifications.mockImplementation(async () => ({
      status: 'denied' as const,
      correlationId: 'corr',
    }));
    renderScreen();
    expect(await screen.findByText(EN['inventory.specifications.refused'] as string)).toBeVisible();
    expect(screen.queryByText(EN['inventory.specifications.list.none'] as string)).toBeNull();
  });
});

describe('recording a capacity', () => {
  it('sends the figure as typed with its source, and the years as years', async () => {
    const user = userEvent.setup();
    createVehicleSpecification.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.specifications.create.success' },
      created: null,
    });
    renderScreen({ canManage: true, canReadCatalogue: true });
    await user.click(
      screen.getByRole('button', { name: EN['inventory.specifications.create.open'] as string })
    );
    const form = await createForm();
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.specifications.create.make')),
      MAKE_ID
    );
    await user.selectOptions(
      await within(form).findByRole('combobox', {
        name: labelled('inventory.specifications.create.model'),
      }),
      MODEL_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.yearFrom')),
      '2018'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.serviceCondition')),
      'oil_change'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.capacity')),
      '4.250'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.specifications.create.uom')),
      UOM_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.sourceReference')),
      'Workshop manual, page 41'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.specifications.create.submit'] as string,
      })
    );
    await waitFor(() => expect(createVehicleSpecification).toHaveBeenCalled());
    expect(createVehicleSpecification.mock.calls[0]?.[0]).toEqual({
      makeId: MAKE_ID,
      modelId: MODEL_ID,
      modelYearFrom: 2018,
      serviceCondition: 'oil_change',
      capacity: '4.250',
      uomId: UOM_ID,
      sourceReference: 'Workshop manual, page 41',
    });
  });

  it('sends nothing without the source the figure was read from', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true, canReadCatalogue: true });
    await user.click(
      screen.getByRole('button', { name: EN['inventory.specifications.create.open'] as string })
    );
    const form = await createForm();
    // The figure field an operator could mistake for a suggestion starts empty.
    expect(
      within(form).getByLabelText(labelled('inventory.specifications.create.capacity'))
    ).toHaveValue('');
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.specifications.create.make')),
      MAKE_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.serviceCondition')),
      'oil_change'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.capacity')),
      '4.250'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.specifications.create.uom')),
      UOM_ID
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.specifications.create.submit'] as string,
      })
    );
    expect(createVehicleSpecification).not.toHaveBeenCalled();
    expect(within(form).getByText(EN['field.required'] as string)).toBeVisible();
  });

  it('requests no catalogue without the authority to read it, and says why', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true, canReadCatalogue: false });
    await user.click(
      screen.getByRole('button', { name: EN['inventory.specifications.create.open'] as string })
    );
    const form = await createForm();
    expect(listMakes).not.toHaveBeenCalled();
    expect(
      within(form).getByText(EN['inventory.specifications.create.noMakes'] as string)
    ).toBeVisible();
  });
});

describe('the route page', () => {
  it('refuses before it reads anything', async () => {
    PERMISSIONS = [];
    const tree = await SpecificationsPage({ params: Promise.resolve({ locale: 'en' }) });
    renderLtr(tree as React.ReactElement);
    expect(listVehicleSpecifications).not.toHaveBeenCalled();
    expect(listMakes).not.toHaveBeenCalled();
  });

  it('a locale it does not serve is not found', async () => {
    await expect(SpecificationsPage({ params: Promise.resolve({ locale: 'xx' }) })).rejects.toThrow(
      'notFound'
    );
  });
});

describe('Arabic, right to left', () => {
  it('states the same capacity in Arabic', async () => {
    renderRtl(
      <VehicleSpecificationsScreen
        locale="ar"
        messages={ar}
        canManage={false}
        canReadCatalogue={false}
      />
    );
    await waitFor(() => expect(listVehicleSpecifications).toHaveBeenCalled());
    expect(
      screen.getAllByText(AR['inventory.specifications.heading'] as string).length
    ).toBeGreaterThan(0);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('4.250')).toBeVisible();
  });
});

/* -------------------------------------------------------------------- *
 * P1-32-PRE-OD-INV2A — on Material UI, with the category tree
 * -------------------------------------------------------------------- */

const CATEGORY_ID = '77777777-7777-4777-8777-777777777777';
const FLUIDS_ID = '88888888-8888-4888-8888-888888888888';
const categoryRow = (id: string, code: string, name: string, parent: string | null) => ({
  id,
  code,
  name,
  description: null,
  parentCategoryId: parent,
  status: 'active',
  recordVersion: 1,
});

describe.each(['en', 'ar'] as const)('on Material UI (%s)', (locale) => {
  const T = locale === 'en' ? EN : AR;
  const said = (key: string) => T[key] as string;
  const named = (key: string) => new RegExp(`^${escape(said(key))}`);
  const draw = (over: { canManage?: boolean; canReadCatalogue?: boolean } = {}) =>
    (locale === 'en' ? renderLtr : renderRtl)(
      <VehicleSpecificationsScreen
        locale={locale}
        messages={locale === 'en' ? en : ar}
        canManage={over.canManage ?? false}
        canReadCatalogue={over.canReadCatalogue ?? false}
      />
    );
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole('button', { name: said('inventory.specifications.create.open') })
    );
    return screen.findByRole('form', { name: said('inventory.specifications.create.heading') });
  };

  it('chooses the part category from the whole tree, by name and path, and sends it', async () => {
    const user = userEvent.setup();
    listItemCategoryPage.mockImplementation(async (from: string | null) =>
      from === null
        ? okRead({
            items: [categoryRow(FLUIDS_ID, 'fluids', 'Fluids', null)],
            nextCursor: 'p2',
            hasMore: true,
          })
        : okRead({
            items: [categoryRow(CATEGORY_ID, 'engine_oil', 'Engine oil', FLUIDS_ID)],
            nextCursor: null,
            hasMore: false,
          })
    );
    createVehicleSpecification.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.specifications.create.success' },
      created: null,
    });
    draw({ canManage: true, canReadCatalogue: true });
    const form = await open(user);
    const tree = await within(form).findByRole('tree', {
      name: said('inventory.specifications.create.itemCategory'),
    });
    expect(listItemCategoryPage.mock.calls.map((call) => call[0])).toEqual([null, 'p2']);
    // Optional: the "no category" row is offered, in the screen's words.
    expect(
      within(tree).getByText(said('inventory.specifications.create.anyCategory'))
    ).toBeTruthy();
    await user.click(within(tree).getByText('Fluids (fluids)'));
    await user.click(await within(tree).findByText('Engine oil (engine_oil)'));
    await waitFor(() => expect(within(form).getByText(/Fluids \/ Engine oil/)).toBeTruthy());
    // And a way to the tree itself.
    expect(
      within(form)
        .getByRole('link', { name: said('inventory.setup.categories.browse') })
        .getAttribute('href')
    ).toBe(`/${locale}/inventory/categories`);

    await user.selectOptions(
      await within(form).findByLabelText(named('inventory.specifications.create.make')),
      MAKE_ID
    );
    await user.type(
      within(form).getByLabelText(named('inventory.specifications.create.serviceCondition')),
      'oil_change'
    );
    await user.type(
      within(form).getByLabelText(named('inventory.specifications.create.capacity')),
      '4.250'
    );
    await user.selectOptions(
      within(form).getByLabelText(named('inventory.specifications.create.uom')),
      UOM_ID
    );
    await user.type(
      within(form).getByLabelText(named('inventory.specifications.create.sourceReference')),
      'Manual'
    );
    await user.click(
      within(form).getByRole('button', { name: said('inventory.specifications.create.submit') })
    );
    await waitFor(() => expect(createVehicleSpecification).toHaveBeenCalledTimes(1));
    expect(createVehicleSpecification.mock.calls[0]?.[0]).toMatchObject({
      itemCategoryId: CATEGORY_ID,
    });
  });

  it('moves the cursor into the form when it opens, and back to the opener when saved', async () => {
    const user = userEvent.setup();
    createVehicleSpecification.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.specifications.create.success' },
      created: null,
    });
    draw({ canManage: true, canReadCatalogue: true });
    const opener = screen.getByRole('button', {
      name: said('inventory.specifications.create.open'),
    });
    const form = await open(user);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(form).getByRole('heading', { name: said('inventory.specifications.create.heading') })
      )
    );
    await user.selectOptions(
      await within(form).findByLabelText(named('inventory.specifications.create.make')),
      MAKE_ID
    );
    await user.type(
      within(form).getByLabelText(named('inventory.specifications.create.serviceCondition')),
      'oil_change'
    );
    await user.type(
      within(form).getByLabelText(named('inventory.specifications.create.capacity')),
      '1'
    );
    await user.selectOptions(
      within(form).getByLabelText(named('inventory.specifications.create.uom')),
      UOM_ID
    );
    await user.type(
      within(form).getByLabelText(named('inventory.specifications.create.sourceReference')),
      'Plate'
    );
    await user.click(
      within(form).getByRole('button', { name: said('inventory.specifications.create.submit') })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: said('inventory.specifications.create.heading') })
      ).toBeNull()
    );
    expect(document.activeElement).toBe(opener);
  });

  it('marks a refused year on its own box, a number box read left to right, and keeps it', async () => {
    const user = userEvent.setup();
    draw({ canManage: true, canReadCatalogue: true });
    const form = await open(user);
    const year = within(form).getByLabelText(named('inventory.specifications.create.yearFrom'));
    expect(year.getAttribute('inputmode')).toBe('numeric');
    expect(year.getAttribute('dir')).toBe('ltr');
    await user.type(year, '20188');
    await user.click(
      within(form).getByRole('button', { name: said('inventory.specifications.create.submit') })
    );
    await waitFor(() => expect(year.getAttribute('aria-invalid')).toBe('true'));
    expect(year).toHaveAccessibleDescription(
      new RegExp(escape(said('inventory.specifications.create.yearFormat')))
    );
    expect(year).toHaveValue('20188');
    expect(createVehicleSpecification).not.toHaveBeenCalled();
  });

  it('says an unavailable list is unavailable, with its reference, and reads again on retry', async () => {
    const user = userEvent.setup();
    listVehicleSpecifications.mockResolvedValueOnce({
      status: 'unavailable',
      correlationId: 'ref-5',
    });
    draw();
    const failure = await screen.findByTestId('specifications-failure');
    expect(failure.textContent).toContain(said('inventory.specifications.unavailable'));
    expect(failure.textContent).toContain('ref-5');
    await user.click(within(failure).getByRole('button', { name: said('state.retry') }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(listVehicleSpecifications).toHaveBeenCalledTimes(2);
  });

  it('says an empty list is empty, in its own words', async () => {
    listVehicleSpecifications.mockImplementation(async () => listing([]));
    draw();
    const empty = await screen.findByTestId('specifications-empty');
    expect(empty.textContent).toContain(said('inventory.specifications.list.none'));
  });
});

describe('one write per press, held by the screen while it is answered', () => {
  /*
   * Both presses go inside ONE act(), so the second arrives before React has
   * re-rendered the disabled button: what is tested is the screen's own hold.
   */
  const twice = (button: HTMLElement) =>
    act(() => {
      button.click();
      button.click();
    });

  it('recording a capacity', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    createVehicleSpecification.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderScreen({ canManage: true, canReadCatalogue: true });
    await user.click(
      screen.getByRole('button', { name: EN['inventory.specifications.create.open'] as string })
    );
    const form = await createForm();
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.specifications.create.make')),
      MAKE_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.serviceCondition')),
      'oil_change'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.capacity')),
      '2'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.specifications.create.uom')),
      UOM_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.specifications.create.sourceReference')),
      'Manual'
    );
    twice(
      within(form).getByRole('button', {
        name: EN['inventory.specifications.create.submit'] as string,
      })
    );
    expect(createVehicleSpecification).toHaveBeenCalledTimes(1);
    await act(async () =>
      release({
        state: { status: 'success', messageKey: 'inventory.specifications.create.success' },
        created: null,
      })
    );
    expect(createVehicleSpecification).toHaveBeenCalledTimes(1);
  });

  it('confirming a capacity', async () => {
    let release: (value: unknown) => void = () => undefined;
    confirmVehicleSpecification.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderScreen({ canManage: true });
    twice(
      await screen.findByRole('button', {
        name: EN['inventory.specifications.confirm.action'] as string,
      })
    );
    expect(confirmVehicleSpecification).toHaveBeenCalledTimes(1);
    await act(async () =>
      release({
        state: { status: 'success', messageKey: 'inventory.specifications.confirm.success' },
        created: null,
      })
    );
    expect(confirmVehicleSpecification).toHaveBeenCalledTimes(1);
  });
});
