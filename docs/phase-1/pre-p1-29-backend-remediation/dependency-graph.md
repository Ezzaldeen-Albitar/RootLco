# Dependency graph and execution order

Every edge below is either **HARD** (the successor is impossible or meaningless without the
predecessor), **SOFT** (the successor is buildable but worse, or duplicates work), or the pair is
**INDEPENDENT**. Every edge names its evidence. An edge asserted without one is not in this graph.

**The requested `BR-01 → BR-02 → … → BR-08` chain does not survive analysis.** Three of its edges do
not exist, one runs backwards, and the slice that should be first is eighth.

---

## 1. The graph

```
                       ┌──────────────────────────────────────────┐
                       │  B1-PGNET-BLOCKER resolved               │
                       │  → B1 closure path → true merge          │  ← Owner-imposed
                       └────────────────────┬─────────────────────┘     sequencing (§4)
                                            │
                            ┌───────────────▼───────────────┐
                            │  BR-08a  permission parity    │   FIRST. Nothing depends on it
                            │          gate                 │   technically; everything that
                            └───────┬───────────────┬───────┘   mints a code depends on it in
                                    │ HARD          │ HARD      practice.
                                    │               │
                        ┌───────────▼──┐      ┌─────▼────────┐
                        │   BR-03      │      │   BR-04      │
                        │   roster     │      │   templates  │
                        └───────┬──────┘      └──────────────┘
                                │ HARD
                        ┌───────▼──────┐
                        │   BR-01      │
                        │   identity   │
                        └──────────────┘

   independent of all of the above, and of each other:

        BR-05  customer projection  ────soft────►  BR-06  execution controls
        BR-07  job evidence
        BR-09  assignment notification

        BR-02  departments   ◄──── HARD ────  PRE-P1-29 Wave C (admin half)

   after all of the above:

        BR-08b  schema exposure  ──HARD──►  BR-08c  mirror + payload parity  ──►  P1-29 A0 complete
```

## 2. Every edge, with its evidence

| #   | edge                                    | kind                      | evidence                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `BR-08a` → `BR-03`                      | **HARD in practice**      | `BR-03` mints `tech.technician.manage`. `defineOperation` rejects an empty `permissions` array and **nothing else**; the registry's own test registers `a.b.c` and passes. No RLS policy in this domain consults a permission code, so a misspelt code has no second line of defence. The gate must police the code **as it is written**.                                                                        |
| E2  | `BR-08a` → `BR-04`                      | **HARD in practice**      | Same, for `dia.catalogue.manage`. `BE-4`'s own dependency line says `BE-5` should land first.                                                                                                                                                                                                                                                                                                                    |
| E3  | **`BR-03` → `BR-01`**                   | **HARD**                  | `BE-9` is a hard prerequisite of `BE-2`. No operation creates a technician profile; the only inserting code is test scaffolding. `BR-01` resolves a caller to _their_ profile — **with no roster there is nothing to resolve**, and `BR-01` alone leaves the technician persona exactly as blocked as before. **This edge runs opposite to the requested `BR-01 → … → BR-03` order.**                            |
| E4  | PRE-P1-29 Wave C → `BR-02` (admin half) | **HARD**                  | `org.departments` holds zero rows and no route creates one. The management surface belongs to PRE-P1-29's organisation-administration dimension — the same gap that covers companies and branches. `BR-02`'s `department_id` column is independently buildable; a department to point it at is not. Three PRE-P1-29 documents say **Wave C**; the frozen gate says Wave B and is the line to correct (`AMB-11`). |
| E5  | `BR-05` → `BR-06`                       | **SOFT**                  | `BR-06`'s `JobBoardRow` wants `customer` and `vehicle`. Without `BR-05` the board ships without those columns; **it must not resolve them a second way**. Buildable in either order; wasteful in one.                                                                                                                                                                                                            |
| E6  | `BR-08b` → `BR-08c`                     | **HARD**                  | Zero route files export their zod schemas — _"the single mechanical blocker between the repository and a runtime-introspection payload gate."_ No exported schema, no payload gate.                                                                                                                                                                                                                              |
| E7  | all slices → `BR-08c`                   | **SOFT**                  | The mirror transcribes 58 + ~31 operations. Transcribing before the new ones exist means transcribing twice.                                                                                                                                                                                                                                                                                                     |
| E8  | `BR-03` → `BR-09`                       | **SOFT (data, not code)** | The consumer resolves recipients through `tech.technician_profiles.user_id`, which exists today. A tenant with no roster generates no assignments, so `BR-09` is untestable end-to-end without `BR-03` — but the code edge is absent.                                                                                                                                                                            |
| E9  | `BR-01` → `BR-09`                       | **INDEPENDENT**           | Both read `technician_profiles.user_id`; `BR-01` publishes an HTTP contract over it, `BR-09` reads it server-side inside the worker transaction. Two needs, one shared fact, no edge. Worth stating because the two look coupled.                                                                                                                                                                                |
| E10 | `BR-04` → `BR-07`                       | **INDEPENDENT**           | `BR-07` adds job evidence, parented on `wo.jobs`. It touches `dia.diagnostic_evidence` not at all — `INS-15` is deferred as `BR-07-OPEN-01`.                                                                                                                                                                                                                                                                     |
| E11 | `BR-02` → `BR-03`                       | **INDEPENDENT**           | `BR-02` places `department_id` on `wo.jobs`, **not** on the technician profile. A technician's department is not a roster attribute.                                                                                                                                                                                                                                                                             |
| E12 | `BR-06` → `BR-04`                       | **INDEPENDENT**           | The state catalogues are `wo` data; the template lifecycle is `dia`. No shared surface.                                                                                                                                                                                                                                                                                                                          |

