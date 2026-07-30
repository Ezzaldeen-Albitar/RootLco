/**
 * Vehicle handover — delivery records, eligibility and completion
 * (Phase 1-22 — P1-22-BE-013…017).
 *
 * This is the surface at which a vehicle physically leaves the workshop, so the
 * assertions are on the STATE OF THE WORLD after the call — the delivery row, the
 * custody chain, the audit trail and the outbox — and not on the HTTP status. A 200
 * proves the handler returned; only `sal.delivery_records.status`, the
 * `vehicle.delivered` event count and the derived invoice balance prove the right
 * thing happened.
 *
 * ## The financial blocker is the reason this file exists
 *
 * `sal.complete_delivery` enforces exactly three preconditions — a verified receiver,
 * every mandatory checklist item passed or waived, and at least one signature — and
 * reads **no work-order state, no quality control and no financial balance at all**
 * (verified against the deployed body in
 * `supabase/migrations/20260724094000_sal_delivery.sql`). So the gate that stops a
 * vehicle being handed to a customer with an unpaid issued invoice exists ONLY in
 * `DeliveryReadService.composeFor`, and deleting it would not fail a single database
 * constraint. Four tests here are about that single fact: the blocker appears while an
 * issued invoice is open, it disappears when the invoice is settled, completion is
 * REFUSED while it is present, and it can be crossed only through an explicit,
 * authorised, RECORDED override. If any of the four regresses, the platform releases
 * vehicles against unpaid invoices in silence.
 *
 * ## Three properties every assertion respects
 *
 *  - **Money is compared as an exact decimal STRING, beside its currency.** No
 *    `Number`, `parseFloat`, `toFixed` or arithmetic touches an amount anywhere in
 *    this file. `numeric(18,4)` holds values IEEE-754 cannot represent, and
 *    PostgreSQL silently ROUNDS a fifth decimal away rather than erroring — so a
 *    `Number`-based assertion would keep passing against an implementation that lost a
 *    digit. The odometer reading is held to the same rule for the same reason: it is
 *    `numeric(12,1)` and a warranty's absolute odometer limit is later measured from it.
 *  - **Every audit and outbox count is a DELTA.** The fixtures drive the real
 *    reception-conversion, invoice-issue and payment routes, all of which write real
 *    audit and outbox rows, so a tenant-wide absolute count would be measuring
 *    arrangement. Each "exactly once" claim is measured before and after AND pinned to
 *    the specific aggregate.
 *  - **A refusal is asserted with its catalog code.** A 409 from the one-live-delivery
 *    index and a 409 from an unpaid balance are different answers to a client.
 *
 * ## The version guard was VACUOUS when this suite was written
 *
 * `sal.delivery-complete` registers `versionGuarded: true`, which makes `If-Match`
 * mandatory — and the route originally parsed the header and never forwarded it, so
 * `DeliveryService.completeDelivery`'s comparison was skipped on every request and a
 * STALE version was accepted. Every test that sends a CORRECT version passes either
 * way, which is exactly why it survived. The route now forwards `expectedVersion` and
 * the assertion below holds; it is kept because it is the only test in this file that
 * would have caught it. See the note above "refuses a stale If-Match".
 *
 * COVERAGE-EVIDENCE (P1-22 delivery):
 *   sal.delivery-create: route service authorization success denial audit idempotency isolation cross-tenant
 *   sal.delivery-eligibility-read: route service authorization success denial isolation cross-tenant
 *   sal.delivery-receiver-verify: route service authorization success denial audit idempotency isolation cross-tenant
 *   sal.delivery-checklist-record: route service authorization success denial audit idempotency isolation cross-tenant
 *   sal.delivery-signature-attach: route service authorization success denial audit idempotency isolation cross-tenant
 *   sal.delivery-complete: route service authorization success denial audit outbox idempotency isolation cross-tenant stale-version
 *
 * `sal.delivery-create` declares no `outbox` flag, and that is deliberate rather than
 * an omission: opening a delivery publishes nothing — `vehicle.delivered` is the only
 * event the delivery module registers, and a prepared handover is not yet a fact any
 * consumer may act on. A test here asserts that absence as a delta of zero, but the
 * flag would claim an event this operation does not have.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import {
  BRANCH_A2,
  FULL,
  advance,
  establishP1_19Fixtures,
  seedDocumentVersion,
  type Principal,
} from './p1-19-helpers';
import {
  BRANCH_A9,
  PARTNER_A,
  PAYMENT_METHOD_A,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_NO_FINANCE,
  SAL_READER,
  SAL_TENANT_B,
  SIGNATURE_DOCUMENT_VERSION,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  outboxCountFor,
  linkSignatureDocumentToWorkOrder,
  seedIssuedInvoice,
  seedWorkOrderChain,
  type IssuedInvoice,
  type WorkOrderChain,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_DELIVERY } from '@/app/api/v1/deliveries/route';
import {
  DELIVERY_ELIGIBILITY_OPERATION,
  GET as READ_ELIGIBILITY,
} from '@/app/api/v1/deliveries/[deliveryId]/eligibility/route';
import { POST as VERIFY_RECEIVER } from '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';
import { POST as RECORD_CHECKLIST } from '@/app/api/v1/deliveries/[deliveryId]/checklist-results/route';
import { POST as ATTACH_SIGNATURE } from '@/app/api/v1/deliveries/[deliveryId]/signatures/route';
import { POST as COMPLETE_DELIVERY } from '@/app/api/v1/deliveries/[deliveryId]/completion/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';

let admin: Pool;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface DeliveryBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  readonly deliveringEmployeeId: string;
  readonly status: string;
  readonly deliveredAt: string | null;
  readonly finalOdometerReadingId: string | null;
  readonly recordVersion: number;
  readonly replayed: boolean;
}

interface EligibilityBody {
  readonly deliveryId: string;
  readonly workOrderId: string;
  readonly status: string;
  readonly eligible: boolean;
  readonly blockers: readonly string[];
  readonly overridden: readonly string[];
  readonly facts: readonly {
    readonly blocker: string;
    readonly established: boolean;
    readonly source: string;
  }[];
  readonly checklistGaps: readonly { readonly templateItemId: string; readonly itemCode: string }[];
  readonly overridable: readonly { readonly code: string; readonly permission: string }[];
}

interface ReceiverBody {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly receiverPartnerId: string;
  readonly identityEvidenceDocumentVersionId: string | null;
  readonly verifiedAt: string;
  readonly deliveryStatus: string;
  readonly replayed: boolean;
}

interface ChecklistBody {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly templateItemId: string;
  readonly itemCode: string;
  readonly outcome: string;
  readonly waiverReason: string | null;
  readonly replayed: boolean;
}

interface SignatureBody {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly signerRole: string;
  readonly signatureDocumentVersionId: string;
  readonly signedAt: string;
  readonly deliveryStatus: string;
  readonly replayed: boolean;
}

interface CompletionBody {
  readonly deliveryId: string;
  readonly status: string;
  readonly deliveredAt: string | null;
  readonly finalOdometerReadingId: string | null;
  readonly overridden: readonly string[];
  readonly recordVersion: number;
  readonly replayed: boolean;
}

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface ReceiptBody {
  readonly id: string;
  readonly money: MoneyBody;
}

interface AllocationBody {
  readonly id: string;
  readonly money: MoneyBody;
}

/**
 * The problem document, and note what it does NOT have.
 *
 * `problemFor` assembles the body from the catalog entry plus `safeDetails` and reads
 * no other field of the thrown failure, so there is no `detail`, `message` or `error`
 * key — a refusal cannot leak a trigger name, a constraint name or a SQL fragment BY
 * CONSTRUCTION rather than by review. Every "caller-safe refusal" assertion below is
 * therefore made against the whole serialised document, and no test asserts on prose
 * the wire contract does not carry.
 */
interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly code: string;
  readonly status: number;
  readonly correlationId: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
  readonly requiredPermissions?: readonly string[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/**
 * Every token a refusal on these paths could leak from the protected schema.
 *
 * Asserted against the SERIALISED problem document rather than one field, so a future
 * edit that added a free-text `detail` would have to keep it clean to stay green.
 */
const LEAK_TOKENS: readonly string[] = Object.freeze([
  'guard_authorized_receiver',
  'guard_delivery_coherence',
  'tg_authorized_receivers_validate',
  'tg_delivery_records_coherence',
  'ck_delivery_checklist_results_waiver',
  'uq_delivery_records_work_order_active',
  'uq_authorized_receivers_delivery',
  'uq_delivery_checklist_results_item',
  'complete_delivery',
  'reception_party_roles',
  'check_violation',
  'unique_violation',
  '23505',
  '23514',
  '23503',
  'SQLSTATE',
  'pg_',
]);

function expectNoSchemaLeak(problem: ProblemBody): void {
  const serialised = JSON.stringify(problem);
  for (const token of LEAK_TOKENS) {
    expect(serialised, `the problem document must not name ${token}`).not.toContain(token);
  }
  // It still says something a client can act on: a stable code and a caller-safe title.
  expect(problem.title.length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Local fixtures. Everything here is either absent from `p1-22-helpers.ts` or
// deliberately NOT shared, and every id is unwound by `cleanBackendFixtures`.
// ---------------------------------------------------------------------------

/**
 * A tenant-A principal holding `sal.delivery.manage` and NOT `sal.delivery.complete`.
 *
 * Defined here rather than in the shared helpers because it exists for ONE claim:
 * completion is a separate authority from preparation. `SAL_READER` holds neither of
 * the two, so a refusal from it could not tell them apart — it would pass unchanged
 * against a route that required only `sal.delivery.manage`. This principal holds
 * everything the completion route needs EXCEPT the one permission under test,
 * including `sal.finance.view`, so the 403 can only be about `sal.delivery.complete`.
 */
/**
 * Holds `sal.delivery.complete` and NOT `sal.delivery.manage` — the realistic split
 * where one person prepares a handover and another authorises it.
 *
 * This is the principal the version-reachability regression needs: it can call neither
 * `POST /deliveries` nor either preparation write, so every route that used to carry a
 * version was closed to it.
 */
const DELIVERY_COMPLETER_ONLY: Principal = {
  roleId: 'f1229999-0000-4000-8000-000000000111',
  userId: 'f1229999-0000-4000-8000-000000000112',
  subject: 'fx_p122_dlv_complete_only',
  tenantId: TENANT_A,
  permissions: [
    'sal.delivery.complete',
    'sal.delivery.view',
    'sal.finance.view',
    'wo.work_order.read',
  ],
};

const DELIVERY_MANAGER_ONLY: Principal = {
  roleId: 'f1229999-0000-4000-8000-000000000101',
  userId: 'f1229999-0000-4000-8000-000000000102',
  subject: 'fx_p122_dlv_manage_only',
  tenantId: TENANT_A,
  permissions: [
    'sal.delivery.manage',
    'sal.delivery.view',
    'sal.finance.view',
    'wo.work_order.read',
  ],
};

/** The checklist template this suite configures in `COMPANY_A1`. */
const TEMPLATE_ID = 'f1229999-0000-4000-8000-0000000002a1';
const TEMPLATE_CODE = 'fx_p122_dlv_handover';
/** MANDATORY. The only reason `checklist_incomplete` is reachable at all. */
const ITEM_MANDATORY_CODE = 'fx_dlv_mandatory';
/** Three OPTIONAL items, so the waiver biconditional and the re-record refusal can
 * each use one without a completion gate depending on them. */
const ITEM_OPTIONAL_CODES = Object.freeze([
  'fx_dlv_optional_a',
  'fx_dlv_optional_b',
  'fx_dlv_optional_c',
] as const);
const [OPTIONAL_A, OPTIONAL_B, OPTIONAL_C] = ITEM_OPTIONAL_CODES;

const itemIds = new Map<string, string>();

/** A tenant-A partner holding NO reception party role on any visit. */
const OUTSIDER_PARTNER = 'f1229999-0000-4000-8000-0000000003a1';

/** A tenant-A document version in `COMPANY_A1` / `BRANCH_A2`. */
const FOREIGN_BRANCH_CATEGORY = 'f1229999-0000-4000-8000-0000000004a1';
const FOREIGN_BRANCH_DOCUMENT = 'f1229999-0000-4000-8000-0000000004a2';
const FOREIGN_BRANCH_VERSION = 'f1229999-0000-4000-8000-0000000004a3';
/** A TENANT-B document version, so the tenant half of the check has a real row. */
let tenantBVersionId = '';

/** Seeds one principal: account, role, its permissions, and an unrestricted grant. */
async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-22 delivery principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-22 delivery fixture',$4) ON CONFLICT (id) DO NOTHING`,
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

/**
 * One checklist template in `COMPANY_A1` with one MANDATORY item and three optional
 * ones.
 *
 * Admin SQL and necessarily so: `sal.delivery_checklist_templates` and its items are
 * operator configuration and this phase registers no write route for either. What
 * matters is that the rows are the real shape `sal.complete_delivery` scans.
 *
 * Exactly ONE mandatory item, and that is a decision rather than economy: the
 * primitive's mandatory scan is COMPANY-scoped rather than template-scoped, so every
 * mandatory item added here blocks every in-flight delivery in `COMPANY_A1` for the
 * whole suite. `passEveryMandatoryItem` therefore records against whatever the company
 * actually holds instead of against a remembered list.
 */
async function seedChecklistTemplate(): Promise<void> {
  await admin.query(
    `INSERT INTO sal.delivery_checklist_templates
       (id, tenant_id, company_id, template_code, name, created_by)
     VALUES ($1,$2,$3,$4,'P1-22 handover checklist',$5)
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_ID, TENANT_A, COMPANY_A1, TEMPLATE_CODE, USER_A]
  );
  const codes = [ITEM_MANDATORY_CODE, ...ITEM_OPTIONAL_CODES];
  for (const [index, code] of codes.entries()) {
    await admin.query(
      `INSERT INTO sal.delivery_checklist_template_items
         (tenant_id, company_id, template_id, item_code, label, is_mandatory, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, template_id, item_code) WHERE deleted_at IS NULL DO NOTHING`,
      [
        TENANT_A,
        COMPANY_A1,
        TEMPLATE_ID,
        code,
        `P1-22 ${code}`,
        code === ITEM_MANDATORY_CODE,
        index,
        USER_A,
      ]
    );
  }
  const rows = await admin.query<{ id: string; item_code: string }>(
    `SELECT id, item_code FROM sal.delivery_checklist_template_items
      WHERE tenant_id = $1 AND template_id = $2 AND deleted_at IS NULL`,
    [TENANT_A, TEMPLATE_ID]
  );
  for (const row of rows.rows) itemIds.set(row.item_code, row.id);
}

const itemId = (code: string): string => {
  const id = itemIds.get(code);
  if (id === undefined) throw new Error(`checklist item ${code} was not seeded`);
  return id;
};

/**
 * A second tenant-A business partner, with NO reception party role anywhere.
 *
 * `sal.guard_authorized_receiver` demands a live `rec.reception_party_roles` row on
 * the delivery's own visit, and `rec.accept_check_in` creates exactly one — for
 * `PARTNER_A`. So the refusal is unreachable without a partner that exists, is
 * visible, and holds no role: an invented uuid would be refused by
 * `fk_authorized_receivers_partner` as `23503` and would prove the foreign key rather
 * than the guard.
 */
async function seedOutsiderPartner(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO crm.business_partners
         (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','P1-22 unauthorised collector','active',$3)
       ON CONFLICT (id) DO NOTHING`,
      [OUTSIDER_PARTNER, TENANT_A, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A document version in tenant A but in `BRANCH_A2`.
 *
 * The shared fixture's version is tenant-wide-visible and in `BRANCH_A1`, so it can
 * only ever prove the accepting half. This one is IN THE SAME TENANT — so RLS admits
 * it and `verifyEvidenceVersion` resolves it — and names a different branch, which is
 * the only way to reach `requireUsableDocumentVersion`'s company/branch comparison
 * rather than its tenant refusal.
 */
async function seedForeignBranchDocumentVersion(): Promise<void> {
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ($1,'tenant',$2,'fx_p122_dlv_sig_a2','P1-22 delivery signatures (A2)',
             ARRAY['application/pdf']::text[], 5000000, 'internal', 'evidence-audit', $3)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_BRANCH_CATEGORY, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, company_id, branch_id, category_id, title, classification,
        retention_class, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'P1-22 signature in another branch','internal','evidence-audit',
             'pending',$6)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_BRANCH_DOCUMENT, TENANT_A, COMPANY_A1, BRANCH_A2, FOREIGN_BRANCH_CATEGORY, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes,
        sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,'p122/sig-a2/v1.pdf','application/pdf',2048,
             decode(repeat('cd',32),'hex'),$4,$4)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_BRANCH_VERSION, TENANT_A, FOREIGN_BRANCH_DOCUMENT, USER_A]
  );
}

// ---------------------------------------------------------------------------
// Route drivers
// ---------------------------------------------------------------------------

const createDelivery = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_DELIVERY(
    new Request('http://localhost/api/v1/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const readEligibility = (deliveryId: string, query = ''): Promise<Response> =>
  READ_ELIGIBILITY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/eligibility${query}`),
    { params: Promise.resolve({ deliveryId }) }
  );

const verifyReceiver = (
  deliveryId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  VERIFY_RECEIVER(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/authorized-receiver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const recordChecklist = (
  deliveryId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  RECORD_CHECKLIST(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/checklist-results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const attachSignature = (
  deliveryId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  ATTACH_SIGNATURE(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/signatures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

/** `sal.delivery-complete` is `versionGuarded`, so `If-Match` is mandatory. */
const completeDelivery = (
  deliveryId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return COMPLETE_DELIVERY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/completion`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );
};

const recordPayment = (body: unknown): Promise<Response> =>
  RECORD_PAYMENT(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(body),
    })
  );

const allocatePayment = (paymentId: string, body: unknown): Promise<Response> =>
  ALLOCATE_PAYMENT(
    new Request(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ paymentId }) }
  );

// ---------------------------------------------------------------------------
// Read-backs and deltas. Admin reads — never RLS evidence.
// ---------------------------------------------------------------------------

/** Audit rows for ONE action across the database, for a before/after delta. */
const auditTotalFor = (action: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1`, [action]);

/** Outbox rows for ONE event type, for a before/after delta. */
const outboxTotalFor = (eventType: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_type = $1`, [
    eventType,
  ]);

interface DeliveryRow {
  readonly status: string;
  readonly recordVersion: number;
  readonly deliveredAt: string | null;
  readonly finalOdometerReadingId: string | null;
}

async function deliveryRow(deliveryId: string): Promise<DeliveryRow | null> {
  const result = await admin.query<{
    status: string;
    record_version: number;
    delivered_at: string | null;
    final_odometer_reading_id: string | null;
  }>(
    `SELECT status, record_version, delivered_at::text AS delivered_at, final_odometer_reading_id
       FROM sal.delivery_records WHERE id = $1`,
    [deliveryId]
  );
  const row = result.rows[0];
  return row
    ? {
        status: row.status,
        recordVersion: row.record_version,
        deliveredAt: row.delivered_at,
        finalOdometerReadingId: row.final_odometer_reading_id,
      }
    : null;
}

const currentVersion = async (deliveryId: string): Promise<number> => {
  const row = await deliveryRow(deliveryId);
  if (row === null) throw new Error(`delivery ${deliveryId} vanished`);
  return row.recordVersion;
};

interface AuditDetailRow {
  readonly fieldName: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly classification: string;
}

/** The stored (already masked) details of one audit record. */
async function auditDetails(action: string, entityId: string): Promise<readonly AuditDetailRow[]> {
  const result = await admin.query<{
    field_name: string;
    old_value_masked: string | null;
    new_value_masked: string | null;
    value_classification: string;
  }>(
    `SELECT d.field_name, d.old_value_masked, d.new_value_masked, d.value_classification
       FROM iam.audit_record_details d
       JOIN iam.audit_records a ON a.tenant_id = d.tenant_id AND a.id = d.audit_record_id
      WHERE a.action = $1 AND a.entity_id = $2
      ORDER BY d.field_name`,
    [action, entityId]
  );
  return result.rows.map((row) => ({
    fieldName: row.field_name,
    oldValue: row.old_value_masked,
    newValue: row.new_value_masked,
    classification: row.value_classification,
  }));
}

const detailValue = (
  details: readonly AuditDetailRow[],
  field: string
): string | null | undefined => details.find((detail) => detail.fieldName === field)?.newValue;

