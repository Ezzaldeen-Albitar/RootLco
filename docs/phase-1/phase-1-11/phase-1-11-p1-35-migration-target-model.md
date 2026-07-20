# P1-35 Migration Target Model

The `sal`/`wty`/`rpt` schemas are delivered as **7 additive, forward-only** migrations
(`20260724090000` … `20260724096000`). This is a short note on the target-state contract a future
P1-35 migration-execution effort inherits. **No P1-35 execution is performed in this phase.**

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and the Standing Technical Authorization Policy — not an independent third-party review.

- **Additive, forward-only.** Each migration only adds objects; no merged migration is edited.
  There is no destructive step and no down script. `…090000` demonstrates the pattern: the
  exactly-once custody-release backstop (`uq_custody_history_released`) is added **additively**
  to the pre-existing `rec.custody_history` (like P1-10's `…097000` forward FKs), not by editing
  a merged P1-8 file.
- **Roll-forward-only for financial/custody tables.** Once an invoice/receipt/allocation/credit/
  reversal/financial-event/delivery/warranty row exists, the owning migration is not rolled back; a
  correction is a new forward migration or a linked correction record (credit note / receipt
  reversal). See
  [phase-1-11-roll-forward-only-recovery-note.md](phase-1-11-roll-forward-only-recovery-note.md).
- **Immutable once merged.** After the feature PR merges, the 7 migrations are immutable history;
  any change is a new forward migration.
- **From-zero apply proven.** The clean-room / rollback suite (`p1-11-rollback`) applies all 7
  migrations from an empty database and asserts the target schema, with every business table empty
  (only the platform payment-method reference seeded as structural reference).
- **Machine-checkable target state.** The classification registry
  (`sal-wty-rpt-personal-data-classification.json`, validated), the foundation allow-lists, the
  FK-index-cover and duplicate-index guards, and the money-precision scan are the target-state
  contract a P1-35 run reconciles against.
- **No `SECURITY DEFINER`.** The target state contains zero `SECURITY DEFINER` functions; a P1-35
  run must preserve that invariant.

Opening receivables and historical invoice decisions belong to the P1-35 migration evaluation
(full/partial/opening-data); the `financial_events` / opening structures give P1-35 a clean
landing point (plan §19).
