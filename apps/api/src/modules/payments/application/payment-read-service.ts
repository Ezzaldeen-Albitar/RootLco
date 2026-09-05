/**
 * Payment reads (Phase 1-22 — `sal.receipt-detail`, `sal.payment-method-list`).
 *
 * ## Why there is no receipt list, and no receipt without money
 *
 * `sal.receipts` and `sal.payment_allocations` are gated **whole-row** by
 * `iam.has_permission('sal.finance.view')` on SELECT — the policy is
 * `tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
 * AND …`, not a column mask. A caller without the permission sees **zero receipts,
 * not redacted ones**, so there is no honest "receipt list without amounts"
 * projection to build and none is built here.
 *
 * That is the exact opposite of the invoice header, which is ungated precisely so a
 * caller lacking `sal.finance.view` can see that an invoice exists without seeing
 * what it is for. The asymmetry is the schema's, not a policy decision made in this
 * file, and it is why `sal.receipt-detail` requires the permission where
 * `sal.invoice-detail` does not.
 *
 * ## Two scopes, because the two tables have two shapes
 *
 * `sal.receipts` carries `company_id` and `branch_id`, so the detail read
 * re-authorizes the operation against the concrete pair the row names. RLS alone
 * would not be enough: `iam.allowed_branch_ids()` is the **permission-blind union of
 * every active grant** (P1-18-A-01), so a principal holding `sal.finance.view` in one
 * branch would otherwise read receipts in any branch it merely has some grant in.
 *
 * `sal.payment_methods` has **no `company_id` and no `branch_id` column at all**, so
 * the method list is tenant-scoped and there is nothing to narrow it by. It takes no
 * `ScopeAuthorizer`, rather than taking one and calling it with an empty target — a
 * scope check with nothing to check would fail closed and make the operation
 * unreachable, and one that silently passed would be decoration.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_PAGE_SIZE, pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { moneyView, type MoneyView } from '@/modules/pricing';
import { RECEIPT_ORDER } from '../data/payments-repository';
import type {
  PaymentAllocationRow,
  PaymentMethodRow,
  PaymentsRepository,
  ReceiptListRow,
} from '../data/payments-repository';

/**
 * One payment method as the API renders it.
 *
 * `recordable` is the field that matters and it is not cosmetic.
 * `fk_receipts_method` resolves `(tenant_id, payment_method_id)` against
 * `sal.payment_methods (tenant_id, id)`, and `ck_payment_methods_scope_tenant` forces
 * a platform row's `tenant_id` to be NULL — so the three seeded platform methods are
 * visible to every tenant and **citable by no receipt**. Listing them as if they were
 * selectable options would make the list actively misleading: a client would offer
 * "Cash" and every attempt to use it would fail with a foreign-key violation. They
 * are still returned, because a tenant with no recordable method of a given kind
 * needs to see that the platform defines one and that its own row is missing — which
 * is a provisioning action, not something this phase can perform.
 *
 * `tenantId` is deliberately absent: it carries no information the caller does not
 * already have from `scope`, and it is the tenant's own id in every non-null case.
 */
export interface PaymentMethodView {
  readonly id: string;
  /** `platform` or `tenant` (`ck_payment_methods_scope`). */
  readonly scope: string;
  readonly methodCode: string;
  /** `cash`, `card_terminal` or `bank_transfer` — closed at three, no gateway. */
  readonly kind: string;
  readonly displayName: string;
  readonly status: string;
  /** True only for a tenant-scoped row: see the type comment. */
  readonly recordable: boolean;
}

/** One entry in a receipt's append-only allocation history. */
export interface ReceiptAllocationView {
  readonly id: string;
  /** `seq`, as a string — a `bigint` does not fit a JavaScript number. */
  readonly sequence: string;
  readonly invoiceId: string;
  readonly money: MoneyView;
  readonly allocatedAt: string;
}

/**
 * A receipt in full.
 *
 * Carries no `receivedBy` and no `allocatedBy`. `sal.record_receipt` and
 * `sal.allocate_receipt` stamp both from `iam.current_user_id()`, so neither is a
 * client input; who handled the money is a question the audit trail answers, and
 * echoing it into every read would spread a personal identifier further than the
 * operation needs. Carries no evidence document contents and no identity-document
 * contents: `evidenceDocumentVersionId` is a reference and nothing in this module
 * reads what it points at. There is no payment credential of any kind, because
 * `ck_payment_methods_kind` leaves no column one could live in.
 */
