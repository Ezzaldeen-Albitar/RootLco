/**
 * Quotation lifecycle and decisions (Phase 1-20, P1-20-BE-007…012,
 * P1-20-QA-002…004).
 *
 * The four properties this suite exists to hold down:
 *
 * **The server computes the money.** A caller supplies a service and a quantity.
 * `unitPrice`, `taxAmount` and `lineTotal` in a request body are REJECTED, not
 * ignored, and the stored figures match PostgreSQL's own arithmetic exactly.
 *
 * **An issued revision is immutable.** The price list is republished at a higher
 * amount after issue, and the issued revision's captured amounts do not move.
 *
 * **Approval of revision N never approves revision N+1.** `presentedRevisionId` is
 * the control, and the superseded-revision case proves it.
 *
 * **A partial rejection is not an acceptance.** One rejected line makes the whole
 * quotation `rejected`, because treating it otherwise would authorize work the
 * customer declined.
 *
 * **A discount that needs approval is approved by somebody else** (P1-32-PRE-OD-DISC-01,
 * -04). The revision is created with the discount recorded as a PENDING request by the
 * signed-in person; it cannot be issued until a different person, within their own limit,
 * approves that amount; a later change to the company threshold neither approves it, nor
 * lets its requester decide it, nor lets a revision of the same quotation escape it.
 *
 * Operations exercised here: quo.quotation-create, quo.quotation-detail,
 * quo.quotation-revision-create, quo.quotation-issue, quo.quotation-item-decide,
 * quo.quotation-revision-decide, quo.discount-approval-list, quo.discount-approval-decide,
 * svc.discount-threshold-read, svc.discount-threshold-set.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   quo.quotation-create: route service authorization success denial cross-tenant isolation audit outbox idempotency rollback
 *   quo.quotation-detail: route service authorization success denial cross-tenant isolation
 *   quo.quotation-revision-create: route service authorization success denial audit stale-version concurrency cross-tenant idempotency isolation
 *   quo.quotation-issue: route service authorization success denial audit outbox stale-version concurrency rollback cross-tenant idempotency isolation
 *   quo.quotation-item-decide: route service authorization success denial cross-tenant audit outbox concurrency idempotency isolation
 *   quo.quotation-revision-decide: route service authorization success denial audit outbox rollback cross-tenant idempotency isolation
 *   quo.discount-approval-list: route service authorization success denial cross-tenant isolation
 *   quo.discount-approval-decide: route service authorization success denial cross-tenant audit idempotency isolation concurrency
 *   svc.discount-threshold-read: route service authorization success denial cross-tenant isolation
 *   svc.discount-threshold-set: route service authorization success denial audit stale-version idempotency cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_A2,
  COMPANY_B1,
  PARTNER_A,
  PARTNER_B,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import {
  SERVICE_A,
  SERVICE_A_ALT,
  SVC_FULL,
  SVC_PERMISSION_ELSEWHERE,
  SVC_READER,
  SVC_SCOPED_A2,
  SVC_NO_CEILING,
  SVC_QUO_SCOPED_A2,
  SVC_TENANT_B,
  SVC_TENANT_B_FULL,
  SVC_DISCOUNT_APPROVER,
  SVC_PRICE_SCOPED_A2,
  SVC_TENANT_B_APPROVER,
  SVC_RECORDED_APPROVER,
  SVC_APPROVER_COMPANY_A2,
  COMPANY_A2,
  TAX_CLASS_A,
  assignPriceList,
  auditCountFor,
  clearDiscountPolicy,
  evidenceRowsFor,
  seedDiscountCeiling,
  seedDiscountPolicy,
  seedLinkedDocumentVersion,
  authAs,
  establishP1_20Fixtures,
  outboxCountFor,
  priceListVersionOf,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { quotationModule } from '@/modules/quotation';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_PL_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { GET as QUOTATION_DETAIL } from '@/app/api/v1/quotations/[quotationId]/route';
import { POST as CREATE_REVISION } from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { POST as ISSUE } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { POST as DECIDE_ITEM } from '@/app/api/v1/quotation-items/[quotationItemId]/decisions/route';
import { POST as DECIDE_REVISION } from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { GET as LIST_DISCOUNT_APPROVALS } from '@/app/api/v1/discount-approvals/route';
import { POST as DECIDE_DISCOUNT } from '@/app/api/v1/discount-approvals/[approvalId]/decision/route';
import {
  GET as READ_THRESHOLD,
  POST as SET_THRESHOLD,
} from '@/app/api/v1/discount-thresholds/[companyId]/route';

let admin: Pool;
let runtime: Pool;
let codeSeq = 0;
let assignmentPriority = 100;

const nextCode = (): string => {
  codeSeq += 1;
  return `FX-QL-${String(Date.now() % 100000)}-${codeSeq}`;
};

/**
 * `key` is explicit only where a REPLAY is the thing under test; otherwise fresh.
 *
 * A fresh key per call is the right default — it keeps every other case exercising
 * the real handler rather than a stored response — but it also means a suite that
 * ONLY ever mints fresh keys proves nothing about what the key is for. The replay
 * cases below pass one deliberately.
 */
const jsonPost = (
  url: string,
  body: unknown,
  ifMatch?: number,
  key: string = crypto.randomUUID()
): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(body),
  });

function createQuotation(body: unknown, key?: string): Promise<Response> {
  return CREATE_QUOTATION(jsonPost('http://localhost/api/v1/quotations', body, undefined, key));
}
function detail(quotationId: string): Promise<Response> {
  return QUOTATION_DETAIL(new Request(`http://localhost/api/v1/quotations/${quotationId}`), {
    params: Promise.resolve({ quotationId }),
  });
}
function revise(
  quotationId: string,
  body: unknown,
  ifMatch: number,
  key?: string
): Promise<Response> {
  return CREATE_REVISION(
    jsonPost(`http://localhost/api/v1/quotations/${quotationId}/revisions`, body, ifMatch, key),
    { params: Promise.resolve({ quotationId }) }
  );
}
function issue(
  quotationId: string,
  body: unknown,
  ifMatch: number,
  key?: string
): Promise<Response> {
  return ISSUE(
    jsonPost(`http://localhost/api/v1/quotations/${quotationId}/issue`, body, ifMatch, key),
    { params: Promise.resolve({ quotationId }) }
  );
}
function decideItem(quotationItemId: string, body: unknown, key?: string): Promise<Response> {
  return DECIDE_ITEM(
    jsonPost(
      `http://localhost/api/v1/quotation-items/${quotationItemId}/decisions`,
      body,
      undefined,
      key
    ),
    { params: Promise.resolve({ quotationItemId }) }
  );
}
function decideRevision(revisionId: string, body: unknown, key?: string): Promise<Response> {
  return DECIDE_REVISION(
    jsonPost(
      `http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`,
      body,
      undefined,
      key
    ),
    { params: Promise.resolve({ revisionId }) }
  );
}

function decideDiscount(approvalId: string, body: unknown, key?: string): Promise<Response> {
  return DECIDE_DISCOUNT(
    jsonPost(
      `http://localhost/api/v1/discount-approvals/${approvalId}/decision`,
      body,
      undefined,
      key
    ),
    { params: Promise.resolve({ approvalId }) }
  );
}
function listDiscountApprovals(query: Record<string, string>): Promise<Response> {
  const search = new URLSearchParams(query).toString();
  return LIST_DISCOUNT_APPROVALS(
    new Request(`http://localhost/api/v1/discount-approvals?${search}`)
  );
}
function readThreshold(companyId: string): Promise<Response> {
  return READ_THRESHOLD(new Request(`http://localhost/api/v1/discount-thresholds/${companyId}`), {
    params: Promise.resolve({ companyId }),
  });
}
/** `body.companyId` names the company in the PATH; the rest is the request body. */
function setThreshold(
  body: { readonly companyId: string } & Record<string, unknown>,
  ifMatch?: number,
  key?: string
): Promise<Response> {
  const { companyId, ...payload } = body;
  return SET_THRESHOLD(
    jsonPost(`http://localhost/api/v1/discount-thresholds/${companyId}`, payload, ifMatch, key),
    { params: Promise.resolve({ companyId }) }
  );
}

