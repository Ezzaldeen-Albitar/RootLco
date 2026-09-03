/**
 * DELETE /api/v1/iam/invitations/{userId} (P1-14).
 *
 * Cancels an outstanding invitation: the account moves `invited → archived` and
 * the provider identity is disabled so the emailed link cannot be used to sign
 * in to an identity with no application account.
 *
 * `archived` is terminal, so a cancelled invitation is never revived — re-
 * inviting the same address creates a new account. That is deliberate: reviving
 * an archived account would resurrect whatever grants it once had.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ userId: schemas.uuid });
export const CancelBody = z.object({ reason: z.string().min(1).max(500) });

export const INVITATION_CANCEL_OPERATION = defineOperation({
  id: 'iam.invitation-cancel',
  module: 'iam',
  method: 'DELETE',
  path: '/iam/invitations/{userId}',
  summary: 'Cancel an outstanding invitation and disable the provider identity.',
  permissions: ['iam.user.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.user.invitation_cancelled',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function DELETE(
  request: Request,
  route: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    INVITATION_CANCEL_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const body = await parseJsonBody(raw, CancelBody);
      await iamModule().invitations.cancel(db, params.userId, body.reason);
      return { body: { status: 'cancelled' } };
    },
    { params }
  );
}
