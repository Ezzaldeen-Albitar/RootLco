/**
 * P1-32-PRE-OD-FIN — finance controls and correctness fixes, end to end through
 * their route handlers.
 *
 * Every case counts a side effect — a row, a figure, an audit record, a financial
 * event — and is written so it FAILS when the control it names is removed:
 *
 *  - M-01: a pending credit note cannot be relabelled on the runtime login, and
 *    the requester still cannot approve it afterwards.
 *  - M-09: an allocation repeated under its key after the transport record is gone
 *    returns the first allocation and books no second one; a key reused for a
 *    different amount is refused; a receipt in a withdrawn currency is refused on
 *    the currency field.
 *  - GAP-04: a sales return shows its credit note's decision — waiting, credited —
 *    and a reader who may not see the note is told only that one was raised.
 *  - GAP-05: three returns of one unit on a three-unit line of 20.0000 credit
 *    6.6667, 6.6666 and 6.6667, and every one of them is approvable.
 *  - GAP-09: a counter-sale invoice's lines name the item they sold.
 *  - GAP-17: a credit approval racing an allocation, two approvals of one note, and
 *    two notes each worth the whole balance — every race FORCED behind a held row
 *    lock (the doctrine of `p1-22-concurrency.test.ts`), exactly one winner, and the
 *    open receivable never below zero.
 *
 * Money is compared as exact decimal STRINGS; a "never negative" claim is a SQL
 * predicate evaluated in `numeric`.
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
  PARTNER_A,
  establishP1_19Fixtures,
  waitForBlockedBackends,
  type Principal,
} from './p1-19-helpers';
import {
  INV_COUNTER,
  INV_READER,
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
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { POST as SALE_PRICE_SET } from '@/app/api/v1/items/[itemId]/sale-prices/route';
import { POST as COUNTER_SALE_CREATE } from '@/app/api/v1/counter-sales/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as REQUEST_CREDIT_NOTE } from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import { POST as APPROVE_CREDIT_NOTE } from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import {
  GET as SALES_RETURN_LIST,
  POST as SALES_RETURN_CREATE,
} from '@/app/api/v1/sales-returns/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface CreditNoteResultBody {
  readonly creditNote: { readonly id: string; readonly approvalState: string };
  readonly replayed: boolean;
}

interface AllocationBody {
  readonly id: string;
  readonly money: MoneyBody;
  readonly receiptUnallocated: MoneyBody;
}

interface ReturnBody {
  readonly id: string;
  readonly creditNoteId: string | null;
  readonly status: string;
}

interface InvoiceDetailBody {
  readonly invoice: { readonly id: string; readonly workOrderId: string | null };
  readonly lines: readonly {
    readonly id: string;
    readonly item: { readonly id: string; readonly code: string; readonly name: string } | null;
  }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

function commandHeaders(key: string, version?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': key,
  };
  if (version !== undefined) headers['if-match'] = String(version);
  return headers;
}

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: commandHeaders(key),
      body: JSON.stringify(body),
    })
  );

const requestCreditNote = (invoiceId: string, amount: string): Promise<Response> =>
  (REQUEST_CREDIT_NOTE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/credit-notes`, {
      method: 'POST',
      headers: commandHeaders(randomUUID()),
      body: JSON.stringify({ amount, reason: 'finance controls probe' }),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

const approveCreditNote = (creditNoteId: string): Promise<Response> =>
  (APPROVE_CREDIT_NOTE as ParamHandler<{ creditNoteId: string }>)(
    new Request(`http://localhost/api/v1/credit-notes/${creditNoteId}/approval`, {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
    }),
    { params: Promise.resolve({ creditNoteId }) }
  );

const recordPayment = (amount: string, currency = 'USD'): Promise<Response> =>
  post(RECORD_PAYMENT, '/api/v1/payments', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    paymentMethodId: PAYMENT_METHOD_A,
    payerPartnerId: PARTNER_A,
    currency,
    amount,
  });

const allocatePayment = (
  paymentId: string,
  body: { readonly invoiceId: string; readonly amount: string; readonly currency: string },
  key: string = randomUUID()
): Promise<Response> =>
  (ALLOCATE_PAYMENT as ParamHandler<{ paymentId: string }>)(
    new Request(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      method: 'POST',
      headers: commandHeaders(key),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ paymentId }) }
  );

const readInvoice = (invoiceId: string): Promise<Response> =>
  (READ_INVOICE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}`),
    { params: Promise.resolve({ invoiceId }) }
  );

const listReturns = (sourceId: string): Promise<Response> =>
  SALES_RETURN_LIST(
    new Request(
      `http://localhost/api/v1/sales-returns?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&sourceId=${sourceId}`
    )
  );

/** A pending credit note raised through the route by `requester`. */
async function pendingCreditNote(invoiceId: string, amount: string, requester: Principal) {
  authAs(requester);
  const response = await requestCreditNote(invoiceId, amount);
  if (response.status !== 201) {
    throw new Error(`fixture credit note failed with ${response.status}: ${await response.text()}`);
  }
  return (await bodyOf<CreditNoteResultBody>(response)).creditNote.id;
}

