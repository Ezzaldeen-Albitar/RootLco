# Phase 1-3 Evidence Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 · **Date:** 2026-07-17 · **Recorded by:** Eng. Ezzaldeen Al-Bitar
(owner-authorized self-review — [policy](../../governance/solo-developer-review-policy.md))

Every entry was actually executed on 2026-07-17 on the development host
(Windows 11, Node v24.16.0, npm 11.13.0, Docker 29.5.3, Supabase CLI 2.109.1,
PostgreSQL 17.6). Nothing is projected or copied from a plan. Provenance labels
follow the Standing Technical Authorization Policy §2.1.

## 1. Gate precondition (Proven)

`git merge-base --is-ancestor e9f4f7d origin/develop` → exit 0 **before any
implementation**. Phase 1-2 gate record contained in `develop` via PR #11.

## 2. Migrations (Proven, repeatedly)

| Claim                                               | Evidence                                                                                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eight Phase 1-3 migrations apply cleanly from empty | `supabase db reset` executed after EVERY increment (≥8 clean applies), 0001→0003→100000..107000 + seeds                                                                                                     |
| 14-digit timestamp naming per the standard          | Filename-rule test + CI runner rule; the brief's illustrative 0004-style names were rejected as violating the standard (initial audit §4)                                                                   |
| Rollback classes recorded and rehearsed             | [phase-1-3-migration-classification.md](../../database/phase-1-3-migration-classification.md); `106000` genuinely rolled back (3 FKs + 2 indexes dropped) and re-applied with zero data effect, suite green |
| Merged migrations 0001–0003 untouched               | `git diff origin/develop -- supabase/migrations/0001* 0002* 0003*` empty                                                                                                                                    |

## 3. Test suite (Proven)

Final state: **194 tests, 13 files, all passing** on a clean reset —
Phase 1-2 regression fully preserved (foundation 14, rls 18, constraints 12,
patterns 11, number-sequences 13) plus Phase 1-3: org-tenants 21,
org-subscriptions 19, org-hierarchy 26, org-structure 17, org-settings 17,
org-sequences 4, org-provisioning 13, org-security 9. Every isolation assertion
runs as the NON-OWNER runtime login; owner behaviour is never RLS evidence.

## 4. Defects found and fixed BY this phase's own controls (self-review with teeth)

| Defect                                                                                                                          | Found by                                    | Resolution                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Four FKs lacked supporting leading-column indexes (storage-location warehouse composite, override flag, tenant locale/timezone) | the new automated FK-coverage assertion     | indexes added by amending the three UNMERGED migrations (permitted; recorded in the classification) |
| Multiple denial assertions shared one transaction → second read 25P02 instead of its own SQLSTATE                               | first run of the subscriptions suite        | each denial isolated in its own rolled-back transaction                                             |
| Scope-exclusion guard flagged its own CI step comment                                                                           | rehearsal R4                                | comment reworded — the guard stays strict rather than allow-listing the workflow                    |
| First hard-coding rehearsal proved nothing (guard scans TRACKED files; the violation file was untracked)                        | rehearsal review                            | rehearsal redone with `git add -N`; evidence is real                                                |
| Exit-code masking by a grep pipe in rehearsal R3's first capture                                                                | rehearsal review (a known Phase 1-2 lesson) | re-captured without pipes: suite exit 1 verified                                                    |

## 5. Provisioning and seeds (Proven)

| Claim                                      | Evidence                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic: failure at ANY step leaves nothing | Injection at company (bad currency), overrides (unknown flag), sequences (bad pad_width) — zero partial rows, idempotency key rolled back too |
| Idempotent retry / conflict                | Same key+spec replays byte-identical response, zero new rows; different spec → 23000                                                          |
| Seeds idempotent                           | All three seed files executed **three times** total in-suite; footprints byte-equal                                                           |
| Pilot package controlled                   | Benzene in ZERO function sources and ZERO object/column names (pg_proc + information_schema, tested); CI guard enforces the exact allow-list  |
| Generic path proven                        | Fictional `northwind_motors` provisioned through the IDENTICAL path with identical footprint                                                  |
| Unknown pilot facts not invented           | registration numbers NULL (tested); pending items in the provisioning register                                                                |

## 6. Negative rehearsals (Proven; deliberate defects never committed)

