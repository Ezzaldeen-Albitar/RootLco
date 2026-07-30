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
import { MAX_PAGE_SIZE } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { moneyView, type MoneyView } from '@/modules/pricing';
import type {
  PaymentAllocationRow,
  PaymentMethodRow,
  PaymentsRepository,
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

export class PaymentReadService {
  public constructor(private readonly repository: PaymentsRepository) {}

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
