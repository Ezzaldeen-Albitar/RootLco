/**
 * Route Handler pipeline (P1-13-BE-021 and every foundation concern it composes).
 *
 * One function assembles the whole request path in a fixed order, so no handler
 * can accidentally skip a step or run two in the wrong sequence:
 *
 *   correlation → rate limit (unauthenticated dimensions) → authenticate →
 *   resolve context → open transaction → authorize → entitlement →
 *   rate limit (tenant/user dimensions) → idempotency → handler → respond
 *
 * The ordering is the security design, not a style choice:
 *
 *  - **rate limiting before authentication** for IP-keyed policies, so a
 *    credential-stuffing loop is throttled without first doing session work;
 *  - **authorization before entitlement**, so an unauthorized caller cannot
 *    probe which features a tenant has bought;
 *  - **both before the handler body**, so a denied request performs no work and
 *    leaves no side effect;
 *  - **idempotency inside the transaction**, so the key and the command commit
 *    together (see `idempotency.ts`).
 *
 * Handlers therefore contain no cross-cutting logic at all. They receive an
 * already-authorized `DbHandle` and return a value. That is what makes the
 * module-boundary rule ("Route Handlers contain no business logic") enforceable:
 * there is nothing left in a handler to enforce against.
 */
import { AppFailure, toAppFailure } from '../errors/app-failure';
import { problemFor, problemHeaders } from '../errors/problem';
import {
  CAUSATION_HEADER,
  CORRELATION_HEADER,
  normalizeInboundCausationId,
  normalizeInboundCorrelationId,
} from '../observability/correlation';
import { log } from '../observability/logger';
import { metrics, METRICS } from '../observability/metrics';
import { captureException } from '../observability/monitoring';
import { contextLogFields, elapsedMs, type RequestContext } from '../context/request-context';
import { resolveRequestContext } from '../context/resolve-context';
import { sessionAuthenticator } from '../context/principal';
import { withTransaction, type DbHandle } from '../db/transaction';
import { requirePermissions, type AuthorizationTarget } from '../auth/authorization';
import { requireFeature } from '../auth/entitlement';
import type { RegisteredOperation } from '../auth/operation-registry';
import {
  IdempotencyRaceError,
  requestFingerprint,
  requireIdempotencyKey,
  resolveRace,
  withIdempotency,
} from './idempotency';
import { parseIfMatch, toETag } from '../db/concurrency';
import { RATE_LIMIT_POLICIES, enforceRateLimit } from './rate-limit';
import { resolveClientAddress } from './trusted-proxy';
import { backendConfig } from '../config/backend-config';
import { recordSecurityEvent } from '../audit/security-events';

/** What a handler returns. `status` defaults to 200. */
export interface HandlerResult<T> {
  readonly body: T;
  readonly status?: number;
  /** Current `record_version`, emitted as an ETag for versioned resources. */
  readonly recordVersion?: number;
}

export interface HandlerInput {
  readonly db: DbHandle;
  readonly context: RequestContext;
  readonly request: Request;
  /** Route parameters, already validated by the caller's schema. */
  readonly params: Readonly<Record<string, string>>;
  /** Expected record version from `If-Match`, when the operation is guarded. */
  readonly expectedVersion: number | null;
}

export type OperationHandler<T> = (input: HandlerInput) => Promise<HandlerResult<T>>;

export interface RouteOptions {
  /** Route parameters from the framework. */
  readonly params?: Record<string, string>;
  /** Scope narrowing the caller requested, already validated. Never trusted. */
  readonly requestedScope?: { companyIds?: readonly string[]; branchIds?: readonly string[] };
  /** Target for scoped permission evaluation. */
  readonly authorizationTarget?: AuthorizationTarget;
  /** Parsed body, used for the idempotency fingerprint. */
  readonly body?: unknown;
  /** Peer address from the platform. Never read from a header. */
  readonly peerAddress?: string | null;
}

