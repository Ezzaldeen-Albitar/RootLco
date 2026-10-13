#!/usr/bin/env node
/**
 * Environment contract for the production build (initiative §13).
 *
 * "The production build must not rely on undocumented developer-local
 * environment variables." `.env.example` is the documented contract, so the
 * check is a set comparison in both directions:
 *
 *   read by the source, absent from .env.example  → an undocumented dependency;
 *                                                   a fresh clone cannot build.
 *   in .env.example, read by nothing              → a stale entry that invites
 *                                                   someone to configure a value
 *                                                   that has no effect.
 *
 * Only the second direction is a warning. A name can legitimately be documented
 * ahead of the code that will read it; the reverse is never legitimate.
 *
 * ## Two ways a name is "read"
 *
 * A literal `process.env.NAME` is the obvious one. The larger one is invisible
 * to it: `apps/api/src/server/config/backend-config.ts` hands the WHOLE of
 * `process.env` to a zod object and reads roughly fifty names by schema key, so
 * not one of them appears as a literal anywhere. Scanning only for literals
 * therefore reported "pass" over a contract missing most of the backend's
 * configuration surface. Both sources of truth are read here.
 *
 * ## Two contract files
 *
 * The root `.env.example` documents the compose-level file; `apps/api/.env.example`
 * documents the API tier's own. A name documented in EITHER is documented.
 *
 * Usage: node scripts/ci/check-env-contract.mjs [--json out.json]
 * Exit codes: 0 pass · 1 undocumented variable · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_SRC_ROOT, fromRoot, toRepositoryPath } from '../lib/repository-paths.mjs';

export const SOURCE_ROOT = API_SRC_ROOT;
export const CONTRACT = fromRoot('.env.example');
/** The API tier's own template. Equally authoritative for a server-only name. */
export const API_CONTRACT = fromRoot('apps', 'api', '.env.example');
/** The zod schema whose keys ARE environment reads. */
export const BACKEND_CONFIG = join(API_SRC_ROOT, 'server', 'config', 'backend-config.ts');

/** Names that Next.js or Node provide, so they need no entry in the contract. */
export const PROVIDED_BY_RUNTIME = new Set([
  'NODE_ENV',
  'PORT',
  'HOSTNAME',
  'NEXT_RUNTIME',
  'NEXT_TELEMETRY_DISABLED',
  'VERCEL_URL',
  'CI',
]);

export function readEnvNames(source) {
  const names = new Set();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) names.add(match[1]);
  }
  return names;
}

export function scanSource(root = SOURCE_ROOT) {
  const usage = new Map();
  if (!existsSync(root)) return usage;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) continue;
      for (const name of readEnvNames(readFileSync(full, 'utf8'))) {
        if (!usage.has(name)) usage.set(name, []);
        usage.get(name).push(toRepositoryPath(full));
      }
    }
  };
  walk(root);
  return usage;
}

/**
 * The environment names a zod object declares as keys.
 *
 * **This is a regex over source text, not a parse, and that is a deliberate
 * limit rather than an oversight.** Importing the module would mean running
 * TypeScript from a dependency-free CI script; parsing it properly would mean a
 * TypeScript compiler here for one list of identifiers. So the shape it matches
 * is narrow and stated: a line that is INDENTED (a property, never a top-level
 * declaration), whose key is SCREAMING_SNAKE (an environment name is never
 * camelCase), immediately followed by `z.` — the schema's own spelling for
 * every one of its entries.
 *
 * What it therefore cannot see, and what a future entry must not rely on it
 * seeing: a key built by `z.object({ ...spread })`, a key whose value is a
 * helper call that does not begin `z.` on the same line, or a computed key.
 * `bounded(...)` entries are the one such helper in use today, so they are
 * matched by the second pattern below and a third helper would need a third —
 * which is why the test asserts a COUNT as well as membership: a helper this
 * cannot see shrinks the extracted set silently.
 */
