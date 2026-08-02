/**
 * POST /api/v1/rework-links/{reworkLinkId}/sign-off (Phase 1-19, P1-19-BE-019).
 *
 * Records the independent sign-off BR-QMS-001 requires for safety-critical rework.
 *
 * ## The separation is a CHECK, and that is worth stating plainly
 *
 * `ck_rework_links_signoff_distinct` refuses `independent_sign_off_by` equal to
 * `lead_technician_id` — a CHECK constraint, not a trigger and not this service. The
 * pre-check in the service refuses first only so the caller gets a reason instead of a
 * bare `23514`. That is a stronger position than diagnostic reviewer separation, which
 * the schema cannot express at all and which therefore has to be an application rule.
 *
 * `org.guard_immutable_columns` freezes `lead_technician_id`, so the lead cannot be
 * swapped afterwards to make a signature legal, and `qms.guard_rework_signoff` makes
 * the signature write-once and stamps `sign_off_at`. So a recorded sign-off names one
 * person, for ever, and it is not the person who did the work.
 *
 * ## The signer is a TECHNICIAN PROFILE, not a user
 *
 * Both `independent_sign_off_by` and `lead_technician_id` foreign-key
 * `tech.technician_profiles` with the full branch scope key. The sign-off therefore
 * names someone on the workshop's own roster, which is what makes "somebody other than
 * the technician who did it" a statement about competence rather than about a login.
 *
 * Until this exists, closure blocker B6 blocks the REWORK order's own closure.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reworkLinkId: schemas.uuid });
const Body = z.object({ signOffBy: schemas.uuid }).strict();

export const REWORK_SIGN_OFF_OPERATION = defineOperation({
  id: 'qms.rework-sign-off',
  module: 'quality',
  method: 'POST',
  path: '/rework-links/{reworkLinkId}/sign-off',
  summary: 'Record the independent sign-off on a rework case.',
  // Its own high-risk permission, separate from `qms.rework.manage`: raising a rework
  // case and independently certifying it are the two halves BR-QMS-001 exists to keep
  // apart, and a tenant granting both to one role has made that choice knowingly.
  permissions: ['qms.rework.sign_off'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'qms.rework.signed_off',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ reworkLinkId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REWORK_SIGN_OFF_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const signed = await qualityModule().rework.signOff(
        db,
        params.reworkLinkId,
        { signOffBy: parsed.signOffBy, expectedVersion },
        authorizeScope
      );
      return { status: 200, body: signed, recordVersion: signed.recordVersion };
    },
    { params: raw, body }
  );
}