interface DiscountApproval {
  readonly id: string;
  readonly revisionId: string;
  readonly status: string;
  readonly discountTotal: string;
  readonly discountBase: string;
  readonly elevatedLineCount: number;
  readonly requiredPermission: string;
  readonly requestedBy: { readonly id: string; readonly displayName: string | null };
  readonly requestedByCaller: boolean;
  readonly canApprove: boolean;
  readonly cannotApproveReason: string | null;
  readonly canReject: boolean;
  readonly origin: string;
  readonly decidedBy: { readonly id: string } | null;
  readonly decisionReason: string | null;
  readonly threshold: {
    readonly policyId: string;
    readonly versionNo: number;
    readonly kind: string;
    readonly value: string;
    readonly currency: string | null;
  } | null;
}
interface ThresholdView {
  readonly source: string;
  readonly recordVersion: number;
  readonly current: {
    readonly id: string;
    readonly versionNo: number;
    readonly thresholdKind: string;
    readonly thresholdValue: string;
    readonly currency: string | null;
    readonly requiredPermission: string;
    readonly status: string;
  } | null;
  readonly history: readonly { readonly versionNo: number; readonly status: string }[];
}
interface Problem {
  readonly code: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface Line {
  readonly id: string;
  readonly lineNumber: number;
  readonly unitPrice: string;
  readonly quantity: string;
  readonly discount: string;
  readonly taxRate: string;
  readonly taxAmount: string;
  readonly lineTotal: string;
}
interface Revision {
  readonly id: string;
  readonly revisionNumber: number;
  readonly status: string;
  readonly currency: string;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  readonly recordVersion: number;
  readonly lines: readonly Line[];
  readonly discountApproval: DiscountApproval | null;
}
interface Quotation {
  readonly id: string;
  readonly quotationNumber: string;
  readonly status: string;
  readonly currency: string;
  readonly recordVersion: number;
  readonly currentRevisionId: string | null;
  readonly currentRevision: Revision | null;
}

/** Publishes a price list carrying one rule for SERVICE_A and assigns it. */
async function publishPrice(amount: string, taxClassId?: string): Promise<void> {
  authAs(SVC_FULL);
  const list = (await (
    await CREATE_LIST(
      jsonPost('http://localhost/api/v1/price-lists', {
        priceListCode: nextCode(),
        name: 'Quotation fixture list',
        currency: 'JOD',
      })
    )
  ).json()) as { id: string; recordVersion: number };

  const version = (await (
    await CREATE_PL_VERSION(
      jsonPost(
        `http://localhost/api/v1/price-lists/${list.id}/versions`,
        { effectiveFrom: '2020-01-01' },
        list.recordVersion
      ),
      { params: Promise.resolve({ priceListId: list.id }) }
    )
  ).json()) as { id: string };

  await RECORD_RULE(
    jsonPost(`http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/rules`, {
      serviceId: SERVICE_A,
      amount,
      ...(taxClassId === undefined ? {} : { companyId: COMPANY_A1, taxClassId }),
    }),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );

  await PUBLISH(
    jsonPost(
      `http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/publication`,
      { effectiveFrom: '2020-01-01' },
      await priceListVersionOf(list.id)
    ),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );

  // A distinct, increasing priority so the newest fixture list wins:
  // uq_price_list_assignments_signature is unique on
  // (tenant, company, branch, class, priority) where active.
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

/** A quotation with one line, on a freshly opened work order. */
async function seedQuotation(
  options: { quantity?: string; discount?: string; payer?: string | null } = {}
): Promise<Quotation> {
  const order = await createOpenWorkOrder();
  authAs(SVC_FULL);
  const response = await createQuotation({
    workOrderId: order.workOrderId,
    ...(options.payer === null ? {} : { payerPartnerRef: options.payer ?? PARTNER_A }),
    lines: [
      {
        serviceId: SERVICE_A,
        quantity: options.quantity ?? '2.000',
        ...(options.discount === undefined ? {} : { discount: options.discount }),
      },
    ],
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as Quotation;
  if (options.discount === undefined) return created;
  // With no policy row every non-zero discount needs approval. `SVC_FULL` asked for it,
  // so somebody ELSE approves it before any case that goes on to issue.
  const approval = created.currentRevision?.discountApproval;
  expect(approval?.status).toBe('pending');
  authAs(SVC_DISCOUNT_APPROVER);
  const decided = await decideDiscount(approval?.id as string, { decision: 'approved' });
  expect(decided.status).toBe(200);
  return reread(created.id);
}

/** Issues the quotation's current draft revision. */
async function issueCurrent(quotation: Quotation, expiresAt?: string): Promise<Revision> {
  authAs(SVC_FULL);
  const revisionId = quotation.currentRevision?.id;
  expect(revisionId).toBeDefined();
  const response = await issue(
    quotation.id,
    { revisionId, ...(expiresAt === undefined ? {} : { expiresAt }) },
    quotation.recordVersion
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Revision;
}

async function reread(quotationId: string): Promise<Quotation> {
  authAs(SVC_FULL);
  return (await (await detail(quotationId)).json()) as Quotation;
}

/**
 * Runs `body` while one role holds NO discount limit, then puts the limit back.
 *
 * The fixtures' limits are per role; lifting one for the length of a case is how a
 * "no limit" refusal is proved against a principal that otherwise approves.
 */
async function clearCeilingOf(roleId: string, body: () => Promise<void>): Promise<void> {
  const saved = await admin.query<{ id: string }>(
    `UPDATE iam.approval_limits SET effective_to = effective_from + 1
      WHERE tenant_id = $1 AND role_id = $2 AND limit_type = 'discount' AND effective_to IS NULL
      RETURNING id`,
    [TENANT_A, roleId]
  );
  try {
    await body();
  } finally {
    await admin.query(
      `UPDATE iam.approval_limits SET effective_to = NULL WHERE id = ANY($1::uuid[])`,
      [saved.rows.map((row) => row.id)]
    );
  }
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
  await publishPrice('100.0000', TAX_CLASS_A);
  // SVC_FULL needs a discount ceiling: with no pricing_approval_policies row the
  // threshold is zero, so ANY non-zero discount needs both the elevated permission
  // and a ceiling. The no-ceiling refusal is proved separately below.
  await seedDiscountCeiling({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    roleId: SVC_FULL.roleId,
    amount: '1000.0000',
    currencyCode: 'JOD',
  });
  // The approver every two-step case uses: a limit set by the fixtures' administrator,
  // never by the approver, so it counts.
  await seedDiscountCeiling({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    roleId: SVC_DISCOUNT_APPROVER.roleId,
    amount: '1000.0000',
    currencyCode: 'JOD',
  });
  await seedDiscountCeiling({
    tenantId: TENANT_B,
    companyId: COMPANY_B1,
    roleId: SVC_TENANT_B_APPROVER.roleId,
    amount: '1000.0000',
    currencyCode: 'JOD',
  });
  // The approver whose authority is only the RECORDED permission, and the one scoped to
  // another company: both hold a limit that counts in COMPANY_A1, so a refusal they
  // collect is the permission or the scope, never the limit.
  for (const principal of [SVC_RECORDED_APPROVER, SVC_APPROVER_COMPANY_A2]) {
    await seedDiscountCeiling({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      roleId: principal.roleId,
      amount: '1000.0000',
      currencyCode: 'JOD',
    });
  }
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

describe('quo.quotation-create — the server computes the money', () => {
  it('prices a line from the protected list and computes tax and totals in SQL', async () => {
    const quotation = await seedQuotation({ quantity: '2.000' });
    const revision = quotation.currentRevision;
    expect(revision).not.toBeNull();
    const line = revision?.lines[0];

    // 100.0000 * 2.000 = 200.0000; tax rate 0.100000 → 20.0000; total 220.0000.
    // Every figure is PostgreSQL's, in the same expression shape the CHECK
    // constraints validate.
    expect(line?.unitPrice).toBe('100.0000');
    expect(line?.quantity).toBe('2.000');
    expect(line?.taxRate).toBe('0.100000');
    expect(line?.taxAmount).toBe('20.0000');
    expect(line?.lineTotal).toBe('220.0000');
    expect(quotation.currency).toBe('JOD');
    expect(quotation.status).toBe('draft');
  });

  it('applies a discount BEFORE tax, as the CHECK constraints require', async () => {
    const quotation = await seedQuotation({ quantity: '2.000', discount: '50.0000' });
    const line = quotation.currentRevision?.lines[0];
    // base 200 − 50 = 150; tax 15.0000; total 165.0000. Tax on the DISCOUNTED base.
    expect(line?.discount).toBe('50.0000');
    expect(line?.taxAmount).toBe('15.0000');
    expect(line?.lineTotal).toBe('165.0000');
  });

  it('audits WHY an elevated discount was authorized, once per revision', async () => {
    /**
     * `svc.discount.authorized` (P1-20-BE-006, P1-20-SEC-004).
     *
     * The action was declared in the controlled catalog and had NO producer: nothing in
     * `src/` emitted it, so the catalog documented behaviour that did not exist and
     * "this discount was authorized" was not recoverable from the audit trail at all.
     * `DiscountAuthorizationService.authorize` returns the threshold and the ceiling
     * precisely so the caller can record them — its own doc says "authorized" with no
     * reason is not an auditable fact — and the return value was discarded.
     *
     * One record per revision, not per line: the ceiling limits the ACTOR, the
     * document-level check is what enforces it, and 200 identical records would bury
     * the fact rather than record it.
     */
    const quotation = await seedQuotation({ quantity: '2.000', discount: '10.0000' });
    const revisionId = quotation.currentRevision?.id as string;
    expect(await auditCountFor('svc.discount.authorized', revisionId)).toBe(1);

    // Details are rows in `iam.audit_record_details`, not a jsonb column: the audit
    // trail stores one row per field with its own classification.
    const record = await admin.query<{ field_name: string; value_classification: string }>(
      `SELECT d.field_name, d.value_classification
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = 'svc.discount.authorized' AND r.entity_id = $1`,
      [revisionId]
    );
    const details = JSON.stringify(record.rows);
    // The threshold that applied and the ceiling checked — the two facts that make the
    // authorization reviewable. With no policy row configured the threshold is zero by
    // default, and that is recorded as such rather than omitted.
    expect(details).toContain('thresholdPolicyId');
    expect(details).toContain('thresholdKind');
    expect(details).toContain('thresholdValue');
    expect(details).toContain('ceilingAmount');
    expect(details).toContain('elevatedLineCount');
    expect(details).toContain('requiredPermission');
    // The amount given away and the ceiling checked are prices, so both are
    // `restricted` — the same classification every other amount in this trail carries.
    const restricted = record.rows.filter((row) => row.value_classification === 'restricted');
    expect(restricted.map((row) => row.field_name).sort()).toEqual([
      'ceilingAmount',
      'discountTotal',
    ]);
    // WHO asked and WHO approved — two different people, both recorded by the server.
    expect(details).toContain('requestedBy');
    expect(details).toContain('approvedBy');
    // The request and the decision are on the trail too, once each.
    const approvalId = quotation.currentRevision?.discountApproval?.id as string;
    expect(await auditCountFor('quo.discount_approval.requested', approvalId)).toBe(1);
    expect(await auditCountFor('quo.discount_approval.approved', approvalId)).toBe(1);

    // A quotation with NO discount records nothing: an ordinary edit is not an
    // authorization, and auditing it as one would misstate what happened.
    const plain = await seedQuotation({ quantity: '1.000' });
    expect(
      await auditCountFor('svc.discount.authorized', plain.currentRevision?.id as string)
    ).toBe(0);
  });

  it('records a discount from an actor with NO approval limit as a request, and refuses an approver with none', async () => {
    // Asking is not approving: SVC_NO_CEILING may quote, so its discount is recorded as
    // a pending request rather than refused.
    const order = await createOpenWorkOrder();
    authAs(SVC_NO_CEILING);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '1.0000' }],
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Quotation;
    const approval = created.currentRevision?.discountApproval as DiscountApproval;
    expect(approval.status).toBe('pending');
    expect(approval.requestedBy.id).toBe(SVC_NO_CEILING.userId);

    // An approver who holds the permission but no limit: fail-closed, and named. The
    // approver is not the requester, so the separation PASSES and this refusal is the
    // missing limit itself.
    authAs(SVC_FULL);
    await clearCeilingOf(SVC_FULL.roleId, async () => {
      const refused = await decideDiscount(approval.id, { decision: 'approved' });
      expect(refused.status).toBe(403);
      const body = (await refused.json()) as Problem;
      expect(body.code).toBe('ERR-IAM-001');
      expect(body.violations).toEqual([{ path: 'body', rule: 'discount_no_approval_limit' }]);
    });
  });

  it('REJECTS a client-supplied price, tax or total rather than ignoring it', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    for (const forbidden of ['unitPrice', 'taxAmount', 'taxRate', 'lineTotal']) {
      const response = await createQuotation({
        workOrderId: order.workOrderId,
        lines: [{ serviceId: SERVICE_A, quantity: '1.000', [forbidden]: '1.0000' }],
      });
      expect(response.status, forbidden).toBe(422);
    }
  });

  it('refuses an over-scale quantity and a JSON-number quantity', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    expect(
      (
        await createQuotation({
          workOrderId: order.workOrderId,
          lines: [{ serviceId: SERVICE_A, quantity: '1.0001' }],
        })
      ).status
    ).toBe(422);
    expect(
      (
        await createQuotation({
          workOrderId: order.workOrderId,
          lines: [{ serviceId: SERVICE_A, quantity: 1.5 }],
        })
      ).status
    ).toBe(422);
  });

  it('refuses an empty line list and a service that is not available', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    expect((await createQuotation({ workOrderId: order.workOrderId, lines: [] })).status).toBe(422);
    expect(
      (
        await createQuotation({
          workOrderId: order.workOrderId,
          lines: [{ serviceId: '00000000-0000-4000-8000-0000000000fe', quantity: '1.000' }],
        })
      ).status
    ).toBe(422);
  });

  it('401 unauthenticated and 403 without quo.quotation.manage', async () => {
    const order = await createOpenWorkOrder();
    __resetAuthenticatorForTests();
    expect(
      (
        await createQuotation({
          workOrderId: order.workOrderId,
          lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
        })
      ).status
    ).toBe(401);

    authAs(SVC_READER);
    expect(
      (
        await createQuotation({
          workOrderId: order.workOrderId,
          lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
        })
      ).status
    ).toBe(403);
  });

  it('refuses a work order in a branch the caller has no grant in (P1-18-A-01)', async () => {
    /**
     * The isolation case, with a principal that HOLDS both declared permissions.
     *
     * An earlier version used `SVC_PERMISSION_ELSEWHERE` — `svc.service.read` alone —
     * against a work order in BRANCH_A2, the very branch that principal is granted in.
     * So it held neither `quo.quotation.manage` nor `wo.work_order.read`, and no
     * out-of-scope resource was ever addressed: a scope-blind implementation passed.
     *
     * `SVC_QUO_SCOPED_A2` holds both permissions unreservedly, scoped to A2, and its
     * widening grant puts A1 in its allowed-branch union. The work order is in A1, so
     * the row is readable and the permissions are held: only the work order's own
     * resolved scope can refuse this.
     */
    const order = await createOpenWorkOrder({ branchId: BRANCH_A1 });
    authAs(SVC_QUO_SCOPED_A2);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-IAM-001');
    expect(
      await countRows(admin, 'quo.quotations', 'work_order_id = $1', [order.workOrderId])
    ).toBe(0);

    // A principal holding NO quotation permission is also refused — the permission
    // case, kept distinct from the scope case above.
    authAs(SVC_PERMISSION_ELSEWHERE);
    expect(
      (
        await createQuotation({
          workOrderId: order.workOrderId,
          lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
        })
      ).status
    ).toBe(403);
    void BRANCH_A2;
  });

  it('never lets a tenant-B caller quote a tenant-A work order', async () => {
    const order = await createOpenWorkOrder();
    /**
     * `SVC_TENANT_B_FULL`, not `SVC_TENANT_B`: the latter lacks `wo.work_order.read`,
     * one of the two permissions this route declares. Permissions are a CONJUNCTION and
     * are checked before any row is read, so a refusal of that principal is explained
     * by the missing permission alone and the tenant boundary is never reached.
     */
    authAs(SVC_TENANT_B_FULL);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(
      await countRows(admin, 'quo.quotations', 'work_order_id = $1', [order.workOrderId])
    ).toBe(0);
  });

  it('writes one audit record and one outbox event', async () => {
    const quotation = await seedQuotation();
    expect(await auditCountFor('quo.quotation.created', quotation.id)).toBe(1);
    expect(await outboxCountFor(`quotation.created:${quotation.id}`)).toBe(1);
  });

  it('requires an Idempotency-Key', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const response = await CREATE_QUOTATION(
      new Request('http://localhost/api/v1/quotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workOrderId: order.workOrderId,
          lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
        }),
      })
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-INT-002');
  });
});

describe('quo.quotation-detail', () => {
  it('returns money as decimal strings, never JSON numbers', async () => {
    const quotation = await seedQuotation();
    authAs(SVC_FULL);
    const raw = await (await detail(quotation.id)).text();
    // A float would appear unquoted. Every amount must be a quoted string.
    expect(raw).toContain('"unitPrice":"100.0000"');
    expect(raw).not.toMatch(/"unitPrice":\s*100/);
    expect(raw).toContain('"grandTotal":"');
  });

  it('403 without quo.quotation.read, and 404-shaped for another tenant', async () => {
    const quotation = await seedQuotation();
    authAs(SVC_READER);
    expect((await detail(quotation.id)).status).toBe(403);

    authAs(SVC_TENANT_B);
    const asB = await detail(quotation.id);
    expect(asB.status).toBeGreaterThanOrEqual(400);
    expect(await asB.text()).not.toContain('100.0000');
  });

  it('refuses a caller scoped to another branch', async () => {
    const quotation = await seedQuotation();
    // Holds `quo.quotation.read` in full, scoped to A2, with A1 in its allowed-branch
    // union. `SVC_SCOPED_A2` — used here before — holds `svc.service.read` only, so its
    // 403 was a missing permission and proved nothing about the row's scope.
    authAs(SVC_QUO_SCOPED_A2);
    const refused = await detail(quotation.id);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');

    // The permission case, kept separate.
    authAs(SVC_SCOPED_A2);
    expect((await detail(quotation.id)).status).toBe(403);
  });

  it('404s an unknown quotation and 422s a malformed id', async () => {
    authAs(SVC_FULL);
    const unknown = await detail('d2999999-0000-4000-8000-0000000000ee');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe('ERR-RES-001');
    expect((await detail('not-a-uuid')).status).toBe(422);
  });
});

describe('quo.quotation-revision-create — immutability of an issued revision', () => {
  it('creates a monotonic new revision and audits it', async () => {
    const quotation = await seedQuotation();
    authAs(SVC_FULL);
    const response = await revise(
      quotation.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '3.000' }] },
      quotation.recordVersion
    );
    expect(response.status).toBe(201);
    const revision = (await response.json()) as Revision;
    expect(revision.revisionNumber).toBe(2);
    expect(await auditCountFor('quo.quotation_revision.created', revision.id)).toBe(1);
  });

  it('leaves an ISSUED revision unchanged when the price list is republished', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    expect(issued.grandTotal).toBe('110.0000');

    // The commercial world moves on: a NEW published version at a higher amount.
    await publishPrice('500.0000', TAX_CLASS_A);

    // The issued revision's captured figures must not move — that is what makes it
    // an immutable snapshot of what the customer was shown.
    //
    // Asserted against the STORED columns rather than the read model. The claim is
    // about what the database holds for THAT revision id, and reading it directly
    // cannot be confounded by which revision a projection happens to select.
    const frozen = await admin.query<{ unit: string; total: string; grand: string }>(
      `SELECT i.captured_unit_price::text AS unit,
              i.captured_line_total::text AS total,
              r.captured_grand_total::text AS grand
         FROM quo.quotation_items i
         JOIN quo.quotation_revisions r ON r.id = i.quotation_revision_id
        WHERE i.quotation_revision_id = $1`,
      [issued.id]
    );
    expect(frozen.rows[0]?.unit).toBe('100.0000');
    expect(frozen.rows[0]?.total).toBe('110.0000');
    expect(frozen.rows[0]?.grand).toBe('110.0000');

    const after = await reread(quotation.id);

    // A NEW revision does pick up the new price.
    authAs(SVC_FULL);
    const next = (await (
      await revise(
        quotation.id,
        { lines: [{ serviceId: SERVICE_A, quantity: '1.000' }] },
        after.recordVersion
      )
    ).json()) as Revision;
    expect(next.lines[0]?.unitPrice).toBe('500.0000');
  });

  it('403 without quo.quotation.manage', async () => {
    // The authorization floor: every other `revise` caller holds the permission
    // (SVC_TENANT_B_FULL for the tenant case, SVC_QUO_SCOPED_A2 for the scope case),
    // so neither of those refusals is evidence that a missing permission is refused.
    const quotation = await seedQuotation({ quantity: '1.000' });
    authAs(SVC_READER);
    const refused = await revise(
      quotation.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000' }] },
      quotation.recordVersion
    );
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');

    __resetAuthenticatorForTests();
    expect(
      (
        await revise(
          quotation.id,
          { lines: [{ serviceId: SERVICE_A, quantity: '1.000' }] },
          quotation.recordVersion
        )
      ).status
    ).toBe(401);
  });

  it('requires If-Match and refuses a stale version', async () => {
    const quotation = await seedQuotation();
    authAs(SVC_FULL);
    const stale = await revise(
      quotation.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000' }] },
      999
    );
    expect(((await stale.json()) as { code: string }).code).toBe('ERR-CON-001');
  });

  it('gives concurrent revisions distinct numbers', async () => {
    const quotation = await seedQuotation();
    authAs(SVC_FULL);
    const body = { lines: [{ serviceId: SERVICE_A, quantity: '1.000' }] };
    const [a, b] = await Promise.all([
      revise(quotation.id, body, quotation.recordVersion),
      revise(quotation.id, body, quotation.recordVersion),
    ]);
    const created = [a, b].filter((r) => r.status === 201);
    // At most one may win on the same If-Match; if both somehow land, their
    // revision numbers must differ — uq_quotation_revisions_number guarantees it.
    if (created.length === 2) {
      const numbers = await Promise.all(
        created.map(async (r) => ((await r.json()) as Revision).revisionNumber)
      );
      expect(new Set(numbers).size).toBe(2);
    } else {
      expect(created).toHaveLength(1);
    }
  });
});

