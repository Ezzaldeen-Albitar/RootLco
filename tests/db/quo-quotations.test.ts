/**
 * Phase 1-10 — Quotations, revisions, items, approvals (FR-QUO-001/002, BR-QUO-001/002),
 * and the discount approval record with its versioned company threshold
 * (P1-32-PRE-OD-DISC-01, -04).
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
      // A company threshold above this discount, so it issues without a request: with
      // no policy the threshold is zero and a discounted revision needs an approval
      // (P1-32-PRE-OD-DISC-04), which the discount approval cases below prove.
      await c.query(
        `INSERT INTO svc.pricing_approval_policies
           (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
            required_permission_code, version_no, effective_from, status, created_by)
         VALUES ($1,$2,'discount','amount',50,'USD','svc.price.manage',1,current_date,'active',$3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
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
 * The discount approval record (P1-32-PRE-OD-DISC-01, -04), proved at the database.
 *
 * The application refuses each of these first and names the reason; these cases are
 * the second layer, so a path that forgot the application check still cannot land a
 * self-approved, over-limit, pending, superseded, re-measured or re-priced discount
 * on an issued revision. Every case runs as `app_runtime` through RLS, inside a
 * transaction that is rolled back.
 */
describe('quo discount approvals', () => {
  type C = { query: import('pg').Client['query'] };

  /** A refusal whose SQLSTATE AND message name the rule — a code alone is not proof. */
  async function expectRefusal(
    c: C,
    code: string,
    rule: RegExp,
    sql: string,
    params: unknown[] = []
  ): Promise<void> {
    await c.query('SAVEPOINT sp_refusal');
    let err: { code?: string; message?: string } | undefined;
    try {
      await c.query(sql, params);
    } catch (e) {
      err = e as { code?: string; message?: string };
    }
    await c.query('ROLLBACK TO SAVEPOINT sp_refusal');
    expect(err, `expected ${code} ${String(rule)} but the statement succeeded`).toBeDefined();
    expect(err?.code).toBe(code);
    expect(err?.message ?? '').toMatch(rule);
  }

  /** One discount policy version, written as the next version of its scope. */
  async function insertPolicy(
    c: C,
    versionNo: number,
    kind: 'amount' | 'percentage',
    value: string,
    currency: string | null,
    extra: { status?: string; deletedAt?: boolean; companyId?: string | null } = {}
  ): Promise<string> {
    return (
      await c.query(
        `INSERT INTO svc.pricing_approval_policies
           (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
            required_permission_code, version_no, effective_from, status, created_by,
            deleted_at)
         VALUES ($1,$2,'discount',$3,$4,$5,'svc.price.manage',$6,current_date,$7,$8,
                 CASE WHEN $9 THEN now() END)
         RETURNING id`,
        [
          TENANT_A,
          extra.companyId === undefined ? COMPANY_A1 : extra.companyId,
          kind,
          value,
          currency,
          versionNo,
          extra.status ?? 'active',
          USER_A,
          extra.deletedAt === true,
        ]
      )
    ).rows[0].id as string;
  }

  /** A pending request for `revision`, with an optional policy snapshot. */
  async function requestFor(
    c: C,
    quotation: string,
    revision: string,
    discount: string,
    snapshot: { policyId: string; versionNo: number; value: string } | null = null
  ): Promise<string> {
    return (
      await c.query(
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, policy_id, policy_version_no,
            threshold_kind, threshold_value, threshold_currency_code, required_permission_code,
            requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',$6,100,1,$7,$8,
                 CASE WHEN $7::uuid IS NULL THEN NULL ELSE 'amount' END, $9,
                 CASE WHEN $7::uuid IS NULL THEN NULL ELSE 'USD' END,
                 'svc.price.manage',$10,$10)
         RETURNING id`,
        [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          quotation,
          revision,
          discount,
          snapshot?.policyId ?? null,
          snapshot?.versionNo ?? null,
          snapshot?.value ?? null,
          USER_A,
        ]
      )
    ).rows[0].id as string;
  }

  /** Another person approves `approval` for `amount`, within a limit of 1000. */
  async function approveAs(c: C, approval: string, amount = '40'): Promise<void> {
    await setContext(c, { tenantId: TENANT_A, userId: OTHER_ACTOR });
    await c.query(
      `UPDATE quo.discount_approvals
          SET status = 'approved', decided_by = $2, decided_at = now(),
              approver_limit_amount = 1000, approver_limit_currency_code = 'USD',
              approved_discount_total = $3, approved_currency_code = 'USD'
        WHERE id = $1`,
      [approval, OTHER_ACTOR, amount]
    );
    await setContext(c, ctxA);
  }

  /** A quotation with one draft revision carrying one line discounted by `discount`. */
  async function discountedDraft(
    c: C,
    tag: string,
    discount = 40
  ): Promise<{ quotation: string; revision: string; service: string }> {
    const visit = await makeAuthorizedVisit(c);
    const wo = await newWorkOrder(c, visit);
    const { service } = await seedService(c, tag);
    const quotation = await seedQuotation(c, wo, tag);
    const revision = await draftRevision(c, quotation, 1);
    await addServiceItem(c, revision, service, 1, 100, 1, discount);
    return { quotation, revision, service };
  }

  /** A draft revision carrying one discounted line, and a pending request for it. */
  async function pendingDiscount(
    c: C,
    tag: string
  ): Promise<{ quotation: string; revision: string; approval: string; service: string }> {
    const draft = await discountedDraft(c, tag);
    const approval = await requestFor(c, draft.quotation, draft.revision, '40');
    return { ...draft, approval };
  }

  it('records the requester as the signed-in person and nobody else, born pending and never backfilled', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { quotation, revision } = await discountedDraft(c, 'd1');
      const insert = (requestedBy: string, status = 'pending', origin = 'requested') =>
        expectFail(
          c,
          ['42501', '23514'],
          `INSERT INTO quo.discount_approvals
             (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, status,
              origin, currency_code, discount_total, discount_base, elevated_line_count,
              required_permission_code, requested_by, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$8,'USD',40,100,1,'svc.price.manage',$7,$7)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, status, requestedBy, origin]
        );
      // Naming a colleague as the requester is refused by row security: the request is
      // the signed-in person's, never a value the caller chose.
      await insert(OTHER_ACTOR);
      // A request cannot be born approved.
      await insert(USER_A, 'approved');
      // Only the migration writes a backfilled request.
      await insert(USER_A, 'pending', 'backfilled');
      // The positive control: the signed-in person's own pending request lands.
      const landed = await requestFor(c, quotation, revision, '40');
      const row = await c.query(`SELECT status, origin FROM quo.discount_approvals WHERE id = $1`, [
        landed,
      ]);
      expect(row.rows[0]).toEqual({ status: 'pending', origin: 'requested' });
    });
  });

  it('never lets the requester decide, and issues a discount only once somebody else approved that amount within their limit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, approval } = await pendingDiscount(c, 'd2');
      // Pending: the revision cannot be issued, whatever path asks.
      await expectRefusal(
        c,
        '23514',
        /discount_approval_pending/,
        `SELECT quo.issue_revision($1)`,
        [revision]
      );
      const approve = (decidedBy: string, limit: string, currency: string, approved = '40') =>
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = '${decidedBy}', decided_at = now(),
                approver_limit_amount = ${limit}, approver_limit_currency_code = '${currency}',
                approved_discount_total = ${approved}, approved_currency_code = 'USD'
          WHERE id = $1`;
      // The requester approving their own request: the separation CHECK refuses it.
      await expectRefusal(
        c,
        '23514',
        /ck_discount_approvals_separation/,
        approve(USER_A, '1000', 'USD'),
        [approval]
      );

      // Another person now.
      await setContext(c, { tenantId: TENANT_A, userId: OTHER_ACTOR });
      // They cannot record the decision in somebody else's name.
      await expectFail(c, '42501', approve(USER_A, '1000', 'USD'), [approval]);
      // An approval must carry the limit it was within...
      await expectRefusal(
        c,
        '23514',
        /ck_discount_approvals_limit_state/,
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approved_discount_total = 40, approved_currency_code = 'USD'
          WHERE id = $1`,
        [approval, OTHER_ACTOR]
      );
      // ...and the amount it approved, which is exactly the amount asked for...
      await expectRefusal(
        c,
        '23514',
        /ck_discount_approvals_approved_amount/,
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approver_limit_amount = 1000, approver_limit_currency_code = 'USD'
          WHERE id = $1`,
        [approval, OTHER_ACTOR]
      );
      await expectRefusal(
        c,
        '23514',
        /ck_discount_approvals_approved_amount/,
        approve(OTHER_ACTOR, '1000', 'USD', '39'),
        [approval]
      );
      // ...and a limit below the discount, or in another currency, is no approval.
      for (const [amount, currency] of [
        ['39.9999', 'USD'],
        ['1000', 'JOD'],
      ] as const) {
        await expectRefusal(
          c,
          '23514',
          /ck_discount_approvals_within_limit/,
          approve(OTHER_ACTOR, amount, currency),
          [approval]
        );
      }
      // The positive control: another person, within their limit, for the amount asked.
      await c.query(approve(OTHER_ACTOR, '40', 'USD'), [approval]);
      // Decided is final.
      await expectRefusal(
        c,
        '23514',
        /discount_approval_already_decided/,
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

  it('binds the approval to the amount: a revision whose lines changed after approval is not issued', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, approval } = await pendingDiscount(c, 'd2b');
      await approveAs(c, approval);
      // The draft's line is re-priced to a larger discount after the approval.
      await c.query(
        `UPDATE quo.quotation_items
            SET captured_discount = 60, captured_tax_amount = 0, captured_line_total = 40
          WHERE quotation_revision_id = $1`,
        [revision]
      );
      await expectRefusal(
        c,
        '23514',
        /discount_approval_amount_mismatch/,
        `SELECT quo.issue_revision($1)`,
        [revision]
      );
      // Positive control: back to the approved amount, and it issues.
      await c.query(
        `UPDATE quo.quotation_items
            SET captured_discount = 40, captured_tax_amount = 0, captured_line_total = 60
          WHERE quotation_revision_id = $1`,
        [revision]
      );
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
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
        "origin = 'backfilled'",
      ]) {
        await expectRefusal(
          c,
          '23514',
          /is immutable/,
          `UPDATE quo.discount_approvals
              SET status = 'approved', decided_by = $2, decided_at = now(),
                  approver_limit_amount = 1000, approver_limit_currency_code = 'USD',
                  approved_discount_total = 40, approved_currency_code = 'USD',
                  ${assignment}
            WHERE id = $1`,
          [approval, OTHER_ACTOR]
        );
      }
      // A rejection states its reason.
      await expectRefusal(
        c,
        '23514',
        /ck_discount_approvals_rejection_reason/,
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
      await expectRefusal(
        c,
        '23514',
        /discount_approval_rejected/,
        `SELECT quo.issue_revision($1)`,
        [revision]
      );
    });
  });

  it('refuses to issue a discounted revision that never asked, measured against the policy in force', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // No policy: a threshold of zero, so any non-zero discount needs a request.
      const { revision } = await discountedDraft(c, 'd5');
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [revision]
      );
      // A threshold below the discount: still needed. A percentage is measured on the
      // line (40 of 100 is 40%).
      await insertPolicy(c, 1, 'percentage', '40', null);
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [revision]
      );
      // Positive control: a threshold above it, recorded as the next version.
      await insertPolicy(c, 2, 'percentage', '40.0001', null);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
    });
  });

  it('holds a revision that replaced an open request to that request’s snapshot, not to a threshold raised since', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const v1 = await insertPolicy(c, 1, 'amount', '10', 'USD');
      const { quotation, revision, service } = await discountedDraft(c, 'd6');
      const first = await requestFor(c, quotation, revision, '40', {
        policyId: v1,
        versionNo: 1,
        value: '10',
      });
      // The threshold is raised ABOVE the discount after the request was recorded.
      await insertPolicy(c, 2, 'amount', '100', 'USD');
      // A second revision with the same discount, and no request of its own.
      const second = await draftRevision(c, quotation, 2);
      await addServiceItem(c, second, service, 1, 100, 1, 40);
      // While the first request is open a new one cannot be recorded...
      await expectRefusal(
        c,
        '23514',
        /discount_approval_open/,
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, required_permission_code,
            requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',40,100,1,'svc.price.manage',$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, second, USER_A]
      );
      // ...and the second revision is held to the open request's snapshot (10), not
      // the version in force (100).
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [second]
      );
      // Superseding: only by a newer revision of the same quotation...
      await expectRefusal(
        c,
        '23514',
        /superseded only by a newer revision/,
        `UPDATE quo.discount_approvals
            SET status = 'superseded', superseded_at = now(), superseded_by_revision_id = $2
          WHERE id = $1`,
        [first, revision]
      );
      await c.query(
        `UPDATE quo.discount_approvals
            SET status = 'superseded', superseded_at = now(), superseded_by_revision_id = $2
          WHERE id = $1`,
        [first, second]
      );
      // ...after which the superseded request can never be approved...
      await setContext(c, { tenantId: TENANT_A, userId: OTHER_ACTOR });
      await expectRefusal(
        c,
        '23514',
        /discount_approval_superseded/,
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approver_limit_amount = 1000, approver_limit_currency_code = 'USD',
                approved_discount_total = 40, approved_currency_code = 'USD'
          WHERE id = $1`,
        [first, OTHER_ACTOR]
      );
      await setContext(c, ctxA);
      // ...the replacing revision still cannot be issued without a request (snapshot 10)...
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [second]
      );
      // ...and a request for it must carry the SAME snapshot, not the raised version.
      await expectRefusal(
        c,
        '23514',
        /discount_approval_snapshot_changed/,
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, required_permission_code,
            requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',40,100,1,'svc.price.manage',$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, second, USER_A]
      );
      const renewed = await requestFor(c, quotation, second, '40', {
        policyId: v1,
        versionNo: 1,
        value: '10',
      });
      await expectRefusal(
        c,
        '23514',
        /discount_approval_pending/,
        `SELECT quo.issue_revision($1)`,
        [second]
      );
      // Positive control: somebody else approves the renewed request, and it issues.
      await approveAs(c, renewed);
      await c.query(`SELECT quo.issue_revision($1)`, [second]);
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
                approver_limit_amount = 1000, approver_limit_currency_code = 'USD',
                approved_discount_total = 40, approved_currency_code = 'USD'
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

  it('versions a company discount threshold: next number only, immutable, retired only by the next version', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const first = await insertPolicy(c, 1, 'amount', '10', 'USD');
      // A threshold is not edited in place — its value, validity or deletion.
      for (const assignment of [
        'threshold_value = 500',
        'effective_to = current_date + 1',
        'deleted_at = now()',
      ]) {
        await expectRefusal(
          c,
          '23514',
          /is immutable/,
          `UPDATE svc.pricing_approval_policies SET ${assignment} WHERE id = $1`,
          [first]
        );
      }
      // Its status moves only when the next version is recorded, never directly.
      await expectRefusal(
        c,
        '23514',
        /changes only when the next version is recorded/,
        `UPDATE svc.pricing_approval_policies SET status = 'inactive' WHERE id = $1`,
        [first]
      );
      // A version number is the NEXT one: reusing 1 or skipping to 3 is refused.
      for (const versionNo of [1, 3]) {
        await expectRefusal(
          c,
          '23505',
          /not the next version/,
          `INSERT INTO svc.pricing_approval_policies
             (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
              required_permission_code, version_no, effective_from, status, created_by)
           VALUES ($1,$2,'discount','amount',500,'USD','svc.price.manage',$3,current_date,'active',$4)`,
          [TENANT_A, COMPANY_A1, versionNo, USER_A]
        );
      }
      // Recording version 2 retires version 1 in the same statement.
      const second = await insertPolicy(c, 2, 'amount', '500', 'USD');
      const states = await c.query(
        `SELECT id, version_no, status FROM svc.pricing_approval_policies
          WHERE tenant_id = $1 AND company_id = $2 AND policy_type = 'discount'
          ORDER BY version_no`,
        [TENANT_A, COMPANY_A1]
      );
      expect(states.rows).toEqual([
        { id: first, version_no: 1, status: 'inactive' },
        { id: second, version_no: 2, status: 'active' },
      ]);
      // The superseded version cannot quietly come back.
      await expectRefusal(
        c,
        '23514',
        /changes only when the next version is recorded/,
        `UPDATE svc.pricing_approval_policies SET status = 'active' WHERE id = $1`,
        [first]
      );
      // A soft-deleted or retired highest row still holds its number: the next is 4.
      await insertPolicy(c, 3, 'amount', '700', 'USD', { status: 'inactive', deletedAt: true });
      await expectRefusal(
        c,
        '23505',
        /not the next version/,
        `INSERT INTO svc.pricing_approval_policies
           (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
            required_permission_code, version_no, effective_from, status, created_by)
         VALUES ($1,$2,'discount','amount',900,'USD','svc.price.manage',3,current_date,'active',$3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      await insertPolicy(c, 4, 'amount', '900', 'USD');
      const active = await c.query(
        `SELECT version_no FROM svc.pricing_approval_policies
          WHERE tenant_id = $1 AND company_id = $2 AND policy_type = 'discount'
            AND status = 'active' AND deleted_at IS NULL`,
        [TENANT_A, COMPANY_A1]
      );
      expect(active.rows).toEqual([{ version_no: 4 }]);
    });
  });
});
