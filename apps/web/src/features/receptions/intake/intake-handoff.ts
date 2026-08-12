import type { Locale } from '@/i18n/config';

/**
 * The walk-in intake → check-in handoff (`P1-28-FE-006` → `P1-28-FE-007`).
 *
 * ## This file is the Wave-D consumption point
 *
 * The walk-in intake flow ends holding exactly two identifiers: the customer
 * who is standing at the desk and the vehicle on the ramp. The check-in wizard
 * (`P1-28-FE-007`, built by Wave D) starts from exactly those two —
 * `rec.reception-create` wants a `vehicleId` and a `serviceRequesterPartnerId`,
 * and for a walk-in origin the customer chosen here is that service requester.
 *
 * Wave D consumes this module rather than re-declaring the shape:
 *
 *   - `WalkInHandoff` is the pair, typed once.
 *   - `CHECK_IN_WIZARD_PATH` is where the wizard route must mount. The intake
 *     screen builds its "continue" link from this constant, so the wizard
 *     cannot land somewhere the intake does not point.
 *   - `checkInWizardHref` is how the intake ROUTES the pair (query parameters,
 *     under the locale segment).
 *   - `parseWalkInHandoff` is how the wizard READS them back, including the
 *     refusal of anything that is not two well-formed identifiers.
 *
 * Until the wizard route exists, the intake page passes
 * `checkInAvailable={false}` and the screen states the absence instead of
 * rendering a link that answers 404 — a link to a screen that does not exist is
 * a lie of the same kind as a `Confirm` control that confirms nothing. Wave D
 * flips that prop in the same change that lands the route.
 *
 * ## Why identifiers may travel in the URL here
 *
 * These are opaque internal identifiers, the same currency every existing
 * route already carries in its path (`/crm/customers/{id}`, `/vehicles/{id}`).
 * No name, phone number or other personal value is ever serialised — that rule
 * lives in `components/data-table/table-state.ts` and is not weakened here.
 */
export interface WalkInHandoff {
  /** The customer received at the desk — the walk-in service requester. */
  readonly customerId: string;
  /** The vehicle being brought in. */
  readonly vehicleId: string;
}

/**
 * Where the check-in wizard mounts, relative to the locale segment.
 *
 * Owned here, not by Wave D, so the producing and consuming ends of the
 * handoff cannot disagree about the address.
 */
export const CHECK_IN_WIZARD_PATH = '/reception/check-in';

export const HANDOFF_CUSTOMER_PARAM = 'customerId';
export const HANDOFF_VEHICLE_PARAM = 'vehicleId';

/**
 * The shape both identifiers must take. The backend re-authorises whatever
 * arrives, so this is coherence checking, not a security boundary: a wizard
 * opened from a mangled link should say "start from intake" rather than issue
 * a read that can only 404.
 */
const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The wizard URL for a completed intake, under the given locale. */
export function checkInWizardHref(locale: Locale, handoff: WalkInHandoff): string {
  const params = new URLSearchParams({
    [HANDOFF_CUSTOMER_PARAM]: handoff.customerId,
    [HANDOFF_VEHICLE_PARAM]: handoff.vehicleId,
  });
  return `/${locale}${CHECK_IN_WIZARD_PATH}?${params.toString()}`;
}

/**
 * Reads a handoff back out of the wizard's search parameters.
 *
 * Returns `null` unless BOTH identifiers are present and well-formed — a
 * half-pair is not a handoff, and the wizard's correct answer to one is its
 * "start from intake" state, never a guess at the missing half.
 */
export function parseWalkInHandoff(params: URLSearchParams): WalkInHandoff | null {
  const customerId = params.get(HANDOFF_CUSTOMER_PARAM) ?? '';
  const vehicleId = params.get(HANDOFF_VEHICLE_PARAM) ?? '';
  if (!IDENTIFIER.test(customerId) || !IDENTIFIER.test(vehicleId)) return null;
  return { customerId, vehicleId };
}
