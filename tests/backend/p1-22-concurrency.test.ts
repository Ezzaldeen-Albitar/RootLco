/**
 * Forced races on the P1-22 money and custody surfaces (Phase 1-22, §15).
 *
 * ## Every race here is FORCED, never hoped for
 *
 * Two requests issued together may simply not interleave. A suite that fires them
 * with `Promise.all` and asserts "one of them failed" is asserting a property of the
 * event loop on the machine that happened to run it, and it passes just as happily
 * against an implementation that took no lock at all. So every case below follows the
 * same doctrine, taken from `tests/backend/p1-19-concurrency.test.ts`:
 *
 *  1. a THIRD connection takes the row the command locks FIRST and holds it;
 *  2. both requests are issued and park on that lock;
 *  3. `waitForBlockedBackends(2)` confirms they ARRIVED — this is the step that makes
 *     the outcome a fact about the code rather than about scheduling luck;
 *  4. only then is the gate released, so both callers are let into the same instant
 *     and the loser's path is genuinely exercised.
 *
 * A sequential `await a; await b;` labelled "concurrency" would prove nothing here and
 * appears nowhere in this file. Nor does an ungated `Promise.all`.
 *
 * ## Which row each gate holds, and why that row and not another
 *
 * | Case                             | Gate row                                      | Why it is the right row                                                                     |
 * | -------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
 * | one draft, two issues            | `sal.invoices`                                | `findInvoiceForUpdate` is the FIRST statement of `issueInvoice`, before the status decision  |
 * | two drafts, two issues           | `shared.number_sequences`                     | the invoice rows differ, so the only shared lock is the allocator's own `FOR UPDATE`         |
 * | one receipt, two allocations     | `sal.receipts`                                | `findReceiptForUpdate` is the first statement, and the primitive's own lock order (H-fin-2)  |
 * | one invoice, two receipts        | `sal.invoices`                                | the receipts differ; `sal.allocate_receipt` locks receipt THEN invoice, so the invoice binds |
 * | cancel versus allocate           | `sal.invoices`                                | cancel locks it directly, allocate locks it inside the primitive                             |
 * | one delivery, two completions    | `sal.delivery_records`                        | `lockDelivery` is the first statement of `completeDelivery`                                  |
 * | one delivery, two warranties     | `sal.delivery_records`                        | `fk_warranty_records_delivery` takes `FOR KEY SHARE` on it, which `FOR UPDATE` conflicts with |
 *
 * The last one deserves its own note, because it is the only gate here that is not an
 * explicit application `FOR UPDATE`. Nothing on the warranty path locks anything: the
 * delivery is read without `FOR UPDATE` by `deliveryForWarranty`, `wty.issue_warranty`
 * reads it without `FOR UPDATE` too, and the duplicate pre-check is a plain `SELECT`.
 * What DOES take a row lock is the INSERT itself — a foreign key acquires
 * `FOR KEY SHARE` on the referenced `sal.delivery_records` row, and `FOR UPDATE`
 * conflicts with that. So the gate is a lock the command really takes, and it parks the
 * callers immediately after the exclusion constraint has been evaluated rather than
 * before it. That ordering is stated in the case itself, because it decides which
 * mechanism refuses the loser.
 *
 * ## What could NOT be forced, stated rather than faked
 *
 * The DRAFT direction of "cancel versus allocate" is not testable as a forced race and
 * is deliberately absent. Against a draft invoice, `allocatePayment` is refused by
 * `assertAllocatable` — the invoice must be `issued` or `credited` — and that refusal
 * happens BEFORE `sal.allocate_receipt`, which is the only statement on the allocation
 * path that locks the invoice. The allocating caller therefore never arrives at any
 * lock, `waitForBlockedBackends(2)` can never be satisfied, and the only way to write
 * the case would be an ungated `Promise.all` whose passing would be luck. The ISSUED
 * direction below covers the interesting half — the half where money is at stake — and
 * the two preconditions being disjoint (`draft` cancels, `issued` allocates) is itself
 * why the outcome cannot be "both".
 *
 * ## Money is compared as an exact decimal STRING, beside its currency
 *
 * `Number`, `parseFloat`, `toFixed` and arithmetic on a money value appear nowhere in
 * this file. `numeric(18,4)` holds values IEEE-754 cannot represent, and PostgreSQL
 * silently rounds a fifth decimal away on the cast rather than erroring — so a
 * `Number`-based assertion would keep passing against an implementation that lost a
 * digit. Every "never negative" claim is a SQL predicate evaluated by PostgreSQL in
 * `numeric`, never a comparison in JavaScript, and every amount is asserted together
 * with the `currency_code` that gives it meaning.
 *
 * Every audit and outbox count is a DELTA measured around the race and additionally
 * pinned to the specific aggregate, because the fixtures write real audit and outbox
 * rows of their own and a tenant-wide absolute count would be measuring arrangement.
 *
 * COVERAGE-EVIDENCE (P1-22 concurrency):
 *   sal.invoice-issue: route service success audit outbox idempotency
 *   sal.payment-allocate: route service success denial audit outbox
 *   sal.delivery-complete: route service success audit outbox idempotency
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
import { FULL, establishP1_19Fixtures, advance, waitForBlockedBackends } from './p1-19-helpers';
import {
  PARTNER_A,
  PAYMENT_METHOD_A,
  POLICY_ACTIVE,
  SAL_FULL,
  SIGNATURE_DOCUMENT_VERSION,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  receiptUnallocated,
  seedDeliveredDelivery,
  seedWorkOrderChain,
  type WorkOrderChain,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { POST as CANCEL_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/cancellation/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { GET as READ_ELIGIBILITY } from '@/app/api/v1/deliveries/[deliveryId]/eligibility/route';
import { POST as COMPLETE_DELIVERY } from '@/app/api/v1/deliveries/[deliveryId]/completion/route';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// Response shapes. Only the fields these assertions read.
// ---------------------------------------------------------------------------

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface IssuedInvoiceBody {
  readonly invoice: { readonly id: string; readonly status: string };
  readonly invoiceNumber: string;
  readonly replayed: boolean;
  readonly recordVersion: number;
}

interface ReceiptBody {
  readonly id: string;
  readonly money: MoneyBody;
  readonly status: string;
}

interface AllocationBody {
  readonly id: string;
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly money: MoneyBody;
  readonly receiptStatus: string;
  readonly receiptUnallocated: MoneyBody;
}

interface EligibilityBody {
  readonly eligible: boolean;
  readonly blockers: readonly string[];
}

interface CompletionBody {
  readonly deliveryId: string;
  readonly status: string;
  readonly finalOdometerReadingId: string | null;
  readonly overridden: readonly string[];
  readonly replayed: boolean;
}

interface WarrantyBody {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly status: string;
  readonly coverage: { readonly id: string };
  readonly replayed: boolean;
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

// ---------------------------------------------------------------------------
// Route senders. Real `Request` objects through the exported handlers.
// ---------------------------------------------------------------------------

function commandHeaders(key: string, version?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': key,
  };
  if (version !== undefined) headers['if-match'] = String(version);
  return headers;
}

/** `sal.invoice-issue` — version-guarded, no body. */
const issueInvoice = (
  invoiceId: string,
  version: number,
  key: string = randomUUID()
): Promise<Response> =>
  ISSUE_INVOICE(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/issuance`, {
      method: 'POST',
      headers: commandHeaders(key, version),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

const cancelInvoice = (
  invoiceId: string,
  version: number,
  reason: string,
  key: string = randomUUID()
): Promise<Response> =>
  CANCEL_INVOICE(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/cancellation`, {
      method: 'POST',
      headers: commandHeaders(key, version),
      body: JSON.stringify({ reason }),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

const recordPayment = (amount: string, key: string = randomUUID()): Promise<Response> =>
  RECORD_PAYMENT(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: commandHeaders(key),
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        paymentMethodId: PAYMENT_METHOD_A,
        payerPartnerId: PARTNER_A,
        currency: 'USD',
        amount,
      }),
    })
  );

