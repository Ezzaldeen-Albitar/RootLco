# The pull-request gate

`pr-ci.yml`. Thirteen jobs. One required check.

## Why the workflow has no `paths:` filter

A required status check that never runs stays **Pending** forever and blocks the
merge with no failure to diagnose. That is CSA-06 and CSA-12 together, and it is
why change detection is a _job_ and not a trigger filter. The workflow always
starts; the jobs inside it decide.

## Jobs

| #   | Job                         | Runs when                                                                    | Blocks on                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `change-detection`          | always                                                                       | classification must be produced                                                                                                                                                                                                                                                                                                                                     |
| 2   | `static-quality`            | always                                                                       | format, lint, types, stylelint, YAML/JSON, actionlint, workflow security, shellcheck, encoding, canonical docs, no-fake-data, scope exclusions, module boundaries, authorization coverage, operation coverage, OpenAPI, P1-19/20/21 inventories, route↔registry parity, test honesty, forbidden files, conflict markers, lockfile consistency, generated-file drift |
| 3   | `unit-tests-coverage`       | always                                                                       | unit suite + coverage ratchet + critical-module floors + touched-file floor                                                                                                                                                                                                                                                                                         |
| 4   | `application-build`         | source, frontend, backend, OpenAPI, deps, config, docker, workflows          | environment contract, production build, output integrity, size ratchet                                                                                                                                                                                                                                                                                              |
| 5   | `database-migration-replay` | database, deps, workflows, scripts                                           | zero tables before, filename order, immutability, replay from zero, count, migration 120 absent, seeds twice, retention classes, permission totals, schema hash vs baseline, structural review, smoke reads, business tables empty, clean tree                                                                                                                      |
| 6   | `database-security`         | database, source, backend, tests, deps, workflows                            | database suite + role × table × action matrix                                                                                                                                                                                                                                                                                                                       |
| 7   | `integration-tests`         | source, backend, frontend, OpenAPI, tests, database, deps, workflows, config | backend suite + backend coverage + idempotency evidence + audit/outbox correlation                                                                                                                                                                                                                                                                                  |
| 8   | `dependency-security`       | always                                                                       | production advisories, dev advisories vs exceptions, prohibited packages, licences, dependency review                                                                                                                                                                                                                                                               |
| 9   | `code-security`             | source, tests, scripts, deps, workflows, config                              | CodeQL over `javascript-typescript` and `actions`                                                                                                                                                                                                                                                                                                                   |
| 10  | `container-security`        | docker, deps, source, config, workflows                                      | hadolint, both targets, Trivy, uid 1001, no secrets in layers, HEALTHCHECK, container serves `/api/health`, size ratchet                                                                                                                                                                                                                                            |
| 11  | `secret-scan`               | always                                                                       | tracked files, key material, repository scanners, workflow policy, build output                                                                                                                                                                                                                                                                                     |
| 12  | `hosted-clean-room`         | **always**                                                                   | the whole battery from nothing, at the exact head                                                                                                                                                                                                                                                                                                                   |
| 13  | `ci-gate`                   | `always()`                                                                   | everything above                                                                                                                                                                                                                                                                                                                                                    |

## Why the clean room can never be skipped

It is the single exact-SHA proof the acceptance criteria rest on, and a
documentation-only gate pull request is _required_ to demonstrate it. A clean
room that can be skipped is not a clean room. It costs one job per pull request;
that is the price of the proof.

## What `ci-gate` refuses

Beyond the obvious failure and cancellation:

- a skip that change detection said was required;
- a skip of an unconditionally required job, whatever the classification says;
- a skip when no classification exists at all;
- a governed job missing from `needs` — someone renamed or removed a job;
- a job in `needs` that the gate does not govern — someone added one;
- a tested SHA that differs from the SHA under review;
- any result that is not one of `success`, `skipped`, `failure`, `cancelled`.

All twenty-six of these paths have tests in `tests/ci/ci-gate.test.ts`.

## The gate summary

Every run writes a Markdown summary containing the head SHA, base SHA, changed
file classification, per-job results with the reason for each, coverage totals,
test totals per tier, OpenAPI totals, migration count, schema hash, image digest,
security findings, and the final **Go** / **No-Go**.

It is generated from the evidence JSON the jobs uploaded, never written
independently. Two hand-maintained copies of the same fact drift, and the one
people read drifts first.

## Migration rollback policy

Rollback is exercised only for migrations that explicitly declare
`-- rootlco:reversible`. None currently do, and the job says so rather than
silently passing.

Every migration in this repository is **forward-only** by policy. Inventing a
down-migration for an irreversible change — a dropped column, a rewritten row —
would prove a rollback that cannot happen in production, which is worse than
having no rollback test because it creates false confidence. Recovery from a bad
migration is a forward migration plus, if data was lost, the restore path the
nightly backup drill exercises.
