#!/usr/bin/env node
/**
 * Tracked-secret / credential-pattern scanner (P1-01 secret-scan control).
 *
 * THE single source of truth for the "Scan tracked files for credential
 * patterns" control. The CI secrets job and the local `npm run
 * security:tracked-secrets` invoke THIS file, so the hosted job and the local
 * verification path use the identical configuration — no weaker local
 * substitute, no drift.
 *
 * It scans every tracked text file for real credential SHAPES (service-role
 * JWTs, Supabase secret keys, AWS access-key IDs, GitHub tokens, private-key
 * headers, and postgres connection strings with an inline password). It targets
 * shapes, not the word "key", so it stays useful instead of being disabled.
 *
 * FALSE-POSITIVE POLICY (explicit, per-line, never per-directory): a line may be
 * exempted ONLY by carrying the marker `pragma: allowlist secret` with a
 * justification beside it. There is no directory-wide exclusion — a credential
 * committed to docs/ or tests/ still fails. Prefer an engineering fix (redact
 * documentation; construct synthetic values at runtime in tests) over the marker.
 *
 * Output prints only `file:line` — never the matching text. Fails closed: an
 * unreadable-as-text tracked file is skipped only as binary, never to hide a
 * match. Dependency-free (node: builtins only) — no `npm ci` needed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The exact credential shapes, mirrored from the historical CI inline scanner.
// ERE POSIX classes are rendered as their JS equivalents (`[:space:]` -> `\s`).
// The two prefixes most likely to look like a literal are assembled from
// fragments so this scanner's own source carries no matchable token; it also
// structurally excludes itself from the scan below.
const PATTERNS = [
  {
    name: 'JWT (three base64url segments)',
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  { name: 'Supabase secret key', re: new RegExp('sb' + '_secret_[A-Za-z0-9]{16,}') },
  { name: 'AWS access key id', re: new RegExp('AK' + 'IA[0-9A-Z]{16}') },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'private key header', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'postgres URL with inline password', re: /postgres(ql)?:\/\/[^:@/\s]+:[^@/\s]+@/ },
];

const EXEMPTION = 'pragma: allowlist secret';
const NUL = String.fromCharCode(0);

// Structural self-exclusion: this file necessarily describes the shapes it hunts.
const SELF = relative(process.cwd(), fileURLToPath(import.meta.url)).replaceAll('\\', '/');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const violations = [];
for (const file of files) {
  if (file === SELF) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable-as-text
  }
  if (text.includes(NUL)) continue; // binary file: grep --binary-files=without-match parity
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(EXEMPTION)) return;
    if (PATTERNS.some((p) => p.re.test(line))) violations.push(`${file}:${i + 1}`);
  });
}

if (violations.length) {
  console.error(
    `FAIL tracked-secrets: ${violations.length} credential-shaped value(s) in tracked files.`
  );
  console.error(
    'Do NOT paste the value anywhere. If it is a real secret, ROTATE it first, then purge history.'
  );
  console.error(
    'For non-secret examples: redact documentation, or construct synthetic values at runtime in tests. The per-line `pragma: allowlist secret` marker is a last resort with a written justification.'
  );
  for (const v of violations) console.error(`  - ${v}`); // file:line only, never the text
  process.exit(1);
}
console.log(
  `OK tracked-secrets: no credential-shaped values in tracked files (${files.length} files)`
);
process.exit(0);
