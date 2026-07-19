# P1-35 Migration Target Model

The `wo`/`tech`/`dia`/`qms` schemas are delivered as **16 additive, forward-only**
migrations (`20260722090000` … `20260722105000`). This is a short note on the
target-state contract a future P1-35 migration-execution effort inherits.

- **Additive, forward-only.** Each migration only adds objects; no merged migration
  is edited. There is no destructive step.
- **Immutable once merged.** After the feature pull request merges, the 16 migrations
  are immutable history; any change is a new forward migration, never an edit.
- **From-zero apply proven.** The clean-room / rollback test (`p1-09-rollback`)
  applies all 16 migrations from an empty database and asserts the resulting schema
  matches the target, with every business table empty (only the tenant-neutral state
  graph seeded).
- **Machine-checkable target state.** The classification registry
  (`docs/database/wo-tech-dia-qms-personal-data-classification.json`, validated by
  `scripts/check-wo-tech-dia-qms-classification.mjs`) and the foundation allow-lists
  are the target-state contract a P1-35 run reconciles against.

**No P1-35 execution is performed in this phase.**