async function outboxPayload(eventKey: string): Promise<Record<string, unknown> | null> {
  const result = await admin.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM shared.event_outbox WHERE event_key = $1`,
    [eventKey]
  );
  return result.rows[0]?.payload ?? null;
}

/** `veh.odometer_readings` as exact strings. A reading is never a JavaScript number. */
async function odometerReading(
  readingId: string
): Promise<{ value: string; unit: string; captureMethod: string } | null> {
  const result = await admin.query<{ value: string; unit: string; capture_method: string }>(
    `SELECT value::text AS value, unit, capture_method FROM veh.odometer_readings WHERE id = $1`,
    [readingId]
  );
  const row = result.rows[0];
  return row ? { value: row.value, unit: row.unit, captureMethod: row.capture_method } : null;
}

/**
 * A run of characters that could only be encoded binary.
 *
 * 60 is chosen against the actual shapes on these paths rather than arbitrarily: a
 * uuid's longest hyphen-free run is 12 characters and the longest field name in any
 * detail or payload here is 22, while JSON punctuation (`"`, `,`, `:`) is outside the
 * base64 alphabet and breaks every run. So a match means genuinely encoded content.
 */
const BASE64_SHAPED = /[A-Za-z0-9+/]{60,}={0,2}/;

/** Keys that would mean the payload carries the mark itself rather than a pointer. */
const CONTENT_SHAPED_KEY = /signature_?data|imagedata|base64|bytes|content|blob|raw/i;

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

/** Opens a delivery through the real route and fails loudly if arrangement broke. */
async function openDelivery(workOrderId: string): Promise<DeliveryBody> {
  // Give the shared signature document real provenance against this work order.
  // `requireUsableDocumentVersion` requires the document to be attached to the delivery's
  // work order or reception visit, so one unlinked version can no longer serve as the
  // signature of every delivery in the suite — which is what it used to do, across
  // different work orders, visits, vehicles and customers, successfully.
  await linkSignatureDocumentToWorkOrder(workOrderId);
  authAs(SAL_FULL);
  const response = await createDelivery({ workOrderId, deliveringEmployeeId: USER_A });
  if (response.status !== 201) {
    throw new Error(
      `fixture delivery for work order ${workOrderId} failed with ${response.status}: ` +
        `${await response.text()}`
    );
  }
  return bodyOf<DeliveryBody>(response);
}

/**
 * Drives a work order to `closed` through the real transition route.
 *
 * Arrangement, and through the route on purpose: an admin UPDATE would have to satisfy
 * `wo.guard_work_order_transition` and `wo.guard_work_order_closure` anyway and would
 * additionally have to set `app.status_reason` by hand — reproducing in the fixture the
 * mechanism that makes `work_order_not_complete` a real fact. No blocker B1..B6 fires
 * on a work order with no jobs, no labour and no mandatory QC check configured, which
 * is exactly the state this suite's fixtures are in.
 */
const CLOSURE_PATH = [
  { toState: 'open' },
  { toState: 'in_progress' },
  { toState: 'qc_pending' },
  { toState: 'ready_to_close' },
] as const;

async function closeWorkOrder(workOrderId: string): Promise<void> {
  // The last edge is NOT on `.../transition`: `WorkOrderService` checks the target
  // state against the command it arrived on and refuses a terminal non-cancellation
  // state there (`closure_requires_closure_operation`), because ending the workshop's
  // liability is its own authority behind `wo.work_order.close`. So the fixture takes
  // the same route a client must.
  const version = await advance(workOrderId, CLOSURE_PATH, FULL);
  authAs(FULL);
  const response = await CLOSE_WORK_ORDER(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/closure`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'if-match': String(version),
      },
      body: JSON.stringify({ toState: 'closed' }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (response.status !== 200) {
    throw new Error(
      `fixture closure of ${workOrderId} failed with ${response.status}: ${await response.text()}`
    );
  }
}

/** Records `passed` against every mandatory item the DELIVERY's company holds. */
async function passEveryMandatoryItem(deliveryId: string): Promise<void> {
  const items = await admin.query<{ id: string }>(
    `SELECT id FROM sal.delivery_checklist_template_items
      WHERE tenant_id = $1 AND company_id = $2 AND is_mandatory AND deleted_at IS NULL`,
    [TENANT_A, COMPANY_A1]
  );
  if (items.rowCount === 0) {
    throw new Error('no mandatory checklist item exists, so checklist_incomplete is untestable');
  }
  for (const item of items.rows) {
    authAs(SAL_FULL);
    const response = await recordChecklist(deliveryId, {
      templateItemId: item.id,
      outcome: 'passed',
    });
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(
        `fixture checklist pass failed with ${response.status}: ${await response.text()}`
      );
    }
  }
}

/**
 * Verifies `PARTNER_A` and binds the shared signature version.
 *
 * The provenance link is created by `openDelivery`, so it covers every signature site in
 * the suite rather than only this one.
 */
async function satisfyReceiverAndSignature(deliveryId: string): Promise<void> {
  authAs(SAL_FULL);
  const receiver = await verifyReceiver(deliveryId, { receiverPartnerId: PARTNER_A });
  if (receiver.status !== 201) {
    throw new Error(
      `fixture receiver verification failed with ${receiver.status}: ${await receiver.text()}`
    );
  }
  authAs(SAL_FULL);
  const signature = await attachSignature(deliveryId, {
    signerRole: 'receiver',
    signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
  });
  if (signature.status !== 201) {
    throw new Error(`fixture signature failed with ${signature.status}: ${await signature.text()}`);
  }
}

/** Settles an issued invoice through the real payment routes. */
async function settleInvoice(invoice: IssuedInvoice): Promise<void> {
  authAs(SAL_FULL);
  const recorded = await recordPayment({
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    paymentMethodId: PAYMENT_METHOD_A,
    payerPartnerId: PARTNER_A,
    currency: invoice.currencyCode,
    amount: invoice.gross,
  });
  if (recorded.status !== 201) {
    throw new Error(`fixture receipt failed with ${recorded.status}: ${await recorded.text()}`);
  }
  const receipt = await bodyOf<ReceiptBody>(recorded);
  authAs(SAL_FULL);
  const allocated = await allocatePayment(receipt.id, {
    invoiceId: invoice.invoiceId,
    amount: invoice.gross,
    currency: invoice.currencyCode,
  });
  if (allocated.status !== 201) {
    throw new Error(
      `fixture allocation failed with ${allocated.status}: ${await allocated.text()}`
    );
  }
  const allocation = await bodyOf<AllocationBody>(allocated);
  // Exact decimal STRING and its currency — the amount alone is half an assertion.
  expect(allocation.money.amount).toBe(invoice.gross);
  expect(allocation.money.currency).toBe(invoice.currencyCode);
}

interface HandoverFixture {
  readonly invoice: IssuedInvoice;
  readonly delivery: DeliveryBody;
}

/**
 * A delivery with EVERY non-financial blocker cleared, on a CLOSED work order that
 * carries an issued invoice.
 *
 * `settled` decides the one remaining fact. That split is the whole design of the
 * financial tests: with everything else satisfied, `blockers` is either exactly
 * `['financial_balance_outstanding']` or exactly `[]`, so the assertion is about that
 * blocker and nothing else.
 */
async function handoverReady(
  tag: string,
  options: { readonly settled: boolean }
): Promise<HandoverFixture> {
  const invoice = await seedIssuedInvoice(tag);
  await closeWorkOrder(invoice.workOrderId);
  const delivery = await openDelivery(invoice.workOrderId);
  await passEveryMandatoryItem(delivery.id);
  await satisfyReceiverAndSignature(delivery.id);
  if (options.settled) await settleInvoice(invoice);
  return { invoice, delivery };
}

/** A delivery on a draft work order with nothing else done. */
async function bareDelivery(
  tag: string
): Promise<{ chain: WorkOrderChain; delivery: DeliveryBody }> {
  const chain = await seedWorkOrderChain(tag);
  const delivery = await openDelivery(chain.workOrderId);
  return { chain, delivery };
}

const eligibilityOf = async (deliveryId: string): Promise<EligibilityBody> => {
  authAs(SAL_FULL);
  const response = await readEligibility(deliveryId);
  if (response.status !== 200) {
    throw new Error(`eligibility read failed with ${response.status}: ${await response.text()}`);
  }
  return bodyOf<EligibilityBody>(response);
};

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
  await seedLocalPrincipal(DELIVERY_MANAGER_ONLY);
  await seedLocalPrincipal(DELIVERY_COMPLETER_ONLY);
  await seedChecklistTemplate();
  await seedOutsiderPartner();
  await seedForeignBranchDocumentVersion();
  tenantBVersionId = await seedDocumentVersion({ tenantId: TENANT_B });
}, 300_000);

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

// ===========================================================================
describe('sal.delivery-create', () => {
  it('opens a ready delivery and DERIVES the vehicle and visit from the work order (success)', async () => {
    const chain = await seedWorkOrderChain('dlv_create_ok');
    const auditBefore = await auditTotalFor('sal.delivery.created');
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_FULL);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: USER_A,
    });
    expect(response.status).toBe(201);
    const delivery = await bodyOf<DeliveryBody>(response);

    // Born `ready`. Nothing about creating the container hands a vehicle over, and
    // `ck_delivery_records_delivered_shape` makes `delivered` a biconditional with the
    // odometer reading that only `sal.complete_delivery` may write.
    expect(delivery.status).toBe('ready');
    expect(delivery.deliveredAt).toBeNull();
    expect(delivery.finalOdometerReadingId).toBeNull();
    expect(delivery.replayed).toBe(false);
    expect(delivery.companyId).toBe(chain.companyId);
    expect(delivery.branchId).toBe(chain.branchId);
    expect(delivery.deliveringEmployeeId).toBe(USER_A);

    // The decisive assertion: both are read off the WORK ORDER, compared against the
    // work-order row itself rather than against the reception fixture that produced it.
    const workOrder = await admin.query<{ vehicle_id: string; reception_visit_id: string }>(
      `SELECT vehicle_id, reception_visit_id FROM wo.work_orders WHERE id = $1`,
      [chain.workOrderId]
    );
    expect(delivery.vehicleId).toBe(workOrder.rows[0]?.vehicle_id);
    expect(delivery.receptionVisitId).toBe(workOrder.rows[0]?.reception_visit_id);

    // Exactly one audit record for the creation, as a DELTA and pinned to the aggregate.
    expect((await auditTotalFor('sal.delivery.created')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.delivery.created', delivery.id)).toBe(1);
    // And NO event: `vehicle.delivered` is the only event this module registers, and a
    // prepared handover is not one.
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(0);
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(0);

    // The genesis ledger row, written by the service because no trigger writes it.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_status_history
          WHERE delivery_record_id = $1 AND from_status IS NULL AND to_status = 'ready'`,
        [delivery.id]
      )
    ).toBe(1);
  });

  it('refuses a body that names vehicleId or receptionVisitId at all (denial)', async () => {
    const chain = await seedWorkOrderChain('dlv_create_strict');
    // The claim "they are not body fields" is only true because the schema is
    // `.strict()`. Without this a client could send a mismatched vehicle, have it
    // silently ignored, and believe the delivery it got back described the vehicle it
    // named.
    for (const extra of [
      { vehicleId: chain.vehicleId },
      { receptionVisitId: chain.visitId },
      { status: 'delivered' },
    ]) {
      authAs(SAL_FULL);
      const response = await createDelivery({
        workOrderId: chain.workOrderId,
        deliveringEmployeeId: USER_A,
        ...extra,
      });
      expect(response.status, JSON.stringify(extra)).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    // Not one of the three wrote a delivery.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records WHERE work_order_id = $1`,
        [chain.workOrderId]
      )
    ).toBe(0);
  });

  it('refuses a SECOND live delivery for the same work order as a conflict, not a fault (denial)', async () => {
    const { chain, delivery } = await bareDelivery('dlv_create_twice');

    authAs(SAL_FULL);
    const second = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: USER_A,
    });
    // `uq_delivery_records_work_order_active` would raise `23505` and abort the
    // transaction — including the audit append — so the service checks first and the
    // caller gets a 409 it can act on rather than a 500 carrying an index name.
    expect(second.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(second);
    expect(problem.code).toBe('ERR-RES-002');
    expectNoSchemaLeak(problem);

    // Still exactly one delivery, and it is the first.
    const rows = await admin.query<{ id: string }>(
      `SELECT id FROM sal.delivery_records WHERE work_order_id = $1`,
      [chain.workOrderId]
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.id).toBe(delivery.id);
  });

  it('replays an idempotency key without opening a second delivery (idempotency)', async () => {
    const chain = await seedWorkOrderChain('dlv_create_replay');
    const key = randomUUID();
    const payload = { workOrderId: chain.workOrderId, deliveringEmployeeId: USER_A };
    const auditBefore = await auditTotalFor('sal.delivery.created');

    authAs(SAL_FULL);
    const first = await createDelivery(payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<DeliveryBody>(first);

    authAs(SAL_FULL);
    const replay = await createDelivery(payload, key);
    // 200 rather than 201: the stored response is replayed and the handler is never
    // re-entered, so a retrying client can tell it did not open a second handover.
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<DeliveryBody>(replay);
    expect(replayed.id).toBe(original.id);
    expect(replayed.status).toBe('ready');

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records WHERE work_order_id = $1`,
        [chain.workOrderId]
      )
    ).toBe(1);
    expect((await auditTotalFor('sal.delivery.created')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.delivery.created', original.id)).toBe(1);
  });

  it('refuses a caller lacking sal.delivery.manage (authorization)', async () => {
    const chain = await seedWorkOrderChain('dlv_create_authz');
    // `SAL_READER` holds `sal.delivery.view` and `sal.finance.view`, so it can see the
    // world this operation writes into — the refusal is about the write authority.
    authAs(SAL_READER);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: USER_A,
    });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records WHERE work_order_id = $1`,
        [chain.workOrderId]
      )
    ).toBe(0);
  });

  it('refuses a work order in a branch the caller holds no delivery permission in (isolation)', async () => {
    const chain = await seedWorkOrderChain('dlv_create_isolation');
    // BRANCH_A1 IS inside this principal's permission-blind `iam.allowed_branch_ids()`
    // union, because a SECOND grant carrying only `org.tenant.read` names it. So RLS
    // cannot answer 404 and the work order is perfectly visible: the ONLY thing that
    // can refuse this is the scoped permission evaluation against the work order's own
    // company and branch (P1-18-A-01).
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: USER_A,
    });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records WHERE work_order_id = $1`,
        [chain.workOrderId]
      )
    ).toBe(0);
  });

  it('cannot open a delivery for the other tenant’s work order (cross-tenant)', async () => {
    const chain = await seedWorkOrderChain('dlv_create_cross');
    // Tenant B holds every `sal.` permission IN ITS OWN TENANT, so a refusal here is
    // RLS on `wo.work_orders` rather than a missing grant.
    authAs(SAL_TENANT_B);
    const response = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: USER_A,
    });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records WHERE work_order_id = $1`,
        [chain.workOrderId]
      )
    ).toBe(0);
  });
});

