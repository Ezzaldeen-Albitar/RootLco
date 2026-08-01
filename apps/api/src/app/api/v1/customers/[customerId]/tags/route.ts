/**
 * POST /api/v1/customers/{customerId}/tags (Phase 1-16, P1-16-BE-010).
 *
 * Tags are modelled as `crm.customer_segments` plus an assignment, because that
 * is what the frozen schema provides — and it is the better model: the segment
 * carries the tenant's definition of what the label means, so two staff members
 * typing "VIP" get one concept rather than two look-alike strings.
 *
 * Re-tagging an already-tagged customer answers 200 with `assigned: false`
 * rather than a conflict. The caller wanted the tag to be present, and it is.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, MAX_SEGMENT_CODE } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    segmentCode: z.string().min(2).max(MAX_SEGMENT_CODE),
    /** Display name used only when the segment is being created. */
    name: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();

export const TAG_ASSIGN_OPERATION = defineOperation({
  id: 'crm.tag-assign',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/tags',
  summary: 'Assign a segment tag to a customer.',
  permissions: ['crm.customer.governance.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.tag_assigned',
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
    TAG_ASSIGN_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      const result = await crmModule().customerGovernance.assignTag(db, params.customerId, {
        segmentCode: input.segmentCode,
        name: input.name ?? null,
      });
      return { status: result.assigned ? 201 : 200, body: result };
    },
    { params, body }
  );
}
