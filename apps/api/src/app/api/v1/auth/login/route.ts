/**
 * POST /api/v1/auth/login (P1-14).
 *
 * Public by necessity — there is no session yet — and therefore the most
 * carefully bounded endpoint in the phase. `publicReason` is mandatory at
 * registration and is reported by the coverage check, so this cannot be a quiet
 * default.
 *
 * Rate limiting runs **before** anything else in the pipeline, keyed by
 * operation and client IP under the `auth-adjacent` policy, so a credential-
 * stuffing loop is throttled without first doing session work. The client IP is
 * resolved under the trusted-proxy policy, so a forged `X-Forwarded-For` cannot
 * buy a fresh bucket.
 *
 * The response is deliberately thin: tokens, an expiry, and the caller's own
 * identity. No permissions, no scope, no tenant metadata — a client that wants
 * those calls `GET /api/v1/auth/session` with the token it just received, which
 * runs the full authorization pipeline.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, schemas } from '@/server/http/validation';
import { resolveClientAddress } from '@/server/http/trusted-proxy';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const LoginBody = z.object({
  /**
   * Optional. A lookup key, never a grant.
   *
   * Clients sign in with an address and a password; the tenant is resolved
   * server-side from the identity the provider verifies. A caller that still
   * sends one is asserting which tenant it expects — the value is cross-checked
   * against the binding the provider reports, and a disagreement is denied with
   * the same generic failure as a wrong password. Kept optional rather than
   * removed so existing callers keep working while they migrate.
   */
  tenantId: schemas.uuid.optional(),
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(200),
});

export const LOGIN_OPERATION = defineOperation({
  id: 'iam.auth-login',
  module: 'iam',
  method: 'POST',
  path: '/auth/login',
  summary: 'Verify credentials and open a session.',
  public: true,
  publicReason:
    'Login is the operation that establishes a session; requiring one would be circular. ' +
    'Bounded by the auth-adjacent rate-limit policy and answered with a uniform failure.',
  auditClass: 'none',
  rateLimitPolicy: 'auth-adjacent',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  return handleOperation(LOGIN_OPERATION, request, async ({ request: raw, correlationId }) => {
    const body = await parseJsonBody(raw, LoginBody);
    const client = resolveClientAddress({ headers: raw.headers });

    const result = await iamModule().authentication.login(body, {
      correlationId,
      clientIp: client.ip,
      userAgent: raw.headers.get('user-agent'),
    });
    return { body: result };
  });
}
