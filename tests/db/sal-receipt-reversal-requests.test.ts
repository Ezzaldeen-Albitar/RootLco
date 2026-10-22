/**
 * P1-32-PRE-OD-FD4 — the receipt reversal of ADR-023 D4, the database half
 * (migration `20261002090000_sal_receipt_reversal_requests.sql`).
 *
 * Every case is written so it FAILS when the control it names is removed:
 *
 *  - REQUEST: a holder of `sal.payment.record` in the receipt's company and branch
 *    raises a FULL reversal — the receipt's amount and currency, a reason, the
 *    requester stamped from the session — through the primitive or a raw INSERT
 *    (`sal.guard_receipt_reversal_request`); a repeated key answers the same
 *    request; a raw INSERT on the runtime login is born pending and undecided
 *    (`sal.stamp_dual_control_maker`), so it cannot forge a decision or block the
 *    receipt for ever; one LIVE reversal per receipt
 *    (`uq_receipt_reversals_receipt_live`).
 *  - FREEZE: a pending reversal refuses every new allocation of its receipt
 *    (`sal.guard_allocation_receipt_open`), including one racing the request.
 *  - DECIDE: a DIFFERENT person holding `sal.reversal.approve` in the receipt's
 *    company and branch approves or rejects (with a reason); the credit-note
 *    codes are not enough, and neither is the code in another branch; the
 *    requester alone withdraws; decided rows are terminal
 *    (`sal.guard_receipt_reversal_decision`).
 *  - ATOMIC APPROVAL: the receipt is reversed, its allocations stay recorded and
 *    stop counting, every invoice's open amount is restored exactly, one
 *    `receipt_reversed` event; a raw approval that does not reverse the receipt is
 *    refused (`tg_receipt_reversals_applied`); concurrent decisions and
 *    allocations have exactly one outcome.
 *  - REPLACEMENT: one replacement per reversed receipt, only for a receipt an
 *    approved reversal reversed, in the same branch, frozen once recorded.
 *
 * Runtime cases run on the `app_runtime` login inside rolled-back transactions;
 * owner cases run on the admin connection inside rolled-back transactions; the
 * race cases commit their fixture (removed in `afterAll`) so two sessions can see
 * it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client, PoolClient } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  withRolledBackTx,
  USER_A,
  USER_B,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  ctxApprover,
  expectFail,
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  allocateReceipt,
  cleanP111Committed,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

/** Deterministic D4 fixture UUIDs, tenant A. */
const D4 = {
  BRANCH_ELSEWHERE: 'd4b00000-0000-4000-8000-0000000000b2',
  ROLE_CREDIT_ONLY: 'd4a00000-0000-4000-8000-0000000000f1',
  ROLE_APPROVE_ONLY: 'd4a00000-0000-4000-8000-0000000000f2',
  /** Holds sal.finance.view, sal.credit.manage and sal.credit.approve — and NOT sal.reversal.approve. */
  CREDIT_ONLY: 'd4a00000-0000-4000-8000-0000000000a1',
  /** Holds sal.finance.view and sal.reversal.approve — and NOT sal.payment.record. */
  APPROVE_ONLY: 'd4a00000-0000-4000-8000-0000000000a2',
  /** Holds sal.finance.view and sal.reversal.approve in ANOTHER branch only. */
  ELSEWHERE: 'd4a00000-0000-4000-8000-0000000000a3',
  GRANT_ELSEWHERE: 'd4a00000-0000-4000-8000-0000000000e3',
};

const ctx = (userId: string) => ({ tenantId: TENANT_A, userId });

const setUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string | null> => {
  const value = ((await c.query(sql, params)).rows[0] as Record<string, unknown>).v;
  return value === null || value === undefined ? null : String(value);
};

const stateOf = (c: Q, reversal: string) =>
  scalar(c, `SELECT approval_state AS v FROM sal.receipt_reversals WHERE id = $1`, [reversal]);

const receiptStatus = (c: Q, receipt: string) =>
  scalar(c, `SELECT status AS v FROM sal.receipts WHERE id = $1`, [receipt]);

const openOf = (c: Q, invoice: string) =>
  scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice]);

const request = async (c: Q, receipt: string, reason = 'Recorded against the wrong payer') =>
  (
    await c.query<{ id: string }>(`SELECT sal.request_receipt_reversal($1, $2) AS id`, [
      receipt,
      reason,
    ])
  ).rows[0]!.id;

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

