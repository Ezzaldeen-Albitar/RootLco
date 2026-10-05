/**
 * P1-32-PRE-OD-FD5 — invoice approved quantities only, tracked per source line
 * across superseding revisions (ADR-023 D5 and D15), end to end through the
 * shipped route handlers.
 *
 * Each case fails when the control it names is removed:
 *
 *  - FULL APPROVAL is billed once, exactly as before quantities were tracked: the
 *    invoice copies every line at its quoted amounts, the preview's totals are the
 *    revision's, and afterwards nothing remains — a second create is refused
 *    (`invoice_draft_open` while the draft is open, `invoice_nothing_to_bill` once
 *    it is issued) and the preview answers 200 with no lines.
 *  - PARTIAL APPROVAL bills the approved line only; the undecided line is listed as
 *    not approved. When the customer later approves it, a SECOND invoice bills it
 *    and nothing billed before; when the customer rejects it instead, it is listed
 *    as rejected and never billed.
 *  - A LATER REVISION that raises an approved quantity bills only the increase, at
 *    what remains of the approved line's total; the superseded revision's billed
 *    quantity is never billed again.
 *  - CANCELLING a draft releases what it held.
 *  - CONCURRENCY and REPLAY: two creates racing for the same remaining quantity —
 *    exactly one is created, the other is a 409; a replayed key answers the first.
 *  - The work-order invoice read lists every live invoice and says whether approved
 *    work remains; the delivery port reports unbilled approved work.
 *  - TWO QUOTATIONS: a wholly accepted one beside a partly approved one, both with
 *    work to bill, is refused for preview and create and the delivery blocker stays
 *    on (an Owner open point — base billed the accepted one); once one quotation's
 *    approved work is all invoiced, it no longer blocks the other's. What is
 *    already invoiced is pooled by work order (an Owner open point): a second
 *    quotation's line of a service the first invoiced is not billed again.
 *  - ISOLATION: another tenant previews nothing of it.
 *
 * Money is compared as exact decimal STRINGS.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { PARTNER_A, createOpenWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  SERVICE_A,
  SVC_DISCOUNT_APPROVER,
  SVC_FULL,
  TAX_CLASS_A,
  assignPriceList,
  authAs,
  clearDiscountPolicy,
  establishP1_20Fixtures,
  priceListVersionOf,
  seedDiscountCeiling,
} from './p1-20-helpers';
import { CATEGORY_A, UOM_EACH, cleanP1_21Fixtures, establishP1_21Fixtures } from './p1-21-helpers';
import {
  SAL_FULL,
  SAL_TENANT_B,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { billingModule } from '@/modules/billing';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_LIST_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH_LIST } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { GET as READ_QUOTATION } from '@/app/api/v1/quotations/[quotationId]/route';
import { POST as REVISE } from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { POST as ISSUE } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { POST as DECIDE_REVISION } from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { POST as DECIDE_ITEM } from '@/app/api/v1/quotation-items/[quotationItemId]/decisions/route';
import { POST as CREATE_INVOICE } from '@/app/api/v1/invoices/route';
import { GET as READ_INVOICE_PREVIEW } from '@/app/api/v1/work-orders/[workOrderId]/invoice-preview/route';
import { GET as READ_WORK_ORDER_INVOICE } from '@/app/api/v1/work-orders/[workOrderId]/invoice/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { POST as CANCEL_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/cancellation/route';

let admin: Pool;
let runtime: Pool;
let serial = 0;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const post = (url: string, body: unknown, ifMatch?: number, key = randomUUID()): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface Line {
  readonly id: string;
  readonly itemKind: string;
  readonly quantity: string;
}
interface Revision {
  readonly id: string;
  readonly status: string;
  readonly lines: readonly Line[];
}
interface Quotation {
  readonly id: string;
  readonly recordVersion: number;
  readonly currentRevision: Revision | null;
}
interface Problem {
  readonly code: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}
interface PreviewLine {
  readonly sourceQuotationItemId: string;
  readonly lineType: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly grossAmount: string;
  readonly approvedQuantity: string;
  readonly invoicedQuantity: string;
  readonly partlyInvoicedEarlier: boolean;
}
interface RevisionLine {
  readonly sourceQuotationItemId: string;
  readonly decision: string | null;
  readonly quotedQuantity: string;
  readonly approvedQuantity: string;
  readonly invoicedQuantity: string;
  readonly remainingQuantity: string;
  readonly billingStatus: string;
}
interface Preview {
  readonly quotationRevisionId: string;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly netTotal: string;
  readonly grossTotal: string;
  readonly lines: readonly PreviewLine[];
  readonly revisionLines: readonly RevisionLine[];
  readonly revisionTotals: {
    readonly netTotal: string;
    readonly taxTotal: string;
    readonly grossTotal: string;
  };
}
interface Created {
  readonly invoice: {
    readonly id: string;
    readonly status: string;
    readonly totals: { readonly gross: { readonly amount: string } } | null;
  };
  readonly recordVersion: number;
  readonly replayed: boolean;
}
interface InvoiceDetail {
  readonly invoice: { readonly id: string; readonly recordVersion: number };
  readonly lines: readonly {
    readonly lineType: string;
    readonly quantity: string;
    readonly sourceQuotationItemId: string | null;
    readonly money: { readonly net: { readonly amount: string } } | null;
  }[];
}
interface WorkOrderInvoice {
  readonly invoice: { readonly id: string; readonly status: string } | null;
  readonly invoices: readonly { readonly id: string; readonly status: string }[];
  readonly invoicesTruncated: boolean;
  readonly approvedWorkToInvoice: boolean;
}

// ---------------------------------------------------------------------------
// Fixtures: a priced service (SERVICE_A at 50.0000 with TAX_CLASS_A, 10%) and a
// priced part (12.3450, untaxed), quoted through the real routes.
// ---------------------------------------------------------------------------

async function pricedPart(): Promise<string> {
  serial += 1;
  const item = await admin.query<{ id: string }>(
    `INSERT INTO inv.item_master (tenant_id, item_category_id, sku, name, uom_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      TENANT_A,
      CATEGORY_A,
      `FX-FD5-${String(Date.now() % 100000)}-${serial}`,
      `FD5 part ${serial}`,
      UOM_EACH,
      USER_A,
    ]
  );
  const id = item.rows[0]?.id ?? '';
  await admin.query(
    `INSERT INTO inv.item_sale_prices
       (tenant_id, item_id, company_id, branch_id, currency_code, unit_price, created_by)
     VALUES ($1,$2,$3,$4,'JOD',12.3450,$5)`,
    [TENANT_A, id, COMPANY_A1, BRANCH_A1, USER_A]
  );
  return id;
}

async function publishServicePrice(amount: string): Promise<void> {
  authAs(SVC_FULL);
  serial += 1;
  const list = await bodyOf<{ id: string; recordVersion: number }>(
    await CREATE_LIST(
      post('http://localhost/api/v1/price-lists', {
        priceListCode: `FX-FD5-${String(Date.now() % 100000)}-${serial}`,
        name: 'FD5 fixture list',
        currency: 'JOD',
      })
    )
  );
  const version = await bodyOf<{ id: string }>(
    await (CREATE_LIST_VERSION as ParamHandler<{ priceListId: string }>)(
      post(
        `http://localhost/api/v1/price-lists/${list.id}/versions`,
        { effectiveFrom: '2020-01-01' },
        list.recordVersion
      ),
      { params: Promise.resolve({ priceListId: list.id }) }
    )
  );
  const rule = await (RECORD_RULE as ParamHandler<{ priceListId: string; versionId: string }>)(
    post(`http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/rules`, {
      serviceId: SERVICE_A,
      amount,
      companyId: COMPANY_A1,
      taxClassId: TAX_CLASS_A,
    }),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  expect(rule.status).toBe(201);
  const published = await (
    PUBLISH_LIST as ParamHandler<{ priceListId: string; versionId: string }>
  )(
    post(
      `http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/publication`,
      { effectiveFrom: '2020-01-01' },
      await priceListVersionOf(list.id)
    ),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  expect(published.status).toBe(200);
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: list.id,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: 800,
  });
}

const service = (quantity: string) => ({ serviceId: SERVICE_A, quantity });
const part = (itemId: string, quantity: string) => ({ kind: 'part', itemId, quantity });

async function readQuotation(quotationId: string): Promise<Quotation> {
  authAs(SVC_FULL);
  return bodyOf<Quotation>(
    await (READ_QUOTATION as ParamHandler<{ quotationId: string }>)(
      new Request(`http://localhost/api/v1/quotations/${quotationId}`),
      { params: Promise.resolve({ quotationId }) }
    )
  );
}

/** Issues the draft revision `revisionId`, or the quotation's current one when none is named. */
async function issue(quotationId: string, revisionId?: string): Promise<Revision> {
  const quotation = await readQuotation(quotationId);
  authAs(SVC_FULL);
  const response = await (ISSUE as ParamHandler<{ quotationId: string }>)(
    post(
      `http://localhost/api/v1/quotations/${quotationId}/issue`,
      { revisionId: revisionId ?? quotation.currentRevision?.id },
      quotation.recordVersion
    ),
    { params: Promise.resolve({ quotationId }) }
  );
  expect(response.status).toBe(200);
  return bodyOf<Revision>(response);
}

