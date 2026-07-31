/**
 * Document metadata READS and retention evaluation — request runtime (P1-23).
 *
 * P1-15 built the document write lifecycle. This is the read half, plus the one
 * thing the phase adds that is not a read at all: retention *evaluation*.
 *
 * ## Retention is delegated, not reimplemented
 *
 * `shared.document_deletion_eligibility(tenant, document)` already exists as a
 * protected function, is documented read-only, and is granted to
 * `app_runtime`. It decides the whole question — legal hold always wins, active
 * links block, retention is measured from `created_at` against the class
 * definition — and returns one of a fixed set of reason codes.
 *
 * Reimplementing that in TypeScript would mean two answers to one question that
 * could drift apart, and the drift would be invisible until a document was
 * deleted that should not have been. So this repository calls the function and
 * projects what it says.
 *
 * Nothing here deletes anything. There is no destructive path in this file at
 * all, which is why "dry run" needs no flag: it is the only mode that exists.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** The reason codes `shared.document_deletion_eligibility` can return. */
export type EligibilityCode =
  | 'eligible'
  | 'not_found'
  | 'already_archived'
  | 'active_links'
  | 'legal_hold'
  | 'class_undefined'
  | 'class_no_delete'
  | 'retention_indefinite'
  | 'retention_not_elapsed';

export interface DocumentRow {
  readonly id: string;
  readonly category_id: string;
  readonly title: string;
  readonly classification: string;
  /** NOT NULL by schema: every document carries a retention class. */
  readonly retention_class: string;
  readonly status: string;
  readonly company_id: string | null;
  readonly branch_id: string | null;
  readonly legal_hold: boolean;
  readonly record_version: number;
  readonly created_at: Date;
  readonly archived_at: Date | null;
}

export class DocumentReadRepository extends Repository {
  protected readonly module = 'shared-services';

  /**
   * Reads one document's metadata.
   *
   * The tenant predicate is written out even though RLS also enforces it: a
   * repository that relies on RLS alone is one `SET ROLE` away from returning
   * another tenant's row, and the redundancy costs nothing.
   *
   * The storage key is NOT selected. It is a locator that travels outside RLS
   * into every downstream system that touches it, and a metadata read has no
   * use for one — downloads go through the P1-15 download-authorization
   * operation, which issues a short-lived signed URL instead.
   */
  async find(db: DbHandle, id: string): Promise<DocumentRow | null> {
    const context = this.assertContext(db);
    return this.runOne<DocumentRow>(
      db,
      `SELECT id, category_id, title, classification, retention_class, status,
              company_id, branch_id, legal_hold, record_version, created_at, archived_at
         FROM shared.documents
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, id]
    );
  }

  /**
   * Asks the protected function whether a document could be disposed of.
   *
   * The tenant is taken from the request context and passed explicitly, so the
   * function cannot be pointed at another tenant's document even though it runs
   * with the caller's own privileges.
   */
  async evaluateEligibility(db: DbHandle, id: string): Promise<EligibilityCode> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ reason: EligibilityCode }>(
      db,
      `SELECT shared.document_deletion_eligibility($1, $2) AS reason`,
      [context.principal.tenantId, id]
    );
    // The function is total — it returns 'not_found' rather than NULL — so a
    // NULL here would mean the contract changed underneath us.
    return row?.reason ?? 'not_found';
  }

  /** Active (unreleased) legal holds on one document. */
  async countActiveLegalHolds(db: DbHandle, id: string): Promise<number> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ total: string }>(
      db,
      `SELECT count(*)::text AS total
         FROM shared.legal_holds
        WHERE tenant_id = $1 AND document_id = $2 AND released_at IS NULL`,
      [context.principal.tenantId, id]
    );
    return Number(row?.total ?? '0');
  }
}
