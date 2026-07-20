# Phase 1-10 — Adversarial Design Review Response Ledger

**Phase ID:** P1-10 · **Gate:** [phase-1-10-design.md](phase-1-10-design.md) ·
**Review model:** owner-authorized technical, QA, security, and adversarial
self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the
Standing Technical Authorization Policy — **not** an independent third-party review.

A nine-lens adversarial panel (service/version, pricing/precision, quotation/approval,
inventory ledger, reservation concurrency, RLS/privacy, forward-FK, procurement/scope,
whole-design red team) reviewed the design against the live PostgreSQL 17.6 catalog and
the merged P1-9 migrations. **38 findings: 2 Critical, 14 High, 20 Medium, 2 Low.**
**Every Critical and High is resolved by a binding amendment below; every Medium is
fixed or formally accepted with rationale; both Lows are fixed. Zero unresolved Critical
or High remain.** These amendments are binding on all P1-10 migrations and tests.

## Critical

**C1 / C2 — Movement authenticity (the coherence guard is a tautology; phantom stock via
forged movement).** The balance coherence guard proves `balance = Σ movements` but not
that a movement is _legitimate_; because `SECURITY DEFINER` is forbidden repo-wide,
`app_runtime` holds direct INSERT on `inv.stock_movements`, so a forged movement + matching
balance write passes the guard and mints stock. **Resolution (binding):** move the trust
root onto the movement ledger itself. (1) `inv.stock_movements.signed_qty` is `GENERATED
ALWAYS` from `movement_type × quantity` — sign/magnitude cannot be decoupled. (2) Each
`reference_kind` has a **provenance-strict** BEFORE INSERT guard: the source row must exist
in the movement's scope, be in its **authorized/terminal** state, and **bind the movement
quantity** to the source — `opening` → an `opening_inventory_lines` row in an **approved**
batch, not already posted; `adjustment` → an **approved** `stock_adjustments` row
(`approved_by <> requested_by`) with `signed_qty = adjustment_quantity`, not already
posted; `issue` → a `part_issues` row (qty bound, reservation consumed); `return` → a
`part_returns` row with row-locked `Σ returns ≤ issued`; `damage` → a `damaged_stock` row,
source a sellable location. (3) A **single-use** constraint (partial-unique on
`(reference_kind, reference_id [, movement_type])` for one-shot sources; row-locked
`Σ(qty) ≤ source_qty` for divisible sources) prevents replay/double-post. (4) Balances are
written only as a delta consistent with the just-inserted movement, under the balance-row
`FOR UPDATE` lock. A QA test **raw-inserts a movement bypassing the functions and asserts
rejection** — the functions are advisory under no-DEFINER, so the constraints are the real
enforcement.

## High

- **H1 service-version succession.** Published-version freeze collided with `effective_to`
  closure, making succession impossible. **Resolution:** add
  `svc.publish_service_version(service_id, version_id, effective_from)` (`SECURITY
INVOKER`) that, under a per-service `FOR UPDATE` lock, atomically closes the prior
  published version's open `effective_to` to the new `effective_from` and flips the new
  version `draft→published`. `effective_to` is **excluded** from the immutability freeze
  (identity, `effective_from`, `version_no`, content stay frozen); a monotonic close CHECK
  allows `NULL→date` only. The gist `EXCLUDE` remains the concurrency backstop.
- **H2 / part of H11 — NULLS NOT DISTINCT.** Nullable narrowing columns made the
  anti-ambiguity unique index a no-op for tenant-wide rules. **Resolution:** all
  anti-ambiguity uniques use `UNIQUE ... NULLS NOT DISTINCT` (repo precedent: `0003`).
- **H3 single-issued-revision invariant.** A direct status UPDATE could create two issued
  revisions. **Resolution:** partial `UNIQUE(tenant_id, quotation_id) WHERE status='issued'
AND deleted_at IS NULL`; a `draft→issued` transition guard permits the flip only through
  the allocator with the prior issued sibling superseded; `quo.issue_revision` repoints
  `quotations.current_revision_id` atomically under the parent lock; the decision guard
  binds to `current_revision_id AND status='issued'`.
- **H4 totals reconciliation at issue.** **Resolution:** `quo.issue_revision` recomputes
  `captured_subtotal/tax/discount/grand_total` from the items and RAISEs `23514` on
  mismatch; issuing a zero-item revision is forbidden; rounding order is fixed
  (per-line round-then-sum; each `captured_line_total` is `NUMERIC(18,4)`, the grand total
  is their sum); a **deferred constraint trigger** re-asserts the aggregate on any item or
  revision change.
