# P1-22 — Protected Contract Archaeology

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Base:** `origin/develop` = `0a53e540d72329e9aef6b196b68627aeb40b4c79`
**Protected source:** migrations `20260724090000_salwtyrpt_schemas.sql` …
`20260724095000_wty_warranty.sql` (Phase 1-11, frozen), plus `shared`, `org`,
`wo`, `quo`, `svc`, `inv`, `rec` contracts.
**Migration posture:** 119 migrations, **no migration 120**, none modified.
**Schema hash:** `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`

Nine independent read-only lenses, 36 agents. Every blocker-severity gap was
attacked by a separate agent instructed to refute it; **ten survived**. Where the
P1-11 handoff prose and the deployed DDL disagree, **the DDL is recorded as
authoritative** and the divergence is raised as a finding.

---

## 0. The headline: P1-22 as scoped is buildable without a migration

Ten blocker gaps survived refutation. **None of them blocks the scope this phase
was actually given**, and that distinction is the most important result here.

| #                       | Gap                                                                                 | Bearing on P1-22 scope                                      |
| ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| SB2, SB5, SB6, SB8, SB9 | **No warranty-claim table exists anywhere**                                         | **Out of scope** — see §1                                   |
| SB4                     | No refund, partial reversal, multi-invoice credit, progress billing or ledger       | **Out of scope** — matches the phase's own exclusions       |
| SB1                     | Credit-note ↔ invoice currency equality enforced by **nothing**                     | In scope → application invariant + abuse test               |
| SB3                     | **No `invoice`/`receipt` number sequence is seeded**, and runtime cannot create one | In scope → controlled configuration error + runbook         |
| SB7                     | The operation coverage gate has **no `sal`/`wty` hook**                             | In scope → must extend both hooks before any evidence claim |
| SB10                    | A delivery signature can be bound but **never downloaded**                          | In scope → record limitation, ship no retrieval endpoint    |

**Determination under §3: no migration 120 is required.** Every in-scope
requirement is implementable against the protected schema with application-level
composition, and each mitigation is named below rather than assumed.

---

## 1. Warranty claims: a documentation conflict, resolved in favour of scope

Five of the ten surviving blockers are the same finding: **there is no warranty
claim table, in any schema, under any name.** `wty` is exactly five tables —
`warranty_policies`, `warranty_coverage`, `warranty_records`,
`warranty_record_items`, `warranty_status_history` — and the entire trace of a
claim in 119 migrations is one string literal, `'claimed_against'`, appearing in
two CHECK vocabularies. There is no claim permission, no claim event type, no
claim audit action, and `wty` contains **zero monetary columns of any kind**.

P1-11's own documents repeatedly assign _"full warranty claim adjudication
(P1-OD-024)"_ to P1-22 — in the schema comment, in
`phase-1-11-p1-22-backend-contract.md`, in `phase-1-11-od-linkage.md` and in two
warranty contracts.

**The P1-22 mandate does not.** Its scope names **`warranty generation`** and
says nothing about claim intake, assessment, adjudication, or reimbursement.

So this is a **conflict between P1-11's forward contract and the P1-22 scope**,
not a blocked requirement. It is resolved in favour of the phase scope:

- P1-22 builds **warranty generation** and does not build claim adjudication.
- No endpoint will be named or shaped as if claims were persistable.
- Claim adjudication (P1-OD-024) is carried forward as a **named accepted
  limitation**, in the manner of P1-21's D-04, with the reason recorded: a claim
  has no row to live in and creating one requires a migration this phase forbids.

Had the mandate required claim adjudication, this would have been a §45.1
stopping condition. It does not, so it is not.

---

## 2. Exact money and currency

| Concept                                            | Type            | Bound                                           |
| -------------------------------------------------- | --------------- | ----------------------------------------------- |
| Every money column in `sal` (11 columns, 4 tables) | `numeric(18,4)` | ≤ 14 integer digits, **exactly 4** decimals     |
| `sal.invoice_lines.quantity`                       | `numeric(12,3)` | `0.001 .. 999999999.999`, **strictly positive** |
| `org.tax_rates.rate`                               | `numeric(9,6)`  | `CHECK (rate >= 0 AND rate <= 1)`               |
| `wty.*`                                            | —               | **zero monetary columns**                       |

**Two distinct validators are required, not one.** `>= 0` on
`sal.invoice_amounts.*`, `sal.invoice_line_amounts.*` and
`sal.financial_events.amount`; `> 0` on `sal.receipts`, `sal.payment_allocations`,
`sal.credit_notes` and `sal.receipt_reversals`. **A zero-total issued invoice is
legal.** Negatives are legal nowhere — there is no signed amount in the domain,
so a credit is a separate positive-amount row, never a negative line.

