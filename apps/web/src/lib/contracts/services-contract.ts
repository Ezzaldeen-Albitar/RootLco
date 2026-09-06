/**
 * Request-payload mirror for the `svc.` (service catalogue) writes — P1-30, `W1`.
 *
 * ## Why this is transcribed by hand
 *
 * `apps/web` may not import `apps/api` source — `check-api-boundary.mjs` fails
 * the build if it tries — so the shapes the routes validate with are copied
 * across the boundary by hand and `check-p1-30-payload-parity.mjs` compares the
 * copy against the zod schemas themselves. A GENERATED mirror would gate
 * nothing: it would agree with its source by construction. The value is that a
 * hand copy CAN drift, and that the drift surfaces on the next gate run instead
 * of as a 422 in front of an operator.
 *
 * ## One type per operation, named by the gate's own rule
 *
 * `typeNameFor('svc.service-create')` is `ServiceCreateBody`, and so on: the
 * gate finds each mirror by that derivation, so a renamed interface is a
 * missing mirror, not a quietly different one. Nothing is shared between two
 * operations even where the shapes coincide today, for the reason the P1-29
 * mirror records: the first divergence would be invisible.
 *
 * ## Length and pattern limits are NOT in these types
 *
 * A TypeScript interface cannot carry `minLength`, `maxLength` or `pattern`, so
 * the gate does not compare them and this module does not pretend to. The
 * limits the forms enforce client-side are mirrored as constants in
 * `features/services/services-contract.ts` and the backend remains the
 * authority.
 *
 * The operations appear in the order the register lists them.
 */

/**
 * `svc.branch-availability-set` — `POST /services/{serviceId}/branch-availability`.
 *
 * `companyId` and `branchId` are the operation's SCOPE TARGET and are required:
 * the row carries both and the backend authorizes the pair against the caller's
 * grants before writing. `status` is `active` unless the caller says otherwise.
 */
export interface BranchAvailabilitySetBody {
  readonly companyId: string;
  readonly branchId: string;
  readonly isAvailable: boolean;
  readonly status?: 'active' | 'inactive';
}

/**
 * `svc.service-category-create` — `POST /service-categories`.
 *
 * `code` is the LOWER-snake internal code and is immutable once written; there
 * is no `status` field because a category created inactive is one nothing may
 * be filed under. `sortOrder` is an `integer` and travels as a JSON number —
 * the decimal-string rule is about `numeric`, which an integer is not.
 */
export interface ServiceCategoryCreateBody {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly parentCategoryId?: string;
  readonly sortOrder?: number;
}

/**
 * `svc.service-create` — `POST /services`.
 *
 * `serviceCode` is the mixed-case EXTERNAL code and is frozen by
 * `tg_services_immutable` from this moment. There is no `lifecycleStatus`: a
 * service is created active, and archiving is an update.
 */
export interface ServiceCreateBody {
  readonly serviceCategoryId: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly description?: string;
}

/**
 * `svc.service-update` — `PATCH /services/{serviceId}`, `If-Match` required.
 *
 * Every field is optional and the body is `.strict()`, so `serviceCode` is
 * refused rather than ignored — it is immutable. `description` is three-way:
 * omitted leaves it alone, `null` clears it, a string sets it, which is why the
 * mirror spells `string | null` and the adapter passes the value through
 * UNCHANGED. `lifecycleStatus: 'archived'` is terminal.
 */
export interface ServiceUpdateBody {
  readonly serviceCategoryId?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly lifecycleStatus?: 'active' | 'archived';
}

/**
 * `svc.service-version-create` — `POST /services/{serviceId}/versions`.
 *
 * Creates a DRAFT. Not version-guarded: creating the next draft does not
 * mutate the service, and there is no prior version of the created thing to
 * guard (A0 decision, S-03). `effectiveTo` must be strictly after
 * `effectiveFrom`; the range is half-open.
 */
export interface ServiceVersionCreateBody {
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly notes?: string;
}

/**
 * `svc.service-version-publish` —
 * `POST /services/{serviceId}/versions/{versionId}/publication`, `If-Match`
 * required and guarding the SERVICE's `recordVersion`, which is the row
 * `svc.publish_service_version` locks first.
 *
 * `effectiveFrom` is re-stated on publication: the command fixes the date the
 * version takes effect from, it does not inherit the draft's.
 */
export interface ServiceVersionPublishBody {
  readonly effectiveFrom: string;
}
