/**
 * Platform subscription charges and receipts (P1-32-PRE-024).
 *
 * This is PLATFORM revenue — what the Platform Owner charges an organisation
 * for using the product — and never tenant revenue. The separation is enforced
 * by the privilege graph rather than by convention: `app_runtime` holds no grant
 * on either table, and `app_platform` holds none on `sal.*`.
 *
 * ## Every amount is a decimal string
 *
 * `pg` returns `numeric` as text, and it stays text. No `Number()`, no
 * `parseFloat`, no `toFixed`, no arithmetic in JavaScript anywhere on this path.
 * `outstanding` is computed by PostgreSQL in exact numeric and handed back as a
 * string, because the alternative — subtracting two floats and rounding — is how
 * a balance ends up one minor unit away from the truth.
 *
 * ## Settlement is not decided here
 *
 * A charge becomes `settled` when `tg_subscription_receipts_settle` says so.
 * This repository inserts the receipt; the database decides what that means, so
 * there is exactly one writer of that fact.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import { toIsoString } from './platform-repository';

/** Ordering contract for a tenant's platform charge list. */
export const CHARGE_ORDERING: OrderingContract = {
  key: 'org.subscription_charges:created_at_desc',
  direction: 'desc',
};

/** One receipt recorded against a charge. */
export interface SubscriptionReceiptRow {
  readonly id: string;
  readonly chargeId: string;
  /** Decimal string. */
  readonly amount: string;
  readonly currencyCode: string;
  readonly receivedOn: string;
  readonly reference: string | null;
  readonly method: string;
  readonly notes: string | null;
  readonly recordedAt: string;
}

/** One charge with the receipts recorded against it. */
export interface SubscriptionChargeRow {
  readonly id: string;
  readonly subscriptionId: string | null;
  /** Decimal string. */
  readonly amount: string;
  readonly currencyCode: string;
  readonly dueOn: string;
  readonly description: string;
  readonly status: string;
  readonly voidReason: string | null;
  /** Decimal string: amount minus the receipts, never below zero. */
  readonly outstanding: string;
  readonly recordVersion: number;
  readonly recordedAt: string;
  readonly receipts: readonly SubscriptionReceiptRow[];
}

export class BillingRepository extends Repository {
  protected readonly module = 'platform';

