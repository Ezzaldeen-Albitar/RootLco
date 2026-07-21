# Phase 1-5 — Shared Services RLS Policy Matrix

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18

> **Amendment — 2026-07-21,
> [DBCR-P1-13-001](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md).**
> `shared.event_outbox` is no longer worker-only. Migration
> `20260725090000_iam_shared_runtime_write_capabilities.sql` grants `app_runtime` tenant-scoped
> SELECT and INSERT on it under two additional policies, so a producer can write its envelope in
> the transaction that produced it. `shared.processed_events` and `shared.error_records` are
> untouched and remain worker-only, and no role gained UPDATE, DELETE, or TRUNCATE anywhere. This
> document carries the amended posture; where a statement described the phase as delivered, the
> amendment is marked in place rather than the history rewritten.

Every Phase-1-5 table (22, all in `shared`) has RLS **enabled AND forced**. Each
carried exactly **one** policy as delivered; `shared.event_outbox` has carried
three since the amendment above. Runtime roles (`app_runtime`, `app_readonly`)
hold **SELECT only** where they hold anything, the sole exception being
`app_runtime` INSERT on `shared.event_outbox`; no other runtime
INSERT/UPDATE/DELETE grant exists on any Phase-1-5 table and `app_readonly`
holds no write grant at all. `shared.processed_events` and
`shared.error_records` carry a deliberate `wkr_` all-tenant policy for
`app_worker` and **zero** runtime grant/policy. Default deny: with no context,
`iam.current_*` is NULL and every tenant policy matches zero rows.

| Table                        | Policy                                                                                        | Verb                | Roles                       | USING summary                                                                                                   | Writes                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `shared.comments`            | `sel_comments_tenant`                                                                         | SELECT              | `app_runtime, app_readonly` | same tenant AND (public/internal OR `iam.sensitive.view`)                                                       | none                                               |
| `shared.delivery_attempts`   | `sel_delivery_attempts_tenant`                                                                | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.document_categories` | `sel_document_categories_visible`                                                             | SELECT              | `app_runtime, app_readonly` | `scope='platform'` OR same tenant                                                                               | none                                               |
| `shared.document_links`      | `sel_document_links_tenant`                                                                   | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.document_versions`   | `sel_document_versions_tenant`                                                                | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.documents`           | `sel_documents_tenant`                                                                        | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.entity_tags`         | `sel_entity_tags_tenant`                                                                      | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.error_records`       | `wkr_error_records_all`                                                                       | ALL                 | `app_worker`                | `true` (all tenants) · WITH CHECK `true`                                                                        | worker SELECT/INSERT/UPDATE                        |
| `shared.event_outbox`        | `wkr_event_outbox_all`; `ins_event_outbox_producer`, `sel_event_outbox_producer` (2026-07-21) | ALL; INSERT, SELECT | `app_worker`; `app_runtime` | `true` (all tenants) · WITH CHECK `true` for the worker; `tenant_id = iam.current_tenant_id()` for the producer | worker SELECT/INSERT/UPDATE; runtime SELECT/INSERT |
| `shared.file_scan_results`   | `sel_file_scan_results_tenant`                                                                | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.legal_holds`         | `sel_legal_holds_tenant`                                                                      | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.localization_keys`   | `sel_localization_keys_all`                                                                   | SELECT              | `app_runtime, app_readonly` | all rows (`true`) — platform catalogue                                                                          | none                                               |
| `shared.localized_texts`     | `sel_localized_texts_all`                                                                     | SELECT              | `app_runtime, app_readonly` | all rows (`true`) — platform content                                                                            | none                                               |
| `shared.message_templates`   | `sel_message_templates_visible`                                                               | SELECT              | `app_runtime, app_readonly` | `scope='platform'` OR same tenant                                                                               | none                                               |
| `shared.notes`               | `sel_notes_tenant`                                                                            | SELECT              | `app_runtime, app_readonly` | same tenant AND (public/internal OR `iam.sensitive.view`)                                                       | none                                               |
| `shared.outbound_messages`   | `sel_outbound_messages_tenant`                                                                | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.processed_events`    | `wkr_processed_events_all`                                                                    | ALL                 | `app_worker`                | `true` (all tenants) · WITH CHECK `true`                                                                        | worker SELECT/INSERT                               |
| `shared.retention_classes`   | `sel_retention_classes_all`                                                                   | SELECT              | `app_runtime, app_readonly` | all rows (`true`) — platform reference                                                                          | none                                               |
| `shared.search_metadata`     | `sel_search_metadata_tenant`                                                                  | SELECT              | `app_runtime, app_readonly` | same tenant AND (public/internal OR `iam.sensitive.view`)                                                       | none                                               |
| `shared.system_settings`     | `sel_system_settings_visible`                                                                 | SELECT              | `app_runtime, app_readonly` | `scope='platform'` OR same tenant                                                                               | none                                               |
| `shared.tags`                | `sel_tags_tenant`                                                                             | SELECT              | `app_runtime, app_readonly` | same tenant                                                                                                     | none                                               |
| `shared.template_versions`   | `sel_template_versions_visible`                                                               | SELECT              | `app_runtime, app_readonly` | `tenant_id IS NULL` (platform version) OR same tenant                                                           | none                                               |

