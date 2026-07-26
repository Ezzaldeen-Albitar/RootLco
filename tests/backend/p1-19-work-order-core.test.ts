/**
 * Work-order transitions, closure, and closure eligibility (Phase 1-19,
 * P1-19-BE-003…005).
 *
 * Drives the real routes through the fixed pipeline on the least-privilege
 * `app_runtime` role. Every claim is checked against rows read back as admin,
 * never against the response alone — a command that reports success without
 * performing it is the failure mode this suite exists to detect.
 *
 * Three things here are deliberate and worth stating, because each of them is a
 * defect this suite would otherwise have shipped:
 *
 *  1. **The reason travels through a GUC, not a column.** `wo.work_orders` has no
 *     reason column; `wo.guard_work_order_transition` raises `check_violation`
 *     when the edge or the target state requires a reason and
 *     `app.status_reason` is unset, and `wo.emit_work_order_status_history`
 *     copies the same GUC into the ledger. A service that validated the reason in
 *     TypeScript and never published it would fail every reason-required edge as a
 *     raw 23514 and write `reason = NULL` on every ledger row.
 *  2. **Closure is a second permission, and the split must not be bypassable.**
 *     The transition endpoint refuses a terminal non-cancellation target, so a
 *     caller without `wo.work_order.close` cannot reach closure by choosing the
 *     other URL.
 *  3. **The eligibility endpoint reports EVERY unmet blocker.** The guard raises
 *     on the first and aborts, so a caller driven by the guard alone learns one
 *     fact per rejected attempt.
 *
 * Operations exercised here: wo.work-order-transition, wo.work-order-closure,
 * wo.work-order-closure-eligibility.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.work-order-transition: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency concurrency rollback
 *   wo.work-order-closure: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency concurrency
 *   wo.work-order-closure-eligibility: route service authorization success denial cross-tenant isolation
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
  COMPANY_B1,
  FULL,
  NO_CLOSE,
  PERMISSION_ELSEWHERE,
  READER,
  SCOPED_ELSEWHERE,
  TENANT_B_FULL,
  advance,
  auditCount,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  createWorkOrder,
  establishP1_19Fixtures,
  historyCount,
  outboxCount,
  readWorkOrder,
  transitionRequest,
  waitForBlockedBackends,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as ELIGIBILITY } from '@/app/api/v1/work-orders/[workOrderId]/closure-eligibility/route';
import { POST as CLOSURE } from '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';

const STATE_CHANGED_ACTION = 'wo.work_order.state_changed';
const CLOSED_ACTION = 'wo.work_order.closed';
const STATE_CHANGED_EVENT = 'work-order.state-changed';
const CLOSED_EVENT = 'work-order.closed';

/** The path a work order walks from `draft` to the closable `ready_to_close`. */
const TO_READY = [
  { toState: 'open' },
  { toState: 'in_progress' },
  { toState: 'qc_pending' },
  { toState: 'ready_to_close' },
] as const;

let admin: Pool;
let runtime: Pool;

