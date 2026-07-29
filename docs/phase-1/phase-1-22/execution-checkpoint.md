# P1-22 execution checkpoint

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Branch:** `feature/p1-22-billing-payment-delivery-warranty-backend`
**Status:** **Wave 1 COMPLETE. Evidence wave IN PROGRESS. THE PHASE IS NOT CLOSED.**

## Current position

| Field                 | Value                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- |
| HEAD                  | `8efbd6e98e72fed5fdb640a286c4c6ffa9e18334`                                            |
| Remote                | pushed — `origin/feature/…` equals HEAD                                               |
| `P1_22_BASE_SHA`      | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                                            |
| Commits of P1-22 work | 11 (4 documentation, 7 executable)                                                    |
| Migrations            | **119**, no `120`, none modified, nothing under `supabase/` touched                   |
| Schema hash           | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                    |
| `origin/develop`      | `0a53e540d72329e9aef6b196b68627aeb40b4c79` (unchanged)                                |
| `origin/main`         | `9c2fea162e5a270c740bac8db3546ed695a6f58a` (promoted, untouched)                      |
| Local PostgreSQL      | available — `supabase_db_RootLco`, 119 migrations applied, 24 `sal`+`wty` tables      |
| GitHub API            | available — `gho_` token via `git credential fill`, scopes include `repo`, `workflow` |
| Feature PR            | **not opened** — and must not be until the gates below are green                      |

## Commit chain

| SHA       | What                                                                |
| --------- | ------------------------------------------------------------------- |
| `db35d75` | Wave 0 close (inherited)                                            |
| `a22c666` | coverage gate: four hooks repaired, each mutation-tested separately |
| `3b96af8` | four domain layers + the 20-operation inventory                     |
| `862fe0c` | all ten blockers treated + the numbering runbook                    |
| `5384d31` | four protected residuals proven at the DB tier                      |
| `e4cd151` | four modules, twenty operations, all shared registrations           |
| `e0111e2` | exact-money gate + twenty coverage-manifest entries                 |
| `fda07c3` | the **blind zero** (fifth residual) + twenty OpenAPI registrations  |
| `6ffffdb` | backend fixtures + payments and warranty suites (49 tests)          |
| `8efbd6e` | dropped an unbackable obligation; fixed two comments I got wrong    |

## Measured green

- typecheck, eslint, prettier over the whole repository.
- module boundaries: 410 files, 11 rules, no violation.
- authorization coverage: every operation guarded, every route registered.
- route ↔ OpenAPI registry parity: exit 0.
- OpenAPI: **189 paths, 219 operations**, structurally valid, every operation guarded
  (up from 169/199).
- route-template reconciliation: 4/4 (189 templates, +20 with no reordering).
- catalogue pins: `EXPECTED_AUDIT_ACTIONS` 138→151, `EXPECTED_EVENT_TYPES` 42→50,
  plus the event-envelope implemented list and `OWNERS_BY_PHASE`.
- exact-money gate: 42 files across 12 declared trees, **0 findings**, mutation-tested on
  five vectors with byte-identical restoration.
- `tests/db/p1-22-protected-residuals.test.ts`: **10/10**.
- `tests/backend/p1-22-payments.test.ts`: **29/29**.
- `tests/backend/p1-22-warranty.test.ts`: **20/20**.
- unit + foundation tier: 1221 tests green.
- `sal.payment-method-list` is the first P1-22 operation the coverage gate reports `[OK]`.

## Measured RED, with the exact cause

**Operation-coverage gate.** 20 registered, **operation depth 1 of 20**. The manifest
names `p1-22-invoice-lifecycle`, `p1-22-credit-note`, `p1-22-delivery`, `p1-22-isolation`,
`p1-22-concurrency` and `p1-22-currency-coherence`, and **those six files do not exist
yet** — they are in flight. The names are in the manifest deliberately, so the gate keeps
failing until the files exist rather than being quietly satisfied by a shorter list.

**`validate:p1-22-inventory`** exits non-zero: 10 of 31 tasks have no proof yet, and the
symbol/test proofs are added per task as evidence lands.

**Nothing in this branch claims any operation is tested that is not.**

## The five protected residuals, all reproduced against the live database

Shaped the opposite way from every other DB suite: these prove the schema does **not**
defend something, so if a future migration closes one, the case fails and says "the guard
is now redundant, go and simplify it".

1. **SB1** — a JOD credit note against a USD invoice is inserted, **approved** by a
   distinct dual-control approver, and 40 JOD is subtracted from a USD gross
   (100.0000 → 60.0000). Guard: `assertCurrencyMatches`. `P1-22-L-02`, CC-1.
