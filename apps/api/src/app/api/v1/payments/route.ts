/**
 * /api/v1/payments — record a receipt against a partner (P1-22-BE-010).
 *
 * `/payments` rather than `/receipts`, because the act the caller performs is
 * recording a payment; the receipt is the artefact it produces. The receipt is read
 * back at `/payments/{paymentId}`, so one resource carries one identity.
 *
 * ## What this route records, and what it structurally cannot claim
 *
 * It records that money was received. It does NOT record a settlement, an
 * authorisation, a gateway reference or a card. That is not a rule this code
 * remembers — `ck_payment_methods_kind` admits exactly `cash`, `card_terminal` and
 * `bank_transfer`, with the schema comment "No online payment gateway/settlement
 * types (ASM-14, CON-04)", so there is no column in which such a claim could be
 * stored. The body below therefore has no card field, no token field and no
 * authorisation field, and nothing on this path writes, logs or forwards a payment
 * credential.
 *
 * `receivedBy` is likewise absent by construction: `sal.record_receipt` stamps the
 * cashier from `iam.current_user_id()` and the tenant from `iam.current_tenant_id()`,
 * so neither is a client input and offering either as one would be offering a lie.
 *
 * ## Why the amount schema is tighter than `schemas.money`
 *
 * The shared catalogue permits six decimal places and a leading minus, because minor
 * units differ by currency. `sal` money is `numeric(18,4)` and every payment
 * instrument is `CHECK > 0`, so the boundary is bounded to match the column: at most
 * 14 integer digits and 4 decimals, unsigned.
 *
 * The fourth decimal matters more than it looks. Exceeding scale is **not an error**
 * in PostgreSQL — it silently rounds on the cast — so a fifth decimal place refused
 * here would otherwise be accepted and quietly altered, and the caller would never
 * learn its amount had changed. Exceeding 14 integer digits raises `22003`, which is
 * not `23514` and would surface as a 500.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `numeric(18,4)`, unsigned: 14 integer digits and 4 decimals at most. */
const MoneyAmount = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,4})?$/,
    'must be an unsigned decimal string of at most 14 integer digits and 4 decimal places'
  );

const CreateBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    paymentMethodId: schemas.uuid,
    payerPartnerId: schemas.uuid,
    // Required, never defaulted. No `currency_code` column in `sal` or `wty` carries
    // a DEFAULT, and the platform ships no jurisdiction default.
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code'),
    amount: MoneyAmount,
  })
  .strict();

export const PAYMENT_RECORD_OPERATION = defineOperation({
  id: 'sal.payment-record',
  module: 'payments',
  method: 'POST',
  path: '/payments',
  summary: 'Record a receipt for money received against a business partner.',
  // `sal.finance.view` alongside the recording authority because `sal.receipts` is
  // gated WHOLE-ROW by it on INSERT as well as SELECT: without it the write itself is
  // refused by RLS, so declaring only `sal.payment.record` would advertise an
  // operation that always fails for a caller who holds exactly that.
  permissions: ['sal.payment.record', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.receipt.recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    PAYMENT_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const receipt = await paymentsModule().payments.recordPayment(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          paymentMethodId: parsed.paymentMethodId,
          payerPartnerId: parsed.payerPartnerId,
          currencyCode: parsed.currency,
          amount: parsed.amount,
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return { status: 201, body: receipt };
    },
    // No `authorizationTarget`: the scope arrives in the body, which is not validated
    // until inside the handler, and a target built from unvalidated input would be
    // worse than none. The real enforcement is the service's `authorizeScope` call,
    // made with the company and branch it has just checked for coherence — which is
    // the same ordering P1-18-A-01 required.
    { body }
  );
}