function eligibility(workOrderId: string): Promise<Response> {
  return ELIGIBILITY(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/closure-eligibility`),
    { params: Promise.resolve({ workOrderId }) }
  );
}

function closure(
  workOrderId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? crypto.randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return CLOSURE(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/closure`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
}

/** Adds a job through the real route. Jobs are what make B1 (and B4) bite. */
async function addJob(
  workOrderId: string,
  body: { readonly title: string; readonly requiresDiagnostic?: boolean }
): Promise<string> {
  authAs(FULL);
  const response = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (response.status !== 201) {
    throw new Error(`fixture job creation failed with ${response.status}`);
  }
  return ((await response.json()) as { id: string }).id;
}

interface Problem {
  readonly code?: string;
  readonly status?: number;
  readonly title?: string;
  readonly detail?: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

async function problem(response: Response): Promise<Problem> {
  return (await response.json()) as Problem;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(8);
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

describe('wo.work-order-transition — authorization and scope', () => {
  it('401 without an authenticator, 403 without the permission, and writes nothing', async () => {
    const created = await createWorkOrder();

    __resetAuthenticatorForTests();
    const anonymous = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: created.recordVersion }
    );
    expect(anonymous.status).toBe(401);

    // Authenticated, in tenant, and holding a role with no permission mapping at
    // all: the only thing that can refuse this is the declared permission.
    authAsSubject(SUBJECT_UNPERMITTED);
    const unpermitted = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: created.recordVersion }
    );
    expect(unpermitted.status).toBe(403);
    expect((await problem(unpermitted)).code).toBe('ERR-IAM-001');

    // A read-only principal holds wo.work_order.read and nothing else.
    authAs(READER);
    const reader = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: created.recordVersion }
    );
    expect(reader.status).toBe(403);

    expect(await readWorkOrder(created.workOrderId)).toEqual({ state: 'draft', version: 1 });
    expect(await historyCount(created.workOrderId)).toBe(0);
    expect(await auditCount(STATE_CHANGED_ACTION, created.workOrderId)).toBe(0);
  });

  it('isolation: the scoped permission check refuses a branch RLS makes visible', async () => {
    const inA1 = await createWorkOrder();
    const inA2 = await createWorkOrder({ branchId: BRANCH_A2 });

    // THE P1-18-A-01 CASE. This principal holds wo.work_order.transition scoped to
    // BRANCH_A2 and an unrelated permission scoped to BRANCH_A1, so
    // `iam.allowed_branch_ids()` — the permission-blind union of its grants —
    // contains A1 and RLS shows it the row. Only the scoped permission evaluation
    // against the row's OWN branch can refuse the write, and that is what the 403
    // proves: `iam.has_permission_in_scope` matches a branch scope row on
    // `branch_id` alone, and the granting grant names A2.
    authAs(PERMISSION_ELSEWHERE);
    const refused = await transitionRequest(
      inA1.workOrderId,
      { toState: 'open' },
      { version: inA1.recordVersion }
    );
    expect(refused.status).toBe(403);
    expect((await problem(refused)).code).toBe('ERR-IAM-001');
    expect(await readWorkOrder(inA1.workOrderId)).toEqual({ state: 'draft', version: 1 });

    // Same principal, same permission, a work order inside its granted branch.
    // Without this half, the 403 above would prove only that the principal is
    // broken, not that the scope check discriminates.
    authAs(PERMISSION_ELSEWHERE);
    const allowed = await transitionRequest(
      inA2.workOrderId,
      { toState: 'open' },
      { version: inA2.recordVersion }
    );
    expect(allowed.status).toBe(200);
    expect((await readWorkOrder(inA2.workOrderId))?.state).toBe('open');

    // Defence in depth, and a different mechanism: a principal holding NO grant in
    // A1 at all cannot even see the row, so it gets the uniform 404 rather than a
    // 403 that would confirm the row exists.
    const alsoA1 = await createWorkOrder();
    authAs(SCOPED_ELSEWHERE);
    const invisible = await transitionRequest(
      alsoA1.workOrderId,
      { toState: 'open' },
      { version: alsoA1.recordVersion }
    );
    expect(invisible.status).toBe(404);
    expect(await readWorkOrder(alsoA1.workOrderId)).toEqual({ state: 'draft', version: 1 });
  });

  it('cross-tenant: a tenant-B principal cannot see or move a tenant-A work order', async () => {
    const inA = await createWorkOrder();

    authAs(TENANT_B_FULL);
    const foreign = await transitionRequest(
      inA.workOrderId,
      { toState: 'open' },
      { version: inA.recordVersion }
    );
    expect(foreign.status).toBe(404);
    expect((await problem(foreign)).code).toBe('ERR-RES-001');

    // An id that exists nowhere answers identically, so the route is not an
    // existence oracle.
    authAs(TENANT_B_FULL);
    const unknown = await transitionRequest(
      crypto.randomUUID(),
      { toState: 'open' },
      { version: 1 }
    );
    expect(unknown.status).toBe(404);

    expect(await readWorkOrder(inA.workOrderId)).toEqual({ state: 'draft', version: 1 });
  });
});

