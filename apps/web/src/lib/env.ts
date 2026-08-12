import { z } from 'zod';

/**
 * The client log severities, **in ascending order**, and the one place that
 * order is written down.
 *
 * It lives here rather than in `lib/observability/client-log.ts` for a reason
 * that is structural and not stylistic: `client-log.ts` imports this module, so
 * this module cannot import it back without a cycle — and the schema below has
 * to validate against exactly this vocabulary. Declaring the four names twice
 * would put the routing threshold's vocabulary and the logger's vocabulary in
 * two files that no check compares, which is the shape of defect this phase has
 * shipped repeatedly. `client-log.ts` re-exports `LogLevel` from here, so every
 * existing importer is unaffected.
 *
 * **The order is the comparison.** `NEXT_PUBLIC_CLIENT_MONITORING_LEVEL` is a
 * threshold, and an event routes when its own index in this tuple is at or above
 * the configured level's index. There is no second rank table to fall out of
 * step with the enum — reordering this tuple reorders the threshold, which is
 * why the ordering is asserted in `tests/observability.test.ts` rather than
 * merely commented.
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Environment validation.
 *
 * Validated at module load so a misconfigured deployment fails at boot with a
 * readable message rather than at the first request with a confusing one.
 *
 * Only `NEXT_PUBLIC_*` values may appear here. Anything else would be inlined
 * into the client bundle by Next, which is how secrets leak; the schema below
 * is deliberately the complete list of what the browser is allowed to know.
 */
const schema = z.object({
  /**
   * Defaults to `production`, NOT to `local`.
   *
   * This value decides whether the session cookie carries `Secure`. Defaulting
   * it to `local` meant a deployment that forgot to set it served the session
   * over plain HTTP, silently — a security attribute whose safe state depends on
   * a variable being present is not a control (finding `P1-26-F-023`).
   *
   * The local runtime sets it explicitly, which is the right way round: the
   * unsafe mode is the one you have to ask for.
   */
  NEXT_PUBLIC_APP_ENV: z.enum(['local', 'preview', 'production']).default('production'),
  /**
   * The canonical local API origin — `localhost`, never the loopback literal.
   *
   * This value is inlined into the client bundle, so it is the address the
   * BROWSER calls, and `src/proxy.ts` passes it to the CSP builder, so the
   * `connect-src` directive is derived from it as well. With the literal here a
   * page served from `http://localhost:3100` was told to call
   * `http://127.0.0.1:3000`: a different origin by the same
   * host-string comparison that `P1-26-F-048` is about, and a `connect-src`
   * naming an origin the app is not served from (`P1-26-F-062`).
   *
   * `scripts/dev/dev-config.mjs` holds the same value as `API_ORIGIN`, and a
   * test asserts the two agree.
   */
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3000'),
  /**
   * Where client diagnostics are delivered, if a deployment operates a sink.
   *
   * **Optional, with no default, on purpose.** `P1-27-DO-002` is about the
   * monitoring adapter having had zero production callers; the answer is a
   * caller a deployment can switch on, not a URL invented here. Unset means
   * `installConfiguredMonitoringAdapter` installs nothing and
   * `currentAdapter()` stays `null` — the documented, tested default. No vendor
   * is named and no external service is claimed to exist.
   *
   * **A BUILD-time switch, not a deploy-time one.** Every `NEXT_PUBLIC_*` value
   * is inlined by Next during `next build`, and the beacon URL in
   * `lib/observability/client-log.ts` is inlined into the client bundle like the
   * rest. Set on an already-built deployment this variable does nothing at all:
   * it has to be present for the build, and a change to it needs a rebuild.
   *
   * Delivery is by `navigator.sendBeacon`, which the browser governs by the CSP
   * `connect-src` directive, and setting this variable admits the origin
   * automatically: `src/proxy.ts` reads the same variable and hands it to
   * `contentSecurityPolicy` in `src/lib/security/csp.ts`, which is the one place
   * `connect-src` is assembled and which adds the ORIGIN (path discarded).
   * Unset, the header is byte identical to what it was without a sink.
   *
   * This corrects a false instruction that shipped here and in
   * `client-log.ts`: it named the proxy file as the place to widen the policy by
   * hand. No directive is written there, and the builder took no parameter for a
   * second origin, so the documented way to switch the feature on could not work
   * at all (`P1-27-DO-002`).
   */
  NEXT_PUBLIC_CLIENT_MONITORING_URL: z.string().url().optional(),
  /**
   * **The routing rule: which events leave the browser, and at what severity.**
   *
   * The sink variable above answers *where*. This one answers *which*, and the
   * pair is what `P1-27-DO-002` calls alert routing at this tier. Routing here
   * means deciding what is worth sending off the device — it is not an on-call
   * rotation, a pager or a notification service, and this repository operates
   * none of those (`P1-27-OD-006`).
   *
   * **Fails closed, in the two ways that matter.**
   *
   * 1. *Unset* → `'error'`, the narrowest of the four, not the widest. Every
   *    event that leaves is data leaving the operator's browser, so the default
   *    has to be the least of it. A deployment that has thought about the
   *    question widens it deliberately; one that has not sends faults only.
   *    `'error'` is also the only level `FAILURE_REPORT_LEVEL` in
   *    `lib/api/client.ts` assigns to *the system failed* — a 5xx, a transport
   *    fault, our own timeout — so the unconfigured default is exactly the set
   *    an alert would be raised on.
   * 2. *Invalid* → the deployment does not boot. `z.enum` refuses anything
   *    outside `LOG_LEVELS`, and `read()` throws naming the field. A threshold
   *    that silently fell back on a typo would be a routing rule nobody could
   *    trust, and the failure would be invisible: too much would leave, or
   *    nothing would.
   *
   * Setting it without a sink routes nothing, because there is nowhere to route
   * to — the destination is what installs an adapter at all.
   *
   * **A BUILD-time switch**, like every `NEXT_PUBLIC_*` value: Next inlines it
   * during `next build`, so changing it on a running deployment changes nothing
   * until the next build. The same sentence as the sink URL, and true for the
   * same reason.
   */
  NEXT_PUBLIC_CLIENT_MONITORING_LEVEL: z.enum(LOG_LEVELS).optional(),
});

export type PublicEnv = z.infer<typeof schema>;

function read(): PublicEnv {
  const parsed = schema.safeParse({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_CLIENT_MONITORING_URL: process.env.NEXT_PUBLIC_CLIENT_MONITORING_URL,
    NEXT_PUBLIC_CLIENT_MONITORING_LEVEL: process.env.NEXT_PUBLIC_CLIENT_MONITORING_LEVEL,
  });

  if (!parsed.success) {
    // Names only — never values. An invalid env var is frequently a
    // misconfigured secret, and echoing it into a log is how it gets recorded.
    const fields = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
    throw new Error(`Invalid public environment configuration: ${fields}`);
  }
  return parsed.data;
}

export const env: PublicEnv = read();
