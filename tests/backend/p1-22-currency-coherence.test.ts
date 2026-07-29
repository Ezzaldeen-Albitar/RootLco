/**
 * Currency coherence, boundary scale and exact decimal arithmetic (Phase 1-22).
 *
 * This suite is the APPLICATION half of a two-part argument. The other half is
 * `tests/db/p1-22-protected-residuals.test.ts`, which proves — against the deployed DDL,
 * on the `app_runtime` login — that the protected schema ACCEPTS a JOD credit note
 * against a USD invoice, APPROVES it, and lets `sal.invoice_open_receivable` subtract
 * 40 JOD from a USD gross (100.0000 → 60.0000). Five triggers fire on
 * `sal.credit_notes` and not one reads `sal.invoices.currency_code`;
 * `sal.approve_credit_note` compares the amount and never the currency; and the
 * receivable function has no currency predicate at all.
 *
 * So the question these cases answer is not "is the invariant enforced" — it is
 * enforced NOWHERE below this layer — but "does the backend refuse what the database
 * allows". Every refusal below is the only refusal there is (P1-22-L-02,
 * change-control candidate CC-1).
 *
 * ## Four properties every assertion here respects
 *
 *  - **Money is compared as an exact decimal STRING.** `Number`, `parseFloat`,
 *    `toFixed` and arithmetic on a money value appear nowhere in this file. A
 *    `numeric(18,4)` holds values IEEE-754 cannot represent, so a `Number`-based
 *    comparison would keep passing against an implementation that lost a digit — in
 *    the suite whose entire purpose is to prove it does not. Where a case claims a
 *    balance "fell by" an amount, the before and the after are BOTH asserted as
 *    literals and the difference is stated rather than computed.
 *  - **An amount is never asserted without its currency.** An amount without its
 *    code is half an assertion: the same `40.0000` is two different sums of money.
 *  - **A refusal is asserted with its catalog code and its violated field**, not
 *    merely as "not 2xx", and every refusal is paired with a DELTA proving no row
 *    was written. A 422 that still inserted the row would be the worst outcome
 *    available and is indistinguishable from a correct refusal by status alone.
 *  - **The scale case is the most important validation case in the phase.**
 *    Exceeding scale is NOT an error in PostgreSQL: a fifth decimal place is
 *    silently rounded away on the cast to `numeric(18,4)`. An unrefused
 *    `1.00005` would therefore be accepted and quietly altered, and the caller would
 *    never learn its amount had changed. Only the boundary regex and `Decimal.parse`
 *    refuse it.
 *
 * ## Which operation this file is evidence for, and which it merely drives
 *
 * The coverage manifest names this file against `sal.credit-note-create` only, and the
 * declaration below covers exactly that operation. `sal.payment-record`,
 * `sal.payment-allocate`, `sal.receipt-detail`, `sal.invoice-detail` and
 * `sal.invoice-outstanding-read` are driven here too — an allocation cannot be proved
 * coherent without a receipt and an invoice, and the structural "no unlabelled
 * aggregate" walk needs three real response documents — but their evidence is declared
 * in the files the manifest names for them. Declaring flags here for operations whose
 * manifest entry does not list this file would be a claim no gate checks, which is the
 * exact dishonesty the COVERAGE-EVIDENCE mechanism exists to prevent.
 *
 * `outbox` is deliberately ABSENT from the declaration: `sal.credit-note-create`
 * publishes NO event. Nothing is credited at request time — `sal.invoice_open_receivable`
 * counts only `approval_state = 'approved'` credits — so a `credit-note.issued` event
 * fired here would tell every consumer the receivable had fallen when it had not. The
 * event belongs to `sal.credit-note-approve`. A declared-but-unbacked flag would be
 * worse than a missing one.
 *
 * COVERAGE-EVIDENCE (P1-22 currency coherence):
 *   sal.credit-note-create: route service success denial audit idempotency
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  SAL_FULL,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  receiptUnallocated,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { GET as READ_RECEIPT } from '@/app/api/v1/payments/[paymentId]/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { POST as REQUEST_CREDIT_NOTE } from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { GET as READ_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';

let admin: Pool;

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface ReceiptBody {
  readonly id: string;
  readonly reference: string;
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

interface CreditNoteBody {
  readonly creditNote: {
    readonly id: string;
    readonly invoiceId: string;
    readonly amount: MoneyBody;
    readonly reason: string;
    readonly approvalState: string;
    readonly approvedBy: string | null;
  };
  readonly replayed: boolean;
}

interface OutstandingBody {
  readonly invoiceId: string;
  readonly status: string;
  readonly outstanding: MoneyBody;
  readonly isSettled: boolean;
}

interface InvoiceDetailBody {
  readonly invoice: {
    readonly id: string;
    readonly currency: string;
    readonly status: string;
    readonly invoiceNumber: string | null;
    readonly totals: {
      readonly net: MoneyBody;
      readonly tax: MoneyBody;
      readonly gross: MoneyBody;
    } | null;
  };
  readonly lines: readonly unknown[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

// ---------------------------------------------------------------------------
// Route drivers. Every P1-22 command declares `idempotent: true`, so the header is
// mandatory and a fresh key is the default.
// ---------------------------------------------------------------------------

const recordPayment = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  RECORD_PAYMENT(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const allocatePayment = (
  paymentId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  ALLOCATE_PAYMENT(
    new Request(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ paymentId }) }
  );

const readReceipt = (paymentId: string): Promise<Response> =>
  READ_RECEIPT(new Request(`http://localhost/api/v1/payments/${paymentId}`), {
    params: Promise.resolve({ paymentId }),
  });

const requestCreditNote = (
  invoiceId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  REQUEST_CREDIT_NOTE(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/credit-notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

const readInvoice = (invoiceId: string): Promise<Response> =>
  READ_INVOICE(new Request(`http://localhost/api/v1/invoices/${invoiceId}`), {
    params: Promise.resolve({ invoiceId }),
  });

const readOutstanding = (invoiceId: string): Promise<Response> =>
  READ_OUTSTANDING(new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`), {
    params: Promise.resolve({ invoiceId }),
  });

/** A well-formed recording request in the provisioned company and branch. */
const validPayment = (amount: string, currency = 'USD'): Record<string, string> => ({
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  paymentMethodId: PAYMENT_METHOD_A,
  payerPartnerId: PARTNER_A,
  currency,
  amount,
});

