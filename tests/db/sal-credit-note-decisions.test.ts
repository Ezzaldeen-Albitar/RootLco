/**
 * P1-32-PRE-OD-FD2A — credit-note withdrawal and rejection (ADR-023, D3) and the
 * frozen decision dates of migration `20260930110000_sal_credit_note_decisions.sql`,
 * the database half.
 *
 * Every case is written so it FAILS when the control it names is removed:
 *
 *  - D3: the requester alone withdraws a pending note; a different person holding
 *    `sal.credit.manage` in the note's scope rejects one, with a reason that is
 *    not blank; approved, rejected and withdrawn are terminal. Each rule is held
 *    by the trigger `sal.guard_credit_note_decision`, so it is proved through the
 *    primitives AND through a raw UPDATE on the owner connection, which bypasses
 *    every grant but not the trigger. A raw INSERT on the runtime login cannot
 *    skip that trigger: `sal.stamp_dual_control_maker` births every note pending,
 *    with no decider, decision date, decision reason or issue date.
 *  - Frozen dates: an approved note's `issued_at`, a declined note's decider and
 *    decision time, and an approved reversal's `reversed_at` cannot be changed
 *    afterwards — the runtime login holds no UPDATE on any of them, and the
 *    trigger refuses the change for a role that could still write it. The dates
 *    are stamped by the trigger, never taken from the statement.
 *  - Withdrawn and rejected notes credit nothing: the open receivable is unchanged.
 *  - D2, part 1 (`20261008121000_sal_refund_obligations.sql`): the approval ceiling is
 *    the issued gross less the credits already approved, held under the invoice lock
 *    against two approvals racing on committed rows; the excess of an approved credit
 *    over what was still owed is exactly one open `sal.refund_obligations` row with
 *    one financial event, and none when the credit stays within; a raw obligation is
 *    bound to the approved note, its invoice, customer, currency, minor unit and the
 *    excess; every fact and state is frozen, nothing is deleted, row-level security is
 *    forced; the open receivable never goes below zero and the as-of read agrees; a
 *    receipt behind an open obligation is not reversed (interim rule).
 *  - The FD2A review residuals (`20261008130000_sal_refund_obligation_guards.sql`,
 *    P1-32-PRE-OD-FD2B): a raw obligation for a credit approved in an EARLIER
 *    transaction is refused even when its arithmetic matches; and a raw UPDATE of
 *    `approval_state` above the gross less the approved credits is refused by the
 *    decision trigger itself.
 *
 * Runtime cases run on the `app_runtime` login inside rolled-back transactions;
 * owner cases run on the admin connection inside rolled-back transactions.
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
  USER_A,
  TENANT_A,
  TENANT_B,
  USER_B,
  COMPANY_A1,
  BRANCH_A1,
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
  allocateReceipt,
  cleanP111Committed,
  ctxNoPerm,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

const setUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string | null> => {
  const value = ((await c.query(sql, params)).rows[0] as Record<string, unknown>).v;
  return value === null || value === undefined ? null : String(value);
};

const stateOf = (c: Q, note: string) =>
  scalar(c, `SELECT approval_state AS v FROM sal.credit_notes WHERE id = $1`, [note]);

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

/** The error a statement raises, captured inside a savepoint. */
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

/** An issued USD invoice of 100 and a pending note of 30 raised by USER_A. */
async function pendingNote(c: Q, tag: string): Promise<{ invoice: string; note: string }> {
  const { invoice } = await seedInvoiceWithLine(c, tag, { net: 100, tax: 0 });
  await issueInvoice(c, invoice);
  const note = await seedCreditNote(c, invoice, 30);
  return { invoice, note };
}

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});

afterAll(async () => {
  // The D2 concurrency case commits its fixture; the rest roll back.
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('D3 — the requester withdraws their own pending request', () => {
  it('withdraws, stamps the requester as decider, and leaves the receivable untouched', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice, note } = await pendingNote(c, 'fd2a_withdraw');
      const before = await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [
        invoice,
      ]);
      await c.query(`SELECT sal.withdraw_credit_note($1)`, [note]);
      const row = (
        await c.query<{
          approval_state: string;
          decided_by: string;
          decided: boolean;
          approved_by: string | null;
          issued_at: Date | null;
          decision_reason: string | null;
        }>(
          `SELECT approval_state, decided_by, decided_at IS NOT NULL AS decided, approved_by,
                  issued_at, decision_reason
             FROM sal.credit_notes WHERE id = $1`,
          [note]
        )
      ).rows[0]!;
      expect(row).toEqual({
        approval_state: 'withdrawn',
        decided_by: USER_A,
        decided: true,
        approved_by: null,
        issued_at: null,
        decision_reason: null,
      });
      expect(await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice])).toBe(
        before
      );
      // Idempotent for the requester: a second withdrawal changes nothing.
      await c.query(`SELECT sal.withdraw_credit_note($1)`, [note]);
      expect(await stateOf(c, note)).toBe('withdrawn');
    });
  });

  it('refuses a withdrawal by anyone other than the requester', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { note } = await pendingNote(c, 'fd2a_withdraw_other');
      await setUser(c, P11.APPROVER_USER);
      await expectFail(c, '23514', `SELECT sal.withdraw_credit_note($1)`, [note]);
      await expectFail(
        c,
        '23514',
        `UPDATE sal.credit_notes SET approval_state = 'withdrawn' WHERE id = $1`,
        [note]
      );
      expect(await stateOf(c, note)).toBe('pending');
    });
  });

  it('refuses approving a withdrawn note', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { note } = await pendingNote(c, 'fd2a_withdraw_then_approve');
      await c.query(`SELECT sal.withdraw_credit_note($1)`, [note]);
      await setUser(c, P11.APPROVER_USER);
      await expectFail(c, '23514', `SELECT sal.approve_credit_note($1)`, [note]);
      await expectFail(c, '23514', `SELECT sal.reject_credit_note($1, 'late')`, [note]);
      expect(await stateOf(c, note)).toBe('withdrawn');
    });
  });
});

