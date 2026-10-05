/**
 * P1-32-PRE-OD-FD6 — part lines on quotations at authorised sales prices
 * (ADR-023 D6), end to end through the shipped route handlers.
 *
 * Each case fails when the control it names is removed:
 *
 *  - PRICE SOURCE. A part line is priced at the item selling price that applies to
 *    the work order's branch — the branch row, else the company row, else the
 *    tenant-wide row, never another branch's row — with that price's tax class at
 *    its effective rate, and never at a price the caller sends or at cost. The
 *    unit and the item's words are captured from the item.
 *  - NO PRICE. An item with no authorised sales price is refused on the line's item
 *    (`no_authorised_sale_price`) and nothing is written; an archived item and an
 *    item outside the caller's catalogue are refused by name too.
 *  - SNAPSHOT. A later price, unit or name change in the catalogue leaves a written
 *    line, draft or issued, exactly as quoted; only a new revision takes the
 *    catalogue as it is then.
 *  - DISCOUNT. A part line's discount goes through the same approval rule as a
 *    service line's: pending for somebody else when it needs approval, no issue
 *    until approved, and none when there is no discount.
 *  - INVOICE. A work-order invoice copies the part line (`lineType: part`,
 *    `sourceQuotationItemId`) and shows its item and unit, and issuing it posts no
 *    stock movement at all.
 *  - ISOLATION. Another tenant cannot quote this tenant's item, a branch-scoped
 *    caller cannot quote into another branch, and a required part from another work
 *    order cannot be linked.
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
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  PARTNER_A,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import {
  SERVICE_A,
  SVC_DISCOUNT_APPROVER,
  SVC_FULL,
  SVC_QUO_SCOPED_A2,
  SVC_TENANT_B_FULL,
  TAX_CLASS_A,
  assignPriceList,
  authAs,
  clearDiscountPolicy,
  establishP1_20Fixtures,
  priceListVersionOf,
  seedDiscountCeiling,
} from './p1-20-helpers';
import {
  CATEGORY_A,
  ITEM_A_ARCHIVED,
  ITEM_B,
  UOM_EACH,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
} from './p1-21-helpers';
import { SAL_FULL, cleanP1_22Fixtures, establishP1_22Fixtures } from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_LIST_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH_LIST } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { GET as READ_QUOTATION } from '@/app/api/v1/quotations/[quotationId]/route';
import { POST as REVISE } from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { POST as ISSUE } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { GET as READ_REVISION } from '@/app/api/v1/quotation-revisions/[revisionId]/route';
import { POST as DECIDE_REVISION } from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { POST as DECIDE_DISCOUNT } from '@/app/api/v1/discount-approvals/[approvalId]/decision/route';
import { POST as CREATE_INVOICE } from '@/app/api/v1/invoices/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';

let admin: Pool;
let runtime: Pool;
let serial = 0;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const post = (url: string, body: unknown, ifMatch?: number): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface Line {
  readonly id: string;
  readonly itemKind: string;
  readonly serviceId: string | null;
  readonly item: { readonly id: string; readonly code: string; readonly name: string } | null;
  readonly unit: { readonly code: string; readonly name: string } | null;
  readonly unitPrice: string;
  readonly quantity: string;
  readonly discount: string;
  readonly taxRate: string;
  readonly taxAmount: string;
  readonly lineTotal: string;
}
interface Revision {
  readonly id: string;
  readonly status: string;
  readonly grandTotal: string;
  readonly lines: readonly Line[];
  readonly discountApproval: { readonly id: string; readonly status: string } | null;
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

/** A fresh active item of tenant A, in the fixture unit. */
async function freshItem(label: string): Promise<{ id: string; sku: string; name: string }> {
  serial += 1;
  const sku = `FX-FD6-${String(Date.now() % 100000)}-${serial}`;
  const name = `FD6 ${label}`;
  const row = await admin.query<{ id: string }>(
    `INSERT INTO inv.item_master (tenant_id, item_category_id, sku, name, uom_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [TENANT_A, CATEGORY_A, sku, name, UOM_EACH, USER_A]
  );
  return { id: row.rows[0]?.id ?? '', sku, name };
}

/** One selling-price row, as the item price form would write it. */
async function setPrice(
  itemId: string,
  unitPrice: string,
  where: { company?: string | null; branch?: string | null; taxClass?: string | null } = {}
): Promise<string> {
  const row = await admin.query<{ id: string }>(
    `INSERT INTO inv.item_sale_prices
       (tenant_id, item_id, company_id, branch_id, currency_code, unit_price, tax_class_id, created_by)
     VALUES ($1,$2,$3,$4,'JOD',$5::numeric,$6,$7) RETURNING id`,
    [
      TENANT_A,
      itemId,
      where.company === undefined ? COMPANY_A1 : where.company,
      where.branch ?? null,
      unitPrice,
      where.taxClass ?? null,
      USER_A,
    ]
  );
  return row.rows[0]?.id ?? '';
}

const createQuotation = (workOrderId: string, lines: unknown[]): Promise<Response> =>
  CREATE_QUOTATION(
    post('http://localhost/api/v1/quotations', { workOrderId, payerPartnerRef: PARTNER_A, lines })
  );

const part = (itemId: string, extra: Record<string, string> = {}) => ({
  kind: 'part',
  itemId,
  quantity: '2',
  ...extra,
});

async function created(response: Response): Promise<Quotation> {
  expect(response.status).toBe(201);
  return bodyOf<Quotation>(response);
}

const readQuotation = async (quotationId: string): Promise<Quotation> =>
  bodyOf<Quotation>(
    await (READ_QUOTATION as ParamHandler<{ quotationId: string }>)(
      new Request(`http://localhost/api/v1/quotations/${quotationId}`),
      { params: Promise.resolve({ quotationId }) }
    )
  );

