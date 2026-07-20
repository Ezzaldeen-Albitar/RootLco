/**
 * Phase 1-11 — concurrency (single-winner invariants under real parallel connections),
 * each repeated 5 isolated times:
 *   (a) two concurrent issue_invoice on different drafts get consecutive numbers (no dup/gap);
 *   (b) two concurrent allocate_receipt on the same receipt cannot overspend it;
 *   (c) two concurrent allocations on the same last-open invoice cannot overpay it.
 * The serialization is by the number-sequence row lock (a) and the receipt/invoice
 * FOR UPDATE locks (b, c); the accepted loser SQLSTATE is 23514 (check_violation).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  runtimeClient,
  setContext,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withCommittedTx,
} from './helpers';
import {
  seedP111Base,
  cleanP111Committed,
  ctxA,
  makeWorkOrder,
  seedDraftInvoice,
  addInvoiceLine,
  issueInvoice,
  seedReceipt,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

const admin = adminPool();
const runtime = runtimePool(8);

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});
afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

/** Runs `sql` in its own transaction on a fresh connection; returns {status, value}. */
async function race(
  sql: string,
  params: unknown[]
): Promise<{ status: string; value: string | null }> {
  const c = runtimeClient();
  await c.connect();
  try {
    await c.query('BEGIN');
    await setContext(c, ctxA);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return { status: 'ok', value: res.rows[0] ? (Object.values(res.rows[0])[0] as string) : null };
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    return { status: (e as { code?: string }).code ?? 'error', value: null };
  } finally {
    await c.end();
  }
}

const numOf = (n: string): number => parseInt(n.replace(/^INV-/, ''), 10);

describe('p1-11 concurrency (single-winner)', () => {
  it('assigns consecutive invoice numbers under a concurrent double-issue (x5)', async () => {
    for (let rep = 0; rep < 5; rep++) {
      const { a, b } = await withCommittedTx(runtime, ctxA, async (c) => {
        const wa = await makeWorkOrder(c, `cia${rep}`);
        const invA = await seedDraftInvoice(c, { wo: wa.wo, payer: P9.SR });
        await addInvoiceLine(c, invA, { lineNumber: 1, net: 100, tax: 0 });
        const wb = await makeWorkOrder(c, `cib${rep}`);
        const invB = await seedDraftInvoice(c, { wo: wb.wo, payer: P9.SR });
        await addInvoiceLine(c, invB, { lineNumber: 1, net: 100, tax: 0 });
        return { a: invA, b: invB };
      });
      const [x, y] = await Promise.all([
        race(`SELECT sal.issue_invoice($1,NULL) AS n`, [a]),
        race(`SELECT sal.issue_invoice($1,NULL) AS n`, [b]),
      ]);
      expect(x.status, `rep ${rep} A`).toBe('ok');
      expect(y.status, `rep ${rep} B`).toBe('ok');
      const na = numOf(x.value!);
      const nb = numOf(y.value!);
      expect(na, `rep ${rep} distinct numbers`).not.toBe(nb);
      expect(Math.abs(na - nb), `rep ${rep} consecutive (no gap/dup)`).toBe(1);
    }
  });

  it('cannot overspend a receipt under two concurrent allocations (x5)', async () => {
    for (let rep = 0; rep < 5; rep++) {
      const { invoice, receipt } = await withCommittedTx(runtime, ctxA, async (c) => {
        const { wo } = await makeWorkOrder(c, `ovr${rep}`);
        const invoice = await seedDraftInvoice(c, { wo, payer: P9.SR });
        await addInvoiceLine(c, invoice, { lineNumber: 1, net: 1000, tax: 0 }); // invoice open large
        await issueInvoice(c, invoice);
        const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR }); // unallocated 100
        return { invoice, receipt };
      });
      // two allocations of 60 each (120 > 100) — the receipt cannot be overspent.
      const [x, y] = await Promise.all([
        race(`SELECT sal.allocate_receipt($1,$2,60) AS id`, [receipt, invoice]),
        race(`SELECT sal.allocate_receipt($1,$2,60) AS id`, [receipt, invoice]),
      ]);
      const results = [x.status, y.status];
      expect(results.filter((r) => r === 'ok').length, `rep ${rep} one winner`).toBe(1);
      expect(results.filter((r) => r === '23514').length, `rep ${rep} loser 23514`).toBe(1);
      const alloc = Number(
        (
          await admin.query(
            `SELECT COALESCE(sum(amount),0) s FROM sal.payment_allocations WHERE receipt_id=$1`,
            [receipt]
          )
        ).rows[0].s
      );
      expect(alloc, `rep ${rep} never overspent`).toBeLessThanOrEqual(100);
    }
  });

  it('cannot overpay a last-open invoice under two concurrent allocations (x5)', async () => {
    for (let rep = 0; rep < 5; rep++) {
      const { invoice, rA, rB } = await withCommittedTx(runtime, ctxA, async (c) => {
        const { wo } = await makeWorkOrder(c, `opay${rep}`);
        const invoice = await seedDraftInvoice(c, { wo, payer: P9.SR });
        await addInvoiceLine(c, invoice, { lineNumber: 1, net: 100, tax: 0 }); // open exactly 100
        await issueInvoice(c, invoice);
        const rA = await seedReceipt(c, { amount: 100, payer: P9.SR });
        const rB = await seedReceipt(c, { amount: 100, payer: P9.SR });
        return { invoice, rA, rB };
      });
      // two 60 allocations from different receipts to the same invoice (120 > 100 open).
      const [x, y] = await Promise.all([
        race(`SELECT sal.allocate_receipt($1,$2,60) AS id`, [rA, invoice]),
        race(`SELECT sal.allocate_receipt($1,$2,60) AS id`, [rB, invoice]),
      ]);
      const results = [x.status, y.status];
      expect(results.filter((r) => r === 'ok').length, `rep ${rep} one winner`).toBe(1);
      expect(results.filter((r) => r === '23514').length, `rep ${rep} loser 23514`).toBe(1);
      const open = Number(
        (await admin.query(`SELECT sal.invoice_open_receivable($1) o`, [invoice])).rows[0].o
      );
      expect(open, `rep ${rep} open never negative`).toBeGreaterThanOrEqual(0);
    }
  });
});
