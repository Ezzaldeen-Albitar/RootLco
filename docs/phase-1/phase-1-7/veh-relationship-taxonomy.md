# Vehicle Relationship Taxonomy (P1-07-DB-012)

Two distinct, deliberately separate vocabularies connect parties to Vehicles:

## 1. Ownership kinds (`veh.ownership_history.ownership_kind`)

| Kind               | Meaning                                           | Concurrency rule                                                                                  |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `registered_owner` | The single authoritative legal owner              | Exclusive — at most one open/overlapping interval per Vehicle (`ex_ownership_history_registered`) |
| `beneficial`       | Economic owner where it differs from registration | May coexist with registered + fleet                                                               |
| `fleet`            | Fleet-pool ownership context                      | May coexist with registered + beneficial                                                          |

Same partner + same kind may never overlap (`ex_ownership_history_same_role`).
Full compatibility table: [ownership visibility matrix](../../database/veh-ownership-visibility-matrix.md).

## 2. Relationship roles (`veh.vehicle_relationships.relationship_role`)

| Role                | Meaning                                             | Scope-bearing?                                                                                                                |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `owner`             | Operational owner-contact for service events        | No                                                                                                                            |
| `user`              | Habitual user of the Vehicle                        | No                                                                                                                            |
| `driver`            | Named driver                                        | No                                                                                                                            |
| `fleet_operator`    | Operates the Vehicle inside a fleet                 | No                                                                                                                            |
| `payer`             | Pays for service                                    | No                                                                                                                            |
| `authorized_person` | May act on the owner's behalf per a validated scope | **Yes** — the only role allowed an `authorization_scope` ([contract](../../database/veh-authorized-person-scope-contract.md)) |
| `service_requester` | Requested the current/most-recent service           | No                                                                                                                            |

Identical (vehicle, partner, role) intervals may not overlap
(`ex_vehicle_relationships_no_overlap`); different roles for the same partner
may coexist.

## Mapping to CRM partner roles

`crm.partner_roles` classifies what a partner IS to the tenant (customer,
supplier, insurer, broker, referral). `veh` roles classify what a partner does
FOR ONE VEHICLE over an interval. They intersect only through `partner_id`:

- A Vehicle relationship NEVER implies a CRM role, and vice versa.
- Both sides reference `crm.business_partners (tenant_id, id)` with composite
  same-tenant FKs; merged partners resolve via `crm.resolve_partner_survivor`.
- Privacy boundary: veh stores the opaque `partner_id` ONLY — resolving a name
  or contact requires CRM access under CRM RLS/permissions (crown-jewel proof).

Evidence: `tests/db/veh-ownership.test.ts` (15 tests) + QA-008 §9/§10.