/** A receipt recorded through the route. */
async function recordedReceipt(amount: string): Promise<string> {
  authAs(SAL_FULL);
  const response = await recordPayment(amount);
  if (response.status !== 201) {
    throw new Error(`fixture receipt failed with ${response.status}: ${await response.text()}`);
  }
  return (await bodyOf<{ id: string }>(response)).id;
}

/** 1 when the open receivable is non-negative — compared by PostgreSQL in numeric. */
const invoiceOpenIsNonNegative = (invoiceId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.invoices i
      WHERE i.id = $1 AND sal.invoice_open_receivable(i.id) >= 0`,
    [invoiceId]
  );

const approvedCreditEvents = (creditNoteId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.financial_events
      WHERE source_id = $1 AND event_type = 'credit_note_issued'`,
    [creditNoteId]
  );

/**
 * Runs requests against each other with the race FORCED: a third connection holds
 * `hold` first, every sender is issued and CONFIRMED parked on it, then the gate is
 * released. `staged` issues each sender only after the previous one has parked, which
 * both fixes the lock-queue order (so a case can name its winner) and lets senders
 * authenticate as different principals — the session authenticator is process-wide,
 * so a sender that has parked on a row lock has already resolved its own.
 */
async function race(
  hold: { readonly sql: string; readonly values: readonly unknown[] },
  senders: readonly (() => Promise<Response>)[],
  options: { readonly staged?: boolean } = {}
): Promise<readonly Response[]> {
  const gate = await admin.connect();
  const inFlight: Promise<Response>[] = [];
  try {
    await gate.query('BEGIN');
    await gate.query(hold.sql, [...hold.values]);
    try {
      let arrived = 0;
      for (const send of senders) {
        inFlight.push(send());
        arrived += 1;
        if (options.staged === true) await waitForBlockedBackends(arrived);
      }
      if (options.staged !== true) await waitForBlockedBackends(inFlight.length);
    } finally {
      await gate.query('ROLLBACK');
    }
    return await Promise.all(inFlight);
  } catch (error) {
    await Promise.allSettled(inFlight);
    throw error;
  } finally {
    gate.release();
  }
}

const holdInvoice = (invoiceId: string) => ({
  sql: 'SELECT id FROM sal.invoices WHERE id = $1 FOR UPDATE',
  values: [invoiceId],
});

const holdCreditNote = (creditNoteId: string) => ({
  sql: 'SELECT id FROM sal.credit_notes WHERE id = $1 FOR UPDATE',
  values: [creditNoteId],
});

let taxClassThird = '';

/** A tax class of one third (0.333333) in COMPANY_A1, committed for the counter sale. */
async function provisionTaxClass(): Promise<string> {
  const code = `fx_odfin_${randomUUID().slice(0, 8)}`;
  const taxClass = await admin.query<{ id: string }>(
    `INSERT INTO org.tax_classes (tenant_id, company_id, tax_class_code, name, created_by)
     VALUES ($1,$2,$3,'Finance controls third',$4) RETURNING id`,
    [TENANT_A, COMPANY_A1, code, USER_A]
  );
  const id = taxClass.rows[0]?.id ?? '';
  await admin.query(
    `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
     VALUES ($1,$2,$3,0.333333,DATE '2020-01-01',$4)`,
    [TENANT_A, COMPANY_A1, id, USER_A]
  );
  return id;
}

/**
 * An ISSUED counter sale of three units at 5.0000 with a one-third tax class:
 * 15.0000 net, 5.0000 tax, 20.0000 gross, on one line.
 */
