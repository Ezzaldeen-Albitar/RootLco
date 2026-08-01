/**
 * P1-24 — the cross-domain journey (P1-24-BE-002, P1-24-QA-005, TC-INT-001,
 * TC-P1-24-001, TC-P1-24-002).
 *
 * ===========================================================================
 * WHY THIS EXISTS WHEN EVERY DOMAIN ALREADY HAS DEEP SUITES
 * ===========================================================================
 * Two journeys already exist and both stop at a seam.
 * `p1-19-operational-journey` drives ONE work order from a reception visit to
 * closure, quality control and rework. The P1-22 suites drive billing, payment,
 * delivery and warranty — each starting from `seedWorkOrderChain`, which really does
 * take the reception-conversion route, but which every suite calls afresh.
 *
 * So each half is proven, and the JOIN between them is not. Nothing in the
 * repository takes a single work order from the front door to the customer driving
 * away with a warranty in hand. That is the shape of defect a per-domain suite
 * structurally cannot find: a state one domain leaves behind that the next cannot
 * consume, an ordering that only works because a fixture arranged it, a blocker that
 * never clears because nothing clears it.
 *
 * This file arranges as little as it can and asserts the HANDOVERS, not the
 * operations. Where an assertion here duplicates a domain suite it is deliberate and
 * says so; the value is that it holds on the same aggregate, in sequence, after
 * everything upstream really happened.
 *
 * ===========================================================================
 * WHAT IS ARRANGED RATHER THAN DRIVEN, AND WHY
 * ===========================================================================
 * Two things, both because no route in the shipped surface produces them:
 *
 *  - **the accepted quotation and its issued invoice.** `seedIssuedInvoice` builds
 *    the draft header, its line and the restricted line amounts and then calls
 *    `sal.issue_invoice`, because `sal.guard_invoice_freeze` refuses an INSERT of a
 *    born-issued row. The transition is taken, not faked — it is what allocates the
 *    gapless number and emits the completeness event.
 *  - **the delivery checklist template.** Operator configuration; P1-22 only reads it.
 *
 * Everything else — conversion, transitions, closure, delivery creation, receiver
 * verification, checklist results, signature, completion, payment, allocation,
 * warranty generation, and every read — goes through the exported route handler.
 *
 * ===========================================================================
 * MONEY AND COUNTS
 * ===========================================================================
 * Money is compared as an exact decimal STRING beside its currency. No `Number`,
 * `parseFloat` or arithmetic touches an amount: `numeric(18,4)` holds values
 * IEEE-754 cannot represent, and PostgreSQL rounds a fifth decimal away silently, so
 * a `Number` assertion keeps passing against an implementation that lost a digit.
 *
 * Audit and outbox counts are DELTAS pinned to a specific aggregate. The journey
 * writes real audit and outbox rows at almost every step, so a tenant-wide absolute
 * count would be measuring the arrangement.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { FULL, advance, establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A1,
  COMPANY_A1,
  PARTNER_A,
  PAYMENT_METHOD_A,
  POLICY_ACTIVE,
  SAL_FULL,
  SAL_TENANT_B,
  SIGNATURE_DOCUMENT_VERSION,
  TENANT_A,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  linkSignatureDocumentToWorkOrder,
  outboxCountFor,
  seedIssuedInvoice,
  type IssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as READ_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { POST as CREATE_DELIVERY } from '@/app/api/v1/deliveries/route';
import { GET as READ_ELIGIBILITY } from '@/app/api/v1/deliveries/[deliveryId]/eligibility/route';
import { POST as VERIFY_RECEIVER } from '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';
import { POST as RECORD_CHECKLIST } from '@/app/api/v1/deliveries/[deliveryId]/checklist-results/route';
import { POST as ATTACH_SIGNATURE } from '@/app/api/v1/deliveries/[deliveryId]/signatures/route';
import { POST as COMPLETE_DELIVERY } from '@/app/api/v1/deliveries/[deliveryId]/completion/route';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import { GET as READ_WARRANTY } from '@/app/api/v1/warranties/[warrantyId]/route';

let admin: Pool;

const ODOMETER = '123456.0';

interface ProblemBody {
  readonly code?: string;
  readonly status?: number;
  readonly blockers?: readonly string[];
}

interface Answer<T> {
  readonly status: number;
  readonly body: T;
}

async function post<T>(
  handler: unknown,
  url: string,
  params: Record<string, string>,
  body: unknown,
  options: { readonly ifMatch?: number } = {}
): Promise<Answer<T>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
  };
  if (options.ifMatch !== undefined) headers['if-match'] = String(options.ifMatch);
  const response = await (
    handler as (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>
  )(
    new Request(`http://localhost/api/v1${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

async function get<T>(
  handler: unknown,
  url: string,
  params: Record<string, string>
): Promise<Answer<T>> {
  const response = await (
    handler as (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>
  )(new Request(`http://localhost/api/v1${url}`, { method: 'GET' }), {
    params: Promise.resolve(params),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

/**
 * Drives the work order to `closed` through the real routes.
 *
 * The last edge is deliberately NOT on `.../transition`: `WorkOrderService` refuses a
 * terminal non-cancellation state there, because ending the workshop's liability is
 * its own authority behind `wo.work_order.close`. The journey takes the same route a
 * client must.
 */
