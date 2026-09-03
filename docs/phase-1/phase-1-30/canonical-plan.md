# Phase 1-30 — Services, Quotations, Inventory, Billing, and Payments Frontend — canonical plan

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: OPEN — started 2026-09-03 on the closure of P1-29 (`docs/phase-1/phase-1-29/closure-record.md`); nothing delivered yet**

## 0. Why this document exists

The governing register, `RootLco_Phase_1_Development_Plan_recovered_v01.docx`, is deliberately
outside Git (`docs/governance/canonical-documents.md`, `"committedToGit": false`). Its P1-30 entry
names twenty-one Frontend tasks (P1-30-FE-001 … P1-30-FE-021), four Security tasks, five QA tasks,
two DevOps tasks and two Documentation tasks, and traces them to FR-SVC-001…004, FR-QUO-001…004,
FR-INV-001…003 and FR-SAL-001…003. This document answers, inside the repository, the four questions
the register cannot: what P1-30 owns, what it does not own, what its work items are on this
codebase as it actually is, and what completion means. It is a **binding record, not a plan
revision** — where an authority exists it is cited, never copied.

It is written the way P1-29's was, because P1-29's way held: every work item is measured against
protected `develop` before it is claimed, every screen proves PC-1 on a real response, and the phase
closes only on an explicit Owner verdict on a production build.

## 1. What P1-30 owns

### 1.1 The Owner requirement table — the authority

The register's P1-30 field 5 lists the scope verbatim: service catalog; price lists; quotation
builder; quotation versions; discount request; tax display; approval display; item search; stock
balance; reservations; issues; returns; stock movements; invoice preview; invoice issue; payment
form; partial payment; receipt; outstanding balance; invoice print; receipt print. Field 14 turns
each into one task with the same acceptance sentence: against the approved UI prototype and the
approved backend contract, Arabic/English, RTL/LTR, desktop/tablet, accessibility, and
loading/empty/error/permission states.

### 1.2 The read-model contracts — the authority

Two Database phases wrote the read models P1-30 renders, and they are cited, not restated:

- `docs/phase-1/phase-1-10/p1-30-frontend-contract.md` — services, pricing, quotations, inventory,
  operations, timelines; cost and margin fields render only with `inv.cost.view`.
- `docs/phase-1/phase-1-11/phase-1-11-p1-30-31-frontend-data-contract.md` — invoices, payments,
  receipts, outstanding balance, corrections; amounts render only with `sal.finance.view`, the
  structural half renders without it.

### 1.3 The Backend surface as it is on `develop`

Counted from the route declarations under `apps/api/src/app/api/v1` at P1-29's closure, not from
any document: `svc` 11 operations, `quo` 6, `inv` 14, `sal` 18. Permission codes under those
prefixes in `supabase/seeds/04_iam_permission_catalog.sql`: 27. Read-shaped operations among them:
`svc.service-list`, `svc.price-list-list`, `svc.price-resolve`, `quo.quotation-detail`,
`inv.item-search`, `inv.stock-availability-read`, `inv.stock-movement-list`,
`inv.inventory-reconciliation-read`, `sal.invoice-preview`, `sal.invoice-detail`,
`sal.invoice-outstanding-read`, `sal.receipt-detail`, `sal.payment-method-list`,
`sal.delivery-eligibility-read`.

What is visibly absent from that list is stated as a **question for A0, not a finding**: a
quotation list, an invoice list, a receipt or payment list, a service detail and a price-list
detail. P1-27 taught that a read surface a Frontend phase assumes and a Backend phase never wrote is
the dominant defect class; P1-29 answered it with a measured Backend prerequisite lane (BR-01 …
BR-09) before any screen. P1-30 does the same, and A0 is where the measurement happens.

### 1.4 The lane

Frontend work travels on `feature/p1-30-*` under a `p1-30-frontend` ownership profile (web, docs,
tooling, tests, rootConfig; `apiSource` forbidden). Backend prerequisites that A0 proves necessary
travel on `remediation/p1-30-backend-*` under a `p1-30-backend` profile, one branch per contract,
merged before the screen that needs them. Neither profile exists yet; adding them is A0's first
deliverable, judged by `tests/ci/phase-ownership.test.ts` like every other profile.

## 2. What P1-30 does not own

- **Backend feature development.** Register field 13: backend capability is delivered and gated by
  the Backend phases; defects found here return to the owning lane under change control. A P1-30
  Frontend branch never changes `apps/api`.
