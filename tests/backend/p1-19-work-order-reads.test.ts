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
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_A2,
  COMPANY_B1,
  TECH_A1,
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
  establishTechnicianFixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __resetRateLimitForTests } from '@/server/http/rate-limit';
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
  // The technician profiles the board's assignment case names. `wo.job_assignments`
  // carries `fk_job_assignments_technician`, so a profile has to exist before an
  // assignment can; this suite read work orders only until the board grew a
  // technician column.
  await establishTechnicianFixtures();
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => {
  __resetAuthenticatorForTests();
  // `wo.work-order-list` carries the `expensive-read` policy, and the board
  // cases added by the Owner directive (P1-32-PRE-OD-UX) each make several list
  // calls. Without this the LAST case in the file starts answering 429 and the
  // failure reads as a broken filter rather than as an exhausted budget.
  __resetRateLimitForTests();
});
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

    // Tenant B's grant is UNRESTRICTED, so `iam.has_permission_in_scope`
    // short-circuits on `scope_mode = 'unrestricted'` and answers true for ANY
    // pair — the permission check is not, and cannot be, the tenant boundary.
    // Since CC-14 the pre-handler resolves the named pair to a branch visible to
    // the caller inside its own tenant BEFORE the board is read, so this is now
    // a refusal rather than the empty page RLS used to produce. It is a 403 and
    // not a 404: a not-found would confirm the branch exists somewhere.
    authAs(TENANT_B_FULL);
    const foreign = await board();
    expect(foreign.status).toBe(403);
    const foreignBody = (await foreign.json()) as Record<string, unknown>;
    expect(foreignBody.code).toBe('ERR-IAM-001');

    // And a pair that exists NOWHERE is refused identically. The two problem
    // documents are compared whole, with only the correlation id nulled, because
    // a difference in any other field — status, code, title, detail, the
    // required permissions — would be the enumeration oracle this refusal exists
    // to remove.
    authAs(TENANT_B_FULL);
    const nowhere = await list({
      companyId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
    });
    expect(nowhere.status).toBe(403);
    const nowhereBody = (await nowhere.json()) as Record<string, unknown>;
    expect({ ...nowhereBody, correlationId: null }).toEqual({
      ...foreignBody,
      correlationId: null,
    });

    authAs(TENANT_B_FULL);
    const own = await list({ companyId: COMPANY_B1, branchId: BRANCH_B1 });
    expect(own.status).toBe(200);
    const ids = (await page(own)).items.map((item) => item.id);
    expect(ids).toContain(inB.workOrderId);
    expect(ids).not.toContain(inA.workOrderId);
  });

  it('refuses a missing scope, an unknown parameter, a bad cursor and a timezone-less date', async () => {
    // The COMPANY is what may never be omitted. `branchId` became optional with
    // the Owner directive (P1-32-PRE-OD-UX) — a company on its own now asks for
    // every branch of it the caller may read — so this assertion moved from the
    // pair to the company alone rather than being dropped. A request naming
    // neither still has no scope to be judged against and is refused.
    authAs(READER);
    expect((await list({ branchId: BRANCH_A1 })).status).toBe(422);
    authAs(READER);
    expect((await list({})).status).toBe(422);
    // And the company alone is now a legitimate request, which is what makes the
    // two refusals above about the missing company and not about the pair.
    authAs(READER);
    expect((await list({ companyId: COMPANY_A1, limit: '1' })).status).toBe(200);
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

// ===========================================================================
// The branch-optional board (Owner directive, P1-32-PRE-OD-UX)
//
// `branchId` is now optional beside a company. The falsifiable principal is
// PERMISSION_ELSEWHERE: it holds `wo.work_order.read` scoped to BRANCH_A2 and a
// WIDENING grant in BRANCH_A1 carrying `org.tenant.read` and no work-order
// authority at all. `app.branch_ids` is the permission-blind union of both, so a
// page built from row-level security alone would hand back BRANCH_A1's board —
// the P1-18-A-01 shape. The union must instead be built from a per-branch
// permission decision, and these cases are what tells the two apart.
// ===========================================================================
describe('wo.work-order-list — the branch-optional board', () => {
  it('omitting branchId returns the caller authorized branches and nothing from a third', async () => {
    const inA1 = await createWorkOrder();
    const inA2 = await createWorkOrder({ branchId: BRANCH_A2 });

    // An unrestricted reader is answered for the whole company, so the
    // narrowing below cannot be an artefact of an empty second branch.
    authAs(READER);
    const everything = await list({ companyId: COMPANY_A1, limit: '100' });
    expect(everything.status).toBe(200);
    const everyId = (await page(everything)).items.map((item) => item.id);
    expect(everyId).toEqual(expect.arrayContaining([inA1.workOrderId, inA2.workOrderId]));

    // The narrowed caller is answered for BRANCH_A2 alone.
    authAs(PERMISSION_ELSEWHERE);
    const narrowed = await list({ companyId: COMPANY_A1, limit: '100' });
    expect(narrowed.status).toBe(200);
    const ids = (await page(narrowed)).items.map((item) => item.id);
    expect(ids).toContain(inA2.workOrderId);
    // The assertion that fails if the branch union is taken from the policy
    // rather than from a decision about this operation's own code.
    expect(ids).not.toContain(inA1.workOrderId);
  });

  it('a branchId the caller holds no read in is still refused', async () => {
    authAs(PERMISSION_ELSEWHERE);
    const tampered = await list({ companyId: COMPANY_A1, branchId: BRANCH_A1 });
    expect(tampered.status).toBe(403);
    expect(((await tampered.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('a company none of the caller branches belong to is refused, not answered empty', async () => {
    authAs(PERMISSION_ELSEWHERE);
    const other = await list({ companyId: COMPANY_A2, limit: '100' });
    // A refusal, not an empty page: an empty page would tell this caller that
    // the second company has no work orders, which is not its to learn.
    expect(other.status).toBe(403);
    expect(((await other.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });
});

// ===========================================================================
// The enriched board row and its flags (Owner directive, P1-32-PRE-OD-UX)
//
// Every field and every filter here is backed by a column or a row the schema
// really keeps. Three that were asked for are ABSENT, and the first case asserts
// their absence rather than leaving it to a reader: `dueAt` (no promised or due
// timestamp exists on `wo.work_orders` or anywhere beneath it), `approvalState`
// (approval is recorded per additional-work request, not per work order) and
// `deliveryReadiness` (nothing records it — it is derived from the state
// catalogue). A key-set assertion is what catches one being added back later
// without the schema to support it.
// ===========================================================================
describe('wo.work-order-list — the enriched board', () => {
  /** One board row by id, as the current caller. */
  async function boardRow(workOrderId: string): Promise<Record<string, unknown>> {
    const response = await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: '100' });
    expect(response.status).toBe(200);
    const row = (await page(response)).items.find((item) => item.id === workOrderId);
    expect(row, workOrderId).toBeDefined();
    return row as unknown as Record<string, unknown>;
  }

  it('publishes the three recorded board fields and none of the three the schema cannot support', async () => {
    const created = await createWorkOrder();

    authAs(READER);
    const row = await boardRow(created.workOrderId);
    const keys = Object.keys(row);

    // Present, because the schema records them.
    expect(keys).toEqual(
      expect.arrayContaining(['assignedTechnician', 'completedAt', 'qualityState'])
    );
    // Absent, because it does not. Asserted, not assumed.
    expect(keys).not.toContain('dueAt');
    expect(keys).not.toContain('approvalState');
    expect(keys).not.toContain('deliveryReadiness');

    // A freshly converted work order: nobody assigned, nothing finished, no QC.
    expect(row.assignedTechnician).toBeNull();
    expect(row.completedAt).toBeNull();
    expect(row.qualityState).toBeNull();
  });

  it('names the technician holding the LIVE assignment and forgets them once it is closed', async () => {
    const seeded = await createOpenWorkOrder();
    const jobId = await admin
      .query<{ id: string }>(
        `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
         VALUES ($1,$2,$3,$4,'Board fixture job',$5) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, seeded.workOrderId, USER_A]
      )
      .then((result) => result.rows[0]?.id ?? '');
    const assignmentId = await admin
      .query<{ id: string }>(
        `INSERT INTO wo.job_assignments
           (tenant_id, company_id, branch_id, job_id, technician_profile_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, jobId, TECH_A1, USER_A]
      )
      .then((result) => result.rows[0]?.id ?? '');

    // WITHOUT `iam.user.read`: the assignment is still reported, with the id and
    // no name. The assignment is a work-order fact; the person's NAME is the iam
    // module's to withhold, and withholding it must not refuse the whole row.
    authAs(READER);
    const withheld = (await boardRow(seeded.workOrderId)).assignedTechnician as {
      id: string;
      displayName: string | null;
    } | null;
    expect(withheld?.id).toBe(TECH_A1);
    expect(withheld?.displayName).toBeNull();

    // WITH `iam.user.read`: the same row now carries the name, resolved through
    // the iam directory in one statement for the whole page. Both halves are
    // asserted because a field that is always null would pass the first on its
    // own while the resolution was completely broken.
    const NAME_ROLE = 'c1900000-0000-4000-8000-0000000003a1';
    const NAME_GRANT = 'c1900000-0000-4000-8000-0000000003a2';
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
       VALUES ($1,$2,'fx_p1_19_board_names','Board name reader',$3)
       ON CONFLICT (id) DO NOTHING`,
      [NAME_ROLE, TENANT_A, USER_A]
    );
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = 'iam.user.read'
       ON CONFLICT DO NOTHING`,
      [TENANT_A, NAME_ROLE, USER_A]
    );
    await admin.query(
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'unrestricted','active',$5,$5)
       ON CONFLICT (id) DO NOTHING`,
      [NAME_GRANT, TENANT_A, READER.userId, NAME_ROLE, USER_A]
    );
    try {
      authAs(READER);
      const named = (await boardRow(seeded.workOrderId)).assignedTechnician as {
        id: string;
        displayName: string | null;
      } | null;
      expect(named?.id).toBe(TECH_A1);
      expect(named?.displayName).toBe('Fixture Technician');
    } finally {
      // Removed again so the rest of this file sees the principal it was written
      // against: a grant left behind would silently widen every later case.
      await admin.query('DELETE FROM iam.role_grants WHERE id = $1', [NAME_GRANT]);
      await admin.query('DELETE FROM iam.role_permissions WHERE role_id = $1', [NAME_ROLE]);
      await admin.query('DELETE FROM iam.roles WHERE id = $1', [NAME_ROLE]);
    }

    // `wo.job_assignments` is append-then-close: ending an assignment stamps
    // `valid_to` and the ROW SURVIVES, so "currently assigned" has to follow the
    // stamp rather than the row's existence.
    await admin.query(
      `UPDATE wo.job_assignments SET valid_to = now(), reason = 'board fixture' WHERE id = $1`,
      [assignmentId]
    );
    authAs(READER);
    expect((await boardRow(seeded.workOrderId)).assignedTechnician).toBeNull();
  });

  it('assignedToMe answers an EMPTY page for a caller who is not a technician', async () => {
    await createWorkOrder();

    authAs(READER);
    // READER holds `wo.work_order.read` and has no technician profile. The answer
    // is an empty page and never the whole board: "my work" must not widen to
    // "everyone's" because the caller has no technician record.
    const none = await list({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      assignedToMe: 'true',
      limit: '100',
    });
    expect(none.status).toBe(200);
    expect((await page(none)).items).toEqual([]);

    // The same caller without the flag still sees a board, so the empty page
    // above is the filter working and not the read being broken.
    authAs(READER);
    const unfiltered = await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: '100' });
    expect((await page(unfiltered)).items.length).toBeGreaterThan(0);
  });

  it('awaitingParts follows parts_forward_state and nothing else', async () => {
    const waiting = await createWorkOrder();
    const settled = await createWorkOrder();
    await admin.query(`UPDATE wo.work_orders SET parts_forward_state = 'requested' WHERE id = $1`, [
      waiting.workOrderId,
    ]);

    authAs(READER);
    const response = await list({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      awaitingParts: 'true',
      limit: '100',
    });
    expect(response.status).toBe(200);
    const ids = (await page(response)).items.map((item) => item.id);
    expect(ids).toContain(waiting.workOrderId);
    expect(ids).not.toContain(settled.workOrderId);
  });

  it('awaitingQuality follows a pending quality-control record', async () => {
    const checking = await createWorkOrder();
    const untouched = await createWorkOrder();
    await admin.query(
      `INSERT INTO qms.quality_control_records
         (tenant_id, company_id, branch_id, work_order_id, overall_result, created_by)
       VALUES ($1,$2,$3,$4,'pending',$5)`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, checking.workOrderId, USER_A]
    );

    authAs(READER);
    const response = await list({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      awaitingQuality: 'true',
      limit: '100',
    });
    expect(response.status).toBe(200);
    const ids = (await page(response)).items.map((item) => item.id);
    expect(ids).toContain(checking.workOrderId);
    expect(ids).not.toContain(untouched.workOrderId);

    // The recorded result also reaches the row, rather than only the filter.
    authAs(READER);
    expect((await boardRow(checking.workOrderId)).qualityState).toBe('pending');
  });

  it('a flag sent as false does not behave as true', async () => {
    const waiting = await createWorkOrder();
    const settled = await createWorkOrder();
    await admin.query(`UPDATE wo.work_orders SET parts_forward_state = 'requested' WHERE id = $1`, [
      waiting.workOrderId,
    ]);

    authAs(READER);
    // The literal-boolean schema exists for exactly this: `z.coerce.boolean()`
    // makes every non-empty string true, so `awaitingParts=false` would silently
    // turn the filter ON and hide the settled row.
    const off = await list({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      awaitingParts: 'false',
      limit: '100',
    });
    expect(off.status).toBe(200);
    const ids = (await page(off)).items.map((item) => item.id);
    expect(ids).toContain(waiting.workOrderId);
    expect(ids).toContain(settled.workOrderId);
  });

  it('an unknown flag value and an unknown flag are both refused', async () => {
    authAs(READER);
    expect(
      (await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, awaitingParts: 'yes' })).status
    ).toBe(422);
    expect(
      (await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, awaitingDelivery: 'true' })).status
    ).toBe(422);
  });
});
