# PRE-P1-29 Backend Remediation Plan

**Execution-ready implementation contracts for the Backend work P1-29 cannot proceed without.**

Nothing in this directory authorises code. It exists so that when `B1-PGNET-BLOCKER` closes and
B1 receives Final GO, an implementation agent can open `BR-01` and build it without repeating
architectural discovery.

|                    |                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------- |
| Base               | `c081a019` (`origin/develop`)                                                           |
| Sources unified    | P1-29 preparation (`b5be9f4c`, 14 docs) + PRE-P1-29 wave planning (`809f9eb8`, 22 docs) |
| Executable changes | **0**                                                                                   |
| Verdict            | **PRE-P1-29 BACKEND REMEDIATION DESIGN — READY**                                        |
| B1                 | **FINAL GO — BLOCKED BY `B1-PGNET-BLOCKER`** (external, provider-owned)                 |

---

## 1. What this plan is, against what already existed

Two preparation packages already carried most of the discovery. This plan does **not** restate
them. It does three things they did not:

1. **Re-cuts ten backend prerequisites (`BE-1`…`BE-10`) into nine implementation slices
   (`BR-01`…`BR-09`)** along the axis an implementer works on — a service and its routes — rather
   than the axis discovery found them on.
2. **Answers the architecture questions the prerequisite registers left open**, each against
   measured repository evidence, so no slice begins with a design decision outstanding.
3. **Records eight corrections to the preparation package**, found by reading the schema rather
   than the documents. Two of them change a slice's design.
   See [repository-corrections.md](repository-corrections.md).

Where this plan and a preparation document disagree, the disagreement is named in
`repository-corrections.md` with the evidence. Silent overwriting is not used anywhere.

## 2. The nine slices

| slice                                                        | subject                                        | prerequisite    | DB change?                   | complexity |
| ------------------------------------------------------------ | ---------------------------------------------- | --------------- | ---------------------------- | ---------- |
| [`BR-01`](br-01-technician-identity-authority.md)            | Technician identity authority                  | `BE-2`          | **no**                       | S          |
| [`BR-02`](br-02-department-domain-surface.md)                | Department domain surface                      | `BE-7`          | **yes**, one nullable column | M          |
| [`BR-03`](br-03-technician-capability-administration.md)     | Technician profile & capability administration | `BE-9`          | **no**                       | M          |
| [`BR-04`](br-04-inspection-diagnostic-template-authoring.md) | Inspection & diagnostic template authoring     | `BE-4`          | seed only                    | M          |
| [`BR-05`](br-05-work-order-customer-context-projection.md)   | Work-order customer / vehicle context          | `BE-3`          | **no**                       | S–M        |
| [`BR-06`](br-06-work-execution-controls.md)                  | Work execution controls                        | `BE-1`, `BE-10` | **no**                       | M          |
| [`BR-07`](br-07-work-and-diagnostic-evidence.md)             | Work & diagnostic evidence                     | `BE-8`          | **yes**, two tables          | M–L        |
| [`BR-08`](br-08-api-contract-closure-and-parity.md)          | API contract closure & frontend parity         | `BE-5`          | **no**                       | M          |
| [`BR-09`](br-09-assignment-notification-delivery.md)         | Assignment notification delivery               | `BE-6`          | **no**                       | M          |

**`BR-09` is an addition to the requested eight, not a renaming.** The eight-slice cut left `BE-6`
(consume `job.assigned`) with no owner, and `BE-6` is the sole prerequisite of Owner requirement 6.
Leaving it unassigned would have reproduced the exact failure the execution decision forbids — a
capability that no slice owns and therefore nobody builds. §8 of the governing directive permits
restructuring where repository reality requires it; this is that case.

## 3. Reading order

