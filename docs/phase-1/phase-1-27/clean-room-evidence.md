# Phase 1-27 — clean-room evidence

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act against the running application; it is not derivable from any count in this repository and cannot be inferred from silence.

**Classification:** Confidential — Commercial Product and Pilot Planning

A clean room answers one question: **does this exact tree verify from nothing?**
Not "does it verify on the machine that built it", where a stale `node_modules`,
a warm cache or a file that was never committed can all carry the result.

---

## The two SHAs, and why they cannot be one

A measurement changes the tree it is recorded in. The commit that writes this
page is necessarily a descendant of the commit the page describes, so a document
that names a single head is either describing its own parent without saying so or
naming a head it never ran against. This one names both:

| property              | value                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| `CODE_CANDIDATE_SHA`  | `356f1a1e937e819b9db94f40a2d6f04f98f9ae39`                                   |
| `EVIDENCE_RECORD_SHA` | the commit carrying this file — a descendant, **documents only**             |

The distinction is only harmless because of the second half: the recording
commits change documents and nothing else, so every code-derived number below is
identical at both heads. `tests/ci/p1-27-evidence-manifest.test.ts` re-derives
the counts from the repository on every run rather than trusting this page, which
is what makes that claim checkable instead of asserted.

This is the honest shape of the problem, not a workaround for it. The audit's
complaint was never that two SHAs existed — it was that the page pinned one,
seven characters long, forty-seven commits behind the tree, and said nothing.

---

## What was measured

A fresh `git clone`, checked out at the exact SHA, `npm ci` from the lockfile,
then every tier run in that copy.

| property                          | value                                              |
| --------------------------------- | -------------------------------------------------- |
| Clean-room path                   | `C:\cr27f`                                          |
| Tree hash vs the source checkout  | **identical**, verified by `rev-parse HEAD^{tree}`  |
| Working tree                      | 0 dirty files                                       |
| `npm ci`                          | exit 0                                              |
| `format:check` root / web / api   | clean                                               |
| `typecheck` root / web / api      | 0 errors                                            |
| `lint` root / web                 | 0 errors                                            |
| `build:web`, `build:api`          | compiled                                            |
| Web tier                          | **1216** tests, 0 failed, across 65 web test files  |
| Root unit tier                    | **1762** tests, 0 failed, across 82 files           |
| `verify:policies`                 | pass                                                |
| `verify:contracts`                | pass                                                |
| `verify:inventories`              | pass                                                |
| `verify:classifications`          | pass                                                |
| `validate:*` exceptions           | two, named below, both properties of the room       |

The web figure is the count `tests/ci/p1-27-evidence-manifest.test.ts` reconciles
against the tree: **65 web test files** on disk, every one of them matched by a
`vitest` project. That last clause is a separate assertion for a reason — the
`logic` project includes `tests/**/*.test.ts` and `dom` includes
`tests/**/*.dom.test.{ts,tsx}`, so a plain `*.test.tsx` matches neither and would
sit in the tree looking like coverage while running nowhere.

## Hosted corroboration at the same head

A local clean room and a hosted runner fail differently, and neither is a
superset of the other. Both were run at `CODE_CANDIDATE_SHA`:

| measure                    | value                                                     |
| -------------------------- | --------------------------------------------------------- |
| Workflow run               | `31312531302` — PR #214                                    |
| Required checks            | **20 completed, 0 failed, 0 pending**                      |
| `ci-gate` decision         | **Go**                                                     |
| Web tests                  | 1216 passed, 0 failed                                      |
| Unit tests                 | 1762 passed, 0 failed                                      |
| Backend tests              | 1842 passed, 0 failed                                      |
| Database tests             | 1647 passed, 0 failed                                      |
| Coverage — lines / branches | 95.53% / 93.89%                                           |
| Migrations applied         | 120                                                        |
| Schema hash                | `f6b4f023d9e6b1e7d823dac4e5550379202a216ab1ae1fe9e5a2826703061f79` |
| Application tables before migration | 0                                                 |
| RLS matrix                 | 113 tables, 1356 cells, 0 RLS disabled, 0 unforced, 0 `SECURITY DEFINER` |
| CodeQL open alerts         | **0**, repository-wide                                     |
| `npm audit` production / development | 0 / 0 advisories, 0 prohibited packages          |

