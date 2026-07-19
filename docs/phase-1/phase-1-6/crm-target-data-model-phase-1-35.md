# Phase 1-6 — CRM Target Data Model (Forward Look through Phase 1-35)

> **Status: FORWARD-LOOKING ARCHITECTURAL FORECAST — NON-BINDING.**
> This document describes the direction the Phase 1-6 CRM foundation is _shaped to accept_. It is
> not a scope commitment. Except where a phase is named in the Phase 1-6 facts digest, **any future
> phase number below is illustrative, not committed.** Nothing here changes the delivered Phase 1-6
> schema. Product: `[PRODUCT NAME — Pending Final Approval]`. Company: RootLco — Root Link Company.

**Phase:** 1-6 — CRM and Business Partner Database.
**Owner gate:** **Pending** (the feature PR is not yet open or merged; this is not a Go).
**Authorship:** Authored under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md); the applicable review is owner-authorized technical/security [self-review](../../governance/solo-developer-review-policy.md), not independent review.

---

## 1. Purpose

Phase 1-6 delivers a CRM and business-partner foundation, not a finished CRM. This note records how the
delivered structure is intended to grow so that later phases extend it _additively_ — new tables, new
columns, new application-layer rules — rather than by breaking-change migrations against live tenant data.
It is written so a future engineer can see which extensions the current shape already anticipates and why
those extensions are expected to be safe. It commits nothing.

---

## 2. What exists now — the 21-table foundation

Twenty-one tables, all `ENABLE` + `FORCE ROW LEVEL SECURITY`, grouped by domain (see
[`crm-object-inventory.md`](./crm-object-inventory.md) for exact counts and the
[ERD](../../database/erd/phase-1-6-crm.mmd) for relationships):

- **Party master** — `business_partners`: the tenant-scoped party root, with a server-issued display number and block/merge guards.
- **Profiles / identity** — `individual_profiles`, `company_profiles`, `partner_sensitive_attributes`, `partner_identifiers`: party-type-specific detail, sensitive attributes, and typed external identifiers.
- **Roles / segments** — `partner_roles` (temporal, `EXCLUDE`-guarded), `customer_segments`, `partner_segment_assignments`: what a party _is_ over time and which segments it belongs to.
- **Lifecycle / restrictions** — `partner_status_history` (append-only), `customer_restrictions`, `customer_block_history`: status transitions, active restrictions, and block audit.
- **Contact / consent** — `contact_points`, `addresses`, `communication_preferences`, `consent_history` (append-only): how to reach a party and the consent basis for doing so.
- **Commercial / alerts** — `customer_alerts`, `customer_credit_profiles`: operational flags and credit posture.
- **Duplicates / merge** — `duplicate_candidates`, `partner_merges`: the raw material and the record of survivorship.
- **Communication / timeline** — `communication_log`, `timeline_events` (append-only): interaction records and the sanctioned party timeline.

Behind these sit **12 CRM functions** — all `SECURITY INVOKER`, `search_path=''`, with `EXECUTE` revoked from
`PUBLIC` — covering deterministic search-key normalization, consent resolution, temporal role lookup, merge
survivor resolution, and the write-time guard/stamp triggers. There are **zero `SECURITY DEFINER`** objects.
CRM ships **zero business rows and zero structural-reference rows** ([no-fake-data](../../database/no-fake-data-standard.md) verdict, DB-024).

---

## 3. Known future extensions the foundation is shaped to accept

Each item below is an extension the current shape can absorb without a breaking change. Phase attributions
follow the rule in the banner: **1-16 is named in the digest; everything else is illustrative.**

### 3.1 Forensic audit trail — Phase 1-16 (named)

Today the DB-layer attributable record is the **append-only history/timeline tables** (`partner_status_history`,
`consent_history`, `customer_block_history`, `timeline_events`) — server-stamped, `SELECT`+`INSERT` only, with
`UPDATE`/`DELETE` rejected as `42501`. The privileged `iam.audit_append` sink is deliberately **not granted to
the app roles**, so a separate forensic audit trail is out of Phase 1-6 scope. The append-only/timeline pattern
already in place is the seam a forensic trail plugs into: the same "emit an immutable, ordered event" discipline
(embodied by `emit_timeline_event`, the only sanctioned writer into `timeline_events`) extends to a
cross-cutting audit sink without reshaping the CRM tables.

