/**
 * `sal` payment SQL (Phase 1-22 — `sal.payment-record`, `sal.payment-allocate`,
 * `sal.receipt-detail`, `sal.payment-method-list`).
 *
 * The only place payment SQL is written, and the only place the four protected
 * payment primitives are called. Four conventions hold without exception:
 *
 *  - **Every query carries an explicit `tenant_id` predicate** even though RLS
 *    already narrows, and an explicit `company_id`/`branch_id` predicate wherever
 *    those columns exist AND the caller has already established the pair. The two
 *    by-id anchor reads (`findReceipt`, `findReceiptForUpdate`) are the documented
 *    exception: their whole job is to *discover* the company and branch a receipt
 *    belongs to, so they cannot filter on the answer. Everything derived from a
 *    receipt afterwards — its unallocated balance, its allocation history — takes
 *    that discovered pair as bound predicates.
 *  - **`numeric` values are read and written as STRINGS.** Every money column here
 *    is `numeric(18,4)`; `pg@^8` returns OID 1700 as text and this repository never
 *    overrides that with `setTypeParser`. IEEE-754 cannot represent the fourth
 *    decimal place of every value a `numeric(18,4)` holds, and PostgreSQL silently
 *    *rounds* a fifth decimal away on the cast rather than erroring — so a value
 *    that has passed through a JavaScript `number` cannot be shown to be the value
 *    the caller sent.
 *  - **No sum is computed here.** `sal.receipt_unallocated` computes
 *    `round(amount − Σ allocations, 4)` in `numeric`, inside the database, and this
 *    file calls it. There is no TypeScript arithmetic on money anywhere in this
 *    module.
 *  - **An allocation is created by `sal.allocate_receipt` and by nothing else.**
 *    See `allocateReceipt` below: this is not a style preference, it is the only
 *    defence BR-SAL-002 has.
 *
 * ## Two structural facts about the protected schema that shape this file
 *
 * **`fk_receipts_method` is `(tenant_id, payment_method_id) → sal.payment_methods
 * (tenant_id, id)`, and a platform method row has `tenant_id IS NULL`.** Under
 * MATCH SIMPLE both referencing columns are NOT NULL, so the referenced row must
 * match on both — and no row whose `tenant_id` is NULL can equal a concrete tenant.
 * The three seeded platform methods (`cash`, `card_terminal`, `bank_transfer`) are
 * therefore **visible to every tenant and citable by no receipt**: recording
 * against one raises `23503`, not a business refusal. The repository's own P1-11
 * database fixture records the same conclusion beside its tenant-method insert.
 * `listPaymentMethods` consequently reports `recordable` per row rather than
 * pretending the platform catalogue is a set of choices.
 *
 * **`sal.receipts` is gated WHOLE-ROW by `iam.has_permission('sal.finance.view')`
 * on SELECT, INSERT and UPDATE.** A caller without it sees zero receipts, not
 * redacted ones, so there is no honest "receipts without amounts" projection to
 * build and none is built. The same gate is on `sal.payment_allocations`.
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
import { assertAllocationUsesPrimitive } from '../domain/payments';

/**
 * The one SQLSTATE the payment primitives raise that `@/server/db/repository`'s
 * `SQLSTATE` table does not name — matched by code, never by message text, because
 * driver messages are not a contract and this is.
 *
 * `no_data_found` arrives from three different places with three different meanings:
 * `shared.next_display_number` when the `'receipt'` sequence is not provisioned for a
 * `(company, branch)` (SB3 / `P1-22-L-03`), and `sal.allocate_receipt` twice — once
 * when the receipt is out of scope and once when the invoice is not in the receipt's
 * scope. It is therefore deliberately NOT mapped centrally: each call site maps it
 * itself, because the SQLSTATE alone cannot say which of the three happened and a
 * single mapping would report an unprovisioned number sequence as a missing receipt.
 *
 * Every other state these primitives raise is already in the foundation table:
 * `checkViolation` for every business refusal inside `sal.allocate_receipt`,
 * `foreignKeyViolation` for an unseeded currency or a platform payment method,
 * `uniqueViolation` for the `uq_financial_events_source` idempotency backstop, and
 * `insufficientPrivilege` for a `next_display_number` scope refusal.
 */
