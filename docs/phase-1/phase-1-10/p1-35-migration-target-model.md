# P1-35 Migration Target Model

The `svc`/`quo`/`inv` schemas are delivered as **8 additive, forward-only** migrations
(`20260723090000` … `20260723097000`). This is a short note on the target-state
contract a future P1-35 migration-execution effort inherits.

- **Additive, forward-only.** Each migration only adds objects; no merged migration is
  edited. There is no destructive step and no down script.
- **Immutable once merged.** After the feature pull request merges, the 8 migrations are
  immutable history; any change is a new forward migration, never an edit. The forward-FK
  migration (`…097000`) is itself the model: P1-09 references were resolved by an
  additive migration, not by editing a merged P1-09 file.
- **From-zero apply proven.** The clean-room / rollback test (`p1-10-rollback`) applies
  all 8 migrations from an empty database and asserts the resulting schema matches the
  target, with every business table empty (only the platform unit-of-measure catalog
  seeded as structural reference).
- **Machine-checkable target state.** The classification registry (validated by the
  `svc`/`quo`/`inv` classification validator), the foundation allow-lists, the
  FK-index-cover and duplicate-index guards, and the money-precision scan are the
  target-state contract a P1-35 run reconciles against.
- **No `SECURITY DEFINER`.** The target state contains zero `SECURITY DEFINER`
  functions; a P1-35 run must preserve that invariant.

**No P1-35 execution is performed in this phase.**
