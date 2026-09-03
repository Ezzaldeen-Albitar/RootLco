/**
 * POST /api/v1/auth/password-reset (P1-14).
 *
 * Requests a reset mail. **Always answers 202 with the same body**, whether the
 * address is known, unknown, invited, locked, or archived — and whether or not
 * the provider actually sent anything. Any other behaviour turns the endpoint
 * into an address-enumeration oracle, which is the classic defect here.
 *
 * The redirect destination is resolved against `AUTH_REDIRECT_ALLOWLIST` by
 * exact match, and an empty allow-list permits nothing. That matters more than
 * usual because the link being redirected carries a single-use credential: an
 * open redirect on this endpoint hands the token to whoever chose the URL.
 *
 * Nothing is written to the database. There is no authenticated principal, so
 * there is no row `ins_login_audit_self` would accept — and inventing an
 * anonymous one would mean a table an unauthenticated caller can grow.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const ResetBody = z.object({
  email: z.string().min(3).max(320),
  /** Must be an allow-listed absolute destination. Omit to use the default. */
  redirectTo: z.string().url().max(2048).optional(),
});

export const PASSWORD_RESET_OPERATION = defineOperation({
  id: 'iam.auth-password-reset',
  successStatus: 202,
  module: 'iam',
  method: 'POST',
  path: '/auth/password-reset',
  summary: 'Request a password-reset mail. Always answers identically.',
  public: true,
  publicReason:
    'A user who cannot sign in cannot authenticate to ask for a reset. Bounded by the ' +
    'auth-adjacent rate-limit policy and answered identically for every address.',
  auditClass: 'none',
  rateLimitPolicy: 'auth-adjacent',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  return handleOperation(
    PASSWORD_RESET_OPERATION,
    request,
    async ({ request: raw, correlationId }) => {
      const body = await parseJsonBody(raw, ResetBody);
      await iamModule().authentication.requestPasswordReset(body, {
        correlationId,
        clientIp: null,
        userAgent: null,
      });
      // 202, and the same body every time: the caller learns that the request was
      // accepted, never whether anything was sent.
      return {
        status: 202,
        body: { status: 'accepted' },
      };
    }
  );
}
