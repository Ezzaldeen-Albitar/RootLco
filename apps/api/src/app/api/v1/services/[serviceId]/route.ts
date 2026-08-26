/**
 * PATCH /api/v1/services/{serviceId} — edit a service (Phase 1-20, P1-20-BE-001).
 *
 * A partial edit of the descriptive fields plus the one lifecycle transition the
 * schema allows. An absent field is left untouched; a `null` description clears it.
 *
 * ## `serviceCode` is not here, and that is the point
 *
 * `tg_services_immutable` freezes `service_code` on `svc.services`, so the code
 * chosen at creation identifies the service for the rest of its life — every
 * `svc.price_rules`, `quo.quotation_items` and `wo.work_order_service_lines` row
 * that ever referenced it keeps meaning the same thing.
 *
 * The body schema is `.strict()`, so naming `serviceCode` is a 422 that says the
 * field is not accepted. A permissive schema would be worse than the trigger: the
 * request would succeed, the caller would believe the code changed, and the only
 * signal otherwise would be a later read. `.strict()` is the reason immutability is
 * something a caller is TOLD about rather than something they discover.
 *
 * ## Archiving is a one-way door, and reactivation is unexpressible
 *
 * `lifecycleStatus` accepts both states the CHECK constraint allows, deliberately —
 * so that `'active'` on an archived service reaches the application and is refused
 * there with `ERR-TRN-001` naming the terminal state, rather than being rejected by
 * the schema with a message about an enum. `svc.guard_service_lifecycle` is the
 * database's backstop; the service refuses every write to an archived row, which is
 * strictly stronger, because the trigger would happily accept a rename.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  SERVICE_LIFECYCLE_STATES,
  serviceCatalogModule,
} from '@/modules/service-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ serviceId: schemas.uuid });

export const Body = z
  .object({
    serviceCategoryId: schemas.uuid.optional(),
    name: z.string().min(1).max(MAX_NAME).optional(),
    // `nullable().optional()` is three states, not two: absent leaves the column,
    // `null` clears it, a string sets it. `ck_services_desc_not_blank` refuses `''`,
    // so "empty string means clear" would be a CHECK violation rather than a clear.
    description: z.string().min(1).max(MAX_DESCRIPTION).nullable().optional(),
    lifecycleStatus: z.enum(SERVICE_LIFECYCLE_STATES).optional(),
  })
  .strict();

export const SERVICE_UPDATE_OPERATION = defineOperation({
  id: 'svc.service-update',
  module: 'service-catalog',
  method: 'PATCH',
  path: '/services/{serviceId}',
  summary: 'Edit a service’s descriptive fields, or archive it.',
  permissions: ['svc.service.manage'],
  // `tenant`: `svc.services` carries no company_id and no branch_id, so there is no
  // scope target and the authority required is tenant-wide — enforced in the handler,
  // because a declaration alone degrades to a scope-blind check (P1-18-A-01).
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'svc.service.updated',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ serviceId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    SERVICE_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      if (Object.keys(parsed).length === 0) {
        // An empty patch is not a no-op worth an audit record and a version bump: it
        // is a caller that sent the wrong body, and `.strict()` has already discarded
        // any field name it might have meant.
        throw new AppFailure('ERR-VAL-001', {
          message: 'Name at least one field to change',
          safeDetails: { violations: [{ path: 'body', rule: 'empty_patch' }] },
        });
      }
      // Editing tenant-wide catalog reference data needs tenant-wide authority, for
      // the same reason creating it does. See the create route.
      if (!(await callerHoldsPermissionTenantWide(db, 'svc.service.manage'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A service is tenant-wide catalog reference data, so editing one requires ' +
            'svc.service.manage granted tenant-wide.',
        });
      }
      const updated = await serviceCatalogModule().catalogWrites.update(db, params.serviceId, {
        serviceCategoryId: parsed.serviceCategoryId,
        name: parsed.name,
        description: parsed.description,
        lifecycleStatus: parsed.lifecycleStatus,
        expectedVersion,
      });
      return { status: 200, body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
