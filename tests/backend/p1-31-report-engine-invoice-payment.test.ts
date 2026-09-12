/**
 * The report engine, slice 4 of 4 — `invoice_payment_summary` (P1-31, P-11).
 *
 * COVERAGE-EVIDENCE: rpt.report-run
 *
 * ## What the Owner approved, and what follows from it
 *
 * D-4: the invoice and payment summary, whose amounts are restricted. The report
 * requires `rpt.report.read` AND `sal.finance.view`, "the second is not optional
 * and the report must refuse AS A WHOLE without it", because a derived aggregate
 * over amounts a caller was not allowed to read becomes a silent ZERO rather than
 * an absence — a confident, wrong figure indistinguishable on screen from a real
 * one. Outstanding is `sal.invoice_open_receivable` and is never re-derived;
 * `credited` is a status and is shown as one; a reversed receipt did not happen;
 * totals are per currency and never across currencies; amounts stay strings.
 *
 * D-5: no measure spans two currencies.
 *
 * The Owner's answer of 2026-09-12 completes the report:
 * `owner-decisions-2026-09-12.md` § 2 asks for the authoritative credit-note and
 * unallocated-receipt amounts as separate fields, the permitted party name beside
 * its identifier under the role it is actually held in, and a document
 * drill-through resolved by document kind against an authorized target route —
 * with nothing invented, no financial calculation moved to the browser, and no
 * missing contract silently omitted.
 *
 * D-17: every report period is half-open, `[from, to)`, in the selected branch's
 * timezone, converted consistently server-side, with the timezone and the filter
 * context displayed and preserved.
 *
 * ## Why the fixtures write through the protected primitives
 *
 * `sal.issue_invoice`, `sal.record_receipt`, `sal.allocate_receipt`,
 * `sal.approve_credit_note` and `sal.approve_receipt_reversal` own the
 * transitions: they allocate the gapless number, write the header totals, emit the
 * `sal.financial_events` row the DEFERRED completeness triggers demand, and
 * enforce dual control. A fixture that inserted a born-issued invoice would be
 * refused by `sal.guard_invoice_freeze`, and one that inserted a receipt without
 * its event would abort at COMMIT. So every document below is a document the
 * platform itself produced.
 *
 * ## Why the instants are RESTATED afterwards, and what that admits
 *
 * A measured fact, recorded rather than worked around quietly: every one of those
 * primitives stamps its instant from `now()` — `issued_at`, `received_at`,
 * `allocated_at` — and no route, and no primitive, accepts an instant from a
 * caller. **A financial document cannot be backdated**, which is correct and is
 * not something this slice changes.
 *
 * The half-open boundary, however, is a claim about CHOSEN instants one second
 * apart in a named zone, and every document a suite writes otherwise lands inside
 * the same microsecond-wide cluster of one `now()`. So the fixture writes through
 * the full primitive — which is what validates the row — and then restates the
 * single instant with triggers suspended for that statement alone.
 *
 * That restatement is visibly a fixture-only act and not a path the application
 * has: `sal.guard_invoice_freeze` freezes `issued_at` on an issued invoice and
 * `sal.guard_receipt_freeze` freezes `received_at` outright, so suspending them
 * requires a superuser session setting `session_replication_role` — which
 * `app_runtime` cannot do and which is set LOCAL to the fixture's own
 * transaction. Nothing else about any row is touched.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_TENANT_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  PARTNER_A,
  authAs,
  createWorkOrder,
  establishP1_19Fixtures,
  type Principal,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { REPORT_DATASETS, REPORT_DATASET_CODES } from '@/modules/reporting';
import { GET as RUN } from '@/app/api/v1/reports/[reportCode]/rows/route';

let admin: Pool;
let runtime: Pool | undefined;

// ---- Scope ------------------------------------------------------------------

/** This suite's own company inside tenant A. Nothing else writes to it. */
const COMPANY_S = 'f1340000-0000-4000-8000-0000000000c1';
/** The REPORTED branch. */
const BRANCH_S1 = 'f1340000-0000-4000-8000-0000000000b1';
/** A sibling branch, same company, same zone — the containment case. */
const BRANCH_S2 = 'f1340000-0000-4000-8000-0000000000b2';

/**
 * `Asia/Amman` — the only non-UTC zone `supabase/seeds/01_reference_data.sql`
 * seeds, and `fk_branches_timezone` refuses anything else. A non-UTC branch is the
 * whole point: with a UTC branch this suite could not tell a BRANCH reading of a
 * calendar day from a server reading of one.
 */
const BRANCH_TIMEZONE = 'Asia/Amman';

const REPORT_CODE = 'invoice_payment_summary';

const REPORT_READ = 'rpt.report.read';
/** The code the whole report is refused without. */
const FINANCE_VIEW = 'sal.finance.view';
/** Widens RLS reach without widening authority. Deliberately not a finance code. */
const REACH_ONLY = 'org.tenant.read';
/**
 * The CRM read the party NAME is gated on.
 *
 * It is NOT on the dataset's `requiredPermissions`, deliberately: the Owner asked
 * for the PERMITTED name, so the enrichment narrows for a caller who lacks this
 * code instead of refusing a finance report to them.
 */
const CUSTOMER_READ = 'crm.customer.read';

/** Two currencies whose totals must never meet. `JOD` has three minor units. */
const USD = 'USD';
const JOD = 'JOD';

const PAYMENT_METHOD_S = 'f1340000-0000-4000-8000-0000000000d1';

// ---- The period, and the instants that decide it ----------------------------

/** First day INCLUDED, in `BRANCH_TIMEZONE`. */
const FROM = '2027-06-14';
/** First day EXCLUDED — the day after the last one reported. */
const TO = '2027-06-16';

/*
 * The bounds are READ BACK from the database rather than written down here.
 *
 * The zone offset is a property of the deployed tzdata, not of this file. Hard
 * coding the UTC instants would make the suite assert the tzdata instead of the
 * query, and would fail it on a database that is correct.
 */
let periodOpens = '';
let periodCloses = '';
/** Local 12:00 on the first included day. */
let middle = '';

const shift = (iso: string, milliseconds: number): string =>
  new Date(new Date(iso).getTime() + milliseconds).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// ---- Principals -------------------------------------------------------------

/** Both codes. The dataset declares one; the operation declares the other. */
const FIN_RPT_FULL: Principal = {
  roleId: 'f1340000-0000-4000-8000-000000000101',
  userId: 'f1340000-0000-4000-8000-000000000102',
  subject: 'fx_p1_31_sal_full',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, FINANCE_VIEW],
};

/**
 * Both codes AND the CRM read: the only principal entitled to a party NAME.
 *
 * `crm.customer.read` is not a report permission and is not declared by the
 * dataset. It decides one cell.
 */
const FIN_RPT_CRM: Principal = {
  roleId: 'f1340000-0000-4000-8000-000000000161',
  userId: 'f1340000-0000-4000-8000-000000000162',
  subject: 'fx_p1_31_sal_crm',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, FINANCE_VIEW, CUSTOMER_READ],
};

/** May run reports; may not see money. Refused by the SERVICE. */
const RPT_ONLY: Principal = {
  roleId: 'f1340000-0000-4000-8000-000000000111',
  userId: 'f1340000-0000-4000-8000-000000000112',
  subject: 'fx_p1_31_sal_rpt_only',
  tenantId: TENANT_A,
  permissions: [REPORT_READ],
};

