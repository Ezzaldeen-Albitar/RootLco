# Phase 1-27 — clean-room evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

A clean room answers one question: **does this exact tree verify from nothing?**
Not "does it verify on the machine that built it", where a stale `node_modules`,
a warm cache or a file that was never committed can all carry the result.

---

## What was measured

A fresh `git clone`, checked out at the exact SHA, `npm ci` from the lockfile,
then every tier run in that copy.

| property                       | value                                      |
| ------------------------------ | ------------------------------------------- |
| Clean-room path                | `C:\cr27`                                   |
| Tree hash vs the source checkout | **identical**, verified by `rev-parse HEAD^{tree}` |
| Working tree                   | 0 dirty files                               |
| `npm ci`                       | exit 0                                      |
| `format:check` root / web / api | clean                                      |
| `typecheck` (web)              | 0 errors                                    |
| `lint` (web)                   | 0 errors                                    |
| `build:web`                    | compiled                                    |
| Web unit + component suite     | 752 passed, 37 files                        |
| Repository suite               | 1640 passed, 74 files                       |
| `validate:*` gates             | 40 of 42 pass — the two exceptions are named below |

## The two gates that cannot pass in a clean room, and why

Both are properties of **where the clean room is** and **what the shared database
contains**. Neither is a property of the tree, and reporting either as a tree
failure would be as wrong as reporting the green tiers as a pass.

**`validate:canonical-docs`.** The Owner's two canonical DOCX files live *beside*
the repository, not inside it — `../RootLco_Phase_1_Development_Plan_recovered_v01.docx`.
A clone at `C:\cr27` has no such sibling. The gate verifies the Owner's documents
were not modified; with nothing to read it correctly refuses to report clean. It
passes in the source checkout, where the documents are present.

**`validate:seed-state`.** The gate asserts business tables are empty before seed
execution. The shared local PostgreSQL now holds the **Owner-acceptance
fixtures** — two tenants, five identities, roles and grants — created
deliberately in Wave 16 so the Owner can sign in at all. The clean room shares
that database; it does not get its own.

This gate also fails in the source checkout, for the same reason, and that is
**correct behaviour rather than a defect to work around**. It was not weakened,
its threshold was not raised, and no dirty-database baseline was recorded.
Hosted CI runs it against a clean database and it passes there, which is the
authoritative answer.

## Two ways the first clean room lied

**The build never ran.** The first clean room was cloned under the session
scratchpad. Everything passed except `build:web`, which failed with
`TurbopackInternalError: path length … exceeds max length of filesystem` — the
generated chunk name for `CustomerProfileScreen` plus a long scratchpad prefix
crosses Windows' `MAX_PATH`. Reporting that as a build failure would have been a
statement about the tree that was really a statement about a directory name. The
clean room was moved to `C:\cr27`, where the build compiles.

**The phase-ownership gate accused this branch of changing `apps/api`.** Thirteen
API files, each reported as "a Frontend phase must not change API source".

The cause was the clone, not the branch. `git clone` from the *local* working
copy makes the clone's `origin/develop` point at the working copy's **local**
`develop` branch — which was stale at `2f9df6f`, before the P1-17 backend
remediations merged. The gate diffed against a develop that predated those
commits and correctly reported that files had changed relative to it. Those
changes arrived *from* develop through a merge; they are not this branch's.

Pointing the clean room's `origin` at the real GitHub remote and fetching
`develop` (`592a316`) makes the merge-base correct, and the gate reports **101
changed files, 0 violations**.

A clean room cloned from the machine under test inherits that machine's stale
refs. It is meant to be independent of the working copy and, for anything that
diffs against a base, it silently was not.