## 3. Execution order

| wave                      | slices                                          | why together                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0**                     | `BR-08a`                                        | Cheapest control in the plan, and every later code decision is unpoliced without it. One script, one red-proof.                                                                   |
| **1**                     | `BR-03` · `BR-04` · `BR-05` · `BR-07` · `BR-09` | Fully parallel — no edges between them. `BR-03` and `BR-04` are the two that mint codes, so they follow wave 0; the other three could run in wave 0 but gain nothing by doing so. |
| **2**                     | `BR-01` · `BR-06`                               | `BR-01` needs `BR-03`; `BR-06` wants `BR-05`.                                                                                                                                     |
| **3**                     | `BR-08b`                                        | Touches every route file the earlier waves created; doing it earlier means doing it twice.                                                                                        |
| **4**                     | `BR-08c`                                        | Needs `BR-08b`, and wants the operation set final.                                                                                                                                |
| **whenever Wave C lands** | `BR-02`                                         | Off the critical path entirely. Its column half could ship in wave 1; its usable half waits on PRE-P1-29.                                                                         |

**Maximum parallelism is five slices in wave 1.** The critical path is
`BR-08a → BR-03 → BR-01 → BR-08b → BR-08c` — five slices, complexities S · M · S · M · M.

## 4. What is technically free, and what the Owner has chosen to hold

**This section exists because the two are different, and conflating them would waste the waiting
period the external blocker has created.**

`permission-matrix.md` §8 concluded, and this plan re-verified: **PRE-P1-29 blocks P1-29
_acceptance_, not P1-29 _construction_.** The part that blocks acceptance is role provisioning —
`iam.roles`, `iam.role_permissions`, `iam.role_grants`, `iam.grant_scopes`, `iam.user_accounts` and
`org.tenants` all hold **zero rows**, so no screen can be exercised by hand until a tenant is
provisioned. Automated tests provision their own.

