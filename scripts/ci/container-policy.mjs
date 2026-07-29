#!/usr/bin/env node
/**
 * Container vulnerability policy (initiative §21).
 *
 * The scanner runs with `exit-code: 0` on purpose. Two reasons:
 *
 *   1. A scanner that aborts the job on its own terms leaves no artifact behind,
 *      so the failure has to be diagnosed from a log rather than a report.
 *   2. "Blocking" is a policy question, not a scanner question. Base-image
 *      findings with no fixed version available cannot be actioned by this
 *      repository, and treating them identically to a fixable finding in our own
 *      dependency tree teaches everyone to ignore the gate.
 *
 * So: FIXABLE findings at a blocking severity fail. Unfixable ones are reported
 * with the base image named, because the action there is "change or rebuild the
 * base image", which is a different conversation from "bump a package".
 *
 * Secret findings are ALWAYS blocking regardless of severity or fixability — a
 * credential in a layer cannot be waited out.
 *
 * Usage:
 *   node scripts/ci/container-policy.mjs --report trivy-image.json \
 *     [--severities CRITICAL,HIGH] [--json out.json] [--markdown out.md]
 * Exit codes: 0 pass · 1 blocking findings · 2 IO/shape error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function collect(report) {
  const vulnerabilities = [];
  const secrets = [];
  const misconfigurations = [];
  for (const result of report?.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      vulnerabilities.push({
        target: result.Target,
        class: result.Class ?? null,
        type: result.Type ?? null,
        id: v.VulnerabilityID,
        package: v.PkgName,
        installed: v.InstalledVersion,
        fixed: v.FixedVersion ?? null,
        severity: (v.Severity ?? 'UNKNOWN').toUpperCase(),
        title: v.Title ?? null,
      });
    }
    for (const s of result.Secrets ?? []) {
      // The matched text is deliberately not carried through.
      secrets.push({
        target: result.Target,
        ruleId: s.RuleID,
        category: s.Category ?? null,
        severity: (s.Severity ?? 'HIGH').toUpperCase(),
        startLine: s.StartLine ?? null,
      });
    }
    for (const m of result.Misconfigurations ?? []) {
      misconfigurations.push({
        target: result.Target,
        id: m.ID,
        title: m.Title ?? null,
        severity: (m.Severity ?? 'UNKNOWN').toUpperCase(),
        status: m.Status ?? null,
      });
    }
  }
  return { vulnerabilities, secrets, misconfigurations };
}

export function evaluate(report, severities, options = {}) {
  const blocking = new Set(severities.map((s) => s.trim().toUpperCase()).filter(Boolean));
  const { vulnerabilities, secrets, misconfigurations } = collect(report);

  const atSeverity = vulnerabilities.filter((v) => blocking.has(v.severity));
  const fixable = atSeverity.filter((v) => v.fixed);
  const unfixable = atSeverity.filter((v) => !v.fixed);

  const failures = [];
  for (const v of fixable) {
    failures.push(
      `${v.severity} ${v.id} in \`${v.package}@${v.installed}\` (${v.target}) — fixed in ${v.fixed}.`
    );
  }
  for (const s of secrets) {
    failures.push(
      `a secret matching rule \`${s.ruleId}\` was found in the image at ${s.target}` +
        `${s.startLine ? ` line ${s.startLine}` : ''}. A credential in a layer is readable by anyone who can pull the image.`
    );
  }
  const failedMisconfig = misconfigurations.filter(
    (m) => blocking.has(m.severity) && m.status === 'FAIL'
  );
  for (const m of failedMisconfig) {
    failures.push(
      `${m.severity} misconfiguration ${m.id} at ${m.target}: ${m.title ?? 'no title'}.`
    );
  }

  return {
    ok: failures.length === 0,
    blocking: failures.length,
    // On a pull request the scan runs with `ignore-unfixed`, so unfixable
    // findings are stripped BEFORE this script sees them and the count is
    // always zero. Reporting "0 unfixable" would read as "there are none",
    // which is a filter artifact presented as a measurement.
    unfixedWereFiltered: options.unfixedWereFiltered === true,
    severities: [...blocking],
    counts: {
      vulnerabilities: vulnerabilities.length,
      atBlockingSeverity: atSeverity.length,
      fixable: fixable.length,
      unfixable: unfixable.length,
      secrets: secrets.length,
      misconfigurations: misconfigurations.length,
    },
    fixable,
    unfixable,
    secrets,
    failures,
  };
}

export function toMarkdown(result) {
  const lines = ['### Container security', ''];
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Blocking severities | ${result.severities.join(', ')} |`);
  lines.push(`| Vulnerabilities (all severities) | ${result.counts.vulnerabilities} |`);
  lines.push(`| …at a blocking severity | ${result.counts.atBlockingSeverity} |`);
  lines.push(`| …of those, fixable → **blocking** | ${result.counts.fixable} |`);
  lines.push(
    result.unfixedWereFiltered
      ? '| …of those, no fix available | **not measured** — the scan ran with `ignore-unfixed`, so these were stripped before the report was written. The nightly deep scan reports them. |'
      : `| …of those, no fix available → reported | ${result.counts.unfixable} |`
  );
  lines.push(`| Secrets in layers | ${result.counts.secrets} |`);
  lines.push(`| Failed misconfigurations | ${result.counts.misconfigurations} |`);
  lines.push('');
  if (result.unfixable.length) {
    lines.push(
      `<details><summary>No fix available (${result.unfixable.length}) — reported, not blocking</summary>`
    );
    lines.push('');
    lines.push(
      'The action for these is to change or rebuild the base image, not to bump a package.'
    );
    lines.push('');
    lines.push('| Severity | ID | Package | Target |');
    lines.push('| --- | --- | --- | --- |');
    for (const v of result.unfixable.slice(0, 40)) {
      lines.push(`| ${v.severity} | ${v.id} | \`${v.package}@${v.installed}\` | ${v.target} |`);
    }
    if (result.unfixable.length > 40)
      lines.push(`| … | ${result.unfixable.length - 40} more | | |`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (result.failures.length) {
    lines.push('**Blocking findings**');
    lines.push('');
    for (const f of result.failures.slice(0, 50)) lines.push(`- ❌ ${f}`);
    if (result.failures.length > 50)
      lines.push(`- …and ${result.failures.length - 50} more (see the JSON artifact)`);
  } else {
    lines.push('**Container policy: pass**');
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const reportPath = arg('--report');
  if (!reportPath || !existsSync(reportPath)) {
    console.error(`scan report not found at ${reportPath}. A missing report is not a clean image.`);
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    console.error(`scan report does not parse: ${error.message}`);
    process.exit(2);
  }
  if (!Array.isArray(report.Results)) {
    console.error(
      'scan report contains no `Results` array — the scanner produced nothing to evaluate, ' +
        'which must not be read as "no vulnerabilities".'
    );
    process.exit(2);
  }

  // An EMPTY `Results` array is the same failure wearing a different shape.
  // Switch to a distroless or scratch base and the scanner finds no package
  // manifest at all: zero vulnerabilities, zero secrets, "policy: pass" — over
  // an image that was never analysed. Require at least one result that
  // describes packages.
  const analysed = report.Results.filter(
    (r) => r.Class === 'os-pkgs' || r.Class === 'lang-pkgs' || Array.isArray(r.Packages)
  );
  if (analysed.length === 0) {
    console.error(
      `::error::the scan report has ${report.Results.length} result(s) and none of them analysed packages ` +
        '(no `os-pkgs` or `lang-pkgs` class). The image was not inspected, which must not be read as clean.'
    );
    process.exit(2);
  }

  const severities = (arg('--severities') ?? 'CRITICAL,HIGH').split(',');
  const result = evaluate(report, severities, {
    unfixedWereFiltered: argv.includes('--unfixed-filtered'),
  });

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
