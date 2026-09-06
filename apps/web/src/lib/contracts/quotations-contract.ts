/**
 * Request-payload mirror for the `quo.` (quotation) writes — P1-30, `W3`.
 *
 * Transcribed by hand for the reason `services-contract.ts` records, and
 * compared against the routes' zod schemas by `check-p1-30-payload-parity.mjs`.
 * One interface per operation, named by `typeNameFor`; the two shapes the
 * routes share — a priced line and a piece of evidence — are declared once as
 * named interfaces, which the gate resolves by name when it meets an array of
 * objects or a nested object.
 *
 * ## Quantities and discounts are strings
 *
 * `quantity` (at most three decimals, positive) and `discount` (at most four,
 * non-negative) are decimal STRINGS validated by regular expressions on the
 * route; a JSON number is refused. `MoneyField` produces the discount, and the
 * quantity is sent as typed once it matches the mirrored pattern.
 *
 * The operations appear in the order the register lists them.
 */

/** A line as the builder sends it; the server prices it. */
export interface QuotationLineBody {
  readonly serviceId: string;
  readonly quantity: string;
  readonly discount?: string;
  readonly description?: string;
  readonly sourceServiceLineRef?: string;
}

/** Evidence recorded with a decision. `document` needs `documentVersionId`. */
export interface DecisionEvidenceBody {
  readonly evidenceKind: 'document' | 'verbal' | 'portal' | 'email';
  readonly documentVersionId?: string;
  readonly referenceNote?: string;
}

/**
 * `quo.quotation-item-decide` — `POST /quotation-items/{quotationItemId}/decisions`.
 *
 * `presentedRevisionId` is required: the decision is about the revision the
 * customer was shown, and the server refuses one that is no longer current.
 */
export interface QuotationItemDecideBody {
  readonly decision: 'approved' | 'rejected';
  readonly channel: 'in_person' | 'phone' | 'portal' | 'email' | 'system';
  readonly decidingPartyRef?: string;
  readonly evidence?: DecisionEvidenceBody;
  readonly presentedRevisionId: string;
}

/**
 * `quo.quotation-revision-decide` — `POST /quotation-revisions/{revisionId}/decisions`.
 * The same shape as a line decision, applied to every still-undecided line.
 */
export interface QuotationRevisionDecideBody {
  readonly decision: 'approved' | 'rejected';
  readonly channel: 'in_person' | 'phone' | 'portal' | 'email' | 'system';
  readonly decidingPartyRef?: string;
  readonly evidence?: DecisionEvidenceBody;
  readonly presentedRevisionId: string;
}

/**
 * `quo.quotation-create` — `POST /quotations`.
 *
 * No company or branch: the scope comes from the work order. `discountRequestedBy`
 * names the user who asked for a discount when the company's policy keeps the
 * requester and the approver distinct.
 */
export interface QuotationCreateBody {
  readonly workOrderId: string;
  readonly payerPartnerRef?: string;
  readonly customerClass?: string;
  readonly lines: readonly QuotationLineBody[];
  readonly discountRequestedBy?: string;
}

/**
 * `quo.quotation-issue` — `POST /quotations/{quotationId}/issue`, `If-Match`
 * required and guarding the QUOTATION's `recordVersion`. `expiresAt` is an
 * instant with an offset; omitted, the revision never expires.
 */
export interface QuotationIssueBody {
  readonly revisionId: string;
  readonly expiresAt?: string;
}

/**
 * `quo.quotation-revision-create` — `POST /quotations/{quotationId}/revisions`,
 * `If-Match` required and guarding the QUOTATION's `recordVersion`.
 */
export interface QuotationRevisionCreateBody {
  readonly lines: readonly QuotationLineBody[];
  readonly customerClass?: string;
  readonly discountRequestedBy?: string;
}