/** Expects a refusal with this SQLSTATE whose message starts with the token. */
async function expectToken(
  c: Q,
  code: string,
  token: string,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  const error = await refusal(c, sql, params);
  expect(error.code, token).toBe(code);
  expect(error.message?.startsWith(`${token}:`), error.message).toBe(true);
}

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

/** Runs `fn` on the runtime login and COMMITS, for the race fixtures. */
async function committed<T>(userId: string, fn: (c: Q) => Promise<T>): Promise<T> {
  const c = await runtime.connect();
  try {
    await c.query('BEGIN');
    await setContext(c, ctx(userId));
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}

/**
 * Opens a runtime session in a transaction under `userId`, with its backend pid
 * read BEFORE any statement can block it (a query queued behind a blocked one
 * never answers).
 */
async function session(userId: string): Promise<{ c: PoolClient; pid: number }> {
  const c = await runtime.connect();
  const pid = Number(((await c.query(`SELECT pg_backend_pid() AS v`)).rows[0] as { v: number }).v);
  await c.query('BEGIN');
  await setContext(c, ctx(userId));
  return { c, pid };
}

/**
 * Ends a race: the lock holder is rolled back first if it has not committed (a
 * rollback after a commit only warns), so the waiter is never left blocked; then
 * the waiter's outcome is awaited and the waiter rolled back. Both are released.
 */
async function endRace(
  holder: PoolClient,
  waiter: PoolClient,
  pending: Promise<unknown> | null
): Promise<void> {
  await holder.query('ROLLBACK').catch(() => undefined);
  if (pending) await pending;
  await waiter.query('ROLLBACK').catch(() => undefined);
  holder.release();
  waiter.release();
}

/** Waits until the backend `pid` is waiting on a lock, or fails after five seconds. */
async function untilBlocked(pid: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const row = (
      await admin.query<{ w: string | null }>(
        `SELECT wait_event_type AS w FROM pg_stat_activity WHERE pid = $1`,
        [pid]
      )
    ).rows[0];
    if (row?.w === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`backend ${pid} never waited on a lock`);
}

type Outcome = { ok: true } | { ok: false; code: string | undefined; message: string | undefined };
const settle = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ({ ok: true }) as const,
    (e: { code?: string; message?: string }) => ({ ok: false, code: e.code, message: e.message })
  );

/**
 * A receipt of 100 allocated 60 to an invoice of 100 and 40 to an invoice of 50,
 * so the two open amounts are 40 and 10 before any reversal.
 */
async function allocatedReceipt(
  c: Q,
  tag: string
): Promise<{ receipt: string; invoices: [string, string] }> {
  const first = (await seedInvoiceWithLine(c, `${tag}_1`, { net: 100, tax: 0 })).invoice;
  const second = (await seedInvoiceWithLine(c, `${tag}_2`, { net: 50, tax: 0 })).invoice;
  await issueInvoice(c, first);
  await issueInvoice(c, second);
  const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
  await allocateReceipt(c, receipt, first, 60);
  await allocateReceipt(c, receipt, second, 40);
  return { receipt, invoices: [first, second] };
}

