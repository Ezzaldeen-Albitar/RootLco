# Phase 1-5 — Shared Services Usage Guide

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18

How a future consumer (a later domain schema, or the Phase-1-14 backend) uses
the shared-services foundation. All routines are `SECURITY INVOKER` with an
empty `search_path`, trust only the server-set transaction context (see the
[IAM helper usage guide](../../database/iam-helper-usage-guide.md)), and
default to **deny**. Runtime roles are SELECT-only everywhere; every write
below runs on the privileged backend/platform path, exactly as the test suite
exercises it. **Every identifier in this guide is synthetic** (`fx_` codes,
placeholder UUIDs); no CRM schema exists and no example row ships in the
database.

## 1. Linking a future CRM entity to a document

`shared.document_links` ties a document to a business entity through a
constrained `schema.table` token — `'crm.customer'` below is a **forward
token**, not a reference to an existing table. The composite
`(tenant_id, document_id)` FK makes a cross-tenant link structurally
impossible; validating that `entity_id` names a real entity is the owning
domain's later responsibility (documented residual risk).

```sql
-- Backend/platform path (runtime has no write grant):
INSERT INTO shared.document_links
  (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
VALUES
  ('<fx_tenant_uuid>', '<fx_document_uuid>', 'crm.customer',
   '<fx_entity_uuid>', 'attachment', '<fx_user_uuid>', '<fx_user_uuid>');
```

Resolution — the **link-derived access contract**: a document is reachable
through a live link, never by knowing a `document_id` or `storage_key`. The
resolver runs under the caller's RLS, so another tenant resolves nothing and a
soft-deleted link yields no access:

```sql
-- Runtime session (context set):
SELECT d.*
FROM shared.documents AS d
WHERE d.id IN (
  SELECT shared.document_ids_for_entity('crm.customer', '<fx_entity_uuid>')
);
```

Later domain policies compose this with "may the principal see entity X?".
Proven with synthetic entity types in `tests/db/shared-document-links.test.ts`.

## 2. A generic tag and note

Tags are **tenant-only** vocabulary (no platform tags exist). Assignments,
notes, and comments reference entities through the same generic token.

```sql
-- Backend/platform path:
INSERT INTO shared.tags (tenant_id, tag_code, name, created_by)
VALUES ('<fx_tenant_uuid>', 'fx_priority', 'FX priority fixture', '<fx_user_uuid>');

INSERT INTO shared.entity_tags
  (tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
VALUES
  ('<fx_tenant_uuid>', '<fx_tag_uuid>', 'crm.customer',
   '<fx_entity_uuid>', '<fx_user_uuid>', '<fx_user_uuid>');

INSERT INTO shared.notes
  (tenant_id, entity_type, entity_id, author_id, body, classification, created_by)
VALUES
  ('<fx_tenant_uuid>', 'crm.customer', '<fx_entity_uuid>',
   '<fx_user_uuid>', 'fx synthetic note body', 'internal', '<fx_user_uuid>');
```

A live assignment is unique per (tag, entity) and re-tagging is possible only
after soft deletion. `assigned_by`/`author_id` are tenant-bound composite FKs.
A `restricted`/`secret` note or comment is invisible to a same-tenant runtime
session without `iam.has_permission('iam.sensitive.view')`; a body edit
server-stamps `edited_at`. All proven in
`tests/db/shared-tags-notes-comments.test.ts`.

## 3. An outbox row inside a producer transaction

The envelope INSERT must ride in **the same transaction** as the business
change it announces — that is the entire point of the outbox. Since 2026-07-21
([DBCR-P1-13-001](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md))
`app_runtime` holds tenant-scoped SELECT and INSERT on `shared.event_outbox`,
so the producer below is the request path itself, writing only its own tenant's
envelopes. `app_worker` additionally holds UPDATE and the three lifecycle
functions, which the producer does not; the guard trigger forces every new row
to start `pending`/unstamped/attempt 0.

```sql
BEGIN;
-- ... the originating business write commits here (future domain table) ...
INSERT INTO shared.event_outbox
  (tenant_id, event_key, event_type, aggregate_type, aggregate_id,
   schema_version, aggregate_version, producer, payload, created_by)
VALUES
  ('<fx_tenant_uuid>', 'fx-customer-created-0001', 'fx.customer.created',
   'crm.customer', '<fx_entity_uuid>', 1, 1, 'fx.backend',
   '{"fx_field": "synthetic"}'::jsonb, '<fx_user_uuid>');
COMMIT;
```

