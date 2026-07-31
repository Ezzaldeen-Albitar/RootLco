# P1-24 — execution checkpoint

Durable recovery record. Updated after every wave and after every candidate SHA
change. If context is lost, resume from here plus `git status`, `git log`, the GitHub
PR state, and the GitHub Actions state — not from memory.

## Baseline (verified live, not recalled)

|                                    |                                                   |
| ---------------------------------- | ------------------------------------------------- |
| `P1_24_BASE_SHA`                   | `1c74454debfe0d75f521d2641fba0c20b03cdfe0`        |
| `P1_24_BASE_TREE`                  | `973f32c1d7c2b28541014607186fcc44e3c2d982`        |
| `origin/main` at start             | `db54acf1d09a3a8c499b6ee17660871ab8c410f9`        |
| `origin/main` tree at start        | `973f32c1d7c2b28541014607186fcc44e3c2d982`        |
| develop/main synchronized at start | **yes** — trees byte-identical, diff 0 files      |
| Branch                             | `feature/p1-24-backend-integration-release-gate`  |
| Worktree                           | `C:/Users/EZZALD~1/AppData/Local/Temp/claude/p23` |
| Migrations at start                | 119, no 120                                       |
| Open PRs at start                  | 0                                                 |
| Remote branches at start           | `develop`, `main` — nothing else                  |
| Starting condition                 | **A — clean and ready to start P1-24**            |

### The recorded SHAs in the assignment were stale, and that matters

The brief expected `origin/develop = 4a461ec6` and `origin/main = f7fa633a`. Those are
the **P1-23 closure** SHAs. Four governance gates have landed since, all on
2026-07-31: Main Branch Governance and Ruleset Alignment, Merged-Branch Cleanup and
Automatic Deletion, Final Pre-P1-24 Repository Reconciliation, and Final Local
Workspace Normalization. The live values above were read from the remote and are the
ones this phase is built on. Nothing was taken on trust.

### Prior closure verified

P1-23 is closed and promoted: `docs/phase-1/phase-1-23/` carries `gate-record.md` and
`promotion-record.md`, `origin/develop` is an ancestor of `origin/main`, and the two
trees are byte-identical. P1-25 has not started — no branch, no PR, no
`docs/phase-1/phase-1-25`, no file mentioning it.

### Two names in the brief do not match the repository

The brief names `documentation/04-chapter-03-requirements.md` and siblings. **No
`documentation/` directory exists in this repository.** The canonical pattern is
`docs/phase-1/phase-1-NN/` with an `evidence/` subdirectory, established from P1-18
onward and used unchanged here. §5 forbids inventing a parallel structure when a
canonical one exists, so P1-24 evidence lives at `docs/phase-1/phase-1-24/`.

Likewise the performance requirement is **`NFR-PERF-01`**, not `NFR-PERF-001`, and it
is cited by its real id throughout.

## Commits

| SHA       | Waves  | Contents                                                                                             |
| --------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `1d77396` | 0–2    | operation register; IAM route depth; derived floor extended to `iam.`/`meta.`; F-002 and F-003 fixes |
| `3f83cd7` | 3, 10  | cross-domain journey; read-path shape and the performance baseline                                   |
| `24ab9f0` | 12, 18 | hostile mutation matrix; event coverage matrix; CI wiring for both                                   |
| _pending_ | 16     | task traceability                                                                                    |

## Findings

See [`findings.md`](findings.md).

| ID                                                               | Severity | State |
| ---------------------------------------------------------------- | -------- | ----- |
| P1-24-F-001 — 39 operations outside the derived-evidence floor   | High     | Fixed |
| P1-24-F-002 — every public operation bypassed the error pipeline | High     | Fixed |
| P1-24-F-003 — the published contract understated its own scope   | Low      | Fixed |

Two recorded non-findings, both measurement errors of mine, kept for the lesson.

## Wave status

