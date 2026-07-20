/**
 * Phase 1-11 — sal.financial_events: exactly one event per financial command,
 * provenance guard on raw forged inserts, the deferred completeness constraint
 * (a manual issue with no event fails at COMMIT), and single-use per (source, event_type).
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
  withCommittedTx,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  expectFail,
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  allocateReceipt,
  seedCreditNote,
  seedReversal,
  addInvoiceLine,
  seedDraftInvoice,
  makeWorkOrder,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

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

const count = async (
  c: { query: Client['query'] },
  source: string,
  type?: string
): Promise<number> =>
  Number(
    (
      await c.query(
        `SELECT count(*)::int n FROM sal.financial_events WHERE source_id=$1 ${type ? 'AND event_type=$2' : ''}`,
        type ? [source, type] : [source]
      )
    ).rows[0].n
  );

describe('p1-11 sal.financial_events', () => {
  it('emits exactly one event per financial command', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'fe1', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      expect(await count(c, invoice)).toBe(1); // invoice_issued only (no warranty split)
      expect(await count(c, invoice, 'invoice_issued')).toBe(1);

      const r = await seedReceipt(c, { amount: 100, payer: P9.SR });
      expect(await count(c, r, 'receipt_recorded')).toBe(1);

      const alloc = await allocateReceipt(c, r, invoice, 100);
      expect(await count(c, alloc, 'payment_allocated')).toBe(1);

      // credit note on a fresh invoice with open balance.
      const { invoice: inv2 } = await seedInvoiceWithLine(c, 'fe2', { net: 100, tax: 0 });
      await issueInvoice(c, inv2);
      const cn = await seedCreditNote(c, inv2, 40);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1,NULL)`, [cn]);
      expect(await count(c, cn, 'credit_note_issued')).toBe(1);
      await setUser(c, USER_A);

      const r2 = await seedReceipt(c, { amount: 20, payer: P9.SR });
      const rev = await seedReversal(c, r2, 20);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1,NULL)`, [rev]);
      expect(await count(c, rev, 'receipt_reversed')).toBe(1);
    });
  });

  it('emits invoice_issued + warranty_split_recorded when a line carries a warranty payer split', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'wsplit', {
        net: 100,
        tax: 0,
        warrantyPay: 40,
      });
      await issueInvoice(c, invoice);
      expect(await count(c, invoice)).toBe(2);
      expect(await count(c, invoice, 'invoice_issued')).toBe(1);
      const wty = (
        await c.query(
          `SELECT amount FROM sal.financial_events WHERE source_id=$1 AND event_type='warranty_split_recorded'`,
          [invoice]
        )
      ).rows[0];
      expect(Number(wty.amount)).toBe(40);
    });
  });

  it('rejects a forged event whose source does not exist / is not authorized (provenance guard 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const fake = '99999999-9999-4999-8999-999999999999';
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, created_by)
         VALUES ($1,$2,$3,'invoice_issued','invoice',$4,'USD',10,$5,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, fake, USER_A]
      );
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, created_by)
         VALUES ($1,$2,$3,'receipt_recorded','receipt',$4,'USD',10,$5,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, fake, USER_A]
      );
    });
  });

  it('deferred completeness: a manual issue that emits no event fails at COMMIT (23514)', async () => {
    let code: string | undefined;
    try {
      await withCommittedTx(runtime, ctxA, async (c) => {
        const { wo } = await makeWorkOrder(c, 'compl');
        const invoice = await seedDraftInvoice(c, { wo, payer: P9.SR });
        await addInvoiceLine(c, invoice, { lineNumber: 1, net: 100, tax: 0 });
        // hand-write a matching header so the reconcile guard passes and ONLY completeness can fail.
        await c.query(
          `INSERT INTO sal.invoice_amounts (tenant_id, company_id, branch_id, invoice_id, net_total, tax_total, gross_total, created_by)
           VALUES ($1,$2,$3,$4,100,0,100,$5)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, USER_A]
        );
        // manual issue WITHOUT emitting a financial_event.
        await c.query(
          `UPDATE sal.invoices SET status='issued', invoice_number='MANUAL-1', issued_at=now() WHERE id=$1`,
          [invoice]
        );
        // COMMIT (inside withCommittedTx) triggers the deferred completeness constraint.
      });
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('23514');
  });

  it('single-use: a duplicate event for the same (source, event_type) is blocked (23505)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'dup', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const gross = (
        await c.query(`SELECT gross_total FROM sal.invoice_amounts WHERE invoice_id=$1`, [invoice])
      ).rows[0].gross_total;
      // provenance passes (issued invoice, correct amount/currency) but the single-use unique blocks it.
      await expectFail(
        c,
        '23505',
        `INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, created_by)
         VALUES ($1,$2,$3,'invoice_issued','invoice',$4,'USD',$5,$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, gross, USER_A]
      );
    });
  });
});
