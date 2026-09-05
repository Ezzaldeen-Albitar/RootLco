/**
 * P1-30 W7 — the payment contract the frontend consumes (FE-016 payment form,
 * FE-017 partial payment, FE-018 receipt, FE-021 receipt print).
 *
 * The payment screen renders three reads and two writes. This suite proves, on
 * the SHIPPED routes, the exact properties the screen relies on and states to
 * the operator — the routes' full behaviour belongs to the P1-22 suites
 * (`p1-22-payments`, `p1-22-concurrency`, `p1-22-currency-coherence`,
 * `p1-22-isolation`) and the A2 seam suite (`p1-30-a2-published-reads`).
 *
 * ## What the screen says, and where each statement is proved here
 *
 * - "This organisation has no payment method of its own yet": a PLATFORM method
 *   is refused at record time with 422 on `body.paymentMethodId`, and the list
 *   marks every platform row `recordable: false`. The screen offers only the
 *   rows it may cite, so this proves the filter is the right one.
 * - "Name the branch": the list REFUSES a request with no target (422) rather
 *   than answering some union of branches, and answers the named branch only.
 * - "Recorded / already recorded": a SAME-key retry replays the stored answer
 *   (status 200) whose `replayed` is false and whose reference is unchanged —
 *   no second receipt and no second number. The screen therefore reads the
 *   server's own flag and never infers a replay from the key it reused.
 * - "An entry cannot be undone": there is no reversal route; this suite asserts
 *   the append-only shape by proving a second allocation ADDS a row and the
 *   remainder falls again, never rises.
 * - "At most what is left, and at most what is still open": both bounds refuse
 *   with 409 `ERR-TRN-001` and leave zero rows behind.
 * - "Still open on that invoice": the allocation echo carries the RECEIPT's new
 *   remainder and NOT the invoice's balance, which the outstanding read gives.
 * - Every money figure is asserted as a LITERAL string beside its currency;
 *   nothing is computed in this file.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.receipt-list: route service authorization success denial
 *   sal.receipt-detail: route service authorization success denial cross-tenant
 *   sal.payment-method-list: route service authorization success denial
 *   sal.payment-record: route service authorization success denial idempotency
 *   sal.payment-allocate: route service authorization success denial idempotency
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  PARTNER_A,
  PAYMENT_METHOD_A,
  PAYMENT_METHOD_A_INACTIVE,
  SAL_FULL,
  SAL_NO_FINANCE,
  SAL_READER,
  SAL_TENANT_B,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  platformPaymentMethodId,
  receiptUnallocated,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST_RECEIPTS, POST as RECORD } from '@/app/api/v1/payments/route';
import { GET as READ_RECEIPT } from '@/app/api/v1/payments/[paymentId]/route';
import { POST as ALLOCATE } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { GET as METHODS } from '@/app/api/v1/payment-methods/route';
import { GET as OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';

let admin: Pool;

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}
interface ReceiptBody {
  readonly id: string;
  readonly reference: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly payerPartnerId: string;
  readonly paymentMethodId?: string;
  readonly method?: {
    readonly id: string;
    readonly scope: string;
    readonly kind: string;
    readonly displayName: string;
    readonly status: string;
  } | null;
  readonly money: MoneyBody;
  readonly unallocated?: MoneyBody;
  readonly status: string;
  readonly receivedAt: string;
  readonly recordVersion: number;
  readonly replayed?: boolean;
}
interface DetailBody extends ReceiptBody {
  readonly unallocated: MoneyBody;
  readonly allocations: readonly {
    readonly id: string;
    readonly sequence: string;
    readonly invoiceId: string;
    readonly money: MoneyBody;
    readonly allocatedAt: string;
  }[];
  readonly allocationsTruncated: boolean;
}
interface AllocationBody {
  readonly id: string;
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly money: MoneyBody;
  readonly receiptStatus: string;
  readonly receiptUnallocated: MoneyBody;
}
interface MethodsBody {
  readonly items: readonly {
    readonly id: string;
    readonly scope: string;
    readonly kind: string;
    readonly displayName: string;
    readonly recordable: boolean;
  }[];
}
interface PageBody {
  readonly items: readonly ReceiptBody[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
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
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  (await bodyOf<ProblemBody>(response)).code;

const methods = (): Promise<Response> =>
  METHODS(new Request('http://localhost/api/v1/payment-methods'));
const listReceipts = (query: string): Promise<Response> =>
  LIST_RECEIPTS(new Request(`http://localhost/api/v1/payments${query}`));
const record = (payload: unknown, key = randomUUID()): Promise<Response> =>
  RECORD(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(payload),
    })
  );
const readReceipt = (paymentId: string): Promise<Response> =>
  READ_RECEIPT(new Request(`http://localhost/api/v1/payments/${paymentId}`), {
    params: Promise.resolve({ paymentId }),
  });
const allocate = (paymentId: string, payload: unknown, key = randomUUID()): Promise<Response> =>
  ALLOCATE(
    new Request(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ paymentId }) }
  );
const outstanding = (invoiceId: string): Promise<Response> =>
  OUTSTANDING(new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`), {
    params: Promise.resolve({ invoiceId }),
  });

const allocationRowsFor = async (receiptId: string): Promise<number> => {
  const result = await admin.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM sal.payment_allocations WHERE receipt_id = $1`,
    [receiptId]
  );
  return Number(result.rows[0]?.count ?? '0');
};

/**
 * A recording request in the ONE company and branch the fixtures provision a
 * `receipt` number sequence for. Without that row the primitive raises
 * `no_data_found`, which the service answers as a 404 naming a configuration
 * problem — the refusal the screen tells an operator to have provisioned.
 */
