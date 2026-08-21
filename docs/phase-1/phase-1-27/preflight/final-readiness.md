# Phase 1-27 — Final Readiness Gate

**Classification:** Confidential — Commercial Product and Pilot Planning

**Verdict: READY — 16 / 16.**

Assessed against protected `develop`
`91354d82b0560d08fda667f42e9042714615feaf`, `main`
`f085d82001a43de51725707426d5c10eb134c004`.

This assessment **supersedes** the `NOT READY — 14 / 16` recorded here on
2026-08-04. That verdict was correct when it was written, and it is preserved in
git history rather than erased: the two conditions it failed have since been
closed by work, not by re-argument.

---

## 1. What changed, in one paragraph

The 14/16 gate failed on conditions 14 and 15 — the CRM and Vehicle contract
archaeology. Both were **complete as activities**; what they found was that the
Backend read surface P1-27 is scoped to consume **did not exist**. Four protected
remediations closed that, taking the registry from **226 to 238 operations** and
fixing a silent row-loss defect the new reads would otherwise have shipped with.
Condition 16 asks for open decisions to be _dispositioned_, not _resolved_, and
correction I of the execution prompt states exactly how to disposition one. Both
are now dispositioned.

## 2. The four Backend remediations

Each followed §7: stable finding, owning phase identified, separate branch,
Backend tests, OpenAPI synchronisation, protected merge-commit PR.

| finding         | what did not exist                                                                                                                                                                                                                                                                  | PR   | ops |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| `P1-27-INT-001` | No customer detail read, and no GET on any of eight CRM sub-resources. **Nothing in 226 operations returned a customer** or anything attached to one.                                                                                                                               | #192 | +9  |
| `P1-27-INT-002` | No vehicle detail read. `vehicles/{vehicleId}` exported PATCH only.                                                                                                                                                                                                                 | #193 | +1  |
| `P1-27-INT-005` | No read for either duplicate-candidate queue. A review screen could only see candidates by POSTing a scan — a privileged write that emits an audit record.                                                                                                                          | #194 | +2  |
| `P1-27-INT-006` | Not a missing read — a **broken** one. A keyset cursor minted from a JS `Date` loses the column's microseconds, so the descending predicate skips every row sharing the boundary's millisecond. Silently, and guaranteed rather than raced wherever one transaction writes a batch. | #195 | 0   |

None added a permission code. None wrote a migration. None changed an existing
write.

`P1-27-INT-006` is worth pausing on, because it is the one this gate would have
passed without noticing. Ten rows written at one instant, read at `limit=4`,
returned 4 then **0** of the remaining 6 — and a duplicate scan stamps its whole
batch with one `transaction_timestamp()`, so the review queue built in #194 would
have hidden decisions a reviewer still owed. It was found by an adversarial
review workflow over the three merged remediations (13 candidates, **9 refuted**,
4 survived) and then verified independently against the live database before any
code changed. Fixed at 9 sites; **16 pre-existing sites** are listed with file and
line in `docs/phase-1/phase-1-27/findings/p1-27-int-006-cursor-precision.md`.

## 3. The sixteen conditions

| #   | condition                               | state                                              |
| --- | --------------------------------------- | -------------------------------------------------- |
| 1   | P1-16 passed                            | **PASS**                                           |
| 2   | P1-17 passed                            | **PASS**                                           |
| 3   | P1-24 passed                            | **PASS**                                           |
| 4   | P1-25 passed                            | **PASS**                                           |
| 5   | P1-26 passed with Owner acceptance      | **PASS**                                           |
| 6   | OIR-06 resolved                         | **PASS**                                           |
| 7   | Product name CRM synchronized           | **PASS**                                           |
| 8   | API Backend-only gate green             | **PASS**                                           |
| 9   | Web Frontend-only gate green            | **PASS**                                           |
| 10  | P1-27 ownership profile green           | **PASS**                                           |
| 11  | Expired-session work reconciled         | **PASS**                                           |
| 12  | Dirty worktrees zero                    | **PASS**                                           |
| 13  | Ambiguous work zero                     | **PASS**                                           |
| 14  | CRM contract archaeology complete       | **PASS** — blocking result closed by #192 and #194 |
| 15  | Vehicle contract archaeology complete   | **PASS** — blocking result closed by #193 and #194 |
| 16  | Applicable open decisions dispositioned | **PASS** — dispositioned, not resolved             |

### Why condition 16 is a PASS with both decisions still open

The condition asks for decisions to be **dispositioned**. Resolving them is the
Owner's to do; dispositioning them is this gate's. Correction I states the rule:
an unresolved decision must **block only the affected task** or be **implemented
as a decision-neutral foundation**, and must not block unrelated tasks.

- **`P1-OD-017`** (vehicle duplicate and merge rules) blocks the **merge action**,
  not the review screens. §13 says "no merge action when P1-OD-017 remains
  unresolved" — it says nothing about seeing a queue. FE-016 and FE-028 ship the
  review, with the merge affordance **absent rather than disabled**. A disabled
  button says "this exists and you may not use it", which would be false.
