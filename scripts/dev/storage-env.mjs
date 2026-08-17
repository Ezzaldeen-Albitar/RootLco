#!/usr/bin/env node
/**
 * The object store the Owner acceptance environment actually uses.
 *
 * ## Why this file exists at all
 *
 * `STORAGE_PROVIDER` defaults to `unconfigured`, and that adapter refuses to
 * sign rather than pretending a store exists. The other test-time option,
 * `local_fake`, signs against a host in the reserved `.invalid` TLD — verifiable
 * and permanently useless, which is exactly what stops it becoming production.
 *
 * So until something configures a real store, the evidence chain is complete in
 * the API and dead in every environment: a version is registered, no object can
 * be read back, and it stays `pending` for ever. That was recorded as the
 * `no-storage-provider` blocker, and it stayed true long after an S3 adapter had
 * been written — because a class that COULD be configured is not a store that
 * IS. This module is what makes the difference, and it is deliberately a
 * launcher concern rather than a committed value.
 *
 * ## Where the values come from
 *
 * `supabase status -o env`. The local stack this repository already depends on
 * exposes an S3-compatible protocol at `/storage/v1/s3` and prints its own
 * credentials, so the acceptance environment needs no account anywhere and no
 * secret in the tree.
 *
 * ## Three rules this module keeps
 *
 *   - **Nothing is committed.** The values are read at launch and handed to a
 *     child process. `git` never sees them, and a rotated local stack simply
 *     produces different ones on the next launch.
 *   - **The API process only.** `apps/web` receives none of this. It holds no
 *     `STORAGE_*` variable, signs nothing and builds no key — the whole reason
 *     the capture Server Action PUTs to a URL the API just issued rather than to
 *     one it worked out.
 *   - **Never `NEXT_PUBLIC_`.** A `NEXT_PUBLIC_` prefix is inlined into the
 *     client bundle at build time, so prefixing either credential would publish
 *     it to every browser. The names below are checked against that prefix by
 *     `tests/ci/storage-env.test.ts` rather than trusted to review.
 *
 * ## When it cannot be read
 *
 * The launcher continues WITHOUT storage rather than failing. An acceptance
 * environment that will not start because an optional store is absent is worse
 * than one that starts and says capture is unavailable — and "unavailable"
 * is now a truthful runtime state the capture screen renders, not a pretence.
 */
import { execSync } from 'node:child_process';

/** The Supabase status keys this reads, and what each becomes. */
export const STORAGE_KEY_MAP = Object.freeze({
  STORAGE_S3_URL: 'STORAGE_S3_ENDPOINT',
  S3_PROTOCOL_ACCESS_KEY_ID: 'STORAGE_S3_ACCESS_KEY_ID',
  S3_PROTOCOL_ACCESS_KEY_SECRET: 'STORAGE_S3_SECRET_ACCESS_KEY',
  S3_PROTOCOL_REGION: 'STORAGE_S3_REGION',
});

/** Everything this module may emit. Asserted to carry no `NEXT_PUBLIC_` name. */
export const STORAGE_ENV_NAMES = Object.freeze([
  'STORAGE_PROVIDER',
  ...Object.values(STORAGE_KEY_MAP),
  'STORAGE_S3_FORCE_PATH_STYLE',
  'STORAGE_BUCKET',
]);

/**
 * Parse `supabase status -o env` output into a plain map.
 *
 * Exported so the parser can be proved against a captured sample rather than
 * against a running stack: a parser that only works when Docker is up is a
 * parser nobody checks.
 */
export function parseStatusEnv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?([^"]*)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/**
 * The API-tier environment fragment, or `null` when no store can be configured.
 *
 * `null` rather than a throw, and rather than a half-configured fragment: an
 * `s3_compatible` provider missing a credential throws at composition and takes
 * the whole API down, so a partial read must produce nothing at all.
 */
export function storageEnvFrom(status) {
  const wanted = Object.entries(STORAGE_KEY_MAP);
  const fragment = { STORAGE_PROVIDER: 's3_compatible' };
  for (const [from, to] of wanted) {
    const value = status[from];
    if (!value) return null;
    fragment[to] = value;
  }
  // Supabase serves S3 path-style; the bucket is created on first use because
  // the composition root passes `provisioning: 'ensure'` for a local app env.
  fragment.STORAGE_S3_FORCE_PATH_STYLE = 'true';
  fragment.STORAGE_BUCKET = status.STORAGE_BUCKET || 'rootlco-attachments';
  return fragment;
}

/** Reads the live stack. Returns `null` when the CLI is absent or the stack is down. */
export function resolveStorageEnv() {
  let text;
  try {
    // One command string, not an argv with `shell: true` — the latter is the
    // shape Node deprecated for exactly the reason it looks like: arguments are
    // concatenated rather than escaped.
    text = execSync('npx supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return storageEnvFrom(parseStatusEnv(text));
}

/** What the launcher prints. Names only — a value here would be the leak. */
export function describeStorageEnv(fragment) {
  if (fragment === null) {
    return [
      '  STORAGE_PROVIDER          unconfigured (no local S3 endpoint could be read)',
      '  evidence capture will report the store as unavailable, which is true',
    ];
  }
  return [
    `  STORAGE_PROVIDER          ${fragment.STORAGE_PROVIDER}`,
    `  STORAGE_S3_ENDPOINT       ${fragment.STORAGE_S3_ENDPOINT}`,
    `  STORAGE_BUCKET            ${fragment.STORAGE_BUCKET}`,
    '  credentials injected into the API process only, and never printed',
  ];
}