describe('quo.quotation-issue', () => {
  it('issues, freezes totals, moves the quotation to active, and emits one event', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const draftLine = quotation.currentRevision?.lines[0];
    const issued = await issueCurrent(quotation);
    expect(issued.status).toBe('issued');

    // Asserted RELATIVE to the line the draft actually carried, not against a
    // hard-coded 100: an earlier test republishes the price list, so pinning an
    // absolute amount here would make this test depend on suite order rather than
    // on what `quo.issue_revision` computed. The invariant under test is that the
    // document totals are the SUM over the live items, which is what the function
    // does and what `ck_quotation_revisions_totals` validates.
    expect(issued.subtotal).toBe(draftLine?.unitPrice);
    expect(issued.taxTotal).toBe(draftLine?.taxAmount);
    expect(issued.grandTotal).toBe(draftLine?.lineTotal);

    const after = await reread(quotation.id);
    expect(after.status).toBe('active');
    expect(after.currentRevisionId).toBe(issued.id);
    expect(await auditCountFor('quo.quotation_revision.issued', issued.id)).toBe(1);
    expect(await outboxCountFor(`quotation.revision-issued:${issued.id}`)).toBe(1);
  });

  it('refuses a second issue of the same revision and publishes no second event', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const after = await reread(quotation.id);

    authAs(SVC_FULL);
    const again = await issue(quotation.id, { revisionId: issued.id }, after.recordVersion);
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(await outboxCountFor(`quotation.revision-issued:${issued.id}`)).toBe(1);
  });

  it('refuses an expiry that has already passed', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    authAs(SVC_FULL);
    const response = await issue(
      quotation.id,
      { revisionId: quotation.currentRevision?.id, expiresAt: '2020-01-01T00:00:00Z' },
      quotation.recordVersion
    );
    expect(response.status).toBe(422);
  });

  it('supersedes the previous issued revision, keeping exactly one issued', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const first = await issueCurrent(quotation);

    const afterFirst = await reread(quotation.id);
    authAs(SVC_FULL);
    const second = (await (
      await revise(
        quotation.id,
        { lines: [{ serviceId: SERVICE_A, quantity: '2.000' }] },
        afterFirst.recordVersion
      )
    ).json()) as Revision;

    const afterRevise = await reread(quotation.id);
    authAs(SVC_FULL);
    expect(
      (await issue(quotation.id, { revisionId: second.id }, afterRevise.recordVersion)).status
    ).toBe(200);

    const issuedCount = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM quo.quotation_revisions
        WHERE quotation_id = $1 AND status = 'issued'`,
      [quotation.id]
    );
    expect(issuedCount.rows[0]?.n).toBe('1');

    const superseded = await admin.query<{ status: string }>(
      `SELECT status FROM quo.quotation_revisions WHERE id = $1`,
      [first.id]
    );
    expect(superseded.rows[0]?.status).toBe('superseded');
  });

  it('403 without quo.quotation.manage, 401 unauthenticated', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const revisionId = quotation.currentRevision?.id as string;
    authAs(SVC_READER);
    const refused = await issue(quotation.id, { revisionId }, quotation.recordVersion);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');

    __resetAuthenticatorForTests();
    expect((await issue(quotation.id, { revisionId }, quotation.recordVersion)).status).toBe(401);

    const after = await admin.query<{ status: string }>(
      `SELECT status FROM quo.quotation_revisions WHERE id = $1`,
      [revisionId]
    );
    expect(after.rows[0]?.status).toBe('draft');
  });

  it('refuses a WRONG If-Match, not merely a missing one', async () => {
    // `versionGuarded: true` means the header is mandatory AND a wrong value is
    // refused. Every other issue call in this suite passed the CURRENT version, so
    // only the first half was ever exercised.
    const quotation = await seedQuotation({ quantity: '1.000' });
    const revisionId = quotation.currentRevision?.id as string;
    authAs(SVC_FULL);
    const stale = await issue(quotation.id, { revisionId }, 999);
    expect(stale.status).toBeGreaterThanOrEqual(400);
    expect(((await stale.json()) as { code: string }).code).toBe('ERR-CON-001');

    const after = await admin.query<{ status: string }>(
      `SELECT status FROM quo.quotation_revisions WHERE id = $1`,
      [revisionId]
    );
    expect(after.rows[0]?.status).toBe('draft');
  });

  it('under a forced RACE issues exactly once and publishes exactly one event', async () => {
    /**
     * Genuinely concurrent, which "a second attempt is refused" is not.
     *
     * Two requests race on one draft revision with the same If-Match. The
     * quotation-row lock serialises them, the loser sees a bumped `record_version`
     * (`ERR-CON-001`) or a non-draft revision, and the deterministic outbox key makes a
     * double publish impossible rather than merely unlikely.
     */
    const quotation = await seedQuotation({ quantity: '1.000' });
    const revisionId = quotation.currentRevision?.id as string;
    authAs(SVC_FULL);
    const [a, b] = await Promise.all([
      issue(quotation.id, { revisionId }, quotation.recordVersion),
      issue(quotation.id, { revisionId }, quotation.recordVersion),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses.filter((code) => code === 200)).toHaveLength(1);
    expect(statuses.filter((code) => code >= 400)).toHaveLength(1);
    expect(await outboxCountFor(`quotation.revision-issued:${revisionId}`)).toBe(1);

    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM quo.quotation_revisions
        WHERE quotation_id = $1 AND status = 'issued'`,
      [quotation.id]
    );
    expect(rows.rows[0]?.n).toBe('1');
  });

  it('rollback: a failure at the LAST statement undoes the issue entirely', async () => {
    /**
     * A genuine rollback, forced AFTER every write.
     *
     * The zero-line case below is a refusal thrown before `quo.issue_revision` runs —
     * "nothing was written" is trivially true of a command that never wrote. Here the
     * outbox key this issue is about to publish is pre-taken for the tenant, so
     * `publishEvent` raises at the last statement of the transaction, after
     * `quo.issue_revision` has moved the revision to `issued`, repointed
     * `current_revision_id`, moved the quotation to `active` and frozen all four
     * totals, and after the audit record has been appended. Every one of those must be
     * gone afterwards.
     *
     * A different `aggregate_id` on the pre-inserted row keeps it out of this
     * revision's own counts while still colliding on `event_key`.
     */
    const quotation = await seedQuotation({ quantity: '1.000' });
    const revisionId = quotation.currentRevision?.id as string;
    await admin.query(
      `INSERT INTO shared.event_outbox
         (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
          aggregate_version, producer, created_by)
       VALUES ($1,$2,'quotation.revision-issued','quo.quotation_revision',$3,1,1,
               'quotation.quotation-service',$4)`,
      [TENANT_A, `quotation.revision-issued:${revisionId}`, crypto.randomUUID(), USER_A]
    );

    authAs(SVC_FULL);
    const response = await issue(quotation.id, { revisionId }, quotation.recordVersion);
    expect(response.status).toBeGreaterThanOrEqual(400);

    const after = await admin.query<{ r: string; q: string; current: string | null }>(
      `SELECT r.status AS r, q.status AS q, q.current_revision_id::text AS current
         FROM quo.quotation_revisions r JOIN quo.quotations q ON q.id = r.quotation_id
        WHERE r.id = $1`,
      [revisionId]
    );
    expect(after.rows[0]?.r).toBe('draft');
    expect(after.rows[0]?.q).toBe('draft');
    expect(after.rows[0]?.current).toBeNull();
    expect(await auditCountFor('quo.quotation_revision.issued', revisionId)).toBe(0);
  });

  it('leaves no state and no event when the revision has no lines', async () => {
    // A rollback proof: a revision with zero items cannot be issued, and nothing
    // partial survives the refusal.
    const quotation = await seedQuotation({ quantity: '1.000' });
    const revisionId = quotation.currentRevision?.id as string;
    await admin.query(`DELETE FROM quo.quotation_items WHERE quotation_revision_id = $1`, [
      revisionId,
    ]);

    authAs(SVC_FULL);
    const response = await issue(quotation.id, { revisionId }, quotation.recordVersion);
    expect(response.status).toBe(422);

    const state = await admin.query<{ status: string }>(
      `SELECT status FROM quo.quotation_revisions WHERE id = $1`,
      [revisionId]
    );
    expect(state.rows[0]?.status).toBe('draft');
    expect(await outboxCountFor(`quotation.revision-issued:${revisionId}`)).toBe(0);
    expect(await auditCountFor('quo.quotation_revision.issued', revisionId)).toBe(0);
  });
});