describe('D3 — only another authorised person rejects, with a reason', () => {
  it('rejects by a different person, recording the decider and the reason', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice, note } = await pendingNote(c, 'fd2a_reject');
      const before = await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [
        invoice,
      ]);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.reject_credit_note($1, $2)`, [
        note,
        'Duplicate of an earlier note',
      ]);
      const row = (
        await c.query<{
          approval_state: string;
          decided_by: string;
          decision_reason: string;
          approved_by: string | null;
          issued_at: Date | null;
        }>(
          `SELECT approval_state, decided_by, decision_reason, approved_by, issued_at
             FROM sal.credit_notes WHERE id = $1`,
          [note]
        )
      ).rows[0]!;
      expect(row).toEqual({
        approval_state: 'rejected',
        decided_by: P11.APPROVER_USER,
        decision_reason: 'Duplicate of an earlier note',
        approved_by: null,
        issued_at: null,
      });
      expect(await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice])).toBe(
        before
      );
      // Approving afterwards is refused.
      await expectFail(c, '23514', `SELECT sal.approve_credit_note($1)`, [note]);
    });
  });

  it('refuses the requester rejecting their own request', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { note } = await pendingNote(c, 'fd2a_self_reject');
      await expectFail(c, '23514', `SELECT sal.reject_credit_note($1, 'mine')`, [note]);
      await expectFail(
        c,
        '23514',
        `UPDATE sal.credit_notes SET approval_state = 'rejected', decision_reason = 'mine' WHERE id = $1`,
        [note]
      );
      expect(await stateOf(c, note)).toBe('pending');
    });
  });

  it('refuses a rejection with no reason, a blank one or one over 2000 characters', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { note } = await pendingNote(c, 'fd2a_reject_reason');
      await setUser(c, P11.APPROVER_USER);
      for (const reason of [null, '', '   ', 'x'.repeat(2001)]) {
        await expectFail(c, '23514', `SELECT sal.reject_credit_note($1, $2)`, [note, reason]);
      }
      expect(await stateOf(c, note)).toBe('pending');
    });
  });

  it('refuses a rejection by a person without sal.credit.manage in the note scope', async () => {
    await asOwnerRolledBack(async (c) => {
      const { note } = await pendingNote(c, 'fd2a_reject_noperm');
      await setUser(c, P11.NOPERM_USER);
      const error = await refusal(
        c,
        `UPDATE sal.credit_notes SET approval_state = 'rejected', decision_reason = 'no' WHERE id = $1`,
        [note]
      );
      expect(error.code).toBe('42501');
      expect(error.message).toContain('credit_note_reject_permission_missing');
      expect(await stateOf(c, note)).toBe('pending');
    });
  });
});

describe('D3 — a decision is terminal', () => {
  it('refuses withdrawing or rejecting an approved note', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { note } = await pendingNote(c, 'fd2a_terminal_approved');
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [note]);
      await expectFail(c, '23514', `SELECT sal.reject_credit_note($1, 'too late')`, [note]);
      await setUser(c, USER_A);
      await expectFail(c, '23514', `SELECT sal.withdraw_credit_note($1)`, [note]);
      expect(await stateOf(c, note)).toBe('approved');
    });
  });

  it('refuses withdrawing a rejected note', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { note } = await pendingNote(c, 'fd2a_terminal_rejected');
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.reject_credit_note($1, 'wrong invoice')`, [note]);
      await setUser(c, USER_A);
      await expectFail(c, '23514', `SELECT sal.withdraw_credit_note($1)`, [note]);
      expect(await stateOf(c, note)).toBe('rejected');
    });
  });

  it('refuses a raw state change of any decided note, for a role that can still write it', async () => {
    await asOwnerRolledBack(async (c) => {
      const approved = (await pendingNote(c, 'fd2a_raw_approved')).note;
      const rejected = (await pendingNote(c, 'fd2a_raw_rejected')).note;
      const withdrawn = (await pendingNote(c, 'fd2a_raw_withdrawn')).note;
      await c.query(`SELECT sal.withdraw_credit_note($1)`, [withdrawn]);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [approved]);
      await c.query(`SELECT sal.reject_credit_note($1, 'not due')`, [rejected]);
      for (const [note, next] of [
        [approved, 'pending'],
        [approved, 'rejected'],
        [rejected, 'approved'],
        [rejected, 'pending'],
        [withdrawn, 'pending'],
        [withdrawn, 'approved'],
      ] as const) {
        const error = await refusal(
          c,
          `UPDATE sal.credit_notes SET approval_state = $2 WHERE id = $1`,
          [note, next]
        );
        expect(error.code, `${next}`).toBe('23514');
        expect(error.message, `${next}`).toContain('credit_note_decision_frozen');
      }
    });
  });
});