async function seedUser(id: string, tag: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'fixture',$3,$4,$5,'active',$6) ON CONFLICT (id) DO NOTHING`,
    [id, TENANT_A, `d4-${tag}`, `d4-${tag}@fixture.test`, `D4 ${tag}`, USER_A]
  );
}

async function seedRole(id: string, code: string, permissions: readonly string[]): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,$3,$4) ON CONFLICT (id) DO NOTHING`,
    [id, TENANT_A, code, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
      WHERE p.permission_code = ANY($4) ON CONFLICT DO NOTHING`,
    [TENANT_A, id, USER_A, permissions]
  );
}

async function grantUnrestricted(userId: string, roleId: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`,
    [TENANT_A, userId, roleId, USER_A]
  );
}

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'d4_elsewhere','D4 elsewhere','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [D4.BRANCH_ELSEWHERE, TENANT_A, COMPANY_A1, USER_A]
  );
  await seedRole(D4.ROLE_CREDIT_ONLY, 'd4_credit_only', [
    'sal.finance.view',
    'sal.credit.manage',
    'sal.credit.approve',
  ]);
  await seedRole(D4.ROLE_APPROVE_ONLY, 'd4_approve_only', [
    'sal.finance.view',
    'sal.reversal.approve',
  ]);
  await seedUser(D4.CREDIT_ONLY, 'credit-only');
  await seedUser(D4.APPROVE_ONLY, 'approve-only');
  await seedUser(D4.ELSEWHERE, 'elsewhere');
  await grantUnrestricted(D4.CREDIT_ONLY, D4.ROLE_CREDIT_ONLY);
  await grantUnrestricted(D4.APPROVE_ONLY, D4.ROLE_APPROVE_ONLY);
  // ELSEWHERE holds the approving codes in the other branch only.
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped','active',$5,$5) ON CONFLICT (id) DO NOTHING`,
      [D4.GRANT_ELSEWHERE, TENANT_A, D4.ELSEWHERE, D4.ROLE_APPROVE_ONLY, USER_A]
    );
    await c.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       SELECT $1,$2,'branch',$3,$4,$5
        WHERE NOT EXISTS (SELECT 1 FROM iam.grant_scopes WHERE tenant_id = $1 AND grant_id = $2)`,
      [TENANT_A, D4.GRANT_ELSEWHERE, COMPANY_A1, D4.BRANCH_ELSEWHERE, USER_A]
    );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('D4 — a payment recorder requests a FULL reversal', () => {
  it('raises a pending reversal of the receipt amount and currency, stamped to the requester', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: '75.5', payer: P9.SR });
      const reversal = (
        await c.query<{ id: string }>(`SELECT sal.request_receipt_reversal($1, $2, $3) AS id`, [
          receipt,
          'Amount typed wrong',
          'fd4-key-1',
        ])
      ).rows[0]!.id;
      const row = (
        await c.query(
          `SELECT approval_state, amount::text AS amount, currency_code, requested_by, reason,
                  approved_by, reversed_at, decided_by, decision_reason
             FROM sal.receipt_reversals WHERE id = $1`,
          [reversal]
        )
      ).rows[0];
      expect(row).toEqual({
        approval_state: 'pending',
        amount: '75.5000',
        currency_code: 'USD',
        requested_by: USER_A,
        reason: 'Amount typed wrong',
        approved_by: null,
        reversed_at: null,
        decided_by: null,
        decision_reason: null,
      });
      // A pending reversal reverses nothing: the receipt is untouched.
      expect(await receiptStatus(c, receipt)).toBe('recorded');
      // A repeated key answers the same request; reused for another receipt it is refused.
      const again = (
        await c.query<{ id: string }>(`SELECT sal.request_receipt_reversal($1, $2, $3) AS id`, [
          receipt,
          'Amount typed wrong',
          'fd4-key-1',
        ])
      ).rows[0]!.id;
      expect(again).toBe(reversal);
      const other = await seedReceipt(c, { amount: 20, payer: P9.SR });
      await expectToken(
        c,
        '23514',
        'receipt_reversal_idempotency_reused',
        `SELECT sal.request_receipt_reversal($1, 'x', 'fd4-key-1')`,
        [other]
      );
    });
  });

  it('refuses an amount or a currency other than the receipt’s on a raw INSERT', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      for (const [amount, currency, token] of [
        ['60', 'USD', 'receipt_reversal_amount_mismatch'],
        ['100', 'JOD', 'receipt_reversal_currency_mismatch'],
      ] as const) {
        await expectToken(
          c,
          '23514',
          token,
          `INSERT INTO sal.receipt_reversals
             (tenant_id, company_id, branch_id, original_receipt_id, currency_code, amount, reason, created_by)
           VALUES ($1,$2,$3,$4,$5,$6::numeric,'partial',$7)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, currency, amount, USER_A]
        );
      }
    });
  });

  it('refuses a blank, missing or over-long reason', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      for (const reason of [null, '', '   ', 'x'.repeat(2001)]) {
        await expectToken(
          c,
          '23514',
          'receipt_reversal_reason_required',
          `SELECT sal.request_receipt_reversal($1, $2)`,
          [receipt, reason]
        );
      }
    });
  });

  it('refuses a requester without sal.payment.record in the receipt scope', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      await setUser(c, D4.APPROVE_ONLY);
      await expectToken(
        c,
        '42501',
        'receipt_reversal_request_permission_missing',
        `SELECT sal.request_receipt_reversal($1, 'not mine to ask')`,
        [receipt]
      );
      await expectToken(
        c,
        '42501',
        'receipt_reversal_request_permission_missing',
        `INSERT INTO sal.receipt_reversals
           (tenant_id, company_id, branch_id, original_receipt_id, currency_code, amount, reason, created_by)
         VALUES ($1,$2,$3,$4,'USD',10,'raw',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, D4.APPROVE_ONLY]
      );
    });
  });

  it('allows one LIVE reversal per receipt, and a new request after a withdrawal', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const first = await request(c, receipt);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_exists',
        `SELECT sal.request_receipt_reversal($1, 'twice')`,
        [receipt]
      );
      await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [first]);
      const second = await request(c, receipt, 'Raised again with the right reason');
      expect(second).not.toBe(first);
      expect(await stateOf(c, second)).toBe('pending');
    });
  });

  it('refuses a request for a receipt that is already reversed', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const reversal = await request(c, receipt);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      await setUser(c, USER_A);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_receipt_reversed',
        `SELECT sal.request_receipt_reversal($1, 'again')`,
        [receipt]
      );
    });
  });
});

describe('D4 — a raw INSERT on the runtime login cannot create a decided reversal (#489 residual)', () => {
  it('births every reversal pending with no decider, decision date, reason or reversal date', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      for (const [state, decider, reason] of [
        ['rejected', P11.APPROVER_USER, 'forged'],
        ['withdrawn', USER_A, null],
        ['approved', P11.APPROVER_USER, null],
      ] as const) {
        const receipt = await seedReceipt(c, { amount: 30, payer: P9.SR });
        const row = (
          await c.query(
            `INSERT INTO sal.receipt_reversals
               (tenant_id, company_id, branch_id, original_receipt_id, currency_code, amount, reason,
                created_by, approval_state, decided_by, decided_at, decision_reason, reversed_at,
                approved_by, approved_at)
             VALUES ($1,$2,$3,$4,'USD',30,'forged decision',$5,$6,$7,'2020-01-01T00:00:00Z',$8,
                     '2020-01-01T00:00:00Z',$7,'2020-01-01T00:00:00Z')
             RETURNING id, approval_state, decided_by, decided_at, decision_reason, reversed_at,
                       approved_by, approved_at, requested_by`,
            [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, USER_A, state, decider, reason]
          )
        ).rows[0] as Record<string, unknown>;
        const { id, ...stored } = row;
        expect(stored, state).toEqual({
          approval_state: 'pending',
          decided_by: null,
          decided_at: null,
          decision_reason: null,
          reversed_at: null,
          approved_by: null,
          approved_at: null,
          requested_by: USER_A,
        });
        // It is an ordinary pending request: the requester withdraws it, and the
        // receipt is then free for a corrected request — nothing blocks it.
        await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [id]);
        expect(await stateOf(c, String(id))).toBe('withdrawn');
        expect(await request(c, receipt)).toMatch(/^[0-9a-f-]{36}$/);
      }
    });
  });
});

describe('D4 — a pending reversal freezes the receipt for new allocations', () => {
  it('refuses an allocation through the primitive and through a raw INSERT', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fd4_freeze', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 50, payer: P9.SR });
      const reversal = await request(c, receipt);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_pending_blocks_allocation',
        `SELECT sal.allocate_receipt($1, $2, 10)`,
        [receipt, invoice]
      );
      await expectToken(
        c,
        '23514',
        'receipt_reversal_pending_blocks_allocation',
        `INSERT INTO sal.payment_allocations
           (tenant_id, company_id, branch_id, receipt_id, invoice_id, currency_code, amount, allocated_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',10,$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, invoice, USER_A]
      );
      // Withdrawn, the receipt takes money again.
      await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [reversal]);
      await allocateReceipt(c, receipt, invoice, 10);
      expect(await openOf(c, invoice)).toBe('90.0000');
    });
  });
});

