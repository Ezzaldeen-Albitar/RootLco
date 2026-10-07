/**
 * P1-32-PRE-OD-FD16A — what an invoice owed and what a receipt had left at a
 * stated moment (Owner decision D16, end-of-period reporting), the database half
 * (migration `20261008090000_sal_settlement_as_of.sql`).
 *
 * Every case is written so it FAILS when the control it names is removed:
 *
 *  - AS OF: `sal.invoice_open_receivable_as_of` and `sal.receipt_unallocated_as_of`
 *    count an allocation from its `allocated_at`, a credit note from its `issued_at`
 *    and a receipt reversal from its `reversed_at` — so an allocation, a credit or a
 *    reversal that took effect after the moment does not move the answer for it, and
 *    a document issued or received after the moment answers 0.
 *  - NOW: for a moment at or after the read, each answers exactly what its live
 *    counterpart answers.
 *  - BACKDATING: `app_runtime` holds table-level INSERT on `sal.receipts`,
 *    `sal.payment_allocations` and `sal.financial_events`, so without the three
 *    stamping triggers a raw INSERT on the runtime login stores a past
 *    `received_at`, `allocated_at` or `occurred_at`. With them it stores `now()`.
 *    The credit-note and reversal instants were already held by their decision
 *    guards and column grants; those cases are here so the whole finding is
 *    executable.
 *
 * The as-of cases run on the OWNER connection inside a rolled-back transaction,
 * because placing a fixture's instants in the past is only possible with triggers
 * suspended (`session_replication_role`, superuser only) — which is the point of
 * the backdating cases. Every document is first written through the protected
 * primitives, exactly as the platform writes it, and only its instant is restated.
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
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  allocateReceipt,
  seedCreditNote,
  seedReversal,
  cleanP111Committed,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

const PAST = '2020-01-01T00:00:00Z';

const setUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string | null> => {
  const value = ((await c.query(sql, params)).rows[0] as Record<string, unknown>).v;
  return value === null || value === undefined ? null : String(value);
};

/** `sal.invoice_open_receivable_as_of` at `now() + offset` (an interval, e.g. '-2 days'). */
const openAsOf = (c: Q, invoice: string, offset: string) =>
  scalar(c, `SELECT sal.invoice_open_receivable_as_of($1, now() + $2::interval)::text AS v`, [
    invoice,
    offset,
  ]);

/** `sal.receipt_unallocated_as_of` at `now() + offset`. */
const unallocatedAsOf = (c: Q, receipt: string, offset: string) =>
  scalar(c, `SELECT sal.receipt_unallocated_as_of($1, now() + $2::interval)::text AS v`, [
    receipt,
    offset,
  ]);

const openLive = (c: Q, invoice: string) =>
  scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice]);

const unallocatedLive = (c: Q, receipt: string) =>
  scalar(c, `SELECT sal.receipt_unallocated($1)::text AS v`, [receipt]);

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
 * Places one instant of one row at `now() + offset`, with triggers suspended for
 * that statement alone. Superuser only; the table and column are literals at
 * every call site.
 */
async function restate(
  c: Q,
  table: string,
  columns: readonly string[],
  id: string,
  offset: string
) {
  await c.query(`SET LOCAL session_replication_role = 'replica'`);
  const assignments = columns.map((column) => `${column} = now() + $2::interval`).join(', ');
  const result = await c.query(`UPDATE ${table} SET ${assignments} WHERE id = $1`, [id, offset]);
  await c.query(`SET LOCAL session_replication_role = 'origin'`);
  expect(result.rowCount, `${table} ${id}`).toBe(1);
}

/**
 * One invoice of 100 and two receipts, written through the primitives at `now()`
 * and then laid out over ten days:
 *
 *   -10d invoice issued (gross 100)
 *    -9d receipt R1 (100) received      -8d R1 allocates 30
 *    -7d receipt R2 (50) received       -6d R2 allocates 25
 *    -5d R1 allocates 20
 *    -4d credit note of 10 approved (issued_at)
 *    -3d R2 reversed (reversed_at)
 *
 * so the invoice owed 100, 70, 45, 25, 15 and finally 40 — the reversal hands R2's
 * 25 back — and that last figure is what the live function answers today.
 */
