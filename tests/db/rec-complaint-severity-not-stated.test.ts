/**
 * A concern recorded without a severity is "not stated"
 * (`20261004090000_rec_complaint_severity_not_stated.sql`; Owner decision of
 * 2026-10-03, README question 19).
 *
 * Proves, on the migrated schema:
 *   - `ck_complaints_severity` admits exactly `not_stated` and the four stated
 *     values, and the column stays NOT NULL;
 *   - an INSERT that omits the severity stores `not_stated`, never `medium`;
 *   - applying the migration rewrites no existing row — rehearsed by putting the
 *     earlier constraint and default back inside a rolled-back transaction,
 *     writing rows under them, then running the migration file itself;
 *   - row-level security on `rec.complaints` is unchanged: enabled, forced, the
 *     same three policies, and a tenant-B session still sees no tenant-A row.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261004090000_rec_complaint_severity_not_stated.sql'
);

const VEHICLE = 'a1000000-0000-4000-8000-0000000b3001';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_B };

let admin: Pool;
let runtime: Pool;
type Q = { query: Client['query'] };

const newVisit = async (c: Q): Promise<string> => {
  const walkIn = (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, VEHICLE, USER_A]
    )
  ).rows[0].id as string;
  return (
    await c.query(
      `INSERT INTO rec.reception_visits
         (tenant_id, company_id, branch_id, walk_in_id, vehicle_id, receiving_employee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, walkIn, VEHICLE, USER_A]
    )
  ).rows[0].id as string;
};

/** Inserts a complaint, naming the severity only when one is given. */
const insertComplaint = async (c: Q, visit: string, severity?: string | null): Promise<string> => {
  const withSeverity = severity !== undefined;
  const result = await c.query(
    `INSERT INTO rec.complaints
       (tenant_id, company_id, branch_id, reception_visit_id, category, created_by
        ${withSeverity ? ', severity' : ''})
     VALUES ($1, $2, $3, $4, 'mechanical', $5 ${withSeverity ? ', $6' : ''})
     RETURNING id`,
    withSeverity
      ? [TENANT_A, COMPANY_A1, BRANCH_A1, visit, USER_A, severity]
      : [TENANT_A, COMPANY_A1, BRANCH_A1, visit, USER_A]
  );
  return result.rows[0].id as string;
};

const severityOf = async (c: Q, id: string): Promise<string> =>
  (await c.query(`SELECT severity FROM rec.complaints WHERE id = $1`, [id])).rows[0]
    .severity as string;

/**
 * The migration's statements, comment lines removed, split on the semicolons
 * that end a statement — never on one inside a quoted literal (a doubled quote
 * toggles twice, so an escaped quote leaves the state as it was).
 */
function migrationStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n');
  const statements: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of sql) {
    if (character === "'") quoted = !quoted;
    if (character === ';' && !quoted) {
      statements.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  statements.push(current);
  return statements
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1, $2, 'RECSEVVIN1', 'ice', 'active', $3)`,
    [VEHICLE, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('rec.complaints.severity — "not stated" instead of a substituted medium', () => {
  it('admits exactly not_stated and the four stated values, and never NULL', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      for (const value of ['not_stated', 'low', 'medium', 'high', 'critical']) {
        const id = await insertComplaint(c, visit, value);
        expect(await severityOf(c, id)).toBe(value);
      }
    });
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      await expectSqlState(insertComplaint(c, visit, 'unknown'), '23514');
    });
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      await expectSqlState(insertComplaint(c, visit, null), '23502');
    });
  });

  it('stores not_stated when a writer omits the severity', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const id = await insertComplaint(c, visit);
      expect(await severityOf(c, id)).toBe('not_stated');
    });
    const column = await admin.query<{ column_default: string; is_nullable: string }>(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = 'rec' AND table_name = 'complaints' AND column_name = 'severity'`
    );
    expect(column.rows).toEqual([{ column_default: "'not_stated'::text", is_nullable: 'NO' }]);
  });

  it('rewrites no existing row: rows written under the earlier rule keep their values', async () => {
    const statements = migrationStatements();
    // Structure and documentation only — no statement writes a row.
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(ALTER TABLE rec\.complaints |COMMENT ON COLUMN rec\.complaints\.)/
      );
    }

    // The rehearsal runs as the migration role, inside a transaction that is
    // always rolled back, so the schema the other suites see never changes.
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctxA.tenantId]);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [ctxA.userId]);
      await client.query(`ALTER TABLE rec.complaints DROP CONSTRAINT ck_complaints_severity`);
      await client.query(
        `ALTER TABLE rec.complaints ADD CONSTRAINT ck_complaints_severity
           CHECK (severity IN ('low', 'medium', 'high', 'critical'))`
      );
      await client.query(`ALTER TABLE rec.complaints ALTER COLUMN severity SET DEFAULT 'medium'`);

      const visit = await newVisit(client);
      const defaulted = await insertComplaint(client, visit);
      const stated = await insertComplaint(client, visit, 'high');
      expect(await severityOf(client, defaulted)).toBe('medium');

      for (const statement of statements) await client.query(statement);

      // The row the old default filled in stays 'medium': it cannot be told
      // apart from a stated medium, so it is not guessed at.
      expect(await severityOf(client, defaulted)).toBe('medium');
      expect(await severityOf(client, stated)).toBe('high');
      const after = await insertComplaint(client, visit);
      expect(await severityOf(client, after)).toBe('not_stated');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('leaves row-level security exactly as it was', async () => {
    const table = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'rec' AND c.relname = 'complaints'`
    );
    expect(table.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await admin.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'rec' AND tablename = 'complaints' ORDER BY policyname`
    );
    expect(policies.rows.map((row) => row.policyname)).toEqual([
      'ins_complaints_scope',
      'sel_complaints_scope',
      'upd_complaints_scope',
    ]);

    // A not-stated complaint of tenant A is invisible to a tenant-B session.
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctxA.tenantId]);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [ctxA.userId]);
      const visit = await newVisit(client);
      const id = await insertComplaint(client, visit);
      expect(await severityOf(client, id)).toBe('not_stated');

      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctxB.tenantId]);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [ctxB.userId]);
      const seen = await client.query(`SELECT id FROM rec.complaints WHERE id = $1`, [id]);
      expect(seen.rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
