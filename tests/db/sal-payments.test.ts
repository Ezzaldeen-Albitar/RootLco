/**
 * Phase 1-11 — sal payments: record_receipt, allocate_receipt bounds (BR-SAL-002),
 * currency coherence, receipt freeze (H-fin-4), server-stamped dual control (H-fin-6),
 * credit <= open, and full-receipt reversal removing its allocations from the derived
 * open receivable (H-fin-1).
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
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

const admin = adminPool();
const runtime = runtimePool();

const setUser = (c: { query: Client['query'] }, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

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

async function issuedInvoice(
  c: { query: Client['query'] },
  tag: string,
  net: number
): Promise<string> {
  const { invoice } = await seedInvoiceWithLine(c, tag, { net, tax: 0 });
  await issueInvoice(c, invoice);
  return invoice;
}

describe('p1-11 sal payments', () => {
  it('records a receipt and emits exactly one receipt_recorded event', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const r = await seedReceipt(c, { amount: 200, payer: P9.SR });
      const row = (await c.query(`SELECT status, amount FROM sal.receipts WHERE id=$1`, [r]))
        .rows[0];
      expect(row.status).toBe('recorded');
      expect(Number(row.amount)).toBe(200);
      const ev = (
        await c.query(
          `SELECT count(*)::int n, max(amount) a FROM sal.financial_events WHERE source_id=$1 AND event_type='receipt_recorded'`,
          [r]
        )
      ).rows[0];
      expect(ev.n).toBe(1);
      expect(Number(ev.a)).toBe(200);
    });
  });

  it('bounds allocation by receipt-unallocated AND invoice-open (both over -> 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // over-allocation of the receipt: unallocated 50 < requested 80, invoice open large.
      const invBig = await issuedInvoice(c, 'pbig', 1000);
      const rSmall = await seedReceipt(c, { amount: 50, payer: P9.SR });
      await allocateReceipt(c, rSmall, invBig, 40); // ok, 10 unallocated left
      await expectFail(c, '23514', `SELECT sal.allocate_receipt($1,$2,80)`, [rSmall, invBig]);

      // over-payment of the invoice: open 50 < requested 80, receipt unallocated large.
      const invSmall = await issuedInvoice(c, 'psmall', 50);
      const rBig = await seedReceipt(c, { amount: 1000, payer: P9.SR });
      await expectFail(c, '23514', `SELECT sal.allocate_receipt($1,$2,80)`, [rBig, invSmall]);
      // a within-bounds allocation still works.
      const id = await allocateReceipt(c, rBig, invSmall, 50);
      expect(id).toBeTruthy();
      expect(
        Number((await c.query(`SELECT sal.invoice_open_receivable($1) o`, [invSmall])).rows[0].o)
      ).toBe(0);
    });
  });

  it('rejects allocation when receipt and invoice currencies differ (23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const inv = await issuedInvoice(c, 'cur', 100); // USD
      const rJod = await seedReceipt(c, { amount: 100, payer: P9.SR, currency: 'JOD' });
      await expectFail(c, '23514', `SELECT sal.allocate_receipt($1,$2,10)`, [rJod, inv]);
    });
  });

  it('freezes a recorded receipt amount/currency (H-fin-4 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const r = await seedReceipt(c, { amount: 200, payer: P9.SR });
      await expectFail(c, '23514', `UPDATE sal.receipts SET amount=300 WHERE id=$1`, [r]);
      await expectFail(c, '23514', `UPDATE sal.receipts SET currency_code='JOD' WHERE id=$1`, [r]);
    });
  });

  it('server-stamps dual control and rejects self-approval (maker == approver)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const inv = await issuedInvoice(c, 'dc', 100);
      // client attempts to pre-set requested_by=approver; the maker trigger overrides it to USER_A.
      const cn = (
        await c.query(
          `INSERT INTO sal.credit_notes (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason, requested_by, created_by)
           VALUES ($1,$2,$3,$4,'USD',50,'x',$5,$6) RETURNING id, requested_by`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, inv, P11.APPROVER_USER, USER_A]
        )
      ).rows[0];
      expect(cn.requested_by).toBe(USER_A); // server-stamped to the acting user, not the client value

      // self-approval (approver == requester) rejected.
      await expectFail(c, '23514', `SELECT sal.approve_credit_note($1,NULL)`, [cn.id]);

      // a distinct approver succeeds; approved_by is server-stamped.
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1,NULL)`, [cn.id]);
      const done = (
        await c.query(
          `SELECT approval_state, approved_by, requested_by FROM sal.credit_notes WHERE id=$1`,
          [cn.id]
        )
      ).rows[0];
      expect(done.approval_state).toBe('approved');
      expect(done.approved_by).toBe(P11.APPROVER_USER);
      expect(done.approved_by).not.toBe(done.requested_by);
    });
  });

  it('enforces credit <= invoice open receivable (23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const inv = await issuedInvoice(c, 'clim', 100);
      const cn = await seedCreditNote(c, inv, 150); // exceeds open (100)
      await setUser(c, P11.APPROVER_USER);
      await expectFail(c, '23514', `SELECT sal.approve_credit_note($1,NULL)`, [cn]);
    });
  });

  it('full-receipt reversal sets status=reversed and drops its allocations from open receivable (H-fin-1)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const inv = await issuedInvoice(c, 'rev', 100);
      const r = await seedReceipt(c, { amount: 100, payer: P9.SR });
      await allocateReceipt(c, r, inv, 100);
      expect(
        Number((await c.query(`SELECT sal.invoice_open_receivable($1) o`, [inv])).rows[0].o)
      ).toBe(0);

      const rev = await seedReversal(c, r, 100);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_receipt_reversal($1,NULL)`, [rev]);

      const rr = (await c.query(`SELECT status FROM sal.receipts WHERE id=$1`, [r])).rows[0];
      expect(rr.status).toBe('reversed');
      // the reversed receipt's allocation no longer reduces the invoice open receivable.
      expect(
        Number((await c.query(`SELECT sal.invoice_open_receivable($1) o`, [inv])).rows[0].o)
      ).toBe(100);
      const rvz = (
        await c.query(
          `SELECT approval_state, approved_by, reversed_at FROM sal.receipt_reversals WHERE id=$1`,
          [rev]
        )
      ).rows[0];
      expect(rvz.approval_state).toBe('approved');
      expect(rvz.approved_by).toBe(P11.APPROVER_USER);
      expect(rvz.reversed_at).not.toBeNull();
    });
  });

  it('blocks a raw receipt status flip to reversed without an approved reversal (H-fin-1 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const r = await seedReceipt(c, { amount: 100, payer: P9.SR });
      // a direct flip would unwind the payment with no reversal record / dual control / event.
      await expectFail(c, '23514', `UPDATE sal.receipts SET status='reversed' WHERE id=$1`, [r]);
      // even a PENDING (unapproved) reversal is insufficient — only an approved one gates it.
      await seedReversal(c, r, 100);
      await expectFail(c, '23514', `UPDATE sal.receipts SET status='reversed' WHERE id=$1`, [r]);
    });
  });
});