- **H5 decision→item coherence.** **Resolution:** `approval_decisions` references the item
  through a **single composite FK** `(tenant_id, company_id, branch_id,
quotation_revision_id, quotation_item_id)` → `quotation_items`; the target carries
  `UNIQUE(tenant_id, company_id, branch_id, quotation_revision_id, id)`.
- **H6 decision immutability + uniqueness.** **Resolution:** `approval_decisions` is a true
  append-only ledger (SELECT+INSERT only, no UPDATE/DELETE, no soft-delete); partial
  `UNIQUE(tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id)` gives
  exactly one authoritative decision per revision-item; a change of mind requires a new
  revision.
- **H7 in_transit forgeable.** **Resolution:** **drop** `in_transit_qty`, the `transit`
  location type, and the `transfer` movement kind from P1-10 — inter-location transfers are
  deferred to P1-21. `available = on_hand − reserved`; damage is a single-step move to a
  `quarantine` location.
- **H8 reservation-expiry determinism.** **Resolution:** the coherence guard defines
  "active" by the immutable `status` column only (never `expires_at`/`now()`); expiry is an
  explicit `inv.expire_reservations` primitive that, under the balance `FOR UPDATE` lock,
  flips `active→expired` **and** decrements `reserved_qty` together; `reserve_stock` may
  opportunistically expire stale rows under the lock before computing availability.
- **H9 `available ≥ 0` vs. loss recording.** A hard STORED CHECK blocked recording damage/
  shrinkage on reserved stock. **Resolution:** loss functions (`record_damage`,
  `approve_adjustment` when reducing) first **release conflicting active reservations**
  (junior-first, `status→released`, reason `stock_loss`) within the same locked transaction,
  so `reserved ≤ on_hand` always holds and the `CHECK(available_qty >= 0)` backstop remains
  satisfiable; no-oversell stays enforced at the reserve path.
- **H10 idempotency concurrency + durability.** **Resolution:** the reservation idempotency
  index is partial-`UNIQUE(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
  over **all** statuses (full lifetime). `reserve_stock`, after acquiring the balance-row
  `FOR UPDATE` lock, re-SELECTs an existing reservation by `(tenant_id, idempotency_key)`
  of any status and **returns it** (idempotent — never a raw `23505` to the caller); the
  loser of a genuine stock race gets `23514`.
- **H11 single-book pricing.** `resolve_price` arbitrated across all published price lists
  by id-tiebreak. **Resolution:** add `svc.price_list_assignments` mapping a scope context
  (company/branch/customer-class) to exactly one price list (same specificity precedence,
  NULLS NOT DISTINCT); `resolve_price` resolves the assignment → the assigned list's
  effective published version → one rule. Specificity is a strict bit-weighted total order
  (branch 4 > company 2 > customer-class 1, tie → `priority DESC` → `id`).
- **H12 currency coherence.** **Resolution:** `price_rules` inherits currency from its
  `price_list` (own currency column dropped); guards enforce `quotation_item.currency_code