async function closeWorkOrder(workOrderId: string): Promise<void> {
  const version = await advance(
    workOrderId,
    [
      { toState: 'open' },
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ],
    FULL
  );
  authAs(FULL);
  const closed = await post<unknown>(
    CLOSE_WORK_ORDER,
    `/work-orders/${workOrderId}/closure`,
    { workOrderId },
    { toState: 'closed' },
    { ifMatch: version }
  );
  expect(closed.status).toBe(200);
}

/**
 * The handover checklist template — operator configuration with no write route.
 *
 * One MANDATORY item, so `checklist_incomplete` is a blocker that can actually fire.
 * A journey run against a company with no mandatory item would clear the checklist
 * gate by having nothing to check, which is the quiet way to make an integration test
 * prove less than it appears to.
 */
const TEMPLATE_ID = 'f2400000-0000-4000-8000-000000000001';

async function seedChecklistTemplate(): Promise<void> {
  await admin.query(
    `INSERT INTO sal.delivery_checklist_templates
       (id, tenant_id, company_id, template_code, name, created_by)
     VALUES ($1,$2,$3,'fx_p24_handover','P1-24 handover checklist',$4)
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_ID, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO sal.delivery_checklist_template_items
       (tenant_id, company_id, template_id, item_code, label, is_mandatory, sort_order, created_by)
     VALUES ($1,$2,$3,'fx_p24_mandatory','P1-24 mandatory handover item',true,0,$4)
     ON CONFLICT (tenant_id, template_id, item_code) WHERE deleted_at IS NULL DO NOTHING`,
    [TENANT_A, COMPANY_A1, TEMPLATE_ID, USER_A]
  );
}

async function passEveryMandatoryItem(deliveryId: string): Promise<void> {
  const items = await admin.query<{ id: string }>(
    `SELECT id FROM sal.delivery_checklist_template_items
      WHERE tenant_id = $1 AND company_id = $2 AND is_mandatory AND deleted_at IS NULL`,
    [TENANT_A, COMPANY_A1]
  );
  expect(items.rowCount).toBeGreaterThan(0);
  for (const item of items.rows) {
    authAs(SAL_FULL);
    const recorded = await post<unknown>(
      RECORD_CHECKLIST,
      `/deliveries/${deliveryId}/checklist-results`,
      { deliveryId },
      { templateItemId: item.id, outcome: 'passed' }
    );
    expect([200, 201]).toContain(recorded.status);
  }
}

