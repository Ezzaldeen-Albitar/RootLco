/**
 * The idempotency contract the Web client reads (`P1-27-INT-003`).
 *
 * ## What was wrong
 *
 * The client decided "does this need an `Idempotency-Key`?" from the HTTP
 * method: POST yes, everything else no. The backend's rule is not a method rule
 * — `route-handler.ts` reads `operation.idempotent` off the registration — and
 * the guess was wrong for **nine** operations: six PUT and three PATCH,
 * including `PATCH /vehicles/{vehicleId}`. Each answered `400 ERR-INT-002`
 * before authorization, on every attempt.
 *
 * Worse, a test asserted the wrong behaviour was correct ("is NOT attached to
 * PATCH or DELETE, which no operation marks idempotent"), and the client's
 * docblock said so in prose. A confident sentence and a green test are what stop
 * the next reader checking.
 *
 * These tests read the SHIPPED generated table, not a fixture, so they fail if
 * the contract and the client ever disagree about a real operation.
 */
import { describe, expect, it } from 'vitest';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { PUBLISHED_OPERATIONS } from '@/lib/api/idempotent-operations';

describe('the generated table reflects the published contract', () => {
  it('is not empty, so every assertion below is about something', () => {
    // Non-vacuity. A table that failed to generate would make every "resolves
    // correctly" test below pass by resolving nothing.
    expect(PUBLISHED_OPERATIONS.length).toBeGreaterThan(200);
    expect(PUBLISHED_OPERATIONS.some((operation) => operation.idempotent)).toBe(true);
    expect(PUBLISHED_OPERATIONS.some((operation) => !operation.idempotent)).toBe(true);
  });

  it('marks idempotent operations that are NOT POST — the whole defect', () => {
    const nonPost = PUBLISHED_OPERATIONS.filter(
      (operation) => operation.idempotent && operation.method !== 'POST'
    );
    // If this ever returns zero, either the contract changed or the generator
    // broke — and the POST-only shortcut would silently become correct again.
    expect(nonPost.length).toBeGreaterThan(0);
    expect(nonPost.map((operation) => operation.method)).toContain('PUT');
    expect(nonPost.map((operation) => operation.method)).toContain('PATCH');
  });

  it('carries no operation without an id', () => {
    expect(PUBLISHED_OPERATIONS.every((operation) => operation.operationId.length > 0)).toBe(true);
  });
});

describe('resolving a concrete path', () => {
  it('resolves a real call-site path, WITH the /api/v1 prefix', () => {
    // Call sites pass the full path because the base URL is an origin. The first
    // draft of the resolver stripped the prefix from the table but not from the
    // path, and matched nothing at all.
    const operation = resolveOperation('POST', '/api/v1/iam/invitations');
    expect(operation?.operationId).toBe('iam.invitation-create');
  });

  it('resolves the same path without the prefix', () => {
    const operation = resolveOperation('POST', '/iam/invitations');
    expect(operation?.operationId).toBe('iam.invitation-create');
  });

  it('substitutes a path parameter', () => {
    const operation = resolveOperation(
      'PUT',
      '/api/v1/customers/2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f/preferences'
    );
    expect(operation?.operationId).toBe('crm.preference-set');
    expect(operation?.idempotent).toBe(true);
  });

  it('prefers a LITERAL segment over a parameter segment', () => {
    // `/customers/companies` and `/customers/{customerId}` are both two
    // segments. A wildcard-first matcher resolves the wrong operation, and then
    // attaches the wrong contract to the request.
    const literal = resolveOperation('POST', '/api/v1/customers/companies');
    expect(literal?.operationId).toBe('crm.company-create');
    expect(literal?.template).toBe('/customers/companies');
  });

  it('ignores the query string and fragment', () => {
    const operation = resolveOperation('GET', '/api/v1/customers?query=nadia&limit=25');
    expect(operation?.operationId).toBe('crm.customer-search');
  });

  it('does not match across a different segment count', () => {
    expect(resolveOperation('GET', '/api/v1/customers/a/b/c/d/e/f')).toBeNull();
  });

  it('does not match a path that exists under a different method', () => {
    // `/customers/{customerId}/preferences` is PUT and GET, never DELETE.
    expect(resolveOperation('DELETE', '/api/v1/customers/abc/preferences')).toBeNull();
  });
});

