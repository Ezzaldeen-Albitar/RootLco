# Phase 1-11 — Physical Design & Architecture

**Phase ID:** P1-11 — Billing, Payment, Delivery, Warranty, and Reporting Database ·
**Base:** `origin/develop` = `3221b94` (P1-10 gate merge #42) ·
**Review model:** owner-authorized technical, QA, security, and adversarial self-review
by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — **not** an independent third-party review.

Canonical source: `03-phase-1-database-plan.md` §Phase 1-11 (tasks P1-11-DB-001…022),
Figures 4.24 / 4.25 / 4.29, FR-SAL/WTY/RPT, BR-SAL-001/002, BR-WTY-001, BR-REC-001,
BR-RPT-001, P1-OD-007/023/024/042.

## 1. Physical schema decision

Three new module schemas under ADR-001 (one schema per module):

- **`sal`** — Sales/commercial closing: invoices, invoice lines, invoice numbering
  configuration, invoice status history, payment methods, receipts, payment
  allocations, credit notes, receipt reversals, the immutable `financial_event`
  foundation, **and the delivery/custody-closure slice** (delivery records, checklist
  template/results, authorized receivers, signatures, delivery status history).
- **`wty`** — Warranty: policies, effective-dated coverage, warranty records, record
  items, warranty status history.
- **`rpt`** — Reporting configuration: report configurations, configuration versions,
  saved filters.

**Delivery placement — rationale.** Chapter 3 defines **no** dedicated delivery (DLV)
module prefix; the plan (§5, §12 note) files delivery under **REC/SAL** as the
commercial-closing / custody-completion slice grounded in BR-REC-001, UC-WO-002, and SAL
billing rules. We place delivery tables in **`sal`** (commercial closing) rather than
expanding the merged `rec` module surface, and the delivery-completion primitive writes
the custody-release row into `rec.custody_history` via an ordinary `INSERT` (app_runtime
holds `INSERT, SELECT` on `rec.custody_history`). **Rejected alternatives:** (a) a new
`dlv` schema — rejected: no canonical prefix, the instruction forbids an arbitrary `dlv`
schema; (b) adding delivery tables inside `rec` — rejected: keeps a closed module's
surface stable and keeps the P1-11 RLS/classification/isolation enumeration cohesive in
new schemas; cross-schema `sal → rec/veh` references are the established pattern (`quo →
wo`, `inv → wo`). Cross-schema references: `sal → wo` (work order), `sal → quo`
(quotation revision), `sal → crm` (payer/receiver partners), `sal → org.tax_classes`,
`sal → rec.reception_visits/custody_history`, `sal → veh.odometer_readings/vehicles`,
`sal → shared.document_versions/currencies/number_sequences`; `wty → veh/wo/sal`;
`rpt → iam` (owner user).

**No general ledger (explicit boundary).** No journal, journal-line, chart-of-accounts,
accounting-period, or posting-rule tables. `financial_event` is an **immutable
source-fact integration boundary**, never a journal: it has `source_type`/`source_id`/
`event_type`/`amount`/`currency`/`occurred_at`, and carries **no** debit/credit/account
columns. FR-FIN-* remain future accounting integration (Figure 4.29 direction only).

## 2. NO SECURITY DEFINER, branch scope, money precision (repo invariants)

All P1-11 functions are `SECURITY INVOKER`, `SET search_path = ''`, `REVOKE EXECUTE FROM
PUBLIC`, explicit `GRANT EXECUTE TO app_runtime`. Integrity comes from constraints,
triggers, coherence/provenance guards, and locking — never a privilege boundary. No new
roles. Branch-scoped tables carry `(tenant_id, company_id, branch_id)` + `uq_*_scope_id
UNIQUE(tenant_id, company_id, branch_id, id)` + composite FK to `org.branches(tenant_id,
company_id, id)`. Money is `NUMERIC(18,4)`; quantities `NUMERIC(12,3)`; `currency_code
text` FK → `shared.currencies(code)`. **Zero** `real`/`double precision` on financial
columns (CI precision scan).

## 3. Invoice identity & issue model (FR-SAL-001)

- `sal.invoices` — branch-scoped master: `work_order_id` (composite FK → `wo.work_orders`
  in scope), `quotation_revision_id` (composite FK → `quo.quotation_revisions`, nullable
  where a WO has no quotation), `currency_code`, `captured_net_total`/`tax_total`/
  `gross_total` `NUMERIC(18,4)`, `status` (draft/issued/partially_paid/paid/credited/
  void_before_issue), `record_version`, `invoice_number text` (NULL until issue),
  `issued_at timestamptz` (NULL until issue), `idempotency_key text` (business key).
- **One billable invoice per approved source (FR-SAL-001).** Partial unique
  `uq_invoices_work_order_active UNIQUE(tenant_id, company_id, branch_id, work_order_id)
WHERE status <> 'void_before_issue' AND deleted_at IS NULL` — at most one live invoice
  per work order. (Staged/progress billing is **not** in scope; a single invoice per WO
  is the canonical rule. The optional quotation-revision binding is captured for
  provenance, not to permit multiple invoices.) Cross-scope WO/revision FK rejected (23503).
- **Issue** (`sal.issue_invoice`): under the parent lock, allocate the invoice number
  via the numbering primitive, recompute+verify header totals from immutable lines
  (RAISE 23514 on mismatch), forbid a zero-line issue, set `status='issued'`,
  `issued_at=now()`, emit one `financial_event` (`invoice_issued`), and append a status
  history row — all in one transaction.
- **Immutability:** once `status <> 'draft'`, a `BEFORE UPDATE` freeze guard rejects
  (23514) any change to `invoice_number`, `issued_at`, captured totals, `currency_code`,
  `work_order_id`, `quotation_revision_id`; status may only advance forward
  (draft→issued→partially_paid→paid; issued/…→credited; draft→void_before_issue).

## 4. Invoice numbering (P1-OD-042 open → configuration)

- `sal.invoice_numbering_configs` — per (tenant, company) config: `mode` CHECK IN
  ('gapless','gapped'), `sequence_code`, effective status. Default mode is
  **configuration**, not invented; the mechanism supports both.
- Reuse `shared.next_display_number(sequence_code, company, branch)` which does
  `SELECT … FOR UPDATE` on the `shared.number_sequences` row and increments in the
  caller's transaction: concurrent issues serialize (strict sequence, no duplicates); an
  aborted transaction rolls back the increment so **no number is consumed on abort**
  (gapless + rollback-safe). This is **proven by transaction-level tests** (Wave 2/7),
  not assumed. Number-sequence rows for the `'invoice'`/`'receipt'` codes are provisioned
  at onboarding (not seeded). Merged migrations are not edited; if the allocator proves
  unsafe a phase-local issue function using the same sequence rows is added — the test
  evidence decides.

## 5. Invoice line & payer split (FR-WTY-004, BR-SAL-002 header reconcile)

`sal.invoice_lines`: `line_type` CHECK IN ('service','part','fee'), `quantity`
`NUMERIC(12,3)`, `unit_price`/`net_amount`/`tax_amount`/`gross_amount`
`NUMERIC(18,4)`, `tax_class_id` (composite FK → `org.tax_classes(tenant,company,id)`,
nullable), `customer_pay_amount`/`warranty_pay_amount` `NUMERIC(18,4)`, source refs
(`source_service_line_id`→wo, `source_part_issue_id`→inv, `source_quotation_item_id`→quo;
all nullable/opaque). Per-line CHECKs: amounts ≥ 0; `gross_amount = round(net_amount +
tax_amount, 4)`; **`customer_pay_amount + warranty_pay_amount = gross_amount`** (single
unambiguous payer allocation, FR-WTY-004); `currency_code` = header currency (guard).
Header totals reconcile to the sum of immutable lines (deferred constraint trigger, like
`quo.guard_revision_totals`). Lines freeze once the invoice is issued.

## 6. Payments, receipts, allocation locking (FR-SAL-003, BR-SAL-002)

- `sal.payment_methods` — dual-scope reference (platform structural rows cash/
  card_terminal/bank_transfer + tenant rows), `method_code`, `kind` CHECK IN
  ('cash','card_terminal','bank_transfer') — **no gateway/settlement types**.
- `sal.receipts` — branch-scoped: `receipt_number` (via numbering), `payment_method_id`
  FK, `payer_partner_id` (→crm), `currency_code`, `amount NUMERIC(18,4)`, `received_by`,
  `received_at`, `evidence_document_version_id` (→shared.document_versions, nullable),
  `idempotency_key`, `status` CHECK IN ('recorded','partially_allocated','allocated',
  'reversed'). Append-only in spirit; corrections via reversal only.
- `sal.payment_allocations` — receipt→invoice `NUMERIC(18,4)`, currency coherence. **No
  editable balance column.** `sal.allocate_receipt` locks the receipt row and the invoice
  row `FOR UPDATE` in a **fixed order (receipt then invoice)** to avoid deadlock, then
  enforces: allocation ≤ receipt unallocated (derived), allocation ≤ invoice open
  receivable (derived, incl. credits/reversals), currency match, and inserts the
  allocation + emits `payment_allocated` event. **Invariant:** `Σ active allocations +
unallocated = receipt amount` (BR-SAL-002); concurrent allocations cannot overspend the
  receipt or overpay the invoice (race tests ×5).

## 7. Outstanding-balance derivation (never stored)

`sal.invoice_open_receivable(invoice)` and `sal.partner_outstanding_balance(partner)` are
functions/views deriving open receivable from: issued invoice gross − Σ active
allocations − Σ approved credit notes (+ receipt reversals restoring receivable where an
allocation is undone). No table stores an editable balance. A property test compares the
derivation to a fact-level recomputation across randomized allocation/credit/reversal
sequences (TC-P1-11-004).

## 8. Credit note & receipt reversal (FR-SAL-004, dual control, Table 3.10)

- `sal.credit_notes` — invoice-linked, `amount NUMERIC(18,4)`, `reason`, `requested_by`/
  `approved_by` (maker≠approver, NOT NULL when approved), `approval_state`
  (pending/approved/rejected), `issued_at`, `idempotency_key`, immutable once approved;
  credit ≤ invoice open receivable at approval; emits `credit_note_issued`.
- `sal.receipt_reversals` — `original_receipt_id` FK (original **retained**, never
  deleted), `amount` (≤ unreversed receipt amount), `reason`, `requested_by`/`approved_by`
  (**maker≠approver**), `reversed_at`, `idempotency_key`; emits `receipt_reversed`;
  concurrent-reversal race safe (row-lock original, sum prior reversals). No destructive
  update/delete.

## 9. Financial-event trust model (TS-002, TC-P1-11-005)

`sal.financial_events` — **immutable append-only** ledger (SELECT+INSERT grants only,
`seq bigint GENERATED ALWAYS`): `event_type` CHECK IN ('invoice_issued','receipt_recorded',
'payment_allocated','credit_note_issued','receipt_reversed','warranty_split_recorded'),
`source_type`, `source_id`, `(tenant,company,branch)`, `amount NUMERIC(18,4)`,
`currency_code`, `occurred_at`, `actor_id`, `correlation_id`, `idempotency_key`. Controls:
(1) **single-use** `UNIQUE(tenant_id, source_type, source_id, event_type)` — one event per
source command; (2) **provenance guard** `BEFORE INSERT` requiring the named source row to
exist in scope and be in an authorized/terminal state and bind the amount (issued invoice
→ gross; recorded receipt → amount; allocation → amount; approved credit → amount;
reversal → amount) — a **raw forged event with no valid source is rejected** (proven by
test); (3) append-only (no UPDATE/DELETE grant, immutability trigger). **Exactly one event
per successful financial command** (completeness property test). No debit/credit/account
fields.

## 10. Idempotency (BR-SAL-001)

DB-level unique business keys complement the Phase 1-4 `shared.idempotency_keys` store:
`invoices.idempotency_key`, `receipts.idempotency_key`, `credit_notes.idempotency_key`,
`receipt_reversals.idempotency_key`, plus the single-use financial-event key. A replayed
issue/receipt/reversal hits the unique constraint (23505) and the primitive returns the
original row rather than a second effect (zero duplicate rows, zero duplicate events).

## 11. Delivery & custody closure (BR-REC-001, TC-P1-11-003)

- `sal.delivery_records` — branch-scoped: `work_order_id` (→wo), `reception_visit_id`
  (→rec.reception_visits), `vehicle_id` (→veh, carried for the odometer FK),
  `delivering_employee_id`, `delivered_at`, `final_odometer_reading_id` (composite FK →
  `veh.odometer_readings(tenant, vehicle_id, id)`), `status` (ready/receiver_verified/
  signed/delivered/exception), `idempotency_key`. Eligibility: WO in scope + vehicle/visit
  coherence; the specific "closed/billable" eligible-state set is **configuration**
  (documented open contract, not invented state names).
- `sal.delivery_checklist_templates` (+ `_items`) — tenant-configurable; `is_mandatory`.
- `sal.delivery_checklist_results` — per-delivery `outcome` CHECK IN
  ('passed','failed','waived') + `waiver_reason` (required when waived). Mandatory items
  must pass or carry a waiver to complete.
- `sal.authorized_receivers` — `receiver_partner_id` (→crm) validated against
  `rec.reception_party_roles` for the visit / P1-6 authorized-person relationships;
  `identity_evidence_document_version_id` (→shared.document_versions).
- `sal.delivery_signatures` — **restricted**: `signer_role`, `signature_document_version_id`
  (→shared.document_versions, binds `sha256` hash), `signed_at`; append-only.
- `sal.delivery_status_history` — append-only ledger.
- `sal.complete_delivery` primitive (atomic, idempotent): verify eligibility + authorized
  receiver + mandatory checklist + final odometer coherence, insert the final odometer
  reading, write the `rec.custody_history` release/handover row **once**, set
  `status='delivered'`, append status history. Duplicate completion is idempotent (custody
  released exactly once).

## 12. Warranty (FR-WTY-001…004, BR-WTY-001)

- `wty.warranty_policies` (+ `wty.warranty_coverage` effective-dated with a gist EXCLUDE
  no-overlap on active coverage, covered services/parts, `duration_months`,
  `odometer_limit`). **Eligibility uses terms effective at the original service/delivery
  date** (a backdated policy cannot change historical interpretation — proven by test).
- `wty.warranty_records` — `vehicle_id`, `work_order_id`, `delivery_record_id`,
  `policy_id`(+version), `start_date`, `expiry_date`, `odometer_at_issue`,
  `odometer_limit`, `idempotency_key`; immutable after issue (freeze guard).
- `wty.warranty_record_items` — covered jobs/parts, source work-job/part links (FR-WTY-002).
- `wty.warranty_status_history` — append-only (issued/active/expired/voided/
  claimed_against). **No full claim adjudication** (Figure 4.25 claim structures activate
  with backend P1-22; not built here per P1-OD-024).

## 13. Reporting configuration & saved-filter isolation (FR-RPT-001…004, BR-RPT-001)

- `rpt.report_configurations` (+ `rpt.report_configuration_versions`, monotonic; published
  version immutable) — `report_code`, `scope`, `parameter_schema jsonb`,
  `export_permission_code`, `owner_user_id`, status draft/published.
- `rpt.saved_filters` — `report_code`, `owner_user_id`, `filter_definition jsonb`, `name`.
  **User-owned RLS:** visible/mutable only to the owning user (`owner_user_id =
iam.current_user_id()`) within the tenant. Export scope cannot structurally exceed the
  report scope. No report datasets, KPI formulas, or export backend.

## 14. Financial privacy (NFR-PRV-001, TS-003)

RLS alone does not hide sensitive **columns**. Amount-bearing and identity-evidence
payloads are gated by a dedicated `sal.finance.view` permission via **restricted 1:1
detail tables** (classification='restricted', whole-table RLS with `AND
iam.has_permission('sal.finance.view')`) where a role without financial permission must
not read amounts — applied to the sensitive projections (delivery signatures already
restricted; receiver identity evidence; and any amount payload the classification review
flags). Base rows remain tenant/branch-scoped. Delivery signatures and receiver identity
evidence are classified sensitive; payer identity, invoice/line/receipt/allocation/credit/
reversal/financial-event amounts, and payer splits are classified and mapped to financial
permissions + the Table 3.10 sensitive-export row; export permission codes recorded for
P1-23.

## 15. Append-only / immutability / correction matrix

Immutable-after-issue: `invoices`, `invoice_lines`, `credit_notes` (after approval),
`warranty_records`. Append-only ledgers (SELECT+INSERT only, seq): `invoice_status_history`,
`financial_events`, `delivery_signatures`, `delivery_status_history`,
`warranty_status_history`. Correction-linked (never destructive): `receipt_reversals`,
`credit_notes`. Effective-dated config: `warranty_coverage`, `invoice_numbering_configs`,
`report_configuration_versions`. User-owned mutable: `saved_filters`. Mutable draft
master until issue: `invoices`, `invoice_lines`, `receipts` (until reversed).

## 16. Index & FK plan

**ON DELETE RESTRICT on all financial records** (invoices, lines, receipts, allocations,
credits, reversals, financial events — no cascade). Every FK gets a non-partial covering
index satisfying the repo FK-cover guard. Notable indexes: invoice number, WO→invoice,
unpaid invoices (partial), invoices by payer/date/status; receipt number, receipts by
payer/date; allocations by receipt and by invoice; financial events by
(source_type,source_id) and by correlation/date; delivery-ready WOs, delivery by
visit/vehicle; warranty expiry, warranty by vehicle/WO; report configs; saved filters by
(owner_user_id, report_code).

## 17. Adversarial design gate — findings & resolutions

Ten read-only lenses reviewed this design against the live catalog and the merged
P1-2…P1-10 migrations. Findings and binding resolutions:

1. **Invoice architecture — multiple invoices per WO could double-bill.** Resolution:
   partial-unique one-live-invoice-per-WO (§3); no staged billing in scope. **Resolved.**
2. **Numbering rollback safety unproven / gap on abort.** Resolution: reuse the
   FOR-UPDATE allocator and **prove** rollback-safe gapless + concurrency by
   transaction-level tests before claiming it (§4). **Resolved (test-gated).**
3. **Allocation over-spend / over-pay under concurrency; deadlock.** Resolution: fixed
   lock order (receipt→invoice) `FOR UPDATE`, derived receipt-unallocated and invoice-open
   checks inside the lock, ×5 race tests (§6). **Resolved.**
4. **Editable outstanding balance could be tampered.** Resolution: derivation only, no
   balance column, property test (§7). **Resolved.**
5. **Forged financial event / missing event / duplicate event.** Resolution: single-use
   unique + provenance guard + append-only + completeness property (§9). **Resolved.**
6. **Self-approved reversal/credit; destructive correction.** Resolution: maker≠approver
   guard, original retained, reversal ceiling, no delete grant (§8). **Resolved.**
7. **Delivery to unauthorized receiver / double custody release / forged signature.**
   Resolution: receiver validated vs recorded party roles, custody released exactly once
   (idempotent), signature binds an immutable `document_versions.sha256` (§11).
   **Resolved.**
8. **Warranty backdating changes historical eligibility.** Resolution: effective-dated
   coverage evaluated at service date; issued record frozen; gist EXCLUDE no-overlap
   (§12). **Resolved.**
9. **Saved-filter cross-user leak / export scope escalation.** Resolution: owner-only RLS
   on saved filters; export scope ≤ report scope structurally (§13). **Resolved.**
10. **General-ledger scope creep / financial-data leakage.** Resolution: `financial_event`
    has no journal fields; no GL tables; amount payloads permission-gated (§9, §14).
    **Resolved.**

**Medium residuals (accepted, documented):** derivation recomputation cost O(n) per
balance query (correctness > perf; incremental caching deferred to P1-22 backend);
delivery eligible-state set and numbering default mode remain **configuration/open
contracts** (P1-OD-023/042) rather than invented values. **Zero unresolved Critical or
High. The design gate is passed; migrations may proceed.**

## 18. Migration set (roll-forward-only for financial tables)

`20260724090000_salwtyrpt_schemas` · `…091000_sal_invoices` · `…092000_sal_payments` ·
`…093000_sal_financial_events` · `…094000_sal_delivery` · `…095000_wty_warranty` ·
`…096000_rpt_reporting`. Financial tables classified roll-forward-only (no down-migration).

## 19. Post-review binding amendments (adversarial gate — round 2)

Two independent adversarial reviewers (financial; delivery/warranty/reporting) surfaced
**1 Critical, 8 High, 12 Medium, 4 Low** against the round-1 design. All are adopted as
**binding amendments** below; the general-ledger boundary was confirmed clean. **Zero
unresolved Critical or High remain after these amendments; migrations may proceed.**

**Critical**

- **[C1] Concurrent double custody release.** `rec.guard_custody_transition` reads the
  last state unlocked and there is no released-uniqueness. **Fix:** an additive forward
  migration adds `uq_custody_history_released` (partial unique on
  `rec.custody_history(tenant_id, company_id, branch_id, reception_visit_id) WHERE
to_state='released'`) — a hard exactly-once backstop (2nd release → 23505); plus a
  one-live-delivery-per-WO partial unique on `sal.delivery_records`; plus
  `complete_delivery` locks its own delivery row `FOR UPDATE` and re-checks status
  (idempotent). Same additive-forward pattern as P1-10's `wo` forward FKs.

**High**

- **[H-fin-1] Reversal has no derivation hook (silently loses receivable).** **Fix:**
  full-receipt reversal only (partial reversal out of scope, documented); `receipts.status
→ reversed`; the outstanding-balance derivation **excludes allocations of reversed
  receipts**; `CHECK receipt_reversals.amount = original receipt amount`. Allocations stay
  append-only.
- **[H-fin-2] Write-skew: credit/reversal past gross → open receivable < 0.** **Fix:**
  one global lock order (receipts by id → invoices by id); `approve_credit_note` and any
  open-receivable consumer take `SELECT … FOR UPDATE` on the invoice row before deriving
  and inserting; credit ≤ derived open under the lock.
- **[H-fin-3] Missing-event: no control forces the event to exist.** **Fix:** deferred
  `CONSTRAINT TRIGGER`s make completeness a constraint — an issued invoice / recorded
  receipt / allocation / approved credit / reversal must have its matching
  `financial_events` row in the same transaction, else the commit fails.
- **[H-fin-4] Mutable receipt amount tamper.** **Fix:** `guard_receipt_freeze` — once the
  `receipt_recorded` event exists or status ≠ 'recorded', `amount`/`currency_code`/
  `payment_method_id`/`payer_partner_id`/`received_at` are immutable; corrections via
  reversal only.
- **[H-fin-5] Draft `invoice_number` injection bypasses the allocator.** **Fix:** `CHECK
((invoice_number IS NULL AND issued_at IS NULL) = (status IN ('draft',
'void_before_issue')))` — a number only appears at the atomic draft→issued transition
  through `issue_invoice`.
- **[H-fin-6] Dual-control actors client-supplied → self-approval.** **Fix:** server-stamp
  `requested_by := iam.current_user_id()` at creation and `approved_by :=
iam.current_user_id()` at approval (trigger/function), both immutable, keep `CHECK
approved_by <> requested_by`.
- **[H-dlv-1] Delivery gates bypassable (custody release not gated to the pipeline).**
  **Resolution (reclassified to accepted residual during implementation):** the delivery
  gates — verified authorized receiver, mandatory checklist, signature, and coherent
  final odometer — are enforced inside `sal.complete_delivery`, the sanctioned delivery
  path (proven by tests). A rec-forward `BEFORE INSERT` guard on `rec.custody_history`
  requiring a delivered `sal.delivery_records` row was prototyped but **removed**: it
  broke the merged, independently-valid Phase 1-8 custody state machine (which
  legitimately releases custody without a commercial delivery) and inverted the module
  dependency (`rec` must not depend on `sal`). A raw custody-release INSERT produces no
  delivery record, warranty, or invoice, so it cannot fabricate a completed commercial
  delivery; it only closes custody, which the merged custody chain already governs
  (accepted → in_workshop → released, **exactly once** via the additive
  `uq_custody_history_released`). **Residual risk:** a privileged rec-domain actor could
  close custody outside the delivery pipeline (an audited rec operation), which does not
  bypass any billing/warranty control. Accepted.
- **[H-priv-1] Base financial amounts are not column-hidden under the single `app_runtime`
  role.** RLS hides rows, not columns. **Fix:** amounts move to restricted 1:1 detail
  tables gated by `sal.finance.view` — `sal.invoice_amounts` (net/tax/gross) and
  `sal.invoice_line_amounts` (unit_price/net/tax/gross/customer_pay/warranty_pay); base
  invoice/line rows stay branch-scoped (structural only, so non-finance staff see
  existence/status but not amounts). The pure-finance tables (`receipts`,
  `payment_allocations`, `credit_notes`, `receipt_reversals`, `financial_events`) carry
  `AND iam.has_permission('sal.finance.view')` in their SELECT policy (whole-row
  financial gating). Reconciliation and provenance operate on the amount tables.

**Medium (all fixed):** [M-fin-1] invoice `status` stores lifecycle only
{draft,issued,credited,void_before_issue}; paid/partially_paid are **derived**, never
stored (avoids a 'paid' that contradicts a reversal-restored balance). [M-fin-2]
`issue_invoice` resolves `sequence_code` from the active numbering config; single
rollback-safe allocator path; `mode` documents legal posture. [M-fin-3] each primitive
resolves idempotency by an in-lock pre-check that short-circuit-returns the original
**before** allocating a number or emitting an event. [M-fin-4] `credit_note.currency =
invoice.currency`, `receipt_reversal.currency = receipt.currency` (CHECK/composite FK).
[M-fin-5] cross-branch prevention: composite scoped FKs reference the child's own
`(tenant,company,branch)`. [M-dlv-1] guard `delivery.vehicle_id = wo.vehicle_id AND
delivery.reception_visit_id = wo.reception_visit_id`. [M-dlv-2] authorized receiver is
validated time-aware against an active `rec.reception_party_roles` role for **this**
visit (or a valid CRM authorized-person for the vehicle at `delivered_at`). [M-wty-1]
gist EXCLUDE / partial unique prevents overlapping active warranty records per
vehicle+coverage. [M-wty-2] `odometer_at_issue` binds `delivery.final_odometer_reading_id`
and `start_date` binds `delivery.delivered_at`. [M-wty-3 / L-fin-2] `warranty_split_recorded`
source = issued invoice, amount = Σ line `warranty_pay_amount`, emitted by `issue_invoice`
when > 0, single-use per invoice. [M-rpt-1] `saved_filters` owner RLS pins
`owner_user_id = iam.current_user_id()` in USING **and** WITH CHECK on SELECT/INSERT/UPDATE
and forbids re-owning; removal is by **soft-delete** (UPDATE `deleted_at`) — no hard
`DELETE` grant, consistent with the platform-wide "hard delete is never an application
capability" invariant; `report_configurations`/`_versions` are tenant-scoped with explicit
RLS. [M-rpt-2] coarse `scope_level` is DB-enforced (`saved_filter.scope_level ≤ report
scope_level`); fine-grained jsonb subset is documented app-tier (P1-23).

**Low (all fixed / accepted):** [L-fin-1] header reconciliation never skipped for an
issued invoice with `gross_total <> 0` (no sum=0 teardown heuristic on financial rows).
[L-fin-3] `issue_invoice` recompute and the deferred totals trigger use the identical
round-then-sum convention. [L-dlv-1] the mandatory-checklist aggregate is evaluated inside
the completion lock and checklist results freeze once delivered. [L-dlv-2] signature blob
↔ hash verification is a storage-tier concern (accepted; the DB anchors the immutable
`sha256`).

**Accepted Medium residuals (documented, deferred):** outstanding-balance derivation is
O(n) per query (incremental caching → P1-22 backend); delivery eligible-state set and
numbering default mode remain configuration / open contracts (P1-OD-023/042); full
warranty claim adjudication is deferred to P1-22 (P1-OD-024).

## 20. Final red-team (PART S) — additive raw-DML hardening

A final adversarial red-team pass (PART S), run against the migrated catalog after §19,
probed raw single-statement SQL that bypasses the sanctioned functions. It surfaced **3
High (one borderline Critical), 1 Medium, 1 Low** — all resolved **additively** (two new
guard functions + two new triggers; the rest folded into existing guards). **Every
Critical/High is Fixed; the Medium is Fixed structurally with one accepted documented
residual (M-wty-2b); the Low is Fixed. Zero unresolved Critical or High remain.** This is
a new subsection; it does not restate the §17/§19 findings.

- **[HIGH-1] (borderline Critical) Raw `UPDATE sal.receipts SET status='reversed'` unwinds
  a payment with no reversal record, no maker≠approver dual control, and no
  `receipt_reversed` financial event** — the open-receivable derivation drops
  reversed-receipt allocations, so a paid invoice silently re-opens. **Fix:** (a)
  `sal.guard_receipt_freeze` now permits a receipt to reach `reversed` **only** when an
  **approved** `sal.receipt_reversals` row exists for it (i.e. only through
  `sal.approve_receipt_reversal`); (b) `sal.approve_receipt_reversal` is reordered to
  approve the reversal **before** flipping the receipt.
- **[HIGH-2] Issued invoice header totals were mutable post-issue.**
  `sal.invoice_amounts.net_total`/`tax_total`/`gross_total` were not covered by the generic
  immutable guard, and the reconcile trigger fires only on line-amount DML — so a finance
  user could move the derived open receivable and desync from the frozen lines and the
  `invoice_issued` event. **Fix:** new `sal.guard_invoice_amount_frozen` + trigger
  `tg_invoice_amounts_frozen` freeze the totals once the parent invoice leaves draft
  (symmetric to the existing line-amount freeze; `issue_invoice` writes them while still
  draft, so it is unaffected).
- **[HIGH-3] Raw INSERT of a born-`issued` invoice** bypassed the gapless
  `shared.next_display_number` allocator **and** the `invoice_issued` completeness event.
  **Fix:** `sal.guard_invoice_freeze` now also fires **BEFORE INSERT** and requires a new
  invoice to be born `status='draft'` (number/`issued_at`/issued status appear only at the
  draft→issued transition inside `sal.issue_invoice`). No new object.
- **[MED / M-wty-2] Raw INSERT into `wty.warranty_records` was unbounded** — the delivery
  binding lived only inside `wty.issue_warranty`. **Fix (structural):** new
  `wty.guard_warranty_record_coherence` + trigger `tg_warranty_records_coherence` (BEFORE
  INSERT) require the referenced delivery to be `status='delivered'` and its
  `vehicle_id`/`work_order_id` to match the record. **Accepted residual [M-wty-2b]:** the
  finer `odometer_at_issue`/`start_date` **value** binding stays enforced only inside
  `wty.issue_warranty` — the downstream claim adjudication is out of P1-11 scope, and
  binding exact values at the constraint layer would replicate the issue derivation and fix
  warranty policy the phase deliberately leaves open (parallel to the accepted H-dlv-1
  residual).
- **[LOW / L-fin-4] A line-amount's denormalized `invoice_id` could differ from its parent
  line's `invoice_id`.** **Fix:** folded a coherence check into the existing
  `sal.guard_invoice_line_amount_frozen` (raises `23503` if the line does not belong to the
  claimed invoice). No new object.
