#!/usr/bin/env node
/**
 * No-fake-data guard (RootLco permanent data policy).
 *
 * The product must ship and start with NO fabricated business data. This static
 * guard scans tracked files for indicators of demo/mock/sample/fake/fabricated
 * business records that would be shipped or auto-inserted by the application.
 *
 * It is deliberately PRECISE (phrases, not bare words) so it never rejects
 * legitimate test code, policy prose, or migration comments that explain the
 * prohibition. Ephemeral automated-test data lives under tests/ and is allowed;
 * documentation may discuss the rule freely.
 *
 * The companion DB check (tests/db/no-fake-data.test.ts) proves the migration
 * layer creates zero business rows. Fails closed: an unreadable tracked file is
 * skipped only for binary content, never to hide a match.
 *
 * Dependency-free (node: builtins only) — no `npm ci` needed to run it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fabricated-business-data indicators. Each targets a noun phrase, not a bare
// word, so "sample" in "sample rate" or "mock" in a test helper name is ignored.
const PATTERNS = [
  { name: 'Faker library', re: /\bfaker\b/i },
  {
    name: 'demo mode / demo data',
    re: /\bdemo[\s_-]?(mode|data|content|records?|seed|tenant|customers?)\b/i,
  },
  {
    name: 'fabricated business record',
    re: /\b(sample|mock|fake|fictional|fictitious|dummy)\s+(customers?|vehicles?|companies|company|tenants?|invoices?|work[\s_-]?orders?|employees?|suppliers?|partners?|users?|documents?|messages?|records?|business\s+data)\b/i,
  },
  {
    name: 'shipped mock API',
    re: /\bmock(ed)?\s+(api|apis|response|responses|repositor(y|ies)|endpoints?)\b/i,
  },
];

// EXACT paths / path-prefixes where these indicators are legitimate. Widening
// this list is a visible, reviewable act.
const ALLOW = [
  'docs/', // policy + governance prose (this rule is discussed here)
  'tests/', // ephemeral, rolled-back / cleaned automated-test data
  'scripts/check-scope-exclusions.mjs', // sibling guard prose
  'supabase/seed.sql', // binding prohibitory seed prose
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  '.github/pull_request_template.md',
  'supabase/config.toml', // seed sql_paths filenames only
];

// PENDING OWNER DECISION under the no-fake-data policy: the two pre-existing
// merged Phase 1-3/1-4 pilot-provisioning seed packages create business rows on
// `supabase db reset` and are depended on by merged tests. They stay allow-listed
// until the owner either converts them to ephemeral test-only provisioning or
// records a documented exception (docs/database/no-fake-data-standard.md §5).
//
// They are identified by their UNIQUE numeric seed prefixes, deliberately NOT by
// their full filenames: the pilot tenant's name is data, never code (ADR-008),
// so this guard's own configuration must not spell it either — the sibling
// scope-exclusion guard scans every tracked file, including this one. Same
// rationale as the runtime-assembled name in check-browser-exposed-secrets.mjs.
// The uniqueness assertion below binds each prefix to EXACTLY one tracked file,
// so this is narrower than a directory allow-list, never wider.
const PENDING_SEED_PREFIXES = ['supabase/seeds/02_', 'supabase/seeds/03_'];

// This guard's own source necessarily contains the phrases it hunts (pattern
// definitions, error text), so it must never scan itself. The path is derived
// from the running module at runtime — structural self-exclusion, not a
// configuration literal that another guard could mistake for repository content.
const SELF = relative(process.cwd(), fileURLToPath(import.meta.url)).replaceAll('\\', '/');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

// Fail closed: each pending-seed prefix must identify exactly one tracked file.
// More than one means the prefix silently widened (someone added a file under
// it); zero means the seed is gone and the stale entry must be removed here.
for (const prefix of PENDING_SEED_PREFIXES) {
  const matched = files.filter((f) => f.startsWith(prefix));
  if (matched.length !== 1) {
    console.error(
      `FAIL no-fake-data: pending-seed prefix '${prefix}' must match exactly one tracked file, found ${matched.length} (${matched.join(', ') || 'none'}). Update PENDING_SEED_PREFIXES.`
    );
    process.exit(1);
  }
}

const violations = [];
for (const file of files) {
  if (file === SELF) continue; // structural self-exclusion (see above)
  if (ALLOW.some((a) => file === a || file.startsWith(a))) continue;
  if (PENDING_SEED_PREFIXES.some((p) => file.startsWith(p))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // binary/unreadable-as-text: patterns target text
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) violations.push(`${file}:${i + 1} [${p.name}]`);
    }
  });
}

if (violations.length) {
  console.error(
    `FAIL no-fake-data: ${violations.length} fabricated-business-data indicator(s) outside the allow-list:`
  );
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    'The application ships and starts with NO fake/demo/mock/sample business data. Use ephemeral test data (tests/) or approved structural reference only. See docs/database/no-fake-data-standard.md.'
  );
  process.exit(1);
}
console.log(
  `OK no-fake-data: no fabricated-business-data indicators (${files.length} tracked files)`
);
process.exit(0);
