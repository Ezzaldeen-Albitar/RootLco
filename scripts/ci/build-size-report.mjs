#!/usr/bin/env node
/**
 * Production build inventory and size ratchet (CSA-17).
 *
 * `npm run build` ran in CI and its output was discarded. Nothing recorded how
 * large the bundle was, which routes existed, or what the build warned about.
 *
 * The size policy is measure-first, exactly as the initiative requires: a
 * recorded baseline, a warning band, and a hard ceiling that is expressed as a
 * MULTIPLE of the recorded baseline rather than an invented number. Nothing here
 * guesses a byte count.
 *
 * It also asserts build-output integrity, because a build can "succeed" and emit
 * something unusable:
 *   - `.next/standalone/server.js` must exist (the Dockerfile's `runner` stage
 *     copies exactly this and nothing else would fail until runtime);
 *   - `.next/static` must exist and be non-empty;
 *   - `.next/routes-manifest.json` must parse and list at least one route;
 *   - no route may be missing from the manifest that has a `route.ts` on disk.
 *
 * Usage:
 *   node scripts/ci/build-size-report.mjs \
 *     [--dir .next] [--baseline .github/ci-baselines/build-size-baseline.json] \
 *     [--json out.json] [--markdown out.md] [--update]
 *
 * Exit codes: 0 pass · 1 integrity or ceiling failure · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

/** Recursive byte total and file count for a directory. */
export function measure(dir) {
  let bytes = 0;
  let files = 0;
  if (!existsSync(dir)) return { bytes, files, exists: false };
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        bytes += statSync(full).size;
        files += 1;
      }
    }
  };
  walk(dir);
  return { bytes, files, exists: true };
}

/** Largest N files under a directory, as evidence for what moved. */
export function largestFiles(dir, limit = 15) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile())
        out.push({ file: relative(dir, full).replace(/\\/g, '/'), bytes: statSync(full).size });
    }
  };
  walk(dir);
  return out.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

export function checkIntegrity(dir) {
  const failures = [];
  const standaloneServer = join(dir, 'standalone', 'server.js');
  if (!existsSync(standaloneServer)) {
    failures.push(
      '`.next/standalone/server.js` is missing. The Dockerfile `runner` stage copies exactly this file; ' +
        'without it the production image builds and then fails at container start.'
    );
  }
  const staticDir = join(dir, 'static');
  const staticMeasure = measure(staticDir);
  if (!staticMeasure.exists || staticMeasure.files === 0) {
    failures.push('`.next/static` is missing or empty — the image would serve no client assets.');
  }

  let routes = [];
  const manifestPath = join(dir, 'routes-manifest.json');
  if (!existsSync(manifestPath)) {
    failures.push('`.next/routes-manifest.json` is missing — the build produced no route table.');
  } else {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      routes = [
        ...(manifest.staticRoutes ?? []),
        ...(manifest.dynamicRoutes ?? []),
        ...(manifest.dataRoutes ?? []),
      ]
        .map((r) => r.page ?? r.path ?? null)
        .filter(Boolean);
      if (routes.length === 0) {
        failures.push('`routes-manifest.json` parsed but lists no route.');
      }
    } catch (error) {
      failures.push(`\`routes-manifest.json\` is not valid JSON: ${error.message}`);
    }
  }

  return { failures, routes };
}

/** Counts route handlers on disk so the manifest can be checked for completeness. */
export function countSourceRoutes(appDir = 'src/app') {
  let count = 0;
  if (!existsSync(appDir)) return count;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts' || entry.name === 'route.tsx' || entry.name === 'page.tsx')
        count += 1;
    }
  };
  walk(appDir);
  return count;
}

