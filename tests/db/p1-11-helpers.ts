/**
 * Phase 1-11 shared test fixtures (billing, payment, delivery, warranty, reporting).
 *
 * Almost every P1-11 money table is RLS-gated on iam.has_permission('sal.finance.view')
 * (H-priv-1). The primitives (sal.issue_invoice, sal.record_receipt, ...) write into
 * those gated tables under SECURITY INVOKER, so the acting user MUST carry the P1-11
 * permissions or even the happy path fails with 42501. seedP111Base provisions:
 *   - org fixtures + the P1-09 base (vehicles, partners, technician identities),
 *   - the P1-11 permission catalog rows + a role carrying them all,
 *   - USER_A (maker) and APPROVER_USER (a distinct approver for dual control), each an
 *     ACTIVE tenant-A user with that role granted; NOPERM_USER (active, no grant) for
 *     the negative permission-gating assertions,
 *   - shared.number_sequences rows for 'invoice' and 'receipt' in (A, COMPANY_A1, BRANCH_A1),
 *   - a tenant-A payment method (receipts cannot reference a platform method — the FK is
 *     (tenant_id, id) and platform rows carry tenant_id NULL),
 *   - a committed signature document version (delivery signatures require one).
 *
 * The transaction-scoped builders run inside the caller's tx (context already tenant A,
 * user USER_A) and take a per-call `tag` so committed suites never collide on unique keys
 * (one-open-visit-per-vehicle, unique codes). They reuse the P1-09 / P1-10 helpers.
 */
import type { Client, Pool } from 'pg';
import { TENANT_A, TENANT_B, COMPANY_A1, BRANCH_A1, USER_A, USER_B } from './helpers';
import { seedP109Base, makeAuthorizedVisit, newWorkOrder, P9 } from './p1-09-helpers';
import { seedVehicle } from './p1-10-helpers';

type Q = { query: Client['query'] };

const T = TENANT_A;
const CO = COMPANY_A1;
const BR = BRANCH_A1;
const U = USER_A;

/** Deterministic Phase 1-11 fixture UUIDs (d11 family). */
export const P11 = {
  APPROVER_USER: 'd11a0000-0000-4000-8000-0000000000e1', // distinct dual-control approver (tenant A)
  NOPERM_USER: 'd11a0000-0000-4000-8000-0000000000e2', // active user WITHOUT sal.finance.view
  ROLE: 'd11a0000-0000-4000-8000-0000000000f0', // role bundling every P1-11 permission
  PM_CASH: 'd11d0000-0000-4000-8000-000000000001', // tenant-A cash payment method
  SIG_CATEGORY: 'd11c0000-0000-4000-8000-000000000001',
  SIG_DOCUMENT: 'd11c0000-0000-4000-8000-000000000002',
  SIG_DOC_VERSION: 'd11c0000-0000-4000-8000-000000000003',
};

/** The P1-11 permission codes granted to USER_A / APPROVER_USER (per the task contract). */
export const P11_PERMISSIONS: Array<{ code: string; domain: string }> = [
  { code: 'sal.finance.view', domain: 'sal' },
  { code: 'sal.invoice.issue', domain: 'sal' },
  { code: 'sal.payment.record', domain: 'sal' },
  { code: 'sal.payment.allocate', domain: 'sal' },
  { code: 'sal.credit.manage', domain: 'sal' },
  { code: 'sal.reversal.approve', domain: 'sal' },
  { code: 'sal.delivery.manage', domain: 'sal' },
  { code: 'sal.delivery.complete', domain: 'sal' },
  { code: 'sal.delivery.view', domain: 'sal' },
  { code: 'wty.policy.manage', domain: 'wty' },
  { code: 'wty.warranty.issue', domain: 'wty' },
  { code: 'rpt.report.configure', domain: 'rpt' },
  { code: 'rpt.export', domain: 'rpt' },
];

export const ctxA = { tenantId: TENANT_A, userId: USER_A };
export const ctxApprover = { tenantId: TENANT_A, userId: P11.APPROVER_USER };
export const ctxNoPerm = { tenantId: TENANT_A, userId: P11.NOPERM_USER };

