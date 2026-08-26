/**
 * POST /api/v1/iam/invitations/{userId}/activation (P1-14).
 *
 * Activates an invited account — **after** asking the provider whether the
 * invitee actually accepted. An unconfirmed or disabled provider identity is
 * refused, so this cannot rubber-stamp an invitation nobody responded to.
 *
 * Activation is administrative because the protected schema makes it so: every
 * write to `iam.user_accounts` and `iam.user_status_history` is gated on
 * `iam.user.manage`, and `iam.has_permission` returns false for an account that
 * is not yet `active` — so the invitee cannot activate itself, and no request
 * path exists that would let it. See the Authentication and Session Architecture
 * record for the executable evidence behind that statement.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ userId: schemas.uuid });
export const ActivateBody = z.object({ reason: z.string().min(1).max(500) });

export const INVITATION_ACTIVATE_OPERATION = defineOperation({
  id: 'iam.invitation-activate',
  module: 'iam',
  method: 'POST',
  path: '/iam/invitations/{userId}/activation',
  summary: 'Activate an invited account once the provider confirms acceptance.',
  permissions: ['iam.user.manage'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'iam.user.activated',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    INVITATION_ACTIVATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const parsed = await parseJsonBody(raw, ActivateBody);
      return { body: await iamModule().invitations.activate(db, params.userId, parsed.reason) };
    },
    { params, body }
  );
}
