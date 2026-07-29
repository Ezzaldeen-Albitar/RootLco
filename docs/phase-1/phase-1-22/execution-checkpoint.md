# P1-22 execution checkpoint

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Branch:** `feature/p1-22-billing-payment-delivery-warranty-backend`
**Status:** **Wave 0 complete.** Wave 1 not started. No code written.

## Current position

| Field                       | Value                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| HEAD                        | `b8fe8a163ce2758f8e2c45d502933818ceefb9ae`                                 |
| `P1_22_BASE_SHA` (current)  | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                                 |
| `P1_22_BASE_SHA` (original) | `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de`                                 |
| Commits of P1-22 work       | 2 (both documentation)                                                     |
| Working tree                | clean                                                                      |
| Remote ref                  | pushed                                                                     |
| Migrations                  | **119**, no `120`, none modified                                           |
| Schema hash                 | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`         |
| `origin/develop`            | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                                 |
| `origin/main`               | `9c2fea162e5a270c740bac8db3546ed695a6f58a` (promoted, byte-identical tree) |

## Wave 0 — complete

**Baseline** verified: develop matched the authorised SHA; main verified before
(`491c4e0`) and after promotion (`9c2fea1`); no pre-existing P1-22 branch or PR;
119 migrations with no `120`; both prerequisite gate records present; every
`p1-22`/`p1-23` string hit traced to P1-11 forward contracts and schema comments.

**Archaeology** complete and committed — `contract-archaeology.md` plus
`evidence/archaeology.json` (838 KB). Nine lenses, 36 agents, **240 findings,
124 gaps, 10 blocker gaps that survived independent refutation**.

### The determination (§3)

**No migration 120 is required.** Every in-scope requirement is implementable
against the protected schema with named application-level composition. Recorded
only after each of the ten survivors was classified.

### Concurrency interrupt

A concurrent main-promotion mandate took priority mid-phase. **Nothing was lost —
nothing had been written**: at the interrupt the branch was byte-identical to its
base (0 commits, 0 files), measured not assumed. The promotion ran in a
**separate worktree** (`ops/pre-p1-22-main-promotion`), so this worktree was never
switched, stashed or reset. `develop` then advanced by a documentation-only merge
and this branch was brought forward with `merge --ff-only` — 9 docs files, **0
executable files**.

## What Wave 1 must do first, and why

These are not preferences; each is a measured consequence recorded in the
archaeology.

1. **Extend BOTH hooks in `scripts/check-operation-test-coverage.mjs`.**
   `DERIVED_PREFIXES` needs `P1_22_PREFIXES = ['sal.', 'wty.']` **and** the
   COVERAGE-EVIDENCE regex alternation needs `sal|wty`. With neither,
   `derivedRequirements()` returns `[]` for every P1-22 operation and deleting the
   assertions keeps the gate green — the documented P1-20 defect verbatim. Verify
   from the script's own `--json` that `route`, `service`, `authorization`,
   `audit`, `outbox`, `isolation` are **required**, not merely provided.
2. **Transcribe the vocabularies, invent none.** Invoice status is exactly
   `draft|issued|credited|void_before_issue`. Financial events are exactly six.
   Payment methods are exactly `cash|card_terminal|bank_transfer`. Receipt status
   is exactly `recorded|partially_allocated|allocated|reversed`.
3. **Route every allocation through `sal.allocate_receipt`.** Over-allocation is
   prevented _only_ inside that primitive while `app_runtime` holds raw INSERT on
   `sal.payment_allocations` — the database does not defend BR-SAL-002 on any
   other path. Enforce with a repository-layer prohibition.
4. **Two money validators, not one:** `>= 0` for invoice/line/event amounts,
   `> 0` for receipt/allocation/credit-note/reversal. Reject >4 decimals and >14
   integer digits at the boundary — exceeding scale is _not_ an error, PostgreSQL
   silently rounds.
5. **Currency equality is a P1-22 invariant, not a DB re-check** (SB1).
6. **Catch `P0002` from issue/record and return a controlled configuration
   error** naming the missing `(company, branch, sequence_code)`. No guessed
   default (SB3).

## Accepted limitations carried forward

`P1-22-L-01` warranty claim adjudication · `L-02` currency equality is
application-only · `L-03` numbering requires operator provisioning · `L-04`
signatures bind but cannot be retrieved · `L-05` no refund/partial
reversal/multi-invoice credit/ledger · `L-06`
`sal.partner_outstanding_balance` mixes currencies. Full reasons in
`contract-archaeology.md` §8.

## Plan-to-repository differences resolved (§5)

- The plan's nine `documentation/*.md` paths **do not exist**; canonical material
  is under `docs/`.
- Colon-style action routes and `.v1` event suffixes are to be transcribed from
  the operation registry and envelope contract, not adopted from the plan text.
- Test identifiers use `TC-P1-22-001` … `TC-P1-22-008`, not the reused generic
  `TC-SAL-001` rows.

## Next exact action

**Wave 1 — module foundations.** Create the `billing`, `payments`, `delivery` and
`warranty` module skeletons following the P1-21 module layout
(`domain` / `repository` / `service` / `routes` / `schemas` / public port), extend
both coverage-gate hooks _first_, and register the error catalogue entries. No
operation may be declared before its evidence hook exists.

## Tasks

**0 of 31 complete.** Backend 0/18 · Security 0/4 · QA 0/5 · DevOps 0/2 ·
Documentation 0/2. No task is claimed without evidence.
