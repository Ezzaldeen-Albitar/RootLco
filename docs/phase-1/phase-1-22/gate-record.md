# P1-22 — Billing, Payment, Delivery and Warranty Backend Gate Record

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Prerequisite:** P1-21 closed (Go), `origin/develop` at `0a53e540d72329e9aef6b196b68627aeb40b4c79`
**Decision:** recorded in §12 below.

This is a **documentation-only** record. It changes no executable file, no test, no
script, no workflow, no lockfile, no Supabase file, no seed and no migration.

---

## 1. Scope delivered

Twenty public operations across four modules, against the **frozen** Phase 1-11 `sal` and
`wty` schemas.

| Module   | Operations | Namespace |
| -------- | ---------- | --------- |
| billing  | 8          | `sal.`    |
| payments | 4          | `sal.`    |
| delivery | 6          | `sal.`    |
| warranty | 2          | `wty.`    |

**No migration.** 119 on disk, no `120`, none modified, nothing under `supabase/` touched.
Schema hash `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`, verified
unchanged by `validate:schema-inventory --hash-only` locally and by the hosted clean room's
before/after comparison.

---

## 2. The gate had to be repaired before anything could be measured

The archaeology's `SB7` said the operation-coverage gate had no `sal`/`wty` hook. Measured
before any code was written:

```
isDerivedId('sal.invoice-issue')  = false
derivedRequirements(wty read)     = []      <- nothing required at all
parseProvidedFlags(declaration)   = []      <- declarations INVISIBLE
```

**Four** hooks needed extending, not the two the archaeology named. Without the structural
opt-in, `metadata-only` and `unit-only` compute as `false` for every row — so a phase
reports `0` because nothing was measured, which is the failure mode this project has paid
for before. Each hook was mutation-tested separately with disjoint failure signatures
(14 / 4 / 1 / 3 tests) and restored byte-identically.

`inv.` (P1-21) was opted into the two structural hooks in the same change, but only after
measuring that it costs nothing: 14 operations, 0 metadata-only, 0 unit-only,
0 invocation-only, 0 failing the strict ratchet. `crm.` and `veh.` stay out because they
genuinely fail 38 rows, and opting them in to look thorough would have made the gate lie.

---

## 3. Both phase gates

```
operation-coverage:  20 registered · DEPTH 20 · invocation-only 0 · pending 0 ·
                     unit-only 0 · unreferenced 0 · metadata-only 0
p1-22 inventory:     20 operations; permissions, audit actions, events and ALL 31
                     task identifiers reconcile
```

Backend 18/18 · Security 4/4 · QA 5/5 · DevOps 2/2 · Documentation 2/2.

No task is satisfied by a document that merely mentions its identifier: the register uses
`operation`, `permission`, `audit`, `event`, `symbol`, `test` and `doc` proofs, and a task
with zero proofs is reported INCOMPLETE rather than passing.

---

## 4. Tests

| Tier              | Files | Tests     |
| ----------------- | ----- | --------- |
| unit + foundation | 57    | **1252**  |
| backend           | 68    | **1603**  |
| database          | 138   | **1636**  |
| **total**         | 263   | **4,491** |

P1-22's own backend contribution is 209: delivery 52, invoice-lifecycle 43, payments 30,
currency-coherence 23, isolation 20, warranty 20, credit-note 14, concurrency 7. Plus 12 DB
residual tests and 18 money-gate fixture tests.

`TC-P1-22-001`…`008` are labelled on `it(...)` titles rather than in a mapping document,
because the inventory gate strips comments before resolving a `test` proof — a mapping
document would have satisfied the gate without pinning anything.

---

## 5. Three Highs found during implementation

1. **The blind zero.** `sal.invoice_open_receivable` is `SECURITY INVOKER` and all three of
   its inputs are gated by `sal.finance.view`, so a caller without it receives `0` with no
   error — indistinguishable from a settled invoice, on the one gate with no database
   backstop. Reproduced: 100.0000 with the permission, 0.0000 without, same invoice, same
   transaction.
2. **`sal.delivery.view` was declared by no operation**, while `sal.complete_delivery` reads
   two tables gated by it. Vehicle delivery was unreachable for a caller holding exactly the
   declared permissions. Caught by the task gate's permission reconciliation — the only
   thing in the repository that would have noticed.
3. **`versionGuarded: true` declared and never enforced** on three routes; the delivery
   service's own check existed but was **inert**, because its parameter was optional and the
   route never supplied it. A guard can be present, correct, and dead.

The committed archaeology foreshadows the first, in its entry about that function's inputs
being gated. What is true is narrower than "none was in the archaeology": none was reported
AS a defect, and each had to be reproduced before it could be believed.

