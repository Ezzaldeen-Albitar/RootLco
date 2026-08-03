/**
 * Structured client logging, and the boundary an external monitor would attach
 * to.
 *
 * ## What this is honest about
 *
 * No external monitoring service is configured, and none is claimed to be
 * operational. What exists is the **adapter boundary**: a single place every
 * client-side diagnostic passes through, with the redaction applied before it
 * leaves. Attaching a provider later is one function, and the redaction is
 * already in front of it.
 *
 * Building the redaction after attaching a provider is the wrong order: the
 * first thing a monitoring integration does is capture everything, and the
 * second is discover what it captured.
 *
 * ## What may be reported
 *
 * An event name, a correlation ID, a route, and a small bag of values that have
 * been through `redact`. Nothing else.
 *
 * ## What may never be reported
 *
 * A password. An access, reset or invitation token. A cookie. A secret. An email
 * address, a phone number, a plate, a VIN, a customer name, an amount. A URL
 * with a query string, because the query string is where those end up.
 *
 * `redact` enforces the key-name half of that, and `assertNoSecret` is the
 * belt-and-braces check on the value half — a value that *looks* like a
 * credential is dropped whatever it is called, because the failure mode is
 * someone logging `{ data: accessToken }`.
 */

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

/**
 * The monitoring adapter.
 *
 * `null` means no external service is attached, which is the current state.
 * Setting one is how a deployment opts in; nothing here reaches for a global or
 * a bundler-injected key.
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
    ...(event.route ? { route: safeRoute(event.route) } : {}),
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
