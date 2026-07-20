/**
 * Phase 1-10 — Financial precision: money is NUMERIC(18,4), never floating point.
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
import { seedService, addServiceItem, seedQuotation, draftRevision } from './p1-10-helpers';
import { seedP109Base, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('financial precision', () => {
  it('has no real/double-precision column anywhere in svc/quo/inv', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS col, data_type
       FROM information_schema.columns
       WHERE table_schema IN ('svc','quo','inv') AND data_type IN ('real','double precision')`
    );
    expect(rows.map((r) => r.col)).toEqual([]);
  });

  it('stores every money column as NUMERIC(18,4) and nothing else at scale 4', async () => {
    // Money is the only scale-4 numeric in these schemas (quantities are scale 3,
    // tax rates scale 6), so every scale-4 numeric must be precision 18.
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS col, numeric_precision
       FROM information_schema.columns
       WHERE table_schema IN ('svc','quo','inv') AND data_type = 'numeric' AND numeric_scale = 4`
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Number(r.numeric_precision), `${r.col} must be NUMERIC(18,4)`).toBe(18);
    }
    // The known money columns are present and typed exactly.
    const known = await admin.query(
      `SELECT table_schema||'.'||table_name||'.'||column_name AS col, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE (table_schema='svc' AND column_name IN ('amount','value','threshold_value'))
          OR (table_schema='quo' AND column_name LIKE 'captured_%' AND column_name <> 'captured_quantity' AND column_name <> 'captured_tax_rate')
          OR (table_schema='inv' AND column_name IN ('standard_cost','unit_cost','value_impact'))`
    );
    for (const r of known.rows) {
      expect(`${r.col}:${r.numeric_precision},${r.numeric_scale}`).toBe(`${r.col}:18,4`);
    }
  });

  it('reconciles repeated-decimal quotation totals exactly', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { service } = await seedService(c, 'prec');
      const quotation = await seedQuotation(c, wo, 'prec');
      const rev = await draftRevision(c, quotation, 1);
      // 3 x 33.3333 with 10% tax — sum then check the revision grand total = Σ line totals
      await addServiceItem(c, rev, service, 1, 33.3333, 3, 0, 0.1);
      await c.query(`SELECT quo.issue_revision($1)`, [rev]);
      const r = (
        await c.query(
          `SELECT captured_grand_total,
                  (SELECT COALESCE(SUM(captured_line_total),0) FROM quo.quotation_items WHERE quotation_revision_id=$1) AS line_sum
           FROM quo.quotation_revisions WHERE id=$1`,
          [rev]
        )
      ).rows[0];
      expect(r.captured_grand_total).toBe(r.line_sum);
    });
  });
});
