/**
 * P1-23 hostile mutation matrix (P1-23-QA-005).
 *
 * A passing suite proves that the code and the tests agree. It does NOT prove
 * the tests would notice if the code were wrong — this phase produced the
 * counter-example: four permission codes were missing from the platform catalog
 * and every denial-based authorization test still passed, because a permission
 * that does not exist cannot be held by anybody.
 *
 * So each mutation below breaks ONE security-relevant property on purpose and
 * asserts that a named suite goes RED **because an assertion failed**.
 *
 * ## Why "the suite went red" is not enough, and what changed
 *
 * The first version of this script scored a mutation CAUGHT whenever vitest
 * exited non-zero. An independent review then showed that FIVE of its nine
 * mutations were STILLBORN — they did not produce working code that behaves
 * wrongly, they produced code that cannot run:
 *
 *   - one rewrote a predicate so PostgreSQL could not infer a parameter type and
 *     every query died with SQLSTATE 42P18 in parse analysis;
 *   - one selected a column (`storage_key`) that does not exist on
 *     `shared.documents` at all, dying with SQLSTATE 42703;
 *   - one referenced an identifier (`input`) that is not bound in the file, so
 *     the mutant threw a ReferenceError — and it patched the audit line of
 *     `readDeliveries` rather than the inbox query whose property it named.
 *
 * Each was reported CAUGHT. None of them tested the property in its title. The
 * matrix was reporting 9/9 while measuring, in part, that broken SQL fails.
 *
 * Two changes fix that, and both are load-bearing:
 *
 *   1. **A BASELINE run.** Every target suite must be GREEN before anything is
 *      mutated. Without it, a suite that is already failing scores every
 *      mutation against it as caught.
 *   2. **The failure must be an ASSERTION.** The mutant run's output is
 *      inspected: it must contain a vitest assertion failure, and it must NOT
 *      contain a crash signature (a SQLSTATE, a ReferenceError, a TypeError, a
 *      transform error). A red run for any other reason is reported STILLBORN
 *      and FAILS the matrix, because a mutation that cannot run proves nothing.
 *
 * Every mutation is applied to a working copy, the target suite is run, and the
 * original is restored byte-for-byte before the next one — verified by comparing
 * content, not assumed.
 *
 * Run: node scripts/p1-23-mutation-matrix.mjs [--only <id>]
 * Requires a database, like the backend tier itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { API_SRC_PATH } from './lib/repository-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const NOTIF_SERVICE = `${API_SRC_PATH}/modules/shared-services/application/notification-read-service.ts`;
const NOTIF_REPO = `${API_SRC_PATH}/modules/shared-services/data/notification-read-repository.ts`;
const DOC_SERVICE = `${API_SRC_PATH}/modules/shared-services/application/document-read-service.ts`;
const DOC_REPO = `${API_SRC_PATH}/modules/shared-services/data/document-read-repository.ts`;
const RPT_SERVICE = `${API_SRC_PATH}/modules/reporting/application/report-catalogue-service.ts`;
const RPT_REPO = `${API_SRC_PATH}/modules/reporting/data/report-catalogue-repository.ts`;

const NOTIF_TESTS = 'tests/backend/p1-23-notification-reads.test.ts';
const DOC_TESTS = 'tests/backend/p1-23-document-retention.test.ts';
const RPT_TESTS = 'tests/backend/p1-23-reporting.test.ts';

/**
 * Each entry: the property attacked, the file, an exact `from` -> `to` edit, and
 * the suite that must go red WITH AN ASSERTION FAILURE.
 *
 * `from` must appear EXACTLY ONCE. A mutation matching zero or several places is
 * a matrix defect and fails the run — a mutation that never applied is otherwise
 * indistinguishable from one that was caught.
 *
 * Every `to` below must be code that COMPILES AND RUNS. The point is a mutant
 * that behaves wrongly, not one that cannot execute. Casts like `$2::uuid` are
 * there so PostgreSQL can still infer parameter types once a predicate is
 * dropped — without them the statement fails in parse analysis and proves
 * nothing about the guard.
 */
