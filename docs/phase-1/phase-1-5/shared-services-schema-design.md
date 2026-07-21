# Phase 1-5 — Shared Services Schema Design

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18 ·
**Author:** Eng. Ezzaldeen Al-Bitar

## 1. Scope

The shared-services database foundation: governed documents, message templates,
outbound-message evidence, the transactional event outbox, consumer/error
registries, versioned settings, localization, search projections, and tags/
notes/comments — **22 new tables, 51 triggers, 22 RLS policies, 92 indexes**
across 12 migrations (`20260718100000`…`20260718111000`; Increments A–D merged
earlier via PR #24, E–L on this branch) plus one structural seed (Increment M,
`supabase/seeds/05_shared_reference.sql`). The live catalog at commit `83f0f70`
is recorded in `_N_FACTS.json`; the repository now holds 32 migrations total.
No file bytes, no rendering, no providers, no worker runtime, no Phase-1-6
schema.

## 2. Entity map

```
org.tenants ─┬─ shared.document_categories (dual-scope) ─ shared.documents ─┬─ document_versions ── file_scan_results
             │                                                              ├─ document_links (generic entity)
             │                                                              └─ legal_holds · retention_classes (platform)
             ├─ shared.message_templates (dual-scope) ─ template_versions ─ outbound_messages ── delivery_attempts
             ├─ shared.event_outbox (app_worker + tenant-scoped producer) · processed_events · error_records (app_worker only)
             ├─ shared.system_settings (dual-scope) · localization_keys (platform) ── localized_texts
             ├─ shared.search_metadata (rebuildable projection)
             └─ shared.tags ── entity_tags · notes · comments (threaded)
```

ERD source: [phase-1-5-shared-services.mmd](../../database/erd/phase-1-5-shared-services.mmd).

## 3. Increment map (A–M)

| Inc | Migration        | Tables (schema `shared`)                                  | Load-bearing objects                                                                                   |
| --- | ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A   | `20260718100000` | `document_categories`, `documents`                        | Dual-scope policy envelope; `guard_document_category_scope` (platform-or-same-tenant category)         |
| B   | `20260718101000` | `document_versions`, `file_scan_results`                  | Append-only version metadata; `guard_document_version_transition` (clean-scan accept gate)             |
| C   | `20260718102000` | `document_links`                                          | Link-derived access contract; `document_ids_for_entity` (SECURITY INVOKER, RLS-scoped)                 |
| D   | `20260718103000` | `retention_classes`, `legal_holds`                        | Three-gate `document_deletion_eligibility`; audited `archive_document` (legal hold wins)               |
| E   | `20260718104000` | `message_templates`, `template_versions`                  | Dual-scope templates; version lifecycle guards; composite active-version FK                            |
| F   | `20260718105000` | `outbound_messages`, `delivery_attempts`                  | Hash-only content/recipient; guarded delivery graph; append-only attempt evidence                      |
| G   | `20260718106000` | `event_outbox` (+ role `app_worker`)                      | SKIP-LOCKED `claim_outbox_events`; claimant-bound `complete_outbox_event` / `fail_outbox_event`        |
| H   | `20260718107000` | `processed_events`, `error_records`                       | At-most-once consumer claim PK; recursive `guard_error_context_sanitized`; triage lifecycle            |
| I   | `20260718108000` | `system_settings`, `localization_keys`, `localized_texts` | Immutable versioned settings; `resolve_setting`; one-approved-text rule; `missing_translations`        |
| J   | `20260718109000` | `search_metadata`                                         | Bounded pg_trgm projection; classification-aware SELECT policy                                         |
| K   | `20260718110000` | `tags`, `entity_tags`, `notes`, `comments`                | Tenant-only tags; `guard_comment_parent`; `stamp_content_edit`                                         |
| L   | `20260718111000` | — (hardening, fix-forward)                                | Three-column document branch FK; document/version initial-state guards; non-partial FK-support indexes |
| M   | seed `05`        | rows in `retention_classes` only                          | Exactly five tenant-neutral retention classes; **no** business data, templates, categories, or wording |

## 4. Load-bearing design decisions

- **Dual-scope pattern (A, E, I).** `document_categories`, `message_templates`,
  and `system_settings` hold a platform default OR a tenant override in one
  table: a `scope` discriminator plus nullable `tenant_id`, bound by the CHECK
  `(scope='platform' AND tenant_id IS NULL) OR (scope='tenant' AND tenant_id IS
NOT NULL)`, with two partial unique indexes (platform code unique
  platform-wide; tenant code unique per tenant). Each is a documented
  nullable-tenant exception, not an oversight.
