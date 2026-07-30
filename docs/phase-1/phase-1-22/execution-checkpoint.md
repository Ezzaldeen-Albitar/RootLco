# P1-22 execution checkpoint

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Branch:** `feature/p1-22-billing-payment-delivery-warranty-backend`
**Status:** **Implementation and evidence COMPLETE and green. Pre-merge verification in
progress. THE PHASE IS NOT CLOSED.**

## Current position

| Field            | Value                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| HEAD             | `6438b71446f837d111e02fda5a98de0a2782f95e` (plus uncommitted doc fixes) |
| `P1_22_BASE_SHA` | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                              |
| Migrations       | **119**, no `120`, none modified, nothing under `supabase/` touched     |
| Schema hash      | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`      |
| `origin/develop` | `0a53e540d72329e9aef6b196b68627aeb40b4c79` (unchanged)                  |
| `origin/main`    | `9c2fea162e5a270c740bac8db3546ed695a6f58a` (promoted, untouched)        |
| Feature PR       | **not opened** — opens only once the pre-merge list below is complete   |

## Both phase gates are green

```
operation-coverage:  20 registered · DEPTH 20 · invocation-only 0 · pending 0 ·
                     unit-only 0 · unreferenced 0 · metadata-only 0
p1-22 inventory:     20 operations; permissions, audit actions, events and ALL 31
                     task identifiers reconcile
