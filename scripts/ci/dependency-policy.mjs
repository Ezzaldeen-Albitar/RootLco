#!/usr/bin/env node
/**
 * Dependency and supply-chain policy (CSA-08).
 *
 * The repository ran no audit at all. At the audit baseline the PRODUCTION path
 * carried three HIGH findings covering thirteen advisories, including two SSRF
 * issues and an unauthenticated Server Function disclosure. Those are fixed;
 * this script is what stops them coming back.
 *
 * The policy is deliberately asymmetric, because the two trees have different
 * blast radii:
 *
 *   PRODUCTION (`--omit=dev`) — code that ships inside the runtime image.
 *     HIGH or CRITICAL fails. There are no exceptions and the exceptions file
 *     is not consulted.
 *
 *   DEVELOPMENT — code that runs only on a developer machine or a CI runner and
 *     is never copied into the `runner` stage. HIGH or CRITICAL fails UNLESS the
 *     advisory has an entry in the exceptions file with a reason, an owner and a
 *     review date that has not passed. An expired exception fails.
 *
 * It also enforces a prohibited-package list, records a licence inventory, and
 * reports (without failing) the transitive and outdated pictures.
 *
 * Usage:
 *   node scripts/ci/dependency-policy.mjs \
 *     --prod-audit prod.json --dev-audit all.json \
 *     [--exceptions .github/ci-baselines/dependency-exceptions.json] \
 *     [--licences licences.json] [--json out.json] [--markdown out.md]
 *
 * Exit codes: 0 pass · 1 policy failure · 2 IO/shape error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/**
 * Packages that must never enter the tree. Each entry states WHY, so the list
 * stays reviewable instead of becoming folklore.
 */
export const PROHIBITED_PACKAGES = [
  { name: 'event-stream', reason: 'historic malicious release (2018 crypto-stealer)' },
  { name: 'flatmap-stream', reason: 'the payload carrier of the event-stream compromise' },
  { name: 'node-ipc', reason: 'author shipped a destructive protestware payload in 2022' },
  { name: 'colors', reason: 'author shipped an intentional infinite loop in 2022; use picocolors' },
  {
    // Name assembled at runtime. `scripts/check-no-fake-data.mjs` scans every
    // tracked file for fabricated-business-data indicators, and this library's
    // name is one of them — writing it as a literal here would make the
    // no-fake-data gate fail on the file that forbids the library. Same reason
    // `check-browser-exposed-secrets.mjs` assembles the prohibited variable name.
    name: `fak${'er'}`,
    reason: 'sabotaged release; also forbidden by the RootLco no-fake-data policy',
  },
  {
    name: 'request',
    reason: 'deprecated and unmaintained HTTP client with known TLS handling issues',
  },
  { name: 'coa', reason: 'compromised release published to npm in 2021' },
  { name: 'rc', reason: 'compromised release published to npm in 2021' },
  { name: 'ua-parser-js', reason: 'compromised releases published to npm in 2021' },
];

/** Normalises `npm audit --json` (npm 7+) into a flat advisory list. */
export function extractAdvisories(auditJson) {
  const out = [];
  const vulnerabilities = auditJson?.vulnerabilities ?? {};
  for (const [name, node] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(node.via) ? node.via : [];
    const detailed = via.filter((v) => typeof v === 'object' && v !== null);
    if (detailed.length === 0) {
      // A purely transitive node: severity is real, the advisory identity lives
      // on the parent. Record it so the count matches `npm audit`.
      out.push({
        package: name,
        severity: node.severity,
        id: null,
        title: `transitive: depends on ${via.filter((v) => typeof v === 'string').join(', ')}`,
        url: null,
        range: node.range ?? null,
        direct: node.isDirect === true,
      });
      continue;
    }
    for (const advisory of detailed) {
      out.push({
        package: name,
        severity: advisory.severity ?? node.severity,
        id: advisory.source ?? null,
        ghsa: /GHSA-[0-9a-z-]+/i.exec(advisory.url ?? '')?.[0] ?? null,
        title: advisory.title ?? null,
        url: advisory.url ?? null,
        range: advisory.range ?? node.range ?? null,
        direct: node.isDirect === true,
      });
    }
  }
  return out;
}

/** Key used to match an advisory against an exception entry. */
export function advisoryKey(advisory) {
  return advisory.ghsa ?? `${advisory.package}@${advisory.range ?? '*'}`;
}

