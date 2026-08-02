/**
 * The one place the local topology is written down.
 *
 * API on 3000 because the web tier's default API base is
 * `http://127.0.0.1:3000` (`apps/web/src/lib/env.ts`) — the two values must
 * agree, and this file plus that schema are the complete list of places the
 * port lives. Web on 3100: out of the way of the API, of Supabase (54321–54324)
 * and of the Playwright web server (3210).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const API_PORT = 3000;
export const WEB_PORT = 3100;
export const API_READY_PATH = '/api/v1/health/ready';

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export const STATE_FILE = resolve(repoRoot(), '.local', 'dev-state.json');
