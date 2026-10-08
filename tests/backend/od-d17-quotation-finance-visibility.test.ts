/**
 * ADR-023 D17 (Owner decision) — a quotation user sees sales prices and totals,
 * and does NOT see invoice records, payment history, balances, costs, margins or
 * finance reports. End to end through the shipped route handlers.
 *
 * The quotation-only principal holds the quotation codes, the work-order read and
 * the customer read, and nothing of `sal.*`, `inv.*` or `rpt.*`. Against one work
 * order that HAS an issued invoice, a recorded receipt, a requested credit note, a
 * priced part with a cost history and a saved invoice-and-payment snapshot:
 *
 *  - every finance read answers 403 `ERR-IAM-001` — the invoice detail, the
 *    work-order invoice read and preview, the invoice list, the outstanding read,
 *    the credit-note list and detail, the receipt list and detail, the delivery
 *    readiness list, the item cost history, the work-order part-issue list and the
 *    work-order delivery read;
 *  - the quotation detail and the work-order detail answer 200 and carry no key,
 *    at any depth, naming an invoice, a payment or receipt, a balance, an
 *    outstanding or receivable amount, a credit, a settlement, a cost or a margin.
 *    The KEY SET is asserted, not a hand-picked field, so a finance field added to
 *    either response fails here whatever it is called among those words;
 *  - the quotation detail DOES carry the quoted totals, so the key-set assertion is
 *    not passing over an empty body.
 *
 * And a quotation user who may also read and export reports, still without
 * `sal.finance.view`:
 *
 *  - the report catalogue does not list `invoice_payment_summary` to it, while it
 *    lists `work_orders_by_status` (whose code it holds), and a finance reader is
 *    listed the finance report — so the narrowing is per dataset, not blanket;
 *  - the run, the export and the snapshot list of `invoice_payment_summary` answer
 *    403, and the saved snapshot answers as absent.
 *
 * Every case fails if the finance route or field it names became reachable.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  PARTNER_A,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  type Principal,
} from './p1-19-helpers';
import { SVC_FULL, establishP1_20Fixtures } from './p1-20-helpers';
import { CATEGORY_A, UOM_EACH, cleanP1_21Fixtures, establishP1_21Fixtures } from './p1-21-helpers';
import {
  PAYMENT_METHOD_A,
  SAL_FULL,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __resetRateLimitForTests } from '@/server/http/rate-limit';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { GET as READ_QUOTATION } from '@/app/api/v1/quotations/[quotationId]/route';
import { POST as ISSUE_QUOTATION } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { POST as DECIDE_REVISION } from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { GET as READ_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/route';
import { GET as READ_WORK_ORDER_INVOICE } from '@/app/api/v1/work-orders/[workOrderId]/invoice/route';
import { GET as READ_INVOICE_PREVIEW } from '@/app/api/v1/work-orders/[workOrderId]/invoice-preview/route';
import { GET as READ_WORK_ORDER_PART_ISSUES } from '@/app/api/v1/work-orders/[workOrderId]/part-issues/route';
import { GET as READ_WORK_ORDER_DELIVERY } from '@/app/api/v1/work-orders/[workOrderId]/delivery/route';
import { GET as LIST_INVOICES, POST as CREATE_INVOICE } from '@/app/api/v1/invoices/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { GET as READ_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import { POST as REQUEST_CREDIT_NOTE } from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import { GET as LIST_CREDIT_NOTES } from '@/app/api/v1/credit-notes/route';
import { GET as READ_CREDIT_NOTE } from '@/app/api/v1/credit-notes/[creditNoteId]/route';
import { GET as LIST_RECEIPTS, POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { GET as READ_RECEIPT } from '@/app/api/v1/payments/[paymentId]/route';
import { GET as LIST_DELIVERY_READINESS } from '@/app/api/v1/delivery-readiness/route';
import { GET as READ_COST_HISTORY } from '@/app/api/v1/items/[itemId]/cost-history/route';
import { GET as LIST_REPORTS } from '@/app/api/v1/reports/route';
import { POST as EXPORT_REPORT } from '@/app/api/v1/reports/[reportCode]/route';
import { GET as RUN_REPORT } from '@/app/api/v1/reports/[reportCode]/rows/route';
import {
  GET as LIST_SNAPSHOTS,
  POST as CREATE_SNAPSHOT,
} from '@/app/api/v1/reports/[reportCode]/snapshots/route';
import { GET as READ_SNAPSHOT } from '@/app/api/v1/reports/[reportCode]/snapshots/[snapshotId]/rows/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;
type Handler = (request: Request) => Promise<Response>;

const FINANCE_REPORT = 'invoice_payment_summary';
const WORK_ORDER_REPORT = 'work_orders_by_status';
/** A closed past period no other suite saves a snapshot of in this branch. */
const SNAPSHOT_FROM = '2026-03-02';
const SNAPSHOT_TO = '2026-03-03';

