/**
 * /api/v1/invoices — create a draft invoice from approved commercial data
 * (P1-22-BE-003), and list a branch's invoices (Owner directive,
 * P1-32-PRE-OD-UX, `sal.invoice-list`).
 *
 * ## The list, and why it is a read of its own
 *
 * Every other invoice read is addressed by something the caller already holds.
 * The payment desk applies a receipt to an invoice and had nothing to choose
 * from, so it asked for a typed reference. `GET` answers the question that form
 * was asking: which invoices does this branch have, found by number — and, for a
 * caller who may read those registers, by the payer's name or by the plate or VIN
 * of the job's vehicle (see "Least privilege" below).
 *
 * `companyId` AND `branchId` are REQUIRED and travel as the authorization target
 * through `scopeTargetOption`, the shape `sal.credit-note-list` and
 * `sal.receipt-list` use. There is no optional branch here: an allocation cannot
 * cross a branch boundary, so a page spanning branches would offer invoices the
 * very next write refuses.
 *
 * ## Why the gate is `sal.finance.view`, and only that
 *
 * The read exists for the payment desk, and every person who uses it there holds
 * `sal.finance.view`: it is the `/payments` page's own gate, the only code the
 * receipt reads and `sal.invoice-outstanding-read` declare, and half of what
 * `sal.payment-allocate` declares. A declaration is a CONJUNCTION — the registry
 * has no "any of" (`operation-registry.ts`) — so the choice was one code, and the
 * two other candidates each take a workflow away:
 *
 * - `sal.invoice.manage` is a WRITE code. Declaring it refused the picker to a
 *   cashier holding `sal.payment.allocate` and `sal.finance.view` — exactly the
 *   caller the allocation route admits — and would have pushed an organisation to
 *   hand invoice authorship to its cash desk to get the picker back.
 * - `sal.payment.allocate` would refuse the receipt list's invoice filter to a
 *   finance viewer who does not allocate.
 *
 * `sal.finance.view` is the least authority every caller of the picker already
 * holds, and it removes nothing: before this read no invoice list existed for
 * anyone, so an invoice clerk without the finance code loses nothing it had.
 *
 * ## Least privilege: the finance code reveals money, not people or vehicles
 *
 * What the finance code already reached before this read is an invoice's header
 * and open balance (`sal.invoice-detail`, `sal.invoice-outstanding-read`) and a
 * receipt's payer IDENTIFIER (`sal.receipt-list` publishes `payerPartnerId` and
 * no name). It never reached a customer's name or a vehicle's plate or VIN. So
 * the list does not either, unless the caller holds the read that does:
 *
 * - the payer block (`displayName`, `displayNumber`, `partyType`) is published
 *   only to a caller holding `crm.customer.read`; for anyone else the block keeps
 *   its shape with every field `null` — the warranty list's customer block does
 *   the same — so a withheld payer and a retired one read alike;
 * - the box's payer-name arm is switched off without `crm.customer.read`, and its
 *   plate and VIN arms without `veh.vehicle.read`, so a finance viewer cannot
 *   learn a name or a plate by probing the box either. The invoice-number arm is
 *   always on: the number is on the row the caller already reads.
 *
 * Both answers are asked of `iam.has_permission` — scope-blind, as every other
 * list that withholds its customer arms asks — and can only NARROW what the
 * page says, never widen it.
 *
 * The finance split stays in the read regardless: `totals` and `outstanding` are
 * null — omitted, never zeroed — wherever the amounts row is not visible, so a
 * change to the policies underneath can hide money but never report a zero.
 * `status` is validated against the invoice vocabulary at the boundary, so an
 * unknown value is refused rather than answered with a page that reads as "none".
 *
 * ## `allocatable`
 *
 * `allocatable=true` narrows to the invoices money can still be applied to: the
 * two states `sal.payment-allocate` accepts — `issued` AND `credited`, because a
 * credit note can leave a receivable open — with an open receivable above zero as
 * `sal.invoice_open_receivable` computes it. It combines with `status` as a
 * conjunction. `true` is the ONLY value accepted: the opposite ("only invoices
 * that cannot take money") is a question nobody asks, and a `false` that was
 * accepted and then narrowed nothing would read as a filter that was applied.
 * Leaving the parameter out is how a caller asks for every invoice; any other
 * value — `false` included — is refused `422 ERR-VAL-001`.
 *
 * The query parameters are published in the OpenAPI document from `ListQuery`
 * itself (`queryParameterSchema`), so the contract and the parser cannot drift.
 *
 * ## Client totals are not ignored — they are unexpressible
 *
 * The body below has no `amount`, no `total`, no `tax`, no `lines` and no `unitPrice`,
 * and `.strict()` means a body carrying any of them is REFUSED rather than silently
 * dropped. There is therefore no code path on which a client-supplied total could be
 * trusted, because there is no field through which one could arrive.
 *
 * Every line and every amount is derived server-side from the approved quotation
 * revision and the captured pricing behind it, then snapshotted onto the invoice. The
 * work order names WHAT to bill; the approved commercial record decides HOW MUCH.
 *
 * ## Born draft, and the database insists
 *
 * `sal.guard_invoice_freeze` raises `check_violation` on any INSERT whose status is not
 * `'draft'`, so this route accepts no status field either — an invoice cannot be created
 * already-issued, which is what would otherwise bypass the numbering allocator and the
 * completeness event.
 *
 * `uq_invoices_work_order_active` permits AT MOST ONE live invoice per work order, so
 * staged or progress billing is structurally impossible and a second attempt is `23505`
 * — surfaced as a conflict, never a 500.
 *
 * ## Why `sal.finance.view` is required to CREATE
 *
 * `sal.invoice_amounts` and `sal.invoice_line_amounts` are gated by it on INSERT as well
 * as SELECT. Creation writes both, so a caller holding only `sal.invoice.manage` would
 * have its write refused by RLS. Declaring one permission and needing two would
 * advertise an operation that always fails.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { IDEMPOTENCY_HEADER } from '@/server/http/idempotency';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { MAX_SEARCH_FRAGMENT, MIN_SEARCH_FRAGMENT } from '@/shared/text/search-terms';
import { INVOICE_STATUSES, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const CreateBody = z
  .object({
    workOrderId: schemas.uuid,
    /**
     * Optional. Omitted, the payer is derived from the work order's own customer.
     *
     * Accepted only so a third-party payer (an insurer, a fleet operator) can be named
     * where the commercial arrangement differs from the vehicle's owner. It is a
     * partner identity, never an amount.
     */
    payerPartnerId: schemas.uuid.optional(),
  })
  .strict();

