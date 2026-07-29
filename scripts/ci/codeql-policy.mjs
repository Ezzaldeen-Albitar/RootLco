#!/usr/bin/env node
/**
 * CodeQL / SARIF policy gate.
 *
 * The previous initiative shipped CodeQL analysis and then discovered, at the
 * merge gate, that a `CodeQL` check produced by GitHub Advanced Security had
 * been **red on five consecutive heads** while every report said the workflow
 * was 14/14 green (AR-52). The workflow was green because uploading SARIF is
 * what that job does; the alerts it uploaded were judged by a separate check-run
 * that `/actions/runs` never mentions.
 *
 * Two lessons are wired in here:
 *
 *  1. **A scan that did not run must never read as a scan that found nothing.**
 *     This is AR-45 in a different scanner. The gate refuses to report clean
 *     unless it can show the analysis ran, produced a schema-valid document, and
 *     examined a non-empty set of files.
 *  2. **Read the commit's check-runs, not the workflow run.** That part cannot
 *     be done from inside the run being judged, so it lives in
 *     `check-commit-checks.mjs`; this file judges the SARIF.
 *
 * Exit codes: 0 Go · 1 policy failure · 2 the gate could not evaluate.
 *
 * Usage:
 *   node scripts/ci/codeql-policy.mjs --sarif <dir-or-file> [--sarif <more>] \
 *     [--baseline .github/ci-baselines/codeql-baseline.json] \
 *     [--json out.json] [--markdown out.md]
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Severities that may never be left unresolved. */
export const BLOCKING_SEVERITIES = Object.freeze(['critical', 'high']);

/**
 * Paths whose findings are APPLICATION findings. Everything else is tooling.
 *
 * The split exists because the two carry different obligations, not because
 * tooling findings are ignorable: an application High blocks unconditionally,
 * a tooling High blocks unless it carries a specific, expiring disposition.
 */
export const APPLICATION_PREFIXES = Object.freeze(['src/']);

/** Normalises a SARIF artifact location to a repo-relative POSIX path. */
export function normalisePath(uri) {
  if (typeof uri !== 'string') return '';
  return uri
    .replace(/^file:\/\//, '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');
}

export function isApplicationPath(path) {
  return APPLICATION_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Every `.sarif` file under a directory, or the file itself. */
export function collectSarifFiles(target) {
  let stat;
  try {
    stat = statSync(target);
  } catch (error) {
    throw new Error(`SARIF path ${target} cannot be read: ${error.message}`);
  }
  if (stat.isFile()) return [target];

  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.sarif$/i.test(entry.name)) out.push(full);
    }
  };
  walk(target);
  return out.sort();
}

/**
 * Validates the parts of the SARIF contract this gate depends on.
 *
 * Deliberately not a full schema validation: a gate that depends on a 900-line
 * schema and then reports "invalid" tells nobody anything. It checks the exact
 * shape it reads, and names the field that is wrong.
 */
export function validateSarif(document, label) {
  const problems = [];
  if (document === null || typeof document !== 'object') {
    return [`${label}: not a JSON object`];
  }
  if (typeof document.version !== 'string') problems.push(`${label}: no \`version\``);
  else if (!/^2\.1\.\d+$/.test(document.version)) {
    problems.push(`${label}: SARIF version \`${document.version}\` is not 2.1.x`);
  }
  if (!Array.isArray(document.runs)) {
    problems.push(`${label}: \`runs\` is not an array`);
    return problems;
  }
  if (document.runs.length === 0) problems.push(`${label}: \`runs\` is empty — nothing analysed`);

  for (const [index, run] of document.runs.entries()) {
    const where = `${label} run[${index}]`;
    const driver = run?.tool?.driver;
    if (!driver || typeof driver.name !== 'string') {
      problems.push(`${where}: no \`tool.driver.name\``);
    }
    if (!Array.isArray(run.results)) {
      problems.push(`${where}: \`results\` is not an array — absent is not the same as empty`);
    }
  }
  return problems;
}

/** The rule metadata CodeQL attaches, flattened per run. */
function ruleIndex(run) {
  const rules = run?.tool?.driver?.rules ?? [];
  const byId = new Map();
  for (const rule of rules) {
    if (rule?.id) byId.set(rule.id, rule);
  }
  for (const extension of run?.tool?.extensions ?? []) {
    for (const rule of extension?.rules ?? []) {
      if (rule?.id) byId.set(rule.id, rule);
    }
  }
  return byId;
}