const QUOTATION_CODES = [
  'quo.quotation.read',
  'quo.quotation.manage',
  'quo.decision.record',
  'wo.work_order.read',
  'crm.customer.read',
] as const;

const principal = (suffix: string, permissions: readonly string[]): Principal => ({
  roleId: `f1720000-0000-4000-8000-0000000d17${suffix}1`,
  userId: `f1720000-0000-4000-8000-0000000d17${suffix}2`,
  subject: `fx_od_d17_${suffix}`,
  tenantId: TENANT_A,
  permissions,
});

/** The quotation user of D17: quotation codes, the work-order read, the customer read. */
const QUOTATION_ONLY = principal('a', QUOTATION_CODES);
/** The same, and it may read and export reports. Still no `sal.finance.view`. */
const QUOTATION_REPORTS = principal('b', [...QUOTATION_CODES, 'rpt.report.read', 'rpt.export']);
/** Reads reports and money: the non-vacuity reader of the finance report. */
const FINANCE_REPORTS = principal('c', ['rpt.report.read', 'sal.finance.view']);
/** Saves the finance snapshot the quotation user must not reach. */
const SNAPSHOT_SAVER = principal('d', [
  'rpt.report.read',
  'rpt.report.configure',
  'sal.finance.view',
]);

const SUITE_PRINCIPALS = [QUOTATION_ONLY, QUOTATION_REPORTS, FINANCE_REPORTS, SNAPSHOT_SAVER];

/** Words that name finance data D17 keeps from a quotation user. Matched against KEYS. */
const FINANCE_KEY =
  /invoice|payment|receipt|balance|outstanding|receivable|credit|settle|cost|margin/i;

async function seedPrincipal(p: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','D17 principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [p.userId, p.tenantId, IDENTITY_PROVIDER, p.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'D17 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [p.roleId, p.tenantId, p.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,perm.id,'allow',$3::uuid FROM iam.permissions perm
      WHERE perm.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [p.tenantId, p.roleId, USER_A, [...p.permissions]]
  );
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [p.tenantId, p.userId, p.roleId]
  );
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [p.tenantId, p.userId, p.roleId, USER_A]
    );
  }
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

function post(url: string, body: unknown, ifMatch?: number): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const get = <P extends Record<string, string>>(
  handler: unknown,
  path: string,
  params?: P
): Promise<Response> =>
  params === undefined
    ? (handler as Handler)(new Request(`http://localhost${path}`))
    : (handler as ParamHandler<P>)(new Request(`http://localhost${path}`), {
        params: Promise.resolve(params),
      });

/** Every key of a JSON value, at any depth, with its path. */
function keysOf(value: unknown, path = '$'): string[] {
  if (Array.isArray(value))
    return value.flatMap((entry, index) => keysOf(entry, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => [
    `${path}.${key}`,
    ...keysOf(entry, `${path}.${key}`),
  ]);
}

const financeKeysOf = (value: unknown): string[] =>
  keysOf(value).filter((path) => FINANCE_KEY.test(path.slice(path.lastIndexOf('.') + 1)));

async function expectRefused(response: Response): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(403);
  expect((await bodyOf<{ code: string }>(response)).code).toBe('ERR-IAM-001');
}

// ---- Fixtures -----------------------------------------------------------------

interface Fixture {
  readonly workOrderId: string;
  readonly quotationId: string;
  readonly itemId: string;
  readonly invoiceId: string;
  readonly receiptId: string;
  readonly creditNoteId: string;
  readonly snapshotId: string;
}

let fixture: Fixture;
const snapshotIds: string[] = [];

/** A part with a branch selling price, so the quotation carries a real sales total. */
async function pricedPart(): Promise<string> {
  const item = await admin.query<{ id: string }>(
    `INSERT INTO inv.item_master (tenant_id, item_category_id, sku, name, uom_id, created_by)
     VALUES ($1,$2,$3,'D17 part',$4,$5) RETURNING id`,
    [TENANT_A, CATEGORY_A, `FX-D17-${randomUUID().slice(0, 8)}`, UOM_EACH, USER_A]
  );
  const id = item.rows[0]?.id ?? '';
  await admin.query(
    `INSERT INTO inv.item_sale_prices
       (tenant_id, item_id, company_id, branch_id, currency_code, unit_price, created_by)
     VALUES ($1,$2,$3,$4,'USD',25.5000,$5)`,
    [TENANT_A, id, COMPANY_A1, BRANCH_A1, USER_A]
  );
  return id;
}

