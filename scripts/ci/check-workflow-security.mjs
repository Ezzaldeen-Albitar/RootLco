#!/usr/bin/env node
/**
 * Workflow-security linter (CSA-03, CSA-19, CSA-20).
 *
 * The audit found every `uses:` pinned to a mutable major-version tag, and
 * `set -euo pipefail` used in one step out of five. Both were *correct at the
 * time of review* and neither was enforced, which is the same as not being true.
 *
 * Rules, each with a stable identifier so a suppression is specific:
 *
 *   WFS-001  every third-party `uses:` is pinned to a full 40-hex commit SHA
 *   WFS-002  every SHA-pinned `uses:` carries a `# vX.Y.Z` version comment
 *   WFS-003  every workflow declares top-level `permissions:`
 *   WFS-004  top-level permissions are read-only
 *   WFS-005  `pull_request_target` is not used
 *   WFS-006  no attacker-controlled `github.event.*` value is interpolated into a `run:` block
 *   WFS-007  every multi-line `run:` block sets `set -euo pipefail`
 *   WFS-008  no `|| true` / `|| :` that swallows an exit status
 *   WFS-009  `continue-on-error: true` is not used
 *   WFS-010  every job declares `timeout-minutes`
 *   WFS-011  a reusable workflow declares exactly ONE job
 *   WFS-012  a bootstrap sparse checkout of `.github/actions` stays in cone mode
 *
 * Deliberately implemented WITHOUT a YAML dependency: this runs in the
 * `secret-scan` job, which does not `npm ci`, and adding a parser to read our own
 * workflows would widen the supply chain to harden it.
 *
 * Usage: node scripts/ci/check-workflow-security.mjs [--dir .github/workflows] [--json out.json]
 * Exit codes: 0 clean · 1 findings · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Interpolations an attacker can influence through a pull request or issue. */
export const UNTRUSTED_EXPRESSIONS = [
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.pull_request.head.ref',
  'github.event.pull_request.head.label',
  'github.event.pull_request.head.repo',
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.review.body',
  'github.event.review_comment.body',
  'github.event.discussion.title',
  'github.event.discussion.body',
  'github.event.commits',
  'github.event.head_commit.message',
  'github.event.head_commit.author',
  'github.event.workflow_run.head_branch',
  'github.head_ref',
];

/** `uses:` values that are not third-party code and need no SHA pin. */
export function isLocalReference(uses) {
  return uses.startsWith('./') || uses.startsWith('.github/');
}

const SHA_PIN = /^[0-9a-f]{40}$/;

/**
 * Extracts the body of every `run:` block, with its starting line number.
 * A block ends at the first line whose indentation is <= the `run:` key's,
 * ignoring blank lines.
 */
export function extractRunBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)(?:-\s+)?run:\s*(\|-?|>-?)?\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const [, indent, folded, inline] = match;
    if (!folded) {
      blocks.push({ start: i + 1, body: inline, multiline: false });
      continue;
    }
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') {
        body.push('');
        continue;
      }
      const lineIndent = /^\s*/.exec(line)[0].length;
      if (lineIndent <= indent.length) break;
      body.push(line);
    }
    blocks.push({ start: i + 1, body: body.join('\n'), multiline: true });
    i = j - 1;
  }
  return blocks;
}

/**
 * True when a reviewed suppression for `rule` sits on this line or in the
 * comment block immediately above it.
 *
 * The block form matters: an inline pragma has room for a rule name and nothing
 * else, and a suppression whose reason does not fit is a suppression nobody can
 * review. Looking upward lets the reason be written properly.
 */
function suppressed(lines, index, rule) {
  const marker = `workflow-security-allow: ${rule}`;
  if (typeof lines === 'string') return lines.includes(marker);
  if (lines[index]?.includes(marker)) return true;
  for (let i = index - 1; i >= 0 && i >= index - 12; i -= 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    // Walk upward only through the contiguous comment block.
    if (!line.startsWith('#')) break;
    if (line.includes(marker)) return true;
  }
  return false;
}

