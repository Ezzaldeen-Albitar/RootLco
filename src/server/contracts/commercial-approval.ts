/**
 * Commercial-approval reader — contract only (Phase 1-20, P1-20-BE-013).
 *
 * ## Why this port exists
 *
 * The P1-19 integration point is `wo.customer_approvals.quotation_revision_ref`.
 * That column belongs to `@/modules/work-order`, and every fact about the revision
 * it points at belongs to `@/modules/quotation`. So work-order must ask quotation a
 * question at approval time.
 *
 * A direct import would close a cycle: `quotation` already imports `work-order` for
 * `requireWorkOrder`, because a quotation's scope comes from its work order. Two
 * modules importing each other's public surface is exactly the shape this
 * repository avoids, and `composeModule`'s laziness would hide the cycle rather
 * than remove it.
 *
 * So the dependency is inverted through the foundation, the same way
 * `FileService` and `NotificationService` already are: work-order depends on this
 * contract, the quotation module installs an implementation at composition time,
 * and neither module imports the other.
 *
 * ## What it deliberately does NOT expose
 *
 * A way to *record* an approval. This port is read-only: it reports a revision's
 * standing so work-order can decide whether to store the reference. The commercial
 * decision itself stays in `quo.approval_decisions`, and there is no second
 * approval truth anywhere.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';

/**
 * A quotation revision's commercial standing.
 *
 * `outcome` is DERIVED from the per-item decisions by the implementing module on
 * every call, never cached, so a consumer cannot be told "accepted" by this port
 * and "rejected" by a read of the quotation.
 */
export interface CommercialApprovalStanding {
  readonly revisionId: string;
  readonly quotationId: string;
  /** The work order the quotation was raised against. `NOT NULL` in the schema. */
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly currency: string;
  /** `numeric(18,4)` decimal STRING. Never a float. */
  readonly grandTotal: string;
  readonly revisionStatus: string;
  readonly isCurrentRevision: boolean;
  readonly hasExpired: boolean;
  /** `accepted`, `rejected`, or `null` while any line remains undecided. */
  readonly outcome: 'accepted' | 'rejected' | null;
}

export interface CommercialApprovalReader {
  /**
   * One revision's standing, or `null` when it is not visible to the caller.
   *
   * Visibility is RLS's decision, so a cross-tenant revision is reported as absent
   * rather than as forbidden — the same non-disclosure every other read follows.
   */
  standingOf(db: DbHandle, revisionId: string): Promise<CommercialApprovalStanding | null>;
}

/**
 * The default refuses rather than returning `null`.
 *
 * `null` means "no such revision", which a caller may legitimately act on. An
 * uninstalled port is a wiring defect, and answering it with a legitimate-looking
 * "not found" would let a quotation link silently never be validated. Failing loudly
 * is the only safe default for an authorization-shaped question.
 */
class NotInstalledCommercialApprovalReader implements CommercialApprovalReader {
  async standingOf(): Promise<CommercialApprovalStanding | null> {
    throw new AppFailure('ERR-SYS-001', {
      message:
        'CommercialApprovalReader is not installed; the quotation module must install it at ' +
        'composition time before an additional-work approval may cite a quotation revision',
      safeDetails: { contract: 'CommercialApprovalReader' },
    });
  }
}

let reader: CommercialApprovalReader = new NotInstalledCommercialApprovalReader();

export function commercialApprovalReader(): CommercialApprovalReader {
  return reader;
}

export function setCommercialApprovalReader(next: CommercialApprovalReader): void {
  reader = next;
}

export function __resetCommercialApprovalReaderForTests(): void {
  reader = new NotInstalledCommercialApprovalReader();
}
