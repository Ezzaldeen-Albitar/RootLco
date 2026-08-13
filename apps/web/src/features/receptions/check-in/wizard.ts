import type { ComponentType } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import {
  TERMINAL_RECEPTION_STATUSES,
  type ReceptionCreateInput,
  type ReceptionDetail,
  type ReceptionListEntry,
  type ReceptionOriginInput,
  type ReceptionStatus,
} from '../receptions-contract';

/**
 * The check-in wizard's typed step interface and state machine (P1-28, Wave D;
 * `FE-007`).
 *
 * Pure module: no fetch, no React state, no side effects — every rule here is
 * testable without a DOM, and `tests/reception-checkin-wizard.test.ts` holds
 * each one.
 *
 * ## The step interface IS the extension point
 *
 * The wizard shell (`components/CheckInWizardShell.tsx`) renders whatever step
 * list it is handed and knows nothing about any step's content. A wave that
 * adds an evidence-capture step (Waves E — condition evidence, signatures,
 * refusals) registers it in `check-in/steps.tsx` and touches NOTHING else:
 *
 *   - `id` — stable, unique, never displayed; used for step navigation state
 *     and tests.
 *   - `titleKey` / `descriptionKey` — translation keys, present in BOTH
 *     catalogues (the registry test asserts membership, so a step cannot land
 *     untranslated).
 *   - `Component` — a client component taking exactly `CheckInStepProps`.
 *
 * ## What every step receives, and why
 *
 * `visitId` and `recordVersion` come from the ONE detail read the shell owns.
 * `recordVersion` is the `If-Match` the four guarded commands demand
 * (`approve`, `convert-to-work-order`, `close-without-work`, `refuse`), and
 * QA-004 forbids sourcing it from anything but a READ or the immediately prior
 * command response — so a step never caches its own copy: it presents what the
 * shell holds, and after any write (and after any 409/412) it calls
 * `refresh()`, which re-reads `rec.reception-detail` and re-renders every step
 * with the current version. A conflict is therefore cured by re-reading where
 * re-reading can cure it, and rendered honestly where it cannot
 * (409 `ERR-TRN-001` — the state itself refuses the command).
 */

/** What the route resolved from the session — visibility only, never access. */
export interface CheckInCapabilities {
  /** `rec.reception.party.manage` — the party-role write. */
  readonly manageParties: boolean;
  /** `rec.reception.authorization.verify` — the authorization write. */
  readonly verifyAuthorizations: boolean;
  /** `crm.customer.read` — the confirmation step's customer panel and every partner search. */
  readonly readCustomers: boolean;
  /** `veh.vehicle.read` — the confirmation step's vehicle panels, and the odometer history. */
  readonly readVehicles: boolean;
  /**
   * `rec.reception.evidence.manage` — all eight condition-evidence kinds
   * (`FE-010`…`FE-016`). One permission for the whole discriminated union.
   */
  readonly manageEvidence: boolean;
  /**
   * `rec.reception.signature.manage` — signatures AND refusal evidence
   * (`FE-018`, `FE-019`). The two share a permission because both record what a
   * person put their name to.
   */
  readonly manageSignatures: boolean;
  /**
   * `veh.vehicle.odometer.record` — the arrival reading (`FE-013`).
   *
   * A VEHICLE-domain capability, deliberately its own code: a technician who
   * reads a dashboard at check-in records mileage without being able to edit the
   * vehicle. Held by neither `veh.vehicle.manage` nor `rec.reception.manage`.
   */
  readonly recordOdometer: boolean;
}

/**
 * Who is signed in, for the fields whose referent the platform never defined.
 *
 * `rec.visual_inspections.inspector_id` and
 * `rec.vehicle_contents.witnessed_by_employee_id` are NOT NULL / nullable uuids
 * with **no foreign key**, exactly like `receiving_employee_id` before them
 * (the named open decision G-EMP). No employee master exists, so the only
 * identity this platform can resolve to a name is the signed-in user — which is
 * offered as a stand-in, with the disposition stated beside the control, and
 * never as a uuid the operator is asked to type.
 */
export interface CheckInSessionIdentity {
  readonly userId: string;
  readonly displayName: string;
}

