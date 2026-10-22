/**
 * P1-32-PRE-OD-FD1 — money at the currency's minor unit (ADR-023, D1) and the
 * derived credit status (ADR-023, D7), end to end through their route handlers.
 *
 * Each case fails when the control it names is removed:
 *
 *  - D1, the review's example: a JOD 16% line of 12.345 is quoted at 1.975 tax and
 *    14.320 gross (not 1.9752 / 14.3202), the invoice inherits exactly those
 *    figures, a receipt of exactly the gross settles it, and the delivery
 *    module's financial blocker reads "nothing outstanding".
 *  - D1, USD at two decimals: a counter sale of 10.99 at 16% is taxed 1.76.
 *  - D1, entry: an amount threshold and a fixed discount finer than JOD's three
 *    decimals are refused on their own field with `minor_unit_scale`. A price
 *    rule's amount and an item selling price are UNIT prices, so a four-decimal
 *    one is kept as entered; a quantity of 1.5 is not money and is still
 *    accepted (a 16.5% rate is proved at the database layer, in
 *    `tests/db/sal-minor-unit-rounding.test.ts`).
 *  - D7: an invoice's credit status is `none`, then `partly_credited`, then
 *    `credited` as approved credits reach its gross; a pending or rejected
 *    note counts for nothing; and the payment status is reported apart from it
 *    (`open`, `paid`, `nothing_due`), so a fully credited invoice never reads as
 *    paid.
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
  SVC_FULL,
  SVC_PRICE_SETTER,
  assignPriceList,
  authAs as authAsPricing,
  establishP1_20Fixtures,
  priceListVersionOf,
} from './p1-20-helpers';
import {
  INV_COUNTER,
  ITEM_A,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
  freshLocation,
  seedStock,
} from './p1-21-helpers';
import {
  PAYMENT_METHOD_A,
  SAL_APPROVER,
  SAL_FULL,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { billingModule } from '@/modules/billing';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_PL_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { POST as ISSUE_QUOTATION } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { POST as DECIDE_ITEM } from '@/app/api/v1/quotation-items/[quotationItemId]/decisions/route';
import {
  GET as READ_THRESHOLD,
  POST as SET_THRESHOLD,
} from '@/app/api/v1/discount-thresholds/[companyId]/route';
import { POST as SALE_PRICE_SET } from '@/app/api/v1/items/[itemId]/sale-prices/route';
import { POST as COUNTER_SALE_CREATE } from '@/app/api/v1/counter-sales/route';
import { POST as CREATE_INVOICE } from '@/app/api/v1/invoices/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { GET as READ_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import { POST as REQUEST_CREDIT_NOTE } from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import { POST as APPROVE_CREDIT_NOTE } from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface ProblemBody {
  readonly code: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface SettlementBody {
  readonly creditStatus: string;
  readonly paymentStatus: string;
  readonly refundStatus: string;
  readonly credited: MoneyBody;
  readonly paid: MoneyBody;
}

interface OutstandingBody {
  readonly status: string;
  readonly outstanding: MoneyBody;
  readonly isSettled: boolean;
  readonly settlement: SettlementBody | null;
}

interface QuotationBody {
  readonly id: string;
  readonly recordVersion: number;
  readonly currentRevision: {
    readonly id: string;
    readonly subtotal: string;
    readonly taxTotal: string;
    readonly grandTotal: string;
    readonly lines: readonly {
      readonly id: string;
      readonly quantity: string;
      readonly taxRate: string;
      readonly taxAmount: string;
      readonly lineTotal: string;
    }[];
  } | null;
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const json = (url: string, body: unknown, ifMatch?: number): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** The one violation a minor-unit refusal carries, on the field it names. */
async function expectMinorUnitRefusal(response: Response, path: string): Promise<void> {
  expect(response.status).toBe(422);
  const problem = await bodyOf<ProblemBody>(response);
  expect(problem.code).toBe('ERR-VAL-001');
  expect(problem.violations).toEqual([{ path, rule: 'minor_unit_scale' }]);
}

let taxSixteen = '';
let priority = 900_000;

/** A committed tax class at 16% in COMPANY_A1. */
async function provisionTaxClass(): Promise<string> {
  const taxClass = await admin.query<{ id: string }>(
    `INSERT INTO org.tax_classes (tenant_id, company_id, tax_class_code, name, created_by)
     VALUES ($1,$2,$3,'Minor-unit sixteen',$4) RETURNING id`,
    [TENANT_A, COMPANY_A1, `fx_odfd1_${randomUUID().slice(0, 8)}`, USER_A]
  );
  const id = taxClass.rows[0]?.id ?? '';
  await admin.query(
    `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
     VALUES ($1,$2,$3,0.160000,DATE '2020-01-01',$4)`,
    [TENANT_A, COMPANY_A1, id, USER_A]
  );
  return id;
}

