import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The delivery ADAPTERS (P1-31).
 *
 * The rendering tests replace this module wholesale and the backend proof calls
 * the routes directly, so neither says what request an adapter builds. That is
 * asserted HERE, with only the transport replaced.
 *
 * The properties this file protects: every read names its delivery in the path
 * and reaches the operation the screen claims it does; the three paged reads
 * send the cursor they were given and no scope of their own; a refusal arrives
 * as a refusal rather than as an empty result; every write sends the body its
 * route declares and nothing besides; the completion quotes the version the
 * ELIGIBILITY read published and no other; and a stale version is re-attempted
 * exactly once, against a version that was read again rather than guessed.
 *
 * The ready-for-delivery queue (FE-001) is a separate module with a separate
 * contract and is asserted at the end of this file, because the branch pair it
 * carries and the page ceiling it respects belong to no other read here.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const adapters = await import('@/features/delivery/api');
const {
  attachSignature,
  completeDelivery,
  createDelivery,
  listChecklistResults,
  listSignatures,
  listStatusHistory,
  readActiveChecklistItems,
  readDelivery,
  readEligibility,
  readReceiver,
  readWorkOrderDelivery,
  recordChecklistResult,
  verifyReceiver,
} = adapters;
const { PAGE_SIZE } = await import('@/features/delivery/delivery-contract');

const { listEmployees } = await import('@/features/delivery/employee-api');
const { listBranches } = await import('@/features/delivery/branch-api');
const { EMPLOYEE_PAGE_SIZE, MAX_EMPLOYEE_PAGE_SIZE, employeePageSize } =
  await import('@/features/delivery/employee-contract');

const { listDeliveryReadiness, readDeliveryReadinessScopes } =
  await import('@/features/delivery/readiness-api');
const { MAX_READINESS_PAGE_SIZE, READINESS_PAGE_SIZE, readinessPageSize } =
  await import('@/features/delivery/readiness-contract');

const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const CURSOR = 'b3JkZXItY3Vyc29y';
const EMPLOYEE_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_BRANCH_ID = '66666666-6666-4666-8666-666666666666';

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-9' });

const emptyPage = { items: [], nextCursor: null, hasMore: false };

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

/** The path the transport was asked for, as one string. */
const requested = () => String(get.mock.calls[0]?.[0]);

describe('every read names its delivery in the path', () => {
  it('reads the delivery record itself', async () => {
    get.mockResolvedValue(ok({ id: DELIVERY_ID, status: 'ready', recordVersion: 2 }));
    const state = await readDelivery(DELIVERY_ID);
    expect(state.status).toBe('ok');
    expect(requested()).toBe(`/api/v1/deliveries/${DELIVERY_ID}`);
  });

  it('reads the release checks under the delivery', async () => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, eligible: true, blockers: [] }));
    await readEligibility(DELIVERY_ID);
    expect(requested()).toBe(`/api/v1/deliveries/${DELIVERY_ID}/eligibility`);
  });

  it('reads the confirmed receiver under the delivery', async () => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, receiver: null }));
    const state = await readReceiver(DELIVERY_ID);
    expect(state.status).toBe('ok');
    // Absence is a 200 with nothing inside, never a 404 — the adapter passes
    // that through rather than turning it into a missing subject.
    if (state.status === 'ok') expect(state.data.receiver).toBeNull();
    expect(requested()).toBe(`/api/v1/deliveries/${DELIVERY_ID}/authorized-receiver`);
  });

  it('reads the live delivery of a work order under the WORK ORDER', async () => {
    get.mockResolvedValue(ok({ workOrderId: WORK_ORDER_ID, delivery: null }));
    const state = await readWorkOrderDelivery(WORK_ORDER_ID);
    expect(state.status).toBe('ok');
    if (state.status === 'ok') expect(state.data.delivery).toBeNull();
    expect(requested()).toBe(`/api/v1/work-orders/${WORK_ORDER_ID}/delivery`);
  });

  it('encodes the identifier it was handed rather than pasting it in', async () => {
    get.mockResolvedValue(ok({ id: 'x' }));
    await readDelivery('a/b c');
    expect(requested()).toBe('/api/v1/deliveries/a%2Fb%20c');
  });
});