// ===========================================================================
describe('sal.delivery-eligibility-read', () => {
  it('composes the whole blocker list and drops each code as it is satisfied (success)', async () => {
    const { delivery } = await bareDelivery('dlv_elig_compose');

    const initial = await eligibilityOf(delivery.id);
    expect(initial.deliveryId).toBe(delivery.id);
    expect(initial.status).toBe('ready');
    expect(initial.eligible).toBe(false);
    // The three this delivery owns itself, and the two composed from other modules.
    for (const code of [
      'receiver_not_verified',
      'signature_missing',
      'checklist_incomplete',
      'work_order_not_complete',
      'financial_balance_outstanding',
    ]) {
      expect(initial.blockers, `${code} must block a bare delivery`).toContain(code);
    }
    // `exception` is the only status that blocks, and this record is `ready`.
    expect(initial.blockers).not.toContain('delivery_state_invalid');
    // The bare work order carries no invoice at all, and this service treats billing's
    // null as the blocker being PRESENT-but-UNESTABLISHED rather than as settlement:
    // "nothing was invoiced" is not "nothing is owed", and this is the one gate with no
    // database backstop.
    expect(
      initial.facts.find((fact) => fact.blocker === 'financial_balance_outstanding')?.established
    ).toBe(false);
    // `checklist_incomplete` is actionable rather than a bare code.
    expect(initial.checklistGaps.map((gap) => gap.itemCode)).toContain(ITEM_MANDATORY_CODE);
    // And the caller is told which blocker is overridable at all, with its authority.
    expect(initial.overridable).toEqual([
      { code: 'financial_balance_outstanding', permission: 'sal.delivery.complete' },
    ]);
    expect(initial.overridden).toEqual([]);

    // 1. The mandatory checklist item.
    await passEveryMandatoryItem(delivery.id);
    const afterChecklist = await eligibilityOf(delivery.id);
    expect(afterChecklist.blockers).not.toContain('checklist_incomplete');
    expect(afterChecklist.checklistGaps).toEqual([]);
    expect(afterChecklist.blockers).toContain('receiver_not_verified');
    expect(afterChecklist.blockers).toContain('signature_missing');

    // 2. The receiver.
    authAs(SAL_FULL);
    expect((await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A })).status).toBe(201);
    const afterReceiver = await eligibilityOf(delivery.id);
    expect(afterReceiver.blockers).not.toContain('receiver_not_verified');
    expect(afterReceiver.blockers).toContain('signature_missing');
    expect(afterReceiver.status).toBe('receiver_verified');

    // 3. The signature.
    authAs(SAL_FULL);
    expect(
      (
        await attachSignature(delivery.id, {
          signerRole: 'receiver',
          signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
        })
      ).status
    ).toBe(201);
    const afterSignature = await eligibilityOf(delivery.id);
    expect(afterSignature.blockers).not.toContain('signature_missing');
    expect(afterSignature.status).toBe('signed');

    // What is left is exactly the two facts this delivery cannot satisfy on its own:
    // its work order is still in `draft` and nothing was ever invoiced.
    expect([...afterSignature.blockers].sort()).toEqual([
      'financial_balance_outstanding',
      'work_order_not_complete',
    ]);
    expect(afterSignature.eligible).toBe(false);
  });

  it('has NO writable eligible input: sal.delivery-eligibility-read is a GET with a path schema only', async () => {
    const { delivery } = await bareDelivery('dlv_elig_no_input');

    // Registered as a read. There is no request body to carry an eligibility claim.
    expect(DELIVERY_ELIGIBILITY_OPERATION.method).toBe('GET');
    expect(DELIVERY_ELIGIBILITY_OPERATION.auditClass).toBe('none');

    // Structural, because "there is no such field" is a claim about the SHAPE of the
    // route and not about one request: the module declares exactly ONE schema, it
    // validates the path, and it exports no write verb — so a body field could not be
    // read even if a client sent one.
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/deliveries/[deliveryId]/eligibility/route.ts'),
      'utf8'
    );
    expect(source.match(/z\s*\.object\(/g)).toHaveLength(1);
    expect(source).toMatch(/const Params = z\s*\.object\(\{ deliveryId: schemas\.uuid \}\)/);
    expect(source).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);

    // Behavioural, so the structural claim is not the only evidence: a caller asserting
    // eligibility in the query string is answered identically.
    const honest = await eligibilityOf(delivery.id);
    authAs(SAL_FULL);
    const asserted = await readEligibility(delivery.id, '?eligible=true&blockers=');
    expect(asserted.status).toBe(200);
    const claimed = await bodyOf<EligibilityBody>(asserted);
    expect(claimed.eligible).toBe(false);
    expect([...claimed.blockers].sort()).toEqual([...honest.blockers].sort());
    // And the boolean is derived from the list rather than reported beside it.
    expect(claimed.eligible).toBe(claimed.blockers.length === 0);
  });

  it('reports financial_balance_outstanding for an ISSUED, UNPAID invoice (THE FINANCIAL BLOCKER)', async () => {
    const { invoice, delivery } = await handoverReady('dlv_fin_open', { settled: false });

    // The invoice is genuinely open, in exact decimal form — so the blocker below has a
    // real debt behind it rather than an unestablished fact.
    expect(invoice.gross).toBe('100.0000');
    expect(invoice.currencyCode).toBe('USD');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    const eligibility = await eligibilityOf(delivery.id);
    // EXACTLY this one blocker: every other fact is satisfied, so nothing else can be
    // what makes the delivery ineligible.
    expect(eligibility.blockers).toEqual(['financial_balance_outstanding']);
    expect(eligibility.eligible).toBe(false);
    // ESTABLISHED, unlike the no-invoice case: an operator must be able to tell "the
    // customer owes money" from "the platform cannot see whether they do".
    expect(
      eligibility.facts.find((fact) => fact.blocker === 'financial_balance_outstanding')
        ?.established
    ).toBe(true);
  });

  it('drops financial_balance_outstanding once the invoice is settled in full (THE FINANCIAL BLOCKER)', async () => {
    const { invoice, delivery } = await handoverReady('dlv_fin_settled', { settled: true });

    // Settled exactly, compared as an exact decimal string. `Number` touches neither
    // side, and the currency is asserted with the amount inside `settleInvoice`.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');

    const eligibility = await eligibilityOf(delivery.id);
    expect(eligibility.blockers).not.toContain('financial_balance_outstanding');
    // Nothing at all remains, which is what makes the completion success case reachable.
    expect(eligibility.blockers).toEqual([]);
    expect(eligibility.eligible).toBe(true);
    expect(
      eligibility.facts.find((fact) => fact.blocker === 'financial_balance_outstanding')
        ?.established
    ).toBe(true);
  });

  it('refuses a malformed delivery id before reading anything (denial)', async () => {
    authAs(SAL_FULL);
    const response = await readEligibility('not-a-uuid');
    // The path schema is parsed INSIDE the handler, so this is the operation's own
    // validation refusal naming the field — a non-uuid reaching the repository would be
    // a `22P02` the catalog has no honest mapping for.
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('path.deliveryId');

    // An unknown but well-formed id is a uniform 404 rather than a different shape of
    // answer, so the code discloses nothing about whether the delivery exists.
    authAs(SAL_FULL);
    const unknown = await readEligibility(randomUUID());
    expect(unknown.status).toBe(404);
    expect((await bodyOf<ProblemBody>(unknown)).code).toBe('ERR-RES-001');
  });

  it('requires sal.finance.view, and is readable WITHOUT write authority (authorization)', async () => {
    const { delivery } = await bareDelivery('dlv_elig_authz');

    // `SAL_NO_FINANCE` holds every other `sal`/`wty` permission, including
    // `sal.delivery.manage` and `sal.delivery.view`, and lacks exactly `sal.finance.view`.
    // So this refusal isolates the one permission that matters most here: without it
    // `sal.invoice_open_receivable` returns an RLS-invisible zero and the financial
    // blocker would be waved through rather than refused.
    authAs(SAL_NO_FINANCE);
    const refused = await readEligibility(delivery.id);
    expect(refused.status).toBe(403);
    expect((await bodyOf<ProblemBody>(refused)).code).toBe('ERR-IAM-001');

    // And the other half of the contract, which is what makes the operation usable:
    // `SAL_READER` holds the two view permissions and NO write authority at all — no
    // `manage`, no `complete` — and it can read the answer. `sal.delivery.manage` is
    // deliberately not required, because the principal that acts on this read holds
    // `sal.delivery.complete`; demanding `manage` made `sal.delivery-complete`
    // unreachable, since this response is where its mandatory `If-Match` comes from.
    authAs(SAL_READER);
    const allowed = await readEligibility(delivery.id);
    expect(allowed.status).toBe(200);
    const view = await bodyOf<EligibilityBody & { recordVersion: number }>(allowed);
    expect(view.recordVersion).toBeGreaterThan(0);
    expect(allowed.headers.get('etag')).toBe(`"${view.recordVersion}"`);
  });

  it('refuses a caller scoped to another branch although the row is visible (isolation)', async () => {
    const { delivery } = await bareDelivery('dlv_elig_isolation');
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await readEligibility(delivery.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');

    // The row really IS inside that caller's RLS union — otherwise the refusal above
    // would be a 404 dressed up as a 403 and would prove nothing about scope.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records
          WHERE id = $1 AND branch_id = ANY(
            SELECT s.branch_id FROM iam.grant_scopes s
              JOIN iam.role_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
             WHERE g.user_id = $2 AND s.branch_id IS NOT NULL)`,
        [delivery.id, SAL_PERMISSION_ELSEWHERE.userId]
      )
    ).toBe(1);
  });

  it('is unreachable from the other tenant (cross-tenant)', async () => {
    const { delivery } = await bareDelivery('dlv_elig_cross');
    authAs(SAL_TENANT_B);
    const response = await readEligibility(delivery.id);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
describe('sal.delivery-receiver-verify', () => {
  it('verifies a partner holding a valid reception party role on the visit (success)', async () => {
    const { delivery } = await bareDelivery('dlv_recv_ok');
    const auditBefore = await auditTotalFor('sal.delivery.receiver_verified');

    // The party role is real and was created by `rec.accept_check_in`, not by this
    // suite: `sal.guard_authorized_receiver` reads `rec.reception_party_roles` and a
    // hand-inserted role would prove the guard against a fixture.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM rec.reception_party_roles
          WHERE reception_visit_id = $1 AND partner_id = $2 AND deleted_at IS NULL`,
        [delivery.receptionVisitId, PARTNER_A]
      )
    ).toBeGreaterThan(0);

    authAs(SAL_FULL);
    const response = await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A });
    expect(response.status).toBe(201);
    const receiver = await bodyOf<ReceiverBody>(response);

    expect(receiver.deliveryRecordId).toBe(delivery.id);
    expect(receiver.receiverPartnerId).toBe(PARTNER_A);
    expect(receiver.identityEvidenceDocumentVersionId).toBeNull();
    expect(receiver.replayed).toBe(false);
    // The status advanced, so a caller need not re-read to see it.
    expect(receiver.deliveryStatus).toBe('receiver_verified');
    expect((await deliveryRow(delivery.id))?.status).toBe('receiver_verified');
    // `verified_at` is the column DEFAULT and is the exact value the time-aware guard
    // evaluated the role's validity window against, so the caller is told the
    // DATABASE's value rather than an application guess at `now()`.
    //
    // Rendered by PostgreSQL at millisecond precision rather than compared as a bare
    // `timestamptz`, and the reason is a real lossy step rather than fussiness: the
    // column holds MICROSECONDS, `Date` holds milliseconds, and the service reports the
    // value through `toISOString()`. Both sides truncate (verified: `.123456` →
    // `.123` on each), so `to_char(… .MS)` is the exact form the wire can carry — while
    // `verified_at = $2::timestamptz` compares a truncated value against an untruncated
    // one and is false for all but 1-in-1000 timestamps.
    const stored = await admin.query<{ iso: string }>(
      `SELECT to_char(verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso
         FROM sal.authorized_receivers WHERE id = $1`,
      [receiver.id]
    );
    expect(receiver.verifiedAt).toBe(stored.rows[0]?.iso);

    expect((await auditTotalFor('sal.delivery.receiver_verified')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.delivery.receiver_verified', receiver.id)).toBe(1);
    // The partner is a person, so the trail records THAT a receiver was verified
    // without republishing WHO: `restricted` collapses to a fixed marker.
    const details = await auditDetails('sal.delivery.receiver_verified', receiver.id);
    expect(detailValue(details, 'receiverPartnerId')).toBe('***');
    expect(detailValue(details, 'deliveryStatus')).toBe('receiver_verified');
  });

  it('refuses a partner holding no valid party role, with a caller-safe message (denial)', async () => {
    const { delivery } = await bareDelivery('dlv_recv_unauthorized');
    // A real, visible tenant-A partner that simply holds no role on this visit — so
    // the refusal is M-dlv-2 and not `fk_authorized_receivers_partner`.
    authAs(SAL_FULL);
    const response = await verifyReceiver(delivery.id, { receiverPartnerId: OUTSIDER_PARTNER });
    expect(response.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-TRN-001');

    // Caller-safe, and structurally so: `problemFor` builds the body from the catalog
    // entry plus `safeDetails` alone, so M-dlv-2's trigger text cannot reach the client
    // through any field. The service's translation of that `check_violation` into
    // operator guidance is therefore NOT observable on the wire — see the report note.
    // What IS assertable is that nothing from the protected schema leaks, and that the
    // answer is a controlled 409 rather than a 500 carrying a constraint name.
    expectNoSchemaLeak(problem);
    expect(problem.status).toBe(409);

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.authorized_receivers WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
    expect((await deliveryRow(delivery.id))?.status).toBe('ready');
  });

  it('admits exactly ONE receiver: a second, different partner is refused (denial)', async () => {
    const { delivery } = await bareDelivery('dlv_recv_second');
    authAs(SAL_FULL);
    expect((await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A })).status).toBe(201);

    authAs(SAL_FULL);
    const second = await verifyReceiver(delivery.id, { receiverPartnerId: OUTSIDER_PARTNER });
    // Refused rather than substituted, even though the grant permits UPDATE: accepting
    // a change would silently rewrite who the platform recorded as taking custody, and
    // the `verified_at` the time-aware guard evaluated would no longer be the one on
    // the row.
    expect(second.status).toBe(409);
    expect((await bodyOf<ProblemBody>(second)).code).toBe('ERR-RES-002');

    const rows = await admin.query<{ receiver_partner_id: string }>(
      `SELECT receiver_partner_id FROM sal.authorized_receivers WHERE delivery_record_id = $1`,
      [delivery.id]
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.receiver_partner_id).toBe(PARTNER_A);
  });

  it('replays an idempotency key without recording a second receiver (idempotency)', async () => {
    const { delivery } = await bareDelivery('dlv_recv_replay');
    const key = randomUUID();
    const payload = { receiverPartnerId: PARTNER_A };
    const auditBefore = await auditTotalFor('sal.delivery.receiver_verified');

    authAs(SAL_FULL);
    const first = await verifyReceiver(delivery.id, payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<ReceiverBody>(first);

    authAs(SAL_FULL);
    const replay = await verifyReceiver(delivery.id, payload, key);
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<ReceiverBody>(replay);
    expect(replayed.id).toBe(original.id);
    expect(replayed.verifiedAt).toBe(original.verifiedAt);

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.authorized_receivers WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(1);
    expect((await auditTotalFor('sal.delivery.receiver_verified')) - auditBefore).toBe(1);
    // One status advance, so exactly one ledger row for it.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_status_history
          WHERE delivery_record_id = $1 AND to_status = 'receiver_verified'`,
        [delivery.id]
      )
    ).toBe(1);
  });

  it('refuses a caller lacking sal.delivery.manage (authorization)', async () => {
    const { delivery } = await bareDelivery('dlv_recv_authz');
    authAs(SAL_READER);
    const response = await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.authorized_receivers WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('refuses a delivery in a branch the caller is not scoped to (isolation)', async () => {
    const { delivery } = await bareDelivery('dlv_recv_isolation');
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.authorized_receivers WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('cannot reach a tenant-A delivery from tenant B (cross-tenant)', async () => {
    const { delivery } = await bareDelivery('dlv_recv_cross');
    authAs(SAL_TENANT_B);
    const response = await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
describe('sal.delivery-checklist-record', () => {
  it('records a passed outcome against a template item (success)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_ok');
    const auditBefore = await auditTotalFor('sal.delivery.checklist_recorded');

    authAs(SAL_FULL);
    const response = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_A),
      outcome: 'passed',
    });
    expect(response.status).toBe(201);
    const result = await bodyOf<ChecklistBody>(response);
    expect(result.deliveryRecordId).toBe(delivery.id);
    expect(result.itemCode).toBe(ITEM_OPTIONAL_CODES[0]);
    expect(result.outcome).toBe('passed');
    expect(result.waiverReason).toBeNull();
    expect(result.replayed).toBe(false);

    // Recording a checklist result moves no status machine: a checklist is filled in
    // throughout preparation and `ck_delivery_records_status` has no value for
    // "checklist done".
    expect((await deliveryRow(delivery.id))?.status).toBe('ready');

    expect((await auditTotalFor('sal.delivery.checklist_recorded')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.delivery.checklist_recorded', result.id)).toBe(1);
    const details = await auditDetails('sal.delivery.checklist_recorded', result.id);
    expect(detailValue(details, 'outcome')).toBe('passed');
    expect(detailValue(details, 'isMandatory')).toBe('false');
  });

  it('refuses a waiver with no reason AND a pass carrying a waiver reason (denial)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_waiver');
    const before = await countRowsOf(
      `SELECT count(*)::text AS n FROM sal.delivery_checklist_results WHERE delivery_record_id = $1`,
      [delivery.id]
    );

    // `ck_delivery_checklist_results_waiver` is a BICONDITIONAL:
    // `(outcome = 'waived') = (waiver_reason IS NOT NULL)`.
    authAs(SAL_FULL);
    const waivedWithoutReason = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_B),
      outcome: 'waived',
    });
    expect(waivedWithoutReason.status).toBe(422);
    const first = await bodyOf<ProblemBody>(waivedWithoutReason);
    expect(first.code).toBe('ERR-VAL-001');
    expect(first.violations?.[0]?.path).toBe('body.outcome');

    // The half a caller would NOT expect: a reason attached to a pass is refused, not
    // silently dropped. A dropped field would leave the caller believing a
    // justification had been recorded against a record that carries none.
    authAs(SAL_FULL);
    const passedWithReason = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_B),
      outcome: 'passed',
      waiverReason: 'customer accepted the scuff',
    });
    expect(passedWithReason.status).toBe(422);
    expect((await bodyOf<ProblemBody>(passedWithReason)).code).toBe('ERR-VAL-001');

    // And `failed` with a reason is refused for the same reason.
    authAs(SAL_FULL);
    const failedWithReason = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_B),
      outcome: 'failed',
      waiverReason: 'not really a waiver',
    });
    expect(failedWithReason.status).toBe(422);

    // A waiver WITH a reason is the accepted shape, so the rule is shown to permit as
    // well as to refuse.
    authAs(SAL_FULL);
    const waivedProperly = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_B),
      outcome: 'waived',
      waiverReason: 'spare wheel retained by the customer',
    });
    expect(waivedProperly.status).toBe(201);
    const waived = await bodyOf<ChecklistBody>(waivedProperly);
    expect(waived.outcome).toBe('waived');
    expect(waived.waiverReason).toBe('spare wheel retained by the customer');

    // Exactly ONE row from four requests.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_checklist_results
          WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(before + 1);
  });

  it('refuses a re-record of the same item rather than overwriting it (denial)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_rerecord');
    const item = itemId(OPTIONAL_C);

    authAs(SAL_FULL);
    const first = await recordChecklist(delivery.id, { templateItemId: item, outcome: 'failed' });
    expect(first.status).toBe(201);

    authAs(SAL_FULL);
    const overwrite = await recordChecklist(delivery.id, {
      templateItemId: item,
      outcome: 'waived',
      waiverReason: 'let it through',
    });
    // An overwrite would silently erase a `failed` outcome a completion gate had
    // already read, and the table has no history behind it.
    expect(overwrite.status).toBe(409);
    expect((await bodyOf<ProblemBody>(overwrite)).code).toBe('ERR-INT-001');

    const rows = await admin.query<{ outcome: string; waiver_reason: string | null }>(
      `SELECT outcome, waiver_reason FROM sal.delivery_checklist_results
        WHERE delivery_record_id = $1 AND template_item_id = $2`,
      [delivery.id, item]
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.outcome).toBe('failed');
    expect(rows.rows[0]?.waiver_reason).toBeNull();
  });

  it('refuses an item from another company and an unknown outcome (denial)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_foreign_item');

    authAs(SAL_FULL);
    const unknownItem = await recordChecklist(delivery.id, {
      templateItemId: randomUUID(),
      outcome: 'passed',
    });
    // Stated as a 404 here rather than reaching
    // `fk_delivery_checklist_results_item` as a `23503` that aborts the transaction.
    expect(unknownItem.status).toBe(404);
    expect((await bodyOf<ProblemBody>(unknownItem)).code).toBe('ERR-RES-001');

    authAs(SAL_FULL);
    const badOutcome = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_A),
      outcome: 'skipped',
    });
    expect(badOutcome.status).toBe(422);
    expect((await bodyOf<ProblemBody>(badOutcome)).code).toBe('ERR-VAL-001');

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_checklist_results WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('replays an idempotency key without writing a second result (idempotency)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_replay');
    const key = randomUUID();
    const payload = {
      templateItemId: itemId(OPTIONAL_A),
      outcome: 'passed',
    };
    const auditBefore = await auditTotalFor('sal.delivery.checklist_recorded');

    authAs(SAL_FULL);
    const first = await recordChecklist(delivery.id, payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<ChecklistBody>(first);

    authAs(SAL_FULL);
    const replay = await recordChecklist(delivery.id, payload, key);
    expect(replay.status).toBe(200);
    expect((await bodyOf<ChecklistBody>(replay)).id).toBe(original.id);

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_checklist_results WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(1);
    expect((await auditTotalFor('sal.delivery.checklist_recorded')) - auditBefore).toBe(1);
  });

  it('refuses a caller lacking sal.delivery.manage (authorization)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_authz');
    authAs(SAL_READER);
    const response = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_A),
      outcome: 'passed',
    });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_checklist_results WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('refuses a delivery in a branch the caller is not scoped to (isolation)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_isolation');
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_A),
      outcome: 'passed',
    });
    expect(response.status).toBe(403);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_checklist_results WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('cannot reach a tenant-A delivery from tenant B (cross-tenant)', async () => {
    const { delivery } = await bareDelivery('dlv_chk_cross');
    authAs(SAL_TENANT_B);
    const response = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_A),
      outcome: 'passed',
    });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
describe('sal.delivery-signature-attach', () => {
  it('binds a signature by document-version REFERENCE and leaks no content (success, privacy)', async () => {
    const { delivery } = await bareDelivery('dlv_sig_ok');
    const auditBefore = await auditTotalFor('sal.delivery.signature_recorded');

    authAs(SAL_FULL);
    const response = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    });
    expect(response.status).toBe(201);
    const signature = await bodyOf<SignatureBody>(response);
    expect(signature.deliveryRecordId).toBe(delivery.id);
    expect(signature.signerRole).toBe('receiver');
    // The reference, and only the reference, is what crosses back.
    expect(signature.signatureDocumentVersionId).toBe(SIGNATURE_DOCUMENT_VERSION);
    expect(signature.replayed).toBe(false);
    // A signature recorded while the delivery is still `ready` is stored but does not
    // advance the status: calling a handover `signed` before anyone verified who is
    // receiving the vehicle would skip the step that establishes authority.
    expect(signature.deliveryStatus).toBe('ready');

    expect((await auditTotalFor('sal.delivery.signature_recorded')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.delivery.signature_recorded', signature.id)).toBe(1);

    // ---- PRIVACY: the audit details -------------------------------------------
    const details = await auditDetails('sal.delivery.signature_recorded', signature.id);
    expect(details.length).toBeGreaterThan(0);
    // The reference is classified `restricted`, so `iam.audit_mask` collapsed it to a
    // fixed marker BEFORE it was stored: the trail proves a signature was bound while
    // the gated row remains the only place the pointer lives.
    const reference = details.find((detail) => detail.fieldName === 'signatureDocumentVersionId');
    expect(reference?.classification).toBe('restricted');
    expect(reference?.newValue).toBe('***');
    for (const detail of details) {
      const stored = `${detail.oldValue ?? ''}${detail.newValue ?? ''}`;
      expect(detail.fieldName, 'no detail may be a content-shaped field').not.toMatch(
        CONTENT_SHAPED_KEY
      );
      expect(stored, `${detail.fieldName} must not carry encoded content`).not.toMatch(
        BASE64_SHAPED
      );
    }
    // Nor the document's own identifying content: neither its storage key nor its hash.
    const document = await admin.query<{ storage_key: string; sha_hex: string }>(
      `SELECT storage_key, encode(sha256,'hex') AS sha_hex FROM shared.document_versions
        WHERE id = $1`,
      [SIGNATURE_DOCUMENT_VERSION]
    );
    const storageKey = document.rows[0]?.storage_key ?? '';
    const shaHex = document.rows[0]?.sha_hex ?? '';
    expect(storageKey.length).toBeGreaterThan(0);
    const detailText = JSON.stringify(details);
    expect(detailText).not.toContain(storageKey);
    expect(detailText).not.toContain(shaHex);
    expect(detailText).not.toContain(SIGNATURE_DOCUMENT_VERSION);

    // ---- PRIVACY: the outbox --------------------------------------------------
    // This operation publishes NO event — `vehicle.delivered` is the only event the
    // module registers — so the honest assertion is that NOTHING anywhere in the
    // outbox carries the reference, the storage key or the hash, rather than reading a
    // payload that does not exist.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM shared.event_outbox
          WHERE payload::text LIKE '%' || $1 || '%'
             OR payload::text LIKE '%' || $2 || '%'
             OR payload::text LIKE '%' || $3 || '%'`,
        [SIGNATURE_DOCUMENT_VERSION, storageKey, shaHex]
      )
    ).toBe(0);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM shared.event_outbox
          WHERE aggregate_id = $1 OR event_key LIKE '%' || $1 || '%'`,
        [signature.id]
      )
    ).toBe(0);
  });

  it('REJECTS a body carrying an extra signatureData field (denial)', async () => {
    const { delivery } = await bareDelivery('dlv_sig_strict');
    // `.strict()` is what makes "there is no signature-bytes field" true rather than
    // merely intended: an ignored field would leave a client believing the platform had
    // stored the mark itself.
    for (const extra of [
      {
        signatureData:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      },
      { signatureImage: 'data:image/png;base64,AAAA' },
      { signedBy: 'someone' },
    ]) {
      authAs(SAL_FULL);
      const response = await attachSignature(delivery.id, {
        signerRole: 'receiver',
        signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
        ...extra,
      });
      expect(response.status, Object.keys(extra).join()).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    // An unknown signer role is refused too — `ck_delivery_signatures_signer_role`
    // would raise a `23514` naming a constraint this platform never echoes.
    authAs(SAL_FULL);
    const badRole = await attachSignature(delivery.id, {
      signerRole: 'notary',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    });
    expect(badRole.status).toBe(422);

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_signatures WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('refuses a document version from another branch or another tenant (denial)', async () => {
    const { delivery } = await bareDelivery('dlv_sig_foreign_doc');

    // Same tenant, so RLS admits it and `verifyEvidenceVersion` resolves it — the
    // refusal is the company/branch comparison and nothing else.
    authAs(SAL_FULL);
    const otherBranch = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: FOREIGN_BRANCH_VERSION,
    });
    expect(otherBranch.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(otherBranch);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.signatureDocumentVersionId');

    // A tenant-B version is invisible under tenant-A RLS, so it is a uniform 404 that
    // discloses nothing about whether the version exists.
    authAs(SAL_FULL);
    const otherTenant = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: tenantBVersionId,
    });
    expect(otherTenant.status).toBe(404);
    expect((await bodyOf<ProblemBody>(otherTenant)).code).toBe('ERR-RES-001');

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_signatures WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('replays an idempotency key without binding a second signature (idempotency)', async () => {
    const { delivery } = await bareDelivery('dlv_sig_replay');
    const key = randomUUID();
    const payload = {
      signerRole: 'receiver',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    };
    const auditBefore = await auditTotalFor('sal.delivery.signature_recorded');

    authAs(SAL_FULL);
    const first = await attachSignature(delivery.id, payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<SignatureBody>(first);

    authAs(SAL_FULL);
    const replay = await attachSignature(delivery.id, payload, key);
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<SignatureBody>(replay);
    expect(replayed.id).toBe(original.id);
    expect(replayed.signedAt).toBe(original.signedAt);

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_signatures WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(1);
    expect((await auditTotalFor('sal.delivery.signature_recorded')) - auditBefore).toBe(1);
  });

  it('refuses a caller lacking sal.delivery.manage (authorization)', async () => {
    const { delivery } = await bareDelivery('dlv_sig_authz');
    authAs(SAL_READER);
    const response = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_signatures WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('refuses a delivery in a branch the caller is not scoped to (isolation)', async () => {
    const { delivery } = await bareDelivery('dlv_sig_isolation');
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    });
    expect(response.status).toBe(403);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_signatures WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);
  });

  it('cannot reach a tenant-A delivery from tenant B (cross-tenant)', async () => {
    const { delivery } = await bareDelivery('dlv_sig_cross');
    authAs(SAL_TENANT_B);
    const response = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
describe('sal.delivery-complete', () => {
  it('hands the vehicle over exactly once when nothing blocks it (success, audit, outbox)', async () => {
    const { delivery } = await handoverReady('dlv_done_ok', { settled: true });
    const version = await currentVersion(delivery.id);
    const auditBefore = await auditTotalFor('sal.delivery.completed');
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_FULL);
    const response = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '120000', odometerUnit: 'km' },
      { version }
    );
    expect(response.status).toBe(200);
    const completion = await bodyOf<CompletionBody>(response);

    expect(completion.deliveryId).toBe(delivery.id);
    expect(completion.status).toBe('delivered');
    expect(completion.deliveredAt).not.toBeNull();
    expect(completion.finalOdometerReadingId).not.toBeNull();
    // An empty override list is the evidence that this handover cleared every gate on
    // its own.
    expect(completion.overridden).toEqual([]);
    expect(completion.replayed).toBe(false);
    // The post-completion version is emitted as an ETag, so a caller can act on it.
    expect(response.headers.get('etag')).toBe(`"${completion.recordVersion}"`);

    const row = await deliveryRow(delivery.id);
    expect(row?.status).toBe('delivered');
    expect(row?.deliveredAt).not.toBeNull();
    expect(row?.finalOdometerReadingId).toBe(completion.finalOdometerReadingId);

    // The odometer is a measurement, not money — but it is `numeric(12,1)` and a
    // warranty's absolute limit is later derived from it, so it is compared as an exact
    // decimal STRING with its unit and never as a JavaScript number.
    const reading = await odometerReading(completion.finalOdometerReadingId ?? '');
    expect(reading?.value).toBe('120000.0');
    expect(reading?.unit).toBe('km');
    expect(reading?.captureMethod).toBe('delivery');

    // Custody really was released, which is the fact the whole operation exists for.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM rec.custody_history
          WHERE reception_visit_id = $1 AND to_state = 'released'`,
        [delivery.receptionVisitId]
      )
    ).toBe(1);

    // Exactly one audit record and exactly ONE event, both as deltas and both pinned.
    expect((await auditTotalFor('sal.delivery.completed')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.delivery.completed', delivery.id)).toBe(1);
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(1);
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(1);

    // The event carries blocker CODES and identifiers only: no amount, no invoice
    // number, no receiver, no signature or identity reference, and no odometer value.
    const payload = await outboxPayload(`vehicle.delivered:${delivery.id}`);
    expect(payload?.['deliveryRecordId']).toBe(delivery.id);
    expect(payload?.['overriddenBlockers']).toEqual([]);
    for (const key of Object.keys(payload ?? {})) {
      expect(key, `${key} must not be a content-shaped key`).not.toMatch(CONTENT_SHAPED_KEY);
      expect(key, `${key} must not carry money or identity`).not.toMatch(
        /amount|currency|invoice|receiver|signature|identity|odometerValue/i
      );
    }
    expect(JSON.stringify(payload)).not.toMatch(BASE64_SHAPED);
  });

  it('replays an idempotency key with no second event and no second custody release (idempotency)', async () => {
    const { delivery } = await handoverReady('dlv_done_replay', { settled: true });
    const version = await currentVersion(delivery.id);
    const key = randomUUID();
    const payload = { finalOdometerValue: '95000', odometerUnit: 'km' };

    authAs(SAL_FULL);
    const first = await completeDelivery(delivery.id, payload, { version, key });
    expect(first.status).toBe(200);
    const original = await bodyOf<CompletionBody>(first);
    expect(original.status).toBe('delivered');

    // Measured AFTER the first completion, so the replay's deltas are the claim.
    const auditBefore = await auditTotalFor('sal.delivery.completed');
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_FULL);
    const replay = await completeDelivery(delivery.id, payload, { version, key });
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<CompletionBody>(replay);
    expect(replayed.deliveryId).toBe(original.deliveryId);
    expect(replayed.status).toBe('delivered');
    expect(replayed.finalOdometerReadingId).toBe(original.finalOdometerReadingId);
    expect(replayed.deliveredAt).toBe(original.deliveredAt);

    // Still ONE delivery, and BOTH deltas zero: saying a vehicle was handed over twice
    // would be a lie in the trail and a duplicate fact for every consumer.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records WHERE work_order_id = $1`,
        [delivery.workOrderId]
      )
    ).toBe(1);
    expect((await auditTotalFor('sal.delivery.completed')) - auditBefore).toBe(0);
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(0);
    expect(await auditCountFor('sal.delivery.completed', delivery.id)).toBe(1);
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(1);
    // One custody release, one `delivered` ledger row, one odometer reading.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM rec.custody_history
          WHERE reception_visit_id = $1 AND to_state = 'released'`,
        [delivery.receptionVisitId]
      )
    ).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_status_history
          WHERE delivery_record_id = $1 AND to_status = 'delivered'`,
        [delivery.id]
      )
    ).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM veh.odometer_readings
          WHERE vehicle_id = $1 AND capture_method = 'delivery'`,
        [delivery.vehicleId]
      )
    ).toBe(1);
  });

  it('TC-P1-22-006 REFUSES completion while an issued invoice is unpaid, and accepts the SAME request once it is settled (denial, THE FINANCIAL BLOCKER)', async () => {
    const { invoice, delivery } = await handoverReady('dlv_done_unpaid', { settled: false });
    const version = await currentVersion(delivery.id);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
    expect(invoice.currencyCode).toBe('USD');

    // The blocker set the write path is about to recompose, read through the SAME
    // `DeliveryReadService.composeFor` the completion consults. It is exactly one code,
    // which is what makes the refusal below attributable: no other fact is unsatisfied.
    const before = await eligibilityOf(delivery.id);
    expect(before.blockers).toEqual(['financial_balance_outstanding']);

    const auditBefore = await auditTotalFor('sal.delivery.completed');
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_FULL);
    const refused = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '111000' },
      { version }
    );
    // `sal.complete_delivery` would have accepted this: every gate the PRIMITIVE
    // enforces is satisfied. The refusal exists ONLY because the application composes
    // the financial fact, so this is the assertion that fails loudly if that
    // composition is ever dropped.
    expect(refused.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-TRN-001');
    expectNoSchemaLeak(problem);

    // The vehicle did NOT leave: no `delivered` status, no odometer capture, no custody
    // release, no audit record and — the fact every consumer would act on — NO EVENT.
    const row = await deliveryRow(delivery.id);
    expect(row?.status).not.toBe('delivered');
    expect(row?.deliveredAt).toBeNull();
    expect(row?.finalOdometerReadingId).toBeNull();
    expect((await auditTotalFor('sal.delivery.completed')) - auditBefore).toBe(0);
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(0);
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(0);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM rec.custody_history
          WHERE reception_visit_id = $1 AND to_state = 'released'`,
        [delivery.receptionVisitId]
      )
    ).toBe(0);
    // And the money is untouched, in exact decimal form beside its currency.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    // ---- The differential, which is what makes the cause attributable -----------
    // The problem document carries no free text (see `ProblemBody`), so "it was the
    // BALANCE that refused this" cannot be read off the response. It is established by
    // changing exactly one fact — settling the invoice — and re-sending the byte-identical
    // request under a fresh idempotency key. Nothing else about the world moved.
    await settleInvoice(invoice);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0.0000');
    expect((await eligibilityOf(delivery.id)).blockers).toEqual([]);

    authAs(SAL_FULL);
    const accepted = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '111000' },
      { version }
    );
    expect(accepted.status).toBe(200);
    const completion = await bodyOf<CompletionBody>(accepted);
    expect(completion.status).toBe('delivered');
    // Crossed on its own merits, not overridden: the balance was actually paid.
    expect(completion.overridden).toEqual([]);
    expect((await auditTotalFor('sal.delivery.completed')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(1);
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(1);
  });

  it('TC-P1-22-006 completes with an AUTHORIZED override and RECORDS the reason (THE FINANCIAL BLOCKER)', async () => {
    const { invoice, delivery } = await handoverReady('dlv_done_override', { settled: false });
    const version = await currentVersion(delivery.id);
    const reason = 'goodwill handover authorised by the branch manager, invoice on account';
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_FULL);
    const response = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '101500', overrideFinancialBlocker: { reason } },
      { version }
    );
    expect(response.status).toBe(200);
    const completion = await bodyOf<CompletionBody>(response);
    expect(completion.status).toBe('delivered');
    expect(completion.overridden).toEqual(['financial_balance_outstanding']);

    // The override is RECORDED, not merely honoured. Both fields are `internal`, so
    // they are stored verbatim rather than masked — an authorised exception that left
    // no trace would be indistinguishable from a gate that never fired.
    const details = await auditDetails('sal.delivery.completed', delivery.id);
    expect(detailValue(details, 'overriddenBlockers')).toBe('financial_balance_outstanding');
    expect(detailValue(details, 'overrideReason')).toBe(reason);
    expect(detailValue(details, 'status')).toBe('delivered');
    expect(
      details.find((detail) => detail.fieldName === 'status')?.oldValue,
      'the audit must record what the status was before the handover'
    ).toBe('signed');

    // Exactly one event, and it carries the blocker CODE that was crossed — no amount,
    // no invoice number and not the reason text, because a consumer that may read a
    // justification reads the audit trail under its own authorization.
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(1);
    const payload = await outboxPayload(`vehicle.delivered:${delivery.id}`);
    expect(payload?.['overriddenBlockers']).toEqual(['financial_balance_outstanding']);
    expect(JSON.stringify(payload)).not.toContain(reason);

    // The debt is untouched by the override: crossing the gate is not paying the bill.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('refuses an override with no reason (denial, THE FINANCIAL BLOCKER)', async () => {
    const { delivery } = await handoverReady('dlv_done_no_reason', { settled: false });
    const version = await currentVersion(delivery.id);

    for (const override of [{}, { reason: '' }, { reason: '   ' }]) {
      authAs(SAL_FULL);
      const response = await completeDelivery(
        delivery.id,
        { finalOdometerValue: '102000', overrideFinancialBlocker: override },
        { version }
      );
      expect(response.status, JSON.stringify(override)).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }

    // A reason-shaped field under a different name is not a reason either.
    authAs(SAL_FULL);
    const wrongShape = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '102000', overrideFinancialBlocker: { because: 'why not' } },
      { version }
    );
    expect(wrongShape.status).toBe(422);

    expect((await deliveryRow(delivery.id))?.status).not.toBe('delivered');
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(0);
  });

  it('refuses an unsatisfied checklist, receiver and signature, and NO override can reach them (denial)', async () => {
    const invoice = await seedIssuedInvoice('dlv_done_gates');
    await closeWorkOrder(invoice.workOrderId);
    await settleInvoice(invoice);
    const delivery = await openDelivery(invoice.workOrderId);
    const version = await currentVersion(delivery.id);

    // Money is settled and the work order is closed, so the three remaining blockers
    // are exactly the ones the PRIMITIVE also enforces — and the machine-readable
    // `checklistGaps` names the unsatisfied item, which is the actionable form a client
    // renders. (The service additionally composes a message naming the items; the
    // problem document carries no free-text field, so that text never reaches a caller
    // — recorded in the report rather than asserted here.)
    const eligibility = await eligibilityOf(delivery.id);
    expect([...eligibility.blockers].sort()).toEqual([
      'checklist_incomplete',
      'receiver_not_verified',
      'signature_missing',
    ]);
    expect(eligibility.checklistGaps.map((gap) => gap.itemCode)).toEqual([ITEM_MANDATORY_CODE]);

    authAs(SAL_FULL);
    const response = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '103000' },
      { version }
    );
    expect(response.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-TRN-001');
    expectNoSchemaLeak(problem);

    // None of the three is overridable, and `overrideFinancialBlocker` is the ONLY
    // override the input shape can express — so naming it changes nothing here. Two of
    // the three are enforced inside `sal.complete_delivery`, which is why advertising
    // an override for them would be advertising a capability that fails at the database.
    expect(eligibility.overridable.map((entry) => entry.code)).toEqual([
      'financial_balance_outstanding',
    ]);
    authAs(SAL_FULL);
    const withOverride = await completeDelivery(
      delivery.id,
      {
        finalOdometerValue: '103000',
        overrideFinancialBlocker: { reason: 'trying to force a handover' },
      },
      { version }
    );
    expect(withOverride.status).toBe(409);
    expect((await bodyOf<ProblemBody>(withOverride)).code).toBe('ERR-TRN-001');

    expect((await deliveryRow(delivery.id))?.status).toBe('ready');
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(0);
    // And no audit record claims an override was exercised on a handover that never
    // happened.
    expect(await auditCountFor('sal.delivery.completed', delivery.id)).toBe(0);
  });

  it('refuses a missing If-Match and a malformed odometer value (denial)', async () => {
    const { delivery } = await handoverReady('dlv_done_headers', { settled: true });
    const version = await currentVersion(delivery.id);

    // `versionGuarded: true` makes the header MANDATORY, so its absence is refused
    // before any state logic runs.
    authAs(SAL_FULL);
    const noHeader = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '104000' },
      { version: null }
    );
    expect(noHeader.status).toBe(428);
    expect((await bodyOf<ProblemBody>(noHeader)).code).toBe('ERR-CON-002');

    // `veh.odometer_readings.value` is `numeric(12,1)`. A SECOND decimal place is the
    // case that matters: exceeding scale is not an error in PostgreSQL, it is silently
    // rounded away, so a caller would never learn its reading had changed.
    for (const value of ['104000.55', '-1', '', 'many', '1e5']) {
      authAs(SAL_FULL);
      const response = await completeDelivery(
        delivery.id,
        { finalOdometerValue: value },
        { version }
      );
      expect(response.status, `odometer ${JSON.stringify(value)}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }

    // Not one of the six handed the vehicle over.
    expect((await deliveryRow(delivery.id))?.status).not.toBe('delivered');
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(0);
  });

  /**
   * ==========================================================================
   * THE CASE THAT CAUGHT A VACUOUS GUARD. Do not weaken it.
   * ==========================================================================
   * `sal.delivery-complete` registers `versionGuarded: true`, so `handleOperation`
   * REQUIRES `If-Match` (the 428 above proves that half) and exposes the parsed value
   * as `HandlerInput.expectedVersion`. When this suite was written the completion route
   * destructured only `{ db, authorizeScope }` and never forwarded it, so
   * `DeliveryService.completeDelivery`'s comparison — guarded by
   * `input.expectedVersion !== undefined` — never ran, and this assertion failed with
   * 200. The header was required and its value discarded: a caller holding a stale view
   * of a handover had its request applied to a record that had moved on.
   *
   * That is the hardest shape of defect to notice, because a required-header test and
   * every correct-version test pass identically whether or not the comparison happens.
   * Nothing but a deliberately STALE version distinguishes them, which is why this case
   * exists as its own test and why the stale value is derived from the row's real
   * `record_version` rather than hard-coded.
   */
  it('refuses a stale If-Match (stale-version)', async () => {
    const { delivery } = await handoverReady('dlv_done_stale', { settled: true });
    const version = await currentVersion(delivery.id);
    // Genuinely stale: the row has advanced past `ready` through the receiver and
    // signature steps, so version 1 is a view a real client could still be holding.
    expect(version).toBeGreaterThan(1);
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_FULL);
    const response = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '105000' },
      { version: version - 1 }
    );
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-CON-001');
    // And the stale request changed nothing.
    expect((await deliveryRow(delivery.id))?.status).not.toBe('delivered');
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(0);
  });

  it('refuses a caller holding sal.delivery.manage but not sal.delivery.complete (authorization)', async () => {
    const { delivery } = await handoverReady('dlv_done_authz', { settled: true });
    const version = await currentVersion(delivery.id);
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    // This principal prepared handovers all day: it holds `sal.delivery.manage`,
    // `sal.delivery.view` and `sal.finance.view`. It is refused because ending the
    // shop's custody of a vehicle is a SEPARATE, higher authority — and because it
    // holds every other permission the route declares, the 403 can only be about
    // `sal.delivery.complete`.
    authAs(DELIVERY_MANAGER_ONLY);
    const response = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '106000' },
      { version }
    );
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');

    // It really can prepare: the same principal is accepted on a preparation route, so
    // the refusal above is not "this caller cannot touch deliveries at all".
    authAs(DELIVERY_MANAGER_ONLY);
    const prepared = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_A),
      outcome: 'passed',
    });
    expect(prepared.status).toBe(201);

    expect((await deliveryRow(delivery.id))?.status).not.toBe('delivered');
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(0);
  });

  it('refuses a delivery in a branch the caller is not scoped to (isolation)', async () => {
    const { delivery } = await handoverReady('dlv_done_isolation', { settled: true });
    const version = await currentVersion(delivery.id);
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '107000' },
      { version }
    );
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect((await deliveryRow(delivery.id))?.status).not.toBe('delivered');
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(0);
  });

  it('cannot complete a tenant-A handover from tenant B (cross-tenant)', async () => {
    const { delivery } = await handoverReady('dlv_done_cross', { settled: true });
    const version = await currentVersion(delivery.id);
    const outboxBefore = await outboxTotalFor('vehicle.delivered');

    authAs(SAL_TENANT_B);
    const response = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '108000' },
      { version }
    );
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect((await deliveryRow(delivery.id))?.status).not.toBe('delivered');
    expect((await outboxTotalFor('vehicle.delivered')) - outboxBefore).toBe(0);

    // An unknown id from a fully authorized tenant-A caller answers identically, so the
    // code discloses nothing about whether the delivery exists in another tenant.
    authAs(SAL_FULL);
    const unknown = await completeDelivery(
      randomUUID(),
      { finalOdometerValue: '109000' },
      { version: 1 }
    );
    expect(unknown.status).toBe(404);
  });

  it('refuses a subresource write on an already-delivered handover, and no delivery ever lands in the second company (denial, isolation)', async () => {
    const { delivery } = await handoverReady('dlv_done_terminal', { settled: true });
    const version = await currentVersion(delivery.id);
    authAs(SAL_FULL);
    expect(
      (await completeDelivery(delivery.id, { finalOdometerValue: '110000' }, { version })).status
    ).toBe(200);

    // A receiver, checklist result or signature appended afterwards would describe a
    // custody transfer that had already completed.
    authAs(SAL_FULL);
    const late = await attachSignature(delivery.id, {
      signerRole: 'witness',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    });
    expect(late.status).toBe(409);
    expect((await bodyOf<ProblemBody>(late)).code).toBe('ERR-TRN-001');

    authAs(SAL_FULL);
    const lateItem = await recordChecklist(delivery.id, {
      templateItemId: itemId(OPTIONAL_B),
      outcome: 'passed',
    });
    expect(lateItem.status).toBe(409);

    // Exactly one signature — the one bound during preparation — and one event.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_signatures WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(1);
    expect(await outboxCountFor(`vehicle.delivered:${delivery.id}`)).toBe(1);

    // H6's residual on this surface. `POST /deliveries` is the closest any delivery
    // operation comes to letting a caller name a `(company, branch)` pair, and it does
    // NOT: the pair is read off the work order, and every other operation reads it off
    // the delivery row. So an INCOHERENT pair is unexpressible here rather than
    // refused, and the standing property worth pinning is that nothing this suite did
    // ever wrote a delivery into a branch of `COMPANY_A9` — the second tenant-A company
    // whose branch sits inside `SAL_COMPANY_SCOPED`'s permission-blind grant union.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.delivery_records WHERE branch_id = $1`,
        [BRANCH_A9]
      )
    ).toBe(0);
  });
});

