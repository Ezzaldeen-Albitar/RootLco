# P1-31 A0 preflight record

What the repository actually holds against the P1-31 canonical chapter, measured before any P1-31
task is scheduled.

|                            |                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase**                  | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                                                                                                                         |
| **Canonical chapter**      | `RootLco_Phase_1_Development_Plan_recovered_v01.docx`, paragraphs 19371–19881 — extracted in [`canonical-plan.md`](./canonical-plan.md)                                                            |
| **Repository measured at** | `origin/develop` **d7ad73f2** (tree identical to `origin/main` 1262de74)                                                                                                                           |
| **Method**                 | Static read of the git tree, `docs/api/openapi.v1.json`, and `docs/phase-1/phase-1-24/evidence/operation-register.json`. **Nothing was executed** — see [What A0 did not do](#what-a0-did-not-do). |
| **Canonical task count**   | **29**, none complete, all `Planned`                                                                                                                                                               |

---

## A0 is an execution activity, not a task

**A0 and any backend prerequisite slice are EXECUTION ACTIVITIES. They are not among the 29
canonical tasks and may not be counted as, or substituted for, one of them.**

Neither appears anywhere in Fields 14–18 of the chapter. The precedent that locates both is P1-30:
its Frontend ownership rule states in its own words that "The A0 preflight itself travels on this
lane: it adds these profiles (tooling, tests) and the read-surface matrix (docs), and no screen,"
while its backend prerequisite work travelled on separate `remediation/p1-30-*` lanes under their
own profiles. This record and the ownership rules it adds travel the same way.

Closing a prerequisite therefore closes no task. The 29 remain 29, and each still needs its own
evidence under Field 7, Field 27 and Field 32.

---

## Artefact 1 — The 29-task reconciliation

Every status below is `Planned` in the chapter and is **unchanged by this record**. The "Readiness"
column states what stands between the task and execution, measured at d7ad73f2. It is a measurement,
not a status.

Readiness vocabulary:

- **Buildable** — the contract exists and is frontend-shaped; only the work is missing.
- **Blocked** — a named backend contract, writer or read is absent, or a named decision is open.
- **Greenfield** — nothing exists yet and nothing prevents it being written.
- **Unscopable from the chapter** — the chapter names no identifier the task could be scoped
  against, so scoping is itself a decision.

### Field 14 — Frontend (16 tasks, Frontend developer)

| Task ID      | Task name               | Status  | Readiness at d7ad73f2                                                                                                                                                                                                                                                                                                                  |
| ------------ | ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-31-FE-001 | Ready-for-delivery list | Planned | **Blocked — missing contract.** The chapter declares `GET /api/v1/deliveries`; `deliveries/route.ts` exports POST only. No list, no detail, no by-work-order lookup. `DeliveryRepository.findLiveDeliveryForWorkOrder` exists and is called only from the create path, never routed.                                                   |
| P1-31-FE-002 | delivery eligibility    | Planned | **Buildable — frontend only.** `sal.delivery-eligibility-read` is complete and frontend-shaped. Entry still needs FE-001 to supply a delivery id.                                                                                                                                                                                      |
| P1-31-FE-003 | authorized receiver     | Planned | **Blocked — missing read.** The write exists; `findReceiver` is read by the eligibility composition but its row is collapsed into the `receiver_not_verified` blocker. A screen can learn _whether_, never _who_.                                                                                                                      |
| P1-31-FE-004 | delivery checklist      | Planned | **Blocked — P1-27-INT-088 and PPD-12.** No template writer, no results read, gaps capped at 20, `missingCount` dropped, and the gap scan is company-scoped rather than template-scoped.                                                                                                                                                |
| P1-31-FE-005 | final odometer          | Planned | **Buildable — frontend only.** A body field of `sal.delivery-complete`, read back through `veh.vehicle-odometer-history`. Trap: the route regex accepts two decimals, the column is `numeric(12,1)`, so `123.45` passes the route and is refused as a 422.                                                                             |
| P1-31-FE-006 | delivery signatures     | Planned | **Blocked — no signature read.** `findSignature` is write-path-only. Acceptance is image-only. The route's P1-22-L-04 docblock is stale and is a live trap for a reader (see P-14).                                                                                                                                                    |
| P1-31-FE-007 | delivery document       | Planned | **Blocked upstream.** No delivery-document or print operation, and the record, receiver, checklist results and signatures are all unreadable. Whether the document is client-composed or stored is an Owner decision (D-7).                                                                                                            |
| P1-31-FE-008 | warranty record         | Planned | **Blocked — no policy writer.** Both warranty operations are complete, but no application writer exists for `wty.warranty_policies` or `wty.warranty_coverage`; on a freshly provisioned tenant every generation returns ERR-RES-001. Becomes frontend-only if policies are configured out of band.                                    |
| P1-31-FE-009 | warranty history        | Planned | **Blocked — missing contract.** The chapter declares `GET /api/v1/warranties`; only `/warranties/{warrantyId}` exists, and it is gated on a write code. `wty.warranty_record_status_history` has no reader anywhere in `apps/api/src`.                                                                                                 |
| P1-31-FE-010 | operational dashboard   | Planned | **Blocked — no report engine, and no approved KPI definition** anywhere in the repository.                                                                                                                                                                                                                                             |
| P1-31-FE-011 | work-order reports      | Planned | **Blocked — no report engine.** The underlying reads exist and are usable.                                                                                                                                                                                                                                                             |
| P1-31-FE-012 | technician reports      | Planned | **Blocked — no report engine.** The underlying reads exist.                                                                                                                                                                                                                                                                            |
| P1-31-FE-013 | inventory reports       | Planned | **Blocked — no report engine.** The underlying reads exist.                                                                                                                                                                                                                                                                            |
| P1-31-FE-014 | invoice/payment reports | Planned | **Blocked — no report engine**, over the thinnest read base of the five: four invoice reads and **no invoice list at all**; payments have a receipt list and detail.                                                                                                                                                                   |
| P1-31-FE-015 | audit report            | Planned | **Existing usable capability** — the only scope item with a shipped screen. Two recorded constraints, not defects: export is deliberately absent, and the list is bounded to a mandatory window of at most 92 days with a fixed six-filter allow-list. Blocked in a freshly provisioned organisation only by the bundle closure (P-1). |
| P1-31-FE-016 | branch pilot summary    | Planned | **Genuine unresolved decision.** Nothing in the repository defines what it is (D-5).                                                                                                                                                                                                                                                   |

### Field 15 — Security (4 tasks, Security reviewer)

| Task ID       | Task name                                        | Status  | Readiness at d7ad73f2                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-31-SEC-001 | Permission and resolved-scope enforcement        | Planned | **Unscopable from the chapter** — it names no permission code — and gated on two decisions: which codes gate the new reads (D-9) and whether the provisioning bundle is widened (D-2). The scope mechanism itself exists and is documented as the one the P1-31 read seams inherit.     |
| P1-31-SEC-002 | Sensitive-data, export, and file-access controls | Planned | **Half measurable.** The file-access half is measurable today (attachment acceptance is image-only; downloads are gated on acceptance). The export half has no contract at all: the export resource registry admits no P1-31 resource and the authorization operation produces no file. |
| P1-31-SEC-003 | Abuse-case and privilege-escalation controls     | Planned | **Measurable today.** Permission delegation is held-only in both the application and RLS, and the eligibility override is a single blocker requiring a named permission.                                                                                                                |
| P1-31-SEC-004 | Security audit-event coverage                    | Planned | **Measurable today.** Audit classes are declared on all fourteen operations. Field 26 additionally requires that exports and privileged reads be themselves audited.                                                                                                                    |

### Field 16 — QA (5 tasks, QA lead)

| Task ID      | Task name                                | Status  | Readiness at d7ad73f2                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-31-QA-001 | Unit and component test coverage         | Planned | **Greenfield.** No web test exists for delivery, warranty or reporting. Audit has coverage through the administration e2e spec and the navigation test.                                                                                                                       |
| P1-31-QA-002 | API/contract and error-path coverage     | Planned | **Partly unscopable.** Three of the chapter's four APIs have no contract to test, and the OpenAPI response schemas for all fourteen operations on this surface are bare objects — which Field 23's closing bullet makes a chapter-level shortfall rather than a P1-31 defect. |
| P1-31-QA-003 | Tenant/company/branch isolation coverage | Planned | **Buildable.** Backend precedent exists in the P1-22 isolation suite; the scope-target mechanism is the thing under test.                                                                                                                                                     |
| P1-31-QA-004 | Concurrency and idempotency coverage     | Planned | **Buildable.** `sal.delivery-complete` is the only version-guarded operation on this surface (If-Match mandatory, ERR-CON-002 when absent); the other five commands are idempotent by body key.                                                                               |
| P1-31-QA-005 | Regression and evidence packaging        | Planned | **Blocked on convention.** The only target the chapter names is the directory `_acceptance/`, which does not exist in this repository; acceptance evidence here lives as `docs/phase-1/phase-1-NN/*acceptance*.md`. That mismatch is a decision, not a defect (D-16).         |

### Field 17 — DevOps (2 tasks, DevOps engineer)

| Task ID      | Task name                                         | Status  | Readiness at d7ad73f2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-31-DO-001 | Continuous-integration quality gate               | Planned | **Blocked before the first pull request** — and closed by this record. No `p1-31` ownership rule and no `p1-31` profile existed, while the map's unmapped policy is FAIL, so the first pull request of any P1-31 lane was refused before any other blocker could be reached. This preflight adds the rules and profiles (P-15). Separately, the gate-before-read check owns the plural `deliveries`/`warranties` segments but not the singular `/delivery` href already in navigation, nor `/reports` (P-16). |
| P1-31-DO-002 | Structured logging, monitoring, and alert routing | Planned | **Buildable.** It is also the natural place to record how a screen refreshes, given that Field 24's event-consumption requirement has no mechanism in either tier (D-10).                                                                                                                                                                                                                                                                                                                                     |

### Field 18 — Documentation (2 tasks, Business analyst / document controller)

| Task ID       | Task name                                           | Status  | Readiness at d7ad73f2                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-31-DOC-001 | Contract, catalog, and traceability synchronization | Planned | **Targets partly do not exist.** There is no `documentation/` directory, and the numbered files Field 34 names do not exist at those paths. Four real corrections are in scope regardless: the four stale delivery permission rows in the P1-22 operation inventory, the stale P1-22-L-04 docblock, the register overstatement of P1-27-INT-084, and the wrong table name in OWR-2026-09-06-G-10. |
| P1-31-DOC-002 | Operator/developer guidance and change-log update   | Planned | **Buildable.** `documentation/_registry/change-log.md` does not exist either; the repository's equivalent is the per-phase change-control register.                                                                                                                                                                                                                                               |

---

## Artefact 2 — Capability and gap table over the sixteen scope items

Every scope item is classified into exactly one of four classes:

- **A — existing usable capability.** Shipped and usable as it stands.
- **B — frontend implementation needed.** The backend contract exists and is frontend-shaped; only
  the screen is missing.
- **C — confirmed backend defect or missing contract.** Something named is absent or wrong on the
  backend side.
- **D — genuine unresolved decision.** No amount of engineering settles it; someone must decide.

**Totals: 1 A · 3 B · 11 C · 1 D.**

Fourteen published operations touch this surface — not fifteen. A substring scan returns a fifteenth,
`shared.notification-delivery-list` (`GET /api/v1/notifications/{notificationId}/deliveries`), which
is a **notification** delivery and not a vehicle delivery.

| #   | Scope item              | Class | What was measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ready-for-delivery list | **C** | The chapter declares `GET /api/v1/deliveries`. `deliveries/route.ts` registers only `sal.delivery-create` and its sole handler is POST. No list, no detail, no by-work-order lookup, and a second create answers ERR-RES-002/409 naming only the work order — so the delivery id is unrecoverable once the create response is gone. `findLiveDeliveryForWorkOrder` sits unrouted in the exact position the live-invoice-for-work-order read occupied before P1-30 A2 published it. The compensating read `wo.work-order-list` offers state, kind, opened-from/to and customer under mandatory company and branch, but **no work-order state means "ready for delivery"** and `is_closed` is true for cancelled as well as closed. Recorded as **P1-27-INT-084** and **VHM-06/WF-25**. |
| 2   | Delivery eligibility    | **B** | `sal.delivery-eligibility-read` returns eight closed blocker codes, a per-fact `established` flag distinguishing "known and bad" from "could not be read", a bounded checklist-gap sample, the single overridable blocker with the permission that overrides it, and the `recordVersion` the completion's mandatory If-Match needs. The strongest asset on the surface; only a screen is missing.                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | Authorized receiver     | **C** | `sal.delivery-receiver-verify` writes and returns the row it created; **no read exists**. `findReceiver` is called by the eligibility composition, but its row is collapsed into the `receiver_not_verified` blocker. The P1-11 frontend data contract asserts a delivery-gated view of receiver identity evidence that no published operation provides.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | Delivery checklist      | **C** | Three compounding gaps. (a) **P1-27-INT-088**, all three limbs still true — mandatory-and-unsatisfied items only, capped at 20, `missingCount` computed and then dropped before the wire. (b) **PPD-12** — the checklist template tables have no HTTP surface at all; they are SELECT-only, and the backend suites seed them by SQL. (c) The gap scan is **company-scoped, not template-scoped**, because the delivery record carries no template reference, so a second template with a mandatory item blocks every delivery in that company. On a fresh tenant the checklist is empty and the completeness blocker is vacuously satisfied.                                                                                                                                          |
| 5   | Final odometer          | **B** | A decimal-string body field of `sal.delivery-complete`; after completion the value is readable through the vehicle odometer-readings route, because the completion view carries only the reading's id. Trap: the route regex accepts two decimal places while the column is `numeric(12,1)`, so the extra digit passes the route and is refused as a 422.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | Delivery signatures     | **C** | Capture is reusable from the reception signature step and the server-side attachment upload chain, and the write is clean — a document-version reference, never bytes. But **no signature read exists**; `findSignature` is write-path-only. Acceptance is limited to JPEG, PNG and WebP and needs a readable storage provider, so **a PDF cannot be accepted**.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Delivery document       | **C** | No delivery-document or print operation exists. The blocker is upstream: the record, receiver, checklist results and signatures are all unreadable. P1-28 and P1-30 established client-composed documents with no backend print route. If instead a stored artefact is required, it inherits item 6's image-only constraint.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8   | Warranty record         | **C** | Both contracts are complete — generation accepts only an optional policy id, and the warranty view returns policy, coverage, items, dates and the odometer ceiling. But **no application writer exists for the warranty policy or coverage tables**, and `wty.policy.manage` is declared by no operation. On a fresh tenant generation always returns ERR-RES-001; with two active policies it returns ERR-VAL-001 on the policy id, and no operation lists policies. **Becomes B** if policies are configured out of band.                                                                                                                                                                                                                                                           |
| 9   | Warranty history        | **C** | The chapter declares `GET /api/v1/warranties`; only `/warranties/{warrantyId}` exists, and it is gated on the **write** code `wty.warranty.issue` because the catalogue seeds no `wty` read code. `wty.warranty_record_status_history` appears nowhere in `apps/api/src`. Recorded as **VHM-06/WF-26/PPD-13**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10  | Operational dashboard   | **C** | Zero dashboard, summary, metric, aggregate, KPI or pilot operations exist among the register's rows. The report definition view's `executable` field is the literal type `false`, because the frozen reporting schema binds no data source to a report code. No approved KPI definition exists anywhere in the repository, and the existing overview page states in its own source that it is deliberately not a business dashboard.                                                                                                                                                                                                                                                                                                                                                  |
| 11  | Work-order reports      | **C** | Same missing engine. The read base exists and is usable: work-order list, detail, history, timeline and closure eligibility; job list and history; QC record, rework and reopen-attempt lists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 12  | Technician reports      | **C** | Same missing engine. Read base: technician list, detail, queue and available; labor-session list; job-assignment list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 13  | Inventory reports       | **C** | Same missing engine. Read base: stock availability, movement list, reservation list, item search, opening-batch list and read, inventory reconciliation read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 14  | Invoice/payment reports | **C** | Same missing engine, over the thinnest read base: four invoice reads (detail, outstanding, work-order invoice, preview) and **no invoice list at all** — the shipped Invoice screen compensates by driving off the work-order list — with receipt list and detail on the payment side. The financial-events table named as a P1-23 source has no operation.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 15  | Audit report            | **A** | `iam.audit-event-list` and `iam.audit-event-detail` plus a shipped screen with gate-before-read and field names pinned to the API (P1-26-F-017). Two recorded constraints, not defects: export is deliberately absent and the route says so in its own docblock, and the window is mandatory and at most 92 days with a fixed six-filter allow-list. The seven-day default is open decision **P1-26-OD-007**. In a freshly provisioned organisation it is blocked only by the bundle closure below.                                                                                                                                                                                                                                                                                   |
| 16  | Branch pilot summary    | **D** | No operation, report code, seed, contract document or chapter field defines its content. The chapter assigns pilot and operational decisions to Benzene representatives and forbids inventing business definitions, and a pilot-specific reading collides with Field 4's "never a hard-coded owner or product-specific branch".                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### The closure that sits above all sixteen

The provisioning operation writes exactly two roles: a First Owner role holding three codes and a
Tenant Administrator role holding 67. **Neither holds any P1-31 permission** — a grep of the
bootstrap role source for `sal.delivery`, `wty.`, `rpt.` and `iam.audit` returns nothing. It holds
`sal.finance.view` but not `sal.delivery.view`, so the eligibility read fails on exactly one code.
Permission delegation is held-only in both the application and RLS, so the administrator cannot grant
what it does not hold.

**Nine codes are affected:** `sal.delivery.manage`, `sal.delivery.view`, `sal.delivery.complete`,
`wty.warranty.issue`, `wty.policy.manage`, `rpt.report.read`, `rpt.report.configure`, `rpt.export`,
`iam.audit.view`.

This is the identical closure P1-30 fixed for its commercial codes on 2026-09-06. Two of the nine
(`iam.audit.view`, `rpt.report.read`) are already registered residuals in P1-30's A0 read-surface
matrix.

**State it precisely:** these codes are unreachable **in an organisation created by the shipped
provisioning operation**. The shipped administration e2e spec drives the audit-log page
authenticated and asserts the denied state is absent, which implies that at least one environment's
actor holds `iam.audit.view` by some non-provisioning path. A0 did not measure what any live
organisation currently holds.

---

## Artefact 3 — Implementation order

### The chapter's own order

The chapter's dependency graph is **five independent linear chains with no join**. The head of each
chain depends on Phases 1-22, 1-23, 1-24 and 1-25; every later task depends only on its immediate
predecessor in the same table. No cross-table dependency exists. The only convergence declared
anywhere is Gate P1-G31.

```
Phases 1-22 / 1-23 / 1-24 / 1-25
  ├─ FE-001 ─ FE-002 ─ FE-003 ─ FE-004 ─ FE-005 ─ FE-006 ─ FE-007 ─ FE-008 ─ FE-009
  │                                                    ─ FE-010 ─ FE-011 ─ FE-012 ─ FE-013 ─ FE-014 ─ FE-015 ─ FE-016
  ├─ SEC-001 ─ SEC-002 ─ SEC-003 ─ SEC-004
  ├─ QA-001 ─ QA-002 ─ QA-003 ─ QA-004 ─ QA-005
  ├─ DO-001 ─ DO-002
  └─ DOC-001 ─ DOC-002
```

The Frontend chain is one chain of sixteen: warranty (FE-008) attaches to `delivery document`
(FE-007), and `operational dashboard` (FE-010) attaches to `warranty history` (FE-009). Nothing
branches.

**Four of the five chains may start at phase start.** SEC, QA, DO and DOC each head on the four
dependency phases and are independent of the Frontend chain.

**In practice DO-001 must go first of everything**, because until a `p1-31` ownership rule and
profile exist, the map's unmapped policy refuses the first pull request of every lane. That
prerequisite is closed by this preflight (P-15).

### What an engineer must know before honouring the Frontend chain

The chain is **generated, not designed.** Field 5's first item is Title-Case while items 2–16 are
lower-case; the Frontend table reproduces that casing anomaly exactly and carries it mid-sentence
into the descriptions. The same generator produced the Test-reference rotation that gives `final
odometer` a reporting test case. `operational dashboard` has no plausible build dependency on
`delivery document`.

Two repository facts sit against the chain read literally: the reporting group (FE-010…FE-014 and
FE-016) shares one missing contract and has no delivery dependency, and FE-015 is already shipped and
depends on nothing in the chain. Whether the chain binds execution order or is planning notation is
**decision D-8**, and its answer changes this phase's shape more than any other single decision.

### The order the prerequisites force, if the chain is planning notation

1. **DO-001 first** — the ownership rules and profiles, or nothing can be merged.
2. **The bundle decision (D-2)** — nine codes, or every screen including the already-shipped FE-015
   is unreachable in a freshly provisioned organisation.
3. **The delivery read seams** — FE-001's list or by-work-order lookup first, then the FE-003,
   FE-004 and FE-006 subresource reads. FE-002 and FE-005 are buildable the moment FE-001 supplies a
   delivery id.
4. **Warranty** — the policy-configuration decision (FE-008), then the list contract (FE-009).
5. **Reporting** — the report-definition decision (D-4) before any of FE-010…FE-014 and FE-016 can
   begin. FE-015 is independent of all of it.

---

## Artefact 4 — Exact prerequisites, by owning layer

Field 13 governs every entry here: backend work is **not applicable as new feature development** in
this phase, and **defects found here return to the owning backend phase under change control**. Which
phase owns them is itself undecided — Field 8 and Field 13 name Phase 1-24, while every P1-27
disposition row names P1-22 (decision D-1).

| #        | Prerequisite                                                | Owning layer                           | What is concerned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Blocks                                                    |
| -------- | ----------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **P-1**  | Widen the provisioning bundle to carry the nine P1-31 codes | Backend — IAM provisioning             | The Tenant Administrator role's permission codes: `sal.delivery.manage`, `sal.delivery.view`, `sal.delivery.complete`, `wty.warranty.issue`, `wty.policy.manage`, `rpt.report.read`, `rpt.report.configure`, `rpt.export`, `iam.audit.view`. The P1-30 payment-method bootstrap lane is the precedent                                                                                                                                                                                                                                                                                                                                       | **All sixteen scope items**, including the shipped FE-015 |
| **P-2**  | Publish a delivery read that yields the delivery id         | Backend — delivery read seam           | Either a by-work-order lookup over `DeliveryRepository.findLiveDeliveryForWorkOrder` or `GET /deliveries` per the chapter. The published live-invoice-for-work-order read is the precedent                                                                                                                                                                                                                                                                                                                                                                                                                                                  | FE-001, and by dependency FE-002…FE-007                   |
| **P-3**  | Publish `GET /deliveries/{deliveryId}`                      | Backend — delivery read seam           | `DeliveryRepository.findDelivery`, returning the delivery view                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | FE-001, FE-007                                            |
| **P-4**  | Publish the three delivery subresource reads                | Backend — delivery read seam           | `findReceiver` as a row rather than a blocker; `findChecklistResult`; `findSignature`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | FE-003, FE-004, FE-006, FE-007                            |
| **P-5**  | Publish a delivery status-history read                      | Backend — delivery read seam           | `sal.delivery_status_history` is written on every transition and read nowhere. **P1-27-INT-089**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | FE-007, and any "complete delivery history" claim         |
| **P-6**  | Publish `GET /api/v1/warranties`                            | Backend — warranty read seam           | The chapter's second declared API. Both the delivery-record and warranty-record tables carry a NOT NULL vehicle reference, so a vehicle filter needs no new column. **VHM-06/WF-26**                                                                                                                                                                                                                                                                                                                                                                                                                                                        | FE-009                                                    |
| **P-7**  | Mint a warranty READ permission code                        | Backend — permission catalogue         | The seed catalogue holds only `wty.policy.manage` and `wty.warranty.issue`, so the warranty detail read is gated on a **write** code. This is a NEW permission, not a re-point; the ownership tooling sanctions minting a least-privilege read code on a Backend seam lane                                                                                                                                                                                                                                                                                                                                                                  | FE-008, FE-009                                            |
| **P-8**  | Resolve `sal.delivery.read` — **RES-05**                    | Frontend (already owned by this phase) | Navigation gates `/delivery` on a code absent from the catalogue, which seeds `sal.delivery.manage`, `.complete` and `.view` only. P1-30's security-and-QA evidence assigns this open-debt entry to "the delivery Frontend"; WFP-15's entry criterion states the real code is `sal.delivery.view`. Note the nav gate is a verified false green — the navigation test checks only the Administration group. **Resolved** on `feature/p1-31-p8-navigation-delivery-permission` (PR #353): the entry now gates on `sal.delivery.view`, the parity gate's debt register is empty, and the navigation test reads the seed and checks every group | FE-001, and the phase's first navigable screen            |
| **P-9**  | Provide a delivery-checklist template writer                | Backend — delivery configuration       | The checklist template and template-item tables are SELECT-only. **PPD-12**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | FE-004                                                    |
| **P-10** | Provide a warranty-policy and coverage writer               | Backend — warranty configuration       | The warranty policy and coverage tables have no writer; `wty.policy.manage` is seeded and declared by no operation. **PPD-04**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | FE-008, FE-009                                            |
| **P-11** | Provide a report-configuration writer and a report engine   | Backend — reporting                    | The report configuration and version tables have no writer and no seed; the definition view's `executable` is the literal `false` because the frozen reporting schema binds no data source; `rpt.report.configure` is declared by no operation. P1-23's own contract archaeology lists this as its open gap                                                                                                                                                                                                                                                                                                                                 | FE-010, FE-011, FE-012, FE-013, FE-014, FE-016            |
| **P-12** | Provide `POST /api/v1/reports/{reportCode}:export`          | Backend — reporting and export         | The chapter's fourth declared API, absent twice over: there is no route, and the export resource registry admits exactly three resources — documents, outbound messages and branches — under the rule that a resource is registered or it cannot be exported. The export authorization operation produces no file                                                                                                                                                                                                                                                                                                                           | FE-010…FE-016 export paths, SEC-002                       |
| **P-13** | Correct four stale permission rows                          | Documentation — P1-22                  | The P1-22 operation inventory disagrees with the code on eligibility, receiver-verify, signature-attach and complete. The OpenAPI document matches the code. **RESOLVED** by `remediation/p1-31-backend-documentation-corrections` (PR #354): the four rows now carry the codes the routes declare                                                                                                                                                                                                                                                                                                                                          | Any frontend deriving its gates from that inventory       |
| **P-14** | Correct the stale P1-22-L-04 docblock                       | Backend — documentation in source      | The signatures route states a rule the attachment service no longer implements, and the download docblock in the same service says so. **RESOLVED** by `remediation/p1-31-backend-documentation-corrections` (PR #354) in three live copies; the two historical P1-22 records are left as written, and further copies are recorded as CC-14                                                                                                                                                                                                                                                                                                 | FE-006, FE-007                                            |
| **P-15** | Add the `p1-31` ownership rules and profiles                | CI tooling — travels on A0's own lane  | `.github/ci-baselines/phase-ownership-profiles.json` and the profiles in `scripts/ci/check-phase-ownership.mjs`. **Closed by this preflight** — see [Ownership rules added](#ownership-rules-added-by-this-preflight)                                                                                                                                                                                                                                                                                                                                                                                                                       | Every pull request in every lane                          |
| **P-16** | Extend or sibling the gate-before-read check                | CI tooling                             | That check owns the plural `deliveries` and `warranties` segments through an id namespace that excludes `rpt.` entirely, while the href already committed in navigation is the singular `/delivery`. Both P1-31 entry points escape it as things stand                                                                                                                                                                                                                                                                                                                                                                                      | DO-001, SEC-001                                           |

**None of P-1 through P-16 is a canonical task.** Each is either an execution prerequisite of this
phase or a change request against an owning backend phase under Field 13. Closing one closes no task.

---

## Status of the four re-measured findings

Each carries its **real** identifier. Where a finding has no identifier, that is recorded rather than
one being invented.

| Identifier                                                                                                 | Where recorded                                                                                                                                                                                             | Disposition                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-27-INT-088** — delivery checklist unrenderable                                                        | `docs/phase-1/phase-1-27/finding-phase-disposition.md` (Severity High, backend owner P1-22, Fixed: **No**); second record in `docs/product/owner-workflow-requirements.md`                                 | **STILL TRUE, and worse than recorded**          | All three limbs hold: the gap read returns mandatory-and-unsatisfied items only, it is capped at 20, and `missingCount` is computed and then dropped before the wire. Two further facts: the checklist **template** has no HTTP surface at all — already registered as **PPD-12**, not a new discovery — and the gap scan is **company-scoped rather than template-scoped**, because the delivery record carries no template reference, so a second template with a mandatory item blocks every delivery in that company. No repair commit exists.                                                                                                                        |
| **P1-27-INT-084** — no `GET /deliveries`; record version only in the create response                       | `finding-phase-disposition.md` (Severity **Critical**, backend owner P1-22, Fixed: **No**); register row in `owner-workflow-requirements.md`                                                               | **PARTLY TRUE — three of four limbs**            | Holds: no `GET /deliveries`, no per-work-order list, no `GET /deliveries/{deliveryId}` — the only GET anywhere under `/deliveries` is eligibility. **The fourth limb is FALSE and was already false when the finding was recorded**: the eligibility read has published the record version in both body and ETag since commit c5c80b14 (2026-07-30), an ancestor of the disposition's own read-at commit bd9f7f54 (recorded 2026-08-08). The correct statement is: **given a delivery id the version IS recoverable; there is no way to DISCOVER the id once the create response is gone.** The register row overstates it by half and should be corrected under DOC-001. |
| **Delivery employee has no identity** — **no `INT-` identifier exists for this**                           | Unlabelled register row in `docs/product/owner-workflow-requirements.md`; Owner requirement **OWR-2026-09-06-G-10** (status **Undecided**), whose dependency **OWR-2026-09-06-G-14** is also **Undecided** | **STILL TRUE**                                   | The delivery-records migration declares `delivering_employee_id uuid NOT NULL` with no foreign key among the table's other constraints; it is client-supplied at the create route under that route's own recorded concession, restated in the service and repository, and reaches the audit record as a bare identifier. Nothing resolves it to a name. Two defects in G-10 itself: it names the table `sal.deliveries` when it is `sal.delivery_records`, and it cites a superseded sibling-row wording that has since changed.                                                                                                                                          |
| **P1-27-INT-113** — six shipped operations declared the never-registered rate-limit policy `standard-read` | `finding-phase-disposition.md` (Severity **Critical**, backend owner P1-15 / P1-23, Fixed: **Yes — PR #206**); dedicated file `docs/phase-1/phase-1-27/p1-27-int-113-unregistered-rate-limit-policy.md`    | **NO LONGER TRUE — closure verified three ways** | Both report operations declare the registered `expensive-read` policy above the repair comment; the registered set is exactly five names and `standard-read` is registered nowhere; and the cause is fixed at type level, with a foundation suite asserting `standard-read` is unregistered and naming all six formerly-dead ids. **Qualifier no record carries:** "reachable" still fails twice over on a freshly provisioned tenant — `rpt.report.read` is not in the administrator bundle, and the report configuration table is seeded nowhere, so the catalogue answers empty and nothing can populate it.                                                           |

**Provenance caveat on the identifiers themselves.** The P1-27 disposition matrix records that the
register these `INT-` ids come from is not in the tree: the committed findings file allocates only
INT-001…INT-009, the deliverable manifest says so explicitly, and the matrix's own note says two
documents on `develop` disagree about whether these identifiers exist and must be reconciled.
P1-27-INT-084, -088, -089 and -113 are real rows in a committed matrix; their register is not
committed. Nine further findings in that matrix carry derived labels and need register numbers before
scheduling.

---

## What A0 did not do

Recorded so that nothing here is read as more than it is.

- **Nothing was executed in any lane.** No server was started, no request issued, no database
  queried, no test suite run, no npm command run as part of the measurement. Every "exists", "still
  true" and "no longer true" above is a static verdict read from the git tree at d7ad73f2 plus the
  OpenAPI document and the P1-24 operation register. In particular the P1-27-INT-113 closure is
  verified by declaration plus gate assertion, **not** by a 200 from a live reporting route.
- **The DDL was not read**, except for the delivery-records lines cited for the delivery-employee
  finding. Trigger, CHECK, unique-index and RLS statements are transcribed from route and service
  docblocks rather than from the migrations.
- **No measurement was taken of what any live organisation currently holds.** The bundle analysis
  proves what **provisioning** grants. Every bundle conclusion is therefore stated as "in an
  organisation created by the shipped provisioning operation".
- **The Chapter 3 requirement documents are not in this repository.** `documentation/` does not
  exist, so FR-QMS-001, FR-WTY-001…004, FR-RPT-001…004 and FR-AUD-001 could not be read. What
  `operational dashboard` or `branch pilot summary` is **required** to contain cannot be stated from
  any source available here.
- **Outbox events were not audited.** The delivery and warranty events are transcribed from the
  P1-22 operation inventory, not verified against the event catalogue or the outbox writers.
- **The operation register was not enumerated exhaustively.** Delivery, warranty, reporting, export,
  document and audit rows were read directly, and targeted scans for dashboard, summary, metric,
  aggregate, KPI, pilot, saved-filter, financial and export-suffixed operations all returned zero. A
  read-shaped "ready for delivery" projection living under a work-order or reception operation name
  containing none of those substrings was not ruled out.
- **The test-count floors, coverage ratchets and web formatting and theme gates** a P1-31 branch will
  have to meet were not measured, beyond the gate-before-read check, the scope-target mechanism and
  the ownership-profile mechanism.
- **Two named authorities were not read**: the workshop pricing/payment/delivery document that the
  vehicle-history model names as the authority on the unresolved P1-30 / P1-31 split, and P1-OD-024
  on warranty defaults and claim adjudication, named in WFP-15's entry criteria.
- **The P1-28, P1-29 and P1-30 closure records were not read for an INDIRECT closure** of
  P1-27-INT-084, -088, -089 or VHM-06. A direct identifier search finds each only in the files cited,
  and none carries a closure.
- **The P1-27 `INT-` register itself is not in the tree** — see the provenance caveat above.

---

## Decisions for the Owner

Each of these is a **DECISION**, not a task. None may be scheduled, assigned or closed by
engineering, and none is one of the 29. Each is phrased as a question with its consequence.

- **D-1 — Who owns P1-31's backend prerequisites?** Do they return to **Phase 1-22**, as every P1-27
  disposition row states, or to **Phase 1-24**, as the chapter's Field 8 and Field 13 state — and do
  they travel as change requests against that phase, or as a P1-31 prerequisite lane on the P1-30
  precedent? _Consequence:_ until this is answered, sixteen prerequisites have no owner and no lane,
  and Field 13's change-control route cannot be followed.
- **D-2 — Is the provisioning bundle widened for the nine codes, and are earlier organisations
  backfilled?** _Consequence:_ without the widening, no principal in a freshly provisioned
  organisation can hold any P1-31 permission and all sixteen scope items are unreachable, including
  the already-shipped audit screen. The bootstrap source records the backfill as an unperformed
  decision, so if the pilot organisation predates the change, widening alone does not unblock an
  acceptance run.
- **D-3 — What does "ready-for-delivery list" list?** Delivery **records** (needing P-2 and P-3), or
  **work orders eligible to open one** (buildable today from the work-order list plus per-row
  eligibility)? _Consequence:_ the second answer removes FE-001's backend prerequisite entirely, at
  the cost of accepting that no work-order state means "ready for delivery" and that the closed flag
  is true for cancelled work orders too.
- **D-4 — Who supplies the approved report definitions and KPI definitions?** The report catalogue
  service states in its own source that inventing a report-code-to-data-source binding would mean
  inventing a business report definition the Product Owner has not approved. _Consequence:_ if none
  can be supplied, the Owner must decide whether Field 7's "or the work is deliberately limited to
  decision-neutral foundations" scopes FE-010…FE-014 and FE-016 out of this phase.
- **D-5 — What is a "branch pilot summary" (FE-016)?** _Consequence:_ nothing in the repository
  defines its content or its tenancy posture, and a pilot-specific reading collides with Field 4's
  "never a hard-coded owner or product-specific branch". Without an answer FE-016 cannot be
  specified, let alone built.
- **D-6 — Does "audit report" (FE-015) mean the shipped Audit Log screen, or an exportable
  artefact?** _Consequence:_ if the shipped screen satisfies it, FE-015 is the phase's one class-A
  item. If an export is required, it needs both a route and a new entry in the export resource
  registry, and the audit route's own declaration that export is out of scope must be revisited.
- **D-7 — Is "delivery document" (FE-007) a client-composed print view or a stored document
  version?** _Consequence:_ the client-composed reading follows the pattern P1-28 and P1-30
  established and needs no backend print route. The stored reading inherits the image-only
  acceptance constraint, which means it cannot be a PDF today.
- **D-8 — Does the Frontend dependency chain bind execution order, or is it planning notation?**
  _Consequence:_ read literally it serialises all sixteen Frontend items and places the
  already-shipped FE-015 fifteenth. Read as notation, the reporting group and FE-015 can proceed
  independently. This answer changes the phase's shape more than any other.
- **D-9 — Which permission gates the delivery reads and the warranty reads?** `sal.delivery.read`
  does not exist (RES-05, already owned by this Frontend), and WFP-15's entry criterion says the real
  code is `sal.delivery.view`; warranty has no read code at all. _Consequence:_ a warranty read code
  is a **new** permission either way, which is a seed change on a Backend lane, not a Frontend edit.
  **The delivery half is decided by precedent** (P1-31 P-8): `sal.delivery.view` gates the delivery
  reads — it is the code every shipped delivery read declares, WFP-15's entry criterion names it, and
  the permission-reuse register rules that a missing `.read` code is corrected at the reference and
  never seeded. The warranty half stands open and remains P-7's Backend decision.
- **D-10 — Does Field 24 require an event-consumption mechanism, or is polling the accepted
  reading?** _Consequence:_ neither tier has any push surface, so if a mechanism is required it is a
  contract that does not exist. Field 30 permits an explicit not-applicable decision as a
  deliverable, which is the cheaper close if polling is accepted.
- **D-11 — Is P1-26-OD-007, the seven-day audit-log default window, ratified, deferred or changed?**
  _Consequence:_ FE-015 inherits whatever is decided, and shipping it without a decision carries the
  open decision forward into a second phase.
- **D-12 — Is the delivering employee's name in P1-31's scope at all?** OWR-2026-09-06-G-10 is
  Undecided and its dependency G-14 is Undecided. _Consequence:_ G-10 itself records that placement
  of the backend slice is an Owner decision "because it changes the data model the Owner has been
  told is P1-31's".
- **D-13 — Where is the P1-30 / P1-31 split for delivery and warranty?** WFP-15 records the owning
  Frontend phase as "P1-30 / P1-31 — the split is not established", corroborated in three further
  places. _Consequence:_ scheduling any delivery or warranty screen before this is answered risks
  building it in the wrong phase; the same question governs DTA-18.
- **D-14 — Is Field 7's product-name precondition superseded by OIR-01's closure on "CRM", or must
  the canonical DOCX be re-synchronised first?** _Consequence:_ the repository has already replaced
  the placeholder and a gate enforces it, so the chapter's precondition is stale rather than
  violated; P1-25's gate record logs the document re-synchronisation as non-blocking for a phase gate
  but blocking before production release or formal external delivery.
- **D-15 — Will the delivery href be `/delivery` or `/deliveries`, and should P1-31 ship a sibling
  gate-before-read check?** _Consequence:_ the existing check owns the plural segment and excludes
  the reporting namespace entirely, so as things stand P1-31's first screen and every reporting page
  escape it.
- **D-16 — Which task owns TC-P1-31-001 and TC-P1-31-002, and where do TC-WTY-001, TC-RPT-001 and
  TC-QMS-001 live?** All five return zero files from the repository, and the testing-plan document
  Field 9 names does not exist here. _Consequence:_ every one of the 29 task rows cites a test case
  that cannot currently be located, so no task can satisfy its own Test reference. The related
  convention question is where evidence lands, since Field 27 and Field 34 both require
  `_acceptance/`, which does not exist, while this repository's convention is
  `docs/phase-1/phase-1-NN/*acceptance*.md`.

---

## Ownership rules added by this preflight

Prerequisite **P-15**, closed here so that a P1-31 pull request can be opened at all.

Two lanes, mirroring the P1-30 shape:

| Branch prefix                | Profile                | Lane                                                                                                                    |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `remediation/p1-31-backend-` | `p1-31-backend` (new)  | The Backend prerequisite lane — one branch per read seam or contract this record proves missing                         |
| `feature/p1-31-`             | `p1-31-frontend` (new) | The Frontend lane. This preflight travels on it: it adds the profiles (tooling) and these records (docs), and no screen |

Both prefixes are listed with the longer, narrower Backend prefix **before** the Frontend prefix,
because the first matching prefix wins. Neither is a prefix of any existing rule and no existing rule
is a prefix of either: `feature/p1-30-` and `feature/p1-31-` diverge at the tenth character, so the
two phases cannot reach one another. There is deliberately **no** broad `remediation/p1-31-`
catch-all, so a branch nobody mapped is refused rather than absorbed.

`p1-31-frontend` permits `web`, `docs`, `tooling`, `tests` and `rootConfig`. `p1-31-backend` permits
`apiSource`, `migrations`, `dbSeeds`, `webGenerated`, `docs`, `tooling`, `tests` and `rootConfig` —
`dbSeeds` because P-7 mints a warranty read permission in the only shipping insert into the
permission catalogue, and `webGenerated` because a lane that publishes an operation must regenerate
the idempotent-operations manifest.

---

## Verification of this record

Six-plus load-bearing claims were re-checked directly against the tree at `d7ad73f2` before this
record was written, rather than being carried over on trust:

| Claim                                                              | Result                                                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| No `docs/phase-1/phase-1-31` directory exists                      | Confirmed — `docs/phase-1` runs to `phase-1-30` plus two `pre-p1-29-*` directories                                                              |
| No `p1-31` ownership rule and no `p1-31` profile exist             | Confirmed — zero occurrences of `p1-31` in the profile map and in the ownership check, before this change                                       |
| The only GET anywhere under `/deliveries` is eligibility           | Confirmed — `deliveries/route.ts` exports POST only; the single GET is the eligibility route                                                    |
| The provisioning bundle holds no P1-31 code                        | Confirmed — zero matches for `sal.delivery`, `wty.`, `rpt.`, `iam.audit` in the bootstrap role source, against one match for `sal.finance.view` |
| The warranty detail read is gated on a write code                  | Confirmed — its permissions list is `['wty.warranty.issue']`, and the seed catalogue holds only `wty.policy.manage` and `wty.warranty.issue`    |
| Navigation gates `/delivery` on a code the catalogue does not seed | Confirmed — the nav entry's permission is `sal.delivery.read`; the seed holds `sal.delivery.manage`, `.complete`, `.view` only                  |
| The report definition view is not executable                       | Confirmed — `executable` is the literal type `false` and is set to `false`                                                                      |
| The export registry admits no P1-31 resource                       | Confirmed — exactly three frozen resource codes: documents, outbound messages, branches                                                         |
| `findLiveDeliveryForWorkOrder` is unrouted                         | Confirmed — it is referenced only by the repository that defines it and by the create path in the delivery service                              |
| The gate-before-read namespace excludes reporting                  | Confirmed — the id pattern covers five namespaces, none of them `rpt`                                                                           |
| `_acceptance/` and `documentation/` do not exist                   | Confirmed — neither path is present                                                                                                             |
| The chapter's test identifiers are absent                          | Confirmed — a repository-wide search for TC-WTY-001, TC-RPT-001, TC-QMS-001 and TC-P1-31-001 returns no files                                   |

One citation correction: the report catalogue service lives under
`apps/api/src/modules/reporting/`, not under a `modules/rpt/` path. The file, the field and the
literal `false` are as measured.
