#!/usr/bin/env node
/**
 * The two credential kinds the authenticated browser tier signs in as, and what
 * each of them holds — written down where a Playwright spec can read it.
 *
 * ## The problem this exists for
 *
 * Two different accounts reach the P1-31 acceptance screens, and they hold
 * different permission sets:
 *
 *   - `owner-acceptance` — what `npm run acceptance:create-owner` creates, and what
 *     `auth.setup.ts` signs in as in the governed job. Its codes are
 *     `OWNER_PERMISSIONS` in `context.mjs`.
 *   - `org-administrator` — the first administrator of the organisation the P1-31
 *     acceptance journey provisions. Its codes are
 *     `TENANT_ADMINISTRATOR_ROLE.permissionCodes` in
 *     `apps/api/src/modules/iam/domain/bootstrap-roles.ts`.
 *
 * A browser case that asserted "either the surface or a refusal" to cover both was
 * the shape the Owner refused: it passes whichever way the screen answers, so it
 * cannot fail for the reason it exists. The alternative is for the spec to KNOW
 * which set is in front of it and pin the one outcome that credential is entitled
 * to — which needs the two sets readable from `apps/web`.
 *
 * ## Why a generated FILE and not an import
 *
 * `apps/web/tsconfig.json` sets `allowJs: false`, so nothing under `apps/web` may
 * import `context.mjs`; and a Playwright spec importing `apps/api` source would
 * breach the web boundary outright. A committed JSON document is the only shape
 * that crosses, and a hand-written one would drift from both authorities silently.
 * So it is generated here and `tests/ci/p1-31-account-manifest.test.ts` fails when
 * the committed document and the two runtime sets disagree.
 *
 * ## How the two sets are read
 *
 * `OWNER_PERMISSIONS` is imported — this is an ESM script and `context.mjs` is an
 * ESM module. The tenant administrator bundle is PARSED out of its own TypeScript
 * source by `readTenantAdministratorBundle`, which is the reader the backfill tool
 * already owns, for the reason stated there: a second hand-written copy of the
 * bundle would drift from the constant the provisioning path actually writes.
 *
 * Usage:
 *
 *     node scripts/dev/owner-acceptance/emit-account-manifest.mjs            (writes)
 *     node scripts/dev/owner-acceptance/emit-account-manifest.mjs --check    (compares)
 *
 * Exit codes: 0 written or already current · 1 `--check` found a difference.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_PERMISSIONS } from './context.mjs';
import { readTenantAdministratorBundle } from '../../platform/backfill-tenant-administrator-bundle.mjs';
import { WEB_ROOT, toRepositoryPath } from '../../lib/repository-paths.mjs';

/** The document the browser tier reads. One place, named once. */
export const ACCOUNT_MANIFEST_PATH = join(
  WEB_ROOT,
  'tests',
  'e2e',
  'authenticated',
  'account-manifest.json'
);

/** The command a failing check tells a reader to run. */
export const EMIT_COMMAND = 'node scripts/dev/owner-acceptance/emit-account-manifest.mjs';

/**
 * The two sets, sorted.
 *
 * Sorted because the committed document is diffed by people: an order that follows
 * the declaration would move every line when a code is inserted in the middle, and
 * a reviewer would have no way to see which one was added.
 */
export function accountManifest() {
  return {
    'owner-acceptance': [...OWNER_PERMISSIONS].sort(),
    'org-administrator': [...readTenantAdministratorBundle()].sort(),
  };
}

/** The exact bytes the file carries, so writing and checking cannot disagree. */
export function accountManifestDocument() {
  return `${JSON.stringify(accountManifest(), null, 2)}\n`;
}

function main(argv) {
  const wanted = accountManifestDocument();
  const shown = toRepositoryPath(ACCOUNT_MANIFEST_PATH);
  if (argv.includes('--check')) {
    let current = null;
    try {
      current = readFileSync(ACCOUNT_MANIFEST_PATH, 'utf8');
    } catch {
      current = null;
    }
    if (current === wanted) {
      process.stdout.write(`${shown} is current\n`);
      return 0;
    }
    process.stderr.write(
      `${shown} does not match the two authorities it is generated from.\nRun: ${EMIT_COMMAND}\n`
    );
    return 1;
  }
  writeFileSync(ACCOUNT_MANIFEST_PATH, wanted, 'utf8');
  process.stdout.write(`wrote ${shown}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