| you need                                                     | read                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| whether the design is ready to build                         | this file, §5                                                                                                                                                                             |
| what must precede what                                       | [dependency-graph.md](dependency-graph.md)                                                                                                                                                |
| the slice you are about to implement                         | `br-0N-*.md` — each is self-contained                                                                                                                                                     |
| whether a P1-29 screen still has a hidden backend dependency | [screen-to-contract-matrix.md](screen-to-contract-matrix.md)                                                                                                                              |
| where a preparation finding ended up                         | [finding-reconciliation.md](finding-reconciliation.md)                                                                                                                                    |
| whether an Owner requirement has an owner                    | [owner-requirement-reconciliation.md](owner-requirement-reconciliation.md)                                                                                                                |
| what the preparation package got wrong                       | [repository-corrections.md](repository-corrections.md)                                                                                                                                    |
| why CI will refuse a `planning/*` branch                     | [governance-remediation.md](governance-remediation.md)                                                                                                                                    |
| the frontend contract mirror mechanism                       | [`../pre-p1-29-remaining-waves-and-p1-29-a0/contract-mirror-plan.md`](../pre-p1-29-remaining-waves-and-p1-29-a0/contract-mirror-plan.md) — **not duplicated here**; `BR-08` implements it |
| the ten prerequisites as discovery found them                | [`../pre-p1-29-remaining-waves-and-p1-29-a0/p1-29-a0-backend-prerequisites.md`](../pre-p1-29-remaining-waves-and-p1-29-a0/p1-29-a0-backend-prerequisites.md)                              |

## 4. The contract format

Every slice carries the same thirteen sections, in the same order: problem statement · existing
repository evidence · gap · proposed architecture · database impact · API impact · permission
model · security requirements · validation · error contract · audit and history · tests ·
definition of done.

Three rules the format enforces:

- **Evidence is a file and a line, never an inference.** A claim with no citation is a claim this
  plan does not make.
- **Every proposed operation is fully specified** — method, route, permission, path params, query
  params, request body, success response, error cases, pagination, idempotency, version guard.
  "Add an endpoint" appears nowhere.
- **Every Definition of Done is objectively decidable.** No entry can be satisfied by an opinion.

## 5. Definition of Ready — the verdict, and what it does and does not mean

**`PRE-P1-29 BACKEND REMEDIATION DESIGN — READY`.**

| criterion                                  | state                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| every P1-29 backend blocker has an owner   | **yes** — 10 prerequisites → 9 slices, 0 orphans          |
| every known finding reconciled             | **yes** — 50 findings, each in exactly one terminal state |
| every Owner requirement mapped             | **yes** — 16/16                                           |
| every slice has an implementation contract | **yes** — 9/9, thirteen sections each                     |
| DB impacts known                           | **yes** — 2 slices change schema; 7 do not                |
| API operations known                       | **yes** — 31 proposed operations, each fully specified    |
| permissions known                          | **yes** — 1 new code justified; all others reuse          |
| validation known                           | **yes** — per slice                                       |
| errors known                               | **yes** — 0 new error codes required                      |
| dependencies known                         | **yes** — see the graph; 3 hard edges, 4 soft             |
| no unknown Critical architectural gap      | **yes** — all three Criticals have contracts              |
| screen-to-contract dependencies complete   | **yes** — 41 UI actions mapped                            |
| no executable implementation started       | **yes** — diff is documentation-only                      |

**READY does not mean GO.** It means no architectural question blocks implementation. Three
conditions still gate the first line of code, and none of them is a design question:

1. `B1-PGNET-BLOCKER` resolved and target-environment remediation independently proven.
2. B1 through its seventeen-step closure path and a true merge to `develop`.
3. An ownership-profile rule for the implementing branch, declared in the branch's first commit
   — see [governance-remediation.md](governance-remediation.md).

**READY also does not mean the slices are equally free.** Seven of the nine have no technical
dependency on PRE-P1-29 at all; the sequencing that holds them is an Owner decision, not a
constraint the repository imposes. [dependency-graph.md](dependency-graph.md) §4 separates the
two, so that if the external blocker persists the Owner can see exactly what could proceed
without it.
