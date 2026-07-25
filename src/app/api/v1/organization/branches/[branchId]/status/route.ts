/**
 * GET / POST /api/v1/organization/branches/{branchId}/status (P1-15).
 *
 * The P1-15 status-transition engine's reference aggregate. `org.branch` is the
 * one runtime-writable status in protected schema with a real module-owned
 * history table (`org.branch_status_history`), a coherence guard that overwrites
 * the actor and timestamp from the session, a `from ≠ to` CHECK, and a mandatory
 * reason — so the engine is proven against a genuine history rather than one
 * invented for a test.
 *
 * Scope is `branch`: a branch-scoped administrator may change *their* branch and
 * no other, which the `upd_branches_scope` RLS predicate enforces independently
 * of this declaration.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_TRANSITION_REASON, sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ branchId: schemas.uuid });
const Body = z
  .object({
    to: z.enum(['active', 'inactive']),
    reason: z.string().min(1).max(MAX_TRANSITION_REASON),
  })
  .strict();

export const BRANCH_STATUS_READ_OPERATION = defineOperation({
  id: 'shared.branch-status-read',
  module: 'shared-services',
  method: 'GET',
  path: '/organization/branches/{branchId}/status',
  summary: 'Read a branch status and the transitions available from it.',
  permissions: ['org.branch.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const BRANCH_STATUS_CHANGE_OPERATION = defineOperation({
  id: 'shared.branch-status-change',
  module: 'shared-services',
  method: 'POST',
  path: '/organization/branches/{branchId}/status',
  summary: 'Activate or deactivate a branch through the transition engine.',
  permissions: ['org.settings.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'org.branch.status_changed',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ branchId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    BRANCH_STATUS_READ_OPERATION,
    request,
    async ({ db }) => {
      const view = await sharedServicesModule().transitions.describe(
        db,
        'org.branch',
        params.branchId
      );
      return { body: view, recordVersion: view.recordVersion };
    },
    { params, authorizationTarget: { branchId: params.branchId } }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ branchId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    BRANCH_STATUS_CHANGE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const input = await parseJsonBody(raw, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const result = await sharedServicesModule().transitions.apply(db, {
        aggregate: 'org.branch',
        id: params.branchId,
        to: input.to,
        reason: input.reason,
        expectedVersion,
      });
      return { body: result, recordVersion: result.recordVersion };
    },
    { params, authorizationTarget: { branchId: params.branchId } }
  );
}
