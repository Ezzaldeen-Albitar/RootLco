/**
 * Browser Supabase client.
 *
 * Uses only the anon key, which is designed to be public. Its safety depends
 * entirely on Row-Level Security. RLS is NOT yet implemented -- no tenant-owned
 * tables exist yet -- and is a mandatory Phase 1-2 gate. See ADR-004.
 *
 * No business-domain query belongs here. Phase 1-1 establishes wiring only.
 */
import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/config/env';

export function createClient() {
  const env = clientEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
