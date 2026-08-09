# P1-27 — fourth adversarial pass, round four

**Classification:** Confidential — Commercial Product and Pilot Planning

Thirty-three agents, six attack groups, each briefed to REFUTE this branch's own
remediation commits rather than review them. Every claim was then adjudicated by
an independent agent instructed to default to `survives=false` when it could not
reproduce.

```
CLAIMED   = 27
SURVIVED  = 27
REFUTED   = 0
```

**A verifier panel that refutes nothing is not adversarial**, so REFUTED = 0 is
recorded as a property of the panel, not as a compliment to the claims. Three
were re-checked by hand before any were acted on — ADJ-02, R-01 and G-01 —
and all three held. The rest are treated as real until individually refuted.

| id          | severity | classification         | target                                                                         |
| ----------- | -------- | ---------------------- | ------------------------------------------------------------------------------ |
| `R-01`      | blocking | `REAL_P1_27_DEFECT`    | `apps/web/src/components/forms/RecordForm.tsx:243`                             |
| `R-02`      | material | `REAL_P1_27_DEFECT`    | `apps/web/src/features/vehicles/components/VehicleCreateScreen.tsx:325`        |
| `R-03`      | material | `REAL_P1_27_DEFECT`    | `apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx:364` |
| `R-04`      | material | `REAL_P1_27_DEFECT`    | `apps/web/src/features/vehicles/components/VehicleProfileScreen.tsx:658`       |
| `FE-028-01` | material | `REAL_P1_27_DEFECT`    | `apps/web/src/components/data-table/use-server-table.ts:94`                    |
| `F1`        | material | `REAL_P1_27_DEFECT`    | `apps/web/src/features/vehicles/profile-contract.ts:202`                       |
| `F2`        | material | `REAL_P1_27_DEFECT`    | `apps/web/src/features/vehicles/profile-contract.ts:207`                       |
| `F3`        | material | `REAL_P1_27_DEFECT`    | `apps/web/src/features/vehicles/history-api.ts:251`                            |
| `F4`        | material | `REAL_P1_27_DEFECT`    | `apps/web/src/features/vehicles/components/VehicleProfileScreen.tsx:642`       |
| `R1`        | material | `TEST_OR_GATE_DEFECT`  | `apps/web/tests/p1-27-security.test.ts:100`                                    |
| `R2`        | material | `TEST_OR_GATE_DEFECT`  | `apps/web/tests/route-permission-binding.test.ts:161`                          |
| `R3`        | material | `TEST_OR_GATE_DEFECT`  | `apps/web/tests/p1-27-security.test.ts:495`                                    |
| `R4`        | cosmetic | `DOCUMENTATION_DEFECT` | `apps/web/tests/route-permission-binding.test.ts:19`                           |
| `G-01`      | blocking | `REAL_P1_27_DEFECT`    | `apps/web/tests/p1-27-guidance-reconciliation.test.ts:143`                     |
| `G-02`      | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/operator-guide.md:149`                                |
| `G-03`      | material | `TEST_OR_GATE_DEFECT`  | `docs/phase-1/phase-1-27/developer-guide.md:37`                                |
| `G-04`      | material | `TEST_OR_GATE_DEFECT`  | `apps/web/tests/p1-27-guidance-reconciliation.test.ts:179`                     |
| `G-05`      | cosmetic | `TEST_OR_GATE_DEFECT`  | `apps/web/tests/p1-27-guidance-reconciliation.test.ts:251`                     |
| `ADJ-01`    | blocking | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/final-task-adjudication.md:100`                       |
| `MAN-01`    | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/deliverable-manifest.md:119`                          |
| `MAN-02`    | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/deliverable-manifest.md:187`                          |
| `TRC-01`    | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/evidence/task-traceability.md:173`                    |
| `TRC-02`    | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/evidence/task-traceability.md:348`                    |
| `ADJ-02`    | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/final-task-adjudication.md:605`                       |
| `MAN-03`    | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/deliverable-manifest.md:125`                          |
| `MAN-04`    | material | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/deliverable-manifest.md:122`                          |
| `ADJ-03`    | cosmetic | `DOCUMENTATION_DEFECT` | `docs/phase-1/phase-1-27/final-task-adjudication.md:522`                       |

---

## What this round is actually about

Rounds one to three attacked the phase. **This round attacked the fixes**, and
nine of its twenty-seven findings are defects introduced or left open by the
remediation itself. Six were written during the wave that was preparing to
freeze the candidate.

The pattern is one thing, stated three ways:

**A fix applied to the reported instance and not to its class.** `NEW-FE-01` was
diagnosed correctly — React resets a form once a Server Action settles, and a
prop unchanged between renders is not re-written — and then fixed for `<select>`
inside `RecordForm` only. `R-01` is the `checkbox` branch of the same component,
eleven lines below. `R-02`, `R-03` and `R-04` are three more screens that own
their own `<form>` and never received it, one of which
(`CustomerCreateScreen.tsx:218`) carries a comment saying in as many words that
the hole exists "wherever a `<select>` sits in a `<form action={…}>`".

**A proof that stops at the boundary of what was reported.**
`record-form-consumers.dom.test.tsx` was written specifically to prove
failed-submit preservation through real consumers, and asserted three fields of
the EV form while walking past the checkbox in the same fixture.

**A check that asserts a document against itself.** `G-01`: the guidance
reconciliation test — written to stop documents claiming what the code does not
implement — takes four strings from the operator guide and asserts the operator
guide contains them. Two of the four are in no message catalogue at all.

## Disposition

| id                                    | status                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `R-01`                                | **FIXED** `04885f5` — checkbox `key` + `defaultChecked`; both directions at the real consumer                                         |
| `G-01`                                | **FIXED** `9fedf02` — the circular case now derives from the message catalogue                                                        |
| `G-02`                                | **FIXED** `9fedf02` — five failure rows, quoting the copy the product actually shows                                                  |
| `G-03`                                | **FIXED** `9fedf02` — the walker made recursive, so the guide's sentence is true                                                      |
| `R-02`                                | **FIXED** `8e6767a` — six creation selects, `attempt` threaded into `CatalogueSelect`                                                 |
| `R-03`                                | **FIXED** `8e6767a` — status select AND block confirmation; the screen and the guard no longer disagree                               |
| `R-04`                                | **FIXED** `8e6767a` — both status axes given state and a remount key                                                                  |
| `FE-028-01`                           | **FIXED** `c12ef8a` — a `loadKey` change now resets the page as well as the cursor stack                                              |
| `F3`                                  | **FIXED** `c12ef8a` — the parse half of the domain rule; and the opposite bound recorded (`2026-02-30` rolls over, so it is accepted) |
| `ADJ-01`                              | **FIXED** `cf39f80` — the ten anonymous unresolved ids named, each with its commit                                                    |
| `ADJ-02`                              | **FIXED** `cf39f80` — `setLogAdapter` never existed; it is `setMonitoringAdapter`                                                     |
| `ADJ-03`                              | **FIXED** `cf39f80` — the preamble no longer closes the phase's one open item                                                         |
| `F1`, `F2`, `F4`                      | open — vehicle lifecycle cross-axis rules and the stale read after a status change                                                    |
| `R1`…`R4`, `G-04`, `G-05`             | open — test and gate weaknesses                                                                                                       |
| `MAN-01`…`MAN-04`, `TRC-01`, `TRC-02` | open — manifest and traceability figures                                                                                              |

`PRE_QA005_PASS_REFUTED` is therefore **not** zero, and the candidate freeze does
not proceed until it is. That is the whole purpose of running this pass before
the freeze rather than after it: every one of these would otherwise have been
found by the Product Owner, or not at all.