async function issuedThreeUnitSale(): Promise<{ invoiceId: string; lineId: string; cell: string }> {
  const cell = await freshLocation();
  await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '10' });
  authAs(INV_COUNTER);
  const price = await (SALE_PRICE_SET as ParamHandler<{ itemId: string }>)(
    new Request(`http://localhost/api/v1/items/${ITEM_A}/sale-prices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        currencyCode: 'USD',
        unitPrice: '5.0000',
        taxClassId: taxClassThird,
      }),
    }),
    { params: Promise.resolve({ itemId: ITEM_A }) }
  );
  if (price.status >= 300) throw new Error(`fixture price failed: ${await price.text()}`);
  const sale = await bodyOf<{
    invoice: { id: string };
    lines: readonly { id: string }[];
    recordVersion: number;
  }>(
    await post(COUNTER_SALE_CREATE, '/api/v1/counter-sales', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A, locationId: cell, quantity: '3' }],
    })
  );
  const issued = await (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${sale.invoice.id}/issuance`, {
      method: 'POST',
      headers: commandHeaders(randomUUID(), sale.recordVersion),
    }),
    { params: Promise.resolve({ invoiceId: sale.invoice.id }) }
  );
  if (issued.status !== 200) throw new Error(`fixture issue failed: ${await issued.text()}`);
  return { invoiceId: sale.invoice.id, lineId: sale.lines[0]?.id ?? '', cell };
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimeAppPool(10);
  __setPrimaryPoolForTests(runtime);
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await establishP1_22Fixtures(admin);
  taxClassThird = await provisionTaxClass();
  await admin.query(
    `INSERT INTO shared.currencies (code, name, minor_unit, status, created_by)
     VALUES ('XTS', 'Finance controls withdrawn test currency', 2, 'inactive', $1)
     ON CONFLICT (code) DO NOTHING`,
    [USER_A]
  );
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanP1_22Fixtures();
  await admin.query(
    `DELETE FROM shared.currencies c WHERE c.code = 'XTS'
       AND NOT EXISTS (SELECT 1 FROM sal.receipts r WHERE r.currency_code = c.code)`
  );
  await cleanBackendFixtures(admin);
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.end();
});

