/**
 * The delivery-readiness queue (Phase 1-31, Owner decision **D-3** of 2026-09-09).
 *
 * `GET /api/v1/deliveries` lists delivery RECORDS. The queue an advisor works from is
 * a different set: the work orders the SERVER considers ready to hand over, including
 * the ones with no delivery record yet — which the record list cannot contain by
 * construction, and which is precisely when a vehicle is most worth showing. This file
 * proves that set is computed on the server, from the same facts the eligibility
 * composition uses, and that nothing about it is a browser's opinion.
 *
 * ## Every fixture is arranged THROUGH THE PRODUCT
 *
 * No work order is inserted, no invoice is born issued, no state is set by UPDATE. A
 * work order comes from reception's conversion, reaches `closed` through the four
 * transition edges and then the closure command, its invoice is issued by
 * `sal.issue_invoice` and settled through the real payment and allocation routes, and
 * its delivery is opened and completed through the delivery routes. That matters here
 * more than usual: the claim under test is "these are the work orders that are
 * genuinely ready", and a fixture that planted the state would prove only that a
 * planted row can be selected.
 *
 * ## The permission claim is proved from four sides
 *
 * The operation declares `sal.delivery.view`, `wo.work_order.read` AND
 * `sal.finance.view`. `SAL_READER` holds those three codes and NOTHING else, so its
 * 200 proves the declaration is sufficient. Three principals each missing exactly one
 * of them are refused `ERR-IAM-001`, so each is proved NECESSARY:
 *
 *   - `SAL_NO_FINANCE` — every sal/wty code except `sal.finance.view`. Its refusal is
 *     the decisive one. Without that code the amount rows are RLS-invisible and the
 *     financial fact would be composed over a zero the caller cannot see; the
 *     eligibility route requires it for exactly that reason and says so in terms.
 *     This suite does NOT test a nulled or softened fact for such a caller, because
 *     there is no such case to test: the operation refuses before any fact is read.
 *   - `READINESS_NO_DELIVERY_VIEW` and `READINESS_NO_WORK_ORDER_READ` — one code
 *     short each, minted by this file so the refusal is about that code alone.
 *
 * ## Four facts, and the other four are ABSENT rather than passing
 *
 * `BLOCKER_CODES` has eight members. Four are counted against a delivery row's id and
 * are unaskable for a work order that has none, so this surface carries only the four
 * keyed on the work order. The suite asserts that `delivery_state_invalid`,
 * `checklist_incomplete`, `receiver_not_verified` and `signature_missing` appear
 * NOWHERE in a response — reporting them as satisfied would be a claim about rows
 * nobody has looked at, and reporting them as blocking would raise them for every
 * eligible work order in the branch.
 *
 * It follows that a handed-over work order raises no blocker here and is still not
 * ready, and that combination is asserted directly: `blockers` empty,
 * `readyToStartDelivery` false. A reader inferring readiness from an empty blocker
 * list would offer a vehicle that has already left.
 *
 * ## What this file does NOT claim
 *
 * The DEFAULT page size is asserted as a CEILING and not as a saturation point: the
 * fixture branch does not hold twenty-one closed work orders, so an unbounded request
 * is asserted to return no more than twenty rather than exactly twenty. The maximum IS
 * proved behaviourally, in both directions, and so is keyset paging across two pages.
 *
 * It touches no write path. `sal.complete_delivery`, `composeFor` and the eligibility
 * route are unchanged by this slice and nothing here re-asserts their behaviour. It
 * does not close FE-001, which is a screen, and it does not close the batch fact ports
 * that `quality`, `billing` and `inventory` owe before this page can grow.
 *
 * COVERAGE-EVIDENCE (P1-31 D-3 delivery-readiness queue):
 *   sal.delivery-readiness-list: route service authorization success denial cross-tenant isolation pagination
 *
 * No `audit` flag: the operation registers `auditClass: 'none'`, so claiming one would
 * claim a record it does not write. No `idempotency` and no `stale-version`: it is a
 * read, and it is neither `idempotent` nor `versionGuarded`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  IDENTITY_PROVIDER,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, FULL, advance, establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  BRANCH_A1,
  COMPANY_A1,
  DELIVERY_VIEW,
  FINANCE_VIEW,
  PARTNER_A,
  PAYMENT_METHOD_A,
  SAL_FULL,
  SAL_NO_FINANCE,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_TENANT_B,
  SIGNATURE_DOCUMENT_VERSION,
  WORK_ORDER_READ,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  linkSignatureDocumentToWorkOrder,
  seedIssuedInvoice,
  seedWorkOrderChain,
  type IssuedInvoice,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  DEFAULT_READINESS_PAGE_SIZE,
  MAX_READINESS_PAGE_SIZE,
  BLOCKER_CODES,
} from '@/modules/delivery';
import {
  DELIVERY_READINESS_LIST_OPERATION,
  GET as LIST_READINESS,
} from '@/app/api/v1/delivery-readiness/route';
import { POST as CREATE_DELIVERY } from '@/app/api/v1/deliveries/route';
import { POST as VERIFY_RECEIVER } from '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';
import { POST as RECORD_CHECKLIST } from '@/app/api/v1/deliveries/[deliveryId]/checklist-results/route';
import { POST as ATTACH_SIGNATURE } from '@/app/api/v1/deliveries/[deliveryId]/signatures/route';
import { POST as COMPLETE_DELIVERY } from '@/app/api/v1/deliveries/[deliveryId]/completion/route';
import { POST as CLOSE_WORK_ORDER } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';

let admin: Pool;
let runtime: Pool;

/** The four blockers this surface may report. */
const WORK_ORDER_BLOCKERS = Object.freeze([
  'work_order_not_complete',
  'quality_control_not_passed',
  'financial_balance_outstanding',
  'part_obligation_outstanding',
]);

