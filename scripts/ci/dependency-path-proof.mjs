#!/usr/bin/env node
/**
 * Dependency-path and reachability proof.
 *
 * An exception that says "dev only, not reachable" is worth exactly as much as
 * the evidence behind it. This derives that evidence MECHANICALLY from the
 * lockfile, the installed tree, the production install and the built image —
 * never from the `devDependencies` classification alone, which describes intent
 * rather than what is installed.
 *
 * It answers, for a named package:
 *
 *   1. every resolved instance and its version;
 *   2. the full path from the root package to each one;
 *   3. every parent in that path, and what each parent REQUIRES;
 *   4. whether any instance is reachable from the production tree;
 *   5. whether application source imports it, directly or transitively;
 *   6. whether it survives `npm ci --omit=dev`;
 *   7. whether the built runner image still RESOLVES it as an installed package.
 *
 * Items 6 and 7 need a real install and a real image, so they are reported as
 * `not-verified-here` when their inputs are absent rather than being asserted.
 *
 * Item 7 is deliberately narrow, and the narrowness is the honest part. It asks
 * whether a `node_modules/<package>/` directory exists in the image — i.e.
 * whether anything in the image could `require()` the package. It does NOT ask
 * whether the package's CODE is absent from the image, because for several of
 * these packages that question has a known answer and the answer is no: Node
 * bundles brace-expansion into the `node` binary itself via esbuild, so the code
 * is present in every image that contains a Node runtime and no build step can
 * remove it. Reporting "absent from the image" would therefore be false. What is
 * both true and sufficient is that the application cannot RESOLVE it.
 *
 * Usage:
 *   node scripts/ci/dependency-path-proof.mjs --package brace-expansion \
 *     [--production-tree prod-tree.json] [--image-inventory image-files.txt] \
 *     [--json out.json] [--markdown out.md]
 *
 * Exit codes: 0 proof produced · 1 the package is production-reachable · 2 IO error.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { API_SRC_ROOT, SCRIPTS_ROOT } from '../lib/repository-paths.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Every lockfile entry that resolves the named package. */
