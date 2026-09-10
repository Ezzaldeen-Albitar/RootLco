/**
 * The P1-31 delivery LIST seam — the set nobody could read
 * (prerequisite P-2b of `docs/phase-1/phase-1-31/a0-preflight.md`).
 *
 * ## What was missing, and what this suite has to prove
 *
 * P-2 … P-5 made a delivery RECOVERABLE: given its own id, or the id of the work
 * order it belongs to, a caller can now read the record, the receiver, the checklist
 * results, the signatures and the transition ledger. Every one of those reads is
 * addressed by an identifier the caller must already hold, so the set itself stayed
 * unreadable — nothing anywhere in the product answered "which deliveries does this
 * branch have". A screen that lists delivery records had no read behind it.
 *
 * `GET /api/v1/deliveries` is that read, and it is the chapter's first declared API.
 *
 * ## The scope claim is the substantive one
 *
 * `companyId` and `branchId` are REQUIRED and are the authorization target, decided
 * BEFORE any row is read — the exact reverse of the five id-addressed reads, which
 * read the row first because a delivery addressed by id has no scope to name until
 * it has been read. A list has no row to take a scope from, so the caller names one
 * and the server refuses it. Two cases below are what make that load-bearing:
 * `SAL_TENANT_B` and `SAL_SCOPED_A2` both NAME this branch's pair while holding every
 * `sal` code, and both are refused before a row is touched, so neither can tell a
 * branch with deliveries from one without.
 *
 * ## Arranged through the published routes
 *
 * Every delivery this suite reads is opened through the real `POST /deliveries`, and
 * the one `delivered` row is produced by the P1-22 fixture that drives
 * `sal.complete_delivery` itself. The authenticator is reset after the arrangement,
 * so no assertion rests on a response the write path returned.
 *
 * ## No money crosses this surface, and that is a measurement
 *
 * A delivery record carries no amount column of any kind, and
 * `finalOdometerReadingId` is a `veh.odometer_readings` REFERENCE rather than a
 * reading value. `refusesAnyMoneyShapedNumber` walks every response for a JSON
 * number under a money-shaped key, so a future field cannot slip a float in.
 *
 * COVERAGE-EVIDENCE (P1-31 delivery list seam):
 *   sal.delivery-list: route service authorization success denial cross-tenant isolation pagination
 *
 * It declares no `audit` flag: the operation registers `auditClass: 'none'`, so
 * claiming one would claim a record it does not write. It declares neither
 * `idempotency` nor `stale-version` — it is a read, and it is neither `idempotent`
 * nor `versionGuarded`.
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
import { establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_SCOPED_A2,
  SAL_TENANT_B,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedDeliveredDelivery,
  seedWorkOrderChain,
  type WorkOrderChain,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  DELIVERY_LIST_OPERATION,
  GET as LIST_DELIVERIES,
  POST as CREATE_DELIVERY,
} from '@/app/api/v1/deliveries/route';
import { GET as READ_DELIVERY } from '@/app/api/v1/deliveries/[deliveryId]/route';

let admin: Pool;
let runtime: Pool;

/**
 * The operation id, written as a literal.
 *
 * The coverage gate strips every comment before it looks for a `sal.` id, so naming
 * the operation in a docblock proves nothing — the file has to INVOKE it.
 */
const LIST_OPERATION_ID = 'sal.delivery-list';

/** The read code. `sal.delivery.read` does not exist in the catalogue (RES-05). */
const DELIVERY_VIEW = 'sal.delivery.view';

// ---------------------------------------------------------------------------
// Wire shapes
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

interface DeliveryListBody {
  readonly items: readonly DeliveryRecordBody[];
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
// Route drivers. Every read goes through the real handler, so the permission
// gate, the scope resolution and the validation all run.
// ---------------------------------------------------------------------------

function listDeliveries(
  query: Record<string, string | number | undefined> = {}
): Promise<Response> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return LIST_DELIVERIES(new Request(`http://localhost/api/v1/deliveries?${search.toString()}`));
}

const readDelivery = (deliveryId: string): Promise<Response> =>
  READ_DELIVERY(new Request(`http://localhost/api/v1/deliveries/${deliveryId}`), {
    params: Promise.resolve({ deliveryId }),
  });

/** Arrangement only. Its response is never asserted on beyond the id it returns. */
const createDelivery = (workOrderId: string, deliveringEmployeeId: string): Promise<Response> =>
  CREATE_DELIVERY(
    new Request('http://localhost/api/v1/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ workOrderId, deliveringEmployeeId }),
    })
  );

