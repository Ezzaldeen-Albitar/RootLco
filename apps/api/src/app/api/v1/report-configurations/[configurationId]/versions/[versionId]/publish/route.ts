/**
 * POST /api/v1/report-configurations/{configurationId}/versions/{versionId}/publish
 * (Phase 1-31, prerequisite **P-11**).
 *
 * Fixes one draft version as the definition in force. It is the act
 * `rpt.report-catalogue` reads: the catalogue's lateral picks the newest version
 * whose own `status` is `published`, so until this route existed a configuration
 * could carry no definition at all.
 *
 * ## `If-Match` is the VERSION's counter, not the configuration's
 *
 * The version is the row this command changes, and it is the row a concurrent
 * editor would move. The detail read publishes each version's `recordVersion` in
 * the body and the create response returns it as the ETag, so the number is
 * reachable. This is the opposite choice from `svc.service-version-publish`, whose
 * `If-Match` is the SERVICE's version because the protected function it calls
 * locks the service first — there is no protected function here, and the row this
 * statement predicates on is the version itself.
 *
 * ## Publication is effectively irreversible, and the database is what says so
 *
 * `rpt.guard_report_version_freeze` refuses any update of a published version that
 * moves `parameter_schema`, `version_number`, `status` or `published_at`, so there
 * is no unpublish and no edit — not because this surface withholds one, but
 * because the frozen schema does not permit one to exist. Two refusals therefore
 * come from the database rather than from a rule written in application code, and
 * both are mapped:
 *
 *  - a SECOND version published while one is live violates
 *    `uq_report_configuration_versions_published` — `23505`, reported as
 *    `version_already_published`;
 *  - REPUBLISHING the same version is an update of a published row, which the
 *    freeze guard raises as a `check_violation` — reported as `version_immutable`.
 *    The repository writes `published_at = now()` explicitly for exactly this
 *    reason: letting the trigger stamp the column would make a repeat publication
 *    a silent no-op that advanced `record_version` and told the caller nothing.
 *
 * ## What publishing does NOT do
 *
 * It does not publish the CONFIGURATION. A configuration whose status is `draft`
 * or `archived` stays invisible to `rpt.report-catalogue` however many published
 * versions it holds, because the catalogue filters on both. The two decisions are
 * separate because they are separate acts: fixing a definition, and putting it in
 * front of the tenant.
 *
 * It also does not make the report RUNNABLE. `ReportDefinitionView.executable` is
 * the literal `false` and this slice does not move it: the frozen schema binds no
 * data source to a report code, so what a report SELECTs is an Owner decision
 * (**D-4**) and not something a publication can supply.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { reportingModule } from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ configurationId: schemas.uuid, versionId: schemas.uuid }).strict();

export const REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION = defineOperation({
  id: 'rpt.report-configuration-version-publish',
  module: 'reporting',
  method: 'POST',
  path: '/report-configurations/{configurationId}/versions/{versionId}/publish',
  summary: 'Publish one draft version of a report configuration.',
  permissions: ['rpt.report.configure'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rpt.report_configuration.version_published',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ configurationId: string; versionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      /**
       * Tenant-wide. Publication fixes the definition every `rpt.report.read` holder
       * in the tenant will read, the version table has no company and no branch, and
       * the act cannot be undone — the freeze guard permits no update of a published
       * version. The authority to commit it must not be narrower than its effect,
       * and a declared scope with no target is inert (P1-18-A-01).
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'rpt.report.configure'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'Publishing a report version fixes the definition for the whole tenant and ' +
            'cannot be undone, so it requires rpt.report.configure granted tenant-wide.',
        });
      }
      const published = await reportingModule().configurations.publishVersion(
        db,
        params.configurationId,
        params.versionId,
        expectedVersion
      );
      return { body: published, recordVersion: published.recordVersion };
    },
    { params: raw }
  );
}
