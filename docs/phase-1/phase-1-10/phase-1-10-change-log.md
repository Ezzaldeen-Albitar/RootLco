# Phase 1-10 — Change Log

Chronological by wave. All schema changes are additive and forward-only; no merged
migration was edited.

## Waves

| Wave | Theme                                                             | What landed                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Baseline                                                          | Cut `feature/p1-10-service-pricing-quotation-inventory-database` from `origin/develop` = `abd3362`; confirmed clean baseline (no `svc`/`quo`/`inv` objects).                                                                                                                          |
| 1    | Design gate + adversarial self-review                             | Fixed [phase-1-10-design.md](phase-1-10-design.md); ran a nine-lens adversarial self-review → 38 findings (2 C, 14 H, 20 M, 2 L), all resolved by binding amendment in [phase-1-10-review-response.md](phase-1-10-review-response.md); reserved the three module schemas (`…090000`). |
| 2    | Service catalog                                                   | `svc` categories/services/versions (gist EXCLUDE + succession)/labor/availability (`…091000`).                                                                                                                                                                                        |
| 3    | Pricing                                                           | `svc` price lists/versions/rules/assignments (single-book, `NULLS NOT DISTINCT`)/discounts/policies; `resolve_price` (`…092000`).                                                                                                                                                     |
| 4    | Inventory reference                                               | `inv` dual-scope UoM/item categories/item master (+restricted cost)/locations (`…093000`).                                                                                                                                                                                            |
| 5    | Inventory ledger                                                  | `inv` immutable movements (`signed_qty`, single-use), coherence-guarded balances, atomic reservations + primitives (`…094000`).                                                                                                                                                       |
| 6    | Inventory operations                                              | `inv` opening/adjustments (+restricted), issues/returns, damage, customer-supplied, external-purchase (+restricted); the movement provenance guard (`…095000`).                                                                                                                       |
| 7    | Quotation                                                         | `quo` quotations/revisions/items/decisions/evidence/status-history; `issue_revision`, `record_item_decision` (`…096000`).                                                                                                                                                             |
| 8    | Forward FKs                                                       | Resolve the three P1-09 opaque refs → `svc.services`/`inv.item_master`/`quo.quotation_revisions` additively (`…097000`).                                                                                                                                                              |
| 9    | Classification, isolation, concurrency, rollback, seed, CI, tests | Classification registry + validator; auto-enumerated security; isolation; concurrency; rollback/clean-room; platform UoM structural seed; no-fake-data schema list extended to `svc`/`quo`/`inv`; CI wiring; the P1-10 test suites.                                                   |
| 10   | Docs, clean-room, red-team                                        | This `docs/phase-1/phase-1-10/` package; clean-room from-zero apply; red-team pass; owner-gate record left **Pending** (feature PR not yet merged).                                                                                                                                   |

## Migrations (8, forward-only)

| Migration                   | Change                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `…090000_svcquoinv_schemas` | Reserve `svc`/`quo`/`inv` module schemas; USAGE grants to app roles                                                                                                                                                                                                                  |
| `…091000_svc_catalog`       | Service categories/services/versions (gist EXCLUDE, `publish_service_version` succession)/standard labor times/branch availability                                                                                                                                                   |
| `…092000_svc_pricing`       | Price lists/versions (published-immutable)/rules (`NULLS NOT DISTINCT`)/assignments/discounts/pricing-approval policies; `resolve_price`, `publish_price_list_version`                                                                                                               |
| `…093000_inv_reference`     | Dual-scope units of measure; item categories; item master (+restricted `item_cost_details`, `inv.cost.view`); stock locations                                                                                                                                                        |
| `…094000_inv_ledger`        | Immutable `stock_movements` (`signed_qty`, single-use); coherence-guarded `stock_balances`; `stock_reservations` + `post_stock_movement`/`reserve_stock`/`release`/`consume`/`expire`                                                                                                |
| `…095000_inv_operations`    | Opening inventory (+`approve_opening_batch`); stock adjustments (+restricted detail, +`approve_adjustment`); part issues/returns; damaged stock; customer-supplied parts; external-purchase parts (+restricted detail); the movement provenance guard; issue/return/damage functions |
| `…096000_quo_quotations`    | Quotations/revisions (single-issued)/items (per-line CHECKs + deferred totals trigger)/append-only decisions (composite FK)/document-bound evidence/status history; `issue_revision`, `record_item_decision`                                                                         |
| `…097000_wo_forward_fks`    | Additive FKs resolving `service_ref`/`item_ref`/`quotation_revision_ref` + covering indexes                                                                                                                                                                                          |

## Non-migration changes

- `docs/database/data-dictionary.md` — appended every `svc`/`quo`/`inv` table
  (restricted columns labelled).
- Classification registry for `svc`/`quo`/`inv` columns + validator + `npm run
validate:*` + a CI step.
- Platform unit-of-measure structural seed (registered in the seed-state
  `STRUCTURAL_REFERENCE` list and `config.toml`); the no-fake-data schema IN-list
  extended to `svc`/`quo`/`inv`.
- `tests/db/p1-10-helpers` cascade + platform-fixture cleanup; `foundation` /
  `org-security` allow-list registrations; the P1-10 test suites.
- `deleteTenantCascade` interleaving for the `wo ↔ quo` mutual reference.
- This `docs/phase-1/phase-1-10/` package.
