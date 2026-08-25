/**
 * Inspection-template authoring — the write layer (PRE-P1-29-BR-04).
 *
 * ## Why this exists
 *
 * `dia.inspection_templates`, `dia.template_versions` and `dia.template_items`
 * held ZERO rows, and no `INSERT` or `UPDATE` against any of the three existed
 * anywhere in `apps/api`. `POST /jobs/{jobId}/inspections` takes a
 * `templateVersionId` and nothing could ever produce one, so diagnostics was not
 * thin or partial — it was **unreachable**, and closure blocker `B4` ("a job
 * requiring diagnostics has no completed diagnostic report") had a subject that
 * could not be brought into existence.
 *
 * ## Nothing here changes SQL
 *
 * The row layer is already complete and already permits this: both guards
 * (`dia.guard_template_version_publish`, `dia.guard_template_item_frozen`), all
 * four CHECK vocabularies, and `GRANT SELECT, INSERT, UPDATE … TO app_runtime` on
 * all three tables ship in `20260722101000_dia_templates_versions_items.sql`.
 * This slice writes no migration against them.
 *
 * ## Tenant-scoped, not branch-scoped, and that is the row layer's decision
 *
 * None of the three tables carries a `company_id` or a `branch_id`, so their RLS
 * policies are pure `tenant_id = iam.current_tenant_id()`. Declaring `branch` on
 * these operations would be a claim the row layer cannot support —
 * `rec.damage_map_templates` can carry a scoped predicate only because it HAS
 * nullable company/branch columns, and these do not.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/** Newest first, matching every other tenant-library read in the platform. */
export const TEMPLATE_ORDER: OrderingContract = Object.freeze({
  key: 'dia.inspection_templates:created_at_desc',
  direction: 'desc',
});

export interface TemplateRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly diagnosticTypeId: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly recordVersion: number;
}

export interface TemplateVersionRow {
  readonly id: string;
  readonly templateId: string;
  readonly versionNumber: number;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly itemCount: number;
  readonly recordVersion: number;
}

export interface TemplateItemRow {
  readonly id: string;
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: string;
  readonly unit: string | null;
  readonly isMandatory: boolean;
  readonly validationRule: unknown;
  readonly sequence: number;
  readonly recordVersion: number;
}

const TEMPLATE_COLUMNS = `id, code, name, diagnostic_type_id, status,
  ${cursorTimestamp('created_at')} AS created_at_cursor, created_at, record_version`;

interface TemplateColumns {
  id: string;
  code: string;
  name: string;
  diagnostic_type_id: string;
  status: string;
  created_at_cursor: string;
  created_at: Date;
  record_version: number;
}

const toTemplate = (row: TemplateColumns): TemplateRow => ({
  id: row.id,
  code: row.code,
  name: row.name,
  diagnosticTypeId: row.diagnostic_type_id,
  status: row.status,
  createdAt: row.created_at,
  recordVersion: row.record_version,
});

/** One publishable version, joined to the template that owns it. */
export interface PublishableVersionRow {
  readonly versionId: string;
  readonly templateId: string;
  readonly templateCode: string;
  readonly templateName: string;
  readonly diagnosticTypeId: string;
  readonly versionNumber: number;
  readonly itemCount: number;
}

interface PublishableColumns {
  version_id: string;
  template_id: string;
  template_code: string;
  template_name: string;
  diagnostic_type_id: string;
  version_number: number;
  item_count: string;
}

