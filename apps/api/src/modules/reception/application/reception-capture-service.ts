/**
 * Reception capture contract — application service (Owner decisions FE-012,
 * FE-018, FE-019).
 *
 * ## What this service is for
 *
 * P1-18 could record evidence. It could not say what evidence a visit OWED, it
 * could not bind a damage map to a governed template revision, and a signature
 * was a row that nothing ever validated as complete. This service closes those
 * three gaps and nothing else:
 *
 *  - **FE-012** — a damage-map template is a managed slot with numbered
 *    revisions. A visit binds to an EXACT revision; a revised or retired
 *    template is unavailable for a NEW visit and stays readable for every visit
 *    already bound to it. Administering the slots costs `rec.catalogue.manage`,
 *    which no capture permission implies: choosing the diagram every workshop
 *    draws on is a configuration decision, not a receptionist's.
 *  - **FE-018** — a signature binds an exact ACCEPTED document version. It
 *    becomes evidence only when it is FINALIZED, and finalization is refused
 *    while the version is anything other than accepted. A correction is a new
 *    signature naming the one it supersedes; the superseded row is never
 *    touched, because `rec.signatures` has no UPDATE or DELETE grant at all.
 *  - **FE-019** — refusal supporting media is OPTIONAL by default. A tenant or
 *    a branch may raise the floor for a particular refusal type through
 *    `rec.capture_policy_rules`, and the absence of a rule is the default. This
 *    service publishes and reads those rules; the guard enforces them.
 *
 * ## Where the authority lives
 *
 * Every rule that could be bypassed by calling a different code path is in the
 * database, not here:
 *
 *   - the document category a requirement accepts, the live business link, and
 *     the refusal of a `rejected` or `quarantined` version —
 *     `rec.guard_reception_evidence_binding()`;
 *   - "only an accepted version may be finalized" — the same guard, and
 *     `rec.guard_signature_event()` for signatures;
 *   - "a retired template revision cannot be bound to a new visit" —
 *     `rec.guard_damage_map_template_binding()`;
 *   - who may write any of it — the row-level policies, which name
 *     `rec.reception.evidence.manage`, `rec.reception.evidence.override`,
 *     `rec.reception.signature.manage` and `rec.catalogue.manage` directly.
 *
 * This layer supplies the values, orders the statements inside the route's
 * transaction, turns each frozen SQLSTATE into a stable problem, and writes the
 * audit record. It restates no rule, because a restated rule is one that can
 * disagree with the one that is actually enforced.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type {
  CaptureBindingRow,
  CaptureOverrideRow,
  CapturePolicyRow,
  CaptureScope,
  DamageMapTemplateRow,
  DamageMapTemplateVersionRow,
  ReceptionCaptureRepository,
  SignatureReadRow,
} from '../data/reception-capture-repository';
import type { ReceptionRepository, ReceptionVisitLockRow } from '../data/reception-repository';
import { assertEvidenceRecordable } from '../domain/reception';
import { EvidenceRuleError, optionalNonBlank, requireNonBlank } from '../domain/reception-evidence';
import {
  BASELINE_CAPTURE_RULES,
  CAPTURE_REQUIREMENTS,
  MAX_CAPTURE_COUNT,
  MAX_CAPTURE_OVERRIDE_REASON,
  MAX_REPUDIATION_REASON,
  MAX_TEMPLATE_PERSPECTIVE,
  type CapturePolicyRefusalType,
  type CapturePolicyRequirement,
  type CaptureQualityStatus,
  type CaptureRequirement,
  type DamageMapTemplateType,
  type SignatureEventType,
} from '../domain/reception-capture';

export interface EvidenceBindingInput {
  readonly requirementCode: CaptureRequirement;
  readonly documentId: string;
  readonly documentVersionId: string;
  /** When the capturing device says the media was taken. Never trusted as a fact. */
  readonly deviceCapturedAt?: string | null | undefined;
  readonly qualityStatus?: CaptureQualityStatus | undefined;
}