describe('D4 — a different authorised person approves, atomically', () => {
  it('reverses the receipt, restores every invoice exactly, keeps the allocations and writes one event', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoices } = await allocatedReceipt(c, 'fd4_approve');
      expect(await openOf(c, invoices[0])).toBe('40.0000');
      expect(await openOf(c, invoices[1])).toBe('10.0000');
      const reversal = await request(c, receipt);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);

      expect(await receiptStatus(c, receipt)).toBe('reversed');
      expect(await openOf(c, invoices[0])).toBe('100.0000');
      expect(await openOf(c, invoices[1])).toBe('50.0000');
      const row = (
        await c.query(
          `SELECT approval_state, approved_by, approved_at IS NOT NULL AS approved,
                  reversed_at IS NOT NULL AS reversed, decided_by
             FROM sal.receipt_reversals WHERE id = $1`,
          [reversal]
        )
      ).rows[0];
      expect(row).toEqual({
        approval_state: 'approved',
        approved_by: P11.APPROVER_USER,
        approved: true,
        reversed: true,
        decided_by: null,
      });
      // History is never deleted: both allocations are still recorded.
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.payment_allocations WHERE receipt_id = $1`,
          [receipt]
        )
      ).toBe('2');
      // The original receipt is retained, its amount unchanged.
      expect(
        await scalar(c, `SELECT amount::text AS v FROM sal.receipts WHERE id = $1`, [receipt])
      ).toBe('100.0000');
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.financial_events
            WHERE source_id = $1 AND event_type = 'receipt_reversed'`,
          [reversal]
        )
      ).toBe('1');
      // Idempotent: a second approval changes nothing and writes no second event.
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.financial_events WHERE source_id = $1`,
          [reversal]
        )
      ).toBe('1');
    });
  });

  it('refuses the requester approving their own request', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const reversal = await request(c, receipt);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_self_approval',
        `SELECT sal.approve_receipt_reversal($1)`,
        [reversal]
      );
      expect(await stateOf(c, reversal)).toBe('pending');
    });
    await asOwnerRolledBack(async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const reversal = await request(c, receipt);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_self_approval',
        `UPDATE sal.receipt_reversals SET approval_state = 'approved' WHERE id = $1`,
        [reversal]
      );
    });
  });

  it('refuses an approver who holds only the credit-note codes', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const reversal = await request(c, receipt);
      await setUser(c, D4.CREDIT_ONLY);
      await expectToken(
        c,
        '42501',
        'receipt_reversal_approve_permission_missing',
        `SELECT sal.approve_receipt_reversal($1)`,
        [reversal]
      );
      await expectToken(
        c,
        '42501',
        'receipt_reversal_reject_permission_missing',
        `SELECT sal.reject_receipt_reversal($1, 'not mine to decide')`,
        [reversal]
      );
      await expectToken(
        c,
        '42501',
        'receipt_reversal_approve_permission_missing',
        `UPDATE sal.receipt_reversals SET approval_state = 'approved' WHERE id = $1`,
        [reversal]
      );
      expect(await stateOf(c, reversal)).toBe('pending');
      expect(await receiptStatus(c, receipt)).toBe('recorded');
    });
  });

  it('refuses an approver who holds sal.reversal.approve in another branch only', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const reversal = await request(c, receipt);
      await asOwnerUser(c, D4.ELSEWHERE, async () => {
        await expectToken(
          c,
          '42501',
          'receipt_reversal_approve_permission_missing',
          `UPDATE sal.receipt_reversals SET approval_state = 'approved' WHERE id = $1`,
          [reversal]
        );
      });
      expect(await stateOf(c, reversal)).toBe('pending');
    });
  });

  it('refuses a raw approval that does not reverse the receipt, at commit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const reversal = await request(c, receipt);
      await setUser(c, P11.APPROVER_USER);
      // Checked now rather than at COMMIT, so the rolled-back test can see it.
      await c.query(`SET CONSTRAINTS sal.tg_receipt_reversals_applied IMMEDIATE`);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_not_applied',
        `UPDATE sal.receipt_reversals SET approval_state = 'approved' WHERE id = $1`,
        [reversal]
      );
    });
  });

  it('refuses another tenant', async () => {
    const reversal = await committed(USER_A, async (c) =>
      request(c, await seedReceipt(c, { amount: 10, payer: P9.SR }), 'cross tenant probe')
    );
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, async (c) => {
      await expectFail(c, 'P0002', `SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      await expectFail(c, 'P0002', `SELECT sal.reject_receipt_reversal($1, 'x')`, [reversal]);
      await expectFail(c, 'P0002', `SELECT sal.withdraw_receipt_reversal($1)`, [reversal]);
    });
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect(await stateOf(c, reversal)).toBe('pending');
    });
  });
});

