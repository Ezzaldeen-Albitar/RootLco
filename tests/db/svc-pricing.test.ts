/**
 * Phase 1-10 — Pricing precedence, immutability, ambiguity, tax (FR-SVC-002/003, BR-SVC-001).
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
  COMPANY_A1,
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

/** Builds a published price-list version with the given rules; returns list id. */
async function buildPricedList(
  c: { query: typeof runtime.query },
  service: string,
  rules: Array<{ company?: string; amount: number; priority?: number }>,
  tag: string
): Promise<string> {
  const list = (
    await c.query(
      `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by) VALUES ($1,$2,$3,'USD',$4) RETURNING id`,
      [TENANT_A, `PL_${tag}`, `PL ${tag}`, USER_A]
    )
  ).rows[0].id;
  const ver = (
    await c.query(
      `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by)
       VALUES ($1,$2,1,DATE '2026-01-01','draft',$3) RETURNING id`,
      [TENANT_A, list, USER_A]
    )
  ).rows[0].id;
  for (const r of rules) {
    await c.query(
      `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, company_id, amount, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [TENANT_A, ver, service, r.company ?? null, r.amount, r.priority ?? 0, USER_A]
    );
  }
  await c.query(`SELECT svc.publish_price_list_version($1,$2,DATE '2026-01-01')`, [list, ver]);
  await c.query(
    `INSERT INTO svc.price_list_assignments (tenant_id, price_list_id, effective_from, created_by) VALUES ($1,$2,DATE '2026-01-01',$3)`,
    [TENANT_A, list, USER_A]
  );
  return list;
}

describe('svc pricing', () => {
  it('resolves the most specific rule and falls back to tenant-wide', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'p1');
      await buildPricedList(
        c,
        service,
        [{ amount: 100 }, { company: COMPANY_A1, amount: 80 }],
        'p1'
      );
      const forCompany = await c.query(
        `SELECT amount, currency_code FROM svc.resolve_price($1,$2,$3,NULL,DATE '2026-06-01')`,
        [service, COMPANY_A1, 'a1100000-0000-4000-8000-000000000001']
      );
      expect(Number(forCompany.rows[0].amount)).toBe(80);
      expect(forCompany.rows[0].currency_code).toBe('USD');
      const otherCompany = await c.query(
        `SELECT amount FROM svc.resolve_price($1,$2,$3,NULL,DATE '2026-06-01')`,
        [service, '99999999-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001']
      );
      expect(Number(otherCompany.rows[0].amount)).toBe(100);
    });
  });

  it('resolves at most one rule (no ambiguity)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'p2');
      await buildPricedList(
        c,
        service,
        [{ amount: 100 }, { company: COMPANY_A1, amount: 80 }],
        'p2'
      );
      const { rowCount } = await c.query(
        `SELECT * FROM svc.resolve_price($1,$2,$3,NULL,DATE '2026-06-01')`,
        [service, COMPANY_A1, 'a1100000-0000-4000-8000-000000000001']
      );
      expect(rowCount).toBe(1);
    });
  });

  it('rejects duplicate tenant-wide rules of equal priority (NULLS NOT DISTINCT)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'p3');
      const list = (
        await c.query(
          `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by) VALUES ($1,'PL_p3','p3','USD',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      const ver = (
        await c.query(
          `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by)
           VALUES ($1,$2,1,DATE '2026-01-01','draft',$3) RETURNING id`,
          [TENANT_A, list, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, amount, priority, created_by) VALUES ($1,$2,$3,100,0,$4)`,
        [TENANT_A, ver, service, USER_A]
      );
      await expectFail(
        c,
        '23505',
        `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, amount, priority, created_by) VALUES ($1,$2,$3,120,0,$4)`,
        [TENANT_A, ver, service, USER_A]
      );
    });
  });

  it('freezes a published version against new/removed rules', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'p4');
      const list = await buildPricedList(c, service, [{ amount: 100 }], 'p4');
      const ver = (
        await c.query(
          `SELECT id FROM svc.price_list_versions WHERE price_list_id=$1 AND status='published'`,
          [list]
        )
      ).rows[0].id;
      await expectFail(
        c,
        '23514',
        `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, amount, priority, created_by) VALUES ($1,$2,$3,50,5,$4)`,
        [TENANT_A, ver, service, USER_A]
      );
      // DELETE is not granted to app_runtime at all (soft-delete only) — 42501.
      await expectFail(c, '42501', `DELETE FROM svc.price_rules WHERE price_list_version_id=$1`, [
        ver,
      ]);
    });
  });

  it('rejects a tenant-wide rule that carries a tax class (company-null => tax-null)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'p5');
      const list = (
        await c.query(
          `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by) VALUES ($1,'PL_p5','p5','USD',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      const ver = (
        await c.query(
          `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by)
           VALUES ($1,$2,1,DATE '2026-01-01','draft',$3) RETURNING id`,
          [TENANT_A, list, USER_A]
        )
      ).rows[0].id;
      await expectFail(
        c,
        '23514',
        `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, amount, tax_class_id, created_by)
         VALUES ($1,$2,$3,10,gen_random_uuid(),$4)`,
        [TENANT_A, ver, service, USER_A]
      );
    });
  });

  it('rejects float money columns and out-of-range discount bounds', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // percentage discount must be 0..100 and carry no currency
      await expectFail(
        c,
        '23514',
        `INSERT INTO svc.discount_rules (tenant_id, discount_code, name, discount_type, value, effective_from, created_by)
         VALUES ($1,'D1','d','percentage',150,DATE '2026-01-01',$2)`,
        [TENANT_A, USER_A]
      );
      // amount discount requires a currency
      await expectFail(
        c,
        '23514',
        `INSERT INTO svc.discount_rules (tenant_id, discount_code, name, discount_type, value, effective_from, created_by)
         VALUES ($1,'D2','d','amount',10,DATE '2026-01-01',$2)`,
        [TENANT_A, USER_A]
      );
    });
  });
});
