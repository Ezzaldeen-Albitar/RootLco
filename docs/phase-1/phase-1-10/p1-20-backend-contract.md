# P1-20 (Backend) Data Contract

Phase 1-10 is database-only. This document records the database primitives P1-20 will
orchestrate for the commercial layer (service catalog, pricing, quotation) and the
outbox event contracts it will publish. **No backend or API is implemented in this
phase.**

## Backend database contract (no backend built here)

| Operation                          | DB primitive / invariant                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manage a service catalog           | `svc.services`/`svc.service_categories` INSERT/UPDATE (immutable `service_code`; archived terminal)                                                    |
| Publish a service version          | `svc.publish_service_version(service, version, effective_from)` (forward-only succession; gist EXCLUDE backstop)                                       |
| Manage / publish a price list      | `svc.price_lists`/`price_rules` INSERT/UPDATE; `svc.publish_price_list_version(...)` (published-immutable)                                             |
| Resolve a price                    | `svc.resolve_price(service, company, branch, customer_class, as_of)` — single deterministic winner                                                     |
| Detect over-limit pricing/discount | derive from `svc.pricing_approval_policies` threshold vs. value; **ceiling** in `iam.approval_limits`; segregation flag `maker_approver_distinct`      |
| Draft a quotation revision         | `quo.quotation_revisions`/`quo.quotation_items` INSERT (draft only; per-line arithmetic CHECKs)                                                        |
| Issue a revision                   | `quo.issue_revision(revision, expires_at)` — totals recompute, zero-item ban, supersede prior, repoint `current_revision_id` (single-issued invariant) |
| Record an item decision            | `quo.record_item_decision(item, decision, channel, evidence)` — only against the current issued revision; append-only                                  |
| Block unapproved work              | derive per-item/revision approval state from `quo.approval_decisions` (the DB stores the state; P1-20 gates the workflow)                              |
| Approver authorization             | P1-20 concern — the DB records `decided_by`/channel/evidence; the authorization check (approver ↔ vehicle/payer) is enforced by the backend            |
| Optimistic concurrency             | `record_version` on every mutable master (bumped by `shared.touch_row_metadata`)                                                                       |

The database rejects impossible states directly (single-issued revision, issued-item
freeze, decision-on-current-issued-only, deterministic price resolution, published
immutability), so the backend cannot create them even under concurrency. Correctness
invariants are **not** deferred to P1-20.

## Maker/approver segregation

`svc.pricing_approval_policies.maker_approver_distinct` is the invariant flag; P1-20
enforces maker≠approver at pricing/quotation decision time. (For stock, maker≠approver
is already enforced in the database — see
[phase-1-10-adjustment-approval-contract.md](phase-1-10-adjustment-approval-contract.md).)

## Outbox event contracts (documented, not implemented)

P1-20 will publish domain events via the existing `shared.event_outbox` (Phase 1-5).
Anticipated contracts include:

- `service.published.v1`, `price-list.published.v1`
- `quotation.created.v1`, `quotation.revision-issued.v1`, `quotation.item-decided.v1`
- `quotation.accepted.v1`, `quotation.rejected.v1`, `quotation.expired.v1`

No outbox producer is implemented in this phase; the tables and append-only ledgers are
the source of truth these events will project from.
