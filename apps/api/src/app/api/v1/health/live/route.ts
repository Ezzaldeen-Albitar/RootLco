/**
 * GET /api/v1/health/live (P1-15).
 *
 * Liveness. Answers "is this process running?" and touches nothing else: no
 * database, no provider, no configuration read, no write. A liveness probe that
 * queries the database restarts a healthy process every time the database
 * hiccups, converting a brief dependency blip into a rolling outage.
 *
 * Public by declaration, with a reason the coverage report prints. The body is
 * two fields — a constant status and a process uptime — and carries no version,
 * no commit, no environment, no hostname, and no dependency detail.
 *
 * **`/api/health` is untouched.** It is asserted to return exactly seven keys and
 * is the Docker healthcheck; this is a new versioned contract beside it.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const HEALTH_LIVE_OPERATION = defineOperation({
  id: 'shared.health-live',
  module: 'shared-services',
  method: 'GET',
  path: '/health/live',
  summary: 'Liveness probe. Reports that the process is running; touches nothing.',
  public: true,
  publicReason:
    'A liveness probe is called by the orchestrator before any credential exists, and must ' +
    'answer without a session. It performs no I/O and discloses no state beyond process uptime.',
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(HEALTH_LIVE_OPERATION, request, async () => ({
    body: sharedServicesModule().health.liveness(),
  }));
}
