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
