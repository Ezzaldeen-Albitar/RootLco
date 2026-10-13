# DBCR-P1-32-PRE-OD-FD6-001 — part lines on quotations at the authorised sales price, snapshotted

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner decision D6 of
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md) · **Owner:** Eng. Ezzaldeen
Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements the Owner's decision D6 of 2026-09-30; applying it to any existing database is
a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261005100000_quo_part_line_snapshots.sql` (the 170th)
- **Seed change:** none. **Permission change:** none — the two quotation writes keep
  `quo.quotation.manage` and `wo.work_order.read`; the builder offers a part line only to holders of
  the existing `inv.item.read`, which the part search needs. **Audit action:** none new.
- **Executable proof:** `tests/db/quo-part-line-snapshots.test.ts` (the six columns, two foreign keys
  and the guard exist; a service line still writes and carries no part column; a part line is
  accepted only at exactly the resolved branch, company or tenant-wide selling price with its row,
  currency, tax class and rate, never another branch's row; a typed figure, the less specific row, no
  price, an archived item, a wrong snapshot or rate are refused; the snapshot, unit price and rate
  are frozen while a description edit still goes through; a catalogue change leaves the written line
  as it was; a required part only of its own work order and item; a work-order invoice part line
  cannot be posted as a sale; a tenant-B session neither sees the line nor resolves the price),
  `tests/backend/od-quotation-part-lines.test.ts` (the routes end to end),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census) and
  `tests/db/foundation.test.ts` (function and trigger inventories).
- **Rollback classification:** **ROLLBACK-SAFE WHILE NO PART LINE EXISTS** — the inverse is in the
  migration footer; it refuses to run once a part line exists, because the snapshot columns are the
  only statement of the unit, the item's words and the price row a customer was quoted.

---

## 1. Why this change request exists

`quo.quotation_items` has admitted `item_kind = 'part'` with `item_ref` referencing
`inv.item_master` since `20260723096000`, but nothing wrote one: every line was a service priced from
`svc.price_rules`. Owner decision D6 asks for parts as explicit quotation lines at authorised sales
prices, never at inventory cost, each snapshotting quantity, unit, price, discount and tax treatment,
with no later catalogue substitution and no duplicate inventory movement on invoicing.

Quantity, discount, unit price and tax rate were already captured on every line. A part line also
needs the unit its quantity is in (`inv.item_master.uom_id` can change), the words it was quoted as,
the price row that priced it and the tax class that price named.

## 2. The change

| Object                            | Change                                                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quo.quotation_items` columns     | `item_sale_price_ref`, `quoted_item_sku`, `quoted_item_name`, `quoted_unit_code`, `quoted_unit_name`, `quoted_tax_class_ref`, all nullable and NULL on every service line.                                                                                     |
| Foreign keys and indexes          | `fk_quotation_items_sale_price` to `inv.item_sale_prices (tenant_id, id)` and `fk_quotation_items_tax_class` to `org.tax_classes (tenant_id, company_id, id)`, with `ix_quotation_items_sale_price` and `ix_quotation_items_tax_class`.                        |
| `quo.guard_quotation_part_line()` | New SECURITY INVOKER trigger function, `search_path` locked, EXECUTE revoked from PUBLIC. On INSERT a part line must match `inv.resolve_item_sale_price` exactly and carry the item's current words and unit; on UPDATE the snapshot and the price are frozen. |
| `tg_quotation_items_part_line`    | BEFORE INSERT OR UPDATE on `quo.quotation_items`.                                                                                                                                                                                                              |
| Policies, grants, tables, seeds   | None.                                                                                                                                                                                                                                                          |

### Why the database checks the price itself

The application resolves the price, but a part line is a customer-facing figure and D6 forbids a
cost or a typed price. The guard compares the captured unit price, currency, tax class and price row
with the resolver's own answer at the moment of writing, so no writer — the application included —
can store anything else. The tax rate is read exactly as `sal.create_counter_sale_invoice` reads it:
no class is a zero rate, and a class with no effective rate is refused.

### Why one source

`svc.price_rules.service_id` is NOT NULL with a foreign key to `svc.services`, and `svc.resolve_price`
takes a service id, so a price list cannot price an item. The item selling price is the only
authorised sales-price source for a part today. The application passes it through
`resolveAuthorisedPartPrice`, which refuses rather than chooses if two sources ever disagree; which
source would win is a pricing-policy question that stays open (CC-OD-47).

## 3. What the application does with it

`quo.quotation-create` and `quo.quotation-revision-create` accept `kind: 'part'` with `itemId` and an
optional `sourceRequiredPartRef`. The quotation module asks `@/modules/inventory` for the part
(`catalog.quotablePart`) and `@/modules/pricing` for the tax rate (`prices.taxRateFor`), checks the
quantity with the inventory quantity rules, measures the discount through the existing approval rule,
and writes the line with its snapshot. An item with no selling price for the branch is refused on the
line (`no_authorised_sale_price`); so are an archived item and one outside the caller's catalogue.

The quotation and invoice reads publish the part line's item and unit; the invoice reads the unit
through `source_quotation_item_id`, because `sal.invoice_lines` has no unit column. Issuing a
work-order invoice posts no stock (`issuePostsStock`), and `inv.guard_stock_movement_provenance`
already refuses a sale movement against a work-order invoice line.

## 4. The limitation this change does not remove

Tax remains blocked on the accounting questionnaire: a price with no tax class is still a zero rate,
and the open question about that (CC-OD-48) applies to part lines exactly as to services. Invoices
are not linked to part issues and unquoted part issues are not billed (D5/D15).

## 5. Measured effect

Measured on a database created empty in a throwaway `postgres:17` container on a loopback port of
its own, replayed through all 170 migrations with `npm run db:apply-migrations` and seeded twice with
`npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported, against the 169 baseline, exactly
  the migration count, `functions` 648 and `triggers` 641; `tables` 278, `policies` 805,
  `security_definer` 0 and 134 permissions hold;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- the database and backend tests named above passed on that disposable database. This is a local
  measurement; the hosted migration-replay, database and backend jobs re-prove it.

Nothing was written to the acceptance database. One read-only catalogue query
(`validate:schema-inventory`) was run once without the disposable port set and read the shared local
stack's schema totals; it wrote nothing and its result was discarded.

## 6. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 170, `schemaHash`, `structuralTotals`,
the 170 sentence of `migrationCountNote`, `functionCountDiscrepancyNote`, `structuralTotalsNote170`),
the P1-15 migration census, the `tests/db/foundation.test.ts` inventories,
`docs/database/data-dictionary.md`, `docs/database/svc-quo-inv-personal-data-classification.json`,
and the P1-27 migration-count records.

## 7. Upgrade of an existing database

The migration is forward-only and writes no row. The application change ships in the same pull
request. Applying the migration to the acceptance database happens later, through the established
backup, rehearsal on a restored copy and forward apply — not in this change.
