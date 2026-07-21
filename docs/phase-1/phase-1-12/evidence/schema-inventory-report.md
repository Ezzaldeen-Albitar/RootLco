# P1-12 Evidence — Schema Inventory Report (Wave 2)

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 (final Database Development Group gate) · **Review stream:** Structural ·
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

## Governance / self-review note

Owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy. This is a solo-developer self-review, **not** an independent
third-party audit. The user (owner) performs all merges. Every figure below traces to
actual execution against the live integrated database; no numbers are fabricated or
extrapolated. Machine-readable source: `evidence/structural-review.json`,
`evidence/upgrade-matrix.json`, and `evidence/environment-manifest.md`.

## Purpose

Establish the single authoritative inventory of the complete integrated database produced
by Phases P1-2…P1-11, captured from an empty rebuild (`supabase db reset` from empty). This
inventory is the reference object for every downstream structural, security, and drift
review in the P1-12 gate. P1-12 introduces **no new business domain**.

## Live integrated inventory

Captured from the live schema after clean migration; verified against the canonical schema
hash reproduced by the phase-boundary upgrade matrix.

| Metric                         | Value                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Module schemas                 | **17**                                                             |
| Tables                         | **242**                                                            |
| Columns                        | **3562**                                                           |
| Functions                      | **210**                                                            |
| Triggers                       | **539**                                                            |
| Policies (RLS)                 | **585**                                                            |
| Indexes                        | **999**                                                            |
| Constraints                    | **1843**                                                           |
| Views                          | **0**                                                              |
| `SECURITY DEFINER` functions   | **0**                                                              |
| RLS tables not `FORCE`-enabled | **0**                                                              |
| Canonical schema hash (sha256) | `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb` |

Short hash reference: `d3b1e7e4`.

## Per-schema table distribution

The 17 module schemas account for all 242 tables (no unaccounted objects):

| Schema | Tables | Schema | Tables | Schema    |  Tables |
| ------ | -----: | ------ | -----: | --------- | ------: |
| org    |     17 | rec    |     23 | inv       |      18 |
| iam    |     17 | wo     |     15 | sal       |      19 |
| shared |     29 | tech   |      9 | wty       |       5 |
| crm    |     21 | dia    |     13 | rpt       |       3 |
| veh    |     23 | qms    |      7 |           |         |
| apt    |      6 | svc    |     11 |           |         |
|        |        | quo    |      6 | **Total** | **242** |

## Provenance — cumulative growth across phase boundaries

The inventory is reproducible: the phase-boundary upgrade matrix
(`evidence/upgrade-matrix.json`) confirms every P1-2…P1-11 boundary upgrades to the same
canonical hash `d3b1e7e4`, with cumulative table counts progressing
**0 → 22 → 41 → 63 → 84 → 107 → 136 → 180 → 215 → 242** (byte-identical structural
equivalence, `all_pass = true`, 10/10 boundaries).

## Structural-review gate outcomes bound to this inventory

From `evidence/structural-review.json` over the 242 live tables:

- **537 foreign keys** — all validated, all index-covered (see `fk-review-report.md`).
- **999 indexes** — 0 true duplicates (see `index-review-report.md`).
- **Dictionary drift** — 0 (242/242 tables documented; see `dictionary-drift-report.md`).
- **0 views · 0 `SECURITY DEFINER` · 0 RLS tables not `FORCE`-enabled** — all 242 tables
  `ENABLE` + `FORCE` RLS; the runtime role owns no schema objects.

## Status

**PASS.** The live integrated inventory is authoritative, complete (242/242 tables
attributed to the 17 module schemas), and byte-for-byte reproducible at canonical hash
`d3b1e7e4`. No views, no `SECURITY DEFINER` functions, and no unforced-RLS tables exist.
Zero unresolved Critical or High findings for this review.