describe('wo.work-order-transition — the graph, the reason, and the ledger', () => {
  it('moves along a configured edge and writes state, ONE history row, ONE audit record and ONE event', async () => {
    const created = await createWorkOrder();

    authAs(FULL);
    const response = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: created.recordVersion }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'open', recordVersion: 2 });
    // The ETag is the version a follow-up command must send back.
    expect(response.headers.get('etag')).toBe('"2"');

    expect(await readWorkOrder(created.workOrderId)).toEqual({ state: 'open', version: 2 });
    expect(await historyCount(created.workOrderId)).toBe(1);
    expect(await auditCount(STATE_CHANGED_ACTION, created.workOrderId)).toBe(1);
    expect(await outboxCount(STATE_CHANGED_EVENT, created.workOrderId)).toBe(1);
    // Not a closure: the closing action and the closing event must be absent.
    expect(await auditCount(CLOSED_ACTION, created.workOrderId)).toBe(0);
    expect(await outboxCount(CLOSED_EVENT, created.workOrderId)).toBe(0);

    const ledger = await admin.query<{
      from_state: string;
      to_state: string;
      reason: string | null;
      actor_id: string;
    }>(
      `SELECT from_state, to_state, reason, actor_id FROM wo.work_order_status_history
        WHERE work_order_id = $1`,
      [created.workOrderId]
    );
    expect(ledger.rows[0]?.from_state).toBe('draft');
    expect(ledger.rows[0]?.to_state).toBe('open');
    // No reason was given and none was required, so the ledger records none —
    // rather than an empty string, which `NULLIF(btrim(...),'')` collapses.
    expect(ledger.rows[0]?.reason).toBeNull();
    expect(ledger.rows[0]?.actor_id).toBe(FULL.userId);

    const event = await admin.query<{
      aggregate_version: string;
      aggregate_type: string;
      producer: string;
      payload: { fromState: string; toState: string; workOrderId: string };
    }>(
      `SELECT aggregate_version, aggregate_type, producer, payload FROM shared.event_outbox
        WHERE aggregate_id = $1 AND event_type = $2`,
      [created.workOrderId, STATE_CHANGED_EVENT]
    );
    expect(event.rows[0]?.aggregate_type).toBe('wo.work_order');
    expect(event.rows[0]?.producer).toBe('wo.work-order-service');
    expect(Number(event.rows[0]?.aggregate_version)).toBe(2);
    expect(event.rows[0]?.payload.fromState).toBe('draft');
    expect(event.rows[0]?.payload.toState).toBe('open');
  });

  it('carries a required reason into the guard AND into the ledger', async () => {
    const created = await createWorkOrder();
    const openVersion = await advance(created.workOrderId, [
      { toState: 'open' },
      { toState: 'in_progress' },
    ]);

    // `in_progress -> awaiting_parts` carries requires_reason on the EDGE.
    authAs(FULL);
    const response = await transitionRequest(
      created.workOrderId,
      { toState: 'awaiting_parts', reason: 'brake caliper on back order' },
      { version: openVersion }
    );
    expect(response.status).toBe(200);
    expect((await readWorkOrder(created.workOrderId))?.state).toBe('awaiting_parts');

    const ledger = await admin.query<{ reason: string | null }>(
      `SELECT reason FROM wo.work_order_status_history
        WHERE work_order_id = $1 AND to_state = 'awaiting_parts'`,
      [created.workOrderId]
    );
    // This is the assertion that fails if `app.status_reason` is not published:
    // the guard would have refused the edge outright, and even if it had not, the
    // ledger reason would be NULL.
    expect(ledger.rows[0]?.reason).toBe('brake caliper on back order');
  });

  it('refuses a missing reason, an absent edge, and a closing target — each distinctly', async () => {
    const created = await createWorkOrder();

    // `draft -> cancelled` requires a reason (the edge AND the target state do).
    authAs(FULL);
    const noReason = await transitionRequest(
      created.workOrderId,
      { toState: 'cancelled' },
      { version: created.recordVersion }
    );
    expect(noReason.status).toBe(422);
    expect((await problem(noReason)).code).toBe('ERR-VAL-001');

    // `draft -> in_progress` is not in the graph at all.
    authAs(FULL);
    const noEdge = await transitionRequest(
      created.workOrderId,
      { toState: 'in_progress' },
      { version: created.recordVersion }
    );
    expect(noEdge.status).toBe(409);
    expect((await problem(noEdge)).code).toBe('ERR-TRN-001');

    // A closing target on the transition endpoint. The edge exists and the order
    // is in a legal source state, so this is refused for the OTHER reason: closure
    // is a separate authority and a separate command.
    const ready = await createWorkOrder();
    const readyVersion = await advance(ready.workOrderId, TO_READY);
    authAs(FULL);
    const closing = await transitionRequest(
      ready.workOrderId,
      { toState: 'closed' },
      { version: readyVersion }
    );
    expect(closing.status).toBe(422);
    expect((await problem(closing)).violations?.[0]?.rule).toBe(
      'closure_requires_closure_operation'
    );
    expect((await readWorkOrder(ready.workOrderId))?.state).toBe('ready_to_close');

    // Cancellation, by contrast, IS a transition even though `cancelled` is
    // terminal — the closure guard exempts a cancellation target from B1–B6.
    authAs(FULL);
    const cancelled = await transitionRequest(
      created.workOrderId,
      { toState: 'cancelled', reason: 'customer withdrew the vehicle' },
      { version: created.recordVersion }
    );
    expect(cancelled.status).toBe(200);
    expect((await readWorkOrder(created.workOrderId))?.state).toBe('cancelled');
    // A cancellation is a state change, not a closure.
    expect(await auditCount(STATE_CHANGED_ACTION, created.workOrderId)).toBe(1);
    expect(await auditCount(CLOSED_ACTION, created.workOrderId)).toBe(0);
    expect(await outboxCount(CLOSED_EVENT, created.workOrderId)).toBe(0);
  });

  it('refuses a malformed body, an unknown field, a malformed id and a missing If-Match', async () => {
    const created = await createWorkOrder();

    authAs(FULL);
    expect(
      (await transitionRequest(created.workOrderId, { toState: 'OPEN' }, { version: 1 })).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (
        await transitionRequest(
          created.workOrderId,
          { toState: 'open', unexpected: true },
          { version: 1 }
        )
      ).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (await transitionRequest('not-a-uuid', { toState: 'open' }, { version: 1 })).status
    ).toBe(422);
    authAs(FULL);
    const noIfMatch = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: null }
    );
    expect(noIfMatch.status).toBe(428);
    expect((await problem(noIfMatch)).code).toBe('ERR-CON-002');

    expect(await readWorkOrder(created.workOrderId)).toEqual({ state: 'draft', version: 1 });
  });

  it('refuses a stale record version and leaves the row alone', async () => {
    const created = await createWorkOrder();
    await advance(created.workOrderId, [{ toState: 'open' }]);

    authAs(FULL);
    const stale = await transitionRequest(
      created.workOrderId,
      { toState: 'in_progress' },
      { version: created.recordVersion }
    );
    expect(stale.status).toBe(409);
    expect((await problem(stale)).code).toBe('ERR-CON-001');
    expect(await readWorkOrder(created.workOrderId)).toEqual({ state: 'open', version: 2 });
  });

  it('a replay under one idempotency key moves the order once, not twice', async () => {
    const created = await createWorkOrder();
    const key = crypto.randomUUID();

    authAs(FULL);
    const first = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: created.recordVersion, key }
    );
    expect(first.status).toBe(200);

    authAs(FULL);
    const replay = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: created.recordVersion, key }
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ state: 'open', recordVersion: 2 });

    expect(await readWorkOrder(created.workOrderId)).toEqual({ state: 'open', version: 2 });
    expect(await historyCount(created.workOrderId)).toBe(1);
    expect(await auditCount(STATE_CHANGED_ACTION, created.workOrderId)).toBe(1);
    expect(await outboxCount(STATE_CHANGED_EVENT, created.workOrderId)).toBe(1);
  });

  it('two concurrent transitions from the same version leave exactly one winner', async () => {
    const created = await createWorkOrder();

    // The race is FORCED rather than hoped for. An admin transaction holds the row
    // locked, both requests are started and must therefore block on it, and only
    // once both are provably waiting is the lock released. Without that, a fast
    // first request could complete before the second began and the assertion below
    // would pass while proving nothing about concurrency.
    const gate = await admin.connect();
    let released = false;
    try {
      await gate.query('BEGIN');
      await gate.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await gate.query('SELECT id FROM wo.work_orders WHERE id = $1 FOR UPDATE', [
        created.workOrderId,
      ]);

      authAs(FULL);
      const first = transitionRequest(
        created.workOrderId,
        { toState: 'open' },
        { version: created.recordVersion }
      );
      const second = transitionRequest(
        created.workOrderId,
        { toState: 'open' },
        { version: created.recordVersion }
      );
      await waitForBlockedBackends(2);
      await gate.query('ROLLBACK');
      released = true;
      const [a, b] = await Promise.all([first, second]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    } finally {
      if (!released) await gate.query('ROLLBACK').catch(() => undefined);
      gate.release();
    }

    expect(await readWorkOrder(created.workOrderId)).toEqual({ state: 'open', version: 2 });
    expect(await historyCount(created.workOrderId)).toBe(1);
    expect(await auditCount(STATE_CHANGED_ACTION, created.workOrderId)).toBe(1);
    expect(await outboxCount(STATE_CHANGED_EVENT, created.workOrderId)).toBe(1);
  });

  it('rollback: a failure after the state write leaves no state, no history, no audit and no event', async () => {
    const created = await createWorkOrder();

    // The injected failure is a genuine one on the real path: the event key the
    // transition is about to publish is already taken for this tenant, so
    // `publishEvent` raises after the state change, the ledger row and the audit
    // record have all been written in this transaction. A different aggregate_id
    // keeps the pre-inserted row out of this work order's counts.
    await admin.query(
      `INSERT INTO shared.event_outbox
         (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
          aggregate_version, producer, created_by)
       VALUES ($1,$2,$3,'wo.work_order',$4,1,1,'wo.work-order-service',$5)`,
      [
        TENANT_A,
        `${STATE_CHANGED_EVENT}:${created.workOrderId}:2`,
        STATE_CHANGED_EVENT,
        crypto.randomUUID(),
        USER_A,
      ]
    );

    authAs(FULL);
    const response = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: created.recordVersion }
    );
    expect(response.status).toBe(409);
    expect((await problem(response)).code).toBe('ERR-INT-001');

    expect(await readWorkOrder(created.workOrderId)).toEqual({ state: 'draft', version: 1 });
    expect(await historyCount(created.workOrderId)).toBe(0);
    expect(await auditCount(STATE_CHANGED_ACTION, created.workOrderId)).toBe(0);
    expect(await outboxCount(STATE_CHANGED_EVENT, created.workOrderId)).toBe(0);
  });
});

