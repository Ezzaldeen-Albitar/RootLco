/**
 * Inventory master data — the rows every stock movement is keyed on (P1-30
 * corrective slice, closing the inventory half of A0 finding F-02).
 *
 * `inv.item_master`, `inv.item_categories` and `inv.stock_locations` have had
 * RLS policies, `app_runtime` INSERT grants and a permission code
 * (`inv.item.manage` — "Manage item master, categories, UoM") since P1-10, and
 * NO operation has ever written them. P1-21 shipped the reads
 * (`inv.item-search`, `inv.stock-location-list`) and every stock write over rows
 * that only a test fixture could create. Measured on the local stack at develop
 * `6f6236c3`: a tenant created through the shipped provisioning operation holds
 * zero items, zero categories and zero locations, and
 * `inv.opening-batch-line-create` requires an `itemId` and a `locationId` — so
 * no stock could ever come to exist in it.
 *
 * ## What this service owns, and what it deliberately does not
 *
 *  - It creates catalogue rows and nothing else. No stock, no cost, no
 *    movement: those stay with `InventoryIntakeService` and
 *    `InventoryStockService`, and the opening batch remains the ONLY path by
 *    which stock appears from nothing (maker–checker, `inv.adjustment.approve`).
 *  - It writes no cost. `inv.item_cost_details` is the restricted 1:1 cost table
 *    gated by `inv.cost.view`; valuation is an Owner decision this slice does
 *    not pre-empt (owner requirement area E).
 *  - It does not update or archive. `lifecycle_status` and `status` are set by
 *    the column defaults to `active`, which is the one state a fresh catalogue
 *    needs; edits are a later surface.
 *
 * ## Authority
 *
 * A category and an item are TENANT-WIDE reference data (`inv.item_master` has
 * no company or branch column), so both require `inv.item.manage` held
 * tenant-wide — the same control `svc.service-category-create` applies for the
 * same reason (P1-18-A-01): the pre-handler check degrades to the scope-blind
 * `iam.has_permission` when the row has no scope target, and an actor granted
 * the code in one branch must not be able to write the catalogue of every
 * branch. A location is BRANCH-scoped, so it goes through `authorizeScope`
 * against the company and branch the body names, and the row policy
 * `ins_stock_locations_scope` enforces the same pair a second time.
 *
 * `inv.item.manage` rather than a new location code: the 118-code catalogue
 * names no `inv.location.manage`, the A0 least-privilege review approved no
 * such code, and this slice mints none (RES-05). Whether store layout deserves
 * an authority distinct from the item catalogue is recorded as a residual for
 * the Owner rather than decided here.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { callerHoldsPermissionTenantWide, type ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page } from '@/server/db/pagination';
import { DecimalError, MONEY, assertCurrencyCode, parseNonNegative } from '@/modules/pricing';
import type {
  InventoryRepository,
  ItemCategoryRow,
  ItemRow,
  ItemSalePriceRow,
  StockLocationListRow,
  UnitOfMeasureRow,
} from '../data/inventory-repository';
import { CATEGORY_ORDER } from '../data/inventory-repository';

export interface ItemCategoryView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentCategoryId: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface UnitOfMeasureView {
  readonly id: string;
  /** `platform` (seeded, every tenant) or `tenant`. */
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly dimension: string;
}

/** The same shape `inv.item-search` publishes, so a created item reads as a listed one. */
export interface CreatedItemView {
  readonly id: string;
  readonly itemCategoryId: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly unitOfMeasure: { readonly id: string; readonly code: string };
  readonly itemType: string;
  readonly isStockTracked: boolean;
  readonly isSerialized: boolean;
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
}

/** The same shape `inv.stock-location-list` publishes, plus the version the echo carries. */
export interface CreatedStockLocationView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly locationType: string;
  readonly parentLocationId: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface CreateItemCategoryInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly parentCategoryId?: string | undefined;
}

export interface CreateItemInput {
  readonly itemCategoryId: string;
  readonly sku: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly uomId: string;
  readonly itemType: string;
  readonly isStockTracked?: boolean | undefined;
  readonly isSerialized?: boolean | undefined;
}

export interface CreateStockLocationInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly locationType: string;
  readonly parentLocationId?: string | undefined;
}

