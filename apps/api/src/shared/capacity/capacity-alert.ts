/**
 * When a subscription capacity kind becomes an alert, decided in ONE place.
 *
 * Two surfaces answer this question and they must never disagree: the platform
 * console reports it for every organisation, and an organisation's own
 * administrators read it for themselves. Two copies of "ninety per cent" is
 * exactly how the console comes to warn about a tenant the tenant has not been
 * warned about, so the ratio and the classification live here, in `shared`, which
 * neither module owns and both may import.
 *
 * The NUMBERS these are applied to are not decided here. They come from
 * `org.capacity_usage`, the same function the capacity refusal is computed from;
 * this module only says which of them deserve saying out loud.
 *
 * ## The three states, and why zero is one of them
 *
 * A plan that grants no branches at all and an organisation holding branches is
 * OVER its limit, not exempt from it. The near-limit band is skipped for a zero
 * limit — ninety per cent of nothing would flag every organisation on such a plan
 * the moment it was created, including those holding nothing — but the breach
 * itself is reported, because an organisation consuming what it was not granted is
 * precisely what an operator has to see.
 */

/** The fraction of a limit at which a kind starts being reported. */
export const CAPACITY_ALERT_NEAR_LIMIT_RATIO = 0.9;

/** How close to (or past) a limit one capacity kind is. */
export type CapacityAlertSeverity = 'near-limit' | 'at-limit' | 'over-limit';

/**
 * The severity of one kind, or null when it is not worth reporting.
 *
 * `null` for an unlimited kind (`limit === null`) and for one comfortably inside
 * its ceiling. A caller that filters on this function and a query that filters in
 * SQL must use `CAPACITY_ALERT_NEAR_LIMIT_RATIO` for the SQL predicate, so the two
 * halves cannot select different rows.
 */
export function capacityAlertSeverity(
  used: number,
  limit: number | null
): CapacityAlertSeverity | null {
  if (limit === null) return null;
  if (used > limit) return 'over-limit';
  if (used === limit) return 'at-limit';
  // Below the ceiling: only the near band remains, and a zero ceiling has none.
  if (limit > 0 && used >= CAPACITY_ALERT_NEAR_LIMIT_RATIO * limit) return 'near-limit';
  return null;
}
