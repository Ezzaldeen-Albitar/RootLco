/**
 * Inventory intake (Phase 1-21, P1-21-BE-002, BE-009, BE-010).
 *
 * Three ways stock or a stock-adjacent fact enters the system, and they are
 * deliberately not the same shape:
 *
 *  - **Opening balances** are the only path that mints stock, and they do it
 *    through an approved batch so that minting is a maker-checker act with an
 *    `opening` movement per line — never a direct write to a balance total.
 *  - **Customer-supplied parts** are custody records with **no** stock effect at
 *    all. `ck_customer_supplied_parts_owned CHECK (customer_owned)` makes company
 *    ownership unrepresentable, and no `customer_supplied` reference kind exists,
 *    so no movement could be posted even by mistake.
 *  - **External-purchase parts** are ad-hoc references with
 *    `is_procurement = false`. Recording one is not a goods receipt and does not
 *    increase stock; a part that physically arrives becomes stock through an
 *    adjustment or an opening batch, both of which require approval.
 *
 * Conflating any of these would inflate what the company owns. The schema refuses
 * to represent the conflation; this service refuses to attempt it.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type { InventoryRepository, StockLocationRow } from '../data/inventory-repository';
import { InventoryRuleError, Quantity, assertLegalMovementReference } from '../domain/inventory';

export interface OpeningBatchView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly batchCode: string;
  readonly status: string;
  /** The caller who opened the batch. Never a caller-supplied value. */
  readonly countedBy: string;
  readonly approvedBy: string | null;
  readonly recordVersion: number;
}

export interface OpeningLineView {
  readonly id: string;
  readonly batchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
}

export interface CustomerSuppliedPartView {
  readonly id: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly description: string;
  readonly quantity: string;
  readonly custodyState: string;
  /**
   * Always true, and stated in the response rather than left implied.
   *
   * A client that cannot see this field would have no way to know the part it just
   * recorded is not company stock and carries no valuation.
   */
  readonly customerOwned: true;
  /** Always `false` — recorded so a consumer never has to infer it. */
  readonly affectsStock: false;
  readonly recordVersion: number;
}

export interface ExternalPurchasePartView {
  readonly id: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly description: string;
  readonly quantity: string;
  readonly status: string;
  /** Always `false` — `ck_external_purchase_parts_not_procurement`. */
  readonly isProcurement: false;
  readonly affectsStock: false;
  /** True when a restricted unit cost was written. Never the cost itself. */
  readonly costRecorded: boolean;
  readonly recordVersion: number;
}

function toDomainFailure(error: unknown, what: string): never {
  if (error instanceof InventoryRuleError) {
    throw new AppFailure('ERR-TRN-001', { message: error.message });
  }
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a stock invariant`,
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a record that does not exist in scope`,
    });
  }
  if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
    throw new AppFailure('ERR-IAM-001', {
      message: `${what} requires a permission this caller does not hold`,
    });
  }
  throw error;
}

export class InventoryIntakeService {
  public constructor(private readonly repository: InventoryRepository) {}

  // -------------------------------------------------------------------------
  // P1-21-BE-002 — opening balances.
  // -------------------------------------------------------------------------

  /**
   * Opens a draft opening-inventory batch.
   *
   * A batch is created `draft` and no parameter offers anything else: stock appears
   * only when `inv.approve_opening_batch` posts the `opening` movements, and
   * `ck_opening_inventory_batches_maker_checker` requires a different approver. That
   * is why this method cannot "create balances" — it creates an intention to.
   */
  public async openBatch(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly batchCode: string;
      readonly asOfDate: string;
      readonly notes?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<OpeningBatchView> {
    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });
    let batch: OpeningBatchView;
    try {
      batch = await this.repository.createOpeningBatch(db, {
        companyId: input.companyId,
        branchId: input.branchId,
        batchCode: input.batchCode,
        asOfDate: input.asOfDate,
        /**
         * The counter is the CALLER, and is not a settable field.
         *
         * `counted_by` is NOT NULL and `ck_opening_inventory_batches_maker` forbids
         * the approver from equalling it, so this column is one half of the
         * maker-checker rule. If a caller could name an arbitrary counter, one person
         * could open a batch "counted by" a colleague and then approve it themselves
         * — satisfying the CHECK while defeating the separation it exists to create.
         * Taking it from the request context makes that unrepresentable.
         */
        countedBy: db.context.principal.userId,
        notes: input.notes ?? null,
      });
    } catch (error) {
      toDomainFailure(error, 'Opening batch');
    }

