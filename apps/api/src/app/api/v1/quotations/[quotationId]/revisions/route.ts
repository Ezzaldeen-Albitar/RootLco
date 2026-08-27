/**
 * POST /api/v1/quotations/{quotationId}/revisions (Phase 1-20, P1-20-BE-011).
 *
 * Creates a new DRAFT revision. This is how a commercial change reaches a customer.
 *
 * An issued revision is never edited: `quo.guard_quotation_item` refuses any item
 * insert, update or delete whose parent revision is not `draft`, which is exactly
 * what makes an issued revision an immutable snapshot of what the customer was
 * shown. So a price change, a quantity change or a new line all produce a *new*
 * revision, and the previously issued one stays byte-for-byte as it was presented —
 * including its captured unit prices, tax rates and totals, even after the
 * underlying price list is republished.
 *
 * Lines are re-priced from the protected price list at creation time. The caller
 * still supplies no amount: `.strict()` rejects `unitPrice` or `lineTotal` rather
 * than ignoring them.
 *
 * `If-Match` carries the quotation's `record_version`. The revision number is
 * `MAX + 1` under the quotation's `FOR UPDATE` lock, with
 * `uq_quotation_revisions_number` as the backstop, so two concurrent revisions
 * cannot both take the same number.
 *
 * It is `/revisions`, a sub-resource noun, not `:revise` — the operation registry's
 * `PATH_PATTERN` accepts only lower-case literal or `{camelCase}` segments, so a
 * colon-action path cannot be registered at all.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { INTERNAL_CODE } from '@/modules/service-catalog';
import { MAX_ITEMS_PER_REVISION, MAX_ITEM_DESCRIPTION, quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ quotationId: schemas.uuid });

const Line = z
  .object({
    serviceId: schemas.uuid,
    quantity: z
      .string()
      .regex(
        /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/,
        'must be a positive decimal with at most 3 decimal places'
      ),
    discount: z
      .string()
      .regex(
        /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/,
        'must be a non-negative decimal with at most 4 decimal places'
      )
      .optional(),
    description: z.string().min(1).max(MAX_ITEM_DESCRIPTION).optional(),
    sourceServiceLineRef: schemas.uuid.optional(),
  })
  .strict();

export const Body = z
  .object({
    lines: z.array(Line).min(1).max(MAX_ITEMS_PER_REVISION),
    customerClass: z.string().regex(INTERNAL_CODE, 'must be a lower-snake class code').optional(),
    discountRequestedBy: schemas.uuid.optional(),
  })
  .strict();

export const QUOTATION_REVISION_CREATE_OPERATION = defineOperation({
  id: 'quo.quotation-revision-create',
  module: 'quotation',
  method: 'POST',
  path: '/quotations/{quotationId}/revisions',
  summary: 'Create a new draft revision, leaving any issued revision untouched.',
  permissions: ['quo.quotation.manage'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'quo.quotation_revision.created',
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
    QUOTATION_REVISION_CREATE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const revision = await quotationModule().quotations.revise(
        db,
        params.quotationId,
        {
          lines: parsed.lines,
          customerClass: parsed.customerClass,
          discountRequestedBy: parsed.discountRequestedBy,
          expectedVersion,
        },
        authorizeScope
      );
      return { status: 201, body: revision, recordVersion: revision.recordVersion };
    },
    { params: raw, body }
  );
}
