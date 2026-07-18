# Phase 1-5 Migration Classification

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-5 · **Date:** 2026-07-18 · **Owner:** shared module
(Eng. Ezzaldeen Al-Bitar)

Naming: 14-digit `supabase migration new` timestamps (migration standard §3),
continuing after the last Phase 1-4 timestamp `20260718098000`. Application
order = filename order. In the tables below, a bare 6-digit token means
`20260718<hhmmss>` (Phase 1-4 `090000..098000`, Phase 1-5 `100000..111000`);
Phase 1-2/1-3 files are cited with their full names.

**Classified before merge.** Every Phase 1-5 migration header declared its
Purpose, Tasks, Dependencies, and Rollback classification at authoring time —
before any merge — and cites this document as the consolidated record.
Increments A–D (`100000..103000`) are already merged history via PR #24
(merge `ee3b1de` into `develop`) and are immutable; the two reviewed
corrections to their objects are fix-forward changes carried by `111000`, not
edits (CI's immutability diff enforces this). Increments E–L
(`104000..111000`) live on `feature/p1-05-shared-services-database`
(final SHA `83f0f70`) and are **not yet merged** — the pull request is not
opened.

## Migration table

| Migration                                                      | Tasks                             | Forward behaviour                                                                                                                                                                      | Rollback class                                                                                                                                                    | Data-loss risk                               | Depends on                                          | Evidence                                             |
| -------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `20260718100000_shared_document_categories_and_documents.sql`  | DB-001..002                       | dual-scope category policy envelope + governed document metadata + category scope guard (no file bytes)                                                                                | rollback-safe while unused → roll-forward-only once documents exist                                                                                               | governed document records                    | `0002`, `20260717101000/103000`                     | `tests/db/shared-documents.test.ts` (16)             |
| `20260718101000_shared_document_versions_and_scan_results.sql` | DB-003..004                       | append-only version metadata (SHA-256 bytea) + scan history; clean-scan accept gate; terminal states one-way                                                                           | rollback-safe while unused → roll-forward-only once versions/scans exist                                                                                          | file evidence                                | `100000`                                            | `tests/db/shared-document-versions.test.ts` (14)     |
| `20260718102000_shared_document_links.sql`                     | DB-005, SEC-001, QA-002           | generic tenant-scoped links + link-derived access contract + RLS-scoped resolver `document_ids_for_entity`                                                                             | rollback-safe while unused → roll-forward-only once links exist                                                                                                   | link/access evidence                         | `100000`                                            | `tests/db/shared-document-links.test.ts` (9)         |
| `20260718103000_shared_retention_and_legal_hold.sql`           | DB-006, SEC-002, QA-005           | retention-class definitions + legal holds + three-gate deletion eligibility + audit-coupled `archive_document` (legal hold always wins)                                                | rollback-safe while unused → roll-forward-only once holds/definitions exist                                                                                       | disposition evidence                         | `100000`, `102000`, `095000`                        | `tests/db/shared-retention.test.ts` (14)             |
| `20260718104000_shared_message_templates.sql`                  | DB-007..008                       | dual-scope template identity + governed version lifecycle (approve → activate/retire serialized by row lock); no wording seeded                                                        | rollback-safe while unused → roll-forward-only once templates/versions exist                                                                                      | governed template content                    | `0002`, `20260717100000/101000`, `090000`           | `tests/db/shared-message-templates.test.ts` (21)     |
| `20260718105000_shared_outbound_messages.sql`                  | DB-009..010, SEC-004, QA-003      | immutable delivery envelope storing the rendered-content **digest only**; no plaintext recipient destination; guarded lifecycle + append-only delivery attempts                        | rollback-safe while unused → roll-forward-only once messages/attempts exist                                                                                       | delivery evidence                            | `20260717101000/103000`, `090000`, `104000`, `0002` | `tests/db/shared-outbound-messages.test.ts` (17)     |
| `20260718106000_shared_event_outbox.sql`                       | DB-011, SEC-003 (partial), QA-004 | transactional outbox + `app_worker` NOLOGIN archetype + atomic claim/complete/fail (SKIP LOCKED, claimant-bound); no worker credential, no publisher                                   | rollback-safe while unused (structure + NOLOGIN role) → roll-forward-only once rows exist                                                                         | durable delivery obligations                 | `20260717101000/103000`, `0002`                     | `tests/db/shared-event-outbox.test.ts` (13)          |
| `20260718107000_shared_processed_events_and_error_records.sql` | DB-012..013, SEC-003 (remainder)  | append-only consumer claim registry + sanitized durable error records (recursive sensitive-key/value guard, anchored patterns)                                                         | rollback-safe while both tables empty → roll-forward-only once populated                                                                                          | replay claims + error evidence               | `106000`, `0002`, `20260717101000/103000`           | `tests/db/shared-processed-errors.test.ts` (15)      |
| `20260718108000_shared_settings_and_localization.sql`          | DB-014..015, QA-006               | immutable versioned settings resolved by highest version + platform localization catalogue with governed draft/approved/retired texts (no wording seeded)                              | rollback-safe while all three tables empty → roll-forward-only once populated                                                                                     | settings/localization history                | `20260717100000/101000/105000`, `0002`              | `tests/db/shared-settings-localization.test.ts` (13) |
| `20260718109000_shared_search_metadata.sql`                    | DB-016, QA-006 (partial)          | bounded normalized search projection (pg_trgm index); source entities stay authoritative; sensitive-read gate on restricted/secret rows                                                | rollback-safe while empty → roll-forward-only once populated (coordinated rebuild)                                                                                | rebuildable projection (coordinated rebuild) | `20260717100000/101000`, `0001`, `0002`             | `tests/db/shared-search-metadata.test.ts` (11)       |
| `20260718110000_shared_tags_notes_comments.sql`                | DB-017..018, QA-007               | tenant-only tag vocabulary + soft-deletable assignments + editable notes + guarded comment threads (same-tenant/same-entity parents)                                                   | rollback-safe while all four tables empty → roll-forward-only once populated                                                                                      | user-authored records                        | `20260717101000/103000`, `090000`, `097000`, `0002` | `tests/db/shared-tags-notes-comments.test.ts` (15)   |
| `20260718111000_shared_services_hardening.sql`                 | DB-019..020, SEC-001..005         | fix-forward on merged A/B objects: three-column branch FK (tenant+company+branch), pending-only INSERT guards closing the terminal-state insert bypass, non-partial FK-support indexes | rollback-safe **only** while `documents`/`document_versions` are empty; otherwise roll-forward-only (reverting would reopen reviewed integrity/security bypasses) | none while empty; contract integrity after   | `100000`, `101000`, `0003`                          | `tests/db/shared-hardening.test.ts` (10)             |
| `supabase/seeds/05_shared_reference.sql` (seed)                | Increment M                       | reference configuration only: the five tenant-neutral retention classes (`ON CONFLICT DO NOTHING`); no tenant, no business row, no wording                                             | **rollback-safe / idempotent** (re-runnable)                                                                                                                      | none                                         | `103000`; declared seeds `seed.sql`, 01, 04         | `scripts/db/validate-seed-state.mjs` (applied twice) |

**Fix-forward legitimacy (`111000`):** migrations `100000` and `101000` are
merged history and therefore immutable. `111000` corrects their objects the
required way — a later forward migration. `shared.documents` and
`shared.document_versions` are policy-guaranteed empty in every environment at
this phase, so replacing the branch FK and adding the INSERT guards are
data-safe and validate trivially; there is no legacy-row remediation.

## Rehearsals (executed 2026-07-18)

| Rehearsal                                          | Result                                                                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean apply, empty DB                              | all **32** migration files (`0001..0003`, `20260717100000..107000`, `090000..098000`, `100000..111000`) applied in filename order from empty on the real local stack, followed by the declared seed files; exit 0                 |
| Live-catalog inventory on the fresh stack          | 22 Phase-1-5 tables, 92 indexes, 22 policies present at `83f0f70`; the exact allow-lists (tables/routines/triggers/policies) in `tests/db/foundation.test.ts` pass                                                                |
| Full DB suite on the fresh stack                   | 487/487 across 36 files (`npm run test:db`, all isolation as the non-owner runtime login)                                                                                                                                         |
| Idempotent-seed rehearsal (seed 05 + declared set) | `npm run validate:seed-state` applies the declared seeds **twice**, asserts every business table empty before and after each pass, asserts exactly the five governed retention classes, and asserts pass-2 changed no table count |
| Roll-forward recovery statement                    | roll-forward-only migrations recover via a corrective forward migration + restore-from-backup where data was lost; destructive rollback is NOT claimed                                                                            |

CI parity: the `database` job in `.github/workflows/ci.yml` repeats the same
sequence on every pull request into `develop`/`main` — immutability diff →
`npm run db:apply-migrations` → `npm run validate:seed-state` → `npm run
test:db`. The Phase 1-5 pull request is not yet opened, so no CI run on
`83f0f70` is claimed by this document; that run is owner-verifiable at PR
time.

## Seed posture (Increment M)

Seeds 02 and 03 were **deleted** by owner decision. The declared automatic
seeds are `seed.sql`, `01_reference_data.sql`, `04_iam_permission_catalog.sql`,
and `05_shared_reference.sql` (`supabase/config.toml` `[db.seed]`); no
automatic seed creates a tenant or business row. Provisioning the pilot tenant
is a **manual, gated, controlled package** —
`supabase/packages/pilot-provisioning.package.json` executed by
`scripts/db/provision-organization.mjs` under
`docs/database/pilot-provisioning-runbook.md` — never an automatic seed.
Seed 05 inserts exactly five retention classes (`operational`,
`evidence-audit`, `personal-data`, `temporary`,
`immutable-financial-history`); every retention period is NULL except
`temporary = 0` because owner/jurisdiction periods are not invented, and
`immutable-financial-history` is the sole never-delete class.
