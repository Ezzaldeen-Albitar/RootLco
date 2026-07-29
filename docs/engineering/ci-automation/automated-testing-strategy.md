# Automated testing strategy

Fifteen layers. For each: what it is for, when it runs, how long it takes, where
its data comes from, what it produces, who owns a failure, and what it would take
to promote it to blocking.

Durations are _expected_ ranges on a standard `ubuntu-latest` runner. Where a
layer has never run on a hosted runner the duration says so rather than guessing.

---

## 1. Static verification

|                 |                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Catch everything decidable without executing the product: formatting, types, lint, module boundaries, authorization coverage, generated-file drift, workflow security, test honesty, encoding, canonical documents, no-fake-data, scope exclusions, route↔contract parity |
| **Trigger**     | Every pull request, every protected push                                                                                                                                                                                                                                  |
| **Duration**    | 4–7 min                                                                                                                                                                                                                                                                   |
| **Data**        | None                                                                                                                                                                                                                                                                      |
| **Environment** | Node 22, no database                                                                                                                                                                                                                                                      |
| **Artifacts**   | `workflow-security.json`, `route-parity.json`, `test-honesty.json`, `openapi-totals.json`                                                                                                                                                                                 |
| **Owner**       | Author of the change                                                                                                                                                                                                                                                      |
| **Policy**      | **Blocking**                                                                                                                                                                                                                                                              |
| **Promotion**   | Already blocking                                                                                                                                                                                                                                                          |

Generated evidence is _regenerated_ here and followed by `git diff --exit-code`.
Validating a committed artefact is weaker: a hand-edit that happens to be
well-formed passes a structural check.

---

## 2. Domain unit tests

|                 |                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Pure logic with no I/O: money and quantity arithmetic, error mapping, validation, pagination, concurrency helpers, log redaction, and the CI gate scripts themselves |
| **Trigger**     | Every pull request, every protected push                                                                                                                             |
| **Duration**    | 1–3 min including coverage                                                                                                                                           |
| **Data**        | In-memory fixtures                                                                                                                                                   |
| **Environment** | Node 22, no database                                                                                                                                                 |
| **Artifacts**   | `vitest-unit.json`, `coverage-gate.json`, HTML coverage report                                                                                                       |
| **Owner**       | Author of the change                                                                                                                                                 |
| **Policy**      | **Blocking**, with a coverage ratchet                                                                                                                                |
| **Promotion**   | Already blocking                                                                                                                                                     |

---

## 3. Component and application-service tests

|                 |                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Application services against a real database through the repository layer — the layer where a scope predicate is either present or absent |
| **Trigger**     | Every pull request (inside `integration-tests`)                                                                                           |
| **Duration**    | part of the 15–25 min backend tier                                                                                                        |
| **Data**        | Synthetic fixtures created and torn down per suite                                                                                        |
| **Environment** | `postgres:17-alpine` service container                                                                                                    |
| **Artifacts**   | `vitest-backend.json`, `coverage-gate-backend.json`                                                                                       |
| **Owner**       | Module owner                                                                                                                              |
| **Policy**      | **Blocking**                                                                                                                              |
| **Promotion**   | Already blocking                                                                                                                          |

---

## 4. Repository and database tests

|                 |                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | RLS, constraints, triggers, exclusion constraints, sequence allocation, negative-stock refusal — including refusal against a raw `UPDATE` that bypasses every function |
| **Trigger**     | Every pull request touching source, tests, database, dependencies or workflows                                                                                         |
| **Duration**    | 12–20 min (137 files, serial)                                                                                                                                          |
| **Data**        | Synthetic; business tables asserted empty at the start                                                                                                                 |
| **Environment** | `postgres:17-alpine`, `fileParallelism: false`                                                                                                                         |
| **Artifacts**   | `vitest-db.json`, `rls-matrix.json`                                                                                                                                    |
| **Owner**       | Database owner                                                                                                                                                         |
| **Policy**      | **Blocking**                                                                                                                                                           |
| **Promotion**   | Already blocking                                                                                                                                                       |

`fileParallelism: false` is enforced by `check-test-honesty.mjs` rule TH-007.
Removing it fails the build, because parallel files against one mutable database
race each other's fixtures and the resulting failure looks like a product bug.

---

## 5. API integration tests

|                 |                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**     | Real paths through Route Handler → authentication → authorization → PostgreSQL → RLS → business function → audit → outbox → response mapping. Nothing mocks the database |
| **Trigger**     | Every pull request touching source, tests, database or workflows                                                                                                         |
| **Duration**    | 15–25 min (59 files, serial)                                                                                                                                             |
| **Data**        | Synthetic only. **Never** pilot or customer data                                                                                                                         |
| **Environment** | `postgres:17-alpine` with migrations and seeds applied                                                                                                                   |
| **Artifacts**   | `vitest-backend.json`, `correlation.json`, `idempotency-evidence.json`                                                                                                   |
| **Owner**       | Module owner                                                                                                                                                             |
| **Policy**      | **Blocking**                                                                                                                                                             |
| **Promotion**   | Already blocking                                                                                                                                                         |

---

## 6. RLS and security matrix