/** The four it must never mention, because they are counted against a delivery ROW. */
const DELIVERY_BOUND_BLOCKERS = Object.freeze(
  BLOCKER_CODES.filter((code) => !WORK_ORDER_BLOCKERS.includes(code))
);

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

interface FactView {
  readonly blocker: string;
  readonly established: boolean;
  readonly source: string;
}

interface DeliveryView {
  readonly id: string;
  readonly workOrderId: string;
  readonly status: string;
  readonly recordVersion: number;
}

interface ReadinessRow {
  readonly workOrder: {
    readonly id: string;
    readonly companyId: string;
    readonly branchId: string;
    readonly state: string;
    readonly openedAt: string;
  };
  readonly delivery: DeliveryView | null;
  readonly facts: readonly FactView[];
  readonly blockers: readonly string[];
  readonly readyToStartDelivery: boolean;
}

interface ReadinessBody {
  readonly items: readonly ReadinessRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly requiredPermissions?: readonly string[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const problemOf = (response: Response): Promise<ProblemBody> => bodyOf<ProblemBody>(response);

// ---------------------------------------------------------------------------
// Route drivers
// ---------------------------------------------------------------------------

function listReadiness(query: Record<string, string | number | undefined> = {}): Promise<Response> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return LIST_READINESS(
    new Request(`http://localhost/api/v1/delivery-readiness?${search.toString()}`)
  );
}

/** The branch under test, read by whichever principal the caller has just set. */
const listBranchA1 = (extra: Record<string, string | number | undefined> = {}): Promise<Response> =>
  listReadiness({ companyId: COMPANY_A1, branchId: BRANCH_A1, ...extra });

const okPage = async (
  extra: Record<string, string | number | undefined> = {}
): Promise<ReadinessBody> => {
  const response = await listBranchA1(extra);
  if (response.status !== 200) {
    throw new Error(`readiness read failed with ${response.status}: ${await response.text()}`);
  }
  return bodyOf<ReadinessBody>(response);
};

const post = (url: string, body: unknown, extraHeaders: Record<string, string> = {}): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Principals minted by this file
//
// Each is the existing three-code reader MINUS exactly one code, so its refusal is
// attributable to that code and never to tenancy, scope or a second omission.
// ---------------------------------------------------------------------------

const READINESS_NO_DELIVERY_VIEW: Principal = {
  roleId: 'f1310000-0000-4000-8000-000000003101',
  userId: 'f1310000-0000-4000-8000-000000003102',
  subject: 'fx_p1_31_rdy_no_delivery_view',
  tenantId: TENANT_A,
  permissions: [FINANCE_VIEW, WORK_ORDER_READ],
};

const READINESS_NO_WORK_ORDER_READ: Principal = {
  roleId: 'f1310000-0000-4000-8000-000000003111',
  userId: 'f1310000-0000-4000-8000-000000003112',
  subject: 'fx_p1_31_rdy_no_work_order_read',
  tenantId: TENANT_A,
  permissions: [FINANCE_VIEW, DELIVERY_VIEW],
};

const LOCAL_PRINCIPALS = [READINESS_NO_DELIVERY_VIEW, READINESS_NO_WORK_ORDER_READ] as const;

/**
 * Account, role, role-permission rows and an unrestricted grant.
 *
 * The `role_permissions` insert JOINS `iam.permissions`, so a code absent from the
 * seeded catalogue yields NO row and the principal silently holds nothing. That is
 * deliberate: a missing catalogue row turns the SUCCESS case red rather than letting a
 * denial pass for the wrong reason.
 */
async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 readiness principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 readiness fixture',$4) ON CONFLICT (id) DO NOTHING`,
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

// ---------------------------------------------------------------------------
// Arrangement — every step through a shipped route
// ---------------------------------------------------------------------------

/** The four edges a work order takes before the closure command may be sent. */
const CLOSURE_PATH = [
  { toState: 'open' },
  { toState: 'in_progress' },
  { toState: 'qc_pending' },
  { toState: 'ready_to_close' },
] as const;

/**
 * Drives a work order to `closed`.
 *
 * The last edge is NOT on `.../transition`: `WorkOrderService` refuses a terminal
 * non-cancellation state there, because ending the workshop's liability is its own
 * authority behind `wo.work_order.close`. The fixture takes the route a client must.
 */
async function closeWorkOrder(workOrderId: string): Promise<void> {
  const version = await advance(workOrderId, CLOSURE_PATH, FULL);
  authAs(FULL);
  const response = await CLOSE_WORK_ORDER(
    post(
      `http://localhost/api/v1/work-orders/${workOrderId}/closure`,
      { toState: 'closed' },
      { 'if-match': String(version) }
    ),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (response.status !== 200) {
    throw new Error(
      `fixture closure of ${workOrderId} failed with ${response.status}: ${await response.text()}`
    );
  }
}

/** Drives a work order to `cancelled` — closed, but a cancellation. */
async function cancelWorkOrder(workOrderId: string): Promise<void> {
  await advance(
    workOrderId,
    [{ toState: 'open' }, { toState: 'cancelled', reason: 'P1-31 D-3 fixture cancellation' }],
    FULL
  );
}

/** Settles an issued invoice in full, through the real payment routes. */
async function settleInvoice(invoice: IssuedInvoice): Promise<void> {
  authAs(SAL_FULL);
  const recorded = await RECORD_PAYMENT(
    post('http://localhost/api/v1/payments', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency: invoice.currencyCode,
      amount: invoice.gross,
    })
  );
  if (recorded.status !== 201) {
    throw new Error(`fixture receipt failed with ${recorded.status}: ${await recorded.text()}`);
  }
  const receipt = await bodyOf<{ id: string }>(recorded);
  authAs(SAL_FULL);
  const allocated = await ALLOCATE_PAYMENT(
    post(`http://localhost/api/v1/payments/${receipt.id}/allocations`, {
      invoiceId: invoice.invoiceId,
      amount: invoice.gross,
      currency: invoice.currencyCode,
    }),
    { params: Promise.resolve({ paymentId: receipt.id }) }
  );
  if (allocated.status !== 201) {
    throw new Error(
      `fixture allocation failed with ${allocated.status}: ${await allocated.text()}`
    );
  }
}

/** Opens a delivery through `POST /deliveries`. The record is born `ready`. */
async function openDelivery(workOrderId: string): Promise<DeliveryView> {
  await linkSignatureDocumentToWorkOrder(workOrderId);
  authAs(SAL_FULL);
  const response = await CREATE_DELIVERY(
    post('http://localhost/api/v1/deliveries', { workOrderId, deliveringEmployeeId: USER_A })
  );
  if (response.status !== 201) {
    throw new Error(
      `fixture delivery for ${workOrderId} failed with ${response.status}: ${await response.text()}`
    );
  }
  return bodyOf<DeliveryView>(response);
}

/**
 * Records `passed` against every mandatory checklist item the company holds.
 *
 * It does NOT insist that one exists. This suite seeds no checklist template — the
 * readiness surface carries no checklist fact at all, because `checklist_incomplete`
 * is counted against a delivery row — so `COMPANY_A1` legitimately holds none here and
 * `sal.complete_delivery`'s mandatory-item gate is vacuously satisfied. Throwing on
 * zero, as the P1-22 suite does, would be right there and wrong here.
 */
async function passEveryMandatoryItem(deliveryId: string): Promise<void> {
  const items = await admin.query<{ id: string }>(
    `SELECT id FROM sal.delivery_checklist_template_items
      WHERE tenant_id = $1 AND company_id = $2 AND is_mandatory AND deleted_at IS NULL`,
    [TENANT_A, COMPANY_A1]
  );
  for (const item of items.rows) {
    authAs(SAL_FULL);
    const response = await RECORD_CHECKLIST(
      post(`http://localhost/api/v1/deliveries/${deliveryId}/checklist-results`, {
        templateItemId: item.id,
        outcome: 'passed',
      }),
      { params: Promise.resolve({ deliveryId }) }
    );
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(
        `fixture checklist pass failed with ${response.status}: ${await response.text()}`
      );
    }
  }
}