describe('the paged reads send the cursor they were given, and a page size', () => {
  const paged = [
    ['signatures', listSignatures, 'signatures'],
    ['checklist results', listChecklistResults, 'checklist-results'],
    ['status history', listStatusHistory, 'status-history'],
  ] as const;

  it.each(paged)('%s: the first page carries no cursor', async (_name, read, segment) => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, items: emptyPage }));
    await read(DELIVERY_ID, null);
    expect(requested()).toBe(
      `/api/v1/deliveries/${DELIVERY_ID}/${segment}?limit=${String(PAGE_SIZE)}`
    );
  });

  it.each(paged)('%s: a further page carries the server’s cursor', async (_name, read, segment) => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, items: emptyPage }));
    await read(DELIVERY_ID, CURSOR);
    const path = requested();
    expect(path.startsWith(`/api/v1/deliveries/${DELIVERY_ID}/${segment}?`)).toBe(true);
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('cursor')).toBe(CURSOR);
    expect(query.get('limit')).toBe(String(PAGE_SIZE));
    // Scope is resolved from the session server-side. A client that asserted it
    // would at best be ignored and at worst believed.
    for (const name of ['companyId', 'branchId', 'tenantId']) {
      expect(query.get(name), name).toBeNull();
    }
  });
});

describe('a refusal arrives as a refusal, never as an empty result', () => {
  it('maps a forbidden read to a denial that carries the reference', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const state = await readEligibility(DELIVERY_ID);
    expect(state.status).toBe('denied');
    expect(state.correlationId).toBe('corr-9');
  });

  it('maps a missing subject to not-found rather than to an empty ledger', async () => {
    get.mockResolvedValue(failure('not-found'));
    const state = await listStatusHistory(DELIVERY_ID, null);
    expect(state.status).toBe('not-found');
  });

  it('maps an ended session to expired before any request is made', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await readDelivery(DELIVERY_ID);
    expect(state.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });

  it('maps a rate limit to unavailable, because a 429 is not a fault', async () => {
    get.mockResolvedValue(failure('rate-limited'));
    const state = await listSignatures(DELIVERY_ID, null);
    expect(state.status).toBe('unavailable');
  });
});

describe('a read is still only a read', () => {
  it('makes no write request for any of the seven reads', async () => {
    get.mockResolvedValue(ok({}));
    for (const read of [
      () => readDelivery(DELIVERY_ID),
      () => readEligibility(DELIVERY_ID),
      () => readReceiver(DELIVERY_ID),
      () => readWorkOrderDelivery(WORK_ORDER_ID),
      () => listSignatures(DELIVERY_ID, null),
      () => listChecklistResults(DELIVERY_ID, null),
      () => listStatusHistory(DELIVERY_ID, null),
    ]) {
      await read();
    }
    expect(get).toHaveBeenCalledTimes(7);
    // Every write in this application goes through `send`. A read that acquired
    // one — a "refresh" that recorded something, say — fails here first.
    expect(send).not.toHaveBeenCalled();
  });
});

/* -- the checklist configuration ------------------------------------------- */

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INACTIVE_TEMPLATE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const templatePage = (items: readonly unknown[], over: Record<string, unknown> = {}) => ({
  templates: { items, nextCursor: null, hasMore: false, ...over },
});

const template = (id: string, status: string) => ({
  id,
  companyId: '11111111-1111-4111-8111-111111111111',
  templateCode: 'HANDOVER',
  name: 'Handover checks',
  status,
  recordVersion: 1,
});

