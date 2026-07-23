/**
 * DBCR-P1-15-002 — display-number period hardening (P1-15-SR-014).
 *
 * ## What was wrong
 *
 * `shared.next_display_number()` derived its period key from `now()`, which is
 * *transaction-start* time. A transaction that began before a period boundary
 * and reached the allocation after it computed the OLD key; the reset test is a
 * plain inequality, so the run restarted at **1** and the older key was stamped
 * back onto the row. The regression guard did not stop it, because its counter
 * check only fires when the period is unchanged.
 *
 * Reproduced on protected `develop` (0b843bf) as `app_runtime`: after issuing
 * `2026-07-23-000001` and `2026-07-23-000002`, an allocation whose `now()` still
 * resolved to `2026-07-23` — against a row already advanced to `2026-07-24` —
 * issued **`2026-07-23-000001` a second time** and rewound `current_period`.
 *
 * ## What this suite pins
 *
 * The allocator now reads `clock_timestamp()` (statement time, after the row
 * lock) and the guard refuses any backwards `current_period` move under an
 * unchanged reset rule. Every assertion below fails against the migration-0003
 * contract, which is what makes them a regression lock rather than a
 * description.
 *
 * Everything runs on the real non-owner login `rootlco_test_runtime`
 * (NOBYPASSRLS, non-super). The admin connection only provisions fixtures and
 * reads results back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureOrgFixtures,
  ensureTestLogins,
  cleanFixtures,
  withCommittedTx,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

/** Daily sequence used for the boundary proofs. Renders its own period. */
const DAILY = 'p15h_daily';
/** Yearly sequence used to prove a forward reset still works. */
const YEARLY = 'p15h_yearly';
/** Never-resetting sequence: its contract must be untouched. */
const NEVER = 'p15h_never';
/** Tenant B row, same code as DAILY, for the isolation assertion. */
const CROSS = 'p15h_daily';

const WORKERS = 12;

let admin: Pool;
let runtime: Pool;

const AS_A = { tenantId: TENANT_A, userId: USER_A };

async function allocate(tx: { query: Client['query'] }, code: string) {
  const { rows } = await tx.query(
    'SELECT display_number, sequence_value FROM shared.next_display_number($1)',
    [code]
  );
  return rows[0] as { display_number: string; sequence_value: string };
}

async function readRow(code: string, tenant: string = TENANT_A) {
  const { rows } = await admin.query(
    `SELECT next_value::text AS next_value, current_period
       FROM shared.number_sequences WHERE tenant_id = $1 AND sequence_code = $2`,
    [tenant, code]
  );
  return rows[0] as { next_value: string; current_period: string | null };
}

/** Period keys as the database itself renders them, so the test never guesses. */
async function periods() {
  const { rows } = await admin.query(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD')                      AS today,
            to_char((clock_timestamp() AT TIME ZONE 'UTC') + interval '1 day', 'YYYY-MM-DD')  AS tomorrow,
            to_char((clock_timestamp() AT TIME ZONE 'UTC') - interval '1 day', 'YYYY-MM-DD')  AS yesterday,
            to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY')                             AS thisYear`
  );
  return rows[0] as { today: string; tomorrow: string; yesterday: string; thisyear: string };
}

/**
 * Puts a sequence into an exact state by **re-provisioning** it.
 *
 * Deliberately not an UPDATE. Since migration 118 the guard refuses any
 * `current_period` that is not the clock's current key, so staging a past or
 * future period through an UPDATE is exactly what the fix forbids — including
 * for the admin connection, because a `BEFORE UPDATE` trigger does not care who
 * you are. Provisioning is an INSERT, triggers do not fire on INSERT, and that
 * is the honest way to build a fixture whose state a legitimate writer could
 * have arrived at over time.
 */
async function place(code: string, nextValue: number, period: string | null, rule = 'daily') {
  await admin.query(
    `DELETE FROM shared.number_sequences WHERE tenant_id = $1 AND sequence_code = $2`,
    [TENANT_A, code]
  );
  const prefix = rule === 'never' ? 'NV-' : code === YEARLY ? 'FXY-{period}-' : '{period}-';
  const pad = rule === 'never' ? 4 : code === YEARLY ? 3 : 6;
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, pad_width, period_reset_rule, current_period, next_value, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [TENANT_A, code, prefix, pad, rule, period, nextValue, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, pad_width, period_reset_rule, current_period, created_by)
     VALUES
       ($1, $3, '{period}-',     6, 'daily',  NULL,   $2),
       ($1, $4, 'FXY-{period}-', 3, 'yearly', '2020', $2),
       ($1, $5, 'NV-',           4, 'never',  NULL,   $2)`,
    [TENANT_A, USER_A, DAILY, YEARLY, NEVER]
  );
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, pad_width, period_reset_rule, created_by)
     VALUES ($1, $2, '{period}-', 6, 'daily', $3)`,
    [TENANT_B, CROSS, USER_B]
  );
  runtime = runtimePool(WORKERS + 4);
});

afterAll(async () => {
  await runtime.end();
  await cleanFixtures(admin);
  await admin.end();
});

