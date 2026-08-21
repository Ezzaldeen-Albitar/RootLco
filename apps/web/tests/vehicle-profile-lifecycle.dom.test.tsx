import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { VehicleDetail } from '@/features/vehicles/profile-contract';

/**
 * `VehicleProfileScreen`, in a DOM — the lifecycle gates (`P1-27-FE-021`,
 * `FE-022`, `FE-024`).
 *
 * ## Why this file exists
 *
 * Two separate holes, and the second is the reason the first survived.
 *
 * 1. **The screen had no component coverage at all.** Nothing in the suite
 *    imported `VehicleProfileScreen`; its only appearances anywhere under
 *    `apps/web/tests` were inside `*` comment lines. It composes eight sections
 *    and decides, per section, whether a write control is offered — the one
 *    decision a contract test structurally cannot reach.
 *
 * 2. **`isFrozen` covered `merged` only, while three server writers refuse
 *    `merged` OR `scrapped`.** On a scrapped vehicle the plate form, the
 *    ownership transfer, the authorised-party form and the EV form each
 *    rendered a live Save whose only possible answer was `409 ERR-RES-002` —
 *    and every docblock beside those gates said "a merged or scrapped vehicle",
 *    which is what made it hard to see. The prose was right and the predicate
 *    was wrong.
 *
 * The block that should have caught it, `describe('permission and lifecycle
 * gating')` in `ev-profile.dom.test.tsx`, contained two cases that both varied
 * only `canEdit`; `isFrozen` was asserted twice for `merged` and never for
 * `scrapped`.
 *
 * ## What is asserted, and in which direction
 *
 * Every case runs against the SAME capabilities and differs only in
 * `lifecycleStatus`, so a control that disappears did so because of the
 * lifecycle and not because the operator lost a permission. Each absence is
 * paired with a presence on an `active` vehicle, so an assertion cannot pass
 * because the screen rendered nothing.
 *
 * The over-block direction is asserted too: a scrapped vehicle's DETAILS can
 * still be corrected (`vehicle-write-service.ts:119` guards `merged` alone) and
 * its final odometer reading can still be recorded (`vehicle-odometer-service.ts`
 * has no lifecycle guard). Widening the freeze to cover those would have removed
 * two working controls — a defect of the same kind, pointing the other way.
 *
 * ## The last section runs the adapters for real
 *
 * `the field errors a real 422 carries` at the foot of this file does NOT use
 * the module mock below. It points the two captured spies at the actual
 * implementations and mocks only `@/lib/api/server-client`, so a real
 * `ApiClient` meets a real problem document over a stubbed `fetch`. That is
 * deliberate and it is the only way the case can mean anything: what was broken
 * was the JOIN between a parse that produces catalogue keys and a screen that
 * rendered none of them, and every tier on either side of that join was green.
 */

const listOwnerships = vi.fn();
const listPlates = vi.fn();
const listOdometerReadings = vi.fn();
const listRelationships = vi.fn();
const listAttributeHistory = vi.fn();
// Captured rather than inline, so a case can make the write FAIL. It was an
// anonymous `vi.fn` returning `idle` for the whole of the phase, which is why no
// case here had ever seen this panel after a failed submit.
const changeVehicleStatusAction = vi.fn();
// Captured for the same reason: `FE-019` is about whether the EDIT panel re-reads
// the vehicle after a successful save, and an anonymous `vi.fn` returning `idle`
// can never reach the success branch — so the omission was invisible.
const updateVehicleAction = vi.fn();

vi.mock('@/features/vehicles/profile-api', () => ({
  updateVehicleAction: (...a: unknown[]) => updateVehicleAction(...a),
  changeVehicleStatusAction: (...a: unknown[]) => changeVehicleStatusAction(...a),
  checkVinAvailability: vi.fn(async () => ({ status: 'unavailable' })),
}));
vi.mock('@/features/vehicles/history-api', () => ({
  listOwnerships: (...a: unknown[]) => listOwnerships(...a),
  listPlates: (...a: unknown[]) => listPlates(...a),
  listOdometerReadings: (...a: unknown[]) => listOdometerReadings(...a),
  assignPlateAction: vi.fn(async () => ({ status: 'idle' })),
  transferOwnershipAction: vi.fn(async () => ({ status: 'idle' })),
  recordOdometerAction: vi.fn(async () => ({ status: 'idle' })),
}));
vi.mock('@/features/vehicles/relations-api', () => ({
  listRelationships: (...a: unknown[]) => listRelationships(...a),
  authorizePartyAction: vi.fn(async () => ({ status: 'idle' })),
  retirePartyAction: vi.fn(async () => ({ status: 'idle' })),
  linkCustomerAction: vi.fn(async () => ({ status: 'idle' })),
  setEvProfileAction: vi.fn(async () => ({ status: 'idle' })),
}));
vi.mock('@/features/vehicles/duplicates-api', () => ({
  listAttributeHistory: (...a: unknown[]) => listAttributeHistory(...a),
}));
vi.mock('@/features/crm/customers/api', () => ({ searchCustomers: vi.fn() }));

/*
 * The transport, for the last section only.
 *
 * A REAL `ApiClient` over a stubbed `fetch`, so the status → kind mapping, the
 * violation parse and `fromFailure` all run as shipped. Every other case in this
 * file drives the adapters through the module mock above and never reaches this.
 */
const fetchImpl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server-client', async () => {
  const { ApiClient } = await import('@/lib/api/client');
  return {
    authorizedClient: async () =>
      new ApiClient({
        baseUrl: 'http://api.test',
        fetchImpl: (input: unknown, init: unknown) => fetchImpl(input, init),
      }),
  };
});
// `refresh` captured, not anonymous — `F4` is about whether the screen re-reads
// the vehicle after a successful status change, and an anonymous mock cannot say.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const { VehicleProfileScreen } =
  await import('@/features/vehicles/components/VehicleProfileScreen');

/**
 * The REAL adapters, kept beside the spies that stand in for them.
 *
 * `vi.mock` above replaces the module for the whole file, and the two writers
 * are the ones the last section needs to run for real. Rather than a second
 * test file — which would put the same screen's cases in two places — the spies
 * are pointed at these implementations there and at `mockResolvedValue`
 * everywhere else.
 */
const actualProfileApi = await vi.importActual<typeof import('@/features/vehicles/profile-api')>(
  '@/features/vehicles/profile-api'
);

/*
 * Labels resolved from the catalogue ONCE and asserted non-empty at the foot of
 * this file. A key that does not exist makes every `queryByRole(..., { name })`
 * match nothing and every `toBeNull()` pass for the wrong reason — the exact
 * vacuity that made `ev-profile.dom.test.tsx` green while measuring nothing.
 */