  /**
   * One organisation's charges, newest first, with receipts nested.
   *
   * The outstanding balance is a SQL expression:
   *   `greatest(c.amount - coalesce(sum(receipts), 0), 0)`
   * evaluated in `numeric`. `greatest(..., 0)` because an over-payment leaves a
   * charge fully settled rather than owing a negative amount, and a negative
   * `outstanding` would be read by a human as a credit the platform does not
   * model. A void charge owes nothing whatever was recorded against it, which
   * is stated as its own branch rather than left to arithmetic.
   */
  async listCharges(
    db: DbHandle,
    tenantId: string,
    filters: { readonly status?: string | undefined },
    page: PageRequest
  ): Promise<Page<SubscriptionChargeRow>> {
    const values: unknown[] = [tenantId, filters.status ?? null];
    const keyset = keysetFragment(page, { sort: 'c.created_at', id: 'c.id' }, CHARGE_ORDERING, 3);
    values.push(...keyset.values);

    const charges = await this.run<{
      id: string;
      subscription_id: string | null;
      amount: string;
      currency_code: string;
      due_on: string | Date;
      description: string;
      status: string;
      void_reason: string | null;
      outstanding: string;
      record_version: number;
      created_at: string | Date;
      created_at_cursor: string;
    }>(
      db,
      `SELECT c.id, c.subscription_id, c.amount, c.currency_code, c.due_on,
              c.description, c.status, c.void_reason, c.record_version, c.created_at,
              ${cursorTimestamp('c.created_at')} AS created_at_cursor,
              -- Cast to the column's own numeric(18,4) so every balance has the
              -- same textual scale: without it a void charge reads '0' while a
              -- settled one reads '0.0000', and a client comparing strings
              -- would see two different zeros.
              (CASE WHEN c.status = 'void' THEN 0::numeric
                    ELSE greatest(
                           c.amount - COALESCE(
                             (SELECT sum(r.amount) FROM org.subscription_receipts r
                               WHERE r.charge_id = c.id), 0::numeric),
                           0::numeric)
               END)::numeric(18, 4) AS outstanding
         FROM org.subscription_charges c
        WHERE c.tenant_id = $1::uuid
          AND ($2::text IS NULL OR c.status = $2) ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );

    const ids = charges.rows.map((r) => r.id);
    const receipts = await this.listReceiptsForCharges(db, ids);

    return buildPageWithCursors(
      charges.rows.map((r) => ({
        item: {
          id: r.id,
          subscriptionId: r.subscription_id,
          amount: r.amount,
          currencyCode: r.currency_code,
          dueOn: toIsoString(r.due_on),
          description: r.description,
          status: r.status,
          voidReason: r.void_reason,
          outstanding: r.outstanding,
          recordVersion: r.record_version,
          recordedAt: toIsoString(r.created_at),
          receipts: receipts.filter((receipt) => receipt.chargeId === r.id),
        },
        sortValue: r.created_at_cursor,
        id: r.id,
      })),
      page,
      CHARGE_ORDERING
    );
  }

  /**
   * The receipts for a page of charges, in ONE statement.
   *
   * A query per charge would be N+1 on a list that an operator opens for every
   * organisation. `= ANY($1::uuid[])` keeps it a single indexed scan and keeps
   * the identifiers a bound parameter rather than an assembled IN list.
   */
  private async listReceiptsForCharges(
    db: DbHandle,
    chargeIds: readonly string[]
  ): Promise<readonly SubscriptionReceiptRow[]> {
    if (chargeIds.length === 0) return [];
    const result = await this.run<{
      id: string;
      charge_id: string;
      amount: string;
      currency_code: string;
      received_on: string | Date;
      reference: string | null;
      method: string;
      notes: string | null;
      created_at: string | Date;
    }>(
      db,
      `SELECT r.id, r.charge_id, r.amount, r.currency_code, r.received_on,
              r.reference, r.method, r.notes, r.created_at
         FROM org.subscription_receipts r
        WHERE r.charge_id = ANY($1::uuid[])
        ORDER BY r.received_on ASC, r.created_at ASC, r.id ASC`,
      [chargeIds]
    );
    return result.rows.map((r) => ({
      id: r.id,
      chargeId: r.charge_id,
      amount: r.amount,
      currencyCode: r.currency_code,
      receivedOn: toIsoString(r.received_on),
      reference: r.reference,
      method: r.method,
      notes: r.notes,
      recordedAt: toIsoString(r.created_at),
    }));
  }

  /**
   * Whether a subscription belongs to the named organisation.
   *
   * The foreign key on `subscription_id` proves only that the assignment
   * EXISTS, not whose it is — so without this a charge against organisation A
   * could cite a subscription of organisation B and every constraint would pass.
   */
  async subscriptionBelongsTo(
    db: DbHandle,
    tenantId: string,
    subscriptionId: string
  ): Promise<boolean> {
    const row = await this.runOne<{ found: boolean }>(
      db,
      `SELECT EXISTS (
         SELECT 1 FROM org.tenant_subscriptions s
          WHERE s.id = $2::uuid AND s.tenant_id = $1::uuid
       ) AS found`,
      [tenantId, subscriptionId]
    );
    return row?.found === true;
  }

  /** One charge by id, scoped to its organisation. Null when absent. */
  async readCharge(
    db: DbHandle,
    tenantId: string,
    chargeId: string
  ): Promise<{
    readonly id: string;
    readonly amount: string;
    readonly currencyCode: string;
    readonly status: string;
    readonly recordVersion: number;
  } | null> {
    const row = await this.runOne<{
      id: string;
      amount: string;
      currency_code: string;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT c.id, c.amount, c.currency_code, c.status, c.record_version
         FROM org.subscription_charges c
        WHERE c.tenant_id = $1::uuid AND c.id = $2::uuid`,
      [tenantId, chargeId]
    );
    if (!row) return null;
    return {
      id: row.id,
      amount: row.amount,
      currencyCode: row.currency_code,
      status: row.status,
      recordVersion: row.record_version,
    };
  }