export function readSchemaKeys(source) {
  const names = new Set();
  const patterns = [
    // `  DATABASE_URL: z.string()...`, and the wrapped form the formatter
    // produces for a long entry: `  WORKER_ID: z\n    .string()`.
    /^[ \t]+([A-Z][A-Z0-9_]*):\s*z\b/gm,
    // `  DB_POOL_MAX: bounded(1, 50, 10),` — the local range helper.
    /^[ \t]+([A-Z][A-Z0-9_]*):\s*bounded\(/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) names.add(match[1]);
  }
  return names;
}

export function documentedNames(contract) {
  const names = new Set();
  for (const line of contract.split(/\r?\n/)) {
    // Commented-out entries still document the name — that is how an optional
    // value is expressed in this file.
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

export function evaluate(usage, documented) {
  const undocumented = [];
  for (const [name, files] of usage) {
    if (PROVIDED_BY_RUNTIME.has(name)) continue;
    if (documented.has(name)) continue;
    undocumented.push({ name, files: [...new Set(files)] });
  }
  const unused = [...documented].filter(
    (name) => !usage.has(name) && !PROVIDED_BY_RUNTIME.has(name)
  );
  return {
    ok: undocumented.length === 0,
    read: usage.size,
    documented: documented.size,
    undocumented: undocumented.sort((a, b) => a.name.localeCompare(b.name)),
    unused: unused.sort(),
  };
}

/**
 * Adds the schema-declared names to a usage map, citing the schema file.
 *
 * Kept separate from `scanSource` so the literal scan stays exactly what it was
 * and the two sources of truth remain individually inspectable from a test.
 */
export function addSchemaUsage(usage, schemaFile = BACKEND_CONFIG) {
  if (!existsSync(schemaFile)) return usage;
  const citation = toRepositoryPath(schemaFile);
  for (const name of readSchemaKeys(readFileSync(schemaFile, 'utf8'))) {
    if (!usage.has(name)) usage.set(name, []);
    usage.get(name).push(citation);
  }
  return usage;
}

/** The union of every tracked template's documented names. */
export function allDocumentedNames(files = [CONTRACT, API_CONTRACT]) {
  const names = new Set();
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const name of documentedNames(readFileSync(file, 'utf8'))) names.add(name);
  }
  return names;
}

export function toMarkdown(result) {
  const lines = ['### Environment contract', ''];
  lines.push(
    `Names read by \`src/\` (literals and schema keys): **${result.read}** · documented in \`.env.example\` or \`apps/api/.env.example\`: **${result.documented}**`
  );
  lines.push('');
  if (result.undocumented.length) {
    lines.push('**Undocumented — a fresh clone cannot reproduce this build:**');
    lines.push('');
    for (const entry of result.undocumented) {
      lines.push(`- \`${entry.name}\` — read by ${entry.files.map((f) => `\`${f}\``).join(', ')}`);
    }
    lines.push('');
  }
  if (result.unused.length) {
    lines.push(
      `> ⚠️ Documented but read by nothing: ${result.unused.map((n) => `\`${n}\``).join(', ')}`
    );
    lines.push('');
  }
  if (result.ok) lines.push('**Environment contract: pass**');
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  if (!existsSync(CONTRACT)) {
    console.error(
      `${CONTRACT} not found — there is no documented environment contract to check against.`
    );
    process.exit(2);
  }
  const usage = addSchemaUsage(scanSource());
  if (usage.size === 0) {
    console.error(
      'no environment variable reads found under src/ — refusing to report "clean" over an empty set'
    );
    process.exit(2);
  }
  const result = evaluate(usage, allDocumentedNames());

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(result)}\n`);

  console.log(toMarkdown(result));
  for (const entry of result.undocumented) {
    console.log(
      `::error file=${entry.files[0]}::${entry.name} is read by the source but absent from both ${CONTRACT} and ${API_CONTRACT}`
    );
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