export interface EvidenceBindingRecorded {
  readonly receptionVisitId: string;
  readonly bindingId: string;
  readonly requirementCode: CaptureRequirement;
}

export interface EvidenceBindingFinalized {
  readonly receptionVisitId: string;
  readonly bindingId: string;
  readonly finalized: true;
}

export interface CaptureOverrideInput {
  readonly requirementCode: CaptureRequirement;
  readonly reason: string;
}

export interface CaptureOverrideRecorded {
  readonly receptionVisitId: string;
  readonly overrideId: string;
  readonly requirementCode: CaptureRequirement;
}

/** One requirement, what it needs, and what it has. */
export interface CaptureRequirementState {
  readonly requirementCode: CaptureRequirement;
  readonly minCount: number;
  readonly deviceCapturedAtRequired: boolean;
  readonly source: 'tenant' | 'branch' | 'baseline';
  readonly finalizedCount: number;
  readonly recordedCount: number;
  readonly satisfied: boolean;
  readonly overridden: boolean;
}

export interface CaptureContract {
  readonly receptionVisitId: string;
  readonly requirements: readonly CaptureRequirementState[];
  readonly bindings: readonly CaptureBindingRow[];
  readonly overrides: readonly CaptureOverrideRow[];
  readonly bindableTemplates: readonly DamageMapTemplateRow[];
  /**
   * How many diagrams this branch has published and can no longer bind.
   *
   * Present so the desk can tell "never published" from "published and since
   * retired": with only `bindableTemplates`, both are an empty array, and the
   * screen stated the first in both cases. A count and not the rows — the desk
   * needs to know THAT one exists to say so honestly, and the retired slots
   * themselves are catalogue administration behind `rec.catalogue.manage`.
   */
  readonly retiredPublishedTemplateCount: number;
}

export interface SignatureLedger {
  readonly receptionVisitId: string;
  readonly signatures: readonly SignatureReadRow[];
}

export interface SignatureEventInput {
  readonly eventType: SignatureEventType;
  readonly reason?: string | null | undefined;
}

export interface SignatureEventRecorded {
  readonly receptionVisitId: string;
  readonly signatureId: string;
  readonly eventId: string;
  readonly eventType: SignatureEventType;
}

export interface DamageMapTemplateInput {
  readonly mapType: DamageMapTemplateType;
  readonly perspective?: string | null | undefined;
  readonly companyId?: string | null | undefined;
  readonly branchId?: string | null | undefined;
}

export interface DamageMapTemplateVersionInput {
  readonly documentId: string;
  readonly documentVersionId: string;
}

export interface DamageMapTemplateView {
  readonly template: DamageMapTemplateRow;
  readonly versions: readonly DamageMapTemplateVersionRow[];
}

export interface CapturePolicyInput {
  readonly requirementCode: CapturePolicyRequirement;
  readonly refusalType?: CapturePolicyRefusalType | null | undefined;
  readonly minCount: number;
  readonly deviceCapturedAtRequired?: boolean | undefined;
  readonly witnessRequired?: boolean | undefined;
  readonly companyId?: string | null | undefined;
  readonly branchId?: string | null | undefined;
}

export interface CapturePolicySet {
  readonly policyId: string;
  readonly requirementCode: CapturePolicyRequirement;
  readonly refusalType: CapturePolicyRefusalType | null;
  readonly scope: 'tenant' | 'branch';
}

