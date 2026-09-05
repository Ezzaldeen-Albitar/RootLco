/**
 * P1-30 W6 — the invoice contract the frontend consumes (FE-014 preview,
 * FE-015 issue and cancel, FE-019 outstanding balance, FE-020 print).
 *
 * The invoice screen renders four reads and three writes. This suite proves, on
 * the SHIPPED routes, the exact properties the screen relies on and states to
 * the operator — the routes' full behaviour belongs to the P1-22 suites
 * (`p1-22-invoice-lifecycle`, `p1-22-isolation`, `p1-22-credit-note`) and the A2
 * seam suite (`p1-30-a2-published-reads`).
 *
 * ## What the screen says, and where each statement is proved here
 *
 * - "`sal.finance.view` splits the screen": the detail and the work-order read
 *   answer a caller without the code with the header intact and `totals` /
 *   line `money` as `null` — the body carries no `0.0000`; the preview and the
 *   outstanding read of an issued invoice REFUSE that caller (403 naming the
 *   code) rather than answer a zero.
 * - "No accepted quotation revision, so nothing to bill yet": the preview is
 *   404 for an undecided revision, never a zero preview.
 * - "Issue is version-guarded": issuing carries `If-Match` = the INVOICE's
 *   `recordVersion` from the detail; a missing one is 428, a stale one 409 and
 *   the invoice stays a draft; the right one allocates a number.
 * - "Already issued / already cancelled; nothing changed": a NEW transport key
 *   against an invoice already past `draft` answers `replayed: true`; a SAME
 *   key replays the stored answer (status 200) whose `replayed` is false — the
 *   two are asserted apart, because the screen must not confuse them.
 * - "The work order may already have an invoice": a second create under a new
 *   key is 409 and the work-order read then names the invoice that exists.
 * - "Cancelled; the work order can be invoiced again": after a void the
 *   work-order read answers `null` and the preview still answers.
 * - Every money figure is asserted as a LITERAL string beside its currency;
 *   nothing is computed in this file.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.work-order-invoice-read: route service authorization success denial cross-tenant
 *   sal.invoice-preview: route service authorization success denial cross-tenant
 *   sal.invoice-detail: route service authorization success denial cross-tenant
 *   sal.invoice-outstanding-read: route service authorization success denial
 *   sal.invoice-create: route service authorization success denial idempotency
 *   sal.invoice-issue: route service authorization success denial idempotency stale-version
 *   sal.invoice-cancel: route service authorization success denial idempotency stale-version
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  PARTNER_A,
  SAL_FULL,
  SAL_NO_FINANCE,
  SAL_READER,
  SAL_TENANT_B,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedWorkOrderChain,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as PREVIEW } from '@/app/api/v1/work-orders/[workOrderId]/invoice-preview/route';
import { GET as WORK_ORDER_INVOICE } from '@/app/api/v1/work-orders/[workOrderId]/invoice/route';
import { POST as CREATE } from '@/app/api/v1/invoices/route';
import { GET as DETAIL } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as ISSUE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { GET as OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import { POST as CANCEL } from '@/app/api/v1/invoices/[invoiceId]/cancellation/route';

let admin: Pool;

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}
interface InvoiceBody {
  readonly id: string;
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
interface LineBody {
  readonly lineNumber: number;
  readonly lineType: string;
  readonly quantity: string;
  readonly sourceQuotationItemId: string | null;
  readonly money: { readonly unitPrice: MoneyBody; readonly gross: MoneyBody } | null;
}
interface DetailBody {
  readonly invoice: InvoiceBody;
  readonly lines: readonly LineBody[];
  readonly recordVersion: number;
}
interface CreatedBody extends DetailBody {
  readonly replayed: boolean;
}
interface IssuedBody {
  readonly invoice: InvoiceBody;
  readonly invoiceNumber: string;
  readonly replayed: boolean;
  readonly recordVersion: number;
}
interface VoidedBody {
  readonly invoice: InvoiceBody;
  readonly replayed: boolean;
  readonly recordVersion: number;
}
interface PreviewBody {
  readonly quotationRevisionId: string;
  readonly currency: string;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly netTotal: string;
  readonly grossTotal: string;
  readonly lines: readonly {
    readonly sourceQuotationItemId: string;
    readonly lineNumber: number;
    readonly description: string | null;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly discount: string;
    readonly taxRate: string;
    readonly grossAmount: string;
  }[];
}
interface OutstandingBody {
  readonly invoiceId: string;
  readonly status: string;
  readonly outstanding: MoneyBody;
  readonly isSettled: boolean;
}
interface ProblemBody {
  readonly code: string;
  readonly requiredPermissions?: readonly string[];
  readonly safeDetails?: { readonly requiredPermissions?: readonly string[] };
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  (await bodyOf<ProblemBody>(response)).code;

const preview = (workOrderId: string): Promise<Response> =>
  PREVIEW(new Request(`http://localhost/api/v1/work-orders/${workOrderId}/invoice-preview`), {
    params: Promise.resolve({ workOrderId }),
  });
const workOrderInvoice = (workOrderId: string): Promise<Response> =>
  WORK_ORDER_INVOICE(new Request(`http://localhost/api/v1/work-orders/${workOrderId}/invoice`), {
    params: Promise.resolve({ workOrderId }),
  });
const create = (payload: unknown, key = randomUUID()): Promise<Response> =>
  CREATE(
    new Request('http://localhost/api/v1/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(payload),
    })
  );
const detail = (invoiceId: string): Promise<Response> =>
  DETAIL(new Request(`http://localhost/api/v1/invoices/${invoiceId}`), {
    params: Promise.resolve({ invoiceId }),
  });
const outstanding = (invoiceId: string): Promise<Response> =>
  OUTSTANDING(new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`), {
    params: Promise.resolve({ invoiceId }),
  });
const issue = (
  invoiceId: string,
  options: { readonly version?: number; readonly key?: string } = {}
): Promise<Response> =>
  ISSUE(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/issuance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? randomUUID(),
        ...(options.version === undefined ? {} : { 'if-match': String(options.version) }),
      },
    }),
    { params: Promise.resolve({ invoiceId }) }
  );
const cancel = (
  invoiceId: string,
  payload: unknown,
  options: { readonly version?: number; readonly key?: string } = {}
): Promise<Response> =>
  CANCEL(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/cancellation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? randomUUID(),
        ...(options.version === undefined ? {} : { 'if-match': String(options.version) }),
      },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

/* ------------------------------------------------------------------ *
 * The accepted-quotation fixture, reproduced from the P1-22 lifecycle suite
 * (it is local there). Every captured amount is computed by PostgreSQL inside
 * the INSERT, in the CHECK constraints' own expressions — never here.
 * ------------------------------------------------------------------ */

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