### 3.2 Write-path invariants move into the application layer — Phase 1-16 (named)

Some invariants are intentionally _not_ enforced at the DB layer. The clearest is that a profile's identifier
`_ref` foreign key enforces existence, tenant, and same-partner — but **not** `identifier_type` correctness
(accepted residual finding #4). Type-correctness of that reference, and richer status-**transition** rules
beyond the no-op guard `CHECK (from_state IS DISTINCT FROM to_state)`, are designated Phase-1-16 write-path
invariants. The foundation is shaped to accept them because the DB layer already enforces the _structural_
half (existence, tenant, partner, distinctness), leaving a well-defined application-layer contract to layer on
top rather than a schema change.

### 3.3 Party model → households and organizational hierarchies (illustrative)

`business_partners` is a single tenant-scoped party root with a `party_type` discriminator. Party-to-party
structure (a household grouping several individuals; an organizational parent/child hierarchy) is a natural
additive extension: a future self-referential association table, keyed on the same composite tenant identity
and `ON DELETE RESTRICT` composite FKs already used throughout, adds grouping without altering
`business_partners`. No such table exists in Phase 1-6.

### 3.4 Identifiers / profiles → more sensitive attribute types under the same gate (illustrative)

`partner_sensitive_attributes` is a typed, classification-gated store for sensitive facts (its `value_text` and
`value_date` are `restricted`). Adding further sensitive attribute types is an _insert of new type values_, not
a schema change — and every new column that carries sensitive data inherits the **same single gate**:
row-level `iam.has_permission('iam.sensitive.view')` against the `classification` column, with the CI
classification guard forcing an explicit classification on any new column. The restricted set today is the
national-ID / registration / tax identifiers plus date-of-birth (see
[`crm-classification-matrix.md`](./crm-classification-matrix.md)); it can grow under the same rule.

### 3.5 Roles / segments → scoring (illustrative)

`customer_segments` and `partner_segment_assignments` capture _membership_. A future scoring capability
(segment scores, propensity or value tiers) is additive: score columns or a companion scoring table hang off
the existing assignment keys. `partner_roles` already carries temporal validity via a btree_gist `EXCLUDE`
constraint, so time-bounded scoring reuses the same temporal machinery rather than inventing one.

### 3.6 Merge / duplicate machinery → automated de-duplication (illustrative)

Phase 1-6 ships the _primitives_: `duplicate_candidates` (raw pairs), `partner_merges` (the survivorship
record), `stamp_partner_merge` (server-stamping), `resolve_partner_survivor` (redirect resolution), and the
deterministic `normalize_name` / `normalize_email` / `normalize_phone` search keys that automated matching
would score against. Automated candidate generation, scoring, and auto-merge are **not** built. They are an
application/worker-layer extension over primitives that already exist, so the machinery does not need to be
redesigned to support automation later.

---

## 4. Design properties that make this safe to extend

The extensions above are expected to be additive because the foundation was built on a small set of load-bearing
invariants (see [`rls-standard.md`](../../database/rls-standard.md),
[`role-and-grant-standard.md`](../../database/role-and-grant-standard.md), and
[`transaction-and-concurrency-standard.md`](../../database/transaction-and-concurrency-standard.md)):

- **Composite tenant keys.** Every table carries `UNIQUE (tenant_id, id)` and every cross-table reference is a
  composite FK `(tenant_id, x) REFERENCES parent(tenant_id, id) ON DELETE RESTRICT`. New tables join the graph
  the same way; tenant isolation is a property of the _keys_, not of any single query.
- **Discriminator exclusivity.** Profile exclusivity is enforced by the discriminator key `(tenant_id, id, party_type)`,
  so a party is one type and its profile row cannot mismatch. New party-typed detail attaches through the same
  discriminator without ambiguity.
- **Classification registry as the single sensitive-data source of truth.** All 296 columns are classified in
  [`crm-personal-data-classification.json`](../../database/crm-personal-data-classification.json) and enforced in
  CI (`validate:crm-classification`). The guard fails on any unclassified column, any stale entry, any invalid
  value, and any column that is both `restricted` and `searchable`. A new sensitive column cannot ship
  unclassified — the registry, not scattered code, decides what is sensitive.
- **`FORCE` RLS, default-deny.** All 21 tables force RLS; the app roles are `NOBYPASSRLS`, non-superuser, and own
  zero CRM tables. Per-command policies (`sel_/ins_/upd_/del_<table>_<scope>`) are keyed on
  `iam.current_tenant_id()`. A new table is invisible until it, too, is given explicit policies — the safe
  default is _no access_ (see [`crm-rls-policy-matrix.md`](./crm-rls-policy-matrix.md) and
  [`crm-grant-matrix.md`](./crm-grant-matrix.md)).
- **Deterministic `seq` ordering.** Because `occurred_at`/`created_at` use `now()` (constant within a
  transaction), same-transaction ordering is carried by a monotonic `seq bigint GENERATED ALWAYS AS IDENTITY`
  (added to `customer_block_history` and `consent_history` in SEC hardening), not a random UUID tie-break.
  Any future append-only stream inherits a total order for free.

Full field-level detail is in [`crm-data-dictionary.md`](./crm-data-dictionary.md).

---

## 5. Explicit non-goals for Phase 1-6

Phase 1-6 deliberately does **not** deliver, and the closeout must not be read as delivering:

- **No forensic audit trail.** `iam.audit_append` is not granted to app roles; the append-only history/timeline
  tables are the DB-layer attributable record. A dedicated forensic trail is deferred (see §3.1).
- **No column-masking view or function.** The _only_ sensitive-data gate is the row-level
  `iam.has_permission('iam.sensitive.view')` check against `classification`. There is no masking layer.
- **No application-layer write-path invariants.** `identifier_type` correctness on the profile `_ref` and richer
  status-transition rules are deferred to the Phase-1-16 write path (accepted residual, see §3.2).
- **No automated de-duplication.** Only the merge/duplicate _primitives_ ship; candidate scoring and auto-merge
  are not built (see §3.6).
- **No households, hierarchies, or segment scoring.** These are illustrative future directions, not Phase 1-6
  structure (see §3.3, §3.5).
- **No new indexes and no data.** DB-022 concluded no hot-path FK lacks support (68 indexes live, none added);
  DB-024 confirms CRM ships zero business and zero structural-reference rows.

---

## 6. A note on phase numbering

Phase **1-16** appears above only because it is named in the authoritative Phase 1-6 facts digest for two
specific deferrals: the forensic audit trail and the application-layer write-path invariants. **Every other
phase reference in this document is illustrative and carries no committed scope.** The presence of a primitive
here (an append-only stream, a merge record, a classification registry) is evidence of _design intent to
extend_, not a schedule and not a promise. Committed scope for any future phase is established by that phase's
own planning artifacts, not by this forecast.

---

## 7. References

- Sibling matrices: [`crm-object-inventory.md`](./crm-object-inventory.md) · [`crm-rls-policy-matrix.md`](./crm-rls-policy-matrix.md) · [`crm-grant-matrix.md`](./crm-grant-matrix.md) · [`crm-classification-matrix.md`](./crm-classification-matrix.md) · [`crm-data-dictionary.md`](./crm-data-dictionary.md)
- ERD: [`phase-1-6-crm.mmd`](../../database/erd/phase-1-6-crm.mmd)
- Classification registry: [`crm-personal-data-classification.json`](../../database/crm-personal-data-classification.json)
- Standards: [`rls-standard.md`](../../database/rls-standard.md) · [`role-and-grant-standard.md`](../../database/role-and-grant-standard.md) · [`retention-and-sensitive-data-standard.md`](../../database/retention-and-sensitive-data-standard.md) · [`transaction-and-concurrency-standard.md`](../../database/transaction-and-concurrency-standard.md) · [`no-fake-data-standard.md`](../../database/no-fake-data-standard.md)
- Governance: [`standing-technical-authorization-policy.md`](../../governance/standing-technical-authorization-policy.md) · [`solo-developer-review-policy.md`](../../governance/solo-developer-review-policy.md)