async function settle(invoice: IssuedInvoice): Promise<void> {
  authAs(SAL_FULL);
  const receipt = await post<{ id: string }>(
    RECORD_PAYMENT,
    '/payments',
    {},
    {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency: invoice.currencyCode,
      amount: invoice.gross,
    }
  );
  expect(receipt.status).toBe(201);

  authAs(SAL_FULL);
  const allocation = await post<{ money: { amount: string; currency: string } }>(
    ALLOCATE_PAYMENT,
    `/payments/${receipt.body.id}/allocations`,
    { paymentId: receipt.body.id },
    { invoiceId: invoice.invoiceId, amount: invoice.gross, currency: invoice.currencyCode }
  );
  expect(allocation.status).toBe(201);
  // Exact decimal STRING and its currency — the amount alone is half an assertion.
  expect(allocation.body.money.amount).toBe(invoice.gross);
  expect(allocation.body.money.currency).toBe(invoice.currencyCode);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
  await seedChecklistTemplate();
}, 240_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __resetAuthenticatorForTests();
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  await admin?.end();
});

describe('TC-INT-001 — one work order from the front door to the warranty', () => {
  it('carries a single aggregate across every domain seam', async () => {
    const tag = `j${randomUUID().slice(0, 6)}`;

    // --- reception → work order → invoice ---------------------------------
    // `seedIssuedInvoice` converts a real reception visit through the real
    // conversion route, then takes the draft → issued transition.
    const invoice = await seedIssuedInvoice(tag);
    expect(invoice.workOrderId).toBeTruthy();
    expect(invoice.invoiceNumber).not.toBe('');

    // The work order the invoice names is readable, and it is the one the
    // conversion produced — the first seam.
    authAs(FULL);
    const workOrder = await get<{ workOrder: { id: string; state: string } }>(
      READ_WORK_ORDER,
      `/work-orders/${invoice.workOrderId}`,
      { workOrderId: invoice.workOrderId }
    );
    expect(workOrder.status).toBe(200);
    expect(workOrder.body.workOrder.id).toBe(invoice.workOrderId);

    // --- the invoice is outstanding --------------------------------------
    // Read through the route, then confirmed against the derived receivable.
    authAs(SAL_FULL);
    const issued = await get<{ invoice: { id: string; status: string; workOrderId: string } }>(
      READ_INVOICE,
      `/invoices/${invoice.invoiceId}`,
      { invoiceId: invoice.invoiceId }
    );
    expect(issued.status).toBe(200);
    expect(issued.body.invoice.status).toBe('issued');
    // The invoice names the SAME work order the conversion produced — the seam.
    expect(issued.body.invoice.workOrderId).toBe(invoice.workOrderId);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe(invoice.gross);

    // --- work order closure ----------------------------------------------
    await closeWorkOrder(invoice.workOrderId);

    // --- delivery preparation --------------------------------------------
    await linkSignatureDocumentToWorkOrder(invoice.workOrderId);
    authAs(SAL_FULL);
    const delivery = await post<{ id: string }>(
      CREATE_DELIVERY,
      '/deliveries',
      {},
      { workOrderId: invoice.workOrderId, deliveringEmployeeId: USER_A }
    );
    expect(delivery.status).toBe(201);
    const deliveryId = delivery.body.id;

    await passEveryMandatoryItem(deliveryId);
    authAs(SAL_FULL);
    const receiver = await post<unknown>(
      VERIFY_RECEIVER,
      `/deliveries/${deliveryId}/authorized-receiver`,
      { deliveryId },
      { receiverPartnerId: PARTNER_A }
    );
    expect(receiver.status).toBe(201);
    authAs(SAL_FULL);
    const signature = await post<unknown>(
      ATTACH_SIGNATURE,
      `/deliveries/${deliveryId}/signatures`,
      { deliveryId },
      { signerRole: 'receiver', signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION }
    );
    expect(signature.status).toBe(201);

    // --- THE SEAM THAT MATTERS MOST --------------------------------------
    // Every non-financial gate is now satisfied, so `blockers` is exactly the
    // financial one. This is the assertion that the billing domain's state
    // genuinely reaches the delivery domain's decision, on this aggregate,
    // rather than on a fixture arranged to look like it.
    authAs(SAL_FULL);
    const blocked = await get<{ blockers: readonly string[] }>(
      READ_ELIGIBILITY,
      `/deliveries/${deliveryId}/eligibility`,
      { deliveryId }
    );
    expect(blocked.status).toBe(200);
    expect(blocked.body.blockers).toEqual(['financial_balance_outstanding']);

    // …and completion is refused while it stands.
    authAs(SAL_FULL);
    const refused = await post<ProblemBody>(
      COMPLETE_DELIVERY,
      `/deliveries/${deliveryId}/completion`,
      { deliveryId },
      { finalOdometerValue: ODOMETER, odometerUnit: 'km' },
      { ifMatch: 1 }
    );
    expect(refused.status).toBeGreaterThanOrEqual(400);

    // --- payment clears the blocker --------------------------------------
    await settle(invoice);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');

    authAs(SAL_FULL);
    const clear = await get<{ blockers: readonly string[] }>(
      READ_ELIGIBILITY,
      `/deliveries/${deliveryId}/eligibility`,
      { deliveryId }
    );
    expect(clear.status).toBe(200);
    expect(clear.body.blockers).toEqual([]);

    // --- handover ---------------------------------------------------------
    // The event key EMBEDS the aggregate id — that is the identity the publisher
    // deduplicates on. Counting by bare event type would let another delivery's
    // event satisfy this assertion.
    const deliveredKey = `vehicle.delivered:${deliveryId}`;
    const deliveredBefore = await outboxCountFor(deliveredKey);
    const version = await admin
      .query<{ v: number }>('SELECT record_version AS v FROM sal.delivery_records WHERE id = $1', [
        deliveryId,
      ])
      .then((r) => r.rows[0]?.v ?? 0);

    authAs(SAL_FULL);
    const completed = await post<unknown>(
      COMPLETE_DELIVERY,
      `/deliveries/${deliveryId}/completion`,
      { deliveryId },
      { finalOdometerValue: ODOMETER, odometerUnit: 'km' },
      { ifMatch: version }
    );
    expect(completed.status).toBe(200);
    // The event is a DELTA of exactly one, not an absolute count.
    expect(await outboxCountFor(deliveredKey)).toBe(deliveredBefore + 1);

    const delivered = await admin.query<{ status: string; odo: string | null }>(
      `SELECT d.status,
              o.value::text AS odo
         FROM sal.delivery_records d
         LEFT JOIN veh.odometer_readings o ON o.id = d.final_odometer_reading_id
        WHERE d.id = $1`,
      [deliveryId]
    );
    expect(delivered.rows[0]?.status).toBe('delivered');
    // The odometer captured at handover is the vehicle domain's row, reached
    // through the delivery domain — the last seam, and money-grade exactness.
    expect(delivered.rows[0]?.odo).toBe(ODOMETER);

    // --- warranty ---------------------------------------------------------

    authAs(SAL_FULL);
    const warranty = await post<{ id: string }>(
      GENERATE_WARRANTY,
      `/deliveries/${deliveryId}/warranties`,
      { deliveryId },
      // The policy is NAMED. The fixtures seed more than one active policy for this
      // company, and the route refuses to guess which legal term a customer's
      // warranty falls under — omitting it is a configuration error, not a default.
      { policyId: POLICY_ACTIVE }
    );
    expect([200, 201]).toContain(warranty.status);

    authAs(SAL_FULL);
    const readBack = await get<{ id: string; deliveryRecordId?: string }>(
      READ_WARRANTY,
      `/warranties/${warranty.body.id}`,
      { warrantyId: warranty.body.id }
    );
    expect(readBack.status).toBe(200);
    expect(readBack.body.id).toBe(warranty.body.id);

    // Audited exactly once, against the WARRANTY — the audit record's entity is the
    // record that was issued, not the delivery it was issued from. Counting against
    // the delivery would be a vacuous zero-to-zero comparison.
    expect(await auditCountFor('wty.warranty.issued', warranty.body.id)).toBe(1);

    // --- the whole arc is invisible from the other tenant -----------------
    // Bidirectional isolation on the FINISHED aggregate, at four different
    // domains, rather than four independent fixtures that were never joined.
    authAs(SAL_TENANT_B);
    for (const probe of [
      get(READ_WORK_ORDER, `/work-orders/${invoice.workOrderId}`, {
        workOrderId: invoice.workOrderId,
      }),
      get(READ_INVOICE, `/invoices/${invoice.invoiceId}`, { invoiceId: invoice.invoiceId }),
      get(READ_ELIGIBILITY, `/deliveries/${deliveryId}/eligibility`, { deliveryId }),
      get(READ_WARRANTY, `/warranties/${warranty.body.id}`, { warrantyId: warranty.body.id }),
    ]) {
      const answer = await probe;
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(answer.status).toBeLessThan(500);
    }
  }, 240_000);
});

