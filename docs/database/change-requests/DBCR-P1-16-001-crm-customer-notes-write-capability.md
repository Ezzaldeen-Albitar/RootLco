# DBCR-P1-16-001 — CRM customer notes write capability on `shared.notes`

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-16 — CRM Backend · **Owner:** Eng. Ezzaldeen Al-Bitar
(technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review.**

- **Migration:** `supabase/migrations/20260730090000_crm_customer_notes_write_capability.sql` (the 119th)
- **Seed change:** `supabase/seeds/04_iam_permission_catalog.sql` — adds one permission `crm.customer.note.write`
- **Executable proof:** `tests/db/crm-customer-notes-write.test.ts` (13 tests)
- **Rollback classification:** **ROLLBACK-SAFE** — grants and policies only; no table, column,
  constraint, index, trigger, function, or data is created, moved, or destroyed. The exact inverse
  is in the migration footer.

---

## 1. Why this change request exists

Phase 1-16 (CRM Backend) must let a user author a **note about a customer**. The correct, already-built
home for that is `shared.notes` (Phase 1-5, migration `20260718110000_shared_tags_notes_comments.sql`):
a tenant-scoped, polymorphic annotation table with `entity_type`/`entity_id`, `author_id`, `body`,
`classification`, `visibility`, an edit-stamp trigger, a soft-delete column, `record_version`, RLS
ENABLEd and FORCEd, and an immutable-columns guard. Phase 1-5 deliberately shipped it **SELECT-only**
for application roles ("Deliberately ABSENT: INSERT/UPDATE/DELETE grants and policies … Backend
services own tag and annotation mutations") because no note-authoring backend yet existed. P1-16 is
that backend.

There is **no decision-neutral, application-only alternative.** `crm.communication_log` is
runtime-writable but is a directional (`inbound`/`outbound`), channel-bound communication log, not a
free-text internal annotation with a category, classification, and append-safe revision model; forcing
notes into it would violate the note contract. So a minimal, additive, protected grant on `shared.notes`
is genuinely required, and — being security-sensitive — is delivered here in its own remediation, never
inside the P1-16 feature pull request.

## 2. Reproduction under the real runtime role

Measured as `rootlco_test_runtime` (a `LOGIN` member of `app_runtime`, `NOBYPASSRLS`, non-super) against
the protected baseline `origin/develop = 6bc402f`:

```
rootlco_test_runtime=> INSERT INTO shared.notes
  (tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
  VALUES (…, 'crm.business_partners', …, …, 'probe', 'internal', 'internal', …);
ERROR:  permission denied for table notes            -- SQLSTATE 42501
```

Authoritative privilege read for the same role: `has_table_privilege('app_runtime','shared.notes','INSERT') = false`
and `… ,'UPDATE') = false`. The block is doubled exactly as in DBCR-P1-15-001: `app_runtime` holds
SELECT-only privileges **and** the table carries no INSERT/UPDATE/DELETE policy, so a privilege alone
would still deny and a policy alone would still deny.

## 3. The minimum additive remediation

### 3.1 Privileges (column-scoped)

| Grant                                       | Columns                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INSERT` on `shared.notes` to `app_runtime` | `id, tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by` | Create a note. `company_id`/`branch_id` are **withheld** — a CRM customer note is tenant-level (the `crm` schema has no company/branch scope), so both take their NULL default and request code cannot set them. `edited_at`/`deleted_at`/`record_version`/`created_at`/`updated_*` are defaults or trigger-owned.                                                                                                                                                    |
| `UPDATE` on `shared.notes` to `app_runtime` | `body, classification, visibility, deleted_at`                                                   | Content revision plus soft retirement. **No `DELETE` is granted** — a note is retired, never physically removed, preserving annotation history. Re-parenting columns are frozen by the existing `tg_notes_immutable` trigger and absent from the grant; `edited_at` is stamped by `tg_notes_stamp_content_edit`; `record_version`/`updated_*` are owned by `shared.touch_row_metadata()` (naming any of them in an UPDATE raises 42501 — P1-14 findings R-007/R-010). |

`app_readonly` and `app_worker` gain **nothing**. No role, ownership, schema `USAGE`, function, trigger,
`TRUNCATE`, `REFERENCES`, `TRIGGER` privilege, or `GRANT ALL` anywhere.

### 3.2 Policies

Both `app_runtime` policies are anchored on `tenant_id = iam.current_tenant_id()` and gated on the new
permission `crm.customer.note.write`. There is no `USING (true)` / `WITH CHECK (true)` for the request role.

- **`ins_notes_crm_customer` (INSERT)** — admits a row only when `tenant_id = iam.current_tenant_id()`
  AND `author_id = iam.current_user_id()` AND `created_by = iam.current_user_id()` AND
  `entity_type = 'crm.business_partners'` AND `iam.has_permission('crm.customer.note.write')` AND the
  target customer **EXISTS and is live inside the caller's own RLS view**. A note therefore can never
  attach to another tenant's, a deleted, or a non-existent customer, nor to any non-customer entity —
  even though `shared.notes` is generic. A future module that must annotate its own entities adds its
  own scoped policy; this change grants customer notes and nothing else.
- **`upd_notes_crm_customer` (UPDATE)** — admits a revision/soft-retirement only to the note's own
  author (`author_id = iam.current_user_id()`), same tenant, same `entity_type`, same permission, on
  both `USING` and `WITH CHECK`. One user can never edit or retire another user's note.

### 3.3 Permission catalog

One code added to the platform seed (idempotent, `ON CONFLICT DO NOTHING`):
`crm.customer.note.write` — _"Author and edit customer notes"_, domain `crm`, risk `medium`. It is
tenant-neutral structural reference data, not business data. This is the first `crm` permission; the
P1-16 feature adds the remainder.

## 4. Executable evidence

`tests/db/crm-customer-notes-write.test.ts` — 13 tests, all passing, every mutation through the
least-privilege `rootlco_test_runtime`/`rootlco_test_readonly` login:

1. an authorized author creates a note on a live customer (permit);
2. a note author lacking the permission is denied (42501);
3. a note on a non-customer `entity_type` is denied (42501);
4. a note on a non-existent customer is denied (42501);
5. a note on **another tenant's** customer is denied (42501);
6. authoring as a **different user** (author spoof) is denied (42501);
7. the **readonly** role cannot create a note (42501);
8. the author revises their own note and `edited_at` is stamped, `record_version` bumps to 2 (permit);
9. the author soft-retires their own note (permit);
10. a different authorized user cannot edit another author's note (0 rows — RLS-hidden);
11. a physical `DELETE` is denied (42501);
12. re-parenting via a frozen column on `UPDATE` is denied (42501);
13. runtime writes to `shared.tags`, `shared.entity_tags`, and `shared.comments` **remain** denied
    (42501) — the capability does not widen beyond customer notes.

The Phase 1-5 posture suite `tests/db/shared-tags-notes-comments.test.ts` (including
_"denies runtime writes on all four tables with 42501"_) continues to pass unchanged: its note INSERT
uses a generic `entity_type` with no permission, which the new policy still refuses (an RLS `WITH CHECK`
violation is also SQLSTATE 42501).

## 5. Security analysis

- Tenant isolation is enforced twice: the `tenant_id = iam.current_tenant_id()` predicate and the
  `EXISTS` customer lookup, both evaluated inside the caller's RLS view.
- Authorship cannot be forged (`author_id`/`created_by` pinned to the acting user) and cannot be
  transferred later (immutable-column trigger + column grant).
- No privilege escalation: the grant is column-scoped and entity-pinned; `app_readonly`/`app_worker`
  gain nothing; no other `shared` annotation table becomes writable.
- No data-loss path: `DELETE` is not granted; retirement is a soft `deleted_at`; revisions stamp
  `edited_at` and bump `record_version`.
- Reading a `restricted`/`secret` note still additionally requires `iam.sensitive.view` through the
  unchanged `sel_notes_tenant` policy — this change does not touch read visibility.

## 6. Governance

Delivered on branch `fix/p1-16-crm-notes-write-capability` from protected `origin/develop`, as a pull
request into `develop`, gated by the same hosted CI as every other change. The P1-16 feature branch is
parked until this remediation is merged and its protected merge is verified. Nothing reaches protected
`develop` outside the approved pull-request and hosted-CI flow. No dependency scanning, malware scanning,
production monitoring, or independent review exists or is claimed.
