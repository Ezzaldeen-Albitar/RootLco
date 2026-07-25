/**
 * P1-15 display-number allocation — the database contract the shared-services
 * numbering module depends on.
 *
 * `src/modules/shared-services` delegates the entire allocation to
 * `shared.next_display_number()` and keeps only an allow-list
 * (`domain/sequence-registry.ts`) plus a thin repository. That split is only
 * safe if two things hold, and this suite proves both against the live
 * database rather than against the TypeScript that assumes them:
 *
 *  1. **The registry cannot drift.** Every registered code names a
 *     `targetTable.targetColumn` that actually exists, and every registered
 *     code is spellable as a `sequence_code` under the table's own format
 *     CHECK. A registry entry for a document type the platform does not have
 *     would otherwise survive review and fail in production.
 *  2. **The allocator behaves as the standard claims** — rendering, exact
 *     single-step advance, scope refusal, tenant invisibility, rollback,
 *     serialisation under contention, lazy period reset, pad widening, the
 *     rewind guard, and the deliberate absence of INSERT/DELETE.
 *
 * Every behavioural assertion runs on `rootlco_test_runtime` (member of
 * `app_runtime`), never on the admin connection: `postgres` carries BYPASSRLS
 * locally and is a superuser in CI, so nothing it does is evidence. Admin is
 * used only to provision sequence rows — provisioning is an administrative
 * configuration action by design (`app_runtime` holds no INSERT) — and, in one
 * clearly-marked place, to confirm a fixture row genuinely exists so that
 * "invisible to tenant A" cannot be confused with "absent".
 *
 * Two facts about the grant shape drive how the privilege assertions are
 * written. `app_runtime` holds a **column-scoped** `UPDATE (next_value,
 * current_period)`, so `has_table_privilege(…, 'UPDATE')` is FALSE even though
 * the allocator's UPDATE succeeds — `has_column_privilege` is the correct
 * catalog question, and executing the function as the runtime login is the
 * correct behavioural one. Both are asserted.
 *
 * Denial shapes: a missing privilege raises 42501; the allocator's deliberate
 * refusals raise 42501 (scope) and P0002 (nothing provisioned in scope); the
 * rewind guard raises 23514. A second failing probe in the same transaction
 * could only report 25P02, so every denial gets its own transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  BRANCH_A1,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  setContext,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';
import { SEQUENCE_DEFINITIONS } from '@/modules/shared-services/domain/sequence-registry';

type Q = { query: Client['query'] };

interface Allocated {
  readonly display_number: string;
  /** `bigint` — the driver returns it as a string, and it is compared as one. */
  readonly sequence_value: string;
}

/** Fixture sequence codes. `fx_` prefix per the fixture standard. */
const BASIC = 'fx_p1_15_basic';
const ROLLBACK = 'fx_p1_15_rollback';
const CONCURRENT = 'fx_p1_15_concurrent';
const YEARLY = 'fx_p1_15_yearly';
const PAD = 'fx_p1_15_pad';
const GUARD = 'fx_p1_15_guard';
const COMPANY_SCOPED = 'fx_p1_15_company';
const BRANCH_SCOPED = 'fx_p1_15_branch';
const TENANT_B_ONLY = 'fx_p1_15_tenant_b';

/** Deliberately not provisioned anywhere — the "configuration gap" probe. */
const UNPROVISIONED = 'fx_p1_15_never_provisioned';

/** Scope values the session does NOT hold, used to prove the scope refusals. */
const FOREIGN_COMPANY = 'a2000000-0000-4000-8000-0000000f1501';
const FOREIGN_BRANCH = 'a2100000-0000-4000-8000-0000000f1501';

const AS_A = { tenantId: TENANT_A, userId: USER_A };
const AS_B = { tenantId: TENANT_B, userId: USER_B };

let admin: Pool;
let runtime: Pool;

/**
 * Calls the allocator. Named parameters mirror the repository's call exactly,
 * so a signature change breaks the test that claims the repository is thin.
 */
async function allocate(
  tx: Q,
  code: string,
  companyId: string | null = null,
  branchId: string | null = null
): Promise<Allocated> {
  const { rows } = await tx.query<Allocated>(
    `SELECT display_number, sequence_value
       FROM shared.next_display_number(
              p_sequence_code => $1,
              p_company_id    => $2::uuid,
              p_branch_id     => $3::uuid)`,
    [code, companyId, branchId]
  );
  const row = rows[0];
  if (!row) throw new Error(`shared.next_display_number returned no row for "${code}"`);
  return row;
}

