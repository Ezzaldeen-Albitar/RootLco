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
  // day's local midnight.
  receiptLastSecond = await seedReceipt({
    branchId: BRANCH_S1,
    currency: USD,
    amount: '10.0000',
    receivedAt: shift(periodCloses, -SECOND),
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
      'customer',
      'currency',
      'invoicedAmount',
      'receiptAmount',
      'allocatedAmount',
      'outstanding',
      'status',
    ]);
    expect(
      view.columns.filter((column) => column.kind === 'money').map((column) => column.key)
    ).toEqual(['invoicedAmount', 'receiptAmount', 'allocatedAmount', 'outstanding']);
    expect(view.columns.find((column) => column.key === 'document')?.kind).toBe('reference');
    expect(view.columns.find((column) => column.key === 'customer')?.kind).toBe('reference');
    expect(view.columns.find((column) => column.key === 'documentDate')?.kind).toBe('date');
    // NO drill-through anywhere on this report: one `document` column addresses
    // three kinds of document, and a single template would send two thirds of the
    // rows to a screen that cannot answer for them.
    expect(view.columns.every((column) => column.drillThrough === null)).toBe(true);
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
    expect(cellValue(row, 'customer')).toBe(PARTNER_A);
    // An id with no name: naming the payer would put another module's record in
    // this row, and therefore another module's read code on the permission list.
    expect(cellLabel(row, 'customer')).toBeNull();
    expect(cellValue(row, 'currency')).toBe(USD);
    expect(cellValue(row, 'invoicedAmount')).toBe('165.0000');
    expect(cellValue(row, 'status')).toBe('issued');
    // NULL, not zero: an invoice is not a receipt and has applied nothing.
    expect(cellValue(row, 'receiptAmount')).toBeNull();
    expect(cellValue(row, 'allocatedAmount')).toBeNull();
    // 165.0000 less the 65.0000 allocated — and it is the DATABASE FUNCTION's
    // answer, compared against the function itself rather than against a number
    // written here.
    expect(cellValue(row, 'outstanding')).toBe('100.0000');
    expect(cellValue(row, 'outstanding')).toBe(await openReceivableOf(invoiceUsd.invoiceId));
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
    expect(cellValue(unallocated, 'status')).toBe('recorded');
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
    // A credit note has no number, and the Owner's column list names no
    // credit-note amount — so the label is absent and every money column is null
    // rather than zero. Its effect on money is inside the invoice's outstanding.
    expect(cellLabel(credit, 'document')).toBeNull();
    for (const key of ['invoicedAmount', 'receiptAmount', 'allocatedAmount', 'outstanding']) {
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
      [USD, 'invoice'],
      [USD, 'receipt'],
    ]);
    expect(view.groups.every((group) => group.label === group.key.currency)).toBe(true);
  });

  it('totals the invoices and the receipts of each currency separately', async () => {
    authAs(FIN_RPT_FULL);
    const view = await body(await report());
    // 165.0000 + 40.0000 issued in USD; 100.0000 + 0.0000 still open.
    expect(groupFor(view, USD, 'invoice')?.measures).toEqual({
      invoiced: '205.0000',
      outstanding: '100.0000',
    });
    // 65.0000 + 10.0000 received in USD, of which 65.0000 has been applied.
    expect(groupFor(view, USD, 'receipt')?.measures).toEqual({
      receipts: '75.0000',
      allocated: '65.0000',
    });
    expect(groupFor(view, JOD, 'invoice')?.measures).toEqual({
      invoiced: '100.0000',
      outstanding: '100.0000',
    });
    expect(groupFor(view, JOD, 'receipt')?.measures).toEqual({
      receipts: '30.0000',
      allocated: '0.0000',
    });
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
    // The 65.0000 is `allocated` in the RECEIPT group and reaches the invoice
    // group only as a REDUCTION inside `outstanding` (205.0000 invoiced less
    // 65.0000 applied less 40.0000 credited = 100.0000). The invoice group
    // publishes no allocation measure at all, which is what makes adding the two
    // groups impossible to get wrong.
    expect(receipts.measures.allocated).toBe('65.0000');
    expect(invoices.measures.allocated).toBeUndefined();
    expect(invoices.measures.invoiced).toBe('205.0000');
    expect(invoices.measures.outstanding).toBe('100.0000');
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
      for (const key of ['invoicedAmount', 'receiptAmount', 'allocatedAmount', 'outstanding']) {
        const value = cellValue(row, key);
        expect(value === null || typeof value === 'string').toBe(true);
      }
    }
    // No amount made a trip through a JSON number: every one is quoted in the
    // wire text, at the scale `numeric(18,4)` stores.
    expect(text).toContain('"165.0000"');
    expect(text).toContain('"100.0000"');
    expect(text).not.toContain(':165');
    expect(text).not.toContain(':65.0');
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
