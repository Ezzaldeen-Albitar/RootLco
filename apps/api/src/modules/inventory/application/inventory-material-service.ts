/**
 * Material demand control (P1-32-PRE-127…129, PRE-132).
 *
 * A work order could take any quantity of any item: the only ceiling on what a job
 * consumed was what the shelf held. Slice 3a made the database able to answer the
 * missing question — "was this quantity approved for this job?" — and this service
 * publishes it:
 *
 *  - a REQUIREMENT binds one service line and one item or item family to an
 *    allowance, taken from a confirmed vehicle specification or entered with its
 *    source, and is approved by a person other than the one who asked for it; it is
 *    re-checked once a missing specification or conversion exists, and cancelled with
 *    a reason only while nothing is committed against it;
 *  - an EXCEPTION adds a finite quantity with a reason, decided by a third party's
 *    authority (`inv.material.exception.approve`) and never by its requester;
 *  - a DRAW — a reservation or an issue for the work order — opens a material REQUEST
 *    on the requirement through `MaterialDrawGovernor`, which the stock service calls
 *    on the two stock paths; a request is closed or cancelled explicitly, which
 *    releases what it still holds.
 *
 * ## Where the guarantees live
 *
 * In the database, and only there. `inv.guard_material_request_ceiling` measures a
 * request against the approved allowance under the requirement row lock;
 * `inv.guard_material_request_fulfillment` bounds each reservation and issue by its
 * request under the same lock; and since `20260917099000` a reservation or part issue
 * for a work order cannot be written at all — by function, primitive or raw INSERT —
 * without that link (`inv.govern_work_order_draw`). This service does not re-ask the
 * question first: it performs the draw through `inv.reserve_material_request` or
 * `inv.issue_material_request` and, when the database refuses, reads the figures a
 * person needs after the refused draw has been rolled back.
 *
 * ## Which draws are governed
 *
 * EVERY draw for a work order (P1-32-PRE-132). It names the requirement it is taken
 * against; a covered item drawn without naming it is refused, and an item that NO
 * requirement on the work order covers is refused with `no_requirement`. A rejected or
 * cancelled requirement still governs. Counter sales and reservations with no work
 * order are outside the rule.
 */
import { AppFailure, type MaterialDrawDetails } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import { withSavepoint, type DbHandle } from '@/server/db/transaction';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import {
  MATERIAL_REQUIREMENT_ORDER,
  type InventoryRepository,
  type MaterialDrawCheckRow,
  type MaterialExceptionRow,
  type MaterialRequestRow,
  type MaterialRequirementRow,
} from '../data/inventory-repository';
import type { MaterialRefusalRule } from '../domain/inventory';
import { parseQuantity, toDomainFailure } from './inventory-failures';

/**
 * A material request and what finishing it released. Quantities are exact decimal
 * strings in the item's stock unit; `requirementUnitFactor` converts one stock unit
 * into the requirement unit.
 */
export interface MaterialRequestView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly requirementId: string;
  readonly workOrderId: string;
  readonly itemId: string;
  readonly quantity: string;
  readonly requirementUnitFactor: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly closedBy: string | null;
  readonly closedAt: string | null;
  readonly closeReason: string | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  /** The reservations this call released; empty on a replay. */
  readonly releasedReservationIds: readonly string[];
  /** True when the request was already in the state asked for and nothing changed. */
  readonly replayed: boolean;
}

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