/** Credit notes for ONE invoice. Every refusal below is measured as a delta on this. */
const creditNoteRowsFor = (invoiceId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.credit_notes WHERE invoice_id = $1`, [
    invoiceId,
  ]);

const receiptRowCount = (): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts`);

const allocationRowsFor = (receiptId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`, [
    receiptId,
  ]);

/** Audit rows for ONE action across the whole database, for a before/after delta. */
const auditTotalFor = (action: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1`, [action]);

/** Records a receipt as `SAL_FULL` and fails loudly if the fixture path breaks. */
async function recordedReceipt(amount: string, currency = 'USD'): Promise<ReceiptBody> {
  authAs(SAL_FULL);
  const response = await recordPayment(validPayment(amount, currency));
  if (response.status !== 201) {
    throw new Error(
      `fixture receipt of ${amount} ${currency} failed with ${response.status}: ` +
        `${await response.text()}`
    );
  }
  return bodyOf<ReceiptBody>(response);
}

// ---------------------------------------------------------------------------
// The structural money-label audit used by the "no unlabelled aggregate" case.
// ---------------------------------------------------------------------------

/**
 * Any key that could name money. Matched against the KEY, never the value.
 *
 * Deliberately broad: the point of a structural walk is that it catches a field
 * nobody thought to write an assertion for. A field-by-field check can only ever
 * confirm the fields its author already knew about, which is precisely the field an
 * unlabelled aggregate would not be.
 */
const MONEY_KEY = /amount|total|net|gross|tax|balance/i;

/**
 * The keys that match `MONEY_KEY` BY ACCIDENT and are not money. Excluded by NAME.
 *
 * Exactly one exists in the P1-22 read surface, and it was found by running the walk
 * rather than by predicting it:
 *
 *  - **`lineType`** — the `ck_invoice_lines_line_type` vocabulary, whose three values
 *    are `service`, `part` and `fee`. It matches only because a case-insensitive
 *    search for `net` finds the letters in "li·neT·ype". It is not an amount, it has
 *    no currency, and it never will.
 *
 * Excluded by name rather than by narrowing the regex, deliberately. The obvious
 * "fix" — requiring a word boundary or an upper-case initial — would have silently
 * stopped matching `netTotal`, `net_amount`, `taxAmount` and `grossTotal`, which are
 * precisely the fields the rule exists to police. A broad regex plus one named
 * exception is auditable; a narrowed regex is a hole nobody can see.
 *
 * `quantity` (`numeric(12,3)`, not money) and `sequence` (a `bigint` ledger position
 * rendered as a string) are the two exemptions a reader would expect to find here and
 * are deliberately absent: NEITHER matches `MONEY_KEY`, so no exemption was needed and
 * none was granted.
 */
const NOT_MONEY: ReadonlySet<string> = new Set(['lineType']);

interface MoneyLabelAudit {
  /** Money-named STRING fields whose containing object carries a `currency`. */
  readonly labelled: readonly string[];
  /** Money-named STRING fields with no `currency` in scope. Must always be empty. */
  readonly unlabelled: readonly string[];
}

/**
 * Walks a parsed response and classifies every money-named string field.
 *
 * The rule, applied structurally rather than per field: a key matching `MONEY_KEY`
 * whose value is a STRING must sit in an object that also carries a `currency` key —
 * which is exactly the `{ amount, currency }` pair `moneyView()` produces. An object
 * or array value is not itself an amount, so it is descended into rather than judged;
 * its own leaves are what the rule applies to.
 *
 * One key is excluded, by name, and `NOT_MONEY` records which and why. Nothing here
 * loosens the rule itself: a key that is money and carries no currency is reported
 * whatever its name.
 */
