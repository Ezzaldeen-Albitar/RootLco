/**
 * P1-32-PRE-OD-FD16B — frozen report snapshots and distinguished restatements
 * (Owner decision D16, end-of-period reporting, part 2), the database half
 * (migration `20261008100000_rpt_report_snapshots.sql`).
 *
 * Every case is written so it FAILS when the control it names is removed:
 *
 *  - APPEND-ONLY: no application role holds UPDATE or DELETE, and the guard
 *    refuses an UPDATE even from a role that bypasses every grant.
 *  - RLS: a row is visible only in its tenant, only with `rpt.report.read` AND
 *    every frozen dataset code, each held in the row's own branch.
 *  - ONE ORIGINAL per scope, report, period and filters; ONE RESTATEMENT per
 *    snapshot, so the chain is linear; a restatement carries a non-blank reason
 *    and a difference, and covers the same report, period and filters.
 *  - STAMPS: the saver, the time, the row count and the digests are the
 *    database's, whatever the application role supplied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  TENANT_A,
  TENANT_B,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();
const readonly = readonlyPool();

/** A second branch of the fixture company, for the branch-scope cases. */
const BRANCH_S2 = 'd16b0000-0000-4000-8000-0000000000b2';

const SAVER = 'd16b0000-0000-4000-8000-000000000011';
const READER = 'd16b0000-0000-4000-8000-000000000012';
const NO_FINANCE = 'd16b0000-0000-4000-8000-000000000013';
const NO_REPORT_READ = 'd16b0000-0000-4000-8000-000000000014';
const SCOPED_ELSEWHERE = 'd16b0000-0000-4000-8000-000000000015';
const READER_NO_EXPORT = READER;

const ROLE_SAVER = 'd16b0000-0000-4000-8000-000000000021';
const ROLE_READER = 'd16b0000-0000-4000-8000-000000000022';
const ROLE_NO_FINANCE = 'd16b0000-0000-4000-8000-000000000023';
const ROLE_NO_REPORT_READ = 'd16b0000-0000-4000-8000-000000000024';
const SCOPED_GRANT = 'd16b0000-0000-4000-8000-000000000031';

const ROLES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  [ROLE_SAVER, 'd16b_saver', ['rpt.report.read', 'sal.finance.view', 'rpt.export']],
  [ROLE_READER, 'd16b_reader', ['rpt.report.read', 'sal.finance.view']],
  [ROLE_NO_FINANCE, 'd16b_no_finance', ['rpt.report.read', 'rpt.export']],
  [ROLE_NO_REPORT_READ, 'd16b_no_report_read', ['sal.finance.view', 'rpt.export']],
];

const ctx = (userId: string) => ({ tenantId: TENANT_A, userId });

const ROWS = JSON.stringify([
  {
    cells: [
      { key: 'document', label: 'INV-000001', value: 'd16b0000-0000-4000-8000-0000000000f1' },
    ],
  },
  {
    cells: [
      { key: 'document', label: 'RCP-000001', value: 'd16b0000-0000-4000-8000-0000000000f2' },
    ],
  },
]);
const COLUMNS = JSON.stringify([{ key: 'document', kind: 'reference' }]);

interface SnapshotInput {
  readonly branchId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly restates?: string | null;
  readonly reason?: string | null;
  readonly difference?: string | null;
  readonly generatedBy?: string;
  readonly generatedAt?: string;
  readonly rowsDigest?: string;
  readonly rowCount?: number;
}