/** The component contract every wizard step takes. See the module docblock. */
export interface CheckInStepProps {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  /** The `If-Match` value the guarded commands demand — from the shell's read. */
  readonly recordVersion: number;
  readonly detail: ReceptionDetail;
  readonly capabilities: CheckInCapabilities;
  /** The signed-in operator, for the referent-less identity fields (G-EMP). */
  readonly session: CheckInSessionIdentity;
  /** True when the visit is terminal: render facts, withdraw write controls. */
  readonly writesLocked: boolean;
  /** Re-reads `rec.reception-detail` and re-renders every step with it. */
  readonly refresh: () => Promise<void>;
}

/** One registered step. Waves E append to `steps.tsx`, never to the shell. */
export interface CheckInStepDefinition {
  readonly id: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly Component: ComponentType<CheckInStepProps>;
}

/* ------------------------------------------------------------------ *
 * Origin — appointment XOR walk-in
 * ------------------------------------------------------------------ */

/**
 * The origin draft, as a discriminated union so the XOR is STRUCTURAL:
 * `ck_reception_visits_one_origin` refuses a visit with both origins, and a
 * draft that cannot hold both cannot submit both. Switching kind DISCARDS the
 * other side's data — keeping it would silently resurrect a stale choice.
 */
export type OriginDraft =
  | { readonly kind: 'walk_in'; readonly note: string }
  | { readonly kind: 'appointment'; readonly appointmentId: string | null };

export const INITIAL_ORIGIN: OriginDraft = { kind: 'walk_in', note: '' };

export function switchOriginKind(
  current: OriginDraft,
  kind: 'walk_in' | 'appointment'
): OriginDraft {
  if (current.kind === kind) return current;
  return kind === 'walk_in'
    ? { kind: 'walk_in', note: '' }
    : { kind: 'appointment', appointmentId: null };
}

/* ------------------------------------------------------------------ *
 * The create input, derived — never assembled ad hoc in a component
 * ------------------------------------------------------------------ */

/** The chosen appointment's identity, exactly what the create input needs. */
export interface ChosenAppointment {
  readonly id: string;
  readonly vehicleId: string;
  readonly requesterPartnerId: string;
}

export interface CreateDraft {
  /** The branch the visit is FOR — the authorization target (`P1-18-A-01`). */
  readonly companyId: string;
  readonly branchId: string;
  readonly origin: OriginDraft;
  /** Set when `origin.kind === 'appointment'` and one was chosen. */
  readonly appointment: ChosenAppointment | null;
  /** The walk-in vehicle, chosen from the requester's own vehicle list. */
  readonly walkInVehicleId: string | null;
  /** The service requester — for a walk-in, whoever walked in. */
  readonly walkInRequesterId: string | null;
  readonly receivingEmployeeId: string;
  /** `''` = not chosen. The field is nullable; an empty catalogue degrades the form, not the operation. */
  readonly fuelLevelId: string;
  /** Raw input; `''` = not recorded. Parsed here so the rule is testable. */
  readonly evSocPercent: string;
}

export type CreateDraftResult =
  | { readonly ok: true; readonly input: ReceptionCreateInput }
  | { readonly ok: false; readonly messageKey: string };

/**
 * Builds the `rec.reception-create` input from the draft, or names the first
 * thing missing as a translation key the screen renders beside the form.
 *
 * For an appointment origin the vehicle and the service requester are the
 * APPOINTMENT'S OWN — offering a different vehicle would be offering the 422
 * `incoherent_reference` the backend refuses it with, and the branch target the
 * appointment was listed under is the scope the create is authorized against.
 */