/** A quotation of `lines`, issued. Returns its id and the issued revision. */
async function quote(
  workOrderId: string,
  lines: unknown[]
): Promise<{ quotationId: string; revision: Revision }> {
  authAs(SVC_FULL);
  const response = await CREATE_QUOTATION(
    post('http://localhost/api/v1/quotations', { workOrderId, payerPartnerRef: PARTNER_A, lines })
  );
  expect(response.status).toBe(201);
  const quotation = await bodyOf<Quotation>(response);
  return { quotationId: quotation.id, revision: await issue(quotation.id) };
}

async function revise(quotationId: string, lines: unknown[]): Promise<Revision> {
  const current = await readQuotation(quotationId);
  authAs(SVC_FULL);
  const response = await (REVISE as ParamHandler<{ quotationId: string }>)(
    post(
      `http://localhost/api/v1/quotations/${quotationId}/revisions`,
      { lines },
      current.recordVersion
    ),
    { params: Promise.resolve({ quotationId }) }
  );
  expect(response.status).toBe(201);
  // A new revision is a draft beside the issued one until it is issued itself.
  return issue(quotationId, (await bodyOf<Revision>(response)).id);
}

async function decideItem(
  revision: Revision,
  itemId: string,
  decision: 'approved' | 'rejected'
): Promise<void> {
  authAs(SVC_FULL);
  const response = await (DECIDE_ITEM as ParamHandler<{ quotationItemId: string }>)(
    post(`http://localhost/api/v1/quotation-items/${itemId}/decisions`, {
      decision,
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: revision.id,
    }),
    { params: Promise.resolve({ quotationItemId: itemId }) }
  );
  expect(response.status).toBe(201);
}

