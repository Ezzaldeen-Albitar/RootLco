/**
 * PATCH /api/v1/iam/approval-limits/{limitId} (P1-14).
 *
 * Closes an approval limit's window. `effective_to` is the **only** mutable
 * column: the amount, the currency, the subject, the company, and the start date
 * are all frozen by `tg_approval_limits_immutable` and, before that, by the
 * column-scoped grant — so an approved ceiling can be ended but never quietly
 * rewritten. Changing a ceiling means ending one limit and creating another,
 * which leaves both in the record.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ limitId: schemas.uuid });
export const PatchBody = z
  .object({ effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();

export const APPROVAL_LIMIT_END_OPERATION = defineOperation({
  id: 'iam.approval-limit-end',
  module: 'iam',
  method: 'PATCH',
  path: '/iam/approval-limits/{limitId}',
  summary: 'Close the effective window of an approval limit.',
  permissions: ['iam.approval.manage'],
  scope: 'tenant',
  auditClass: 'approval',
  auditAction: 'iam.approval_limit.ended',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ limitId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    APPROVAL_LIMIT_END_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const body = await parseJsonBody(raw, PatchBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await iamModule().access.endApprovalLimit(
        db,
        params.limitId,
        expectedVersion,
        body.effectiveTo
      );
      return { body: { status: 'ended' } };
    },
    { params }
  );
}