describe('D3 — a raw INSERT cannot create a decided note', () => {
  // The decision guard is BEFORE UPDATE only and app_runtime holds table-level
  // INSERT on sal.credit_notes, so the BEFORE INSERT stamp
  // `sal.stamp_dual_control_maker` must birth every note pending and undecided.
  // Without it the 'rejected' and 'withdrawn' rows below are stored as written:
  // a fabricated decider, a backdated decision time, and no decision rule run.
  it('births every note pending with no decider, decision date, reason or issue date', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fd2a_forged_insert', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const forged: Record<string, string> = {};
      for (const [state, decider, reason] of [
        ['rejected', P11.APPROVER_USER, 'forged'],
        ['withdrawn', USER_A, null],
        ['approved', P11.APPROVER_USER, null],
        ['pending', null, null],
      ] as const) {
        const row = (
          await c.query<{
            id: string;
            approval_state: string;
            decided_by: string | null;
            decided_at: Date | null;
            decision_reason: string | null;
            issued_at: Date | null;
            approved_by: string | null;
            approved_at: Date | null;
            requested_by: string;
          }>(
            `INSERT INTO sal.credit_notes
               (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason,
                created_by, approval_state, decided_by, decided_at, decision_reason, issued_at,
                approved_by, approved_at)
             VALUES ($1, $2, $3, $4, 'USD', 10, 'forged decision', $5, $6, $7,
                     '2020-01-01T00:00:00Z', $8, '2020-01-01T00:00:00Z', $7, '2020-01-01T00:00:00Z')
             RETURNING id, approval_state, decided_by, decided_at, decision_reason, issued_at,
                       approved_by, approved_at, requested_by`,
            [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, USER_A, state, decider, reason]
          )
        ).rows[0]!;
        const { id, ...stored } = row;
        expect(stored, state).toEqual({
          approval_state: 'pending',
          decided_by: null,
          decided_at: null,
          decision_reason: null,
          issued_at: null,
          approved_by: null,
          approved_at: null,
          requested_by: USER_A,
        });
        forged[state] = id;
      }
      // Each is an ordinary pending request: the decision rules still apply to it.
      await expectFail(c, '23514', `SELECT sal.reject_credit_note($1, 'mine')`, [forged.rejected]);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.reject_credit_note($1, 'not due')`, [forged.rejected]);
      expect(
        await scalar(
          c,
          `SELECT (approval_state = 'rejected' AND decided_by = $2
                   AND decided_at > now() - interval '1 hour')::text AS v
             FROM sal.credit_notes WHERE id = $1`,
          [forged.rejected, P11.APPROVER_USER]
        )
      ).toBe('true');
    });
  });
});

describe('Frozen dates — the runtime login may not write any decision date', () => {
  it('holds UPDATE on the state and the decision reason only', async () => {
    const privilege = async (table: string, column: string): Promise<boolean> =>
      (
        await admin.query<{ p: boolean }>(
          `SELECT has_column_privilege('app_runtime', $1, $2, 'UPDATE') AS p`,
          [table, column]
        )
      ).rows[0]!.p;
    for (const column of ['approval_state', 'decision_reason']) {
      expect(await privilege('sal.credit_notes', column), column).toBe(true);
    }
    for (const column of ['issued_at', 'approved_at', 'approved_by', 'decided_by', 'decided_at']) {
      expect(await privilege('sal.credit_notes', column), column).toBe(false);
    }
    expect(await privilege('sal.receipt_reversals', 'approval_state')).toBe(true);
    for (const column of ['reversed_at', 'approved_at', 'approved_by']) {
      expect(await privilege('sal.receipt_reversals', column), column).toBe(false);
    }
  });

  it('refuses backdating an approved note and a declined note as the runtime login', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const approved = (await pendingNote(c, 'fd2a_bd1')).note;
      const withdrawn = (await pendingNote(c, 'fd2a_bd2')).note;
      await c.query(`SELECT sal.withdraw_credit_note($1)`, [withdrawn]);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [approved]);
      await expectFail(
        c,
        '42501',
        `UPDATE sal.credit_notes SET issued_at = '2020-01-01T00:00:00Z' WHERE id = $1`,
        [approved]
      );
      await expectFail(
        c,
        '42501',
        `UPDATE sal.credit_notes SET decided_at = '2020-01-01T00:00:00Z' WHERE id = $1`,
        [withdrawn]
      );
      // A decision reason cannot be added to a decided note either.
      await expectFail(
        c,
        '23514',
        `UPDATE sal.credit_notes SET decision_reason = 'after the fact' WHERE id = $1`,
        [approved]
      );
    });
  });

  it('refuses backdating any decision date for a role that can still write it', async () => {
    await asOwnerRolledBack(async (c) => {
      const approved = (await pendingNote(c, 'fd2a_bd3')).note;
      const rejected = (await pendingNote(c, 'fd2a_bd4')).note;
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [approved]);
      await c.query(`SELECT sal.reject_credit_note($1, 'duplicate')`, [rejected]);
      for (const [note, column] of [
        [approved, 'issued_at'],
        [approved, 'approved_at'],
        [rejected, 'decided_at'],
      ] as const) {
        const error = await refusal(
          c,
          `UPDATE sal.credit_notes SET ${column} = '2020-01-01T00:00:00Z' WHERE id = $1`,
          [note]
        );
        expect(error.code, column).toBe('23514');
        expect(error.message, column).toContain('credit_note_decision_frozen');
      }
      const reason = await refusal(
        c,
        `UPDATE sal.credit_notes SET decision_reason = 'rewritten' WHERE id = $1`,
        [rejected]
      );
      expect(reason.message).toContain('credit_note_decision_frozen');
      const decider = await refusal(
        c,
        `UPDATE sal.credit_notes SET decided_by = $2 WHERE id = $1`,
        [rejected, USER_A]
      );
      expect(decider.code).toBe('23514');
    });
  });

  it('stamps the issue date at approval, whatever the statement names', async () => {
    await asOwnerRolledBack(async (c) => {
      const { note } = await pendingNote(c, 'fd2a_stamp_issued');
      await setUser(c, P11.APPROVER_USER);
      await c.query(
        `UPDATE sal.credit_notes SET approval_state = 'approved', issued_at = '2020-01-01T00:00:00Z' WHERE id = $1`,
        [note]
      );
      expect(
        await scalar(
          c,
          `SELECT (issued_at > now() - interval '1 hour')::text AS v FROM sal.credit_notes WHERE id = $1`,
          [note]
        )
      ).toBe('true');
    });
  });

  it('refuses writing a decision field on a pending note without deciding', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { note } = await pendingNote(c, 'fd2a_pending_fields');
      await expectFail(
        c,
        '23514',
        `UPDATE sal.credit_notes SET decision_reason = 'early' WHERE id = $1`,
        [note]
      );
      expect(await stateOf(c, note)).toBe('pending');
    });
  });

  it('refuses backdating an approved receipt reversal', async () => {
    await asOwnerRolledBack(async (c) => {
      const receipt = await seedReceipt(c, { amount: 50, payer: P9.SR });
      const reversal = await seedReversal(c, receipt, 50);
      // A pending reversal carries no reversal date.
      const early = await refusal(
        c,
        `UPDATE sal.receipt_reversals SET reversed_at = now() WHERE id = $1`,
        [reversal]
      );
      expect(early.code).toBe('23514');
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      for (const column of ['reversed_at', 'approved_at']) {
        const error = await refusal(
          c,
          `UPDATE sal.receipt_reversals SET ${column} = '2020-01-01T00:00:00Z' WHERE id = $1`,
          [reversal]
        );
        expect(error.code, column).toBe('23514');
        expect(error.message, column).toContain('decision is frozen');
      }
    });
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 40, payer: P9.SR });
      const reversal = await seedReversal(c, receipt, 40);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      expect(
        await scalar(
          c,
          `SELECT (reversed_at IS NOT NULL)::text AS v FROM sal.receipt_reversals WHERE id = $1`,
          [reversal]
        )
      ).toBe('true');
      await expectFail(
        c,
        '42501',
        `UPDATE sal.receipt_reversals SET reversed_at = '2020-01-01T00:00:00Z' WHERE id = $1`,
        [reversal]
      );
    });
  });
});

// ---------------------------------------------------------------------------
// ADR-023 D2, part 1 (P1-32-PRE-OD-FD2A, 20261008121000_sal_refund_obligations.sql):
// the credit ceiling is what the invoice can still be credited, and the excess of
// an approved credit over what was still owed is a refund obligation.
// ---------------------------------------------------------------------------

/** An issued USD invoice of `gross`, paid `paid` through the primitives. */
async function paidInvoice(
  c: Q,
  tag: string,
  gross: number,
  paid: number
): Promise<{ invoice: string; payer: string }> {
  const { invoice, payer } = await seedInvoiceWithLine(c, tag, { net: gross, tax: 0 });
  await issueInvoice(c, invoice);
  if (paid > 0) {
    const receipt = await seedReceipt(c, { amount: paid, payer: P9.SR });
    await allocateReceipt(c, receipt, invoice, paid);
  }
  return { invoice, payer };
}

/** Approves `note` as the second person and comes back as USER_A. */
async function approveAsSecond(c: Q, note: string): Promise<void> {
  await setUser(c, P11.APPROVER_USER);
  await c.query(`SELECT sal.approve_credit_note($1)`, [note]);
  await setUser(c, USER_A);
}

interface ObligationRow {
  partner_id: string;
  invoice_id: string;
  currency_code: string;
  amount: string;
  source: string;
  state: string;
  created_by: string;
}

const obligationsOf = async (c: Q, invoice: string): Promise<ObligationRow[]> =>
  (
    await c.query<ObligationRow>(
      `SELECT partner_id, invoice_id, currency_code, amount::text AS amount, source, state, created_by
         FROM sal.refund_obligations ro WHERE invoice_id = $1 ORDER BY ro.amount DESC, ro.id`,
      [invoice]
    )
  ).rows;

const openOf = (c: Q, invoice: string) =>
  scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice]);

const obligationIdOf = (c: Q, invoice: string) =>
  scalar(c, `SELECT id::text AS v FROM sal.refund_obligations WHERE invoice_id = $1`, [invoice]);

describe('D2 — the ceiling is the invoice gross less the credits already approved', () => {
  it('approves a credit on a fully paid invoice and records exactly the excess as owed', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice, payer } = await paidInvoice(c, 'fd2a_d2_paid', 100, 100);
      expect(await openOf(c, invoice)).toBe('0.0000');
      const note = await seedCreditNote(c, invoice, 30);
      await approveAsSecond(c, note);

      expect(await stateOf(c, note)).toBe('approved');
      expect(await obligationsOf(c, invoice)).toEqual([
        {
          partner_id: payer,
          invoice_id: invoice,
          currency_code: 'USD',
          amount: '30.0000',
          source: 'credit_excess',
          state: 'open',
          created_by: P11.APPROVER_USER,
        },
      ]);
      // Never below zero: the 30 below zero is the obligation's.
      expect(await openOf(c, invoice)).toBe('0.0000');
      // One financial event, bound to the obligation's own amount and currency.
      const events = (
        await c.query<{ amount: string; currency_code: string; source_type: string }>(
          `SELECT fe.amount::text AS amount, fe.currency_code, fe.source_type
             FROM sal.financial_events fe JOIN sal.refund_obligations ro ON ro.id = fe.source_id
            WHERE ro.invoice_id = $1 AND fe.event_type = 'refund_obligation_recorded'`,
          [invoice]
        )
      ).rows;
      expect(events).toEqual([
        { amount: '30.0000', currency_code: 'USD', source_type: 'refund_obligation' },
      ]);
    });
  });

  it('records only the part above what was still owed, and nothing when it was all owed', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await paidInvoice(c, 'fd2a_d2_partly', 100, 70);
      // 30 still owed: a credit of 20 reduces it and leaves nobody owed anything.
      const within = await seedCreditNote(c, invoice, 20);
      await approveAsSecond(c, within);
      expect(await obligationsOf(c, invoice)).toEqual([]);
      expect(await openOf(c, invoice)).toBe('10.0000');
      // 10 still owed: a credit of 25 clears it and leaves the customer owed 15.
      const beyond = await seedCreditNote(c, invoice, 25);
      await approveAsSecond(c, beyond);
      expect((await obligationsOf(c, invoice)).map((row) => row.amount)).toEqual(['15.0000']);
      expect(await openOf(c, invoice)).toBe('0.0000');
      // Nothing owed any more: a further credit is owed back in full.
      const after = await seedCreditNote(c, invoice, 5);
      await approveAsSecond(c, after);
      expect((await obligationsOf(c, invoice)).map((row) => row.amount)).toEqual([
        '15.0000',
        '5.0000',
      ]);
    });
  });

  it('refuses a credit above the gross less the approved credits, and counts no pending note', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await paidInvoice(c, 'fd2a_d2_ceiling', 100, 100);
      const first = await seedCreditNote(c, invoice, 60);
      // A pending note credits nothing and does not lower the ceiling of another.
      const pending = await seedCreditNote(c, invoice, 90);
      await approveAsSecond(c, first);
      await setUser(c, P11.APPROVER_USER);
      const refused = await refusal(c, `SELECT sal.approve_credit_note($1)`, [pending]);
      expect(refused.code).toBe('23514');
      expect(refused.message?.startsWith('credit_note_exceeds_creditable:')).toBe(true);
      expect(await stateOf(c, pending)).toBe('pending');
      // Exactly what remains creditable is accepted.
      await setUser(c, USER_A);
      const exact = await seedCreditNote(c, invoice, 40);
      await approveAsSecond(c, exact);
      expect(
        await scalar(
          c,
          `SELECT sum(amount)::text AS v FROM sal.credit_notes
            WHERE invoice_id = $1 AND approval_state = 'approved'`,
          [invoice]
        )
      ).toBe('100.0000');
      expect((await obligationsOf(c, invoice)).map((row) => row.amount)).toEqual([
        '60.0000',
        '40.0000',
      ]);
    });
  });

  it('keeps the as-of answer equal to the live one at the read, at zero', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await paidInvoice(c, 'fd2a_d2_asof', 100, 100);
      const note = await seedCreditNote(c, invoice, 45);
      await approveAsSecond(c, note);
      const live = await openOf(c, invoice);
      expect(live).toBe('0.0000');
      expect(
        await scalar(c, `SELECT sal.invoice_open_receivable_as_of($1, now())::text AS v`, [invoice])
      ).toBe(live);
      expect(
        await scalar(
          c,
          `SELECT sal.invoice_open_receivable_as_of($1, now() + interval '1 day')::text AS v`,
          [invoice]
        )
      ).toBe(live);
    });
  });
});

describe('D2 — an obligation is bound to the credit that created it', () => {
  /** An approved credit within what was owed: no obligation, and none may be invented. */
  async function approvedWithin(c: Q, tag: string) {
    const { invoice, payer } = await paidInvoice(c, tag, 100, 50);
    const note = await seedCreditNote(c, invoice, 20);
    await approveAsSecond(c, note);
    expect(await obligationsOf(c, invoice)).toEqual([]);
    return { invoice, payer, note };
  }

  const rawInsert = (
    c: Q,
    row: { invoice: string; note: string; partner: string; currency: string; amount: string }
  ) =>
    refusal(
      c,
      `INSERT INTO sal.refund_obligations
         (tenant_id, company_id, branch_id, partner_id, invoice_id, credit_note_id, currency_code, amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        row.partner,
        row.invoice,
        row.note,
        row.currency,
        row.amount,
        USER_A,
      ]
    );

  it('refuses a raw obligation that is not the excess, or names another currency or customer', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice, payer, note } = await approvedWithin(c, 'fd2a_d2_raw');
      const base = { invoice, note, partner: payer, currency: 'USD', amount: '20.0000' };

      const invented = await rawInsert(c, base);
      expect(invented.code).toBe('23514');
      expect(invented.message?.startsWith('refund_obligation_amount_mismatch:')).toBe(true);

      const currency = await rawInsert(c, { ...base, currency: 'JOD' });
      expect(currency.message?.startsWith('refund_obligation_currency_mismatch:')).toBe(true);

      const minorUnit = await rawInsert(c, { ...base, amount: '0.0050' });
      expect(minorUnit.message?.startsWith('refund_obligation_minor_unit:')).toBe(true);

      const partner = await rawInsert(c, { ...base, partner: P9.AP });
      expect(partner.message?.startsWith('refund_obligation_partner_mismatch:')).toBe(true);

      const pending = await seedCreditNote(c, invoice, 10);
      const unapproved = await rawInsert(c, { ...base, note: pending });
      expect(unapproved.message?.startsWith('refund_obligation_credit_not_approved:')).toBe(true);

      expect(await obligationsOf(c, invoice)).toEqual([]);
    });
  });

  it('freezes every fact, refuses every state change for now, and is never deleted', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await paidInvoice(c, 'fd2a_d2_frozen', 100, 100);
      const note = await seedCreditNote(c, invoice, 30);
      await approveAsSecond(c, note);
      const id = await obligationIdOf(c, invoice);
      // The runtime login holds UPDATE of the state only, and no DELETE at all.
      await expectFail(c, '42501', `UPDATE sal.refund_obligations SET amount = 1 WHERE id = $1`, [
        id,
      ]);
      await expectFail(c, '42501', `DELETE FROM sal.refund_obligations WHERE id = $1`, [id]);
      const transition = await refusal(
        c,
        `UPDATE sal.refund_obligations SET state = 'settled' WHERE id = $1`,
        [id]
      );
      expect(transition.message?.startsWith('refund_obligation_transition_unavailable:')).toBe(
        true
      );
    });
    // The owner bypasses every grant but not the trigger.
    await asOwnerRolledBack(async (c) => {
      const { invoice } = await paidInvoice(c, 'fd2a_d2_frozen_owner', 100, 100);
      const note = await seedCreditNote(c, invoice, 30);
      await approveAsSecond(c, note);
      const id = await obligationIdOf(c, invoice);
      const amount = await refusal(
        c,
        `UPDATE sal.refund_obligations SET amount = 1 WHERE id = $1`,
        [id]
      );
      expect(amount.message?.startsWith('refund_obligation_frozen:')).toBe(true);
      const cancelled = await refusal(
        c,
        `UPDATE sal.refund_obligations SET state = 'cancelled' WHERE id = $1`,
        [id]
      );
      expect(cancelled.message?.startsWith('refund_obligation_transition_unavailable:')).toBe(true);
    });
    const privileges = (
      await admin.query<{ p: string }>(
        `SELECT privilege_type AS p FROM information_schema.role_table_grants
          WHERE grantee = 'app_runtime' AND table_schema = 'sal' AND table_name = 'refund_obligations'
          ORDER BY 1`
      )
    ).rows.map((row) => row.p);
    expect(privileges).toEqual(['INSERT', 'SELECT']);
  });

  it('is visible only with sal.finance.view, in its own tenant (forced RLS)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await paidInvoice(c, 'fd2a_d2_rls', 100, 100);
      const note = await seedCreditNote(c, invoice, 30);
      await approveAsSecond(c, note);
      const count = () =>
        scalar(c, `SELECT count(*)::text AS v FROM sal.refund_obligations WHERE invoice_id = $1`, [
          invoice,
        ]);
      expect(await count()).toBe('1');
      await setContext(c, ctxNoPerm);
      expect(await count()).toBe('0');
      await setContext(c, { tenantId: TENANT_B, userId: USER_B });
      expect(await count()).toBe('0');
    });
    const flags = (
      await admin.query<{ rls: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS forced
           FROM pg_class WHERE oid = 'sal.refund_obligations'::regclass`
      )
    ).rows[0]!;
    expect(flags).toEqual({ rls: true, forced: true });
  });
});

describe('D2 — an obligation belongs to the approval that created it (FD2B residual a)', () => {
  it('refuses a raw obligation for a credit approved in an earlier transaction', async () => {
    /*
     * The reviewer's case on #536. Gross 100; credit A of 50 approved while nothing
     * was paid, so A left nobody owed anything; then a receipt of 50, and credit B of
     * 50 approved, which the customer is rightly owed back in full. A raw INSERT for
     * A of 50 matched the guard's arithmetic (50 less max(100 - 50 - 50, 0)) and
     * would have doubled what the customer is owed. A must have been approved in
     * the transaction that records its obligation, and it was not.
     */
    const setup = await runtime.connect();
    let invoice = '';
    let noteA = '';
    try {
      await setup.query('BEGIN');
      await setContext(setup, ctxA);
      invoice = (await paidInvoice(setup, 'fd2b_res_a_earlier', 100, 0)).invoice;
      noteA = await seedCreditNote(setup, invoice, 50);
      await approveAsSecond(setup, noteA);
      await setup.query('COMMIT');
    } catch (error) {
      await setup.query('ROLLBACK');
      throw error;
    } finally {
      setup.release();
    }

    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect(await obligationsOf(c, invoice)).toEqual([]);
      const receipt = await seedReceipt(c, { amount: 50, payer: P9.SR });
      await allocateReceipt(c, receipt, invoice, 50);
      const noteB = await seedCreditNote(c, invoice, 50);
      await approveAsSecond(c, noteB);
      expect((await obligationsOf(c, invoice)).map((row) => row.amount)).toEqual(['50.0000']);

      const payer = await scalar(
        c,
        `SELECT payer_partner_id::text AS v FROM sal.invoices WHERE id = $1`,
        [invoice]
      );
      const raw = await refusal(
        c,
        `INSERT INTO sal.refund_obligations
           (tenant_id, company_id, branch_id, partner_id, invoice_id, credit_note_id, currency_code, amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'USD','50.0000',$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, payer, invoice, noteA, USER_A]
      );
      expect(raw.code).toBe('23514');
      expect(raw.message?.startsWith('refund_obligation_credit_not_current:')).toBe(true);
      // Still exactly B's obligation, and nothing for A.
      expect((await obligationsOf(c, invoice)).map((row) => row.amount)).toEqual(['50.0000']);
    });
  });
});

