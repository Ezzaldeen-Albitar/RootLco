/**
 * The payments module's REPORTING port (P1-31 prerequisite P-11, slice 4).
 *
 * ## Why a port and not a query in the reporting module
 *
 * `sal.receipts` and `sal.payment_allocations` are this module's tables, so the
 * SQL that selects and totals them lives here and the reporting module asks for
 * the answer. That is the same shape as `WorkOrderReportPort`, `LaborReportPort`
 * and `InventoryReportPort` on the three datasets before this one, and it is what
 * keeps the invoice half of this report out of `sal.payment_allocations` and this
 * half out of `sal.invoices`.
 *
 * ## Why a separate class rather than a method on `PaymentReadService`
 *
 * That service is the receipt screen's: its list is bounded by a payer or an
 * invoice, it publishes `sal.receipt_unallocated` on every row and its shapes
 * carry the allocation history. A period report shares none of them, and a
 * consumer should depend on the one thing it needs. This class holds a single
 * read.
 *
 * ## It performs NO authorization
 *
 * Deliberately, and stated so it is not mistaken for an omission. The caller —
 * `ReportRunService` — has already evaluated the dataset's declared read code
 * (`sal.finance.view`, which is the code `sal.receipt-detail` declares for the
 * same rows) against the company and branch it passes here, at the run
 * operation's branch scope, and refused the WHOLE report to a caller who lacks
 * it. `sal.receipts` is gated on that same code by RLS, WHOLE ROW, so a caller
 * who reached this far without it would receive an empty selection — and an
 * empty selection totalled is a confident zero rather than an absence. That is
 * the defect D-4 names, and the refusal above is the reason it cannot occur.
 *
 * ## It resolves no names, and that stays true
 *
 * The party travels as an id and a ROLE — `payer`, which is what the column
 * actually holds. The Owner's answer of 2026-09-12 asks for the permitted party
 * NAME beside the identifier, and the name is resolved by the reporting module
 * through `@/modules/crm`'s published read, which checks `crm.customer.read`
 * itself. Reading `crm.business_partners` from here would put another module's
 * table in this module's SQL, which is the thing the port exists to prevent.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type {
  PaymentsRepository,
  ReceiptDocumentFilter,
  ReportDocumentPage,
} from '../data/payments-repository';

/** One receipt of the reported period, as the reporting module publishes it. */
export interface ReceiptDocumentEntry {
  readonly documentId: string;
  /** The receipt number. `NOT NULL` in the table, so never absent. */
  readonly documentNumber: string;
  /** An ISO-8601 instant, serialised UTC exactly as every other read publishes one. */
  readonly documentDate: string;
  /**
   * The party the receipt names, as an id, and the ROLE it names them under:
   * `payer`. The party who paid is not necessarily the customer the work was
   * done for, and the report must not present the one as the other.
   */
  readonly partyId: string;
  readonly partyRole: 'payer';
  readonly currencyCode: string;
  /** `recorded`, `partially_allocated` or `allocated`. Never `reversed`. */
  readonly status: string;
  /** The receipt's own amount, as an exact decimal string. */
  readonly receiptAmount: string;
  /**
   * What this receipt has been applied to invoices, as an exact decimal string.
   *
   * A DISTINCT column from `receiptAmount` because the two are different facts: a
   * receipt may sit unallocated, may be split across invoices, and may allocate
   * more than once to the same one. Never larger than the receipt.
   */
  readonly allocatedAmount: string;
  /**
   * What this receipt has NOT yet been applied to any invoice, as an exact
   * decimal string.
   *
   * `sal.receipt_unallocated(id)` — the deployed authority, CALLED. Never
   * `receiptAmount − allocatedAmount` computed by a consumer: the function
   * rounds at scale 4 and answers `0` for a reversed receipt, and a second
   * derivation is how a report and the receipt screen come to state different
   * balances for one receipt.
   */
  readonly unallocatedAmount: string;
  /**
   * The microsecond-precision position this row occupies in the merged order.
   *
   * Published because the reporting module merges this stream with the billing
   * one and mints the page's cursor over the result: a cursor minted from the JS
   * `Date` in `documentDate` would silently skip every row sharing its
   * millisecond at a higher microsecond (`P1-27-INT-006`).
   */
  readonly sortValue: string;
}

/**
 * One currency's receipt totals over the WHOLE selection.
 *
 * PER CURRENCY and never across currencies: there is no exchange rate anywhere in
 * this platform, and a total spanning two currencies would be a number nobody can
 * name.
 */
export interface ReceiptDocumentTotal {
  readonly currencyCode: string;
  /** Sum of the period's receipts, excluding reversed ones. */
  readonly receipts: string;
  /** Sum of those receipts' allocations. */
  readonly allocated: string;
  /** Sum of `sal.receipt_unallocated` over the same receipts. */
  readonly unallocated: string;
}

export interface ReceiptDocumentSummary {
  readonly totals: readonly ReceiptDocumentTotal[];
  /**
   * The ordered documents, NOT a page: `hasMore` and the next cursor are decided
   * by the reporting module over the merged stream, because a sentinel taken from
   * one stream alone would answer for the wrong selection.
   */
  readonly documents: readonly ReceiptDocumentEntry[];
}

export class PaymentsReportPort extends ApplicationService {
  protected readonly module = 'payments';

  constructor(private readonly repository: PaymentsRepository) {
    super();
  }

  /**
   * The branch's receipts in a period, newest first, with the receipt totals of
   * the whole selection per currency.
   *
   * `page.limit` rows at most, starting strictly after `page.after` in the merged
   * order the caller owns. Nothing is recomputed here: every amount is the
   * decimal string PostgreSQL produced.
   */
  async receiptDocuments(
    db: DbHandle,
    filter: ReceiptDocumentFilter,
    page: ReportDocumentPage
  ): Promise<ReceiptDocumentSummary> {
    const report = await this.repository.receiptDocuments(db, filter, page);

    return {
      totals: report.totals.map((row) => ({
        currencyCode: row.currencyCode,
        receipts: row.receipts,
        allocated: row.allocated,
        unallocated: row.unallocated,
      })),
      documents: report.documents.map((row) => ({
        documentId: row.documentId,
        documentNumber: row.documentNumber,
        documentDate: row.documentDate.toISOString(),
        partyId: row.partyId,
        partyRole: row.partyRole,
        currencyCode: row.currencyCode,
        status: row.status,
        receiptAmount: row.receiptAmount,
        allocatedAmount: row.allocatedAmount,
        unallocatedAmount: row.unallocatedAmount,
        sortValue: row.sortValue,
      })),
    };
  }
}
