/**
 * POST /api/v1/receptions/{receptionId}/close-without-work (P1-27 remediation
 * executed by P1-18, `P1-27-INT-014`).
 *
 * Moves the visit to the terminal `closed_without_work` — the exit for a visit
 * that will not become a work order: the customer changed their mind, nobody
 * came back, the estimate was declined. Before this command the state was
 * unreachable (only approve and convert called `setStatus`), so an abandoned
 * visit occupied its vehicle forever through `uq_reception_visits_open_vehicle`
 * — the INT-013 sibling. Closing releases that index by status alone: the
 * partial predicate names only `opened/inspecting/authorized/converted`, so a
 * returning customer can be received again.
 *
 * The reason is MANDATORY bounded text (never a catalogue id —
 * `rec.refusal_reasons` ships zero rows and has no management operation, so a
 * mandatory reference would be dead on arrival) and lands in the append-only
 * status ledger through the `app.status_reason` GUC.
 *
 * `If-Match` is mandatory, like every terminal decision about a customer's
 * vehicle; legal from any non-terminal state, exactly as the frozen graph says.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_CLOSURE_REASON, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });

const Body = z.object({ reason: z.string().trim().min(1).max(MAX_CLOSURE_REASON) }).strict();

export const RECEPTION_CLOSE_WITHOUT_WORK_OPERATION = defineOperation({
  id: 'rec.reception-close-without-work',
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/close-without-work',
  summary: 'Close a reception visit without work, releasing the vehicle for a later visit.',
  permissions: ['rec.reception.close'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.closed_without_work',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_CLOSE_WITHOUT_WORK_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const closed = await receptionModule().receptions.close(
        db,
        params.receptionId,
        'closed_without_work',
        input.reason,
        expectedVersion,
        // Re-authorized against the LOCKED visit's branch, not this request:
        // `scope: 'branch'` is inert without a target (P1-18-A-01).
        authorizeScope
      );
      return { status: 200, body: closed, recordVersion: closed.recordVersion };
    },
    { params: raw, body }
  );
}
