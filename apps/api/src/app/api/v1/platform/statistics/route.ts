/**
 * GET /api/v1/platform/statistics (P1-32-PRE-025).
 *
 * Platform-wide figures for the Platform Owner Console: organisations by state,
 * how much of the platform exists, subscription expiry horizons, organisations
 * at or near a plan capacity limit, platform revenue per currency, and
 * operational health from the platform's own readiness and outbox probes.
 *
 * Every figure is one SQL aggregate read inside this request's transaction —
 * nothing cached, nothing estimated. Every amount is a decimal string, and
 * `projectedRenewalValue` is labelled as what it is: the list price of
 * subscriptions whose term ends in the next twelve months, which nobody has yet
 * agreed to renew and nobody owes. It is not a receivable.
 *
 * Counts only for accounts: the census reads `iam.user_accounts` through a
 * column-scoped grant that cannot reach an identity.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PLATFORM_STATISTICS_READ_OPERATION = defineOperation({
  id: 'platform.statistics-read',
  module: 'platform',
  method: 'GET',
  path: '/platform/statistics',
  summary:
    'Read platform-wide organization, subscription, capacity, revenue and operational-health figures.',
  permissions: ['platform.statistics.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PLATFORM_STATISTICS_READ_OPERATION, request, async ({ db }) => ({
    body: await platformModule().insight.statistics(db),
  }));
}
