/**
 * The typed backend client.
 *
 * The ONE place the web application talks to the API. Shared components never
 * call `fetch`; `apps/web/scripts/check-api-boundary.mjs` fails the build if they
 * do — its `direct-fetch` rule allows `fetch` only under `src/lib/api`. It runs in
 * CI as `validate:web-boundary` (`.github/workflows/_reusable-node-quality.yml`,
 * the `web-quality` task), by way of this workspace's own `validate:boundary`.
 *
 * A remediation briefly replaced that sentence with a claim that no such gate
 * existed, on the strength of a search that listed the repository-root `scripts/`
 * and `scripts/ci/` and never looked in `apps/web/scripts/`. The gate was there
 * the whole time, wired and green at 179 files inspected. The retraction is kept
 * here rather than quietly reverted because the mistake is this phase's own
 * subject matter: a confident docblock asserting a rule the repository does not
 * match, written into the file whose contract was being corrected for exactly
 * that fault. Root-only searches have now missed `apps/web` three times, after
 * `format:check` and root `typecheck`.
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

import englishCatalogue from '@/i18n/messages/en.json';
import { report, type LogLevel } from '../observability/client-log';
import { requiresIdempotencyKey } from './operation-contract';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * One field-level complaint. A PATH and a stable RULE token — never prose.
 *
 * `apps/api/src/server/http/validation.ts:16-22` builds these from Zod issues:
 * `path` is the request part joined to the issue's own path (`body`, `query`,
 * `path`, plus the field), and `rule` is the issue code. Hand-thrown violations
 * elsewhere in the API use the same two fields with domain rule tokens
 * (`empty_patch`, `unknown_reference`, `branch_company_mismatch`, …).
 *
 * The API deliberately never echoes the submitted VALUE here, and never sends a
 * message: validation errors are the most commonly logged and most commonly
 * displayed error class, and echoing input is how a password typed into the
 * wrong box ends up in a log index and on a screen.
 */
export interface Violation {
  readonly path: string;
  readonly rule: string;
}

/**
 * The RFC 9457 problem document, as the API actually publishes it.
 *
 * Source of truth: `apps/api/src/server/errors/problem.ts:25-44`
 * (`ProblemDocument`) and `problemFor`, which assembles the document from the
 * error catalog entry plus the failure's `safeDetails` and reads no other field
 * of the thrown error.
 *
 * ## This interface used to describe a contract that did not exist
 *
 * It declared `detail`, `instance`, `errorCode` and
 * `errors: Record<string, string[]>`. Checked against `problem.ts`:
 *
 * - `detail` and `instance` — **not on the wire at all**. Nothing in the API
 *   ever writes them.
 * - `errorCode` — the API emits `code`. The declared name was never populated,
 *   so a caller branching on it branched on `undefined`.
 * - `errors` — the API emits `violations`, a different NAME carrying a
 *   different SHAPE (a list of path+rule pairs, not a map of field to
 *   sentences).
 * - `correlationId`, `retryAfterSeconds`, `contract` and `requiredPermissions`
 *   are real, are sent, and were not declared.
 *
 * The cost was not theoretical: `fieldErrorsOf` read `problem.errors` and so
 * returned `{}` for every real validation failure, meaning no form in CRM or
 * Vehicle could show a field-level error. The tests passed because their
 * fixtures were written to match the declaration rather than the wire.
 *
 * Every field is optional because the value is parsed from an untrusted
 * response body; presence is a runtime fact, not a compile-time one.
 */