- **`P1-OD-025`** (vehicle document and media policy) is a **decision-neutral
  foundation**, which is what §14 explicitly instructs while it is open: safe UI,
  upload acceptance blocked, no invented limits.

Reading condition 16 as "both decisions must be answered" would make a gate the
Owner alone can open, which is not what it says and not what correction I
describes.

## 4. Task readiness — 24 ready, 5 ready with a stated scope, 0 blocked

The previous assessment read 8 ready / 6 underspecified / **15 blocked**.

| verdict                 | count | tasks                                       |
| ----------------------- | ----- | ------------------------------------------- |
| **READY**               | 24    | FE-001…FE-015, FE-017…FE-019, FE-021…FE-026 |
| **READY, scope stated** | 5     | FE-016, FE-020, FE-027, FE-028, FE-029      |
| **BLOCKED**             | 0     | —                                           |

The five carry an explicit scope statement rather than a silent reduction:

| task     | what ships                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-016` | Review screen. Merge affordance **absent** while `P1-OD-017` is open.                                                                                                                                                |
| `FE-020` | VIN validation as **edge format validation plus the server's uniqueness verdict**. No verification workflow — `veh.vin_verifications` is a table no code reads or writes, and building one is Backend feature work.  |
| `FE-027` | **Decision-neutral media foundation.** Upload acceptance blocked; no invented file types or size limits; no object store assumed; the object key is never treated as authorization.                                  |
| `FE-028` | Review screen. Merge affordance **absent** while `P1-OD-017` is open.                                                                                                                                                |
| `FE-029` | **Sectioned activity view** over the existing independently-paginated reads. Not a fabricated unified stream — `veh` has no equivalent of `crm.timeline_events`, and §12 forbids client-side loading of all records. |

Stating these here is the point. The failure this project was reopened for is
work that looks finished and proves nothing; a rescope that is written down is
not that, and a rescope that is not written down is exactly that.

## 5. Verification of this gate

Every operation id the canonical plan cites — **42 of them** — was checked
against `docs/phase-1/phase-1-24/evidence/operation-register.json`
programmatically, not by reading. Three were wrong on the first pass
(`veh.vehicle-relationships`, `veh.vehicle-documents`,
`crm.customer-vehicle-link`, which are really `veh.vehicle-relationship-list`,
`veh.vehicle-document-list` and `crm.vehicle-link`) and were corrected. The check
now returns zero absent ids.

Task and test-id counts were counted from the document rather than asserted:
**29 FE + 4 SEC + 5 QA + 2 DO + 2 DOC = 42**, and **29 unique test ids with zero
collisions**.

## 6. Findings carried into P1-27

| id              | subject                                                                                                                                                                                                                                  | disposition                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `P1-27-INT-003` | The web API client defaults `Idempotency-Key` on **POST only**, so every non-POST operation marked idempotent answers 400 `ERR-INT-002` before permissions are evaluated — **nine of them**, not the six originally recorded (see below) | **P1-27 work** — `apps/web`, so it belongs in the feature branch |
| `P1-27-INT-004` | `openapi.v1.json` publishes 200 for routes that return 201, and never 400 or 404                                                                                                                                                         | Foundation (the generator). Out of P1-27 scope.                  |
| `P1-16-A-01`    | `line3` and `quiet_hours_note` are columns no write can set                                                                                                                                                                              | P1-16. Open.                                                     |
| `P1-16-A-02`    | Path validation runs outside `handleOperation` in all 141 route modules                                                                                                                                                                  | Foundation. Open, unchanged.                                     |
| `P1-17-A-01`    | The `iam.sensitive.view`-gated identifier read the vehicle domain promises does not exist                                                                                                                                                | P1-17. Open.                                                     |
| `P1-17-A-02`    | `veh.vehicle_alerts` has no route at all                                                                                                                                                                                                 | P1-17. Open.                                                     |
| `P1-27-INT-006` | 16 pre-existing cursor sites outside CRM/Vehicle still mint from a JS `Date`                                                                                                                                                             | Listed with file and line. Open.                                 |

### `P1-27-INT-003` was recorded at the wrong size

It was written as "every PUT to an idempotent route". Counted against the
register, it is **nine operations**:

| method    | operations                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PUT       | `crm.preference-set`, `crm.customer-status-set`, `dia.diagnostic-item-result`, `qms.qc-check-result`, `qms.rework-cost-record`, `wo.additional-work-detail-record` |
| **PATCH** | **`veh.vehicle-update`, `veh.vehicle-status-change`, `svc.service-update`**                                                                                        |

`apps/web/src/lib/api/client.ts` states in its own docblock that "`PATCH` and
`DELETE` are not marked idempotent anywhere in the published contract". That is
**false**, and it is the sentence that would stop the next reader checking —
`P1-26-F-015` in a new place. `veh.vehicle-update` is `PATCH /vehicles/{vehicleId}`,
the edit path behind FE-019.

---

**The feature branch has not been created by this document.** §6 requires it to be
based on the exact verified protected `develop` SHA _after all prerequisite
remediation is merged_, and PR #195 is the last of the four.

**Closure rule, binding:** no P1-27 formal closure without real installed-Chrome
Owner manual acceptance. Automated CI is necessary but not sufficient. Silence is
not Pass.