---

## 6. Six Highs from fifteen independent reviews — 0 Criticals

Fifteen read-only reviews ran against the feature head, one per lens. They returned
**0 Criticals and 7 Highs, of which 6 were distinct** — the draft-invoice defect was found
independently by the delivery-eligibility lens and the test-honesty lens. Every one was
reproduced here before being changed, and each is pinned by a test **and** by a hostile
mutation (`M-22-10`…`M-22-14`).

1. **A draft invoice switched the financial blocker OFF.** `sal.invoice_open_receivable`
   returns `0` for a draft by design, so an unissued invoice carrying 5,000.00 answered
   "nothing outstanding" — making a handover strictly MORE permissive than one with no
   invoice at all, which correctly blocks. The vehicle could leave with the money owed, no
   override, no reason, and an audit record asserting every gate was cleared on its merits.
2. **The signature gate accepted any visible document.** `linkedToEntity` was discarded, and
   the document-version SELECT policies carry no permission predicate, so every principal in
   the tenant could enumerate candidates — another customer's identity scan would satisfy
   `sal.complete_delivery`'s "a signature exists" gate. Provenance is now required against
   the delivery's work order or reception visit, both of which were in
   `LINKABLE_ENTITY_TYPES` all along, so the control needed no migration.
3. **`sal.delivery-complete` demanded an `If-Match` no operation published.** It is
   `versionGuarded`, `parseIfMatch` admits no wildcard, and `record_version` is bumped twice
   by the preparation steps — so the `1` in the create response was always stale and nothing
   else carried the value. The eligibility read now publishes it as a body field and an
   ETag, and no longer requires `sal.delivery.manage`, because the principal that acts on
   that answer holds `sal.delivery.complete`.
4. **No amount was validated against `shared.currencies.minor_unit`**, though the platform
   standard states in two places that the domain does. A `0.0001` USD credit note was
   accepted end to end, and since no tenderable USD payment settles a hundredth of a cent,
   the receivable stayed non-zero permanently and held the delivery blocker up with it.
5. **Restricted money reached the outbox.** `sel_event_outbox_producer` is tenant-only, with
   no permission and no scope predicate, while `sal.receipts` and `sal.payment_allocations`
   require `sal.finance.view` plus both scope predicates. `billing` states this rule for
   itself three times and keeps it; `payments` stated it once about FORMAT and then carried
   the amount, the currency, the receipt number and the derived unallocated remainder — the
   last computable only with the permission, so the payload was its only source.
6. **The tax guarantee was false.** Not the behaviour: P1-22 bills the captured rate and
   invents nothing, which is correct and unchanged. The false part was the claim that a
   missing tax configuration is "a controlled configuration error, never a silent zero".
   `org.tax_classes` has zero rows and no writer anywhere in `src/`, so
   `price_rules.tax_class_id` is unsettable and the resolver's zero branch is the only
   reachable one. Recorded as `P1-22-L-08` and `CC-7`.

Three of the six were reachability or disclosure defects that every green test had walked
past, and the reason was the same shape each time: **the suite proved the guard worked
without proving the path was usable.** Completion tests took their `If-Match` from a
superuser read; signature tests reused one unlinked fixture document for every delivery in
the suite; financial tests always issued the invoice first. Two amount assertions used
`0.0001` and `100.0001` USD and called them the smallest expressible amount — of the
column, which was never the question.

Two further false claims were corrected rather than defended: the "money is never returned
unlabelled" invariant did not hold for `InvoicePreview`'s ten per-line amounts, and the
preview's promise that it "cannot disagree with the invoice it is previewing" was breakable
because `sum()` returns unconstrained `numeric`.

---

## 7. Hostile mutation matrix — 45/45 caught

Fourteen P1-22 entries, each targeting a guard with no database backstop: the original nine
plus one per review High. Every target restored in a `finally`, and the tree verified
byte-identical afterwards.

**One mutation could not be killed, and that is recorded as a finding rather than smoothed
over.** Deleting the `assertDeliveryDelivered` call is **unobservable**:
`ck_delivery_records_delivered_shape` makes `status <> 'delivered'` imply
`delivered_at IS NULL`, the next guard refuses that with the same `ERR-TRN-001`, and
`problemFor` never emits a message. It was retargeted at the property that IS pinnable —
the comparison's direction — which fails 10 tests.

---

## 8. The coverage ratchet caught the fix for review High 4

The first push of the review fixes went red on `unit-tests-coverage`: global lines and
statements fell 93.26% → 92.43% and functions 84.75% → 83.74%, outside the 0.5 pp
tolerance. Reproduced locally to the same digits.