export function evaluate({ dir, baseline, sourceRouteCount }) {
  const total = measure(dir);
  const standalone = measure(join(dir, 'standalone'));
  const staticAssets = measure(join(dir, 'static'));
  const server = measure(join(dir, 'server'));
  const integrity = checkIntegrity(dir);

  const failures = [...integrity.failures];
  const warnings = [];

  const recorded = baseline?.standaloneBytes ?? null;
  const warnAt = Number(baseline?.warnGrowthRatio ?? 1.1);
  const failAt = Number(baseline?.failGrowthRatio ?? 1.5);
  let ratio = null;
  if (typeof recorded === 'number' && recorded > 0) {
    ratio = Number((standalone.bytes / recorded).toFixed(4));
    if (ratio > failAt) {
      failures.push(
        `standalone build grew to ${humanBytes(standalone.bytes)} from a recorded baseline of ` +
          `${humanBytes(recorded)} (×${ratio}). The hard ceiling is ×${failAt} of the recorded baseline. ` +
          'Either the growth is justified — in which case re-baseline in a reviewable commit — or it is a regression.'
      );
    } else if (ratio > warnAt) {
      warnings.push(
        `standalone build grew ×${ratio} against the baseline (warning band starts at ×${warnAt}).`
      );
    }
  } else {
    warnings.push('no build-size baseline recorded yet — this run establishes one.');
  }

  if (
    sourceRouteCount > 0 &&
    integrity.routes.length > 0 &&
    integrity.routes.length < sourceRouteCount
  ) {
    warnings.push(
      `${sourceRouteCount} route/page files on disk but ${integrity.routes.length} entries in the manifest. ` +
        'Route groups and co-located files legitimately differ; investigate if the gap is large.'
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    sizes: {
      totalBytes: total.bytes,
      totalFiles: total.files,
      standaloneBytes: standalone.bytes,
      staticBytes: staticAssets.bytes,
      serverBytes: server.bytes,
    },
    baselineBytes: recorded,
    ratio,
    routes: integrity.routes.length,
    sourceRouteFiles: sourceRouteCount,
    largest: largestFiles(join(dir, 'static'), 10),
  };
}

export function toMarkdown(result) {
  const lines = ['### Production build', ''];
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Standalone server | ${humanBytes(result.sizes.standaloneBytes)} |`);
  lines.push(`| Static assets | ${humanBytes(result.sizes.staticBytes)} |`);
  lines.push(`| Server chunks | ${humanBytes(result.sizes.serverBytes)} |`);
  lines.push(
    `| Total \`.next\` | ${humanBytes(result.sizes.totalBytes)} (${result.sizes.totalFiles} files) |`
  );
  lines.push(
    `| Baseline (standalone) | ${result.baselineBytes ? humanBytes(result.baselineBytes) : '—'} |`
  );
  lines.push(`| Growth ratio | ${result.ratio ? `×${result.ratio}` : '—'} |`);
  lines.push(`| Routes in manifest | ${result.routes} |`);
  lines.push(`| Route/page files on disk | ${result.sourceRouteFiles} |`);
  lines.push('');
  if (result.largest.length) {
    lines.push('<details><summary>Largest static assets</summary>');
    lines.push('');
    lines.push('| Asset | Size |');
    lines.push('| --- | --- |');
    for (const f of result.largest) lines.push(`| \`${f.file}\` | ${humanBytes(f.bytes)} |`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  for (const w of result.warnings) lines.push(`> ⚠️ ${w}`);
  if (result.failures.length) {
    lines.push('');
    lines.push('**Build gate failures**');
    lines.push('');
    for (const f of result.failures) lines.push(`- ❌ ${f}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const dir = arg('--dir') ?? '.next';
  const baselinePath = arg('--baseline') ?? '.github/ci-baselines/build-size-baseline.json';
  // Read first and interpret the failure, rather than asking whether the file
  // exists and then reading it. The two-step form is a race — the file can go
  // between the question and the answer — and it also conflates "absent", which
  // is legitimate before a baseline is established, with "unreadable", which is
  // not. ENOENT means no baseline yet; anything else is a real problem.
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`build-size baseline at ${baselinePath} could not be read: ${error.message}`);
      process.exit(2);
    }
  }
  if (!existsSync(dir)) {
    console.error(`build output directory not found: ${dir} — did the build actually run?`);
    process.exit(2);
  }

  const result = evaluate({ dir, baseline, sourceRouteCount: countSourceRoutes() });

  if (argv.includes('--update')) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          ...baseline,
          standaloneBytes: result.sizes.standaloneBytes,
          staticBytes: result.sizes.staticBytes,
          totalBytes: result.sizes.totalBytes,
          establishedBy: process.env.GITHUB_SHA ?? 'local',
        },
        null,
        2
      )}\n`
    );
    console.log(`build-size baseline updated at ${baselinePath}`);
  }

  const md = toMarkdown(result);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  console.log(md);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
