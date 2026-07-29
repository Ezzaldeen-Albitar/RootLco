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

/**
 * Rejects an audit document that is not actually an audit result.
 *
 * `npm audit --json` writes `{"error":{"code":"ENETUNREACH",…}}` and exits 1 on
 * a registry or proxy failure. The workflow captures the file with a fallback
 * so a finding cannot be mistaken for a tooling failure — which means an ERROR
 * object parses cleanly, yields `vulnerabilities: {}`, and reports zero
 * advisories on both trees. A network outage would silently pass the gate.
 */
export function assertUsableAudit(auditJson, label) {
  if (!auditJson || typeof auditJson !== 'object') {
    return `${label} audit produced no object.`;
  }
  if (auditJson.error) {
    return `${label} audit failed: ${auditJson.error.code ?? 'unknown error'}. An audit that did not run is not an audit that found nothing.`;
  }
  if (typeof auditJson.vulnerabilities !== 'object' || auditJson.vulnerabilities === null) {
    return `${label} audit has no \`vulnerabilities\` object.`;
  }
  if (typeof auditJson.metadata?.vulnerabilities !== 'object') {
    return `${label} audit has no \`metadata.vulnerabilities\` summary, so it is not an npm audit result.`;
  }
  return null;
}

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

/**
 * An exception is honoured only when it matches on EVERY axis it claims.
 *
 * The identity of a waiver is not "this advisory id". It is: this advisory,
 * against this package, over this affected range, resolved at these exact
 * dependency nodes, and not production-reachable. If any of those changes, the
 * risk decision that was approved is no longer the risk that exists.
 *
 * Returns true when the exception is REJECTED.
 */
