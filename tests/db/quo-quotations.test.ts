/**
 * Phase 1-10 — Quotations, revisions, items, approvals (FR-QUO-001/002, BR-QUO-001/002),
 * and the discount approval record with its versioned company threshold
 * (P1-32-PRE-OD-DISC-01, -04, -07).
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
      // A company threshold above this discount, in force when the quotation is written
      // (the quotation is held to it), so it issues without a request: with no policy
      // the threshold is zero and a discounted revision needs an approval
      // (P1-32-PRE-OD-DISC-04, -07), which the discount approval cases below prove.
      await c.query(
        `INSERT INTO svc.pricing_approval_policies
           (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
            required_permission_code, version_no, effective_from, status, created_by)
         VALUES ($1,$2,'discount','amount',50,'USD','svc.price.manage',1,current_date,'active',$3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
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
 * The discount approval record (P1-32-PRE-OD-DISC-01, -04, -07), proved at the database.
 *
 * The application refuses each of these first and names the reason; these cases are
 * the second layer, so a path that forgot the application check still cannot land a
 * self-approved, unpermitted, over-limit, pending, superseded, re-measured or
 * re-priced discount on an issued revision. Unless a case says otherwise it runs as
 * `app_runtime` through RLS, inside a transaction that is rolled back.
 */