- **Schema.** Register field 12: a discovered schema defect returns through change control.
- **Visual design.** Frontend phases implement owner-approved prototypes only (OIR-06).
- **The excluded vehicle inspection and evaluation service line** (ADR-010, out-of-scope register P1-OOS-026) — outside Phase 1, and the repository guard `npm run security:scope-exclusions` keeps its name out of every tracked file, this one included.
- **Country-, tax-, currency-, payment-, retention- or policy-specific defaults** that remain open
  decisions — the screens render what the Backend resolves and invent nothing.
- **The diagnostic and QC vocabularies** — P1-29's W9-R4 was closed by the Owner's seed decision;
  the QC check vocabulary (W9-O6) remains the Owner's to decide and is not P1-30 scope.
- **The pilot tenant.** The first subscribed organization is configuration, never a branch in the code, and its name is held out of the repository by the same guard.

## 3. Closure condition — money is rendered from the server's arithmetic, never the client's

The register's cross-cutting rule (field 22) and the P1-10/P1-11 contracts agree on one thing that
this document makes non-negotiable: **no P1-30 screen computes a price, a total, a tax, a discount
or a balance.** A resolved price comes from `svc.price-resolve`; totals come from the quotation
revision's captured figures; the outstanding balance comes from `sal.invoice-outstanding-read`.
A screen that re-implements precedence or arithmetic on the client has shipped a second source of
truth, and the phase is not complete while one exists. The gate for this is mechanical (A0 names
it) and the sentence to search for is `P1-30 RENDERS SERVER ARITHMETIC ONLY`.

## 4. Execution matrix

| item | what                                                                                                                                                                                                            | proves                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A0   | Preflight: ownership profiles; read-surface measurement against `develop` (every screen in §1.1 mapped to an existing operation or to a named Backend prerequisite with a contract); the server-arithmetic gate | the map, with counts; no screen starts on an assumed read model                   |
| BR   | Backend prerequisites A0 named, one branch each on the Backend lane, merged first                                                                                                                               | each contract's route answers on a real tenant with PC-1                          |
| W1   | Service catalog and per-branch availability (FE-001)                                                                                                                                                            | PC-1 on `svc.service-list`; retired and unavailable services rendered as such     |
| W2   | Price lists, versions, rules, resolved price (FE-002, FE-006)                                                                                                                                                   | a resolved price shown is the server's; tax display from the resolved figures     |
| W3   | Quotation builder, revisions, item decisions, discount request, approval display (FE-003 … FE-005, FE-007)                                                                                                      | totals are captured figures; an approval-limit refusal renders as refusal         |
| W4   | Item search, stock balance, reservations (FE-008 … FE-010)                                                                                                                                                      | `inv.cost.view` gates cost fields; availability is the server's                   |
| W5   | Issues, returns, stock movements (FE-011 … FE-013)                                                                                                                                                              | the movement ledger renders in `seq` order; idempotent commands carry keys        |
| W6   | Invoice preview, issue, outstanding balance, print (FE-014, FE-015, FE-019, FE-020)                                                                                                                             | `sal.finance.view` splits the screen; issue is version-guarded                    |
| W7   | Payment form, partial payment, receipt, receipt print (FE-016 … FE-018, FE-021)                                                                                                                                 | allocation renders from `sal.payment-allocate`'s result; partial leaves a balance |
| W8   | Security and QA evidence (SEC-001 … 004, QA-001 … 005), documentation (DOC-001, DOC-002)                                                                                                                        | the tiers, the access and parity gates non-vacuous, the evidence package          |
| W9   | Owner acceptance on a production build, by hand, on a fresh organization                                                                                                                                        | the explicit verdict                                                              |

Each W-item is measured before it is claimed, in a record under `docs/phase-1/phase-1-30/`, the
way P1-29's W-items were.

## 5. What completion means

P1-30 is complete when **all** of the following hold:

1. Every scope item in §1.1 is implemented, reachable, and mapped in A0's record to the operation
   that serves it.
2. No screen computes money (§3), proved by the gate A0 names.
3. Every screen proves PC-1 on a real response: authorized sees, unauthorized is refused,
   cross-tenant is invisible; `inv.cost.view` and `sal.finance.view` split the screens as the
   contracts say.
4. No static fixture on the production path.
5. The Frontend/Backend boundary holds: no API source changed by a P1-30 Frontend branch.
6. The access and payload-parity gates pass non-vacuously over the P1-30 route pages.
7. Owner acceptance recorded as an explicit verdict on a production build (W9).

## 6. How this document is kept honest

It states no count it does not cite; the counts in §1.3 were taken from `develop`
`c3c62398` and any later figure supersedes them by measurement, not by edit. The sentence
`P1-30 RENDERS SERVER ARITHMETIC ONLY` is the closure condition's search key.