= quotation_revisions.currency_code = quotations.currency_code`; an applied discount's
  currency must equal the quotation currency; `resolve_price` asserts the resolved currency
  equals the requested currency.
- **H13 freeze against INSERT/DELETE.** Row-level `org.guard_immutable_columns` is UPDATE-
  only. **Resolution:** parent-status freeze guards (the `dia.guard_template_item_frozen`
  pattern) reject INSERT/UPDATE/DELETE of `price_rules` and `standard_labor_times` when the
  parent price-list version is published, and of `quotation_items`/approval rows when the
  parent revision is not draft; no DELETE grant on issued/append-only children; the
  item↔revision total identity is a deferred constraint trigger (H4).
- **H14 aggregate ceilings not row-locked.** **Resolution:** every `Σ children ≤ parent`
  guard and every balance-writing function takes `SELECT ... FOR UPDATE` on the
  serialization anchor (the `part_issue`, the source adjustment/opening line, the balance
  row) before summing; concurrency tests prove single-winner.

## Medium (all fixed unless marked accepted)

- **Hierarchy cycle races** (service_categories/item_categories/stock_locations): the
  re-parent cycle guard takes `pg_advisory_xact_lock(hashtext(tenant_id::text))` to
  serialize; concurrency test added. **Fixed.**
- **Service archival lifecycle:** `svc.services` gains an explicit `lifecycle_status
(active|archived)` + transition guard; branch availability is blocked only when the
  service itself is archived (a not-yet-published service is stageable). **Fixed.**
- **Currency coherence (money):** covered by H12. **Fixed.**
- **Specificity encoding:** strict bit-weighted total order (H11). **Fixed.**
- **Dangling tax class when company NULL:** `CHECK ((company_id IS NOT NULL) OR
(tax_class_id IS NULL))` on `price_rules` (`discount_rules` carries no `tax_class_id`
  column, so it needs no such CHECK). **Fixed.**
- **Published-version child INSERT/DELETE:** covered by H13. **Fixed.**
- **`record_item_decision` race:** takes `FOR UPDATE` on the parent `quotations` row and
  re-reads `current_revision_id` + status under the lock. **Fixed.**
- **Issued item freeze INSERT/soft-delete:** covered by H13. **Fixed.**
- **Quotation number scope:** `UNIQUE(tenant_id, company_id, branch_id, quotation_number)`
  matches the branch-scoped sequence. **Fixed.**
- **Balance-row lock on all writers + O(n) guard cost:** every balance-writing function
  locks the balance row (H14). The coherence guard's full re-sum is **accepted** as a
  documented residual — correctness over performance for a foundation phase; an incremental
  running-sum optimization is deferred to P1-21.
- **Idempotency scope/durability:** covered by H10 (lifetime idempotency). **Fixed.**
- **Dead `inv.cost.view` permission:** the three restricted cost tables are gated on the
  dedicated `inv.cost.view` permission (not the broad PII `iam.sensitive.view`), separating
  financial-cost visibility from PII; a policy-qual test asserts no seeded-but-unreferenced
  permission. **Fixed.**
- **Cross-branch cost leak:** `inv.external_purchase_part_details` and
  `inv.stock_adjustment_details` carry `company_id`/`branch_id` and enforce the full
  branch-scoped clause AND `inv.cost.view`; `inv.item_cost_details` stays tenant-scoped
  (its parent is tenant-scoped). **Fixed.**
- **Forward-FK teardown ordering:** the wo↔quo forward FK makes the two schemas mutually
  referencing (the table-level FK graph stays acyclic); §1's "no cycles" is corrected, and
  `deleteTenantCascade` interleaves — `wo.customer_approval_evidence`/`wo.customer_approvals`
  are deleted before `quo.*`, and `quo.quotations` before `wo.work_orders`. **Fixed** (Wave 7).
- **`external_purchase_parts.status` open vocabulary:** `CHECK (status IN
('recorded','linked','cancelled'))` — no procurement/goods-receipt tokens; migration
  COMMENT records the exclusion. **Fixed.**
- **No-fake-data schema list:** `MODULE_SCHEMAS` (validate-seed-state) and the no-fake-data
  schema IN-list are extended to `svc/quo/inv` in the same wave that seeds UoM. **Fixed**
  (Wave 7).
- **Quotation line arithmetic:** per-line CHECKs `captured_line_total >= 0`,
  `captured_discount >= 0 AND captured_discount <= captured_unit_price * captured_quantity`,
  and the identity `captured_line_total = round(captured_unit_price*captured_quantity −
captured_discount + tax, 4)`. **Fixed.**
- **Reservation starvation / expiry:** covered by H8; the expiry sweep is a required
  maintenance primitive (a scheduled caller lands in P1-21), mitigated by opportunistic
  expiry inside `reserve_stock`. **Fixed** (with a documented P1-21 scheduler dependency).
- **Opening-batch self-approval + evidence FK:** `opening_inventory_batches` gains a
  maker≠approver guard (`approved_by <> counted_by`, `approved_by NOT NULL` when approved);
  `quo.approval_evidence` binds document-type evidence to `shared.document_versions(tenant_id,
id)` via a composite FK (channel-only evidence uses a non-document kind). **Fixed.**

## Low (both fixed)

- **UoM write gate:** INSERT/UPDATE `WITH CHECK (scope='tenant' AND tenant_id =
iam.current_tenant_id())`, UPDATE `USING` excludes platform rows, no DELETE grant,
  immutable `scope`/`tenant_id`; the "no-context default-deny" claim is scoped to business
  tables (platform reference rows are deliberately globally readable). A cross-tenant write
  test proves a tenant session cannot alter/delete/claim a platform UoM row.
- **Quotation-revision candidate key:** `quo.quotation_revisions` denormalizes
  `tenant_id`/`company_id`/`branch_id` and declares `UNIQUE(tenant_id, company_id, branch_id,
id)` so the full-scope forward FK from `wo.customer_approvals` has a valid target.

## Outcome

Zero unresolved Critical or High. All Mediums fixed except two documented performance/
operational residuals (coherence-guard re-sum cost; reservation-expiry scheduler), both
deferred to P1-21 with mitigations. **The design gate is passed; migrations may proceed.**

## Post-implementation red-team follow-up

A second adversarial pass was run against the _implemented_ migrations (not just the
design) after the first clean-room commit. It surfaced two High findings and one Low; all
three were fixed at the database layer with regression coverage before the feature PR. No
Critical or additional High findings remained.

### RT-HIGH-1 — Raw `part_returns` insert could mint phantom stock

- **Severity:** High.
- **Failure path:** the return ceiling (Σ returns ≤ issued quantity) was enforced only
  inside `inv.return_part`. A caller with the ordinary `INSERT` grant on
  `inv.part_returns` could insert a return row directly, bypassing the function, and then
  a matching `part_return` stock movement would pass the provenance guard (which binds the
  movement to the return row's quantity) — minting on-hand stock that was never issued.
- **Root cause:** invariant enforced in application-path code (a `SECURITY INVOKER`
  function) rather than at the table/constraint layer, leaving the direct-insert path open.
- **Fix (constraint layer):** `inv.guard_part_return_ceiling()` `BEFORE INSERT` trigger
  (`tg_part_returns_ceiling`) on `inv.part_returns`. It `SELECT … FOR UPDATE`-locks the
  parent `inv.part_issues` row (serialising concurrent returns), raises
  `foreign_key_violation` if the issue is not in scope, and raises `check_violation`
  (23514) when `Σ existing returns + NEW.quantity > issued quantity`. The control now
  holds for **any** writer — the public function _and_ a raw table insert — because it
  lives on the table, not in the function.
- **Regression test:** `tests/db/inv-operations.test.ts` — "issues to an open work order
  and rejects a return beyond the issued quantity" now also asserts that a raw
  `INSERT INTO inv.part_returns … VALUES (…,1000000,…)` that outruns the issue is rejected
  with `23514`, closing the phantom-stock path.
- **Disposition:** Fixed. **Residual risk:** none identified; the ceiling is
  constraint-enforced and the parent lock serialises concurrency.

### RT-HIGH-2 — Issued quotation revisions were monetarily mutable

- **Severity:** High.
- **Failure path:** an `issued` `quo.quotation_revisions` row could be `UPDATE`d directly
  to rewrite its `captured_*` totals, or to revert `status` back to `draft` — which would
  re-open item editing and release the single-issued partial-unique. Item-level freeze
  alone did not protect the revision header.
- **Root cause:** the captured monetary snapshot and the issued lifecycle were treated as
  backend convention rather than a database invariant.
- **Fix (constraint layer):** `quo.guard_quotation_revision_freeze()` `BEFORE UPDATE`
  trigger (`tg_quotation_revisions_freeze`) on `quo.quotation_revisions`. For any row whose
  `OLD.status <> 'draft'` it rejects (23514) any change to `captured_subtotal`,
  `captured_discount_total`, `captured_tax_total`, `captured_grand_total`, or `issued_at`;
  it permits only `issued → superseded/rejected/expired` and treats
  `superseded/rejected/expired` as terminal. The `draft → issued` transition performed by
  `quo.issue_revision` (where `OLD.status = 'draft'`) is still allowed, so totals are
  captured exactly once and then frozen.
- **Regression test:** `tests/db/quo-quotations.test.ts` — "freezes an issued revision's
  captured totals and forbids reverting to draft" asserts both a
  `captured_grand_total` rewrite and a `status='draft'` revert are rejected with `23514`.
- **Disposition:** Fixed. **Residual risk:** none identified; issued monetary values and
  status are trigger-frozen, not merely convention.

### RT-LOW-1 — `inv.expire_reservations` under-counted

- **Severity:** Low (reporting only; no data-integrity impact).
- **Failure path:** the per-cell loop used `GET DIAGNOSTICS v_count = ROW_COUNT`, which
  _overwrote_ the accumulator each iteration, so the returned integer reflected only the
  last cell's expirations rather than the total swept.
- **Fix:** accumulate into a per-batch variable and sum —
  `GET DIAGNOSTICS v_batch = ROW_COUNT; v_count := v_count + v_batch;`. The actual expiry
  `UPDATE`s (and the coherence-restoring `sync_reserved`) were always correct; only the
  return value changed.
- **Disposition:** Fixed. **Residual risk:** none.

### Object-count impact

The two High fixes add **2 functions** (`inv.guard_part_return_ceiling`,
`quo.guard_quotation_revision_freeze`) and **2 triggers** (`tg_part_returns_ceiling`,
`tg_quotation_revisions_freeze`) to the P1-10 surface; the Low fix changes no object. The
foundation allow-lists (`ALLOWED_ROUTINES`, trigger inventory) and the P1-10 object counts
recorded in `phase-1-10-object-inventory.md`, `phase-1-10-owner-gate.md`,
`phase-1-10-grant-matrix.md`, and `phase-1-10-security-matrix.md` were regenerated from
live introspection to reflect the post-fix totals. The evidence is the green clean-room
run captured in the completion report.
