# Performance policy

## Measure first

`scripts/db/perf-baseline.mjs` has existed since P1-12 and measures the right
things — median, p95, p99 and the actual plan from
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` over the tenant-leading indexed query
families. What it never had was anywhere to compare against, and it has only ever
run on a developer machine.

`.github/ci-baselines/performance-baseline.json` therefore ships with
`queries: {}` and `establishedBy: null`. Inventing a millisecond threshold before
anything has been measured on a hosted runner would be a guess wearing the
costume of a gate.

## What blocks from day one

Two checks need no baseline, because neither is relative:

**A sequential scan on a tenant-leading indexed lookup.** That is a missing or
unusable index, not a slow machine, and it is true regardless of hardware.

**An empty measurement set.** Nothing measured must never read as fast. If the
harness did not run, or its output shape changed, that is a failure.

## What blocks once a baseline exists

p95 against the recorded value, budget ×1.5, noise floor 5 ms.

**p95 rather than p50** because a regression that only moves the median is
usually noise and one that moves the tail is usually real.

**×1.5 is wide on purpose.** A shared 2-vCPU hosted runner is a noisy instrument.
A budget that cries wolf gets ignored, and an ignored budget is worse than none.

**A 5 ms noise floor** because below that the ratio is arithmetic about jitter —
1 ms to 2 ms is ×2 and means nothing.

## Establishing the baseline

1. Let three consecutive nightlies run and record their measurements.
2. Confirm the p95 values agree within the noise floor. If they do not, the
   measurement is not yet stable enough to ratchet and the harness needs
   attention first.
3. Run `node scripts/ci/performance-gate.mjs --report performance.json --update`
   against the median of the three.
4. Commit, stating that the numbers came from hosted runs and which ones.

Do not seed the baseline from a developer machine. A laptop with fast NVMe and
16 GB of RAM produces numbers a hosted runner cannot reproduce, and a budget
built on them fails every night.

## What is measured

| Family                           | Why                                            |
| -------------------------------- | ---------------------------------------------- |
| Tenant-leading indexed lookups   | the shape of nearly every read in the product  |
| Pagination                       | truncation and slow tail pages are both silent |
| High-volume insert               | reception and stock movement bursts            |
| Concurrent number allocation     | the one place a lock is unavoidable            |
| Inventory reservation contention | the last-unit race                             |
| Connection pressure              | pool exhaustion behaviour                      |

Against a **generated, non-personal** dataset at scale 20 000, deleted afterwards.
No customer or pilot data exists in any environment CI can reach.

## What these numbers are not

They are **validation baselines, not production-capacity claims**. They are
measured on a shared runner, against generated data, with no concurrent
application load. `P1-OD-027` / `NFR-SCL` remain unresolved, and nothing in this
pipeline resolves them.

Anyone quoting a number from `performance.json` as a capacity figure is quoting
it wrongly, which is why the generated Markdown says so on every run.
