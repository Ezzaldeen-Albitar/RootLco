/**
 * Request bodies of the `sal` payment writes this application sends (P1-30
 * `W7`), mirrored field-for-field from the zod schemas in
 * `apps/api/src/app/api/v1/payments/**` so the P1-30 payload-parity gate can
 * hold them against the routes.
 *
 * ## Every amount is a decimal STRING, and the boundary is narrower than money
 *
 * Both routes declare their own `MoneyAmount` rather than the shared money
 * schema: unsigned, at most 14 integer digits and 4 decimals, matching
 * `numeric(18,4)` and the `CHECK > 0` on every payment instrument. A fifth
 * decimal is refused here because PostgreSQL would silently round it, and a
 * fifteenth integer digit because the cast would raise. Nothing is parsed into
 * a number on the way.
 *
 * ## Neither write is version-guarded
 *
 * No `If-Match` is sent and none is required. A refused allocation is a bound
 * the database decided, never a version conflict. Both are idempotent through
 * the transport key, so each opened form holds one key for its own retries.
 *
 * ## Recording and allocating are separate acts
 *
 * A receipt cannot name an invoice: `PaymentRecordBody` is `.strict()` and
 * carries no `invoiceId` or `allocations`. Money is taken first and applied
 * second, which is why a partial payment (FE-017) is the ordinary case rather
 * than an exception.
 */

/**
 * `sal.payment-record` — `POST /payments`. All six fields are required.
 * `paymentMethodId` must name a TENANT-scoped method: a platform row is
 * visible to every tenant and citable by no receipt, and the route refuses one
 * with 422 rather than letting the foreign key fail.
 */
export interface PaymentRecordBody {
  readonly companyId: string;
  readonly branchId: string;
  readonly paymentMethodId: string;
  readonly payerPartnerId: string;
  /** ISO-4217 alphabetic, upper case. */
  readonly currency: string;
  /** Unsigned decimal string, at most 14 integer digits and 4 decimals. */
  readonly amount: string;
}

/**
 * `sal.payment-allocate` — `POST /payments/{paymentId}/allocations`. The
 * receipt is the path; the currency must equal both the receipt's and the
 * invoice's, and the amount must fit inside the receipt's remainder AND the
 * invoice's open balance, both recomputed by the database under row locks.
 */
export interface PaymentAllocateBody {
  readonly invoiceId: string;
  /** Unsigned decimal string, at most 14 integer digits and 4 decimals. */
  readonly amount: string;
  /** ISO-4217 alphabetic, upper case. */
  readonly currency: string;
  /**
   * Only to apply the receipt to ANOTHER customer's invoice as a third-party
   * payment (ADR-023 D14); needs `sal.payment.third_party`. Without it such an
   * allocation is refused.
   */
  readonly thirdParty?: PaymentAllocateThirdPartyBody;
}

/** A third-party payer's statement (ADR-023 D14). */
export interface PaymentAllocateThirdPartyBody {
  /** `insurer`, `employer` or `other`. */
  readonly relationship: string;
  /** Not blank, at most 100 characters — the insurer's claim or approval number, say. */
  readonly authorisationReference: string;
  /** Not blank, at most 2000 characters; for `other`, what the payer is to the customer. */
  readonly reason: string;
}

/* ------------------------------------------------------------------ *
 * ADR-023 D4 — the receipt reversal and its replacement. Sent by the
 * receipt panel on `app/[locale]/(dashboard)/payments`.
 * ------------------------------------------------------------------ */

/**
 * `sal.receipt-reversal-request` — `POST /payments/{paymentId}/reversals`.
 * Idempotent; `If-Match` is the RECEIPT's `recordVersion`, required.
 *
 * The reason and nothing else: a reversal reverses the whole receipt, so its
 * amount and currency are the receipt's own and the route has no field for one.
 */
export interface ReceiptReversalRequestBody {
  /** One to two thousand characters, not blank. */
  readonly reason: string;
}

/**
 * `sal.receipt-reversal-reject` — `POST /receipt-reversals/{reversalId}/rejection`.
 * Idempotent; `If-Match` is the REVERSAL's `recordVersion`, required. The
 * approval and the withdrawal are bodyless.
 */
export interface ReceiptReversalRejectBody {
  /** One to two thousand characters, not blank. */
  readonly reason: string;
}

/**
 * `sal.receipt-replacement-record` — `POST /payments/{paymentId}/replacement`.
 * Idempotent through the transport key, not version-guarded. `PaymentRecordBody`
 * minus the company and branch, which are the reversed receipt's own.
 */
export interface ReceiptReplacementRecordBody {
  readonly paymentMethodId: string;
  readonly payerPartnerId: string;
  /** ISO-4217 alphabetic, upper case. */
  readonly currency: string;
  /** Unsigned decimal string, at most 14 integer digits and 4 decimals. */
  readonly amount: string;
}
