/**
 * P1-32 preparatory slice 3b — material demand control, its reference data and
 * truthful transfer receipts, end to end through the route handlers
 * (P1-32-PRE-125…130).
 *
 * Every case counts a side effect — a requirement's usage, a balance, a settlement,
 * an audit row — because a status alone cannot tell a draw that was measured from
 * one that was waved through. The properties this suite exists to hold:
 *
 *  - a reservation or an issue for a work order whose requirement covers the item
 *    must name the requirement, and is refused with ERR-INV-001 — stating the
 *    allowance, what is already committed and what was asked for — when the
 *    requirement is not approved, lacks a specification or a conversion, or would be
 *    exceeded; nothing moves when it is refused;
 *  - one quantity is counted once: an issue that consumes a governed reservation
 *    spends no more allowance, and releasing a governed reservation gives it back;
 *  - two draws racing for the last of an allowance produce exactly one winner;
 *  - a requirement and an exception are decided by someone other than the person who
 *    asked, and an approved exception is what lets a further draw through;
 *  - unit conversions and specifications are tenant-wide facts, written only under a
 *    tenant-wide grant, and a specification resolves only once confirmed;
 *  - a transfer receipt records what arrived; the remainder stays in transit until it
 *    is received, returned to the origin, or written off by a second person.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.material-requirement-create: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.material-requirement-list: route service authorization success denial cross-tenant isolation
 *   inv.material-requirement-read: route service authorization success denial cross-tenant isolation
 *   inv.material-requirement-approve: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.material-exception-create: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.material-exception-decide: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.unit-conversion-list: route service authorization success denial cross-tenant isolation
 *   inv.unit-conversion-set: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.unit-conversion-retire: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.vehicle-specification-list: route service authorization success denial cross-tenant isolation
 *   inv.vehicle-specification-create: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.vehicle-specification-confirm: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.vehicle-specification-retire: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.material-requirement-recheck: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.material-requirement-cancel: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.material-request-close: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.material-request-cancel: route service authorization success denial cross-tenant audit outbox idempotency isolation
 *   inv.stock-transfer-discrepancy-resolve: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.stock-transfer-write-off-decide: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.stock-transfer-settlement-list: route service authorization success denial cross-tenant isolation
 *   inv.stock-transfer-settlement-read: route service authorization success denial cross-tenant isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  type Principal,
} from './p1-19-helpers';
import {
  CATEGORY_A,
  INV_APPROVER,
  INV_FULL,
  INV_MATERIAL,
  INV_MATERIAL_APPROVER,
  INV_MATERIAL_SCOPED_A2,
  INV_READER,
  INV_SCOPED_A2,
  INV_TENANT_B,
  INV_TENANT_B_MATERIAL,
  ITEM_A,
  ITEM_A_ALT,
  UOM_EACH,
  auditCountFor,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
  outboxCountFor,
  reservationStatusOf,
  seedStock,
} from './p1-21-helpers';
import {
  GET as REQUIREMENT_LIST,
  POST as REQUIREMENT_CREATE,
} from '@/app/api/v1/material-requirements/route';
import { GET as REQUIREMENT_READ } from '@/app/api/v1/material-requirements/[requirementId]/route';
import { Quantity } from '@/modules/inventory';
import { POST as REQUIREMENT_DECIDE } from '@/app/api/v1/material-requirements/[requirementId]/approval/route';
import { POST as REQUIREMENT_RECHECK } from '@/app/api/v1/material-requirements/[requirementId]/recheck/route';
import { POST as REQUIREMENT_CANCEL } from '@/app/api/v1/material-requirements/[requirementId]/cancellation/route';
import { POST as REQUEST_CLOSE } from '@/app/api/v1/material-requests/[requestId]/closure/route';
import { POST as REQUEST_CANCEL } from '@/app/api/v1/material-requests/[requestId]/cancellation/route';
import { POST as EXCEPTION_CREATE } from '@/app/api/v1/material-requirements/[requirementId]/exceptions/route';
import { POST as EXCEPTION_DECIDE } from '@/app/api/v1/material-exceptions/[exceptionId]/decision/route';
import {
  GET as CONVERSION_LIST,
  POST as CONVERSION_SET,
} from '@/app/api/v1/unit-conversions/route';
import { POST as CONVERSION_RETIRE } from '@/app/api/v1/unit-conversions/[conversionId]/retirement/route';
import {
  GET as SPECIFICATION_LIST,
  POST as SPECIFICATION_CREATE,
} from '@/app/api/v1/vehicle-fluid-specifications/route';
import { POST as SPECIFICATION_CONFIRM } from '@/app/api/v1/vehicle-fluid-specifications/[specificationId]/confirmation/route';
import { POST as SPECIFICATION_RETIRE } from '@/app/api/v1/vehicle-fluid-specifications/[specificationId]/retirement/route';
import { POST as RESERVE } from '@/app/api/v1/stock-reservations/route';
import { POST as RELEASE } from '@/app/api/v1/stock-reservations/[reservationId]/release/route';
import { POST as ISSUE } from '@/app/api/v1/stock-issues/route';
import { POST as TRANSFER_CREATE } from '@/app/api/v1/stock-transfers/route';
import { POST as TRANSFER_RECEIVE } from '@/app/api/v1/stock-transfers/[transferId]/receipt/route';
import { POST as DISCREPANCY } from '@/app/api/v1/stock-transfers/[transferId]/discrepancy-resolution/route';
import { POST as WRITE_OFF_DECIDE } from '@/app/api/v1/stock-transfer-settlements/[settlementId]/decision/route';
import { GET as SETTLEMENT_LIST } from '@/app/api/v1/stock-transfer-settlements/route';
import { GET as SETTLEMENT_READ } from '@/app/api/v1/stock-transfer-settlements/[settlementId]/route';

let admin: Pool;
/** A tenant-A unit of VOLUME, so a pack-to-litre conversion crosses dimensions. */
let LITRE = '';

type Handler = (request: Request) => Promise<Response>;
type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const request = (method: string, path: string, body: unknown, key: string): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const post = (handler: Handler, path: string, body: unknown, key: string = randomUUID()) =>
  handler(request('POST', path, body, key));

const postAt = <P>(
  handler: ParamHandler<P>,
  path: string,
  params: P,
  body: unknown,
  key: string = randomUUID()
) => handler(request('POST', path, body, key), { params: Promise.resolve(params) });

const get = (handler: Handler, path: string) =>
  handler(new Request(`http://localhost${path}`, { method: 'GET' }));

const getAt = <P>(handler: ParamHandler<P>, path: string, params: P) =>
  handler(new Request(`http://localhost${path}`, { method: 'GET' }), {
    params: Promise.resolve(params),
  });

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface Problem {
  readonly code: string;
  readonly violations?: readonly { path: string; rule: string }[];
  readonly materialDraw?: {
    readonly allowance: string | null;
    readonly alreadyCommitted: string;
    readonly requested: string | null;
    readonly reason: string;
  };
}

interface RequirementBody {
  readonly id: string;
  readonly status: string;
  readonly approvalRequiredReason: string | null;
  readonly basis: string;
  readonly specificationId: string | null;
  readonly allowanceQuantity: string | null;
  readonly effectiveAllowance: string | null;
  readonly requestedQuantity: string;
  readonly reservedQuantity: string;
  readonly issuedQuantity: string;
  readonly committedQuantity: string;
  readonly remainingQuantity: string | null;
  readonly uomId: string | null;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly exceptions: readonly { id: string; status: string }[];
}

interface ExceptionBody {
  readonly id: string;
  readonly status: string;
  readonly additionalQuantity: string;
  readonly resultingAllowance: string | null;
}

interface TransferBody {
  readonly id: string;
  readonly status: string;
  readonly inTransit: boolean;
  readonly receivedQuantity: string | null;
  readonly resolvedQuantity: string;
  readonly outstandingQuantity: string;
  readonly transitLocationId: string;
}

interface SettlementBody {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly quantity: string;
  readonly transfer: TransferBody;
  readonly replayed: boolean;
}

const onHandAt = async (itemId: string, locationId: string): Promise<string> =>
  (await balanceOf(itemId, locationId))?.onHand ?? '0.000';

/** An open work order with one service line, and the cell its stock is drawn from. */
async function job(stock = '20'): Promise<{
  readonly workOrderId: string;
  readonly vehicleId: string;
  readonly lineId: string;
  readonly cell: string;
}> {
  const workOrder = await createOpenWorkOrder();
  const line = await admin.query<{ id: string }>(
    `INSERT INTO wo.work_order_service_lines
       (tenant_id, company_id, branch_id, work_order_id, description, created_by)
     VALUES ($1,$2,$3,$4,'Material slice fixture line',$5) RETURNING id`,
    [TENANT_A, workOrder.companyId, workOrder.branchId, workOrder.workOrderId, USER_A]
  );
  const cell = await freshLocation();
  await seedStock({ itemId: ITEM_A, locationId: cell, quantity: stock });
  return {
    workOrderId: workOrder.workOrderId,
    vehicleId: workOrder.vehicleId,
    lineId: line.rows[0]?.id ?? '',
    cell,
  };
}

async function enteredRequirement(
  lineId: string,
  allowance: string,
  options: { readonly uomId?: string; readonly itemId?: string; readonly key?: string } = {}
): Promise<Response> {
  authAs(INV_MATERIAL);
  return post(
    REQUIREMENT_CREATE,
    '/api/v1/material-requirements',
    {
      basis: 'entered',
      serviceLineId: lineId,
      itemId: options.itemId ?? ITEM_A,
      allowanceQuantity: allowance,
      uomId: options.uomId ?? UOM_EACH,
      sourceReference: 'Service manual table 4',
    },
    options.key
  );
}

