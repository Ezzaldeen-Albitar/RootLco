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
 * which vehicle it is about, what its paperwork number is, and — since the
 * issued-parts read — which catalogue item it is about.
 *
 * An anchor a list does not supply is an arm that is not built at all, so the
 * four boards that shipped with this builder emit exactly the SQL they emitted
 * before: `partnerIds` is theirs and `itemId` is not.
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
  /**
   * A scalar SQL expression naming the catalogue item the row is about, or
   * `null`/absent when the row is about no item (Owner directive,
   * P1-32-PRE-OD-UX).
   *
   * Only `inv.part-issue-list` supplies one today. A clerk taking a part back
   * over the counter holds the PART, not the customer's phone number, so the box
   * on that screen has to reach the item's name and its code — and the four
   * boards that had the box first have no item to reach.
   *
   * The arm is built from the SAME two fragments the other arms use: the folded
   * name fragment is compared against `shared.fold_search_text(name)`, the SQL
   * twin of `foldSearchText`, and the reference fragment — digits folded, which
   * leaves a letter alone — is compared against the code. No third fragment, and
   * no normalisation re-derived here.
   */
  readonly itemId?: string | null;
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

  const itemArm = anchors.itemId !== undefined && anchors.itemId !== null;
  const partnerArms = anchors.partnerIds !== null;

  // A fragment is bound ONLY when an arm below references it. PostgreSQL infers
  // each parameter's type from where it is used, so a value bound and never
  // referenced fails the whole statement with "could not determine data type of
  // parameter" — which is what the issued-parts read, the first list with no
  // customer arms, hit. The order stays name, phone, plate, VIN, reference, and a
  // list that uses all five (every board before that read) is numbered exactly
  // as it always was.
  const values: unknown[] = [];
  const bind = (used: boolean, value: string): string => {
    if (!used) return '';
    values.push(value);
    return `$${firstIndex + values.length - 1}`;
  };
  const name = bind(itemArm || partnerArms, terms.nameFragment);
  const phone = bind(partnerArms, terms.phoneDigits);
  const plate = bind(true, terms.plateFragment);
  const vin = bind(true, terms.vinFragment);
  const reference = bind(anchors.reference !== null || itemArm, terms.referenceFragment);

  const arms: string[] = [];

  if (anchors.reference !== null) {
    arms.push(
      `(${reference}::text <> '' AND (${anchors.reference}) ILIKE '%' || ${reference}::text || '%' ESCAPE '\\')`
    );
  }

  if (itemArm) {
    // ONE `EXISTS` over two columns rather than two arms, because both are facts
    // about the same catalogue row and a second correlated subquery would read
    // `inv.item_master` twice for every candidate. Each half keeps its own
    // `<> ''` guard for the reason every other arm does: an empty fragment would
    // become `LIKE '%%'` and match the whole catalogue.
    arms.push(
      `EXISTS (
          SELECT 1
            FROM inv.item_master im
           WHERE im.tenant_id = ${anchors.tenant}
             AND im.id = ${anchors.itemId}
             AND im.deleted_at IS NULL
             AND ((${name}::text <> ''
                   AND shared.fold_search_text(im.name) LIKE '%' || ${name}::text || '%' ESCAPE '\\')
               OR (${reference}::text <> ''
                   AND im.sku ILIKE '%' || ${reference}::text || '%' ESCAPE '\\')))`
    );
  }

  if (partnerArms) {
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
           AND ph.plate_normalized LIKE '%' || ${plate}::text || '%' ESCAPE '\\'))`
  );
  arms.push(
    `(${vin}::text <> '' AND EXISTS (
        SELECT 1
          FROM veh.vehicles v
         WHERE v.tenant_id = ${anchors.tenant}
           AND v.id = ${anchors.vehicleId}
           AND v.vin_normalized LIKE '%' || ${vin}::text || '%' ESCAPE '\\'))`
  );

  return {
    predicate: `AND (${arms.join('\n             OR ')})`,
    values,
  };
}
