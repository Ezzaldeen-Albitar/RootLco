/**
 * P1-30 A2 — the published read seams (S-07 … S-16).
 *
 * A0 measured ten reads the P1-30 screens need and could not reach. A1 made the
 * commercial chain's rows CREATABLE; A2 makes them READABLE. These are the reads a
 * screen calls, so the load-bearing questions here are not "does the query run" but
 * "whose rows does it return, and can a caller widen that by asking differently".
 *
 * ## The scope rule this suite exists to enforce
 *
 * P1-18-A-01: `requiresScopedEvaluation` returns FALSE on an empty scope target
 * whatever an operation declares, so a declared `scope: 'branch'` on a read that
 * names no parent degrades to the scope-blind `iam.has_permission`. Every
 * parent-addressed read here therefore resolves company and branch FROM THE PARENT
 * ROW and authorizes those before it reads anything — never from a request field.
 * The isolation cases are what prove that, and they are the point of the suite.
 *
 * ## Money
 *
 * Every monetary value crosses the wire as a decimal STRING computed by PostgreSQL.
 * A JSON number anywhere in a financial payload means something cast it through
 * IEEE-754. `totals: null` is a distinct and CORRECT answer — it means the caller
 * lacks `sal.finance.view` and the amounts were OMITTED rather than zeroed.
 *
 * ## S-11 was reclassified
 *
 * A0 classed S-11 as B ("an existing model needs a thin route"). Executable evidence
 * refuted that: `PaymentReadService` has no receipt-list method and
 * `PaymentsRepository` has no receipt-list query — its only list is `listAllocations`,
 * which lists one receipt's allocations. S-11 is class C, accepted by Owner decision
 * 2026-09-04. A2's distribution is 2 A / 5 B / 3 C.
 *
 * ## Why the inventory seams are in a second file
 *
 * S-14, S-15 and S-16 live in `p1-30-a2-inventory-reads.test.ts`. Not eight fixture
 * worlds - two, and the split is the one the helper families already impose:
 * `establishP1_21Fixtures` seeds the whole `inv` schema and its own second company,
 * `establishP1_22Fixtures` seeds the whole `sal` half and a different one, and no
 * shipped suite has ever loaded both. Putting all ten seams here would make one
 * `beforeAll` heavier than any suite in the repository, to prove nothing the split
 * does not prove.
 *
 * ## Falsifiability — what was actually measured, including what was NOT proved
 *
 * Each mutation below was applied to the shipped source, the suite was run, and the
 * mutation was reverted. Recorded as measured, not as hoped.
 *
 * **E — `authorizeScope` removed from `QuotationService.listForWorkOrder`.**
 * RED: "derives scope from the WORK ORDER row" answered 200 instead of 403. The
 * path names no branch, so there is no pre-handler target and this in-service check
 * is the ONLY barrier. RLS does not absorb it: `SVC_QUO_SCOPED_A2` carries the
 * widening grant, so the work order is visible to it. This is the P1-18-A-01
 * control, proved.
 *
 * **D — `authorizeScope` removed from `PaymentReadService.listReceipts`.**
 * GREEN. Absorbed, and NOT by RLS. `sal.receipt-list` is scoped by query parameter,
 * so `scopeTargetOption(raw)` gives `handleOperation` a concrete
 * `authorizationTarget` and the PRE-HANDLER scoped permission check refuses first.
 *
 * **D2 — the pre-handler target removed instead (`scopeTargetOption(raw)` → `{}`),
 * `authorizeScope` restored.** GREEN. Absorbed by the in-service check.
 *
 * **D3 — BOTH removed.** RED: 200 instead of 403, another branch's receipts
 * returned to a caller with no finance authority there. So the two layers are each
 * independently sufficient and the suite detects the loss of both. Stated plainly:
 * D and D2 individually prove defence in depth, NOT that either single layer is
 * separately observable — only D3 shows the property is enforced at all.
 *
 * That split is the real distinction between the two shapes in this slice. A
 * QUERY-scoped read (S-11) is guarded twice; a PARENT-addressed read (S-07, S-08,
 * S-09, S-10) has exactly one guard, because there is no target to hand the
 * pre-handler check — which is why removing it is immediately visible.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.work-order-invoice-read: route service authorization success denial cross-tenant isolation
 *   svc.service-detail: route service authorization success denial cross-tenant
 *   quo.quotation-list: route service authorization success denial cross-tenant isolation pagination
 *   quo.quotation-revision-list: route service authorization success denial cross-tenant isolation pagination
 *   quo.quotation-revision-detail: route service authorization success denial cross-tenant isolation
 *   quo.quotation-revision-decisions-read: route service authorization success denial cross-tenant isolation
 *   svc.price-list-detail: route service authorization success denial cross-tenant
 *   svc.price-rule-list: route service authorization success denial cross-tenant
 *   sal.receipt-list: route service authorization success denial cross-tenant isolation pagination
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
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  PAYMENT_METHOD_A,
  SAL_FULL,
  SAL_NO_FINANCE,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_SCOPED_A2,
  SAL_TENANT_B,
  authAs as authAsSal,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedIssuedInvoice,
  seedWorkOrderChain,
} from './p1-22-helpers';
import {
  SERVICE_A,
  SERVICE_B,
  SVC_FULL,
  SVC_QUO_SCOPED_A2,
  SVC_TENANT_B,
  SVC_UNPERMITTED,
  assignPriceList,
  authAs as authAsSvc,
  establishP1_20Fixtures,
} from './p1-20-helpers';
import { PARTNER_A, createWorkOrder } from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as WORK_ORDER_INVOICE } from '@/app/api/v1/work-orders/[workOrderId]/invoice/route';
import { GET as SERVICE_DETAIL } from '@/app/api/v1/services/[serviceId]/route';
import { GET as WORK_ORDER_QUOTATIONS } from '@/app/api/v1/work-orders/[workOrderId]/quotations/route';
import { GET as REVISION_LIST } from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { GET as REVISION_DETAIL } from '@/app/api/v1/quotation-revisions/[revisionId]/route';
import { GET as REVISION_DECISIONS } from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { GET as PRICE_LIST_DETAIL } from '@/app/api/v1/price-lists/[priceListId]/route';
import { GET as PRICE_RULE_LIST } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { GET as RECEIPT_LIST } from '@/app/api/v1/payments/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { POST as CREATE_REVISION } from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { POST as ISSUE_REVISION } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { POST as DECIDE_REVISION } from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { POST as CREATE_PRICE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_PRICE_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_PRICE_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH_PRICE_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';

let admin: Pool;
let runtime: Pool;

const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

function workOrderInvoice(workOrderId: string): Promise<Response> {
  return WORK_ORDER_INVOICE(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/invoice`),
    { params: Promise.resolve({ workOrderId }) }
  );
}

function serviceDetail(serviceId: string): Promise<Response> {
  return SERVICE_DETAIL(new Request(`http://localhost/api/v1/services/${serviceId}`), {
    params: Promise.resolve({ serviceId }),
  });
}

interface InvoiceEnvelope {
  readonly workOrderId: string;
  readonly invoice: {
    readonly id: string;
    readonly workOrderId: string;
    readonly status: string;
    readonly recordVersion: number;
    readonly totals: {
      readonly gross: { readonly amount: string; readonly currency: string };
    } | null;
  } | null;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// S-10 — sal.work-order-invoice-read (class A)
// ---------------------------------------------------------------------------

describe('S-10 sal.work-order-invoice-read', () => {
  it('401 unauthenticated, and 403 without sal.invoice.manage', async () => {
    const chain = await seedWorkOrderChain('a2_s10_auth');

    __resetAuthenticatorForTests();
    expect((await workOrderInvoice(chain.workOrderId)).status).toBe(401);

    // SAL_READER holds read-ish authority but not sal.invoice.manage, so this 403 is
    // the missing permission and nothing else.
    authAsSal(SAL_READER);
    const refused = await workOrderInvoice(chain.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('answers 200 with invoice: null when the work order has no invoice', async () => {
    const chain = await seedWorkOrderChain('a2_s10_empty');
    authAsSal(SAL_FULL);
    const response = await workOrderInvoice(chain.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InvoiceEnvelope;
    // Absence is a 200 with a null invoice, NOT a 404. A 404 here would be
    // indistinguishable from "that work order is not visible to you".
    expect(body.workOrderId).toBe(chain.workOrderId);
    expect(body.invoice).toBeNull();
  });

  it('returns the live invoice, with money as decimal strings', async () => {
    const seeded = await seedIssuedInvoice('a2_s10_live');
    authAsSal(SAL_FULL);
    const response = await workOrderInvoice(seeded.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InvoiceEnvelope;
    expect(body.invoice).not.toBeNull();
    expect(body.invoice?.id).toBe(seeded.invoiceId);
    expect(body.invoice?.workOrderId).toBe(seeded.workOrderId);

    // numeric(18,4) crosses the wire as a STRING computed by PostgreSQL. A number
    // here would mean something in the path cast it through IEEE-754.
    expect(typeof body.invoice?.totals?.gross.amount).toBe('string');
    expect(body.invoice?.totals?.gross.amount).toBe(seeded.gross);
    expect(body.invoice?.totals?.gross.currency).toBe(seeded.currencyCode);
  });

  it('OMITS the money for a caller without sal.finance.view, rather than zeroing it', async () => {
    const seeded = await seedIssuedInvoice('a2_s10_nofinance');
    authAsSal(SAL_NO_FINANCE);
    const response = await workOrderInvoice(seeded.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InvoiceEnvelope;
    // The header is visible; the amounts are not. `sel_invoice_amounts_gated` hides
    // the amounts row and the LEFT JOIN yields NULL rather than dropping the invoice,
    // so the caller learns the invoice EXISTS without learning what it is worth.
    // A zeroed total would be a lie; a 404 would hide a real invoice.
    expect(body.invoice).not.toBeNull();
    expect(body.invoice?.id).toBe(seeded.invoiceId);
    expect(body.invoice?.totals).toBeNull();
    expect(JSON.stringify(body)).not.toContain(seeded.gross);
  });

  it('is refused by RLS when the parent work order is not even visible', async () => {
    const seeded = await seedIssuedInvoice('a2_s10_rlshidden');
    // SAL_SCOPED_A2 is scoped to BRANCH_A2, and `sel_work_orders_scope` filters on
    // `allowed_branch_ids()`. So the parent row is INVISIBLE to this caller and
    // `findWorkOrderScope` returns null before `authorizeScope` is ever reached.
    //
    // Stated honestly: this proves the read is isolated, and it proves RLS is doing
    // it. It does NOT prove the application scope check works -- that is the next
    // case, with the principal chosen so RLS cannot be the thing that refuses.
    authAsSal(SAL_SCOPED_A2);
    const hidden = await workOrderInvoice(seeded.workOrderId);
    expect(hidden.status).toBe(404);
    expect(await codeOf(hidden)).toBe('ERR-RES-001');
  });

  it('derives scope from the WORK ORDER row — the application check refuses, not RLS', async () => {
    const seeded = await seedIssuedInvoice('a2_s10_isolation');
    // THE DECISIVE CASE. SAL_PERMISSION_ELSEWHERE has the seeded branch inside its
    // permission-BLIND allowed-branch union, so RLS serves the parent row happily.
    // The only thing left that can refuse is `authorizeScope` on the company/branch
    // read FROM THAT ROW. A 403 here is therefore the application scope check and
    // nothing else -- which is what P1-18-A-01 demands and what a declared-but-inert
    // scope would fail to do.
    authAsSal(SAL_PERMISSION_ELSEWHERE);
    const refused = await workOrderInvoice(seeded.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    authAsSal(SAL_FULL);
    expect((await workOrderInvoice(seeded.workOrderId)).status).toBe(200);
  });

  it('is cross-tenant isolated, and does not leak existence through the empty shape', async () => {
    const seeded = await seedIssuedInvoice('a2_s10_crosstenant');
    // SAL_TENANT_B holds the permission unrestricted in tenant B, so this refusal is
    // the tenant boundary rather than a missing grant. It must NOT be a 200 with
    // `invoice: null` -- that would confirm the work order exists.
    authAsSal(SAL_TENANT_B);
    const foreign = await workOrderInvoice(seeded.workOrderId);
    expect(foreign.status).not.toBe(200);
    expect([403, 404]).toContain(foreign.status);
  });

  it('refuses a malformed work-order id with a 422 naming the path', async () => {
    authAsSal(SAL_FULL);
    const malformed = await workOrderInvoice('not-a-uuid');
    expect(malformed.status).toBe(422);
    expect(await codeOf(malformed)).toBe('ERR-VAL-001');
  });
});

// ---------------------------------------------------------------------------
// S-12 — svc.service-detail (class A)
// ---------------------------------------------------------------------------

describe('S-12 svc.service-detail', () => {
  it('401 unauthenticated, and 403 without svc.service.read', async () => {
    __resetAuthenticatorForTests();
    expect((await serviceDetail(SERVICE_A)).status).toBe(401);

    authAsSvc(SVC_UNPERMITTED);
    const refused = await serviceDetail(SERVICE_A);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('reads one service, and carries no price', async () => {
    authAsSvc(SVC_FULL);
    const response = await serviceDetail(SERVICE_A);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.id).toBe(SERVICE_A);
    expect(typeof body.serviceCode).toBe('string');
    expect(typeof body.lifecycleStatus).toBe('string');
    expect(typeof body.recordVersion).toBe('number');
    // The catalogue read must never carry a price: resolution depends on company,
    // branch, class and date and is gated on svc.price.read in a different module.
    // Bolting one on here would leak the price book to every catalogue reader.
    const raw = JSON.stringify(body);
    for (const forbidden of ['amount', 'unitPrice', 'currency', 'priceRule']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('exposes recordVersion, so a caller can hold a version for the guarded update', async () => {
    authAsSvc(SVC_FULL);
    const response = await serviceDetail(SERVICE_A);
    expect(response.headers.get('etag')).not.toBeNull();
  });

  it('is cross-tenant isolated: a tenant-B service is not visible', async () => {
    authAsSvc(SVC_FULL);
    const foreign = await serviceDetail(SERVICE_B);
    expect(foreign.status).toBe(404);
    expect(await codeOf(foreign)).toBe('ERR-RES-001');
  });

  it('refuses a malformed service id, and answers 404 for an unknown one', async () => {
    authAsSvc(SVC_FULL);
    const malformed = await serviceDetail('not-a-uuid');
    expect(malformed.status).toBe(422);
    expect(await codeOf(malformed)).toBe('ERR-VAL-001');

    const unknown = await serviceDetail('00000000-0000-4000-8000-0000000000ff');
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe('ERR-RES-001');
  });
});

// ---------------------------------------------------------------------------
// Local machinery for the commercial seams.
//
// Every fixture below is built by calling the SHIPPED route, not by inserting
// rows: a quotation produced by a raw INSERT would prove the read works against
// data no shipped code can create, which is the failure P1-27's journey
// archaeology recorded across twenty-three waves.
// ---------------------------------------------------------------------------

let priceCodeSeq = 0;
let assignmentPriority = 900;

const jsonPost = (url: string, payload: unknown, ifMatch?: number): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(payload),
  });

interface SeededPriceList {
  readonly listId: string;
  readonly versionId: string;
  readonly amount: string;
}

/** A published price list carrying one rule for SERVICE_A, assigned to company A1. */
async function publishPriceList(amount = '120.0000'): Promise<SeededPriceList> {
  authAsSvc(SVC_FULL);
  priceCodeSeq += 1;
  const list = (await (
    await CREATE_PRICE_LIST(
      jsonPost('http://localhost/api/v1/price-lists', {
        priceListCode: `fx-a2-${Date.now() % 100000}-${priceCodeSeq}`,
        name: 'A2 fixture list',
        currency: 'JOD',
      })
    )
  ).json()) as { id: string; recordVersion: number };

  const version = (await (
    await CREATE_PRICE_VERSION(
      jsonPost(
        `http://localhost/api/v1/price-lists/${list.id}/versions`,
        { effectiveFrom: '2020-01-01' },
        list.recordVersion
      ),
      { params: Promise.resolve({ priceListId: list.id }) }
    )
  ).json()) as { id: string; recordVersion: number };

  const recorded = await RECORD_PRICE_RULE(
    jsonPost(`http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/rules`, {
      serviceId: SERVICE_A,
      amount,
    }),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  expect(recorded.status).toBe(201);

  const published = await PUBLISH_PRICE_VERSION(
    jsonPost(
      `http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/publication`,
      // `effectiveFrom` is required and re-stated on publication: the command fixes
      // the date the amounts take effect from, it does not inherit the draft's.
      { effectiveFrom: '2020-01-01' },
      version.recordVersion
    ),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  expect(published.status).toBe(200);

  // A distinct, increasing priority: `uq_price_list_assignments_signature` is unique
  // on (tenant, company, branch, class, priority) while active, so a fixed priority
  // would make the SECOND fixture list collide with the first.
  assignmentPriority += 1;
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: list.id,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: assignmentPriority,
  });
  return { listId: list.id, versionId: version.id, amount };
}