describe('requiresIdempotencyKey', () => {
  it('is true for an idempotent POST', () => {
    expect(requiresIdempotencyKey('POST', '/api/v1/iam/invitations')).toBe(true);
  });

  it('is true for an idempotent PUT', () => {
    expect(requiresIdempotencyKey('PUT', '/api/v1/customers/abc/preferences')).toBe(true);
  });

  it('is true for an idempotent PATCH', () => {
    // The case the old docblock declared impossible.
    expect(requiresIdempotencyKey('PATCH', '/api/v1/vehicles/abc')).toBe(true);
    expect(requiresIdempotencyKey('PATCH', '/api/v1/vehicles/abc/status')).toBe(true);
    expect(requiresIdempotencyKey('PATCH', '/api/v1/services/abc')).toBe(true);
  });

  it('is false for a read, whatever the contract says about the path', () => {
    expect(requiresIdempotencyKey('GET', '/api/v1/customers')).toBe(false);
    expect(requiresIdempotencyKey('GET', '/api/v1/customers/abc')).toBe(false);
    expect(requiresIdempotencyKey('HEAD', '/api/v1/customers')).toBe(false);
  });

  it('is false for a mutation the contract does NOT mark idempotent', () => {
    const plain = PUBLISHED_OPERATIONS.find(
      (operation) =>
        !operation.idempotent && operation.method !== 'GET' && operation.method !== 'HEAD'
    );
    // Only assert if the contract actually has such an operation; otherwise this
    // would be a test about a fixture rather than about the contract.
    if (plain) {
      const concrete = plain.template.replace(/\{[^}]+\}/g, 'abc');
      expect(requiresIdempotencyKey(plain.method, `/api/v1${concrete}`)).toBe(false);
    }
  });

  it('errs toward SENDING for an unknown mutation path', () => {
    // The deliberate direction of the fail-safe, and the opposite of what "be
    // conservative" first suggests. A key the operation does not need is one
    // unread header — `route-handler.ts` reads it only when the operation is
    // idempotent. A key it DOES need and did not get is a 400 before
    // authorization, on every attempt. The two errors are not symmetric, so a
    // stale table can only ever be noisy, never broken.
    expect(requiresIdempotencyKey('POST', '/api/v1/not/a/real/operation')).toBe(true);
    expect(requiresIdempotencyKey('PUT', '/api/v1/invented')).toBe(true);
  });

  it('still refuses to send on an unknown READ path', () => {
    // The fail-safe does not extend to reads: a GET never carries a key, so an
    // unknown read path must not start inventing one.
    expect(requiresIdempotencyKey('GET', '/api/v1/not/a/real/operation')).toBe(false);
  });

  it('is case-insensitive about the method', () => {
    expect(requiresIdempotencyKey('patch', '/api/v1/vehicles/abc')).toBe(true);
    expect(requiresIdempotencyKey('get', '/api/v1/customers')).toBe(false);
  });
});

/**
 * `P1-27-SEC-004` — the AUDIT-EVENT half, which had no executable assertion.
 *
 * ## What was missing, precisely
 *
 * `SEC-004` is "security audit-event coverage". Its console half is strong and
 * its correlation half found a shipped defect. Its audit half asserted nothing
 * at all: `auditClass` occurred in `apps/web` only inside docblocks — thirteen
 * in `src/`, two in `tests/`, every one of them prose. Sentences such as "Both
 * writes here are `idempotent: true` and both are `auditClass: privileged`"
 * (`features/crm/customers/identity-api.ts:21`) were unfalsifiable, because the
 * generated table carried `template`, `method`, `operationId` and `idempotent`
 * and no audit class. Nothing in this tier COULD derive one.
 *
 * The fact was published the whole time. `docs/api/openapi.v1.json` carries
 * `x-audit-class` on **all 243** operations, written by
 * `apps/api/src/server/openapi/document.ts:228` straight off the registration.
 * What made it look absent is that the NAME `auditClass` appears in that
 * document zero times. Reading for the name rather than the extension is how a
 * fact that was already there got recorded as unbuildable.
 *
 * So the generator now carries it, and these are the assertions that make it a
 * checkable fact rather than a docblock.
 */

/**
 * The audit-class vocabulary, pinned against the backend's own union.
 *
 * `apps/api/src/server/auth/operation-registry.ts:42`:
 *
 *     export type AuditClass = 'none' | 'privileged' | 'approval' | 'financial'
 *       | 'export' | 'security';
 *
 * Restated rather than imported, because `apps/web` may not import API source —
 * that boundary is enforced by `validate:module-boundaries`. Restating it is
 * only safe because the assertion below is an INCLUSION check: a class the
 * document publishes that is not named here fails, which is exactly the signal
 * wanted when the backend's vocabulary moves and this tier's understanding of it
 * has gone stale.
 */
