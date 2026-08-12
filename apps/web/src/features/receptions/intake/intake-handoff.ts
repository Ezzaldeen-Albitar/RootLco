import type { Locale } from '@/i18n/config';

/**
 * The walk-in intake → check-in handoff (`P1-28-FE-006` → `P1-28-FE-007`).
 *
 * ## Both ends of the seam live here
 *
 * The walk-in intake flow ends holding exactly two identifiers: the customer
 * who is standing at the desk and the vehicle on the ramp. The check-in wizard
 * (`P1-28-FE-007`) starts from exactly those two — `rec.reception-create`
 * wants a `vehicleId` and a `serviceRequesterPartnerId`, and for a walk-in
 * origin the customer chosen here is that service requester.
 *
 * The wizard consumes this module rather than re-declaring the shape:
 *
 *   - `WalkInHandoff` is the pair, typed once.
 *   - `CHECK_IN_WIZARD_PATH` is where the wizard route mounts. The intake
 *     screen builds its "continue" link from this constant, so the wizard
 *     cannot land somewhere the intake does not point.
 *   - `checkInWizardHref` is how the intake ROUTES the pair (query parameters,
 *     under the locale segment).
 *   - `parseWalkInHandoff` is how the wizard READS them back, including the
 *     refusal of anything that is not two well-formed identifiers.
 *   - `walkInHandoffFromQuery` is the same read from a Next.js `searchParams`
 *     record, which is the shape a page actually receives.
 *
 * ## The address was wrong once, silently
 *
 * This constant read `/reception/check-in` (singular) while the wizard mounted
 * at `/receptions/check-in` (plural), and nothing noticed because the producing
 * end was switched off: the intake page passed `checkInAvailable={false}`, so
 * the only code that reads the constant never rendered. A shared constant does
 * not make two ends agree; a test that walks the seam does.
 * `apps/web/tests/reception-walkin-handoff.test.ts` now pins the constant to
 * the directory that actually exists under `app/[locale]/(dashboard)`, and the
 * DOM cases pin the intake's link and the wizard's pre-selection to each other.
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
 * `receptions`, PLURAL — the directory is
 * `app/[locale]/(dashboard)/receptions/check-in`, beside the per-visit
 * `receptions/check-in/[receptionId]`. The singular `reception/` segment holds
 * the walk-in intake and nothing else.
 */
export const CHECK_IN_WIZARD_PATH = '/receptions/check-in';

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

/**
 * The same read, from the record a Next.js page receives.
 *
 * A page's `searchParams` is not a `URLSearchParams`: a repeated key arrives as
 * an ARRAY. This turns the record back into the search string the browser sent
 * and hands it to `parseWalkInHandoff` — one parser, one refusal, rather than a
 * second copy of the identifier rule that could drift from it. A repeated key
 * keeps its FIRST value, which is what `URLSearchParams.get` would have
 * answered for the very same URL; a malformed or half pair still returns
 * `null`, and the wizard starts empty.
 */
export function walkInHandoffFromQuery(
  searchParams: Readonly<Record<string, string | string[] | undefined>>
): WalkInHandoff | null {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') params.set(key, first);
  }
  return parseWalkInHandoff(params);
}
