import { authorizedClient } from './server-client';
import type { ApiFailureKind } from './client';

/**
 * The read helpers every feature shares.
 *
 * One place that turns "call an approved operation" into "a view state", so no
 * screen invents its own mapping from a 403 to a rendered outcome — and so none
 * of them can accidentally render a denial as an empty list, which reads to an
 * operator as "there is nothing here" when the truth is "you may not see it".
 *
 * ## Why this moved out of `features/administration/shared` (P1-27)
 *
 * Nothing in it was ever about administration. P1-27 needed the same mapping for
 * CRM and Vehicle, and there were only three ways to get it: import across
 * features (which says CRM depends on Administration, and it does not), copy it
 * (which is the duplicate authority the ownership gate exists to prevent), or
 * move it here. The old path re-exports, so no P1-26 screen changed.
 *
 * Nothing in this file fetches. `authorizedClient()` is the only network owner,
 * and it lives in `src/lib/api` because `check-api-boundary.mjs` says so.
 */

export type ReadFailureStatus = 'denied' | 'expired' | 'unavailable' | 'error' | 'not-found';

export type ReadState<T> =
  | { readonly status: 'ok'; readonly data: T; readonly correlationId: string | null }
  | { readonly status: ReadFailureStatus; readonly correlationId: string | null };

/**
 * How a transport outcome becomes a view state.
 *
 * `rate-limited` maps to `unavailable` rather than `error`: a 429 is a
 * "try again shortly", not a fault, and telling an operator something broke when
 * they merely searched too fast sends them to support for nothing.
 */
export const STATUS_BY_KIND: Record<ApiFailureKind, ReadFailureStatus> = {
  unauthenticated: 'expired',
  forbidden: 'denied',
  'not-found': 'not-found',
  conflict: 'error',
  validation: 'error',
  'rate-limited': 'unavailable',
  server: 'error',
  unavailable: 'unavailable',
  timeout: 'unavailable',
  cancelled: 'error',
  network: 'unavailable',
};

/** A read through the caller's own session. */
export async function readOperation<T>(path: string): Promise<ReadState<T>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };

  const result = await client.get<T>(path);
  if (result.ok) {
    return { status: 'ok', data: result.data, correlationId: result.correlationId };
  }
  return { status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
}

/**
 * A cursor page, exactly as the backend publishes one.
 *
 * `nextCursor` and `hasMore` are the server's own end-of-set signals. There is
 * no `total`, and this type does not invent one — see `P1-26-F-001`.
 */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** A list response that is a bare array under `items` — several operations are. */
export interface ItemsOnly<T> {
  readonly items: readonly T[];
}

/**
 * Builds a query string, dropping anything undefined or empty.
 *
 * Values are encoded, never interpolated raw. An operator's search term reaches
 * the backend as a parameter and reaches the address bar not at all — the
 * table's own URL policy keeps free text out of history, proxy logs and the
 * `Referer` header, and this is the other half of that: the term is sent, and it
 * is sent safely.
 */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (SCOPE_KEYS.has(key)) {
      // Not dropped silently. Dropping would let a caller believe it had
      // asserted a scope that never left the process; throwing says so at the
      // moment of the mistake. No code path constructs one today, so this can
      // only fire in development or under test — never for an operator.
      throw new Error(
        `${key} must not be sent from the client. Scope is resolved server-side from the session.`
      );
    }
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.length === 0) continue;
    search.set(key, text);
  }
  const rendered = search.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}

/**
 * Scope names the client must never assert — `P1-27-SEC-001`.
 *
 * Every operation this platform publishes resolves tenant, company and branch
 * server-side from the session. A client-supplied scope is at best ignored and
 * at worst believed, so the one place a query string is built refuses the names
 * outright rather than trusting every call site to remember.
 *
 * This is deliberately NOT the same list as `FORBIDDEN_URL_KEYS`. That one
 * governs the **browser** address bar, which becomes history, proxy logs and the
 * `Referer` header, so it refuses `vin`, `plate`, `phone` and every free-text
 * search term. This one governs the **API** path — one TLS hop to the backend —
 * where a VIN search criterion has to travel or vehicle search cannot work.
 * Merging the two lists would either leak search terms into history or break
 * `FE-017`.
 */
