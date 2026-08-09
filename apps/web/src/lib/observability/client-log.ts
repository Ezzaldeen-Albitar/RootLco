/**
 * Structured client logging, and the boundary an external monitor attaches to.
 *
 * ## What this is honest about
 *
 * No external monitoring vendor is named here and none is claimed to be
 * operational. What exists is the **adapter boundary**: a single place every
 * client-side diagnostic passes through, with the redaction applied before it
 * leaves. The redaction was built before any delivery, deliberately — the first
 * thing a monitoring integration does is capture everything, and the second is
 * discover what it captured.
 *
 * ## The half that used to be missing (`P1-27-DO-002`)
 *
 * This module previously stopped at the boundary. `setMonitoringAdapter` had
 * **zero** production callers, and `report` had exactly one — the dashboard
 * render-error boundary, which passed no `context`, so `redact` never ran in
 * production at all. An API failure — the thing that actually goes wrong in a
 * workshop at 9am — reached no monitoring path whatever.
 *
 * Two things changed, and both are named so a reader can check them:
 *
 *  1. `ApiClient.#request` reports every failure, on both of its failure paths.
 *     That is the ONE place every read and every write in the application
 *     already passes through, so the routing is central rather than scattered
 *     into components that would each forget it differently.
 *  2. `installConfiguredMonitoringAdapter` runs at module load and is the
 *     production caller. It installs a delivering adapter when — and only when —
 *     the deployment has configured a sink; with no sink configured the adapter
 *     stays `null`, which is the documented and tested default.
 *
 * ## What may be reported
 *
 * An event name, a correlation ID, a route that has been stripped of its query
 * string AND templated so no record identifier survives, and a small bag of
 * values that have been through `redact`. Nothing else.
 *
 * ## What may never be reported
 *
 * A request body. A response body. Any header, and `Authorization` above all. A
 * password. An access, reset or invitation token. A cookie. A secret. An email
 * address, a phone number, a plate, a VIN, a customer name, an amount. A URL
 * with a query string, because the query string is where those end up. A record
 * identifier in a path segment, because a customer ID plus a timestamp is a
 * customer.
 *
 * `redact` enforces the key-name half of that, and `looksLikeCredential` is the
 * belt-and-braces check on the value half — a value that *looks* like a
 * credential is dropped whatever it is called, because the failure mode is
 * someone logging `{ data: accessToken }`. `safeRoute` and `templateRoute`
 * enforce the route half.
 */

import { env } from '../env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ClientLogEvent {
  readonly level: LogLevel;
  /** A stable dotted name. Never a sentence, never interpolated user text. */
  readonly event: string;
  /** The request this belongs to, when there is one. Safe to show and to send. */
  readonly correlationId?: string | null;
  /** The route, WITHOUT its query string. */
  readonly route?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

/** Key names whose value is never reported, whatever it contains. */
export const FORBIDDEN_KEYS = Object.freeze([
  'password',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'recoverytoken',
  'invitationtoken',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'session',
  'email',
  'phone',
  'mobile',
  'vin',
  'plate',
  'amount',
  'total',
  'balance',
  'iban',
  'card',
]);

const REDACTED = '[redacted]';

function normalise(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Whether a VALUE looks like a credential regardless of its key.
 *
 * Catches the shape that actually happens: `{ data: accessToken }`, where the
 * key is innocent and the value is a JWT or a long opaque string. Deliberately
 * conservative — a long random-looking token is redacted, ordinary prose is not.
 */
export function looksLikeCredential(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // A JWT: three base64url segments.
  if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value)) return true;
  // A long unbroken high-entropy-ish run with no spaces.
  return value.length >= 40 && /^[A-Za-z0-9_\-+/=]+$/.test(value);
}