- **Link-derived access (C).** A document is reachable through a _live_ link to
  an entity the principal may see — never by possessing a `document_id`,
  `storage_key`, or `sha256`. `document_ids_for_entity` is SECURITY INVOKER, so
  it resolves under the caller's RLS and returns nothing across tenants or for
  soft-deleted links. `entity_type` is a constrained `schema.table` token;
  per-domain `entity_id` validation is a documented later-domain contract.
  `linked_by` is deliberately a plain uuid (pre-dates the tenant-bound
  attribution rule; recorded as a LOW accepted finding).
- **Clean-scan gate (B + L).** A version reaches `accepted` only via the UPDATE
  guard: a `clean` scan must exist and no `infected` scan may exist for that
  version; terminal states are immutable, and replacement content is a new
  version. Increment L closes the INSERT path too: documents and versions must
  be inserted `pending` with every terminal timestamp NULL.
- **Legal-hold precedence (D).** `document_deletion_eligibility` answers
  through three ordered gates — legal hold (flag or active hold record) always
  wins, then active links, then retention elapsed on a class that permits
  deletion. `archive_document` is the only route to `archived` and writes
  `iam.audit_append` in the same transaction: an audit failure rolls the
  archival back. No physical deletion happens in this phase.
- **Hash-only outbound content (F).** `outbound_messages` stores
  `body_sha256` (exactly 32 bytes) instead of rendered content and a 32-byte
  `recipient_digest` and/or a tenant-bound `recipient_user_id` instead of a
  plaintext destination. The delivery lifecycle guard permits only
  pending→queued→sending→sent→delivered with explicit failure/cancel paths;
  failed→queued server-increments `retry_count`; all lifecycle timestamps are
  server-stamped. `delivery_attempts` is append-only with a required sanitized
  `error_summary` on errored attempts.
- **Outbox claim semantics (G).** `claim_outbox_events` claims due-pending or
  stale-claimed rows in one `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED
LIMIT n)` — concurrent claimants receive disjoint sets, and the returned set
  is explicitly unordered. `complete_outbox_event` and `fail_outbox_event` are
  claimant-bound conditional UPDATEs: a different claimant cannot finalize a
  claim. `fail_outbox_event` re-queues below `p_max_attempts` and dead-letters
  at/above it, always retaining a sanitized `last_error`. An INSERT guard
  forbids forged initial state. `payload`/`headers` are constrained to JSON
  objects but have **no** database sanitizer trigger — producer/worker
  responsibility, recorded as an accepted MEDIUM position (same for
  `delivery_attempts.details`).
- **Processed-events claim contract (H).** PK `(consumer_code, event_id)`;
  the consumer claims with `INSERT … ON CONFLICT DO NOTHING RETURNING` and
  performs the side effect only when a row returns, so replay is refused before
  side effects. Append-only (worker grants are SELECT/INSERT only); a `failed`
  outcome keeps the claim and blocks reprocessing. Distinct by design from
  `shared.idempotency_keys` (request-level fingerprinting), which is reused
  unchanged.
- **Versioned-row settings (I).** `system_settings` rows are immutable: a
  change INSERTs version n+1, refereed by `UNIQUE NULLS NOT DISTINCT
(tenant_id, setting_key, version)`. `resolve_setting` returns the
  highest-version tenant row for `iam.current_tenant_id()`, falling back to the
  highest platform version. `is_sensitive` classifies — it does not encrypt —
  and no secret may be stored. Localization ships an empty platform key
  catalogue and a draft→approved→retired text lifecycle with at most one
  approved text per key/locale; no customer wording is seeded.
- **Sensitive-read gate (J, K).** `search_metadata`, `notes`, and `comments`
  policies require `tenant_id = iam.current_tenant_id()` AND (classification in
  public/internal OR `iam.has_permission('iam.sensitive.view')`). Note/comment
  bodies are classified restricted in the data dictionary.
- **Worker archetype (G, H).** `app_worker` is a NOLOGIN, non-owner,
  no-BYPASSRLS role confined to exactly three tables — `event_outbox`
  (SELECT/INSERT/UPDATE), `processed_events` (SELECT/INSERT), `error_records`
  (SELECT/INSERT/UPDATE) — plus EXECUTE on the three outbox routines and
  `iam.current_user_id()`. Its `wkr_*` policies deliberately span all tenants
  (infrastructure dispatch, probe-verified confined to the enumerated surface);
  DELETE is structurally absent everywhere. `app_runtime`/`app_readonly` held
  zero grant and zero policy on all three tables as delivered; since 2026-07-21
  ([DBCR-P1-13-001](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md))
  `app_runtime` holds tenant-scoped SELECT/INSERT on `event_outbox` alone, while
  `processed_events` and `error_records` stay worker-only and `app_readonly`
  stays at zero. No LOGIN credential is created in this phase.
