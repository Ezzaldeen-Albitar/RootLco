/**
 * P1-32-PRE-OD-FD8 — ADR-023 D8 and D3 through the routes.
 *
 * D8: a person's own change to a discount threshold, an approval limit or a price
 * never exempts their own quotation from discount approval, and there is no
 * sole-administrator exception. D3: the requester withdraws their own PENDING
 * discount request (`quo.discount-approval-withdraw`), version-guarded and idempotent;
 * nobody else may, a decided request cannot be, and a withdrawn one is never approved.
 *
 * Who plays whom, in TENANT_A / COMPANY_A1:
 *  - SVC_NO_CEILING and SVC_FULL write quotations (`quo.quotation.manage`) and may set
 *    prices and thresholds (`svc.price.manage`; SVC_FULL also publishes);
 *  - SVC_DISCOUNT_APPROVER decides, against a limit an administrator (USER_A) set;
 *  - the base price list is written with nobody signed in, so it is nobody's change.
 *
 * Fix round 1 (migration 20261007100000): a price whose AMOUNT the requester set stays
 * theirs after a colleague's later edit to anything else, and an approver whose limit
 * window the requester moved (reopened, or ended so that a role limit applies) has no
 * limit that counts for the requester's request. A window move is written here at the
 * database, signed in as the requester, exactly as the limit-ending route writes it:
 * the requester in these cases holds no iam.approval.manage, and the column the route
 * changes (effective_to) and the stamp (updated_by, from the session) are the same.
 *
 * Fix round 2 (migration 20261007110000): who moved a window is kept for good in
 * iam.approval_limits.window_changed_by, so a colleague's later save does not wipe the
 * requester's change, and an approver who moved the window of their own limit has no
 * limit that counts, for anybody's request.
 *
 * Fix round 3 (migration 20261007120000): a price the requester set needs another
 * person even when the quotation carries no discount, because the price itself can
 * carry it; the request is recorded with a discount total of zero and the reason.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   quo.discount-approval-withdraw: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { PARTNER_A, createOpenWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  SERVICE_A,
  SVC_DISCOUNT_APPROVER,
  SVC_FULL,
  SVC_NO_CEILING,
  SVC_QUO_SCOPED_A2,
  SVC_TENANT_B_FULL,
  TAX_CLASS_A,
  assignPriceList,
  auditCountFor,
  authAs,
  clearDiscountPolicy,
  establishP1_20Fixtures,
  priceListVersionOf,
  seedDiscountCeiling,
  seedDiscountPolicy,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_PL_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { GET as QUOTATION_DETAIL } from '@/app/api/v1/quotations/[quotationId]/route';
import { POST as CREATE_REVISION } from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { POST as ISSUE } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { POST as DECIDE_DISCOUNT } from '@/app/api/v1/discount-approvals/[approvalId]/decision/route';
import { POST as WITHDRAW_DISCOUNT } from '@/app/api/v1/discount-approvals/[approvalId]/withdrawal/route';
import {
  GET as READ_THRESHOLD,
  POST as SET_THRESHOLD,
} from '@/app/api/v1/discount-thresholds/[companyId]/route';

let admin: Pool;
let runtime: Pool;
let codeSeq = 0;
// Above every priority the other quotation suites use, so the newest list here wins.
let assignmentPriority = 900;

const nextCode = (): string => {
  codeSeq += 1;
  return `FX-FD8-${String(Date.now() % 100000)}-${codeSeq}`;
};

const post = (url: string, body: unknown, ifMatch?: number, key = crypto.randomUUID()) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(body),
  });

interface Problem {
  readonly code?: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}
interface DiscountApproval {
  readonly id: string;
  readonly status: string;
  readonly requestedBy: { readonly id: string };
  readonly requestedByCaller: boolean;
  readonly canApprove: boolean;
  readonly cannotApproveReason: string | null;
  readonly requesterSetPolicy: boolean;
  readonly requesterSetPrice: boolean;
  readonly canWithdraw: boolean;
  readonly withdrawnBy: { readonly id: string } | null;
  readonly withdrawnAt: string | null;
  readonly recordVersion: number;
}
interface Revision {
  readonly id: string;
  readonly discountApproval: DiscountApproval | null;
}
interface Quotation {
  readonly id: string;
  readonly recordVersion: number;
  readonly currentRevision: Revision | null;
}
interface Withdrawal {
  readonly discountApproval: DiscountApproval;
  readonly replayed: boolean;
}

const createQuotation = (discount: string, workOrderId: string) =>
  CREATE_QUOTATION(
    post('http://localhost/api/v1/quotations', {
      workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount }],
    })
  );
const reread = async (quotationId: string): Promise<Quotation> =>
  (await (
    await QUOTATION_DETAIL(new Request(`http://localhost/api/v1/quotations/${quotationId}`), {
      params: Promise.resolve({ quotationId }),
    })
  ).json()) as Quotation;
const revise = (quotationId: string, discount: string, ifMatch: number) =>
  CREATE_REVISION(
    post(
      `http://localhost/api/v1/quotations/${quotationId}/revisions`,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount }] },
      ifMatch
    ),
    { params: Promise.resolve({ quotationId }) }
  );
const issue = (quotationId: string, revisionId: string, ifMatch: number) =>
  ISSUE(post(`http://localhost/api/v1/quotations/${quotationId}/issue`, { revisionId }, ifMatch), {
    params: Promise.resolve({ quotationId }),
  });
const decide = (approvalId: string, body: unknown) =>
  DECIDE_DISCOUNT(post(`http://localhost/api/v1/discount-approvals/${approvalId}/decision`, body), {
    params: Promise.resolve({ approvalId }),
  });
const withdraw = (approvalId: string, ifMatch?: number, key?: string) =>
  WITHDRAW_DISCOUNT(
    new Request(`http://localhost/api/v1/discount-approvals/${approvalId}/withdrawal`, {
      method: 'POST',
      headers: {
        'idempotency-key': key ?? crypto.randomUUID(),
        ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
      },
    }),
    { params: Promise.resolve({ approvalId }) }
  );

/** Sets the company threshold through the route, as whoever is signed in. */
async function setThresholdAs(principal: typeof SVC_FULL, value: string): Promise<void> {
  authAs(principal);
  const before = (await (
    await READ_THRESHOLD(new Request(`http://localhost/api/v1/discount-thresholds/${COMPANY_A1}`), {
      params: Promise.resolve({ companyId: COMPANY_A1 }),
    })
  ).json()) as { recordVersion: number };
  const response = await SET_THRESHOLD(
    post(
      `http://localhost/api/v1/discount-thresholds/${COMPANY_A1}`,
      { thresholdKind: 'amount', thresholdValue: value, currency: 'JOD' },
      before.recordVersion
    ),
    { params: Promise.resolve({ companyId: COMPANY_A1 }) }
  );
  expect(response.status).toBe(201);
}

