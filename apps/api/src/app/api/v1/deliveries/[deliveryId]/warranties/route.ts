/**
 * /api/v1/deliveries/{deliveryId}/warranties — generate a warranty from a committed
 * handover (P1-22-BE-018).
 *
 * A subresource of the delivery, not a colon-action and not a top-level
 * `/warranties` POST, and the shape carries meaning: a warranty record cannot exist
 * without a delivered handover. `wty.guard_warranty_record_coherence` refuses an
 * INSERT whose delivery is not `status = 'delivered'`, and every term of the
 * warranty is dated from `delivered_at`. Making the delivery the parent path segment
 * means a caller cannot even express "issue a warranty for nothing".
 *
 * ## What the caller may decide, and what it may not
 *
 * It may name a policy. That is all. Duration, odometer limit, covered scope and the
 * effective window all come from the `wty.warranty_coverage` row effective at the
 * delivery date, and this route hard-codes none of them — a missing coverage row is a
 * controlled configuration error, never a defaulted twelve months.
 *
 * `policyId` is optional and resolves to the company's single active policy when
 * omitted. If the company has none, or more than one, that is a configuration error
 * too: guessing which of two policies a customer's warranty falls under would be
 * inventing a legal term.
 *
 * ## Idempotency is applied twice, deliberately
 *
 * The header is enforced by `handleOperation`, which stores the response and replays
 * it without re-entering the handler. The same key is ALSO passed to
 * `wty.issue_warranty`, whose `uq_warranty_records_idempotency` makes the guarantee
 * durable in the database rather than only in `shared.idempotency_keys`.
 *
 * That second layer is not redundant. Without a key the primitive would attempt a
 * fresh INSERT, and the backstop it would hit is `ex_warranty_records_no_overlap` —
 * a blunt instrument that raises `23P01` instead of returning the record the caller
 * already has. With the key, a replay that somehow reached the primitive returns the
 * existing warranty, which is what the caller asked for.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import { parseOrFail, schemas } from '@/server/http/validation';
import { warrantyModule } from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();

/**
 * `policyId` is the only field. There is deliberately no `durationMonths`, no
 * `odometerLimit`, no `startDate` and no `coverageScope`: each is a coverage term the
 * operator configures, and accepting any of them from a client would let the caller
 * write its own warranty.
 */
const GenerateBody = z.object({ policyId: schemas.uuid.optional() }).strict();

export const WARRANTY_GENERATE_OPERATION = defineOperation({
  id: 'wty.warranty-generate',
  module: 'warranty',
  method: 'POST',
  path: '/deliveries/{deliveryId}/warranties',
  summary: 'Generate a warranty record from a committed vehicle delivery.',
  permissions: ['wty.warranty.issue'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wty.warranty.issued',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ deliveryId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    WARRANTY_GENERATE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(GenerateBody, body ?? {}, 'body');
      // Read from the resolved request rather than the outer closure so the value
      // travelling to the database is the same one the fingerprint was built from.
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const warranty = await warrantyModule().warranties.generateWarranty(
        db,
        {
          deliveryRecordId: params.deliveryId,
          ...(parsed.policyId === undefined ? {} : { policyId: parsed.policyId }),
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return { status: 201, body: warranty };
    },
    { params: raw, body }
  );
}
