/**
 * /api/v1/vehicle-fluid-specifications — attributable service capacities
 * (P1-32-PRE-126).
 *
 * `GET` lists the tenant's specifications; `POST` records one. A specification binds
 * a make, optionally a model, model years and an engine variant, a service condition
 * and optionally the item family it is for, to a capacity, its unit and the source it
 * was read from.
 *
 * ## Recorded is not confirmed
 *
 * A recorded specification resolves nothing. Only after
 * `POST /vehicle-fluid-specifications/{specificationId}/confirmation` does a
 * requirement derived for a matching vehicle take its allowance from it. There is no
 * zero capacity and no default: a vehicle no confirmed specification answers for gets
 * a requirement that says so.
 *
 * ## Tenant-wide authority
 *
 * A specification holds in every branch, so `inv.specification.manage` must be held
 * tenant-wide.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  MAX_ENGINE_VARIANT,
  MAX_SOURCE_REFERENCE,
  QUANTITY_MAX,
  SERVICE_CONDITION_FORMAT,
  VEHICLE_SPECIFICATION_STATES,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    makeId: schemas.uuid.optional(),
    modelId: schemas.uuid.optional(),
    serviceCondition: z.string().regex(SERVICE_CONDITION_FORMAT).optional(),
    status: z.enum(VEHICLE_SPECIFICATION_STATES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const VEHICLE_SPECIFICATION_LIST_OPERATION = defineOperation({
  id: 'inv.vehicle-specification-list',
  module: 'inventory',
  method: 'GET',
  path: '/vehicle-fluid-specifications',
  summary: "List the tenant's vehicle service specifications, newest first.",
  permissions: ['inv.item.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(VEHICLE_SPECIFICATION_LIST_OPERATION, request, async ({ db }) => {
    const query = parseOrFail(ListQuery, raw, 'query');
    return {
      body: await inventoryModule().referenceData.listSpecifications(
        db,
        {
          ...(query.makeId === undefined ? {} : { makeId: query.makeId }),
          ...(query.modelId === undefined ? {} : { modelId: query.modelId }),
          ...(query.serviceCondition === undefined
            ? {}
            : { serviceCondition: query.serviceCondition }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }
      ),
    };
  });
}

const ModelYear = z.number().int().min(1).max(9999);

export const RecordBody = z
  .object({
    makeId: schemas.uuid,
    modelId: schemas.uuid.optional(),
    modelYearFrom: ModelYear.optional(),
    modelYearTo: ModelYear.optional(),
    engineVariant: z.string().trim().min(1).max(MAX_ENGINE_VARIANT).optional(),
    serviceCondition: z.string().regex(SERVICE_CONDITION_FORMAT),
    itemCategoryId: schemas.uuid.optional(),
    /** A decimal STRING, always positive — an unknown capacity is not recorded. */
    capacity: z
      .string()
      .regex(
        /^\d{1,9}(\.\d{1,3})?$/,
        `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
      ),
    uomId: schemas.uuid,
    sourceReference: z.string().trim().min(1).max(MAX_SOURCE_REFERENCE),
  })
  .strict();

export const VEHICLE_SPECIFICATION_CREATE_OPERATION = defineOperation({
  id: 'inv.vehicle-specification-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/vehicle-fluid-specifications',
  summary: 'Record a vehicle service capacity with its unit and source, unconfirmed.',
  permissions: ['inv.specification.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'inv.vehicle_specification.recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    VEHICLE_SPECIFICATION_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(RecordBody, body, 'body');
      const created = await inventoryModule().referenceData.recordSpecification(db, {
        makeId: parsed.makeId,
        ...(parsed.modelId === undefined ? {} : { modelId: parsed.modelId }),
        ...(parsed.modelYearFrom === undefined ? {} : { modelYearFrom: parsed.modelYearFrom }),
        ...(parsed.modelYearTo === undefined ? {} : { modelYearTo: parsed.modelYearTo }),
        ...(parsed.engineVariant === undefined ? {} : { engineVariant: parsed.engineVariant }),
        serviceCondition: parsed.serviceCondition,
        ...(parsed.itemCategoryId === undefined ? {} : { itemCategoryId: parsed.itemCategoryId }),
        capacity: parsed.capacity,
        uomId: parsed.uomId,
        sourceReference: parsed.sourceReference,
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