/** May see money; may not run reports. Refused by the ROUTE. */
const FINANCE_ONLY: Principal = {
  roleId: 'f1340000-0000-4000-8000-000000000121',
  userId: 'f1340000-0000-4000-8000-000000000122',
  subject: 'fx_p1_31_sal_fin_only',
  tenantId: TENANT_A,
  permissions: [FINANCE_VIEW],
};

/**
 * Both codes, granted ONLY in `BRANCH_S2`, with `BRANCH_S1` inside its
 * permission-blind branch union through the reach role below.
 *
 * The decisive isolation principal: `BRANCH_S1`'s documents ARE visible to RLS for
 * this caller, so the only thing that can refuse a `BRANCH_S1` report is the
 * scoped permission evaluation (P1-18-A-01).
 */
const FIN_SCOPED_S2: Principal = {
  roleId: 'f1340000-0000-4000-8000-000000000131',
  userId: 'f1340000-0000-4000-8000-000000000132',
  subject: 'fx_p1_31_sal_scoped_s2',
  tenantId: TENANT_A,
  permissions: [REPORT_READ, FINANCE_VIEW],
  scope: { companyId: COMPANY_S, branchId: BRANCH_S2 },
  grantId: 'f1340000-0000-4000-8000-0000000001f1',
};

/** Tenant B, unrestricted in its OWN tenant. A refusal is tenancy, not authority. */
const FIN_TENANT_B: Principal = {
  roleId: 'f1340000-0000-4000-8000-000000000141',
  userId: 'f1340000-0000-4000-8000-000000000142',
  subject: 'fx_p1_31_sal_tenant_b',
  tenantId: TENANT_B,
  permissions: [REPORT_READ, FINANCE_VIEW],
};

const PRINCIPALS: readonly Principal[] = [
  FIN_RPT_FULL,
  FIN_RPT_CRM,
  RPT_ONLY,
  FINANCE_ONLY,
  FIN_SCOPED_S2,
  FIN_TENANT_B,
];

const REACH_ROLE = 'f1340000-0000-4000-8000-000000000151';
const REACH_GRANT = 'f1340000-0000-4000-8000-000000000152';

/**
 * The APPROVER of every dual-control decision below.
 *
 * `sal.stamp_dual_control_maker` stamps the requester from the session, and
 * `ck_credit_notes_approved_distinct` refuses an approver who is the requester —
 * so a credit note and a receipt reversal need two identities, and this is the
 * second one. It is a real `iam.user_accounts` row, created with the principals.
 */
const APPROVER = FIN_RPT_FULL.userId;

// ---- Response shapes --------------------------------------------------------