| Rehearsal                           | Result                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| R1 defective migration              | `RUNNER_EXIT=1` — "syntax error at end of input"                                     |
| R2 populated-database guard         | `GUARD_EXIT=1` — "Refusing to run: module schemas already exist"                     |
| R3 FORCE RLS removed from one table | suite exit 1 — "org.legal_companies must have RLS forced: expected false to be true" |
| R4 tracked pilot literal in `src/`  | guard exit 1 naming `src/lib/rehearsal-violation.ts:1`                               |

## 6.1 Structured adversarial review (2026-07-17)

A four-lens adversarial review (tenancy/security · data integrity · scope ·
evidence/honesty), each finding put to an independent skeptic that ran real
queries against the live database, returned **10 raw findings; 6 survived
refutation**. Every survivor was fixed before this record was finalized and
re-verified as the non-owner runtime login:

| #   | Severity | Finding                                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                                                                                                            |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | major    | `org.branch_status_history` accepted forged rows from a runtime session — spoofed `actor_id`, backdated `occurred_at` (both reproduced live)                                | **Fixed.** New BEFORE INSERT trigger `org.stamp_branch_history()` server-stamps `actor_id := iam.current_user_id()` (raises if null) and `occurred_at := now()`; re-probed — actor overwritten to the session user, timestamp to now(). Residual (self-attributed direct insert vs branch state) recorded in the RLS matrix. Two negative tests added. |
| 2   | major    | `app_runtime` held table-wide UPDATE, so a tenant session could rewrite `created_at`/`created_by` (reproduced live) — regression from the Phase 1-2 column-grant discipline | **Fixed.** `created_at`/`created_by` added to the immutable guard on all nine updatable org tables; re-probed — now 23514. Two tests added (denial + legitimate-update-keeps-attribution).                                                                                                                                                             |
| 3   | major    | Object inventory misstated (17 tables/31 triggers vs actual 21/38/39)                                                                                                       | **Fixed** across completion report, owner gate, baseline.                                                                                                                                                                                                                                                                                              |
| 4   | major    | Evidence-register per-file breakdown summed to 189, not the stated total                                                                                                    | **Fixed** — reconciled to 194 after the hardening tests.                                                                                                                                                                                                                                                                                               |
| 5   | minor    | Effective-dated `tax_rates.rate`/`effective_from` and `cost_centers.effective_from` were editable in place (weaker than the "new row, not overwrite" model)                 | **Fixed.** Added to the immutable guards — a rate change is now a new effective-dated row.                                                                                                                                                                                                                                                             |
| 6   | minor    | Settings "immutable even to admin" originally omitted `effective_from`/`is_sensitive`/`created_*`                                                                           | **Fixed.** Guard extended to pin all identity/value/metadata columns.                                                                                                                                                                                                                                                                                  |

Refuted/not-actioned (4): the remaining raw findings were doc-wording nuances
already corrected in the same pass (security-testing-standard coverage line,
data-dictionary intro, policy-matrix DELETE phrasing) or did not survive
scrutiny. The clean categories the review confirmed: tenant isolation holds
under every probe, composite FKs make cross-tenant references FK violations,
no SECURITY DEFINER exists, no float in module schemas, no forbidden
later-phase table, no Zoom object, no secret, migrations 0001–0003 untouched.

## 7. CI (honest status)

The `Database migrations and RLS tests` job now exercises all Phase 1-3
migrations and suites (seeds rehearse inside the provisioning suite); the secrets
job gained the scope-exclusion guard step. Phase 1-3 was merged into `develop`
via PR #12 (merge `c11f6bf`, 2026-07-17), so a CI run exists on that pull
request — but this session has no authenticated GitHub access and received no
owner-verified CI evidence, so that run's result is **not verified here**. CI is
not claimed green until it is evidenced (an authenticated result or the owner's
Owner-verified confirmation).

## 8. Canonical documents

Master document: revision 0.4 recorded (Phase 1-2). Phase 1 plan DOCX:
synchronization **Pending — non-blocking administrative synchronization**
(Word lock; no watcher; standing policy §7). Phase 1-3's canonical additions ride
the same documentation window.

## Phase 1-5 forward correction (2026-07-18)

The recorded seeded-tenant evidence is historical. Increment M preserves the
same generic-path, footprint, isolation, null-unknown, and replay assertions with
ephemeral tenants and removes every tenant from clean seeded state.
