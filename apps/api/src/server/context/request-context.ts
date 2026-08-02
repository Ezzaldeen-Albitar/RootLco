/**
 * Authenticated request context (P1-13-BE-004).
 *
 * The context is the single carrier of "who is asking, on behalf of which
 * tenant, within which companies and branches". Three properties make it safe:
 *
 *  1. **Server-resolved.** Every field originates from the authenticated session
 *     and the database (`resolve-context.ts`). No field is ever populated from a
 *     request body, query string, or header. Client-supplied scope values are
 *     validation inputs at most — the resolver reads them only to *reject*
 *     requests that ask for scope the principal does not hold.
 *  2. **Immutable.** The object and its arrays are frozen at construction, so a
 *     downstream service cannot widen its own scope halfway through a request.
 *  3. **Explicit.** There is no ambient/global context. It is passed as an
 *     argument, so a repository that forgot it does not compile.
 *
 * `companyIds`/`branchIds` are the *narrowing* the request runs under. An empty
 * array means "no narrowing beyond the tenant" — matching the database contract,
 * where an unset `app.company_ids` means tenant scope (see
 * `iam.allowed_company_ids`).
 */

/** The authenticated principal, resolved server-side. */
export interface Principal {
  /** `iam.user_accounts.id`. */
  readonly userId: string;
  /** `org.tenants.id`. Exactly one tenant per request, always. */
  readonly tenantId: string;
}

/** Immutable per-request context. */
export interface RequestContext {
  readonly correlationId: string;
  /** The command/event that caused this request, when the caller supplied one. */
  readonly causationId: string | null;
  readonly principal: Principal;
  /** Company narrowing. Empty = tenant scope. */
  readonly companyIds: readonly string[];
  /** Branch narrowing. Empty = no branch narrowing. */
  readonly branchIds: readonly string[];
  /** Registered operation identifier, e.g. `meta.ping`. */
  readonly operation: string;
  /** Owning module, e.g. `meta`. */
  readonly module: string;
  /** Request start, for duration measurement. Monotonic where available. */
  readonly startedAtMs: number;
  /** Wall-clock start, for records that need a timestamp. */
  readonly startedAt: Date;
}

export interface BuildContextInput {
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly principal: Principal;
  readonly companyIds?: readonly string[];
  readonly branchIds?: readonly string[];
  readonly operation: string;
  readonly module: string;
  readonly now?: Date;
  readonly startedAtMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): string {
  if (!UUID.test(value)) {
    // Never echo the offending value: it arrived from an untrusted boundary in
    // at least one code path, and this message reaches logs.
    throw new Error(`RequestContext.${field} is not a UUID`);
  }
  return value.toLowerCase();
}

function normalizeIds(values: readonly string[] | undefined, field: string): readonly string[] {
  if (!values || values.length === 0) return Object.freeze([]);
  const unique = [...new Set(values.map((value) => assertUuid(value, field)))].sort();
  return Object.freeze(unique);
}

/**
 * Builds a frozen context. Validates every identifier: a malformed UUID reaching
 * `set_config` would surface as a database error rather than a clean denial, and
 * `iam.current_tenant_id()` deliberately treats an invalid value as "no context"
 * — silently losing the tenant instead of failing loudly.
 */
export function buildRequestContext(input: BuildContextInput): RequestContext {
  const context: RequestContext = {
    correlationId: assertUuid(input.correlationId, 'correlationId'),
    causationId: input.causationId ? assertUuid(input.causationId, 'causationId') : null,
    principal: Object.freeze({
      userId: assertUuid(input.principal.userId, 'principal.userId'),
      tenantId: assertUuid(input.principal.tenantId, 'principal.tenantId'),
    }),
    companyIds: normalizeIds(input.companyIds, 'companyIds'),
    branchIds: normalizeIds(input.branchIds, 'branchIds'),
    operation: input.operation,
    module: input.module,
    startedAtMs: input.startedAtMs ?? performance.now(),
    startedAt: input.now ?? new Date(),
  };
  return Object.freeze(context);
}

/** Log fields derived from a context. Opaque references only — never names. */
export function contextLogFields(context: RequestContext): {
  module: string;
  operation: string;
  correlationId: string;
  tenantRef: string;
  actorRef: string;
  causationId?: string;
} {
  return {
    module: context.module,
    operation: context.operation,
    correlationId: context.correlationId,
    tenantRef: context.principal.tenantId,
    actorRef: context.principal.userId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
  };
}

/** Elapsed milliseconds since the context was created. */
export function elapsedMs(context: RequestContext): number {
  return Math.max(0, Math.round(performance.now() - context.startedAtMs));
}
