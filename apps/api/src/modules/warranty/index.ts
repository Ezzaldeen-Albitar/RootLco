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
 * - **No policy or coverage administration.** Creating a policy or a coverage row
 *   needs `wty.policy.manage`, and the P1-22 operation inventory registers two
 *   warranty operations, both under `wty.warranty.issue`. Coverage terms are
 *   operator configuration; this module reads them and refuses when they are
 *   missing, rather than authoring them.
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
import { WarrantyService } from './application/warranty-service';

export type {
  CoverageResolution,
  WarrantyCoverageRow,
  WarrantyPolicyRow,
  WarrantyRecordItemRow,
  WarrantyRecordRow,
  WarrantyRecordWithItems,
} from './data/warranty-repository';

export { MAX_COVERED_ITEMS, MAX_WARRANTIES_PER_DELIVERY } from './data/warranty-repository';

export type {
  GenerateWarrantyInput,
  WarrantyCoverageView,
  WarrantyDeliveryFacts,
  WarrantyItemView,
  WarrantyPolicyView,
  WarrantyView,
} from './application/warranty-service';

export {
  COVERED_SCOPES,
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
 * One service over one repository. There is no split by authority to make, because
 * both operations answer to the same permission — the catalogue contains no
 * `wty.warranty.read`, so `wty.warranty-detail` reuses `wty.warranty.issue` rather
 * than borrowing `wty.policy.manage`, which would hand coverage administration to a
 * caller who only needs to read a record.
 */
export const warrantyModule = composeModule({
  module: 'warranty',
  create: () => ({
    warranties: new WarrantyService(new WarrantyRepository()),
  }),
});
