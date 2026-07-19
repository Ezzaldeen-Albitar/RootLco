/**
 * Phase 1-8 Appointment configuration catalogs (dual-scope).
 *
 * Proves the platform/tenant dual-scope contract for apt.appointment_types,
 * apt.source_channels, apt.cancellation_reasons: platform-or-tenant scope
 * coherence, per-scope code uniqueness with cross-scope reuse allowed, immutable
 * scope/code, platform-row visibility to every tenant with tenant rows isolated,
 * platform rows unclaimable by a tenant, and app_readonly read-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

const CATALOGS = ['appointment_types', 'source_channels', 'cancellation_reasons'] as const;
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

const insTenant = (t: string, code: string, tenant = TENANT_A) =>
  `INSERT INTO apt.${t} (scope, tenant_id, code, name, created_by)
   VALUES ('tenant','${tenant}','${code}','${code} name','${USER_A}') RETURNING id`;
const insPlatform = (t: string, code: string) =>
  `INSERT INTO apt.${t} (scope, tenant_id, code, name, created_by)
   VALUES ('platform', NULL, '${code}', '${code} name', '${USER_A}')`;

describe.each(CATALOGS)('apt.%s — dual-scope', (t) => {
  it('accepts a tenant row (runtime) and rejects incoherent scope/tenant combos (CHECK)', async () => {
    // Runtime WITH CHECK enforces scope='tenant' + own tenant; a valid tenant row commits.
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect((await c.query(insTenant(t, 'fx_a1'))).rows).toHaveLength(1);
    });
    // The scope/tenant coherence CHECK is a structural constraint. Under RLS the
    // runtime WITH CHECK would mask it with 42501, so it is proven via admin
    // (BYPASSRLS) where the CHECK (23514) is the sole gate.
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `INSERT INTO apt.${t} (scope, tenant_id, code, name, created_by) VALUES ('tenant',NULL,'fx_bad','x','${USER_A}')`
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `INSERT INTO apt.${t} (scope, tenant_id, code, name, created_by) VALUES ('platform','${TENANT_A}','fx_bad2','x','${USER_A}')`
        ),
        '23514'
      );
    });
  });

  it('enforces per-scope code uniqueness but allows the same code across scopes', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(insPlatform(t, 'fx_dup'));
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insPlatform(t, 'fx_dup')), '23505'); // platform dup
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // same code as a tenant row is allowed (different scope)
      expect((await c.query(insTenant(t, 'fx_dup'))).rows).toHaveLength(1);
      // ...but a second tenant row with the same code+tenant collides
      await c.query('SAVEPOINT s2');
      await expectSqlState(c.query(insTenant(t, 'fx_dup')), '23505');
      await c.query('ROLLBACK TO SAVEPOINT s2');
    });
  });

  it('freezes scope and code', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insTenant(t, 'fx_imm'))).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE apt.${t} SET code='fx_imm2' WHERE id=$1`, [id]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query('SAVEPOINT s2');
      await expectSqlState(
        c.query(`UPDATE apt.${t} SET scope='platform' WHERE id=$1`, [id]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s2');
      // name is mutable
      expect((await c.query(`UPDATE apt.${t} SET name='new' WHERE id=$1`, [id])).rowCount).toBe(1);
    });
  });

  it('shows platform rows to every tenant but isolates tenant rows', async () => {
    // committed platform + tenant-A rows
    await admin.query(insPlatform(t, 'fx_vis'));
    await admin.query(insTenant(t, 'fx_vis_a', TENANT_A));
    try {
      await withRolledBackTx(runtime, ctxB, async (c) => {
        const plat = await c.query(
          `SELECT count(*)::int n FROM apt.${t} WHERE code='fx_vis' AND scope='platform'`
        );
        expect(plat.rows[0].n).toBe(1); // platform visible to tenant B
        const other = await c.query(`SELECT count(*)::int n FROM apt.${t} WHERE code='fx_vis_a'`);
        expect(other.rows[0].n).toBe(0); // tenant-A row hidden from tenant B
      });
      // a tenant cannot claim/create a platform row
      await withRolledBackTx(runtime, ctxA, async (c) => {
        await expectSqlState(c.query(insPlatform(t, 'fx_claim')), '42501');
      });
    } finally {
      await admin.query(`DELETE FROM apt.${t} WHERE code IN ('fx_vis','fx_vis_a')`);
    }
  });

  it('denies app_readonly writes', async () => {
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(c.query(insTenant(t, 'fx_ro')), '42501');
    });
  });
});