/** One INSERT as the caller's own transaction would write it; returns the id. */
async function insertSnapshot(c: Q, input: SnapshotInput = {}): Promise<string> {
  const branchId = input.branchId ?? BRANCH_A1;
  const from = input.from ?? '2026-05-01';
  const to = input.to ?? '2026-06-01';
  const parameters = JSON.stringify({ companyId: COMPANY_A1, branchId, from, to });
  const result = await c.query<{ id: string }>(
    `INSERT INTO rpt.report_snapshots
       (tenant_id, company_id, branch_id, report_code, period_from, period_to_exclusive,
        timezone_name, as_of, parameters, parameters_digest, required_permissions, columns,
        rows, row_count, rows_digest, generated_at, generated_by, restates_snapshot_id,
        restatement_reason, difference, created_by)
     VALUES ($1,$2,$3,'invoice_payment_summary',$4::date,$5::date,'Asia/Amman',
             '2026-06-01T00:00:00Z',$6::jsonb,$7,ARRAY['sal.finance.view'],$8::jsonb,$9::jsonb,
             $10,$11,COALESCE($12::timestamptz, now()),$13,$14,$15,$16::jsonb,$13)
     RETURNING id`,
    [
      TENANT_A,
      COMPANY_A1,
      branchId,
      from,
      to,
      parameters,
      '0'.repeat(64),
      COLUMNS,
      ROWS,
      input.rowCount ?? 2,
      input.rowsDigest ?? '0'.repeat(64),
      input.generatedAt ?? null,
      input.generatedBy ?? SAVER,
      input.restates ?? null,
      input.reason ?? null,
      input.difference ?? null,
    ]
  );
  return result.rows[0]?.id ?? '';
}

/** The SQLSTATE a statement fails with, inside a savepoint; null when it succeeds. */
async function sqlState(c: Q, run: () => Promise<unknown>): Promise<string | null> {
  await c.query('SAVEPOINT sp_snapshot');
  try {
    await run();
    await c.query('RELEASE SAVEPOINT sp_snapshot');
    return null;
  } catch (error) {
    await c.query('ROLLBACK TO SAVEPOINT sp_snapshot');
    return (error as { code?: string }).code ?? 'unknown';
  }
}

const DIFFERENCE = JSON.stringify({ rowsAdded: 0, rowsRemoved: 0, rowsChanged: 0, totals: [] });

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     SELECT $1, tenant_id, company_id, 'd16b_s2', 'FD16B second branch', timezone_name, $2
       FROM org.branches WHERE id = $3
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_S2, USER_A, BRANCH_A1]
  );
  for (const [id, subject] of [
    [SAVER, 'd16b-saver'],
    [READER, 'd16b-reader'],
    [NO_FINANCE, 'd16b-no-finance'],
    [NO_REPORT_READ, 'd16b-no-report-read'],
    [SCOPED_ELSEWHERE, 'd16b-scoped'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,'fixture',$3,$3||'@fixture.test','FD16B fixture','active',$4)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, subject, USER_A]
    );
  }
  for (const [roleId, code, permissions] of ROLES) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
       VALUES ($1,$2,$3,'FD16B fixture',$4) ON CONFLICT (id) DO NOTHING`,
      [roleId, TENANT_A, code, USER_A]
    );
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p WHERE p.permission_code = ANY($4)
       ON CONFLICT DO NOTHING`,
      [TENANT_A, roleId, USER_A, [...permissions]]
    );
  }
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    for (const [userId, roleId] of [
      [SAVER, ROLE_SAVER],
      [READER, ROLE_READER],
      [NO_FINANCE, ROLE_NO_FINANCE],
      [NO_REPORT_READ, ROLE_NO_REPORT_READ],
    ] as const) {
      await client.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         SELECT $1,$2,$3,'unrestricted',$4,$4
          WHERE NOT EXISTS (SELECT 1 FROM iam.role_grants WHERE tenant_id=$1 AND user_id=$2 AND role_id=$3)`,
        [TENANT_A, userId, roleId, USER_A]
      );
    }
    // Both codes, but only in the OTHER branch.
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5) ON CONFLICT (id) DO NOTHING`,
      [SCOPED_GRANT, TENANT_A, SCOPED_ELSEWHERE, ROLE_READER, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       SELECT $1,$2,'branch',$3,$4,$5
        WHERE NOT EXISTS (SELECT 1 FROM iam.grant_scopes WHERE tenant_id=$1 AND grant_id=$2)`,
      [TENANT_A, SCOPED_GRANT, COMPANY_A1, BRANCH_S2, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('rpt.report_snapshots is append-only', () => {
  it('grants no UPDATE or DELETE to any application role', async () => {
    const { rows } = await admin.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'rpt' AND table_name = 'report_snapshots'
          AND grantee LIKE 'app\\_%' ORDER BY 1, 2`
    );
    expect(rows.map((r) => `${String(r.grantee)}:${String(r.privilege_type)}`)).toEqual([
      'app_readonly:SELECT',
      'app_runtime:INSERT',
      'app_runtime:SELECT',
    ]);
  });

  it('refuses UPDATE and DELETE on the request path, and UPDATE even from a superuser', async () => {
    await withRolledBackTx(runtime, ctx(SAVER), async (c) => {
      const id = await insertSnapshot(c);
      expect(
        await sqlState(c, () =>
          c.query(`UPDATE rpt.report_snapshots SET rows = '[]'::jsonb WHERE id = $1`, [id])
        )
      ).toBe('42501');
      expect(
        await sqlState(c, () => c.query(`DELETE FROM rpt.report_snapshots WHERE id = $1`, [id]))
      ).toBe('42501');
    });
    await withRolledBackTx(admin, ctx(SAVER), async (c) => {
      const id = await insertSnapshot(c, { generatedBy: SAVER });
      expect(
        await sqlState(c, () =>
          c.query(`UPDATE rpt.report_snapshots SET restatement_reason = NULL WHERE id = $1`, [id])
        )
      ).toBe('23514');
    });
  });
});