const decide = (requirementId: string, body: unknown, key?: string) =>
  postAt(
    REQUIREMENT_DECIDE,
    `/api/v1/material-requirements/${requirementId}/approval`,
    { requirementId },
    body,
    key
  );

const readRequirement = (requirementId: string) =>
  getAt(REQUIREMENT_READ, `/api/v1/material-requirements/${requirementId}`, { requirementId });

/** An entered requirement for ITEM_A, approved by a second person. */
async function approvedRequirement(lineId: string, allowance: string): Promise<string> {
  const created = await bodyOf<RequirementBody>(await enteredRequirement(lineId, allowance));
  authAs(INV_MATERIAL_APPROVER);
  const approved = await decide(created.id, { decision: 'approved' });
  expect(approved.status).toBe(200);
  return created.id;
}

const issue = (body: Record<string, unknown>) => post(ISSUE, '/api/v1/stock-issues', body);
const reserve = (body: Record<string, unknown>) =>
  post(RESERVE, '/api/v1/stock-reservations', body);

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  const litre = await admin.query<{ id: string }>(
    `INSERT INTO inv.units_of_measure (scope, tenant_id, code, name, dimension, created_by)
     VALUES ('tenant',$1,'fx_p132_litre','Fixture litre','volume',$2) RETURNING id`,
    [TENANT_A, USER_A]
  );
  LITRE = litre.rows[0]?.id ?? '';
}, 180_000);

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ---------------------------------------------------------------------------
// Unit conversions.
// ---------------------------------------------------------------------------

