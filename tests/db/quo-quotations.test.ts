/**
 * Phase 1-10 — Quotations, revisions, items, approvals (FR-QUO-001/002, BR-QUO-001/002),
 * and the discount approval record with its versioned company threshold
 * (P1-32-PRE-OD-DISC-01).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  setContext,
  COMPANY_A1,
  BRANCH_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';
import { seedP109Base, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';
import {
  seedService,
  seedQuotation,
  draftRevision,
  addServiceItem,
  expectFail,
  OTHER_ACTOR,
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

  it("freezes an issued revision's captured totals and forbids reverting to draft", async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { service } = await seedService(c, 'q5');
      const quotation = await seedQuotation(c, wo, 'q5');
      const rev = await draftRevision(c, quotation, 1);
      await addServiceItem(c, rev, service, 1, 100, 1);
      await c.query(`SELECT quo.issue_revision($1)`, [rev]);
      // captured totals of an issued revision cannot be rewritten
      await expectFail(
        c,
        '23514',
        `UPDATE quo.quotation_revisions SET captured_grand_total=99999 WHERE id=$1`,
        [rev]
      );
      // and status cannot revert to draft (which would re-open item editing)
      await expectFail(
        c,
        '23514',
        `UPDATE quo.quotation_revisions SET status='draft' WHERE id=$1`,
        [rev]
      );
    });
  });
});

/**
 * The discount approval record (P1-32-PRE-OD-DISC-01), proved at the database.
 *
 * The application refuses each of these first and names the reason; these cases are
 * the second layer, so a path that forgot the application check still cannot land a
 * self-approved, over-limit or pending discount on an issued revision. Every case runs
 * as `app_runtime` through RLS, inside a transaction that is rolled back.
 */
