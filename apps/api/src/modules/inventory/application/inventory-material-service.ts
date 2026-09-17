/**
 * Material demand control (P1-32-PRE-127…129).
 *
 * A work order could take any quantity of any item: the only ceiling on what a job
 * consumed was what the shelf held. Slice 3a made the database able to answer the
 * missing question — "was this quantity approved for this job?" — and this service
 * publishes it:
 *
 *  - a REQUIREMENT binds one service line and one item or item family to an
 *    allowance, taken from a confirmed vehicle specification or entered with its
 *    source, and is approved by a person other than the one who asked for it;
 *  - an EXCEPTION adds a finite quantity with a reason, decided by a third party's
 *    authority (`inv.material.exception.approve`) and never by its requester;
 *  - a DRAW — a reservation or an issue for the work order — is measured against it
 *    by `MaterialDrawGovernor`, which the stock service calls on the two existing
 *    stock paths.
 *
 * ## Where the guarantees live
 *
 * In `inv.guard_material_requirement`, `inv.guard_material_request_ceiling` and
 * `inv.guard_material_request_fulfillment`, which lock the requirement row and
 * re-read the committed quantity inside that lock. This service asks the same
 * question first, under the same lock, only so a refusal can state the allowance,
 * what is already committed and what was asked for — the database stays the
 * guarantee, and a refusal it raises that the pre-check did not foresee is still a
 * refusal.
 *
 * ## Which draws are governed
 *
 * A draw for a work order is governed when the request names a requirement, or when
 * ANY requirement on that work order covers the item — by the item itself or by its
 * family, in any state. A covered item drawn without naming its requirement is
 * refused rather than let through, and a requirement that was rejected or cancelled
 * still governs: the absence of an approval is a refusal, never a return to an
 * unlimited draw. A work order with no requirement for an item draws exactly as it
 * did before this slice.
 */
import { AppFailure, type MaterialDrawDetails } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import {
  MATERIAL_REQUIREMENT_ORDER,
  type InventoryRepository,
  type MaterialExceptionRow,
  type MaterialRequirementRow,
} from '../data/inventory-repository';
import { parseQuantity } from './inventory-failures';

export interface MaterialExceptionView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly requirementId: string;
  /** Exact decimal strings in the requirement unit. */
  readonly additionalQuantity: string;
  /** The allowance the approval produced; null until approved. */
  readonly resultingAllowance: string | null;
  readonly reason: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

/**
 * A requirement and where its allowance stands. Every quantity is an exact decimal
 * string in the requirement unit (`uomId`); `allowanceQuantity`, `effectiveAllowance`
 * and `remainingQuantity` are null while no allowance exists.
 */
export interface MaterialRequirementListView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly serviceLineId: string;
  readonly itemId: string | null;
  readonly itemCategoryId: string | null;
  readonly basis: string;
  readonly specificationId: string | null;
  readonly serviceCondition: string | null;
  readonly engineVariant: string | null;
  readonly uomId: string | null;
  readonly sourceReference: string | null;
  readonly status: string;
  /** Why nothing can be approved yet; null unless the status is `approval_required`. */
  readonly approvalRequiredReason: string | null;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly allowanceQuantity: string | null;
  readonly approvedExceptionQuantity: string;
  readonly effectiveAllowance: string | null;
  /** Asked for by an open request and not yet reserved or issued. */
  readonly requestedQuantity: string;
  readonly reservedQuantity: string;
  readonly issuedQuantity: string;
  readonly returnedQuantity: string;
  readonly committedQuantity: string;
  readonly remainingQuantity: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