describe('inv.unit-conversion-set, inv.unit-conversion-list, inv.unit-conversion-retire', () => {
  it('states an exact conversion, restates it as a new row, and retires it once', async () => {
    authAs(INV_MATERIAL);
    const key = randomUUID();
    const body = {
      itemId: ITEM_A_ALT,
      fromUomId: UOM_EACH,
      toUomId: LITRE,
      factor: '0.946000',
      sourceReference: 'Pack label',
    };
    const first = await post(CONVERSION_SET, '/api/v1/unit-conversions', body, key);
    expect(first.status).toBe(201);
    const created = await bodyOf<{ id: string; factor: string; status: string }>(first);
    expect(created.factor).toBe('0.946');
    expect(created.status).toBe('active');
    expect(await auditCountFor('inv.unit_conversion.set', created.id)).toBe(1);

    // The same key replays the first answer rather than stating the factor twice.
    const replay = await post(CONVERSION_SET, '/api/v1/unit-conversions', body, key);
    expect(replay.status).toBe(200);
    expect((await bodyOf<{ id: string }>(replay)).id).toBe(created.id);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_unit_conversions WHERE tenant_id = $1 AND item_id = $2`,
        [TENANT_A, ITEM_A_ALT]
      )
    ).toBe(1);

    // A changed factor is a NEW row; the old one is retired, not rewritten.
    const restated = await bodyOf<{ id: string }>(
      await post(CONVERSION_SET, '/api/v1/unit-conversions', { ...body, factor: '1.5' })
    );
    const live = await bodyOf<{ items: readonly { id: string; status: string }[] }>(
      await get(CONVERSION_LIST, `/api/v1/unit-conversions?itemId=${ITEM_A_ALT}`)
    );
    expect(live.items.map((row) => row.id)).toEqual([restated.id]);
    const all = await bodyOf<{ items: readonly { id: string; status: string }[] }>(
      await get(
        CONVERSION_LIST,
        `/api/v1/unit-conversions?itemId=${ITEM_A_ALT}&includeRetired=true`
      )
    );
    expect(all.items.find((row) => row.id === created.id)?.status).toBe('retired');

    const path = `/api/v1/unit-conversions/${restated.id}/retirement`;
    const retired = await postAt(CONVERSION_RETIRE, path, { conversionId: restated.id }, undefined);
    expect(retired.status).toBe(200);
    expect((await bodyOf<{ status: string; replayed: boolean }>(retired)).replayed).toBe(false);
    const again = await postAt(CONVERSION_RETIRE, path, { conversionId: restated.id }, undefined);
    expect((await bodyOf<{ replayed: boolean }>(again)).replayed).toBe(true);
    expect(await auditCountFor('inv.unit_conversion.retired', restated.id)).toBe(1);

    // Another tenant cannot retire it: not found, not refused.
    authAs(INV_TENANT_B_MATERIAL);
    expect(
      (await postAt(CONVERSION_RETIRE, path, { conversionId: restated.id }, undefined)).status
    ).toBe(404);
  });

  it('refuses a caller without the code, a branch-scoped grant, and a cross-dimension tenant-wide row', async () => {
    const body = {
      fromUomId: UOM_EACH,
      toUomId: LITRE,
      factor: '2',
      sourceReference: 'Data sheet',
    };
    authAs(INV_FULL);
    expect((await post(CONVERSION_SET, '/api/v1/unit-conversions', body)).status).toBe(403);
    // Held, but only in branch A2: a conversion holds in every branch.
    authAs(INV_MATERIAL_SCOPED_A2);
    expect((await post(CONVERSION_SET, '/api/v1/unit-conversions', body)).status).toBe(403);
    // Held tenant-wide, but a pack is a number of litres only for a particular item.
    authAs(INV_MATERIAL);
    const crossing = await post(CONVERSION_SET, '/api/v1/unit-conversions', body);
    expect(crossing.status).toBe(422);
    expect((await bodyOf<Problem>(crossing)).violations?.[0]?.path).toBe('body.itemId');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_unit_conversions
          WHERE tenant_id = $1 AND item_id IS NULL AND to_uom_id = $2`,
        [TENANT_A, LITRE]
      )
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Vehicle service specifications.
// ---------------------------------------------------------------------------

async function tenantMake(): Promise<{ makeId: string; modelId: string }> {
  const tag = randomUUID().slice(0, 8);
  const make = await admin.query<{ id: string }>(
    `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by)
     VALUES ('tenant',$1,$2,$3,$4) RETURNING id`,
    [TENANT_A, `fx_p132_mk_${tag}`, `Fixture make ${tag}`, USER_A]
  );
  const makeId = make.rows[0]?.id ?? '';
  const model = await admin.query<{ id: string }>(
    `INSERT INTO veh.models (scope, tenant_id, make_id, code, name, created_by)
     VALUES ('tenant',$1,$2,$3,$4,$5) RETURNING id`,
    [TENANT_A, makeId, `fx_p132_md_${tag}`, `Fixture model ${tag}`, USER_A]
  );
  return { makeId, modelId: model.rows[0]?.id ?? '' };
}

const specificationBody = (makeId: string, modelId: string) => ({
  makeId,
  modelId,
  modelYearFrom: 2018,
  modelYearTo: 2022,
  serviceCondition: 'oil_change_with_filter',
  itemCategoryId: CATEGORY_A,
  capacity: '4.5',
  uomId: LITRE,
  sourceReference: 'Owner manual, section 8',
});

describe('inv.vehicle-specification-create, inv.vehicle-specification-confirm, inv.vehicle-specification-retire, inv.vehicle-specification-list', () => {
  it('records a capacity unconfirmed, confirms it once, refuses an overlapping confirmation, and retires it', async () => {
    const { makeId, modelId } = await tenantMake();
    authAs(INV_MATERIAL);
    const createKey = randomUUID();
    const created = await post(
      SPECIFICATION_CREATE,
      '/api/v1/vehicle-fluid-specifications',
      specificationBody(makeId, modelId),
      createKey
    );
    expect(created.status).toBe(201);
    const spec = await bodyOf<{ id: string; status: string; capacity: string }>(created);
    expect(spec).toMatchObject({ status: 'recorded', capacity: '4.500' });
    expect(await auditCountFor('inv.vehicle_specification.recorded', spec.id)).toBe(1);
    // A doubled frame replays the record instead of recording the capacity twice.
    const replayed = await post(
      SPECIFICATION_CREATE,
      '/api/v1/vehicle-fluid-specifications',
      specificationBody(makeId, modelId),
      createKey
    );
    expect(replayed.status).toBe(200);
    expect((await bodyOf<{ id: string }>(replayed)).id).toBe(spec.id);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.vehicle_fluid_specifications WHERE make_id = $1`,
        [makeId]
      )
    ).toBe(1);

    const confirmPath = `/api/v1/vehicle-fluid-specifications/${spec.id}/confirmation`;
    const confirmed = await postAt(
      SPECIFICATION_CONFIRM,
      confirmPath,
      { specificationId: spec.id },
      undefined
    );
    expect(confirmed.status).toBe(200);
    expect(await bodyOf<{ status: string; confirmedBy: string }>(confirmed)).toMatchObject({
      status: 'confirmed',
      confirmedBy: INV_MATERIAL.userId,
    });
    const twice = await postAt(
      SPECIFICATION_CONFIRM,
      confirmPath,
      { specificationId: spec.id },
      undefined
    );
    expect((await bodyOf<{ replayed: boolean }>(twice)).replayed).toBe(true);
    expect(await auditCountFor('inv.vehicle_specification.confirmed', spec.id)).toBe(1);

    // A second capacity for the same vehicle and service over overlapping years may be
    // RECORDED, but not confirmed while the first stands.
    const rival = await bodyOf<{ id: string }>(
      await post(SPECIFICATION_CREATE, '/api/v1/vehicle-fluid-specifications', {
        ...specificationBody(makeId, modelId),
        modelYearFrom: 2021,
        modelYearTo: 2024,
        capacity: '5',
      })
    );
    const overlap = await postAt(
      SPECIFICATION_CONFIRM,
      `/api/v1/vehicle-fluid-specifications/${rival.id}/confirmation`,
      { specificationId: rival.id },
      undefined
    );
    expect(overlap.status).toBe(409);

    const listed = await bodyOf<{ items: readonly { id: string }[] }>(
      await get(
        SPECIFICATION_LIST,
        `/api/v1/vehicle-fluid-specifications?makeId=${makeId}&status=confirmed`
      )
    );
    expect(listed.items.map((row) => row.id)).toEqual([spec.id]);

    // Another tenant: not found.
    authAs(INV_TENANT_B_MATERIAL);
    expect(
      (await postAt(SPECIFICATION_CONFIRM, confirmPath, { specificationId: rival.id }, undefined))
        .status
    ).toBe(404);
    expect(
      (
        await postAt(
          SPECIFICATION_RETIRE,
          `/api/v1/vehicle-fluid-specifications/${spec.id}/retirement`,
          { specificationId: spec.id },
          undefined
        )
      ).status
    ).toBe(404);

    authAs(INV_MATERIAL);
    const retirePath = `/api/v1/vehicle-fluid-specifications/${spec.id}/retirement`;
    const retired = await postAt(
      SPECIFICATION_RETIRE,
      retirePath,
      { specificationId: spec.id },
      undefined
    );
    expect(retired.status).toBe(200);
    expect((await bodyOf<{ status: string }>(retired)).status).toBe('retired');
    const again = await postAt(
      SPECIFICATION_RETIRE,
      retirePath,
      { specificationId: spec.id },
      undefined
    );
    expect((await bodyOf<{ replayed: boolean }>(again)).replayed).toBe(true);
    expect(await auditCountFor('inv.vehicle_specification.retired', spec.id)).toBe(1);
  });

  it('refuses a caller without the code and a branch-scoped grant', async () => {
    const { makeId, modelId } = await tenantMake();
    authAs(INV_FULL);
    expect(
      (
        await post(
          SPECIFICATION_CREATE,
          '/api/v1/vehicle-fluid-specifications',
          specificationBody(makeId, modelId)
        )
      ).status
    ).toBe(403);
    authAs(INV_MATERIAL_SCOPED_A2);
    expect(
      (
        await post(
          SPECIFICATION_CREATE,
          '/api/v1/vehicle-fluid-specifications',
          specificationBody(makeId, modelId)
        )
      ).status
    ).toBe(403);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.vehicle_fluid_specifications WHERE make_id = $1`,
        [makeId]
      )
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Material requirements.
// ---------------------------------------------------------------------------

describe('inv.material-requirement-create, inv.material-requirement-approve, inv.material-requirement-read, inv.material-requirement-list', () => {
  it('asks, refuses the requester as approver, approves by a second person, and reports usage', async () => {
    const { lineId, workOrderId } = await job();
    const key = randomUUID();
    const created = await enteredRequirement(lineId, '4', { key });
    expect(created.status).toBe(201);
    const requirement = await bodyOf<RequirementBody>(created);
    expect(requirement).toMatchObject({
      status: 'pending_approval',
      basis: 'entered',
      allowanceQuantity: '4.000',
      effectiveAllowance: '4.000',
      remainingQuantity: '4.000',
      requestedBy: INV_MATERIAL.userId,
    });
    expect(await auditCountFor('inv.material_requirement.requested', requirement.id)).toBe(1);

    // A doubled frame replays the first requirement.
    const replay = await enteredRequirement(lineId, '4', { key });
    expect(replay.status).toBe(200);
    expect((await bodyOf<RequirementBody>(replay)).id).toBe(requirement.id);
    // A second active requirement for the same need on the same line is refused.
    //
    // DEF-T-16: with the reason ON THE WIRE, not only in the status. The problem
    // document is assembled from the catalogue entry and the safe details alone,
    // so before this the service's sentence never left the process and the panel
    // could say nothing but "this change cannot be saved" and a reference. The
    // token names a rule and no record, so it is safe for any caller that got
    // this far.
    const duplicate = await enteredRequirement(lineId, '2');
    expect(duplicate.status).toBe(409);
    const duplicateProblem = await bodyOf<Problem>(duplicate);
    expect(duplicateProblem.code).toBe('ERR-RES-002');
    expect(duplicateProblem.violations).toEqual([
      { path: 'body', rule: 'material_duplicate_demand' },
    ]);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.material_requirements WHERE service_line_id = $1`,
        [lineId]
      )
    ).toBe(1);

    // The requester may not approve, and a caller without the code may not either.
    authAs(INV_MATERIAL);
    const ownDecision = await decide(requirement.id, { decision: 'approved' });
    expect(ownDecision.status).toBe(409);
    // DEF-T-16, the second rule the same mapping publishes: the refusal names
    // the separation it enforces rather than leaving the status to speak.
    expect((await bodyOf<Problem>(ownDecision)).violations).toEqual([
      { path: 'body', rule: 'material_separation_of_duties' },
    ]);
    authAs(INV_FULL);
    expect((await decide(requirement.id, { decision: 'approved' })).status).toBe(403);
    authAs(INV_TENANT_B_MATERIAL);
    expect((await decide(requirement.id, { decision: 'approved' })).status).toBe(404);

    authAs(INV_MATERIAL_APPROVER);
    const approveKey = randomUUID();
    const approved = await decide(requirement.id, { decision: 'approved' }, approveKey);
    expect(approved.status).toBe(200);
    expect(await bodyOf<RequirementBody>(approved)).toMatchObject({
      status: 'approved',
      approvedBy: INV_MATERIAL_APPROVER.userId,
    });
    const approvedReplay = await decide(requirement.id, { decision: 'approved' }, approveKey);
    expect(approvedReplay.status).toBe(200);
    expect(await auditCountFor('inv.material_requirement.approved', requirement.id)).toBe(1);

    const read = await readRequirement(requirement.id);
    expect(read.status).toBe(200);
    expect((await bodyOf<RequirementBody>(read)).status).toBe('approved');

    const listed = await bodyOf<{ items: readonly { id: string }[] }>(
      await get(
        REQUIREMENT_LIST,
        `/api/v1/material-requirements?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&workOrderId=${workOrderId}`
      )
    );
    expect(listed.items.map((row) => row.id)).toEqual([requirement.id]);

    // Isolation: the authority held in branch A2 does not read branch A1, and another
    // tenant cannot see the requirement at all.
    authAs(INV_MATERIAL_SCOPED_A2);
    expect(
      (
        await get(
          REQUIREMENT_LIST,
          `/api/v1/material-requirements?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`
        )
      ).status
    ).toBe(403);
    authAs(INV_TENANT_B_MATERIAL);
    expect((await readRequirement(requirement.id)).status).toBe(404);
  });

  it('rejects with a reason, and refuses a caller without the request code', async () => {
    const { lineId } = await job();
    authAs(INV_FULL);
    expect(
      (
        await post(REQUIREMENT_CREATE, '/api/v1/material-requirements', {
          basis: 'entered',
          serviceLineId: lineId,
          itemId: ITEM_A,
          allowanceQuantity: '1',
          uomId: UOM_EACH,
          sourceReference: 'Manual',
        })
      ).status
    ).toBe(403);

    const requirement = await bodyOf<RequirementBody>(await enteredRequirement(lineId, '3'));
    authAs(INV_MATERIAL_APPROVER);
    expect((await decide(requirement.id, { decision: 'rejected' })).status).toBe(422);
    const rejected = await decide(requirement.id, {
      decision: 'rejected',
      reason: 'Not needed for this service',
    });
    expect(rejected.status).toBe(200);
    expect((await bodyOf<RequirementBody>(rejected)).status).toBe('rejected');
    expect(await auditCountFor('inv.material_requirement.rejected', requirement.id)).toBe(1);
  });

  it('stores a missing specification as approval required, and derives the allowance once one is confirmed', async () => {
    const { lineId, vehicleId } = await job();
    authAs(INV_MATERIAL);
    const body = {
      basis: 'specification',
      serviceLineId: lineId,
      itemCategoryId: CATEGORY_A,
      serviceCondition: 'oil_change_with_filter',
    };
    const missing = await bodyOf<RequirementBody>(
      await post(REQUIREMENT_CREATE, '/api/v1/material-requirements', body)
    );
    expect(missing).toMatchObject({
      status: 'approval_required',
      approvalRequiredReason: 'missing_specification',
      allowanceQuantity: null,
      remainingQuantity: null,
    });
    // Nothing to approve.
    authAs(INV_MATERIAL_APPROVER);
    expect((await decide(missing.id, { decision: 'approved' })).status).toBe(409);

    // A confirmed specification for this vehicle, on a second line.
    const { makeId, modelId } = await tenantMake();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await client.query(
        `UPDATE veh.vehicles SET make_id = $1, model_id = $2, model_year = 2020 WHERE id = $3`,
        [makeId, modelId, vehicleId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    authAs(INV_MATERIAL);
    const spec = await bodyOf<{ id: string }>(
      await post(
        SPECIFICATION_CREATE,
        '/api/v1/vehicle-fluid-specifications',
        specificationBody(makeId, modelId)
      )
    );
    await postAt(
      SPECIFICATION_CONFIRM,
      `/api/v1/vehicle-fluid-specifications/${spec.id}/confirmation`,
      { specificationId: spec.id },
      undefined
    );
    const line = await admin.query<{ id: string }>(
      `INSERT INTO wo.work_order_service_lines
         (tenant_id, company_id, branch_id, work_order_id, description, created_by)
       SELECT tenant_id, company_id, branch_id, work_order_id, 'Second fixture line', $2
         FROM wo.work_order_service_lines WHERE id = $1 RETURNING id`,
      [lineId, USER_A]
    );
    const derived = await bodyOf<RequirementBody>(
      await post(REQUIREMENT_CREATE, '/api/v1/material-requirements', {
        ...body,
        serviceLineId: line.rows[0]?.id,
      })
    );
    expect(derived).toMatchObject({
      status: 'pending_approval',
      basis: 'specification',
      specificationId: spec.id,
      allowanceQuantity: '4.500',
      uomId: LITRE,
    });
  });
});

// ---------------------------------------------------------------------------
// Draws: the existing reservation and issue paths, governed.
// ---------------------------------------------------------------------------

describe('work-order draws measured against the approved requirement', () => {
  it('requires the link, issues within the allowance, and refuses the excess with the figures', async () => {
    const { workOrderId, lineId, cell } = await job();
    const requirementId = await approvedRequirement(lineId, '4');
    authAs(INV_MATERIAL);

    const unlinked = await issue({ workOrderId, itemId: ITEM_A, locationId: cell, quantity: '1' });
    expect(unlinked.status).toBe(422);
    expect((await bodyOf<Problem>(unlinked)).violations?.[0]).toEqual({
      path: 'body.materialRequirementId',
      rule: 'required',
    });

    const first = await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '3',
      materialRequirementId: requirementId,
    });
    expect(first.status).toBe(201);
    expect((await bodyOf<{ materialRequestId: string | null }>(first)).materialRequestId).not.toBe(
      null
    );
    expect(await bodyOf<RequirementBody>(await readRequirement(requirementId))).toMatchObject({
      issuedQuantity: '3.000',
      requestedQuantity: '0.000',
      committedQuantity: '3.000',
      remainingQuantity: '1.000',
    });

    const before = await onHandAt(ITEM_A, cell);
    const excess = await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '2',
      materialRequirementId: requirementId,
    });
    expect(excess.status).toBe(409);
    const problem = await bodyOf<Problem>(excess);
    expect(problem.code).toBe('ERR-INV-001');
    expect(problem.materialDraw).toEqual({
      allowance: '4.000',
      alreadyCommitted: '3.000',
      requested: '2.000',
      reason: 'exceeds_requirement',
    });
    // Nothing moved.
    expect(await onHandAt(ITEM_A, cell)).toBe(before);

    // The same excess as a RESERVATION is refused the same way.
    const reserved = await reserve({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '2',
      materialRequirementId: requirementId,
    });
    expect(reserved.status).toBe(409);
    expect((await bodyOf<Problem>(reserved)).materialDraw?.reason).toBe('exceeds_requirement');
  });

  it('counts a reserved unit once when it is issued, and gives it back when released', async () => {
    const { workOrderId, lineId, cell } = await job();
    const requirementId = await approvedRequirement(lineId, '5');
    authAs(INV_MATERIAL);

    const held = await bodyOf<{ id: string; materialRequestId: string | null }>(
      await reserve({
        workOrderId,
        itemId: ITEM_A,
        locationId: cell,
        quantity: '2',
        materialRequirementId: requirementId,
      })
    );
    expect(held.materialRequestId).not.toBe(null);
    expect(await bodyOf<RequirementBody>(await readRequirement(requirementId))).toMatchObject({
      reservedQuantity: '2.000',
      committedQuantity: '2.000',
    });

    // Issuing the reservation spends nothing more: the units move from reserved to issued.
    const issued = await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '2',
      reservationId: held.id,
    });
    expect(issued.status).toBe(201);
    expect((await bodyOf<{ materialRequestId: string | null }>(issued)).materialRequestId).toBe(
      held.materialRequestId
    );
    expect(await bodyOf<RequirementBody>(await readRequirement(requirementId))).toMatchObject({
      reservedQuantity: '0.000',
      issuedQuantity: '2.000',
      committedQuantity: '2.000',
      remainingQuantity: '3.000',
    });

    // A second reservation, released: the allowance comes back by the act.
    const second = await bodyOf<{ id: string }>(
      await reserve({
        workOrderId,
        itemId: ITEM_A,
        locationId: cell,
        quantity: '3',
        materialRequirementId: requirementId,
      })
    );
    expect(
      (await bodyOf<RequirementBody>(await readRequirement(requirementId))).remainingQuantity
    ).toBe('0.000');
    const released = await postAt(
      RELEASE,
      `/api/v1/stock-reservations/${second.id}/release`,
      { reservationId: second.id },
      { reason: 'Customer postponed' }
    );
    expect(released.status).toBe(200);
    expect(await bodyOf<RequirementBody>(await readRequirement(requirementId))).toMatchObject({
      reservedQuantity: '0.000',
      committedQuantity: '2.000',
      remainingQuantity: '3.000',
    });
  });

  it('refuses a draw on a requirement that is pending, missing a specification, or missing a conversion', async () => {
    const { workOrderId, lineId, cell } = await job();
    authAs(INV_MATERIAL);
    const pending = await bodyOf<RequirementBody>(await enteredRequirement(lineId, '2'));
    const onPending = await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '1',
      materialRequirementId: pending.id,
    });
    expect(onPending.status).toBe(409);
    expect((await bodyOf<Problem>(onPending)).materialDraw).toMatchObject({
      allowance: '2.000',
      alreadyCommitted: '0.000',
      requested: '1.000',
      reason: 'approval_required',
    });

    // An item requirement stated in litres for an item stocked in each, with no
    // conversion between them.
    const second = await job();
    const unconverted = await bodyOf<RequirementBody>(
      await enteredRequirement(second.lineId, '4', { uomId: LITRE })
    );
    expect(unconverted).toMatchObject({
      status: 'approval_required',
      approvalRequiredReason: 'missing_unit_conversion',
    });
    const onUnconverted = await issue({
      workOrderId: second.workOrderId,
      itemId: ITEM_A,
      locationId: second.cell,
      quantity: '1',
      materialRequirementId: unconverted.id,
    });
    expect(onUnconverted.status).toBe(409);
    expect((await bodyOf<Problem>(onUnconverted)).materialDraw).toMatchObject({
      requested: null,
      reason: 'missing_conversion',
    });

    const third = await job();
    authAs(INV_MATERIAL);
    const unspecified = await bodyOf<RequirementBody>(
      await post(REQUIREMENT_CREATE, '/api/v1/material-requirements', {
        basis: 'specification',
        serviceLineId: third.lineId,
        itemId: ITEM_A,
        serviceCondition: 'brake_service',
      })
    );
    const onUnspecified = await reserve({
      workOrderId: third.workOrderId,
      itemId: ITEM_A,
      locationId: third.cell,
      quantity: '1',
      materialRequirementId: unspecified.id,
    });
    expect(onUnspecified.status).toBe(409);
    expect((await bodyOf<Problem>(onUnspecified)).materialDraw).toMatchObject({
      allowance: null,
      reason: 'missing_specification',
    });
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.material_requests WHERE requirement_id = ANY($1)`,
        [[pending.id, unconverted.id, unspecified.id]]
      )
    ).toBe(0);
  });

  it('lets exactly one of two concurrent draws take the last of an allowance', async () => {
    const { workOrderId, lineId, cell } = await job();
    const requirementId = await approvedRequirement(lineId, '1');
    authAs(INV_MATERIAL);
    const draw = () =>
      reserve({
        workOrderId,
        itemId: ITEM_A,
        locationId: cell,
        quantity: '1',
        materialRequirementId: requirementId,
      });
    const statuses = (await Promise.all([draw(), draw()])).map((response) => response.status);
    expect([...statuses].sort()).toEqual([201, 409]);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.material_requests WHERE requirement_id = $1`,
        [requirementId]
      )
    ).toBe(1);
    expect(
      (await bodyOf<RequirementBody>(await readRequirement(requirementId))).committedQuantity
    ).toBe('1.000');
  });
});

// ---------------------------------------------------------------------------
// Exceptions.
// ---------------------------------------------------------------------------

describe('inv.material-exception-create, inv.material-exception-decide', () => {
  it('asks for more with a reason, is decided by a different person, and then allows the draw', async () => {
    const { workOrderId, lineId, cell } = await job();
    const requirementId = await approvedRequirement(lineId, '2');
    authAs(INV_MATERIAL);
    await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '2',
      materialRequirementId: requirementId,
    });

    const path = `/api/v1/material-requirements/${requirementId}/exceptions`;
    authAs(INV_FULL);
    expect(
      (
        await postAt(
          EXCEPTION_CREATE,
          path,
          { requirementId },
          {
            additionalQuantity: '2',
            reason: 'Filter housing leaked',
          }
        )
      ).status
    ).toBe(403);

    authAs(INV_MATERIAL);
    const key = randomUUID();
    const body = { additionalQuantity: '2', reason: 'Filter housing leaked' };
    const created = await postAt(EXCEPTION_CREATE, path, { requirementId }, body, key);
    expect(created.status).toBe(201);
    const exception = await bodyOf<ExceptionBody>(created);
    expect(exception).toMatchObject({ status: 'pending', resultingAllowance: null });
    expect(await auditCountFor('inv.material_exception.requested', exception.id)).toBe(1);
    const replay = await postAt(EXCEPTION_CREATE, path, { requirementId }, body, key);
    expect((await bodyOf<ExceptionBody>(replay)).id).toBe(exception.id);
    authAs(INV_TENANT_B_MATERIAL);
    expect((await postAt(EXCEPTION_CREATE, path, { requirementId }, body)).status).toBe(404);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.material_requirement_exceptions WHERE requirement_id = $1`,
        [requirementId]
      )
    ).toBe(1);
    authAs(INV_MATERIAL);

    // Pending adds nothing.
    const early = await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '1',
      materialRequirementId: requirementId,
    });
    expect(early.status).toBe(409);

    const decisionPath = `/api/v1/material-exceptions/${exception.id}/decision`;
    const decideAs = (key?: string) =>
      postAt(
        EXCEPTION_DECIDE,
        decisionPath,
        { exceptionId: exception.id },
        { decision: 'approved' },
        key
      );
    expect((await decideAs()).status).toBe(409);
    authAs(INV_FULL);
    expect((await decideAs()).status).toBe(403);
    authAs(INV_TENANT_B_MATERIAL);
    expect((await decideAs()).status).toBe(404);
    authAs(INV_MATERIAL_SCOPED_A2);
    expect((await decideAs()).status).toBe(404);

    authAs(INV_MATERIAL_APPROVER);
    const decisionKey = randomUUID();
    const decided = await decideAs(decisionKey);
    expect(decided.status).toBe(200);
    expect(await bodyOf<ExceptionBody>(decided)).toMatchObject({
      status: 'approved',
      resultingAllowance: '4.000',
    });
    // The retried decision replays; the exception is not approved twice.
    const redecided = await decideAs(decisionKey);
    expect(redecided.status).toBe(200);
    expect((await bodyOf<ExceptionBody>(redecided)).resultingAllowance).toBe('4.000');
    expect(await auditCountFor('inv.material_exception.approved', exception.id)).toBe(1);

    authAs(INV_MATERIAL);
    const after = await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '2',
      materialRequirementId: requirementId,
    });
    expect(after.status).toBe(201);
    const read = await bodyOf<RequirementBody>(await readRequirement(requirementId));
    expect(read).toMatchObject({
      effectiveAllowance: '4.000',
      issuedQuantity: '4.000',
      remainingQuantity: '0.000',
    });
    expect(read.exceptions.map((row) => row.status)).toEqual(['approved']);
  });

  it('refuses an exception on a requirement that is not approved', async () => {
    const { lineId } = await job();
    const pending = await bodyOf<RequirementBody>(await enteredRequirement(lineId, '1'));
    const refused = await postAt(
      EXCEPTION_CREATE,
      `/api/v1/material-requirements/${pending.id}/exceptions`,
      { requirementId: pending.id },
      { additionalQuantity: '1', reason: 'More' }
    );
    expect(refused.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Transfers: what arrived, and what did not.
// ---------------------------------------------------------------------------

describe('inv.stock-transfer-receive (partial), inv.stock-transfer-discrepancy-resolve, inv.stock-transfer-write-off-decide', () => {
  async function dispatched(quantity: string): Promise<{
    readonly transfer: TransferBody;
    readonly from: string;
    readonly to: string;
  }> {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '10' });
    authAs(INV_FULL);
    const transfer = await bodyOf<TransferBody>(
      await post(TRANSFER_CREATE, '/api/v1/stock-transfers', {
        itemId: ITEM_A,
        fromLocationId: from,
        toLocationId: to,
        quantity,
      })
    );
    return { transfer, from, to };
  }

  const receive = (transferId: string, quantity: string) =>
    postAt(
      TRANSFER_RECEIVE,
      `/api/v1/stock-transfers/${transferId}/receipt`,
      { transferId },
      { quantity }
    );

  const resolve = (transferId: string, body: unknown, key?: string) =>
    postAt(
      DISCREPANCY,
      `/api/v1/stock-transfers/${transferId}/discrepancy-resolution`,
      { transferId },
      body,
      key
    );

  const decideWriteOff = (settlementId: string, decision: string, key?: string) =>
    postAt(
      WRITE_OFF_DECIDE,
      `/api/v1/stock-transfer-settlements/${settlementId}/decision`,
      { settlementId },
      { decision, reason: 'Counted twice at the dock' },
      key
    );

  it('receives a short delivery, returns part to the origin, and writes off the rest by a second person', async () => {
    const { transfer, from, to } = await dispatched('5');
    const originAfterDispatch = await onHandAt(ITEM_A, from);
    // The transit location is the BRANCH's, shared with every other transfer in it, so
    // what this transfer holds there is asserted as a delta.
    const transitAfterDispatch = await onHandAt(ITEM_A, transfer.transitLocationId);

    const short = await receive(transfer.id, '3');
    expect(short.status).toBe(200);
    expect(await bodyOf<TransferBody>(short)).toMatchObject({
      status: 'partially_received',
      receivedQuantity: '3.000',
      outstandingQuantity: '2.000',
      inTransit: true,
    });
    expect(await onHandAt(ITEM_A, to)).toBe('3.000');
    expect(await auditCountFor('inv.stock_transfer.received', transfer.id)).toBe(1);

    // More than is still in transit is refused.
    expect((await receive(transfer.id, '3')).status).toBe(409);

    const key = randomUUID();
    const returnBody = { kind: 'return_to_origin', quantity: '1', reason: 'Wrong item packed' };
    const returned = await resolve(transfer.id, returnBody, key);
    expect(returned.status).toBe(201);
    const settlement = await bodyOf<SettlementBody>(returned);
    expect(settlement).toMatchObject({ kind: 'return_to_origin', status: 'posted' });
    expect(settlement.transfer.outstandingQuantity).toBe('1.000');
    expect(await onHandAt(ITEM_A, from)).toBe(
      Quantity.parse(originAfterDispatch).plus(Quantity.parse('1')).toString()
    );
    expect(await auditCountFor('inv.stock_transfer.discrepancy_resolved', settlement.id)).toBe(1);
    // A doubled frame replays the settlement instead of returning the unit twice.
    const replay = await resolve(transfer.id, returnBody, key);
    expect(replay.status).toBe(200);
    expect((await bodyOf<SettlementBody>(replay)).id).toBe(settlement.id);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_transfer_settlements
          WHERE transfer_id = $1 AND settlement_kind = 'return_to_origin'`,
        [transfer.id]
      )
    ).toBe(1);

    const writeOff = await bodyOf<SettlementBody>(
      await resolve(transfer.id, { kind: 'write_off', quantity: '1', reason: 'Lost in transit' })
    );
    expect(writeOff).toMatchObject({ kind: 'write_off', status: 'pending' });
    // Pending, it still claims the unit: a receipt of it is refused.
    expect((await receive(transfer.id, '1')).status).toBe(409);

    // The requester may not decide it; a reader may not; another tenant sees nothing.
    expect((await decideWriteOff(writeOff.id, 'approved')).status).toBe(409);
    authAs(INV_READER);
    expect((await decideWriteOff(writeOff.id, 'approved')).status).toBe(403);
    authAs(INV_TENANT_B);
    expect((await decideWriteOff(writeOff.id, 'approved')).status).toBe(404);

    authAs(INV_APPROVER);
    const writeOffKey = randomUUID();
    const approved = await decideWriteOff(writeOff.id, 'approved', writeOffKey);
    expect(approved.status).toBe(200);
    // A retried approval replays: the units leave transit once.
    const reapproved = await decideWriteOff(writeOff.id, 'approved', writeOffKey);
    expect(reapproved.status).toBe(200);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_movements
          WHERE reference_kind = 'transfer_receipt' AND reference_id = $1`,
        [writeOff.id]
      )
    ).toBe(1);
    const decided = await bodyOf<SettlementBody>(approved);
    expect(decided.status).toBe('posted');
    expect(decided.transfer).toMatchObject({
      status: 'settled',
      outstandingQuantity: '0.000',
      inTransit: false,
    });
    expect(await onHandAt(ITEM_A, transfer.transitLocationId)).toBe(
      Quantity.parse(transitAfterDispatch).minus(Quantity.parse('5')).toString()
    );
    expect(await onHandAt(ITEM_A, to)).toBe('3.000');
    expect(await auditCountFor('inv.stock_transfer.write_off_approved', writeOff.id)).toBe(1);
  });

  it('leaves a rejected write-off in transit and refuses another tenant and a reader', async () => {
    const { transfer } = await dispatched('2');
    const transitAfterDispatch = await onHandAt(ITEM_A, transfer.transitLocationId);
    authAs(INV_TENANT_B);
    expect(
      (await resolve(transfer.id, { kind: 'return_to_origin', quantity: '1', reason: 'X' })).status
    ).toBe(404);
    authAs(INV_READER);
    expect(
      (await resolve(transfer.id, { kind: 'return_to_origin', quantity: '1', reason: 'X' })).status
    ).toBe(403);

    authAs(INV_FULL);
    const writeOff = await bodyOf<SettlementBody>(
      await resolve(transfer.id, { kind: 'write_off', quantity: '2', reason: 'Not found' })
    );
    authAs(INV_APPROVER);
    const rejected = await bodyOf<SettlementBody>(await decideWriteOff(writeOff.id, 'rejected'));
    expect(rejected.status).toBe('rejected');
    expect(rejected.transfer).toMatchObject({
      status: 'dispatched',
      outstandingQuantity: '2.000',
    });
    expect(await auditCountFor('inv.stock_transfer.write_off_rejected', writeOff.id)).toBe(1);
    expect(await onHandAt(ITEM_A, transfer.transitLocationId)).toBe(transitAfterDispatch);
  });
});

