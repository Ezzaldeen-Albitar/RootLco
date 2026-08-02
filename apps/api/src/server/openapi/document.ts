/**
 * OpenAPI foundation (P1-13-BE-020).
 *
 * The document is **generated from the operation registry**, not hand-written
 * alongside it. That is the only way "the spec matches the code" can be a
 * checked fact rather than a promise: a registered operation appears in the
 * document automatically, and an operation removed from the code disappears
 * from it. The committed `docs/api/openapi.v1.json` is compared against a fresh
 * generation in CI, so any divergence fails the build.
 *
 * What is derived from the registry, per operation: path, method, operationId,
 * summary, security, the required-permission extension, and the
 * `Idempotency-Key` / `If-Match` parameters implied by its declared guards.
 * Nothing is written twice, so nothing can disagree.
 *
 * Shared components (problem document, pagination envelope, money, correlation
 * header) are defined once here and referenced everywhere, so eleven backend
 * phases cannot each invent their own error shape.
 */
import { allErrorDefinitions } from '../errors/catalog';
import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPE_PREFIX } from '../errors/problem';
import { CORRELATION_HEADER } from '../observability/correlation';
import { IDEMPOTENCY_HEADER } from '../http/idempotency';
import { IF_MATCH_HEADER } from '../db/concurrency';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../db/pagination';
import { allOperations, type RegisteredOperation } from '../auth/operation-registry';
import { DESCRIPTIVE_TITLE, VENDOR_NAME } from '@/shared/constants/app';

export const OPENAPI_VERSION = '3.1.0';
export const API_VERSION_PREFIX = '/api/v1';
/** Bumped when the *contract* changes, independently of the app version. */
export const API_CONTRACT_VERSION = '0.1.0';

type JsonObject = Record<string, unknown>;

function problemSchema(): JsonObject {
  return {
    type: 'object',
    description: 'RFC 9457 problem document. Every failure response in this API uses this shape.',
    required: ['type', 'title', 'status', 'code', 'correlationId'],
    properties: {
      type: { type: 'string', format: 'uri', examples: [`${PROBLEM_TYPE_PREFIX}ERR-VAL-001`] },
      title: { type: 'string' },
      status: { type: 'integer' },
      code: {
        type: 'string',
        description: 'Stable catalog code. Clients branch on this, never on the title.',
        enum: allErrorDefinitions().map((definition) => definition.code),
      },
      correlationId: { type: 'string', format: 'uuid' },
      violations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'rule'],
          properties: { path: { type: 'string' }, rule: { type: 'string' } },
        },
      },
      retryAfterSeconds: { type: 'integer', minimum: 0 },
      contract: { type: 'string' },
      requiredPermissions: { type: 'array', items: { type: 'string' } },
    },
  };
}

function sharedComponents(): JsonObject {
  return {
    securitySchemes: {
      /**
       * Bearer, not cookie (P1-14, ADR-019).
       *
       * P1-13 reserved a `sessionCookie` scheme in anticipation. P1-14 ships
       * bearer tokens instead: with no ambient credential, a cross-site request
       * cannot attach one, so CSRF is removed from the threat model by
       * construction rather than mitigated. A browser cookie design, with the
       * SameSite/HttpOnly/Secure and double-submit machinery it needs, is a
       * decision for the phase that introduces a browser client.
       */
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token issued by the authentication provider (ADR-019). Verified locally on ' +
          'every request: signature, issuer, audience, algorithm allow-list, expiry, and bounded ' +
          'clock skew. The token proves identity only — permissions and scope are resolved from ' +
          'the database per request, so a revoked grant stops working immediately rather than at ' +
          'token expiry.',
      },
    },
    schemas: {
      ProblemDocument: problemSchema(),
      Money: {
        type: 'object',
        description:
          'Exact decimal amount as a string plus an ISO-4217 code. Never a JSON number: ' +
          'IEEE-754 cannot represent decimal money exactly.',
        required: ['amount', 'currency'],
        properties: {
          amount: { type: 'string', pattern: '^-?\\d{1,15}(\\.\\d{1,6})?$' },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        },
      },
      PageEnvelope: {
        type: 'object',
        description: 'Opaque-cursor page. Offset paging is not offered.',
        required: ['items', 'hasMore'],
        properties: {
          items: { type: 'array', items: {} },
          nextCursor: { type: ['string', 'null'] },
          hasMore: { type: 'boolean' },
        },
      },
    },
    parameters: {
      IdempotencyKey: {
        name: IDEMPOTENCY_HEADER,
        in: 'header',
        required: true,
        description:
          'Client-generated key, 8–200 characters. Replaying the same key with the same request ' +
          'returns the original result; the same key with a different request is rejected.',
        schema: { type: 'string', minLength: 8, maxLength: 200 },
      },
      IfMatch: {
        name: IF_MATCH_HEADER,
        in: 'header',
        required: true,
        description: 'Expected record version for optimistic concurrency.',
        schema: { type: 'string' },
      },
      CorrelationId: {
        name: CORRELATION_HEADER,
        in: 'header',
        required: false,
        description:
          'Optional caller-supplied correlation ID. Accepted only when it is a valid UUID; ' +
          'anything else is replaced with a generated one.',
        schema: { type: 'string', format: 'uuid' },
      },
      Cursor: {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string', maxLength: 512 },
      },
      Limit: {
        name: 'limit',
        in: 'query',
        required: false,
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_PAGE_SIZE,
          default: DEFAULT_PAGE_SIZE,
        },
      },
    },
    headers: {
      CorrelationId: {
        description: 'Correlation ID for this request. Present on every response.',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      ETag: {
        description: 'Current record version, for optimistic concurrency.',
        schema: { type: 'string' },
      },
      RetryAfter: {
        description: 'Seconds to wait before retrying a throttled request.',
        schema: { type: 'integer' },
      },
    },
    responses: {
      Problem: {
        description: 'Failure. Always an RFC 9457 problem document.',
        headers: { [CORRELATION_HEADER]: { $ref: '#/components/headers/CorrelationId' } },
        content: {
          [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDocument' } },
        },
      },
    },
  };
}