function auditMoneyLabels(document: unknown): MoneyLabelAudit {
  const labelled: string[] = [];
  const unlabelled: string[] = [];

  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const labelledHere = typeof record.currency === 'string' && record.currency.length === 3;
    for (const [key, value] of Object.entries(record)) {
      const here = `${path}.${key}`;
      if (typeof value === 'string' && MONEY_KEY.test(key) && !NOT_MONEY.has(key)) {
        (labelledHere ? labelled : unlabelled).push(here);
      }
      visit(value, here);
    }
  };

  visit(document, '$');
  return { labelled: [...labelled].sort(), unlabelled: [...unlabelled].sort() };
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

// ===========================================================================
// §4.1 — the credit-note currency must equal the invoice's.
// ===========================================================================

describe('sal.credit-note-create — currency equality with the parent invoice', () => {
  it('refuses a JOD credit note against a USD invoice and writes no row (denial)', async () => {
    const invoice = await seedIssuedInvoice('ccy_mismatch');
    expect(invoice.currencyCode).toBe('USD');
    expect(invoice.gross).toBe('100.0000');
    const before = await creditNoteRowsFor(invoice.invoiceId);

    // THE DATABASE WOULD HAVE ACCEPTED THIS, AND WOULD HAVE APPROVED IT.
    // `tests/db/p1-22-protected-residuals.test.ts`, in
    // "accepts, approves, and subtracts a JOD credit note from a USD invoice",
    // performs exactly this insert on the `app_runtime` login, approves it through
    // `sal.approve_credit_note`, and then reads `sal.invoice_open_receivable` back as
    // 60.0000 — 40 JOD subtracted from a USD gross as though the two were one unit.
    // That case still PASSES, so the hole below is closed in application code only:
    // no migration has been authored, the residual is `P1-22-L-02`, and the fix is
    // change-control candidate CC-1. A reader must not conclude from a green suite
    // here that the schema now defends this.
    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '40.0000',
      reason: 'currency-coherence probe',
      currency: 'JOD',
    });
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.currency');

    // The decisive assertion: NOTHING was written. A 422 that had already inserted
    // the row would be indistinguishable from a correct refusal by status alone.
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(before);
    // And the receivable is untouched, in exact decimal form.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    // The refusal is the application's currency-equality check and NOT an incidental
    // foreign key. `fk_credit_notes_currency` references `shared.currencies (code)`,
    // so a mismatch naming an unseeded code would have been refused whatever
    // `assertCurrencyMatches` did — and this case would have passed against an
    // implementation with no currency check at all. JOD is a seeded currency, so the
    // FK would have admitted the row.
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM shared.currencies WHERE code = 'JOD'`)
    ).toBe(1);
  });

  it('accepts sal.credit-note-create when the declared currency matches (success, audit)', async () => {
    const invoice = await seedIssuedInvoice('ccy_match');
    const before = await creditNoteRowsFor(invoice.invoiceId);
    const auditBefore = await auditTotalFor('sal.credit_note.requested');

    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '40.0000',
      reason: 'goodwill adjustment',
      currency: 'USD',
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<CreditNoteBody>(response);

    // The amount AND its currency. Either alone is half an assertion.
    expect(created.creditNote.amount.amount).toBe('40.0000');
    expect(created.creditNote.amount.currency).toBe('USD');
    expect(created.creditNote.invoiceId).toBe(invoice.invoiceId);
    // Born pending, and worth nothing: `sal.stamp_dual_control_maker` NULLs the
    // approval fields on INSERT, so a request cannot arrive pre-approved.
    expect(created.creditNote.approvalState).toBe('pending');
    expect(created.creditNote.approvedBy).toBeNull();
    expect(created.replayed).toBe(false);

    // The row carries the same exact decimal and the same code.
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(before + 1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND amount::text = '40.0000' AND currency_code = 'USD'`,
        [created.creditNote.id]
      )
    ).toBe(1);

    // A DELTA, not a tenant-wide total: the fixtures write real audit rows of their
    // own, so an absolute count would be measuring arrangement.
    expect((await auditTotalFor('sal.credit_note.requested')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.credit_note.requested', created.creditNote.id)).toBe(1);

    // A PENDING credit changes nothing. `sal.invoice_open_receivable` subtracts only
    // `approval_state = 'approved'` credits, so the receivable is still the full gross
    // — which is also why this operation publishes no event.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('stores the invoice currency when sal.credit-note-create names none (success)', async () => {
    const invoice = await seedIssuedInvoice('ccy_absent', { currency: 'EUR' });
    expect(invoice.currencyCode).toBe('EUR');

    // `currency` is optional and is READ FROM THE PARENT when omitted. The stored code
    // is never the caller's: it is `sal.invoices.currency_code`, and the optional field
    // exists only so a caller that believes otherwise is told so.
    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '10.0000',
      reason: 'currency derived from the invoice',
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<CreditNoteBody>(response);
    expect(created.creditNote.amount.amount).toBe('10.0000');
    expect(created.creditNote.amount.currency).toBe('EUR');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes WHERE id = $1 AND currency_code = 'EUR'`,
        [created.creditNote.id]
      )
    ).toBe(1);
  });

  it('replays one sal.credit-note-create per idempotency key (idempotency)', async () => {
    const invoice = await seedIssuedInvoice('ccy_replay');
    const key = randomUUID();
    const payload = { amount: '25.0000', reason: 'replay probe', currency: 'USD' };
    const auditBefore = await auditTotalFor('sal.credit_note.requested');

    authAs(SAL_FULL);
    const first = await requestCreditNote(invoice.invoiceId, payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<CreditNoteBody>(first);

    authAs(SAL_FULL);
    const replay = await requestCreditNote(invoice.invoiceId, payload, key);
    // 200 rather than 201: the stored response is replayed and the handler is never
    // re-entered, so a retrying client can tell it did not request a second credit.
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<CreditNoteBody>(replay);
    expect(replayed.creditNote.id).toBe(original.creditNote.id);
    expect(replayed.creditNote.amount.amount).toBe('25.0000');
    expect(replayed.creditNote.amount.currency).toBe('USD');

    // ONE row, ONE audit record. `sal.credit_notes` has no DELETE grant, so a second
    // row would be a permanent duplicate reduction of a receivable.
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(1);
    expect((await auditTotalFor('sal.credit_note.requested')) - auditBefore).toBe(1);
  });
});

// ===========================================================================
// §4.2 — allocation currency coherence: three currencies, all compared.
// ===========================================================================

describe('allocation currency coherence across caller, receipt and invoice', () => {
  it('refuses a declared currency that differs from the receipt (denial)', async () => {
    const invoice = await seedIssuedInvoice('alloc_declared');
    const receipt = await recordedReceipt('100.0000', 'USD');

    // `sal.allocate_receipt` compares the RECEIPT against the INVOICE and never sees
    // what the caller believed, so without this check the request would have succeeded
    // in USD for a client that thought it was allocating EUR — same number, different
    // sum of money.
    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'EUR',
    });
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.currencyCode');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
    expect(await receiptUnallocated(receipt.id)).toBe('100.0000');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('refuses a receipt currency that differs from the invoice (denial)', async () => {
    const invoice = await seedIssuedInvoice('alloc_receipt_ccy', { currency: 'EUR' });
    expect(invoice.currencyCode).toBe('EUR');
    const receipt = await recordedReceipt('100.0000', 'USD');

    // A different pair from the case above, and it has to be tested separately: here
    // the caller's declaration agrees with the receipt, so only the second comparison
    // in `assertAllocationCurrencyCoherent` can refuse it.
    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.currencyCode');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('accepts an allocation when caller, receipt and invoice all agree (success)', async () => {
    const invoice = await seedIssuedInvoice('alloc_coherent');
    const receipt = await recordedReceipt('100.0000', 'USD');

    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(201);
    const allocation = await bodyOf<AllocationBody>(response);
    expect(allocation.money.amount).toBe('60.0000');
    expect(allocation.money.currency).toBe('USD');
    expect(allocation.receiptUnallocated.amount).toBe('40.0000');
    expect(allocation.receiptUnallocated.currency).toBe('USD');
    expect(await allocationRowsFor(receipt.id)).toBe(1);
    // 100.0000 − 60.0000 = 40.0000, and no `Number` touched any of the three: both
    // figures were computed by PostgreSQL in `numeric` and are compared as strings.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('40.0000');
    expect(await receiptUnallocated(receipt.id)).toBe('40.0000');
  });
});

// ===========================================================================
// §4.3 — scale, precision, notation and sign at the boundary.
// ===========================================================================

describe('sal.credit-note-create — scale, precision and notation at the boundary', () => {
  it('refuses a fifth decimal place rather than silently rounding it (denial)', async () => {
    const invoice = await seedIssuedInvoice('scale_credit');
    const before = await creditNoteRowsFor(invoice.invoiceId);

    // THE case. PostgreSQL does not error on excess scale — it ROUNDS on the cast to
    // `numeric(18,4)` — so an unrefused `1.00005` would be stored as `1.0001` and the
    // caller would never learn its amount had changed. The boundary regex is what
    // refuses it, and `parseInstrumentAmount` refuses it again for any path that
    // bypasses the schema.
    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '1.00005',
      reason: 'over-scale probe',
      currency: 'USD',
    });
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.amount');
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(before);

    // And nothing anywhere in the tenant holds the rounded value the cast would have
    // produced, which is what "silently altered" would have looked like.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes WHERE amount::text = '1.0001'`
      )
    ).toBe(0);
  });

  it('refuses more than 14 integer digits, which would raise 22003 (denial)', async () => {
    const invoice = await seedIssuedInvoice('scale_credit_wide');
    const before = await creditNoteRowsFor(invoice.invoiceId);

    // `numeric(18,4)` leaves 14 integer digits. A fifteenth raises `22003`
    // (numeric_value_out_of_range), which is neither `23514` nor anything the billing
    // failure translator maps — it would surface as a 500 telling the caller its
    // request broke the server. Refused at the edge instead, as a 422 naming the field.
    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '123456789012345',
      reason: 'over-precision probe',
      currency: 'USD',
    });
    expect(response.status).toBe(422);
    expect((await bodyOf<ProblemBody>(response)).violations?.[0]?.path).toBe('body.amount');
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(before);
  });

  it('refuses exponential notation and surrounding whitespace (denial)', async () => {
    const invoice = await seedIssuedInvoice('scale_credit_notation');
    const before = await creditNoteRowsFor(invoice.invoiceId);

    // `1e3` in a money field is a client bug or a probe, and it is NOT normalised: a
    // boundary that accepted it would be silently interpreting a notation the column
    // cannot express, and `+40` / `.5` / `40.` are the same class of guess. Whitespace
    // is refused rather than trimmed for the same reason — trimming is a decision
    // about what the caller meant.
    for (const amount of [
      '1e3',
      '1E3',
      '4e-1',
      ' 40.0000',
      '40.0000 ',
      '\t40.0000',
      '+40',
      '.5',
      '40.',
      '4_0',
    ]) {
      authAs(SAL_FULL);
      const response = await requestCreditNote(invoice.invoiceId, {
        amount,
        reason: 'notation probe',
        currency: 'USD',
      });
      expect(response.status, `amount ${JSON.stringify(amount)}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    // Not one of the ten wrote a row.
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(before);
  });

  it('refuses a zero and a negative credit amount (denial)', async () => {
    const invoice = await seedIssuedInvoice('scale_credit_zero');
    const before = await creditNoteRowsFor(invoice.invoiceId);

    // `ck_credit_notes_amount` is `> 0`. `'0'` and `'0.0000'` are well-formed decimal
    // strings that the boundary regex ACCEPTS, so `parseInstrumentAmount` is the only
    // thing that refuses them — without it the database would answer with a
    // `check_violation` naming a constraint, which is not a caller-safe contract. The
    // negatives are refused by the unsigned regex, one layer earlier.
    for (const amount of ['0', '0.0000', '-1', '-0.0001']) {
      authAs(SAL_FULL);
      const response = await requestCreditNote(invoice.invoiceId, {
        amount,
        reason: 'zero probe',
        currency: 'USD',
      });
      expect(response.status, `amount ${amount}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(before);
  });
});