  /**
   * Records a charge.
   *
   * The amount arrives as a decimal STRING and is cast to `numeric` by
   * PostgreSQL; it is never parsed in JavaScript. `status` is not a parameter:
   * `ins_subscription_charges_platform` admits only `open`, so a charge that
   * arrives already paid is impossible rather than merely discouraged.
   */
  async recordCharge(
    db: DbHandle,
    input: {
      readonly tenantId: string;
      readonly subscriptionId: string | null;
      readonly amount: string;
      readonly currencyCode: string;
      readonly dueOn: string;
      readonly description: string;
    }
  ): Promise<{ readonly id: string; readonly recordVersion: number }> {
    const row = await this.runOne<{ id: string; record_version: number }>(
      db,
      `INSERT INTO org.subscription_charges
         (tenant_id, subscription_id, amount, currency_code, due_on, description,
          status, created_by)
       VALUES ($1::uuid, $2::uuid, $3::numeric, $4, $5::date, $6, 'open', iam.current_user_id())
       RETURNING id, record_version`,
      [
        input.tenantId,
        input.subscriptionId,
        input.amount,
        input.currencyCode,
        input.dueOn,
        input.description,
      ]
    );
    if (!row) throw new Error('subscription charge insert returned no row');
    return { id: row.id, recordVersion: row.record_version };
  }

  /**
   * Voids a charge.
   *
   * Guarded on `status = 'open'` in the statement as well as in
   * `org.guard_subscription_charge_status()`: the trigger raises, and the
   * predicate makes the operation report "nothing changed" instead, which is
   * the answer a caller can act on. Returns the rows affected so the service
   * can tell a refusal from a success without a second read.
   */
  async voidCharge(
    db: DbHandle,
    tenantId: string,
    chargeId: string,
    reason: string
  ): Promise<number> {
    const result = await this.run(
      db,
      `UPDATE org.subscription_charges
          SET status = 'void', void_reason = $3
        WHERE tenant_id = $1::uuid AND id = $2::uuid AND status = 'open'`,
      [tenantId, chargeId, reason]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Records a receipt against a charge.
   *
   * The currency is NOT taken from the request: it is read from the charge in
   * the same statement, so the two can never disagree. The trigger
   * `tg_subscription_receipts_coherence` re-checks it anyway — belt and braces
   * on purpose, because that trigger also guards any future writer.
   */
  async recordReceipt(
    db: DbHandle,
    input: {
      readonly tenantId: string;
      readonly chargeId: string;
      readonly amount: string;
      readonly currencyCode: string;
      readonly receivedOn: string;
      readonly reference: string | null;
      readonly method: string;
      readonly notes: string | null;
    }
  ): Promise<{ readonly id: string; readonly chargeStatus: string; readonly outstanding: string }> {
    const inserted = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO org.subscription_receipts
         (tenant_id, charge_id, amount, currency_code, received_on, reference, method, notes,
          created_by)
       VALUES ($1::uuid, $2::uuid, $3::numeric, $4, $5::date, $6, $7, $8, iam.current_user_id())
       RETURNING id`,
      [
        input.tenantId,
        input.chargeId,
        input.amount,
        input.currencyCode,
        input.receivedOn,
        input.reference,
        input.method,
        input.notes,
      ]
    );
    if (!inserted) throw new Error('subscription receipt insert returned no row');

    // Read back AFTER the insert so the settlement trigger has fired. The
    // balance is the database's arithmetic, not this process's.
    const after = await this.runOne<{ status: string; outstanding: string }>(
      db,
      `SELECT c.status,
              greatest(
                c.amount - COALESCE(
                  (SELECT sum(r.amount) FROM org.subscription_receipts r
                    WHERE r.charge_id = c.id), 0::numeric),
                0::numeric)::numeric(18, 4) AS outstanding
         FROM org.subscription_charges c
        WHERE c.id = $1::uuid`,
      [input.chargeId]
    );
    if (!after) throw new Error('subscription charge disappeared while recording a receipt');
    return { id: inserted.id, chargeStatus: after.status, outstanding: after.outstanding };
  }
}
