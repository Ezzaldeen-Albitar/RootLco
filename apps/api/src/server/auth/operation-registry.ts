/**
 * Operation registry (P1-13-BE-005, P1-13-SEC-001, P1-13-SEC-004).
 *
 * Every Route Handler and Server Action declares itself here *before* it can be
 * invoked. The declaration is the security metadata: required permission codes,
 * scope requirement, audit action class, entitlement flag, idempotency and
 * version guards, rate-limit policy, and cache eligibility.
 *
 * Why a registry rather than per-handler decorators alone:
 *
 *  - **An unguarded operation cannot exist.** `defineOperation()` rejects a
 *    declaration with no permission codes, and rejects an audited class with no
 *    audit action. The failure happens at module load, so it surfaces in the
 *    build and in tests, not in production.
 *  - **Coverage is checkable.** `scripts/check-authorization-coverage.mjs` walks
 *    the registry and the route tree together and fails CI when a route exists
 *    without a registration, or a registration exists without a route.
 *  - **The OpenAPI document is derived from the same source**, so code/spec
 *    divergence is detectable rather than aspirational.
 *
 * `public: true` exists for genuinely unauthenticated endpoints (health probes).
 * It is deliberately verbose to write and is reported by the coverage check, so
 * it can never be the quiet default.
 *
 * P1-14 additionally checks `auditAction` against the controlled audit-action
 * catalog (`audit-actions.ts`). Presence was never enough: two operations
 * recording the same fact under different spellings produce an audit trail that
 * cannot be queried completely, and the table is append-only so the divergence
 * cannot be repaired afterwards.
 */
import { auditActionViolation } from './audit-actions';

/** Which scope the operation must resolve before the handler body runs. */
export type ScopeRequirement = 'tenant' | 'company' | 'branch';

/**
 * Audit classes from FR-AUD-001. Anything other than `none` MUST carry an audit
 * action code, and the transaction wrapper emits exactly one audit record.
 */
export type AuditClass = 'none' | 'privileged' | 'approval' | 'financial' | 'export' | 'security';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OperationDeclaration {
  /** Stable identifier, `<module>.<operation>`. Appears in logs and OpenAPI. */
  readonly id: string;
  readonly module: string;
  readonly method: HttpMethod;
  /** Path under the version prefix, e.g. `/meta/ping`. */
  readonly path: string;
  /** Human summary. Becomes the OpenAPI `summary`. */
  readonly summary: string;
  /**
   * Permission codes evaluated by the authorization middleware. ALL must pass
   * (conjunction) — an operation needing "any of" is two operations.
   * Required unless `public` is true.
   */
  readonly permissions?: readonly string[];
  /** Unauthenticated endpoint. Must be justified in `publicReason`. */
  readonly public?: boolean;
  readonly publicReason?: string;
  readonly scope?: ScopeRequirement;
  readonly auditClass?: AuditClass;
  /** Audit action code, e.g. `iam.role.granted`. Required unless class is none. */
  readonly auditAction?: string;
  /** Feature flag code checked against `org.resolve_feature_enabled`. */
  readonly featureFlag?: string;
  /** Requires an `Idempotency-Key` header (FR-INT-002). */
  readonly idempotent?: boolean;
  /** Requires an `If-Match` record version (optimistic concurrency). */
  readonly versionGuarded?: boolean;
  /** Rate-limit policy name from `rate-limit-policies.ts`. */
  readonly rateLimitPolicy?: string;
  /** Whether responses may be cached, and under which eligibility category. */
  readonly cacheCategory?: string;
}

export interface RegisteredOperation extends OperationDeclaration {
  readonly permissions: readonly string[];
  readonly scope: ScopeRequirement;
  readonly auditClass: AuditClass;
  readonly public: boolean;
}

const registry = new Map<string, RegisteredOperation>();

/** Path/method pairs, to catch two operations claiming the same route. */
const routeIndex = new Map<string, string>();

export class OperationRegistrationError extends Error {
  public override readonly name = 'OperationRegistrationError';
}

const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
/**
 * Each segment is either a lower-case literal or a `{camelCase}` parameter.
 *
 * P1-13's pattern was a character class, which accepted `/a{b}c}` and rejected
 * `{userId}` (no upper case) — fine while no route had a parameter, wrong as
 * soon as one did. This form states the grammar instead of the alphabet.
 */
const PATH_PATTERN = /^(?:\/(?:[a-z0-9-]+|\{[a-z][a-zA-Z0-9]*\}))+$/;

/**
 * Registers an operation. Throws — loudly, at import time — when the declaration
 * is incomplete. This function is the "unguarded operation cannot be registered"
 * control the phase plan requires.
 */
export function defineOperation(declaration: OperationDeclaration): RegisteredOperation {
  if (!ID_PATTERN.test(declaration.id)) {
    throw new OperationRegistrationError(
      `Operation id "${declaration.id}" must be dotted lower-case, e.g. "meta.ping".`
    );
  }
  if (registry.has(declaration.id)) {
    throw new OperationRegistrationError(`Operation "${declaration.id}" is already registered.`);
  }
  if (!PATH_PATTERN.test(declaration.path)) {
    throw new OperationRegistrationError(
      `Operation "${declaration.id}" has a path that is not a lower-case API path: ${declaration.path}`
    );
  }

  const isPublic = declaration.public === true;
  const permissions = declaration.permissions ?? [];

  if (!isPublic && permissions.length === 0) {
    throw new OperationRegistrationError(
      `Operation "${declaration.id}" declares no permission codes. Every operation is ` +
        'authorized server-side; mark it `public: true` with a `publicReason` only if it is ' +
        'genuinely unauthenticated.'
    );
  }
  if (isPublic && !declaration.publicReason) {
    throw new OperationRegistrationError(
      `Operation "${declaration.id}" is public but gives no publicReason.`
    );
  }
  if (isPublic && permissions.length > 0) {
    throw new OperationRegistrationError(
      `Operation "${declaration.id}" is public and also declares permissions. Choose one.`
    );
  }

  const auditClass = declaration.auditClass ?? 'none';
  if (auditClass !== 'none' && !declaration.auditAction) {
    throw new OperationRegistrationError(
      `Operation "${declaration.id}" is audit class "${auditClass}" but declares no auditAction ` +
        '(FR-AUD-001).'
    );
  }
  if (auditClass === 'none' && declaration.auditAction) {
    throw new OperationRegistrationError(
      `Operation "${declaration.id}" declares an auditAction but audit class "none".`
    );
  }
  const catalogViolation = auditActionViolation(
    declaration.id,
    auditClass,
    declaration.auditAction
  );
  if (catalogViolation) {
    throw new OperationRegistrationError(catalogViolation);
  }

  const routeKey = `${declaration.method} ${declaration.path}`;
  const existing = routeIndex.get(routeKey);
  if (existing) {
    throw new OperationRegistrationError(
      `Route ${routeKey} is already claimed by operation "${existing}".`
    );
  }

  const registered: RegisteredOperation = {
    ...declaration,
    permissions,
    scope: declaration.scope ?? 'tenant',
    auditClass,
    public: isPublic,
  };
  registry.set(registered.id, registered);
  routeIndex.set(routeKey, registered.id);
  return registered;
}

export function getOperation(id: string): RegisteredOperation | undefined {
  return registry.get(id);
}

/** Every registered operation, sorted by id for deterministic output. */
export function allOperations(): readonly RegisteredOperation[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test seam: clears the registry so a suite can re-register fixtures. */
export function __resetOperationRegistryForTests(): void {
  registry.clear();
  routeIndex.clear();
}
