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
