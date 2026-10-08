/**
 * Refund requests (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B) — the `sal` SQL behind
 * `sal.refund-request`, `-approve`, `-reject`, `-withdraw`, `-execute`, the list and
 * the detail, and the refund facts the invoice's settlement view is derived from.
 *
 * Every write goes through a protected primitive (`sal.request_refund`,
 * `sal.approve_refund_request`, `sal.reject_refund_request`,
 * `sal.withdraw_refund_request`, `sal.execute_refund_request`); this file has no
 * INSERT or UPDATE of `sal.refund_requests` or `sal.refund_obligations` of its own.
 * The guards hold every rule for any writer; the service checks them first only so
 * a refusal can name its rule.
 *
 * Every row read here is gated by `sal.finance.view` (`sel_refund_requests_gated`,
 * `sel_refund_obligations_gated`), and every sum is PostgreSQL's `numeric`, cast to
 * `numeric(18,4)` and returned as a decimal STRING. Nothing here parses an amount.
 */
import { Repository } from '@/server/db/repository';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';

/**
 * Refund requests are listed newest-first by `requested_at` (`sal.refund-request-list`).
 * A key of its own, so a cursor minted by another list is never accepted here.
 */
export const REFUND_REQUEST_ORDER: OrderingContract = Object.freeze({
  key: 'sal.refund_requests:requested_at_desc',
  direction: 'desc',
});

/** One refund request as stored. Amounts are decimal STRINGS. */
export interface RefundRequestRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly obligationId: string;
  readonly invoiceId: string;
  readonly payeePartnerId: string;
  readonly currencyCode: string;
  readonly amount: string;
  readonly paymentMethodId: string;
  readonly reason: string;
  /** `pending`, `approved`, `rejected` or `withdrawn`. */
  readonly approvalState: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
  readonly executedBy: string | null;
  readonly executedAt: Date | null;
  readonly payoutReference: string | null;
  /** The payout day as `YYYY-MM-DD`, read as text so no time zone moves it. */
  readonly payoutDate: string | null;
  readonly idempotencyKey: string | null;
  readonly executionIdempotencyKey: string | null;
  readonly recordVersion: number;
  /** The invoice's number, `null` when its header is not readable to the caller. */
  readonly invoiceNumber: string | null;
  /** The invoice's work order, `null` for a counter sale or an unreadable header. */
  readonly workOrderId: string | null;
}

/** The obligation a request is raised against, as the request path needs it. */
export interface RefundObligationHeadRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly partnerId: string;
  readonly invoiceId: string;
  readonly currencyCode: string;
  readonly amount: string;
  readonly state: string;
  readonly recordVersion: number;
  /** What its approved requests have paid out, `0.0000` when none. */
  readonly paidOut: string;
  /** Its amount less what has been paid out, computed by PostgreSQL. */
  readonly stillOwed: string;
}

/** A tenant payment method by id, as a refund names it. */
export interface RefundMethodRow {
  readonly id: string;
  readonly methodCode: string;
  readonly kind: string;
  readonly displayName: string;
  readonly active: boolean;
}

interface RefundRequestSql {
  id: string;
  company_id: string;
  branch_id: string;
  obligation_id: string;
  invoice_id: string;
  payee_partner_id: string;
  currency_code: string;
  amount: string;
  payment_method_id: string;
  reason: string;
  approval_state: string;
  requested_by: string;
  requested_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  executed_by: string | null;
  executed_at: Date | null;
  payout_reference: string | null;
  payout_date: string | null;
  idempotency_key: string | null;
  execution_idempotency_key: string | null;
  record_version: number;
  invoice_number: string | null;
  work_order_id: string | null;
}

