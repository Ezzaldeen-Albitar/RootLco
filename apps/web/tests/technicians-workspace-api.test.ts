import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The technician workspace adapters (P1-29, `W4`).
 *
 * ## What the backend proof cannot cover
 *
 * `tests/backend/p1-29-w4-technician-workspace` proves the SERVER answers the
 * caller's own queue, that the assignment list carries the profile, that a
 * start persists and a stale stop is refused. It calls the routes directly, so
 * it says nothing about whether these adapters RESOLVE the identity before
 * writing, send the resolved id and not some other, carry `If-Match` on the
 * stop, or build the work-log body from what was typed. An adapter that took
 * a technician id from its caller would leave every backend case green while
 * the screen let a technician clock somebody else.
 *
 * So the identity resolution, the request bodies and the concurrency token are
 * asserted HERE, on the requests the adapters actually build, with only the
 * HTTP client mocked.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const captureDocument = vi.fn();
const createDocumentLink = vi.fn();
const listDocumentCategories = vi.fn();
vi.mock('@/features/attachments/api', () => ({
  captureDocument: (...args: unknown[]) => captureDocument(...args),
  createDocumentLink: (...args: unknown[]) => createDocumentLink(...args),
  listDocumentCategories: () => listDocumentCategories(),
}));

const {
  readMyQueue,
  resolveOwnAssignment,
  startLaborSession,
  stopLaborSession,
  correctLaborSession,
  recordWorkLog,
  captureJobEvidence,
} = await import('@/features/technicians/api');

const TARGET = {
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
} as const;
const JOB_ID = '77777777-7777-4777-8777-777777777777';
const WORK_ORDER_ID = '33333333-3333-4333-8333-333333333333';
const MY_ASSIGNMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEIR_ASSIGNMENT = 'aaaaaaaa-0000-4000-8000-000000000002';
const MY_PROFILE = 'bbbbbbbb-0000-4000-8000-000000000001';
const THEIR_PROFILE = 'bbbbbbbb-0000-4000-8000-000000000002';
const MY_SESSION = 'cccccccc-0000-4000-8000-000000000001';
const THEIR_SESSION = 'cccccccc-0000-4000-8000-000000000002';

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

const queueRow = {
  assignmentId: MY_ASSIGNMENT,
  jobId: JOB_ID,
  workOrderId: WORK_ORDER_ID,
  assignmentRole: 'primary',
  validFrom: '2026-07-26T08:00:00.000Z',
  jobTitle: 'Replace front pads',
  jobState: 'assigned',
  workOrderState: 'open',
  displayNumber: 'WO-0001',
};

/** A job two technicians share: my assignment and theirs, both open. */
const sharedAssignments = {
  items: [
    { id: THEIR_ASSIGNMENT, jobId: JOB_ID, technicianProfileId: THEIR_PROFILE, validTo: null },
    { id: MY_ASSIGNMENT, jobId: JOB_ID, technicianProfileId: MY_PROFILE, validTo: null },
  ],
};

/** `get` answers by path: the queue, the assignment list, the labour log. */
function answerReads(options: { readonly queue?: unknown; readonly sessions?: unknown } = {}) {
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/technicians/me/queue')) {
      return ok(options.queue ?? { items: [queueRow] });
    }
    if (path === `/api/v1/jobs/${JOB_ID}/assignments`) return ok(sharedAssignments);
    if (path.startsWith(`/api/v1/jobs/${JOB_ID}/labor-sessions`)) {
      return ok(
        options.sessions ?? {
          items: [
            {
              id: THEIR_SESSION,
              technicianProfileId: THEIR_PROFILE,
              endedAt: null,
              recordVersion: 1,
            },
            { id: MY_SESSION, technicianProfileId: MY_PROFILE, endedAt: null, recordVersion: 4 },
          ],
          nextCursor: null,
          hasMore: false,
        }
      );
    }
    return failure('not-found');
  });
}

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
  captureDocument.mockReset();
  createDocumentLink.mockReset();
  listDocumentCategories.mockReset();
});

