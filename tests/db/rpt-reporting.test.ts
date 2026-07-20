/**
 * Phase 1-11 — rpt reporting: owner-only saved-filter RLS (M-rpt-1), published report
 * configuration version immutability, and saved-filter scope <= report scope (M-rpt-2 /
 * BR-RPT-001).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  TENANT_A,
  USER_A,
  USER_B,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  expectFail,
  seedReportConfig,
  seedReportVersion,
  seedSavedFilter,
} from './p1-11-helpers';

const admin = adminPool();
const runtime = runtimePool();
const setUser = (c: { query: Client['query'] }, u: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [u]);

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('p1-11 rpt reporting', () => {
  it('saved filters are visible and mutable ONLY to the owning user', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const config = await seedReportConfig(c, 'r1');
      const filter = await seedSavedFilter(c, { config, name: 'mine' });

      // a different user in the same tenant sees nothing and cannot mutate it.
      await setUser(c, USER_B);
      const seen = (
        await c.query(`SELECT count(*)::int n FROM rpt.saved_filters WHERE id=$1`, [filter])
      ).rows[0].n;
      expect(seen).toBe(0);
      const upd = await c.query(`UPDATE rpt.saved_filters SET name='hijack' WHERE id=$1`, [filter]);
      expect(upd.rowCount).toBe(0);

      // the owner still sees it.
      await setUser(c, USER_A);
      const own = (
        await c.query(`SELECT count(*)::int n FROM rpt.saved_filters WHERE id=$1`, [filter])
      ).rows[0].n;
      expect(own).toBe(1);
    });
  });

  it('makes a published report configuration version immutable (23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const config = await seedReportConfig(c, 'r2');
      const version = await seedReportVersion(c, config, { status: 'draft' });
      await c.query(`UPDATE rpt.report_configuration_versions SET status='published' WHERE id=$1`, [
        version,
      ]);
      const pub = (
        await c.query(
          `SELECT status, published_at FROM rpt.report_configuration_versions WHERE id=$1`,
          [version]
        )
      ).rows[0];
      expect(pub.status).toBe('published');
      expect(pub.published_at).not.toBeNull();
      await expectFail(
        c,
        '23514',
        `UPDATE rpt.report_configuration_versions SET parameter_schema='{"a":1}'::jsonb WHERE id=$1`,
        [version]
      );
      await expectFail(
        c,
        '23514',
        `UPDATE rpt.report_configuration_versions SET status='draft' WHERE id=$1`,
        [version]
      );
    });
  });

  it('rejects a saved filter whose scope exceeds the report scope (BR-RPT-001 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const branchReport = await seedReportConfig(c, 'r3', { scopeLevel: 'branch' });
      // equal scope is allowed...
      const ok = await seedSavedFilter(c, {
        config: branchReport,
        name: 'ok',
        scopeLevel: 'branch',
      });
      expect(ok).toBeTruthy();
      // ...but a wider (tenant) filter over a branch report is rejected.
      await expectFail(
        c,
        '23514',
        `INSERT INTO rpt.saved_filters (tenant_id, report_configuration_id, owner_user_id, name, scope_level, created_by)
         VALUES ($1,$2,$3,'toowide','tenant',$3)`,
        [TENANT_A, branchReport, USER_A]
      );
      // a company report tolerates branch/company filters but still rejects tenant.
      const companyReport = await seedReportConfig(c, 'r3c', { scopeLevel: 'company' });
      const okCompany = await seedSavedFilter(c, {
        config: companyReport,
        name: 'okc',
        scopeLevel: 'company',
      });
      expect(okCompany).toBeTruthy();
      await expectFail(
        c,
        '23514',
        `INSERT INTO rpt.saved_filters (tenant_id, report_configuration_id, owner_user_id, name, scope_level, created_by)
         VALUES ($1,$2,$3,'toowide2','tenant',$3)`,
        [TENANT_A, companyReport, USER_A]
      );
    });
  });
});
