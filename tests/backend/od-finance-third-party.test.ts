/**
 * P1-32-PRE-OD-FD14 — the payer rule of ADR-023 D14, end to end through the route
 * handlers: a receipt applied to another customer's invoice is refused by default,
 * and accepted only as an explicit, authorised, audited third-party payment.
 *
 * Every case counts a side effect — an allocation row, an audit record, a security
 * event, a receipt's remainder, an invoice's open amount — and is written so it
 * FAILS when the control it names is removed:
 *
 *  - same payer: unchanged, no third-party detail, no third-party audit record;
 *  - default refusal: `allocation_payer_mismatch` on the invoice, nothing booked,
 *    ONE security event after the rollback (D12);
 *  - authority: a third-party statement without `sal.payment.third_party` in the
 *    receipt's company and branch is refused and recorded ONCE; the code held in
 *    another branch is refused;
 *  - the third-party allocation: booked, audited in the same transaction, the
 *    authoriser stamped from the session, payer and customer unchanged, the
 *    remainder left on the payer's receipt; a replay under the same key books and
 *    audits nothing twice; the same key with other detail is refused;
 *  - fields: every rule that does not hold is named on its field at once;
 *  - same payer with a statement, a wrong declared currency and another tenant are
 *    refused;
 *  - reads: the receipt detail, the invoice's settlement and the invoice-and-payment
 *    report show who paid for whom, names only to a reader holding
 *    `crm.customer.read`.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.payment-allocate: route service authorization success denial audit idempotency isolation cross-tenant
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
import { PARTNER_A, establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  PAYMENT_METHOD_A,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_TENANT_B,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  receiptUnallocated,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { GET as RECEIPT_DETAIL } from '@/app/api/v1/payments/[paymentId]/route';
import { GET as INVOICE_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import { GET as RUN_REPORT } from '@/app/api/v1/reports/[reportCode]/rows/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface ThirdPartyBody {
  readonly relationship: string;
  readonly authorisationReference: string;
  readonly reason: string;
}

interface AllocationBody {
  readonly id: string;
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly receiptUnallocated: { readonly amount: string };
  readonly thirdParty: ThirdPartyBody | null;
}

/** The invoice's customer: a tenant-A partner other than the receipts' payer. */
const FD14_CUSTOMER = 'f1320000-0000-4000-8000-00000000fd1c';
const FD14_CUSTOMER_NAME = 'FD14 Insured Customer';

/** Allocates, and holds the third-party code. No customer read. */
const FD14_THIRD_PARTY: Principal = {
  roleId: 'f1320000-0000-4000-8000-00000000fd14',
  userId: 'f1320000-0000-4000-8000-00000000fd15',
  subject: 'fx_od_fd14_third_party',
  tenantId: TENANT_A,
  permissions: ['sal.finance.view', 'sal.payment.allocate', 'sal.payment.third_party'],
};

/** Reads receipts, invoices and the report, AND customers: entitled to names. */
const FD14_READER: Principal = {
  roleId: 'f1320000-0000-4000-8000-00000000fd16',
  userId: 'f1320000-0000-4000-8000-00000000fd17',
  subject: 'fx_od_fd14_reader',
  tenantId: TENANT_A,
  permissions: [
    'sal.finance.view',
    'sal.invoice.manage',
    'rpt.report.read',
    'crm.customer.read',
    'iam.user.read',
  ],
};

const INSURER: ThirdPartyBody = {
  relationship: 'insurer',
  authorisationReference: 'CLM-2026-0042',
  reason: 'The insurer settles the repair under the customer’s policy',
};

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const allocate = (
  paymentId: string,
  body: Record<string, unknown>,
  key: string = randomUUID()
): Promise<Response> =>
  (ALLOCATE_PAYMENT as ParamHandler<{ paymentId: string }>)(
    new Request(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ paymentId }) }
  );

const read = <P extends Record<string, string>>(handler: unknown, path: string, params: P) =>
  (handler as ParamHandler<P>)(new Request(`http://localhost${path}`), {
    params: Promise.resolve(params),
  });

/** A receipt of `amount` USD paid by PARTNER_A, recorded through the route by SAL_FULL. */
async function recordReceipt(amount: string): Promise<string> {
  authAs(SAL_FULL);
  const response = await (RECORD_PAYMENT as (request: Request) => Promise<Response>)(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        paymentMethodId: PAYMENT_METHOD_A,
        payerPartnerId: PARTNER_A,
        currency: 'USD',
        amount,
      }),
    })
  );
  if (response.status !== 201) {
    throw new Error(`fixture receipt failed with ${response.status}: ${await response.text()}`);
  }
  return (await bodyOf<{ id: string }>(response)).id;
}