export interface MaterialRequirementView extends MaterialRequirementListView {
  readonly exceptions: readonly MaterialExceptionView[];
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toExceptionView(row: MaterialExceptionRow): MaterialExceptionView {
  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    requirementId: row.requirementId,
    additionalQuantity: row.additionalQuantity,
    resultingAllowance: row.resultingAllowance,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    recordVersion: row.recordVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRequirementListView(row: MaterialRequirementRow): MaterialRequirementListView {
  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    workOrderId: row.workOrderId,
    serviceLineId: row.serviceLineId,
    itemId: row.itemId,
    itemCategoryId: row.itemCategoryId,
    basis: row.basis,
    specificationId: row.specificationId,
    serviceCondition: row.serviceCondition,
    engineVariant: row.engineVariant,
    uomId: row.uomId,
    sourceReference: row.sourceReference,
    status: row.status,
    approvalRequiredReason: row.approvalRequiredReason,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    rejectedBy: row.rejectedBy,
    rejectedAt: iso(row.rejectedAt),
    rejectionReason: row.rejectionReason,
    allowanceQuantity: row.allowanceQuantity,
    approvedExceptionQuantity: row.approvedExceptionQuantity,
    effectiveAllowance: row.effectiveAllowance,
    requestedQuantity: row.openRequestQuantity,
    reservedQuantity: row.reservedQuantity,
    issuedQuantity: row.issuedQuantity,
    returnedQuantity: row.returnedQuantity,
    committedQuantity: row.committedQuantity,
    remainingQuantity: row.remainingQuantity,
    recordVersion: row.recordVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The raw text of a database refusal, for the few messages that carry a rule name. */
function databaseMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
}

function refuseField(path: string, rule: string, message: string): never {
  throw new AppFailure('ERR-VAL-001', {
    message,
    safeDetails: { violations: [{ path, rule }] },
  });
}

function refuseDraw(details: MaterialDrawDetails, message: string): never {
  throw new AppFailure('ERR-INV-001', { message, safeDetails: { materialDraw: details } });
}

/**
 * Measures a work-order draw against its material requirement. Used by the stock
 * service on `POST /stock-reservations` and `POST /stock-issues`.
 */
export class MaterialDrawGovernor {
  public constructor(private readonly repository: InventoryRepository) {}

  /**
   * The requirement a draw is governed by, or null for an ungoverned draw.
   *
   * Refuses a named requirement that is not visible, that belongs to another work
   * order, or that does not cover the item; and refuses a covered item drawn
   * without naming its requirement.
   */
  public async resolve(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly itemId: string;
      readonly materialRequirementId?: string | undefined;
    }
  ): Promise<string | null> {
    if (input.materialRequirementId !== undefined) {
      const requirement = await this.repository.readMaterialRequirement(
        db,
        input.materialRequirementId
      );
      if (!requirement) {
        throw new AppFailure('ERR-RES-001', {
          message: `Material requirement ${input.materialRequirementId} was not found`,
        });
      }
      if (requirement.workOrderId !== input.workOrderId) {
        refuseField(
          'body.materialRequirementId',
          'other_work_order',
          'The material requirement belongs to another work order'
        );
      }
      return requirement.id;
    }
    const covering = await this.repository.findCoveringMaterialRequirements(
      db,
      input.workOrderId,
      input.itemId
    );
    if (covering.length > 0) {
      refuseField(
        'body.materialRequirementId',
        'required',
        'This work order has a material requirement for the item; name the requirement the ' +
          'draw is taken against'
      );
    }
    return null;
  }

  /**
   * Refuses a draw the requirement does not allow, stating the figures, under the
   * requirement lock. Returns normally when the draw fits.
   */
  public async assertDrawable(
    db: DbHandle,
    input: { readonly requirementId: string; readonly itemId: string; readonly quantity: string }
  ): Promise<void> {
    const check = await this.repository.checkMaterialDraw(db, input);
    if (!check) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material requirement ${input.requirementId} was not found`,
      });
    }
    if (!check.coversItem) {
      refuseField(
        'body.materialRequirementId',
        'item_not_covered',
        'The material requirement does not cover this item or its family'
      );
    }
    const figures = {
      allowance: check.allowance,
      alreadyCommitted: check.committed,
      requested: check.requested,
    };
    if (check.status === 'approval_required') {
      const reason =
        check.approvalRequiredReason === 'missing_specification'
          ? 'missing_specification'
          : 'missing_conversion';
      refuseDraw(
        { ...figures, reason },
        `The material requirement cannot be drawn on until it is resolved (${reason})`
      );
    }
    if (check.status !== 'approved') {
      refuseDraw(
        { ...figures, reason: 'approval_required' },
        `The material requirement is ${check.status}; only an approved requirement allows a draw`
      );
    }
    if (!check.hasFactor) {
      refuseDraw(
        { ...figures, reason: 'missing_conversion' },
        'The item has no exact conversion into the unit the requirement is stated in'
      );
    }
    if (check.exceeds) {
      refuseDraw(
        { ...figures, reason: 'exceeds_requirement' },
        `Drawing ${check.requested ?? input.quantity} would exceed the ${check.allowance ?? '0'} ` +
          `allowed (${check.committed} already committed); an approved exception is required`
      );
    }
  }

  /**
   * Opens the material request a governed draw fulfills. A refusal the pre-check did
   * not foresee — a concurrent draw committed in between is impossible under the
   * lock, but a guard is the guarantee — is reported by the rule it names.
   */
  public async openRequest(
    db: DbHandle,
    input: { readonly requirementId: string; readonly itemId: string; readonly quantity: string }
  ): Promise<string> {
    try {
      return await this.repository.createMaterialRequest(db, input);
    } catch (error) {
      mapMaterialFailure(error, 'Material draw');
    }
  }
}

/**
 * Translates a material refusal. The rule names the slice-3a guards raise are part of
 * their message, so they are matched by prefix; anything else is the shared stock
 * mapping.
 */
export function mapMaterialFailure(error: unknown, what: string): never {
  const message = databaseMessage(error);
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    if (message.startsWith('material_separation_of_duties')) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'The person who asked for it may not decide it. Ask another approver.',
      });
    }
    if (message.startsWith('material_duplicate_demand')) {
      throw new AppFailure('ERR-RES-002', {
        message: 'The service line already has an active requirement for this item or its family',
      });
    }
    if (message.startsWith('material_approval_required')) {
      throw new AppFailure('ERR-TRN-001', {
        message: `${what} needs an approved requirement with every fact it depends on`,
      });
    }
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a material demand rule`,
    });
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    throw new AppFailure('ERR-RES-002', {
      message: 'The service line already has an active requirement for this item or its family',
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a service line, item, family or unit that does not exist in scope`,
    });
  }
  throw error;
}

export class InventoryMaterialService {
  public constructor(private readonly repository: InventoryRepository) {}

  /**
   * Asks for material for one service line: an ENTERED allowance with its source, or
   * one DERIVED from the confirmed specification for the work order's vehicle.
   *
   * A derivation that finds no confirmed specification is not refused and not
   * defaulted: it is stored as `approval_required` / `missing_specification` with no
   * allowance, which is the state a person can act on.
   */
  public async create(
    db: DbHandle,
    input:
      | {
          readonly basis: 'entered';
          readonly serviceLineId: string;
          readonly itemId?: string | undefined;
          readonly itemCategoryId?: string | undefined;
          readonly allowanceQuantity: string;
          readonly uomId: string;
          readonly sourceReference: string;
        }
      | {
          readonly basis: 'specification';
          readonly serviceLineId: string;
          readonly itemId?: string | undefined;
          readonly itemCategoryId?: string | undefined;
          readonly serviceCondition: string;
          readonly engineVariant?: string | undefined;
        },
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequirementView> {
    if ((input.itemId === undefined) === (input.itemCategoryId === undefined)) {
      refuseField(
        'body.itemId',
        'exactly_one_target',
        'A requirement names exactly one item or one item family'
      );
    }
    const line = await this.repository.readServiceLineScope(db, input.serviceLineId);
    if (!line) {
      throw new AppFailure('ERR-RES-001', {
        message: `Service line ${input.serviceLineId} was not found`,
      });
    }
    await authorizeScope({ companyId: line.companyId, branchId: line.branchId });

    let requirementId: string;
    try {
      requirementId =
        input.basis === 'entered'
          ? await this.repository.proposeMaterialRequirement(db, {
              serviceLineId: input.serviceLineId,
              itemId: input.itemId ?? null,
              itemCategoryId: input.itemCategoryId ?? null,
              allowanceQuantity: parseQuantity(
                input.allowanceQuantity,
                'allowanceQuantity'
              ).toString(),
              uomId: input.uomId,
              sourceReference: input.sourceReference,
            })
          : await this.repository.deriveMaterialRequirement(db, {
              serviceLineId: input.serviceLineId,
              itemId: input.itemId ?? null,
              itemCategoryId: input.itemCategoryId ?? null,
              serviceCondition: input.serviceCondition,
              engineVariant: input.engineVariant ?? null,
            });
    } catch (error) {
      mapMaterialFailure(error, 'Material requirement');
    }

    const created = await this.requireRequirement(db, requirementId);
    await appendAudit(db, {
      action: 'inv.material_requirement.requested',
      entityType: 'inv.material_requirement',
      entityId: created.id,
      companyId: created.companyId,
      branchId: created.branchId,
      requestRef: 'inv.material-requirement-create',
      details: [
        { field: 'workOrderId', classification: 'internal', value: created.workOrderId },
        { field: 'serviceLineId', classification: 'internal', value: created.serviceLineId },
        { field: 'itemId', classification: 'internal', value: created.itemId },
        { field: 'itemCategoryId', classification: 'internal', value: created.itemCategoryId },
        { field: 'basis', classification: 'internal', value: created.basis },
        { field: 'specificationId', classification: 'internal', value: created.specificationId },
        {
          field: 'allowanceQuantity',
          classification: 'internal',
          value: created.allowanceQuantity,
        },
        { field: 'uomId', classification: 'internal', value: created.uomId },
        { field: 'sourceReference', classification: 'internal', value: created.sourceReference },
        { field: 'status', classification: 'internal', value: created.status },
        {
          field: 'approvalRequiredReason',
          classification: 'internal',
          value: created.approvalRequiredReason,
        },
      ],
    });
    return this.detail(db, created);
  }

  /** A requirement, where its allowance stands, and its exceptions. */
  public async read(
    db: DbHandle,
    requirementId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequirementView> {
    const row = await this.repository.readMaterialRequirement(db, requirementId);
    if (!row) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material requirement ${requirementId} was not found`,
      });
    }
    await authorizeScope({ companyId: row.companyId, branchId: row.branchId });
    return this.detail(db, row);
  }

  /** One branch's requirements, newest first. */
  public async list(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId?: string | undefined;
      readonly status?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<MaterialRequirementListView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listMaterialRequirements(
      db,
      filter,
      pageRequest(MATERIAL_REQUIREMENT_ORDER, page)
    );
    return { ...result, items: result.items.map(toRequirementListView) };
  }

  /**
   * Approves or rejects a requirement put forward by someone else.
   *
   * A requirement that is `approval_required` cannot be decided at all: nothing is
   * there to approve until its specification or its conversion exists.
   */
  public async decide(
    db: DbHandle,
    requirementId: string,
    input: { readonly decision: 'approved' | 'rejected'; readonly reason?: string | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequirementView> {
    const before = await this.repository.readMaterialRequirement(db, requirementId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material requirement ${requirementId} was not found`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (input.decision === 'rejected' && input.reason === undefined) {
      refuseField('body.reason', 'required', 'A rejection states its reason');
    }
    if (before.status === 'approval_required') {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `The requirement cannot be decided until it is resolved ` +
          `(${before.approvalRequiredReason ?? 'approval required'})`,
      });
    }
    if (before.status !== 'pending_approval') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Material requirement ${requirementId} is ${before.status} and is not awaiting a decision`,
      });
    }
    if (before.requestedBy === db.context.principal.userId) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'The person who asked for this material may not decide it. Ask another approver.',
      });
    }

    try {
      if (input.decision === 'approved') {
        await this.repository.approveMaterialRequirement(db, requirementId);
      } else {
        await this.repository.rejectMaterialRequirement(db, requirementId, input.reason ?? '');
      }
    } catch (error) {
      mapMaterialFailure(error, 'Material requirement decision');
    }

    const after = await this.requireRequirement(db, requirementId);
    await appendAudit(db, {
      action:
        input.decision === 'approved'
          ? 'inv.material_requirement.approved'
          : 'inv.material_requirement.rejected',
      entityType: 'inv.material_requirement',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.material-requirement-approve',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'allowanceQuantity', classification: 'internal', value: after.allowanceQuantity },
        { field: 'uomId', classification: 'internal', value: after.uomId },
        { field: 'requestedBy', classification: 'internal', value: after.requestedBy },
        { field: 'reason', classification: 'internal', value: input.reason ?? null },
      ],
    });
    return this.detail(db, after);
  }

  /** Asks for a finite quantity beyond an approved allowance, with a reason. */
  public async requestException(
    db: DbHandle,
    requirementId: string,
    input: { readonly additionalQuantity: string; readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialExceptionView> {
    const additional = parseQuantity(input.additionalQuantity, 'additionalQuantity');
    const requirement = await this.repository.readMaterialRequirement(db, requirementId);
    if (!requirement) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material requirement ${requirementId} was not found`,
      });
    }
    await authorizeScope({ companyId: requirement.companyId, branchId: requirement.branchId });
    if (requirement.status !== 'approved') {
      throw new AppFailure('ERR-TRN-001', {
        message: `An exception extends an approved requirement; this one is ${requirement.status}`,
      });
    }

    let exceptionId: string;
    try {
      exceptionId = await this.repository.requestMaterialException(db, {
        requirementId,
        additionalQuantity: additional.toString(),
        reason: input.reason,
      });
    } catch (error) {
      mapMaterialFailure(error, 'Material exception');
    }
    const created = await this.requireException(db, exceptionId);
    await appendAudit(db, {
      action: 'inv.material_exception.requested',
      entityType: 'inv.material_requirement_exception',
      entityId: created.id,
      companyId: created.companyId,
      branchId: created.branchId,
      requestRef: 'inv.material-exception-create',
      details: [
        { field: 'requirementId', classification: 'internal', value: created.requirementId },
        {
          field: 'additionalQuantity',
          classification: 'internal',
          value: created.additionalQuantity,
        },
        { field: 'reason', classification: 'internal', value: created.reason },
      ],
    });
    return toExceptionView(created);
  }

  /** Approves or rejects an exception requested by someone else. */
  public async decideException(
    db: DbHandle,
    exceptionId: string,
    input: { readonly decision: 'approved' | 'rejected'; readonly note?: string | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialExceptionView> {
    const before = await this.repository.readMaterialException(db, exceptionId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material exception ${exceptionId} was not found`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.status !== 'pending') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Material exception ${exceptionId} is ${before.status} and has already been decided`,
      });
    }
    if (before.requestedBy === db.context.principal.userId) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'The person who asked for this exception may not decide it. Ask another approver.',
      });
    }
    try {
      await this.repository.decideMaterialException(db, {
        exceptionId,
        approve: input.decision === 'approved',
        note: input.note ?? null,
      });
    } catch (error) {
      mapMaterialFailure(error, 'Material exception decision');
    }
    const after = await this.requireException(db, exceptionId);
    await appendAudit(db, {
      action:
        input.decision === 'approved'
          ? 'inv.material_exception.approved'
          : 'inv.material_exception.rejected',
      entityType: 'inv.material_requirement_exception',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.material-exception-decide',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'requirementId', classification: 'internal', value: after.requirementId },
        {
          field: 'additionalQuantity',
          classification: 'internal',
          value: after.additionalQuantity,
        },
        {
          field: 'resultingAllowance',
          classification: 'internal',
          value: after.resultingAllowance,
        },
        { field: 'requestedBy', classification: 'internal', value: after.requestedBy },
        { field: 'note', classification: 'internal', value: after.decisionNote },
      ],
    });
    return toExceptionView(after);
  }

  private async detail(
    db: DbHandle,
    row: MaterialRequirementRow
  ): Promise<MaterialRequirementView> {
    const exceptions = await this.repository.listMaterialExceptions(db, row.id);
    return { ...toRequirementListView(row), exceptions: exceptions.map(toExceptionView) };
  }

  private async requireRequirement(
    db: DbHandle,
    requirementId: string
  ): Promise<MaterialRequirementRow> {
    const row = await this.repository.readMaterialRequirement(db, requirementId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'The material requirement vanished after it was written',
      });
    }
    return row;
  }

  private async requireException(db: DbHandle, exceptionId: string): Promise<MaterialExceptionRow> {
    const row = await this.repository.readMaterialException(db, exceptionId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'The material exception vanished after it was written',
      });
    }
    return row;
  }
}