describe('quo.quotation-item-decide', () => {
  it('records an approval and rolls the quotation up to accepted', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const itemId = issued.lines[0]?.id as string;

    authAs(SVC_FULL);
    const response = await decideItem(itemId, {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBe(201);

    const after = await reread(quotation.id);
    expect(after.status).toBe('accepted');
    expect(await auditCountFor('quo.quotation_item.decided', itemId)).toBe(1);
    expect(await auditCountFor('quo.quotation.accepted', quotation.id)).toBe(1);
    expect(await outboxCountFor(`quotation.accepted:${issued.id}`)).toBe(1);
  });

  it('treats one rejected line as a rejected quotation', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);

    authAs(SVC_FULL);
    expect(
      (
        await decideItem(issued.lines[0]?.id as string, {
          decision: 'rejected',
          channel: 'phone',
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(201);

    // Not an acceptance: treating a partial rejection as one would authorize work
    // the customer declined.
    expect((await reread(quotation.id)).status).toBe('rejected');
  });

  it('refuses a decision on a SUPERSEDED revision, so approving N never approves N+1', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const first = await issueCurrent(quotation);
    const staleItemId = first.lines[0]?.id as string;

    const afterFirst = await reread(quotation.id);
    authAs(SVC_FULL);
    const second = (await (
      await revise(
        quotation.id,
        { lines: [{ serviceId: SERVICE_A, quantity: '2.000' }] },
        afterFirst.recordVersion
      )
    ).json()) as Revision;
    const afterRevise = await reread(quotation.id);
    authAs(SVC_FULL);
    await issue(quotation.id, { revisionId: second.id }, afterRevise.recordVersion);

    // The client still holds revision 1's item and id.
    const response = await decideItem(staleItemId, {
      decision: 'approved',
      channel: 'portal',
      presentedRevisionId: first.id,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-CON-001');
  });

  it('refuses a presentedRevisionId that is not the revision being decided', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_FULL);
    const response = await decideItem(issued.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'email',
      presentedRevisionId: '00000000-0000-4000-8000-0000000000aa',
    });
    expect(((await response.json()) as { code: string }).code).toBe('ERR-CON-001');
  });

  it('refuses a forged deciding party', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_FULL);
    // PARTNER_B is not this quotation's payer.
    const response = await decideItem(issued.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_B,
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('is idempotent for the same decision and a conflict for the opposite', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const itemId = issued.lines[0]?.id as string;
    authAs(SVC_FULL);
    const body = { decision: 'approved', channel: 'portal', presentedRevisionId: issued.id };

    expect((await decideItem(itemId, body)).status).toBe(201);
    // A replay of the SAME decision settles rather than erroring.
    expect((await decideItem(itemId, body)).status).toBe(201);
    // Exactly one stored decision — uq_approval_decisions_item makes it final.
    const stored = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM quo.approval_decisions WHERE quotation_item_id = $1`,
      [itemId]
    );
    expect(stored.rows[0]?.n).toBe('1');
  });

  it('refuses an invalid channel and an invalid decision word', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_FULL);
    expect(
      (
        await decideItem(issued.lines[0]?.id as string, {
          decision: 'approved',
          channel: 'carrier_pigeon',
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(422);
    // `declined` is NOT the schema's word; `rejected` is.
    expect(
      (
        await decideItem(issued.lines[0]?.id as string, {
          decision: 'declined',
          channel: 'phone',
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(422);
  });

  it('refuses a decision on a DRAFT revision', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    authAs(SVC_FULL);
    const response = await decideItem(quotation.currentRevision?.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'in_person',
      presentedRevisionId: quotation.currentRevision?.id,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('403 without quo.decision.record', async () => {
    /**
     * A TENANT-A principal lacking only `quo.decision.record`.
     *
     * This case used `SVC_TENANT_B` and asserted `>= 400`, which conflates two
     * different refusals: that principal is in another tenant AND lacks the permission,
     * so the assertion could not attribute the refusal to either. The tenant boundary
     * has its own case below, with a principal that holds the permission.
     */
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_READER);
    const response = await decideItem(issued.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'in_person',
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-IAM-001');

    __resetAuthenticatorForTests();
    expect(
      (
        await decideItem(issued.lines[0]?.id as string, {
          decision: 'approved',
          channel: 'in_person',
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(401);
  });

  it('never lets a tenant-B caller decide a tenant-A line', async () => {
    // `SVC_TENANT_B_FULL` holds `quo.decision.record` unrestricted, so the only thing
    // that can refuse it is the tenant boundary.
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_TENANT_B_FULL);
    const response = await decideItem(issued.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'in_person',
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(
      await countRows(admin, 'quo.approval_decisions', 'quotation_revision_id = $1', [issued.id])
    ).toBe(0);
    expect((await reread(quotation.id)).status).toBe('active');
  });

  it('under a forced RACE records exactly one decision for a line', async () => {
    /**
     * Genuinely concurrent. The existing replay pair is two sequential `await`s, which
     * proves idempotency and says nothing about a race.
     *
     * Two opposite decisions on the same line at the same time: whichever lands first
     * is the customer's decision, and `uq_approval_decisions_item` plus the parent lock
     * taken inside `quo.record_item_decision` must leave exactly one row. Both landing
     * would mean a line simultaneously approved and rejected.
     */
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const itemId = issued.lines[0]?.id as string;
    authAs(SVC_FULL);
    const [a, b] = await Promise.all([
      decideItem(itemId, {
        decision: 'approved',
        channel: 'in_person',
        presentedRevisionId: issued.id,
      }),
      decideItem(itemId, {
        decision: 'rejected',
        channel: 'phone',
        presentedRevisionId: issued.id,
      }),
    ]);
    const codes = [a.status, b.status];
    expect(codes.filter((code) => code === 201)).toHaveLength(1);
    expect(codes.filter((code) => code >= 400)).toHaveLength(1);
    expect(
      await countRows(admin, 'quo.approval_decisions', 'quotation_revision_id = $1', [issued.id])
    ).toBe(1);
  });

  it('rejects a direct storage key — the field cannot express one', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_FULL);
    const response = await decideItem(issued.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'email',
      presentedRevisionId: issued.id,
      evidence: { evidenceKind: 'document', documentVersionId: 'tenant-a/quotations/blob.pdf' },
    });
    // Not a uuid, so it is refused before any storage layer is consulted.
    expect(response.status).toBe(422);
  });

  it('refuses document evidence with no document version, and vice versa', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const itemId = issued.lines[0]?.id as string;
    authAs(SVC_FULL);
    // ck_approval_evidence_document: `document` iff a version is present.
    expect(
      (
        await decideItem(itemId, {
          decision: 'approved',
          channel: 'email',
          presentedRevisionId: issued.id,
          evidence: { evidenceKind: 'document' },
        })
      ).status
    ).toBe(422);
    expect(
      (
        await decideItem(itemId, {
          decision: 'approved',
          channel: 'email',
          presentedRevisionId: issued.id,
          evidence: {
            evidenceKind: 'verbal',
            documentVersionId: '00000000-0000-4000-8000-0000000000ab',
          },
        })
      ).status
    ).toBe(422);
  });

  it('refuses a version linked to ANOTHER quotation and accepts the one linked to this', async () => {
    /**
     * The forged-attachment control, and the only shape that can prove it.
     *
     * An earlier version of this case sent a version id nothing had inserted. That
     * died on `findVersion` — ERR-RES-001, a 404 — and never reached the link check
     * at all, so `linkedToEntity` could have been hard-coded `true` and the test
     * would still have passed on a `status >= 400` assertion. It also meant
     * `insertEvidence` had no execution anywhere in the phase.
     *
     * Both versions here are REAL, in the caller's tenant, on the quotation's own
     * company and branch, and equally visible. The single variable is which entity
     * the live `shared.document_links` row names. So the refusal can only be the
     * link check, and the acceptance proves the same check passes when it should —
     * a mutation making `linkedToEntity` constant fails one half or the other
     * whichever constant it picks.
     */
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const itemId = issued.lines[0]?.id as string;

    // A second, genuinely existing quotation, so the rejected document is attached
    // to something real rather than dangling.
    const otherQuotation = await seedQuotation({ quantity: '1.000' });

    const foreign = await seedLinkedDocumentVersion({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      linkedTo: { entityType: 'quo.quotations', entityId: otherQuotation.id },
      title: 'Approval evidence for a different quotation',
    });
    const own = await seedLinkedDocumentVersion({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      linkedTo: { entityType: 'quo.quotations', entityId: quotation.id },
      title: 'Approval evidence for this quotation',
    });

    authAs(SVC_FULL);
    const refused = await decideItem(itemId, {
      decision: 'approved',
      channel: 'email',
      presentedRevisionId: issued.id,
      evidence: { evidenceKind: 'document', documentVersionId: foreign.versionId },
    });
    // 422/ERR-VAL-001 is the LINK refusal specifically: a missing version answers
    // ERR-RES-001/404 and a foreign company or branch answers ERR-IAM-001/403, so
    // the code discriminates the branch under test from its two neighbours.
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-VAL-001');
    // The refusal happens before any write, so the line is still undecided.
    expect(
      await countRows(admin, 'quo.approval_decisions', 'quotation_item_id = $1', [itemId])
    ).toBe(0);

    authAs(SVC_FULL);
    const accepted = await decideItem(itemId, {
      decision: 'approved',
      channel: 'email',
      presentedRevisionId: issued.id,
      evidence: {
        evidenceKind: 'document',
        documentVersionId: own.versionId,
        referenceNote: 'Signed acceptance',
      },
    });
    expect(accepted.status).toBe(201);
    const view = (await accepted.json()) as { decisionId: string; evidenceId: string | null };
    expect(view.evidenceId).not.toBeNull();

    // Counted in SQL, not inferred from the response: `quo.approval_evidence` is
    // append-only under forced RLS and nothing else in the phase writes to it.
    expect(
      await countRows(admin, 'quo.approval_evidence', 'approval_decision_id = $1', [
        view.decisionId,
      ])
    ).toBe(1);
    const stored = await evidenceRowsFor(view.decisionId);
    expect(stored).toEqual([{ evidenceKind: 'document', documentVersionId: own.versionId }]);
    // And the decision itself cites the same version, so the two records agree.
    const decision = await admin.query<{ evidence_ref: string | null }>(
      `SELECT evidence_ref FROM quo.approval_decisions WHERE id = $1`,
      [view.decisionId]
    );
    expect(decision.rows[0]?.evidence_ref).toBe(own.versionId);
  });
});

describe('quo.quotation-revision-decide — atomic orchestration', () => {
  it('decides every line of a revision in one transaction', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const created = (await (
      await createQuotation({
        workOrderId: order.workOrderId,
        payerPartnerRef: PARTNER_A,
        lines: [
          { serviceId: SERVICE_A, quantity: '1.000' },
          { serviceId: SERVICE_A, quantity: '2.000', description: 'Second line' },
        ],
      })
    ).json()) as Quotation;
    expect(created.currentRevision?.lines).toHaveLength(2);

    const issued = await issueCurrent(created);
    authAs(SVC_FULL);
    const response = await decideRevision(issued.id, {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBe(201);
    const outcome = (await response.json()) as {
      itemsDecided: number;
      quotationStatus: string | null;
    };
    expect(outcome.itemsDecided).toBe(2);
    expect(outcome.quotationStatus).toBe('accepted');

    // One aggregate audit record for the revision-wide act.
    expect(await auditCountFor('quo.quotation_revision.decided', issued.id)).toBe(1);
    // And a per-item decision row for each line — the stored truth.
    const stored = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM quo.approval_decisions WHERE quotation_revision_id = $1`,
      [issued.id]
    );
    expect(stored.rows[0]?.n).toBe('2');
  });

  it('aborts wholly when one line already carries the OPPOSITE decision', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const created = (await (
      await createQuotation({
        workOrderId: order.workOrderId,
        payerPartnerRef: PARTNER_A,
        lines: [
          { serviceId: SERVICE_A, quantity: '1.000' },
          { serviceId: SERVICE_A, quantity: '2.000', description: 'Second' },
        ],
      })
    ).json()) as Quotation;
    const issued = await issueCurrent(created);

    authAs(SVC_FULL);
    // Reject line one first.
    expect(
      (
        await decideItem(issued.lines[0]?.id as string, {
          decision: 'rejected',
          channel: 'phone',
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(201);

    // A revision-wide APPROVAL must abort rather than overwrite that rejection.
    //
    // It is refused at the STATE gate with ERR-TRN-001, not the conflict gate: the
    // roll-up already moved the revision to `rejected` when line one was rejected,
    // and `quo.guard_quotation_revision_freeze` treats that as terminal. So the
    // rejection is protected one step earlier than the per-line conflict check —
    // stronger than the conflict path, and worth stating rather than asserting the
    // code I first assumed.
    const response = await decideRevision(issued.id, {
      decision: 'approved',
      channel: 'in_person',
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');

    // Line two stayed undecided: all-or-nothing, so nothing partial survived.
    const decided = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM quo.approval_decisions WHERE quotation_revision_id = $1`,
      [issued.id]
    );
    expect(decided.rows[0]?.n).toBe('1');
  });

  it('403 without quo.decision.record', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_READER);
    expect(
      (
        await decideRevision(issued.id, {
          decision: 'approved',
          channel: 'in_person',
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(403);
  });

  it('emits exactly one outcome event for the revision', async () => {
    // The `outbox` floor for this operation, which the success case above did not
    // assert: it checked the audit record and the per-item decision rows only.
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_FULL);
    expect(
      (
        await decideRevision(issued.id, {
          decision: 'approved',
          channel: 'in_person',
          decidingPartyRef: PARTNER_A,
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(201);
    expect(await outboxCountFor(`quotation.accepted:${issued.id}`)).toBe(1);
    expect(await outboxCountFor(`quotation.rejected:${issued.id}`)).toBe(0);
  });

  it('rollback: a per-line conflict mid-loop undoes the decisions already written', async () => {
    /**
     * A genuine partial-abort, forced AFTER a write.
     *
     * The existing all-or-nothing case is refused at the STATE gate, before any write
     * on this request — its own comment says so — so the surviving row belongs to the
     * earlier command and the assertion cannot fail whatever the transaction does.
     *
     * Here line TWO is approved individually first, which leaves the revision decidable
     * (the roll-up returns `null` while line one is undecided, so nothing moves to a
     * terminal state). A revision-wide REJECTION then writes line one's rejection and
     * only then hits the opposite-decision conflict on line two. Line one's rejection
     * therefore existed inside the transaction and must be gone afterwards.
     */
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const created = (await (
      await createQuotation({
        workOrderId: order.workOrderId,
        payerPartnerRef: PARTNER_A,
        lines: [
          { serviceId: SERVICE_A, quantity: '1.000' },
          { serviceId: SERVICE_A, quantity: '2.000', description: 'Second' },
        ],
      })
    ).json()) as Quotation;
    const issued = await issueCurrent(created);
    const [lineOne, lineTwo] = [issued.lines[0]?.id as string, issued.lines[1]?.id as string];

    authAs(SVC_FULL);
    expect(
      (
        await decideItem(lineTwo, {
          decision: 'approved',
          channel: 'phone',
          presentedRevisionId: issued.id,
        })
      ).status
    ).toBe(201);
    // Still decidable: one line undecided, so the roll-up moved nothing.
    expect((await reread(created.id)).status).toBe('active');

    authAs(SVC_FULL);
    const response = await decideRevision(issued.id, {
      decision: 'rejected',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);

    // Exactly the ONE pre-existing approval survives: line one's rejection, written
    // earlier in the same transaction, was rolled back with it.
    const rows = await admin.query<{ item: string; decision: string }>(
      `SELECT quotation_item_id::text AS item, decision FROM quo.approval_decisions
        WHERE quotation_revision_id = $1`,
      [issued.id]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.item).toBe(lineTwo);
    expect(rows.rows[0]?.decision).toBe('approved');
    void lineOne;
    // And no outcome event: the revision never reached a terminal roll-up.
    expect(await outboxCountFor(`quotation.rejected:${issued.id}`)).toBe(0);
  });
});

/**
 * The floors the operation-coverage gate derives from the registrations themselves
 * (P1-20-SEC-001, P1-20-QA-003, P1-20-QA-004).
 *
 * A quotation takes its scope from the work order it belongs to and is addressed by
 * id, so `isolation` and `cross-tenant` are the two ways a caller could reach one it
 * has no authority over, and `idempotency` is declared by all four writes. The gate
 * began requiring these only when `svc.`/`quo.` were added to `DERIVED_PREFIXES`;
 * before that it accepted whatever the manifest volunteered.
 *
 * `SVC_QUO_SCOPED_A2` holds `quo.quotation.manage` and `quo.decision.record` in FULL,
 * scoped to branch A2. Every refusal it collects below is therefore the resolved
 * scope of the row and not a missing permission — the distinction P1-18-A-01 exists
 * to make.
 */
describe('quo writes — tenant, scope and idempotency floors', () => {
  /** The same POST, minus the `Idempotency-Key` header. */
  const withoutKey = (url: string, body: unknown, ifMatch?: number): Request =>
    new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
      },
      body: JSON.stringify(body),
    });

  it('quo.quotation-revision-create refuses no key, another tenant, and another branch', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const lines = [{ serviceId: SERVICE_A, quantity: '3.000' }];

    authAs(SVC_FULL);
    const noKey = await CREATE_REVISION(
      withoutKey(
        `http://localhost/api/v1/quotations/${quotation.id}/revisions`,
        { lines },
        quotation.recordVersion
      ),
      { params: Promise.resolve({ quotationId: quotation.id }) }
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(((await noKey.json()) as { code: string }).code).toBe('ERR-INT-002');

    authAs(SVC_TENANT_B_FULL);
    const asB = await revise(quotation.id, { lines }, quotation.recordVersion);
    expect(asB.status).toBeGreaterThanOrEqual(400);
    expect(asB.status).toBeLessThan(500);

    authAs(SVC_QUO_SCOPED_A2);
    const wrongBranch = await revise(quotation.id, { lines }, quotation.recordVersion);
    expect(wrongBranch.status).toBe(403);

    // Neither attempt created a revision: still exactly the one from creation.
    expect(
      await countRows(admin, 'quo.quotation_revisions', 'quotation_id = $1', [quotation.id])
    ).toBe(1);
  });

  it('quo.quotation-issue refuses no key, another tenant, and another branch', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const revisionId = quotation.currentRevision?.id as string;

    authAs(SVC_FULL);
    const noKey = await ISSUE(
      withoutKey(
        `http://localhost/api/v1/quotations/${quotation.id}/issue`,
        { revisionId },
        quotation.recordVersion
      ),
      { params: Promise.resolve({ quotationId: quotation.id }) }
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(((await noKey.json()) as { code: string }).code).toBe('ERR-INT-002');

    authAs(SVC_TENANT_B_FULL);
    const asB = await issue(quotation.id, { revisionId }, quotation.recordVersion);
    expect(asB.status).toBeGreaterThanOrEqual(400);
    expect(asB.status).toBeLessThan(500);

    authAs(SVC_QUO_SCOPED_A2);
    const wrongBranch = await issue(quotation.id, { revisionId }, quotation.recordVersion);
    expect(wrongBranch.status).toBe(403);

    // The revision is still a draft, so nothing was presented to a customer.
    const after = await admin.query<{ status: string }>(
      `SELECT status FROM quo.quotation_revisions WHERE id = $1`,
      [revisionId]
    );
    expect(after.rows[0]?.status).toBe('draft');
  });

  it('quo.quotation-item-decide refuses no key and another branch', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const itemId = issued.lines[0]?.id as string;
    const decision = {
      decision: 'approved',
      channel: 'in_person',
      presentedRevisionId: issued.id,
    };

    authAs(SVC_FULL);
    const noKey = await DECIDE_ITEM(
      withoutKey(`http://localhost/api/v1/quotation-items/${itemId}/decisions`, decision),
      { params: Promise.resolve({ quotationItemId: itemId }) }
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(((await noKey.json()) as { code: string }).code).toBe('ERR-INT-002');

    authAs(SVC_QUO_SCOPED_A2);
    expect((await decideItem(itemId, decision)).status).toBe(403);

    expect(
      await countRows(admin, 'quo.approval_decisions', 'quotation_revision_id = $1', [issued.id])
    ).toBe(0);
  });

  it('quo.quotation-revision-decide refuses no key, another tenant, and another branch', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const decision = {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: issued.id,
    };

    authAs(SVC_FULL);
    const noKey = await DECIDE_REVISION(
      withoutKey(`http://localhost/api/v1/quotation-revisions/${issued.id}/decisions`, decision),
      { params: Promise.resolve({ revisionId: issued.id }) }
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(((await noKey.json()) as { code: string }).code).toBe('ERR-INT-002');

    authAs(SVC_TENANT_B_FULL);
    const asB = await decideRevision(issued.id, decision);
    expect(asB.status).toBeGreaterThanOrEqual(400);
    expect(asB.status).toBeLessThan(500);

    authAs(SVC_QUO_SCOPED_A2);
    expect((await decideRevision(issued.id, decision)).status).toBe(403);

    expect(
      await countRows(admin, 'quo.approval_decisions', 'quotation_revision_id = $1', [issued.id])
    ).toBe(0);
    // And the quotation was not rolled up by an unauthorized decision.
    expect((await reread(quotation.id)).status).toBe('active');
  });
});

/**
 * An `Idempotency-Key` REPLAY executes once — every idempotent quotation write.
 *
 * The floors above prove the header is MANDATORY. That is only half the contract, and
 * on its own it is the weaker half: a route could demand the key, ignore it entirely
 * and still pass every one of those cases. These prove what the key is mandatory FOR
 * — the same key with the same request executes the command exactly once and serves
 * the stored response the second time.
 *
 * Two constants across all five, both platform behaviour rather than anything these
 * routes chose:
 *
 *  - **The replay answers 200, never the 201 the first attempt answered.**
 *    `route-handler.ts` stores `value.body` alone, so the replay is rebuilt as
 *    `{ body }` with no status and falls back to the handler default. Asserted rather
 *    than papered over; recorded as `P1-20-A-10`.
 *  - **The `If-Match` header is NOT part of the fingerprint**, and the replay short
 *    circuits before the handler reads `expectedVersion`. So a retry of a
 *    version-guarded command replays even though the record it guards has moved on —
 *    which is the point: the retry of a command that already succeeded must not be
 *    refused as stale.
 *
 * Every count below is taken in SQL through the admin pool, because the response is
 * exactly the artifact under suspicion.
 */
describe('quo writes — an Idempotency-Key replay executes once', () => {
  it('quo.quotation-create replays to one quotation, not two', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const key = crypto.randomUUID();
    const body = {
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '2.000' }],
    };

    const first = await createQuotation(body, key);
    expect(first.status).toBe(201);
    const second = await createQuotation(body, key);
    expect(second.status).toBe(200);

    const firstBody = (await first.json()) as Quotation;
    expect(await second.json()).toEqual(firstBody);

    // One quotation, and one quotation NUMBER: the sequence allocation sits inside
    // the same transaction as the reservation, so a second execution would have
    // consumed a number the caller never learns about.
    expect(
      await countRows(admin, 'quo.quotations', 'work_order_id = $1', [order.workOrderId])
    ).toBe(1);
    expect(await auditCountFor('quo.quotation.created', firstBody.id)).toBe(1);
    expect(await outboxCountFor(`quotation.created:${firstBody.id}`)).toBe(1);
  });

  it('quo.quotation-revision-create replays to one revision, not two', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    authAs(SVC_FULL);
    const key = crypto.randomUUID();
    const body = { lines: [{ serviceId: SERVICE_A, quantity: '3.000' }] };

    const first = await revise(quotation.id, body, quotation.recordVersion, key);
    expect(first.status).toBe(201);
    // The SAME stale `If-Match` on purpose: the quotation's record_version moved when
    // the first attempt succeeded, and a retry must not be told its own success is a
    // conflict.
    const second = await revise(quotation.id, body, quotation.recordVersion, key);
    expect(second.status).toBe(200);

    const firstBody = (await first.json()) as Revision;
    expect(await second.json()).toEqual(firstBody);

    // Two revisions in total — the one creation made, plus exactly one from the
    // replayed pair. `revision_number` is monotonic, so a second execution would be
    // visible as a third row.
    expect(
      await countRows(admin, 'quo.quotation_revisions', 'quotation_id = $1', [quotation.id])
    ).toBe(2);
    expect(await auditCountFor('quo.quotation_revision.created', firstBody.id)).toBe(1);
  });

  it('quo.quotation-issue replays to one issued revision and one event', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const revisionId = quotation.currentRevision?.id as string;
    authAs(SVC_FULL);
    const key = crypto.randomUUID();

    const first = await issue(quotation.id, { revisionId }, quotation.recordVersion, key);
    expect(first.status).toBe(200);
    const second = await issue(quotation.id, { revisionId }, quotation.recordVersion, key);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    // Issue is not row-creating, so the evidence is the outbox and the trail: a second
    // execution would be refused as non-draft, which is a DIFFERENT protection and
    // would leave the caller's retry looking like a failure.
    expect(await outboxCountFor(`quotation.revision-issued:${revisionId}`)).toBe(1);
    expect(await auditCountFor('quo.quotation_revision.issued', revisionId)).toBe(1);
  });

  it('quo.quotation-item-decide replays to one decision row', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    const itemId = issued.lines[0]?.id as string;
    authAs(SVC_FULL);
    const key = crypto.randomUUID();
    const body = { decision: 'approved', channel: 'in_person', presentedRevisionId: issued.id };

    const first = await decideItem(itemId, body, key);
    expect(first.status).toBe(201);
    const second = await decideItem(itemId, body, key);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    // The domain protects this one twice over — `uq_approval_decisions_item` and
    // `settleExisting` — so the row count alone cannot distinguish a replay from a
    // second execution that was absorbed. The AUDIT count can: `settleExisting`
    // returns before `auditDecision`, but a second execution reaching it would not.
    expect(
      await countRows(admin, 'quo.approval_decisions', 'quotation_item_id = $1', [itemId])
    ).toBe(1);
    expect(await auditCountFor('quo.quotation_item.decided', itemId)).toBe(1);
    expect(await outboxCountFor(`quotation.accepted:${issued.id}`)).toBe(1);
  });

  it('quo.quotation-revision-decide replays to one decision per line and one audit record', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const created = (await (
      await createQuotation({
        workOrderId: order.workOrderId,
        payerPartnerRef: PARTNER_A,
        lines: [
          { serviceId: SERVICE_A, quantity: '1.000' },
          { serviceId: SERVICE_A, quantity: '2.000', description: 'Second line' },
        ],
      })
    ).json()) as Quotation;
    const issued = await issueCurrent(created);

    authAs(SVC_FULL);
    const key = crypto.randomUUID();
    const body = {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: issued.id,
    };

    const first = await decideRevision(issued.id, body, key);
    expect(first.status).toBe(201);
    const second = await decideRevision(issued.id, body, key);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    expect(
      await countRows(admin, 'quo.approval_decisions', 'quotation_revision_id = $1', [issued.id])
    ).toBe(2);
    // The aggregate audit record is the sharp one: `appendAudit` runs unconditionally
    // after the loop, so a second EXECUTION would append a second record claiming two
    // lines were decided when none were. Only the replay keeps it at one.
    expect(await auditCountFor('quo.quotation_revision.decided', issued.id)).toBe(1);
    expect(await outboxCountFor(`quotation.accepted:${issued.id}`)).toBe(1);
  });
});

