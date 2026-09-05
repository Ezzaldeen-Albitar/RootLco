/**
 * Request-payload mirror for the `inv.` (inventory) writes — P1-30, `W4`.
 *
 * Transcribed by hand for the reason `services-contract.ts` records, and
 * compared against the routes' zod schemas by `check-p1-30-payload-parity.mjs`.
 * One interface per operation, named by `typeNameFor`.
 *
 * ## Quantities are strings
 *
 * `quantity` is a decimal STRING (up to nine integer digits and three
 * decimals); a JSON number is refused by the route. Nothing here is a money
 * field — no inventory write carries a cost in this wave.
 *
 * W4 mirrors the two reservation writes and W5 the issue and return writes.
 * The damage, intake and opening-batch writes belong to no P1-30 screen; they
 * stay declared PENDING in the gate rather than mirrored without a consumer.
 */

/**
 * `inv.stock-reservation-create` — `POST /stock-reservations`.
 *
 * No company or branch: the server resolves the location's own pair and
 * authorizes it inside the transaction. `idempotencyKey` is a second key the
 * reservation keeps for its whole life, separate from the transport's
 * `Idempotency-Key` header. `expiresAt` is an instant with an offset.
 */
export interface StockReservationCreateBody {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly workOrderId?: string;
  readonly idempotencyKey?: string;
  readonly expiresAt?: string;
}

/**
 * `inv.stock-reservation-release` — `POST /stock-reservations/{reservationId}/release`.
 * The body may be empty; `reason` defaults to `released` on the server.
 */
export interface StockReservationReleaseBody {
  readonly reason?: string;
}

/**
 * `inv.stock-issue-create` — `POST /stock-issues` (W5). The transport attaches
 * the header key; there is no body key. The location decides the branch, and
 * the work order must accept parts (open, not draft). An issue larger than the
 * reservation it names is refused (409); issuing against a reservation
 * consumes it in full.
 */
export interface StockIssueCreateBody {
  readonly workOrderId: string;
  readonly itemId: string;
  readonly locationId: string;
  /** A decimal string, up to nine integer digits and three decimals, above zero. */
  readonly quantity: string;
  readonly reservationId?: string;
  /** The required-part line this issue satisfies, when it was recorded against one. */
  readonly requiredPartRef?: string;
}

/**
 * `inv.stock-return-create` — `POST /stock-returns` (W5). A return names ONLY
 * the issue; the server refuses a return that would exceed what was issued.
 */
export interface StockReturnCreateBody {
  readonly partIssueId: string;
  readonly quantity: string;
  readonly reason?: string;
}