/** Failure responses every operation can produce, derived from the catalog. */
function standardFailureResponses(operation: RegisteredOperation): JsonObject {
  const responses: JsonObject = {
    '422': { $ref: '#/components/responses/Problem' },
    '500': { $ref: '#/components/responses/Problem' },
  };
  if (!operation.public) {
    responses['401'] = { $ref: '#/components/responses/Problem' };
    responses['403'] = { $ref: '#/components/responses/Problem' };
  }
  if (operation.idempotent) responses['409'] = { $ref: '#/components/responses/Problem' };
  if (operation.versionGuarded) {
    responses['409'] = { $ref: '#/components/responses/Problem' };
    responses['428'] = { $ref: '#/components/responses/Problem' };
  }
  if (operation.rateLimitPolicy) responses['429'] = { $ref: '#/components/responses/Problem' };
  return responses;
}

function operationObject(operation: RegisteredOperation): JsonObject {
  const parameters: JsonObject[] = [{ $ref: '#/components/parameters/CorrelationId' }];
  if (operation.idempotent) parameters.push({ $ref: '#/components/parameters/IdempotencyKey' });
  if (operation.versionGuarded) parameters.push({ $ref: '#/components/parameters/IfMatch' });

  return {
    operationId: operation.id,
    summary: operation.summary,
    tags: [operation.module],
    parameters,
    security: operation.public ? [] : [{ bearerAuth: [] }],
    responses: {
      '200': {
        description: 'Success.',
        headers: { [CORRELATION_HEADER]: { $ref: '#/components/headers/CorrelationId' } },
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      ...standardFailureResponses(operation),
    },
    // Machine-readable authorization metadata: the same declaration the runtime
    // enforces, so a reviewer can diff intent against behaviour.
    'x-required-permissions': operation.permissions,
    'x-scope': operation.scope,
    'x-audit-class': operation.auditClass,
    ...(operation.featureFlag ? { 'x-feature-flag': operation.featureFlag } : {}),
    ...(operation.rateLimitPolicy ? { 'x-rate-limit-policy': operation.rateLimitPolicy } : {}),
    ...(operation.cacheCategory ? { 'x-cache-category': operation.cacheCategory } : {}),
  };
}

/**
 * The document's own `summary` is DERIVED, not written (P1-24-F-003).
 *
 * It used to read "Backend foundation (Phase 1-13) plus the authentication,
 * authorization, and administration surface (Phase 1-14)". By P1-23 the document
 * published 226 operations across nineteen modules, and its own description still
 * named two phases — so a client reading the contract to decide what the API
 * covers was told it was a fraction of its real size, and every gate stayed green
 * because no check compares prose against the registry.
 *
 * Counting from `allOperations()` is the fix that cannot go stale again: the
 * sentence is regenerated with the document, and the drift test that already
 * guards the paths now guards this too.
 */
function describeSurface(operations: readonly RegisteredOperation[]): string {
  const modules = [...new Set(operations.map((operation) => operation.module))].sort();
  return (
    `${operations.length} operations across ${modules.length} backend modules ` +
    `(${modules.join(', ')}).`
  );
}

/** Builds the full document from the registry. Deterministic: sorted by path. */
export function buildOpenApiDocument(): JsonObject {
  const operations = allOperations();
  const paths: JsonObject = {};
  for (const operation of operations) {
    const fullPath = `${API_VERSION_PREFIX}${operation.path}`;
    const existing = (paths[fullPath] as JsonObject | undefined) ?? {};
    existing[operation.method.toLowerCase()] = operationObject(operation);
    paths[fullPath] = existing;
  }

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: `${DESCRIPTIVE_TITLE} — API`,
      version: API_CONTRACT_VERSION,
      summary: describeSurface(operations),
      description:
        'Shared components and conventions every backend module composes, and the operations ' +
        'built on them. Sessions are bearer tokens issued by the authentication provider ' +
        'recorded in ADR-019; authorization is evaluated in the database on every request and is ' +
        'never carried in a token. Money is an exact decimal string with an ISO-4217 code, never ' +
        'a JSON number. Pages are opaque-cursor; offset paging is not offered. Every failure is ' +
        'an RFC 9457 problem document carrying a stable catalog code. The product name is ' +
        'deliberately absent: it is pending owner approval (ADR-011).',
      contact: { name: VENDOR_NAME },
    },
    servers: [{ url: '/', description: 'Same-origin. No public base URL is provisioned.' }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: sharedComponents(),
  };
}
