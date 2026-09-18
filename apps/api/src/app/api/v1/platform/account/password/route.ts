/**
 * POST /api/v1/platform/account/password (P1-32-PRE-OD-CONSOLE).
 *
 * The Platform Owner Console's change-password operation, and the only one a
 * PLATFORM-ONLY identity can reach.
 *
 * ## Why the tenant surface cannot serve this caller
 *
 * A platform operator holds `iam.platform_grants` and no tenant role at all —
 * `scripts/platform/genesis-platform-operator.mjs` writes an account and its
 * grants and deliberately writes no `iam.role_grants` row. Every tenant
 * operation resolves its permission through `iam.has_permission`, which returns
 * false without an active role in the current tenant, so the profile and
 * settings surfaces answer 403 to exactly the principal this console exists
 * for. Measured for `GET /auth/session` and recorded on `platform.session-read`.
 *
 * ## The permission, and why it is the smallest one that works
 *
 * `platform.organization.read` is the console's BASE entitlement: every grant
 * set that `iam.platform_grants` can receive contains it, because both writers
 * of that table refuse a set without it (`platformGrantSetRefusal`). So every
 * operator who can open the console already holds it, and declaring it admits
 * no operator that any narrower code would have admitted and no operator that a
 * wider one would have excluded. A NEW code would have been strictly worse: no
 * existing grant carries it, so every operator already provisioned would be
 * locked out of their own password until an out-of-band re-grant, which is the
 * failure mode a security operation must not have.
 *
 * The prefix is what routes the request — `platform.` selects the platform pool
 * and `iam.has_platform_authority` — so a TENANT user reaching this path is
 * refused with `ERR-IAM-001`: they hold no row in `iam.platform_grants`, and
 * application filtering plays no part in it. A tenant user who ALSO holds a
 * platform grant is admitted and changes THEIR OWN password, because the
 * identity acted on is read from the caller's own bearer token and never from
 * the request document.
 *
 * ## Not idempotent, deliberately
 *
 * `ERR-INT-003` refuses an idempotency fingerprint over a body carrying secret
 * material, and this body carries two passwords. The fingerprint is a persisted
 * unkeyed SHA-256, which is an offline guessing target (CWE-916). Declaring
 * `idempotent` here would make every request to this route fail.
 *
 * Nothing this route touches is logged or echoed: neither password appears in
 * the response, in a validation error, in the audit record, or in a URL.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Both fields are bounded and neither is scored.
 *
 * The lower bound is 1, not 8: strength belongs to the identity provider
 * (ADR-019), and a minimum declared here would be a second policy that could
 * disagree with the one actually in force. The upper bound is the denial-of
 * -service bound on the provider's hashing routine, and it is re-applied in the
 * service so a direct caller of the service meets it too.
 */
export const ChangePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(1).max(200),
  })
  .strict();

export const ACCOUNT_PASSWORD_CHANGE_OPERATION = defineOperation({
  id: 'iam.account-password-change',
  module: 'iam',
  method: 'POST',
  path: '/platform/account/password',
  summary: "Change the signed-in platform operator's own password.",
  permissions: ['platform.organization.read'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'iam.password.changed',
  rateLimitPolicy: 'auth-adjacent',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  return handleOperation(
    ACCOUNT_PASSWORD_CHANGE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const body = await parseJsonBody(raw, ChangePasswordBody);
      // The token is read from the header the pipeline already authenticated
      // with, so the identity acted on is the caller's and cannot be steered.
      const accessToken = (raw.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      return {
        body: await iamModule().authentication.changeOwnPassword(db, {
          accessToken,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        }),
      };
    }
  );
}
