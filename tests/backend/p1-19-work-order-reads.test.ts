/**
 * Work-order queries: board, aggregate detail, status history (Phase 1-19,
 * P1-19-BE-006…008).
 *
 * The read surface is where the scope hole of P1-18-A-01 is easiest to reintroduce,
 * so the isolation cases here are the point of the suite rather than an appendix:
 *
 *  - **The board names its scope.** `GET /work-orders` REQUIRES `companyId` and
 *    `branchId` and passes them as the operation's `authorizationTarget`. A caller
 *    granted `wo.work_order.read` in one branch and holding any grant at all in
 *    another would otherwise be served the second branch's board, because
 *    `requiresScopedEvaluation` returns false on an empty target whatever the
 *    declared scope says, and `app.branch_ids` unions every active grant regardless
 *    of the permission it carries.
 *  - **The id-addressed reads defer the check.** Detail and history have no branch
 *    in the path, so the scope is re-decided against the row's own company and
 *    branch once it is read.
 *
 * Ordering and bounds are asserted rather than assumed: every list is keyset
 * paginated with a total `(sortValue, id)` order, the page size is clamped, and a
 * malformed or foreign cursor is `ERR-PAG-001` rather than a 500.
 *
 * Operations exercised here: wo.work-order-list, wo.work-order-detail,
 * wo.work-order-history.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.work-order-list: route service authorization success denial cross-tenant isolation
 *   wo.work-order-detail: route service authorization success denial cross-tenant isolation
 *   wo.work-order-history: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  SUBJECT_UNPERMITTED,
  TENANT_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  PERMISSION_ELSEWHERE,
  READER,
  SCOPED_ELSEWHERE,
  TENANT_B_FULL,
  advance,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  createWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST } from '@/app/api/v1/work-orders/route';
import { GET as DETAIL } from '@/app/api/v1/work-orders/[workOrderId]/route';
import { GET as HISTORY } from '@/app/api/v1/work-orders/[workOrderId]/history/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';

let admin: Pool;
let runtime: Pool;

function list(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/v1/work-orders');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return LIST(new Request(url));
}

/** The board of the default tenant-A branch. */
function board(extra: Record<string, string> = {}): Promise<Response> {
  return list({ companyId: COMPANY_A1, branchId: BRANCH_A1, ...extra });
}

function detail(workOrderId: string): Promise<Response> {
  return DETAIL(new Request(`http://localhost/api/v1/work-orders/${workOrderId}`), {
    params: Promise.resolve({ workOrderId }),
  });
}

