/**
 * Goods receipts and the append-only item cost history (P1-32-PRE-043…045).
 *
 * A receipt is created as a draft with its lines in one transaction, and posted as
 * a separate act. Posting writes one `receipt`/`in` movement per line through
 * `inv.post_goods_receipt` and APPENDS one `inv.item_cost_layers` row per priced
 * line. It never revises an earlier layer and never writes
 * `inv.item_cost_details.standard_cost`, so the cost of what arrived in March is
 * still readable after September's delivery arrives at a different price.
 *
 * ## Cost is gated at both ends
 *
 * - WRITING a unit cost requires `inv.cost.view` in the receipt's branch as well as
 *   `inv.stock.operate`. A caller without it who sends `unitCost` is refused with
 *   `ERR-VAL-001` on that field, rather than having the figure silently dropped —
 *   a dropped cost would post a receipt the caller believes was priced.
 * - READING cost is possible only through `inv.item-cost-history-read`, over the
 *   `inv.cost.view`-gated layers table. The receipt reads return whether a line is
 *   priced, never the figure.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { pageRequest, type Page } from '@/server/db/pagination';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import type { DbHandle } from '@/server/db/transaction';
import {
  COST_LAYER_ORDER,
  GOODS_RECEIPT_ORDER,
  type CostLayerRow,
  type GoodsReceiptLineRow,
  type GoodsReceiptRow,
  type InventoryRepository,
} from '../data/inventory-repository';
import { assertLegalMovementReference, type StockRefusalRule } from '../domain/inventory';
import { parseQuantity, refuseInventoryState, toDomainFailure } from './inventory-failures';

/**
 * The rule token both purchase-cost refusals publish (CC-OD-32).
 *
 * One token for the two acts, because it is one rule: a unit cost may be
 * written and posted only by someone permitted to see inventory cost. The
 * create refusal carries it on the cost box of every priced line; the posting
 * refusal carries it on the request, because by then the costs are already
 * stored and there is no box to clear.
 */
const COST_PERMISSION_RULE: StockRefusalRule = 'stock_receipt_cost_permission';
import type { InventoryStockService } from './inventory-stock-service';

/** `numeric(18, 4)`, non-negative, as a plain decimal literal. */
const UNIT_COST_LITERAL = /^\d{1,14}(\.\d{1,4})?$/;

export interface GoodsReceiptLineInput {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly unitCost?: string;
  readonly currencyCode?: string;
}

export interface GoodsReceiptLineView {
  readonly id: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly quantity: string;
  readonly hasUnitCost: boolean;
}

export interface GoodsReceiptView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly reference: string | null;
  readonly supplierReference: string | null;
  readonly receivedOn: string;
  readonly status: string;
  readonly notes: string | null;
  readonly postedAt: string | null;
  readonly lineCount: number;
  readonly recordVersion: number;
  readonly createdAt: string;
}

export interface GoodsReceiptDetailView extends GoodsReceiptView {
  readonly lines: readonly GoodsReceiptLineView[];
}

export interface CreatedGoodsReceiptView extends GoodsReceiptDetailView {
  /** True when an idempotent replay returned the receipt that already existed. */
  readonly replayed: boolean;
}

export interface CostLayerView {
  readonly id: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly quantity: string;
  readonly unitCost: string;
  readonly currencyCode: string;
  readonly effectiveAt: string;
}

export interface ItemCostHistoryView {
  readonly itemId: string;
  readonly companyId: string;
  readonly branchId: string;
  /** Most recent layer's unit cost; null when nothing has ever been priced. */
  readonly latestUnitCost: string | null;
  /**
   * Quantity-weighted average over every layer, computed in SQL `numeric`.
   *
   * Null when there are no layers, AND null when the layers span more than one
   * currency: an average of two currencies is not a cost, and returning one would
   * be a figure that looks authoritative and means nothing.
   */
  readonly weightedAverageCost: string | null;
  readonly currencyCode: string | null;
  readonly mixedCurrencies: boolean;
  readonly layerCount: number;
  readonly totalQuantity: string;
  readonly layers: Page<CostLayerView>;
}