describe('payment amount scale, precision, notation and sign at the boundary', () => {
  it('refuses a fifth decimal place on a receipt rather than rounding it', async () => {
    const before = await receiptRowCount();

    authAs(SAL_FULL);
    const response = await recordPayment(validPayment('1.00005'));
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.amount');
    expect(await receiptRowCount()).toBe(before);
    // The rounded value the `numeric(18,4)` cast would have produced exists nowhere.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.receipts WHERE amount::text = '1.0001'`
      )
    ).toBe(0);
  });

  it('refuses more than 14 integer digits on a receipt, which would raise 22003', async () => {
    const before = await receiptRowCount();
    authAs(SAL_FULL);
    const response = await recordPayment(validPayment('123456789012345'));
    expect(response.status).toBe(422);
    expect((await bodyOf<ProblemBody>(response)).violations?.[0]?.path).toBe('body.amount');
    expect(await receiptRowCount()).toBe(before);
  });

  it('refuses exponential notation and whitespace on a receipt', async () => {
    const before = await receiptRowCount();
    for (const amount of ['1e3', '1E3', ' 100.0000', '100.0000 ', '+100', '.5', '100.']) {
      authAs(SAL_FULL);
      const response = await recordPayment(validPayment(amount));
      expect(response.status, `amount ${JSON.stringify(amount)}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    expect(await receiptRowCount()).toBe(before);
  });

  it('refuses a zero and a negative receipt amount (ck_receipts_amount is > 0)', async () => {
    const before = await receiptRowCount();
    for (const amount of ['0', '0.0000', '-1', '-0.0001']) {
      authAs(SAL_FULL);
      const response = await recordPayment(validPayment(amount));
      expect(response.status, `amount ${amount}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    expect(await receiptRowCount()).toBe(before);
  });
});

