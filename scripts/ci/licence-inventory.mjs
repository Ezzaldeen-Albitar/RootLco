#!/usr/bin/env node
/**
 * Licence inventory over the installed tree.
 *
 * Reads the `license` field of every installed package. Deliberately reads
 * `node_modules` rather than the lockfile: the lockfile records what SHOULD be
 * installed, and the question a licence inventory answers is what IS.
 *
 * Usage: node scripts/ci/licence-inventory.mjs [--production] [--json out.json]
 * Exit codes: 0 always (inventory is evidence; policy lives in dependency-policy.mjs). 2 on IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Normalises the many shapes npm has used for `license` over the years. */
export function normaliseLicence(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
  }
  return 'UNKNOWN';
}

export function collect(root = 'node_modules') {
  const out = [];
  if (!existsSync(root)) return out;
  const visit = (dir, scope) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue;
      const full = join(dir, entry.name);
      if (entry.name.startsWith('@') && !scope) {
        visit(full, entry.name);
        continue;
      }
      const manifest = join(full, 'package.json');
      if (!existsSync(manifest)) continue;
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (!pkg.name) continue;
        out.push({ name: pkg.name, version: pkg.version ?? null, license: normaliseLicence(pkg) });
      } catch {
        out.push({
          name: scope ? `${scope}/${entry.name}` : entry.name,
          version: null,
          license: 'UNREADABLE',
        });
      }
      // Nested node_modules (npm hoists most, but not all).
      const nested = join(full, 'node_modules');
      if (existsSync(nested)) visit(nested, null);
    }
  };
  visit(root, null);
  // Deduplicate on name@version; the same package can be installed at several depths.
  const seen = new Set();
  return out
    .filter((p) => {
      const key = `${p.name}@${p.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const packages = collect();
  const summary = {};
  for (const p of packages) summary[p.license] = (summary[p.license] ?? 0) + 1;

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(packages, null, 2)}\n`);

  console.log(`licence inventory: ${packages.length} installed packages`);
  for (const [id, count] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${id}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