const SCOPE_KEYS = new Set([
  'tenantId',
  'companyId',
  'branchId',
  'tenant_id',
  'company_id',
  'branch_id',
]);

/**
 * The branch a branch-calendar read is ABOUT — a resource selector pair, not a
 * scope assertion (P1-28, Wave A).
 *
 * `GET /appointments` and `GET /receptions` REQUIRE `companyId` and `branchId`
 * in the query: their `.strict()` schemas name both as mandatory, and the pair
 * travels as the `authorizationTarget` so `iam.has_permission_in_scope` decides
 * against the branch actually read rather than against the permission-blind
 * union of every grant the caller holds (P1-18-A-01,
 * `apps/api/src/app/api/v1/appointments/route.ts:112-124` and
 * `receptions/route.ts:117-126`). Omitting either is a 422 for the whole
 * request — there is no "my branch" default, because the server deliberately
 * refuses to guess which of a multi-grant caller's branches a calendar is for.
 */
export interface BranchTarget {
  readonly companyId: string;
  readonly branchId: string;
}

/**
 * A query string for an operation addressed to ONE branch's calendar or board.
 *
 * The same distinction `companyFilterQuery` records, one resource wider:
 *
 * - "I am in branch Y" — a claim about the caller. Never sent; the server
 *   resolves scope from the session, and `query()` throws on the names.
 * - "show me branch Y's appointments" — a claim about the RESOURCE, demanded
 *   by the route schema and authorized server-side against exactly that pair.
 *
 * The target arrives through a dedicated parameter rather than through `params`,
 * so a caller cannot smuggle the pair in among ordinary filters — `params` is
 * still refused the scope names, tenant above all: no operation anywhere accepts
 * a client-supplied tenant, and this helper is not the place that changes.
 */
export function branchTargetQuery(
  target: BranchTarget,
  params: Record<string, string | number | undefined | null> = {}
): string {
  const search = new URLSearchParams();
  search.set('companyId', target.companyId);
  search.set('branchId', target.branchId);
  for (const [key, value] of Object.entries(params)) {
    if (SCOPE_KEYS.has(key)) {
      // Includes `companyId`/`branchId` themselves: the target parameter is the
      // only door, so a duplicate among the filters is a coding error worth
      // hearing about, not a value to silently prefer one of.
      throw new Error(
        `${key} must arrive through the BranchTarget parameter, never among the filters.`
      );
    }
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.length === 0) continue;
    search.set(key, text);
  }
  return `?${search.toString()}`;
}

/**
 * A query string for an operation whose `companyId` is a **resource selector**,
 * not a scope assertion.
 *
 * The first version of `query()` refused `companyId` everywhere, and it broke a
 * working P1-26 screen the moment it ran against the real application:
 * `GET /api/v1/iam/approval-limits` takes `companyId` as a filter naming *which
 * company's limits to list*, and the operator picks it from a control that
 * exists precisely because a session may resolve to no single company. The rule
 * had conflated two different sentences that share a word:
 *
 * - "I am in company X" — a claim about the caller. Never sent; the server knows.
 * - "show me company X's approval limits" — a claim about the resource. Sent,
 *   and authorized server-side exactly like any other parameter.
 *
 * So the refusal stays the default and the exception is named, narrow and
 * visible in a diff. `apps/web/tests/p1-27-security.test.ts` pins the call sites
 * to exactly the one operation that has this shape — widening it means changing
 * a test that says why it is not wider.
 */
export function companyFilterQuery(
  params: Record<string, string | number | undefined | null>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'companyId' && SCOPE_KEYS.has(key)) {
      throw new Error(`${key} must not be sent from the client, even alongside a company filter.`);
    }
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.length === 0) continue;
    search.set(key, text);
  }
  const rendered = search.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}