interface QuotationBody {
  readonly id: string;
  readonly recordVersion: number;
  readonly currentRevision: { readonly id: string } | null;
}

async function readQuotationAs(as: Principal, quotationId: string): Promise<Response> {
  authAs(as);
  return get(READ_QUOTATION, `/api/v1/quotations/${quotationId}`, { quotationId });
}

async function approvedQuotation(workOrderId: string, itemId: string): Promise<string> {
  authAs(SVC_FULL);
  const created = await CREATE_QUOTATION(
    post('http://localhost/api/v1/quotations', {
      workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ kind: 'part', itemId, quantity: '2' }],
    })
  );
  expect(created.status, await created.clone().text()).toBe(201);
  const quotation = await bodyOf<QuotationBody>(created);
  const issued = await (ISSUE_QUOTATION as ParamHandler<{ quotationId: string }>)(
    post(
      `http://localhost/api/v1/quotations/${quotation.id}/issue`,
      { revisionId: quotation.currentRevision?.id },
      quotation.recordVersion
    ),
    { params: Promise.resolve({ quotationId: quotation.id }) }
  );
  expect(issued.status, await issued.clone().text()).toBe(200);
  const revisionId = (await bodyOf<{ id: string }>(issued)).id;
  const decided = await (DECIDE_REVISION as ParamHandler<{ revisionId: string }>)(
    post(`http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`, {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: revisionId,
    }),
    { params: Promise.resolve({ revisionId }) }
  );
  expect(decided.status, await decided.clone().text()).toBe(201);
  return quotation.id;
}

async function issuedInvoice(workOrderId: string): Promise<string> {
  authAs(SAL_FULL);
  const created = await CREATE_INVOICE(post('http://localhost/api/v1/invoices', { workOrderId }));
  expect(created.status, await created.clone().text()).toBe(201);
  const body = await bodyOf<{ invoice: { id: string }; recordVersion: number }>(created);
  const issued = await (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
    post(
      `http://localhost/api/v1/invoices/${body.invoice.id}/issuance`,
      undefined,
      body.recordVersion
    ),
    { params: Promise.resolve({ invoiceId: body.invoice.id }) }
  );
  expect(issued.status, await issued.clone().text()).toBe(200);
  return body.invoice.id;
}

async function recordedReceipt(): Promise<string> {
  authAs(SAL_FULL);
  const response = await RECORD_PAYMENT(
    post('http://localhost/api/v1/payments', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency: 'USD',
      amount: '10.00',
    })
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return (await bodyOf<{ id: string }>(response)).id;
}

async function requestedCreditNote(invoiceId: string): Promise<string> {
  authAs(SAL_FULL);
  const response = await (REQUEST_CREDIT_NOTE as ParamHandler<{ invoiceId: string }>)(
    post(`http://localhost/api/v1/invoices/${invoiceId}/credit-notes`, {
      amount: '1.00',
      reason: 'D17 visibility probe',
    }),
    { params: Promise.resolve({ invoiceId }) }
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return (await bodyOf<{ creditNote: { id: string } }>(response)).creditNote.id;
}

async function savedFinanceSnapshot(): Promise<string> {
  // A snapshot of this period may survive an interrupted earlier run of this file.
  await admin.query(
    `DELETE FROM rpt.report_snapshots
      WHERE tenant_id = $1 AND branch_id = $2 AND report_code = $3
        AND period_from = $4::date`,
    [TENANT_A, BRANCH_A1, FINANCE_REPORT, SNAPSHOT_FROM]
  );
  authAs(SNAPSHOT_SAVER);
  const response = await (CREATE_SNAPSHOT as ParamHandler<{ reportCode: string }>)(
    post(`http://localhost/api/v1/reports/${FINANCE_REPORT}/snapshots`, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      from: SNAPSHOT_FROM,
      to: SNAPSHOT_TO,
    }),
    { params: Promise.resolve({ reportCode: FINANCE_REPORT }) }
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const id = (await bodyOf<{ snapshot: { id: string } }>(response)).snapshot.id;
  snapshotIds.push(id);
  return id;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await establishP1_22Fixtures(admin);
  for (const p of SUITE_PRINCIPALS) await seedPrincipal(p);
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);

  const order = await createOpenWorkOrder();
  const itemId = await pricedPart();
  const quotationId = await approvedQuotation(order.workOrderId, itemId);
  const invoiceId = await issuedInvoice(order.workOrderId);
  fixture = {
    workOrderId: order.workOrderId,
    quotationId,
    itemId,
    invoiceId,
    receiptId: await recordedReceipt(),
    creditNoteId: await requestedCreditNote(invoiceId),
    snapshotId: await savedFinanceSnapshot(),
  };
  __resetAuthenticatorForTests();
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
  __resetRateLimitForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    if (snapshotIds.length > 0) {
      await admin.query(`DELETE FROM rpt.report_snapshots WHERE id = ANY($1::uuid[])`, [
        snapshotIds,
      ]);
    }
    await cleanP1_22Fixtures();
    await cleanBackendFixtures(admin);
    await cleanP1_21Fixtures();
    await admin.end();
  }
});

