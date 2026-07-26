# Phase 1-19 Gate — Work Order, Diagnostics, and Technician Backend

**Phase:** 1-19 — Work Order, Diagnostics, and Technician Backend · **Gate package:** post-merge gate record ·
**Review model:** the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md).
**This is not an independent third-party review and is never represented as one.**
**Date opened:** 2026-07-26 · **Date decided:** 2026-07-27 (Asia/Amman).

---

## Decision: **Go — P1-19 Work Order, Diagnostics, and Technician Backend Gate Passed**

Decided against the protected merge commit `d8278c7`, not against any local candidate.
Every number below was produced by a command run on that commit or by the authoritative
CI for it, and is recorded in `evidence/`.

**There is no preserved Pending record for this phase.** Unlike P1-17 and P1-18, no
owner gate document existed before this one — `README.md` stated throughout execution
that none may be written until the implementation waves were delivered, reviewed and
merged. This record is therefore the first and only gate document for P1-19, and nothing
was superseded in writing it.

## 1. What this gate governs

The backend for work-order execution, technician assignment, diagnostics and quality on
the frozen Phase 1-9 `wo`/`tech`/`dia`/`qms` schema: work-order transition and closure;
closure eligibility across all six blockers; job creation, update, transition and
history; service lines and required-part demand; technician assignment, atomic
reassignment and ending; ranked availability and the technician queue; labour sessions
with start, stop and linked correction; additional-work requests with provenance,
restricted detail and customer approval; the unapproved-work execution gate; versioned
diagnostic reports with measurements, DTCs, findings, evidence, recommendations,
completion and review; quality-control execution and finalization; the reopen refusal
ledger; and rework with independent sign-off and restricted cost.

It governs no database change. **P1-19 adds no migration.** It does change one seed file.

## 2. Verified state at decision

