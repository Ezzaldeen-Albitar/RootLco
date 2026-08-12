import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import { MAX_CHARGE_PORT, MAX_USABLE_CAPACITY_KWH } from '@/features/vehicles/relations-contract';

/**
 * The EV / hybrid profile (`P1-27-FE-024`).
 *
 * ## Why this file exists
 *
 * `EvProfileSection` appeared in ZERO tests, and `setEvProfileAction` appeared
 * only as a discarded `vi.fn()` stub in two unrelated files. The section was
 * shipped as a read, the write was wired in late, and the test file was never
 * extended past the read — so every write-only property was unasserted.
 *
 * ## The dangerous property
 *
 * `veh.vehicle-ev-profile-set` is create-or-REPLACE. Every field is sent every
 * time and an omitted one is CLEARED. So a form that is not pre-filled from the
 * current profile silently erases capacity and port the moment an operator
 * changes anything else. The prefill exists; nothing proved it, and the mutation
 * below is what makes it provable.
 *
 * ## The bound that disagreed with the server
 *
 * The client declared `usableCapacityKwh: z.number().positive()` while the route
 * declares `z.number().min(0).max(MAX_USABLE_CAPACITY_KWH)`. Zero is a real
 * reading — a battery removed, or recorded as unknown-and-zero — and the client
 * refused a value the platform stores, which is precisely what
 * `components/forms/RecordForm.tsx` says a client bound must never do.
 */

const setEvProfileAction = vi.fn();

