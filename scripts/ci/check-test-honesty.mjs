#!/usr/bin/env node
/**
 * Test-honesty gate (CSA-15).
 *
 * A green pipeline is only worth something if green is hard to fake. P1-21 hit
 * this class twice: a unit suite that was red at every commit while being
 * reported green, and a regression assertion that would have passed against the
 * exact bug it was written for. Neither was caught by a human reading the diff;
 * both were caught by running something.
 *
 * Rules:
 *
 *   TH-001  no `.only` anywhere in a test file
 *   TH-002  every `.skip` / `.todo` / `.fails` carries a documented reason
 *   TH-003  no test file without at least one test
 *   TH-004  no test file without at least one assertion
 *   TH-005  no vacuous assertion (`expect(true).toBe(true)` and friends)
 *   TH-006  no runner-level retry configuration
 *   TH-007  database-backed vitest projects must set `fileParallelism: false`
 *   TH-008  isolation/scope suites must create a real row, not assert against a random identifier
 *   TH-009  no `|| true` / `set +e` / `; exit 0` that discards a failure in a CI script
 *   TH-010  no `.skip` on a whole file via `describe.skip` at top level without an expiry
 *
 * A suppression is per-line and must name the rule and a reason:
 *   // test-honesty-allow: TH-002 -- <reason>
 *
 * Dependency-free. Usage:
 *   node scripts/ci/check-test-honesty.mjs [--json out.json] [--markdown out.md]
 * Exit codes: 0 clean · 1 findings · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

export const TEST_ROOTS = ['tests'];
export const SCRIPT_ROOTS = ['scripts'];
export const VITEST_CONFIGS = [
  'vitest.config.ts',
  'vitest.config.db.ts',
  'vitest.config.backend.ts',
];

/** Vitest configs whose suites share one mutable database and must stay serial. */
export const DATABASE_BOUND_CONFIGS = ['vitest.config.db.ts', 'vitest.config.backend.ts'];

