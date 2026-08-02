/**
 * P1-24 hostile mutation matrix (P1-24-QA-005, P1-24-SEC-003).
 *
 * A passing suite proves that the code and the tests agree. It does NOT prove the
 * tests would notice if the code were wrong — and P1-24 produced the counter-example
 * itself: thirty-nine operations had passing coverage while nothing asserted that a
 * caller lacking their permission is refused.
 *
 * So each mutation below breaks ONE property this phase added or repaired, and asserts
 * that a named suite goes RED **because an assertion failed**.
 *
 * ## The harness is P1-23's, deliberately unchanged
 *
 * `runSuite` and the baseline/restore discipline are lifted from
 * `scripts/p1-23-mutation-matrix.mjs` without modification, including the three things
 * that revision had to learn the hard way:
 *
 *   1. **Every target suite must be GREEN before anything is mutated.** Without it, a
 *      suite that is already failing scores every mutation against it as caught.
 *   2. **The failure must be an ASSERTION.** A crash signature outranks an assertion
 *      signature: a mutant that cannot execute proves nothing, and is reported
 *      STILLBORN rather than counted.
 *   3. **vitest is launched as `process.execPath node_modules/vitest/vitest.mjs`.**
 *      `execFileSync` on the `.cmd` shim throws EINVAL on Windows under Node 24 since
 *      the CVE-2024-27980 mitigation — which is how a previous revision reported 9/9
 *      CAUGHT while running no tests at all.
 *
 * ## What is attacked, and what is deliberately not
 *
 * Every mutation targets a property P1-24 is responsible for: the route-layer
 * authorization gate, the uniform denial document, the public-operation error
 * pipeline, the derived-evidence floor, page bounds, and the financial blocker at the
 * billing/delivery seam.
 *
 * Nothing here attacks tenant isolation at the SQL predicate level, and that omission
 * is deliberate rather than an oversight — P1-23 recorded why. Removing a code-side
 * `tenant_id` predicate fails no test, because the RLS policy blocks the foreign row
 * first, so no assertion reachable through a service can observe the application-layer
 * predicate independently. That predicate is defence in depth and stays; a mutation
 * that can only ever survive is not evidence.
 *
 * Run: node scripts/p1-24-mutation-matrix.mjs [--only <id>]
 * Requires a database, like the backend tier itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { API_SRC_PATH } from './lib/repository-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ROUTE_HANDLER = `${API_SRC_PATH}/server/http/route-handler.ts`;
const AUTHORIZATION = `${API_SRC_PATH}/server/auth/authorization.ts`;
const VALIDATION = `${API_SRC_PATH}/server/http/validation.ts`;
const DELIVERY_DOMAIN = `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`;
const ORG_SETTINGS = `${API_SRC_PATH}/modules/iam/application/organization-settings-service.ts`;
const COMPANY_SETTINGS = `${API_SRC_PATH}/app/api/v1/org/companies/[companyId]/settings/route.ts`;

const IAM_ROUTES = 'tests/backend/p1-24-iam-route-depth.test.ts';
const READ_SHAPE = 'tests/backend/p1-24-read-path-shape.test.ts';
const JOURNEY = 'tests/backend/p1-24-cross-domain-journey.test.ts';

/**
 * Each entry: the property attacked, the file, an exact `from` -> `to` edit, and the
 * suite that must go red WITH AN ASSERTION FAILURE.
 *
 * `from` must appear EXACTLY ONCE. A mutation matching zero or several places is a
 * matrix defect and fails the run — a mutation that never applied is otherwise
 * indistinguishable from one that was caught.
 *
 * Every `to` must be code that COMPILES AND RUNS. The point is a mutant that behaves
 * wrongly, not one that cannot execute.
 */