export const PAYMENT_SQLSTATE = {
  /** `RAISE … USING ERRCODE = 'no_data_found'`. */
  noDataFound: 'P0002',
} as const;

/**
 * The exact SQL that creates an allocation — a module-level constant so the
 * structural guard below can be applied to it at import time.
 */
const ALLOCATE_RECEIPT_SQL = `SELECT sal.allocate_receipt($1, $2, $3::numeric, $4) AS id`;

/**
 * Refuses to load this module if the allocation statement ever stops being the
 * primitive.
 *
 * This looks paranoid and is not. `app_runtime` genuinely holds raw `INSERT` on
 * `sal.payment_allocations`, and **no constraint, trigger or exclusion bounds
 * `Σ allocations`** — the grant exists and the guard does not. Over-allocation is
 * prevented *only* inside `sal.allocate_receipt`, under its receipt→invoice
 * `FOR UPDATE` lock order, so an edit that "simplified" the function call into a
 * direct insert on that table would be accepted by the database with no bound at all
 * and would silently delete the only enforcement of BR-SAL-002. Failing at import is
 * the loudest available answer.
 *
 * The prohibited statement is deliberately never written out in this file, not even
 * inside a comment: `tests/backend/p1-22-payment-allocation.test.ts` is expected to
 * scan this source for the literal, and a comment that quoted it would make an
 * otherwise-correct repository fail its own structural check — or, worse, teach the
 * next reader to relax the check until the comment passed.
 */
assertAllocationUsesPrimitive(ALLOCATE_RECEIPT_SQL);

/**
 * One payment method, as `sal.payment_methods` stores it.
 *
 * `tenantId` is `null` exactly when `scope = 'platform'`
 * (`ck_payment_methods_scope_tenant`), and that null is what makes the row
 * unciteable by a receipt — see the file header.
 */
export interface PaymentMethodRow {
  readonly id: string;
  readonly scope: string;
  readonly tenantId: string | null;
  readonly methodCode: string;
  readonly kind: string;
  readonly displayName: string;
  readonly status: string;
  /**
   * Selected so the two readers can disagree about it deliberately.
   *
   * `listPaymentMethods` filters soft-deleted rows out — a withdrawn method is not
   * an option. `findPaymentMethod` does not, because a receipt that already cites a
   * since-withdrawn method still has to render its own method name, and a detail read
   * that returned `null` there would lose information the row still holds. The write
   * path refuses it explicitly instead.
   */
  readonly deletedAt: Date | null;
  readonly recordVersion: number;
}

/**
 * One receipt header.
 *
 * `receivedBy` is deliberately **not** selected. `sal.record_receipt` stamps it
 * from `iam.current_user_id()`, so it is never a client input and never a client
 * output either — who took the money is a question for the audit trail, which
 * records the acting principal for every `sal.receipt.recorded` entry.
 */
export interface ReceiptRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  /** Opaque text from `shared.next_display_number`. Never parsed, formatted or sorted by. */
  readonly receiptNumber: string;
  readonly paymentMethodId: string;
  readonly payerPartnerId: string;
  readonly currencyCode: string;
  /** `numeric(18,4)` as an exact decimal STRING, `CHECK (amount > 0)`. */
  readonly amount: string;
  readonly receivedAt: Date;
  readonly evidenceDocumentVersionId: string | null;
  readonly status: string;
  readonly idempotencyKey: string | null;
  /**
   * Selected, not filtered on.
   *
   * `sal.receipt_unallocated` and `sal.record_receipt`'s idempotency lookup both
   * ignore `deleted_at`, so a repository that filtered it here would disagree with
   * the primitives it calls: the derivation would still count a soft-deleted
   * receipt's allocations while this file claimed the receipt did not exist. The
   * refusal is made once, explicitly, in the service instead.
   */
  readonly deletedAt: Date | null;
  readonly recordVersion: number;
}