describe('quo discount approvals', () => {
  type C = { query: import('pg').Client['query'] };

  /** Holds `svc.price.manage` and a discount limit of 1000 USD that USER_A set. */
  const APPROVER = 'd15c0000-0000-4000-8000-000000000001';
  /** Holds the permission; their limit, 39.9999 USD, is below a 40 discount. */
  const APPROVER_LOW = 'd15c0000-0000-4000-8000-000000000002';
  /** Holds the permission; their limit is 1000 JOD. */
  const APPROVER_JOD = 'd15c0000-0000-4000-8000-000000000003';
  /** Holds the permission; the only limit on file is one they set for themselves. */
  const APPROVER_SELF_SET = 'd15c0000-0000-4000-8000-000000000004';
  /** A limit of 1000 USD that USER_A set, and no permission. */
  const NO_PERMISSION = 'd15c0000-0000-4000-8000-000000000005';
  const ROLE_PRICE_MANAGER = 'd15c0000-0000-4000-8000-0000000000a1';

  beforeAll(async () => {
    const people: ReadonlyArray<readonly [string, string, boolean]> = [
      [APPROVER, '01', true],
      [APPROVER_LOW, '02', true],
      [APPROVER_JOD, '03', true],
      [APPROVER_SELF_SET, '04', true],
      [NO_PERMISSION, '05', false],
    ];
    for (const [id, n] of people) {
      await admin.query(
        `INSERT INTO iam.user_accounts
           (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1::uuid, $2::uuid, 'test_harness', $3, $4, $5, 'active', $6::uuid)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          TENANT_A,
          `fx_db_disc_${n}`,
          `db-disc-${n}@example.test`,
          `Fixture approver ${n}`,
          USER_A,
        ]
      );
    }
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
       VALUES ($1::uuid, $2::uuid, 'fx_db_price_manager', 'DB fixture price manager', $3::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [ROLE_PRICE_MANAGER, TENANT_A, USER_A]
    );
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
         FROM iam.permissions p WHERE p.permission_code = 'svc.price.manage'
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [TENANT_A, ROLE_PRICE_MANAGER, USER_A]
    );
    for (const [id, , permitted] of people) {
      if (!permitted) continue;
      await admin.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         SELECT $1::uuid, $2::uuid, $3::uuid, 'unrestricted', $4::uuid, $4::uuid
          WHERE NOT EXISTS (
            SELECT 1 FROM iam.role_grants
             WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND role_id = $3::uuid
               AND status = 'active')`,
        [TENANT_A, id, ROLE_PRICE_MANAGER, USER_A]
      );
    }
    const limits: ReadonlyArray<readonly [string, string, string, string]> = [
      [APPROVER, '1000', 'USD', USER_A],
      [APPROVER_LOW, '39.9999', 'USD', USER_A],
      [APPROVER_JOD, '1000', 'JOD', USER_A],
      [APPROVER_SELF_SET, '1000', 'USD', APPROVER_SELF_SET],
      [NO_PERMISSION, '1000', 'USD', USER_A],
    ];
    for (const [id, amount, currency, setBy] of limits) {
      await admin.query(
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
         SELECT $1::uuid, $2::uuid, $3::uuid, 'discount', $4::numeric, $5, current_date - 1, $6::uuid
          WHERE NOT EXISTS (
            SELECT 1 FROM iam.approval_limits
             WHERE tenant_id = $1::uuid AND user_id = $3::uuid AND limit_type = 'discount')`,
        [TENANT_A, COMPANY_A1, id, amount, currency, setBy]
      );
    }
  });

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

  /** The discount policy a quotation is pinned to. */
  async function pinOf(
    c: C,
    quotation: string
  ): Promise<{ id: string | null; version: number | null; pinnedAt: Date | null }> {
    const row = (
      await c.query(
        `SELECT discount_policy_id, discount_policy_version_no, discount_policy_pinned_at
           FROM quo.quotations WHERE id = $1`,
        [quotation]
      )
    ).rows[0];
    return {
      id: row.discount_policy_id,
      version: row.discount_policy_version_no,
      pinnedAt: row.discount_policy_pinned_at,
    };
  }

  /**
   * A pending request for `revision`, carrying its quotation's pinned policy unless
   * `snapshot` names another one.
   */
  async function requestFor(
    c: C,
    quotation: string,
    revision: string,
    discount: string,
    snapshot?: { policyId: string; versionNo: number; value: string }
  ): Promise<string> {
    if (snapshot !== undefined) {
      return (
        await c.query(
          `INSERT INTO quo.discount_approvals
             (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
              discount_total, discount_base, elevated_line_count, policy_id, policy_version_no,
              threshold_kind, threshold_value, threshold_currency_code, required_permission_code,
              requested_by, created_by)
           VALUES ($1,$2,$3,$4,$5,'USD',$6,100,1,$7,$8,'amount',$9,'USD','svc.price.manage',$10,$10)
           RETURNING id`,
          [
            TENANT_A,
            COMPANY_A1,
            BRANCH_A1,
            quotation,
            revision,
            discount,
            snapshot.policyId,
            snapshot.versionNo,
            snapshot.value,
            USER_A,
          ]
        )
      ).rows[0].id as string;
    }
    return (
      await c.query(
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, policy_id, policy_version_no,
            threshold_kind, threshold_value, threshold_currency_code, required_permission_code,
            requested_by, created_by)
         SELECT $1,$2,$3,$4,$5,'USD',$6,100,1,p.id,p.version_no,p.threshold_kind,
                p.threshold_value,p.currency_code,
                COALESCE(p.required_permission_code, 'svc.price.manage'),$7,$7
           FROM quo.quotation_discount_policy($1, $4) p
         RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, discount, USER_A]
      )
    ).rows[0].id as string;
  }

  /** The decision `decider` records on `approval`, as that signed-in person. */
  const approveSql = (extra = '') =>
    `UPDATE quo.discount_approvals
        SET status = 'approved', decided_by = $2, decided_at = now(),
            approved_discount_total = discount_total, approved_currency_code = currency_code
            ${extra}
      WHERE id = $1`;

  /** `decider` approves `approval`, then the context returns to USER_A. */
  async function approveAs(c: C, approval: string, decider = APPROVER): Promise<void> {
    await setContext(c, { tenantId: TENANT_A, userId: decider });
    await c.query(approveSql(), [approval, decider]);
    await setContext(c, ctxA);
  }

  /** A quotation on `wo` with one draft revision carrying one line discounted by `discount`. */
  async function draftOn(
    c: C,
    wo: string,
    service: string,
    tag: string,
    discount: number
  ): Promise<{ quotation: string; revision: string }> {
    const quotation = await seedQuotation(c, wo, tag);
    const revision = await draftRevision(c, quotation, 1);
    await addServiceItem(c, revision, service, 1, 100, 1, discount);
    return { quotation, revision };
  }

  /** A work order and a service to quote it with. */
  async function quotable(c: C, tag: string): Promise<{ wo: string; service: string }> {
    const visit = await makeAuthorizedVisit(c);
    const wo = await newWorkOrder(c, visit);
    const { service } = await seedService(c, tag);
    return { wo, service };
  }

  /** A quotation with one draft revision carrying one line discounted by `discount`. */
  async function discountedDraft(
    c: C,
    tag: string,
    discount = 40
  ): Promise<{ quotation: string; revision: string; service: string; wo: string }> {
    const { wo, service } = await quotable(c, tag);
    return { ...(await draftOn(c, wo, service, tag, discount)), service, wo };
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

  it('pins every quotation to the discount policy in force when it is written, whatever the writer says, and never lets it move', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await quotable(c, 'p1');
      // Nothing configured: pinned to none — a threshold of zero — but pinned.
      const none = await seedQuotation(c, wo, 'p1a');
      const unconfigured = await pinOf(c, none);
      expect(unconfigured.id).toBeNull();
      expect(unconfigured.version).toBeNull();
      expect(unconfigured.pinnedAt).not.toBeNull();

      const v1 = await insertPolicy(c, 1, 'amount', '10', 'USD');
      // A writer naming another version, or none, is overruled by the database.
      const forged = (
        await c.query(
          `INSERT INTO quo.quotations
             (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code,
              created_by, discount_policy_id, discount_policy_version_no, discount_policy_pinned_at)
           VALUES ($1,$2,$3,$4,'Q-p1b','USD',$5,gen_random_uuid(),99,now() - interval '1 year')
           RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
        )
      ).rows[0].id as string;
      expect(await pinOf(c, forged)).toMatchObject({ id: v1, version: 1 });

      // The pin never moves: not its version, not its time, not back to none.
      for (const assignment of [
        'discount_policy_version_no = 2',
        'discount_policy_id = NULL, discount_policy_version_no = NULL',
        "discount_policy_pinned_at = now() + interval '1 day'",
      ]) {
        await expectRefusal(
          c,
          '23514',
          /quotation_discount_policy_pinned/,
          `UPDATE quo.quotations SET ${assignment} WHERE id = $1`,
          [forged]
        );
      }
      // A later version reaches new quotations only.
      const v2 = await insertPolicy(c, 2, 'amount', '100', 'USD');
      expect(await pinOf(c, forged)).toMatchObject({ id: v1, version: 1 });
      expect((await pinOf(c, none)).id).toBeNull();
      const later = await seedQuotation(c, wo, 'p1c');
      expect(await pinOf(c, later)).toMatchObject({ id: v2, version: 2 });
    });
    // The organisation-wide version is pinned when the company has none of its own.
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await quotable(c, 'p2');
      const orgWide = await insertPolicy(c, 1, 'amount', '25', 'USD', { companyId: null });
      const quotation = await seedQuotation(c, wo, 'p2a');
      expect(await pinOf(c, quotation)).toMatchObject({ id: orgWide, version: 1 });
    });
  });

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
      await insert(APPROVER);
      // A request cannot be born approved.
      await insert(USER_A, 'approved');
      // Only the backfill writes a backfilled request.
      await insert(USER_A, 'pending', 'backfilled');
      // A request is for the discount the lines carry, not another amount.
      await expectRefusal(
        c,
        '23514',
        /discount_approval_total_mismatch/,
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, required_permission_code,
            requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',39,100,1,'svc.price.manage',$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, USER_A]
      );
      // The positive control: the signed-in person's own pending request lands.
      const landed = await requestFor(c, quotation, revision, '40');
      const row = await c.query(`SELECT status, origin FROM quo.discount_approvals WHERE id = $1`, [
        landed,
      ]);
      expect(row.rows[0]).toEqual({ status: 'pending', origin: 'requested' });
    });
  });

  it('checks every decision itself: the signed-in person, not the requester, holding the recorded permission and a limit it computes', async () => {
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
      // The requester approving their own request.
      await expectRefusal(c, '23514', /discount_approver_must_differ/, approveSql(), [
        approval,
        USER_A,
      ]);

      const as = (userId: string) => setContext(c, { tenantId: TENANT_A, userId });
      // Nobody records a decision in another person's name.
      await as(APPROVER);
      await expectRefusal(c, '23514', /discount_approval_decider_mismatch/, approveSql(), [
        approval,
        APPROVER_LOW,
      ]);
      // Without the recorded permission, neither approving nor turning down.
      await as(NO_PERMISSION);
      await expectRefusal(c, '23514', /discount_approval_permission_missing/, approveSql(), [
        approval,
        NO_PERMISSION,
      ]);
      await expectRefusal(
        c,
        '23514',
        /discount_approval_permission_missing/,
        `UPDATE quo.discount_approvals
            SET status = 'rejected', decided_by = $2, decided_at = now(), decision_reason = 'No'
          WHERE id = $1`,
        [approval, NO_PERMISSION]
      );
      // The limit is the database's own reading of iam.approval_limits: one set by the
      // approver counts for nothing, one below the discount or in another currency is
      // refused by name — and a limit the caller writes changes none of that.
      await as(APPROVER_SELF_SET);
      await expectRefusal(c, '23514', /discount_no_approval_limit/, approveSql(), [
        approval,
        APPROVER_SELF_SET,
      ]);
      await as(APPROVER_LOW);
      await expectRefusal(
        c,
        '23514',
        /discount_over_approval_limit/,
        approveSql(", approver_limit_amount = 1000000, approver_limit_currency_code = 'USD'"),
        [approval, APPROVER_LOW]
      );
      await as(APPROVER_JOD);
      await expectRefusal(c, '23514', /discount_limit_currency_mismatch/, approveSql(), [
        approval,
        APPROVER_JOD,
      ]);
      // ...and the amount it approved is exactly the amount asked for.
      await as(APPROVER);
      await expectRefusal(
        c,
        '23514',
        /ck_discount_approvals_approved_amount/,
        `UPDATE quo.discount_approvals
            SET status = 'approved', decided_by = $2, decided_at = now(),
                approved_discount_total = 39, approved_currency_code = 'USD'
          WHERE id = $1`,
        [approval, APPROVER]
      );
      // The positive control: another person, within their limit. The limit on the row
      // is the one the database computed, not the one the caller wrote.
      await c.query(
        approveSql(", approver_limit_amount = 1000000, approver_limit_currency_code = 'JOD'"),
        [approval, APPROVER]
      );
      const decided = await c.query(
        `SELECT status, decided_by, approver_limit_amount::text AS amount,
                approver_limit_currency_code AS currency
           FROM quo.discount_approvals WHERE id = $1`,
        [approval]
      );
      expect(decided.rows[0]).toEqual({
        status: 'approved',
        decided_by: APPROVER,
        amount: '1000.0000',
        currency: 'USD',
      });
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

  it('lets a person with the permission but no covering limit turn a request down, and not approve it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, approval } = await pendingDiscount(c, 'd2r');
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER_LOW });
      await c.query(
        `UPDATE quo.discount_approvals
            SET status = 'rejected', decided_by = $2, decided_at = now(),
                decision_reason = 'Too generous for this job',
                approver_limit_amount = 5, approver_limit_currency_code = 'USD'
          WHERE id = $1`,
        [approval, APPROVER_LOW]
      );
      const row = await c.query(
        `SELECT status, approver_limit_amount FROM quo.discount_approvals WHERE id = $1`,
        [approval]
      );
      // A rejection carries no limit, whatever the caller wrote.
      expect(row.rows[0]).toEqual({ status: 'rejected', approver_limit_amount: null });
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

  it('freezes the lines of a revision once it asked for a discount approval', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, service } = await discountedDraft(c, 'd2f');
      // Positive control: before any request, a draft line is edited freely.
      await c.query(
        `UPDATE quo.quotation_items SET description = 'Before asking' WHERE quotation_revision_id = $1`,
        [revision]
      );
      const quotation = (
        await c.query(`SELECT quotation_id FROM quo.quotation_revisions WHERE id = $1`, [revision])
      ).rows[0].quotation_id as string;
      const approval = await requestFor(c, quotation, revision, '40');
      const refusals = async (): Promise<void> => {
        await expectRefusal(
          c,
          '23514',
          /discount_request_freezes_items/,
          `UPDATE quo.quotation_items
              SET captured_discount = 60, captured_tax_amount = 0, captured_line_total = 40
            WHERE quotation_revision_id = $1`,
          [revision]
        );
        await expectRefusal(
          c,
          '23514',
          /discount_request_freezes_items/,
          `INSERT INTO quo.quotation_items
             (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind,
              service_id, currency_code, captured_unit_price, captured_quantity, captured_discount,
              captured_tax_rate, captured_tax_amount, captured_line_total, created_by)
           VALUES ($1,$2,$3,$4,2,'service',$5,'USD',10,1,0,0,0,10,$6)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, revision, service, USER_A]
        );
      };
      await refusals();
      await approveAs(c, approval);
      await refusals();
    });
    // No role escapes it, and a delete is a change too.
    await withRolledBackTx(admin, ctxA, async (c) => {
      const { quotation, revision } = await discountedDraft(c, 'd2g');
      await requestFor(c, quotation, revision, '40');
      await expectRefusal(
        c,
        '23514',
        /discount_request_freezes_items/,
        `DELETE FROM quo.quotation_items WHERE quotation_revision_id = $1`,
        [revision]
      );
    });
  });

  it('sums the lines itself at issue: a captured total that agrees with the approval does not hide lines that do not', async () => {
    // As the owner, because only a superuser can step around the line freeze to build
    // the state this guard exists for.
    await withRolledBackTx(admin, ctxA, async (c) => {
      const { quotation, revision } = await discountedDraft(c, 'd2b');
      const approval = await requestFor(c, quotation, revision, '40');
      await approveAs(c, approval);
      // Around the freeze: the line now carries 60, the approval is of 40.
      await c.query(`SET LOCAL session_replication_role = 'replica'`);
      await c.query(
        `UPDATE quo.quotation_items
            SET captured_discount = 60, captured_tax_amount = 0, captured_line_total = 40
          WHERE quotation_revision_id = $1`,
        [revision]
      );
      await c.query(`SET LOCAL session_replication_role = 'origin'`);
      // A writer that states the APPROVED amount as the captured total is still refused:
      // the guard reads the lines, not the total it was handed.
      await expectRefusal(
        c,
        '23514',
        /discount_approval_amount_mismatch/,
        `UPDATE quo.quotation_revisions
            SET status = 'issued', issued_at = now(), captured_subtotal = 100,
                captured_discount_total = 40, captured_tax_total = 0, captured_grand_total = 60
          WHERE id = $1`,
        [revision]
      );
      await expectRefusal(
        c,
        '23514',
        /discount_approval_amount_mismatch/,
        `SELECT quo.issue_revision($1)`,
        [revision]
      );
      // Positive control: the approved amount on the line again, and it issues.
      await c.query(`SET LOCAL session_replication_role = 'replica'`);
      await c.query(
        `UPDATE quo.quotation_items
            SET captured_discount = 40, captured_tax_amount = 0, captured_line_total = 60
          WHERE quotation_revision_id = $1`,
        [revision]
      );
      await c.query(`SET LOCAL session_replication_role = 'origin'`);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
    });
  });

  it('never issues a turned-down discount, and keeps the request snapshot immutable', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, approval } = await pendingDiscount(c, 'd3');
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      // The snapshot measured at the request cannot be rewritten, not even inside an
      // otherwise valid approval by somebody else — the immutability trigger refuses it.
      for (const assignment of [
        'discount_total = 1',
        "threshold_kind = 'percentage', threshold_value = 99, policy_id = gen_random_uuid(), policy_version_no = 9",
        "required_permission_code = 'quo.quotation.read'",
        'requested_by = gen_random_uuid()',
        "origin = 'backfilled'",
      ]) {
        await expectRefusal(c, '23514', /is immutable/, approveSql(`, ${assignment}`), [
          approval,
          APPROVER,
        ]);
      }
      // A rejection states its reason.
      await expectRefusal(
        c,
        '23514',
        /ck_discount_approvals_rejection_reason/,
        `UPDATE quo.discount_approvals
            SET status = 'rejected', decided_by = $2, decided_at = now()
          WHERE id = $1`,
        [approval, APPROVER]
      );
      await c.query(
        `UPDATE quo.discount_approvals
            SET status = 'rejected', decided_by = $2, decided_at = now(),
                decision_reason = 'Above what this job can carry'
          WHERE id = $1`,
        [approval, APPROVER]
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

  it('refuses to issue a discounted revision that never asked, measured against the policy its quotation is pinned to', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, service } = await quotable(c, 'd5');
      // Written with no policy: a threshold of zero, so any non-zero discount needs a
      // request — and a policy configured afterwards does not reach this quotation.
      const unconfigured = await draftOn(c, wo, service, 'd5a', 40);
      await insertPolicy(c, 1, 'percentage', '40.0001', null);
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [unconfigured.revision]
      );
      // Written under a threshold at the discount: still needed. A percentage is measured
      // on the line (40 of 100 is 40%).
      await insertPolicy(c, 2, 'percentage', '40', null);
      const atThreshold = await draftOn(c, wo, service, 'd5b', 40);
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [atThreshold.revision]
      );
      // Positive control: written under a threshold above it, it issues.
      await insertPolicy(c, 3, 'percentage', '40.0001', null);
      const underThreshold = await draftOn(c, wo, service, 'd5c', 40);
      await c.query(`SELECT quo.issue_revision($1)`, [underThreshold.revision]);
    });
  });

  /**
   * P1-32-PRE-OD-DISC-09: the issue guard watches the draft -> issued UPDATE, so a
   * revision written already issued would never meet it. `tg_quotation_revisions_written_as_draft`
   * refuses any revision written past draft — on the request path and by a role that
   * bypasses row level security alike.
   */
  it('writes a revision only as a draft, so no revision reaches issued around the issue guard', async () => {
    const writePastDraft = `INSERT INTO quo.quotation_revisions
         (tenant_id, company_id, branch_id, quotation_id, revision_number, status, issued_at,
          currency_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 'USD', $7)`;
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await quotable(c, 'd9');
      const quotation = (
        await c.query<{ id: string }>(
          `INSERT INTO quo.quotations (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code, created_by)
           VALUES ($1, $2, $3, $4, 'Q-d9', 'USD', $5) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
        )
      ).rows[0]!.id;
      for (const status of ['issued', 'superseded', 'rejected', 'expired']) {
        await expectRefusal(c, '23514', /quotation_revision_written_as_draft/, writePastDraft, [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          quotation,
          1,
          status,
          USER_A,
        ]);
      }
      // Positive control: the same row written as a draft is accepted.
      const draft = await c.query(
        `INSERT INTO quo.quotation_revisions
           (tenant_id, company_id, branch_id, quotation_id, revision_number, status, currency_code, created_by)
         VALUES ($1, $2, $3, $4, 1, 'draft', 'USD', $5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, USER_A]
      );
      expect(draft.rowCount).toBe(1);
      // A role that bypasses row level security is held to it too.
      await withRolledBackTx(admin, ctxA, async (a) => {
        await expectRefusal(a, '23514', /quotation_revision_written_as_draft/, writePastDraft, [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          quotation,
          2,
          'issued',
          USER_A,
        ]);
      });
    });
  });

  it('holds every revision to its quotation’s pinned policy: raising the threshold, revising the discount away and back, still needs another approver', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const v1 = await insertPolicy(c, 1, 'amount', '10', 'USD');
      const { quotation, revision, service } = await discountedDraft(c, 'd6');
      const first = await requestFor(c, quotation, revision, '40');
      expect(
        (await c.query(`SELECT policy_id FROM quo.discount_approvals WHERE id = $1`, [first]))
          .rows[0].policy_id
      ).toBe(v1);
      // The threshold is raised ABOVE the discount after the request was recorded.
      const v2 = await insertPolicy(c, 2, 'amount', '100', 'USD');
      // Step one of the escape: a revision with NO discount replaces the request...
      const second = await draftRevision(c, quotation, 2);
      await addServiceItem(c, second, service, 1, 100, 1, 0);
      // (while the first request is open, a new one cannot be recorded)
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
      // ...after which the superseded request can never be approved.
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await expectRefusal(c, '23514', /discount_approval_superseded/, approveSql(), [
        first,
        APPROVER,
      ]);
      await setContext(c, ctxA);
      // Step two: the discount comes back on a third revision, with no request of its
      // own. It is measured against the quotation's pinned version (10), not the raised
      // one (100): it cannot be issued.
      const third = await draftRevision(c, quotation, 3);
      await addServiceItem(c, third, service, 1, 100, 1, 40);
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [third]
      );
      // A request carrying the raised version is refused; it carries the pinned one.
      await expectRefusal(
        c,
        '23514',
        /discount_approval_snapshot_mismatch/,
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, required_permission_code,
            requested_by, created_by)
         VALUES ($1,$2,$3,$4,$5,'USD',40,100,1,'svc.price.manage',$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, third, USER_A]
      );
      await c.query('SAVEPOINT sp_raised');
      await expect(
        requestFor(c, quotation, third, '40', { policyId: v2, versionNo: 2, value: '100' })
      ).rejects.toThrow(/discount_approval_snapshot_mismatch/);
      await c.query('ROLLBACK TO SAVEPOINT sp_raised');
      const renewed = await requestFor(c, quotation, third, '40');
      expect(
        (await c.query(`SELECT policy_id FROM quo.discount_approvals WHERE id = $1`, [renewed]))
          .rows[0].policy_id
      ).toBe(v1);
      await expectRefusal(
        c,
        '23514',
        /discount_approval_pending/,
        `SELECT quo.issue_revision($1)`,
        [third]
      );
      // Its requester still cannot approve it.
      await expectRefusal(c, '23514', /discount_approver_must_differ/, approveSql(), [
        renewed,
        USER_A,
      ]);
      // Positive control: somebody else approves the renewed request, and it issues.
      await approveAs(c, renewed);
      await c.query(`SELECT quo.issue_revision($1)`, [third]);
    });
  });

  it('keeps an existing draft under its own version when the threshold is lowered, and holds a new quotation to the lowered one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await insertPolicy(c, 1, 'amount', '50', 'USD');
      const { wo, service } = await quotable(c, 'd7');
      // 40 under a threshold of 50 needs no request.
      const existing = await draftOn(c, wo, service, 'd7a', 40);
      // The threshold is lowered below the discount.
      await insertPolicy(c, 2, 'amount', '10', 'USD');
      // The draft written before the change keeps its version and issues.
      await c.query(`SELECT quo.issue_revision($1)`, [existing.revision]);
      // A quotation written after it is held to the lowered threshold.
      const fresh = await draftOn(c, wo, service, 'd7b', 40);
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [fresh.revision]
      );
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
      const updated = await c.query(approveSql(), [approval, USER_B]);
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

  /**
   * `quo.backfill_discount_approvals` — what migration 20260925090000 runs once over
   * the rows that existed before it. The pre-migration state is built as the owner:
   * rows are written normally (so every constraint holds), then the parts the
   * migration introduced — the quotation pin, and a request on an issued revision —
   * are stepped around with `session_replication_role`, the only way to hold a row
   * the triggers would never let exist today.
   */
  it('backfills pins and legacy requests deterministically, idempotently, and only where they belong', async () => {
    await withRolledBackTx(admin, ctxA, async (c) => {
      // Policy history: the company's own active version 1 (20), a retired version 2
      // and a soft-deleted version 3 above it, and an organisation-wide default.
      const v1 = await insertPolicy(c, 1, 'amount', '20', 'USD');
      await insertPolicy(c, 2, 'amount', '1000', 'USD', { status: 'inactive' });
      await insertPolicy(c, 3, 'amount', '500', 'USD', { deletedAt: true });
      await insertPolicy(c, 1, 'amount', '5', 'USD', { companyId: null });

      const { wo, service } = await quotable(c, 'bf');
      // Quotation one: five drafts.
      const q1 = await seedQuotation(c, wo, 'bf1');
      const draft = async (quotation: string, n: number, discount: number): Promise<string> => {
        const revision = await draftRevision(c, quotation, n);
        await addServiceItem(c, revision, service, 1, 100, 1, discount);
        return revision;
      };
      const mine = await draft(q1, 1, 40); // over 20, by USER_A
      const theirs = await draft(q1, 2, 30); // over 20, by APPROVER (below)
      const under = await draft(q1, 3, 10); // under 20
      const zero = await draft(q1, 4, 0); // no discount
      const orphan = await draft(q1, 5, 40); // over 20, by an id that is no user account
      // Quotation two: an issued revision and a deleted draft, both over the threshold.
      const q2 = await seedQuotation(c, wo, 'bf2');
      const issued = await draft(q2, 1, 40);
      const deleted = await draft(q2, 2, 40);

      await c.query(`SET LOCAL session_replication_role = 'replica'`);
      await c.query(`UPDATE quo.quotation_revisions SET created_by = $2 WHERE id = $1`, [
        theirs,
        APPROVER,
      ]);
      await c.query(`UPDATE quo.quotation_revisions SET created_by = $2 WHERE id = $1`, [
        orphan,
        OTHER_ACTOR,
      ]);
      await c.query(`SELECT quo.issue_revision($1)`, [issued]);
      await c.query(
        `UPDATE quo.quotation_revisions SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        [deleted, USER_A]
      );
      await c.query(
        `UPDATE quo.quotations
            SET discount_policy_id = NULL, discount_policy_version_no = NULL,
                discount_policy_pinned_at = NULL
          WHERE id = ANY($1::uuid[])`,
        [[q1, q2]]
      );
      await c.query(`SET LOCAL session_replication_role = 'origin'`);
      expect((await pinOf(c, q1)).pinnedAt).toBeNull();

      const revisions = { mine, theirs, under, zero, orphan, issued, deleted };
      const state = async () => {
        const approvals = await c.query(
          `SELECT quotation_revision_id, status, origin, requested_by, policy_id,
                  policy_version_no, threshold_value::text AS threshold_value,
                  discount_total::text AS discount_total, required_permission_code
             FROM quo.discount_approvals
            WHERE quotation_revision_id = ANY($1::uuid[])
            ORDER BY quotation_revision_id`,
          [Object.values(revisions)]
        );
        const pins = await c.query(
          `SELECT id, discount_policy_id, discount_policy_version_no
             FROM quo.quotations WHERE id = ANY($1::uuid[]) ORDER BY id`,
          [[q1, q2]]
        );
        return { approvals: approvals.rows, pins: pins.rows };
      };
      const backfill = async () =>
        (
          await c.query(
            `SELECT pinned_quotations, backfilled_requests FROM quo.backfill_discount_approvals()`
          )
        ).rows[0];

      // Determinism: the same pre-state backfilled twice gives the same answer.
      await c.query('SAVEPOINT sp_backfill');
      const firstRun = await backfill();
      const firstState = await state();
      await c.query('ROLLBACK TO SAVEPOINT sp_backfill');
      expect((await pinOf(c, q1)).pinnedAt).toBeNull();
      const secondRun = await backfill();
      const secondState = await state();
      expect(secondRun).toEqual(firstRun);
      expect(secondState).toEqual(firstState);
      expect(firstRun).toEqual({ pinned_quotations: 2, backfilled_requests: 2 });

      // Both quotations are pinned to the company's ACTIVE version — not the retired or
      // deleted higher ones, not the organisation-wide default.
      expect(firstState.pins).toEqual(
        [q1, q2].sort().map((id) => ({ id, discount_policy_id: v1, discount_policy_version_no: 1 }))
      );
      // Exactly the two qualifying drafts carry a pending, backfilled request in their
      // own creator's name, under the pinned version.
      const expected = [
        { revision: mine, by: USER_A, total: '40.0000' },
        { revision: theirs, by: APPROVER, total: '30.0000' },
      ].sort((a, b) => (a.revision < b.revision ? -1 : 1));
      expect(firstState.approvals).toEqual(
        expected.map((row) => ({
          quotation_revision_id: row.revision,
          status: 'pending',
          origin: 'backfilled',
          requested_by: row.by,
          policy_id: v1,
          policy_version_no: 1,
          threshold_value: '20.0000',
          discount_total: row.total,
          required_permission_code: 'svc.price.manage',
        }))
      );

      // Idempotency: a third run changes nothing.
      expect(await backfill()).toEqual({ pinned_quotations: 0, backfilled_requests: 0 });
      expect(await state()).toEqual(secondState);

      // The draft whose creator is no user account got no request, and cannot be issued.
      await expectRefusal(
        c,
        '23514',
        /discount_approval_required/,
        `SELECT quo.issue_revision($1)`,
        [orphan]
      );
      // A backfilled request is not its requester's to approve.
      const backfilled = (
        await c.query(`SELECT id FROM quo.discount_approvals WHERE quotation_revision_id = $1`, [
          mine,
        ])
      ).rows[0].id as string;
      await expectRefusal(c, '23514', /discount_approver_must_differ/, approveSql(), [
        backfilled,
        USER_A,
      ]);
    });
  });
});
