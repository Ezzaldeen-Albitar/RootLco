# P1-23 — Documents, Notifications and Reporting Backend Gate Record

**Phase:** P1-23 — Documents, Notifications, and Reporting Backend
**Prerequisite:** Pre-P1-23 Dependency Maintenance Batch closed, `origin/develop` at
`9f7ef083ba90be3343aec2be1c721e3826070946` (tree `a921cae3`)
**Decision:** recorded in §12 below.

This is a **documentation-only** record. It changes no executable file, no test, no
script, no workflow, no lockfile, no Supabase file, no seed and no migration.

---

## 1. Scope delivered

**Seven** operations across two modules, against the **frozen** Phase 1-05 `shared` and
Phase 1-11 `rpt` schemas.

| Module            | Operations | Namespace |
| ----------------- | ---------- | --------- |
| `shared-services` | 5          | `shared.` |
| `reporting`       | 2          | `rpt.`    |

| Operation                            | Method | Audited |
| ------------------------------------ | ------ | ------- |
| `shared.notification-list`           | GET    | no      |
| `shared.notification-read`           | GET    | no      |
| `shared.notification-delivery-list`  | GET    | **yes** |
| `shared.document-read`               | GET    | no      |
| `shared.document-retention-evaluate` | POST   | **yes** |
| `rpt.report-catalogue`               | GET    | no      |
| `rpt.report-read`                    | GET    | no      |

**Seven, not eight.** `shared.notification-enqueue` is P1-15's and was miscounted into
this phase early on. `shared-services` is the first module this project has SHARED
between two phases, and it already carried 21 `shared.*` operations before P1-23 began.

**No migration.** 119 on disk, no `120`, none modified. Schema hash
`a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`, verified unchanged
locally and by the hosted clean room.

**No event is published.** Every operation is a read; the two audited ones record an
inspection, not a state change. `assertNoPhaseEvents` fails the gate if that ever changes,
so the claim is enforced rather than asserted.

---

## 2. The phase gate had to measure a SHARED module

P1-22's inventory script derives a phase's surface by ID PREFIX. Reused unchanged here,
that would have swept all 21 of P1-15's `shared.*` operations into P1-23 and reported a
surface four times the real one — while passing.

So `PHASE_OPERATIONS` is an explicit allowlist, and **check 6** re-derives it against
`origin/develop`: an operation this phase claims must genuinely be absent from the base
branch. That check is what makes the allowlist honest instead of merely asserted. It was
mutation-tested by adding `shared.notification-enqueue` to the list, and it fired.

P1-22's two `EVENT_CATALOG` checks were **removed** rather than carried across as checks
that can never fire. `assertNoPhaseEvents` replaces them.

The `ci` proof requires **both** links — a workflow runs the npm script name AND
`package.json` maps that name to the file. Either end alone passes while the chain is
broken, and it caught the mutation matrix being defined but unwired.

---

## 3. Both phase gates

```
operation-coverage:  7 registered · all [OK] · pending 0 · unreferenced 0
p1-23 inventory:     7 operations; permissions, audit actions and ALL 27 task
                     identifiers reconcile; generated documents current
mutation matrix:     9 mutations · 9 CAUGHT · 0 SURVIVED · 0 not applied
```

`rpt.` had never carried an operation, so it joined `DERIVED_PREFIXES` **and** the
`parseProvidedFlags` alternation together. A prefix in one but not the other reports a
vacuous `0/0` that reads like passing coverage. `shared.` needed no new hook.

---

## 4. Tests

| Tier    | Files | Tests |
| ------- | ----- | ----- |
| Unit    | 57    | 1267  |
| DB      | 138   | 1636  |
| Backend | 72    | 1651  |

Four new backend suites: notification reads, document retention, reporting, and
**positive authorization**.

---

## 5. The defect that matters most — a denial-only suite proves nothing

**Four of this phase's five declared permission codes did not exist in the platform
catalog**: `shared.notification.read`, `shared.notification.delivery.read`,
`shared.document.archive`, `rpt.report.read`. Every operation would have been refused for
every principal, forever.

**Every authorization test in the phase passed anyway.** All three evidence suites
asserted only DENIAL, and a permission that does not exist cannot be held by anybody, so
"this principal is refused" was true for a reason unrelated to authorization working.