// ---------------------------------------------------------------------------
// Fixtures owned by THIS suite
// ---------------------------------------------------------------------------

/**
 * A tenant-A principal holding every delivery code EXCEPT `sal.delivery.view`.
 *
 * Its refusal is the MISSING PERMISSION and nothing else: it can open a delivery and
 * it cannot list one, which without this principal would be indistinguishable from a
 * scope or a tenancy refusal.
 */
const SAL_NO_DELIVERY_VIEW: Principal = {
  roleId: 'f1310000-0000-4000-8000-00000002b001',
  userId: 'f1310000-0000-4000-8000-00000002b002',
  subject: 'fx_p1_31_list_no_view',
  tenantId: TENANT_A,
  permissions: ['sal.delivery.manage', 'sal.finance.view', 'wo.work_order.read'],
};

async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 list-seam principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 list-seam fixture',$4) ON CONFLICT (id) DO NOTHING`,
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

interface OpenedDelivery {
  readonly chain: WorkOrderChain;
  readonly deliveryId: string;
}

/**
 * A `ready` delivery opened through the real `POST /deliveries`.
 *
 * The authenticator is reset before it returns, so a caller cannot accidentally read
 * under the session that wrote the row.
 */
async function openDelivery(
  tag: string,
  scope: { readonly companyId?: string; readonly branchId?: string } = {}
): Promise<OpenedDelivery> {
  const chain = await seedWorkOrderChain(tag, scope);
  authAs(SAL_FULL);
  const created = await createDelivery(chain.workOrderId, randomUUID());
  expect(created.status).toBe(201);
  const deliveryId = (await bodyOf<{ id: string }>(created)).id;
  __resetAuthenticatorForTests();
  return { chain, deliveryId };
}

