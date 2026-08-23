# Phase 1-29 — Work Order, Diagnostics and Technicians — preparation

**Status: PREPARATION ONLY. Phase 1-29 implementation has not started.**

This directory holds the discovery and design work that must exist before any
P1-29 code is written. It contains no product code, no migration, no seed, and
no change to `apps/api` or `apps/web`.

## The one thing to read first

P1-29 is described almost everywhere in this repository as a _Frontend_ phase.
**It cannot be executed as one.** Three findings are Critical, seven of the
sixteen Owner requirements are Blocked, and the blocking work is Backend —
HTTP surface and permission vocabulary that no closed phase delivered and no
open phase owns.

**The decision taken on that finding is recorded in
[execution-decision.md](execution-decision.md), and it governs this whole
directory:**

- **Diagnostics remains in P1-29 final scope.** It is not deleted, deferred out
  of the phase, or reclassified. Its _frontend slice_ is blocked until its
  Backend prerequisite (`BE-4`) closes.
- **Implementation order changes; phase scope does not shrink.**
- **P1-29 is a mixed phase**: Backend prerequisites, then Frontend
  implementation, then integration and acceptance.
- **P1-19 remains historically closed.** The narrow, accurate statement is that
  P1-29’s frontend requirements need contracts no closed phase exposes.

That is not a reason to stop. It is the reason this preparation exists: the
Backend gaps are now enumerated precisely enough to be scoped, and most are
smaller than the P1-27 register implied — five of the eight are contract-only,
with the database already complete and guarded beneath them. See
[backend-prerequisite-gate.md](backend-prerequisite-gate.md) and
[blocker-register.md](blocker-register.md).

## The documents

| Document                                                                     | What it answers                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [execution-decision.md](execution-decision.md)                               | **The authoritative decision.** Diagnostics stays in scope; the phase is mixed; the execution order; the bindings that survive. Read this first.                                |
| [backend-prerequisite-gate.md](backend-prerequisite-gate.md)                 | The eight Backend prerequisites, each with evidence, missing capability, affected screens, ownership, minimal surface and acceptance proof. Plus the contract-mirror inventory. |
| [canonical-plan.md](canonical-plan.md)                                       | What P1-29 is, derived — because no canonical definition exists in Git. Scope, objective, exclusions, personas, dependencies.                                                   |
| [contract-archaeology.md](contract-archaeology.md)                           | What the Backend actually provides today: 58 operations, 44 tables, the state graphs, and what the OpenAPI document does and does not tell a client.                            |
| [permission-matrix.md](permission-matrix.md)                                 | Every P1-29 action mapped to a real permission code, where it is enforced, and what is orphaned. Plus the PRE-P1-29 dependency map.                                             |
| [information-architecture.md](information-architecture.md)                   | Navigation placement, routes, the queue/history split, work-order detail IA, and the component reuse manifest.                                                                  |
| [technician-and-diagnostics-design.md](technician-and-diagnostics-design.md) | The technician workspace and the diagnostics workflow, designed against the checklist model the Backend actually implements.                                                    |
| [integration-handoffs.md](integration-handoffs.md)                           | Parts, quotation/approval and reception — the contracts to consume rather than rebuild.                                                                                         |
| [exception-and-concurrency-model.md](exception-and-concurrency-model.md)     | The exception matrix, multi-user concurrency, error presentation, i18n, subscription blocking and the activity timeline.                                                        |
| [security-threat-model.md](security-threat-model.md)                         | Preparation-level threat review, each threat mapped to the Backend control that must exist first.                                                                               |
| [test-and-acceptance-plan.md](test-and-acceptance-plan.md)                   | Frontend acceptance plan, Backend contract checks, and the Owner manual acceptance journey.                                                                                     |
| [implementation-slices.md](implementation-slices.md)                         | The proposed slice breakdown, with dependencies and exit criteria.                                                                                                              |
| [blocker-register.md](blocker-register.md)                                   | Every blocker, classified, with exact evidence. Read this before planning any slice.                                                                                            |

## How this was produced, and how far to trust it