describe('the checklist a handover is worked through is ASSEMBLED, and only from active templates', () => {
  it('reads the list, then each ACTIVE template, and skips the ones not in use', async () => {
    get.mockResolvedValueOnce(
      ok(
        templatePage([template(TEMPLATE_ID, 'active'), template(INACTIVE_TEMPLATE_ID, 'inactive')])
      )
    );
    get.mockResolvedValueOnce(
      ok({
        template: template(TEMPLATE_ID, 'active'),
        items: [
          {
            id: 'item-1',
            templateId: TEMPLATE_ID,
            itemCode: 'FUEL',
            label: 'Fuel level agreed',
            isMandatory: true,
            sortOrder: 1,
            recordVersion: 1,
          },
        ],
      })
    );

    const state = await readActiveChecklistItems();
    expect(state.status).toBe('ok');
    if (state.status === 'ok') {
      expect(state.data.templates).toHaveLength(1);
      expect(state.data.templateCount).toBe(2);
    }
    // Two requests, not three: the template that is not in use is never opened.
    expect(get).toHaveBeenCalledTimes(2);
    expect(String(get.mock.calls[0]?.[0])).toContain('/api/v1/delivery-checklist-templates?');
    expect(String(get.mock.calls[1]?.[0])).toBe(
      `/api/v1/delivery-checklist-templates/${TEMPLATE_ID}`
    );
  });

  it('reports a refusal instead of returning the part it managed to read', async () => {
    get.mockResolvedValueOnce(ok(templatePage([template(TEMPLATE_ID, 'active')])));
    get.mockResolvedValueOnce(failure('forbidden'));
    const state = await readActiveChecklistItems();
    // Not `ok` with an empty checklist. An operator handed a short checklist
    // works through it and believes they have finished.
    expect(state.status).toBe('denied');
  });
});

/* -- the writes ------------------------------------------------------------ */

const PARTNER_ID = '88888888-8888-4888-8888-888888888888';
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const sent = (index = 0) => send.mock.calls[index] ?? [];
const refused = (kind: string, code?: string) => ({
  ok: false as const,
  kind,
  problem: code === undefined ? null : { code },
  correlationId: 'corr-9',
});

/**
 * A refusal carrying a field-level violation.
 *
 * `refused` above builds the code alone, which is all the other writes branch
 * on. The handover start needs the RULE as well: one code carries two causes
 * there, and the violation list is the only machine-readable statement of which.
 */
const refusedWithRule = (kind: string, code: string, rule: string) => ({
  ok: false as const,
  kind,
  problem: { code, violations: [{ path: 'body.deliveringEmployeeId', rule }] },
  correlationId: 'corr-9',
});

