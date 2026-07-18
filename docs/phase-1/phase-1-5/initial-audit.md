# Phase 1-5 — Shared Services Database · Initial Audit and Design Reconciliation

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Working document — opened at Phase 1-5 start; superseded for
closeout facts by the Phase 1-5 closeout set (see pointer below) ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical/security self-review under the
[Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) —
not an independent review) ·
**Branch:** `feature/p1-05-shared-services-database` ·
**Base:** `origin/develop` @ `69e0da1` (Phase 1-4 gate-record merge PR #20) ·
**Tasks covered by this document:** P1-05-DOC-001 (initial audit); inputs to every
P1-05-DB / P1-05-SEC / P1-05-QA task.

> **Superseded-by pointer (2026-07-18, closeout):** this audit is the unaltered
> opening record of Phase 1-5; nothing below has been rewritten. Final positions
> are carried by
> [phase-1-5-completion-report.md](./phase-1-5-completion-report.md) and
> [phase-1-5-owner-gate.md](./phase-1-5-owner-gate.md). Where implementation
> deliberately diverged from a plan recorded here, the completion report is
> authoritative — notably §2's "no new database role" decision (superseded by
> the constrained NOLOGIN `app_worker` archetype of migration
> `20260718106000`), the planned function names of §3 (the shipped names are
> `shared.claim_outbox_events` / `complete_outbox_event` / `fail_outbox_event`,
> `shared.archive_document`, and `shared.document_deletion_eligibility`), and
> §1.4's Increment M seed (shipped as `supabase/seeds/05_shared_reference.sql`
> plus the controlled pilot-provisioning package).

---

## 0. Stage-A preconditions (verified before this branch was created)

| Check                                                                | Result                                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1-4 gate-record commit `c1c3fa4` contained in `origin/develop` | **YES** — via PR #20, merge `69e0da1` (parents `edebde8` + `c1c3fa4`; author Ezzaldeen Albitar; 2026-07-18T10:27:40+03:00; target `develop`) |
| Phase 1-4 source `e2cfeee` contained in `origin/develop`             | **YES**                                                                                                                                      |
| Phase 1-4 formally closed in protected history                       | **YES** — gate doc records _Go — Technical Gate Passed_; `c1c3fa4` also reached `main` via PR #21                                            |
| Phase 1-5 implementation already exists                              | **NO** — no P1-05 migration, no `docs/phase-1/phase-1-5/` (before this file), no crm/veh tables                                              |

### Migration-count reconciliation (P1-05 correction of a P1-4 doc)

The Phase 1-4 owner-gate (`docs/phase-1/phase-1-4/phase-1-4-owner-gate.md`) stated the
develop tip was re-validated with "all **13** migrations from empty". That figure is
**factually inaccurate**. The authoritative sources — the migration directory and the
runner's own applied-migration ledger (`supabase_migrations.schema_migrations`) — show:

| Scope                        | Migrations | Files                                 |
| ---------------------------- | ---------- | ------------------------------------- |
| Phase 1-2 foundation         | **3**      | `0001`, `0002`, `0003`                |
| Phase 1-3 org schema         | **8**      | `20260717100000` … `20260717107000`   |
| Phase 1-4 IAM/audit          | **9**      | `20260718090000` … `20260718098000`   |
| **Total applied from empty** | **20**     |                                       |
| Seed files                   | **4**      | `01`…`04` (`config.toml` `[db.seed]`) |

The migration runner applied **all 20** (no subset semantics; the ledger holds 20 rows).
Executable behaviour is **not defective** — every migration applies cleanly from empty —
so per assignment §2 the fix is a **forward documentation correction only**: no migration
file is altered and no new corrective migration is created. The correction is applied to
the gate doc on this branch and recorded in `phase-1-5-migration-classification.md` and
the evidence register.

---

## 1. What already exists that Phase 1-5 MUST reuse (never duplicate)