/**
 * Reads the counter **as the runtime login**, inside tenant A's context.
 *
 * Reading it on the admin connection would prove nothing about what the
 * runtime role can see, and the counter is the value every claim below is
 * measured against.
 */
async function readNextValue(code: string, ctx = AS_A): Promise<string> {
  return withRolledBackTx(runtime, ctx, async (tx) => {
    const { rows } = await tx.query<{ next_value: string }>(
      `SELECT next_value FROM shared.number_sequences WHERE sequence_code = $1`,
      [code]
    );
    const value = rows[0]?.next_value;
    if (value === undefined)
      throw new Error(`sequence "${code}" is not visible to the runtime role`);
    return value;
  });
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  // Provisioning is an administrative action: app_runtime holds no INSERT on
  // this table (asserted below), so the admin connection is the only path.
  // Each behaviour gets its OWN sequence row so no test can be perturbed by
  // the counter another test advanced.
  const tenantWide: ReadonlyArray<
    readonly [
      code: string,
      prefix: string,
      pad: number,
      rule: string,
      period: string | null,
      next: number,
    ]
  > = [
    [BASIC, 'FX-', 4, 'never', null, 1],
    [ROLLBACK, 'FXR-', 4, 'never', null, 1],
    [CONCURRENT, '', 0, 'never', null, 1],
    // Stale period + a counter well past 1: the reset must beat both.
    [YEARLY, 'FXY-{period}-', 3, 'yearly', '2020', 42],
    // One below the pad boundary, so the next two allocations straddle it.
    [PAD, '', 2, 'never', null, 99],
    [GUARD, 'FXG-', 4, 'never', null, 500],
  ];
  for (const [code, prefix, pad, rule, period, next] of tenantWide) {
    await admin.query(
      `INSERT INTO shared.number_sequences
         (tenant_id, sequence_code, prefix_template, pad_width,
          period_reset_rule, current_period, next_value, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [TENANT_A, code, prefix, pad, rule, period, next, USER_A]
    );
  }
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, company_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1, $2, $3, 'FXC-', 4, $4)`,
    [TENANT_A, COMPANY_A1, COMPANY_SCOPED, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, company_id, branch_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1, $2, $3, $4, 'FXB-', 4, $5)`,
    [TENANT_A, COMPANY_A1, BRANCH_A1, BRANCH_SCOPED, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1, $2, 'FXT-', 4, $3)`,
    [TENANT_B, TENANT_B_ONLY, USER_B]
  );

  runtime = runtimePool(6);
});

afterAll(async () => {
  await runtime.end();
  await cleanFixtures(admin);
  await admin.end();
});

