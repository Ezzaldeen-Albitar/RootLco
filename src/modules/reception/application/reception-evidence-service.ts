/**
 * Pre-service condition evidence — application service (Phase 1-18,
 * P1-18-BE-011…P1-18-BE-017).
 *
 * Three commands, one shape: lock the visit, refuse a terminal one, insert, audit.
 * Everything runs in the transaction the route opened, so a complaint and its
 * narrative — or a contents line and its restricted description — are never half
 * written.
 *
 * ## One command, eight evidence kinds
 *
 * Canonical Field 23 allocates a single endpoint for pre-service condition
 * evidence, so `recordConditionEvidence` takes a discriminated union rather than
 * spreading eight near-identical endpoints across the surface. Signature and
 * refusal are deliberately NOT members of that union: they record what a party
 * personally acknowledged or declined, they carry their own permission, and they
 * must not be reachable by a caller who holds only evidence-capture authority.
 * They are separate methods here for the same reason.
 *
 * ## Why the input types live in this layer
 *
 * `domain/reception-evidence.ts` owns the vocabularies, the bounds, and the
 * validators; it does not declare the command shapes. They are declared here and
 * built exclusively from the domain's validators, so no rule is restated — the
 * union is the request contract, and the rules behind it stay in one place.
 *
 * ## What the database remains the authority on
 *
 * `rec.guard_condition_item_open` (a finding needs an open inspection),
 * `rec.guard_damage_map_version` and `rec.guard_signature_version` (a version
 * must belong to its document), `rec.guard_refusal_reason` (an archived reason is
 * refused), and every vocabulary CHECK. A version the tenant cannot see arrives
 * as `23503` and becomes a 404; a version that belongs to a different document,
 * or a value outside a frozen vocabulary, arrives as `23514` and becomes a 422.
 * Neither ever reaches a caller as a driver error.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type {
  EvidenceScope,
  ReceptionEvidenceRepository,
} from '../data/reception-evidence-repository';
import type { ReceptionRepository, ReceptionVisitLockRow } from '../data/reception-repository';
import { assertEvidenceRecordable, assertMayAuthorize } from '../domain/reception';
import {
  EvidenceRuleError,
  MAX_COMPLAINT_TEXT,
  MAX_ITEM_DESCRIPTION,
  MAX_LOCATION,
  MAX_MAP_TYPE,
  MAX_NOTE,
  MAX_ZONE,
  assertCoordinate,
  assertDeclaredValue,
  assertRefusalAttributable,
  assertQuantity,
  optionalNonBlank,
  requireNonBlank,
  type ComplaintCategory,
  type ComplaintSeverity,
  type DamageMarkType,
  type EvidenceKind,
  type FindingCategory,
  type FindingSeverity,
  type RefusalType,
  type SignatureCaptureMethod,
  type SignaturePurpose,
  type SignerRole,
} from '../domain/reception-evidence';

/**
 * Maximum `signature_hash` size, from `ck_signatures_hash_len`.
 *
 * The wire form is lowercase hex because the column is `bytea` and JSON has no
 * byte type; hex is decoded here rather than in the repository so the repository
 * keeps taking the value the column actually stores.
 */
const MAX_SIGNATURE_HASH_BYTES = 64;
const LOWERCASE_HEX_PAIRS = /^(?:[0-9a-f]{2})+$/;

