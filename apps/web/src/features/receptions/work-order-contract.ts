/**
 * The ONE work-order contract this phase needs (P1-28, Wave F; `FE-022`).
 *
 * | operation             | path                          | permission           |
 * | --------------------- | ----------------------------- | -------------------- |
 * | `wo.work-order-detail`| `/work-orders/{workOrderId}`  | `wo.work_order.read` |
 *
 * ## Why a work-order contract lives under `receptions`, and why it is this small
 *
 * `rec.reception-convert-to-work-order` is the only way a work order comes to
 * exist — there is no `POST /work-orders` anywhere in the platform — so the
 * moment a visit converts, the operator is looking at a record this phase did
 * not build and does not own. Everything ABOUT a work order (its jobs' progress,
 * its transitions, its closure) is P1-29; this phase renders the identity of the
 * thing it just created and stops, which is the boundary the plan draws at
 * journey step S-12.
 *
 * A `features/work-orders` module would be that boundary's opposite: a home for
 * a surface P1-29 owns, built one wave early and half-shaped, which the next
 * phase would then have to argue with. So the read lives beside the conversion
 * that needs it, as a thin copy of the published response — the same reasoning
 * `support-api.ts` records for its cross-domain reads, and under the same rule:
 * a feature may never import another feature.
 *
 * ## `state` is an OPAQUE catalogue code, not an enum
 *
 * `wo.work_order_states` is a live catalogue and the response's `state` is a row
 * of it. There is no frozen vocabulary to translate against, so the type is
 * `string` and the screen renders it as an identifier with the disposition
 * stated — a translation table keyed on a code the catalogue owns would be a
 * second, rotting copy of a tenant's own configuration, and a code with no
 * matching key would render as the key itself.
 *
 * ## Why the constant is here and not in the adapter
 *
 * `work-order-api.ts` carries `'use server'`, and a module marked that way may
 * export only async functions. A permission code is not one, so it lives in this
 * pure module — the same split every other feature makes between its contract
 * and its adapters.
 */

/** The permission `wo.work-order-detail` registers. Pinned by the contract suite. */
export const WORK_ORDER_READ_PERMISSION = 'wo.work_order.read';

/** One job of the created work order. Subset of the published `JobView`. */
export interface ConvertedWorkOrderJob {
  readonly id: string;
  readonly title: string;
  /** An opaque catalogue code, like the work order's own state. */
  readonly state: string;
}

/**
 * The identity of the work order a conversion produced. A SUBSET of
 * `wo.work-order-detail`: the fields this phase can render truthfully, and no
 * projection of anything P1-29 owns.
 */
export interface ConvertedWorkOrder {
  readonly workOrder: {
    readonly id: string;
    readonly displayNumber: string | null;
    /** An opaque catalogue code — see the module docblock. */
    readonly state: string;
    readonly kind: string;
    readonly receptionVisitId: string;
    readonly vehicleId: string;
    readonly openedAt: string;
    readonly recordVersion: number;
  };
  readonly jobs: readonly ConvertedWorkOrderJob[];
}
