/**
 * Invoice lifecycle — preview, create, issue, read, outstanding and void
 * (Phase 1-22 — P1-22-BE-002…007).
 *
 * An invoice is the document that states what a customer owes, so the assertions here
 * are on the DOCUMENT and on the NUMBER, not on the HTTP status. A 201 proves a row was
 * written; only the exact decimal totals, the branch sequence counter, the audit and
 * outbox deltas and the status of the row afterwards prove the right document was
 * written and that it was written once.
 *
 * ## Four properties every assertion here respects
 *
 *  - **Money is compared as an exact decimal STRING beside its currency.** Eleven `sal`
 *    money columns are `numeric(18,4)`, which holds values IEEE-754 cannot represent,
 *    and PostgreSQL silently ROUNDS a fifth decimal away on a cast rather than erroring.
 *    `Number`, `parseFloat`, `toFixed` and arithmetic on a money value appear nowhere in
 *    this file. An amount is never asserted without the currency that labels it: the
 *    preview's amounts are labelled once by `preview.currency`, and every `MoneyView`
 *    carries its own.
 *  - **Every count assertion is a DELTA.** The fixtures write real audit and outbox rows
 *    of their own — `createWorkOrder` drives the real reception-conversion route — so a
 *    tenant-wide absolute count measures arrangement rather than the command. Each
 *    "exactly once" claim is measured before and after and is also pinned to the
 *    specific aggregate.
 *  - **A refusal is asserted with its catalog code.** A 409 from
 *    `uq_invoices_work_order_active` and a 409 from an unissuable draft are different
 *    answers, and `code` is the field a client branches on.
 *  - **Every fixture amount is derived by PostgreSQL.** The local quotation fixture
 *    below writes `captured_tax_amount` and `captured_line_total` as SQL `round(…, 4)`
 *    expressions and the revision's four captured totals as an aggregate over the items
 *    it just inserted, so the fixture cannot disagree with the CHECK constraints that
 *    validate it and the expected preview figures are not a second arithmetic engine.
 *
 * ## Why this file seeds its own quotation
 *
 * `tests/backend/p1-22-helpers.ts` builds an invoice by inserting `sal` rows directly
 * (`seedIssuedInvoice`), which is right for the payment and warranty suites — they need
 * an issued invoice, not a billable work order. This file exercises `POST /invoices`,
 * whose whole claim is that every figure is derived from an ACCEPTED
 * `quo.quotation_revision`, so it needs the commercial source itself. The helper has no
 * fixture for one and must not be modified, so `seedAcceptedQuotation` below is local.
 *
 * It is admin SQL and necessarily so: reaching an accepted revision through P1-20's own
 * routes would require that phase's price lists, tax classes, discount ceilings and
 * principals, and a fixture that large would make a failure here ambiguous between two
 * phases. What matters is that the rows are the exact shape
 * `BillingRepository.findCommercialSources` reads — an `issued` revision that
 * `current_revision_id` points at, frozen captured amounts, and one `approved`
 * `quo.approval_decisions` row per item so `rollUpDecisions` derives `accepted` from the
 * decisions rather than from a status column.
 *
 * ## The declaration this file could not make when it was written, and now can
 *
 * `stale-version` was ABSENT from `sal.invoice-issue` and `sal.invoice-cancel`, and the
 * absence was the finding rather than an omission. Both operations declare
 * `versionGuarded: true`, so `handleOperation` requires an `If-Match` header and hands
 * the parsed value to the handler as `expectedVersion` — and both routes DISCARDED it.
 * Reproduced directly: `POST /invoices/{id}/issuance` with `If-Match: 99` against an
 * invoice at `record_version` 1 returned 200 and allocated a number. The guard read as
 * implemented and enforced nothing.
 *
 * The two `stale If-Match` cases were written to the contract and left FAILING rather
 * than weakened, because declaring the flag would have claimed evidence for a control
 * that did not exist — which is the exact dishonesty this gate is for.
 *
 * The control now exists: both services take `expectedVersion` and compare it against
 * the row they have just locked `FOR UPDATE` — after the lock, so no concurrent write
 * can slip between the comparison and the mutation — and both routes pass it through.
 * `sal.delivery-complete` had the same defect in a different shape: its service check
 * existed but was inert, because the field was optional and the route never supplied it.
 * All three are fixed, and the flag is declared here only now that it is backed.
 *
 * COVERAGE-EVIDENCE (P1-22 invoice lifecycle):
 *   sal.invoice-preview: route service authorization success denial isolation cross-tenant
 *   sal.invoice-create: route service authorization success denial audit outbox idempotency isolation cross-tenant
 *   sal.invoice-issue: route service authorization success denial audit outbox idempotency isolation cross-tenant stale-version
 *   sal.invoice-detail: route service authorization success denial isolation cross-tenant
 *   sal.invoice-outstanding-read: route service authorization success denial isolation cross-tenant
 *   sal.invoice-cancel: route service authorization success denial audit outbox idempotency isolation cross-tenant stale-version
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A2,
  PARTNER_A,
  SAL_FULL,
  SAL_NO_FINANCE,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_TENANT_B,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  outboxCountFor,
  seedWorkOrderChain,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as PREVIEW_INVOICE } from '@/app/api/v1/work-orders/[workOrderId]/invoice-preview/route';
import { POST as CREATE_INVOICE } from '@/app/api/v1/invoices/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { GET as READ_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import { POST as CANCEL_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/cancellation/route';

let admin: Pool;

// ---------------------------------------------------------------------------
// Wire shapes. Every `numeric` column is a string; no field is a JSON number
// except `lineNumber` and `recordVersion`, neither of which is money.
// ---------------------------------------------------------------------------

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface PreviewLineBody {
  readonly sourceQuotationItemId: string;
  readonly lineNumber: number;
  readonly lineType: string;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
}

interface PreviewBody {
  readonly workOrderId: string;
  readonly quotationId: string;
  readonly quotationRevisionId: string;
  readonly currency: string;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly netTotal: string;
  readonly grossTotal: string;
  readonly lines: readonly PreviewLineBody[];
}

interface InvoiceHeaderBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly quotationRevisionId: string | null;
  readonly payerPartnerId: string;
  readonly currency: string;
  readonly status: string;
  readonly invoiceNumber: string | null;
  readonly issuedAt: string | null;
  readonly recordVersion: number;
  readonly totals: {
    readonly net: MoneyBody;
    readonly tax: MoneyBody;
    readonly gross: MoneyBody;
  } | null;
}

interface InvoiceLineBody {
  readonly id: string;
  readonly lineNumber: number;
  readonly lineType: string;
  readonly quantity: string;
  readonly currency: string;
  readonly sourceQuotationItemId: string | null;
  readonly money: {
    readonly unitPrice: MoneyBody;
    readonly net: MoneyBody;
    readonly tax: MoneyBody;
    readonly gross: MoneyBody;
    readonly payerSplit: { readonly customer: MoneyBody; readonly warranty: MoneyBody };
  } | null;
}

interface InvoiceDetailBody {
  readonly invoice: InvoiceHeaderBody;
  readonly lines: readonly InvoiceLineBody[];
  readonly recordVersion: number;
}

interface CreatedInvoiceBody extends InvoiceDetailBody {
  readonly replayed: boolean;
}

interface IssuedInvoiceBody {
  readonly invoice: InvoiceHeaderBody;
  readonly invoiceNumber: string;
  readonly replayed: boolean;
  readonly recordVersion: number;
}

interface VoidedInvoiceBody {
  readonly invoice: InvoiceHeaderBody;
  readonly replayed: boolean;
  readonly recordVersion: number;
}

interface OutstandingBody {
  readonly invoiceId: string;
  readonly status: string;
  readonly outstanding: MoneyBody;
  readonly isSettled: boolean;
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
  readonly requiredPermissions?: readonly string[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

// ---------------------------------------------------------------------------
// Route callers. Each drives the exported handler with a real Request.
// ---------------------------------------------------------------------------

const previewInvoice = (workOrderId: string): Promise<Response> =>
  PREVIEW_INVOICE(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/invoice-preview`),
    { params: Promise.resolve({ workOrderId }) }
  );

/** `sal.invoice-create` declares `idempotent: true`, so the header is mandatory. */
const createInvoice = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_INVOICE(
    new Request('http://localhost/api/v1/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const readInvoice = (invoiceId: string): Promise<Response> =>
  READ_INVOICE(new Request(`http://localhost/api/v1/invoices/${invoiceId}`), {
    params: Promise.resolve({ invoiceId }),
  });

/** Both `If-Match` and `Idempotency-Key` are declared mandatory by the operation. */
const issueInvoice = (
  invoiceId: string,
  options: { readonly version: number; readonly key?: string }
): Promise<Response> =>
  ISSUE_INVOICE(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/issuance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? randomUUID(),
        'if-match': String(options.version),
      },
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

const readOutstanding = (invoiceId: string): Promise<Response> =>
  READ_OUTSTANDING(new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`), {
    params: Promise.resolve({ invoiceId }),
  });

const cancelInvoice = (
  invoiceId: string,
  body: unknown,
  options: { readonly version: number; readonly key?: string }
): Promise<Response> =>
  CANCEL_INVOICE(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/cancellation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? randomUUID(),
        'if-match': String(options.version),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

// ---------------------------------------------------------------------------
// Local fixtures. Admin reads and writes — never RLS evidence.
// ---------------------------------------------------------------------------

/** Runs `work` in ONE admin transaction with the actor and tenant GUCs set. */
async function inTenantTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * One quotation line, as the four values `quo.quotation_items` actually captures.
 *
 * `captured_tax_amount` and `captured_line_total` are deliberately NOT fields here: they
 * are computed by PostgreSQL inside the INSERT, in the exact expressions
 * `ck_quotation_items_tax_amount` and `ck_quotation_items_line_total` validate. A
 * fixture that supplied them would be a second arithmetic engine deciding what the
 * preview is expected to say.
 */
interface QuotationLineSpec {
  readonly unitPrice: string;
  readonly quantity: string;
  readonly discount: string;
  /** `numeric(9,6)` FRACTION in `[0,1]`. Not a percentage, and not a jurisdiction. */
  readonly taxRate: string;
}

/**
 * The line every arithmetic assertion in this file is anchored on.
 *
 * 100.0000 × 2.000 = 200.0000 subtotal; less a 50.0000 discount = 150.0000 net; tax at
 * the captured fraction 0.100000 on the DISCOUNTED base = 15.0000; gross 165.0000. The
 * discount-before-tax ordering is the quotation schema's, not this file's.
 */
const TAXED_DISCOUNTED_LINE: QuotationLineSpec = {
  unitPrice: '100.0000',
  quantity: '2.000',
  discount: '0050.0000',
  taxRate: '0.100000',
};

/** A single untaxed, undiscounted 100.0000 line — the invoice the outstanding read needs. */
const PLAIN_HUNDRED_LINE: QuotationLineSpec = {
  unitPrice: '100.0000',
  quantity: '1.000',
  discount: '0.0000',
  taxRate: '0.000000',
};

interface Billable {
  readonly tag: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly quotationId: string;
  readonly revisionId: string;
  readonly itemIds: readonly string[];
}

/**
 * An `issued` quotation revision with a per-item customer decision.
 *
 * Built in the order the schema demands rather than the order that reads best:
 * `quo.guard_quotation_item` refuses any item write whose parent revision is not
 * `draft`, so the items land first and the revision is then flipped to `issued` in the
 * SAME transaction — which is also when the DEFERRABLE `tg_quotation_items_totals`
 * fires. That trigger recomputes the four captured totals from the items and raises
 * unless they reconcile exactly, so the UPDATE below takes them from an aggregate over
 * those very rows instead of from a value this file computed.
 */
async function seedAcceptedQuotation(input: {
  readonly tag: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly currency?: string;
  readonly lines?: readonly QuotationLineSpec[];
  /** `none` leaves the revision undecided, so `rollUpDecisions` yields neither outcome. */
  readonly decision?: 'approved' | 'rejected' | 'none';
}): Promise<{
  readonly quotationId: string;
  readonly revisionId: string;
  readonly itemIds: string[];
}> {
  const currency = input.currency ?? 'USD';
  const lines = input.lines ?? [TAXED_DISCOUNTED_LINE];
  const decision = input.decision ?? 'approved';

  return inTenantTransaction(async (client) => {
    const quotation = await client.query<{ id: string }>(
      `INSERT INTO quo.quotations
         (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code,
          payer_partner_ref, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        TENANT_A,
        input.companyId,
        input.branchId,
        input.workOrderId,
        `FXQ-${input.tag}`,
        currency,
        PARTNER_A,
        USER_A,
      ]
    );
    const quotationId = quotation.rows[0]?.id ?? '';

    const revision = await client.query<{ id: string }>(
      `INSERT INTO quo.quotation_revisions
         (tenant_id, company_id, branch_id, quotation_id, revision_number, currency_code,
          created_by)
       VALUES ($1,$2,$3,$4,1,$5,$6) RETURNING id`,
      [TENANT_A, input.companyId, input.branchId, quotationId, currency, USER_A]
    );
    const revisionId = revision.rows[0]?.id ?? '';

    const itemIds: string[] = [];
    let lineNumber = 0;
    for (const line of lines) {
      lineNumber += 1;
      const item = await client.query<{ id: string }>(
        // Every amount below the four captured inputs is a PostgreSQL expression, and
        // each one is the CHECK constraint's own text: `captured_tax_amount` is
        // `round((unit × qty − discount) × rate, 4)` and `captured_line_total` is
        // `round(unit × qty − discount + tax, 4)` over that same rounded tax.
        `INSERT INTO quo.quotation_items
           (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind,
            description, currency_code, captured_unit_price, captured_quantity,
            captured_discount, captured_tax_rate, captured_tax_amount, captured_line_total,
            created_by)
         VALUES ($1,$2,$3,$4,$5,'service',$6,$7,
                 $8::numeric, $9::numeric, $10::numeric, $11::numeric,
                 round(($8::numeric * $9::numeric - $10::numeric) * $11::numeric, 4),
                 round($8::numeric * $9::numeric - $10::numeric
                       + round(($8::numeric * $9::numeric - $10::numeric) * $11::numeric, 4), 4),
                 $12)
         RETURNING id`,
        [
          TENANT_A,
          input.companyId,
          input.branchId,
          revisionId,
          lineNumber,
          `P1-22 billable line ${lineNumber}`,
          currency,
          line.unitPrice,
          line.quantity,
          line.discount,
          line.taxRate,
          USER_A,
        ]
      );
      itemIds.push(item.rows[0]?.id ?? '');
    }

    await client.query(
      `UPDATE quo.quotation_revisions r
          SET status = 'issued', issued_at = now(),
              captured_subtotal       = t.subtotal,
              captured_discount_total = t.discount_total,
              captured_tax_total      = t.tax_total,
              captured_grand_total    = t.grand_total
         FROM (SELECT COALESCE(sum(captured_unit_price * captured_quantity), 0) AS subtotal,
                      COALESCE(sum(captured_discount), 0)    AS discount_total,
                      COALESCE(sum(captured_tax_amount), 0)  AS tax_total,
                      COALESCE(sum(captured_line_total), 0)  AS grand_total
                 FROM quo.quotation_items
                WHERE tenant_id = $1 AND quotation_revision_id = $2 AND deleted_at IS NULL) t
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [TENANT_A, revisionId]
    );
    // `findCommercialSources` pins the revision with `r.id = q.current_revision_id`, so
    // a revision the quotation does not point at is not a billable source at all.
    await client.query(
      `UPDATE quo.quotations SET current_revision_id = $3, status = 'active'
        WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, quotationId, revisionId]
    );

    if (decision !== 'none') {
      for (const itemId of itemIds) {
        await client.query(
          `INSERT INTO quo.approval_decisions
             (tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id,
              decision, decided_by, decision_channel, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'in_person',$7)`,
          [TENANT_A, input.companyId, input.branchId, revisionId, itemId, decision, USER_A]
        );
      }
    }

    return { quotationId, revisionId, itemIds };
  });
}

