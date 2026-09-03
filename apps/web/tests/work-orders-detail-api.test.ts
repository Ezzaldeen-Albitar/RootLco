import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The work-order DETAIL adapters (P1-29, `W3`).
 *
 * ## What the backend proof cannot cover
 *
 * `tests/backend/p1-29-w3-work-order-detail` proves the SERVER refuses a stale
 * write, routes a department and persists an assignment. It calls the routes
 * directly, so it says nothing about whether these adapters send the version,
 * the routing or the window at all — an adapter that dropped `If-Match` would
 * leave every one of those backend cases green while the screen silently
 * overwrote other people's work.
 *
 * So the concurrency token, the three-way routing field and the assignment body
 * are asserted HERE, on the request the adapter actually builds, with only the
 * HTTP client mocked.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  readWorkOrderDetail,
  listDepartments,
  listJobAssignments,
  transitionWorkOrder,
  updateJob,
  assignTechnician,
} = await import('@/features/work-orders/api');

const WORK_ORDER_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '77777777-7777-4777-8777-777777777777';
const DEPARTMENT_ID = '88888888-8888-4888-8888-888888888888';
const TARGET = {
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
} as const;

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the detail reads address the right record', () => {
  it('reads one work order by id, encoded', async () => {
    get.mockResolvedValue(ok({ workOrder: { id: WORK_ORDER_ID }, jobs: [], nextStates: [] }));

    const result = await readWorkOrderDetail(WORK_ORDER_ID);

    expect(result.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/work-orders/${WORK_ORDER_ID}`);
  });

  it('reads a job’s assignments, and a refusal is a refusal', async () => {
    get.mockResolvedValue(ok({ items: [{ id: 'a1', validTo: null }] }));
    const listed = await listJobAssignments(JOB_ID);
    expect(listed.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/jobs/${JOB_ID}/assignments`);

    // `tech.technician.read` is a SEPARATE code from the work order's, so this
    // read can be refused on its own — and the panel must be able to say so
    // rather than render an empty roster, which claims nobody is assigned.
    get.mockReset();
    get.mockResolvedValue(failure('forbidden'));
    const refused = await listJobAssignments(JOB_ID);
    expect(refused.status).toBe('denied');
    expect(refused.status).not.toBe('ok');
  });

  it('reads departments as a branch TARGET, never as a filter', async () => {
    get.mockResolvedValue(ok({ items: [] }));

    await listDepartments(TARGET);

    const path = String(get.mock.calls[0]?.[0]);
    expect(path).toContain('/api/v1/org/departments');
    expect(path).toContain(`companyId=${TARGET.companyId}`);
    expect(path).toContain(`branchId=${TARGET.branchId}`);
    // The query is `.strict()` at the backend: an extra parameter is a 422, not
    // a silent ignore, so nothing else may be appended.
    expect(path).not.toContain('cursor=');
    expect(path).not.toContain('limit=');
    expect(path).not.toContain('status=');
  });
});