## The policy classes

1. **Tenant-scope read** — `tenant_id = iam.current_tenant_id()`. The default
   for tenant-owned rows; cross-tenant rows are invisible, not merely denied.
2. **Dual-scope visible** — platform rows (`scope='platform'` /
   `tenant_id IS NULL`) plus the caller's own tenant overrides
   (`document_categories`, `message_templates`, `system_settings`,
   `template_versions`).
3. **Platform reference, all rows** — `USING (true)` on tables with no tenant
   dimension (`retention_classes`, `localization_keys`, `localized_texts`);
   shared product vocabulary readable by every tenant session.
4. **Sensitive-read gated** — `search_metadata`, `notes`, `comments`: tenant
   scope AND (`classification IN ('public','internal')` OR
   `iam.has_permission('iam.sensitive.view')`). A same-tenant user without the
   permission cannot see a restricted/secret row at all.
5. **Worker all-tenant (`wkr_`)** — `event_outbox`, `processed_events`,
   `error_records`: `FOR ALL TO app_worker USING (true) WITH CHECK (true)`.
6. **Producer tenant-scope** — `event_outbox` only, added 2026-07-21 by
   DBCR-P1-13-001 (the phase as delivered had five classes):
   `ins_event_outbox_producer` and `sel_event_outbox_producer`,
   `TO app_runtime` with `tenant_id = iam.current_tenant_id()`. A producer
   writes and reads back its own tenant's envelopes and nothing else; it cannot
   advance one, because no UPDATE grant or policy exists for it.

## The `wkr_` all-tenant class — rationale

Outbox dispatch, consumer idempotency, and durable error capture are
**infrastructure** functions: a dispatcher drains every tenant's due envelopes
in one pass and errors can occur before any tenant context exists
(`error_records.tenant_id` is nullable by design). The policy is therefore
deliberately all-tenant, and it is **not** BYPASSRLS:

- `app_worker` is a NOLOGIN archetype — no superuser, no CREATEDB/CREATEROLE,
  no replication, no BYPASSRLS, no object ownership. No LOGIN credential exists
  in Phase 1-5; a later phase supplies one, backend-only and monitored.
- Its surface is enumerated: the three tables above (never DELETE), EXECUTE on
  `shared.claim_outbox_events` / `complete_outbox_event` / `fail_outbox_event`,
  and EXECUTE on `iam.current_user_id()`. `tests/db/shared-hardening.test.ts`
  asserts this exact table and function surface and that nothing else is held.
- `app_runtime` / `app_readonly` held **zero** grant and **zero** policy on the
  three tables as delivered. Since DBCR-P1-13-001 (2026-07-21) `app_runtime`
  holds tenant-scoped SELECT/INSERT on `shared.event_outbox`, as it now also
  does on `shared.idempotency_keys`; on the audit tables it holds INSERT and a
  deliberately narrow SELECT window that never exposes a committed record,
  because reading audit history still requires `iam.audit.view`. Meanwhile
  `shared.processed_events` and `shared.error_records` stay at zero for both
  runtime roles, and `app_readonly` stays at zero on all three. FORCE RLS stays
  on throughout. Publishing an event and draining the queue are deliberately
  different powers: the producer grant carries no EXECUTE on the three
  lifecycle functions.
- Claiming is one `UPDATE` over `FOR UPDATE SKIP LOCKED` candidates;
  completion/failure are claimant-bound conditional UPDATEs, so a different
  worker cannot finalize someone else's claim.

## The sensitive-read gated class

Note and comment bodies are classified **restricted** in the data dictionary,
and `search_metadata.normalized_value` may project restricted source fields.
Rows classified `restricted`/`secret` are readable only with the Phase-1-4
permission `iam.has_permission('iam.sensitive.view')`, resolved from the
caller's ACTIVE grants under the server-set context. Tests prove both
directions (hidden without the permission, visible with it) in
`tests/db/shared-search-metadata.test.ts` and
`tests/db/shared-tags-notes-comments.test.ts`.

