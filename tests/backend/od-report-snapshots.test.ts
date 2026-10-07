/**
 * Frozen report snapshots and distinguished restatements (Owner decision D16,
 * P1-32-PRE-OD-FD16B), through the real routes.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rpt.report-snapshot-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   rpt.report-snapshot-list: route service authorization success denial cross-tenant isolation pagination
 *   rpt.report-snapshot-read: route service authorization success denial cross-tenant isolation pagination
 *
 * ## What the Owner asked, and what each block proves
 *
 * D16: "later payments, credits, reversals or backdated entries must not silently
 * change a historical report; as-of versus snapshot is documented; restatements
 * are distinguished". The as-of read (FD16A) recomputes; a SNAPSHOT keeps one run
 * exactly as it was. So the decisive case saves a snapshot, applies a payment
 * afterwards, and shows the stored rows and their digest unchanged while the live
 * read "as of now" moves. A RESTATEMENT is a later snapshot of the same period that
 * names the one it replaces, says why, and carries a difference; the replaced one
 * stays as it was and says it was restated.
 *
 * Every refusal by rule is recorded once, after the refused transaction rolled
 * back (ADR-023 D12), and a duplicate saved twice at once leaves exactly one row
 * and one refusal rather than a 500.
 *
 * ## The fixtures
 *
 * Written through the protected `sal` primitives, then placed at chosen instants
 * with triggers suspended for that statement alone, exactly as the invoice and
 * payment report suite does and for the reasons it records. This suite owns its
 * company, branches, principals and payment method.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
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
import { __resetRateLimitForTests } from '@/server/http/rate-limit';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { GET as RUN } from '@/app/api/v1/reports/[reportCode]/rows/route';
import {
  GET as LIST_SNAPSHOTS,
  POST as CREATE_SNAPSHOT,
  REPORT_SNAPSHOT_CREATE_OPERATION,
  REPORT_SNAPSHOT_LIST_OPERATION,
} from '@/app/api/v1/reports/[reportCode]/snapshots/route';
import {
  GET as READ_SNAPSHOT,
  REPORT_SNAPSHOT_READ_OPERATION,
} from '@/app/api/v1/reports/[reportCode]/snapshots/[snapshotId]/rows/route';

let admin: Pool;
let runtime: Pool | undefined;

const COMPANY_N = 'f16b0000-0000-4000-8000-0000000000c1';
const BRANCH_N1 = 'f16b0000-0000-4000-8000-0000000000b1';
const BRANCH_N2 = 'f16b0000-0000-4000-8000-0000000000b2';
const BRANCH_TIMEZONE = 'Asia/Amman';
const PAYMENT_METHOD_N = 'f16b0000-0000-4000-8000-0000000000d1';
const REPORT_CODE = 'invoice_payment_summary';
const USD = 'USD';

/** A closed period in the past; every fixture document is placed inside it. */
const FROM = '2026-04-10';
const TO = '2026-04-12';
/** A second closed period, used by the duplicate and the replay cases only. */
const QUIET_FROM = '2026-04-20';
const QUIET_TO = '2026-04-21';