export interface ProblemDetails {
  /** `urn:rootlco:error:ERR-XXX-NNN`. Stable across deployments. */
  readonly type?: string;
  /** Short, caller-safe summary from the error catalog. */
  readonly title?: string;
  /** HTTP status, duplicated in the body per RFC 9457. */
  readonly status?: number;
  /** Catalog code, e.g. `ERR-IAM-001`. The field a caller should branch on. */
  readonly code?: string;
  /** Present on every response, success or failure. Safe to show a user. */
  readonly correlationId?: string;
  /** Field-level violations. Validation failures only. */
  readonly violations?: readonly Violation[];
  /** Seconds until a retry is sensible. Throttling only. */
  readonly retryAfterSeconds?: number;
  /** Contract-only service name. Not-implemented stubs only. */
  readonly contract?: string;
  /** Permission codes the operation requires. Authorization failures only. */
  readonly requiredPermissions?: readonly string[];
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
  /**
   * Headers sent with every request from this client.
   *
   * The reason this exists is `Authorization`. The backend is bearer-
   * authenticated, and the token lives in a `httpOnly` cookie the browser cannot
   * read — so the value is attached SERVER-SIDE, by `server-client.ts`, and a
   * client constructed in the browser simply has none. Keeping it a construction
   * parameter rather than a per-call argument means no call site can forget it
   * and no call site can accidentally attach one it should not have.
   *
   * `content-type`, `accept`, the correlation ID, `if-match` and
   * `idempotency-key` are owned by the request itself and always win.
   */
  readonly defaultHeaders?: Readonly<Record<string, string>>;
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

/** The one event name every API failure is reported under. */
export const API_FAILURE_EVENT = 'web.api.failure';

/**
 * The level each outcome is reported at. Chosen per outcome, not uniformly.
 *
 * - `error` — the system failed. A 5xx, an unreachable service, our own timeout,
 *   a transport fault. Nobody asked for this and somebody should look.
 * - `warn` — the request was refused, and correctly. A 401, 403, 404, 409, 422
 *   or 429 is the backend doing its job; a spike in them is worth seeing, an
 *   individual one is not an incident.
 * - `debug` — **cancelled**. A user pressed Cancel or navigated away. It is not
 *   a fault and must not be counted as one: `#request` already distinguishes a
 *   caller abort from our own timeout precisely so a cancellation is not
 *   reported as a backend failure, and reporting it at `error` here would undo
 *   that distinction one layer up. It is still reported, at a level a sink can
 *   drop, because "the operator cancels this screen constantly" is real signal
 *   about the screen.
 */
export const FAILURE_REPORT_LEVEL: Record<ApiFailureKind, LogLevel> = {
  unauthenticated: 'warn',
  forbidden: 'warn',
  'not-found': 'warn',
  conflict: 'warn',
  validation: 'warn',
  'rate-limited': 'warn',
  server: 'error',
  unavailable: 'error',
  timeout: 'error',
  cancelled: 'debug',
  network: 'error',
};

export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #newCorrelationId: () => string;
  readonly #defaultHeaders: Readonly<Record<string, string>>;

  constructor(options: ApiClientOptions) {
    this.#baseUrl = assertBaseUrl(options.baseUrl);
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#newCorrelationId = options.newCorrelationId ?? (() => globalThis.crypto.randomUUID());
    this.#defaultHeaders = options.defaultHeaders ?? {};
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

  /**
   * A mutation. NEVER retried — see the module note.
   *
   * `ifMatch` carries the record version a version-guarded operation requires.
   * The backend refuses those operations outright when the header is absent
   * (`ERR-CON-002`), which is the correct failure: an unguarded update is a
   * lost-update waiting to happen, so the guard is not optional and is not
   * defaulted here either.
   *
   * ## Why an idempotency key IS defaulted, when `If-Match` is not
   *
   * Every operation the backend marks `idempotent: true` **requires** an
   * `Idempotency-Key` header: `route-handler.ts` calls `requireIdempotencyKey`
   * and answers `ERR-INT-002` (400) without one, *before* permissions are even
   * evaluated. Leaving the header to each call site meant every one of them
   * failed 100% of the time, and the 400 surfaced as a generic validation banner
   * naming no field — so the screen looked broken rather than misconfigured
   * (finding `P1-26-F-015`).
   *
   * A generated key is **semantically correct here**, and only because of the
   * rule directly above it: this client never retries a mutation. One `send` is
   * therefore one logical attempt, and a fresh key per call says exactly that. A
   * caller that genuinely wants to re-present the same attempt — the deliberate
   * retry the backend's idempotency keys exist for — passes its own key, and
   * that explicit key always wins.
   *
   * ## The default is decided by the CONTRACT, not by the method (`P1-27-INT-003`)
   *
   * This paragraph used to read: "The default applies to `POST` only. `PATCH` and
   * `DELETE` are not marked idempotent anywhere in the published contract."
   *
   * **That was false**, and it is the kind of false that does real damage,
   * because a confident sentence is what stops the next reader checking. The
   * contract marks **120** operations idempotent, of which **nine are not POST**
   * — six PUT and three PATCH, including `PATCH /vehicles/{vehicleId}`. Every one
   * of them was refused before authorization, on every attempt.
   *
   * The backend's rule was never a method rule; it reads `operation.idempotent`
   * off the registration. So this client now reads the same fact out of the
   * published contract via `requiresIdempotencyKey`, and
   * `validate:idempotent-operations` fails the build if the generated table and
   * the contract ever disagree.
   */
  async send<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options: {
      readonly signal?: AbortSignal;
      readonly idempotencyKey?: string;
      readonly ifMatch?: string | number;
    } = {}
  ): Promise<ApiResult<T>> {
    // A caller-supplied key always wins, and is never regenerated: re-presenting
    // the same key is the deliberate replay the backend's idempotency exists for,
    // and overwriting it would turn a retry into a second logical attempt.
    const idempotencyKey =
      options.idempotencyKey ??
      (requiresIdempotencyKey(method, path) ? this.#newIdempotencyKey() : undefined);
    return this.#request<T>(method, path, body, options.signal, idempotencyKey, options.ifMatch);
  }

  /**
   * A key the backend will accept: 8–200 characters, per `idempotency.ts`.
   *
   * A UUID is 36, so the bounds are met by construction rather than by a length
   * check nobody would ever see fail.
   */
  #newIdempotencyKey(): string {
    return globalThis.crypto.randomUUID();
  }