// ---------------------------------------------------------------------------

describe('D17: a quotation user is refused every finance read', () => {
  const wo = () => ({ workOrderId: fixture.workOrderId });
  const cases: readonly (readonly [string, () => Promise<Response>])[] = [
    [
      'sal.invoice-detail',
      () =>
        get(READ_INVOICE, `/api/v1/invoices/${fixture.invoiceId}`, {
          invoiceId: fixture.invoiceId,
        }),
    ],
    [
      'sal.work-order-invoice-read',
      () =>
        get(READ_WORK_ORDER_INVOICE, `/api/v1/work-orders/${fixture.workOrderId}/invoice`, wo()),
    ],
    [
      'sal.invoice-preview',
      () =>
        get(
          READ_INVOICE_PREVIEW,
          `/api/v1/work-orders/${fixture.workOrderId}/invoice-preview`,
          wo()
        ),
    ],
    ['sal.invoice-list', () => get(LIST_INVOICES, '/api/v1/invoices')],
    [
      'sal.invoice-outstanding-read',
      () =>
        get(READ_OUTSTANDING, `/api/v1/invoices/${fixture.invoiceId}/outstanding`, {
          invoiceId: fixture.invoiceId,
        }),
    ],
    ['sal.credit-note-list', () => get(LIST_CREDIT_NOTES, '/api/v1/credit-notes')],
    [
      'sal.credit-note-detail',
      () =>
        get(READ_CREDIT_NOTE, `/api/v1/credit-notes/${fixture.creditNoteId}`, {
          creditNoteId: fixture.creditNoteId,
        }),
    ],
    ['sal.receipt-list', () => get(LIST_RECEIPTS, '/api/v1/payments')],
    [
      'sal.receipt-detail',
      () =>
        get(READ_RECEIPT, `/api/v1/payments/${fixture.receiptId}`, {
          paymentId: fixture.receiptId,
        }),
    ],
    [
      'sal.delivery-readiness-list',
      () =>
        get(
          LIST_DELIVERY_READINESS,
          `/api/v1/delivery-readiness?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
        ),
    ],
    [
      'inv.item-cost-history-read',
      () =>
        get(READ_COST_HISTORY, `/api/v1/items/${fixture.itemId}/cost-history`, {
          itemId: fixture.itemId,
        }),
    ],
    [
      'inv.work-order-part-issue-list',
      () =>
        get(
          READ_WORK_ORDER_PART_ISSUES,
          `/api/v1/work-orders/${fixture.workOrderId}/part-issues`,
          wo()
        ),
    ],
    [
      'sal.work-order-delivery-read',
      () =>
        get(READ_WORK_ORDER_DELIVERY, `/api/v1/work-orders/${fixture.workOrderId}/delivery`, wo()),
    ],
    ['rpt.report-catalogue', () => get(LIST_REPORTS, '/api/v1/reports')],
    [
      'rpt.report-run',
      () =>
        get(
          RUN_REPORT,
          `/api/v1/reports/${FINANCE_REPORT}/rows?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&from=${SNAPSHOT_FROM}&to=${SNAPSHOT_TO}`,
          { reportCode: FINANCE_REPORT }
        ),
    ],
  ];

  it.each(cases)('refuses %s', async (_operation, send) => {
    authAs(QUOTATION_ONLY);
    await expectRefused(await send());
  });

  it('still answers the same invoice to a finance user, so each refusal above is authority', async () => {
    authAs(SAL_FULL);
    const response = await get(READ_INVOICE, `/api/v1/invoices/${fixture.invoiceId}`, {
      invoiceId: fixture.invoiceId,
    });
    expect(response.status).toBe(200);
  });
});

describe('D17: the quotation and the work order carry no finance key', () => {
  it('serves the quotation with its sales totals and without any finance key', async () => {
    const response = await readQuotationAs(QUOTATION_ONLY, fixture.quotationId);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(financeKeysOf(body)).toEqual([]);
    // Non-vacuity: the response is the priced quotation (2 x 25.5000), not an empty body.
    expect(JSON.stringify(body)).toContain('51.0000');
    expect(keysOf(body).length).toBeGreaterThan(10);
  });

  it('serves the work order without any finance key, although it has an issued invoice', async () => {
    authAs(QUOTATION_ONLY);
    const response = await get(READ_WORK_ORDER, `/api/v1/work-orders/${fixture.workOrderId}`, {
      workOrderId: fixture.workOrderId,
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(financeKeysOf(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(fixture.invoiceId);
    expect(keysOf(body).length).toBeGreaterThan(5);
  });

  it('pins the key matcher itself: a finance key anywhere in a body is found', () => {
    expect(
      financeKeysOf({ quotation: { lines: [{ unitCost: '1' }] }, totals: { balanceDue: '2' } })
    ).toEqual(['$.quotation.lines[0].unitCost', '$.totals.balanceDue']);
  });
});

describe('D17: a quotation user who reads reports is not offered the finance report', () => {
  interface CatalogueBody {
    readonly items: readonly { readonly reportCode: string; readonly titleKey: string | null }[];
  }

  async function catalogueCodes(as: Principal): Promise<string[]> {
    authAs(as);
    const response = await get(LIST_REPORTS, '/api/v1/reports?limit=100');
    expect(response.status).toBe(200);
    return (await bodyOf<CatalogueBody>(response)).items.map((item) => item.reportCode);
  }

  it('lists the reports whose codes it holds and not the invoice-and-payment report', async () => {
    const codes = await catalogueCodes(QUOTATION_REPORTS);
    expect(codes).toContain(WORK_ORDER_REPORT);
    expect(codes).not.toContain(FINANCE_REPORT);
  });

  it('lists the invoice-and-payment report to a caller holding the finance view', async () => {
    const codes = await catalogueCodes(FINANCE_REPORTS);
    expect(codes).toContain(FINANCE_REPORT);
    // And not the work-order report, whose code that caller does not hold.
    expect(codes).not.toContain(WORK_ORDER_REPORT);
  });

  it('refuses the run, the export and the snapshot list of the finance report', async () => {
    authAs(QUOTATION_REPORTS);
    const scope = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;
    await expectRefused(
      await get(
        RUN_REPORT,
        `/api/v1/reports/${FINANCE_REPORT}/rows?${scope}&from=${SNAPSHOT_FROM}&to=${SNAPSHOT_TO}`,
        { reportCode: FINANCE_REPORT }
      )
    );
    await expectRefused(
      await (EXPORT_REPORT as ParamHandler<{ reportCode: string }>)(
        new Request(`http://localhost/api/v1/reports/${FINANCE_REPORT}:export`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            companyId: COMPANY_A1,
            branchId: BRANCH_A1,
            from: SNAPSHOT_FROM,
            to: SNAPSHOT_TO,
            reason: 'D17 visibility probe',
          }),
        }),
        { params: Promise.resolve({ reportCode: `${FINANCE_REPORT}:export` }) }
      )
    );
    await expectRefused(
      await get(LIST_SNAPSHOTS, `/api/v1/reports/${FINANCE_REPORT}/snapshots?${scope}`, {
        reportCode: FINANCE_REPORT,
      })
    );
  });

  it('answers the saved finance snapshot as absent, and serves it to its saver', async () => {
    const path = `/api/v1/reports/${FINANCE_REPORT}/snapshots/${fixture.snapshotId}/rows`;
    const params = { reportCode: FINANCE_REPORT, snapshotId: fixture.snapshotId };
    authAs(QUOTATION_REPORTS);
    const hidden = await get(READ_SNAPSHOT, path, params);
    expect(hidden.status).toBe(404);
    expect((await bodyOf<{ code: string }>(hidden)).code).toBe('ERR-RES-001');
    authAs(SNAPSHOT_SAVER);
    expect((await get(READ_SNAPSHOT, path, params)).status).toBe(200);
  });
});
