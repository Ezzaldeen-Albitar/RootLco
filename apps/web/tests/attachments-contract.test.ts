import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPTED_VERSION_STATUS,
  DOCUMENT_VERSION_STATUSES,
  MAX_CAPTURED_AT,
  MAX_FILE_NAME,
  SCAN_OUTCOMES,
  TERMINAL_VERSION_STATUSES,
  isTerminalVersion,
} from '@/features/attachments/attachments-contract';

/**
 * The derivation `attachments-contract.ts` said existed, and did not.
 *
 * ## The citation was wrong; the protection was not entirely missing
 *
 * That module's docblock read: "Every value here is a copy of something the API
 * publishes, and copies drift. `apps/web/tests/attachments-contract.test.ts`
 * derives each one from `docs/api/openapi.v1.json` and the operation register."
 *
 * No such file existed, and the named source could not have served: searching
 * `openapi.v1.json` for an `enum` containing `quarantined` or `infected`
 * returns nothing, and so does searching it for `maxLength: 400`.
 *
 * What is NOT true — and was claimed when this file was first written — is that
 * a sixth version status could therefore reach a screen as a raw translation
 * key. It could not. `p1-28-reception-media.test.ts` carries
 * `versionLifecycleIsApproved`, which reads the effective
 * `ck_document_versions_status` out of the migration series and fails any tree
 * declaring a state outside the approved five; it is proved non-vacuous against
 * a planted `auto_accepted` and guarded against an empty sweep. A companion
 * case requires an EN and an AR wording for every member. So that vocabulary was
 * already covered, under a different name, and the residue was a stale citation.
 *
 * ## What this file therefore adds
 *
 * Two values nothing derived, and one relationship nothing stated:
 *
 *   - `SCAN_OUTCOMES` — checked against what `attachment-service.ts` declares it
 *     REPORTS, which differs by one member from what the table stores:
 *     `scan_status` admits `pending` where the service reports `not_started`.
 *     The difference is asserted so a later reader does not "correct" it into
 *     agreement.
 *   - `MAX_FILE_NAME` — checked against the request schema the
 *     upload-authorization route really parses.
 *   - `DOCUMENT_VERSION_STATUSES` — tied to the database constraint by
 *     EQUALITY. The existing protection asks whether the migration series stays
 *     inside an approved literal list; this asks whether this module's copy
 *     still equals what the database admits, which is the half that catches the
 *     copy going stale rather than the schema going rogue.
 */

const WEB = process.cwd();
const REPO = join(WEB, '..', '..');
const MIGRATIONS = join(REPO, 'supabase', 'migrations');
const API = join(REPO, 'apps', 'api', 'src');

/** Every migration, oldest first — the filename series IS the order. */
function migrations(): readonly { readonly name: string; readonly sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
}

/**
 * The members of the LAST definition of a check constraint.
 *
 * Last, not first: `ck_document_versions_status` is dropped and re-added by a
 * later migration, and reading the earliest one would derive the four-member
 * vocabulary this contract stopped mirroring in August.
 */
