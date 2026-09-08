/**
 * /api/v1/warranties/{warrantyId} — read one warranty record (P1-22-BE-018).
 *
 * ## Re-pointed to a read code on 2026-09-08 (P1-31 prerequisite P-7)
 *
 * This operation used to declare `wty.warranty.issue` — the authority to CREATE a
 * warranty — because the permission catalogue seeded no `wty` read code at all,
 * and borrowing `wty.policy.manage` instead would have been worse: it grants
 * coverage administration to a caller who only needs to look at a record. That was
 * a defect and it is recorded as one: a read gated on a write code over-grants by
 * omission, and it is the reason the A0 preflight scheduled P-7.
 *
 * P-7 minted `wty.warranty.read` in `supabase/seeds/04_iam_permission_catalog.sql`
 * and this declaration now names it. It removes nothing from the write path:
 * `wty.warranty-generate` still declares `wty.warranty.issue` alone, and the tenant
 * administrator bundle carries the read code from provisioning.
 *
 * It DOES take something from organisations already provisioned. The bundle is
 * written once and no route can widen an existing organisation's server-owned role,
 * so an administrator created before this commit holds the issue code, not the read
 * code, and is refused here until the backfill decision (A0 **D-2**) is answered or
 * the organisation is provisioned afresh. That consequence is accepted and filed as
 * **P1-31 CC-07 / CC-08** rather than left for a reader to discover.
 *
 * The response carries no monetary field, and that is not an omission to be filled in
 * later. `wty` has 80 columns and not one of them is an amount, a currency or a cap in
 * any unit of account — a "covered value" here would be a fabricated business fact.
 *
 * It also carries no claim history, because there is none to carry: no claim table
 * exists in any schema (`P1-22-L-01`). `status` may legally read `claimed_against`,
 * since that value is in `ck_warranty_records_status`, and nothing in this phase can
 * ever write it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { warrantyModule } from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ warrantyId: schemas.uuid }).strict();

export const WARRANTY_DETAIL_OPERATION = defineOperation({
  id: 'wty.warranty-detail',
  module: 'warranty',
  method: 'GET',
  path: '/warranties/{warrantyId}',
  summary: 'Read a warranty record with its covered items and coverage terms.',
  permissions: ['wty.warranty.read'],
  scope: 'branch',
  auditClass: 'none',
  // 'low-risk-metadata' is the registered read policy for a single-resource lookup;
  // there is no 'standard-read' in RATE_LIMIT_POLICIES and defineOperation rejects an
  // unregistered name at module load.
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ warrantyId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    WARRANTY_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const warranty = await warrantyModule().warranties.readWarranty(
        db,
        params.warrantyId,
        authorizeScope
      );
      return { body: warranty };
    },
    { params: raw }
  );
}
