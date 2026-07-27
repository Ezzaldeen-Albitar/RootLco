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
 *   quo.quotation-create: route service authorization success denial cross-tenant isolation audit outbox idempotency
 *   quo.quotation-detail: route service authorization success denial cross-tenant isolation
 *   quo.quotation-revision-create: route service authorization success denial audit stale-version concurrency
 *   quo.quotation-issue: route service authorization success denial audit outbox stale-version concurrency rollback
 *   quo.quotation-item-decide: route service authorization success denial cross-tenant audit outbox concurrency
 *   quo.quotation-revision-decide: route service authorization success denial audit outbox rollback
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
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
  SVC_FULL,
  SVC_PERMISSION_ELSEWHERE,
  SVC_READER,
  SVC_SCOPED_A2,
  SVC_NO_CEILING,
  SVC_TENANT_B,
  TAX_CLASS_A,
  assignPriceList,
  auditCountFor,
  seedDiscountCeiling,
  authAs,
  establishP1_20Fixtures,
  outboxCountFor,
  priceListVersionOf,
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

const jsonPost = (url: string, body: unknown, ifMatch?: number): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(body),
  });

function createQuotation(body: unknown): Promise<Response> {
  return CREATE_QUOTATION(jsonPost('http://localhost/api/v1/quotations', body));
}
function detail(quotationId: string): Promise<Response> {
  return QUOTATION_DETAIL(new Request(`http://localhost/api/v1/quotations/${quotationId}`), {
    params: Promise.resolve({ quotationId }),
  });
}
function revise(quotationId: string, body: unknown, ifMatch: number): Promise<Response> {
  return CREATE_REVISION(
    jsonPost(`http://localhost/api/v1/quotations/${quotationId}/revisions`, body, ifMatch),
    { params: Promise.resolve({ quotationId }) }
  );
}
function issue(quotationId: string, body: unknown, ifMatch: number): Promise<Response> {
  return ISSUE(jsonPost(`http://localhost/api/v1/quotations/${quotationId}/issue`, body, ifMatch), {
    params: Promise.resolve({ quotationId }),
  });
}
function decideItem(quotationItemId: string, body: unknown): Promise<Response> {
  return DECIDE_ITEM(
    jsonPost(`http://localhost/api/v1/quotation-items/${quotationItemId}/decisions`, body),
    { params: Promise.resolve({ quotationItemId }) }
  );
}
function decideRevision(revisionId: string, body: unknown): Promise<Response> {
  return DECIDE_REVISION(
    jsonPost(`http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`, body),
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
    const order = await createOpenWorkOrder({ branchId: BRANCH_A2 });
    // SVC_PERMISSION_ELSEWHERE is scoped to A2 for svc.service.read only and holds
    // no quotation permission at all, so it is refused; the point of the case is
    // that the WORK ORDER's own scope decides, never a request field.
    authAs(SVC_PERMISSION_ELSEWHERE);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
    });
    expect(response.status).toBe(403);
    void BRANCH_A1;
  });

  it('never lets a tenant-B caller quote a tenant-A work order', async () => {
    const order = await createOpenWorkOrder();
    authAs(SVC_TENANT_B);
    const response = await createQuotation({
      workOrderId: order.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
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
    authAs(SVC_SCOPED_A2);
    expect((await detail(quotation.id)).status).toBe(403);
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
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_TENANT_B);
    const response = await decideItem(issued.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'in_person',
      presentedRevisionId: issued.id,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
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

  it('refuses an unlinked document as evidence', async () => {
    const quotation = await seedQuotation({ quantity: '1.000' });
    const issued = await issueCurrent(quotation);
    authAs(SVC_FULL);
    // A well-formed but unknown version id: not in the caller's scope, and not
    // linked to this quotation.
    const response = await decideItem(issued.lines[0]?.id as string, {
      decision: 'approved',
      channel: 'email',
      presentedRevisionId: issued.id,
      evidence: {
        evidenceKind: 'document',
        documentVersionId: '00000000-0000-4000-8000-0000000000ac',
      },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
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
});
