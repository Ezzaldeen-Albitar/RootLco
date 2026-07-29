# P1-20 Wave 1 — Real contract archaeology

Everything below was read out of the **live protected catalog** at
`P1_20_BASE_SHA = 0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`, not from phase prose.
Where the prose and the catalog disagree, the catalog wins and the divergence is
recorded as a reconciliation.

## 1. Owned schemas

| Schema | Tables | Owner module (this phase)                                                                                                                                                  |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc`  | 11     | `service-catalog` (services, categories, versions, labour, branch availability) + `pricing` (price lists, versions, rules, assignments, discount rules, approval policies) |
| `quo`  | 6      | `quotation`                                                                                                                                                                |

`svc` is split across two modules by aggregate, not arbitrarily: the catalog
tables and the pricing tables share a schema but never a transaction, and the
pricing module is the only reader of `org.tax_*`.

## 2. Tables

### `svc`

- `service_categories` — self-parenting tree, `code ~ ^[a-z][a-z0-9_]{1,62}$`, cycle guard.
- `services` — `service_code` immutable, `lifecycle_status ∈ {active, archived}`, `archived_at` coupled to `archived` by CHECK.
- `service_versions` — `version_no > 0`, `status ∈ {draft, published, archived}`, gist EXCLUDE forbids overlapping **published** date ranges per service.
- `standard_labor_times` — hangs off **`service_version_id`**, `standard_minutes numeric(10,2) > 0`, optional `labor_code`, optional `skill_ref`.
- `branch_service_availability` — `(tenant, company, branch, service)` unique where not deleted; `is_available boolean` + `status ∈ {active, inactive}`.
- `price_lists` — `currency_code` **immutable**, `price_list_code` immutable.
- `price_list_versions` — `status ∈ {draft, published, archived}`, gist EXCLUDE on overlapping **published** ranges per list.
- `price_rules` — `amount numeric(18,4) >= 0`, optional `tax_class_id`, `priority >= 0`, specificity columns `company_id`/`branch_id`/`customer_class` all nullable.
- `price_list_assignments` — binds a list to `(company?, branch?, customer_class?)` with `priority` and an effective range.
- `discount_rules` — `discount_type ∈ {percentage, amount}`; percentage ⇒ `0..100` and `currency_code IS NULL`; amount ⇒ `>= 0` and `currency_code NOT NULL`.
- `pricing_approval_policies` — `policy_type ∈ {discount, quotation_total, price_override}`, `threshold_kind ∈ {percentage, amount}`, `required_permission_code`, `maker_approver_distinct boolean DEFAULT true`.

### `quo`

- `quotations` — **`work_order_id` is NOT NULL**; `status ∈ {draft, active, accepted, rejected, expired, cancelled}`; `quotation_number` unique per scope; `currency_code` and `work_order_id` immutable; `current_revision_id` nullable.
- `quotation_revisions` — `status ∈ {draft, issued, superseded, rejected, expired}`; four `captured_*` totals; `currency_code` immutable; **partial unique index `uq_quotation_revisions_one_issued`** allows at most one `issued` revision per quotation.
- `quotation_items` — `item_kind ∈ {service, part}`; the four `captured_*` money columns; per-line arithmetic CHECKs (§4).
- `approval_decisions` — append-only; `decision ∈ {approved, rejected}`; `decision_channel ∈ {in_person, phone, portal, email, system}`; **`uq_approval_decisions_item` makes one decision per `(scope, revision, item)` terminal**.
- `approval_evidence` — append-only; `evidence_kind ∈ {document, verbal, portal, email}`; `document` ⇔ `document_version_id IS NOT NULL`.
- `quotation_status_history` — written by trigger, not by hand.

## 3. Database functions P1-20 orchestrates

| Function                                                             | Contract as deployed                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc.resolve_price(service, company, branch, customer_class, as_of)` | Picks one assignment by specificity score `branch*4 + company*2 + class*1` DESC, then `priority` DESC, then `id`; then the published version covering `as_of`; then one `price_rule` by the same ordering. Returns `(price_rule_id, amount, currency_code, tax_class_id)` or **no row**. `STABLE`, tenant from `iam.current_tenant_id()`. |
| `svc.publish_service_version(service, version, effective_from)`      | Forward-only succession; gist EXCLUDE is the backstop.                                                                                                                                                                                                                                                                                    |
| `svc.publish_price_list_version(list, version, effective_from)`      | Same shape for price lists.                                                                                                                                                                                                                                                                                                               |
| `quo.issue_revision(revision, expires_at)`                           | Locks the parent quotation `FOR UPDATE`; requires `status = 'draft'`; **refuses zero items**; recomputes all four totals by SUM over live items; supersedes the prior `issued` revision; repoints `quotations.current_revision_id`; sets `quotations.status = 'active'`.                                                                  |
| `quo.record_item_decision(item, decision, channel, evidence)`        | Locks the parent quotation; requires the item's revision to be **both** `current_revision_id` **and** `status = 'issued'`; inserts one `approval_decisions` row with `decided_by = iam.current_user_id()`. Returns the decision id.                                                                                                       |

