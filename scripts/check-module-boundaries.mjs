#!/usr/bin/env node
/**
 * Module-boundary and layering enforcement (P1-13-BE-001, P1-13-DO-001).
 *
 * ESLint's `no-restricted-imports` already blocks the common deep-import
 * mistake. This script exists because the boundary is bigger than one rule and
 * needs to fail CI as its own named check:
 *
 *  - it enforces *layering*, not just module walls: handlers may not reach the
 *    data layer, and a module's `domain` directory may not reach the database;
 *  - it is dependency-free and runs identically locally and in CI, so "it passes
 *    on my machine" cannot mean a different rule set.
 *
 * ## Why every rule resolves the import before judging it (ADV-01)
 *
 * The first version of this checker matched rules against the **raw import
 * text**. Only two of its seven rules looked at anything but the `@/` alias, so
 * the architectural rule it advertised was really a rule about spelling: an
 * `import '@/server/db/pool'` from a Route Handler failed, and the byte-for-byte
 * equivalent `import '../../../server/db/pool'` passed. That was recorded as
 * finding **ADV-01** and confirmed by executing the checker against a fixture —
 * the alias form exited 1, the relative form exited 0.
 *
 * The fix is not another pattern. Every specifier is now resolved to one
 * canonical, project-relative, extensionless, index-collapsed path *before* any
 * rule sees it, so the same architectural rule applies no matter how the import
 * is spelled:
 *
 *     @/server/db/pool                      ─┐
 *     ../../../server/db/pool                │
 *     ../../../server/db/pool.ts             ├─→  server/db/pool
 *     ../../../server/db/pool/index          │
 *     ../../modules/../server/db/pool       ─┘
 *
 * A project-local import that cannot be resolved this way is a **violation**
 * (B8), not a pass: failing open on the one import the checker did not
 * understand is how a boundary guard becomes decorative.
 *
 * Usage:
 *   node scripts/check-module-boundaries.mjs [--scan-dir <dir>] [--json]
 *
 * `--scan-dir` points the checker at an alternative tree. The boundary test uses
 * it to prove deliberate violations actually fail, rather than asserting that
 * the checker "would" catch them. Within a scanned tree the `@/` alias maps to
 * that tree's root, matching `tsconfig.json` (`"@/*": ["./src/*"]`).
 *
 * Exit codes: 0 clean · 1 violations found · 2 usage/IO error.
 */
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const scanDirIndex = args.indexOf('--scan-dir');
const ROOT = process.cwd();
const SCAN_DIR = scanDirIndex >= 0 ? resolve(args[scanDirIndex + 1] ?? '') : resolve(ROOT, 'src');

if (scanDirIndex >= 0 && !args[scanDirIndex + 1]) {
  console.error('--scan-dir requires a directory argument');
  process.exit(2);
}

/** Normalises a path to forward slashes. */
function toPosix(path) {
  return path.split(sep).join('/');
}

/**
 * Symlinks found inside the scanned tree. A symlink defeats lexical resolution:
 * `app/api/shortcut -> server/db` turns the prohibited `../../../../server/db/x`
 * into the innocuous-looking `../shortcut/x`, which canonicalises to
 * `app/api/shortcut/x` and matches no layering rule. Rather than resolve real
 * paths for every import — which would make the checker's verdict depend on
 * whether a target happens to exist on disk — the tree is required to contain no
 * symlinks at all. The project has never used one; a new one is a deliberate act
 * and should be seen.
 */
const symlinks = [];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    console.error(`Cannot read ${dir}: ${error.message}`);
    process.exit(2);
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    // lstat, not stat: stat follows the link and reports the target's type.
    if (lstatSync(full).isSymbolicLink()) {
      symlinks.push(full);
      continue;
    }
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extracts import specifiers. Covers static imports (including `import type`),
 * `export … from` re-exports, dynamic `import()`, and `require()`. A regex is
 * sufficient and keeps the script dependency-free; the one shape it cannot see
 * is a computed specifier, which B9 refuses outright rather than ignores.
 */
