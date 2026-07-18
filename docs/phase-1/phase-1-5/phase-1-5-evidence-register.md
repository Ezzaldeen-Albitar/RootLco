# Phase 1-5 Evidence Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-5 · **Date:** 2026-07-18 · **Recorded by:** Eng. Ezzaldeen Al-Bitar
(owner-authorized self-review — [policy](../../governance/solo-developer-review-policy.md))

Every entry was executed on 2026-07-18 on the development host (Windows 11,
Node 24.16.0, PostgreSQL 17). **Evidence binding convention:** all counts and
object inventories below were captured from the live catalog of a database
freshly migrated from the implementation tree at commit `83f0f70`
(`feature/p1-05-shared-services-database`). This register is delivered in a
docs-only commit that follows `83f0f70`; the implementation SHA — not the docs
commit — is the evidence anchor.

## 1. Base and containment (Proven)

Branch `feature/p1-05-shared-services-database` from `origin/develop` `69e0da1`
(the Phase 1-4 gate commit `c1c3fa4` is contained via PR #20 — verified before
start). Increments A–D plus the CI fix and the no-fake-data policy were merged
back into `develop` via PR #24 (merge `ee3b1de`); ancestry re-verified today
(`git merge-base --is-ancestor` → contained). Increments E–M continue on the
same branch; the E–M pull request is **not yet opened**.

## 2. Migrations and objects (Proven)

