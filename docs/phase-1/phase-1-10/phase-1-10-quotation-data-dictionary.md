# Phase 1-10 — Quotation Data Dictionary (`quo`)

Column-level dictionary for the six quotation tables in
`supabase/migrations/20260723096000_quo_quotations.sql`. Money is `NUMERIC(18,4)`;
quantity is `NUMERIC(12,3)`; captured tax rate is `NUMERIC(9,6)`. All tables are
branch-scoped, `ENABLE`+`FORCE` RLS. The three ledgers (`approval_decisions`,
`approval_evidence`, `quotation_status_history`) are append-only (SELECT+INSERT).

## `quo.quotations` — master

| Column                     | Type | Null | Notes                                                                                                                                                          |
| -------------------------- | ---- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | uuid | no   | PK; `UNIQUE(tenant_id, company_id, branch_id, id)`                                                                                                             |
| `tenant_id`                | uuid | no   | FK → `org.tenants(id)` RESTRICT                                                                                                                                |
| `company_id` / `branch_id` | uuid | no   | branch scope                                                                                                                                                   |
| `work_order_id`            | uuid | no   | Composite FK → `wo.work_orders(tenant_id, company_id, branch_id, id)` RESTRICT (WO-origin)                                                                     |
| `quotation_number`         | text | no   | **Immutable**; allocated by `shared.next_display_number('quotation', company, branch)`; `UNIQUE(tenant_id, company_id, branch_id, quotation_number)` (partial) |
| `currency_code`            | text | no   | **Immutable**; FK → `shared.currencies(code)` RESTRICT                                                                                                         |
| `payer_partner_ref`        | uuid | yes  | opaque payer reference                                                                                                                                         |
| `current_revision_id`      | uuid | yes  | repointed atomically by `quo.issue_revision`                                                                                                                   |
| `status`                   | text | no   | `draft`\|`active`\|`accepted`\|`rejected`\|`expired`\|`cancelled`, default `draft`                                                                             |

Status changes emit `quo.quotation_status_history` (`emit_quotation_status_history`
AFTER UPDATE).

## `quo.quotation_revisions` — immutable numbered revisions (FR-QUO-001)

| Column                               | Type          | Null | Notes                                                                                                  |
| ------------------------------------ | ------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| `id`                                 | uuid          | no   | PK; `UNIQUE(tenant_id, company_id, branch_id, id)` — the forward-FK target for `wo.customer_approvals` |
| `tenant_id`/`company_id`/`branch_id` | uuid          | no   | denormalized scope                                                                                     |
| `quotation_id`                       | uuid          | no   | Composite FK → `quo.quotations(...)` RESTRICT                                                          |
| `revision_number`                    | integer       | no   | `> 0`; `UNIQUE(tenant_id, company_id, branch_id, quotation_id, revision_number)`                       |
| `status`                             | text          | no   | `draft`\|`issued`\|`superseded`\|`rejected`\|`expired`, default `draft`                                |
| `currency_code`                      | text          | no   | **Immutable**; FK → `shared.currencies(code)`                                                          |
| `issued_at`                          | timestamptz   | yes  | CHECK `status='draft' OR issued_at IS NOT NULL`                                                        |
| `expires_at`                         | timestamptz   | yes  | optional                                                                                               |
| `captured_subtotal`                  | numeric(18,4) | no   | default 0                                                                                              |
| `captured_discount_total`            | numeric(18,4) | no   | default 0                                                                                              |
| `captured_tax_total`                 | numeric(18,4) | no   | default 0                                                                                              |
| `captured_grand_total`               | numeric(18,4) | no   | CHECK `= subtotal - discount + tax`; all `>= 0`                                                        |

`UNIQUE(tenant_id, quotation_id) WHERE status='issued' AND deleted_at IS NULL` — at
most **one issued revision** per quotation. `quo.issue_revision` recomputes captured
totals from the items, forbids a zero-item issue, supersedes the prior issued
revision, and repoints `current_revision_id` — all under the parent-quotation `FOR
UPDATE` lock.

## `quo.quotation_items` — captured lines (frozen once issued)