// ---------------------------------------------------------------------------
// P1-32-PRE-141 — the reads that reach a settlement.
// ---------------------------------------------------------------------------

interface SettlementReadBody {
  readonly id: string;
  readonly transferId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly kind: string;
  readonly quantity: string;
  readonly reason: string | null;
  readonly status: string;
  readonly decision: string | null;
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
}

describe('inv.stock-transfer-settlement-list, inv.stock-transfer-settlement-read', () => {
  async function dispatchedBetween(fromBranch: string, toBranch: string): Promise<string> {
    const from = await freshLocation(fromBranch);
    const to = await freshLocation(toBranch);
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '5' });
    authAs(INV_FULL);
    const created = await post(TRANSFER_CREATE, '/api/v1/stock-transfers', {
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '3',
    });
    expect(created.status).toBe(201);
    return (await bodyOf<{ id: string }>(created)).id;
  }

  const settle = (transferId: string, kind: string, reason: string) =>
    postAt(
      DISCREPANCY,
      `/api/v1/stock-transfers/${transferId}/discrepancy-resolution`,
      { transferId },
      { kind, quantity: '1', reason }
    );

  const list = (query: string) =>
    get(SETTLEMENT_LIST, `/api/v1/stock-transfer-settlements?${query}`);

  const read = (settlementId: string) =>
    getAt(SETTLEMENT_READ, `/api/v1/stock-transfer-settlements/${settlementId}`, {
      settlementId,
    });

  const itemsOf = async (response: Response): Promise<SettlementReadBody[]> =>
    (await bodyOf<{ items: SettlementReadBody[] }>(response)).items;

  it('lists and reads a return and a write-off for the sending and the destination branch, with the decision', async () => {
    const transferId = await dispatchedBetween(BRANCH_A1, BRANCH_A2);
    authAs(INV_FULL);
    const receipt = await postAt(
      TRANSFER_RECEIVE,
      `/api/v1/stock-transfers/${transferId}/receipt`,
      { transferId },
      { quantity: '1' }
    );
    expect(receipt.status).toBe(200);
    const returned = await bodyOf<SettlementBody>(
      await settle(transferId, 'return_to_origin', 'Wrong item packed')
    );
    const writeOff = await bodyOf<SettlementBody>(
      await settle(transferId, 'write_off', 'Lost in transit')
    );

    // The sending branch: both discrepancy settlements, and never the receipt.
    authAs(INV_READER);
    const scope = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&transferId=${transferId}`;
    const sent = await list(scope);
    expect(sent.status).toBe(200);
    const sentItems = await itemsOf(sent);
    expect(sentItems.map((row) => row.id).sort()).toEqual([returned.id, writeOff.id].sort());
    expect(sentItems.map((row) => row.kind)).not.toContain('receipt');

    const pending = await itemsOf(await list(`${scope}&status=pending`));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: writeOff.id,
      transferId,
      itemId: ITEM_A,
      kind: 'write_off',
      quantity: '1.000',
      reason: 'Lost in transit',
      status: 'pending',
      decision: 'pending',
      requestedBy: INV_FULL.userId,
      decidedBy: null,
      decidedAt: null,
    });
    expect(pending[0]?.sku).toEqual(expect.any(String));
    const returns = await itemsOf(await list(`${scope}&kind=return_to_origin`));
    expect(returns.map((row) => [row.id, row.decision])).toEqual([[returned.id, null]]);

    // The destination branch reads the same two, by list and by id.
    authAs(INV_SCOPED_A2);
    const inbound = await list(
      `companyId=${COMPANY_A1}&branchId=${BRANCH_A2}&transferId=${transferId}`
    );
    expect(inbound.status).toBe(200);
    expect((await itemsOf(inbound)).map((row) => row.id).sort()).toEqual(
      [returned.id, writeOff.id].sort()
    );
    const destinationRead = await read(writeOff.id);
    expect(destinationRead.status).toBe(200);
    expect(await bodyOf<SettlementReadBody>(destinationRead)).toMatchObject({
      id: writeOff.id,
      decision: 'pending',
    });

    // Decided by a second person, the rows say who and when.
    authAs(INV_APPROVER);
    const decided = await postAt(
      WRITE_OFF_DECIDE,
      `/api/v1/stock-transfer-settlements/${writeOff.id}/decision`,
      { settlementId: writeOff.id },
      { decision: 'approved', reason: 'Carrier confirmed the loss' }
    );
    expect(decided.status).toBe(200);
    authAs(INV_READER);
    const approved = await itemsOf(await list(`${scope}&status=approved`));
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({
      id: writeOff.id,
      status: 'posted',
      decision: 'approved',
      decidedBy: INV_APPROVER.userId,
    });
    expect(approved[0]?.decidedAt).not.toBeNull();
    expect(await itemsOf(await list(`${scope}&status=pending`))).toEqual([]);
    const sourceRead = await read(writeOff.id);
    expect(sourceRead.status).toBe(200);
    expect(await bodyOf<SettlementReadBody>(sourceRead)).toMatchObject({
      decision: 'approved',
      decidedBy: INV_APPROVER.userId,
    });
  });

  it('refuses a caller without inv.stock.read, a branch that is neither end, and another tenant', async () => {
    const transferId = await dispatchedBetween(BRANCH_A1, BRANCH_A1);
    authAs(INV_FULL);
    const writeOff = await bodyOf<SettlementBody>(
      await settle(transferId, 'write_off', 'Crushed pallet')
    );
    const own = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&transferId=${transferId}`;

    authAs(FULL);
    expect((await list(own)).status).toBe(403);
    expect((await read(writeOff.id)).status).toBe(403);

    // A2 is neither end: its own list does not carry the row, A1's list is refused by
    // the scoped permission check, and the row itself answers NOT FOUND rather than
    // forbidden — a settlement of a transfer between two A1 locations falls outside
    // both SELECT policies for a caller whose branches are A2, so there is no row to
    // refuse. The same answer another tenant gets, for the same reason.
    authAs(INV_SCOPED_A2);
    const elsewhere = await list(
      `companyId=${COMPANY_A1}&branchId=${BRANCH_A2}&transferId=${transferId}`
    );
    expect(elsewhere.status).toBe(200);
    expect(await itemsOf(elsewhere)).toEqual([]);
    expect((await list(own)).status).toBe(403);
    expect((await read(writeOff.id)).status).toBe(404);

    authAs(INV_TENANT_B);
    expect((await read(writeOff.id)).status).toBe(404);
    expect((await list(own)).status).toBe(403);
    const foreign = await list(`companyId=${COMPANY_B1}&branchId=${BRANCH_B1}`);
    expect(foreign.status).toBe(200);
    expect((await itemsOf(foreign)).map((row) => row.id)).not.toContain(writeOff.id);
  });
});

