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
 * W6 mirrors these two writes. Credit notes belong to no P1-30 screen and the
 * payment writes to W7; they stay declared PENDING in the gate rather than
 * mirrored without a consumer.
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