/** A draft JOD price list version, ready for rules. */
async function jodDraftVersion(): Promise<{ listId: string; versionId: string }> {
  // An administrator sets and publishes the fixture price, so a quotation the suite
  // writes as SVC_FULL is not one whose writer set its price (ADR-023 D8).
  authAsPricing(SVC_PRICE_SETTER);
  const list = await bodyOf<{ id: string; recordVersion: number }>(
    await CREATE_LIST(
      json('http://localhost/api/v1/price-lists', {
        priceListCode: `FX-FD1-${randomUUID().slice(0, 8)}`,
        name: 'Minor-unit fixture list',
        currency: 'JOD',
      })
    )
  );
  const version = await bodyOf<{ id: string }>(
    await CREATE_PL_VERSION(
      json(
        `http://localhost/api/v1/price-lists/${list.id}/versions`,
        { effectiveFrom: '2020-01-01' },
        list.recordVersion
      ),
      { params: Promise.resolve({ priceListId: list.id }) }
    )
  );
  return { listId: list.id, versionId: version.id };
}

const recordRule = (listId: string, versionId: string, amount: string): Promise<Response> =>
  RECORD_RULE(
    json(`http://localhost/api/v1/price-lists/${listId}/versions/${versionId}/rules`, {
      serviceId: SERVICE_A,
      amount,
      companyId: COMPANY_A1,
      taxClassId: taxSixteen,
    }),
    { params: Promise.resolve({ priceListId: listId, versionId }) }
  );

/** Publishes and assigns the version so SERVICE_A is priced from it in COMPANY_A1. */
async function publishAndAssign(listId: string, versionId: string): Promise<void> {
  // An administrator sets and publishes the fixture price, so a quotation the suite
  // writes as SVC_FULL is not one whose writer set its price (ADR-023 D8).
  authAsPricing(SVC_PRICE_SETTER);
  const published = await PUBLISH(
    json(
      `http://localhost/api/v1/price-lists/${listId}/versions/${versionId}/publication`,
      { effectiveFrom: '2020-01-01' },
      await priceListVersionOf(listId)
    ),
    { params: Promise.resolve({ priceListId: listId, versionId }) }
  );
  expect(published.status).toBe(200);
  priority += 1;
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: listId,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority,
  });
  authAsPricing(SVC_FULL);
}

const createQuotation = (workOrderId: string, line: Record<string, string>): Promise<Response> =>
  CREATE_QUOTATION(
    json('http://localhost/api/v1/quotations', {
      workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, ...line }],
    })
  );

const readOutstanding = async (invoiceId: string): Promise<OutstandingBody> => {
  const response = await (READ_OUTSTANDING as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`),
    { params: Promise.resolve({ invoiceId }) }
  );
  expect(response.status).toBe(200);
  return bodyOf<OutstandingBody>(response);
};

const requestCredit = async (invoiceId: string, amount: string): Promise<string> => {
  authAs(SAL_FULL);
  const response = await (REQUEST_CREDIT_NOTE as ParamHandler<{ invoiceId: string }>)(
    json(`http://localhost/api/v1/invoices/${invoiceId}/credit-notes`, {
      amount,
      reason: 'minor-unit probe',
    }),
    { params: Promise.resolve({ invoiceId }) }
  );
  expect(response.status).toBe(201);
  return (await bodyOf<{ creditNote: { id: string } }>(response)).creditNote.id;
};

const approveCredit = async (creditNoteId: string): Promise<void> => {
  authAs(SAL_APPROVER);
  const response = await (APPROVE_CREDIT_NOTE as ParamHandler<{ creditNoteId: string }>)(
    new Request(`http://localhost/api/v1/credit-notes/${creditNoteId}/approval`, {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
    }),
    { params: Promise.resolve({ creditNoteId }) }
  );
  expect(response.status).toBe(200);
};

