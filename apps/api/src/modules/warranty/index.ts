/**
 * `warranty` module — public surface (Phase 1-22).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/warranty`. The
 * boundary checker and the ESLint rule both reject `@/modules/warranty/<anything>`,
 * and B1 applies to every import syntax including `export … from` and dynamic
 * `import()`.
 *
 * ## What this module owns
 *
 * The whole `wty` schema: warranty policies, effective-dated coverage, warranty
 * records, the covered jobs and parts on them, and the append-only status ledger.
 * No other module reads or writes a `wty` table.
 *
 * ## What this module does NOT do, and why each absence is deliberate
 *
 * - **No warranty claim, in any shape.** No claim table exists in 119 migrations
 *   under any name — `wty` is exactly five tables and the entire trace of a claim
 *   is the string `'claimed_against'` in two CHECK vocabularies. There is no claim
 *   permission, no claim event type and no claim audit action, and creating a table
 *   needs a migration this phase forbids. So there is no claim type, no claim
 *   method and no claim field here, and `'claimed_against'` is never written.
 *   Recorded as `P1-22-L-01`; `WARRANTY_STATUSES` is transcribed complete precisely
 *   so nobody reads the gap as an oversight. P1-11's forward contracts assign claim
 *   adjudication to P1-22 in four places — measured against the deployed DDL, the
 *   P1-22 mandate's "warranty generation" is the reading that matches reality.
 * - **Policy and coverage administration arrived with P1-31 prerequisite P-10**
 *   (**PPD-04**), and it is the ONE absence in this list that has been closed.
 *   Until 2026-09-09 `wty.policy.manage` was a seeded catalogue code that no
 *   operation in this repository declared and no policy predicate named, so the
 *   two tables had SELECT, INSERT and UPDATE grants and no writer — and a tenant
 *   provisioned through the product could never issue a warranty, because
 *   `resolvePolicy` refuses a company with no active policy and nothing could
 *   create one. `WarrantyPolicyService` now owns both tables in both directions
 *   under that code. The terms are still operator configuration and this module
 *   still invents none: no duration, no distance, no window and no default
 *   policy is ever written except from a request an operator sent.
 * - **No status advance.** `wty.warranty_records.status` may legally move to
 *   `active`, `expired` or `voided`, and nothing in this phase moves it: expiry is a
 *   function of `expiry_date` and `odometer_limit`, which any reader can evaluate,
 *   and voiding is an authority the operation inventory does not include. A status
 *   this phase may not write is refused structurally by `assertWritableStatus`.
 * - **No money.** `wty` has 80 columns and not one is monetary — no amount, no
 *   currency, no cap in any unit of account. `WarrantyView` therefore has no money
 *   field, and a "covered value" would be a fabricated business fact.
 * - **It does not read `sal.delivery_records`.** The handover fact belongs to
 *   `delivery` and is obtained through its public port. Two modules deciding
 *   independently when a vehicle was handed over is how a warranty ends up dated
 *   from a delivery that never completed.
 */
import { composeModule } from '@/server/layering';
import { WarrantyRepository } from './data/warranty-repository';
import { WarrantyPolicyService } from './application/warranty-policy-service';
import { WarrantyService } from './application/warranty-service';

export type {
  CoverageResolution,
  WarrantyCoverageRow,
  WarrantyPolicyRow,
  WarrantyRecordItemRow,
  WarrantyRecordRow,
  WarrantyRecordWithItems,
} from './data/warranty-repository';

export {
  MAX_COVERED_ITEMS,
  MAX_WARRANTIES_PER_DELIVERY,
  WARRANTY_ORDER,
  WARRANTY_POLICY_ORDER,
} from './data/warranty-repository';

export type {
  /**
   * The P1-31 policy and coverage administration surface (prerequisite P-10, PPD-04).
   *
   * `WarrantyCoverageTermsView` spells every term exactly as `WarrantyCoverageView`
   * spells it on an issued warranty — `odometerAllowance` and never `odometerLimit`,
   * because the coverage's distance is RELATIVE and the record's is ABSOLUTE — so a
   * screen that authors the terms and a screen that renders what a warranty was
   * issued under handle one shape.
   */
  CreateWarrantyCoverageInput,
  CreateWarrantyPolicyInput,
  WarrantyCoverageTermsView,
  WarrantyPolicyDetailView,
  WarrantyPolicyListView,
  WarrantyPolicySummaryView,
} from './application/warranty-policy-service';

export type {
  GenerateWarrantyInput,
  WarrantyCoverageView,
  WarrantyDeliveryFacts,
  WarrantyItemView,
  WarrantyPolicyView,
  WarrantyRecordListView,
  WarrantyView,
} from './application/warranty-service';

export {
  COVERAGE_DATE_FORMAT,
  COVERED_SCOPES,
  MAX_DURATION_MONTHS,
  MAX_ODOMETER_ALLOWANCE,
  MAX_POLICY_NAME,
  MIN_DURATION_MONTHS,
  MIN_ODOMETER_ALLOWANCE,
  POLICY_CODE_FORMAT,
  WARRANTY_ITEM_KINDS,
  WARRANTY_LIFECYCLE_STATUSES,
  WARRANTY_STATUSES,
  WARRANTY_STATUSES_WRITTEN_BY_P1_22,
  WarrantyRuleError,
  assertCoverageConfigured,
  assertDeliveryDelivered,
  assertPolicyActive,
  assertWritableStatus,
  coversItemKind,
  type CoveredScope,
  type WarrantyItemKind,
  type WarrantyLifecycleStatus,
  type WarrantyStatus,
} from './domain/warranty';

/**
 * Composition root: constructs the module's services once per process.
 *
 * TWO services over ONE repository, and the second arrived with P1-31 P-10.
 *
 * `warranties` is warranty GENERATION. Its three methods split by authority at the
 * ROUTE and not by a second class: P-7 minted `wty.warranty.read`, so the two reads
 * declare it and `wty.warranty-generate` alone keeps `wty.warranty.issue`, while all
 * three share one repository and one `toView` mapper that separating them would
 * duplicate to no end.
 *
 * `policies` splits on neither direction nor authority — it owns the two
 * CONFIGURATION tables in both, because what they hold is authored long before any
 * delivery exists, under company-wide `wty.policy.manage`, and touches no delivery,
 * no work order and no warranty record. Folding it into `warranties` would put "what
 * does this company's warranty cover" and "issue this vehicle's warranty" behind one
 * object. `serviceCatalogModule().catalogWrites` is the precedent for a second write
 * service inside one module; the SQL stays in the one repository, because two files
 * writing one table is how a tenant predicate ends up on one query and not the other.
 *
 * Until 2026-09-08 the detail read was gated on `wty.warranty.issue`, the authority
 * to CREATE a warranty, because the catalogue seeded no `wty` read code at all;
 * borrowing `wty.policy.manage` instead would have handed coverage administration
 * to a caller who only needs to look at a record. Both readings are now moot: the
 * least-privilege read code exists, and `wty.policy.manage` gates exactly the
 * administration it names and nothing else.
 */
export const warrantyModule = composeModule({
  module: 'warranty',
  create: () => {
    const repository = new WarrantyRepository();
    return {
      warranties: new WarrantyService(repository),
      policies: new WarrantyPolicyService(repository),
    };
  },
});