## Grant matrix (table privileges)

| Surface                                                   | `app_runtime` | `app_readonly` | `app_worker`         |
| --------------------------------------------------------- | ------------- | -------------- | -------------------- |
| 19 shared-service tables (all except the 3 worker tables) | SELECT        | SELECT         | —                    |
| `shared.event_outbox`                                     | SELECT/INSERT | —              | SELECT/INSERT/UPDATE |
| `shared.error_records`                                    | —             | —              | SELECT/INSERT/UPDATE |
| `shared.processed_events`                                 | —             | —              | SELECT/INSERT        |
| DELETE, TRUNCATE, DDL — any table                         | —             | —              | —                    |

Function EXECUTE grants (everything else is `REVOKE … FROM PUBLIC` with no
application grant, including every trigger guard and `shared.archive_document`):

| Function                                                                     | Granted to                  |
| ---------------------------------------------------------------------------- | --------------------------- |
| `shared.document_ids_for_entity(text, uuid)`                                 | `app_runtime, app_readonly` |
| `shared.document_deletion_eligibility(uuid, uuid)`                           | `app_runtime, app_readonly` |
| `shared.resolve_setting(text)` / `shared.missing_translations(text)`         | `app_runtime, app_readonly` |
| `shared.claim_outbox_events` / `complete_outbox_event` / `fail_outbox_event` | `app_worker`                |
| `iam.current_user_id()` (context reader for worker triggers)                 | `app_worker` (additionally) |

DBCR-P1-13-001 changed no grant in this table. The three outbox lifecycle
functions remain `app_worker`'s alone: a producer holding INSERT on the table
still cannot claim, complete, or fail an envelope.

## Abuse cases (asserted by the named suites in `tests/db/`)

1. Cross-tenant read of any tenant-scoped table → zero rows
   (per-suite `shared-*.test.ts` isolation cases).
2. Runtime INSERT/UPDATE/DELETE on any Phase-1-5 table → `42501`
   (per-suite write-posture cases). Since 2026-07-21 the one exception is
   runtime INSERT on `shared.event_outbox`, which succeeds for the caller's own
   tenant and is asserted as such; runtime UPDATE and DELETE on that table still
   raise `42501`.
3. Readonly SELECT on the three worker tables, and runtime SELECT on
   `processed_events` / `error_records` → `42501`. Runtime SELECT on
   `shared.event_outbox` returns the caller's own tenant's rows only
   (`shared-event-outbox.test.ts`, `shared-processed-errors.test.ts`,
   `shared-hardening.test.ts`).
4. Worker DELETE on worker tables → `42501`.
5. Restricted row read without `iam.sensitive.view` → row invisible; with the
   permission → visible (`shared-search-metadata.test.ts`,
   `shared-tags-notes-comments.test.ts`).
6. Two parallel worker connections claim disjoint outbox sets; a wrong
   claimant can neither complete nor fail a claim
   (`shared-event-outbox.test.ts`).
7. Cross-tenant document link, tag assignment, comment parent, or author
   attribution → rejected structurally by composite FKs
   (`shared-document-links.test.ts`, `shared-tags-notes-comments.test.ts`).
8. Direct INSERT of a terminal-state document/version/outbox/error row →
   rejected by initial-state guards (`shared-hardening.test.ts`,
   `shared-event-outbox.test.ts`, `shared-processed-errors.test.ts`).

The database suite holds 491 tests at commit `83f0f70`; CI on the final SHA is
owner-verifiable. The pull request is not yet opened and the owner gate is
Pending.

## Honest limits

- `event_outbox.payload`/`headers` and delivery detail fields have **no
  sanitizer trigger**; keeping credentials/secrets out is a producer/worker
  responsibility (accepted, MEDIUM — adversarial review ledger, 2026-07-18).
  `error_records` context **is** trigger-sanitized.
- The `wkr_` all-tenant surface means a compromised future worker credential
  could observe or mutate every tenant's rows on the three enumerated tables
  through its granted verbs. Accepted deliberately; probe-verified confined to
  those tables, and no LOGIN credential exists today.
- `document_links.linked_by` is a plain uuid without a tenant-bound FK
  (accepted, LOW — predates the attribution rule applied to later increments).
- Database RLS does not log SELECTs, and a privileged DB role
  (superuser/BYPASSRLS) sits outside these policies; no application role holds
  such privilege.
