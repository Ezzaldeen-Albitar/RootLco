/**
 * GET/POST /api/v1/customers/{customerId}/alerts (Phase 1-16, P1-16-BE-009;
 * GET added by the P1-16 remediation for `P1-27-INT-001`).
 *
 * POST raises an operational alert that staff will see when this customer next
 * appears. Alerts are advisory — they inform the person at the counter; they do
 * not restrict what the platform will do. Restrictions do that, and they are a
 * separate operation with a separate permission and a mandatory reason.
 *
 * GET returns only alerts in force today: `active IS TRUE` **and** an
 * `effective_to` that has not passed. The table carries two independent ways to
 * stop an alert and reading one without the other would show a caution somebody
 * had already turned off — and a false alert costs trust in every true one after
 * it.
 *
 * `severity` is not the sort key. It is `text` with a CHECK rather than an enum,
 * so `ORDER BY severity` sorts alphabetically and would rank `info` above
 * `warning`. It is on every row and the screen ranks it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { crmModule, ALERT_SEVERITIES, ALERT_TYPES, MAX_ALERT_MESSAGE } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();
export const Body = z
  .object({
    alertType: z.enum(ALERT_TYPES),
    severity: z.enum(ALERT_SEVERITIES),
    message: z.string().min(1).max(MAX_ALERT_MESSAGE),
  })
  .strict();

export const ALERT_LIST_OPERATION = defineOperation({
  id: 'crm.alert-list',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}/alerts',
  summary: 'List the advisory alerts in force against a customer.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const ALERT_RAISE_OPERATION = defineOperation({
  id: 'crm.alert-raise',
  successStatus: 201,
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/alerts',
  summary: 'Raise an advisory alert against a customer.',
  permissions: ['crm.customer.governance.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.alert_raised',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    ALERT_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await crmModule().customerRead.listAlerts(
        db,
        params.customerId,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    }),
    { params }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ALERT_RAISE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerGovernance.raiseAlert(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
