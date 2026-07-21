# P1-12 Evidence — Data Classification Report

**Phase:** P1-12 — Release 2 Database Gate · **Wave 4.4 (Security / Privacy stream).**
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).
**Schema hash (sha256):** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.

> **Governance / self-review note.** Owner-authorized technical, QA, security, and
> adversarial **self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
> Policy and the Standing Technical Authorization Policy. This is **not** an independent
> third-party audit. Every figure below traces to actual execution; the user performs all
> merges.

## Objective

Prove that the data-classification registers reconcile against the live schema, that
`restricted` columns are counted and gated by permission, and that `restricted` columns are
never exposed through the searchable projection.

## Evidence

Source: the **6 module classification validators**, run against the empty rebuild. **All 6
reconcile the classification register versus the live schema** (no drift between registered
and materialized classification).

| Classification validator (module group) |   Columns | `restricted` | Searchable |
| --------------------------------------- | --------: | -----------: | ---------: |
| crm                                     |       298 |            7 |          — |
| veh                                     |       320 |            2 |          6 |
| apt-rec                                 |       454 |            4 |          — |
| wo-tech-dia-qms                         |       657 |            3 |          — |
| svc-quo-inv                             |       582 |            3 |          — |
| sal-wty-rpt                             |       427 |           16 |          — |
| **Total**                               | **2,738** |       **35** |            |

**Restricted is not searchable.** In every validator the `restricted` columns are excluded
from the searchable projection (illustrated by veh, where 2 restricted columns coexist with
6 searchable columns and the two sets do not intersect). No `restricted` column is reachable
through search.

**Gated by permission.** Access to restricted/sensitive data is by explicit permission, not
by role name; the IAM sensitive-data permission model (`iam.sensitive_data_permissions`,
P1-04-DB-011) separates `view`, `export`, and `mask_override` as distinct permission kinds
(a `view` permission does not confer `export`).

## Status

**PASS.** All 6 classification validators reconcile register vs live; per-module restricted
counts recorded (35 restricted columns total across the 6 module groups); restricted columns
are not searchable and are gated by permission. No remediation required.
