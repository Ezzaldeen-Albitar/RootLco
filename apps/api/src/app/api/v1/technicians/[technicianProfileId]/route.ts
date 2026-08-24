/**
 * GET / PATCH /api/v1/technicians/{technicianProfileId} (PRE-P1-29-BR-03).
 *
 * The read closes `INS-24` — _"a technician has no name"_ — which is a BLOCKER
 * against Owner requirement 5: an assignment names a `technicianProfileId` and,
 * until now, nothing resolved it, so a supervisor's screen could only render a
 * UUID.
 *
 * ## What the read deliberately does NOT contain
 *
 * A human name. `tech.technician_profiles` holds none by design — its own
 * comment forbids duplicating salary, government-id, contact, medical or payroll
 * data, and `employment_ref` is an opaque non-PII link. So this returns the
 * operational profile and `userId`. Resolving that id to a person has no
 * contract in this platform (`admin.contractGap.noDirectory`), and inventing one
 * here would stand up a second identity model beside `iam.user_accounts`.
 *
 * The certificate NUMBER is also absent. It lives in
 * `tech.technician_certification_details`, whose every policy independently
 * requires `iam.sensitive.view`; folding it into an aggregate read reachable
 * with `tech.technician.read` alone would publish restricted data (`T-04`).
 *
 * ## `branchId` and `userId` are not in the PATCH body, and sending one is a 422
 *
 * Both are named by `tg_technician_profiles_immutable`. A request that names
 * them is asking for something the platform will not do, and `.strict()` says so
 * rather than dropping the field — silently ignoring it is the worse failure,
 * because the caller would believe the transfer happened. A branch transfer is
 * `retire` here, then `POST /technicians` in the target branch, in that order:
 * `uq_technician_profiles_active_user` refuses the create while a live profile
 * still exists.
 *
 * ## The scope check is deferred, on the `wo.job-update` precedent
 *
 * There is no branch in the path, so a pre-handler check would have nothing to
 * narrow by and `scope: 'branch'` would be inert. The service re-decides against
 * the profile's OWN company and branch after resolving it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_EMPLOYMENT_REF, MAX_TRADE, technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Params = z.object({ technicianProfileId: schemas.uuid });

/**
 * `retire` is a discriminator, not a field: it soft-deletes the row and frees
 * the one-live-profile-per-user slot, so combining it with a field edit would be
 * two intents in one request with no defined order. Refused explicitly below.
 */
export const Body = z
  .object({
    trade: z.string().trim().min(1).max(MAX_TRADE).nullable().optional(),
    employmentRef: z.string().trim().min(1).max(MAX_EMPLOYMENT_REF).nullable().optional(),
    isActive: z.boolean().optional(),
    retire: z.literal(true).optional(),
  })
  .strict();

/**
 * Each declaration sits immediately before ITS OWN handler. See the note in
 * `app/api/v1/technicians/route.ts`: `scripts/p1-19-endpoint-inventory.mjs`
 * reads the text between one `defineOperation` and the next to decide whether a
 * `scope: 'branch'` claim is enforced, so stacking declarations makes the first
 * read as inert and credits the second with a handler it does not own.
 */
export const TECHNICIAN_DETAIL_OPERATION = defineOperation({
  id: 'tech.technician-detail',
  module: 'technician',
  method: 'GET',
  path: '/technicians/{technicianProfileId}',
  summary: 'Read one technician profile with its skills, certifications and upcoming availability.',
  permissions: ['tech.technician.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    TECHNICIAN_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await technicianModule().roster.profileDetail(
          db,
          params.technicianProfileId,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}

export const TECHNICIAN_UPDATE_OPERATION = defineOperation({
  id: 'tech.technician-update',
  module: 'technician',
  method: 'PATCH',
  path: '/technicians/{technicianProfileId}',
  summary: 'Change a technician’s trade, employment reference or active state, or retire them.',
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.profile_updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TECHNICIAN_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const fields = Object.keys(parsed);
      if (fields.length === 0) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'An update must change at least one field',
          safeDetails: { violations: [{ path: 'body', rule: 'empty-update' }] },
        });
      }
      if (parsed.retire === true && fields.length > 1) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'Retiring a technician cannot be combined with a field change',
          safeDetails: { violations: [{ path: 'body.retire', rule: 'exclusive' }] },
        });
      }
      const updated = await technicianModule().roster.updateProfile(
        db,
        params.technicianProfileId,
        {
          trade: parsed.trade,
          employmentRef: parsed.employmentRef,
          isActive: parsed.isActive,
          retire: parsed.retire,
          expectedVersion,
        },
        authorizeScope
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
