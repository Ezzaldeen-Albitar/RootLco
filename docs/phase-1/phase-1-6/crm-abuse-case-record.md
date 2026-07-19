# Phase 1-6 — CRM Abuse-Case Record (SEC-004)

> Classification: **Confidential — Commercial Product and Pilot Planning**
> Company: **RootLco — Root Link Company** · Product: **[PRODUCT NAME — Pending Final Approval]**
> Phase: **1-6 — CRM and Business Partner Database** · Task: **P1-06-SEC-004**

| Field               | Value                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Branch              | `feature/p1-06-crm-business-partner-database` (base `develop` @ `cd475d3`)                                                                |
| Hardening migration | `20260719104000_crm_security_hardening.sql` (`45fda2d`)                                                                                   |
| Regression tests    | `tests/db/crm-security-hardening.test.ts` (TC-CRM-001); `tests/db/crm-concurrency.test.ts` (TC-CON-001); `tests/db/crm-isolation.test.ts` |
| Authorization       | Authored under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)                 |
| Review model        | Owner-authorized technical/security self-review with an adversarial (red-team) lens — **not** an independent third-party review           |
| Owner gate          | **PENDING** — the feature PR is not open/merged; this record does not assert "Go"                                                         |
| Date                | 2026-07-19                                                                                                                                |

## 1. Purpose and scope

This record enumerates concrete abuse and misuse cases an authenticated but hostile
caller could attempt against the Phase 1-6 `crm` schema, and for each states the
**database-layer** control that defeats it and the observable outcome (an SQLSTATE, or
a documented residual risk). It is the SEC-004 deliverable of the closeout package.

Scope is the DB layer only: 21 tables, 13 functions, 45 triggers, 58 policies, 73
check constraints, 51 foreign keys and 68 indexes as inventoried in
[`crm-object-inventory.md`](./crm-object-inventory.md). Application/write-path controls
(input validation, error-message redaction, orchestration atomicity) are Phase 1-16 and
are called out honestly where a DB control is only a backstop.

### Trust boundary / threat model

The adversary-capable principal is the runtime role **`app_runtime`**: authenticated,
tenant-scoped, holding `SELECT/INSERT/UPDATE` on most `crm` tables but **`NOBYPASSRLS`**,
non-superuser, and owner of **zero** `crm` tables. `app_readonly` holds `SELECT` only.
There are **zero `SECURITY DEFINER`** functions, so no callable object runs with more
privilege than its caller. Every abuse case below is evaluated as this role acting in
bad faith within its own session.

### SQLSTATE legend

| SQLSTATE          | Meaning in this record                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `42501`           | insufficient privilege — RLS `WITH CHECK` denial, missing table grant (append-only / read-only / no-DELETE), or revoked `EXECUTE` |
| `23503`           | foreign_key_violation — a composite (tenant-carrying) FK rejected a cross-tenant / cross-partner link                             |
| `23505`           | unique_violation — a (partial) unique index rejected a duplicate / second winner                                                  |
| `23514`           | check_violation — a `CHECK` constraint or a `RAISE … USING ERRCODE = 'check_violation'` guard/immutable-column trigger            |
| `23502`           | not_null_violation                                                                                                                |
| `23P01`           | exclusion_violation — the temporal GiST `EXCLUDE` rejected an overlap                                                             |
| `40P01` / `55P03` | deadlock_detected / lock_not_available — a concurrency loser aborted while a single winner committed                              |
| _(0 rows)_        | no error and **no leak**: an RLS `SELECT` policy simply returned nothing                                                          |

## 2. Abuse-case catalogue

Status legend: **Prevented** = defeated at the DB layer; **Accepted (residual)** =
a stated residual risk deferred to the Phase-1-16 write path.

### 2.1 Tenant escape — cross-tenant reads and writes (RLS FORCE + composite FKs)

Every `crm` table is `ENABLE` + `FORCE ROW LEVEL SECURITY` with default-deny,
per-command policies keyed on `iam.current_tenant_id()`. Every child references its
parent through a tenant-carrying composite candidate key, so a cross-tenant link is a
foreign-key violation rather than a filtered row.