    await appendAudit(db, {
      action: 'inv.opening_batch.created',
      entityType: 'inv.opening_inventory_batch',
      entityId: batch.id,
      companyId: batch.companyId,
      branchId: batch.branchId,
      requestRef: 'inv.opening-batch-create',
      details: [
        { field: 'batchCode', classification: 'internal', value: batch.batchCode },
        { field: 'asOfDate', classification: 'internal', value: input.asOfDate },
        { field: 'status', classification: 'internal', value: batch.status },
        { field: 'countedBy', classification: 'internal', value: batch.countedBy },
      ],
    });
    return batch;
  }

  /**
   * Adds a counted line to a draft batch.
   *
   * The line's location must belong to the batch's own branch. Without that a batch
   * opened for branch B1 could carry lines that mint stock in B2 — the approval
   * posts movements from the line's location, not the batch's, so the batch's own
   * scope check would not catch it.
   */
  public async addLine(
    db: DbHandle,
    input: {
      readonly batchId: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<OpeningLineView> {
    const quantity = Quantity.parse(input.quantity, 'quantity').assertPostable('quantity');
    assertLegalMovementReference('opening', 'opening_line', 'in');

    const batch = await this.requireDraftBatch(db, input.batchId);
    await authorizeScope({ companyId: batch.companyId, branchId: batch.branchId });

    const location = await this.requireLocation(db, input.locationId);
    if (location.companyId !== batch.companyId || location.branchId !== batch.branchId) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Stock location ${location.locationCode} is in a different branch from opening batch ` +
          `${input.batchId}`,
      });
    }
    if (location.locationType === 'quarantine') {
      throw new AppFailure('ERR-TRN-001', {
        message: 'An opening balance may not be counted into a quarantine location',
      });
    }

    const item = await this.repository.readItem(db, input.itemId);
    if (!item) {
      throw new AppFailure('ERR-RES-001', { message: `Item ${input.itemId} was not found` });
    }
    if (!item.isStockTracked || item.lifecycleStatus !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Item ${item.sku} is not an active stock-tracked item`,
      });
    }

    let line: { id: string };
    try {
      line = await this.repository.addOpeningLine(db, {
        batchId: input.batchId,
        // From the BATCH, never from the request: the line's scope columns are what
        // its RLS policy narrows on, and taking them from the caller would let a
        // line claim a branch the batch was never authorized for.
        companyId: batch.companyId,
        branchId: batch.branchId,
        itemId: input.itemId,
        locationId: input.locationId,
        quantity: quantity.toString(),
      });
    } catch (error) {
      toDomainFailure(error, 'Opening line');
    }
    return {
      id: line.id,
      batchId: input.batchId,
      itemId: input.itemId,
      locationId: input.locationId,
      quantity: quantity.toString(),
    };
  }

  /**
   * Approves a batch, minting one `opening` movement per line.
   *
   * This is the single point at which stock appears from nothing, so it is the one
   * place a maker-checker rule matters most — and it is enforced in the database,
   * not here. An empty batch is refused: approving nothing would record an approval
   * that attests to no count, which is worse than an error because it looks like
   * evidence.
   */
  public async approveBatch(
    db: DbHandle,
    batchId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<OpeningBatchView> {
    const batch = await this.requireDraftBatch(db, batchId);
    await authorizeScope({ companyId: batch.companyId, branchId: batch.branchId });

    const lineCount = await this.repository.countOpeningLines(db, batchId);
    if (lineCount === 0) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'An opening batch with no counted lines cannot be approved',
      });
    }

    try {
      await this.repository.approveOpeningBatch(db, batchId);
    } catch (error) {
      toDomainFailure(error, 'Opening batch approval');
    }

    const approved = await this.repository.readOpeningBatch(db, batchId);
    if (!approved) {
      throw new AppFailure('ERR-SYS-001', { message: 'Opening batch vanished after approval' });
    }

    await appendAudit(db, {
      action: 'inv.opening_batch.approved',
      entityType: 'inv.opening_inventory_batch',
      entityId: approved.id,
      companyId: approved.companyId,
      branchId: approved.branchId,
      requestRef: 'inv.opening-batch-approve',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: 'draft',
          value: approved.status,
        },
        { field: 'linesPosted', classification: 'internal', value: String(lineCount) },
      ],
    });
    return approved;
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-009 — customer-supplied part (custody only).
  // -------------------------------------------------------------------------

  /**
   * Records a customer-owned part taken into custody.
   *
   * `item_ref` is optional and, when given, points at the item **catalog** for
   * identification only — it does not make the part company stock, and no balance
   * is touched. The response says `affectsStock: false` explicitly so a consumer
   * never has to infer it from the absence of a movement id.
   */
  public async recordCustomerSuppliedPart(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly description: string;
      readonly quantity: string;
      readonly custodyState: string;
      readonly receptionVisitRef?: string;
      readonly itemRef?: string;
      readonly itemCondition?: string;
      readonly evidenceRef?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<CustomerSuppliedPartView> {
    const quantity = Quantity.parse(input.quantity, 'quantity').assertPostable('quantity');
    const workOrder = await this.requireWorkOrderInScope(db, input.workOrderId);
    await authorizeScope({ companyId: workOrder.companyId, branchId: workOrder.branchId });

    if (input.itemRef !== undefined) {
      const item = await this.repository.readItem(db, input.itemRef);
      if (!item) {
        throw new AppFailure('ERR-RES-001', {
          message: `Item reference ${input.itemRef} was not found`,
        });
      }
    }

    let created: { id: string; recordVersion: number };
    try {
      created = await this.repository.recordCustomerSuppliedPart(db, {
        companyId: workOrder.companyId,
        branchId: workOrder.branchId,
        workOrderId: input.workOrderId,
        receptionVisitRef: input.receptionVisitRef ?? null,
        itemRef: input.itemRef ?? null,
        description: input.description,
        quantity: quantity.toString(),
        custodyState: input.custodyState,
        itemCondition: input.itemCondition ?? null,
        evidenceRef: input.evidenceRef ?? null,
      });
    } catch (error) {
      toDomainFailure(error, 'Customer-supplied part');
    }

    await appendAudit(db, {
      action: 'inv.customer_supplied_part.recorded',
      entityType: 'inv.customer_supplied_part',
      entityId: created.id,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      requestRef: 'inv.customer-supplied-part-create',
      details: [
        { field: 'workOrderId', classification: 'internal', value: input.workOrderId },
        { field: 'quantity', classification: 'internal', value: quantity.toString() },
        { field: 'custodyState', classification: 'internal', value: input.custodyState },
        { field: 'customerOwned', classification: 'internal', value: 'true' },
      ],
    });

    return {
      id: created.id,
      workOrderId: input.workOrderId,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      description: input.description,
      quantity: quantity.toString(),
      custodyState: input.custodyState,
      customerOwned: true,
      affectsStock: false,
      recordVersion: created.recordVersion,
    };
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-010 — external-purchase part entry (NON-procurement).
  // -------------------------------------------------------------------------

  /**
   * Records an ad-hoc external purchase against a work order.
   *
   * Not a procurement workflow and not a goods receipt: no purchase order, no
   * approval chain, no stock movement. When a unit cost is supplied it is written to
   * the restricted 1:1 detail, whose every RLS policy is gated by `inv.cost.view` —
   * so a caller without that permission gets `ERR-IAM-001` rather than a silently
   * dropped cost, and never sees the value back.
   */
  public async recordExternalPurchasePart(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly description: string;
      readonly quantity: string;
      readonly status: string;
      readonly supplierPartnerId?: string;
      readonly supplierName?: string;
      readonly itemRef?: string;
      readonly evidenceRef?: string;
      readonly unitCost?: { readonly amount: string; readonly currency: string };
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<ExternalPurchasePartView> {
    const quantity = Quantity.parse(input.quantity, 'quantity').assertPostable('quantity');
    // `ck_external_purchase_parts_supplier` requires one of the two. Refused here so
    // the caller gets a field-level message instead of a constraint name.
    if (input.supplierPartnerId === undefined && input.supplierName === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'An external purchase must name either a supplier partner or a supplier name',
        safeDetails: { violations: [{ path: 'body.supplierName', rule: 'custom' }] },
      });
    }
    const workOrder = await this.requireWorkOrderInScope(db, input.workOrderId);
    await authorizeScope({ companyId: workOrder.companyId, branchId: workOrder.branchId });

    let created: { id: string; recordVersion: number };
    try {
      created = await this.repository.recordExternalPurchasePart(db, {
        companyId: workOrder.companyId,
        branchId: workOrder.branchId,
        workOrderId: input.workOrderId,
        supplierPartnerId: input.supplierPartnerId ?? null,
        supplierName: input.supplierName ?? null,
        itemRef: input.itemRef ?? null,
        description: input.description,
        quantity: quantity.toString(),
        status: input.status,
        evidenceRef: input.evidenceRef ?? null,
      });
    } catch (error) {
      toDomainFailure(error, 'External purchase');
    }

    let costRecorded = false;
    if (input.unitCost !== undefined) {
      try {
        await this.repository.recordExternalPurchaseCost(db, {
          companyId: workOrder.companyId,
          branchId: workOrder.branchId,
          externalPurchasePartId: created.id,
          unitCost: input.unitCost.amount,
          currencyCode: input.unitCost.currency,
        });
        costRecorded = true;
      } catch (error) {
        toDomainFailure(error, 'External purchase cost');
      }
    }

    await appendAudit(db, {
      action: 'inv.external_purchase.recorded',
      entityType: 'inv.external_purchase_part',
      entityId: created.id,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      requestRef: 'inv.external-purchase-part-create',
      details: [
        { field: 'workOrderId', classification: 'internal', value: input.workOrderId },
        { field: 'quantity', classification: 'internal', value: quantity.toString() },
        { field: 'status', classification: 'internal', value: input.status },
        // The amount is `restricted`, so the database masks it for a reader without
        // clearance. Recording that a cost exists is not the same as disclosing it.
        {
          field: 'unitCost',
          classification: 'restricted',
          value: input.unitCost ? `${input.unitCost.amount} ${input.unitCost.currency}` : null,
        },
      ],
    });

    return {
      id: created.id,
      workOrderId: input.workOrderId,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      description: input.description,
      quantity: quantity.toString(),
      status: input.status,
      isProcurement: false,
      affectsStock: false,
      costRecorded,
      recordVersion: created.recordVersion,
    };
  }

  // -------------------------------------------------------------------------
  // Shared preconditions.
  // -------------------------------------------------------------------------

  private async requireDraftBatch(
    db: DbHandle,
    batchId: string
  ): Promise<{ readonly id: string; readonly companyId: string; readonly branchId: string }> {
    const batch = await this.repository.readOpeningBatch(db, batchId);
    if (!batch) {
      throw new AppFailure('ERR-RES-001', {
        message: `Opening batch ${batchId} was not found`,
      });
    }
    if (batch.status !== 'draft') {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Opening batch ${batchId} is ${batch.status}; an approved batch is frozen and its ` +
          'balances cannot be rewritten',
      });
    }
    return { id: batch.id, companyId: batch.companyId, branchId: batch.branchId };
  }

  private async requireLocation(db: DbHandle, locationId: string): Promise<StockLocationRow> {
    const location = await this.repository.readLocation(db, locationId);
    if (!location) {
      throw new AppFailure('ERR-RES-001', {
        message: `Stock location ${locationId} was not found`,
      });
    }
    if (location.status !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Stock location ${location.locationCode} is ${location.status}`,
      });
    }
    return location;
  }

  /**
   * Resolves a work order's own company and branch.
   *
   * Both custody and external-purchase rows carry their own company/branch columns
   * that must agree with the work order's; taking them from the work order rather
   * than the request body is what makes a forged `companyId` impossible rather than
   * merely refused.
   */
  private async requireWorkOrderInScope(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ readonly companyId: string; readonly branchId: string }> {
    const state = await this.repository.lockWorkOrderState(db, workOrderId);
    if (!state) {
      throw new AppFailure('ERR-RES-001', {
        message: `Work order ${workOrderId} was not found`,
      });
    }
    /**
     * A closed work order takes no new records.
     *
     * Custody and external-purchase rows are not stock, so `allowsJobs` is not
     * required — a part can legitimately be received while the work order is still
     * being prepared. But a closed or cancelled work order is finished, and
     * attaching a new part to it would change the record of what was done.
     */
    if (state.isClosed || state.isTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${state.code}" is closed or terminal and takes no new parts`,
      });
    }
    return { companyId: state.companyId, branchId: state.branchId };
  }
}