```

Every figure is measured, and `metadata-only 0` in particular is measured rather than
vacuous — the structural opt-in added in `a22c666` is what makes it so.

## Test tiers

| Tier              | Files | Tests     |
| ----------------- | ----- | --------- |
| unit + foundation | 56    | **1246**  |
| backend           | 68    | **1600**  |
| database          | 138   | **1636**  |
| **total**         | 262   | **4,482** |

P1-22's own backend contribution is 209 tests: delivery 52, invoice-lifecycle 43, payments
30, currency-coherence 23, isolation 20, warranty 20, credit-note 14, concurrency 7. Plus 12
DB residual tests and 18 money-gate fixture tests. The increase over the pre-review figure
of 203 is the regression coverage for the six review Highs. `P1-22-R-01` adds no case count:
it is pinned by assertions inside the existing invoice-detail authorization test, beside the
403 it is the counterpart to, because separating them is what let the asymmetry go unnoticed.

## Static gates, all exit 0

`tsc` · `prettier --check` (whole repo) · `eslint` · operation-coverage · exact-money ·
route↔OpenAPI parity · authorization-coverage · openapi (189 paths / 219 operations) ·
module-boundaries (410 files, 11 rules) · idempotency-evidence · sal-wty-rpt
classification · no-fake-data · scope-exclusions · encoding · run-block syntax ·
workflow-security (17 workflows, 14 rules).

## Three Highs found and fixed during implementation

An earlier revision of this heading said "none of them in the archaeology". That was too
strong, and the governance review was right to refuse it: the committed
`archaeology.json` does foreshadow High 1, in the entry about
`sal.invoice_open_receivable`'s inputs being gated. What is true is narrower — none of the
three was reported AS a defect, and each had to be reproduced here before it could be
believed.

**1. The blind zero.** `sal.invoice_open_receivable` is `SECURITY INVOKER` and all three
of its inputs are gated by `sal.finance.view`, so a caller without it gets **`0` with no
error** — byte-identical to a settled invoice. Composed into the delivery gate, that waves
through an operator who may see invoices but not money, and `sal.complete_delivery` checks
no balance itself. Reproduced: 100.0000 with the permission, 0.0000 without, same invoice,
same transaction. Detected structurally, because an issued invoice ALWAYS has an amounts
row (`guard_invoice_totals_reconcile` raises at COMMIT without one), so a NULL can only
mean "you cannot see it".

**2. `sal.delivery.view` was declared by no operation.** It gates SELECT on
`sal.authorized_receivers` and `sal.delivery_signatures`, and `sal.complete_delivery` —
`SECURITY INVOKER` — reads both. A caller holding exactly what the operation declared made
those `EXISTS` checks see zero rows, so the primitive raised `check_violation` reporting
"no authorized receiver" for a delivery whose receiver was verified. **Vehicle delivery was
unreachable.** Caught by the task gate's "is every seeded permission declared by some
operation?" reconciliation — the only thing in the repository that would have noticed.

**3. `versionGuarded: true` declared and never enforced, on three routes.**
`handleOperation` demanded an `If-Match` header and handed the value to the handler; all
three discarded it. Reproduced as `If-Match: 99` against `record_version` 1 → 200, issued,
number allocated. `sal.delivery-complete` had the same defect in the more instructive
shape: its service check existed and was **inert**, because the field is optional and the
route never supplied it. A guard can be present, correct, and dead.

Highs 1 and 3 share one root cause with High 2: a `SECURITY INVOKER` function or an
optional parameter meant a declared control did not cover what it appeared to. One failed
permissively (dangerous), two failed closed (unusable).

**How 3 was caught is worth recording.** Two suite authors reproduced it independently,
left the cases FAILING with `DEFECT` comments, and refused to declare `stale-version` in
their COVERAGE-EVIDENCE. The coverage gate then named exactly two missing flags. Had either
declared the flag to make the gate green, the defect would have shipped behind a passing
gate.

## The six protected residuals, all reproduced

`tests/db/p1-22-protected-residuals.test.ts` (12 tests) proves the schema does **not**
defend six things, so if a migration ever closes one the case fails and says the
application guard is now redundant.

1. **SB1** — a JOD credit note against a USD invoice is inserted, **approved**, and 40 JOD
   subtracted from a USD gross (100.0000 → 60.0000). `P1-22-L-02`, CC-1.
2. **BR-SAL-002** — the primitive refuses 500 against a 100 receipt; a raw INSERT of the
   same 500 succeeds and drives both derivations to **−400.0000**. CC-4.
3. **SB3** — `P0002` unprovisioned, `42501` on the repairing INSERT, and a failed issue
   consumes **no** number. `P1-22-L-03` + runbook.
4. **P1-22-L-06** — `partner_outstanding_balance` returns `150.0000` for 100 USD + 50 JOD.
5. **The blind zero** (above).
6. **The outbox policy is strictly weaker than the ledger it describes.**
   `sel_event_outbox_producer` is `tenant_id = iam.current_tenant_id()` with no permission
   and no scope predicate, while `sal.receipts` and `sal.payment_allocations` require
   `sal.finance.view` plus both scope predicates — and `app_runtime` can read the `payload`
   column. So payload discipline is the only control, which is why two payloads were
   emptied of money. `sal.receipt_unallocated` is confirmed `SECURITY INVOKER`, making the
   remainder it published the one field with no other lawful source. CC-8.

## Findings recorded from the implementation

- `sal.credit_notes` has **no `deleted_at`/`deleted_by`**, unlike every other `sal` table.
- `sal.credit_notes.reason` is `NOT NULL` with no non-empty and no length CHECK;
  `invoice_status_history.reason` has neither. `requireReason()` is the only defence.
- **`invoice.status = 'credited'` is unreachable through any `sal` primitive.**
- Nothing prevents **two accepted quotations on one work order**; the service refuses with
  `ERR-CON-001` rather than choosing by `created_at`.
- **The invoice preview has no tax-configuration lookup at all.** Tax comes from
  `quo.quotation_items.captured_tax_rate`, which is `NOT NULL DEFAULT 0`. The brief's
  "controlled configuration error for missing tax" was not implementable here because there
  is no configuration for this phase to find missing; the real never-a-silent-zero guard on
  that path is `resolveCommercialSource`, and all three ways a commercial source can fail
  are asserted instead.

  An earlier revision of this entry then went one step too far and called rate 0 "a
  legitimate 'no tax', not a missing configuration". Zero IS the only reachable rate —
  `org.tax_classes` has no rows and no writer, so `price_rules.tax_class_id` is unsettable —
  which means the platform cannot presently distinguish "no tax applies" from "tax was never
  configured". That is now `P1-22-L-08` and `CC-7`, and the route docstring says so instead
  of asserting the opposite.

- `resolveCommercialSource`'s `itemCount === 0` branch is **dead code**:
  `rollUpDecisions` returns `null` for an item-less revision, so the `accepted` filter
  removes it first.
- `problemFor` assembles a response from the catalog entry plus `safeDetails` only, so an
  `AppFailure` message is **never observable over HTTP**. Asserted structurally: the
  problem document's keys are exactly `code, correlationId, status, title, type`, and the
  raw text matches no constraint name, index name, SQLSTATE, schema-qualified table or SQL
  verb.
- `billing-repository.ts` reads `quo.*` read-only, widening a boundary the checker does not
  police. It follows established practice (`inventory-repository.ts` reads
  `wo.work_orders`) and the alternative forces a TypeScript sum.
- `scripts/ci` moved 26 → 27 scripts, and `tests/ci/documented-counts.test.ts` failed on
  exactly that discrepancy rather than it being noticed in review.

## The fifteen independent reviews — 0 Critical, 6 High, all reproduced and fixed

Fifteen read-only reviews ran against the feature head, one per lens. They returned
**0 Criticals and 7 High findings, of which 6 were distinct** — the draft-invoice defect was
found independently by both the delivery-eligibility lens and the test-honesty lens, which
is worth recording: two different questions arrived at the same hole.

Every High was reproduced here before being changed, and each fix is pinned by a mutation
in `scripts/ci/hostile-mutations.mjs` (`M-22-10`…`M-22-14`) as well as by a test.

| #   | Lens                                | Finding                                                                                                                 | Treatment                                                                                                                    |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | delivery eligibility · test honesty | A **draft** invoice switched the financial blocker OFF, so creating one was strictly MORE permissive than creating none | `collectable`/`status` added to the receivable view; a not-issued invoice now blocks and the fact names the status           |
| 2   | receiver & signature privacy        | `linkedToEntity` discarded, so **any** document version in the tenant could be the handover signature                   | Provenance now required against the delivery's work order or reception visit, checked after the document's own scope checks  |
| 3   | tax & discount neutrality           | The docstring claimed a missing tax configuration is a controlled error; zero is the only reachable rate                | Both false statements replaced with the fact; recorded as `P1-22-L-08` and `CC-7`. Behaviour unchanged and already correct   |
| 4   | money & currency                    | No amount was validated against `shared.currencies.minor_unit`, despite the platform standard claiming it is            | `assertMinorUnitScale` at the three inbound money paths; a half-cent USD amount is refused instead of stranding a receivable |
| 5   | audit, outbox & events              | `receipt.recorded`/`payment.allocated` carried restricted money into the one table with no permission policy            | Amount, currency, receipt number and the derived remainder removed; `receiptStatus` retained                                 |
| 6   | API surface & OpenAPI               | `sal.delivery-complete` demanded an `If-Match` **no operation published**, so it was unreachable                        | The eligibility read publishes `record_version` as body field and ETag, and no longer requires `sal.delivery.manage`         |

Three of the six were reachability or disclosure defects that every green test in the phase
had walked past, and in each case the reason was the same shape: the suite proved the guard
worked without ever proving the path was usable. The completion tests took their `If-Match`
from a superuser read; the signature tests reused one unlinked fixture document for every
delivery in the suite; the financial tests always issued the invoice first.

Two false claims were also corrected rather than defended: the "no unlabelled money"
invariant did not hold for `InvoicePreview`'s ten per-line amounts (the response labels them
once, at document level, which is now what the comment says), and the preview's promise that
it "cannot disagree with the invoice it is previewing" was breakable because `sum()` returns
unconstrained `numeric` — every previewed figure now passes `Decimal.fromDatabase(_, MONEY)`,
which is the same drift check the invoice path applies.

## Medium and Low findings — triaged, and open rather than quietly dropped

The same fifteen reviews returned roughly thirty Medium and sixty Low findings. None is a
Critical or a High, and the gate's bar is `Critical 0 / High 0`, so these are recorded here
with a decision against each theme rather than fixed silently or left unmentioned.

**Corrected, because they were false statements in this phase's own documents.** The tax
guarantee (now `P1-22-L-08`), the "money is never returned unlabelled" invariant, the
preview's "cannot disagree with the invoice" promise, and the stale permission sets in
`operation-inventory.md` — the last regenerated from source, so the document can no longer
disagree with the declarations it describes.

**Open and named, because closing them would invent policy this phase was not given:**

| ID           | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-22-R-01` | `sal.invoice-outstanding-read` requires only `sal.finance.view`, so a principal refused `GET /invoices/{id}` can still read that invoice's status and exact open receivable. Every other invoice-addressed operation also requires an invoice permission. Both readings are defensible — a cashier needs the outstanding figure to take payment, and `sal.invoice.read` does not exist — and what was actually wrong is that nothing recorded the decision.                                                             |
| `P1-22-R-02` | A **cancelled** work order satisfies the `work_order_not_complete` blocker, because the delivery module tests `is_closed` and `cancelled` carries `is_closed = true`. `wo.guard_work_order_closure` returns early for a cancellation, so B1–B4 were never enforced on that path, and this module composes substitutes for B5a/B5b/B6 only. Blocking a cancelled job's handover would be the wrong answer — the customer still takes the vehicle back — so the correct fix is a policy decision, not a code change here. |
| `P1-22-R-03` | `POST /payments` needs a `sal.payment_methods` row and no operation creates one, so payment recording depends on operator provisioning in the same way numbering does (`P1-22-L-03`). The four read/write payment operations are reachable only after that provisioning.                                                                                                                                                                                                                                                |
| `P1-22-R-04` | The `P0002` numbering diagnostic is composed and then discarded — `problemFor` emits no message, so the sentence naming the missing `(company, branch, sequence_code)` tuple reaches no sink. `SB3`'s treatment is documented as though a caller sees it; the runbook is the actual delivery mechanism.                                                                                                                                                                                                                 |
| `P1-22-R-05` | Several claims of the form "no test exercises this" hold: the receiver identity-evidence path, the party-role time predicate, and the warranty covered-items path are reachable but unasserted. They are coverage gaps, not defects — each was read and none is wrong.                                                                                                                                                                                                                                                  |