async function approveAll(revision: Revision): Promise<void> {
  authAs(SVC_FULL);
  const response = await (DECIDE_REVISION as ParamHandler<{ revisionId: string }>)(
    post(`http://localhost/api/v1/quotation-revisions/${revision.id}/decisions`, {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: revision.id,
    }),
    { params: Promise.resolve({ revisionId: revision.id }) }
  );
  expect(response.status).toBe(201);
}

async function preview(workOrderId: string): Promise<Response> {
  authAs(SAL_FULL);
  return (READ_INVOICE_PREVIEW as ParamHandler<{ workOrderId: string }>)(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/invoice-preview`),
    { params: Promise.resolve({ workOrderId }) }
  );
}

async function previewOk(workOrderId: string): Promise<Preview> {
  const response = await preview(workOrderId);
  expect(response.status).toBe(200);
  return bodyOf<Preview>(response);
}

async function createInvoice(workOrderId: string, key = randomUUID()): Promise<Response> {
  authAs(SAL_FULL);
  return CREATE_INVOICE(post('http://localhost/api/v1/invoices', { workOrderId }, undefined, key));
}

async function created(workOrderId: string): Promise<Created> {
  const response = await createInvoice(workOrderId);
  expect(response.status).toBe(201);
  return bodyOf<Created>(response);
}

async function detailOf(invoiceId: string): Promise<InvoiceDetail> {
  authAs(SAL_FULL);
  return bodyOf<InvoiceDetail>(
    await (READ_INVOICE as ParamHandler<{ invoiceId: string }>)(
      new Request(`http://localhost/api/v1/invoices/${invoiceId}`),
      { params: Promise.resolve({ invoiceId }) }
    )
  );
}

