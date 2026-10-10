# Cloud continuation record — 2026-10-10

## 1. Purpose

An index of where the work stands, written so that a cloud session can pick it up without the
local workspace. It is not a second ledger. The canonical records remain:

- [`capability-status.md`](capability-status.md) — the delivery matrix, the local QA register and
  the hosted checkpoint register;
- [`route-checklist.md`](route-checklist.md);
- [`decision-pack-2026-10-08.md`](decision-pack-2026-10-08.md).

Where this page and one of those files disagree, the canonical file wins and this page is wrong.

## 2. Baseline

- `develop` is at `c765ed8ccfc83906bcd0da65ce527ddf0152ac7d`: administration wave 1 is merged
  (PR #554, PR #552, PR #553).
- `main` is at `1262de74` and is frozen. No promotion to `main` is authorised.

## 3. Open pull requests at 2026-10-10, about 14:00 UTC

Landing order: #562, #564, #563, #566, #565; then #558, #557, #560, #556.

### PR #562 — INV-F, `feature/owner-directive-residual-fixes-inv-f`

- Head `85c9e0c15dc8a59f84412ce855ed4f321e8c577d`, unchanged since 10:50 UTC.
- Fix round complete: `develop` merged at `56f4c3a9`; the duplicate-value banner is limited to
  `duplicate_code` and `duplicate_sku`; the API proxy judges the canonical path on
  `/api/v1/auth/:path*` and logs each refusal; Arabic terminology for vehicle makes; raw
  identifiers replaced with readable wording.
- Independent review: APPROVE at that head. Hosted CI: all 17 checks reported success at that
  head, `ci-gate` included. The independent review record is a comment on the pull request
  (`issuecomment-6098192820`).
- Not merged. Landing is blocked in the cloud session (section 4).
- The ten CP-20261009-1 FAIL rows stay FAIL until a runtime retest (section 5).

### PR #564 — ADM-5, `feature/owner-directive-mui-admin-settings`

- Head `b517b8474be8414b6268803a87c819732a5d2a72`.
- The earlier CI failure on `84ceac7f` (`validate:p1-27-doc-counts`, caused by an `it.each` table
  in `navigation.test.ts`) was fixed by writing the cases out statically.
- Delta review: APPROVE at that head. Hosted CI: every check reported success at that head,
  `ci-gate` included. The review record is a comment on the pull request
  (`issuecomment-6098193498`).
- Lands after #562, with mergeability checked again once #562 is in.
- Follow-ups that do not block landing, for a separate pull request afterwards: the chapter 07
  sentence that quotes the message key `admin.contractGap.noDirectory`; unused catalogue keys for
  numbering, taxes and currencies; and chapter 07 listing appointments as out of reach for the
  Tenant Administrator.

### PR #563 — ADM-4, `feature/owner-directive-mui-admin-roles`

- Head `d315c9f9d1a245fb152c0988c92a71cec0c5cd89`: independent review APPROVE, hosted CI green at
  that head.
- The Enter-while-pending double submit is fixed in `FormDialog` and its nine callers. Approval
  limit names leave out soft-deleted accounts.
- A test-isolation round is in progress. The tests of the per-form duplicate-submit guard must
  either show that guard working with `FormDialog`'s pending guard out of the way, or claim only
  the combined behaviour.
- `develop` is merged into it after #562 and #564 land; then delta review and CI.
- The backend cases are written but were not run locally, because they need PostgreSQL.

### PR #566 — ADM-6, `feature/owner-directive-mui-admin-audit`

- Head `b6a2205a73e7953c0e1a71eb66f986b5f8afa6af`, with six review findings fixed. Hosted CI green
  at that head.
- Delta review: CHANGES REQUIRED, waiting on #564. After #564 lands: merge `develop`; use #564's
  hub predicate (`orPermissions` / `alsoRequires`) in place of #566's four settings-entry gates;
  realign the hub tests; add `org.tenant.read` to the real-page suite; correct the header comment
  of `administration/page.tsx`; and fix three small test points.

### PR #565 — ADM-2b, `feature/owner-directive-mui-admin-technicians`

- Head `5ba1d7f33cdabdab4e075dd28421c2b0229a814c`, pushed with the Owner's explicit approval.
- Delta review: APPROVE at that head. Hosted CI was still pending when this page was written.
- Open gaps recorded: recording certifications; the assignment and rework pickers still take the
  roster reference; an expensive-read limit on `tech.skill-list`.

### PR #558, PR #557, PR #560, PR #556

Open. Each conflicts with `develop` only in `route-checklist.md`. Held until administration wave 2
lands.

## 4. Landing blocker and the local landing procedure

**Cause.** In the cloud session, the call that sets the `independent-review` commit status returns
HTTP 403. The refusal comes from the cloud session's outbound proxy ("Write access to this GitHub
API path is not permitted through this proxy"), not from GitHub. The credential in use is the
Owner's GitHub user sign-in, which has admin rights on the repository, so no change to the GitHub
App's permissions would lift the block. An earlier version of this page put it down to a missing
GitHub App permission; that was wrong. A merge made without the guard would be reported by
`develop-merge-integrity`, so the cloud session does not land pull requests.

**Who lands, and with what access.** The landing owner is Eng. Ezzaldeen Al-Bitar. He lands from
his own machine, from the root of a trusted, clean checkout, signed in with his own GitHub account
through `gh auth login`. That sign-in needs repository read, pull-request read, commit-status write
(for the guard) and the merge rights it already has.

**The landing script.** `land-pr.sh <pr-number> <approved-head-sha>` is kept outside the
repository and is not reproduced on this page. It stops with a line starting `STOP` at the first
failed check, and merges nothing unless every check passes:

1. the landing guard is the same as on `origin/develop`;
2. the pull request is open, not a draft, based on `develop`, still at the approved head, and
   mergeable;
3. the approved head already contains current `develop`;
4. an independent review record names that exact head;
5. every check on the head has passed;
6. `node scripts/ci/landing-guard.mjs --pr <n> --approved-head <sha> --mark-reviewed` succeeds;
7. the merge is made with `gh pr merge <n> --merge --match-head-commit <sha>`;
8. the `develop-merge-integrity` run on the merge commit succeeds.

**Why one pull request at a time.** `scripts/ci/develop-merge-integrity.mjs` requires the tree of
the merge commit to equal the tree of the approved head. So a pull request can land only if its
approved head already contains current `develop`.

**Order.**

1. #562 can land now: its head `85c9e0c15dc8a59f84412ce855ed4f321e8c577d` contains `develop`
   `c765ed8c`. Run the script for #562 with that head.
2. Once #562 has landed, the head of #564 (`b517b847`) no longer contains current `develop`, so the
   script stops on it by design. The cloud session then merges `develop` into #564, gets a delta
   review and CI on the new head, posts a new review record, and gives the landing owner the new
   approved head to run the script with.
3. Every later pull request goes the same way: bring it up to current `develop`, review and CI on
   the new head, a new review record, then the script.
4. If any step prints `STOP`, land nothing further and report the message.

#565's head `5ba1d7f3` is already pushed and approved; it too will need `develop` merged in and a
new approved head before it can land.

## 5. Checkpoint CP-20261009-1

The canonical local result is 93 rows: 77 PASS, 10 FAIL, 6 NOT RUN. That is the figure as the Owner
corrected it; an earlier narrative of 72 / 10 / 7 was wrong.

**What the remote repository does not hold.** On 2026-10-10 neither the 93-row local result
matrix nor the two evidence corrections were found in the remote repository; `develop` records
only the hosted run row for CP-20261009-1. The two corrections are: the census of records the run
created along the way left out one audit record and eight sign-in sessions; and the statement that
screenshots were taken after the page had settled was not proven. Neither changes a result. Both,
and the matrix, exist only in the local workspace, which this session could not reach. The
specific missing artefact is the CP-20261009-1 local QA result matrix. No row is added to the local
QA register on the strength of this page.

The ten FAIL case ids: `UNIT-names`, `SETUP-cat-errors`, `SETUP-item-errors`, `SPEC-no-makes`,
`COUNT-focus`, `LBL-sheet-print`, `LBL-roll-print`, `ATT-clock`, `LANG-identifiers`, `FRX1-c`.

The six NOT RUN case ids, with the reason each could not run:

| Case                        | Why it was not run                                                          |
| --------------------------- | --------------------------------------------------------------------------- |
| `ITEM-cost-with-permission` | No QA identity holds the cost-view permission (Q18, PERM01).                |
| `CAT-not-covered`           | Needs an inactive category and an empty catalogue (CAT01, ACCESS01).        |
| `SPEC-create`               | The vehicle-make catalogue is empty (CC-OD-28).                             |
| `LBL-equipment`             | Needs a physical scanner and printer.                                       |
| `FRX4-zone-change`          | Runtime branch time-zone scenario, blocked by the allowed-zone restriction. |
| `FRX4-branch-behind`        | Runtime branch time-zone scenario, blocked by the allowed-zone restriction. |

## 6. Environments

- The old local acceptance database (at 187 migrations) and the old local application (last built
  at `2376b1ad`) are on the Owner's machine. Neither was used.
- The cloud session ran no database, no migration and no browser acceptance. It ran the
  repository's unit and web tiers in disposable clones, and relied on hosted CI for the database,
  backend, browser and build tiers.
- No cloud database was created.

## 7. Next actions, in order

1. The landing owner lands #562 at `85c9e0c1` with the procedure in section 4.
2. The cloud session merges `develop` into #564, gets a delta review and CI on the new head, posts
   a new review record, and hands over the new approved head; the landing owner lands it.
3. #563: finish the test-isolation round, merge `develop`, then delta review, CI, a new review
   record, and landing.
4. #566: merge `develop`, make the changes the delta review asked for (section 3), then delta
   review, CI, a new review record, and landing.
5. #565: once hosted CI is green, merge `develop`, then delta review and CI on the new head, a new
   review record, and landing.
6. Open the separate follow-up pull request for #564's three non-blocking points.
7. Merge `develop` into #558, #557, #560 and #556 (the `route-checklist.md` conflict), re-review
   any changed behaviour, and land them in that order, one at a time, the same way.
8. The next checkpoint: an identified integration revision, hosted full verification, and a
   runtime retest of the ten INV-F rows and of the administration, report and sign-in journeys
   they touch.
9. WP06, the Platform Console.
