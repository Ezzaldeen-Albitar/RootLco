/**
 * GET /api/v1/meta/ping — the reference endpoint (P1-13-BE-021).
 *
 * The copyable exemplar. It proves, end to end and in CI, that:
 * correlation ID → rate limiting → authentication → server-side context
 * resolution → scoped database session → authorization → transaction →
 * application service → problem-document error model → OpenAPI registration
 * all work together.
 *
 * It carries **no business data**: it reports the caller's own resolved scope
 * and nothing else. P1-13 delivers no business endpoint, and an exemplar that
 * quietly read a domain table would be one.
 *
 * Note how little is here. Everything cross-cutting lives in `handleOperation`,
 * which is exactly the property the module-boundary rule protects — a handler
 * with business logic in it would stand out immediately.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { metaModule } from '@/modules/meta';

// The pipeline uses `pg` and `node:crypto`; the Edge runtime has neither.
export const runtime = 'nodejs';
// A ping that reports live context must never be statically rendered or cached.
export const dynamic = 'force-dynamic';

export const PING_OPERATION = defineOperation({
  id: 'meta.ping',
  module: 'meta',
  method: 'GET',
  path: '/meta/ping',
  summary: 'Authenticated foundation health probe reporting the caller resolved scope.',
  permissions: ['platform.meta.ping'],
  scope: 'tenant',
  // A read of one's own scope changes nothing and is not privileged, approval-
  // bearing, financial, export, or security-relevant. Declaring `none` is a
  // decision the registry records, not an omission it allows.
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PING_OPERATION, request, async ({ db }) => ({
    body: await metaModule().ping.ping(db),
  }));
}