| #   | Abuse case                                                                                             | DB-layer control                                                                             | Outcome / SQLSTATE             | Status    |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------ | --------- |
| 1   | Read another tenant's `business_partners` via plain `SELECT`                                           | `sel_business_partners_tenant` USING `tenant_id = iam.current_tenant_id()` under FORCE RLS   | 0 rows, no error, no leak      | Prevented |
| 2   | `INSERT` a partner stamped with a foreign `tenant_id`                                                  | `ins_business_partners_tenant` `WITH CHECK`                                                  | `42501`                        | Prevented |
| 3   | `UPDATE` a row's `tenant_id` to steal/push it across tenants                                           | `tg_business_partners_immutable` (`tenant_id` immutable) + `upd` `USING/WITH CHECK` backstop | `23514` (RLS `42501` backstop) | Prevented |
| 4   | Attach an identifier/contact/role/profile to a partner in another tenant                               | composite FK `(tenant_id, partner_id) → business_partners(tenant_id, id)`                    | `23503`                        | Prevented |
| 5   | Point a profile `national_id_ref`/`registration_ref`/`tax_ref` at a foreign partner's identifier       | same-partner 3-col FK `(tenant_id, partner_id, id) → partner_identifiers`                    | `23503`                        | Prevented |
| 6   | Pair two different-tenant partners as a `duplicate_candidates` row                                     | composite peer FKs `fk_duplicate_candidates_a`/`_b` to `(tenant_id, id)`                     | `23503`                        | Prevented |
| 7   | Record a `partner_merges` row with cross-tenant source/survivor                                        | composite FKs `fk_partner_merges_source`/`_survivor`                                         | `23503`                        | Prevented |
| 8   | Merge a partner into a survivor located in another tenant                                              | composite self-FK `(tenant_id, merged_into_id)` + merge-guard survivor lookup                | `23503`                        | Prevented |
| 9   | Reference a foreign partner's contact point or a foreign-tenant evidence document in `consent_history` | same-partner FK to `contact_points`; same-tenant FK to `shared.documents(tenant_id, id)`     | `23503`                        | Prevented |
| 10  | Link `communication_log` to another tenant's outbound message                                          | composite FK to `shared.outbound_messages(tenant_id, id)`                                    | `23503`                        | Prevented |
| 11  | Attach a foreign partner's restriction in `customer_block_history`                                     | same-partner 3-col FK to `customer_restrictions(tenant_id, partner_id, id)`                  | `23503`                        | Prevented |

See [`crm-rls-policy-matrix.md`](./crm-rls-policy-matrix.md) for the full 58-policy lens
(SEC-002: 0 defects on RLS across a 4-lens review).

### 2.2 Privilege / bypass (NOBYPASSRLS, no SECURITY DEFINER, REVOKE FROM PUBLIC)

| #   | Abuse case                                                                                                                                    | DB-layer control                                                                                      | Outcome / SQLSTATE                       | Status    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------- |
| 12  | Disable or bypass RLS (`SET row_security = off`, `ALTER TABLE … NO FORCE`)                                                                    | app roles are `NOBYPASSRLS`, non-superuser, and own zero `crm` tables; FORCE RLS binds even the owner | no effect / `42501` (ownership required) | Prevented |
| 13  | Escalate through a `SECURITY DEFINER` helper                                                                                                  | none exist — all 13 functions are `SECURITY INVOKER`, so they run under the caller's RLS              | no such surface                          | Prevented |
| 14  | Call a guard/stamp/emit function directly to forge attribution or write out of band (`stamp_partner_merge`, `emit_timeline_event`, `guard_*`) | `REVOKE EXECUTE … FROM PUBLIC`; not granted to app roles                                              | `42501`                                  | Prevented |
| 15  | Shadow an object a function calls via `search_path` manipulation                                                                              | every function sets `search_path = ''` → schema-qualified resolution only                             | injection surface removed                | Prevented |
| 16  | `app_readonly` performs a write                                                                                                               | `SELECT`-only grant on `crm` tables                                                                   | `42501`                                  | Prevented |
| 17  | Hard-`DELETE` a partner/child/history row to destroy evidence                                                                                 | no `DELETE` grant on any `crm` table; parents are `ON DELETE RESTRICT`                                | `42501` (`23503` on a restricted path)   | Prevented |
| 18  | Make a resolver leak cross-tenant rows (`partner_roles_active_at`, `resolve_partner_survivor`, `current_consent`)                             | `SECURITY INVOKER` + `search_path = ''` → RLS-scoped to the caller's tenant                           | 0 rows outside tenant                    | Prevented |

