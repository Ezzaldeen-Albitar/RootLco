/**
 * POST /api/v1/services/{serviceId}/versions — create a draft service version
 * (Phase 1-30 A1, seam S-03).
 *
 * ## Why this exists
 *
 * `svc.service-version-publish` needs a draft, and nothing in the shipped product
 * could create one — every `INSERT INTO svc.service_versions` in the tree is a
 * test fixture writing through an RLS-bypassing admin pool. A service created
 * through the API could therefore never acquire a published version, `isSellableAt`
 * answered false for all of them, and every quotation line was refused. This is
 * the second link of the commercial chain the A0 preflight measured as broken.
 *
 * ## Why this is NOT version-guarded
 *
 * Creating a draft does not mutate the service, and there is no prior version of
 * the thing being created to guard — an `If-Match` here would be a token about a
 * row the request does not change. Two of the three live "create the next draft
 * version of a parent" operations agree: `dia.template-version-create` (the
 * structural twin, from the immediately preceding programme) and
 * `shared.template-version-create`. Concurrency protection stays where it earns
 * its keep — on `svc.service-version-publish`, which decides the succession
 * boundary and is `versionGuarded: true`.
 *
 * The write still takes `FOR UPDATE` on the service: `version_no` is unique per
 * `(tenant, service)` and concurrent creates must not compute the same next
 * number. That is a lock for correctness of the insert, not an optimistic guard
 * against a lost update.
 *
 * ## Why a draft may overlap anything
 *
 * `ex_service_versions_no_published_overlap` is `WHERE (status = 'published' AND
 * deleted_at IS NULL)`. Drafts overlap each other and the live version freely,
 * which is the point of a draft: the effective-date boundary is decided at
 * publication by `svc.publish_service_version`, not here.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { MAX_NOTES, serviceCatalogModule } from '@/modules/service-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ serviceId: schemas.uuid });

/** A plain ISO date: the columns are `date` and the gist EXCLUDE ranges over `daterange`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const Body = z
  .object({
    effectiveFrom: z.string().regex(ISO_DATE, 'must be an ISO date (YYYY-MM-DD)'),
    effectiveTo: z.string().regex(ISO_DATE, 'must be an ISO date (YYYY-MM-DD)').optional(),
    notes: z.string().min(1).max(MAX_NOTES).optional(),
  })
  .strict()
  // `ck_service_versions_range` is the backstop, but a check constraint can only
  // answer `check_violation` from four layers down. Refusing here names the field
  // and says why, and the range is half-open — `effective_to` is exclusive, so an
  // equal pair would be an empty interval rather than a one-day one.
  .refine((v) => v.effectiveTo === undefined || v.effectiveTo > v.effectiveFrom, {
    message: 'effectiveTo must be strictly after effectiveFrom; the range is half-open',
    path: ['effectiveTo'],
  });

export const SERVICE_VERSION_CREATE_OPERATION = defineOperation({
  id: 'svc.service-version-create',
  successStatus: 201,
  module: 'service-catalog',
  method: 'POST',
  path: '/services/{serviceId}/versions',
  summary: 'Create a draft version for a service.',
  permissions: ['svc.service.manage'],
  // `tenant`: `svc.service_versions` carries no company and no branch, so a
  // version is the tenant's definition of that service everywhere. Authority is
  // re-checked tenant-wide in the handler, because an operation with no scope
  // target degrades to the scope-blind `iam.has_permission` whatever it declares
  // (P1-18-A-01).
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'svc.service_version.drafted',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ serviceId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    SERVICE_VERSION_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      /**
       * Drafting a version is a TENANT-WIDE act, so it needs tenant-wide authority —
       * the same control `svc.service-create` and `svc.service-version-publish` apply.
       * A version has no company and no branch, so there is no scope target and the
       * pre-handler check would otherwise let a branch-scoped holder of
       * `svc.service.manage` stage a definition for the entire tenant.
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'svc.service.manage'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A service version is tenant-wide catalog reference data, so drafting one ' +
            'requires svc.service.manage granted tenant-wide.',
        });
      }
      const created = await serviceCatalogModule().catalogWrites.createVersion(
        db,
        params.serviceId,
        {
          effectiveFrom: parsed.effectiveFrom,
          effectiveTo: parsed.effectiveTo,
          notes: parsed.notes,
        }
      );
      return { status: 201, body: created };
    },
    { params: raw, body }
  );
}
