# Phase 1-6 — CRM Database Usage Guide

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] · **Phase:** 1-6 — CRM and Business Partner Database

This guide explains how the application and API layer (Phase 1-16 and later) should read from and write to the `crm` schema so that tenant isolation, sensitive-data gating, and the append-only history contracts hold. It is a practical companion to the generated references — cite those for exact structure rather than trusting any table restated here:

- [CRM object inventory](./crm-object-inventory.md)
- [CRM data dictionary](./crm-data-dictionary.md) — authoritative per-column names, types, and classes
- [CRM RLS policy matrix](./crm-rls-policy-matrix.md)
- [CRM grant matrix](./crm-grant-matrix.md)
- [CRM personal-data classification matrix](./crm-classification-matrix.md)
- [Phase 1-6 CRM ERD](../../database/erd/phase-1-6-crm.mmd)

> **Status.** The Phase 1-6 feature branch is not yet merged, so the owner gate is **Pending** — this guide documents the shipped storage layer, not a released product. Review to date is owner-authorized technical/security self-review under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md), not independent review. The application/API write-path that orchestrates the flows below is out of scope for this phase and is owned by Phase 1-16.

---

## 1. Request context — every connection must set the tenant and actor

Every `crm` table has `ENABLE` **and** `FORCE ROW LEVEL SECURITY`. The app roles `app_runtime` (read/write) and `app_readonly` (read-only) are non-superuser and `NOBYPASSRLS`, and own zero `crm` tables — there is no way to read or write a partner without a valid tenant context. All policies are per-command and **default-deny**: a command with no matching policy, or with an unset context, matches no rows.

Tenant and actor come from transaction-local settings, read by the IAM context functions:

| Setting           | Read by                     | Used for                                 |
| ----------------- | --------------------------- | ---------------------------------------- |
| `app.tenant_id`   | `iam.current_tenant_id()`   | RLS tenant scoping on every policy       |
| `app.user_id`     | `iam.current_user_id()`     | server-stamped actor attribution         |
| `app.company_ids` | `iam.allowed_company_ids()` | company narrowing (display-number scope) |
| `app.branch_ids`  | `iam.allowed_branch_ids()`  | branch narrowing (display-number scope)  |

Set them per transaction before issuing any statement. `current_setting(..., true)` returns NULL when unset, and `iam.current_tenant_id()` returns NULL, so an unscoped session sees nothing (a comparison against NULL matches no rows — default deny):

```sql
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.user_id   = '00000000-0000-0000-0000-0000000000aa';
-- ... CRM statements run here, scoped and attributed ...
COMMIT;
```

Connect as `app_runtime` for read/write flows and `app_readonly` for reporting/search reads. Never rely on the connection role for isolation — the tenant boundary is `app.tenant_id`, and it must be a server-set value, never a client-supplied parameter interpolated into SQL.

## 2. Creating a partner

A partner is the party master row; profiles, identifiers, roles, and contacts hang off it. Create the master first, then attach exactly one profile matching its `party_type`.

**Step 1 — insert the party master.** `crm.business_partners` requires `party_type` (`'individual'` or `'organization'`), a non-blank `display_name`, and `created_by`. `lifecycle_status` defaults to `'prospect'` and `commercial_status` to `'normal'`; leave `merged_into_id` NULL.

```sql
INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
VALUES (iam.current_tenant_id(), 'individual', 'Layla Q.', iam.current_user_id())
RETURNING id;
```

**Display number.** `display_number` is nullable and is **not** auto-set by a trigger. Allocate it inside the same transaction with the concurrency-safe allocator `shared.next_display_number('partner', ...)`, which locks the tenant's sequence row `FOR UPDATE` so concurrent allocators queue rather than collide, and whose increment rolls back with the transaction (gap-tolerant, never duplicated). The `'partner'` sequence must have been provisioned at tenant onboarding — allocation raises `42501` if `app.tenant_id` is unset and `no_data_found` if no sequence is configured for the scope. A partial unique index enforces tenant-scoped uniqueness of the number among live rows, so a duplicate surfaces as `23505`.

**Step 2 — attach the matching profile.** The discriminator candidate key `(tenant_id, id, party_type)` on the master is what enforces correctness: each profile pins a constant `party_type` and references that key, so an individual profile can attach only to an individual partner and a company profile only to an organization. A mismatch is a foreign-key violation (`23503`), not a silent bad row.