/**
 * Runs a statement expected to fail with one of `codes`, wrapped in a SAVEPOINT so the
 * surrounding transaction is not left aborted (mirrors p1-10-helpers.expectFail).
 */
export async function expectFail(
  c: Q,
  codes: string | string[],
  sql: string,
  params: unknown[] = []
): Promise<void> {
  const list = Array.isArray(codes) ? codes : [codes];
  await c.query('SAVEPOINT sp_expect');
  let err: { code?: string; message?: string } | undefined;
  try {
    await c.query(sql, params);
  } catch (e) {
    err = e as { code?: string; message?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT sp_expect');
  if (!err) throw new Error(`expected ${list.join('/')} but the statement succeeded`);
  if (!err.code || !list.includes(err.code)) {
    throw new Error(`expected ${list.join('/')} but got ${err.code}: ${err.message}`);
  }
}

/** Provisions the committed base fixtures every P1-11 suite reuses (admin connection). */
export async function seedP111Base(admin: Pool): Promise<void> {
  await seedP109Base(admin);

  // 1. Permission catalog (platform-owned; additive, idempotent).
  for (const p of P11_PERMISSIONS) {
    await admin.query(
      `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
       VALUES ($1, $2, $3, 'high', $4) ON CONFLICT (permission_code) DO NOTHING`,
      [p.code, p.domain, `P1-11 ${p.code}`, U]
    );
  }

  // 2. Actors: maker (USER_A), approver, and a no-permission user — all ACTIVE, tenant A.
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$4,'fixture','p11-user-a','p11-user-a@fixture.test','P11 Maker','active',$1),
            ($2,$4,'fixture','p11-approver','p11-approver@fixture.test','P11 Approver','active',$1),
            ($3,$4,'fixture','p11-noperm','p11-noperm@fixture.test','P11 NoPerm','active',$1)
     ON CONFLICT (id) DO NOTHING`,
    [U, P11.APPROVER_USER, P11.NOPERM_USER, T]
  );

  // 3. A role bundling every P1-11 permission, granted to maker + approver.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'p1_11_all','P1-11 all permissions',$3) ON CONFLICT (id) DO NOTHING`,
    [P11.ROLE, T, U]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
      WHERE p.permission_code = ANY($4) ON CONFLICT DO NOTHING`,
    [T, P11.ROLE, U, P11_PERMISSIONS.map((p) => p.code)]
  );
  // USER_A granted by the approver, approver granted by USER_A (no self-grant allowed).
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1,$2,$3,$4,$4),($1,$4,$3,$2,$2)
     ON CONFLICT DO NOTHING`,
    [T, U, P11.ROLE, P11.APPROVER_USER]
  );

  // 4. Numbering sequences for invoice + receipt in the committed branch scope.
  await admin.query(
    `INSERT INTO shared.number_sequences (tenant_id, company_id, branch_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1,$2,$3,'invoice','INV-',6,$4),($1,$2,$3,'receipt','RCT-',6,$4)
     ON CONFLICT (tenant_id, sequence_code, company_id, branch_id) DO NOTHING`,
    [T, CO, BR, U]
  );

  // 5. A tenant-A payment method (receipts cannot use a platform method — FK is (tenant_id,id)).
  await admin.query(
    `INSERT INTO sal.payment_methods (id, scope, tenant_id, method_code, kind, display_name, created_by)
     VALUES ($1,'tenant',$2,'p11_cash','cash','P11 Cash',$3) ON CONFLICT (id) DO NOTHING`,
    [P11.PM_CASH, T, U]
  );

  // 6. A committed signature document version for delivery signatures.
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes, default_classification, default_retention_class, created_by)
     VALUES ($1,'tenant',$2,'fx_p11_sig','P11 signatures', ARRAY['application/pdf'], 5000000, 'internal', 'evidence-audit', $3)
     ON CONFLICT (id) DO NOTHING`,
    [P11.SIG_CATEGORY, T, U]
  );
  await admin.query(
    `INSERT INTO shared.documents (id, tenant_id, company_id, branch_id, category_id, title, classification, retention_class, created_by)
     VALUES ($1,$2,$3,$4,$5,'P11 delivery signature','internal','evidence-audit',$6)
     ON CONFLICT (id) DO NOTHING`,
    [P11.SIG_DOCUMENT, T, CO, BR, P11.SIG_CATEGORY, U]
  );
  await admin.query(
    `INSERT INTO shared.document_versions (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,'p11/sig/v1.pdf','application/pdf',2048, decode(repeat('ab',32),'hex'), $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [P11.SIG_DOC_VERSION, T, P11.SIG_DOCUMENT, U]
  );
}

