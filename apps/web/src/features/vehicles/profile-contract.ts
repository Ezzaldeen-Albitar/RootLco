/**
 * Vehicle profile (`FE-019`) and VIN validation (`FE-020`).
 *
 * | operation                    | method | path                       | permission                  |
 * | ---------------------------- | ------ | -------------------------- | --------------------------- |
 * | `veh.vehicle-read`           | GET    | `/vehicles/{id}`           | `veh.vehicle.read`          |
 * | `veh.vehicle-update`         | PATCH  | `/vehicles/{id}`           | `veh.vehicle.manage`        |
 * | `veh.vehicle-status-change`  | PATCH  | `/vehicles/{id}/status`    | `veh.vehicle.status.manage` |
 *
 * Both writes are **`idempotent: true`** and `auditClass: privileged`, and they
 * are gated on **two different permissions** — editing a vehicle's description
 * and changing its lifecycle are separate authorities.
 *
 * ## `recordVersion` is published, an ETag is emitted, and NO vehicle write
 * consumes either
 *
 * The detail read returns `recordVersion` and the handler emits it as an
 * `ETag`. Neither PATCH is registered `versionGuarded: true` — verified against
 * every route module under `apps/api/src/app/api/v1/vehicles`, which contains
 * the string zero times, while work orders, appointments, assignments,
 * deliveries and invoices all use it.
 *
 * So `handleOperation` never requires `If-Match`, never compares it, and a PATCH
 * sent without one succeeds. `VehicleWriteService.update` re-reads the current
 * `record_version` inside its own transaction and uses that in the `WHERE`, so a
 * torn write is impossible — but a client cannot learn that somebody else
 * changed the record between its read and its write. From an operator's
 * position that is **last-writer-wins**.
 *
 * This screen therefore does **not** send `If-Match`. Sending a well-formed one
 * would be ignored, and sending a malformed one is a 428 from `parseIfMatch`
 * even though the operation is unguarded — a header that can only hurt.
 *
 * Recorded as `P1-27-INT-009`, owned by P1-17. It corrects a claim in this
 * phase's own PR #193 docblock, which called `recordVersion` "the half of
 * optimistic concurrency that was missing" and implied the PATCH would use it.
 *
 * ## A merged vehicle is returned, not hidden
 *
 * Deliberately unlike the CRM customer read, which 404s a merged customer. The
 * update route treats a merged vehicle as **existing but frozen** — 409, not
 * 404 — so a read that answered 404 would report a vehicle live work orders
 * still reference as missing. Every screen must handle `mergedIntoId`.
 */

import type { PowertrainCategory, VehicleLifecycleStatus, WorkshopStatus } from './contract';

/**
 * One vehicle, with its five catalogue labels resolved.
 *
 * **A null `*Name` beside a non-null `*Id` is ambiguous and the contract offers
 * no flag to disambiguate it.** The catalogue reads are RLS-filtered, so a
 * catalogue row belonging to another tenant resolves to `null` exactly as an
 * unset reference does. The screen says "not available" when the id is present
 * and the name is not, and "not recorded" when the id itself is null — which is
 * the most it can honestly distinguish.
 */