const allocationsOf = (receiptId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`, [
    receiptId,
  ]);

/** Business-rule refusal events recorded for one entity and rule. */
const refusalEvents = (entityId: string, rule: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
    [`%entity=sal.receipt/${entityId} rule=${rule} %`]
  );

async function seedPrincipal(principal: Principal, displayName: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test',$5,'active',$6)
     ON CONFLICT (id) DO NOTHING`,
    [
      principal.userId,
      principal.tenantId,
      IDENTITY_PROVIDER,
      principal.subject,
      displayName,
      USER_A,
    ]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,$3,$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [principal.tenantId, principal.roleId, USER_A, [...principal.permissions]]
  );
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [principal.tenantId, principal.userId, principal.roleId]
  );
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
  }
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimeAppPool(10);
  __setPrimaryPoolForTests(runtime);
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual',$3,$4) ON CONFLICT (id) DO NOTHING`,
    [FD14_CUSTOMER, TENANT_A, FD14_CUSTOMER_NAME, USER_A]
  );
  await seedPrincipal(FD14_THIRD_PARTY, 'FD14 Finance Officer');
  await seedPrincipal(FD14_READER, 'FD14 Reader');
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.end();
});

describe('D14 — the same payer is unchanged', () => {
  it('books an allocation to the payer’s own invoice with no third-party detail and no third-party record', async () => {
    const invoice = await seedIssuedInvoice('fd14same');
    const receipt = await recordReceipt('40.0000');
    authAs(SAL_FULL);
    const response = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '40.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(201);
    const body = await bodyOf<AllocationBody>(response);
    expect(body.thirdParty).toBeNull();
    expect(await auditCountFor('sal.payment.allocated', body.id)).toBe(1);
    expect(await auditCountFor('sal.payment.third_party_allocated', body.id)).toBe(0);
  });

  it('refuses a third-party statement on the payer’s own invoice, on the statement', async () => {
    const invoice = await seedIssuedInvoice('fd14samestmt');
    const receipt = await recordReceipt('10.0000');
    authAs(FD14_THIRD_PARTY);
    const response = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
      thirdParty: INSURER,
    });
    expect(response.status).toBe(422);
    expect((await bodyOf<ProblemBody>(response)).violations).toEqual([
      { path: 'body.thirdParty', rule: 'third_party_same_payer' },
    ]);
    expect(await allocationsOf(receipt)).toBe(0);
  });
});

describe('D14 — another customer’s invoice is refused by default', () => {
  it('refuses, books nothing, and records the refusal once', async () => {
    const invoice = await seedIssuedInvoice('fd14default', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('50.0000');
    authAs(SAL_FULL);
    const response = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '20.0000',
      currency: 'USD',
    });
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-TRN-001');
    expect(problem.violations).toEqual([
      { path: 'body.invoiceId', rule: 'allocation_payer_mismatch' },
    ]);
    expect(await allocationsOf(receipt)).toBe(0);
    expect(await receiptUnallocated(receipt)).toBe('50.0000');
    expect(await refusalEvents(receipt, 'allocation_payer_mismatch')).toBe(1);
  });

  it('refuses a third-party statement from a caller without sal.payment.third_party, and records it once', async () => {
    const invoice = await seedIssuedInvoice('fd14noauth', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('50.0000');
    authAs(SAL_FULL);
    const response = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '20.0000',
      currency: 'USD',
      thirdParty: INSURER,
    });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await allocationsOf(receipt)).toBe(0);
    expect(await refusalEvents(receipt, 'third_party_permission_missing')).toBe(1);
  });

  it('refuses a caller whose authority is in another branch', async () => {
    const invoice = await seedIssuedInvoice('fd14elsewhere', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('50.0000');
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '20.0000',
      currency: 'USD',
      thirdParty: INSURER,
    });
    expect(response.status).toBe(403);
    expect(await allocationsOf(receipt)).toBe(0);
  });

  it('shows another tenant nothing', async () => {
    const invoice = await seedIssuedInvoice('fd14tenant', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('50.0000');
    authAs(SAL_TENANT_B);
    const response = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '20.0000',
      currency: 'USD',
      thirdParty: INSURER,
    });
    expect(response.status).toBe(404);
    expect(await allocationsOf(receipt)).toBe(0);
  });
});

