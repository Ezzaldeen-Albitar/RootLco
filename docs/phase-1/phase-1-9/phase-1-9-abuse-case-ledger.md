# Phase 1-9 — Abuse-Case Ledger

Every threat raised in the P1-09 plan and adversarial self-review, its structural
control, and the test that proves it. **Zero unresolved Critical/High.** Residual is
`none` for every row: the control is structural (constraint/trigger/RLS), not a
convention.

| #   | Abuse case                                         | Control                                                                        | Test                                          | Residual |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------- | -------- |
| 1   | Work-order enumeration via object ids              | Branch RLS default-deny; object-id grants nothing                              | `p1-09-isolation`, `wo-work-orders`           | none     |
| 2   | Cross-tenant / cross-branch read or write          | Branch RLS + composite FK to `org.branches`; `NOBYPASSRLS` roles               | `p1-09-isolation`, `p1-09-security`           | none     |
| 3   | Forged reception origin (no custody/authorization) | `wo.guard_work_order_refs`: status + accepted custody + approved authorization | `wo-work-orders`                              | none     |
| 4   | Second ordinary WO from one reception visit        | partial-unique `WHERE kind='ordinary' AND deleted_at IS NULL`                  | `wo-work-orders`, `p1-09-concurrency`         | none     |
| 5   | Undefined / off-graph transition                   | transition guard rejects any edge not an active graph row                      | `wo-work-orders`                              | none     |
| 6   | State-graph poisoning via a tenant terminal state  | CHECK forbids tenant terminal/closed/cancellation rows (F1)                    | `wo-work-orders`                              | none     |
| 7   | Closure-gate bypass                                | `wo.guard_work_order_closure` blockers B1..B6 (`23514`)                        | `qms-closure-rework`                          | none     |
| 8   | Back-dated labor session                           | backdating-window guard; `started_at` immutable                                | `wo-jobs-labor`                               | none     |
| 9   | Overlapping / double-active labor (race)           | gist `EXCLUDE` non-overlap + ≤1 active partial index (`23P01`)                 | `wo-jobs-labor`, `p1-09-concurrency`          | none     |
| 10  | Stale / reason-less reassignment                   | reassignment-reason enforcement on `wo.job_assignments`                        | `wo-jobs-labor`                               | none     |
| 11  | Expired-certification bypass                       | operational cert status/expiry (`internal`) queryable without leaking number   | `wo-jobs-labor`                               | none     |
| 12  | Employee-privacy leakage (cert number, cost)       | restricted 1:1 tables gated by `iam.sensitive.view`                            | `p1-09-security`                              | none     |
| 13  | Forged customer approval                           | immutable decision binding a real `rec` party role; append-only evidence       | `wo-services-approvals`                       | none     |
| 14  | Approval-evidence swap / substitution              | evidence binds an exact `shared.document_versions`; append-only                | `wo-services-approvals`                       | none     |
| 15  | Unapproved required additional work slips to close | `state`/`fulfillment_state`; closure blocker B3 (F7)                           | `wo-services-approvals`, `qms-closure-rework` | none     |
| 16  | Diagnostic-evidence substitution                   | evidence binds an exact document version; append-only, no replacement          | `dia-diagnostics`                             | none     |
| 17  | Published template-version rewrite                 | published version + items frozen (F3); report pins exact version               | `dia-diagnostics`                             | none     |
| 18  | Report completed with a missing mandatory finding  | completion gate needs every mandatory item answered / not-applicable           | `dia-diagnostics`                             | none     |
| 19  | DTC / measurement poisoning                        | OBD-II code-format CHECK; unit required on measurements                        | `dia-diagnostics`                             | none     |
| 20  | QC forgery / edited finalized result               | finalized `overall_result` frozen (F10); coherence-guarded ledger              | `qms-closure-rework`                          | none     |
| 21  | Self-approved safety-critical rework               | BR-QMS-001: `independent_sign_off_by <> lead_technician_id` (F4)               | `qms-closure-rework`                          | none     |
| 22  | Reopening a closed work order                      | BR-WO-002: terminal-freeze trigger; `qms.attempt_reopen` records + rejects     | `qms-closure-rework`                          | none     |
| 23  | Rework-link cycle / self-target                    | rework link references a distinct original; immutable lead                     | `qms-closure-rework`                          | none     |
| 24  | Raw-table privilege / FORCE RLS bypass             | ENABLE+FORCE RLS; `NOBYPASSRLS` app roles; no DELETE grant                     | `p1-09-security`                              | none     |
| 25  | Function-based RLS bypass                          | all functions `SECURITY INVOKER`, `search_path=''`; no `DEFINER`               | `p1-09-security`                              | none     |
| 26  | Fabricated operational seed data                   | only the tenant-neutral state graph seeded; business tables empty              | `p1-09-rollback` + no-business-data guard     | none     |
| 27  | Scope leakage into P1-10 / P1-19 / P1-29           | no quotation/item table; opaque forward refs only; DB-only phase               | `p1-09-security` + foundation allow-list      | none     |

## Concurrency race summary

Single-winner races proven across 5 isolated repetitions each (independent
connections): duplicate ordinary WO origin (loser `23505`), labor-session overlap
(loser `23P01`), duplicate close (idempotent no-op loser; exactly one close history
row), and gap-free display-number allocation. Accepted loser SQLSTATEs: `23505`,
`23P01`, `23514`.
