/**
 * GET /api/v1/receptions/{receptionId}/history — the status and custody ledgers
 * of one visit, newest first (P1-27 remediation executed by P1-18,
 * `P1-27-INT-021`).
 *
 * One page over a UNION of `rec.reception_status_history` and
 * `rec.custody_history` — the first read path the custody ledger has ever had,
 * and custody is now load-bearing for the INT-013 fix
 * (`uq_reception_visits_open_vehicle` keys on the recorded release). Both are
 * append-only `(occurred_at, seq)` ledgers; `seq` travels as a STRING because
 * it is a bigint, and the cursor tie-break is the uuid `id`, which
 * `decodeCursor` requires platform-wide (P1-15-SR-013).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });

const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const RECEPTION_HISTORY_OPERATION = defineOperation({
  id: 'rec.reception-history',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/history',
  summary: 'List the status and custody ledger of a reception visit, newest first.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    RECEPTION_HISTORY_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await receptionModule().receptionRead.listHistory(
          db,
          params.receptionId,
          query,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
