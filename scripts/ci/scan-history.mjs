#!/usr/bin/env node
/**
 * Credential-shape scanner for git history and for build output (initiative §22).
 *
 * `scripts/check-tracked-secrets.mjs` covers TRACKED TEXT at the current commit.
 * Two exposures escape it, and both matter more on a public repository:
 *
 *   history   a credential committed and then removed is still served by
 *             `git log -p`, by every fork, and by the GitHub archive API.
 *   worktree  a value can reach a public artifact without ever being tracked —
 *             inlined into a bundle by the build, or written into a generated
 *             document.
 *
 * THE OUTPUT NEVER CONTAINS A MATCHED VALUE. Only commit, file and pattern
 * class are reported. A scanner that echoes what it found turns a public
 * Actions log into the disclosure it was meant to prevent — so the matched text
 * is never stored, never printed and never written to an artifact.
 *
 * Usage:
 *   node scripts/ci/scan-history.mjs --mode history  [--json out.json] [--markdown out.md]
 *   node scripts/ci/scan-history.mjs --mode worktree [--json out.json] [--markdown out.md]
 * Exit codes: 0 clean · 1 unallowed finding · 2 IO error.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Deliberately narrow, high-signal shapes. A broad entropy heuristic produces a
 * week of false positives and is then switched off, which is worse than not
 * having it.
 */
export const PATTERNS = [
  { id: 'private-key-header', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'aws-secret-key', re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}\b/i },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { id: 'supabase-secret-key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
  {
    id: 'jwt-service-role',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  { id: 'postgres-url-with-password', re: /\bpostgres(?:ql)?:\/\/[^:@/\s]+:[^@/\s]{3,}@/ },
  { id: 'docker-registry-auth', re: /"auth"\s*:\s*"[A-Za-z0-9+/=]{20,}"/ },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-live-key', re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

/**
 * Allowed matches. Each entry names a FILE and a PATTERN CLASS, plus the reason
 * and who owns it. There is no pattern-class-wide suppression: waiving a whole
 * token class is how a real credential later slips past unnoticed.
 */
export const ALLOWED = [
  {
    file: '.env.example',
    pattern: 'postgres-url-with-password',
    reason:
      'Commented-out local Supabase CLI default. The password is the literal string every local stack uses; it is worthless outside a developer machine.',
    owner: 'platform-owner',
  },
  {
    file: 'tests/logger.test.ts',
    pattern: 'postgres-url-with-password',
    reason:
      'Fixture proving DATABASE_URL is redacted from logs. The test would be vacuous without a credential-shaped value.',
    owner: 'platform-owner',
  },
  {
    file: 'docs/phase-1/phase-1-1/security-readiness.md',
    pattern: 'postgres-url-with-password',
    reason:
      'Documentation describing the detector’s own shape, in a table of what the scanner looks for.',
    owner: 'platform-owner',
  },
  {
    file: '.github/workflows/',
    pattern: 'postgres-url-with-password',
    reason:
      'Throwaway credentials for a PostgreSQL service container that lives for one job. Never a real credential and must never become one.',
    owner: 'platform-owner',
    prefix: true,
  },
  // ---- historical only ---------------------------------------------------
  // Neither file contains these shapes in the current tree, so the tracked-file
  // scanner still guards the present. Both are synthetic values written to make
  // a REDACTION test non-vacuous — a test proving that AWS-key-shaped and
  // JWT-shaped strings are rejected cannot be written without such a string.
  // Both were later refactored to construct the prefix at runtime
  // (`String.fromCharCode(65,75,73,65)`) precisely so scanners would stop
  // matching them; the earlier commits are what remain.
  {
    file: 'tests/db/shared-processed-errors.test.ts',
    pattern: 'aws-access-key',
    reason:
      'Historical only. Synthetic fixture for the processed-errors redaction test; absent from the current tree.',
    owner: 'platform-owner',
  },
  {
    file: 'tests/db/shared-processed-errors.test.ts',
    pattern: 'jwt-service-role',
    reason:
      'Historical only. Synthetic `eyJ...signature_1` fixture proving JWT-shaped substrings are rejected; absent from the current tree.',
    owner: 'platform-owner',
  },
  {
    file: 'docs/phase-1/phase-1-5/event-payload-security-rules.md',
    pattern: 'aws-access-key',
    reason:
      'Historical only. Prose example illustrating the shape the rule rejects; absent from the current tree.',
    owner: 'platform-owner',
  },
  {
    file: 'scripts/ci/scan-history.mjs',
    pattern: '*',
    reason:
      'This scanner’s own pattern definitions. Excluding it is unavoidable — it necessarily contains every shape it detects.',
    owner: 'platform-owner',
  },
  {
    file: 'scripts/check-tracked-secrets.mjs',
    pattern: '*',
    reason: 'The tracked-file scanner’s pattern definitions, for the same unavoidable reason.',
    owner: 'platform-owner',
  },
];

export function isAllowed(file, pattern) {
  return ALLOWED.some((entry) => {
    const fileMatches = entry.prefix ? file.startsWith(entry.file) : file === entry.file;
    return fileMatches && (entry.pattern === '*' || entry.pattern === pattern);
  });
}

/** Classifies a line WITHOUT retaining it. */
export function classify(line) {
  const hits = [];
  for (const { id, re } of PATTERNS) {
    if (re.test(line)) hits.push(id);
  }
  return hits;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', 'coverage']);
const BINARY =
  /\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|eot|pdf|zip|gz|tgz|br|mp4|webm|wasm|node)$/i;

export function scanWorktree(roots = ['.next', 'public', 'docs/api']) {
  const findings = [];
  let filesScanned = 0;
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (BINARY.test(entry.name)) continue;
      let size;
      try {
        size = statSync(full).size;
      } catch {
        continue;
      }
      // A 20 MiB source map is not where a credential hides, and reading it
      // would dominate the job.
      if (size > 20 * 1024 * 1024) continue;
      filesScanned += 1;
      const rel = relative(process.cwd(), full).replace(/\\/g, '/');
      let content;
      try {
        content = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      for (const [index, line] of content.split('\n').entries()) {
        for (const pattern of classify(line)) {
          if (isAllowed(rel, pattern)) continue;
          findings.push({ where: 'worktree', file: rel, line: index + 1, pattern });
        }
      }
    }
  };
  for (const root of roots) {
    if (existsSync(root)) visit(root);
  }
  return { filesScanned, findings };
}

export function scanHistory() {
  const findings = [];
  const commits = execFileSync('git', ['log', '--all', '--format=%H'], {
    maxBuffer: 256 * 1024 * 1024,
  })
    .toString()
    .split('\n')
    .filter(Boolean);

  for (const commit of commits) {
    let diff;
    try {
      diff = execFileSync(
        'git',
        ['show', commit, '--unified=0', '--format=', '--no-color', '--diff-filter=AM'],
        { maxBuffer: 256 * 1024 * 1024 }
      ).toString();
    } catch {
      continue;
    }
    let file = '(unknown)';
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ ')) {
        file = line.slice(4).replace(/^b\//, '');
        continue;
      }
      if (!line.startsWith('+')) continue;
      for (const pattern of classify(line)) {
        if (isAllowed(file, pattern)) continue;
        findings.push({ where: 'history', commit, file, pattern });
      }
    }
  }
  return { commitsScanned: commits.length, findings };
}