describe('the queue read is a branch target with nothing else on it', () => {
  it('sends the pair and NO limit — the backend would discard one', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    const result = await readMyQueue(TARGET);
    expect(result.status).toBe('ok');
    const [path, options] = get.mock.calls[0] ?? [];
    expect(String(path)).toContain('/api/v1/technicians/me/queue');
    expect(String(path)).toContain(`companyId=${TARGET.companyId}`);
    expect(String(path)).toContain(`branchId=${TARGET.branchId}`);
    expect(String(path)).not.toContain('limit=');
    expect(String(path)).not.toContain('cursor=');
    expect(String(path)).not.toContain('technicianProfileId');
    expect(options).toEqual({ retries: 0 });
  });

  it('a refusal is a refusal, never an empty queue', async () => {
    get.mockResolvedValue(failure('forbidden'));
    expect((await readMyQueue(TARGET)).status).toBe('denied');
  });
});

describe('the identity seam resolves the caller’s OWN profile by assignment', () => {
  it('matches the queue row’s assignmentId in the assignment list, not the first row', async () => {
    answerReads();
    const own = await resolveOwnAssignment(TARGET, JOB_ID, MY_ASSIGNMENT);
    expect(own.status).toBe('ok');
    if (own.status !== 'ok') return;
    // THE assertion: the other technician's row comes FIRST in the list and is
    // not the one chosen. Correlation is by assignment, never by position.
    expect(own.data.technicianProfileId).toBe(MY_PROFILE);
    expect(own.data.workOrderId).toBe(WORK_ORDER_ID);
  });

  it('refuses an assignment that is not in the caller’s own queue', async () => {
    answerReads();
    const theirs = await resolveOwnAssignment(TARGET, JOB_ID, THEIR_ASSIGNMENT);
    expect(theirs.status).toBe('not-found');
    // The assignment list was never even read: the queue said no first.
    expect(get.mock.calls.some(([path]) => String(path).endsWith('/assignments'))).toBe(false);
  });

  it('refuses when the queue is refused, and says which', async () => {
    get.mockResolvedValue(failure('forbidden'));
    expect((await resolveOwnAssignment(TARGET, JOB_ID, MY_ASSIGNMENT)).status).toBe('denied');
  });
});

describe('a labour start carries the RESOLVED profile and nothing the caller chose', () => {
  it('sends technicianProfileId = the caller’s own, resolved server-side', async () => {
    answerReads();
    send.mockResolvedValue(ok({}));

    const result = await startLaborSession(TARGET, JOB_ID, MY_ASSIGNMENT);

    expect(result.status).toBe('success');
    const [method, path, body, options] = send.mock.calls[0] ?? [];
    expect(method).toBe('POST');
    expect(String(path)).toBe(`/api/v1/jobs/${JOB_ID}/labor-sessions`);
    expect(body).toEqual({ technicianProfileId: MY_PROFILE });
    // Not version-guarded: no If-Match on a start.
    expect(options).toBeUndefined();
  });

  it('there is no parameter through which another technician’s id can enter', async () => {
    answerReads();
    send.mockResolvedValue(ok({}));
    // The signature is (target, jobId, assignmentId). Passing the OTHER
    // technician's assignment is the only way to name them — and it is refused
    // before any request is built.
    const result = await startLaborSession(TARGET, JOB_ID, THEIR_ASSIGNMENT);
    expect(result.status).toBe('denied');
    expect(result.messageKey).toBe('technicians.workspace.notOwnAssignment');
    expect(send).not.toHaveBeenCalled();
    // And the adapter's arity is the contract: three arguments, none a profile.
    expect(startLaborSession.length).toBe(3);
  });

  it('a backend refusal is reported as the backend said it', async () => {
    answerReads();
    send.mockResolvedValue(failure('forbidden'));
    expect((await startLaborSession(TARGET, JOB_ID, MY_ASSIGNMENT)).status).toBe('denied');
  });
});