**Precision failures are not validation failures.** Exceeding 14 integer digits
raises `22003 numeric_value_out_of_range`, which is not `23514` and will surface
as a 500 unless the API rejects it first. Exceeding 4 decimals is **not an error
at all** — PostgreSQL silently rounds on the cast. Both must be refused at the
boundary by `Decimal.parse(value, MONEY)`.

`pg@^8.22.0` returns `numeric` as a **string** and no `setTypeParser` override
exists, so exact decimals cross the driver intact. No `GENERATED` money column
exists in `sal`/`wty` — unlike P1-21's inventory, **every total is
application-written**, reconciled only afterwards by CHECKs and one deferred
constraint trigger.

### Currency has no default anywhere

`currency_code text NOT NULL` with `ON DELETE RESTRICT` FK to
`shared.currencies(code)` on seven tables, and **no `DEFAULT` in `sal` or `wty`**.
The only hard-coded currency default in the whole database is
`qms.rework_link_details.cost_currency DEFAULT 'JOD'`, deliberately outside this
domain. This satisfies §7 directly: there is nothing to un-hard-code, and nothing
may be invented. An unseeded code fails `23503`, not `23514`.

`sal.invoice_amounts` and `sal.invoice_line_amounts` carry **no currency column
of their own** — their amounts are currency-less until joined to the parent, so
every money projection must join the header or line currency to render
`{ amount, currency }`.

### SB1 — the coherence the prose promises and the DDL does not enforce

P1-11's precision contract states currency coherence _"is enforced (M-fin-4)"_.
Measured against the DDL:

- **credit note ↔ invoice: enforced by nothing.** Five triggers on
  `sal.credit_notes`, none reads `sal.invoices.currency_code`;
  `sal.approve_credit_note` compares amount but never currency. A JOD credit note
  against a USD invoice is accepted, approved, and subtracted from the USD gross
  by `sal.invoice_open_receivable`, which has no currency predicate.
- **reversal ↔ receipt: enforced by nothing.**
- **allocation: enforced only inside `sal.allocate_receipt`**, while `app_runtime`
  holds raw `INSERT` on `sal.payment_allocations`.

`sal.partner_outstanding_balance(uuid)` actively mixes currencies: it loops every
issued invoice for a partner with no currency filter and returns one unlabelled
scalar.

**Mitigation.** P1-22 treats currency equality as its own hard invariant, not as
a re-check of a database rule: every allocation goes through
`sal.allocate_receipt` and never a raw INSERT, enforced by a repository-layer
prohibition; credit-note and reversal currency is read from the parent row, never
from client input; and an abuse-case test proves the database still accepts the
mismatch, so the residual is visible rather than assumed closed.

---

## 3. Invoice lifecycle, immutability and numbering

**Six tables.** `sal.invoices` is **structural only** — it carries no money at
all. Every amount lives in two restricted 1:1 detail tables whose RLS policies are
gated by `iam.has_permission('sal.finance.view')`.

**Lifecycle is exactly four values:**
`CHECK (status IN ('draft','issued','credited','void_before_issue'))`.
`partially_paid` and `paid` exist **only** in the wider six-value
`ck_invoice_status_history_to_status` vocabulary and are never stored on the
invoice by any database code. The legal edges are exactly
`draft→draft`, `draft→issued`, `draft→void_before_issue`, `issued→credited`.
There is no un-void, no un-issue, no re-open.

- Invoices are **born draft** — `sal.guard_invoice_freeze` rejects any INSERT
  with `status <> 'draft'`, so the create endpoint never accepts a client status.
- `uq_invoices_work_order_active` — **at most one live invoice per work order**,
  so staged/progress billing is structurally impossible. A duplicate attempt is
  `23505` → 409, not 500.
- `uq_invoices_number` is unique **per branch**, not per company or tenant.
- Post-issue correction is impossible by design; the only instruments are a
  credit note and a new invoice.

**A caller lacking `sal.finance.view` must receive an invoice header without
money, not a 403 on the whole resource** — the money simply is not visible to
them.

### Numbering is not owned by `sal`

`sal.issue_invoice` resolves a `sequence_code` from the active
`sal.invoice_numbering_configs` row (falling back to the literal `'invoice'`) and
calls `shared.next_display_number(code, company_id, branch_id)`, which takes the
tenant **exclusively** from `iam.current_tenant_id()`, locks the sequence row
`FOR UPDATE`, and increments inside the caller's transaction.