/**
 * One receipt as the list renders it (Phase 1-30 A2, seam S-11).
 *
 * `ReceiptRow` plus the derived remainder, so a page answers "what is still
 * outstanding on this receipt" without a second call per row. The remainder is
 * `sal.receipt_unallocated(id)` - the SAME primitive `receiptUnallocated` calls,
 * applied per row inside one statement rather than re-implemented as a join and
 * a SUM. Nothing here stores or caches a balance.
 */
export interface ReceiptListRow extends ReceiptRow {
  /** `round(amount - sum(allocations), 4)` as a STRING. 0 for a reversed receipt. */
  readonly unallocated: string;
}

/** `sal.receipt_unallocated` plus the currency that labels it. */
export interface ReceiptUnallocatedRow {
  readonly receiptId: string;
  /** `round(amount − Σ allocations, 4)` as a STRING. 0 for a reversed receipt. */
  readonly unallocated: string;
  readonly currencyCode: string;
  readonly status: string;
}

/**
 * One allocation. Append-only: `sal.payment_allocations` is granted SELECT and a raw
 * row-insert and no UPDATE or DELETE, so a row here is permanent history.
 *
 * There is no `record_version` column on this table and none is invented: the row
 * is immutable, so it has exactly one version and a field claiming otherwise would
 * be fiction. `allocatedBy` is omitted for the same reason `receivedBy` is.
 */
export interface PaymentAllocationRow {
  readonly id: string;
  /** `GENERATED ALWAYS AS IDENTITY` — a strict total order `allocated_at` is not. */
  readonly seq: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly currencyCode: string;
  readonly amount: string;
  readonly allocatedAt: Date;
  readonly correlationId: string | null;
}

const PAYMENT_METHOD_COLUMNS = `id, scope, tenant_id, method_code, kind, display_name, status,
  deleted_at, record_version`;

/**
 * Receipts are listed newest-first by `received_at` (Phase 1-30 A2, S-11).
 *
 * `received_at` and not `created_at`: it is the business instant the money
 * arrived, it is frozen by `sal.guard_receipt_freeze`, and it is the column
 * `ix_receipts_payer_date` already orders on. `receipt_number` is explicitly NOT
 * a sort key - `ReceiptRow` records that it is opaque text from
 * `shared.next_display_number`, never parsed, formatted or sorted by.
 *
 * The key is qualified so a cursor minted here cannot be replayed against
 * another list.
 */
export const RECEIPT_ORDER: OrderingContract = Object.freeze({
  key: 'sal.receipts:received_at_desc',
  direction: 'desc',
});

const RECEIPT_COLUMNS = `id, company_id, branch_id, receipt_number, payment_method_id,
  payer_partner_id, currency_code, amount, received_at, evidence_document_version_id, status,
  idempotency_key, deleted_at, record_version`;

interface PaymentMethodSql {
  id: string;
  scope: string;
  tenant_id: string | null;
  method_code: string;
  kind: string;
  display_name: string;
  status: string;
  deleted_at: Date | null;
  record_version: number;
}

interface ReceiptSql {
  id: string;
  company_id: string;
  branch_id: string;
  receipt_number: string;
  payment_method_id: string;
  payer_partner_id: string;
  currency_code: string;
  amount: string;
  received_at: Date;
  evidence_document_version_id: string | null;
  status: string;
  idempotency_key: string | null;
  deleted_at: Date | null;
  record_version: number;
}

interface PaymentAllocationSql {
  id: string;
  seq: string;
  company_id: string;
  branch_id: string;
  receipt_id: string;
  invoice_id: string;
  currency_code: string;
  amount: string;
  allocated_at: Date;
  correlation_id: string | null;
}