|                 |                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Catalog-derived proof, per table: RLS enabled, RLS forced, which runtime role holds which privilege, whether a policy covers each granted action, zero `SECURITY DEFINER`, no runtime role with `SUPERUSER` or `BYPASSRLS` |
| **Trigger**     | Critical schemas on every pull request; every application schema nightly                                                                                                                                                   |
| **Duration**    | 1–2 min (PR) · 3–5 min (nightly full)                                                                                                                                                                                      |
| **Data**        | None — it reads `pg_class`, `pg_policy`, `pg_proc`, `pg_roles`                                                                                                                                                             |
| **Environment** | Freshly migrated `postgres:17-alpine`                                                                                                                                                                                      |
| **Artifacts**   | `rls-matrix.json` — every role × table × action cell, with a verdict or a recorded skip reason                                                                                                                             |
| **Owner**       | Security owner                                                                                                                                                                                                             |
| **Policy**      | **Blocking**                                                                                                                                                                                                               |
| **Promotion**   | Already blocking                                                                                                                                                                                                           |

This is catalog-derived on purpose: it cannot be satisfied by a passing test,
only by the database genuinely being configured that way. Behavioural denial
evidence stays the job of layer 4.

---

## 7. Backend end-to-end workflows

|                 |                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Complete cross-module business workflows: partner → vehicle → appointment → reception → work order → diagnostics → additional-work quotation → approval → reservation → issue → return → closure eligibility, with audit and outbox correlated throughout |
| **Trigger**     | Nightly (full), representative subset on every pull request                                                                                                                                                                                               |
| **Duration**    | 20–35 min                                                                                                                                                                                                                                                 |
| **Data**        | Synthetic                                                                                                                                                                                                                                                 |
| **Environment** | `postgres:17-alpine`                                                                                                                                                                                                                                      |
| **Artifacts**   | `vitest-backend.json`, `correlation.json`                                                                                                                                                                                                                 |
| **Owner**       | Module owners jointly                                                                                                                                                                                                                                     |
| **Policy**      | **Blocking** nightly                                                                                                                                                                                                                                      |
| **Promotion**   | Already blocking                                                                                                                                                                                                                                          |

---

## 8. Concurrency and idempotency

|                 |                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Last-unit reservation, concurrent issue, release/issue race, work-order transition race, number allocation, quotation revision, duplicate approval; and for every operation declaring `idempotent: true`: same key + same payload, same key + different payload, simultaneous duplicates, retry after response loss |
| **Trigger**     | Inside layers 4 and 5                                                                                                                                                                                                                                                                                               |
| **Duration**    | included above                                                                                                                                                                                                                                                                                                      |
| **Data**        | Synthetic; real parallel connections, not simulated                                                                                                                                                                                                                                                                 |
| **Environment** | `postgres:17-alpine`                                                                                                                                                                                                                                                                                                |
| **Artifacts**   | `idempotency-evidence.json`                                                                                                                                                                                                                                                                                         |
| **Owner**       | Module owner                                                                                                                                                                                                                                                                                                        |
| **Policy**      | **Blocking**                                                                                                                                                                                                                                                                                                        |
| **Promotion**   | Already blocking                                                                                                                                                                                                                                                                                                    |

`check-idempotency-evidence.mjs` joins the routes that _declare_ idempotency
against the operation-test matrix's _derived_ evidence — derived, not declared,
because a comment in a test header cannot satisfy a structural requirement.

**Open**: 10 IAM operations declare idempotency with no replay evidence. Itemised
in `.github/ci-baselines/idempotency-exceptions.json`, expiry 2026-10-31. Any new
one fails immediately.

---

## 9. Rollback and failure injection

|                 |                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Inject failure after the domain mutation, the history insert, the audit insert, the outbox insert, and the dependent-module update; prove no orphan effect survives |
| **Trigger**     | Inside layer 5 (`transactions.test.ts` and per-module rollback suites)                                                                                              |
| **Duration**    | included above                                                                                                                                                      |
| **Data**        | Synthetic                                                                                                                                                           |
| **Environment** | `postgres:17-alpine`                                                                                                                                                |
| **Artifacts**   | part of `vitest-backend.json`                                                                                                                                       |
| **Owner**       | Backend foundation owner                                                                                                                                            |
| **Policy**      | **Blocking**                                                                                                                                                        |
| **Promotion**   | Already blocking                                                                                                                                                    |

---

## 10. Mutation testing

|                 |                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Remove one security or integrity guard at a time and require the suite to notice. A guard whose removal changes nothing is dead code or untested — and both look identical in a coverage report |
| **Trigger**     | Nightly                                                                                                                                                                                         |
| **Duration**    | 10–30 min, one targeted suite per target                                                                                                                                                        |
| **Data**        | Synthetic                                                                                                                                                                                       |
| **Environment** | `postgres:17-alpine`                                                                                                                                                                            |
| **Artifacts**   | `mutation-report.json`                                                                                                                                                                          |
| **Owner**       | Security owner                                                                                                                                                                                  |
| **Policy**      | **Blocking nightly**. Not on pull requests — a full mutation run would dominate the gate                                                                                                        |
| **Promotion**   | A PR-tier smoke over the two cheapest targets once nightly timings are known                                                                                                                    |

