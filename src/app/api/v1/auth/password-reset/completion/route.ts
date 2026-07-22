/**
 * POST /api/v1/auth/password-reset/completion (P1-14).
 *
 * Completes a reset with the provider's own recovery token. RootLco does not
 * mint, store, or validate that token: the provider issues it, bounds its
 * lifetime, and consumes it on first use, so a replayed link finds nothing.
 * Reissuing an equivalent token here would create a second reset path with
 * weaker guarantees and no reason to exist.
 *
 * On success the adapter revokes every other session of the identity, so a
 * session stolen before the reset does not survive it. That is the "session
 * rotation on credential change" rule, enforced where the sessions live.
 *
 * The password is bounded (8–200 characters) and never scored here — strength is
 * the provider's decision (ADR-019), and a second strength policy would produce
 * two answers to the same question. It is never logged, never echoed, and never
 * placed in a validation error.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CompletionBody = z.object({
  /** The provider's recovery token, taken from the emailed link. */
  token: z.string().min(8).max(2048),
  password: z.string().min(1).max(200),
});

export const PASSWORD_RESET_COMPLETION_OPERATION = defineOperation({
  id: 'iam.auth-password-reset-completion',
  module: 'iam',
  method: 'POST',
  path: '/auth/password-reset/completion',
  summary: 'Set a new password using a provider recovery token.',
  public: true,
  publicReason:
    'The holder of a valid single-use recovery token has, by definition, no session yet. ' +
    'Bounded by the auth-adjacent rate-limit policy.',
  auditClass: 'none',
  rateLimitPolicy: 'auth-adjacent',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  return handleOperation(PASSWORD_RESET_COMPLETION_OPERATION, request, async ({ request: raw }) => {
    const body = await parseJsonBody(raw, CompletionBody);
    await iamModule().authentication.completePasswordReset(body);
    return { body: { status: 'password-updated' } };
  });
}