/**
 * Deletes committed P1-11 sal/wty rows for the fixture tenants inside ONE transaction,
 * so the DEFERRABLE header/line reconcile trigger (tg_invoice_line_amounts_reconcile)
 * only evaluates at COMMIT — when the issued invoice and its amounts are all gone and the
 * check short-circuits. deleteTenantCascade (via cleanFixtures) runs each DELETE on the
 * autocommitting admin pool, which would otherwise fire that trigger against a transient
 * "issued invoice with header but no lines" state. Call this BEFORE cleanFixtures in the
 * afterAll of any suite that COMMITS issued invoices (isolation / security / concurrency).
 * Harmless (deletes zero rows) for rolled-back suites.
 */
export async function cleanP111Committed(admin: Pool): Promise<void> {
  const c = await admin.connect();
  const tenants = [TENANT_A, TENANT_B];
  const del = (tbl: string) =>
    c.query(`DELETE FROM ${tbl} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  try {
    await c.query('BEGIN');
    await del('wty.warranty_status_history');
    await del('wty.warranty_record_items');
    await del('wty.warranty_records');
    await del('wty.warranty_coverage');
    await del('wty.warranty_policies');
    await del('sal.financial_events');
    await del('sal.authorized_receivers');
    await del('sal.delivery_signatures');
    await del('sal.delivery_checklist_results');
    await del('sal.delivery_status_history');
    await del('sal.delivery_records');
    await del('sal.delivery_checklist_template_items');
    await del('sal.delivery_checklist_templates');
    await del('sal.payment_allocations');
    await del('sal.receipt_reversals');
    await del('sal.credit_notes');
    await del('sal.receipts');
    await del('sal.invoice_status_history');
    await del('sal.invoice_line_amounts');
    await del('sal.invoice_lines');
    await del('sal.invoice_amounts');
    await del('sal.invoice_numbering_configs');
    await del('sal.invoices');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------------------
// Partners + work orders
// ---------------------------------------------------------------------------

/** A fresh tenant-A partner (never carries a reception role). */
export async function seedPartner(c: Q, tag: string, name = 'P11 Partner'): Promise<string> {
  return (
    await c.query(
      `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
       VALUES ($1,'individual',$2,$3) RETURNING id`,
      [T, `${name} ${tag}`, U]
    )
  ).rows[0].id;
}

/** A unique vehicle + AUTHORIZED reception visit + draft work order (reuses P1-09/P1-10). */
export async function makeWorkOrder(
  c: Q,
  tag: string
): Promise<{ vehicle: string; visit: string; wo: string }> {
  const vehicle = await seedVehicle(c, tag);
  const visit = await makeAuthorizedVisit(c, vehicle);
  const wo = await newWorkOrder(c, visit, { vehicle });
  return { vehicle, visit, wo };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** A draft invoice (structural). Amounts arrive via addInvoiceLine + issue_invoice. */
export async function seedDraftInvoice(
  c: Q,
  opts: { wo: string; payer: string; currency?: string; quotationRevision?: string | null }
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, quotation_revision_id, payer_partner_id, currency_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [T, CO, BR, opts.wo, opts.quotationRevision ?? null, opts.payer, opts.currency ?? 'USD', U]
    )
  ).rows[0].id;
}

/**
 * Adds one invoice line + its restricted amount detail. gross = net + tax;
 * customer_pay + warranty_pay = gross (defaults: all customer). Returns both ids.
 */
export async function addInvoiceLine(
  c: Q,
  invoice: string,
  opts: {
    lineNumber: number;
    net: number | string;
    tax?: number | string;
    lineType?: string;
    quantity?: number;
    unitPrice?: number | string;
    warrantyPay?: number | string;
    currency?: string;
  }
): Promise<{ line: string; amount: string }> {
  const tax = opts.tax ?? 0;
  const line = (
    await c.query(
      `INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity, currency_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        T,
        CO,
        BR,
        invoice,
        opts.lineNumber,
        opts.lineType ?? 'service',
        opts.quantity ?? 1,
        opts.currency ?? 'USD',
        U,
      ]
    )
  ).rows[0].id;
  const amount = (
    await c.query(
      `INSERT INTO sal.invoice_line_amounts
         (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price, net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, round($7::numeric + $8::numeric, 4),
               round($7::numeric + $8::numeric, 4) - $9::numeric, $9::numeric, $10)
       RETURNING id`,
      [
        T,
        CO,
        BR,
        line,
        invoice,
        opts.unitPrice ?? opts.net,
        opts.net,
        tax,
        opts.warrantyPay ?? 0,
        U,
      ]
    )
  ).rows[0].id;
  return { line, amount };
}

