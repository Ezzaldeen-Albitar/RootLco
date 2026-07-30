/**
 * The performance gate must be able to read the report its own producer writes.
 *
 * This file exists because it could not, and nothing said so. `scripts/db/perf-baseline.mjs`
 * is the only writer of `performance.json`, and it emits rows shaped
 * `{ family, median_ms, p95_ms, p99_ms, index_used, uses_seq_scan }`. `normalise()` looked
 * for `name`/`query`/`id` and `p50`/`median`/`med`, `p95`, `p99` — **not one of which
 * matches**. Every row normalised to `NaN`, the finite-number filter dropped all of them,
 * and `evaluate()` reported `measurements: 0`.
 *
 * The gate then refused, correctly and with an honest message: an empty result set must
 * never be read as "fast". But the cause it offered — "either the harness did not run or
 * its output shape changed" — was not the real one. The harness ran, in CI, and measured
 * four families; the two sides had simply never agreed, so `performance-baseline` had never
 * once been able to pass, and its nightly evidence was a red job whose cause looked
 * environmental.
 *
 * So the assertion that matters here is not "the gate works". It is **the producer and the
 * consumer agree on every key**, stated as a fixture in the producer's exact shape with the
 * numbers CI actually measured. A rename on either side now fails a test rather than
 * quietly emptying the report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, normalise } from '../../scripts/ci/performance-gate.mjs';

/**
 * A report in `perf-baseline.mjs`'s exact shape.
 *
 * The numbers are the ones the harness reported on GitHub-hosted Actions at `--scale 20000`,
 * copied from the job log, so this fixture is a record of a real run rather than an
 * invention. `partner_scan_by_tenant_isolation` really does scan — that is what it measures.
 */
const PRODUCER_REPORT = {
  disclaimer: 'PROPOSED validation baseline on a generated non-personal dataset',
  iterations: 50,
  dataset_volumes: { partners: 30000, vehicles: 30000 },
  results: [
    {
      family: 'partner_point_lookup_tenant_id',
      median_ms: 0.391,
      p95_ms: 0.621,
      p99_ms: 0.897,
      index_used: true,
      uses_seq_scan: false,
    },
    {
      family: 'vehicle_point_lookup_tenant_id',
      median_ms: 0.392,
      p95_ms: 0.438,
      p99_ms: 0.47,
      index_used: true,
      uses_seq_scan: false,
    },
    {
      family: 'partner_scan_by_tenant_isolation',
      median_ms: 2.12,
      p95_ms: 2.519,
      p99_ms: 2.56,
      index_used: false,
      uses_seq_scan: true,
    },
    {
      family: 'partner_outstanding_balance_fn',
      median_ms: 0.408,
      p95_ms: 0.538,
      p99_ms: 0.593,
      index_used: false,
      uses_seq_scan: false,
    },
  ],
};

const baseline = JSON.parse(
  readFileSync(join(process.cwd(), '.github/ci-baselines/performance-baseline.json'), 'utf8')
);

describe('the performance gate reads what perf-baseline writes', () => {
  it('normalises every row, rather than silently dropping all of them', () => {
    const measurements = normalise(PRODUCER_REPORT);
    // Four in, four out. Against the previous alias lists this was zero.
    expect(measurements).toHaveLength(PRODUCER_REPORT.results.length);
    for (const m of measurements) {
      expect(m.name, 'the family id must survive as the name').not.toBe('unnamed');
      expect(Number.isFinite(m.p50), `${m.name} p50 must be a finite number`).toBe(true);
      expect(Number.isFinite(m.p95), `${m.name} p95 must be a finite number`).toBe(true);
    }
  });

  it('carries the producer’s own key names through, not just any three numbers', () => {
    const [first] = normalise(PRODUCER_REPORT);
    expect(first?.name).toBe('partner_point_lookup_tenant_id');
    expect(first?.p50).toBe(0.391);
    expect(first?.p95).toBe(0.621);
    expect(first?.p99).toBe(0.897);
  });

  it('derives a plan from index_used / uses_seq_scan, which is what the rule acts on', () => {
    const byName = new Map(normalise(PRODUCER_REPORT).map((m) => [m.name, m]));
    expect(byName.get('partner_point_lookup_tenant_id')?.plan).toBe('Index Scan');
    expect(byName.get('partner_scan_by_tenant_isolation')?.plan).toBe('Seq Scan');
    // Neither flag set: a function call whose plan is neither, and inventing one would be
    // worse than reporting none.
    expect(byName.get('partner_outstanding_balance_fn')?.plan).toBeNull();
  });

  it('passes on the real measurements, and refuses an empty report', () => {
    const result = evaluate(PRODUCER_REPORT, baseline);
    expect(result.measurements).toHaveLength(4);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);

    // The refusal that was firing for the wrong reason must still fire for the right one.
    const empty = evaluate({ results: [] }, baseline);
    expect(empty.ok).toBe(false);
    expect(empty.failures.join(' ')).toContain('no measurement');
  });
});

describe('the sequential-scan rule is scoped to point lookups', () => {
  it('FAILS a point lookup that sequentially scans', () => {
    // The rule's real purpose: here a scan means a missing or unusable index.
    const result = evaluate(
      {
        results: [
          {
            family: 'partner_point_lookup_tenant_id',
            median_ms: 1,
            p95_ms: 2,
            p99_ms: 3,
            uses_seq_scan: true,
          },
        ],
      },
      baseline
    );
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('sequential scan');
  });

  it('WARNS rather than fails on a scan family, which scans by design', () => {
    // Before the scoping, the first honest run of this gate would have failed on
    // `partner_scan_by_tenant_isolation` for doing exactly what it exists to do — the kind
    // of failure that gets a gate disabled rather than believed.
    const result = evaluate(
      {
        results: [
          {
            family: 'partner_scan_by_tenant_isolation',
            median_ms: 2.12,
            p95_ms: 2.519,
            p99_ms: 2.56,
            uses_seq_scan: true,
          },
        ],
      },
      baseline
    );
    expect(result.failures).toEqual([]);
    expect(result.warnings.join(' ')).toContain('not a point-lookup family');
  });
});
