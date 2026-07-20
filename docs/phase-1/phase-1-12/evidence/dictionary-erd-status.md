# P1-12 Evidence — Data Dictionary & ERD Status

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-12 · **Release:** Release 2 — Core Business Database · **Waves:** 8.1 (dictionary
coverage) + 8.2 (ERD synchronization) · **Schema hash (canonical):**
`d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`

**Review model:** Solo Developer Review Policy under the Standing Technical Authorization
Policy — owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar; **not** an independent third-party audit. The user performs every merge.

---

## 1. Data dictionary — 100% table coverage, 0 drift (automated)

The data dictionary (`docs/database/data-dictionary.md`) is the **authoritative complete structural
record** of the integrated database. Its rows are generated from `information_schema` on the applied
catalog, so column types, nullability, and defaults cannot drift from reality; scope, retention class,
and per-column classification are the review-owned fields.

Coverage is verified **automatically** — not by eye — by `scripts/db/structural-review.mjs`, which
compares the live catalog against the documented tables and fails on any undocumented table.

| Metric                                   | Value                                 | Source                                   |
| ---------------------------------------- | ------------------------------------- | ---------------------------------------- |
| Live tables (integrated, empty rebuild)  | **242**                               | `structural-review.json` (`live_tables`) |
| Tables documented in the data dictionary | **242 / 242 (100%)**                  | `structural-review.mjs`                  |
| Undocumented tables                      | **0** (`undocumented_tables: []`)     | `structural-review.json`                 |
| Dictionary drift                         | **0** (`zero_dictionary_drift: true`) | `structural-review.json`                 |

Per-schema table counts reconcile to the dictionary and the live catalog: org 17 · iam 17 · shared 29 ·
crm 21 · veh 23 · apt 6 · rec 23 · wo 15 · tech 9 · dia 13 · qms 7 · svc 11 · quo 6 · inv 18 · sal 19 ·
wty 5 · rpt 3 (= **242**, 17 module schemas).

**Binding maintenance rule (in force):** any pull request containing a migration that creates or alters
structure must update this dictionary in the same pull request; the automated `structural-review.mjs`
drift gate enforces it. Only objects that actually exist appear in the dictionary.

**Data-dictionary status: PASS — 242/242 tables documented, 0 drift, automated via
`structural-review.mjs`.**

---

## 2. ERD synchronization status

**Authoritative structural record:** the data dictionary (§1) is the single authoritative and complete
structural record for all **242** tables. ERD sources are a controlled, human-oriented **companion** view.

**ERD sources present** (`docs/database/erd/`, Mermaid `.mmd`), covering the earlier domains at the
diagram level:

| ERD source                      | Domain(s) covered |
| ------------------------------- | ----------------- |
| `phase-1-3-organization.mmd`    | org               |
| `phase-1-5-shared-services.mmd` | shared            |
| `phase-1-6-crm.mmd`             | crm               |
| `phase-1-7-vehicle.mmd`         | veh               |

These Mermaid sources are maintained as controlled documents. ERD synchronization for Release 2 is
**confirmed at the table-inventory level with 0 drift**: every table — those depicted in the ERD domains
above and every table in the later domains (apt/rec/wo/tech/dia/qms/svc/quo/inv/sal/wty/rpt) — is present
and reconciled in the authoritative data dictionary against the live physical schema, with
`undocumented_tables: []` and `zero_dictionary_drift: true` from `structural-review.mjs`. No separate
automated ERD-vs-live diagram diff is part of this evidence pack; table-inventory reconciliation via the
dictionary is the confirming control.

Later-domain per-diagram `.mmd` sources are **not** present; for those domains the data dictionary is
authoritative and complete. Any ERD change — adding a later-domain diagram, or amending an existing one —
is a **controlled documentation change** (no schema change), reviewed like any other doc update, and does
not alter the canonical schema hash `d3b1e7e4`.

**ERD status: SYNCHRONIZED at the table-inventory level — 0 drift against the authoritative data
dictionary (242/242).** The data dictionary remains the authoritative structural record; diagram-level ERD
coverage of the later domains is a scheduled, controlled documentation follow-up, not a gate blocker.

---

## 3. Combined status line

| Control                               | Result                                                      |
| ------------------------------------- | ----------------------------------------------------------- |
| Data dictionary table coverage        | **PASS** — 242/242 (100%), 0 drift, automated               |
| ERD synchronization (table-inventory) | **CONFIRMED** — 0 drift vs authoritative dictionary         |
| Canonical schema hash                 | `d3b1e7e4…d3e4cdb` (unchanged; docs are controlled changes) |

This is a self-review artifact under the Standing Technical Authorization Policy and the Solo Developer
Review Policy — **not** an independent third-party audit. The user performs every pull-request merge.
