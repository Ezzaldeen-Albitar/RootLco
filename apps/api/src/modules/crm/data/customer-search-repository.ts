/**
 * CRM customer search — repository (Phase 1-16, FR-CRM-001, P1-13-BE-003).
 *
 * The only place customer-search SQL is written. Runs through a `DbHandle`, so it
 * cannot execute without a resolved context, and every predicate is a bound
 * parameter. On top of RLS default-deny it carries an explicit `tenant_id`
 * predicate (defence in depth) and excludes soft-deleted partners.
 *
 * Bounded by construction: the name match is a **prefix** on the normalised
 * display name (never a leading-wildcard scan), and the result is keyset-ordered
 * by `(created_at DESC, id DESC)` with a fetch of `limit + 1` — one indexed page,
 * never an offset walk. The projection is the safe view only; no sensitive
 * identifier column is selected.
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

function toHit(row: CustomerRow): CustomerSearchHit {
  return {
    id: row.id,
    displayNumber: row.display_number,
    displayName: row.display_name,
    partyType: row.party_type,
    lifecycleStatus: row.lifecycle_status,
    // Millisecond ISO is the right shape for the PUBLISHED field; it is only the
    // cursor that must not be built from it.
    createdAt: row.created_at.toISOString(),
  };
}

export class CustomerSearchRepository extends Repository {
  protected readonly module = 'crm';

  async search(
    db: DbHandle,
    page: PageRequest,
    filter: CustomerSearchFilter
  ): Promise<Page<CustomerSearchHit>> {
    const context = this.assertContext(db);
    const where: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
    const values: unknown[] = [context.principal.tenantId];
    let param = 2;

    if (filter.namePrefix !== null) {
      // Prefix match on the column-side normalisation, so a stored name and the
      // query fragment are compared under the same frozen rule and no row can
      // silently diverge. Prefix (not `%x%`) keeps it index-eligible. The
      // fragment is LIKE-escaped in the domain and matched with `ESCAPE '\'`, so
      // the appended `%` is the only wildcard — caller `%`/`_` are literals.
      where.push(`crm.normalize_name(display_name) LIKE $${param} || '%' ESCAPE '\\'`);
      values.push(filter.namePrefix);
      param += 1;
    }
    if (filter.customerNumber !== null) {
      where.push(`display_number = $${param}`);
      values.push(filter.customerNumber);
      param += 1;
    }
    if (filter.partyType !== null) {
      where.push(`party_type = $${param}`);
      values.push(filter.partyType);
      param += 1;
    }
    if (filter.lifecycleStatus !== null) {
      where.push(`lifecycle_status = $${param}`);
      values.push(filter.lifecycleStatus);
      param += 1;
    }

    const keyset = keysetFragment(
      page,
      { sort: 'created_at', id: 'id' },
      CUSTOMER_SEARCH_ORDERING,
      param
    );
    values.push(...keyset.values);

    const sql = `
      SELECT id, display_number, display_name, party_type, lifecycle_status, created_at,
             ${cursorTimestamp('created_at')} AS created_at_cursor
        FROM crm.business_partners
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
      item: toHit(row),
      sortValue: row.created_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, CUSTOMER_SEARCH_ORDERING);
  }
}