| Wave | Subject                                           | State                                                 |
| ---- | ------------------------------------------------- | ----------------------------------------------------- |
| 0    | live ground truth, previous closure verification  | complete                                              |
| 1    | feature foundation, integrated operation register | complete                                              |
| 2    | API and contract validation                       | complete                                              |
| 3    | cross-domain integration proof                    | complete                                              |
| 4    | transaction and rollback verification             | complete — verified, no gap                           |
| 5    | RLS and isolation reproof                         | complete                                              |
| 6    | authorization and privilege-escalation review     | complete — F-001                                      |
| 7    | error-path coverage                               | complete — F-002                                      |
| 8    | concurrency verification                          | complete — verified, no gap                           |
| 9    | idempotency and replay safety                     | complete                                              |
| 10   | performance verification                          | complete — baseline recorded, no threshold claimed    |
| 11   | audit verification                                | complete                                              |
| 12   | event and outbox delivery verification            | complete                                              |
| 13   | file-security verification                        | complete — verified, no gap                           |
| 14   | OpenAPI completion                                | complete — F-003                                      |
| 15   | CI, observability, operational readiness          | complete                                              |
| 16   | documentation and traceability synchronization    | complete                                              |
| 17   | adversarial security and correctness review       | complete — the mutation matrix is its executable half |
| 18   | mutation testing                                  | complete — 6/6 caught                                 |
| 19   | full local verification                           | in progress                                           |
| 20   | clean-room exact-SHA reproof                      | pending                                               |
| 21   | feature Pull Request preparation                  | pending                                               |
| 22   | hosted CI and PR readiness                        | pending                                               |

## Measured surface

| Measure                                      | Value                                          |
| -------------------------------------------- | ---------------------------------------------- |
| Public operations                            | 226                                            |
| Backend modules                              | 19                                             |
| Operations classified `Covered`              | 226                                            |
| Operations `Partially covered` / `Uncovered` | 0 / 0                                          |
| OpenAPI paths                                | 195                                            |
| OpenAPI operations                           | 226                                            |
| Shared component schemas                     | 3 (`ProblemDocument`, `Money`, `PageEnvelope`) |
| Published error codes                        | 28 — the whole catalog                         |
| Permission codes seeded                      | 104                                            |
| Audit actions catalogued                     | 153                                            |
| Domain events catalogued                     | 50 (47 produced, 3 reserved)                   |
| Foreign writers of `shared.event_outbox`     | 0                                              |
| Migrations                                   | 119, no 120                                    |

Request and response bodies are inline per operation rather than named components;
the three shared schemas are the cross-cutting ones. Recorded here so "3 schemas" is
not read as a coverage gap.

## Commands executed, with outcomes

| Command                                             | Outcome                                                     |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `node scripts/p1-24-operation-register.mjs --check` | OK — 226 operations, 0 reconciliation failures              |
| `node scripts/p1-24-mutation-matrix.mjs`            | 6/6 CAUGHT, 0 survived, 0 stillborn                         |
| `node scripts/check-operation-test-coverage.mjs`    | OK — 226 operations, 0 invocation-only                      |
| `npm run validate:openapi`                          | OK — 195 paths, 226 operations, every operation guarded     |
| `npm run validate:authorization-coverage`           | OK                                                          |
| `node scripts/ci/check-workflow-security.mjs`       | 17 files, 14 rules, no findings                             |
| `node scripts/ci/check-run-block-syntax.mjs`        | 129 blocks, 0 invalid                                       |
| `npm run typecheck`                                 | clean                                                       |
| `npm run lint`                                      | clean                                                       |
| `npm run format:check`                              | clean                                                       |
| `npm run validate:encoding`                         | OK                                                          |
| `npm run test`                                      | 1285 / 1285                                                 |
| `npm run test:backend`                              | 1739 / 1739 at `1d77396`; re-run at the final candidate SHA |

## Next action

Wave 19 — finish the full local gate battery at the final candidate SHA, then the
clean-room reproof (Wave 20), then push and open the feature Pull Request (Wave 21)
and wait for hosted CI (Wave 22).

**The owner gate is not recorded here and must not be.** P1-G24 remains Pending until
the owner merges the feature PR and a separate post-merge process verifies protected
`develop`.
