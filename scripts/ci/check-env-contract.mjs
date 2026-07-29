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
 * Usage: node scripts/ci/check-env-contract.mjs [--json out.json]
 * Exit codes: 0 pass · 1 undocumented variable · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_ROOT = 'src';
export const CONTRACT = '.env.example';

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
        usage.get(name).push(relative(process.cwd(), full).replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return usage;
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

export function toMarkdown(result) {
  const lines = ['### Environment contract', ''];
  lines.push(
    `Names read by \`src/\`: **${result.read}** · documented in \`.env.example\`: **${result.documented}**`
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
  const usage = scanSource();
  if (usage.size === 0) {
    console.error(
      'no environment variable reads found under src/ — refusing to report "clean" over an empty set'
    );
    process.exit(2);
  }
  const result = evaluate(usage, documentedNames(readFileSync(CONTRACT, 'utf8')));

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(result)}\n`);

  console.log(toMarkdown(result));
  for (const entry of result.undocumented) {
    console.log(
      `::error file=${entry.files[0]}::${entry.name} is read by the source but absent from ${CONTRACT}`
    );
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