describe('P1-15 / the sequence registry cannot drift from the database', () => {
  it('every registered code names a target column that exists', async () => {
    // Catalog shape, not privilege: asked on the admin connection on purpose,
    // because information_schema hides columns the querying role lacks rights
    // on — asking as the runtime role would report "column absent" for a
    // column that merely is not granted, which is a different defect.
    const { rows } = await admin.query<{ code: string; present: boolean }>(
      `SELECT d.code,
              EXISTS (
                SELECT 1 FROM information_schema.columns c
                 WHERE c.table_schema = split_part(d.tbl, '.', 1)
                   AND c.table_name   = split_part(d.tbl, '.', 2)
                   AND c.column_name  = d.col
              ) AS present
         FROM unnest($1::text[], $2::text[], $3::text[]) AS d(code, tbl, col)`,
      [
        SEQUENCE_DEFINITIONS.map((d) => d.code),
        SEQUENCE_DEFINITIONS.map((d) => d.targetTable),
        SEQUENCE_DEFINITIONS.map((d) => d.targetColumn),
      ]
    );

    expect(rows).toHaveLength(SEQUENCE_DEFINITIONS.length);
    const missing = rows.filter((r) => !r.present).map((r) => r.code);
    expect(missing, 'registry entries whose target column does not exist').toEqual([]);
  });

  it('every registered code is accepted by the live sequence_code CHECK', async () => {
    // Behavioural rather than a re-implementation of the regex: the table
    // itself judges the spelling, so a registry entry that could never be
    // provisioned fails here instead of at tenant onboarding.
    //
    // The codes are inserted VERBATIM (not fx_-prefixed) because the spelling
    // is the thing under test — an `fx_` prefix would make `1invoice` look
    // legal. The transaction is rolled back, so nothing is provisioned and
    // nothing needs cleaning up.
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      for (const definition of SEQUENCE_DEFINITIONS) {
        await client.query(
          `INSERT INTO shared.number_sequences (tenant_id, sequence_code, created_by)
           VALUES ($1, $2, $3)`,
          [TENANT_A, definition.code, USER_A]
        );
      }
      // The UNIQUE scope constraint also proves the registry has no duplicate
      // code: a repeated entry would have raised 23505 above.
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.number_sequences
          WHERE tenant_id = $1 AND sequence_code = ANY($2::text[])`,
        [TENANT_A, SEQUENCE_DEFINITIONS.map((d) => d.code)]
      );
      expect(Number(rows[0]?.n ?? 0)).toBe(SEQUENCE_DEFINITIONS.length);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('P1-15 / allocation as the runtime login', () => {
  it('renders prefix + zero-padded value and advances the counter by exactly one', async () => {
    const before = await readNextValue(BASIC);
    const first = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, BASIC));
    const after = await readNextValue(BASIC);

    expect(first.sequence_value).toBe(before);
    expect(first.display_number).toBe(`FX-${first.sequence_value.padStart(4, '0')}`);
    expect(first.display_number).toBe('FX-0001');
    // Exactly one, not "at least one": a double advance would silently gap.
    expect(Number(after) - Number(before)).toBe(1);

    const second = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, BASIC));
    expect(second.display_number).toBe('FX-0002');
  });

  it('raises P0002 for a code that is not provisioned in this scope', async () => {
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(allocate(tx, UNPROVISIONED), 'P0002');
    });
  });

  it('raises P0002 for a provisioned code requested at the wrong scope', async () => {
    // The company-scoped row exists, but not as a tenant-wide row. Scope is
    // part of the identity of a sequence, not a filter over one.
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(allocate(tx, COMPANY_SCOPED), 'P0002');
    });
  });
});

describe('P1-15 / scope refusal (42501)', () => {
  it('refuses a company outside the session allowed_company_ids', async () => {
    await withRolledBackTx(runtime, { ...AS_A, companyIds: [FOREIGN_COMPANY] }, async (tx) => {
      await expectSqlState(allocate(tx, COMPANY_SCOPED, COMPANY_A1), '42501');
    });
  });

  it('allocates for a company the session does hold', async () => {
    const ok = await withRolledBackTx(runtime, { ...AS_A, companyIds: [COMPANY_A1] }, (tx) =>
      allocate(tx, COMPANY_SCOPED, COMPANY_A1)
    );
    expect(ok.display_number).toBe('FXC-0001');
  });

  it('refuses a branch outside the session allowed_branch_ids', async () => {
    await withRolledBackTx(
      runtime,
      { ...AS_A, companyIds: [COMPANY_A1], branchIds: [FOREIGN_BRANCH] },
      async (tx) => {
        await expectSqlState(allocate(tx, BRANCH_SCOPED, COMPANY_A1, BRANCH_A1), '42501');
      }
    );
  });

  it('allocates for a branch the session does hold', async () => {
    const ok = await withRolledBackTx(
      runtime,
      { ...AS_A, companyIds: [COMPANY_A1], branchIds: [BRANCH_A1] },
      (tx) => allocate(tx, BRANCH_SCOPED, COMPANY_A1, BRANCH_A1)
    );
    expect(ok.display_number).toBe('FXB-0001');
  });
});

describe("P1-15 / another tenant's sequence is invisible and unallocatable", () => {
  it('the fixture row genuinely exists (admin read — not evidence, only setup)', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.number_sequences
        WHERE tenant_id = $1 AND sequence_code = $2`,
      [TENANT_B, TENANT_B_ONLY]
    );
    // Establishes that the invisibility proven below is RLS, not absence.
    expect(rows[0]?.n).toBe('1');
  });

  it("tenant A cannot see tenant B's sequence row", async () => {
    const visible = await withRolledBackTx(runtime, AS_A, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.number_sequences WHERE sequence_code = $1`,
        [TENANT_B_ONLY]
      );
      return rows[0]?.n;
    });
    expect(visible).toBe('0');
  });

  it("tenant A cannot allocate from tenant B's sequence", async () => {
    // Indistinguishable from "not configured" on purpose: the failure must not
    // confirm that another tenant holds this sequence.
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(allocate(tx, TENANT_B_ONLY), 'P0002');
    });
  });

  it("tenant B's own counter is untouched by tenant A's refused attempt", async () => {
    const b = await withRolledBackTx(runtime, AS_B, (tx) => allocate(tx, TENANT_B_ONLY));
    expect(b.display_number).toBe('FXT-0001');
  });
});

describe('P1-15 / rollback takes the allocation with it', () => {
  it('leaves next_value unchanged when the allocating transaction rolls back', async () => {
    const before = await readNextValue(ROLLBACK);
    const rolledBack = await withRolledBackTx(runtime, AS_A, (tx) => allocate(tx, ROLLBACK));
    const after = await readNextValue(ROLLBACK);

    expect(rolledBack.sequence_value).toBe(before);
    expect(after).toBe(before);

    // ...and the discarded value is handed to the next committed caller, so a
    // rollback produces no gap either.
    const committed = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, ROLLBACK));
    expect(committed.sequence_value).toBe(rolledBack.sequence_value);
  });
});

describe('P1-15 / concurrent allocation is serialised by the row lock', () => {
  it('two overlapping committed transactions get two different, consecutive values', async () => {
    // Genuinely concurrent, and deterministic: both transactions are open at
    // the same time and contend on the same row. The second allocation is
    // issued while the first still holds the FOR UPDATE lock, so it can only
    // complete after the first commits — which is asserted, not assumed.
    const before = await readNextValue(CONCURRENT);
    const a = await runtime.connect();
    const b = await runtime.connect();
    try {
      await a.query('BEGIN');
      await setContext(a, AS_A);
      await b.query('BEGIN');
      await setContext(b, AS_A);

      const first = await allocate(a, CONCURRENT);

      let secondSettled = false;
      const secondPromise = allocate(b, CONCURRENT).then((row) => {
        secondSettled = true;
        return row;
      });

      // The lock is real: B cannot have a number while A holds the row. A
      // false "still blocked" here would need B to be slower than 400ms for
      // an unrelated reason, which would understate — never overstate — the
      // guarantee, so this cannot turn into a spurious pass of a broken lock.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(secondSettled, 'the second allocator was not blocked by the row lock').toBe(false);

      await a.query('COMMIT');
      const second = await secondPromise;
      await b.query('COMMIT');

      expect(second.sequence_value).not.toBe(first.sequence_value);
      expect(Number(second.sequence_value)).toBe(Number(first.sequence_value) + 1);

      const after = await readNextValue(CONCURRENT);
      expect(Number(after) - Number(before)).toBe(2); // two commits, no gap, no loss
    } finally {
      a.release();
      b.release();
    }
  });
});

describe('P1-15 / period reset and rendering', () => {
  it('a yearly sequence with a stale period restarts at 1 and stamps the new period', async () => {
    // Fixture starts at next_value = 42 with current_period = '2020'.
    const period = new Date().toISOString().slice(0, 4); // YYYY, UTC — as the function computes it
    const allocated = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, YEARLY));

    expect(allocated.sequence_value).toBe('1'); // reset, not 42
    expect(allocated.display_number).toBe(`FXY-${period}-001`);

    const stamped = await withRolledBackTx(runtime, AS_A, async (tx) => {
      const { rows } = await tx.query<{ current_period: string | null; next_value: string }>(
        `SELECT current_period, next_value FROM shared.number_sequences WHERE sequence_code = $1`,
        [YEARLY]
      );
      return rows[0];
    });
    expect(stamped?.current_period).toBe(period);
    expect(stamped?.next_value).toBe('2');

    // The next allocation in the same period continues the new run.
    const next = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, YEARLY));
    expect(next.display_number).toBe(`FXY-${period}-002`);
  });
});

describe('P1-15 / rendered numbers widen past pad_width, never truncate', () => {
  it('pad_width 2 renders 99 as "99" and 100 as "100"', async () => {
    // Provisioned at the boundary: plain lpad('100', 2, '0') would return
    // '10', silently colliding with the number issued at value 10.
    const atBoundary = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, PAD));
    expect(atBoundary.sequence_value).toBe('99');
    expect(atBoundary.display_number).toBe('99');

    const past = await withCommittedTx(runtime, AS_A, (tx) => allocate(tx, PAD));
    expect(past.sequence_value).toBe('100');
    expect(past.display_number).toBe('100'); // widened, not truncated to '10'
  });
});

describe('P1-15 / the counter cannot be rewound', () => {
  it('refuses an UPDATE lowering next_value without a period change (23514)', async () => {
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE shared.number_sequences SET next_value = 1 WHERE sequence_code = $1`, [
          GUARD,
        ]),
        '23514'
      );
    });
  });

  it('refuses a faked period change on a never-resetting sequence (23514)', async () => {
    // The column grant covers current_period too, so the rewind bypass "invent
    // a period change" has to be closed explicitly. Own transaction: the probe
    // above already aborted its own.
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences
              SET next_value = 1, current_period = '2019'
            WHERE sequence_code = $1`,
          [GUARD]
        ),
        '23514'
      );
    });
  });

  it('permits raising next_value — the guard blocks regression, not administration', async () => {
    const affected = await withRolledBackTx(runtime, AS_A, async (tx) => {
      const result = await tx.query(
        `UPDATE shared.number_sequences SET next_value = next_value + 10 WHERE sequence_code = $1`,
        [GUARD]
      );
      return result.rowCount;
    });
    expect(affected).toBe(1);
  });
});

describe('P1-15 / the runtime grant shape on shared.number_sequences', () => {
  it('reports SELECT and a column-scoped UPDATE, and no table-level UPDATE', async () => {
    const privileges = await withRolledBackTx(runtime, AS_A, async (tx) => {
      const { rows } = await tx.query<{
        sel: boolean;
        upd_table: boolean;
        upd_next_value: boolean;
        upd_current_period: boolean;
        upd_prefix_template: boolean;
        ins: boolean;
        del: boolean;
        exec: boolean;
      }>(
        `SELECT has_table_privilege('shared.number_sequences', 'SELECT')  AS sel,
                has_table_privilege('shared.number_sequences', 'UPDATE')  AS upd_table,
                has_column_privilege('shared.number_sequences', 'next_value', 'UPDATE')
                  AS upd_next_value,
                has_column_privilege('shared.number_sequences', 'current_period', 'UPDATE')
                  AS upd_current_period,
                has_column_privilege('shared.number_sequences', 'prefix_template', 'UPDATE')
                  AS upd_prefix_template,
                has_table_privilege('shared.number_sequences', 'INSERT')  AS ins,
                has_table_privilege('shared.number_sequences', 'DELETE')  AS del,
                has_function_privilege('shared.next_display_number(text,uuid,uuid)', 'EXECUTE')
                  AS exec`
      );
      return rows[0];
    });

    expect(privileges?.sel).toBe(true);
    // FALSE by design: a column-scoped grant is not a table-level UPDATE, and
    // reading this as "the runtime role cannot update" would be wrong — the
    // allocator's UPDATE succeeds, as every allocation above demonstrates.
    expect(privileges?.upd_table).toBe(false);
    expect(privileges?.upd_next_value).toBe(true);
    expect(privileges?.upd_current_period).toBe(true);
    expect(privileges?.upd_prefix_template).toBe(false);
    expect(privileges?.ins).toBe(false);
    expect(privileges?.del).toBe(false);
    expect(privileges?.exec).toBe(true);
  });

  it('refuses an UPDATE of a column outside the grant (42501)', async () => {
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `UPDATE shared.number_sequences SET prefix_template = 'X-' WHERE sequence_code = $1`,
          [BASIC]
        ),
        '42501'
      );
    });
  });

  it('holds no INSERT on shared.number_sequences (42501)', async () => {
    // Provisioning is an administrative configuration action: a runtime caller
    // must not be able to invent a numbering run for itself.
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO shared.number_sequences (tenant_id, sequence_code, created_by)
           VALUES ($1, $2, $3)`,
          [TENANT_A, 'fx_p1_15_forged', USER_A]
        ),
        '42501'
      );
    });
  });

  it('holds no DELETE on shared.number_sequences (42501)', async () => {
    // Retiring a sequence would destroy allocation state; it is equally
    // administrative, and equally refused at the privilege layer.
    await withRolledBackTx(runtime, AS_A, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM shared.number_sequences WHERE sequence_code = $1`, [BASIC]),
        '42501'
      );
    });
  });
});
