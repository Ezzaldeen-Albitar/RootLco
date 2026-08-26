/**
 * POST /api/v1/quotations/{quotationId}/issue (Phase 1-20, P1-20-BE-007).
 *
 * Issues a draft revision to the customer, freezing its totals.
 *
 * `quo.issue_revision` does the whole state change atomically: it verifies the
 * revision is `draft`, refuses a revision with zero items, recomputes all four
 * document totals by SUM over the live items, supersedes any previously issued
 * revision, repoints `current_revision_id`, and moves the quotation to `active`.
 * The partial unique index `uq_quotation_revisions_one_issued` is the backstop, so
 * two issued revisions cannot coexist even under concurrency.
 *
 * The totals are frozen from that moment —
 * `quo.guard_quotation_revision_freeze` refuses any change to them afterwards —
 * so a later price-list republication cannot alter what the customer was shown.
 *
 * ## Delivery is an intent, not a send
 *
 * Nothing here contacts a customer. The event goes to `shared.event_outbox` inside
 * the same transaction, so a rolled-back issue cannot leave a customer holding a
 * quotation the database never issued. An irreversible email inside a business
 * transaction is precisely the failure this avoids.
 *
 * `expiresAt` is optional: a revision with no expiry never lapses. When supplied it
 * must be in the future — issuing something already expired would create a
 * quotation that can never be decided.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ quotationId: schemas.uuid });

export const Body = z
  .object({
    revisionId: schemas.uuid,
    // A full timestamp, unlike the effective DATES elsewhere in this phase:
    // `quo.quotation_revisions.expires_at` is `timestamptz`, and expiry is compared
    // against the database's `now()`.
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const QUOTATION_ISSUE_OPERATION = defineOperation({
  id: 'quo.quotation-issue',
  module: 'quotation',
  method: 'POST',
  path: '/quotations/{quotationId}/issue',
  summary: 'Issue a draft revision to the customer, freezing its totals.',
  permissions: ['quo.quotation.manage'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'quo.quotation_revision.issued',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ quotationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    QUOTATION_ISSUE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const issued = await quotationModule().quotations.issue(
        db,
        params.quotationId,
        {
          revisionId: parsed.revisionId,
          ...(parsed.expiresAt === undefined ? {} : { expiresAt: new Date(parsed.expiresAt) }),
          expectedVersion,
        },
        authorizeScope
      );
      return { status: 200, body: issued, recordVersion: issued.recordVersion };
    },
    { params: raw, body }
  );
}
