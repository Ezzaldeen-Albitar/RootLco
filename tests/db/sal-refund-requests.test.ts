/**
 * P1-32-PRE-OD-FD2B — refund requests, their second-person decision and the
 * one-time payout record (ADR-023 D2, part 2), the database half of migration
 * `20261008140000_sal_refund_requests.sql`.
 *
 * Every case is written so it FAILS when the control it names is removed. The rules
 * live in `sal.guard_refund_request_insert` and `sal.guard_refund_request_update`,
 * so each is proved through the primitives AND through a raw statement the
 * primitives do not make:
 *
 *  - a request is born pending with every person and date stamped by the database;
 *    it names the obligation's invoice, customer and currency, an active method of
 *    the tenant, a reason, an amount above zero to the minor unit and at most what
 *    is still owed (`refund_exceeds_obligation`), and its requester holds
 *    `sal.payment.record` in scope;
 *  - one live request per obligation, under the obligation row lock and the partial
 *    unique index — two requests racing on committed rows have one winner;
 *  - the approver holds `sal.refund.approve` and is never the requester; a rejection
 *    states why; only the requester withdraws; a decision is frozen;
 *  - the payout is recorded once, on an approved request only, with the approved
 *    method, a reference and a date not in the future, writes one `refund_executed`
 *    financial event, and settles the obligation exactly when what has been paid
 *    out reaches its amount — two payouts racing have one winner;
 *  - forced row-level security by tenant and `sal.finance.view`; no DELETE; the
 *    facts of a request are frozen for every role.
 *
 * Runtime cases run on the `app_runtime` login inside rolled-back transactions;
 * owner cases on the admin connection inside rolled-back transactions; the two
 * race cases commit their fixture and clean it up.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
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
  ctxNoPerm,
  expectFail,
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  seedCreditNote,
  allocateReceipt,
  cleanP111Committed,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

const setUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string | null> => {
  const value = ((await c.query(sql, params)).rows[0] as Record<string, unknown> | undefined)?.v;
  return value === null || value === undefined ? null : String(value);
};

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

const tokenOf = (error: { message?: string }) => /^([a-z_]+):/.exec(error.message ?? '')?.[1];

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

/**
 * An issued USD invoice of 100 paid in full, credited `credit` by an approved note:
 * the customer is owed `credit` back as one open obligation. Returns its id.
 */
async function owedBack(
  c: Q,
  tag: string,
  credit: number
): Promise<{ obligation: string; invoice: string; payer: string }> {
  const { invoice, payer } = await seedInvoiceWithLine(c, tag, { net: 100, tax: 0 });
  await issueInvoice(c, invoice);
  const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
  await allocateReceipt(c, receipt, invoice, 100);
  const note = await seedCreditNote(c, invoice, credit);
  await setUser(c, P11.APPROVER_USER);
  await c.query(`SELECT sal.approve_credit_note($1)`, [note]);
  await setUser(c, USER_A);
  const obligation = await scalar(
    c,
    `SELECT id::text AS v FROM sal.refund_obligations WHERE credit_note_id = $1`,
    [note]
  );
  if (obligation === null) throw new Error('fixture obligation missing');
  return { obligation, invoice, payer };
}

/** `sal.request_refund` as the current session user. */
const request = (
  c: Q,
  obligation: string,
  amount: number | string,
  opts: { method?: string; reason?: string; key?: string | null } = {}
) =>
  c
    .query(`SELECT sal.request_refund($1, $2, $3, $4, $5)::text AS v`, [
      obligation,
      amount,
      opts.method ?? P11.PM_CASH,
      opts.reason ?? 'Paid twice',
      opts.key ?? null,
    ])
    .then((r) => (r.rows[0] as { v: string }).v);

const approveAs = async (c: Q, requestId: string, userId = P11.APPROVER_USER) => {
  await setUser(c, userId);
  await c.query(`SELECT sal.approve_refund_request($1)`, [requestId]);
  await setUser(c, USER_A);
};