const AUDIT_CLASSES: readonly string[] = [
  'none',
  'privileged',
  'approval',
  'financial',
  'export',
  'security',
];

/** Every `crm.*` / `veh.*` operation — the surface P1-27 is about. */
const P1_27_OPERATIONS = PUBLISHED_OPERATIONS.filter((operation) =>
  /^(crm|veh)\./.test(operation.operationId)
);

describe('P1-27-SEC-004 — the published audit class is carried, and asserted', () => {
  it('publishes an audit class for EVERY operation, with none left blank', () => {
    // The generator emits `''` for a missing extension rather than defaulting to
    // `'none'`, precisely so this case can exist. A default would make an
    // operation that declares nothing indistinguishable from one that declares
    // it writes no audit event, and this assertion would then be unable to fail.
    const blank = PUBLISHED_OPERATIONS.filter((operation) => operation.auditClass === '');
    expect(
      blank.map((operation) => `${operation.method} ${operation.template}`),
      'these operations publish no x-audit-class at all'
    ).toEqual([]);
  });

  it('is not vacuous — the table really is populated with distinct classes', () => {
    // Without this, every assertion in this describe would pass against a table
    // whose `auditClass` was `'none'` on all 243 rows, or against a generator
    // that had silently stopped reading the extension.
    expect(PUBLISHED_OPERATIONS.length).toBeGreaterThan(200);
    const distinct = new Set(PUBLISHED_OPERATIONS.map((operation) => operation.auditClass));
    expect(distinct.size).toBeGreaterThan(1);
    expect(distinct.has('none')).toBe(true);
    expect(distinct.has('privileged')).toBe(true);
    expect(distinct.has('security')).toBe(true);
  });

  it('publishes no class outside the backend vocabulary', () => {
    const unknown = [
      ...new Set(
        PUBLISHED_OPERATIONS.map((operation) => operation.auditClass).filter(
          (auditClass) => !AUDIT_CLASSES.includes(auditClass)
        )
      ),
    ];
    expect(unknown, 'unrecognised audit class — has AuditClass changed?').toEqual([]);
  });

  it('never publishes a WRITE without a class — the rule, stated as a rule', () => {
    // Broader than the P1-27 partition below and deliberately so: it holds for
    // every mutation the contract publishes, not only for the two feature trees
    // this phase owns, so a new write in any module is covered the day it lands.
    const writes = PUBLISHED_OPERATIONS.filter(
      (operation) => operation.method !== 'GET' && operation.method !== 'HEAD'
    );
    expect(writes.length).toBeGreaterThan(100);
    const undeclared = writes.filter(
      (operation) => !AUDIT_CLASSES.includes(operation.auditClass) || operation.auditClass === ''
    );
    expect(undeclared.map((operation) => `${operation.method} ${operation.template}`)).toEqual([]);
  });

  it('classifies every P1-27 write as privileged and every P1-27 read as none', () => {
    /*
     * The sentence `task-traceability.md` §4 states in prose, executed.
     *
     * Both halves are asserted because only one of them can fail interestingly
     * on its own: a read that quietly became `privileged` is a change in what
     * the backend records about a lookup, and a write that quietly became
     * `none` is a mutation that stopped being attributable. Currently 27 writes
     * and 28 reads; the floors below are what stop this passing against a filter
     * that matched nothing.
     */
    const reads = P1_27_OPERATIONS.filter((operation) => operation.method === 'GET');
    const writes = P1_27_OPERATIONS.filter((operation) => operation.method !== 'GET');
    expect(reads.length, 'no P1-27 reads were selected').toBeGreaterThanOrEqual(25);
    expect(writes.length, 'no P1-27 writes were selected').toBeGreaterThanOrEqual(25);

    const misclassifiedReads = reads
      .filter((operation) => operation.auditClass !== 'none')
      .map((operation) => `${operation.operationId} is ${operation.auditClass}`);
    const misclassifiedWrites = writes
      .filter((operation) => operation.auditClass !== 'privileged')
      .map((operation) => `${operation.operationId} is ${operation.auditClass}`);

    expect(misclassifiedReads).toEqual([]);
    expect(misclassifiedWrites).toEqual([]);
  });

  it('gives the class of an operation resolved from a CONCRETE path', () => {
    // The table being right is one fact; the client reaching the right row from
    // the path it actually calls is another. These go through the resolver.
    const cases: readonly [string, string, string, string][] = [
      ['POST', '/api/v1/customers/individuals', 'crm.individual-create', 'privileged'],
      ['POST', '/api/v1/customers/abc/merge', 'crm.customer-merge', 'privileged'],
      ['GET', '/api/v1/customers/abc', 'crm.customer-read', 'none'],
      ['POST', '/api/v1/vehicles', 'veh.vehicle-create', 'privileged'],
      ['GET', '/api/v1/vehicles', 'veh.vehicle-search', 'none'],
      ['PATCH', '/api/v1/vehicles/abc/status', 'veh.vehicle-status-change', 'privileged'],
      // Not a P1-27 operation, and named anyway: the attachment authorization the
      // vehicle documents section calls is `security`, not `privileged`, and a
      // rule that only ever saw two values would not notice if it stopped being.
      [
        'POST',
        '/api/v1/attachments/documents/abc/download-authorizations',
        'shared.attachment-download-authorize',
        'security',
      ],
    ];
    for (const [method, path, operationId, auditClass] of cases) {
      const operation = resolveOperation(method, path);
      expect(operation?.operationId, `${method} ${path}`).toBe(operationId);
      expect(operation?.auditClass, `${method} ${path}`).toBe(auditClass);
    }
  });

  it('makes the docblock claims in the feature trees checkable', () => {
    /*
     * The specific sentences that were prose. Each names an operation and a
     * class; each is now the assertion rather than the commentary.
     *
     *  - `features/crm/customers/identity-api.ts:21` — "Both writes here are
     *    `idempotent: true` and both are `auditClass: privileged`".
     *  - `features/vehicles/history-contract.ts:14` — "All three writes are
     *    `idempotent: true` and `auditClass: privileged`".
     *  - `features/vehicles/relations-contract.ts:13` — "All four writes are
     *    `idempotent: true` and `auditClass: privileged`".
     *  - `features/vehicles/catalogue-api.ts:23` — "All `veh.vehicle.read`,
     *    `auditClass: none`".
     */
    const claims: readonly [string, string, boolean][] = [
      ['crm.customer-merge', 'privileged', true],
      ['crm.duplicate-review', 'privileged', true],
      ['veh.vehicle-ownership-transfer', 'privileged', true],
      ['veh.vehicle-plate-assign', 'privileged', true],
      ['veh.vehicle-odometer-record', 'privileged', true],
      ['veh.vehicle-relationship-list', 'none', false],
      ['veh.catalogue-make-list', 'none', false],
      ['veh.catalogue-model-list', 'none', false],
      ['veh.catalogue-trim-list', 'none', false],
      ['veh.catalogue-body-type-list', 'none', false],
      ['veh.catalogue-powertrain-type-list', 'none', false],
    ];
    for (const [operationId, auditClass, idempotent] of claims) {
      const operation = PUBLISHED_OPERATIONS.find(
        (candidate) => candidate.operationId === operationId
      );
      // The lookup itself is asserted: a renamed operation must fail here rather
      // than make the two expectations below vanish into an optional chain.
      expect(operation, `${operationId} is not in the published contract`).toBeDefined();
      expect(operation?.auditClass, operationId).toBe(auditClass);
      expect(operation?.idempotent, operationId).toBe(idempotent);
    }
  });
});

