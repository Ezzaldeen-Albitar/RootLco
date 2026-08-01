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
| `bef3940` | 16     | task traceability; checkpoint                                                                        |
| `4ab5c3f` | 22     | F-004: closed the brace-expansion waiver; made the dependency gate testable with no exception        |
| `76632b0` | 22     | F-004 written up; checkpoint closed — **the reviewed feature head merged as `38d1ec2`**              |
| `2bf135e` | gate   | the gate record — documentation only; **merged as `0b68b7c9`**, protected `develop`                  |

## Findings

See [`findings.md`](findings.md).

| ID                                                               | Severity | State |
| ---------------------------------------------------------------- | -------- | ----- |
| P1-24-F-001 — 39 operations outside the derived-evidence floor   | High     | Fixed |
| P1-24-F-002 — every public operation bypassed the error pipeline | High     | Fixed |
| P1-24-F-003 — the published contract understated its own scope   | Low      | Fixed |
| P1-24-F-004 — the last dependency waiver had outlived its cause  | Medium   | Fixed |

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
| 19   | full local verification                           | complete                                              |
| 20   | clean-room exact-SHA reproof                      | complete                                              |
| 21   | feature Pull Request preparation                  | complete — PR #151                                    |
| 22   | hosted CI and PR readiness                        | complete                                              |
| 23   | owner merge of PR #151, protected-SHA reproof     | complete — `38d1ec2`, 17/17                           |
| 24   | gate record; PR #152; owner merge; reverification | complete — `0b68b7c9`, 17/17                          |
| 25   | canonical documentation completion                | complete — this branch                                |

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

| Command                                             | Outcome                                                 |
| --------------------------------------------------- | ------------------------------------------------------- |
| `node scripts/p1-24-operation-register.mjs --check` | OK — 226 operations, 0 reconciliation failures          |
| `node scripts/p1-24-mutation-matrix.mjs`            | 6/6 CAUGHT, 0 survived, 0 stillborn                     |
| `node scripts/check-operation-test-coverage.mjs`    | OK — 226 operations, 0 invocation-only                  |
| `npm run validate:openapi`                          | OK — 195 paths, 226 operations, every operation guarded |
| `npm run validate:authorization-coverage`           | OK                                                      |
| `node scripts/ci/check-workflow-security.mjs`       | 17 files, 14 rules, no findings                         |
| `node scripts/ci/check-run-block-syntax.mjs`        | 129 blocks, 0 invalid                                   |
| `npm run typecheck`                                 | clean                                                   |
| `npm run lint`                                      | clean                                                   |
| `npm run format:check`                              | clean                                                   |
| `npm run validate:encoding`                         | OK                                                      |
| `npm run test`                                      | 1285 / 1285 at `1d77396`; **1288 / 1288** at `0b68b7c9` |
| `npm run test:backend`                              | 1739 / 1739 at `1d77396`; **1752 / 1752** at `0b68b7c9` |

## Feature merge — Pull Request #151

Feature PR **#151** merged by the owner on 2026-08-01T07:08:51Z as merge commit
`38d1ec22ddaf3a6507c876e0a4ffff447de8b972`. First parent `1c74454d` (the protected
base), second parent `76632b05` (the reviewed feature). The merge tree is
`f7b06ecc5cf8072e0ed687933ce840834579d9f4` — **byte-identical** to the reviewed
feature tree, so no unreviewed executable change entered protected `develop`.

Protected merge-SHA CI: **17/17 green**, including the `protected-gate` aggregate,
across runs `30689149654` (CI) and `30689149773` (Protected branch verification).

A fresh clone at `38d1ec2` re-proved the candidate: unit 1288, backend 1752,
**database/RLS 1636 inside that clone**, total 4676, 0 failed, 0 skipped; mutation 6/6;
`npm audit` 0; migrations 119 with no 120 and a 0-file `supabase/` diff; schema hash
unmoved. All four findings re-proven against the protected tree, each with its
counterfactual re-run there.

The full record is [`gate-record.md`](gate-record.md).

## Gate merge — the event that closed the phase

The gate-record Pull Request **#152** was merged by the owner on 2026-08-01T07:59:35Z as
merge commit `0b68b7c9a3d6eebacce88c40dc9951d9d99b5d66`, first parent `38d1ec22` (the
feature merge), second parent `2bf135e6` (the reviewed gate commit). Its tree
`c6601886eddf36a4a67e4f6e62c78b449698a891` is **byte-identical** to the reviewed gate
tree, and the merge changed **2 files** against the feature merge — both under
`docs/phase-1/phase-1-24/`, **0** executable, test, script, workflow, manifest, Supabase,
migration or generated-contract files.

Protected merge-SHA CI on `0b68b7c9`: **17 checks, 17 success, 0 skipped, 0 failed**,
including the `protected-gate` aggregate, across runs `30690845932` (CI) and
`30690846041` (Protected branch verification).

`#152` itself ran **17 checks — 11 success and 6 authorized documentation-only skips**,
with `ci-gate` green. The skips are recorded decisions: `classify-changes.mjs` classified
the change set as `docs` only, `ci-gate` re-read that classification from the uploaded
artifact rather than a job output, and `evaluate-ci-gate.mjs` accepts a skipped job only
where the classification says it was not required. `hosted-clean-room` is on the
always-required list, so it ran on the documentation-only gate too.

## Status

**P1-G24 is closed on protected `develop` — Go.** Both closure conditions this phase set
for itself are met and evidenced in [`gate-record.md`](gate-record.md) §12: the owner
merged the gate Pull Request, and protected `develop` was re-verified afterwards for
merge shape, tree identity and a green protected-branch CI run on the new merge SHA.

## Next action

Promotion of the integrated `develop` into `main`, per ADR-006 §45 and §47 — a founders'
reserved decision, prepared and recorded in [`promotion-record.md`](promotion-record.md).
**P1-25 is not started**, and nothing in this phase starts it.
