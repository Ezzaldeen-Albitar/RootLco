/**
 * PATCH /api/v1/org/branches/{branchId} (PRE-P1-29 Wave C — G-4).
 *
 * `org.branch.manage` was seeded with zero references anywhere in the product.
 * This is the operation it was written for.
 *
 * ## What the body may not carry, and why each omission is a rule
 *
 *   `status`     — `shared.branch-status-change` already owns branch
 *                  transitions and writes `org.branch_status_history`. A second
 *                  path here would be a transition with no reason and no
 *                  history.
 *   `companyId`  — frozen by `tg_branches_immutable`. A branch cannot be moved
 *                  between companies, and offering the key would promise a
 *                  reassignment the database refuses.
 *   `branchCode` — frozen by the same trigger. Editing it would also recycle a
 *                  code that `uq_branches_company_code_live` reserves.
 *
 * The schema is `.strict()`, so each of those is a 422 naming the key rather
 * than a silent drop or a confusing 23514 from a trigger.
 *
 * ## The authorization target is the pair, taken from the row
 *
 * `authorizeScope({ companyId, branchId })` is called with the branch's OWN
 * company and id after resolving it. Passing only the branch would leave the
 * company unchecked, and `iam.has_permission_in_scope` treats an absent company
 * as unscoped — so the half-target would silently widen the check.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ branchId: schemas.uuid }).strict();

export const Body = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timezoneName: z.string().trim().min(1).max(64).optional(),
    addressLine1: z.string().trim().min(1).max(200).nullable().optional(),
    addressLine2: z.string().trim().min(1).max(200).nullable().optional(),
    city: z.string().trim().min(1).max(120).nullable().optional(),
    region: z.string().trim().min(1).max(120).nullable().optional(),
    postalCode: z.string().trim().min(1).max(32).nullable().optional(),
    countryCode: z.string().length(2).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be supplied',
  });

export const BRANCH_UPDATE_OPERATION = defineOperation({
  id: 'org.branch-update',
  module: 'iam',
  method: 'PATCH',
  path: '/org/branches/{branchId}',
  summary: 'Update a branch.',
  permissions: ['org.branch.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'org.branch.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ branchId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    BRANCH_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const result = await iamModule().organizationAdministration.updateBranch(
        db,
        params.branchId,
        parsed,
        expectedVersion,
        authorizeScope
      );
      return { body: result, recordVersion: result.branch.recordVersion };
    },
    { params: raw, body }
  );
}
