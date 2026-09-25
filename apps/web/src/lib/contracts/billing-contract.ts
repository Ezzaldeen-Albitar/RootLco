/**
 * Request bodies of the `sal` invoice writes this application sends (P1-30
 * `W6`), mirrored field-for-field from the zod schemas in
 * `apps/api/src/app/api/v1/invoices/**` so the P1-30 payload-parity gate can
 * hold them against the routes.
 *
 * ## No amount crosses here
 *
 * Creating an invoice names a work order and, at most, a payer; every figure
 * is derived by the database from the accepted quotation revision, and the
 * route refuses any amount, total, tax or line key with 422. Cancelling names
 * a reason. Issuing sends NO body at all — it is declared bodyless in the gate.
 *
 * ## Version guards
 *
 * Issue and cancel carry `If-Match` = the INVOICE's `recordVersion` from
 * `sal.invoice-detail`; create does not.
 *
 * W6 mirrors these two writes; the payment writes belong to W7. Raising a
 * credit note is mirrored below because the invoice screen raises one, and it
 * is the one write here that carries an amount: the credit the operator types,
 * as a decimal string. Approving a credit note sends no body and is declared
 * bodyless in the gate.
 */

/** `sal.invoice-create` — `POST /invoices`. Idempotent through the transport key; not version-guarded. */
export interface InvoiceCreateBody {
  readonly workOrderId: string;
  /** Used only when the accepted quotation names no payer; the quotation's payer always wins. */
  readonly payerPartnerId?: string;
}

/** `sal.invoice-cancel` — `POST /invoices/{invoiceId}/cancellation`. Draft only; `If-Match` required. */
export interface InvoiceCancelBody {
  /** One to two thousand characters, not blank. */
  readonly reason: string;
}

/**
 * `sal.credit-note-create` — `POST /invoices/{invoiceId}/credit-notes`.
 * Idempotent through the transport key; not version-guarded.
 *
 * The requester is the session and the note is born pending; it counts for
 * nothing until a different person approves it (`sal.credit-note-approve`,
 * bodyless). The server bounds the amount by the invoice's open receivable.
 */
export interface CreditNoteCreateBody {
  /** A decimal string, unsigned, at most fourteen integer digits and four decimals. */
  readonly amount: string;
  /** One to two thousand characters, not blank. */
  readonly reason: string;
  /**
   * The note's currency is always the invoice's. The route accepts this only to
   * refuse a caller that believes otherwise; the screen never sends it.
   */
  readonly currency?: string;
}

/* ------------------------------------------------------------------ *
 * P1-32 — the counter sale. Sent by the counter-sale screen under
 * `app/[locale]/(dashboard)/inventory/counter-sales`.
 * ------------------------------------------------------------------ */

/**
 * One line of `sal.counter-sale-create`: what was sold and where it comes off.
 *
 * No price, no total, no tax and no discount — the route's body is `.strict()`,
 * so there is no field through which a client-supplied amount could arrive.
 * Every line is priced inside the database from the item's configured selling
 * price, and an item with no configured price refuses the whole sale rather than
 * leaving at zero.
 */
export interface CounterSaleCreateLine {
  readonly itemId: string;
  readonly locationId: string;
  /** A decimal string, up to nine integer digits and three decimals. */
  readonly quantity: string;
}

/**
 * `sal.counter-sale-create` — `POST /counter-sales`. Creates a DRAFT invoice
 * with no work order; issuing it is `sal.invoice-issue`, which is what moves the
 * stock. The transport attaches the header key, derived once per confirmation.
 */
export interface CounterSaleCreateBody {
  readonly companyId: string;
  readonly branchId: string;
  /** The buyer: a partner of the selling tenant. No account is created for it. */
  readonly customerPartnerId: string;
  readonly lines: readonly CounterSaleCreateLine[];
}