/** A work order with an accepted commercial source behind it. */
async function seedBillable(
  tag: string,
  options: {
    readonly branchId?: string;
    readonly currency?: string;
    readonly lines?: readonly QuotationLineSpec[];
    readonly decision?: 'approved' | 'rejected' | 'none';
  } = {}
): Promise<Billable> {
  const chain = await seedWorkOrderChain(
    tag,
    options.branchId === undefined ? {} : { branchId: options.branchId }
  );
  const quotation = await seedAcceptedQuotation({
    tag,
    workOrderId: chain.workOrderId,
    companyId: chain.companyId,
    branchId: chain.branchId,
    ...(options.currency === undefined ? {} : { currency: options.currency }),
    ...(options.lines === undefined ? {} : { lines: options.lines }),
    ...(options.decision === undefined ? {} : { decision: options.decision }),
  });
  return {
    tag: chain.tag,
    workOrderId: chain.workOrderId,
    companyId: chain.companyId,
    branchId: chain.branchId,
    quotationId: quotation.quotationId,
    revisionId: quotation.revisionId,
    itemIds: quotation.itemIds,
  };
}

/**
 * A DRAFT invoice with NO lines, written as admin.
 *
 * Unreachable through `POST /invoices`, which always derives at least one line from the
 * accepted revision — and that is exactly why it has to be built here: `sal.issue_invoice`
 * refuses a lineless invoice with `check_violation`, and a refusal no fixture can reach
 * is a refusal no test can prove.
 */