describe('D14 — an explicit, authorised, audited third-party allocation', () => {
  it('books it, audits it in the same transaction, stamps the authoriser, and moves nothing between the parties; a replay books and audits nothing twice', async () => {
    const invoice = await seedIssuedInvoice('fd14book', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('100.0000');
    authAs(FD14_THIRD_PARTY);
    const key = randomUUID();
    const request = {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
      thirdParty: INSURER,
    };
    const response = await allocate(receipt, request, key);
    expect(response.status).toBe(201);
    const body = await bodyOf<AllocationBody>(response);
    expect(body.thirdParty).toEqual(INSURER);
    // The remainder stays on the payer's receipt.
    expect(body.receiptUnallocated.amount).toBe('40.0000');
    expect(await receiptUnallocated(receipt)).toBe('40.0000');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('40.0000');

    const stored = await admin.query<{
      authorised: string;
      receipt_payer: string;
      invoice_payer: string;
    }>(
      `SELECT pa.third_party_authorised_by::text AS authorised,
              r.payer_partner_id::text AS receipt_payer, i.payer_partner_id::text AS invoice_payer
         FROM sal.payment_allocations pa
         JOIN sal.receipts r ON r.id = pa.receipt_id
         JOIN sal.invoices i ON i.id = pa.invoice_id
        WHERE pa.id = $1`,
      [body.id]
    );
    expect(stored.rows[0]).toEqual({
      authorised: FD14_THIRD_PARTY.userId,
      receipt_payer: PARTNER_A,
      invoice_payer: FD14_CUSTOMER,
    });
    expect(await auditCountFor('sal.payment.allocated', body.id)).toBe(1);
    expect(await auditCountFor('sal.payment.third_party_allocated', body.id)).toBe(1);
    const audit = await admin.query<{ actor: string }>(
      `SELECT actor_id::text AS actor FROM iam.audit_records
        WHERE action = 'sal.payment.third_party_allocated' AND entity_id = $1`,
      [body.id]
    );
    expect(audit.rows[0]?.actor).toBe(FD14_THIRD_PARTY.userId);

    // The same key, the same request: the same allocation, nothing booked or audited twice.
    const again = await allocate(receipt, request, key);
    expect([200, 201]).toContain(again.status);
    expect((await bodyOf<AllocationBody>(again)).id).toBe(body.id);
    expect(await allocationsOf(receipt)).toBe(1);
    expect(await auditCountFor('sal.payment.third_party_allocated', body.id)).toBe(1);

    // The same key with other detail is a reused key, refused.
    const reused = await allocate(
      receipt,
      { ...request, thirdParty: { ...INSURER, reason: 'Another reason' } },
      key
    );
    expect((await bodyOf<ProblemBody>(reused)).code).toBe('ERR-INT-001');
    expect(await allocationsOf(receipt)).toBe(1);
  });

  it('names every field that does not hold, at once, and books nothing', async () => {
    const invoice = await seedIssuedInvoice('fd14fields', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('50.0000');
    authAs(FD14_THIRD_PARTY);
    const blank = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
      thirdParty: { relationship: 'partner', authorisationReference: '  ', reason: '' },
    });
    expect(blank.status).toBe(422);
    expect((await bodyOf<ProblemBody>(blank)).violations).toEqual([
      { path: 'body.thirdParty.relationship', rule: 'third_party_relationship_invalid' },
      {
        path: 'body.thirdParty.authorisationReference',
        rule: 'third_party_authorisation_reference_required',
      },
      { path: 'body.thirdParty.reason', rule: 'third_party_reason_required' },
    ]);
    const other = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
      thirdParty: { relationship: 'other', authorisationReference: 'LTR-1', reason: ' ' },
    });
    expect((await bodyOf<ProblemBody>(other)).violations).toEqual([
      { path: 'body.thirdParty.reason', rule: 'third_party_other_unexplained' },
    ]);
    const tooLong = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
      thirdParty: { ...INSURER, authorisationReference: 'R'.repeat(101) },
    });
    expect((await bodyOf<ProblemBody>(tooLong)).violations).toEqual([
      {
        path: 'body.thirdParty.authorisationReference',
        rule: 'third_party_authorisation_reference_required',
      },
    ]);
    expect(await allocationsOf(receipt)).toBe(0);
  });

  it('still refuses a declared currency other than the receipt’s', async () => {
    const invoice = await seedIssuedInvoice('fd14ccy', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('50.0000');
    authAs(FD14_THIRD_PARTY);
    const response = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '10.000',
      currency: 'JOD',
      thirdParty: INSURER,
    });
    expect(response.status).toBe(422);
    expect(await allocationsOf(receipt)).toBe(0);
  });
});

