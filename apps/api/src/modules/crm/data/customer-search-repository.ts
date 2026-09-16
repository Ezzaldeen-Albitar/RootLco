/**
 * CRM customer search — repository (Phase 1-16, FR-CRM-001, P1-13-BE-003;
 * widened P1-32).
 *
 * The only place customer-search SQL is written. Runs through a `DbHandle`, so it
 * cannot execute without a resolved context, and every predicate is a bound
 * parameter. On top of RLS default-deny it carries an explicit `tenant_id`
 * predicate (defence in depth) and excludes soft-deleted partners.
 *
 * Bounded by construction. The name match is a CONTAINS over
 * `crm.normalize_name(display_name)` — the same expression
 * `ix_business_partners_name_folded_trgm` indexes, so it is an index lookup and
 * not the full scan a leading wildcard used to imply. The phone match runs
 * against `crm.contact_points` through a fixed-width suffix key served by
 * `ix_contact_points_phone_tail`. The result is keyset-ordered by
 * `(created_at DESC, id DESC)` with a fetch of `limit + 1` — one page, never an
 * offset walk.
 *
 * ## The projection, and the one value that is gated
 *
 * A result row has to carry enough for a person to pick the right customer, so it
 * publishes the primary phone and the count of vehicles they hold. The phone is
 * MASKED to its last four digits unless the caller holds `iam.sensitive.view`,
 * and the permission is asked OF THE DATABASE (`iam.has_permission`) rather than
 * recomputed here, because the database is what actually decides; a second
 * implementation of "does this caller hold it" could disagree with the policy
 * that matters. That mirrors `CustomerReadRepository.mayViewSensitiveNotes`.
 *
 * No sensitive identifier column — national id, date of birth, tax number — is
 * selected by any query in this file.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import {
  CUSTOMER_SEARCH_ORDERING,
  maskPhone,
  type CustomerLifecycleStatus,
  type CustomerPartyType,
  type CustomerSearchFilter,
  type CustomerSearchHit,
} from '../domain/customer-search';

interface CustomerRow {
  readonly id: string;
  readonly display_number: string | null;
  readonly display_name: string;
  readonly party_type: CustomerPartyType;
  readonly lifecycle_status: CustomerLifecycleStatus;
  readonly created_at: Date;
  readonly primary_phone: string | null;
  /** `count(*)` cast to int in SQL, so it arrives as a number rather than a bigint string. */
  readonly vehicle_count: number;
  /**
   * `created_at` to microsecond precision, as text, for the cursor only.
   *
   * Separate from the published `createdAt` on purpose. `node-postgres` parses
   * `timestamptz` into a JS `Date`, which holds milliseconds — so
   * `created_at.toISOString()` silently truncates the three microsecond digits
   * PostgreSQL stores. A cursor built from the truncated value compares
   * `'…:00.123Z' < '…:00.123456Z'` and the keyset predicate then skips every row
   * that shares the millisecond with the last row of the page. That is
   * `P1-27-INT-006`, and this column is what stops it.
   */
  readonly created_at_cursor: string;
}

function toHit(row: CustomerRow, unmasked: boolean): CustomerSearchHit {
  const phone = row.primary_phone;
  const visiblePhone = phone === null ? null : unmasked ? phone : maskPhone(phone);
  return {
    id: row.id,
    displayNumber: row.display_number,
    displayName: row.display_name,
    partyType: row.party_type,
    lifecycleStatus: row.lifecycle_status,
    // Millisecond ISO is the right shape for the PUBLISHED field; it is only the
    // cursor that must not be built from it.
    createdAt: row.created_at.toISOString(),
    primaryPhone: visiblePhone,
    phoneMasked: phone !== null && !unmasked,
    vehicleCount: row.vehicle_count,
  };
}

export class CustomerSearchRepository extends Repository {
  protected readonly module = 'crm';

  /**
   * Whether this caller may be shown an unmasked contact value.
   *
   * `iam.sensitive.view` is the platform's one capability for "may see the value
   * behind a guarded field", and it is the same code the notes policy and the
   * organisation-settings read already use. Asked of the database so this answer
   * cannot drift from the policy that decides everywhere else.
   */
  async mayViewContactDetail(db: DbHandle): Promise<boolean> {
    const result = await this.run<{ allowed: boolean }>(
      db,
      `SELECT iam.has_permission('iam.sensitive.view') AS allowed`
    );
    return result.rows[0]?.allowed === true;
  }