function successHeaders(correlationId: string, recordVersion?: number): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    [CORRELATION_HEADER]: correlationId,
    // API responses carrying authenticated business data are never publicly
    // cacheable — the CDN readiness contract depends on this default holding.
    'Cache-Control': 'no-store, private',
    ...(recordVersion !== undefined ? { ETag: toETag(recordVersion) } : {}),
  };
}

function policyFor(operation: RegisteredOperation) {
  const name = operation.rateLimitPolicy;
  if (!name) return undefined;
  const policy = RATE_LIMIT_POLICIES[name];
  if (!policy) {
    throw new Error(`Operation ${operation.id} references unknown rate-limit policy "${name}"`);
  }
  return policy;
}

/**
 * Executes a registered operation end to end and returns a `Response`.
 *
 * Every exit path — success, denial, validation failure, unhandled fault —
 * carries the correlation ID, and every failure is a problem document.
 */
export async function handleOperation<T>(
  operation: RegisteredOperation,
  request: Request,
  handler: OperationHandler<T>,
  options: RouteOptions = {}
): Promise<Response> {
  const { correlationId, inboundAccepted } = normalizeInboundCorrelationId(
    request.headers.get(CORRELATION_HEADER)
  );
  const causationId = normalizeInboundCausationId(request.headers.get(CAUSATION_HEADER));
  const startedAt = performance.now();
  const config = backendConfig();
  const policy = policyFor(operation);
  const preAuthPolicy =
    policy && !policy.keyBy.includes('tenant') && !policy.keyBy.includes('user')
      ? policy
      : undefined;
  const postAuthPolicy = policy && preAuthPolicy === undefined ? policy : undefined;

  let context: RequestContext | undefined;

  try {
    if (!inboundAccepted && request.headers.get(CORRELATION_HEADER)) {
      // Observable, not silent: an invalid inbound correlation ID is a client
      // defect or an injection attempt, and either is worth a record.
      log.warn('Rejected inbound correlation id; generated a new one', {
        module: operation.module,
        operation: operation.id,
        correlationId,
        result: 'skipped',
      });
    }

    const client = resolveClientAddress({
      ...(options.peerAddress !== undefined ? { peerAddress: options.peerAddress } : {}),
      headers: request.headers,
    });

    if (preAuthPolicy && config.RATE_LIMIT_ENABLED) {
      await enforceRateLimit(preAuthPolicy, {
        operation: operation.id,
        clientIp: client.ip,
      });
    }

    if (operation.public) {
      const result = await handlePublic(operation, request, handler, options, correlationId);
      return result;
    }

    const claims = await sessionAuthenticator().authenticate(request);
    if (!claims) {
      throw new AppFailure('ERR-IAM-002', { message: 'No authenticated session' });
    }

    context = await resolveRequestContext({
      claims,
      correlationId,
      causationId,
      operation: operation.id,
      module: operation.module,
      ...(options.requestedScope ? { requestedScope: options.requestedScope } : {}),
    });

    if (postAuthPolicy && config.RATE_LIMIT_ENABLED) {
      await enforceRateLimit(postAuthPolicy, {
        operation: operation.id,
        tenantId: context.principal.tenantId,
        userId: context.principal.userId,
        clientIp: client.ip,
      });
    }

    const expectedVersion = parseIfMatch(request.headers, operation.versionGuarded === true);
    const idempotencyKey = operation.idempotent ? requireIdempotencyKey(request.headers) : null;
    // Bound to the resolved context, never to anything the caller sent: the
    // principal component comes from `context.principal`, which the resolver
    // built from the session and the database (ADV-04).
    const fingerprint = idempotencyKey
      ? requestFingerprint(context, {
          method: operation.method,
          path: operation.path,
          body: options.body ?? null,
        })
      : null;

    const run = async (): Promise<HandlerResult<T>> =>
      withTransaction(context as RequestContext, async (db) => {
        await requirePermissions(db, operation, options.authorizationTarget ?? {});
        if (operation.featureFlag) await requireFeature(db, operation.featureFlag);

        const execute = () =>
          handler({
            db,
            context: db.context,
            request,
            params: Object.freeze({ ...(options.params ?? {}) }),
            expectedVersion,
          });

        if (!idempotencyKey || !fingerprint) return execute();

        const outcome = await withIdempotency(
          db,
          { operationId: operation.id, key: idempotencyKey, fingerprint },
          execute,
          (value) => value.body
        );
        return outcome.replayed
          ? ({ body: outcome.value as T } as HandlerResult<T>)
          : (outcome.value as HandlerResult<T>);
      });

    let result: HandlerResult<T>;
    try {
      result = await run();
    } catch (error) {
      if (!(error instanceof IdempotencyRaceError)) throw error;
      // Another transaction won the key while this one executed. This
      // transaction rolled back, so nothing partial committed; re-read the
      // winner's stored response on a fresh transaction.
      const stored = await withTransaction(context, async (db) => resolveRace(db, error));
      result = { body: stored.response as T };
    }

    const durationMs = elapsedMs(context);
    metrics().increment(METRICS.requestCount, { operation: operation.id, result: 'success' });
    metrics().observe(METRICS.requestDuration, durationMs, { operation: operation.id });
    log.info('Operation completed', {
      ...contextLogFields(context),
      durationMs,
      result: 'success',
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: successHeaders(
        correlationId,
        ...(result.recordVersion !== undefined ? [result.recordVersion] : [])
      ),
    });
  } catch (error) {
    return respondWithFailure(operation, error, correlationId, startedAt, context);
  }
}

