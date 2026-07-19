# P1-09 Structural Contract (Work Orders)

Phase 1-9 builds the work-order domain **on top of** Phase 1-8 reception. This
contract states what P1-09 may rely on and what it must not duplicate. **Phase
1-8 creates no work-order table and no `converted`-triggered work order.**

## What P1-09 may reference

A converted reception visit is the origin of a work order. P1-09 may FK / read:

| Concept                          | Source                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Reception visit id + scope       | `rec.reception_visits` `(tenant_id, company_id, branch_id, id)` candidate key             |
| Origin (appointment XOR walk-in) | `rec.reception_visits.appointment_id` / `walk_in_id`                                      |
| Vehicle                          | `rec.reception_visits.vehicle_id` → `veh.vehicles (tenant_id, id)`                        |
| Accepted custody                 | `rec.custody_history` (append-only chain)                                                 |
| Authorization                    | `rec.authorizations` (approved record)                                                    |
| Current reception state          | `rec.reception_visits.reception_status` (`converted` reachable)                           |
| Party roles                      | `rec.reception_party_roles` (service_requester, payer, …)                                 |
| Complaints                       | `rec.complaints` (+ gated `rec.complaint_details`)                                        |
| Inspection evidence              | `rec.visual_inspections` / `rec.condition_items` / `rec.damage_maps` / `rec.damage_marks` |
| Odometer / fuel / SOC at intake  | `rec.reception_visits.odometer_reading_id` / `fuel_level_id` / `ev_soc_percent`           |

## Allowed P1-09 foreign keys

A work order should FK the reception visit via the branch-scoped candidate key
`(tenant_id, company_id, branch_id, reception_visit_id)` so branch coherence is
FK-enforced, matching the P1-08 child pattern. The Vehicle and requesting party
are resolved **through** the reception visit — not re-copied.

## Prohibited duplication

P1-09 must **not** copy Vehicle master data, party master data, custody events,
authorizations, complaints, or inspection findings into work-order tables. Those
remain owned by `veh` / `crm` / `rec`; the work order references them. The
`converted` reception status is the hand-off signal; the work-order row itself is
created by P1-09, never by P1-08.

## Contract test

`tests/db/veh-structural-contract.test.ts` and the P1-08 security/foundation
suites prove that no `apt`/`rec` object leaks into another schema and that no
work-order table exists in this phase. A P1-09 structural-contract test will
assert the reception surface above remains stable.