/** Records a receipt of `amount` and allocates all of it to the invoice. */
async function payInFull(invoiceId: string, amount: string, currency: string): Promise<void> {
  authAs(SAL_FULL);
  const receipt = await RECORD_PAYMENT(
    json('http://localhost/api/v1/payments', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency,
      amount,
    })
  );
  expect(receipt.status).toBe(201);
  const paymentId = (await bodyOf<{ id: string }>(receipt)).id;
  const allocated = await (ALLOCATE_PAYMENT as ParamHandler<{ paymentId: string }>)(
    json(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      invoiceId,
      amount,
      currency,
    }),
    { params: Promise.resolve({ paymentId }) }
  );
  expect(allocated.status).toBe(201);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await establishP1_22Fixtures(admin);
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
  taxSixteen = await provisionTaxClass();
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_21Fixtures();
  await cleanP1_22Fixtures();
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('D1 — a JOD 16% line, quoted, invoiced and paid to the fils', () => {
  it('quotes 12.345 at 1.975 tax and 14.320 gross, and a receipt of exactly that settles it', async () => {
    const { listId, versionId } = await jodDraftVersion();
    expect((await recordRule(listId, versionId, '12.345')).status).toBe(201);
    await publishAndAssign(listId, versionId);

    const order = await createOpenWorkOrder();
    authAsPricing(SVC_FULL);
    // A fixed discount is money too: half a fils is refused, on the line's field.
    await expectMinorUnitRefusal(
      await createQuotation(order.workOrderId, { quantity: '1.000', discount: '0.0005' }),
      'body.lines[0].discount'
    );
    const created = await createQuotation(order.workOrderId, { quantity: '1.000' });
    expect(created.status).toBe(201);
    const quotation = await bodyOf<QuotationBody>(created);
    const line = quotation.currentRevision?.lines[0];
    expect(line?.taxAmount).toBe('1.9750');
    expect(line?.lineTotal).toBe('14.3200');

    const issued = await (ISSUE_QUOTATION as ParamHandler<{ quotationId: string }>)(
      json(
        `http://localhost/api/v1/quotations/${quotation.id}/issue`,
        { revisionId: quotation.currentRevision?.id },
        quotation.recordVersion
      ),
      { params: Promise.resolve({ quotationId: quotation.id }) }
    );
    expect(issued.status).toBe(200);
    const revision = await bodyOf<{ id: string; grandTotal: string }>(issued);
    expect(revision.grandTotal).toBe('14.3200');
    const decided = await (DECIDE_ITEM as ParamHandler<{ quotationItemId: string }>)(
      json(`http://localhost/api/v1/quotation-items/${line?.id ?? ''}/decisions`, {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRef: PARTNER_A,
        presentedRevisionId: revision.id,
      }),
      { params: Promise.resolve({ quotationItemId: line?.id ?? '' }) }
    );
    expect(decided.status).toBe(201);

    // The invoice inherits the quotation line's figures, never a recomputation.
    authAs(SAL_FULL);
    const invoiceResponse = await CREATE_INVOICE(
      json('http://localhost/api/v1/invoices', { workOrderId: order.workOrderId })
    );
    expect(invoiceResponse.status).toBe(201);
    const invoice = await bodyOf<{ invoice: { id: string }; recordVersion: number }>(
      invoiceResponse
    );
    const issuedInvoice = await (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
      json(
        `http://localhost/api/v1/invoices/${invoice.invoice.id}/issuance`,
        undefined,
        invoice.recordVersion
      ),
      { params: Promise.resolve({ invoiceId: invoice.invoice.id }) }
    );
    expect(issuedInvoice.status).toBe(200);
    const detail = await bodyOf<{
      invoice: { totals: { net: MoneyBody; tax: MoneyBody; gross: MoneyBody } | null };
      lines: readonly { money: { net: MoneyBody; tax: MoneyBody; gross: MoneyBody } | null }[];
    }>(
      await (READ_INVOICE as ParamHandler<{ invoiceId: string }>)(
        new Request(`http://localhost/api/v1/invoices/${invoice.invoice.id}`),
        { params: Promise.resolve({ invoiceId: invoice.invoice.id }) }
      )
    );
    expect(detail.lines[0]?.money?.net.amount).toBe('12.3450');
    expect(detail.lines[0]?.money?.tax.amount).toBe('1.9750');
    expect(detail.lines[0]?.money?.gross.amount).toBe('14.3200');
    // Reconciliation: the header is the sum of the rounded lines.
    expect(detail.invoice.totals?.gross).toEqual({
      amount: '14.3200',
      currency: 'JOD',
      minorUnit: 3,
    });

    await payInFull(invoice.invoice.id, '14.320', 'JOD');
    const balance = await readOutstanding(invoice.invoice.id);
    expect(balance.outstanding).toEqual({ amount: '0.0000', currency: 'JOD', minorUnit: 3 });
    expect(balance.isSettled).toBe(true);
    expect(balance.settlement).toEqual({
      creditStatus: 'none',
      paymentStatus: 'paid',
      refundStatus: 'none',
      credited: { amount: '0.0000', currency: 'JOD', minorUnit: 3 },
      paid: { amount: '14.3200', currency: 'JOD', minorUnit: 3 },
      // Nothing credited, so nothing owed back (ADR-023 D2).
      refundOwed: { amount: '0.0000', currency: 'JOD', minorUnit: 3 },
      // Nothing paid back either (ADR-023 D2, part 2).
      refunded: { amount: '0.0000', currency: 'JOD', minorUnit: 3 },
      // Nothing credited: the whole gross can still be credited (P1-32-PRE-OD-FD2B).
      creditable: { amount: '14.3200', currency: 'JOD', minorUnit: 3 },
      // Paid by its own customer: no third-party payment (ADR-023 D14).
      thirdPartyPayments: [],
      thirdPartyPaymentsTruncated: false,
    });

    // The delivery module's financial blocker reads the same port: nothing is
    // outstanding, so no residue holds the vehicle.
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
    expect(receivable?.hasOutstanding).toBe(false);
    expect(receivable?.amount).toBe('0.0000');
  });

  it('keeps a quantity of 1.5 at its own scale while rounding the amounts', async () => {
    const order = await createOpenWorkOrder();
    authAsPricing(SVC_FULL);
    const created = await createQuotation(order.workOrderId, { quantity: '1.500' });
    expect(created.status).toBe(201);
    const line = (await bodyOf<QuotationBody>(created)).currentRevision?.lines[0];
    // 12.345 x 1.5 = 18.5175 -> 18.518 net; 16% = 2.96288 -> 2.963; gross 21.481.
    expect(line?.quantity).toBe('1.500');
    expect(line?.taxAmount).toBe('2.9630');
    expect(line?.lineTotal).toBe('21.4810');
  });
});

