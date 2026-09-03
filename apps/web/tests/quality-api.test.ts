/**
 * P1-29 W8 — the quality and closure adapters, proved at the request they build:
 * path, method, body and `If-Match` of every write, the scope query of the
 * queue, and the failure mapping of the reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const api = await import('@/features/quality/api');

const WORK_ORDER = '11111111-1111-4111-8111-111111111111';
const RECORD = '22222222-2222-4222-8222-222222222222';
const CHECK = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const JOB = '66666666-6666-4666-8666-666666666666';
const BLOCKER = '77777777-7777-4777-8777-777777777777';
const TARGET = {
  companyId: '88888888-8888-4888-8888-888888888888',
  branchId: '99999999-9999-4999-8999-999999999999',
} as const;

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockClear();
});

describe('reads', () => {
  it('names every operation path; the queue carries the branch target as query, never as a path', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    await api.listQcQueue(TARGET, {}, null);
    await api.listQcQueue(TARGET, { overallResult: 'open' }, 'c1');
    await api.listQcChecks();
    await api.listQcRecords(WORK_ORDER);
    await api.readQcRecord(RECORD);
    await api.readClosureEligibility(WORK_ORDER);
    await api.listReworkLinks(WORK_ORDER);
    await api.readReworkCost(LINK);
    await api.listReopenAttempts(WORK_ORDER);
    await api.listAdditionalWork(WORK_ORDER);
    await api.readAdditionalWorkDetail(REQUEST);
    await api.readAdditionalWorkApproval(REQUEST);
    await api.readWorkOrderTimeline(WORK_ORDER, null);
    await api.readWorkOrderTimeline(WORK_ORDER, 'c2');
    await api.listJobBlockers(JOB);
    const paths = get.mock.calls.map((c) => c[0] as string);
    expect(paths[0]).toBe(
      `/api/v1/quality-controls?companyId=${TARGET.companyId}&branchId=${TARGET.branchId}&limit=50`
    );
    expect(paths[1]).toBe(
      `/api/v1/quality-controls?companyId=${TARGET.companyId}&branchId=${TARGET.branchId}&overallResult=open&cursor=c1&limit=50`
    );
    expect(paths.slice(2)).toEqual([
      '/api/v1/qc-checks',
      `/api/v1/work-orders/${WORK_ORDER}/quality-controls`,
      `/api/v1/quality-controls/${RECORD}`,
      `/api/v1/work-orders/${WORK_ORDER}/closure-eligibility`,
      `/api/v1/work-orders/${WORK_ORDER}/rework`,
      `/api/v1/rework-links/${LINK}/cost`,
      `/api/v1/work-orders/${WORK_ORDER}/reopen-attempts`,
      `/api/v1/work-orders/${WORK_ORDER}/additional-work`,
      `/api/v1/additional-work/${REQUEST}/detail`,
      `/api/v1/additional-work/${REQUEST}/approval`,
      `/api/v1/work-orders/${WORK_ORDER}/timeline?limit=50`,
      `/api/v1/work-orders/${WORK_ORDER}/timeline?cursor=c2&limit=50`,
      `/api/v1/jobs/${JOB}/blockers`,
    ]);
  });

  it('maps a refused read to its status with the reference, and an expired session without the network', async () => {
    get.mockResolvedValueOnce(failure('forbidden'));
    const denied = await api.readQcRecord(RECORD);
    expect(denied.status).toBe('denied');
    expect(denied.correlationId).toBe('corr-1');
    get.mockResolvedValueOnce(failure('not-found'));
    expect((await api.readAdditionalWorkApproval(REQUEST)).status).toBe('not-found');
    authorizedClient.mockResolvedValueOnce(null);
    expect((await api.listQcChecks()).status).toBe('expired');
  });
});

describe('writes — the request each panel builds', () => {
  it('QC: open, answer a check by its id (PUT), finalize with the record’s If-Match', async () => {
    send.mockResolvedValue(ok({}));
    await api.openQcRecord(WORK_ORDER, { notes: 'Pre-delivery' });
    await api.writeQcCheckResult(RECORD, CHECK, { result: 'pass', note: 'Fine' });
    await api.finalizeQcRecord(RECORD, { overallResult: 'passed' }, 3);
    expect(send.mock.calls).toEqual([
      ['POST', `/api/v1/work-orders/${WORK_ORDER}/quality-controls`, { notes: 'Pre-delivery' }, {}],
      [
        'PUT',
        `/api/v1/quality-controls/${RECORD}/checks/${CHECK}`,
        { result: 'pass', note: 'Fine' },
        {},
      ],
      [
        'POST',
        `/api/v1/quality-controls/${RECORD}/finalization`,
        { overallResult: 'passed' },
        { ifMatch: 3 },
      ],
    ]);
  });

  it('rework: create, sign off with the link’s If-Match, record the cost', async () => {
    send.mockResolvedValue(ok({}));
    await api.createRework(WORK_ORDER, {
      rootCause: 'Wrong axle',
      correctiveAction: 'Refit',
      isSafetyCritical: true,
      leadTechnicianId: JOB,
    });
    await api.signOffRework(LINK, { signOffBy: BLOCKER }, 2);
    await api.recordReworkCost(LINK, { reworkCost: '120.00', costCurrency: 'SAR' });
    expect(send.mock.calls).toEqual([
      [
        'POST',
        `/api/v1/work-orders/${WORK_ORDER}/rework`,
        {
          rootCause: 'Wrong axle',
          correctiveAction: 'Refit',
          isSafetyCritical: true,
          leadTechnicianId: JOB,
        },
        {},
      ],
      ['POST', `/api/v1/rework-links/${LINK}/sign-off`, { signOffBy: BLOCKER }, { ifMatch: 2 }],
      [
        'PUT',
        `/api/v1/rework-links/${LINK}/cost`,
        { reworkCost: '120.00', costCurrency: 'SAR' },
        {},
      ],
    ]);
  });

  it('reopen attempt, additional work request / detail / approval (If-Match) / fulfillment / withdrawal', async () => {
    send.mockResolvedValue(ok({}));
    await api.raiseReopenAttempt(WORK_ORDER, { reason: 'Returned' });
    await api.requestAdditionalWork(WORK_ORDER, { summary: 'Rear pads', isRequired: true });
    await api.recordAdditionalWorkDetail(REQUEST, { description: 'Rear pads at 2 mm' });
    await api.recordAdditionalWorkApproval(
      REQUEST,
      {
        decision: 'approved',
        channel: 'phone',
        decidingPartyRoleId: JOB,
        presentedScope: 'Rear pads and rotors',
      },
      5
    );
    await api.fulfillAdditionalWork(REQUEST, { fulfillmentState: 'fulfilled' });
    await api.withdrawAdditionalWork(REQUEST, { reason: 'Customer declined' });
    expect(send.mock.calls).toEqual([
      ['POST', `/api/v1/work-orders/${WORK_ORDER}/reopen-attempts`, { reason: 'Returned' }, {}],
      [
        'POST',
        `/api/v1/work-orders/${WORK_ORDER}/additional-work`,
        { summary: 'Rear pads', isRequired: true },
        {},
      ],
      [
        'PUT',
        `/api/v1/additional-work/${REQUEST}/detail`,
        { description: 'Rear pads at 2 mm' },
        {},
      ],
      [
        'POST',
        `/api/v1/additional-work/${REQUEST}/approval`,
        {
          decision: 'approved',
          channel: 'phone',
          decidingPartyRoleId: JOB,
          presentedScope: 'Rear pads and rotors',
        },
        { ifMatch: 5 },
      ],
      [
        'POST',
        `/api/v1/additional-work/${REQUEST}/fulfillment`,
        { fulfillmentState: 'fulfilled' },
        {},
      ],
      [
        'POST',
        `/api/v1/additional-work/${REQUEST}/withdrawal`,
        { reason: 'Customer declined' },
        {},
      ],
    ]);
  });

  it('closure with the order’s If-Match; blockers raised and resolved on the job (W6)', async () => {
    send.mockResolvedValue(ok({}));
    await api.closeWorkOrder(WORK_ORDER, { toState: 'closed', reason: 'Delivered' }, 7);
    await api.raiseJobBlocker(JOB, { note: 'Waiting for parts' });
    await api.resolveJobBlocker(BLOCKER, { note: 'Parts arrived' });
    expect(send.mock.calls).toEqual([
      [
        'POST',
        `/api/v1/work-orders/${WORK_ORDER}/closure`,
        { toState: 'closed', reason: 'Delivered' },
        { ifMatch: 7 },
      ],
      ['POST', `/api/v1/jobs/${JOB}/blockers`, { note: 'Waiting for parts' }, {}],
      ['POST', `/api/v1/blockers/${BLOCKER}/resolution`, { note: 'Parts arrived' }, {}],
    ]);
  });

  it('maps a conflict, a refusal and validation without inventing a success', async () => {
    send.mockResolvedValueOnce(failure('conflict'));
    expect((await api.closeWorkOrder(WORK_ORDER, { toState: 'closed' }, 1)).status).toBe(
      'conflict'
    );
    send.mockResolvedValueOnce(failure('forbidden'));
    expect((await api.openQcRecord(WORK_ORDER, {})).status).toBe('denied');
    send.mockResolvedValueOnce(failure('validation'));
    expect(
      (await api.createRework(WORK_ORDER, { rootCause: 'x', correctiveAction: 'y' })).status
    ).toBe('invalid');
  });
});