interface Cell {
  readonly key: string;
  readonly label: string | null;
  readonly value: string | null;
}
interface Column {
  readonly key: string;
  readonly kind: string;
  readonly drillThrough: string | null;
  readonly drillThroughByKind: {
    readonly discriminator: string;
    readonly templates: Record<string, string | null>;
  } | null;
}
interface Group {
  readonly key: Record<string, string | null>;
  readonly label: string | null;
  readonly measures: Record<string, string>;
}
interface RunBody {
  readonly reportCode: string;
  readonly titleKey: string;
  readonly scope: string;
  readonly period: { readonly from: string; readonly to: string; readonly timezone: string };
  readonly filters: { readonly companyId: string; readonly branchId: string };
  readonly branch: { readonly id: string; readonly name: string };
  readonly generatedAt: string;
  readonly freshness: string;
  readonly columns: readonly Column[];
  readonly groups: readonly Group[];
  readonly countsByState: readonly unknown[];
  readonly rows: {
    readonly items: readonly { readonly cells: readonly Cell[] }[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}
interface Problem {
  readonly code: string;
  readonly requiredPermissions?: readonly string[];
}

function run(query: Record<string, string>, reportCode = REPORT_CODE): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/reports/${reportCode}/rows`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return RUN(new Request(url), { params: Promise.resolve({ reportCode }) });
}

/** The default report: this suite's branch, over the whole period. */
function report(extra: Record<string, string> = {}): Promise<Response> {
  return run({ companyId: COMPANY_S, branchId: BRANCH_S1, from: FROM, to: TO, ...extra });
}

const body = async (response: Response): Promise<RunBody> => (await response.json()) as RunBody;

type Row = { readonly cells: readonly Cell[] };

function cellValue(row: Row, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.value ?? null;
}
function cellLabel(row: Row, key: string): string | null {
  return row.cells.find((entry) => entry.key === key)?.label ?? null;
}
function rowFor(view: RunBody, documentId: string): Row | undefined {
  return view.rows.items.find((item) => cellValue(item, 'document') === documentId);
}
function groupFor(view: RunBody, currency: string, documentType: string): Group | undefined {
  return view.groups.find(
    (entry) => entry.key.currency === currency && entry.key.documentType === documentType
  );
}

// ---- Fixture construction ---------------------------------------------------

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [
      principal.userId,
      principal.tenantId,
      IDENTITY_PROVIDER,
      principal.subject,
      principal.tenantId === TENANT_B ? USER_TENANT_B : USER_A,
    ]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    if (principal.scope === undefined) {
      await client.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
        [principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
    } else {
      await client.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes
           (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [
          principal.tenantId,
          principal.grantId,
          principal.scope.companyId,
          principal.scope.branchId,
          USER_A,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * An admin transaction carrying a tenant and an actor.
 *
 * The protected `sal` primitives read `iam.current_tenant_id()` and
 * `iam.current_user_id()` from exactly these settings, which is how a fixture
 * calls them as the platform does rather than by inserting around them.
 */
async function inTenantTransaction<T>(
  actorId: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [actorId, TENANT_A]
    );
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Restates ONE instant on ONE row, with triggers suspended for that statement.
 *
 * See the file header. `session_replication_role` is superuser-only and is set
 * LOCAL, so it lapses at COMMIT and no other statement in this suite runs under
 * it. The column list is a literal in each call site and never caller input.
 */
async function restateInstant(
  table: string,
  column: string,
  id: string,
  instant: string
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL session_replication_role = 'replica'`);
    const result = await client.query(
      `UPDATE ${table} SET ${column} = $2::timestamptz WHERE id = $1`,
      [id, instant]
    );
    if (result.rowCount !== 1) {
      throw new Error(`fixture restatement touched ${String(result.rowCount)} rows, not 1`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface SeededInvoice {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly gross: string;
}

/**
 * One invoice with one line, issued through `sal.issue_invoice` unless asked for
 * a draft, and then placed at a chosen instant.
 *
 * The gross is READ BACK from `sal.invoice_amounts` rather than computed here: it
 * is money, and the only correct arithmetic on money in this codebase is
 * PostgreSQL's.
 */
async function seedInvoice(input: {
  readonly branchId: string;
  readonly currency: string;
  readonly net: string;
  readonly tax: string;
  readonly issuedAt: string | null;
}): Promise<SeededInvoice> {
  const order = await createWorkOrder({ companyId: COMPANY_S, branchId: input.branchId });
  const seeded = await inTenantTransaction(USER_A, async (client) => {
    const invoice = await client.query<{ id: string }>(
      `INSERT INTO sal.invoices
         (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [TENANT_A, COMPANY_S, input.branchId, order.workOrderId, PARTNER_A, input.currency, USER_A]
    );
    const invoiceId = invoice.rows[0]?.id ?? '';
    const line = await client.query<{ id: string }>(
      `INSERT INTO sal.invoice_lines
         (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity,
          currency_code, created_by)
       VALUES ($1,$2,$3,$4,1,'service',1,$5,$6) RETURNING id`,
      [TENANT_A, COMPANY_S, input.branchId, invoiceId, input.currency, USER_A]
    );
    // The whole gross is the customer's share: no protected configuration
    // determines a warranty contribution at invoice time, so a non-zero
    // `warranty_pay_amount` here would be an invented business fact.
    await client.query(
      `INSERT INTO sal.invoice_line_amounts
         (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price,
          net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$6::numeric,$7::numeric,
               round($6::numeric + $7::numeric, 4), round($6::numeric + $7::numeric, 4),
               0, $8)`,
      [
        TENANT_A,
        COMPANY_S,
        input.branchId,
        line.rows[0]?.id ?? '',
        invoiceId,
        input.net,
        input.tax,
        USER_A,
      ]
    );
    const issued =
      input.issuedAt === null
        ? { rows: [{ n: '' }] }
        : await client.query<{ n: string }>(`SELECT sal.issue_invoice($1,NULL) AS n`, [invoiceId]);
    const totals = await client.query<{ gross_total: string }>(
      `SELECT gross_total::text AS gross_total FROM sal.invoice_amounts
        WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL`,
      [TENANT_A, invoiceId]
    );
    return {
      invoiceId,
      invoiceNumber: issued.rows[0]?.n ?? '',
      gross: totals.rows[0]?.gross_total ?? '',
    };
  });
  if (input.issuedAt !== null) {
    await restateInstant('sal.invoices', 'issued_at', seeded.invoiceId, input.issuedAt);
  }
  return seeded;
}

/** One receipt, recorded through `sal.record_receipt` and then placed. */
async function seedReceipt(input: {
  readonly branchId: string;
  readonly currency: string;
  readonly amount: string;
  readonly receivedAt: string;
}): Promise<string> {
  const receiptId = await inTenantTransaction(USER_A, async (client) => {
    const row = await client.query<{ id: string }>(
      `SELECT sal.record_receipt($1,$2,$3,$4,$5,$6::numeric,NULL,NULL,NULL) AS id`,
      [COMPANY_S, input.branchId, PAYMENT_METHOD_S, PARTNER_A, input.currency, input.amount]
    );
    return row.rows[0]?.id ?? '';
  });
  await restateInstant('sal.receipts', 'received_at', receiptId, input.receivedAt);
  return receiptId;
}

/** One allocation of a receipt to an invoice, through `sal.allocate_receipt`. */
async function seedAllocation(receiptId: string, invoiceId: string, amount: string): Promise<void> {
  await inTenantTransaction(USER_A, async (client) => {
    await client.query(`SELECT sal.allocate_receipt($1,$2,$3::numeric,NULL)`, [
      receiptId,
      invoiceId,
      amount,
    ]);
  });
}

/**
 * An APPROVED credit note against an invoice, placed at a chosen instant.
 *
 * Two identities, because dual control requires them: `USER_A` requests and
 * `APPROVER` approves.
 */
async function seedApprovedCreditNote(input: {
  readonly branchId: string;
  readonly invoiceId: string;
  readonly currency: string;
  readonly amount: string;
  readonly issuedAt: string;
}): Promise<string> {
  const creditId = await inTenantTransaction(USER_A, async (client) => {
    const row = await client.query<{ id: string }>(
      `INSERT INTO sal.credit_notes
         (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason,
          requested_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,'P1-31 report fixture credit',$7,$7)
       RETURNING id`,
      [TENANT_A, COMPANY_S, input.branchId, input.invoiceId, input.currency, input.amount, USER_A]
    );
    return row.rows[0]?.id ?? '';
  });
  await inTenantTransaction(APPROVER, async (client) => {
    await client.query(`SELECT sal.approve_credit_note($1,NULL)`, [creditId]);
  });
  await restateInstant('sal.credit_notes', 'issued_at', creditId, input.issuedAt);
  return creditId;
}

/** Flips a receipt to `reversed` through an approved reversal. */
async function seedReceiptReversal(input: {
  readonly branchId: string;
  readonly receiptId: string;
  readonly currency: string;
  readonly amount: string;
}): Promise<void> {
  const reversalId = await inTenantTransaction(USER_A, async (client) => {
    const row = await client.query<{ id: string }>(
      `INSERT INTO sal.receipt_reversals
         (tenant_id, company_id, branch_id, original_receipt_id, currency_code, amount, reason,
          requested_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,'P1-31 report fixture reversal',$7,$7)
       RETURNING id`,
      [TENANT_A, COMPANY_S, input.branchId, input.receiptId, input.currency, input.amount, USER_A]
    );
    return row.rows[0]?.id ?? '';
  });
  await inTenantTransaction(APPROVER, async (client) => {
    await client.query(`SELECT sal.approve_receipt_reversal($1,NULL)`, [reversalId]);
  });
}

/** `sal.invoice_open_receivable`, read as admin — the authority the report calls. */
async function openReceivableOf(invoiceId: string): Promise<string> {
  const row = await admin.query<{ amount: string }>(
    `SELECT round(sal.invoice_open_receivable($1), 4)::text AS amount`,
    [invoiceId]
  );
  return row.rows[0]?.amount ?? '';
}

/** `sal.receipt_unallocated`, read as admin — the OTHER authority the report calls. */
async function unallocatedOf(receiptId: string): Promise<string> {
  const row = await admin.query<{ amount: string }>(
    `SELECT sal.receipt_unallocated($1)::text AS amount`,
    [receiptId]
  );
  return row.rows[0]?.amount ?? '';
}

/** `sal.credit_notes.amount`, read as admin — the authoritative credit column. */
async function creditNoteAmountOf(creditId: string): Promise<string> {
  const row = await admin.query<{ amount: string }>(
    `SELECT amount::text AS amount FROM sal.credit_notes WHERE id = $1`,
    [creditId]
  );
  return row.rows[0]?.amount ?? '';
}

// ---- The selection ----------------------------------------------------------

let invoiceUsd: SeededInvoice;
let invoiceCredited: SeededInvoice;
let invoiceJod: SeededInvoice;
let invoiceBeforeOpen: SeededInvoice;
let invoiceAtClose: SeededInvoice;
let invoiceDraft: SeededInvoice;
let invoiceOtherBranch: SeededInvoice;
let receiptUsd = '';
let receiptLastSecond = '';
let receiptJod = '';
let receiptReversed = '';
let receiptOtherBranch = '';
let creditNoteId = '';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  // BEFORE the shared cleanup, and for the reason `cleanFinanceFixtures` states:
  // an issued invoice left behind by any earlier run would make the shared
  // per-statement cleanup trip the deferred reconciliation guard.
  await cleanFinanceFixtures();
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);

  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p1_31_sal','P1-31 Finance Reporting Company','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_S, TENANT_A, USER_A]
  );
  for (const [id, code, name] of [
    [BRANCH_S1, 'fx_p1_31_sal_b1', 'P1-31 Finance Reported Branch'],
    [BRANCH_S2, 'fx_p1_31_sal_b2', 'P1-31 Finance Sibling Branch'],
  ]) {
    await admin.query(
      `INSERT INTO org.branches
         (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, COMPANY_S, code, name, BRANCH_TIMEZONE, USER_A]
    );
  }

  // `shared.next_display_number` matches the scope EXACTLY and has no fallback,
  // so an invoice or a receipt in these branches needs its own sequence row.
  // Runtime holds no INSERT grant on this table, so nothing can self-heal it.
  for (const branchId of [BRANCH_S1, BRANCH_S2]) {
    await admin.query(
      `INSERT INTO shared.number_sequences
         (tenant_id, company_id, branch_id, sequence_code, prefix_template, next_value,
          pad_width, period_reset_rule, created_by)
       VALUES ($1,$2,$3,'invoice','FX31INV-',1,6,'never',$4),
              ($1,$2,$3,'receipt','FX31RCT-',1,6,'never',$4)
       ON CONFLICT (tenant_id, sequence_code, company_id, branch_id) DO NOTHING`,
      [TENANT_A, COMPANY_S, branchId, USER_A]
    );
  }

  await admin.query(
    `INSERT INTO sal.payment_methods
       (id, scope, tenant_id, method_code, kind, display_name, status, created_by)
     VALUES ($1,'tenant',$2,'fx_p131_cash','cash','P1-31 Cash','active',$3)
     ON CONFLICT (id) DO NOTHING`,
    [PAYMENT_METHOD_S, TENANT_A, USER_A]
  );

  for (const principal of PRINCIPALS) await seedPrincipal(principal);

  // The reach role: an unrelated permission scoped to BRANCH_S1, so S1 is inside
  // FIN_SCOPED_S2's permission-blind branch union with no report or finance
  // authority there. Without it the isolation case would pass because RLS
  // returned nothing, which proves the wrong control.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_31_sal_reach','P1-31 finance reach only',$3)
     ON CONFLICT (id) DO NOTHING`,
    [REACH_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, REACH_ROLE, USER_A, REACH_ONLY]
  );
  const reach = await admin.connect();
  try {
    await reach.query('BEGIN');
    await reach.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [REACH_GRANT, TENANT_A, FIN_SCOPED_S2.userId, REACH_ROLE, USER_A]
    );
    await reach.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [TENANT_A, REACH_GRANT, COMPANY_S, BRANCH_S1, USER_A]
    );
    await reach.query('COMMIT');
  } catch (error) {
    await reach.query('ROLLBACK');
    throw error;
  } finally {
    reach.release();
  }

  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  const bounds = await admin.query<{ opens: Date; closes: Date }>(
    `SELECT (($1::date)::timestamp AT TIME ZONE $3) AS opens,
            (($2::date)::timestamp AT TIME ZONE $3) AS closes`,
    [FROM, TO, BRANCH_TIMEZONE]
  );
  periodOpens = (bounds.rows[0]?.opens ?? new Date(0)).toISOString();
  periodCloses = (bounds.rows[0]?.closes ?? new Date(0)).toISOString();
  middle = shift(periodOpens, 12 * HOUR);

  // An issued USD invoice at the FIRST INCLUDED INSTANT — local midnight on the
  // first reported day. 150.0000 + 15.0000 tax = 165.0000 gross.
  invoiceUsd = await seedInvoice({
    branchId: BRANCH_S1,
    currency: USD,
    net: '150.0000',
    tax: '15.0000',
    issuedAt: periodOpens,
  });

  // A second USD invoice, fully credited. 40.0000 gross, credited by an approved
  // 40.0000 credit note, then advanced to `credited` — the transition
  // `sal.guard_invoice_freeze` permits from `issued` and nothing else.
  invoiceCredited = await seedInvoice({
    branchId: BRANCH_S1,
    currency: USD,
    net: '40.0000',
    tax: '0.0000',
    issuedAt: shift(middle, -2 * HOUR),
  });
  creditNoteId = await seedApprovedCreditNote({
    branchId: BRANCH_S1,
    invoiceId: invoiceCredited.invoiceId,
    currency: USD,
    amount: '40.0000',
    issuedAt: shift(middle, -1 * HOUR),
  });
  await inTenantTransaction(USER_A, async (client) => {
    await client.query(`UPDATE sal.invoices SET status = 'credited' WHERE id = $1`, [
      invoiceCredited.invoiceId,
    ]);
  });

  // A JOD invoice, so that no measure may span two currencies. Same instant as
  // the USD receipt below: the tie is deliberate and the paging case reads it.
  invoiceJod = await seedInvoice({
    branchId: BRANCH_S1,
    currency: JOD,
    net: '100.0000',
    tax: '0.0000',
    issuedAt: middle,
  });

  // A USD receipt of 65.0000, allocated in full to the 165.0000 invoice: a
  // PARTIAL allocation of that invoice, which leaves 100.0000 outstanding.
  receiptUsd = await seedReceipt({
    branchId: BRANCH_S1,
    currency: USD,
    amount: '65.0000',
    receivedAt: middle,
  });
  await seedAllocation(receiptUsd, invoiceUsd.invoiceId, '65.0000');
  // The allocation's own instant does not decide the period — the RECEIPT's does
  // — but it is restated too so nothing in the fixture sits at wall-clock `now()`.
  await admin
    .query(`SELECT id FROM sal.payment_allocations WHERE receipt_id = $1`, [receiptUsd])
    .then(async (result) => {
      for (const row of result.rows as { id: string }[]) {
        await restateInstant('sal.payment_allocations', 'allocated_at', row.id, middle);
      }
    });

  // A JOD receipt, never allocated: its allocated column must read an exact zero.
  receiptJod = await seedReceipt({
    branchId: BRANCH_S1,
    currency: JOD,
    amount: '30.0000',
    receivedAt: shift(middle, HOUR),
  });

  // A USD receipt at the LAST INCLUDED INSTANT — one second before the excluded
  // day's local midnight — of which only PART has been applied. It is the third
  // allocation state the report has to tell apart: `receiptUsd` is applied in
  // full, `receiptJod` not at all, and this one in between. Its unallocated
  // figure is the one `sal.receipt_unallocated` is compared against.
  receiptLastSecond = await seedReceipt({
    branchId: BRANCH_S1,
    currency: USD,
    amount: '10.0000',
    receivedAt: shift(periodCloses, -SECOND),
  });
  await seedAllocation(receiptLastSecond, invoiceUsd.invoiceId, '4.0000');
  await admin
    .query(`SELECT id FROM sal.payment_allocations WHERE receipt_id = $1`, [receiptLastSecond])
    .then(async (result) => {
      for (const row of result.rows as { id: string }[]) {
        await restateInstant(
          'sal.payment_allocations',
          'allocated_at',
          row.id,
          shift(periodCloses, -SECOND)
        );
      }
    });

  // A reversed receipt: a receipt that did not happen.
  receiptReversed = await seedReceipt({
    branchId: BRANCH_S1,
    currency: USD,
    amount: '25.0000',
    receivedAt: shift(middle, 2 * HOUR),
  });
  await seedReceiptReversal({
    branchId: BRANCH_S1,
    receiptId: receiptReversed,
    currency: USD,
    amount: '25.0000',
  });

  // ONE SECOND before the period opens. Out.
  invoiceBeforeOpen = await seedInvoice({
    branchId: BRANCH_S1,
    currency: USD,
    net: '500.0000',
    tax: '0.0000',
    issuedAt: shift(periodOpens, -SECOND),
  });

  // The EXCLUDED day's local midnight exactly. Out — the period is half-open.
  invoiceAtClose = await seedInvoice({
    branchId: BRANCH_S1,
    currency: USD,
    net: '700.0000',
    tax: '0.0000',
    issuedAt: periodCloses,
  });

  // A DRAFT: real money, no issue. It happened in no period.
  invoiceDraft = await seedInvoice({
    branchId: BRANCH_S1,
    currency: USD,
    net: '900.0000',
    tax: '0.0000',
    issuedAt: null,
  });

  // The sibling branch, inside the period.
  invoiceOtherBranch = await seedInvoice({
    branchId: BRANCH_S2,
    currency: USD,
    net: '300.0000',
    tax: '0.0000',
    issuedAt: middle,
  });
  receiptOtherBranch = await seedReceipt({
    branchId: BRANCH_S2,
    currency: USD,
    amount: '80.0000',
    receivedAt: middle,
  });

  __resetAuthenticatorForTests();
}, 300_000);

afterEach(() => __resetAuthenticatorForTests());

/**
 * The financial rows, removed in ONE transaction before the shared cleanup.
 *
 * `sal.guard_invoice_totals_reconcile` is a DEFERRED constraint trigger: it fires
 * at COMMIT and returns early when the invoice is already gone. The shared
 * `cleanBackendFixtures` deletes each table in its own statement, so an ISSUED
 * invoice's header amounts outlive its lines for one commit and the guard —
 * correctly — refuses. Inside one transaction the whole invoice disappears
 * together and there is nothing left to reconcile. The order is the shared
 * helper's own; only the transaction is added.
 */
async function cleanFinanceFixtures(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    for (const table of [
      'sal.financial_events',
      'sal.payment_allocations',
      'sal.receipt_reversals',
      'sal.credit_notes',
      'sal.receipts',
      'sal.invoice_status_history',
      'sal.invoice_line_amounts',
      'sal.invoice_lines',
      'sal.invoice_amounts',
      'sal.invoice_numbering_configs',
      'sal.invoices',
      'sal.payment_methods',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [
        [TENANT_A, TENANT_B],
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanFinanceFixtures();
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------

describe('the dataset is registered as the Owner approved it', () => {
  it('declares sal.finance.view, a branch scope and the half-open period parameters', () => {
    expect([...REPORT_DATASETS.invoice_payment_summary.requiredPermissions]).toEqual([
      FINANCE_VIEW,
    ]);
    expect(REPORT_DATASETS.invoice_payment_summary.scope).toBe('branch');
    expect(REPORT_DATASETS.invoice_payment_summary.parameterSchema.map((p) => p.name)).toEqual([
      'from',
      'to',
    ]);
    expect(REPORT_DATASETS.invoice_payment_summary.parameterSchema.every((p) => p.required)).toBe(
      true
    );
  });

  it('registers exactly the four datasets the engine implements', () => {
    // Non-vacuity for the whole slice: a registry that had quietly emptied would
    // make every assertion below pass for the wrong reason. The list is exact,
    // so a fifth code cannot arrive without a deliberate edit here.
    expect([...REPORT_DATASET_CODES]).toEqual([
      'work_orders_by_status',
      'technician_labor_time',
      'inventory_movements',
      'invoice_payment_summary',
    ]);
  });

  it('publishes the Owner’s columns, in order, with the money columns named as money', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    expect(view.columns.map((column) => column.key)).toEqual([
      'document',
      'documentType',
      'documentDate',
      'branch',
      'partyId',
      'partyName',
      'partyRole',
      'currency',
      'invoicedAmount',
      'receiptAmount',
      'allocatedAmount',
      'unallocatedAmount',
      'creditNoteAmount',
      'outstanding',
      'status',
    ]);
    expect(
      view.columns.filter((column) => column.kind === 'money').map((column) => column.key)
    ).toEqual([
      'invoicedAmount',
      'receiptAmount',
      'allocatedAmount',
      'unallocatedAmount',
      'creditNoteAmount',
      'outstanding',
    ]);
    expect(view.columns.find((column) => column.key === 'document')?.kind).toBe('reference');
    expect(view.columns.find((column) => column.key === 'partyId')?.kind).toBe('reference');
    expect(view.columns.find((column) => column.key === 'documentDate')?.kind).toBe('date');
    // There is no COLUMN-WIDE drill-through, because the route depends on the
    // row: the `document` column publishes one template per document kind
    // instead, and every other column publishes neither.
    expect(view.columns.every((column) => column.drillThrough === null)).toBe(true);
    expect(
      view.columns
        .filter((column) => column.key !== 'document')
        .every((column) => column.drillThroughByKind === null)
    ).toBe(true);
  });

  it('resolves the document drill-through per KIND, and publishes no route for a credit note', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const document = view.columns.find((column) => column.key === 'document');
    expect(document?.drillThroughByKind?.discriminator).toBe('documentType');
    // Two authorized target routes that already exist — `sal.invoice-detail` and
    // `sal.receipt-detail` — and an explicit NULL for the kind that has none.
    expect(document?.drillThroughByKind?.templates).toEqual({
      invoice: '/invoices/{id}',
      receipt: '/payments/{id}',
      credit_note: null,
    });
    // The absence is a measured fact about the operation register, not a
    // rendering choice: nothing reads a credit note, so there is nothing to open.
    // The discriminator names a column this report actually publishes, so a
    // client can choose the template from the cell beside the id.
    expect(view.columns.map((column) => column.key)).toContain(
      document?.drillThroughByKind?.discriminator
    );
    // Every kind a row can carry is a key in the map, so a client is never left
    // guessing which of the three it is looking at.
    const kinds = new Set(view.rows.items.map((item) => cellValue(item, 'documentType')));
    expect([...kinds].sort()).toEqual(['credit_note', 'invoice', 'receipt']);
    for (const kind of kinds) {
      expect(Object.keys(document?.drillThroughByKind?.templates ?? {})).toContain(kind);
    }
  });

  it('echoes the period, the zone and the filter context, and calls itself live', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    expect(view.reportCode).toBe(REPORT_CODE);
    expect(view.period).toEqual({ from: FROM, to: TO, timezone: BRANCH_TIMEZONE });
    expect(view.filters).toEqual({ companyId: COMPANY_S, branchId: BRANCH_S1 });
    expect(view.branch).toEqual({ id: BRANCH_S1, name: 'P1-31 Finance Reported Branch' });
    expect(view.freshness).toBe('live');
    // The deprecated field belongs to one dataset and is empty for every other.
    // Filling it here would be inventing a grouping this report does not have.
    expect(view.countsByState).toEqual([]);
  });
});

describe('the whole report is refused without sal.finance.view, and no figure leaks', () => {
  it('refuses a caller holding rpt.report.read alone, naming the code and no amount', async () => {
    authAs(RPT_ONLY);
    const response = await report();
    expect(response.status).toBe(403);
    const text = await response.text();
    const problem = JSON.parse(text) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual([FINANCE_VIEW]);
    // The refusal is a refusal, not a report with the money blanked: no amount,
    // and — the specific defect D-4 names — no ZERO standing in for one.
    expect(text).not.toContain('165.0000');
    expect(text).not.toContain('0.0000');
    expect(text).not.toContain('groups');
    expect(text).not.toContain('rows');
  });

  it('refuses a caller holding sal.finance.view alone, at the ROUTE, naming the report code', async () => {
    authAs(FINANCE_ONLY);
    const response = await report();
    expect(response.status).toBe(403);
    const problem = (await response.json()) as Problem;
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual([REPORT_READ]);
  });

  it('refuses another tenant outright', async () => {
    authAs(FIN_TENANT_B);
    const response = await report();
    expect(response.status).toBe(403);
    expect(((await response.json()) as Problem).code).toBe('ERR-IAM-001');
  });
});

describe('the rows are the documents of the period, and only those', () => {
  it('publishes the invoice with its number, its payer, its gross and the function’s outstanding', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const row = rowFor(view, invoiceUsd.invoiceId);
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(cellLabel(row, 'document')).toBe(invoiceUsd.invoiceNumber);
    expect(cellValue(row, 'documentType')).toBe('invoice');
    expect(cellValue(row, 'documentDate')).toBe(periodOpens);
    expect(cellValue(row, 'branch')).toBe(BRANCH_S1);
    expect(cellLabel(row, 'branch')).toBe('P1-31 Finance Reported Branch');
    expect(cellValue(row, 'partyId')).toBe(PARTNER_A);
    // The party is published under the role it is actually held in. An invoice
    // names its PAYER, which is not the same claim as "customer".
    expect(cellValue(row, 'partyRole')).toBe('payer');
    // This caller does not hold `crm.customer.read`, so the name is withheld and
    // the id still travels. The entitled caller's case is below.
    expect(cellValue(row, 'partyName')).toBeNull();
    expect(cellValue(row, 'currency')).toBe(USD);
    expect(cellValue(row, 'invoicedAmount')).toBe('165.0000');
    expect(cellValue(row, 'status')).toBe('issued');
    // NULL, not zero: an invoice is not a receipt and has applied nothing, and it
    // is not a credit note either.
    expect(cellValue(row, 'receiptAmount')).toBeNull();
    expect(cellValue(row, 'allocatedAmount')).toBeNull();
    expect(cellValue(row, 'unallocatedAmount')).toBeNull();
    expect(cellValue(row, 'creditNoteAmount')).toBeNull();
    // 165.0000 less the 65.0000 and the 4.0000 allocated — and it is the DATABASE
    // FUNCTION's answer, compared against the function itself rather than against
    // a number written here.
    expect(cellValue(row, 'outstanding')).toBe('96.0000');
    expect(cellValue(row, 'outstanding')).toBe(await openReceivableOf(invoiceUsd.invoiceId));
  });

  it('names the party only for a caller holding the CRM read, and never drops the id', async () => {
    authAs(FIN_RPT_CRM);
    const named = await body(await report());
    const namedRow = named.rows.items.find(
      (item) => cellValue(item, 'document') === invoiceUsd.invoiceId
    );
    expect(namedRow).toBeDefined();
    if (namedRow === undefined) return;
    expect(cellValue(namedRow, 'partyId')).toBe(PARTNER_A);
    expect(cellValue(namedRow, 'partyName')).toBe('Reception Requester');
    expect(cellValue(namedRow, 'partyRole')).toBe('payer');

    // The SAME report, to a caller who holds both report codes and NOT
    // `crm.customer.read`: every id is still there and no name is. The gate is
    // the CRM read itself, so the enrichment can only narrow — the dataset's
    // declared permission list is untouched and no caller gains anything.
    authAs(FIN_RPT_FULL);
    const plain = await body(await report());
    expect(plain.rows.items.length).toBe(named.rows.items.length);
    expect(plain.rows.items.every((item) => cellValue(item, 'partyId') !== null)).toBe(true);
    expect(plain.rows.items.every((item) => cellValue(item, 'partyName') === null)).toBe(true);
    expect(JSON.stringify(plain)).not.toContain('Reception Requester');
    // And the permission list the report declares is unchanged by any of it.
    expect([...REPORT_DATASETS.invoice_payment_summary.requiredPermissions]).toEqual([
      FINANCE_VIEW,
    ]);
  });

  it('names a receipt party as the PAYER and a credit note party as the invoice payer', async () => {
    authAs(FIN_RPT_CRM);
    const view = await body(await report());
    const receipt = rowFor(view, receiptUsd);
    const credit = rowFor(view, creditNoteId);
    expect(receipt).toBeDefined();
    expect(credit).toBeDefined();
    if (receipt === undefined || credit === undefined) return;
    // A receipt names who PAID. That party is not necessarily the customer the
    // work was done for, and the report must not present the one as the other.
    expect(cellValue(receipt, 'partyRole')).toBe('payer');
    expect(cellValue(receipt, 'partyId')).toBe(PARTNER_A);
    expect(cellValue(receipt, 'partyName')).toBe('Reception Requester');
    // `sal.credit_notes` carries NO party column, so the id is the credited
    // invoice's payer and the role says exactly that rather than claiming the
    // note names a party of its own.
    expect(cellValue(credit, 'partyRole')).toBe('invoice_payer');
    expect(cellValue(credit, 'partyId')).toBe(PARTNER_A);
    // The name is enriched by DOCUMENT PARTY and not by document kind, so an
    // entitled reader sees it on the credit note too — under `invoice_payer`,
    // which is the whole point: the name and the role travel together, and a
    // reader who is told the name is never left to guess what it is the name OF.
    expect(cellValue(credit, 'partyName')).toBe('Reception Requester');
  });

  it('publishes the receipt with what it has applied, as a column of its own', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const row = rowFor(view, receiptUsd);
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(cellValue(row, 'documentType')).toBe('receipt');
    expect(cellValue(row, 'receiptAmount')).toBe('65.0000');
    expect(cellValue(row, 'allocatedAmount')).toBe('65.0000');
    expect(cellValue(row, 'invoicedAmount')).toBeNull();
    expect(cellValue(row, 'creditNoteAmount')).toBeNull();
    // Applied in full, so an EXACT ZERO is left — and it is the function's zero,
    // compared against the function itself.
    expect(cellValue(row, 'unallocatedAmount')).toBe('0.0000');
    expect(cellValue(row, 'unallocatedAmount')).toBe(await unallocatedOf(receiptUsd));
    // A receipt has no outstanding balance of its own, and a zero here would read
    // as one that had been settled.
    expect(cellValue(row, 'outstanding')).toBeNull();
    expect(cellValue(row, 'status')).toBe('allocated');

    const unallocated = rowFor(view, receiptJod);
    expect(unallocated).toBeDefined();
    if (unallocated === undefined) return;
    // An EXACT ZERO, because nothing was applied — which is a different fact from
    // the invoice's absent allocation column above.
    expect(cellValue(unallocated, 'allocatedAmount')).toBe('0.0000');
    expect(cellValue(unallocated, 'unallocatedAmount')).toBe('30.0000');
    expect(cellValue(unallocated, 'status')).toBe('recorded');
  });

  it('publishes what a PARTIALLY applied receipt has left, from the authority and not a subtraction', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const row = rowFor(view, receiptLastSecond);
    expect(row).toBeDefined();
    if (row === undefined) return;
    // 10.0000 received, 4.0000 applied, 6.0000 left — and the published figure is
    // compared against `sal.receipt_unallocated` ITSELF rather than against a
    // number written here or a difference computed here. The three states the
    // report must tell apart are now all present: applied in full, applied in
    // part, and not applied at all.
    expect(cellValue(row, 'receiptAmount')).toBe('10.0000');
    expect(cellValue(row, 'allocatedAmount')).toBe('4.0000');
    expect(cellValue(row, 'unallocatedAmount')).toBe('6.0000');
    expect(cellValue(row, 'unallocatedAmount')).toBe(await unallocatedOf(receiptLastSecond));
    expect(cellValue(row, 'status')).toBe('partially_allocated');
  });

  it('shows a credited invoice as credited, and the approved credit note as its own document', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const invoice = rowFor(view, invoiceCredited.invoiceId);
    expect(invoice).toBeDefined();
    if (invoice === undefined) return;
    // Neither paid nor outstanding: the status carries the fact, and the function
    // — which counts approved credits — reports nothing left open.
    expect(cellValue(invoice, 'status')).toBe('credited');
    expect(cellValue(invoice, 'invoicedAmount')).toBe('40.0000');
    // The credit is NOT restated on the invoice row: the function has already
    // subtracted it inside `outstanding`, and a second subtraction here would be
    // the arithmetic the Owner's answer forbids.
    expect(cellValue(invoice, 'creditNoteAmount')).toBeNull();
    expect(cellValue(invoice, 'outstanding')).toBe('0.0000');
    expect(cellValue(invoice, 'outstanding')).toBe(
      await openReceivableOf(invoiceCredited.invoiceId)
    );

    const credit = rowFor(view, creditNoteId);
    expect(credit).toBeDefined();
    if (credit === undefined) return;
    expect(cellValue(credit, 'documentType')).toBe('credit_note');
    expect(cellValue(credit, 'status')).toBe('approved');
    expect(cellValue(credit, 'currency')).toBe(USD);
    // A credit note has no number, so the label is absent while the id never is.
    expect(cellLabel(credit, 'document')).toBeNull();
    // The AUTHORITATIVE column, `sal.credit_notes.amount`, compared against the
    // table itself rather than against a number written here.
    expect(cellValue(credit, 'creditNoteAmount')).toBe('40.0000');
    expect(cellValue(credit, 'creditNoteAmount')).toBe(await creditNoteAmountOf(creditNoteId));
    // Every other money column is null rather than zero: a credit note is not an
    // invoice and not a receipt, and a zero would be a claim about money.
    for (const key of [
      'invoicedAmount',
      'receiptAmount',
      'allocatedAmount',
      'unallocatedAmount',
      'outstanding',
    ]) {
      expect(cellValue(credit, key)).toBeNull();
    }
  });

  it('excludes a reversed receipt, a draft invoice and the sibling branch’s documents', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const present = view.rows.items.map((item) => cellValue(item, 'document'));
    // A reversed receipt is a receipt that did not happen (D-4 rule 3).
    expect(present).not.toContain(receiptReversed);
    // A draft was never issued, so it happened in no period at all.
    expect(present).not.toContain(invoiceDraft.invoiceId);
    expect(present).not.toContain(invoiceOtherBranch.invoiceId);
    expect(present).not.toContain(receiptOtherBranch);
    // Non-vacuity: the excluded rows exist and carry real money.
    expect(await openReceivableOf(invoiceOtherBranch.invoiceId)).toBe('300.0000');
    const reversed = await admin.query<{ status: string }>(
      `SELECT status FROM sal.receipts WHERE id = $1`,
      [receiptReversed]
    );
    expect(reversed.rows[0]?.status).toBe('reversed');
  });

  it('holds exactly the seven documents of the period', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    expect([...view.rows.items.map((item) => cellValue(item, 'document'))].sort()).toEqual(
      [
        invoiceUsd.invoiceId,
        invoiceCredited.invoiceId,
        invoiceJod.invoiceId,
        creditNoteId,
        receiptUsd,
        receiptJod,
        receiptLastSecond,
      ].sort()
    );
    expect(view.rows.hasMore).toBe(false);
    expect(view.rows.nextCursor).toBeNull();
  });
});

describe('the period is half-open in the branch’s own timezone', () => {
  it('includes the first instant of the first day and excludes the second before it', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const present = view.rows.items.map((item) => cellValue(item, 'document'));
    expect(present).toContain(invoiceUsd.invoiceId);
    expect(present).not.toContain(invoiceBeforeOpen.invoiceId);
    // And the excluded invoice's 500.0000 is in no total either.
    expect(groupFor(view, USD, 'invoice')?.measures.invoiced).toBe('205.0000');
  });

  it('includes the last second of the last day and excludes the excluded day’s midnight', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const present = view.rows.items.map((item) => cellValue(item, 'document'));
    expect(present).toContain(receiptLastSecond);
    expect(present).not.toContain(invoiceAtClose.invoiceId);
  });

  it('moves the two excluded documents INTO a period that reaches them', async () => {
    // Non-vacuity for both boundary cases: the same rows, both present, once the
    // period is widened by a day at each end. If they were absent for any other
    // reason the two cases above would be proving nothing.
    authAs(FIN_RPT_FULL);
    const view = await body(await report({ from: '2027-06-13', to: '2027-06-17' }));
    const present = view.rows.items.map((item) => cellValue(item, 'document'));
    expect(present).toContain(invoiceBeforeOpen.invoiceId);
    expect(present).toContain(invoiceAtClose.invoiceId);
  });

  it('reads the day in the BRANCH’s zone, not the server’s', async () => {
    // `periodOpens` is local midnight in Asia/Amman, which is 21:00 UTC on the
    // PREVIOUS day. A report whose period was resolved in UTC would place that
    // invoice on 2027-06-13 and drop it from this one.
    expect(periodOpens.slice(0, 10)).toBe('2027-06-13');
    authAs(FIN_RPT_FULL);
    const view = await body(await report({ from: FROM, to: '2027-06-15' }));
    expect(view.rows.items.map((item) => cellValue(item, 'document'))).toContain(
      invoiceUsd.invoiceId
    );
  });
});

describe('the totals are per currency and per document type, and never meet', () => {
  it('keys every group on a currency and a document type', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    expect(view.groups.map((group) => [group.key.currency, group.key.documentType])).toEqual([
      [JOD, 'invoice'],
      [JOD, 'receipt'],
      // The approved credit notes are a group of their own, keyed on their own
      // document type: netting them into the invoice group would restate money
      // the database function has already subtracted inside `outstanding`.
      [USD, 'credit_note'],
      [USD, 'invoice'],
      [USD, 'receipt'],
    ]);
    expect(view.groups.every((group) => group.label === group.key.currency)).toBe(true);
  });

  it('totals the invoices and the receipts of each currency separately', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    // 165.0000 + 40.0000 issued in USD; 96.0000 + 0.0000 still open.
    expect(groupFor(view, USD, 'invoice')?.measures).toEqual({
      invoiced: '205.0000',
      outstanding: '96.0000',
    });
    // 65.0000 + 10.0000 received in USD, of which 69.0000 has been applied and
    // 6.0000 has not.
    expect(groupFor(view, USD, 'receipt')?.measures).toEqual({
      receipts: '75.0000',
      allocated: '69.0000',
      unallocated: '6.0000',
    });
    // The approved credit notes of the period, in their own group and in their
    // own currency. ONE measure, because a credit note is neither an invoice nor
    // a receipt and publishing the others at zero would claim it was.
    expect(groupFor(view, USD, 'credit_note')?.measures).toEqual({ creditNotes: '40.0000' });
    expect(groupFor(view, JOD, 'invoice')?.measures).toEqual({
      invoiced: '100.0000',
      outstanding: '100.0000',
    });
    expect(groupFor(view, JOD, 'receipt')?.measures).toEqual({
      receipts: '30.0000',
      allocated: '0.0000',
      unallocated: '30.0000',
    });
    // No credit note was issued in JOD, so there is no JOD credit-note group at
    // all — an absent group rather than a zero, which would read as a fact.
    expect(groupFor(view, JOD, 'credit_note')).toBeUndefined();
  });

  it('never nets a credit note into the invoice group, and never states it twice', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const invoices = groupFor(view, USD, 'invoice');
    const credits = groupFor(view, USD, 'credit_note');
    expect(invoices).toBeDefined();
    expect(credits).toBeDefined();
    if (invoices === undefined || credits === undefined) return;
    // The 40.0000 credited is published ONCE, in its own group, and reaches the
    // invoice group only as a REDUCTION inside `outstanding` — which the database
    // function computed. The invoice group carries no credit measure, so the two
    // cannot be added together by mistake, and `invoiced` is still the gross that
    // was issued rather than a gross with the credit already taken off.
    expect(credits.measures.creditNotes).toBe('40.0000');
    expect(invoices.measures.creditNotes).toBeUndefined();
    expect(invoices.measures.invoiced).toBe('205.0000');
    expect(credits.measures.invoiced).toBeUndefined();
    expect(credits.measures.outstanding).toBeUndefined();
  });

  it('publishes no measure that spans two currencies and no grand total', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    // Every group names exactly one currency, and 305.0000 — the sum of the two
    // currencies' invoices — appears nowhere, because there is no rate anywhere
    // in this platform and inventing one would be inventing a figure.
    expect(view.groups.every((group) => group.key.currency !== null)).toBe(true);
    expect(JSON.stringify(view.groups)).not.toContain('305.0000');
    expect(JSON.stringify(view.groups)).not.toContain('335.0000');
  });

  it('counts an allocation once, as a receipt measure, and never on the invoice side', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const invoices = groupFor(view, USD, 'invoice');
    const receipts = groupFor(view, USD, 'receipt');
    expect(invoices).toBeDefined();
    expect(receipts).toBeDefined();
    if (invoices === undefined || receipts === undefined) return;
    // The 69.0000 is `allocated` in the RECEIPT group and reaches the invoice
    // group only as a REDUCTION inside `outstanding` (205.0000 invoiced less
    // 69.0000 applied less 40.0000 credited = 96.0000). The invoice group
    // publishes no allocation measure at all, which is what makes adding the two
    // groups impossible to get wrong. `unallocated` sits on the receipt side for
    // the same reason: it is a fact about the receipt and about nothing else.
    expect(receipts.measures.allocated).toBe('69.0000');
    expect(receipts.measures.unallocated).toBe('6.0000');
    expect(invoices.measures.allocated).toBeUndefined();
    expect(invoices.measures.unallocated).toBeUndefined();
    expect(invoices.measures.invoiced).toBe('205.0000');
    expect(invoices.measures.outstanding).toBe('96.0000');
  });

  it('carries every amount as a string, in cells and in measures alike', async () => {
    authAs(FIN_RPT_FULL);
    const raw = await report();
    const text = await raw.text();
    const view = JSON.parse(text) as RunBody;
    for (const group of view.groups) {
      for (const value of Object.values(group.measures)) expect(typeof value).toBe('string');
    }
    for (const row of view.rows.items) {
      for (const key of [
        'invoicedAmount',
        'receiptAmount',
        'allocatedAmount',
        'unallocatedAmount',
        'creditNoteAmount',
        'outstanding',
      ]) {
        const value = cellValue(row, key);
        expect(value === null || typeof value === 'string').toBe(true);
      }
    }
    // No amount made a trip through a JSON number: every one is quoted in the
    // wire text, at the scale `numeric(18,4)` stores.
    expect(text).toContain('"165.0000"');
    expect(text).toContain('"100.0000"');
    // The two amounts added on the Owner's answer travel the same way.
    expect(text).toContain('"6.0000"');
    expect(text).toContain('"40.0000"');
    expect(text).not.toContain(':165');
    expect(text).not.toContain(':65.0');
    expect(text).not.toContain(':6.0');
  });
});

describe('the merged page is a page of the union', () => {
  it('reconstructs the whole selection across pages, with the tied instant split', async () => {
    authAs(FIN_RPT_FULL);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const groupsPerPage: string[] = [];
    do {
      const view: RunBody = await body(
        await report(cursor === null ? { limit: '2' } : { limit: '2', cursor })
      );
      groupsPerPage.push(JSON.stringify(view.groups));
      for (const item of view.rows.items) seen.push(cellValue(item, 'document') ?? '');
      cursor = view.rows.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(10);
    } while (cursor !== null);

    expect(pages).toBe(4);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual(
      [
        invoiceUsd.invoiceId,
        invoiceCredited.invoiceId,
        invoiceJod.invoiceId,
        creditNoteId,
        receiptUsd,
        receiptJod,
        receiptLastSecond,
      ].sort()
    );
    // The JOD invoice and the USD receipt share an instant EXACTLY, and they come
    // from two different modules' streams — so the merge, not either query, is
    // what keeps them in one total order across a page boundary.
    expect(seen.indexOf(invoiceJod.invoiceId)).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf(receiptUsd)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(seen.indexOf(invoiceJod.invoiceId) - seen.indexOf(receiptUsd))).toBe(1);
    // The groups are computed over the whole selection, so every page carries the
    // same ones — a total that changed with the page would be a total of the page.
    expect(new Set(groupsPerPage).size).toBe(1);
  });

  it('orders the rows newest first', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    const dates = view.rows.items.map((item) => cellValue(item, 'documentDate') ?? '');
    expect([...dates]).toEqual([...dates].sort().reverse());
    expect(dates[0]).toBe(shift(periodCloses, -SECOND));
    expect(dates[dates.length - 1]).toBe(periodOpens);
  });

  it('refuses a malformed cursor and one minted for a different ordering contract', async () => {
    authAs(FIN_RPT_FULL);
    const malformed = await report({ cursor: 'not-a-cursor' });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Problem).code).toBe('ERR-PAG-001');

    // Well formed base64url, issued for the RECEIPT SCREEN's ordering over one of
    // the same tables. A cursor is refused rather than reinterpreted: that list
    // orders receipts alone and this report orders a merge of three kinds of
    // document, so re-using one across the two would silently produce a wrong
    // page — a page missing every invoice and every credit note.
    const foreign = Buffer.from(
      JSON.stringify({ k: 'sal.receipts:received_at_desc', v: middle, i: receiptUsd })
    ).toString('base64url');
    const response = await report({ limit: '2', cursor: foreign });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Problem).code).toBe('ERR-PAG-001');
  });
});

describe('branch isolation is the permission evaluation, not an empty result', () => {
  it('refuses the reported branch to a caller granted only in the sibling branch', async () => {
    authAs(FIN_SCOPED_S2);
    const response = await report();
    expect(response.status).toBe(403);
    expect(((await response.json()) as Problem).code).toBe('ERR-IAM-001');
  });

  it('answers for the sibling branch, and that branch never shows the reported one', async () => {
    authAs(FIN_SCOPED_S2);
    const view = await body(
      await run({ companyId: COMPANY_S, branchId: BRANCH_S2, from: FROM, to: TO })
    );
    const present = view.rows.items.map((item) => cellValue(item, 'document'));
    // Non-vacuity: the same caller CAN report, so the refusal above is authority
    // and not a broken fixture.
    expect(present).toContain(invoiceOtherBranch.invoiceId);
    expect(present).toContain(receiptOtherBranch);
    expect(present).not.toContain(invoiceUsd.invoiceId);
    expect(present).not.toContain(receiptUsd);
    expect(groupFor(view, USD, 'invoice')?.measures.invoiced).toBe('300.0000');
  });
});
