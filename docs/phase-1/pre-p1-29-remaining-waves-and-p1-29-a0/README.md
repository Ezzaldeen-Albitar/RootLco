# PRE-P1-29 remaining waves, and P1-29 A0 — parallel preparation

**Status: PREPARATION ONLY.** No product code, no migration, no seed, no CI change, no pull
request. PRE-P1-29 slice B1 stays frozen. P1-29 implementation has not started.

This work was done **while `B1-PGNET-BLOCKER` is open**, to use the waiting period without touching
the frozen security checkpoint. It spans two initiatives deliberately, which is why it has its own
directory rather than living inside either.

## The one thing to read first

Two registers already exist, in different documents, describing overlapping work under **the same
identifiers**. `dependencies.md` §4 numbers seven P1-29 dependencies `B1`…`B7`; the Wave B design
numbers eight implementation slices `B1`…`B9`; and the same design numbers its three surviving
design blockers `B1`…`B3`. **Nothing in the canonical set disambiguates them.**

Reconciling the first two was the highest-value work in this pass, because it revealed **two
Backend prerequisites the P1-29 gate does not have**:

- **`BE-9` — technician roster writes.** _"A production tenant has zero technicians and no
  supported means of acquiring any."_ No operation creates a technician profile. This makes `BE-9`
  a **hard prerequisite of `BE-2`**: without a roster there is no profile to resolve, and `BE-2`
  alone would ship a contract with nothing behind it.
- **`BE-10` — branch-scoped job and QC queue reads.** No operation lists jobs at any scope and no
  QC read spans a branch, so a supervisor's board and a QC queue are both unbuildable.

See [p1-29-a0-backend-prerequisites.md](p1-29-a0-backend-prerequisites.md) §1.

## The documents

| Document                                                                         | What it answers                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [remaining-wave-plan.md](remaining-wave-plan.md)                                 | What is left of PRE-P1-29: Wave B slices B2…B7 and B9, then Waves C…I, each with the ten fields — and every field the documents leave empty marked as empty. |
| [dependency-graph.md](dependency-graph.md)                                       | 43 candidate edges examined, 35 substantiated, **8 rejected**. Every edge names the capability that flows along it.                                          |
| [next-slice-b2-preparation.md](next-slice-b2-preparation.md)                     | Slice B2 prepared to implementation-ready depth — schema, functions, migration, rollback, mutation tests, grant matrices, replay, OpenAPI, acceptance.       |
| [wave-c-and-e-archaeology.md](wave-c-and-e-archaeology.md)                       | Waves C and E: current state, target, gap, surface, security, tests, dependencies, exit criteria.                                                            |
| [web-waves-and-owner-qa-archaeology.md](web-waves-and-owner-qa-archaeology.md)   | Waves F, G, H and I, the same way — including the contradiction about whether F and G are in scope at all.                                                   |
| [global-identity-impact.md](global-identity-impact.md)                           | Wave D. Every dependency on tenant-bound identity, counted rather than estimated, and what can stay backward-compatible.                                     |
| [login-and-workspace-resolution-plan.md](login-and-workspace-resolution-plan.md) | What login does today, and the contracts multi-membership resolution would need. Email and password only, always.                                            |
| [company-owner-admin-plan.md](company-owner-admin-plan.md)                       | The Company Owner capability model against every IAM operation that exists.                                                                                  |
| [control-plane-api-plan.md](control-plane-api-plan.md)                           | What `develop` has for a platform control plane, and the server-authoritative request-context model a future one must use.                                   |
| [subscription-enforcement-plan.md](subscription-enforcement-plan.md)             | Subscription blocking and company lifecycle. Both enforcement points are currently absent, not merely elsewhere.                                             |
| [rbac-effective-permission-model.md](rbac-effective-permission-model.md)         | The IAM semantics as the code decides them, and the navigation capability contract — UX support, never security.                                             |
| [p1-29-a0-backend-prerequisites.md](p1-29-a0-backend-prerequisites.md)           | `BE-1`…`BE-10`, each implementation-ready. Includes the register reconciliation and the customer-projection alternatives.                                    |
| [contract-mirror-plan.md](contract-mirror-plan.md)                               | The P1-29 mirror re-measured, and what a **payload** parity gate can and cannot catch.                                                                       |
| [p1-29-screen-packets.md](p1-29-screen-packets.md)                               | Ten screen packets and the complete UI state matrix.                                                                                                         |
| [owner-acceptance-script.md](owner-acceptance-script.md)                         | A 41-step script the Owner can run in Chrome. Nothing marked PASS.                                                                                           |
| [branch-governance-and-pr-graph.md](branch-governance-and-pr-graph.md)           | Ownership profiles for a mixed phase, the 29-pull-request graph, and what may genuinely run in parallel.                                                     |
| [security-negative-test-plan.md](security-negative-test-plan.md)                 | Twelve threat classes and the negative tests owed **before** implementation begins.                                                                          |
| [data-migration-classification.md](data-migration-classification.md)             | Every planned schema change classified. Wave D is the only transitional dual model.                                                                          |
| [environment-parity-register.md](environment-parity-register.md)                 | What can be proved where. The register that stops "CI green" from meaning "hosted secure".                                                                   |
| [ambiguity-register.md](ambiguity-register.md)                                   | **80 places the canonical documentation disagrees with itself or with the tree.** Recorded, not resolved.                                                    |