const execute = (
  c: Q,
  requestId: string,
  opts: { method?: string; reference?: string; date?: string; key?: string | null } = {}
) =>
  c.query(`SELECT sal.execute_refund_request($1, $2, $3, $4::date, $5, NULL)`, [
    requestId,
    opts.method ?? P11.PM_CASH,
    opts.reference ?? 'TRF-0001',
    opts.date ?? new Date().toISOString().slice(0, 10),
    opts.key ?? null,
  ]);

const stateOf = (c: Q, requestId: string) =>
  scalar(c, `SELECT approval_state AS v FROM sal.refund_requests WHERE id = $1`, [requestId]);
const obligationState = (c: Q, obligation: string) =>
  scalar(c, `SELECT state AS v FROM sal.refund_obligations WHERE id = $1`, [obligation]);

/**
 * A user of tenant A holding exactly `codes`, created on the OWNER connection inside
 * the caller's rolled-back transaction, granted by USER_A.
 */
async function userWith(c: Q, tag: string, codes: readonly string[]): Promise<string> {
  const user = randomUUID();
  const role = randomUUID();
  await c.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'fixture',$3,$4,'FD2B fixture','active',$5)`,
    [user, TENANT_A, `fd2b-${tag}-${user}`, `fd2b-${tag}-${user.slice(0, 8)}@fixture.test`, USER_A]
  );
  await c.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by) VALUES ($1,$2,$3,'FD2B fixture',$4)`,
    [role, TENANT_A, `fd2b_${tag}_${role.slice(0, 8)}`, USER_A]
  );
  await c.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p WHERE p.permission_code = ANY($4)`,
    [TENANT_A, role, USER_A, [...codes]]
  );
  await c.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1,$2,$3,$4,$4)`,
    [TENANT_A, user, role, USER_A]
  );
  return user;
}

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});

afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('a request is born pending, bound to its obligation', () => {
  it('stamps the requester and time, and names the obligation invoice, payee and currency', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation, invoice, payer } = await owedBack(c, 'fd2b_born', 40);
      const id = await request(c, obligation, '15.50');
      const row = (
        await c.query(
          `SELECT approval_state, requested_by, invoice_id, payee_partner_id, currency_code,
                  amount::text AS amount, approved_by, decided_by, executed_at, record_version,
                  requested_at = now() AS stamped
             FROM sal.refund_requests WHERE id = $1`,
          [id]
        )
      ).rows[0];
      expect(row).toEqual({
        approval_state: 'pending',
        requested_by: USER_A,
        invoice_id: invoice,
        payee_partner_id: payer,
        currency_code: 'USD',
        amount: '15.5000',
        approved_by: null,
        decided_by: null,
        executed_at: null,
        record_version: 1,
        stamped: true,
      });
      // A request pays nothing: no financial event, the obligation stays open.
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.financial_events WHERE source_id = $1`,
          [id]
        )
      ).toBe('0');
      expect(await obligationState(c, obligation)).toBe('open');
    });
  });

  it('births a raw INSERT pending whatever it names, and holds it to every rule', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation, invoice, payer } = await owedBack(c, 'fd2b_raw', 40);
      const raw = (over: Record<string, unknown>) => {
        const row = {
          invoice,
          payee: payer,
          currency: 'USD',
          amount: '10.0000',
          method: P11.PM_CASH,
          reason: 'raw',
          ...over,
        };
        return c.query(
          `INSERT INTO sal.refund_requests
             (tenant_id, company_id, branch_id, obligation_id, invoice_id, payee_partner_id, currency_code,
              amount, payment_method_id, reason, approval_state, requested_by, approved_by, approved_at,
              executed_by, executed_at, payout_reference, payout_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11,$11,now(),$11,now(),'x',current_date,$11)
           RETURNING id::text AS id, approval_state, requested_by, approved_by, executed_at`,
          [
            TENANT_A,
            COMPANY_A1,
            BRANCH_A1,
            obligation,
            row.invoice,
            row.payee,
            row.currency,
            row.amount,
            row.method,
            row.reason,
            P11.APPROVER_USER,
          ]
        );
      };
      const born = (await raw({})).rows[0];
      expect(born).toMatchObject({
        approval_state: 'pending',
        requested_by: USER_A,
        approved_by: null,
        executed_at: null,
      });
      // One live request now exists, so every rule below is proved on a withdrawn one.
      await c.query(`SELECT sal.withdraw_refund_request($1)`, [born.id]);

      const cases: Array<[Record<string, unknown>, string]> = [
        [{ currency: 'JOD' }, 'refund_request_currency_mismatch'],
        [{ payee: P9.AP }, 'refund_request_payee_mismatch'],
        [{ amount: '40.0001' }, 'refund_request_minor_unit'],
        [{ amount: '40.01' }, 'refund_exceeds_obligation'],
        [{ reason: '   ' }, 'refund_request_reason_required'],
      ];
      for (const [over, token] of cases) {
        await c.query('SAVEPOINT sp_raw');
        const error = await raw(over).then(
          () => null,
          (e: { code?: string; message?: string }) => e
        );
        await c.query('ROLLBACK TO SAVEPOINT sp_raw');
        expect(error, token).not.toBeNull();
        expect(tokenOf(error ?? {}), JSON.stringify(over)).toBe(token);
      }
    });
  });

  it('refuses more than is still owed, an inactive method and a method of another kind of row', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_limits', 40);
      const over = await refusal(c, `SELECT sal.request_refund($1, 40.01, $2, 'x')`, [
        obligation,
        P11.PM_CASH,
      ]);
      expect(over.code).toBe('23514');
      expect(tokenOf(over)).toBe('refund_exceeds_obligation');
      const inactive = (
        await c.query(
          `INSERT INTO sal.payment_methods (scope, tenant_id, method_code, kind, display_name, status, created_by)
           VALUES ('tenant',$1,'fd2b_off','bank_transfer','Retired bank','inactive',$2) RETURNING id::text AS id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id as string;
      const off = await refusal(c, `SELECT sal.request_refund($1, 10, $2, 'x')`, [
        obligation,
        inactive,
      ]);
      expect(tokenOf(off)).toBe('refund_request_method_unavailable');
      // Exactly what is owed is accepted.
      expect(await request(c, obligation, 40)).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('refuses a requester without sal.payment.record in the obligation scope', async () => {
    await asOwnerRolledBack(async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_noperm', 40);
      const viewer = await userWith(c, 'viewer', ['sal.finance.view']);
      await setUser(c, viewer);
      const refused = await refusal(c, `SELECT sal.request_refund($1, 10, $2, 'x')`, [
        obligation,
        P11.PM_CASH,
      ]);
      expect(refused.code).toBe('42501');
      expect(tokenOf(refused)).toBe('refund_request_permission_missing');
    });
  });

  it('answers a repeated key with the request it raised, and refuses it for another obligation', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const one = await owedBack(c, 'fd2b_key_one', 40);
      const two = await owedBack(c, 'fd2b_key_two', 30);
      const key = randomUUID();
      const first = await request(c, one.obligation, 10, { key });
      expect(await request(c, one.obligation, 10, { key })).toBe(first);
      const reused = await refusal(c, `SELECT sal.request_refund($1, 10, $2, 'x', $3)`, [
        two.obligation,
        P11.PM_CASH,
        key,
      ]);
      expect(tokenOf(reused)).toBe('refund_request_idempotency_reused');
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.refund_requests WHERE idempotency_key = $1`,
          [key]
        )
      ).toBe('1');
    });
  });
});

describe('one live request per obligation', () => {
  it('refuses a second while one waits or is approved and unpaid, and admits one after a decline or a payout', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_live', 40);
      const first = await request(c, obligation, 10);
      const second = await refusal(c, `SELECT sal.request_refund($1, 10, $2, 'again')`, [
        obligation,
        P11.PM_CASH,
      ]);
      expect(tokenOf(second)).toBe('refund_request_live_exists');
      await c.query(`SELECT sal.withdraw_refund_request($1)`, [first]);
      const after = await request(c, obligation, 10);
      await approveAs(c, after);
      expect(
        tokenOf(
          await refusal(c, `SELECT sal.request_refund($1, 5, $2, 'x')`, [obligation, P11.PM_CASH])
        )
      ).toBe('refund_request_live_exists');
      await execute(c, after);
      // Paid out: no longer live, and what is still owed is 30.
      expect(
        tokenOf(
          await refusal(c, `SELECT sal.request_refund($1, 30.01, $2, 'x')`, [
            obligation,
            P11.PM_CASH,
          ])
        )
      ).toBe('refund_exceeds_obligation');
      expect(await request(c, obligation, 30)).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('serialises two requests racing on one obligation: one is raised, the other is refused', async () => {
    const setup = await runtime.connect();
    let obligation = '';
    try {
      await setup.query('BEGIN');
      await setContext(setup, ctxA);
      obligation = (await owedBack(setup, 'fd2b_race_request', 40)).obligation;
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
        await setContext(client, ctxA);
      }
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      await request(first, obligation, 30);
      const racing = request(second, obligation, 30)
        .then(() => null)
        .catch((error: { code?: string; message?: string }) => error);
      expect(await waitsOnLock(secondPid)).toBe(true);
      await first.query('COMMIT');
      const outcome = await racing;
      expect(outcome?.code).toBe('23514');
      expect(tokenOf(outcome ?? {})).toBe('refund_request_live_exists');
      await second.query('ROLLBACK');
      const rows = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM sal.refund_requests WHERE obligation_id = $1`,
        [obligation]
      );
      expect(rows.rows[0]?.n).toBe('1');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });
});