  /**
   * Every API failure, routed to the monitoring boundary from ONE place
   * (`P1-27-DO-002`).
   *
   * ## Why here and nowhere else
   *
   * `#request` is the only function in the application that talks to the API —
   * `scripts/check-api-boundary.mjs` fails the build if a component calls
   * `fetch` — so both of its failure paths together are the complete set of API
   * failures. Reporting from components instead would mean every one of them
   * remembering, each forgetting differently, and the ones that forgot being
   * exactly the ones nobody looks at. Before this, the only production caller of
   * `report` was the dashboard render-error boundary, which by construction
   * never sees an API failure at all.
   *
   * ## What travels, and what cannot
   *
   * The event name, the correlation ID (an opaque token, and the whole point —
   * it is what joins this line to the API's own log), the route, and four
   * values: method, status, kind, code. All four are vocabulary the application
   * itself chose.
   *
   * What is NOT here is the interesting part: no request body, no response body,
   * no header of any kind and `Authorization` least of all, no cookie, no token,
   * no customer name, no VIN, no plate. Not filtered out — never assembled. The
   * `report` boundary then strips the query string from the route, templates the
   * record identifiers out of its path, and runs `redact` over the context, so
   * even a future edit that adds a leaky value has a second wall to get past.
   *
   * A retried read reports each attempt. Two failures happened; one line would
   * be a smaller number than the truth.
   */
  #reportFailure(failure: ApiFailure, method: string, path: string): void {
    report({
      level: FAILURE_REPORT_LEVEL[failure.kind],
      event: API_FAILURE_EVENT,
      correlationId: failure.correlationId,
      route: path,
      context: {
        method,
        status: failure.status,
        kind: failure.kind,
        code: failure.problem?.code ?? null,
      },
    });
  }

  async #request<T>(
    method: string,
    path: string,
    body: unknown,
    signal?: AbortSignal,
    idempotencyKey?: string,
    ifMatch?: string | number
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
      // Construction-time headers first, so a request-owned header of the same
      // name always wins. A default that could overwrite the correlation ID
      // would break the one diagnostic a user is ever shown.
      ...this.#defaultHeaders,
      accept: 'application/json',
      [CORRELATION_HEADER]: correlationId,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    if (ifMatch !== undefined) headers['if-match'] = String(ifMatch);

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
        const failure: ApiFailure = {
          ok: false,
          kind: kindFor(response.status),
          status: response.status,
          problem: isProblem(payload) ? payload : null,
          correlationId: echoed,
        };
        this.#reportFailure(failure, method, path);
        return failure;
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
      const failure: ApiFailure = {
        ok: false,
        kind,
        status: null,
        problem: null,
        correlationId,
      };
      // The transport half. A network fault, our own deadline and a caller
      // cancellation all arrive here, and all three reach the boundary — at
      // three different levels, because they are three different things.
      this.#reportFailure(failure, method, path);
      return failure;
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

/** The namespace every violation message key lives in. */
export const VIOLATION_KEY_PREFIX = 'form.violation.';

/** The key any rule the catalogue does not carry falls back to. */
export const VIOLATION_FALLBACK_KEY = `${VIOLATION_KEY_PREFIX}invalid`;