/**
 * @param {string} name  path shown in findings
 * @param {string} source
 * @param {{ isCompositeAction?: boolean }} options
 *   A composite action has no `permissions:`, no `timeout-minutes:` and no
 *   `jobs:` — WFS-003, WFS-004 and WFS-010 do not apply to it. Every other rule
 *   does, and until this existed the composite action that performs the
 *   exact-SHA checkout every other assertion rests on was exempt from all of
 *   them, including SHA pinning.
 */
export function lintWorkflow(name, source, options = {}) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  const isAction = options.isCompositeAction === true;
  const add = (rule, line, message, severity = 'high') => {
    if (isAction && (rule === 'WFS-003' || rule === 'WFS-004' || rule === 'WFS-010')) return;
    findings.push({ workflow: name, rule, line, message, severity });
  };

  // ---- WFS-001 / WFS-002: action pinning --------------------------------
  lines.forEach((line, index) => {
    const match = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)['"]?\s*(#.*)?$/.exec(line);
    if (!match) return;
    const [, uses, comment] = match;
    if (isLocalReference(uses)) return;
    const at = uses.lastIndexOf('@');
    const ref = at === -1 ? '' : uses.slice(at + 1);
    if (!SHA_PIN.test(ref)) {
      if (!suppressed(lines, index, 'WFS-001')) {
        add(
          'WFS-001',
          index + 1,
          `\`${uses}\` is pinned to \`${ref || '(nothing)'}\`, which is mutable. Pin to a full 40-character commit SHA.`
        );
      }
      return;
    }
    if (!comment || !/v\d+(\.\d+)*/.test(comment)) {
      add(
        'WFS-002',
        index + 1,
        `\`${uses}\` is SHA-pinned but carries no \`# vX.Y.Z\` comment, so nobody can tell what version it is.`,
        'medium'
      );
    }
  });

  // ---- WFS-003 / WFS-004: top-level permissions -------------------------
  const topLevelPermissions =
    /^permissions:\s*$/m.test(source) || /^permissions:\s*\{\}/m.test(source);
  if (!topLevelPermissions) {
    add(
      'WFS-003',
      1,
      'no top-level `permissions:` block — the workflow inherits the repository default.'
    );
  } else {
    const block = /^permissions:\s*$\n((?:^[ \t]+.*$\n?)*)/m.exec(source);
    if (block) {
      const writes = block[1]
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /:\s*write\s*$/.test(l));
      if (writes.length) {
        add(
          'WFS-004',
          1,
          `top-level permissions grant write (${writes.join(', ')}). Grant write only on the job that needs it.`
        );
      }
    }
  }

  // ---- WFS-005: pull_request_target -------------------------------------
  lines.forEach((line, index) => {
    if (/^\s*pull_request_target\s*:/.test(line) && !suppressed(lines, index, 'WFS-005')) {
      add(
        'WFS-005',
        index + 1,
        '`pull_request_target` runs with repository write scope in the context of untrusted code.',
        'critical'
      );
    }
  });

  // ---- WFS-006 / WFS-007 / WFS-008: run blocks --------------------------
  for (const block of extractRunBlocks(lines)) {
    for (const expression of UNTRUSTED_EXPRESSIONS) {
      const pattern = new RegExp(`\\$\\{\\{[^}]*${expression.replace(/\./g, '\\.')}`);
      if (pattern.test(block.body)) {
        add(
          'WFS-006',
          block.start,
          `\`${expression}\` is attacker-controlled and is interpolated directly into a shell block. Pass it through \`env:\` and quote the variable.`,
          'critical'
        );
      }
    }
    if (block.multiline) {
      const first = block.body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .find((l) => !l.startsWith('#'));
      if (!/^set -euo pipefail$/.test(first ?? '')) {
        add(
          'WFS-007',
          block.start,
          'multi-line `run:` block does not begin with `set -euo pipefail`, so a failing command mid-script can be ignored.',
          'medium'
        );
      }
    }
    for (const [offset, line] of block.body.split(/\r?\n/).entries()) {
      // A shell comment is prose, not a command. Without this the rule fires on
      // the comments that forbid the pattern, which is both wrong and the kind
      // of noise that gets a rule switched off.
      if (/^\s*#/.test(line)) continue;
      // Anchoring at end-of-line missed `$(cmd || true)` and `cmd || true; next`
      // — and this repository contained two of the first form. The terminator
      // set now covers the command-substitution and statement-separator cases.
      if (
        /\|\|\s*(true|:)\s*($|[);&|#"'`])/.test(line) &&
        !line.includes('workflow-security-allow: WFS-008')
      ) {
        add(
          'WFS-008',
          block.start + offset,
          '`|| true` discards the exit status of the preceding command.',
          'high'
        );
      }
    }
  }

  // ---- WFS-009: continue-on-error ---------------------------------------
  lines.forEach((line, index) => {
    if (
      /^\s*(?:-\s+)?continue-on-error:\s*true\s*$/.test(line) &&
      !suppressed(lines, index, 'WFS-009')
    ) {
      add(
        'WFS-009',
        index + 1,
        '`continue-on-error: true` converts a real failure into a green result.'
      );
    }
  });

  // ---- WFS-011: a reusable workflow declares exactly one job ------------
  //
  // A caller's `permissions:` are the CEILING for every job in the workflow it
  // calls — including jobs an `if:` will skip. GitHub validates that statically,
  // before any condition is evaluated. So a reusable file holding two jobs with
  // different permission needs cannot be called by anyone: whoever grants the
  // narrower set fails validation with
  //
  //   The nested job 'X' is requesting 'security-events: write',
  //   but is only allowed 'security-events: none'.
  //
  // This repository shipped exactly that and the whole pipeline failed at
  // startup. "Grant the wider set to every caller" makes it start and quietly
  // destroys least privilege; one job per file is the fix that does not.
  if (/^on:\s*$/m.test(source) && /^\s{2}workflow_call:/m.test(source)) {
    const jobsBlockIndex = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    if (jobsBlockIndex !== -1) {
      const declared = [];
      for (let i = jobsBlockIndex + 1; i < lines.length; i += 1) {
        const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
        if (match) declared.push({ name: match[1], line: i + 1 });
      }
      if (declared.length > 1) {
        add(
          'WFS-011',
          declared[1].line,
          `reusable workflow declares ${declared.length} jobs (${declared.map((j) => j.name).join(', ')}). ` +
            'A caller’s permissions are the ceiling for EVERY job here, including ones an `if:` would skip, ' +
            'so a caller granting less than the widest job needs cannot start. Split into one file per job.',
          'critical'
        );
      }
    }
  }

  // ---- WFS-012: a bootstrap sparse checkout must stay in cone mode ------
  //
  // A local `uses: ./…` needs the action present before it can resolve, so every
  // job here bootstraps with a sparse checkout of `.github/actions`. That sparse
  // state has to be undone by the full checkout inside the action — and against
  // a NON-CONE sparse checkout it is not:
  //
  //   `actions/checkout` runs `git sparse-checkout disable` when given no sparse
  //   input. On a non-cone repository that is a no-op — `core.sparseCheckout`
  //   stays true and no file is restored. Verified by replaying both checkouts:
  //   non-cone leaves 1 file in the workspace, cone leaves the whole tree.
  //
  // The visible symptom is `setup-node` reporting "Dependencies lock file is not
  // found", which points at the wrong step entirely. Shipped once, at all 21
  // call sites at once.
  lines.forEach((line, index) => {
    if (!/^\s*sparse-checkout-cone-mode:\s*false\s*$/.test(line)) return;
    if (suppressed(lines, index, 'WFS-012')) return;
    const near = lines.slice(Math.max(0, index - 4), index + 5);
    if (!near.some((l) => /^\s*sparse-checkout:\s*\.github\/actions\s*$/.test(l))) return;
    add(
      'WFS-012',
      index + 1,
      'a bootstrap checkout of `.github/actions` disables cone mode. `git sparse-checkout disable` ' +
        'is a no-op against a non-cone repository, so the full checkout inside the composite action ' +
        'restores nothing and the job runs against a one-file workspace. Remove this line — cone mode is the default.',
      'critical'
    );
  });

  // ---- WFS-010: every job has a timeout ---------------------------------
  const jobsIndex = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsIndex !== -1) {
    for (let i = jobsIndex + 1; i < lines.length; i += 1) {
      const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
      if (!match) continue;
      let hasTimeout = false;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[j])) break;
        if (/^ {4}timeout-minutes:/.test(lines[j])) hasTimeout = true;
        // A job that only calls a reusable workflow cannot set timeout-minutes.
        if (/^ {4}uses:/.test(lines[j])) hasTimeout = true;
      }
      if (!hasTimeout) {
        add(
          'WFS-010',
          i + 1,
          `job \`${match[1]}\` declares no \`timeout-minutes\`; a hung job burns runner minutes until the 6-hour default.`,
          'medium'
        );
      }
    }
  }

  return findings;
}

