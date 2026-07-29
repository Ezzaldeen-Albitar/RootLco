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
 * Operations exercised here: quo.quotation-create, quo.quotation-detail,
 * quo.quotation-revision-create, quo.quotation-issue, quo.quotation-item-decide,
 * quo.quotation-revision-decide.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   quo.quotation-create: route service authorization success denial cross-tenant isolation audit outbox idempotency rollback
 *   quo.quotation-detail: route service authorization success denial cross-tenant isolation
 *   quo.quotation-revision-create: route service authorization success denial audit stale-version concurrency cross-tenant idempotency isolation
 *   quo.quotation-issue: route service authorization success denial audit outbox stale-version concurrency rollback cross-tenant idempotency isolation
 *   quo.quotation-item-decide: route service authorization success denial cross-tenant audit outbox concurrency idempotency isolation
 *   quo.quotation-revision-decide: route service authorization success denial audit outbox rollback cross-tenant idempotency isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
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
  return (await response.json()) as Quotation;
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

    // A quotation with NO discount records nothing: an ordinary edit is not an
    // authorization, and auditing it as one would misstate what happened.
    const plain = await seedQuotation({ quantity: '1.000' });
    expect(
      await auditCountFor('svc.discount.authorized', plain.currentRevision?.id as string)
    ).toBe(0);
  });

  it('refuses a discount when the actor has NO approval ceiling', async () => {
    // SVC_UNPERMITTED_DISCOUNT holds quotation.manage and work_order.read but no
    // discount ceiling. Fail-closed: no ceiling is no authority, never unlimited.
    const order = await createOpenWorkOrder();
    authAs(SVC_NO_CEILING);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '1.0000' }],
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-IAM-001');
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
 * individually under it — so before this the actor needed no elevated permission, faced no
 * maker/approver check, and had their ceiling compared against nothing at all. The block's
 * own comment claimed to add "the aggregate the ceiling actually means" while leaving that
 * open, which is what made the gap hard to see.
 *
 * The fix authorizes the DOCUMENT through the same `authorize` call a single line of that
 * size would go through — same policy, same ceiling, same maker/approver rule — so the
 * two cannot disagree about what the limits mean.
 *
 * These cases need a real `svc.pricing_approval_policies` row: with no policy the threshold
 * is zero, every non-zero discount is already elevated, and splitting is inexpressible.
 * The policy is torn down afterwards so the rest of the suite keeps the zero default.
 */