Grants are catalogued in [`crm-grant-matrix.md`](./crm-grant-matrix.md).

### 2.3 Sensitive-data exposure (classification gate, no raw values in jsonb, restricted-never-searchable)

The only sensitive-data primitive is a **row-level** `iam.has_permission('iam.sensitive.view')`
gate against a `classification` column — there is no column-masking view or function.
Restricted = national_id / registration / tax identifiers + date_of_birth.

| #   | Abuse case                                                                                                   | DB-layer control                                                                                                                                                             | Outcome / SQLSTATE                   | Status                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 19  | Read raw national_id/registration/tax without permission                                                     | `sel_partner_identifiers_tenant` gates restricted rows on `iam.has_permission('iam.sensitive.view')`                                                                         | restricted rows invisible (0 rows)   | Prevented                                                                                                                           |
| 20  | Read `date_of_birth` without permission                                                                      | `partner_sensitive_attributes` whole-table SELECT gate on `iam.sensitive.view`                                                                                               | invisible (0 rows)                   | Prevented                                                                                                                           |
| 21  | Insert a restricted identifier mislabeled `internal` to dodge the gate                                       | `ck_partner_identifiers_type_classification` forces national_id/registration/tax ⇒ `restricted`                                                                              | `23514`                              | Prevented                                                                                                                           |
| 22  | Downgrade a restricted row's `classification` to expose it                                                   | `classification` immutable (`tg_*_immutable`) **and** UPDATE `USING` carries the sensitive gate (unprivileged session cannot touch the row)                                  | `23514` / row invisible              | Prevented                                                                                                                           |
| 23  | Insert a `date_of_birth` row as `internal`                                                                   | `ck_partner_sensitive_attributes_classification` pins `restricted`                                                                                                           | `23514`                              | Prevented                                                                                                                           |
| 24  | Smuggle a raw sensitive value into `duplicate_candidates.match_basis` / `partner_merges.merge_summary` jsonb | `ck_*` calling `crm.jsonb_no_raw_value_keys(...)` (name-based deny-list)                                                                                                     | `23514` (listed keys only)           | Partly prevented — a value under a non-listed key is NOT caught; defense-in-depth, not a PII barrier (backend sanitizer is primary) |
| 25  | Hide the raw value under a nested or differently-cased key (`details.national_id`, `Raw_Value`)              | hardened **whole-document, case-insensitive** scan (`45fda2d`)                                                                                                               | `23514`                              | Prevented — **FIXED finding #3**                                                                                                    |
| 26  | Store a restricted value where it becomes searchable                                                         | classification registry keeps the 7 restricted and 11 searchable columns **disjoint**; CI `validate:crm-classification` (`scripts/check-crm-classification.mjs`) enforces it | lint fails the build                 | Prevented (DB-layer contract; the search **projection** is a Phase-1-16 write-path concern)                                         |
| 27  | Bind a profile's `national_id_ref` to a same-partner identifier of the **wrong type** (e.g. a phone)         | same-partner composite FK enforces existence + tenant + partner, but **not** `identifier_type`                                                                               | link accepted if same partner/tenant | **Accepted (residual)** — **finding #4**: type-correctness is a Phase-1-16 write-path invariant                                     |

Column-by-column classification is in [`crm-classification-matrix.md`](./crm-classification-matrix.md);
the machine-checked registry is [`crm-personal-data-classification.json`](../../database/crm-personal-data-classification.json).

### 2.4 Lifecycle integrity (block-coherence, no-op guard, append-only immutability)

