# CRM Party & Role Taxonomy — Phase 1-6

**Company:** RootLco — Root Link Company
**Product:** [PRODUCT NAME — Pending Final Approval]
**Phase:** 1-6 — CRM and Business Partner Database
**Status:** Author-complete on `feature/p1-06-crm-business-partner-database`; the feature PR is not yet merged, so the owner gate is **Pending**.
**Authorization:** Authored under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md); the review model is owner-authorized technical/security self-review (not independent review).

This note defines the conceptual model behind the Phase 1-6 party master: what a _party_ is, how _profiles_ attach to it, how _lifecycle status_ is constrained, what _roles_ a party may hold over time, and how roles differ from _segments_. Every enumerated value below is quoted verbatim from the `CHECK` constraints in the migrations named in each section; no value appears here that is not present in a migration. Object-level detail (columns, policies, grants, classification) lives in the generated matrices — see [`./crm-object-inventory.md`](./crm-object-inventory.md), the [`./crm-data-dictionary.md`](./crm-data-dictionary.md), and the ERD at [`../../database/erd/phase-1-6-crm.mmd`](../../database/erd/phase-1-6-crm.mmd).

---

## 1. Party model — one master, typed by discriminator

`crm.business_partners` is the **single party master** (source migration `20260719090000_crm_business_partners.sql`). A partner exists independently of any role or profile: it is created first, and every CRM child (profiles, identifiers, roles, contacts, segments, history) references it through the tenant-scoped candidate key `UNIQUE (tenant_id, id)`, so a cross-tenant link is a foreign-key violation rather than a filtered row.

The `party_type` column is the **discriminator** and is one of exactly two values, immutable after insert (enforced by `tg_business_partners_immutable`):

| `party_type`   | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| `individual`   | A natural person; detail lives in `crm.individual_profiles`.      |
| `organization` | A legal entity / company; detail lives in `crm.company_profiles`. |

### How profiles attach — the `(tenant_id, id, party_type)` discriminator key

`crm.business_partners` carries a second candidate key, `UNIQUE (tenant_id, id, party_type)`. The two profile tables (`20260719092000_crm_profiles.sql`) each **pin** their `party_type` to a constant and reference that key:

- `crm.individual_profiles.party_type` has `DEFAULT 'individual'` and `CHECK (party_type = 'individual')`, and its FK is `(tenant_id, partner_id, party_type) REFERENCES crm.business_partners (tenant_id, id, party_type)`.
- `crm.company_profiles.party_type` has `DEFAULT 'organization'` and `CHECK (party_type = 'organization')`, with the same shape of FK.

Because the child's `party_type` is a fixed literal _and_ must match the parent's `party_type` through the composite FK — _and_ the parent's `party_type` is immutable — an individual profile can attach only to an individual partner and a company profile only to an organization partner. Each profile also carries `UNIQUE (tenant_id, partner_id)`, so a partner has **exactly one** profile, of the matching type. This exclusivity is fully **declarative** (constraints and the discriminator key), with no trigger needed.

Restricted identity does not sit in the profile: `individual_profiles.national_id_ref`, `company_profiles.registration_ref`, and `company_profiles.tax_ref` are same-partner uuid pointers into `crm.partner_identifiers`; date of birth lives in `crm.partner_sensitive_attributes` (`CHECK (attribute_type IN ('date_of_birth'))`), row-gated by `iam.has_permission('iam.sensitive.view')`. See [`./crm-classification-matrix.md`](./crm-classification-matrix.md) for the sensitive-data treatment.

A partner also carries `commercial_status`, a CHECK-constrained enum orthogonal to lifecycle:

| `commercial_status` | Meaning                      |
| ------------------- | ---------------------------- |
| `normal`            | Default; no commercial flag. |
| `watch`             | Under commercial watch.      |
| `hold`              | Commercial hold.             |

---

## 2. Lifecycle status — values and the transitions the guards enforce