function history(workOrderId: string, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/work-orders/${workOrderId}/history`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return HISTORY(new Request(url), { params: Promise.resolve({ workOrderId }) });
}

interface Summary {
  readonly id: string;
  readonly branchId: string;
  readonly state: string;
  readonly kind: string;
  readonly openedAt: string;
  readonly recordVersion: number;
}
interface PageBody {
  readonly items: readonly Summary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

async function page(response: Response): Promise<PageBody> {
  return (await response.json()) as PageBody;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('wo.work-order-list', () => {
  it('401 without an authenticator and 403 without wo.work_order.read', async () => {
    __resetAuthenticatorForTests();
    expect((await board()).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    const unpermitted = await board();
    expect(unpermitted.status).toBe(403);
    expect(((await unpermitted.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('lists one branch newest-opened-first, paginates by keyset, and clamps the page size', async () => {
    const first = await createWorkOrder();
    const second = await createWorkOrder();
    const third = await createWorkOrder();

    authAs(READER);
    const all = await page(await board());
    const ids = all.items.map((item) => item.id);
    expect(ids).toContain(first.workOrderId);
    expect(ids).toContain(second.workOrderId);
    expect(ids).toContain(third.workOrderId);
    for (const item of all.items) expect(item.branchId).toBe(BRANCH_A1);

    // Ordering is server-fixed and total: newest `opened_at` first, id breaking a
    // tie. Fixture orders can share a timestamp to the microsecond, so the pair
    // comparison is on `(openedAt, id)` rather than on the timestamp alone.
    const keys = all.items.map((item) => `${item.openedAt}|${item.id}`);
    expect([...keys].sort().reverse()).toEqual(keys);

    // One row per page walks the cursor across a boundary; the union must be the
    // same set with no row repeated or skipped.
    authAs(READER);
    const firstPage = await page(await board({ limit: '1' }));
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).not.toBeNull();

    const walked: string[] = [];
    let cursor: string | null = firstPage.nextCursor;
    walked.push(firstPage.items[0]?.id ?? '');
    while (cursor !== null) {
      authAs(READER);
      const next: PageBody = await page(await board({ limit: '1', cursor }));
      if (next.items[0]) walked.push(next.items[0].id);
      cursor = next.nextCursor;
    }
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toEqual(ids);

    // The page size is bounded at the boundary: `schemas.limit` caps at the
    // platform maximum, so an oversized request is refused rather than served. The
    // clamp in `resolveLimit` is the second line of defence for a caller that
    // reaches the service without passing through this schema.
    authAs(READER);
    expect((await board({ limit: '5000' })).status).toBe(422);
    authAs(READER);
    expect((await board({ limit: '0' })).status).toBe(422);
    authAs(READER);
    expect((await board({ limit: '100' })).status).toBe(200);
  });

  it('filters by state, by kind and by opened-at range, and treats an unknown state as an empty page', async () => {
    const draft = await createWorkOrder();
    const opened = await createOpenWorkOrder();

    authAs(READER);
    const drafts = await page(await board({ state: 'draft' }));
    expect(drafts.items.map((item) => item.id)).toContain(draft.workOrderId);
    expect(drafts.items.map((item) => item.id)).not.toContain(opened.workOrderId);
    for (const item of drafts.items) expect(item.state).toBe('draft');

    authAs(READER);
    const ordinary = await page(await board({ kind: 'ordinary' }));
    expect(ordinary.items.length).toBeGreaterThan(0);
    for (const item of ordinary.items) expect(item.kind).toBe('ordinary');

    // `wo.work_order_states` is tenant-extensible, so an unknown code is an empty
    // page rather than a 422 about a state the tenant may legitimately define.
    authAs(READER);
    const unknownState = await board({ state: 'not_a_configured_state' });
    expect(unknownState.status).toBe(200);
    expect((await page(unknownState)).items).toEqual([]);

    // A range that ends before every fixture opened returns nothing; one that
    // starts before them returns them.
    authAs(READER);
    const beforeAnything = await page(await board({ openedTo: '2020-01-01T00:00:00.000Z' }));
    expect(beforeAnything.items).toEqual([]);
    authAs(READER);
    const sinceEpoch = await page(await board({ openedFrom: '2020-01-01T00:00:00.000Z' }));
    expect(sinceEpoch.items.length).toBeGreaterThan(0);
  });

  it('isolation: a caller granted only in BRANCH_A2 is refused A1 and served A2', async () => {
    const inA1 = await createWorkOrder();
    const inA2 = await createWorkOrder({ branchId: BRANCH_A2 });

    authAs(SCOPED_ELSEWHERE);
    const refused = await board();
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');

    authAs(SCOPED_ELSEWHERE);
    const allowed = await list({ companyId: COMPANY_A1, branchId: BRANCH_A2 });
    expect(allowed.status).toBe(200);
    const items = (await page(allowed)).items.map((item) => item.id);
    expect(items).toContain(inA2.workOrderId);
    expect(items).not.toContain(inA1.workOrderId);
  });

  it('cross-tenant: a tenant-B caller learns nothing about a tenant-A branch, and its own board holds only its own rows', async () => {
    const inA = await createWorkOrder();
    const inB = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });

    // Tenant B's grant is UNRESTRICTED, and an unrestricted grant is tenant-bounded
    // by construction — `iam.has_permission_in_scope` short-circuits on
    // `scope_mode = 'unrestricted'` without consulting the target at all. So
    // authorization cannot and should not refuse this request; what contains it is
    // the tenant predicate, and the honest answer is an EMPTY page rather than a
    // 403 or 404 that would confirm the foreign branch exists.
    authAs(TENANT_B_FULL);
    const foreign = await board();
    expect(foreign.status).toBe(200);
    expect((await page(foreign)).items).toEqual([]);

    authAs(TENANT_B_FULL);
    const own = await list({ companyId: COMPANY_B1, branchId: BRANCH_B1 });
    expect(own.status).toBe(200);
    const ids = (await page(own)).items.map((item) => item.id);
    expect(ids).toContain(inB.workOrderId);
    expect(ids).not.toContain(inA.workOrderId);
  });

  it('refuses a missing scope, an unknown parameter, a bad cursor and a timezone-less date', async () => {
    authAs(READER);
    expect((await list({ companyId: COMPANY_A1 })).status).toBe(422);
    authAs(READER);
    expect((await board({ unexpected: 'x' })).status).toBe(422);
    authAs(READER);
    const badCursor = await board({ cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect(((await badCursor.json()) as { code: string }).code).toBe('ERR-PAG-001');
    authAs(READER);
    // A local wall-clock string names no instant. The P1-17 odometer finding is
    // the precedent: a timezone-less timestamp is refused at the boundary.
    expect((await board({ openedFrom: '2026-07-26T00:00:00' })).status).toBe(422);
  });

  it('refuses a cursor issued for a different ordering contract', async () => {
    await createWorkOrder();
    await createWorkOrder();
    authAs(READER);
    const first = await page(await board({ limit: '1' }));
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor ?? '';

    // The board's cursor names the board's contract; the history endpoint's own
    // contract key differs, so re-using one there is refused rather than silently
    // producing a wrong page.
    const created = await createWorkOrder();
    await advance(created.workOrderId, [{ toState: 'open' }]);
    authAs(READER);
    const wrongContract = await history(created.workOrderId, { cursor });
    expect(wrongContract.status).toBe(400);
    expect(((await wrongContract.json()) as { code: string }).code).toBe('ERR-PAG-001');
  });
});

describe('wo.work-order-detail', () => {
  it('returns the work order, its jobs and the edges the live catalog allows', async () => {
    const created = await createOpenWorkOrder();
    authAs(FULL);
    const jobResponse = await CREATE_JOB(
      new Request(`http://localhost/api/v1/work-orders/${created.workOrderId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ title: 'Inspect suspension', requiresDiagnostic: true }),
      }),
      { params: Promise.resolve({ workOrderId: created.workOrderId }) }
    );
    expect(jobResponse.status).toBe(201);
    const jobId = ((await jobResponse.json()) as { id: string }).id;

    authAs(READER);
    const response = await detail(created.workOrderId);
    expect(response.status).toBe(200);
    // The ETag is the version a transition must send back as If-Match.
    expect(response.headers.get('etag')).toBe(`"${created.recordVersion}"`);
    const body = (await response.json()) as {
      workOrder: Summary & { receptionVisitId: string; vehicleId: string };
      jobs: readonly { id: string; state: string; requiresDiagnostic: boolean }[];
      nextStates: readonly {
        code: string;
        requiresReason: boolean;
        isTerminal: boolean;
        isCancellation: boolean;
      }[];
    };
    expect(body.workOrder.id).toBe(created.workOrderId);
    expect(body.workOrder.state).toBe('open');
    expect(body.workOrder.receptionVisitId).toBe(created.visitId);
    expect(body.workOrder.vehicleId).toBe(created.vehicleId);
    expect(body.jobs.map((job) => job.id)).toEqual([jobId]);
    expect(body.jobs[0]?.state).toBe('planned');
    expect(body.jobs[0]?.requiresDiagnostic).toBe(true);

    // The graph, read rather than mirrored: `open` has exactly two outbound edges
    // in the platform seed, and the cancellation one requires a reason.
    const codes = body.nextStates.map((next) => next.code).sort();
    expect(codes).toEqual(['cancelled', 'in_progress']);
    const cancel = body.nextStates.find((next) => next.code === 'cancelled');
    expect(cancel?.requiresReason).toBe(true);
    expect(cancel?.isTerminal).toBe(true);
    expect(cancel?.isCancellation).toBe(true);
    expect(body.nextStates.find((next) => next.code === 'in_progress')?.requiresReason).toBe(false);
  });

  it('a terminal work order advertises NO next states, because the guard freezes it', async () => {
    const created = await createWorkOrder();
    await advance(created.workOrderId, [
      { toState: 'cancelled', reason: 'customer collected the vehicle' },
    ]);

    authAs(READER);
    const body = (await (await detail(created.workOrderId)).json()) as {
      workOrder: { state: string };
      nextStates: readonly unknown[];
    };
    expect(body.workOrder.state).toBe('cancelled');
    // BR-WO-002 is a terminal freeze regardless of the graph. Advertising an edge
    // out of a terminal state would describe a move the database always refuses.
    expect(body.nextStates).toEqual([]);
  });

  it('401, 403, a malformed id, an unknown id, another tenant and another branch', async () => {
    const created = await createWorkOrder();

    __resetAuthenticatorForTests();
    expect((await detail(created.workOrderId)).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await detail(created.workOrderId)).status).toBe(403);

    authAs(READER);
    expect((await detail('not-a-uuid')).status).toBe(422);
    authAs(READER);
    expect((await detail(crypto.randomUUID())).status).toBe(404);

    // An id belonging to another tenant answers the SAME 404 as an unknown one, so
    // the route is not an existence oracle.
    authAs(TENANT_B_FULL);
    expect((await detail(created.workOrderId)).status).toBe(404);

    // Two different mechanisms, two different answers, both correct: a caller whose
    // grants make the row VISIBLE but hold no work-order permission in its branch is
    // refused 403 by the deferred scoped check, while a caller holding no grant in
    // that branch at all never sees the row and gets the uniform 404.
    authAs(PERMISSION_ELSEWHERE);
    expect((await detail(created.workOrderId)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await detail(created.workOrderId)).status).toBe(404);
  });
});

