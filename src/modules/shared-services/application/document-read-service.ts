/**
 * Document metadata reads and retention evaluation (P1-23).
 *
 * ## Retention stays decision-neutral, and refuses rather than guesses
 *
 * Retention durations are an OPEN DECISION. This service therefore never
 * invents a number of days, never deletes anything, and never claims legal
 * compliance. What it does is evaluate — through the protected function that
 * already owns the rule — and report.
 *
 * Two of the reason codes are the decision-neutral ones and are surfaced as
 * such rather than being flattened into "not eligible":
 *
 *   * `class_undefined`  — the document has no retention class, so no policy
 *                          exists to apply. The correct answer is a controlled
 *                          configuration result, not a default.
 *   * `retention_indefinite` — the class exists and defines no maximum, which
 *                          is a decision to keep, not an absence of one.
 *
 * `policyDecided` is false for the first and true for the second, and that
 * distinction is the whole reason both are reported instead of one boolean.
 *
 * There is no destructive path in this service. "Dry run" is not a mode here
 * because deletion is not implemented at all — when it is, it belongs behind a
 * port and behind an owner-approved policy, and the eligibility answer this
 * service already returns is its precondition.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import type { DocumentReadRepository, EligibilityCode } from '../data/document-read-repository';

export interface DocumentView {
  readonly documentId: string;
  readonly categoryCode: string;
  readonly retentionClassCode: string | null;
  readonly status: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly legalHold: boolean;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface RetentionEvaluation {
  readonly documentId: string;
  readonly retentionClassCode: string | null;
  /** The protected function's verdict, reported verbatim. */
  readonly eligibility: EligibilityCode;
  /** True only when the function says 'eligible'. */
  readonly disposable: boolean;
  /**
   * False when no policy exists to apply (`class_undefined`). A caller must be
   * able to tell "we decided to keep this" from "nobody has decided anything",
   * because only the second is a configuration gap.
   */
  readonly policyDecided: boolean;
  readonly activeLegalHolds: number;
  /** Always false in P1-23: no destructive path exists. */
  readonly deletionPerformed: false;
  readonly evaluatedAt: string;
}

/** Codes that mean "no approved policy exists to apply here". */
const UNDECIDED: ReadonlySet<string> = new Set<EligibilityCode>(['class_undefined']);

export class DocumentReadService extends ApplicationService {
  protected readonly module = 'shared-services';

  constructor(private readonly repository: DocumentReadRepository) {
    super();
  }

  async read(db: DbHandle, documentId: string): Promise<DocumentView> {
    const row = await this.repository.find(db, documentId);
    if (row === null) {
      throw new AppFailure('ERR-DOC-001', { message: 'Document not found.' });
    }
    return {
      documentId: row.id,
      categoryCode: row.category_code,
      retentionClassCode: row.retention_class_code,
      status: row.status,
      companyId: row.company_id,
      branchId: row.branch_id,
      legalHold: row.legal_hold,
      recordVersion: row.record_version,
      createdAt: row.created_at.toISOString(),
      archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
    };
  }

  /**
   * Evaluates whether a document could be disposed of. Evaluates only.
   *
   * Audited because knowing which records are near the end of their retention
   * is itself information about the business, and because the operation exists
   * to inform a future destructive decision — the record of who asked is part
   * of what makes that decision reviewable.
   */
  async evaluateRetention(db: DbHandle, documentId: string): Promise<RetentionEvaluation> {
    const row = await this.repository.find(db, documentId);
    if (row === null) {
      throw new AppFailure('ERR-DOC-001', { message: 'Document not found.' });
    }

    const eligibility = await this.repository.evaluateEligibility(db, documentId);
    const activeLegalHolds = await this.repository.countActiveLegalHolds(db, documentId);

    await appendAudit(db, {
      action: 'shared.document.retention_evaluated',
      entityType: 'shared.document',
      entityId: documentId,
      companyId: row.company_id,
      branchId: row.branch_id,
      details: [
        { field: 'eligibility', classification: 'internal', value: eligibility },
        {
          field: 'retention_class',
          classification: 'internal',
          value: row.retention_class_code ?? 'undefined',
        },
        // Recorded explicitly so the audit trail states, on every evaluation,
        // that nothing was destroyed. A later phase that adds deletion must not
        // be able to reuse this record to imply approval.
        { field: 'deletion_performed', classification: 'internal', value: 'false' },
      ],
    });

    return {
      documentId,
      retentionClassCode: row.retention_class_code,
      eligibility,
      disposable: eligibility === 'eligible',
      policyDecided: !UNDECIDED.has(eligibility),
      activeLegalHolds,
      deletionPerformed: false,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