export interface ComplaintEvidence {
  readonly kind: 'complaint';
  readonly category: ComplaintCategory;
  readonly severity?: ComplaintSeverity | undefined;
  /** The customer's own words. Stored `restricted` and gated at the database. */
  readonly complaintText: string;
  readonly reportedByPartnerId?: string | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export interface InspectionEvidence {
  readonly kind: 'inspection';
  readonly inspectorId: string;
}

export interface ConditionItemEvidence {
  readonly kind: 'condition_item';
  readonly inspectionId: string;
  readonly findingCategory: FindingCategory;
  readonly vehicleZone: string;
  readonly severity?: FindingSeverity | undefined;
  readonly findingNote?: string | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export interface DamageMapEvidence {
  readonly kind: 'damage_map';
  readonly documentId: string;
  readonly documentVersionId: string;
  /** Frozen `ck_damage_maps_type`: exterior, interior, undercarriage, or other. */
  readonly mapType: string;
  readonly perspective?: string | null | undefined;
}

export interface DamageMarkEvidence {
  readonly kind: 'damage_mark';
  readonly damageMapId: string;
  readonly markType: DamageMarkType;
  readonly vehicleZone: string;
  /** Fractions of the map, 0..1, so a mark survives any rendering size. */
  readonly coordX: number;
  readonly coordY: number;
  readonly note?: string | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export interface ContentsEvidence {
  readonly kind: 'contents';
  /** What the customer left in the vehicle. Stored `restricted`. */
  readonly itemDescription: string;
  readonly quantity?: number | undefined;
  readonly location?: string | null | undefined;
  readonly declaredValue?: number | null | undefined;
  readonly declaredCurrency?: string | null | undefined;
  readonly declaredByPartnerId?: string | null | undefined;
  readonly witnessedByEmployeeId?: string | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export interface WarningLightEvidence {
  readonly kind: 'warning_light';
  readonly warningLightCodeId: string;
  /** Frozen `ck_warning_light_observations_state`: on, flashing, or intermittent. */
  readonly observedState?: string | undefined;
  readonly note?: string | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export interface LeakEvidence {
  readonly kind: 'leak';
  /** Frozen `ck_leak_observations_type`: oil, coolant, fuel, brake_fluid, and so on. */
  readonly leakType: string;
  readonly vehicleZone: string;
  readonly severity?: FindingSeverity | undefined;
  readonly note?: string | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export type ConditionEvidenceInput =
  | ComplaintEvidence
  | InspectionEvidence
  | ConditionItemEvidence
  | DamageMapEvidence
  | DamageMarkEvidence
  | ContentsEvidence
  | WarningLightEvidence
  | LeakEvidence;

export interface SignatureInput {
  readonly signerRole: SignerRole;
  readonly signerPartnerId?: string | null | undefined;
  readonly signatureDocumentId: string;
  readonly signatureDocumentVersionId: string;
  readonly captureMethod: SignatureCaptureMethod;
  readonly purpose: SignaturePurpose;
  /** Lowercase hex, at most 64 bytes. Never the drawn image itself. */
  readonly signatureHash?: string | null | undefined;
}

export interface RefusalInput {
  readonly refusalType: RefusalType;
  readonly refusalReasonId?: string | null | undefined;
  readonly refusingPartnerId?: string | null | undefined;
  readonly witnessEmployeeId?: string | null | undefined;
  readonly evidenceDocumentId?: string | null | undefined;
}

export interface ConditionEvidenceRecorded {
  readonly receptionVisitId: string;
  readonly kind: EvidenceKind;
  readonly evidenceId: string;
}

export interface SignatureRecorded {
  readonly receptionVisitId: string;
  readonly signatureId: string;
  readonly purpose: SignaturePurpose;
}

export interface RefusalRecorded {
  readonly receptionVisitId: string;
  readonly refusalId: string;
  readonly refusalType: RefusalType;
}

/** The row an evidence insert produced, and the table it landed in. */
interface InsertedEvidence {
  readonly evidenceTable: string;
  readonly evidenceId: string;
}

export class ReceptionEvidenceService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(
    private readonly evidence: ReceptionEvidenceRepository,
    private readonly receptions: ReceptionRepository
  ) {
    super();
  }

  async recordConditionEvidence(
    db: DbHandle,
    receptionVisitId: string,
    input: ConditionEvidenceInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ConditionEvidenceRecorded> {
    const visit = await this.requireRecordableVisit(db, receptionVisitId, authorizeScope);
    const scope: EvidenceScope = { companyId: visit.companyId, branchId: visit.branchId };

    let inserted: InsertedEvidence;
    try {
      inserted = await this.insertEvidence(db, scope, receptionVisitId, input);
    } catch (error) {
      throw this.mapEvidenceFailure(error);
    }

    await appendAudit(db, {
      action: 'rec.reception.evidence_recorded',
      // The visit, not the evidence table. One action code covers eight tables,
      // and `audit-actions.ts` pins its entity type to `rec.reception_visit` so
      // every producer of this fact files it under the same entity and one audit
      // query over a visit returns all of its evidence. Which table the row landed
      // in is a detail, recorded below.
      entityType: 'rec.reception_visit',
      entityId: receptionVisitId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        // The kind and the table, never the content: a complaint narrative and a
        // contents description are `restricted` data and live in the row this
        // record points at, not in the audit trail.
        { field: 'evidence_kind', classification: 'public', value: input.kind },
        { field: 'evidence_table', classification: 'public', value: inserted.evidenceTable },
        { field: 'evidence_id', classification: 'internal', value: inserted.evidenceId },
      ],
    });

    return { receptionVisitId, kind: input.kind, evidenceId: inserted.evidenceId };
  }

  async recordSignature(
    db: DbHandle,
    receptionVisitId: string,
    input: SignatureInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<SignatureRecorded> {
    const visit = await this.requireRecordableVisit(db, receptionVisitId, authorizeScope);
    const signatureHash = this.decodeSignatureHash(input.signatureHash);

    let signatureId: string | null;
    try {
      signatureId = await this.evidence.insertSignature(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        signerRole: input.signerRole,
        signerPartnerId: input.signerPartnerId ?? null,
        signatureDocumentId: input.signatureDocumentId,
        signatureDocumentVersionId: input.signatureDocumentVersionId,
        captureMethod: input.captureMethod,
        purpose: input.purpose,
        signatureHash,
      });
    } catch (error) {
      throw this.mapEvidenceFailure(error);
    }
    const id = this.requireId(signatureId, 'Recording the signature');

    await appendAudit(db, {
      action: 'rec.reception.signature_recorded',
      entityType: 'rec.signature',
      entityId: id,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'reception_visit_id', classification: 'internal', value: receptionVisitId },
        { field: 'signer_role', classification: 'public', value: input.signerRole },
        { field: 'purpose', classification: 'public', value: input.purpose },
        { field: 'capture_method', classification: 'public', value: input.captureMethod },
      ],
    });

    return { receptionVisitId, signatureId: id, purpose: input.purpose };
  }

  async recordRefusal(
    db: DbHandle,
    receptionVisitId: string,
    input: RefusalInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<RefusalRecorded> {
    const visit = await this.requireRecordableVisit(db, receptionVisitId, authorizeScope);

    // An `authorization` refusal is part of the standing authorization decision,
    // so it has to name the party whose decision it is — see
    // `assertRefusalAttributable`.
    this.ruleOrFail(
      () => assertRefusalAttributable(input.refusalType, input.refusingPartnerId),
      'body.refusingPartnerId'
    );

    // And that party must actually be entitled to authorize, because this row now
    // governs the authorization gate.
    //
    // Recording a `declined` in `rec.authorizations` costs
    // `rec.reception.authorization.verify` and passes two authority layers —
    // `assertAuthorizingRoleHeld` and the frozen
    // `rec.guard_authorization_authority`. Folding authorization refusals into the
    // standing decision without an equivalent check would have made
    // `rec.reception.signature.manage` the cheaper way to block a reception
    // indefinitely, and would have written a permanent, append-only claim that an
    // uninvolved partner refused — `fk_refusals_partner` is tenant-wide, and the
    // only BEFORE INSERT trigger on `rec.refusals` early-returns when no reason
    // code is supplied. The same authority the blocking decision needs is required
    // here, with the same non-disclosing refusal.
    if (input.refusalType === 'authorization') {
      assertMayAuthorize(
        await this.receptions.activePartyRoles(
          db,
          receptionVisitId,
          input.refusingPartnerId as string
        )
      );
    }

    let refusalId: string | null;
    try {
      refusalId = await this.evidence.insertRefusal(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        refusalType: input.refusalType,
        refusalReasonId: input.refusalReasonId ?? null,
        refusingPartnerId: input.refusingPartnerId ?? null,
        witnessEmployeeId: input.witnessEmployeeId ?? null,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
      });
    } catch (error) {
      throw this.mapEvidenceFailure(error);
    }
    const id = this.requireId(refusalId, 'Recording the refusal');

    await appendAudit(db, {
      action: 'rec.reception.refusal_recorded',
      entityType: 'rec.refusal',
      entityId: id,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'reception_visit_id', classification: 'internal', value: receptionVisitId },
        { field: 'refusal_type', classification: 'public', value: input.refusalType },
        // The reason is a governed code, so recording it discloses no narrative.
        {
          field: 'refusal_reason_id',
          classification: 'internal',
          value: input.refusalReasonId ?? null,
        },
      ],
    });