/** Verifies the receiver and binds the signature version, through both routes. */
async function satisfyReceiverAndSignature(deliveryId: string): Promise<void> {
  authAs(SAL_FULL);
  const receiver = await VERIFY_RECEIVER(
    post(`http://localhost/api/v1/deliveries/${deliveryId}/authorized-receiver`, {
      receiverPartnerId: PARTNER_A,
    }),
    { params: Promise.resolve({ deliveryId }) }
  );
  if (receiver.status !== 201) {
    throw new Error(
      `fixture receiver verification failed with ${receiver.status}: ${await receiver.text()}`
    );
  }
  authAs(SAL_FULL);
  const signature = await ATTACH_SIGNATURE(
    post(`http://localhost/api/v1/deliveries/${deliveryId}/signatures`, {
      signerRole: 'receiver',
      signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION,
    }),
    { params: Promise.resolve({ deliveryId }) }
  );
  if (signature.status !== 201) {
    throw new Error(`fixture signature failed with ${signature.status}: ${await signature.text()}`);
  }
}

const currentDeliveryVersion = async (deliveryId: string): Promise<number> => {
  const row = await admin.query<{ record_version: number }>(
    `SELECT record_version FROM sal.delivery_records WHERE id = $1`,
    [deliveryId]
  );
  const version = row.rows[0]?.record_version;
  if (version === undefined) throw new Error(`delivery ${deliveryId} vanished`);
  return version;
};

