# P1-29 — authoritative execution decision

**Recorded 2026-08-23, at the close of the P1-29 Preparation & Design slice.**
This document is the decision. Where any other document in this set reads
differently, this one governs and the other is to be corrected.

P1-29 implementation has **not** started. Nothing here authorises code.

---

## 1. The decision

### 1.1 Diagnostics remains in P1-29 scope

**DIAGNOSTICS IS IN P1-29 FINAL SCOPE.** It is not deleted, not deferred to a
later phase, not silently reclassified, and the phase is not renamed.

The canonical phase remains three things:

> **Work Order · Diagnostics · Technician Experience**

What preparation established is narrower and different: the **Diagnostics
frontend slice is blocked** until its Backend prerequisite closes (`INS-09` —
there is no HTTP authoring surface and no permission vocabulary for the
diagnostic template lifecycle). An early P1-29 slice **may** ship without
Diagnostics UI, provided its own dependencies are satisfied.

**P1-29 MUST NOT BE DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE
REQUIRED BY ITS CANONICAL OWNER REQUIREMENTS.** Closure without it is not a
reduced pass; it is not a pass.

### 1.2 The distinction that produced this decision

Preparation found that several canonical capabilities are not presently
implementable because prerequisite Backend contracts do not exist. That is a
statement about **sequence**, not about **scope**:

> **IMPLEMENTATION ORDER MUST CHANGE — PHASE SCOPE MUST NOT SHRINK.**

The failure mode this guards against is a familiar one: a phase meets a
difficulty, quietly narrows its own definition, closes green, and the
capability is never built by anybody because no phase owns it any more. P1-29
does not get to do that. A blocked capability stays in the phase, stays visible,
and blocks closure until it is delivered.

---

## 2. Phase classification

**P1-29 CANNOT BE EXECUTED AS A FRONTEND-ONLY PHASE.**

It is classified as a **mixed phase** with three parts, in this order:

| part                         | content                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **BACKEND PREREQUISITES**    | the contracts and capabilities enumerated in [backend-prerequisite-gate.md](backend-prerequisite-gate.md), which no closed phase exposes |
| **FRONTEND IMPLEMENTATION**  | the screens, adapters, contract mirror and gates in [implementation-slices.md](implementation-slices.md)                                 |
| **INTEGRATION / ACCEPTANCE** | the cross-tier proof and the Owner journey in [test-and-acceptance-plan.md](test-and-acceptance-plan.md)                                 |

### 2.1 What this does _not_ say about P1-19

**P1-19 remains historically closed and is not reopened, re-judged, or called
incomplete.** P1-19 delivered what it was scoped to deliver: 58 operations
across work-order, diagnostics, quality and technician, with guards, RLS, audit
classes and version guarding throughout. The database layer beneath it —
P1-9 — is likewise complete, and in the diagnostics case is _more_ complete than
the HTTP layer that sits on it.

The finding is narrower and should always be stated in its narrow form:

> **P1-29's actual frontend requirements need contracts and capabilities that no
> closed phase currently exposes.**

Two examples make the difference concrete. The diagnostic template lifecycle is
fully modelled and guarded in the database — three tables, a
`draft → published → retired` transition guard, and an items-frozen-on-publish
guard — and has no HTTP surface at all. The work-order and job state catalogues
are computed by a service that exists (`WorkOrderCatalogService`) and are
reachable from no route. In neither case is a closed phase defective. In both
cases the contract a frontend needs was never anyone's deliverable.

---

## 3. Closure condition

P1-29 closes only when **all three** of these hold:

1. Every Backend prerequisite in
   [backend-prerequisite-gate.md](backend-prerequisite-gate.md) that a delivered
   frontend capability depends on is **closed and proved**, by the acceptance
   proof recorded against it.
2. The canonical Owner requirements — including the **Diagnostics experience** —
   are met, or are explicitly deferred by a recorded Owner decision naming the
   phase that will own each one. Silence is not deferral.
3. An explicit **`OWNER ACCEPTANCE: PASS`** against a production build. Silence
   is not Pass. This rule was established after P1-26 was closed once on
   unproven claims and reopened, and it has been applied without exception
   since.

---

## 4. Execution order

The invariant, which outranks the labels:

> **A Backend prerequisite precedes every frontend feature that consumes it.**

