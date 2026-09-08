/**
 * The P1-31 delivery read seam — RECOVERY of a write-only record
 * (prerequisites P-2, P-3, P-4 and P-5 of `docs/phase-1/phase-1-31/a0-preflight.md`).
 *
 * ## What was measured, and what this suite has to prove
 *
 * Five of the delivery module's six operations were writes. The single read
 * (`.../eligibility`) answers with BLOCKERS and returns neither the record, nor the
 * receiver, nor the checklist results, nor the signatures. A second create answers
 * `ERR-RES-002` naming only the WORK ORDER, so the delivery id was unrecoverable once
 * the create response was gone. Six of P1-31's sixteen scope items failed on that one
 * absence.
 *
 * So the claim under test is not "these routes return 200". It is **recovery**: that
 * a delivery opened through the product can be found again, in full, by a DIFFERENT
 * person, on a LATER session, with nothing carried over from the request that created
 * it. Every recovery case here therefore calls `__resetAuthenticatorForTests()` after
 * the writes and re-authenticates as a second principal before it reads. Nothing is
 * asserted from a response the write path returned.
 *
 * `RECOVERED` is the single object the recovery cases read back through the published
 * operations. The ids it carries come from the create response ONCE, and are then used
 * only as the expected values a later read must reproduce — never as the source of a
 * field under test.
 *
 * ## The handover case is the point of the phase
 *
 * `SAL_READER` is a second, differently authorised employee: it holds
 * `sal.finance.view`, `sal.delivery.view` and `wo.work_order.read` and **not**
 * `sal.delivery.manage` or `sal.delivery.complete`, so it could not have written any
 * of the rows it reads. That is precisely the handover a workshop performs at the end
 * of a shift, and before this seam it was impossible: the only principal who could see
 * a delivery was one holding a response it had produced itself.
 *
 * ## Isolation is proved in TWO layers, deliberately
 *
 * `SAL_SCOPED_A2` is refused because RLS hides the row (database layer) and
 * `SAL_PERMISSION_ELSEWHERE` — whose permission-blind `app.branch_ids` union makes
 * the same row VISIBLE — is refused by `authorizeScope` against the row's own company
 * and branch (application layer, P1-18-A-01). Widening either assertion to
 * `[403, 404]` would prove only one of them.
 *
 * ## No money crosses this surface, and that is a measurement
 *
 * A delivery record carries no amount column of any kind, and
 * `finalOdometerReadingId` is a `veh.odometer_readings` REFERENCE rather than a
 * reading value. `refusesAnyMoneyShapedNumber` asserts that no response on this seam
 * carries a JSON number under any money-shaped key, so the decimal-string rule cannot
 * be violated here by a future edit either.
 *
 * COVERAGE-EVIDENCE (P1-31 delivery read seam):
 *   sal.work-order-delivery-read: route service authorization success denial cross-tenant isolation
 *   sal.delivery-read: route service authorization success denial cross-tenant isolation
 *   sal.delivery-receiver-read: route service authorization success denial cross-tenant isolation
 *   sal.delivery-checklist-result-list: route service authorization success denial cross-tenant isolation pagination
 *   sal.delivery-signature-list: route service authorization success denial cross-tenant isolation pagination
 *   sal.delivery-status-history: route service authorization success denial cross-tenant isolation pagination
 *
 * None of the six declares an `audit` flag, and that is deliberate rather than an
 * omission: all six register `auditClass: 'none'`, so claiming the flag would claim a
 * record they do not write. None declares `idempotency` or `stale-version` either —
 * they are reads, and none is `idempotent` or `versionGuarded`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
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
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_SCOPED_A2,
  SAL_TENANT_B,
  SIGNATURE_DOCUMENT_VERSION,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  linkSignatureDocumentToWorkOrder,
  seedWorkOrderChain,
  type WorkOrderChain,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_DELIVERY } from '@/app/api/v1/deliveries/route';
import {
  DELIVERY_READ_OPERATION,
  GET as READ_DELIVERY,
} from '@/app/api/v1/deliveries/[deliveryId]/route';
import {
  WORK_ORDER_DELIVERY_READ_OPERATION,
  GET as READ_WORK_ORDER_DELIVERY,
} from '@/app/api/v1/work-orders/[workOrderId]/delivery/route';
import {
  DELIVERY_RECEIVER_READ_OPERATION,
  GET as READ_RECEIVER,
  POST as VERIFY_RECEIVER,
} from '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';
import {
  DELIVERY_CHECKLIST_RESULT_LIST_OPERATION,
  GET as LIST_CHECKLIST_RESULTS,
  POST as RECORD_CHECKLIST,
} from '@/app/api/v1/deliveries/[deliveryId]/checklist-results/route';
import {
  DELIVERY_SIGNATURE_LIST_OPERATION,
  GET as LIST_SIGNATURES,
  POST as ATTACH_SIGNATURE,
} from '@/app/api/v1/deliveries/[deliveryId]/signatures/route';
import {
  DELIVERY_STATUS_HISTORY_OPERATION,
  GET as READ_STATUS_HISTORY,
} from '@/app/api/v1/deliveries/[deliveryId]/status-history/route';

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// The six operation ids, read from the registrations themselves.
//
// Written out as literals so the coverage gate can see this file INVOKE each
// operation rather than merely name it in a comment — for a `sal.` id the gate
// strips every comment before it looks, so a header line proves nothing.
// ---------------------------------------------------------------------------

const SEAM_OPERATION_IDS = Object.freeze({
  workOrderDelivery: 'sal.work-order-delivery-read',
  delivery: 'sal.delivery-read',
  receiver: 'sal.delivery-receiver-read',
  checklistResults: 'sal.delivery-checklist-result-list',
  signatures: 'sal.delivery-signature-list',
  statusHistory: 'sal.delivery-status-history',
} as const);

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface DeliveryRecordBody {
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
}

interface WorkOrderDeliveryBody {
  readonly workOrderId: string;
  readonly delivery: DeliveryRecordBody | null;
}

interface ReceiverEnvelope {
  readonly deliveryId: string;
  readonly receiver: {
    readonly id: string;
    readonly deliveryRecordId: string;
    readonly receiverPartnerId: string;
    readonly identityEvidenceDocumentVersionId: string | null;
    readonly verifiedBy: string;
    readonly verifiedAt: string;
    readonly recordVersion: number;
  } | null;
}

interface PageEnvelope<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface ChecklistResultsEnvelope {
  readonly deliveryId: string;
  readonly results: PageEnvelope<{
    readonly id: string;
    readonly deliveryRecordId: string;
    readonly templateItemId: string;
    readonly itemCode: string;
    readonly label: string;
    readonly outcome: string;
    readonly waiverReason: string | null;
    readonly recordedBy: string;
    readonly recordVersion: number;
  }>;
}

interface SignaturesEnvelope {
  readonly deliveryId: string;
  readonly signatures: PageEnvelope<{
    readonly id: string;
    readonly deliveryRecordId: string;
    readonly signerRole: string;
    readonly signatureDocumentVersionId: string;
    readonly signedAt: string;
  }>;
}

interface StatusHistoryEnvelope {
  readonly deliveryId: string;
  readonly transitions: PageEnvelope<{
    readonly id: string;
    readonly fromStatus: string | null;
    readonly toStatus: string;
    readonly reason: string | null;
    readonly actorId: string;
    readonly occurredAt: string;
  }>;
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

// ---------------------------------------------------------------------------
// Route drivers. Every read below goes through the real route handler, so the
// permission gate, the scope resolution and the validation all run.
// ---------------------------------------------------------------------------

const query = (page: { cursor?: string; limit?: number } | undefined): string => {
  if (!page) return '';
  const parts: string[] = [];
  if (page.cursor !== undefined) parts.push(`cursor=${encodeURIComponent(page.cursor)}`);
  if (page.limit !== undefined) parts.push(`limit=${String(page.limit)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};

const readWorkOrderDelivery = (workOrderId: string): Promise<Response> =>
  READ_WORK_ORDER_DELIVERY(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/delivery`),
    { params: Promise.resolve({ workOrderId }) }
  );

const readDelivery = (deliveryId: string): Promise<Response> =>
  READ_DELIVERY(new Request(`http://localhost/api/v1/deliveries/${deliveryId}`), {
    params: Promise.resolve({ deliveryId }),
  });

const readReceiver = (deliveryId: string): Promise<Response> =>
  READ_RECEIVER(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/authorized-receiver`),
    { params: Promise.resolve({ deliveryId }) }
  );

const listChecklistResults = (
  deliveryId: string,
  page?: { cursor?: string; limit?: number }
): Promise<Response> =>
  LIST_CHECKLIST_RESULTS(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/checklist-results${query(page)}`),
    { params: Promise.resolve({ deliveryId }) }
  );

const listSignatures = (
  deliveryId: string,
  page?: { cursor?: string; limit?: number }
): Promise<Response> =>
  LIST_SIGNATURES(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/signatures${query(page)}`),
    { params: Promise.resolve({ deliveryId }) }
  );

const readStatusHistory = (
  deliveryId: string,
  page?: { cursor?: string; limit?: number }
): Promise<Response> =>
  READ_STATUS_HISTORY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/status-history${query(page)}`),
    { params: Promise.resolve({ deliveryId }) }
  );

/** Every read of the seam, addressed by delivery id, so a loop can drive them all. */
const DELIVERY_ADDRESSED_READS: readonly {
  readonly id: string;
  readonly call: (deliveryId: string) => Promise<Response>;
}[] = Object.freeze([
  { id: SEAM_OPERATION_IDS.delivery, call: readDelivery },
  { id: SEAM_OPERATION_IDS.receiver, call: readReceiver },
  { id: SEAM_OPERATION_IDS.checklistResults, call: (d: string) => listChecklistResults(d) },
  { id: SEAM_OPERATION_IDS.signatures, call: (d: string) => listSignatures(d) },
  { id: SEAM_OPERATION_IDS.statusHistory, call: (d: string) => readStatusHistory(d) },
]);