async function issueInvoice(invoice: Created): Promise<void> {
  authAs(SAL_FULL);
  const response = await (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
    post(
      `http://localhost/api/v1/invoices/${invoice.invoice.id}/issuance`,
      undefined,
      invoice.recordVersion
    ),
    { params: Promise.resolve({ invoiceId: invoice.invoice.id }) }
  );
  expect(response.status).toBe(200);
}

async function workOrderInvoices(workOrderId: string): Promise<WorkOrderInvoice> {
  authAs(SAL_FULL);
  const response = await (READ_WORK_ORDER_INVOICE as ParamHandler<{ workOrderId: string }>)(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/invoice`),
    { params: Promise.resolve({ workOrderId }) }
  );
  expect(response.status).toBe(200);
  return bodyOf<WorkOrderInvoice>(response);
}

async function refusedWith(response: Response, rule: string): Promise<void> {
  expect(response.status).toBe(409);
  const problem = await bodyOf<Problem>(response);
  expect(problem.code).toBe('ERR-CON-001');
  expect(problem.violations).toEqual([{ path: 'body.workOrderId', rule }]);
}

async function liveInvoiceCount(workOrderId: string): Promise<number> {
  const result = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sal.invoices
      WHERE work_order_id = $1 AND status <> 'void_before_issue'`,
    [workOrderId]
  );
  return result.rows[0]?.n ?? -1;
}

const byItem = <T extends { readonly sourceQuotationItemId: string }>(
  rows: readonly T[],
  itemId: string
): T | undefined => rows.find((row) => row.sourceQuotationItemId === itemId);

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await establishP1_22Fixtures(admin);
  await seedDiscountCeiling({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    roleId: SVC_DISCOUNT_APPROVER.roleId,
    amount: '1000.0000',
    currencyCode: 'JOD',
  });
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
  await publishServicePrice('50.0000');
  await clearDiscountPolicy(TENANT_A);
  __resetAuthenticatorForTests();
}, 180_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanP1_22Fixtures();
    await cleanBackendFixtures(admin);
    await cleanP1_21Fixtures();
    await admin.end();
  }
});

// ---------------------------------------------------------------------------

describe('a fully approved revision', () => {
  it('is billed once, exactly as quoted; nothing remains afterwards', async () => {
    const item = await pricedPart();
    const order = await createOpenWorkOrder();
    const { revision } = await quote(order.workOrderId, [service('1'), part(item, '2')]);
    await approveAll(revision);
    const [serviceLine, partLine] = revision.lines as [Line, Line];

    const before = await previewOk(order.workOrderId);
    // Unchanged from before quantities were tracked: the whole revision, as quoted.
    expect(before).toMatchObject({
      netTotal: '74.6900',
      taxTotal: '5.0000',
      grossTotal: '79.6900',
      revisionTotals: { netTotal: '74.6900', taxTotal: '5.0000', grossTotal: '79.6900' },
    });
    expect(byItem(before.lines, serviceLine.id)).toMatchObject({
      quantity: '1.000',
      approvedQuantity: '1.000',
      invoicedQuantity: '0.000',
      netAmount: '50.0000',
      taxAmount: '5.0000',
      partlyInvoicedEarlier: false,
    });
    expect(byItem(before.lines, partLine.id)).toMatchObject({
      quantity: '2.000',
      netAmount: '24.6900',
    });

    const invoice = await created(order.workOrderId);
    expect(invoice.invoice.totals?.gross.amount).toBe('79.6900');
    const detail = await detailOf(invoice.invoice.id);
    expect(detail.lines.map((line) => [line.sourceQuotationItemId, line.quantity]).sort()).toEqual(
      [
        [serviceLine.id, '1.000'],
        [partLine.id, '2.000'],
      ].sort()
    );

    // While the draft is open, a second create is the draft rule.
    await refusedWith(await createInvoice(order.workOrderId), 'invoice_draft_open');
    await issueInvoice(invoice);
    // Issued, nothing remains: refused, never a zero invoice.
    await refusedWith(await createInvoice(order.workOrderId), 'invoice_nothing_to_bill');
    expect(await liveInvoiceCount(order.workOrderId)).toBe(1);

    const after = await previewOk(order.workOrderId);
    expect(after.lines).toEqual([]);
    expect(after.grossTotal).toBe('0.0000');
    expect(after.revisionTotals.grossTotal).toBe('79.6900');
    expect(after.revisionLines.map((line) => line.billingStatus)).toEqual([
      'fully_invoiced',
      'fully_invoiced',
    ]);
    expect(await workOrderInvoices(order.workOrderId)).toMatchObject({
      invoice: { id: invoice.invoice.id, status: 'issued' },
      invoices: [{ id: invoice.invoice.id }],
      invoicesTruncated: false,
      approvedWorkToInvoice: false,
    });
  });
});