// ===========================================================================
// §4.4 — zero is illegal on an instrument and LEGAL on an invoice.
// ===========================================================================

describe('a zero-total issued invoice is legal, and sal.credit-note-create has nothing to credit', () => {
  it('issues, numbers and reports a zero-total invoice with its currency (success)', async () => {
    // `ck_invoice_amounts_nonneg` is `>= 0` while every payment instrument is `> 0`,
    // and the asymmetry is deliberate: a job billed at nothing still needs a numbered
    // document, so a zero TOTAL is legal where a zero RECEIPT is not. `sal.issue_invoice`
    // refuses an invoice with no LINES, not one whose lines sum to zero, and the
    // `invoice_issued` financial event binds `amount = gross_total = 0`, which
    // `ck_financial_events_amount` (`>= 0`) admits.
    //
    // A fully warranty-covered invoice — gross > 0 with `customer_pay_amount = 0` —
    // is the other shape the phase prose mentions and is NOT produced here, for a
    // stated reason rather than by omission: `seedIssuedInvoice` writes
    // `warranty_pay_amount = 0` unconditionally (it is not a parameter), and the
    // application writes the same constant deliberately, because no protected
    // configuration anywhere determines a warranty contribution at invoice time. A
    // fixture that hand-wrote a non-zero warranty share would be asserting behaviour
    // for a state no shipped code can produce.
    const invoice = await seedIssuedInvoice('zero_total', { net: '0.0000', tax: '0.0000' });
    expect(invoice.gross).toBe('0.0000');

    authAs(SAL_FULL);
    const detailResponse = await readInvoice(invoice.invoiceId);
    expect(detailResponse.status).toBe(200);
    const detail = await bodyOf<InvoiceDetailBody>(detailResponse);
    expect(detail.invoice.status).toBe('issued');
    // A real number was allocated for it, not withheld because it bills nothing.
    expect(typeof detail.invoice.invoiceNumber).toBe('string');
    expect((detail.invoice.invoiceNumber ?? '').length).toBeGreaterThan(0);
    // Every zero carries its currency. `0.0000` USD and `0.0000` JOD are the same
    // number and different facts, and a total with no code is the unlabelled aggregate
    // this suite exists to refuse.
    expect(detail.invoice.totals?.net.amount).toBe('0.0000');
    expect(detail.invoice.totals?.net.currency).toBe('USD');
    expect(detail.invoice.totals?.tax.amount).toBe('0.0000');
    expect(detail.invoice.totals?.tax.currency).toBe('USD');
    expect(detail.invoice.totals?.gross.amount).toBe('0.0000');
    expect(detail.invoice.totals?.gross.currency).toBe('USD');

    authAs(SAL_FULL);
    const outstandingResponse = await readOutstanding(invoice.invoiceId);
    expect(outstandingResponse.status).toBe(200);
    const outstanding = await bodyOf<OutstandingBody>(outstandingResponse);
    expect(outstanding.outstanding.amount).toBe('0.0000');
    expect(outstanding.outstanding.currency).toBe('USD');
    // `isSettled` is decided by comparing two `Decimal`s, and `status` is returned
    // beside it so a caller can tell this zero from a paid one.
    expect(outstanding.isSettled).toBe(true);
    expect(outstanding.status).toBe('issued');
  });

  it('refuses the smallest possible credit against a zero-total invoice (denial)', async () => {
    const invoice = await seedIssuedInvoice('zero_total_credit', {
      net: '0.0000',
      tax: '0.0000',
    });
    const before = await creditNoteRowsFor(invoice.invoiceId);

    // Legal to issue, and nothing to credit. One ten-thousandth is the smallest amount
    // `numeric(18,4)` can express, so this is the boundary of the ceiling check rather
    // than a comfortable margin. A conflict rather than a validation failure: the
    // request is well formed and what refuses it is the invoice's state.
    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '0.0001',
      reason: 'nothing to credit',
      currency: 'USD',
    });
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-TRN-001');
    expect(await creditNoteRowsFor(invoice.invoiceId)).toBe(before);
  });
});