/**
 * `QuotationService.expireLapsed` — the sweep contract (P1-20-BE-010, P1-20-DO-002).
 *
 * No route reaches it: expiry is time-driven, and a customer's window closing is not
 * something a client asks for. That makes it exactly the kind of surface that ships
 * unexercised, so it is driven directly here through a request context, against the
 * real database and the real guards.
 *
 * `expires_at` is not frozen by `tg_quotation_revisions_immutable`, so a fixture can
 * backdate it as admin. Issuing with a past expiry is refused by the route on
 * purpose, which is why backdating — rather than a fabricated clock — is how a lapsed
 * revision comes to exist.
 */
describe('QuotationService.expireLapsed', () => {
  const backdate = (revisionId: string): Promise<unknown> =>
    admin.query(
      `UPDATE quo.quotation_revisions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [revisionId]
    );

  const sweep = (limit = 10): Promise<readonly string[]> =>
    withTransaction(
      contextFor({
        userId: SVC_FULL.userId,
        tenantId: TENANT_A,
        companyIds: [COMPANY_A1],
        branchIds: [BRANCH_A1],
        operation: 'quo.quotation-expire-sweep',
        module: 'quotation',
      }),
      (db) => quotationModule().quotations.expireLapsed(db, limit)
    );

  it('expires a lapsed issued revision, audits it, and emits exactly one event', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation, '2099-01-01T00:00:00.000Z');
    await backdate(issued.id);

    const expired = await sweep();
    expect(expired).toContain(issued.id);

    const after = await admin.query<{ r: string; q: string }>(
      `SELECT r.status AS r, q.status AS q
         FROM quo.quotation_revisions r JOIN quo.quotations q ON q.id = r.quotation_id
        WHERE r.id = $1`,
      [issued.id]
    );
    expect(after.rows[0]?.r).toBe('expired');
    expect(after.rows[0]?.q).toBe('expired');
    expect(await auditCountFor('quo.quotation.expired', quotation.id)).toBe(1);
    expect(await outboxCountFor(`quotation.expired:${issued.id}`)).toBe(1);

    // Idempotent: the revision is terminal, so a second sweep finds no candidate and
    // cannot publish a second event. Forcing it would raise from the freeze guard.
    expect(await sweep()).toEqual([]);
    expect(await outboxCountFor(`quotation.expired:${issued.id}`)).toBe(1);
  });

  it('NEVER expires a quotation the customer already accepted', async () => {
    /**
     * The defect this case exists for.
     *
     * A revision stays `issued` after every line is APPROVED — only a rejection moves
     * it, to `rejected`. So selecting candidates on revision status alone also selects
     * the revisions of ACCEPTED quotations, and expiring one moves the quotation from
     * `accepted` to `expired`: a customer's approval revoked by a background sweep,
     * with an audit record claiming the previous status was `active`. Nothing in the
     * database refuses it — `expired` is a legal successor of `active` and the freeze
     * guard only governs the revision — so the only thing standing between an accepted
     * quotation and silent revocation is the parent-state test, and the only thing
     * keeping that test honest is this case.
     */
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation, '2099-01-01T00:00:00.000Z');

    authAs(SVC_FULL);
    const accepted = await decideRevision(issued.id, {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: issued.id,
    });
    expect(accepted.status).toBe(201);
    expect((await reread(quotation.id)).status).toBe('accepted');
    // The revision is STILL `issued` — which is the whole hazard.
    const mid = await admin.query<{ status: string }>(
      `SELECT status FROM quo.quotation_revisions WHERE id = $1`,
      [issued.id]
    );
    expect(mid.rows[0]?.status).toBe('issued');

    await backdate(issued.id);
    expect(await sweep()).toEqual([]);

    const after = await admin.query<{ r: string; q: string }>(
      `SELECT r.status AS r, q.status AS q
         FROM quo.quotation_revisions r JOIN quo.quotations q ON q.id = r.quotation_id
        WHERE r.id = $1`,
      [issued.id]
    );
    expect(after.rows[0]?.q).toBe('accepted');
    expect(after.rows[0]?.r).toBe('issued');
    expect(await auditCountFor('quo.quotation.expired', quotation.id)).toBe(0);
    expect(await outboxCountFor(`quotation.expired:${issued.id}`)).toBe(0);
  });

  it('leaves a revision with no expiry alone, however old', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    // No `expiresAt`: a revision with no expiry never lapses (`expires_at` NULL).
    const issued = await issueCurrent(quotation);
    expect(await sweep()).not.toContain(issued.id);
    expect((await reread(quotation.id)).status).toBe('active');
  });
});

/**
 * Splitting a discount across lines does not defeat either gate (P1-20-BE-006).
 *
 * The hole this closes: the document-level check ran only `if (elevatedLines > 0)`, which
 * is exactly the case splitting avoids. With a threshold of 50, lines of 49 are each
 * individually under it — so before this the actor needed no approval at all and had no
 * limit compared against the total. The document is measured through the same policy a
 * single line of that size would be, so a split discount needs approval exactly when the
 * whole would, and the approver's limit is compared against the WHOLE.
 *
 * Since P1-32-PRE-OD-DISC-01 "needs approval" means a recorded request that somebody other
 * than the requester approves, so these cases approve as `SVC_DISCOUNT_APPROVER`.
 *
 * These cases need a real `svc.pricing_approval_policies` row: with no policy the threshold
 * is zero, every non-zero discount already needs approval, and splitting is inexpressible.
 * The policy is torn down afterwards so the rest of the suite keeps the zero default.
 */
describe('discount splitting defeats neither the threshold nor the approver limit', () => {
  const POLICY_THRESHOLD = '50.0000';

  beforeAll(async () => {
    await seedDiscountPolicy({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      thresholdKind: 'amount',
      thresholdValue: POLICY_THRESHOLD,
      currencyCode: 'JOD',
      // The LEGACY flag set to false. Nothing reads it: the separation applies whenever
      // approval is required, and one case below asserts the refusal.
      makerApproverDistinct: false,
    });
  });

  afterAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  const createSplit = async (count: number, each: string): Promise<Quotation> => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: Array.from({ length: count }, (_unused, index) => ({
        serviceId: SERVICE_A,
        quantity: '1.000',
        discount: each,
        description: `Line ${index + 1}`,
      })),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Quotation;
  };

  it('allows a single under-threshold discount with no approval at all', async () => {
    // The control case. 40 is under the 50 threshold, so this is an ordinary edit and must
    // stay one — a fix that asked for approval here would have broken the feature.
    const order = await createOpenWorkOrder();
    authAs(SVC_NO_CEILING); // holds quo.quotation.manage; has NO approval limit
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }],
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Quotation;
    expect(created.currentRevision?.lines[0]?.discount).toBe('40.0000');
    expect(created.currentRevision?.discountApproval).toBeNull();
    // Nothing needed approving, so nothing is audited as an authorization.
    expect(
      await auditCountFor('svc.discount.authorized', created.currentRevision?.id as string)
    ).toBe(0);
    // And it issues straight away.
    authAs(SVC_FULL);
    const issued = await issue(
      created.id,
      { revisionId: created.currentRevision?.id },
      created.recordVersion
    );
    expect(issued.status).toBe(200);
  });

  it('asks for approval of SPLIT discounts that clear the threshold only in aggregate', async () => {
    /**
     * Three lines of 40 = 120, over the 50 threshold in aggregate while no single line
     * reaches it. The request is recorded with no elevated LINE — the aggregate is what
     * needs approval — and the revision cannot be issued until it is approved.
     */
    const created = await createSplit(3, '40.0000');
    const approval = created.currentRevision?.discountApproval as DiscountApproval;
    expect(approval.status).toBe('pending');
    expect(approval.discountTotal).toBe('120.0000');
    expect(approval.elevatedLineCount).toBe(0);
    expect(approval.threshold?.value).toBe(POLICY_THRESHOLD);

    const refused = await issue(
      created.id,
      { revisionId: created.currentRevision?.id },
      created.recordVersion
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);

    // An approver with no limit cannot clear it; the aggregate is what is measured.
    authAs(SVC_NO_CEILING);
    const noLimit = await decideDiscount(approval.id, { decision: 'approved' });
    expect(noLimit.status).toBe(403);
    expect(((await noLimit.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_no_approval_limit' },
    ]);
  });

  it('measures the approver limit against the WHOLE split discount, by name', async () => {
    /**
     * `SVC_DISCOUNT_APPROVER`'s limit is 1000. Six lines of 40 = 240 is inside it and is
     * approved; twenty-six lines of 40 = 1040 exceeds it and is refused with
     * `discount_over_approval_limit` — even though every single line is under both the
     * 50 threshold and the 1000 limit.
     */
    const within = await createSplit(6, '40.0000');
    authAs(SVC_DISCOUNT_APPROVER);
    const approved = await decideDiscount(within.currentRevision?.discountApproval?.id as string, {
      decision: 'approved',
    });
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as DiscountApproval;
    expect(approvedBody.status).toBe('approved');
    // The approver's limit is never part of a request's payload.
    expect(approvedBody).not.toHaveProperty('approverLimit');
    expect(
      await auditCountFor('svc.discount.authorized', within.currentRevision?.id as string)
    ).toBe(1);

    const over = await createSplit(26, '40.0000');
    authAs(SVC_DISCOUNT_APPROVER);
    const refused = await decideDiscount(over.currentRevision?.discountApproval?.id as string, {
      decision: 'approved',
    });
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as Problem;
    expect(body.code).toBe('ERR-IAM-001');
    expect(body.violations).toEqual([{ path: 'body', rule: 'discount_over_approval_limit' }]);
    // Refused means untouched: still pending, and not issuable.
    const still = await reread(over.id);
    expect(still.currentRevision?.discountApproval?.status).toBe('pending');
  });

  it('audits the split approval even when NO single line was elevated', async () => {
    const created = await createSplit(2, '30.0000');
    const revisionId = created.currentRevision?.id as string;
    // Two lines of 30: 60 in aggregate, over the 50 threshold, with no single line near it.
    expect(created.currentRevision?.lines.map((line) => line.discount)).toEqual([
      '30.0000',
      '30.0000',
    ]);
    authAs(SVC_DISCOUNT_APPROVER);
    const approved = await decideDiscount(created.currentRevision?.discountApproval?.id as string, {
      decision: 'approved',
    });
    expect(approved.status).toBe(200);
    expect(await auditCountFor('svc.discount.authorized', revisionId)).toBe(1);

    const details = await admin.query<{ field_name: string }>(
      `SELECT d.field_name FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = 'svc.discount.authorized' AND r.entity_id = $1`,
      [revisionId]
    );
    const fields = details.rows.map((row) => row.field_name);
    expect(fields).toContain('discountTotal');
    expect(fields).toContain('thresholdValue');
    expect(fields).toContain('ceilingAmount');
  });

  /**
   * This suite's policy row carries `maker_approver_distinct = false`. It used to switch
   * the separation off; nothing reads it now. The requester approving their own split
   * discount is refused by name, whatever the row says.
   */
  it('refuses the requester approving their own split discount although the legacy flag says false', async () => {
    const created = await createSplit(2, '30.0000');
    authAs(SVC_FULL);
    const refused = await decideDiscount(created.currentRevision?.discountApproval?.id as string, {
      decision: 'approved',
    });
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as Problem;
    expect(body.code).toBe('ERR-IAM-001');
    expect(body.violations).toEqual([{ path: 'body', rule: 'discount_approver_must_differ' }]);
  });
});

/**
 * The create path is atomic, including the NUMBER it consumed (P1-20-BE-007).
 *
 * Every other rollback proof in this phase forces a failure at the end of a transaction.
 * `create` cannot be attacked that way: its outbox key is `quotation.created:<quotationId>`
 * and the id is generated inside the transaction, so a test cannot pre-empt it — the same
 * obstacle P1-19 hit with approval ids.
 *
 * `uq_quotations_number` is the way in. The sequence allocation runs immediately BEFORE
 * `insertQuotation`, so pre-taking the number the sequence is about to produce makes
 * `insertQuotation` fail with the counter already bumped. What must then be true is the
 * thing worth proving: `next_value` goes back.
 *
 * That matters beyond tidiness. `shared.next_display_number()` is `SECURITY INVOKER` and is
 * called on the request's own handle, so its increment is part of this transaction — if it
 * were not, a failed create would burn a quotation number and leave a permanent gap in a
 * customer-facing sequence that no later request can fill. An autonomous-transaction or
 * separate-connection allocator would pass every other test in this file and fail this one.
 */
describe('quo.quotation-create — atomicity of the number it consumes', () => {
  const sequenceState = (): Promise<{ next_value: string } | undefined> =>
    admin
      .query<{ next_value: string }>(
        `SELECT next_value::text AS next_value FROM shared.number_sequences
          WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
            AND sequence_code = 'quotation'`,
        [TENANT_A, COMPANY_A1, BRANCH_A1]
      )
      .then((result) => result.rows[0]);

  it('rolls the allocated number back when the insert fails after allocation', async () => {
    const order = await createOpenWorkOrder();
    const before = await sequenceState();
    expect(before).toBeDefined();

    // `QUO-` + lpad(next_value, 6, '0') is what `shared.next_display_number()` will render,
    // read from the sequence row rather than assumed.
    const collidingNumber = `QUO-${String(before?.next_value).padStart(6, '0')}`;
    await admin.query(
      `INSERT INTO quo.quotations
         (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code,
          status, created_by)
       VALUES ($1,$2,$3,$4,$5,'JOD','draft',$6)`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, order.workOrderId, collidingNumber, USER_A]
    );

    try {
      authAs(SVC_FULL);
      const response = await createQuotation({
        workOrderId: order.workOrderId,
        payerPartnerRef: PARTNER_A,
        lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
      });
      expect(response.status).toBeGreaterThanOrEqual(400);

      // The counter is exactly where it was: the allocation rolled back with the insert.
      const after = await sequenceState();
      expect(after?.next_value).toBe(before?.next_value);

      // And only the pre-planted row exists — no second quotation, no orphan revision, no
      // orphan item, no audit record and no outbox row for a quotation that does not exist.
      const rows = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM quo.quotations WHERE work_order_id = $1`,
        [order.workOrderId]
      );
      expect(rows.rows[0]?.n).toBe('1');
      const orphans = await admin.query<{ revisions: string; items: string }>(
        `SELECT
         (SELECT count(*)::text FROM quo.quotation_revisions r
            JOIN quo.quotations q ON q.id = r.quotation_id
           WHERE q.work_order_id = $1) AS revisions,
         (SELECT count(*)::text FROM quo.quotation_items i
            JOIN quo.quotation_revisions r ON r.id = i.quotation_revision_id
            JOIN quo.quotations q ON q.id = r.quotation_id
           WHERE q.work_order_id = $1) AS items`,
        [order.workOrderId]
      );
      expect(orphans.rows[0]?.revisions).toBe('0');
      expect(orphans.rows[0]?.items).toBe('0');
    } finally {
      /**
       * The planted row must never outlive this test.
       *
       * `finally`, not a trailing statement: an assertion failure above would otherwise
       * leak a `quo.quotations` row, and the next run's `cleanBackendFixtures` then aborts
       * mid-cascade — the observed symptom was a foreign-key error on
       * `rec.reception_visits`, three tables away from the actual cause, which marked the
       * whole file as failed rather than one test.
       */
      await admin.query(`DELETE FROM quo.quotations WHERE quotation_number = $1`, [
        collidingNumber,
      ]);
    }
  });

  it('does not consume a number when a line is refused before any write', async () => {
    /**
     * The complementary half, and the reason the create path has no other post-write
     * failure point: every line is priced, quantity-checked and discount-authorized in
     * `priceLines` BEFORE the quotation row is written, so a bad line cannot leave partial
     * state. Asserting the counter is untouched is what makes that ordering observable
     * rather than a claim about the code.
     */
    const order = await createOpenWorkOrder();
    const before = await sequenceState();

    authAs(SVC_FULL);
    const refused = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [
        { serviceId: SERVICE_A, quantity: '1.000' },
        // Not available at this branch: refused inside priceLines, before allocation.
        { serviceId: SERVICE_A_ALT, quantity: '1.000', description: 'Not sellable here' },
      ],
    });
    // ERR-VAL-001, which the error catalog maps to 422 — not 400. The point of the case is
    // the sequence counter below, not the status, but the status must still be the real one.
    expect(refused.status).toBe(422);

    const after = await sequenceState();
    expect(after?.next_value).toBe(before?.next_value);
    expect(
      await countRows(admin, 'quo.quotations', 'work_order_id = $1', [order.workOrderId])
    ).toBe(0);
  });
});