/** Hands the vehicle over, through `POST .../completion`. */
async function completeDelivery(deliveryId: string): Promise<void> {
  await passEveryMandatoryItem(deliveryId);
  await satisfyReceiverAndSignature(deliveryId);
  const version = await currentDeliveryVersion(deliveryId);
  authAs(SAL_FULL);
  const response = await COMPLETE_DELIVERY(
    post(
      `http://localhost/api/v1/deliveries/${deliveryId}/completion`,
      { finalOdometerValue: '120000', odometerUnit: 'km' },
      { 'if-match': String(version) }
    ),
    { params: Promise.resolve({ deliveryId }) }
  );
  if (response.status !== 200) {
    throw new Error(`fixture completion failed with ${response.status}: ${await response.text()}`);
  }
}

interface Candidate {
  readonly workOrderId: string;
  readonly invoice: IssuedInvoice;
  readonly deliveryId: string | null;
}

/**
 * A CLOSED work order carrying an issued invoice, at a chosen stage of handover.
 *
 * `settled` decides the one financial fact, and everything else is clear by
 * construction — no jobs, no labour, no mandatory QC check, no part reservation — so a
 * row's `blockers` is either exactly `[]` or exactly
 * `['financial_balance_outstanding']` and an assertion about it is about that fact
 * alone.
 */
