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
  NEXT_PUBLIC_APP_ENV: z.enum(['local', 'preview', 'production']).default('local'),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
});

export type PublicEnv = z.infer<typeof schema>;

function read(): PublicEnv {
  const parsed = schema.safeParse({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
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
