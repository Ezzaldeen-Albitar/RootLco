# Phase 1-2 Evidence Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-2 · **Date:** 2026-07-16 · **Recorded by:** Eng. Ezzaldeen Al-Bitar
(owner-authorized self-review — [policy](../../governance/solo-developer-review-policy.md))

Every entry below was actually executed on 2026-07-16 on the development host
(Windows 11, Node v24.16.0, npm 11.13.0, Docker Engine 29.5.3, Supabase CLI 2.109.1,
PostgreSQL 17.6). Nothing here is projected, assumed, or copied from a plan.

## 1. Git state verification (§1 of the phase instruction)

| Claim                                                          | Evidence                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Remote fetched before any conclusion; branch currency verified | `git fetch origin --prune` + `git ls-remote` executed first; develop `46c6de2`, main `7617121` observed       |
| `develop` contains merged Phase 1-1 work                       | `git pull --ff-only` fast-forwarded local develop a6e0af4 → 46c6de2 (92 files); PR #1/#2/#3 merges in history |
| Phase 1-2 branch created fresh from develop                    | `feature/p1-02-database-engineering-foundation` did not exist locally or remotely before creation             |

## 2. Migrations

| Claim                                       | Evidence                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0001–0003 apply cleanly to a clean database | `npx supabase db reset` run **4 times** this phase (initial; after the 0003 comment fix; after the pad-overflow fix; after the adversarial-review hardening); each applied 0001→0002→0003 + seed |
| Extensions installed with measured versions | `pg_extension` query: pgcrypto 1.3, btree_gist 1.7, citext 1.6, pg_trgm 1.6, all in schema `extensions`                                                                                          |
| Schemas/roles/policies exist as designed    | Catalog queries: 5 schemas; `app_runtime`/`app_readonly` NOLOGIN NOBYPASSRLS; RLS enabled+forced; 2 policies with correct commands and roles                                                     |
| Allocator works end to end                  | Rollback-wrapped smoke test: `ST-2026-00001` → `ST-2026-00002`, record_version 1→3, updated_by stamped, 0 rows after rollback                                                                    |

## 3. Database test suite

| Claim                                | Evidence                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 68 tests, 5 suites, all passing      | `npm run test:db` — final run 2026-07-16 22:33 local: 68 passed (foundation 14, rls 18, constraints 12, patterns 11, number-sequences 13) |
| 50-worker concurrency (baseline met) | "concurrency — 50 parallel workers" tests: 50 unique consecutive values, counter advanced exactly 50; **worker count NOT reduced**        |
| Mixed rollback consistency           | 30 concurrent allocations, 10 rolled back: committed values a gapless consecutive run; counter advanced exactly per commit                |
| RLS evidence is runtime-role only    | All isolation assertions run as `rootlco_test_runtime`; `postgres` (BYPASSRLS, measured) used for provisioning only                       |

## 4. Defects found and fixed BY the Phase 1-2 review (self-review with teeth)

