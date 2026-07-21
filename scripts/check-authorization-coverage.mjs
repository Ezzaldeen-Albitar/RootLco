#!/usr/bin/env node
/**
 * Authorization-coverage gate (P1-13-SEC-001).
 *
 * The control the phase plan calls for: *an unguarded operation cannot ship*.
 * `defineOperation()` already refuses a declaration with no permission codes at
 * runtime. That protects anything that is registered — this script closes the
 * other half, where a route exists and never registers at all.
 *
 * It reconciles two sources that must agree:
 *
 *   1. every `route.ts` under `src/app/api/v1/**` (the routes that actually exist)
 *   2. every `defineOperation({...})` literal in the source tree (the declarations)
 *
 * A route with no declaration, a declaration with no route, a declaration with
 * no permissions, or a `public: true` with no reason all fail the build. The
 * report lists every operation with its permission codes, so authorization
 * coverage is reviewable at a glance rather than by reading eleven route files.
 *
 * The parse is deliberately literal-only: `defineOperation` is called with an
 * object literal by convention, and a computed declaration would be exactly the
 * kind of indirection this gate exists to prevent.
 *
 * Exit codes: 0 clean · 1 coverage failure · 2 IO error.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const API_ROOT = join(SRC, 'app', 'api', 'v1');
const jsonOutput = process.argv.includes('--json');

const toPosix = (path) => path.split(sep).join('/');

function walk(dir, filter) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...walk(full, filter));
    } else if (filter(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Removes comments and string bodies-as-code hazards before scanning.
 *
 * Without this the scanner matches `defineOperation(` inside a doc comment that
 * merely *mentions* it, which is how a documentation sentence became a build
 * failure the first time this ran.
 */
function stripComments(source) {
  let out = '';
  let mode = 'code';
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];
    if (mode === 'code') {
      if (quote) {
        out += ch;
        if (ch === '\\') {
          out += next ?? '';
          index += 1;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        out += ch;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        index += 1;
        continue;
      }
      if (ch === '/' && next === '/') {
        mode = 'line';
        index += 1;
        continue;
      }
      out += ch;
      continue;
    }
    if (mode === 'block' && ch === '*' && next === '/') {
      mode = 'code';
      index += 1;
      // Preserve a newline so line-based context stays roughly aligned.
      out += ' ';
      continue;
    }
    if (mode === 'line' && ch === '\n') {
      mode = 'code';
      out += '\n';
    }
  }
  return out;
}

/** Reads a `key: 'value'` string field from an object-literal body. */
function readString(body, key) {
  const match = new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`).exec(body);
  return match ? match[1] : null;
}

/** Reads a `key: true|false` boolean field. */
function readBoolean(body, key) {
  const match = new RegExp(`\\b${key}\\s*:\\s*(true|false)`).exec(body);
  return match ? match[1] === 'true' : null;
}

/** Reads a `key: ['a', 'b']` string-array field. */
function readArray(body, key) {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(body);
  if (!match) return null;
  return [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((entry) => entry[1]);
}

/** Extracts every `defineOperation({ … })` object literal by brace matching. */
function extractDeclarations(source, file) {
  const declarations = [];
  const marker = 'defineOperation(';
  let index = source.indexOf(marker);
  while (index >= 0) {
    const braceStart = source.indexOf('{', index);
    if (braceStart < 0) break;
    let depth = 0;
    let end = braceStart;
    let inString = null;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      const prev = source[end - 1];
      if (inString) {
        if (ch === inString && prev !== '\\') inString = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') inString = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(braceStart, end + 1);
    declarations.push({
      file,
      id: readString(body, 'id'),
      module: readString(body, 'module'),
      method: readString(body, 'method'),
      path: readString(body, 'path'),
      permissions: readArray(body, 'permissions') ?? [],
      isPublic: readBoolean(body, 'public') === true,
      publicReason: readString(body, 'publicReason'),
      auditClass: readString(body, 'auditClass') ?? 'none',
      auditAction: readString(body, 'auditAction'),
    });
    index = source.indexOf(marker, end);
  }
  return declarations;
}

const sourceFiles = walk(SRC, (name) => /\.(ts|tsx)$/.test(name));
const declarations = [];
for (const file of sourceFiles) {
  const relativePath = toPosix(relative(ROOT, file));
  // The registry module defines the function; it never calls it.
  if (relativePath === 'src/server/auth/operation-registry.ts') continue;
  declarations.push(
    ...extractDeclarations(stripComments(readFileSync(file, 'utf8')), relativePath)
  );
}

/** Route files that exist under the versioned API tree. */
const routeFiles = walk(API_ROOT, (name) => name === 'route.ts').map((file) =>
  toPosix(relative(ROOT, file))
);

const failures = [];

for (const declaration of declarations) {
  const label = declaration.id ?? `(unnamed in ${declaration.file})`;
  if (!declaration.id) {
    failures.push(`${declaration.file}: defineOperation without a literal id`);
    continue;
  }
  if (!declaration.isPublic && declaration.permissions.length === 0) {
    failures.push(`${label}: declares no permission codes and is not marked public`);
  }
  if (declaration.isPublic && !declaration.publicReason) {
    failures.push(`${label}: is public but gives no publicReason`);
  }
  if (declaration.auditClass !== 'none' && !declaration.auditAction) {
    failures.push(`${label}: audit class "${declaration.auditClass}" without an auditAction`);
  }
}

// Every route file must contribute at least one declaration.
const declaredFiles = new Set(declarations.map((declaration) => declaration.file));
for (const routeFile of routeFiles) {
  if (!declaredFiles.has(routeFile)) {
    failures.push(`${routeFile}: API route with no defineOperation declaration`);
  }
}

// Every declaration that names an HTTP route must have a route file to serve it.
const routeDirs = new Set(routeFiles.map((file) => file.replace(/\/route\.ts$/, '')));
for (const declaration of declarations) {
  if (!declaration.path || !declaration.file.startsWith('src/app/')) continue;
  const expected = `src/app/api/v1${declaration.path}`;
  if (!routeDirs.has(expected)) {
    failures.push(
      `${declaration.id}: declares path ${declaration.path} but no route file at ${expected}/route.ts`
    );
  }
}

const report = declarations
  .filter((declaration) => declaration.id)
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((declaration) => ({
    id: declaration.id,
    module: declaration.module,
    route: `${declaration.method} ${declaration.path}`,
    permissions: declaration.isPublic ? ['(public)'] : declaration.permissions,
    auditClass: declaration.auditClass,
  }));

if (jsonOutput) {
  console.log(JSON.stringify({ operations: report, failures }, null, 2));
} else {
  console.log(
    `Authorization coverage: ${report.length} registered operation(s), ${routeFiles.length} API route file(s)`
  );
  for (const entry of report) {
    console.log(
      `  ${entry.id.padEnd(28)} ${String(entry.route).padEnd(24)} perms=[${entry.permissions.join(', ')}] audit=${entry.auditClass}`
    );
  }
  if (failures.length === 0) {
    console.log('OK: every operation is guarded and every route is registered');
  } else {
    console.error(`\n${failures.length} coverage failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
  }
}

process.exit(failures.length === 0 ? 0 : 1);
