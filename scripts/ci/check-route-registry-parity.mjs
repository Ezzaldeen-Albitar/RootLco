#!/usr/bin/env node
/**
 * Route ↔ OpenAPI registry parity (CSA-14).
 *
 * `tests/openapi-contract.test.ts` regenerates the document from the operation
 * registry and compares it with the committed file. That is a strong divergence
 * gate with one blind spot, and P1-20 walked into it:
 *
 *   the registry is populated by SIDE EFFECT of importing each route module.
 *   A route with no `import '@/app/api/v1/.../route';` line in that test file is
 *   absent from the generated document AND absent from the committed document,
 *   so the two agree perfectly and the test passes over an incomplete contract.
 *
 * Regenerating and diffing cannot see this: both sides are equally wrong. The
 * only fix is to compare the import list against the FILESYSTEM, which is what
 * this does.
 *
 * Usage: node scripts/ci/check-route-registry-parity.mjs [--json out.json]
 * Exit codes: 0 parity · 1 drift · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const API_ROOT = join('src', 'app', 'api');
export const ROUTE_ROOT = join('src', 'app', 'api', 'v1');
export const CONTRACT_TEST = join('tests', 'openapi-contract.test.ts');

/**
 * Routes outside `/api/v1`, which `scripts/check-openapi.mjs` forbids from the
 * document ("no path escapes /api/v1"). Each entry states why it is allowed to
 * exist unversioned. Anything NOT on this list is a finding: an unversioned
 * business endpoint would be invisible to the contract by construction.
 */
export const UNVERSIONED_ALLOWED = {
  '@/app/api/health/route':
    'infrastructure liveness probe. Referenced by the Dockerfile HEALTHCHECK and the compose healthcheck, ' +
    'both of which predate /api/v1 and must keep a stable unversioned path. Carries no business data. ' +
    'The versioned probes /api/v1/health/live and /api/v1/health/ready are in the contract.',
};

/** Every route module on disk, as an `@/`-prefixed import specifier. */
export function discoverRoutes(root = ROUTE_ROOT) {
  const found = [];
  if (!existsSync(root)) return found;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'route.ts' && entry.name !== 'route.tsx') continue;
      const rel = relative('src', full)
        .replace(/\\/g, '/')
        .replace(/\.tsx?$/, '');
      found.push(`@/${rel}`);
    }
  };
  walk(root);
  return found.sort();
}

/** Every side-effect import of a route module in the contract test. */
export function discoverImports(source) {
  const out = [];
  const pattern = /^\s*import\s+['"](@\/app\/api\/[^'"]+)['"]\s*;?\s*$/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) out.push(match[1]);
  return out.sort();
}

export function compare(routes, imports, unversioned = []) {
  const importSet = new Set(imports);
  const routeSet = new Set(routes);
  return {
    missingImports: routes.filter((r) => !importSet.has(r)),
    // An import of a v1 route that no longer exists. Imports of allowed
    // unversioned routes are not stale — they are simply out of scope.
    staleImports: imports.filter((i) => !routeSet.has(i) && !(i in UNVERSIONED_ALLOWED)),
    unexpectedUnversioned: unversioned.filter((r) => !(r in UNVERSIONED_ALLOWED)),
    routeCount: routes.length,
    importCount: imports.length,
    unversionedCount: unversioned.length,
  };
}

export function toMarkdown(result) {
  const lines = ['### Route ↔ OpenAPI registry parity', ''];
  lines.push(
    `\`/api/v1\` route modules on disk: **${result.routeCount}** · registry imports: **${result.importCount}** · ` +
      `unversioned routes: **${result.unversionedCount}** (allowed: ${Object.keys(UNVERSIONED_ALLOWED).length})`
  );
  lines.push('');
  if (
    !result.missingImports.length &&
    !result.staleImports.length &&
    !result.unexpectedUnversioned.length
  ) {
    lines.push(
      'Every versioned route module is registered. The generated contract covers the whole surface.'
    );
    return lines.join('\n');
  }
  if (result.unexpectedUnversioned.length) {
    lines.push(
      '**Unversioned route modules with no recorded justification** — `/api/v1` is the only path the contract ' +
        'admits, so these endpoints can never appear in it:'
    );
    lines.push('');
    for (const r of result.unexpectedUnversioned) lines.push(`- \`${r}\``);
    lines.push('');
  }
  if (result.missingImports.length) {
    lines.push(
      '**Route modules absent from the registry** — these endpoints exist and are undocumented:'
    );
    lines.push('');
    for (const r of result.missingImports) lines.push(`- \`${r}\``);
    lines.push('');
  }
  if (result.staleImports.length) {
    lines.push('**Registry imports with no route module** — these resolve to nothing:');
    lines.push('');
    for (const i of result.staleImports) lines.push(`- \`${i}\``);
    lines.push('');
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  if (!existsSync(CONTRACT_TEST)) {
    console.error(`contract test not found at ${CONTRACT_TEST}`);
    process.exit(2);
  }
  const routes = discoverRoutes();
  if (routes.length === 0) {
    console.error(
      `no route modules found under ${ROUTE_ROOT} — refusing to report parity over an empty set`
    );
    process.exit(2);
  }
  const versioned = new Set(routes);
  const unversioned = discoverRoutes(API_ROOT).filter((r) => !versioned.has(r));
  const imports = discoverImports(readFileSync(CONTRACT_TEST, 'utf8'));
  const result = compare(routes, imports, unversioned);

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(result)}\n`);

  console.log(toMarkdown(result));
  for (const route of result.missingImports) {
    console.log(
      `::error file=${CONTRACT_TEST}::${route} has no side-effect import, so it is absent from the generated contract AND from the committed one — the divergence test passes over a hole.`
    );
  }
  for (const stale of result.staleImports) {
    console.log(
      `::error file=${CONTRACT_TEST}::${stale} is imported but no such route module exists.`
    );
  }
  for (const route of result.unexpectedUnversioned) {
    console.log(
      `::error::${route} sits outside /api/v1, which the contract forbids. Move it under /api/v1, or record the ` +
        'justification in UNVERSIONED_ALLOWED in scripts/ci/check-route-registry-parity.mjs.'
    );
  }
  const failed =
    result.missingImports.length + result.staleImports.length + result.unexpectedUnversioned.length;
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