/**
 * The leading segments the API puts in front of a field path.
 *
 * `toViolations` joins the request part to the issue path, so every violation
 * from schema validation starts with one of these. A path that is *only* one of
 * them names the whole request part rather than a control — see
 * `controlNameFor`.
 */
export const REQUEST_PART_PREFIXES: readonly string[] = Object.freeze([
  'body',
  'query',
  'path',
  'params',
]);

/**
 * The `form.violation.*` keys the message catalogue actually carries.
 *
 * **Derived, not listed.** A hard-coded array of rule tokens here would be a
 * second copy of the catalogue that drifts the first time someone adds a
 * message and forgets this file — and drifts silently, because a stale entry
 * produces a key that renders as itself on screen. Reading the keys back out of
 * the catalogue makes the catalogue the only place the set is written down.
 *
 * `en` is read as the STRUCTURAL authority, not as a language: `tests/i18n.test.ts`
 * asserts both catalogues define exactly the same keys, and
 * `tests/api-client.test.ts` re-asserts it for this prefix specifically, so a
 * key present in one and missing from the other fails a test rather than
 * reaching an Arabic operator as English.
 */
const CATALOGUED_VIOLATION_KEYS: ReadonlySet<string> = new Set(
  Object.keys(englishCatalogue).filter((key) => key.startsWith(VIOLATION_KEY_PREFIX))
);

/**
 * The translation key for a rule token.
 *
 * Derivation, then membership: `form.violation.${rule}` if the catalogue carries
 * it, `form.violation.invalid` if it does not. The fallback is not a nicety —
 * the API emits **more than eighty** distinct rule tokens across eleven backend
 * modules and gains more with every phase, so a catalogue that had to be
 * exhaustive would be wrong within a week and would put a raw token like
 * `unregistered_aggregate` in front of a receptionist. The catalogue carries the
 * tokens a form can actually produce; everything else is honestly generic.
 *
 * Never returns server-authored text, because there is none on the wire to
 * return: a violation is a path and a rule token, and a rule token is not a
 * message.
 */
export function violationMessageKey(rule: string): string {
  const candidate = `${VIOLATION_KEY_PREFIX}${rule}`;
  return CATALOGUED_VIOLATION_KEYS.has(candidate) ? candidate : VIOLATION_FALLBACK_KEY;
}

/**
 * The form control a violation path names, or `null` when it names none.
 *
 * `body.preferredLocale` → `preferredLocale`; `query.limit` → `limit`;
 * `body.contactPoints.0.value` → `value`. The leaf, because every form in this
 * application is flat — a nested renderer does not exist, and `field-errors.ts`
 * makes the same choice for the same reason.
 *
 * `body` and `query` alone return `null`. That is a violation about the whole
 * request — `empty_patch` is the everyday one: a save with nothing changed —
 * and it belongs to no control. Returning `null` rather than inventing a
 * control named `body` is what lets `fromFailure` surface it at form level
 * instead of dropping it, which is what the previous code did to every
 * violation of every shape.
 */
export function controlNameFor(path: string): string | null {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  if (segments.length === 1 && REQUEST_PART_PREFIXES.includes(segments[0] as string)) return null;
  return segments[segments.length - 1] as string;
}

/**
 * A validation failure, split into what a control can show and what only the
 * form can.
 */
export interface ViolationKeys {
  /** Control name → translation key. First violation per control wins. */
  readonly fieldErrors: Record<string, string>;
  /** Translation keys for violations that name the whole request. */
  readonly formKeys: readonly string[];
}

/**
 * Maps the wire's `violations` onto translation keys.
 *
 * ## First per control wins, and it is stable
 *
 * The API sends violations in schema order and this loop keeps the first it
 * meets for each control. A field with two problems has one place to show them,
 * and the earliest is the one the operator can act on. Stable because the order
 * is the response's order, not an object-key iteration order.
 *
 * ## Nothing here can be server prose
 *
 * The only values produced are keys from `violationMessageKey`. Even a
 * malicious response cannot get text onto the screen through this path: an
 * unrecognised rule token maps to the fallback key rather than being rendered.
 *
 * The accumulator has a null prototype so a wire-supplied path of `__proto__`
 * or `constructor` is an ordinary key rather than a setter or an inherited
 * truthy value. The API fixed the same class of defect on its own side in
 * `searchParamsToObject`; this is the mirror of it.
 */
