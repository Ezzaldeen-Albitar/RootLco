# Artifact catalogue

Before this change, **no workflow uploaded an artifact anywhere** (CSA-02).
Every piece of evidence lived in a log that GitHub eventually expires, so
diagnosing a failure meant scrolling a live log — the exact "truncated failure
log used as final diagnosis" failure mode.

Everything below is uploaded **even when the job fails**, which is when it
matters.

## Pull-request evidence — 14 days

| Artifact                       | From                        | Contents                                                                                                                                                                                  |
| ------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence-change-detection`    | `change-detection`          | `classification.json`, `changed-files.txt`                                                                                                                                                |
| `evidence-static-quality`      | `static-quality`            | `workflow-security.json`, `route-parity.json`, `test-honesty.json`, `openapi-totals.json`                                                                                                 |
| `evidence-unit-coverage`       | `unit-tests-coverage`       | `vitest-unit.json`, `test-totals-unit.json`, `coverage-gate.json`, `coverage-summary.json`, `coverage-final.json`                                                                         |
| `coverage-html-unit`           | `unit-tests-coverage`       | full HTML coverage report                                                                                                                                                                 |
| `evidence-build`               | `application-build`         | `build-size.json`, `env-contract.json`, `build.log`, `build-warnings.txt`                                                                                                                 |
| `evidence-migration-replay`    | `database-migration-replay` | `migration-replay.json`, `migration-static/pre/post.json`, `migration.log`, `seed.log`, `schema-hash.txt`, `schema-inventory.json`, `structural-review.json`                              |
| `evidence-security-matrix`     | `database-security`         | `vitest-db.json`, `test-totals-database.json`, `rls-matrix.json`                                                                                                                          |
| `evidence-integration-tests`   | `integration-tests`         | `vitest-backend.json`, `test-totals-backend.json`, `coverage-gate-backend.json`, `idempotency-evidence.json`, `correlation.json`                                                          |
| `evidence-dependency-security` | `dependency-security`       | `audit-production.json`, `audit-full.json`, `outdated.json`, `licences.json`, `dependency-policy.json`                                                                                    |
| `evidence-code-security-*`     | `code-security`             | CodeQL SARIF per language                                                                                                                                                                 |
| `evidence-container-security`  | `container-security`        | `trivy-image.json`, `trivy-image.sarif`, `hadolint.sarif`, `container-policy.json`, `image-metadata.json`, `image-env.json`, `image-history.txt`, `container.log`, `health-response.json` |
| `evidence-secret-scan`         | `secret-scan`               | `workflow-security.json`, `worktree-scan.json`                                                                                                                                            |
| `evidence-hosted-clean-room`   | `hosted-clean-room`         | `clean-room-pre.json`, migration and seed logs, `clean-room-structural.json`, `clean-room-rls.json`, `schema-hash-before.txt`, `schema-hash-after.txt` — **30 days**                      |
| `evidence-ci-gate`             | `ci-gate`                   | `ci-gate.json`, `ci-gate.md`, `needs.json` — **30 days**                                                                                                                                  |

## Protected-branch evidence — 30 days, gate 90

`evidence-protected-gate` holds `protected-gate.json`, `protected-gate.md`,
`needs.json` and the synthetic `classification.json`. This is the artifact a
phase gate record cites, hence the longest pull-request-tier retention.

## Nightly evidence — 60 days, gate and performance 90

| Artifact                       | Contents                                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| `evidence-full-rls-matrix`     | complete role × table × action matrix, every application schema        |
| `evidence-mutation-assurance`  | `mutation-report.json` — killed, survived, error, per guard            |
| `evidence-performance`         | `performance.json`, `performance-gate.json`, query plans — **90 days** |
| `evidence-backup-restore`      | `backup-restore.json`. **The dump itself is never uploaded**           |
| `evidence-secret-scan`         | `history-scan.json` — file and pattern class only                      |
| `evidence-dependency-security` | deep audit and outdated inventory                                      |
| `evidence-container-security`  | deep scan including unfixable findings                                 |
| `evidence-nightly-gate`        | `nightly.json`, `nightly.md` — **90 days**                             |

## Release evidence — 365 days

| Artifact              | Contents                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release-evidence`    | `sbom.spdx.json`, `sbom-digest.txt`, `image-tar-digest.txt`, `trivy-release.json`, `release-manifest.json`, `release-state.json`, `provenance-bundle.jsonl`, `provenance-verification.txt` |
| `release-eligibility` | `release-eligibility.json` — the staging-eligibility decision                                                                                                                              |
| `production-gate`     | `production-gate.md` — preconditions checked, deployment refused                                                                                                                           |

A year, because a release record is what you need long after everyone has
forgotten what shipped. The image tarball is **not** uploaded: hundreds of
megabytes, reproducible from the recorded source commit, and its digest is
recorded instead.

## What is never retained

- **Database contents.** The backup drill uploads its verification result, never
  the dump.
- **Secret values.** Scanners record file and pattern class only. `image-env.json`
  is uploaded precisely because the job fails if it contains a credential.
- **Source archives.** Everything is reproducible from the recorded SHA.
- **Customer or pilot data.** None exists in any environment CI can reach.

## Machine-readable first

Every artifact is JSON. Markdown summaries are generated _from_ that JSON, never
written independently — two hand-maintained representations of the same fact
drift, and the one people read drifts first.

This is also what makes `ci-gate` possible: it downloads every `evidence-*`
artifact and reads the numbers out of them, rather than re-deriving figures that
could disagree with what each job actually measured.