const PLATE_FORM = en['vehicles.plate.assign'];
const TRANSFER_FORM = en['vehicles.ownership.transfer'];
const ODOMETER_FORM = en['vehicles.odometer.record'];
const AUTHORIZE_FORM = en['vehicles.relationships.authorize'];
const EV_SAVE = en['vehicles.ev.record'];
const RETIRE_CONTROL = en['vehicles.relationships.retire'];
const EDIT_HEADING = en['vehicles.profile.editHeading'];
const STATUS_HEADING = en['vehicles.profile.statusHeading'];
const TERMINAL_NOTE = en['vehicles.profile.terminalNote'];
const FROZEN_NOTE = en['vehicles.profile.frozenNote'];

const VEHICLE: VehicleDetail = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  displayNumber: 'V-0001',
  vin: '1HGCM82633A004352',
  makeId: 'mk1',
  makeName: 'Toyota',
  modelId: 'md1',
  modelName: 'Camry',
  trimId: null,
  trimName: null,
  bodyTypeId: null,
  bodyTypeName: null,
  powertrainTypeId: null,
  powertrainTypeName: null,
  modelYear: 2019,
  // `ev`, so the EV section offers a save rather than "not applicable" — the
  // gate under test is the lifecycle one, and an inapplicable powertrain would
  // hide the form for an unrelated and correct reason.
  powertrainCategory: 'ev',
  color: 'Silver',
  lifecycleStatus: 'active',
  workshopStatus: 'none',
  mergedIntoId: null,
  recordVersion: 3,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
};

function page() {
  return {
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'fixed-correlation-id',
  };
}

/** An OPEN authorised party — the only row shape that offers the retire control. */
const AUTHORIZED_PARTY = {
  id: 'rel-1',
  partnerId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  partnerName: 'Layla Haddad',
  partnerNumber: 'C-000482',
  partnerType: 'individual',
  relationshipRole: 'authorized_person',
  validFrom: '2026-01-01',
  validTo: null,
  active: true,
  allowedActions: ['approve_quotation'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  for (const fn of [
    listOwnerships,
    listPlates,
    listOdometerReadings,
    listRelationships,
    listAttributeHistory,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue(page());
  }
  changeVehicleStatusAction.mockReset();
  changeVehicleStatusAction.mockResolvedValue({ status: 'idle' });
  updateVehicleAction.mockReset();
  updateVehicleAction.mockResolvedValue({ status: 'idle' });
  refresh.mockReset();
  fetchImpl.mockReset();
});

/** Every capability held. The lifecycle is then the ONLY variable. */
function render(
  overrides: Partial<VehicleDetail> = {},
  locale: 'en' | 'ar' = 'en'
): ReturnType<typeof renderLtr> {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(
    <VehicleProfileScreen
      locale={locale}
      messages={messages}
      vehicle={{ ...VEHICLE, ...overrides }}
      canEdit
      canChangeStatus
      canManageRelationships
      canLinkCustomer
      canRecordOdometer
      evProfile={{ status: 'none' }}
      canListDocuments
      documents={{ status: 'ok', documentIds: [] }}
    />
  );
}

/** Move to a section by its tab, and wait for that section's table to settle. */
async function openSection(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name }));
}

describe('a scrapped vehicle withdraws exactly the writes the server refuses', () => {
  it('offers the plate form on an active vehicle', async () => {
    render();
    await openSection(en['vehicles.profile.section.plates']);
    await waitFor(() => expect(screen.getByRole('button', { name: PLATE_FORM })).toBeTruthy());
  });

  it('withdraws the plate form on a scrapped vehicle', async () => {
    const view = render({ lifecycleStatus: 'scrapped' });
    await openSection(en['vehicles.profile.section.plates']);
    // Wait for the table itself, so "no form" is not "nothing rendered yet".
    await waitFor(() => expect(listPlates).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector('table')).toBeTruthy());
    expect(screen.queryByRole('button', { name: PLATE_FORM })).toBeNull();
  });

  it('withdraws the ownership transfer on a scrapped vehicle', async () => {
    const view = render({ lifecycleStatus: 'scrapped' });
    await openSection(en['vehicles.profile.section.ownership']);
    await waitFor(() => expect(listOwnerships).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector('table')).toBeTruthy());
    expect(screen.queryByRole('button', { name: TRANSFER_FORM })).toBeNull();
  });

  it('offers the ownership transfer on an active vehicle', async () => {
    render();
    await openSection(en['vehicles.profile.section.ownership']);
    await waitFor(() => expect(screen.getByRole('button', { name: TRANSFER_FORM })).toBeTruthy());
  });

  it('withdraws the authorised-party form on a scrapped vehicle', async () => {
    const view = render({ lifecycleStatus: 'scrapped' });
    await openSection(en['vehicles.profile.section.relationships']);
    await waitFor(() => expect(listRelationships).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector('table')).toBeTruthy());
    expect(screen.queryByRole('button', { name: AUTHORIZE_FORM })).toBeNull();
  });

  it('offers the authorised-party form on an active vehicle', async () => {
    render();
    await openSection(en['vehicles.profile.section.relationships']);
    await waitFor(() => expect(screen.getByRole('button', { name: AUTHORIZE_FORM })).toBeTruthy());
  });

  it('withdraws the electric-drive save on a scrapped vehicle', async () => {
    render({ lifecycleStatus: 'scrapped' });
    await openSection(en['vehicles.profile.section.ev']);
    // The EV section is rendered from a server-read prop, so it is present
    // immediately: its explanatory sentence is the positive control that the
    // section itself did render.
    expect(screen.getByText(en['vehicles.ev.notRecordedYet'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: EV_SAVE })).toBeNull();
  });

  it('offers the electric-drive save on an active vehicle', async () => {
    render();
    await openSection(en['vehicles.profile.section.ev']);
    expect(screen.getByRole('button', { name: EV_SAVE })).toBeTruthy();
  });

  it('withdraws the status panel and says why', () => {
    render({ lifecycleStatus: 'scrapped' });
    // `LIFECYCLE_TRANSITIONS.scrapped` is `[]` and a terminal vehicle's workshop
    // axis is pinned to `none`, so every control on this panel would answer 409.
    expect(screen.queryByRole('heading', { name: STATUS_HEADING })).toBeNull();
    expect(screen.getByText(TERMINAL_NOTE)).toBeTruthy();
  });

  it('offers the status panel on an active vehicle', () => {
    render();
    expect(screen.getByRole('heading', { name: STATUS_HEADING })).toBeTruthy();
    expect(screen.queryByText(TERMINAL_NOTE)).toBeNull();
  });

  it('keeps the chosen move after a failed write, on both axes', async () => {
    /*
     * `R-04` — `NEW-FE-01`'s fourth site, and the only one that was fully
     * UNCONTROLLED: both selects were `defaultValue=""` with no `onChange` and
     * no `key`, so nothing anywhere held what the operator picked.
     *
     * React resets the form once the action settles, the choice reverts to
     * "Leave unchanged", and a resubmit sends NOTHING — which
     * `changeVehicleStatusAction` answers with `vehicles.profile.chooseAStatus`
     * (`profile-api.ts:143`). The operator is told to choose a status
     * immediately after choosing one, and the move they actually wanted is never
     * retried.
     *
     * Both axes are asserted: they are separate controls with separate state,
     * and fixing one would leave the other exactly as it was.
     */
    changeVehicleStatusAction.mockResolvedValue({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'corr-veh-status',
      attempt: 1,
    });
    const user = userEvent.setup();
    render();

    const lifecycle = screen.getByLabelText(en['crm.customers.column.status'], { exact: false });
    const workshop = screen.getByLabelText(en['vehicles.column.workshop'], { exact: false });
    await user.selectOptions(lifecycle, 'inactive');
    await user.selectOptions(workshop, 'in_workshop');

    await user.click(screen.getByRole('button', { name: en['vehicles.profile.applyStatus'] }));

    await waitFor(() => expect(changeVehicleStatusAction).toHaveBeenCalledTimes(1));

    expect(
      screen.getByLabelText(en['crm.customers.column.status'], { exact: false }),
      'the lifecycle move reverted to "Leave unchanged"; a retry would send nothing'
    ).toHaveValue('inactive');
    expect(
      screen.getByLabelText(en['vehicles.column.workshop'], { exact: false }),
      'the workshop move reverted to "Leave unchanged"'
    ).toHaveValue('in_workshop');
  });

  it('says why to an operator who never had the status permission', () => {
    /*
     * The note carried a `canChangeStatus &&` conjunct — a permission governing
     * NONE of the four surfaces it explains. An operator holding
     * `veh.vehicle.manage` and `veh.vehicle.relationship.manage` but not
     * status-manage lost the plate form, the transfer, the authorise form and
     * the electric-drive save with no explanation anywhere: exactly the silence
     * the note exists to prevent, and unreachable by every other case in this
     * file because they all render with all six capabilities set.
     */
    renderLtr(
      <VehicleProfileScreen
        locale="en"
        messages={en}
        vehicle={{ ...VEHICLE, lifecycleStatus: 'scrapped' }}
        canEdit
        canChangeStatus={false}
        canManageRelationships
        canLinkCustomer
        canRecordOdometer
        evProfile={{ status: 'none' }}
        canListDocuments
        documents={{ status: 'ok', documentIds: [] }}
      />
    );
    expect(screen.getByText(TERMINAL_NOTE)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: STATUS_HEADING })).toBeNull();
  });
});

