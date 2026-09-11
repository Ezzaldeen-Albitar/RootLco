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

const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const CURSOR = 'b3JkZXItY3Vyc29y';

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

describe('every write sends the body its route declares, and nothing besides', () => {
  // Starting with an unvalidated employee identifier is withheld. Keep the
  // backend body mirror, but do not expose a browser-callable start adapter.
  it('does not export a start action while employee selection is unavailable', () => {
    expect(adapters).not.toHaveProperty('startDelivery');
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