/** `security-severity` is a 0-10 string on the rule's properties. */
export function severityOf(rule, result) {
  const raw = rule?.properties?.['security-severity'] ?? result?.properties?.['security-severity'];
  const score = Number(raw);
  if (!Number.isFinite(score)) {
    // No security severity means the rule is a quality rule, not a security one.
    return { level: rule?.defaultConfiguration?.level ?? result?.level ?? 'warning', score: null };
  }
  if (score >= 9.0) return { level: 'critical', score };
  if (score >= 7.0) return { level: 'high', score };
  if (score >= 4.0) return { level: 'medium', score };
  return { level: 'low', score };
}

/** Flattens every result across every SARIF document into one finding list. */
export function extractFindings(documents) {
  const findings = [];
  for (const { label, document } of documents) {
    for (const run of document.runs ?? []) {
      const rules = ruleIndex(run);
      for (const result of run.results ?? []) {
        const rule = rules.get(result.ruleId) ?? null;
        const location = result.locations?.[0]?.physicalLocation;
        const path = normalisePath(location?.artifactLocation?.uri ?? '');
        const { level, score } = severityOf(rule, result);
        findings.push({
          sarif: label,
          ruleId: result.ruleId ?? '(unknown rule)',
          ruleName: rule?.name ?? rule?.shortDescription?.text ?? result.ruleId ?? '',
          precision: rule?.properties?.precision ?? null,
          severity: level,
          securitySeverity: score,
          path,
          startLine: location?.region?.startLine ?? null,
          message: result.message?.text ?? '',
          scope: isApplicationPath(path) ? 'application' : 'tooling',
          // A SUPPRESSED result is one GitHub has dismissed. It is still a
          // finding; it is simply one somebody has adjudicated.
          suppressed: Array.isArray(result.suppressions) && result.suppressions.length > 0,
        });
      }
    }
  }
  return findings;
}

const EMPTY_COUNTS = () => ({
  total: 0,
  open: 0,
  dismissed: 0,
  suppressed: 0,
  application: 0,
  tooling: 0,
  bySeverity: {},
  byRule: {},
});

/** A dismissal matches a finding only on rule AND path — never on rule alone. */
function dismissalMatches(entry, finding) {
  return entry.ruleId === finding.ruleId && entry.path === finding.path;
}

/**
 * @param {object} input
 * @param {Array<{label: string, document: any}>} input.documents
 * @param {any} [input.baseline]
 * @param {number|null} [input.filesAnalysed]  source files the analysis reported
 * @param {string[]|null} [input.languages]    languages THIS invocation owns
 * @returns {{
 *   ok: boolean,
 *   decision: string,
 *   failures: string[],
 *   warnings: string[],
 *   counts: { total: number, open: number, dismissed: number, suppressed: number,
 *             application: number, tooling: number,
 *             bySeverity: Record<string, number>, byRule: Record<string, number> },
 *   findings: any[],
 *   tools: string[],
 * }}
 */