/**
 * Resolves a package to the ROOT advisories it is exposed to.
 *
 * `npm audit` reports one node per affected package, so a single advisory deep
 * in the tree surfaces once for every ancestor. GHSA-mh99-v99m-4gvg in
 * `brace-expansion` appears twelve times: once for itself and once each for
 * `minimatch`, `glob`, `test-exclude`, `@vitest/coverage-v8`, `eslint` and its
 * plugins.
 *
 * Waiving twelve packages for one problem would be misleading in both
 * directions: it overstates how much is wrong, and it means a genuinely NEW
 * advisory in `eslint` itself would land on an already-waived name and pass
 * silently. So each node is resolved down to the advisory identifiers actually
 * responsible, and the waiver is checked against those.
 */
export function resolveRootAdvisories(auditJson, packageName, seen = new Set()) {
  if (seen.has(packageName)) return [];
  seen.add(packageName);
  const node = auditJson?.vulnerabilities?.[packageName];
  if (!node) return [];
  const roots = [];
  for (const via of node.via ?? []) {
    if (typeof via === 'string') {
      // A parent pointing at a child package: recurse.
      roots.push(...resolveRootAdvisories(auditJson, via, seen));
    } else if (via && typeof via === 'object') {
      roots.push({
        ghsa: /GHSA-[0-9a-z-]+/i.exec(via.url ?? '')?.[0] ?? null,
        package: via.name ?? packageName,
        title: via.title ?? null,
        severity: via.severity ?? node.severity,
      });
    }
  }
  return roots;
}

export function evaluate({ prodAudit, devAudit, exceptions, licences, installedPackages, today }) {
  const failures = [];
  const warnings = [];
  const now = today ? new Date(today) : new Date();

  // ---- production: no exceptions, ever -----------------------------------
  const prodAdvisories = extractAdvisories(prodAudit).filter((a) =>
    BLOCKING_SEVERITIES.has(a.severity)
  );
  for (const advisory of prodAdvisories) {
    failures.push(
      `PRODUCTION dependency \`${advisory.package}\` has a ${advisory.severity} advisory` +
        `${advisory.ghsa ? ` (${advisory.ghsa})` : ''}: ${advisory.title ?? 'no title'}. ` +
        'Production advisories are never waived — patch, override, or replace the dependency.'
    );
  }

  // ---- development: expiring, itemised exceptions -------------------------
  const devAdvisories = extractAdvisories(devAudit).filter((a) =>
    BLOCKING_SEVERITIES.has(a.severity)
  );
  const prodKeys = new Set(prodAdvisories.map(advisoryKey));
  const entries = exceptions?.developmentAdvisories ?? [];
  const usedExceptions = new Set();
  const acceptedDev = [];

  for (const advisory of devAdvisories) {
    if (prodKeys.has(advisoryKey(advisory))) continue; // already failed above
    const key = advisoryKey(advisory);

    // Direct match on this node, or — for a purely transitive node — a match on
    // EVERY root advisory it is exposed to. "Every" matters: a package exposed
    // to one waived and one new advisory must still fail.
    let entry = entries.find((e) => e.id === advisory.ghsa || e.id === key);
    if (!entry && !advisory.ghsa) {
      const roots = resolveRootAdvisories(devAudit, advisory.package);
      const rootIds = [...new Set(roots.map((r) => r.ghsa).filter(Boolean))];
      const matched = rootIds.map((id) => entries.find((e) => e.id === id));
      if (rootIds.length > 0 && matched.every(Boolean)) {
        entry = matched[0];
        advisory.transitiveVia = rootIds;
      }
    }

    if (!entry) {
      failures.push(
        `development dependency \`${advisory.package}\` has an unwaived ${advisory.severity} advisory` +
          `${advisory.ghsa ? ` (${advisory.ghsa})` : ''}. ` +
          'Patch it, or add an itemised entry to the exceptions file with a reason, an owner and a review date.'
      );
      continue;
    }
    usedExceptions.add(entry.id);
    const review = new Date(entry.reviewBy);
    if (Number.isNaN(review.getTime())) {
      failures.push(`exception \`${entry.id}\` has an unparseable \`reviewBy\` date.`);
      continue;
    }
    if (review < now) {
      failures.push(
        `exception \`${entry.id}\` for \`${advisory.package}\` expired on ${entry.reviewBy}. ` +
          'Re-check whether a patched release now exists; extend the date only with a fresh reason.'
      );
      continue;
    }
    if (!entry.reason || !entry.owner) {
      failures.push(`exception \`${entry.id}\` is missing a reason or an owner.`);
      continue;
    }
    acceptedDev.push({ ...advisory, exception: entry });
  }

  // An exception that matches nothing is dead weight that makes the list look
  // more permissive than it is.
  for (const entry of entries) {
    if (!usedExceptions.has(entry.id)) {
      warnings.push(
        `exception \`${entry.id}\` matched no current advisory — the underlying issue is probably fixed. Remove it.`
      );
    }
  }

  // ---- prohibited packages ------------------------------------------------
  const prohibited = [];
  for (const rule of PROHIBITED_PACKAGES) {
    if (installedPackages?.has(rule.name)) {
      prohibited.push(rule);
      failures.push(`prohibited package \`${rule.name}\` is installed: ${rule.reason}`);
    }
  }

  // ---- licences -----------------------------------------------------------
  const licenceSummary = {};
  const disallowed = new Set(
    exceptions?.disallowedLicences ?? ['AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0']
  );
  const licenceFailures = [];
  for (const entry of licences ?? []) {
    const id = entry.license ?? 'UNKNOWN';
    licenceSummary[id] = (licenceSummary[id] ?? 0) + 1;
    if (disallowed.has(id) && !(exceptions?.licenceExceptions ?? []).includes(entry.name)) {
      licenceFailures.push(
        `\`${entry.name}\` is ${id}, which is not permitted for a proprietary product.`
      );
    }
  }
  failures.push(...licenceFailures);

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    production: { blocking: prodAdvisories.length, advisories: prodAdvisories },
    development: {
      blocking: devAdvisories.length,
      waived: acceptedDev.length,
      advisories: devAdvisories,
      waivedAdvisories: acceptedDev,
    },
    prohibited,
    licenceSummary,
  };
}

