/**
 * GET / PATCH /api/v1/report-configurations/{configurationId} (Phase 1-31, P-11).
 *
 * `GET` returns one definition WITH its whole version history. `PATCH` edits the
 * name and the scope level under `If-Match`.
 *
 * ## The versions are not paged, and their order is published
 *
 * `dia.template-version-item-list` states the rule this follows: the set is
 * bounded by AUTHORING rather than by growth — a version exists because a person
 * wrote one — and the history of a definition is read as one thing. The order is
 * `version_number` ascending, and `uq_report_configuration_versions_number` makes
 * that a total order on its own, so no tie-break is needed or offered. It is
 * ascending because a history is read forwards; the catalogue's own lateral
 * orders descending because it is picking one row rather than presenting a
 * sequence.
 *
 * ## Absent and invisible answer the same thing
 *
 * `findConfiguration` returns null for both and the service turns both into one
 * `ERR-RES-001`, decided before any authorization decision, so a 403 never
 * confirms that an id names a real row in another tenant. The catalogue read
 * makes the same promise about report CODES.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { MAX_REPORT_NAME, REPORT_SCOPE_LEVELS, reportingModule } from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ configurationId: schemas.uuid }).strict();

export const REPORT_CONFIGURATION_READ_OPERATION = defineOperation({
  id: 'rpt.report-configuration-read',
  module: 'reporting',
  method: 'GET',
  path: '/report-configurations/{configurationId}',
  summary: 'Read one report configuration with its version history.',
  // `rpt.report.configure`, like every other operation of this seam: the response
  // carries drafts, archived definitions and unpublished versions, none of which a
  // `rpt.report.read` holder may see. That holder reads published definitions
  // through `rpt.report-read`, which is what the code was minted for.
  permissions: ['rpt.report.configure'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ configurationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REPORT_CONFIGURATION_READ_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      // Tenant-wide, for the reason the collection read states: the row has no
      // company and no branch, so a declared scope has nothing to narrow against
      // and the pre-handler check is scope-blind without this (P1-18-A-01).
      if (!(await callerHoldsPermissionTenantWide(db, 'rpt.report.configure'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A report configuration belongs to the whole tenant, so reading one with ' +
            'its drafts requires rpt.report.configure granted tenant-wide.',
        });
      }
      const detail = await reportingModule().configurations.readConfiguration(
        db,
        params.configurationId
      );
      // Published as the ETag as well as in the body: the edit and the status
      // command are version-guarded and `parseIfMatch` accepts only an exact
      // positive integer, so a caller needs a current version to act at all. It is
      // the CONFIGURATION's version; every version row carries its own in the body,
      // and the publish command wants that one instead.
      return { body: detail, recordVersion: detail.configuration.recordVersion };
    },
    { params: raw }
  );
}

/**
 * Edit body — the name and the scope level, and nothing else.
 *
 * `reportCode` is absent because `tg_report_configurations_immutable` freezes it:
 * this is the database's rule, not a preference of this surface.
 * `exportPermissionCode` is absent for a sharper reason — it decides who may
 * EXPORT the report's contents, so re-pointing it is a privilege change wearing
 * the clothes of an edit, and it needs its own decision and its own operation.
 * `status` is absent because publishing or withdrawing a definition is its own
 * command: the authority to fix a typo is not the authority to put a report in
 * front of the tenant.
 *
 * Both fields are optional and at least one is required. A body that changed
 * nothing would still consume a `record_version` and write an audit record
 * claiming an edit that did not happen.
 *
 * NARROWING `scopeLevel` does not re-validate existing saved filters, and that is
 * a property of the frozen schema rather than of this route.
 * `rpt.guard_saved_filter_scope` is a trigger on `rpt.saved_filters` and fires on
 * ITS inserts and updates only, so a filter authored at `tenant` scope survives
 * the report being narrowed to `branch`. Enforcing BR-RPT-001 in the other
 * direction would mean either refusing the narrowing or rewriting rows that belong
 * to other users — both decisions this prerequisite does not sanction, and neither
 * is expressible without a migration. It is recorded rather than papered over, and
 * nothing in the product writes `rpt.saved_filters` today.
 */
export const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(MAX_REPORT_NAME).optional(),
    scopeLevel: z.enum(REPORT_SCOPE_LEVELS).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.scopeLevel !== undefined, {
    message: 'Supply at least one of name or scopeLevel',
    path: ['name'],
  });

export const REPORT_CONFIGURATION_UPDATE_OPERATION = defineOperation({
  id: 'rpt.report-configuration-update',
  module: 'reporting',
  method: 'PATCH',
  path: '/report-configurations/{configurationId}',
  summary: 'Edit the name or the scope level of one report configuration.',
  permissions: ['rpt.report.configure'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rpt.report_configuration.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ configurationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REPORT_CONFIGURATION_UPDATE_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, UpdateBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      if (!(await callerHoldsPermissionTenantWide(db, 'rpt.report.configure'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A report configuration belongs to the whole tenant, so editing one ' +
            'requires rpt.report.configure granted tenant-wide.',
        });
      }
      // The version is the CONFIGURATION's own, which this route's GET and the
      // create response publish as their ETag. A VERSION row carries a separate
      // counter and is guarded on its own path.
      const updated = await reportingModule().configurations.updateConfiguration(
        db,
        params.configurationId,
        expectedVersion,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.scopeLevel === undefined ? {} : { scopeLevel: input.scopeLevel }),
        }
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
