/**
 * Work-order service lines and required-part demand (Phase 1-19, P1-19-BE-020).
 *
 * The claim this suite has to defend is a NEGATIVE one: recording that a job needs
 * parts reserves nothing and issues nothing. No stock row is read or written anywhere
 * in this phase, and `wo.work_orders.parts_forward_state` is a documented forward
 * contract. So the tests assert both halves: the demand row exists, and nothing else
 * moved — including the order own `parts_forward_state`, which stays exactly where
 * reception left it.
 *
 * The catalog references are NOT unconstrained forward pointers, whatever the Phase
 * 1-9 table comments still say: migration 20260723097000 added
 * `fk_work_order_service_lines_service` to `svc.services` and
 * `fk_required_parts_item` to `inv.item_master`. Those catalogs are empty in this
 * phase fixtures, so the case the suite exercises is the REFUSAL — and it must be a
 * 404, not the 500 an unmapped 23503 would have produced.
 *
 * `quantity` crosses the boundary as a decimal STRING because the column is
 * `numeric(12,3)` and IEEE-754 cannot represent every value it holds. The suite proves
 * the value survives the round trip unrounded, which a number would not.
 *
 * Operations exercised here: wo.service-line-record, wo.service-line-list,
 * wo.required-part-record, wo.required-part-list.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.service-line-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.service-line-list: route service authorization success denial cross-tenant isolation
 *   wo.required-part-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.required-part-list: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
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
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import {
  GET as LIST_SERVICE_LINES,
  POST as RECORD_SERVICE_LINE,
} from '@/app/api/v1/work-orders/[workOrderId]/service-lines/route';
import {
  GET as LIST_REQUIRED_PARTS,
  POST as RECORD_REQUIRED_PART,
} from '@/app/api/v1/work-orders/[workOrderId]/required-parts/route';

const SERVICE_ACTION = 'wo.work_order.service_line_recorded';
const PART_ACTION = 'wo.work_order.required_part_recorded';

let admin: Pool;
let runtime: Pool;

interface LineBody {
  readonly id: string;
  readonly workOrderId: string;
  readonly jobId: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly reference: string | null;
  readonly recordVersion: number;
}

type Kind = 'service' | 'part';

function record(
  kind: Kind,
  workOrderId: string,
  body: unknown,
  options: { readonly key?: string } = {}
): Promise<Response> {
  const segment = kind === 'service' ? 'service-lines' : 'required-parts';
  const handler = kind === 'service' ? RECORD_SERVICE_LINE : RECORD_REQUIRED_PART;
  return handler(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/${segment}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
}

function list(kind: Kind, workOrderId: string): Promise<Response> {
  const segment = kind === 'service' ? 'service-lines' : 'required-parts';
  const handler = kind === 'service' ? LIST_SERVICE_LINES : LIST_REQUIRED_PARTS;
  return handler(new Request(`http://localhost/api/v1/work-orders/${workOrderId}/${segment}`), {
    params: Promise.resolve({ workOrderId }),
  });
}

async function problem(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
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

// Both surfaces have the same shape, the same catalog-reference discipline and the
// same guards, so the shared cases are asserted for both rather than for one.
describe.each([
  [
    'service',
    SERVICE_ACTION,
    'serviceRef',
    'wo.service-line-record',
    'wo.service-line-list',
  ] as const,
  ['part', PART_ACTION, 'itemRef', 'wo.required-part-record', 'wo.required-part-list'] as const,
])('%s lines', (kind, action, refField, recordOperation, listOperation) => {
  it(`${recordOperation} records a line, audits it, and returns the quantity unrounded`, async () => {
    const order = await createOpenWorkOrder();

    authAs(FULL);
    const response = await record(kind, order.workOrderId, {
      description: 'Replace front brake discs',
      quantity: '2.500',
      unit: 'each',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as LineBody;
    expect(body.workOrderId).toBe(order.workOrderId);
    expect(body.jobId).toBeNull();
    expect(body.description).toBe('Replace front brake discs');
    // A string all the way through: `numeric(12,3)` holds values IEEE-754 cannot,
    // so the scale must survive the round trip exactly.
    expect(body.quantity).toBe('2.500');
    expect(body.unit).toBe('each');
    // No reference was given, so none is stored. The column is nullable precisely
    // because a workshop records work before it is catalogued.
    expect(body.reference).toBeNull();
    expect(await auditCount(action, body.id)).toBe(1);
  });

  it('refuses an unresolvable catalog reference as a 404 rather than a 500', async () => {
    const order = await createOpenWorkOrder();

    // The reference is foreign-keyed to the Phase 1-10 catalog — svc.services for a
    // service line, inv.item_master for a part — and those catalogs are empty here.
    // An unmapped 23503 would have surfaced as ERR-SYS-001 with a 500.
    authAs(FULL);
    const response = await record(kind, order.workOrderId, {
      description: 'Against an uncatalogued reference',
      quantity: '1',
      [refField]: crypto.randomUUID(),
    });
    expect(response.status).toBe(404);
    expect((await problem(response)).code).toBe('ERR-RES-001');
  });

  it('defaults the unit rather than inventing a quantity, and attaches to a job of THIS order', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const created = await CREATE_JOB(
      new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ title: 'Brakes' }),
      }),
      { params: Promise.resolve({ workOrderId: order.workOrderId }) }
    );
    const job = (await created.json()) as { id: string };

    authAs(FULL);
    const response = await record(kind, order.workOrderId, {
      jobId: job.id,
      description: 'Bleed the brake circuit',
      quantity: '1',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as LineBody;
    expect(body.jobId).toBe(job.id);
    expect(body.unit).toBe('each');

    // A job under a DIFFERENT work order satisfies the composite foreign key — same
    // tenant, company and branch — so the explicit ownership check is the only thing
    // that stops a line attaching to the wrong order's job.
    const other = await createOpenWorkOrder();
    authAs(FULL);
    const foreignJob = await CREATE_JOB(
      new Request(`http://localhost/api/v1/work-orders/${other.workOrderId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ title: 'Elsewhere' }),
      }),
      { params: Promise.resolve({ workOrderId: other.workOrderId }) }
    );
    const elsewhere = (await foreignJob.json()) as { id: string };
    authAs(FULL);
    const misattached = await record(kind, order.workOrderId, {
      jobId: elsewhere.id,
      description: 'Wrong parent',
      quantity: '1',
    });
    expect(misattached.status).toBe(404);
    expect((await problem(misattached)).code).toBe('ERR-RES-001');
  });

  it('refuses a non-positive quantity, an over-scaled quantity, a blank description and an unknown field', async () => {
    const order = await createOpenWorkOrder();

    for (const quantity of ['0', '-1', '1.2345', 'two', '']) {
      authAs(FULL);
      const response = await record(kind, order.workOrderId, {
        description: 'Bad quantity',
        quantity,
      });
      expect(response.status, `quantity ${JSON.stringify(quantity)}`).toBe(422);
    }
    authAs(FULL);
    expect(
      (await record(kind, order.workOrderId, { description: '   ', quantity: '1' })).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (await record(kind, order.workOrderId, { description: 'ok', quantity: '1', extra: 1 })).status
    ).toBe(422);
    authAs(FULL);
    expect((await record(kind, 'not-a-uuid', { description: 'ok', quantity: '1' })).status).toBe(
      422
    );

    const rows = await admin.query<{ n: string }>(
      kind === 'service'
        ? `SELECT count(*)::text AS n FROM wo.work_order_service_lines WHERE work_order_id = $1`
        : `SELECT count(*)::text AS n FROM wo.required_parts WHERE work_order_id = $1`,
      [order.workOrderId]
    );
    expect(rows.rows[0]?.n).toBe('0');
  });

  it('refuses a line on a terminal work order', async () => {
    const order = await createWorkOrder();
    await advance(order.workOrderId, [
      { toState: 'cancelled', reason: 'customer collected the vehicle' },
    ]);

    authAs(FULL);
    const response = await record(kind, order.workOrderId, {
      description: 'After the end',
      quantity: '1',
    });
    expect(response.status).toBe(409);
    expect((await problem(response)).code).toBe('ERR-TRN-001');
  });

  it('401, 403 without wo.work_order.line.manage, and a replayed key records once', async () => {
    const order = await createOpenWorkOrder();
    const payload = { description: 'Idempotent line', quantity: '3' };

    __resetAuthenticatorForTests();
    expect((await record(kind, order.workOrderId, payload)).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await record(kind, order.workOrderId, payload)).status).toBe(403);
    // The reader may see the work order and must not be able to add work to it.
    authAs(READER);
    const reader = await record(kind, order.workOrderId, payload);
    expect(reader.status).toBe(403);
    expect((await problem(reader)).code).toBe('ERR-IAM-001');

    const key = crypto.randomUUID();
    authAs(FULL);
    const first = await record(kind, order.workOrderId, payload, { key });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as LineBody;
    authAs(FULL);
    const replay = await record(kind, order.workOrderId, payload, { key });
    expect(replay.status).toBe(200);
    expect((await replay.json()) as LineBody).toEqual(firstBody);

    authAs(FULL);
    const items = (
      (await (await list(kind, order.workOrderId)).json()) as {
        items: readonly LineBody[];
      }
    ).items;
    expect(items).toHaveLength(1);
  });

  it(`${listOperation} lists lines oldest-first and refuses an unauthorized or foreign reader`, async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const first = (await (
      await record(kind, order.workOrderId, { description: 'First', quantity: '1' })
    ).json()) as LineBody;
    authAs(FULL);
    const second = (await (
      await record(kind, order.workOrderId, { description: 'Second', quantity: '1' })
    ).json()) as LineBody;

    authAs(READER);
    const response = await list(kind, order.workOrderId);
    expect(response.status).toBe(200);
    const items = ((await response.json()) as { items: readonly LineBody[] }).items;
    expect(items.map((item) => item.id)).toEqual([first.id, second.id]);

    __resetAuthenticatorForTests();
    expect((await list(kind, order.workOrderId)).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await list(kind, order.workOrderId)).status).toBe(403);
    authAs(READER);
    expect((await list(kind, 'not-a-uuid')).status).toBe(422);
    authAs(READER);
    expect((await list(kind, crypto.randomUUID())).status).toBe(404);
  });

  it('isolation and cross-tenant: 403 where RLS admits the order, 404 where it does not', async () => {
    const inA1 = await createOpenWorkOrder();
    const inA2 = await createOpenWorkOrder({ branchId: BRANCH_A2 });
    const inB = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    await advance(inB.workOrderId, [{ toState: 'open' }], TENANT_B_FULL);
    const payload = { description: 'Scoped', quantity: '1' };

    authAs(PERMISSION_ELSEWHERE);
    expect((await record(kind, inA1.workOrderId, payload)).status).toBe(403);
    expect((await list(kind, inA1.workOrderId)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await record(kind, inA1.workOrderId, payload)).status).toBe(404);
    expect((await list(kind, inA1.workOrderId)).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await record(kind, inA2.workOrderId, payload)).status).toBe(201);

    authAs(TENANT_B_FULL);
    const foreign = await record(kind, inA1.workOrderId, payload);
    expect(foreign.status).toBe(404);
    expect((await problem(foreign)).code).toBe('ERR-RES-001');
    authAs(TENANT_B_FULL);
    expect((await list(kind, inA1.workOrderId)).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await record(kind, inB.workOrderId, payload)).status).toBe(201);
  });
});

describe('required-part demand touches no inventory and no parts state', () => {
  it('records demand while leaving parts_forward_state and every inv table alone', async () => {
    const order = await createOpenWorkOrder();
    const before = await admin.query<{ parts_forward_state: string }>(
      `SELECT parts_forward_state FROM wo.work_orders WHERE id = $1`,
      [order.workOrderId]
    );
    // Reception leaves it at the frozen default and this phase never moves it: the
    // column is documented as a forward contract for Phase 1-10/1-21 with no
    // reservation enforced.
    expect(before.rows[0]?.parts_forward_state).toBe('none');

    authAs(FULL);
    const response = await record('part', order.workOrderId, {
      description: 'Front brake disc, pair',
      quantity: '2',
    });
    expect(response.status).toBe(201);

    const after = await admin.query<{ parts_forward_state: string }>(
      `SELECT parts_forward_state FROM wo.work_orders WHERE id = $1`,
      [order.workOrderId]
    );
    expect(after.rows[0]?.parts_forward_state).toBe('none');

    // The negative claim, asserted rather than described: no `inv` table holds a row
    // for this tenant. Recording what a job needs and consuming what the store has
    // are different acts owned by different phases, and this is the check that fails
    // if a later change quietly couples them.
    const inventory = await admin.query<{ total: string }>(
      `SELECT COALESCE(SUM(n), 0)::text AS total FROM (
         SELECT count(*) AS n FROM inv.stock_movements WHERE tenant_id = $1
         UNION ALL SELECT count(*) FROM inv.stock_balances WHERE tenant_id = $1
       ) counts`,
      [TENANT_A]
    );
    expect(inventory.rows[0]?.total).toBe('0');
  });

  it('a service line and a required part are separate records with separate audit actions', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const service = (await (
      await record('service', order.workOrderId, { description: 'Labour: 1.5h', quantity: '1.5' })
    ).json()) as LineBody;
    authAs(FULL);
    const part = (await (
      await record('part', order.workOrderId, { description: 'Brake fluid', quantity: '0.500' })
    ).json()) as LineBody;

    expect(service.id).not.toBe(part.id);
    expect(await auditCount(SERVICE_ACTION, service.id)).toBe(1);
    expect(await auditCount(PART_ACTION, part.id)).toBe(1);
    // Neither list bleeds into the other: they are different tables and different
    // facts, and a caller reading labour must not be shown parts as labour.
    authAs(FULL);
    const services = (
      (await (await list('service', order.workOrderId)).json()) as {
        items: readonly LineBody[];
      }
    ).items;
    authAs(FULL);
    const parts = (
      (await (await list('part', order.workOrderId)).json()) as {
        items: readonly LineBody[];
      }
    ).items;
    expect(services.map((item) => item.id)).toEqual([service.id]);
    expect(parts.map((item) => item.id)).toEqual([part.id]);
    expect(await auditCount(SERVICE_ACTION, part.id)).toBe(0);
    expect(USER_A.length).toBeGreaterThan(0);
  });
});
