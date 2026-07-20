# Phase 1-11 — Roll-Forward-Only Recovery Note

**Requirement:** P1-11-DB-022, P1-11-DO-001 (financial tables default to roll-forward
only); acceptance criterion 1.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## Why roll-forward-only

Financial and custody facts are **evidentiary**: an issued invoice, a recorded receipt, an
allocation, an approved credit note or reversal, a `financial_events` row, a delivered
custody release, and an issued warranty are auditable source facts (RSK-04, RSK-18,
NFR-DAT-003). A down-migration that dropped or rewrote these tables would destroy audit
history and could silently change a reconciled balance. Therefore, once any financial or
custody row exists, the owning migration is **not** rolled back.

## The rule

- **Corrections are new forward migrations, never edits.** Any change to a merged P1-11
  migration is a new `ALTER`/additive migration with a later timestamp — mirroring
  `…090000`'s additive backstop on `rec.custody_history` and P1-10's `…097000` forward FKs.
- **Business corrections are linked records, not deletes.** An over-charged invoice is
  corrected by a **credit note**; a mistaken receipt by a **receipt reversal**; a wrong
  delivery/warranty by a status transition — all append-only or immutable-after-approval.
  No application role holds DELETE on any financial or custody table.
- **The append-only ledgers never mutate.** `financial_events`, the three status histories,
  `payment_allocations`, and `delivery_signatures` have SELECT+INSERT grants only.

## From-zero recovery is still proven

Roll-forward-only does **not** mean un-rebuildable. The clean-room / rollback suite
(`p1-11-rollback`) applies all seven migrations from an empty database and asserts the
target schema, with every business table empty (only the platform payment-method reference
seeded). Disaster recovery is therefore **restore-from-backup + roll-forward**, not
down-migration; financial tables anchor the RPO evidence that lands at the Phase 1-12
integration gate (P1-11-DO-002).

## Classification

`…090000` and `…096000` are rollback-safe while unused (namespace / reporting config).
`…091000`–`…095000` are **roll-forward-only** once their financial/custody rows exist. See
[phase-1-11-migration-classification.md](phase-1-11-migration-classification.md).