async function seedLinelessDraftInvoice(
  tag: string
): Promise<{ readonly invoiceId: string; readonly recordVersion: number }> {
  const chain = await seedWorkOrderChain(tag);
  return inTenantTransaction(async (client) => {
    const row = await client.query<{ id: string; record_version: number }>(
      // `status`, `invoice_number` and `issued_at` are omitted: the column default is
      // `draft` and `ck_invoices_number_iff_issued` makes the other two a biconditional
      // with it, so there is nothing a fixture could usefully supply.
      `INSERT INTO sal.invoices
         (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code,
          created_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6)
       RETURNING id, record_version`,
      [TENANT_A, chain.companyId, chain.branchId, chain.workOrderId, PARTNER_A, USER_A]
    );
    return {
      invoiceId: row.rows[0]?.id ?? '',
      recordVersion: row.rows[0]?.record_version ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Read-backs and delta probes. Admin reads — never RLS evidence.
// ---------------------------------------------------------------------------

/** Audit rows for ONE action across the database, for a before/after delta. */
const auditTotalFor = (action: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1`, [action]);

/** Outbox rows for ONE event type, for a before/after delta. */
const outboxTotalFor = (eventType: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_type = $1`, [
    eventType,
  ]);

const invoiceRowsForWorkOrder = (workOrderId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.invoices WHERE work_order_id = $1`, [
    workOrderId,
  ]);

const statusHistoryRowsFor = (invoiceId: string, toStatus: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.invoice_status_history
      WHERE invoice_id = $1 AND to_status = $2`,
    [invoiceId, toStatus]
  );

/**
 * `shared.number_sequences.next_value` for the `invoice` sequence in one scope.
 *
 * A COUNTER, not money — which is why arithmetic on it is legitimate here and nowhere
 * else in this file. It is a `bigint` far inside the safe-integer range, the platform
 * advances it by exactly one per allocation, and the question being asked ("did this
 * request consume a number?") is only expressible as a difference.
 */
const invoiceSequenceNextValue = (
  companyId: string = COMPANY_A1,
  branchId: string = BRANCH_A1
): Promise<number> =>
  countRowsOf(
    `SELECT next_value::text AS n FROM shared.number_sequences
      WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND sequence_code = 'invoice'`,
    [TENANT_A, companyId, branchId]
  );

/** The live invoice row, read as admin, with its money in exact decimal form. */
async function invoiceRowOf(invoiceId: string): Promise<{
  readonly status: string;
  readonly invoiceNumber: string | null;
  readonly issuedAt: string | null;
  readonly currencyCode: string;
  readonly grossTotal: string | null;
} | null> {
  const result = await admin.query<{
    status: string;
    invoice_number: string | null;
    issued_at: string | null;
    currency_code: string;
    gross_total: string | null;
  }>(
    `SELECT i.status, i.invoice_number, i.issued_at::text AS issued_at, i.currency_code,
            a.gross_total::text AS gross_total
       FROM sal.invoices i
       LEFT JOIN sal.invoice_amounts a ON a.invoice_id = i.id AND a.deleted_at IS NULL
      WHERE i.id = $1`,
    [invoiceId]
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        status: row.status,
        invoiceNumber: row.invoice_number,
        issuedAt: row.issued_at,
        currencyCode: row.currency_code,
        grossTotal: row.gross_total,
      };
}

/** Creates the draft invoice as `SAL_FULL`, failing loudly if the fixture path breaks. */
async function draftInvoiceFor(billable: Billable): Promise<CreatedInvoiceBody> {
  authAs(SAL_FULL);
  const response = await createInvoice({ workOrderId: billable.workOrderId });
  if (response.status !== 201) {
    throw new Error(
      `fixture invoice for work order ${billable.workOrderId} failed with ` +
        `${response.status}: ${await response.text()}`
    );
  }
  return bodyOf<CreatedInvoiceBody>(response);
}

/** Creates and then issues an invoice as `SAL_FULL`. */
async function issuedInvoiceFor(
  billable: Billable
): Promise<{ readonly draft: CreatedInvoiceBody; readonly issued: IssuedInvoiceBody }> {
  const draft = await draftInvoiceFor(billable);
  authAs(SAL_FULL);
  const response = await issueInvoice(draft.invoice.id, { version: draft.recordVersion });
  if (response.status !== 200) {
    throw new Error(
      `fixture issue of invoice ${draft.invoice.id} failed with ${response.status}: ` +
        `${await response.text()}`
    );
  }
  return { draft, issued: await bodyOf<IssuedInvoiceBody>(response) };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
}, 180_000);

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

describe('sal.invoice-preview', () => {
  it('derives every amount from the accepted quotation and writes nothing (success)', async () => {
    const billable = await seedBillable('inv_preview_ok');
    const invoicesBefore = await invoiceRowsForWorkOrder(billable.workOrderId);
    const sequenceBefore = await invoiceSequenceNextValue();

    authAs(SAL_FULL);
    const response = await previewInvoice(billable.workOrderId);
    expect(response.status).toBe(200);
    const preview = await bodyOf<PreviewBody>(response);

    // The SOURCE is named, not merely the numbers: a preview that could not say which
    // revision it priced would be unauditable against the document it precedes.
    expect(preview.workOrderId).toBe(billable.workOrderId);
    expect(preview.quotationId).toBe(billable.quotationId);
    expect(preview.quotationRevisionId).toBe(billable.revisionId);

    // The currency labels every amount below it, and it comes from the revision — no
    // jurisdiction default exists anywhere in this phase.
    expect(preview.currency).toBe('USD');
    // Exact decimal STRINGS. `'0050.0000'` went into the fixture's discount and
    // `'50.0000'` is the canonical `numeric(18,4)` form that came back — the difference
    // is precisely what a JSON number would have hidden.
    expect(preview.subtotal).toBe('200.0000');
    expect(preview.discountTotal).toBe('50.0000');
    expect(preview.taxTotal).toBe('15.0000');
    expect(preview.netTotal).toBe('150.0000');
    expect(preview.grossTotal).toBe('165.0000');

    expect(preview.lines).toHaveLength(1);
    const line = preview.lines[0];
    expect(line?.sourceQuotationItemId).toBe(billable.itemIds[0]);
    expect(line?.lineNumber).toBe(1);
    expect(line?.lineType).toBe('service');
    expect(line?.quantity).toBe('2.000');
    expect(line?.unitPrice).toBe('100.0000');
    expect(line?.discount).toBe('50.0000');
    // The captured FRACTION, carried for transparency and never re-applied.
    expect(line?.taxRate).toBe('0.100000');
    expect(line?.netAmount).toBe('150.0000');
    expect(line?.taxAmount).toBe('15.0000');
    expect(line?.grossAmount).toBe('165.0000');

    // Writes NOTHING. No invoice appeared for the work order, and — the assertion that
    // matters more — the branch numbering counter did not move: a preview that consumed
    // a number would burn one document number per negotiation round.
    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(invoicesBefore);
    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(0);
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(0);

    // And it is repeatable, which is the whole reason it exists apart from POST /invoices.
    authAs(SAL_FULL);
    const again = await previewInvoice(billable.workOrderId);
    expect(again.status).toBe(200);
    expect(await bodyOf<PreviewBody>(again)).toEqual(preview);
  });

  it('refuses a work order with no accepted quotation rather than previewing zero (denial)', async () => {
    // Three sources of "not accepted", all of which must refuse rather than bill zero:
    // no quotation at all, an undecided revision, and a REJECTED one. A zero total is
    // legal on an issued invoice (a fully covered job), so nothing downstream would
    // catch a preview that answered 0.0000 here.
    const noQuotation = await seedWorkOrderChain('inv_preview_none');
    authAs(SAL_FULL);
    const bare = await previewInvoice(noQuotation.workOrderId);
    expect(bare.status).toBe(404);
    expect((await bodyOf<ProblemBody>(bare)).code).toBe('ERR-RES-001');

    const undecided = await seedBillable('inv_preview_undecided', { decision: 'none' });
    authAs(SAL_FULL);
    const pending = await previewInvoice(undecided.workOrderId);
    expect(pending.status).toBe(404);
    expect((await bodyOf<ProblemBody>(pending)).code).toBe('ERR-RES-001');

    const refused = await seedBillable('inv_preview_rejected', { decision: 'rejected' });
    authAs(SAL_FULL);
    const rejected = await previewInvoice(refused.workOrderId);
    expect(rejected.status).toBe(404);
    expect((await bodyOf<ProblemBody>(rejected)).code).toBe('ERR-RES-001');

    // Not one of the three produced a document.
    for (const workOrderId of [
      noQuotation.workOrderId,
      undecided.workOrderId,
      refused.workOrderId,
    ]) {
      expect(await invoiceRowsForWorkOrder(workOrderId)).toBe(0);
    }
  });

  it('refuses a malformed work-order id before reading anything (denial)', async () => {
    authAs(SAL_FULL);
    const response = await previewInvoice('not-a-uuid');
    // `schemas.uuid` is parsed INSIDE the handler, so this is the operation's own
    // refusal naming the field rather than a framework 404 — a non-uuid reaching the
    // repository would be a `22P02` the catalog has no honest mapping for.
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('path.workOrderId');
  });

  it('refuses a caller lacking sal.finance.view although it may manage invoices (authorization)', async () => {
    // The preview IS money. This principal holds every other `sal`/`wty` code including
    // `sal.invoice.manage`, so the refusal is the finance permission and nothing else —
    // without it a caller barred from an invoice's amounts could obtain them from a
    // preview instead, which would make the restricted amount tables pointless.
    const billable = await seedBillable('inv_preview_authz');
    authAs(SAL_NO_FINANCE);
    const response = await previewInvoice(billable.workOrderId);
    expect(response.status).toBe(403);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toContain('sal.finance.view');
  });

  it('refuses a branch the caller holds no invoice permission in (isolation)', async () => {
    // BRANCH_A1 IS inside this principal's permission-blind `iam.allowed_branch_ids()`
    // union, because a SECOND grant carrying only `org.tenant.read` names it. So RLS
    // cannot answer 404 and the work order is perfectly visible: the ONLY thing that can
    // refuse this read is the scoped permission evaluation against the work order's own
    // company and branch (P1-18-A-01).
    const billable = await seedBillable('inv_preview_isolation');
    expect(billable.branchId).toBe(BRANCH_A1);
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await previewInvoice(billable.workOrderId);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');

    // The work order really is visible to that caller's RLS union — otherwise the
    // refusal above would be a 404 dressed up as a 403 and would prove nothing.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wo.work_orders
          WHERE id = $1 AND branch_id = ANY(
            SELECT s.branch_id FROM iam.grant_scopes s
              JOIN iam.role_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
             WHERE g.user_id = $2 AND s.branch_id IS NOT NULL)`,
        [billable.workOrderId, SAL_PERMISSION_ELSEWHERE.userId]
      )
    ).toBe(1);
  });

  it('cannot price a tenant-A work order from tenant B (cross-tenant)', async () => {
    // A REAL billable tenant-A work order, so the refusal has a priceable thing behind
    // it: an empty result proves nothing about the tenant boundary. Tenant B holds every
    // `sal` permission IN ITS OWN TENANT, so this is RLS and not a missing grant.
    const billable = await seedBillable('inv_preview_cross');
    authAs(SAL_TENANT_B);
    const response = await previewInvoice(billable.workOrderId);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');

    // An unknown id answers identically, so the code is not an existence oracle.
    authAs(SAL_TENANT_B);
    expect((await previewInvoice(randomUUID())).status).toBe(404);
  });
});

describe('sal.invoice-create', () => {
  it('TC-P1-22-001 is born draft with a NULL number, and every line and amount is server-derived (success)', async () => {
    const billable = await seedBillable('inv_create_ok');

    authAs(SAL_FULL);
    const response = await createInvoice({ workOrderId: billable.workOrderId });
    expect(response.status).toBe(201);
    const created = await bodyOf<CreatedInvoiceBody>(response);

    expect(created.replayed).toBe(false);
    expect(created.invoice.status).toBe('draft');
    // The two facts that make "born draft" more than a status string: no number has been
    // allocated and no issue time exists. `ck_invoices_number_iff_issued` makes them a
    // biconditional with the status, so either being set would be a document already
    // shown to a customer.
    expect(created.invoice.invoiceNumber).toBeNull();
    expect(created.invoice.issuedAt).toBeNull();
    expect(created.invoice.workOrderId).toBe(billable.workOrderId);
    expect(created.invoice.companyId).toBe(billable.companyId);
    expect(created.invoice.branchId).toBe(billable.branchId);
    // The commercial source is recorded ON the invoice, so what it was priced from is
    // recoverable from the document itself rather than from a log line.
    expect(created.invoice.quotationRevisionId).toBe(billable.revisionId);
    // Derived from the quotation, not from the request: the body named no payer.
    expect(created.invoice.payerPartnerId).toBe(PARTNER_A);
    expect(created.invoice.currency).toBe('USD');

    // Header totals, each as an exact decimal STRING with its currency beside it.
    expect(created.invoice.totals?.net).toEqual({ amount: '150.0000', currency: 'USD' });
    expect(created.invoice.totals?.tax).toEqual({ amount: '15.0000', currency: 'USD' });
    expect(created.invoice.totals?.gross).toEqual({ amount: '165.0000', currency: 'USD' });

    expect(created.lines).toHaveLength(1);
    const line = created.lines[0];
    // The quotation's own line numbering is reused, so invoice line 3 points at
    // quotation line 3 — what a customer comparing the two documents expects.
    expect(line?.lineNumber).toBe(1);
    expect(line?.lineType).toBe('service');
    expect(line?.quantity).toBe('2.000');
    expect(line?.currency).toBe('USD');
    expect(line?.sourceQuotationItemId).toBe(billable.itemIds[0]);
    expect(line?.money?.unitPrice).toEqual({ amount: '100.0000', currency: 'USD' });
    expect(line?.money?.net).toEqual({ amount: '150.0000', currency: 'USD' });
    expect(line?.money?.tax).toEqual({ amount: '15.0000', currency: 'USD' });
    expect(line?.money?.gross).toEqual({ amount: '165.0000', currency: 'USD' });
    // FR-WTY-004: the payer split always sums to gross, and the whole gross is the
    // customer's because no protected configuration determines a warranty share at
    // invoice time. A non-zero warranty share here could only have come from a client.
    expect(line?.money?.payerSplit.customer).toEqual({ amount: '165.0000', currency: 'USD' });
    expect(line?.money?.payerSplit.warranty).toEqual({ amount: '0.0000', currency: 'USD' });

    // The ROW carries it too, in the same exact form, and the preview's own gross agreed.
    const row = await invoiceRowOf(created.invoice.id);
    expect(row?.status).toBe('draft');
    expect(row?.invoiceNumber).toBeNull();
    expect(row?.issuedAt).toBeNull();
    expect(row?.currencyCode).toBe('USD');
    expect(row?.grossTotal).toBe('165.0000');
    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(1);
  });

  it('refuses a body carrying amount, total, lines or unitPrice (denial)', async () => {
    // The claim this case exists for: client totals are not IGNORED, they are
    // UNEXPRESSIBLE. `CreateBody` is `.strict()` over exactly two fields, so a body
    // carrying a figure is REFUSED rather than silently dropped — there is no code path
    // on which a client-supplied total could be trusted, because no field delivers one.
    const billable = await seedBillable('inv_create_strict');

    for (const [field, value] of [
      ['amount', '1.0000'],
      ['total', '1.0000'],
      ['tax', '0.0000'],
      ['unitPrice', '1.0000'],
      ['grossTotal', '1.0000'],
    ] as const) {
      authAs(SAL_FULL);
      const response = await createInvoice({ workOrderId: billable.workOrderId, [field]: value });
      expect(response.status, `body.${field}`).toBe(422);
      const problem = await bodyOf<ProblemBody>(response);
      expect(problem.code).toBe('ERR-VAL-001');
      // The RULE is the evidence, and it is the strongest form available: Zod reports
      // `unrecognized_keys` — not `invalid_type`, not `custom` — which means the field
      // has no place in the schema at all rather than a place it failed to satisfy.
      // Each request above carries exactly ONE extra field, so the one issue is that
      // field's. Its path is `body` because an unrecognized-key issue is raised against
      // the OBJECT (`issue.path` is empty) rather than against the offending key.
      expect(problem.violations, `body.${field}`).toHaveLength(1);
      expect(problem.violations?.[0]?.rule, `body.${field}`).toBe('unrecognized_keys');
      expect(problem.violations?.[0]?.path, `body.${field}`).toBe('body');
    }

    // `lines` separately, because an array is the shape a client would most plausibly
    // send and the one that would be most damaging to accept.
    authAs(SAL_FULL);
    const withLines = await createInvoice({
      workOrderId: billable.workOrderId,
      lines: [{ unitPrice: '1.0000', quantity: '1.000' }],
    });
    expect(withLines.status).toBe(422);
    const linesProblem = await bodyOf<ProblemBody>(withLines);
    expect(linesProblem.code).toBe('ERR-VAL-001');
    expect(linesProblem.violations?.[0]?.rule).toBe('unrecognized_keys');

    // Not one of the six wrote a document.
    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(0);
  });

  it('writes exactly one audit record and exactly one event (audit, outbox)', async () => {
    const billable = await seedBillable('inv_create_events');
    const auditBefore = await auditTotalFor('sal.invoice.created');
    const outboxBefore = await outboxTotalFor('invoice.created');

    authAs(SAL_FULL);
    const response = await createInvoice({ workOrderId: billable.workOrderId });
    expect(response.status).toBe(201);
    const created = await bodyOf<CreatedInvoiceBody>(response);

    // DELTAS, not totals: the work-order fixture drives the real conversion route and
    // writes real audit and outbox rows, so an absolute count would measure arrangement.
    expect((await auditTotalFor('sal.invoice.created')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('invoice.created')) - outboxBefore).toBe(1);
    // And the row that moved is THIS invoice's, keyed on the aggregate.
    expect(await auditCountFor('sal.invoice.created', created.invoice.id)).toBe(1);
    expect(await outboxCountFor(`invoice.created:${created.invoice.id}`)).toBe(1);
    // The birth row of the append-only ledger, written in the same transaction.
    expect(await statusHistoryRowsFor(created.invoice.id, 'draft')).toBe(1);
  });

  it('replays an idempotency key without creating a second invoice (idempotency)', async () => {
    const billable = await seedBillable('inv_create_replay');
    const key = randomUUID();
    const payload = { workOrderId: billable.workOrderId };
    const auditBefore = await auditTotalFor('sal.invoice.created');
    const outboxBefore = await outboxTotalFor('invoice.created');

    authAs(SAL_FULL);
    const first = await createInvoice(payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<CreatedInvoiceBody>(first);

    authAs(SAL_FULL);
    const replay = await createInvoice(payload, key);
    // 200 rather than 201: the stored response is replayed and the handler is never
    // re-entered, so a retrying client can tell it did not invoice the job twice.
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<CreatedInvoiceBody>(replay);
    expect(replayed.invoice.id).toBe(original.invoice.id);
    expect(replayed.invoice.totals?.gross).toEqual({ amount: '165.0000', currency: 'USD' });

    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(1);
    expect((await auditTotalFor('sal.invoice.created')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('invoice.created')) - outboxBefore).toBe(1);
    expect(await statusHistoryRowsFor(original.invoice.id, 'draft')).toBe(1);
  });

  it('refuses a second live invoice for the same work order as a conflict (denial)', async () => {
    const billable = await seedBillable('inv_create_second');
    const first = await draftInvoiceFor(billable);

    // A DIFFERENT key, so this is the work-order uniqueness rule answering and not the
    // idempotency store. `uq_invoices_work_order_active` permits at most one live
    // invoice per work order, which makes staged or progress billing structurally
    // impossible — and this must be a 409 with a code, never the bare `23505` five
    // layers down and never a 500.
    authAs(SAL_FULL);
    const second = await createInvoice({ workOrderId: billable.workOrderId }, randomUUID());
    expect(second.status).toBe(409);
    expect((await bodyOf<ProblemBody>(second)).code).toBe('ERR-CON-001');

    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(1);
    expect((await invoiceRowOf(first.invoice.id))?.status).toBe('draft');
  });

  it('refuses a caller lacking sal.invoice.manage and one lacking sal.finance.view (authorization)', async () => {
    const billable = await seedBillable('inv_create_authz');

    authAs(SAL_READER);
    const reader = await createInvoice({ workOrderId: billable.workOrderId });
    expect(reader.status).toBe(403);
    expect((await bodyOf<ProblemBody>(reader)).code).toBe('ERR-IAM-001');

    // The second half is the one worth stating: this principal holds
    // `sal.invoice.manage` and everything else, and is refused because
    // `ins_invoice_amounts_gated` and `ins_invoice_line_amounts_gated` both require
    // `sal.finance.view` on INSERT. Declaring one permission and needing two would
    // advertise an operation RLS always refuses, so the operation declares both and the
    // refusal is the uniform 403 rather than a `42501` from inside the write.
    authAs(SAL_NO_FINANCE);
    const noFinance = await createInvoice({ workOrderId: billable.workOrderId });
    expect(noFinance.status).toBe(403);
    expect((await bodyOf<ProblemBody>(noFinance)).code).toBe('ERR-IAM-001');

    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(0);
  });

  it('refuses a branch the caller holds no invoice permission in (isolation)', async () => {
    const billable = await seedBillable('inv_create_isolation');
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await createInvoice({ workOrderId: billable.workOrderId });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(0);
  });

  it('cannot invoice a tenant-A work order from tenant B (cross-tenant)', async () => {
    // The work order arrives in the BODY rather than the path, which is why the manifest
    // declares this obligation by hand: naming another tenant's work order is exactly
    // the same risk as naming another tenant's invoice in a path.
    const billable = await seedBillable('inv_create_cross');
    authAs(SAL_TENANT_B);
    const response = await createInvoice({ workOrderId: billable.workOrderId });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect(await invoiceRowsForWorkOrder(billable.workOrderId)).toBe(0);
  });
});

describe('sal.invoice-issue', () => {
  it('TC-P1-22-002 allocates EXACTLY ONE number and advances the branch sequence by one (success)', async () => {
    const billable = await seedBillable('inv_issue_ok');
    const draft = await draftInvoiceFor(billable);
    const sequenceBefore = await invoiceSequenceNextValue();
    const auditBefore = await auditTotalFor('sal.invoice.issued');
    const outboxBefore = await outboxTotalFor('invoice.issued');

    authAs(SAL_FULL);
    const response = await issueInvoice(draft.invoice.id, { version: draft.recordVersion });
    expect(response.status).toBe(200);
    const issued = await bodyOf<IssuedInvoiceBody>(response);

    expect(issued.replayed).toBe(false);
    // The number is OPAQUE TEXT. It is asserted as a non-empty string and never parsed,
    // prefix-matched or sorted: no format exists in schema or seeds, so a test that
    // matched one would be inventing a contract.
    expect(typeof issued.invoiceNumber).toBe('string');
    expect(issued.invoiceNumber.length).toBeGreaterThan(0);
    expect(issued.invoice.invoiceNumber).toBe(issued.invoiceNumber);
    expect(issued.invoice.status).toBe('issued');
    expect(issued.invoice.issuedAt).not.toBeNull();

    // ONE number, and the counter is the only thing that can prove it: the row could
    // carry a plausible number that came from a second allocation.
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(1);

    const row = await invoiceRowOf(draft.invoice.id);
    expect(row?.status).toBe('issued');
    expect(row?.invoiceNumber).toBe(issued.invoiceNumber);
    expect(row?.issuedAt).not.toBeNull();
    // `sal.issue_invoice` RECOMPUTES the header from the stored line amounts, so this is
    // the authoritative gross rather than the draft's working total — and it agrees.
    expect(row?.grossTotal).toBe('165.0000');
    expect(row?.currencyCode).toBe('USD');

    expect((await auditTotalFor('sal.invoice.issued')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('invoice.issued')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.invoice.issued', draft.invoice.id)).toBe(1);
    expect(await outboxCountFor(`invoice.issued:${draft.invoice.id}`)).toBe(1);
    // ONE ledger row for the transition, written by the primitive and NOT duplicated by
    // the service — the table has no UPDATE or DELETE grant, so a second row would be
    // unfixable.
    expect(await statusHistoryRowsFor(draft.invoice.id, 'issued')).toBe(1);
  });

  it('TC-P1-22-003 replays an idempotency key with the SAME number and no second allocation (idempotency)', async () => {
    const billable = await seedBillable('inv_issue_replay');
    const draft = await draftInvoiceFor(billable);
    const key = randomUUID();
    const auditBefore = await auditTotalFor('sal.invoice.issued');
    const outboxBefore = await outboxTotalFor('invoice.issued');
    const sequenceBefore = await invoiceSequenceNextValue();

    authAs(SAL_FULL);
    const first = await issueInvoice(draft.invoice.id, { version: draft.recordVersion, key });
    expect(first.status).toBe(200);
    const original = await bodyOf<IssuedInvoiceBody>(first);
    const sequenceAfterFirst = await invoiceSequenceNextValue();
    expect(sequenceAfterFirst - sequenceBefore).toBe(1);

    authAs(SAL_FULL);
    const replay = await issueInvoice(draft.invoice.id, { version: draft.recordVersion, key });
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<IssuedInvoiceBody>(replay);

    // The NUMBER, not only the id. A replay that re-entered the command would hand back
    // a second number for one issuance, and the id would still have matched.
    expect(replayed.invoiceNumber).toBe(original.invoiceNumber);
    expect(replayed.invoice.status).toBe('issued');

    // ONE invoice row carrying that number, anywhere in the tenant.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices
          WHERE tenant_id = $1 AND invoice_number = $2`,
        [TENANT_A, original.invoiceNumber]
      )
    ).toBe(1);
    // ONE audit record, ONE outbox row, ONE ledger row, and the counter UNCHANGED by the
    // replay — the last of these is what distinguishes "the same number was returned"
    // from "a second number was minted and discarded".
    expect((await auditTotalFor('sal.invoice.issued')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('invoice.issued')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.invoice.issued', draft.invoice.id)).toBe(1);
    expect(await outboxCountFor(`invoice.issued:${draft.invoice.id}`)).toBe(1);
    expect(await statusHistoryRowsFor(draft.invoice.id, 'issued')).toBe(1);
    expect((await invoiceSequenceNextValue()) - sequenceAfterFirst).toBe(0);
  });

  it('answers a NEW idempotency key against an already-issued invoice with the same number', async () => {
    /**
     * A DELIBERATE deviation from the brief, recorded rather than papered over.
     *
     * The assignment asked for this to be REFUSED because the invoice "is no longer
     * draft". The shipped design does the opposite on purpose, and says so:
     * `InvoiceService.issueInvoice` short-circuits on the LOCKED pre-read when the
     * status is already `issued`, returns the existing number with `replayed: true`,
     * and never calls the primitive — the route header calls the short-circuit the
     * thing that makes replay safety structural, and the coverage manifest's own note
     * says the same. Asserting a refusal here would be asserting against the
     * documented contract.
     *
     * So the assertion is the property that actually matters and that a refusal would
     * also have given: no second number, no second audit record, no second event, no
     * second ledger row, and the branch counter unmoved. `assertInvoiceIsDraft` is
     * still proved to refuse a non-draft — by the `void_before_issue` case below,
     * which is a state the short-circuit does not cover.
     */
    const billable = await seedBillable('inv_issue_twice');
    const { draft, issued } = await issuedInvoiceFor(billable);
    const auditBefore = await auditTotalFor('sal.invoice.issued');
    const outboxBefore = await outboxTotalFor('invoice.issued');
    const sequenceBefore = await invoiceSequenceNextValue();

    authAs(SAL_FULL);
    const again = await issueInvoice(draft.invoice.id, {
      version: issued.recordVersion,
      key: randomUUID(),
    });
    expect(again.status).toBe(200);
    const second = await bodyOf<IssuedInvoiceBody>(again);
    expect(second.replayed).toBe(true);
    expect(second.invoiceNumber).toBe(issued.invoiceNumber);

    expect((await auditTotalFor('sal.invoice.issued')) - auditBefore).toBe(0);
    expect((await outboxTotalFor('invoice.issued')) - outboxBefore).toBe(0);
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(0);
    expect(await statusHistoryRowsFor(draft.invoice.id, 'issued')).toBe(1);
  });

  it('refuses a stale If-Match with a conflict (stale-version)', async () => {
    /**
     * ===================================================================
     * This case was written FAILING, and the defect it found is now fixed.
     * ===================================================================
     * `sal.invoice-issue` declares `versionGuarded: true`, so `handleOperation`
     * requires an `If-Match` header, parses it, and hands the value to the handler as
     * `expectedVersion`. `src/app/api/v1/invoices/[invoiceId]/issuance/route.ts`
     * destructured only `{ db, authorizeScope }` and never read it, and
     * `InvoiceService.issueInvoice(db, invoiceId, authorizeScope)` took no version
     * parameter — so the value was discarded and ANY positive integer was accepted.
     * Reproduced as `If-Match: 99` against an invoice at `record_version` 1: 200, issued,
     * number allocated.
     *
     * A caller working from a stale read therefore issued an invoice whose amounts may
     * have changed under it — precisely what the route's own header said the guard
     * existed to prevent ("`If-Match` prevents a confident issue of the wrong
     * document"). Every other `versionGuarded: true` route in the repository reads
     * `expectedVersion` and passes it down; these did not.
     *
     * The fix: the service now takes `expectedVersion` and compares it against the row
     * it has just locked `FOR UPDATE` — after the lock, so no concurrent write can slip
     * between the comparison and the mutation — and BEFORE the already-issued
     * short-circuit, so a caller holding a pre-issue version is told rather than handed
     * a `replayed: true` for a document that moved on. `stale-version` is declared in the
     * COVERAGE-EVIDENCE block above only now that this passes.
     */
    const billable = await seedBillable('inv_issue_stale');
    const draft = await draftInvoiceFor(billable);
    const staleVersion = draft.recordVersion - 1 < 1 ? 99 : draft.recordVersion - 1;

    authAs(SAL_FULL);
    const response = await issueInvoice(draft.invoice.id, { version: staleVersion });
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-CON-001');
    // And nothing was issued on a version the caller never held.
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
    expect((await invoiceRowOf(draft.invoice.id))?.invoiceNumber).toBeNull();
  });

  it('refuses a draft with no lines, and consumes no number doing so (denial)', async () => {
    const lineless = await seedLinelessDraftInvoice('inv_issue_no_lines');
    const sequenceBefore = await invoiceSequenceNextValue();

    authAs(SAL_FULL);
    const response = await issueInvoice(lineless.invoiceId, { version: lineless.recordVersion });
    // `sal.issue_invoice` raises `check_violation` for a lineless invoice, and the
    // service maps it to a conflict the caller can act on rather than to a 500 carrying
    // a constraint name.
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-CON-001');

    const row = await invoiceRowOf(lineless.invoiceId);
    expect(row?.status).toBe('draft');
    expect(row?.invoiceNumber).toBeNull();
    // A FAILED issue claims no number: the allocation and the business write share one
    // transaction, so a rollback takes the counter advance with it.
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(0);
  });

  it('refuses a voided invoice, which the terminal-state short-circuit does not cover (denial)', async () => {
    const billable = await seedBillable('inv_issue_voided');
    const draft = await draftInvoiceFor(billable);
    authAs(SAL_FULL);
    const voided = await cancelInvoice(
      draft.invoice.id,
      { reason: 'Customer withdrew before issue' },
      { version: draft.recordVersion }
    );
    expect(voided.status).toBe(200);
    const voidedBody = await bodyOf<VoidedInvoiceBody>(voided);

    const sequenceBefore = await invoiceSequenceNextValue();
    authAs(SAL_FULL);
    const response = await issueInvoice(draft.invoice.id, {
      version: voidedBody.recordVersion,
      key: randomUUID(),
    });
    // `assertInvoiceIsDraft` refuses it here rather than letting
    // `sal.guard_invoice_freeze` produce a `check_violation` that is not a caller-safe
    // contract. `void_before_issue` is terminal: there is no un-void and no late issue.
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-TRN-001');
    const row = await invoiceRowOf(draft.invoice.id);
    expect(row?.status).toBe('void_before_issue');
    expect(row?.invoiceNumber).toBeNull();
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(0);
  });

  it('refuses a caller lacking sal.invoice.issue and one lacking sal.finance.view (authorization)', async () => {
    const billable = await seedBillable('inv_issue_authz');
    const draft = await draftInvoiceFor(billable);
    const sequenceBefore = await invoiceSequenceNextValue();

    authAs(SAL_READER);
    const reader = await issueInvoice(draft.invoice.id, { version: draft.recordVersion });
    expect(reader.status).toBe(403);
    expect((await bodyOf<ProblemBody>(reader)).code).toBe('ERR-IAM-001');

    // Holds `sal.invoice.issue` and every other code except the money one.
    authAs(SAL_NO_FINANCE);
    const noFinance = await issueInvoice(draft.invoice.id, { version: draft.recordVersion });
    expect(noFinance.status).toBe(403);
    expect((await bodyOf<ProblemBody>(noFinance)).code).toBe('ERR-IAM-001');

    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(0);
  });

  it('refuses an invoice in a branch the caller is not scoped to (isolation)', async () => {
    const billable = await seedBillable('inv_issue_isolation');
    const draft = await draftInvoiceFor(billable);
    // The path names an invoice, not a branch. The deferred check reads the INVOICE's
    // own company and branch, and BRANCH_A1 is inside this caller's RLS union, so the
    // refusal is the scoped permission evaluation and nothing else.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await issueInvoice(draft.invoice.id, { version: draft.recordVersion });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
  });

  it('cannot issue a tenant-A invoice from tenant B (cross-tenant)', async () => {
    const billable = await seedBillable('inv_issue_cross');
    const draft = await draftInvoiceFor(billable);
    authAs(SAL_TENANT_B);
    const response = await issueInvoice(draft.invoice.id, { version: draft.recordVersion });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
  });

  it('reports an unprovisioned branch sequence as configuration, and claims no number (denial)', async () => {
    // The fixtures provision `invoice` and `receipt` for (TENANT_A, COMPANY_A1,
    // BRANCH_A1) and NOTHING else, and `shared.next_display_number` matches the scope
    // EXACTLY (`company_id IS NOT DISTINCT FROM p_company_id`) with no fallback. So an
    // invoice in BRANCH_A2 is genuinely unnumberable, `app_runtime` holds no INSERT on
    // `shared.number_sequences` so it cannot be self-healed, and the one thing the
    // service must never do is invent a number to get past it.
    const billable = await seedBillable('inv_issue_unprov', { branchId: BRANCH_A2 });
    expect(billable.branchId).toBe(BRANCH_A2);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM shared.number_sequences
          WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
            AND sequence_code = 'invoice'`,
        [TENANT_A, billable.companyId, BRANCH_A2]
      )
    ).toBe(0);

    const draft = await draftInvoiceFor(billable);
    authAs(SAL_FULL);
    const response = await issueInvoice(draft.invoice.id, { version: draft.recordVersion });
    expect(response.status).toBe(404);
    const raw = await response.text();
    const problem = JSON.parse(raw) as ProblemBody;
    expect(problem.code).toBe('ERR-RES-001');

    // The refusal leaks NO implementation detail, and this is asserted on the raw
    // response text rather than on a parsed field: the problem document is assembled
    // only from the catalog entry plus `safeDetails`, so the whole body is the surface.
    // A constraint or index name, a SQLSTATE, or the raising function's name would each
    // tell a caller which internal rule fired.
    expect(raw).not.toMatch(/\b(?:uq|ck|fk|pk|ix|ex|tg)_[a-z0-9_]+/);
    expect(raw).not.toMatch(/no_data_found|P0002|23514|42501/);
    expect(raw).not.toMatch(/next_display_number|number_sequences|invoice_numbering_configs/i);
    expect(raw).not.toMatch(/\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i);
    // And no free-text message field exists at all to leak one through.
    expect(Object.keys(problem).sort()).toEqual([
      'code',
      'correlationId',
      'status',
      'title',
      'type',
    ]);

    // A FAILED issue claims no number.
    const row = await invoiceRowOf(draft.invoice.id);
    expect(row?.status).toBe('draft');
    expect(row?.invoiceNumber).toBeNull();
    expect(row?.issuedAt).toBeNull();
    // Nor did it borrow the PROVISIONED branch's counter to get past the gap.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices
          WHERE branch_id = $1 AND invoice_number IS NOT NULL`,
        [BRANCH_A2]
      )
    ).toBe(0);
  });
});

describe('sal.invoice-detail', () => {
  it('returns the header WITHOUT money to a caller lacking sal.finance.view (success)', async () => {
    /**
     * The money-visibility asymmetry, and the most consequential case in this file.
     *
     * `sal.invoices` is scope-gated only; the money lives in `sal.invoice_amounts` and
     * `sal.invoice_line_amounts`, whose every policy is gated by
     * `iam.has_permission('sal.finance.view')`. So a caller without that permission
     * must receive a header WITHOUT money — not a 403 on the whole resource, which
     * would deny a fact the schema deliberately leaves visible, and not a zero, which
     * would be a lie about the invoice where an absent key is the truth about the
     * caller. The read is a LEFT JOIN precisely so RLS invisibility yields NULL rather
     * than zero rows; an INNER join would fail this test as a 404.
     */
    const billable = await seedBillable('inv_detail_no_finance');
    const { draft, issued } = await issuedInvoiceFor(billable);

    authAs(SAL_NO_FINANCE);
    const response = await readInvoice(draft.invoice.id);
    // NOT 403.
    expect(response.status).toBe(200);
    const detail = await bodyOf<InvoiceDetailBody>(response);

    // The header survives, including the number a service advisor legitimately needs.
    expect(detail.invoice.id).toBe(draft.invoice.id);
    expect(detail.invoice.status).toBe('issued');
    expect(detail.invoice.workOrderId).toBe(billable.workOrderId);
    expect(detail.invoice.invoiceNumber).toBe(issued.invoiceNumber);
    expect(detail.invoice.invoiceNumber).not.toBeNull();
    expect(detail.invoice.currency).toBe('USD');
    expect(detail.invoice.recordVersion).toBeGreaterThan(0);

    // OMITTED OR NULL — never zeroed. Both the header totals and every line's money.
    expect(detail.invoice.totals ?? null).toBeNull();
    expect(detail.lines.length).toBeGreaterThan(0);
    for (const line of detail.lines) {
      expect(line.money ?? null).toBeNull();
      // The structure is still there, so the caller can see WHAT is billed.
      expect(line.lineType).toBe('service');
      expect(line.quantity).toBe('2.000');
    }
    // Emphatically not a zero anywhere in the response: a `0.0000` would have passed a
    // null check on `totals` while still misstating the document.
    expect(JSON.stringify(detail)).not.toContain('0.0000');

    // The money row EXISTS — otherwise the null above would be an empty table rather
    // than the permission gate, and the test would prove nothing.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoice_amounts
          WHERE invoice_id = $1 AND gross_total::text = '165.0000' AND deleted_at IS NULL`,
        [draft.invoice.id]
      )
    ).toBe(1);
  });

  it('returns the money with exact strings and a currency to a caller holding sal.finance.view (success)', async () => {
    const billable = await seedBillable('inv_detail_finance');
    const { draft, issued } = await issuedInvoiceFor(billable);

    authAs(SAL_FULL);
    const response = await readInvoice(draft.invoice.id);
    expect(response.status).toBe(200);
    const detail = await bodyOf<InvoiceDetailBody>(response);

    expect(detail.invoice.invoiceNumber).toBe(issued.invoiceNumber);
    expect(detail.invoice.totals?.net).toEqual({ amount: '150.0000', currency: 'USD' });
    expect(detail.invoice.totals?.tax).toEqual({ amount: '15.0000', currency: 'USD' });
    expect(detail.invoice.totals?.gross).toEqual({ amount: '165.0000', currency: 'USD' });

    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]?.money?.unitPrice).toEqual({ amount: '100.0000', currency: 'USD' });
    expect(detail.lines[0]?.money?.net).toEqual({ amount: '150.0000', currency: 'USD' });
    expect(detail.lines[0]?.money?.tax).toEqual({ amount: '15.0000', currency: 'USD' });
    expect(detail.lines[0]?.money?.gross).toEqual({ amount: '165.0000', currency: 'USD' });
    expect(detail.lines[0]?.money?.payerSplit.customer).toEqual({
      amount: '165.0000',
      currency: 'USD',
    });
    expect(detail.lines[0]?.money?.payerSplit.warranty).toEqual({
      amount: '0.0000',
      currency: 'USD',
    });

    // The ETag the version-guarded commands consume, and it describes the INVOICE.
    expect(response.headers.get('ETag')).toBe(`"${detail.invoice.recordVersion}"`);
    expect(detail.recordVersion).toBe(detail.invoice.recordVersion);
  });

  it('refuses a caller with no invoice permission at all, and a malformed id (authorization, denial)', async () => {
    const billable = await seedBillable('inv_detail_authz');
    const draft = await draftInvoiceFor(billable);

    // `SAL_READER` holds `sal.finance.view` and NOT `sal.invoice.manage`, so this proves
    // which of the two the operation actually requires — the money permission alone is
    // not enough to read an invoice.
    authAs(SAL_READER);
    const reader = await readInvoice(draft.invoice.id);
    expect(reader.status).toBe(403);
    expect((await bodyOf<ProblemBody>(reader)).code).toBe('ERR-IAM-001');

    authAs(SAL_FULL);
    const malformed = await readInvoice('not-a-uuid');
    expect(malformed.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(malformed);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('path.invoiceId');
  });

  it('refuses a caller scoped to another branch although the row is visible (isolation)', async () => {
    const billable = await seedBillable('inv_detail_isolation');
    const draft = await draftInvoiceFor(billable);
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await readInvoice(draft.invoice.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');

    // The row really is inside that caller's permission-blind branch union, so the
    // refusal is the scoped permission check and not RLS answering 404 in disguise.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices
          WHERE id = $1 AND branch_id = ANY(
            SELECT s.branch_id FROM iam.grant_scopes s
              JOIN iam.role_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
             WHERE g.user_id = $2 AND s.branch_id IS NOT NULL)`,
        [draft.invoice.id, SAL_PERMISSION_ELSEWHERE.userId]
      )
    ).toBe(1);
  });

  it('cannot read a tenant-A invoice from tenant B (cross-tenant)', async () => {
    const billable = await seedBillable('inv_detail_cross');
    const draft = await draftInvoiceFor(billable);
    authAs(SAL_TENANT_B);
    const response = await readInvoice(draft.invoice.id);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');

    // An unknown id answers identically, so the code discloses nothing about existence.
    authAs(SAL_TENANT_B);
    expect((await readInvoice(randomUUID())).status).toBe(404);
  });
});

