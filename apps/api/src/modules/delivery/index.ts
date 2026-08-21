/**
 * `delivery` module — public surface (Phase 1-22).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/delivery`. The
 * boundary checker (B1) and the ESLint rule both reject
 * `@/modules/delivery/<anything>`.
 *
 * ## What this module owns
 *
 * The delivery half of `sal`: `delivery_records`, `delivery_checklist_templates` and
 * their items, `delivery_checklist_results`, `authorized_receivers`,
 * `delivery_signatures`, and `delivery_status_history`. No other module reads or
 * writes one of those tables — `warranty` in particular must not, which is why
 * `deliveryForWarranty` exists on this surface.
 *
 * ## What this module deliberately does not do
 *
 * - **It does not read `sal.invoices` or `sal.invoice_amounts`.** The financial
 *   blocker on a handover is composed from `@/modules/billing`'s
 *   `openReceivableForWorkOrder`. Reading the invoice here would put a second
 *   definition of "open receivable" in the codebase, in the module least equipped to
 *   own one — and the `sal.finance.view` gating that makes the check honest lives on
 *   the tables billing owns.
 * - **It does not retrieve a signature or an identity document.** Both are
 *   `shared.document_versions` REFERENCES. There is no download path, and that is
 *   structural rather than an omission: `DOWNLOADABLE_STATES` is `['accepted']`,
 *   `shared.guard_document_version_transition` requires a clean scan record to reach
 *   `accepted`, and no scanner is provisioned anywhere in the platform — so a
 *   retrieval method would be a contract that always fails (`P1-22-L-04`). Raw
 *   signature bytes are never read, stored, logged or forwarded by any code here.
 * - **It makes no claim about a signature's validity.** Nothing here asserts that a
 *   bound document is biometric, verified against a specimen, or legally binding. It
 *   records that an immutable version was bound to a handover by a named actor at a
 *   recorded time, and stops.
 * - **It does not correct a verified receiver, a recorded checklist outcome, or the
 *   odometer.** `uq_authorized_receivers_delivery` and
 *   `uq_delivery_checklist_results_item` each admit one row, neither has a history
 *   table behind it, and `veh.odometer_readings` corrections belong to `veh`. Each of
 *   those is refused rather than silently rewritten; the residual is recorded at its
 *   refusal site.
 * - **It writes no migration.** Every statement uses an existing `app_runtime` grant
 *   on the frozen P1-11 schema.
 *
 * ## The one gate the database does not hold
 *
 * `sal.complete_delivery` enforces a verified receiver, the mandatory checklist and at
 * least one signature. It checks **no work-order state, no quality-control outcome, no
 * part obligation and no financial balance**. Those four exist only because
 * `DeliveryReadService` composes them and `DeliveryService.completeDelivery` consults
 * that composition inside the transaction, after locking the row. Remove either and
 * the platform will release a vehicle against an unpaid issued invoice without a
 * single constraint objecting.
 */
import { composeModule } from '@/server/layering';
import { DeliveryRepository } from './data/delivery-repository';
import { DeliveryReadService } from './application/delivery-read-service';
import { DeliveryService } from './application/delivery-service';

export type {
  AuthorizedReceiverRow,
  ChecklistGapReport,
  ChecklistGapRow,
  ChecklistResultRow,
  ChecklistTemplateItemRow,
  DeliveryRecordRow,
  DeliveryScope,
  DeliverySignatureRow,
} from './data/delivery-repository';

export type {
  ComposedEligibility,
  DeliveryForWarranty,
  EligibilityFact,
  EligibilityView,
} from './application/delivery-read-service';

export type {
  AttachSignatureInput,
  AuthorizedReceiverView,
  ChecklistResultView,
  CompleteDeliveryInput,
  CompletionView,
  CreateDeliveryInput,
  DeliveryView,
  RecordChecklistResultInput,
  SignatureView,
  VerifyReceiverInput,
} from './application/delivery-service';

export {
  BLOCKER_CODES,
  CHECKLIST_OUTCOMES,
  CHECKLIST_SATISFYING_OUTCOMES,
  DELIVERY_STATUSES,
  DeliveryRuleError,
  MAX_REASON,
  ODOMETER_UNITS,
  ODOMETER_VALUE,
  OVERRIDABLE_BLOCKERS,
  SIGNER_ROLES,
  assertChecklistResultShape,
  assertEligible,
  assertSignerRole,
  composeEligibility,
  isOverridable,
  overridePermission,
  parseOdometerValue,
  withOverrides,
  type BlockerCode,
  type ChecklistOutcome,
  type DeliveryStatus,
  type EligibilityDecision,
  type OdometerUnit,
  type SignerRole,
} from './domain/delivery';

/**
 * Composition root: constructs the module's services once per process.
 *
 * Two services over ONE repository. The split is by direction rather than by
 * authority: `reads` composes eligibility and answers the cross-module
 * `deliveryForWarranty` question, `deliveries` performs the five commands — and
 * `deliveries` DEPENDS ON `reads` rather than re-deriving the blocker set, so the
 * `GET .../eligibility` answer and the gate actually applied at completion are the
 * same code reading the same tables. Two implementations would be two chances for the
 * financial blocker to be dropped from the one that matters.
 *
 * The SQL for all seven tables stays in one repository file, because two files
 * writing `sal.delivery_records` is how a tenant predicate ends up on one query and
 * not the other.
 */
export const deliveryModule = composeModule({
  module: 'delivery',
  create: () => {
    const repository = new DeliveryRepository();
    const reads = new DeliveryReadService(repository);
    return {
      reads,
      deliveries: new DeliveryService(repository, reads),
    };
  },
});
