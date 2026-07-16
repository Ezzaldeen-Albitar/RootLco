/**
 * Runtime environment validation.
 *
 * P1-01-DO-002 (verify environment readiness), P1-01-SEC-005 (no secrets leaked).
 *
 * Two rules govern this file:
 *
 *  1. Server-only secrets must never reach the browser bundle. Next.js only inlines
 *     variables prefixed with NEXT_PUBLIC_, so anything without that prefix is read
 *     lazily and only inside `serverEnv()`, which throws if called from the browser.
 *
 *  2. A validation failure must never print a secret's VALUE. We report the variable
 *     NAME and the reason only. Zod issues are mapped by path, and the raw input is
 *     never included in the message.
 */
import { z } from 'zod';

/** Values that are safe to expose to the browser. */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, 'is required')
    .url('must be a valid URL, for example http://127.0.0.1:54321'),
  // The Supabase anon key is designed to be public. It is only safe because
  // Row-Level Security constrains it. RLS is NOT yet implemented -- no tenant
  // tables exist yet -- and is a mandatory Phase 1-2 gate. See ADR-004.
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'is required'),
  NEXT_PUBLIC_APP_ENV: z.enum(['local', 'development', 'staging', 'production']).default('local'),
});

/** Values that must never leave the server. */
const serverSchema = z.object({
  // Bypasses Row-Level Security entirely. Never expose, never log, never prefix
  // with NEXT_PUBLIC_. Optional in Phase 1-1 because no server-side privileged
  // operation exists yet.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

/** Formats issues without ever echoing a value. */
function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const name = issue.path.join('.') || '(root)';
      return `  - ${name}: ${issue.message}`;
    })
    .join('\n');
}

export class EnvironmentValidationError extends Error {
  public override readonly name = 'EnvironmentValidationError';
  constructor(scope: 'client' | 'server', detail: string) {
    super(
      `Invalid ${scope} environment configuration.\n${detail}\n\n` +
        `Copy .env.example to .env.local and provide local values.\n` +
        `Run "npm run supabase:status" to read the local Supabase URL and anon key.\n` +
        `No secret values are shown above by design.`
    );
  }
}

/**
 * Referenced literally so the Next.js compiler can inline them. Destructuring
 * `process.env` or indexing it dynamically would leave them undefined in the
 * browser bundle.
 */
const rawClientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
};

let cachedClientEnv: ClientEnv | undefined;

/** Validated, browser-safe configuration. Throws a safe error when misconfigured. */
export function clientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;
  const parsed = clientSchema.safeParse(rawClientEnv);
  if (!parsed.success) {
    throw new EnvironmentValidationError('client', describe(parsed.error));
  }
  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}

let cachedServerEnv: ServerEnv | undefined;

/** Validated server-only configuration. Refuses to run in the browser. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      'serverEnv() was called in the browser. Server-only configuration must never ' +
        'be imported into client code. Use clientEnv() instead.'
    );
  }
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (!parsed.success) {
    throw new EnvironmentValidationError('server', describe(parsed.error));
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/**
 * Non-throwing probe used by the health endpoint. Reports only whether required
 * configuration resolved -- never which value, never any value.
 */
export function environmentIsConfigured(): boolean {
  return clientSchema.safeParse(rawClientEnv).success;
}

/** Test seam: clears memoised values. Not used by application code. */
export function __resetEnvCacheForTests(): void {
  cachedClientEnv = undefined;
  cachedServerEnv = undefined;
}

/** Exported for unit tests so schema rules can be asserted without process.env. */
export const __schemas = { clientSchema, serverSchema };
