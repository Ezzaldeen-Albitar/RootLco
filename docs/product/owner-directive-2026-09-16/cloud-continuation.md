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

## 3. Open pull requests at 2026-10-10, about 10:50 UTC

Landing order: #562, #564, #563, #566, #565; then #558, #557, #560, #556.

### PR #562 — INV-F, `feature/owner-directive-residual-fixes-inv-f`

- Head `85c9e0c15dc8a59f84412ce855ed4f321e8c577d`.
- Fix round complete: `develop` merged at `56f4c3a9`; the duplicate-value banner is limited to
  `duplicate_code` and `duplicate_sku`; the API proxy judges the canonical path on
  `/api/v1/auth/:path*` and logs each refusal; Arabic terminology for vehicle makes; raw
  identifiers replaced with readable wording.
- Independent review: APPROVE at that head. Hosted CI: all 17 checks reported success at that
  head, `ci-gate` included.
- Not merged. The landing guard refused because setting the `independent-review` commit status
  returned HTTP 403 for the cloud session's GitHub credential (section 4).
- The ten CP-20261009-1 FAIL rows stay FAIL until a runtime retest (section 5).

### PR #564 — ADM-5, `feature/owner-directive-mui-admin-settings`

- Head `d7741c33cbedf0724458bbbff96925128b865fbd`. Fix round complete.
- The CI failure on `84ceac7f` (`validate:p1-27-doc-counts`, caused by an `it.each` table in
  `navigation.test.ts`) was fixed by writing the cases out statically.
- Delta review and hosted CI were still pending when this page was written.

### PR #563 — ADM-4, `feature/owner-directive-mui-admin-roles`

- Head `d315c9f9d1a245fb152c0988c92a71cec0c5cd89`.
- The Enter-while-pending double submit is fixed in `FormDialog` and its nine callers. Approval
  limit names leave out soft-deleted accounts.
- Independent review: APPROVE. Hosted CI green at that head.
- Still to do: merge `develop` after #562 and #564 land; a test-honesty follow-up, because the
  "right after success" tests cannot show the per-form ref guard working independently of
  `FormDialog`'s pending guard; then delta review and CI.
- The backend cases are written but were not run locally, because they need PostgreSQL.

### PR #566 — ADM-6, `feature/owner-directive-mui-admin-audit`

- Remote head `97117336397f8dfdad9ffaceb34d23f79a7c9665`.
- Fix round in progress: hub gating, a date range that is safe across daylight-saving changes,
  plain labels in place of codes, a seven-day default range, and Apply disabled while a request is
  pending.

### PR #565 — ADM-2b, `feature/owner-directive-mui-admin-technicians`

- Head `0f068a0ddd50b40e1a2908347737fd9e461e1bd1`: independent review APPROVE, CI green.
- Five small follow-ups in progress: the roster label, the Since column shown without a time zone,
  the breadcrumb label, a stale comment, and a fallback for an unknown kind.
- Open gaps recorded: recording certifications; the assignment and rework pickers still take the
  roster reference; an expensive-read limit on `tech.skill-list`.

### PR #558, PR #557, PR #560, PR #556

Open. Each conflicts with `develop` only in `route-checklist.md`. Held until administration wave 2
lands.

## 4. Landing blocker and remedy

The cloud session's GitHub credential can read pull requests and push branches, but cannot write
commit statuses. So
`node scripts/ci/landing-guard.mjs --pr <n> --approved-head <sha> --mark-reviewed` refuses, and a
merge made without it would be reported by `develop-merge-integrity`.

Remedy, either of:

- grant the Claude GitHub App commit-status write access on the repository; or
- the landing owner runs the guard, then `gh pr merge <n> --merge --match-head-commit <sha>`, with
  their own GitHub sign-in.

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

1. Unblock commit-status write (section 4).
2. Land #562 at `85c9e0c1`.
3. Land #564 once its delta review approves and CI is green on its exact head.
4. Merge `develop` into #563, fix the test-honesty point, then delta review, CI, land.
5. #566, then #565, the same way.
6. Merge `develop` into #558, #557, #560 and #556 (the `route-checklist.md` conflict), re-review
   any changed behaviour, and land them in that order.
7. The next checkpoint: an identified integration revision, hosted full verification, and a
   runtime retest of the ten INV-F rows and of the administration, report and sign-in journeys
   they touch.
8. WP06, the Platform Console.