const MUTATIONS = [
  {
    id: 'M1',
    property: 'The notification inbox is confined to the calling recipient',
    file: NOTIF_REPO,
    // Keeps $2 bound and typed, so the query still plans and runs; only the
    // confinement is gone.
    from: 'AND recipient_user_id = $2',
    to: 'AND ($2::uuid IS NOT NULL OR recipient_user_id IS NULL)',
    suite: NOTIF_TESTS,
  },
  {
    id: 'M2',
    property: 'The inbox recipient comes from the request context, never from elsewhere',
    file: NOTIF_SERVICE,
    // Targets listMine itself. A fixed uuid is valid TypeScript and a valid
    // parameter, so the query runs and simply reads the wrong inbox.
    from: `    const page = await this.repository.listForRecipient(
      db,
      context.principal.userId,`,
    to: `    const page = await this.repository.listForRecipient(
      db,
      '00000000-0000-4000-8000-0000000000ff',`,
    suite: NOTIF_TESTS,
  },
  {
    id: 'M3',
    property: 'The delivery-attempt read is confined to the addressed message',
    file: NOTIF_REPO,
    // Drops the message confinement while keeping the parameter typed, so the
    // query still plans: an operator inspecting one message would be shown every
    // message's attempts.
    //
    // THIS ENTRY REPLACED A TENANT-ISOLATION MUTATION THAT SURVIVED. Removing the
    // code-side `tenant_id` predicate failed no test, because the RLS policy
    // (`USING (tenant_id = iam.current_tenant_id())`) blocks the foreign row
    // first — so no assertion reachable through the service can observe the
    // application-layer predicate independently. That predicate is DEFENCE IN
    // DEPTH and stays, but a mutation that can only ever survive is not evidence,
    // and pretending otherwise is what this matrix exists to prevent. The
    // limitation is recorded in the gate record instead of dressed up as coverage.
    from: 'WHERE tenant_id = $1 AND message_id = $2',
    to: 'WHERE tenant_id = $1 AND ($2::uuid IS NOT NULL)',
    suite: NOTIF_TESTS,
  },
  {
    id: 'M4',
    property: 'The document read projects exactly the approved field set',
    file: DOC_REPO,
    // `deleted_at` EXISTS on shared.documents, so this widens a real projection
    // rather than dying on an unknown column.
    from: 'SELECT id, category_id, title',
    to: 'SELECT deleted_at, id, category_id, title',
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
    id: 'M6b',
    property: 'policyDecided distinguishes "no policy" from "decided to keep"',
    file: DOC_SERVICE,
    from: "'class_undefined',\n  'retention_indefinite',",
    to: "'class_undefined',",
    suite: DOC_TESTS,
  },
  {
    id: 'M7',
    property: 'Only published report definitions appear in the CATALOGUE listing',
    file: RPT_REPO,
    // The paginated list, not findPublishedByCode — the keyset fragment that
    // follows is what distinguishes the two call sites.
    from: "AND c.status = 'published'\n          AND c.deleted_at IS NULL\n          ${keyset.predicate}",
    to: "AND c.status IN ('published', 'draft', 'archived')\n          AND c.deleted_at IS NULL\n          ${keyset.predicate}",
    suite: RPT_TESTS,
  },
  {
    id: 'M7b',
    property: 'Only published report definitions are readable BY CODE',
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

/**
 * vitest's JS entrypoint, run under this same Node — NOT `node_modules/.bin`.
 *
 * Three approaches were tried and two were wrong:
 *
 *   - `npx vitest` with `shell: true` works, but passing arguments through a
 *     shell concatenates rather than escapes them (Node DEP0190).
 *   - `node_modules/.bin/vitest.cmd` with `execFileSync` and no shell throws
 *     **EINVAL** on Windows under Node 24: since the CVE-2024-27980 mitigation,
 *     a `.cmd` cannot be executed without a shell. That failure mode is the
 *     reason this file's verdicts were worthless for one revision — every run
 *     threw before vitest started, the old `catch { return false }` read the
 *     throw as "the suite went red", and the matrix reported 9/9 CAUGHT while
 *     running no tests at all. The baseline check above is what surfaced it.
 *   - Running `vitest.mjs` with `process.execPath` invokes the same interpreter
 *     with real argv, no shell, and no platform-specific launcher. That is what
 *     is used.
 */
const VITEST_ENTRY = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/**
 * Runs one suite and reports HOW it ended, not merely whether it exited zero.
 *
 * `status` is one of:
 *   'green'      — exit 0
 *   'assertion'  — red, and the output carries a vitest assertion failure
 *   'crash'      — red for some other reason (SQLSTATE, ReferenceError, ...)
 */
function runSuite(suite) {
  try {
    execFileSync(
      process.execPath,
      [VITEST_ENTRY, 'run', '--config', 'vitest.config.backend.ts', suite, '--reporter=dot'],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }
    );
    return { status: 'green', evidence: '' };
  } catch (error) {
    // A launcher failure is not a test result. Without this, "could not start
    // vitest" is indistinguishable from "the suite went red".
    if (error.status === null || error.status === undefined) {
      return { status: 'crash', evidence: `runner failed to start: ${error.code ?? 'unknown'}` };
    }
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    // A crash signature outranks an assertion signature: if the mutant could not
    // execute, any assertion text present is incidental.
    const crash =
      /\b(42P18|42703|42601|42883|22P02)\b/.exec(output) ??
      /\b(ReferenceError|TypeError|SyntaxError|Transform failed|is not defined|is not a function)\b/.exec(
        output
      );
    if (crash) return { status: 'crash', evidence: crash[0] };
    const assertion = /AssertionError|expected .* to |toEqual|toBe\(/.exec(output);
    if (assertion) return { status: 'assertion', evidence: assertion[0].slice(0, 60) };
    return { status: 'crash', evidence: 'red with no assertion signature' };
  }
}

const selected = MUTATIONS.filter((m) => !only || m.id === only);

// ---------------------------------------------------------------------------
// BASELINE. Every target suite must be green before anything is mutated.
// Without this, a suite that is already failing scores every mutation against it
// as caught.
// ---------------------------------------------------------------------------
const suites = [...new Set(selected.map((m) => m.suite))];
console.log('Baseline (unmutated) runs:');
for (const suite of suites) {
  process.stdout.write(`  ${suite} ... `);
  const baseline = runSuite(suite);
  console.log(baseline.status);
  if (baseline.status !== 'green') {
    console.error(
      `\nFATAL: ${suite} is not green before mutation (${baseline.status}: ${baseline.evidence}).` +
        '\nEvery mutation scored against it would be meaningless. Stopping.'
    );
    process.exit(2);
  }
}
console.log();

const results = [];
for (const m of selected) {
  const path = join(ROOT, m.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(m.from).length - 1;

  if (occurrences !== 1) {
    results.push({
      ...m,
      verdict: occurrences === 0 ? 'NOT-APPLICABLE' : 'AMBIGUOUS',
      detail: `pattern occurs ${occurrences}x`,
    });
    continue;
  }

  process.stdout.write(`  ${m.id} ${m.property} ... `);
  writeFileSync(path, original.replace(m.from, m.to), 'utf8');
  let outcome;
  try {
    outcome = runSuite(m.suite);
  } finally {
    writeFileSync(path, original, 'utf8');
    if (readFileSync(path, 'utf8') !== original) {
      console.error(`\nFATAL: ${m.file} was not restored byte-for-byte. Stopping.`);
      process.exit(2);
    }
  }

  const verdict =
    outcome.status === 'green'
      ? 'SURVIVED'
      : outcome.status === 'assertion'
        ? 'CAUGHT'
        : 'STILLBORN';
  console.log(verdict + (verdict === 'STILLBORN' ? ` (${outcome.evidence})` : ''));
  results.push({ ...m, verdict, detail: outcome.evidence });
}

console.log('\nP1-23 mutation matrix');
console.log('---------------------');
for (const r of results) {
  console.log(
    `  ${r.id.padEnd(4)}${r.verdict.padEnd(15)}${r.property}${r.detail ? ` [${r.detail}]` : ''}`
  );
}

const caught = results.filter((r) => r.verdict === 'CAUGHT');
const survivors = results.filter((r) => r.verdict === 'SURVIVED');
const stillborn = results.filter((r) => r.verdict === 'STILLBORN');
const unapplied = results.filter(
  (r) => r.verdict === 'NOT-APPLICABLE' || r.verdict === 'AMBIGUOUS'
);

console.log(
  `\ncaught ${caught.length}/${results.length}, survived ${survivors.length}, ` +
    `stillborn ${stillborn.length}, not applied ${unapplied.length}`
);

if (survivors.length > 0) {
  console.error('\nSURVIVORS — these properties have no guard that fails when they break:');
  for (const s of survivors) console.error(`  ${s.id} ${s.property} (${s.file})`);
}
if (stillborn.length > 0) {
  console.error(
    '\nSTILLBORN — the mutant could not run, so it tested nothing. A mutation must produce' +
      '\nworking code that behaves wrongly, not code that crashes:'
  );
  for (const s of stillborn) console.error(`  ${s.id} ${s.property} [${s.detail}]`);
}
if (unapplied.length > 0) {
  console.error('\nNOT APPLIED — the matrix could not attack these, which is not a pass:');
  for (const s of unapplied) console.error(`  ${s.id} ${s.detail} in ${s.file}`);
}

if (survivors.length || stillborn.length || unapplied.length) process.exit(1);
console.log('every mutation ran, behaved wrongly, and was caught by a failing assertion');