describe('wo.work-order-closure-eligibility', () => {
  it('401 without an authenticator and 403 without wo.work_order.read', async () => {
    const created = await createWorkOrder();

    __resetAuthenticatorForTests();
    expect((await eligibility(created.workOrderId)).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    const unpermitted = await eligibility(created.workOrderId);
    expect(unpermitted.status).toBe(403);
    expect((await problem(unpermitted)).code).toBe('ERR-IAM-001');
  });

  it('reports an eligible order, and names the deferred Phase 1-21 conditions rather than omitting them', async () => {
    const created = await createWorkOrder();
    await advance(created.workOrderId, TO_READY);

    authAs(READER);
    const response = await eligibility(created.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      state: string;
      eligible: boolean;
      blockers: readonly { code: string }[];
      alreadyTerminal: boolean;
      deferred: { owner: string; conditions: readonly string[] };
    };
    expect(body.state).toBe('ready_to_close');
    expect(body.eligible).toBe(true);
    expect(body.blockers).toEqual([]);
    expect(body.alreadyTerminal).toBe(false);
    // A blocker that always evaluated "clear" would read, in this response and in
    // every snapshot built from it, as a check that ran and passed.
    expect(body.deferred.owner).toBe('P1-21');
    expect(body.deferred.conditions).toEqual(['active-reservation', 'open-part-issue']);
  });

  it('reports EVERY unmet blocker in registry order, not just the guard’s first', async () => {
    const created = await createOpenWorkOrder();
    // One job, two blockers: it is non-terminal (B1) and it requires a diagnostic
    // that does not exist (B4). The guard would raise B1 and abort, so a caller
    // driven by the guard alone would never learn about B4.
    await addJob(created.workOrderId, { title: 'Diagnose brake noise', requiresDiagnostic: true });
    await advance(created.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);

    authAs(READER);
    const response = await eligibility(created.workOrderId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      eligible: boolean;
      blockers: readonly { code: string; enforcedBy: string }[];
    };
    expect(body.eligible).toBe(false);
    expect(body.blockers.map((blocker) => blocker.code)).toEqual(['B1', 'B4']);
    // Registry order, not discovery order: two callers comparing responses must
    // not see the same set in a different sequence.
    expect(body.blockers[0]?.enforcedBy).toContain('guard_work_order_closure');
  });

  it('an already-terminal order reports alreadyTerminal with no blockers, because the guard evaluates none', async () => {
    const created = await createWorkOrder();
    authAs(FULL);
    const cancelled = await transitionRequest(
      created.workOrderId,
      { toState: 'cancelled', reason: 'vehicle collected before work began' },
      { version: created.recordVersion }
    );
    expect(cancelled.status).toBe(200);

    authAs(READER);
    const body = (await (await eligibility(created.workOrderId)).json()) as {
      alreadyTerminal: boolean;
      blockers: readonly unknown[];
      eligible: boolean;
    };
    expect(body.alreadyTerminal).toBe(true);
    expect(body.blockers).toEqual([]);
    // `false`, and an earlier revision of this test asserted `true` — on the reasoning
    // that a terminal order has no blockers, which is correct and is not what the field
    // means. "Eligible" is what a client acts on, and a cancelled order may not be
    // closed. The three states are now distinguishable without reading `state` against a
    // catalog: eligible / blocked / finished.
    expect(body.eligible).toBe(false);
  });

  it('cross-tenant and isolation: the same 404 for another tenant, 403 for a visible-but-unpermitted branch', async () => {
    const inA1 = await createWorkOrder();

    authAs(TENANT_B_FULL);
    expect((await eligibility(inA1.workOrderId)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await eligibility(crypto.randomUUID())).status).toBe(404);

    // Visible through the widening grant, refused by the scoped permission check.
    authAs(PERMISSION_ELSEWHERE);
    expect((await eligibility(inA1.workOrderId)).status).toBe(403);
    // Not visible at all: the uniform 404, not a 403 that would confirm existence.
    authAs(SCOPED_ELSEWHERE);
    expect((await eligibility(inA1.workOrderId)).status).toBe(404);
  });

  it('refuses a malformed work-order id', async () => {
    authAs(READER);
    expect((await eligibility('not-a-uuid')).status).toBe(422);
  });
});

describe('wo.work-order-closure', () => {
  it('401 without an authenticator; 403 for a caller holding transition but NOT close', async () => {
    const created = await createWorkOrder();
    const version = await advance(created.workOrderId, TO_READY);

    __resetAuthenticatorForTests();
    expect((await closure(created.workOrderId, { toState: 'closed' }, { version })).status).toBe(
      401
    );

    // The second permission is the whole reason this operation exists. This
    // principal can park the order awaiting parts and must not be able to end the
    // workshop's liability for the vehicle.
    authAs(NO_CLOSE);
    const refused = await closure(created.workOrderId, { toState: 'closed' }, { version });
    expect(refused.status).toBe(403);
    expect((await problem(refused)).code).toBe('ERR-IAM-001');
    expect((await readWorkOrder(created.workOrderId))?.state).toBe('ready_to_close');
    expect(await auditCount(CLOSED_ACTION, created.workOrderId)).toBe(0);
  });

  it('closes an eligible order, writing state, ONE history row, ONE closing audit record and ONE closing event', async () => {
    const created = await createWorkOrder();
    const version = await advance(created.workOrderId, TO_READY);
    expect(await historyCount(created.workOrderId)).toBe(TO_READY.length);

    authAs(FULL);
    const response = await closure(created.workOrderId, { toState: 'closed' }, { version });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'closed', recordVersion: version + 1 });

    expect((await readWorkOrder(created.workOrderId))?.state).toBe('closed');
    expect(await historyCount(created.workOrderId)).toBe(TO_READY.length + 1);
    // Exactly one audit record per transition: closure is recorded under its own
    // action INSTEAD of the generic one, never under both. So the generic counts
    // stay at one per ARRANGING transition and do not grow here.
    expect(await auditCount(CLOSED_ACTION, created.workOrderId)).toBe(1);
    expect(await auditCount(STATE_CHANGED_ACTION, created.workOrderId)).toBe(TO_READY.length);
    expect(await outboxCount(CLOSED_EVENT, created.workOrderId)).toBe(1);
    expect(await outboxCount(STATE_CHANGED_EVENT, created.workOrderId)).toBe(TO_READY.length);

    // BR-WO-002: a terminal state is frozen. The graph has no outbound edge and
    // the guard refuses one regardless.
    authAs(FULL);
    const reopen = await transitionRequest(
      created.workOrderId,
      { toState: 'open' },
      { version: version + 1 }
    );
    expect(reopen.status).toBe(409);
    expect((await problem(reopen)).code).toBe('ERR-TRN-001');
    expect((await readWorkOrder(created.workOrderId))?.state).toBe('closed');
  });

  it('refuses closure with EVERY blocker reported, through the same eligibility service as the read endpoint', async () => {
    const created = await createOpenWorkOrder();
    await addJob(created.workOrderId, { title: 'Replace pads', requiresDiagnostic: true });
    const version = await advance(created.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);

    authAs(FULL);
    const response = await closure(created.workOrderId, { toState: 'closed' }, { version });
    expect(response.status).toBe(409);
    const detail = await problem(response);
    expect(detail.code).toBe('ERR-WO-001');
    // Both blockers, in registry order — the guard would have raised only B1.
    expect(detail.violations?.map((violation) => violation.path)).toEqual([
      'closure.B1',
      'closure.B4',
    ]);
    expect((await readWorkOrder(created.workOrderId))?.state).toBe('ready_to_close');
    expect(await auditCount(CLOSED_ACTION, created.workOrderId)).toBe(0);
    expect(await outboxCount(CLOSED_EVENT, created.workOrderId)).toBe(0);
  });

  it('refuses a non-closing target, a stale version, a missing If-Match and an unknown field', async () => {
    const created = await createWorkOrder();
    const version = await advance(created.workOrderId, TO_READY);

    // The closure command must not be a way to CANCEL. `in_progress -> cancelled`
    // is a configured edge and `cancelled` is terminal, so the graph cannot refuse
    // it — but it is a cancellation, which bypasses B1–B6, so routing it through
    // the closure command would let the closing authority abandon work without any
    // completeness check. (`ready_to_close` has no cancellation edge at all, which
    // is why this probe needs its own order.)
    const cancellable = await createWorkOrder();
    const cancellableVersion = await advance(cancellable.workOrderId, [
      { toState: 'open' },
      { toState: 'in_progress' },
    ]);
    authAs(FULL);
    const notClosing = await closure(
      cancellable.workOrderId,
      { toState: 'cancelled', reason: 'customer collected the vehicle' },
      { version: cancellableVersion }
    );
    expect(notClosing.status).toBe(422);
    expect((await problem(notClosing)).violations?.[0]?.rule).toBe('not_a_closing_state');
    expect((await readWorkOrder(cancellable.workOrderId))?.state).toBe('in_progress');

    authAs(FULL);
    expect(
      (await closure(created.workOrderId, { toState: 'closed' }, { version: version - 1 })).status
    ).toBe(409);
    authAs(FULL);
    expect(
      (await closure(created.workOrderId, { toState: 'closed' }, { version: null })).status
    ).toBe(428);
    authAs(FULL);
    expect(
      (await closure(created.workOrderId, { toState: 'closed', force: true }, { version })).status
    ).toBe(422);

    expect((await readWorkOrder(created.workOrderId))?.state).toBe('ready_to_close');
  });

  it('cross-tenant and isolation: 404 across tenants, 403 in a visible-but-unpermitted branch', async () => {
    const inA1 = await createWorkOrder();
    const version = await advance(inA1.workOrderId, TO_READY);

    authAs(TENANT_B_FULL);
    expect((await closure(inA1.workOrderId, { toState: 'closed' }, { version })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await closure(crypto.randomUUID(), { toState: 'closed' }, { version: 1 })).status).toBe(
      404
    );

    authAs(PERMISSION_ELSEWHERE);
    expect((await closure(inA1.workOrderId, { toState: 'closed' }, { version })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await closure(inA1.workOrderId, { toState: 'closed' }, { version })).status).toBe(404);
    expect((await readWorkOrder(inA1.workOrderId))?.state).toBe('ready_to_close');
  });

  it('a replay under one idempotency key closes once; two concurrent closures leave one winner', async () => {
    const replayed = await createWorkOrder();
    const replayVersion = await advance(replayed.workOrderId, TO_READY);
    const key = crypto.randomUUID();

    authAs(FULL);
    expect(
      (await closure(replayed.workOrderId, { toState: 'closed' }, { version: replayVersion, key }))
        .status
    ).toBe(200);
    authAs(FULL);
    const replay = await closure(
      replayed.workOrderId,
      { toState: 'closed' },
      { version: replayVersion, key }
    );
    expect(replay.status).toBe(200);
    expect(await auditCount(CLOSED_ACTION, replayed.workOrderId)).toBe(1);
    expect(await outboxCount(CLOSED_EVENT, replayed.workOrderId)).toBe(1);

    const raced = await createWorkOrder();
    const racedVersion = await advance(raced.workOrderId, TO_READY);
    const gate = await admin.connect();
    let released = false;
    try {
      await gate.query('BEGIN');
      await gate.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await gate.query('SELECT id FROM wo.work_orders WHERE id = $1 FOR UPDATE', [
        raced.workOrderId,
      ]);
      authAs(FULL);
      const first = closure(raced.workOrderId, { toState: 'closed' }, { version: racedVersion });
      const second = closure(raced.workOrderId, { toState: 'closed' }, { version: racedVersion });
      await waitForBlockedBackends(2);
      await gate.query('ROLLBACK');
      released = true;
      const [a, b] = await Promise.all([first, second]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    } finally {
      if (!released) await gate.query('ROLLBACK').catch(() => undefined);
      gate.release();
    }
    expect((await readWorkOrder(raced.workOrderId))?.state).toBe('closed');
    expect(await auditCount(CLOSED_ACTION, raced.workOrderId)).toBe(1);
    expect(await outboxCount(CLOSED_EVENT, raced.workOrderId)).toBe(1);
  });
});