/** Issues a draft invoice; returns the allocated number. */
export async function issueInvoice(c: Q, invoice: string, correlationId?: string): Promise<string> {
  return (await c.query(`SELECT sal.issue_invoice($1,$2) AS n`, [invoice, correlationId ?? null]))
    .rows[0].n;
}

/** Convenience: a draft invoice with a single net/tax line, ready to issue. */
export async function seedInvoiceWithLine(
  c: Q,
  tag: string,
  opts: {
    net: number | string;
    tax?: number | string;
    warrantyPay?: number | string;
    payer?: string;
  } = {
    net: 100,
  }
): Promise<{ invoice: string; wo: string; vehicle: string; visit: string; payer: string }> {
  const { wo, vehicle, visit } = await makeWorkOrder(c, tag);
  const payer = opts.payer ?? P9.SR;
  const invoice = await seedDraftInvoice(c, { wo, payer });
  await addInvoiceLine(c, invoice, {
    lineNumber: 1,
    net: opts.net,
    ...(opts.tax !== undefined && { tax: opts.tax }),
    ...(opts.warrantyPay !== undefined && { warrantyPay: opts.warrantyPay }),
  });
  return { invoice, wo, vehicle, visit, payer };
}

// ---------------------------------------------------------------------------
// Receipts / allocation / credit / reversal
// ---------------------------------------------------------------------------

export async function seedReceipt(
  c: Q,
  opts: {
    amount: number | string;
    payer: string;
    currency?: string;
    method?: string;
    idempotencyKey?: string;
  }
): Promise<string> {
  return (
    await c.query(`SELECT sal.record_receipt($1,$2,$3,$4,$5,$6,NULL,$7,NULL) AS id`, [
      CO,
      BR,
      opts.method ?? P11.PM_CASH,
      opts.payer,
      opts.currency ?? 'USD',
      opts.amount,
      opts.idempotencyKey ?? null,
    ])
  ).rows[0].id;
}

export async function allocateReceipt(
  c: Q,
  receipt: string,
  invoice: string,
  amount: number | string
): Promise<string> {
  return (await c.query(`SELECT sal.allocate_receipt($1,$2,$3) AS id`, [receipt, invoice, amount]))
    .rows[0].id;
}

/** Inserts a PENDING credit note (maker stamped from context). Returns id. */
export async function seedCreditNote(
  c: Q,
  invoice: string,
  amount: number | string,
  opts: { currency?: string; reason?: string } = {}
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO sal.credit_notes (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [T, CO, BR, invoice, opts.currency ?? 'USD', amount, opts.reason ?? 'p11 credit', U]
    )
  ).rows[0].id;
}

