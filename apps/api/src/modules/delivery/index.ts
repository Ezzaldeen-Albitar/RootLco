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
 *   `shared.document_versions` REFERENCES. There is no download path here, and that is
 *   a scope boundary rather than an impossibility: retrieval belongs to the shared
 *   attachment path, whose `requestDownload` refuses a version with `ERR-DOC-001` while
 *   it is not `accepted` — a state check. P1-22 recorded the rest as "no application
 *   path can produce acceptance" (`P1-22-L-04`); that is no longer the rule, because
 *   `20260815090000_shared_reception_evidence_foundation.sql` adds `GRANT INSERT ON
 *   shared.file_scan_results` and `GRANT UPDATE(status) ON shared.document_versions`.
 *   Raw signature bytes are never read, stored, logged or forwarded by any code here.
 *   Corrected by P1-31 prerequisite P-14.
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
import { ChecklistTemplateService } from './application/checklist-template-service';
import { DeliveryReadService } from './application/delivery-read-service';
import { DeliveryReadinessService } from './application/delivery-readiness-service';
import { DeliveryService } from './application/delivery-service';

export type {
  AuthorizedReceiverRow,
  ChecklistGapReport,
  ChecklistGapRow,
  ChecklistResultDetailRow,
  ChecklistResultRow,
  ChecklistTemplateItemRow,
  ChecklistTemplateRow,
  DeliveryRecordRow,
  DeliveryScope,
  DeliverySignatureRow,
  DeliveryStatusHistoryRow,
} from './data/delivery-repository';

export type {
  /**
   * The P1-31 read-seam projections (prerequisites P-2 … P-5).
   *
   * Named with a `…RecordView` suffix rather than colliding with the write path's
   * `DeliveryView`, `AuthorizedReceiverView`, `ChecklistResultView` and
   * `SignatureView` — but every field they share is spelled IDENTICALLY (`id`,
   * `deliveryRecordId`, `itemCode`, `signatureDocumentVersionId`, …), so a screen
   * that renders a created delivery and a read one handles one shape. The write
   * views differ only by carrying `replayed`, which is a fact about a request and
   * not about a row, and so has no honest value on a read.
   */
  AuthorizedReceiverRecordView,
  ChecklistResultRecordView,
  ComposedEligibility,
  DeliveryChecklistResultsEnvelope,
  DeliveryForWarranty,
  DeliveryReceiverEnvelope,
  DeliveryRecordView,
  DeliverySignatureRecordView,
  DeliverySignaturesEnvelope,
  DeliveryStatusHistoryEntryView,
  DeliveryStatusHistoryEnvelope,
  EligibilityFact,
  EligibilityView,
  WorkOrderDeliveryView,
  WorkOrderEligibilityFacts,
} from './application/delivery-read-service';

export type { DeliveryReadinessRowView } from './application/delivery-readiness-service';
export {
  DEFAULT_READINESS_PAGE_SIZE,
  MAX_READINESS_PAGE_SIZE,
} from './application/delivery-readiness-service';

export type {
  /**
   * The P1-31 checklist TEMPLATE surface (prerequisite P-9, PPD-12).
   *
   * `ChecklistTemplateItemView` spells `itemCode` and `label` exactly as the
   * checklist-RESULT read spells them, so a screen that renders the template and a
   * screen that renders what was recorded against it handle one shape.
   */
  ChecklistTemplateDetailView,
  ChecklistTemplateItemView,
  ChecklistTemplateListView,
  ChecklistTemplateView,
  CreateChecklistTemplateInput,
  CreateChecklistTemplateItemInput,
  UpdateChecklistTemplateItemInput,
} from './application/checklist-template-service';

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
  CHECKLIST_CODE,
  CHECKLIST_OUTCOMES,
  CHECKLIST_SATISFYING_OUTCOMES,
  CHECKLIST_TEMPLATE_STATUSES,
  DELIVERY_STATUSES,
  DeliveryRuleError,
  MAX_ITEM_LABEL,
  MAX_REASON,
  MAX_SORT_ORDER,
  MAX_TEMPLATE_NAME,
  MIN_SORT_ORDER,
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
  type ChecklistTemplateStatus,
  type DeliveryStatus,
  type EligibilityDecision,
  type OdometerUnit,
  type SignerRole,
} from './domain/delivery';

/**
 * Composition root: constructs the module's services once per process.
 *
 * THREE services over ONE repository, and the third arrived with P1-31 P-9.
 *
 * The first two split by direction rather than by authority: `reads` composes
 * eligibility and answers the cross-module `deliveryForWarranty` question,
 * `deliveries` performs the five commands. `checklistTemplates` splits on neither —
 * it owns the two CONFIGURATION tables in both directions, because what they hold is
 * authored before any delivery exists, under company-wide authority, and touches no
 * delivery record, no status machine and no custody fact. Folding it into
 * `deliveries` would put "which items does this company check" and "hand this vehicle
 * over" behind one object.
 *
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
      // A THIRD accessor, added by P1-31 P-9 for the checklist TEMPLATE tables.
      // Configuration rather than a handover command: authored long before a
      // delivery exists, under company-wide authority, touching no delivery record
      // and no status machine. `serviceCatalogModule().catalogWrites` is the
      // precedent for a second write service inside one module; the SQL stays in
      // the one repository above for the reason stated below it.
      checklistTemplates: new ChecklistTemplateService(repository),
      // A FOURTH accessor, added by the Owner's D-3 decision. It reads and composes
      // and writes nothing, so it belongs on neither `deliveries` nor
      // `checklistTemplates`; and it is not folded into `reads` because every method
      // there is addressed by a delivery id while this one answers for work orders
      // that have no delivery at all. It DEPENDS on `reads` — the same instance —
      // rather than re-deriving a fact, for the reason stated above `deliveries`:
      // two definitions of the financial blocker are two chances to lose the one
      // gate the database does not hold.
      readiness: new DeliveryReadinessService(repository, reads),
    };
  },
});