| #   | Abuse case                                                                      | DB-layer control                                                                                                                                   | Outcome / SQLSTATE | Status                           |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------- |
| 28  | Create a partner already `blocked` with no block-history row                    | `guard_partner_block_coherence` now runs `BEFORE INSERT OR UPDATE` and forbids an initial `blocked`                                                | `23514`            | Prevented — **FIXED finding #1** |
| 29  | Flip a partner to `blocked` without a matching latest block-history row         | coherence guard requires the newest `customer_block_history` row = `blocked`                                                                       | `23514`            | Prevented                        |
| 30  | Unblock without a matching unblock-history row                                  | coherence guard requires the newest row = `unblocked`                                                                                              | `23514`            | Prevented                        |
| 31  | Write a no-op status-history row (`from_state = to_state`) to pollute the trail | `ck_partner_status_history_state_change` (`IS DISTINCT FROM`)                                                                                      | `23514`            | Prevented                        |
| 32  | Forge attribution / backdate a history row (set `actor_id` / `occurred_at`)     | `BEFORE INSERT` server-stamp (`shared.stamp_status_history` / `guard_consent_insert` / `stamp_partner_merge`) overwrites them; NULL actor rejected | `23514`            | Prevented                        |
| 33  | `UPDATE`/`DELETE` an append-only history or timeline row to rewrite the record  | `SELECT` + `INSERT` grants only; no upd/del policy                                                                                                 | `42501`            | Prevented                        |
| 34  | Mutate an immutable partner column (`party_type`, `tenant_id`, `created_by`)    | `tg_business_partners_immutable` (`org.guard_immutable_columns`, raises `check_violation`)                                                         | `23514`            | Prevented                        |

Note: `iam.audit_append` is deliberately **not** granted to app roles — the forensic
audit trail is Phase-1-16; the DB-layer attributable record is these append-only
history/timeline tables.

### 2.5 Duplicate / merge abuse

| #   | Abuse case                                                                   | DB-layer control                                                                                | Outcome / SQLSTATE  | Status                           |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- | -------------------------------- |
| 35  | Open two duplicate candidates for the same pair                              | partial unique `uq_duplicate_candidates_open` (`WHERE status = 'open'`)                         | `23505`             | Prevented                        |
| 36  | Create a reversed or self-pair candidate                                     | `ck_duplicate_candidates_order` (`partner_id_a < partner_id_b`)                                 | `23514`             | Prevented                        |
| 37  | Re-merge, hijack the survivor of, or otherwise mutate a `merged` row         | merge guard freezes merged rows (`OLD.lifecycle_status = 'merged'` on UPDATE → read-only)       | `23514`             | Prevented                        |
| 38  | Create a partner already `merged` (with a redirect) to bypass the freeze     | merge guard rejects an `INSERT` carrying `merged_into_id`                                       | `23514`             | Prevented — **FIXED finding #2** |
| 39  | Redirect into an already-merged survivor (chain-into-merged / build a cycle) | merge guard locks the survivor `FOR UPDATE` and rejects a `merged` survivor                     | `23514`             | Prevented                        |
| 40  | Self-redirect a partner (`merged_into_id = id`)                              | `ck_business_partners_merged_not_self`                                                          | `23514`             | Prevented                        |
| 41  | Desync merged status vs redirect                                             | `ck_business_partners_merged_coherent` (`(status = 'merged') = (merged_into_id IS NOT NULL)`)   | `23514`             | Prevented                        |
| 42  | `partner_merges` with source = survivor, or a blank approval reference       | `ck_partner_merges_distinct` / `ck_partner_merges_approval_not_blank`                           | `23514`             | Prevented                        |
| 43  | Drive `resolve_partner_survivor` into a runaway / cyclic chain               | 64-hop cap raises; redirects may only target a live node, so cycles are structurally impossible | `23514` on overflow | Prevented                        |

### 2.6 Consent / preference abuse (append-only consent, deterministic resolution)

| #   | Abuse case                                                                 | DB-layer control                                                                                                   | Outcome / SQLSTATE   | Status                           |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------- | -------------------------------- |
| 44  | `UPDATE`/`DELETE` `consent_history` to erase a withdrawal                  | append-only (`SELECT` + `INSERT` grants only)                                                                      | `42501`              | Prevented                        |
| 45  | Future-date a grant to defeat a current withdrawal                         | `guard_consent_insert` rejects `effective_at > now()`; `current_consent()` only reads rows `effective_at <= now()` | `23514`              | Prevented                        |
| 46  | Exploit a same-`effective_at` tie so "current consent" is nondeterministic | monotonic `seq` IDENTITY tie-break; `current_consent` orders by `effective_at DESC, seq DESC` (total order)        | deterministic result | Prevented — **FIXED finding #5** |
| 47  | Treat a `communication_preferences` row as consent to message              | schema separates the two; a preference never writes consent and `current_consent` reads only `consent_history`     | design invariant     | Prevented                        |