| slice    | technical dependency on B1 / PRE-P1-29 | held by               |
| -------- | -------------------------------------- | --------------------- |
| `BR-08a` | **none**                               | Owner sequencing only |
| `BR-01`  | **none**                               | Owner sequencing only |
| `BR-03`  | **none**                               | Owner sequencing only |
| `BR-04`  | **none**                               | Owner sequencing only |
| `BR-05`  | **none**                               | Owner sequencing only |
| `BR-06`  | **none**                               | Owner sequencing only |
| `BR-07`  | **none**                               | Owner sequencing only |
| `BR-09`  | **none**                               | Owner sequencing only |
| `BR-02`  | **Wave C, hard** — for the admin half  | a real dependency     |

**Eight of nine slices have no technical dependency on B1 at all.** The frozen B1 slice is platform
authority and tenant lifecycle; the Wave B control plane is design-only. **No P1-29 behaviour uses
either.**

The sequence `B1-PGNET-BLOCKER resolved → … → PRE-P1-29 backend remediation implementation` is the
Owner's release-governance decision and this plan does not argue with it. It is recorded as
sequencing rather than as a dependency so that **if the provider response is slow, the Owner can see
exactly what could proceed without it** — and so that nobody later mistakes a scheduling choice for
a technical constraint.

**One caution if that option is taken.** These slices land on `develop`. B1 is unmerged and carries
three migrations (127 applied vs 124 files). Any slice adding a migration while B1 is outstanding
creates a filename-series question at B1's merge, and `forbiddenMigrationPrefix` is a **filename
series, not an ordinal**. Two slices add migrations — `BR-02` and `BR-06`/`BR-07` — so the ordering
decision is theirs to carry, not a general one.

## 5. Where the requested order was wrong

Recorded plainly, because the directive asked for the chain to be kept only if analysis proved it.

| requested edge    | verdict                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BR-01 → BR-02`   | **no edge.** Departments are on `wo.jobs`; technician identity does not touch them.                                                                                      |
| `BR-02 → BR-03`   | **no edge.** A technician's department is not a roster attribute — placing it there would make a job's department depend on who was assigned, and it would be immutable. |
| `BR-03 → BR-04`   | **no edge.** `tech` roster and `dia` templates share no surface.                                                                                                         |
| `BR-04 → BR-05`   | **no edge.**                                                                                                                                                             |
| `BR-05 → BR-06`   | **real, and SOFT.** The one requested edge that survives.                                                                                                                |
| `BR-06 → BR-07`   | **no edge.** Work log and evidence are separate tables with separate shapes.                                                                                             |
| `BR-07 → BR-08`   | **real in spirit** — `BR-08c` wants every operation to exist first — but SOFT, and it applies to all slices, not just `BR-07`.                                           |
| **`BR-01` first** | **wrong.** `BR-01` is third at the earliest: `BR-08a`, then `BR-03`, then `BR-01`.                                                                                       |
| **`BR-08` last**  | **wrong for `BR-08a`**, which must be **first**. Correct for `BR-08b` and `BR-08c`. Splitting `BR-08` into three is what makes both statements true at once.             |

## 6. Definition of Ready for each slice

A slice may begin when **all** of the following hold. This is the checklist an implementing agent
runs before its first edit, not a summary.

1. Its predecessors in §2 are **closed and proved**, by the acceptance criteria in their own
   Definition of Done — not merely merged.
2. Its branch has an **ownership-profile rule declared in the branch's first commit**, longer prefix
   first where a carve-out is needed. See [governance-remediation.md](governance-remediation.md).
3. Its open questions (`BR-06-OPEN-01`, `BR-06-OPEN-02`, `BR-07-OPEN-01`, `BR-08-OPEN-01`,
   `BR-09-OPEN-01`) are either answered or explicitly confirmed as non-blocking for that slice.
4. If it adds a migration, the filename-series position is settled against B1's three outstanding
   migrations.
5. If it mints a permission code, `BR-08a` is green — or the slice records that it verified the code
   against the seed by hand and why the gate was unavailable.
