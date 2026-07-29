# CI observability

No external service, paid or otherwise. GitHub job summaries and artifacts first,
because those are already retained, already access-controlled, and already
attached to the run they describe.

## What every job emits

| Signal                                           | Where                                                   |
| ------------------------------------------------ | ------------------------------------------------------- |
| Per-job duration                                 | GitHub run view, no instrumentation needed              |
| Per-step duration                                | GitHub run view                                         |
| npm cache hit/miss                               | `setup-project` output, printed into every job summary  |
| Test totals per tier                             | `test-totals-<tier>.json`, surfaced in the gate summary |
| Fifteen slowest tests per tier                   | `summarise-vitest.mjs`, in the job summary              |
| Skipped tests, by name                           | `summarise-vitest.mjs`                                  |
| Coverage per metric, with delta against baseline | `coverage-gate.json`                                    |
| Build size and growth ratio                      | `build-size.json`                                       |
| Largest static assets                            | `build-size.json`                                       |
| Build warning count and the first fifty          | `warning-count.txt`, `build-warnings.txt`               |
| Migration count, schema hash, structural totals  | `migration-replay.json`                                 |
| Image digest, size, layer count, runtime uid     | `image-metadata.json`                                   |
| Docker build time                                | GitHub run view                                         |
| Vulnerability counts split fixable/unfixable     | `container-policy.json`                                 |
| Dependency advisories by tree                    | `dependency-policy.json`                                |
| Licence distribution                             | `dependency-policy.json`                                |
| RLS cells by verdict                             | `rls-matrix.json`                                       |
| Query latency p50/p95/p99 and plans              | `performance.json`                                      |
| Artifact sizes                                   | GitHub artifact list                                    |

## The gate summary is the dashboard

`ci-gate` downloads every `evidence-*` artifact and renders one table: head SHA,
base SHA, change classification, every job with its result and the reason the
gate accepted or rejected it, coverage, test totals per tier, OpenAPI totals,
migration count, schema hash, image digest, security findings, and **Go** or
**No-Go**.

It is generated from the JSON, never written independently. That is what makes it
trustworthy — the summary cannot disagree with the evidence, because it is
derived from it.

## Trends

Trend data is the artifact history: coverage, build size, image size and
performance each have a JSON artifact per run. There is no time-series database
and there should not be one until somebody has a question the artifacts cannot
answer.

Two trends have a mechanism rather than just a record:

- **Coverage** — the ratchet in `coverage-baseline.*.json`. The committed number
  _is_ the trend line, and moving it is a reviewable diff.
- **Build and image size** — ratio against the recorded baseline, with a warning
  band at ×1.1 and a hard ceiling at ×1.5.

## Health report

`nightly-gate` produces the closest thing to a health report: every nightly job,
its tier, its result, and — for informational failures — why that tier was
chosen. Retained 90 days.

## What is deliberately not measured

- **A flake rate.** There is no retry mechanism to measure one against, by
  design (`flaky-test-policy.md`). A test that failed and passed is investigated,
  not counted.
- **Aggregate "pipeline health" scores.** A single number invites managing the
  number. The gate is binary on purpose.
- **Anything requiring an external collector.** No paid observability service.