2. **BR-SAL-002** — `allocate_receipt` refuses 500 against a 100 receipt; a raw INSERT of
   the same 500 succeeds and drives both derivations to **−400.0000**. `app_runtime` holds
   exactly `[INSERT, SELECT]`. Guard: route every allocation through the primitive. CC-4.
3. **SB3** — `P0002` for an unprovisioned scope, `42501` for the repairing INSERT, and a
   failed issue consumes **no** number. `P1-22-L-03` plus the operator runbook.
4. **P1-22-L-06** — `partner_outstanding_balance` returns `150.0000` for one USD invoice
   open 100 and one JOD open 50. Unlabellable at source, so it is not exposed.
5. **The blind zero — not in the archaeology, found while implementing, and the most
   consequential of the five.** `sal.invoice_open_receivable` is `SECURITY INVOKER` and all
   three of its inputs are gated by `sal.finance.view`, so a caller without it gets **0
   with no error** — byte-identical to a settled invoice. Composed into a delivery gate
   that waves through an operator who may see invoices but not money, and
   `sal.complete_delivery` checks no balance itself. Reproduced: 100.0000 with the
   permission, 0.0000 without, same invoice, same transaction, amounts row invisible
   (count 0) while the header stays visible (count 1). Detected structurally — an issued
   invoice ALWAYS has an amounts row because `guard_invoice_totals_reconcile` raises at
   COMMIT without one, so a NULL can only mean "you cannot see it". Both routes that read a
   balance additionally require the permission.

## Findings recorded from the implementation

- `sal.credit_notes` has **no `deleted_at`/`deleted_by`**, unlike every other `sal` table.
- `sal.credit_notes.reason` is `NOT NULL` with no non-empty and no length CHECK, and
  `invoice_status_history.reason` has neither — `''` would be storable as the justification
  for reducing a receivable. `requireReason()` is the only defence.
- **`invoice.status = 'credited'` is unreachable through any `sal` primitive.**
- Nothing prevents **two accepted quotations on one work order**
  (`ix_quotations_work_order` is not unique). The service refuses with `ERR-CON-001` rather
  than choosing by `created_at`.
- **`P1-22-L-07` (new): the warranty payer split is always customer-100%.** No protected
  configuration determines a warranty contribution at invoice time — warranties are
  generated _from_ a committed delivery, after invoicing — so a non-zero share could only
  come from client input, which would let a caller reduce what a customer owes by asserting
  it. Consequence: `sal.issue_invoice` emits no `warranty_split_recorded` event today.
- `tax_class_id` is left NULL on every invoice line: `quo.quotation_items` captures a tax
  _rate_ and no class, and no protected mapping exists from a rate back to its class.
- `billing-repository.ts` reads `quo.*` read-only, widening a documented boundary the
  checker does not police. It follows established practice (`inventory-repository.ts` reads
  `wo.work_orders`), and the alternative forces a TypeScript sum. Recorded, not hidden.
- A stale comment named a field (`usableForReceipt`) the read service does not emit
  (`recordable`); and the manifest carried a `denial` obligation for an operation that
  parses no input at all. Both were mine, both fixed in `8efbd6e`.

## Accepted limitations carried forward

`P1-22-L-01` warranty claim adjudication · `L-02` currency equality is application-only ·
`L-03` numbering requires operator provisioning · `L-04` signatures bind but cannot be
retrieved · `L-05` no refund/partial reversal/multi-invoice credit/ledger ·
`L-06` `partner_outstanding_balance` mixes currencies · **`L-07` warranty payer split is
always customer-100%**.

## Tasks

**0 of 31 claimed.** Backend 0/18 · Security 0/4 · QA 0/5 · DevOps 0/2 · Documentation
0/2. No task is claimed without executable evidence.

## Next exact action

1. Land the six in-flight suites and drive operation depth to 20/20 with pending,
   unit-only, metadata-only and unreferenced all 0.
2. Implement `TC-P1-22-001` … `008`; add symbol/test proofs for all 31 tasks.
3. Add the P1-22 entries to `scripts/ci/hostile-mutations.mjs`, run the matrix, restore
   byte-identically.
4. Run the fifteen independent read-only reviews; personally reproduce every Critical and
   High.
5. Freeze `FINAL_FEATURE_SHA`; open the feature PR against `develop`; require every
   check-run, `ci-gate`, the hosted clean room, PR CodeQL **and an explicit full-tree
   CodeQL on the exact feature head** — reconciled against the GitHub alert list and the
   complete `/commits/{sha}/check-runs` list, **never `/actions/runs`, which does not list
   every check** (that is the trap that let a red CodeQL check sit on five heads reported
   as green).
6. Merge with a merge commit; verify parents, containment, byte-identical tree, zero drift,
   119 migrations, unchanged schema hash; then the gate record on
   `gate/p1-22-billing-payment-delivery-warranty-backend`.