async function candidate(
  tag: string,
  options: { readonly settled: boolean; readonly stage: 'none' | 'ready' | 'delivered' }
): Promise<Candidate> {
  const invoice = await seedIssuedInvoice(tag);
  await closeWorkOrder(invoice.workOrderId);
  if (options.settled) await settleInvoice(invoice);
  if (options.stage === 'none') {
    return { workOrderId: invoice.workOrderId, invoice, deliveryId: null };
  }
  const delivery = await openDelivery(invoice.workOrderId);
  if (options.stage === 'delivered') await completeDelivery(delivery.id);
  return { workOrderId: invoice.workOrderId, invoice, deliveryId: delivery.id };
}

const rowFor = (page: ReadinessBody, workOrderId: string): ReadinessRow => {
  const row = page.items.find((item) => item.workOrder.id === workOrderId);
  if (row === undefined) {
    throw new Error(`work order ${workOrderId} is absent from the readiness page`);
  }
  return row;
};

// ---------------------------------------------------------------------------
// Money guard — the readiness row reports THAT money is owed, never how much
// ---------------------------------------------------------------------------

const MONEY_KEYS = Object.freeze([
  'amount',
  'currency',
  'price',
  'total',
  'cost',
  'balance',
  'net',
  'gross',
  'tax',
  'outstanding',
  'receivable',
]);

function carriesNoMoney(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) carriesNoMoney(entry);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // Neither a number NOR a string: this surface publishes no amount in any
    // spelling, so an exact decimal string would be just as much a leak as a float.
    if (typeof entry === 'number' || typeof entry === 'string') {
      expect(MONEY_KEYS.some((money) => key.toLowerCase() === money)).toBe(false);
    }
    carriesNoMoney(entry);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let READY: Candidate;
let OWING: Candidate;
let LIVE: Candidate;
let HANDED_OVER: Candidate;
let CANCELLED_WORK_ORDER = '';
let OPEN_WORK_ORDER = '';
let OTHER_BRANCH_WORK_ORDER = '';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  for (const principal of LOCAL_PRINCIPALS) await seedLocalPrincipal(principal);

  READY = await candidate('p131_rdy_clear', { settled: true, stage: 'none' });
  OWING = await candidate('p131_rdy_owing', { settled: false, stage: 'none' });
  LIVE = await candidate('p131_rdy_live', { settled: true, stage: 'ready' });
  HANDED_OVER = await candidate('p131_rdy_done', { settled: true, stage: 'delivered' });

  const cancelled = await seedWorkOrderChain('p131_rdy_cancelled');
  await cancelWorkOrder(cancelled.workOrderId);
  CANCELLED_WORK_ORDER = cancelled.workOrderId;

  const open = await seedWorkOrderChain('p131_rdy_open');
  await advance(open.workOrderId, [{ toState: 'open' }], FULL);
  OPEN_WORK_ORDER = open.workOrderId;

  // A CLOSED work order in the other branch, so "the page holds only branch A1" is a
  // claim about a set that is not empty elsewhere.
  const elsewhere = await seedWorkOrderChain('p131_rdy_branch_a2', { branchId: BRANCH_A2 });
  await closeWorkOrder(elsewhere.workOrderId);
  OTHER_BRANCH_WORK_ORDER = elsewhere.workOrderId;

  __resetAuthenticatorForTests();
}, 600_000);

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

// ===========================================================================
describe('sal.delivery-readiness-list — the registration', () => {
  it('declares the three codes the composition actually reads, and no audit', () => {
    expect(DELIVERY_READINESS_LIST_OPERATION.id).toBe('sal.delivery-readiness-list');
    expect(DELIVERY_READINESS_LIST_OPERATION.method).toBe('GET');
    expect(DELIVERY_READINESS_LIST_OPERATION.path).toBe('/delivery-readiness');
    expect([...DELIVERY_READINESS_LIST_OPERATION.permissions].sort()).toEqual(
      ['sal.delivery.view', 'sal.finance.view', 'wo.work_order.read'].sort()
    );
    expect(DELIVERY_READINESS_LIST_OPERATION.scope).toBe('branch');
    expect(DELIVERY_READINESS_LIST_OPERATION.auditClass).toBe('none');
  });
});