const SAVER: Principal = {
  roleId: 'f16b0000-0000-4000-8000-000000000101',
  userId: 'f16b0000-0000-4000-8000-000000000102',
  subject: 'fx_od_fd16b_saver',
  tenantId: TENANT_A,
  permissions: ['rpt.report.read', 'sal.finance.view', 'rpt.export', 'crm.customer.read'],
};
/** May read reports and money and name people; may not save. Not the CRM read. */
const READER: Principal = {
  roleId: 'f16b0000-0000-4000-8000-000000000111',
  userId: 'f16b0000-0000-4000-8000-000000000112',
  subject: 'fx_od_fd16b_reader',
  tenantId: TENANT_A,
  permissions: ['rpt.report.read', 'sal.finance.view', 'iam.user.read'],
};
/** May save, but may not see money: refused as a whole, never served blanks. */
const NO_FINANCE: Principal = {
  roleId: 'f16b0000-0000-4000-8000-000000000121',
  userId: 'f16b0000-0000-4000-8000-000000000122',
  subject: 'fx_od_fd16b_no_finance',
  tenantId: TENANT_A,
  permissions: ['rpt.report.read', 'rpt.export'],
};
/** Every code, but only in the sibling branch. */
const SCOPED_N2: Principal = {
  roleId: 'f16b0000-0000-4000-8000-000000000131',
  userId: 'f16b0000-0000-4000-8000-000000000132',
  subject: 'fx_od_fd16b_scoped',
  tenantId: TENANT_A,
  permissions: ['rpt.report.read', 'sal.finance.view', 'rpt.export'],
  scope: { companyId: COMPANY_N, branchId: BRANCH_N2 },
  grantId: 'f16b0000-0000-4000-8000-0000000001f1',
};
/** Every code, in tenant B. */
const TENANT_B_FULL: Principal = {
  roleId: 'f16b0000-0000-4000-8000-000000000141',
  userId: 'f16b0000-0000-4000-8000-000000000142',
  subject: 'fx_od_fd16b_tenant_b',
  tenantId: TENANT_B,
  permissions: ['rpt.report.read', 'sal.finance.view', 'rpt.export'],
};
const PRINCIPALS = [SAVER, READER, NO_FINANCE, SCOPED_N2, TENANT_B_FULL];

const CREATE_OPERATION = 'rpt.report-snapshot-create';

