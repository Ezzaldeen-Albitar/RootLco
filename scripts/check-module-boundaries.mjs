#!/usr/bin/env node
/**
 * Module-boundary and layering enforcement (P1-13-BE-001, P1-13-DO-001).
 *
 * ESLint's `no-restricted-imports` already blocks the common deep-import
 * mistake. This script exists because the boundary is bigger than one rule and
 * needs to fail CI as its own named check:
 *
 *  - it sees relative paths that escape a module (`../../modules/x/data/y`),
 *    which a pattern on the `@/` alias never matches;
 *  - it enforces *layering*, not just module walls: handlers may not reach the
 *    data layer, and a module's `domain` directory may not reach the database;
 *  - it is dependency-free and runs identically locally and in CI, so "it passes
 *    on my machine" cannot mean a different rule set.
 *
 * Usage:
 *   node scripts/check-module-boundaries.mjs [--scan-dir <dir>] [--json]
 *
 * `--scan-dir` points the checker at an alternative tree. The boundary test uses
 * it to prove a deliberate violation actually fails, rather than asserting that
 * the checker "would" catch it.
 *
 * Exit codes: 0 clean · 1 violations found · 2 usage/IO error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const scanDirIndex = args.indexOf('--scan-dir');
const ROOT = process.cwd();
const SCAN_DIR = scanDirIndex >= 0 ? resolve(args[scanDirIndex + 1] ?? '') : resolve(ROOT, 'src');

if (scanDirIndex >= 0 && !args[scanDirIndex + 1]) {
  console.error('--scan-dir requires a directory argument');
  process.exit(2);
}

/** Normalises a path to forward slashes relative to the scanned root. */
function toPosix(path) {
  return path.split(sep).join('/');
}

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
 * Extracts import specifiers. Covers static imports, `export … from`, dynamic
 * `import()`, and `require()`. A regex is sufficient and keeps the script
 * dependency-free; the shapes it could miss (a computed specifier) are not
 * legal ways to cross a module boundary anyway.
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

/** Resolves a relative specifier against the importing file, for alias-free checks. */
function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = resolve(join(fromFile, '..'), specifier);
  return toPosix(relative(SCAN_DIR, resolved));
}

const RULES = [
  {
    id: 'B1-module-deep-import',
    describe: 'A module may be imported only through its public surface, "@/modules/<name>".',
    check: (file, specifier) => {
      const match = /^@\/modules\/([^/]+)\/(.+)$/.exec(specifier);
      if (!match) return null;
      // A module reaching into its OWN internals is normal and correct.
      const owner = /^modules\/([^/]+)\//.exec(file);
      if (owner && owner[1] === match[1]) return null;
      return `imports "${specifier}"; use "@/modules/${match[1]}" instead`;
    },
  },
  {
    id: 'B2-relative-module-escape',
    describe: 'A relative path may not reach into another module.',
    check: (file, specifier, resolvedPath) => {
      if (!resolvedPath || !resolvedPath.startsWith('modules/')) return null;
      const target = /^modules\/([^/]+)\/(.*)$/.exec(resolvedPath);
      const owner = /^modules\/([^/]+)\//.exec(file);
      if (!target) return null;
      if (owner && owner[1] === target[1]) return null;
      if (target[2] === '' || target[2] === 'index' || target[2].startsWith('index.')) return null;
      return `reaches module internals via a relative path ("${specifier}")`;
    },
  },
  {
    id: 'B3-foundation-must-not-depend-on-modules',
    describe:
      'src/server, src/shared, src/lib and src/config are the foundation; dependencies point inward only.',
    check: (file, specifier) => {
      if (!/^(server|shared|lib|config)\//.test(file)) return null;
      if (!/^@\/modules(\/|$)/.test(specifier)) return null;
      return `foundation file imports a domain module ("${specifier}")`;
    },
  },
  {
    id: 'B4-handlers-hold-no-data-access',
    describe:
      'Route Handlers and Server Actions contain no business logic and no data access: they call an application service.',
    check: (file, specifier) => {
      if (!/^app\//.test(file)) return null;
      if (/^@\/server\/(db|events|audit|worker)(\/|$)/.test(specifier)) {
        return `handler imports the data/eventing layer directly ("${specifier}"); go through a module application service`;
      }
      return null;
    },
  },
  {
    id: 'B5-domain-layer-is-database-free',
    describe: 'A module domain layer holds rules only and must not reach the database.',
    check: (file, specifier) => {
      if (!/^modules\/[^/]+\/domain\//.test(file)) return null;
      if (/^@\/server\/db(\/|$)/.test(specifier) || /^pg$/.test(specifier)) {
        return `domain-layer file imports data access ("${specifier}")`;
      }
      return null;
    },
  },
  {
    id: 'B6-foundation-must-not-import-app',
    describe: 'The foundation must be usable without the Next.js app tree.',
    check: (file, specifier) => {
      if (!/^(server|shared|lib|config|modules)\//.test(file)) return null;
      if (/^@\/app(\/|$)/.test(specifier)) return `imports the app tree ("${specifier}")`;
      return null;
    },
  },
  {
    id: 'B7-backend-uses-the-backend-logger',
    describe:
      'Backend code uses @/server/observability/logger; src/lib/logging/logger is the Phase 1-1 bootstrap logger.',
    check: (file, specifier) => {
      if (!/^(server|modules)\//.test(file)) return null;
      if (/^@\/lib\/logging\/logger$/.test(specifier)) {
        return 'imports the Phase 1-1 bootstrap logger; use "@/server/observability/logger"';
      }
      return null;
    },
  },
];

const violations = [];
const files = walk(SCAN_DIR);

for (const absolute of files) {
  const file = toPosix(relative(SCAN_DIR, absolute));
  const source = readFileSync(absolute, 'utf8');
  for (const specifier of importsOf(source)) {
    const resolvedPath = resolveRelative(absolute, specifier);
    for (const rule of RULES) {
      const message = rule.check(file, specifier, resolvedPath);
      if (message) violations.push({ rule: rule.id, file, message });
    }
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