async function timeline(c: Q, tag: string) {
  const invoice = (await seedInvoiceWithLine(c, tag, { net: 100, tax: 0 })).invoice;
  await issueInvoice(c, invoice);
  const r1 = await seedReceipt(c, { amount: 100, payer: P9.SR });
  const a1 = await allocateReceipt(c, r1, invoice, 30);
  const a2 = await allocateReceipt(c, r1, invoice, 20);
  const r2 = await seedReceipt(c, { amount: 50, payer: P9.SR });
  const a3 = await allocateReceipt(c, r2, invoice, 25);
  const credit = await seedCreditNote(c, invoice, 10);
  await setUser(c, P11.APPROVER_USER);
  await c.query(`SELECT sal.approve_credit_note($1,NULL)`, [credit]);
  await setUser(c, USER_A);
  const reversal = await seedReversal(c, r2, 50);
  await setUser(c, P11.APPROVER_USER);
  await c.query(`SELECT sal.approve_receipt_reversal($1,NULL)`, [reversal]);
  await setUser(c, USER_A);

  await restate(c, 'sal.invoices', ['issued_at'], invoice, '-10 days');
  await restate(c, 'sal.receipts', ['received_at'], r1, '-9 days');
  await restate(c, 'sal.payment_allocations', ['allocated_at'], a1, '-8 days');
  await restate(c, 'sal.receipts', ['received_at'], r2, '-7 days');
  await restate(c, 'sal.payment_allocations', ['allocated_at'], a3, '-6 days');
  await restate(c, 'sal.payment_allocations', ['allocated_at'], a2, '-5 days');
  await restate(c, 'sal.credit_notes', ['approved_at', 'issued_at'], credit, '-4 days');
  await restate(c, 'sal.receipt_reversals', ['approved_at', 'reversed_at'], reversal, '-3 days');
  return { invoice, r1, r2 };
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

describe('D16 — what an invoice owed at a moment', () => {
  it('counts only the allocations, credits and reversals that had taken effect', async () => {
    await asOwnerRolledBack(async (c) => {
      const { invoice } = await timeline(c, 'fd16a_owed');
      // Not issued yet: it owed nothing then, as a draft owes nothing now.
      expect(await openAsOf(c, invoice, '-11 days')).toBe('0');
      expect(await openAsOf(c, invoice, '-9 days -12 hours')).toBe('100.0000');
      // R1's first allocation (-8d) counts; its second (-5d) does not yet.
      expect(await openAsOf(c, invoice, '-7 days -12 hours')).toBe('70.0000');
      // R2's allocation counts while R2 is not reversed.
      expect(await openAsOf(c, invoice, '-5 days -12 hours')).toBe('45.0000');
      expect(await openAsOf(c, invoice, '-4 days -12 hours')).toBe('25.0000');
      // The credit note counts from its issued_at.
      expect(await openAsOf(c, invoice, '-3 days -12 hours')).toBe('15.0000');
      // The reversal counts from its reversed_at: R2's 25 stops counting.
      expect(await openAsOf(c, invoice, '-2 days')).toBe('40.0000');
    });
  });

  it('answers exactly what the live function answers at and after the read', async () => {
    await asOwnerRolledBack(async (c) => {
      const { invoice } = await timeline(c, 'fd16a_owed_now');
      const live = await openLive(c, invoice);
      expect(live).toBe('40.0000');
      expect(await openAsOf(c, invoice, '0 seconds')).toBe(live);
      expect(await openAsOf(c, invoice, '1 day')).toBe(live);
    });
  });

  it('leaves a later allocation, credit and reversal out of an earlier moment', async () => {
    await asOwnerRolledBack(async (c) => {
      const invoice = (await seedInvoiceWithLine(c, 'fd16a_later', { net: 80, tax: 0 })).invoice;
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 30, payer: P9.SR });
      await allocateReceipt(c, receipt, invoice, 30);
      const credit = await seedCreditNote(c, invoice, 5);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1,NULL)`, [credit]);
      await setUser(c, USER_A);
      // Only the invoice is moved into the past; everything after it happened now.
      await restate(c, 'sal.invoices', ['issued_at'], invoice, '-30 days');
      expect(await openAsOf(c, invoice, '-1 day')).toBe('80.0000');
      expect(await openLive(c, invoice)).toBe('45.0000');
      expect(await openAsOf(c, invoice, '0 seconds')).toBe('45.0000');
    });
  });

  it('refuses a missing moment', async () => {
    await asOwnerRolledBack(async (c) => {
      await c.query('SAVEPOINT sp_null');
      let code: string | undefined;
      try {
        await c.query(`SELECT sal.invoice_open_receivable_as_of(gen_random_uuid(), NULL)`);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      await c.query('ROLLBACK TO SAVEPOINT sp_null');
      expect(code).toBe('22004');
    });
  });
});

describe('D16 — what a receipt had left at a moment', () => {
  it('counts allocations from allocated_at and the reversal from reversed_at', async () => {
    await asOwnerRolledBack(async (c) => {
      const { r1, r2 } = await timeline(c, 'fd16a_left');
      // Not received yet.
      expect(await unallocatedAsOf(c, r1, '-9 days -12 hours')).toBe('0');
      expect(await unallocatedAsOf(c, r1, '-8 days -12 hours')).toBe('100.0000');
      expect(await unallocatedAsOf(c, r1, '-7 days -12 hours')).toBe('70.0000');
      expect(await unallocatedAsOf(c, r1, '-4 days -12 hours')).toBe('50.0000');
      expect(await unallocatedAsOf(c, r2, '-7 days -12 hours')).toBe('0');
      expect(await unallocatedAsOf(c, r2, '-6 days -12 hours')).toBe('50.0000');
      expect(await unallocatedAsOf(c, r2, '-5 days -12 hours')).toBe('25.0000');
      // Reversed only from its reversed_at: the day before, it still held 25.
      expect(await unallocatedAsOf(c, r2, '-3 days -12 hours')).toBe('25.0000');
      expect(await unallocatedAsOf(c, r2, '-2 days')).toBe('0');
    });
  });

  it('answers exactly what the live function answers at and after the read', async () => {
    await asOwnerRolledBack(async (c) => {
      const { r1, r2 } = await timeline(c, 'fd16a_left_now');
      for (const receipt of [r1, r2]) {
        const live = await unallocatedLive(c, receipt);
        expect(await unallocatedAsOf(c, receipt, '0 seconds')).toBe(live);
        expect(await unallocatedAsOf(c, receipt, '1 day')).toBe(live);
      }
      expect(await unallocatedLive(c, r1)).toBe('50.0000');
      expect(await unallocatedLive(c, r2)).toBe('0');
    });
  });
});

describe('D16 — the two reads on the runtime login', () => {
  it('are executable by app_runtime and app_readonly and by nobody else by default', async () => {
    for (const fn of [
      'sal.invoice_open_receivable_as_of(uuid, timestamptz)',
      'sal.receipt_unallocated_as_of(uuid, timestamptz)',
    ]) {
      const rows = await admin.query<{ runtime: boolean; readonly: boolean; open: boolean }>(
        `SELECT has_function_privilege('app_runtime', $1, 'EXECUTE') AS runtime,
                has_function_privilege('app_readonly', $1, 'EXECUTE') AS readonly,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.oid = $1::regprocedure AND a.grantee = 0) AS open`,
        [fn]
      );
      expect(rows.rows[0], fn).toEqual({ runtime: true, readonly: true, open: false });
    }
  });

  it('agree with the live functions under the caller’s own row security', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const invoice = (await seedInvoiceWithLine(c, 'fd16a_rt', { net: 60, tax: 0 })).invoice;
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 20, payer: P9.SR });
      await allocateReceipt(c, receipt, invoice, 15);
      expect(await openAsOf(c, invoice, '0 seconds')).toBe(await openLive(c, invoice));
      expect(await openLive(c, invoice)).toBe('45.0000');
      expect(await unallocatedAsOf(c, receipt, '0 seconds')).toBe(
        await unallocatedLive(c, receipt)
      );
      expect(await unallocatedLive(c, receipt)).toBe('5.0000');
    });
  });
});

describe('D16 — the request path cannot backdate the instants the reads compare', () => {
  /** A raw receipt insert naming its own received_at. */
  const rawReceipt = (c: Q, tag: string) =>
    c.query<{ id: string; stamped: boolean; received_at: Date }>(
      `INSERT INTO sal.receipts (tenant_id, company_id, branch_id, receipt_number, payment_method_id,
         payer_partner_id, currency_code, amount, received_by, received_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'USD',10,$7,$8::timestamptz,$7)
       RETURNING id, received_at = now() AS stamped, received_at`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, `FD16A-RAW-${tag}`, P11.PM_CASH, P9.SR, USER_A, PAST]
    );

  it('stamps a runtime receipt’s received_at with now(), whatever it named', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const row = (await rawReceipt(c, 'rt')).rows[0]!;
      expect(row.stamped).toBe(true);
    });
  });

  it('stamps a runtime financial event’s occurred_at with now(), whatever it named', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = (await rawReceipt(c, 'ev')).rows[0]!.id;
      const event = await c.query<{ stamped: boolean }>(
        `INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type,
           source_id, currency_code, amount, occurred_at, actor_id, created_by)
         VALUES ($1,$2,$3,'receipt_recorded','receipt',$4,'USD',10,$5::timestamptz,$6,$6)
         RETURNING occurred_at = now() AS stamped`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, PAST, USER_A]
      );
      expect(event.rows[0]!.stamped).toBe(true);
    });
  });

  it('stamps a runtime allocation’s allocated_at with now(), whatever it named', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const invoice = (await seedInvoiceWithLine(c, 'fd16a_raw_alloc', { net: 40, tax: 0 }))
        .invoice;
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 40, payer: P9.SR });
      const allocation = await c.query<{ stamped: boolean }>(
        `INSERT INTO sal.payment_allocations (tenant_id, company_id, branch_id, receipt_id, invoice_id,
           currency_code, amount, allocated_by, allocated_at, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',10,$6,$7::timestamptz,$6)
         RETURNING allocated_at = now() AS stamped`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, invoice, USER_A, PAST]
      );
      expect(allocation.rows[0]!.stamped).toBe(true);
    });
  });

  it('holds only the request path: a role that bypasses row security keeps what it named', async () => {
    await asOwnerRolledBack(async (c) => {
      const row = (await rawReceipt(c, 'owner')).rows[0]!;
      expect(row.stamped).toBe(false);
      expect(row.received_at.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    });
  });

  it('already held the credit-note and reversal instants (finding, unchanged here)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const invoice = (await seedInvoiceWithLine(c, 'fd16a_held', { net: 50, tax: 0 })).invoice;
      await issueInvoice(c, invoice);
      // A raw credit note naming its own decision instants is born pending, undecided.
      const credit = await c.query<{
        id: string;
        approved_at: Date | null;
        issued_at: Date | null;
      }>(
        `INSERT INTO sal.credit_notes (tenant_id, company_id, branch_id, invoice_id, currency_code,
           amount, reason, approved_at, issued_at, created_by)
         VALUES ($1,$2,$3,$4,'USD',5,'fd16a',$5::timestamptz,$5::timestamptz,$6)
         RETURNING id, approved_at, issued_at`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, PAST, USER_A]
      );
      expect(credit.rows[0]).toMatchObject({ approved_at: null, issued_at: null });
      const receipt = await seedReceipt(c, { amount: 20, payer: P9.SR });
      const reversal = await c.query<{
        id: string;
        approved_at: Date | null;
        reversed_at: Date | null;
      }>(
        `INSERT INTO sal.receipt_reversals (tenant_id, company_id, branch_id, original_receipt_id,
           currency_code, amount, reason, approved_at, reversed_at, created_by)
         VALUES ($1,$2,$3,$4,'USD',20,'fd16a',$5::timestamptz,$5::timestamptz,$6)
         RETURNING id, approved_at, reversed_at`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, PAST, USER_A]
      );
      expect(reversal.rows[0]).toMatchObject({ approved_at: null, reversed_at: null });
      // And the runtime login holds no UPDATE on any of the four instants.
      for (const [table, column] of [
        ['sal.credit_notes', 'approved_at'],
        ['sal.credit_notes', 'issued_at'],
        ['sal.receipt_reversals', 'approved_at'],
        ['sal.receipt_reversals', 'reversed_at'],
      ] as const) {
        const privilege = await scalar(
          c,
          `SELECT has_column_privilege('app_runtime', $1, $2, 'UPDATE') AS v`,
          [table, column]
        );
        expect(privilege, `${table}.${column}`).toBe('false');
      }
    });
  });
});
