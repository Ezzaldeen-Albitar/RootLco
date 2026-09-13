/**
 * GET /api/v1/warranties/{warrantyId}/status-history (Phase 1-31, prerequisite P-18).
 *
 * The append-only warranty transition ledger, newest first.
 *
 * ## Change control CC-10
 *
 * `wty.warranty_status_history` is written by `wty.issue_warranty` — in the same
 * statement that creates the record — and, before this route, was read by NOTHING
 * anywhere in `apps/api/src`. P-6 published the warranty LIST and said so explicitly:
 * **VHM-06 / WF-26 / PPD-13** closed in its list limb and stayed open in its ledger
 * limb. This route closes the ledger limb, and it is the backend prerequisite the
 * warranty-history screen (FE-009) has no honest way to render without.
 *
 * It introduces no business policy. The table, its RLS (ENABLE and FORCE), its SELECT
 * policy for `app_runtime` and `app_readonly`, its SELECT grant and its newest-first
 * index all shipped in `20260724095000_wty_warranty.sql`; the permission code
 * `wty.warranty.read` was minted by P-7. There is no migration and no new code here.
 *
 * ## What the ledger contains today, stated rather than implied
 *
 * Exactly one row per record: the genesis `NULL -> 'issued'`. Nothing in this phase
 * advances `wty.warranty_records.status` — `assertWritableStatus` refuses structurally
 * — so no second transition exists yet on a record this application created. It is
 * nonetheless published as a PAGE and not as a single row, because the table is an
 * append-only ledger with no ceiling in the DDL and its later writers are the subject
 * of later work; a "one genesis row" contract would have to break the day one lands.
 *
 * ## The ledger is the record, not a reconstruction
 *
 * The table holds SELECT and INSERT grants only — no UPDATE, no DELETE, for any
 * application role — and `shared.stamp_status_history` is a BEFORE INSERT trigger that
 * sets `actor_id` and `occurred_at` from the session context. A transition cannot be
 * back-dated or re-attributed after the fact, and `actor_id NOT NULL` fails loudly
 * rather than recording an unattributed row.
 *
 * ## No synthesised `origin` block
 *
 * `wo.job_status_history` and `wo.work_order_status_history` are written by AFTER
 * UPDATE triggers, so the insert that CREATES the row emits no ledger entry and their
 * readers must publish a separate `origin.initialState`. `wty.warranty_records` has no
 * such trigger: the primitive writes the genesis row itself with `from_status = NULL`.
 * The oldest entry here is therefore already the origin, and inventing an `origin`
 * block would publish a second, unsourced claim about the same fact.
 *
 * ## Paging
 *
 * Keyset, newest first, under `WARRANTY_STATUS_HISTORY_ORDER`, served exactly by
 * `ix_warranty_status_history_record`
 * `(tenant_id, company_id, branch_id, warranty_record_id, occurred_at DESC, seq DESC)`.
 * The cursor's sort value is minted by `cursorTimestamp()` in SQL at microsecond
 * precision, because rows written inside one transaction share `now()` to the
 * microsecond and a millisecond-truncated cursor would silently SKIP them
 * (`P1-27-INT-006`).
 *
 * ## Permission and scope
 *
 * `wty.warranty.read`, uniform with `wty.warranty-detail` and `wty.warranty-list`: how
 * a warranty reached its status says no more about it than the record itself, and a
 * different gate would mean a caller could read the record but not how it got there.
 * `sel_warranty_status_history_scope` carries no permission term of its own — it is a
 * tenant/company/branch predicate — so the application gate is the only one. The record
 * is read first, so `ERR-RES-001` is decided before any scope decision and the branch
 * target is the row's own rather than one a caller supplied.
 *
 * `rateLimitPolicy: 'expensive-read'` and not the detail read's `'low-risk-metadata'`:
 * this is a paged walk over a growing ledger, which is the same shape as
 * `sal.delivery-status-history` and not the shape of a single-resource lookup.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { warrantyModule } from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ warrantyId: schemas.uuid }).strict();
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const WARRANTY_STATUS_HISTORY_OPERATION = defineOperation({
  id: 'wty.warranty-status-history',
  module: 'warranty',
  method: 'GET',
  path: '/warranties/{warrantyId}/status-history',
  summary: 'Read the append-only status history of a warranty record, newest first.',
  permissions: ['wty.warranty.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ warrantyId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const rawQuery = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    WARRANTY_STATUS_HISTORY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, rawQuery, 'query');
      return {
        body: await warrantyModule().warranties.readStatusHistory(
          db,
          params.warrantyId,
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
