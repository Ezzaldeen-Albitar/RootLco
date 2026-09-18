/**
 * The facts a material allowance is measured against (P1-32-PRE-125, PRE-126): exact
 * unit conversions and attributable vehicle service specifications.
 *
 * Both are TENANT-WIDE reference data. A conversion says how many litres a pack of an
 * oil holds in every branch, and a specification says how much oil a model takes in
 * every branch, so changing either changes what every later requirement in the tenant
 * is measured against. The write authority is therefore checked as held TENANT-WIDE,
 * for the reason `inv.item-identifier-add` records: a tenant-scoped operation with no
 * concrete target degrades to the scope-blind permission read, and a grant confined to
 * one branch would otherwise restate a fact the whole tenant relies on.
 *
 * ## Where the guarantees live
 *
 * In `inv.set_item_unit_conversion` (one live row per signature, no live reverse,
 * cross-dimension rows must name the item) and in the specification functions (a
 * capacity is positive and sourced, confirmation is a separate attributable act, two
 * confirmed rows of one signature never overlap in model year). This service adds the
 * authority, the field a refusal is about, and the audit trail.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import {
  UNIT_CONVERSION_ORDER,
  VEHICLE_SPECIFICATION_ORDER,
  type InventoryRepository,
  type UnitConversionRow,
  type VehicleSpecificationRow,
} from '../data/inventory-repository';
import { parseQuantity } from './inventory-failures';

const CONVERSION_PERMISSION = 'inv.unit_conversion.manage';
const SPECIFICATION_PERMISSION = 'inv.specification.manage';

export interface UnitConversionView {
  readonly id: string;
  /** Null for a tenant-wide conversion within one dimension. */
  readonly itemId: string | null;
  readonly itemSku: string | null;
  readonly fromUomId: string;
  readonly fromUomCode: string;
  readonly toUomId: string;
  readonly toUomCode: string;
  /** How many to-units ONE from-unit is, as an exact decimal string. */
  readonly factor: string;
  readonly sourceReference: string;
  readonly status: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly retiredBy: string | null;
  readonly retiredAt: string | null;
  readonly recordVersion: number;
}

export interface UnitConversionWriteView extends UnitConversionView {
  /** True when the call changed nothing because the row was already in that state. */
  readonly replayed: boolean;
}

export interface VehicleSpecificationView {
  readonly id: string;
  readonly makeId: string;
  readonly modelId: string | null;
  readonly modelYearFrom: number | null;
  readonly modelYearTo: number | null;
  readonly engineVariant: string | null;
  readonly serviceCondition: string;
  readonly itemCategoryId: string | null;
  /** Exact decimal string, always positive. */
  readonly capacity: string;
  readonly uomId: string;
  readonly uomCode: string;
  readonly sourceReference: string;
  readonly status: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly confirmedBy: string | null;
  readonly confirmedAt: string | null;
  readonly retiredBy: string | null;
  readonly retiredAt: string | null;
  readonly recordVersion: number;
}

export interface VehicleSpecificationWriteView extends VehicleSpecificationView {
  readonly replayed: boolean;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toConversionView(row: UnitConversionRow): UnitConversionView {
  return {
    id: row.id,
    itemId: row.itemId,
    itemSku: row.itemSku,
    fromUomId: row.fromUomId,
    fromUomCode: row.fromUomCode,
    toUomId: row.toUomId,
    toUomCode: row.toUomCode,
    factor: row.factor,
    sourceReference: row.sourceReference,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    retiredBy: row.retiredBy,
    retiredAt: iso(row.retiredAt),
    recordVersion: row.recordVersion,
  };
}

function toSpecificationView(row: VehicleSpecificationRow): VehicleSpecificationView {
  return {
    id: row.id,
    makeId: row.makeId,
    modelId: row.modelId,
    modelYearFrom: row.modelYearFrom,
    modelYearTo: row.modelYearTo,
    engineVariant: row.engineVariant,
    serviceCondition: row.serviceCondition,
    itemCategoryId: row.itemCategoryId,
    capacity: row.capacity,
    uomId: row.uomId,
    uomCode: row.uomCode,
    sourceReference: row.sourceReference,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    confirmedBy: row.confirmedBy,
    confirmedAt: iso(row.confirmedAt),
    retiredBy: row.retiredBy,
    retiredAt: iso(row.retiredAt),
    recordVersion: row.recordVersion,
  };
}

function refuseField(path: string, rule: string, message: string): never {
  throw new AppFailure('ERR-VAL-001', {
    message,
    safeDetails: { violations: [{ path, rule }] },
  });
}

async function requireTenantWide(db: DbHandle, permission: string, what: string): Promise<void> {
  if (!(await callerHoldsPermissionTenantWide(db, permission))) {
    throw new AppFailure('ERR-IAM-001', {
      message: `${what} applies in every branch, so changing one requires ${permission} granted tenant-wide.`,
      safeDetails: { requiredPermissions: [permission] },
    });
  }
}

export class InventoryReferenceDataService {
  public constructor(private readonly repository: InventoryRepository) {}