/** Redacts by key name and by value shape. Recurses one level into objects. */
export function redact(
  context: Readonly<Record<string, unknown>>,
  depth = 0
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (FORBIDDEN_KEYS.includes(normalise(key))) {
      out[key] = REDACTED;
      continue;
    }
    if (looksLikeCredential(value)) {
      out[key] = REDACTED;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) {
      out[key] = redact(value as Record<string, unknown>, depth + 1);
      continue;
    }
    // Arrays and primitives pass through. An array of anything credential-shaped
    // is caught element-wise below.
    if (Array.isArray(value)) {
      out[key] = value.map((entry) => (looksLikeCredential(entry) ? REDACTED : entry));
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** A route with its query string removed. The query is where secrets hide. */
export function safeRoute(href: string): string {
  const [path] = href.split('?');
  return path ?? href;
}

const UUID_SEGMENT =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const NUMERIC_SEGMENT = /^\d+$/;

/** The placeholder a record identifier is replaced by. */
export const ROUTE_ID_PLACEHOLDER = ':id';

/**
 * Replaces record identifiers in a path with `:id`.
 *
 * Two reasons, and the second is the one that matters more.
 *
 * **Aggregation.** `/api/v1/crm/customers/3f2a…/addresses` and the same path for
 * ten thousand other customers are ONE route with one failure rate. Reported
 * verbatim they are ten thousand routes each seen once, and a monitoring view
 * of that is a list, not a signal.
 *
 * **Leakage.** A customer ID is not a name, but it is a stable handle to one,
 * and a stream of `customer 3f2a… failed at 09:14` is a record of who was being
 * worked on and when. `safeRoute` already removes the query string; the path is
 * the other place an identifier travels, and it was not covered.
 *
 * UUID-shaped and wholly numeric segments only. A segment that is neither — a
 * locale, a module name, a status word — is vocabulary, not an identifier, and
 * removing it would leave a route that names nothing.
 */
export function templateRoute(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      UUID_SEGMENT.test(segment) || NUMERIC_SEGMENT.test(segment) ? ROUTE_ID_PLACEHOLDER : segment
    )
    .join('/');
}

/**
 * The monitoring adapter.
 *
 * `null` means nothing is attached, which is what a deployment that has
 * configured no sink gets. Setting one is how a deployment opts in.
 */
export type MonitoringAdapter = (event: ClientLogEvent) => void;

let adapter: MonitoringAdapter | null = null;

export function setMonitoringAdapter(next: MonitoringAdapter | null): void {
  adapter = next;
}

export function currentAdapter(): MonitoringAdapter | null {
  return adapter;
}

/**
 * How a delivered event leaves the browser.
 *
 * `navigator.sendBeacon`'s signature, narrowed, so the delivery can be driven by
 * a stub in a test without a fake `navigator` and without a network. Beacon
 * rather than `fetch` for two reasons: a diagnostic must survive the page
 * unloading, which is precisely when the interesting failures happen; and
 * `fetch` in this application belongs to `ApiClient` alone, so a second caller
 * of it here would quietly become the exception that ends that.
 */
export type BeaconSender = (url: string, body: string) => boolean;

/**
 * The adapter a configured sink gets.
 *
 * It delivers the event the boundary has ALREADY redacted — `report` redacts
 * before it calls the adapter, so this function cannot see a raw context even
 * by accident. It sends the same four fields the console line carries and
 * nothing else, and it never throws: a monitoring sink that is down must not
 * turn a handled failure into an unhandled one.
 */
export function deliveringAdapter(url: string, send: BeaconSender): MonitoringAdapter {
  return (event) => {
    try {
      send(
        url,
        JSON.stringify({
          level: event.level,
          event: event.event,
          correlationId: event.correlationId ?? null,
          route: event.route ?? null,
          context: event.context ?? {},
        })
      );
    } catch {
      // Deliberately silent. Reporting a reporting failure through `report`
      // would recurse, and a console line here would fire on every event for as
      // long as the sink is unreachable.
    }
  };
}

/**
 * The production caller. This is the half of `P1-27-DO-002` that was missing.
 *
 * ## Why it runs at module load rather than from a mounted component
 *
 * Every path that can report anything imports this module — `ApiClient` does,
 * and the dashboard error boundary does — so module load is the one moment
 * guaranteed to happen exactly once, in every bundle that could produce an
 * event, BEFORE the first event. A component mount would be later than the
 * first failure it is supposed to catch, and would need remembering in each new
 * entry point.
 *
 * ## What "configured" means
 *
 * `NEXT_PUBLIC_CLIENT_MONITORING_URL`, validated as a URL by `lib/env.ts` like
 * every other browser-visible value, and **optional**. No vendor is named, no
 * SDK is imported, no key is reached for. With the variable unset this function
 * installs nothing and `currentAdapter()` stays `null` — that is the default,
 * and `tests/observability.test.ts` asserts it rather than assuming it.
 *
 * Configured at BUILD time. Next inlines `NEXT_PUBLIC_*` during `next build`,
 * and this URL is inlined into the client bundle with everything else, so a
 * variable set on an already-built deployment installs nothing; it must be set
 * for the build.
 *
 * ## The CSP, which no longer has to be done by hand
 *
 * `sendBeacon` is governed by `connect-src`, so a sink the policy does not name
 * is a sink the browser refuses. That directive is assembled in exactly one
 * place, `src/lib/security/csp.ts`, and `src/proxy.ts` feeds it this same
 * variable — so configuring the sink admits its origin, and there is nothing
 * further to edit.
 *
 * This paragraph used to send the reader to the proxy file to widen the policy
 * by hand. That was not possible: no directive is written there, and the builder
 * took no parameter for a second origin, so the documented way to switch this on
 * could not work at all. Corrected under `P1-27-DO-002` by making it work, and
 * bound to the code by `tests/security.test.ts` so the two cannot drift apart
 * again.
 *
 * ## What a deployment still owns
 *
 * One thing this module cannot do for it, stated rather than implied: the sink
 * must be an endpoint the deployment actually operates. Nothing here asserts
 * that one exists.
 *
 * Returns whether an adapter was installed, so a caller — and a test — can tell
 * "configured and installed" from "not configured".
 */
export function installConfiguredMonitoringAdapter(
  url: string | undefined = env.NEXT_PUBLIC_CLIENT_MONITORING_URL,
  send: BeaconSender | null = defaultBeacon()
): boolean {
  if (!url || !send) return false;
  setMonitoringAdapter(deliveringAdapter(url, send));
  return true;
}

/**
 * The browser's beacon, or `null` where there is no browser.
 *
 * This module is imported by server code too — `server-client.ts` builds an
 * `ApiClient` — so the guard is what keeps a server render from installing a
 * browser-only transport. Server-side diagnostics are the API's own concern and
 * already have one.
 */
function defaultBeacon(): BeaconSender | null {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return null;
  return (url, body) => navigator.sendBeacon(url, body);
}

/**
 * Reports a client-side event.
 *
 * Redacts first, then hands the event to the adapter if one is attached, then
 * writes it to the console at the matching level. Console output is retained
 * because in the absence of an external service it is the only place an operator
 * or a developer can see anything at all — and it carries the same redacted
 * payload, so it is not a second, looser path.
 */
export function report(event: ClientLogEvent): void {
  const safe: ClientLogEvent = {
    ...event,
    // BOTH, and in this order. `safeRoute` removes the query string;
    // `templateRoute` removes the record identifiers left in the path. Either
    // alone leaks the other half, and doing it here rather than at each call
    // site means a new caller cannot forget.
    ...(event.route ? { route: templateRoute(safeRoute(event.route)) } : {}),
    ...(event.context ? { context: redact(event.context) } : {}),
  };

  adapter?.(safe);

  const line = JSON.stringify({
    level: safe.level,
    event: safe.event,
    correlationId: safe.correlationId ?? null,
    route: safe.route ?? null,
    context: safe.context ?? {},
  });

  if (safe.level === 'error') console.error(line);
  else if (safe.level === 'warn') console.warn(line);
  else console.info(line);
}

/*
 * The production call path, executed.
 *
 * A no-op when no sink is configured and on the server, so importing this module
 * is safe everywhere; a real installation the moment a deployment sets the
 * variable. This one line is the difference between an adapter boundary and an
 * adapter boundary nobody ever attached anything to.
 */
installConfiguredMonitoringAdapter();