// ===========================================================================
/**
 * Three findings from the independent review round, each pinned by a case that fails
 * against the code as it stood before the fix.
 *
 * They are grouped rather than filed under the operations they belong to because what
 * they have in common is the reason the original suite missed them: every financial test
 * issued its invoice, every signature test reused one fixture document, and every
 * completion test took its `If-Match` from a superuser read rather than from a response
 * a real client could hold.
 */
describe('P1-22 review regressions', () => {
  it('BLOCKS completion while the invoice is a DRAFT, and says which state it is in', async () => {
    // `sal.invoice_open_receivable` returns 0 for a draft BY DESIGN, so before the fix
    // this composition answered `eligible: true` with an empty blocker list and an
    // `established: true` financial fact. The vehicle left with the money owed, no
    // override and no reason — while a work order with NO invoice correctly blocked.
    // Creating a draft was strictly more permissive than creating nothing.
    const invoice = await seedIssuedInvoice('dlv_draft_blocks', { net: '5000.0000', draft: true });
    await closeWorkOrder(invoice.workOrderId);
    const delivery = await openDelivery(invoice.workOrderId);
    await passEveryMandatoryItem(delivery.id);
    await satisfyReceiverAndSignature(delivery.id);

    // The invoice really is a draft carrying real money, so the zero under test is the
    // STRUCTURAL zero and not an empty invoice.
    // Read off the LINE amounts, not `sal.invoice_amounts`: only `sal.issue_invoice`
    // inserts that table, so an unissued invoice has no totals row at all — which is
    // itself part of why a draft's open receivable is a structural zero.
    const stored = await admin.query<{ status: string; gross: string }>(
      `SELECT i.status,
              (SELECT sum(la.gross_amount)::text FROM sal.invoice_line_amounts la
                WHERE la.invoice_id = i.id AND la.deleted_at IS NULL) AS gross
         FROM sal.invoices i WHERE i.id = $1`,
      [invoice.invoiceId]
    );
    expect(stored.rows[0]?.status).toBe('draft');
    expect(stored.rows[0]?.gross).toBe('5000.0000');
    // And the primitive still returns its designed zero — the fix is in the composition
    // above it, not in the database.
    //
    // `'0'`, not `'0.0000'`: the draft short-circuit is a bare `RETURN 0`, so it is an
    // UNSCALED numeric literal, while a real settled balance comes back from
    // `round(…, 4)` as `'0.0000'`. The two zeros are not even the same string — which is
    // a neat illustration of the point, though nothing should depend on it, since the
    // composition distinguishes them by the invoice's status rather than by shape.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('0');

    const eligibility = await eligibilityOf(delivery.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blockers).toContain('financial_balance_outstanding');

    // `established: true`, not false: this is not a fact we failed to read. We read it
    // exactly, and it says the money is not collectable yet. The reason has to reach the
    // operator, or the blocker is unactionable.
    const fact = eligibility.facts.find((f) => f.blocker === 'financial_balance_outstanding');
    expect(fact?.established).toBe(true);
    expect(fact?.source).toContain('draft');

    // And the handover is actually refused, not merely reported as blocked.
    authAs(SAL_FULL);
    const refused = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '90210', odometerUnit: 'km' },
      { version: await currentVersion(delivery.id) }
    );
    expect(refused.status).toBe(409);
    const row = await deliveryRow(delivery.id);
    expect(row?.status).not.toBe('delivered');
    expect(row?.deliveredAt).toBeNull();
  });

  it('REFUSES a visible document belonging to no part of this delivery as its signature', async () => {
    // Before the fix `linkedToEntity` was discarded, so the signature gate degraded to
    // "name any document id you can see" — and `sel_document_versions_tenant` is
    // `tenant_id = current_tenant_id()` with no permission predicate, so every principal
    // in the tenant can enumerate candidates. Another customer's ID scan satisfied
    // `sal.complete_delivery`'s "a signature exists" gate.
    const { delivery } = await bareDelivery('dlv_unlinked_sig');
    // Tenant-wide (company and branch both NULL) and `pending`, so it passes the scope
    // check and the refused-state check. The ONLY thing wrong with it is provenance:
    // `seedDocumentVersion` writes no `shared.document_links` row.
    const strangerVersionId = await seedDocumentVersion({ tenantId: TENANT_A });

    authAs(SAL_FULL);
    const receiver = await verifyReceiver(delivery.id, { receiverPartnerId: PARTNER_A });
    expect(receiver.status).toBe(201);

    authAs(SAL_FULL);
    const refused = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: strangerVersionId,
    });
    expect(refused.status).toBe(422);
    // Asserted on the VIOLATION, not the message: `problemFor` never emits an
    // `AppFailure` message, so the field path is the only part of the refusal that
    // actually reaches the caller.
    const problem = await bodyOf<{
      readonly code: string;
      readonly violations?: readonly { readonly path: string }[];
    }>(refused);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.map((v) => v.path)).toContain('body.signatureDocumentVersionId');

    // Nothing was bound. A refusal that still writes the row is not a refusal.
    expect(
      await countRowsOf(
        // No `deleted_at` predicate: `sal.delivery_signatures` has no such column. A
        // bound signature is append-only and there is no correction path.
        `SELECT count(*)::text AS n FROM sal.delivery_signatures
          WHERE delivery_record_id = $1`,
        [delivery.id]
      )
    ).toBe(0);

    // The same document, once it IS linked to this delivery's work order, is accepted —
    // so the refusal is about provenance and not about the document.
    const parent = await admin.query<{ work_order_id: string }>(
      `SELECT work_order_id FROM sal.delivery_records WHERE id = $1`,
      [delivery.id]
    );
    await admin.query(
      `INSERT INTO shared.document_links
         (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       SELECT $1, v.document_id, 'wo.work_orders', $2, 'signature', $3, $3
         FROM shared.document_versions v WHERE v.id = $4`,
      [TENANT_A, parent.rows[0]?.work_order_id ?? '', USER_A, strangerVersionId]
    );
    authAs(SAL_FULL);
    const accepted = await attachSignature(delivery.id, {
      signerRole: 'receiver',
      signatureDocumentVersionId: strangerVersionId,
    });
    expect(accepted.status).toBe(201);
  });

  it('lets the principal that COMPLETES obtain the version it must echo, from the API', async () => {
    // `sal.delivery-complete` is `versionGuarded` and `parseIfMatch` accepts only an
    // exact integer — there is no `*`. `tg_delivery_records_touch_metadata` bumps
    // `record_version` on the receiver-verify and signature-attach steps, so the `1` in
    // the create response is stale by the time a handover is completable, and before the
    // fix NO other response carried the value: the guard answered 409 and named nothing
    // to re-read. Every completion test in this file sources its version from
    // `currentVersion()` — a superuser read that bypasses RLS and the API — so the guard
    // was proved to work while the operation was never proved to be REACHABLE.
    const { invoice, delivery } = await handoverReady('dlv_version_reachable', { settled: true });
    expect(invoice.invoiceNumber).not.toBe('');

    // The completing principal is deliberately NOT a delivery manager: it can call
    // neither `POST /deliveries` nor either preparation write.
    authAs(DELIVERY_COMPLETER_ONLY);
    const eligibility = await readEligibility(delivery.id);
    expect(eligibility.status).toBe(200);
    const view = await bodyOf<EligibilityBody & { recordVersion: number }>(eligibility);
    expect(view.eligible).toBe(true);

    // Published both in the body and as an ETag, and already past 1 — the preparation
    // steps moved it, which is exactly what made the create response useless.
    expect(view.recordVersion).toBeGreaterThan(1);
    expect(eligibility.headers.get('etag')).toBe(`"${view.recordVersion}"`);
    expect(view.recordVersion).toBe(await currentVersion(delivery.id));

    // The decisive assertion: the handover completes using ONLY a version the API gave
    // this principal. No admin read anywhere on this path.
    authAs(DELIVERY_COMPLETER_ONLY);
    const completed = await completeDelivery(
      delivery.id,
      { finalOdometerValue: '120500', odometerUnit: 'km' },
      { version: view.recordVersion }
    );
    expect(completed.status).toBe(200);
    expect((await deliveryRow(delivery.id))?.status).toBe('delivered');
  });
});
