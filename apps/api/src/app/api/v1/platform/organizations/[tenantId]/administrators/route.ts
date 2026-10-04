/**
 * POST /api/v1/platform/organizations/{tenantId}/administrators (P1-32-PRE-151).
 *
 * Gives an organisation an administrator, or sends the outstanding invitation
 * again.
 *
 * ## The hole this closes
 *
 * `platform.organization-provision` establishes a first owner in the same
 * transaction that creates the tenant, and NOTHING could establish one
 * afterwards. An organisation whose owner never accepted their link, or whose
 * only administrator was archived, had no one who could sign in and no operation
 * that could give it someone — the control plane could watch it and not help it.
 *
 * ## Two acts, one address, one operation
 *
 * `mode: 'invite'` establishes an administrator: the provider identity, an
 * ACTIVE account, and an unrestricted grant of the organisation's own
 * `tenant_administrator` role — established first when the organisation holds
 * none. `mode: 'resend'` writes nothing and asks the provider for a fresh link
 * against the same subject.
 *
 * They are one operation because they are one question asked of one address, and
 * two routes would put the same address lock, the same target window and the
 * same authority behind two doors.
 *
 * ## Refusing by default
 *
 * An organisation that already has an active administrator is refused, because
 * quietly adding a second administrator to a live organisation is how an account
 * nobody asked for comes to exist. `additionalAdministrator` with a reason is
 * the deliberate acknowledgement, and the reason is recorded in the operator's
 * audit trail rather than being a checkbox that leaves no trace.
 *
 * The seat ceiling applies: `tg_user_accounts_capacity` refuses the account when
 * the plan's seats are spent, and the identity created for it is removed again
 * so the retry after a plan change is not blocked by an orphan.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid }).strict();

/**
 * A discriminated union, not a bag of optional fields: a re-invitation has no
 * display name to carry and an establishment must have one, and expressing that
 * with `.optional()` would let a request ask for an administrator with no name.
 *
 * The reason is required exactly when `additionalAdministrator` is set, in both
 * directions, so neither a silent second administrator nor an unexplained flag
 * can be sent.
 */
export const AdministratorBody = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('invite'),
      email: z.string().trim().min(3).max(320),
      displayName: z.string().trim().min(1).max(200),
      additionalAdministrator: z.boolean().optional(),
      reason: z.string().trim().min(1).max(500).optional(),
      redirectTo: z.string().trim().min(1).max(2048).optional(),
    })
    .strict()
    .refine((value) => (value.additionalAdministrator === true) === (value.reason !== undefined), {
      message: 'an additional administrator needs a reason, and a reason needs the flag',
    }),
  z
    .object({
      mode: z.literal('resend'),
      email: z.string().trim().min(3).max(320),
      redirectTo: z.string().trim().min(1).max(2048).optional(),
    })
    .strict(),
]);

export const ORGANIZATION_ADMINISTRATOR_INVITE_OPERATION = defineOperation({
  id: 'platform.organization-administrator-invite',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/administrators',
  summary: 'Establish an administrator for an existing organization, or send the link again.',
  permissions: ['platform.organization.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.tenant_administrator.invited',
  idempotent: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ORGANIZATION_ADMINISTRATOR_INVITE_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(AdministratorBody, body, 'body');
      const result = await platformModule().organizations.setUpAdministrator(db, params.tenantId, {
        email: input.email,
        resend: input.mode === 'resend',
        additionalAdministrator: input.mode === 'invite' && input.additionalAdministrator === true,
        ...(input.mode === 'invite' ? { displayName: input.displayName } : {}),
        ...(input.mode === 'invite' && input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.redirectTo === undefined ? {} : { redirectTo: input.redirectTo }),
      });
      return { status: 201, body: result };
    },
    { params: raw, body }
  );
}
