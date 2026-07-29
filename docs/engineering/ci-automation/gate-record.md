# RootLco Comprehensive CI/CD and Automated Assurance — gate record

Documentation only. This branch adds no executable file and changes no
executable file; its purpose is to record the decision and, in doing so, to make
the new pipeline validate a documentation-only pull request — the case in which
six jobs may legitimately skip and `hosted-clean-room` may not.

## Decision

**Go — RootLco Comprehensive CI/CD and Automated Assurance Gate Passed**

## Identity

|                       |                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Feature pull request  | [#89](https://github.com/Ezzaldeen-Albitar/RootLco/pull/89)                                        |
| Title                 | `ci(platform): build comprehensive automated assurance pipeline`                                   |
| Final reviewed SHA    | `acde82f3353553e784496898f4257ab4b18b6e53`                                                         |
| Automation merge SHA  | `3ec66c92e8f65488a8e8f1f475682de846a3a394`                                                         |
| Merge parent 1        | `0f8268ef80a51441625cfe93d037e7c0804f40fa` — protected `develop` (P1-21, closed Go)                |
| Merge parent 2        | `acde82f3353553e784496898f4257ab4b18b6e53` — the reviewed head                                     |
| Merge tree            | `97cbb8dff9c4d3ef880378a03ae7ae58d8ba2dc4`                                                         |
| Reviewed feature tree | `97cbb8dff9c4d3ef880378a03ae7ae58d8ba2dc4` — **byte-identical**                                    |
| File drift            | **0** files differ between the reviewed head and the merge                                         |
| Merge method          | merge commit — not squash, not rebase                                                              |
| `origin/main`         | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — **unchanged**, and the merge is not an ancestor of it |
| Migrations            | 119, no `120` prefix — no phase work leaked in                                                     |

## Hosted evidence

### Final feature head — `acde82f`

|                              |                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| PR CI                        | run 23 (`30437614187`) — 14/14 successful                                                                |
| `ci-gate`                    | **Go**, `expectedSha === actualSha === acde82f…`, 12 governed jobs all positively accepted, none skipped |
| Legacy CI                    | run 304 (`30437612187`) — 4/4 successful                                                                 |
| **Check-runs on the commit** | **19/19 successful**, including `CodeQL`: _"No new alerts in code changed by this pull request"_         |

The last row is the one that matters, and it is stated separately on purpose.
A workflow run reporting 14/14 is a claim about one workflow. The commit carries
nineteen checks, one of which — `CodeQL`, produced by GitHub Advanced Security
from this pipeline's own SARIF — belongs to no workflow run and is invisible to
the endpoint that lists run conclusions. It was red on five consecutive heads
while every report said green (AR-52).

### Protected `develop` push — `3ec66c9`

|                                |                                                                            |
| ------------------------------ | -------------------------------------------------------------------------- |
| Protected branch verification  | run 1 (`30438394612`) — 13/13 successful, first execution of this workflow |
| `protected-gate`               | success                                                                    |
| `hosted-clean-room`            | success — on the protected push, where it cannot be skipped                |
| Legacy CI                      | run 305 (`30438394294`) — 4/4 successful                                   |
| Check-runs on the merge commit | **17/17 successful**                                                       |

### Hosted clean room

Replayed from an empty PostgreSQL 17 service container at the exact head:
119 migrations in tree, **0 tables before**, schema hash
`a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` reproduced
**both before and after seeding**. 242 live tables, 999 indexes, 537 foreign
keys; every foreign key validated, no runtime-reachable destructive cascade,
complete FK index coverage, no duplicate indexes, zero dictionary drift.

## Workflow and job inventory

**9 reusable workflows** · **7 top-level workflows** · **1 composite action** ·
**23 scripts in `scripts/ci`** · **10 baselines** · **25 documents** ·
**14 workflow-security rules**. Reconciled against the filesystem on every run
by `tests/ci/documented-counts.test.ts`, because these numbers drifted once
already (AR-51).

`pr-ci.yml` declares **12 governed jobs plus `ci-gate` = 13**, reporting as
**14 checks** — `code-security` is a two-language matrix. The three figures are
different and are not interchangeable.

`nightly-assurance.yml`: **11 jobs + `nightly-gate`**. It has never executed; a
`schedule:` trigger fires only from the default branch, so the first nightly
runs after this merge.

## Baselines

Established from PR CI run 19 (`30431556718`) at `8d7bfff`, re-proved by run 20.
Per-number provenance in
[`evidence/hosted-baselines.md`](evidence/hosted-baselines.md).

| Baseline                 | Value                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Unit coverage            | 93.26 / 93.26 / 84.75 / 93.61 — confirmed, deliberately **not** lowered to the 84.43 / 93.41 measured |
| Backend coverage         | **86.38 / 86.38 / 86.73 / 80.08** — never measured before this initiative                             |
| Backend critical modules | 6 floors promoted from planned to enforced; the 7th withheld because its prefix matches no file       |
| Build size               | **34,367,299** standalone bytes (ratcheted) · 632,213 static · 66,333,419 total                       |
| Image size               | **202,909,674** bytes, uncompressed, 12 layers                                                        |
| Image digest             | provenance only — a local config ID, not a registry digest, and not reproducible                      |
| Structural               | 242 tables · 514 functions · 631 policies · 541 triggers · 0 SECURITY DEFINER                         |
| Seeded structural tables | 7 catalogs, enumerated from a clean database — **no business data**                                   |
| Migration count          | 119 · schema hash `a677eb05…` · 100 permissions                                                       |
| Test counts              | unit 1107 · database 1624 · backend 1380; floors 1050 / 1550 / 1300                                   |
| Performance              | **unset** — its job lives in nightly, which has never run                                             |

## Assurance results

| Area                   | Result                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Migration replay       | 119 from zero, schema hash re-derived, 0 tables before                                            |
| RLS                    | full role × table × action matrix; 631 policies; 0 SECURITY DEFINER; no unforced RLS table        |
| Integration            | 1380 backend tests through the real Route Handler boundary                                        |
| Idempotency            | 199 operations, 107 declared idempotent, 97 proven, 10 waived with owners and expiry              |
| Dependency security    | production **0** advisories; development 12 nodes / 1 advisory, all waived, itemised and expiring |
| CodeQL / SAST          | `javascript-typescript` and `actions`; **no new alerts**                                          |
| Container security     | 0 CRITICAL/HIGH, 0 secrets, 0 failed misconfigurations; uid 1001; live `/api/health`              |
| Secret scanning        | git history and build output, 3716 files; no matched value ever recorded                          |
| Workflow security      | 17 files × 14 rules, 0 findings, rule count published in the artifact                             |
| Shell syntax           | 126 multi-line `run:` blocks parsed with `bash -n`, 0 invalid                                     |
| Scanner anti-blindness | package enumeration asserted; `vuln` scanner presence asserted; workflow rule count asserted      |
| Action pinning         | every action pinned to a full commit SHA with a version comment, enforced                         |

## brace-expansion — owner approval

**Production dependency advisories: Resolved through compatible patch upgrades.**

**brace-expansion advisory: Open — upstream-blocked development-tooling
exception with no proven production or runtime reachability.**

Approved by the platform owner on **2026-07-29**, with the seven-point basis and
the explicit scope limits recorded verbatim in the entry. Approval is a
**control**: `dependency-policy.mjs` requires `approvalStatus: "approved"` with a
named approver and an ISO date, and an unapproved entry waives nothing.

One advisory (`GHSA-mh99-v99m-4gvg`), one package, one range (`<=5.0.7`), one
dependency-path fingerprint, review 2026-09-30, expiry **2026-10-31**.

**The code is not absent from the image, and nothing here claims it is.** Node
vendors brace-expansion into the `node` binary via esbuild, so a copy ships in
any image containing a Node runtime and no build step removes it. The claim that
is true and sufficient is narrower: the running application cannot resolve or
invoke it. The exception record keeps `finalContainerCodePresent: true` and
`finalContainerReachable: false` as separate fields so the two cannot be
collapsed.

## Ruleset migration

Applied to the `develop` ruleset (`19896821`) only, after `ci-gate` was proven
on the feature pull request and `protected-gate` on the protected push.

| Setting                    | Before                      | After                                    |
| -------------------------- | --------------------------- | ---------------------------------------- |
| Pull request required      | yes                         | yes                                      |
| Allowed merge methods      | `merge`, `squash`, `rebase` | **`merge` only**                         |
| Required status checks     | 4 legacy `ci.yml` job names | **5** — the same four **plus `ci-gate`** |
| Strict (up-to-date) policy | `false`                     | `false` — retained                       |
| Deletion                   | blocked                     | blocked                                  |
| Force push                 | blocked                     | blocked                                  |
| Bypass actors              | none                        | none                                     |

The four legacy checks were **kept, not replaced**. Removing them is rollout
step 10 and belongs in its own reviewable pull request. `ci-gate` could only be
added safely because `pr-ci.yml` carries no top-level `paths:` filter — a
required check that never runs stays Pending forever and blocks the merge with
no failure to diagnose (CSA-06).

**`main` promotion rules were not altered.** The `Protect main` ruleset
(`19896793`) is unchanged; promotion remains a founders' reserved decision
(ADR-006).

## Adversarial findings

**52 findings, AR-01 through AR-52, across six review passes. Critical
unresolved: 0. High unresolved: 0.**

**Eleven were defects inside this initiative's own remediations.** Three arrived
after a run had already reported success, and those are the ones worth carrying:

- **AR-45** — the pipeline was 14/14 while one of its own scanners enumerated
  zero packages and reported zero vulnerabilities.
- **AR-49** — the published reachability proof claimed the vulnerable code was
  absent from the image. False, and the exact wording the owner's approval
  forbids. Found by reading a green run's artifacts.
- **AR-52** — a `CodeQL` check red on five consecutive heads, invisible to the
  endpoint being read. It was objecting to a vacuous-assertion rule whose
  unbound back reference meant it had **never fired**, and to a CRITICAL
  workflow rule one list-entry away from silently matching the wrong text.

One structural finding (**AR-27**) is documented rather than fixed: on a
`pull_request` the workflow, the action, the gate scripts and the baselines all
come from the PR head, so the gate is self-certifying. That is inherent to the
trigger. The protected-push run recorded above is what closes it, and it is why
this gate record exists.

## Open items, recorded rather than hidden

- **10 IAM operations declare `idempotent: true` with no replay evidence.**
  Itemised with owners, expiry 2026-10-31. Any new one fails immediately.
  Branch `fix/p1-14-idempotency-replay-evidence` carries replay tests for
  exactly these ten; when it lands, these exceptions become stale and nothing
  will flag the overlap automatically.
- **The idempotency exceptions have no approval concept.** The dependency
  exception now requires a signature; a correctness-evidence waiver does not.
  Making them consistent would red the pipeline until ten entries are approved.
- **`audit-and-outbox` backend coverage is 40.45%** — this tier's weak spot.
- **`touchedFileMinimum: 0` on the backend tier**, where unit uses 60. Choosing
  a value needs a measured distribution; inventing one would be the guessed
  threshold the baselines were held back to avoid.
- **P1-21-A-01**: Secret Scanning, Push Protection, Dependabot alerts and the
  Dependency graph remain **disabled**. Owner settings changes.
- **`apk` versions unpinned** (hadolint DL3018, four sites), suppressed per line
  with the reason recorded.

## Gate matrix

| #   | Condition                                                             | Result |
| --- | --------------------------------------------------------------------- | ------ |
| 1   | Feature PR open against `develop`, no conflicts                       | Met    |
| 2   | Final reviewed SHA identical across local, remote and PR head         | Met    |
| 3   | PR CI 14/14 at the exact head                                         | Met    |
| 4   | `ci-gate` Go with `expectedSha === actualSha`                         | Met    |
| 5   | All 19 check-runs on the commit successful                            | Met    |
| 6   | Hosted clean room executed and succeeded                              | Met    |
| 7   | Legacy CI 4/4 retained and green                                      | Met    |
| 8   | Merged with a merge commit, not squash or rebase                      | Met    |
| 9   | Merge tree byte-identical to the reviewed tree, 0 file drift          | Met    |
| 10  | Second parent is the reviewed head; first is protected `develop`      | Met    |
| 11  | Protected push verification 13/13, `protected-gate` success           | Met    |
| 12  | Baselines established from hosted artifacts with full provenance      | Met    |
| 13  | Owner approval of the brace-expansion exception recorded and enforced | Met    |
| 14  | Production dependency advisories 0                                    | Met    |
| 15  | Critical unresolved 0, High unresolved 0                              | Met    |
| 16  | `origin/main` unchanged                                               | Met    |
| 17  | No direct push to a protected branch                                  | Met    |
| 18  | No deployment to staging or production                                | Met    |
| 19  | No P1-22 work, no migration 120                                       | Met    |
| 20  | Ruleset migrated with legacy checks retained                          | Met    |
| 21  | `main` promotion rules unaltered                                      | Met    |

## Pending

Recorded here rather than resolved, because each is a decision or a measurement
this change cannot make:

1. **Removal of the four legacy `ci.yml` required checks**, and deletion of
   `ci.yml` — rollout step 10, its own pull request.
2. **The performance baseline**, which the first nightly after this merge
   records.
3. **The GitHub-native security features** in P1-21-A-01.
4. **Promotion to `main`**, a founders' reserved decision (ADR-006).