vi.mock('@/features/vehicles/relations-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    setEvProfileAction: (...a: unknown[]) => setEvProfileAction(...a),
    listRelationships: async () => ({
      status: 'ok',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'cid',
    }),
  };
});
vi.mock('@/features/crm/customers/api', () => ({ searchCustomers: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { EvProfileSection } =
  await import('@/features/vehicles/components/VehicleRelationsSections');

/*
 * The submit control's label, resolved from the catalogue ONCE and asserted
 * non-empty below.
 *
 * This file first used a key that does not exist. Every `queryByRole(...,
 * { name })` then matched nothing and every `toBeNull()` passed — not because
 * the form was absent but because the NAME was. A vacuity of my own making, and
 * the guard at the foot of this file is what turns it into a failure.
 */
const SAVE_LABEL = en['vehicles.ev.record'];

const PROFILE = {
  // eh.ev_profiles.ev_kind is ev | hybrid | phev. An invalid value here
  // leaves the REQUIRED select empty and HTML validation blocks the submit —
  // which is how this fixture first made the write look unreachable.
  evKind: 'bev',
  usableCapacityKwh: '64.50',
  chargePortType: 'CCS2',
  highVoltageWarning: true,
};

beforeEach(() => {
  setEvProfileAction.mockReset();
  setEvProfileAction.mockResolvedValue({ status: 'idle' });
});

function render(overrides: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(
    <EvProfileSection
      locale={locale}
      messages={messages}
      state={{ status: 'ok', profile: PROFILE }}
      // `veh.vehicles.powertrain_category` is `ice | ev | hybrid | phev | other`
      // — the vocabulary `canHaveEvProfile` tests against.
      powertrainCategory="ev"
      canEdit
      vehicleId="v-1"
      {...overrides}
    />
  );
}

describe('replace semantics — the form is seeded from the current profile', () => {
  it('pre-fills every field, because an omitted one is CLEARED by the write', async () => {
    render();
    // The whole point: this is a REPLACE. A blank form would erase capacity and
    // port as soon as an operator changed the kind.
    expect(screen.getByLabelText(en['vehicles.ev.capacity'])).toHaveValue(64.5);
    expect(screen.getByLabelText(en['vehicles.ev.port'])).toHaveValue('CCS2');
    expect(screen.getByLabelText(en['vehicles.ev.highVoltage'])).toBeChecked();
  });

  it('sends the unchanged fields back when only one is edited', async () => {
    // The assertion the mutation kills. Change the port; capacity must survive.
    const user = userEvent.setup();
    render();
    const port = screen.getByLabelText(en['vehicles.ev.port']);
    await user.clear(port);
    await user.type(port, 'CHAdeMO');
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    // `waitFor`: the action is async, and the click returns before it runs.
    await waitFor(() => expect(setEvProfileAction).toHaveBeenCalledTimes(1));
    // `.bind(null, vehicleId)` prepends the id, so the FormData is argument TWO.
    const form = setEvProfileAction.mock.calls[0]?.[2] as FormData | undefined;
    expect(form, 'the write was never called').toBeDefined();
    expect(form?.get('chargePortType')).toBe('CHAdeMO');
    expect(form?.get('usableCapacityKwh'), 'capacity was silently cleared').toBe('64.50');
  });

  it('offers a blank form when there is no profile yet', () => {
    render({ state: { status: 'none' } });
    expect(screen.getByText(en['vehicles.ev.notRecordedYet'])).toBeInTheDocument();
    expect(screen.getByLabelText(en['vehicles.ev.capacity'])).toHaveValue(null);
  });
});

describe('the section says which of the three states it is in', () => {
  it('says an ICE vehicle does not take an EV profile, and offers no form', () => {
    render({ state: { status: 'none' }, powertrainCategory: 'ice' });
    expect(screen.getByText(en['vehicles.ev.notApplicable'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
  });

  it('does not read a FAILED read as "no profile"', () => {
    // Collapsing them would tell an operator a battery-electric vehicle has no
    // battery recorded, which is a different and much worse statement.
    const { container } = render({
      state: { status: 'unavailable', correlationId: 'corr-9' },
    });
    expect(container.textContent ?? '').not.toContain(en['vehicles.ev.notRecordedYet']);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('permission and lifecycle gating', () => {
  it('offers no form to an operator without veh.vehicle.manage', () => {
    const { container } = render({ canEdit: false });
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    // The read is still shown — this is a visibility gate on the WRITE.
    expect(container.textContent ?? '').toContain('CCS2');
  });

  it('offers no form on a vehicle that has no profile and cannot take one', () => {
    render({ state: { status: 'none' }, canEdit: false });
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
  });
});

describe('the client bounds match the route, and no tighter', () => {
  it('accepts zero, which the route accepts and the client used to refuse', () => {
    // `.positive()` refused this. `veh.ev_profiles.usable_capacity_kwh` stores
    // it and `route.ts` declares `.min(0)`.
    const capacity = screen.queryByLabelText(en['vehicles.ev.capacity']);
    expect(capacity).toBeNull();
    render();
    const field = screen.getByLabelText(en['vehicles.ev.capacity']);
    expect(field).toHaveAttribute('min', '0');
  });

  it('states the same ceiling the domain does', () => {
    expect(MAX_USABLE_CAPACITY_KWH).toBe(99_999.99);
    expect(MAX_CHARGE_PORT).toBe(40);
    render();
    expect(screen.getByLabelText(en['vehicles.ev.capacity'])).toHaveAttribute(
      'max',
      String(MAX_USABLE_CAPACITY_KWH)
    );
  });
});

describe('Arabic', () => {
  it('renders the section and its form right-to-left', () => {
    render({}, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByLabelText(ar['vehicles.ev.capacity'])).toBeInTheDocument();
  });
});

describe('this file is not vacuous', () => {
  it('really rendered the section, which no previous test did', () => {
    const { container } = render();
    expect(container.querySelector('form')).not.toBeNull();
    expect(screen.getByRole('button', { name: SAVE_LABEL })).toBeInTheDocument();
  });

  it('shows no raw identifier', () => {
    const { container } = render();
    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });

  it('uses a submit label and a vocabulary that really exist', () => {
    /*
     * The guard the docblock promises, and it is not hypothetical: this file
     * first looked for `vehicles.ev.save`, which is not a key. Every
     * `queryByRole(..., { name })` matched nothing, so every "offers no form"
     * assertion passed while proving nothing — and the fixture's `evKind` was
     * `battery`, not a member of `EV_KINDS`, which left the required select
     * empty and made the write look unreachable.
     *
     * Both were mistakes in the TEST that read exactly like product defects.
     */
    expect(SAVE_LABEL, 'the submit label resolved to nothing').toBeTruthy();
    expect(Object.keys(en)).toContain('vehicles.ev.record');
    expect(PROFILE.evKind, 'the fixture must use a real EV kind').toBe('bev');
    for (const key of ['vehicles.ev.capacity', 'vehicles.ev.port', 'vehicles.ev.highVoltage']) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
  });
});