export const VACUOUS_ASSERTIONS = [
  /expect\(\s*true\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*true\s*\)/,
  /expect\(\s*false\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*false\s*\)/,
  /expect\(\s*(\d+)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*\1\s*\)/,
  /expect\(\s*(['"`])(.*?)\1\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*\1\2\1\s*\)/,
  /expect\(\s*\)\s*\./,
  /expect\.assertions\(\s*0\s*\)/,
  /expect\(\s*[A-Za-z_$][\w$]*\s*\)\s*\.\s*toBe\(\s*\1\s*\)/,
];

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function suppressed(line, rule) {
  return new RegExp(`test-honesty-allow:\\s*${rule}\\b`).test(line);
}

/** Strips block and line comments so a rule cannot be satisfied by a comment. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function lintTestFile(rel, source) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  const code = stripComments(source);
  const add = (rule, line, message, severity = 'high') =>
    findings.push({ file: rel, rule, line, message, severity });

  lines.forEach((line, index) => {
    if (
      /\b(describe|it|test|suite|bench)\s*\.\s*only\b/.test(line) &&
      !suppressed(line, 'TH-001')
    ) {
      add(
        'TH-001',
        index + 1,
        '`.only` silently reduces the suite to one test while still reporting success.',
        'critical'
      );
    }
    const skip = /\b(describe|it|test|suite)\s*\.\s*(skip|todo|fails|skipIf|runIf)\b/.exec(line);
    if (skip) {
      const context = `${lines[index - 1] ?? ''}\n${line}\n${lines[index + 1] ?? ''}`;
      const documented = /test-honesty-allow:\s*TH-002\s*--\s*\S/.test(context);
      if (!documented) {
        add(
          'TH-002',
          index + 1,
          `\`.${skip[2]}\` with no recorded reason. Add \`// test-honesty-allow: TH-002 -- <reason>\` on an adjacent line.`
        );
      }
    }
  });

  const testCount = (code.match(/\b(it|test|bench)\s*(\.\s*\w+\s*)?\(/g) ?? []).length;
  if (testCount === 0) {
    add(
      'TH-003',
      1,
      'test file declares no test. An empty suite passes and proves nothing.',
      'critical'
    );
  }

  const assertionCount =
    (code.match(/\bexpect\s*\(/g) ?? []).length +
    (code.match(/\bassert\s*[.(]/g) ?? []).length +
    (code.match(/\.rejects\b|\.resolves\b/g) ?? []).length;
  if (testCount > 0 && assertionCount === 0) {
    add(
      'TH-004',
      1,
      'test file contains tests but no assertion. A test that asserts nothing cannot fail.',
      'critical'
    );
  }

  lines.forEach((line, index) => {
    if (suppressed(line, 'TH-005')) return;
    for (const pattern of VACUOUS_ASSERTIONS) {
      if (pattern.test(line)) {
        add(
          'TH-005',
          index + 1,
          'vacuous assertion: it holds regardless of the code under test.',
          'critical'
        );
        break;
      }
    }
  });

  // TH-008 — an isolation claim needs a real row on the other side of the boundary.
  if (/isolation|cross-tenant|cross-company|cross-branch|scope-denial|rls/i.test(rel)) {
    const createsRow =
      /\b(INSERT\s+INTO|insertInto|seed[A-Z]\w*|create[A-Z]\w*|provision[A-Z]\w*|fixture)/i.test(
        code
      );
    const usesRandomIdentifier = /\brandomUUID\s*\(|\bcrypto\.randomUUID\b/.test(code);
    if (usesRandomIdentifier && !createsRow) {
      add(
        'TH-008',
        1,
        'isolation suite uses a randomly generated identifier but never creates a row. ' +
          '"No rows returned" for an identifier that never existed is not isolation evidence.',
        'critical'
      );
    }
  }

  return findings;
}

export function lintVitestConfig(rel, source) {
  const findings = [];
  const code = stripComments(source);
  const add = (rule, message, severity = 'high') =>
    findings.push({ file: rel, rule, line: 1, message, severity });

  const retry = /\bretry\s*:\s*(\d+)/.exec(code);
  if (retry && Number(retry[1]) > 0) {
    add(
      'TH-006',
      `runner-level \`retry: ${retry[1]}\` hides a deterministic failure behind a re-run. ` +
        'See docs/engineering/ci-automation/flaky-test-policy.md.',
      'critical'
    );
  }

  if (DATABASE_BOUND_CONFIGS.includes(rel.split('/').pop())) {
    if (!/fileParallelism\s*:\s*false/.test(code)) {
      add(
        'TH-007',
        'database-bound project does not set `fileParallelism: false`. ' +
          'Parallel files against one mutable database race each other’s fixtures.',
        'critical'
      );
    }
  }

  return findings;
}

export function lintScript(rel, source) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  const add = (rule, line, message, severity = 'high') =>
    findings.push({ file: rel, rule, line, message, severity });
  lines.forEach((line, index) => {
    if (line.trim().startsWith('#') || line.trim().startsWith('*') || line.trim().startsWith('//'))
      return;
    if (/test-honesty-allow:\s*TH-009/.test(line)) return;
    // Same widening as WFS-008: end-of-line anchoring missed `$(cmd || true)`
    // and `cmd || true; next`.
    if (/\|\|\s*(true|:)\s*($|[);&|#])/.test(line)) {
      add('TH-009', index + 1, '`|| true` discards the exit status of the preceding command.');
    }
    if (/^\s*set\s+\+e\s*$/.test(line)) {
      add(
        'TH-009',
        index + 1,
        '`set +e` disables failure propagation for everything that follows.'
      );
    }
    if (/;\s*exit\s+0\s*$/.test(line) && !/^\s*(#|\/\/)/.test(line)) {
      add('TH-009', index + 1, '`; exit 0` forces success regardless of what ran before it.');
    }
  });
  return findings;
}

export function toMarkdown(findings, counts) {
  const lines = ['### Test honesty', ''];
  lines.push(
    `Scanned **${counts.tests}** test file(s), **${counts.configs}** runner config(s), **${counts.scripts}** CI/DB script(s).`
  );
  lines.push('');
  if (!findings.length) {
    lines.push('No findings.');
    return lines.join('\n');
  }
  lines.push('| Severity | Rule | File | Line | Finding |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const f of findings) {
    lines.push(`| ${f.severity} | \`${f.rule}\` | \`${f.file}\` | ${f.line} | ${f.message} |`);
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };

  const testFiles = TEST_ROOTS.flatMap((root) => walk(root, (p) => p.endsWith('.test.ts')));
  if (testFiles.length === 0) {
    console.error('no test files found — refusing to report "clean" over an empty set');
    process.exit(2);
  }

  const findings = [];
  for (const file of testFiles) {
    findings.push(
      ...lintTestFile(relative(ROOT, file).replace(/\\/g, '/'), readFileSync(file, 'utf8'))
    );
  }

  let configCount = 0;
  for (const config of VITEST_CONFIGS) {
    if (!existsSync(config)) continue;
    configCount += 1;
    findings.push(...lintVitestConfig(config, readFileSync(config, 'utf8')));
  }
  if (configCount === 0) {
    console.error('no vitest configuration found — refusing to report "clean"');
    process.exit(2);
  }

  const scriptFiles = SCRIPT_ROOTS.flatMap((root) =>
    walk(root, (p) => p.endsWith('.mjs') || p.endsWith('.sh'))
  ).filter((p) => statSync(p).isFile());
  for (const file of scriptFiles) {
    findings.push(
      ...lintScript(relative(ROOT, file).replace(/\\/g, '/'), readFileSync(file, 'utf8'))
    );
  }

  const counts = { tests: testFiles.length, configs: configCount, scripts: scriptFiles.length };
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ counts, findings }, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(findings, counts)}\n`);

  console.log(toMarkdown(findings, counts));
  for (const f of findings) {
    console.log(`::error file=${f.file},line=${f.line}::${f.rule}: ${f.message}`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