    return { receptionVisitId, refusalId: id, refusalType: input.refusalType };
  }

  /**
   * Validates and inserts one evidence kind.
   *
   * Each branch validates with the domain's own helpers and then writes. The two
   * kinds with a parent inside `rec` — a finding under an inspection, a mark on a
   * map — resolve that parent first, scoped to this visit, because the composite
   * foreign keys only reach as far as the branch: a parent belonging to another
   * visit in the same branch would satisfy the constraint and bind the evidence to
   * the wrong vehicle.
   */
  private async insertEvidence(
    db: DbHandle,
    scope: EvidenceScope,
    receptionVisitId: string,
    input: ConditionEvidenceInput
  ): Promise<InsertedEvidence> {
    switch (input.kind) {
      case 'complaint': {
        const complaintText = this.ruleOrFail(
          () => requireNonBlank(input.complaintText, 'complaintText', MAX_COMPLAINT_TEXT),
          'body.complaintText'
        );
        const complaintId = this.requireId(
          await this.evidence.insertComplaint(db, {
            ...scope,
            receptionVisitId,
            category: input.category,
            severity: input.severity ?? 'medium',
            reportedByPartnerId: input.reportedByPartnerId ?? null,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
          }),
          'Recording the complaint'
        );
        // The narrative is a separate row so the metadata stays readable to staff
        // who may not open `restricted` data. Both rows are one insert decision.
        this.requireId(
          await this.evidence.insertComplaintDetail(db, { ...scope, complaintId, complaintText }),
          'Recording the complaint narrative'
        );
        return { evidenceTable: 'rec.complaints', evidenceId: complaintId };
      }

      case 'inspection': {
        const inspectionId = this.requireId(
          await this.evidence.insertInspection(db, {
            ...scope,
            receptionVisitId,
            inspectorId: input.inspectorId,
          }),
          'Opening the inspection'
        );
        return { evidenceTable: 'rec.visual_inspections', evidenceId: inspectionId };
      }

      case 'condition_item': {
        const vehicleZone = this.ruleOrFail(
          () => requireNonBlank(input.vehicleZone, 'vehicleZone', MAX_ZONE),
          'body.vehicleZone'
        );
        const findingNote = this.ruleOrFail(
          () => optionalNonBlank(input.findingNote, 'findingNote', MAX_NOTE),
          'body.findingNote'
        );
        await this.requireParent(
          this.evidence.inspectionExists(db, receptionVisitId, input.inspectionId),
          'Inspection was not found on this reception'
        );
        const itemId = this.requireId(
          await this.evidence.insertConditionItem(db, {
            ...scope,
            inspectionId: input.inspectionId,
            findingCategory: input.findingCategory,
            vehicleZone,
            severity: input.severity ?? 'minor',
            findingNote,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
          }),
          'Recording the inspection finding'
        );
        return { evidenceTable: 'rec.condition_items', evidenceId: itemId };
      }

      case 'damage_map': {
        const mapType = this.ruleOrFail(
          () => requireNonBlank(input.mapType, 'mapType', MAX_MAP_TYPE),
          'body.mapType'
        );
        // The column bounds `perspective` only as non-blank; the module bounds it
        // with the map-type limit rather than accepting an unbounded string, since
        // both are the same kind of short descriptor of one map.
        const perspective = this.ruleOrFail(
          () => optionalNonBlank(input.perspective, 'perspective', MAX_MAP_TYPE),
          'body.perspective'
        );
        const mapId = this.requireId(
          await this.evidence.insertDamageMap(db, {
            ...scope,
            receptionVisitId,
            documentId: input.documentId,
            documentVersionId: input.documentVersionId,
            mapType,
            perspective,
          }),
          'Binding the damage map'
        );
        return { evidenceTable: 'rec.damage_maps', evidenceId: mapId };
      }

      case 'damage_mark': {
        const vehicleZone = this.ruleOrFail(
          () => requireNonBlank(input.vehicleZone, 'vehicleZone', MAX_ZONE),
          'body.vehicleZone'
        );
        const note = this.ruleOrFail(
          () => optionalNonBlank(input.note, 'note', MAX_NOTE),
          'body.note'
        );
        this.ruleOrFail(() => assertCoordinate(input.coordX, 'coordX'), 'body.coordX');
        this.ruleOrFail(() => assertCoordinate(input.coordY, 'coordY'), 'body.coordY');
        await this.requireParent(
          this.evidence.damageMapExists(db, receptionVisitId, input.damageMapId),
          'Damage map was not found on this reception'
        );
        const markId = this.requireId(
          await this.evidence.insertDamageMark(db, {
            ...scope,
            damageMapId: input.damageMapId,
            markType: input.markType,
            vehicleZone,
            coordX: input.coordX,
            coordY: input.coordY,
            note,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
          }),
          'Placing the damage mark'
        );
        return { evidenceTable: 'rec.damage_marks', evidenceId: markId };
      }

      case 'contents': {
        const itemDescription = this.ruleOrFail(
          () => requireNonBlank(input.itemDescription, 'itemDescription', MAX_ITEM_DESCRIPTION),
          'body.itemDescription'
        );
        const location = this.ruleOrFail(
          () => optionalNonBlank(input.location, 'location', MAX_LOCATION),
          'body.location'
        );
        const quantity = input.quantity ?? 1;
        this.ruleOrFail(() => assertQuantity(quantity), 'body.quantity');
        const declaredValue = input.declaredValue ?? null;
        if (declaredValue !== null) {
          this.ruleOrFail(() => assertDeclaredValue(declaredValue), 'body.declaredValue');
        }
        const contentId = this.requireId(
          await this.evidence.insertContents(db, {
            ...scope,
            receptionVisitId,
            quantity,
            location,
            declaredByPartnerId: input.declaredByPartnerId ?? null,
            witnessedByEmployeeId: input.witnessedByEmployeeId ?? null,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
          }),
          'Recording the vehicle contents'
        );
        this.requireId(
          await this.evidence.insertContentDetail(db, {
            ...scope,
            contentId,
            itemDescription,
            declaredValue,
            declaredCurrency: input.declaredCurrency ?? null,
          }),
          'Recording the contents description'
        );
        return { evidenceTable: 'rec.vehicle_contents', evidenceId: contentId };
      }

      case 'warning_light': {
        const note = this.ruleOrFail(
          () => optionalNonBlank(input.note, 'note', MAX_NOTE),
          'body.note'
        );
        const observationId = this.requireId(
          await this.evidence.insertWarningLight(db, {
            ...scope,
            receptionVisitId,
            warningLightCodeId: input.warningLightCodeId,
            observedState: input.observedState ?? 'on',
            note,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
          }),
          'Recording the warning light'
        );
        return { evidenceTable: 'rec.warning_light_observations', evidenceId: observationId };
      }

      case 'leak': {
        const vehicleZone = this.ruleOrFail(
          () => requireNonBlank(input.vehicleZone, 'vehicleZone', MAX_ZONE),
          'body.vehicleZone'
        );
        const note = this.ruleOrFail(
          () => optionalNonBlank(input.note, 'note', MAX_NOTE),
          'body.note'
        );
        const observationId = this.requireId(
          await this.evidence.insertLeak(db, {
            ...scope,
            receptionVisitId,
            leakType: input.leakType,
            vehicleZone,
            severity: input.severity ?? 'minor',
            note,
            evidenceDocumentId: input.evidenceDocumentId ?? null,
          }),
          'Recording the leak'
        );
        return { evidenceTable: 'rec.leak_observations', evidenceId: observationId };
      }
    }
  }