describe('the database stamps what the writer must not choose', () => {
  it('stamps the saver, the time, the row count and the digests over what the runtime sent', async () => {
    await withRolledBackTx(runtime, ctx(SAVER), async (c) => {
      const id = await insertSnapshot(c, {
        generatedBy: READER,
        generatedAt: '2020-01-01T00:00:00Z',
        rowCount: 99,
        rowsDigest: 'f'.repeat(64),
      });
      const row = (
        await c.query<{
          generated_by: string;
          created_by: string;
          fresh: boolean;
          row_count: number;
          rows_ok: boolean;
          parameters_ok: boolean;
        }>(
          `SELECT generated_by, created_by, generated_at = now() AS fresh, row_count,
                  rows_digest = encode(sha256(convert_to(rows::text, 'UTF8')), 'hex') AS rows_ok,
                  parameters_digest = encode(sha256(convert_to(parameters::text, 'UTF8')), 'hex')
                    AS parameters_ok
             FROM rpt.report_snapshots WHERE id = $1`,
          [id]
        )
      ).rows[0];
      expect(row).toEqual({
        generated_by: SAVER,
        created_by: SAVER,
        fresh: true,
        row_count: 2,
        rows_ok: true,
        parameters_ok: true,
      });
    });
  });

  it('refuses a snapshot without a signed-in person on the request path', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      expect(await sqlState(c, () => insertSnapshot(c))).toBe('42501');
    });
  });
});