export function validateExactMatch(entry, advisory, devAudit, failures, proofs = {}) {
  const node = devAudit?.vulnerabilities?.[advisory.package];
  let rejected = false;
  const reject = (message) => {
    failures.push(message);
    rejected = true;
  };

  // --- one package -------------------------------------------------------
  if (entry.package && entry.package !== advisory.package) {
    reject(
      `exception \`${entry.id}\` is recorded for package \`${entry.package}\` but matched an advisory on ` +
        `\`${advisory.package}\`. A waiver is granted for one package, not for an advisory identifier.`
    );
  }

  // --- one affected range ------------------------------------------------
  // Widening the recorded range is how a waiver silently grows to cover
  // versions nobody assessed.
  const observedRange = advisory.range ?? node?.range ?? null;
  if (entry.affectedRange && observedRange && entry.affectedRange !== observedRange) {
    reject(
      `exception \`${entry.id}\` records affected range \`${entry.affectedRange}\` but npm reports ` +
        `\`${observedRange}\`. The advisory's scope changed; re-assess rather than widening the entry.`
    );
  }

  // --- one dependency path -----------------------------------------------
  // `nodes` is npm's own list of the resolved locations. It is the stable
  // fingerprint: if the dependency path moves, this changes.
  if (Array.isArray(entry.dependencyNodes)) {
    const observed = [...(node?.nodes ?? [])].sort();
    const recorded = [...entry.dependencyNodes].sort();
    if (JSON.stringify(observed) !== JSON.stringify(recorded)) {
      reject(
        `exception \`${entry.id}\` records dependency nodes ${JSON.stringify(recorded)} but the installed ` +
          `tree resolves ${JSON.stringify(observed)}. The dependency path changed, so the reachability ` +
          'evidence behind this waiver no longer describes what is installed.'
      );
    }
  } else {
    reject(
      `exception \`${entry.id}\` records no \`dependencyNodes\`. Without the exact dependency path there is ` +
        'nothing to detect when the path changes, and the waiver becomes open-ended.'
    );
  }

  // --- production reachability must be claimed AND evidenced -------------
  if (entry.productionReachable !== false) {
    reject(
      `exception \`${entry.id}\` does not assert \`productionReachable: false\`. Only development-tree ` +
        'advisories may be waived.'
    );
  }
  if (!entry.productionReachableEvidence) {
    reject(
      `exception \`${entry.id}\` claims it is not production-reachable but records no evidence. ` +
        'An unevidenced safety claim is the thing this file exists to prevent.'
    );
  }
  // REACHABILITY, not absence — and the difference is not pedantry. This field
  // was written three times as an absence claim and was wrong three times:
  // first npm's bundled tree carried an affected brace-expansion, then yarn's
  // vendored bundle did, and finally the `node` BINARY itself did, because Node
  // compiles its internal tooling into the executable. Absence was never
  // achievable — a Node application image contains Node — so each correction was
  // fixing the wrong claim.
  //
  // What a waiver can honestly assert, and what this checks, is that the running
  // application cannot REACH the code: module resolution does not expose it and
  // nothing on the request path invokes it. An entry that also wants to describe
  // presence should say so separately via `finalContainerCodePresent`.
  if (entry.finalContainerReachable !== false || !entry.finalContainerReachableEvidence) {
    reject(
      `exception \`${entry.id}\` must assert \`finalContainerReachable: false\` WITH evidence taken from ` +
        'the built image, not from the package.json classification. Note this means NOT REACHABLE ' +
        'from the running application — not "absent from the image", which vendored code makes ' +
        'unachievable and which a path-based inventory cannot prove either way.'
    );
  }

  // --- an unapproved exception must not waive anything -------------------
  //
  // Until this existed, `approvalStatus` was documentation: an entry marked
  // `pending-owner-approval` still suppressed advisories exactly as an approved
  // one did. That makes the approval step theatre — anyone adding an entry gets
  // the waiver immediately and the owner's decision changes nothing.
  //
  // A risk acceptance is a DECISION, and a decision that the machine ignores is
  // not a control. So the waiver now requires the decision to have been made,
  // by someone, on a date.
  // One message per entry: an unapproved exception is not ALSO an unsigned one,
  // and reporting both makes the real problem harder to see.
  if (entry.approvalStatus !== 'approved') {
    reject(
      `exception \`${entry.id}\` is \`${entry.approvalStatus ?? 'unset'}\`, not \`approved\`. ` +
        'An exception waives a blocking advisory, so it takes effect only once the risk has ' +
        'actually been accepted — recording it is not the same as approving it.'
    );
  } else if (!entry.approvedBy || !/^\d{4}-\d{2}-\d{2}$/.test(entry.approvedOn ?? '')) {
    reject(
      `exception \`${entry.id}\` is approved but records no \`approvedBy\` and dated \`approvedOn\`. ` +
        'An approval nobody signed and nobody dated cannot be reviewed or revoked.'
    );
  }

  // --- the CLAIM must agree with the mechanically derived PROOF ----------
  // Everything above validates what the entry SAYS. This checks it against
  // what dependency-path-proof.mjs actually found, so a waiver cannot go on
  // asserting "not production reachable" after the package moves into the
  // production tree.
  const proof = proofs[entry.package];
  if (proof) {
    if (proof.productionReachable === true) {
      reject(
        `exception \`${entry.id}\`: \`${entry.package}\` IS production-reachable according to the ` +
          'dependency-path proof, but the entry claims it is not. The waiver is void.'
      );
    }
    if (proof.inRunnerImage === true) {
      reject(
        `exception \`${entry.id}\`: \`${entry.package}\` is present in the built runner image, but the ` +
          'entry claims the final container does not reach it.'
      );
    }
    if (Array.isArray(proof.directImports) && proof.directImports.length > 0) {
      reject(
        `exception \`${entry.id}\`: application source imports \`${entry.package}\` directly ` +
          `(${proof.directImports.join(', ')}), so it is not development tooling.`
      );
    }
    // The proof's own node list must agree with the recorded one — a second,
    // independent derivation of the same fingerprint.
    if (Array.isArray(entry.dependencyNodes) && Array.isArray(proof.instances)) {
      const proven = proof.instances
        .filter((i) => entry.installedAffectedVersions?.includes(i.version))
        .map((i) => i.path)
        .sort();
      const recorded = [...entry.dependencyNodes].sort();
      if (proven.length > 0 && JSON.stringify(proven) !== JSON.stringify(recorded)) {
        reject(
          `exception \`${entry.id}\`: the dependency-path proof resolves the affected versions at ` +
            `${JSON.stringify(proven)}, which disagrees with the recorded ${JSON.stringify(recorded)}.`
        );
      }
    }
  } else if (entry.requiresReachabilityProof !== false) {
    reject(
      `exception \`${entry.id}\` requires a dependency-path proof for \`${entry.package}\` and none was ` +
        'supplied. Pass --reachability-proof; an unproven reachability claim is not evidence.'
    );
  }

  // --- the advisory itself must still be development-only ----------------
  // npm marks a node `isDirect`/`dev`; if it ever stops being dev-only the
  // waiver is void whatever the entry says.
  if (node && node.isDirect === true) {
    reject(
      `exception \`${entry.id}\`: \`${advisory.package}\` is now a DIRECT dependency. A waiver granted for a ` +
        'transitive development tool does not cover a direct one.'
    );
  }

  // --- a compatible fix must not already exist ---------------------------
  // `fixAvailable` is an object when npm can fix it; `isSemVerMajor: false`
  // means the fix is compatible. An exception that survives a compatible fix
  // is an exception nobody is acting on.
  const fix = node?.fixAvailable;
  if (fix && typeof fix === 'object' && fix.isSemVerMajor === false) {
    reject(
      `exception \`${entry.id}\`: a COMPATIBLE fix is now available (\`${fix.name}@${fix.version}\`, ` +
        'not a semver-major change). Apply it and remove the exception.'
    );
  }
  if (fix === true) {
    reject(
      `exception \`${entry.id}\`: npm reports a fix is available without a breaking change. ` +
        'Apply it and remove the exception.'
    );
  }

  // --- the record must carry its evidence --------------------------------
  for (const field of [
    'severity',
    'patchedVersion',
    'environment',
    'exploitability',
    'reasonUpgradeCannotBeApplied',
    'attemptedRemediation',
    'attemptedRemediationResult',
    'owner',
    'createdOn',
    'reviewBy',
    'expiresOn',
    'removalCondition',
  ]) {
    if (!entry[field]) {
      reject(`exception \`${entry.id}\` is missing the required field \`${field}\`.`);
    }
  }
  if (!Array.isArray(entry.compensatingControls) || entry.compensatingControls.length === 0) {
    reject(`exception \`${entry.id}\` records no compensating controls.`);
  }
  if (!Array.isArray(entry.evidenceLinks) || entry.evidenceLinks.length === 0) {
    reject(`exception \`${entry.id}\` records no evidence links.`);
  }

  return rejected;
}

