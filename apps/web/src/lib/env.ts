import { z } from 'zod';

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
   * BROWSER calls, and `src/proxy.ts` also derives the CSP `connect-src` from
   * it. With the literal here a page served from `http://localhost:3100` was
   * told to call `http://127.0.0.1:3000`: a different origin by the same
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
   * Setting it is not sufficient on its own: the origin must also appear in
   * `connect-src` in `src/proxy.ts`, or the browser blocks the delivery.
   */
  NEXT_PUBLIC_CLIENT_MONITORING_URL: z.string().url().optional(),
});

export type PublicEnv = z.infer<typeof schema>;

function read(): PublicEnv {
  const parsed = schema.safeParse({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_CLIENT_MONITORING_URL: process.env.NEXT_PUBLIC_CLIENT_MONITORING_URL,
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
