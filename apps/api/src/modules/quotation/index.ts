/**
 * `quotation` module — public surface (Phase 1-20).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/quotation`.
 *
 * ## What this module owns
 *
 * The whole `quo` schema: `quotations`, `quotation_revisions`, `quotation_items`,
 * `approval_decisions`, `approval_evidence`, and the trigger-written
 * `quotation_status_history`. No other module reads or writes those tables.
 *
 * ## What it consumes, and through whose surface
 *
 * | Need | Asked of |
 * | ---- | -------- |
 * | Work-order identity, scope and terminality | `@/modules/work-order` |
 * | Service availability on a date | `@/modules/service-catalog` |
 * | Price, tax rate, discount authorization | `@/modules/pricing` |
 * | Quotation number, evidence attachment | `@/modules/shared-services` |
 *
 * Nothing here reads another module's tables. In particular the money types come
 * from `@/modules/pricing`, so there is exactly one `Decimal` in the codebase.
 *
 * ## The decision model
 *
 * Decisions are stored **per item** — that is what `quo.record_item_decision` and
 * `uq_approval_decisions_item` provide, and there is no revision-level decision
 * row in the schema. `decideRevision` is an atomic orchestration over the per-item
 * function, not a second storage path, and the quotation-level outcome is always
 * recomputed from the item rows.
 */
import { composeModule } from '@/server/layering';
import { setCommercialApprovalReader } from '@/server/contracts/commercial-approval';
import { QuotationRepository } from './data/quotation-repository';
import { QuotationService } from './application/quotation-service';
import { QuotationDecisionService } from './application/quotation-decision-service';

export type {
  DecisionRow,
  DecisionTally,
  EvidenceRow,
  ItemRow,
  NewItemInput,
  QuotationRow,
  RevisionRow,
} from './data/quotation-repository';

export type {
  CreateQuotationInput,
  IssueQuotationInput,
  MoneyLine,
  QuotationLineInput,
  QuotationSummaryView,
  QuotationView,
  RevisionHeaderView,
  RevisionView,
} from './application/quotation-service';

export type {
  DecideInput,
  DecisionAuditView,
  DecisionView,
  EvidenceInput,
  EvidenceView,
  RevisionDecisionAuditView,
  RevisionDecisionView,
} from './application/quotation-decision-service';

export {
  DECISIONS,
  DECISION_CHANNELS,
  EVIDENCE_KINDS,
  ITEM_KINDS,
  MAX_ITEMS_PER_REVISION,
  MAX_ITEM_DESCRIPTION,
  MAX_REFERENCE_NOTE,
  MAX_STATUS_REASON,
  QUOTATION_STATES,
  QuotationRuleError,
  REVISION_STATES,
  TERMINAL_REVISION_STATES,
  assertEvidenceShape,
  assertRevisionEditable,
  hasExpired,
  isTerminalRevision,
  rollUpDecisions,
  type Decision,
  type DecisionChannel,
  type EvidenceKind,
  type ItemKind,
  type QuotationState,
  type RevisionState,
} from './domain/quotation';

/** Composition root: constructs the module's services once per process. */
export const quotationModule = composeModule({
  module: 'quotation',
  create: () => {
    const repository = new QuotationRepository();
    return {
      quotations: new QuotationService(repository),
      decisions: new QuotationDecisionService(repository),
    };
  },
});

/**
 * Installs the commercial-approval port at MODULE LOAD, not inside `create()`.
 *
 * Inside the composition root it would install only once something had already
 * asked for a quotation service, so a process that reached
 * `POST /additional-work/{requestId}/approval` first would find the port missing.
 * At module scope, importing this surface is enough — and the closure defers to
 * `quotationModule()`, so the services themselves are still built lazily on first
 * use.
 *
 * The dependency is inverted through the foundation on purpose: `quotation` already
 * imports `work-order` for `requireWorkOrder`, so importing back would close a
 * module cycle.
 */
setCommercialApprovalReader({
  standingOf: (db, revisionId, options) =>
    quotationModule().quotations.commercialApproval(db, revisionId, options ?? {}),
});