- **Tenant-only tags (K).** `tags` carries `tenant_id NOT NULL` — no platform
  tag catalogue exists, deliberately avoiding both an ungoverned platform
  vocabulary and a wider nullable-tenant exception surface. Active `tag_code`
  is unique per tenant; one live assignment per (tag, entity) with re-tagging
  after soft deletion.
- **Threaded comments (K).** `comments` self-references through the composite
  `(tenant_id, parent_comment_id)` FK, and `guard_comment_parent` additionally
  requires the parent to be live and to belong to the same generic entity; a
  cross-tenant parent is indistinguishable from a missing one
  (`foreign_key_violation`), disclosing nothing. Body edits server-stamp
  `edited_at` via `stamp_content_edit` (shared with `notes`).
- **Fix-forward hardening (L).** The merged Increment A/B migrations are
  immutable history, so L corrects them forward: the document branch FK becomes
  three-column `(tenant_id, company_id, branch_id)` so branch scope cannot
  drift across same-tenant companies, both terminal-state INSERT bypasses are
  closed, and the exact non-partial FK-support indexes are added. Increment H's
  credential-shaped-value patterns are deliberately unanchored substring
  matches, so a JWT or AWS-key fragment is caught anywhere inside a longer
  string.

## 5. Tenancy and RLS

Every table is ENABLE + FORCE RLS with default deny; runtime/readonly hold
SELECT only (plus EXECUTE on `document_ids_for_entity`,
`document_deletion_eligibility`, `resolve_setting`, `missing_translations`) and
no write grant or policy anywhere. Documented exceptions to `tenant_id NOT
NULL` tenant isolation:

- **Dual-scope** (`document_categories`, `message_templates`,
  `system_settings`) and `template_versions` (mirrors its template, including
  platform NULL) — visible as platform-or-own-tenant.
- **Platform reference, no tenant column:** `retention_classes`,
  `localization_keys`, `localized_texts` — readable by every app role.
- **Nullable by design:** `error_records` (failures before tenant context;
  company/branch forbidden when tenant is NULL) and `processed_events`
  (platform consumers).
- **Worker-only:** `processed_events` and `error_records` carry only the
  all-tenant `wkr_*` policies for `app_worker`; application roles have no
  surface at all. `event_outbox` was in this group as delivered, and since
  2026-07-21 also carries two tenant-scoped `app_runtime` producer policies
  (DBCR-P1-13-001).

Cross-tenant references are structurally impossible where a real parent exists:
children FK to composite `(tenant_id, id)` candidate keys, org scope uses the
three-column branch FK, and attribution columns (`approved_by`,
`recipient_user_id`, `assigned_by`, `author_id`) are tenant-bound composite FKs
into `iam.user_accounts`. Deliberate plain-uuid exceptions:
`document_links.linked_by` (LOW, accepted) and `error_records.resolved_by`
(nullable-tenant rows cannot carry a composite user FK; indexed for
attribution).

## 6. Verification pointers

Behaviour claims above are exercised by the Phase 1-5 suites under `tests/db/`
(`shared-documents`, `shared-document-versions`, `shared-document-links`,
`shared-retention`, `shared-message-templates`, `shared-outbound-messages`,
`shared-event-outbox`, `shared-processed-errors`,
`shared-settings-localization`, `shared-search-metadata`,
`shared-tags-notes-comments`, `shared-hardening`, plus `no-fake-data`) — 491
`it` blocks repo-wide at `83f0f70`. CI runs `validate:seed-state` before
`test:db`; the pass status of the final SHA is owner-verifiable in the CI
history. The adversarial review ledger (2026-07-18, 14 vectors, zero unresolved
Critical/High) is recorded in the Phase 1-5 completion documentation.

## 7. Explicit non-goals (deferred, not hidden)

Notification rendering, delivery providers, the publisher/polling worker
runtime, consent enforcement (only `purpose`, a `suppressed`-style failure
class, and a nullable `consent_ref` placeholder exist), physical file storage
and deletion, search normalization/refresh pipelines, and per-domain
`entity_id` validation are later backend/domain responsibilities. Seeds 02/03
were deleted per owner decision: pilot-tenant provisioning is a manual, gated
package (`supabase/packages/pilot-provisioning.package.json` +
`scripts/db/provision-organization.mjs` +
[pilot-provisioning-runbook.md](../../database/pilot-provisioning-runbook.md))
for the pilot tenant — no tenant rows ship in any seed. Phase 1-6 is **not**
started; the PR for this branch is **not** yet opened and the owner gate is
**Pending**.