Consent integrity detail is in SEC-003 (deterministic `current_consent`, append-only history).

### 2.7 Temporal abuse (overlapping role intervals)

| #   | Abuse case                                                              | DB-layer control                                                                                     | Outcome / SQLSTATE | Status    |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------ | --------- |
| 48  | Two overlapping intervals of the same `role_type` for one partner       | `ex_partner_roles_no_overlap` `EXCLUDE USING gist (… daterange(valid_from, valid_to, '[)') WITH &&)` | `23P01`            | Prevented |
| 49  | `NULL` `valid_from` to make the range unbounded-below and dodge overlap | `valid_from NOT NULL`                                                                                | `23502`            | Prevented |
| 50  | Inverted interval (`valid_to <= valid_from`)                            | `ck_partner_roles_valid_range`                                                                       | `23514`            | Prevented |
| 51  | Rewrite `role_type` / `valid_from` to backdate a role change            | both immutable (`tg_partner_roles_immutable`); a role is ended only by setting `valid_to`            | `23514`            | Prevented |

### 2.8 Concurrency abuse (single-winner races)

Verified end-to-end by `tests/db/crm-concurrency.test.ts` (QA-007), which drives
genuinely concurrent conflicting operations through separate runtime connections and
asserts exactly one committer.

| #   | Abuse case                                                   | DB-layer control                                                                                                                                 | Outcome / SQLSTATE                             | Status    |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --------- |
| 52  | Concurrent identical normalized identifiers                  | `uq_partner_identifiers_value_active` enforced beneath RLS                                                                                       | one winner, losers `23505`                     | Prevented |
| 53  | Concurrent open candidates for the same pair                 | `uq_duplicate_candidates_open`                                                                                                                   | one winner, losers `23505`                     | Prevented |
| 54  | Concurrent primary contacts for one `(partner, channel)`     | `uq_contact_points_primary_active`                                                                                                               | one winner, losers `23505`                     | Prevented |
| 55  | Concurrent overlapping same-role intervals                   | GiST `EXCLUDE`, with lock ordering                                                                                                               | one winner, losers `23P01` / `40P01` / `55P03` | Prevented |
| 56  | Concurrent merge of the same source into different survivors | survivor `FOR UPDATE` lock + merged-row freeze                                                                                                   | one winner, loser `23514` / `40P01` / `55P03`  | Prevented |
| 57  | Concurrent partner display-number allocation                 | concurrency-safe allocation (DB-020, `crm-display-number.test.ts`) + partial-unique `uq_business_partners_tenant_display_number_active` backstop | single winner                                  | Prevented |

## 3. Findings ledger (explicit)

The Wave 5 adversarial self-review produced four MEDIUM findings on the committed
schema plus one latent determinism defect; the three input-surface bypasses and the
determinism defect were fixed forward in `45fda2d`, and one is accepted with rationale.
Migrations are immutable once merged, so these are forward corrections, not edits.

| #   | Finding                                                                                                           | Disposition                                                                                                                           | Where                  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | Block coherence enforced only on `UPDATE` → a partner could be **INSERTed already `blocked`** with no history row | **FIXED** — guard now `BEFORE INSERT OR UPDATE`, forbids initial `blocked` (case 28)                                                  | `45fda2d` / TC-CRM-001 |
| 2   | Merge guard validated the transition but not creation → a partner could be **INSERTed already `merged`**          | **FIXED** — guard rejects an `INSERT` with `merged_into_id` (case 38)                                                                 | `45fda2d` / TC-CRM-001 |
| 3   | `jsonb_no_raw_value_keys` was a shallow, case-sensitive, depth-1 check                                            | **FIXED** — whole-document, case-insensitive scan (cases 24–25)                                                                       | `45fda2d` / TC-CRM-001 |
| 4   | Profile `_ref` FK does not enforce `identifier_type`                                                              | **ACCEPTED** — existence + tenant + partner enforced at the DB layer; type-correctness is a Phase-1-16 write-path invariant (case 27) | residual               |
| 5   | Latent same-transaction ordering nondeterminism (`occurred_at = now()` constant per tx; random uuid tie-break)    | **FIXED** — monotonic `seq` on `customer_block_history` + `consent_history`, resolve by `seq` (case 46)                               | `45fda2d` / TC-CRM-001 |