| Anchor                   | Value                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `origin/develop`         | `d8278c7fe1f760199bcc2b66a0ed04d790b9c698` (PR #82 merge)                                                              |
| Merge parents            | `f326e24c0340e2ce97a94a768868a26d0cfbb04f` + `da0b8b28d847e5bc2d751df72533095403fd91ce`                                |
| Merge tree               | `368121935f5c5eb9cde26d92e08189a052e68b30` — **byte-identical** to `da0b8b2^{tree}`; `git diff` merge↔head is empty    |
| Reviewed feature SHA     | `da0b8b28d847e5bc2d751df72533095403fd91ce`                                                                             |
| Final clean-room SHA     | `b158ea91226f318a3248ec6b55fe0b45aa1426c6` — delta to the reviewed head is documentation-only, executable diff empty   |
| `origin/main`            | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched; P1-19 is **not** on `main`                                     |
| Authoritative CI         | Push run **#243** (`30224162602`) — event `push`, branch `develop`, SHA `d8278c7`, **Success 4/4**, 6m 17s             |
| Merged                   | PR #82 (feature) — one pull request carried the whole phase                                                            |
| Commits                  | 45 on the feature branch                                                                                               |
| Diff                     | 131 files, +48,885 / −1,935                                                                                            |
| Migrations               | **119** — none added, none modified, no `120`                                                                          |
| Only `supabase/` change  | `seeds/04_iam_permission_catalog.sql` (+61 / −1) — the 22 `wo.`/`tech.`/`dia.`/`qms.` permission codes, 71 → 93        |
| Clean-room `schema_hash` | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — byte-identical to the frozen P1-17/P1-18 baseline |
| Test totals              | Unit **843** · DB **1610** · Backend **1077**                                                                          |
| Operations               | **58**, all at operation depth, **0 pending**                                                                          |
| Tasks                    | **33 / 33** — BE 20, SEC 4, QA 5, DO 2, DOC 2                                                                          |

## 3. Conditions

All 24 conditions verified on `d8278c7`. Evidence paths are relative to
`docs/phase-1/phase-1-19/`.

| #   | Condition                                                                                                         | Status  | Verified by                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Feature branch based on protected `develop`, merged with a byte-identical tree                                    | **Met** | Merge parents `f326e24` + `da0b8b2`; merge tree `36812193…` equals `da0b8b2^{tree}`; zero-file diff                                             |
| 2   | No migration added or modified; 119 migrations, no migration 120                                                  | **Met** | `git diff --name-only f326e24 d8278c7 -- supabase/migrations` empty; clean room applies 119 from empty                                          |
| 3   | The one seed change is additive structural reference data and is stated, not hidden                               | **Met** | `evidence/clean-room-validation.md`; `iam.permissions` 71 → **93**; seed idempotent under `ON CONFLICT (permission_code) DO NOTHING`            |
| 4   | All 33 tasks (BE 20, SEC 4, QA 5, DO 2, DOC 2) delivered and mapped to evidence                                   | **Met** | `evidence/task-register.md`; all 33 identifiers greppable in the tree                                                                           |
| 5   | Every operation registered with permissions, scope, audit class and action                                        | **Met** | Generated `evidence/endpoint-inventory.md` — 58 operations, all `scope: 'branch'`, 30 privileged + 4 approval + 3 security + 21 none            |
| 6   | Permission, event, audit-action and error catalogs synchronized and reconciled in CI                              | **Met** | `validate:p1-19-inventory` — code→seed both directions; 22 permissions, 32 audit actions, 10 events, 5 error codes                              |
| 7   | Operation coverage: 58 registered == 58 operation-depth; 0 pending / invocation-only / unit-only / unreferenced   | **Met** | `validate:operation-coverage` on `d8278c7`                                                                                                      |
| 8   | Every declared evidence kind backed by an assertion that fails when the protection is weakened                    | **Met** | `evidence/qa-evidence.md`; the gate's own limit is stated rather than relied on                                                                 |
| 9   | The structural scope guard is mutation-tested against the defect it exists to catch                               | **Met** | `evidence/final-adversarial-review.md` H-01 — reverting the route fix makes the guard fail naming exactly that operation                        |
| 10  | Security review (SEC-001…004), zero Critical and zero High outstanding                                            | **Met** | `evidence/security-review.md`; the one High found post-hoc is closed in code, test and gate — see §4                                            |
| 11  | QA completion (QA-001…005) with real tenant-B principals and the four-way scope probe                             | **Met** | `evidence/qa-evidence.md`; every read probed 403/403/404/404                                                                                    |
| 12  | Test floors held: Unit ≥ 829, DB ≥ 1547, Backend ≥ 771 (the protected baseline)                                   | **Met** | **843 / 1610 / 1077** — every floor exceeded; each delta equals the phase's own tests exactly                                                   |
| 13  | Observability and DevOps (DO-001…002) with no sensitive value logged                                              | **Met** | `evidence/devops-observability.md`; the monitoring port's limit is stated, not overstated                                                       |
| 14  | Documentation (DOC-001…002) synchronized; canonical documents unmodified                                          | **Met** | `evidence/errors-and-events.md`, `evidence/change-log.md`; `validate:canonical-docs` verified 2 documents unmodified                            |
| 15  | Full local gate battery green in CI-equivalent order on the protected merge SHA                                   | **Met** | Reproof on `d8278c7`: lint, typecheck, format, boundaries, authorization, OpenAPI, inventory, coverage, encoding, canonical, security, 3 suites |
| 16  | Generated artifacts stable across regeneration                                                                    | **Met** | `evidence/clean-room-validation.md` — both generated documents byte-identical; OpenAPI semantically identical, difference is JSON whitespace    |
| 17  | Exact-SHA PostgreSQL 17 clean room from an empty database                                                         | **Met** | `evidence/clean-room-validation.md` — PG 17.10, 119 migrations + 7 seeds twice, `schema_hash a677eb05…`, run **three** times                    |
| 18  | Independent adversarial reviews resolved: architecture, correctness, transactions, boundaries, evidence, journey  | **Met** | `evidence/final-adversarial-review.md` (24 raised / 15 refuted / 9 confirmed) and `evidence/pre-merge-completeness-audit.md` (27 / 20 / 7)      |
| 19  | Feature pull request open to `develop`, conflict-free, all hosted checks green on the exact head                  | **Met** | PR #82 — 4/4 green on `da0b8b2`, "No conflicts with base branch"                                                                                |
| 20  | Authoritative protected push CI green on the merge SHA                                                            | **Met** | Run **#243** (`30224162602`) — push, `develop`, `d8278c7`, **Success 4/4**                                                                      |
| 21  | `origin/main` untouched by this phase                                                                             | **Met** | `origin/main` = `491c4e0`; `git merge-base --is-ancestor d8278c7 origin/main` is false                                                          |
| 22  | Closure blockers B1–B6 reported independently and pinned against the DEPLOYED guard                               | **Met** | `tests/db/p1-19-closure-blocker-reconciliation.test.ts`; `tests/backend/p1-19-closure-gate-matrix.test.ts` raises each blocker in isolation     |
| 23  | Every id-addressed branch-scoped operation re-authorizes against the LOCKED row, and no `scope:'branch'` is inert | **Met** | `evidence/security-review.md` §1; enforced on every build by the scope guard in `scripts/p1-19-endpoint-inventory.mjs`                          |
| 24  | The full operational journey proved through real Route Handlers, plus forced concurrency and rollback             | **Met** | `tests/backend/p1-19-operational-journey.test.ts`; `tests/backend/p1-19-concurrency.test.ts` forces three races with a third connection         |

## 4. The High found before merge, and its resolution

The pre-merge completeness audit found **one High**, and it is the finding this phase
should be judged on because nothing else in nine waves of review had caught it.

**`wo.job-update` had no terminality guard.** `updateJob` locked the job, re-authorized
scope against the locked row, compared `record_version`, and wrote. It never read the
job's own state and never touched the parent work order. `wo.jobs` carries no trigger
that reads the order, so nothing refused: **a closed work order's job rows stayed
editable after the vehicle was released.**

`requires_diagnostic` is why that was High rather than untidy. It is the direct input to
closure blocker **B4** — "every `requires_diagnostic` job must have a completed
diagnostic report" — and B4 reads the flag with no reference to the job's state. Setting
it on a job of an already-closed order writes a blocker the gate has already run past;
clearing it erases the recorded fact that a diagnostic was required. Either way the
order's closure stops meaning what it meant when it was granted.

**Resolution.** The parent is now locked and refused when terminal. The **order** of the
two locks is the substance rather than a detail: every other path in the module takes
`wo.work_orders` before its children, so locking the job first would have made this the
one path with the opposite order — which is how a deadlock is built. The job's
`work_order_id` is read unlocked to learn which order to lock, which is safe because
`tg_jobs_immutable` freezes that column, and both locks are then taken parent-first.

Two probes carry it: the refusal including the B4 flag specifically with nothing moved,
and an open order still accepting the same edit so the guard is not simply blocking
everything.

**A second, related Medium** was found and fixed in the same pass: diagnostic entries
were recordable, and a report **completable**, on an already-closed work order —
reachable with no race at all, because B4 demands a completed report only for a
`requires_diagnostic` job, so an order carrying an `in_progress` report on an ordinary
job closed cleanly and the report stayed writable. Completion mattered most: `completed`
is the status B4 reads. The residual unlocked-parent window is recorded as `P1-19-A-06`.

## 5. Findings disposition

| Review                                    | Raised | Refuted | Confirmed | Critical | High  | Medium | Low   | Outstanding |
| ----------------------------------------- | ------ | ------- | --------- | -------- | ----- | ------ | ----- | ----------- |
| Wave 6 adversarial                        | —      | —       | —         | 0        | 0     | fixed  | fixed | 0           |
| Wave 7 adversarial                        | —      | —       | —         | 0        | 0     | fixed  | fixed | 0           |
| Wave 8 adversarial                        | 28     | 16      | 12        | 0        | 0     | 3      | 9     | 0           |
| Final adversarial (whole diff)            | 24     | 15      | 9         | 0        | **1** | 0      | 8     | 0           |
| Pre-merge completeness audit (whole diff) | 27     | 20      | 7         | 0        | **1** | 2      | 4     | 0           |

**Zero unresolved Critical. Zero unresolved High.** Every confirmed finding across all
five reviews is fixed in the merged tree; none was accepted as an open item and none
required a migration.

**The pattern worth recording.** Across the phase, most confirmed findings were in the
**evidence** rather than the code, and each is corrected in place with what it previously
claimed rather than silently replaced:

- Wave 8's coverage manifest claimed authorization, denial and isolation evidence for
  five reads while performing every one of them as a fully-permitted principal.
- Five comments in one file asserted the seeded `cancelled` state is not `is_closed`. It
  is, and the code admitted a cancelled order to rework because of it.
- Three phase-level documents claimed no seed changed. The clean room disproved it.
- The restricted-token leak test inspected only the audit trail while two documents said
  it covered event payloads and responses. The **test** was extended, not the sentence.
- The per-file test table summed to 295 against a 303 delta, because one file is a
  `describe.each` and was counted by grepping for `it(`.
- 13 of the 33 task identifiers were greppable nowhere. `evidence/task-register.md`
  closes that, and the identifiers are anchored in the documents that deliver them.

## 6. What this phase actually established

- **A rework work order had no creation path anywhere in the platform.** Reception's
  conversion leaves `kind` to its `'ordinary'` default and nothing else inserted
  `wo.work_orders`, so `qms.rework_links` was unreachable and B6 could never fire.
- **The closure gate reports one blocker; the endpoint must report six.** The trigger
  remains the authority; `GET /closure-eligibility` is the reporter, pinned against the
  deployed function body so a seventh blocker cannot be silently unreported.
- **Reopen is a recorded refusal, not a transition.** The endpoint returns 201 with the
  recorded attempt; the first implementation threw and rolled back its own ledger row.
- **Two transition graphs are read, two are mirrored, and the difference is principled.**
  `wo` catalogs are tenant-overridable tables and are never copied; `dia`'s is a fixed
  PL/pgSQL chain and its mirror is pinned against the deployed body.
- **P1-18-A-01 is closed on this surface**, and a build-failing structural guard now
  prevents any future operation from declaring `scope: 'branch'` while enforcing nothing.

## 7. Decision record

| Item                 | Value                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Decision             | **Go — P1-19 Work Order, Diagnostics, and Technician Backend Gate Passed**                          |
| Decided on           | `d8278c7` (protected `develop`)                                                                     |
| Decided by           | Solo developer review under the Standing Technical Authorization Policy                             |
| Owner authorization  | Explicit, for the complete P1-19 technical closure flow including the protected merges              |
| Conditions           | 24 of 24 **Met**                                                                                    |
| Unresolved Critical  | **0**                                                                                               |
| Unresolved High      | **0**                                                                                               |
| Accepted limitations | `P1-19-A-01` … `P1-19-A-06` — 1 Medium, 5 Low, all Open and documented                              |
| Next phase           | P1-20 — Service Catalog, Pricing, and Quotation Backend. **Unblocked. Not started by this record.** |

## 8. Exclusions

This gate does **not** authorize:

- Promotion of `develop` to `main`. That is a founders' reserved decision under ADR-006
  and the Standing Technical Authorization Policy §5, and no part of this phase performs
  or requests it. P1-19 closes on protected `develop`.
- Any schema change, migration, grant, role or policy change.
- Closure blockers for stock reservation or part issue. The brief lists them;
  `wo.guard_work_order_closure` implements neither, because those are Phase 1-21. No
  always-passing placeholder was added — a blocker that always passes reads as coverage
  in every report and enforces nothing. `DEFERRED_CLOSURE_BLOCKERS` records the owner,
  the two conditions and the reason.
- Quotation pricing (P1-20), stock execution (P1-21), billing (P1-22), any frontend, or
  any Zoom capability.
- Any claim that this phase was independently reviewed by a third party, deployed,
  piloted, or accepted by a customer.