Phase 1-5 spans **twelve** migrations `20260718100000..111000`: A–D
(`100000..103000`, merged earlier via PR #24) and the **eight** on this branch
(E `104000` templates, F `105000` outbound, G `106000` outbox + `app_worker`,
H `107000` processed/errors, I `108000` settings/localization, J `109000`
search, K `110000` tags/notes/comments, L `111000` hardening + forward fixes).
**22 new tables, 22 new functions, 51 new triggers, 22 new RLS policies, 92
Phase 1-5 indexes.** All **32** migration files apply cleanly from an empty
database (re-executed today; the module schemas now hold 63 tables). Merged
migrations were not edited; the Increment A/B corrections (three-column
company/branch FK, initial-state INSERT guards, non-partial FK-support indexes)
are carried as fix-forward work inside `111000`.

## 3. Seeds and provisioning posture (Proven)

Three declared seed files: `01_reference_data`, `04_iam_permission_catalog`,
`05_shared_reference`. Seed 05 inserts **exactly five retention classes**
(`operational`, `evidence-audit`, `personal-data`, `temporary`,
`immutable-financial-history`) and nothing else. The former seeds 02/03 are
**deleted** per owner decision: pilot provisioning is now a manually gated,
controlled package (`supabase/packages/pilot-provisioning.package.json` +
`scripts/db/provision-organization.mjs` +
[runbook](../../database/pilot-provisioning-runbook.md)); no tenant or business
row is auto-seeded. `npm run validate:seed-state` (re-executed today, exit 0)
applies the declared seeds **twice** and asserts structural-only content, exact
retention classes, empty business tables, and idempotent counts.

## 4. Test suite (Proven)

**480 tests in 36 files on the `83f0f70` tree.** The 311 pre-existing Phase
1-2/1-3/1-4 tests are preserved (`org-provisioning` and `iam-seeds` refactored
to ephemeral tenant fixtures at equal coverage); **169 new** Phase 1-5 tests in
13 new files: shared-documents 16, shared-document-versions 14,
shared-document-links 9, shared-retention 14, shared-message-templates 21,
shared-outbound-messages 17, shared-event-outbox 13, shared-processed-errors
15, shared-settings-localization 13, shared-search-metadata 11,
shared-tags-notes-comments 15, shared-hardening 10, no-fake-data 1. Every
isolation assertion runs as the NON-OWNER runtime login; worker assertions run
as a dedicated test worker login. Suites ran green locally per increment
(targeted runs against a freshly migrated database); today's re-run of the
posture suites (foundation 14, org-security 9, shared-hardening 10,
no-fake-data 1) passed **34/34**. The single-process **full**-suite run is a CI
concern (§7).

## 5. Security properties proven by test

| Property                                                                                                                               | Evidence                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Tenant isolation on every shared-service table; composite child FKs make cross-tenant links structurally impossible                    | rls, org-security, cross-tenant denials per suite  |
| No SECURITY DEFINER; every module routine INVOKER with empty search_path; RLS ENABLE + FORCE everywhere                                | shared-hardening, org-security                     |
| `app_worker` confined to `event_outbox`/`processed_events`/`error_records` + claim/complete/fail + `iam.current_user_id`; exact grants | shared-hardening (exact-surface assertions)        |
| Outbox single-claim under concurrency (`FOR UPDATE SKIP LOCKED`); retry/dead-letter are explicit transitions                           | shared-event-outbox                                |
| Outbound content is hash-only (`body_sha256`, 32-byte `recipient_digest`; no plaintext destination or body)                            | shared-outbound-messages                           |
| Accepted/approved versions immutable; `accepted` reachable only via the clean-scan gate                                                | shared-document-versions, shared-message-templates |
| Legal hold always wins; archival is audited via `iam.audit_append` and aborts if the audit write fails                                 | shared-retention                                   |
| Sensitive-read gate: restricted rows require `iam.has_permission('iam.sensitive.view')`                                                | shared-tags-notes-comments, shared-search-metadata |
| Error context rejects sensitive keys/values via recursive JSON scan; guarded lifecycle                                                 | shared-processed-errors                            |
| Clean database has empty business tables; structural reference only                                                                    | no-fake-data test + validate:seed-state            |
| No Phase 1-6 `crm`/`veh` object exists                                                                                                 | shared-hardening                                   |

## 6. Guards and validators (executed 2026-07-18)

All four repository guards ran bare on the `83f0f70` tree and exited **0** over
**234 tracked files**: scope-exclusion (pilot hard-coding + excluded scope),
no-fake-data static scan, browser-exposed-secret check, and canonical-document
integrity (both governed DOCX hashes match). `validate:seed-state` and the
32-migration clean apply also exited 0 (§2, §3).

## 7. Adversarial review ledger (Fable, 2026-07-18)

A focused adversarial pass ran real probes over the twelve migrations and the
live database. **14 vectors; zero unresolved Critical/High.**

| #   | Vector                                                                     | Classification        | Disposition                                                                                                                                        |
| --- | -------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tenant escape through any shared-service row                               | Refuted               | Composite tenant FKs + FORCE RLS; cross-tenant probes returned zero rows / were rejected (per-suite denial tests).                                 |
| 2   | RLS bypass via SECURITY DEFINER, ownership, or missing FORCE               | Refuted               | Catalog probes found none; shared-hardening asserts the full INVOKER/FORCE posture.                                                                |
| 3   | Outbox double-claim under concurrent workers                               | Refuted               | `FOR UPDATE SKIP LOCKED` claim; disjoint-claim assertions in shared-event-outbox.                                                                  |
| 4   | Mutating an immutable/approved version                                     | Refuted               | Immutability guards on accepted/approved content; denial tests in the version suites.                                                              |
| 5   | Duplicate idempotency (replaying a processed event)                        | Refuted               | PK `(consumer_code, event_id)`; duplicate insert rejected before side effects.                                                                     |
| 6   | Cross-tenant comments/tags attachment                                      | Refuted               | Composite FKs + tenant RLS; denial tests in shared-tags-notes-comments.                                                                            |
| 7   | Fake/demo business data leakage into a clean database                      | Refuted               | no-fake-data guard + test; validate:seed-state proves empty business tables.                                                                       |
| 8   | Phase 1-6 scope creep (crm/veh objects, notification runtime)              | Refuted               | shared-hardening asserts exactly five module schemas and no crm/veh table.                                                                         |
| 9   | Document branch belonging to a different same-tenant company               | Fixed (L)             | `ck_documents_branch_requires_company` + three-column branch FK in `111000`; test rejects the mismatch.                                            |
| 10  | Legal-hold/retention bypass via direct terminal-state INSERT               | Fixed (L)             | Initial-state INSERT guards on documents/document_versions in `111000`; direct archived/accepted inserts rejected by test.                         |
| 11  | Unsafe error metadata (sensitive keys/values passing an unanchored filter) | Fixed (H)             | `guard_error_context_sanitized` recursive key **and** value scan; denial tests in shared-processed-errors.                                         |
| 12  | Outbox payload / delivery details carry no database sanitizer trigger      | Accepted (MEDIUM)     | Producer/worker responsibility, bound by [event-payload-security-rules](event-payload-security-rules.md); JSON-object CHECKs only at the DB layer. |
| 13  | `wkr_*` policies give `app_worker` all-tenant visibility on worker tables  | Accepted (deliberate) | Infrastructure capability confined to exactly the three worker tables; surface probe-verified exact (grants + EXECUTE set) in shared-hardening.    |
| 14  | `document_links.linked_by` is a plain uuid (predates the attribution rule) | Accepted (LOW)        | No composite user FK on this one column; recorded as a forward candidate, not corrected in `111000`.                                               |

## 8. CI (honest status)

The `Database migrations and RLS tests` job asserts merged-migration
immutability on pull requests, applies all 32 migrations to a clean PostgreSQL
17, runs `validate:seed-state` **before** `test:db`, then runs the full
480-test suite. The secrets job runs the env-file/key-material checks, the
scope-exclusion guard, the credential-pattern scan, the browser-secret check,
and the no-fake-data scan. **No GitHub Actions run exists for the final
implementation SHA `83f0f70`** — CI on it is owner-verifiable once the E–M pull
request is opened; CI is not claimed green until that run reports.

## 9. Honest limits carried

Solo review throughout (P1-EC-016 open). **No notification rendering, delivery
provider, worker process, or outbox publisher/polling loop is implemented** —
the database defines and access-controls the shapes only. Consent enforcement
is a placeholder (`purpose`, `suppressed`, nullable `consent_ref`) until a
consent source exists. `app_worker` is a NOLOGIN archetype; the credential
handoff is Phase 1-13 scope. Payload/delivery-detail sanitization is a
producer/worker obligation (ledger #12). The owner gate is **Pending**; Phase
1-6 is **not started**.
