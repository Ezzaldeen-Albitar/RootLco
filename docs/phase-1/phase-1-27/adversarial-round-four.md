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

| id          | status                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `R-01`      | **FIXED** `04885f5` — checkbox `key` + `defaultChecked`; both directions at the real consumer                                         |
| `G-01`      | **FIXED** `9fedf02` — the circular case now derives from the message catalogue                                                        |
| `G-02`      | **FIXED** `9fedf02` — five failure rows, quoting the copy the product actually shows                                                  |
| `G-03`      | **FIXED** `9fedf02` — the walker made recursive, so the guide's sentence is true                                                      |
| `R-02`      | **FIXED** `8e6767a` — six creation selects, `attempt` threaded into `CatalogueSelect`                                                 |
| `R-03`      | **FIXED** `8e6767a` — status select AND block confirmation; the screen and the guard no longer disagree                               |
| `R-04`      | **FIXED** `8e6767a` — both status axes given state and a remount key                                                                  |
| `FE-028-01` | **FIXED** `c12ef8a` — a `loadKey` change now resets the page as well as the cursor stack                                              |
| `F3`        | **FIXED** `c12ef8a` — the parse half of the domain rule; and the opposite bound recorded (`2026-02-30` rolls over, so it is accepted) |
| `ADJ-01`    | **FIXED** `cf39f80` — the ten anonymous unresolved ids named, each with its commit                                                    |
| `ADJ-02`    | **FIXED** `cf39f80` — `setLogAdapter` never existed; it is `setMonitoringAdapter`                                                     |
| `ADJ-03`    | **FIXED** `cf39f80` — the preamble no longer closes the phase's one open item                                                         |
| `F1`        | **FIXED** `6b634db` — the lifecycle menu judges the RESULTING workshop status, restoring a working control                            |
| `F2`        | **FIXED** `6b634db` — the workshop menu gained the cross-axis rule it never had                                                       |
| `F4`        | **FIXED** `6b634db` — the panel re-reads the vehicle after a successful change                                                        |
| `R1`        | **FIXED** `7ed5150` — `components/forms` joined the security surface                                                                  |
| `R2`        | **FIXED** `7ed5150` — `canListDocuments` asserted in both directions                                                                  |
| `R3`        | **FIXED** `7ed5150` — the two inspected tags named, not counted                                                                       |
| `R4`        | **FIXED** `7ed5150` — the docblock no longer misdescribes the sweeps it dismissed                                                     |
| `G-04`      | **FIXED** `7ed5150` — the gate widened to "any `console.*`" as the guide always claimed                                               |
| `G-05`      | **FIXED** `7ed5150` — row count pinned, so a row cannot vanish under the floor                                                        |
| `MAN-01`    | **FIXED** `b537399` — the ownership gate's file count, 40 → the 43 the gate reports                                                   |
| `MAN-02`    | **FIXED** `b537399` — the CRM and vehicle source trees, 18/22 → 20/23                                                                 |
| `MAN-03`    | **FIXED** `b537399` — `scripts/ci`, 40 → the 41 the directory holds                                                                   |
| `MAN-04`    | **FIXED** `b537399` — the web tier heading, 39/803 → 64/1211; the per-file table marked superseded                                    |
| `TRC-01`    | **FIXED** `b537399` — four cited test titles that matched no test                                                                     |
| `TRC-02`    | **FIXED** `b537399` — three of four case-count rows in the table that exists to pin them                                              |

**Every id is written out individually, and that is not decoration.** This table
carried `MAN-01`…`MAN-04` as a RANGE, so `MAN-02` and `MAN-03` appeared in the
findings table above and were resolvable in the disposition only by a reader who
already knew the range was inclusive. Both were genuinely fixed; neither was
findable, and a hand-typed `CLOSED = 27` sat underneath asserting otherwise.

`task-register.md` states the rule this broke — "a range is not searchable: a
reader looking for `FE-004` in a register that says `FE-003`–`FE-005` finds
nothing and concludes the task was never delivered" — and that register was
itself corrected for the same fault earlier in this phase. Third occurrence.

The counts below are DERIVED by `p1-27-doc-reconciliation.test.ts`, which reads
both tables and fails if a finding has no disposition row of its own, if an id is
duplicated, or if these numbers disagree with the rows. A hand-maintained total
beside a table it does not read is how this record went wrong.

```
FINDINGS   = 27
CLOSED     = 27
OPEN       =  0
```

**One thing is recorded and NOT closed**, deliberately: an intermittent failure
in `record-form-consumers.dom.test.tsx` — three occurrences, always the same
case, never reproducible under observation. A `waitFor` default timeout against a
~1.6 s case was identified and fixed, and the failure recurred once afterwards,
so that is a real hazard removed but **not** the proven cause. The message has
never been captured.

It is not called a flake. A flake is a name for not having looked.

`PRE_QA005_PASS_REFUTED = 0`. The candidate may now be frozen — which is the
whole purpose of running this pass before the freeze rather than after it. Every
one of these twenty-seven would otherwise have been found by the Product Owner,
or not at all.
