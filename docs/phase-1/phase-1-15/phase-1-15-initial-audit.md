# Phase 1-15 — Initial Audit and Contract Inventory (Wave 0)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date opened:** 2026-07-22 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Purpose of this record

Wave 0 of Phase 1-15 is **read-only reality inspection**. This record captures the protected state
this phase starts from and the **executable contracts** the shared services must compose. Every fact
below was verified first-hand against Git, the live local PostgreSQL, or the source tree — not
inferred from planning prose. Where a fact came from a live database probe it is marked
**[live probe]**; where it came from source it is marked **[source]**; where it came from Git it is
marked **[git]**.

Nothing in this record is an implementation claim. No task is complete because it appears here.

## 2. Protected starting state [git]

| Item                            | Value                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `origin/main`                   | `8ca1da257fc89585f2bb45459e435ec124b8a5a7`                                          |
| `origin/develop`                | `c7edc512657077ab31cc98e7b748b4bf90af06d5`                                          |
| Root tree (both)                | `85125b264b03b0a734a7c5a029bdcd135dd8aac0` — byte-identical                         |
| Feature branch                  | `feature/p1-15-shared-services-backend`, created from `origin/develop` at `c7edc51` |
| Working tree at branch creation | clean; no in-progress merge/rebase/cherry-pick                                      |