export class ReceptionCaptureService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(
    private readonly capture: ReceptionCaptureRepository,
    private readonly receptions: ReceptionRepository
  ) {
    super();
  }

  // ---- Evidence bindings --------------------------------------------------

  /**
   * Binds one document version to one capture requirement of a visit.
   *
   * The binding starts UNFINALIZED even when the version is already accepted,
   * so recording what was captured and declaring it sufficient stay two acts.
   * That is what makes the finalize gate meaningful rather than a formality a
   * single insert could satisfy.
   */
  async recordEvidenceBinding(
    db: DbHandle,
    receptionVisitId: string,
    input: EvidenceBindingInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<EvidenceBindingRecorded> {
    const visit = await this.requireRecordableVisit(db, receptionVisitId, authorizeScope);
    const deviceCapturedAt = this.parseInstant(input.deviceCapturedAt);

    let bindingId: string | null;
    try {
      bindingId = await this.capture.insertBinding(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        requirementCode: input.requirementCode,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        deviceCapturedAt,
        qualityStatus: input.qualityStatus ?? 'readable',
      });
    } catch (error) {
      throw this.mapCaptureFailure(error);
    }
    const id = this.requireId(bindingId, 'Binding the capture evidence');

    await appendAudit(db, {
      action: 'rec.reception.capture_evidence_bound',
      entityType: 'rec.reception_visit',
      entityId: receptionVisitId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'requirement_code', classification: 'public', value: input.requirementCode },
        { field: 'binding_id', classification: 'internal', value: id },
        // The version, never the bytes and never a signed URL: the media
        // contract keeps deciding who may open it.
        {
          field: 'document_version_id',
          classification: 'internal',
          value: input.documentVersionId,
        },
      ],
    });

    return { receptionVisitId, bindingId: id, requirementCode: input.requirementCode };
  }

  /**
   * Declares one binding sufficient.
   *
   * Refuses a binding the caller cannot see on this visit as a 404 before the
   * UPDATE, so a zero-row result can only mean "already finalized" — and that is
   * reported as a conflict rather than a silent success, because a replay that
   * quietly reports success would hide a second actor finalizing evidence the
   * caller believes it finalized itself.
   */
  async finalizeEvidenceBinding(
    db: DbHandle,
    receptionVisitId: string,
    bindingId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<EvidenceBindingFinalized> {
    const visit = await this.requireRecordableVisit(db, receptionVisitId, authorizeScope);
    if (!(await this.capture.bindingExists(db, receptionVisitId, bindingId))) {
      throw new AppFailure('ERR-RES-001', {
        message: 'Evidence binding was not found on this reception',
      });
    }

    let changed: number;
    try {
      changed = await this.capture.finalizeBinding(db, receptionVisitId, bindingId);
    } catch (error) {
      throw this.mapCaptureFailure(error);
    }
    if (changed === 0) {
      throw new AppFailure('ERR-RES-002', {
        message: 'That evidence binding is already finalized',
      });
    }

    await appendAudit(db, {
      action: 'rec.reception.capture_evidence_finalized',
      entityType: 'rec.reception_visit',
      entityId: receptionVisitId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [{ field: 'binding_id', classification: 'internal', value: bindingId }],
    });

    return { receptionVisitId, bindingId, finalized: true };
  }

  /**
   * Records that a required capture was deliberately not taken.
   *
   * The route declares `rec.reception.evidence.override` and
   * `ins_capture_requirement_overrides` names the same code, so the capability
   * is checked twice and neither check can be reached around: capture authority
   * alone produces `42501` from the row policy, which leaves as a denial rather
   * than a server fault.
   */
  async overrideCaptureRequirement(
    db: DbHandle,
    receptionVisitId: string,
    input: CaptureOverrideInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<CaptureOverrideRecorded> {
    const visit = await this.requireRecordableVisit(db, receptionVisitId, authorizeScope);
    const reason = this.ruleOrFail(
      () => requireNonBlank(input.reason, 'reason', MAX_CAPTURE_OVERRIDE_REASON),
      'body.reason'
    );

    let overrideId: string | null;
    try {
      overrideId = await this.capture.insertOverride(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        requirementCode: input.requirementCode,
        reason,
      });
    } catch (error) {
      throw this.mapCaptureFailure(error);
    }
    const id = this.requireId(overrideId, 'Recording the capture override');

    await appendAudit(db, {
      action: 'rec.reception.capture_requirement_overridden',
      entityType: 'rec.reception_visit',
      entityId: receptionVisitId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'requirement_code', classification: 'public', value: input.requirementCode },
        { field: 'override_id', classification: 'internal', value: id },
        // The reason is the operator's own words about the vehicle in front of
        // them, so it is recorded INTERNAL rather than public.
        { field: 'reason', classification: 'internal', value: reason },
      ],
    });

    return { receptionVisitId, overrideId: id, requirementCode: input.requirementCode };
  }

  /**
   * What this visit owes, what it has, and which templates it may still bind.
   *
   * `satisfied` counts FINALIZED bindings only. Counting recorded ones would
   * report a visit as complete on the strength of versions that are still
   * pending — which is the exact claim FE-018 refuses for signatures, applied to
   * capture.
   */
  async readCaptureContract(
    db: DbHandle,
    receptionVisitId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<CaptureContract> {
    const scope = await this.requireVisitScope(db, receptionVisitId, authorizeScope);
    const [policies, bindings, overrides, bindableTemplates, retiredPublishedTemplateCount] =
      await Promise.all([
        this.capture.resolvedPolicies(db, scope.branchId),
        this.capture.listBindings(db, receptionVisitId),
        this.capture.listOverrides(db, receptionVisitId),
        this.capture.listBindableTemplates(db, scope.branchId),
        // Same branch scope as the list above, in the same round trip: a count
        // taken over a different population than the list it explains would be
        // a count of something else.
        this.capture.countRetiredPublishedTemplates(db, scope.branchId),
      ]);

    const overridden = new Set(overrides.map((entry) => entry.requirementCode));
    const requirements = CAPTURE_REQUIREMENTS.map((code): CaptureRequirementState => {
      const rule = policies.find(
        (entry) => entry.requirementCode === code && entry.refusalType === null
      );
      const baseline = BASELINE_CAPTURE_RULES.find((entry) => entry.requirementCode === code);
      const minCount = rule ? rule.minCount : (baseline?.minCount ?? 0);
      const forCode = bindings.filter((entry) => entry.requirementCode === code);
      const finalizedCount = forCode.filter((entry) => entry.finalizedAt !== null).length;
      const isOverridden = overridden.has(code);
      return {
        requirementCode: code,
        minCount,
        deviceCapturedAtRequired: rule
          ? rule.deviceCapturedAtRequired
          : (baseline?.deviceCapturedAtRequired ?? false),
        source: rule ? rule.scope : 'baseline',
        finalizedCount,
        recordedCount: forCode.length,
        satisfied: isOverridden || finalizedCount >= minCount,
        overridden: isOverridden,
      };
    });

    return {
      receptionVisitId,
      requirements,
      bindings,
      overrides,
      bindableTemplates,
      retiredPublishedTemplateCount,
    };
  }

  // ---- Signatures ---------------------------------------------------------

  /**
   * The signature ledger of one visit (FE-018's read-back).
   *
   * Every signature is reported, including superseded and repudiated ones, with
   * the version it bound and what became of it. Hiding a superseded signature
   * would be the overwrite the Owner decision forbids, achieved through a read
   * filter instead of an UPDATE.
   */
  async readSignatures(
    db: DbHandle,
    receptionVisitId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<SignatureLedger> {
    await this.requireVisitScope(db, receptionVisitId, authorizeScope);
    return {
      receptionVisitId,
      signatures: await this.capture.listSignatures(db, receptionVisitId),
    };
  }

  /**
   * Finalizes or repudiates one signature.
   *
   * Both directions through one command because they are one ledger, and the
   * ordering rules between them — finalize once, repudiate only what was
   * finalized, never finalize what was repudiated — belong to
   * `rec.guard_signature_event()` where a second code path cannot avoid them.
   */
  async recordSignatureEvent(
    db: DbHandle,
    receptionVisitId: string,
    signatureId: string,
    input: SignatureEventInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<SignatureEventRecorded> {
    const visit = await this.requireRecordableVisit(db, receptionVisitId, authorizeScope);
    if (!(await this.capture.signatureExists(db, receptionVisitId, signatureId))) {
      throw new AppFailure('ERR-RES-001', { message: 'Signature was not found on this reception' });
    }

    const reason =
      input.eventType === 'repudiated'
        ? this.ruleOrFail(
            () => requireNonBlank(input.reason ?? '', 'reason', MAX_REPUDIATION_REASON),
            'body.reason'
          )
        : null;
    if (input.eventType === 'finalized' && (input.reason ?? null) !== null) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A finalization records no reason',
        safeDetails: { violations: [{ path: 'body.reason', rule: 'not_allowed' }] },
      });
    }

    let eventId: string | null;
    try {
      eventId = await this.capture.insertSignatureEvent(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        signatureId,
        eventType: input.eventType,
        reason,
      });
    } catch (error) {
      throw this.mapSignatureEventFailure(error);
    }
    const id = this.requireId(eventId, 'Recording the signature event');

    await appendAudit(db, {
      // ONE action code for both events, deliberately. The operation registry
      // permits a route exactly one declared `auditAction`, and two codes behind
      // one operation would mean the declared one is a half-truth — the same
      // reason `rec.reception.evidence_recorded` covers eight evidence tables.
      // Which event it was is recorded below, where it is queryable.
      action: 'rec.reception.signature_lifecycle_recorded',
      entityType: 'rec.signature',
      entityId: signatureId,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'reception_visit_id', classification: 'internal', value: receptionVisitId },
        { field: 'event_type', classification: 'public', value: input.eventType },
        { field: 'signature_event_id', classification: 'internal', value: id },
        { field: 'reason', classification: 'internal', value: reason },
      ],
    });

    return { receptionVisitId, signatureId, eventId: id, eventType: input.eventType };
  }

  // ---- Damage-map templates ----------------------------------------------

  /** Every slot of the tenant, retired ones included. Administration read-back. */
  async listTemplatesForManagement(db: DbHandle): Promise<readonly DamageMapTemplateRow[]> {
    return this.capture.listAllTemplates(db);
  }

  /** One slot with its full revision history, retired revisions included. */
  async readTemplate(db: DbHandle, templateId: string): Promise<DamageMapTemplateView> {
    const template = await this.capture.findTemplate(db, templateId);
    if (!template) {
      throw new AppFailure('ERR-RES-001', { message: 'Damage-map template was not found' });
    }
    return { template, versions: await this.capture.listTemplateVersions(db, templateId) };
  }

  /**
   * Creates a template slot.
   *
   * A branch-scoped slot re-authorizes against ITS OWN branch before the insert.
   * The route's `scope: 'tenant'` check has no target to evaluate, and RLS
   * narrows on the permission-blind union of the caller's grants, so without
   * this a branch-restricted catalogue manager could create a slot in a branch
   * it holds no grant for (`P1-18-A-01`, the same defect in a new place).
   */
  async createTemplate(
    db: DbHandle,
    input: DamageMapTemplateInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<DamageMapTemplateRow> {
    const scope = this.templateScopeOf(input);
    if (scope.branchId !== null) {
      await authorizeScope({ companyId: scope.companyId as string, branchId: scope.branchId });
    }
    const perspective = this.ruleOrFail(
      () => optionalNonBlank(input.perspective, 'perspective', MAX_TEMPLATE_PERSPECTIVE),
      'body.perspective'
    );

    let templateId: string | null;
    try {
      templateId = await this.capture.insertTemplate(db, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        mapType: input.mapType,
        perspective,
      });
    } catch (error) {
      throw this.mapCaptureFailure(error);
    }
    const id = this.requireId(templateId, 'Creating the damage-map template');

    await appendAudit(db, {
      action: 'rec.damage_map_template.created',
      entityType: 'rec.damage_map_template',
      entityId: id,
      companyId: scope.companyId,
      branchId: scope.branchId,
      details: [
        { field: 'map_type', classification: 'public', value: input.mapType },
        { field: 'perspective', classification: 'public', value: perspective },
      ],
    });

    const created = await this.capture.findTemplate(db, id);
    return this.requireRow(created, 'Creating the damage-map template');
  }

  /**
   * Publishes the next revision of a slot.
   *
   * The previous active revision is retired FIRST, in the same transaction:
   * `uq_damage_map_template_one_active` makes that mandatory rather than
   * courteous, and doing it in one transaction is what stops a slot from
   * spending any observable moment with no bindable revision.
   */
  async publishTemplateVersion(
    db: DbHandle,
    templateId: string,
    input: DamageMapTemplateVersionInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<DamageMapTemplateView> {
    const slot = await this.requireManageableTemplate(db, templateId, authorizeScope);
    if (slot.status !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: 'A retired damage-map template cannot publish a new revision; restore it first',
      });
    }

    let versionId: string | null;
    try {
      await this.capture.retireActiveTemplateVersion(db, templateId);
      versionId = await this.capture.insertTemplateVersion(db, {
        templateId,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
      });
    } catch (error) {
      throw this.mapCaptureFailure(error);
    }
    const id = this.requireId(versionId, 'Publishing the damage-map template revision');

    await appendAudit(db, {
      action: 'rec.damage_map_template.version_published',
      entityType: 'rec.damage_map_template',
      entityId: templateId,
      companyId: slot.companyId,
      branchId: slot.branchId,
      details: [
        { field: 'template_version_id', classification: 'internal', value: id },
        {
          field: 'document_version_id',
          classification: 'internal',
          value: input.documentVersionId,
        },
      ],
    });

    return this.readTemplate(db, templateId);
  }

  /**
   * Retires or restores a slot.
   *
   * Bidirectional for the reason every catalogue in this module is: a retired
   * slot keeps its revisions and its history, and a one-way retirement would
   * make the operator recreate the slot and lose the chain that connects a
   * historical visit to the geometry it was drawn on.
   */
  async setTemplateStatus(
    db: DbHandle,
    templateId: string,
    expectedVersion: number,
    status: 'active' | 'retired',
    authorizeScope: ScopeAuthorizer
  ): Promise<DamageMapTemplateView> {
    const slot = await this.requireManageableTemplate(db, templateId, authorizeScope);

    const changed = await this.capture.setTemplateStatus(db, {
      templateId,
      status,
      expectedVersion,
    });
    if (changed === null) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The damage-map template changed while this request was in flight; retry',
      });
    }

    await appendAudit(db, {
      action: 'rec.damage_map_template.status_changed',
      entityType: 'rec.damage_map_template',
      entityId: templateId,
      companyId: slot.companyId,
      branchId: slot.branchId,
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: slot.status,
          value: status,
        },
      ],
    });

    return this.readTemplate(db, templateId);
  }

  // ---- Capture policy -----------------------------------------------------

  /** Every live rule of the tenant. The administration read-back. */
  async listCapturePolicies(db: DbHandle): Promise<readonly CapturePolicyRow[]> {
    return this.capture.listPolicies(db);
  }

  /**
   * Sets the live rule for one key.
   *
   * Retire-then-insert rather than UPDATE, because the rule that applied at the
   * time of a visit must stay readable: the four partial unique indexes hold one
   * LIVE rule per key and impose no limit at all on retired ones. Both
   * statements run in the route's transaction, so no moment exists in which the
   * key has two live rules or none.
   */
  async setCapturePolicy(
    db: DbHandle,
    input: CapturePolicyInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<CapturePolicySet> {
    const scope = this.templateScopeOf(input);
    if (scope.branchId !== null) {
      await authorizeScope({ companyId: scope.companyId as string, branchId: scope.branchId });
    }
    if (
      !Number.isInteger(input.minCount) ||
      input.minCount < 0 ||
      input.minCount > MAX_CAPTURE_COUNT
    ) {
      throw new AppFailure('ERR-VAL-001', {
        message: `minCount must be a whole number between 0 and ${MAX_CAPTURE_COUNT}`,
        safeDetails: { violations: [{ path: 'body.minCount', rule: 'out_of_range' }] },
      });
    }
    const refusalType = input.refusalType ?? null;
    if (refusalType !== null && input.requirementCode !== 'refusal_supporting_evidence') {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Only refusal_supporting_evidence rules name a refusal type',
        safeDetails: { violations: [{ path: 'body.refusalType', rule: 'not_allowed' }] },
      });
    }

    let policyId: string | null;
    try {
      await this.capture.retirePolicy(db, {
        branchId: scope.branchId,
        requirementCode: input.requirementCode,
        refusalType,
      });
      policyId = await this.capture.insertPolicy(db, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        requirementCode: input.requirementCode,
        refusalType,
        minCount: input.minCount,
        deviceCapturedAtRequired: input.deviceCapturedAtRequired ?? true,
        witnessRequired: input.witnessRequired ?? false,
      });
    } catch (error) {
      throw this.mapCaptureFailure(error);
    }
    const id = this.requireId(policyId, 'Setting the capture policy');

    await appendAudit(db, {
      action: 'rec.capture_policy.set',
      entityType: 'rec.capture_policy_rule',
      entityId: id,
      companyId: scope.companyId,
      branchId: scope.branchId,
      details: [
        { field: 'requirement_code', classification: 'public', value: input.requirementCode },
        { field: 'refusal_type', classification: 'public', value: refusalType },
        { field: 'min_count', classification: 'public', value: String(input.minCount) },
        {
          field: 'witness_required',
          classification: 'public',
          value: String(input.witnessRequired ?? false),
        },
      ],
    });

    return {
      policyId: id,
      requirementCode: input.requirementCode,
      refusalType,
      scope: scope.branchId === null ? 'tenant' : 'branch',
    };
  }

  // ---- Shared helpers -----------------------------------------------------

  /**
   * Locks the visit, authorizes against ITS branch, then checks recordability.
   *
   * The same order as `ReceptionEvidenceService.requireRecordableVisit`, and for
   * the same reason (`P1-18-A-01`): these commands are addressed by the visit
   * id, so the route-level check has no scope to evaluate. Authorizing here,
   * before the lifecycle test and before any write, refuses a caller outside the
   * branch without telling them whether the visit is still open.
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
    await authorizeScope({ companyId: visit.companyId, branchId: visit.branchId });
    assertEvidenceRecordable(visit.receptionStatus);
    return visit;
  }

  /** The read-side equivalent: scope, authorization, no lock, no lifecycle test. */
  private async requireVisitScope(
    db: DbHandle,
    receptionVisitId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<CaptureScope> {
    const scope = await this.capture.findVisitScope(db, receptionVisitId);
    if (!scope) {
      throw new AppFailure('ERR-RES-001', { message: 'Reception was not found' });
    }
    await authorizeScope({ companyId: scope.companyId, branchId: scope.branchId });
    return scope;
  }

  /**
   * Resolves a template slot and re-authorizes against ITS scope.
   *
   * A slot the caller cannot see and one that does not exist are the same 404,
   * so the endpoint is not an existence oracle for another tenant's catalogue.
   */
  private async requireManageableTemplate(
    db: DbHandle,
    templateId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<{
    readonly companyId: string | null;
    readonly branchId: string | null;
    readonly status: string;
  }> {
    const slot = await this.capture.findTemplateScope(db, templateId);
    if (!slot) {
      throw new AppFailure('ERR-RES-001', { message: 'Damage-map template was not found' });
    }
    if (slot.branchId !== null) {
      await authorizeScope({ companyId: slot.companyId as string, branchId: slot.branchId });
    }
    return { companyId: slot.companyId, branchId: slot.branchId, status: slot.status };
  }

  /**
   * A tenant rule has NEITHER company nor branch; a branch rule has BOTH.
   *
   * `ck_capture_policy_scope` and `ck_damage_map_templates_scope` both say so,
   * and half a pair would otherwise reach the database as a CHECK violation
   * instead of a 422 naming the field.
   */
  private templateScopeOf(input: {
    readonly companyId?: string | null | undefined;
    readonly branchId?: string | null | undefined;
  }): { readonly companyId: string | null; readonly branchId: string | null } {
    const companyId = input.companyId ?? null;
    const branchId = input.branchId ?? null;
    if ((companyId === null) !== (branchId === null)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A branch-scoped entry needs both companyId and branchId, or neither',
        safeDetails: { violations: [{ path: 'body.branchId', rule: 'incoherent_scope' }] },
      });
    }
    return { companyId, branchId };
  }

  /** An ISO instant, or a named 422. Never a driver error from a bad string. */
  private parseInstant(value: string | null | undefined): Date | null {
    if (value === undefined || value === null || value.length === 0) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'deviceCapturedAt must be an ISO-8601 instant',
        safeDetails: { violations: [{ path: 'body.deviceCapturedAt', rule: 'invalid_format' }] },
      });
    }
    return parsed;
  }

  /** A null id means a row-level policy refused the insert, not that it succeeded. */
  private requireId(value: string | null, subject: string): string {
    if (!value) {
      throw new AppFailure('ERR-IAM-001', { message: `${subject} was refused by policy` });
    }
    return value;
  }

  private requireRow<T>(value: T | null, subject: string): T {
    if (value === null) {
      throw new AppFailure('ERR-IAM-001', { message: `${subject} was refused by policy` });
    }
    return value;
  }

  /** Maps the frozen capture-contract SQLSTATEs; re-throws anything else. */
  private mapCaptureFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
      return new AppFailure('ERR-IAM-001', {
        message: 'This reception capture contract is outside the scope your access grants',
      });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_reception_evidence_binding_version (the same version counted twice),
      // uq_capture_requirement_override_once (a requirement waived twice), and
      // the four capture-policy live-rule indexes. All are the caller asking for
      // something already recorded.
      return new AppFailure('ERR-RES-002', {
        message: 'That capture record already exists on this reception',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      // Includes every guard's "not visible to this tenant" branch, which must
      // read as a missing resource rather than as a hint that it exists.
      return new AppFailure('ERR-RES-001', {
        message: 'A referenced document, version, template revision or reception was not found',
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // The guards and the vocabularies all arrive as 23514 and none is
      // distinguishable from the SQLSTATE, so the message names the categories
      // rather than guessing which one fired.
      return new AppFailure('ERR-VAL-001', {
        message:
          'The capture record was refused: a document version must belong to its document and to the category the requirement accepts, it must be linked to this reception, it may not be rejected or quarantined, and a damage-map template revision must be the active revision of an active template',
        safeDetails: { violations: [{ path: 'body', rule: 'incoherent_reference' }] },
      });
    }
    return error;
  }

  /** The signature ledger's own failures, which are lifecycle rather than shape. */
  private mapSignatureEventFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_signature_event_finalized / uq_signature_event_repudiated.
      return new AppFailure('ERR-RES-002', {
        message: 'That signature has already been finalized or repudiated',
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // rec.guard_signature_event: an unaccepted version, a version outside the
      // reception_signature category, a document not linked to this visit, or
      // an ordering the ledger does not permit. Reported as a transition rather
      // than a validation problem, because the request is well formed and the
      // STATE refuses it.
      return new AppFailure('ERR-TRN-001', {
        message:
          'The signature lifecycle refused this event: finalizing needs an accepted signature version linked to this reception, a repudiated signature can never be finalized, and only a finalized signature can be repudiated',
      });
    }
    return this.mapCaptureFailure(error);
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
