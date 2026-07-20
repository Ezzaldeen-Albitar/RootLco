/**
 * Phase 1-10 — Service catalog & versioning (FR-SVC-001/002, BR-SVC-001).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  TENANT_A,
  USER_A,
} from './helpers';
import { seedService, expectFail } from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('svc catalog & versioning', () => {
  it('rejects a self-parent and a category cycle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const a = (
        await c.query(
          `INSERT INTO svc.service_categories (tenant_id, code, name, created_by) VALUES ($1,'cat_a','A',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      const b = (
        await c.query(
          `INSERT INTO svc.service_categories (tenant_id, parent_category_id, code, name, created_by) VALUES ($1,$2,'cat_b','B',$3) RETURNING id`,
          [TENANT_A, a, USER_A]
        )
      ).rows[0].id;
      await expectFail(
        c,
        '23514',
        `UPDATE svc.service_categories SET parent_category_id=$1 WHERE id=$1`,
        [a]
      );
      await expectFail(
        c,
        '23514',
        `UPDATE svc.service_categories SET parent_category_id=$1 WHERE id=$2`,
        [b, a]
      );
    });
  });

  it('keeps a stable service identity and rejects a duplicate active code', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'ident');
      const before = (await c.query(`SELECT service_code FROM svc.services WHERE id=$1`, [service]))
        .rows[0].service_code;
      await c.query(`UPDATE svc.services SET name='Renamed' WHERE id=$1`, [service]);
      const after = (await c.query(`SELECT service_code FROM svc.services WHERE id=$1`, [service]))
        .rows[0].service_code;
      expect(after).toBe(before);
      await expectFail(c, '23514', `UPDATE svc.services SET service_code='OTHER' WHERE id=$1`, [
        service,
      ]);
      await expectFail(
        c,
        '23505',
        `INSERT INTO svc.services (tenant_id, service_category_id, service_code, name, created_by)
         SELECT tenant_id, service_category_id, service_code, 'dup', created_by FROM svc.services WHERE id=$1`,
        [service]
      );
    });
  });

  it('publishes v1, succeeds v2 (closing v1), and freezes published versions', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service, version: v1 } = await seedService(c, 'pub');
      const v2 = (
        await c.query(
          `INSERT INTO svc.service_versions (tenant_id, service_id, version_no, effective_from, status, created_by)
           VALUES ($1,$2,2,DATE '2026-08-01','draft',$3) RETURNING id`,
          [TENANT_A, service, USER_A]
        )
      ).rows[0].id;
      await c.query(`SELECT svc.publish_service_version($1,$2,DATE '2026-08-01')`, [service, v2]);
      const eff = (
        await c.query(`SELECT effective_to::text AS eff FROM svc.service_versions WHERE id=$1`, [
          v1,
        ])
      ).rows[0].eff;
      expect(eff).toBe('2026-08-01');
      // freeze: cannot change a published version's effective_from
      await expectFail(
        c,
        '23514',
        `UPDATE svc.service_versions SET effective_from=DATE '2025-01-01' WHERE id=$1`,
        [v1]
      );
      // overlap: a second open published interval is rejected
      await expectFail(
        c,
        '23P01',
        `INSERT INTO svc.service_versions (tenant_id, service_id, version_no, effective_from, status, created_by)
         VALUES ($1,$2,3,DATE '2026-09-01','published',$3)`,
        [TENANT_A, service, USER_A]
      );
    });
  });

  it('rejects non-positive standard labor time and freezes child rows after publish', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const draft = (
        await c.query(
          `INSERT INTO svc.service_categories (tenant_id, code, name, created_by) VALUES ($1,'cat_l','L',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      const svc = (
        await c.query(
          `INSERT INTO svc.services (tenant_id, service_category_id, service_code, name, created_by) VALUES ($1,$2,'LAB','Lab',$3) RETURNING id`,
          [TENANT_A, draft, USER_A]
        )
      ).rows[0].id;
      const ver = (
        await c.query(
          `INSERT INTO svc.service_versions (tenant_id, service_id, version_no, effective_from, status, created_by)
           VALUES ($1,$2,1,DATE '2026-01-01','draft',$3) RETURNING id`,
          [TENANT_A, svc, USER_A]
        )
      ).rows[0].id;
      await expectFail(
        c,
        '23514',
        `INSERT INTO svc.standard_labor_times (tenant_id, service_version_id, standard_minutes, created_by) VALUES ($1,$2,0,$3)`,
        [TENANT_A, ver, USER_A]
      );
      await c.query(
        `INSERT INTO svc.standard_labor_times (tenant_id, service_version_id, standard_minutes, created_by) VALUES ($1,$2,30,$3)`,
        [TENANT_A, ver, USER_A]
      );
      await c.query(`SELECT svc.publish_service_version($1,$2,DATE '2026-01-01')`, [svc, ver]);
      // child rows frozen once the parent version is published (INSERT blocked too)
      await expectFail(
        c,
        '23514',
        `INSERT INTO svc.standard_labor_times (tenant_id, service_version_id, standard_minutes, created_by) VALUES ($1,$2,15,$3)`,
        [TENANT_A, ver, USER_A]
      );
    });
  });

  it('blocks making an archived service available at a branch', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'arch');
      await c.query(`UPDATE svc.services SET lifecycle_status='archived' WHERE id=$1`, [service]);
      await expectFail(
        c,
        '23514',
        `INSERT INTO svc.branch_service_availability (tenant_id, company_id, branch_id, service_id, created_by)
         SELECT tenant_id, $2, $3, id, created_by FROM svc.services WHERE id=$1`,
        [service, 'a1000000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001']
      );
    });
  });
});