function toRequestView(
  row: MaterialRequestRow,
  releasedReservationIds: readonly string[],
  replayed: boolean
): MaterialRequestView {
  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    requirementId: row.requirementId,
    workOrderId: row.workOrderId,
    itemId: row.itemId,
    quantity: row.quantity,
    requirementUnitFactor: row.requirementUnitFactor,
    status: row.status,
    requestedBy: row.requestedBy,
    closedBy: row.closedBy,
    closedAt: iso(row.closedAt),
    closeReason: row.closeReason,
    cancelledBy: row.cancelledBy,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    recordVersion: row.recordVersion,
    createdAt: row.createdAt.toISOString(),
    releasedReservationIds,
    replayed,
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
 * Governs a work-order draw on `POST /stock-reservations` and `POST /stock-issues`.
 *
 * It decides nothing the database does not. Since P1-32-PRE-132 a reservation or an
 * issue for a work order cannot be written without a material request on an approved
 * requirement: `inv.reserve_material_request` and `inv.issue_material_request` open
 * and fill it under the requirement lock, and every refusal is theirs. What this
 * class owns is naming the requirement, and turning a refusal into one a person can
 * act on — the allowance, what is already committed and what was asked for, read
 * after the refused draw has been rolled back to its savepoint.
 */
export class MaterialDrawGovernor {
  public constructor(private readonly repository: InventoryRepository) {}

  /**
   * The requirement a work-order draw is taken against.
   *
   * Refuses a named requirement that is not visible or that belongs to another work
   * order; a covered item drawn without naming its requirement; and a draw for an
   * item NO requirement on the work order covers — the absence of a requirement is a
   * refusal (`no_requirement`), never an unlimited draw.
   */
  public async resolve(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly itemId: string;
      readonly materialRequirementId?: string | undefined;
    }
  ): Promise<string> {
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
    refuseDraw(
      {
        allowance: null,
        alreadyCommitted: null,
        requested: null,
        unit: null,
        reason: 'no_requirement',
      },
      'This work order has no approved material requirement for the item; ask for one and have ' +
        'it approved before drawing stock for the job'
    );
  }

  /**
   * Opens a material request on `requirementId` and performs the draw on it, as one
   * unit: both happen under a savepoint, so a refusal leaves no request behind.
   */
  public async draw<T>(
    db: DbHandle,
    input: { readonly requirementId: string; readonly itemId: string; readonly quantity: string },
    act: (nested: DbHandle, requestId: string) => Promise<T>,
    what: string
  ): Promise<{ readonly requestId: string; readonly result: T }> {
    try {
      return await withSavepoint(db, async (nested) => {
        const requestId = await this.repository.createMaterialRequest(nested, input);
        return { requestId, result: await act(nested, requestId) };
      });
    } catch (error) {
      return this.refuse(db, error, input, what);
    }
  }

  /** Performs a draw on a request that already exists (an issue of its reservation). */
  public async drawOnRequest<T>(
    db: DbHandle,
    input: { readonly requirementId: string; readonly itemId: string; readonly quantity: string },
    act: (nested: DbHandle) => Promise<T>,
    what: string
  ): Promise<T> {
    try {
      return await withSavepoint(db, act);
    } catch (error) {
      return this.refuse(db, error, input, what);
    }
  }

  /**
   * Reports a refused draw. A material rule the database named becomes
   * `ERR-INV-001` with the figures, read after the savepoint rolled the draw back;
   * anything else — no stock, a closed work order, a reservation that is not the
   * request's — is the shared stock mapping.
   */
  private async refuse(
    db: DbHandle,
    error: unknown,
    input: { readonly requirementId: string; readonly itemId: string; readonly quantity: string },
    what: string
  ): Promise<never> {
    const message = databaseMessage(error);
    if (!isSqlState(error, SQLSTATE.checkViolation) || !message.startsWith('material_')) {
      toDomainFailure(error, what);
    }
    if (message.startsWith('material_item_not_covered')) {
      refuseField(
        'body.materialRequirementId',
        'item_not_covered',
        'The material requirement does not cover this item or its family'
      );
    }
    if (!message.startsWith('material_approval_required') && !message.includes('_exceeded')) {
      mapMaterialFailure(error, what);
    }
    const check = await this.repository.checkMaterialDraw(db, input);
    let reason: MaterialDrawDetails['reason'];
    if (message.includes('no_requirement')) reason = 'no_requirement';
    else if (message.includes('_exceeded')) reason = 'exceeds_requirement';
    else if (message.includes('missing_unit_conversion')) reason = 'missing_conversion';
    else if (check?.status === 'approval_required') {
      reason =
        check.approvalRequiredReason === 'missing_specification'
          ? 'missing_specification'
          : 'missing_conversion';
    } else reason = 'approval_required';
    const figures = await this.figuresFor(db, input.requirementId, check);
    refuseDraw(
      { ...figures, reason },
      reason === 'exceeds_requirement'
        ? `Drawing ${check?.requested ?? input.quantity} would exceed the ${check?.allowance ?? '0'} ` +
            `allowed (${check?.committed ?? '0.000'} already committed); an approved exception is required`
        : reason === 'approval_required'
          ? `The material requirement is ${check?.status ?? 'not approved'}; only an approved requirement allows a draw`
          : `The material requirement cannot be drawn on until it is resolved (${reason})`
    );
  }

  /**
   * The figures a refused draw may publish to THIS caller (CC-OD-32).
   *
   * Drawing stock and reading the demand that governs it are separate
   * authorities — `inv.stock.operate` on the two draw operations,
   * `inv.stock.read` on `inv.material-requirement-read` — and an actor can hold
   * the first without the second. The allowance, the quantity already committed
   * and the unit are contents of the requirement, so publishing them to a caller
   * who cannot open it would hand out through a refusal exactly what the read
   * permission withholds.
   *
   * So the question is asked in the requirement's own company and branch, and a
   * caller who may not read it gets every quantity as null. The REASON still
   * travels: it describes the caller's own request and names the remedy, and a
   * refusal that says nothing at all is the defect this whole change exists to
   * remove.
   */
  private async figuresFor(
    db: DbHandle,
    requirementId: string,
    check: MaterialDrawCheckRow | null
  ): Promise<Omit<MaterialDrawDetails, 'reason'>> {
    const withheld = { allowance: null, alreadyCommitted: null, requested: null, unit: null };
    if (!check) return withheld;
    const requirement = await this.repository.readMaterialRequirement(db, requirementId);
    if (!requirement) return withheld;
    const mayRead = await callerHoldsPermission(db, 'inv.stock.read', {
      companyId: requirement.companyId,
      branchId: requirement.branchId,
    });
    if (!mayRead) return withheld;
    return {
      allowance: check.allowance,
      alreadyCommitted: check.committed,
      requested: check.requested,
      unit: check.unit,
    };
  }
}