interface Cell {
  readonly key: string;
  readonly label: string | null;
  readonly value: string | null;
}
interface Row {
  readonly cells: readonly Cell[];
}
interface Summary {
  readonly id: string;
  readonly asOf: string;
  readonly generatedAt: string;
  readonly generatedBy: { readonly id: string; readonly displayName: string | null };
  readonly rowCount: number;
  readonly rowsDigest: string;
  readonly restatesSnapshotId: string | null;
  readonly restatedBySnapshotId: string | null;
  readonly restatementReason: string | null;
  readonly period: { readonly from: string; readonly to: string; readonly timezone: string };
}
interface Difference {
  readonly rowsBefore: number;
  readonly rowsAfter: number;
  readonly rowsAdded: number;
  readonly rowsRemoved: number;
  readonly rowsChanged: number;
  readonly totals: readonly {
    readonly currency: string | null;
    readonly measure: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}
interface SnapshotView extends Summary {
  readonly filters: { readonly companyId: string; readonly branchId: string };
  readonly difference: Difference | null;
}
interface RowsView {
  readonly snapshot: SnapshotView;
  readonly restates: Summary | null;
  readonly restatedBy: Summary | null;
  readonly columns: readonly { readonly key: string }[];
  readonly rows: {
    readonly items: readonly Row[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}
interface Problem {
  readonly code: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

const cellValue = (row: Row, key: string): string | null =>
  row.cells.find((cell) => cell.key === key)?.value ?? null;
const rowFor = (rows: readonly Row[], id: string): Row | undefined =>
  rows.find((row) => cellValue(row, 'document') === id);

function create(
  body: Record<string, unknown>,
  key: string = randomUUID(),
  reportCode = REPORT_CODE
): Promise<Response> {
  return CREATE_SNAPSHOT(
    new Request(`http://localhost/api/v1/reports/${reportCode}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ reportCode }) }
  );
}

const scope = { companyId: COMPANY_N, branchId: BRANCH_N1 };
const period = { ...scope, from: FROM, to: TO };

function list(query: Record<string, string> = {}, reportCode = REPORT_CODE): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/reports/${reportCode}/snapshots`);
  for (const [key, value] of Object.entries({ ...scope, ...query })) {
    url.searchParams.set(key, value);
  }
  return LIST_SNAPSHOTS(new Request(url), { params: Promise.resolve({ reportCode }) });
}

function read(snapshotId: string, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(
    `http://localhost/api/v1/reports/${REPORT_CODE}/snapshots/${snapshotId}/rows`
  );
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return READ_SNAPSHOT(new Request(url), {
    params: Promise.resolve({ reportCode: REPORT_CODE, snapshotId }),
  });
}

function live(asOf: string): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/reports/${REPORT_CODE}/rows`);
  for (const [key, value] of Object.entries({ ...period, asOf })) url.searchParams.set(key, value);
  return RUN(new Request(url), { params: Promise.resolve({ reportCode: REPORT_CODE }) });
}

async function readAll(snapshotId: string): Promise<{ view: RowsView; rows: Row[] }> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  let view: RowsView | undefined;
  do {
    const response = await read(
      snapshotId,
      cursor === null ? { limit: '1' } : { limit: '1', cursor }
    );
    expect(response.status).toBe(200);
    view = (await response.json()) as RowsView;
    rows.push(...view.rows.items);
    cursor = view.rows.nextCursor;
  } while (cursor !== null);
  return { view, rows };
}

/** Business-rule refusals recorded for the create operation with this rule (D12). */
async function refusals(rule: string, entity?: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE event_type = 'business-rule.refused'
        AND detail LIKE $1`,
    [`operation=${CREATE_OPERATION} entity=${entity ?? '%'} rule=${rule} outcome=refused`]
  );
  return Number(result.rows[0]?.n ?? '0');
}

async function snapshotRows(periodFrom: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM rpt.report_snapshots
      WHERE tenant_id = $1 AND branch_id = $2 AND period_from = $3::date`,
    [TENANT_A, BRANCH_N1, periodFrom]
  );
  return Number(result.rows[0]?.n ?? '0');
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','FD16B '||$4,'active',$5)
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
     VALUES ($1,$2,$3,'FD16B fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [principal.tenantId, principal.roleId, USER_A, [...principal.permissions]]
  );
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
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
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

async function inTenantTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
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

/** Places one instant on one row, with triggers suspended for that statement. */
async function restateInstant(table: string, column: string, id: string, instant: string) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL session_replication_role = 'replica'`);
    const result = await client.query(
      `UPDATE ${table} SET ${column} = $2::timestamptz WHERE id = $1`,
      [id, instant]
    );
    if (result.rowCount !== 1)
      throw new Error(`restatement touched ${String(result.rowCount)} rows`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cleanFinanceFixtures(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    for (const table of [
      'rpt.report_snapshots',
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

let opens = '';
let invoiceId = '';
let receiptId = '';

const shift = (iso: string, ms: number): string =>
  new Date(new Date(iso).getTime() + ms).toISOString();
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFinanceFixtures();
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);

  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_od_fd16b','FD16B Snapshot Company','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_N, TENANT_A, USER_A]
  );
  for (const [id, code, name] of [
    [BRANCH_N1, 'fx_od_fd16b_b1', 'FD16B Reported Branch'],
    [BRANCH_N2, 'fx_od_fd16b_b2', 'FD16B Sibling Branch'],
  ]) {
    await admin.query(
      `INSERT INTO org.branches
         (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, COMPANY_N, code, name, BRANCH_TIMEZONE, USER_A]
    );
    await admin.query(
      `INSERT INTO shared.number_sequences
         (tenant_id, company_id, branch_id, sequence_code, prefix_template, next_value,
          pad_width, period_reset_rule, created_by)
       VALUES ($1,$2,$3,'invoice','FX16BINV-',1,6,'never',$4),
              ($1,$2,$3,'receipt','FX16BRCT-',1,6,'never',$4)
       ON CONFLICT (tenant_id, sequence_code, company_id, branch_id) DO NOTHING`,
      [TENANT_A, COMPANY_N, id, USER_A]
    );
  }
  await admin.query(
    `INSERT INTO sal.payment_methods
       (id, scope, tenant_id, method_code, kind, display_name, status, created_by)
     VALUES ($1,'tenant',$2,'fx_fd16b_cash','cash','FD16B Cash','active',$3)
     ON CONFLICT (id) DO NOTHING`,
    [PAYMENT_METHOD_N, TENANT_A, USER_A]
  );
  for (const principal of PRINCIPALS) await seedPrincipal(principal);

  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  const bounds = await admin.query<{ opens: Date }>(
    `SELECT (($1::date)::timestamp AT TIME ZONE $2) AS opens`,
    [FROM, BRANCH_TIMEZONE]
  );
  opens = (bounds.rows[0]?.opens ?? new Date(0)).toISOString();

  // Inside the period: an invoice of 100.0000, a receipt of 50.0000, and 30.0000
  // of it applied to the invoice.
  const order = await createWorkOrder({ companyId: COMPANY_N, branchId: BRANCH_N1 });
  invoiceId = await inTenantTransaction(async (client) => {
    const invoice = await client.query<{ id: string }>(
      `INSERT INTO sal.invoices
         (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [TENANT_A, COMPANY_N, BRANCH_N1, order.workOrderId, PARTNER_A, USD, USER_A]
    );
    const id = invoice.rows[0]?.id ?? '';
    const line = await client.query<{ id: string }>(
      `INSERT INTO sal.invoice_lines
         (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity,
          currency_code, created_by)
       VALUES ($1,$2,$3,$4,1,'service',1,$5,$6) RETURNING id`,
      [TENANT_A, COMPANY_N, BRANCH_N1, id, USD, USER_A]
    );
    await client.query(
      `INSERT INTO sal.invoice_line_amounts
         (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price,
          net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount,
          created_by)
       VALUES ($1,$2,$3,$4,$5,100,100,0,100,100,0,$6)`,
      [TENANT_A, COMPANY_N, BRANCH_N1, line.rows[0]?.id ?? '', id, USER_A]
    );
    await client.query(`SELECT sal.issue_invoice($1,NULL)`, [id]);
    return id;
  });
  await restateInstant('sal.invoices', 'issued_at', invoiceId, shift(opens, 10 * HOUR));
  receiptId = await inTenantTransaction(async (client) => {
    const row = await client.query<{ id: string }>(
      `SELECT sal.record_receipt($1,$2,$3,$4,$5,'50.0000'::numeric,NULL,NULL,NULL) AS id`,
      [COMPANY_N, BRANCH_N1, PAYMENT_METHOD_N, PARTNER_A, USD]
    );
    return row.rows[0]?.id ?? '';
  });
  await restateInstant('sal.receipts', 'received_at', receiptId, shift(opens, 11 * HOUR));
  await inTenantTransaction(async (client) => {
    await client.query(`SELECT sal.allocate_receipt($1,$2,'30.0000'::numeric,NULL)`, [
      receiptId,
      invoiceId,
    ]);
  });
  const allocation = await admin.query<{ id: string }>(
    `SELECT id FROM sal.payment_allocations WHERE receipt_id = $1`,
    [receiptId]
  );
  await restateInstant(
    'sal.payment_allocations',
    'allocated_at',
    allocation.rows[0]?.id ?? '',
    shift(opens, 12 * HOUR)
  );
}, 120_000);

beforeEach(() => {
  __resetRateLimitForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanFinanceFixtures();
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('the three operations are declared as the Owner decision requires', () => {
  it('saves under rpt.export and rpt.report.read, audited and idempotent; reads under rpt.report.read', () => {
    expect(REPORT_SNAPSHOT_CREATE_OPERATION).toMatchObject({
      id: 'rpt.report-snapshot-create',
      permissions: ['rpt.export', 'rpt.report.read'],
      scope: 'branch',
      auditClass: 'financial',
      auditAction: 'rpt.report.snapshot_created',
      idempotent: true,
    });
    expect(REPORT_SNAPSHOT_LIST_OPERATION).toMatchObject({
      id: 'rpt.report-snapshot-list',
      permissions: ['rpt.report.read'],
      scope: 'branch',
      auditClass: 'none',
    });
    expect(REPORT_SNAPSHOT_READ_OPERATION).toMatchObject({
      id: 'rpt.report-snapshot-read',
      permissions: ['rpt.report.read'],
      scope: 'branch',
      answersNotFound: true,
    });
  });
});

describe('a snapshot keeps one run exactly as it was', () => {
  let original: SnapshotView;
  let restatement: SnapshotView;

  it('saves the whole run, stamped by the database, and audits it', async () => {
    authAs(SAVER);
    const response = await create(period);
    expect(response.status).toBe(201);
    original = ((await response.json()) as { snapshot: SnapshotView }).snapshot;
    expect(original).toMatchObject({
      period: { from: FROM, to: TO, timezone: BRANCH_TIMEZONE },
      filters: scope,
      rowCount: 2,
      restatesSnapshotId: null,
      restatedBySnapshotId: null,
      restatementReason: null,
      difference: null,
      generatedBy: { id: SAVER.userId },
    });
    // The default moment of a closed period: its exclusive end.
    const closes = await admin.query<{ closes: Date }>(
      `SELECT (($1::date)::timestamp AT TIME ZONE $2) AS closes`,
      [TO, BRANCH_TIMEZONE]
    );
    expect(original.asOf).toBe(closes.rows[0]?.closes.toISOString());
    const stored = await admin.query<{ ok: boolean; by: string }>(
      `SELECT rows_digest = encode(sha256(convert_to(rows::text,'UTF8')),'hex') AS ok,
              generated_by::text AS by
         FROM rpt.report_snapshots WHERE id = $1`,
      [original.id]
    );
    expect(stored.rows[0]).toEqual({ ok: true, by: SAVER.userId });
    const audit = await admin.query<{ field: string; value: string | null }>(
      `SELECT d.field_name AS field, d.new_value_masked AS value
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.tenant_id = r.tenant_id AND d.audit_record_id = r.id
        WHERE r.tenant_id = $1 AND r.entity_id = $2 AND r.action = 'rpt.report.snapshot_created'`,
      [TENANT_A, original.id]
    );
    const details = Object.fromEntries(audit.rows.map((row) => [row.field, row.value]));
    expect(details).toMatchObject({
      report_code: REPORT_CODE,
      from: FROM,
      to_exclusive: TO,
      as_of: original.asOf,
      row_count: '2',
      rows_digest: original.rowsDigest,
    });
  });

  it('does not move when a payment is applied later, while the live read as of now does', async () => {
    // Applied today: the rest of the receipt.
    await inTenantTransaction(async (client) => {
      await client.query(`SELECT sal.allocate_receipt($1,$2,'20.0000'::numeric,NULL)`, [
        receiptId,
        invoiceId,
      ]);
    });
    authAs(READER);
    const frozen = await readAll(original.id);
    expect(frozen.view.snapshot.rowsDigest).toBe(original.rowsDigest);
    expect(frozen.rows).toHaveLength(2);
    expect(cellValue(rowFor(frozen.rows, invoiceId) ?? { cells: [] }, 'outstanding')).toBe(
      '70.0000'
    );
    expect(cellValue(rowFor(frozen.rows, receiptId) ?? { cells: [] }, 'unallocatedAmount')).toBe(
      '20.0000'
    );
    const recomputed = await admin.query<{ digest: string }>(
      `SELECT encode(sha256(convert_to(rows::text,'UTF8')),'hex') AS digest
         FROM rpt.report_snapshots WHERE id = $1`,
      [original.id]
    );
    expect(recomputed.rows[0]?.digest).toBe(original.rowsDigest);

    const now = await live('now');
    expect(now.status).toBe(200);
    const liveRows = ((await now.json()) as { rows: { items: Row[] } }).rows.items;
    expect(cellValue(rowFor(liveRows, invoiceId) ?? { cells: [] }, 'outstanding')).toBe('50.0000');
  });

  it('restates the latest snapshot with a reason and a difference, and marks the original', async () => {
    authAs(SAVER);
    const moment = await admin.query<{ at: Date }>(`SELECT clock_timestamp() AS at`);
    const response = await create({
      ...period,
      asOf: (moment.rows[0]?.at ?? new Date(0)).toISOString(),
      restatesSnapshotId: original.id,
      reason: 'The rest of the receipt was applied after the period closed',
    });
    expect(response.status).toBe(201);
    restatement = ((await response.json()) as { snapshot: SnapshotView }).snapshot;
    expect(restatement.restatesSnapshotId).toBe(original.id);
    expect(restatement.restatementReason).toBe(
      'The rest of the receipt was applied after the period closed'
    );
    expect(restatement.difference).toMatchObject({
      rowsBefore: 2,
      rowsAfter: 2,
      rowsAdded: 0,
      rowsRemoved: 0,
      rowsChanged: 2,
    });
    const outstanding = restatement.difference?.totals.find(
      (total) => total.currency === USD && total.measure === 'outstanding'
    );
    expect(outstanding).toEqual({
      currency: USD,
      measure: 'outstanding',
      before: '70.0000',
      after: '50.0000',
    });

    authAs(READER);
    const view = (await (await read(original.id)).json()) as RowsView;
    expect(view.snapshot.restatedBySnapshotId).toBe(restatement.id);
    expect(view.restatedBy).toMatchObject({
      id: restatement.id,
      restatementReason: 'The rest of the receipt was applied after the period closed',
    });
    // Nothing was overwritten: the original still holds what it held.
    expect(view.snapshot.rowsDigest).toBe(original.rowsDigest);
    const newer = (await (await read(restatement.id)).json()) as RowsView;
    expect(newer.restates).toMatchObject({ id: original.id });
    expect(newer.snapshot.difference?.rowsChanged).toBe(2);
  });

  it('lists the chain newest first, metadata only, with names for a reader allowed them', async () => {
    authAs(READER);
    const response = await list({ from: FROM, to: TO });
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: Record<string, unknown>[] };
    expect(page.items.map((item) => item.id)).toEqual([restatement.id, original.id]);
    expect(page.items[0]).not.toHaveProperty('rows');
    expect(page.items[1]).toMatchObject({
      restatedBySnapshotId: restatement.id,
      generatedBy: { id: SAVER.userId, displayName: `FD16B ${SAVER.subject}` },
    });
    // One page at a time.
    const first = (await (await list({ limit: '1' })).json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(1);
    const second = (await (await list({ limit: '1', cursor: first.nextCursor ?? '' })).json()) as {
      items: { id: string }[];
    };
    expect(second.items.map((item) => item.id)).toEqual([original.id]);
  });

  it('withholds the party name from a reader without the CRM read', async () => {
    authAs(SAVER);
    const saverView = await readAll(original.id);
    expect(
      cellValue(rowFor(saverView.rows, invoiceId) ?? { cells: [] }, 'partyName')
    ).not.toBeNull();
    authAs(READER);
    const readerView = await readAll(original.id);
    expect(cellValue(rowFor(readerView.rows, invoiceId) ?? { cells: [] }, 'partyName')).toBeNull();
    // The id still travels; only the name is withheld.
    expect(cellValue(rowFor(readerView.rows, invoiceId) ?? { cells: [] }, 'partyId')).toBe(
      PARTNER_A
    );
  });

  it('refuses a second original of the same period, naming the restatement, and records it', async () => {
    authAs(SAVER);
    const before = await refusals('report_snapshot_exists', `rpt.report_snapshot/${original.id}`);
    const response = await create(period);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ERR-RES-002',
      violations: [{ path: 'body', rule: 'report_snapshot_exists' }],
    });
    expect(await refusals('report_snapshot_exists', `rpt.report_snapshot/${original.id}`)).toBe(
      before + 1
    );
  });

  it('refuses restating a snapshot that is not the latest, and records it', async () => {
    authAs(SAVER);
    const before = await refusals('report_snapshot_not_latest');
    const response = await create({
      ...period,
      restatesSnapshotId: original.id,
      reason: 'Restating the older one',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ERR-TRN-001',
      violations: [{ path: 'body.restatesSnapshotId', rule: 'report_snapshot_not_latest' }],
    });
    expect(await refusals('report_snapshot_not_latest', `rpt.report_snapshot/${original.id}`)).toBe(
      before + 1
    );
  });

  it('refuses a restatement without a reason, and records it', async () => {
    authAs(SAVER);
    for (const reason of [undefined, '   ']) {
      const before = await refusals(
        'report_snapshot_reason_required',
        `rpt.report_snapshot/${restatement.id}`
      );
      const response = await create({
        ...period,
        restatesSnapshotId: restatement.id,
        ...(reason === undefined ? {} : { reason }),
      });
      expect(response.status).toBe(422);
      expect(((await response.json()) as Problem).violations).toEqual([
        { path: 'body.reason', rule: 'report_snapshot_reason_required' },
      ]);
      expect(
        await refusals('report_snapshot_reason_required', `rpt.report_snapshot/${restatement.id}`)
      ).toBe(before + 1);
    }
  });
});

describe('refusals by rule and by permission', () => {
  it('refuses an invalid snapshot request before saving anything', async () => {
    authAs(SAVER);
    for (const body of [
      // The period ends before it starts.
      { ...scope, from: '2026-04-05', to: '2026-04-04' },
      // A moment with no offset.
      { ...scope, from: '2026-04-05', to: '2026-04-06', asOf: '2026-04-05T12:00:00' },
      // A field the request does not take.
      { ...scope, from: '2026-04-05', to: '2026-04-06', limit: 5 },
      // A reason with no snapshot to restate.
      { ...scope, from: '2026-04-05', to: '2026-04-06', reason: 'Nothing to restate' },
    ]) {
      const response = await create(body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(((await response.json()) as Problem).code).toBe('ERR-VAL-001');
    }
    expect(await snapshotRows('2026-04-05')).toBe(0);
  });

  it('refuses a report that keeps no snapshots, and records it', async () => {
    authAs(SAVER);
    // work_orders_by_status needs wo.work_order.read, which this principal lacks:
    // that is a permission refusal, before the rule. A principal holding every
    // code is the reader of the rule.
    const before = await refusals('report_snapshot_not_supported', `org.branch/${BRANCH_N1}`);
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = 'inv.stock.read'
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [TENANT_A, SAVER.roleId, USER_A]
    );
    const response = await create(period, randomUUID(), 'inventory_movements');
    expect(response.status).toBe(422);
    expect(((await response.json()) as Problem).violations).toEqual([
      { path: 'path.reportCode', rule: 'report_snapshot_not_supported' },
    ]);
    expect(await refusals('report_snapshot_not_supported', `org.branch/${BRANCH_N1}`)).toBe(
      before + 1
    );
  });

  it('refuses a snapshot larger than the export bound, and records it', async () => {
    authAs(SAVER);
    const previous = process.env.EXPORT_MAX_ROWS;
    process.env.EXPORT_MAX_ROWS = '1';
    __resetBackendConfigForTests();
    try {
      const before = await refusals('report_snapshot_too_large');
      const response = await create({ ...scope, from: '2026-04-01', to: '2026-04-30' });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'ERR-EXP-001',
        violations: [{ path: 'body', rule: 'report_snapshot_too_large' }],
      });
      expect(await refusals('report_snapshot_too_large', `org.branch/${BRANCH_N1}`)).toBe(
        before + 1
      );
      expect(await snapshotRows('2026-04-01')).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.EXPORT_MAX_ROWS;
      else process.env.EXPORT_MAX_ROWS = previous;
      __resetBackendConfigForTests();
    }
  });

