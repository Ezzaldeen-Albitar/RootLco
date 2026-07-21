#!/usr/bin/env node
// ============================================================================
// P1-12 Wave 16 — Consolidated Release 2 database gate pipeline.
//
// Runs the required P1-12 gate set in a controlled, SEQUENTIAL order (no mutable DB
// campaign runs concurrently against the same database), preserves exit codes, stops on
// the first failed REQUIRED gate, and prints an evidence summary. Reusable in CI.
//
// Usage: node scripts/db/gate-p1-12.mjs [--fast]   (--fast skips the ~200s full test:db
//   + the empty rebuild for a quick static/structural pass during iteration)
// ============================================================================
import { spawnSync } from 'node:child_process';

const FAST = process.argv.includes('--fast');
const run = (label, cmd, args, opts = {}) => {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${label}\n`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  results.push({ label, ok, ms, code: r.status });
  if (!ok && !opts.optional) {
    printSummary();
    console.error(`\n✖ REQUIRED GATE FAILED: ${label} (exit ${r.status}). Stopping.`);
    process.exit(r.status || 1);
  }
  return ok;
};
const results = [];
const printSummary = () => {
  console.log('\n=== P1-12 GATE SUMMARY ===');
  for (const s of results)
    console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${String(s.ms).padStart(7)}ms  ${s.label}`);
  console.log(`total: ${results.length} gates, ${results.filter((s) => s.ok).length} passed`);
};

// 1. Clean-room: empty rebuild + seed idempotency (skipped in --fast).
if (!FAST) run('empty rebuild (supabase db reset)', 'npx', ['supabase', 'db', 'reset']);
run('seed-state (idempotent x2, business empty)', 'npm', ['run', 'validate:seed-state']);
// 2. Structural: schema inventory hash + FK/index/dictionary-drift review.
run('schema inventory (hash)', 'node', ['scripts/db/schema-inventory.mjs', '--hash-only']);
run('structural review (FK/cascade/index/dictionary drift)', 'node', [
  'scripts/db/structural-review.mjs',
]);
// 3. Migration integrity: phase-boundary upgrade matrix.
if (!FAST) run('phase-boundary upgrade matrix', 'node', ['scripts/db/phase-upgrade-matrix.mjs']);
// 4. Full DB test suite (integrated scenario, isolation, security, concurrency, idempotency,
//    rollback, audit-integrity, foundation object allow-lists all live here).
if (!FAST) run('full test:db', 'npm', ['run', 'test:db']);
// 5. Classification + privacy + no-fake-data.
for (const v of ['crm', 'veh', 'aptrec', 'wo-tech-dia-qms', 'svc-quo-inv', 'sal-wty-rpt'])
  run(`classification: ${v}`, 'npm', ['run', `validate:${v}-classification`]);
run('no-fake-data', 'npm', ['run', 'validate:no-fake-data']);
// 6. Security scans + scope exclusions + canonical docs.
run('security: tracked-secrets', 'npm', ['run', 'security:tracked-secrets']);
run('security: browser-secrets', 'npm', ['run', 'security:browser-secrets']);
run('security: scope-exclusions', 'npm', ['run', 'security:scope-exclusions']);
run('canonical docs', 'npm', ['run', 'validate:canonical-docs']);
// 7. Static gates.
run('lint', 'npm', ['run', 'lint']);
run('typecheck', 'npm', ['run', 'typecheck']);
run('format:check', 'npm', ['run', 'format:check']);
run('style:check', 'npm', ['run', 'style:check']);
// 8. Build + container config.
if (!FAST) run('next build', 'npm', ['run', 'build']);
run('docker compose config', 'docker', ['compose', 'config'], { optional: false });
// 9. Baseline drift fingerprint.
run('baseline manifest (drift fingerprint)', 'node', ['scripts/db/baseline-manifest.mjs']);

printSummary();
console.log('\n✔ P1-12 CONSOLIDATED GATE: ALL REQUIRED GATES PASSED');
process.exit(0);