describe('a partly approved revision', () => {
  it('bills the approved line now and the other line once it is approved, never twice', async () => {
    const item = await pricedPart();
    const order = await createOpenWorkOrder();
    const { revision } = await quote(order.workOrderId, [service('1'), part(item, '2')]);
    const [serviceLine, partLine] = revision.lines as [Line, Line];
    await decideItem(revision, serviceLine.id, 'approved');

    const first = await previewOk(order.workOrderId);
    expect(first.lines.map((line) => line.sourceQuotationItemId)).toEqual([serviceLine.id]);
    expect(first.grossTotal).toBe('55.0000');
    expect(byItem(first.revisionLines, partLine.id)).toMatchObject({
      decision: null,
      approvedQuantity: '0.000',
      billingStatus: 'not_approved',
    });
    const one = await created(order.workOrderId);
    expect(
      (await detailOf(one.invoice.id)).lines.map((line) => line.sourceQuotationItemId)
    ).toEqual([serviceLine.id]);
    await issueInvoice(one);
    expect((await workOrderInvoices(order.workOrderId)).approvedWorkToInvoice).toBe(false);

    // The customer approves the part later: a SECOND invoice, for the part only.
    await decideItem(revision, partLine.id, 'approved');
    expect((await workOrderInvoices(order.workOrderId)).approvedWorkToInvoice).toBe(true);
    const receivable = await withTransaction(
      contextFor({
        userId: SAL_FULL.userId,
        tenantId: TENANT_A,
        companyIds: [COMPANY_A1],
        branchIds: [BRANCH_A1],
        operation: 'sal.delivery-eligibility-read',
        module: 'delivery',
      }),
      (db) => billingModule().reads.openReceivableForWorkOrder(db, order.workOrderId)
    );
    expect(receivable).toMatchObject({ hasOutstanding: true, unbilledApprovedWork: true });

    const second = await previewOk(order.workOrderId);
    expect(second.lines.map((line) => line.sourceQuotationItemId)).toEqual([partLine.id]);
    expect(second.grossTotal).toBe('24.6900');
    const two = await created(order.workOrderId);
    expect((await detailOf(two.invoice.id)).lines).toMatchObject([
      { sourceQuotationItemId: partLine.id, quantity: '2.000' },
    ]);
    const listed = await workOrderInvoices(order.workOrderId);
    expect(listed.invoices.map((invoice) => invoice.id)).toEqual([two.invoice.id, one.invoice.id]);
    expect(listed.invoice?.id).toBe(two.invoice.id);
    expect(listed.approvedWorkToInvoice).toBe(false);
  });

  it('never bills a rejected line, while its approved line is billed', async () => {
    const item = await pricedPart();
    const order = await createOpenWorkOrder();
    const { revision } = await quote(order.workOrderId, [service('1'), part(item, '2')]);
    const [serviceLine, partLine] = revision.lines as [Line, Line];
    await decideItem(revision, serviceLine.id, 'approved');
    await decideItem(revision, partLine.id, 'rejected');

    const view = await previewOk(order.workOrderId);
    expect(view.lines.map((line) => line.sourceQuotationItemId)).toEqual([serviceLine.id]);
    expect(byItem(view.revisionLines, partLine.id)).toMatchObject({
      decision: 'rejected',
      billingStatus: 'rejected',
      remainingQuantity: '0.000',
    });
    const invoice = await created(order.workOrderId);
    expect((await detailOf(invoice.invoice.id)).lines).toMatchObject([
      { sourceQuotationItemId: serviceLine.id },
    ]);
    await issueInvoice(invoice);
    await refusedWith(await createInvoice(order.workOrderId), 'invoice_nothing_to_bill');
  });
});

