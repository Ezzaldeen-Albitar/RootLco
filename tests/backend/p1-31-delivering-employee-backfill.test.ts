/**
 * P1-31 P-17 — the legacy delivering-employee mint, as an operator command.
 *
 * `scripts/platform/backfill-delivering-employee-identity.mjs` carries the half of
 * the slice a migration may not: the row writes. `migration-replay-checks.mjs`
 * refuses a top-level `INSERT INTO org.employees` in any migration, and it is
 * right to — such a statement is indistinguishable from one that ships fabricated
 * people — so migration 141 creates structure only and this command mints, stamps,
 * lists and validates.
 *
 * ## What is proved WHERE
 *
 * Its behaviour on real legacy rows — one employee per resolvable value, the
 * snapshot stamped, an unresolvable value left untouched and listed, and the
 * foreign key validated in the first case and refused in the second — is proved at
 * the database in `tests/db/org-employees.test.ts` obligation 5, driving the same
 * exported core this file imports. Repeating it here would prove it twice and
 * nothing new.
 *
 * What this file adds is the MECHANISM, on the pattern of
 * `p1-31-tenant-administrator-bundle-backfill.test.ts`:
 *
 *   DEB-1  the command cannot rewrite history: no statement it can execute is a
 *          DELETE, a TRUNCATE or a DROP, its single UPDATE can only FILL a NULL
 *          snapshot, and it never validates the key without saying why it may
 *   DEB-2  the input gate is real: the environment must be named exactly, the
 *          confirmation must match the operator, and the scope must be
 *          unambiguous — every refusal happens before a connection is opened
 *   DEB-3  the authority gate is real: an absent account and an account holding
 *          no unrevoked `platform.organization.provision` grant are both refused,
 *          and the code it gates on is one the catalogue already carries — none is
 *          minted for this command
 *
 * Nothing here writes a row. DEB-3 reads the catalogue and one fixture account on
 * the admin connection; the fixtures are provisioned idempotently and no fixture
 * is removed, because another suite on the shared database may be using them.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANT_A, USER_A, adminPool, ensureTestLogins } from './helpers';
import { ensureOrgFixtures } from '../db/helpers';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import {
  COUNT_UNRESOLVED_EVERYWHERE,
  COUNT_UNSTAMPED,
  MINT_EMPLOYEES,
  RECORD_UNRESOLVED,
  REQUIRED_PLATFORM_CODE,
  STAMP_SNAPSHOTS,
  TARGET_CONSTRAINT,
  readBackfillInput,
  resolveOperator,
} from '../../scripts/platform/backfill-delivering-employee-identity.mjs';

const COMMAND_PATH = join(
  REPOSITORY_ROOT,
  'scripts',
  'platform',
  'backfill-delivering-employee-identity.mjs'
);

/** A valid environment for the input gate — never a live target of this suite. */
const ENV_BASE = {
  ROOTLCO_ENV: 'local-acceptance',
  BACKFILL_OPERATOR_EMAIL: 'operator@fixture.test',
} as const;

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
}, 240_000);

afterAll(async () => {
  if (admin) await admin.end();
});

describe('P1-31 P-17 — the operator command cannot rewrite history (DEB-1)', () => {
  it('issues no DELETE, no TRUNCATE and no DROP, and exactly one UPDATE', () => {
    const source = readFileSync(COMMAND_PATH, 'utf8');
    // Every statement the command can execute: the exported constants plus every
    // literal handed to `client.query`. A destructive verb in a comment is not a
    // statement, so prose is not inspected — only SQL is.
    const inline = [...source.matchAll(/client\.query\(\s*(`[^`]*`|'[^']*')/g)].map((match) =>
      (match[1] ?? '').replace(/^[`']|[`']$/g, '').trim()
    );
    expect(inline.length).toBeGreaterThan(4);
    const statements = [
      MINT_EMPLOYEES,
      COUNT_UNSTAMPED,
      STAMP_SNAPSHOTS,
      RECORD_UNRESOLVED,
      COUNT_UNRESOLVED_EVERYWHERE,
      ...inline,
    ];
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDELETE\b/i);
      expect(statement).not.toMatch(/\bTRUNCATE\b/i);
      expect(statement).not.toMatch(/\bDROP\b/i);
      expect(statement).not.toMatch(/\bREVOKE\b/i);
    }
    const updates = statements.filter((statement) => /\bUPDATE\b/i.test(statement));
    expect(updates).toEqual([STAMP_SNAPSHOTS]);
    // It can only ever FILL a gap: a snapshot already taken is historical evidence
    // and is never recomputed, which is what the immutability guard exists to say.
    expect(STAMP_SNAPSHOTS).toMatch(/delivering_employee_display_name IS NULL/);
  });

  it('mints only what an account of the same tenant already identifies', () => {
    // The join IS the no-invention rule. A legacy value naming nobody produces no
    // row here; it is reported by RECORD_UNRESOLVED instead.
    expect(MINT_EMPLOYEES).toMatch(/JOIN iam\.user_accounts AS account/);
    expect(MINT_EMPLOYEES).toMatch(/account\.tenant_id = legacy\.tenant_id/);
    expect(MINT_EMPLOYEES).toContain("'inactive'");
    // Idempotent by construction rather than by convention.
    expect(MINT_EMPLOYEES).toMatch(/NOT EXISTS/);
    expect(RECORD_UNRESOLVED).toMatch(/ON CONFLICT \(tenant_id, delivery_id\) DO NOTHING/);
  });

  it('re-enables the immutability guard on every path, including a failing one', () => {
    const source = readFileSync(COMMAND_PATH, 'utf8');
    // The stamp is the one statement the guard would refuse, so the guard is
    // disabled for it — inside the tenant transaction, which holds the table lock,
    // so no other session ever writes it unguarded. The re-enable is in a `finally`
    // and the disable is conditional on there being a gap at all.
    const disable = source.indexOf('DISABLE TRIGGER tg_delivery_records_immutable');
    const enable = source.indexOf('ENABLE TRIGGER tg_delivery_records_immutable', disable + 1);
    expect(disable).toBeGreaterThan(-1);
    expect(enable).toBeGreaterThan(disable);
    // The re-enable is reached however the stamp ends, because a `finally` opens
    // between the two.
    expect(source.slice(disable, enable).includes('} finally {')).toBe(true);
    // And the pair appears once: a second, unbalanced disable would be a hole.
    expect(source.indexOf('DISABLE TRIGGER tg_delivery_records_immutable', disable + 1)).toBe(-1);
    expect(source.indexOf('ENABLE TRIGGER tg_delivery_records_immutable', enable + 1)).toBe(-1);
  });

  it('names the constraint it may validate, and validates nothing while anything is unresolved', () => {
    expect(TARGET_CONSTRAINT).toBe('fk_delivery_records_delivering_employee');
    // The entitlement query counts unresolved rows in EVERY tenant, not only the
    // ones a scoped run named: validation is a claim about the whole table.
    expect(COUNT_UNRESOLVED_EVERYWHERE).not.toMatch(/tenant_id = \$1/);
    expect(COUNT_UNRESOLVED_EVERYWHERE).toMatch(/NOT EXISTS/);
  });
});