interface SeededQuotation {
  readonly id: string;
  readonly workOrderId: string;
  readonly recordVersion: number;
  readonly currentRevision: { readonly id: string; readonly recordVersion: number } | null;
}

async function seedQuotation(workOrderId: string): Promise<SeededQuotation> {
  authAsSvc(SVC_FULL);
  const response = await CREATE_QUOTATION(
    jsonPost('http://localhost/api/v1/quotations', {
      workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '2.000' }],
    })
  );
  expect(response.status).toBe(201);
  return (await response.json()) as SeededQuotation;
}

/** Adds a second revision, which SUPERSEDES the first. */
async function reviseQuotation(quotation: SeededQuotation): Promise<SeededQuotation> {
  authAsSvc(SVC_FULL);
  const response = await CREATE_REVISION(
    jsonPost(
      `http://localhost/api/v1/quotations/${quotation.id}/revisions`,
      { lines: [{ serviceId: SERVICE_A, quantity: '3.000' }] },
      quotation.recordVersion
    ),
    { params: Promise.resolve({ quotationId: quotation.id }) }
  );
  expect(response.status).toBe(201);
  const detail = await QUOTATION_DETAIL_FOR_FIXTURE(quotation.id);
  return detail;
}

async function QUOTATION_DETAIL_FOR_FIXTURE(quotationId: string): Promise<SeededQuotation> {
  const rows = await admin.query<{
    id: string;
    work_order_id: string;
    record_version: number;
    current_revision_id: string | null;
  }>(
    `SELECT id, work_order_id, record_version, current_revision_id
       FROM quo.quotations WHERE id = $1`,
    [quotationId]
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error(`quotation ${quotationId} vanished`);
  // `current_revision_id` is written on ISSUE, so it is NULL while every revision is
  // still a draft. The fixture falls back to the highest revision number, which is
  // the same fallback `QuotationService.detail` performs — a fixture that used the
  // column alone would report "no current revision" for a quotation the product
  // says has one.
  const latest = await admin.query<{ id: string }>(
    `SELECT id FROM quo.quotation_revisions
      WHERE quotation_id = $1 AND deleted_at IS NULL
      ORDER BY revision_number DESC LIMIT 1`,
    [quotationId]
  );
  const currentId = row.current_revision_id ?? latest.rows[0]?.id ?? null;
  const revision = currentId === null ? null : { id: currentId, recordVersion: 1 };
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    recordVersion: row.record_version,
    currentRevision: revision,
  };
}