export interface VehicleDetail {
  readonly id: string;
  readonly displayNumber: string | null;
  /** `vin_normalized`, never `vin_raw`. Nullable — a VIN is optional. */
  readonly vin: string | null;
  readonly makeId: string | null;
  readonly makeName: string | null;
  readonly modelId: string | null;
  readonly modelName: string | null;
  readonly trimId: string | null;
  readonly trimName: string | null;
  readonly bodyTypeId: string | null;
  readonly bodyTypeName: string | null;
  readonly powertrainTypeId: string | null;
  readonly powertrainTypeName: string | null;
  readonly modelYear: number | null;
  readonly powertrainCategory: PowertrainCategory;
  readonly color: string | null;
  readonly lifecycleStatus: VehicleLifecycleStatus;
  readonly workshopStatus: WorkshopStatus;
  /** Set when this vehicle was merged away. Every write then answers 409. */
  readonly mergedIntoId: string | null;
  /** Published, and — see the module docblock — consumed by nothing. */
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/**
 * A frozen vehicle refuses EVERY write with `409 ERR-RES-002`.
 *
 * `merged` only, and that is not an oversight — see `isTerminal` below. The two
 * predicates exist because the server does not have one rule, it has two, and a
 * screen that collapses them either offers an action that can only fail or hides
 * one that would have worked.
 */
export function isFrozen(vehicle: VehicleDetail): boolean {
  return vehicle.mergedIntoId !== null || vehicle.lifecycleStatus === 'merged';
}

/**
 * A terminal vehicle refuses every write that ADDS something to its registration
 * or its equipment: plates, owners, authorized people, EV profile.
 *
 * Mirrors `TERMINAL_LIFECYCLE` in `apps/api/src/modules/vehicle/domain/vehicle-lifecycle.ts:78`
 * — `{merged, scrapped}` — which is the set the DB check constraint
 * `veh.vehicles.ck_vehicles_terminal_workshop` uses too.
 *
 * ## Why this is not simply folded into `isFrozen`
 *
 * The server's refusals were read one writer at a time rather than assumed:
 *
 * | write                                | refuses `merged` | refuses `scrapped` |
 * | ------------------------------------ | ---------------- | ------------------ |
 * | plate assign / ownership transfer     | yes              | **yes** — `vehicle-registration-service.ts:194` |
 * | authorized party add / retire         | yes              | **yes** — `vehicle-relations-service.ts:184`    |
 * | EV profile set                        | yes              | **yes** — `vehicle-lifecycle-service.ts:68`     |
 * | vehicle update (details)              | yes              | no  — `vehicle-write-service.ts:119` guards `merged` only |
 * | status change                         | yes              | no guard, but `LIFECYCLE_TRANSITIONS.scrapped` is `[]`, so every target is refused |
 * | odometer record                       | no lifecycle guard at all — `vehicle-odometer-service.ts` |
 * | customer→vehicle link (CRM)           | no lifecycle guard at all — `customer-identity-service.ts:302` |
 *
 * So a scrapped vehicle's DETAILS can still be corrected — a plate typo on a
 * written-off car is exactly the sort of correction that stays legitimate — while
 * its registration and equipment cannot change. Widening `isFrozen` would have
 * removed a working control; leaving it as it was left four Save buttons whose
 * only possible answer was 409.
 */
export function isTerminal(vehicle: VehicleDetail): boolean {
  return isFrozen(vehicle) || vehicle.lifecycleStatus === 'scrapped';
}

/**
 * A catalogue label, or the honest reason there isn't one.
 *
 * Three outcomes rather than two, because "no make recorded" and "a make you
 * cannot see" are different facts and rendering a raw uuid for either is the
 * failure this exists to prevent.
 */
export type LabelState =
  | { readonly kind: 'value'; readonly name: string }
  | { readonly kind: 'unset' }
  | { readonly kind: 'unavailable' };

export function labelFor(id: string | null, name: string | null): LabelState {
  if (id === null) return { kind: 'unset' };
  if (name === null || name.trim().length === 0) return { kind: 'unavailable' };
  return { kind: 'value', name };
}

/* ------------------------------------------------------------------ *
 * FE-020 — VIN validation
 * ------------------------------------------------------------------ */

/**
 * The four verdicts this product can honestly reach about a VIN.
 *
 * `unavailable` exists because a failed uniqueness check is **not** the same as
 * "available". Collapsing them would let a transport error read as a clean bill
 * of health for a VIN that is in fact already taken.
 */
export type VinVerdict = 'invalid-format' | 'duplicate' | 'available' | 'unavailable';

/**
 * `veh.vehicles.vin_raw` is `text` with a length bound and no format CHECK.
 *
 * The 17-character ISO-3779 shape is therefore **not** enforced by this
 * platform, and this client does not invent it: a 17-character check would
 * refuse legitimate older, imported and non-road vehicles that the database
 * accepts.
 */
export const MAX_VIN_LENGTH = 64;

/** The ISO-3779 length, used only to INFORM, never to reject. */
export const ISO_VIN_LENGTH = 17;

/**
 * Local, format-only validation.
 *
 * Deliberately narrow. It rejects exactly what the normalisation makes
 * meaningless — a value that contains no alphanumeric character at all, which
 * normalises to the empty string and would be stored as a VIN that matches
 * nothing — and what the column bound refuses.
 *
 * It does **not**:
 * - enforce 17 characters,
 * - exclude `I`, `O` or `Q` (the platform's `normalize_vin` preserves them),
 * - compute or verify a check digit,
 * - decode a manufacturer, model or year.
 *
 * Every one of those would be a rule this product does not have, applied to
 * data it does not own.
 */
export function validateVinFormat(raw: string): 'ok' | 'empty' | 'too-long' | 'no-alphanumeric' {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length > MAX_VIN_LENGTH) return 'too-long';
  if (!/[A-Za-z0-9]/.test(trimmed)) return 'no-alphanumeric';
  return 'ok';
}

/**
 * Whether a VIN differs from the ISO-3779 length.
 *
 * Advisory only. Returned so a screen can say "this is not 17 characters" as an
 * observation, never as a refusal.
 */
export function isNonStandardLength(raw: string): boolean {
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalized.length > 0 && normalized.length !== ISO_VIN_LENGTH;
}
