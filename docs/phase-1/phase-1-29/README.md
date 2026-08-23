# Phase 1-29 — Work Order, Diagnostics and Technicians — preparation

**Status: PREPARATION ONLY. Phase 1-29 implementation has not started.**

This directory holds the discovery and design work that must exist before any
P1-29 code is written. It contains no product code, no migration, no seed, and
no change to `apps/api` or `apps/web`.

## The one thing to read first

P1-29 is described almost everywhere in this repository as a _Frontend_ phase.
**It cannot be executed as one.** Three findings are Critical, seven of the
sixteen Owner requirements are marked Blocked, and the blocking work is Backend
— schema and HTTP surface that no closed phase delivered and no open phase owns.

That is not a reason to stop. It is the reason this preparation exists: the
Backend gaps are now enumerated precisely enough to be scoped, and several are
much smaller than the P1-27 finding register implied. See
[blocker-register.md](blocker-register.md).

## The documents

| Document                                                                     | What it answers                                                                                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [canonical-plan.md](canonical-plan.md)                                       | What P1-29 is, derived — because no canonical definition exists in Git. Scope, objective, exclusions, personas, dependencies.                        |
| [contract-archaeology.md](contract-archaeology.md)                           | What the Backend actually provides today: 58 operations, 44 tables, the state graphs, and what the OpenAPI document does and does not tell a client. |
| [permission-matrix.md](permission-matrix.md)                                 | Every P1-29 action mapped to a real permission code, where it is enforced, and what is orphaned. Plus the PRE-P1-29 dependency map.                  |
| [information-architecture.md](information-architecture.md)                   | Navigation placement, routes, the queue/history split, work-order detail IA, and the component reuse manifest.                                       |
| [technician-and-diagnostics-design.md](technician-and-diagnostics-design.md) | The technician workspace and the diagnostics workflow, designed against the checklist model the Backend actually implements.                         |
| [integration-handoffs.md](integration-handoffs.md)                           | Parts, quotation/approval and reception — the contracts to consume rather than rebuild.                                                              |
| [exception-and-concurrency-model.md](exception-and-concurrency-model.md)     | The exception matrix, multi-user concurrency, error presentation, i18n, subscription blocking and the activity timeline.                             |
| [security-threat-model.md](security-threat-model.md)                         | Preparation-level threat review, each threat mapped to the Backend control that must exist first.                                                    |
| [test-and-acceptance-plan.md](test-and-acceptance-plan.md)                   | Frontend acceptance plan, Backend contract checks, and the Owner manual acceptance journey.                                                          |
| [implementation-slices.md](implementation-slices.md)                         | The proposed slice breakdown, with dependencies and exit criteria.                                                                                   |
| [blocker-register.md](blocker-register.md)                                   | Every blocker, classified, with exact evidence. Read this before planning any slice.                                                                 |

## How this was produced, and how far to trust it

Nine parallel read-only discovery lanes over the live database and the tree at
`c081a019`, followed by direct verification of every load-bearing claim. Where a
lane and the repository disagreed, the repository won and the correction is
recorded in the document that carries the claim.

Two such corrections are worth naming here, because they change decisions:

- A discovery lane reported that `org.departments` does not exist. **It does** —
  17 tables in `org`, one of them `departments`, with `org.department.manage`
  seeded. The gap is narrower than "departments exist nowhere": the table and
  the permission exist, there is no HTTP surface, and no work-order entity
  carries a `department_id`. That is a smaller, cheaper problem than the finding
  register implies.
- The P1-27 finding disposition is the best register available and is a year of
  work older than the tree. Every finding it assigns to P1-29 was re-checked
  against the live catalogue before being carried into
  [blocker-register.md](blocker-register.md). Several are confirmed exactly;
  one is materially narrower.

Claims that could not be verified are marked UNKNOWN and say what would settle
them. UNKNOWN is not a synonym for missing, and nothing here describes a desired
capability as though it were present.

## What this branch is

Branch `planning/p1-29-work-order-diagnostics-technician-preparation`, based on
`c081a019`. **Documentation only** — 12 files, all under this directory.
Changed-file counts against the base: `apps/api` 0, `apps/web` 0, migrations 0,
seeds 0, scripts 0, CI 0, tests 0, dependencies 0, docs 12.

Gates run on the committed tree, all passing: `validate:encoding`,
`validate:plain-language`, `validate:product-name`, `validate:no-fake-data`,
`validate:p1-27-doc-counts`, `validate:p1-27-lifecycle`,
`validate:p1-27-closing-values`, `validate:p1-28-evidence`, and Prettier.

One gate is deliberately not satisfied. `check-phase-ownership` **refuses** this
branch: no rule in `.github/ci-baselines/phase-ownership-profiles.json` matches
a `planning/` prefix, and `unmappedPolicy` is `FAIL`. Adding that rule is a
CI-behaviour change, which a preparation slice may not make. The change surface
itself passes — judged against a Frontend profile it is 12 changed files and
0 violations. Recorded as `INS-49` in
[blocker-register.md](blocker-register.md).

## Boundaries this preparation respects

- `apps/api` is Backend only. `apps/web` is all Frontend. No exception.
- P1-28 ends where the work order begins. `rec.reception-convert-to-work-order`
  is the only way a work order comes into existence — there is no
  `POST /work-orders` anywhere in the platform, deliberately.
- PRE-P1-29 is unfinished and its B1 slice is blocked externally. That does not
  block P1-29 preparation, and [permission-matrix.md](permission-matrix.md)
  records which specific PRE-P1-29 capability each P1-29 behaviour needs rather
  than treating the whole initiative as one dependency.