function quotationList(workOrderId: string, query = ''): Promise<Response> {
  return WORK_ORDER_QUOTATIONS(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/quotations${query}`),
    { params: Promise.resolve({ workOrderId }) }
  );
}

function revisionList(quotationId: string, query = ''): Promise<Response> {
  return REVISION_LIST(
    new Request(`http://localhost/api/v1/quotations/${quotationId}/revisions${query}`),
    { params: Promise.resolve({ quotationId }) }
  );
}

function revisionDetail(revisionId: string): Promise<Response> {
  return REVISION_DETAIL(new Request(`http://localhost/api/v1/quotation-revisions/${revisionId}`), {
    params: Promise.resolve({ revisionId }),
  });
}

function revisionDecisions(revisionId: string): Promise<Response> {
  return REVISION_DECISIONS(
    new Request(`http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`),
    { params: Promise.resolve({ revisionId }) }
  );
}

function priceListDetail(priceListId: string): Promise<Response> {
  return PRICE_LIST_DETAIL(new Request(`http://localhost/api/v1/price-lists/${priceListId}`), {
    params: Promise.resolve({ priceListId }),
  });
}

function priceRuleList(priceListId: string, versionId: string): Promise<Response> {
  return PRICE_RULE_LIST(
    new Request(`http://localhost/api/v1/price-lists/${priceListId}/versions/${versionId}/rules`),
    { params: Promise.resolve({ priceListId, versionId }) }
  );
}