| Column                               | Type          | Null | Notes                                                                                          |
| ------------------------------------ | ------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `id`                                 | uuid          | no   | PK; `UNIQUE(tenant_id, company_id, branch_id, quotation_revision_id, id)` (decision-FK target) |
| `tenant_id`/`company_id`/`branch_id` | uuid          | no   | scope                                                                                          |
| `quotation_revision_id`              | uuid          | no   | Composite FK → `quo.quotation_revisions(...)` RESTRICT                                         |
| `line_number`                        | integer       | no   | `> 0`; unique per revision                                                                     |
| `item_kind`                          | text          | no   | `service`\|`part`                                                                              |
| `service_id`                         | uuid          | yes  | Composite FK → `svc.services(tenant_id, id)` RESTRICT                                          |
| `item_ref`                           | uuid          | yes  | Composite FK → `inv.item_master(tenant_id, id)` RESTRICT                                       |
| `source_service_line_ref`            | uuid          | yes  | opaque link to `wo.work_order_service_lines`                                                   |
| `source_required_part_ref`           | uuid          | yes  | opaque link to `wo.required_parts`                                                             |
| `price_rule_ref`                     | uuid          | yes  | opaque `svc.price_rules` reference (captured, not FK)                                          |
| `description`                        | text          | yes  | CHECK `service_id IS NOT NULL OR item_ref IS NOT NULL OR description IS NOT NULL`              |
| `currency_code`                      | text          | no   | must equal the revision currency (guard)                                                       |
| `captured_unit_price`                | numeric(18,4) | no   | `>= 0`                                                                                         |
| `captured_quantity`                  | numeric(12,3) | no   | `> 0`                                                                                          |
| `captured_discount`                  | numeric(18,4) | no   | `>= 0` and `<= unit_price * quantity`                                                          |
| `captured_tax_rate`                  | numeric(9,6)  | no   | `0..1` fraction, default 0                                                                     |
| `captured_tax_amount`                | numeric(18,4) | no   | CHECK `= round((unit*qty - discount) * rate, 4)`                                               |
| `captured_line_total`                | numeric(18,4) | no   | CHECK `= round(unit*qty - discount + tax, 4)` and `>= 0`                                       |

Frozen against INSERT/UPDATE/DELETE while the parent revision is not `draft`
(`guard_quotation_item`). A `DEFERRABLE INITIALLY DEFERRED` constraint trigger
(`guard_revision_totals`) re-asserts, at commit, that an issued revision's captured
totals equal the sum over its items.

## `quo.approval_decisions` — item-granular append-only (BR-QUO-001/002)

| Column                                        | Type        | Null | Notes                                                                                                                 |
| --------------------------------------------- | ----------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                                          | uuid        | no   | PK                                                                                                                    |
| `tenant_id`/`company_id`/`branch_id`          | uuid        | no   | scope                                                                                                                 |
| `quotation_revision_id` + `quotation_item_id` | uuid        | no   | **Single composite FK** → `quo.quotation_items(tenant_id, company_id, branch_id, quotation_revision_id, id)` RESTRICT |
| `decision`                                    | text        | no   | `approved`\|`rejected`                                                                                                |
| `decided_by`                                  | uuid        | no   | deciding party                                                                                                        |
| `decision_channel`                            | text        | no   | `in_person`\|`phone`\|`portal`\|`email`\|`system`                                                                     |
| `decided_at`                                  | timestamptz | no   | default `now()`                                                                                                       |
| `evidence_ref`                                | uuid        | yes  | optional evidence reference                                                                                           |
| `seq`                                         | bigint      | no   | `GENERATED ALWAYS AS IDENTITY`                                                                                        |

`UNIQUE(tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id)` —
exactly one authoritative decision per revision-item. Append-only (no UPDATE/DELETE
grant); a change of mind requires a new revision. `quo.record_item_decision` records
only against the **current issued** revision (re-read under the parent lock).

## `quo.approval_evidence` — document-bound append-only

| Column                               | Type   | Null | Notes                                                                                                                            |
| ------------------------------------ | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                 | uuid   | no   | PK                                                                                                                               |
| `tenant_id`/`company_id`/`branch_id` | uuid   | no   | scope                                                                                                                            |
| `approval_decision_id`               | uuid   | no   | FK → `quo.approval_decisions(id)` RESTRICT                                                                                       |
| `evidence_kind`                      | text   | no   | `document`\|`verbal`\|`portal`\|`email`                                                                                          |
| `document_version_id`                | uuid   | yes  | Composite FK → `shared.document_versions(tenant_id, id)` RESTRICT; CHECK `(kind='document') = (document_version_id IS NOT NULL)` |
| `reference_note`                     | text   | yes  | not blank if present                                                                                                             |
| `seq`                                | bigint | no   | `GENERATED ALWAYS AS IDENTITY`                                                                                                   |

Document evidence binds an **exact immutable** `shared.document_versions` row — no
substitution.

## `quo.quotation_status_history` — append-only ledger

| Column                               | Type        | Null | Notes                                                                                    |
| ------------------------------------ | ----------- | ---- | ---------------------------------------------------------------------------------------- |
| `id`                                 | uuid        | no   | PK                                                                                       |
| `tenant_id`/`company_id`/`branch_id` | uuid        | no   | scope                                                                                    |
| `quotation_id`                       | uuid        | no   | Composite FK → `quo.quotations(...)` RESTRICT                                            |
| `from_status`                        | text        | yes  | prior status                                                                             |
| `to_status`                          | text        | no   | new status                                                                               |
| `reason`                             | text        | yes  | not blank if present                                                                     |
| `actor_id`                           | uuid        | no   | server-stamped                                                                           |
| `occurred_at`                        | timestamptz | no   | server-stamped                                                                           |
| `correlation_id`                     | uuid        | yes  | optional                                                                                 |
| `seq`                                | bigint      | no   | `GENERATED ALWAYS AS IDENTITY`; ordered `(scope, quotation, occurred_at DESC, seq DESC)` |