**What these functions do NOT do**, and the application therefore must:
expiry enforcement, idempotency, duplicate-decision conflict mapping, audit,
outbox, quotation-level `accepted`/`rejected` roll-up, and any authorization
beyond RLS.

## 4. The authoritative financial policy — derived, not invented

Read directly off the CHECK constraints on `quo.quotation_items` and
`quo.quotation_revisions`:

```
captured_tax_amount = round(((unit_price * quantity) - discount) * tax_rate, 4)
captured_line_total = round(((unit_price * quantity) - discount) + tax_amount, 4)
captured_grand_total = (subtotal - discount_total) + tax_total          -- exact, no rounding
0 <= captured_discount <= unit_price * quantity
0 <= captured_tax_rate <= 1
captured_unit_price >= 0 ; captured_quantity > 0 ; captured_line_total >= 0
```

and off `quo.issue_revision`:

```
subtotal       = SUM(unit_price * quantity)
discount_total = SUM(discount)
tax_total      = SUM(tax_amount)
grand_total    = SUM(line_total)
```

This settles, with no business decision required from us:

- **Tax is per line**, not per document.
- **Discount is applied before tax** — the tax base is `(unit * qty) - discount`.
- **Tax is exclusive**, since the line total _adds_ the tax amount.
- **Rounding is to 4 decimal places at the line**, using PostgreSQL `round(numeric, int)`, which is **half-away-from-zero**. Document totals are pure sums and are never re-rounded.
- **`tax_rate` is a fraction** in `[0, 1]`, `numeric(9,6)` — matching `org.tax_rates.rate`.

Scales in force: money `numeric(18,4)`, quantity `numeric(12,3)`, tax rate
`numeric(9,6)`, labour minutes `numeric(10,2)`.

## 5. Tax configuration

`org.tax_classes` (company-scoped, `tax_class_code`) and `org.tax_rates`
(`rate numeric(9,6)`, `effective_from`/`effective_to`). `svc.price_rules.tax_class_id`
points at a class, and `ck_price_rules_tax_needs_company` forbids a tax class on a
rule that is not company-scoped. **No jurisdiction, country, or default rate exists
anywhere in the catalog** — so none may be introduced. A service with no resolvable
rate is a deterministic failure, not a silent zero.

## 6. Write feasibility — proven, no change request needed

`app_runtime` holds `INSERT, SELECT, UPDATE` on all 11 `svc` tables and on
`quo.quotations`, `quo.quotation_revisions`, `quo.quotation_items`; and
`INSERT, SELECT` on the three append-only ledgers
(`approval_decisions`, `approval_evidence`, `quotation_status_history`).
`app_readonly` holds `SELECT` only, everywhere. No `DELETE` anywhere.
**No DBCR is required for P1-20 and no migration is authorized.**