Two passes. First, nine parallel read-only discovery lanes over the live
database and the tree at `c081a019`, with direct verification of every
load-bearing claim. Then a second pass that audited the resulting documents
against six prohibited claims and re-researched five evidence lanes, every
finding adversarially refuted before it was accepted. Where a lane and the
repository disagreed, the repository won, and the correction is recorded in the
document that carries the claim.

Corrections worth naming here, because they change decisions:

- A discovery lane reported that `org.departments` does not exist. **It does**,
  and the authorisation layer implements department scope end to end — a
  `scope_type` CHECK, a composite FK, a fourth parameter on
  `iam.has_permission_in_scope`, delegation-backstop coverage and a shipped
  consuming policy. What is missing is rows, a management surface, and a
  `department_id` on any work-domain record. Much narrower than the finding
  register implies. See [canonical-plan.md](canonical-plan.md) §3 and `BE-7`.
- The first pass said **nothing maps a signed-in user to their technician
  profile**. That was wrong at the data layer: `tech.technician_profiles.user_id`
  carries the mapping, uniquely per tenant, on an index that exists, and the
  repository already selects it. `INS-04` is a missing _contract_, and the fix
  is correspondingly small.
- The first pass said the **adapter-reachability gate could be extended to catch
  payload drift**. It cannot: neither the operation register nor the OpenAPI
  document carries any payload information, and the gate is id-set containment
  over a regex. That claim would have promised CI coverage of exactly the drift
  class that produced the P1-28 Owner-acceptance defect.
- **`rec.reception-convert-to-work-order` is the only path that opens an
  _ordinary_ work order**, not the only path that inserts one. `qms.rework-create`
  is the second and last, and it is P1-29's own Slice G. Six passages said the
  stronger, wrong thing.
- The permission catalogue on `develop` carries **112** codes. The shared
  container reports 115 because three belong to an unmerged branch.
- The P1-27 finding disposition is the best register available and is older than
  the tree. Every finding it assigns to P1-29 was re-checked against the live
  catalogue before being carried into
  [blocker-register.md](blocker-register.md).

Claims that could not be verified are marked UNKNOWN and say what would settle
them. UNKNOWN is not a synonym for missing, and nothing here describes a desired
capability as though it were present.

## What this branch is

Branch `planning/p1-29-work-order-diagnostics-technician-preparation`, based on
`c081a019`. **Documentation only** — 14 files, all under this directory.
Changed-file counts against the base: `apps/api` 0, `apps/web` 0, migrations 0,
seeds 0, scripts 0, CI 0, tests 0, dependencies 0, docs 14.

Gates run on the committed tree, all passing: `validate:encoding`,
`validate:plain-language`, `validate:product-name`, `validate:no-fake-data`,
`validate:p1-27-doc-counts`, `validate:p1-27-lifecycle`,
`validate:p1-27-closing-values`, `validate:p1-28-evidence`, and Prettier.

One gate is deliberately not satisfied. `check-phase-ownership` **refuses** this
branch: no rule in `.github/ci-baselines/phase-ownership-profiles.json` matches
a `planning/` prefix, and `unmappedPolicy` is `FAIL`. Adding that rule is a
CI-behaviour change, which a preparation slice may not make. The change surface
itself passes — judged against a Frontend profile it is 14 changed files and
0 violations. Recorded as `INS-49` in
[blocker-register.md](blocker-register.md).

## Boundaries this preparation respects

- `apps/api` is Backend only. `apps/web` is all Frontend. No exception.
- P1-28 ends where the work order begins. `rec.reception-convert-to-work-order`
  is the only way an **ordinary** work order comes into existence — there is no
  `POST /work-orders` anywhere in the platform, deliberately. Exactly one other
  statement inserts a `wo.work_orders` row: `qms.rework-create`
  (`POST /work-orders/{id}/rework`), which opens a `kind = 'rework'` order
  against a closed original. Its Backend exists; P1-29 surfaces it in Slice G.
- PRE-P1-29 is unfinished and its B1 slice is blocked externally. That does not
  block P1-29 preparation, and [permission-matrix.md](permission-matrix.md)
  records which specific PRE-P1-29 capability each P1-29 behaviour needs rather
  than treating the whole initiative as one dependency.