const payment = (amount: string): Record<string, string> => ({
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  paymentMethodId: PAYMENT_METHOD_A,
  payerPartnerId: PARTNER_A,
  currency: 'USD',
  amount,
});

/** A recorded receipt in the fixture branch, through the SHIPPED route. */
async function recordedReceipt(amount: string): Promise<ReceiptBody> {
  authAs(SAL_FULL);
  const response = await record(payment(amount));
  if (response.status !== 201) {
    throw new Error(`fixture receipt of ${amount} failed with ${response.status}`);
  }
  return bodyOf<ReceiptBody>(response);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
}, 180_000);

afterAll(async () => {
  __resetAuthenticatorForTests();
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
}, 120_000);

describe('the method picker the payment form depends on', () => {
  it('marks every platform row unusable and the tenant row usable, and refuses a caller without the RECORDING code', async () => {
    authAs(SAL_FULL);
    const response = await methods();
    expect(response.status).toBe(200);
    const body = await bodyOf<MethodsBody>(response);
    const platform = body.items.filter((item) => item.scope === 'platform');
    expect(platform.length).toBeGreaterThan(0);
    for (const item of platform) expect(item.recordable).toBe(false);
    const tenant = body.items.find((item) => item.id === PAYMENT_METHOD_A);
    expect(tenant?.recordable).toBe(true);
    expect(tenant?.scope).toBe('tenant');
    // An inactive tenant row is not listed at all, so the form cannot offer it.
    expect(body.items.some((item) => item.id === PAYMENT_METHOD_A_INACTIVE)).toBe(false);

    // The list is gated by `sal.payment.record`, a WRITE code: a reader holding
    // `sal.finance.view` — who may see receipts — is refused it.
    authAs(SAL_READER);
    const refused = await methods();
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  }, 60_000);

  it('refuses a PLATFORM method at record time, on the field that named it', async () => {
    authAs(SAL_FULL);
    const response = await record({
      ...payment('10.0000'),
      paymentMethodId: platformPaymentMethodId(),
    });
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.paymentMethodId');
  }, 60_000);
});