**P1-14 containment in `origin/develop`** — all verified contained: `1477886` (PR #54), `c16f998`
(PR #55), `63916b8` (PR #56), `5b34c17` (PR #58), `c7edc51` (PR #59 gate merge), and the gate SHA
`e74246b`. The canonical P1-14 decision on protected `develop` reads
**"Go — P1-14 Authentication, Authorization, and Administration Backend Gate Passed"**, and P1-14 was
promoted to `main` by owner PR #57 (merge `8ca1da2`).

**P1-15 had not started.** No `p1-15` / `phase-1-15` branch existed locally or remotely, and no
`phase-1-15` path existed in the tree, before this phase opened. This is a fresh start, not a
continuation.

## 3. Database baseline [live probe]

`116` migrations applied (`supabase_migrations.schema_migrations`). Migrations `1–116` are frozen and
**must not be modified** by this phase. The `shared` schema — delivered by Phase 1-5 and the contract
this phase's services sit on — contains the following tables:

`comments`, `currencies`, `delivery_attempts`, `document_categories`, `document_links`,
`document_versions`, `documents`, `entity_tags`, `error_records`, `event_outbox`,
`file_scan_results`, `idempotency_keys`, `languages`, `legal_holds`, `localization_keys`,
`localized_texts`, `message_templates`, `notes`, `number_sequences`, `outbound_messages`,
`processed_events`, `retention_classes`, `search_metadata`, `status_evidence`, `status_history`,
`system_settings`, `tags`, `template_versions`, `timezones`.

Every P1-15 mandatory capability has a pre-existing database contract. **The phase plan's expectation
that no new database work is required is, so far, consistent with the schema.** This is provisional:
it is confirmed capability-by-capability during implementation, and any genuine gap is raised as a
controlled database change request rather than an improvised migration.

`shared` schema functions, all `SECURITY INVOKER` (consistent with the 0-`SECURITY DEFINER` baseline):

| Function                                                                                                                                                                                                 | Role in P1-15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next_display_number(p_sequence_code text, p_company_id uuid, p_branch_id uuid) → (display_number text, sequence_value bigint)`                                                                          | Number allocation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `claim_outbox_events(p_claimant text, p_limit int, p_lease interval)` · `complete_outbox_event(p_id uuid, p_claimant text)` · `fail_outbox_event(p_id, p_claimant, p_error, p_retry_in, p_max_attempts)` | Event/outbox dispatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `archive_document(p_tenant, p_document_id, p_actor, p_reason, p_actor_kind)` · `document_deletion_eligibility(p_tenant, p_document_id)` · `document_ids_for_entity(p_entity_type, p_entity_id)`          | Attachment lifecycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `resolve_setting(p_key text) → jsonb`                                                                                                                                                                    | Effective settings resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `missing_translations(p_locale text)`                                                                                                                                                                    | Localization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `stamp_status_history()` · `touch_row_metadata()` · `stamp_content_edit()` (triggers)                                                                                                                    | Status history, row metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `guard_*()` (trigger guards)                                                                                                                                                                             | DB-enforced lifecycle: `guard_number_sequence_regression`, `guard_template_version_lifecycle`, `guard_template_active_version`, `guard_template_version_scope`, `guard_outbound_message_lifecycle`, `guard_outbound_message_scope`, `guard_event_outbox_initial_state`, `guard_error_context_sanitized`, `guard_error_record_lifecycle`, `guard_document_initial_state`, `guard_document_version_initial_state`, `guard_document_version_transition`, `guard_document_category_scope`, `guard_localized_text_lifecycle`, `guard_comment_parent` |

## 4. Number allocation — binding contract [live probe + source]

Verified against the live function body and
[the Number Sequence and Display Number Standard](../../database/number-sequence-standard.md)
(Adopted, binding).

1. **No tenant parameter, by design.** The tenant comes only from `iam.current_tenant_id()` reading
   transaction-local `app.tenant_id`. A caller can never allocate into a tenant it merely names.
   No tenant context → SQLSTATE `42501`.
2. **`p_company_id` / `p_branch_id` are scope selectors, not authority.** They are validated against
   `iam.allowed_company_ids()` / `iam.allowed_branch_ids()`; outside the allowed list → `42501`.
   RLS remains the enforcement layer.
3. **Concurrency-safe.** `SELECT … FOR UPDATE` serialises allocation per sequence row; concurrent
   allocators for the same scope queue on the lock.
4. **Never auto-provisions.** An unknown or RLS-invisible sequence → SQLSTATE `P0002`
   (`no_data_found`), indistinguishable from "not configured". Runtime roles hold **no INSERT and no
   DELETE** grant or policy on `shared.number_sequences`: provisioning is an administrative
   configuration action (ADR-008). **The P1-15 API must not create sequences.**
5. **Gapless — but state it precisely.** Committed allocations form a gapless consecutive run, and a
   rolled-back allocation returns its value to the next caller (standard §6 evidence rows 8 and 11:
   50 parallel workers → 50 unique consecutive values; 30 concurrent with every third rolled back →
   gapless committed run). Business-level gaps from **voids** and **period resets** are tolerated and
   never renumbered. P1-15 documentation must claim exactly this and no more.
6. **Allocation belongs in the consuming transaction** (standard rule 5). The row lock is held from
   allocation until COMMIT/ROLLBACK, so the standard directs callers to allocate as late as
   practical and never to do slow work while holding it (§10.3).
7. **Rendering widens, never truncates**: `lpad(value, greatest(pad_width, length(value)), '0')`,
   with `{period}` substituted into `prefix_template`. Period keys are UTC:
   `never` → NULL, `yearly` → `YYYY`, `monthly` → `YYYY-MM`, `daily` → `YYYY-MM-DD`.
8. **Counter rewind is blocked** by `guard_number_sequence_regression` → SQLSTATE `23514`, except
   together with a legitimate period change.
9. **Display numbers carry no authority** (standard §10.1): guessable by design, never an
   authorization token, never a cross-tenant lookup key.

**Open design tension, recorded honestly.** Standard rule 5 requires the allocation to happen in the
same transaction as the business write that consumes the number. A standalone HTTP "allocate a
number" operation necessarily commits the allocation on its own, so a number it issues that is never
consumed becomes a tolerated business-level gap. The primary P1-15 contract is therefore the
**in-process allocation service that later business modules call inside their own transaction**; any
public operation is a secondary surface whose gap semantics are documented explicitly rather than
implied. This is resolved and evidenced during implementation, not assumed here.

## 5. API and operation conventions [source]

From `src/server/auth/operation-registry.ts` and the 25 existing `route.ts` files under
`src/app/api/v1/`.

- Operations are declared with `defineOperation({...})` **inside the route file** that serves them,
  and exported. `scripts/check-authorization-coverage.mjs` fails CI when a route exists without a
  registration or a registration without a route.
- Declaration fields: `id`, `module`, `method`, `path`, `summary`, `permissions[]`, `public` +
  `publicReason`, `scope` (`tenant|company|branch`), `auditClass`
  (`none|privileged|approval|financial|export|security`), `auditAction`, `featureFlag`, `idempotent`,
  `versionGuarded`, `rateLimitPolicy`, `cacheCategory`.
- `defineOperation` throws **at module load** when a non-public operation declares no permissions, or
  an audited class carries no audit action, and `auditAction` is checked against the controlled
  catalog in `audit-actions.ts`.
- **Operation id grammar:** `/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/` — dotted lower-case.
- **Path grammar:** `/^(?:\/(?:[a-z0-9-]+|\{[a-z][a-zA-Z0-9]*\}))+$/` — each segment is a lower-case
  literal or a `{camelCase}` parameter.

### 5.1 Naming reconciliation — colon-verb paths are not usable

The phase directive proposes planning labels `POST /api/v1/numbers:allocate` and
`POST /api/v1/attachments:authorize-upload`. **A colon is not accepted by `PATH_PATTERN`**, so these
would be rejected by `defineOperation` at import time. No colon-verb path exists anywhere in this
codebase.

The established convention, confirmed across the P1-14 surface, is that **an action becomes a noun
sub-resource**: `/auth/password-reset/completion`, `/iam/invitations/{userId}/activation`,
`/iam/users/{userId}/status`. P1-15 follows the existing convention; the planning labels are treated
as intent, not as literal paths, and the final canonical paths are recorded in the API catalog.

### 5.2 Handler shape (canonical, from `src/app/api/v1/iam/grants/route.ts`)

A Route Handler contains **no business logic**: it validates, then delegates to a module service with
the controlled data-access handle. `export const runtime = 'nodejs'` and
`export const dynamic = 'force-dynamic'` are set; the body is delegated through
`handleOperation(OPERATION, request, async ({ db, request: raw }) => …, { body })` with
`parseJsonBody(raw, ZodSchema)` and `.strict()` schemas.

## 6. Environment [live probe]

Node v24.16.0, npm 11.13.0, dependencies installed. The Supabase CLI stack is running:
`supabase_db_RootLco` (PostgreSQL, 116 migrations), `supabase_auth_RootLco`, `supabase_storage_RootLco`,
`supabase_kong_RootLco`, `supabase_rest_RootLco`, `supabase_realtime_RootLco`, `supabase_studio_RootLco`,
`supabase_pg_meta_RootLco`, `supabase_inbucket_RootLco`.

A storage container exists **in the local CLI stack**. Its presence is **not** an approval of an
object-storage provider for any other environment, and nothing in this phase may claim production
storage provisioning. Provider selection is governed in the provider-decision record for this phase.

## 7. Scope boundary held by this phase

Out of scope and not implemented: frontend, P1-16+ business modules, Zoom functionality, Benzene data
migration, production infrastructure/storage/email/SMS/CDN/broker provisioning, antivirus scanning,
OCR, arbitrary workflow engines or query languages, unbounded filtering or sorting, public buckets,
permanent signed URLs, a second audit/outbox/error/context/logging/authorization framework, and
product-name finalization. Benzene remains a configurable pilot tenant and is never hard-coded as an
owner, platform tenant, or privileged branch.

## 8. Status

**Wave 0 is inspection only.** No implementation task is complete. The P1-15 owner gate is opened and
remains **Pending** for the entire feature branch; it may be converted only by the approval owner
after the feature is merged into protected `develop` and the protected post-merge state is
independently re-verified.