/** Whether `pid` is waiting on a lock, polled for up to five seconds. */
async function waitsOnLock(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const lock = await admin.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid]
    );
    if (lock.rows[0]?.waiting === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe('a second person decides', () => {
  it('refuses the requester approving their own request, through the primitive and a raw UPDATE', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_self', 40);
      const id = await request(c, obligation, 10);
      const own = await refusal(c, `SELECT sal.approve_refund_request($1)`, [id]);
      expect(tokenOf(own)).toBe('refund_self_approval');
      const raw = await refusal(
        c,
        `UPDATE sal.refund_requests SET approval_state = 'approved' WHERE id = $1`,
        [id]
      );
      expect(tokenOf(raw)).toBe('refund_self_approval');
      expect(await stateOf(c, id)).toBe('pending');
      // A different holder of the code approves; the approver and time are stamped.
      await approveAs(c, id);
      const row = (
        await c.query(
          `SELECT approval_state, approved_by, approved_at = now() AS stamped FROM sal.refund_requests WHERE id = $1`,
          [id]
        )
      ).rows[0];
      expect(row).toEqual({
        approval_state: 'approved',
        approved_by: P11.APPROVER_USER,
        stamped: true,
      });
      // An approval pays nothing.
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.financial_events WHERE source_id = $1`,
          [id]
        )
      ).toBe('0');
    });
  });

  it('refuses an approver or a rejecter without sal.refund.approve in scope', async () => {
    await asOwnerRolledBack(async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_nocode', 40);
      const id = await request(c, obligation, 10);
      const cashier = await userWith(c, 'cashier', [
        'sal.finance.view',
        'sal.payment.record',
        'sal.reversal.approve',
        'sal.credit.approve',
      ]);
      await setUser(c, cashier);
      const approve = await refusal(c, `SELECT sal.approve_refund_request($1)`, [id]);
      expect(approve.code).toBe('42501');
      expect(tokenOf(approve)).toBe('refund_approve_permission_missing');
      const reject = await refusal(c, `SELECT sal.reject_refund_request($1, 'no')`, [id]);
      expect(tokenOf(reject)).toBe('refund_reject_permission_missing');
    });
  });

  it('rejects with a reason by another person, withdraws by the requester only, and freezes every decision', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_decide', 40);
      const id = await request(c, obligation, 10);
      expect(tokenOf(await refusal(c, `SELECT sal.reject_refund_request($1, 'mine')`, [id]))).toBe(
        'refund_self_rejection'
      );
      await setUser(c, P11.APPROVER_USER);
      expect(tokenOf(await refusal(c, `SELECT sal.reject_refund_request($1, '  ')`, [id]))).toBe(
        'refund_reject_reason_required'
      );
      expect(tokenOf(await refusal(c, `SELECT sal.withdraw_refund_request($1)`, [id]))).toBe(
        'refund_withdraw_not_requester'
      );
      await c.query(`SELECT sal.reject_refund_request($1, 'Not owed after all')`, [id]);
      expect(await stateOf(c, id)).toBe('rejected');
      expect(tokenOf(await refusal(c, `SELECT sal.approve_refund_request($1)`, [id]))).toBe(
        'refund_decision_frozen'
      );
      expect(
        tokenOf(
          await refusal(
            c,
            `UPDATE sal.refund_requests SET approval_state = 'approved' WHERE id = $1`,
            [id]
          )
        )
      ).toBe('refund_decision_frozen');
      await setUser(c, USER_A);
      expect(tokenOf(await refusal(c, `SELECT sal.withdraw_refund_request($1)`, [id]))).toBe(
        'refund_decision_frozen'
      );
    });
  });
});

describe('the payout is recorded once, after the approval', () => {
  it('refuses a payout before approval, records it once, and writes one refund_executed event', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_execute', 40);
      const id = await request(c, obligation, 15);
      expect(
        tokenOf(
          await refusal(c, `SELECT sal.execute_refund_request($1, $2, 'R1', current_date)`, [
            id,
            P11.PM_CASH,
          ])
        )
      ).toBe('refund_not_approved');
      // A raw payout on a pending request is refused by the guard too.
      expect(
        tokenOf(
          await refusal(
            c,
            `UPDATE sal.refund_requests SET payout_reference = 'R1', payout_date = current_date WHERE id = $1`,
            [id]
          )
        )
      ).toBe('refund_not_approved');
      await approveAs(c, id);
      const bank = (
        await c.query(
          `INSERT INTO sal.payment_methods (scope, tenant_id, method_code, kind, display_name, created_by)
           VALUES ('tenant',$1,'fd2b_bank','bank_transfer','FD2B bank',$2) RETURNING id::text AS id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id as string;
      expect(
        tokenOf(
          await refusal(c, `SELECT sal.execute_refund_request($1, $2, 'R1', current_date)`, [
            id,
            bank,
          ])
        )
      ).toBe('refund_payout_method_mismatch');
      expect(
        tokenOf(
          await refusal(c, `SELECT sal.execute_refund_request($1, $2, 'R1', current_date + 1)`, [
            id,
            P11.PM_CASH,
          ])
        )
      ).toBe('refund_payout_date_invalid');
      const key = randomUUID();
      await execute(c, id, { reference: 'TRF-77', key });
      const row = (
        await c.query(
          `SELECT executed_by, executed_at = now() AS stamped, payout_reference FROM sal.refund_requests WHERE id = $1`,
          [id]
        )
      ).rows[0];
      expect(row).toEqual({ executed_by: USER_A, stamped: true, payout_reference: 'TRF-77' });
      const events = (
        await c.query(
          `SELECT event_type, source_type, amount::text AS amount, currency_code FROM sal.financial_events WHERE source_id = $1`,
          [id]
        )
      ).rows;
      expect(events).toEqual([
        {
          event_type: 'refund_executed',
          source_type: 'refund_request',
          amount: '15.0000',
          currency_code: 'USD',
        },
      ]);
      // The same payout asked again under its key: nothing new.
      await execute(c, id, { reference: 'TRF-77', key });
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.financial_events WHERE source_id = $1`,
          [id]
        )
      ).toBe('1');
      // Any other second payout is refused, through the primitive and a raw UPDATE.
      expect(
        tokenOf(
          await refusal(c, `SELECT sal.execute_refund_request($1, $2, 'R2', current_date)`, [
            id,
            P11.PM_CASH,
          ])
        )
      ).toBe('refund_already_executed');
      expect(
        tokenOf(
          await refusal(c, `UPDATE sal.refund_requests SET payout_reference = 'R2' WHERE id = $1`, [
            id,
          ])
        )
      ).toBe('refund_already_executed');
      // 15 of 40 paid out: the obligation stays open.
      expect(await obligationState(c, obligation)).toBe('open');
    });
  });

  it('settles the obligation exactly when what has been paid out reaches its amount', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_settle', 40);
      const part = await request(c, obligation, 25);
      await approveAs(c, part);
      await execute(c, part);
      expect(await obligationState(c, obligation)).toBe('open');
      const rest = await request(c, obligation, 15);
      await approveAs(c, rest);
      await execute(c, rest, { reference: 'TRF-2' });
      expect(await obligationState(c, obligation)).toBe('settled');
      // Settled takes no further request, and the deferred checks hold at commit.
      expect(
        tokenOf(
          await refusal(c, `SELECT sal.request_refund($1, 1, $2, 'x')`, [obligation, P11.PM_CASH])
        )
      ).toBe('refund_obligation_not_open');
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
  });

  it('refuses settling an obligation by hand, cancelling one, and a payout left unsettled at commit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_settle_raw', 40);
      expect(
        tokenOf(
          await refusal(c, `UPDATE sal.refund_obligations SET state = 'settled' WHERE id = $1`, [
            obligation,
          ])
        )
      ).toBe('refund_obligation_not_paid_out');
      expect(
        tokenOf(
          await refusal(c, `UPDATE sal.refund_obligations SET state = 'cancelled' WHERE id = $1`, [
            obligation,
          ])
        )
      ).toBe('refund_obligation_transition_unavailable');
      // A raw payout of the whole amount, with its event but without settling: the
      // deferred check refuses it at commit.
      const id = await request(c, obligation, 40);
      await approveAs(c, id);
      await c.query(
        `UPDATE sal.refund_requests SET payout_reference = 'RAW', payout_date = current_date WHERE id = $1`,
        [id]
      );
      await c.query(
        `INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, created_by)
         VALUES ($1,$2,$3,'refund_executed','refund_request',$4,'USD',40,$5,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, id, USER_A]
      );
      const atCommit = await refusal(c, 'SET CONSTRAINTS ALL IMMEDIATE');
      expect(tokenOf(atCommit)).toBe('refund_obligation_not_settled');
    });
  });

  it('refuses a raw payout with no refund_executed event at commit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_no_event', 40);
      const id = await request(c, obligation, 10);
      await approveAs(c, id);
      await c.query(
        `UPDATE sal.refund_requests SET payout_reference = 'RAW', payout_date = current_date WHERE id = $1`,
        [id]
      );
      const atCommit = await refusal(c, 'SET CONSTRAINTS ALL IMMEDIATE');
      expect(atCommit.message).toContain('refund_executed');
    });
  });

  it('serialises two payouts of one approved request: one is recorded, the other refused', async () => {
    const setup = await runtime.connect();
    let requestId = '';
    try {
      await setup.query('BEGIN');
      await setContext(setup, ctxA);
      const { obligation } = await owedBack(setup, 'fd2b_race_pay', 40);
      requestId = await request(setup, obligation, 40);
      await approveAs(setup, requestId);
      await setup.query('COMMIT');
    } catch (error) {
      await setup.query('ROLLBACK');
      throw error;
    } finally {
      setup.release();
    }
    const first: PoolClient = await runtime.connect();
    const second: PoolClient = await runtime.connect();
    try {
      for (const client of [first, second]) {
        await client.query('BEGIN');
        await setContext(client, ctxA);
      }
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      await execute(first, requestId, { reference: 'ONE' });
      const racing = execute(second, requestId, { reference: 'TWO' })
        .then(() => null)
        .catch((error: { code?: string; message?: string }) => error);
      expect(await waitsOnLock(secondPid)).toBe(true);
      await first.query('COMMIT');
      const outcome = await racing;
      expect(tokenOf(outcome ?? {})).toBe('refund_already_executed');
      await second.query('ROLLBACK');
      const events = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM sal.financial_events WHERE source_id = $1 AND event_type = 'refund_executed'`,
        [requestId]
      );
      expect(events.rows[0]?.n).toBe('1');
      const ref = await admin.query<{ r: string }>(
        `SELECT payout_reference AS r FROM sal.refund_requests WHERE id = $1`,
        [requestId]
      );
      expect(ref.rows[0]?.r).toBe('ONE');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });
});

describe('isolation, grants and frozen facts', () => {
  it('is visible only with sal.finance.view, in its own tenant (forced RLS)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_rls', 40);
      const id = await request(c, obligation, 10);
      const count = () =>
        scalar(c, `SELECT count(*)::text AS v FROM sal.refund_requests WHERE id = $1`, [id]);
      expect(await count()).toBe('1');
      await setContext(c, ctxNoPerm);
      expect(await count()).toBe('0');
      await setContext(c, { tenantId: TENANT_B, userId: USER_B });
      expect(await count()).toBe('0');
    });
    const flags = (
      await admin.query<{ rls: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS forced
           FROM pg_class WHERE oid = 'sal.refund_requests'::regclass`
      )
    ).rows[0]!;
    expect(flags).toEqual({ rls: true, forced: true });
  });

  it('grants no DELETE, writes only the decision and payout columns, and freezes the facts for every role', async () => {
    const privileges = (
      await admin.query<{ p: string }>(
        `SELECT privilege_type AS p FROM information_schema.role_table_grants
          WHERE grantee = 'app_runtime' AND table_schema = 'sal' AND table_name = 'refund_requests'
          ORDER BY 1`
      )
    ).rows.map((row) => row.p);
    expect(privileges).toEqual(['INSERT', 'SELECT']);
    const columns = (
      await admin.query<{ c: string }>(
        `SELECT column_name AS c FROM information_schema.column_privileges
          WHERE grantee = 'app_runtime' AND table_schema = 'sal' AND table_name = 'refund_requests'
            AND privilege_type = 'UPDATE' ORDER BY 1`
      )
    ).rows.map((row) => row.c);
    expect(columns).toEqual([
      'approval_state',
      'decision_reason',
      'execution_idempotency_key',
      'payout_date',
      'payout_reference',
    ]);
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_frozen', 40);
      const id = await request(c, obligation, 10);
      await expectFail(c, '42501', `UPDATE sal.refund_requests SET amount = 1 WHERE id = $1`, [id]);
      await expectFail(c, '42501', `DELETE FROM sal.refund_requests WHERE id = $1`, [id]);
    });
    await asOwnerRolledBack(async (c) => {
      const { obligation } = await owedBack(c, 'fd2b_frozen_owner', 40);
      const id = await request(c, obligation, 10);
      expect(
        tokenOf(await refusal(c, `UPDATE sal.refund_requests SET amount = 1 WHERE id = $1`, [id]))
      ).toBe('refund_request_frozen');
      expect(
        tokenOf(
          await refusal(c, `UPDATE sal.refund_requests SET requested_by = $2 WHERE id = $1`, [
            id,
            P11.APPROVER_USER,
          ])
        )
      ).toBe('refund_request_frozen');
    });
  });
});