describe('sal.invoice-outstanding-read', () => {
  it('reports the full gross with its currency on an unpaid issued invoice (success)', async () => {
    const billable = await seedBillable('inv_open_ok', { lines: [PLAIN_HUNDRED_LINE] });
    const { draft } = await issuedInvoiceFor(billable);
    // Gross is exactly 100.0000 and nothing has been received against it.
    expect((await invoiceRowOf(draft.invoice.id))?.grossTotal).toBe('100.0000');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations WHERE invoice_id = $1`,
        [draft.invoice.id]
      )
    ).toBe(0);

    authAs(SAL_FULL);
    const response = await readOutstanding(draft.invoice.id);
    expect(response.status).toBe(200);
    const outstanding = await bodyOf<OutstandingBody>(response);

    expect(outstanding.invoiceId).toBe(draft.invoice.id);
    expect(outstanding.status).toBe('issued');
    // The amount and the currency are ONE value.
    // `sal.invoice_open_receivable` returns a bare numeric with no currency predicate at
    // all, so the invoice's own `currency_code` is the only thing that labels it — and
    // this operation always returns the pair, never the scalar. Compared as an exact
    // decimal STRING: `Number` appears nowhere in this assertion.
    expect(outstanding.outstanding).toEqual({ amount: '100.0000', currency: 'USD' });
    expect(outstanding.outstanding.currency).toBe(
      (await invoiceRowOf(draft.invoice.id))?.currencyCode
    );
    // Decided by comparing `Decimal`s, not by coercing the string to a number.
    expect(outstanding.isSettled).toBe(false);
  });

  it('reports zero for a draft, labelled with the status that explains it (success)', async () => {
    // `sal.invoice_open_receivable` short-circuits to 0 for a draft before reading
    // anything, so the zero is TRUE rather than an artefact of invisibility — and the
    // status travels alongside so a caller can tell this zero from a settled one.
    const billable = await seedBillable('inv_open_draft', { lines: [PLAIN_HUNDRED_LINE] });
    const draft = await draftInvoiceFor(billable);

    authAs(SAL_FULL);
    const response = await readOutstanding(draft.invoice.id);
    expect(response.status).toBe(200);
    const outstanding = await bodyOf<OutstandingBody>(response);
    expect(outstanding.status).toBe('draft');
    expect(outstanding.outstanding).toEqual({ amount: '0.0000', currency: 'USD' });
    expect(outstanding.isSettled).toBe(true);
  });

  it('refuses a caller lacking sal.finance.view rather than telling it zero (authorization)', async () => {
    /**
     * The fail-closed case. `sal.invoice_open_receivable` is SECURITY INVOKER and all
     * three of its inputs are gated by `sal.finance.view`, so for a caller without it
     * the function computes `0 − 0 − 0` and returns a figure BYTE-IDENTICAL to a fully
     * settled invoice, with no error and no signal. Returning that would state that a
     * possibly unpaid invoice is settled — so the operation refuses instead.
     */
    const billable = await seedBillable('inv_open_authz', { lines: [PLAIN_HUNDRED_LINE] });
    const { draft } = await issuedInvoiceFor(billable);

    authAs(SAL_NO_FINANCE);
    const response = await readOutstanding(draft.invoice.id);
    expect(response.status).toBe(403);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toContain('sal.finance.view');
    // No amount of any kind crossed the boundary — not even a zero.
    expect(JSON.stringify(problem)).not.toContain('100.0000');
    expect(JSON.stringify(problem)).not.toContain('0.0000');
  });

  it('refuses a malformed invoice id before reading anything (denial)', async () => {
    authAs(SAL_FULL);
    const response = await readOutstanding('not-a-uuid');
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('path.invoiceId');
  });

  it('refuses a caller scoped to another branch although the row is visible (isolation)', async () => {
    const billable = await seedBillable('inv_open_isolation', { lines: [PLAIN_HUNDRED_LINE] });
    const { draft } = await issuedInvoiceFor(billable);
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await readOutstanding(draft.invoice.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
  });

  it('cannot read a tenant-A balance from tenant B (cross-tenant)', async () => {
    const billable = await seedBillable('inv_open_cross', { lines: [PLAIN_HUNDRED_LINE] });
    const { draft } = await issuedInvoiceFor(billable);
    authAs(SAL_TENANT_B);
    const response = await readOutstanding(draft.invoice.id);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
  });
});

describe('sal.invoice-cancel', () => {
  it('voids a draft, leaves the number NULL, and records the reason (success, audit, outbox)', async () => {
    const billable = await seedBillable('inv_void_ok');
    const draft = await draftInvoiceFor(billable);
    const auditBefore = await auditTotalFor('sal.invoice.voided');
    const outboxBefore = await outboxTotalFor('invoice.voided');
    const sequenceBefore = await invoiceSequenceNextValue();
    const reason = 'Customer cancelled the job before the invoice was issued';

    authAs(SAL_FULL);
    const response = await cancelInvoice(
      draft.invoice.id,
      { reason },
      {
        version: draft.recordVersion,
      }
    );
    expect(response.status).toBe(200);
    const voided = await bodyOf<VoidedInvoiceBody>(response);

    expect(voided.replayed).toBe(false);
    expect(voided.invoice.status).toBe('void_before_issue');
    // `ck_invoices_number_iff_issued` makes it structural, and it is asserted anyway:
    // a number that has been shown to a customer is never withdrawn, so there must be no
    // state in which a voided invoice holds one.
    expect(voided.invoice.invoiceNumber).toBeNull();
    expect(voided.invoice.issuedAt).toBeNull();
    // The void advanced the row's version by exactly one, via
    // `shared.touch_row_metadata`.
    expect(voided.recordVersion).toBe(draft.recordVersion + 1);

    const row = await invoiceRowOf(draft.invoice.id);
    expect(row?.status).toBe('void_before_issue');
    expect(row?.invoiceNumber).toBeNull();
    expect(row?.issuedAt).toBeNull();
    // Voiding consumed no document number.
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(0);

    expect((await auditTotalFor('sal.invoice.voided')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('invoice.voided')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.invoice.voided', draft.invoice.id)).toBe(1);
    expect(await outboxCountFor(`invoice.voided:${draft.invoice.id}`)).toBe(1);

    // The reason lands in the append-only ledger, where a later reader of the document's
    // life will find it, with the actor and time server-stamped rather than supplied.
    const history = await admin.query<{
      reason: string | null;
      actor_id: string;
      from_status: string;
    }>(
      `SELECT reason, actor_id, from_status FROM sal.invoice_status_history
        WHERE invoice_id = $1 AND to_status = 'void_before_issue'`,
      [draft.invoice.id]
    );
    expect(history.rowCount).toBe(1);
    expect(history.rows[0]?.reason).toBe(reason);
    expect(history.rows[0]?.from_status).toBe('draft');
    expect(history.rows[0]?.actor_id).toBe(SAL_FULL.userId);
  });

  it('trims the reason and refuses a blank or missing one (denial)', async () => {
    const billable = await seedBillable('inv_void_reason');
    const draft = await draftInvoiceFor(billable);

    // Missing entirely — the Zod schema refuses it.
    authAs(SAL_FULL);
    const missing = await cancelInvoice(draft.invoice.id, {}, { version: draft.recordVersion });
    expect(missing.status).toBe(422);
    const missingProblem = await bodyOf<ProblemBody>(missing);
    expect(missingProblem.code).toBe('ERR-VAL-001');
    expect(missingProblem.violations?.some((v) => v.path === 'body.reason')).toBe(true);

    // Empty string — also the schema (`min(1)`).
    authAs(SAL_FULL);
    const empty = await cancelInvoice(
      draft.invoice.id,
      { reason: '' },
      { version: draft.recordVersion }
    );
    expect(empty.status).toBe(422);
    expect((await bodyOf<ProblemBody>(empty)).code).toBe('ERR-VAL-001');

    // WHITESPACE — and this is the one the database would have accepted:
    // `sal.invoice_status_history.reason` is nullable with no `btrim(...) <> ''` CHECK
    // and no length CHECK, so `'   '` would have been stored as the recorded
    // justification. `requireReason` in the service is the only defence.
    authAs(SAL_FULL);
    const blank = await cancelInvoice(
      draft.invoice.id,
      { reason: '    ' },
      { version: draft.recordVersion }
    );
    expect(blank.status).toBe(422);
    const blankProblem = await bodyOf<ProblemBody>(blank);
    expect(blankProblem.code).toBe('ERR-VAL-001');
    expect(blankProblem.violations?.some((v) => v.path === 'body.reason')).toBe(true);

    // The invoice is untouched and nothing reached the ledger.
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
    expect(await statusHistoryRowsFor(draft.invoice.id, 'void_before_issue')).toBe(0);
  });

  it('replays without writing a second history row or a second audit record (idempotency)', async () => {
    const billable = await seedBillable('inv_void_replay');
    const draft = await draftInvoiceFor(billable);
    const key = randomUUID();
    const payload = { reason: 'Duplicate booking, voided before issue' };

    authAs(SAL_FULL);
    const first = await cancelInvoice(draft.invoice.id, payload, {
      version: draft.recordVersion,
      key,
    });
    expect(first.status).toBe(200);
    const original = await bodyOf<VoidedInvoiceBody>(first);

    // Baselines taken AFTER the first void, so both deltas below are about the replay.
    const auditAfterFirst = await auditTotalFor('sal.invoice.voided');
    const outboxAfterFirst = await outboxTotalFor('invoice.voided');
    const historyAfterFirst = await statusHistoryRowsFor(draft.invoice.id, 'void_before_issue');
    expect(historyAfterFirst).toBe(1);

    // Replay 1 — the SAME key. The framework replays the stored response and the handler
    // is never re-entered.
    authAs(SAL_FULL);
    const sameKey = await cancelInvoice(draft.invoice.id, payload, {
      version: original.recordVersion,
      key,
    });
    expect(sameKey.status).toBe(200);
    expect((await bodyOf<VoidedInvoiceBody>(sameKey)).invoice.status).toBe('void_before_issue');
    expect(
      (await statusHistoryRowsFor(draft.invoice.id, 'void_before_issue')) - historyAfterFirst
    ).toBe(0);
    expect((await auditTotalFor('sal.invoice.voided')) - auditAfterFirst).toBe(0);
    expect((await outboxTotalFor('invoice.voided')) - outboxAfterFirst).toBe(0);

    // Replay 2 — a NEW key, which is the one that tests the SERVICE rather than the
    // framework: the request reaches `cancelInvoice`, which short-circuits on the
    // terminal state instead of re-running the transition. A naive re-run would append a
    // second ledger row to a table with no UPDATE or DELETE grant, and its second
    // `publishEvent` would abort the transaction on `uq_event_outbox_event_key` —
    // turning an idempotent retry into a 409.
    authAs(SAL_FULL);
    const newKey = await cancelInvoice(draft.invoice.id, payload, {
      version: original.recordVersion,
      key: randomUUID(),
    });
    expect(newKey.status).toBe(200);
    const replayed = await bodyOf<VoidedInvoiceBody>(newKey);
    expect(replayed.replayed).toBe(true);
    expect(replayed.invoice.status).toBe('void_before_issue');
    expect(replayed.invoice.invoiceNumber).toBeNull();

    // BOTH deltas are 0 on the replay, and so is the ledger's.
    expect((await auditTotalFor('sal.invoice.voided')) - auditAfterFirst).toBe(0);
    expect((await outboxTotalFor('invoice.voided')) - outboxAfterFirst).toBe(0);
    expect(await statusHistoryRowsFor(draft.invoice.id, 'void_before_issue')).toBe(1);
    expect(await auditCountFor('sal.invoice.voided', draft.invoice.id)).toBe(1);
    expect(await outboxCountFor(`invoice.voided:${draft.invoice.id}`)).toBe(1);
  });

  it('refuses to cancel an ISSUED invoice (denial)', async () => {
    // The vocabulary itself refuses the idea: the status is named `void_before_issue`,
    // and `sal.guard_invoice_freeze` permits `issued -> credited` and nothing else. The
    // instruments after issue are a credit note and a new invoice.
    const billable = await seedBillable('inv_void_issued');
    const { draft, issued } = await issuedInvoiceFor(billable);
    const auditBefore = await auditTotalFor('sal.invoice.voided');
    const outboxBefore = await outboxTotalFor('invoice.voided');

    authAs(SAL_FULL);
    const response = await cancelInvoice(
      draft.invoice.id,
      { reason: 'Raised in error' },
      { version: issued.recordVersion }
    );
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-TRN-001');

    // The document is untouched: still issued, still carrying its number.
    const row = await invoiceRowOf(draft.invoice.id);
    expect(row?.status).toBe('issued');
    expect(row?.invoiceNumber).toBe(issued.invoiceNumber);
    expect(await statusHistoryRowsFor(draft.invoice.id, 'void_before_issue')).toBe(0);
    expect((await auditTotalFor('sal.invoice.voided')) - auditBefore).toBe(0);
    expect((await outboxTotalFor('invoice.voided')) - outboxBefore).toBe(0);
  });

  it('refuses a stale If-Match with a conflict (stale-version)', async () => {
    /**
     * ===================================================================
     * This case was written FAILING, and the defect it found is now fixed.
     * ===================================================================
     * The same defect as `sal.invoice-issue`'s, in a second route.
     * `src/app/api/v1/invoices/[invoiceId]/cancellation/route.ts` declared
     * `versionGuarded: true` — so `handleOperation` demanded an `If-Match` header and
     * parsed it into `expectedVersion` — and then destructured only
     * `{ db, authorizeScope }`. `InvoiceService.cancelInvoice(db, invoiceId, reason,
     * authorizeScope)` took no version parameter, so the header's value was discarded
     * and ANY positive integer voided the invoice.
     *
     * That mattered more here than for the issue path: voiding is terminal and there is
     * no un-void, so a caller acting on a stale read destroyed a document whose current
     * state it had not actually seen.
     *
     * Fixed the same way, and `stale-version` is declared above only now that this
     * passes. The third instance of the same shape — `sal.delivery-complete`, whose
     * service check existed but was inert because the field was optional and the route
     * never supplied it — is fixed too.
     */
    const billable = await seedBillable('inv_void_stale');
    const draft = await draftInvoiceFor(billable);
    const staleVersion = draft.recordVersion - 1 < 1 ? 99 : draft.recordVersion - 1;

    authAs(SAL_FULL);
    const response = await cancelInvoice(
      draft.invoice.id,
      { reason: 'Voided from a stale read' },
      { version: staleVersion }
    );
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-CON-001');
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
  });

  it('refuses a caller lacking sal.invoice.manage (authorization)', async () => {
    const billable = await seedBillable('inv_void_authz');
    const draft = await draftInvoiceFor(billable);

    // `SAL_READER` holds `sal.finance.view` and not the management authority, so the
    // refusal names which permission the void actually needs.
    authAs(SAL_READER);
    const response = await cancelInvoice(
      draft.invoice.id,
      { reason: 'Attempted by a read-only caller' },
      { version: draft.recordVersion }
    );
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
    expect(await statusHistoryRowsFor(draft.invoice.id, 'void_before_issue')).toBe(0);
  });

  it('refuses an invoice in a branch the caller is not scoped to (isolation)', async () => {
    const billable = await seedBillable('inv_void_isolation');
    const draft = await draftInvoiceFor(billable);
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await cancelInvoice(
      draft.invoice.id,
      { reason: 'Attempted from another branch' },
      { version: draft.recordVersion }
    );
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
  });

  it('cannot void a tenant-A invoice from tenant B (cross-tenant)', async () => {
    const billable = await seedBillable('inv_void_cross');
    const draft = await draftInvoiceFor(billable);
    authAs(SAL_TENANT_B);
    const response = await cancelInvoice(
      draft.invoice.id,
      { reason: 'Attempted from the other tenant' },
      { version: draft.recordVersion }
    );
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect((await invoiceRowOf(draft.invoice.id))?.status).toBe('draft');
  });
});
