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
 *
 * ## A refused seat leaves nothing behind
 *
 * When the organisation's subscription seats are spent, `tg_user_accounts_capacity`
 * refuses the account INSERT and the caller receives ERR-CAP-001 with the seat
 * numbers. That refusal happens AFTER `provider.invite` has created the identity,
 * and a transaction rollback cannot reach the provider — so the service undoes
 * that one write itself: the identity this request created is removed again, by
 * the subject the provider returned to this request. The seat count is unmoved,
 * no account, membership, role grant or scope row exists, no audit record claims
 * an invitation happened, and the address can be invited again the moment a seat
 * is free. A compensation the provider refuses is logged and the caller still
 * gets ERR-CAP-001, because the refusal is what is true.
 *
 * An identity that outlived an earlier refusal — from before this was so — is
 * healed rather than blocked: an address the provider already knows is reused
 * when it is bound to this organisation and no account references it, and is
 * still refused as ERR-RES-002 when it belongs to anybody else. See
 * `InvitationService.invite` for why that test needs no cross-tenant read.
 *
 * A seat pre-check is deliberately still absent: the trigger's per-tenant
 * advisory lock is the only reading two concurrent invitations cannot both pass,
 * so exactly one of them takes the last seat and the other is refused.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const InviteBody = z.object({
  email: z.string().min(3).max(320),
  displayName: z.string().min(1).max(200),
  mfaRequired: z.boolean().optional(),
  redirectTo: z.string().url().max(2048).optional(),
  roleIds: z.array(schemas.uuid).max(20).optional(),
});

export const INVITE_OPERATION = defineOperation({
  id: 'iam.invitation-create',
  successStatus: 201,
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
