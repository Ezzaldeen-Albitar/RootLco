/**
 * Phase 1-10 — Quotations, revisions, items, approvals (FR-QUO-001/002, BR-QUO-001/002).
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
import { seedP109Base, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';
import {
  seedService,
  seedQuotation,
  draftRevision,
  addServiceItem,
  expectFail,
} from './p1-10-helpers';

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

describe('quo quotations', () => {
  it('issues a revision with reconciled totals and freezes its items', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { service } = await seedService(c, 'q1');
      const quotation = await seedQuotation(c, wo, 'q1');
      const rev = await draftRevision(c, quotation, 1);
      await addServiceItem(c, rev, service, 1, 100, 2, 10, 0.1); // net 190, tax 19, line 209
      await c.query(`SELECT quo.issue_revision($1)`, [rev]);
      const totals = (
        await c.query(
          `SELECT captured_subtotal, captured_discount_total, captured_tax_total, captured_grand_total, status FROM quo.quotation_revisions WHERE id=$1`,
          [rev]
        )
      ).rows[0];
      expect(totals.status).toBe('issued');
      expect(Number(totals.captured_subtotal)).toBe(200);
      expect(Number(totals.captured_discount_total)).toBe(10);
      expect(Number(totals.captured_tax_total)).toBe(19);
      expect(Number(totals.captured_grand_total)).toBe(209);
      // items are frozen once issued (no new line, no edit)
      await expectFail(c, '23514', `SELECT quo.issue_revision($1)`, [rev]); // already issued
      await expectFail(
        c,
        '23514',
        `INSERT INTO quo.quotation_items (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, service_id, currency_code, captured_unit_price, captured_quantity, captured_discount, captured_tax_rate, captured_tax_amount, captured_line_total, created_by)
         SELECT tenant_id, company_id, branch_id, quotation_revision_id, 2, 'service', service_id, currency_code, 10, 1, 0, 0, 0, 10, created_by FROM quo.quotation_items WHERE quotation_revision_id=$1 LIMIT 1`,
        [rev]
      );
    });
  });

  it('refuses to issue a revision with no items', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const quotation = await seedQuotation(c, wo, 'q2');
      const rev = await draftRevision(c, quotation, 1);
      await expectFail(c, '23514', `SELECT quo.issue_revision($1)`, [rev]);
    });
  });

  it('supersedes the prior issued revision and keeps exactly one issued', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { service } = await seedService(c, 'q3');
      const quotation = await seedQuotation(c, wo, 'q3');
      const r1 = await draftRevision(c, quotation, 1);
      await addServiceItem(c, r1, service, 1, 100, 1);
      await c.query(`SELECT quo.issue_revision($1)`, [r1]);
      const r2 = await draftRevision(c, quotation, 2);
      await addServiceItem(c, r2, service, 1, 120, 1);
      await c.query(`SELECT quo.issue_revision($1)`, [r2]);
      const rows = await c.query(
        `SELECT status FROM quo.quotation_revisions WHERE quotation_id=$1 ORDER BY revision_number`,
        [quotation]
      );
      expect(rows.rows.map((r) => r.status)).toEqual(['superseded', 'issued']);
      const current = (
        await c.query(`SELECT current_revision_id FROM quo.quotations WHERE id=$1`, [quotation])
      ).rows[0].current_revision_id;
      expect(current).toBe(r2);
    });
  });

  it('records one immutable item decision only against the current issued revision', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { service } = await seedService(c, 'q4');
      const quotation = await seedQuotation(c, wo, 'q4');
      const rev = await draftRevision(c, quotation, 1);
      const item = await addServiceItem(c, rev, service, 1, 100, 1);
      // a decision on a draft (non-current) revision is rejected
      await expectFail(c, '23514', `SELECT quo.record_item_decision($1,'approved','portal')`, [
        item,
      ]);
      await c.query(`SELECT quo.issue_revision($1)`, [rev]);
      const dec = (
        await c.query(`SELECT quo.record_item_decision($1,'approved','portal') AS id`, [item])
      ).rows[0].id;
      // append-only: no UPDATE grant on decisions
      await expectFail(
        c,
        '42501',
        `UPDATE quo.approval_decisions SET decision='rejected' WHERE id=$1`,
        [dec]
      );
      // one authoritative decision per revision-item
      await expectFail(c, '23505', `SELECT quo.record_item_decision($1,'rejected','portal')`, [
        item,
      ]);
    });
  });
});