/** Switches the session user on `c` for the length of `fn`, then back to USER_A. */
async function asOwnerUser(c: Q, userId: string, fn: () => Promise<void>): Promise<void> {
  await setUser(c, userId);
  try {
    await fn();
  } finally {
    await setUser(c, USER_A);
  }
}

describe('D4 — rejection, withdrawal and terminal states', () => {
  it('rejects by a different person with a reason; the receipt keeps counting', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoices } = await allocatedReceipt(c, 'fd4_reject');
      const reversal = await request(c, receipt);
      await setUser(c, P11.APPROVER_USER);
      for (const reason of [null, '', '  ', 'x'.repeat(2001)]) {
        await expectToken(
          c,
          '23514',
          'receipt_reversal_reject_reason_required',
          `SELECT sal.reject_receipt_reversal($1, $2)`,
          [reversal, reason]
        );
      }
      await c.query(`SELECT sal.reject_receipt_reversal($1, $2)`, [
        reversal,
        'The receipt is correct',
      ]);
      const row = (
        await c.query(
          `SELECT approval_state, decided_by, decision_reason, approved_by, reversed_at
             FROM sal.receipt_reversals WHERE id = $1`,
          [reversal]
        )
      ).rows[0];
      expect(row).toEqual({
        approval_state: 'rejected',
        decided_by: P11.APPROVER_USER,
        decision_reason: 'The receipt is correct',
        approved_by: null,
        reversed_at: null,
      });
      expect(await receiptStatus(c, receipt)).toBe('allocated');
      expect(await openOf(c, invoices[0])).toBe('40.0000');
    });
  });

  it('refuses the requester rejecting, and anyone else withdrawing', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 10, payer: P9.SR });
      const reversal = await request(c, receipt);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_self_rejection',
        `SELECT sal.reject_receipt_reversal($1, 'mine')`,
        [reversal]
      );
      await setUser(c, P11.APPROVER_USER);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_withdraw_not_requester',
        `SELECT sal.withdraw_receipt_reversal($1)`,
        [reversal]
      );
      await expectToken(
        c,
        '23514',
        'receipt_reversal_withdraw_not_requester',
        `UPDATE sal.receipt_reversals SET approval_state = 'withdrawn' WHERE id = $1`,
        [reversal]
      );
      expect(await stateOf(c, reversal)).toBe('pending');
      // The requester withdraws, stamped as the decider; idempotent for them.
      await setUser(c, USER_A);
      await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [reversal]);
      await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [reversal]);
      expect(
        await scalar(
          c,
          `SELECT (approval_state = 'withdrawn' AND decided_by = $2 AND decided_at IS NOT NULL)::text AS v
             FROM sal.receipt_reversals WHERE id = $1`,
          [reversal, USER_A]
        )
      ).toBe('true');
    });
  });

  it('holds approved, rejected and withdrawn reversals terminal', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const approved = await request(c, await seedReceipt(c, { amount: 10, payer: P9.SR }));
      const rejected = await request(c, await seedReceipt(c, { amount: 11, payer: P9.SR }));
      const withdrawn = await request(c, await seedReceipt(c, { amount: 12, payer: P9.SR }));
      await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [withdrawn]);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [approved]);
      await c.query(`SELECT sal.reject_receipt_reversal($1, 'not due')`, [rejected]);
      for (const [id, sql] of [
        [approved, `SELECT sal.reject_receipt_reversal($1, 'late')`],
        [rejected, `SELECT sal.approve_receipt_reversal($1)`],
        [withdrawn, `SELECT sal.approve_receipt_reversal($1)`],
        [withdrawn, `SELECT sal.reject_receipt_reversal($1, 'late')`],
      ] as const) {
        await expectToken(c, '23514', 'receipt_reversal_decision_frozen', sql, [id]);
      }
      await setUser(c, USER_A);
      await expectToken(
        c,
        '23514',
        'receipt_reversal_decision_frozen',
        `SELECT sal.withdraw_receipt_reversal($1)`,
        [approved]
      );
    });
    await asOwnerRolledBack(async (c) => {
      const approved = await request(c, await seedReceipt(c, { amount: 13, payer: P9.SR }));
      const withdrawn = await request(c, await seedReceipt(c, { amount: 14, payer: P9.SR }));
      await c.query(`SELECT sal.withdraw_receipt_reversal($1)`, [withdrawn]);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [approved]);
      for (const [id, sql] of [
        [approved, `UPDATE sal.receipt_reversals SET approval_state = 'pending' WHERE id = $1`],
        [approved, `UPDATE sal.receipt_reversals SET reversed_at = '2020-01-01' WHERE id = $1`],
        [withdrawn, `UPDATE sal.receipt_reversals SET approval_state = 'pending' WHERE id = $1`],
        [withdrawn, `UPDATE sal.receipt_reversals SET decided_at = '2020-01-01' WHERE id = $1`],
      ] as const) {
        await expectToken(c, '23514', 'receipt_reversal_decision_frozen', sql, [id]);
      }
    });
  });

  it('gives the runtime login UPDATE on the state and the decision reason only', async () => {
    const privilege = async (column: string): Promise<boolean> =>
      (
        await admin.query<{ p: boolean }>(
          `SELECT has_column_privilege('app_runtime', 'sal.receipt_reversals', $1, 'UPDATE') AS p`,
          [column]
        )
      ).rows[0]!.p;
    for (const column of ['approval_state', 'decision_reason']) {
      expect(await privilege(column), column).toBe(true);
    }
    for (const column of ['decided_by', 'decided_at', 'reversed_at', 'approved_by', 'amount']) {
      expect(await privilege(column), column).toBe(false);
    }
  });
});

