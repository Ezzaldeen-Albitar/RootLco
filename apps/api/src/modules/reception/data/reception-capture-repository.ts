/**
 * Reception capture-contract repository (Owner decisions FE-012, FE-018, FE-019).
 *
 * The only place SQL for the evidence-binding, capture-policy, damage-map
 * template and signature-lifecycle tables is written.
 *
 * Two rules shape every statement here:
 *
 *  - **`company_id` and `branch_id` never come from a request.** They come from
 *    the visit the service already locked, or from the template slot the service
 *    already read. A caller that merely knows a branch id must not be able to
 *    file evidence into it.
 *  - **The database keeps its authority.** The category of a document version,
 *    the live business link, the acceptance state, the active template revision
 *    and every permission are decided by triggers and row-level policies, not
 *    by a predicate written here. This layer supplies the values and reports
 *    what came back; it never restates a rule the schema already owns, because
 *    a restated rule is one that can disagree.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type {
  CapturePolicyRefusalType,
  CapturePolicyRequirement,
  CaptureQualityStatus,
  CaptureRequirement,
  DamageMapTemplateType,
  SignatureEventType,
  SignatureStatus,
} from '../domain/reception-capture';

/** Branch scope every visit-owned row inherits from its reception visit. */
export interface CaptureScope {
  readonly companyId: string;
  readonly branchId: string;
}

export interface CapturePolicyRow {
  readonly id: string;
  readonly requirementCode: CapturePolicyRequirement;
  readonly refusalType: CapturePolicyRefusalType | null;
  readonly minCount: number;
  readonly deviceCapturedAtRequired: boolean;
  readonly witnessRequired: boolean;
  readonly scope: 'tenant' | 'branch';
  readonly effectiveAt: string;
}

