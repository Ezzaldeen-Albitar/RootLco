/**
 * Phase 1-11 — derivation PROPERTY test. Over a seeded, randomized sequence of
 * allocate / approve-credit / reverse operations, sal.invoice_open_receivable(invoice)
 * must ALWAYS equal the hand-computed gross − Σ(live-receipt allocations) − Σ(approved
 * credits), and sal.partner_outstanding_balance(payer) must equal Σ open over the payer's
 * issued invoices. H-fin-1: a reversed receipt's allocations drop out of the derivation.
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
  USER_A,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  makeWorkOrder,
  seedDraftInvoice,
  addInvoiceLine,
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
const setUser = (c: { query: Client['query'] }, u: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [u]);

// Deterministic LCG so the "random" sequence is reproducible.
let seed = 987654321;
const rnd = () => {
  seed = (1103515245 * seed + 12345) % 2147483648;
  return seed / 2147483648;
};
const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

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

describe('p1-11 open-receivable derivation (property)', () => {
  it('open receivable + partner balance always equal the hand-computed values', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const grosses = [100, 150, 200];
      const invoices: string[] = [];
      for (let i = 0; i < grosses.length; i++) {
        const { wo } = await makeWorkOrder(c, `der${i}`);
        const inv = await seedDraftInvoice(c, { wo, payer: P9.SR });
        await addInvoiceLine(c, inv, { lineNumber: 1, net: grosses[i]!, tax: 0 });
        await issueInvoice(c, inv);
        invoices.push(inv);
      }
      const rcptAmts = [120, 90, 200, 60];
      const receipts: string[] = [];
      for (const a of rcptAmts) receipts.push(await seedReceipt(c, { amount: a, payer: P9.SR }));

      // expected state
      const credits = grosses.map(() => 0);
      const reversed = receipts.map(() => false);
      const allocs: Array<{ i: number; r: number; amount: number }> = [];
      const expectedOpen = (i: number) =>
        grosses[i]! -
        allocs.filter((a) => a.i === i && !reversed[a.r]!).reduce((s, a) => s + a.amount, 0) -
        credits[i]!;
      const receiptUnalloc = (r: number) =>
        rcptAmts[r]! - allocs.filter((a) => a.r === r).reduce((s, a) => s + a.amount, 0);

      const check = async () => {
        for (let i = 0; i < invoices.length; i++) {
          const dbOpen = Number(
            (await c.query(`SELECT sal.invoice_open_receivable($1) o`, [invoices[i]])).rows[0].o
          );
          expect(dbOpen, `invoice ${i} open`).toBe(expectedOpen(i));
        }
        const dbBal = Number(
          (await c.query(`SELECT sal.partner_outstanding_balance($1) b`, [P9.SR])).rows[0].b
        );
        const expBal = invoices.reduce((s, _v, i) => s + expectedOpen(i), 0);
        expect(dbBal, 'partner outstanding balance').toBe(expBal);
      };

      await check();
      let allocN = 0;
      let creditN = 0;
      let reverseN = 0;
      for (let step = 0; step < 30; step++) {
        const openInvoices = invoices.map((_v, i) => i).filter((i) => expectedOpen(i) > 0);
        const liveReceipts = receipts
          .map((_v, r) => r)
          .filter((r) => !reversed[r] && receiptUnalloc(r) > 0);
        const roll = rnd();

        if (roll < 0.6 && openInvoices.length && liveReceipts.length) {
          const i = openInvoices[ri(0, openInvoices.length - 1)]!;
          const r = liveReceipts[ri(0, liveReceipts.length - 1)]!;
          const amount = ri(1, Math.min(expectedOpen(i), receiptUnalloc(r)));
          await allocateReceipt(c, receipts[r]!, invoices[i]!, amount);
          allocs.push({ i, r, amount });
          allocN++;
        } else if (roll < 0.85 && openInvoices.length) {
          const i = openInvoices[ri(0, openInvoices.length - 1)]!;
          const amount = ri(1, expectedOpen(i));
          const cn = await seedCreditNote(c, invoices[i]!, amount);
          await setUser(c, P11.APPROVER_USER);
          await c.query(`SELECT sal.approve_credit_note($1,NULL)`, [cn]);
          await setUser(c, USER_A);
          credits[i] = credits[i]! + amount;
          creditN++;
        } else {
          const live = receipts.map((_v, r) => r).filter((r) => !reversed[r]);
          if (!live.length) continue;
          const r = live[ri(0, live.length - 1)]!;
          const rev = await seedReversal(c, receipts[r]!, rcptAmts[r]!);
          await setUser(c, P11.APPROVER_USER);
          await c.query(`SELECT sal.approve_receipt_reversal($1,NULL)`, [rev]);
          await setUser(c, USER_A);
          reversed[r] = true;
          reverseN++;
        }
        await check();
      }
      // the sequence actually exercised all three operations.
      expect(allocN, 'exercised allocations').toBeGreaterThan(0);
      expect(creditN, 'exercised credits').toBeGreaterThan(0);
      expect(reverseN, 'exercised reversals').toBeGreaterThan(0);
    });
  });
});