export function buildCreateInput(draft: CreateDraft): CreateDraftResult {
  if (draft.companyId === '' || draft.branchId === '') {
    return { ok: false, messageKey: 'receptions.checkIn.error.targetRequired' };
  }
  if (draft.receivingEmployeeId === '') {
    return { ok: false, messageKey: 'receptions.checkIn.error.employeeRequired' };
  }

  let origin: ReceptionOriginInput;
  let vehicleId: string;
  let serviceRequesterPartnerId: string;

  if (draft.origin.kind === 'appointment') {
    if (draft.appointment === null || draft.origin.appointmentId !== draft.appointment.id) {
      return { ok: false, messageKey: 'receptions.checkIn.error.appointmentRequired' };
    }
    origin = { kind: 'appointment', appointmentId: draft.appointment.id };
    vehicleId = draft.appointment.vehicleId;
    serviceRequesterPartnerId = draft.appointment.requesterPartnerId;
  } else {
    if (draft.walkInRequesterId === null) {
      return { ok: false, messageKey: 'receptions.checkIn.error.requesterRequired' };
    }
    if (draft.walkInVehicleId === null) {
      return { ok: false, messageKey: 'receptions.checkIn.error.vehicleRequired' };
    }
    const note = draft.origin.note.trim();
    origin = {
      kind: 'walk_in',
      requesterPartnerId: draft.walkInRequesterId,
      ...(note.length > 0 ? { note } : {}),
    };
    vehicleId = draft.walkInVehicleId;
    serviceRequesterPartnerId = draft.walkInRequesterId;
  }

  let evSocPercent: number | null = null;
  if (draft.evSocPercent.trim() !== '') {
    const parsed = Number(draft.evSocPercent);
    if (!Number.isFinite(parsed)) {
      return { ok: false, messageKey: 'receptions.checkIn.error.socInvalid' };
    }
    evSocPercent = parsed;
  }

  return {
    ok: true,
    input: {
      companyId: draft.companyId,
      branchId: draft.branchId,
      vehicleId,
      receivingEmployeeId: draft.receivingEmployeeId,
      serviceRequesterPartnerId,
      origin,
      ...(draft.fuelLevelId !== '' ? { fuelLevelId: draft.fuelLevelId } : {}),
      ...(evSocPercent !== null ? { evSocPercent } : {}),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Resume — an open visit for the vehicle is resumable
 * ------------------------------------------------------------------ */

/**
 * The resumable visit among a vehicle-filtered `rec.reception-list` page, or
 * `null`. "Open" is judged BOTH ways the platform states it — a non-terminal
 * status and an unreleased custody — because `uq_reception_visits_open_vehicle`
 * is keyed on custody, and a row that satisfied only one of the two would be a
 * contradiction worth refusing to resume rather than a visit to walk into.
 */
export function openVisitAmong(rows: readonly ReceptionListEntry[]): ReceptionListEntry | null {
  return (
    rows.find(
      (row) =>
        !TERMINAL_RECEPTION_STATUSES.includes(row.receptionStatus) && row.custodyReleasedAt === null
    ) ?? null
  );
}

/* ------------------------------------------------------------------ *
 * Step gating
 * ------------------------------------------------------------------ */

/**
 * True when the visit can no longer be written to: `converted`,
 * `closed_without_work` and `refused` are the frozen graph's terminal states.
 * The steps still RENDER — the record is a fact worth reading — but every write
 * control is withdrawn, with the reason stated rather than a control greyed out
 * unexplained.
 */
export function writesLocked(status: ReceptionStatus): boolean {
  return TERMINAL_RECEPTION_STATUSES.includes(status);
}

/** The step to show for a visit, honouring an explicit choice when present. */
export function activeStep(
  steps: readonly CheckInStepDefinition[],
  chosenId: string | null
): CheckInStepDefinition | null {
  if (steps.length === 0) return null;
  return steps.find((step) => step.id === chosenId) ?? steps[0] ?? null;
}

/** Guards the registry itself — asserted by the wizard test, not trusted. */
export function stepRegistryProblems(steps: readonly CheckInStepDefinition[]): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) problems.push(`duplicate step id: ${step.id}`);
    seen.add(step.id);
    if (!step.titleKey.startsWith('receptions.')) {
      problems.push(`step ${step.id} title key outside the feature namespace: ${step.titleKey}`);
    }
    if (!step.descriptionKey.startsWith('receptions.')) {
      problems.push(
        `step ${step.id} description key outside the feature namespace: ${step.descriptionKey}`
      );
    }
  }
  return problems;
}

/** Re-exported so a screen can label a detail without importing two modules. */
export type { ReceptionDetail };