const issue = (quotation: Quotation): Promise<Response> =>
  (ISSUE as ParamHandler<{ quotationId: string }>)(
    post(
      `http://localhost/api/v1/quotations/${quotation.id}/issue`,
      { revisionId: quotation.currentRevision?.id },
      quotation.recordVersion
    ),
    { params: Promise.resolve({ quotationId: quotation.id }) }
  );

async function quotationCount(workOrderId: string): Promise<number> {
  const result = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM quo.quotations WHERE work_order_id = $1`,
    [workOrderId]
  );
  return result.rows[0]?.n ?? 0;
}

/** A published, assigned JOD price list pricing SERVICE_A at `amount`, taxed. */
async function publishServicePrice(amount: string): Promise<void> {
  authAs(SVC_FULL);
  serial += 1;
  const list = await bodyOf<{ id: string; recordVersion: number }>(
    await CREATE_LIST(
      post('http://localhost/api/v1/price-lists', {
        priceListCode: `FX-FD6-${String(Date.now() % 100000)}-${serial}`,
        name: 'FD6 fixture list',
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
    // An issued invoice is removed with its lines in one transaction first; then the
    // tenant cascade, which removes quotation lines before the items and prices they
    // cite; then whatever inventory fixtures remain.
    await cleanP1_22Fixtures();
    await cleanBackendFixtures(admin);
    await cleanP1_21Fixtures();
    await admin.end();
  }
});

describe('a part line is priced at the authorised sales price of its branch', () => {
  it('branch row, else company row, else tenant-wide row — never another branch, with its tax class', async () => {
    const item = await freshItem('brake pads');
    const tenantWide = await setPrice(item.id, '5.0000', { company: null });
    // Another branch's row never prices this branch.
    await setPrice(item.id, '99.0000', { branch: BRANCH_A2 });
    const order = await createOpenWorkOrder();

    authAs(SVC_FULL);
    const first = await created(await createQuotation(order.workOrderId, [part(item.id)]));
    const line = first.currentRevision?.lines[0] as Line;
    expect(line).toMatchObject({
      itemKind: 'part',
      serviceId: null,
      item: { id: item.id, code: item.sku, name: item.name },
      unit: { code: 'fx_each', name: 'Fixture each' },
      unitPrice: '5.0000',
      quantity: '2.000',
      taxRate: '0.000000',
      taxAmount: '0.0000',
      lineTotal: '10.0000',
    });
    const stored = await admin.query<{ ref: string; tax: string | null }>(
      `SELECT item_sale_price_ref AS ref, quoted_tax_class_ref AS tax
         FROM quo.quotation_items WHERE id = $1`,
      [line.id]
    );
    expect(stored.rows[0]).toEqual({ ref: tenantWide, tax: null });

    // The company row wins over the tenant-wide row, with its tax class at its rate.
    const companyRow = await setPrice(item.id, '6.0000', { taxClass: TAX_CLASS_A });
    authAs(SVC_FULL);
    const second = await created(await createQuotation(order.workOrderId, [part(item.id)]));
    expect(second.currentRevision?.lines[0]).toMatchObject({
      unitPrice: '6.0000',
      taxRate: '0.100000',
      taxAmount: '1.2000',
      lineTotal: '13.2000',
    });
    const storedCompany = await admin.query<{ ref: string; tax: string | null }>(
      `SELECT item_sale_price_ref AS ref, quoted_tax_class_ref AS tax
         FROM quo.quotation_items WHERE id = $1`,
      [second.currentRevision?.lines[0]?.id]
    );
    expect(storedCompany.rows[0]).toEqual({ ref: companyRow, tax: TAX_CLASS_A });

    // The branch row wins over both.
    await setPrice(item.id, '7.5000', { branch: BRANCH_A1 });
    authAs(SVC_FULL);
    const third = await created(await createQuotation(order.workOrderId, [part(item.id)]));
    expect(third.currentRevision?.lines[0]?.unitPrice).toBe('7.5000');

    // And the other branch's row prices that branch's work orders only.
    const elsewhere = await createOpenWorkOrder({ branchId: BRANCH_A2 });
    authAs(SVC_FULL);
    const there = await created(await createQuotation(elsewhere.workOrderId, [part(item.id)]));
    expect(there.currentRevision?.lines[0]?.unitPrice).toBe('99.0000');
  });

  it('refuses an item with no authorised sales price on the item, and writes nothing', async () => {
    const unpriced = await freshItem('unpriced filter');
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const refused = await createQuotation(order.workOrderId, [
      { serviceId: SERVICE_A, quantity: '1' },
      part(unpriced.id),
    ]);
    expect(refused.status).toBe(422);
    const problem = await bodyOf<Problem>(refused);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations).toEqual([
      { path: 'body.lines[1].itemId', rule: 'no_authorised_sale_price' },
    ]);
    expect(await quotationCount(order.workOrderId)).toBe(0);
  });

  it('refuses an archived item and an item outside the catalogue, by name', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const archived = await createQuotation(order.workOrderId, [part(ITEM_A_ARCHIVED)]);
    expect(archived.status).toBe(422);
    expect((await bodyOf<Problem>(archived)).violations).toEqual([
      { path: 'body.lines[0].itemId', rule: 'item_archived' },
    ]);
    const unknown = await createQuotation(order.workOrderId, [part(randomUUID())]);
    expect(unknown.status).toBe(422);
    expect((await bodyOf<Problem>(unknown)).violations).toEqual([
      { path: 'body.lines[0].itemId', rule: 'item_not_found' },
    ]);
    expect(await quotationCount(order.workOrderId)).toBe(0);
  });

  it('takes no price, unit or cost from the caller, and refuses the other kind’s references', async () => {
    const item = await freshItem('wiper');
    await setPrice(item.id, '3.0000');
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    for (const extra of [{ unitPrice: '0.0100' }, { unit: 'box' }, { cost: '1.0000' }]) {
      const response = await createQuotation(order.workOrderId, [{ ...part(item.id), ...extra }]);
      expect(response.status).toBe(422);
      expect((await bodyOf<Problem>(response)).violations?.map((v) => v.rule)).toContain(
        'unrecognized_keys'
      );
    }
    const mixed = await createQuotation(order.workOrderId, [
      { serviceId: SERVICE_A, itemId: item.id, quantity: '1' },
    ]);
    expect(mixed.status).toBe(422);
    expect((await bodyOf<Problem>(mixed)).violations).toEqual([
      { path: 'body.lines.0.itemId', rule: 'custom' },
    ]);
    expect(await quotationCount(order.workOrderId)).toBe(0);
  });
});

describe('the snapshot is immutable once captured', () => {
  it('keeps price, unit and name through a catalogue change, draft and issued; a revision re-prices', async () => {
    const item = await freshItem('oil filter');
    const priceRow = await setPrice(item.id, '4.2500', { branch: BRANCH_A1 });
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const quotation = await created(await createQuotation(order.workOrderId, [part(item.id)]));
    const quoted = quotation.currentRevision?.lines[0] as Line;

    // The catalogue moves on: a new price, a new unit, a new name.
    const box = await admin.query<{ id: string }>(
      `INSERT INTO inv.units_of_measure (scope, tenant_id, code, name, dimension, created_by)
       VALUES ('tenant',$1,$2,'Fixture box','count',$3) RETURNING id`,
      [TENANT_A, `fx_fd6_box_${serial}`, USER_A]
    );
    await admin.query(`UPDATE inv.item_sale_prices SET unit_price = 9.0000 WHERE id = $1`, [
      priceRow,
    ]);
    await admin.query(`UPDATE inv.item_master SET uom_id = $2, name = $3 WHERE id = $1`, [
      item.id,
      box.rows[0]?.id,
      `${item.name} renamed`,
    ]);

    authAs(SVC_FULL);
    const draft = await readQuotation(quotation.id);
    expect(draft.currentRevision?.lines[0]).toEqual(quoted);

    const issued = await issue(draft);
    expect(issued.status).toBe(200);
    const issuedRevision = await bodyOf<Revision>(issued);
    expect(issuedRevision.lines[0]).toEqual(quoted);

    // A new revision is what takes the catalogue as it is now.
    const current = await readQuotation(quotation.id);
    const revised = await (REVISE as ParamHandler<{ quotationId: string }>)(
      post(
        `http://localhost/api/v1/quotations/${quotation.id}/revisions`,
        { lines: [part(item.id)] },
        current.recordVersion
      ),
      { params: Promise.resolve({ quotationId: quotation.id }) }
    );
    expect(revised.status).toBe(201);
    const next = await bodyOf<Revision>(revised);
    expect(next.lines[0]).toMatchObject({
      unitPrice: '9.0000',
      unit: { code: `fx_fd6_box_${serial}`, name: 'Fixture box' },
      item: { id: item.id, code: item.sku, name: `${item.name} renamed` },
    });

    // The issued revision itself is unchanged when read again by id.
    const again = await bodyOf<Revision>(
      await (READ_REVISION as ParamHandler<{ revisionId: string }>)(
        new Request(`http://localhost/api/v1/quotation-revisions/${issuedRevision.id}`),
        { params: Promise.resolve({ revisionId: issuedRevision.id }) }
      )
    );
    expect(again.lines[0]).toEqual(quoted);
  });
});

