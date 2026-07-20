/**
 * Phase 1-11 — security posture. Every sal/wty/rpt function is SECURITY INVOKER with a
 * locked search_path; the restricted amount tables are gated on sal.finance.view
 * (positive + negative), the delivery identity/signature tables on sal.delivery.view;
 * append-only ledgers grant no UPDATE/DELETE to app_runtime; readonly/worker cannot write.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  workerPool,
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
  cleanP111Committed,
  ctxA,
  ctxNoPerm,
  expectFail,
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  allocateReceipt,
  seedCreditNote,
  seedReversal,
  seedCompletedDelivery,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

const admin = adminPool();
const runtime = runtimePool();
const readonly = readonlyPool();
const worker = workerPool();
const SCHEMAS = ['sal', 'wty', 'rpt'];

const FINANCE_TABLES = [
  'sal.invoice_amounts',
  'sal.invoice_line_amounts',
  'sal.receipts',
  'sal.payment_allocations',
  'sal.credit_notes',
  'sal.receipt_reversals',
  'sal.financial_events',
];
const DELIVERY_GATED = ['sal.authorized_receivers', 'sal.delivery_signatures'];
const APPEND_ONLY = [
  'sal.financial_events',
  'sal.invoice_status_history',
  'sal.delivery_status_history',
  'wty.warranty_status_history',
  'sal.payment_allocations',
  'sal.delivery_signatures',
];

const setUser = (c: { query: Client['query'] }, u: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [u]);

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
  // Committed rows in every gated table so the positive/negative read assertions have data.
  await withCommittedTx(runtime, ctxA, async (c) => {
    const { invoice } = await seedInvoiceWithLine(c, 'secinv', {
      net: 100,
      tax: 0,
      warrantyPay: 40,
    });
    await issueInvoice(c, invoice);
    const r = await seedReceipt(c, { amount: 60, payer: P9.SR });
    await allocateReceipt(c, r, invoice, 60);
    const cn = await seedCreditNote(c, invoice, 30);
    await setUser(c, P11.APPROVER_USER);
    await c.query(`SELECT sal.approve_credit_note($1,NULL)`, [cn]);
    await setUser(c, USER_A);
    const r2 = await seedReceipt(c, { amount: 20, payer: P9.SR });
    const rev = await seedReversal(c, r2, 20);
    await setUser(c, P11.APPROVER_USER);
    await c.query(`SELECT sal.approve_receipt_reversal($1,NULL)`, [rev]);
    await setUser(c, USER_A);
    await seedCompletedDelivery(c, 'secdel');
  });
});
afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
  await worker.end();
});

const countFq = async (c: { query: Client['query'] }, fq: string): Promise<number> =>
  Number((await c.query(`SELECT count(*)::int n FROM ${fq}`)).rows[0].n);

describe('p1-11 security posture', () => {
  it('makes every sal/wty/rpt function SECURITY INVOKER with a locked search_path', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||p.proname AS fq, p.prosecdef, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname = ANY($1)`,
      [SCHEMAS]
    );
    expect(rows.length).toBeGreaterThan(0);
    const definer = rows.filter((r) => r.prosecdef).map((r) => r.fq);
    expect(definer, 'SECURITY DEFINER routines').toEqual([]);
    for (const r of rows) {
      const cfg = (r.proconfig ?? []) as string[];
      expect(
        cfg.some((x) => x.startsWith('search_path=')),
        `${r.fq} must lock search_path`
      ).toBe(true);
    }
  });

  it('gates every restricted amount table on sal.finance.view (readable WITH, hidden WITHOUT)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      for (const fq of FINANCE_TABLES)
        expect(await countFq(c, fq), `${fq} visible with finance.view`).toBeGreaterThan(0);
    });
    await withRolledBackTx(runtime, ctxNoPerm, async (c) => {
      for (const fq of FINANCE_TABLES)
        expect(await countFq(c, fq), `${fq} hidden without finance.view`).toBe(0);
    });
  });

  it('denies a restricted-amount write without sal.finance.view (42501)', async () => {
    await withRolledBackTx(runtime, ctxNoPerm, async (c) => {
      await expectFail(
        c,
        '42501',
        `INSERT INTO sal.receipts (tenant_id, company_id, branch_id, receipt_number, payment_method_id, payer_partner_id, currency_code, amount, received_by, created_by)
         VALUES ($1,$2,$3,'X-1',$4,$5,'USD',10,$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, P11.PM_CASH, P9.SR, USER_A]
      );
    });
  });

  it('gates delivery identity + signatures on sal.delivery.view (readable WITH, hidden WITHOUT)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      for (const fq of DELIVERY_GATED)
        expect(await countFq(c, fq), `${fq} visible with delivery.view`).toBeGreaterThan(0);
    });
    await withRolledBackTx(runtime, ctxNoPerm, async (c) => {
      for (const fq of DELIVERY_GATED)
        expect(await countFq(c, fq), `${fq} hidden without delivery.view`).toBe(0);
    });
  });

  it('grants no UPDATE/DELETE on any append-only ledger to app_runtime', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name AS fq, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee='app_runtime' AND privilege_type IN ('UPDATE','DELETE')
          AND table_schema||'.'||table_name = ANY($1)`,
      [APPEND_ONLY]
    );
    expect(rows.map((r) => `${r.fq}:${r.privilege_type}`)).toEqual([]);
  });

  it('grants the infrastructure worker NO privilege on any sal/wty/rpt table', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name AS fq FROM information_schema.role_table_grants
        WHERE table_schema = ANY($1) AND grantee='app_worker'`,
      [SCHEMAS]
    );
    expect(rows).toEqual([]);
  });

  it('blocks writes from the read-only and worker roles', async () => {
    // read-only holds SELECT only: an INSERT is denied (42501).
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectFail(
        c,
        '42501',
        `INSERT INTO rpt.report_configurations (tenant_id, report_code, name, export_permission_code, owner_user_id, created_by)
         VALUES ($1,'x','X','rpt.export',$2,$2)`,
        [TENANT_A, USER_A]
      );
    });
    // the worker has no USAGE on these schemas — even a SELECT is denied (42501).
    await withRolledBackTx(worker, ctxA, async (c) => {
      await expectFail(c, '42501', `SELECT count(*) FROM sal.invoices`);
    });
  });
});