describe('every guarded write carries the version the screen is showing', () => {
  it('transitions with If-Match, and sends a reason only when there is one', async () => {
    send.mockResolvedValue(ok({}));

    await transitionWorkOrder(WORK_ORDER_ID, { toState: 'in_progress' }, 7);

    const [method, path, body, options] = send.mock.calls[0] ?? [];
    expect(method).toBe('POST');
    expect(String(path)).toBe(`/api/v1/work-orders/${WORK_ORDER_ID}/transition`);
    expect(body).toEqual({ toState: 'in_progress' });
    // THE assertion this file exists for. Without it the backend answers 428
    // `ERR-CON-002` and no write happens — or worse, a future backend that
    // stopped demanding the header would accept a stale overwrite in silence.
    expect(options).toEqual({ ifMatch: 7 });

    send.mockReset();
    send.mockResolvedValue(ok({}));
    await transitionWorkOrder(WORK_ORDER_ID, { toState: 'cancelled', reason: 'Customer left' }, 8);
    expect(send.mock.calls[0]?.[2]).toEqual({ toState: 'cancelled', reason: 'Customer left' });
    expect(send.mock.calls[0]?.[3]).toEqual({ ifMatch: 8 });
  });

  it('routes a job with the version, the title and the department', async () => {
    send.mockResolvedValue(ok({}));

    await updateJob(JOB_ID, { title: 'Replace front pads', departmentId: DEPARTMENT_ID }, 3);

    const [method, path, body, options] = send.mock.calls[0] ?? [];
    expect(method).toBe('PATCH');
    expect(String(path)).toBe(`/api/v1/jobs/${JOB_ID}`);
    // The title travels because the PATCH REPLACES it. Dropping it would be a
    // 422; sending a stale one is safe only because of the version beside it.
    expect(body).toEqual({ title: 'Replace front pads', departmentId: DEPARTMENT_ID });
    expect(options).toEqual({ ifMatch: 3 });
  });

  it('distinguishes CLEARING a department from leaving it alone', async () => {
    // The three-way field. `null` unroutes; `undefined` means "do not touch".
    // Collapsing them would make an operator's "no department" a no-op, and the
    // screen would then show a routing that was never removed.
    send.mockResolvedValue(ok({}));
    await updateJob(JOB_ID, { title: 'Bleed brakes', departmentId: null }, 4);
    expect(send.mock.calls[0]?.[2]).toEqual({ title: 'Bleed brakes', departmentId: null });
    expect(Object.hasOwn(send.mock.calls[0]?.[2] as object, 'departmentId')).toBe(true);

    send.mockReset();
    send.mockResolvedValue(ok({}));
    await updateJob(JOB_ID, { title: 'Bleed brakes' }, 5);
    expect(Object.hasOwn(send.mock.calls[0]?.[2] as object, 'departmentId')).toBe(false);
  });

  it('assigns a technician with a window, and NO If-Match', async () => {
    send.mockResolvedValue(ok({}));

    await assignTechnician(JOB_ID, {
      technicianProfileId: 'tech-1',
      assignmentRole: 'primary',
      window: { from: '2026-07-26T08:00:00.000Z', to: '2026-07-26T12:00:00.000Z' },
    });

    const [method, path, body, options] = send.mock.calls[0] ?? [];
    expect(method).toBe('POST');
    expect(String(path)).toBe(`/api/v1/jobs/${JOB_ID}/assignments`);
    expect(body).toMatchObject({ technicianProfileId: 'tech-1', assignmentRole: 'primary' });
    expect((body as { window: unknown }).window).toEqual({
      from: '2026-07-26T08:00:00.000Z',
      to: '2026-07-26T12:00:00.000Z',
    });
    // An assignment APPENDS to a history; it does not edit the job, so it is not
    // version guarded. Sending a version here would be parsed and discarded, and
    // would suggest a guard that does not exist.
    expect(options).toBeUndefined();
  });
});

describe('a refused write is reported, never smoothed', () => {
  it('maps a conflict to conflict, so the screen can say the record moved', async () => {
    send.mockResolvedValue(failure('conflict'));

    const result = await updateJob(JOB_ID, { title: 'x' }, 1);

    expect(result.status).toBe('conflict');
    expect(result.status).not.toBe('success');
    expect(result.correlationId).toBe('corr-1');
  });

  it('maps a denial to denied, and never invents a success', async () => {
    for (const [kind, expected] of [
      ['forbidden', 'denied'],
      ['validation', 'invalid'],
      ['rate-limited', 'throttled'],
      ['server', 'error'],
    ] as const) {
      send.mockReset();
      send.mockResolvedValue(failure(kind));
      const result = await transitionWorkOrder(WORK_ORDER_ID, { toState: 'closed' }, 2);
      expect(result.status, `${kind} mapped wrong`).toBe(expected);
      expect(result.status).not.toBe('success');
    }
  });

  it('does not reach the backend at all without a session', async () => {
    authorizedClient.mockResolvedValue(null);

    expect((await transitionWorkOrder(WORK_ORDER_ID, { toState: 'x' }, 1)).status).toBe('expired');
    expect((await updateJob(JOB_ID, { title: 'x' }, 1)).status).toBe('expired');
    expect(
      (await assignTechnician(JOB_ID, { technicianProfileId: 't', window: { from: 'a', to: 'b' } }))
        .status
    ).toBe('expired');
    expect((await readWorkOrderDetail(WORK_ORDER_ID)).status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
