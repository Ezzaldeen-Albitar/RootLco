import { defineConfig } from 'vitest/config';
import { API_SRC_ROOT } from './scripts/lib/repository-paths.mjs';

// Database test harness configuration (P1-02-QA-001..005).
// Requires a running PostgreSQL with migrations applied:
//   local: `npm run supabase:start && npm run supabase:reset`
//   CI:    the postgres service container + scripts/db/apply-migrations.mjs
// Connection comes from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
// (defaults match the Supabase local stack). See tests/db/helpers.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    // Database fixtures are stateful: files run sequentially so cleanup in one
    // file can never race provisioning in another. Concurrency is exercised
    // INSIDE the tests (50 parallel connections), not by the runner.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { '@api': API_SRC_ROOT, '@': API_SRC_ROOT },
  },
});