- **Gapless with respect to rollback only.** The column comment calls
  business-level gaps _"tolerated and never renumbered"_, and the
  `mode IN ('gapless','gapped')` config column has **zero behavioural effect**
  anywhere in the DDL. P1-22 exposes `mode` as read-only metadata and asserts
  consecutiveness nowhere.
- The number is **opaque text**. No prefix or format exists in schema or seeds,
  so the backend must never construct, parse, regex-validate or sort by it.

### SB3 — no sequence row is seeded, and the runtime cannot create one

`supabase/seeds/` contains five files and **none inserts into
`shared.number_sequences`**. Runtime holds `SELECT` and a column-scoped `UPDATE`,
and **deliberately no INSERT policy and no INSERT grant**. An unprovisioned tenant
fails invoice issue _and_ receipt recording with `P0002`.

**Mitigation, per §7 exactly:** catch `P0002` and return a controlled
configuration error naming the missing `(company, branch, sequence_code)`. Do not
substitute a guessed default. The fix is a provisioning runbook step, not code —
`org.provision_organization` inserts **tenant-wide** sequence rows (it passes
neither `company_id` nor `branch_id`), which is itself worth flagging.

---

## 4. Payments, receipts, allocation

A five-table, function-mediated ledger. **Nothing stores a balance** —
`sal.invoice_open_receivable`, `sal.receipt_unallocated` and
`sal.partner_outstanding_balance` derive it on every call. §13's requirement that
outstanding balance be server-derived is therefore satisfied by construction.

- **One receipt CAN allocate to many invoices, and one invoice CAN receive many
  receipts** — but only within the same `(tenant, company, branch)`, because both
  allocation FKs are four-column composite scoped FKs. The same receipt may
  allocate to the same invoice twice; partial top-ups are legal.
- **Over-allocation is prevented ONLY inside `sal.allocate_receipt`**, under a
  receipt→invoice `FOR UPDATE` lock order. There is no constraint, trigger or
  exclusion bounding `Σ allocations`, and `app_runtime` holds raw INSERT on
  `sal.payment_allocations`. **The database does not defend BR-SAL-002 against
  any path except the primitive**, so routing every allocation through it is a
  P1-22 invariant, not a convenience.
- Payment methods are closed to **`cash | card_terminal | bank_transfer`**, with
  the schema comment _"No online payment gateway/settlement types (ASM-14,
  CON-04)"_. §12's prohibition on claiming settlement is structural.
- `sal.receipts` is **whole-row gated** by `sal.finance.view` on SELECT, INSERT
  and UPDATE. A caller without it sees zero receipts, not redacted ones — so no
  "receipt list without amounts" view may be built.
- `sal.record_receipt` **server-stamps the cashier and tenant**; neither is a
  client input, so no `receivedBy` field is exposed.
- Corrections are coarse: allocations have no UPDATE/DELETE grant and no reversal
  record; `sal.receipt_reversals` is **full-receipt-only and terminal**. A single
  misallocated line is correctable only by reversing the whole receipt under dual
  control.

### Prose the DDL contradicts

The reversal-amount "CHECK", the credit/reversal currency equality (M-fin-4), the
_conditional_ receipt freeze, and a function named `reverse_receipt` are all
absent. The deployed `tg_receipts_freeze` is **unconditional on every UPDATE** and
also freezes `receipt_number` — not conditioned on the event existing or on
status as the handoff claims.

---

## 5. Financial events

`sal.financial_events` has **no debit/credit, sign, direction or account column**.
Amount is unsigned; direction is implied solely by `event_type`. Any aggregate
that sums across event types is meaningless and must partition first.

**The complete vocabulary is six values**, closed by CHECK:
`invoice_issued`, `receipt_recorded`, `payment_allocated`, `credit_note_issued`,
`receipt_reversed`, `warranty_split_recorded`. Source types are five.
`uq_financial_events_source UNIQUE (tenant_id, source_type, source_id, event_type)`
makes the ledger single-use per source — **a replayed command hits `23505`**,
which is a free idempotency backstop.

`sal.guard_financial_event_provenance()` hard-binds every event's amount and
currency to its source row with exact numeric equality. **The backend never
chooses an event amount or currency**; drift fails `23514`.

---

## 6. Delivery, receiver, checklist, signature

Eligibility is a **composed decision**, and the composition is the backend's, not
the database's. The protected schema enforces the structural facts; work-order
completion, QC, outstanding balance, approvals and checklist completeness must be
assembled by P1-22 through public module ports and returned as explicit blocker
codes.