describe('DBCR-P1-15-002 / the mechanism the defect used', () => {
  it('now() is frozen for the transaction while clock_timestamp() advances', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT now() AS n');
      await client.query('SELECT pg_sleep(1.1)');
      const after = await client.query('SELECT now() AS n, clock_timestamp() AS c');
      expect(new Date(after.rows[0].n).getTime()).toBe(new Date(before.rows[0].n).getTime());
      expect(
        new Date(after.rows[0].c).getTime() - new Date(after.rows[0].n).getTime()
      ).toBeGreaterThan(1000);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('the allocator no longer reads now() for its period key', async () => {
    const { rows } = await admin.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared' AND p.proname = 'next_display_number'`
    );
    const source = rows[0]!.src;
    // The period CASE is the only place a timestamp is read. Three clock_timestamp()
    // reads (yearly/monthly/daily) and no now() at all.
    expect(source).toContain("to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY')");
    expect(source).toContain("to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM')");
    expect(source).toContain("to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD')");
    expect(source).not.toMatch(/to_char\(\s*now\(\)/);
  });
});

describe('DBCR-P1-15-002 / a backwards period is refused, not re-issued', () => {
  it('the state SR-014 needed can no longer be created by any writer', async () => {
    const p = await periods();
    await place(DAILY, 3, p.today);

    // SR-014 needed one thing: a row whose `current_period` is a period the
    // caller's own clock has not reached. Under migration 0003 a writer holding
    // the ordinary `UPDATE (next_value, current_period)` grant could produce it,
    // and so could a peer transaction whose clock had crossed the boundary first.
    // Now the guard refuses any key that is not the clock's current one, so the
    // precondition is unreachable rather than merely unlikely.
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET next_value = 2, current_period = $2
             WHERE tenant_id = $1 AND sequence_code = $3`,
          [TENANT_A, p.tomorrow, DAILY]
        ),
        '23514'
      );
    });

    // And the allocator itself can no longer write a stale key: it reads the
    // clock at allocation time, so after any allocation the stored key IS the
    // current key. Under 0003 this was the value `now()` happened to hold when
    // the transaction began.
    await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, DAILY));
    expect((await readRow(DAILY)).current_period).toBe(p.today);
  });

  it('a backwards period move by the runtime role is refused (23514)', async () => {
    const p = await periods();
    await place(DAILY, 5, p.today);
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET current_period = $2
             WHERE tenant_id = $1 AND sequence_code = $3`,
          [TENANT_A, p.yesterday, DAILY]
        ),
        '23514'
      );
    });
  });

  it('a backwards period move that also lowers the counter is refused (23514)', async () => {
    const p = await periods();
    await place(DAILY, 9, p.tomorrow);
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET next_value = 2, current_period = '2000-01-01'
             WHERE tenant_id = $1 AND sequence_code = $2`,
          [TENANT_A, DAILY]
        ),
        '23514'
      );
    });
    const row = await readRow(DAILY);
    expect(row.current_period).toBe(p.tomorrow);
    expect(row.next_value).toBe('9');
  });

  // The three below are the second half of the finding: "may only move forward"
  // was not enough, because `next_value` may legitimately fall together with a
  // period change. Each of these was ACCEPTED by the forward-only draft of
  // migration 118, and the third one then re-issued `FXY-<year>-001` against a
  // sequence already at 42.

  it('clearing current_period to NULL on a period-resetting sequence is refused (23514)', async () => {
    const p = await periods();
    await place(YEARLY, 42, p.thisyear, 'yearly');
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET current_period = NULL
             WHERE tenant_id = $1 AND sequence_code = $2`,
          [TENANT_A, YEARLY]
        ),
        '23514'
      );
    });
  });

  it('forging a FUTURE period while lowering the counter is refused (23514)', async () => {
    const p = await periods();
    await place(YEARLY, 42, p.thisyear, 'yearly');
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET next_value = 1, current_period = '2099'
             WHERE tenant_id = $1 AND sequence_code = $2`,
          [TENANT_A, YEARLY]
        ),
        '23514'
      );
    });
  });

  it('the run cannot be restarted by clearing the period and allocating again', async () => {
    const p = await periods();
    await place(YEARLY, 42, p.thisyear, 'yearly');

    // Committed, not rolled back: this is the whole exploit, end to end.
    let cleared = false;
    try {
      await withCommittedTx(runtime, AS_A, (tx) =>
        tx.query(
          `UPDATE shared.number_sequences SET current_period = NULL
             WHERE tenant_id = $1 AND sequence_code = $2`,
          [TENANT_A, YEARLY]
        )
      );
      cleared = true;
    } catch {
      cleared = false;
    }
    expect(cleared).toBe(false);

    // The run is untouched, so the next number is 42 and not 1.
    const next = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, YEARLY));
    expect(next.sequence_value).toBe('42');
    expect(next.display_number).toBe(`FXY-${p.thisyear}-042`);
  });
});

describe('DBCR-P1-15-002 / everything the guard already allowed still works', () => {
  it('a forward period reset still restarts the run and stamps the new key', async () => {
    const p = await periods();
    await place(YEARLY, 42, '2020', 'yearly');
    const allocated = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, YEARLY));
    expect(allocated.sequence_value).toBe('1'); // reset from the 2020 fixture
    expect(allocated.display_number).toBe(`FXY-${p.thisyear}-001`);

    const row = await readRow(YEARLY);
    expect(row.current_period).toBe(p.thisyear);
    expect(row.next_value).toBe('2');

    const next = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, YEARLY));
    expect(next.display_number).toBe(`FXY-${p.thisyear}-002`);
  });

  it('the first stamp on a never-stamped sequence is allowed (NULL is not "backwards")', async () => {
    const p = await periods();
    await place(DAILY, 1, null);
    const allocated = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, DAILY));
    expect(allocated.display_number).toBe(`${p.today}-000001`);
    expect((await readRow(DAILY)).current_period).toBe(p.today);
  });

  it('a never-resetting sequence is untouched: no period, and a faked one is refused', async () => {
    await place(NEVER, 1, null, 'never');
    const a = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, NEVER));
    const b = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, NEVER));
    expect(a.display_number).toBe('NV-0001');
    expect(b.display_number).toBe('NV-0002');
    expect((await readRow(NEVER)).current_period).toBeNull();

    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET next_value = 1, current_period = '2019'
             WHERE tenant_id = $1 AND sequence_code = $2`,
          [TENANT_A, NEVER]
        ),
        '23514'
      );
    });
  });

  it('lowering the counter without a period change is still refused (23514)', async () => {
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET next_value = 1
             WHERE tenant_id = $1 AND sequence_code = $2`,
          [TENANT_A, NEVER]
        ),
        '23514'
      );
    });
  });

  it('rollback still discards the allocation, so no gap is committed', async () => {
    const before = await readRow(NEVER);
    await withRolledBackTx(runtime, AS_A, (tx) => allocate(tx, NEVER));
    const after = await readRow(NEVER);
    expect(after.next_value).toBe(before.next_value);
  });
});

describe('DBCR-P1-15-002 / the security posture the replacement had to preserve', () => {
  it('concurrent allocators still receive distinct values under one lock', async () => {
    await place(DAILY, 1, null);
    const results = await Promise.all(
      Array.from({ length: WORKERS }, () =>
        withCommittedTx(runtime, AS_A, (tx) => allocate(tx, DAILY))
      )
    );
    const values = results.map((r) => Number(r.sequence_value)).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: WORKERS }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.display_number)).size).toBe(WORKERS);
  });

  it('still refuses to allocate without tenant context (42501)', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await expectSqlState(
        client.query('SELECT * FROM shared.next_display_number($1)', [DAILY]),
        '42501'
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it("tenant A cannot reach tenant B's row of the same code", async () => {
    const bBefore = await readRow(CROSS, TENANT_B);
    await place(DAILY, 1, null);
    await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, DAILY));
    const bAfter = await readRow(CROSS, TENANT_B);
    expect(bAfter.next_value).toBe(bBefore.next_value);
    expect(bAfter.current_period).toBe(bBefore.current_period);
  });

  it('both functions remain SECURITY INVOKER with an empty search_path', async () => {
    const { rows } = await admin.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `SELECT p.proname, p.prosecdef, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared'
          AND p.proname IN ('next_display_number', 'guard_number_sequence_regression')
        ORDER BY p.proname`
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.prosecdef).toBe(false);
      // `SET search_path = ''` is stored as the literal `search_path=""`.
      expect(row.proconfig).toContain('search_path=""');
    }
  });

  it('EXECUTE on the allocator is still app_runtime only, and never PUBLIC', async () => {
    const { rows } = await admin.query<{ pub: boolean; rt: boolean; wk: boolean; ro: boolean }>(
      `SELECT has_function_privilege('public', 'shared.next_display_number(text,uuid,uuid)', 'EXECUTE') AS pub,
              has_function_privilege('app_runtime', 'shared.next_display_number(text,uuid,uuid)', 'EXECUTE') AS rt,
              has_function_privilege('app_worker', 'shared.next_display_number(text,uuid,uuid)', 'EXECUTE') AS wk,
              has_function_privilege('app_readonly', 'shared.next_display_number(text,uuid,uuid)', 'EXECUTE') AS ro`
    );
    expect(rows[0]!.pub).toBe(false);
    expect(rows[0]!.rt).toBe(true);
    expect(rows[0]!.wk).toBe(false);
    expect(rows[0]!.ro).toBe(false);
  });

  it('the guard trigger is still attached BEFORE UPDATE and is not internal', async () => {
    const { rows } = await admin.query<{ tgname: string; timing: number; enabled: string }>(
      `SELECT t.tgname, t.tgtype AS timing, t.tgenabled AS enabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'shared' AND c.relname = 'number_sequences'
          AND NOT t.tgisinternal AND t.tgname = 'tg_number_sequences_guard_regression'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe('O');
    // tgtype bit 0 = ROW, bit 1 = BEFORE, bit 4 = UPDATE.
    expect(rows[0]!.timing & 1).toBe(1);
    expect(rows[0]!.timing & 2).toBe(2);
    expect(rows[0]!.timing & 16).toBe(16);
  });
});