export function evaluate({ documents, baseline = {}, filesAnalysed = null, languages = null }) {
  const failures = [];
  const warnings = [];

  // ---- 1. the analysis must have produced something to judge ---------------
  if (documents.length === 0) {
    failures.push(
      'no SARIF document was found. A scan that did not run must never read as a scan that found nothing.'
    );
    return {
      ok: false,
      decision: 'No-Go',
      failures,
      warnings,
      findings: [],
      counts: EMPTY_COUNTS(),
      tools: [],
    };
  }

  for (const { label, document } of documents) {
    failures.push(...validateSarif(document, label));
  }
  if (failures.length > 0) {
    return {
      ok: false,
      decision: 'No-Go',
      failures,
      warnings,
      findings: [],
      counts: EMPTY_COUNTS(),
      tools: [],
    };
  }

  // ---- 2. it must have looked at a non-empty target set --------------------
  // Which languages THIS invocation is responsible for.
  //
  // `code-security` is a matrix, and each leg analyses one language, so a leg
  // only ever has its own SARIF on disk. Asserting the baseline's full language
  // list per leg would fail every leg for the language it is not running — so
  // the caller names its language and the baseline list is the ci-gate-level
  // concern. Absent both, the only assertion left is that SOMETHING was
  // analysed, which the checks below still make.
  const expectedLanguages = languages ?? baseline.expectedLanguages ?? [];
  const seenTools = new Set();
  for (const { document } of documents) {
    for (const run of document.runs ?? []) {
      const name = run?.tool?.driver?.name;
      if (name) seenTools.add(name);
    }
  }
  if (seenTools.size === 0) failures.push('no analysis tool identified itself in any run');

  // CodeQL names the file after the LANGUAGE, not the pack: analysing
  // `javascript-typescript` writes `javascript.sarif`. Measured on the hosted
  // runner, where an exact-substring match reported "no SARIF for
  // javascript-typescript" while the document sat right there — this gate's
  // first real finding was in this gate. A pack matches if the label contains
  // the whole name or any hyphen-separated part of it.
  const missingLanguages = expectedLanguages.filter((language) => {
    const candidates = [language, ...language.split('-')];
    return !documents.some(({ label }) =>
      candidates.some((candidate) => label.toLowerCase().includes(candidate.toLowerCase()))
    );
  });
  if (missingLanguages.length > 0) {
    failures.push(
      `no SARIF for ${missingLanguages.join(', ')} — a language that was not analysed cannot be reported clean.`
    );
  }

  if (typeof filesAnalysed === 'number' && filesAnalysed <= 0) {
    failures.push('the analysis reported zero source files — an empty scan is not a clean scan.');
  }

  const findings = extractFindings(documents);
  const live = findings.filter((finding) => !finding.suppressed);

  // ---- 3. blocking severities ---------------------------------------------
  const dismissals = baseline.dismissals ?? [];
  const usedDismissals = new Set();

  const blocking = [];
  // Every live finding is checked against the dismissal list, at ANY severity.
  // An earlier version only consulted the list for blocking severities, so a
  // medium-severity dismissal was never validated and never marked used — it
  // would then be reported as "matches nothing" while sitting on a real finding.
  for (const finding of live) {
    const match = dismissals.findIndex((entry) => dismissalMatches(entry, finding));
    if (match === -1) {
      if (BLOCKING_SEVERITIES.includes(finding.severity)) blocking.push(finding);
      continue;
    }
    usedDismissals.add(match);
    const entry = dismissals[match];
    // An application-source finding may not be dismissed by this file at all.
    if (finding.scope === 'application') {
      failures.push(
        `dismissal for \`${entry.ruleId}\` at \`${entry.path}\` covers APPLICATION source. ` +
          'Application findings are fixed or refuted, never waived here.'
      );
    }
    if (
      entry.expiresOn &&
      entry.expiresOn < (baseline.today ?? new Date().toISOString().slice(0, 10))
    ) {
      failures.push(
        `dismissal for \`${entry.ruleId}\` at \`${entry.path}\` expired on ${entry.expiresOn}.`
      );
    }
    for (const field of ['reason', 'reviewer', 'reviewedOn', 'source', 'sink']) {
      if (!entry[field]) {
        failures.push(
          `dismissal for \`${entry.ruleId}\` at \`${entry.path}\` records no \`${field}\`. ` +
            'A dismissal without a reproduction and a name is an opinion.'
        );
      }
    }
  }

  for (const finding of blocking) {
    failures.push(
      `unresolved ${finding.severity.toUpperCase()} — \`${finding.ruleId}\` at ` +
        `\`${finding.path}:${finding.startLine ?? '?'}\` (${finding.scope}). ${finding.message}`
    );
  }

  // ---- 4. a dismissal that matches nothing is a lie about the tree ---------
  dismissals.forEach((entry, index) => {
    if (usedDismissals.has(index)) return;
    // It may match a SUPPRESSED finding instead — still evidence it is live.
    const suppressedMatch = findings.some(
      (finding) => finding.suppressed && dismissalMatches(entry, finding)
    );
    if (suppressedMatch) return;
    failures.push(
      `dismissal for \`${entry.ruleId}\` at \`${entry.path}\` matches nothing. ` +
        'The finding was fixed, or it moved — either way this entry is stale. Remove it.'
    );
  });

  // ---- 5. a dismissed rule appearing at a NEW path is a new finding --------
  for (const entry of dismissals) {
    const elsewhere = live.filter(
      (finding) => finding.ruleId === entry.ruleId && finding.path !== entry.path
    );
    for (const finding of elsewhere) {
      if (!BLOCKING_SEVERITIES.includes(finding.severity)) continue;
      if (dismissals.some((other) => dismissalMatches(other, finding))) continue;
      failures.push(
        `\`${finding.ruleId}\` is dismissed at \`${entry.path}\` but also appears at ` +
          `\`${finding.path}:${finding.startLine ?? '?'}\`, which nothing covers. ` +
          'A dismissal is per-path on purpose.'
      );
    }
  }

  // ---- 6. the total may not grow ------------------------------------------
  // A finding covered by an approved dismissal is ADJUDICATED, not open. The
  // ceiling counts what nobody has answered for; counting dismissed findings
  // too would make "dismiss it" and "raise the ceiling" the same action, which
  // is precisely the laxity the ceiling exists to prevent.
  const open = live.filter(
    (finding) => !dismissals.some((entry) => dismissalMatches(entry, finding))
  );

  const counts = {
    total: live.length,
    open: open.length,
    dismissed: live.length - open.length,
    suppressed: findings.length - live.length,
    application: live.filter((finding) => finding.scope === 'application').length,
    tooling: live.filter((finding) => finding.scope === 'tooling').length,
    bySeverity: {},
    byRule: {},
  };
  for (const finding of live) {
    counts.bySeverity[finding.severity] = (counts.bySeverity[finding.severity] ?? 0) + 1;
    counts.byRule[finding.ruleId] = (counts.byRule[finding.ruleId] ?? 0) + 1;
  }

  const ceiling = baseline.maximumOpenFindings;
  if (typeof ceiling === 'number' && open.length > ceiling) {
    failures.push(
      `open findings rose to ${open.length}, above the recorded ceiling of ${ceiling}. ` +
        'Raise the ceiling in the same commit that justifies it, or fix the new finding.'
    );
  } else if (typeof ceiling === 'number' && open.length < ceiling) {
    warnings.push(
      `open findings fell to ${open.length} from a ceiling of ${ceiling} — lower the ceiling to lock the gain in.`
    );
  }

  return {
    ok: failures.length === 0,
    decision: failures.length === 0 ? 'Go' : 'No-Go',
    failures,
    warnings,
    counts,
    findings: live,
    tools: [...seenTools].sort(),
  };
}

