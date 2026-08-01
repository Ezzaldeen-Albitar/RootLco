/**
 * GET / PATCH /api/v1/iam/users/{userId} (P1-14).
 *
 * The PATCH body accepts exactly two fields. There is no "merge the body into
 * the row" path: `status`, `email`, `tenantId`, `identityProvider`,
 * `providerSubject`, and `recordVersion` have nowhere to go, and the update
 * statement names only the two columns. The database refuses the rest
 * independently, at the privilege layer.
 *
 * Version-guarded: the current `record_version` must arrive in `If-Match`, and a
 * mismatch answers `ERR-CON-001`. A stale version and an out-of-scope row are
 * indistinguishable, because distinguishing them would leak existence.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ userId: schemas.uuid });
const PatchBody = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    mfaRequired: z.boolean().optional(),
  })
  .strict();

export const USER_DETAIL_OPERATION = defineOperation({
  id: 'iam.user-detail',
  module: 'iam',
  method: 'GET',
  path: '/iam/users/{userId}',
  summary: 'Read one user with their role grants.',
  permissions: ['iam.user.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const USER_UPDATE_OPERATION = defineOperation({
  id: 'iam.user-update',
  module: 'iam',
  method: 'PATCH',
  path: '/iam/users/{userId}',
  summary: 'Update a user display name or MFA requirement.',
  permissions: ['iam.user.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'iam.user.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    USER_DETAIL_OPERATION,
    request,
    async ({ db }) => ({ body: await iamModule().users.detail(db, params.userId) }),
    { params }
  );
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    USER_UPDATE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const body = await parseJsonBody(raw, PatchBody);
      if (expectedVersion === null) {
        // Unreachable while `versionGuarded` is true — the pipeline raises
        // ERR-CON-002 first — but a version-guarded write must never proceed on
        // a null expectation, so the invariant is stated rather than assumed.
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const user = await iamModule().users.updateProfile(db, params.userId, expectedVersion, {
        displayName: body.displayName,
        mfaRequired: body.mfaRequired,
      });
      return { body: user, recordVersion: user.recordVersion };
    },
    { params }
  );
}