const toPaymentMethod = (r: PaymentMethodSql): PaymentMethodRow => ({
  id: r.id,
  scope: r.scope,
  tenantId: r.tenant_id,
  methodCode: r.method_code,
  kind: r.kind,
  displayName: r.display_name,
  status: r.status,
  deletedAt: r.deleted_at,
  recordVersion: r.record_version,
});

const toReceipt = (r: ReceiptSql): ReceiptRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  receiptNumber: r.receipt_number,
  paymentMethodId: r.payment_method_id,
  payerPartnerId: r.payer_partner_id,
  currencyCode: r.currency_code,
  amount: r.amount,
  receivedAt: r.received_at,
  evidenceDocumentVersionId: r.evidence_document_version_id,
  status: r.status,
  idempotencyKey: r.idempotency_key,
  deletedAt: r.deleted_at,
  recordVersion: r.record_version,
});

const toAllocation = (r: PaymentAllocationSql): PaymentAllocationRow => ({
  id: r.id,
  seq: r.seq,
  companyId: r.company_id,
  branchId: r.branch_id,
  receiptId: r.receipt_id,
  invoiceId: r.invoice_id,
  currencyCode: r.currency_code,
  amount: r.amount,
  allocatedAt: r.allocated_at,
  correlationId: r.correlation_id,
});

/** The scope pair a receipt was found in, passed back as predicates on derived reads. */
export interface ReceiptScope {
  readonly companyId: string;
  readonly branchId: string;
}

export class PaymentsRepository extends Repository {
  protected readonly module = 'payments';

  // -------------------------------------------------------------------------
  // `sal.payment-method-list` — reference data discovery.
  // -------------------------------------------------------------------------

  /**
   * Lists the active payment methods visible to the caller's tenant.
   *
   * The predicate `(scope = 'platform' OR tenant_id = $1)` mirrors
   * `sel_payment_methods_scope` exactly, and it is the one place in this module
   * where "explicit tenant predicate" cannot mean `tenant_id = $1`: a platform row
   * has `tenant_id IS NULL` by `ck_payment_methods_scope_tenant`, so an equality
   * predicate alone would return nothing but the tenant's own rows and hide the
   * platform catalogue that RLS deliberately shows.
   *
   * `sal.payment_methods` has **no `company_id` and no `branch_id` column at all**,
   * which is why this is the one tenant-scoped operation in the module — there is
   * no narrower scope to authorize against, and inventing a branch filter would be
   * decorative.
   *
   * Unlike `WorkOrderCatalogRepository.workOrderStates`, this does **not** collapse
   * a shadowed code with `DISTINCT ON`. There, `code` is the key other rows
   * reference and a tenant row legitimately supersedes a platform row. Here the
   * referenced key is `id`, a platform `id` can be referenced by nothing, and the
   * two rows differ in the one property the caller has to act on — so hiding either
   * would hide the decision.
   *
   * Unbounded, deliberately: three platform rows plus a tenant's own handful of
   * methods is closed reference data, the same judgement `workOrderStates` makes.
   */
  public async listPaymentMethods(db: DbHandle): Promise<readonly PaymentMethodRow[]> {
    const context = this.assertContext(db);
    const rows = await this.run<PaymentMethodSql>(
      db,
      `SELECT ${PAYMENT_METHOD_COLUMNS}
         FROM sal.payment_methods
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND status = 'active'
          AND deleted_at IS NULL
        ORDER BY (scope = 'tenant') DESC, method_code ASC, id ASC`,
      [context.principal.tenantId]
    );
    return rows.rows.map(toPaymentMethod);
  }

