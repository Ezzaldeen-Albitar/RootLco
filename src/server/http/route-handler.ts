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
import {
  requirePermissions,
  requireScopedPermissions,
  type AuthorizationTarget,
  type ScopeAuthorizer,
} from '../auth/authorization';
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
import { RATE_LIMIT_POLICIES, enforceRateLimit, type RateLimitPolicy } from './rate-limit';
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
  /**
   * The correlation ID this request will answer with (P1-14).
   *
   * Authenticated handlers can read it off `context`; a **public** handler has no
   * context, and re-deriving it from the headers would mint a *different* UUID
   * whenever the caller supplied none — so the log would disagree with the
   * `X-Correlation-Id` the caller received. Passing it removes that trap.
   */
  readonly correlationId: string;
  /**
   * Re-evaluates this operation's permissions against a scope discovered INSIDE
   * the transaction (P1-18-A-01).
   *
   * The pre-handler check runs before anything is read, so an operation
   * addressed by id — `POST /receptions/{receptionId}/approve` and the nine
   * others like it — has no company or branch to name yet. With an empty target
   * `requiresScopedEvaluation` returns false whatever the declared scope is, and
   * the check falls back to `iam.has_permission`, which does not consult grant
   * scope at all. RLS cannot make up the difference: `app.branch_ids` is the
   * union of every active grant regardless of which permission it carries, so a
   * principal holding this permission in branch B1 and any grant at all in B2
   * both passes the check and sees the B2 row.
   *
   * Calling this once the row is locked closes that: the target is the row's own
   * company and branch, the evaluation is `iam.has_permission_in_scope`, and a
   * denial throws inside the transaction so nothing it would have written
   * survives. The permission codes stay in `defineOperation` — this re-runs the
   * operation's own declaration rather than restating it.
   */
  readonly authorizeScope: ScopeAuthorizer;
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

/** A policy a request with no session can actually be keyed by. */
function isSessionless(policy: RateLimitPolicy): boolean {
  return !policy.keyBy.includes('tenant') && !policy.keyBy.includes('user');
}

/**
 * Resolves the rate-limit policy a registered operation is actually throttled by.
 *
 * Exported for tests. It is the one place where a *declared* policy and an
 * *enforced* policy can diverge, and a defect here is silent by construction —
 * the route still works, it is just throttled by something other than what its
 * own registration says. That is exactly the shape that needs a direct
 * assertion rather than an end-to-end one.
 */
export function policyFor(operation: RegisteredOperation): RateLimitPolicy | undefined {
  const name = operation.rateLimitPolicy;
  const declared = name ? RATE_LIMIT_POLICIES[name] : undefined;
  if (name && !declared) {
    throw new Error(`Operation ${operation.id} references unknown rate-limit policy "${name}"`);
  }

  if (!operation.public) return declared;

  // A public operation has no tenant and no user, so a policy keyed on either
  // would put every caller in the world into one bucket. Such a policy is
  // replaced — and so is *no policy at all*, because `defineOperation()` does
  // not require one and an unthrottled public route is the defect this branch
  // exists to prevent.
  //
  // A declared policy that is already sessionless is KEPT, and that distinction
  // is load-bearing: the four unauthenticated `iam.auth-*` operations declare
  // `auth-adjacent` (10/min, `securityRelevant: true`), and an earlier version of
  // this function substituted `public-probe` (120/min, not security-relevant) for
  // them unconditionally. That silently gave credential stuffing twelve times the
  // budget and stopped a breach raising a security signal, while their own
  // `publicReason` text still said they were bounded by `auth-adjacent`. Keeping a
  // sessionless declaration means the substitution can only ever make a public
  // route *more* throttled, never less.
  if (declared && isSessionless(declared)) return declared;

  const publicPolicy = RATE_LIMIT_POLICIES['public-probe'];
  if (!publicPolicy) {
    throw new Error('The "public-probe" rate-limit policy is missing from the catalogue');
  }
  return publicPolicy;
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
  // A `public: true` operation never reaches the post-authentication throttle,
  // because it never authenticates. Until this was fixed (P1-15-SR-004) a policy
  // keyed by tenant or user — which is most of them — meant a public route was
  // throttled by nothing at all, and the two health probes are the most exposed
  // endpoints in the deployment. For a public operation the policy is therefore
  // enforced BEFORE the handler, keyed by operation and client address, which
  // are the only dimensions that exist without a session.
  const preAuthPolicy =
    policy &&
    (operation.public || (!policy.keyBy.includes('tenant') && !policy.keyBy.includes('user')))
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

    // A policy keyed on `ip` degrades to ONE GLOBAL BUCKET when no client
    // address can be resolved, and `resolveClientAddress` returns null unless
    // the platform supplies a peer address or a trusted proxy is configured.
    //
    // For a liveness probe that is worse than no limit: a hostile caller could
    // exhaust the shared bucket and the orchestrator's own probe would start
    // receiving 429, which the orchestrator reads as an unhealthy pod. The
    // control would cause the outage it exists to prevent.
    //
    // That argument is about the probe, NOT about the route being public, and
    // writing the condition against `operation.public` alone silently extended
    // it to the four unauthenticated `iam.auth-*` routes — which meant login,
    // logout and password reset were throttled by nothing in a deployment with
    // no peer address, while their own `publicReason` text said they were
    // bounded at ten a minute. Before P1-15 the pre-auth branch had no skip at
    // all, so this phase *removed* a control the previous phase shipped
    // (PMR-006 / R-14).
    //
    // So the exemption belongs to the property the argument is about: a policy
    // that is not `securityRelevant`. `public-probe` keeps it; `auth-adjacent`
    // never gets it and degrades to the coarse bucket instead. A security
    // control is never dropped for want of a key. The coarse bucket's own
    // availability exposure is real and is recorded as R-14 rather than
    // papered over — see the readiness section of
    // `docs/phase-1/phase-1-15/health-endpoints.md`.
    const skipUnkeyedPublicThrottle =
      operation.public &&
      preAuthPolicy?.keyBy.includes('ip') === true &&
      preAuthPolicy.securityRelevant === false &&
      !client.ip;

    if (preAuthPolicy && config.RATE_LIMIT_ENABLED && !skipUnkeyedPublicThrottle) {
      await enforceRateLimit(preAuthPolicy, {
        operation: operation.id,
        clientIp: client.ip,
      });
    }

    if (operation.public) {
      return handlePublic(operation, request, handler, options, correlationId);
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
          // The registered TEMPLATE plus the RESOLVED parameters. The template
          // alone is identical for every target of a parameterised route, so
          // binding it alone let one key replay across resources (P1-15-SR-002).
          path: operation.path,
          params: options.params ?? {},
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
            correlationId,
            // `requireScopedPermissions`, not `requirePermissions`: the deferred
            // check fails closed on an empty target, because reaching it without
            // the resource's own scope would degrade to a scope-blind evaluation
            // and reopen P1-18-A-01 through this very API.
            authorizeScope: (target: AuthorizationTarget) =>
              requireScopedPermissions(db, operation, target),
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
    correlationId,
    // A public operation has no principal and no transaction, so there is nothing
    // to re-authorize against. Failing loudly is right: a public handler asking
    // for a scoped decision is a coding error, not a denial to report to the
    // caller, and returning "allowed" would be the dangerous reading.
    authorizeScope: () => {
      throw new Error(`Operation ${operation.id} is public and cannot authorize a scope`);
    },
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