// ===========================================================================
// §7 — no unlabelled money aggregate escapes any P1-22 response.
// ===========================================================================

describe('no unlabelled money aggregate escapes a P1-22 response', () => {
  it('labels every money-named string field in the invoice, outstanding and receipt reads', async () => {
    const invoice = await seedIssuedInvoice('label_walk');
    const receipt = await recordedReceipt('100.0000');

    authAs(SAL_FULL);
    const allocated = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    expect(allocated.status).toBe(201);

    // ---- the invoice detail -------------------------------------------------
    authAs(SAL_FULL);
    const detailResponse = await readInvoice(invoice.invoiceId);
    expect(detailResponse.status).toBe(200);
    const detailAudit = auditMoneyLabels(await detailResponse.json());
    expect(detailAudit.unlabelled).toEqual([]);
    // NON-VACUITY. A walker whose regex matched nothing would report an empty
    // `unlabelled` list for a response full of bare numbers, so the paths it DID
    // classify are asserted too: the three header totals and the seven per-line
    // amounts, including both halves of the FR-WTY-004 payer split.
    //
    // `$.lines[0].lineType` is absent from this list on purpose. It appeared here on
    // the first run — a false positive of `MONEY_KEY`, caught by running the walk
    // rather than by predicting it — and it is now excluded by name in `NOT_MONEY`
    // with the reason recorded there.
    expect(detailAudit.labelled).toEqual([
      '$.invoice.totals.gross.amount',
      '$.invoice.totals.net.amount',
      '$.invoice.totals.tax.amount',
      '$.lines[0].money.gross.amount',
      '$.lines[0].money.net.amount',
      '$.lines[0].money.payerSplit.customer.amount',
      '$.lines[0].money.payerSplit.warranty.amount',
      '$.lines[0].money.tax.amount',
      '$.lines[0].money.unitPrice.amount',
    ]);

    // ---- the outstanding read ----------------------------------------------
    //
    // The one that matters most. `sal.invoice_open_receivable` returns a BARE numeric
    // with no currency predicate anywhere in it, so only the invoice header's own
    // `currency_code` can label the answer — and this operation always returns the
    // pair. The same absence is why `sal.partner_outstanding_balance` is exposed
    // nowhere in this phase: it sums a partner's invoices across currencies and
    // returns one scalar that is unlabellable at source, which
    // `tests/db/p1-22-protected-residuals.test.ts` shows returning 150.0000 for one
    // USD invoice open 100 and one JOD invoice open 50.
    authAs(SAL_FULL);
    const outstandingResponse = await readOutstanding(invoice.invoiceId);
    expect(outstandingResponse.status).toBe(200);
    const outstandingAudit = auditMoneyLabels(await outstandingResponse.json());
    expect(outstandingAudit.unlabelled).toEqual([]);
    expect(outstandingAudit.labelled).toEqual(['$.outstanding.amount']);

    // ---- the receipt detail ------------------------------------------------
    authAs(SAL_FULL);
    const receiptResponse = await readReceipt(receipt.id);
    expect(receiptResponse.status).toBe(200);
    const receiptAudit = auditMoneyLabels(await receiptResponse.json());
    expect(receiptAudit.unlabelled).toEqual([]);
    expect(receiptAudit.labelled).toEqual([
      '$.allocations[0].money.amount',
      '$.money.amount',
      '$.unallocated.amount',
    ]);
  });

  it('labels the money in a sal.credit-note-create response', async () => {
    const invoice = await seedIssuedInvoice('label_walk_credit');

    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '40.0000',
      reason: 'label walk',
      currency: 'USD',
    });
    expect(response.status).toBe(201);
    const audit = auditMoneyLabels(await response.json());
    expect(audit.unlabelled).toEqual([]);
    expect(audit.labelled).toEqual(['$.creditNote.amount.amount']);
  });

  it('would report an unlabelled amount if one existed', async () => {
    // The walker's own negative control, and it is not decoration: every assertion
    // above is `unlabelled === []`, which a walker that classified nothing would also
    // satisfy. This proves the empty lists above are a property of the responses
    // rather than of the walk — and it pins the ONE named exclusion, so a future edit
    // cannot quietly widen `NOT_MONEY` into a way of hiding a real finding.
    const audit = auditMoneyLabels({
      // The shape `sal.partner_outstanding_balance` would produce: a cross-currency
      // sum with no code anywhere near it. Reported.
      outer: { grossTotal: '150.0000' },
      inner: { balance: '10.0000', currency: 'USD' },
      // Money-named and NUMERIC. Ignored by the rule as specified, and it has to be
      // said out loud: a JSON number has already lost the value before this walk runs,
      // which is why `scripts/ci/check-exact-money.mjs` bans `z.number()` on the
      // financial surface at source rather than leaving it to a response check.
      lost: { taxTotal: 150 },
      // Matches `MONEY_KEY` only through the letters in "li·neT·ype", and is excluded
      // by name — in an object WITHOUT a currency, so the exclusion is proved to be
      // about the name and not about a currency happening to sit beside it.
      line: { lineType: 'service', quantity: '2.000' },
      sequence: '41',
    });
    expect(audit.unlabelled).toEqual(['$.outer.grossTotal']);
    expect(audit.labelled).toEqual(['$.inner.balance']);
  });
});