describe('M-01 — a pending credit note cannot be relabelled', () => {
  it('refuses the relabel on the runtime login and still refuses the self-approval', async () => {
    const invoice = await seedIssuedInvoice('odfin_relabel');
    const note = await pendingCreditNote(invoice.invoiceId, '25.0000', SAL_FULL);

    // The runtime login, in the requester's own context, attempts to hand the
    // request to the approver so the requester could approve it.
    const client = await runtime.connect();
    let refused: { code?: string } | null = null;
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [SAL_FULL.userId, TENANT_A]
      );
      try {
        await client.query(`UPDATE sal.credit_notes SET requested_by = $2 WHERE id = $1`, [
          note,
          SAL_APPROVER.userId,
        ]);
      } catch (error) {
        refused = error as { code?: string };
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(refused?.code).toBe('42501');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes WHERE id = $1 AND requested_by = $2`,
        [note, SAL_FULL.userId]
      )
    ).toBe(1);

    // The requester approving their own request is refused, and nothing changed.
    authAs(SAL_FULL);
    const self = await approveCreditNote(note);
    expect(self.status).toBe(409);
    expect((await bodyOf<ProblemBody>(self)).code).toBe('ERR-TRN-001');
    expect(await approvedCreditEvents(note)).toBe(0);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });
});

describe('M-09 — an allocation is booked once per key', () => {
  it('returns the first allocation when the key is repeated after the transport record is gone', async () => {
    const invoice = await seedIssuedInvoice('odfin_alloc_key');
    const receipt = await recordedReceipt('100.0000');
    const key = randomUUID();
    const attempt = { invoiceId: invoice.invoiceId, amount: '60.0000', currency: 'USD' } as const;

    authAs(SAL_FULL);
    const first = await allocatePayment(receipt, attempt, key);
    expect(first.status).toBe(201);
    const booked = await bodyOf<AllocationBody>(first);

    // The uncertain-outcome retry the transport store cannot answer: its record is
    // gone, so the handler runs again and only the business key stands between the
    // retry and a second allocation.
    await admin.query(
      `DELETE FROM shared.idempotency_keys WHERE tenant_id = $1 AND idempotency_key = $2`,
      [TENANT_A, key]
    );
    authAs(SAL_FULL);
    const retried = await allocatePayment(receipt, attempt, key);
    expect(retried.status).toBe(201);
    const again = await bodyOf<AllocationBody>(retried);
    expect(again.id).toBe(booked.id);
    expect(again.money).toEqual({ amount: '60.0000', currency: 'USD' });

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`,
        [receipt]
      )
    ).toBe(1);
    expect(await auditCountFor('sal.payment.allocated', booked.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('40.0000');

    // The same key for a different amount is a reused key, refused, never replayed.
    await admin.query(
      `DELETE FROM shared.idempotency_keys WHERE tenant_id = $1 AND idempotency_key = $2`,
      [TENANT_A, key]
    );
    authAs(SAL_FULL);
    const reused = await allocatePayment(receipt, { ...attempt, amount: '10.0000' }, key);
    expect((await bodyOf<ProblemBody>(reused)).code).toBe('ERR-INT-001');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('40.0000');
  });

  it('refuses a receipt in a withdrawn currency on the currency field and records nothing', async () => {
    const before = await countRowsOf(
      `SELECT count(*)::text AS n FROM sal.receipts WHERE currency_code = 'XTS'`
    );
    authAs(SAL_FULL);
    const response = await recordPayment('10.00', 'XTS');
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations).toEqual([{ path: 'body.currency', rule: 'unknown_currency' }]);
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts WHERE currency_code = 'XTS'`)
    ).toBe(before);
  });
});

describe('GAP-04 / GAP-05 / GAP-09 — returns, their credits and the sale they came from', () => {
  it('credits a line returned one unit at a time to exactly its gross, and shows each decision', async () => {
    const sale = await issuedThreeUnitSale();
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoice_line_amounts
          WHERE invoice_line_id = $1 AND gross_amount::text = '20.0000'`,
        [sale.lineId]
      )
    ).toBe(1);

    const returns: ReturnBody[] = [];
    for (let unit = 0; unit < 3; unit++) {
      authAs(INV_COUNTER);
      const response = await post(SALES_RETURN_CREATE, '/api/v1/sales-returns', {
        sourceKind: 'invoice_line',
        sourceId: sale.lineId,
        quantity: '1',
        condition: 'restockable',
        receivedLocationId: sale.cell,
        reason: 'One back',
      });
      expect(response.status).toBe(201);
      returns.push(await bodyOf<ReturnBody>(response));
    }
    // GAP-04: the note is only PENDING, so the return says so.
    expect(returns.map((row) => row.status)).toEqual([
      'credit_requested',
      'credit_requested',
      'credit_requested',
    ]);

    // GAP-05: the cumulative share, rounded once, sums to the line's gross.
    const amounts: string[] = [];
    for (const row of returns) {
      const result = await admin.query<{ amount: string }>(
        `SELECT amount::text AS amount FROM sal.credit_notes WHERE id = $1`,
        [row.creditNoteId]
      );
      amounts.push(result.rows[0]?.amount ?? '');
    }
    expect(amounts).toEqual(['6.6667', '6.6666', '6.6667']);

    // Every credit is approvable on the unpaid sale by a second person.
    for (const row of returns) {
      authAs(SAL_APPROVER);
      const approved = await approveCreditNote(row.creditNoteId ?? '');
      expect(approved.status).toBe(200);
    }
    expect(await invoiceOpenReceivable(sale.invoiceId)).toBe('0.0000');

    // GAP-04: approved notes read as credited.
    authAs(INV_COUNTER);
    const listed = await bodyOf<{ items: readonly ReturnBody[] }>(await listReturns(sale.lineId));
    expect(listed.items.map((row) => row.status)).toEqual(['credited', 'credited', 'credited']);

    // A reader without sal.finance.view cannot see the note, so it is told only that
    // one was raised — never "credited" and never "waiting".
    authAs(INV_READER);
    const hidden = await bodyOf<{ items: readonly ReturnBody[] }>(await listReturns(sale.lineId));
    expect(hidden.items.map((row) => row.status)).toEqual([
      'credit_raised',
      'credit_raised',
      'credit_raised',
    ]);
  });

  it('names the item each counter-sale line sold on the invoice detail', async () => {
    const sale = await issuedThreeUnitSale();
    const item = (
      await admin.query<{ sku: string; name: string }>(
        `SELECT sku, name FROM inv.item_master WHERE id = $1`,
        [ITEM_A]
      )
    ).rows[0];
    authAs(INV_COUNTER);
    const detail = await bodyOf<InvoiceDetailBody>(await readInvoice(sale.invoiceId));
    expect(detail.invoice.workOrderId).toBeNull();
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]?.item).toEqual({ id: ITEM_A, code: item?.sku, name: item?.name });

    // A work-order invoice's lines are described by their quotation item instead.
    const workOrderInvoice = await seedIssuedInvoice('odfin_wo_lines');
    authAs(SAL_FULL);
    const woDetail = await bodyOf<InvoiceDetailBody>(await readInvoice(workOrderInvoice.invoiceId));
    expect(woDetail.lines.map((line) => line.item)).toEqual([null]);
  });
});