const REFUND_REQUEST_COLUMNS = `rr.id, rr.company_id, rr.branch_id, rr.obligation_id, rr.invoice_id,
       rr.payee_partner_id, rr.currency_code, rr.amount::text AS amount, rr.payment_method_id,
       rr.reason, rr.approval_state, rr.requested_by, rr.requested_at, rr.approved_by,
       rr.approved_at, rr.decided_by, rr.decided_at, rr.decision_reason, rr.executed_by,
       rr.executed_at, rr.payout_reference, rr.payout_date::text AS payout_date,
       rr.idempotency_key, rr.execution_idempotency_key, rr.record_version,
       (SELECT i.invoice_number FROM sal.invoices i
         WHERE i.tenant_id = rr.tenant_id AND i.id = rr.invoice_id) AS invoice_number,
       (SELECT i.work_order_id FROM sal.invoices i
         WHERE i.tenant_id = rr.tenant_id AND i.id = rr.invoice_id) AS work_order_id`;

const toRefundRequest = (r: RefundRequestSql): RefundRequestRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  obligationId: r.obligation_id,
  invoiceId: r.invoice_id,
  payeePartnerId: r.payee_partner_id,
  currencyCode: r.currency_code,
  amount: r.amount,
  paymentMethodId: r.payment_method_id,
  reason: r.reason,
  approvalState: r.approval_state,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionReason: r.decision_reason,
  executedBy: r.executed_by,
  executedAt: r.executed_at,
  payoutReference: r.payout_reference,
  payoutDate: r.payout_date,
  idempotencyKey: r.idempotency_key,
  executionIdempotencyKey: r.execution_idempotency_key,
  recordVersion: r.record_version,
  invoiceNumber: r.invoice_number,
  workOrderId: r.work_order_id,
});

/** The predicate of a request that is live: pending, or approved and not paid out. */
const LIVE = `(rr.approval_state = 'pending' OR (rr.approval_state = 'approved' AND rr.executed_at IS NULL))`;

export class RefundRepository extends Repository {
  protected readonly module = 'billing';

  // -------------------------------------------------------------------------
  // Obligations, as a request needs them.
  // -------------------------------------------------------------------------