Found by the phase gate's permission reconciliation, not by inspection or by any test.

The fix is `tests/backend/p1-23-authorization.test.ts`, which asserts the direction that
fails when a code is absent: a principal who HOLDS the permission is ALLOWED. Proven
load-bearing by mutation — deleting `rpt.report.read` from the catalog fails three
assertions there while the old denial-only reporting suite stays **10/10 green**.

The codes were added to `supabase/seeds/04_iam_permission_catalog.sql`, which is
idempotent and additive and is **not** a migration. Reusing P1-15's write codes was the
alternative and was rejected: it would have meant anyone who may enqueue a notification
may also read every recipient's inbox.

Two count pins moved with it, each in the same commit as the change:
`tests/db/p1-15-shared-services-runtime-capabilities.test.ts` and
`.github/ci-baselines/schema-baseline.json` `permissionCount`, 100 → **104**.

WHY ONLY FOUR CODES, AND NOT A FIFTH FOR DOCUMENT READS. `shared.document-read` reuses
`shared.document.manage` deliberately. Every existing document operation in the codebase
is gated by that code INCLUDING A READ — `GET /vehicles/{vehicleId}/documents` states it
explicitly — so the document surface already has one authority and splitting it here would
have left two conventions for one resource. Notifications and reports had no read
precedent at all: `shared.notification.send` guards enqueue and `rpt.report.configure` is
an administrative code, so a reader had nothing to be granted. The rule applied throughout
is "reuse where a read authority already exists, mint where none does", not "always mint".

---

## 6. Two defects found by reviewing the delivered code

**`policyDecided` was true in every reachable state.** It was computed as
`!UNDECIDED.has(eligibility)` with `UNDECIDED = { class_undefined }` — and that verdict
cannot occur, because the CHECK constraint on `shared.documents.retention_class` admits
exactly the class codes `shared.retention_classes` seeds. Worse, `retention_indefinite`
was therefore reported as a decided policy, when the seed describes that state as
"retention is owner- and jurisdiction-defined" — a duration nobody has configured. It was
claiming a decision that had not been made, about most documents in the system.
`retention_indefinite` now joins `UNDECIDED`; `class_no_delete` deliberately stays out,
because forbidding deletion IS a decision. Two reachable tests pin both directions, and
mutation M6b reverts the exact defect and is caught.

**The report catalogue was unbounded.** It was modelled on `shared.export-catalogue`,
which is unpaginated — but that one returns a static in-code array and is bounded by
construction, while `rpt.report_configurations` is a table the tenant writes through
`rpt.report.configure`. The precedent did not transfer. Now keyset-paginated on the
repository's own convention, with a test asserting the cap against `limit: 100_000`.

---

## 6a. The gate destroyed itself on the first push to develop

Check 6 compared the phase allowlist against `origin/develop`. While the phase was in
review that WAS the baseline, so the check passed on all nineteen green pull-request runs.
The moment PR #139 merged, the seven operations existed on `origin/develop` and the check
reported every one of them as belonging to an earlier phase — failing FOUR checks on the
develop push: `static-quality`, `Lint, types, tests, build`, `hosted-clean-room` and
`protected-gate`.

**A green pull request could not have revealed it.** On a PR the comparison target still
held the old tree, so the defect was invisible exactly where it was meant to be caught and
surfaced only where it did damage. The lesson outlasts the fix: a check whose reference
point moves with the thing it is checking is not a check.

Fixed in PR #140 by pinning `BASE_REF` to the phase baseline `9f7ef083`, which never moves.
The skip path was made honest in the same change — a shallow CI checkout does not contain
the baseline commit, and the message now reads SKIPPED (NOT PASSED) rather than a quiet
note, because that is this check's state in every CI job that does not fetch full history.

---

## 7. Hostile mutation matrix — 9/9 caught

Each mutation breaks one security property and must turn a named suite red.

| Id  | Property                                                     |
| --- | ------------------------------------------------------------ |
| M1  | the inbox is confined to the calling recipient               |
| M2  | the caller cannot choose whose inbox to read                 |
| M3  | tenant isolation on the notification read                    |
| M4  | document reads never project the storage key                 |
| M5  | retention evaluation reports the protected function verbatim |
| M6  | retention evaluation never claims a deletion happened        |
| M6b | `policyDecided` separates "no policy" from "decided to keep" |
| M7  | only published report definitions are visible                |
| M8  | the catalogue does not claim reports are executable          |