  // -------------------------------------------------------------------------
  // Unit conversions.
  // -------------------------------------------------------------------------

  /** Conversions of the tenant, narrowed to the ones that apply to one item. */
  public async listConversions(
    db: DbHandle,
    filter: { readonly itemId?: string | undefined; readonly includeRetired: boolean },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined }
  ): Promise<Page<UnitConversionView>> {
    const result = await this.repository.listUnitConversions(
      db,
      filter,
      pageRequest(UNIT_CONVERSION_ORDER, page)
    );
    return { ...result, items: result.items.map(toConversionView) };
  }

  /**
   * States a conversion. A live row with the same signature is retired in the same
   * transaction, so a changed factor is a new attributable row and the old one stays.
   */
  public async setConversion(
    db: DbHandle,
    input: {
      readonly itemId?: string | undefined;
      readonly fromUomId: string;
      readonly toUomId: string;
      readonly factor: string;
      readonly sourceReference: string;
    }
  ): Promise<UnitConversionWriteView> {
    await requireTenantWide(db, CONVERSION_PERMISSION, 'A unit conversion');
    if (input.fromUomId === input.toUomId) {
      refuseField('body.toUomId', 'same_unit', 'A conversion joins two different units');
    }
    if (/^0+(\.0+)?$/.test(input.factor)) {
      refuseField('body.factor', 'positive', 'A conversion factor is positive');
    }
    if (input.itemId !== undefined && !(await this.repository.readItem(db, input.itemId))) {
      throw new AppFailure('ERR-RES-001', { message: `Item ${input.itemId} was not found` });
    }

    let conversionId: string;
    try {
      conversionId = await this.repository.setUnitConversion(db, {
        itemId: input.itemId ?? null,
        fromUomId: input.fromUomId,
        toUomId: input.toUomId,
        factor: input.factor,
        sourceReference: input.sourceReference,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        refuseField('body.fromUomId', 'unknown_unit', 'A unit of measure is not visible');
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // What remains after the checks above is the database's own rules: a
        // tenant-wide row crossing dimensions, or a live reverse of this direction.
        refuseField(
          input.itemId === undefined ? 'body.itemId' : 'body.toUomId',
          'conversion_refused',
          'The conversion was refused: a conversion between different kinds of unit must ' +
            'name its item, and a direction whose reverse is live must wait until the ' +
            'reverse is retired'
        );
      }
      throw error;
    }
    const created = await this.requireConversion(db, conversionId);
    await appendAudit(db, {
      action: 'inv.unit_conversion.set',
      entityType: 'inv.item_unit_conversion',
      entityId: created.id,
      requestRef: 'inv.unit-conversion-set',
      details: [
        { field: 'itemId', classification: 'internal', value: created.itemId },
        { field: 'fromUomId', classification: 'internal', value: created.fromUomId },
        { field: 'toUomId', classification: 'internal', value: created.toUomId },
        { field: 'factor', classification: 'internal', value: created.factor },
        { field: 'sourceReference', classification: 'internal', value: created.sourceReference },
      ],
    });
    return { ...toConversionView(created), replayed: false };
  }

  /** Retires a conversion. Idempotent on a conversion that is already retired. */
  public async retireConversion(
    db: DbHandle,
    conversionId: string
  ): Promise<UnitConversionWriteView> {
    await requireTenantWide(db, CONVERSION_PERMISSION, 'A unit conversion');
    const before = await this.repository.readUnitConversion(db, conversionId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Unit conversion ${conversionId} was not found`,
      });
    }
    if (before.status === 'retired') {
      return { ...toConversionView(before), replayed: true };
    }
    try {
      await this.repository.retireUnitConversion(db, conversionId);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message: `Unit conversion ${conversionId} could not be retired in its current state`,
        });
      }
      throw error;
    }
    const after = await this.requireConversion(db, conversionId);
    await appendAudit(db, {
      action: 'inv.unit_conversion.retired',
      entityType: 'inv.item_unit_conversion',
      entityId: after.id,
      requestRef: 'inv.unit-conversion-retire',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'factor', classification: 'internal', value: after.factor },
      ],
    });
    return { ...toConversionView(after), replayed: false };
  }

  // -------------------------------------------------------------------------
  // Vehicle service specifications.
  // -------------------------------------------------------------------------

  public async listSpecifications(
    db: DbHandle,
    filter: {
      readonly makeId?: string | undefined;
      readonly modelId?: string | undefined;
      readonly serviceCondition?: string | undefined;
      readonly status?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined }
  ): Promise<Page<VehicleSpecificationView>> {
    const result = await this.repository.listVehicleSpecifications(
      db,
      filter,
      pageRequest(VEHICLE_SPECIFICATION_ORDER, page)
    );
    return { ...result, items: result.items.map(toSpecificationView) };
  }

  /** Records a capacity with its source. It resolves nothing until it is confirmed. */
  public async recordSpecification(
    db: DbHandle,
    input: {
      readonly makeId: string;
      readonly modelId?: string | undefined;
      readonly modelYearFrom?: number | undefined;
      readonly modelYearTo?: number | undefined;
      readonly engineVariant?: string | undefined;
      readonly serviceCondition: string;
      readonly itemCategoryId?: string | undefined;
      readonly capacity: string;
      readonly uomId: string;
      readonly sourceReference: string;
    }
  ): Promise<VehicleSpecificationWriteView> {
    await requireTenantWide(db, SPECIFICATION_PERMISSION, 'A vehicle service specification');
    const capacity = parseQuantity(input.capacity, 'capacity');
    if (
      input.modelYearFrom !== undefined &&
      input.modelYearTo !== undefined &&
      input.modelYearFrom > input.modelYearTo
    ) {
      refuseField(
        'body.modelYearTo',
        'year_range',
        'The last model year may not be earlier than the first'
      );
    }

    let specificationId: string;
    try {
      specificationId = await this.repository.recordVehicleSpecification(db, {
        makeId: input.makeId,
        modelId: input.modelId ?? null,
        modelYearFrom: input.modelYearFrom ?? null,
        modelYearTo: input.modelYearTo ?? null,
        engineVariant: input.engineVariant ?? null,
        serviceCondition: input.serviceCondition,
        itemCategoryId: input.itemCategoryId ?? null,
        capacity: capacity.toString(),
        uomId: input.uomId,
        sourceReference: input.sourceReference,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-RES-001', {
          message: 'The specification names a make, model, item family or unit that is not visible',
        });
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        refuseField(
          'body.modelId',
          'specification_refused',
          'The specification was refused: a model must belong to the make it is recorded under'
        );
      }
      throw error;
    }
    const created = await this.requireSpecification(db, specificationId);
    await appendAudit(db, {
      action: 'inv.vehicle_specification.recorded',
      entityType: 'inv.vehicle_fluid_specification',
      entityId: created.id,
      requestRef: 'inv.vehicle-specification-create',
      details: [
        { field: 'makeId', classification: 'internal', value: created.makeId },
        { field: 'modelId', classification: 'internal', value: created.modelId },
        {
          field: 'modelYears',
          classification: 'internal',
          value: `${created.modelYearFrom ?? ''}-${created.modelYearTo ?? ''}`,
        },
        { field: 'engineVariant', classification: 'internal', value: created.engineVariant },
        { field: 'serviceCondition', classification: 'internal', value: created.serviceCondition },
        { field: 'itemCategoryId', classification: 'internal', value: created.itemCategoryId },
        { field: 'capacity', classification: 'internal', value: created.capacity },
        { field: 'uomId', classification: 'internal', value: created.uomId },
        { field: 'sourceReference', classification: 'internal', value: created.sourceReference },
      ],
    });
    return { ...toSpecificationView(created), replayed: false };
  }

  /**
   * Confirms a recorded specification, which is what lets it resolve. Idempotent on a
   * specification that is already confirmed.
   */
  public async confirmSpecification(
    db: DbHandle,
    specificationId: string
  ): Promise<VehicleSpecificationWriteView> {
    await requireTenantWide(db, SPECIFICATION_PERMISSION, 'A vehicle service specification');
    const before = await this.readSpecificationOrFail(db, specificationId);
    if (before.status === 'confirmed') {
      return { ...toSpecificationView(before), replayed: true };
    }
    if (before.status !== 'recorded') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Specification ${specificationId} is ${before.status} and cannot be confirmed`,
      });
    }
    try {
      await this.repository.confirmVehicleSpecification(db, specificationId);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.exclusionViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message:
            'A confirmed specification for the same vehicle and service already covers these ' +
            'model years; retire it before confirming this one',
        });
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message: `Specification ${specificationId} could not be confirmed in its current state`,
        });
      }
      throw error;
    }
    const after = await this.requireSpecification(db, specificationId);
    await appendAudit(db, {
      action: 'inv.vehicle_specification.confirmed',
      entityType: 'inv.vehicle_fluid_specification',
      entityId: after.id,
      requestRef: 'inv.vehicle-specification-confirm',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'createdBy', classification: 'internal', value: after.createdBy },
        { field: 'capacity', classification: 'internal', value: after.capacity },
      ],
    });
    return { ...toSpecificationView(after), replayed: false };
  }

  /** Retires a specification. Idempotent on a specification that is already retired. */
  public async retireSpecification(
    db: DbHandle,
    specificationId: string
  ): Promise<VehicleSpecificationWriteView> {
    await requireTenantWide(db, SPECIFICATION_PERMISSION, 'A vehicle service specification');
    const before = await this.readSpecificationOrFail(db, specificationId);
    if (before.status === 'retired') {
      return { ...toSpecificationView(before), replayed: true };
    }
    try {
      await this.repository.retireVehicleSpecification(db, specificationId);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message: `Specification ${specificationId} could not be retired in its current state`,
        });
      }
      throw error;
    }
    const after = await this.requireSpecification(db, specificationId);
    await appendAudit(db, {
      action: 'inv.vehicle_specification.retired',
      entityType: 'inv.vehicle_fluid_specification',
      entityId: after.id,
      requestRef: 'inv.vehicle-specification-retire',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
      ],
    });
    return { ...toSpecificationView(after), replayed: false };
  }

  private async readSpecificationOrFail(
    db: DbHandle,
    specificationId: string
  ): Promise<VehicleSpecificationRow> {
    const row = await this.repository.readVehicleSpecification(db, specificationId);
    if (!row) {
      throw new AppFailure('ERR-RES-001', {
        message: `Specification ${specificationId} was not found`,
      });
    }
    return row;
  }

  private async requireConversion(db: DbHandle, conversionId: string): Promise<UnitConversionRow> {
    const row = await this.repository.readUnitConversion(db, conversionId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'The unit conversion vanished after it was written',
      });
    }
    return row;
  }

  private async requireSpecification(
    db: DbHandle,
    specificationId: string
  ): Promise<VehicleSpecificationRow> {
    const row = await this.repository.readVehicleSpecification(db, specificationId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'The specification vanished after it was written',
      });
    }
    return row;
  }
}
