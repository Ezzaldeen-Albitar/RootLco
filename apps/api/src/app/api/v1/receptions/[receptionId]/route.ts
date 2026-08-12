/**
 * GET /api/v1/receptions/{receptionId} — one reception visit (P1-27 remediation
 * executed by P1-18, `P1-27-INT-010`).
 *
 * The reception domain had no read of any kind: `rec.reception-approve` and
 * `rec.reception-convert-to-work-order` both demand `If-Match`, and the only
 * source of a visit's `recordVersion` was the response of a write the caller
 * had just performed — so a visit was reachable in exactly one unbroken session
 * and in no other circumstance. This route publishes the version as an ETag,
 * which is the whole fix for the If-Match supply problem: the value a caller
 * must send back is the one it just saw.
 *
 * The visit is addressed by id, so the pre-handler authorization check has no
 * branch to narrow by and `authorizeScope` re-decides against the row's own
 * company and branch once it is read (P1-18-A-01).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });

export const RECEPTION_DETAIL_OPERATION = defineOperation({
  id: 'rec.reception-detail',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}',
  summary: 'Read one reception visit, its origin, custody state and record version.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  // The raw params go to the pipeline and the schema runs INSIDE it, so a
  // malformed id is rendered as the shared problem document rather than an
  // unhandled 500.
  const raw = await route.params;
  return handleOperation(
    RECEPTION_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const reception = await receptionModule().receptionRead.readReception(
        db,
        params.receptionId,
        authorizeScope
      );
      // The ETag is what lets approve/convert/close be driven without a prior
      // write in the same session.
      return { body: reception, recordVersion: reception.recordVersion };
    },
    { params: raw }
  );
}
