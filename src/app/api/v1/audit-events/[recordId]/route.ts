/**
 * GET /api/v1/audit-events/{recordId} (P1-14).
 *
 * One audit record, with its before/after detail rows **only** when the caller
 * additionally holds `iam.sensitive.view`. Returning details on the list
 * endpoint would turn casual browsing into a bulk export; requiring a second
 * permission for them is the ADV-03 boundary in practice.
 *
 * The detail values were masked by `iam.audit_mask` at **write** time for
 * `restricted` and `secret` classifications — the unmasked value was never
 * stored — so this is not a place where a mistake could un-mask something.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ recordId: schemas.uuid });

export const AUDIT_EVENT_DETAIL_OPERATION = defineOperation({
  id: 'iam.audit-event-detail',
  module: 'iam',
  method: 'GET',
  path: '/audit-events/{recordId}',
  summary: 'Read one audit record, with masked details for sensitive-view holders.',
  permissions: ['iam.audit.view'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'iam.audit.viewed',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ recordId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    AUDIT_EVENT_DETAIL_OPERATION,
    request,
    async ({ db }) => ({ body: await iamModule().auditView.detail(db, params.recordId) }),
    { params }
  );
}
