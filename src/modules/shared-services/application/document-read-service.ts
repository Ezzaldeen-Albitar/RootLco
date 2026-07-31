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
 * Two of the reason codes mean NO POLICY EXISTS YET, and are surfaced as such
 * rather than flattened into "not eligible":
 *
 *   * `class_undefined`  — the document's retention class has no row at all, so
 *                          there is nothing to apply.
 *   * `retention_indefinite` — the class permits deletion but defines no
 *                          MINIMUM retention. The seeded classes describe that
 *                          state as "retention is owner- and
 *                          jurisdiction-defined": a duration nobody has
 *                          configured, not a decision to keep forever.
 *
 * `policyDecided` is false for both. It is true for `class_no_delete`, which IS
 * a decision — `immutable-financial-history` is never eligible by design — and
 * that pair is the whole reason the flag exists rather than a single boolean.
 *
 * Today `retention_indefinite` is the answer for `operational`,
 * `evidence-audit` and `personal-data` alike, so `policyDecided: false` is the
 * honest state of most of this system. Saying otherwise would be inventing a
 * retention policy, which this phase must not do.
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
  readonly categoryId: string;
  readonly title: string;
  readonly classification: string;
  readonly retentionClass: string;
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
  readonly retentionClass: string;
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
/**
 * The verdicts that mean NOBODY HAS DECIDED, as opposed to a decision to keep.
 *
 * `retention_indefinite` belongs here, and putting it in the other set was a
 * defect worth naming. It is returned when the class permits deletion but its
 * `min_retention_days` is NULL — and the seeded classes describe exactly that
 * state as "retention is owner- and jurisdiction-defined", i.e. not configured
 * yet. Reporting `policyDecided: true` for it claimed a decision that has not
 * been made, which is the kind of quiet invention this phase is forbidden from
 * making.
 *
 * `class_no_delete` deliberately stays OUT: a class that forbids deletion is a
 * real decision, and `immutable-financial-history` is the case that proves the
 * two are different.
 *
 * Both members matter. `class_undefined` alone made the flag vacuous, because
 * that verdict is unreachable — the CHECK constraint on
 * `shared.documents.retention_class` admits exactly the class codes
 * `shared.retention_classes` seeds — so `policyDecided` was `true` in every
 * state a caller could actually reach.
 */
const UNDECIDED: ReadonlySet<string> = new Set<EligibilityCode>([
  'class_undefined',
  'retention_indefinite',
]);

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
      categoryId: row.category_id,
      title: row.title,
      classification: row.classification,
      retentionClass: row.retention_class,
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
        { field: 'retention_class', classification: 'internal', value: row.retention_class },
        // Recorded explicitly so the audit trail states, on every evaluation,
        // that nothing was destroyed. A later phase that adds deletion must not
        // be able to reuse this record to imply approval.
        { field: 'deletion_performed', classification: 'internal', value: 'false' },
      ],
    });

    return {
      documentId,
      retentionClass: row.retention_class,
      eligibility,
      disposable: eligibility === 'eligible',
      policyDecided: !UNDECIDED.has(eligibility),
      activeLegalHolds,
      deletionPerformed: false,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
