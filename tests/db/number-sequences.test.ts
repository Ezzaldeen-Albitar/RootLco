/**
 * Display-number allocation suite (P1-02-DB-004/019, P1-02-QA-005).
 *
 * Includes the concurrency proof: 50 parallel workers (the approved canonical
 * baseline) allocating from ONE sequence row, executed as the runtime role.
 * If this environment cannot sustain 50 connections the harness FAILS rather
 * than silently shrinking — a reduced worker count must be an explicit,
 * recorded decision, never an accident.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  runtimeClient,
  ensureTestLogins,
  cleanFixtures,
  withCommittedTx,
  withRolledBackTx,
  expectSqlState,
  setContext,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  COMPANY_A1,
} from './helpers';

const WORKERS = 50;

let admin: Pool;
let runtime: Pool;

async function allocate(
  tx: { query: Client['query'] },
  code: string,
  companyId?: string
): Promise<{ display_number: string; sequence_value: string }> {
  const { rows } = await tx.query(
    'SELECT display_number, sequence_value FROM shared.next_display_number($1, $2)',
    [code, companyId ?? null]
  );
  return rows[0];
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, pad_width, period_reset_rule, created_by)
     VALUES
       ($1, 'ticket',   'T-', 4, 'never',   $3),
       ($2, 'ticket',   'T-', 4, 'never',   $4),
       ($1, 'monthly_doc', 'M{period}-', 3, 'monthly', $3),
       ($1, 'burst',    '',   0, 'never',   $3)`,
    [TENANT_A, TENANT_B, USER_A, USER_B]
  );
  // Company-scoped sequence for the narrowing test.
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, company_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1, $2, 'per_company', 'C-', 4, $3)`,
    [TENANT_A, COMPANY_A1, USER_A]
  );
  runtime = runtimePool(WORKERS + 5);
});

afterAll(async () => {
  await runtime.end();
  await cleanFixtures(admin);
  await admin.end();
});

describe('allocation basics (as the runtime role)', () => {
  it('issues sequential, formatted numbers', async () => {
    const first = await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (tx) =>
      allocate(tx, 'ticket')
    );
    const second = await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (tx) =>
      allocate(tx, 'ticket')
    );
    expect(first.display_number).toBe('T-0001');
    expect(second.display_number).toBe('T-0002');
  });

  it('tenants advance independently — no global sequence exists', async () => {
    const b = await withCommittedTx(runtime, { tenantId: TENANT_B, userId: USER_B }, (tx) =>
      allocate(tx, 'ticket')
    );
    expect(b.display_number).toBe('T-0001'); // B starts at 1 regardless of A
  });

  it('refuses to allocate without tenant context', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await expectSqlState(
        client.query('SELECT * FROM shared.next_display_number($1)', ['ticket']),
        '42501' // insufficient_privilege
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('refuses an unknown sequence code', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query('SELECT * FROM shared.next_display_number($1)', ['nope']),
        'P0002'
      );
    });
  });

  it("cannot allocate from another tenant's sequence (RLS: row not found)", async () => {
    // Tenant B has no 'per_company' sequence; Tenant A's is invisible to B.
    await withRolledBackTx(runtime, { tenantId: TENANT_B }, async (tx) => {
      await expectSqlState(
        tx.query('SELECT * FROM shared.next_display_number($1, $2)', ['per_company', COMPANY_A1]),
        'P0002'
      );
    });
  });

  it('enforces the allowed-company narrowing when the session declares one', async () => {
    const otherCompany = 'a2000000-0000-4000-8000-000000000002';
    await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, companyIds: [otherCompany] },
      async (tx) => {
        await expectSqlState(
          tx.query('SELECT * FROM shared.next_display_number($1, $2)', ['per_company', COMPANY_A1]),
          '42501'
        );
      }
    );
    // With the right company in scope it works.
    const ok = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, companyIds: [COMPANY_A1] },
      (tx) => allocate(tx, 'per_company', COMPANY_A1)
    );
    expect(ok.display_number).toBe('C-0001');
  });

  it('WIDENS (never truncates) when a value outgrows pad_width', async () => {
    // Regression test for the measured lpad-truncation defect: plain
    // lpad('12345', 4, '0') returns '1234'. Values past 10^pad_width must
    // render in full, or display numbers would collide.
    await admin.query(
      `UPDATE shared.number_sequences SET next_value = 12345
       WHERE tenant_id = $1 AND sequence_code = 'ticket'`,
      [TENANT_A]
    );
    const wide = await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (tx) =>
      allocate(tx, 'ticket')
    );
    expect(wide.display_number).toBe('T-12345'); // 5 digits through a pad of 4
    expect(wide.sequence_value).toBe('12345');
  });

  it('resets on period change and renders {period}', async () => {
    // Simulate "last allocation happened in an earlier period" (admin fixture
    // manipulation — the reset itself is then exercised as the runtime role).
    await admin.query(
      `UPDATE shared.number_sequences
       SET next_value = 42, current_period = '2020-01'
       WHERE tenant_id = $1 AND sequence_code = 'monthly_doc'`,
      [TENANT_A]
    );
    const result = await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (tx) =>
      allocate(tx, 'monthly_doc')
    );
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)
    expect(result.sequence_value).toBe('1'); // reset, not 42
    expect(result.display_number).toBe(`M${period}-001`);
  });
});

describe('rollback behaviour (no duplicates, no corruption)', () => {
  it('a rolled-back allocation returns the number to the sequence', async () => {
    const rolledBack = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A },
      (tx) => allocate(tx, 'ticket')
    );
    const committed = await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (tx) =>
      allocate(tx, 'ticket')
    );
    // The next committed caller receives the SAME value the aborted
    // transaction had taken — transactional allocation leaves no gap and can
    // never have issued the aborted number to anyone.
    expect(committed.sequence_value).toBe(rolledBack.sequence_value);
  });

  it('the regression guard blocks rewinding next_value without a period change', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET next_value = 1
           WHERE sequence_code = 'ticket'`
        ),
        '23514' // check_violation raised by the guard trigger
      );
    });
  });

  it('the guard cannot be bypassed by inventing a period change (never-resetting sequence)', async () => {
    // Adversarial-review hardening: with the UPDATE column grant covering both
    // next_value and current_period, a writer could otherwise fake a "period
    // reset" to sneak a rewind past the guard. On a 'never' sequence any
    // current_period change is rejected (trigger + CHECK constraint).
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET next_value = 1, current_period = 'fake'
           WHERE sequence_code = 'ticket'`
        ),
        '23514'
      );
    });
  });
});

describe(`concurrency — ${WORKERS} parallel workers, one sequence row`, () => {
  it('issues unique, consecutive values with no duplicates and no loss', async () => {
    const before = await admin.query(
      `SELECT next_value FROM shared.number_sequences
       WHERE tenant_id = $1 AND sequence_code = 'burst'`,
      [TENANT_A]
    );
    const start = Number(before.rows[0].next_value);

    // Dedicated connections — a pool would serialise more than the lock does.
    const clients: Client[] = [];
    try {
      for (let i = 0; i < WORKERS; i++) clients.push(runtimeClient());
      await Promise.all(clients.map((c) => c.connect()));

      const values = await Promise.all(
        clients.map(async (client) => {
          await client.query('BEGIN');
          await setContext(client, { tenantId: TENANT_A, userId: USER_A });
          const { rows } = await client.query(
            'SELECT sequence_value FROM shared.next_display_number($1)',
            ['burst']
          );
          await client.query('COMMIT');
          return Number(rows[0].sequence_value);
        })
      );

      expect(values).toHaveLength(WORKERS);
      expect(new Set(values).size).toBe(WORKERS); // no duplicates
      expect(Math.min(...values)).toBe(start);
      expect(Math.max(...values)).toBe(start + WORKERS - 1); // no lost values

      const after = await admin.query(
        `SELECT next_value FROM shared.number_sequences
         WHERE tenant_id = $1 AND sequence_code = 'burst'`,
        [TENANT_A]
      );
      expect(Number(after.rows[0].next_value)).toBe(start + WORKERS);
    } finally {
      await Promise.allSettled(clients.map((c) => c.end()));
    }
  });

  it('stays consistent when a third of concurrent allocations roll back', async () => {
    const before = await admin.query(
      `SELECT next_value FROM shared.number_sequences
       WHERE tenant_id = $1 AND sequence_code = 'burst'`,
      [TENANT_A]
    );
    const start = Number(before.rows[0].next_value);
    const total = 30;

    const clients: Client[] = [];
    try {
      for (let i = 0; i < total; i++) clients.push(runtimeClient());
      await Promise.all(clients.map((c) => c.connect()));

      const committed = (
        await Promise.all(
          clients.map(async (client, i) => {
            await client.query('BEGIN');
            await setContext(client, { tenantId: TENANT_A, userId: USER_A });
            const { rows } = await client.query(
              'SELECT sequence_value FROM shared.next_display_number($1)',
              ['burst']
            );
            const value = Number(rows[0].sequence_value);
            if (i % 3 === 0) {
              await client.query('ROLLBACK');
              return null;
            }
            await client.query('COMMIT');
            return value;
          })
        )
      ).filter((v): v is number => v !== null);

      // Committed numbers are unique — a rolled-back number may be re-issued
      // later, but never twice among COMMITTED allocations.
      expect(new Set(committed).size).toBe(committed.length);

      const after = await admin.query(
        `SELECT next_value FROM shared.number_sequences
         WHERE tenant_id = $1 AND sequence_code = 'burst'`,
        [TENANT_A]
      );
      const consumed = Number(after.rows[0].next_value) - start;
      // Transactional allocation: the counter durably advances exactly once
      // per COMMITTED allocation — rolled-back increments vanish and their
      // values are re-issued, so the committed values are a gapless run.
      expect(consumed).toBe(committed.length);
      expect([...committed].sort((a, b) => a - b)).toEqual(
        Array.from({ length: committed.length }, (_, i) => start + i)
      );
    } finally {
      await Promise.allSettled(clients.map((c) => c.end()));
    }
  });
});