**Accepted as accurate but not acted on:** the archaeology-attribution wording (High 1 _was_
foreshadowed by a committed archaeology entry, and the checkpoint's earlier "none of them in
the archaeology" was too strong — corrected above), the OpenAPI document's omission of 404 /
400 / 201 and request bodies, which is a platform-wide generator property and not this
phase's to change, and the observation that `P1-22-DO-001` would stay green if a workflow
stopped invoking the P1-22 gates — true, and the same vacuous-evidence shape this phase
already fixed twice, but the fix belongs to the CI initiative's own gate rather than here.

`P1-22-L-01` warranty claim adjudication · `L-02` currency equality is application-only ·
`L-03` numbering requires operator provisioning · `L-04` signatures bind but cannot be
retrieved · `L-05` no refund/partial reversal/multi-invoice credit/ledger ·
`L-06` `partner_outstanding_balance` mixes currencies · `L-07` the warranty payer split is
always customer-100%, because no protected configuration determines it at invoice time —
so `sal.issue_invoice` emits no `warranty_split_recorded` event today ·
`L-08` the reachable tax rate is always zero, because `org.tax_classes` has no rows and no
writer, so `price_rules.tax_class_id` is unsettable.

Change-control candidates CC-1..CC-8, none acted on, all needing a migration.

## Remaining before closure

1. Freeze `FINAL_FEATURE_SHA`; feature PR against `develop`; require every check-run,
   `ci-gate`, the hosted clean room, PR CodeQL **and an explicit full-tree CodeQL on the
   exact feature head** — reconciled against the GitHub alert list and the complete
   `/commits/{sha}/check-runs` list, **never `/actions/runs`, which does not list every
   check**.
2. Merge commit; verify parents, containment, byte-identical tree, zero drift, 119
   migrations, unchanged schema hash.
3. Gate record on `gate/p1-22-billing-payment-delivery-warranty-backend`.

## Verified state at the close of the review round

| Tier              | Count     |
| ----------------- | --------- |
| unit + foundation | **1246**  |
| backend           | **1600**  |
| database          | **1636**  |
| **total**         | **4,482** |

Operation depth 20/20 with `pending`, `unit-only`, `invocation-only`, `unreferenced` and
`metadata-only` all measured at 0. Task gate 31/31. Exact-money audit 42 files, 0 findings.
Hostile mutation matrix 45/45 caught. OpenAPI regenerated for the one changed permission
set, a one-line semantic diff. 119 migrations, no 120, schema hash unchanged.

### The coverage ratchet caught the fix for finding 4

Worth recording, because it is the same shape as everything else on this branch. The
first push of the review fixes went red on `unit-tests-coverage`: global lines and
statements fell 93.26% → 92.43% and functions 84.75% → 83.74%, all outside the 0.5 pp
tolerance.

The cause was a single function. `assertMinorUnitScale` lives in
`src/server/http/validation.ts`, which is one of the twelve paths in the unit tier's
coverage `include` list, and it arrived with no unit test — every case exercising it went
in at the backend tier, whose coverage is deliberately not merged. So a money guard was
shipped with its only proof one layer away from where it is measured.

Seven unit cases now cover it directly, including the two that matter most for a
string-only comparison: trailing zeros are insignificant (`100.0000` is valid USD, and is
what every read out of `numeric(18,4)` looks like), and a twenty-digit value is judged
exactly, where a `Number()` implementation would drop the offending digit and answer
"fine". Coverage is now 93.37% lines and statements, 84.87% functions, 93.73% branches —
above the baseline on all four axes rather than merely back inside tolerance.
