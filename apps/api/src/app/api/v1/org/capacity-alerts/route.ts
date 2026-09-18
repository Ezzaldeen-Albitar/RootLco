/**
 * GET /api/v1/org/capacity-alerts — what is about to stop working.
 *
 * `GET /org/capacity` answers "what is my organisation entitled to", which is a
 * screen somebody opens deliberately. This answers "which of those ceilings is
 * about to refuse my next write", which is a thing that should find them first.
 *
 * ## The same rule the platform console applies
 *
 * A kind is reported when the organisation is over its limit, exactly on it, or
 * has reached ninety per cent of it. The classification is
 * `capacityAlertSeverity` in `@/shared`, which `platform.statistics-read` calls
 * too — so an organisation can never be left unwarned while the operator's console
 * shows it at its limit, and the two can never name the same state differently.
 * The numbers are `org.capacity_usage`, the function the refusal itself is
 * computed from.
 *
 * ## `org.tenant.read`, not a management code
 *
 * Identical to `GET /org/capacity` and for the same reason: the question is "what
 * is my organisation entitled to". Requiring `org.company.manage` would hide the
 * warning from every administrator who merely invites users — whose ceiling is the
 * one most often reached.
 *
 * `scope: 'tenant'`: the allowance is tenant-wide by definition and has no target
 * to narrow by. NEVER cached — a cached allowance is a stale allowance.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const CAPACITY_ALERT_READ_OPERATION = defineOperation({
  id: 'org.capacity-alert-read',
  module: 'iam',
  method: 'GET',
  path: '/org/capacity-alerts',
  summary: 'Read the subscription capacity kinds at, near or over their limit.',
  permissions: ['org.tenant.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(CAPACITY_ALERT_READ_OPERATION, request, async ({ db }) => ({
    body: await iamModule().organizationAdministration.readCapacityAlerts(db),
  }));
}