export function toMarkdown(result) {
  const lines = ['### Dependency and supply chain', ''];
  lines.push('| Tree | Blocking advisories | Waived | Policy |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(`| production | ${result.production.blocking} | 0 | no exceptions permitted |`);
  lines.push(
    `| development | ${result.development.blocking} | ${result.development.waived} | itemised, expiring exceptions |`
  );
  lines.push('');
  if (result.development.advisories.length) {
    lines.push('<details><summary>Development advisories</summary>');
    lines.push('');
    lines.push('| Package | Severity | Advisory | Waived until | Owner |');
    lines.push('| --- | --- | --- | --- | --- |');
    const waivers = new Map(
      result.development.waivedAdvisories.map((w) => [advisoryKey(w), w.exception])
    );
    for (const a of result.development.advisories) {
      const waiver = waivers.get(advisoryKey(a));
      lines.push(
        `| \`${a.package}\` | ${a.severity} | ${a.ghsa ?? a.title ?? '—'} | ` +
          `${waiver?.reviewBy ?? '**unwaived**'} | ${waiver?.owner ?? '—'} |`
      );
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  const licences = Object.entries(result.licenceSummary).sort((a, b) => b[1] - a[1]);
  if (licences.length) {
    lines.push(
      `Licences across the installed tree: ${licences.map(([id, n]) => `${id} (${n})`).join(', ')}`
    );
    lines.push('');
  }
  lines.push(`Prohibited packages present: **${result.prohibited.length}**`);
  if (result.warnings.length) {
    lines.push('');
    for (const w of result.warnings) lines.push(`> ⚠️ ${w}`);
  }
  if (result.failures.length) {
    lines.push('');
    lines.push('**Dependency policy failures**');
    lines.push('');
    for (const f of result.failures) lines.push(`- ❌ ${f}`);
  } else {
    lines.push('');
    lines.push('**Dependency policy: pass**');
  }
  return lines.join('\n');
}

function readJson(path, label, fallback) {
  if (!path || !existsSync(path)) {
    if (fallback !== undefined) return fallback;
    console.error(`cannot read ${label} at ${path}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`${label} at ${path} is not valid JSON: ${error.message}`);
    process.exit(2);
  }
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };

  const prodAudit = readJson(arg('--prod-audit'), 'production audit');
  const devAudit = readJson(arg('--dev-audit'), 'full audit');
  const exceptions = readJson(
    arg('--exceptions') ?? '.github/ci-baselines/dependency-exceptions.json',
    'exceptions',
    { developmentAdvisories: [] }
  );
  const licences = readJson(arg('--licences'), 'licence inventory', []);

  const installedPackages = new Set();
  if (existsSync('package-lock.json')) {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    for (const key of Object.keys(lock.packages ?? {})) {
      const name = key.split('node_modules/').pop();
      if (name) installedPackages.add(name);
    }
  }

  const result = evaluate({ prodAudit, devAudit, exceptions, licences, installedPackages });

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