/** A threshold an administrator recorded with nobody signed in: nobody's own change. */
async function administratorThreshold(value: string): Promise<void> {
  await clearDiscountPolicy(TENANT_A);
  await seedDiscountPolicy({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    thresholdKind: 'amount',
    thresholdValue: value,
    currencyCode: 'JOD',
  });
}

/** A price list for SERVICE_A written and published with nobody signed in. */
async function publishUnattributedPrice(amount: string): Promise<void> {
  const client = await admin.connect();
  let listId: string;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
    listId = (
      await client.query<{ id: string }>(
        `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by)
         VALUES ($1,$2,'FD8 fixture list','JOD',$3) RETURNING id`,
        [TENANT_A, nextCode(), USER_A]
      )
    ).rows[0]?.id as string;
    const versionId = (
      await client.query<{ id: string }>(
        `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by)
         VALUES ($1,$2,1,DATE '2020-01-01','draft',$3) RETURNING id`,
        [TENANT_A, listId, USER_A]
      )
    ).rows[0]?.id as string;
    await client.query(
      `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, company_id, amount, tax_class_id, priority, created_by)
       VALUES ($1,$2,$3,$4,$5::numeric,$6,0,$7)`,
      [TENANT_A, versionId, SERVICE_A, COMPANY_A1, amount, TAX_CLASS_A, USER_A]
    );
    await client.query(`SELECT svc.publish_price_list_version($1,$2,DATE '2020-01-01')`, [
      listId,
      versionId,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  assignmentPriority += 1;
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: listId,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: assignmentPriority,
  });
}

