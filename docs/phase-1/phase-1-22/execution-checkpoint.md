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
| unit + foundation | 56    | **1239**  |
| backend           | 68    | **1594**  |
| database          | 138   | **1634**  |
| **total**         | 262   | **4,467** |

P1-22's own backend contribution is 203 tests: invoice-lifecycle 43, delivery 49,
payments 29, currency-coherence 21, isolation 20, warranty 20, credit-note 14,
concurrency 7. Plus 10 DB residual tests and 18 money-gate fixture tests.

## Static gates, all exit 0

`tsc` · `prettier --check` (whole repo) · `eslint` · operation-coverage · exact-money ·
route↔OpenAPI parity · authorization-coverage · openapi (189 paths / 219 operations) ·
module-boundaries (410 files, 11 rules) · idempotency-evidence · sal-wty-rpt
classification · no-fake-data · scope-exclusions · encoding · run-block syntax ·
workflow-security (17 workflows, 14 rules).

## Three Highs found and fixed, none of them in the archaeology

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

## The five protected residuals, all reproduced

`tests/db/p1-22-protected-residuals.test.ts` (10 tests) proves the schema does **not**
defend five things, so if a migration ever closes one the case fails and says the
application guard is now redundant.

1. **SB1** — a JOD credit note against a USD invoice is inserted, **approved**, and 40 JOD
   subtracted from a USD gross (100.0000 → 60.0000). `P1-22-L-02`, CC-1.
2. **BR-SAL-002** — the primitive refuses 500 against a 100 receipt; a raw INSERT of the
   same 500 succeeds and drives both derivations to **−400.0000**. CC-4.
3. **SB3** — `P0002` unprovisioned, `42501` on the repairing INSERT, and a failed issue
   consumes **no** number. `P1-22-L-03` + runbook.
4. **P1-22-L-06** — `partner_outstanding_balance` returns `150.0000` for 100 USD + 50 JOD.
5. **The blind zero** (above).

## Findings recorded from the implementation

- `sal.credit_notes` has **no `deleted_at`/`deleted_by`**, unlike every other `sal` table.
- `sal.credit_notes.reason` is `NOT NULL` with no non-empty and no length CHECK;
  `invoice_status_history.reason` has neither. `requireReason()` is the only defence.
- **`invoice.status = 'credited'` is unreachable through any `sal` primitive.**
- Nothing prevents **two accepted quotations on one work order**; the service refuses with
  `ERR-CON-001` rather than choosing by `created_at`.
- **The invoice preview has no tax-configuration lookup at all.** Tax comes from
  `quo.quotation_items.captured_tax_rate`, which is `NOT NULL DEFAULT 0` — so rate 0 is a
  legitimate "no tax", not a missing configuration. The brief's "controlled configuration
  error for missing tax" was not implementable because there is nothing to be missing; the
  real never-a-silent-zero guard on that path is `resolveCommercialSource`, and all three
  ways a commercial source can fail are asserted instead.
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

## Accepted limitations

`P1-22-L-01` warranty claim adjudication · `L-02` currency equality is application-only ·
`L-03` numbering requires operator provisioning · `L-04` signatures bind but cannot be
retrieved · `L-05` no refund/partial reversal/multi-invoice credit/ledger ·
`L-06` `partner_outstanding_balance` mixes currencies · `L-07` the warranty payer split is
always customer-100%, because no protected configuration determines it at invoice time —
so `sal.issue_invoice` emits no `warranty_split_recorded` event today.

Change-control candidates CC-1..CC-6, none acted on, all needing a migration.

## Remaining before closure

1. Hostile mutation matrix — 40 entries including the nine P1-22 ones; running.
2. The fifteen independent read-only reviews; personally reproduce every Critical and High.
3. Freeze `FINAL_FEATURE_SHA`; feature PR against `develop`; require every check-run,
   `ci-gate`, the hosted clean room, PR CodeQL **and an explicit full-tree CodeQL on the
   exact feature head** — reconciled against the GitHub alert list and the complete
   `/commits/{sha}/check-runs` list, **never `/actions/runs`, which does not list every
   check**.
4. Merge commit; verify parents, containment, byte-identical tree, zero drift, 119
   migrations, unchanged schema hash.
5. Gate record on `gate/p1-22-billing-payment-delivery-warranty-backend`.
