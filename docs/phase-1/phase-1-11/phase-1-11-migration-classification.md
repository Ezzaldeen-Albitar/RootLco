# Phase 1-11 — Migration Classification

Seven additive, forward-only migrations `20260724090000` … `20260724096000`; no merged
migration is edited. Each migration is classified by the change categories it contributes:
**schema** (new schema/table/column), **security** (RLS/policy/grant/restricted gating),
**function** (SECURITY INVOKER functions/triggers), **index** (FK-cover + query/gist/partial),
**reference** (FK to prior schemas / structural reference). **Financial tables are classified
roll-forward-only** (no down-migration once financial rows exist).

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

| Migration                      |    schema     |                  security                   |                                 function                                  |                             index                              |                                                               reference                                                               | Rollback class                                                 |
| ------------------------------ | :-----------: | :-----------------------------------------: | :-----------------------------------------------------------------------: | :------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------: | -------------------------------------------------------------- |
| `…090000_salwtyrpt_schemas`    | ✓ (3 schemas) |              ✓ (USAGE grants)               |                      — (no function; index-only, C1)                      |           ✓ (`uq_custody_history_released` additive)           |                                            ✓ (additive backstop on `rec.custody_history`)                                             | Rollback-safe while unused (namespace + additive rec backstop) |
| `…091000_sal_invoices`         | ✓ (5 tables)  | ✓ (RLS + `sal.finance.view` restricted 1:1) |       ✓ (invoice/line freeze + reconcile guards + `issue_invoice`)        | ✓ (one-live partial, number-iff-issued, idempotency, FK-cover) |  ✓ (`wo.work_orders`, `quo.quotation_revisions`, `crm.business_partners`, `org.tax_classes`, `shared.currencies`/`number_sequences`)  | Roll-forward-only once invoices exist                          |
| `…092000_sal_payments`         | ✓ (3 tables)  |         ✓ (whole-row finance gate)          |         ✓ (`record_receipt`, `allocate_receipt` + 3 derivations)          |               ✓ (number, idempotency, FK-cover)                |                                        ✓ (`sal.invoices`, `crm.business_partners`, `shared.*`)                                        | Roll-forward-only once receipts exist                          |
| `…093000_sal_financial_events` | ✓ (3 tables)  |       ✓ (append-only + finance gate)        |     ✓ (provenance + completeness guards + dual-control + `approve_*`)     |          ✓ (single-use source, idempotency, FK-cover)          |                                          ✓ (`sal.invoices`, `sal.receipts`, `org.branches`)                                           | Roll-forward-only once events exist                            |
| `…094000_sal_delivery`         | ✓ (6 tables)  |        ✓ (`sal.delivery.view` gate)         | ✓ (delivery coherence + authorized-receiver guards + `complete_delivery`) |          ✓ (one-live partial, idempotency, FK-cover)           | ✓ (`wo.work_orders`, `rec.reception_visits`/`custody_history`, `veh.vehicles`/`odometer_readings`, `crm`, `shared.document_versions`) | Roll-forward-only once deliveries exist                        |
| `…095000_wty_warranty`         | ✓ (5 tables)  |              ✓ (RLS/policies)               |               ✓ (warranty freeze guard + `issue_warranty`)                |           ✓ (2 gist EXCLUDE, idempotency, FK-cover)            |                                 ✓ (`sal.delivery_records`, `veh.vehicles`, `wo.work_orders`, `org.*`)                                 | Roll-forward-only once records exist                           |
| `…096000_rpt_reporting`        | ✓ (3 tables)  |         ✓ (owner-only + tenant RLS)         |           ✓ (report-version freeze + saved-filter scope guards)           |         ✓ (published partial, owner uniques, FK-cover)         |                                                 ✓ (`iam.permissions`, `org.tenants`)                                                  | Rollback-safe while unused                                     |

## Notes

- **Additive-only.** Every migration only adds objects; there is no destructive step and no
  down script (forward-only, per `docs/database/migration-standard.md`).
- **`…090000` is namespace + additive backstop.** It reserves the three schemas and adds the
  exactly-once custody-release backstop (`uq_custody_history_released`) on the pre-existing
  `rec.custody_history` (C1) — the same additive-forward pattern as P1-10's `wo` forward FKs;
  being an additive partial unique index it keeps every P1-8 suite green. A prototyped
  rec-forward delivery gate was **removed**; H-dlv-1 is an accepted residual (the delivery
  gates are enforced inside `sal.complete_delivery`).
- **Roll-forward-only for financial tables.** Once an invoice/receipt/allocation/credit/
  reversal/financial-event row exists, the owning migration is not rolled back; a correction
  is a new forward migration. See
  [phase-1-11-roll-forward-only-recovery-note.md](phase-1-11-roll-forward-only-recovery-note.md).
- **`main` untouched.** No migration edits a merged file; `origin/main` is unaffected.
