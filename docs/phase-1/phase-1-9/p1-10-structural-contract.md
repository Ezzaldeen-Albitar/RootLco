# P1-10 Structural Contract (Quotation and Item Catalog)

Phase 1-10 builds the quotation and item-catalog domain **on top of** the Phase 1-9
work order. This contract states what P1-10 may rely on and what it must not
duplicate. **Phase 1-9 creates no quotation table and no item-catalog table**; it
provides only opaque forward reference fields with a CHECK, never a dangling
foreign key.

## What P1-10 may reference

| Concept                  | Source                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| Work order + scope       | `wo.work_orders` `(tenant_id, company_id, branch_id, id)` candidate key |
| Jobs                     | `wo.jobs`                                                               |
| Service lines            | `wo.work_order_service_lines` (carries the opaque `service_ref`)        |
| Required parts           | `wo.required_parts` (carries the opaque `item_ref`)                     |
| Additional-work requests | `wo.additional_work_requests` (`state` + `fulfillment_state`)           |
| Customer approvals       | `wo.customer_approvals` (carries the opaque `quotation_revision_ref`)   |

## Forward fields to resolve (opaque today)

Phase 1-9 stores these as opaque references (no FK; the target tables do not exist
yet). P1-10 introduces the catalogs and **resolves** them:

- `wo.customer_approvals.quotation_revision_ref` → a P1-10 quotation revision.
- `wo.work_order_service_lines.service_ref` → a P1-10 service-catalog entry.
- `wo.required_parts.item_ref` → a P1-10 item-catalog entry.

## Prohibited duplication

P1-10 must **not** copy work-order, job, service-line, required-part,
additional-work, or approval data into quotation/item tables. Those remain owned by
`wo`; the quotation references them. The `parts_forward_state` text contract on the
work order (default `none`) is where stock-reservation state will be reflected —
P1-10/P1-11 own reservation; the Phase 1-9 closure gate never claims it.

## Contract test

The P1-09 security/foundation suites prove no `wo`/`tech`/`dia`/`qms` object leaks
into another schema and that **no quotation or item table exists in this phase**. A
P1-10 structural-contract test will assert the work-order surface above remains
stable.
