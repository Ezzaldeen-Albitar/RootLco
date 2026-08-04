/**
 * GET /api/v1/customers/{customerId} — the customer profile header
 * (P1-16 remediation, `P1-27-INT-001`).
 *
 * There was no route module here at all. `/customers` searched, every
 * sub-resource accepted a write, and nothing in the platform could return a
 * single customer — so a profile screen had no way to learn a customer's name
 * from its id.
 *
 * The response carries `recordVersion`, which the handler also emits as an
 * `ETag`. That is the half of optimistic concurrency that was missing: the write
 * routes have always demanded `If-Match`, and no operation published the value to
 * put in it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { crmModule } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });

export const CUSTOMER_READ_OPERATION = defineOperation({
  id: 'crm.customer-read',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}',
  summary: 'Read one customer, with its individual or company profile.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  auditClass: 'none',
  // The same policy `crm.customer-timeline` and `crm.customer-history` carry. Its
  // key includes the operation, so a profile screen fanning out to nine reads
  // spends one request from each of nine buckets rather than nine from one — 30
  // profile views a minute per operator, not three.
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    CUSTOMER_READ_OPERATION,
    request,
    async ({ db }) => {
      const customer = await crmModule().customerRead.readCustomer(db, params.customerId);
      return { body: customer, recordVersion: customer.recordVersion };
    },
    { params }
  );
}