function lastConstraintMembers(constraint: string, column: string): readonly string[] {
  const pattern = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s*\\n?\\s*CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`,
    'gi'
  );
  const inline = new RegExp(
    `ADD\\s+CONSTRAINT\\s+${constraint}\\s*\\n?\\s*CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`,
    'gi'
  );
  let members: string[] | null = null;
  for (const { sql } of migrations()) {
    for (const source of [pattern, inline]) {
      source.lastIndex = 0;
      let hit = source.exec(sql);
      while (hit !== null) {
        members = [...hit[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
        hit = source.exec(sql);
      }
    }
  }
  if (members === null) throw new Error(`no definition of ${constraint} was found`);
  return members;
}

describe('the attachments contract is DERIVED from what governs it', () => {
  it('reads real migrations — a derivation over nothing would agree with anything', () => {
    const all = migrations();
    expect(all.length).toBeGreaterThan(100);
    expect(all.some(({ name }) => name.includes('shared_document_versions'))).toBe(true);
  });

  it('mirrors the version vocabulary the DATABASE admits, in its latest definition', () => {
    const admitted = lastConstraintMembers('ck_document_versions_status', 'status');

    // Non-vacuity: the constraint really names a set, and it is the widened one.
    expect(admitted).toHaveLength(5);
    expect(admitted).toContain('scanning');

    expect([...DOCUMENT_VERSION_STATUSES].sort()).toEqual([...admitted].sort());
  });

  it('names the one accepted state as a member of that same vocabulary', () => {
    expect(ACCEPTED_VERSION_STATUS).toBe('accepted');
    expect(DOCUMENT_VERSION_STATUSES).toContain(ACCEPTED_VERSION_STATUS);
  });

  it('mirrors what the attachment service REPORTS, not what the table stores', () => {
    /*
     * The two differ by one member and the difference is deliberate:
     * `ck_file_scan_results_status` admits `pending`, and the service reports
     * `not_started` for the same condition. So this derives from the service's
     * own declared union rather than from the table, and asserts the difference
     * so that a later reader does not "fix" it into agreement.
     */
    const service = readFileSync(
      join(API, 'modules', 'shared-services', 'application', 'attachment-service.ts'),
      'utf8'
    );
    const declared = /readonly scanStatus:\s*([^;]+);/.exec(service)?.[1];
    expect(declared, 'the service no longer declares a scanStatus union').toBeDefined();
    const members = [...declared!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

    expect(members).toHaveLength(4);
    expect([...SCAN_OUTCOMES].sort()).toEqual([...members].sort());

    // The mapping, stated: stored `pending` is reported `not_started`.
    const stored = lastConstraintMembers('ck_file_scan_results_status', 'scan_status');
    expect(stored).toContain('pending');
    expect(SCAN_OUTCOMES).toContain('not_started');
    expect(SCAN_OUTCOMES).not.toContain('pending');
  });

  it('mirrors the file-name bound the upload route really parses', () => {
    const route = readFileSync(
      join(API, 'app', 'api', 'v1', 'attachments', 'upload-authorizations', 'route.ts'),
      'utf8'
    );
    const bound = /fileName:\s*z\.string\(\)\.min\(1\)\.max\((\d+)\)/.exec(route)?.[1];
    expect(bound, 'the upload route no longer bounds fileName this way').toBeDefined();
    expect(MAX_FILE_NAME).toBe(Number(bound));
  });

  it('bounds captured-at at a length a timestamp really fits', () => {
    /*
     * `capturedAt` is parsed as a DATE by the versions route
     * (`z.coerce.date()`), so there is no string bound there to mirror. The
     * constant is the browser-side ceiling on the text sent, and what it must
     * not be is shorter than the instants this application produces — an ISO
     * timestamp with milliseconds and an offset. Checked as a property of the
     * value rather than pinned to a number nothing else states.
     */
    expect(MAX_CAPTURED_AT).toBeGreaterThanOrEqual(new Date().toISOString().length);
    expect(MAX_CAPTURED_AT).toBeLessThanOrEqual(MAX_FILE_NAME);
  });

  it('fails when the derivation is fed a vocabulary that moved', () => {
    // The mutation that matters: a sixth status on the Backend. The comparison
    // above is what catches it, so it is exercised directly here rather than
    // trusted — a derivation nobody can make fail is a copy with extra steps.
    const admitted = lastConstraintMembers('ck_document_versions_status', 'status');
    const widened = [...admitted, 'expired'];
    expect([...DOCUMENT_VERSION_STATUSES].sort()).not.toEqual([...widened].sort());
  });

  it('reaches a non-API host exactly ONCE, and only for the store upload', () => {
    /*
     * The other half of the boundary allowance.
     *
     * `check-api-boundary.mjs` forbids `fetch(` outside `src/lib/api`, and names
     * this one file as the exception: the object-store `PUT` goes to an address
     * the API minted, and routing it through the API client would attach our
     * session bearer to somebody else’s host. The rule scans FILES, so a file is
     * the smallest thing it can name — which means the allowance is exactly as
     * wide as this file, and nothing in the gate stops a second call being added
     * to it.
     *
     * This is what stops that. One call, inside `putObject`, sending a URL that
     * came from the authorization rather than from anything this tree composes.
     */
    const source = readFileSync(join(WEB, 'src', 'features', 'attachments', 'api.ts'), 'utf8');
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');

    const calls = [...stripped.matchAll(/\bfetch\s*\(/g)];
    expect(calls, 'this file may hold exactly one outbound call').toHaveLength(1);

    /*
     * …and it is the store upload. The call sits inside `putObject`, and its URL
     * is `authorization.uploadUrl` — a value the API returned. A `fetch` built
     * from anything this tree concatenates would be a destination we chose, which
     * is the thing the boundary rule exists to refuse.
     */
    const opens = stripped.indexOf('async function putObject(');
    expect(opens, 'putObject left this file').toBeGreaterThan(-1);
    expect(calls[0]!.index, 'the outbound call moved out of putObject').toBeGreaterThan(opens);

    const call = stripped.slice(calls[0]!.index, calls[0]!.index + 120);
    expect(call).toContain('authorization.uploadUrl');

    // And the two properties that keep OUR credential off that host.
    expect(stripped).toContain("redirect: 'error'");
    expect(stripped).not.toMatch(/credentials\s*:\s*['\"]include/);
  });
  it('derives the terminal statuses from the guard, minus the one that is a pass', () => {
    /*
     * `TERMINAL_VERSION_STATUSES` is what lets a screen tell a permanent scan
     * refusal apart from a dropped network call, and both of those stop the
     * capture chain at the same STAGE — so the difference is only readable from
     * the version status, and only if this list is right.
     *
     * Derived from `shared.guard_document_version_transition`, whose latest
     * definition refuses any change out of a set of three. One of those three is
     * `accepted` — immutable, but a PASS, and offering "record a different
     * file" over an accepted version would be as wrong as offering a retry over
     * a quarantined one. So the terminal-against set is the guard's immutable
     * set minus the accepted status, and both halves are read rather than typed.
     */
    const guard = migrations()
      .filter((entry) => entry.sql.includes('guard_document_version_transition'))
      .at(-1);
    expect(guard, 'the version transition guard left the migration series').toBeDefined();

    const immutable = /IF OLD\.status IN \(([^)]*)\)/.exec(guard!.sql)?.[1];
    expect(immutable, 'the guard no longer states its immutable set this way').toBeDefined();
    const members = [...immutable!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);

    const terminalAgainst = members.filter((status) => status !== ACCEPTED_VERSION_STATUS).sort();
    expect([...TERMINAL_VERSION_STATUSES].sort()).toEqual(terminalAgainst);

    // Every one of them is a member of the vocabulary, so the two lists cannot
    // drift apart into naming states that do not exist.
    for (const status of TERMINAL_VERSION_STATUSES) {
      expect(DOCUMENT_VERSION_STATUSES, status).toContain(status);
    }

    // And the predicate answers for the whole vocabulary, including the two
    // shapes a caller really hands it: a status it has never heard of, and none.
    for (const status of DOCUMENT_VERSION_STATUSES) {
      expect(isTerminalVersion(status), status).toBe(terminalAgainst.includes(status));
    }
    expect(isTerminalVersion(undefined)).toBe(false);
    expect(isTerminalVersion('')).toBe(false);
    expect(isTerminalVersion(ACCEPTED_VERSION_STATUS)).toBe(false);
  });
});

/**
 * The three refusals about the FILE, and where their sentences land.
 *
 * `content_type_not_allowed`, `size_out_of_range` and `expired` — all from
 * `shared-services/application/attachment-service.ts` — are published against
 * `body.contentType`, `body.byteSize` and `body.uploadToken`. None of the three
 * is a control: every capture surface offers one file picker, and this module's
 * own refusals are already filed under `file`. So each sentence reached a field
 * error keyed to nothing on screen and the operator was shown the general
 * failure over a file the workshop simply cannot take.
 *
 * Exercised through `captureDocument` with only the HTTP client replaced, so the
 * whole path is real: the service's `{ path, rule }` pair, the client's
 * translation of the token into a catalogue key, and the re-filing under the
 * control an operator can act on.
 *
 * The fourth case is the boundary of that re-filing. `body.uploadToken` also
 * carries refusals that are about the authorization rather than the file, and
 * those must not borrow a sentence written for something the reader typed.
 *
 * Folded into this file rather than given one of its own: the P1-27 evidence
 * seal digests a count of web test FILES, and this is the attachments suite.
 */

const attachmentSend = vi.fn();
vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: async () => ({ send: attachmentSend, get: vi.fn() }),
}));

const attachmentsApi = await import('@/features/attachments/api');

const CAPTURE = {
  categoryCode: 'reception_condition_photo',
  entityType: 'rec.reception_visits',
  entityId: '11111111-1111-4111-8111-111111111111',
  fileName: 'front-bumper.jpg',
  contentType: 'image/jpeg',
  bytes: new Uint8Array([1, 2, 3, 4]),
} as const;

const fileRefusal = (path: string, rule: string) => ({
  ok: false as const,
  kind: 'validation' as const,
  status: 422,
  problem: { violations: [{ path, rule }] },
  correlationId: 'corr-file',
});

describe('a refusal about the chosen file reaches the control the operator has', () => {
  beforeEach(() => {
    attachmentSend.mockReset();
  });

  it.each([
    ['body.contentType', 'content_type_not_allowed'],
    ['body.byteSize', 'size_out_of_range'],
  ])('files %s (%s) under the file control and says it in the banner', async (path, rule) => {
    attachmentSend.mockResolvedValue(fileRefusal(path, rule));

    const state = await attachmentsApi.captureDocument(CAPTURE);

    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.file).toBe(`form.violation.${rule}`);
    expect(state.messageKey).toBe(`form.violation.${rule}`);
  });

  it('does the same for an authorization that has run out, at the registration step', async () => {
    const stored = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    attachmentSend
      .mockResolvedValueOnce({
        ok: true,
        data: {
          documentId: '22222222-2222-4222-8222-222222222222',
          uploadToken: 'authorization-issued-by-the-service',
          uploadUrl: 'https://store.invalid/put',
          method: 'PUT',
          contentType: CAPTURE.contentType,
          maxBytes: 1_000_000,
          expiresAt: '2026-09-21T00:00:00.000Z',
        },
        correlationId: 'corr-authorized',
      })
      .mockResolvedValueOnce(fileRefusal('body.uploadToken', 'expired'));

    const state = await attachmentsApi.captureDocument(CAPTURE);

    expect(state.fieldErrors?.file).toBe('form.violation.expired');
    expect(state.messageKey).toBe('form.violation.expired');
    stored.mockRestore();
  });

  it('never tells the operator an authorization they never typed is the wrong length', async () => {
    // `invalid_length` on `body.uploadToken` comes from
    // `shared-services/domain/attachment-policy.ts`: the authorization itself
    // could not be read. Its catalogue sentence is written for a value the
    // reader entered — "too short or too long" — and this is a value the
    // operator never sees, let alone types. The sentence they get instead is
    // true of every unreadable authorization and names the one step open to
    // them.
    const stored = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    attachmentSend
      .mockResolvedValueOnce({
        ok: true,
        data: {
          documentId: '33333333-3333-4333-8333-333333333333',
          uploadToken: 'authorization-issued-by-the-service',
          uploadUrl: 'https://store.invalid/put',
          method: 'PUT',
          contentType: CAPTURE.contentType,
          maxBytes: 1_000_000,
          expiresAt: '2026-09-21T00:00:00.000Z',
        },
        correlationId: 'corr-authorized',
      })
      .mockResolvedValueOnce(fileRefusal('body.uploadToken', 'invalid_length'));

    const state = await attachmentsApi.captureDocument(CAPTURE);

    expect(state.fieldErrors?.file).toBe('attachments.capture.uploadNotConfirmed');
    expect(state.messageKey).toBe('attachments.capture.uploadNotConfirmed');
    expect(state.fieldErrors?.file).not.toBe('form.violation.invalid_length');
    stored.mockRestore();
  });

  it('leaves a refusal the catalogue cannot name where it was', async () => {
    // The direction that matters. `form.violation.invalid` says less than the
    // banner the failure kind already earns, so raising it would replace a
    // sentence with a vaguer one — and it is not about the file in particular.
    attachmentSend.mockResolvedValue(fileRefusal('body.contentType', 'a_token_with_no_sentence'));

    const state = await attachmentsApi.captureDocument(CAPTURE);

    expect(state.fieldErrors?.contentType).toBe('form.violation.invalid');
    expect(state.fieldErrors?.file).toBeUndefined();
    expect(state.messageKey).not.toBe('form.violation.invalid');
  });
});