/**
 * A price list for SERVICE_A whose rule AMOUNT `amountSetter` sets and whose priority
 * `colleague` then changes, each signed in; published with nobody signed in.
 */
async function publishPriceAmountSetBy(
  amountSetter: string,
  colleague: string,
  amount: string
): Promise<void> {
  const client = await admin.connect();
  let listId: string;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
    listId = (
      await client.query<{ id: string }>(
        `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by)
         VALUES ($1,$2,'FD8 amount fixture list','JOD',$3) RETURNING id`,
        [TENANT_A, nextCode(), USER_A]
      )
    ).rows[0]?.id as string;
    const versionId = (
      await client.query<{ id: string }>(
        `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by)
         VALUES ($1,$2,1,DATE '2020-01-01','draft',$3) RETURNING id`,
        [TENANT_A, listId, USER_A]
      )
    ).rows[0]?.id as string;
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [amountSetter]);
    const ruleId = (
      await client.query<{ id: string }>(
        `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, company_id, amount, tax_class_id, priority, created_by)
         VALUES ($1,$2,$3,$4,$5::numeric,$6,0,$7) RETURNING id`,
        [TENANT_A, versionId, SERVICE_A, COMPANY_A1, amount, TAX_CLASS_A, amountSetter]
      )
    ).rows[0]?.id as string;
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [colleague]);
    await client.query(`UPDATE svc.price_rules SET priority = 1 WHERE id = $1`, [ruleId]);
    await client.query(`SELECT set_config('app.user_id', '', true)`);
    await client.query(`SELECT svc.publish_price_list_version($1,$2,DATE '2020-01-01')`, [
      listId,
      versionId,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  assignmentPriority += 1;
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: listId,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: assignmentPriority,
  });
}

/**
 * Moves an approval limit's end date to `daysFromToday` from today, signed in as
 * `person` (`null`: nobody, as an administrator's own tooling would).
 */