describe('discount splitting defeats neither the threshold nor the ceiling', () => {
  const POLICY_THRESHOLD = '50.0000';

  beforeAll(async () => {
    await seedDiscountPolicy({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      thresholdKind: 'amount',
      thresholdValue: POLICY_THRESHOLD,
      currencyCode: 'JOD',
      // maker/approver separation has its own cases; keep it out of this measurement.
      makerApproverDistinct: false,
    });
  });

  afterAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  it('allows a single under-threshold discount with no elevated authority at all', async () => {
    // The control case. 40 is under the 50 threshold, so this is an ordinary edit and must
    // stay one — a fix that refused this would have broken the feature, not secured it.
    const order = await createOpenWorkOrder();
    authAs(SVC_NO_CEILING); // holds quo.quotation.manage; has NO approval ceiling
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }],
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Quotation;
    expect(created.currentRevision?.lines[0]?.discount).toBe('40.0000');
    // Nothing was elevated, so nothing is audited as an authorization.
    expect(
      await auditCountFor('svc.discount.authorized', created.currentRevision?.id as string)
    ).toBe(0);
  });

  it('refuses SPLIT discounts that clear the threshold only in aggregate', async () => {
    /**
     * Three lines of 40 = 120, over the 50 threshold in aggregate while no single line
     * reaches it. `SVC_NO_CEILING` holds no `iam.approval_limits` row, so once the
     * aggregate is elevated the ceiling gate refuses it — which is the same answer a
     * single 120 line has always received.
     */
    const order = await createOpenWorkOrder();
    authAs(SVC_NO_CEILING);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [
        { serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' },
        { serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000', description: 'Two' },
        { serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000', description: 'Three' },
      ],
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-IAM-001');
    // The whole request is refused, so no partial quotation survives.
    expect(
      await countRows(admin, 'quo.quotations', 'work_order_id = $1', [order.workOrderId])
    ).toBe(0);
  });

  it('refuses SPLIT discounts that exceed the actor ceiling only in aggregate', async () => {
    /**
     * The ceiling case, with an actor that HAS one. `SVC_FULL`'s ceiling is 1000 (seeded in
     * beforeAll of this suite), so six lines of 40 = 240 is comfortably inside it and must
     * pass, while twenty-six lines of 40 = 1040 exceeds it and must not — even though every
     * single line is under both the 50 threshold and the 1000 ceiling.
     */
    const withinOrder = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const within = await createQuotation({
      workOrderId: withinOrder.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: Array.from({ length: 6 }, (_unused, index) => ({
        serviceId: SERVICE_A,
        quantity: '1.000',
        discount: '40.0000',
        description: `Line ${index + 1}`,
      })),
    });
    expect(within.status).toBe(201);
    const withinBody = (await within.json()) as Quotation;
    /**
     * The LINE discounts, not the revision total.
     *
     * A draft revision's `captured_discount_total` is `0.0000` by design —
     * `quo.issue_revision` is what SUMs the four totals, so a draft carries none. The
     * per-line values are the draft's truth, and 6 x 40 is what the aggregate control
     * measured.
     */
    expect(withinBody.currentRevision?.lines).toHaveLength(6);
    expect(withinBody.currentRevision?.lines.every((line) => line.discount === '40.0000')).toBe(
      true
    );
    expect(
      await auditCountFor('svc.discount.authorized', withinBody.currentRevision?.id as string)
    ).toBe(1);

    const overOrder = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const over = await createQuotation({
      workOrderId: overOrder.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: Array.from({ length: 26 }, (_unused, index) => ({
        serviceId: SERVICE_A,
        quantity: '1.000',
        discount: '40.0000',
        description: `Line ${index + 1}`,
      })),
    });
    expect(over.status).toBe(403);
    expect(((await over.json()) as { code: string }).code).toBe('ERR-IAM-001');
    expect(
      await countRows(admin, 'quo.quotations', 'work_order_id = $1', [overOrder.workOrderId])
    ).toBe(0);
  });

  it('audits the split authorization even when NO single line was elevated', async () => {
    /**
     * The audit consequence of the fix, and a hole in its own right.
     *
     * Keying the audit record on `elevatedLines` — how many individual lines needed
     * elevated authority — would have left the split case unrecorded, which is the case
     * most worth recording: an actor gave away more than the threshold and no line shows it.
     */
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [
        { serviceId: SERVICE_A, quantity: '1.000', discount: '30.0000' },
        { serviceId: SERVICE_A, quantity: '1.000', discount: '30.0000', description: 'Two' },
      ],
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Quotation;
    const revisionId = created.currentRevision?.id as string;
    // Two lines of 30: 60 in aggregate, over the 50 threshold, with no single line near it.
    // A draft's revision totals are zero until issue, so the lines are what is asserted.
    expect(created.currentRevision?.lines.map((line) => line.discount)).toEqual([
      '30.0000',
      '30.0000',
    ]);
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
 * The named discount requester is RESOLVED against the database (P1-20-BE-006,
 * P1-20-SEC-003).
 *
 * `4cfce7b` fixed a real control — `discountRequestedBy` arrived from the request body, was
 * compared against the actor id and nothing else, and was never persisted, so any well-formed
 * UUID cleared `maker_approver_distinct` and the invention left no trace. The final
 * verification pass then found that the fix itself had no honest coverage: the only exercise
 * of `isActiveUserInTenant` was `vi.fn().mockResolvedValue(...)` in a unit test — the mock,
 * not the SQL — and deleting the whole `requestedBy` audit detail left every suite green.
 *
 * A control proven only against a mock of itself is not proven. These cases drive the real
 * route against PostgreSQL and assert both halves: the refusal AND the record.
 */
describe('discount maker/approver — the requester is resolved against PostgreSQL', () => {
  beforeAll(async () => {
    await seedDiscountPolicy({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      thresholdKind: 'amount',
      thresholdValue: '10.0000',
      currencyCode: 'JOD',
      // TRUE here — this suite is about the separation itself, not the threshold.
      makerApproverDistinct: true,
    });
  });
  afterAll(async () => {
    await clearDiscountPolicy(TENANT_A);
  });

  const quoteWithRequester = async (requestedBy: string | undefined): Promise<Response> => {
    const order = await createOpenWorkOrder();
    authAs(SVC_FULL);
    return createQuotation({
      workOrderId: order.workOrderId,
      payerPartnerRef: PARTNER_A,
      ...(requestedBy === undefined ? {} : { discountRequestedBy: requestedBy }),
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '40.0000' }],
    });
  };

  it('refuses a requester that resolves to no user at all', async () => {
    // A well-formed UUID that is nobody. Before the fix this CLEARED the control, because
    // distinctness from the actor was the only test applied.
    const refused = await quoteWithRequester('d2999999-0000-4000-8000-00000000beef');
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('refuses a REAL user who belongs to another tenant', async () => {
    /**
     * The tenant filter, which the existence check alone does not give you.
     *
     * `SVC_TENANT_B` is a genuine, active `iam.user_accounts` row — it just belongs to tenant
     * B. An existence-only check would accept it and let a separation of duties inside this
     * tenant be satisfied by someone outside it.
     */
    const refused = await quoteWithRequester(SVC_TENANT_B.userId);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('accepts a real in-tenant requester and RECORDS who it was', async () => {
    // `SVC_READER` is a real active user in tenant A and is not the actor, which is exactly
    // what the separation requires. It needs no permission of its own — it is the maker, not
    // the approver.
    const accepted = await quoteWithRequester(SVC_READER.userId);
    expect(accepted.status).toBe(201);
    const created = (await accepted.json()) as Quotation;
    const revisionId = created.currentRevision?.id as string;

    const details = await admin.query<{ field_name: string; new_value_masked: string | null }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = 'svc.discount.authorized' AND r.entity_id = $1`,
      [revisionId]
    );
    const requester = details.rows.find((row) => row.field_name === 'requestedBy');
    // The second half of the fix: WHO the control was satisfied by has to be recoverable
    // afterwards, or an invented requester is undetectable even once it is refused at write.
    expect(requester).toBeDefined();
    expect(requester?.new_value_masked).toContain(SVC_READER.userId);
  });
});
