/**
 * /api/v1/invoices/{invoiceId}/credit-notes — request a credit against an issued invoice
 * (P1-22-BE-008).
 *
 * ## The original invoice is never rewritten
 *
 * A credit note is a separate positive-amount row linked to the invoice. There is no
 * signed amount anywhere in `sal`, so a credit is never a negative line, and the issued
 * invoice's own amounts stay frozen — `sal.guard_invoice_amount_frozen` refuses any write
 * whose parent is not `draft`.
 *
 * ## Born pending, and worth nothing until a second person approves
 *
 * `sal.stamp_dual_control_maker` forces `requested_by` from `iam.current_user_id()` and
 * NULLs the approval fields, so a request cannot arrive pre-approved and `requestedBy` is
 * not a client input. Nothing is credited here: the open receivable is unchanged until
 * `POST /credit-notes/{creditNoteId}/approval` succeeds, which is why this operation
 * publishes no event and the `credit-note.issued` event fires on approval instead.
 *
 * ## Currency comes from the parent invoice, and this is the only thing enforcing it
 *
 * `currency` is optional here and is read from `sal.invoices.currency_code` when omitted.
 * When supplied it is checked against the parent and refused on mismatch — and that check
 * is the ONLY defence in the entire system.
 *
 * Measured, not assumed: five triggers fire on `sal.credit_notes` and not one reads
 * `sal.invoices.currency_code`; `sal.approve_credit_note` compares the amount and never
 * the currency; and `sal.invoice_open_receivable` has no currency predicate either.
 * `tests/db/p1-22-protected-residuals.test.ts` inserts a JOD credit note against a USD
 * invoice, approves it, and shows 40 JOD subtracted from a USD gross — 100.0000 → 60.0000.
 *
 * So if `assertCurrencyMatches` is deleted, nothing else refuses the mismatch. Recorded as
 * `P1-22-L-02` and raised as change-control candidate CC-1; the fix is a migration, which
 * this phase does not author.
 *
 * The amount is bounded by the invoice's open receivable. `sal.approve_credit_note` checks
 * that too, and it is re-checked here so the caller gets an actionable refusal rather than
 * a `check_violation` whose message is not a caller-safe contract.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ invoiceId: schemas.uuid }).strict();

/** `numeric(18,4)`, unsigned, and strictly positive per `ck_credit_notes_amount`. */
const MoneyAmount = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,4})?$/,
    'must be an unsigned decimal string of at most 14 integer digits and 4 decimal places'
  );

const RequestBody = z
  .object({
    amount: MoneyAmount,
    reason: z.string().min(1).max(MAX_REASON),
    // Optional, and checked against the parent when present. Accepting it at all is
    // deliberate: a client that believes it is crediting a different currency should be
    // told it is wrong, not silently corrected.
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code')
      .optional(),
  })
  .strict();

export const CREDIT_NOTE_CREATE_OPERATION = defineOperation({
  id: 'sal.credit-note-create',
  module: 'billing',
  method: 'POST',
  path: '/invoices/{invoiceId}/credit-notes',
  summary: 'Request a credit note against an issued invoice, bounded by its open amount.',
  permissions: ['sal.credit.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.credit_note.requested',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ invoiceId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    CREDIT_NOTE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RequestBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const credit = await billingModule().invoices.requestCreditNote(
        db,
        {
          invoiceId: params.invoiceId,
          amount: parsed.amount,
          reason: parsed.reason,
          ...(parsed.currency === undefined ? {} : { currency: parsed.currency }),
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return { status: 201, body: credit };
    },
    { params: raw, body }
  );
}