| Defect                                                                                                                                                                        | Found by                              | Resolution                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lpad()` truncates display numbers once a value outgrows `pad_width` (measured: `lpad('12345',4,'0')`→`1234`)                                                                 | Standards review of migration 0003    | 0003 corrected **before merge** (`greatest(pad_width, length(...))`); regression test added; suite re-run — all passing                                                        |
| Supabase analytics (Logflare) container unhealthy on Windows aborts the whole local stack                                                                                     | `supabase start` failure this phase   | `[analytics] enabled = false` in `supabase/config.toml` with documented reason; also removes the Phase 1-1 vector crash-loop                                                   |
| `git pull` on Windows (autocrlf=true) rewrote the tree to CRLF, failing Prettier repo-wide                                                                                    | `format:check` failure this phase     | `.gitattributes` (`* text=auto eol=lf`), tree renormalized, verified clean; recorded so it can never silently recur                                                            |
| Gap/rollback wording in 0003 comments contradicted actual FOR UPDATE semantics                                                                                                | Test design (rollback test)           | Comments corrected pre-merge; behaviour pinned by the rollback test                                                                                                            |
| PostgreSQL grants EXECUTE to PUBLIC on new functions by default — any role could call the allocator, falsifying the "explicit grants only" claim                              | Adversarial review (security lens)    | `REVOKE EXECUTE ... FROM PUBLIC` added to 0002/0003 pre-merge for all seven functions; denial verified by 2 new tests (42501 for an unprivileged login and for `app_readonly`) |
| Regression guard bypassable by inventing a period change (UPDATE column grant covers both `next_value` and `current_period`)                                                  | Adversarial review (security lens)    | Guard hardened + `ck_number_sequences_never_has_no_period` CHECK added pre-merge; negative test added                                                                          |
| CI migration-immutability step failed OPEN (`\|\| true` swallowed git errors, printing OK on a broken diff)                                                                   | Adversarial review (consistency lens) | `\|\| true` removed; explicit `git rev-parse --verify` guard added — the control now fails closed                                                                              |
| **Evidence drift (process defect, disclosed):** the pad-overflow fix and its regression test were initially left uncommitted while documents attesting to them were committed | Adversarial review (all four lenses)  | Code, tests, and documents now land together; every count and claim re-verified against the committed tree before push                                                         |

### 4.1 Adversarial review pass (2026-07-16)

After implementation, a four-lens adversarial review (phase scope · database security ·
internal consistency · evidentiary honesty) was executed against the branch. It returned
**1 blocker, 5 major, and multiple minor findings — every one was fixed before push**,
including the four new rows above, eight broken cross-references between standards, a
required-checks register missing the new CI job, stale phase-status statements in
SECURITY.md, and contradictory test counts. The clean categories it confirmed: no
business tables, no Zoom objects, no Benzene hard-coding, no secrets in the diff, no
false approval or independent-review claims, and canonical-document hashes intact. This
was itself owner-authorized self-review tooling, not an independent human review.

## 5. CI and rehearsal

| Claim                                            | Evidence                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Workflow YAML valid, 4 jobs                      | Parsed with a real YAML parser: quality, docker, database, secrets; job display names recorded for the ruleset     |
| Defective migration fails the pipeline           | [rehearsal-defective-migration.md](./rehearsal-defective-migration.md): RUNNER_EXIT=1; broken file never committed |
| Clean-database guard works                       | Runner refused the populated rehearsal DB: GUARD_EXIT=1                                                            |
| **No GitHub Actions run exists for this branch** | Stated plainly. The CI job's first real run happens on the pull request; local equivalents of every step were run  |

## 6. Quality gates (application repo)

| Gate                                                                                                | Result                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run verify` (lint, typecheck, format, style, browser-secrets, 28 unit tests, production build) | **Exit 0** (build: routes `/`, `/_not-found`, `/api/health`)             |
| Secret scans (both CI scans run locally)                                                            | browser-secrets OK (108 tracked files); credential-pattern scan CLEAN    |
| `docker compose config --quiet`                                                                     | Exit 0                                                                   |
| Supabase service health                                                                             | REST 200 · Auth 200 · Studio 307 (redirect) · DB live queries throughout |

## 7. Canonical documents

| Claim                                   | Evidence                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Canonical DOCX intact before this phase | `npm run validate:canonical-docs`: both files `STATUS: OK` against recorded SHA-256 hashes; nothing copied/modified |
| Phase 1-2 updates to the canonical DOCX | Recorded separately in [canonical-documents.md](../../governance/canonical-documents.md) after the update pass      |

## 8. Environment notes (disclosed)

- The development network is intermittent; pushes use `scripts/git-push-retry.sh` and
  are confirmed by comparing the remote SHA (`git ls-remote`), never by exit code alone.
- Four of twelve standards documents' authoring agents were interrupted by tooling
  session limits; two files were completed in-session and two
  (`data-dictionary.md`, `database-test-fixtures.md`) were authored directly by the
  owner. All twelve were reviewed together for consistency.