export class TemplateAuthoringRepository extends Repository {
  protected readonly module = 'diagnostics';

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  async createTemplate(
    db: DbHandle,
    input: { readonly code: string; readonly name: string; readonly diagnosticTypeId: string }
  ): Promise<TemplateRow> {
    const context = this.assertContext(db);
    const result = await this.run<TemplateColumns>(
      db,
      `INSERT INTO dia.inspection_templates
         (tenant_id, code, name, diagnostic_type_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${TEMPLATE_COLUMNS}`,
      [
        context.principal.tenantId,
        input.code,
        input.name,
        input.diagnosticTypeId,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('inspection template insert returned no row');
    return toTemplate(row);
  }

  async readTemplate(db: DbHandle, templateId: string): Promise<TemplateRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<TemplateColumns>(
      db,
      `SELECT ${TEMPLATE_COLUMNS} FROM dia.inspection_templates
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, templateId]
    );
    const row = result.rows[0];
    return row === undefined ? null : toTemplate(row);
  }

  /** Version-guarded. Only `name` and `status` are writable; `code` is not offered. */
  async updateTemplate(
    db: DbHandle,
    templateId: string,
    input: {
      readonly name?: string | undefined;
      readonly status?: string | undefined;
      readonly expectedVersion: number;
    }
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE dia.inspection_templates
          SET name = COALESCE($4, name),
              status = COALESCE($5, status),
              record_version = record_version + 1,
              updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND record_version = $6 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        templateId,
        context.principal.userId,
        input.name ?? null,
        input.status ?? null,
        input.expectedVersion,
      ]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async pageTemplates(
    db: DbHandle,
    filter: {
      readonly status?: string | undefined;
      readonly diagnosticTypeId?: string | undefined;
    },
    page: PageRequest
  ): Promise<Page<TemplateRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.status ?? null,
      filter.diagnosticTypeId ?? null,
    ];
    // `nextParamIndex` is the index of the NEXT placeholder, so it is one PAST
    // the values already bound. Passing `values.length` instead makes LIMIT reuse
    // the last bound value — which fails as `argument of LIMIT must be type
    // bigint, not type uuid` rather than as a wrong page, so it is caught, but
    // only by a test that actually pages.
    const keyset = keysetFragment(
      page,
      { sort: 'created_at', id: 'id' },
      TEMPLATE_ORDER,
      values.length + 1
    );
    const result = await this.run<TemplateColumns>(
      db,
      `SELECT ${TEMPLATE_COLUMNS} FROM dia.inspection_templates
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND ($2::text IS NULL OR status = $2)
          AND ($3::uuid IS NULL OR diagnostic_type_id = $3)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows = result.rows.map((row) => ({ ...toTemplate(row), cursor: row.created_at_cursor }));
    return buildPage(rows, page, TEMPLATE_ORDER, (row) => ({ sortValue: row.cursor, id: row.id }));
  }

  /**
   * The check the single-column foreign key cannot make.
   *
   * `dia.diagnostic_types` is DUAL-SCOPE: a platform row carries
   * `tenant_id IS NULL`, so it cannot participate in a composite key and the
   * database cannot decide whether this tenant may reference it. Same shape as
   * `tech.skills` in BR-03, and the same reason the service has to ask.
   */
  async diagnosticTypeVisible(db: DbHandle, diagnosticTypeId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run<{ one: number }>(
      db,
      `SELECT 1 AS one FROM dia.diagnostic_types
        WHERE id = $2 AND deleted_at IS NULL AND status = 'active'
          AND (scope = 'platform' OR tenant_id = $1)`,
      [context.principal.tenantId, diagnosticTypeId]
    );
    return result.rows.length === 1;
  }

  // ---------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------

  /**
   * `version_number` is SERVER-ASSIGNED as `max + 1`, never client-supplied.
   *
   * `ck_template_versions_number` guards the VALUE (`> 0`) and says nothing about
   * the sequence, so a client-chosen number is a collision waiting to happen and
   * a re-labelling of published history waiting to be argued about. The row is
   * locked first so two concurrent creates cannot both read the same maximum.
   */
  async nextVersionNumber(db: DbHandle, templateId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run<{ next: number }>(
      db,
      `SELECT COALESCE(max(version_number), 0) + 1 AS next
         FROM dia.template_versions
        WHERE tenant_id = $1 AND template_id = $2`,
      [context.principal.tenantId, templateId]
    );
    return Number(result.rows[0]?.next ?? 1);
  }

  async createVersion(
    db: DbHandle,
    input: { readonly templateId: string; readonly versionNumber: number }
  ): Promise<TemplateVersionRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_id: string;
      version_number: number;
      status: string;
      published_at: string | null;
      record_version: number;
    }>(
      db,
      `INSERT INTO dia.template_versions (tenant_id, template_id, version_number, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, template_id, version_number, status,
                 published_at::text AS published_at, record_version`,
      [context.principal.tenantId, input.templateId, input.versionNumber, context.principal.userId]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('template version insert returned no row');
    return {
      id: row.id,
      templateId: row.template_id,
      versionNumber: row.version_number,
      status: row.status,
      publishedAt: row.published_at,
      itemCount: 0,
      recordVersion: row.record_version,
    };
  }

  /** Every version of one template, newest first, each carrying its item count. */
  async versionsOf(db: DbHandle, templateId: string): Promise<TemplateVersionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_id: string;
      version_number: number;
      status: string;
      published_at: string | null;
      item_count: string;
      record_version: number;
    }>(
      db,
      `SELECT v.id, v.template_id, v.version_number, v.status,
              v.published_at::text AS published_at, v.record_version,
              (SELECT count(*) FROM dia.template_items i
                WHERE i.tenant_id = v.tenant_id AND i.template_version_id = v.id
                  AND i.deleted_at IS NULL)::text AS item_count
         FROM dia.template_versions v
        WHERE v.tenant_id = $1 AND v.template_id = $2 AND v.deleted_at IS NULL
        ORDER BY v.version_number DESC`,
      [context.principal.tenantId, templateId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      templateId: row.template_id,
      versionNumber: row.version_number,
      status: row.status,
      publishedAt: row.published_at,
      itemCount: Number(row.item_count),
      recordVersion: row.record_version,
    }));
  }

  async lockVersion(db: DbHandle, versionId: string): Promise<TemplateVersionRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_id: string;
      version_number: number;
      status: string;
      published_at: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, template_id, version_number, status,
              published_at::text AS published_at, record_version
         FROM dia.template_versions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, versionId]
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      templateId: row.template_id,
      versionNumber: row.version_number,
      status: row.status,
      publishedAt: row.published_at,
      itemCount: 0,
      recordVersion: row.record_version,
    };
  }

  async countItems(db: DbHandle, versionId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM dia.template_items
        WHERE tenant_id = $1 AND template_version_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, versionId]
    );
    return Number(result.rows[0]?.n ?? '0');
  }

  /**
   * The status move. `dia.guard_template_version_publish` owns the graph —
   * `draft → published → retired`, nothing else — and stamps `published_at`
   * itself, so neither is restated here.
   */
  async setVersionStatus(
    db: DbHandle,
    versionId: string,
    toStatus: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE dia.template_versions
          SET status = $3, record_version = record_version + 1, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, versionId, toStatus, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  async insertItem(
    db: DbHandle,
    input: {
      readonly versionId: string;
      readonly itemCode: string;
      readonly prompt: string;
      readonly responseType: string;
      readonly unit?: string | undefined;
      readonly isMandatory: boolean;
      readonly validationRule?: unknown;
      readonly sequence: number;
    }
  ): Promise<TemplateItemRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      item_code: string;
      prompt: string;
      response_type: string;
      unit: string | null;
      is_mandatory: boolean;
      validation_rule: unknown;
      sequence: number;
      record_version: number;
    }>(
      db,
      `INSERT INTO dia.template_items
         (tenant_id, template_version_id, item_code, prompt, response_type, unit,
          is_mandatory, validation_rule, sequence, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       RETURNING id, item_code, prompt, response_type, unit, is_mandatory,
                 validation_rule, sequence, record_version`,
      [
        context.principal.tenantId,
        input.versionId,
        input.itemCode,
        input.prompt,
        input.responseType,
        input.unit ?? null,
        input.isMandatory,
        input.validationRule === undefined ? null : JSON.stringify(input.validationRule),
        input.sequence,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('template item insert returned no row');
    return {
      id: row.id,
      itemCode: row.item_code,
      prompt: row.prompt,
      responseType: row.response_type,
      unit: row.unit,
      isMandatory: row.is_mandatory,
      validationRule: row.validation_rule,
      sequence: row.sequence,
      recordVersion: row.record_version,
    };
  }

  /** The next free sequence, so a caller may omit it and still get a stable order. */
  async nextItemSequence(db: DbHandle, versionId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run<{ next: number }>(
      db,
      `SELECT COALESCE(max(sequence), 0) + 1 AS next FROM dia.template_items
        WHERE tenant_id = $1 AND template_version_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, versionId]
    );
    return Number(result.rows[0]?.next ?? 1);
  }

  /** Copies one version's live item set onto another. Used by `copyFromVersionId`. */
  async copyItems(db: DbHandle, fromVersionId: string, toVersionId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `INSERT INTO dia.template_items
         (tenant_id, template_version_id, item_code, prompt, response_type, unit,
          is_mandatory, validation_rule, sequence, created_by)
       SELECT tenant_id, $3, item_code, prompt, response_type, unit,
              is_mandatory, validation_rule, sequence, $4
         FROM dia.template_items
        WHERE tenant_id = $1 AND template_version_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, fromVersionId, toVersionId, context.principal.userId]
    );
    return result.rowCount ?? 0;
  }

  async itemsOf(db: DbHandle, versionId: string): Promise<TemplateItemRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      item_code: string;
      prompt: string;
      response_type: string;
      unit: string | null;
      is_mandatory: boolean;
      validation_rule: unknown;
      sequence: number;
      record_version: number;
    }>(
      db,
      `SELECT id, item_code, prompt, response_type, unit, is_mandatory,
              validation_rule, sequence, record_version
         FROM dia.template_items
        WHERE tenant_id = $1 AND template_version_id = $2 AND deleted_at IS NULL
        ORDER BY sequence ASC, id ASC`,
      [context.principal.tenantId, versionId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      itemCode: row.item_code,
      prompt: row.prompt,
      responseType: row.response_type,
      unit: row.unit,
      isMandatory: row.is_mandatory,
      validationRule: row.validation_rule,
      sequence: row.sequence,
      recordVersion: row.record_version,
    }));
  }

  /**
   * The publishable set: `published` versions of `active` templates.
   *
   * Exactly the set `POST /jobs/{jobId}/inspections` will accept — which is the
   * point. Without this read a technician must be handed a `templateVersionId`
   * from somewhere, which is `INS-04` in a different costume.
   */
  async publishableVersions(db: DbHandle): Promise<PublishableVersionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<PublishableColumns>(
      db,
      `SELECT v.id AS version_id, t.id AS template_id, t.code AS template_code,
              t.name AS template_name, t.diagnostic_type_id, v.version_number,
              (SELECT count(*) FROM dia.template_items i
                WHERE i.tenant_id = v.tenant_id AND i.template_version_id = v.id
                  AND i.deleted_at IS NULL)::text AS item_count
         FROM dia.template_versions v
         JOIN dia.inspection_templates t
           ON t.tenant_id = v.tenant_id AND t.id = v.template_id
        WHERE v.tenant_id = $1
          AND v.status = 'published' AND v.deleted_at IS NULL
          AND t.status = 'active'    AND t.deleted_at IS NULL
        ORDER BY t.code ASC, v.version_number DESC`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      versionId: row.version_id,
      templateId: row.template_id,
      templateCode: row.template_code,
      templateName: row.template_name,
      diagnosticTypeId: row.diagnostic_type_id,
      versionNumber: row.version_number,
      itemCount: Number(row.item_count),
    }));
  }
}