describe('D4 — concurrent decisions and allocations have exactly one outcome', () => {
  it('an allocation racing a request waits for it and is then refused', async () => {
    const { receipt, invoice } = await committed(USER_A, async (c) => {
      const seeded = await seedInvoiceWithLine(c, 'fd4_race_alloc', { net: 100, tax: 0 });
      await issueInvoice(c, seeded.invoice);
      return {
        receipt: await seedReceipt(c, { amount: 50, payer: P9.SR }),
        invoice: seeded.invoice,
      };
    });
    const requester = await session(USER_A);
    const allocator = await session(P11.APPROVER_USER);
    let allocation: Promise<Outcome> | null = null;
    try {
      await request(requester.c, receipt, 'race');
      allocation = settle(
        allocator.c.query(`SELECT sal.allocate_receipt($1, $2, 10)`, [receipt, invoice])
      );
      await untilBlocked(allocator.pid);
      await requester.c.query('COMMIT');
      const outcome = await allocation;
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? '' : outcome.message).toMatch(
        /^receipt_reversal_pending_blocks_allocation:/
      );
    } finally {
      await endRace(requester.c, allocator.c, allocation);
    }
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.payment_allocations WHERE receipt_id = $1`,
          [receipt]
        )
      ).toBe('0');
    });
  });

  it('an allocation racing an approval waits for it and finds the receipt reversed', async () => {
    const { receipt, invoice, reversal } = await committed(USER_A, async (c) => {
      const seeded = await seedInvoiceWithLine(c, 'fd4_race_approve', { net: 100, tax: 0 });
      await issueInvoice(c, seeded.invoice);
      const r = await seedReceipt(c, { amount: 50, payer: P9.SR });
      return { receipt: r, invoice: seeded.invoice, reversal: await request(c, r, 'race') };
    });
    const approver = await session(P11.APPROVER_USER);
    const allocator = await session(USER_A);
    let allocation: Promise<Outcome> | null = null;
    try {
      await approver.c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      allocation = settle(
        allocator.c.query(`SELECT sal.allocate_receipt($1, $2, 10)`, [receipt, invoice])
      );
      await untilBlocked(allocator.pid);
      await approver.c.query('COMMIT');
      const outcome = await allocation;
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.code).toBe('23514');
    } finally {
      await endRace(approver.c, allocator.c, allocation);
    }
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect(await receiptStatus(c, receipt)).toBe('reversed');
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.payment_allocations WHERE receipt_id = $1`,
          [receipt]
        )
      ).toBe('0');
    });
  });

  for (const [loser, sql, actor] of [
    ['rejection', `SELECT sal.reject_receipt_reversal($1, 'too late')`, 'other'],
    ['withdrawal', `SELECT sal.withdraw_receipt_reversal($1)`, 'requester'],
  ] as const) {
    it(`an approval and a ${loser} of one request: the first wins, the second is refused`, async () => {
      const reversal = await committed(USER_A, async (c) =>
        request(c, await seedReceipt(c, { amount: 25, payer: P9.SR }), `race ${loser}`)
      );
      const approver = await session(P11.APPROVER_USER);
      const second = await session(actor === 'requester' ? USER_A : D4.APPROVE_ONLY);
      let decision: Promise<Outcome> | null = null;
      try {
        await approver.c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
        decision = settle(second.c.query(sql, [reversal]));
        await untilBlocked(second.pid);
        await approver.c.query('COMMIT');
        const outcome = await decision;
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? '' : outcome.message).toMatch(/^receipt_reversal_decision_frozen:/);
      } finally {
        await endRace(approver.c, second.c, decision);
      }
      await withRolledBackTx(runtime, ctxA, async (c) => {
        expect(await stateOf(c, reversal)).toBe('approved');
        expect(
          await scalar(
            c,
            `SELECT count(*)::text AS v FROM sal.financial_events WHERE source_id = $1`,
            [reversal]
          )
        ).toBe('1');
      });
    });
  }
});

