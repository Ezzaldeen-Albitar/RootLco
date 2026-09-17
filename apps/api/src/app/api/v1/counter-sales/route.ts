/**
 * /api/v1/counter-sales — selling stock over the counter (P1-32-PRE-107,
 * P1-32-PRE-110).
 *
 * `POST` creates a draft sale; `GET` lists a branch's sales.
 *
 * A counter sale is an INVOICE with no work order: someone — often another garage —
 * buys a part and leaves. No vehicle is received and no job is opened, so the
 * document is issued, settled, credited and reported through the invoice surface
 * that already exists. `sal.invoices.sale_kind` names which kind it is and
 * `ck_invoices_sale_kind_source` makes the work order present for exactly one of
 * them.
 *
 * ## No amount can arrive
 *
 * The body carries `itemId`, `locationId` and `quantity` per line and nothing else.
 * `.strict()` refuses a body with a price, a total, a tax or a discount rather than
 * dropping it, and every amount is resolved and computed inside
 * `sal.create_counter_sale_invoice` — so an item with no configured selling price
 * refuses the sale instead of leaving at zero.
 *
 * ## Nothing moves until it is issued
 *
 * A draft is a document being assembled. The stock leaves the shelf when
 * `POST /invoices/{invoiceId}/issuance` issues the sale, in that transaction,
 * against the invoice lines — and an issued sale cannot be voided, so cancelling a
 * document never puts stock back. A part comes back only through
 * `POST /sales-returns`.
 *
 * ## Why two permissions
 *
 * `sal.invoice.manage` names the act; `sal.finance.view` is required by
 * construction, because `ins_invoice_amounts_gated` and
 * `ins_invoice_line_amounts_gated` both demand it and this path writes both.
 * Declaring one and needing two would advertise an operation that always fails.
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
import { INVOICE_STATUSES, billingModule } from '@/modules/billing';
import { QUANTITY_MAX } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(INVOICE_STATUSES).optional(),
    customerPartnerId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const COUNTER_SALE_LIST_OPERATION = defineOperation({
  id: 'sal.counter-sale-list',
  module: 'billing',
  method: 'GET',
  path: '/counter-sales',
  summary: "List a branch's counter sales, newest first.",
  permissions: ['sal.invoice.manage'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    COUNTER_SALE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await billingModule().invoices.listCounterSales(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.customerPartnerId === undefined
              ? {}
              : { customerPartnerId: query.customerPartnerId }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    scopeTargetOption(raw)
  );
}

/** Quantity is a decimal STRING — see `POST /stock-reservations`. */
const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

export const CreateBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    /** The buyer. A partner of the selling tenant; no account is created for it. */
    customerPartnerId: schemas.uuid,
    lines: z
      .array(
        z
          .object({
            itemId: schemas.uuid,
            locationId: schemas.uuid,
            quantity: QuantityString,
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

export const COUNTER_SALE_CREATE_OPERATION = defineOperation({
  id: 'sal.counter-sale-create',
  module: 'billing',
  method: 'POST',
  path: '/counter-sales',
  summary: 'Create a draft counter sale of stock, priced from the item price list.',
  permissions: ['sal.invoice.manage', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'sal.counter_sale.created',
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
    COUNTER_SALE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope, request: inbound }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const key = inbound.headers.get(IDEMPOTENCY_HEADER);
      const sale = await billingModule().invoices.createCounterSale(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          customerPartnerId: parsed.customerPartnerId,
          lines: parsed.lines,
          ...(key === null ? {} : { idempotencyKey: key }),
        },
        authorizeScope
      );
      return { status: sale.replayed ? 200 : 201, body: sale, recordVersion: sale.recordVersion };
    },
    { body, ...scopeTargetOption(body) }
  );
}