  /** Locks the visit and refuses one that is closed to further evidence. */
  /**
   * Locks the visit, authorizes against ITS branch, then checks recordability
   * (P1-18-A-01).
   *
   * Order matters. The three evidence commands are addressed by the visit id, so
   * the route-level check had no scope to evaluate and fell back to the
   * scope-blind `iam.has_permission`; RLS narrows on the permission-blind union
   * of the caller's grants and so admits the row too. Authorizing here, before
   * the terminal-state test and before any write, means a caller outside this
   * branch is refused without learning the visit's lifecycle state, and the
   * denial rolls back the transaction so no evidence, signature, refusal, audit
   * row or outbox envelope survives.
   */
  private async requireRecordableVisit(
    db: DbHandle,
    receptionVisitId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceptionVisitLockRow> {
    const visit = await this.receptions.lockVisit(db, receptionVisitId);
    if (!visit) {
      throw new AppFailure('ERR-RES-001', { message: 'Reception was not found' });
    }
    // Authorize BEFORE the lifecycle test, so a caller outside this branch is
    // refused without learning whether the visit is still open for evidence.
    await authorizeScope({ companyId: visit.companyId, branchId: visit.branchId });
    assertEvidenceRecordable(visit.receptionStatus);
    return visit;
  }

  /**
   * Refuses a parent the caller cannot see on this visit.
   *
   * Reported as a 404 rather than a foreign-key error: a parent in another visit
   * or another tenant must be indistinguishable from one that does not exist.
   */
  private async requireParent(check: Promise<boolean>, message: string): Promise<void> {
    if (!(await check)) {
      throw new AppFailure('ERR-RES-001', { message });
    }
  }

  /**
   * Decodes the caller's hex signature hash.
   *
   * The bound and the encoding are both checked here so an over-long or malformed
   * hash is a named 422 instead of `ck_signatures_hash_len` aborting the command.
   */
  private decodeSignatureHash(value: string | null | undefined): Buffer | null {
    if (value === undefined || value === null || value.length === 0) return null;
    if (!LOWERCASE_HEX_PAIRS.test(value)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'signatureHash must be lowercase hexadecimal with an even number of digits',
        safeDetails: { violations: [{ path: 'body.signatureHash', rule: 'invalid_format' }] },
      });
    }
    if (value.length > MAX_SIGNATURE_HASH_BYTES * 2) {
      throw new AppFailure('ERR-VAL-001', {
        message: `signatureHash must be at most ${MAX_SIGNATURE_HASH_BYTES} bytes`,
        safeDetails: { violations: [{ path: 'body.signatureHash', rule: 'too_big' }] },
      });
    }
    return Buffer.from(value, 'hex');
  }

