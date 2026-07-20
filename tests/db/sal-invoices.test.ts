/**
 * Phase 1-11 — sal invoices: draft assembly, issue primitive, freeze + numbering guards.
 * Proves H-fin-5 (number iff issued), L-fin-1/L-fin-3 (header reconciles to Σ line amounts),
 * FR-SAL-001 (one live invoice per work order), FR-WTY-004 (payer split), BR-SAL-001
 * (idempotent re-issue).
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
  BRANCH_A1,
  USER_A,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  expectFail,
  makeWorkOrder,
  seedDraftInvoice,
  addInvoiceLine,
  issueInvoice,
  seedInvoiceWithLine,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

const admin = adminPool();
const runtime = runtimePool();

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

describe('p1-11 sal.invoices', () => {
  it('issues a draft: allocates a number, reconciles header to lines, status->issued', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'hp', { net: 100, tax: 10 });
      // second line to prove multi-line round-then-sum
      await addInvoiceLine(c, invoice, { lineNumber: 2, net: 33.3333, tax: 0 });
      const number = await issueInvoice(c, invoice);
      // fire the deferred reconcile + completeness constraint triggers now.
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      expect(number).toBeTruthy();
      expect(number).toMatch(/^INV-/);
      const inv = (
        await c.query(`SELECT status, invoice_number, issued_at FROM sal.invoices WHERE id=$1`, [
          invoice,
        ])
      ).rows[0];
      expect(inv.status).toBe('issued');
      expect(inv.invoice_number).toBe(number);
      expect(inv.issued_at).not.toBeNull();
      const hdr = (
        await c.query(
          `SELECT net_total, tax_total, gross_total FROM sal.invoice_amounts WHERE invoice_id=$1`,
          [invoice]
        )
      ).rows[0];
      const sum = (
        await c.query(
          `SELECT COALESCE(sum(net_amount),0) n, COALESCE(sum(tax_amount),0) t, COALESCE(sum(gross_amount),0) g
             FROM sal.invoice_line_amounts WHERE invoice_id=$1`,
          [invoice]
        )
      ).rows[0];
      expect(hdr.net_total).toBe(sum.n);
      expect(hdr.tax_total).toBe(sum.t);
      expect(hdr.gross_total).toBe(sum.g);
      expect(Number(hdr.gross_total)).toBeCloseTo(143.3333, 4);
    });
  });

  it('rejects issuing an invoice with zero lines (23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'zero');
      const invoice = await seedDraftInvoice(c, { wo, payer: P9.SR });
      await expectFail(c, '23514', `SELECT sal.issue_invoice($1,NULL)`, [invoice]);
    });
  });

  it('freezes an issued invoice number / issued_at / currency (freeze guard 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'frz', { net: 50, tax: 5 });
      await issueInvoice(c, invoice);
      await expectFail(c, '23514', `UPDATE sal.invoices SET invoice_number='HACK-1' WHERE id=$1`, [
        invoice,
      ]);
      await expectFail(
        c,
        '23514',
        `UPDATE sal.invoices SET issued_at = now() + interval '1 day' WHERE id=$1`,
        [invoice]
      );
      await expectFail(c, '23514', `UPDATE sal.invoices SET currency_code='JOD' WHERE id=$1`, [
        invoice,
      ]);
    });
  });

  it('blocks a draft invoice_number injection (ck_invoices_number_iff_issued 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'inj');
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code, invoice_number, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD','FORGED-1',$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, P9.SR, USER_A]
      );
    });
  });

  it('enforces one live invoice per work order (uq_invoices_work_order_active 23505)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'onewo');
      await seedDraftInvoice(c, { wo, payer: P9.SR });
      await expectFail(
        c,
        '23505',
        `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, P9.SR, USER_A]
      );
    });
  });

  it('enforces customer_pay + warranty_pay = gross (ck_invoice_line_amounts_payer_split 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'split');
      const invoice = await seedDraftInvoice(c, { wo, payer: P9.SR });
      const line = (
        await c.query(
          `INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity, currency_code, created_by)
           VALUES ($1,$2,$3,$4,1,'service',1,'USD',$5) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, USER_A]
        )
      ).rows[0].id;
      // gross = 110; split 100 + 5 != 110 -> payer-split check violation.
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoice_line_amounts
           (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price, net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,100,100,10,110,100,5,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, line, invoice, USER_A]
      );
    });
  });

  it('is idempotent: re-issuing returns the same number and leaves one issued row', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'idem', { net: 80, tax: 0 });
      const n1 = await issueInvoice(c, invoice);
      const n2 = await issueInvoice(c, invoice);
      expect(n2).toBe(n1);
      const evCount = (
        await c.query(
          `SELECT count(*)::int n FROM sal.financial_events WHERE source_id=$1 AND event_type='invoice_issued'`,
          [invoice]
        )
      ).rows[0].n;
      expect(evCount).toBe(1);
    });
  });

  it('blocks a born-issued invoice INSERT that bypasses issue_invoice (H-fin-3 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'born');
      // a direct INSERT of a fully-formed issued invoice would bypass shared.next_display_number
      // AND the invoice_issued completeness event; the born-draft gate rejects it.
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code, status, invoice_number, issued_at, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD','issued','FORGED-1',now(),$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, P9.SR, USER_A]
      );
    });
  });

  it('freezes issued-invoice header totals against a raw UPDATE (H-fin-2 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'hdrfrz', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      // the generic immutable guard does not cover the totals; the freeze guard must.
      await expectFail(
        c,
        '23514',
        `UPDATE sal.invoice_amounts SET net_total=1, tax_total=0, gross_total=1 WHERE invoice_id=$1`,
        [invoice]
      );
    });
  });

  it("rejects a line-amount whose invoice_id != its parent line's invoice (L-fin-4 23503)", async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo: woA } = await makeWorkOrder(c, 'lca');
      const { wo: woB } = await makeWorkOrder(c, 'lcb');
      const invA = await seedDraftInvoice(c, { wo: woA, payer: P9.SR });
      const invB = await seedDraftInvoice(c, { wo: woB, payer: P9.SR });
      const lineA = (
        await c.query(
          `INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity, currency_code, created_by)
           VALUES ($1,$2,$3,$4,1,'service',1,'USD',$5) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, invA, USER_A]
        )
      ).rows[0].id;
      // line belongs to invA but the amount claims invB -> mis-parenting rejected.
      await expectFail(
        c,
        '23503',
        `INSERT INTO sal.invoice_line_amounts
           (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price, net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,100,100,0,100,100,0,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, lineA, invB, USER_A]
      );
    });
  });
});