export function violationKeysOf(failure: ApiFailure): ViolationKeys {
  const collected = Object.create(null) as Record<string, string>;
  const formKeys: string[] = [];
  const violations = failure.kind === 'validation' ? failure.problem?.violations : undefined;

  if (Array.isArray(violations)) {
    for (const violation of violations) {
      if (typeof violation?.path !== 'string' || typeof violation?.rule !== 'string') continue;
      const key = violationMessageKey(violation.rule);
      const control = controlNameFor(violation.path);
      if (control === null) {
        if (!formKeys.includes(key)) formKeys.push(key);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(collected, control)) continue;
      collected[control] = key;
    }
  }

  return { fieldErrors: { ...collected }, formKeys };
}

/**
 * Field errors from a validation failure, as translation keys, by control name.
 *
 * Returns an empty object rather than null for a non-validation failure, so a
 * caller can always spread it without a guard.
 *
 * **This used to read `problem.errors`, a field the API has never sent**, so it
 * returned `{}` for every real 422 and no form in the application could show a
 * field-level error. See `ProblemDetails` above.
 *
 * **It is not the wired path.** `action-result.ts` calls `violationKeysOf`,
 * because a whole-request violation carries no control name and would be
 * silently dropped by a function whose return type is keyed by one. This is the
 * narrow accessor for a caller that genuinely wants only the per-control half,
 * and today it has no production caller — said here so the next reader does not
 * infer from its test count that something depends on it.
 *
 * A different function is also exported as `fieldErrorsOf` elsewhere in the tree
 * (`features/vehicles/write-support.ts` re-exports `fieldErrorsFrom`, which maps a
 * `ZodError`, not an `ApiFailure`). Two unrelated functions under one name is a
 * reading hazard, and it is recorded rather than fixed here because that file
 * belongs to another change in flight.
 */
export function fieldErrorsOf(failure: ApiFailure): Record<string, string> {
  return violationKeysOf(failure).fieldErrors;
}

/**
 * What a user may be shown about a failure.
 *
 * The correlation ID and a translation KEY. Never anything the server wrote:
 * `title` is the only prose the problem document carries, it is written for a
 * developer reading a catalog entry rather than for a receptionist, and it is
 * English in a product that is Arabic-first. So it is not in this map and is not
 * rendered anywhere.
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

/**
 * The one catalog code that means what `state.conflict.title` says.
 *
 * `ERR-CON-001` is "Record version conflict", and the services raise it for a
 * genuine race: "the vehicle changed while this request was in flight",
 * "the candidate was reviewed by someone else while this request was in flight",
 * "one wins, the other is told its view was stale".
 */
export const CONCURRENT_CHANGE_CODE = 'ERR-CON-001';

/**
 * The message key for a failure, which for a conflict depends on its cause.
 *
 * `FAILURE_MESSAGE_KEY` maps a KIND, and every 409 is one kind. So every conflict
 * rendered "Someone else changed this" — and the error catalog defines TEN codes
 * at 409, of which that sentence describes one. The vehicle module alone raises
 * `ERR-RES-002` twelve times: for a vehicle whose lifecycle state refuses the
 * write, a vehicle that has been merged and is read only, a candidate already
 * decided, and a unique index rejecting the row. An operator told that someone
 * else edited the record goes looking for that person, reloads, finds nothing
 * changed, tries again — and the save fails again, for the reason nobody gave.
 *
 * The backend distinguishes all ten in `problem.code`. This client could not read
 * it, because it declared `errorCode`, a field the API does not emit. That is the
 * same defect the `ProblemDetails` correction above fixes, and this is the second
 * thing that correction buys.
 *
 * What this deliberately does NOT do is invent a message per code. Where the
 * backend cannot distinguish a cause it must not be guessed at: a duplicate VIN
 * and a duplicate display number both arrive as `ERR-RES-002` with no
 * `violations`, because `mapWriteConflict` maps every unique violation to one
 * code. So there are exactly two sentences — the true concurrency one, and one
 * that states the record cannot take the change without claiming to know why.
 */
export function failureMessageKey(failure: ApiFailure): string {
  if (failure.kind !== 'conflict') return FAILURE_MESSAGE_KEY[failure.kind];
  return failure.problem?.code === CONCURRENT_CHANGE_CODE
    ? 'state.conflict.title'
    : 'state.conflict.blocked.title';
}