const toCategoryView = (row: ItemCategoryRow): ItemCategoryView => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  parentCategoryId: row.parentCategoryId,
  status: row.status,
  recordVersion: row.recordVersion,
});

const toUnitView = (row: UnitOfMeasureRow): UnitOfMeasureView => ({
  id: row.id,
  scope: row.scope,
  code: row.code,
  name: row.name,
  dimension: row.dimension,
});

const toCreatedItemView = (row: ItemRow): CreatedItemView => ({
  id: row.id,
  itemCategoryId: row.itemCategoryId,
  sku: row.sku,
  name: row.name,
  description: row.description,
  unitOfMeasure: { id: row.uomId, code: row.uomCode },
  itemType: row.itemType,
  isStockTracked: row.isStockTracked,
  isSerialized: row.isSerialized,
  lifecycleStatus: row.lifecycleStatus,
  recordVersion: row.recordVersion,
});

const toCreatedLocationView = (
  row: StockLocationListRow & { readonly recordVersion: number }
): CreatedStockLocationView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  locationCode: row.locationCode,
  name: row.name,
  locationType: row.locationType,
  parentLocationId: row.parentLocationId,
  status: row.status,
  recordVersion: row.recordVersion,
});

/** One configured selling price of an item (P1-32-PRE-105). */
export interface ItemSalePriceView {
  readonly id: string;
  readonly itemId: string;
  /** Null applies the price to every company of the tenant. */
  readonly companyId: string | null;
  /** Null applies the price to every branch of the named company. */
  readonly branchId: string | null;
  readonly currencyCode: string;
  /** Exact decimal string. */
  readonly unitPrice: string;
  readonly taxClassId: string | null;
  readonly taxClassCode: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface ItemSalePriceListView {
  readonly itemId: string;
  readonly sku: string;
  /** Most specific first: branch rows, then company rows, then the tenant-wide row. */
  readonly prices: readonly ItemSalePriceView[];
}

const toSalePriceView = (row: ItemSalePriceRow): ItemSalePriceView => ({
  id: row.id,
  itemId: row.itemId,
  companyId: row.companyId,
  branchId: row.branchId,
  currencyCode: row.currencyCode,
  unitPrice: row.unitPrice,
  taxClassId: row.taxClassId,
  taxClassCode: row.taxClassCode,
  status: row.status,
  recordVersion: row.recordVersion,
});

/** The catalogue authority a price write requires; tenant-wide when unnarrowed. */
const MANAGE_PERMISSION = 'inv.item.manage';

function refuse(path: string, rule: string, message: string): never {
  throw new AppFailure('ERR-VAL-001', { message, safeDetails: { violations: [{ path, rule }] } });
}

export class InventoryCatalogService {
  public constructor(private readonly repository: InventoryRepository) {}

  /** The tenant's categories, by code. Tenant-wide, like the item search beside it. */
  public async listCategories(
    db: DbHandle,
    filter: { readonly status?: string | undefined },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined }
  ): Promise<Page<ItemCategoryView>> {
    const result = await this.repository.listItemCategories(
      db,
      filter,
      pageRequest(CATEGORY_ORDER, page)
    );
    return { ...result, items: result.items.map(toCategoryView) };
  }

  /**
   * The units an item may be measured in: the platform catalogue plus this
   * tenant's own rows, active only. Not paged — `inv.units_of_measure` is a
   * closed reference list (twelve platform rows), exactly as
   * `sal.payment-method-list` treats its own.
   */
  public async listUnitsOfMeasure(db: DbHandle): Promise<readonly UnitOfMeasureView[]> {
    const rows = await this.repository.listUnitsOfMeasure(db);
    return rows.map(toUnitView);
  }

