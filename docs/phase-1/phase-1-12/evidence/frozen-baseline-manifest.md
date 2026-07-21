# P1-12 Frozen Baseline Manifest — Release 2 Database Baseline

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

**Governance / self-review note.** This is the human-readable wrapper of the machine-readable
`evidence/frozen-baseline-manifest.json`, produced by `scripts/db/baseline-manifest.mjs` during
an owner-authorized **self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and Standing Technical Authorization Policy — **not** an independent third-party audit. The
JSON is authoritative; every figure below is copied from it. The manifest is deterministic and
**excludes the source SHA**, so it reproduces byte-identically across the feature commit and the
gate commit.

## Baseline identity

| Field                    | Value                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Release                  | Release 2 — Core Business Database                                 |
| Phase                    | P1-12                                                              |
| Source SHA               | `5cd16da9d5b82c3baa42146da02ef31dbc2e45d5`                         |
| Protected base           | `origin/develop` = `5cd16da` (P1-11 gate merge #45)                |
| PostgreSQL major         | 17                                                                 |
| **Schema hash (sha256)** | `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb` |
| **Baseline fingerprint** | `8968f66af6305273e60394e1fe66808d7ec90058e1bd0d96ee9cf6c32944df1e` |

The fingerprint is a deterministic digest over the 113 migration hashes + 7 seed hashes +
classification/dictionary hashes; it deliberately excludes the source SHA so it reproduces across
both the feature and gate merge commits.

## Content hashed into the baseline

| Set                      | Count   | Notes                                                                                                                                                                                                                                                 |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations               | **113** | All additive / forward-only; each carries a rollback-classification header; each SHA-256 hashed individually                                                                                                                                          |
| Seed files               | **7**   | `seed.sql`, `seeds/01_reference_data.sql`, `seeds/04_iam_permission_catalog.sql`, `seeds/05_shared_reference.sql`, `seeds/06_wo_job_state_graph.sql`, `seeds/07_inv_units_of_measure.sql`, `seeds/08_sal_payment_methods.sql` (numbering skips 02/03) |
| Classification registers | 6       | crm, veh, apt-rec, wo-tech-dia-qms, svc-quo-inv, sal-wty-rpt personal-data classification JSON                                                                                                                                                        |
| Data dictionary          | 1       | `docs/database/data-dictionary.md` hashed                                                                                                                                                                                                             |

## Integrated schema counts (empty rebuild — hash `d3b1e7e4`)

| Metric                       | Value |
| ---------------------------- | ----- |
| Module schemas               | 17    |
| Tables                       | 242   |
| Columns                      | 3562  |
| Functions                    | 210   |
| Triggers                     | 539   |
| Policies                     | 585   |
| Indexes                      | 999   |
| Constraints                  | 1843  |
| Views                        | 0     |
| `SECURITY DEFINER` functions | 0     |
| RLS tables not FORCE-enabled | 0     |

Per-schema tables: org 17 · iam 17 · shared 29 · crm 21 · veh 23 · apt 6 · rec 23 · wo 15 ·
tech 9 · dia 13 · qms 7 · svc 11 · quo 6 · inv 18 · sal 19 · wty 5 · rpt 3.

## Reproducibility evidence

- **Phase-boundary upgrade matrix:** 10/10 boundaries (P1-2…P1-11) upgrade to the **same** canonical
  schema hash `d3b1e7e4` (byte-identical structural equivalence); cumulative tables
  0 / 22 / 41 / 63 / 84 / 107 / 136 / 180 / 215 / 242. See `evidence/upgrade-matrix.json`.
- **Empty rebuild:** `supabase db reset` from empty reproduces the baseline; full suite 118 files /
  1141 tests green (201 s) at Wave 1.1 — reconfirmed post-merge at **119 files / 1149 tests** once
  the P1-12 integrated cross-domain suite was added in Wave 3 (see “Baseline registration —
  post-merge” below); seeds idempotent ×2 with business tables empty.
- **Backup/restore:** restore into a fresh DB reproduces schema hash `d3b1e7e4` with matching
  control totals (currencies 3, permissions 43, payment_methods 3). See
  `backup-evidence.md` and `restore-evidence.md`.

## Open decisions carried (not resolved by this baseline)

`P1-OD-007`, `P1-OD-018…024`, `P1-OD-027`, `P1-OD-035`, `P1-OD-036`, `P1-OD-041`, `P1-OD-042`
— tracked in `phase-1-12-traceability.md`; none blocks the baseline. `P1-OD-027` (NFR-SCL) governs
the still-PROPOSED performance targets.

## Tag plan

An **annotated** tag **`release-2-database-baseline`** is to be applied to the **protected P1-12
gate merge commit** — **after both the feature PR and the gate-record PR merge**, never before.
There is no pre-existing tag convention in the repository; this is the first baseline tag.

## Consolidated verification

The full baseline verification runs via `npm run gate:p1-12` (`scripts/db/gate-p1-12.mjs`), which
executes the required gate set in a controlled order and prints an evidence summary.

---

## Baseline registration — post-merge (recorded 2026-07-21)

The Release 2 database baseline is registered against **protected history**, not against a
feature branch:

| Field                                 | Value                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Feature PR                            | **#46** — merged into `develop`                                                                                         |
| Final feature SHA                     | `670000ea95ccd54ba716d359b6e4251abd149a41`                                                                              |
| Feature merge commit (protected)      | `42f8d7f7406c0f10c5612cc81aec97921cce1170` — parents `5cd16da` + `670000e`                                              |
| Protected tree of record              | `origin/develop` = `42f8d7f` (merge tree `ca4283db6510380a6f28fde3e8acbee02d83537d`, identical to the feature tree)     |
| **Schema hash (reconfirmed)**         | `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`                                                      |
| **Baseline fingerprint (reproduced)** | `8968f66af6305273e60394e1fe66808d7ec90058e1bd0d96ee9cf6c32944df1e`                                                      |
| Consolidated gate on the merged tree  | `npm run gate:p1-12` — **24 / 24 required gates PASSED**; `test:db` 119 files / 1149 tests green                        |
| Baseline tag                          | `release-2-database-baseline` — **planned, not yet created**; target is the **gate-record** merge commit, after closure |

The `source_sha` recorded inside `frozen-baseline-manifest.json` is the tree the manifest was
first generated from (`5cd16da`). Because the fingerprint deliberately **excludes** `source_sha`,
it reproduces byte-identically on the merged protected tree — as reconfirmed above — so the
registration is anchored to content, not to a commit identifier.

## Status

**FROZEN & REPRODUCIBLE — registered against protected history.** Schema hash `d3b1e7e4` and
baseline fingerprint `8968f66a` are stable across the feature commit, the feature merge commit,
and this gate commit, and are reproduced by every phase-boundary upgrade path and by restore. The
annotated tag is **planned**, to be applied only after both pull requests merge.
