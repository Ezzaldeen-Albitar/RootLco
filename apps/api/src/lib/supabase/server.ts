/**
 * Server Supabase client.
 *
 * Server code still uses the ANON key plus the caller's session, so Row-Level
 * Security applies to it. The service-role key bypasses RLS entirely and is
 * deliberately NOT wired in here: Phase 1-1 has no privileged server operation,
 * and introducing a bypass before RLS exists would be unsafe. See ADR-004.
 *
 * When a service-role path is genuinely needed, it must be added in a dedicated,
 * reviewed module -- never imported into client components.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clientEnv } from '@/config/env';

export async function createClient() {
  const env = clientEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by middleware in later phases.
        }
      },
    },
  });
}
