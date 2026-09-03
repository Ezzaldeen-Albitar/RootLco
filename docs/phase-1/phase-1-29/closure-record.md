# Phase 1-29 — Closure Record

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: CLOSED — W9 acceptance PASSED on a production build, 2026-09-02/03; the diagnostics closure condition satisfied on a real organization, 2026-09-03**

|                               |                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closed at                     | protected `develop` `c3c62398`, tree `ddfbde065c787c3ae8100dcb7498dc3f2820ee18`                                                                                |
| `main` at closure             | `25705d84` — unchanged at the moment of closure; promotion is a separate, separately recorded act (§5)                                                         |
| Acceptance                    | W9, by hand, on `next build` + `next start` of protected `develop` (`eb8c8763`), API `localhost:3000`, Web `localhost:3100`, Mailpit for every credential mail |
| Diagnostics closure condition | satisfied 2026-09-03 on the fresh organization `rootlco_w7` and re-proved on `rootlco_w7b` against `develop` `c3c62398` after the seed merged (§2)             |
| Last merge                    | PR #303, true merge `c3c6239855d7ff6df7ef59986827fa905e232739`, second parent `1cfcf983` (the reviewed head), merge tree identical to the reviewed tree        |
| Protected reproof             | `c3c62398`: 19 check-runs, all success                                                                                                                         |
| Internal defects open         | Critical 0 · High 0 (§3)                                                                                                                                       |

---

## 1. What closed, and on whose word

P1-29 delivered the Work Order, Diagnostics and Technicians Frontend against the Backend
contracts BR-01 … BR-09 that the PRE-P1-29 remediation and the P1-29 Backend lane put on
`develop` first. The canonical plan (`docs/phase-1/phase-1-29/canonical-plan.md`) owns the
definition of completion (§5 there) and this record answers it item by item (§4 here).

The phase closes on two acts, neither of which a count in this repository could derive:

- **The W9 acceptance**, taken by hand on 2026-09-02/03 against a production build of protected
  `develop` with a real platform operator, a real organization provisioned through the product, a
  real Owner invited through the shipped credential path, and eight personas holding only the
  permissions their roles carry. Recorded verbatim in
  `docs/phase-1/phase-1-29/w9-acceptance-record.md`. Verdict: **PASSED for W1, W2, W3, W4, W6, W7
  and W8**.
- **The Owner's decision of 2026-09-03 on W9-R4**: the empty diagnostic-type vocabulary was a
  missed P1-09 seed deliverable, to be repaired as one additive idempotent seed of ten
  tenant-neutral platform categories — no administration route, no permission code, no Frontend
  feature. The repair merged as PR #303, and the diagnostics experience the plan makes mandatory
  (§3 of the plan: `DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE` is the sentence that
  must never be true) was then exercised on a real organization through the shipped product path.

**Silence was never treated as Pass.** W7 was recorded as _present but not exercisable by a real
organization_ for as long as that was true, and the phase stayed open on that sentence until the
real experience succeeded.

## 2. What was accepted

### The nine work items, on `develop`