describe('the branch list the screen opens on', () => {
  it('REFUSES a request that names no branch, rather than answering a union', async () => {
    authAs(SAL_FULL);
    const response = await listReceipts('');
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
  }, 60_000);

  it('answers the named branch with the server’s own strings, and no cashier', async () => {
    const receipt = await recordedReceipt('25.0000');
    authAs(SAL_FULL);
    const response = await listReceipts(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=50`);
    expect(response.status).toBe(200);
    const body = await bodyOf<PageBody>(response);
    const seen = body.items.find((item) => item.id === receipt.id);
    expect(seen?.money.amount).toBe('25.0000');
    expect(seen?.money.currency).toBe('USD');
    expect(seen?.unallocated?.amount).toBe('25.0000');
    expect(seen?.status).toBe('recorded');
    expect(seen?.method?.id).toBe(PAYMENT_METHOD_A);
    // No cashier identity travels on the list, so the screen has none to show.
    expect(JSON.stringify(body)).not.toContain('receivedBy');
  }, 60_000);

  it('refuses a caller without finance view, and another tenant sees nothing of it', async () => {
    const receipt = await recordedReceipt('19.0000');
    const query = `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

    authAs(SAL_NO_FINANCE);
    const denied = await listReceipts(query);
    expect(denied.status).toBe(403);
    expect(await codeOf(denied)).toBe('ERR-IAM-001');

    authAs(SAL_TENANT_B);
    const other = await readReceipt(receipt.id);
    expect(other.status).toBe(404);
    expect(await codeOf(other)).toBe('ERR-RES-001');
  }, 60_000);
});

describe('recording a payment', () => {
  it('records once, and a SAME-key retry replays the stored answer with the same reference', async () => {
    const key = randomUUID();
    authAs(SAL_FULL);
    const payload = payment('100.0000');
    const first = await record(payload, key);
    expect(first.status).toBe(201);
    const receipt = await bodyOf<ReceiptBody>(first);
    expect(receipt.money.amount).toBe('100.0000');
    expect(receipt.status).toBe('recorded');
    expect(receipt.replayed).toBe(false);
    expect(typeof receipt.reference).toBe('string');
    expect(receipt.reference.length).toBeGreaterThan(0);
    // The echo names the method by id and carries NO remainder: the screen must
    // re-read the receipt for that figure, which is why the adapter does.
    expect(receipt.paymentMethodId).toBe(PAYMENT_METHOD_A);
    expect(receipt.unallocated).toBeUndefined();

    const replay = await record(payload, key);
    // 200, not 201: the transport answers with the STORED document, and the
    // flag inside it is the one first written — NOT `replayed: true`.
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<ReceiptBody>(replay);
    expect(replayed.id).toBe(receipt.id);
    expect(replayed.reference).toBe(receipt.reference);
    expect(replayed.replayed).toBe(false);
    expect(await receiptUnallocated(receipt.id)).toBe('100.0000');
  }, 60_000);

  it('refuses the same key with a different amount, and the first receipt stands', async () => {
    const key = randomUUID();
    authAs(SAL_FULL);
    const first = await record(payment('10.0000'), key);
    expect(first.status).toBe(201);
    const conflicting = await record(payment('11.0000'), key);
    expect(conflicting.status).toBe(409);
    expect(await codeOf(conflicting)).toBe('ERR-INT-001');
    const receipt = await bodyOf<ReceiptBody>(first);
    expect(await receiptUnallocated(receipt.id)).toBe('10.0000');
  }, 60_000);

  it('refuses a non-positive or over-precise amount before anything is written', async () => {
    authAs(SAL_FULL);
    for (const amount of ['0', '0.0000', '-1', '1.00005']) {
      const response = await record(payment(amount));
      expect(response.status, amount).toBe(422);
      expect(await codeOf(response)).toBe('ERR-VAL-001');
    }
  }, 60_000);

  it('refuses a caller who may see money but may not take it', async () => {
    authAs(SAL_READER);
    const response = await record(payment('13.0000'));
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe('ERR-IAM-001');
  }, 60_000);
});

describe('applying a receipt to an invoice', () => {
  it('applies part of it, states the receipt’s new remainder, and leaves the invoice balance to its own read', async () => {
    const invoice = await seedIssuedInvoice('w7_partial');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
    const receipt = await recordedReceipt('100.0000');

    authAs(SAL_FULL);
    const response = await allocate(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(201);
    const allocation = await bodyOf<AllocationBody>(response);
    expect(allocation.money.amount).toBe('60.0000');
    expect(allocation.receiptStatus).toBe('partially_allocated');
    expect(allocation.receiptUnallocated.amount).toBe('40.0000');
    // The echo carries the RECEIPT's remainder and NOT the invoice's balance.
    expect(JSON.stringify(allocation)).not.toContain('outstanding');

    const open = await outstanding(invoice.invoiceId);
    expect(open.status).toBe(200);
    const balance = await bodyOf<OutstandingBody>(open);
    expect(balance.outstanding.amount).toBe('40.0000');
    expect(balance.isSettled).toBe(false);

    // A second application ADDS a row and lowers the remainder again: the rows
    // are append-only and no route takes one back.
    const second = await allocate(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '40.0000',
      currency: 'USD',
    });
    expect(second.status).toBe(201);
    expect(await allocationRowsFor(receipt.id)).toBe(2);
    expect(await receiptUnallocated(receipt.id)).toBe('0.0000');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');
    const settled = await bodyOf<OutstandingBody>(await outstanding(invoice.invoiceId));
    expect(settled.outstanding.amount).toBe('0.0000');
    expect(settled.isSettled).toBe(true);
  }, 90_000);

  it('refuses more than the receipt holds, and more than the invoice still owes, leaving no row', async () => {
    const small = await seedIssuedInvoice('w7_bound_receipt');
    const shortReceipt = await recordedReceipt('50.0000');
    authAs(SAL_FULL);
    const overReceipt = await allocate(shortReceipt.id, {
      invoiceId: small.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    expect(overReceipt.status).toBe(409);
    expect(await codeOf(overReceipt)).toBe('ERR-TRN-001');
    expect(await allocationRowsFor(shortReceipt.id)).toBe(0);
    expect(await receiptUnallocated(shortReceipt.id)).toBe('50.0000');

    const cheap = await seedIssuedInvoice('w7_bound_invoice', { net: '40.0000' });
    const bigReceipt = await recordedReceipt('100.0000');
    authAs(SAL_FULL);
    const overInvoice = await allocate(bigReceipt.id, {
      invoiceId: cheap.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    expect(overInvoice.status).toBe(409);
    expect(await codeOf(overInvoice)).toBe('ERR-TRN-001');
    expect(await allocationRowsFor(bigReceipt.id)).toBe(0);
    expect(await invoiceOpenReceivable(cheap.invoiceId)).toBe('40.0000');
  }, 90_000);

  it('refuses a currency that disagrees with the receipt, on the field it came from', async () => {
    const invoice = await seedIssuedInvoice('w7_currency');
    const receipt = await recordedReceipt('100.0000');
    authAs(SAL_FULL);
    const response = await allocate(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'EUR',
    });
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    // The route renames the field, so the violation names `currencyCode`.
    expect(problem.violations?.[0]?.path).toBe('body.currencyCode');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
  }, 60_000);

  it('replays a same-key retry as the SAME allocation, adding no second row', async () => {
    const invoice = await seedIssuedInvoice('w7_alloc_replay');
    const receipt = await recordedReceipt('100.0000');
    const key = randomUUID();
    const payload = { invoiceId: invoice.invoiceId, amount: '30.0000', currency: 'USD' };
    authAs(SAL_FULL);
    const first = await allocate(receipt.id, payload, key);
    expect(first.status).toBe(201);
    const replay = await allocate(receipt.id, payload, key);
    // The stored answer, at 200 — and the allocation echo has no `replayed`
    // field at all, which is why the screen never looks for one.
    expect(replay.status).toBe(200);
    const original = await bodyOf<AllocationBody>(first);
    const again = await bodyOf<AllocationBody>(replay);
    expect(again.id).toBe(original.id);
    expect(JSON.stringify(again)).not.toContain('replayed');
    expect(await allocationRowsFor(receipt.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('70.0000');
  }, 60_000);

  it('refuses a caller without the allocation authority, and one from another tenant', async () => {
    const invoice = await seedIssuedInvoice('w7_alloc_denied');
    const receipt = await recordedReceipt('100.0000');
    const payload = { invoiceId: invoice.invoiceId, amount: '10.0000', currency: 'USD' };

    authAs(SAL_READER);
    const denied = await allocate(receipt.id, payload);
    expect(denied.status).toBe(403);
    expect(await codeOf(denied)).toBe('ERR-IAM-001');

    authAs(SAL_TENANT_B);
    const other = await allocate(receipt.id, payload);
    expect(other.status).toBe(404);
    expect(await codeOf(other)).toBe('ERR-RES-001');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
  }, 60_000);
});

describe('the receipt the screen and its printed copy render', () => {
  it('carries the reference, the method, both figures and the history — and no name, cashier or note', async () => {
    const invoice = await seedIssuedInvoice('w7_detail');
    const receipt = await recordedReceipt('100.0000');
    authAs(SAL_FULL);
    expect(
      (
        await allocate(receipt.id, {
          invoiceId: invoice.invoiceId,
          amount: '60.0000',
          currency: 'USD',
        })
      ).status
    ).toBe(201);

    const response = await readReceipt(receipt.id);
    expect(response.status).toBe(200);
    const detail = await bodyOf<DetailBody>(response);
    expect(detail.reference).toBe(receipt.reference);
    expect(detail.money.amount).toBe('100.0000');
    expect(detail.unallocated.amount).toBe('40.0000');
    expect(detail.unallocated.currency).toBe('USD');
    expect(detail.status).toBe('partially_allocated');
    expect(detail.method?.id).toBe(PAYMENT_METHOD_A);
    expect(detail.method?.scope).toBe('tenant');
    expect(detail.allocations).toHaveLength(1);
    expect(detail.allocations[0]?.invoiceId).toBe(invoice.invoiceId);
    expect(detail.allocations[0]?.money.amount).toBe('60.0000');
    expect(detail.allocationsTruncated).toBe(false);
    // What the printed copy may NOT show, because it is not published.
    const raw = JSON.stringify(detail);
    expect(raw).not.toContain('receivedBy');
    expect(raw).not.toContain('payerName');
    expect(raw).not.toContain('invoiceNumber');
    expect(detail.payerPartnerId).toBe(PARTNER_A);
  }, 90_000);

  it('refuses a malformed identifier before anything is looked up, and finance view is required', async () => {
    authAs(SAL_FULL);
    const malformed = await readReceipt('not-a-uuid');
    expect(malformed.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(malformed);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('path.paymentId');

    const receipt = await recordedReceipt('17.0000');
    authAs(SAL_NO_FINANCE);
    const denied = await readReceipt(receipt.id);
    expect(denied.status).toBe(403);
    expect(await codeOf(denied)).toBe('ERR-IAM-001');
  }, 60_000);
});