| slice        | content                                                                                                                            | gating prerequisite                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **P1-29-A0** | **Backend prerequisite remediation** — close the hard contract gaps                                                                | —                                                 |
| **P1-29-A**  | Frontend contract / data layer: feature module, permission constants, contract mirror, read adapters, and the phase's own CI gates | —                                                 |
| **P1-29-B**  | Work-order active queue and history                                                                                                | —                                                 |
| **P1-29-C**  | Work-order detail, lifecycle and assignment                                                                                        | `BE-1` for the job graph; `BE-3` for the customer |
| **P1-29-D**  | Technician workspace                                                                                                               | `BE-2` for caller→technician identity             |
| **P1-29-E**  | **Diagnostics experience**                                                                                                         | `BE-4` — **hard block**                           |
| **P1-29-F**  | Inventory / quotation / approval integration                                                                                       | —                                                 |
| **P1-29-G**  | History, concurrency, exceptions and polish                                                                                        | —                                                 |
| **P1-29-H**  | Owner acceptance and remediation                                                                                                   | all of the above                                  |

[implementation-slices.md](implementation-slices.md) carries the bounded
decomposition — its lettered slices, their exit criteria and their dependency
graph are the working plan, and it maps onto this order. Where the two differ in
granularity, the slice document is the finer instrument and this table is the
commitment.

**A0 is not optional and is not a parallel track.** A frontend slice that
consumes a prerequisite may not begin before that prerequisite closes, and the
gate document records, per prerequisite, exactly which screens and actions are
waiting on it.

---

## 5. Bindings that survive this decision

These were established by preparation and are not reopened by it.

| #   | binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Work-order creation is reception conversion only.** There is no generic `POST /work-orders`; its absence is deliberate and documented in the route file (a second insert would not hold the reception-visit lock, so two concurrent callers would race `uq_work_orders_ordinary_origin` and one would receive a raw `23505`). P1-29 consumes `rec.reception-convert-to-work-order` and designs no duplicate create form or endpoint. The P1-29 queue begins from work orders that conversion produced. |
| 2   | **No generated OpenAPI client.** The document declares zero request bodies and zero typed success schemas. P1-29 follows the established pattern: API TypeScript contract source → frontend contract mirror → parity/contract gate. `apps/web` must not import `apps/api` runtime source.                                                                                                                                                                                                                |
| 3   | **No client-side technician identity resolution.** Matching by name, email or display text, or iterating profile ids, is forbidden — it is a correctness defect and an enumeration oracle. Identity must be backend-authoritative, with tenant and branch containment enforced.                                                                                                                                                                                                                          |
| 4   | **No hard-coded work-order or job state graph.** Those catalogues are tenant-overridable data. The diagnostic report lifecycle is the opposite — hard-coded plpgsql — and must be hard-coded by the UI. Getting either backwards is a defect.                                                                                                                                                                                                                                                            |
| 5   | **Operation-level authorization is the only permission control in this domain.** No RLS policy in `wo`, `dia`, `tech` or `qms` consults a permission code except `iam.sensitive.view` on three restricted sidecars. RLS does not compensate for a wrong or missing declaration.                                                                                                                                                                                                                          |
| 6   | **No fabricated business data.** Nothing may be seeded to make a screen work. Where a catalogue is empty, the screen says so.                                                                                                                                                                                                                                                                                                                                                                            |

---

## 6. Provenance

Derived from the twelve-document preparation set on branch
`planning/p1-29-work-order-diagnostics-technician-preparation`, base
`c081a019`. The canonical scope statements this decision preserves are:

| source                                                                        | says                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/product/owner-workflow-requirements.md:33`, `:220`                      | the phase name, and the sixteen Owner requirements                                                                                                                                                                                                                                                         |
| `docs/phase-1/phase-1-9/p1-29-frontend-contract.md`                           | the P1-9-era read-model contract P1-29 was always expected to render: work-order board, job/labour view, technician view, **diagnostic report view (the pinned published template version, item results, findings, measurements, DTC records, recommendations)**, quality/closure view, and four timelines |
| `docs/phase-1/phase-1-27/finding-phase-disposition.md:204`                    | the P1-27 findings assigned to this phase                                                                                                                                                                                                                                                                  |
| `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:30`, `:254` | P1-29 named as the successor of the PRE-P1-29 initiative                                                                                                                                                                                                                                                   |

The P1-9 contract is worth singling out: it named the diagnostic report view —
**including the pinned published template version** — as a P1-29 deliverable at
the time the database was built for it. Diagnostics has been in this phase's
scope since the schema was designed. That is the strongest reason not to let a
missing HTTP surface remove it now.