describe('wo.work-order-history', () => {
  it('returns the append-only ledger newest-first with the genesis block the ledger cannot hold', async () => {
    const created = await createWorkOrder();
    await advance(created.workOrderId, [
      { toState: 'open' },
      { toState: 'in_progress' },
      { toState: 'awaiting_parts', reason: 'awaiting a hub assembly' },
    ]);

    authAs(READER);
    const response = await history(created.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workOrderId: string;
      origin: { openedAt: string; openedBy: string | null; initialState: string };
      transitions: {
        items: readonly {
          fromState: string | null;
          toState: string;
          reason: string | null;
          occurredAt: string;
          actorId: string | null;
        }[];
        hasMore: boolean;
      };
    };
    expect(body.workOrderId).toBe(created.workOrderId);
    expect(body.transitions.items.map((entry) => entry.toState)).toEqual([
      'awaiting_parts',
      'in_progress',
      'open',
    ]);
    expect(body.transitions.items[0]?.fromState).toBe('in_progress');
    expect(body.transitions.items[0]?.reason).toBe('awaiting a hub assembly');
    // Reasons are recorded only where one was given; the emitter reads the same
    // GUC the guard does, so a NULL here would mean the reason never reached it.
    expect(body.transitions.items[2]?.reason).toBeNull();
    expect(body.transitions.items[0]?.actorId).toBe(FULL.userId);

    // The origin block: `wo.emit_work_order_status_history` is AFTER UPDATE only,
    // so the opening emits no ledger row. `initialState` is the OLDEST entry's own
    // `fromState` — derived, never a fabricated genesis row that
    // `shared.stamp_status_history` would stamp with now().
    expect(body.origin.initialState).toBe('draft');
    expect(body.origin.openedBy).toBe(FULL.userId);
    expect(Date.parse(body.origin.openedAt)).toBeLessThanOrEqual(
      Date.parse(body.transitions.items[2]?.occurredAt ?? '')
    );
  });

  it('reports the current state as the initial state while the ledger is empty', async () => {
    const created = await createWorkOrder();

    authAs(READER);
    const body = (await (await history(created.workOrderId)).json()) as {
      origin: { initialState: string };
      transitions: { items: readonly unknown[]; hasMore: boolean; nextCursor: string | null };
    };
    expect(body.transitions.items).toEqual([]);
    expect(body.transitions.hasMore).toBe(false);
    expect(body.transitions.nextCursor).toBeNull();
    // Nothing has moved it, so the state it is in IS the state it opened in.
    expect(body.origin.initialState).toBe('draft');
  });

  it('paginates the ledger and never repeats or skips an entry', async () => {
    const created = await createWorkOrder();
    await advance(created.workOrderId, [
      { toState: 'open' },
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
    ]);

    authAs(READER);
    const full = (await (await history(created.workOrderId)).json()) as {
      transitions: { items: readonly { id: string }[] };
    };
    const expected = full.transitions.items.map((entry) => entry.id);
    expect(expected).toHaveLength(3);

    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      authAs(READER);
      const response = await history(
        created.workOrderId,
        cursor === null ? { limit: '1' } : { limit: '1', cursor }
      );
      const body = (await response.json()) as {
        transitions: { items: readonly { id: string }[]; nextCursor: string | null };
      };
      for (const entry of body.transitions.items) walked.push(entry.id);
      cursor = body.transitions.nextCursor;
    } while (cursor !== null);
    expect(walked).toEqual(expected);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('401, 403, a malformed id, another tenant and another branch', async () => {
    const created = await createWorkOrder();

    __resetAuthenticatorForTests();
    expect((await history(created.workOrderId)).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await history(created.workOrderId)).status).toBe(403);

    authAs(READER);
    expect((await history('not-a-uuid')).status).toBe(422);

    authAs(TENANT_B_FULL);
    expect((await history(created.workOrderId)).status).toBe(404);

    authAs(PERMISSION_ELSEWHERE);
    expect((await history(created.workOrderId)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await history(created.workOrderId)).status).toBe(404);
  });
});