describe('a stop acts only on the caller’s own session, with the version on screen', () => {
  it('sends If-Match and no body', async () => {
    answerReads();
    send.mockResolvedValue(ok({}));

    const result = await stopLaborSession(TARGET, JOB_ID, MY_ASSIGNMENT, MY_SESSION, 4);

    expect(result.status).toBe('success');
    const [method, path, body, options] = send.mock.calls[0] ?? [];
    expect(method).toBe('POST');
    expect(String(path)).toBe(`/api/v1/labor-sessions/${MY_SESSION}/stop`);
    expect(body).toBeUndefined();
    expect(options).toEqual({ ifMatch: 4 });
  });

  it('refuses to stop another technician’s session, and sends nothing', async () => {
    answerReads();
    send.mockResolvedValue(ok({}));
    const result = await stopLaborSession(TARGET, JOB_ID, MY_ASSIGNMENT, THEIR_SESSION, 1);
    expect(result.status).toBe('denied');
    expect(result.messageKey).toBe('technicians.workspace.notOwnSession');
    expect(send).not.toHaveBeenCalled();
  });

  it('a stale version is a CONFLICT, reported and not retried', async () => {
    answerReads();
    send.mockResolvedValue(failure('conflict'));
    const result = await stopLaborSession(TARGET, JOB_ID, MY_ASSIGNMENT, MY_SESSION, 3);
    expect(result.status).toBe('conflict');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a correction carries the whole window, the reason, and If-Match', async () => {
    answerReads();
    send.mockResolvedValue(ok({}));
    const body = {
      startedAt: '2026-07-26T08:00:00.000Z',
      endedAt: '2026-07-26T09:30:00.000Z',
      reason: 'Clock started late',
    };
    await correctLaborSession(TARGET, JOB_ID, MY_ASSIGNMENT, MY_SESSION, body, 5);
    const [method, path, sent, options] = send.mock.calls[0] ?? [];
    expect(method).toBe('POST');
    expect(String(path)).toBe(`/api/v1/labor-sessions/${MY_SESSION}/corrections`);
    expect(sent).toEqual(body);
    expect(options).toEqual({ ifMatch: 5 });
  });
});

describe('a work-log entry is the text typed, on a job in the caller’s own queue', () => {
  it('sends the exact entry, and loggedAt only when given', async () => {
    answerReads();
    send.mockResolvedValue(ok({}));

    await recordWorkLog(TARGET, JOB_ID, MY_ASSIGNMENT, { entry: 'Bled the rear circuit.' });
    const [method, path, body] = send.mock.calls[0] ?? [];
    expect(method).toBe('POST');
    expect(String(path)).toBe(`/api/v1/jobs/${JOB_ID}/work-logs`);
    expect(body).toEqual({ entry: 'Bled the rear circuit.' });
    expect(Object.hasOwn(body as object, 'loggedAt')).toBe(false);

    send.mockReset();
    send.mockResolvedValue(ok({}));
    await recordWorkLog(TARGET, JOB_ID, MY_ASSIGNMENT, {
      entry: 'Road test done.',
      loggedAt: '2026-07-26T10:00:00.000Z',
    });
    const [, , dated] = send.mock.calls[0] ?? [];
    expect(dated).toEqual({ entry: 'Road test done.', loggedAt: '2026-07-26T10:00:00.000Z' });
  });

  it('refuses a job that is not in the caller’s queue before any write', async () => {
    answerReads({ queue: { items: [] } });
    send.mockResolvedValue(ok({}));
    const result = await recordWorkLog(TARGET, JOB_ID, MY_ASSIGNMENT, { entry: 'x' });
    expect(result.status).toBe('denied');
    expect(send).not.toHaveBeenCalled();
  });

  it('maps a validation refusal to field errors rather than swallowing it', async () => {
    answerReads();
    send.mockResolvedValue({
      ok: false as const,
      kind: 'validation',
      correlationId: 'corr-1',
      violations: [{ path: 'body.entry', rule: 'too_big' }],
    });
    const result = await recordWorkLog(TARGET, JOB_ID, MY_ASSIGNMENT, { entry: 'x'.repeat(9) });
    expect(result.status).toBe('invalid');
  });
});