// ===========================================================================
// §7 — TC-P1-22-005: one payment across two invoices, in exact decimals.
// ===========================================================================

describe('one receipt allocated across two invoices with exact decimal arithmetic', () => {
  it('splits 100.0000 into 33.3300 and 66.6700 and then refuses a third allocation', async () => {
    const invoiceA = await seedIssuedInvoice('split_a');
    const invoiceB = await seedIssuedInvoice('split_b');
    expect(invoiceA.gross).toBe('100.0000');
    expect(invoiceB.gross).toBe('100.0000');

    // The BEFORE figures, as literals. The deltas this case claims are stated by
    // pairing each with its AFTER literal rather than by subtracting: `Number` and
    // arithmetic on a money value appear nowhere here, because a `numeric(18,4)`
    // holds values a double cannot represent and 33.33 + 66.67 is exactly the kind of
    // sum that would still look right after losing a digit.
    expect(await invoiceOpenReceivable(invoiceA.invoiceId)).toBe('100.0000');
    expect(await invoiceOpenReceivable(invoiceB.invoiceId)).toBe('100.0000');

    const receipt = await recordedReceipt('100.0000');
    expect(receipt.money.amount).toBe('100.0000');
    expect(receipt.money.currency).toBe('USD');
    expect(await receiptUnallocated(receipt.id)).toBe('100.0000');

    // ---- 33.3300 to invoice A ----------------------------------------------
    authAs(SAL_FULL);
    const first = await allocatePayment(receipt.id, {
      invoiceId: invoiceA.invoiceId,
      amount: '33.3300',
      currency: 'USD',
    });
    expect(first.status).toBe(201);
    const allocationA = await bodyOf<AllocationBody>(first);
    expect(allocationA.money.amount).toBe('33.3300');
    expect(allocationA.money.currency).toBe('USD');
    expect(allocationA.receiptStatus).toBe('partially_allocated');
    expect(allocationA.receiptUnallocated.amount).toBe('66.6700');
    expect(allocationA.receiptUnallocated.currency).toBe('USD');

    // ---- 66.6700 to invoice B ----------------------------------------------
    authAs(SAL_FULL);
    const second = await allocatePayment(receipt.id, {
      invoiceId: invoiceB.invoiceId,
      amount: '66.6700',
      currency: 'USD',
    });
    expect(second.status).toBe(201);
    const allocationB = await bodyOf<AllocationBody>(second);
    expect(allocationB.money.amount).toBe('66.6700');
    expect(allocationB.money.currency).toBe('USD');
    // The primitive re-summed and set the status itself: 33.3300 + 66.6700 is exactly
    // 100.0000 in `numeric`, so the receipt is `allocated` and not
    // `partially_allocated` with a residual thousandth.
    expect(allocationB.receiptStatus).toBe('allocated');
    expect(allocationB.receiptUnallocated.amount).toBe('0.0000');
    expect(allocationB.receiptUnallocated.currency).toBe('USD');

    // ---- the exact decimal outcome, from the database's own derivations ------
    // A fell from 100.0000 to 66.6700 — a fall of 33.3300.
    expect(await invoiceOpenReceivable(invoiceA.invoiceId)).toBe('66.6700');
    // B fell from 100.0000 to 33.3300 — a fall of 66.6700.
    expect(await invoiceOpenReceivable(invoiceB.invoiceId)).toBe('33.3300');
    // And the receipt is exhausted to the ten-thousandth: `0.0000`, not `0.0001`.
    expect(await receiptUnallocated(receipt.id)).toBe('0.0000');

    // The same three figures through the ROUTES, so the API agrees with the ledger.
    authAs(SAL_FULL);
    const outstandingA = await bodyOf<OutstandingBody>(await readOutstanding(invoiceA.invoiceId));
    expect(outstandingA.outstanding.amount).toBe('66.6700');
    expect(outstandingA.outstanding.currency).toBe('USD');
    expect(outstandingA.isSettled).toBe(false);
    authAs(SAL_FULL);
    const outstandingB = await bodyOf<OutstandingBody>(await readOutstanding(invoiceB.invoiceId));
    expect(outstandingB.outstanding.amount).toBe('33.3300');
    expect(outstandingB.outstanding.currency).toBe('USD');
    authAs(SAL_FULL);
    const detail = await bodyOf<{
      readonly unallocated: MoneyBody;
      readonly status: string;
      readonly allocations: readonly { readonly money: MoneyBody }[];
    }>(await readReceipt(receipt.id));
    expect(detail.unallocated.amount).toBe('0.0000');
    expect(detail.unallocated.currency).toBe('USD');
    expect(detail.status).toBe('allocated');
    expect(detail.allocations).toHaveLength(2);

    // ---- a third allocation of the smallest expressible amount is refused ----
    authAs(SAL_FULL);
    const third = await allocatePayment(receipt.id, {
      invoiceId: invoiceA.invoiceId,
      amount: '0.0001',
      currency: 'USD',
    });
    // `Σ allocations <= receipt.amount` is bounded ONLY inside `sal.allocate_receipt`
    // — no constraint, trigger or exclusion bounds the sum, and `app_runtime` holds raw
    // INSERT on `sal.payment_allocations`, which
    // `tests/db/p1-22-protected-residuals.test.ts` reproduces by driving both
    // derivations to −400.0000. The service's pre-check exists so the refusal is a
    // caller-safe 409 rather than a constraint message.
    expect(third.status).toBe(409);
    expect((await bodyOf<ProblemBody>(third)).code).toBe('ERR-TRN-001');
    expect(await allocationRowsFor(receipt.id)).toBe(2);
    // Nothing moved: an over-allocation that had landed would be permanent, because
    // `sal.payment_allocations` has no UPDATE and no DELETE grant.
    expect(await receiptUnallocated(receipt.id)).toBe('0.0000');
    expect(await invoiceOpenReceivable(invoiceA.invoiceId)).toBe('66.6700');
    expect(await invoiceOpenReceivable(invoiceB.invoiceId)).toBe('33.3300');
  });
});