async function moveLimitWindowAs(
  person: string | null,
  limitId: string,
  daysFromToday: number
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
      [TENANT_A, person ?? '']
    );
    await client.query(
      `UPDATE iam.approval_limits SET effective_to = current_date + $2::int WHERE id = $1`,
      [limitId, daysFromToday]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A price list for SERVICE_A published through the routes by SVC_FULL. */
async function publishPriceAsFull(amount: string): Promise<void> {
  authAs(SVC_FULL);
  const list = (await (
    await CREATE_LIST(
      post('http://localhost/api/v1/price-lists', {
        priceListCode: nextCode(),
        name: 'FD8 price list',
        currency: 'JOD',
      })
    )
  ).json()) as { id: string; recordVersion: number };
  const version = (await (
    await CREATE_PL_VERSION(
      post(
        `http://localhost/api/v1/price-lists/${list.id}/versions`,
        { effectiveFrom: '2020-01-01' },
        list.recordVersion
      ),
      { params: Promise.resolve({ priceListId: list.id }) }
    )
  ).json()) as { id: string };
  const rule = await RECORD_RULE(
    post(`http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/rules`, {
      serviceId: SERVICE_A,
      amount,
      companyId: COMPANY_A1,
      taxClassId: TAX_CLASS_A,
    }),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  expect(rule.status).toBe(201);
  const published = await PUBLISH(
    post(
      `http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/publication`,
      { effectiveFrom: '2020-01-01' },
      await priceListVersionOf(list.id)
    ),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  expect(published.status).toBe(200);
  assignmentPriority += 1;
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: list.id,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: assignmentPriority,
  });
}

/** A quotation written by `writer` with one line discounted by `discount`. */
async function quoteAs(writer: typeof SVC_FULL, discount: string): Promise<Quotation> {
  const order = await createOpenWorkOrder();
  authAs(writer);
  const response = await createQuotation(discount, order.workOrderId);
  expect(response.status).toBe(201);
  return (await response.json()) as Quotation;
}

const approvalOf = (quotation: Quotation): DiscountApproval =>
  quotation.currentRevision?.discountApproval as DiscountApproval;

/** Business-rule refusals recorded for one discount request by one operation (D12). */
async function refusalEvents(operation: string, approvalId: string, rule: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE event_type = 'business-rule.refused' AND detail = $1`,
    [
      `operation=${operation} entity=quo.discount_approval/${approvalId} rule=${rule} outcome=refused`,
    ]
  );
  return Number(result.rows[0]?.n ?? '0');
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
  await publishUnattributedPrice('100.0000');
  // The approver's limit, set by an administrator who writes no quotation here.
  await seedDiscountCeiling({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    roleId: SVC_DISCOUNT_APPROVER.roleId,
    amount: '1000.0000',
    currencyCode: 'JOD',
  });
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('ADR-023 D8 — one’s own threshold, limit or price never exempts one’s own quotation', () => {
  it('the requester who raised the threshold still needs another person; another person’s quotation follows it', async () => {
    await clearDiscountPolicy(TENANT_A);
    await setThresholdAs(SVC_NO_CEILING, '100.0000');

    // 40 is under SVC_NO_CEILING's own threshold of 100, and still needs approval.
    const own = await quoteAs(SVC_NO_CEILING, '40.0000');
    const request = approvalOf(own);
    expect(request).toMatchObject({
      status: 'pending',
      requestedByCaller: true,
      requesterSetPolicy: true,
      requesterSetPrice: false,
      canWithdraw: true,
    });
    expect(request.requestedBy.id).toBe(SVC_NO_CEILING.userId);
    const blocked = await issue(own.id, own.currentRevision?.id as string, own.recordVersion);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);

    // No sole-administrator exception: the requester never decides it.
    const self = await decide(request.id, { decision: 'approved' });
    expect(self.status).toBe(403);
    expect(((await self.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approver_must_differ' },
    ]);

    // Somebody else's quotation follows the same threshold as set: no request, it issues.
    const other = await quoteAs(SVC_FULL, '40.0000');
    expect(other.currentRevision?.discountApproval).toBeNull();
    const issuedOther = await issue(
      other.id,
      other.currentRevision?.id as string,
      other.recordVersion
    );
    expect(issuedOther.status).toBe(200);

    // A second authorised person approves the requester's, and then it issues.
    authAs(SVC_DISCOUNT_APPROVER);
    const approved = await decide(request.id, { decision: 'approved' });
    expect(approved.status).toBe(200);
    authAs(SVC_NO_CEILING);
    const issued = await issue(
      own.id,
      own.currentRevision?.id as string,
      (await reread(own.id)).recordVersion
    );
    expect(issued.status).toBe(200);
  });

  it('the requester who published a price needs another person for a discount on it; others follow the threshold', async () => {
    await administratorThreshold('100.0000');
    await publishPriceAsFull('100.0000');

    const own = await quoteAs(SVC_FULL, '40.0000');
    expect(approvalOf(own)).toMatchObject({
      status: 'pending',
      requesterSetPolicy: false,
      requesterSetPrice: true,
    });

    // SVC_NO_CEILING set neither the price nor this threshold: 40 under 100 passes.
    const other = await quoteAs(SVC_NO_CEILING, '40.0000');
    expect(other.currentRevision?.discountApproval).toBeNull();

    // With no discount at all, SVC_NO_CEILING's quotation needs nothing: the price is
    // not theirs.
    const plain = await quoteAs(SVC_NO_CEILING, '0');
    expect(plain.currentRevision?.discountApproval).toBeNull();

    await publishUnattributedPrice('100.0000');
  });

  it('the requester who set and published a lower price needs another person even with no discount (fix round 3)', async () => {
    await administratorThreshold('50.0000');
    // Control: 90 off the unattributed 100 needs somebody else under the threshold of 50.
    const control = await quoteAs(SVC_FULL, '90.0000');
    expect(approvalOf(control)).toMatchObject({
      status: 'pending',
      requesterSetPolicy: false,
      requesterSetPrice: false,
    });

    // SVC_FULL sets and publishes 10 for the same service and quotes at 10 with no
    // discount: the customer gets the same 90 off, so somebody else approves it.
    await publishPriceAsFull('10.0000');
    try {
      const own = await quoteAs(SVC_FULL, '0');
      const request = approvalOf(own);
      expect(request).toMatchObject({
        status: 'pending',
        requestedByCaller: true,
        requesterSetPolicy: false,
        requesterSetPrice: true,
      });
      const zero = await admin.query<{ total: string }>(
        `SELECT discount_total::text AS total FROM quo.discount_approvals WHERE id = $1`,
        [request.id]
      );
      expect(zero.rows[0]?.total).toBe('0.0000');
      const blocked = await issue(own.id, own.currentRevision?.id as string, own.recordVersion);
      expect(blocked.status).toBe(409);
      expect(((await blocked.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_approval_pending' },
      ]);
      // No sole-administrator exception: the requester never decides it.
      const self = await decide(request.id, { decision: 'approved' });
      expect(self.status).toBe(403);
      expect(((await self.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_approver_must_differ' },
      ]);

      // Somebody else's quotation at the same price, with no discount, issues alone.
      const other = await quoteAs(SVC_NO_CEILING, '0');
      expect(other.currentRevision?.discountApproval).toBeNull();
      const issuedOther = await issue(
        other.id,
        other.currentRevision?.id as string,
        other.recordVersion
      );
      expect(issuedOther.status).toBe(200);

      // A second authorised person approves the requester's, and then it issues.
      authAs(SVC_DISCOUNT_APPROVER);
      const approved = await decide(request.id, { decision: 'approved' });
      expect(approved.status).toBe(200);
      authAs(SVC_FULL);
      const issued = await issue(
        own.id,
        own.currentRevision?.id as string,
        (await reread(own.id)).recordVersion
      );
      expect(issued.status).toBe(200);
    } finally {
      await publishUnattributedPrice('100.0000');
    }
  });

  it('a limit the requester set never lets an approver approve the requester’s discount', async () => {
    await administratorThreshold('0.0000');
    const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
    const request = approvalOf(quotation);
    // SVC_FULL holds the recorded permission; its only discount limit is one the
    // REQUESTER set for SVC_FULL's role.
    const limit = await admin.query<{ id: string }>(
      `INSERT INTO iam.approval_limits
         (tenant_id, company_id, role_id, limit_type, amount, currency_code, effective_from, created_by)
       VALUES ($1,$2,$3,'discount',1000,'JOD',DATE '2020-01-01',$4) RETURNING id`,
      [TENANT_A, COMPANY_A1, SVC_FULL.roleId, SVC_NO_CEILING.userId]
    );
    try {
      authAs(SVC_FULL);
      const refused = await decide(request.id, { decision: 'approved' });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_no_approval_limit' },
      ]);
      expect(
        await refusalEvents(
          'quo.discount-approval-decide',
          request.id,
          'discount_no_approval_limit'
        )
      ).toBe(1);
      // An approver whose limit an administrator set approves it.
      authAs(SVC_DISCOUNT_APPROVER);
      const approved = await decide(request.id, { decision: 'approved' });
      expect(approved.status).toBe(200);
      const relied = await admin.query<{ approver_limit_id: string | null }>(
        `SELECT approver_limit_id FROM quo.discount_approvals WHERE id = $1`,
        [request.id]
      );
      expect(relied.rows[0]?.approver_limit_id).not.toBeNull();
      expect(relied.rows[0]?.approver_limit_id).not.toBe(limit.rows[0]?.id);
    } finally {
      await admin.query(`DELETE FROM iam.approval_limits WHERE id = $1`, [limit.rows[0]?.id]);
    }
  });

  it('a price amount the requester set still needs another person after a colleague’s later edit', async () => {
    await administratorThreshold('100.0000');
    // SVC_FULL sets the amount; SVC_DISCOUNT_APPROVER, who writes no quotation here,
    // then changes only the rule's priority and is the last to change it.
    await publishPriceAmountSetBy(SVC_FULL.userId, SVC_DISCOUNT_APPROVER.userId, '100.0000');
    try {
      // 40 is under the administrator's 100, and SVC_FULL's own amount still needs
      // somebody else.
      const own = await quoteAs(SVC_FULL, '40.0000');
      expect(approvalOf(own)).toMatchObject({
        status: 'pending',
        requesterSetPolicy: false,
        requesterSetPrice: true,
      });
      // SVC_NO_CEILING set neither the amount nor anything else: the threshold decides.
      const other = await quoteAs(SVC_NO_CEILING, '40.0000');
      expect(other.currentRevision?.discountApproval).toBeNull();
    } finally {
      await publishUnattributedPrice('100.0000');
    }
  });

  it('an approver whose expired limit the requester reopened cannot approve the requester’s discount', async () => {
    await administratorThreshold('0.0000');
    const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
    const request = approvalOf(quotation);
    // An administrator's limit for SVC_FULL's role, ended long ago.
    const limit = await admin.query<{ id: string }>(
      `INSERT INTO iam.approval_limits
         (tenant_id, company_id, role_id, limit_type, amount, currency_code, effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,'discount',1000,'JOD',DATE '2020-01-01',DATE '2020-06-01',$4) RETURNING id`,
      [TENANT_A, COMPANY_A1, SVC_FULL.roleId, USER_A]
    );
    const limitId = limit.rows[0]?.id as string;
    try {
      authAs(SVC_FULL);
      const expired = await decide(request.id, { decision: 'approved' });
      expect(expired.status).toBe(403);
      expect(((await expired.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_no_approval_limit' },
      ]);

      // The requester reopens it for a year.
      await moveLimitWindowAs(SVC_NO_CEILING.userId, limitId, 365);
      authAs(SVC_FULL);
      expect(approvalOf(await reread(quotation.id))).toMatchObject({
        canApprove: false,
        cannotApproveReason: 'no_approval_limit',
      });
      const refused = await decide(request.id, { decision: 'approved' });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_no_approval_limit' },
      ]);
      expect(
        await refusalEvents(
          'quo.discount-approval-decide',
          request.id,
          'discount_no_approval_limit'
        )
      ).toBe(2);

      // A colleague who may administer limits moves it last: the requester's change
      // is still on record, and the limit still does not count (fix round 2).
      await moveLimitWindowAs(USER_A, limitId, 366);
      expect(
        (
          await admin.query<{ updated_by: string; window_changed_by: string[] }>(
            `SELECT updated_by, window_changed_by FROM iam.approval_limits WHERE id = $1`,
            [limitId]
          )
        ).rows[0]
      ).toEqual({ updated_by: USER_A, window_changed_by: [SVC_NO_CEILING.userId, USER_A] });
      authAs(SVC_FULL);
      const stillRefused = await decide(request.id, { decision: 'approved' });
      expect(stillRefused.status).toBe(403);
      expect(((await stillRefused.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_no_approval_limit' },
      ]);
    } finally {
      await admin.query(`DELETE FROM iam.approval_limits WHERE id = $1`, [limitId]);
    }
  });

  it('an approver who reopened their own expired limit cannot approve with it, for anybody’s request', async () => {
    await administratorThreshold('0.0000');
    const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
    const request = approvalOf(quotation);
    // An administrator's limit for SVC_FULL's role, ended long ago.
    const limit = await admin.query<{ id: string }>(
      `INSERT INTO iam.approval_limits
         (tenant_id, company_id, role_id, limit_type, amount, currency_code, effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,'discount',1000,'JOD',DATE '2020-01-01',DATE '2020-06-01',$4) RETURNING id`,
      [TENANT_A, COMPANY_A1, SVC_FULL.roleId, USER_A]
    );
    const limitId = limit.rows[0]?.id as string;
    try {
      authAs(SVC_FULL);
      const expired = await decide(request.id, { decision: 'approved' });
      expect(expired.status).toBe(403);

      // The approver reopens the limit on their own role for a year (fix round 2).
      await moveLimitWindowAs(SVC_FULL.userId, limitId, 365);
      authAs(SVC_FULL);
      expect(approvalOf(await reread(quotation.id))).toMatchObject({
        canApprove: false,
        cannotApproveReason: 'no_approval_limit',
      });
      const refused = await decide(request.id, { decision: 'approved' });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_no_approval_limit' },
      ]);
      expect(
        await refusalEvents(
          'quo.discount-approval-decide',
          request.id,
          'discount_no_approval_limit'
        )
      ).toBe(2);
      expect(
        (
          await admin.query<{ status: string; window_changed_by: string[] }>(
            `SELECT a.status, l.window_changed_by
               FROM quo.discount_approvals a, iam.approval_limits l
              WHERE a.id = $1 AND l.id = $2`,
            [request.id, limitId]
          )
        ).rows[0]
      ).toEqual({ status: 'pending', window_changed_by: [SVC_FULL.userId] });
    } finally {
      await admin.query(`DELETE FROM iam.approval_limits WHERE id = $1`, [limitId]);
    }
  });

  it('an approver whose smaller limit the requester ended cannot approve under a larger role limit', async () => {
    await administratorThreshold('0.0000');
    // SVC_DISCOUNT_APPROVER's role holds 1000; an administrator gives the approver
    // their own limit of 1, which wins while it is in force.
    const own = await admin.query<{ id: string }>(
      `INSERT INTO iam.approval_limits
         (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
       VALUES ($1,$2,$3,'discount',1,'JOD',DATE '2020-01-01',$4) RETURNING id`,
      [TENANT_A, COMPANY_A1, SVC_DISCOUNT_APPROVER.userId, USER_A]
    );
    const ownId = own.rows[0]?.id as string;
    try {
      const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
      const request = approvalOf(quotation);
      authAs(SVC_DISCOUNT_APPROVER);
      const over = await decide(request.id, { decision: 'approved' });
      expect(over.status).toBe(403);
      expect(((await over.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_over_approval_limit' },
      ]);

      // The requester ends the approver's own limit today; the role's 1000 would apply.
      await moveLimitWindowAs(SVC_NO_CEILING.userId, ownId, 0);
      authAs(SVC_DISCOUNT_APPROVER);
      const refused = await decide(request.id, { decision: 'approved' });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_no_approval_limit' },
      ]);

      // Somebody else's request follows the limits as they stand: the role limit counts.
      const others = await quoteAs(SVC_FULL, '5.0000');
      authAs(SVC_DISCOUNT_APPROVER);
      const approved = await decide(approvalOf(others).id, { decision: 'approved' });
      expect(approved.status).toBe(200);
    } finally {
      await admin.query(`DELETE FROM iam.approval_limits WHERE id = $1`, [ownId]);
    }
  });
});

describe('ADR-023 D3 — quo.discount-approval-withdraw', () => {
  it('lets only the requester withdraw a pending request, version-guarded and replay-safe', async () => {
    await administratorThreshold('0.0000');
    const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
    const request = approvalOf(quotation);
    expect(request.canWithdraw).toBe(true);

    // If-Match is required, and must be the request's current version.
    authAs(SVC_NO_CEILING);
    expect((await withdraw(request.id)).status).toBe(428);
    expect((await withdraw(request.id, request.recordVersion + 1)).status).toBe(409);

    // Somebody else who may write quotations is refused by name, and it is recorded once.
    authAs(SVC_FULL);
    const other = await withdraw(request.id, request.recordVersion);
    expect(other.status).toBe(409);
    expect(((await other.json()) as Problem).violations).toEqual([
      { path: 'path.approvalId', rule: 'discount_withdraw_not_requester' },
    ]);
    expect(
      await refusalEvents(
        'quo.discount-approval-withdraw',
        request.id,
        'discount_withdraw_not_requester'
      )
    ).toBe(1);
    // An approver without quo.quotation.manage is refused at the gate.
    authAs(SVC_DISCOUNT_APPROVER);
    expect((await withdraw(request.id, request.recordVersion)).status).toBe(403);

    // The requester withdraws it.
    authAs(SVC_NO_CEILING);
    const key = crypto.randomUUID();
    const done = await withdraw(request.id, request.recordVersion, key);
    expect(done.status).toBe(200);
    const body = (await done.json()) as Withdrawal;
    expect(body.replayed).toBe(false);
    expect(body.discountApproval).toMatchObject({ status: 'withdrawn', canWithdraw: false });
    expect(body.discountApproval.withdrawnBy?.id).toBe(SVC_NO_CEILING.userId);
    expect(body.discountApproval.withdrawnAt).not.toBeNull();
    expect(await auditCountFor('quo.discount_approval.withdrawn', request.id)).toBe(1);

    // The same request again answers the stored response; a fresh retry at the new
    // version says it was already withdrawn. Neither writes a second record.
    const again = await withdraw(request.id, request.recordVersion, key);
    expect(again.status).toBe(200);
    const retried = await withdraw(request.id, body.discountApproval.recordVersion);
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as Withdrawal).replayed).toBe(true);
    expect(await auditCountFor('quo.discount_approval.withdrawn', request.id)).toBe(1);

    // Withdrawn is final: never approved, and its revision is never issued.
    authAs(SVC_DISCOUNT_APPROVER);
    const approve = await decide(request.id, { decision: 'approved' });
    expect(approve.status).toBe(409);
    expect(((await approve.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_withdrawn' },
    ]);
    authAs(SVC_NO_CEILING);
    const current = await reread(quotation.id);
    expect(current.currentRevision?.discountApproval?.status).toBe('withdrawn');
    const blocked = await issue(
      quotation.id,
      current.currentRevision?.id as string,
      current.recordVersion
    );
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_withdrawn' },
    ]);

    // Revising asks again, or drops the discount.
    const asked = await revise(quotation.id, '5.0000', current.recordVersion);
    expect(asked.status).toBe(201);
    expect(((await asked.json()) as Revision).discountApproval?.status).toBe('pending');
    const dropped = await revise(quotation.id, '0', (await reread(quotation.id)).recordVersion);
    expect(dropped.status).toBe(201);
    expect(((await dropped.json()) as Revision).discountApproval).toBeNull();
  });

  it('refuses to withdraw a decided request, and records the refusal', async () => {
    await administratorThreshold('0.0000');
    for (const decision of [
      { decision: 'approved' },
      { decision: 'rejected', reason: 'Too generous for this job' },
    ]) {
      const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
      const request = approvalOf(quotation);
      authAs(SVC_DISCOUNT_APPROVER);
      const decided = await decide(request.id, decision);
      expect(decided.status).toBe(200);
      const after = (await decided.json()) as DiscountApproval;
      authAs(SVC_NO_CEILING);
      const refused = await withdraw(request.id, after.recordVersion);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as Problem).violations).toEqual([
        { path: 'path.approvalId', rule: 'discount_approval_already_decided' },
      ]);
      expect(
        await refusalEvents(
          'quo.discount-approval-withdraw',
          request.id,
          'discount_approval_already_decided'
        )
      ).toBe(1);
    }
  });

  it('isolates branches: a writer granted only another branch cannot withdraw it', async () => {
    await administratorThreshold('0.0000');
    const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
    const request = approvalOf(quotation);
    // SVC_QUO_SCOPED_A2 holds quo.quotation.manage in BRANCH_A2 only; the request is in A1.
    authAs(SVC_QUO_SCOPED_A2);
    const refused = await withdraw(request.id, request.recordVersion);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as Problem).code).toBe('ERR-IAM-001');
    authAs(SVC_NO_CEILING);
    expect((await reread(quotation.id)).currentRevision?.discountApproval?.status).toBe('pending');
  });

  it('isolates tenants: another tenant cannot find the request to withdraw it', async () => {
    await administratorThreshold('0.0000');
    const quotation = await quoteAs(SVC_NO_CEILING, '5.0000');
    const request = approvalOf(quotation);
    authAs(SVC_TENANT_B_FULL);
    expect((await withdraw(request.id, request.recordVersion)).status).toBe(404);
    authAs(SVC_NO_CEILING);
    expect((await reread(quotation.id)).currentRevision?.discountApproval?.status).toBe('pending');
  });
});