/** 100.0000 × 2.000 = 200.0000; less 50.0000 = 150.0000 net; tax 0.100000 on the net = 15.0000; gross 165.0000. */
const LINE = {
  unitPrice: '100.0000',
  quantity: '2.000',
  discount: '0050.0000',
  taxRate: '0.100000',
};

interface Billable {
  readonly workOrderId: string;
  readonly revisionId: string;
  readonly itemId: string;
}

async function seedBillable(
  tag: string,
  decision: 'approved' | 'none' = 'approved'
): Promise<Billable> {
  const chain = await seedWorkOrderChain(tag);
  return inTenantTransaction(async (client) => {
    const quotation = await client.query<{ id: string }>(
      `INSERT INTO quo.quotations
         (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code,
          payer_partner_ref, created_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6,$7) RETURNING id`,
      [
        TENANT_A,
        chain.companyId,
        chain.branchId,
        chain.workOrderId,
        `FXQ-${tag}`,
        PARTNER_A,
        USER_A,
      ]
    );
    const quotationId = quotation.rows[0]?.id ?? '';
    const revision = await client.query<{ id: string }>(
      `INSERT INTO quo.quotation_revisions
         (tenant_id, company_id, branch_id, quotation_id, revision_number, currency_code, created_by)
       VALUES ($1,$2,$3,$4,1,'USD',$5) RETURNING id`,
      [TENANT_A, chain.companyId, chain.branchId, quotationId, USER_A]
    );
    const revisionId = revision.rows[0]?.id ?? '';
    const item = await client.query<{ id: string }>(
      `INSERT INTO quo.quotation_items
         (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind,
          description, currency_code, captured_unit_price, captured_quantity,
          captured_discount, captured_tax_rate, captured_tax_amount, captured_line_total,
          created_by)
       VALUES ($1,$2,$3,$4,1,'service',$5,'USD',
               $6::numeric, $7::numeric, $8::numeric, $9::numeric,
               round(($6::numeric * $7::numeric - $8::numeric) * $9::numeric, 4),
               round($6::numeric * $7::numeric - $8::numeric
                     + round(($6::numeric * $7::numeric - $8::numeric) * $9::numeric, 4), 4),
               $10)
       RETURNING id`,
      [
        TENANT_A,
        chain.companyId,
        chain.branchId,
        revisionId,
        `W6 billable line ${tag}`,
        LINE.unitPrice,
        LINE.quantity,
        LINE.discount,
        LINE.taxRate,
        USER_A,
      ]
    );
    const itemId = item.rows[0]?.id ?? '';
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
    await client.query(
      `UPDATE quo.quotations SET current_revision_id = $3, status = 'active'
        WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, quotationId, revisionId]
    );
    if (decision !== 'none') {
      await client.query(
        `INSERT INTO quo.approval_decisions
           (tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id,
            decision, decided_by, decision_channel, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'in_person',$7)`,
        [TENANT_A, chain.companyId, chain.branchId, revisionId, itemId, decision, USER_A]
      );
    }
    return { workOrderId: chain.workOrderId, revisionId, itemId };
  });
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
}, 180_000);

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  await cleanP1_22Fixtures().catch(() => undefined);
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ---------------------------------------------------------------------------
// The lifecycle the screen walks: none -> preview -> draft -> issued
// ---------------------------------------------------------------------------

describe('FE-014 → FE-015 → FE-019 on one work order', () => {
  let billable: Billable;
  let invoiceId: string;
  let draftVersion: number;
  const createKey = randomUUID();

  it('before any invoice: the work-order read answers null (not 404), and a reader without manage is refused', async () => {
    billable = await seedBillable('w6_lifecycle');
    authAs(SAL_FULL);
    const response = await workOrderInvoice(billable.workOrderId);
    expect(response.status).toBe(200);
    expect(await bodyOf<{ invoice: unknown }>(response)).toEqual({
      workOrderId: billable.workOrderId,
      invoice: null,
    });
    authAs(SAL_READER);
    const refused = await workOrderInvoice(billable.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('the preview is the server’s figures as strings, and it is money: refused without finance view', async () => {
    authAs(SAL_FULL);
    const response = await preview(billable.workOrderId);
    expect(response.status).toBe(200);
    const body = await bodyOf<PreviewBody>(response);
    expect(body).toMatchObject({
      quotationRevisionId: billable.revisionId,
      currency: 'USD',
      subtotal: '200.0000',
      discountTotal: '50.0000',
      taxTotal: '15.0000',
      netTotal: '150.0000',
      grossTotal: '165.0000',
    });
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      sourceQuotationItemId: billable.itemId,
      lineNumber: 1,
      description: 'W6 billable line w6_lifecycle',
      quantity: '2.000',
      unitPrice: '100.0000',
      discount: '50.0000',
      taxRate: '0.100000',
      grossAmount: '165.0000',
    });
    for (const figure of [body.subtotal, body.grossTotal, body.lines[0]?.taxRate]) {
      expect(typeof figure).toBe('string');
    }

    authAs(SAL_NO_FINANCE);
    const refused = await preview(billable.workOrderId);
    expect(refused.status).toBe(403);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-IAM-001');
    expect(JSON.stringify(problem)).toContain('sal.finance.view');
    expect(JSON.stringify(problem)).not.toContain('165.0000');
  });

  it('creates the draft: 201, replayed false, born draft with no number, the totals the preview showed', async () => {
    // Both declared codes are required: a reader, and a manager without finance view, are refused.
    authAs(SAL_READER);
    expect((await create({ workOrderId: billable.workOrderId })).status).toBe(403);
    authAs(SAL_NO_FINANCE);
    const noFinance = await create({ workOrderId: billable.workOrderId });
    expect(noFinance.status).toBe(403);
    expect(await codeOf(noFinance)).toBe('ERR-IAM-001');

    authAs(SAL_FULL);
    const response = await create({ workOrderId: billable.workOrderId }, createKey);
    expect(response.status).toBe(201);
    const body = await bodyOf<CreatedBody>(response);
    invoiceId = body.invoice.id;
    draftVersion = body.recordVersion;
    expect(body.replayed).toBe(false);
    expect(body.invoice).toMatchObject({
      workOrderId: billable.workOrderId,
      quotationRevisionId: billable.revisionId,
      payerPartnerId: PARTNER_A,
      currency: 'USD',
      status: 'draft',
      invoiceNumber: null,
      issuedAt: null,
    });
    expect(body.recordVersion).toBe(body.invoice.recordVersion);
    expect(body.invoice.totals).toEqual({
      net: { amount: '150.0000', currency: 'USD' },
      tax: { amount: '15.0000', currency: 'USD' },
      gross: { amount: '165.0000', currency: 'USD' },
    });
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ lineNumber: 1, lineType: 'service', quantity: '2.000' });
    expect(body.lines[0]?.money?.unitPrice).toEqual({ amount: '100.0000', currency: 'USD' });
  });

  it('the SAME key replays the stored answer (200, the same invoice, replayed false); a NEW key is a conflict', async () => {
    authAs(SAL_FULL);
    const replay = await create({ workOrderId: billable.workOrderId }, createKey);
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<CreatedBody>(replay);
    expect(replayed.invoice.id).toBe(invoiceId);
    // The stored answer is the ORIGINAL body: `replayed` is not set by a
    // transport replay. The screen learns "already exists" from the status and
    // the work-order read, never from this flag.
    expect(replayed.replayed).toBe(false);

    const second = await create({ workOrderId: billable.workOrderId });
    expect(second.status).toBe(409);
    expect(await codeOf(second)).toBe('ERR-CON-001');

    const now = await workOrderInvoice(billable.workOrderId);
    const envelope = await bodyOf<{ invoice: InvoiceBody | null }>(now);
    expect(envelope.invoice?.id).toBe(invoiceId);
    expect(envelope.invoice?.totals?.gross).toEqual({ amount: '165.0000', currency: 'USD' });
  });

  it('the finance split: without the code the header stands and every amount is null, never zero', async () => {
    authAs(SAL_NO_FINANCE);
    const response = await detail(invoiceId);
    expect(response.status).toBe(200);
    const body = await bodyOf<DetailBody>(response);
    expect(body.invoice).toMatchObject({ id: invoiceId, status: 'draft', currency: 'USD' });
    expect(body.invoice.totals).toBeNull();
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ lineType: 'service', quantity: '2.000', money: null });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('0.0000');
    expect(raw).not.toContain('165.0000');

    const envelope = await bodyOf<{ invoice: InvoiceBody | null }>(
      await workOrderInvoice(billable.workOrderId)
    );
    expect(envelope.invoice?.totals).toBeNull();

    authAs(SAL_FULL);
    const full = await detail(invoiceId);
    expect(full.headers.get('ETag')).toBe(`"${draftVersion}"`);
    const visible = await bodyOf<DetailBody>(full);
    expect(visible.invoice.totals?.gross).toEqual({ amount: '165.0000', currency: 'USD' });
    expect(visible.recordVersion).toBe(draftVersion);

    authAs(SAL_READER);
    expect((await detail(invoiceId)).status).toBe(403);
  });

  it('the open balance of a draft is the server’s zero with its status; a finance-only reader may read it', async () => {
    authAs(SAL_FULL);
    const response = await outstanding(invoiceId);
    expect(response.status).toBe(200);
    expect(await bodyOf<OutstandingBody>(response)).toEqual({
      invoiceId,
      status: 'draft',
      outstanding: { amount: '0.0000', currency: 'USD' },
      isSettled: true,
    });
    authAs(SAL_READER);
    expect((await outstanding(invoiceId)).status).toBe(200);
  });

  it('issue is version-guarded: missing If-Match 428, stale 409 and still a draft, no finance 403', async () => {
    authAs(SAL_FULL);
    const missing = await issue(invoiceId);
    expect(missing.status).toBe(428);
    expect(await codeOf(missing)).toBe('ERR-CON-002');

    const stale = await issue(invoiceId, { version: draftVersion + 7 });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');
    const still = await bodyOf<DetailBody>(await detail(invoiceId));
    expect(still.invoice.status).toBe('draft');
    expect(still.invoice.invoiceNumber).toBeNull();

    authAs(SAL_NO_FINANCE);
    expect((await issue(invoiceId, { version: draftVersion })).status).toBe(403);
  });

  it('issues with the detail’s version: a number is allocated; a NEW key afterwards is replayed true with the same number', async () => {
    authAs(SAL_FULL);
    const response = await issue(invoiceId, { version: draftVersion });
    expect(response.status).toBe(200);
    const issued = await bodyOf<IssuedBody>(response);
    expect(issued.replayed).toBe(false);
    expect(typeof issued.invoiceNumber).toBe('string');
    expect(issued.invoiceNumber.length).toBeGreaterThan(0);
    expect(issued.invoice).toMatchObject({ status: 'issued', invoiceNumber: issued.invoiceNumber });
    expect(issued.invoice.issuedAt).not.toBeNull();
    expect(issued.recordVersion).toBeGreaterThan(draftVersion);
    expect(response.headers.get('ETag')).toBe(`"${issued.recordVersion}"`);

    const again = await issue(invoiceId, { version: issued.recordVersion });
    expect(again.status).toBe(200);
    const replayed = await bodyOf<IssuedBody>(again);
    expect(replayed.replayed).toBe(true);
    expect(replayed.invoiceNumber).toBe(issued.invoiceNumber);
  });

  it('the open balance of the issued invoice is the gross, unsettled; hidden amounts REFUSE rather than answer zero', async () => {
    authAs(SAL_FULL);
    expect(await bodyOf<OutstandingBody>(await outstanding(invoiceId))).toEqual({
      invoiceId,
      status: 'issued',
      outstanding: { amount: '165.0000', currency: 'USD' },
      isSettled: false,
    });
    authAs(SAL_NO_FINANCE);
    const refused = await outstanding(invoiceId);
    expect(refused.status).toBe(403);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-IAM-001');
    expect(JSON.stringify(problem)).toContain('sal.finance.view');
    expect(JSON.stringify(problem)).not.toContain('165.0000');
    expect(JSON.stringify(problem)).not.toContain('0.0000');
  });

  it('an issued invoice cannot be cancelled', async () => {
    authAs(SAL_FULL);
    const current = await bodyOf<DetailBody>(await detail(invoiceId));
    const refused = await cancel(
      invoiceId,
      { reason: 'too late' },
      { version: current.recordVersion }
    );
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe('ERR-TRN-001');
    expect((await bodyOf<DetailBody>(await detail(invoiceId))).invoice.status).toBe('issued');
  });

  it('a malformed identifier is refused by every read before anything is looked up', async () => {
    authAs(SAL_FULL);
    for (const response of [
      await workOrderInvoice('not-a-uuid'),
      await detail('not-a-uuid'),
      await outstanding('not-a-uuid'),
    ]) {
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe('ERR-VAL-001');
    }
  });

  it('another tenant never sees the work order’s invoice, its detail or its preview', async () => {
    authAs(SAL_TENANT_B);
    for (const response of [
      await workOrderInvoice(billable.workOrderId),
      await detail(invoiceId),
      await preview(billable.workOrderId),
    ]) {
      expect([403, 404]).toContain(response.status);
    }
  });
});

// ---------------------------------------------------------------------------
// Cancelling a draft frees the work order; nothing to bill is 404
// ---------------------------------------------------------------------------

describe('FE-015 cancel, and FE-014 refusals', () => {
  it('cancels a draft with the detail’s version, frees the work order, and a repeat is replayed', async () => {
    const billable = await seedBillable('w6_cancel');
    authAs(SAL_FULL);
    const draft = await bodyOf<CreatedBody>(await create({ workOrderId: billable.workOrderId }));
    const stale = await cancel(
      draft.invoice.id,
      { reason: 'wrong' },
      { version: draft.recordVersion + 3 }
    );
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');

    const response = await cancel(
      draft.invoice.id,
      { reason: 'wrong customer' },
      { version: draft.recordVersion }
    );
    expect(response.status).toBe(200);
    const voided = await bodyOf<VoidedBody>(response);
    expect(voided.replayed).toBe(false);
    expect(voided.invoice).toMatchObject({
      status: 'void_before_issue',
      invoiceNumber: null,
      issuedAt: null,
    });
    expect(voided.recordVersion).toBe(draft.recordVersion + 1);

    const freed = await bodyOf<{ invoice: unknown }>(await workOrderInvoice(billable.workOrderId));
    expect(freed.invoice).toBeNull();
    expect((await preview(billable.workOrderId)).status).toBe(200);

    const again = await cancel(
      draft.invoice.id,
      { reason: 'again' },
      { version: voided.recordVersion }
    );
    expect(again.status).toBe(200);
    expect((await bodyOf<VoidedBody>(again)).replayed).toBe(true);

    authAs(SAL_READER);
    expect(
      (await cancel(draft.invoice.id, { reason: 'x' }, { version: voided.recordVersion })).status
    ).toBe(403);
  });

  it('a work order whose quotation is undecided has nothing to bill: 404, never a zero preview', async () => {
    const undecided = await seedBillable('w6_undecided', 'none');
    authAs(SAL_FULL);
    const response = await preview(undecided.workOrderId);
    expect(response.status).toBe(404);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-RES-001');
    expect(JSON.stringify(problem)).not.toContain('0.0000');
    const created = await create({ workOrderId: undecided.workOrderId });
    expect(created.status).toBe(404);
  });
});