/**
 * Refuses a material write with the rule that refused it on the wire.
 *
 * The rule token travels in `violations`, against `body` — the whole request
 * rather than one control, because none of these rules is about a single box: a
 * duplicate demand is about the line and the part together, and an unknown
 * reference names four candidates. `problemFor` publishes `safeDetails` and the
 * catalogue entry only, so this list is the ONLY machine-readable statement of
 * the reason; the `message` below stays for the log and never reaches a caller.
 */
function refuseMaterial(
  code: 'ERR-TRN-001' | 'ERR-RES-001' | 'ERR-RES-002',
  rule: MaterialRefusalRule,
  message: string
): never {
  throw new AppFailure(code, {
    message,
    safeDetails: { violations: [{ path: 'body', rule }] },
  });
}

/**
 * Translates a material refusal. The rule names the slice-3a guards raise are part of
 * their message, so they are matched by prefix; anything else is the shared stock
 * mapping.
 *
 * Every branch publishes a token from `MATERIAL_REFUSAL_RULES` (DEF-T-16). Before
 * that the status was the whole answer, and a caller could not tell a second
 * request for the same part on the same line from any other 409 — which on the
 * material panel read "This change cannot be saved" and a correlation reference.
 */
export function mapMaterialFailure(error: unknown, what: string): never {
  const message = databaseMessage(error);
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    if (message.startsWith('material_separation_of_duties')) {
      refuseMaterial(
        'ERR-TRN-001',
        'material_separation_of_duties',
        'The person who asked for it may not decide it. Ask another approver.'
      );
    }
    if (message.startsWith('material_duplicate_demand')) {
      refuseMaterial(
        'ERR-RES-002',
        'material_duplicate_demand',
        'The service line already has an active requirement for this item or its family'
      );
    }
    if (message.startsWith('material_approval_required')) {
      refuseMaterial(
        'ERR-TRN-001',
        'material_approval_required',
        `${what} needs an approved requirement with every fact it depends on`
      );
    }
    refuseMaterial(
      'ERR-TRN-001',
      'material_demand_rule',
      `${what} was refused because it would break a material demand rule`
    );
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    refuseMaterial(
      'ERR-RES-002',
      'material_duplicate_demand',
      'The service line already has an active requirement for this item or its family'
    );
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    refuseMaterial(
      'ERR-RES-001',
      'material_unknown_reference',
      `${what} names a service line, item, family or unit that does not exist in scope`
    );
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
      // CC-OD-32: WHICH fact is missing is the whole of what the approver has to
      // do next, so the two reasons publish two tokens rather than one
      // "unresolved". A requirement in this state always carries a reason; a null
      // one is read as the conversion, which is the reason a derivation that
      // found its specification can still be waiting on.
      refuseMaterial(
        'ERR-TRN-001',
        before.approvalRequiredReason === 'missing_specification'
          ? 'material_requirement_missing_specification'
          : 'material_requirement_missing_conversion',
        `The requirement cannot be decided until it is resolved ` +
          `(${before.approvalRequiredReason ?? 'approval required'})`
      );
    }
    if (before.status !== 'pending_approval') {
      refuseMaterial(
        'ERR-TRN-001',
        'material_requirement_already_decided',
        `Material requirement ${requirementId} is ${before.status} and is not awaiting a decision`
      );
    }
    if (before.requestedBy === db.context.principal.userId) {
      // Named, because this service catches the separation ahead of the database
      // and the database catches it again (`ck_material_requirements_separation`).
      // One rule read two ways would be one rule said two ways on screen, so both
      // publish the same token.
      refuseMaterial(
        'ERR-TRN-001',
        'material_separation_of_duties',
        'The person who asked for this material may not decide it. Ask another approver.'
      );
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
      refuseMaterial(
        'ERR-TRN-001',
        'material_exception_needs_approved_requirement',
        `An exception extends an approved requirement; this one is ${requirement.status}`
      );
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
      refuseMaterial(
        'ERR-TRN-001',
        'material_exception_already_decided',
        `Material exception ${exceptionId} is ${before.status} and has already been decided`
      );
    }
    if (before.requestedBy === db.context.principal.userId) {
      // The same rule as the requirement decision, so the same token: one rule
      // said two ways on screen is two rules to the person reading it.
      refuseMaterial(
        'ERR-TRN-001',
        'material_separation_of_duties',
        'The person who asked for this exception may not decide it. Ask another approver.'
      );
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

  /**
   * Re-checks a requirement that is `approval_required` once the fact it lacked
   * exists — a specification confirmed since, or a unit conversion stated since — and
   * returns where it now stands.
   *
   * A requirement that is already awaiting a decision or approved has nothing to
   * re-check and is returned as it is, so a repeated call changes nothing. A rejected
   * or cancelled one is closed, and is refused.
   */
  public async recheck(
    db: DbHandle,
    requirementId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequirementView> {
    const before = await this.repository.readMaterialRequirement(db, requirementId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material requirement ${requirementId} was not found`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.status === 'rejected' || before.status === 'cancelled') {
      refuseMaterial(
        'ERR-TRN-001',
        'material_requirement_closed',
        `Material requirement ${requirementId} is ${before.status} and has nothing to re-check`
      );
    }
    if (before.status !== 'approval_required') return this.detail(db, before);

    try {
      await this.repository.recheckMaterialRequirement(db, requirementId);
    } catch (error) {
      mapMaterialFailure(error, 'Material requirement re-check');
    }
    const after = await this.requireRequirement(db, requirementId);
    if (after.status !== before.status || after.allowanceQuantity !== before.allowanceQuantity) {
      await appendAudit(db, {
        action: 'inv.material_requirement.rechecked',
        entityType: 'inv.material_requirement',
        entityId: after.id,
        companyId: after.companyId,
        branchId: after.branchId,
        requestRef: 'inv.material-requirement-recheck',
        details: [
          {
            field: 'status',
            classification: 'internal',
            previousValue: before.status,
            value: after.status,
          },
          {
            field: 'approvalRequiredReason',
            classification: 'internal',
            previousValue: before.approvalRequiredReason,
            value: after.approvalRequiredReason,
          },
          { field: 'specificationId', classification: 'internal', value: after.specificationId },
          {
            field: 'allowanceQuantity',
            classification: 'internal',
            previousValue: before.allowanceQuantity,
            value: after.allowanceQuantity,
          },
          { field: 'uomId', classification: 'internal', value: after.uomId },
        ],
      });
    }
    return this.detail(db, after);
  }

  /**
   * Cancels a requirement with a reason. Refused while it has an open request or any
   * quantity reserved, or issued and not returned, against it: what was drawn on a
   * requirement stays accounted to it. Cancelling a cancelled requirement changes
   * nothing.
   */
  public async cancel(
    db: DbHandle,
    requirementId: string,
    input: { readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequirementView> {
    const before = await this.repository.readMaterialRequirement(db, requirementId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material requirement ${requirementId} was not found`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.status === 'cancelled') return this.detail(db, before);
    if (before.status === 'rejected') {
      refuseMaterial(
        'ERR-TRN-001',
        'material_requirement_rejected',
        `Material requirement ${requirementId} was rejected and cannot be cancelled`
      );
    }
    try {
      await this.repository.cancelMaterialRequirement(db, requirementId, input.reason);
    } catch (error) {
      if (databaseMessage(error).startsWith('material_requirement_committed')) {
        refuseMaterial(
          'ERR-TRN-001',
          'material_requirement_committed',
          'Material is still requested, reserved, or issued and not returned against this ' +
            'requirement. Close or cancel its requests and return what was issued first.'
        );
      }
      mapMaterialFailure(error, 'Material requirement cancellation');
    }
    const after = await this.requireRequirement(db, requirementId);
    await appendAudit(db, {
      action: 'inv.material_requirement.cancelled',
      entityType: 'inv.material_requirement',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.material-requirement-cancel',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'reason', classification: 'internal', value: after.cancelReason },
        { field: 'allowanceQuantity', classification: 'internal', value: after.allowanceQuantity },
      ],
    });
    return this.detail(db, after);
  }

  /**
   * Closes a material request: what it issued stays counted, and what it still asks
   * for or holds stops counting against the allowance. Its active reservations are
   * released by the same act.
   */
  public async closeRequest(
    db: DbHandle,
    requestId: string,
    input: { readonly reason?: string | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequestView> {
    return this.finishRequest(db, requestId, 'closed', input.reason ?? null, authorizeScope);
  }

  /**
   * Cancels a material request that issued nothing, with a reason, releasing its
   * active reservations. A request that issued stock is closed, not cancelled.
   */
  public async cancelRequest(
    db: DbHandle,
    requestId: string,
    input: { readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequestView> {
    return this.finishRequest(db, requestId, 'cancelled', input.reason, authorizeScope);
  }

  private async finishRequest(
    db: DbHandle,
    requestId: string,
    outcome: 'closed' | 'cancelled',
    reason: string | null,
    authorizeScope: ScopeAuthorizer
  ): Promise<MaterialRequestView> {
    const before = await this.repository.readMaterialRequest(db, requestId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Material request ${requestId} was not found`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.status === outcome) return toRequestView(before, [], true);
    if (before.status !== 'open') {
      refuseMaterial(
        'ERR-TRN-001',
        'material_request_not_open',
        `Material request ${requestId} is ${before.status} and cannot be ${outcome}`
      );
    }

    const holding = await this.repository.activeReservationsOfRequest(db, requestId);
    try {
      await this.repository.finishMaterialRequest(db, { requestId, outcome, reason });
    } catch (error) {
      if (databaseMessage(error).includes('closed, not cancelled')) {
        refuseMaterial(
          'ERR-TRN-001',
          'material_request_issued',
          'This material request issued stock, so it is closed rather than cancelled'
        );
      }
      toDomainFailure(error, 'Material request');
    }
    const after = await this.repository.readMaterialRequest(db, requestId);
    if (!after) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'The material request vanished after it was finished',
      });
    }

    // Each reservation the act released is recorded exactly as a release is, so the
    // same state change is attributable however it was caused.
    for (const held of holding) {
      const reservation = (await this.repository.readReservation(db, held.id)) ?? held;
      await appendAudit(db, {
        action: 'inv.stock.reservation_released',
        entityType: 'inv.stock_reservation',
        entityId: reservation.id,
        companyId: reservation.companyId,
        branchId: reservation.branchId,
        requestRef:
          outcome === 'closed' ? 'inv.material-request-close' : 'inv.material-request-cancel',
        details: [
          {
            field: 'status',
            classification: 'internal',
            previousValue: 'active',
            value: 'released',
          },
          { field: 'reason', classification: 'internal', value: `material request ${outcome}` },
          { field: 'quantity', classification: 'internal', value: reservation.quantity },
          { field: 'materialRequestId', classification: 'internal', value: requestId },
        ],
      });
      await publishEvent(db, {
        eventType: 'stock.reservation.released',
        aggregateId: reservation.id,
        aggregateVersion: reservation.recordVersion,
        producer: 'inventory.inventory-material-service',
        companyId: reservation.companyId,
        branchId: reservation.branchId,
        eventKey: `stock.reservation.released:${reservation.id}`,
        payload: {
          reservationId: reservation.id,
          itemId: reservation.itemId,
          locationId: reservation.locationId,
          quantity: reservation.quantity,
          reason: `material request ${outcome}`,
        },
      });
    }

    await appendAudit(db, {
      action:
        outcome === 'closed' ? 'inv.material_request.closed' : 'inv.material_request.cancelled',
      entityType: 'inv.material_request',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef:
        outcome === 'closed' ? 'inv.material-request-close' : 'inv.material-request-cancel',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'requirementId', classification: 'internal', value: after.requirementId },
        {
          field: 'reason',
          classification: 'internal',
          value: outcome === 'closed' ? after.closeReason : after.cancelReason,
        },
        {
          field: 'releasedReservationIds',
          classification: 'internal',
          value: holding.map((reservation) => reservation.id).join(','),
        },
      ],
    });
    return toRequestView(
      after,
      holding.map((reservation) => reservation.id),
      false
    );
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