describe('the nine operations this finding was about', () => {
  // Named individually rather than counted, because a count passes against the
  // wrong nine.
  it.each([
    ['PUT', '/api/v1/customers/abc/preferences', 'crm.preference-set'],
    ['PUT', '/api/v1/customers/abc/status', 'crm.customer-status-set'],
    ['PUT', '/api/v1/inspections/abc/items/def', 'dia.diagnostic-item-result'],
    ['PUT', '/api/v1/quality-controls/abc/checks/def', 'qms.qc-check-result'],
    ['PUT', '/api/v1/rework-links/abc/cost', 'qms.rework-cost-record'],
    ['PUT', '/api/v1/additional-work/abc/detail', 'wo.additional-work-detail-record'],
    ['PATCH', '/api/v1/vehicles/abc', 'veh.vehicle-update'],
    ['PATCH', '/api/v1/vehicles/abc/status', 'veh.vehicle-status-change'],
    ['PATCH', '/api/v1/services/abc', 'svc.service-update'],
  ])('%s %s resolves to %s and demands a key', (method, path, operationId) => {
    const operation = resolveOperation(method, path);
    expect(operation?.operationId).toBe(operationId);
    expect(operation?.idempotent).toBe(true);
    expect(requiresIdempotencyKey(method, path)).toBe(true);
  });
});
