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
| Seven Phase 1-3 migrations apply cleanly from empty | `supabase db reset` executed after EVERY increment (≥7 clean applies), 0001→0003→100000..107000 + seeds                                                                                                     |
| 14-digit timestamp naming per the standard          | Filename-rule test + CI runner rule; the brief's illustrative 0004-style names were rejected as violating the standard (initial audit §4)                                                                   |
| Rollback classes recorded and rehearsed             | [phase-1-3-migration-classification.md](../../database/phase-1-3-migration-classification.md); `106000` genuinely rolled back (3 FKs + 2 indexes dropped) and re-applied with zero data effect, suite green |
| Merged migrations 0001–0003 untouched               | `git diff origin/develop -- supabase/migrations/0001* 0002* 0003*` empty                                                                                                                                    |

## 3. Test suite (Proven)

Final state: **190 tests, 13 files, all passing** on a clean reset —
Phase 1-2 regression fully preserved (foundation 14, rls 18, constraints 12,
patterns 11, number-sequences 13) plus Phase 1-3: org-tenants 21,
org-subscriptions 19, org-hierarchy 20, org-structure 17, org-settings 17,
org-sequences 4, org-provisioning 13, org-security 10. Every isolation assertion
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

## 7. CI (honest status)

The `Database migrations and RLS tests` job now exercises all Phase 1-3
migrations and suites (seeds rehearse inside the provisioning suite); the secrets
job gained the scope-exclusion guard step. **No GitHub Actions run exists for
this branch yet** — the first run happens on the pull request, and CI is not
claimed green until that run reports.

## 8. Canonical documents

Master document: revision 0.4 recorded (Phase 1-2). Phase 1 plan DOCX:
synchronization **Pending — non-blocking administrative synchronization**
(Word lock; no watcher; standing policy §7). Phase 1-3's canonical additions ride
the same documentation window.
