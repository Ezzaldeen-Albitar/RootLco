/**
 * P1-32-PRE-OD-FIN — the finance controls of migration
 * `20260930090000_sal_finance_controls.sql`, the database half.
 *
 * Every case is written so it FAILS when the control it names is removed:
 *
 *  - M-01: a pending dual-control request (credit note, receipt reversal) is
 *    frozen from insert onward. Two independent layers, each tested on its own:
 *    the runtime login may UPDATE only the decision columns (a column grant), and
 *    a trigger refuses a change to the request's facts for ANY role that still
 *    holds the privilege — proved on the owner connection, which bypasses the
 *    grant but not the trigger. The approve primitives compare the approver with
 *    the STORED requester, so relabel-then-self-approve is refused.
 *  - GAP-13: a credit note is refused unless it is in its invoice's currency
 *    (the flipped residual lives in `p1-22-protected-residuals.test.ts`).
 *  - M-09: an allocation stores its idempotency key; a repeat returns the first
 *    allocation and books no second row, a reused key is refused, and a receipt
 *    is recorded only in an ACTIVE currency.
 *
 * Runtime cases run on the `app_runtime` login inside rolled-back transactions.
 * The owner cases run on the admin connection inside rolled-back transactions,
 * and exist ONLY to reach the trigger behind the grant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  withRolledBackTx,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  expectFail,
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  seedCreditNote,
  seedReversal,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

const setUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string> =>
  String(((await c.query(sql, params)).rows[0] as Record<string, unknown>).v);

/** Runs `fn` as the OWNER, in a transaction that is always rolled back. */
async function asOwnerRolledBack(fn: (c: Q) => Promise<void>): Promise<void> {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await setContext(c, ctxA);
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

/** The error an owner-side statement raises, captured inside a savepoint. */
async function refusal(
  c: Q,
  sql: string,
  params: unknown[] = []
): Promise<{ code?: string; message?: string }> {
  await c.query('SAVEPOINT sp_refusal');
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT sp_refusal');
    return e as { code?: string; message?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT sp_refusal');
  throw new Error(`expected a refusal but the statement succeeded: ${sql}`);
}

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('M-01 — the runtime login may UPDATE only what a decision writes', () => {
  it('holds UPDATE on the decision columns and on none of the request facts', async () => {
    const privilege = async (table: string, column: string): Promise<boolean> =>
      (
        await admin.query<{ p: boolean }>(
          `SELECT has_column_privilege('app_runtime', $1, $2, 'UPDATE') AS p`,
          [table, column]
        )
      ).rows[0]!.p;

    for (const column of ['approval_state', 'issued_at']) {
      expect(await privilege('sal.credit_notes', column), column).toBe(true);
    }
    for (const column of [
      'requested_by',
      'amount',
      'reason',
      'currency_code',
      'invoice_id',
      'approved_by',
    ]) {
      expect(await privilege('sal.credit_notes', column), column).toBe(false);
    }
    for (const column of ['approval_state', 'reversed_at']) {
      expect(await privilege('sal.receipt_reversals', column), column).toBe(true);
    }
    for (const column of [
      'requested_by',
      'amount',
      'reason',
      'currency_code',
      'original_receipt_id',
      'approved_by',
    ]) {
      expect(await privilege('sal.receipt_reversals', column), column).toBe(false);
    }
  });

  it('refuses a relabelled requester or a changed amount on a pending credit note', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_cn_relabel', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const note = await seedCreditNote(c, invoice, 30);

      await expectFail(c, '42501', `UPDATE sal.credit_notes SET requested_by = $2 WHERE id = $1`, [
        note,
        P11.APPROVER_USER,
      ]);
      await expectFail(c, '42501', `UPDATE sal.credit_notes SET amount = 90 WHERE id = $1`, [note]);
      await expectFail(c, '42501', `UPDATE sal.credit_notes SET reason = 'edited' WHERE id = $1`, [
        note,
      ]);

      // The request is exactly as it was raised.
      const row = (
        await c.query<{ requested_by: string; amount: string; reason: string }>(
          `SELECT requested_by, amount::text AS amount, reason FROM sal.credit_notes WHERE id = $1`,
          [note]
        )
      ).rows[0]!;
      expect(row).toEqual({ requested_by: USER_A, amount: '30.0000', reason: 'p11 credit' });
    });
  });

  it('refuses the requester approving their own note, whatever the row claims', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_cn_self', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const note = await seedCreditNote(c, invoice, 30);

      // The relabel is refused first (above); the self-approval that would follow
      // it is refused on its own by the primitive, against the STORED requester.
      await expectFail(c, '23514', `SELECT sal.approve_credit_note($1)`, [note]);
      expect(
        await scalar(c, `SELECT approval_state AS v FROM sal.credit_notes WHERE id = $1`, [note])
      ).toBe('pending');

      // A second person still approves through the narrowed grant.
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [note]);
      await setUser(c, USER_A);
      const decided = (
        await c.query<{ approval_state: string; approved_by: string; requested_by: string }>(
          `SELECT approval_state, approved_by, requested_by FROM sal.credit_notes WHERE id = $1`,
          [note]
        )
      ).rows[0]!;
      expect(decided).toEqual({
        approval_state: 'approved',
        approved_by: P11.APPROVER_USER,
        requested_by: USER_A,
      });
    });
  });

  it('refuses a relabelled requester or a changed amount on a pending receipt reversal', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 50, payer: P9.SR });
      const reversal = await seedReversal(c, receipt, 50);

      await expectFail(
        c,
        '42501',
        `UPDATE sal.receipt_reversals SET requested_by = $2 WHERE id = $1`,
        [reversal, P11.APPROVER_USER]
      );
      await expectFail(c, '42501', `UPDATE sal.receipt_reversals SET amount = 10 WHERE id = $1`, [
        reversal,
      ]);
      // And the requester cannot approve their own reversal.
      await expectFail(c, '23514', `SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      expect(
        await scalar(c, `SELECT approval_state AS v FROM sal.receipt_reversals WHERE id = $1`, [
          reversal,
        ])
      ).toBe('pending');
      expect(await scalar(c, `SELECT status AS v FROM sal.receipts WHERE id = $1`, [receipt])).toBe(
        'recorded'
      );
    });
  });
});

describe('M-01 — the trigger freezes the request for any role that can still write it', () => {
  it('refuses a changed requester, amount or reason on a pending credit note', async () => {
    let note = '';
    await asOwnerRolledBack(async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_cn_owner', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      note = await seedCreditNote(c, invoice, 30);
      for (const [column, sql, params] of [
        [
          'requested_by',
          `UPDATE sal.credit_notes SET requested_by = $2 WHERE id = $1`,
          [note, P11.APPROVER_USER],
        ],
        ['amount', `UPDATE sal.credit_notes SET amount = 90 WHERE id = $1`, [note]],
        ['reason', `UPDATE sal.credit_notes SET reason = 'edited' WHERE id = $1`, [note]],
      ] as const) {
        const error = await refusal(c, sql, [...params]);
        expect(error.code, column).toBe('23514');
        expect(error.message, column).toContain(
          'dual control: sal.credit_notes request is frozen once raised'
        );
      }
      // Relabel and approve in ONE statement, as the original requester: the
      // approval guard compares with the stored requester and refuses.
      const combined = await refusal(
        c,
        `UPDATE sal.credit_notes SET requested_by = $2, approval_state = 'approved', issued_at = now() WHERE id = $1`,
        [note, P11.APPROVER_USER]
      );
      expect(combined.code).toBe('23514');
      expect(
        await scalar(c, `SELECT approval_state AS v FROM sal.credit_notes WHERE id = $1`, [note])
      ).toBe('pending');
    });
    expect(note).not.toBe('');
  });

  it('refuses a changed requester or amount on a pending receipt reversal', async () => {
    await asOwnerRolledBack(async (c) => {
      const receipt = await seedReceipt(c, { amount: 50, payer: P9.SR });
      const reversal = await seedReversal(c, receipt, 50);
      for (const sql of [
        `UPDATE sal.receipt_reversals SET requested_by = '${P11.APPROVER_USER}' WHERE id = $1`,
        `UPDATE sal.receipt_reversals SET amount = 10 WHERE id = $1`,
      ]) {
        const error = await refusal(c, sql, [reversal]);
        expect(error.code).toBe('23514');
        expect(error.message).toContain(
          'dual control: sal.receipt_reversals request is frozen once raised'
        );
      }
    });
  });
});

describe('GAP-13 — a credit note is in its invoice currency', () => {
  it('refuses an EUR note on a USD invoice and accepts a USD one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_ccy', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.credit_notes (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason, created_by)
         VALUES ($1,$2,$3,$4,'EUR',10,'wrong currency',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, USER_A]
      );
      const note = await seedCreditNote(c, invoice, 10);
      expect(
        await scalar(c, `SELECT currency_code AS v FROM sal.credit_notes WHERE id = $1`, [note])
      ).toBe('USD');
    });
  });
});

describe('M-09 — an allocation carries its idempotency key', () => {
  it('returns the first allocation for a repeated key and books no second row', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_alloc_key', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      const key = 'fin-alloc-key-0001';

      const first = await scalar(c, `SELECT sal.allocate_receipt($1,$2,60,NULL,$3) AS v`, [
        receipt,
        invoice,
        key,
      ]);
      const again = await scalar(c, `SELECT sal.allocate_receipt($1,$2,60,NULL,$3) AS v`, [
        receipt,
        invoice,
        key,
      ]);
      expect(again).toBe(first);
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.payment_allocations WHERE receipt_id = $1`,
          [receipt]
        )
      ).toBe('1');
      expect(
        await scalar(c, `SELECT idempotency_key AS v FROM sal.payment_allocations WHERE id = $1`, [
          first,
        ])
      ).toBe(key);
      expect(await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice])).toBe(
        '40.0000'
      );
    });
  });

  it('answers a repeat even after the receipt has been used up', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_alloc_full', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 50, payer: P9.SR });
      const key = 'fin-alloc-key-0002';
      const first = await scalar(c, `SELECT sal.allocate_receipt($1,$2,50,NULL,$3) AS v`, [
        receipt,
        invoice,
        key,
      ]);
      // Without the key this would be an over-allocation of an exhausted receipt.
      await expectFail(c, '23514', `SELECT sal.allocate_receipt($1,$2,50)`, [receipt, invoice]);
      expect(
        await scalar(c, `SELECT sal.allocate_receipt($1,$2,50,NULL,$3) AS v`, [
          receipt,
          invoice,
          key,
        ])
      ).toBe(first);
    });
  });

  it('refuses a key reused for a different amount or a different receipt', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_alloc_reuse', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      const other = await seedReceipt(c, { amount: 100, payer: P9.SR });
      const key = 'fin-alloc-key-0003';
      await c.query(`SELECT sal.allocate_receipt($1,$2,30,NULL,$3)`, [receipt, invoice, key]);
      await expectFail(c, '23514', `SELECT sal.allocate_receipt($1,$2,31,NULL,$3)`, [
        receipt,
        invoice,
        key,
      ]);
      await expectFail(c, '23514', `SELECT sal.allocate_receipt($1,$2,30,NULL,$3)`, [
        other,
        invoice,
        key,
      ]);
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.payment_allocations WHERE invoice_id = $1`,
          [invoice]
        )
      ).toBe('1');
    });
  });

  it('keeps the key unique per tenant even for a raw insert', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fin_alloc_uq', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      await c.query(`SELECT sal.allocate_receipt($1,$2,10,NULL,'fin-alloc-key-0004')`, [
        receipt,
        invoice,
      ]);
      await expectFail(
        c,
        '23505',
        `INSERT INTO sal.payment_allocations (tenant_id, company_id, branch_id, receipt_id, invoice_id,
           currency_code, amount, allocated_by, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',1,$6,'fin-alloc-key-0004',$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, invoice, USER_A]
      );
    });
  });
});