export interface CaptureBindingRow {
  readonly id: string;
  readonly requirementCode: CaptureRequirement;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentVersionStatus: string;
  readonly integritySha256: string | null;
  readonly deviceCapturedAt: string | null;
  readonly qualityStatus: CaptureQualityStatus;
  readonly finalizedAt: string | null;
  readonly finalizedBy: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CaptureOverrideRow {
  readonly id: string;
  readonly requirementCode: CaptureRequirement;
  readonly reason: string;
  readonly actorId: string;
  readonly occurredAt: string;
}

export interface SignatureReadRow {
  readonly id: string;
  readonly signerRole: string;
  readonly signerPartnerId: string | null;
  readonly captureMethod: string;
  readonly purpose: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentVersionStatus: string;
  /** The version checksum, server-owned. Null until the store records one. */
  readonly integritySha256: string | null;
  readonly signedAt: string;
  readonly actorId: string;
  readonly replacesSignatureId: string | null;
  readonly replacedBySignatureId: string | null;
  readonly finalizedAt: string | null;
  readonly repudiatedAt: string | null;
  readonly repudiationReason: string | null;
  readonly status: SignatureStatus;
}

export interface DamageMapTemplateRow {
  readonly id: string;
  readonly scope: 'tenant' | 'branch';
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly mapType: string;
  readonly perspective: string | null;
  readonly status: string;
  readonly recordVersion: number;
  readonly activeVersionId: string | null;
  readonly activeVersionNumber: number | null;
  readonly documentId: string | null;
  readonly documentVersionId: string | null;
}

export interface DamageMapTemplateVersionRow {
  readonly id: string;
  readonly versionNumber: number;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly retiredAt: string | null;
}

/** The scope of a template slot, read before any write against it. */
export interface TemplateSlotScope {
  readonly id: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly mapType: string;
  readonly perspective: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

interface PolicySqlRow {
  id: string;
  requirement_code: CapturePolicyRequirement;
  refusal_type: CapturePolicyRefusalType | null;
  min_count: number;
  device_captured_at_required: boolean;
  witness_required: boolean;
  scope: 'tenant' | 'branch';
  effective_at: Date;
}

interface BindingSqlRow {
  id: string;
  requirement_code: CaptureRequirement;
  document_id: string;
  document_version_id: string;
  document_version_status: string;
  integrity_sha256: string | null;
  device_captured_at: Date | null;
  quality_status: CaptureQualityStatus;
  finalized_at: Date | null;
  finalized_by: string | null;
  created_at: Date;
  created_by: string;
}

interface OverrideSqlRow {
  id: string;
  requirement_code: CaptureRequirement;
  reason: string;
  created_by: string;
  occurred_at: Date;
}

interface SignatureSqlRow {
  id: string;
  signer_role: string;
  signer_partner_id: string | null;
  capture_method: string;
  purpose: string;
  signature_document_id: string;
  signature_document_version_id: string;
  document_version_status: string;
  integrity_sha256: string | null;
  signed_at: Date;
  created_by: string;
  replaces_signature_id: string | null;
  replaced_by_signature_id: string | null;
  finalized_at: Date | null;
  repudiated_at: Date | null;
  repudiation_reason: string | null;
}

interface TemplateSqlRow {
  id: string;
  company_id: string | null;
  branch_id: string | null;
  map_type: string;
  perspective: string | null;
  status: string;
  record_version: number;
  active_version_id: string | null;
  active_version_number: number | null;
  document_id: string | null;
  document_version_id: string | null;
}

interface TemplateVersionSqlRow {
  id: string;
  version_number: number;
  document_id: string;
  document_version_id: string;
  status: string;
  created_at: Date;
  retired_at: Date | null;
}

const templateFromRow = (row: TemplateSqlRow): DamageMapTemplateRow => ({
  id: row.id,
  scope: row.branch_id === null ? 'tenant' : 'branch',
  companyId: row.company_id,
  branchId: row.branch_id,
  mapType: row.map_type,
  perspective: row.perspective,
  status: row.status,
  recordVersion: row.record_version,
  activeVersionId: row.active_version_id,
  activeVersionNumber: row.active_version_number,
  documentId: row.document_id,
  documentVersionId: row.document_version_id,
});

/** The template projection, written once because four reads return it. */
const TEMPLATE_SELECT = `
  SELECT t.id, t.company_id, t.branch_id, t.map_type, t.perspective, t.status,
         t.record_version, tv.id AS active_version_id,
         tv.version_number AS active_version_number,
         tv.document_id, tv.document_version_id
    FROM rec.damage_map_templates t
    LEFT JOIN rec.damage_map_template_versions tv
      ON tv.tenant_id = t.tenant_id AND tv.template_id = t.id AND tv.status = 'active'`;

export class ReceptionCaptureRepository extends Repository {
  protected readonly module = 'reception';

  // ---- Visit scope --------------------------------------------------------

