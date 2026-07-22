/**
 * POST /api/v1/iam/invitations (P1-14).
 *
 * Creates a provider identity and an `invited` RootLco account, optionally with
 * role grants bounded by the inviter's own delegable authority.
 *
 * The tenant is **not** an input. It comes from the resolved context, so an
 * inviter cannot invite into a tenant they do not belong to — there is no field
 * in which to express one.
 *
 * Idempotent: creating a provider identity is not free to repeat, and a retried
 * POST that produced a second live invitation link would be a real defect. The
 * key is bound to the resolved principal and the canonicalised body, so a
 * different user replaying the same key gets a conflict rather than the first
 * caller's result.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const InviteBody = z.object({
  email: z.string().min(3).max(320),
  displayName: z.string().min(1).max(200),
  mfaRequired: z.boolean().optional(),
  redirectTo: z.string().url().max(2048).optional(),
  roleIds: z.array(schemas.uuid).max(20).optional(),
});

export const INVITE_OPERATION = defineOperation({
  id: 'iam.invitation-create',
  module: 'iam',
  method: 'POST',
  path: '/iam/invitations',
  summary: 'Invite a user into the caller tenant and create their invited account.',
  permissions: ['iam.user.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.user.invited',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    INVITE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await iamModule().invitations.invite(db, await parseJsonBody(raw, InviteBody)),
    }),
    // The parsed body feeds the idempotency fingerprint. It is read from a clone
    // so the handler can still consume the original stream.
    { body }
  );
}
