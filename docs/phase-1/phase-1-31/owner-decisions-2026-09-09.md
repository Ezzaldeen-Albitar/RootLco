# P1-31 — the Owner's decisions of 2026-09-09

**Status:** RECORDED · **Authority:** the Owner, 2026-09-09 · **Scope:** the open decisions
**D-3**, **D-4**, **D-5** and **D-6** of [`a0-preflight.md`](./a0-preflight.md), the narrow **P-9b**
correction, and three governance items raised alongside them.

These are NEW decisions taken on 2026-09-09. They are not a restatement of an earlier approval, and
they do not reopen a decision already recorded in
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md). Each section below records what
the Owner decided, in substance, and what that decision forbids as well as what it allows — a
decision recorded only as a permission is the shape that later gets read as a licence.

Nothing here asserts that any gate ran, that any environment exists, or that any work below has
been built. It is a record of decisions.

## 1. P-9b — approved, narrowly

The delivery-completion path is corrected so that `sal.complete_delivery` respects **active,
non-deleted** checklist templates and the item-applicability rules that already exist, rather than
treating a withdrawn or superseded template as though it still bound the completion.

The approval is narrow, and the narrowness is the decision:

- The correction lands as a **forward migration** under the registered backend owner for that
  surface. No committed migration is edited.
- Every other delivery condition is preserved exactly as it stands — the authorization boundary,
  the transaction rule, and the historical record a completed delivery leaves behind. The
  correction changes which templates bind, and nothing else.
- Proof must cover the **active**, **inactive** and **deleted** template cases, plus isolation and
  regression cases, so that the rule is shown to hold and shown not to have widened.
- Withdrawing an item is a **temporary workaround**, not the closure. P-9b closes when the server
  rule is corrected; a withdrawal in the meantime does not close it.

## 2. D-3 — settled

The operational **ready-for-delivery queue** is the set of work orders that satisfy the
**authoritative server delivery-eligibility rules**, and it INCLUDES eligible work orders that do
not yet have a delivery record. It is a different question from the delivery-record list, which is
a listing and history of records that already exist.

Consequences the Owner attached to that answer:

- `GET /api/v1/deliveries` (#358) is the **delivery-record listing** contract. It is not the
  readiness queue, and it does not close **FE-001**.
- The smallest missing server contract for the readiness queue is to be identified in the owning
  prerequisite lane, not improvised by the screen that needs it.
- No new work-order status is introduced merely so that the screen has a name to filter on.
- Eligibility is **not** computed in the browser. The rules are the server's.
- Finance permissions are not broadened to make the queue readable.

## 3. D-4 — an approved baseline of four reports

Four report definitions are approved as the phase baseline. Where a compatible report code already
exists it is reused; where none does, these identifiers are the ones to use.

- **`work_orders_by_status`** — work-order reference, branch, the customer and vehicle identifiers,
  the opening date and the current status, with counts by status computed on the server for the
  scoped selection.
- **`technician_labor_time`** — technician, branch, work-order reference, work-log date and the
  recorded duration. The definition states which log states contribute; cancelled and deleted logs
  are excluded. Recorded duration is duration, and the definition says so: it is not productivity
  and it is not a payroll figure.
- **`inventory_movements`** — movement date, reference and type, the item, the warehouse or
  location, and the quantity with its unit. Totals are separated by item and by compatible unit,
  and the distinct meanings of a return and a transfer are preserved rather than netted away.
- **`invoice_payment_summary`** — document reference, type and date, branch, customer, currency, the
  authoritative invoice amount, the receipt or allocation amount and the outstanding amount.
  Invoiced amounts, cash receipts and receivables stay distinct; no allocation is counted twice; no
  total crosses currencies.

Every one of the four must additionally specify its **period and date semantics**, its **timezone**,
its **authorization**, its **source**, its **freshness** and its **drill-through**. All calculation
is done on the server. Where a field or an aggregation the definition needs does not exist, it
becomes a **named backend prerequisite** — never an invented value, and never a column quietly
dropped from the definition so that the gap disappears.

This is the phase baseline. It is not the wider reporting backlog, and approving it does not approve
anything beyond these four.

## 4. D-5 — the branch summary

The branch summary is a **branch-filtered view of the same defined operational sections** approved
above. It introduces no measure of its own.

- No tenant or branch is hard-coded anywhere in it.
- No single inventory quantity is presented across unlike items; a quantity is meaningful only
  within an item and a compatible unit.

## 5. D-6 — FE-015 and the export contract

The shipped **Audit Log** screen is reused for **FE-015** where it meets the canonical requirements.
Separately, **P-12**'s approved report-export contract is completed, with explicit authorization and
explicit auditability.

What the reuse does NOT authorize:

- It does not authorize adding an export capability to the audit route.
- It does not authorize granting export to every administrator.
- Any scope in which audit data may be exported stays **explicit** — named, granted deliberately,
  and recorded.

## 6. Documentation and governance

- **Media-retrievability statements.** The stale statements in
  `docs/product/workshop/reception-media-checklist.md` may be corrected factually against the
  protected behaviour the repository actually implements. The correction preserves the Owner's
  access and privacy requirements and preserves the historical decision context; it corrects what
  the document asserts, it does not rewrite why the decision was taken.
- **Portable approved project instructions.** The portable approved project instructions
  (`CLAUDE.md`) are brought under version control through the repository-tooling ownership path,
  excluding secrets and machine-local configuration.
- **Combined permission rollout.** The combined permission rollout (backfill) runs **once**, for
  newly approved codes only. Tenant customizations and explicit denials are preserved. The backfill
  performed in #350 is not repeated in order to produce evidence.

## 7. Standing verification policy

Targeted local checks plus the required hosted gates are the standing expectation. The local
`verify:workspaces` aggregate is **not** a per-commit prerequisite.

This is to be applied once, through the existing governance path (CONTRIBUTING), rather than
re-litigated in each execution slice.