function receiptList(query: string): Promise<Response> {
  return RECEIPT_LIST(new Request(`http://localhost/api/v1/payments${query}`));
}

interface PageBody<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

// ---------------------------------------------------------------------------
// S-07 — quo.quotation-list (class B)
// ---------------------------------------------------------------------------

describe('S-07 quo.quotation-list', () => {
  it('401 unauthenticated, and 403 without quo.quotation.read', async () => {
    const order = await createWorkOrder();

    __resetAuthenticatorForTests();
    expect((await quotationList(order.workOrderId)).status).toBe(401);

    // Holds svc.service.read and nothing commercial, so this 403 is the missing
    // permission and cannot be mistaken for a scope refusal.
    authAsSvc(SVC_UNPERMITTED);
    const refused = await quotationList(order.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('answers an EMPTY page for a visible work order nobody has quoted', async () => {
    const order = await createWorkOrder();
    authAsSvc(SVC_FULL);
    const response = await quotationList(order.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<unknown>;
    // Empty, not 404. The work order is visible and genuinely has no quotations;
    // a 404 here would be indistinguishable from "you may not see that order".
    expect(body.items).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
  });

  it("lists the work order's quotations, newest first, headers only", async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const first = await seedQuotation(order.workOrderId);
    const second = await seedQuotation(order.workOrderId);

    authAsSvc(SVC_FULL);
    const response = await quotationList(order.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<Record<string, unknown>>;
    expect(body.items.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(body.items[0]?.workOrderId).toBe(order.workOrderId);
    expect(typeof body.items[0]?.quotationNumber).toBe('string');

    // Headers only: no revision OBJECT and no priced line travels on the list. The
    // money is on GET /quotations/{id}, so nothing here can round it.
    //
    // `currentRevisionId` IS present and is meant to be — it is the navigation link
    // to the drill-down. The assertion is therefore on the nested key, not on the
    // substring: `not.toContain('currentRevision')` would fail on the id itself and
    // would have been a test asserting the opposite of the contract.
    const raw = JSON.stringify(body);
    expect(
      typeof body.items[0]?.currentRevisionId === 'string' ||
        body.items[0]?.currentRevisionId === null
    ).toBe(true);
    expect(raw).not.toContain('"currentRevision":');
    expect(raw).not.toContain('"lines":');
    expect(raw).not.toContain('grandTotal');
  });

  it('pages by keyset without overlap, and separates a bad cursor from a bad param', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const first = await seedQuotation(order.workOrderId);
    const second = await seedQuotation(order.workOrderId);

    authAsSvc(SVC_FULL);
    const pageOne = (await (
      await quotationList(order.workOrderId, '?limit=1')
    ).json()) as PageBody<{
      id: string;
    }>;
    expect(pageOne.items.map((row) => row.id)).toEqual([second.id]);
    expect(pageOne.hasMore).toBe(true);
    expect(pageOne.nextCursor).not.toBeNull();

    const pageTwo = (await (
      await quotationList(
        order.workOrderId,
        `?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? '')}`
      )
    ).json()) as PageBody<{ id: string }>;
    // No overlap and no gap: the second page is the OTHER quotation, not the same one.
    expect(pageTwo.items.map((row) => row.id)).toEqual([first.id]);
    expect(pageTwo.hasMore).toBe(false);

    // A malformed cursor is 400 ERR-PAG-001 ...
    const badCursor = await quotationList(order.workOrderId, '?cursor=not-a-cursor');
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');

    // ... and an unknown query parameter is 422 ERR-VAL-001. Collapsing the two
    // would let a caller who mistyped a filter believe it was applied.
    const unknownParam = await quotationList(order.workOrderId, '?status=draft');
    expect(unknownParam.status).toBe(422);
    expect(await codeOf(unknownParam)).toBe('ERR-VAL-001');
  });

  it('derives scope from the WORK ORDER row — the application check refuses, not RLS', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    await seedQuotation(order.workOrderId);

    // SVC_QUO_SCOPED_A2 holds quo.quotation.read UNRESERVEDLY, scoped to branch A2,
    // AND carries the widening grant `establishP1_20Fixtures` gives it — so BRANCH_A1
    // is inside its permission-blind allowed-branch union and RLS serves the work
    // order happily. The only thing left that can refuse is `authorizeScope` on the
    // company/branch read FROM THAT ROW. This 403 is the application scope check and
    // nothing else, which is exactly what P1-18-A-01 demands.
    authAsSvc(SVC_QUO_SCOPED_A2);
    const refused = await quotationList(order.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    authAsSvc(SVC_FULL);
    expect((await quotationList(order.workOrderId)).status).toBe(200);
  });

  it('is cross-tenant isolated, and an empty page is not the answer', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    await seedQuotation(order.workOrderId);

    // Tenant B, holding quo.quotation.read unrestricted: the refusal is the tenant
    // boundary. It must NOT be a 200 with an empty page — that would confirm the
    // work order exists in another tenant.
    authAsSvc(SVC_TENANT_B);
    const foreign = await quotationList(order.workOrderId);
    expect(foreign.status).not.toBe(200);
    expect([403, 404]).toContain(foreign.status);
  });
});

// ---------------------------------------------------------------------------
// S-08 — quo.quotation-revision-list + quo.quotation-revision-detail (class B)
// ---------------------------------------------------------------------------

describe('S-08 quo.quotation-revision-list + quo.quotation-revision-detail', () => {
  it('401 unauthenticated, and 403 without quo.quotation.read', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const quotation = await seedQuotation(order.workOrderId);

    __resetAuthenticatorForTests();
    expect((await revisionList(quotation.id)).status).toBe(401);
    expect((await revisionDetail(quotation.currentRevision?.id ?? '')).status).toBe(401);

    authAsSvc(SVC_UNPERMITTED);
    const refused = await revisionList(quotation.id);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('lists every revision newest first, flags the current one, and keeps money as strings', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const created = await seedQuotation(order.workOrderId);
    const revised = await reviseQuotation(created);

    authAsSvc(SVC_FULL);
    const response = await revisionList(created.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<Record<string, unknown>>;
    expect(body.items).toHaveLength(2);
    expect(body.items.map((row) => row.revisionNumber)).toEqual([2, 1]);

    // Exactly ONE row is current, and it is the newest revision.
    //
    // Both revisions here are DRAFTS, so the parent's `current_revision_id` is still
    // NULL — it is written on issue. `detail` falls back to the latest revision in
    // that case, and this list must fall back identically or a screen reading both
    // would be told two different things about the same document. That agreement is
    // what this assertion pins; reading the column alone answered `[]`.
    expect(body.items.filter((row) => row.isCurrent === true)).toHaveLength(1);
    expect(body.items[0]?.id).toBe(revised.currentRevision?.id);
    expect(body.items[0]?.isCurrent).toBe(true);

    // numeric(18,4) totals cross as decimal STRINGS. ck_quotation_revisions_totals
    // holds grand = subtotal - discount + tax in the database; a JSON number would
    // let a client re-derive that identity in IEEE-754 and disagree with the row.
    for (const key of ['subtotal', 'discountTotal', 'taxTotal', 'grandTotal']) {
      expect(typeof body.items[0]?.[key]).toBe('string');
    }
    // Headers only — the priced lines are on the drill-down.
    expect(JSON.stringify(body)).not.toContain('"lines"');
  });

  it('reads a SUPERSEDED revision with its lines — the gap S-08 closes', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const created = await seedQuotation(order.workOrderId);
    const supersededId = created.currentRevision?.id ?? '';
    const revised = await reviseQuotation(created);
    expect(revised.currentRevision?.id).not.toBe(supersededId);

    authAsSvc(SVC_FULL);
    // The whole point: quo.quotation-detail publishes ONLY current_revision_id, so
    // before this route the superseded revision — the immutable record of what the
    // customer was actually shown — was unreadable through the API.
    const response = await revisionDetail(supersededId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      revisionNumber: number;
      lines: readonly Record<string, unknown>[];
      grandTotal: string;
    };
    expect(body.id).toBe(supersededId);
    expect(body.revisionNumber).toBe(1);
    expect(body.lines.length).toBeGreaterThan(0);
    expect(typeof body.grandTotal).toBe('string');
    for (const key of ['unitPrice', 'quantity', 'taxRate', 'taxAmount', 'lineTotal']) {
      expect(typeof body.lines[0]?.[key]).toBe('string');
    }
    // The ETag carries the revision's record_version for the guarded issue command.
    expect(response.headers.get('etag')).not.toBeNull();
  });

  it('derives scope from the parent row on BOTH operations — application check, not RLS', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const quotation = await seedQuotation(order.workOrderId);
    const revisionId = quotation.currentRevision?.id ?? '';

    // Same decisive principal as S-07: permission held unreservedly, A1 inside the
    // allowed-branch union, so RLS serves both rows and only `authorizeScope` can
    // refuse. The list authorizes the QUOTATION row; the detail authorizes the
    // REVISION row — two different derivations, both proved here.
    authAsSvc(SVC_QUO_SCOPED_A2);
    const listRefused = await revisionList(quotation.id);
    expect(listRefused.status).toBe(403);
    expect(await codeOf(listRefused)).toBe('ERR-IAM-001');

    const detailRefused = await revisionDetail(revisionId);
    expect(detailRefused.status).toBe(403);
    expect(await codeOf(detailRefused)).toBe('ERR-IAM-001');
  });

  it('is cross-tenant isolated, refuses a bad cursor 400 and an unknown param 422', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const quotation = await seedQuotation(order.workOrderId);

    authAsSvc(SVC_TENANT_B);
    const foreignList = await revisionList(quotation.id);
    expect([403, 404]).toContain(foreignList.status);
    const foreignDetail = await revisionDetail(quotation.currentRevision?.id ?? '');
    expect([403, 404]).toContain(foreignDetail.status);

    authAsSvc(SVC_FULL);
    const badCursor = await revisionList(quotation.id, '?cursor=not-a-cursor');
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');

    const unknownParam = await revisionList(quotation.id, '?revisionNumber=1');
    expect(unknownParam.status).toBe(422);
    expect(await codeOf(unknownParam)).toBe('ERR-VAL-001');

    const malformed = await revisionDetail('not-a-uuid');
    expect(malformed.status).toBe(422);
    expect(await codeOf(malformed)).toBe('ERR-VAL-001');
  });
});

// ---------------------------------------------------------------------------
// S-09 — quo.quotation-revision-decisions-read (class C)
// ---------------------------------------------------------------------------

describe('S-09 quo.quotation-revision-decisions-read', () => {
  it('401 unauthenticated, and 403 without quo.quotation.read', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const quotation = await seedQuotation(order.workOrderId);
    const revisionId = quotation.currentRevision?.id ?? '';

    __resetAuthenticatorForTests();
    expect((await revisionDecisions(revisionId)).status).toBe(401);

    authAsSvc(SVC_UNPERMITTED);
    const refused = await revisionDecisions(revisionId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('reports an UNDECIDED revision as itemCount > 0, decidedCount 0, outcome null', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const quotation = await seedQuotation(order.workOrderId);

    authAsSvc(SVC_FULL);
    const response = await revisionDecisions(quotation.currentRevision?.id ?? '');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      itemCount: number;
      decidedCount: number;
      outcome: string | null;
      decisions: readonly unknown[];
    };
    // `outcome: null` is a real state — "still partly undecided" — not an absence.
    // `itemCount` comes from the items, so a reader can see that nothing has been
    // answered rather than having to infer it from an empty array.
    expect(body.itemCount).toBeGreaterThan(0);
    expect(body.decidedCount).toBe(0);
    expect(body.outcome).toBeNull();
    expect(body.decisions).toHaveLength(0);
  });

  it('returns the recorded decision with its evidence, and recomputes the outcome', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const quotation = await seedQuotation(order.workOrderId);
    const revisionId = quotation.currentRevision?.id ?? '';

    authAsSvc(SVC_FULL);
    const issued = await ISSUE_REVISION(
      jsonPost(
        `http://localhost/api/v1/quotations/${quotation.id}/issue`,
        { revisionId },
        quotation.recordVersion
      ),
      { params: Promise.resolve({ quotationId: quotation.id }) }
    );
    expect(issued.status).toBe(200);

    const decided = await DECIDE_REVISION(
      jsonPost(`http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`, {
        decision: 'approved',
        channel: 'in_person',
        presentedRevisionId: revisionId,
        decidingPartyRef: PARTNER_A,
        evidence: { evidenceKind: 'verbal', referenceNote: 'A2 fixture approval' },
      }),
      { params: Promise.resolve({ revisionId }) }
    );
    expect(decided.status).toBe(201);

    const response = await revisionDecisions(revisionId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      itemCount: number;
      decidedCount: number;
      outcome: string | null;
      decisions: readonly {
        lineNumber: number;
        decision: string;
        channel: string;
        recordedBy: string;
        evidence: readonly { evidenceKind: string; referenceNote: string | null }[];
      }[];
    };
    expect(body.decidedCount).toBe(body.itemCount);
    // Recomputed by rollUpDecisions from the item rows — there is no stored
    // revision-level decision in `quo` and this read invents none.
    expect(body.outcome).toBe('accepted');
    expect(body.decisions).toHaveLength(body.itemCount);
    expect(body.decisions[0]?.decision).toBe('approved');
    expect(body.decisions[0]?.channel).toBe('in_person');
    // The LINE is named, so a reviewer can hold the trail against the quotation.
    expect(body.decisions[0]?.lineNumber).toBe(1);
    // The evidence is an ARRAY and it is populated — quo.approval_evidence had an
    // INSERT and no read at all before this seam.
    expect(body.decisions[0]?.evidence).toHaveLength(1);
    expect(body.decisions[0]?.evidence[0]?.evidenceKind).toBe('verbal');
    expect(body.decisions[0]?.evidence[0]?.referenceNote).toBe('A2 fixture approval');

    // No storage key and no actor NAME: recordedBy is an id for navigation only.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('storageKey');
    expect(raw).not.toContain('displayName');
  });

  it('derives scope from the REVISION row, and is cross-tenant isolated', async () => {
    await publishPriceList();
    const order = await createWorkOrder();
    const quotation = await seedQuotation(order.workOrderId);
    const revisionId = quotation.currentRevision?.id ?? '';

    authAsSvc(SVC_QUO_SCOPED_A2);
    const refused = await revisionDecisions(revisionId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    authAsSvc(SVC_TENANT_B);
    expect([403, 404]).toContain((await revisionDecisions(revisionId)).status);

    authAsSvc(SVC_FULL);
    expect((await revisionDecisions(revisionId)).status).toBe(200);
    const unknown = await revisionDecisions('00000000-0000-4000-8000-0000000000fe');
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe('ERR-RES-001');
  });
});

// ---------------------------------------------------------------------------
// S-13 — svc.price-list-detail + svc.price-rule-list (class C)
// ---------------------------------------------------------------------------

describe('S-13 svc.price-list-detail + svc.price-rule-list', () => {
  it('401 unauthenticated, and 403 without svc.price.read', async () => {
    const seeded = await publishPriceList();

    __resetAuthenticatorForTests();
    expect((await priceListDetail(seeded.listId)).status).toBe(401);

    // SVC_UNPERMITTED holds no svc.price.read, so both refusals are the permission.
    authAsSvc(SVC_UNPERMITTED);
    expect((await priceListDetail(seeded.listId)).status).toBe(403);
    expect((await priceRuleList(seeded.listId, seeded.versionId)).status).toBe(403);
  });

  it('publishes the version history a caller previously could not enumerate', async () => {
    const seeded = await publishPriceList();
    authAsSvc(SVC_FULL);
    const response = await priceListDetail(seeded.listId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      currency: string;
      versions: readonly { id: string; versionNo: number; status: string }[];
      versionsTruncated: boolean;
    };
    expect(body.id).toBe(seeded.listId);
    expect(body.currency).toBe('JOD');
    // The gap this closes: findPriceListVersion takes an id a caller had no way to
    // obtain, so the version history existed and was unreachable.
    expect(body.versions.map((row) => row.id)).toContain(seeded.versionId);
    expect(body.versions[0]?.status).toBe('published');
    expect(body.versionsTruncated).toBe(false);
    expect(response.headers.get('etag')).not.toBeNull();
  });

  it('lists rules in RESOLUTION order with the list currency attached', async () => {
    const seeded = await publishPriceList('77.5000');
    authAsSvc(SVC_FULL);
    const response = await priceRuleList(seeded.listId, seeded.versionId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      versionId: string;
      currency: string;
      truncated: boolean;
      rules: readonly {
        amount: string;
        currency: string;
        specificity: number;
        service: { id: string; serviceCode: string };
        appliesTo: { companyId: string | null; branchId: string | null };
      }[];
    };
    expect(body.versionId).toBe(seeded.versionId);
    expect(body.truncated).toBe(false);
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]?.service.id).toBe(SERVICE_A);
    // The service is paired with a real label, never published as a bare id.
    expect(typeof body.rules[0]?.service.serviceCode).toBe('string');

    // numeric(18,4) as an exact decimal STRING, labelled with the PARENT LIST's
    // currency: svc.price_rules stores none, so an unlabelled figure would be the
    // failure mode here.
    expect(typeof body.rules[0]?.amount).toBe('string');
    expect(body.rules[0]?.amount).toBe('77.5000');
    expect(body.rules[0]?.currency).toBe('JOD');
    expect(body.currency).toBe('JOD');

    // A rule narrowing on nothing has specificity 0 — the resolver's own weight,
    // published so a reader can see WHY one rule beats another.
    expect(body.rules[0]?.specificity).toBe(0);
    expect(body.rules[0]?.appliesTo.companyId).toBeNull();
    expect(body.rules[0]?.appliesTo.branchId).toBeNull();
  });

  it('refuses a version that belongs to a DIFFERENT price list, as a uniform 404', async () => {
    const first = await publishPriceList();
    const second = await publishPriceList();
    authAsSvc(SVC_FULL);
    // Without this check the id in the path would be decoration and any caller who
    // can name one list could read any version's prices through it. The refusal is
    // the same ERR-RES-001 an absent version gets, so the path is not an oracle.
    const crossed = await priceRuleList(first.listId, second.versionId);
    expect(crossed.status).toBe(404);
    expect(await codeOf(crossed)).toBe('ERR-RES-001');
  });

  it('is cross-tenant isolated and refuses malformed ids', async () => {
    const seeded = await publishPriceList();

    // Tenant B holds svc.price.read unrestricted, so this refusal is the tenant
    // boundary and not a missing permission.
    authAsSvc(SVC_TENANT_B);
    const foreign = await priceListDetail(seeded.listId);
    expect(foreign.status).toBe(404);
    expect(await codeOf(foreign)).toBe('ERR-RES-001');

    authAsSvc(SVC_FULL);
    const malformed = await priceListDetail('not-a-uuid');
    expect(malformed.status).toBe(422);
    expect(await codeOf(malformed)).toBe('ERR-VAL-001');
  });
});