const MUTATIONS = [
  {
    id: 'M1',
    property: 'A public operation answers a problem document instead of rejecting (P1-24-F-002)',
    file: ROUTE_HANDLER,
    // The one-word regression. Valid TypeScript, runs fine, and hands the rejection
    // to the caller instead of to the enclosing catch.
    from: 'return await handlePublic(operation, request, handler, options, correlationId);',
    to: 'return handlePublic(operation, request, handler, options, correlationId);',
    suite: IAM_ROUTES,
  },
  {
    id: 'M2',
    property: 'The denial document names the operation’s declared codes, not the caller’s gap',
    file: AUTHORIZATION,
    // The "helpful" change: tell the caller precisely which permission they lack.
    // Every single-permission operation behaves identically, which is why the
    // conjunction case exists.
    from: 'safeDetails: { requiredPermissions: operation.permissions },\n  });',
    to: 'safeDetails: { requiredPermissions: decision.failedPermissions },\n  });',
    suite: IAM_ROUTES,
  },
  {
    id: 'M3',
    property: 'A denial happens BEFORE the handler body, so it cannot leak existence',
    file: AUTHORIZATION,
    // Authorization evaluates and then does nothing about it. The decision is still
    // computed and logged, so nothing crashes — the gate simply stops refusing.
    from: '  const decision = await evaluatePermissions(db, operation, target, options);\n  if (decision.allowed) return;',
    to: '  const decision = await evaluatePermissions(db, operation, target, options);\n  if (decision.allowed || decision.failedPermissions.length >= 0) return;',
    suite: IAM_ROUTES,
  },
  {
    id: 'M4',
    property: 'A caller narrowed by grant scope cannot read another company’s settings',
    // TWO edits, and the reason is worth more than the verdict.
    //
    // Company scope is guarded twice and independently: the route passes
    // `authorizationTarget: { companyId }`, which makes
    // `requiresScopedEvaluation('company', target)` true so the gate evaluates
    // `iam.has_permission_in_scope`; and `requireCompanyInScope` inside the service
    // asserts the same thing again through the delegation policy.
    //
    // Two earlier single-file versions of M4 both SURVIVED — first removing the
    // route's target, then removing the service's assertion — and neither was a
    // coverage gap. Each time the OTHER layer refused, and the log showed which:
    // with the service check gone, the route answered ERR-IAM-001 naming
    // `org.company.read`. A mutation whose effect is masked by a second independent
    // guard can only ever survive, and reporting one as coverage would be exactly the
    // dishonesty this matrix exists to prevent.
    //
    // So the mutation removes BOTH. What it proves is precise and worth stating: the
    // property is guarded, and it is guarded twice. What it deliberately does NOT
    // prove is which layer is load-bearing — neither is independently observable
    // through the API, and no test written against the API could distinguish them.
    edits: [
      {
        file: COMPANY_SETTINGS,
        from: '    { params, authorizationTarget: { companyId: params.companyId } }\n  );\n}\n\nexport async function POST(',
        to: '    { params }\n  );\n}\n\nexport async function POST(',
      },
      {
        file: ORG_SETTINGS,
        from: "    this.delegationPolicy.assertScopeWithinAuthority(await this.scopeFacts(db), {\n      scopeType: 'company',\n      companyId,\n    });",
        to: '    await this.scopeFacts(db);',
      },
    ],
    suite: IAM_ROUTES,
  },
  {
    id: 'M5',
    property: 'A page size above the maximum is refused rather than silently clamped',
    file: VALIDATION,
    // The refusal lives in the Zod boundary schema, NOT in `pageRequest` — that one
    // deliberately CLAMPS, as defence in depth for internal callers, and says so. So
    // the mutation widens the boundary rather than the clamp: a caller asking for
    // 100 000 is accepted and the clamp quietly returns 100, leaving it believing it
    // read everything.
    from: 'limit: z.coerce.number().int().min(1).max(100),',
    to: 'limit: z.coerce.number().int().min(1).max(1000000),',
    suite: READ_SHAPE,
  },
  {
    id: 'M6',
    property: 'An issued invoice with an open balance blocks the vehicle handover',
    file: DELIVERY_DOMAIN,
    // The blocker that exists ONLY in application code — `sal.complete_delivery`
    // reads no financial balance at all (verified against the deployed body), so
    // deleting this fails no database constraint and no schema test. If it survives,
    // the platform releases vehicles against unpaid invoices in silence.
    from: "  if (facts.hasOutstandingBalance) blockers.push('financial_balance_outstanding');",
    to: "  if (facts.hasOutstandingBalance && false) blockers.push('financial_balance_outstanding');",
    suite: JOURNEY,
  },
];

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

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
    // A launcher failure is not a test result. Without this, "could not start vitest"
    // is indistinguishable from "the suite went red".
    if (error.status === null || error.status === undefined) {
      return { status: 'crash', evidence: `runner failed to start: ${error.code ?? 'unknown'}` };
    }
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    // A crash signature outranks an assertion signature: if the mutant could not
    // execute, any assertion text present is incidental.
    const crash =
      /\b(42P18|42703|42601|42883|22P02)\b/.exec(output) ??
      /\b(ReferenceError|SyntaxError|Transform failed|is not defined|is not a function)\b/.exec(
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

/**
 * A mutation is a LIST of edits, and single-edit entries are the common case.
 *
 * Two edits are needed when a property is guarded independently at two layers.
 * Removing either alone leaves the other refusing, so a single-file mutation can
 * only ever survive — and scoring that as coverage would be exactly the dishonesty
 * this matrix exists to prevent. M4 is that case and says so in its own note.
 */
const editsOf = (m) => m.edits ?? [{ file: m.file, from: m.from, to: m.to }];

const results = [];
for (const m of selected) {
  const edits = editsOf(m).map((edit) => ({
    ...edit,
    path: join(ROOT, edit.file),
  }));
  const originals = edits.map((edit) => readFileSync(edit.path, 'utf8'));
  const misapplied = edits
    .map((edit, index) => ({ edit, occurrences: originals[index].split(edit.from).length - 1 }))
    .filter((entry) => entry.occurrences !== 1);

  if (misapplied.length > 0) {
    const first = misapplied[0];
    results.push({
      ...m,
      file: first.edit.file,
      verdict: first.occurrences === 0 ? 'NOT-APPLICABLE' : 'AMBIGUOUS',
      detail: `pattern occurs ${first.occurrences}x`,
    });
    continue;
  }

  process.stdout.write(`  ${m.id} ${m.property} ... `);
  edits.forEach((edit, index) => {
    writeFileSync(edit.path, originals[index].replace(edit.from, edit.to), 'utf8');
  });
  let outcome;
  try {
    outcome = runSuite(m.suite);
  } finally {
    let restored = true;
    edits.forEach((edit, index) => {
      writeFileSync(edit.path, originals[index], 'utf8');
      if (readFileSync(edit.path, 'utf8') !== originals[index]) {
        console.error(`\nFATAL: ${edit.file} was not restored byte-for-byte. Stopping.`);
        restored = false;
      }
    });
    if (!restored) process.exit(2);
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

console.log('\nP1-24 mutation matrix');
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