/**
 * A discounted quotation whose discount needs approval, created by `SVC_FULL` and left
 * PENDING (P1-32-PRE-OD-DISC-01). With no policy row the threshold is zero, so any
 * non-zero discount is a request.
 */
async function seedPendingDiscount(discount = '5.0000'): Promise<Quotation> {
  const order = await createOpenWorkOrder();
  authAs(SVC_FULL);
  const response = await createQuotation({
    workOrderId: order.workOrderId,
    payerPartnerRef: PARTNER_A,
    lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount }],
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as Quotation;
  expect(created.currentRevision?.discountApproval?.status).toBe('pending');
  return created;
}

const approvalOf = (quotation: Quotation): DiscountApproval =>
  quotation.currentRevision?.discountApproval as DiscountApproval;

/**
 * The requester is a SERVER fact (P1-32-PRE-OD-DISC-01).
 *
 * The single-request design took the requester from the request body, so the only
 * separation of duties was a colleague the caller NAMED — and naming any active colleague
 * let a person approve their own discount. The field is gone: the schema is `.strict()`,
 * so a client still sending it is refused by name rather than ignored, and the request is
 * recorded against the signed-in person.
 */
describe('quo.quotation-create — the discount requester is the signed-in person', () => {
  beforeAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  it.each([
    ['a colleague', SVC_READER.userId],
    ['the caller themselves', SVC_FULL.userId],
  ])('refuses a request that still names %s as the requester', async (_label, requestedBy) => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const refused = await createQuotation({
      workOrderId: order.workOrderId,
      discountRequestedBy: requestedBy,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '5.0000' }],
    });
    expect(refused.status).toBe(422);
    const body = (await refused.json()) as Problem;
    expect(body.code).toBe('ERR-VAL-001');
    expect(body.violations?.map((violation) => violation.rule)).toContain('unrecognized_keys');
    expect(
      await countRows(admin, 'quo.quotations', 'work_order_id = $1', [order.workOrderId])
    ).toBe(0);
  });

  it('records the request against the signed-in person, and audits it', async () => {
    const created = await seedPendingDiscount();
    const approval = approvalOf(created);
    expect(approval.requestedBy.id).toBe(SVC_FULL.userId);
    expect(approval.requestedByCaller).toBe(true);
    const stored = await admin.query<{ requested_by: string; status: string }>(
      `SELECT requested_by, status FROM quo.discount_approvals WHERE id = $1`,
      [approval.id]
    );
    expect(stored.rows[0]).toEqual({ requested_by: SVC_FULL.userId, status: 'pending' });

    const details = await admin.query<{ field_name: string; new_value_masked: string | null }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = 'quo.discount_approval.requested' AND r.entity_id = $1`,
      [approval.id]
    );
    const requester = details.rows.find((row) => row.field_name === 'requestedBy');
    expect(requester?.new_value_masked).toContain(SVC_FULL.userId);
    // Nothing is AUTHORIZED at the request: that fact is written by the approval.
    expect(
      await auditCountFor('svc.discount.authorized', created.currentRevision?.id as string)
    ).toBe(0);
  });
});

/**
 * The two-step flow, end to end, and every refusal on the decision (P1-32-PRE-OD-DISC-01).
 */
describe('quo.discount-approval-decide — a discount is approved by somebody else', () => {
  beforeAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  it('cannot be issued while pending, is approved by another person within their limit, then issues', async () => {
    const created = await seedPendingDiscount('40.0000');
    const approval = approvalOf(created);
    const revisionId = created.currentRevision?.id as string;

    authAs(SVC_FULL);
    const early = await issue(created.id, { revisionId }, created.recordVersion);
    expect(early.status).toBe(409);
    expect(((await early.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);

    authAs(SVC_DISCOUNT_APPROVER);
    const key = crypto.randomUUID();
    const approved = await decideDiscount(approval.id, { decision: 'approved' }, key);
    expect(approved.status).toBe(200);
    const body = (await approved.json()) as DiscountApproval;
    expect(body.status).toBe('approved');
    expect(body.decidedBy?.id).toBe(SVC_DISCOUNT_APPROVER.userId);
    expect(body.requestedBy.id).toBe(SVC_FULL.userId);
    expect(body.requestedByCaller).toBe(false);
    // Decided, it is no longer the approver's to decide — and no limit is returned.
    expect(body.canApprove).toBe(false);
    expect(body.cannotApproveReason).toBe('not_pending');
    expect(body.canReject).toBe(false);
    expect(body).not.toHaveProperty('approverLimit');
    // The approval is of an amount: the one asked for, recorded on the row.
    const bound = await admin.query<{ approved: string; currency: string }>(
      `SELECT approved_discount_total::text AS approved, approved_currency_code AS currency
         FROM quo.discount_approvals WHERE id = $1`,
      [approval.id]
    );
    expect(bound.rows[0]).toEqual({ approved: '40.0000', currency: 'JOD' });

    // A retry with the same key replays the recorded answer and records nothing twice.
    const replay = await decideDiscount(approval.id, { decision: 'approved' }, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(body);
    expect(await auditCountFor('quo.discount_approval.approved', approval.id)).toBe(1);
    expect(await auditCountFor('svc.discount.authorized', revisionId)).toBe(1);

    authAs(SVC_FULL);
    const issued = await issue(created.id, { revisionId }, created.recordVersion);
    expect(issued.status).toBe(200);
    expect(((await issued.json()) as Revision).discountTotal).toBe('40.0000');
  });

  it('refuses the requester, by name, whatever authority they hold', async () => {
    // SVC_FULL holds svc.price.manage and a 1000 limit set by somebody else — every
    // authority an approver needs — and still may not approve its own request.
    const created = await seedPendingDiscount();
    authAs(SVC_FULL);
    for (const decision of ['approved', 'rejected'] as const) {
      const refused = await decideDiscount(approvalOf(created).id, {
        decision,
        ...(decision === 'rejected' ? { reason: 'Changed my mind' } : {}),
      });
      expect(refused.status, decision).toBe(403);
      expect(((await refused.json()) as Problem).violations, decision).toEqual([
        { path: 'body', rule: 'discount_approver_must_differ' },
      ]);
    }
    expect((await reread(created.id)).currentRevision?.discountApproval?.status).toBe('pending');
  });

  it('never counts a limit the approver set for themselves, and does count one somebody else set', async () => {
    /**
     * `SVC_NO_CEILING` holds the permission and no limit. A limit it set for its own
     * account, or for its own role, never counts (QA row 7.1d); the identical limit set by
     * the fixtures' administrator does — which is what makes the refusal the setter and
     * not the amount.
     */
    const created = await seedPendingDiscount();
    const inserted: string[] = [];
    const plant = async (column: 'user_id' | 'role_id', createdBy: string): Promise<void> => {
      const row = await admin.query<{ id: string }>(
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, ${column}, limit_type, amount, currency_code, effective_from, created_by)
         VALUES ($1, $2, $3, 'discount', 9999, 'JOD', '2020-01-01'::date, $4)
         RETURNING id`,
        [
          TENANT_A,
          COMPANY_A1,
          column === 'user_id' ? SVC_NO_CEILING.userId : SVC_NO_CEILING.roleId,
          createdBy,
        ]
      );
      inserted.push(row.rows[0]?.id as string);
    };
    try {
      await plant('user_id', SVC_NO_CEILING.userId);
      await plant('role_id', SVC_NO_CEILING.userId);
      authAs(SVC_NO_CEILING);
      const refused = await decideDiscount(approvalOf(created).id, { decision: 'approved' });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_no_approval_limit' },
      ]);

      // The same shape of limit, set by somebody else. The self-set account limit goes
      // first: two account limits of one type may not overlap in time.
      await admin.query('DELETE FROM iam.approval_limits WHERE id = $1', [inserted[0]]);
      await plant('user_id', USER_A);
      authAs(SVC_NO_CEILING);
      const approved = await decideDiscount(approvalOf(created).id, { decision: 'approved' });
      expect(approved.status).toBe(200);
      expect(((await approved.json()) as DiscountApproval).status).toBe('approved');
      // The limit the approval was within is on the record — restricted, never returned.
      const recorded = await admin.query<{ amount: string }>(
        `SELECT approver_limit_amount::text AS amount FROM quo.discount_approvals WHERE id = $1`,
        [approvalOf(created).id]
      );
      expect(recorded.rows[0]?.amount).toBe('9999.0000');
    } finally {
      await admin.query('DELETE FROM iam.approval_limits WHERE id = ANY($1::uuid[])', [inserted]);
    }
  });

  it('turns a request down only with a reason, after which the revision can never be issued', async () => {
    const created = await seedPendingDiscount();
    const approval = approvalOf(created);
    authAs(SVC_DISCOUNT_APPROVER);
    const reasonless = await decideDiscount(approval.id, { decision: 'rejected' });
    expect(reasonless.status).toBe(422);
    expect(((await reasonless.json()) as Problem).violations).toEqual([
      { path: 'body.reason', rule: 'required' },
    ]);

    const rejected = await decideDiscount(approval.id, {
      decision: 'rejected',
      reason: 'More than this job can carry',
    });
    expect(rejected.status).toBe(200);
    const body = (await rejected.json()) as DiscountApproval;
    expect(body.status).toBe('rejected');
    expect(body.decisionReason).toBe('More than this job can carry');
    expect(body).not.toHaveProperty('approverLimit');
    expect(await auditCountFor('quo.discount_approval.rejected', approval.id)).toBe(1);

    const again = await decideDiscount(approval.id, { decision: 'approved' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_already_decided' },
    ]);

    authAs(SVC_FULL);
    const refused = await issue(
      created.id,
      { revisionId: created.currentRevision?.id },
      created.recordVersion
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_rejected' },
    ]);
  });

  it('refuses a caller without quotation read (denial), without the RECORDED permission (named), and one scoped to another branch or company (isolation)', async () => {
    const created = await seedPendingDiscount();
    const approvalId = approvalOf(created).id;
    // denial at the gate: no quo.quotation.read at all.
    authAs(SVC_READER);
    const denied = await decideDiscount(approvalId, { decision: 'approved' });
    expect(denied.status).toBe(403);
    // The gate passes (quotation read) but the request recorded svc.price.manage, which
    // this caller does not hold: refused by name, for approving AND for turning down.
    authAs(SVC_RECORDED_APPROVER);
    for (const decision of ['approved', 'rejected'] as const) {
      const unrecorded = await decideDiscount(approvalId, {
        decision,
        ...(decision === 'rejected' ? { reason: 'Not mine to decide' } : {}),
      });
      expect(unrecorded.status, decision).toBe(403);
      expect(((await unrecorded.json()) as Problem).violations, decision).toEqual([
        { path: 'body', rule: 'discount_approval_permission_missing' },
      ]);
    }
    // isolation: quo.quotation.read in FULL, scoped to branch A2 — with an unrelated A1
    // grant that makes the A1 row readable — so the only thing that refuses it is the
    // scoped check against the approval's own branch (P1-18-A-01).
    authAs(SVC_QUO_SCOPED_A2);
    const scoped = await decideDiscount(approvalId, { decision: 'approved' });
    expect(scoped.status).toBe(403);
    // ...and every approver authority, limit included, granted only in ANOTHER company.
    authAs(SVC_APPROVER_COMPANY_A2);
    const otherCompany = await decideDiscount(approvalId, { decision: 'approved' });
    expect(otherCompany.status).toBe(403);
    expect((await reread(created.id)).currentRevision?.discountApproval?.status).toBe('pending');
    // Positive control: an approver of the owning branch and company decides it.
    authAs(SVC_DISCOUNT_APPROVER);
    expect((await decideDiscount(approvalId, { decision: 'approved' })).status).toBe(200);
  });

  it('needs ONLY the permission the request recorded: a policy naming another code moves the approver population with it', async () => {
    await seedDiscountPolicy({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      thresholdKind: 'amount',
      thresholdValue: '1.0000',
      currencyCode: 'JOD',
      requiredPermissionCode: 'svc.price.publish',
    });
    try {
      const created = await seedPendingDiscount('5.0000');
      const approval = approvalOf(created);
      expect(approval.requiredPermission).toBe('svc.price.publish');
      // svc.price.manage without the recorded code is no authority over this request.
      authAs(SVC_DISCOUNT_APPROVER);
      const manageOnly = await decideDiscount(approval.id, { decision: 'approved' });
      expect(manageOnly.status).toBe(403);
      expect(((await manageOnly.json()) as Problem).violations).toEqual([
        { path: 'body', rule: 'discount_approval_permission_missing' },
      ]);
      // The recorded code without svc.price.manage IS — the route no longer demands it.
      authAs(SVC_RECORDED_APPROVER);
      const recorded = await decideDiscount(approval.id, { decision: 'approved' });
      expect(recorded.status).toBe(200);
      expect(((await recorded.json()) as DiscountApproval).decidedBy?.id).toBe(
        SVC_RECORDED_APPROVER.userId
      );
    } finally {
      await clearDiscountPolicy(TENANT_A);
    }
  });

  it('under a forced RACE of two decisions on one request, exactly one wins and the other is a named conflict', async () => {
    const created = await seedPendingDiscount();
    const approvalId = approvalOf(created).id;
    authAs(SVC_DISCOUNT_APPROVER);
    const [a, b] = await Promise.all([
      decideDiscount(approvalId, { decision: 'approved' }),
      decideDiscount(approvalId, { decision: 'rejected', reason: 'Too generous for this job' }),
    ]);
    const answers = [
      { status: a.status, body: (await a.json()) as DiscountApproval & Problem },
      { status: b.status, body: (await b.json()) as DiscountApproval & Problem },
    ];
    const winners = answers.filter((answer) => answer.status === 200);
    const losers = answers.filter((answer) => answer.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.status).toBe(409);
    expect(losers[0]?.body.violations).toEqual([
      { path: 'body', rule: 'discount_approval_already_decided' },
    ]);
    // The stored decision is the winner's, and it was recorded exactly once.
    const stored = await admin.query<{ status: string }>(
      `SELECT status FROM quo.discount_approvals WHERE id = $1`,
      [approvalId]
    );
    expect(stored.rows[0]?.status).toBe(winners[0]?.body.status);
    const decisions =
      (await auditCountFor('quo.discount_approval.approved', approvalId)) +
      (await auditCountFor('quo.discount_approval.rejected', approvalId));
    expect(decisions).toBe(1);
  });

  it('binds the approval to its amount: the approved lines cannot be re-priced, and a change is a new revision that asks again', async () => {
    const created = await seedPendingDiscount('5.0000');
    const revisionId = created.currentRevision?.id as string;
    authAs(SVC_DISCOUNT_APPROVER);
    expect((await decideDiscount(approvalOf(created).id, { decision: 'approved' })).status).toBe(
      200
    );
    // Re-pricing the approved draft's line around the application is refused by the
    // database, by name, whoever tries — even the owner.
    await expect(
      admin.query(
        `UPDATE quo.quotation_items
            SET captured_discount = 6,
                captured_tax_amount = round((captured_unit_price * captured_quantity - 6)
                                            * captured_tax_rate, 4),
                captured_line_total = round(captured_unit_price * captured_quantity - 6
                  + round((captured_unit_price * captured_quantity - 6)
                          * captured_tax_rate, 4), 4)
          WHERE quotation_revision_id = $1`,
        [revisionId]
      )
    ).rejects.toThrow(/discount_request_freezes_items/);
    const lines = await admin.query<{ discount: string }>(
      `SELECT captured_discount::text AS discount FROM quo.quotation_items
        WHERE quotation_revision_id = $1`,
      [revisionId]
    );
    expect(lines.rows).toEqual([{ discount: '5.0000' }]);

    // Changing the discount is a new revision, which asks again.
    authAs(SVC_FULL);
    const revised = await revise(
      created.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '6.0000' }] },
      (await reread(created.id)).recordVersion
    );
    expect(revised.status).toBe(201);
    const next = (await revised.json()) as Revision;
    expect(next.discountApproval?.status).toBe('pending');
    expect(next.discountApproval?.discountTotal).toBe('6.0000');
    const refused = await issue(
      created.id,
      { revisionId: next.id },
      (await reread(created.id)).recordVersion
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);
    // Positive control: the approved draft, untouched, issues with the approved amount.
    const issued = await issue(
      created.id,
      { revisionId },
      (await reread(created.id)).recordVersion
    );
    expect(issued.status).toBe(200);
    expect(((await issued.json()) as Revision).discountTotal).toBe('5.0000');
  });

  it('a legacy draft discounted before the two-step flow cannot be issued until somebody other than its creator approves it', async () => {
    // A draft whose discount needed no approval when it was written (threshold 50)...
    await seedDiscountPolicy({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      thresholdKind: 'amount',
      thresholdValue: '50.0000',
      currencyCode: 'JOD',
    });
    let created: Quotation;
    try {
      const order = await createOpenWorkOrder();
      authAs(SVC_FULL);
      const response = await createQuotation({
        workOrderId: order.workOrderId,
        payerPartnerRef: PARTNER_A,
        lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }],
      });
      expect(response.status).toBe(201);
      created = (await response.json()) as Quotation;
      expect(created.currentRevision?.discountApproval).toBeNull();
    } finally {
      // ...and a policy in force now under which it does (none: a threshold of zero).
      await clearDiscountPolicy(TENANT_A);
    }
    const revisionId = created.currentRevision?.id as string;
    // What the migration found: a quotation written before quotations were pinned to a
    // policy. Only the owner can hold that state, around the pin's own trigger.
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
      await client.query(
        `UPDATE quo.quotations
            SET discount_policy_id = NULL, discount_policy_version_no = NULL,
                discount_policy_pinned_at = NULL
          WHERE id = $1`,
        [created.id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    // The migration's own backfill pins it to the policy in force now (none: a threshold
    // of zero) and gives the draft a PENDING, backfilled request in its creator's name.
    await admin.query(`SELECT * FROM quo.backfill_discount_approvals()`);
    const backfilled = await admin.query<{
      id: string;
      origin: string;
      requested_by: string;
      policy_id: string | null;
    }>(
      `SELECT id, origin, requested_by, policy_id FROM quo.discount_approvals
        WHERE quotation_revision_id = $1`,
      [revisionId]
    );
    expect(backfilled.rows).toHaveLength(1);
    expect(backfilled.rows[0]).toMatchObject({
      origin: 'backfilled',
      requested_by: SVC_FULL.userId,
      policy_id: null,
    });
    const approvalId = backfilled.rows[0]?.id as string;
    const current = await reread(created.id);
    authAs(SVC_FULL);
    const pending = await issue(created.id, { revisionId }, current.recordVersion);
    expect(pending.status).toBe(409);
    expect(((await pending.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);
    // Its creator is its requester, and may not approve it.
    const self = await decideDiscount(approvalId, { decision: 'approved' });
    expect(self.status).toBe(403);
    expect(((await self.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approver_must_differ' },
    ]);
    // Somebody else does, and only then it issues.
    authAs(SVC_DISCOUNT_APPROVER);
    const approved = await decideDiscount(approvalId, { decision: 'approved' });
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as DiscountApproval;
    expect(approvedBody.origin).toBe('backfilled');
    expect(approvedBody.requestedBy.id).toBe(SVC_FULL.userId);
    authAs(SVC_FULL);
    const issued = await issue(created.id, { revisionId }, current.recordVersion);
    expect(issued.status).toBe(200);
  });

  it('hides a request from another tenant’s approver (cross-tenant), with a positive control', async () => {
    const created = await seedPendingDiscount();
    const approvalId = approvalOf(created).id;
    // SVC_TENANT_B_APPROVER holds every authority an approver needs, so this refusal is
    // the tenant boundary and nothing else: row security does not show it the row.
    authAs(SVC_TENANT_B_APPROVER);
    const foreign = await decideDiscount(approvalId, { decision: 'approved' });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as Problem).code).toBe('ERR-RES-001');
    // Positive control: an approver of the owning tenant decides the same row.
    authAs(SVC_DISCOUNT_APPROVER);
    const owned = await decideDiscount(approvalId, { decision: 'approved' });
    expect(owned.status).toBe(200);
  });
});