export function toMarkdown(result) {
  const lines = ['### CodeQL policy', ''];
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Tools | ${result.tools?.join(', ') || '—'} |`);
  lines.push(`| Open findings | ${result.counts?.open ?? 0} |`);
  lines.push(`| …covered by an approved dismissal | ${result.counts?.dismissed ?? 0} |`);
  lines.push(`| …in application source | ${result.counts?.application ?? 0} |`);
  lines.push(`| …in tooling | ${result.counts?.tooling ?? 0} |`);
  lines.push(`| Dismissed by GitHub | ${result.counts?.suppressed ?? 0} |`);
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    lines.push(`| ${severity} | ${result.counts?.bySeverity?.[severity] ?? 0} |`);
  }
  lines.push('');

  if (result.failures.length > 0) {
    lines.push('**Failures**', '');
    for (const failure of result.failures) lines.push(`- ❌ ${failure}`);
    lines.push('');
  }
  for (const warning of result.warnings) lines.push(`> ⚠️ ${warning}`);
  if (result.warnings.length > 0) lines.push('');

  lines.push(`**CodeQL policy: ${result.ok ? 'Go' : 'No-Go'}**`);
  return lines.join('\n');
}

function main(argv) {
  const values = (name) =>
    argv.reduce((out, arg, index) => (arg === name ? [...out, argv[index + 1]] : out), []);
  const one = (name) => values(name)[0];

  const targets = values('--sarif');
  if (targets.length === 0) {
    console.error(
      'usage: codeql-policy.mjs --sarif <dir-or-file> [--baseline f] [--json f] [--markdown f]'
    );
    process.exit(2);
  }

  const baselinePath = one('--baseline') ?? '.github/ci-baselines/codeql-baseline.json';
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`CodeQL baseline at ${baselinePath} could not be read: ${error.message}`);
      process.exit(2);
    }
    console.error(`no CodeQL baseline at ${baselinePath} — every finding will be judged unwaived.`);
  }

  const documents = [];
  for (const target of targets) {
    let files;
    try {
      files = collectSarifFiles(target);
    } catch (error) {
      console.error(error.message);
      process.exit(2);
    }
    for (const file of files) {
      let document;
      try {
        document = JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) {
        console.error(`${file}: SARIF is not parseable JSON — ${error.message}`);
        process.exit(2);
      }
      documents.push({ label: relative(process.cwd(), file).replace(/\\/g, '/'), document });
    }
  }

  const declared = values('--language');
  const result = evaluate({
    documents,
    baseline,
    languages: declared.length > 0 ? declared : null,
  });

  const markdown = toMarkdown(result);
  const jsonOut = one('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  const mdOut = one('--markdown');
  if (mdOut) writeFileSync(mdOut, `${markdown}\n`);
  console.log(markdown);

  for (const failure of result.failures) console.log(`::error::${failure}`);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