Inspected: all P1-02/03/04 migrations, `tests/db/helpers.ts`, `tests/db/foundation.test.ts`,
`tests/db/org-security.test.ts`, the standards under `docs/database/` and `docs/security/`,
the CI runner (`.github/workflows/ci.yml`, `scripts/db/apply-migrations.mjs`), and the
scope/secret guards (`scripts/check-scope-exclusions.mjs`, `scripts/check-browser-exposed-secrets.mjs`).

### 1.1 Reusable functions (call, do not re-create)

| Object                                                                               | Reuse in Phase 1-5                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iam.current_tenant_id()`, `iam.current_user_id()`                                   | Every RLS policy and every server-stamp trigger.                                                                                                        |
| `iam.current_company_ids()`, `iam.current_branch_ids()`                              | Company/branch narrowing where documents carry those scopes.                                                                                            |
| `iam.has_permission(text)`, `iam.has_permission_in_scope(text,uuid,uuid,uuid)`       | Permission-gated reads (restricted documents, worker-only tables) in Increment L.                                                                       |
| `iam.audit_append(uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,text,jsonb)`          | The **only** audit writer. Every retention action (Increment D) calls it; a failure aborts the caller's transaction. No second audit system is created. |
| `iam.audit_mask` / `audit_canonical` / `audit_hash` / `audit_verify_chain`           | Referenced only; Phase 1-5 adds no audit primitives.                                                                                                    |
| `shared.touch_row_metadata()`                                                        | BEFORE UPDATE metadata stamp on every mutable table.                                                                                                    |
| `org.guard_immutable_columns(VARIADIC text[])`                                       | Immutability guards (accepted versions, approved templates, delivery attempts, etc.).                                                                   |
| `shared.stamp_status_history()` + `shared.status_history` / `shared.status_evidence` | Generic status log. Document/version lifecycle transitions are recorded here, **not** in a new per-table history table.                                 |

### 1.2 Tables Phase 1-5 must NOT duplicate

- `shared.idempotency_keys` — generic `(tenant_id, operation, idempotency_key)` request
  de-duplication with fingerprint match/expiry. **`shared.processed_events` is a different
  concern** (a consumer/event replay registry keyed by `(consumer_code, event_id)`), so it
  is additive, not a duplicate — see §3.F.
- `shared.status_history` / `shared.status_evidence` — reused as-is (§1.1).
- No parallel document / notification / outbox / tagging / note / localization system may
  be created by any later domain: Phase 1-5 **is** that foundation.

### 1.3 Conventions adopted verbatim (from the P1-3/P1-4 migrations)

- Every tenant-owned table: `id uuid DEFAULT gen_random_uuid()`, `tenant_id uuid NOT NULL`,
  `PRIMARY KEY (id)`, `CONSTRAINT uq_<t>_tenant_id UNIQUE (tenant_id, id)` (the composite
  candidate key children FK to), `fk_<t>_tenant … REFERENCES org.tenants (id) ON DELETE RESTRICT`.
- Child → parent FKs are **composite** `(tenant_id, parent_id)` referencing the parent's
  `(tenant_id, id)` — this is what makes cross-tenant links structurally impossible.
- Base metadata: `record_version int DEFAULT 1`, `created_at/created_by`, `updated_at/updated_by`
  for mutable tables; append-only tables omit the update columns and get a server-stamp trigger.
- RLS **ENABLE + FORCE** on every table; default deny; `sel_<t>_tenant` `FOR SELECT TO
app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id())`.
- Runtime grants are **SELECT-only** on business/config tables (writes are platform/backend ops);
  worker-only tables (outbox, error records, processed events) grant runtime **nothing** —
  same posture as `shared.idempotency_keys` and the audit tables.
- Functions: `SECURITY INVOKER`, `SET search_path = ''`, fully-qualified names, `REVOKE EXECUTE …
FROM PUBLIC` then explicit grants. **No `SECURITY DEFINER`** is introduced.
- `naming`: `pk_`/`uq_`/`fk_`/`ck_`/`ix_` prefixes; triggers `tg_<table>_<purpose>`; policies
  `sel_|ins_|upd_<table>_<scope>`.
- Every migration header declares Phase, Tasks, Owner module, Purpose, Dependencies,
  **Rollback classification**, Security implications, Objects created.
- Four **exact** allow-lists in `tests/db/foundation.test.ts` (ALLOWED_TABLES, ALLOWED_ROUTINES,
  triggers array, policies array) and the **data-dictionary coverage** test are updated in the
  **same** increment that adds an object. `cleanFixtures` in `helpers.ts` deletes new rows
  before `org.tenants`. Non-tenant / nullable-tenant tables are registered in the exception
  sets in `org-security.test.ts`.
- DB tests run sequentially (`fileParallelism:false`); multiple denial asserts each need their
  **own** `withRolledBackTx` (a failed statement poisons the tx, SQLSTATE `25P02`); deferred
  constraints are tested with `SET CONSTRAINTS ALL IMMEDIATE` inside a rolled-back tx.

### 1.4 Migration timestamp starting point

Last Phase 1-4 migration = `20260718098000`. Phase 1-5 continues **after** it, one 14-digit
timestamp per increment:

| Increment | Migration        | Increment | Migration        |
| --------- | ---------------- | --------- | ---------------- |
| A         | `20260718100000` | G         | `20260718106000` |
| B         | `20260718101000` | H         | `20260718107000` |
| C         | `20260718102000` | I         | `20260718108000` |
| D         | `20260718103000` | J         | `20260718109000` |
| E         | `20260718104000` | K         | `20260718110000` |
| F         | `20260718105000` | L         | `20260718111000` |

Increment M is **mandatory platform reference configuration only** (a
`supabase/seeds/05_shared_services_structural.sql` seed file, not a migration, wired into
`config.toml` `[db.seed]`). Under the permanent [no-fake-data standard](../../database/no-fake-data-standard.md)
(reinterpreting P1-05-DB-021) it may seed **only** indispensable structural definitions —
retention-class definitions and equally-structural catalogues — and **no** business data:
no document categories, no message templates, no localized customer wording, no tenants, no
operational content. Document categories and message templates start **empty** and are configured
later through real administration flows; localization ships the `ar`/`en` schema without invented
final wording. The clean database therefore has empty business tables, proven by
`npm run validate:no-fake-data` and `tests/db/no-fake-data.test.ts`.

### 1.5 Platform-level vs tenant-level rules

- **Tenant-level** (carry `tenant_id NOT NULL`, tenant RLS): documents, document_versions,
  file_scan_results, document_links, message_templates (tenant overrides), template_versions
  (tenant overrides), outbound_messages, delivery_attempts, event_outbox, processed_events,
  system_settings (tenant scope), localized_texts (tenant overrides may exist later; base is
  platform), search_metadata, tags, entity_tags, notes, comments.
- **Platform-level** (no `tenant_id`; registered in `TENANT_COLUMN_EXCEPTIONS`):
  `shared.localization_keys` (a platform key catalogue, exactly like `iam.permissions`).
- **Dual-scope** (one table holds a platform default OR a tenant override): `document_categories`,
  `message_templates`, `system_settings`. These use an explicit **`scope` discriminator**
  (`platform` | `tenant`) together with a **nullable `tenant_id`**, bound by a consistency CHECK —
  `(scope='platform' AND tenant_id IS NULL) OR (scope='tenant' AND tenant_id IS NOT NULL)` — so a
  platform row has `tenant_id` NULL and a tenant override has it NOT NULL. Uniqueness is enforced by
  **two partial unique indexes** (platform code unique platform-wide; tenant code unique per tenant),
  and cross-tenant references are blocked by a scope guard (documents may reference a platform
  category or one owned by the same tenant only). Because platform rows carry `tenant_id` NULL, each
  dual-scope table is a **documented `NULLABLE_TENANT_EXCEPTIONS` entry** (see §1.6) — this is the
  approved design, not an avoidance of it.

  > Correction (supersedes an earlier draft of this note): dual-scope tables deliberately use a
  > nullable `tenant_id` + `scope` discriminator, and are registered as nullable-tenant exceptions.
  > The earlier wording that platform rows would be "held in a separate mechanism … to avoid
  > widening the nullable-tenant exception set" is withdrawn; a single table per policy envelope,
  > with the consistency CHECK above, is the design carried by the Increment A migration.

### 1.6 Nullable-tenant exceptions Phase 1-5 adds

Each entry is registered in `NULLABLE_TENANT_EXCEPTIONS` (`tests/db/org-security.test.ts`) with a
written justification and a table COMMENT; adding one is a reviewed decision.

- `shared.document_categories` (Increment A) — **dual-scope**: `tenant_id` is NULL for a platform
  default and NOT NULL for a tenant override, bound by the scope-consistency CHECK. `message_templates`
  and `system_settings` follow the same pattern in Increments E and I.
- `shared.error_records` (Increment H) — a durable error store must record failures that occur
  **before** a tenant context is established (startup, auth, cross-tenant infra); `tenant_id` is
  nullable **by design**.

All other Phase 1-5 tenant tables are `tenant_id NOT NULL`.

---

## 2. Worker-role design gap (explicit)

Phase 1-5 introduces the **transactional outbox**, a **processed-event registry**, and a
**durable error store** — subsystems that a future asynchronous **worker** (Phase 1-13 backend)
will claim, publish, and drain. **No worker role exists today**, and inventing broad standing
credentials now would violate least privilege.

**Decision (consistent with the Role and Grant Standard and the audit posture):**

- `app_runtime` / `app_readonly` receive **no** grant on `shared.event_outbox`,
  `shared.processed_events`, or `shared.error_records` — exactly as they hold nothing on
  `shared.idempotency_keys` and the audit tables. RLS is enabled **and forced** with no
  application policy.
- The atomic claim function (`shared.outbox_claim_batch`) and the error-write function are
  `SECURITY INVOKER`, `EXECUTE` revoked from `PUBLIC`, granted to **no** application role in
  Phase 1-5. Platform/admin executes them now; the worker grant (a dedicated minimal role, or
  a reviewed definer wrapper) is a **documented handoff to Phase 1-13**, recorded in the RLS
  policy matrix and the completion report. Application runtime stays denied throughout.

No new database role is created in Phase 1-5.

---

## 3. Design reconciliations resolved before coding (assignment §6 A–I)

### A. Document access derivation

`document_links` uses generic `entity_type`/`entity_id` and **cannot** carry real
cross-domain FKs (the domains do not exist yet). Phase 1-5 therefore implements: (1) tenant
isolation on every document object; (2) link **integrity** via a composite FK to the document's
`(tenant_id, id)` so a link can never point across tenants; (3) a **link-derived access
contract** — a document is reachable by a principal only when a _live_ link ties it to an entity
the principal may see, resolved by later domain policies. Phase 1-5 proves the contract with
**synthetic/test-only** entity fixtures. **We do not claim** the database can fully authorise a
future business entity that does not exist; final domain authorisation composition is a later
domain + backend responsibility, stated in `document-access-and-file-security.md`.

### B. Storage-key security

`storage_key` is **metadata, not an authorization token**. Knowing `document_id`, `version_id`,
`storage_key`, or `sha256` grants **no** access; access is decided solely by RLS + the
link-derived contract + (for restricted documents) `iam.has_permission`. Storage keys are
classified `internal`, are not broadly readable (only via the gated document read path), and the
storage-key convention (`storage-key-convention.md`) forbids embedding email/phone/VIN/name/
registration data.

### C. Malware lifecycle

A plain `CHECK` cannot query `file_scan_results`. A version becomes `accepted` **only** through a
controlled transition function `shared.accept_document_version(...)` that verifies an applicable
`clean` scan row exists for that version; a `BEFORE UPDATE` guard trigger forbids any other path
to `accepted` and forbids mutating an already-accepted/immutable version. An `infected` scan
result drives/【supports】`quarantined`. This is a safe-trigger + controlled-function design, not a
`CHECK` that reaches across tables.

### D. Retention deletion

**Legal hold always wins.** Document history is **not** physically deleted casually: the
controlled routine `shared.mark_document_retention(...)` performs a mark/archive →
`deletion_eligible` transition only when (retention elapsed) AND (no active legal hold) AND (no
active document link). **Every** retention action calls `iam.audit_append`; if the audit write
fails, the whole action rolls back. Physical object deletion remains later backend/infrastructure
scope. No ad-hoc `DELETE` grant is created.

### E. Event-outbox claim race

`shared.outbox_claim_batch(p_limit int)` uses `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED
LIMIT n) … RETURNING` so concurrent workers each claim a **disjoint** set — a single winner per
row. Retry and dead-letter are explicit state transitions. **No** publisher/polling loop is built
and **no** worker is claimed to exist.

### F. Processed-event registry

`shared.processed_events` has PK `(consumer_code, event_id)` (per-consumer idempotency): the same
consumer/event pair is accepted **once**, so replay is detected **before** side effects. This is a
distinct concern from `shared.idempotency_keys` (request-level fingerprinting), which is reused
unchanged — no duplication.

### G. Generic entity links

Generic `entity_type`/`entity_id` rows cannot use domain FKs. Mitigations: a **constrained
entity-type format** (`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`, e.g. `crm.customer`); tenant scope on
every row; a documented **per-domain validation contract** (later domains validate their own
`entity_id`s); an **orphan-review procedure** and explicit **residual-risk** note in the usage
guide and RLS matrix.

### H. Notification consent

No consent source exists until Phase 1-6. Phase 1-5 provides only: a `purpose`
(`transactional` | `marketing` | `system`), a `suppressed` status with `suppress_reason`, and a
nullable `consent_ref` placeholder for future linkage. It **does not claim** consent enforcement
is complete — stated in `notification-data-contract.md`.

### I. Customer-facing copy

**Superseded by the [no-fake-data standard](../../database/no-fake-data-standard.md).** No message
templates or customer-facing copy are seeded at all — `message_templates`/`template_versions` start
**empty** and are configured later through real administration flows. There is therefore no seeded
template body to placeholder-mark; the template tables are proven with **ephemeral test inserts**
only. No final Arabic/English customer messages are invented in the database phase. (The earlier plan
to seed structural placeholders marked `pending owner-approved wording` is withdrawn: shipping no
template rows is stricter and satisfies the policy directly.)

---

## 4. Unresolved assumptions, security risks, and change requests

- **Assumption:** later domains will supply `entity_id` validation for generic links/tags/notes;
  until then a link/tag/note can reference a non-existent entity within the same tenant (bounded
  residual risk — never cross-tenant). Recorded as residual risk R-P1-05-01.
- **Assumption:** the worker role and its grants land in Phase 1-13; Phase 1-5 keeps runtime
  denied. Handoff H-P1-05-01.
- **Security risk (accepted, mitigated):** storage keys and provider message refs are `internal`
  identifiers; the mitigation is the gated read path + convention guard (§3.B, §3 G).
- **Change request:** none to merged migrations. One forward doc correction (the "13 migrations"
  line). No schema change request to prior phases is required — the existing composite-key +
  status-history + audit primitives are sufficient to build on.

This document is updated if any reconciliation changes during implementation; the final position
is carried into `shared-services-schema-design.md` and the completion report.