describe('quo discount approvals', () => {
  /** A draft revision carrying one discounted line, and a pending request for it. */
  async function pendingDiscount(
    c: { query: import('pg').Client['query'] },
    tag: string
  ): Promise<{ revision: string; approval: string }> {
    const visit = await makeAuthorizedVisit(c);
    const wo = await newWorkOrder(c, visit);
    const { service } = await seedService(c, tag);
    const quotation = await seedQuotation(c, wo, tag);
    const revision = await draftRevision(c, quotation, 1);
    await addServiceItem(c, revision, service, 1, 100, 1, 40);
    const approval = (
      await c.query(
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, required_permission_code,
            requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',40,100,1,'svc.price.manage',$6,$6) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, USER_A]
      )
    ).rows[0].id as string;
    return { revision, approval };
  }

  it('records the requester as the signed-in person and nobody else, born pending', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { service } = await seedService(c, 'd1');
      const quotation = await seedQuotation(c, wo, 'd1');
      const revision = await draftRevision(c, quotation, 1);
      await addServiceItem(c, revision, service, 1, 100, 1, 40);
      const insert = (requestedBy: string, status = 'pending') =>
        expectFail(
          c,
          ['42501', '23514'],
          `INSERT INTO quo.discount_approvals
             (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, status,
              currency_code, discount_total, discount_base, elevated_line_count,
              required_permission_code, requested_by, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'USD',40,100,1,'svc.price.manage',$7,$7)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, status, requestedBy]
        );
      // Naming a colleague as the requester is refused by row security: the request is
      // the signed-in person's, never a value the caller chose.
      await insert(OTHER_ACTOR);
      // And a request cannot be born approved.
      await insert(USER_A, 'approved');
      // The positive control: the signed-in person's own pending request lands.
      const landed = await c.query(
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, required_permission_code,
            requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',40,100,1,'svc.price.manage',$6,$6) RETURNING status`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, USER_A]
      );
      expect(landed.rows[0].status).toBe('pending');
    });
  });

  it('never lets the requester decide, and issues a discount only once somebody else approved it within their limit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, approval } = await pendingDiscount(c, 'd2');
      // Pending: the revision cannot be issued, whatever path asks.
      await expectFail(c, '23514', `SELECT quo.issue_revision($1)`, [revision]);
      // The requester approving their own request: the separation CHECK refuses it.
      await expectFail(
        c,
        '23514',
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approver_limit_amount = 1000, approver_limit_currency_code = 'USD'
          WHERE id = $1`,
        [approval, USER_A]
      );

      // Another person now.
      await setContext(c, { tenantId: TENANT_A, userId: OTHER_ACTOR });
      // They cannot record the decision in somebody else's name.
      await expectFail(
        c,
        '42501',
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approver_limit_amount = 1000, approver_limit_currency_code = 'USD'
          WHERE id = $1`,
        [approval, USER_A]
      );
      // An approval must carry the limit it was within...
      await expectFail(
        c,
        '23514',
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now()
          WHERE id = $1`,
        [approval, OTHER_ACTOR]
      );
      // ...and a limit below the discount, or in another currency, is no approval.
      for (const [amount, currency] of [
        ['39.9999', 'USD'],
        ['1000', 'JOD'],
      ]) {
        await expectFail(
          c,
          '23514',
          `UPDATE quo.discount_approvals
              SET status = 'approved', decided_by = $2, decided_at = now(),
                  approver_limit_amount = $3, approver_limit_currency_code = $4
            WHERE id = $1`,
          [approval, OTHER_ACTOR, amount, currency]
        );
      }
      // The positive control: another person, within their limit.
      await c.query(
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approver_limit_amount = 40, approver_limit_currency_code = 'USD'
          WHERE id = $1`,
        [approval, OTHER_ACTOR]
      );
      // Decided is final.
      await expectFail(
        c,
        '23514',
        `UPDATE quo.discount_approvals SET status = 'rejected', decision_reason = 'late' WHERE id = $1`,
        [approval]
      );
      // And now, and only now, the revision issues.
      await setContext(c, ctxA);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
      const status = await c.query(`SELECT status FROM quo.quotation_revisions WHERE id = $1`, [
        revision,
      ]);
      expect(status.rows[0].status).toBe('issued');
    });
  });

  it('never issues a turned-down discount, and keeps the request snapshot immutable', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, approval } = await pendingDiscount(c, 'd3');
      await setContext(c, { tenantId: TENANT_A, userId: OTHER_ACTOR });
      // The snapshot measured at the request cannot be rewritten, not even inside an
      // otherwise valid approval by somebody else — the immutability trigger refuses it.
      for (const assignment of [
        'discount_total = 1',
        "threshold_kind = 'percentage', threshold_value = 99, policy_id = gen_random_uuid(), policy_version_no = 9",
        "required_permission_code = 'quo.quotation.read'",
        'requested_by = gen_random_uuid()',
      ]) {
        await expectFail(
          c,
          '23514',
          `UPDATE quo.discount_approvals
              SET status = 'approved', decided_by = $2, decided_at = now(),
                  approver_limit_amount = 1000, approver_limit_currency_code = 'USD',
                  ${assignment}
            WHERE id = $1`,
          [approval, OTHER_ACTOR]
        );
      }
      // A rejection states its reason.
      await expectFail(
        c,
        '23514',
        `UPDATE quo.discount_approvals
            SET status = 'rejected', decided_by = $2, decided_at = now()
          WHERE id = $1`,
        [approval, OTHER_ACTOR]
      );
      await c.query(
        `UPDATE quo.discount_approvals
            SET status = 'rejected', decided_by = $2, decided_at = now(),
                decision_reason = 'Above what this job can carry'
          WHERE id = $1`,
        [approval, OTHER_ACTOR]
      );
      await setContext(c, ctxA);
      await expectFail(c, '23514', `SELECT quo.issue_revision($1)`, [revision]);
    });
  });

  it('keeps one tenant’s discount requests invisible and untouchable to another, with a positive control', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { approval } = await pendingDiscount(c, 'd4');
      const visible = async (): Promise<number> =>
        Number(
          (
            await c.query(`SELECT count(*)::int AS n FROM quo.discount_approvals WHERE id = $1`, [
              approval,
            ])
          ).rows[0].n
        );
      // Positive control: the owning tenant sees it.
      expect(await visible()).toBe(1);
      // Tenant B sees nothing and changes nothing.
      await setContext(c, { tenantId: TENANT_B, userId: USER_B });
      expect(await visible()).toBe(0);
      const updated = await c.query(
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approver_limit_amount = 1000, approver_limit_currency_code = 'USD'
          WHERE id = $1`,
        [approval, USER_B]
      );
      expect(updated.rowCount).toBe(0);
      // And back in tenant A the request is exactly as it was.
      await setContext(c, ctxA);
      const row = await c.query(`SELECT status FROM quo.discount_approvals WHERE id = $1`, [
        approval,
      ]);
      expect(row.rows[0].status).toBe('pending');
    });
  });

  it('versions a company discount threshold: content immutable, a superseded version stays superseded', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const insertVersion = (versionNo: number, value: string, status: string) =>
        c.query(
          `INSERT INTO svc.pricing_approval_policies
             (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
              required_permission_code, version_no, effective_from, status, created_by)
           VALUES ($1,$2,'discount','amount',$3,'USD','svc.price.manage',$4,current_date,$5,$6)
           RETURNING id`,
          [TENANT_A, COMPANY_A1, value, versionNo, status, USER_A]
        );
      const first = (await insertVersion(1, '10', 'active')).rows[0].id as string;
      // A threshold is not edited in place.
      await expectFail(
        c,
        '23514',
        `UPDATE svc.pricing_approval_policies SET threshold_value = 500 WHERE id = $1`,
        [first]
      );
      // The next version needs the current one retired first (one active per company),
      await expectFail(
        c,
        '23505',
        `INSERT INTO svc.pricing_approval_policies
           (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
            required_permission_code, version_no, effective_from, status, created_by)
         VALUES ($1,$2,'discount','amount',500,'USD','svc.price.manage',2,current_date,'active',$3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      await c.query(`UPDATE svc.pricing_approval_policies SET status = 'inactive' WHERE id = $1`, [
        first,
      ]);
      // and a version number is used once.
      await expectFail(
        c,
        '23505',
        `INSERT INTO svc.pricing_approval_policies
           (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
            required_permission_code, version_no, effective_from, status, created_by)
         VALUES ($1,$2,'discount','amount',500,'USD','svc.price.manage',1,current_date,'active',$3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      const second = (await insertVersion(2, '500', 'active')).rows[0].id as string;
      expect(second).not.toBe(first);
      // The superseded version cannot quietly come back.
      await c.query(`UPDATE svc.pricing_approval_policies SET status = 'inactive' WHERE id = $1`, [
        second,
      ]);
      await expectFail(
        c,
        '23514',
        `UPDATE svc.pricing_approval_policies SET status = 'active' WHERE id = $1`,
        [first]
      );
    });
  });
});