// ---------------------------------------------------------------------------
// S-11 — sal.receipt-list (class C, reclassified from B)
// ---------------------------------------------------------------------------

describe('S-11 sal.receipt-list', () => {
  const recordReceipt = async (amount: string): Promise<string> => {
    authAsSal(SAL_FULL);
    const response = await RECORD_PAYMENT(
      jsonPost('http://localhost/api/v1/payments', {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        paymentMethodId: PAYMENT_METHOD_A,
        payerPartnerId: PARTNER_A,
        currency: 'USD',
        amount,
      })
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };

  const scopedQuery = `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

  it('401 unauthenticated, and 403 without sal.finance.view', async () => {
    __resetAuthenticatorForTests();
    expect((await receiptList(scopedQuery)).status).toBe(401);

    // SAL_NO_FINANCE holds every other sal permission. sel_receipts_gated gates the
    // WHOLE ROW on sal.finance.view, and the operation declares that code, so the
    // refusal happens at the permission check rather than as a misleading empty page.
    authAsSal(SAL_NO_FINANCE);
    const refused = await receiptList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('requires companyId and branchId — the authorization target is not optional', async () => {
    authAsSal(SAL_FULL);
    // An optional scope pair would skip authorizeScope entirely and leave
    // app.branch_ids — the permission-blind union of every grant — as the only
    // narrowing on a branch's cash (P1-18-A-01).
    const unscoped = await receiptList('');
    expect(unscoped.status).toBe(422);
    expect(await codeOf(unscoped)).toBe('ERR-VAL-001');
  });

  it("lists a branch's receipts newest first, with money as decimal strings", async () => {
    const older = await recordReceipt('25.0000');
    const newer = await recordReceipt('40.5000');

    authAsSal(SAL_FULL);
    const response = await receiptList(scopedQuery);
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody<{
      id: string;
      reference: string;
      money: { amount: string; currency: string };
      unallocated: { amount: string; currency: string };
      status: string;
      method: { kind: string } | null;
    }>;
    const ids = body.items.map((row) => row.id);
    expect(ids).toContain(newer);
    expect(ids).toContain(older);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));

    const seen = body.items.find((row) => row.id === newer);
    // numeric(18,4) crosses as a STRING with the currency that labels it.
    expect(typeof seen?.money.amount).toBe('string');
    expect(seen?.money.amount).toBe('40.5000');
    expect(seen?.money.currency).toBe('USD');
    // The remainder is sal.receipt_unallocated — PostgreSQL's own subtraction, not
    // this process's. A freshly recorded receipt is wholly unallocated.
    expect(typeof seen?.unallocated.amount).toBe('string');
    expect(seen?.unallocated.amount).toBe('40.5000');
    expect(seen?.status).toBe('recorded');
    // The method is labelled from the reference table, never fabricated.
    expect(typeof seen?.method?.kind).toBe('string');
    // No cashier identity travels on the list.
    expect(JSON.stringify(body)).not.toContain('receivedBy');
  });

  it('filters by payer, pages by keyset, and separates a bad cursor from a bad param', async () => {
    await recordReceipt('11.0000');
    await recordReceipt('12.0000');

    authAsSal(SAL_FULL);
    const filtered = await receiptList(`${scopedQuery}&payerPartnerId=${PARTNER_A}`);
    expect(filtered.status).toBe(200);
    expect(((await filtered.json()) as PageBody<unknown>).items.length).toBeGreaterThan(0);

    const pageOne = (await (await receiptList(`${scopedQuery}&limit=1`)).json()) as PageBody<{
      id: string;
    }>;
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.hasMore).toBe(true);
    const pageTwo = (await (
      await receiptList(
        `${scopedQuery}&limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? '')}`
      )
    ).json()) as PageBody<{ id: string }>;
    // Distinct rows across the page boundary: the microsecond cursor is what stops
    // receipts written in one transaction from being skipped (P1-27-INT-006).
    expect(pageTwo.items[0]?.id).not.toBe(pageOne.items[0]?.id);

    const badCursor = await receiptList(`${scopedQuery}&cursor=not-a-cursor`);
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');

    const unknownParam = await receiptList(`${scopedQuery}&receiptNumber=X`);
    expect(unknownParam.status).toBe(422);
    expect(await codeOf(unknownParam)).toBe('ERR-VAL-001');
  });

  it('refuses a branch the caller has no finance authority in — application check, not RLS', async () => {
    await recordReceipt('33.0000');

    // SAL_PERMISSION_ELSEWHERE holds the sal permissions scoped to A2 and carries the
    // widening grant that puts A1 inside its permission-blind allowed-branch union.
    // RLS would serve A1's receipts; only the scoped permission check refuses.
    authAsSal(SAL_PERMISSION_ELSEWHERE);
    const refused = await receiptList(scopedQuery);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    authAsSal(SAL_FULL);
    expect((await receiptList(scopedQuery)).status).toBe(200);
  });

  it('is cross-tenant isolated: tenant B sees no tenant-A receipt', async () => {
    const mine = await recordReceipt('44.0000');

    // Tenant B holds sal.finance.view unrestricted, so a refusal or an empty page is
    // the tenant boundary. Either is acceptable HERE because the scope pair names
    // tenant A's own company and branch: what must never happen is tenant A's row
    // appearing in the answer.
    authAsSal(SAL_TENANT_B);
    const foreign = await receiptList(scopedQuery);
    if (foreign.status === 200) {
      const body = (await foreign.json()) as PageBody<{ id: string }>;
      expect(body.items.map((row) => row.id)).not.toContain(mine);
    } else {
      expect([403, 404]).toContain(foreign.status);
    }
  });
});
