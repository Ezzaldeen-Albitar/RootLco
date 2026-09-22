/**
 * The shared free-text search disjunction (Owner directive, P1-32-PRE-OD-UX).
 *
 * ## Why one builder and not four copies
 *
 * The reception board, the appointment calendar, the delivery list and the
 * warranty list all gained the same box, and the box means the same thing on all
 * four: *the customer's name, the tail of their phone number, the plate, the VIN,
 * or the paperwork number*. The five arms are thirty lines of correlated SQL. A
 * copy per module would be four places for "a phone tail is compared as a suffix
 * only above seven digits" to drift, and the drift would be silent — each list
 * would simply answer a slightly different question.
 *
 * So the SHAPE is written once here, beside `keysetFragment`, which is the other
 * piece of SQL this foundation composes for every list. What each list supplies
 * is only what is genuinely different about it: where its partners come from,
 * which vehicle it is about, and what its paperwork number is.
 *
 * ## Every arm is a correlated EXISTS, never a join
 *
 * A join would return the row once per matching party role or once per plate
 * interval, so a page of ten deliveries could come back as fourteen rows with
 * duplicates. `EXISTS` asks the question and stops.
 *
 * ## Applied BEFORE the keyset window
 *
 * The caller splices this into the WHERE clause, ahead of `keysetFragment`'s
 * predicate. Filtering a page after it has been fetched produces short pages and
 * a `hasMore` that lies — the P1-28 round-two defect — so the predicate runs in
 * the query and every page is full and complete.
 *
 * ## An arm whose fragment reduced to nothing is DISABLED
 *
 * Each arm carries its own `<> ''` guard. Without it an empty fragment would
 * become `LIKE '%%'` and match every row in the branch, which turns a search into
 * a way of reading everything.
 *
 * ## Normalisation is never re-derived here
 *
 * The fragments arrive already folded by `toEntitySearchTerms`, which calls the
 * same rules the stored columns were folded by; this file only names the SQL twin
 * on the COLUMN side — `crm.normalize_name`, `right(normalized_value, 7)`,
 * `plate_normalized`, `vin_normalized` — so the predicate and the indexes
 * (`ix_business_partners_name_folded_trgm`, `ix_contact_points_phone_tail`,
 * `ix_plate_history_normalized_trgm`, `ix_vehicles_vin_trgm`) cannot diverge.
 */
import type { EntitySearchTerms } from '@/shared/text/search-terms';

export interface SearchAnchors {
  /** SQL expression for the row's tenant, e.g. `rv.tenant_id`. */
  readonly tenant: string;
  /** SQL expression for the row's vehicle, e.g. `rv.vehicle_id`. */
  readonly vehicleId: string;
  /**
   * A SELECT yielding the partner ids connected to this row, or null when the
   * row has no party link at all.
   *
   * ANY role, not only the service requester: a person searching for a customer
   * wants every car that customer is connected to, and a payer or an authorized
   * receiver is such a connection — the rule BR-05 already settled for the
   * work-order board.
   */
  readonly partnerIds: string | null;
  /**
   * A scalar SQL expression holding the row's business reference number, or null
   * when the row carries none. May itself be a scalar subquery: a delivery and a
   * warranty have no number of their own and are looked up by their work
   * order's.
   */
  readonly reference: string | null;
}

export interface SearchFragment {
  /** `''` when no box was sent, so the caller splices it in unconditionally. */
  readonly predicate: string;
  /** Bound values, appended in order after the caller's own. */
  readonly values: readonly unknown[];
}

/**
 * Builds the disjunction and the values it binds.
 *
 * `firstIndex` is the 1-based placeholder number this fragment may start at. The
 * caller appends `values` to its own array in the same order, exactly as it does
 * for `keysetFragment`.
 */
export function searchFragment(
  terms: EntitySearchTerms,
  anchors: SearchAnchors,
  firstIndex: number
): SearchFragment {
  if (!terms.present) return { predicate: '', values: [] };

  const name = `$${firstIndex}`;
  const phone = `$${firstIndex + 1}`;
  const plate = `$${firstIndex + 2}`;
  const vin = `$${firstIndex + 3}`;
  const reference = `$${firstIndex + 4}`;

  const arms: string[] = [];

  if (anchors.reference !== null) {
    arms.push(
      `(${reference}::text <> '' AND (${anchors.reference}) ILIKE '%' || ${reference}::text || '%' ESCAPE '\\')`
    );
  }

  if (anchors.partnerIds !== null) {
    arms.push(
      `(${name}::text <> '' AND EXISTS (
          SELECT 1
            FROM crm.business_partners bp
           WHERE bp.tenant_id = ${anchors.tenant}
             AND bp.deleted_at IS NULL
             AND bp.id IN (${anchors.partnerIds})
             AND crm.normalize_name(bp.display_name) LIKE '%' || ${name}::text || '%' ESCAPE '\\'))`
    );
    // The suffix comparison is TWO tests, not one, and only above
    // `MIN_PHONE_SUFFIX` digits. `right(normalized_value, 7)` is the indexed key
    // and prunes the table to a handful of rows; the `LIKE` that follows is the
    // exact test, and is what keeps the answer right for a fragment longer than
    // the key. Below the threshold only the exact comparison survives, which no
    // blank stored value can satisfy.
    const suffixArm = terms.phoneSuffixEligible
      ? ` OR (right(cp.normalized_value, 7) = right(${phone}::text, 7)
                   AND cp.normalized_value LIKE '%' || ${phone}::text)`
      : '';
    arms.push(
      `(${phone}::text <> '' AND EXISTS (
          SELECT 1
            FROM crm.contact_points cp
           WHERE cp.tenant_id = ${anchors.tenant}
             AND cp.deleted_at IS NULL
             AND cp.partner_id IN (${anchors.partnerIds})
             AND cp.channel IN ('phone', 'mobile')
             AND (cp.normalized_value = ${phone}::text${suffixArm})))`
    );
  }

  arms.push(
    `(${plate}::text <> '' AND EXISTS (
        SELECT 1
          FROM veh.plate_history ph
         WHERE ph.tenant_id = ${anchors.tenant}
           AND ph.vehicle_id = ${anchors.vehicleId}
           AND ph.plate_normalized LIKE '%' || ${plate}::text || '%'))`
  );
  arms.push(
    `(${vin}::text <> '' AND EXISTS (
        SELECT 1
          FROM veh.vehicles v
         WHERE v.tenant_id = ${anchors.tenant}
           AND v.id = ${anchors.vehicleId}
           AND v.vin_normalized LIKE '%' || ${vin}::text || '%'))`
  );

  return {
    predicate: `AND (${arms.join('\n             OR ')})`,
    values: [
      terms.nameFragment,
      terms.phoneDigits,
      terms.plateFragment,
      terms.vinFragment,
      terms.referenceFragment,
    ],
  };
}