// ===========================================================================
describe('the queue answers for work orders that have NO delivery record', () => {
  it('reports a closed, settled, unencumbered work order as ready with no blockers (success)', async () => {
    authAs(SAL_READER);
    const page = await okPage();
    const row = rowFor(page, READY.workOrderId);

    // The whole point of D-3: no delivery record exists and the row is still here.
    expect(row.delivery).toBeNull();
    expect(row.readyToStartDelivery).toBe(true);
    expect(row.blockers).toEqual([]);
    expect(row.workOrder.state).toBe('closed');
    expect(row.workOrder.branchId).toBe(BRANCH_A1);

    // All four facts present, ESTABLISHED, and each naming where it came from.
    expect(row.facts.map((fact) => fact.blocker)).toEqual([...WORK_ORDER_BLOCKERS]);
    for (const fact of row.facts) {
      expect(fact.established).toBe(true);
      expect(fact.source.length).toBeGreaterThan(0);
    }
  });

  it('reports the delivery-bound blockers NOWHERE, rather than as satisfied', async () => {
    authAs(SAL_READER);
    const page = await okPage();
    const serialised = JSON.stringify(page);
    for (const code of DELIVERY_BOUND_BLOCKERS) {
      expect(serialised).not.toContain(code);
    }
    // And the exclusion is a real subset of a real vocabulary, not an empty loop.
    expect(DELIVERY_BOUND_BLOCKERS.length).toBe(4);
    expect(BLOCKER_CODES.length).toBe(8);
  });

  it('publishes no amount, in any spelling', async () => {
    authAs(SAL_READER);
    carriesNoMoney(await okPage());
  });
});

// ===========================================================================
describe('the financial fact is composed on the server and it BLOCKS', () => {
  it('refuses readiness for an unsettled issued invoice, naming that blocker alone', async () => {
    authAs(SAL_READER);
    const row = rowFor(await okPage(), OWING.workOrderId);

    expect(row.readyToStartDelivery).toBe(false);
    expect(row.blockers).toEqual(['financial_balance_outstanding']);
    // Established and BAD, not unknown: the invoice is issued and visible to this
    // caller, so the fact was read rather than assumed.
    const financial = row.facts.find((fact) => fact.blocker === 'financial_balance_outstanding');
    expect(financial?.established).toBe(true);
  });

  it('the settled and the owing work order differ ONLY in that fact', async () => {
    authAs(SAL_READER);
    const page = await okPage();
    const settled = rowFor(page, READY.workOrderId);
    const owing = rowFor(page, OWING.workOrderId);
    expect(settled.facts.map((fact) => fact.blocker)).toEqual(
      owing.facts.map((fact) => fact.blocker)
    );
    expect(settled.blockers).toEqual([]);
    expect(owing.blockers).toEqual(['financial_balance_outstanding']);
  });
});

// ===========================================================================
describe('the live delivery is attached, and a completed one stops readiness', () => {
  it('carries the ready delivery of a work order that already has one', async () => {
    authAs(SAL_READER);
    const row = rowFor(await okPage(), LIVE.workOrderId);
    expect(row.delivery).not.toBeNull();
    expect(row.delivery?.id).toBe(LIVE.deliveryId);
    expect(row.delivery?.status).toBe('ready');
    expect(row.delivery?.workOrderId).toBe(LIVE.workOrderId);
    // A handover that has been opened but not finished is still one to start.
    expect(row.readyToStartDelivery).toBe(true);
  });

  it('reports a HANDED-OVER work order as not ready while raising no blocker', async () => {
    authAs(SAL_READER);
    const row = rowFor(await okPage(), HANDED_OVER.workOrderId);
    expect(row.delivery?.status).toBe('delivered');
    expect(row.readyToStartDelivery).toBe(false);
    // The decisive shape: `delivery_state_invalid` is delivery-bound and outside this
    // surface's four, so the blocker list is EMPTY and the verdict is still false. A
    // client inferring readiness from an empty list would offer a vehicle that has
    // already left.
    expect(row.blockers).toEqual([]);
  });
});

