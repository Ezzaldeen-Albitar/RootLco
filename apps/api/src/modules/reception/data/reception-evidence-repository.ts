/**
 * Pre-service condition-evidence repository (Phase 1-18, P1-18-BE-011…
 * P1-18-BE-017).
 *
 * The only place `rec` evidence SQL is written. Every table here is branch
 * scoped, so `company_id` and `branch_id` come from the visit the caller already
 * locked — not from the request body — and `tenant_id` and `created_by` come from
 * the context. That is what keeps a caller from filing evidence into a branch it
 * merely knows the name of.
 *
 * Evidence is recorded, never rewritten: `rec.signatures` and `rec.refusals` are
 * INSERT+SELECT only, and the mutable tables carry `correction_of` so a mistake
 * is a linked correction rather than a silent edit. This repository therefore
 * offers inserts and nothing else.
 *
 * Two rows have a parent inside `rec` rather than the visit itself — a condition
 * item hangs off an inspection, a damage mark off a damage map. Both parents are
 * resolved first, scoped to the tenant AND to the visit in the route, because the
 * composite foreign keys only reach as far as the branch: a parent belonging to a
 * different visit in the same branch would otherwise satisfy the constraint and
 * bind the evidence to the wrong vehicle. A parent the caller cannot see is a
 * 404, never a foreign-key error handed back to them.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type {
  ComplaintCategory,
  ComplaintSeverity,
  DamageMarkType,
  FindingCategory,
  FindingSeverity,
  SignatureCaptureMethod,
  SignaturePurpose,
  SignerRole,
} from '../domain/reception-evidence';

/** Branch scope every evidence row inherits from its reception visit. */
export interface EvidenceScope {
  readonly companyId: string;
  readonly branchId: string;
}

export class ReceptionEvidenceRepository extends Repository {
  protected readonly module = 'reception';

  // ---- Parent resolution --------------------------------------------------