describe('a later revision', () => {
  it('bills only the increase of an approved quantity; the superseded revision is never billed again', async () => {
    const item = await pricedPart();
    const order = await createOpenWorkOrder();
    const { quotationId, revision } = await quote(order.workOrderId, [
      service('1'),
      part(item, '2'),
    ]);
    const partLine = revision.lines[1] as Line;
    await decideItem(revision, partLine.id, 'approved');
    const first = await created(order.workOrderId);
    await issueInvoice(first);

    // Revision 2 raises the part to three units; the customer approves it whole.
    const second = await revise(quotationId, [service('1'), part(item, '3')]);
    await approveAll(second);
    const [serviceLine2, partLine2] = second.lines as [Line, Line];

    const view = await previewOk(order.workOrderId);
    expect(byItem(view.lines, partLine2.id)).toMatchObject({
      quantity: '1.000',
      approvedQuantity: '3.000',
      invoicedQuantity: '2.000',
      // 3 × 12.3450 = 37.0350, less the 24.6900 already invoiced.
      netAmount: '12.3450',
      taxAmount: '0.0000',
      discount: '0.0000',
      partlyInvoicedEarlier: true,
    });
    expect(byItem(view.lines, serviceLine2.id)).toMatchObject({
      quantity: '1.000',
      partlyInvoicedEarlier: false,
    });
    expect(view.grossTotal).toBe('67.3450');

    const next = await created(order.workOrderId);
    const detail = await detailOf(next.invoice.id);
    expect(byItem(detail.lines as never, partLine2.id)).toMatchObject({
      quantity: '1.000',
      money: { net: { amount: '12.3450' } },
    });
    // Nothing of the first revision appears on the second invoice.
    expect(detail.lines.some((line) => line.sourceQuotationItemId === partLine.id)).toBe(false);
    await issueInvoice(next);
    await refusedWith(await createInvoice(order.workOrderId), 'invoice_nothing_to_bill');

    const billed = await admin.query<{ q: string }>(
      `SELECT sum(l.quantity)::text AS q
         FROM sal.invoice_lines l JOIN sal.invoices i ON i.id = l.invoice_id
        WHERE i.work_order_id = $1 AND l.line_type = 'part' AND i.status <> 'void_before_issue'`,
      [order.workOrderId]
    );
    expect(billed.rows[0]?.q).toBe('3.000');
  });
});

describe('cancelling, racing and replaying', () => {
  it('a draft cancelled before issue releases what it held', async () => {
    const order = await createOpenWorkOrder();
    const { revision } = await quote(order.workOrderId, [service('1')]);
    await approveAll(revision);
    const draft = await created(order.workOrderId);
    expect((await previewOk(order.workOrderId)).lines).toEqual([]);

    authAs(SAL_FULL);
    const cancelled = await (CANCEL_INVOICE as ParamHandler<{ invoiceId: string }>)(
      post(
        `http://localhost/api/v1/invoices/${draft.invoice.id}/cancellation`,
        { reason: 'Raised against the wrong payer' },
        draft.recordVersion
      ),
      { params: Promise.resolve({ invoiceId: draft.invoice.id }) }
    );
    expect(cancelled.status).toBe(200);
    expect((await previewOk(order.workOrderId)).grossTotal).toBe('55.0000');
    await created(order.workOrderId);
  });

  it('two creates racing for the same quantity: exactly one invoice, the other a 409', async () => {
    const order = await createOpenWorkOrder();
    const { revision } = await quote(order.workOrderId, [service('1')]);
    await approveAll(revision);
    authAs(SAL_FULL);
    const answers = await Promise.all([
      CREATE_INVOICE(post('http://localhost/api/v1/invoices', { workOrderId: order.workOrderId })),
      CREATE_INVOICE(post('http://localhost/api/v1/invoices', { workOrderId: order.workOrderId })),
    ]);
    expect(answers.map((response) => response.status).sort()).toEqual([201, 409]);
    const loser = answers.find((response) => response.status === 409) as Response;
    expect((await bodyOf<Problem>(loser)).code).toBe('ERR-CON-001');
    expect(await liveInvoiceCount(order.workOrderId)).toBe(1);
  });

  it('a replayed key answers the first invoice and creates nothing', async () => {
    const order = await createOpenWorkOrder();
    const { revision } = await quote(order.workOrderId, [service('1')]);
    await approveAll(revision);
    const key = randomUUID();
    const first = await createInvoice(order.workOrderId, key);
    expect(first.status).toBe(201);
    const replay = await createInvoice(order.workOrderId, key);
    expect(replay.status).toBe(200);
    expect((await bodyOf<Created>(replay)).invoice.id).toBe(
      (await bodyOf<Created>(first)).invoice.id
    );
    expect(await liveInvoiceCount(order.workOrderId)).toBe(1);
  });
});