The hosted clean-room job re-derived the schema hash before and after migration
replay and got the same value both times, which is the check that a migration
series is a function of its files rather than of the order someone ran them in.

## The two gates that cannot pass in a clean room, and why

Both are properties of **where the clean room is** and **what the shared database
contains**. Neither is a property of the tree, and reporting either as a tree
failure would be as wrong as reporting the green tiers as a pass.

**`validate:canonical-docs`.** The Owner's two canonical DOCX files live *beside*
the repository, not inside it — `../RootLco_Phase_1_Development_Plan_recovered_v01.docx`.
A clone has no such sibling. The gate verifies the Owner's documents were not
modified; with nothing to read it correctly refuses to report clean. It passes in
the source checkout, where the documents are present.

**`validate:seed-state`.** The gate asserts business tables are empty before seed
execution. The shared local PostgreSQL holds the **Owner-acceptance fixtures** —
two tenants, five identities, roles and grants — created deliberately so the
Owner can sign in at all. The clean room shares that database; it does not get
its own.

This gate also fails in the source checkout, for the same reason, and that is
**correct behaviour rather than a defect to work around**. It was not weakened,
its threshold was not raised, and no dirty-database baseline was recorded. Hosted
CI runs it against a clean database and it passes there — `Application tables
before migration: 0` in the table above is that answer.

---

## Superseded measurements

Kept, not overwritten. Deleting them would erase the only evidence that the drift
happened, and the next reader would have no reason to distrust the next stale
number. `P1-27-QA-005` exists because of the first row.

| head       | what it recorded                     | why it is superseded                                                                                                                  |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `36fccbc`  | web 752 tests / 37 files             | Superseded within the same wave when the pre-merge adversarial review added `server-vocabularies.test.ts`.                              |
| `e14984e`  | web 763 / 38, repository 1640 / 74   | **The defect `QA-005` names.** It stayed on this page while the tree moved 47 commits and 5 test files past it, and nothing noticed because nothing was comparing the number to the repository. |
| `d0a6008`  | no clean-room record at all          | The head the independent audit was briefed against. It had no clean-room or hosted-CI evidence of its own, which was the other half of the finding. |

## Two ways the first clean room lied

**The build never ran.** The first clean room was cloned under the session
scratchpad. Everything passed except `build:web`, which failed with
`TurbopackInternalError: path length … exceeds max length of filesystem` — the
generated chunk name for `CustomerProfileScreen` plus a long scratchpad prefix
crosses Windows' `MAX_PATH`. Reporting that as a build failure would have been a
statement about the tree that was really a statement about a directory name. The
clean room was moved to a short path, where the build compiles. Every clean room
since has used one.

**The phase-ownership gate accused this branch of changing `apps/api`.** Thirteen
API files, each reported as "a Frontend phase must not change API source".

The cause was the clone, not the branch. `git clone` from the *local* working
copy makes the clone's `origin/develop` point at the working copy's **local**
`develop` branch — which was stale, before the P1-17 backend remediations merged.
The gate diffed against a develop that predated those commits and correctly
reported that files had changed relative to it. Those changes arrived *from*
develop through a merge; they are not this branch's.

Pointing the clean room's `origin` at the real GitHub remote and fetching
`develop` makes the merge-base correct, and the gate reports 0 violations.

A clean room cloned from the machine under test inherits that machine's stale
refs. It is meant to be independent of the working copy and, for anything that
diffs against a base, it silently was not.

---

**P1-27 remains `OWNER ACCEPTANCE: FAIL`.** A verifying tree is not an accepted
phase, and this document does not claim otherwise.