describe('evidence is captured against the WORK ORDER and bound to the JOB', () => {
  function form(fields: Record<string, string | File>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }
  const FILE = new File([new Uint8Array([1, 2, 3])], 'after.jpg', { type: 'image/jpeg' });

  it('authorises and links against wo.work_orders, then binds the version to the job', async () => {
    answerReads();
    listDocumentCategories.mockResolvedValue({
      status: 'ok',
      correlationId: 'c',
      data: {
        items: [
          {
            categoryCode: 'work_evidence',
            allowedContentTypes: ['image/jpeg'],
            maxBytes: 1,
            retentionClass: 'evidence-audit',
            classification: 'restricted',
            businessLinkPurpose: 'evidence',
            deviceCaptureTimestampRequired: false,
          },
        ],
      },
    });
    captureDocument.mockResolvedValue({
      status: 'success',
      attempt: 1,
      registered: {
        documentId: 'doc-1',
        versionId: 'ver-1',
        versionNumber: 1,
        status: 'pending',
        scannerAvailable: false,
        scanStatus: 'not_started',
      },
    });
    createDocumentLink.mockResolvedValue({ status: 'success', attempt: 1, linkId: 'link-1' });
    send.mockResolvedValue(ok({}));

    const outcome = await captureJobEvidence(
      TARGET,
      JOB_ID,
      MY_ASSIGNMENT,
      form({
        evidenceFile: FILE,
        categoryCode: 'work_evidence',
        evidenceType: 'after',
        note: 'Pads seated.',
      })
    );

    expect(outcome.status).toBe('success');
    expect(outcome.stage).toBe('bound');
    // The document belongs to the WORK ORDER the caller's own queue named —
    // `wo.jobs` is not a linkable entity type.
    expect(captureDocument.mock.calls[0]?.[0]).toMatchObject({
      categoryCode: 'work_evidence',
      entityType: 'wo.work_orders',
      entityId: WORK_ORDER_ID,
      fileName: 'after.jpg',
      contentType: 'image/jpeg',
    });
    expect(createDocumentLink.mock.calls[0]?.[1]).toEqual({
      entityType: 'wo.work_orders',
      entityId: WORK_ORDER_ID,
      linkPurpose: 'evidence',
    });
    const [method, path, body] = send.mock.calls[0] ?? [];
    expect(method).toBe('POST');
    expect(String(path)).toBe(`/api/v1/jobs/${JOB_ID}/evidence`);
    expect(body).toEqual({
      documentVersionId: 'ver-1',
      evidenceType: 'after',
      note: 'Pads seated.',
    });
  });

  it('refuses before capturing when the job is not the caller’s own', async () => {
    answerReads({ queue: { items: [] } });
    const outcome = await captureJobEvidence(
      TARGET,
      JOB_ID,
      MY_ASSIGNMENT,
      form({ evidenceFile: FILE, categoryCode: 'work_evidence', evidenceType: 'after' })
    );
    expect(outcome.status).toBe('denied');
    expect(captureDocument).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('a missing file is a field error, and nothing crosses the network', async () => {
    answerReads();
    const outcome = await captureJobEvidence(
      TARGET,
      JOB_ID,
      MY_ASSIGNMENT,
      form({ categoryCode: 'work_evidence', evidenceType: 'after' })
    );
    expect(outcome.status).toBe('invalid');
    expect(outcome.fieldErrors).toEqual({ evidenceFile: 'attachments.capture.empty' });
    expect(captureDocument).not.toHaveBeenCalled();
  });
});

describe('no session, no request', () => {
  it('every adapter returns expired without touching the network', async () => {
    authorizedClient.mockResolvedValue(null);
    expect((await readMyQueue(TARGET)).status).toBe('expired');
    expect((await startLaborSession(TARGET, JOB_ID, MY_ASSIGNMENT)).status).toBe('expired');
    expect((await recordWorkLog(TARGET, JOB_ID, MY_ASSIGNMENT, { entry: 'x' })).status).toBe(
      'expired'
    );
    expect(get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
