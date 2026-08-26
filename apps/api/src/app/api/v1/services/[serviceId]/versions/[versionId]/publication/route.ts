/**
 * POST /api/v1/services/{serviceId}/versions/{versionId}/publication
 * (Phase 1-20, P1-20-BE-001).
 *
 * Publishes a draft service version, making its definition the effective one from a
 * date. A published version is what `GET /api/v1/services?effectiveOn=…` selects on
 * and what `isSellableAt` requires, so this is the act that makes a service
 * sellable at all.
 *
 * ## What the database decides, and this route does not restate
 *
 * `svc.publish_service_version(service, version, effective_from)` locks the service,
 * refuses a version that is not that service's, refuses a non-draft version, refuses
 * an `effective_from` at or before the currently open published version's own start,
 * closes that version's `effective_to` at the new date, and publishes. Forward-only
 * succession and the `ex_service_versions_no_published_overlap` gist backstop are
 * therefore the database's. Reimplementing succession here would create a second
 * definition that can disagree with the one that actually runs, and a disagreement
 * about effective dates surfaces as a service quietly live on the wrong day rather
 * than as an error.
 *
 * ## Why `effectiveFrom` is required rather than defaulted to today
 *
 * The succession boundary decides which definition of a service a quotation is
 * priced against on a given day. Defaulting it would make that boundary depend on
 * when the request happened to arrive. The caller states it; the function validates
 * it is after the current published version's start.
 *
 * `/publication` is a sub-resource noun, not `:publish`: the operation registry's
 * `PATH_PATTERN` accepts only lower-case literal or `{camelCase}` segments, so a
 * colon-action path cannot be registered at all.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { serviceCatalogModule } from '@/modules/service-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ serviceId: schemas.uuid, versionId: schemas.uuid });

export const Body = z
  .object({
    // A plain date, because `svc.service_versions.effective_from` is a `date` and the
    // gist EXCLUDE ranges over `daterange`. Accepting a timestamp would imply a
    // precision the column does not have.
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
  })
  .strict();

export const SERVICE_VERSION_PUBLISH_OPERATION = defineOperation({
  id: 'svc.service-version-publish',
  module: 'service-catalog',
  method: 'POST',
  path: '/services/{serviceId}/versions/{versionId}/publication',
  summary: 'Publish a draft service version, fixing that service’s definition from a date.',
  permissions: ['svc.service.manage'],
  // `tenant`: neither `svc.services` nor `svc.service_versions` carries a company or
  // a branch, so a published version is the tenant's definition of that service
  // everywhere. The authority is checked tenant-wide in the handler.
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'svc.service_version.published',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ serviceId: string; versionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    SERVICE_VERSION_PUBLISH_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      /**
       * Publication is a TENANT-WIDE act, so it needs tenant-wide authority.
       *
       * A service version has no company and no branch, and publishing one changes
       * what every branch in the tenant may sell from that date. There is no scope
       * target to authorize, so `scope: 'tenant'` alone degrades to the scope-blind
       * `iam.has_permission` and a branch-scoped holder of `svc.service.manage` could
       * change the tenant's catalog. Publication is also effectively irreversible —
       * `svc.guard_service_version_freeze` permits only `published → archived` — so
       * the authority to commit it must not be narrower than its effect.
       *
       * `If-Match` carries the SERVICE's `record_version`, not the version's: the
       * service is the row a concurrent editor moves, and it is the row the protected
       * function locks first.
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'svc.service.manage'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'Publishing a service version sets what the whole tenant may sell, so it ' +
            'requires svc.service.manage granted tenant-wide.',
        });
      }
      const published = await serviceCatalogModule().catalogWrites.publishVersion(
        db,
        params.serviceId,
        params.versionId,
        { effectiveFrom: parsed.effectiveFrom, expectedVersion }
      );
      return { status: 200, body: published, recordVersion: published.recordVersion };
    },
    { params: raw, body }
  );
}