describe('TC-P1-24-001 — an invalid lifecycle order is refused at the seam', () => {
  it('refuses a warranty for a delivery that has not completed', async () => {
    const tag = `w${randomUUID().slice(0, 6)}`;
    const invoice = await seedIssuedInvoice(tag);
    await closeWorkOrder(invoice.workOrderId);
    await linkSignatureDocumentToWorkOrder(invoice.workOrderId);

    authAs(SAL_FULL);
    const delivery = await post<{ id: string }>(
      CREATE_DELIVERY,
      '/deliveries',
      {},
      { workOrderId: invoice.workOrderId, deliveringEmployeeId: USER_A }
    );
    expect(delivery.status).toBe(201);

    const deliveredKey = `vehicle.delivered:${delivery.body.id}`;
    const before = await outboxCountFor(deliveredKey);
    authAs(SAL_FULL);
    const warranty = await post<ProblemBody>(
      GENERATE_WARRANTY,
      `/deliveries/${delivery.body.id}/warranties`,
      { deliveryId: delivery.body.id },
      { policyId: POLICY_ACTIVE }
    );

    // Refused, and — the part a status code alone would not prove — the refusal
    // left no trace: no warranty row, and no handover event.
    expect(warranty.status).toBeGreaterThanOrEqual(400);
    expect(warranty.status).toBeLessThan(500);
    const warranties = await admin.query(
      'SELECT 1 FROM wty.warranty_records WHERE delivery_record_id = $1',
      [delivery.body.id]
    );
    expect(warranties.rowCount).toBe(0);
    expect(await outboxCountFor(deliveredKey)).toBe(before);
  }, 180_000);
});