// ---------------------------------------------------------------------------
// P1-32-PRE-132 — every work-order draw is governed.
// ---------------------------------------------------------------------------

describe('a work-order draw with no approved requirement (P1-32-PRE-132)', () => {
  it('refuses a reservation and an issue for an item no requirement covers, with no_requirement, and moves nothing', async () => {
    const { workOrderId, cell } = await job('6');
    authAs(INV_MATERIAL);
    const before = await balanceOf(ITEM_A, cell);
    const figures = {
      allowance: null,
      alreadyCommitted: '0.000',
      requested: null,
      reason: 'no_requirement',
    };

    const reserved = await reserve({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '1',
    });
    expect(reserved.status).toBe(409);
    const reservedProblem = await bodyOf<Problem>(reserved);
    expect(reservedProblem.code).toBe('ERR-INV-001');
    expect(reservedProblem.materialDraw).toEqual(figures);

    const issued = await issue({ workOrderId, itemId: ITEM_A, locationId: cell, quantity: '1' });
    expect(issued.status).toBe(409);
    expect((await bodyOf<Problem>(issued)).materialDraw).toEqual(figures);

    // The draw that used to go straight through: no reservation, no issue, no request,
    // and the shelf untouched.
    expect(await balanceOf(ITEM_A, cell)).toEqual(before);
    expect(
      await countRowsOf(
        `SELECT ((SELECT count(*) FROM inv.stock_reservations WHERE work_order_id = $1)
               + (SELECT count(*) FROM inv.part_issues WHERE work_order_id = $1)
               + (SELECT count(*) FROM inv.material_requests WHERE work_order_id = $1))::text AS n`,
        [workOrderId]
      )
    ).toBe(0);

    // A hold with no work order is not a draw on a job and is outside the rule.
    const counterHold = await reserve({ itemId: ITEM_A, locationId: cell, quantity: '1' });
    expect(counterHold.status).toBe(201);
    expect(
      (await bodyOf<{ materialRequestId: string | null }>(counterHold)).materialRequestId
    ).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// P1-32-PRE-133 — re-check and cancel a requirement; close and cancel a request.
// ---------------------------------------------------------------------------

const recheck = (requirementId: string, key?: string) =>
  postAt(
    REQUIREMENT_RECHECK,
    `/api/v1/material-requirements/${requirementId}/recheck`,
    { requirementId },
    undefined,
    key
  );

const cancelRequirement = (requirementId: string, body: unknown, key?: string) =>
  postAt(
    REQUIREMENT_CANCEL,
    `/api/v1/material-requirements/${requirementId}/cancellation`,
    { requirementId },
    body,
    key
  );

const closeRequest = (requestId: string, body: unknown, key?: string) =>
  postAt(REQUEST_CLOSE, `/api/v1/material-requests/${requestId}/closure`, { requestId }, body, key);

const cancelRequest = (requestId: string, body: unknown, key?: string) =>
  postAt(
    REQUEST_CANCEL,
    `/api/v1/material-requests/${requestId}/cancellation`,
    { requestId },
    body,
    key
  );

interface RequestBody {
  readonly id: string;
  readonly requirementId: string;
  readonly status: string;
  readonly quantity: string;
  readonly cancelReason: string | null;
  readonly closeReason: string | null;
  readonly releasedReservationIds: readonly string[];
  readonly replayed: boolean;
}

describe('inv.material-requirement-recheck', () => {
  it('re-derives a requirement once the specification it lacked is confirmed, and changes nothing when called again', async () => {
    const { lineId, vehicleId } = await job();
    authAs(INV_MATERIAL);
    // The fixture vehicle has no make: the derivation goes through the database
    // function for it too, and stores the missing specification.
    const missing = await bodyOf<RequirementBody>(
      await post(REQUIREMENT_CREATE, '/api/v1/material-requirements', {
        basis: 'specification',
        serviceLineId: lineId,
        itemCategoryId: CATEGORY_A,
        serviceCondition: 'oil_change_with_filter',
      })
    );
    expect(missing).toMatchObject({
      status: 'approval_required',
      approvalRequiredReason: 'missing_specification',
      allowanceQuantity: null,
    });

    authAs(FULL);
    expect((await recheck(missing.id)).status).toBe(403);
    authAs(INV_FULL);
    expect((await recheck(missing.id)).status).toBe(403);
    authAs(INV_TENANT_B_MATERIAL);
    expect((await recheck(missing.id)).status).toBe(404);
    authAs(INV_MATERIAL_SCOPED_A2);
    expect((await recheck(missing.id)).status).toBe(404);

    // Nothing has changed yet: the answer is the same state, and nothing is audited.
    authAs(INV_MATERIAL);
    const unchanged = await recheck(missing.id);
    expect(unchanged.status).toBe(200);
    expect(await bodyOf<RequirementBody>(unchanged)).toMatchObject({
      status: 'approval_required',
      approvalRequiredReason: 'missing_specification',
    });
    expect(await auditCountFor('inv.material_requirement.rechecked', missing.id)).toBe(0);

    // The fact arrives: the vehicle is identified and a specification is confirmed.
    const { makeId, modelId } = await tenantMake();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await client.query(
        `UPDATE veh.vehicles SET make_id = $1, model_id = $2, model_year = 2020 WHERE id = $3`,
        [makeId, modelId, vehicleId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const spec = await bodyOf<{ id: string }>(
      await post(
        SPECIFICATION_CREATE,
        '/api/v1/vehicle-fluid-specifications',
        specificationBody(makeId, modelId)
      )
    );
    await postAt(
      SPECIFICATION_CONFIRM,
      `/api/v1/vehicle-fluid-specifications/${spec.id}/confirmation`,
      { specificationId: spec.id },
      undefined
    );

    const key = randomUUID();
    const moved = await recheck(missing.id, key);
    expect(moved.status).toBe(200);
    expect(await bodyOf<RequirementBody>(moved)).toMatchObject({
      status: 'pending_approval',
      approvalRequiredReason: null,
      specificationId: spec.id,
      allowanceQuantity: '4.500',
      uomId: LITRE,
    });
    expect(await auditCountFor('inv.material_requirement.rechecked', missing.id)).toBe(1);
    // The doubled frame replays; a later call finds nothing to re-check.
    expect((await recheck(missing.id, key)).status).toBe(200);
    const again = await recheck(missing.id);
    expect(again.status).toBe(200);
    expect((await bodyOf<RequirementBody>(again)).status).toBe('pending_approval');
    expect(await auditCountFor('inv.material_requirement.rechecked', missing.id)).toBe(1);
  });
});

describe('inv.material-requirement-cancel', () => {
  it('refuses while quantity is committed, cancels once it is not, and allows no draw after', async () => {
    const { workOrderId, lineId, cell } = await job();
    const requirementId = await approvedRequirement(lineId, '5');
    authAs(INV_MATERIAL);
    const held = await bodyOf<{ id: string; materialRequestId: string }>(
      await reserve({
        workOrderId,
        itemId: ITEM_A,
        locationId: cell,
        quantity: '2',
        materialRequirementId: requirementId,
      })
    );

    const reason = { reason: 'Customer declined the service' };
    expect((await cancelRequirement(requirementId, {})).status).toBe(422);
    authAs(INV_FULL);
    expect((await cancelRequirement(requirementId, reason)).status).toBe(403);
    authAs(INV_TENANT_B_MATERIAL);
    expect((await cancelRequirement(requirementId, reason)).status).toBe(404);

    // Two units are reserved against it: the cancellation is refused and nothing moves.
    authAs(INV_MATERIAL);
    const refused = await cancelRequirement(requirementId, reason);
    expect(refused.status).toBe(409);
    expect((await bodyOf<RequirementBody>(await readRequirement(requirementId))).status).toBe(
      'approved'
    );
    expect(await reservationStatusOf(held.id)).toBe('active');

    // Released, nothing is committed any more, and the cancellation goes through once.
    await postAt(
      RELEASE,
      `/api/v1/stock-reservations/${held.id}/release`,
      { reservationId: held.id },
      { reason: 'Customer declined' }
    );
    const key = randomUUID();
    const cancelled = await cancelRequirement(requirementId, reason, key);
    expect(cancelled.status).toBe(200);
    expect(await bodyOf<RequirementBody>(cancelled)).toMatchObject({
      status: 'cancelled',
      committedQuantity: '0.000',
    });
    expect((await cancelRequirement(requirementId, reason, key)).status).toBe(200);
    expect((await cancelRequirement(requirementId, reason)).status).toBe(200);
    expect(await auditCountFor('inv.material_requirement.cancelled', requirementId)).toBe(1);

    // A cancelled requirement still governs the item and allows no draw.
    const draw = await issue({
      workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '1',
      materialRequirementId: requirementId,
    });
    expect(draw.status).toBe(409);
    expect((await bodyOf<Problem>(draw)).materialDraw?.reason).toBe('approval_required');
  });
});

describe('inv.material-request-close, inv.material-request-cancel', () => {
  it('cancels a request with a reason, releasing its reservation once, and closes another', async () => {
    const { workOrderId, lineId, cell } = await job();
    const requirementId = await approvedRequirement(lineId, '5');
    authAs(INV_MATERIAL);
    const first = await bodyOf<{ id: string; materialRequestId: string }>(
      await reserve({
        workOrderId,
        itemId: ITEM_A,
        locationId: cell,
        quantity: '3',
        materialRequirementId: requirementId,
      })
    );
    const requestId = first.materialRequestId;
    expect(
      (await bodyOf<RequirementBody>(await readRequirement(requirementId))).committedQuantity
    ).toBe('3.000');

    const reason = { reason: 'Job re-scoped' };
    expect((await cancelRequest(requestId, {})).status).toBe(422);
    authAs(INV_FULL);
    expect((await cancelRequest(requestId, reason)).status).toBe(403);
    expect((await closeRequest(requestId, {})).status).toBe(403);
    authAs(INV_TENANT_B_MATERIAL);
    expect((await cancelRequest(requestId, reason)).status).toBe(404);
    expect((await closeRequest(requestId, {})).status).toBe(404);
    authAs(INV_MATERIAL_SCOPED_A2);
    expect((await cancelRequest(requestId, reason)).status).toBe(404);
    expect(await reservationStatusOf(first.id)).toBe('active');

    authAs(INV_MATERIAL);
    const key = randomUUID();
    const cancelled = await cancelRequest(requestId, reason, key);
    expect(cancelled.status).toBe(200);
    expect(await bodyOf<RequestBody>(cancelled)).toMatchObject({
      id: requestId,
      requirementId,
      status: 'cancelled',
      cancelReason: 'Job re-scoped',
      releasedReservationIds: [first.id],
      replayed: false,
    });
    expect(await reservationStatusOf(first.id)).toBe('released');
    expect(await balanceOf(ITEM_A, cell)).toMatchObject({ reserved: '0.000' });
    expect(await bodyOf<RequirementBody>(await readRequirement(requirementId))).toMatchObject({
      committedQuantity: '0.000',
      remainingQuantity: '5.000',
    });
    expect(await auditCountFor('inv.material_request.cancelled', requestId)).toBe(1);
    expect(await auditCountFor('inv.stock.reservation_released', first.id)).toBe(1);
    expect(await outboxCountFor(`stock.reservation.released:${first.id}`)).toBe(1);

    // The doubled frame replays; a fresh call says nothing changed; closing it now is refused.
    expect((await cancelRequest(requestId, reason, key)).status).toBe(200);
    const again = await cancelRequest(requestId, reason);
    expect(again.status).toBe(200);
    expect(await bodyOf<RequestBody>(again)).toMatchObject({
      status: 'cancelled',
      releasedReservationIds: [],
      replayed: true,
    });
    expect(await auditCountFor('inv.material_request.cancelled', requestId)).toBe(1);
    expect((await closeRequest(requestId, {})).status).toBe(409);

    // Closing a second request releases what it holds the same way.
    const second = await bodyOf<{ id: string; materialRequestId: string }>(
      await reserve({
        workOrderId,
        itemId: ITEM_A,
        locationId: cell,
        quantity: '2',
        materialRequirementId: requirementId,
      })
    );
    const closeKey = randomUUID();
    const closeBody = { reason: 'Part fitted from stock' };
    const closed = await closeRequest(second.materialRequestId, closeBody, closeKey);
    expect(closed.status).toBe(200);
    expect(await bodyOf<RequestBody>(closed)).toMatchObject({
      status: 'closed',
      closeReason: 'Part fitted from stock',
      releasedReservationIds: [second.id],
      replayed: false,
    });
    expect(await reservationStatusOf(second.id)).toBe('released');
    // The doubled frame replays the first answer and releases nothing twice.
    const closedAgain = await closeRequest(second.materialRequestId, closeBody, closeKey);
    expect(closedAgain.status).toBe(200);
    expect((await bodyOf<RequestBody>(closedAgain)).releasedReservationIds).toEqual([second.id]);
    expect(await auditCountFor('inv.material_request.closed', second.materialRequestId)).toBe(1);
    expect(await auditCountFor('inv.stock.reservation_released', second.id)).toBe(1);
    expect(
      (await bodyOf<RequirementBody>(await readRequirement(requirementId))).committedQuantity
    ).toBe('0.000');
  });
});

// ---------------------------------------------------------------------------
// Authorization and tenant isolation, operation by operation.
// ---------------------------------------------------------------------------

describe('every material, conversion and specification operation refuses a caller without its code and another tenant', () => {
  it('answers 403 without the code and 404 or nothing across the tenant boundary, and writes nothing', async () => {
    const { workOrderId, lineId, cell } = await job();
    const approvedId = await approvedRequirement(lineId, '4');
    authAs(INV_MATERIAL);
    const secondLine = await admin.query<{ id: string }>(
      `INSERT INTO wo.work_order_service_lines
         (tenant_id, company_id, branch_id, work_order_id, description, created_by)
       SELECT tenant_id, company_id, branch_id, work_order_id, 'Isolation fixture line', $2
         FROM wo.work_order_service_lines WHERE id = $1 RETURNING id`,
      [lineId, USER_A]
    );
    const pending = await bodyOf<RequirementBody>(
      await enteredRequirement(secondLine.rows[0]?.id ?? '', '1', { itemId: ITEM_A_ALT })
    );
    const exception = await bodyOf<ExceptionBody>(
      await postAt(
        EXCEPTION_CREATE,
        `/api/v1/material-requirements/${approvedId}/exceptions`,
        { requirementId: approvedId },
        { additionalQuantity: '1', reason: 'Seal replaced as well' }
      )
    );
    const held = await bodyOf<{ materialRequestId: string }>(
      await reserve({
        workOrderId,
        itemId: ITEM_A,
        locationId: cell,
        quantity: '1',
        materialRequirementId: approvedId,
      })
    );
    const { makeId, modelId } = await tenantMake();
    const spec = await bodyOf<{ id: string }>(
      await post(
        SPECIFICATION_CREATE,
        '/api/v1/vehicle-fluid-specifications',
        specificationBody(makeId, modelId)
      )
    );
    const conversion = await bodyOf<{ id: string }>(
      await post(CONVERSION_SET, '/api/v1/unit-conversions', {
        itemId: ITEM_A_ALT,
        fromUomId: UOM_EACH,
        toUomId: LITRE,
        factor: '0.5',
        sourceReference: 'Isolation fixture label',
      })
    );
    expect(conversion.id).toBeDefined();

    const scope = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;
    const cases: readonly {
      readonly id: string;
      readonly call: () => Promise<Response>;
      readonly noCode: Principal;
      /** The status tenant B receives; `list` means 200 with none of tenant A's rows. */
      readonly otherTenant: number | 'list';
      readonly tenantARow?: string;
    }[] = [
      {
        id: 'inv.unit-conversion-list',
        call: () => get(CONVERSION_LIST, `/api/v1/unit-conversions?itemId=${ITEM_A_ALT}`),
        noCode: FULL,
        otherTenant: 'list',
        tenantARow: conversion.id,
      },
      {
        id: 'inv.unit-conversion-set',
        call: () =>
          post(CONVERSION_SET, '/api/v1/unit-conversions', {
            itemId: ITEM_A_ALT,
            fromUomId: UOM_EACH,
            toUomId: LITRE,
            factor: '0.25',
            sourceReference: 'Refused label',
          }),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.unit-conversion-retire',
        call: () =>
          postAt(
            CONVERSION_RETIRE,
            `/api/v1/unit-conversions/${conversion.id}/retirement`,
            { conversionId: conversion.id },
            undefined
          ),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.vehicle-specification-list',
        call: () =>
          get(SPECIFICATION_LIST, `/api/v1/vehicle-fluid-specifications?makeId=${makeId}`),
        noCode: FULL,
        otherTenant: 'list',
        tenantARow: spec.id,
      },
      {
        id: 'inv.vehicle-specification-create',
        call: () =>
          post(
            SPECIFICATION_CREATE,
            '/api/v1/vehicle-fluid-specifications',
            specificationBody(makeId, modelId)
          ),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.vehicle-specification-confirm',
        call: () =>
          postAt(
            SPECIFICATION_CONFIRM,
            `/api/v1/vehicle-fluid-specifications/${spec.id}/confirmation`,
            { specificationId: spec.id },
            undefined
          ),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.vehicle-specification-retire',
        call: () =>
          postAt(
            SPECIFICATION_RETIRE,
            `/api/v1/vehicle-fluid-specifications/${spec.id}/retirement`,
            { specificationId: spec.id },
            undefined
          ),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-requirement-list',
        call: () => get(REQUIREMENT_LIST, `/api/v1/material-requirements?${scope}`),
        noCode: FULL,
        otherTenant: 403,
      },
      {
        id: 'inv.material-requirement-read',
        call: () => readRequirement(approvedId),
        noCode: FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-requirement-create',
        // Posted directly: `enteredRequirement` authenticates as the requester itself.
        call: () =>
          post(REQUIREMENT_CREATE, '/api/v1/material-requirements', {
            basis: 'entered',
            serviceLineId: secondLine.rows[0]?.id,
            itemId: ITEM_A,
            allowanceQuantity: '2',
            uomId: UOM_EACH,
            sourceReference: 'Refused manual',
          }),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-requirement-approve',
        call: () => decide(pending.id, { decision: 'approved' }),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-requirement-recheck',
        call: () => recheck(pending.id),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-requirement-cancel',
        call: () => cancelRequirement(pending.id, { reason: 'Refused' }),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-exception-create',
        call: () =>
          postAt(
            EXCEPTION_CREATE,
            `/api/v1/material-requirements/${approvedId}/exceptions`,
            { requirementId: approvedId },
            { additionalQuantity: '9', reason: 'Refused' }
          ),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-exception-decide',
        call: () =>
          postAt(
            EXCEPTION_DECIDE,
            `/api/v1/material-exceptions/${exception.id}/decision`,
            { exceptionId: exception.id },
            { decision: 'approved' }
          ),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-request-close',
        call: () => closeRequest(held.materialRequestId, {}),
        noCode: INV_FULL,
        otherTenant: 404,
      },
      {
        id: 'inv.material-request-cancel',
        call: () => cancelRequest(held.materialRequestId, { reason: 'Refused' }),
        noCode: INV_FULL,
        otherTenant: 404,
      },
    ];

    // Every row an operation above could write or change, with its state.
    const footprint = async (): Promise<string> =>
      (
        await admin.query<{ snapshot: string }>(
          `SELECT concat_ws(' | ',
                    (SELECT string_agg(status, ',' ORDER BY id) FROM inv.material_requirements WHERE work_order_id = $1),
                    (SELECT string_agg(e.status, ',' ORDER BY e.id) FROM inv.material_requirement_exceptions e
                       JOIN inv.material_requirements r ON r.id = e.requirement_id WHERE r.work_order_id = $1),
                    (SELECT string_agg(status, ',' ORDER BY id) FROM inv.material_requests WHERE work_order_id = $1),
                    (SELECT string_agg(status, ',' ORDER BY id) FROM inv.vehicle_fluid_specifications WHERE make_id = $2),
                    (SELECT string_agg(status || ':' || factor::text, ',' ORDER BY id)
                       FROM inv.item_unit_conversions WHERE item_id = $3 AND status = 'active')) AS snapshot`,
          [workOrderId, makeId, ITEM_A_ALT]
        )
      ).rows[0]?.snapshot ?? '';
    const before = await footprint();
    expect(before.split(' | ')).toHaveLength(5);

    for (const operation of cases) {
      authAs(operation.noCode);
      expect((await operation.call()).status, `${operation.id} without its code`).toBe(403);

      authAs(INV_TENANT_B_MATERIAL);
      const crossing = await operation.call();
      if (operation.otherTenant === 'list') {
        expect(crossing.status, `${operation.id} from another tenant`).toBe(200);
        const listed = await bodyOf<{ items: readonly { id: string }[] }>(crossing);
        expect(
          listed.items.map((row) => row.id),
          `${operation.id} leaked`
        ).not.toContain(operation.tenantARow);
      } else {
        expect(crossing.status, `${operation.id} from another tenant`).toBe(operation.otherTenant);
      }
    }
    expect(await footprint()).toBe(before);
  });
});
