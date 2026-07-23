/**
 * GET /api/v1/health/ready (P1-15).
 *
 * Readiness. Answers "should a load balancer send this instance work?" by
 * probing the required dependency — the database — under a bounded timeout, and
 * returns a **verdict, never a topology**.
 *
 * `foundationReadiness()` (P1-13) computes rich internal detail including the
 * database role the connection opened as. That is right for an operator reading
 * a log and wrong for a response that is unauthenticated by necessity, so the
 * projection in `HealthService` keeps the check names and booleans and drops
 * every detail string. No role, host, bucket, database name, driver message, or
 * stack trace can reach this body, because none is copied into it.
 *
 * The status code follows the verdict so a balancer can act on it without
 * parsing: `ready`/`degraded` are 200 (degraded still serves traffic — a missing
 * write capability must not take the tier out of rotation), `unavailable` is 503.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tenant identifier used only to build the probe's request context.
 *
 * The readiness query reads `pg_roles` and `has_*_privilege`, which are not
 * tenant-scoped, so the value never selects business data — it exists because a
 * `DbHandle` cannot be constructed without a context, which is the invariant
 * that stops a real query from running without one.
 */
const PROBE_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export const HEALTH_READY_OPERATION = defineOperation({
  id: 'shared.health-ready',
  module: 'shared-services',
  method: 'GET',
  path: '/health/ready',
  summary: 'Readiness probe. Reports a bounded dependency verdict with no internal detail.',
  public: true,
  publicReason:
    'A readiness probe is called by the load balancer and the orchestrator, neither of which ' +
    'holds a session. The response carries check names and booleans only — no role, host, ' +
    'bucket, database name, or driver message.',
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(HEALTH_READY_OPERATION, request, async () => {
    const report = await sharedServicesModule().health.readiness(PROBE_TENANT_ID);
    return { status: report.status === 'unavailable' ? 503 : 200, body: report };
  });
}