/** Inserts a PENDING receipt reversal (maker stamped from context). Returns id. */
export async function seedReversal(
  c: Q,
  receipt: string,
  amount: number | string,
  opts: { currency?: string; reason?: string } = {}
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO sal.receipt_reversals (tenant_id, company_id, branch_id, original_receipt_id, currency_code, amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [T, CO, BR, receipt, opts.currency ?? 'USD', amount, opts.reason ?? 'p11 reversal', U]
    )
  ).rows[0].id;
}

// ---------------------------------------------------------------------------
// Delivery (granular so failure paths can be crafted)
// ---------------------------------------------------------------------------

export async function insertDeliveryRecord(
  c: Q,
  opts: { wo: string; vehicle: string; visit: string }
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO sal.delivery_records (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id, delivering_employee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [T, CO, BR, opts.wo, opts.visit, opts.vehicle, U]
    )
  ).rows[0].id;
}

/** A tenant/company checklist template with one MANDATORY item. Returns both ids. */
export async function insertMandatoryChecklist(
  c: Q,
  tag: string
): Promise<{ template: string; item: string }> {
  const template = (
    await c.query(
      `INSERT INTO sal.delivery_checklist_templates (tenant_id, company_id, template_code, name, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [T, CO, `tpl_${tag}`, `Template ${tag}`, U]
    )
  ).rows[0].id;
  const item = (
    await c.query(
      `INSERT INTO sal.delivery_checklist_template_items (tenant_id, company_id, template_id, item_code, label, is_mandatory, created_by)
       VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING id`,
      [T, CO, template, `itm_${tag}`, `Item ${tag}`, U]
    )
  ).rows[0].id;
  return { template, item };
}

/**
 * Records a 'passed' result on this delivery for EVERY mandatory template item in the
 * company that lacks one. complete_delivery evaluates all company-mandatory items, so a
 * committed leftover from an earlier test must be satisfied too.
 */
export async function passAllMandatory(c: Q, delivery: string): Promise<void> {
  await c.query(
    `INSERT INTO sal.delivery_checklist_results (tenant_id, company_id, branch_id, delivery_record_id, template_item_id, outcome, recorded_by, created_by)
     SELECT $1,$2,$3,$4, ti.id, 'passed', $5, $5
       FROM sal.delivery_checklist_template_items ti
      WHERE ti.tenant_id=$1 AND ti.company_id=$2 AND ti.is_mandatory AND ti.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM sal.delivery_checklist_results r
                         WHERE r.tenant_id=$1 AND r.company_id=$2 AND r.branch_id=$3
                           AND r.delivery_record_id=$4 AND r.template_item_id=ti.id)`,
    [T, CO, BR, delivery, U]
  );
}

export async function insertAuthorizedReceiver(
  c: Q,
  delivery: string,
  receiver: string
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO sal.authorized_receivers (tenant_id, company_id, branch_id, delivery_record_id, receiver_partner_id, verified_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [T, CO, BR, delivery, receiver, U]
    )
  ).rows[0].id;
}

export async function insertSignature(c: Q, delivery: string, role = 'receiver'): Promise<string> {
  return (
    await c.query(
      `INSERT INTO sal.delivery_signatures (tenant_id, company_id, branch_id, delivery_record_id, signer_role, signature_document_version_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [T, CO, BR, delivery, role, P11.SIG_DOC_VERSION, U]
    )
  ).rows[0].id;
}

export async function completeDelivery(c: Q, delivery: string, odometer = 100000): Promise<string> {
  return (await c.query(`SELECT sal.complete_delivery($1,$2,'km') AS odo`, [delivery, odometer]))
    .rows[0].odo;
}

/**
 * A READY delivery with the mandatory checklist passed, an authorized receiver (the
 * visit's approving party by default), and a signature — every gate satisfied but NOT
 * completed. opts let a test omit a gate to prove it blocks completion.
 */