describe('D1 — entered amounts of money must fit the currency; unit prices keep their scale', () => {
  it('keeps a price rule and an item selling price finer than JOD, because each is a unit price', async () => {
    // A rule amount is the line's unit price (price resolution uses it as one),
    // and so is an item's selling price. The Owner's D1 keeps unit-price
    // precision apart from money: both are stored at four decimals, and only the
    // line's amounts are rounded to the fils.
    const { listId, versionId } = await jodDraftVersion();
    const rule = await recordRule(listId, versionId, '1.2345');
    expect(rule.status).toBe(201);
    expect((await bodyOf<{ amount: string }>(rule)).amount).toBe('1.2345');

    authAs(INV_COUNTER);
    const price = await (SALE_PRICE_SET as ParamHandler<{ itemId: string }>)(
      json(`http://localhost/api/v1/items/${ITEM_A}/sale-prices`, {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        currencyCode: 'JOD',
        unitPrice: '1.2345',
      }),
      { params: Promise.resolve({ itemId: ITEM_A }) }
    );
    expect(price.status).toBeLessThan(300);
    const stored = await admin.query<{ unit_price: string }>(
      `SELECT unit_price::text AS unit_price FROM inv.item_sale_prices
        WHERE item_id = $1 AND company_id = $2 AND branch_id = $3 AND currency_code = 'JOD'
          AND deleted_at IS NULL`,
      [ITEM_A, COMPANY_A1, BRANCH_A1]
    );
    expect(stored.rows.map((r) => r.unit_price)).toEqual(['1.2345']);
  });

  it('refuses an amount threshold finer than JOD', async () => {
    authAsPricing(SVC_FULL);
    const current = await bodyOf<{ recordVersion: number }>(
      await READ_THRESHOLD(
        new Request(`http://localhost/api/v1/discount-thresholds/${COMPANY_A1}`),
        {
          params: Promise.resolve({ companyId: COMPANY_A1 }),
        }
      )
    );
    const amount = await SET_THRESHOLD(
      json(
        `http://localhost/api/v1/discount-thresholds/${COMPANY_A1}`,
        { thresholdKind: 'amount', thresholdValue: '10.0005', currency: 'JOD' },
        current.recordVersion
      ),
      { params: Promise.resolve({ companyId: COMPANY_A1 }) }
    );
    await expectMinorUnitRefusal(amount, 'body.thresholdValue');
  });

  it('taxes a USD counter sale at two decimals: 10.99 at 16% is 1.76, gross 12.75', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '5' });
    authAs(INV_COUNTER);
    const price = await (SALE_PRICE_SET as ParamHandler<{ itemId: string }>)(
      json(`http://localhost/api/v1/items/${ITEM_A}/sale-prices`, {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        currencyCode: 'USD',
        unitPrice: '10.99',
        taxClassId: taxSixteen,
      }),
      { params: Promise.resolve({ itemId: ITEM_A }) }
    );
    expect(price.status).toBeLessThan(300);
    const created = await COUNTER_SALE_CREATE(
      json('http://localhost/api/v1/counter-sales', {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        customerPartnerId: PARTNER_A,
        lines: [{ itemId: ITEM_A, locationId: cell, quantity: '1' }],
      })
    );
    expect(created.status).toBe(201);
    const sale = await bodyOf<{ invoice: { id: string } }>(created);
    // Read as stored, whatever the caller may see: round(10.99 x 0.16, 4) would be
    // 1.7584, a residue no USD receipt settles.
    const stored = await admin.query<{ tax: string; gross: string; line_tax: string }>(
      `SELECT a.tax_total::text AS tax, a.gross_total::text AS gross,
              (SELECT la.tax_amount::text FROM sal.invoice_line_amounts la
                WHERE la.invoice_id = a.invoice_id) AS line_tax
         FROM sal.invoice_amounts a WHERE a.invoice_id = $1`,
      [sale.invoice.id]
    );
    expect(stored.rows[0]).toEqual({ tax: '1.7600', gross: '12.7500', line_tax: '1.7600' });
  });
});