  it('refuses a caller who may save but not see the money, and one granted only elsewhere', async () => {
    authAs(NO_FINANCE);
    const noFinance = await create({ ...scope, from: '2026-04-02', to: '2026-04-03' });
    expect(noFinance.status).toBe(403);
    authAs(READER);
    const noExport = await create({ ...scope, from: '2026-04-02', to: '2026-04-03' });
    expect(noExport.status).toBe(403);
    authAs(SCOPED_N2);
    const elsewhere = await create({ ...scope, from: '2026-04-02', to: '2026-04-03' });
    expect(elsewhere.status).toBe(403);
    expect(await snapshotRows('2026-04-02')).toBe(0);
  });

  it('hides every snapshot from another tenant, a caller without the money and another branch', async () => {
    const id = (
      await admin.query<{ id: string }>(
        `SELECT id::text FROM rpt.report_snapshots WHERE tenant_id = $1 AND branch_id = $2
          ORDER BY generated_at LIMIT 1`,
        [TENANT_A, BRANCH_N1]
      )
    ).rows[0]?.id;
    expect(id).toBeDefined();
    for (const principal of [TENANT_B_FULL, NO_FINANCE, SCOPED_N2]) {
      authAs(principal);
      expect((await read(id ?? '')).status, principal.subject).toBe(404);
    }
    authAs(NO_FINANCE);
    expect((await list()).status).toBe(403);
    authAs(SCOPED_N2);
    expect((await list()).status).toBe(403);
    authAs(TENANT_B_FULL);
    expect((await list()).status).toBe(403);
  });
});