`business_partners.lifecycle_status` is CHECK-constrained to exactly five values (`DEFAULT 'prospect'`):

| `lifecycle_status` | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `prospect`         | Newly created party, not yet activated (default on insert).                        |
| `active`           | Active party.                                                                      |
| `inactive`         | Deactivated but retained.                                                          |
| `blocked`          | Blocked; requires a matching block-history row (see below).                        |
| `merged`           | Merged away into a survivor; the row is frozen and redirects via `merged_into_id`. |

**Important scope note (honest limits):** the database does **not** enforce a general transition graph among `prospect / active / inactive`. That ordering is a Phase 1-16 write-path responsibility. What the DB layer enforces at write time are two specific invariants — **block coherence** and **merge coherence/freezing** — plus the append-only `crm.partner_status_history` record of every transition.

### Block coherence (`crm.guard_partner_block_coherence`, trigger `tg_business_partners_block_coherence`)

Defined in `20260719100000_crm_block_history.sql` and hardened in `20260719104000_crm_security_hardening.sql` to run `BEFORE INSERT OR UPDATE`:

- **A partner cannot be _created_ already `blocked`.** On `INSERT`, `lifecycle_status = 'blocked'` raises `check_violation` — blocking is only ever an update accompanied by a block-history row (this closed a Wave 5 INSERT-bypass finding).
- **Entering `blocked`** (`OLD <> 'blocked'` → `NEW = 'blocked'`) requires the latest `crm.customer_block_history` row for the partner to have `action = 'blocked'` (history-first ordering; latest row resolved by the monotonic `seq`).
- **Leaving `blocked`** to any state other than `merged` requires the latest block-history row to be `action = 'unblocked'`.
- The `blocked → merged` transition is **exempt** here and owned by the merge guard.

`crm.customer_block_history` is append-only (`GRANT SELECT, INSERT` only → mutation attempts fail `42501`), server-attributed, with `CHECK (action IN ('blocked', 'unblocked'))`.

### Merge freezing & coherence (`crm.guard_business_partner_merge`, trigger `tg_business_partners_merge_guard`)

Defined in `20260719090000` and extended in `20260719104000`:

- **Coherence is a table CHECK:** `ck_business_partners_merged_coherent` requires `(lifecycle_status = 'merged') = (merged_into_id IS NOT NULL)` — `merged` if and only if a survivor redirect is set.
- **A merged row is frozen:** any `UPDATE` where `OLD.lifecycle_status = 'merged'` raises `check_violation`. A merged partner is read-only (redirect resolution is a `SELECT`; audit is external). This blocks re-merge, survivor hijack, and any post-merge mutation.
- **A partner cannot be _created_ already `merged`:** on `INSERT`, a non-null `merged_into_id` raises `check_violation` (merge is only ever an update — the second Wave 5 INSERT-bypass fix).
- **A new redirect must target a live survivor:** the survivor is locked `FOR UPDATE` (serializing concurrent symmetric merges) and must not itself be `merged`, so redirect **cycles are structurally impossible** while chains (`A→B→C`) are permitted and resolved recursively (`crm.resolve_partner_survivor`).
- The survivor is a same-tenant composite self-FK `(tenant_id, merged_into_id)`, and `ck_business_partners_merged_not_self` forbids self-redirect.

Every lifecycle and commercial transition is recorded append-only in `crm.partner_status_history` (`20260719094000`), whose `status_kind` is CHECK-constrained to `lifecycle` or `commercial`, with `from_state`/`to_state` validated against the same value sets and a no-op guard `CHECK (from_state IS DISTINCT FROM to_state)`.

---

## 3. Role taxonomy — dated, typed, non-overlapping

`crm.partner_roles` (`20260719093000_crm_partner_roles.sql`) lets one partner hold **many dated roles**. `role_type` is CHECK-constrained to exactly nine values — the eight mandated automotive-service party distinctions plus a structure-only `supplier`:

| `role_type`           | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `customer`            | The customer party.                                        |
| `vehicle_owner`       | Owner of the vehicle.                                      |
| `vehicle_user`        | User/driver of the vehicle.                                |
| `service_requester`   | Party requesting the service.                              |
| `payer`               | Party responsible for payment.                             |
| `billing_party`       | Party the invoice is addressed to.                         |
| `approving_party`     | Party that approves the work/estimate.                     |
| `authorized_receiver` | Party authorized to receive the vehicle/goods.             |
| `supplier`            | Structure only in Phase 1-6; procurement is a later phase. |

**Dated validity.** Each role carries `valid_from date NOT NULL` and `valid_to date NULL` (open-ended), with `CHECK (valid_to IS NULL OR valid_to > valid_from)`. A role is **ended by setting `valid_to`, never deleted** — there is no `DELETE` grant — and `role_type` and `valid_from` are immutable (`tg_partner_roles_immutable`), while `valid_to` is mutable for end-dating.

**Temporal EXCLUDE (no overlapping same-role intervals).** `ex_partner_roles_no_overlap` uses `btree_gist`:

```sql
EXCLUDE USING gist (
  tenant_id  WITH =,
  partner_id WITH =,
  role_type  WITH =,
  daterange(valid_from, valid_to, '[)') WITH &&
)
```

Two intervals of the **same** `role_type` for the same partner may not overlap; different role types (and different partners/tenants) are independent. Point-in-time resolution is published as `crm.partner_roles_active_at(uuid, date)` (SECURITY INVOKER, empty `search_path`, so RLS applies), which the Phase 1-7 vehicle-relationship contract will consume.

---

## 4. Segments vs roles — two different things

Roles and segments are frequently confused; they are structurally distinct.

- **Roles are structural business relationships.** `role_type` is a fixed, product-defined vocabulary (the nine values above). A role says _how this party participates_ in the automotive-service process. Its values are baked into a `CHECK` constraint and are the same for every tenant.

- **Segments are tenant-defined groupings.** `crm.customer_segments` (`20260719095000_crm_segments.sql`) is tenant **configuration**: each tenant names its own segments with a tenant-unique `segment_code` (`CHECK (segment_code ~ '^[a-z][a-z0-9_]{1,62}$')`) and a `status` CHECK-constrained to `active` or `disabled`. There is no product-wide list of segments — the set is whatever each tenant creates (RootLco ships **zero** segment rows; see the no-fake-data verdict in [`./crm-object-inventory.md`](./crm-object-inventory.md)).

- **Assignments are dated, like roles, but reference tenant data.** `crm.partner_segment_assignments` attaches a partner to one of its tenant's segments over a date range, with the same non-overlap discipline as roles — `ex_partner_segment_assignments_no_overlap` forbids two overlapping active assignments of the **same segment** to the same partner — and the same "end-date, never delete" rule (no `DELETE` grant).

In short: **roles are a closed, structural taxonomy the product defines; segments are an open, descriptive taxonomy each tenant defines.** Both are dated and non-overlapping-per-key, but a role changes _what a party is to the business_, while a segment changes _which tenant-defined group a party is filed under_.

---

## Cross-references

- Object inventory & counts: [`./crm-object-inventory.md`](./crm-object-inventory.md)
- Column-level detail: [`./crm-data-dictionary.md`](./crm-data-dictionary.md)
- RLS policies: [`./crm-rls-policy-matrix.md`](./crm-rls-policy-matrix.md)
- Grants: [`./crm-grant-matrix.md`](./crm-grant-matrix.md)
- Data classification (sensitive attributes): [`./crm-classification-matrix.md`](./crm-classification-matrix.md)
- ERD: [`../../database/erd/phase-1-6-crm.mmd`](../../database/erd/phase-1-6-crm.mmd)
- Authorization basis: [`../../governance/standing-technical-authorization-policy.md`](../../governance/standing-technical-authorization-policy.md)