**Four of eight did not APPLY on the first run** and that is reported as a failure, not
skipped — their patterns matched 2–4 places each, and a mutation that never applied is
indistinguishable from one that was caught unless the script says so. The anchors were
made unique rather than the check loosened.

Every mutated file is restored and the restoration is **verified by comparing content**,
not assumed.

---

## 8. Reference data is not what a local database says

`tests/db/shared-retention.test.ts:59` forces `operational` to 0 days and `evidence-audit`
to 3650 as its own fixture, with `ON CONFLICT DO UPDATE`, and never restores them. A
retention ladder written against those values passed locally and was rejected by the clean
room, where the seeded values are NULL for four of the five classes.

The durable fix was not correcting the numbers but **removing the dependency**: the
class-dependent tail derives its expected verdict from the class row read at run time, and
the suite was then verified against BOTH database states. A test whose expectation depends
on which suite ran first is not evidence about the code.

---

## 9. Limitations recorded rather than papered over

| Id           | Limitation                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-23-A-01` | `tests/db/shared-retention.test.ts` leaves platform retention reference data mutated, so `validate:seed-state` fails on any database it has run against. Masked in CI by per-tier containers. P1-05's suite; out of scope here.                                  |
| `P1-23-A-02` | Report **execution** and **export generation** are not implemented: `rpt.report_configurations` binds no data source to a report code, and inventing one would mean inventing an unapproved report definition. The response says `executable: false` explicitly. |
| `P1-23-A-03` | `retention_not_elapsed` and `class_undefined` are unreachable and therefore unasserted — the first because no approved retention class carries a positive minimum, the second because the CHECK constraint and the seeded class set coincide.                    |

Additionally, and stated plainly: **today the honest retention answer for almost every
document is `retention_indefinite`**, because no duration has been approved. `temporary`
is the only class that can ever answer `eligible`. Nothing in this phase deletes a
document; `eligible` means PERMITTED, never done.

**Manual retry is not implementable at request runtime.** `app_runtime` holds no UPDATE on
`shared.outbound_messages` and nothing at all on `shared.delivery_attempts`. That is a
contract boundary, not a defect, and no operation pretends otherwise.

---

## 10. Verification

All checks measured via `/commits/{sha}/check-runs` — **19 checks**, not the 14 Actions
jobs, because `/actions/runs` does not list checks that are not Actions workflows. A
`CodeQL` check from Advanced Security was red on five heads reported green in an earlier
initiative for exactly that reason.

| Head       | Meaning               | Result                           |
| ---------- | --------------------- | -------------------------------- |
| `c2f89d91` | feature head          | 19/19 green                      |
| `12a80c9e` | develop after PR #139 | 4 red — see §6a                  |
| `222d363e` | fix head (PR #140)    | 19/19 green                      |
| `efe800d9` | develop after PR #140 | recorded in the promotion record |

**CodeQL, full tree.** Pull-request analysis is DIFF-INFORMED and cannot stand in for a
full-tree run; a full run happens on push to a protected branch. Open alerts across the
repository: **1**, medium, `js/http-to-file-access` in
`scripts/ci/check-commit-checks.mjs:252` — a CI script, not application source,
pre-existing on `main` and not introduced by this phase. **0 Critical, 0 High.**

Two failures were environment, not code, and are recorded as such rather than diagnosed as
defects: one `integration-tests` Docker service-container networking error
(`failed to set up container networking`), re-run; and one `hosted-clean-room`
`The operation was canceled`, a run superseded by a later push.

One `integration-tests` check on PR #140 is `skipped`, legitimately: change-detection saw
that the diff touches only a gate script, no source and no test. A skip is recorded as a
skip.

---

## 11. Decision

Recorded in the promotion record accompanying this gate.

`origin/main` is untouched by the feature branch. Promotion of an integrated `develop` into
`main` is the only route by which implementation reaches `main` (ADR-006 §45, §47).
P1-24 is **not** started.