/** Public (unauthenticated) path: no context, no transaction, no database. */
async function handlePublic<T>(
  operation: RegisteredOperation,
  request: Request,
  handler: OperationHandler<T>,
  options: RouteOptions,
  correlationId: string
): Promise<Response> {
  const result = await handler({
    // A public operation has no context and therefore no database handle. The
    // types make that explicit rather than handing over a half-built one.
    db: undefined as unknown as DbHandle,
    context: undefined as unknown as RequestContext,
    request,
    params: Object.freeze({ ...(options.params ?? {}) }),
    expectedVersion: null,
  });
  metrics().increment(METRICS.requestCount, { operation: operation.id, result: 'success' });
  return new Response(JSON.stringify(result.body), {
    status: result.status ?? 200,
    headers: successHeaders(correlationId),
  });
}

function respondWithFailure(
  operation: RegisteredOperation,
  error: unknown,
  correlationId: string,
  startedAt: number,
  context: RequestContext | undefined
): Response {
  const failure = toAppFailure(error);
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));

  metrics().increment(METRICS.errorCount, { operation: operation.id, code: failure.code });
  metrics().increment(METRICS.requestCount, { operation: operation.id, result: 'failure' });

  const fields = context
    ? contextLogFields(context)
    : { module: operation.module, operation: operation.id, correlationId };

  log.warn('Operation failed', {
    ...fields,
    durationMs,
    result: failure.code === 'ERR-RTE-001' ? 'throttled' : 'failure',
    errorCode: failure.code,
  });

  // Only genuine server faults reach error monitoring. Sending every 403 and 422
  // there turns the monitor into a second access log and buries real incidents.
  if (failure.status >= 500) {
    captureException(failure.cause ?? failure, {
      correlationId,
      errorCode: failure.code,
      module: operation.module,
      operation: operation.id,
      ...(context
        ? { tenantRef: context.principal.tenantId, actorRef: context.principal.userId }
        : {}),
    });
  }

  return new Response(JSON.stringify(problemFor(failure, correlationId)), {
    status: failure.status,
    headers: problemHeaders(failure, correlationId),
  });
}

/**
 * Emits the security-event candidate for a denial. Called by handlers that hold
 * a transaction; the pipeline itself denies before one exists for authentication
 * failures, which is why this is a separate, explicit call.
 */
export async function noteDenial(db: DbHandle, operation: RegisteredOperation): Promise<void> {
  await recordSecurityEvent(db, {
    eventType: 'authorization.denied',
    severity: 'warning',
    detail: `Operation ${operation.id} denied`,
  });
}