describe('a part line discount goes through the discount approval rule', () => {
  it('pending for somebody else, no issue until approved — exactly as a service line', async () => {
    await clearDiscountPolicy(TENANT_A);
    const item = await freshItem('caliper');
    await setPrice(item.id, '40.0000');
    const order = await createOpenWorkOrder();

    authAs(SVC_FULL);
    const plain = await created(await createQuotation(order.workOrderId, [part(item.id)]));
    expect(plain.currentRevision?.discountApproval).toBeNull();

    const partQuote = await created(
      await createQuotation(order.workOrderId, [part(item.id, { discount: '5.000' })])
    );
    const serviceQuote = await created(
      await createQuotation(order.workOrderId, [
        { serviceId: SERVICE_A, quantity: '2', discount: '5.000' },
      ])
    );
    expect(partQuote.currentRevision?.lines[0]?.discount).toBe('5.0000');
    expect(partQuote.currentRevision?.discountApproval?.status).toBe('pending');
    expect(serviceQuote.currentRevision?.discountApproval?.status).toBe('pending');

    // Neither issues while pending, and both are refused the same way.
    const partRefusal = await issue(partQuote);
    const serviceRefusal = await issue(serviceQuote);
    expect(partRefusal.status).toBe(serviceRefusal.status);
    expect(partRefusal.status).toBeGreaterThanOrEqual(400);
    expect((await bodyOf<Problem>(partRefusal)).code).toBe(
      (await bodyOf<Problem>(serviceRefusal)).code
    );

    // Somebody else approves it, and then it issues.
    authAs(SVC_DISCOUNT_APPROVER);
    const decided = await (DECIDE_DISCOUNT as ParamHandler<{ approvalId: string }>)(
      post(
        `http://localhost/api/v1/discount-approvals/${partQuote.currentRevision?.discountApproval?.id}/decision`,
        { decision: 'approved' }
      ),
      {
        params: Promise.resolve({
          approvalId: partQuote.currentRevision?.discountApproval?.id ?? '',
        }),
      }
    );
    expect(decided.status).toBe(200);
    authAs(SVC_FULL);
    expect((await issue(await readQuotation(partQuote.id))).status).toBe(200);
  });
});