  /**
   * The obligation, with what has been paid out on it — locked `FOR UPDATE` when
   * `lock` is set, the lock every refund primitive takes first.
   */
  public async findObligation(
    db: DbHandle,
    obligationId: string,
    lock = false
  ): Promise<RefundObligationHeadRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      partner_id: string;
      invoice_id: string;
      currency_code: string;
      amount: string;
      state: string;
      record_version: number;
    }>(
      db,
      `SELECT ro.id, ro.company_id, ro.branch_id, ro.partner_id, ro.invoice_id, ro.currency_code,
              ro.amount::text AS amount, ro.state, ro.record_version
         FROM sal.refund_obligations ro
        WHERE ro.tenant_id = $1 AND ro.id = $2
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, obligationId]
    );
    if (!row) return null;
    const paid = await this.runOne<{ paid: string; still_owed: string }>(
      db,
      `SELECT p.paid::numeric(18,4)::text AS paid,
              ($5::numeric - p.paid)::numeric(18,4)::text AS still_owed
         FROM (SELECT COALESCE(sum(rr.amount), 0) AS paid
                 FROM sal.refund_requests rr
                WHERE rr.tenant_id = $1 AND rr.company_id = $2 AND rr.branch_id = $3
                  AND rr.obligation_id = $4 AND rr.approval_state = 'approved'
                  AND rr.executed_at IS NOT NULL) p`,
      [context.principal.tenantId, row.company_id, row.branch_id, row.id, row.amount]
    );
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      partnerId: row.partner_id,
      invoiceId: row.invoice_id,
      currencyCode: row.currency_code,
      amount: row.amount,
      state: row.state,
      recordVersion: row.record_version,
      paidOut: paid?.paid ?? '0.0000',
      stillOwed: paid?.still_owed ?? row.amount,
    };
  }

  /**
   * Whether `amount` fits within what is still owed on the obligation — its amount
   * less what has been paid out — compared by PostgreSQL in `numeric`.
   */
  public async fitsWithinObligation(
    db: DbHandle,
    obligation: RefundObligationHeadRow,
    amount: string
  ): Promise<boolean> {
    const row = await this.runOne<{ fits: boolean }>(
      db,
      `SELECT ($1::numeric <= $2::numeric - $3::numeric) AS fits`,
      [amount, obligation.amount, obligation.paidOut]
    );
    return row?.fits === true;
  }

  /** The live request of an obligation — pending, or approved and not paid out — or `null`. */
  public async findLiveRequest(
    db: DbHandle,
    obligation: { readonly id: string; readonly companyId: string; readonly branchId: string }
  ): Promise<RefundRequestRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<RefundRequestSql>(
      db,
      `SELECT ${REFUND_REQUEST_COLUMNS}
         FROM sal.refund_requests rr
        WHERE rr.tenant_id = $1 AND rr.company_id = $2 AND rr.branch_id = $3
          AND rr.obligation_id = $4 AND ${LIVE}
        ORDER BY rr.requested_at DESC, rr.id DESC
        LIMIT 1`,
      [context.principal.tenantId, obligation.companyId, obligation.branchId, obligation.id]
    );
    return row ? toRefundRequest(row) : null;
  }

  // -------------------------------------------------------------------------
  // Payment methods.
  // -------------------------------------------------------------------------

  /** A payment method of the caller's tenant, by id, or `null`. */
  public async findTenantMethod(db: DbHandle, methodId: string): Promise<RefundMethodRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      method_code: string;
      kind: string;
      display_name: string;
      active: boolean;
    }>(
      db,
      `SELECT pm.id, pm.method_code, pm.kind, pm.display_name,
              (pm.status = 'active' AND pm.deleted_at IS NULL) AS active
         FROM sal.payment_methods pm
        WHERE pm.tenant_id = $1 AND pm.id = $2`,
      [context.principal.tenantId, methodId]
    );
    return row
      ? {
          id: row.id,
          methodCode: row.method_code,
          kind: row.kind,
          displayName: row.display_name,
          active: row.active,
        }
      : null;
  }

  /** The tenant's payment methods by id, for naming them on a read. */
  public async methodsById(
    db: DbHandle,
    ids: readonly string[]
  ): Promise<ReadonlyMap<string, RefundMethodRow>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();
    const context = this.assertContext(db);
    const rows = await this.run<{
      id: string;
      method_code: string;
      kind: string;
      display_name: string;
      active: boolean;
    }>(
      db,
      `SELECT pm.id, pm.method_code, pm.kind, pm.display_name,
              (pm.status = 'active' AND pm.deleted_at IS NULL) AS active
         FROM sal.payment_methods pm
        WHERE pm.tenant_id = $1 AND pm.id = ANY($2::uuid[])`,
      [context.principal.tenantId, wanted]
    );
    return new Map(
      rows.rows.map((row) => [
        row.id,
        {
          id: row.id,
          methodCode: row.method_code,
          kind: row.kind,
          displayName: row.display_name,
          active: row.active,
        },
      ])
    );
  }

  // -------------------------------------------------------------------------
  // Requests.
  // -------------------------------------------------------------------------

  public async findRequest(
    db: DbHandle,
    requestId: string,
    lock = false
  ): Promise<RefundRequestRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<RefundRequestSql>(
      db,
      `SELECT ${REFUND_REQUEST_COLUMNS}
         FROM sal.refund_requests rr
        WHERE rr.tenant_id = $1 AND rr.id = $2
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, requestId]
    );
    return row ? toRefundRequest(row) : null;
  }

  /** The request a key already raised, in the caller's tenant, or `null`. */
  public async findRequestByIdempotencyKey(
    db: DbHandle,
    key: string
  ): Promise<RefundRequestRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<RefundRequestSql>(
      db,
      `SELECT ${REFUND_REQUEST_COLUMNS}
         FROM sal.refund_requests rr
        WHERE rr.tenant_id = $1 AND rr.idempotency_key = $2`,
      [context.principal.tenantId, key]
    );
    return row ? toRefundRequest(row) : null;
  }

  /** `sal.request_refund`: the id of the request raised, or answered for a repeated key. */
  public async requestRefund(
    db: DbHandle,
    input: {
      readonly obligationId: string;
      readonly amount: string;
      readonly paymentMethodId: string;
      readonly reason: string;
      readonly idempotencyKey: string | null;
    }
  ): Promise<string> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT sal.request_refund($1::uuid, $2::numeric, $3::uuid, $4::text, $5::text) AS id`,
      [input.obligationId, input.amount, input.paymentMethodId, input.reason, input.idempotencyKey]
    );
    /* c8 ignore next 3 -- the primitive returns an id or raises. */
    if (!row) throw new Error('sal.request_refund returned no row');
    return row.id;
  }

  public async approveRequest(db: DbHandle, requestId: string): Promise<void> {
    await this.run(db, `SELECT sal.approve_refund_request($1::uuid)`, [requestId]);
  }

  public async rejectRequest(db: DbHandle, requestId: string, reason: string): Promise<void> {
    await this.run(db, `SELECT sal.reject_refund_request($1::uuid, $2::text)`, [requestId, reason]);
  }

  public async withdrawRequest(db: DbHandle, requestId: string): Promise<void> {
    await this.run(db, `SELECT sal.withdraw_refund_request($1::uuid)`, [requestId]);
  }

  public async executeRequest(
    db: DbHandle,
    requestId: string,
    payout: {
      readonly paymentMethodId: string;
      readonly payoutReference: string;
      readonly payoutDate: string;
      readonly idempotencyKey: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<void> {
    await this.run(
      db,
      `SELECT sal.execute_refund_request($1::uuid, $2::uuid, $3::text, $4::date, $5::text, $6::uuid)`,
      [
        requestId,
        payout.paymentMethodId,
        payout.payoutReference,
        payout.payoutDate,
        payout.idempotencyKey,
        payout.correlationId,
      ]
    );
  }

  /** The day on the database's clock, as `YYYY-MM-DD` — what a payout date is checked against. */
  public async today(db: DbHandle): Promise<string> {
    const row = await this.runOne<{ today: string }>(db, `SELECT current_date::text AS today`);
    /* c8 ignore next -- current_date always answers. */
    return row?.today ?? '';
  }

  /**
   * One branch's refund requests, newest first (`sal.refund-request-list`), narrowed
   * by customer, invoice, obligation and the reader's state.
   */
  public async listRequests(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly partnerId?: string | undefined;
      readonly invoiceId?: string | undefined;
      readonly obligationId?: string | undefined;
      readonly state?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<RefundRequestRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.partnerId ?? null,
      filter.invoiceId ?? null,
      filter.obligationId ?? null,
      filter.state ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'rr.requested_at', id: 'rr.id' },
      REFUND_REQUEST_ORDER,
      values.length + 1
    );
    const result = await this.run<RefundRequestSql & { sort_value: string }>(
      db,
      `SELECT ${REFUND_REQUEST_COLUMNS},
              ${cursorTimestamp('rr.requested_at')} AS sort_value
         FROM sal.refund_requests rr
        WHERE rr.tenant_id = $1 AND rr.company_id = $2 AND rr.branch_id = $3
          AND ($4::uuid IS NULL OR rr.payee_partner_id = $4)
          AND ($5::uuid IS NULL OR rr.invoice_id = $5)
          AND ($6::uuid IS NULL OR rr.obligation_id = $6)
          AND ($7::text IS NULL
               OR ($7 = 'executed' AND rr.executed_at IS NOT NULL)
               OR ($7 <> 'executed' AND rr.executed_at IS NULL AND rr.approval_state = $7))
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toRefundRequest(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      REFUND_REQUEST_ORDER
    );
  }

  /** The minor units of currencies by code (Owner decision D1), as the billing reads stamp them. */
  public async minorUnitsFor(
    db: DbHandle,
    codes: readonly string[]
  ): Promise<ReadonlyMap<string, number>> {
    const wanted = [...new Set(codes)];
    if (wanted.length === 0) return new Map();
    const rows = await this.run<{ code: string; minor_unit: number }>(
      db,
      `SELECT code, minor_unit FROM shared.currencies WHERE code = ANY($1::text[])`,
      [wanted]
    );
    return new Map(rows.rows.map((row) => [row.code, row.minor_unit]));
  }
}
