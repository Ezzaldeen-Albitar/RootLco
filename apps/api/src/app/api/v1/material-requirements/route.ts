/**
 * /api/v1/material-requirements — what a work-order service line may consume
 * (P1-32-PRE-127).
 *
 * `POST` asks for material for one service line: an ENTERED allowance with the
 * source it was taken from, or one DERIVED from the confirmed vehicle specification
 * for the work order's vehicle. `GET` lists a branch's requirements with where each
 * allowance stands.
 *
 * ## Nothing is guessed
 *
 * A derivation that finds no confirmed specification is not refused, not zero and
 * not unlimited: it is stored as `approval_required` with the reason
 * `missing_specification` and no allowance. An item with no exact conversion into
 * the allowance unit is stored as `approval_required` / `missing_unit_conversion`.
 * Neither can be approved, and nothing can be drawn on either, until the fact exists.
 *
 * ## Two people
 *
 * Asking is `inv.material.request`; approving is `inv.material.approve` on
 * `POST /material-requirements/{requirementId}/approval`, and the database refuses an
 * approval by the person who asked whatever codes they hold.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import {
  MATERIAL_REQUIREMENT_STATES,
  MAX_ENGINE_VARIANT,
  MAX_SOURCE_REFERENCE,
  QUANTITY_MAX,
  SERVICE_CONDITION_FORMAT,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    workOrderId: schemas.uuid.optional(),
    status: z.enum(MATERIAL_REQUIREMENT_STATES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const MATERIAL_REQUIREMENT_LIST_OPERATION = defineOperation({
  id: 'inv.material-requirement-list',
  module: 'inventory',
  method: 'GET',
  path: '/material-requirements',
  summary: "List a branch's material requirements and where each allowance stands.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    MATERIAL_REQUIREMENT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().materials.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.workOrderId === undefined ? {} : { workOrderId: query.workOrderId }),
            ...(query.status === undefined ? {} : { status: query.status }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    scopeTargetOption(raw)
  );
}

/** Quantity is a decimal STRING — see `POST /stock-reservations`. */
const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

const Target = {
  serviceLineId: schemas.uuid,
  itemId: schemas.uuid.optional(),
  itemCategoryId: schemas.uuid.optional(),
};

export const CreateBody = z.discriminatedUnion('basis', [
  z
    .object({
      basis: z.literal('entered'),
      ...Target,
      allowanceQuantity: QuantityString,
      uomId: schemas.uuid,
      sourceReference: z.string().trim().min(1).max(MAX_SOURCE_REFERENCE),
    })
    .strict(),
  z
    .object({
      basis: z.literal('specification'),
      ...Target,
      serviceCondition: z.string().regex(SERVICE_CONDITION_FORMAT),
      engineVariant: z.string().trim().min(1).max(MAX_ENGINE_VARIANT).optional(),
    })
    .strict(),
]);

export const MATERIAL_REQUIREMENT_CREATE_OPERATION = defineOperation({
  id: 'inv.material-requirement-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/material-requirements',
  summary: 'Ask for material for a work-order service line, entered or from a specification.',
  permissions: ['inv.material.request'],
  // `branch`, with the concrete target resolved by the service from the SERVICE LINE:
  // a requirement lives in the branch of the work order it is for.
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.material_requirement.requested',
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
    MATERIAL_REQUIREMENT_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const target = {
        serviceLineId: parsed.serviceLineId,
        ...(parsed.itemId === undefined ? {} : { itemId: parsed.itemId }),
        ...(parsed.itemCategoryId === undefined ? {} : { itemCategoryId: parsed.itemCategoryId }),
      };
      const created = await inventoryModule().materials.create(
        db,
        parsed.basis === 'entered'
          ? {
              basis: 'entered',
              ...target,
              allowanceQuantity: parsed.allowanceQuantity,
              uomId: parsed.uomId,
              sourceReference: parsed.sourceReference,
            }
          : {
              basis: 'specification',
              ...target,
              serviceCondition: parsed.serviceCondition,
              ...(parsed.engineVariant === undefined
                ? {}
                : { engineVariant: parsed.engineVariant }),
            },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
