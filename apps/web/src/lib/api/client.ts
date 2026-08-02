/**
 * The typed backend client.
 *
 * The ONE place the web application talks to the API. Shared components never
 * call `fetch`; `scripts/check-api-boundary.mjs` fails the build if they do.
 *
 * ## What it will not do
 *
 * - It does not invent endpoints. Every path it offers exists in the published
 *   OpenAPI document. P1-25's reference integration is `/api/v1/health/ready`,
 *   which is a real platform endpoint, because a client proven against a route
 *   that does not exist is not proven at all.
 * - It does not import from `apps/api`, from `supabase`, or from any server-only
 *   module. The boundary check enforces that too.
 * - It never retries a mutation. A retried POST that actually succeeded the
 *   first time creates a second record; the backend's idempotency keys exist
 *   precisely so retrying is a DELIBERATE act with a key attached, not something
 *   a transport layer does on the caller's behalf.
 */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 9457 problem details, as the backend publishes them. */
export interface ProblemDetails {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  /** The repository's own extension: a stable machine code, e.g. `ERR-IAM-001`. */
  readonly errorCode?: string;
  /** Field-level messages for a 422, keyed by field path. */
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

export type ApiFailureKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'rate-limited'
  | 'server'
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'network';

export interface ApiFailure {
  readonly ok: false;
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly problem: ProblemDetails | null;
  /** Echoed from the response, or the one we sent. Safe to show a user. */
  readonly correlationId: string | null;
}

export interface ApiSuccess<T> {
  readonly ok: true;
  readonly status: number;
  readonly data: T;
  readonly correlationId: string | null;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export const CORRELATION_HEADER = 'x-correlation-id';
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly newCorrelationId?: () => string;
}

/**
 * Validates the configured base URL at construction.
 *
 * A malformed base produces requests to a relative path that silently hit the
 * web origin instead of the API — which in a browser means the request goes to
 * a server that returns HTML, and the failure surfaces as a JSON parse error far
 * from its cause.
 */
export function assertBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`API base URL is not a valid absolute URL: ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`API base URL must be http or https, got ${parsed.protocol}`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error('API base URL must not carry a query string or fragment');
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}

function kindFor(status: number): ApiFailureKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 422 || status === 400) return 'validation';
  if (status === 429) return 'rate-limited';
  if (status === 503 || status === 502 || status === 504) return 'unavailable';
  return 'server';
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #newCorrelationId: () => string;

  constructor(options: ApiClientOptions) {
    this.#baseUrl = assertBaseUrl(options.baseUrl);
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#newCorrelationId = options.newCorrelationId ?? (() => globalThis.crypto.randomUUID());
  }

  /**
   * A read. May be retried, because it is idempotent by contract.
   *
   * `retries` defaults to 1 — one retry, not a loop. A read that fails twice is
   * reporting a real condition, and retrying past that turns a brief outage into
   * a thundering herd against a service that is already struggling.
   */
  async get<T>(
    path: string,
    options: { readonly signal?: AbortSignal; readonly retries?: number } = {}
  ): Promise<ApiResult<T>> {
    const retries = Math.max(0, Math.min(options.retries ?? 1, 2));
    let last: ApiFailure | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const result = await this.#request<T>('GET', path, undefined, options.signal);
      if (result.ok) return result;
      last = result;
      // Only a transport-level or availability failure is worth a second try. A
      // 403 will be a 403 again, and retrying it just doubles the audit trail.
      if (!['unavailable', 'network', 'timeout'].includes(result.kind)) return result;
      if (result.kind === 'cancelled') return result;
    }
    return last as ApiFailure;
  }

  /** A mutation. NEVER retried — see the module note. */
  async send<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options: { readonly signal?: AbortSignal; readonly idempotencyKey?: string } = {}
  ): Promise<ApiResult<T>> {
    return this.#request<T>(method, path, body, options.signal, options.idempotencyKey);
  }

  async #request<T>(
    method: string,
    path: string,
    body: unknown,
    signal?: AbortSignal,
    idempotencyKey?: string
  ): Promise<ApiResult<T>> {
    const correlationId = this.#newCorrelationId();
    const controller = new AbortController();
    // An explicit flag rather than inspecting the abort reason. Both a caller
    // cancellation and our own timeout arrive as an AbortError whose reason is a
    // DOMException, so "is the reason a DOMException" cannot tell them apart —
    // and reporting a user pressing Cancel as a backend timeout puts a
    // service-unavailable state on screen for something that did not fail.
    let timedOutHere = false;
    const timeout = setTimeout(() => {
      timedOutHere = true;
      controller.abort(new DOMException('timeout', 'TimeoutError'));
    }, this.#timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      [CORRELATION_HEADER]: correlationId,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        // Cookies carry the session. `same-origin` would drop them when the API
        // is on its own origin, which is the deployed topology.
        credentials: 'include',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const echoed = response.headers.get(CORRELATION_HEADER) ?? correlationId;
      const payload = await readPayload(response);

      if (!response.ok) {
        return {
          ok: false,
          kind: kindFor(response.status),
          status: response.status,
          problem: isProblem(payload) ? payload : null,
          correlationId: echoed,
        };
      }
      return { ok: true, status: response.status, data: payload as T, correlationId: echoed };
    } catch (error) {
      // An abort is either the caller cancelling or our own timeout firing.
      // They are different outcomes: one is expected and silent, the other is a
      // condition worth showing.
      // Three distinguishable outcomes, and the distinction matters: a user
      // pressing Cancel must not be reported as a backend timeout, which would
      // put a service-unavailable state on screen for something that did not
      // fail. `TimeoutError` is what a fetch implementation raises for its own
      // deadline; `timedOutHere` covers ours; anything else aborted was the
      // caller.
      const isTimeout =
        timedOutHere || (error instanceof DOMException && error.name === 'TimeoutError');
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      const kind = isTimeout ? 'timeout' : isAbort ? 'cancelled' : 'network';
      return {
        ok: false,
        kind,
        status: null,
        problem: null,
        correlationId,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  try {
    return await response.json();
  } catch {
    // A malformed body is not a crash. The status already carries the verdict.
    return null;
  }
}

function isProblem(value: unknown): value is ProblemDetails {
  return typeof value === 'object' && value !== null;
}

/**
 * Field errors from a validation failure, flattened for a form resolver.
 *
 * Returns an empty object rather than null for a non-validation failure, so a
 * caller can always spread it without a guard.
 */
export function fieldErrorsOf(failure: ApiFailure): Record<string, string> {
  if (failure.kind !== 'validation' || !failure.problem?.errors) return {};
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(failure.problem.errors)) {
    const first = messages[0];
    if (first) out[field] = first;
  }
  return out;
}

/**
 * What a user may be shown about a failure.
 *
 * The correlation ID and a translation KEY — never `problem.detail`, which is
 * server-authored text that can name an internal path, a table or a constraint.
 */
export const FAILURE_MESSAGE_KEY: Record<ApiFailureKind, string> = {
  unauthenticated: 'state.expired.title',
  forbidden: 'state.denied.title',
  'not-found': 'state.notFound.title',
  conflict: 'state.conflict.title',
  validation: 'form.formError',
  'rate-limited': 'state.error.title',
  server: 'state.error.title',
  unavailable: 'state.unavailable.title',
  timeout: 'state.unavailable.title',
  cancelled: 'state.error.title',
  network: 'state.unavailable.title',
};