describe('a scrapped vehicle keeps the writes the server still accepts', () => {
  it('keeps the edit panel, because vehicle-update guards merged alone', () => {
    render({ lifecycleStatus: 'scrapped' });
    expect(screen.getByRole('heading', { name: EDIT_HEADING })).toBeTruthy();
  });

  it('keeps the RETIRE control, because the retire writer has no lifecycle guard', async () => {
    /*
     * The first version of this fix gated authorise and retire on ONE prop, on
     * a table row that said both refuse merged and scrapped. Only `add` does:
     * `addAuthorizedParty` calls `requireWritableVehicle`,
     * `retireAuthorizedParty` (`vehicle-relations-service.ts:104-152`) calls it
     * nowhere, `veh.vehicle_relationships` carries no lifecycle trigger, and the
     * route calls straight through — retiring on a scrapped vehicle returns 200.
     *
     * So the fix REMOVED a working control: taking an authorised driver off a
     * written-off car is exactly the cleanup somebody needs to do. That is the
     * defect the two-predicate design exists to avoid, one method over, and it
     * was invisible because nothing rendered this column through the screen.
     */
    listRelationships.mockResolvedValue({ ...page(), rows: [AUTHORIZED_PARTY] });
    render({ lifecycleStatus: 'scrapped' });
    await openSection(en['vehicles.profile.section.relationships']);
    await waitFor(() => expect(screen.getByRole('button', { name: RETIRE_CONTROL })).toBeTruthy());
    // …while the ADD form, which the server does refuse, stays withdrawn.
    expect(screen.queryByRole('button', { name: AUTHORIZE_FORM })).toBeNull();
  });

  it('keeps the odometer form, because the odometer writer has no lifecycle guard', async () => {
    render({ lifecycleStatus: 'scrapped' });
    await openSection(en['vehicles.profile.section.odometer']);
    await waitFor(() => expect(screen.getByRole('button', { name: ODOMETER_FORM })).toBeTruthy());
  });
});

describe('a merged vehicle withdraws everything', () => {
  it('replaces both overview panels with the frozen note', () => {
    render({ lifecycleStatus: 'merged', mergedIntoId: 'a1b2c3d4-0000-4000-8000-000000000002' });
    expect(screen.getByText(FROZEN_NOTE)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EDIT_HEADING })).toBeNull();
    expect(screen.queryByRole('heading', { name: STATUS_HEADING })).toBeNull();
    // The scrapped note is for a vehicle that is still partly editable. Showing
    // both would say two different things about the same vehicle.
    expect(screen.queryByText(TERMINAL_NOTE)).toBeNull();
  });

  it('withdraws the odometer form as well — a POLICY, not a server mirror', async () => {
    /*
     * Stated accurately, because the comment this pins used to claim the server
     * refused it. It does not: `vehicle-odometer-service.ts` has no lifecycle
     * guard, and `tg_vehicles_merge_guard` is `BEFORE UPDATE ON veh.vehicles`,
     * so it cannot fire for an INSERT into `veh.odometer_readings`. The server
     * would accept a reading against a merged vehicle.
     *
     * It is withheld because a merged vehicle is a duplicate folded into a
     * survivor, and a reading recorded against the tombstone is one nobody will
     * find. If the Owner decides otherwise this case is what changes — which is
     * the point of writing the reason down rather than a false server citation.
     */
    const view = render({ lifecycleStatus: 'merged' });
    await openSection(en['vehicles.profile.section.odometer']);
    await waitFor(() => expect(listOdometerReadings).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector('table')).toBeTruthy());
    expect(screen.queryByRole('button', { name: ODOMETER_FORM })).toBeNull();
  });
});

