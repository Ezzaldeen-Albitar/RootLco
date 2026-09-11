/**
 * The billing module's REPORTING port (P1-31 prerequisite P-11, slice 4).
 *
 * ## Why a port and not a query in the reporting module
 *
 * `sal.invoices`, `sal.invoice_amounts` and `sal.credit_notes` are this module's
 * tables, so the SQL that selects and totals them lives here and the reporting
 * module asks for the answer. That is the same shape as `WorkOrderReportPort`,
 * `LaborReportPort` and `InventoryReportPort` on the three datasets before this
 * one.
 *
 * ## Why a separate class rather than a method on `BillingReadService`
 *
 * That service answers for ONE invoice at a time — a header, its lines, its
 * amounts and its open receivable — and its shapes are the invoice screen's. A
 * period report over many documents shares none of them, and a consumer should
 * depend on the one thing it needs. This class holds a single read.
 *
 * ## It performs NO authorization
 *
 * Deliberately, and stated so it is not mistaken for an omission. The caller —
 * `ReportRunService` — has already evaluated the dataset's declared read code
 * (`sal.finance.view`) against the company and branch it passes here, at the run
 * operation's branch scope, and refused the WHOLE report to a caller who lacks
 * it. RLS narrows the statements underneath, where `sal.invoice_amounts` and
 * `sal.receipts` are gated on the same code. A second, differently-shaped check
 * here would be a second definition of scope.
 *
 * The refusal has to happen where the permission is evaluated rather than where
 * a column is rendered, because a caller who could run this report without
 * `sal.finance.view` would get rows whose amounts RLS had emptied — and an
 * aggregate over amounts that were hidden is a confident zero, not an absence.
 * That is the defect D-4 names and the reason the whole report refuses.
 *
 * ## It resolves no names
 *
 * `payerPartnerId` travels as an id with no display name, exactly as
 * `BillingReadService` publishes it today. Naming the payer would mean reading
 * `crm.business_partners` — another module's table, and another module's read
 * code on the dataset's permission list. It is recorded as a named prerequisite
 * instead of being taken silently.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type {
  BillingRepository,
  InvoiceDocumentFilter,
  ReportDocumentPage,
} from '../data/billing-repository';

/**
 * One billing document of the reported period, as the reporting module
 * publishes it.
 *
 * `documentType` discriminates an invoice from a credit note. Every field the
 * other type has no equivalent for is NULL rather than zero: a zero amount is a
 * claim about money and an absent column is not.
 */
export interface InvoiceDocumentEntry {
  readonly documentType: 'invoice' | 'credit_note';
  readonly documentId: string;
  /** The invoice number; always null for a credit note, which has none. */
  readonly documentNumber: string | null;
  /** An ISO-8601 instant, serialised UTC exactly as every other read publishes one. */
  readonly documentDate: string;
  readonly payerPartnerId: string;
  readonly currencyCode: string;
  /** The invoice's `status`, or the credit note's `approval_state`. */
  readonly status: string;
  /** `gross_total` as an exact decimal string; null on a credit note. */
  readonly invoicedAmount: string | null;
  /** `sal.invoice_open_receivable` as an exact decimal string; null on a credit note. */
  readonly outstanding: string | null;
  /**
   * The microsecond-precision position this row occupies in the merged order.
   *
   * Published because the reporting module merges this stream with the payments
   * one and mints the page's cursor over the result: a cursor minted from the
   * JS `Date` in `documentDate` would silently skip every row sharing its
   * millisecond at a higher microsecond (`P1-27-INT-006`).
   */
  readonly sortValue: string;
}

/**
 * One currency's invoice totals over the WHOLE selection.
 *
 * PER CURRENCY and never across currencies: there is no exchange rate anywhere
 * in this platform, and a total spanning two currencies would be a number
 * nobody can name. Credit notes carry no total of their own — the report's
 * column list names no credit amount — and their effect is already inside
 * `outstanding`, which the database function computes.
 */
export interface InvoiceDocumentTotal {
  readonly currencyCode: string;
  /** Sum of the period's invoiced gross amounts, as an exact decimal string. */
  readonly invoiced: string;
  /** Sum of `sal.invoice_open_receivable` over the same invoices. */
  readonly outstanding: string;
}

export interface InvoiceDocumentSummary {
  readonly totals: readonly InvoiceDocumentTotal[];
  /**
   * The ordered documents, NOT a page: `hasMore` and the next cursor are decided
   * by the reporting module over the merged stream, because a sentinel taken
   * from one stream alone would answer for the wrong selection.
   */
  readonly documents: readonly InvoiceDocumentEntry[];
}

export class BillingReportPort extends ApplicationService {
  protected readonly module = 'billing';

  constructor(private readonly repository: BillingRepository) {
    super();
  }

  /**
   * The branch's invoices and approved credit notes in a period, newest first,
   * with the invoice totals of the whole selection per currency.
   *
   * `page.limit` rows at most, starting strictly after `page.after` in the
   * merged order the caller owns. Nothing is recomputed here: every amount is
   * the decimal string PostgreSQL produced, and `outstanding` is the database
   * function's own answer rather than a subtraction performed in TypeScript.
   */
  async invoiceDocuments(
    db: DbHandle,
    filter: InvoiceDocumentFilter,
    page: ReportDocumentPage
  ): Promise<InvoiceDocumentSummary> {
    const report = await this.repository.invoiceDocuments(db, filter, page);

    return {
      totals: report.totals.map((row) => ({
        currencyCode: row.currencyCode,
        invoiced: row.invoiced,
        outstanding: row.outstanding,
      })),
      documents: report.documents.map((row) => ({
        documentType: row.documentType,
        documentId: row.documentId,
        documentNumber: row.documentNumber,
        documentDate: row.documentDate.toISOString(),
        payerPartnerId: row.payerPartnerId,
        currencyCode: row.currencyCode,
        status: row.status,
        invoicedAmount: row.invoicedAmount,
        outstanding: row.outstanding,
        sortValue: row.sortValue,
      })),
    };
  }
}
