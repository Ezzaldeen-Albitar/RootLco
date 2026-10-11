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

- `develop` is at `ed21a7df48462c8b9ed56253380dcdc4f2290638`, the merge of PR #566, which follows
  the merges of PR #563, PR #564 and PR #562 (all below), on top of `c765ed8ccfc83906bcd0da65ce527ddf0152ac7d`, where
  administration wave 1 is merged (PR #554, PR #552, PR #553).
- `main` is at `1262de74` and is frozen. No promotion to `main` is authorised.

### Landed

- **PR #562 (INV-F)** merged at 2026-10-11T07:16:04Z by the landing owner, through the landing
  guard. Merge commit `eb0a21fc09e08cc16950c95f73e48362162da157`, with parents
  `c765ed8ccfc83906bcd0da65ce527ddf0152ac7d` and the approved head
  `85c9e0c15dc8a59f84412ce855ed4f321e8c577d`. The `independent-review` status on the approved head
  is success, and `develop-merge-integrity` run `38120791509` on the merge commit is success. The
  ten CP-20261009-1 INV-F rows stay FAIL until a runtime retest at a revision that contains this
  merge.
- **PR #564 (ADM-5)** merged at 2026-10-11T07:56:47Z by the landing owner, through the landing
  guard. Merge commit `8efb403a6aaaba301ae8f62a9b041f962fa867e8`, with parents
  `eb0a21fc09e08cc16950c95f73e48362162da157` and the approved head
  `5b885fb4db79898f0d91243d3b13656aa4238cb3`, which is the merge of `develop` into `b517b847`. The
  `independent-review` status on the approved head is success; the independent delta review record
  is a comment on the pull request (`issuecomment-6106891640`); and `develop-merge-integrity` run
  `38123087959` is success.
- **PR #563 (ADM-4)** merged at 2026-10-11T09:23:47Z by the landing owner, through the landing
  guard. Merge commit `b934ae712c946550b26d776f54632de4a6d99f67`, with parents
  `8efb403a6aaaba301ae8f62a9b041f962fa867e8` and the approved head
  `0ea2cfeea0417e68fc60b8fc7b9c49c86a7b73d9`. The `independent-review` status on the approved head
  is success; the review records are comments on the pull request, one from the cloud session
  (`issuecomment-6107080213`) and one from the landing owner (`issuecomment-6107551799`); and
  `develop-merge-integrity` run `38128219754` is success.
- **PR #566 (ADM-6, the audit log and the administration hub)** landed on 2026-10-11. Approved
  head `72ef338536c2b119d81161c4d324b5809a6b736b`; merge commit
  `ed21a7df48462c8b9ed56253380dcdc4f2290638`, with parents `b934ae71` and `72ef3385`. The
  `independent-review` status on the approved head is success, and `develop-merge-integrity` run
  `38132930217` is success. The review records are comments on the pull request
  (`issuecomment-6107991119` and `issuecomment-6108184991`); the earlier CHANGES REQUIRED on
  `239aaaa1` is `issuecomment-6107933011`.
  - Last fix round: once #563 had landed, the shared table check in `shared-ux.spec.ts` pointed at
    the audit log page, which #566 moved onto the operational grid. Commit `72ef3385` pointed that
    check at `/en/crm/customer-duplicates` instead, with no assertion changed. The hosted
    signed-in browser tier reported 407 passed, 73 skipped, 0 failed.
  - Recorded and still open: the shared-ux case is named for the pager but does not check it;
    without `iam.user.read`, the audit log's "Who" column shows a typed account reference;
    `audit-log-p1-31.spec.ts` skips itself when the acceptance handoff is absent; and the shared-ux
    table case must be pointed elsewhere again when the duplicate queue moves off `DataTable`.
- **Follow-ups tracked from #564 and #563**, for a separate pull request: the chapter 07 sentence that quotes
  the notice's message key (`admin.contractGap.noDirectory`); unused catalogue keys for numbering,
  taxes and currencies; the chapter 07 wording that lists appointments as out of reach for the
  Tenant Administrator; the order of keys between the English and Arabic catalogues near
  `inventory.specifications.list.*`; the out-of-date sentences that speak of "97 capability rows",
  including two in `capability-status.md` (near lines 280 and 511); two dialog test files that, in
  the "right after the answer" cases, click a button reference captured beforehand; no test fails
  if `FormDialog`'s check that the event came from inside the form is removed; and, deferred to the checkpoint, the count derived in `navigation.test.ts` (26 against 32) and the
  web test-file marker.

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
- Landed on 2026-10-11 (section 2, "Landed"). The entry below is kept as it stood before landing.
- The ten CP-20261009-1 FAIL rows stay FAIL until a runtime retest (section 5).

### PR #564 — ADM-5, `feature/owner-directive-mui-admin-settings`

- Head `b517b8474be8414b6268803a87c819732a5d2a72`.
- The earlier CI failure on `84ceac7f` (`validate:p1-27-doc-counts`, caused by an `it.each` table
  in `navigation.test.ts`) was fixed by writing the cases out statically.
- Delta review: APPROVE at that head. Hosted CI: every check reported success at that head,
  `ci-gate` included. The review record is a comment on the pull request
  (`issuecomment-6098193498`).
- Landed on 2026-10-11 at approved head `5b885fb4` (section 2, "Landed"). The entry above is kept
  as it stood before landing.
- Follow-ups: see section 2, "Follow-ups tracked from #564".

### PR #563 — ADM-4, `feature/owner-directive-mui-admin-roles`

- Head `d315c9f9d1a245fb152c0988c92a71cec0c5cd89`: independent review APPROVE, hosted CI green at
  that head.
- The Enter-while-pending double submit is fixed in `FormDialog` and its nine callers. Approval
  limit names leave out soft-deleted accounts.
- A test-isolation round is in progress. The tests of the per-form duplicate-submit guard must
  either show that guard working with `FormDialog`'s pending guard out of the way, or claim only
  the combined behaviour.
- `develop` is merged into it after #562 and #564 land; then delta review and CI.
- Landed on 2026-10-11 at approved head `0ea2cfee` (section 2, "Landed"). The entry above is kept
  as it stood before landing.
- The backend cases are written but were not run locally, because they need PostgreSQL.

### PR #566 — ADM-6, `feature/owner-directive-mui-admin-audit`

- Head `b6a2205a73e7953c0e1a71eb66f986b5f8afa6af`, with six review findings fixed. Hosted CI green
  at that head.
- Landed on 2026-10-11 at approved head `72ef3385` (section 2, "Landed"). The entry below is kept
  as it stood on 2026-10-10.
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

1. Done on 2026-10-11 (section 2, "Landed"). #562 could land first because its head `85c9e0c15dc8a59f84412ce855ed4f321e8c577d` contains `develop`
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

The canonical local result is 93 rows: 77 PASS, 10 FAIL, 6 NOT RUN, unchanged at 2026-10-11. That is the figure as the Owner
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

1. Done: #562 landed at `eb0a21fc` on 2026-10-11 (section 2, "Landed").
2. Done: #564 landed at `8efb403a` on 2026-10-11 (section 2, "Landed").
3. Done: #563 landed at `b934ae71` on 2026-10-11 (section 2, "Landed").
4. Done: #566 landed at `ed21a7df` on 2026-10-11 (section 2, "Landed").
5. In progress: #565 (ADM-2b) is being merged with `develop` at `ed21a7df`, including a correction
   to the hub's "no technician roster" sentence. It then needs a fresh delta review and CI on the
   new head, a new review record, and landing. After it: #558, #557, #560, #556.
6. Open the separate follow-up pull request for the points tracked from #564 and #563 (section 2); the two
   test-count points wait for the checkpoint.
7. Merge `develop` into #558, #557, #560 and #556 (the `route-checklist.md` conflict), re-review
   any changed behaviour, and land them in that order, one at a time, the same way.
8. The next checkpoint: an identified integration revision, hosted full verification, and a
   runtime retest of the ten INV-F rows and of the administration, report and sign-in journeys
   they touch.
9. WP06, the Platform Console.