// ===========================================================================
describe('the candidate set is CLOSED and NOT a cancellation', () => {
  it('excludes a cancelled work order, though `is_closed` is true for it', async () => {
    // The trap this predicate exists for: the platform graph sets
    // (is_terminal, is_closed, is_cancellation) = (true, true, true) on `cancelled`,
    // so a queue built on `is_closed` alone would offer every abandoned job.
    const flags = await admin.query<{ is_closed: boolean; is_cancellation: boolean }>(
      `SELECT is_closed, is_cancellation FROM wo.work_order_states
        WHERE scope = 'platform' AND code = 'cancelled' AND deleted_at IS NULL`
    );
    expect(flags.rows[0]?.is_closed).toBe(true);
    expect(flags.rows[0]?.is_cancellation).toBe(true);

    authAs(SAL_READER);
    const page = await okPage({ limit: MAX_READINESS_PAGE_SIZE });
    expect(page.items.some((item) => item.workOrder.id === CANCELLED_WORK_ORDER)).toBe(false);
  });

  it('excludes a work order that is still open', async () => {
    authAs(SAL_READER);
    const page = await okPage({ limit: MAX_READINESS_PAGE_SIZE });
    expect(page.items.some((item) => item.workOrder.id === OPEN_WORK_ORDER)).toBe(false);
  });

  it('holds only closed, non-cancellation states', async () => {
    authAs(SAL_READER);
    const page = await okPage({ limit: MAX_READINESS_PAGE_SIZE });
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) expect(item.workOrder.state).toBe('closed');
  });
});