export const INVOICE_CREATE_OPERATION = defineOperation({
  id: 'sal.invoice-create',
  successStatus: 201,
  module: 'billing',
  method: 'POST',
  path: '/invoices',
  summary: 'Create a draft invoice for a work order from its approved commercial data.',
  permissions: ['sal.invoice.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.invoice.created',
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
    INVOICE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const invoice = await billingModule().invoices.createInvoice(
        db,
        {
          workOrderId: parsed.workOrderId,
          ...(parsed.payerPartnerId === undefined ? {} : { payerPartnerId: parsed.payerPartnerId }),
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return { status: 201, body: invoice };
    },
    { body }
  );
}

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(INVOICE_STATUSES).optional(),
    /** Only the invoices a receipt can still be applied to. `true` only; see the file header. */
    allocatable: z.literal('true').optional(),
    /**
     * One free-text box: part of the invoice number; part of the payer's name
     * with `crm.customer.read`; part of any plate or the VIN of the job's vehicle
     * with `veh.vehicle.read`. See the file header.
     */
    q: z.string().min(MIN_SEARCH_FRAGMENT).max(MAX_SEARCH_FRAGMENT).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const INVOICE_LIST_OPERATION = defineOperation({
  id: 'sal.invoice-list',
  module: 'billing',
  method: 'GET',
  path: '/invoices',
  summary: "List a branch's invoices by number, payer or vehicle, newest first.",
  permissions: ['sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  queryParameterSchema: z.toJSONSchema(ListQuery),
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    INVOICE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      // Parsed INSIDE the handler so a malformed query renders the shared problem
      // document rather than escaping as an unhandled 500.
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await billingModule().reads.listInvoices(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.allocatable === 'true' ? { allocatable: true } : {}),
            ...(query.q === undefined ? {} : { q: query.q }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    // The target comes from the RAW query: a pair that is not two uuids yields no
    // target, which can only make the check stricter (P1-18-A-01).
    scopeTargetOption(raw)
  );
}