| item  | what it is                                                           | landed as                                       |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------- |
| W1    | the work-order board (`/work-orders`) with PC-1 on a real response   | PR #291, develop `129738b2`                     |
| W2    | the diagnostics closure condition recovered into the canonical plan  | PR #291                                         |
| W3    | the work-order detail (`/work-orders/[workOrderId]`)                 | PR #292, develop `e0599b29`                     |
| W4    | the technician workspace (`/technicians`, `/technicians/me`)         | PR #293, develop `c257d3e3`                     |
| W5    | the diagnostic-type read surface                                     | PR #294, develop `c66278d5`                     |
| W6    | work execution controls on the detail                                | PR #295, develop `e5a21fb6`                     |
| W7    | the diagnostics experience (seam #296, screens #298)                 | develop `6b278c82` then `95cfafac`              |
| W8    | quality and closure (seam #297, screens #299)                        | develop `47ae4f11` then `a419f497`              |
| W9    | the Owner bootstrap (genesis, First Owner) and the acceptance itself | PR #300 `06b79364`; findings PR #301 `eb8c8763` |
| W9-R4 | the platform diagnostic-type vocabulary (P1-09 seed obligation)      | PR #303, develop `c3c62398`                     |

### The diagnostics experience, on a real organization

On `rootlco_w7` (provisioned 2026-09-03 through `org.tenant-provision`, its Owner invited through
the shipped credential path, personas through the same), with no SQL and no fixture in the
journey: the ten platform types offered on the Diagnostics screen; a template authored from
**Brakes** on the screen and through the routes; a version, three items (numeric with unit and
range, select, boolean), publish under `If-Match`; a report instantiated on a job assigned through
the shipped routes; **completion refused with the mandatory items named** (409 `ERR-DIA-001`);
option, decimal, unit and DTC-format refusals; measurements with range verdicts; finding, DTC,
recommendation; completion; a separate reviewer's review; the job diagnostics screen rendering
all of it. Correlation ids are in the acceptance record.

After PR #303 merged, the same journey was run again on a second fresh organization,
`rootlco_w7b`, against the production build of `develop` `c3c62398`: the ten seeded types listed (200), a template on Brakes authored, versioned and published under `If-Match`, a report on a job assigned through the shipped routes, completion refused with the mandatory items named (409 `ERR-DIA-001`), option, decimal, unit and DTC-format refusals, completion (200 corr `101d01b7…`), and a separate reviewer's review (201 corr `bce7f034…`) — every call and correlation id in the acceptance record's re-run section.

### What the acceptance found and what was done about it

Seven defects, every one visible only with the real identity provider or the production build,
fixed on PR #301: completion of the invited Owner's credential (401), invite token type,
operator bearer binding, duplicate organization code (500 → 409), an Owner address already bound
elsewhere, genesis colliding with a partially established operator, and four permission codes
missing from the tenant-administrator bundle (44 → 48). W4-F1 (a technician editing another's
profile) closed server-side as 403 `not-own-profile`. All are in `w9-owner-bootstrap.md` §5.

## 3. Recorded at the closed state

| tier                | result                          | source                                                                     |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| unit                | 3094 total, 0 failed, 113 files | run 33726582741 (at `41adbf5c`, the executable content of the merged head) |
| web                 | 3019 total, 0 failed, 111 files | run 33726582741 (at `41adbf5c`, the executable content of the merged head) |
| protected hosted CI | 19 of 19 success                | `develop` `c3c62398`                                                       |
| `verify:policies`   | 0 problems                      | protected `develop`                                                        |
| migrations          | 136, schema hash `0598d8af…`    | `.github/ci-baselines/schema-baseline.json`                                |
| permission codes    | 118 · operations 352            | permission parity, `verify:policies`                                       |

Residuals that are recorded, adjudicated, and **not** blockers of this closure — each carries its
disposition where it is recorded:

- W9-R1, R2, R3 and O1–O6 (`w9-owner-bootstrap.md` §5): non-blocking observations from the
  acceptance, none a defect of a delivered screen; O6 (the QC check vocabulary is unseeded, and
  finalization works with zero checks) is the same class as W9-R4 and is the Owner's to decide.
- W9-O7: the catalogue service's docblock still says the platform seed holds no diagnostic type;
  a one-line Backend-lane comment fix.
- `B1-PGNET-BLOCKER` and RES-16 in
  `docs/phase-1/pre-p1-29-backend-remediation/residual-status-register.md`: provider-owned and
  planning-package residuals of the PRE-P1-29 initiative, recorded there as OPEN with their
  owners; not P1-29 scope and not weakened by it.

## 4. The plan's completion condition, item by item

1. Six read-model surfaces implemented and reachable — W1, W3, W4, W5, W7, W8 above.
2. The diagnostics experience exists and works, proved mechanically and by a real experience — §2.
3. PC-1 on a real response for every screen — the W-item records and the W9 persona boundaries.
4. No static fixture on the production path — `validate:no-fake-data`, and the acceptance was
   taken on the production build with product-created data only.
5. The Frontend/Backend boundary — every Frontend PR judged under `p1-29-frontend`, which forbids
   `apiSource`; the Backend lane under `p1-29-backend`; the seed under `p1-09-database-seed`.
6. The access and payload-parity gates non-vacuous — hosted `Repository gates` on every merge.
7. Owner acceptance on a production build — W9, PASSED, recorded.

## 5. What this record does not claim

This is a closure record, not a promotion record. It states that P1-29 met its own completion
condition at `develop` `c3c62398`. Promotion of `develop` to `main` is a separate act under
the branch governance (a content-free synchronisation first, then a merge-commit promotion) and is
recorded in its own pull requests.

P1-30 — Services, Quotations, Inventory, Billing, and Payments Frontend — begins on this closure.