describe('idempotency and concurrency', () => {
  it('replays a repeated request under the same key as the one snapshot it saved', async () => {
    authAs(SAVER);
    const key = randomUUID();
    const body = { ...scope, from: QUIET_FROM, to: QUIET_TO };
    const first = await create(body, key);
    expect(first.status).toBe(201);
    const again = await create(body, key);
    // The stored response, answered as every replay in this platform is: 200.
    expect(again.status).toBe(200);
    const a = ((await first.json()) as { snapshot: SnapshotView }).snapshot;
    const b = ((await again.json()) as { snapshot: SnapshotView }).snapshot;
    expect(b.id).toBe(a.id);
    expect(await snapshotRows(QUIET_FROM)).toBe(1);
    const audits = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_records
        WHERE tenant_id = $1 AND entity_id = $2 AND action = 'rpt.report.snapshot_created'`,
      [TENANT_A, a.id]
    );
    expect(audits.rows[0]?.n).toBe('1');
  });

  it('refuses the same key offered with a different body', async () => {
    authAs(SAVER);
    const key = randomUUID();
    const first = await create({ ...scope, from: '2026-04-27', to: '2026-04-28' }, key);
    expect(first.status).toBe(201);
    const other = await create({ ...scope, from: '2026-04-28', to: '2026-04-29' }, key);
    expect(other.status).toBe(409);
    expect(((await other.json()) as Problem).code).toBe('ERR-INT-001');
    expect(await snapshotRows('2026-04-28')).toBe(0);
  });

  it('resolves two concurrent saves of one period to one row and one recorded refusal', async () => {
    authAs(SAVER);
    const from = '2026-04-25';
    const before = await refusals('report_snapshot_exists');
    const responses = await Promise.all([
      create({ ...scope, from, to: '2026-04-26' }),
      create({ ...scope, from, to: '2026-04-26' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.status === 409);
    expect(((await refused?.json()) as Problem).code).toBe('ERR-RES-002');
    expect(await snapshotRows(from)).toBe(1);
    expect(await refusals('report_snapshot_exists')).toBe(before + 1);
  });
});