```sql
-- party_type = 'individual'
INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, created_by)
VALUES (iam.current_tenant_id(), :partner_id, 'Layla', 'Q.', iam.current_user_id());

-- party_type = 'organization'
INSERT INTO crm.company_profiles (tenant_id, partner_id, legal_name, created_by)
VALUES (iam.current_tenant_id(), :partner_id, 'Root Link Trading LLC', iam.current_user_id());
```

`party_type` on the master is immutable, and the `*_normalized` name columns are generated (case-folded) — do not write them. Restricted identifier pointers on the profiles (`individual_profiles.national_id_ref`, `company_profiles.registration_ref` / `tax_ref`) are same-partner composite FKs into `crm.partner_identifiers`; the profile holds only a UUID pointer, never a raw value (see [data dictionary](./crm-data-dictionary.md)).

## 3. Reading sensitive data

Restricted values never live in a plain column you can just `SELECT`. Per the [classification matrix](./crm-classification-matrix.md), exactly **7** columns are `restricted`: `partner_identifiers.normalized_value` / `raw_value`, `partner_sensitive_attributes.value_date` / `value_text`, and the three profile pointer columns. The only gate is a row-level permission check — there is **no** column-masking view or unmasking function.

- **`crm.partner_identifiers`** — the SELECT policy admits a row when `classification = 'internal'` **or** `iam.has_permission('iam.sensitive.view')`. A session without that permission simply does not see restricted-type rows (national_id / registration / tax); phone and email rows remain visible. The `UPDATE` gate is in the policy `USING` clause too, so an unprivileged session cannot update, downgrade, or soft-delete a restricted identifier.
- **`crm.partner_sensitive_attributes`** — every row is `classification = 'restricted'` by CHECK, so the whole table's SELECT/INSERT/UPDATE policies require `iam.has_permission('iam.sensitive.view')`.

The effect is denial at the row level, not a privilege error: without the permission the restricted row is filtered out of the result set. To read a partner's national ID or date of birth, the caller's session must hold `iam.sensitive.view`; otherwise those rows are absent. Do not attempt to reconstruct restricted values from any other table — they are not stored anywhere else.

## 4. Append-only writes — status, consent, block, and timeline

Four tables are **INSERT + SELECT only** — no `UPDATE`/`DELETE` grant and no update/delete policy, so a mutation attempt fails with `42501`:

| Table                        | Written by         | Server-stamped                                                                       |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `crm.partner_status_history` | app INSERT         | `actor_id`, `occurred_at` (via `shared.stamp_status_history`)                        |
| `crm.consent_history`        | app INSERT         | `recorded_by`, `created_at`; future `effective_at` rejected (`guard_consent_insert`) |
| `crm.customer_block_history` | app INSERT         | actor/time; coherence enforced by the block guard                                    |
| `crm.timeline_events`        | emit triggers only | `actor_id`, `occurred_at`, PII-safe `title`                                          |

**Record a lifecycle/commercial change** by inserting into `crm.partner_status_history` (`status_kind` `'lifecycle'` or `'commercial'`, `to_state`, non-blank `reason`). A no-op is rejected by `CHECK (from_state IS DISTINCT FROM to_state)` → `23514`. Attribution is stamped server-side, so a caller cannot forge the actor or backdate the time.

**Record consent** by inserting into `crm.consent_history`; resolve the current state with `crm.current_consent(partner_id, consent_kind, channel, purpose)`, which returns the latest row effective at or before `now()`, totally ordered so a future-dated grant can never defeat a current withdrawal. A preference (`crm.communication_preferences`) is **not** consent and never grants it.

**Do not write `crm.timeline_events` directly.** Timeline rows are produced by `crm.emit_timeline_event()`, which fires as an `AFTER INSERT` trigger on the six source tables (status, consent, block, alert, merge, communication log). Insert the source record and a PII-safe timeline row appears in the same transaction; if the source insert rolls back, so does its timeline row. Titles are built from status/type/channel tokens only and carry no restricted PII. This timeline is a customer-facing chronology — the forensic audit trail is a Phase 1-16 concern, and no `crm` write path calls `iam.audit_append`. (That function is no longer ungranted: DBCR-P1-13-001 gave `app_runtime` tenant-scoped EXECUTE on it on 2026-07-21, for the Phase 1-13 backend foundation.)

