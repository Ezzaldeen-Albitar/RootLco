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

P1-23 is closed and promoted: `docs/phase-1/phase-1-23/` carries
`gate-record.md` and `promotion-record.md`, `origin/develop` is an ancestor of
`origin/main`, and the two trees are byte-identical. P1-25 has not started — no
branch, no PR, no `docs/phase-1/phase-1-25`, no file mentioning it.

### Canonical documentation structure

The brief names `documentation/04-chapter-03-requirements.md` and siblings. **No
`documentation/` directory exists in this repository.** The canonical pattern is
`docs/phase-1/phase-1-NN/` with an `evidence/` subdirectory, established from P1-18
onward and used unchanged here. §5 forbids inventing a parallel structure when a
canonical one exists, so P1-24 evidence lives at `docs/phase-1/phase-1-24/`.

## Commits

| SHA       | Wave | Contents                                                                            |
| --------- | ---- | ----------------------------------------------------------------------------------- |
| _pending_ | 0–2  | operation register, IAM route depth, derived-floor extension, F-002 and F-003 fixes |

## Findings

See [`findings.md`](findings.md). Summary: **P1-24-F-001** (High, fixed) — 39
operations outside the derived-evidence floor; **P1-24-F-002** (High, fixed) — every
public operation bypassed the error pipeline; **P1-24-F-003** (Low, fixed) — the
published contract understated its own scope. Two recorded non-findings, both
measurement errors of mine, kept for the lesson.

## Wave status

| Wave | Subject                                           | State                                      |
| ---- | ------------------------------------------------- | ------------------------------------------ |
| 0    | live ground truth, previous closure verification  | complete                                   |
| 1    | feature foundation, integrated operation register | complete                                   |
| 2    | API and contract validation                       | complete                                   |
| 3    | cross-domain integration proof                    | pending                                    |
| 4    | transaction and rollback verification             | pending                                    |
| 5    | RLS and isolation reproof                         | complete for `iam.`/`meta.`; sweep pending |
| 6    | authorization and privilege-escalation review     | complete for `iam.`/`meta.`; sweep pending |
| 7    | error-path coverage                               | in progress                                |
| 8    | concurrency verification                          | pending                                    |
| 9    | idempotency and replay safety                     | pending                                    |
| 10   | performance verification                          | pending                                    |
| 11   | audit verification                                | pending                                    |
| 12   | event and outbox delivery verification            | pending                                    |
| 13   | file-security verification                        | pending                                    |
| 14   | OpenAPI completion                                | complete                                   |
| 15   | CI, observability, operational readiness          | pending                                    |
| 16   | documentation and traceability synchronization    | in progress                                |
| 17   | adversarial security and correctness review       | pending                                    |
| 18   | mutation testing                                  | pending                                    |
| 19   | full local verification                           | pending                                    |
| 20   | clean-room exact-SHA reproof                      | pending                                    |
| 21   | feature Pull Request preparation                  | pending                                    |
| 22   | hosted CI and PR readiness                        | pending                                    |

## Measured surface

| Measure                            | Value                                          |
| ---------------------------------- | ---------------------------------------------- |
| Public operations                  | 226                                            |
| Backend modules                    | 19                                             |
| OpenAPI paths                      | 195                                            |
| OpenAPI operations                 | 226                                            |
| Shared component schemas           | 3 (`ProblemDocument`, `Money`, `PageEnvelope`) |
| Published error codes              | 28 — the whole catalog                         |
| Permission codes seeded            | 104                                            |
| Audit actions catalogued           | 153                                            |
| Domain events catalogued           | 50                                             |
| Route files under `src/app/api/v1` | 195                                            |
| Migrations                         | 119, no 120                                    |

Request and response bodies are inline per operation rather than named components;
the three shared schemas are the cross-cutting ones. That is a design choice, recorded
here so "3 schemas" is not read as a coverage gap.

## Commands executed, with outcomes

| Command                                                          | Outcome                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `node scripts/p1-24-operation-register.mjs`                      | 226 operations, 226 Covered, 0 failures                 |
| `node scripts/check-operation-test-coverage.mjs`                 | OK — 226 operations, 0 invocation-only                  |
| `npm run validate:openapi`                                       | OK — 195 paths, 226 operations, every operation guarded |
| `npm run validate:authorization-coverage`                        | OK — every operation guarded, every route registered    |
| `npm run typecheck`                                              | clean                                                   |
| `npx vitest run tests/backend/p1-24-iam-route-depth.test.ts`     | 87/87                                                   |
| `UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts` | 4/4, document regenerated                               |

## Next action

Wave 3 — cross-domain integration proof (`P1-24-BE-002`, `TC-INT-001`,
`TC-P1-24-001`, `TC-P1-24-002`): the full workshop journey across the real domain
contracts.