/**
 * Refuses a JSON number under any money-shaped key, anywhere in a response.
 *
 * There is no money on this surface, so the correct assertion is not "the amounts are
 * strings" but "there are no amounts".
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
//
// FOUR deliveries in the branch under test and one in a second scope:
//   FIRST, SECOND   `ready`, opened through the route, oldest first
//   DELIVERED       `delivered`, produced by the P1-22 fixture that drives
//                   `sal.complete_delivery`, so the status filter has two values
//   WITHDRAWN       opened and then soft-deleted, so the exclusion is provable
//   ELSEWHERE       a second company and branch, so what separates the pages
//                   cannot be tenancy
// ---------------------------------------------------------------------------

let FIRST: OpenedDelivery;
let SECOND: OpenedDelivery;
let DELIVERED: { readonly deliveryId: string; readonly vehicleId: string };
let WITHDRAWN: OpenedDelivery;
let ELSEWHERE: OpenedDelivery;
/** The branch under test, read from the fixture rather than assumed. */
let SCOPE: { companyId: string; branchId: string };

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  await seedLocalPrincipal(SAL_NO_DELIVERY_VIEW);

  FIRST = await openDelivery('p131_list_first');
  SECOND = await openDelivery('p131_list_second');
  const delivered = await seedDeliveredDelivery('p131_list_delivered');
  DELIVERED = { deliveryId: delivered.deliveryId, vehicleId: delivered.vehicleId };
  WITHDRAWN = await openDelivery('p131_list_withdrawn');
  await admin.query(
    `UPDATE sal.delivery_records SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
    [WITHDRAWN.deliveryId, USER_A]
  );
  ELSEWHERE = await openDelivery('p131_list_elsewhere', {
    companyId: COMPANY_A9,
    branchId: BRANCH_A9,
  });

  SCOPE = { companyId: FIRST.chain.companyId, branchId: FIRST.chain.branchId };
  // The fixtures are only comparable if they really landed in one scope.
  expect(SECOND.chain.companyId).toBe(SCOPE.companyId);
  expect(SECOND.chain.branchId).toBe(SCOPE.branchId);
  expect(delivered.companyId).toBe(SCOPE.companyId);
  expect(delivered.branchId).toBe(SCOPE.branchId);
  expect(ELSEWHERE.chain.branchId).not.toBe(SCOPE.branchId);
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
// The registration
// ---------------------------------------------------------------------------

describe('the registration', () => {
  it('declares sal.delivery.view, branch scope, no audit class and no replay', () => {
    expect(DELIVERY_LIST_OPERATION.id).toBe(LIST_OPERATION_ID);
    expect(DELIVERY_LIST_OPERATION.method).toBe('GET');
    expect(DELIVERY_LIST_OPERATION.path).toBe('/deliveries');
    // `sal.delivery.view` and NOT `sal.delivery.read`, which navigation.ts names and
    // the seeded catalogue does not define (RES-05). A route gated on a code no actor
    // can hold is a route nobody can call.
    expect(DELIVERY_LIST_OPERATION.permissions).toEqual([DELIVERY_VIEW]);
    expect(DELIVERY_LIST_OPERATION.scope).toBe('branch');
    expect(DELIVERY_LIST_OPERATION.auditClass).toBe('none');
    // A read writes no audit record, replays nothing and guards no version. Declaring
    // any of the three would be claiming behaviour this route does not have.
    expect(DELIVERY_LIST_OPERATION.idempotent ?? false).toBe(false);
    expect(DELIVERY_LIST_OPERATION.versionGuarded ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P-2b — the branch list
// ---------------------------------------------------------------------------

describe(`P-2b ${LIST_OPERATION_ID}`, () => {
  it('publishes the branch deliveries newest first, with no money anywhere', async () => {
    // `SAL_READER` holds `sal.delivery.view` and NOT `sal.delivery.manage`, so it
    // could not have opened any of the rows it reads. That is the shift handover this
    // seam exists for, and it is what makes the 200 mean something.
    authAs(SAL_READER);
    const response = await listDeliveries({ ...SCOPE, limit: 100 });
    expect(response.status).toBe(200);
    const page = await bodyOf<DeliveryListBody>(response);

    const ids = page.items.map((row) => row.id);
    expect(ids).toContain(FIRST.deliveryId);
    expect(ids).toContain(SECOND.deliveryId);
    expect(ids).toContain(DELIVERED.deliveryId);

    // Newest first: `SECOND` was opened after `FIRST`, in a later transaction, so it
    // must precede it. An ascending order would put them the other way round and an
    // unordered query would be free to do either.
    expect(ids.indexOf(SECOND.deliveryId)).toBeLessThan(ids.indexOf(FIRST.deliveryId));

    const row = page.items.find((item) => item.id === FIRST.deliveryId);
    expect(row).toBeDefined();
    expect(row?.workOrderId).toBe(FIRST.chain.workOrderId);
    expect(row?.vehicleId).toBe(FIRST.chain.vehicleId);
    expect(row?.receptionVisitId).toBe(FIRST.chain.visitId);
    expect(row?.companyId).toBe(SCOPE.companyId);
    expect(row?.branchId).toBe(SCOPE.branchId);
    expect(row?.status).toBe('ready');
    // `ck_delivery_records_delivered_shape` makes these a biconditional with the
    // status, so a `ready` row carrying either would be a row the database refuses.
    expect(row?.deliveredAt).toBeNull();
    expect(row?.finalOdometerReadingId).toBeNull();
    expect(typeof row?.recordVersion).toBe('number');

    refusesAnyMoneyShapedNumber(page);
  });

  it('spells every field exactly as sal.delivery-read spells it', async () => {
    // One mapper or two is the whole question: a screen that renders a listed
    // delivery and one that renders a read delivery must handle ONE shape.
    authAs(SAL_READER);
    const listed = (
      await bodyOf<DeliveryListBody>(await listDeliveries({ ...SCOPE, limit: 100 }))
    ).items.find((item) => item.id === FIRST.deliveryId);
    const read = await bodyOf<DeliveryRecordBody>(await readDelivery(FIRST.deliveryId));
    expect(listed).toEqual(read);
    // And the projection stops there: the list carries no field the detail read does
    // not, in either direction.
    expect(Object.keys(listed ?? {}).sort()).toEqual(Object.keys(read).sort());
    expect(Object.keys(read)).not.toContain('replayed');
  });

  it('excludes a soft-deleted delivery', async () => {
    authAs(SAL_READER);
    const page = await bodyOf<DeliveryListBody>(await listDeliveries({ ...SCOPE, limit: 100 }));
    expect(page.items.map((row) => row.id)).not.toContain(WITHDRAWN.deliveryId);
    // Not vacuous: the row is still in the table, so the absence is the predicate and
    // not a fixture that failed to arrive.
    const present = await admin.query(
      `SELECT 1 FROM sal.delivery_records WHERE id = $1 AND deleted_at IS NOT NULL`,
      [WITHDRAWN.deliveryId]
    );
    expect(present.rowCount).toBe(1);
  });

  it('filters by status, and the filter actually filters', async () => {
    authAs(SAL_READER);
    const delivered = await bodyOf<DeliveryListBody>(
      await listDeliveries({ ...SCOPE, status: 'delivered', limit: 100 })
    );
    expect(delivered.items.map((row) => row.id)).toEqual([DELIVERED.deliveryId]);
    for (const row of delivered.items) expect(row.status).toBe('delivered');

    // The complement, so the assertion above cannot pass because the filter dropped
    // everything: the same branch has `ready` rows too, and they are a different set.
    const ready = await bodyOf<DeliveryListBody>(
      await listDeliveries({ ...SCOPE, status: 'ready', limit: 100 })
    );
    const readyIds = ready.items.map((row) => row.id);
    expect(readyIds).toContain(FIRST.deliveryId);
    expect(readyIds).toContain(SECOND.deliveryId);
    expect(readyIds).not.toContain(DELIVERED.deliveryId);

    // A status the vocabulary admits but this branch has no row in is an empty page,
    // not a 404 and not an error.
    const none = await listDeliveries({ ...SCOPE, status: 'exception' });
    expect(none.status).toBe(200);
    expect((await bodyOf<DeliveryListBody>(none)).items).toEqual([]);
  });

  it('filters by work order and by vehicle', async () => {
    authAs(SAL_READER);
    const byWorkOrder = await bodyOf<DeliveryListBody>(
      await listDeliveries({ ...SCOPE, workOrderId: FIRST.chain.workOrderId })
    );
    expect(byWorkOrder.items.map((row) => row.id)).toEqual([FIRST.deliveryId]);

    const byVehicle = await bodyOf<DeliveryListBody>(
      await listDeliveries({ ...SCOPE, vehicleId: DELIVERED.vehicleId })
    );
    expect(byVehicle.items.map((row) => row.id)).toEqual([DELIVERED.deliveryId]);
    // The complement again: every fixture has its own vehicle, so a filter that did
    // nothing would have returned the whole branch here.
    expect(DELIVERED.vehicleId).not.toBe(FIRST.chain.vehicleId);

    // A vehicle with no delivery is an empty page, not a 404.
    const none = await listDeliveries({ ...SCOPE, vehicleId: randomUUID() });
    expect(none.status).toBe(200);
    expect((await bodyOf<DeliveryListBody>(none)).items).toEqual([]);
  });

  it('requires the scope target, and refuses an unknown parameter and an unknown status', async () => {
    authAs(SAL_READER);
    const noScope = await listDeliveries({});
    expect(noScope.status).toBe(422);
    expect((await problemOf(noScope)).code).toBe('ERR-VAL-001');

    const branchOnly = await listDeliveries({ branchId: SCOPE.branchId });
    expect(branchOnly.status).toBe(422);

    // 422 and not a filter silently dropped: a caller who mistyped `vehicleId` and was
    // shown the whole branch would read the page as that vehicle's.
    const unknown = await listDeliveries({ ...SCOPE, somethingElse: 'x' });
    expect(unknown.status).toBe(422);
    expect((await problemOf(unknown)).code).toBe('ERR-VAL-001');

    // A status outside `ck_delivery_records_status` is refused at the boundary rather
    // than matching nothing and answering an empty page that reads as "none".
    const badStatus = await listDeliveries({ ...SCOPE, status: 'handed_over' });
    expect(badStatus.status).toBe(422);
    expect((await problemOf(badStatus)).code).toBe('ERR-VAL-001');
  });

  it('401 unauthenticated', async () => {
    __resetAuthenticatorForTests();
    expect((await listDeliveries(SCOPE)).status).toBe(401);
  });

  it('403 ERR-IAM-001 without sal.delivery.view', async () => {
    authAs(SAL_NO_DELIVERY_VIEW);
    const response = await listDeliveries(SCOPE);
    expect(response.status).toBe(403);
    const problem = await problemOf(response);
    expect(problem.code).toBe('ERR-IAM-001');
    // The refusal names the code that is missing, and this principal holds every
    // other delivery code — so it cannot be about tenancy or scope.
    expect(problem.requiredPermissions ?? []).toContain(DELIVERY_VIEW);
  });
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

describe('another tenant learns nothing about this branch', () => {
  it('is refused the list of a scope it does not hold, and told nothing about it', async () => {
    // `SAL_TENANT_B` holds the full sal/wty set INCLUDING `sal.delivery.view`, so
    // nothing about this refusal is a missing permission.
    authAs(SAL_TENANT_B);
    const response = await listDeliveries(SCOPE);
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');

    // Identical to the answer for a pair that does not exist at all. The scope is
    // refused before a row is read, so the response carries no existence.
    const invented = await listDeliveries({ companyId: randomUUID(), branchId: randomUUID() });
    expect(invented.status).toBe(403);
    expect((await problemOf(invented)).code).toBe('ERR-IAM-001');
  });

  it('and the rows it was refused really are there, so the refusal is not absence', async () => {
    const live = await admin.query(
      `SELECT id FROM sal.delivery_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND deleted_at IS NULL`,
      [TENANT_A, SCOPE.companyId, SCOPE.branchId]
    );
    expect(live.rows.map((row) => row.id)).toContain(FIRST.deliveryId);
  });
});

// ---------------------------------------------------------------------------
// Branch isolation
// ---------------------------------------------------------------------------

describe('branch isolation', () => {
  it('a caller reading one branch never sees another scope rows', async () => {
    authAs(SAL_FULL);
    const here = await bodyOf<DeliveryListBody>(await listDeliveries({ ...SCOPE, limit: 100 }));
    expect(here.items.map((row) => row.id)).not.toContain(ELSEWHERE.deliveryId);
    for (const row of here.items) {
      expect(row.companyId).toBe(SCOPE.companyId);
      expect(row.branchId).toBe(SCOPE.branchId);
    }

    // And the complement, so the absence above is the scope predicate rather than a
    // fixture that never landed: the same caller naming the OTHER pair reads exactly
    // that delivery and none of this branch's.
    const there = await bodyOf<DeliveryListBody>(
      await listDeliveries({ companyId: COMPANY_A9, branchId: BRANCH_A9, limit: 100 })
    );
    expect(there.items.map((row) => row.id)).toEqual([ELSEWHERE.deliveryId]);
  });

  it('403 when the caller names a pair its grant does not reach', async () => {
    // Scoped to another branch of the SAME company and holding every sal code, so the
    // refusal is the scope and nothing else.
    authAs(SAL_SCOPED_A2);
    const response = await listDeliveries(SCOPE);
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('403 from authorizeScope even when RLS can see the rows', async () => {
    // The decisive case. `SAL_PERMISSION_ELSEWHERE`'s widening grant puts this branch
    // inside the permission-blind allowed-branch union, so RLS would return the rows;
    // the `authorizeScope` call on the NAMED pair, which runs before the query, is the
    // only guard left. Deleting it turns this 403 into a 200 carrying the page.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await listDeliveries(SCOPE);
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

describe('the list pages', () => {
  it('walks the branch one row at a time, losing nothing and repeating nothing', async () => {
    authAs(SAL_READER);
    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response: Response = await listDeliveries({
        ...SCOPE,
        limit: 1,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(response.status).toBe(200);
      const page: DeliveryListBody = await bodyOf<DeliveryListBody>(response);
      expect(page.items).toHaveLength(1);
      const row = page.items[0];
      if (row !== undefined) walked.push(row.id);
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
      pages += 1;
      // A cursor that never advanced would otherwise spin for ever, which a fixed
      // two-page assertion cannot tell apart from success.
      expect(pages).toBeLessThan(50);
    } while (cursor !== null);

    expect(new Set(walked).size).toBe(walked.length);
    // The walk is exactly the branch's live rows as the database holds them — which
    // also re-proves the soft-delete exclusion across every page rather than the first.
    const actual = await admin.query<{ id: string }>(
      `SELECT id FROM sal.delivery_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND deleted_at IS NULL`,
      [TENANT_A, SCOPE.companyId, SCOPE.branchId]
    );
    expect([...walked].sort()).toEqual(actual.rows.map((row) => row.id).sort());
  });

  it('refuses a malformed cursor and an oversized page, differently', async () => {
    authAs(SAL_READER);
    const badCursor = await listDeliveries({ ...SCOPE, cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect((await problemOf(badCursor)).code).toBe('ERR-PAG-001');

    const oversized = await listDeliveries({ ...SCOPE, limit: 5000 });
    expect(oversized.status).toBe(422);
    expect((await problemOf(oversized)).code).toBe('ERR-VAL-001');

    // The two must stay distinguishable from an unknown parameter, which is neither.
    const unknown = await listDeliveries({ ...SCOPE, cursorr: 'x' });
    expect(unknown.status).toBe(422);
    expect((await problemOf(unknown)).code).toBe('ERR-VAL-001');
  });

  it('refuses a cursor minted for a different list', async () => {
    // The ordering contract's key is part of the cursor, so a cursor cannot be spent
    // on a list it was not minted for.
    authAs(SAL_READER);
    const crossed = await listDeliveries({
      ...SCOPE,
      cursor: Buffer.from(
        JSON.stringify({
          k: 'sal.delivery_status_history:occurred_at_desc',
          v: '2026-01-01T00:00:00.000000Z',
          i: randomUUID(),
        })
      ).toString('base64url'),
    });
    expect(crossed.status).toBe(400);
    expect((await problemOf(crossed)).code).toBe('ERR-PAG-001');
  });
});