function importsOf(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * A dynamic import whose specifier is not a literal cannot be classified, so it
 * cannot be policed. Detected separately from `importsOf`, which only sees
 * literals.
 */
function computedImportsOf(source) {
  const found = [];
  const patterns = [
    /\bimport\s*\(\s*(?!['"])([^)]{1,120})\)/g,
    /\brequire\s*\(\s*(?!['"])([^)]{1,120})\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) found.push(match[1].trim());
  }
  return found;
}

const SOURCE_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Collapses `.` and `..` inside a POSIX-style relative path. Needed for the
 * alias form: `resolve()` already does this for relative specifiers, but
 * `@/modules/alpha/../../server/db/pool` never touches the filesystem resolver
 * and would otherwise reach a rule as literal text containing `..`.
 */
function posixNormalize(path) {
  const out = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

/**
 * `server/db/pool.ts` → `server/db/pool`; `modules/beta/index` → `modules/beta`.
 *
 * Also collapses repeated separators, so `@//server//db` cannot differ from
 * `@/server/db`, and lower-cases the result. The lower-casing matters: Windows
 * and macOS have case-insensitive filesystems, so `../../Server/DB/transaction`
 * resolves to the real file there while `^server/` never matches it. Rules are
 * about which module owns a path, and no part of this tree distinguishes two
 * directories by case alone.
 */
function canonicalise(path) {
  let out = path.replace(/\/{2,}/g, '/');
  out = out.replace(SOURCE_EXTENSION, '');
  out = out.replace(/\/index$/, '');
  out = out.replace(/\/+$/, '');
  return out.toLowerCase();
}

/** True when a project-relative path points outside the scanned root. */
function escapesRoot(relativePath) {
  return relativePath === '' || relativePath === '..' || relativePath.startsWith('../');
}

/**
 * Resolves one specifier to a canonical project path.
 *
 * Returns one of:
 *   { kind: 'external' }                       npm package or node builtin — not ours to police
 *   { kind: 'project', target: 'server/db/pool' }
 *   { kind: 'unresolved', reason }             project-local but unclassifiable — fails closed
 */
function classify(absoluteFile, specifier) {
  if (specifier.startsWith('node:')) return { kind: 'external' };

  // The `@/` alias. Checked before the bare-package branch so `@scope/pkg`
  // (an ordinary scoped npm package) is not mistaken for it.
  if (specifier.startsWith('@/')) {
    const normalised = posixNormalize(specifier.slice(2));
    if (escapesRoot(normalised)) {
      return { kind: 'unresolved', reason: 'alias path escapes the source root' };
    }
    return { kind: 'project', target: canonicalise(normalised) };
  }

  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(absoluteFile), specifier);
    const relativePath = toPosix(relative(SCAN_DIR, resolved));
    if (escapesRoot(relativePath)) {
      return { kind: 'unresolved', reason: 'relative path escapes the scanned source root' };
    }
    return { kind: 'project', target: canonicalise(relativePath) };
  }

  // A filesystem-absolute specifier is never a legitimate way to import project
  // code; classify it so it cannot slip past as an "external package".
  if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)) {
    const relativePath = toPosix(relative(SCAN_DIR, resolve(specifier)));
    if (escapesRoot(relativePath)) {
      return { kind: 'unresolved', reason: 'absolute path outside the scanned source root' };
    }
    return { kind: 'project', target: canonicalise(relativePath) };
  }

  // Bare specifier: an npm package, possibly scoped.
  return { kind: 'external' };
}

/**
 * Rules receive the canonical `target` for project-local imports, and the raw
 * `specifier` for the one rule that is about an external package (B5/`pg`).
 * No rule may judge a project-local import by its raw text — that was ADV-01.
 */
const RULES = [
  {
    id: 'B1-module-internals-are-private',
    describe:
      'A module may be imported only through its public surface, "@/modules/<name>" — in any import syntax.',
    check: ({ file, specifier, target }) => {
      if (!target) return null;
      const match = /^modules\/([^/]+)\/(.+)$/.exec(target);
      if (!match) return null;
      // A module reaching into its OWN internals is normal and correct.
      const owner = /^modules\/([^/]+)\//.exec(file);
      if (owner && owner[1] === match[1]) return null;
      return `reaches module internals ("${specifier}" → ${target}); import "@/modules/${match[1]}" instead`;
    },
  },
  {
    id: 'B3-foundation-must-not-depend-on-modules',
    describe:
      'src/server, src/shared, src/lib and src/config are the foundation; dependencies point inward only.',
    check: ({ file, specifier, target }) => {
      if (!/^(server|shared|lib|config)\//.test(file)) return null;
      if (!target || !/^modules(\/|$)/.test(target)) return null;
      return `foundation file imports a domain module ("${specifier}" → ${target})`;
    },
  },
  {
    id: 'B4-handlers-hold-no-data-access',
    describe:
      'Route Handlers and Server Actions contain no business logic and no data access: they call an application service.',
    check: ({ file, specifier, target }) => {
      if (!/^app\//.test(file)) return null;
      if (!target || !/^server\/(db|events|audit|worker)(\/|$)/.test(target)) return null;
      return `handler imports the data/eventing layer directly ("${specifier}" → ${target}); go through a module application service`;
    },
  },
  {
    id: 'B5-domain-layer-is-database-free',
    describe: 'A module domain layer holds rules only and must not reach the database.',
    check: ({ file, specifier, target }) => {
      if (!/^modules\/[^/]+\/domain\//.test(file)) return null;
      // The database driver is an external package, so it is matched by name.
      if (specifier === 'pg') return 'domain-layer file imports the database driver ("pg")';
      if (!target || !/^server\/db(\/|$)/.test(target)) return null;
      return `domain-layer file imports data access ("${specifier}" → ${target})`;
    },
  },
  {
    id: 'B6-foundation-must-not-import-app',
    describe: 'The foundation must be usable without the Next.js app tree.',
    check: ({ file, specifier, target }) => {
      if (!/^(server|shared|lib|config|modules)\//.test(file)) return null;
      if (!target || !/^app(\/|$)/.test(target)) return null;
      return `imports the app tree ("${specifier}" → ${target})`;
    },
  },
  {
    id: 'B7-backend-uses-the-backend-logger',
    describe:
      'Backend code uses @/server/observability/logger; src/lib/logging/logger is the Phase 1-1 bootstrap logger.',
    check: ({ file, specifier, target }) => {
      if (!/^(server|modules)\//.test(file)) return null;
      if (target !== 'lib/logging/logger') return null;
      return `imports the Phase 1-1 bootstrap logger ("${specifier}"); use "@/server/observability/logger"`;
    },
  },
  {
    id: 'B8-project-imports-must-resolve',
    describe:
      'A project-local import that cannot be resolved to a canonical path is refused, so no import escapes the rules by being unclassifiable.',
    check: ({ specifier, kind, reason }) => {
      if (kind !== 'unresolved') return null;
      return `project-local import cannot be canonically resolved ("${specifier}"): ${reason}`;
    },
  },
  {
    id: 'B9-import-specifiers-must-be-literal',
    describe:
      'A computed import specifier cannot be checked against the boundary rules, so it is not permitted in the scanned tree.',
    check: ({ kind, specifier }) => {
      if (kind !== 'computed') return null;
      return `import specifier is computed, not a literal ("${specifier}"); the boundary rules cannot see through it`;
    },
  },
  {
    id: 'B10-no-symlinks-in-the-source-tree',
    describe:
      'A symlink makes a prohibited target reachable through a permitted-looking path, so the scanned tree may not contain one.',
    check: ({ kind, specifier }) => {
      if (kind !== 'symlink') return null;
      return `symlink in the source tree ("${specifier}"); it can launder a prohibited import into a permitted canonical path`;
    },
  },
];

const violations = [];
const files = walk(SCAN_DIR);

for (const absolute of files) {
  const file = toPosix(relative(SCAN_DIR, absolute));
  // Rules match owner and layer prefixes, so they compare against the same
  // case-folded form as the canonical target. The real spelling is reported.
  const fileKey = file.toLowerCase();
  const source = readFileSync(absolute, 'utf8');

  for (const specifier of importsOf(source)) {
    const classified = classify(absolute, specifier);
    const subject = { file: fileKey, specifier, ...classified };
    for (const rule of RULES) {
      const message = rule.check(subject);
      if (message) violations.push({ rule: rule.id, file, message });
    }
  }

  for (const expression of computedImportsOf(source)) {
    const subject = { file: fileKey, specifier: expression, kind: 'computed' };
    for (const rule of RULES) {
      const message = rule.check(subject);
      if (message) violations.push({ rule: rule.id, file, message });
    }
  }
}

// Symlinks are a property of the tree, not of any one import, so they are
// judged after the walk rather than per file.
for (const link of symlinks) {
  const file = toPosix(relative(SCAN_DIR, link));
  const subject = { file: file.toLowerCase(), specifier: file, kind: 'symlink' };
  for (const rule of RULES) {
    const message = rule.check(subject);
    if (message) violations.push({ rule: rule.id, file, message });
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ scanned: files.length, violations }, null, 2));
} else {
  console.log(
    `Module-boundary check: ${files.length} files scanned in ${toPosix(relative(ROOT, SCAN_DIR)) || '.'}`
  );
  console.log(`Rules enforced: ${RULES.map((rule) => rule.id).join(', ')}`);
  if (violations.length === 0) {
    console.log('OK: no boundary or layering violation');
  } else {
    console.error(`\n${violations.length} violation(s):`);
    for (const violation of violations) {
      console.error(`  [${violation.rule}] ${violation.file}: ${violation.message}`);
    }
  }
}

process.exit(violations.length === 0 ? 0 : 1);