  public async createCategory(
    db: DbHandle,
    input: CreateItemCategoryInput
  ): Promise<ItemCategoryView> {
    if (input.parentCategoryId !== undefined) {
      const parent = await this.repository.readItemCategory(db, input.parentCategoryId);
      if (parent === null) {
        refuse(
          'body.parentCategoryId',
          'unknown_category',
          `Item category ${input.parentCategoryId} is not visible`
        );
      }
      if (parent.status !== 'active') {
        refuse(
          'body.parentCategoryId',
          'inactive_category',
          `Item category ${parent.code} is ${parent.status}`
        );
      }
    }
    let created: ItemCategoryRow;
    try {
      created = await this.repository.insertItemCategory(db, {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        parentCategoryId: input.parentCategoryId ?? null,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        // `uq_item_categories_code` is `(tenant_id, code)`; the code is the
        // category's identity in every later reference, so a collision is a
        // conflict the caller resolves by choosing another, not a state to merge.
        throw new AppFailure('ERR-CON-001', {
          message: `An item category with code "${input.code}" already exists`,
          safeDetails: { violations: [{ path: 'body.code', rule: 'duplicate_code' }] },
        });
      }
      throw cause;
    }
    await appendAudit(db, {
      action: 'inv.item_category.created',
      entityType: 'inv.item_category',
      entityId: created.id,
      requestRef: 'inv.item-category-create',
      details: [
        { field: 'code', classification: 'internal', value: created.code },
        { field: 'name', classification: 'internal', value: created.name },
      ],
    });
    return toCategoryView(created);
  }

  public async createItem(db: DbHandle, input: CreateItemInput): Promise<CreatedItemView> {
    // Both references are validated BEFORE the insert so the refusal names the
    // field. `fk_item_master_category` and `fk_item_master_uom` would refuse
    // the same rows, but as 23503 — "this row does not exist" about a row the
    // caller may be able to see in a list.
    const category = await this.repository.readItemCategory(db, input.itemCategoryId);
    if (category === null) {
      refuse(
        'body.itemCategoryId',
        'unknown_category',
        `Item category ${input.itemCategoryId} is not visible`
      );
    }
    if (category.status !== 'active') {
      refuse(
        'body.itemCategoryId',
        'inactive_category',
        `Item category ${category.code} is ${category.status}`
      );
    }
    const unit = await this.repository.readUnitOfMeasure(db, input.uomId);
    if (unit === null) {
      refuse('body.uomId', 'unknown_unit', `Unit of measure ${input.uomId} is not visible`);
    }
    if (unit.status !== 'active') {
      refuse('body.uomId', 'inactive_unit', `Unit of measure ${unit.code} is ${unit.status}`);
    }

    let itemId: string;
    try {
      itemId = await this.repository.insertItem(db, {
        itemCategoryId: input.itemCategoryId,
        sku: input.sku,
        name: input.name,
        description: input.description ?? null,
        uomId: input.uomId,
        itemType: input.itemType,
        isStockTracked: input.isStockTracked ?? true,
        isSerialized: input.isSerialized ?? false,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        // `uq_item_master_sku` is `(tenant_id, sku)`. A SKU is the identity a
        // stock count, a part issue and a supplier reference all key on.
        throw new AppFailure('ERR-CON-001', {
          message: `An item with SKU "${input.sku}" already exists`,
          safeDetails: { violations: [{ path: 'body.sku', rule: 'duplicate_sku' }] },
        });
      }
      throw cause;
    }
    // Read back through the same join `inv.item-search` uses, so the echo is
    // the row a reader will see — including the unit's code, which the insert
    // does not know.
    const created = await this.repository.readItem(db, itemId);
    /* c8 ignore next 3 -- the row was written in this transaction under the
       same tenant predicate the read applies; unreachable without a policy change. */
    if (created === null) {
      throw new Error('inventory: item insert was not readable back');
    }
    await appendAudit(db, {
      action: 'inv.item.created',
      entityType: 'inv.item',
      entityId: created.id,
      requestRef: 'inv.item-create',
      details: [
        { field: 'sku', classification: 'internal', value: created.sku },
        { field: 'itemType', classification: 'internal', value: created.itemType },
        {
          field: 'isStockTracked',
          classification: 'internal',
          value: String(created.isStockTracked),
        },
      ],
    });
    return toCreatedItemView(created);
  }

  public async createLocation(
    db: DbHandle,
    input: CreateStockLocationInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<CreatedStockLocationView> {
    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });

    // The hierarchy `inv.guard_stock_location_hierarchy` enforces, stated here
    // so the refusal names the field: a warehouse stands alone, and a storage
    // or quarantine location nests under a warehouse in the SAME branch.
    if (input.locationType === 'warehouse') {
      if (input.parentLocationId !== undefined) {
        refuse(
          'body.parentLocationId',
          'warehouse_has_no_parent',
          'A warehouse is a top-level location and takes no parent'
        );
      }
    } else {
      if (input.parentLocationId === undefined) {
        refuse(
          'body.parentLocationId',
          'parent_required',
          `A ${input.locationType} location must name the warehouse it belongs to`
        );
      }
      const parent = await this.repository.readLocation(db, input.parentLocationId);
      if (parent === null) {
        refuse(
          'body.parentLocationId',
          'unknown_location',
          `Stock location ${input.parentLocationId} is not visible`
        );
      }
      if (parent.companyId !== input.companyId || parent.branchId !== input.branchId) {
        refuse(
          'body.parentLocationId',
          'parent_outside_branch',
          'The parent location belongs to a different company or branch'
        );
      }
      if (parent.locationType !== 'warehouse') {
        refuse(
          'body.parentLocationId',
          'parent_not_warehouse',
          `The parent location ${parent.locationCode} is a ${parent.locationType}, not a warehouse`
        );
      }
    }

    let created: StockLocationListRow & { readonly recordVersion: number };
    try {
      created = await this.repository.insertStockLocation(db, {
        companyId: input.companyId,
        branchId: input.branchId,
        locationCode: input.locationCode,
        name: input.name,
        locationType: input.locationType,
        parentLocationId: input.parentLocationId ?? null,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-CON-001', {
          message: `A stock location with code "${input.locationCode}" already exists in this branch`,
          safeDetails: { violations: [{ path: 'body.locationCode', rule: 'duplicate_code' }] },
        });
      }
      if (isSqlState(cause, SQLSTATE.checkViolation)) {
        // The database guard is the backstop for the hierarchy rule above; it
        // should be unreachable after the checks, and if it is reached the
        // caller still gets a refusal rather than a server fault.
        throw new AppFailure('ERR-TRN-001', {
          message: 'The stock location was refused because it would break the location hierarchy',
        });
      }
      if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
        // `fk_stock_locations_branch` is (tenant_id, company_id, branch_id): a
        // company/branch pair from ANOTHER tenant passes an unrestricted grant's
        // scope check — unrestricted means every scope — and is refused only
        // here. Measured as a 500 before this mapping; it is a not-found in this
        // tenant, the same answer the opening batch gives (toDomainFailure).
        throw new AppFailure('ERR-RES-001', {
          message: 'The company or branch named is not in this organisation',
        });
      }
      throw cause;
    }
    await appendAudit(db, {
      action: 'inv.stock_location.created',
      entityType: 'inv.stock_location',
      entityId: created.id,
      companyId: created.companyId,
      branchId: created.branchId,
      requestRef: 'inv.stock-location-create',
      details: [
        { field: 'locationCode', classification: 'internal', value: created.locationCode },
        { field: 'locationType', classification: 'internal', value: created.locationType },
      ],
    });
    return toCreatedLocationView(created);
  }

  // -------------------------------------------------------------------------
  // P1-32-PRE-105…106 — what the tenant sells an item for.
  // -------------------------------------------------------------------------

  /**
   * Every configured price of one item, most specific first.
   *
   * Readable with `inv.item.read`, tenant-wide, like the item itself. A selling
   * price is what a customer is quoted at the counter, not what the part cost the
   * tenant to buy: `inv.item_cost_details` and `inv.item_cost_layers` are the cost
   * side and stay gated by `inv.cost.view` in the database.
   */
  public async listSalePrices(db: DbHandle, itemId: string): Promise<ItemSalePriceListView> {
    const item = await this.requireItem(db, itemId);
    const prices = await this.repository.listItemSalePrices(db, itemId);
    return { itemId: item.id, sku: item.sku, prices: prices.map(toSalePriceView) };
  }

  /**
   * Sets the price for one (item, company, branch) signature.
   *
   * Create and revise are the same act on purpose: `uq_item_sale_prices_signature`
   * permits exactly one live row per signature, so a caller repricing an item is
   * not asked to discover whether a row already exists, and a repeated call is
   * naturally idempotent rather than a `23505`.
   *
   * A branch narrowing must name its company, and both are authorized where they
   * are named — a tenant-wide price requires the code held tenant-wide, because a
   * row with no company applies in every branch of every company.
   */
  public async setSalePrice(
    db: DbHandle,
    itemId: string,
    input: {
      readonly companyId?: string | undefined;
      readonly branchId?: string | undefined;
      readonly currencyCode: string;
      /** Exact decimal STRING. Never a number: `numeric(18,4)` is not IEEE-754. */
      readonly unitPrice: string;
      readonly taxClassId?: string | undefined;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<ItemSalePriceView> {
    const item = await this.requireItem(db, itemId);
    if (input.branchId !== undefined && input.companyId === undefined) {
      refuse(
        'body.companyId',
        'branch_needs_company',
        'A price narrowed to a branch must name the company that branch belongs to'
      );
    }
    if (input.taxClassId !== undefined && input.companyId === undefined) {
      refuse(
        'body.companyId',
        'tax_class_needs_company',
        'A tax class belongs to a company, so a tenant-wide price cannot name one'
      );
    }
    if (input.companyId === undefined) {
      // A price with no company applies in every branch of every company, so the
      // authority must be held the same way. Checked here and not by the route:
      // `scope: 'tenant'` with no concrete target degrades to the scope-blind
      // `iam.has_permission`, which a grant scoped to ONE branch satisfies — and
      // that caller would otherwise set the price the whole tenant sells at.
      if (!(await callerHoldsPermissionTenantWide(db, MANAGE_PERMISSION))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A price with no company applies in every branch of the tenant, so setting one ' +
            'requires inv.item.manage granted tenant-wide. Name the company to price one.',
          safeDetails: { requiredPermissions: [MANAGE_PERMISSION] },
        });
      }
    } else {
      await authorizeScope({
        companyId: input.companyId,
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      });
    }

    let unitPrice: string;
    let currencyCode: string;
    try {
      unitPrice = parseNonNegative(input.unitPrice, MONEY).toString();
      currencyCode = assertCurrencyCode(input.currencyCode);
    } catch (cause) {
      if (cause instanceof DecimalError) {
        refuse('body.unitPrice', 'custom', cause.message);
      }
      throw cause;
    }

    let priceId: string;
    try {
      priceId = await this.repository.setItemSalePrice(db, {
        itemId,
        companyId: input.companyId ?? null,
        branchId: input.branchId ?? null,
        currencyCode,
        unitPrice,
        taxClassId: input.taxClassId ?? null,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-RES-001', {
          message: 'The company, branch, tax class or currency named is not in this organisation',
        });
      }
      if (isSqlState(cause, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message: 'The price was refused: an archived item takes no price',
        });
      }
      throw cause;
    }

    const saved = await this.repository.readItemSalePrice(db, priceId);
    /* c8 ignore next 3 -- written in this transaction under the tenant predicate
       the read applies; unreachable without a policy change. */
    if (saved === null) {
      throw new Error('inventory: item sale price was not readable back');
    }
    await appendAudit(db, {
      action: 'inv.item_sale_price.set',
      entityType: 'inv.item_sale_price',
      entityId: saved.id,
      ...(saved.companyId === null ? {} : { companyId: saved.companyId }),
      ...(saved.branchId === null ? {} : { branchId: saved.branchId }),
      requestRef: 'inv.item-sale-price-set',
      details: [
        { field: 'sku', classification: 'internal', value: item.sku },
        { field: 'currencyCode', classification: 'internal', value: saved.currencyCode },
        // `restricted`: a selling price is money, and `iam.audit_records` carries no
        // `sal.finance.view` gate. The trail records THAT the price was set and by
        // whom, which is the fact an investigation needs; the figure lives on the row.
        { field: 'unitPrice', classification: 'restricted', value: saved.unitPrice },
        { field: 'taxClassId', classification: 'internal', value: saved.taxClassId },
      ],
    });
    return toSalePriceView(saved);
  }

  private async requireItem(db: DbHandle, itemId: string): Promise<ItemRow> {
    const item = await this.repository.readItem(db, itemId);
    if (item === null) {
      throw new AppFailure('ERR-RES-001', { message: `Item ${itemId} was not found` });
    }
    return item;
  }
}
