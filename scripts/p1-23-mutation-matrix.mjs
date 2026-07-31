/**
 * P1-23 hostile mutation matrix (P1-23-QA-005).
 *
 * A passing suite proves that the code and the tests agree. It does NOT prove
 * the tests would notice if the code were wrong — and this phase has already
 * produced a concrete example of the difference: four permission codes were
 * missing from the platform catalog and every denial-based authorization test
 * still passed, because a permission that does not exist cannot be held by
 * anybody.
 *
 * So each mutation below breaks ONE security-relevant property on purpose and
 * asserts that a named test goes RED. A mutation that leaves the suite green is
 * reported as a SURVIVOR: the property has no real guard, whatever the coverage
 * number says.
 *
 * Every mutation is applied to a working copy of the file, the target suite is
 * run, and the original is restored byte-for-byte before the next one — verified
 * by comparing the restored content, not assumed.
 *
 * Run: node scripts/p1-23-mutation-matrix.mjs [--only <id>]
 * Requires a database, like the backend tier itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const NOTIF_SERVICE = 'src/modules/shared-services/application/notification-read-service.ts';
const NOTIF_REPO = 'src/modules/shared-services/data/notification-read-repository.ts';
const DOC_SERVICE = 'src/modules/shared-services/application/document-read-service.ts';
const DOC_REPO = 'src/modules/shared-services/data/document-read-repository.ts';
const RPT_SERVICE = 'src/modules/reporting/application/report-catalogue-service.ts';
const RPT_REPO = 'src/modules/reporting/data/report-catalogue-repository.ts';

const NOTIF_TESTS = 'tests/backend/p1-23-notification-reads.test.ts';
const DOC_TESTS = 'tests/backend/p1-23-document-retention.test.ts';
const RPT_TESTS = 'tests/backend/p1-23-reporting.test.ts';

/**
 * Each entry: the property being attacked, the file, an exact `from` -> `to`
 * edit, and the suite that must go red.
 *
 * `from` must appear EXACTLY ONCE. A mutation that matches zero or several
 * places is reported as a matrix defect, not silently skipped — a mutation that
 * never applied would otherwise be indistinguishable from one that was caught.
 */
const MUTATIONS = [
  {
    id: 'M1',
    property: 'The notification inbox is confined to the calling recipient',
    file: NOTIF_REPO,
    from: 'AND recipient_user_id = $2',
    to: 'AND ($2 IS NOT NULL OR recipient_user_id IS NOT NULL)',
    suite: NOTIF_TESTS,
  },
  {
    id: 'M2',
    property: 'The caller cannot choose whose inbox to read',
    file: NOTIF_SERVICE,
    from: 'this.contextOf(db).principal.userId',
    to: '(input.recipientUserId ?? this.contextOf(db).principal.userId)',
    suite: NOTIF_TESTS,
    optional: true,
  },
  {
    id: 'M3',
    property: 'Tenant isolation on the notification read',
    file: NOTIF_REPO,
    from: 'WHERE tenant_id = $1\n          AND recipient_user_id = $2',
    to: 'WHERE ($1 IS NOT NULL)\n          AND recipient_user_id = $2',
    suite: NOTIF_TESTS,
  },
  {
    id: 'M4',
    property: 'Document reads never project the storage key',
    file: DOC_REPO,
    from: 'SELECT id, category_id, title',
    to: 'SELECT id, category_id, storage_key, title',
    suite: DOC_TESTS,
  },
  {
    id: 'M5',
    property: 'Retention evaluation reports the protected function verbatim',
    file: DOC_SERVICE,
    from: 'eligibility,',
    to: "eligibility: 'eligible' as typeof eligibility,",
    suite: DOC_TESTS,
  },
  {
    id: 'M6',
    property: 'Retention evaluation never claims a deletion happened',
    file: DOC_SERVICE,
    from: 'deletionPerformed: false,',
    to: 'deletionPerformed: true as unknown as false,',
    suite: DOC_TESTS,
  },
  {
    // Reverts the exact defect this phase's own review found: with only
    // `class_undefined` in the set, `policyDecided` is true in every reachable
    // state, because that verdict cannot occur. The mutation must be caught, or
    // the field is decoration.
    id: 'M6b',
    property: 'policyDecided distinguishes "no policy" from "decided to keep"',
    file: DOC_SERVICE,
    from: "'class_undefined',\n  'retention_indefinite',",
    to: "'class_undefined',",
    suite: DOC_TESTS,
  },
  {
    id: 'M7',
    property: 'Only published report definitions are visible',
    file: RPT_REPO,
    from: "AND c.status = 'published'\n          AND c.deleted_at IS NULL`",
    to: "AND c.status IN ('published', 'draft', 'archived')\n          AND c.deleted_at IS NULL`",
    suite: RPT_TESTS,
  },
  {
    id: 'M8',
    property: 'The catalogue does not claim reports are executable',
    file: RPT_SERVICE,
    from: 'executable: false,',
    to: 'executable: true as unknown as false,',
    suite: RPT_TESTS,
  },
];

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

// Resolved to the local binary rather than shelling out through `npx`: passing
// arguments with `shell: true` concatenates instead of escaping them (DEP0190).
const VITEST = join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest'
);

function runSuite(suite) {
  try {
    execFileSync(VITEST, ['run', '--config', 'vitest.config.backend.ts', suite, '--reporter=dot'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return true; // green
  } catch {
    return false; // red
  }
}

const results = [];
for (const m of MUTATIONS) {
  if (only && m.id !== only) continue;
  const path = join(ROOT, m.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(m.from).length - 1;

  if (occurrences !== 1) {
    results.push({
      ...m,
      verdict: occurrences === 0 ? 'NOT-APPLICABLE' : 'AMBIGUOUS',
      detail: `pattern occurs ${occurrences}x`,
    });
    if (m.optional && occurrences === 0) continue;
    continue;
  }

  process.stdout.write(`  ${m.id} ${m.property} ... `);
  writeFileSync(path, original.replace(m.from, m.to), 'utf8');
  let green;
  try {
    green = runSuite(m.suite);
  } finally {
    writeFileSync(path, original, 'utf8');
    const restored = readFileSync(path, 'utf8');
    if (restored !== original) {
      console.error(`\nFATAL: ${m.file} was not restored byte-for-byte. Stopping.`);
      process.exit(2);
    }
  }
  const verdict = green ? 'SURVIVED' : 'CAUGHT';
  console.log(verdict);
  results.push({ ...m, verdict });
}

console.log('\nP1-23 mutation matrix');
console.log('---------------------');
for (const r of results) {
  console.log(`  ${r.id}  ${r.verdict.padEnd(15)}${r.property}${r.detail ? ` (${r.detail})` : ''}`);
}

const survivors = results.filter((r) => r.verdict === 'SURVIVED');
const inapplicable = results.filter((r) => r.verdict !== 'CAUGHT' && r.verdict !== 'SURVIVED');
console.log(
  `\ncaught ${results.filter((r) => r.verdict === 'CAUGHT').length}/${results.length}` +
    `, survived ${survivors.length}, not applied ${inapplicable.length}`
);

if (survivors.length > 0) {
  console.error('\nSURVIVORS — these properties have no guard that fails when they break:');
  for (const s of survivors) console.error(`  ${s.id} ${s.property} (${s.file})`);
  process.exit(1);
}
if (inapplicable.length > 0) {
  console.error('\nNOT APPLIED — the matrix could not attack these, which is not a pass:');
  for (const s of inapplicable) console.error(`  ${s.id} ${s.detail} in ${s.file}`);
  process.exit(1);
}
console.log('every mutation was caught');