describe('D14 — the reads say who paid for whom', () => {
  it('shows the third-party detail on the receipt, the invoice settlement and the report, with names only for a customer reader', async () => {
    const invoice = await seedIssuedInvoice('fd14reads', { payerPartnerId: FD14_CUSTOMER });
    const receipt = await recordReceipt('100.0000');
    authAs(FD14_THIRD_PARTY);
    const booked = await allocate(receipt, {
      invoiceId: invoice.invoiceId,
      amount: '70.0000',
      currency: 'USD',
      thirdParty: INSURER,
    });
    expect(booked.status).toBe(201);

    // The receipt: the allocation carries the record; the customer and the
    // authoriser are named only to a reader who may read customers and users.
    authAs(FD14_READER);
    const detail = await bodyOf<{
      payerPartnerId: string;
      allocations: readonly {
        invoicePayerName: string | null;
        thirdParty: (ThirdPartyBody & { authorisedByName: string | null }) | null;
      }[];
    }>(await read(RECEIPT_DETAIL, `/api/v1/payments/${receipt}`, { paymentId: receipt }));
    expect(detail.payerPartnerId).toBe(PARTNER_A);
    expect(detail.allocations).toHaveLength(1);
    expect(detail.allocations[0]?.invoicePayerName).toBe(FD14_CUSTOMER_NAME);
    expect(detail.allocations[0]?.thirdParty).toEqual({
      ...INSURER,
      authorisedByName: 'FD14 Finance Officer',
    });
    authAs(SAL_FULL);
    const plain = await bodyOf<{
      allocations: readonly {
        invoicePayerName: string | null;
        thirdParty: { authorisedByName: string | null } | null;
      }[];
    }>(await read(RECEIPT_DETAIL, `/api/v1/payments/${receipt}`, { paymentId: receipt }));
    expect(plain.allocations[0]?.invoicePayerName).toBeNull();
    expect(plain.allocations[0]?.thirdParty?.authorisedByName).toBeNull();

    // The invoice: its settlement lists the payment, the payer named for the reader only.
    authAs(FD14_READER);
    const outstanding = await bodyOf<{
      settlement: {
        paid: { amount: string };
        thirdPartyPayments: readonly {
          payerName: string | null;
          relationship: string;
          authorisationReference: string;
          money: { amount: string };
          receipt: { id: string };
        }[];
        thirdPartyPaymentsTruncated: boolean;
      };
    }>(
      await read(INVOICE_OUTSTANDING, `/api/v1/invoices/${invoice.invoiceId}/outstanding`, {
        invoiceId: invoice.invoiceId,
      })
    );
    expect(outstanding.settlement.paid.amount).toBe('70.0000');
    expect(outstanding.settlement.thirdPartyPaymentsTruncated).toBe(false);
    expect(outstanding.settlement.thirdPartyPayments).toHaveLength(1);
    const payment = outstanding.settlement.thirdPartyPayments[0];
    expect(payment?.payerName).toBe('Reception Requester');
    expect(payment?.relationship).toBe('insurer');
    expect(payment?.authorisationReference).toBe(INSURER.authorisationReference);
    expect(payment?.money.amount).toBe('70.0000');
    expect(payment?.receipt.id).toBe(receipt);

    // The report: the receipt row says how much of it paid other customers' invoices.
    const today = new Date();
    const day = (offset: number) =>
      new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const url = new URL('http://localhost/api/v1/reports/invoice_payment_summary/rows');
    for (const [name, value] of Object.entries({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      from: day(-1),
      to: day(1),
    })) {
      url.searchParams.set(name, value);
    }
    const reportResponse = await (RUN_REPORT as ParamHandler<{ reportCode: string }>)(
      new Request(url),
      { params: Promise.resolve({ reportCode: 'invoice_payment_summary' }) }
    );
    expect(reportResponse.status).toBe(200);
    const view = await bodyOf<{
      rows: {
        items: readonly { cells: readonly { key: string; value: string | null }[] }[];
      };
    }>(reportResponse);
    const cell = (row: { cells: readonly { key: string; value: string | null }[] }, key: string) =>
      row.cells.find((entry) => entry.key === key)?.value ?? null;
    const row = view.rows.items.find((item) => cell(item, 'document') === receipt);
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(cell(row, 'partyRole')).toBe('payer');
    expect(cell(row, 'partyId')).toBe(PARTNER_A);
    expect(cell(row, 'allocatedAmount')).toBe('70.0000');
    expect(cell(row, 'thirdPartyAllocatedAmount')).toBe('70.0000');
  });
});