describe('the P1-18 → P1-19 boundary, end to end', () => {
  it('reception conversion opens the shell and P1-19 drives it to closure', async () => {
    // Conversion is the ONLY creation path, and this suite has no other: the
    // fixture drives the real reception route. What it produces is a `draft`
    // order with the frozen defaults reception deliberately did not choose.
    const created = await createWorkOrder({ companyId: COMPANY_A1, branchId: BRANCH_A1 });
    expect(created.state).toBe('draft');
    expect(created.recordVersion).toBe(1);
    expect(await historyCount(created.workOrderId)).toBe(0);

    const converted = await admin.query<{
      reception_status: string;
      display_number: string | null;
    }>(
      `SELECT v.reception_status, w.display_number
         FROM wo.work_orders w JOIN rec.reception_visits v ON v.id = w.reception_visit_id
        WHERE w.id = $1`,
      [created.workOrderId]
    );
    expect(converted.rows[0]?.reception_status).toBe('converted');
    // Numbering comes from the Phase 1-15 allocator, through conversion.
    expect(converted.rows[0]?.display_number).toMatch(/^WO-\d{6}$/);

    // draft does not accept jobs; `open` is the first state that does.
    authAs(FULL);
    const tooEarly = await CREATE_JOB(
      new Request(`http://localhost/api/v1/work-orders/${created.workOrderId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ title: 'Premature job' }),
      }),
      { params: Promise.resolve({ workOrderId: created.workOrderId }) }
    );
    expect(tooEarly.status).toBe(409);
    expect((await problem(tooEarly)).code).toBe('ERR-TRN-001');

    await advance(created.workOrderId, [{ toState: 'open' }]);
    const jobId = await addJob(created.workOrderId, { title: 'Replace brake pads' });
    const readyVersion = await advance(created.workOrderId, [
      { toState: 'in_progress' },
      { toState: 'qc_pending' },
      { toState: 'ready_to_close' },
    ]);

    // Closure is blocked by the live job (B1) — reported before the write.
    authAs(FULL);
    const blocked = await closure(
      created.workOrderId,
      { toState: 'closed' },
      { version: readyVersion }
    );
    expect(blocked.status).toBe(409);
    expect((await problem(blocked)).violations?.map((v) => v.path)).toEqual(['closure.B1']);

    // B1 clears when no non-terminal job remains, and a job moves only through
    // `wo.job_transitions` — whose route is Wave 5. Arranged as admin, following
    // the real graph.
    //
    // The path taken is `planned -> cancelled`, not `-> assigned -> in_progress ->
    // completed`, and the reason is a live protected constraint rather than
    // convenience: the job-assignments migration REPLACED
    // `wo.guard_job_transition` to require an active `wo.job_assignments` row
    // before a job may enter an `assignment_required` state, so `assigned` is
    // unreachable until Wave 5 builds assignments. `cancelled` is terminal, needs
    // no assignment, and requires a reason — which is why the GUC is set here.
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true),
                set_config('app.status_reason','not required after inspection',true)`,
        [USER_A, TENANT_A]
      );
      await client.query(`UPDATE wo.jobs SET state = 'cancelled' WHERE id = $1`, [jobId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    authAs(READER);
    const nowEligible = (await (await eligibility(created.workOrderId)).json()) as {
      eligible: boolean;
    };
    expect(nowEligible.eligible).toBe(true);

    authAs(FULL);
    const closed = await closure(
      created.workOrderId,
      { toState: 'closed' },
      { version: readyVersion }
    );
    expect(closed.status).toBe(200);
    expect((await readWorkOrder(created.workOrderId))?.state).toBe('closed');
    expect(await auditCount(CLOSED_ACTION, created.workOrderId)).toBe(1);
    expect(await outboxCount(CLOSED_EVENT, created.workOrderId)).toBe(1);
  });

  it('a tenant-B work order converts and closes inside its own tenant, invisibly to tenant A', async () => {
    const inB = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    const version = await advance(inB.workOrderId, TO_READY, TENANT_B_FULL);

    authAs(TENANT_B_FULL);
    expect((await closure(inB.workOrderId, { toState: 'closed' }, { version })).status).toBe(200);

    // The mirror image of every cross-tenant case above: tenant A cannot see it.
    authAs(FULL);
    expect((await eligibility(inB.workOrderId)).status).toBe(404);
  });
});
