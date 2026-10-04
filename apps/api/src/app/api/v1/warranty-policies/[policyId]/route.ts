/**
 * GET / PATCH /api/v1/warranty-policies/{policyId} (Phase 1-31, P-10).
 *
 * `GET` returns one policy WITH its coverage rows. `PATCH` renames it under `If-Match`.
 *
 * ## The coverage rows are not paged, and their order is published
 *
 * `dia.template-version-item-list` states the rule this follows: the set is bounded by
 * authoring rather than by growth, and it is read as one thing. Here the bound is a
 * constraint — `ex_warranty_coverage_no_overlap` admits at most one ACTIVE row per
 * `(policy, covered_scope)` on any day, and there are three scopes — so only archived
 * history can accumulate.
 *
 * The order is `(covered_scope, effective_from, id)`. The exclusion constraint does NOT
 * make `(scope, from)` unique, because it excludes only ACTIVE rows, so an archived row
 * may repeat the pair and the id breaks the tie. Two reads must answer in the same
 * order or a screen re-renders its rows in a different sequence for no reason.
 *
 * ## Archived coverage is included, deliberately
 *
 * It is the history that explains a warranty issued under terms that have since been
 * replaced — `wty.warranty-detail` publishes the coverage a record cites whatever its
 * status — and hiding it here would make the reactivation command unreachable.
 *
 * ## Absent and invisible answer the same thing
 *
 * `findPolicyById` returns null for both and the service turns both into one
 * `ERR-RES-001`, decided BEFORE any scope decision, so a 403 never confirms that an id
 * names a real row somewhere.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_POLICY_NAME, warrantyModule } from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ policyId: schemas.uuid }).strict();

export const WARRANTY_POLICY_READ_OPERATION = defineOperation({
  id: 'wty.warranty-policy-read',
  module: 'warranty',
  method: 'GET',
  path: '/warranty-policies/{policyId}',
  summary: 'Read one warranty policy with its effective-dated coverage.',
  // `wty.warranty.read`, for the reason the collection read states: whoever issues a
  // warranty must be able to see the terms it will be issued under, and requiring the
  // administration code would hide them from exactly that principal.
  permissions: ['wty.warranty.read'],
  // `tenant`. Both tables have a company and no branch, so a company target would deny
  // the terms to the branch-scoped warranty clerk; RLS narrows by
  // `iam.allowed_company_ids()`.
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ policyId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    WARRANTY_POLICY_READ_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await warrantyModule().policies.readPolicy(db, params.policyId);
      // Published as the ETag as well as in the body: the rename and the status command
      // are version-guarded and `parseIfMatch` accepts only an exact positive integer,
      // so a caller needs a current version to act at all. It is the POLICY's version;
      // each coverage row carries its own in the body.
      return { body: detail, recordVersion: detail.policy.recordVersion };
    },
    { params: raw }
  );
}

/**
 * Rename body — the name and nothing else.
 *
 * `policyCode` is absent: a re-coded policy is a different configuration wearing the
 * old one's identity, and an operator reading a warranty issued last year would have no
 * way to know the code moved. `status` is absent because retiring a policy is its own
 * command, so the authority to fix a typo is not the authority to stop a company
 * issuing warranties. `companyId` is absent because
 * `tg_warranty_policies_immutable` freezes it.
 */
export const RenameBody = z
  .object({ name: z.string().trim().min(1).max(MAX_POLICY_NAME) })
  .strict();

export const WARRANTY_POLICY_RENAME_OPERATION = defineOperation({
  id: 'wty.warranty-policy-rename',
  module: 'warranty',
  method: 'PATCH',
  path: '/warranty-policies/{policyId}',
  summary: 'Rename one warranty policy.',
  permissions: ['wty.policy.manage'],
  // `company`, re-authorized by the service against the row's OWN company once it is
  // read — a declared scope is inert without a target (P1-18-A-01).
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'wty.warranty_policy.renamed',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ policyId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    WARRANTY_POLICY_RENAME_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, RenameBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      // The version is the POLICY's own, which is what this route's GET and the create
      // response publish as their ETag. A COVERAGE row carries a separate counter and
      // is guarded on its own path.
      const updated = await warrantyModule().policies.renamePolicy(
        db,
        params.policyId,
        expectedVersion,
        input.name,
        authorizeScope
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