describe('D4 — the replacement receipt is linked once, to an approved-reversed receipt', () => {
  const replace = (c: Q, replaced: string, amount = 90) =>
    c.query<{ id: string }>(
      `SELECT sal.record_receipt($1,$2,$3,$4,'USD',$5,NULL,NULL,NULL,$6) AS id`,
      [COMPANY_A1, BRANCH_A1, P11.PM_CASH, P9.SR, amount, replaced]
    );

  it('links one replacement, refuses a second, and freezes the link', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      const reversal = await request(c, receipt);
      // Pending: nothing replaces it yet.
      await expectToken(
        c,
        '23514',
        'receipt_replacement_not_reversed',
        `SELECT sal.record_receipt($1,$2,$3,$4,'USD',90,NULL,NULL,NULL,$5)`,
        [COMPANY_A1, BRANCH_A1, P11.PM_CASH, P9.SR, receipt]
      );
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      await setUser(c, USER_A);
      const replacement = (await replace(c, receipt)).rows[0]!.id;
      expect(
        await scalar(c, `SELECT replaces_receipt_id::text AS v FROM sal.receipts WHERE id = $1`, [
          replacement,
        ])
      ).toBe(receipt);
      await expectToken(
        c,
        '23514',
        'receipt_replacement_exists',
        `SELECT sal.record_receipt($1,$2,$3,$4,'USD',90,NULL,NULL,NULL,$5)`,
        [COMPANY_A1, BRANCH_A1, P11.PM_CASH, P9.SR, receipt]
      );
      // Frozen: neither the replacement's link nor another receipt's can be rewritten.
      const other = await seedReceipt(c, { amount: 5, payer: P9.SR });
      await expectFail(
        c,
        '23514',
        `UPDATE sal.receipts SET replaces_receipt_id = NULL WHERE id = $1`,
        [replacement]
      );
      await expectFail(
        c,
        '23514',
        `UPDATE sal.receipts SET replaces_receipt_id = $2 WHERE id = $1`,
        [other, receipt]
      );
    });
  });

  it('refuses a replacement of a receipt nobody reversed, and of one in another branch', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const plain = await seedReceipt(c, { amount: 100, payer: P9.SR });
      await expectToken(
        c,
        '23514',
        'receipt_replacement_not_reversed',
        `SELECT sal.record_receipt($1,$2,$3,$4,'USD',90,NULL,NULL,NULL,$5)`,
        [COMPANY_A1, BRANCH_A1, P11.PM_CASH, P9.SR, plain]
      );
    });
    await asOwnerRolledBack(async (c) => {
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      const reversal = await request(c, receipt);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1)`, [reversal]);
      await setUser(c, USER_A);
      const error = await refusal(
        c,
        `INSERT INTO sal.receipts (tenant_id, company_id, branch_id, receipt_number, payment_method_id,
                                   payer_partner_id, currency_code, amount, received_by, replaces_receipt_id, created_by)
         VALUES ($1,$2,$3,'D4-ELSEWHERE-1',$4,$5,'USD',90,$6,$7,$6)`,
        [TENANT_A, COMPANY_A1, D4.BRANCH_ELSEWHERE, P11.PM_CASH, P9.SR, USER_A, receipt]
      );
      expect(error.code).toBe('23503');
      expect(error.message).toContain('receipt_replacement_not_reversed');
    });
  });
});

describe('D4 — the approving code is held in the receipt’s scope (fixture sanity)', () => {
  it('CREDIT_ONLY holds the credit-note codes and APPROVE_ONLY the reversal code', async () => {
    await withRolledBackTx(runtime, ctx(D4.CREDIT_ONLY), async (c) => {
      expect(
        await scalar(
          c,
          `SELECT iam.has_permission_in_scope('sal.credit.approve', $1, $2, NULL)::text AS v`,
          [COMPANY_A1, BRANCH_A1]
        )
      ).toBe('true');
    });
    await withRolledBackTx(runtime, ctxApprover, async (c) => {
      expect(
        await scalar(
          c,
          `SELECT iam.has_permission_in_scope('sal.reversal.approve', $1, $2, NULL)::text AS v`,
          [COMPANY_A1, BRANCH_A1]
        )
      ).toBe('true');
    });
  });
});
