import { describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  INITIAL_ORIGIN,
  activeStep,
  buildCreateInput,
  openVisitAmong,
  stepRegistryProblems,
  switchOriginKind,
  writesLocked,
  type CreateDraft,
} from '@/features/receptions/check-in/wizard';
import { CHECK_IN_STEPS } from '@/features/receptions/check-in/steps';
import {
  RECEPTION_STATUSES,
  TERMINAL_RECEPTION_STATUSES,
  type ReceptionListEntry,
} from '@/features/receptions/receptions-contract';

/**
 * The check-in wizard's state machine (`P1-28-FE-007`), held without a DOM.
 *
 * Everything here is a rule the SERVER also enforces — the XOR is
 * `ck_reception_visits_one_origin`, the appointment-origin coherence is the
 * 422 `incoherent_reference`, the open-visit uniqueness is
 * `uq_reception_visits_open_vehicle` — restated as mirrors so the screen
 * refuses locally, beside the control, what the backend would refuse opaquely.
 */

// The registry import pulls the step COMPONENTS, whose adapter modules reach
// `next/headers` at import time. Nothing here ever performs a request; the
// mock only makes the module graph loadable in the logic tier.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const APPOINTMENT = {
  id: 'apt-1',
  vehicleId: 'veh-9',
  requesterPartnerId: 'partner-1',
} as const;

function draft(over: Partial<CreateDraft> = {}): CreateDraft {
  return {
    companyId: 'company-1',
    branchId: 'branch-1',
    origin: { kind: 'walk_in', note: '' },
    appointment: null,
    walkInVehicleId: 'veh-2',
    walkInRequesterId: 'partner-2',
    receivingEmployeeId: 'user-1',
    fuelLevelId: '',
    evSocPercent: '',
    ...over,
  };
}

function listRow(over: Partial<ReceptionListEntry> = {}): ReceptionListEntry {
  return {
    id: 'rv-1',
    displayNumber: 'R-0001',
    receptionStatus: 'opened',
    origin: 'walk_in',
    vehicleId: 'veh-9',
    vehicleDisplayNumber: 'V-9',
    custodyAcceptedAt: '2026-08-13T08:00:00.000Z',
    custodyReleasedAt: null,
    recordVersion: 1,
    ...over,
  };
}

describe('origin — appointment XOR walk-in', () => {
  it('starts as a walk-in with an empty note', () => {
    expect(INITIAL_ORIGIN).toEqual({ kind: 'walk_in', note: '' });
  });

  it('switching kind DISCARDS the other side, in both directions', () => {
    // Keeping the note across a switch would silently resurrect a stale value
    // when the operator switches back — the XOR circumvented in state.
    const walkIn = { kind: 'walk_in', note: 'left the lights on' } as const;
    const toAppointment = switchOriginKind(walkIn, 'appointment');
    expect(toAppointment).toEqual({ kind: 'appointment', appointmentId: null });

    const chosen = { kind: 'appointment', appointmentId: 'apt-1' } as const;
    const backToWalkIn = switchOriginKind(chosen, 'walk_in');
    expect(backToWalkIn).toEqual({ kind: 'walk_in', note: '' });
  });

  it('switching to the SAME kind changes nothing', () => {
    const current = { kind: 'walk_in', note: 'kept' } as const;
    expect(switchOriginKind(current, 'walk_in')).toBe(current);
  });

  it('the draft type cannot carry both origins at once', () => {
    // Structural, not procedural: a walk-in draft has no appointmentId field
    // and an appointment draft has no note field, so a submission carrying
    // both is unrepresentable — mirroring `ck_reception_visits_one_origin`.
    const walkIn = switchOriginKind({ kind: 'appointment', appointmentId: 'x' }, 'walk_in');
    expect('appointmentId' in walkIn).toBe(false);
    const appointment = switchOriginKind(walkIn, 'appointment');
    expect('note' in appointment).toBe(false);
  });
});