describe('D2 — the decision trigger holds the ceiling for a raw approval (FD2B residual b)', () => {
  it('refuses a raw UPDATE of approval_state above the gross less the approved credits', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await paidInvoice(c, 'fd2b_res_b_raw', 100, 0);
      const first = await seedCreditNote(c, invoice, 60);
      const second = await seedCreditNote(c, invoice, 60);
      await approveAsSecond(c, first);
      // The runtime login may write approval_state, and the approver holds the code
      // and a limit far above 120: only the ceiling stands in the way.
      await setUser(c, P11.APPROVER_USER);
      const raw = await refusal(
        c,
        `UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`,
        [second]
      );
      expect(raw.code).toBe('23514');
      expect(raw.message?.startsWith('credit_note_exceeds_creditable:')).toBe(true);
      await setUser(c, USER_A);
      expect(await stateOf(c, second)).toBe('pending');
      // Exactly what remains is still admitted through the same raw path.
      const exact = await seedCreditNote(c, invoice, 40);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`, [
        exact,
      ]);
      await setUser(c, USER_A);
      expect(await stateOf(c, exact)).toBe('approved');
    });
  });
});

describe('D2 — two approvals racing on one invoice cannot credit past its gross', () => {
  it('serialises on the invoice: the second sees the first and is refused', async () => {
    const setup = await runtime.connect();
    let notes: string[] = [];
    let invoice = '';
    try {
      await setup.query('BEGIN');
      await setContext(setup, ctxA);
      invoice = (await paidInvoice(setup, 'fd2a_d2_race', 100, 100)).invoice;
      notes = [await seedCreditNote(setup, invoice, 60), await seedCreditNote(setup, invoice, 60)];
      await setup.query('COMMIT');
    } catch (error) {
      await setup.query('ROLLBACK');
      throw error;
    } finally {
      setup.release();
    }

    const first = await runtime.connect();
    const second = await runtime.connect();
    try {
      for (const client of [first, second]) {
        await client.query('BEGIN');
        await setContext(client, { tenantId: TENANT_A, userId: P11.APPROVER_USER });
      }
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      await first.query(`SELECT sal.approve_credit_note($1)`, [notes[0]]);
      const racing = second
        .query(`SELECT sal.approve_credit_note($1)`, [notes[1]])
        .then(() => null)
        .catch((error: { code?: string; message?: string }) => error);
      let waited = false;
      for (let attempt = 0; attempt < 50 && !waited; attempt += 1) {
        const lock = await admin.query<{ waiting: boolean }>(
          `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
          [secondPid]
        );
        waited = lock.rows[0]?.waiting === true;
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(waited).toBe(true);
      await first.query('COMMIT');
      const outcome = await racing;
      expect(outcome?.code).toBe('23514');
      expect(outcome?.message?.startsWith('credit_note_exceeds_creditable:')).toBe(true);
      await second.query('ROLLBACK');

      const credited = await admin.query<{ v: string; n: string }>(
        `SELECT sum(amount)::text AS v, count(*)::text AS n FROM sal.credit_notes
          WHERE invoice_id = $1 AND approval_state = 'approved'`,
        [invoice]
      );
      expect(credited.rows[0]).toEqual({ v: '60.0000', n: '1' });
      const owed = await admin.query<{ amount: string }>(
        `SELECT amount::text AS amount FROM sal.refund_obligations WHERE invoice_id = $1`,
        [invoice]
      );
      expect(owed.rows).toEqual([{ amount: '60.0000' }]);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });
});