// ===========================================================================
describe('every declared permission is necessary, and the three together are sufficient', () => {
  it('admits a principal holding exactly the three declared codes (authorization)', async () => {
    // `SAL_READER` holds `sal.finance.view`, `sal.delivery.view` and
    // `wo.work_order.read` and NOTHING else, so a 200 is proof of sufficiency.
    expect([...SAL_READER.permissions].sort()).toEqual(
      [FINANCE_VIEW, DELIVERY_VIEW, WORK_ORDER_READ].sort()
    );
    authAs(SAL_READER);
    expect((await listBranchA1()).status).toBe(200);
  });

  it('refuses a caller without `sal.finance.view` outright (denial)', async () => {
    // The decisive refusal. Without the code the invoice amounts are RLS-invisible
    // and the financial fact would be composed over a zero the caller cannot see, so
    // the operation refuses BEFORE any fact is read — there is no softened answer for
    // this principal, and this suite deliberately does not invent one.
    authAs(SAL_NO_FINANCE);
    const response = await listBranchA1();
    expect(response.status).toBe(403);
    const problem = await problemOf(response);
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toContain(FINANCE_VIEW);
  });

  it('refuses a caller without `sal.delivery.view` (denial)', async () => {
    authAs(READINESS_NO_DELIVERY_VIEW);
    const response = await listBranchA1();
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('refuses a caller without `wo.work_order.read` (denial)', async () => {
    authAs(READINESS_NO_WORK_ORDER_READ);
    const response = await listBranchA1();
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('401 unauthenticated', async () => {
    __resetAuthenticatorForTests();
    expect((await listBranchA1()).status).toBe(401);
  });
});

// ===========================================================================
describe('tenancy and branch scope', () => {
  it('refuses another tenant the scope, telling it nothing about existence (cross-tenant)', async () => {
    // `SAL_TENANT_B` holds every sal/wty code, so this refusal is tenancy and not
    // authority — and it is identical whether or not that branch has ready work.
    authAs(SAL_TENANT_B);
    const response = await listBranchA1();
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('refuses a caller whose grant is in another branch, though RLS can see the rows (isolation)', async () => {
    // `SAL_PERMISSION_ELSEWHERE` holds every code SCOPED to A2 and carries a widening
    // grant that puts A1 inside the permission-blind `iam.allowed_branch_ids()` union.
    // RLS would therefore return A1's rows; the scoped authorization on the NAMED pair
    // is the only thing that refuses, so deleting that call turns this 403 into a 200.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await listBranchA1();
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('never leaks another branch of the same company into the page (isolation)', async () => {
    authAs(SAL_READER);
    const page = await okPage({ limit: MAX_READINESS_PAGE_SIZE });
    expect(page.items.some((item) => item.workOrder.id === OTHER_BRANCH_WORK_ORDER)).toBe(false);
    for (const item of page.items) {
      expect(item.workOrder.branchId).toBe(BRANCH_A1);
      expect(item.workOrder.companyId).toBe(COMPANY_A1);
    }
    // The exclusion is not vacuous: that work order IS closed, in the same company.
    const state = await admin.query<{ state: string }>(
      `SELECT state FROM wo.work_orders WHERE id = $1`,
      [OTHER_BRANCH_WORK_ORDER]
    );
    expect(state.rows[0]?.state).toBe('closed');
  });

  it('requires the scope to be NAMED at all', async () => {
    authAs(SAL_READER);
    const missing = await listReadiness({ companyId: COMPANY_A1 });
    expect(missing.status).toBe(422);
    expect((await problemOf(missing)).code).toBe('ERR-VAL-001');
  });

  it('refuses an unknown query parameter rather than dropping it', async () => {
    authAs(SAL_READER);
    const response = await listBranchA1({ ready: 'true' });
    expect(response.status).toBe(422);
    expect((await problemOf(response)).code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
describe('the queue pages', () => {
  it('accepts the documented maximum and refuses one above it (pagination)', async () => {
    authAs(SAL_READER);
    expect((await listBranchA1({ limit: MAX_READINESS_PAGE_SIZE })).status).toBe(200);

    authAs(SAL_READER);
    const tooLarge = await listBranchA1({ limit: MAX_READINESS_PAGE_SIZE + 1 });
    // Refused at the boundary rather than clamped: the platform's `resolveLimit`
    // silently returns fewer rows than were asked for, which is right for a cheap
    // list and wrong for one whose page costs about five round trips per row.
    expect(tooLarge.status).toBe(422);
    expect((await problemOf(tooLarge)).code).toBe('ERR-VAL-001');
  });

  it('never returns more than the default when no limit is named (pagination)', async () => {
    authAs(SAL_READER);
    const page = await okPage();
    // A CEILING assertion, stated as such: this branch does not hold twenty-one
    // closed work orders, so the default is proved to bound the page and is not
    // proved to saturate it.
    expect(page.items.length).toBeLessThanOrEqual(DEFAULT_READINESS_PAGE_SIZE);
    expect(DEFAULT_READINESS_PAGE_SIZE).toBeLessThan(MAX_READINESS_PAGE_SIZE);
  });

  it('walks two disjoint pages on the work-order ordering contract (pagination)', async () => {
    authAs(SAL_READER);
    const first = await okPage({ limit: 2 });
    expect(first.items.length).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    authAs(SAL_READER);
    const second = await okPage({ limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items.length).toBeGreaterThan(0);

    const firstIds = first.items.map((item) => item.workOrder.id);
    const secondIds = second.items.map((item) => item.workOrder.id);
    for (const id of secondIds) expect(firstIds).not.toContain(id);
  });

  it('refuses a malformed cursor and a cursor issued for another ordering (pagination)', async () => {
    authAs(SAL_READER);
    const malformed = await listBranchA1({ cursor: 'not-a-cursor' });
    expect(malformed.status).toBe(400);
    expect((await problemOf(malformed)).code).toBe('ERR-PAG-001');

    // Well formed, correctly signed base64url, and issued for a DIFFERENT contract.
    // Re-using it would silently produce a wrong page.
    const foreign = Buffer.from(
      JSON.stringify({
        k: 'wty.warranty_records:start_date_desc',
        v: '2026-01-01',
        i: randomUUID(),
      })
    ).toString('base64url');
    authAs(SAL_READER);
    const response = await listBranchA1({ cursor: foreign });
    expect(response.status).toBe(400);
    expect((await problemOf(response)).code).toBe('ERR-PAG-001');
  });
});