describe('every write sends the body its route declares, and nothing besides', () => {
  it('opens a handover with the work order and the chosen person, and nothing else', async () => {
    send.mockResolvedValue(
      ok({
        id: DELIVERY_ID,
        workOrderId: WORK_ORDER_ID,
        deliveringEmployeeId: EMPLOYEE_ID,
        deliveringEmployeeDisplayName: 'Maryam Haddad',
        status: 'ready',
        recordVersion: 1,
      })
    );
    const state = await createDelivery({
      workOrderId: WORK_ORDER_ID,
      deliveringEmployeeId: EMPLOYEE_ID,
    });
    expect(state.status).toBe('success');
    expect(sent()[0]).toBe('POST');
    expect(sent()[1]).toBe('/api/v1/deliveries');
    // The vehicle and the reception visit are DERIVED by the service from the
    // work order, so a body that named either would be refused by a trigger
    // whose message this platform does not echo.
    expect(sent()[2]).toEqual({
      workOrderId: WORK_ORDER_ID,
      deliveringEmployeeId: EMPLOYEE_ID,
    });
    // The name shown afterwards is the SERVER's stamp, not the request's echo.
    expect(state.created?.deliveringEmployeeDisplayName).toBe('Maryam Haddad');
  });

  it('mints no retry key of its own — the transport reads that from the contract', async () => {
    send.mockResolvedValue(ok({ id: DELIVERY_ID, recordVersion: 1 }));
    await createDelivery({ workOrderId: WORK_ORDER_ID, deliveringEmployeeId: EMPLOYEE_ID });
    // No options argument at all: a key written here would either duplicate the
    // one the transport attaches or be reused across two genuine attempts.
    expect(sent()[3]).toBeUndefined();
    expect(JSON.stringify(sent()[2])).not.toMatch(/idempotency|requestKey|retryKey/i);
  });

  it('carries the CODE and the RULE, which is how one code’s two causes are told apart', async () => {
    send.mockResolvedValueOnce(refusedWithRule('validation', 'ERR-VAL-001', 'inactive_employee'));
    const retired = await createDelivery({
      workOrderId: WORK_ORDER_ID,
      deliveringEmployeeId: EMPLOYEE_ID,
    });
    expect(retired.code).toBe('ERR-VAL-001');
    expect(retired.rule).toBe('inactive_employee');

    send.mockResolvedValueOnce(refusedWithRule('validation', 'ERR-VAL-001', 'custom'));
    const unknown = await createDelivery({
      workOrderId: WORK_ORDER_ID,
      deliveringEmployeeId: EMPLOYEE_ID,
    });
    expect(unknown.code).toBe('ERR-VAL-001');
    expect(unknown.rule).toBe('custom');
  });

  it('carries the conflict code when the work order already has a live handover', async () => {
    send.mockResolvedValue(refused('conflict', 'ERR-RES-002'));
    const state = await createDelivery({
      workOrderId: WORK_ORDER_ID,
      deliveringEmployeeId: EMPLOYEE_ID,
    });
    expect(state.status).toBe('conflict');
    expect(state.code).toBe('ERR-RES-002');
    // A refusal is not a success wearing a code, and nothing was created.
    expect(state.created).toBeUndefined();
  });

  it('reports an ended session without asking the transport for anything', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await createDelivery({
      workOrderId: WORK_ORDER_ID,
      deliveringEmployeeId: EMPLOYEE_ID,
    });
    expect(state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });

  it('confirms a receiver by partner, with no identity reference invented', async () => {
    send.mockResolvedValue(ok({ id: 'receiver-1' }));
    await verifyReceiver(DELIVERY_ID, { receiverPartnerId: PARTNER_ID });
    expect(sent()[1]).toBe(`/api/v1/deliveries/${DELIVERY_ID}/authorized-receiver`);
    expect(sent()[2]).toEqual({ receiverPartnerId: PARTNER_ID });
  });

  it('records a waiver WITH its reason and a pass WITHOUT one', async () => {
    send.mockResolvedValue(ok({ id: 'result-1' }));
    await recordChecklistResult(DELIVERY_ID, {
      templateItemId: 'item-1',
      outcome: 'waived',
      waiverReason: 'Agreed at the counter.',
    });
    expect(sent()[1]).toBe(`/api/v1/deliveries/${DELIVERY_ID}/checklist-results`);
    expect(sent()[2]).toEqual({
      templateItemId: 'item-1',
      outcome: 'waived',
      waiverReason: 'Agreed at the counter.',
    });

    send.mockClear();
    await recordChecklistResult(DELIVERY_ID, { templateItemId: 'item-2', outcome: 'passed' });
    // The constraint is a biconditional: a reason attached to a pass is refused,
    // not ignored, so the field must be absent rather than empty.
    expect(sent()[2]).toEqual({ templateItemId: 'item-2', outcome: 'passed' });
  });

  it('carries the refusal code so a second, different outcome is nameable', async () => {
    send.mockResolvedValue(refused('conflict', 'ERR-INT-001'));
    const state = await recordChecklistResult(DELIVERY_ID, {
      templateItemId: 'item-1',
      outcome: 'failed',
    });
    expect(state.status).toBe('conflict');
    expect(state.code).toBe('ERR-INT-001');
  });

  it('binds a signature by REFERENCE and carries no image field of any kind', async () => {
    send.mockResolvedValue(ok({ id: 'signature-1' }));
    await attachSignature(DELIVERY_ID, {
      signerRole: 'receiver',
      signatureDocumentVersionId: VERSION_ID,
    });
    expect(sent()[1]).toBe(`/api/v1/deliveries/${DELIVERY_ID}/signatures`);
    expect(sent()[2]).toEqual({
      signerRole: 'receiver',
      signatureDocumentVersionId: VERSION_ID,
    });
    expect(JSON.stringify(sent()[2])).not.toMatch(/base64|dataUrl|signatureData/i);
  });
});