## 4. Residual risk and honestly-deferred scope

Several items below were **closed** by the Wave 7 review-hardening migration
`20260719105000_crm_review_hardening.sql`; the disposition of every review
finding is recorded in the [review response](./phase-1-6-review-response.md).

- **Authorization scope (accepted, Phase 1-16):** the DB enforces attribution
  **shape** and **coherence**, not **who** may act. Beyond the `iam.sensitive.view`
  gate on restricted data, block/unblock, restrictions, alerts, and credit approval
  carry no permission check — any `app_runtime` session with a valid tenant/user
  context can perform them within its tenant. Authorization is a Phase-1-16
  write-path responsibility; before any such action becomes reachable, an
  `iam.has_permission` gate should be added to the relevant policy/CHECK.
- **Finding M-10 (accepted):** a profile identifier pointer can reference a same-partner
  identifier of the wrong `identifier_type`. Only the _write path_ (Phase 1-16) can
  assert type-correctness; the DB enforces existence, tenant, and partner. It is
  declaratively closeable (a `(tenant_id, partner_id, id, identifier_type)` candidate
  key + pinned discriminator FKs) and is the top integrity item to close in Phase 1-16.
- **Restricted-existence oracle — now gated at the DB layer:** restricted-identifier
  `INSERT` is gated on `iam.has_permission('iam.sensitive.view')` (migration `…105000`),
  so an unprivileged session can no longer plant or probe restricted values via the
  `23505` unique-violation. The Phase-1-16 backend should still return a generic
  "possible duplicate" without echoing constraint DETAIL as defence-in-depth.
- **jsonb raw-value containment (defense-in-depth only):** `crm.jsonb_no_raw_value_keys`
  is a name-based deny-list; a raw value smuggled under a non-listed key is **not**
  caught. It is not a PII barrier — the real controls are the store-refs-not-values
  schema (uuid pointers + counts) and the Phase-1-16 backend sanitizer.
- **Merge orchestration atomicity:** redirect cycles, cross-tenant survivors,
  merge-into-merged, and merge-into-**soft-deleted** survivors are all prevented at the
  DB layer, and a source can be merged at most once (`UNIQUE (tenant_id, source_partner_id)`).
  The atomic coupling of `merged_into_id` with its `partner_merges` row and the transfer
  of child rows remains a Phase-1-16 single-transaction backend responsibility.
- **Timeline write path — attribution now server-stamped:** a `BEFORE INSERT` trigger
  forces `actor_id := iam.current_user_id()` and `occurred_at := now()`, so attribution
  and time cannot be forged or backdated even on the direct-insert path. With no
  `SECURITY DEFINER` available, direct `INSERT` cannot be locked to the emit triggers, so
  `event_type`/`title` remain caller-shaped on that path — an honest limit; the
  customer-facing timeline is distinct from the Phase-1-16 forensic audit trail.
- **Searchable projection (case 26):** the DB-layer guarantee is the disjoint
  classification registry and its CI lint, plus `shared.search_metadata`'s row-level
  gate that hides restricted rows from unprivileged sessions; building the crm search
  projection itself is a Phase-1-16 write-path task.

## 5. Cross-references

- Object inventory — [`crm-object-inventory.md`](./crm-object-inventory.md)
- RLS policy matrix (SEC-002) — [`crm-rls-policy-matrix.md`](./crm-rls-policy-matrix.md)
- Grant matrix — [`crm-grant-matrix.md`](./crm-grant-matrix.md)
- Classification matrix — [`crm-classification-matrix.md`](./crm-classification-matrix.md)
- Data dictionary — [`crm-data-dictionary.md`](./crm-data-dictionary.md)
- ERD — [`phase-1-6-crm.mmd`](../../database/erd/phase-1-6-crm.mmd)
- Classification registry — [`crm-personal-data-classification.json`](../../database/crm-personal-data-classification.json)
- Authorization — [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)

---

_Owner-authorized technical/security self-review. The owner gate remains **PENDING**
until the feature PR is merged; nothing in this record should be read as a "Go"._