/**
 * The Owner's test: a threshold change after the request cannot bypass its approval
 * (P1-32-PRE-OD-DISC-01, -07).
 *
 * Every quotation is held to the policy version in force when it was written, for its
 * whole life. Raising the company threshold above the discount afterwards does not
 * approve it, and does not let its requester decide it — in one revision or several;
 * the new threshold applies to quotations written from then on. Lowering the threshold
 * neither undoes an approval nor blocks a draft written before it.
 */
describe('svc.discount-threshold-set — a later threshold change cannot bypass a recorded request', () => {
  beforeAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });
  afterAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  it('request above the threshold → threshold raised → revised with the SAME discount → still needs another approver and cannot be issued', async () => {
    authAs(SVC_FULL);
    const first = await setThreshold(
      {
        companyId: COMPANY_A1,
        thresholdKind: 'amount',
        thresholdValue: '10.0000',
        currency: 'JOD',
      },
      1
    );
    expect(first.status).toBe(201);
    expect(((await first.json()) as ThresholdView).current?.versionNo).toBe(1);

    // The request: 40 against a threshold of 10.
    const created = await seedPendingDiscount('40.0000');
    const approval = approvalOf(created);
    const firstRevisionId = created.currentRevision?.id as string;
    expect(approval.threshold).toMatchObject({ versionNo: 1, kind: 'amount', value: '10.0000' });

    // The requester's side raises the threshold ABOVE the discount.
    authAs(SVC_FULL);
    const raised = await setThreshold(
      {
        companyId: COMPANY_A1,
        thresholdKind: 'amount',
        thresholdValue: '100.0000',
        currency: 'JOD',
      },
      2
    );
    expect(raised.status).toBe(201);
    const raisedBody = (await raised.json()) as ThresholdView;
    expect(raisedBody.current).toMatchObject({ versionNo: 2, thresholdValue: '100.0000' });
    expect(raisedBody.history.map((row) => [row.versionNo, row.status])).toEqual([
      [2, 'active'],
      [1, 'inactive'],
    ]);
    expect(
      await auditCountFor('svc.discount_threshold.versioned', raisedBody.current?.id as string)
    ).toBe(1);

    // The request is untouched: still pending, still measured against version 1, not
    // issuable, and not its requester's to approve.
    const after = approvalOf(await reread(created.id));
    expect(after.status).toBe('pending');
    expect(after.threshold).toMatchObject({ versionNo: 1, value: '10.0000' });
    authAs(SVC_FULL);
    const refused = await issue(created.id, { revisionId: firstRevisionId }, created.recordVersion);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);
    const self = await decideDiscount(approval.id, { decision: 'approved' });
    expect(self.status).toBe(403);
    expect(((await self.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approver_must_differ' },
    ]);

    // The bypass attempt: revise with the SAME discount. The quotation is held to the
    // version pinned when it was written (10), not the raised one (100), so it is a new
    // PENDING request under the same version — and the old one is superseded.
    const current = await reread(created.id);
    const revised = await revise(
      created.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }] },
      current.recordVersion
    );
    expect(revised.status).toBe(201);
    const revision = (await revised.json()) as Revision;
    const renewed = revision.discountApproval as DiscountApproval;
    expect(renewed.status).toBe('pending');
    expect(renewed.id).not.toBe(approval.id);
    expect(renewed.threshold).toMatchObject({ versionNo: 1, value: '10.0000' });
    expect(renewed.requestedBy.id).toBe(SVC_FULL.userId);
    const old = await admin.query<{ status: string; superseded_by_revision_id: string }>(
      `SELECT status, superseded_by_revision_id FROM quo.discount_approvals WHERE id = $1`,
      [approval.id]
    );
    expect(old.rows[0]).toEqual({ status: 'superseded', superseded_by_revision_id: revision.id });

    // The new revision cannot be issued, and its requester cannot approve it.
    const latest = await reread(created.id);
    const stillRefused = await issue(created.id, { revisionId: revision.id }, latest.recordVersion);
    expect(stillRefused.status).toBe(409);
    expect(((await stillRefused.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);
    const selfAgain = await decideDiscount(renewed.id, { decision: 'approved' });
    expect(selfAgain.status).toBe(403);
    expect(((await selfAgain.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approver_must_differ' },
    ]);
    // Nor can the first revision be issued: its request was superseded.
    const firstAgain = await issue(
      created.id,
      { revisionId: firstRevisionId },
      latest.recordVersion
    );
    expect(firstAgain.status).toBe(409);
    expect(((await firstAgain.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_superseded' },
    ]);

    // A superseded request is no longer approvable, by anybody.
    authAs(SVC_DISCOUNT_APPROVER);
    const stale = await decideDiscount(approval.id, { decision: 'approved' });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_superseded' },
    ]);

    // A different person approves the RENEWED request, against the snapshot.
    const approved = await decideDiscount(renewed.id, { decision: 'approved' });
    expect(approved.status).toBe(200);

    // Lowering the threshold afterwards does not undo the approval.
    authAs(SVC_FULL);
    const lowered = await setThreshold(
      { companyId: COMPANY_A1, thresholdKind: 'amount', thresholdValue: '1.0000', currency: 'JOD' },
      3
    );
    expect(lowered.status).toBe(201);
    const issued = await issue(
      created.id,
      { revisionId: revision.id },
      (await reread(created.id)).recordVersion
    );
    expect(issued.status).toBe(200);
  });

  /** Records the next company threshold version, read and If-Matched first. */
  async function setNext(value: string): Promise<ThresholdView> {
    authAs(SVC_FULL);
    const before = (await (await readThreshold(COMPANY_A1)).json()) as ThresholdView;
    const response = await setThreshold(
      { companyId: COMPANY_A1, thresholdKind: 'amount', thresholdValue: value, currency: 'JOD' },
      before.recordVersion
    );
    expect(response.status).toBe(201);
    return (await response.json()) as ThresholdView;
  }

  it('the two-step escape: request above the threshold → threshold raised → discount revised away → revised back → still needs another approver and cannot be issued', async () => {
    const low = await setNext('10.0000');
    const created = await seedPendingDiscount('40.0000');
    const approval = approvalOf(created);
    expect(approval.threshold).toMatchObject({
      versionNo: low.current?.versionNo,
      value: '10.0000',
    });
    const raised = await setNext('100.0000');
    expect(
      await auditCountFor('svc.discount_threshold.versioned', raised.current?.id as string)
    ).toBe(1);

    // Step one: the discount is revised away. The open request is superseded and, with
    // no discount, none is recorded.
    authAs(SVC_FULL);
    const away = await revise(
      created.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '0.0000' }] },
      (await reread(created.id)).recordVersion
    );
    expect(away.status).toBe(201);
    expect(((await away.json()) as Revision).discountApproval).toBeNull();
    const old = await admin.query<{ status: string }>(
      `SELECT status FROM quo.discount_approvals WHERE id = $1`,
      [approval.id]
    );
    expect(old.rows[0]?.status).toBe('superseded');

    // Step two: the same discount comes back. The quotation is still held to the version
    // it was written under (10), not the raised one (100): a new PENDING request.
    const back = await revise(
      created.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }] },
      (await reread(created.id)).recordVersion
    );
    expect(back.status).toBe(201);
    const revision = (await back.json()) as Revision;
    const renewed = revision.discountApproval as DiscountApproval;
    expect(renewed.status).toBe('pending');
    expect(renewed.threshold).toMatchObject({
      versionNo: low.current?.versionNo,
      value: '10.0000',
    });
    expect(renewed.requestedBy.id).toBe(SVC_FULL.userId);
    const refused = await issue(
      created.id,
      { revisionId: revision.id },
      (await reread(created.id)).recordVersion
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approval_pending' },
    ]);
    authAs(SVC_FULL);
    const self = await decideDiscount(renewed.id, { decision: 'approved' });
    expect(self.status).toBe(403);
    expect(((await self.json()) as Problem).violations).toEqual([
      { path: 'body', rule: 'discount_approver_must_differ' },
    ]);

    // Positive control: somebody else approves it, and only then it issues.
    authAs(SVC_DISCOUNT_APPROVER);
    expect((await decideDiscount(renewed.id, { decision: 'approved' })).status).toBe(200);
    authAs(SVC_FULL);
    const issued = await issue(
      created.id,
      { revisionId: revision.id },
      (await reread(created.id)).recordVersion
    );
    expect(issued.status).toBe(200);
  });

  it('lowering the threshold blocks no existing draft — it keeps the version it was written under — and holds a new quotation to the lowered one', async () => {
    await setNext('100.0000');
    // 40 under a threshold of 100: no request.
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }],
    });
    expect(response.status).toBe(201);
    const existing = (await response.json()) as Quotation;
    expect(existing.currentRevision?.discountApproval).toBeNull();

    const lowered = await setNext('10.0000');

    // A quotation written after the change is held to the lowered threshold.
    const newOrder = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const fresh = await createQuotation({
      workOrderId: newOrder.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }],
    });
    expect(fresh.status).toBe(201);
    const freshBody = (await fresh.json()) as Quotation;
    expect(freshBody.currentRevision?.discountApproval?.status).toBe('pending');
    expect(freshBody.currentRevision?.discountApproval?.threshold).toMatchObject({
      versionNo: lowered.current?.versionNo,
      value: '10.0000',
    });

    // The existing quotation keeps its version: revised with the same discount it still
    // needs no request, and it issues.
    const revised = await revise(
      existing.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }] },
      (await reread(existing.id)).recordVersion
    );
    expect(revised.status).toBe(201);
    const revision = (await revised.json()) as Revision;
    expect(revision.discountApproval).toBeNull();
    const issued = await issue(
      existing.id,
      { revisionId: revision.id },
      (await reread(existing.id)).recordVersion
    );
    expect(issued.status).toBe(200);
  });

  it('positive control: a NEW quotation after a threshold change is measured against the new threshold, and the change is audited', async () => {
    authAs(SVC_FULL);
    const before = (await (await readThreshold(COMPANY_A1)).json()) as ThresholdView;
    const raised = await setThreshold(
      {
        companyId: COMPANY_A1,
        thresholdKind: 'amount',
        thresholdValue: '100.0000',
        currency: 'JOD',
      },
      before.recordVersion
    );
    expect(raised.status).toBe(201);
    const raisedBody = (await raised.json()) as ThresholdView;
    const versionId = raisedBody.current?.id as string;
    expect(await auditCountFor('svc.discount_threshold.versioned', versionId)).toBe(1);
    const trail = await admin.query<{ field_name: string; new_value_masked: string | null }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = 'svc.discount_threshold.versioned' AND r.entity_id = $1`,
      [versionId]
    );
    expect(trail.rows.map((row) => row.field_name)).toEqual(
      expect.arrayContaining(['versionNo', 'thresholdValue', 'effectiveFrom'])
    );

    // A brand-new quotation with the same 40 discount: prospective, so no request...
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }],
    });
    expect(response.status).toBe(201);
    const fresh = (await response.json()) as Quotation;
    expect(fresh.currentRevision?.discountApproval).toBeNull();
    // ...and it issues straight away.
    const issued = await issue(
      fresh.id,
      { revisionId: fresh.currentRevision?.id },
      fresh.recordVersion
    );
    expect(issued.status).toBe(200);
  });
});

/**
 * The company discount threshold, read and versioned (P1-32-PRE-OD-DISC-01).
 */
describe('svc.discount-threshold-read and svc.discount-threshold-set — versions, If-Match, validation', () => {
  beforeAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });
  afterAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  const amount = (value: string) => ({
    companyId: COMPANY_A1,
    thresholdKind: 'amount',
    thresholdValue: value,
    currency: 'JOD',
  });

  it('reads "none" before anything is set, then the company version with its If-Match', async () => {
    authAs(SVC_FULL);
    const empty = await readThreshold(COMPANY_A1);
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as ThresholdView;
    // Nothing configured: every discount needs approval, and there is no version to match.
    expect(emptyBody.source).toBe('none');
    expect(emptyBody.current).toBeNull();
    // Nothing recorded yet: the setting is at record version 1, and a first write
    // proves it saw that by sending it.
    expect(emptyBody.recordVersion).toBe(1);
    expect(String(empty.headers.get('etag')).replace(/"/g, '')).toBe('1');

    const key = crypto.randomUUID();
    const created = await setThreshold(amount('25.0000'), 1, key);
    expect(created.status).toBe(201);
    const body = (await created.json()) as ThresholdView;
    expect(body.source).toBe('company');
    expect(body.current).toMatchObject({
      versionNo: 1,
      thresholdKind: 'amount',
      thresholdValue: '25.0000',
      currency: 'JOD',
      // No field sets the approver permission: it is carried, here from the default.
      requiredPermission: 'svc.price.manage',
      status: 'active',
    });
    // A retry with the same key replays the recorded body — with 200, the status every
    // replayed write answers with — and records ONE version and one audit record.
    const replay = await setThreshold(amount('25.0000'), 1, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(body);
    expect(
      await auditCountFor('svc.discount_threshold.versioned', body.current?.id as string)
    ).toBe(1);

    const read = await readThreshold(COMPANY_A1);
    expect(String(read.headers.get('etag')).replace(/"/g, '')).toBe('2');
  });

  it('requires If-Match, and refuses a stale one', async () => {
    authAs(SVC_FULL);
    const missing = await setThreshold(amount('30.0000'));
    expect(missing.status).toBe(428);
    expect(((await missing.json()) as Problem).code).toBe('ERR-CON-002');
    const stale = await setThreshold(amount('30.0000'), 7);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Problem).code).toBe('ERR-CON-001');
    const next = await setThreshold(amount('30.0000'), 2);
    expect(next.status).toBe(201);
    expect(((await next.json()) as ThresholdView).current?.versionNo).toBe(2);
    // The record version that was current before cannot be written against again.
    const replaced = await setThreshold(amount('31.0000'), 2);
    expect(replaced.status).toBe(409);
  });

  it('numbers the next version above a soft-deleted, retired highest row instead of colliding with it', async () => {
    authAs(SVC_FULL);
    const before = (await (await readThreshold(COMPANY_A1)).json()) as ThresholdView;
    const next = before.recordVersion;
    // The highest number the company ever used is held by a retired, soft-deleted row —
    // written directly, as history carried from before versions existed would be.
    await admin.query(
      `INSERT INTO svc.pricing_approval_policies
         (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
          required_permission_code, version_no, effective_from, status, created_by,
          deleted_at, deleted_by)
       VALUES ($1,$2,'discount','amount',77,'JOD','svc.price.manage',$3,current_date,
               'inactive',$4,now(),$4)`,
      [TENANT_A, COMPANY_A1, next, USER_A]
    );
    const read = (await (await readThreshold(COMPANY_A1)).json()) as ThresholdView;
    // The deleted row is not history, but its number is spent.
    expect(read.history.some((row) => row.versionNo === next)).toBe(false);
    expect(read.recordVersion).toBe(next + 1);
    const stale = await setThreshold(amount('40.0000'), next);
    expect(stale.status).toBe(409);
    const written = await setThreshold(amount('40.0000'), next + 1);
    expect(written.status).toBe(201);
    const body = (await written.json()) as ThresholdView;
    expect(body.current).toMatchObject({ versionNo: next + 1, thresholdValue: '40.0000' });
  });

  it('refuses what cannot be a threshold, by name — and offers no switch for separation of duties', async () => {
    authAs(SVC_FULL);
    const cases: readonly [
      { readonly companyId: string } & Record<string, unknown>,
      string,
      string,
    ][] = [
      [
        { companyId: COMPANY_A1, thresholdKind: 'percentage', thresholdValue: '150' },
        'body.thresholdValue',
        'discount_threshold_percentage_range',
      ],
      [
        { companyId: COMPANY_A1, thresholdKind: 'amount', thresholdValue: '10' },
        'body.currency',
        'discount_threshold_currency_required',
      ],
      [
        {
          companyId: COMPANY_A1,
          thresholdKind: 'percentage',
          thresholdValue: '10',
          currency: 'JOD',
        },
        'body.currency',
        'discount_threshold_currency_not_applicable',
      ],
      [
        { companyId: COMPANY_A1, thresholdKind: 'amount', thresholdValue: '10', currency: 'ZZZ' },
        'body.currency',
        'unknown_currency',
      ],
    ];
    for (const [body, path, rule] of cases) {
      const refused = await setThreshold(body, 2);
      expect(refused.status, rule).toBe(422);
      expect(((await refused.json()) as Problem).violations, rule).toEqual([{ path, rule }]);
    }
    // A body that tries to switch the separation off is refused as an unknown key.
    const switchOff = await setThreshold({ ...amount('10'), makerApproverDistinct: false }, 2);
    expect(switchOff.status).toBe(422);
    expect(((await switchOff.json()) as Problem).violations?.map((v) => v.rule)).toContain(
      'unrecognized_keys'
    );
  });

  it('refuses a caller without the pricing permissions (denial) and one without the company (isolation), and another tenant (cross-tenant)', async () => {
    authAs(SVC_READER);
    expect((await readThreshold(COMPANY_A1)).status).toBe(403);
    expect((await setThreshold(amount('1'), 2)).status).toBe(403);
    // svc.price.manage in full, granted only inside COMPANY_A1: COMPANY_A2 is refused.
    authAs(SVC_PRICE_SCOPED_A2);
    const otherCompany = await setThreshold({ ...amount('1'), companyId: COMPANY_A2 }, 1);
    expect(otherCompany.status).toBe(403);
    // Positive control: an unrestricted pricing manager sets COMPANY_A2's first version.
    authAs(SVC_FULL);
    const allowed = await setThreshold({ ...amount('1'), companyId: COMPANY_A2 }, 1);
    expect(allowed.status).toBe(201);
    // Another tenant cannot read this tenant's company threshold at all.
    authAs(SVC_TENANT_B_FULL);
    expect([403, 404]).toContain((await readThreshold(COMPANY_A1)).status);
  });
});

/**
 * The approvals list (P1-32-PRE-OD-DISC-01).
 */
describe('quo.discount-approval-list — a branch’s requests, with the caller’s own marked', () => {
  beforeAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  const query = (status?: string) => ({
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    ...(status === undefined ? {} : { status }),
    limit: '100',
  });

  it('lists pending requests, marking the caller’s own as waiting for another approver', async () => {
    const created = await seedPendingDiscount();
    const approvalId = approvalOf(created).id;
    const rowFor = async (): Promise<DiscountApproval | undefined> => {
      const response = await listDiscountApprovals(query());
      expect(response.status).toBe(200);
      return ((await response.json()) as { items: DiscountApproval[] }).items.find(
        (row) => row.id === approvalId
      );
    };

    authAs(SVC_FULL);
    const mineRow = await rowFor();
    expect(mineRow?.requestedByCaller).toBe(true);
    expect(mineRow?.status).toBe('pending');
    // Whether the caller could decide it is computed by the server — and no approver
    // limit is part of the answer, for anybody.
    expect(mineRow?.canApprove).toBe(false);
    expect(mineRow?.cannotApproveReason).toBe('own_request');
    expect(mineRow?.canReject).toBe(false);
    expect(mineRow).not.toHaveProperty('approverLimit');

    authAs(SVC_DISCOUNT_APPROVER);
    const theirsRow = await rowFor();
    expect(theirsRow?.requestedByCaller).toBe(false);
    expect(theirsRow?.requestedBy.id).toBe(SVC_FULL.userId);
    expect(theirsRow?.canApprove).toBe(true);
    expect(theirsRow?.cannotApproveReason).toBeNull();
    expect(theirsRow?.canReject).toBe(true);
    expect(theirsRow).not.toHaveProperty('approverLimit');

    // Reads quotations, but lacks the permission the request recorded.
    authAs(SVC_RECORDED_APPROVER);
    const unpermitted = await rowFor();
    expect(unpermitted?.cannotApproveReason).toBe('missing_permission');
    // Turning down needs the same permission, so it is not offered either.
    expect(unpermitted?.canReject).toBe(false);

    // No limit that counts, then a limit below the discount — named, never shown.
    authAs(SVC_DISCOUNT_APPROVER);
    await clearCeilingOf(SVC_DISCOUNT_APPROVER.roleId, async () => {
      const limitless = await rowFor();
      expect(limitless?.cannotApproveReason).toBe('no_approval_limit');
      // No limit is needed to turn a request down: that is still offered.
      expect(limitless?.canReject).toBe(true);
      const small = await admin.query<{ id: string }>(
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
         VALUES ($1, $2, $3, 'discount', 1, 'JOD', '2020-01-01'::date, $4)
         RETURNING id`,
        [TENANT_A, COMPANY_A1, SVC_DISCOUNT_APPROVER.userId, USER_A]
      );
      try {
        const over = await rowFor();
        expect(over?.canApprove).toBe(false);
        expect(over?.cannotApproveReason).toBe('over_approval_limit');
        expect(over?.canReject).toBe(true);
        expect(JSON.stringify(over)).not.toContain('"1.0000"');
      } finally {
        await admin.query('DELETE FROM iam.approval_limits WHERE id = $1', [small.rows[0]?.id]);
      }
    });

    // Decided, it leaves the pending list and appears under its decision.
    expect((await decideDiscount(approvalId, { decision: 'approved' })).status).toBe(200);
    const pending = (await (await listDiscountApprovals(query())).json()) as {
      items: DiscountApproval[];
    };
    expect(pending.items.some((row) => row.id === approvalId)).toBe(false);
    const approved = (await (await listDiscountApprovals(query('approved'))).json()) as {
      items: DiscountApproval[];
    };
    expect(approved.items.some((row) => row.id === approvalId)).toBe(true);
  });

  it('lists only requests on a quotation’s CURRENT draft revision: a superseded request is gone', async () => {
    const created = await seedPendingDiscount('5.0000');
    const oldId = approvalOf(created).id;
    authAs(SVC_FULL);
    const revised = await revise(
      created.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '5.0000' }] },
      created.recordVersion
    );
    expect(revised.status).toBe(201);
    const newId = ((await revised.json()) as Revision).discountApproval?.id as string;
    expect(newId).not.toBe(oldId);

    authAs(SVC_DISCOUNT_APPROVER);
    const ids = (
      (await (await listDiscountApprovals(query())).json()) as {
        items: DiscountApproval[];
      }
    ).items.map((row) => row.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);
    // `superseded` is not a list the approvals screen can ask for.
    expect((await listDiscountApprovals(query('superseded'))).status).toBe(422);
  });

  it('refuses a reader without quo.quotation.read (denial) and a caller scoped to another branch (isolation)', async () => {
    authAs(SVC_READER);
    expect((await listDiscountApprovals(query())).status).toBe(403);
    // quo.quotation.read in full, scoped to A2, with an unrelated A1 grant.
    authAs(SVC_QUO_SCOPED_A2);
    expect((await listDiscountApprovals(query())).status).toBe(403);
    // Positive control: the same principal reads its own branch.
    const own = await listDiscountApprovals({ companyId: COMPANY_A1, branchId: BRANCH_A2 });
    expect(own.status).toBe(200);
  });

  it('shows another tenant none of this tenant’s requests (cross-tenant)', async () => {
    await seedPendingDiscount();
    authAs(SVC_TENANT_B_APPROVER);
    expect([403, 404]).toContain((await listDiscountApprovals(query())).status);
  });
});