Targets are hand-picked, not generated. A target whose anchor text has moved
**errors** rather than passing: a mutation check that silently stops mutating is
the same failure mode as a vacuous assertion.

---

## 11. Performance testing

|                 |                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | p50/p95/p99 and the actual query plan for the tenant-leading indexed lookup families, plus pagination, bulk insert, concurrent allocation and reservation contention |
| **Trigger**     | Nightly                                                                                                                                                              |
| **Duration**    | 10–20 min at scale 20 000                                                                                                                                            |
| **Data**        | Generated, non-personal, deleted afterwards                                                                                                                          |
| **Environment** | `postgres:17-alpine`                                                                                                                                                 |
| **Artifacts**   | `performance.json`, query plans                                                                                                                                      |
| **Owner**       | Database owner                                                                                                                                                       |
| **Policy**      | **Informational** until a baseline exists — except two absolute checks that block from day one: a sequential scan on an indexed lookup, and an empty measurement set |
| **Promotion**   | Blocking once three consecutive nightlies agree within the noise floor                                                                                               |

---

## 12. Backup and restore

|                 |                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | `pg_dump`, destroy, restore into a fresh database, then prove schema hash, per-table row counts and application-shaped queries all match the source |
| **Trigger**     | Nightly                                                                                                                                             |
| **Duration**    | 5–10 min                                                                                                                                            |
| **Data**        | Ephemeral container only. **Production is unreachable from every workflow in this repository**                                                      |
| **Environment** | `postgres:17-alpine`                                                                                                                                |
| **Artifacts**   | `backup-restore.json`. The dump itself is never uploaded                                                                                            |
| **Owner**       | Database owner                                                                                                                                      |
| **Policy**      | **Blocking nightly**                                                                                                                                |
| **Promotion**   | Already blocking                                                                                                                                    |

---

## 13. Container security

|                 |                                                                                                                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Dockerfile lint, both build targets, vulnerability and secret scan of layers, runtime uid 1001, no `.env` or key material in any layer, no credential in build history, no development tooling, HEALTHCHECK present, container actually starts and serves `/api/health`, image size ratchet, digest |
| **Trigger**     | Every pull request touching Docker, dependencies, source or workflows; deep nightly                                                                                                                                                                                                                 |
| **Duration**    | 10–18 min                                                                                                                                                                                                                                                                                           |
| **Data**        | None                                                                                                                                                                                                                                                                                                |
| **Environment** | `ubuntu-latest` with Buildx                                                                                                                                                                                                                                                                         |
| **Artifacts**   | `trivy-image.json`, `trivy-image.sarif`, `hadolint.sarif`, `image-metadata.json`, `container.log`                                                                                                                                                                                                   |
| **Owner**       | Platform owner                                                                                                                                                                                                                                                                                      |
| **Policy**      | **Blocking** for fixable CRITICAL/HIGH and for any secret in a layer. Unfixable findings are reported                                                                                                                                                                                               |
| **Promotion**   | Already blocking                                                                                                                                                                                                                                                                                    |

---

## 14. Release verification

|                 |                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| **Purpose**     | Build once; SBOM; scan; provenance; digest; record everything a promotion decision would need            |
| **Trigger**     | Release tag or dispatch, `main` only                                                                     |
| **Duration**    | 30–50 min                                                                                                |
| **Data**        | None                                                                                                     |
| **Environment** | `ubuntu-latest`                                                                                          |
| **Artifacts**   | `sbom.spdx.json`, `release-manifest.json`, `release-eligibility.json`, attestation bundle when available |
| **Owner**       | Platform owner                                                                                           |
| **Policy**      | **Blocking** for a release                                                                               |
| **Promotion**   | n/a                                                                                                      |

---

## 15. Browser end-to-end — NOT IMPLEMENTED

There is no browser test tier and this document does not pretend otherwise. The
frontend phases are not built, so a Playwright suite would assert against a UI
that does not exist — which is worse than the gap, because it would report green.

### Activation plan

Enable only when **all** of these hold:

1. an owner-approved UI exists for at least one complete workflow;
2. that UI is reachable from a container the workflow can start — the same
   `runner` image the container job already builds and health-checks, so no new
   build path is introduced;
3. a seeded synthetic tenant exists that the suite may mutate freely;
4. authentication can be established without a real credential (a test-only
   identity created by the fixture, never a stored secret).

Then, in order:

| Step                                                                 | Gate status              |
| -------------------------------------------------------------------- | ------------------------ |
| Add `@playwright/test`, pin the browser image by digest              | not required             |
| One smoke journey: sign in, land, sign out                           | non-blocking for 2 weeks |
| Flake rate measured over ≥ 20 nightly runs                           | must be 0 to proceed     |
| Promote the smoke journey to the PR gate                             | blocking                 |
| Add remaining journeys one at a time, each with the same 2-week soak | blocking after soak      |

Do **not** add browser E2E as a required check before its flake rate has been
measured. A flaky required check trains people to re-run until green, which
destroys the value of every other layer.