describe('D7 — the credit status is derived, and kept apart from payment', () => {
  it('reads none, partly credited, then credited; pending and rejected notes count for nothing', async () => {
    const invoice = await seedIssuedInvoice('odfd1_credit');
    authAs(SAL_FULL);
    let balance = await readOutstanding(invoice.invoiceId);
    expect(balance.settlement?.creditStatus).toBe('none');
    expect(balance.settlement?.paymentStatus).toBe('open');
    expect(balance.settlement?.refundStatus).toBe('none');

    // A pending note is not a credit.
    const pending = await requestCredit(invoice.invoiceId, '10.0000');
    authAs(SAL_FULL);
    expect((await readOutstanding(invoice.invoiceId)).settlement?.creditStatus).toBe('none');
    // Neither is a rejected one: decided by a different person, as the guard requires.
    await admin.query('BEGIN');
    try {
      await admin.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [SAL_APPROVER.userId, TENANT_A]
      );
      // A rejection states why since ADR-023 D3 (sal.guard_credit_note_decision).
      await admin.query(
        `UPDATE sal.credit_notes SET approval_state = 'rejected', decision_reason = 'Not due'
          WHERE id = $1`,
        [pending]
      );
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
    authAs(SAL_FULL);
    expect((await readOutstanding(invoice.invoiceId)).settlement?.creditStatus).toBe('none');

    await approveCredit(await requestCredit(invoice.invoiceId, '40.0000'));
    authAs(SAL_FULL);
    balance = await readOutstanding(invoice.invoiceId);
    expect(balance.settlement?.creditStatus).toBe('partly_credited');
    expect(balance.settlement?.credited).toEqual({
      amount: '40.0000',
      currency: 'USD',
      minorUnit: 2,
    });
    expect(balance.settlement?.paymentStatus).toBe('open');

    await approveCredit(await requestCredit(invoice.invoiceId, '60.0000'));
    authAs(SAL_FULL);
    balance = await readOutstanding(invoice.invoiceId);
    // Fully credited and never paid: credited, and NOT "paid" or "settled by payment".
    expect(balance.status).toBe('issued');
    expect(balance.settlement?.creditStatus).toBe('credited');
    expect(balance.settlement?.paymentStatus).toBe('nothing_due');
    expect(balance.settlement?.paid).toEqual({ amount: '0.0000', currency: 'USD', minorUnit: 2 });
  });

  it('reads a paid invoice as paid with no credit, and a draft as having no settlement yet', async () => {
    const paid = await seedIssuedInvoice('odfd1_paid');
    await payInFull(paid.invoiceId, '100.00', 'USD');
    authAs(SAL_FULL);
    const balance = await readOutstanding(paid.invoiceId);
    expect(balance.settlement?.creditStatus).toBe('none');
    expect(balance.settlement?.paymentStatus).toBe('paid');

    const draft = await seedIssuedInvoice('odfd1_draft', { draft: true });
    authAs(SAL_FULL);
    expect((await readOutstanding(draft.invoiceId)).settlement).toBeNull();
  });
});