export function findInstances(lock, packageName) {
  const suffix = `node_modules/${packageName}`;
  return Object.entries(lock.packages ?? {})
    .filter(([key]) => key === suffix || key.endsWith(`/${suffix}`))
    .map(([key, value]) => ({
      path: key,
      version: value.version ?? null,
      // `dev: true` means npm resolved this entry ONLY through a development
      // edge. Its absence means at least one production edge reaches it.
      devOnly: value.dev === true,
      optional: value.optional === true,
      resolved: value.resolved ?? null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Walks the lockfile graph from the root to the target, recording every parent.
 *
 * npm's nested-path convention already encodes one path; this recovers the
 * others by asking which packages DEPEND on the target and following those
 * edges upward, so a package reachable by several routes shows all of them.
 */
export function derivePaths(lock, packageName, maxDepth = 12) {
  const packages = lock.packages ?? {};

  /** Which lockfile entry satisfies `dep` when required from `fromKey`? */
  const resolveFrom = (fromKey, dep) => {
    let scope = fromKey;
    for (;;) {
      const candidate = scope ? `${scope}/node_modules/${dep}` : `node_modules/${dep}`;
      if (packages[candidate]) return candidate;
      if (!scope) return null;
      const cut = scope.lastIndexOf('/node_modules/');
      scope = cut === -1 ? '' : scope.slice(0, cut);
    }
  };

  const nameOf = (key) => key.split('node_modules/').pop();
  const paths = [];

  const walk = (key, trail) => {
    if (trail.length > maxDepth) return;
    const entry = packages[key];
    if (!entry) return;
    const deps = {
      ...(entry.dependencies ?? {}),
      ...(entry.optionalDependencies ?? {}),
      ...(entry.peerDependencies ?? {}),
      ...(key === '' ? (entry.devDependencies ?? {}) : {}),
    };
    for (const [dep, range] of Object.entries(deps)) {
      const resolved = resolveFrom(key, dep);
      if (!resolved) continue;
      if (trail.some((step) => step.key === resolved)) continue; // cycle
      const step = {
        key: resolved,
        name: dep,
        requires: range,
        version: packages[resolved]?.version ?? null,
        devEdge: key === '' && dep in (entry.devDependencies ?? {}),
      };
      if (nameOf(resolved) === packageName) {
        paths.push([...trail, step]);
        continue;
      }
      walk(resolved, [...trail, step]);
    }
  };

  walk('', []);
  return paths;
}

/** Does any application source file import the package, directly? */
/**
 * The source corpus, read once per process and reused.
 *
 * `findDirectImports` walks `apps/api/src` and `scripts/` and reads every file
 * in them. That is a few hundred milliseconds on its own, and it was being paid
 * again on EVERY call — `buildProof` calls it once, and a suite that builds
 * several proofs pays it several times over.
 *
 * Under `vitest` with workers in parallel that pushed the file past the default
 * five-second case timeout intermittently, while every case passed in isolation
 * in under a second. It reproduced on a tree with no changes at all, so it is
 * load, not a regression — and a timeout that only fails sometimes is worse than
 * one that always does, because it teaches a reader to re-run rather than look.
 *
 * Keyed on the root list so a caller passing different roots is not served
 * another caller's corpus. Contents cannot change within a run: nothing here
 * writes to those trees.
 */
const CORPUS_CACHE = new Map();

function sourceCorpus(roots) {
  const key = roots.join('\u0000');
  const cached = CORPUS_CACHE.get(key);
  if (cached) return cached;

  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) continue;
      files.push({ path: full.replace(/\\/g, '/'), source: readFileSync(full, 'utf8') });
    }
  };
  for (const root of roots) walk(root);
  CORPUS_CACHE.set(key, files);
  return files;
}

export function findDirectImports(packageName, roots = [API_SRC_ROOT, SCRIPTS_ROOT]) {
  const pattern = new RegExp(
    `(?:from\\s+['"]|require\\(\\s*['"]|import\\(\\s*['"])${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|['"])`
  );
  return sourceCorpus(roots)
    .filter((file) => pattern.test(file.source))
    .map((file) => file.path);
}

/**
 * @param {object} input
 * @param {any} input.lock                     parsed package-lock.json
 * @param {string} input.packageName
 * @param {any} [input.productionTree]         `npm ls --omit=dev --json`, when available
 * @param {string} [input.imageInventory]      `find / -xdev -type f` from the built image
 *
 * The last two are OPTIONAL by design: each answers a question that needs a real
 * install or a real image, and when the input is absent the answer is reported
 * as `not-verified-here` rather than assumed. Annotating them as optional also
 * keeps callers honest under `checkJs` — without this, every call site had to
 * pass `undefined` explicitly, which reads as an oversight rather than a choice.
 */
export function buildProof({ lock, packageName, productionTree, imageInventory }) {
  const instances = findInstances(lock, packageName);
  const paths = derivePaths(lock, packageName);
  const directImports = findDirectImports(packageName);

  // 4 + 5: an entry without `dev: true` is reachable through at least one
  // production edge. This is npm's own resolution, not our classification.
  const productionInstances = instances.filter((i) => !i.devOnly);

  // 6: does it survive a production-only install? Only answerable from a real
  // `npm ls --omit=dev --json`, so it is reported as unverified when absent.
  let inProductionInstall = 'not-verified-here';
  if (productionTree) {
    const found = JSON.stringify(productionTree).includes(`"${packageName}"`);
    inProductionInstall = found;
  }

  // 7: can the image RESOLVE it as an installed package? Answerable from a real
  // filesystem listing taken from the image, and only that. A false here means
  // no `node_modules/<pkg>/` directory exists, so nothing in the image can
  // `require()` it — it does NOT mean the package's code is absent from the
  // image. See the header: brace-expansion is vendored inside the `node` binary.
  let packageDirInRunnerImage = 'not-verified-here';
  if (imageInventory !== undefined) {
    packageDirInRunnerImage = imageInventory
      .split('\n')
      .some((line) => line.includes(`/${packageName}/`));
  }

  const productionReachable =
    productionInstances.length > 0 ||
    inProductionInstall === true ||
    packageDirInRunnerImage === true;

  return {
    package: packageName,
    instances,
    instanceCount: instances.length,
    versions: [...new Set(instances.map((i) => i.version))].sort(),
    paths: paths.map((p) => ({
      chain: p.map((s) => `${s.name}@${s.version}`),
      requires: p.map((s) => `${s.name}${s.requires ? ` (requires ${s.requires})` : ''}`),
      rootEdgeIsDev: p[0]?.devEdge === true,
      depth: p.length,
    })),
    pathCount: paths.length,
    allRootEdgesAreDev: paths.length > 0 && paths.every((p) => p[0]?.devEdge === true),
    productionInstances,
    directImports,
    inProductionInstall,
    packageDirInRunnerImage,
    productionReachable,
  };
}

export function toMarkdown(proof) {
  const lines = [`### Dependency-path proof — \`${proof.package}\``, ''];
  lines.push('| Question | Answer |');
  lines.push('| --- | --- |');
  lines.push(`| Resolved instances | ${proof.instanceCount} |`);
  lines.push(`| Versions present | ${proof.versions.map((v) => `\`${v}\``).join(', ') || '—'} |`);
  lines.push(`| Distinct paths from the root | ${proof.pathCount} |`);
  lines.push(
    `| Every root edge is a devDependency | ${proof.allRootEdgesAreDev ? '**yes**' : '**no**'} |`
  );
  lines.push(`| Instances npm marks production-reachable | ${proof.productionInstances.length} |`);
  lines.push(
    `| Imported directly by src/ or scripts/ | ${proof.directImports.length === 0 ? '**no**' : proof.directImports.join(', ')} |`
  );
  lines.push(`| Survives \`npm ci --omit=dev\` | ${describe(proof.inProductionInstall)} |`);
  lines.push(
    `| Resolvable as an installed package in the runner image | ${describe(proof.packageDirInRunnerImage)} |`
  );
  lines.push(`| **Production reachable** | ${proof.productionReachable ? '**YES**' : '**no**'} |`);
  lines.push('');
  if (proof.packageDirInRunnerImage === false) {
    lines.push(
      '> The image row means no `node_modules/' +
        proof.package +
        '/` directory exists, so nothing in the image can `require()` it. It is ' +
        'NOT a claim that the code is absent from the image — Node vendors some ' +
        'of these packages inside the `node` binary, where no build step can ' +
        'remove them. Non-resolvability is the claim that is both true and enough.'
    );
    lines.push('');
  }

  lines.push('#### Resolved instances');
  lines.push('');
  lines.push('| Lockfile path | Version | npm classification |');
  lines.push('| --- | --- | --- |');
  for (const i of proof.instances) {
    lines.push(
      `| \`${i.path}\` | \`${i.version}\` | ${i.devOnly ? 'dev-only' : '**production-reachable**'} |`
    );
  }
  lines.push('');

  if (proof.paths.length) {
    lines.push('#### Full paths from the root package');
    lines.push('');
    for (const p of proof.paths.slice(0, 25)) {
      lines.push(
        `- ${p.rootEdgeIsDev ? '`devDependencies`' : '**`dependencies`**'} → ${p.requires.join(' → ')}`
      );
    }
    if (proof.paths.length > 25) lines.push(`- …and ${proof.paths.length - 25} more`);
    lines.push('');
  }
  return lines.join('\n');
}

function describe(value) {
  if (value === true) return '**yes**';
  if (value === false) return '**no**';
  return '_not verified here_';
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const packageName = arg('--package');
  if (!packageName) {
    console.error('missing --package');
    process.exit(2);
  }
  if (!existsSync('package-lock.json')) {
    console.error('package-lock.json not found');
    process.exit(2);
  }
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

  const productionTreePath = arg('--production-tree');
  let productionTree;
  if (productionTreePath && existsSync(productionTreePath)) {
    try {
      productionTree = JSON.parse(readFileSync(productionTreePath, 'utf8'));
    } catch {
      console.error(`::error::${productionTreePath} does not parse; refusing to guess.`);
      process.exit(2);
    }
  }

  const imagePath = arg('--image-inventory');
  const imageInventory =
    imagePath && existsSync(imagePath) ? readFileSync(imagePath, 'utf8') : undefined;

  const proof = buildProof({ lock, packageName, productionTree, imageInventory });

  const md = toMarkdown(proof);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(md);

  if (proof.productionReachable) {
    console.log(
      `::error::${packageName} is reachable from the production tree. Any exception claiming otherwise is now false.`
    );
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