export function evaluate({
  prodAudit,
  devAudit,
  exceptions,
  licences,
  installedPackages,
  today,
  proofs = {},
}) {
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
    // EVERY root advisory it is exposed to.
    //
    // `e.id &&` matters: without it, an exception entry that omits `id` matches
    // `undefined === undefined` and waives every unidentified advisory in the
    // tree.
    let entry = entries.find((e) => e.id && (e.id === advisory.ghsa || e.id === key));
    let matchedEntries = entry ? [entry] : [];
    // A DIRECT match is the advisory on the package the exception was written
    // for — that is where the exact package/range/dependency-path checks apply.
    // An INHERITED match is an ancestor exposed to the same root advisory;
    // validating the waiver's fingerprint against an ancestor would compare
    // `brace-expansion`'s recorded nodes with `eslint`'s, which is meaningless.
    let matchKind = entry ? 'direct' : null;

    if (!entry && !advisory.ghsa) {
      const roots = resolveRootAdvisories(devAudit, advisory.package);
      // EVERY root must carry an identifier. Previously the identifiers were
      // filtered with `.filter(Boolean)`, so a root advisory with no GHSA in
      // its URL was dropped from the set and the remaining — already waived —
      // roots satisfied `every`. A genuinely new advisory reaching the tree
      // through an already-waived package was therefore absorbed silently, and
      // the artifact recorded an affirmative but false `transitiveVia`.
      const allIdentified = roots.length > 0 && roots.every((r) => r.ghsa);
      if (allIdentified) {
        const rootIds = [...new Set(roots.map((r) => r.ghsa))];
        const matched = rootIds.map((id) => entries.find((e) => e.id && e.id === id));
        if (matched.every(Boolean)) {
          matchedEntries = matched;
          entry = matched[0];
          matchKind = 'inherited';
          advisory.transitiveVia = rootIds;
        }
      } else if (roots.length > 0) {
        failures.push(
          `development dependency \`${advisory.package}\` is exposed to a ${advisory.severity} advisory ` +
            'that carries no GHSA identifier, so it cannot be matched against the exception list. ' +
            'It is treated as unwaived.'
        );
        continue;
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
    // EVERY matched exception is validated, not just the first. A transitive
    // node exposed to two waived roots is only waived if both waivers are
    // complete and unexpired.
    let rejected = false;
    for (const matched of matchedEntries) {
      usedExceptions.add(matched.id);

      // Two dates with two different jobs. `reviewBy` is when a human must look
      // again — missing it is a warning, because the risk has not changed.
      // `expiresOn` is when the gate goes red, because an open-ended exception
      // is an accepted risk nobody re-decided.
      const review = new Date(matched.reviewBy);
      const expiry = new Date(matched.expiresOn ?? matched.reviewBy);
      if (Number.isNaN(expiry.getTime())) {
        failures.push(`exception \`${matched.id}\` has an unparseable expiry date.`);
        rejected = true;
      } else if (expiry < now) {
        failures.push(
          `exception \`${matched.id}\` for \`${advisory.package}\` EXPIRED on ` +
            `${matched.expiresOn ?? matched.reviewBy}. Re-check whether a compatible patched release now ` +
            'exists; extend the date only with a fresh, written reason.'
        );
        rejected = true;
      } else if (!Number.isNaN(review.getTime()) && review < now) {
        warnings.push(
          `exception \`${matched.id}\` passed its review date (${matched.reviewBy}) and expires on ` +
            `${matched.expiresOn}. Re-check it now rather than on the day it turns the gate red.`
        );
      }
      if (!matched.reason && !matched.reasonUpgradeCannotBeApplied) {
        failures.push(`exception \`${matched.id}\` records no reason.`);
        rejected = true;
      }
      if (!matched.owner) {
        failures.push(`exception \`${matched.id}\` records no owner.`);
        rejected = true;
      }
    }
    // ---- the exception must match EXACTLY, not merely by advisory id ------
    // One advisory, one package, one affected range, one dependency-path
    // fingerprint. Applied ONLY to the direct match: an ancestor inherits the
    // waiver because its root is waived, and comparing the waiver's recorded
    // package and nodes against an ancestor's would compare two different
    // things and always disagree.
    if (matchKind === 'direct') {
      for (const matched of matchedEntries) {
        rejected = validateExactMatch(matched, advisory, devAudit, failures, proofs) || rejected;
      }
    }

    if (rejected) continue;
    acceptedDev.push({ ...advisory, exception: entry, matchKind });
  }

  // An exception that matches nothing is not dead weight to be warned about —
  // it is a FAILURE. Either the advisory was fixed and the entry must go, or
  // the dependency moved and the entry no longer describes reality. Both make
  // the list look more permissive than it is.
  for (const entry of entries) {
    if (!usedExceptions.has(entry.id)) {
      failures.push(
        `exception \`${entry.id}\` (${entry.package ?? 'unknown package'}) matched no current advisory. ` +
          'Either the issue is fixed — remove the entry — or the dependency path changed and the entry no ' +
          'longer describes what is installed. An exception that outlives its cause is worse than none.'
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
  lines.push('| Tree | Advisories found | Of those, waived | Policy |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(`| production | ${result.production.blocking} | 0 | no exceptions permitted |`);
  lines.push(
    `| development | ${result.development.blocking} | ${result.development.waived} | itemised, expiring exceptions |`
  );
  lines.push('');

  // `npm audit` reports one advisory once per AFFECTED NODE, so a single root
  // advisory appears as many rows — 12, here, for one GHSA. Reported without
  // this line, "12 waived" reads as twelve accepted risks and makes the
  // exception record look like a blanket waiver, which is exactly what the
  // policy forbids. The distinct count is what a reviewer actually needs.
  const distinctRoots = new Set(
    result.development.advisories.map((a) => a.ghsa).filter((id) => typeof id === 'string')
  );
  const inherited = result.development.advisories.filter((a) => !a.ghsa).length;
  if (result.development.advisories.length) {
    lines.push(
      `**${distinctRoots.size} distinct advisor${distinctRoots.size === 1 ? 'y' : 'ies'}** across ` +
        `${result.development.advisories.length} affected node(s) — ${inherited} of them ancestors that ` +
        'are vulnerable only because a dependency is. An ancestor exposed to any root that is NOT ' +
        'waived stays blocking, so a new advisory cannot be absorbed by an existing waiver.'
    );
    lines.push('');
  }

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

  // A registry outage makes npm write an error object and exit 1. The workflow
  // captures the file either way, so without this the error object parses
  // cleanly and both trees report zero advisories.
  for (const [doc, label] of [
    [prodAudit, 'production'],
    [devAudit, 'full'],
  ]) {
    const problem = assertUsableAudit(doc, label);
    if (problem) {
      console.error(`::error::${problem}`);
      process.exit(2);
    }
  }
  const exceptions = readJson(
    arg('--exceptions') ?? '.github/ci-baselines/dependency-exceptions.json',
    'exceptions',
    { developmentAdvisories: [] }
  );
  const licences = readJson(arg('--licences'), 'licence inventory', []);

  // Dependency-path proofs, keyed by package. Each is the output of
  // scripts/ci/dependency-path-proof.mjs — a mechanical derivation the gate
  // cross-checks every reachability CLAIM against, so an exception cannot go on
  // asserting "development only" after the package moves.
  const proofs = {};
  for (const path of (arg('--reachability-proof') ?? '').split(',').filter(Boolean)) {
    if (!existsSync(path)) {
      console.error(`::error::reachability proof not found at ${path}`);
      process.exit(2);
    }
    try {
      const proof = JSON.parse(readFileSync(path, 'utf8'));
      if (!proof.package) throw new Error('proof has no `package` field');
      proofs[proof.package] = proof;
    } catch (error) {
      console.error(`::error::reachability proof at ${path} is unusable: ${error.message}`);
      process.exit(2);
    }
  }

  const installedPackages = new Set();
  if (existsSync('package-lock.json')) {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    for (const key of Object.keys(lock.packages ?? {})) {
      const name = key.split('node_modules/').pop();
      if (name) installedPackages.add(name);
    }
  }

  const result = evaluate({ prodAudit, devAudit, exceptions, licences, installedPackages, proofs });

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