describe('TC-P1-24-002 — a duplicate command commits once', () => {
  it('replaying the delivery-creation key returns the first delivery, not a second', async () => {
    const tag = `d${randomUUID().slice(0, 6)}`;
    const invoice = await seedIssuedInvoice(tag);
    await closeWorkOrder(invoice.workOrderId);
    await linkSignatureDocumentToWorkOrder(invoice.workOrderId);

    const key = randomUUID();
    const send = async (): Promise<Answer<{ id: string }>> => {
      authAs(SAL_FULL);
      const response = await (
        CREATE_DELIVERY as unknown as (
          r: Request,
          c: { params: Promise<Record<string, string>> }
        ) => Promise<Response>
      )(
        new Request('http://localhost/api/v1/deliveries', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify({
            workOrderId: invoice.workOrderId,
            deliveringEmployeeId: USER_A,
          }),
        }),
        { params: Promise.resolve({}) }
      );
      const text = await response.text();
      return { status: response.status, body: JSON.parse(text) as { id: string } };
    };

    const first = await send();
    expect(first.status).toBe(201);
    const second = await send();

    // Same key, same payload: the stored response comes back and the world is
    // unchanged. Counting the rows is what makes this an idempotency assertion
    // rather than a statement about the response body.
    expect(second.body.id).toBe(first.body.id);
    const rows = await admin.query('SELECT 1 FROM sal.delivery_records WHERE work_order_id = $1', [
      invoice.workOrderId,
    ]);
    expect(rows.rowCount).toBe(1);
  }, 180_000);
});