export function toMarkdown(findings, workflowCount) {
  const lines = ['### Workflow security', ''];
  lines.push(`Scanned **${workflowCount}** workflow file(s).`);
  lines.push('');
  if (!findings.length) {
    lines.push('No findings.');
    return lines.join('\n');
  }
  lines.push('| Severity | Rule | Workflow | Line | Finding |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const f of findings) {
    lines.push(`| ${f.severity} | \`${f.rule}\` | \`${f.workflow}\` | ${f.line} | ${f.message} |`);
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const dir = arg('--dir') ?? '.github/workflows';
  if (!existsSync(dir)) {
    console.error(`workflow directory not found: ${dir}`);
    process.exit(2);
  }

  /** @type {Array<{ path: string, label: string, isCompositeAction: boolean }>} */
  const targets = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ path: join(dir, f), label: f, isCompositeAction: false }));

  // Composite actions were previously exempt from EVERY rule, including SHA
  // pinning — and `setup-project` is the action that performs the exact-SHA
  // checkout the rest of the pipeline depends on. Scanning them is not
  // optional; `--dir` overrides only where the workflows live.
  const actionsRoot = arg('--actions-dir') ?? '.github/actions';
  if (existsSync(actionsRoot)) {
    for (const entry of readdirSync(actionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const candidate of ['action.yml', 'action.yaml']) {
        const full = join(actionsRoot, entry.name, candidate);
        if (existsSync(full)) {
          targets.push({
            path: full,
            label: `${entry.name}/${candidate}`,
            isCompositeAction: true,
          });
        }
      }
    }
  }

  if (targets.length === 0) {
    console.error(`nothing to scan under ${dir} — refusing to report "clean" over an empty set`);
    process.exit(2);
  }
  if (!targets.some((t) => t.isCompositeAction) && existsSync(actionsRoot)) {
    console.error(
      `${actionsRoot} exists but contains no action.yml — a composite action that is never scanned is exempt from every rule here.`
    );
    process.exit(2);
  }

  const findings = [];
  for (const target of targets) {
    findings.push(
      ...lintWorkflow(target.label, readFileSync(target.path, 'utf8'), {
        isCompositeAction: target.isCompositeAction,
      })
    );
  }

  const labels = targets.map((t) => t.label);
  const jsonOut = arg('--json');
  if (jsonOut)
    writeFileSync(jsonOut, `${JSON.stringify({ scanned: labels, findings }, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(findings, targets.length)}\n`);

  console.log(toMarkdown(findings, targets.length));
  const pathFor = new Map(targets.map((t) => [t.label, t.path]));
  for (const f of findings) {
    console.log(
      `::error file=${pathFor.get(f.workflow) ?? f.workflow},line=${f.line}::${f.rule}: ${f.message}`
    );
  }
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