## 7. Foundation already in place for this phase

- `shared-services/domain/sequence-registry.ts` registers sequence code
  `quotation` → `quo.quotations.quotation_number`.
- `shared-services/domain/attachment-policy.ts` already lists `quo.quotations`
  as an attachable target — approval evidence uses the P1-15 attachment service,
  never a client-supplied storage key.
- `wo.customer_approvals.quotation_revision_ref` is FK'd to
  `quo.quotation_revisions` and left NULL by P1-19. **That column is the whole of
  the BE-013 integration** — P1-20 fills it, and does not build a second approval
  source of truth.
- `iam.approval_limits (limit_type, amount numeric(18,4), currency_code, role_id, user_id)`
  is the ceiling referenced by `pricing_approval_policies`.

## 8. Reconciliations against the phase prose

| Prose                                                                                                  | Catalog reality                                                                                                                                     | Resolution                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /quotations/{id}:issue`, `:revise`, `/quotation-revisions/{id}:decide`                           | `PATH_PATTERN` in `operation-registry.ts` accepts only lower-case literal or `{camelCase}` segments — a `:action` suffix **cannot be registered**   | Use the shipped sub-resource-noun convention (`/transition`, `/closure`, `/approval` already exist): `/quotations/{quotationId}/issuance`, `/quotations/{quotationId}/revisions`, `/quotation-items/{itemId}/decision` |
| Decision applies to "one exact immutable revision"                                                     | `quo.record_item_decision` and `uq_approval_decisions_item` are keyed on the **item**                                                               | Decisions are **per item**, scoped to the current issued revision. The revision-level outcome is a derived roll-up, never a second stored truth                                                                        |
| Event names `pricing.price-list.published.v1`, `quotation.issued.v1`, `quotation.decision-recorded.v1` | Shipped `EVENT_CATALOG` uses unsuffixed dotted names with a separate `schemaVersion` field (`work-order.closed`, `job.state-changed`)               | Register unsuffixed names, `schemaVersion: 1`, per the instruction's own fallback rule                                                                                                                                 |
| Branch availability has an "effective period" and "overlap constraints"                                | `svc.branch_service_availability` has **no** effective-date columns; `uq_branch_service_availability_service` makes overlap structurally impossible | Availability is a single current row per `(company, branch, service)`. Recorded as an accepted limitation, not faked                                                                                                   |
| Standard labour time has a "branch override"                                                           | `svc.standard_labor_times` hangs off `service_version_id` only — **no branch column**                                                               | Labour time is per service version. No branch override exists; not invented                                                                                                                                            |
| Quotations may be standalone                                                                           | `quo.quotations.work_order_id` is **NOT NULL**                                                                                                      | Every quotation belongs to a work order. Creation takes a work order and derives company/branch from it                                                                                                                |
| "Currency conversion", "tax jurisdiction defaults", "payment terms"                                    | Nothing in the catalog                                                                                                                              | Out of scope, as the instruction also states                                                                                                                                                                           |

## 9. Exact-decimal mechanism

There is **no** decimal dependency in `package.json` and no existing decimal
utility. `pg` returns `numeric` (OID 1700) as a **string** by default, and the
repository never overrides that with `setTypeParser`.

The chosen mechanism, consistent with the instruction's fallback:

1. **PostgreSQL is the calculation engine.** Every authoritative amount is computed
   in SQL with `numeric` arithmetic in the same expression shape the CHECK
   constraints enforce, so the database validates its own output.
2. A narrowly scoped **`Decimal` value object backed by `bigint` scaled integers**
   (no new dependency) parses, validates scale, compares, and serializes. It never
   performs the authoritative money arithmetic and never converts through
   `number`.
3. Money crosses the API boundary as **decimal strings** with an explicit
   `currency` field.