  /**
   * The visit's own company and branch, WITHOUT the row lock.
   *
   * Reads use this and writes use `ReceptionRepository.lockVisit`. Taking
   * `FOR UPDATE` to answer a read would make one operator opening a summary
   * screen block another operator's capture until the read transaction ended.
   */
  async findVisitScope(db: DbHandle, receptionVisitId: string): Promise<CaptureScope | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ company_id: string; branch_id: string }>(
      db,
      `SELECT company_id, branch_id FROM rec.reception_visits
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, receptionVisitId]
    );
    return row ? { companyId: row.company_id, branchId: row.branch_id } : null;
  }

  // ---- Capture policy -----------------------------------------------------

  /**
   * The live rules a branch resolves to, most specific first.
   *
   * `DISTINCT ON` over `(requirement_code, refusal_type)` with the branch-first
   * ordering is the same precedence `rec.guard_refusal_evidence_version()`
   * applies, so what a caller is told is required is what the database will
   * enforce. A tenant that has configured nothing gets zero rows, which is the
   * FE-019 default and not an error.
   */
  async resolvedPolicies(db: DbHandle, branchId: string): Promise<readonly CapturePolicyRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<PolicySqlRow>(
      db,
      `SELECT DISTINCT ON (requirement_code, refusal_type)
              id, requirement_code, refusal_type, min_count,
              device_captured_at_required, witness_required, effective_at,
              CASE WHEN branch_id IS NULL THEN 'tenant' ELSE 'branch' END AS scope
         FROM rec.capture_policy_rules
        WHERE tenant_id = $1 AND retired_at IS NULL AND (branch_id = $2 OR branch_id IS NULL)
        ORDER BY requirement_code, refusal_type,
                 (branch_id IS NOT NULL) DESC, effective_at DESC, id`,
      [context.principal.tenantId, branchId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      requirementCode: row.requirement_code,
      refusalType: row.refusal_type,
      minCount: row.min_count,
      deviceCapturedAtRequired: row.device_captured_at_required,
      witnessRequired: row.witness_required,
      scope: row.scope,
      effectiveAt: row.effective_at.toISOString(),
    }));
  }

  /** Every live rule of the tenant, for the management read-back. */
  async listPolicies(db: DbHandle): Promise<readonly CapturePolicyRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<PolicySqlRow>(
      db,
      `SELECT id, requirement_code, refusal_type, min_count,
              device_captured_at_required, witness_required, effective_at,
              CASE WHEN branch_id IS NULL THEN 'tenant' ELSE 'branch' END AS scope
         FROM rec.capture_policy_rules
        WHERE tenant_id = $1 AND retired_at IS NULL
        ORDER BY requirement_code, refusal_type NULLS FIRST, scope, effective_at DESC, id`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      requirementCode: row.requirement_code,
      refusalType: row.refusal_type,
      minCount: row.min_count,
      deviceCapturedAtRequired: row.device_captured_at_required,
      witnessRequired: row.witness_required,
      scope: row.scope,
      effectiveAt: row.effective_at.toISOString(),
    }));
  }

  /**
   * Retires the live rule for one key, if any.
   *
   * `IS NOT DISTINCT FROM` rather than `=` because `refusal_type` is nullable
   * and an untyped rule is a real key, not an absent one.
   */
  async retirePolicy(
    db: DbHandle,
    input: {
      readonly branchId: string | null;
      readonly requirementCode: CapturePolicyRequirement;
      readonly refusalType: CapturePolicyRefusalType | null;
    }
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE rec.capture_policy_rules SET retired_at = now()
        WHERE tenant_id = $1 AND requirement_code = $2 AND retired_at IS NULL
          AND branch_id IS NOT DISTINCT FROM $3::uuid
          AND refusal_type IS NOT DISTINCT FROM $4::text`,
      [context.principal.tenantId, input.requirementCode, input.branchId, input.refusalType]
    );
    return result.rowCount ?? 0;
  }

  async insertPolicy(
    db: DbHandle,
    input: {
      readonly companyId: string | null;
      readonly branchId: string | null;
      readonly requirementCode: CapturePolicyRequirement;
      readonly refusalType: CapturePolicyRefusalType | null;
      readonly minCount: number;
      readonly deviceCapturedAtRequired: boolean;
      readonly witnessRequired: boolean;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.capture_policy_rules
         (tenant_id, company_id, branch_id, requirement_code, refusal_type, min_count,
          device_captured_at_required, witness_required, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.requirementCode,
        input.refusalType,
        input.minCount,
        input.deviceCapturedAtRequired,
        input.witnessRequired,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // ---- Damage-map templates ----------------------------------------------

  /**
   * The templates a branch may bind a NEW visit to.
   *
   * Active slots with an active revision only, most specific per
   * `(map_type, perspective)` first — a retired slot is absent here and readable
   * through `findTemplate`, which is exactly the FE-012 asymmetry.
   */
  async listBindableTemplates(
    db: DbHandle,
    branchId: string
  ): Promise<readonly DamageMapTemplateRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<TemplateSqlRow>(
      db,
      `SELECT DISTINCT ON (t.map_type, COALESCE(t.perspective, ''))
              t.id, t.company_id, t.branch_id, t.map_type, t.perspective, t.status,
              t.record_version, tv.id AS active_version_id,
              tv.version_number AS active_version_number,
              tv.document_id, tv.document_version_id
         FROM rec.damage_map_templates t
         JOIN rec.damage_map_template_versions tv
           ON tv.tenant_id = t.tenant_id AND tv.template_id = t.id AND tv.status = 'active'
        WHERE t.tenant_id = $1 AND t.status = 'active'
          AND (t.branch_id = $2 OR t.branch_id IS NULL)
        ORDER BY t.map_type, COALESCE(t.perspective, ''),
                 (t.branch_id IS NOT NULL) DESC, t.created_at DESC, t.id`,
      [context.principal.tenantId, branchId]
    );
    return result.rows.map(templateFromRow);
  }

  /** Every slot of the tenant, retired ones included. Management read-back. */
  async listAllTemplates(db: DbHandle): Promise<readonly DamageMapTemplateRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<TemplateSqlRow>(
      db,
      `${TEMPLATE_SELECT}
        WHERE t.tenant_id = $1
        ORDER BY t.map_type, COALESCE(t.perspective, ''), t.created_at, t.id`,
      [context.principal.tenantId]
    );
    return result.rows.map(templateFromRow);
  }

  /** One slot, whatever its status. A retired slot stays readable forever. */
  async findTemplate(db: DbHandle, templateId: string): Promise<DamageMapTemplateRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<TemplateSqlRow>(
      db,
      `${TEMPLATE_SELECT} WHERE t.tenant_id = $1 AND t.id = $2`,
      [context.principal.tenantId, templateId]
    );
    return row ? templateFromRow(row) : null;
  }