  /** True when the inspection belongs to this visit and is visible in scope. */
  async inspectionExists(
    db: DbHandle,
    receptionVisitId: string,
    inspectionId: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `SELECT 1 FROM rec.visual_inspections
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [context.principal.tenantId, receptionVisitId, inspectionId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** True when the damage map belongs to this visit and is visible in scope. */
  async damageMapExists(
    db: DbHandle,
    receptionVisitId: string,
    damageMapId: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `SELECT 1 FROM rec.damage_maps
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [context.principal.tenantId, receptionVisitId, damageMapId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ---- Complaints ---------------------------------------------------------

  /** Inserts the safe complaint metadata. The narrative is a separate row. */
  async insertComplaint(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly category: ComplaintCategory;
      readonly severity: ComplaintSeverity;
      readonly reportedByPartnerId: string | null;
      readonly evidenceDocumentId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.complaints
         (tenant_id, company_id, branch_id, reception_visit_id, reported_by_partner_id,
          category, severity, evidence_document_id, correlation_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.reportedByPartnerId,
        input.category,
        input.severity,
        input.evidenceDocumentId,
        context.correlationId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Inserts the customer's own words. `classification` is left to its fixed
   * `restricted` default: the row is gated at the database by
   * `iam.sensitive.view`, and a caller-supplied classification would be a way to
   * ask for a weaker one.
   */
  async insertComplaintDetail(
    db: DbHandle,
    input: EvidenceScope & {
      readonly complaintId: string;
      readonly complaintText: string;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.complaint_details
         (tenant_id, company_id, branch_id, complaint_id, complaint_text, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.complaintId,
        input.complaintText,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // ---- Visual inspection --------------------------------------------------

  /** Opens an inspection header. `in_progress` and `started_at` are defaults. */
  async insertInspection(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly inspectorId: string;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.visual_inspections
         (tenant_id, company_id, branch_id, reception_visit_id, inspector_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.inspectorId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Records one finding under an inspection. Returns the id. */
  async insertConditionItem(
    db: DbHandle,
    input: EvidenceScope & {
      readonly inspectionId: string;
      readonly findingCategory: FindingCategory;
      readonly vehicleZone: string;
      readonly severity: FindingSeverity;
      readonly findingNote: string | null;
      readonly evidenceDocumentId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.condition_items
         (tenant_id, company_id, branch_id, inspection_id, finding_category, vehicle_zone,
          severity, finding_note, evidence_document_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.inspectionId,
        input.findingCategory,
        input.vehicleZone,
        input.severity,
        input.findingNote,
        input.evidenceDocumentId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // ---- Damage map and marks -----------------------------------------------

  /**
   * Binds the visit to a map template AND the exact document version it was
   * drawn on, so a later revision of the template becomes a new map and the marks
   * already placed never move. `rec.guard_damage_map_version` is the authority on
   * the version belonging to the document.
   */
  async insertDamageMap(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly documentId: string;
      readonly documentVersionId: string;
      readonly mapType: string;
      readonly perspective: string | null;
      /**
       * The managed template revision this map is drawn on (Owner decision
       * FE-012).
       *
       * Optional, because a map recorded before the template contract existed
       * has none and must keep working. When present,
       * `rec.guard_damage_map_template_binding()` requires it to be the ACTIVE
       * revision of an ACTIVE slot and to carry exactly this document and
       * version, so naming a retired revision is refused rather than quietly
       * accepted. The column is immutable once written, which is what makes a
       * historical visit keep its original geometry.
       */
      readonly damageMapTemplateVersionId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.damage_maps
         (tenant_id, company_id, branch_id, reception_visit_id, document_id,
          document_version_id, map_type, perspective, damage_map_template_version_id,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.documentId,
        input.documentVersionId,
        input.mapType,
        input.perspective,
        input.damageMapTemplateVersionId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Places one mark on a map, at normalised 0..1 coordinates. Returns the id. */
  async insertDamageMark(
    db: DbHandle,
    input: EvidenceScope & {
      readonly damageMapId: string;
      readonly markType: DamageMarkType;
      readonly vehicleZone: string;
      readonly coordX: number;
      readonly coordY: number;
      readonly note: string | null;
      readonly evidenceDocumentId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.damage_marks
         (tenant_id, company_id, branch_id, damage_map_id, mark_type, vehicle_zone,
          coord_x, coord_y, note, evidence_document_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.damageMapId,
        input.markType,
        input.vehicleZone,
        input.coordX,
        input.coordY,
        input.note,
        input.evidenceDocumentId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // ---- Vehicle contents ---------------------------------------------------

  /** Inserts the safe contents metadata. The description is a separate row. */
  async insertContents(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly quantity: number;
      readonly location: string | null;
      readonly declaredByPartnerId: string | null;
      readonly witnessedByEmployeeId: string | null;
      readonly evidenceDocumentId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.vehicle_contents
         (tenant_id, company_id, branch_id, reception_visit_id, quantity, location,
          declared_by_partner_id, witnessed_by_employee_id, evidence_document_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.quantity,
        input.location,
        input.declaredByPartnerId,
        input.witnessedByEmployeeId,
        input.evidenceDocumentId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Inserts the restricted item description and its declared value. Left at the
   * fixed `restricted` classification for the same reason as the complaint
   * narrative: what a customer left in their vehicle is theirs, not operational
   * data.
   */
  async insertContentDetail(
    db: DbHandle,
    input: EvidenceScope & {
      readonly contentId: string;
      readonly itemDescription: string;
      readonly declaredValue: number | null;
      readonly declaredCurrency: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.vehicle_content_details
         (tenant_id, company_id, branch_id, content_id, item_description,
          declared_value, declared_currency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.contentId,
        input.itemDescription,
        input.declaredValue,
        input.declaredCurrency,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // ---- Observations -------------------------------------------------------

  /**
   * Records one dashboard warning light. The unique on
   * (reception_visit_id, warning_light_code_id) means a repeat of the same code
   * is a 23505, which the service reports as a duplicate rather than stacking a
   * second observation of the same lamp.
   */
  async insertWarningLight(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly warningLightCodeId: string;
      readonly observedState: string;
      readonly note: string | null;
      readonly evidenceDocumentId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.warning_light_observations
         (tenant_id, company_id, branch_id, reception_visit_id, warning_light_code_id,
          observed_state, note, evidence_document_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.warningLightCodeId,
        input.observedState,
        input.note,
        input.evidenceDocumentId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Records one visible leak. Returns the id. */
  async insertLeak(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly leakType: string;
      readonly vehicleZone: string;
      readonly severity: FindingSeverity;
      readonly note: string | null;
      readonly evidenceDocumentId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.leak_observations
         (tenant_id, company_id, branch_id, reception_visit_id, leak_type, vehicle_zone,
          severity, note, evidence_document_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.leakType,
        input.vehicleZone,
        input.severity,
        input.note,
        input.evidenceDocumentId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  // ---- Signature and refusal ----------------------------------------------

  /**
   * Appends a signature. Only the document and its exact version are stored —
   * never the drawn bytes — so `rec` holds a reference and the media contract
   * keeps deciding who may open it. `rec.guard_signature_version` is the
   * authority on the version belonging to the document.
   */
  async insertSignature(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly signerRole: SignerRole;
      readonly signerPartnerId: string | null;
      readonly signatureDocumentId: string;
      readonly signatureDocumentVersionId: string;
      readonly captureMethod: SignatureCaptureMethod;
      readonly purpose: SignaturePurpose;
      readonly signatureHash: Buffer | null;
      /**
       * The signature this one supersedes (Owner decision FE-018).
       *
       * Replacement is NEW evidence: the superseded row is never updated and
       * never deleted — the table has no grant that would allow either — and
       * both stay readable through the signature read-back.
       * `rec.guard_signature_evidence()` keeps the pair on one visit and
       * `uq_signatures_replaces` keeps the chain single-successor.
       */
      readonly replacesSignatureId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.signatures
         (tenant_id, company_id, branch_id, reception_visit_id, signer_role,
          signer_partner_id, signature_document_id, signature_document_version_id,
          capture_method, purpose, signature_hash, replaces_signature_id,
          correlation_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.signerRole,
        input.signerPartnerId,
        input.signatureDocumentId,
        input.signatureDocumentVersionId,
        input.captureMethod,
        input.purpose,
        input.signatureHash,
        input.replacesSignatureId,
        context.correlationId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Appends a refusal. The reason is a governed code rather than free text, so
   * declining to sign leaves a record with no personal narrative in it.
   * `rec.guard_refusal_reason` refuses an archived code.
   */
  async insertRefusal(
    db: DbHandle,
    input: EvidenceScope & {
      readonly receptionVisitId: string;
      readonly refusalType: string;
      readonly refusalReasonId: string | null;
      readonly refusingPartnerId: string | null;
      readonly witnessEmployeeId: string | null;
      readonly evidenceDocumentId: string | null;
      /**
       * The EXACT version of the supporting media (Owner decision FE-019).
       *
       * Optional, and the shipped contract that supplies a document alone is
       * unchanged: `ck_refusals_evidence_pair` is one-directional, so a version
       * requires its document and a document may still stand alone. What a live
       * `rec.capture_policy_rules` row requires — that a version be present and
       * ACCEPTED — is decided by `rec.guard_refusal_evidence_version()`.
       */
      readonly evidenceDocumentVersionId: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO rec.refusals
         (tenant_id, company_id, branch_id, reception_visit_id, refusal_type,
          refusal_reason_id, refusing_partner_id, witness_employee_id,
          evidence_document_id, evidence_document_version_id, correlation_id,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.refusalType,
        input.refusalReasonId,
        input.refusingPartnerId,
        input.witnessEmployeeId,
        input.evidenceDocumentId,
        input.evidenceDocumentVersionId,
        context.correlationId,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }
}
