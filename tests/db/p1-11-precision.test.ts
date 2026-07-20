/**
 * Phase 1-11 — financial precision: money is NUMERIC(18,4), never floating point, and a
 * repeated-decimal invoice reconciles exactly through issue_invoice (L-fin-3 round-then-sum).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  makeWorkOrder,
  seedDraftInvoice,
  addInvoiceLine,
  issueInvoice,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

const admin = adminPool();
const runtime = runtimePool();
const SCHEMAS = ['sal', 'wty', 'rpt'];

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

describe('p1-11 financial precision', () => {
  it('has no real/double-precision column anywhere in sal/wty/rpt', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name||'.'||column_name AS col
         FROM information_schema.columns
        WHERE table_schema = ANY($1) AND data_type IN ('real','double precision')`,
      [SCHEMAS]
    );
    expect(rows.map((r) => r.col)).toEqual([]);
  });

  it('stores every scale-4 numeric as NUMERIC(18,4)', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name||'.'||column_name AS col, numeric_precision
         FROM information_schema.columns
        WHERE table_schema = ANY($1) AND data_type='numeric' AND numeric_scale=4`,
      [SCHEMAS]
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Number(r.numeric_precision), `${r.col} must be NUMERIC(18,4)`).toBe(18);
    }
    // Spot-check the load-bearing money columns are typed exactly.
    const known = await admin.query(
      `SELECT table_schema||'.'||table_name||'.'||column_name AS col, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE (table_schema='sal' AND table_name='invoice_amounts' AND column_name IN ('net_total','tax_total','gross_total'))
           OR (table_schema='sal' AND table_name='invoice_line_amounts' AND column_name IN ('customer_pay_amount','warranty_pay_amount','gross_amount'))
           OR (table_schema='sal' AND table_name='receipts' AND column_name='amount')
           OR (table_schema='sal' AND table_name='payment_allocations' AND column_name='amount')
           OR (table_schema='sal' AND table_name='financial_events' AND column_name='amount')`
    );
    expect(known.rows.length).toBeGreaterThan(0);
    for (const r of known.rows) {
      expect(`${r.col}:${r.numeric_precision},${r.numeric_scale}`).toBe(`${r.col}:18,4`);
    }
  });

  it('reconciles a repeated-decimal invoice (33.3333 x3) exactly through issue_invoice', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'prec');
      const invoice = await seedDraftInvoice(c, { wo, payer: P9.SR });
      await addInvoiceLine(c, invoice, { lineNumber: 1, net: 33.3333, tax: 0 });
      await addInvoiceLine(c, invoice, { lineNumber: 2, net: 33.3333, tax: 0 });
      await addInvoiceLine(c, invoice, { lineNumber: 3, net: 33.3333, tax: 0 });
      await issueInvoice(c, invoice);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      const r = (
        await c.query(
          `SELECT a.gross_total,
                  (SELECT COALESCE(sum(gross_amount),0) FROM sal.invoice_line_amounts WHERE invoice_id=$1) AS line_sum
             FROM sal.invoice_amounts a WHERE a.invoice_id=$1`,
          [invoice]
        )
      ).rows[0];
      expect(r.gross_total).toBe(r.line_sum);
      expect(Number(r.gross_total)).toBe(99.9999);
    });
  });
});