### SB10 — a signature can be bound but never retrieved

`shared.document_versions.status` defaults to `'pending'`;
`DOWNLOADABLE_STATES = ['accepted']`. **No application role can produce
acceptance**: `shared.file_scan_results` is granted to no role in any form,
`shared.guard_document_version_transition` requires a clean scan, and the only
runtime UPDATE policy pins `pending → rejected`.
`AttachmentService.requestDownload` says it outright — _"no path in this phase can
accept one."_

`sal.delivery_signatures` accepts any `document_versions` row regardless of
status, so **binding works and download always fails with `ERR-DOC-001`**.

**Mitigation:** record as a carried-forward limitation and **ship no
signature-retrieval endpoint that would always fail.** §19's requirements —
reference an approved evidence object, verify tenant/company/branch ownership,
reject foreign or pending files, never embed raw signature data — are all
satisfiable; retrieval is not, and will not be advertised.

---

## 7. Conventions P1-22 must follow (§5 reconciliation)

| Plan wording                                                 | Repository reality                                          | Resolution                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `documentation/04-chapter-03-requirements.md` and 8 siblings | **No `documentation/` directory exists**                    | Canonical material is under `docs/` — `docs/phase-1/`, `docs/standards/`, `docs/adr/`, `docs/governance/` |
| `POST /invoices/{id}:issue` colon actions                    | To be transcribed from the operation registry, not invented | Use the repository's approved noun/subresource grammar                                                    |
| `billing.invoice-issued.v1`                                  | Envelope carries `schemaVersion` separately                 | Do **not** duplicate the version in both `eventType` and `schemaVersion`                                  |
| `TC-SAL-001` reused across unrelated rows                    | Generic catalogue reference                                 | Use `TC-P1-22-001` … `TC-P1-22-008` as executable evidence                                                |

### SB7 — the coverage gate is blind to `sal` and `wty`, silently

`scripts/check-operation-test-coverage.mjs` has **two** hooks and neither
includes this phase:

```js
const DERIVED_PREFIXES = [DERIVED_PREFIX, P1_16_PREFIX, P1_17_PREFIX,
  ...P1_18_PREFIXES, ...P1_19_PREFIXES, ...P1_20_PREFIXES, ...P1_21_PREFIXES]
// and the COVERAGE-EVIDENCE regex alternation:
/^\s*\*?\s*((?:iam|meta|shared|crm|veh|apt|rec|wo|tech|dia|qms|svc|quo|inv)\.…)/
```

With neither, `derivedRequirements()` returns `[]` for every P1-22 operation
except idempotency, and the required floor becomes whatever the manifest
volunteers — **deleting the assertions would keep the gate green.** This is the
documented P1-20 defect verbatim.

**Both hooks must be extended, or neither.** `P1_22_PREFIXES = ['sal.', 'wty.']`
spread into `DERIVED_PREFIXES`, _and_ `sal|wty` added to the regex alternation,
verified from the script's own `--json` output that `route`, `service`,
`authorization`, `audit`, `outbox` and `isolation` are **required**, not merely
provided.

---

## 8. Accepted limitations carried forward

| ID         | Limitation                                                                                                | Why it cannot close in P1-22                                                |
| ---------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P1-22-L-01 | Warranty **claim adjudication** not implemented                                                           | No claim table exists; creating one requires a migration this phase forbids |
| P1-22-L-02 | Credit-note ↔ invoice and reversal ↔ receipt **currency equality is application-enforced only**           | No DB constraint exists; adding one requires a migration                    |
| P1-22-L-03 | Invoice/receipt numbering **requires operator provisioning**; runtime cannot self-heal `P0002`            | Runtime holds no INSERT grant on `shared.number_sequences` by design        |
| P1-22-L-04 | Delivery signatures can be **bound but not retrieved**                                                    | No application path can move a document version to `accepted`               |
| P1-22-L-05 | No refund, partial reversal, multi-invoice credit, progress billing, gateway settlement or ledger posting | Structurally absent and explicitly out of scope                             |
| P1-22-L-06 | `sal.partner_outstanding_balance` **mixes currencies**                                                    | Protected function; P1-22 must not expose it as a customer-facing balance   |

---

## 9. Verification posture

- **119 migrations, no `120`, none modified.** Confirmed after archaeology.
- Every claim above is traceable to a named identifier and quoted DDL in
  `evidence/archaeology.json`, produced by the nine lenses.
- Ten blocker gaps were each independently attacked before acceptance; the
  refutation attempts are recorded with the searches they performed.