  /** The slot's own scope, read before a write so authorization has a target. */
  async findTemplateScope(db: DbHandle, templateId: string): Promise<TemplateSlotScope | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string | null;
      branch_id: string | null;
      map_type: string;
      perspective: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, branch_id, map_type, perspective, status, record_version
         FROM rec.damage_map_templates WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.principal.tenantId, templateId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          mapType: row.map_type,
          perspective: row.perspective,
          status: row.status,
          recordVersion: row.record_version,
        }
      : null;
  }

  /** Every revision of one slot, oldest first. The history FE-012 asks for. */
  async listTemplateVersions(
    db: DbHandle,
    templateId: string
  ): Promise<readonly DamageMapTemplateVersionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<TemplateVersionSqlRow>(
      db,
      `SELECT id, version_number, document_id, document_version_id, status,
              created_at, retired_at
         FROM rec.damage_map_template_versions
        WHERE tenant_id = $1 AND template_id = $2
        ORDER BY version_number`,
      [context.principal.tenantId, templateId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      versionNumber: row.version_number,
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      retiredAt: iso(row.retired_at),
    }));
  }

  async insertTemplate(
    db: DbHandle,
    input: {
      readonly companyId: string | null;
      readonly branchId: string | null;
      readonly mapType: DamageMapTemplateType;
      readonly perspective: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.damage_map_templates
         (tenant_id, company_id, branch_id, map_type, perspective, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.mapType,
        input.perspective,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Retires the slot's active revision, if it has one. */
  async retireActiveTemplateVersion(db: DbHandle, templateId: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE rec.damage_map_template_versions
          SET status = 'retired', retired_at = now(), retired_by = $3
        WHERE tenant_id = $1 AND template_id = $2 AND status = 'active'`,
      [context.principal.tenantId, templateId, context.principal.userId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Publishes the next revision.
   *
   * The number is allocated from the slot's own maximum inside the statement, so
   * two concurrent publishes collide on `uq_damage_map_template_version` rather
   * than silently reusing a number. The caller retires the previous revision
   * first; `uq_damage_map_template_one_active` is what makes that mandatory.
   */
  async insertTemplateVersion(
    db: DbHandle,
    input: {
      readonly templateId: string;
      readonly documentId: string;
      readonly documentVersionId: string;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.damage_map_template_versions
         (tenant_id, template_id, version_number, document_id, document_version_id, created_by)
       SELECT $1, $2, COALESCE(max(version_number), 0) + 1, $3, $4, $5
         FROM rec.damage_map_template_versions
        WHERE tenant_id = $1 AND template_id = $2
       RETURNING id`,
      [
        context.principal.tenantId,
        input.templateId,
        input.documentId,
        input.documentVersionId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Sets the slot status under an optimistic-concurrency guard. */
  async setTemplateStatus(
    db: DbHandle,
    input: {
      readonly templateId: string;
      readonly status: 'active' | 'retired';
      readonly expectedVersion: number;
    }
  ): Promise<number | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ record_version: number }>(
      db,
      `UPDATE rec.damage_map_templates
          SET status = $3, record_version = record_version + 1,
              updated_at = now(), updated_by = $5
        WHERE tenant_id = $1 AND id = $2 AND record_version = $4
       RETURNING record_version`,
      [
        context.principal.tenantId,
        input.templateId,
        input.status,
        input.expectedVersion,
        context.principal.userId,
      ]
    );
    return row?.record_version ?? null;
  }

  // ---- Evidence bindings --------------------------------------------------

  async listBindings(
    db: DbHandle,
    receptionVisitId: string
  ): Promise<readonly CaptureBindingRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<BindingSqlRow>(
      db,
      `SELECT eb.id, eb.requirement_code, eb.document_id, eb.document_version_id,
              dv.status AS document_version_status,
              encode(dv.sha256, 'hex') AS integrity_sha256,
              eb.device_captured_at, eb.quality_status, eb.finalized_at, eb.finalized_by,
              eb.created_at, eb.created_by
         FROM rec.reception_evidence_bindings eb
         JOIN shared.document_versions dv
           ON dv.tenant_id = eb.tenant_id AND dv.id = eb.document_version_id
        WHERE eb.tenant_id = $1 AND eb.reception_visit_id = $2
        ORDER BY eb.requirement_code, eb.created_at, eb.id`,
      [context.principal.tenantId, receptionVisitId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      requirementCode: row.requirement_code,
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      documentVersionStatus: row.document_version_status,
      integritySha256: row.integrity_sha256,
      deviceCapturedAt: iso(row.device_captured_at),
      qualityStatus: row.quality_status,
      finalizedAt: iso(row.finalized_at),
      finalizedBy: row.finalized_by,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
    }));
  }

  async insertBinding(
    db: DbHandle,
    input: CaptureScope & {
      readonly receptionVisitId: string;
      readonly requirementCode: CaptureRequirement;
      readonly documentId: string;
      readonly documentVersionId: string;
      readonly deviceCapturedAt: Date | null;
      readonly qualityStatus: CaptureQualityStatus;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.reception_evidence_bindings
         (tenant_id, company_id, branch_id, reception_visit_id, requirement_code,
          document_id, document_version_id, device_captured_at, quality_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.requirementCode,
        input.documentId,
        input.documentVersionId,
        input.deviceCapturedAt,
        input.qualityStatus,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Finalizes one binding.
   *
   * Deliberately does NOT test the version state: `finalized_at IS NULL` keeps
   * the act idempotent-safe, and acceptance is
   * `rec.guard_reception_evidence_binding()`'s decision. Testing it here as well
   * would give one rule two owners that can disagree, and only one of them runs
   * inside the row lock.
   */
  async finalizeBinding(
    db: DbHandle,
    receptionVisitId: string,
    bindingId: string
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE rec.reception_evidence_bindings
          SET finalized_at = now(), finalized_by = $4
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND id = $3
          AND finalized_at IS NULL`,
      [context.principal.tenantId, receptionVisitId, bindingId, context.principal.userId]
    );
    return result.rowCount ?? 0;
  }

  /** True when the binding exists on this visit, whatever its state. */
  async bindingExists(db: DbHandle, receptionVisitId: string, bindingId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `SELECT 1 FROM rec.reception_evidence_bindings
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND id = $3`,
      [context.principal.tenantId, receptionVisitId, bindingId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ---- Capture overrides --------------------------------------------------

  async listOverrides(
    db: DbHandle,
    receptionVisitId: string
  ): Promise<readonly CaptureOverrideRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<OverrideSqlRow>(
      db,
      `SELECT id, requirement_code, reason, created_by, occurred_at
         FROM rec.capture_requirement_overrides
        WHERE tenant_id = $1 AND reception_visit_id = $2
        ORDER BY occurred_at, id`,
      [context.principal.tenantId, receptionVisitId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      requirementCode: row.requirement_code,
      reason: row.reason,
      actorId: row.created_by,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async insertOverride(
    db: DbHandle,
    input: CaptureScope & {
      readonly receptionVisitId: string;
      readonly requirementCode: CaptureRequirement;
      readonly reason: string;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.capture_requirement_overrides
         (tenant_id, company_id, branch_id, reception_visit_id, requirement_code,
          reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.requirementCode,
        input.reason,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // ---- Signature read-back and lifecycle ----------------------------------

  /**
   * Every signature of a visit, with what became of it.
   *
   * The integrity digest reported is the DOCUMENT VERSION's own `sha256`, not
   * the caller-supplied `signature_hash`: the version checksum is server-owned
   * and immutable, and reporting the value a client sent as "integrity" would
   * be reporting a claim as a fact. `uq_signatures_replaces` is what allows the
   * successor join to stay a single row.
   */
  async listSignatures(
    db: DbHandle,
    receptionVisitId: string
  ): Promise<readonly SignatureReadRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<SignatureSqlRow>(
      db,
      `SELECT s.id, s.signer_role, s.signer_partner_id, s.capture_method, s.purpose,
              s.signature_document_id, s.signature_document_version_id,
              dv.status AS document_version_status,
              encode(dv.sha256, 'hex') AS integrity_sha256,
              s.signed_at, s.created_by, s.replaces_signature_id,
              successor.id AS replaced_by_signature_id,
              fin.occurred_at AS finalized_at,
              rep.occurred_at AS repudiated_at,
              rep.reason AS repudiation_reason
         FROM rec.signatures s
         JOIN shared.document_versions dv
           ON dv.tenant_id = s.tenant_id AND dv.id = s.signature_document_version_id
         LEFT JOIN rec.signatures successor
           ON successor.tenant_id = s.tenant_id AND successor.replaces_signature_id = s.id
         LEFT JOIN rec.signature_events fin
           ON fin.tenant_id = s.tenant_id AND fin.signature_id = s.id
          AND fin.event_type = 'finalized'
         LEFT JOIN rec.signature_events rep
           ON rep.tenant_id = s.tenant_id AND rep.signature_id = s.id
          AND rep.event_type = 'repudiated'
        WHERE s.tenant_id = $1 AND s.reception_visit_id = $2
        ORDER BY s.signed_at, s.id`,
      [context.principal.tenantId, receptionVisitId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      signerRole: row.signer_role,
      signerPartnerId: row.signer_partner_id,
      captureMethod: row.capture_method,
      purpose: row.purpose,
      documentId: row.signature_document_id,
      documentVersionId: row.signature_document_version_id,
      documentVersionStatus: row.document_version_status,
      integritySha256: row.integrity_sha256,
      signedAt: row.signed_at.toISOString(),
      actorId: row.created_by,
      replacesSignatureId: row.replaces_signature_id,
      replacedBySignatureId: row.replaced_by_signature_id,
      finalizedAt: iso(row.finalized_at),
      repudiatedAt: iso(row.repudiated_at),
      repudiationReason: row.repudiation_reason,
      status: row.repudiated_at ? 'repudiated' : row.finalized_at ? 'finalized' : 'draft',
    }));
  }

  /** True when the signature belongs to this visit and is visible in scope. */
  async signatureExists(
    db: DbHandle,
    receptionVisitId: string,
    signatureId: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `SELECT 1 FROM rec.signatures
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND id = $3`,
      [context.principal.tenantId, receptionVisitId, signatureId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async insertSignatureEvent(
    db: DbHandle,
    input: CaptureScope & {
      readonly receptionVisitId: string;
      readonly signatureId: string;
      readonly eventType: SignatureEventType;
      readonly reason: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.signature_events
         (tenant_id, company_id, branch_id, reception_visit_id, signature_id,
          event_type, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.signatureId,
        input.eventType,
        input.reason,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }
}
