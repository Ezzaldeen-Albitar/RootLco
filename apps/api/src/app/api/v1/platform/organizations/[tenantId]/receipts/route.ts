/**
 * POST /api/v1/platform/organizations/{tenantId}/receipts (P1-32-PRE-024).
 *
 * Records money the Platform Owner received against a platform subscription
 * charge. Append-only: there is no update and no delete, and a correction is a
 * further charge.
 *
 * The receipt's currency is the charge's. A request that names a different one
 * is refused (`422`-class validation failure) rather than silently overridden,
 * and the database trigger `tg_subscription_receipts_coherence` refuses the row
 * as well. When the receipts reach the charge amount, the charge settles itself —
 * exactly once — by trigger; the response reports the charge status and the
 * remaining balance AFTER that happened, both computed by PostgreSQL.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid }).strict();

export const ReceiptRecordBody = z
  .object({
    chargeId: schemas.uuid,
    amount: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,4})?$/, 'must be a positive decimal string')
      .refine((value) => /[1-9]/.test(value), 'must be greater than zero'),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    reference: z.string().trim().min(1).max(200).optional(),
    method: z.string().trim().min(1).max(100),
    notes: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const RECEIPT_RECORD_OPERATION = defineOperation({
  id: 'platform.receipt-record',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/receipts',
  summary: 'Record money received against a platform subscription charge.',
  permissions: ['platform.billing.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.subscription_receipt.recorded',
  idempotent: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEIPT_RECORD_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(ReceiptRecordBody, body, 'body');
      const recorded = await platformModule().billing.recordReceipt(db, {
        tenantId: params.tenantId,
        chargeId: input.chargeId,
        amount: input.amount,
        currencyCode: input.currencyCode,
        receivedOn: input.receivedOn,
        reference: input.reference,
        method: input.method,
        notes: input.notes,
      });
      return { status: 201, body: recorded };
    },
    { params: raw, body }
  );
}