describe('the completion quotes the version the release checks published', () => {
  it('sends the reading, the unit and the version guard, and no override by default', async () => {
    send.mockResolvedValue(ok({ recordVersion: 5, replayed: false }));
    const state = await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '120.5',
      odometerUnit: 'km',
    });
    expect(state.status).toBe('success');
    expect(sent()[1]).toBe(`/api/v1/deliveries/${DELIVERY_ID}/completion`);
    expect(sent()[2]).toEqual({ finalOdometerValue: '120.5', odometerUnit: 'km' });
    expect(sent()[3]).toEqual({ ifMatch: 4 });
  });

  it('nests the override under its own field, with the reason it was given', async () => {
    send.mockResolvedValue(ok({ recordVersion: 5 }));
    await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '90',
      overrideReason: 'Settlement agreed in writing with the branch manager.',
    });
    expect(sent()[2]).toEqual({
      finalOdometerValue: '90',
      overrideFinancialBlocker: {
        reason: 'Settlement agreed in writing with the branch manager.',
      },
    });
  });

  it('re-reads the version and re-sends ONCE when the view was stale', async () => {
    send.mockResolvedValueOnce(refused('conflict', 'ERR-CON-001'));
    get.mockResolvedValueOnce(ok({ deliveryId: DELIVERY_ID, recordVersion: 9 }));
    send.mockResolvedValueOnce(ok({ recordVersion: 10 }));

    const state = await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '90',
    });
    expect(state.status).toBe('success');
    expect(send).toHaveBeenCalledTimes(2);
    // The second attempt quotes a version that was READ, not one derived by
    // adding to the first: the record may have moved more than once.
    expect(sent(0)[3]).toEqual({ ifMatch: 4 });
    expect(sent(1)[3]).toEqual({ ifMatch: 9 });
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/deliveries/${DELIVERY_ID}/eligibility`);
  });

  it('reports a SECOND conflict rather than retrying in a loop', async () => {
    send.mockResolvedValue(refused('conflict', 'ERR-CON-001'));
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, recordVersion: 9 }));
    const state = await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '90',
    });
    expect(state.status).toBe('conflict');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the re-read republishes the SAME version', async () => {
    send.mockResolvedValue(refused('conflict', 'ERR-CON-001'));
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, recordVersion: 4 }));
    const state = await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '90',
    });
    // Nothing moved, so the conflict was not a stale view and re-sending the
    // same version would only spend a second refusal.
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.code).toBe('ERR-CON-001');
  });

  it('does not retry a refusal that is not a version conflict', async () => {
    send.mockResolvedValue(refused('conflict', 'ERR-TRN-001'));
    const state = await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '90',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(state.code).toBe('ERR-TRN-001');
  });

  it('carries the authority a refused override named', async () => {
    send.mockResolvedValue({
      ok: false as const,
      kind: 'forbidden',
      problem: { code: 'ERR-IAM-001', requiredPermissions: ['sal.delivery.complete'] },
      correlationId: 'corr-9',
    });
    const state = await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '90',
      overrideReason: 'Agreed.',
    });
    expect(state.status).toBe('denied');
    expect(state.requiredPermissions).toEqual(['sal.delivery.complete']);
  });

  it('never reaches the transport once the session has ended', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await completeDelivery({
      deliveryId: DELIVERY_ID,
      ifMatch: 4,
      finalOdometerValue: '90',
    });
    expect(state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * The ready-for-delivery queue adapter (P1-31, FE-001).
 *
 * A separate module from `api.ts` with a separate contract, so it gets its own
 * cases rather than being folded into the sweeps above: the branch pair it
 * carries is an authorization TARGET the other seven reads do not have, and the
 * page ceiling it respects belongs to no other operation in this feature.
 */
describe('the ready-for-delivery queue names its branch and respects the queue ceiling', () => {
  const emptyQueue = { items: [], nextCursor: null, hasMore: false };
  const request = {
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    cursor: null,
    limit: READINESS_PAGE_SIZE,
  };
  const companies = { items: [{ id: COMPANY_ID, legalName: 'Workshop company' }] };
  const branches = { items: [{ id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' }] };
  const requested = () =>
    String(
      get.mock.calls.find(([path]) => String(path).startsWith('/api/v1/delivery-readiness?'))?.[0]
    );
  function answerQueue(response: unknown) {
    get.mockImplementation(async (path: string) =>
      path === '/api/v1/org/companies'
        ? ok(companies)
        : path === '/api/v1/org/branches'
          ? ok(branches)
          : response
    );
  }

  it('addresses the queue operation and carries both halves of the branch target', async () => {
    answerQueue(ok(emptyQueue));
    const page = await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: READINESS_PAGE_SIZE,
    });
    expect(page.status).toBe('ok');
    const path = requested();
    expect(path.startsWith('/api/v1/delivery-readiness?')).toBe(true);
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    // The pair is the resource this queue is ABOUT and the target the backend
    // authorizes against. Omitting it degrades a branch-scoped check into a
    // scope-blind permission test.
    expect(query.get('companyId')).toBe(COMPANY_ID);
    expect(query.get('branchId')).toBe(BRANCH_ID);
    expect(query.get('limit')).toBe(String(READINESS_PAGE_SIZE));
    expect(query.get('cursor')).toBeNull();
    // No eligibility may be asserted by a request. The route publishes no such
    // parameter and this adapter must never invent one.
    for (const name of ['ready', 'readyToStartDelivery', 'eligible', 'tenantId']) {
      expect(query.get(name), name).toBeNull();
    }
  });

  it('sends the server’s own cursor back unchanged for a further page', async () => {
    answerQueue(ok(emptyQueue));
    await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: CURSOR,
      limit: READINESS_PAGE_SIZE,
    });
    const path = requested();
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('cursor')).toBe(CURSOR);
  });

  it('never asks for more rows than the queue serves', async () => {
    // The table offers 100. The route REFUSES above its own ceiling rather than
    // clamping, so a request built from the table's number would be an error the
    // operator could not act on.
    answerQueue(ok(emptyQueue));
    await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: 100,
    });
    const path = requested();
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('limit')).toBe(String(MAX_READINESS_PAGE_SIZE));
    expect(readinessPageSize(100)).toBe(MAX_READINESS_PAGE_SIZE);
    expect(readinessPageSize(10)).toBe(10);
    expect(readinessPageSize(0)).toBe(READINESS_PAGE_SIZE);
  });

  it('reports the rows and the end-of-set signals the server published', async () => {
    answerQueue(ok({ items: [{ readyToStartDelivery: true }], nextCursor: CURSOR, hasMore: true }));
    const page = await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: READINESS_PAGE_SIZE,
    });
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBe(CURSOR);
    expect(page.hasMore).toBe(true);
    // No total is requested and none is invented.
    expect(page.total).toBeUndefined();
  });

  it('maps a refusal to a refusal rather than to an empty queue', async () => {
    answerQueue(failure('forbidden'));
    const page = await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: READINESS_PAGE_SIZE,
    });
    // "Nothing is ready" and "you may not see this" are different sentences and
    // an operator acts differently on each.
    expect(page.status).toBe('denied');
    expect(page.rows).toEqual([]);
    expect(page.correlationId).toBe('corr-9');
  });

  it('refuses to send a half-built branch target instead of naming it undefined', async () => {
    await expect(
      listDeliveryReadiness({
        companyId: COMPANY_ID,
        branchId: '',
        cursor: null,
        limit: READINESS_PAGE_SIZE,
      })
    ).rejects.toThrow(/branchId/);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    { companyId: COMPANY_ID, branchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', branchId: BRANCH_ID },
  ])('refuses a target outside the returned company/branch relationship: %j', async (target) => {
    answerQueue(ok(emptyQueue));
    expect((await listDeliveryReadiness({ ...request, ...target })).status).toBe('denied');
    expect(
      get.mock.calls.some(([path]) => String(path).startsWith('/api/v1/delivery-readiness'))
    ).toBe(false);
  });

  it.each(['forbidden', 'network', 'unauthenticated'])(
    'propagates directory failure %s before the queue read',
    async (kind) => {
      get.mockResolvedValue(failure(kind));
      const result = await listDeliveryReadiness(request);
      expect(result.status).toBe(
        kind === 'forbidden' ? 'denied' : kind === 'unauthenticated' ? 'expired' : 'unavailable'
      );
      expect(result.rows).toEqual([]);
      expect(
        get.mock.calls.some(([path]) => String(path).startsWith('/api/v1/delivery-readiness'))
      ).toBe(false);
    }
  );

  it('keeps directory membership checks separate from queue permission checks', async () => {
    answerQueue(failure('forbidden'));
    expect((await readDeliveryReadinessScopes()).status).toBe('ok');
    expect((await listDeliveryReadiness(request)).status).toBe('denied');
  });
});

/* -- the employee register the handover form picks from --------------------- */

describe('the employee read the handover form is built on', () => {
  const employeeRequest = { companyId: COMPANY_ID, branchId: BRANCH_ID };

  it('names the branch pair as a TARGET and asks only for people who may be named', async () => {
    get.mockResolvedValue(ok(emptyPage));
    const state = await listEmployees({ ...employeeRequest, status: 'active' });
    expect(state.status).toBe('ok');

    const path = requested();
    expect(path.startsWith('/api/v1/org/employees?')).toBe(true);
    const sentQuery = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(sentQuery.get('companyId')).toBe(COMPANY_ID);
    expect(sentQuery.get('branchId')).toBe(BRANCH_ID);
    // Asked for, not filtered after arrival: filtering a page on this side would
    // silently shorten it and hide the rows beyond it.
    expect(sentQuery.get('status')).toBe('active');
  });

  it('reads ANOTHER branch of the same company when it is asked to', async () => {
    // The employee's home branch is not a rule the server applies, so a picker
    // that could only ever read one branch would re-impose in a browser the
    // restriction the database does not carry.
    get.mockResolvedValue(ok(emptyPage));
    await listEmployees({ companyId: COMPANY_ID, branchId: OTHER_BRANCH_ID, status: 'active' });
    const sentQuery = new URLSearchParams(requested().slice(requested().indexOf('?') + 1));
    expect(sentQuery.get('branchId')).toBe(OTHER_BRANCH_ID);
    expect(sentQuery.get('companyId')).toBe(COMPANY_ID);
  });

  it('never asks for a page larger than the route serves', async () => {
    get.mockResolvedValue(ok(emptyPage));
    await listEmployees({ ...employeeRequest, limit: MAX_EMPLOYEE_PAGE_SIZE + 500 });
    const sentQuery = new URLSearchParams(requested().slice(requested().indexOf('?') + 1));
    // The route refuses a larger page rather than clamping it, so a request
    // above the bound is an error instead of a shorter answer.
    expect(sentQuery.get('limit')).toBe(String(MAX_EMPLOYEE_PAGE_SIZE));
    expect(employeePageSize(0)).toBe(EMPLOYEE_PAGE_SIZE);
    expect(employeePageSize(10)).toBe(10);
  });

  it('sends the cursor it was given back exactly as it arrived', async () => {
    get.mockResolvedValue(ok(emptyPage));
    await listEmployees({ ...employeeRequest, cursor: CURSOR });
    const sentQuery = new URLSearchParams(requested().slice(requested().indexOf('?') + 1));
    expect(sentQuery.get('cursor')).toBe(CURSOR);
  });

  it('refuses to send a half-built branch target instead of naming it undefined', async () => {
    await expect(listEmployees({ companyId: COMPANY_ID, branchId: '' })).rejects.toThrow(
      /branchId/
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('maps a refusal to a refusal rather than to an empty register', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const state = await listEmployees(employeeRequest);
    // "There is nobody here" and "you may not see them" are different sentences.
    expect(state.status).toBe('denied');
  });
});

/* -- the branch directory the handover form picks a branch from ------------- */

describe('the branch directory read the handover form picks a branch from', () => {
  it('names the published directory and sends nothing with it', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    const state = await listBranches();
    expect(state.status).toBe('ok');
    // Tenant-wide and parameterless: the company narrowing is the screen's
    // display decision, and a scope is never claimed from this side.
    expect(requested()).toBe('/api/v1/org/branches');
  });

  it('maps a refusal to a refusal rather than to a company with one branch', async () => {
    get.mockResolvedValue(failure('forbidden'));
    expect((await listBranches()).status).toBe('denied');
  });
});
