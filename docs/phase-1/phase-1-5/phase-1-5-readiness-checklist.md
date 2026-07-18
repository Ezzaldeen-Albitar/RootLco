# Phase 1-5 Readiness Checklist

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18

| #   | Item                                                                                                                                       | State                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1   | Phase 1-4 gate commit `c1c3fa4` contained in `develop` before start (PR #20, `69e0da1`)                                                    | ✅ verified                    |
| 2   | Migration-count reconciliation (13 → 20) applied as a forward doc correction only                                                          | ✅                             |
| 3   | Increments A–D merged into `develop` via PR #24 (`ee3b1de`); merged files untouched                                                        | ✅ CI immutability diff        |
| 4   | 12 P1-5 migrations `20260718100000..111000` apply from empty in the full 32-file apply                                                     | ✅ (2026-07-18)                |
| 5   | 22 tables / 92 indexes / 22 policies — exact allow-lists green                                                                             | ✅                             |
| 6   | Full DB suite green on clean reset                                                                                                         | ✅ 491/491 (36 files)          |
| 7   | Seeds 02/03 deleted; declared seeds `seed.sql`/01/04/05 only; seed 05 = five retention classes                                             | ✅                             |
| 8   | `validate:seed-state`: seeds applied twice, business tables empty, counts idempotent — wired before `test:db` in CI                        | ✅                             |
| 9   | Pilot provisioning is a manual gated controlled package (package + script + runbook); no automatic seed creates a tenant                   | ✅                             |
| 10  | Outbound messages store content **hash-only**; no plaintext recipient destination                                                          | ✅                             |
| 11  | `app_worker` NOLOGIN archetype confined to outbox/processed/errors + claim/complete/fail + `iam.current_user_id()`; no standing credential | ✅                             |
| 12  | Outbox double-claim refuted: SKIP-LOCKED claim, claimant-bound complete/fail                                                               | ✅                             |
| 13  | Sensitive-read gate `iam.has_permission('iam.sensitive.view')` on search_metadata/notes/comments                                           | ✅                             |
| 14  | No SECURITY DEFINER; ENABLE+FORCE RLS; no BYPASSRLS; runtime/readonly SELECT-only; DELETE granted nowhere                                  | ✅                             |
| 15  | Retention: five structural classes only; `archive_document` audit-coupled; legal hold always wins                                          | ✅                             |
| 16  | Fix-forward hardening in `111000` (company/branch binding, pending-only INSERT guards, FK-support indexes) — merged files unedited         | ✅                             |
| 17  | No fake/demo business data: static guard + clean-DB emptiness test                                                                         | ✅                             |
| 18  | Data dictionary covers every module-schema table and column                                                                                | ✅ coverage test               |
| 19  | Adversarial review: 14 vectors — 8 refuted, 3 fixed, 3 accepted-documented; zero unresolved Critical/High                                  | ✅ (2026-07-18)                |
| 20  | Local quality gates: lint / typecheck / format / style / build / secret + scope scans                                                      | ✅ local run                   |
| 21  | CI run on the final SHA `83f0f70`                                                                                                          | ⏳ **owner-verifiable** at PR  |
| 22  | Pull request opened, CI green, owner gate, merged into develop                                                                             | ⏳ **pending** (PR NOT opened) |

**Blockers to Go:** only #21–#22. CI triggers on pull requests into
`develop`/`main` and pushes to those branches (`.github/workflows/ci.yml`), so
no CI run exists for the feature-branch SHA `83f0f70` yet; it becomes
verifiable the moment the owner opens the pull request. The owner gate is
**Pending** and no merge has occurred. Everything else is satisfied and
test-backed locally.

## Evidence pointers

- Items 1–4: `docs/phase-1/phase-1-5/initial-audit.md` §0;
  `docs/database/phase-1-5-migration-classification.md` (rehearsals);
  `npm run db:apply-migrations` / `supabase db reset`.
- Items 5–6: `tests/db/foundation.test.ts` exact allow-lists;
  `npm run test:db` (491 tests / 36 files).
- Items 7–9: `supabase/config.toml` `[db.seed]`;
  `scripts/db/validate-seed-state.mjs`; the CI `database` job runs it before
  `test:db`; `supabase/packages/pilot-provisioning.package.json` +
  `scripts/db/provision-organization.mjs` +
  `docs/database/pilot-provisioning-runbook.md`.
- Items 10–15: `tests/db/shared-outbound-messages.test.ts`,
  `shared-event-outbox.test.ts`, `shared-search-metadata.test.ts`,
  `shared-tags-notes-comments.test.ts`, `shared-retention.test.ts`,
  `shared-processed-errors.test.ts`, and the migration headers
  (`20260718104000..111000`).
- Item 16: `supabase/migrations/20260718111000_shared_services_hardening.sql`;
  `tests/db/shared-hardening.test.ts`.
- Item 17: `npm run validate:no-fake-data`; `tests/db/no-fake-data.test.ts`.
- Item 18: `tests/db/org-security.test.ts` (data-dictionary coverage test).
- Item 20: `npm run verify` (lint, typecheck, format:check, style:check,
  browser-secret scan, unit tests, build) plus
  `npm run security:scope-exclusions`.

## Adversarial review summary (2026-07-18)

Fourteen attack vectors were exercised against the live schema. Refuted
(8): tenant escape, RLS bypass / SECURITY DEFINER abuse, outbox double-claim,
immutable-version mutation, duplicate idempotency claims, cross-tenant
comments/tags, fake-data leakage, and Phase 1-6 scope creep. Fixed (3):
document company/branch mismatch and the terminal-state INSERT bypass around
the retention/legal-hold path (both closed fix-forward in `111000`), and
unanchored error-context sanitizer patterns (anchored in
`shared.guard_error_context_sanitized`, migration `107000`). Accepted with
documentation (3): outbox payload and delivery details carry no sanitizer
trigger (producer/worker responsibility — MEDIUM); the `wkr_*` all-tenant
worker surface (deliberate infrastructure design, probe-verified confined to
the three enumerated tables); `document_links.linked_by` is a plain uuid
(LOW — predates the attribution rule). Zero unresolved Critical/High
findings.

## Honest scope statement

Phase 1-6 is **not started**. No notification rendering, no delivery
providers, no worker process, and no outbox publisher are implemented —
Phase 1-5 delivers the database foundation only, and the `app_worker`
archetype carries no login credential. The pilot tenant is provisioned only
through the controlled package above; nothing in the automatic seed path
names or creates it.
