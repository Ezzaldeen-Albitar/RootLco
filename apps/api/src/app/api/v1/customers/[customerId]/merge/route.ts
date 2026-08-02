/**
 * POST /api/v1/customers/{customerId}/merge (Phase 1-16, FR-CRM-003,
 * BR-CRM-001, P1-16-BE-015).
 *
 * Merges the path customer (the source) into the survivor named in the body.
 *
 * ## Route shape
 *
 * The plan text writes this as `{customerId}:merge`. It is expressed here as a
 * `/merge` sub-resource for the same two reasons as the duplicate review: the
 * phase's route convention rules out colon-verb paths, and a `:` cannot appear
 * in a directory name on Windows, so the colon form is unbuildable here. The
 * operation, permission, and semantics are exactly as specified.
 *
 * ## An approval reference is mandatory
 *
 * `crm.partner_merges.approval_ref` is `NOT NULL` and not-blank. A merge is
 * irreversible in practice — the duplicate becomes read-only and the two
 * histories are permanently associated — so it records who authorised it, not
 * merely who executed it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    /** The record that survives. The path customer is redirected into it. */
    survivorId: schemas.uuid,
    approvalRef: z.string().min(1).max(120),
  })
  .strict();

export const CUSTOMER_MERGE_OPERATION = defineOperation({
  id: 'crm.customer-merge',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/merge',
  summary: 'Merge a duplicate customer into the surviving record.',
  permissions: ['crm.customer.merge'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.merged',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

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
    CUSTOMER_MERGE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await crmModule().customerIdentity.mergeCustomers(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