describe('P1-31 P-17 — the input gate refuses before it connects (DEB-2)', () => {
  const args = ['--confirm', ENV_BASE.BACKFILL_OPERATOR_EMAIL, '--all'];

  it('accepts a fully named run', () => {
    const input = readBackfillInput({ ...ENV_BASE }, args);
    expect(input.environment).toBe('local-acceptance');
    expect(input.all).toBe(true);
    expect(input.dryRun).toBe(false);
    expect(input.operator.email).toBe(ENV_BASE.BACKFILL_OPERATOR_EMAIL);
  });

  it('refuses an unnamed or unrecognised environment', () => {
    expect(() =>
      readBackfillInput({ BACKFILL_OPERATOR_EMAIL: ENV_BASE.BACKFILL_OPERATOR_EMAIL }, args)
    ).toThrow(/ROOTLCO_ENV/);
    expect(() => readBackfillInput({ ...ENV_BASE, ROOTLCO_ENV: 'production' }, args)).toThrow(
      /ROOTLCO_ENV/
    );
  });

  it('refuses a confirmation that does not match the operator', () => {
    expect(() =>
      readBackfillInput({ ...ENV_BASE }, ['--confirm', 'someone.else@fixture.test', '--all'])
    ).toThrow(/--confirm/);
  });

  it('refuses an ambiguous or missing scope', () => {
    expect(() => readBackfillInput({ ...ENV_BASE }, [...args, '--tenant', randomUUID()])).toThrow(
      /never both/
    );
    expect(() =>
      readBackfillInput({ ...ENV_BASE }, ['--confirm', ENV_BASE.BACKFILL_OPERATOR_EMAIL])
    ).toThrow(/Missing scope/);
  });
});

describe('P1-31 P-17 — the authority gate is real (DEB-3)', () => {
  it('gates on a platform code the catalogue already carries, and mints none', async () => {
    expect(REQUIRED_PLATFORM_CODE).toBe('platform.organization.provision');
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM iam.permissions WHERE permission_code = $1',
      [REQUIRED_PLATFORM_CODE]
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses an account that does not exist', async () => {
    await expect(
      resolveOperator(admin, `absent_${randomUUID()}@fixture.test`)
    ).rejects.toMatchObject({ exitCode: 4 });
  });

  it('refuses a real account that holds no unrevoked grant of that code', async () => {
    const { rows } = await admin.query<{ email: string }>(
      `SELECT email FROM iam.user_accounts WHERE id = $1 AND tenant_id = $2`,
      [USER_A, TENANT_A]
    );
    const email = rows[0]?.email;
    expect(email).toBeTruthy();
    // The premise, measured rather than assumed: this fixture principal is an
    // ordinary tenant account, so its refusal below is the gate and not an accident
    // of the fixture data.
    const { rows: grants } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM iam.platform_grants
        WHERE account_id = $1 AND permission_code = $2 AND revoked_at IS NULL`,
      [USER_A, REQUIRED_PLATFORM_CODE]
    );
    expect(grants[0]?.n).toBe(0);
    await expect(resolveOperator(admin, String(email).toLowerCase())).rejects.toMatchObject({
      exitCode: 4,
    });
  });
});