One function caused it. `assertMinorUnitScale` lives in `src/server/http/validation.ts`,
one of the twelve paths in the unit tier's coverage `include` list, and it arrived with no
unit test — every case exercising it went in at the backend tier, whose coverage is
deliberately not merged. A money guard had shipped with its only proof one layer away from
where it is measured, and the ratchet is what said so.

Seven unit cases now cover it. Coverage is 93.37% lines and statements, 84.87% functions,
93.73% branches — above baseline on all four axes rather than back inside tolerance.

---

## 9. Six protected residuals, all reproduced

`tests/db/p1-22-protected-residuals.test.ts` (12 tests) proves the schema does **not**
defend six rules, so a future migration that closes one will fail the case and say the
application guard has become redundant.

1. **SB1** — a JOD credit note against a USD invoice is inserted, **approved**, and 40 JOD
   subtracted from a USD gross (100.0000 → 60.0000). `P1-22-L-02`, CC-1.
2. **BR-SAL-002** — the primitive refuses 500 against a 100 receipt; a raw INSERT of the
   same 500 succeeds and drives both derivations to **−400.0000**. CC-4.
3. **SB3** — `P0002` unprovisioned, `42501` on the repairing INSERT, and a failed issue
   consumes **no** number. `P1-22-L-03` + runbook.
4. **`P1-22-L-06`** — `partner_outstanding_balance` returns `150.0000` for 100 USD + 50 JOD.
5. **The blind zero.**
6. **The outbox policy is strictly weaker than the ledger it describes**, and
   `sal.receipt_unallocated` is confirmed `SECURITY INVOKER`. CC-8.

---

## 10. Eight accepted limitations

| ID   | Limitation                                                                        |
| ---- | --------------------------------------------------------------------------------- |
| L-01 | Warranty claim adjudication not implemented — no claim table exists anywhere      |
| L-02 | Credit-note / reversal currency equality is application-enforced only             |
| L-03 | Invoice and receipt numbering requires operator provisioning                      |
| L-04 | Delivery signatures can be bound but not retrieved                                |
| L-05 | No refund, partial reversal, multi-invoice credit, or ledger posting              |
| L-06 | `sal.partner_outstanding_balance` mixes currencies                                |
| L-07 | The invoice warranty payer split is always customer-100%                          |
| L-08 | The reachable tax rate is always zero — `org.tax_classes` is empty and unwritable |

Eight change-control candidates (`CC-1`…`CC-8`) are raised and not acted on, each requiring
a migration this phase forbids. Five findings are open and named as `P1-22-R-01`…`R-05`,
with a decision recorded against each in the execution checkpoint rather than left
unmentioned.

---

## 11. Verification on GitHub-hosted Actions

| Item                    | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| `FINAL_FEATURE_SHA`     | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| `REMOTE_FEATURE_SHA`    | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| `PR_HEAD_SHA` (PR #107) | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| `HOSTED_PR_CI_SHA`      | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| `HOSTED_CLEAN_ROOM_SHA` | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| `CI_GATE_SHA`           | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| `CODEQL_PR_SHA`         | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| `CODEQL_FULL_TREE_SHA`  | `f5c3a02dca8a1cf602d5468aceaa5f5d056614f4`             |
| Feature merge commit    | `c864183a564e3f85c4348a4a36c5c076d445dbc4`             |
| `origin/develop` after  | `c864183a564e3f85c4348a4a36c5c076d445dbc4`             |
| `origin/main`           | `9c2fea162e5a270c740bac8db3546ed695a6f58a` (untouched) |

All eight SHAs name the **same executable tree**.

**Every check-run on the final head was enumerated through
`/commits/{sha}/check-runs`, never `/actions/runs`.** That distinction is not pedantry: on
this repository `/actions/runs` lists 14 jobs while the commit carries 19+ checks, and a
`CodeQL` check from GitHub Advanced Security has previously sat red on five consecutive
heads that were reported green because only the jobs list was consulted.

CodeQL was verified in **both** modes, because the pull-request analysis is
**diff-informed** and cannot by itself support a claim about the whole tree:

- the PR analysis on the feature head, and
- an **explicit full-tree analysis** on that same head, dispatched deliberately.

Reconciled against the repository's code-scanning alert list rather than against the check
conclusion alone. **Application Critical 0 / High 0.** The pre-existing `develop` baseline
of open alerts outside application source is carried forward unchanged and is recorded in
the checkpoint.

---

## 12. Decision

**Go — P1-22 Billing, Payment, Delivery, and Warranty Backend Gate Passed**

`origin/main` is **untouched**. Promotion to `main` is a founders' reserved decision
(ADR-006) and is not part of this gate. P1-23 is **not** started.