/** The billing port the delivery gate's financial blocker reads, as delivery reads it. */
async function receivableOf(workOrderId: string) {
  return withTransaction(
    contextFor({
      userId: SAL_FULL.userId,
      tenantId: TENANT_A,
      companyIds: [COMPANY_A1],
      branchIds: [BRANCH_A1],
      operation: 'sal.delivery-eligibility-read',
      module: 'delivery',
    }),
    (db) => billingModule().reads.openReceivableForWorkOrder(db, workOrderId)
  );
}

describe('two quotations on one work order', () => {
  /**
   * Owner open point (ADR-023 D5/D15, DBCR section 4). Base billed Q1, the one
   * quotation accepted as a whole, and ignored Q2. Under D5 both carry approved
   * work still to bill, so both compete and the work order is refused until one
   * is cancelled. This case pins that answer so a change of policy is a visible
   * change of test, not a silent one.
   */
  it('a wholly accepted quotation beside a partly approved one: preview and create refused, delivery stays blocked', async () => {
    const order = await createOpenWorkOrder();
    const q1 = await quote(order.workOrderId, [service('1')]);
    await approveAll(q1.revision);
    const q2 = await quote(order.workOrderId, [
      part(await pricedPart(), '2'),
      part(await pricedPart(), '1'),
    ]);
    await decideItem(q2.revision, (q2.revision.lines[0] as Line).id, 'approved');

    const previewed = await preview(order.workOrderId);
    expect(previewed.status).toBe(409);
    expect((await bodyOf<Problem>(previewed)).code).toBe('ERR-CON-001');
    const made = await createInvoice(order.workOrderId);
    expect(made.status).toBe(409);
    expect((await bodyOf<Problem>(made)).code).toBe('ERR-CON-001');
    expect(await liveInvoiceCount(order.workOrderId)).toBe(0);

    // The delivery gate's financial blocker: no live invoice (null, which the gate
    // treats as outstanding) while approved work waits to be billed.
    expect(await receivableOf(order.workOrderId)).toBeNull();
    expect(await workOrderInvoices(order.workOrderId)).toMatchObject({
      invoice: null,
      invoices: [],
      approvedWorkToInvoice: true,
    });
  });

  it('a quotation whose approved work is all invoiced does not block the approved work of another quotation', async () => {
    const order = await createOpenWorkOrder();
    const q1 = await quote(order.workOrderId, [service('1')]);
    await approveAll(q1.revision);
    const one = await created(order.workOrderId);
    await issueInvoice(one);

    const q2 = await quote(order.workOrderId, [
      part(await pricedPart(), '2'),
      part(await pricedPart(), '1'),
    ]);
    const [approvedLine, undecidedLine] = q2.revision.lines as [Line, Line];
    await decideItem(q2.revision, approvedLine.id, 'approved');
    // Approved work no invoice holds keeps the delivery blocker on ...
    expect(await receivableOf(order.workOrderId)).toMatchObject({
      hasOutstanding: true,
      unbilledApprovedWork: true,
    });

    // ... and it can be billed: Q1 has nothing left, so Q2 is the one source.
    const view = await previewOk(order.workOrderId);
    expect(view.quotationRevisionId).toBe(q2.revision.id);
    expect(view.lines.map((line) => line.sourceQuotationItemId)).toEqual([approvedLine.id]);
    expect(byItem(view.revisionLines, undecidedLine.id)).toMatchObject({
      billingStatus: 'not_approved',
    });
    const two = await created(order.workOrderId);
    expect((await detailOf(two.invoice.id)).lines).toMatchObject([
      { sourceQuotationItemId: approvedLine.id, quantity: '2.000' },
    ]);
    expect((await workOrderInvoices(order.workOrderId)).approvedWorkToInvoice).toBe(false);
    expect(await liveInvoiceCount(order.workOrderId)).toBe(2);
  });

  /**
   * Owner open point (ADR-023 D5/D15, DBCR section 4): what is already invoiced is
   * pooled by WORK ORDER and lineage, not by quotation. Q2's approved service line
   * sells the service Q1 already invoiced, so it counts as already invoiced: it is
   * not billed, it does not hold the delivery blocker, and once Q2's part is billed
   * nothing is left — with two quotations and nothing left, the preview is the
   * conflict. Scoping the pool to one quotation would bill the service again and
   * fail this case.
   */
  it('a second quotation selling a service the first already invoiced: that line counts as invoiced, the rest is billed', async () => {
    const order = await createOpenWorkOrder();
    const q1 = await quote(order.workOrderId, [service('1')]);
    await approveAll(q1.revision);
    const one = await created(order.workOrderId);
    await issueInvoice(one);

    const q2 = await quote(order.workOrderId, [service('1'), part(await pricedPart(), '2')]);
    const [serviceLine, partLine] = q2.revision.lines as [Line, Line];
    await approveAll(q2.revision);
    expect(await receivableOf(order.workOrderId)).toMatchObject({ unbilledApprovedWork: true });

    const view = await previewOk(order.workOrderId);
    expect(view.quotationRevisionId).toBe(q2.revision.id);
    expect(view.lines.map((line) => [line.sourceQuotationItemId, line.quantity])).toEqual([
      [partLine.id, '2.000'],
    ]);
    expect(byItem(view.revisionLines, serviceLine.id)).toMatchObject({
      decision: 'approved',
      approvedQuantity: '1.000',
      invoicedQuantity: '1.000',
      remainingQuantity: '0.000',
      billingStatus: 'fully_invoiced',
    });
    expect(byItem(view.revisionLines, partLine.id)).toMatchObject({ billingStatus: 'billable' });

    const two = await created(order.workOrderId);
    expect(
      (await detailOf(two.invoice.id)).lines.map((line) => [
        line.sourceQuotationItemId,
        line.quantity,
      ])
    ).toEqual([[partLine.id, '2.000']]);
    await issueInvoice(two);

    // Q2's service line was never billed from Q2, yet no approved work remains and
    // the delivery blocker no longer counts unbilled work.
    expect(await workOrderInvoices(order.workOrderId)).toMatchObject({
      approvedWorkToInvoice: false,
    });
    expect(await receivableOf(order.workOrderId)).toMatchObject({ unbilledApprovedWork: false });
    expect(await liveInvoiceCount(order.workOrderId)).toBe(2);
    const after = await preview(order.workOrderId);
    expect(after.status).toBe(409);
    expect((await bodyOf<Problem>(after)).code).toBe('ERR-CON-001');
  });
});

describe('isolation', () => {
  it('another tenant previews and invoices nothing of a partly approved work order', async () => {
    const order = await createOpenWorkOrder();
    const { revision } = await quote(order.workOrderId, [service('1'), service('2')]);
    await decideItem(revision, (revision.lines[0] as Line).id, 'approved');
    authAs(SAL_TENANT_B);
    const seen = await (READ_INVOICE_PREVIEW as ParamHandler<{ workOrderId: string }>)(
      new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/invoice-preview`),
      { params: Promise.resolve({ workOrderId: order.workOrderId }) }
    );
    expect(seen.status).toBe(404);
    authAs(SAL_TENANT_B);
    const made = await CREATE_INVOICE(
      post('http://localhost/api/v1/invoices', { workOrderId: order.workOrderId })
    );
    expect(made.status).toBe(404);
    expect(await liveInvoiceCount(order.workOrderId)).toBe(0);
  });
});
