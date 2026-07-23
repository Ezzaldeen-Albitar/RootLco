/**
 * Document metadata data access (P1-15).
 *
 * Every statement carries an explicit `tenant_id` predicate in addition to RLS,
 * per the controlled data-access rules. The privilege surface this repository is
 * written against was read from the live catalog, not assumed:
 *
 * | Relation                  | `app_runtime` may                                             |
 * | ------------------------- | ------------------------------------------------------------- |
 * | `shared.document_categories` | SELECT                                                     |
 * | `shared.documents`        | SELECT · INSERT(id, tenant_id, company_id, branch_id, category_id, title, classification, retention_class, created_by) |
 * | `shared.document_versions`| SELECT · INSERT(…) · UPDATE(status)                           |
 * | `shared.document_links`   | SELECT · INSERT(…) · UPDATE(deleted_at)                       |
 * | `shared.file_scan_results`| SELECT **only**                                               |
 *
 * Two consequences are load-bearing and are stated here so no later reader has
 * to rediscover them:
 *
 *  - **There is no UPDATE grant on `shared.documents` at all.** A document
 *    cannot be renamed, re-classified, archived, or soft-deleted by the request
 *    runtime. Document lifecycle beyond creation is therefore *not* part of
 *    P1-15, and no method here pretends otherwise.
 *  - **The only version transition available is `pending → rejected`**
 *    (`upd_document_versions_reject`). Acceptance additionally requires a
 *    `clean` row in `shared.file_scan_results`, which **no application role may
 *    write**. No scanner exists; none is claimed.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface CategoryRow {
  readonly id: string;
  readonly category_code: string;
  readonly scope: string;
  readonly allowed_content_types: readonly string[];
  readonly max_size_bytes: string;
  readonly default_classification: string;
  readonly default_retention_class: string;
  readonly status: string;
}

export interface DocumentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly company_id: string | null;
  readonly branch_id: string | null;
  readonly category_id: string;
  readonly title: string;
  readonly classification: string;
  readonly retention_class: string;
  readonly legal_hold: boolean;
  readonly status: string;
  readonly record_version: number;
}

export interface VersionRow {
  readonly id: string;
  readonly document_id: string;
  readonly version_number: number;
  readonly storage_key: string;
  readonly content_type: string;
  readonly size_bytes: string;
  readonly status: string;
  readonly company_id: string | null;
  readonly branch_id: string | null;
}

export interface LinkRow {
  readonly id: string;
  readonly document_id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly link_purpose: string;
  readonly deleted_at: string | null;
}

export class DocumentRepository extends Repository {
  protected readonly module = 'shared-services';

  /** Resolves a category by code. Platform categories are visible to every tenant. */
  async findCategoryByCode(db: DbHandle, categoryCode: string): Promise<CategoryRow | null> {
    const context = this.assertContext(db);
    return this.runOne<CategoryRow>(
      db,
      `SELECT id, category_code, scope, allowed_content_types, max_size_bytes,
              default_classification, default_retention_class, status
         FROM shared.document_categories
        WHERE category_code = $1
          AND deleted_at IS NULL
          AND (scope = 'platform' OR tenant_id = $2)
        ORDER BY scope = 'tenant' DESC
        LIMIT 1`,
      [categoryCode, context.principal.tenantId]
    );
  }

  /**
   * Loads a category by its identifier.
   *
   * Used at version registration to re-check the content type and the size
   * ceiling against the **category**, rather than against the unsigned upload
   * token that names them (P1-15-SR-010). The id comes from a document already
   * loaded under RLS, so it is a server-resolved fact and not a caller claim.
   */
  async findCategoryById(db: DbHandle, categoryId: string): Promise<CategoryRow | null> {
    const context = this.assertContext(db);
    return this.runOne<CategoryRow>(
      db,
      `SELECT id, category_code, scope, allowed_content_types, max_size_bytes,
              default_classification, default_retention_class, status
         FROM shared.document_categories
        WHERE id = $1
          AND deleted_at IS NULL
          AND (scope = 'platform' OR tenant_id = $2)`,
      [categoryId, context.principal.tenantId]
    );
  }

  /**
   * Creates document metadata.
   *
   * `id` is generated here rather than by the column default so the storage key
   * — which embeds the document id — can be built before the row exists, in one
   * round trip instead of two. `status` is omitted: the column defaults to
   * `pending` and `guard_document_initial_state` refuses anything else, so
   * supplying it could only ever agree or fail.
   */
  async insertDocument(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly categoryId: string;
      readonly title: string;
      readonly classification: string;
      readonly retentionClass: string;
      readonly companyId: string | null;
      readonly branchId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO shared.documents
         (id, tenant_id, company_id, branch_id, category_id, title,
          classification, retention_class, created_by)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.categoryId,
        input.title,
        input.classification,
        input.retentionClass,
        context.principal.userId,
      ]
    );
    return row?.id ?? null;
  }

  async findDocument(db: DbHandle, documentId: string): Promise<DocumentRow | null> {
    const context = this.assertContext(db);
    return this.runOne<DocumentRow>(
      db,
      `SELECT id, tenant_id, company_id, branch_id, category_id, title, classification,
              retention_class, legal_hold, status, record_version
         FROM shared.documents
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, documentId]
    );
  }

  /**
   * Next version number for a document, serialised by a transaction-scoped
   * advisory lock.
   *
   * ## Why not `SELECT … FROM shared.documents … FOR UPDATE`
   *
   * That was the first implementation, and it cannot work on the deployed role.
   * PostgreSQL requires **UPDATE (or DELETE) privilege** on a table for *any*
   * row-locking clause — `FOR UPDATE`, `FOR NO KEY UPDATE`, even `FOR SHARE` —
   * and DBCR-P1-15-001 deliberately grants `app_runtime` no UPDATE at all on
   * `shared.documents`. The lock was therefore refused with SQLSTATE 42501
   * before the version INSERT was ever attempted, so version registration could
   * not succeed. Found by `tests/backend/p1-15-attachments-notifications.test.ts`,
   * which drove the real service on the real role.
   *
   * The withholding is correct and stays: the request runtime has no business
   * mutating a document row. What was wrong was taking a *lock* that needs a
   * *write* privilege in order to perform a read.
   *
   * ## Why an advisory lock
   *
   * `pg_advisory_xact_lock` needs no table privilege, is scoped to the caller's
   * transaction, and is released by COMMIT or ROLLBACK — so a rolled-back
   * registration cannot leave a lock behind. The key is derived from the tenant
   * and the document, so two documents never contend and two tenants never
   * collide on a shared counter.
   *
   * `uq_document_versions_number` remains the authority: the advisory lock makes
   * a collision rare, and the constraint makes one impossible. A caller that
   * loses the race anyway gets a unique violation, which
   * `AttachmentService.registerVersion` reports as a conflict rather than
   * retrying silently behind their back.
   */
  async nextVersionNumber(db: DbHandle, documentId: string): Promise<number> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `SELECT pg_advisory_xact_lock(
                hashtextextended('shared.document_versions:' || $1::text || ':' || $2::text, 0))`,
      [context.principal.tenantId, documentId]
    );
    const row = await this.runOne<{ next: string }>(
      db,
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
         FROM shared.document_versions
        WHERE tenant_id = $1 AND document_id = $2`,
      [context.principal.tenantId, documentId]
    );
    return Number(row?.next ?? 1);
  }

  async insertVersion(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly documentId: string;
      readonly versionNumber: number;
      readonly storageKey: string;
      readonly contentType: string;
      readonly sizeBytes: number;
      readonly sha256Hex: string;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type,
          size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, decode($8, 'hex'), $9, $9)
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        input.documentId,
        input.versionNumber,
        input.storageKey,
        input.contentType,
        input.sizeBytes,
        input.sha256Hex,
        context.principal.userId,
      ]
    );
    return row?.id ?? null;
  }

  /** A version plus the owning document's scope, for authorization decisions. */
  async findVersion(db: DbHandle, versionId: string): Promise<VersionRow | null> {
    const context = this.assertContext(db);
    return this.runOne<VersionRow>(
      db,
      `SELECT v.id, v.document_id, v.version_number, v.storage_key, v.content_type,
              v.size_bytes, v.status, d.company_id, d.branch_id
         FROM shared.document_versions v
         JOIN shared.documents d
           ON d.tenant_id = v.tenant_id AND d.id = v.document_id
        WHERE v.tenant_id = $1 AND v.id = $2 AND d.deleted_at IS NULL`,
      [context.principal.tenantId, versionId]
    );
  }

  /** The newest version of a document, whatever its state. */
  async findLatestVersion(db: DbHandle, documentId: string): Promise<VersionRow | null> {
    const context = this.assertContext(db);
    return this.runOne<VersionRow>(
      db,
      `SELECT v.id, v.document_id, v.version_number, v.storage_key, v.content_type,
              v.size_bytes, v.status, d.company_id, d.branch_id
         FROM shared.document_versions v
         JOIN shared.documents d
           ON d.tenant_id = v.tenant_id AND d.id = v.document_id
        WHERE v.tenant_id = $1 AND v.document_id = $2 AND d.deleted_at IS NULL
        ORDER BY v.version_number DESC
        LIMIT 1`,
      [context.principal.tenantId, documentId]
    );
  }

  /**
   * Rejects a pending version. Returns the affected row count.
   *
   * The `status = 'pending'` predicate mirrors the RLS `USING` clause. Both are
   * kept: RLS is the guarantee, the predicate states the intent and makes a
   * zero-row result mean "not pending" rather than "policy refused it", which
   * are indistinguishable from the driver's point of view.
   */
  async rejectVersion(db: DbHandle, versionId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE shared.document_versions
          SET status = 'rejected'
        WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
      [context.principal.tenantId, versionId]
    );
    return result.rowCount ?? 0;
  }

  /** Scan verdicts recorded for a version. Read-only for every application role. */
  async scanVerdicts(db: DbHandle, versionId: string): Promise<readonly string[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ scan_status: string }>(
      db,
      `SELECT scan_status FROM shared.file_scan_results
        WHERE tenant_id = $1 AND version_id = $2
        ORDER BY scanned_at`,
      [context.principal.tenantId, versionId]
    );
    return result.rows.map((row) => row.scan_status);
  }

  async insertLink(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly documentId: string;
      readonly entityType: string;
      readonly entityId: string;
      readonly linkPurpose: string;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO shared.document_links
         (id, tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        input.documentId,
        input.entityType,
        input.entityId,
        input.linkPurpose,
        context.principal.userId,
      ]
    );
    return row?.id ?? null;
  }

  async findLink(db: DbHandle, linkId: string): Promise<LinkRow | null> {
    const context = this.assertContext(db);
    return this.runOne<LinkRow>(
      db,
      `SELECT id, document_id, entity_type, entity_id, link_purpose, deleted_at
         FROM shared.document_links
        WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, linkId]
    );
  }

  /** Withdraws a link. Only `deleted_at` is grantable, so this is the whole update. */
  async withdrawLink(db: DbHandle, linkId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE shared.document_links
          SET deleted_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, linkId]
    );
    return result.rowCount ?? 0;
  }

  /** Live links for a document — the reachability contract, in one place. */
  async liveLinks(db: DbHandle, documentId: string): Promise<readonly LinkRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<LinkRow>(
      db,
      `SELECT id, document_id, entity_type, entity_id, link_purpose, deleted_at
         FROM shared.document_links
        WHERE tenant_id = $1 AND document_id = $2 AND deleted_at IS NULL
        ORDER BY linked_at`,
      [context.principal.tenantId, documentId]
    );
    return result.rows;
  }
}