export async function buildReadyDelivery(
  c: Q,
  tag: string,
  opts: {
    receiver?: string;
    addChecklistResults?: boolean;
    addReceiver?: boolean;
    addSignature?: boolean;
    mandatory?: boolean;
  } = {}
): Promise<{
  delivery: string;
  wo: string;
  vehicle: string;
  visit: string;
  item: string;
  receiver: string;
}> {
  const { wo, vehicle, visit } = await makeWorkOrder(c, tag);
  const delivery = await insertDeliveryRecord(c, { wo, vehicle, visit });
  const { item } = await insertMandatoryChecklist(c, tag);
  if (opts.addChecklistResults ?? true) await passAllMandatory(c, delivery);
  const receiver = opts.receiver ?? P9.AP; // approving party holds an active reception role
  if (opts.addReceiver ?? true) await insertAuthorizedReceiver(c, delivery, receiver);
  if (opts.addSignature ?? true) await insertSignature(c, delivery);
  return { delivery, wo, vehicle, visit, item, receiver };
}

/** A COMPLETED (delivered) delivery — custody released, odometer captured. */
export async function seedCompletedDelivery(
  c: Q,
  tag: string,
  opts: { odometer?: number } = {}
): Promise<{ delivery: string; wo: string; vehicle: string; visit: string; odometer: string }> {
  const b = await buildReadyDelivery(c, tag);
  const odometer = await completeDelivery(c, b.delivery, opts.odometer ?? 100000);
  return { delivery: b.delivery, wo: b.wo, vehicle: b.vehicle, visit: b.visit, odometer };
}

// ---------------------------------------------------------------------------
// Warranty
// ---------------------------------------------------------------------------

export async function seedWarrantyPolicy(c: Q, tag: string): Promise<string> {
  return (
    await c.query(
      `INSERT INTO wty.warranty_policies (tenant_id, company_id, policy_code, name, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [T, CO, `pol_${tag}`, `Policy ${tag}`, U]
    )
  ).rows[0].id;
}

export async function seedWarrantyCoverage(
  c: Q,
  policy: string,
  opts: {
    scope?: string;
    durationMonths?: number;
    odometerLimit?: number | null;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  } = {}
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO wty.warranty_coverage (tenant_id, company_id, policy_id, covered_scope, duration_months, odometer_limit, effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9) RETURNING id`,
      [
        T,
        CO,
        policy,
        opts.scope ?? 'all',
        opts.durationMonths ?? 12,
        opts.odometerLimit ?? null,
        opts.effectiveFrom ?? '2026-01-01',
        opts.effectiveTo ?? null,
        U,
      ]
    )
  ).rows[0].id;
}

export async function issueWarranty(
  c: Q,
  delivery: string,
  policy: string,
  idempotencyKey?: string
): Promise<string> {
  return (
    await c.query(`SELECT wty.issue_warranty($1,$2,NULL,$3) AS id`, [
      delivery,
      policy,
      idempotencyKey ?? null,
    ])
  ).rows[0].id;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export async function seedReportConfig(
  c: Q,
  tag: string,
  opts: { scopeLevel?: string; exportPermission?: string; owner?: string; status?: string } = {}
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO rpt.report_configurations (tenant_id, report_code, name, scope_level, export_permission_code, owner_user_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        T,
        `rpt_${tag}`,
        `Report ${tag}`,
        opts.scopeLevel ?? 'branch',
        opts.exportPermission ?? 'rpt.export',
        opts.owner ?? U,
        opts.status ?? 'draft',
        U,
      ]
    )
  ).rows[0].id;
}

export async function seedReportVersion(
  c: Q,
  config: string,
  opts: { versionNumber?: number; status?: string } = {}
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO rpt.report_configuration_versions (tenant_id, report_configuration_id, version_number, status, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [T, config, opts.versionNumber ?? 1, opts.status ?? 'draft', U]
    )
  ).rows[0].id;
}

export async function seedSavedFilter(
  c: Q,
  opts: { config: string; owner?: string; name?: string; scopeLevel?: string }
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO rpt.saved_filters (tenant_id, report_configuration_id, owner_user_id, name, scope_level, created_by)
       VALUES ($1,$2,$3,$4,$5,$3) RETURNING id`,
      [T, opts.config, opts.owner ?? U, opts.name ?? 'f1', opts.scopeLevel ?? 'branch']
    )
  ).rows[0].id;
}

export { TENANT_A, TENANT_B, COMPANY_A1, BRANCH_A1, USER_A, USER_B, P9 };