`event_key` is idempotent per tenant (a duplicate INSERT fails with `23505`).
`payload`/`headers` must be JSON objects and **must not contain credentials or
secrets** — there is no sanitizer trigger on them; that responsibility sits
with the producer (accepted residual, see the RLS policy matrix).

The dispatch lifecycle is three claimant-bound atomic functions, granted to
`app_worker` only:

```sql
SELECT * FROM shared.claim_outbox_events('fx-worker-1', 10);      -- UNORDERED set
SELECT shared.complete_outbox_event('<event_uuid>', 'fx-worker-1');
SELECT shared.fail_outbox_event('<event_uuid>', 'fx-worker-1',
  'fx sanitized failure summary', interval '1 minute', 5);
```

Claims use `FOR UPDATE SKIP LOCKED` (parallel claimants receive disjoint
sets), stale leases are reclaimable, a wrong claimant can neither complete nor
fail a row, and exhausted retries dead-letter with a mandatory sanitized
`last_error`. **No publisher, worker process, or notification pipeline exists
in Phase 1-5** — only the durable contract, proven in
`tests/db/shared-event-outbox.test.ts`.

## 4. Reading settings and localized text

Settings are immutable versioned rows: a change INSERTs version n+1, and the
current value is the highest tenant version, falling back to the highest
platform version. `shared.resolve_setting` applies that rule under the
caller's context:

```sql
SELECT shared.resolve_setting('fx.ui.date_format');
-- tenant override if the caller's tenant has one, else the platform value,
-- else NULL. With no tenant context, only the platform value is eligible.
```

Localization is governed platform content (draft → approved → retired; exactly
one approved text per key/locale; approved wording immutable). The catalogue
ships **empty** — no customer-facing wording is seeded:

```sql
SELECT t.text_value
FROM shared.localization_keys AS k
JOIN shared.localized_texts   AS t ON t.key_id = k.id
WHERE k.key_code = 'fx.ui.greeting'
  AND t.locale_code = 'en'
  AND t.status = 'approved';

SELECT * FROM shared.missing_translations('en'); -- active keys lacking approved text
```

Both functions are EXECUTE-granted to `app_runtime`/`app_readonly`; proven in
`tests/db/shared-settings-localization.test.ts`.

## 5. API-readiness contract

What a future API layer (Phase 1-14) may assume — and must uphold — when it
binds to this foundation:

- **Real database binding.** Endpoints serve these actual tables and
  functions. There is no parallel store, cache-of-record, or stub layer to
  retire later; the schema above **is** the contract.
- **Real empty collections.** Every business table ships empty. Seed 05 loads
  exactly five retention classes (`evidence-audit`,
  `immutable-financial-history`, `operational`, `personal-data`, `temporary`)
  and nothing else; document categories, templates, localized wording, tags,
  and settings start empty and are populated only through real administration
  flows. An empty API list response therefore reflects a genuinely empty
  table. CI enforces this: `npm run validate:seed-state` applies the declared
  seeds twice and validates clean business state **before** `test:db` runs.
- **No mock data.** The no-fake-data standard
  ([docs/database/no-fake-data-standard.md](../../database/no-fake-data-standard.md))
  is permanent: no demo rows, no placeholder customers, no invented wording.
  Test fixtures use `fx_`/synthetic identifiers and are cleaned up; the pilot
  tenant is provisioned only through the manual gated package
  (`supabase/packages/pilot-provisioning.package.json` via
  `scripts/db/provision-organization.mjs`,
  [runbook](../../database/pilot-provisioning-runbook.md)) — never seeded.
- **Runtime role posture.** APIs read through `app_runtime`/`app_readonly`
  under the transaction-scoped context contract: SELECT-only tables plus the
  four enumerated EXECUTE grants, and — since 2026-07-21, DBCR-P1-13-001 —
  tenant-scoped INSERT on `shared.event_outbox`. Every other mutation of a
  Phase-1-5 table is a backend/platform operation, and the dispatch surface
  (UPDATE plus claim/complete/fail) belongs exclusively to the `app_worker`
  archetype. An API must never require a broader database privilege than this
  posture grants.
- **Not implemented, not claimed.** No notification rendering, no delivery
  providers, no worker processes, and no outbox publisher exist. Phase 1-6 is
  not started, and no CRM (or any other domain) schema exists — every
  `entity_type` token in this guide is a forward reference whose entity
  validation lands with its owning domain.
