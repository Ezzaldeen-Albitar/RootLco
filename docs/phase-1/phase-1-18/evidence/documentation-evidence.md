# P1-18 — Documentation evidence (P1-18-DOC-001…002)

Gate condition 14 cites these identifiers. Until this document existed they
appeared **only in the gate's own condition table**.

Requirements are quoted from the canonical Phase 1 Development Plan.

---

## P1-18-DOC-001 — Contract, catalog, and traceability synchronization

_Produce the controlled record for contract, catalog, and traceability
synchronization, link all supporting evidence, identify unresolved limitations,
and route the result to the named approval owner._

### Contract

| Artefact                           | State                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAPI `docs/api/openapi.v1.json` | 3.1.0 · 94 paths · **110 operations** · every operation guarded                                                                                                                                                                     |
| Declared vs published vs guarded   | **110 / 110 / 110**, P1-18 **12/12**                                                                                                                                                                                                |
| Independent verification           | A second inventory walks all 94 `route.ts` files, strips comments and parses each `defineOperation` directly, sharing no import list, registry module or helper with the repository gate — 0 missing, 0 orphan, 0 path/method drift |
| Divergence gate                    | `tests/openapi-contract.test.ts` regenerates from the registry and compares; writing is opt-in so a drifting build cannot "fix" itself                                                                                              |

### Catalogs

| Catalog      | State                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission   | 71 permissions; the nine P1-18 codes registered and seeded                                                                                                                                                                |
| Audit action | one action per operation, entity type pinned per action                                                                                                                                                                   |
| Event        | `appointment.changed`, `vehicle.checked-in` (EVT-REC-001), `reception.approved`; conversion emits none by design. The Field-24 spelling `reception.vehicle-checked-in.v1` is NOT minted — the reserved catalog entry wins |
| Error        | no domain-specific codes minted; platform codes reused                                                                                                                                                                    |

### Traceability

`task-traceability.md` maps **all nineteen** backend tasks to the twelve
operations, with route, permission, audit action, event, implementation file and
assertion-backed test per task. It also records, rather than papers over, that
`P1-18-BE-012/013/014` are not annotated in any route header and that the map —
not an annotation — is the authoritative artefact.

### Linked evidence

`security-review.md` (SEC-001…004) · `qa-evidence.md` (QA-001…005) ·
`devops-observability.md` (DO-001…002) · `task-traceability.md` ·
`scoped-authorization-mutation-proofs.md` (M1–M6) ·
`local-release-candidate-validation.md` (battery, clean rooms, review
adjudication) · `operation-test-matrix.json` (generated).

### Unresolved limitations

Carried in README §7.1 and not silently closed: `P1-18-A-01` (resolved, retained
as record) · `P1-18-QA-COMPANYHALF` (open, reasoning corrected) ·
`P1-18-GATE-IDENTITY` · `P1-18-REPLAY-001` · `P1-18-ORACLE-001` ·
`P1-18-DEPT-001` · `PLAT-BRANCHTARGET-001` · `P1-05-SEEDRESIDUE` ·
`REC-LIFECYCLE-001` · `P1-18-R-02` · `P1-18-QA-BARRIER` · `P1-18-TIE-001` ·
`P1-18-LEX-001` · `P1-18-UUID-001` · `P1-18-SEC-ROLEPROBE`.

### Routing

The approval owner is the RootLco Product Owner. The gate remains
`Decision: Pending`; nothing in this phase authorises dependent work.

---

## P1-18-DOC-002 — Operator/developer guidance and change-log update

_Produce the controlled record for operator/developer guidance and change-log
update…_

### README completeness

`docs/phase-1/phase-1-18/README.md` carries: §0 delivery history (the merged
feature branch and **three** post-merge remediations, including the two mistakes
that were mine) · §1 purpose · §2 database capability verdict with the three
frozen facts · §3 module decision · §4 route mapping · **§4.1 scoped
authorization after the resource lock** · §5 reuse boundaries · §6 scope · §7
limitations · §7.1 the follow-up register.

### Recorded contract drift

Four canonical conflicts are recorded rather than silently resolved:

1. **Route conflict.** Chapter 4 allocates `API-REC-001 = POST
/api/v1/reception-visits`; P1-18 Field 23 allocates `POST /api/v1/receptions`.
   The phase's own Field 23 is followed. Documented conflict, not a silent
   choice.
2. **New reserved event.** `EVT-REC-002 reception.approved` is the one
   platform-wide name this phase mints.
3. **Event name.** Chapter 4 allocates `vehicle.checked-in.v1`; Field 24 calls
   the same fact `reception.vehicle-checked-in.v1`. The reserved catalog entry
   wins; no duplicate is minted.
4. **Error codes.** `ERR-APT-001` / `ERR-REC-001` exist in neither the platform
   catalog nor the implementation; both meanings are already covered.

### Lifecycle limitation

No P1-18 operation writes `closed_without_work` or `refused`, and `converted` is
inside the open-vehicle unique index, so **a vehicle can be received only once
through this backend**. Closing a visit is delivery/custody-release work with no
backend yet. This is the most consequential boundary of the phase and is stated
in §2, §7 and the register.

### Product name

`[PRODUCT NAME — Pending Final Approval]`. Benzene remains the configurable first
tenant and appears nowhere in product code, database behaviour, permissions,
workflows, routes or shared defaults — enforced by `security:scope-exclusions`.

### Explicit exclusions

No frontend · no production deployment · no Benzene legacy-data migration · no
Zoom services · no unapproved country/tax/currency/payment/retention defaults ·
no product-name finalization · no P1-19 implementation · no read endpoints
(Field 23 allocates none, so no `*.read` permission is registered either).

### Change-log

This repository records change history in git and in the phase evidence
documents; there is no separate CHANGELOG file, and this phase does not
introduce one.