describe('GAP-17 — credit approvals under concurrent callers', () => {
  for (const order of ['approval first', 'allocation first'] as const) {
    it(`a credit approval racing a full allocation: one wins, open never below zero (${order})`, async () => {
      const invoice = await seedIssuedInvoice(`odfin_race_alloc_${order.split(' ')[0]}`);
      const note = await pendingCreditNote(invoice.invoiceId, '100.0000', SAL_FULL);
      const receipt = await recordedReceipt('100.0000');

      const approve = async () => {
        authAs(SAL_APPROVER);
        return approveCreditNote(note);
      };
      const allocate = async () => {
        authAs(SAL_FULL);
        return allocatePayment(receipt, {
          invoiceId: invoice.invoiceId,
          amount: '100.0000',
          currency: 'USD',
        });
      };
      const senders = order === 'approval first' ? [approve, allocate] : [allocate, approve];
      const outcomes = await race(holdInvoice(invoice.invoiceId), senders, { staged: true });

      const [winner, loser] = outcomes;
      expect(winner?.status).toBe(order === 'approval first' ? 200 : 201);
      expect(loser?.status).toBe(409);
      expect((await bodyOf<ProblemBody>(loser as Response)).code).toBe('ERR-TRN-001');

      const allocations = await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations WHERE invoice_id = $1`,
        [invoice.invoiceId]
      );
      const credited = await approvedCreditEvents(note);
      expect(allocations + credited).toBe(1);
      expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');
      expect(await invoiceOpenIsNonNegative(invoice.invoiceId)).toBe(1);
    });
  }

  it('two approvals of the same note: exactly one approves, the other is told it already happened', async () => {
    const invoice = await seedIssuedInvoice('odfin_race_same_note');
    const note = await pendingCreditNote(invoice.invoiceId, '40.0000', SAL_FULL);

    const outcomes = await race(holdCreditNote(note), [
      async () => {
        authAs(SAL_APPROVER);
        return approveCreditNote(note);
      },
      async () => {
        authAs(SAL_APPROVER);
        return approveCreditNote(note);
      },
    ]);
    expect(outcomes.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(outcomes.map((r) => bodyOf<CreditNoteResultBody>(r)));
    expect(bodies.map((body) => body.replayed).sort()).toEqual([false, true]);
    expect(bodies.every((body) => body.creditNote.approvalState === 'approved')).toBe(true);

    expect(await approvedCreditEvents(note)).toBe(1);
    expect(await auditCountFor('sal.credit_note.approved', note)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('60.0000');
  });

  it('two notes each worth the whole balance: one is approved, the other refused', async () => {
    const invoice = await seedIssuedInvoice('odfin_race_two_notes');
    const first = await pendingCreditNote(invoice.invoiceId, '100.0000', SAL_FULL);
    const second = await pendingCreditNote(invoice.invoiceId, '100.0000', SAL_FULL);

    const outcomes = await race(holdInvoice(invoice.invoiceId), [
      async () => {
        authAs(SAL_APPROVER);
        return approveCreditNote(first);
      },
      async () => {
        authAs(SAL_APPROVER);
        return approveCreditNote(second);
      },
    ]);
    expect(outcomes.map((response) => response.status).sort((x, y) => x - y)).toEqual([200, 409]);
    expect((await approvedCreditEvents(first)) + (await approvedCreditEvents(second))).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');
    expect(await invoiceOpenIsNonNegative(invoice.invoiceId)).toBe(1);
  });
});