export interface ReceiptDetailView {
  readonly id: string;
  /**
   * The receipt's stable human reference — `sal.receipts.receipt_number`.
   *
   * Opaque text: no prefix or format exists in the schema or the seeds, so it is
   * never constructed, parsed, regex-validated or sorted by. Frozen by
   * `sal.guard_receipt_freeze`, so this is the same string on every read and a
   * replayed record never produces a second one.
   */
  readonly reference: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly payerPartnerId: string;
  readonly method: {
    readonly id: string;
    readonly scope: string;
    readonly kind: string;
    readonly displayName: string;
    readonly status: string;
  } | null;
  readonly money: MoneyView;
  /**
   * `sal.receipt_unallocated`, derived on every call — nothing stores a balance.
   *
   * `0` for a reversed receipt as well as for a fully allocated one, which is why
   * `status` is beside it: the scalar alone cannot tell those apart.
   */
  readonly unallocated: MoneyView;
  /** `recorded`, `partially_allocated`, `allocated` or `reversed`. */
  readonly status: string;
  readonly receivedAt: string;
  readonly evidenceDocumentVersionId: string | null;
  readonly recordVersion: number;
  readonly allocations: readonly ReceiptAllocationView[];
  /**
   * True when the receipt has more allocations than one response returns.
   *
   * A receipt may allocate to many invoices and to the same invoice more than once,
   * so the history has no natural ceiling. Reporting the truncation is the difference
   * between a bounded read and a silently incomplete one.
   */
  readonly allocationsTruncated: boolean;
}

const toPaymentMethodView = (row: PaymentMethodRow): PaymentMethodView => ({
  id: row.id,
  scope: row.scope,
  methodCode: row.methodCode,
  kind: row.kind,
  displayName: row.displayName,
  status: row.status,
  // Derived from the FK shape, not from a column. See `PaymentMethodView`.
  recordable: row.scope === 'tenant',
});

const toAllocationView = (row: PaymentAllocationRow): ReceiptAllocationView => ({
  id: row.id,
  sequence: row.seq,
  invoiceId: row.invoiceId,
  money: moneyView(row.amount, row.currencyCode),
  allocatedAt: row.allocatedAt.toISOString(),
});

/**
 * One receipt as the list renders it (Phase 1-30 A2, seam S-11).
 *
 * The detail's fields minus its allocation history. Both amounts are `MoneyView`
 * - an exact decimal STRING with the currency that labels it - because
 * `sal.receipts.amount` is `numeric(18,4)` and the remainder is PostgreSQL's own
 * `round(amount - sum(allocations), 4)`. Nothing is summed, netted or converted
 * in TypeScript, here or anywhere on the way to the caller.
 *
 * `unallocated` is `0` for a REVERSED receipt as well as for a fully allocated
 * one - `sal.receipt_unallocated` returns 0 early on `reversed`. `status` is
 * beside it for exactly that reason: the scalar alone cannot tell those apart,
 * and a screen that read the remainder without the status would show a reversed
 * receipt as settled.
 *
 * No `receivedBy`, for the reason `ReceiptDetailView` gives: it is stamped from
 * `iam.current_user_id()`, it is never a client input, and who handled the money
 * is a question the audit trail answers.
 */
export interface ReceiptListView {
  readonly id: string;
  /** `sal.receipts.receipt_number` - opaque text, never parsed or sorted by. */
  readonly reference: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly payerPartnerId: string;
  readonly method: {
    readonly id: string;
    readonly scope: string;
    readonly kind: string;
    readonly displayName: string;
    readonly status: string;
  } | null;
  readonly money: MoneyView;
  readonly unallocated: MoneyView;
  readonly status: string;
  readonly receivedAt: string;
  readonly evidenceDocumentVersionId: string | null;
  readonly recordVersion: number;
}

export class PaymentReadService {
  public constructor(private readonly repository: PaymentsRepository) {}