describe('row-level security', () => {
  async function visible(userId: string, id: string, pool = runtime): Promise<number> {
    return withRolledBackTx(pool, ctx(userId), async (c) =>
      Number(
        (await c.query(`SELECT count(*)::int n FROM rpt.report_snapshots WHERE id=$1`, [id]))
          .rows[0].n
      )
    );
  }

  it('shows a snapshot only with rpt.report.read and every frozen code, in its branch and tenant', async () => {
    const client = await runtime.connect();
    let id = '';
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`,
        [TENANT_A, SAVER]
      );
      id = await insertSnapshot(client, { from: '2026-01-01', to: '2026-02-01' });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await visible(SAVER, id)).toBe(1);
    expect(await visible(READER, id)).toBe(1);
    // The frozen dataset code is missing.
    expect(await visible(NO_FINANCE, id)).toBe(0);
    // rpt.report.read is missing.
    expect(await visible(NO_REPORT_READ, id)).toBe(0);
    // Both codes, in the other branch only.
    expect(await visible(SCOPED_ELSEWHERE, id)).toBe(0);
    // Another tenant.
    const other = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_B, userId: SAVER },
      async (c) =>
        Number(
          (await c.query(`SELECT count(*)::int n FROM rpt.report_snapshots WHERE id=$1`, [id]))
            .rows[0].n
        )
    );
    expect(other).toBe(0);
    // A session with no context.
    const anonymous = await withRolledBackTx(runtime, {}, async (c) =>
      Number(
        (await c.query(`SELECT count(*)::int n FROM rpt.report_snapshots WHERE id=$1`, [id]))
          .rows[0].n
      )
    );
    expect(anonymous).toBe(0);
    // The read-only role is held to the same rule.
    expect(await visible(READER, id, readonly)).toBe(1);
    expect(await visible(NO_FINANCE, id, readonly)).toBe(0);
  });

  it('refuses a snapshot from a caller without rpt.export or without the frozen codes', async () => {
    for (const userId of [READER_NO_EXPORT, NO_FINANCE, NO_REPORT_READ]) {
      await withRolledBackTx(runtime, ctx(userId), async (c) => {
        expect(await sqlState(c, () => insertSnapshot(c)), userId).toBe('42501');
      });
    }
    await withRolledBackTx(runtime, ctx(SCOPED_ELSEWHERE), async (c) => {
      expect(await sqlState(c, () => insertSnapshot(c))).toBe('42501');
    });
  });
});

describe('one original, and a linear chain of reasoned restatements', () => {
  it('admits one original per scope, report, period and filters', async () => {
    await withRolledBackTx(runtime, ctx(SAVER), async (c) => {
      await insertSnapshot(c, { from: '2026-03-01', to: '2026-04-01' });
      expect(
        await sqlState(c, () => insertSnapshot(c, { from: '2026-03-01', to: '2026-04-01' }))
      ).toBe('23505');
      // Another period is another original.
      expect(
        await sqlState(c, () => insertSnapshot(c, { from: '2026-03-01', to: '2026-03-15' }))
      ).toBeNull();
    });
  });

  it('admits one restatement per snapshot, so the latest is the one nothing restates', async () => {
    await withRolledBackTx(runtime, ctx(SAVER), async (c) => {
      const original = await insertSnapshot(c);
      const first = await insertSnapshot(c, {
        restates: original,
        reason: 'A late receipt was found',
        difference: DIFFERENCE,
      });
      expect(first).not.toBe('');
      // The original has been restated already: a second restatement of it is refused.
      expect(
        await sqlState(c, () =>
          insertSnapshot(c, { restates: original, reason: 'Again', difference: DIFFERENCE })
        )
      ).toBe('23505');
      // The latest may be restated.
      expect(
        await sqlState(c, () =>
          insertSnapshot(c, { restates: first, reason: 'Corrected twice', difference: DIFFERENCE })
        )
      ).toBeNull();
    });
  });

  it('requires a non-blank reason and a difference exactly on a restatement', async () => {
    await withRolledBackTx(runtime, ctx(SAVER), async (c) => {
      const original = await insertSnapshot(c);
      for (const reason of [null, '   ']) {
        expect(
          await sqlState(c, () =>
            insertSnapshot(c, { restates: original, reason, difference: DIFFERENCE })
          ),
          String(reason)
        ).toBe('23514');
      }
      expect(
        await sqlState(c, () =>
          insertSnapshot(c, { restates: original, reason: 'No difference', difference: null })
        )
      ).toBe('23514');
      // A reason or a difference on an original is refused too.
      expect(
        await sqlState(c, () =>
          insertSnapshot(c, { from: '2026-07-01', to: '2026-08-01', reason: 'Not a restatement' })
        )
      ).toBe('23514');
      expect(
        await sqlState(c, () =>
          insertSnapshot(c, { from: '2026-07-01', to: '2026-08-01', difference: DIFFERENCE })
        )
      ).toBe('23514');
    });
  });

  it('refuses a restatement of another period', async () => {
    await withRolledBackTx(runtime, ctx(SAVER), async (c) => {
      const original = await insertSnapshot(c, { from: '2026-09-01', to: '2026-10-01' });
      expect(
        await sqlState(c, () =>
          insertSnapshot(c, {
            from: '2026-09-01',
            to: '2026-09-15',
            restates: original,
            reason: 'Wrong period',
            difference: DIFFERENCE,
          })
        )
      ).toBe('23514');
    });
  });
});
