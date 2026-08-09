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

vi.mock('@/features/vehicles/profile-api', () => ({
  updateVehicleAction: vi.fn(async () => ({ status: 'idle' })),
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
// `refresh` captured, not anonymous — `F4` is about whether the screen re-reads
// the vehicle after a successful status change, and an anonymous mock cannot say.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const { VehicleProfileScreen } =
  await import('@/features/vehicles/components/VehicleProfileScreen');

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
  refresh.mockReset();
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
   * publishes field detail as `violations`, the client reads `errors`
   * (`P1-27-INT-028`), so `Outcome` showed only "The form could not be saved."
   * The operator picked something that looked legitimate and was told nothing.
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