describe('D2 — a payment behind an open obligation is not reversed (interim rule)', () => {
  it('refuses requesting, and approving, the reversal of a receipt that paid such an invoice', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fd2a_d2_reversal', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      await allocateReceipt(c, receipt, invoice, 100);
      // A reversal requested BEFORE the credit: pending, then the credit leaves the
      // customer owed 30, and the approval of the reversal is refused.
      const early = await seedReversal(c, receipt, 100);
      const note = await seedCreditNote(c, invoice, 30);
      await approveAsSecond(c, note);
      await setUser(c, P11.APPROVER_USER);
      const approval = await refusal(c, `SELECT sal.approve_receipt_reversal($1)`, [early]);
      expect(approval.code).toBe('23514');
      expect(approval.message?.startsWith('receipt_reversal_refund_obligation_open:')).toBe(true);
      await setUser(c, USER_A);
      expect(
        await scalar(c, `SELECT status AS v FROM sal.receipts WHERE id = $1`, [receipt])
      ).not.toBe('reversed');
      // Withdrawn, and asked again: the request itself is refused now.
      await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [early]);
      const request = await refusal(c, `SELECT sal.request_receipt_reversal($1, 'entered twice')`, [
        receipt,
      ]);
      expect(request.code).toBe('23514');
      expect(request.message?.startsWith('receipt_reversal_refund_obligation_open:')).toBe(true);
    });
  });

  it('still reverses a receipt whose invoices owe nobody a refund', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fd2a_d2_reversal_ok', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 60, payer: P9.SR });
      await allocateReceipt(c, receipt, invoice, 60);
      // A credit within what is owed creates no obligation.
      const note = await seedCreditNote(c, invoice, 30);
      await approveAsSecond(c, note);
      const reversal = await seedReversal(c, receipt, 60);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      await setUser(c, USER_A);
      expect(await scalar(c, `SELECT status AS v FROM sal.receipts WHERE id = $1`, [receipt])).toBe(
        'reversed'
      );
      expect(await openOf(c, invoice)).toBe('70.0000');
    });
  });
});