// ---------------------------------------------------------------------------
// Write drivers — used ONLY to arrange rows, never to assert one.
// ---------------------------------------------------------------------------

const createDelivery = (workOrderId: string, deliveringEmployeeId: string): Promise<Response> =>
  CREATE_DELIVERY(
    new Request('http://localhost/api/v1/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ workOrderId, deliveringEmployeeId }),
    })
  );

const verifyReceiver = (deliveryId: string, receiverPartnerId: string): Promise<Response> =>
  VERIFY_RECEIVER(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/authorized-receiver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        receiverPartnerId,
        identityEvidenceDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
      }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const recordChecklist = (
  deliveryId: string,
  input: { templateItemId: string; outcome: string }
): Promise<Response> =>
  RECORD_CHECKLIST(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/checklist-results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const attachSignature = (
  deliveryId: string,
  signerRole: string,
  documentVersionId: string
): Promise<Response> =>
  ATTACH_SIGNATURE(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/signatures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ signerRole, signatureDocumentVersionId: documentVersionId }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

// ---------------------------------------------------------------------------
// Fixtures owned by THIS suite
// ---------------------------------------------------------------------------

/**
 * A checklist template of this suite's own, carrying ONLY optional items.
 *
 * Not one mandatory item, and that is a decision: `sal.complete_delivery`'s mandatory
 * scan is COMPANY-scoped rather than template-scoped (the delivery record carries no
 * template reference), so a mandatory item seeded here would block every in-flight
 * delivery in `COMPANY_A1` for every other suite sharing the database.
 *
 * Admin SQL and necessarily so: the checklist template tables have no HTTP surface at
 * all (**PPD-12**, prerequisite P-9), which is itself one of the facts this phase
 * records.
 */
const TEMPLATE_ID = 'f1310000-0000-4000-8000-0000000001a1';
const TEMPLATE_CODE = 'fx_p131_readseam';
const ITEM_CODES = Object.freeze(['fx_p131_item_a', 'fx_p131_item_b'] as const);
const [ITEM_A, ITEM_B] = ITEM_CODES;
const itemIds = new Map<string, string>();

const itemId = (code: string): string => {
  const id = itemIds.get(code);
  if (id === undefined) throw new Error(`checklist item ${code} was not seeded`);
  return id;
};

async function seedChecklistTemplate(): Promise<void> {
  await admin.query(
    `INSERT INTO sal.delivery_checklist_templates
       (id, tenant_id, company_id, template_code, name, created_by)
     VALUES ($1,$2,$3,$4,'P1-31 read-seam checklist',$5)
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_ID, TENANT_A, COMPANY_A1, TEMPLATE_CODE, USER_A]
  );
  for (const [index, code] of ITEM_CODES.entries()) {
    await admin.query(
      `INSERT INTO sal.delivery_checklist_template_items
         (tenant_id, company_id, template_id, item_code, label, is_mandatory, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)
       ON CONFLICT (tenant_id, template_id, item_code) WHERE deleted_at IS NULL DO NOTHING`,
      [TENANT_A, COMPANY_A1, TEMPLATE_ID, code, `P1-31 ${code}`, index, USER_A]
    );
  }
  const rows = await admin.query<{ id: string; item_code: string }>(
    `SELECT id, item_code FROM sal.delivery_checklist_template_items
      WHERE tenant_id = $1 AND template_id = $2 AND deleted_at IS NULL`,
    [TENANT_A, TEMPLATE_ID]
  );
  for (const row of rows.rows) itemIds.set(row.item_code, row.id);
}

/**
 * A tenant-A principal holding every `sal` delivery code EXCEPT `sal.delivery.view`.
 *
 * The whole point of the authorization cases: its refusal is the MISSING PERMISSION
 * and nothing else. It can open a delivery and it cannot read one back, which without
 * this principal would be indistinguishable from a scope or tenancy refusal.
 */
const SAL_NO_DELIVERY_VIEW: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000002a1',
  userId: 'f1310000-0000-4000-8000-0000000002a2',
  subject: 'fx_p1_31_no_delivery_view',
  tenantId: TENANT_A,
  permissions: ['sal.delivery.manage', 'sal.finance.view', 'wo.work_order.read'],
};

async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 read-seam principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 read-seam fixture',$4) ON CONFLICT (id) DO NOTHING`,
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
 * A SECOND version of the P1-22 signature document, so one delivery can carry two
 * signatures and the signature read can be proved to be a PAGE rather than a row.
 *
 * `sal.delivery_signatures` has no unique constraint on `(delivery, signer_role)` —
 * corrections are made by appending — which is exactly why the read is paged, and a
 * one-row fixture could not distinguish a page from a singleton.
 *
 * A second VERSION of the existing document rather than a new document, because
 * `requireUsableDocumentVersion` refuses a version whose document is not linked to
 * the delivery's work order, `shared.document_links` is keyed on the DOCUMENT, and
 * `linkSignatureDocumentToWorkOrder` already writes that link. A second document
 * would need a second link and would prove nothing extra.
 */
const SECOND_VERSION = 'f1310000-0000-4000-8000-0000000003a3';

async function seedSecondSignatureVersion(): Promise<void> {
  const parent = await admin.query<{ document_id: string }>(
    `SELECT document_id FROM shared.document_versions WHERE id = $1`,
    [SIGNATURE_DOCUMENT_VERSION]
  );
  const documentId = parent.rows[0]?.document_id;
  if (documentId === undefined) {
    throw new Error('the P1-22 signature document version was not seeded');
  }
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes,
        sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,2,'p131/sig/v2.pdf','application/pdf',2048,
             decode(repeat('cd',32),'hex'),$4,$4)
     ON CONFLICT (id) DO NOTHING`,
    [SECOND_VERSION, TENANT_A, documentId, USER_A]
  );
}

/**
 * A delivery with a receiver, two checklist results and two signatures, arranged
 * through the REAL write routes as `SAL_FULL`.
 *
 * Returns only the ids a later read must reproduce. Nothing else from the write
 * responses is carried forward, and the authenticator is reset before it returns, so
 * a caller cannot accidentally read under the creating session.
 */
interface ArrangedDelivery {
  readonly chain: WorkOrderChain;
  readonly deliveryId: string;
  readonly receiverId: string;
  readonly checklistResultIds: readonly string[];
  readonly signatureIds: readonly string[];
}

async function arrangeDelivery(tag: string): Promise<ArrangedDelivery> {
  const chain = await seedWorkOrderChain(tag);
  await linkSignatureDocumentToWorkOrder(chain.workOrderId);
  authAs(SAL_FULL);

  const created = await createDelivery(chain.workOrderId, randomUUID());
  expect(created.status).toBe(201);
  const deliveryId = (await bodyOf<{ id: string }>(created)).id;

  const verified = await verifyReceiver(deliveryId, PARTNER_A);
  expect(verified.status).toBe(201);
  const receiverId = (await bodyOf<{ id: string }>(verified)).id;

  const checklistResultIds: string[] = [];
  for (const code of [ITEM_A, ITEM_B]) {
    const recorded = await recordChecklist(deliveryId, {
      templateItemId: itemId(code),
      outcome: 'passed',
    });
    expect(recorded.status).toBe(201);
    checklistResultIds.push((await bodyOf<{ id: string }>(recorded)).id);
  }

  const signatureIds: string[] = [];
  for (const [role, version] of [
    ['receiver', SIGNATURE_DOCUMENT_VERSION],
    ['delivering_employee', SECOND_VERSION],
  ] as const) {
    const attached = await attachSignature(deliveryId, role, version);
    expect(attached.status).toBe(201);
    signatureIds.push((await bodyOf<{ id: string }>(attached)).id);
  }

  // The creating session ENDS here. Every recovery assertion below re-authenticates.
  __resetAuthenticatorForTests();

  return { chain, deliveryId, receiverId, checklistResultIds, signatureIds };
}

/**
 * Refuses a JSON number under any money-shaped key, anywhere in a response.
 *
 * There is no money on this seam, so the correct assertion is not "the amounts are
 * strings" but "there are no amounts". This walks the whole document so a future field
 * cannot slip a float in under a nested object.
 */
const MONEY_KEYS = Object.freeze([
  'amount',
  'net',
  'tax',
  'gross',
  'total',
  'balance',
  'price',
  'unitPrice',
  'outstanding',
]);

function refusesAnyMoneyShapedNumber(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) refusesAnyMoneyShapedNumber(entry);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number') {
      expect(MONEY_KEYS.some((money) => key.toLowerCase().includes(money))).toBe(false);
    }
    refusesAnyMoneyShapedNumber(entry);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let RECOVERED: ArrangedDelivery;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  await seedChecklistTemplate();
  await seedSecondSignatureVersion();
  await seedLocalPrincipal(SAL_NO_DELIVERY_VIEW);
  RECOVERED = await arrangeDelivery('p131_recovery');
}, 240_000);

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
// The registrations themselves
// ---------------------------------------------------------------------------

describe('the six registrations', () => {
  it('declare sal.delivery.view, branch scope and no audit class', () => {
    const registrations = [
      WORK_ORDER_DELIVERY_READ_OPERATION,
      DELIVERY_READ_OPERATION,
      DELIVERY_RECEIVER_READ_OPERATION,
      DELIVERY_CHECKLIST_RESULT_LIST_OPERATION,
      DELIVERY_SIGNATURE_LIST_OPERATION,
      DELIVERY_STATUS_HISTORY_OPERATION,
    ];
    expect(registrations.map((operation) => operation.id)).toEqual([
      SEAM_OPERATION_IDS.workOrderDelivery,
      SEAM_OPERATION_IDS.delivery,
      SEAM_OPERATION_IDS.receiver,
      SEAM_OPERATION_IDS.checklistResults,
      SEAM_OPERATION_IDS.signatures,
      SEAM_OPERATION_IDS.statusHistory,
    ]);
    for (const operation of registrations) {
      // `sal.delivery.view` and NOT `sal.delivery.read`, which navigation.ts names
      // and the seeded catalogue does not define (RES-05). A route gated on a code
      // no actor can hold is a route nobody can call.
      expect(operation.permissions).toEqual(['sal.delivery.view']);
      expect(operation.scope).toBe('branch');
      expect(operation.method).toBe('GET');
      expect(operation.auditClass).toBe('none');
    }
  });
});

// ---------------------------------------------------------------------------
// P-2 — recovery of the delivery id from the work order
// ---------------------------------------------------------------------------

describe(`P-2 ${SEAM_OPERATION_IDS.workOrderDelivery}`, () => {
  it('recovers the delivery id from the work order after the creating session is gone', async () => {
    // Nothing from the create response is used to ADDRESS this read: the work order
    // id is the only input, and it is the thing an operator still has on a job card.
    authAs(SAL_FULL);
    const response = await readWorkOrderDelivery(RECOVERED.chain.workOrderId);
    expect(response.status).toBe(200);
    const body = await bodyOf<WorkOrderDeliveryBody>(response);
    expect(body.workOrderId).toBe(RECOVERED.chain.workOrderId);
    // THE recovery assertion. Before this route the id was unrecoverable once the
    // create response was gone, and a second create answered ERR-RES-002 naming only
    // the work order.
    expect(body.delivery?.id).toBe(RECOVERED.deliveryId);
    expect(body.delivery?.workOrderId).toBe(RECOVERED.chain.workOrderId);
    expect(body.delivery?.status).toBe('signed');
    refusesAnyMoneyShapedNumber(body);
  });

  it('answers 200 with delivery: null when the work order has no delivery', async () => {
    const chain = await seedWorkOrderChain('p131_no_delivery');
    authAs(SAL_FULL);
    const response = await readWorkOrderDelivery(chain.workOrderId);
    expect(response.status).toBe(200);
    const body = await bodyOf<WorkOrderDeliveryBody>(response);
    // Absence is a 200, NOT a 404. A 404 here would be indistinguishable from "that
    // work order is not visible to you" — an existence oracle disguised as an empty
    // result.
    expect(body.workOrderId).toBe(chain.workOrderId);
    expect(body.delivery).toBeNull();
  });

  it('401 unauthenticated, and 403 without sal.delivery.view', async () => {
    __resetAuthenticatorForTests();
    expect((await readWorkOrderDelivery(RECOVERED.chain.workOrderId)).status).toBe(401);

    // Holds sal.delivery.manage and wo.work_order.read, so this refusal is the one
    // missing code and nothing else.
    authAs(SAL_NO_DELIVERY_VIEW);
    const refused = await readWorkOrderDelivery(RECOVERED.chain.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('refuses a malformed work-order id before any row is read', async () => {
    authAs(SAL_FULL);
    const refused = await readWorkOrderDelivery('not-a-uuid');
    expect(refused.status).toBe(422);
    expect(await codeOf(refused)).toBe('ERR-VAL-001');
  });

  it('tells another tenant nothing about existence', async () => {
    authAs(SAL_TENANT_B);
    const refused = await readWorkOrderDelivery(RECOVERED.chain.workOrderId);
    // 404 and not 403: a 403 on an id the caller may not see would confirm the id
    // names a real work order somewhere.
    expect(refused.status).toBe(404);
    expect(await codeOf(refused)).toBe('ERR-RES-001');
  });

  it('is refused in both isolation layers', async () => {
    // Database layer: RLS hides the parent work order outright.
    authAs(SAL_SCOPED_A2);
    const hidden = await readWorkOrderDelivery(RECOVERED.chain.workOrderId);
    expect(hidden.status).toBe(404);
    expect(await codeOf(hidden)).toBe('ERR-RES-001');

    // Application layer: the widening grant makes the same row VISIBLE to RLS, so
    // the only thing that can refuse is authorizeScope against the work order's own
    // company and branch (P1-18-A-01).
    __resetAuthenticatorForTests();
    authAs(SAL_PERMISSION_ELSEWHERE);
    const refused = await readWorkOrderDelivery(RECOVERED.chain.workOrderId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });
});

// ---------------------------------------------------------------------------
// P-3 — the record itself
// ---------------------------------------------------------------------------

describe(`P-3 ${SEAM_OPERATION_IDS.delivery}`, () => {
  it('reads the whole record back, with its current version as the ETag', async () => {
    authAs(SAL_FULL);
    const response = await readDelivery(RECOVERED.deliveryId);
    expect(response.status).toBe(200);
    const body = await bodyOf<DeliveryRecordBody>(response);
    expect(body.id).toBe(RECOVERED.deliveryId);
    expect(body.workOrderId).toBe(RECOVERED.chain.workOrderId);
    expect(body.vehicleId).toBe(RECOVERED.chain.vehicleId);
    expect(body.receptionVisitId).toBe(RECOVERED.chain.visitId);
    expect(body.companyId).toBe(RECOVERED.chain.companyId);
    expect(body.branchId).toBe(RECOVERED.chain.branchId);
    expect(body.status).toBe('signed');
    // Not delivered: this delivery was never completed, so the biconditional
    // ck_delivery_records_delivered_shape keeps both of these NULL.
    expect(body.deliveredAt).toBeNull();
    expect(body.finalOdometerReadingId).toBeNull();
    // The version an If-Match on sal.delivery-complete must carry, published in the
    // body AND as the ETag so this read is the re-read that guard needs.
    expect(body.recordVersion).toBeGreaterThan(1);
    expect(response.headers.get('etag')).toBe(`"${String(body.recordVersion)}"`);
    refusesAnyMoneyShapedNumber(body);
  });

  it('401 unauthenticated, and 403 without sal.delivery.view', async () => {
    __resetAuthenticatorForTests();
    expect((await readDelivery(RECOVERED.deliveryId)).status).toBe(401);

    authAs(SAL_NO_DELIVERY_VIEW);
    const refused = await readDelivery(RECOVERED.deliveryId);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('refuses a malformed id, and answers 404 for an unknown one', async () => {
    authAs(SAL_FULL);
    const malformed = await readDelivery('not-a-uuid');
    expect(malformed.status).toBe(422);
    expect(await codeOf(malformed)).toBe('ERR-VAL-001');

    const unknown = await readDelivery(randomUUID());
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe('ERR-RES-001');
  });
});

// ---------------------------------------------------------------------------
// P-4 and P-5 — the subresources and the ledger, read back in full
// ---------------------------------------------------------------------------

describe('P-4 and P-5 the subresource reads', () => {
  it(`${SEAM_OPERATION_IDS.receiver} returns the receiver as a ROW, not a blocker`, async () => {
    authAs(SAL_FULL);
    const response = await readReceiver(RECOVERED.deliveryId);
    expect(response.status).toBe(200);
    const body = await bodyOf<ReceiverEnvelope>(response);
    expect(body.deliveryId).toBe(RECOVERED.deliveryId);
    // WHO, not merely whether. Until this route the row was collapsed into the
    // boolean `receiver_not_verified` blocker and a screen could learn only the
    // latter.
    expect(body.receiver?.id).toBe(RECOVERED.receiverId);
    expect(body.receiver?.receiverPartnerId).toBe(PARTNER_A);
    expect(body.receiver?.identityEvidenceDocumentVersionId).toBe(SIGNATURE_DOCUMENT_VERSION);
    expect(typeof body.receiver?.verifiedBy).toBe('string');
    expect(typeof body.receiver?.verifiedAt).toBe('string');
  });

  it(`${SEAM_OPERATION_IDS.receiver} answers 200 with receiver: null before verification`, async () => {
    const chain = await seedWorkOrderChain('p131_no_receiver');
    authAs(SAL_FULL);
    const created = await createDelivery(chain.workOrderId, randomUUID());
    expect(created.status).toBe(201);
    const deliveryId = (await bodyOf<{ id: string }>(created)).id;

    const response = await readReceiver(deliveryId);
    expect(response.status).toBe(200);
    const body = await bodyOf<ReceiverEnvelope>(response);
    // The normal state of a fresh delivery. A 404 would make it indistinguishable
    // from a scope refusal on a delivery the caller may not see.
    expect(body.receiver).toBeNull();
  });

  it(`${SEAM_OPERATION_IDS.checklistResults} returns what was recorded, with the item code`, async () => {
    authAs(SAL_FULL);
    const response = await listChecklistResults(RECOVERED.deliveryId);
    expect(response.status).toBe(200);
    const body = await bodyOf<ChecklistResultsEnvelope>(response);
    expect(body.deliveryId).toBe(RECOVERED.deliveryId);
    expect(body.results.items).toHaveLength(2);
    expect([...body.results.items].map((row) => row.id).sort()).toEqual(
      [...RECOVERED.checklistResultIds].sort()
    );
    for (const row of body.results.items) {
      expect(row.outcome).toBe('passed');
      expect(row.waiverReason).toBeNull();
      // The template has no HTTP surface (PPD-12), so without the joined code and
      // label a result is an opaque pair of uuids.
      expect(ITEM_CODES).toContain(row.itemCode);
      expect(row.label).toContain(row.itemCode);
    }
  });

  it(`${SEAM_OPERATION_IDS.signatures} returns both signatures as references, never bytes`, async () => {
    authAs(SAL_FULL);
    const response = await listSignatures(RECOVERED.deliveryId);
    expect(response.status).toBe(200);
    const body = await bodyOf<SignaturesEnvelope>(response);
    expect(body.signatures.items).toHaveLength(2);
    expect([...body.signatures.items].map((row) => row.id).sort()).toEqual(
      [...RECOVERED.signatureIds].sort()
    );
    expect([...body.signatures.items].map((row) => row.signerRole).sort()).toEqual([
      'delivering_employee',
      'receiver',
    ]);
    // A document-version REFERENCE and nothing else. Asserted against the whole
    // serialised document so a future field could not smuggle content in.
    const serialised = JSON.stringify(body);
    for (const forbidden of ['storageKey', 'contentType', 'sha256', 'bytes', 'data:image']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it(`${SEAM_OPERATION_IDS.statusHistory} returns every transition, newest first, with the origin`, async () => {
    authAs(SAL_FULL);
    const response = await readStatusHistory(RECOVERED.deliveryId);
    expect(response.status).toBe(200);
    const body = await bodyOf<StatusHistoryEnvelope>(response);
    expect(body.deliveryId).toBe(RECOVERED.deliveryId);
    // ready -> receiver_verified -> signed. Written on every transition since P1-22
    // and read by nothing until this route (P1-27-INT-089).
    expect([...body.transitions.items].map((row) => row.toStatus)).toEqual([
      'signed',
      'receiver_verified',
      'ready',
    ]);
    // The OLDEST row is already the origin: sal.delivery_records has no AFTER UPDATE
    // history trigger, so the create appends its own genesis row with a null
    // from_status, and no synthetic `origin` block is published.
    const oldest = body.transitions.items[body.transitions.items.length - 1];
    expect(oldest?.toStatus).toBe('ready');
    expect(oldest?.fromStatus).toBeNull();
    expect(JSON.stringify(body)).not.toContain('origin');
    // Server-stamped by shared.stamp_status_history; actor_id is NOT NULL in the DDL.
    for (const row of body.transitions.items) expect(typeof row.actorId).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// The handover — a second, differently authorised employee
// ---------------------------------------------------------------------------

describe('handover to a second employee', () => {
  it('lets a reader who wrote none of these rows read all five back', async () => {
    // SAL_READER holds sal.finance.view, sal.delivery.view and wo.work_order.read
    // and NOT sal.delivery.manage — so it could not have created the delivery, the
    // receiver, the checklist results or the signatures. This is the handover the
    // phase exists to make possible, and before this seam it was impossible.
    authAs(SAL_READER);

    const viaWorkOrder = await readWorkOrderDelivery(RECOVERED.chain.workOrderId);
    expect(viaWorkOrder.status).toBe(200);
    expect((await bodyOf<WorkOrderDeliveryBody>(viaWorkOrder)).delivery?.id).toBe(
      RECOVERED.deliveryId
    );

    const record = await readDelivery(RECOVERED.deliveryId);
    expect(record.status).toBe(200);
    expect((await bodyOf<DeliveryRecordBody>(record)).id).toBe(RECOVERED.deliveryId);

    const receiver = await readReceiver(RECOVERED.deliveryId);
    expect(receiver.status).toBe(200);
    expect((await bodyOf<ReceiverEnvelope>(receiver)).receiver?.id).toBe(RECOVERED.receiverId);

    const results = await listChecklistResults(RECOVERED.deliveryId);
    expect(results.status).toBe(200);
    expect((await bodyOf<ChecklistResultsEnvelope>(results)).results.items).toHaveLength(2);

    const signatures = await listSignatures(RECOVERED.deliveryId);
    expect(signatures.status).toBe(200);
    expect((await bodyOf<SignaturesEnvelope>(signatures)).signatures.items).toHaveLength(2);

    const history = await readStatusHistory(RECOVERED.deliveryId);
    expect(history.status).toBe(200);
    expect((await bodyOf<StatusHistoryEnvelope>(history)).transitions.items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Authorization, tenancy and scope, across every delivery-addressed read
// ---------------------------------------------------------------------------

describe('every delivery-addressed read is gated the same way', () => {
  it('401 unauthenticated', async () => {
    __resetAuthenticatorForTests();
    for (const read of DELIVERY_ADDRESSED_READS) {
      const response = await read.call(RECOVERED.deliveryId);
      expect(response.status, read.id).toBe(401);
    }
  });

  it('403 ERR-IAM-001 without sal.delivery.view', async () => {
    authAs(SAL_NO_DELIVERY_VIEW);
    for (const read of DELIVERY_ADDRESSED_READS) {
      const response = await read.call(RECOVERED.deliveryId);
      expect(response.status, read.id).toBe(403);
      expect(await codeOf(response), read.id).toBe('ERR-IAM-001');
    }
  });

  it('404 ERR-RES-001 for another tenant, revealing no existence', async () => {
    authAs(SAL_TENANT_B);
    for (const read of DELIVERY_ADDRESSED_READS) {
      const response = await read.call(RECOVERED.deliveryId);
      // Not-found is decided BEFORE the scope decision, so a foreign tenant cannot
      // tell a real delivery id from an invented one.
      expect(response.status, read.id).toBe(404);
      expect(await codeOf(response), read.id).toBe('ERR-RES-001');
    }
  });

  it('404 from RLS when the caller is scoped to another branch', async () => {
    authAs(SAL_SCOPED_A2);
    for (const read of DELIVERY_ADDRESSED_READS) {
      const response = await read.call(RECOVERED.deliveryId);
      expect(response.status, read.id).toBe(404);
      expect(await codeOf(response), read.id).toBe('ERR-RES-001');
    }
  });

  it('403 from authorizeScope when RLS can see the row but the grant is elsewhere', async () => {
    // The decisive isolation case. SAL_PERMISSION_ELSEWHERE's permission-blind
    // app.branch_ids union makes BRANCH_A1 visible, so RLS returns the row and the
    // in-service authorizeScope on the row's own company and branch is the ONLY
    // guard. Deleting that call turns every assertion here from 403 to 200.
    authAs(SAL_PERMISSION_ELSEWHERE);
    for (const read of DELIVERY_ADDRESSED_READS) {
      const response = await read.call(RECOVERED.deliveryId);
      expect(response.status, read.id).toBe(403);
      expect(await codeOf(response), read.id).toBe('ERR-IAM-001');
    }
  });
});

// ---------------------------------------------------------------------------
// Paging on the three paged reads
// ---------------------------------------------------------------------------

describe('the three paged reads', () => {
  it(`${SEAM_OPERATION_IDS.signatures} pages disjointly and mints a usable cursor`, async () => {
    authAs(SAL_FULL);
    const first = await listSignatures(RECOVERED.deliveryId, { limit: 1 });
    expect(first.status).toBe(200);
    const firstBody = await bodyOf<SignaturesEnvelope>(first);
    expect(firstBody.signatures.items).toHaveLength(1);
    expect(firstBody.signatures.hasMore).toBe(true);
    expect(firstBody.signatures.nextCursor).not.toBeNull();

    const second = await listSignatures(RECOVERED.deliveryId, {
      limit: 1,
      cursor: firstBody.signatures.nextCursor ?? '',
    });
    expect(second.status).toBe(200);
    const secondBody = await bodyOf<SignaturesEnvelope>(second);
    expect(secondBody.signatures.items).toHaveLength(1);
    // DISJOINT. Both signatures were attached inside one suite run and share
    // `signed_at` to the microsecond, so a millisecond-truncated cursor would have
    // skipped the second row entirely (P1-27-INT-006) — the failure mode nobody
    // notices, because it loses rows rather than duplicating them.
    expect(secondBody.signatures.items[0]?.id).not.toBe(firstBody.signatures.items[0]?.id);
    expect(secondBody.signatures.hasMore).toBe(false);
    expect(secondBody.signatures.nextCursor).toBeNull();
  });

  it(`${SEAM_OPERATION_IDS.checklistResults} pages disjointly`, async () => {
    authAs(SAL_FULL);
    const first = await listChecklistResults(RECOVERED.deliveryId, { limit: 1 });
    const firstBody = await bodyOf<ChecklistResultsEnvelope>(first);
    expect(firstBody.results.items).toHaveLength(1);
    expect(firstBody.results.hasMore).toBe(true);

    const second = await listChecklistResults(RECOVERED.deliveryId, {
      limit: 1,
      cursor: firstBody.results.nextCursor ?? '',
    });
    const secondBody = await bodyOf<ChecklistResultsEnvelope>(second);
    expect(secondBody.results.items[0]?.id).not.toBe(firstBody.results.items[0]?.id);
  });

  it(`${SEAM_OPERATION_IDS.statusHistory} pages disjointly`, async () => {
    authAs(SAL_FULL);
    const first = await readStatusHistory(RECOVERED.deliveryId, { limit: 2 });
    const firstBody = await bodyOf<StatusHistoryEnvelope>(first);
    expect(firstBody.transitions.items).toHaveLength(2);
    expect(firstBody.transitions.hasMore).toBe(true);

    const second = await readStatusHistory(RECOVERED.deliveryId, {
      limit: 2,
      cursor: firstBody.transitions.nextCursor ?? '',
    });
    const secondBody = await bodyOf<StatusHistoryEnvelope>(second);
    expect(secondBody.transitions.items).toHaveLength(1);
    const firstIds = firstBody.transitions.items.map((row) => row.id);
    expect(firstIds).not.toContain(secondBody.transitions.items[0]?.id);
  });

  it('refuses a malformed cursor and an unknown query parameter, differently', async () => {
    authAs(SAL_FULL);
    const badCursor = await listSignatures(RECOVERED.deliveryId, { cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect(await codeOf(badCursor)).toBe('ERR-PAG-001');

    const unknownParameter = await LIST_SIGNATURES(
      new Request(
        `http://localhost/api/v1/deliveries/${RECOVERED.deliveryId}/signatures?somethingElse=1`
      ),
      { params: Promise.resolve({ deliveryId: RECOVERED.deliveryId }) }
    );
    expect(unknownParameter.status).toBe(422);
    expect(await codeOf(unknownParameter)).toBe('ERR-VAL-001');
  });

  it('refuses a cursor minted for a different list', async () => {
    authAs(SAL_FULL);
    const signatures = await listSignatures(RECOVERED.deliveryId, { limit: 1 });
    const cursor = (await bodyOf<SignaturesEnvelope>(signatures)).signatures.nextCursor ?? '';
    // The ordering contract's key is part of the cursor, so a cursor cannot be spent
    // on a list it was not minted for.
    const crossed = await readStatusHistory(RECOVERED.deliveryId, { limit: 1, cursor });
    expect(crossed.status).toBe(400);
    expect(await codeOf(crossed)).toBe('ERR-PAG-001');
  });
});