  /**
   * `sal.receipt-list` — a branch's receipts, newest first (P1-30 A2, seam S-11).
   *
   * ## Why this is class C and not a thin route
   *
   * There was no receipt list at any layer: `PaymentReadService` had exactly
   * `listPaymentMethods` and `readReceipt`, and `PaymentsRepository` had
   * single-row finders plus `listAllocations`. Query, projection, repository
   * method, service method and route are all new. The module surface also
   * recorded a deliberate refusal to list receipts, and that refusal is answered
   * rather than overridden: it rests on there being no honest projection for a
   * caller WITHOUT `sal.finance.view`, and this operation declares that code, so
   * the only callers it serves are ones `sel_receipts_gated` already hands whole
   * rows to.
   *
   * ## Scope
   *
   * `companyId` and `branchId` are required and authorized BEFORE any row is
   * read. The RLS policy's scope arms narrow on `iam.allowed_branch_ids()` - the
   * permission-blind union of every active grant - so `sal.finance.view` held in
   * one branch would otherwise read cash taken in every branch the caller has any
   * grant in (P1-18-A-01). Authorizing first also stops the empty/non-empty
   * difference from reporting whether a branch takes money at all.
   *
   * ## Method labels, in one query and not N
   *
   * `sal.payment_methods` is dual-scope reference data - three platform rows plus
   * the tenant's own - and `readReceipt` deliberately resolves it through the
   * repository rather than joining, so the `(scope = 'platform' OR tenant_id = ...)`
   * predicate is not copied into a second place. The same rule is kept here by
   * loading the whole method set ONCE per page and labelling rows from it: one
   * extra statement, not one per receipt, and still no second copy of the
   * predicate.
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
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<ReceiptListView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });

    const result = await this.repository.listReceipts(db, filter, pageRequest(RECEIPT_ORDER, page));
    const methods = new Map<string, PaymentMethodRow>(
      (await this.repository.listPaymentMethods(db)).map((row) => [row.id, row])
    );
    return {
      ...result,
      items: result.items.map((row) => this.toReceiptListView(row, methods)),
    };
  }

  private toReceiptListView(
    row: ReceiptListRow,
    methods: ReadonlyMap<string, PaymentMethodRow>
  ): ReceiptListView {
    const method = methods.get(row.paymentMethodId);
    return {
      id: row.id,
      reference: row.receiptNumber,
      companyId: row.companyId,
      branchId: row.branchId,
      payerPartnerId: row.payerPartnerId,
      // `null` when the method is not visible to this tenant rather than a
      // fabricated label. `readReceipt` renders the same absence the same way.
      method:
        method === undefined
          ? null
          : {
              id: method.id,
              scope: method.scope,
              kind: method.kind,
              displayName: method.displayName,
              status: method.status,
            },
      money: moneyView(row.amount, row.currencyCode),
      // Labelled with the receipt's OWN currency. A receipt has exactly one, so
      // no amount on this page is unlabelled and no two currencies are mixed.
      unallocated: moneyView(row.unallocated, row.currencyCode),
      status: row.status,
      receivedAt: row.receivedAt.toISOString(),
      evidenceDocumentVersionId: row.evidenceDocumentVersionId,
      recordVersion: row.recordVersion,
    };
  }

  /**
   * `sal.payment-method-list` — the methods a receipt may cite, and the ones it
   * may not.
   *
   * Tenant-scoped, because the table has no narrower scope. Bounded by the closed
   * reference data itself: three platform rows plus the tenant's own, which is the
   * same judgement `WorkOrderCatalogRepository.workOrderStates` makes about the
   * work-order state vocabulary.
   */
  public async listPaymentMethods(db: DbHandle): Promise<readonly PaymentMethodView[]> {
    const rows = await this.repository.listPaymentMethods(db);
    return rows.map(toPaymentMethodView);
  }

  /**
   * `sal.receipt-detail` — one receipt, its money, its method and its allocations.
   *
   * `sal.finance.view` is required by construction: without it the RLS policy on
   * `sal.receipts` returns no row and this reports `ERR-RES-001`, which is the
   * correct uniform answer — "not found within the resolved scope" is deliberately
   * indistinguishable from "exists but out of scope".
   *
   * The scope check runs against the pair the ROW names, immediately after the row
   * is loaded, for the reason set out in the file header.
   */
  public async readReceipt(
    db: DbHandle,
    receiptId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceiptDetailView> {
    const receipt = await this.repository.findReceipt(db, receiptId);
    if (!receipt || receipt.deletedAt !== null) {
      throw new AppFailure('ERR-RES-001', { message: `Receipt ${receiptId} was not found` });
    }
    await authorizeScope({ companyId: receipt.companyId, branchId: receipt.branchId });

    const scope = { companyId: receipt.companyId, branchId: receipt.branchId };
    const remainder = await this.repository.receiptUnallocated(db, receiptId, scope);
    if (!remainder) {
      // The receipt was found by tenant and id above, so a miss here means the
      // company/branch predicate did not match the row this read authorized — an
      // internal inconsistency rather than a client error.
      throw new AppFailure('ERR-SYS-001', {
        message: 'Receipt remainder read did not match the authorized scope',
      });
    }

    // One extra row is fetched so truncation is detectable without a COUNT.
    const allocationRows = await this.repository.listAllocations(
      db,
      receiptId,
      scope,
      MAX_PAGE_SIZE
    );
    const truncated = allocationRows.length > MAX_PAGE_SIZE;
    const allocations = truncated ? allocationRows.slice(0, MAX_PAGE_SIZE) : allocationRows;

    // The method is resolved through the same repository, never joined into the
    // receipt query: `sal.payment_methods` is dual-scope reference data whose
    // visibility predicate is `(scope = 'platform' OR tenant_id = …)`, and folding
    // that into a receipt join would put a second, easily-mistyped copy of the RLS
    // predicate in a second place.
    const method = await this.repository.findPaymentMethod(db, receipt.paymentMethodId);

    return {
      id: receipt.id,
      reference: receipt.receiptNumber,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      payerPartnerId: receipt.payerPartnerId,
      method:
        method === null
          ? null
          : {
              id: method.id,
              scope: method.scope,
              kind: method.kind,
              displayName: method.displayName,
              status: method.status,
            },
      money: moneyView(receipt.amount, receipt.currencyCode),
      // Both amounts are labelled with the receipt's own currency. `sal.receipts`
      // carries `currency_code` on the row, so no aggregate here is ever unlabelled
      // and no two currencies are ever mixed — there is nothing to mix, because a
      // receipt has exactly one.
      unallocated: moneyView(remainder.unallocated, remainder.currencyCode),
      status: receipt.status,
      receivedAt: receipt.receivedAt.toISOString(),
      evidenceDocumentVersionId: receipt.evidenceDocumentVersionId,
      recordVersion: receipt.recordVersion,
      allocations: allocations.map(toAllocationView),
      allocationsTruncated: truncated,
    };
  }
}
