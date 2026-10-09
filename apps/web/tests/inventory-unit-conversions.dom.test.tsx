import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { formatInZone, zoneLabelAt } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  WorkingBranchProbe,
  branchSnapshot,
  inBranch,
  messagesFor,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
} from './render';
import {
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
} from './support/branch-switch';

/*
 * Every render goes under `UiFoundationProvider` and a working context, as the
 * locale layout mounts them (the screen is on Material UI since
 * P1-32-PRE-OD-INV2A, and a recorded moment is written on the branch's clock).
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

/* -------------------------------------------------------------------- *
 * P1-32-PRE-OD-INV2A — on Material UI
 * -------------------------------------------------------------------- */

describe.each(['en', 'ar'] as const)('on Material UI (%s)', (locale) => {
  const T = locale === 'en' ? EN : AR;
  const said = (key: string) => T[key] as string;
  const draw = (canManage = false) =>
    (locale === 'en' ? renderLtr : renderRtl)(
      <UnitConversionsScreen
        locale={locale}
        messages={locale === 'en' ? en : ar}
        canManage={canManage}
      />
    );

  it('writes when a line was stated on the branch clock, with the clock named beside it', async () => {
    draw();
    const table = await screen.findByRole('table');
    const language = intlLocale(locale);
    const when = formatInZone('2026-09-01T08:00:00Z', language, TEST_BRANCH.timezone as string);
    const clock = zoneLabelAt('2026-09-01T08:00:00Z', language, TEST_BRANCH.timezone as string);
    expect(within(table).getByText(when)).toBeTruthy();
    expect(within(table).getByText(clock)).toBeTruthy();
    // The moment is never inside a forced left-to-right span.
    const forced = within(table).getByText(when).closest('[dir="ltr"]');
    expect(forced === null || !table.contains(forced)).toBe(true);
  });

  it('says an unavailable list is unavailable, with its reference, and reads again on retry', async () => {
    const user = userEvent.setup();
    listUnitConversions.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'ref-9' });
    draw();
    const failure = await screen.findByTestId('conversions-failure');
    expect(failure.textContent).toContain(said('inventory.conversions.unavailable'));
    expect(failure.textContent).toContain('ref-9');
    await user.click(within(failure).getByRole('button', { name: said('state.retry') }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(listUnitConversions).toHaveBeenCalledTimes(2);
  });

  it('offers no retry after a refusal', async () => {
    listUnitConversions.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    draw();
    const failure = await screen.findByTestId('conversions-failure');
    expect(failure.textContent).toContain(said('inventory.conversions.refused'));
    expect(within(failure).queryByRole('button', { name: said('state.retry') })).toBeNull();
  });

  it('says an empty list is empty, in its own words', async () => {
    listUnitConversions.mockImplementation(async () => listing([]));
    draw();
    const empty = await screen.findByTestId('conversions-empty');
    expect(empty.textContent).toContain(said('inventory.conversions.list.none'));
  });

  it('moves the cursor into the form when it opens, and back to the opener when saved', async () => {
    const user = userEvent.setup();
    setUnitConversion.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.conversions.set.success' },
      created: null,
    });
    draw(true);
    const opener = screen.getByRole('button', { name: said('inventory.conversions.set.open') });
    await user.click(opener);
    const form = await screen.findByRole('form', {
      name: said('inventory.conversions.set.heading'),
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(form).getByRole('heading', { name: said('inventory.conversions.set.heading') })
      )
    );
    const named = (key: string) => new RegExp(`^${escape(said(key))}`);
    await user.selectOptions(
      await within(form).findByLabelText(named('inventory.conversions.set.fromUom')),
      PACK_ID
    );
    await user.selectOptions(
      within(form).getByLabelText(named('inventory.conversions.set.toUom')),
      LITRE_ID
    );
    const factor = within(form).getByLabelText(named('inventory.conversions.set.factor'));
    // A text box with a numeric keypad, left to right in both languages.
    expect(factor.getAttribute('inputmode')).toBe('decimal');
    expect(factor.getAttribute('dir')).toBe('ltr');
    await user.type(factor, '4.500');
    await user.type(
      within(form).getByLabelText(named('inventory.conversions.set.sourceReference')),
      'Label'
    );
    await user.click(
      within(form).getByRole('button', { name: said('inventory.conversions.set.submit') })
    );
    await waitFor(() => expect(setUnitConversion).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: said('inventory.conversions.set.heading') })
      ).toBeNull()
    );
    expect(document.activeElement).toBe(opener);
  });

  it('marks a refused factor on its own box and keeps what was typed', async () => {
    const user = userEvent.setup();
    draw(true);
    await user.click(screen.getByRole('button', { name: said('inventory.conversions.set.open') }));
    const form = await screen.findByRole('form', {
      name: said('inventory.conversions.set.heading'),
    });
    const named = (key: string) => new RegExp(`^${escape(said(key))}`);
    const factor = within(form).getByLabelText(named('inventory.conversions.set.factor'));
    await user.type(factor, '0');
    await user.click(
      within(form).getByRole('button', { name: said('inventory.conversions.set.submit') })
    );
    await waitFor(() => expect(factor.getAttribute('aria-invalid')).toBe('true'));
    expect(factor).toHaveAccessibleDescription(
      new RegExp(escape(said('inventory.conversions.set.factorFormat')))
    );
    expect(factor).toHaveValue('0');
    expect(setUnitConversion).not.toHaveBeenCalled();
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

  it('stating a conversion', async () => {
    const user = userEvent.setup();
    let open: (value: unknown) => void = () => undefined;
    setUnitConversion.mockReturnValue(new Promise((resolve) => (open = resolve)));
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
    await user.type(within(form).getByLabelText(labelled('inventory.conversions.set.factor')), '2');
    await user.type(
      within(form).getByLabelText(labelled('inventory.conversions.set.sourceReference')),
      'Label'
    );
    twice(
      within(form).getByRole('button', { name: EN['inventory.conversions.set.submit'] as string })
    );
    expect(setUnitConversion).toHaveBeenCalledTimes(1);
    await act(async () =>
      open({
        state: { status: 'success', messageKey: 'inventory.conversions.set.success' },
        created: null,
      })
    );
    expect(setUnitConversion).toHaveBeenCalledTimes(1);
  });

  it('retiring a line', async () => {
    let open: (value: unknown) => void = () => undefined;
    retireUnitConversion.mockReturnValue(new Promise((resolve) => (open = resolve)));
    renderScreen({ canManage: true });
    twice(
      await screen.findByRole('button', {
        name: EN['inventory.conversions.retire.action'] as string,
      })
    );
    expect(retireUnitConversion).toHaveBeenCalledTimes(1);
    await act(async () =>
      open({
        state: { status: 'success', messageKey: 'inventory.conversions.retire.success' },
        created: null,
      })
    );
    expect(retireUnitConversion).toHaveBeenCalledTimes(1);
  });
});

describe('a half-stated conversion and a branch switch', () => {
  afterEach(forgetRememberedBranch);

  it('asks before switching; staying keeps what was typed', async () => {
    const user = userEvent.setup();
    renderInLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="first" />
            <BranchSwitch to={OTHER_BRANCH.id} label="second" />
            <WorkingBranchProbe />
            <UnitConversionsScreen locale="en" messages={en} canManage />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        ),
        'en'
      )
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.click(
      screen.getByRole('button', { name: EN['inventory.conversions.set.open'] as string })
    );
    const form = await setForm();
    const factor = within(form).getByLabelText(labelled('inventory.conversions.set.factor'));
    await user.type(factor, '3');
    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(factor).toHaveValue('3');
  });
});