describe('the edit panel re-reads the vehicle it just changed — FE-019', () => {
  /**
   * `EditPanel` was the ONE writer on this screen that never re-read.
   *
   * `vehicle` is a prop, read on the SERVER by the page: a successful PATCH
   * changes the stored row and nothing on screen. `ProfileHeader` kept printing
   * the pre-edit title, model year and reference; `Overview` kept printing the
   * pre-edit colour and VIN. The operator saw "Vehicle updated." beside values
   * that had not moved, which reads as a save that did not happen — and the next
   * submission is computed against `original` values that are now stale, so a
   * field they had just corrected is offered back as unchanged.
   *
   * `EvProfileSection` and `StatusPanel` both already called `router.refresh()`
   * for exactly this reason. The refresh IS the assertion, because there is no
   * client fetch to re-run and nothing else can bring the new row back.
   */
  async function editColour(to: string) {
    const user = userEvent.setup();
    render();
    // `exact`, because `Overview` renders the same catalogue string as a `dt`
    // beside this field — a substring match would find the wrong node, or two.
    await user.clear(screen.getByLabelText(en['vehicles.create.color'], { exact: true }));
    await user.type(screen.getByLabelText(en['vehicles.create.color'], { exact: true }), to);
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
  }

  it('refreshes the page read after a successful save', async () => {
    updateVehicleAction.mockResolvedValue({
      status: 'success',
      messageKey: 'vehicles.profile.saved',
    });
    await editColour('Blue');

    await waitFor(() => expect(updateVehicleAction).toHaveBeenCalledTimes(1));
    // The changed field, and only it: an absent field leaves the column
    // untouched and an explicit null CLEARS it, so a full-object PATCH would
    // wipe what the operator did not touch.
    expect(updateVehicleAction.mock.calls[0]?.[1]).toEqual({ color: 'Blue' });
    await waitFor(() =>
      expect(
        refresh,
        'the header and overview keep the pre-edit values after a successful save'
      ).toHaveBeenCalledTimes(1)
    );
  });

  it('does not refresh when the save was refused', async () => {
    // The other direction, so the case above cannot be satisfied by a panel that
    // refreshes unconditionally — which would spend a server round trip on an
    // edit that did not land, and would look identical on a green suite.
    updateVehicleAction.mockResolvedValue({
      status: 'invalid',
      fieldErrors: { color: 'field.tooLong' },
    });
    await editColour('Blue');

    await waitFor(() => expect(updateVehicleAction).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh when nothing changed, because nothing was sent', async () => {
    // `updateVehicleAction` returns `idle` for an empty change set without
    // calling the client at all. A refresh here would be a page read triggered
    // by a button press that did nothing.
    updateVehicleAction.mockResolvedValue({ status: 'idle' });
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(updateVehicleAction).toHaveBeenCalledTimes(1));
    expect(updateVehicleAction.mock.calls[0]?.[1]).toEqual({});
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('the guard against this file measuring nothing', () => {
  it('resolves every label it asserts on', () => {
    for (const label of [
      PLATE_FORM,
      TRANSFER_FORM,
      ODOMETER_FORM,
      AUTHORIZE_FORM,
      EV_SAVE,
      EDIT_HEADING,
      STATUS_HEADING,
      TERMINAL_NOTE,
      FROZEN_NOTE,
    ]) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('carries the scrapped note in both catalogues, and not as the same string', () => {
    expect(typeof ar['vehicles.profile.terminalNote']).toBe('string');
    expect(ar['vehicles.profile.terminalNote']).not.toBe(en['vehicles.profile.terminalNote']);
  });

  it('renders the scrapped note in Arabic too', () => {
    render({ lifecycleStatus: 'scrapped' }, 'ar');
    expect(screen.getByText(ar['vehicles.profile.terminalNote'])).toBeTruthy();
  });
});

describe('the status selects offer only moves the server will accept', () => {
  /*
   * `P1-27-FE-019`. Both selects listed the whole vocabulary — every lifecycle
   * status except `merged`, and all four workshop statuses — regardless of where
   * the vehicle actually was. So `draft → inactive` and `inactive → draft` were
   * both offered and both refused with `invalid_transition`
   * (`vehicle-lifecycle.ts:227-233`).
   *
   * The refusal was unreadable, which is what made it matter: the platform
   * publishes field detail as `violations` and the client read `errors`, a
   * field the API has never sent (`P1-27-INT-028`), so `Outcome` showed only
   * "The form could not be saved." The operator picked something that looked
   * legitimate and was told nothing.
   *
   * Present tense is wrong now and this said "reads". The ProblemDetails
   * correction made the client read `violations`, and the describe block lower
   * in THIS file — "the field errors a real 422 carries reach the controls it
   * names" — drives a real 422 through to the control it names.
   *
   * That sentence first named a separate file, `vehicle-profile-field-errors`,
   * which was written and then folded into this one when it pushed the web test
   * file count past the figure the deliverable manifest asserts. The reference
   * was not updated with the move, so a docblock named a file that does not
   * exist — in the commit that corrected two other docblocks for saying things
   * that were not true. Caught by the adversarial pass, not by any gate.
   *
   * The option sets below are still the primary fix — an option whose only
   * answer is a 422 should not be offered — and are what this block asserts.
   *
   * These assert the OPTION SETS, because that is where the defect lived. The
   * panel-level gating is covered above and is a different question.
   */
  /*
   * Scoped to the container this render produced, not to `screen`.
   *
   * Two of these cases render more than once to compare states, and
   * testing-library only cleans up BETWEEN tests — so a global `screen` query
   * finds every screen mounted so far and fails with "Found multiple elements".
   * Scoping keeps each comparison honest.
   */
  function optionsOf(label: string, overrides: Partial<VehicleDetail>): string[] {
    const view = render(overrides);
    const select = within(view.container).getByLabelText(label);
    return [...select.querySelectorAll('option')]
      .map((option) => option.getAttribute('value') ?? '')
      .filter((value) => value !== '');
  }

  const lifecycleOptions = (overrides: Partial<VehicleDetail> = {}) =>
    optionsOf(en['crm.customers.column.status'], overrides);

  const workshopOptions = (overrides: Partial<VehicleDetail> = {}) =>
    optionsOf(en['vehicles.column.workshop'], overrides);

  it('offers exactly the graph row for a draft vehicle', () => {
    // NOT `inactive`. `draft` reaches only `active` or `scrapped`.
    expect(lifecycleOptions({ lifecycleStatus: 'draft' }).sort()).toEqual(['active', 'scrapped']);
  });

  it('offers exactly the graph row for an active vehicle', () => {
    expect(lifecycleOptions({ lifecycleStatus: 'active' }).sort()).toEqual([
      'inactive',
      'scrapped',
    ]);
  });

  it('offers exactly the graph row for an inactive vehicle', () => {
    // `draft` is absent: nothing returns to draft.
    expect(lifecycleOptions({ lifecycleStatus: 'inactive' }).sort()).toEqual([
      'active',
      'scrapped',
    ]);
  });

  it('withholds scrapping while the vehicle is in a workshop', () => {
    /*
     * The cross-axis rule at `vehicle-lifecycle.ts:275-281`: a terminal vehicle
     * cannot be in a workshop, so `active → scrapped` is refused outright while
     * `workshopStatus` is anything but `none`. Offering it there is an option
     * whose only possible outcome is a 422 the operator cannot read.
     */
    expect(lifecycleOptions({ lifecycleStatus: 'active', workshopStatus: 'in_workshop' })).toEqual([
      'inactive',
    ]);
  });

  it('RESTORES scrapping once the workshop select is set to none in the same request', async () => {
    /*
     * `F1`. The rule above was applied against the vehicle's CURRENT workshop
     * status; the server applies it to the RESULTING pair
     * (`TERMINAL_LIFECYCLE.has(resultingLifecycle) && resultingWorkshop !== 'none'`).
     *
     * Both selects submit in ONE request, so an operator returning a car from
     * the workshop and scrapping it in the same submission — workshop → `none`,
     * lifecycle → `scrapped` — is making a move the server accepts. `scrapped`
     * was not on the menu to make it with, so the fix removed a working control
     * while claiming to encode the rule honestly.
     */
    const user = userEvent.setup();
    const view = render({ lifecycleStatus: 'active', workshopStatus: 'in_workshop' });
    const lifecycle = within(view.container).getByLabelText(en['crm.customers.column.status']);

    const values = () =>
      [...lifecycle.querySelectorAll('option')]
        .map((option) => option.getAttribute('value') ?? '')
        .filter(Boolean);

    expect(values(), 'scrapping is refused while the car is in the workshop').toEqual(['inactive']);

    await user.selectOptions(
      within(view.container).getByLabelText(en['vehicles.column.workshop']),
      'none'
    );

    expect(
      values().sort(),
      'the operator cannot scrap a car they are returning from the workshop in one move'
    ).toEqual(['inactive', 'scrapped']);
  });

  it('withdraws in_workshop once scrapping is chosen, the direction left to the 422', async () => {
    /*
     * `F2`. `allowedWorkshopTargets` applied NO cross-axis rule, so the one
     * combination that actually trips the server was still on the menu: from
     * (active, none) the lifecycle select offered `scrapped` and the workshop
     * select offered `in_workshop`, and submitting both is refused.
     *
     * The direction the fix claimed to have closed was the direction it opened.
     */
    const user = userEvent.setup();
    const view = render({ lifecycleStatus: 'active', workshopStatus: 'none' });
    const workshop = within(view.container).getByLabelText(en['vehicles.column.workshop']);

    const values = () =>
      [...workshop.querySelectorAll('option')]
        .map((option) => option.getAttribute('value') ?? '')
        .filter(Boolean);

    expect(values()).toEqual(['in_workshop']);

    await user.selectOptions(
      within(view.container).getByLabelText(en['crm.customers.column.status']),
      'scrapped'
    );

    expect(
      values(),
      'a scrapped vehicle was still offered a workshop, which is the pair the server refuses'
    ).toEqual([]);
  });

  it('re-reads the vehicle after a successful change, so the menu is not stale', async () => {
    /*
     * `F4`. `FE-019` made both menus a function of the server-read `vehicle`
     * prop and then never re-read it. After the first successful save the
     * options were still computed from PRE-CHANGE state, so the panel went back
     * to offering moves whose only outcome is the unreadable 422 the fix existed
     * to remove.
     *
     * The status lives in the page's own server-side read, so a router refresh
     * is the only thing that can bring the new pair back — which makes the
     * refresh itself the assertion.
     */
    changeVehicleStatusAction.mockResolvedValue({ status: 'success' });
    const user = userEvent.setup();
    render();

    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status'], { exact: false }),
      'inactive'
    );
    await user.click(screen.getByRole('button', { name: en['vehicles.profile.applyStatus'] }));

    await waitFor(() => expect(changeVehicleStatusAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(refresh, 'the menu stays computed from pre-change state').toHaveBeenCalled()
    );
  });

  it('offers exactly the graph row on the workshop axis', () => {
    expect(workshopOptions({ workshopStatus: 'none' })).toEqual(['in_workshop']);
    expect(workshopOptions({ workshopStatus: 'ready_for_delivery' }).sort()).toEqual([
      'in_workshop',
      'none',
    ]);
  });

  it('never offers merged on any row', () => {
    // Reached through `veh.vehicle-merge`, never through the status operation.
    // Previously excluded by a filter beside the select; now absent from the
    // graph itself, so there is one statement of the rule rather than two.
    for (const status of ['draft', 'active', 'inactive'] as const) {
      expect(lifecycleOptions({ lifecycleStatus: status })).not.toContain('merged');
    }
  });
});

/**
 * A real 422, from the wire to the control it names (`P1-27-INT-028`).
 *
 * ## The gap this closes
 *
 * The field-error path was fixed in three places and never joined up. The client
 * learned to read `violations` instead of `problem.errors` — a field the API has
 * never sent — and `fromFailure` learned to put the resulting catalogue keys in
 * `state.fieldErrors`. Both are covered by tests that stop at the boundary:
 * `api-client.test.ts` asserts the parse, `write-adapters-driven.test.ts`
 * asserts the request and says in its own header that failure mapping is
 * deliberately absent. **Nothing anywhere fed a real 422 with violations into a
 * rendered P1-27 screen**, and `VehicleProfileScreen` — which passed `error` to
 * no control and so could not render a field error at all — was green
 * throughout.
 *
 * A parse that produces a key nobody renders is not a fixed error path.
 *
 * ## How much of it is real
 *
 * Everything except the socket. The two adapters run as shipped, and
 * `@/lib/api/server-client` hands them a real `ApiClient` whose `fetchImpl`
 * answers with a real `Response` carrying a real problem document. So the
 * status-to-kind mapping, the violation parse, `controlNameFor`,
 * `violationMessageKey`, `fromFailure`, the adapter's own Zod schema and the
 * component all execute.
 *
 * ## The fixtures are the API's own shapes, read off it
 *
 * `{ path: 'body.color', rule: 'too_big' }` is what
 * `vehicles/[vehicleId]/route.ts` emits: its `Body` bounds `color` with
 * `.max(MAX_COLOR)` and `toViolations` uses Zod's issue code verbatim.
 * `{ path: 'body.lifecycleStatus', rule: 'invalid_transition' }` is
 * `vehicle-lifecycle.ts:227-233`, raised as `ERR-VAL-001` by
 * `vehicle-lifecycle-service.ts:218-224`.
 *
 * The field is spelled `color`, not `colour`. That is what the column, the
 * schema and the wire all use; a fixture spelled the English way maps to a
 * control that does not exist and would pass for the wrong reason.
 *
 * The colour bound is mirrored client-side, so in practice `too_big` on `color`
 * is caught before a request exists. That does not make the case artificial — it
 * makes it the one that matters. A client mirror is a convenience and the server
 * is the authority, so the interesting 422 is always the one the client did not
 * predict, and the transport has to work for a rule the client has never heard
 * of. `invalid_transition` below is exactly that: not catalogued, so it lands as
 * the honest generic key rather than as a raw token.
 */
describe('the field errors a real 422 carries reach the controls it names', () => {
  interface Violation {
    readonly path: string;
    readonly rule: string;
  }

  /**
   * The response the API really sends for a refused command.
   *
   * `application/problem+json`, because `readPayload` parses on the `json`
   * substring — a fixture served as `text/plain` arrives as a null problem and
   * every assertion below would then pass or fail for the wrong reason.
   */
  function refuseWith(...violations: readonly Violation[]): void {
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'https://errors.example.test/ERR-VAL-001',
          title: 'Validation failed',
          status: 422,
          code: 'ERR-VAL-001',
          violations,
        }),
        { status: 422, headers: { 'content-type': 'application/problem+json' } }
      )
    );
  }

  const COLOR = en['vehicles.create.color'];
  const VIN = en['vehicles.create.vin'];
  const REFERENCE = en['vehicles.column.reference'];
  const LIFECYCLE = en['crm.customers.column.status'];

  /*
   * The two writers, unmocked. Set here rather than at the top of the file so
   * every case above keeps the module mock it was written against.
   */
  beforeEach(() => {
    updateVehicleAction.mockImplementation(actualProfileApi.updateVehicleAction);
    changeVehicleStatusAction.mockImplementation(actualProfileApi.changeVehicleStatusAction);
  });

  /** The control, by its visible label. `exact`, because `Overview` renders the
   *  same catalogue strings as `dt` text beside the form. */
  function control(label: string): HTMLElement {
    return screen.getByLabelText(label, { exact: true });
  }

  /**
   * The message a control POINTS AT, not merely a message somewhere on the page.
   *
   * `getByText` would be satisfied by an error rendered at the foot of the form
   * or beside a different field — the same "the operator is told something,
   * somewhere" the banner already did. The assertion is the ASSOCIATION:
   * `aria-invalid`, plus text reached through the id the control itself names.
   */
  function messageOn(label: string): string {
    const element = control(label);
    expect(element.getAttribute('aria-invalid'), `${label} is not marked invalid`).toBe('true');
    const ids =
      element.getAttribute('aria-errormessage') ?? element.getAttribute('aria-describedby') ?? '';
    const described = ids
      .split(/\s+/)
      .filter(Boolean)
      .map((one) => document.getElementById(one))
      .filter((node): node is HTMLElement => node !== null);
    const alert = described.find((node) => node.getAttribute('role') === 'alert');
    expect(alert, `${label} points at no alert`).toBeTruthy();
    return alert?.textContent ?? '';
  }

  /** Retype the named controls and save the edit panel. */
  async function edit(entries: readonly (readonly [string, string])[]): Promise<void> {
    const user = userEvent.setup();
    for (const [label, value] of entries) {
      await user.clear(control(label));
      await user.type(control(label), value);
    }
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
  }

  it('puts a colour violation on the colour control, translated', async () => {
    refuseWith({ path: 'body.color', rule: 'too_big' });
    render();
    await edit([[COLOR, 'Cerulean']]);

    // The request really happened. A 422 that was never asked for would leave
    // every assertion satisfied by a form that simply never submitted.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`http://api.test/api/v1/vehicles/${VEHICLE.id}`);
    expect(init.method).toBe('PATCH');

    await waitFor(() => expect(messageOn(COLOR)).toBe(en['form.violation.too_big']));
    // The catalogue SENTENCE, never the key — a renderer printing
    // `form.violation.too_big` at an operator is the defect one layer up.
    expect(messageOn(COLOR)).not.toContain('form.violation');
  });

  it('puts a VIN violation on the VIN control, which took no error prop at all', async () => {
    /*
     * `VinField` has accepted an `error` prop since `FE-020` and
     * `VehicleCreateScreen.tsx:231` passes one. This screen mounted the same
     * component without it, so the server's verdict on a VIN — the field most
     * likely to be refused, its uniqueness being enforced by an index the client
     * can only preview — had nowhere to land.
     */
    refuseWith({ path: 'body.vin', rule: 'invalid_format' });
    render();
    await edit([[VIN, 'JH4KA7561PC008269']]);

    await waitFor(() => expect(messageOn(VIN)).toBe(en['form.violation.invalid_format']));
  });

  it('marks every field the response names, and only those', async () => {
    refuseWith(
      { path: 'body.color', rule: 'too_big' },
      { path: 'body.displayNumber', rule: 'required' }
    );
    render();
    await edit([
      [COLOR, 'Cerulean'],
      [REFERENCE, 'V-0002'],
    ]);

    await waitFor(() => expect(messageOn(COLOR)).toBe(en['form.violation.too_big']));
    expect(messageOn(REFERENCE)).toBe(en['form.violation.required']);
    // The VIN was not named, so it must not be marked. Without this the case
    // would be satisfied by a panel that flags everything after any refusal.
    expect(control(VIN).getAttribute('aria-invalid')).toBeNull();
    // The banner is still rendered: field messages are in addition to it.
    expect(screen.getByText(en['form.formError'])).toBeTruthy();
  });

  it('translates into Arabic rather than falling back to English', async () => {
    // The whole point of carrying KEYS across the boundary instead of server
    // prose: the API answers in one language, the operator's catalogue decides
    // what is read.
    refuseWith({ path: 'body.color', rule: 'too_big' });
    render({}, 'ar');
    const user = userEvent.setup();
    const field = screen.getByLabelText(ar['vehicles.create.color'], { exact: true });
    await user.clear(field);
    await user.type(field, 'Cerulean');
    await user.click(screen.getByRole('button', { name: ar['form.submit'] }));

    await waitFor(() =>
      expect(messageOn(ar['vehicles.create.color'])).toBe(ar['form.violation.too_big'])
    );
    expect(ar['form.violation.too_big']).not.toBe(en['form.violation.too_big']);
  });

  it('leaves every control unmarked when the write succeeds', async () => {
    /*
     * The anti-vacuity control. `messageOn` asserts a MARKED control, so a panel
     * that marked all four unconditionally would satisfy every case above; this
     * is the direction that catches it.
     */
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ id: VEHICLE.id }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    render();
    await edit([[COLOR, 'Cerulean']]);

    await waitFor(() => expect(screen.getByText(en['vehicles.profile.saved'])).toBeTruthy());
    for (const label of [COLOR, VIN, REFERENCE]) {
      expect(control(label).getAttribute('aria-invalid'), `${label} was marked`).toBeNull();
    }
  });

  it('keeps a whole-request violation in the banner and marks no field', async () => {
    /*
     * `{ path: 'body' }` names no control, and `controlNameFor` returns null for
     * it so `fromFailure` promotes it to `messageKey`. Rendering it beside an
     * arbitrary field would accuse one; dropping it — what the old code did to
     * every violation of every shape — leaves the operator with a form that
     * refuses and says nothing.
     */
    refuseWith({ path: 'body', rule: 'empty_patch' });
    render();
    await edit([[COLOR, 'Cerulean']]);

    await waitFor(() => expect(screen.getByText(en['form.violation.empty_patch'])).toBeTruthy());
    for (const label of [COLOR, VIN, REFERENCE]) {
      expect(control(label).getAttribute('aria-invalid'), `${label} was marked`).toBeNull();
    }
  });

  it('puts a server transition refusal on the select that offered the move', async () => {
    /*
     * The refusal the option-set fix above exists to prevent, arriving anyway —
     * because the menu is built from a client-side MIRROR of
     * `LIFECYCLE_TRANSITIONS` and the server is the authority. When the two
     * disagree the operator must be told which control was refused, not handed
     * "The form could not be saved."
     *
     * The expected message is the generic key, and that is asserted rather than
     * papered over: `invalid_transition` is not in the catalogue, the API emits
     * more than eighty rule tokens, and a catalogue claiming to carry them all
     * would put a raw token in front of a receptionist within a week.
     */
    refuseWith({ path: 'body.lifecycleStatus', rule: 'invalid_transition' });
    render();
    const user = userEvent.setup();
    await user.selectOptions(control(LIFECYCLE), 'inactive');
    await user.click(screen.getByRole('button', { name: en['vehicles.profile.applyStatus'] }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect((fetchImpl.mock.calls[0] as [string, unknown])[0]).toBe(
      `http://api.test/api/v1/vehicles/${VEHICLE.id}/status`
    );
    await waitFor(() => expect(messageOn(LIFECYCLE)).toBe(en['form.violation.invalid']));
  });

  it('shows the status panel own refusal, which reached nobody before', async () => {
    /*
     * Not a server 422 at all: submitting with neither axis chosen returns
     * `invalid({ lifecycleStatus: 'vehicles.profile.chooseAStatus' })` from
     * `profile-api.ts`, before any request exists. With nothing on this screen
     * rendering `fieldErrors`, that sentence was constructed on every such
     * submit and displayed to nobody — the operator read "The form could not be
     * saved." and was left to guess.
     */
    render();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en['vehicles.profile.applyStatus'] }));

    await waitFor(() => expect(messageOn(LIFECYCLE)).toBe(en['vehicles.profile.chooseAStatus']));
    expect(
      fetchImpl,
      'a request was issued for a submission with no change'
    ).not.toHaveBeenCalled();
  });

  it('asserts on distinct messages, so no case can pass by coincidence', () => {
    const messages = [
      en['form.violation.too_big'],
      en['form.violation.required'],
      en['form.violation.invalid_format'],
      en['form.violation.invalid'],
      en['form.violation.empty_patch'],
      en['vehicles.profile.chooseAStatus'],
      en['form.formError'],
    ];
    for (const message of messages) {
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
    expect(new Set(messages).size).toBe(messages.length);
  });
});

/**
 * A real 409 reaching a rendered screen, and saying which 409 it was.
 *
 * ## The gap this closes
 *
 * `failureMessageKey` splits a conflict two ways — `ERR-CON-001` keeps "Someone
 * else changed this", every other 409 gets "This change cannot be saved" — and
 * that split was proved only in `api-client.test.ts`, where the assertion is on
 * the KEY the function returns. Before this block, a search for `409` across
 * `apps/web/tests/*.tsx` matched comment lines and nothing else: no test in the
 * repository drove a 409 through a screen, so the last hop — a panel receiving
 * the state and rendering the truthful SENTENCE — was asserted nowhere. A key
 * nobody renders is not a fixed message, which is the same shape as the 422
 * defect the block above exists for.
 *
 * So every assertion here is on the operator-visible sentence out of the
 * catalogue, never on `state.messageKey`.
 *
 * ## Why an ACTIVE vehicle is the fixture for the frozen refusal
 *
 * The screen mirrors the server's freeze rules, so on a vehicle it KNOWS is
 * merged it withdraws the edit panel and no request is possible. A real
 * `ERR-RES-002` therefore arrives exactly when the mirror is stale: the page was
 * rendered while the vehicle was active, someone merged or scrapped it, and the
 * save meets a server that now refuses. That is the only way this response can
 * reach this panel, and it is why the fixture reads `active`.
 *
 * ## The codes are the published ones
 *
 * `ERR-RES-002` and `ERR-CON-001` are the catalogue's own, and `client.ts:697`
 * names the second as the single code that means what `state.conflict.title`
 * says. Nothing here invents a code, and nothing here invents a per-code
 * sentence: `mapWriteConflict` maps every unique-index violation onto one code
 * without reading the constraint name, so the interface cannot know whether a
 * VIN or a reference number collided and must not claim to.
 */
describe('a real 409 reaches the screen as the sentence that fits its cause', () => {
  const COLOR = en['vehicles.create.color'];
  const VIN = en['vehicles.create.vin'];
  const REFERENCE = en['vehicles.column.reference'];

  const BLOCKED = en['state.conflict.blocked.title'];
  const RACE = en['state.conflict.title'];

  /**
   * The problem document the API really sends for a refused write.
   *
   * A full backend-shaped `application/problem+json`: `type`, `title`, `status`,
   * `code`, `correlationId`. `readPayload` parses on the `json` substring in the
   * content type, so a fixture served as `text/plain` would arrive as a null
   * problem, `failure.problem?.code` would be undefined for every case, and the
   * cases that expect the blocked sentence would pass while measuring nothing.
   */
  function conflictWith(code: string | null, title: string): void {
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: `https://errors.example.test/${code ?? 'unknown'}`,
          title,
          status: 409,
          ...(code === null ? {} : { code }),
          correlationId: 'corr-409-fixture',
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } }
      )
    );
  }

  beforeEach(() => {
    updateVehicleAction.mockImplementation(actualProfileApi.updateVehicleAction);
    changeVehicleStatusAction.mockImplementation(actualProfileApi.changeVehicleStatusAction);
  });

  /**
   * Retype the colour and save the edit panel.
   *
   * One changed field is required: `updateVehicleAction` returns `idle` without
   * issuing a request when nothing changed, and every case below would then be
   * asserting against a form that never submitted.
   */
  async function save(locale: 'en' | 'ar' = 'en'): Promise<void> {
    // `delay: null` removes userEvent's inter-keystroke delay. It changes no
    // behaviour under test — every event still fires in order — and it keeps this
    // block from pushing the whole web suite past the 5 s per-test default, which
    // it was measured doing to two unrelated files.
    const user = userEvent.setup({ delay: null });
    const messages = locale === 'en' ? en : ar;
    const field = screen.getByLabelText(messages['vehicles.create.color'], { exact: true });
    await user.clear(field);
    await user.type(field, 'Cerulean');
    await user.click(screen.getByRole('button', { name: messages['form.submit'] }));
  }

  /** The edit panel's own alert, which is where `Outcome` puts a failed write. */
  function alertText(): string {
    const alerts = screen.queryAllByRole('alert');
    return alerts.map((node) => node.textContent ?? '').join(' ');
  }

  it('says the record cannot take the change when a unique index rejected it', async () => {
    /*
     * `ERR-RES-002` from `mapWriteConflict` — a `23505` on one of the two
     * tenant-scoped unique indexes. The operator must not be told someone else
     * edited the record: they would reload, find nothing changed, retry, and
     * fail again for the reason nobody gave.
     */
    conflictWith('ERR-RES-002', 'Resource conflict');
    render();
    await save();

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`http://api.test/api/v1/vehicles/${VEHICLE.id}`);
    expect(init.method).toBe('PATCH');

    await waitFor(() => expect(alertText()).toContain(BLOCKED));
    expect(alertText()).not.toContain(RACE);
  });

  it('says the same for a vehicle the server has since frozen', async () => {
    /*
     * The other producer of `ERR-RES-002`: the lifecycle service refusing a
     * write against a merged or read-only vehicle. Two different causes, one
     * code, one honest sentence — the interface does not guess which of the two
     * it was, because the response does not say.
     */
    conflictWith('ERR-RES-002', 'Vehicle is not editable');
    render();
    await save();

    await waitFor(() => expect(alertText()).toContain(BLOCKED));
    expect(alertText()).not.toContain(RACE);
  });

  it('says someone else changed it ONLY for the code that means that', async () => {
    /*
     * `ERR-CON-001`, "Record version conflict" — the genuine in-flight race the
     * `If-Match` guard raises. This is the one 409 for which "Someone else
     * changed this" is true, and the pairing with the two cases above is the
     * whole point: collapse the split and either this case or those two must
     * fail.
     */
    conflictWith('ERR-CON-001', 'Record version conflict');
    render();
    await save();

    await waitFor(() => expect(alertText()).toContain(RACE));
    expect(alertText()).not.toContain(BLOCKED);
  });

  it('falls back to the honest sentence for a 409 carrying no code at all', async () => {
    /*
     * A proxy that stripped the body, an older service, a gateway-authored
     * error: `problem.code` is undefined. The fallback must be the sentence that
     * claims LESS. Defaulting the other way would assert a concurrent edit that
     * nothing in the response supports.
     */
    conflictWith(null, 'Conflict');
    render();
    await save();

    await waitFor(() => expect(alertText()).toContain(BLOCKED));
    expect(alertText()).not.toContain(RACE);
  });

  it('renders the blocked sentence in Arabic, not an English fallback', async () => {
    conflictWith('ERR-RES-002', 'Resource conflict');
    render({}, 'ar');
    await save('ar');

    await waitFor(() => expect(alertText()).toContain(ar['state.conflict.blocked.title']));
    expect(alertText()).not.toContain(en['state.conflict.blocked.title']);
    // The two catalogues must not be carrying the same string, or the assertion
    // above would hold for a screen that never translated anything.
    expect(ar['state.conflict.blocked.title']).not.toBe(en['state.conflict.blocked.title']);
  });

  it('renders the race sentence in Arabic too', async () => {
    conflictWith('ERR-CON-001', 'Record version conflict');
    render({}, 'ar');
    await save('ar');

    await waitFor(() => expect(alertText()).toContain(ar['state.conflict.title']));
    expect(alertText()).not.toContain(ar['state.conflict.blocked.title']);
  });

  it('marks no control, because a 409 names no field', async () => {
    /*
     * The 422 path marks controls; this one must not. A conflict carries no
     * `violations`, so a panel that flagged a field after any failed write would
     * be accusing a value the server never mentioned.
     */
    conflictWith('ERR-RES-002', 'Resource conflict');
    render();
    await save();

    await waitFor(() => expect(alertText()).toContain(BLOCKED));
    for (const label of [COLOR, VIN, REFERENCE]) {
      expect(
        screen.getByLabelText(label, { exact: true }).getAttribute('aria-invalid'),
        `${label} was marked by a response that names no field`
      ).toBeNull();
    }
  });

  it('puts none of the problem document on the screen', async () => {
    /*
     * `title` is English developer prose in an Arabic-first product, `type` is a
     * URL, and `code` is a token. None of them may be rendered.
     *
     * ## The correlation ID shown is the CLIENT's, not the body's
     *
     * This case was first written asserting the screen shows the `correlationId`
     * carried in the problem document, and it failed: what is rendered is the
     * UUID `ApiClient` minted for the request and sent as `x-correlation-id`
     * (`client.ts:401,424`), falling back to that same value when the response
     * echoes no header (`client.ts:441`). The body field is never read.
     *
     * That is the correct behaviour and worth pinning rather than papering over.
     * The id that finds the server-side log is the one the client actually sent;
     * a body-supplied string is response-controlled data, and rendering it would
     * put an attacker-chosen value on the screen under the label "Reference".
     * So the assertion is now two-sided: the sent header is shown, and the body
     * value is NOT — which is also the strictest form of "no raw payload".
     */
    conflictWith('ERR-RES-002', 'Resource conflict');
    const { container } = render();
    await save();

    await waitFor(() => expect(alertText()).toContain(BLOCKED));

    const [, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    const sent = init.headers['x-correlation-id'];
    expect(typeof sent, 'the client sent no correlation header').toBe('string');

    const text = container.textContent ?? '';
    // Asserted PRESENT so this case cannot pass by the screen having rendered no
    // failure at all.
    expect(text).toContain(sent);
    for (const leak of [
      'corr-409-fixture',
      'ERR-RES-002',
      'Resource conflict',
      'https://errors.example.test',
      '{',
    ]) {
      expect(text, `the response leaked ${leak}`).not.toContain(leak);
    }
    // And never the key itself, which is the defect one layer up from this one.
    expect(text).not.toContain('state.conflict');
  });

  it('leaves the panel unmarked when the same write succeeds', async () => {
    // The anti-vacuity control: every case above asserts a sentence is PRESENT,
    // so a panel that rendered both sentences always would satisfy half of them.
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ id: VEHICLE.id }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { container } = render();
    await save();

    await waitFor(() => expect(screen.getByText(en['vehicles.profile.saved'])).toBeTruthy());
    const text = container.textContent ?? '';
    expect(text).not.toContain(BLOCKED);
    expect(text).not.toContain(RACE);
  });

  it('asserts on two sentences that are actually different', () => {
    // If `state.conflict.title` and `state.conflict.blocked.title` ever became
    // the same string, every `not.toContain` pairing above would still pass and
    // the split would be dead. This is the guard against that.
    const sentences = [
      BLOCKED,
      RACE,
      ar['state.conflict.blocked.title'],
      ar['state.conflict.title'],
    ];
    for (const message of sentences) {
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});
