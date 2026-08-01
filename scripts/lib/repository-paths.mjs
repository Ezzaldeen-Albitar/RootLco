/**
 * The repository's single path authority.
 *
 * Every executable that needs to find application source must ask this module.
 * Nothing else may derive the repository root, and nothing else may spell
 * `apps/api` or `apps/web`.
 *
 * ## Why this exists
 *
 * Before the workspace normalization, three validators located the tree three
 * different ways: `p1-24-operation-register.mjs` from `import.meta.url/..`,
 * `check-authorization-coverage.mjs` and `check-operation-test-coverage.mjs`
 * from `process.cwd()`. Each was individually defensible and collectively they
 * meant "the repository root" had three definitions that agreed only by
 * accident of invocation directory.
 *
 * The first `apps/api` migration attempt then rewrote path LITERALS across 21
 * scripts, and produced `apps/api/apps/api/src/app/api` — a base that already
 * contained the prefix, joined with a segment that now also contained it. That
 * failure is not fixed by a more careful sweep; it is fixed by there being one
 * place that knows.
 *
 * ## The invariant
 *
 * The root is derived from THIS FILE'S location, never from `process.cwd()`.
 * A validator therefore resolves the same paths whether it is invoked from the
 * repository root, from `apps/api`, from `apps/web`, from a hosted CI runner or
 * from a clean-room checkout — which is the property `process.cwd()` cannot
 * offer and which CI exercises every time it changes directory.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository root, derived from this module's own location.
 *
 * This file lives at `<root>/scripts/lib/repository-paths.mjs`, so the root is
 * two directories up. Deriving it from the module rather than the process is
 * the whole point: `process.cwd()` is a property of the caller, not of the
 * repository.
 */
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Joins onto the repository root. The ONLY way to build a repository path. */
export function fromRoot(...segments) {
  return join(REPOSITORY_ROOT, ...segments);
}

// --- applications -----------------------------------------------------------

export const APPS_ROOT = fromRoot('apps');

export const API_ROOT = join(APPS_ROOT, 'api');
export const API_SRC_ROOT = join(API_ROOT, 'src');
export const API_APP_ROOT = join(API_SRC_ROOT, 'app');
export const API_ROUTES_ROOT = join(API_APP_ROOT, 'api');
export const API_ROUTES_V1_ROOT = join(API_ROUTES_ROOT, 'v1');
export const API_PUBLIC_ROOT = join(API_ROOT, 'public');

export const WEB_ROOT = join(APPS_ROOT, 'web');
export const WEB_SRC_ROOT = join(WEB_ROOT, 'src');

// --- repository-owned directories -------------------------------------------

export const TESTS_ROOT = fromRoot('tests');
export const SCRIPTS_ROOT = fromRoot('scripts');
export const SUPABASE_ROOT = fromRoot('supabase');
export const DOCS_ROOT = fromRoot('docs');
export const GITHUB_ROOT = fromRoot('.github');

/**
 * Repository-RELATIVE POSIX path, for messages, manifests and evidence.
 *
 * Reports and committed artefacts must never contain an absolute path: it
 * differs between a developer's machine and a CI runner, which turns a
 * generated file into a permanent diff. Always POSIX separators, for the same
 * reason.
 */
export function toRepositoryPath(absolutePath) {
  const relative = resolve(absolutePath).slice(REPOSITORY_ROOT.length);
  return relative.split(sep).join('/').replace(/^\//, '');
}

// --- repository-RELATIVE forms ----------------------------------------------
//
// A gate that classifies a git-changed path, or a manifest that names a tree,
// works in repository-relative POSIX text, not in absolute paths. Those spellings
// belong to the same authority: `'apps/api/src'` written by hand in twenty
// scripts is the same defect as an absolute path derived twenty ways, and it is
// how the first migration attempt produced `apps/api/apps/api`.
//
// Derived from the absolute constants above rather than written out again, so
// the two forms cannot drift apart.

/** `apps/api` — repository-relative, POSIX. */
export const API_PATH = toRepositoryPath(API_ROOT);
/** `apps/api/src` — repository-relative, POSIX. */
export const API_SRC_PATH = toRepositoryPath(API_SRC_ROOT);
/** `apps/api/src/app/api` — repository-relative, POSIX. */
export const API_ROUTES_PATH = toRepositoryPath(API_ROUTES_ROOT);
/** `apps/api/src/app/api/v1` — repository-relative, POSIX. */
export const API_ROUTES_V1_PATH = toRepositoryPath(API_ROUTES_V1_ROOT);
/** `apps/web` — repository-relative, POSIX. */
export const WEB_PATH = toRepositoryPath(WEB_ROOT);
/** `apps/web/src` — repository-relative, POSIX. */
export const WEB_SRC_PATH = toRepositoryPath(WEB_SRC_ROOT);

/**
 * Repository-relative POSIX path under the API application's source root.
 *
 * `apiSrcPath('modules', 'billing')` → `apps/api/src/modules/billing`.
 * Accepts pre-joined segments (`apiSrcPath('modules/billing')`) so existing
 * tables of paths keep their readable one-line form.
 */
export function apiSrcPath(...segments) {
  return [API_SRC_PATH, ...segments].join('/').replace(/\/+/g, '/');
}

/**
 * Fails loudly if the tree is not the shape this module claims.
 *
 * A path helper that silently returns a directory which does not exist is worse
 * than no helper: every downstream check then reports "0 files found", which
 * reads as a clean result. This makes that impossible — the same reasoning the
 * repository's other gates already apply to empty result sets.
 */
export function assertLayout({ requireApi = true, requireWeb = true } = {}) {
  const missing = [];
  if (requireApi && !existsSync(API_ROUTES_ROOT)) missing.push(toRepositoryPath(API_ROUTES_ROOT));
  if (requireWeb && !existsSync(WEB_SRC_ROOT)) missing.push(toRepositoryPath(WEB_SRC_ROOT));
  if (missing.length > 0) {
    throw new Error(
      `repository layout is not as expected — missing: ${missing.join(', ')}. ` +
        'Paths come from scripts/lib/repository-paths.mjs; if the topology changed, change it there.'
    );
  }
}