const toReceiptView = (row: GoodsReceiptRow): GoodsReceiptView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  reference: row.reference,
  supplierReference: row.supplierReference,
  receivedOn: row.receivedOn,
  status: row.status,
  notes: row.notes,
  postedAt: row.postedAt ? row.postedAt.toISOString() : null,
  lineCount: row.lineCount,
  recordVersion: row.recordVersion,
  createdAt: row.createdAt.toISOString(),
});

const toLineView = (row: GoodsReceiptLineRow): GoodsReceiptLineView => ({
  id: row.id,
  lineNo: row.lineNo,
  itemId: row.itemId,
  sku: row.sku,
  locationId: row.locationId,
  locationCode: row.locationCode,
  quantity: row.quantity,
  hasUnitCost: row.hasUnitCost,
});

const toCostLayerView = (row: CostLayerRow): CostLayerView => ({
  id: row.id,
  sourceKind: row.sourceKind,
  sourceId: row.sourceId,
  quantity: row.quantity,
  unitCost: row.unitCost,
  currencyCode: row.currencyCode,
  effectiveAt: row.effectiveAt.toISOString(),
});

export class InventoryReceiptService {
  public constructor(
    private readonly repository: InventoryRepository,
    private readonly stock: InventoryStockService
  ) {}

  /**
   * Creates a draft receipt with all of its lines, atomically.
   *
   * Every line's location must sit in the receipt's own company and branch —
   * `fk_goods_receipt_lines_location` would refuse anything else, but as a foreign
   * key failure that reads as "does not exist" when the truth is "is elsewhere".
   */
  public async create(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly reference?: string;
      readonly supplierReference?: string;
      readonly receivedOn: string;
      readonly notes?: string;
      readonly idempotencyKey?: string;
      readonly lines: readonly GoodsReceiptLineInput[];
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<CreatedGoodsReceiptView> {
    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });

    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.readGoodsReceiptByIdempotencyKey(
        db,
        input.idempotencyKey
      );
      if (existing) {
        if (existing.companyId !== input.companyId || existing.branchId !== input.branchId) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'This idempotency key already created a receipt in a different branch. Reuse a ' +
              'key only for an identical request.',
          });
        }
        return { ...(await this.detail(db, existing)), replayed: true };
      }
    }

    const priced = input.lines.some((line) => line.unitCost !== undefined);
    if (priced) {
      const mayCost = await callerHoldsPermission(db, 'inv.cost.view', {
        companyId: input.companyId,
        branchId: input.branchId,
      });
      if (!mayCost) {
        // CC-OD-32: `custom` rendered as "This value is not accepted here" beside
        // the cost box, which is true of nothing the operator typed. The named
        // rule carries the real reason — a permission they do not hold — to the
        // control they must clear.
        throw new AppFailure('ERR-VAL-001', {
          message:
            'A unit cost may be recorded only by someone permitted to view inventory cost. ' +
            'Remove the unit cost, or ask someone with that permission to record the receipt.',
          safeDetails: {
            violations: input.lines.flatMap((line, index) =>
              line.unitCost === undefined
                ? []
                : [
                    {
                      path: `body.lines.${index}.unitCost`,
                      rule: COST_PERMISSION_RULE,
                    },
                  ]
            ),
          },
        });
      }
    }

    const parsedLines = [];
    for (const [index, line] of input.lines.entries()) {
      const quantity = parseQuantity(line.quantity, `lines.${index}.quantity`);
      if ((line.unitCost === undefined) !== (line.currencyCode === undefined)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'A unit cost and its currency must be given together',
          safeDetails: {
            violations: [{ path: `body.lines.${index}.currencyCode`, rule: 'custom' }],
          },
        });
      }
      if (line.unitCost !== undefined && !UNIT_COST_LITERAL.test(line.unitCost)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'A unit cost must be a non-negative decimal with at most four decimal places',
          safeDetails: { violations: [{ path: `body.lines.${index}.unitCost`, rule: 'custom' }] },
        });
      }
      const location = await this.stock.requireLocation(db, line.locationId);
      if (location.companyId !== input.companyId || location.branchId !== input.branchId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'Every receipt line must name a location in the receipt branch',
          safeDetails: { violations: [{ path: `body.lines.${index}.locationId`, rule: 'custom' }] },
        });
      }
      if (location.locationType === 'transit' || location.locationType === 'quarantine') {
        refuseInventoryState(
          location.locationType === 'transit'
            ? 'stock_location_transit'
            : 'stock_location_quarantine',
          `Goods cannot be received into ${location.locationType} location ${location.locationCode}`,
          { path: `body.lines.${index}.locationId` }
        );
      }
      await this.stock.requireStockTrackedItem(db, line.itemId);
      parsedLines.push({ ...line, quantity: quantity.toString(), lineNo: index + 1 });
    }

    let receiptId: string;
    try {
      const created = await this.repository.createGoodsReceipt(db, {
        companyId: input.companyId,
        branchId: input.branchId,
        reference: input.reference ?? null,
        supplierReference: input.supplierReference ?? null,
        receivedOn: input.receivedOn,
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: db.context.correlationId,
      });
      receiptId = created.id;
      for (const line of parsedLines) {
        await this.repository.insertGoodsReceiptLine(db, {
          companyId: input.companyId,
          branchId: input.branchId,
          receiptId,
          lineNo: line.lineNo,
          itemId: line.itemId,
          locationId: line.locationId,
          quantity: line.quantity,
          unitCost: line.unitCost ?? null,
          currencyCode: line.currencyCode ?? null,
        });
      }
    } catch (error) {
      toDomainFailure(error, 'Goods receipt');
    }

    const receipt = await this.requireReceipt(db, receiptId);
    await appendAudit(db, {
      action: 'inv.goods_receipt.created',
      entityType: 'inv.goods_receipt',
      entityId: receipt.id,
      companyId: receipt.companyId,
      branchId: receipt.branchId,
      requestRef: 'inv.goods-receipt-create',
      details: [
        { field: 'reference', classification: 'internal', value: receipt.reference },
        {
          field: 'supplierReference',
          classification: 'internal',
          value: receipt.supplierReference,
        },
        { field: 'receivedOn', classification: 'internal', value: receipt.receivedOn },
        { field: 'lineCount', classification: 'internal', value: String(receipt.lineCount) },
        { field: 'priced', classification: 'internal', value: priced ? 'true' : 'false' },
      ],
    });
    return { ...(await this.detail(db, receipt)), replayed: false };
  }

  /**
   * Posts a draft: one receipt movement per line and one appended cost layer per
   * priced line, in one transaction with the status change.
   *
   * `If-Match` names the receipt's `record_version`, so a draft that was changed
   * after the poster last read it is refused rather than posted as something the
   * poster never saw.
   */
  public async post(
    db: DbHandle,
    receiptId: string,
    input: { readonly expectedVersion: number },
    authorizeScope: ScopeAuthorizer
  ): Promise<GoodsReceiptDetailView> {
    assertLegalMovementReference('receipt', 'goods_receipt_line', 'in');
    const before = await this.repository.lockGoodsReceipt(db, receiptId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', { message: `Goods receipt ${receiptId} was not found` });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The goods receipt changed since it was last read; read it again before posting',
      });
    }
    if (before.status !== 'draft') {
      refuseInventoryState(
        'stock_receipt_not_draft',
        `Goods receipt ${receiptId} is ${before.status} and cannot be posted`
      );
    }

    const lines = await this.repository.listGoodsReceiptLines(db, receiptId);
    if (lines.some((line) => line.hasUnitCost)) {
      // The layer INSERT is gated on `inv.cost.view` by RLS, so a poster without it
      // would fail inside the function as an opaque policy violation. Asked first,
      // so the refusal says what is actually missing.
      const mayCost = await callerHoldsPermission(db, 'inv.cost.view', {
        companyId: before.companyId,
        branchId: before.branchId,
      });
      if (!mayCost) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'This receipt carries unit costs, so posting it records cost history and needs ' +
            'permission to view inventory cost.',
          safeDetails: { violations: [{ path: 'body', rule: COST_PERMISSION_RULE }] },
        });
      }
    }

    try {
      await this.repository.postGoodsReceipt(db, receiptId, db.context.correlationId);
    } catch (error) {
      toDomainFailure(error, 'Goods receipt posting');
    }

    for (const line of lines) {
      await this.stock.publishPostedMovements(db, 'goods_receipt_line', line.id);
    }
    const after = await this.requireReceipt(db, receiptId);
    await appendAudit(db, {
      action: 'inv.goods_receipt.posted',
      entityType: 'inv.goods_receipt',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.goods-receipt-post',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'lineCount', classification: 'internal', value: String(lines.length) },
        {
          field: 'costLayersAppended',
          classification: 'internal',
          value: String(lines.filter((line) => line.hasUnitCost).length),
        },
      ],
    });
    return this.detail(db, after);
  }

  public async read(
    db: DbHandle,
    receiptId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<GoodsReceiptDetailView> {
    const receipt = await this.repository.readGoodsReceipt(db, receiptId);
    if (!receipt) {
      throw new AppFailure('ERR-RES-001', { message: `Goods receipt ${receiptId} was not found` });
    }
    await authorizeScope({ companyId: receipt.companyId, branchId: receipt.branchId });
    return this.detail(db, receipt);
  }

  public async list(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<GoodsReceiptView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listGoodsReceipts(
      db,
      filter,
      pageRequest(GOODS_RECEIPT_ORDER, page)
    );
    return { ...result, items: result.items.map(toReceiptView) };
  }

  /**
   * The cost history of one item in one branch, and the two costs derived from it.
   *
   * The operation declares `inv.cost.view`, and RLS on `inv.item_cost_layers`
   * requires it again — so a caller who reached this method without it would read
   * an empty history from the database, not a leaked one.
   */
  public async costHistory(
    db: DbHandle,
    itemId: string,
    scope: { readonly companyId: string; readonly branchId: string },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<ItemCostHistoryView> {
    await authorizeScope(scope);
    const item = await this.repository.readItem(db, itemId);
    if (!item) {
      throw new AppFailure('ERR-RES-001', { message: `Item ${itemId} was not found` });
    }
    const summary = await this.repository.readItemCostSummary(db, itemId, scope);
    const layers = await this.repository.listItemCostLayers(
      db,
      itemId,
      scope,
      pageRequest(COST_LAYER_ORDER, page)
    );
    const mixedCurrencies = summary.currencyCount > 1;
    return {
      itemId,
      companyId: scope.companyId,
      branchId: scope.branchId,
      latestUnitCost: summary.latestUnitCost,
      weightedAverageCost: mixedCurrencies ? null : summary.weightedAverageCost,
      currencyCode: summary.currencyCode,
      mixedCurrencies,
      layerCount: summary.layerCount,
      totalQuantity: summary.totalQuantity,
      layers: { ...layers, items: layers.items.map(toCostLayerView) },
    };
  }

  private async detail(db: DbHandle, receipt: GoodsReceiptRow): Promise<GoodsReceiptDetailView> {
    const lines = await this.repository.listGoodsReceiptLines(db, receipt.id);
    return { ...toReceiptView(receipt), lines: lines.map(toLineView) };
  }

  private async requireReceipt(db: DbHandle, receiptId: string): Promise<GoodsReceiptRow> {
    const row = await this.repository.readGoodsReceipt(db, receiptId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'Goods receipt vanished after it was written',
      });
    }
    return row;
  }
}
