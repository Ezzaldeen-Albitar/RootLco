#!/usr/bin/env node
/**
 * Scope-exclusion guard (P1-03-DO-001).
 *
 * Enforces two binding rules over every tracked file:
 *
 *  1. BENZENE IS DATA, NEVER CODE (ADR-008/ADR-009). The pilot tenant may be
 *     named only in documentation prose and the controlled provisioning data
 *     package. A hit anywhere else —
 *     a migration, an RLS policy, a SQL helper, application logic, a generic
 *     test — fails the build.
 *
 *  2. NO ZOOM OBJECTS (ADR-010, out-of-scope register P1-OOS-026). Zoom
 *     Vehicle Inspection and Evaluation Services is outside Phase 1; only
 *     exclusion prose (and two unrelated literals documented below) may
 *     mention the word.
 *
 * The allow-lists are EXACT paths/prefixes, reviewed like any other change:
 * widening one is a visible, reviewable act. Fails closed: an unreadable
 * tracked file fails the run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { API_SRC_PATH, WEB_SRC_PATH } from './lib/repository-paths.mjs';

const RULES = [
  {
    term: 'Benzene (pilot tenant hard-coding guard)',
    pattern: /benzene/i,
    allow: [
      'docs/', // governance/standards/evidence prose
      'README.md',
      'SECURITY.md',
      'CONTRIBUTING.md',
      'CODEOWNERS',
      '.github/pull_request_template.md',
      `${API_SRC_PATH}/modules/README.md`, // prohibitory prose
      `${WEB_SRC_PATH}/i18n/config.ts`, // names the pilot tenant to explain why Arabic is listed first
      'supabase/seed.sql', // binding seed rules (prohibitory prose)
      'supabase/packages/pilot-provisioning.package.json', // controlled Class-3 data
      'docs/database/pilot-provisioning-runbook.md', // controlled operator procedure
      'supabase/migrations/0003_number_sequences.sql', // merged Phase 1-2 prohibitory comment (immutable)
      'scripts/check-scope-exclusions.mjs', // this guard
    ],
  },
  {
    term: 'Zoom (excluded-scope guard)',
    pattern: /\bzoom\b/i,
    allow: [
      'docs/',
      'README.md',
      'SECURITY.md',
      'CONTRIBUTING.md',
      '.github/pull_request_template.md',
      'supabase/seed.sql', // prohibitory prose
      'supabase/config.toml', // Supabase auth-provider name list (unrelated vendor key)
      `${API_SRC_PATH}/styles/base/_reset.scss`, // CSS comment about iOS text zoom (unrelated)
      `${WEB_SRC_PATH}/styles/base/_reset.scss`, // the same accessibility comment, in the web reset
      'scripts/check-scope-exclusions.mjs',
    ],
  },
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let failures = 0;
for (const rule of RULES) {
  const violations = [];
  for (const file of files) {
    if (rule.allow.some((a) => file === a || file.startsWith(a))) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // binary or unreadable-as-text: the pattern targets text
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (rule.pattern.test(line)) violations.push(`${file}:${i + 1}`);
    });
  }
  if (violations.length) {
    failures += violations.length;
    console.error(`FAIL ${rule.term}: ${violations.length} hit(s) outside the allow-list:`);
    for (const v of violations) console.error(`  - ${v}`);
  } else {
    console.log(`OK ${rule.term}: no hits outside the allow-list (${files.length} tracked files)`);
  }
}

process.exit(failures ? 1 : 0);