  /** A null id means a row-level policy refused the insert, not that it succeeded. */
  private requireId(value: string | null, subject: string): string {
    if (!value) {
      throw new AppFailure('ERR-IAM-001', { message: `${subject} was refused by policy` });
    }
    return value;
  }

  /** Maps the frozen evidence-guard SQLSTATEs; re-throws anything else. */
  private mapEvidenceFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
      // Two evidence kinds write a RESTRICTED narrative row - a complaint's text
      // (`rec.complaint_details`) and a contents description
      // (`rec.vehicle_content_details`). The frozen INSERT policies on both end
      // with `AND iam.has_permission('iam.sensitive.view')`, so recording those
      // two kinds needs that capability IN ADDITION to the operation's declared
      // `rec.reception.evidence.manage`. That composition is deliberate and is
      // not folded into the operation's permission list: a damage mark or a
      // warning light carries no personal narrative and must not require a
      // sensitive-data capability to record.
      //
      // Without this branch the refusal escaped as ERR-SYS-001, reporting an
      // authorization decision as a server fault and sending it to the exception
      // monitor. It is a denial, so it leaves as one.
      return new AppFailure('ERR-IAM-001', {
        message:
          'Recording this evidence requires permission to handle restricted ' +
          'customer narrative in addition to reception evidence capture',
      });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_warning_light_observations_active: the same lamp is observed once per
      // visit, so a repeat is a duplicate rather than a second observation.
      return new AppFailure('ERR-RES-002', {
        message: 'That observation is already recorded on this reception',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      // Includes the version guards' "not visible to this tenant" branch, which
      // must read as a missing resource rather than as a hint that it exists.
      return new AppFailure('ERR-RES-001', {
        message: 'A referenced document, version, party, or catalog code was not found',
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // A document version that belongs to a different document, a value outside a
      // frozen vocabulary, or `rec.guard_condition_item_open` refusing a finding
      // on an inspection that is no longer in progress. All three arrive as 23514
      // and none is distinguishable from the SQLSTATE, so the message names the
      // categories instead of guessing one.
      return new AppFailure('ERR-VAL-001', {
        message:
          'The evidence was refused: a document version must belong to its document, a coded value must be one the reception contract recognises, and a finding needs an inspection that is still in progress',
        safeDetails: { violations: [{ path: 'body', rule: 'incoherent_reference' }] },
      });
    }
    return error;
  }

  /**
   * Turns a domain rule violation into the platform's validation problem. The
   * path comes from the call site because `EvidenceRuleError` carries a message
   * and no field reference.
   */
  private ruleOrFail<T>(build: () => T, path: string): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof EvidenceRuleError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path, rule: 'invalid_value' }] },
          cause: error,
        });
      }
      throw error;
    }
  }
}
