# Phase 1-10 — Item Approval Contract

**Requirement:** FR-QUO-002 (item-granular decisions), FR-QUO-003 (approver authority
recorded), FR-QUO-004 (block unapproved work — gate in P1-20), BR-QUO-001 (decision
binds the exact revision and item), BR-QUO-002 (a revised amount invalidates prior
approval for the affected item).

## Item-granular, exact-binding decisions (H5)

`quo.approval_decisions` references its item through a **single composite FK**
`(tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id) →
quo.quotation_items(tenant_id, company_id, branch_id, quotation_revision_id, id)`. The
target carries the matching `UNIQUE(tenant_id, company_id, branch_id,
quotation_revision_id, id)`. A decision therefore cannot reference an item from a
different revision, and cannot dangle.

## One authoritative decision per revision-item (H6)

`UNIQUE(tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id)` —
exactly one decision per revision-item. The table is a **true append-only ledger**:
grants are SELECT + INSERT only (no UPDATE/DELETE, no soft-delete), so a decision,
once recorded, is immutable. A change of mind requires a **new revision**.

## Recorded only against the current issued revision

`quo.record_item_decision(item_id, decision, channel, evidence_ref)` (`SECURITY
INVOKER`) serializes on the parent `quo.quotations` `FOR UPDATE` lock, re-reads
`current_revision_id` and the revision status under the lock, and permits the decision
only when the item's revision **is** the current revision **and** its status is
`issued`. A superseded revision's decisions are therefore frozen (review-response
Medium: `record_item_decision` race).

## Approver authority and evidence

`decided_by`, `decision_channel` (`in_person`/`phone`/`portal`/`email`/`system`), and
`decided_at` record who decided and how (FR-QUO-003); the **authorization check** (is
this approver authorized for the vehicle/payer?) is a P1-20 concern. Evidence lives in
the append-only `quo.approval_evidence`, where `document`-kind evidence binds an
**exact immutable** `shared.document_versions` row (CHECK `(kind='document') =
(document_version_id IS NOT NULL)`); possession of a document id grants no access.

## Partial-approval superset (P1-OD-020)

Item-granular decisions plus a derivable per-revision rollup form a **structural
superset** supporting full approval, full rejection, per-item approval/rejection, and
partial approval — without inventing a final partial-approval policy table
(P1-OD-020 stays open, documented). FR-QUO-004 (block unapproved work) is a derivable
gate consumed by P1-20.

**Tests:** see the `quo` quotation suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