  /**
   * Reads one payment method, for validation before a receipt cites it.
   *
   * Called BEFORE `sal.record_receipt` so that an inactive method, a method outside
   * the closed `kind` vocabulary, or a platform-scoped method becomes a controlled
   * refusal naming the reason, instead of `23503` from `fk_receipts_method` — which
   * says "this row does not exist" about a row the caller can plainly see.
   *
   * Also the resolver for the receipt detail read, which is why `deleted_at` is
   * returned rather than filtered — see `PaymentMethodRow.deletedAt`.
   */
  public async findPaymentMethod(db: DbHandle, methodId: string): Promise<PaymentMethodRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<PaymentMethodSql>(
      db,
      `SELECT ${PAYMENT_METHOD_COLUMNS}
         FROM sal.payment_methods
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND id = $2`,
      [context.principal.tenantId, methodId]
    );
    return row ? toPaymentMethod(row) : null;
  }

  // -------------------------------------------------------------------------
  // Receipt anchor reads.
  // -------------------------------------------------------------------------

  /**
   * Reads a receipt by id. **The scope anchor**, and the documented exception to
   * the company/branch predicate rule.
   *
   * A receipt names its own `company_id` and `branch_id`, and this read exists to
   * find out which — so it cannot filter on them. What it does instead is return
   * them, which is what lets the service call `authorizeScope` with a concrete
   * target and have `iam.has_permission_in_scope` evaluate for real. Without that
   * pair, `scope: 'branch'` on an id-addressed route is inert and RLS is the only
   * barrier — and RLS narrows on `iam.allowed_branch_ids()`, the **permission-blind
   * union of every active grant** (P1-18-A-01). Every derived read below takes the
   * returned pair as bound predicates.
   */
  public async findReceipt(db: DbHandle, receiptId: string): Promise<ReceiptRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ReceiptSql>(
      db,
      `SELECT ${RECEIPT_COLUMNS}
         FROM sal.receipts
        WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, receiptId]
    );
    return row ? toReceipt(row) : null;
  }

  /**
   * Reads a receipt and LOCKS it, preserving the primitive's own lock order.
   *
   * `sal.allocate_receipt` takes `FOR UPDATE` on the **receipt first and the invoice
   * second** (H-fin-2, stated in the migration comment). Any lock the application
   * takes on the way to that call must respect the same order or two concurrent
   * allocations against the same receipt/invoice pair can deadlock. This is the
   * receipt half, taken before the invoice header is resolved through
   * `@/modules/billing`, so the order is receipt → invoice on the application path
   * too.
   *
   * The lock is not decoration: the allocation bound is checked against
   * `sal.receipt_unallocated`, which is `STABLE` and therefore a snapshot read. Two
   * requests each allocating half of a receipt's remainder would both pass an
   * unlocked pre-check. The primitive re-checks inside its own lock and is the
   * authority; taking the lock here means the application's advisory check and the
   * primitive's authoritative one see the same row rather than racing each other.
   */
  /**
   * The currency's minor unit, so an inbound amount can be refused for being more
   * precise than the money it is denominated in.
   *
   * `shared.currencies` is reference data: `sel_currencies_all` is `true` and
   * `app_runtime` holds SELECT, so this needs no permission and no scope. `null` means
   * the platform does not support the code, which the caller reports rather than
   * silently falling back to the column's four decimal places.
   */
  public async minorUnitForCurrency(db: DbHandle, code: string): Promise<number | null> {
    const row = await this.runOne<{ minor_unit: number }>(
      db,
      `SELECT minor_unit FROM shared.currencies WHERE code = $1`,
      [code]
    );
    return row ? row.minor_unit : null;
  }

  public async findReceiptForUpdate(db: DbHandle, receiptId: string): Promise<ReceiptRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ReceiptSql>(
      db,
      `SELECT ${RECEIPT_COLUMNS}
         FROM sal.receipts
        WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
      [context.principal.tenantId, receiptId]
    );
    return row ? toReceipt(row) : null;
  }

  /**
   * Finds the receipt an idempotency key already produced, if any.
   *
   * Called BEFORE `sal.record_receipt`, because the primitive resolves a replay
   * internally and returns the existing id — correct, but from the outside
   * indistinguishable from a fresh receipt, so a retrying client could not tell
   * whether it had just consumed a second receipt number. Looking the key up first
   * makes the replay reportable and makes a same-key/different-request a conflict
   * rather than a silent success under someone else's receipt.
   *
   * `uq_receipts_idempotency` is `(tenant_id, idempotency_key)` and is **tenant-wide,
   * not branch-scoped** — so this lookup is tenant-scoped by the constraint's own
   * shape, and the service must compare the found receipt's company and branch
   * against the requested ones rather than assume they match.
   *
   * `deleted_at` is deliberately not filtered: this query mirrors the primitive's
   * own lookup, which does not filter it either, and a pre-check that disagreed
   * with the primitive it guards would be worse than no pre-check.
   */
  public async findReceiptByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<ReceiptRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ReceiptSql>(
      db,
      `SELECT ${RECEIPT_COLUMNS}
         FROM sal.receipts
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? toReceipt(row) : null;
  }

  // -------------------------------------------------------------------------
  // Derived reads — company and branch are bound predicates here.
  // -------------------------------------------------------------------------

  /**
   * The receipt's unallocated remainder, computed by PostgreSQL in `numeric`.
   *
   * `sal.receipt_unallocated` returns `round(amount − Σ allocations, 4)`, or `0` for
   * a missing receipt **and for a reversed one**. Those two zeros are
   * indistinguishable in the scalar, which is why `status` comes back beside it: a
   * caller told "0 remaining" about a reversed receipt would reasonably conclude it
   * was fully allocated. The currency comes from the receipt header because the
   * function returns a bare `numeric` — every amount this module hands out is
   * labelled with the currency that gives it meaning.
   *
   * `company_id` and `branch_id` are predicates, not options. The function itself
   * takes only an id and applies no scope predicate of its own beyond RLS, so
   * pinning the pair the caller was authorized for is what stops a receipt id from
   * reaching past that pair — `iam.has_permission_in_scope` is satisfied by company
   * **OR** branch, so authorization alone does not make the pair coherent (H6).
   */
  /**
   * A branch's receipts, newest first (Phase 1-30 A2, seam S-11).
   *
   * ## Why this did not already exist
   *
   * The module surface recorded a deliberate refusal to list receipts: because
   * `sel_receipts_gated` gates the WHOLE ROW on `sal.finance.view`, a caller
   * without that code sees zero rows rather than redacted ones, so there is no
   * honest amount-free projection to publish. That reasoning is intact and this
   * read does not contradict it - `sal.receipt-list` DECLARES `sal.finance.view`,
   * the same code the sibling `sal.receipt-detail` declares, so every caller that
   * reaches this query is one the policy already serves whole rows to. What was
   * refused was a list for callers who cannot hold the code; that is still
   * refused, by the policy itself.
   *
   * ## Scope
   *
   * `company_id` and `branch_id` are bound predicates and the caller has already
   * authorized them. The policy's scope arms narrow on `iam.allowed_branch_ids()`,
   * the permission-blind union of every active grant, so without the explicit
   * predicate a caller holding `sal.finance.view` anywhere would read receipts in
   * every branch they hold any grant in (P1-18-A-01).
   *
   * ## `deleted_at`
   *
   * Filtered here, unlike `findReceipt` above. That read cannot filter it because
   * the primitives it feeds ignore `deleted_at` and the two would disagree; a
   * list feeds no primitive, so the only truthful answer is to omit rows the
   * tenant has deleted rather than publish them and let the caller guess.
   */
  public async listReceipts(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly payerPartnerId?: string | undefined;
      readonly status?: string | undefined;
      readonly invoiceId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<ReceiptListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.payerPartnerId ?? null,
      filter.status ?? null,
      filter.invoiceId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'r.received_at', id: 'r.id' },
      RECEIPT_ORDER,
      values.length + 1
    );
    const rows = await this.run<ReceiptSql & { unallocated: string; sort_value: string }>(
      db,
      // `invoiceId` is an EXISTS over `sal.payment_allocations` rather than a JOIN:
      // a receipt may allocate to the same invoice more than once, and a join would
      // return that receipt twice on one page - a duplicate the keyset would then
      // page across.
      `SELECT ${RECEIPT_COLUMNS},
              sal.receipt_unallocated(r.id)::text AS unallocated,
              ${cursorTimestamp('r.received_at')} AS sort_value
         FROM sal.receipts r
        WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
          AND r.deleted_at IS NULL
          AND ($4::uuid IS NULL OR r.payer_partner_id = $4)
          AND ($5::text IS NULL OR r.status = $5)
          AND ($6::uuid IS NULL OR EXISTS (
                SELECT 1 FROM sal.payment_allocations a
                 WHERE a.tenant_id = r.tenant_id
                   AND a.receipt_id = r.id
                   AND a.invoice_id = $6))
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      rows.rows.map((row) => ({
        item: { ...toReceipt(row), unallocated: row.unallocated },
        // Microsecond precision from SQL. A JS `Date` truncates to milliseconds
        // and silently skips rows sharing the boundary row's millisecond
        // (`P1-27-INT-006`); receipts recorded in one transaction share
        // `transaction_timestamp()` exactly.
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      RECEIPT_ORDER
    );
  }

  public async receiptUnallocated(
    db: DbHandle,
    receiptId: string,
    scope: ReceiptScope
  ): Promise<ReceiptUnallocatedRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      receipt_id: string;
      unallocated: string;
      currency_code: string;
      status: string;
    }>(
      db,
      `SELECT r.id AS receipt_id,
              sal.receipt_unallocated(r.id)::text AS unallocated,
              r.currency_code,
              r.status
         FROM sal.receipts r
        WHERE r.tenant_id = $1 AND r.id = $2 AND r.company_id = $3 AND r.branch_id = $4`,
      [context.principal.tenantId, receiptId, scope.companyId, scope.branchId]
    );
    return row
      ? {
          receiptId: row.receipt_id,
          unallocated: row.unallocated,
          currencyCode: row.currency_code,
          status: row.status,
        }
      : null;
  }

  /**
   * The allocation history of one receipt, oldest first.
   *
   * Ordered by `seq`, which is `GENERATED ALWAYS AS IDENTITY` and therefore a strict
   * total order that `allocated_at` is not: two allocations posted inside one
   * transaction share `now()` to the microsecond, so a timestamp order would be
   * arbitrary between them.
   *
   * Bounded by an explicit `LIMIT` and fetched with one row of headroom, so the
   * caller can be told the history was truncated rather than shown a silently short
   * list. A receipt may legally allocate to the same invoice more than once and to
   * many invoices, so this list has no natural ceiling.
   */
  public async listAllocations(
    db: DbHandle,
    receiptId: string,
    scope: ReceiptScope,
    limit: number
  ): Promise<readonly PaymentAllocationRow[]> {
    const context = this.assertContext(db);
    const rows = await this.run<PaymentAllocationSql>(
      db,
      `SELECT id, seq::text AS seq, company_id, branch_id, receipt_id, invoice_id,
              currency_code, amount, allocated_at, correlation_id
         FROM sal.payment_allocations
        WHERE tenant_id = $1 AND receipt_id = $2 AND company_id = $3 AND branch_id = $4
        ORDER BY seq ASC
        LIMIT $5`,
      [context.principal.tenantId, receiptId, scope.companyId, scope.branchId, limit + 1]
    );
    return rows.rows.map(toAllocation);
  }

  // -------------------------------------------------------------------------
  // Mutations — both are calls into a protected primitive.
  // -------------------------------------------------------------------------

  /**
   * Records a receipt through `sal.record_receipt`.
   *
   * The primitive owns four things this file must not duplicate: it stamps the
   * tenant from `iam.current_tenant_id()` and the cashier from
   * `iam.current_user_id()` (so neither is a parameter and `receivedBy` is not a
   * client field), it allocates the receipt number from
   * `shared.next_display_number('receipt', company, branch)` — with `'receipt'`
   * **hard-coded inside the function**, unlike the invoice path which resolves a
   * configurable `sequence_code` — it resolves an idempotency replay by returning
   * the receipt that already exists, and it writes the `receipt_recorded`
   * `sal.financial_events` row that `tg_receipts_event_completeness` requires. This
   * module writes no financial event of its own; the deferred completeness
   * constraint trigger would abort the transaction if the primitive were bypassed.
   *
   * The amount is bound as an exact decimal STRING and cast in SQL. Passing a
   * JavaScript number here would be the one place in the module where a
   * `numeric(18,4)` could lose a digit, and it would lose it silently.
   */
  public async recordReceipt(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly paymentMethodId: string;
      readonly payerPartnerId: string;
      readonly currencyCode: string;
      /** Exact decimal string. Never a number. */
      readonly amount: string;
      readonly evidenceDocumentVersionId: string | null;
      readonly idempotencyKey: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly id: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT sal.record_receipt($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9) AS id`,
      [
        input.companyId,
        input.branchId,
        input.paymentMethodId,
        input.payerPartnerId,
        input.currencyCode,
        input.amount,
        input.evidenceDocumentVersionId,
        input.idempotencyKey,
        input.correlationId,
      ]
    );
    if (!row?.id) throw new Error('payments: sal.record_receipt returned no id');
    return { id: row.id };
  }

  /**
   * Allocates part or all of a receipt to an invoice through `sal.allocate_receipt`.
   *
   * **There is no direct-write path here, and there must never be one.**
   * `app_runtime` holds a raw row-insert grant on the allocation table, and the schema
   * carries no constraint, no trigger and no exclusion bounding `Σ allocations` —
   * the grant exists and the guard does not. Every bound BR-SAL-002 depends on
   * (`amount > 0`, `amount ≤ sal.receipt_unallocated`,
   * `amount ≤ sal.invoice_open_receivable`), the receipt→invoice `FOR UPDATE` lock
   * order, the currency equality between receipt and invoice, the
   * `issued | credited` invoice-status gate, the same-`(tenant, company, branch)`
   * requirement, the `payment_allocated` financial event, and the receipt's
   * re-summed `partially_allocated | allocated` status all live **inside that one
   * function**. `assertAllocationUsesPrimitive` is applied to this statement at
   * module load so the property cannot be edited away quietly.
   *
   * The amount is a STRING bound parameter cast with `$3::numeric` — see
   * `recordReceipt`.
   */
  public async allocateReceipt(
    db: DbHandle,
    receiptId: string,
    invoiceId: string,
    amount: string,
    correlationId: string | null
  ): Promise<{ readonly id: string }> {
    const row = await this.runOne<{ id: string }>(db, ALLOCATE_RECEIPT_SQL, [
      receiptId,
      invoiceId,
      amount,
      correlationId,
    ]);
    if (!row?.id) throw new Error('payments: sal.allocate_receipt returned no id');
    return { id: row.id };
  }

  /**
   * Reads one allocation back after the primitive created it.
   *
   * `sal.allocate_receipt` returns the allocation id, and the event and audit
   * records need the row's own `company_id`, `branch_id`, `amount` and
   * `currency_code` — all of which the primitive derived from the locked receipt
   * rather than from anything the caller sent. Reading them back rather than
   * echoing the request is the difference between reporting what was written and
   * reporting what was asked for.
   *
   * The scope pair is still bound as predicates even though the row was created two
   * statements ago: the caller already holds the authorized pair, so there is no
   * reason for this read to be the one query in the file that could return a row from
   * outside it.
   */
  public async findAllocation(
    db: DbHandle,
    allocationId: string,
    scope: ReceiptScope
  ): Promise<PaymentAllocationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<PaymentAllocationSql>(
      db,
      `SELECT id, seq::text AS seq, company_id, branch_id, receipt_id, invoice_id,
              currency_code, amount, allocated_at, correlation_id
         FROM sal.payment_allocations
        WHERE tenant_id = $1 AND id = $2 AND company_id = $3 AND branch_id = $4`,
      [context.principal.tenantId, allocationId, scope.companyId, scope.branchId]
    );
    return row ? toAllocation(row) : null;
  }
}