describe('a work-order invoice copies the part line and moves no stock', () => {
  it('copies lineType part with its quotation line, item and unit; issuing posts no movement', async () => {
    const item = await freshItem('timing belt');
    await setPrice(item.id, '12.3450', { branch: BRANCH_A1, taxClass: TAX_CLASS_A });
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const quotation = await created(
      await createQuotation(order.workOrderId, [
        { serviceId: SERVICE_A, quantity: '1' },
        part(item.id, { quantity: '1.5' }),
      ])
    );
    const issued = await issue(quotation);
    expect(issued.status).toBe(200);
    const revision = await bodyOf<Revision>(issued);
    const partLine = revision.lines.find((line) => line.itemKind === 'part') as Line;
    expect(partLine.unitPrice).toBe('12.3450');
    const decided = await (DECIDE_REVISION as ParamHandler<{ revisionId: string }>)(
      post(`http://localhost/api/v1/quotation-revisions/${revision.id}/decisions`, {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRef: PARTNER_A,
        presentedRevisionId: revision.id,
      }),
      { params: Promise.resolve({ revisionId: revision.id }) }
    );
    expect(decided.status).toBe(201);

    authAs(SAL_FULL);
    const invoiceResponse = await CREATE_INVOICE(
      post('http://localhost/api/v1/invoices', { workOrderId: order.workOrderId })
    );
    expect(invoiceResponse.status).toBe(201);
    const invoice = await bodyOf<{ invoice: { id: string }; recordVersion: number }>(
      invoiceResponse
    );

    const movements = async (): Promise<number> =>
      (
        await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM inv.stock_movements WHERE tenant_id = $1`,
          [TENANT_A]
        )
      ).rows[0]?.n ?? -1;
    const before = await movements();
    const issuedInvoice = await (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
      post(
        `http://localhost/api/v1/invoices/${invoice.invoice.id}/issuance`,
        undefined,
        invoice.recordVersion
      ),
      { params: Promise.resolve({ invoiceId: invoice.invoice.id }) }
    );
    expect(issuedInvoice.status).toBe(200);
    expect(await movements()).toBe(before);

    const detail = await bodyOf<{
      lines: readonly {
        lineType: string;
        quantity: string;
        sourceQuotationItemId: string | null;
        item: { id: string; code: string; name: string } | null;
        unit: { code: string; name: string } | null;
        money: { unitPrice: { amount: string } } | null;
      }[];
    }>(
      await (READ_INVOICE as ParamHandler<{ invoiceId: string }>)(
        new Request(`http://localhost/api/v1/invoices/${invoice.invoice.id}`),
        { params: Promise.resolve({ invoiceId: invoice.invoice.id }) }
      )
    );
    const billed = detail.lines.find((line) => line.lineType === 'part');
    expect(billed).toMatchObject({
      lineType: 'part',
      quantity: '1.500',
      sourceQuotationItemId: partLine.id,
      item: { id: item.id, code: item.sku, name: item.name },
      unit: { code: 'fx_each', name: 'Fixture each' },
      money: { unitPrice: { amount: '12.3450' } },
    });
    const service = detail.lines.find((line) => line.lineType === 'service');
    expect(service?.unit).toBeNull();
    expect(service?.item).toBeNull();
    // No movement anywhere names this invoice's lines.
    const named = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM inv.stock_movements m
         JOIN sal.invoice_lines l ON l.id = m.reference_id
        WHERE l.invoice_id = $1`,
      [invoice.invoice.id]
    );
    expect(named.rows[0]?.n).toBe(0);
  });
});

describe('isolation and provenance', () => {
  it("another tenant cannot quote this tenant's item, and a branch-scoped caller cannot quote elsewhere", async () => {
    const item = await freshItem('mirror');
    await setPrice(item.id, '8.0000');
    const foreign = await createOpenWorkOrder({
      tenantId: SVC_TENANT_B_FULL.tenantId,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    authAs(SVC_TENANT_B_FULL);
    const refused = await createQuotation(foreign.workOrderId, [part(item.id)]);
    expect(refused.status).toBe(422);
    expect((await bodyOf<Problem>(refused)).violations).toEqual([
      { path: 'body.lines[0].itemId', rule: 'item_not_found' },
    ]);
    // Tenant A cannot quote tenant B's item either.
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const reverse = await createQuotation(order.workOrderId, [part(ITEM_B)]);
    expect((await bodyOf<Problem>(reverse)).violations).toEqual([
      { path: 'body.lines[0].itemId', rule: 'item_not_found' },
    ]);
    // A caller scoped to another branch is refused before any line is priced.
    authAs(SVC_QUO_SCOPED_A2);
    const scoped = await createQuotation(order.workOrderId, [part(item.id)]);
    expect([403, 404]).toContain(scoped.status);
    expect(await quotationCount(order.workOrderId)).toBe(0);
  });

  it('links a required part of its own work order naming the item, and refuses any other', async () => {
    const item = await freshItem('spark plug');
    const other = await freshItem('glow plug');
    await setPrice(item.id, '2.0000');
    const order = await createOpenWorkOrder();
    const elsewhere = await createOpenWorkOrder();
    const required = async (workOrderId: string, itemRef: string | null): Promise<string> =>
      (
        await admin.query<{ id: string }>(
          `INSERT INTO wo.required_parts (tenant_id, company_id, branch_id, work_order_id,
             description, quantity, unit, item_ref, created_by)
           SELECT tenant_id, company_id, branch_id, id, 'Spark plugs', 4, 'each', $2, $3
             FROM wo.work_orders WHERE id = $1 RETURNING id`,
          [workOrderId, itemRef, USER_A]
        )
      ).rows[0]?.id ?? '';
    const own = await required(order.workOrderId, item.id);
    authAs(SVC_FULL);
    const linked = await created(
      await createQuotation(order.workOrderId, [part(item.id, { sourceRequiredPartRef: own })])
    );
    const stored = await admin.query<{ ref: string }>(
      `SELECT source_required_part_ref AS ref FROM quo.quotation_items WHERE id = $1`,
      [linked.currentRevision?.lines[0]?.id]
    );
    expect(stored.rows[0]?.ref).toBe(own);

    const foreignPart = await required(elsewhere.workOrderId, item.id);
    const notOnOrder = await createQuotation(order.workOrderId, [
      part(item.id, { sourceRequiredPartRef: foreignPart }),
    ]);
    expect((await bodyOf<Problem>(notOnOrder)).violations).toEqual([
      { path: 'body.lines[0].sourceRequiredPartRef', rule: 'required_part_not_on_work_order' },
    ]);
    const otherItem = await required(order.workOrderId, other.id);
    const mismatch = await createQuotation(order.workOrderId, [
      part(item.id, { sourceRequiredPartRef: otherItem }),
    ]);
    expect((await bodyOf<Problem>(mismatch)).violations).toEqual([
      { path: 'body.lines[0].sourceRequiredPartRef', rule: 'required_part_item_mismatch' },
    ]);
  });
});