## What was found that changes decisions

- **`BE-9` and `BE-10` are missing prerequisites**, above.
- **`dependencies.md` §4 `B4` is wrong in one sentence.** It concludes a job _"cannot be read"_. A
  job **is** readable inside `WorkOrderDetail.jobs[]`; what is absent is a job _list_ at branch
  scope and a single-job read. Everything it concludes about a _board_ still holds. The correction
  belongs to the PRE-P1-29 initiative to apply; this slice does not edit another initiative's
  canonical record.
- **`scope.md` G-16 is stale.** The three dead tenant-hint helpers it says are still declared were
  deleted by `d502e07f`, merged as PR #257, which **is** an ancestor of `c081a019`.
- **Nothing reads `org.tenants.status` during authentication.** A suspended or closed tenant signs
  in exactly like an active one, although the column's own comment says otherwise.
- **Zero of the 305 operations declare a `featureFlag`**, so `ERR-TEN-001` is unreachable and
  subscription blocking is not implemented anywhere.
- **P-1 is already breached in shipped code.** A company/branch selector uses raw identifiers as its
  own labels and degrades to a free-text UUID field, with shipped copy in both locales telling the
  operator to type one.
- **CI runs bare `postgres:17-alpine` on three of its four database tiers**, local Supabase on one,
  and **the hosted provider environment on none**. That is the structural reason a green CI run
  cannot speak to hosted authority.
- **The Wave B design gate says implementation may not begin, and B1 was implemented anyway** by an
  explicit recorded decision that exists only on the unmerged B1 branch. From `develop` the question
  is unsettleable. Recorded as `AMB-02`.

## How this was produced

Two workflows, **112 agents, zero errors**, over `develop` at `c081a019` and the frozen P1-29
preparation set. Every load-bearing claim was adversarially re-checked before it was accepted;
38 claims were refuted or corrected in that pass and the corrections are carried into the documents
rather than the originals.

Counts, ambiguities and unknowns are reported as measured. Where two canonical documents give
different figures, **this set uses the measured value and says which documents disagree** rather
than choosing one to believe.

## The self-refutation pass, and what it caught in this set

Six adversarial lanes attacked these documents after they were written — for invented
dependencies, duplicate work, schema claims contradicted by source, frontend assumptions the API
does not support, role-name authorization, permission counts taken from the wrong tree, and
environment overreach. **54 findings raised, 14 rejected as unreproducible, 39 confirmed and
applied.** The standard was strict: a finding that could not be reproduced from current repository
truth was thrown out, however plausible.

The corrections that changed a fact:

- **CRITICAL — closure eligibility DOES report parts.** This set inherited from the frozen P1-29
  preparation the claim that closure does not check reservations or part issues. Since P1-21 it
  does: `ClosureEligibility` carries `inventoryCommitments` and `eligible` is false when it blocks.
  The two deferred conditions are _named_ by `DEFERRED_CLOSURE_BLOCKERS` and **evaluated in the
  application** — the six-entry blocker registry excludes them only because the database guard
  cannot express them. **Drive the closure checklist from `eligible`, never from
  `blockers.length`.**
- **`ERR-TRN-001` is not exclusively a graph refusal.** The closure command raises it for the
  inventory condition _after_ the edge is already legal, with `blockers` empty — so a screen that
  says "the order is now X" states something false.
- **Diagnostics is not wholly append-only.** `dia.diagnostic-item-result` is a `PUT` that records
  **or replaces** an answer. Everything else in the module is insert-only.
- **Thirteen orphan permission codes, not ten** — matching `gap-register.md` GAP-15, which this set
  had not consulted. My scan missed three because two are enforced inside RLS policies and a
  trigger rather than a route declaration. An orphan report is an absence-from-the-route-surface
  report, not a dead-code report.
- **Three history operations, not four.** No `qms` operation is a history read.
- **Two of five paged reads return a bare `Page<T>`**; the other three wrap it in a named envelope
  with an `origin` genesis block.
- **`wo.work-order-list` cannot be filtered to terminal states in one call** — `state` is a single
  value with no negation — so the history packet needs one call per terminal code, and the terminal
  set must come from `BE-1` rather than being hard-coded.
- **The last-holder guard is a snapshot read, not a locking one**, and its docblock records the
  omission as deliberate.
- **Two environment claims were overreach**: the authenticated-browser tier exercises GoTrue only
  and never PostgREST, and the SECURITY-DEFINER count is measured on the **local** stack, not on any
  hosted project — the register's own rules forbid the stronger statement.

## Boundaries this preparation respects

- The frozen B1 branch is untouched. `B1-PGNET-BLOCKER` remains open and is not assessed here.
- No B2 implementation, no P1-29 implementation, no migration, no executable change of any kind.
- No script is modified — including the ownership profiles, which **do not** map this planning
  branch. That is recorded rather than fixed.
- Nothing in another initiative's canonical directory is edited. Corrections owed to PRE-P1-29's own
  documents are recorded here and flagged.
