/**
 * POST /api/v1/report-configurations/{configurationId}/status (Phase 1-31, P-11).
 *
 * Publishes (`published`), withdraws (`archived`) or returns to `draft` one report
 * configuration.
 *
 * ## This command is what makes a definition visible at all
 *
 * `rpt.report-catalogue` and `rpt.report-read` both filter on
 * `status = 'published'`. Until this route existed, nothing could set that value,
 * so every tenant's report catalogue was empty whatever had been configured — and
 * nothing could configure anything either.
 *
 * ## There is no delete, and there cannot be
 *
 * Neither `rpt.report_configurations` nor `rpt.report_configuration_versions`
 * carries a `DELETE` grant or a `DELETE` policy for any application role, so a
 * hard removal is refused by the database however it is asked for.
 * `fk_saved_filters_config` is `ON DELETE RESTRICT` besides. Retirement is
 * `status = 'archived'`, which is the column the table already carries for it.
 *
 * ## Why it moves in every direction the CHECK allows
 *
 * `uq_report_configurations_code` is `(tenant_id, report_code) WHERE deleted_at IS
 * NULL`. The predicate names `deleted_at` and says nothing about `status`, so an
 * archived configuration still holds its report code and re-adding that code is a
 * `23505`. An archive-only command would burn the code for the tenant
 * permanently — the `apt.catalogue-source-channel-status-set` precedent, for the
 * same reason. `draft` is reachable again for the same reason it exists: taking a
 * definition out of the catalogue to rework it is not the same act as withdrawing
 * it for good.
 *
 * ## What it does NOT do
 *
 * It does not touch the VERSIONS. The catalogue selects the version to publish on
 * the VERSION's own status and never reads the configuration's, so a cascade would
 * change what the catalogue resolves for reasons the operator did not choose, and
 * an un-archive could not tell which versions the cascade had moved from which an
 * operator had. It also does not require a published version before a
 * configuration may be `published`: nothing in the schema says so, and
 * `ReportDefinitionView` already answers `versionNumber: null` for that state.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { REPORT_CONFIGURATION_STATUSES, reportingModule } from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ configurationId: schemas.uuid }).strict();

/** The vocabulary of `ck_report_configurations_status`, and nothing beside it. */
export const StatusBody = z.object({ status: z.enum(REPORT_CONFIGURATION_STATUSES) }).strict();

export const REPORT_CONFIGURATION_STATUS_OPERATION = defineOperation({
  id: 'rpt.report-configuration-status-set',
  module: 'reporting',
  method: 'POST',
  path: '/report-configurations/{configurationId}/status',
  summary: 'Publish, withdraw or re-draft one report configuration.',
  permissions: ['rpt.report.configure'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rpt.report_configuration.status_changed',
  // Both guards, as `apt.catalogue-source-channel-status-set` declares them: the
  // version makes the transition decide against the state the caller actually
  // read, and the key makes a retried request return the first answer instead of a
  // version conflict the client cannot distinguish from a real one.
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ configurationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REPORT_CONFIGURATION_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, StatusBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      /**
       * Tenant-wide, and this is the sharpest case for it in the seam: publishing a
       * definition puts it in front of every `rpt.report.read` holder in the tenant,
       * and archiving one takes it away from all of them. The row has no company and
       * no branch, so the pre-handler check is scope-blind without this
       * (P1-18-A-01).
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'rpt.report.configure'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'Publishing or withdrawing a report configuration changes what the whole ' +
            'tenant can see, so it requires rpt.report.configure granted tenant-wide.',
        });
      }
      const changed = await reportingModule().configurations.setConfigurationStatus(
        db,
        params.configurationId,
        expectedVersion,
        input.status
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
