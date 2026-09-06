/**
 * Request-payload mirror for the `svc.price*` (pricing) writes — P1-30, `W2`.
 *
 * Transcribed by hand for the reason `services-contract.ts` records: `apps/web`
 * may not import `apps/api`, a generated copy would gate nothing, and a hand
 * copy CAN drift — which `check-p1-30-payload-parity.mjs` turns into a failing
 * gate rather than a 422 in front of an operator. One interface per operation,
 * named by `typeNameFor`. Length and pattern limits are mirrored as constants in
 * `features/pricing/pricing-contract.ts`, not here.
 *
 * ## Money stays a string across this boundary
 *
 * `amount` is a decimal STRING with at most four decimal places. The route's
 * zod schema is `z.string().regex(...)`, and a JSON number is refused, so the
 * type below is `string` and `MoneyField` is what produces it.
 *
 * The operations appear in the order the register lists them.
 */

/**
 * `svc.price-list-assignment-create` — `POST /price-list-assignments`.
 *
 * Every narrowing slot is optional; the backend demands `svc.price.manage`
 * held for the whole workshop when the assignment names no company and no
 * branch. `effectiveTo` must be strictly after `effectiveFrom` (half-open).
 * `priority` is an integer and travels as a JSON number.
 */
export interface PriceListAssignmentCreateBody {
  readonly priceListId: string;
  readonly companyId?: string;
  readonly branchId?: string;
  readonly customerClass?: string;
  readonly priority?: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

/**
 * `svc.price-list-create` — `POST /price-lists`.
 *
 * `priceListCode` and `currency` are frozen from this moment. There is no
 * `status`: a list is created active.
 */
export interface PriceListCreateBody {
  readonly priceListCode: string;
  readonly name: string;
  readonly currency: string;
  readonly description?: string;
}

/**
 * `svc.price-list-version-create` — `POST /price-lists/{priceListId}/versions`,
 * `If-Match` required and guarding the PRICE LIST's `recordVersion`.
 *
 * `effectiveFrom` is provisional: publication restates it.
 */
export interface PriceListVersionCreateBody {
  readonly effectiveFrom: string;
  readonly notes?: string;
}

/**
 * `svc.price-list-version-publish` —
 * `POST /price-lists/{priceListId}/versions/{versionId}/publication`, `If-Match`
 * required and guarding the PRICE LIST's `recordVersion`. `effectiveFrom` is
 * required and never defaulted.
 */
export interface PriceListVersionPublishBody {
  readonly effectiveFrom: string;
}

/**
 * `svc.price-rule-record` — `POST /price-lists/{priceListId}/versions/{versionId}/rules`.
 *
 * `amount` is the decimal STRING. A `branchId` needs its `companyId`, a
 * `taxClassId` needs a `companyId`, and a rule naming neither company nor
 * branch needs `svc.price.manage` held for the whole workshop. `priority` is an
 * integer and travels as a JSON number.
 */
export interface PriceRuleRecordBody {
  readonly serviceId: string;
  readonly amount: string;
  readonly companyId?: string;
  readonly branchId?: string;
  readonly customerClass?: string;
  readonly taxClassId?: string;
  readonly priority?: number;
}