  async search(
    db: DbHandle,
    page: PageRequest,
    filter: CustomerSearchFilter,
    unmaskedPhone: boolean
  ): Promise<Page<CustomerSearchHit>> {
    const context = this.assertContext(db);
    const where: string[] = ['bp.tenant_id = $1', 'bp.deleted_at IS NULL'];
    const values: unknown[] = [context.principal.tenantId];
    let param = 2;

    if (filter.nameFragment !== null) {
      // CONTAINS on the column-side normalisation, so a stored name and the query
      // fragment are compared under the same frozen rule and no row can silently
      // diverge. The fragment is LIKE-escaped in the domain and matched with
      // `ESCAPE '\'`, so the appended `%` characters are the only wildcards —
      // caller `%`/`_` are literals.
      where.push(`crm.normalize_name(bp.display_name) LIKE '%' || $${param} || '%' ESCAPE '\\'`);
      values.push(filter.nameFragment);
      param += 1;
    }
    if (filter.customerNumber !== null) {
      where.push(`bp.display_number = $${param}`);
      values.push(filter.customerNumber);
      param += 1;
    }
    if (filter.phoneDigits !== null) {
      where.push(phoneExists(param, filter.phoneSuffixEligible));
      values.push(filter.phoneDigits);
      param += 1;
    }
    if (filter.freeText !== null) {
      // The free-text arm is a DISJUNCTION over the three things a person types
      // into one box: part of a name, the customer's number, or a phone number.
      // Each sub-arm is the same predicate its dedicated parameter would produce,
      // so `q` can never find something `name`, `customerNumber` or `phone` could
      // not.
      const arms = [
        `crm.normalize_name(bp.display_name) LIKE '%' || $${param} || '%' ESCAPE '\\'`,
        `bp.display_number = $${param + 1}`,
      ];
      values.push(filter.freeText, filter.freeTextRaw);
      param += 2;
      // The phone arm, and its parameter, exist only when the box held a digit.
      // Binding a value no placeholder references is not harmless: PostgreSQL
      // cannot infer the type of an unreferenced parameter and refuses the whole
      // statement.
      if (filter.freeTextDigits !== '') {
        arms.push(phoneExists(param, filter.freeTextPhoneEligible));
        values.push(filter.freeTextDigits);
        param += 1;
      }
      where.push(`(${arms.join(' OR ')})`);
    }
    if (filter.partyType !== null) {
      where.push(`bp.party_type = $${param}`);
      values.push(filter.partyType);
      param += 1;
    }
    if (filter.lifecycleStatus !== null) {
      where.push(`bp.lifecycle_status = $${param}`);
      values.push(filter.lifecycleStatus);
      param += 1;
    }

    const keyset = keysetFragment(
      page,
      { sort: 'bp.created_at', id: 'bp.id' },
      CUSTOMER_SEARCH_ORDERING,
      param
    );
    values.push(...keyset.values);

    // Both correlated sub-selects are computed for the PAGE, never for the
    // tenant: they run after the keyset window has chosen at most `limit + 1`
    // rows. The primary phone prefers the flagged primary and falls back to the
    // oldest contact point, so a customer with one unflagged number still shows
    // it rather than nothing. The vehicle count counts DISTINCT live vehicles a
    // live relationship points at, so two roles on one car are one car.
    const sql = `
      SELECT bp.id, bp.display_number, bp.display_name, bp.party_type, bp.lifecycle_status,
             bp.created_at,
             ${cursorTimestamp('bp.created_at')} AS created_at_cursor,
             (SELECT cp.normalized_value
                FROM crm.contact_points cp
               WHERE cp.tenant_id = bp.tenant_id
                 AND cp.partner_id = bp.id
                 AND cp.deleted_at IS NULL
                 AND cp.channel IN ('phone', 'mobile')
               ORDER BY cp.is_primary DESC, cp.created_at ASC, cp.id ASC
               LIMIT 1) AS primary_phone,
             (SELECT count(DISTINCT r.vehicle_id)::int
                FROM veh.vehicle_relationships r
                JOIN veh.vehicles v
                  ON v.tenant_id = r.tenant_id AND v.id = r.vehicle_id
                 AND v.deleted_at IS NULL
               WHERE r.tenant_id = bp.tenant_id
                 AND r.partner_id = bp.id
                 AND r.valid_to IS NULL) AS vehicle_count
        FROM crm.business_partners bp
       WHERE ${where.join(' AND ')} ${keyset.predicate}
       ${keyset.order}
       ${keyset.limitClause}`;

    const result = await this.run<CustomerRow>(db, sql, values);
    // `buildPageWithCursors`, not `buildPage`: the cursor key is deliberately NOT
    // a field of the published item, so no reader can assume the two strings are
    // the same. Every sibling CRM list was converted by the `P1-27-INT-006` fix;
    // this one was missed because the sweep checked the Wave 7-21 operation list
    // and `crm.customer-search` is Wave 2.
    const rows = result.rows.map((row) => ({
      item: toHit(row, unmaskedPhone),
      sortValue: row.created_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, CUSTOMER_SEARCH_ORDERING);
  }
}

/**
 * One phone predicate, written once and reused by the `phone` arm and by the
 * free-text arm. A second copy is how two arms of one search come to disagree
 * about which contact points count.
 *
 * The suffix arm is TWO comparisons, not one. `right(normalized_value, 7)` is the
 * indexed key and prunes the table to a handful of rows; the `LIKE` that follows
 * is the exact test, and is what makes the answer correct for a fragment longer
 * than the key. The bound value is digits only — the domain strips everything
 * else — so it holds no LIKE metacharacter and the concatenated `%` is the only
 * wildcard.
 *
 * The suffix arm is omitted entirely below `MIN_PHONE_SUFFIX` digits, leaving an
 * exact comparison that no blank stored value can satisfy
 * (`ck_contact_points_normalized_not_blank`). A four-digit tail is shared by too
 * many people to be a lookup.
 */
function phoneExists(placeholder: number, suffix: boolean): string {
  const suffixArm = suffix
    ? `
                OR (right(cp.normalized_value, 7) = right($${placeholder}, 7)
                    AND cp.normalized_value LIKE '%' || $${placeholder})`
    : '';
  return `
      EXISTS (
        SELECT 1
          FROM crm.contact_points cp
         WHERE cp.tenant_id = bp.tenant_id
           AND cp.partner_id = bp.id
           AND cp.deleted_at IS NULL
           AND cp.channel IN ('phone', 'mobile')
           AND (cp.normalized_value = $${placeholder}${suffixArm}))`;
}
