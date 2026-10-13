/**
 * GET /api/v1/platform/session (P1-32-PRE-021).
 *
 * The platform operator's own session. `GET /auth/session` cannot serve this
 * principal: it declares the TENANT permission `iam.user.read`, and the genesis
 * operator holds no tenant role by construction, so the canonical session read
 * answers 403 to the one caller the Platform Owner Console exists for.
 *
 * Declaring `platform.organization.read` routes authorization to
 * `iam.has_platform_authority` and the transaction to the platform pool — both
 * derived from the permission prefix, never from a flag this file could forget.
 *
 * ## `platform.organization.read` is the console's BASE entitlement
 *
 * This read is the first request every console page makes, and it declares ONE
 * code. So an operator granted only `platform.audit.read` or
 * `platform.subscription.manage` is refused here and bounced out of the console
 * before any page gate could admit them — real grants, completely unusable.
 *
 * The repair is NOT to widen the set declared below. A session read that
 * accepted any one of eight codes would tell a caller nothing about which
 * console it may open, and every screen would still decide for itself. The rule
 * is enforced where platform grants are MADE instead: EVERY platform grant set
 * contains `platform.organization.read`, plus whatever else the operator needs.
 * Both code paths that write `iam.platform_grants` —
 * `scripts/platform/genesis-platform-operator.mjs` and
 * `scripts/platform/grant-platform-authority.mjs`, which are the whole grant
 * surface, since no operation and no policy admits an application role to that
 * table — refuse a set without it through `platformGrantSetRefusal`.
 *
 * The response carries the caller's identifier, home tenant and its OWN
 * unrevoked platform authority codes, and deliberately no email or display
 * name: see `PlatformSessionService` for why those two columns stay out of
 * `app_platform`'s grant.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PLATFORM_SESSION_READ_OPERATION = defineOperation({
  id: 'platform.session-read',
  module: 'platform',
  method: 'GET',
  path: '/platform/session',
  summary: "Describe the platform operator's own session and platform authority.",
  permissions: ['platform.organization.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PLATFORM_SESSION_READ_OPERATION, request, async ({ db }) => ({
    body: await platformModule().session.describe(db),
  }));
}