describe('M-09 — a receipt is recorded only in an active currency', () => {
  it('refuses a withdrawn currency and an unknown code', async () => {
    await asOwnerRolledBack(async (c) => {
      // A test currency, withdrawn, inside a transaction that is always rolled back.
      await c.query(
        `INSERT INTO shared.currencies (code, name, minor_unit, status, created_by)
         VALUES ('XTS', 'Test currency', 2, 'inactive', $1)`,
        [USER_A]
      );
      const withdrawn = await refusal(
        c,
        `SELECT sal.record_receipt($1,$2,$3,$4,'XTS',10,NULL,NULL,NULL)`,
        [COMPANY_A1, BRANCH_A1, P11.PM_CASH, P9.SR]
      );
      expect(withdrawn.code).toBe('23514');
      expect(withdrawn.message).toContain('is not an active currency');

      await c.query(`UPDATE shared.currencies SET status = 'active' WHERE code = 'XTS'`);
      await c.query(`SELECT sal.record_receipt($1,$2,$3,$4,'XTS',10,NULL,NULL,NULL)`, [
        COMPANY_A1,
        BRANCH_A1,
        P11.PM_CASH,
        P9.SR,
      ]);

      const unknown = await refusal(
        c,
        `SELECT sal.record_receipt($1,$2,$3,$4,'XQQ',10,NULL,NULL,NULL)`,
        [COMPANY_A1, BRANCH_A1, P11.PM_CASH, P9.SR]
      );
      expect(unknown.code).toBe('23514');
    });
  });
});