describe('buildCreateInput — the create command derived, never assembled ad hoc', () => {
  it('refuses a missing branch target, employee, requester and vehicle, each by name', () => {
    expect(buildCreateInput(draft({ companyId: '' }))).toEqual({
      ok: false,
      messageKey: 'receptions.checkIn.error.targetRequired',
    });
    expect(buildCreateInput(draft({ branchId: '' }))).toEqual({
      ok: false,
      messageKey: 'receptions.checkIn.error.targetRequired',
    });
    expect(buildCreateInput(draft({ receivingEmployeeId: '' }))).toEqual({
      ok: false,
      messageKey: 'receptions.checkIn.error.employeeRequired',
    });
    expect(buildCreateInput(draft({ walkInRequesterId: null }))).toEqual({
      ok: false,
      messageKey: 'receptions.checkIn.error.requesterRequired',
    });
    expect(buildCreateInput(draft({ walkInVehicleId: null }))).toEqual({
      ok: false,
      messageKey: 'receptions.checkIn.error.vehicleRequired',
    });
  });

  it('walk-in: sends the chosen vehicle and requester, and omits an empty note', () => {
    const result = buildCreateInput(draft({ origin: { kind: 'walk_in', note: '   ' } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.vehicleId).toBe('veh-2');
    expect(result.input.serviceRequesterPartnerId).toBe('partner-2');
    expect(result.input.origin).toEqual({ kind: 'walk_in', requesterPartnerId: 'partner-2' });
  });

  it('walk-in: a real note travels, trimmed', () => {
    const result = buildCreateInput(draft({ origin: { kind: 'walk_in', note: '  no key  ' } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.origin).toEqual({
      kind: 'walk_in',
      requesterPartnerId: 'partner-2',
      note: 'no key',
    });
  });

  it('appointment origin: vehicle and requester come from the APPOINTMENT, never the walk-in picks', () => {
    // The mirror of 422 `incoherent_reference`: an appointment origin's
    // vehicle MUST be the appointment's own. The stale walk-in selections are
    // still in the draft, and must not leak into the command.
    const result = buildCreateInput(
      draft({
        origin: { kind: 'appointment', appointmentId: APPOINTMENT.id },
        appointment: APPOINTMENT,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.vehicleId).toBe('veh-9');
    expect(result.input.serviceRequesterPartnerId).toBe('partner-1');
    expect(result.input.origin).toEqual({ kind: 'appointment', appointmentId: 'apt-1' });
  });

  it('appointment origin: refused until an appointment is actually chosen', () => {
    expect(
      buildCreateInput(
        draft({ origin: { kind: 'appointment', appointmentId: null }, appointment: null })
      )
    ).toEqual({ ok: false, messageKey: 'receptions.checkIn.error.appointmentRequired' });

    // A chosen appointment that no longer matches the origin draft is refused
    // too — a stale selection submitted as if current is the silent wrong
    // write this phase keeps finding.
    expect(
      buildCreateInput(
        draft({
          origin: { kind: 'appointment', appointmentId: 'apt-OTHER' },
          appointment: APPOINTMENT,
        })
      )
    ).toEqual({ ok: false, messageKey: 'receptions.checkIn.error.appointmentRequired' });
  });

  it('optional intake facts: absent stays absent, present travels typed', () => {
    const bare = buildCreateInput(draft());
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect('fuelLevelId' in bare.input).toBe(false);
    expect('evSocPercent' in bare.input).toBe(false);

    const full = buildCreateInput(draft({ fuelLevelId: 'fuel-1', evSocPercent: '55.5' }));
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.input.fuelLevelId).toBe('fuel-1');
    // `numeric(5,2)` is a NUMBER in the request — a fractional charge level
    // is meaningful and must not be truncated by the screen.
    expect(full.input.evSocPercent).toBe(55.5);
  });

  it('refuses a non-numeric charge level by name', () => {
    expect(buildCreateInput(draft({ evSocPercent: 'half' }))).toEqual({
      ok: false,
      messageKey: 'receptions.checkIn.error.socInvalid',
    });
  });
});

describe('openVisitAmong — the resume rule', () => {
  it('finds the open visit: non-terminal status AND unreleased custody', () => {
    const open = listRow();
    expect(openVisitAmong([open])).toBe(open);
  });

  it('ignores terminal rows even when custody looks unreleased', () => {
    for (const status of TERMINAL_RECEPTION_STATUSES) {
      expect(openVisitAmong([listRow({ receptionStatus: status })])).toBeNull();
    }
  });

  it('ignores a released row even when the status looks open', () => {
    // Both halves are judged because `uq_reception_visits_open_vehicle` is
    // keyed on custody: a row satisfying only one is a contradiction to
    // refuse, not a visit to walk into.
    expect(openVisitAmong([listRow({ custodyReleasedAt: '2026-08-13T09:00:00.000Z' })])).toBeNull();
  });

  it('returns null over an empty page and skips past closed history', () => {
    expect(openVisitAmong([])).toBeNull();
    const open = listRow({ id: 'rv-2' });
    expect(openVisitAmong([listRow({ id: 'rv-1', receptionStatus: 'refused' }), open])).toBe(open);
  });
});

describe('writesLocked — step gating over the frozen graph', () => {
  it('locks exactly the terminal statuses', () => {
    for (const status of RECEPTION_STATUSES) {
      expect(writesLocked(status), status).toBe(TERMINAL_RECEPTION_STATUSES.includes(status));
    }
  });
});

describe('activeStep', () => {
  it('defaults to the first step and honours an explicit choice', () => {
    expect(activeStep(CHECK_IN_STEPS, null)?.id).toBe('confirm-identities');
    expect(activeStep(CHECK_IN_STEPS, 'parties-and-authorization')?.id).toBe(
      'parties-and-authorization'
    );
  });

  it('falls back to the first step for an unknown id, and to null for no steps', () => {
    expect(activeStep(CHECK_IN_STEPS, 'not-a-step')?.id).toBe('confirm-identities');
    expect(activeStep([], null)).toBeNull();
  });
});

describe('the step registry — the typed extension point Waves E build on', () => {
  it('registers the Wave D, E, F/G and H steps, in presentation order', () => {
    /*
     * The order follows the ramp an operator actually walks: identity, then the
     * parties, then the condition of the vehicle — what the customer said, what
     * staff saw, where the damage is, what the meters read, what the dashboard
     * showed, what is inside, and where photographs would go — and only then
     * what anybody signed or declined.
     *
     * `media-and-photographs` (`FE-017`) sits at its own place in that walk and
     * captures nothing: `P1-OD-025` is open, so what it renders is the
     * named-open-decision notice, held by `p1-28-reception-media.test.ts`.
     *
     * The closing pair comes last, and in this order for a reason the graph
     * decides rather than a preference: conversion is legal only from
     * `authorized`, which the summary's approval is what reaches.
     */
    expect(CHECK_IN_STEPS.map((step) => step.id)).toEqual([
      'confirm-identities',
      'parties-and-authorization',
      'condition-complaints',
      'condition-inspection',
      'condition-damage',
      'condition-readings',
      'condition-warning-lights',
      'condition-contents',
      'media-and-photographs',
      'reception-signature',
      'reception-refusal',
      'summary-and-approval',
      'convert-to-work-order',
    ]);
  });

  it('added Waves E, F/G and H by APPENDING, leaving the Wave D prefix untouched', () => {
    // The promise the registry docblock makes to any later wave: a new step
    // lands as one entry here and nothing before it moves.
    expect(CHECK_IN_STEPS.slice(0, 2).map((step) => step.id)).toEqual([
      'confirm-identities',
      'parties-and-authorization',
    ]);
  });

  it('holds every entry to the contract', () => {
    expect(stepRegistryProblems(CHECK_IN_STEPS)).toEqual([]);
    for (const step of CHECK_IN_STEPS) {
      expect(typeof step.Component, step.id).toBe('function');
    }
  });

  it('has both translation keys of every step in BOTH catalogues', () => {
    // A step cannot land untranslated: this is the assertion the registry
    // docblock promises to any wave that appends an entry.
    for (const step of CHECK_IN_STEPS) {
      for (const key of [step.titleKey, step.descriptionKey]) {
        expect(EN[key], `${key} missing from en`).toBeTruthy();
        expect(AR[key], `${key} missing from ar`).toBeTruthy();
      }
    }
  });

  it('rejects a malformed registration, so the guard is not vacuous', () => {
    const bad = [
      { ...CHECK_IN_STEPS[0]! },
      { ...CHECK_IN_STEPS[0]! },
      { ...CHECK_IN_STEPS[1]!, titleKey: 'vehicles.profile.title' },
    ];
    const problems = stepRegistryProblems(bad);
    expect(problems.some((problem) => problem.includes('duplicate step id'))).toBe(true);
    expect(problems.some((problem) => problem.includes('outside the feature namespace'))).toBe(
      true
    );
  });
});