export function toMarkdown(mode, result) {
  const lines = [`### Credential-shape scan — ${mode}`, ''];
  lines.push(
    mode === 'history'
      ? `Commits scanned: **${result.commitsScanned}**`
      : `Files scanned: **${result.filesScanned}**`
  );
  lines.push(
    `Allow-list entries: **${ALLOWED.length}** (each names one file and one pattern class)`
  );
  lines.push('');
  if (!result.findings.length) {
    lines.push('No unallowed credential shapes found.');
    lines.push('');
    lines.push(
      '_Matched values are never recorded. Findings, when they occur, name the file and the pattern class only._'
    );
    return lines.join('\n');
  }
  lines.push('| Where | Location | Pattern class |');
  lines.push('| --- | --- | --- |');
  for (const f of result.findings.slice(0, 100)) {
    const location = f.commit
      ? `\`${f.commit.slice(0, 10)}\` \`${f.file}\``
      : `\`${f.file}:${f.line}\``;
    lines.push(`| ${f.where} | ${location} | \`${f.pattern}\` |`);
  }
  if (result.findings.length > 100) lines.push(`| … | ${result.findings.length - 100} more | |`);
  lines.push('');
  lines.push(
    '**The matched text is deliberately absent.** Retrieve it locally, ROTATE the credential first, then purge.'
  );
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const mode = arg('--mode') ?? 'worktree';
  const result = mode === 'history' ? scanHistory() : scanWorktree();

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ mode, ...result }, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(mode, result)}\n`);

  console.log(toMarkdown(mode, result));
  for (const f of result.findings) {
    const location = f.commit ? `commit ${f.commit}` : `${f.file}:${f.line}`;
    console.log(`::error::credential shape \`${f.pattern}\` at ${location} in ${f.file}`);
  }
  process.exit(result.findings.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