const allocatePayment = (
  paymentId: string,
  body: { readonly invoiceId: string; readonly amount: string; readonly currency: string },
  key: string = randomUUID()
): Promise<Response> =>
  ALLOCATE_PAYMENT(
    new Request(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      method: 'POST',
      headers: commandHeaders(key),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ paymentId }) }
  );

const closeWorkOrder = (workOrderId: string, version: number): Promise<Response> =>
  CLOSE_WORK_ORDER(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/closure`, {
      method: 'POST',
      headers: commandHeaders(randomUUID(), version),
      body: JSON.stringify({ toState: 'closed' }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );

const readEligibility = (deliveryId: string): Promise<Response> =>
  READ_ELIGIBILITY(new Request(`http://localhost/api/v1/deliveries/${deliveryId}/eligibility`), {
    params: Promise.resolve({ deliveryId }),
  });

const completeDelivery = (
  deliveryId: string,
  version: number,
  odometer: string,
  key: string = randomUUID()
): Promise<Response> =>
  COMPLETE_DELIVERY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/completion`, {
      method: 'POST',
      headers: commandHeaders(key, version),
      body: JSON.stringify({ finalOdometerValue: odometer, odometerUnit: 'km' }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const generateWarranty = (
  deliveryId: string,
  policyId: string,
  key: string = randomUUID()
): Promise<Response> =>
  GENERATE_WARRANTY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/warranties`, {
      method: 'POST',
      headers: commandHeaders(key),
      body: JSON.stringify({ policyId }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

// ---------------------------------------------------------------------------
// The race primitive. Copied in spirit from p1-19-concurrency.test.ts.
// ---------------------------------------------------------------------------

/**
 * Runs requests against each other with the race FORCED.
 *
 * `hold` names the row every caller must lock before it can proceed. The gate takes it
 * first on a third connection, so no caller can get past it — and
 * `waitForBlockedBackends` is what turns "they were issued together" into "they both
 * arrived". They are then released into the same instant, which is the only way the
 * loser's path is exercised at all.
 *
 * The gate is released in a `finally`, so a failure to arrive reports its own cause
 * rather than surfacing later as an unrelated statement timeout, and the in-flight
 * requests are always settled so a failure inside the gate cannot leave a dangling
 * rejection that reports itself against an unrelated test.
 *
 * ## `staged`
 *
 * Off for every case whose gate is an explicit application `FOR UPDATE`: the gate row
 * strictly orders the callers, and no ordering of their arrival can produce anything
 * but one winner and one loser.
 *
 * On for the warranty case, and for a reason specific to it.
 * `ex_warranty_records_no_overlap` is evaluated DURING the index insert rather than at a
 * lock a third connection can hold, so with a simultaneous start both backends can be
 * inside `check_exclusion_constraint` at the same moment, each waiting on the other's
 * transaction id — which PostgreSQL resolves as a deadlock (`40P01`). A deadlock victim
 * says nothing about the code under test, so the second caller is issued only once the
 * first has ARRIVED and parked. Both are still in flight together and the loser is still
 * judged against the winner's uncommitted insert; what staging removes is a coin toss
 * between "the exclusion constraint refused it" and "PostgreSQL picked a victim".
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

/** The gate for a `sal.invoices` row: the lock `findInvoiceForUpdate` takes. */
const holdInvoice = (invoiceId: string) => ({
  sql: 'SELECT id FROM sal.invoices WHERE id = $1 FOR UPDATE',
  values: [invoiceId],
});

/** The gate for a `sal.receipts` row: the lock `findReceiptForUpdate` takes. */
const holdReceipt = (receiptId: string) => ({
  sql: 'SELECT id FROM sal.receipts WHERE id = $1 FOR UPDATE',
  values: [receiptId],
});

/** The gate for a `sal.delivery_records` row: `lockDelivery`, and the FK's KEY SHARE. */
const holdDelivery = (deliveryId: string) => ({
  sql: 'SELECT id FROM sal.delivery_records WHERE id = $1 FOR UPDATE',
  values: [deliveryId],
});

/**
 * The gate for the branch invoice-number sequence.
 *
 * `shared.next_display_number` takes exactly this lock, and it is the ONLY row two
 * issues of two DIFFERENT invoices contend on — which is why dropping it is the defect
 * the second case would catch and the first would not.
 */
const holdInvoiceSequence = () => ({
  sql: `SELECT id FROM shared.number_sequences
         WHERE tenant_id = $1 AND sequence_code = 'invoice'
           AND company_id = $2 AND branch_id = $3 FOR UPDATE`,
  values: [TENANT_A, COMPANY_A1, BRANCH_A1],
});

// ---------------------------------------------------------------------------
// Read-backs. Admin reads — never RLS evidence.
// ---------------------------------------------------------------------------

/** `shared.number_sequences.next_value` for the fixture invoice sequence. */
async function invoiceSequenceNextValue(): Promise<number> {
  return countRowsOf(
    `SELECT next_value::text AS n FROM shared.number_sequences
      WHERE tenant_id = $1 AND sequence_code = 'invoice'
        AND company_id = $2 AND branch_id = $3`,
    [TENANT_A, COMPANY_A1, BRANCH_A1]
  );
}

/** Audit rows for ONE action across the database, for a before/after delta. */
const auditTotalFor = (action: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1`, [action]);

/** Outbox rows for ONE event type, for a before/after delta. */
const outboxTotalFor = (eventType: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_type = $1`, [
    eventType,
  ]);

/** Outbox rows for ONE event key. The key embeds the aggregate id. */
const outboxKeyCount = (eventKey: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_key = $1`, [
    eventKey,
  ]);

const financialEventCount = (eventType: string, sourceId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.financial_events
      WHERE event_type = $1 AND source_id = $2`,
    [eventType, sourceId]
  );

const allocationRowsFor = (receiptId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`, [
    receiptId,
  ]);

const allocationRowsForInvoice = (invoiceId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.payment_allocations WHERE invoice_id = $1`, [
    invoiceId,
  ]);

/**
 * 1 when `sal.receipt_unallocated` is non-negative, 0 when it is not.
 *
 * Evaluated by PostgreSQL in `numeric`. A JavaScript comparison would have to
 * materialise the value as a double first, which is exactly what must not happen to a
 * `numeric(18,4)`.
 */
const receiptRemainderIsNonNegative = (receiptId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.receipts r
      WHERE r.id = $1 AND sal.receipt_unallocated(r.id) >= 0`,
    [receiptId]
  );

/** 1 when `sal.invoice_open_receivable` is non-negative. Compared in SQL, not in JS. */
const invoiceOpenIsNonNegative = (invoiceId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.invoices i
      WHERE i.id = $1 AND sal.invoice_open_receivable(i.id) >= 0`,
    [invoiceId]
  );

async function invoiceRow(
  invoiceId: string
): Promise<{ status: string; number: string | null; version: number }> {
  const result = await admin.query<{
    status: string;
    invoice_number: string | null;
    record_version: number;
  }>(`SELECT status, invoice_number, record_version FROM sal.invoices WHERE id = $1`, [invoiceId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`invoice ${invoiceId} vanished`);
  return { status: row.status, number: row.invoice_number, version: row.record_version };
}

async function deliveryRow(
  deliveryId: string
): Promise<{ status: string; version: number; visitId: string; vehicleId: string }> {
  const result = await admin.query<{
    status: string;
    record_version: number;
    reception_visit_id: string;
    vehicle_id: string;
  }>(
    `SELECT status, record_version, reception_visit_id, vehicle_id
       FROM sal.delivery_records WHERE id = $1`,
    [deliveryId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`delivery ${deliveryId} vanished`);
  return {
    status: row.status,
    version: row.record_version,
    visitId: row.reception_visit_id,
    vehicleId: row.vehicle_id,
  };
}

// ---------------------------------------------------------------------------
// Local fixtures.
//
// `tests/backend/p1-22-helpers.ts` is owned by another suite and is not modified.
// What it lacks is a DRAFT invoice (its `seedIssuedInvoice` has already taken the
// draft -> issued transition, which is the very transition two of these races are
// about) and a delivery that satisfies every eligibility blocker WITHOUT having been
// completed (its `seedDelivery` calls `sal.complete_delivery` itself). Both are
// defined here.
// ---------------------------------------------------------------------------

/** Runs `work` in one admin transaction with the actor and tenant GUCs set. */
async function asTenant<T>(
  work: (client: {
    query: <R extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: R[]; rowCount: number | null }>;
  }) => Promise<T>
): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const value = await work({
      query: <R extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) =>
        client.query<R>(sql, values === undefined ? undefined : [...values]),
    });
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface DraftInvoice {
  readonly invoiceId: string;
  readonly workOrderId: string;
  readonly recordVersion: number;
  readonly net: string;
}

/**
 * A DRAFT invoice with one priced line, built the way the protected schema demands.
 *
 * Admin SQL, and necessarily so: `sal.invoice-create` reads its every figure from an
 * accepted `quo.quotation_revision`, which is Phase 1-20 arrangement this phase's
 * concurrency claim has no business depending on. What matters is that the row is the
 * exact shape `sal.issue_invoice` consumes — a `draft` header, a line, and the line's
 * restricted amounts — because `sal.guard_invoice_freeze` refuses an INSERT of a
 * born-issued row, so even a fixture has to leave the transition itself untaken.
 *
 * `sal.invoice_amounts` is deliberately NOT written here: `sal.issue_invoice` computes
 * the header totals from the lines and inserts that row itself, and a fixture that
 * pre-computed them would be asserting against its own arithmetic instead of the
 * primitive's.
 */
async function seedDraftInvoice(
  tag: string,
  options: { readonly workOrder?: WorkOrderChain; readonly net?: string } = {}
): Promise<DraftInvoice> {
  const chain = options.workOrder ?? (await seedWorkOrderChain(tag));
  const net = options.net ?? '100.0000';

  return asTenant(async (client) => {
    const invoice = await client.query<{ id: string; record_version: number }>(
      `INSERT INTO sal.invoices
         (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code,
          idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6,$7) RETURNING id, record_version`,
      [
        TENANT_A,
        chain.companyId,
        chain.branchId,
        chain.workOrderId,
        PARTNER_A,
        `fx-p122-conc-invoice-${tag}`,
        USER_A,
      ]
    );
    const invoiceId = invoice.rows[0]?.id ?? '';
    const line = await client.query<{ id: string }>(
      `INSERT INTO sal.invoice_lines
         (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity,
          currency_code, created_by)
       VALUES ($1,$2,$3,$4,1,'service',1,'USD',$5) RETURNING id`,
      [TENANT_A, chain.companyId, chain.branchId, invoiceId, USER_A]
    );
    // The whole gross is the customer's share: no protected configuration determines a
    // warranty contribution at invoice time, so a non-zero `warranty_pay_amount` would
    // be an invented business fact. `ck_invoice_line_amounts_payer_split` requires the
    // two to sum to gross exactly.
    await client.query(
      `INSERT INTO sal.invoice_line_amounts
         (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price,
          net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$6::numeric,0,$6::numeric,$6::numeric,0,$7)`,
      [TENANT_A, chain.companyId, chain.branchId, line.rows[0]?.id ?? '', invoiceId, net, USER_A]
    );
    return {
      invoiceId,
      workOrderId: chain.workOrderId,
      recordVersion: invoice.rows[0]?.record_version ?? 1,
      net,
    };
  });
}

/** Issues a draft through the REAL route, failing loudly if arrangement breaks. */
async function issueThroughRoute(draft: DraftInvoice): Promise<string> {
  authAs(SAL_FULL);
  const response = await issueInvoice(draft.invoiceId, draft.recordVersion);
  if (response.status !== 200) {
    throw new Error(
      `fixture issue of invoice ${draft.invoiceId} failed with ${response.status}: ` +
        `${await response.text()}`
    );
  }
  return (await bodyOf<IssuedInvoiceBody>(response)).invoiceNumber;
}

/** An ISSUED invoice of `net`, arranged through the shipped issuance route. */
async function seedIssuedInvoiceLocally(
  tag: string,
  options: { readonly workOrder?: WorkOrderChain; readonly net?: string } = {}
): Promise<DraftInvoice> {
  const draft = await seedDraftInvoice(tag, options);
  await issueThroughRoute(draft);
  return draft;
}

/** A recorded receipt, arranged through the shipped recording route. */
async function recordedReceipt(amount: string): Promise<ReceiptBody> {
  authAs(SAL_FULL);
  const response = await recordPayment(amount);
  if (response.status !== 201) {
    throw new Error(
      `fixture receipt of ${amount} failed with ${response.status}: ${await response.text()}`
    );
  }
  return bodyOf<ReceiptBody>(response);
}

/** Drives a draft work order all the way to `closed` through the real routes. */
async function closeWorkOrderChain(workOrderId: string): Promise<void> {
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
  const closed = await closeWorkOrder(workOrderId, version);
  if (closed.status !== 200) {
    throw new Error(`fixture closure failed with ${closed.status}: ${await closed.text()}`);
  }
}

interface EligibleDelivery {
  readonly deliveryId: string;
  readonly workOrderId: string;
  readonly visitId: string;
  readonly vehicleId: string;
  readonly recordVersion: number;
  readonly invoiceId: string;
}

/**
 * A delivery with EVERY eligibility blocker cleared and `sal.complete_delivery` not yet
 * called.
 *
 * The eight blockers are cleared by the eight things this builds, and none of them is
 * simulated:
 *
 *  - `delivery_state_invalid` — the record is born `ready`;
 *  - `work_order_not_complete` — the work order is driven to `closed` through the real
 *    transition and closure routes;
 *  - `quality_control_not_passed` — no mandatory `qms.qc_checks` row is configured and
 *    no failed record exists, so `gate.evaluate` reports all three conditions clear;
 *  - `financial_balance_outstanding` — a real invoice is issued for the work order and
 *    settled in full through the recording and allocation routes, so
 *    `sal.invoice_open_receivable` is `0.0000`. The documented override is NOT used:
 *    an override would make the case a test of the override rather than of the race;
 *  - `part_obligation_outstanding` — nothing reserves or issues stock;
 *  - `checklist_incomplete` — a result is written for EVERY company-mandatory item, not
 *    just this delivery's own, because `sal.complete_delivery` evaluates the whole
 *    company's mandatory set and an earlier test's committed template would block this
 *    one;
 *  - `receiver_not_verified` — the receiver is P1-19's fixture partner, which is the
 *    one party `rec.accept_check_in` gave an active role on this visit, so
 *    `sal.guard_authorized_receiver` is satisfied by a real role and not by a guess;
 *  - `signature_missing` — one signature bound to the committed document version.
 *
 * The fixture then ASKS the shipped eligibility read whether it succeeded, and throws
 * with the blocker list if not. Without that, a fixture that silently failed to clear a
 * blocker would surface as two 409s in the race and read like a defect in the code
 * under test.
 */
async function seedEligibleDelivery(tag: string): Promise<EligibleDelivery> {
  const chain = await seedWorkOrderChain(tag);
  await closeWorkOrderChain(chain.workOrderId);

  const invoice = await seedIssuedInvoiceLocally(`${tag}_inv`, {
    workOrder: chain,
    net: '40.0000',
  });
  const receipt = await recordedReceipt('40.0000');
  authAs(SAL_FULL);
  const settled = await allocatePayment(receipt.id, {
    invoiceId: invoice.invoiceId,
    amount: '40.0000',
    currency: 'USD',
  });
  if (settled.status !== 201) {
    throw new Error(`fixture settlement failed with ${settled.status}: ${await settled.text()}`);
  }
  const open = await invoiceOpenReceivable(invoice.invoiceId);
  if (open !== '0.0000') {
    throw new Error(`fixture invoice ${invoice.invoiceId} still owes ${open}, so it would block`);
  }

  const deliveryId = await asTenant(async (client) => {
    const delivery = await client.query<{ id: string }>(
      `INSERT INTO sal.delivery_records
         (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
          delivering_employee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [
        TENANT_A,
        chain.companyId,
        chain.branchId,
        chain.workOrderId,
        chain.visitId,
        chain.vehicleId,
        USER_A,
      ]
    );
    const id = delivery.rows[0]?.id ?? '';

    const template = await client.query<{ id: string }>(
      `INSERT INTO sal.delivery_checklist_templates
         (tenant_id, company_id, template_code, name, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [TENANT_A, chain.companyId, chain.tag, `P1-22 concurrency checklist ${chain.tag}`, USER_A]
    );
    await client.query(
      `INSERT INTO sal.delivery_checklist_template_items
         (tenant_id, company_id, template_id, item_code, label, is_mandatory, created_by)
       VALUES ($1,$2,$3,$4,$5,true,$6)`,
      [
        TENANT_A,
        chain.companyId,
        template.rows[0]?.id ?? '',
        chain.tag,
        `P1-22 mandatory item ${chain.tag}`,
        USER_A,
      ]
    );
    await client.query(
      `INSERT INTO sal.delivery_checklist_results
         (tenant_id, company_id, branch_id, delivery_record_id, template_item_id, outcome,
          recorded_by, created_by)
       SELECT $1,$2,$3,$4,ti.id,'passed',$5,$5
         FROM sal.delivery_checklist_template_items ti
        WHERE ti.tenant_id = $1 AND ti.company_id = $2 AND ti.is_mandatory
          AND ti.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM sal.delivery_checklist_results r
             WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
               AND r.delivery_record_id = $4 AND r.template_item_id = ti.id)`,
      [TENANT_A, chain.companyId, chain.branchId, id, USER_A]
    );
    await client.query(
      `INSERT INTO sal.authorized_receivers
         (tenant_id, company_id, branch_id, delivery_record_id, receiver_partner_id,
          verified_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [TENANT_A, chain.companyId, chain.branchId, id, PARTNER_A, USER_A]
    );
    await client.query(
      `INSERT INTO sal.delivery_signatures
         (tenant_id, company_id, branch_id, delivery_record_id, signer_role,
          signature_document_version_id, created_by)
       VALUES ($1,$2,$3,$4,'receiver',$5,$6)`,
      [TENANT_A, chain.companyId, chain.branchId, id, SIGNATURE_DOCUMENT_VERSION, USER_A]
    );
    return id;
  });

  authAs(SAL_FULL);
  const eligibility = await readEligibility(deliveryId);
  if (eligibility.status !== 200) {
    throw new Error(
      `fixture eligibility read failed with ${eligibility.status}: ${await eligibility.text()}`
    );
  }
  const decision = await bodyOf<EligibilityBody>(eligibility);
  if (!decision.eligible) {
    throw new Error(
      `fixture delivery ${deliveryId} is not eligible; blockers: ${decision.blockers.join(', ')}`
    );
  }

  const row = await deliveryRow(deliveryId);
  return {
    deliveryId,
    workOrderId: chain.workOrderId,
    visitId: row.visitId,
    vehicleId: row.vehicleId,
    recordVersion: row.version,
    invoiceId: invoice.invoiceId,
  };
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimeAppPool(10);
  __setPrimaryPoolForTests(runtime);
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.end();
});

describe('sal.invoice-issue under concurrent callers', () => {
  it('sal.invoice-issue: two concurrent issues of ONE draft allocate exactly one number', async () => {
    const draft = await seedDraftInvoice('conc_issue_one');
    expect((await invoiceRow(draft.invoiceId)).status).toBe('draft');
    expect((await invoiceRow(draft.invoiceId)).number).toBeNull();

    const sequenceBefore = await invoiceSequenceNextValue();
    const auditBefore = await auditTotalFor('sal.invoice.issued');
    const outboxBefore = await outboxTotalFor('invoice.issued');

    const outcomes = await race(holdInvoice(draft.invoiceId), [
      async () => {
        authAs(SAL_FULL);
        return issueInvoice(draft.invoiceId, draft.recordVersion);
      },
      async () => {
        authAs(SAL_FULL);
        return issueInvoice(draft.invoiceId, draft.recordVersion);
      },
    ]);

    // The two HTTP statuses, reported as a pair. Both are 200 rather than one 200 and
    // one 409, and that is the primitive's contract rather than an accident:
    // `issueInvoice` short-circuits on the LOCKED pre-read when the status is already
    // `issued`, so the loser returns the number the winner allocated instead of
    // allocating a second one or being refused.
    const statuses = outcomes.map((response) => response.status);
    expect(statuses).toEqual([200, 200]);

    const bodies = await Promise.all(outcomes.map((r) => bodyOf<IssuedInvoiceBody>(r)));
    // Both succeeded, so the decisive assertion is that they agree on the NUMBER.
    const numbers = bodies.map((body) => body.invoiceNumber);
    expect(numbers[0]).toBe(numbers[1]);
    expect(numbers[0]?.length).toBeGreaterThan(0);
    // Exactly one of the two did the work. `replayed` is what tells a retrying client
    // which it got, and a pair of `false` would mean two commands each believed they
    // had issued the invoice.
    expect(bodies.filter((body) => body.replayed === false)).toHaveLength(1);
    expect(bodies.filter((body) => body.replayed === true)).toHaveLength(1);

    // ONE number on the invoice, and it is the number both callers were told.
    const after = await invoiceRow(draft.invoiceId);
    expect(after.status).toBe('issued');
    expect(after.number).toBe(numbers[0]);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices
          WHERE tenant_id = $1 AND invoice_number = $2`,
        [TENANT_A, after.number]
      )
    ).toBe(1);

    // The sequence advanced by EXACTLY ONE. This is the assertion that fails if the
    // second caller allocates a number it then discards, which is invisible in every
    // response body and permanently visible in the tenant's numbering.
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(1);

    // One financial event, one audit record, one outbox row — as deltas, because the
    // fixtures write real rows of their own.
    expect(await financialEventCount('invoice_issued', draft.invoiceId)).toBe(1);
    expect((await auditTotalFor('sal.invoice.issued')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('invoice.issued')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.invoice.issued', draft.invoiceId)).toBe(1);
    expect(await outboxKeyCount(`invoice.issued:${draft.invoiceId}`)).toBe(1);

    // And the append-only ledger records the transition once. It has no UPDATE and no
    // DELETE grant, so a duplicated row would be unfixable.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoice_status_history
          WHERE invoice_id = $1 AND to_status = 'issued'`,
        [draft.invoiceId]
      )
    ).toBe(1);
  });

  it('sal.invoice-issue: two concurrent issues of DIFFERENT drafts get different numbers', async () => {
    // Both drafts are in the same (company, branch), so they draw on the SAME
    // `shared.number_sequences` row — the only thing standing between them and the same
    // number is the allocator's `FOR UPDATE`, which is what this case measures.
    const first = await seedDraftInvoice('conc_issue_a');
    const second = await seedDraftInvoice('conc_issue_b');

    const sequenceBefore = await invoiceSequenceNextValue();
    const outboxBefore = await outboxTotalFor('invoice.issued');

    const outcomes = await race(holdInvoiceSequence(), [
      async () => {
        authAs(SAL_FULL);
        return issueInvoice(first.invoiceId, first.recordVersion);
      },
      async () => {
        authAs(SAL_FULL);
        return issueInvoice(second.invoiceId, second.recordVersion);
      },
    ]);

    expect(outcomes.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(outcomes.map((r) => bodyOf<IssuedInvoiceBody>(r)));
    // Two legitimate issues, so BOTH must succeed and both must be fresh work.
    expect(bodies.every((body) => body.replayed === false)).toBe(true);
    expect(bodies[0]?.invoiceNumber).not.toBe(bodies[1]?.invoiceNumber);

    // Two invoices, two DISTINCT numbers, and the sequence advanced by exactly two.
    // Drop the allocator's row lock and both callers read the same `next_value`: the
    // numbers collide, `uq_invoices_number` refuses the second, and the tenant's
    // gapless numbering is broken. Nothing else in this suite would notice.
    expect((await invoiceSequenceNextValue()) - sequenceBefore).toBe(2);
    expect(
      await countRowsOf(
        `SELECT count(DISTINCT invoice_number)::text AS n FROM sal.invoices
          WHERE id = ANY($1::uuid[]) AND invoice_number IS NOT NULL`,
        [[first.invoiceId, second.invoiceId]]
      )
    ).toBe(2);
    expect((await invoiceRow(first.invoiceId)).number).toBe(bodies[0]?.invoiceNumber);
    expect((await invoiceRow(second.invoiceId)).number).toBe(bodies[1]?.invoiceNumber);

    // One event each, and one financial event each.
    expect((await outboxTotalFor('invoice.issued')) - outboxBefore).toBe(2);
    expect(await outboxKeyCount(`invoice.issued:${first.invoiceId}`)).toBe(1);
    expect(await outboxKeyCount(`invoice.issued:${second.invoiceId}`)).toBe(1);
    expect(await financialEventCount('invoice_issued', first.invoiceId)).toBe(1);
    expect(await financialEventCount('invoice_issued', second.invoiceId)).toBe(1);
  });
});

describe('sal.payment-allocate under concurrent callers', () => {
  it('sal.payment-allocate: two allocations against a receipt that covers one commit once', async () => {
    const invoice = await seedIssuedInvoiceLocally('conc_alloc_receipt');
    // 50 received against a 100 invoice: the INVOICE bound admits either allocation, so
    // the only thing that can refuse the second is the receipt's own remainder.
    const receipt = await recordedReceipt('50.0000');
    expect(receipt.money.amount).toBe('50.0000');
    expect(receipt.money.currency).toBe('USD');
    expect(await receiptUnallocated(receipt.id)).toBe('50.0000');

    const auditBefore = await auditTotalFor('sal.payment.allocated');
    const outboxBefore = await outboxTotalFor('payment.allocated');

    const attempt = {
      invoiceId: invoice.invoiceId,
      amount: '50.0000',
      currency: 'USD',
    } as const;
    const outcomes = await race(holdReceipt(receipt.id), [
      async () => {
        authAs(SAL_FULL);
        return allocatePayment(receipt.id, attempt);
      },
      async () => {
        authAs(SAL_FULL);
        return allocatePayment(receipt.id, attempt);
      },
    ]);

    const statuses = outcomes.map((response) => response.status).sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    const winner = outcomes.find((response) => response.status === 201);
    const loser = outcomes.find((response) => response.status === 409);
    if (winner === undefined || loser === undefined) {
      throw new Error('the race produced neither a winner nor a loser');
    }
    const allocation = await bodyOf<AllocationBody>(winner);
    // The committed allocation carries the exact amount AND its currency. An amount
    // without its currency would be half an assertion.
    expect(allocation.money.amount).toBe('50.0000');
    expect(allocation.money.currency).toBe('USD');
    expect(allocation.receiptStatus).toBe('allocated');
    expect(allocation.receiptUnallocated.amount).toBe('0.0000');
    expect(allocation.receiptUnallocated.currency).toBe('USD');

    // The loser was REFUSED, and refused as a state conflict a client can act on —
    // never truncated to what was left, and never a 500 carrying a constraint name.
    const problem = await bodyOf<ProblemBody>(loser);
    expect(problem.code).toBe('ERR-TRN-001');
    expect(problem.status).toBe(409);

    // Exactly one allocation row committed, and it is the winner's.
    expect(await allocationRowsFor(receipt.id)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations
          WHERE receipt_id = $1 AND amount::text = '50.0000' AND currency_code = 'USD'`,
        [receipt.id]
      )
    ).toBe(1);

    // The remainder is exactly zero, and — the invariant the schema does NOT defend —
    // it never went negative. Compared by PostgreSQL in `numeric`, never as a double.
    expect(await receiptUnallocated(receipt.id)).toBe('0.0000');
    expect(await receiptRemainderIsNonNegative(receipt.id)).toBe(1);
    // 100 − 50 = 50, as exact decimal strings.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('50.0000');

    expect((await auditTotalFor('sal.payment.allocated')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('payment.allocated')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.payment.allocated', allocation.id)).toBe(1);
    expect(await outboxKeyCount(`payment.allocated:${allocation.id}`)).toBe(1);
    expect(await financialEventCount('payment_allocated', allocation.id)).toBe(1);
  });

  it('sal.payment-allocate: two receipts against one invoice that covers one commit once', async () => {
    // The mirror bound, and the more interesting one: each caller holds its OWN receipt
    // with a full remainder, so the application pre-check passes for both — both read
    // `sal.invoice_open_receivable` on a snapshot in which the other has not committed.
    // The refusal therefore comes from INSIDE `sal.allocate_receipt`, under the invoice
    // lock, which is the only place that bound is enforced at all.
    const invoice = await seedIssuedInvoiceLocally('conc_alloc_invoice');
    const first = await recordedReceipt('100.0000');
    const second = await recordedReceipt('100.0000');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    const auditBefore = await auditTotalFor('sal.payment.allocated');
    const outboxBefore = await outboxTotalFor('payment.allocated');

    const attempt = {
      invoiceId: invoice.invoiceId,
      amount: '100.0000',
      currency: 'USD',
    } as const;
    const outcomes = await race(holdInvoice(invoice.invoiceId), [
      async () => {
        authAs(SAL_FULL);
        return allocatePayment(first.id, attempt);
      },
      async () => {
        authAs(SAL_FULL);
        return allocatePayment(second.id, attempt);
      },
    ]);

    expect(outcomes.map((response) => response.status).sort((x, y) => x - y)).toEqual([201, 409]);
    const loser = outcomes.find((response) => response.status === 409);
    if (loser === undefined) throw new Error('no allocation was refused');
    expect((await bodyOf<ProblemBody>(loser)).code).toBe('ERR-TRN-001');

    // ONE allocation against the invoice, the receivable is exactly zero, and it never
    // went negative — the property `sal.payment_allocations` has no constraint for.
    expect(await allocationRowsForInvoice(invoice.invoiceId)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');
    expect(await invoiceOpenIsNonNegative(invoice.invoiceId)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations
          WHERE invoice_id = $1 AND amount::text = '100.0000' AND currency_code = 'USD'`,
        [invoice.invoiceId]
      )
    ).toBe(1);

    // The refused caller's receipt is untouched: its whole 100 is still available to
    // allocate elsewhere. A silent partial allocation would have consumed some of it.
    const remainders = await Promise.all([
      receiptUnallocated(first.id),
      receiptUnallocated(second.id),
    ]);
    expect(remainders.filter((value) => value === '100.0000')).toHaveLength(1);
    expect(remainders.filter((value) => value === '0.0000')).toHaveLength(1);
    expect(await receiptRemainderIsNonNegative(first.id)).toBe(1);
    expect(await receiptRemainderIsNonNegative(second.id)).toBe(1);

    expect((await auditTotalFor('sal.payment.allocated')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('payment.allocated')) - outboxBefore).toBe(1);
  });

  it('sal.payment-allocate: a concurrent cancel and allocate never both take effect', async () => {
    // An ISSUED invoice. See the file header for why the DRAFT direction cannot be
    // forced: there, the allocation is refused before it reaches the only statement
    // that locks the invoice, so no gate can make both callers arrive.
    const invoice = await seedIssuedInvoiceLocally('conc_cancel_alloc');
    const receipt = await recordedReceipt('100.0000');
    const issued = await invoiceRow(invoice.invoiceId);
    expect(issued.status).toBe('issued');

    const historyBefore = await countRowsOf(
      `SELECT count(*)::text AS n FROM sal.invoice_status_history WHERE invoice_id = $1`,
      [invoice.invoiceId]
    );

    const outcomes = await race(holdInvoice(invoice.invoiceId), [
      async () => {
        authAs(SAL_FULL);
        return allocatePayment(receipt.id, {
          invoiceId: invoice.invoiceId,
          amount: '100.0000',
          currency: 'USD',
        });
      },
      async () => {
        authAs(SAL_FULL);
        return cancelInvoice(invoice.invoiceId, issued.version, 'Concurrent void attempt');
      },
    ]);

    const allocation = outcomes[0];
    const cancellation = outcomes[1];
    if (allocation === undefined || cancellation === undefined) {
      throw new Error('the race did not return both responses');
    }
    // The committed end state, whichever order the lock was granted in: the money is
    // applied and the void is refused. `sal.guard_invoice_freeze` permits
    // `issued -> credited` and nothing else, so a number a customer has seen is never
    // withdrawn — the instrument after issue is a credit note.
    expect(allocation.status).toBe(201);
    expect(cancellation.status).toBe(409);
    expect((await bodyOf<ProblemBody>(cancellation)).code).toBe('ERR-TRN-001');

    const after = await invoiceRow(invoice.invoiceId);
    expect(after.status).toBe('issued');
    expect(after.number).toBe(issued.number);

    // NOT BOTH, stated as its own assertion rather than inferred from the pair above:
    // there is no committed state in which the invoice is void AND an allocation
    // exists against it.
    const voided = after.status === 'void_before_issue';
    const allocated = (await allocationRowsForInvoice(invoice.invoiceId)) > 0;
    expect(voided && allocated).toBe(false);
    expect(allocated).toBe(true);

    // The append-only ledger recorded no void, and the receivable is settled exactly.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoice_status_history
          WHERE invoice_id = $1 AND to_status = 'void_before_issue'`,
        [invoice.invoiceId]
      )
    ).toBe(0);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoice_status_history WHERE invoice_id = $1`,
        [invoice.invoiceId]
      )
    ).toBe(historyBefore);
    expect(await allocationRowsForInvoice(invoice.invoiceId)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');
    expect(await invoiceOpenIsNonNegative(invoice.invoiceId)).toBe(1);
    // No `invoice.voided` event reached a consumer for an invoice that is still issued.
    expect(await outboxKeyCount(`invoice.voided:${invoice.invoiceId}`)).toBe(0);
    // And the cancellation body was never a success document.
    const problem = await bodyOf<VoidedInvoiceBody & ProblemBody>(cancellation);
    expect(problem.replayed).toBeUndefined();
  });
});

describe('sal.delivery-complete and wty.warranty-generate under concurrent callers', () => {
  it('sal.delivery-complete: two concurrent completions release custody exactly once', async () => {
    const delivery = await seedEligibleDelivery('conc_deliver');

    const auditBefore = await auditTotalFor('sal.delivery.completed');
    const outboxBefore = await outboxTotalFor('vehicle.delivered');
    const custodyBefore = await countRowsOf(
      `SELECT count(*)::text AS n FROM rec.custody_history
        WHERE reception_visit_id = $1 AND to_state = 'released'`,
      [delivery.visitId]
    );

    const outcomes = await race(holdDelivery(delivery.deliveryId), () => [
      (async () => {
        authAs(SAL_FULL);
        return completeDelivery(delivery.deliveryId, delivery.recordVersion, '100000');
      })(),
      (async () => {
        authAs(SAL_FULL);
        return completeDelivery(delivery.deliveryId, delivery.recordVersion, '100000');
      })(),
    ]);

    // Both 200: `completeDelivery` returns the already-delivered record on the replay
    // path rather than refusing it, which is what an interrupted client needs.
    expect(outcomes.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(outcomes.map((r) => bodyOf<CompletionBody>(r)));
    expect(bodies.every((body) => body.status === 'delivered')).toBe(true);
    // Exactly one did the work. Two `replayed: false` would mean two handovers.
    expect(bodies.filter((body) => body.replayed === false)).toHaveLength(1);
    expect(bodies.filter((body) => body.replayed === true)).toHaveLength(1);
    // Neither used the financial override: the fixture settled the invoice for real.
    expect(bodies.every((body) => body.overridden.length === 0)).toBe(true);

    // ONE delivered record.
    const after = await deliveryRow(delivery.deliveryId);
    expect(after.status).toBe('delivered');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records
          WHERE id = $1 AND status = 'delivered'`,
        [delivery.deliveryId]
      )
    ).toBe(1);

    // ONE custody release. `uq_custody_history_released` is the exactly-once backstop
    // (C1); this measures that the application never asked it to fire twice.
    expect(
      (await countRowsOf(
        `SELECT count(*)::text AS n FROM rec.custody_history
          WHERE reception_visit_id = $1 AND to_state = 'released'`,
        [delivery.visitId]
      )) - custodyBefore
    ).toBe(1);

    // ONE audit record, ONE outbox row, ONE ledger row, ONE odometer reading.
    expect((await auditTotalFor('sal.delivery.completed')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.delivery.completed', delivery.deliveryId)).toBe(1);
    expect(await outboxKeyCount(`vehicle.delivered:${delivery.deliveryId}`)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_status_history
          WHERE delivery_record_id = $1 AND to_status = 'delivered'`,
        [delivery.deliveryId]
      )
    ).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM veh.odometer_readings
          WHERE vehicle_id = $1 AND capture_method = 'delivery'`,
        [delivery.vehicleId]
      )
    ).toBe(1);
    // The reading the record cites is the one that was captured.
    const readingId = bodies.find((body) => body.replayed === false)?.finalOdometerReadingId;
    expect(readingId).not.toBeNull();
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records
          WHERE id = $1 AND final_odometer_reading_id = $2`,
        [delivery.deliveryId, readingId]
      )
    ).toBe(1);
  });

  it('two concurrent warranty generations from one delivery issue exactly one record', async () => {
    // A committed handover, arranged by the shared helper's `sal.complete_delivery`
    // path: the warranty preconditions are the delivery being `delivered` and carrying
    // a final odometer reading, and nothing about them is under test here.
    const delivered = await seedDeliveredDelivery('conc_wty');
    expect(delivered.status).toBe('delivered');

    const auditBefore = await auditTotalFor('wty.warranty.issued');
    const outboxBefore = await outboxTotalFor('warranty.issued');

    // The gate is `sal.delivery_records`, and the mechanism is worth stating: nothing
    // on this path takes an explicit `FOR UPDATE`, but `fk_warranty_records_delivery`
    // makes the INSERT acquire `FOR KEY SHARE` on the delivery row, which `FOR UPDATE`
    // conflicts with. The exclusion constraint is evaluated during the index insert,
    // i.e. BEFORE the foreign key fires — so one caller parks on this gate having
    // already inserted, and the other parks waiting on that caller's transaction id.
    // Both are blocked, which is what `waitForBlockedBackends(2)` measures, and the
    // loser is then refused by `ex_warranty_records_no_overlap` (`23P01`).
    const outcomes = await race(holdDelivery(delivered.deliveryId), () => [
      (async () => {
        authAs(SAL_FULL);
        return generateWarranty(delivered.deliveryId, POLICY_ACTIVE);
      })(),
      (async () => {
        authAs(SAL_FULL);
        return generateWarranty(delivered.deliveryId, POLICY_ACTIVE);
      })(),
    ]);

    const statuses = outcomes.map((response) => response.status).sort((x, y) => x - y);
    // A CONTROLLED refusal, not a fault. `23P01` from a gist EXCLUDE reads as a server
    // error to anything that does not map it, and a 500 here would tell the caller the
    // platform broke when the database enforced exactly the rule it exists to enforce.
    expect(statuses[1]).toBeLessThan(500);
    expect(statuses).toEqual([201, 409]);

    const winner = outcomes.find((response) => response.status === 201);
    const loser = outcomes.find((response) => response.status === 409);
    if (winner === undefined || loser === undefined) {
      throw new Error('the race produced neither a winner nor a loser');
    }
    const warranty = await bodyOf<WarrantyBody>(winner);
    expect(warranty.deliveryRecordId).toBe(delivered.deliveryId);
    expect(warranty.status).toBe('issued');
    expect(warranty.replayed).toBe(false);
    expect((await bodyOf<ProblemBody>(loser)).code).toBe('ERR-CON-001');

    // EXACTLY ONE live warranty for the (vehicle, coverage) pair the EXCLUDE keys on.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_records
          WHERE vehicle_id = $1 AND coverage_id = $2 AND deleted_at IS NULL`,
        [delivered.vehicleId, warranty.coverage.id]
      )
    ).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_records WHERE delivery_record_id = $1`,
        [delivered.deliveryId]
      )
    ).toBe(1);

    // One audit record, one event, one birth row in the status ledger.
    expect((await auditTotalFor('wty.warranty.issued')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('warranty.issued')) - outboxBefore).toBe(1);
    expect(await auditCountFor('wty.warranty.issued', warranty.id)).toBe(1);
    expect(await outboxKeyCount(`warranty.issued:${warranty.id}`)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_status_history
          WHERE warranty_record_id = $1 AND to_status = 'issued'`,
        [warranty.id]
      )
    ).toBe(1);
  });
});
