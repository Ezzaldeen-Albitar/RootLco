/**
 * GET / POST /api/v1/platform/organizations/{tenantId}/charges (P1-32-PRE-024).
 *
 * PLATFORM revenue — the subscription fees the Platform Owner records against
 * an organisation. Never tenant revenue: that is `sal.*`, under a different role,
 * and neither role can reach the other's tables.
 *
 * Every amount crosses the wire as a decimal STRING. `outstanding` on each charge
 * is computed by PostgreSQL in exact numeric and floored at zero; the settlement
 * of a charge is decided by a database trigger, not by this route.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { CHARGE_STATUSES, platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid }).strict();

const Query = z
  .object({
    status: z.enum(CHARGE_STATUSES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const ChargeRecordBody = z
  .object({
    subscriptionId: schemas.uuid.optional(),
    amount: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,4})?$/, 'must be a positive decimal string')
      .refine((value) => /[1-9]/.test(value), 'must be greater than zero'),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    description: z.string().trim().min(1).max(500),
  })
  .strict();

export const CHARGE_LIST_OPERATION = defineOperation({
  id: 'platform.charge-list',
  module: 'platform',
  method: 'GET',
  path: '/platform/organizations/{tenantId}/charges',
  summary: "List an organization's platform subscription charges with their receipts.",
  permissions: ['platform.billing.read'],
  scope: 'tenant',
  auditClass: 'none',
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const CHARGE_RECORD_OPERATION = defineOperation({
  id: 'platform.charge-record',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/charges',
  summary: 'Record a platform subscription charge against an organization.',
  permissions: ['platform.billing.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.subscription_charge.recorded',
  idempotent: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    CHARGE_LIST_OPERATION,
    request,
    async ({ db, request: req }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await platformModule().billing.listCharges(
          db,
          params.tenantId,
          { status: query.status },
          { cursor: query.cursor, limit: query.limit }
        ),
      };
    },
    { params: raw }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    CHARGE_RECORD_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(ChargeRecordBody, body, 'body');
      const recorded = await platformModule().billing.recordCharge(db, {
        tenantId: params.tenantId,
        subscriptionId: input.subscriptionId,
        amount: input.amount,
        currencyCode: input.currencyCode,
        dueOn: input.dueOn,
        description: input.description,
      });
      return { status: 201, body: recorded, recordVersion: recorded.recordVersion };
    },
    { params: raw, body }
  );
}