## 5. Merge and duplicates

**Record a duplicate candidate** in `crm.duplicate_candidates`. Order the pair canonically (`partner_id_a < partner_id_b` → `23514` if reversed or self-paired), keep `match_score` in `[0, 1]`, and pass `match_basis` as a JSON **array** whose objects carry no raw-value keys (a defensive CHECK rejects keys such as `value`, `raw`, `national_id`, `tax`, `registration`, `date_of_birth`). A partial unique index allows one `open` candidate per pair, so a second open row for the same pair yields `23505`.

**Perform a merge** (source → survivor) in one transaction:

1. Insert the immutable record into `crm.partner_merges` with `source_partner_id`, `survivor_partner_id` (distinct → `23514`), a non-blank `approval_ref`, and a `merge_summary` JSON **object** (raw-value keys rejected). `merged_by` / `merged_at` are server-stamped.
2. `UPDATE crm.business_partners` on the source, setting `lifecycle_status = 'merged'` and `merged_into_id = <survivor>`. The coherence CHECK ties these together (`merged` iff a redirect is set), and the merge guard locks the survivor and rejects pointing at an already-merged survivor.

Once merged, the source row is **frozen** — the guard makes it read-only, so any further mutation raises `check_violation` (`23514`). Resolve a merged partner to its ultimate live survivor with `crm.resolve_partner_survivor(partner_id)`, which follows the redirect chain (cycle-safe, capped at 64 hops) and returns the live partner's id. Actually moving identifiers/roles/contacts onto the survivor (row-transfer orchestration) is **not** in this phase — it is a Phase 1-16 single-transaction backend responsibility. This phase owns storage, integrity, and the resolver only.

## 6. Search

Build search keys with the deterministic, `IMMUTABLE` normalization functions, then match against normalized columns:

- `crm.normalize_name(text)` — lowercased, whitespace-collapsed; Unicode-aware and Arabic-safe (no transliteration).
- `crm.normalize_email(text)` — trim + lowercase only (no dot/plus stripping).
- `crm.normalize_phone(text)` — digits with an optional single leading `+`; no country-code inference.

```sql
SELECT bp.id, bp.display_name
FROM   crm.business_partners bp
JOIN   crm.individual_profiles ip ON ip.tenant_id = bp.tenant_id AND ip.partner_id = bp.id
WHERE  bp.tenant_id = iam.current_tenant_id()
AND    ip.family_name_normalized = crm.normalize_name(:query);
```

Only the **11** searchable columns in the [classification matrix](./crm-classification-matrix.md) — display name, profile names and their `*_normalized` forms, and contact-point values — may be projected into search metadata. Restricted data (national/registration/tax identifiers, date of birth) is **never** projected and must never appear in a search key or index. The `shared.search_metadata` projection itself is a documented backend/admin write path (app roles hold only SELECT on it); the in-table generated `*_normalized` columns give case-folded matching for the query above without any projection.

## 7. Common SQLSTATEs

| SQLSTATE | Meaning                | Typical CRM cause                                                                                                                                                                                      |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `23505`  | unique_violation       | duplicate display number; second live identifier value per `(tenant, type, normalized_value)`; second live primary contact/address per partner; a second `open` duplicate candidate for a pair         |
| `23503`  | foreign_key_violation  | profile attached to a partner of the wrong `party_type`; cross-tenant or cross-partner reference; merge survivor not found in the tenant                                                               |
| `23514`  | check_violation        | no-op status row (`from_state = to_state`); reversed/self duplicate pair; mutating a frozen merged partner; blank `reason`/`approval_ref`; future consent `effective_at`; JSON carrying raw-value keys |
| `23P01`  | exclusion_violation    | overlapping `partner_roles` interval for the same partner and role type                                                                                                                                |
| `42501`  | insufficient_privilege | `UPDATE`/`DELETE` on an append-only table; touching a restricted identifier without `iam.sensitive.view`; allocating a display number with no tenant context                                           |
| `23502`  | not_null_violation     | missing required column, e.g. `display_name`, `created_by`, `to_state`, `approval_ref`                                                                                                                 |

Handle `23505` on restricted identifiers carefully: catch it and return a generic "possible duplicate, routed to review" without echoing the constraint detail, so the error cannot become a restricted-existence oracle (see the SEC-004 note in [`partner_identifiers`](./crm-data-dictionary.md)).
