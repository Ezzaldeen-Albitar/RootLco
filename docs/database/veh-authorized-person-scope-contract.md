# Authorized-Person Scope Contract (P1-07-SEC-002)

The `authorized_person` relationship role on `veh.vehicle_relationships` may
carry a versioned, validated JSON authorization scope. This document is the
authoritative contract; enforcement lives in `veh.valid_authorization_scope`
(CHECK), the role/scope coupling CHECKs, and the immutable-column guard.
Executable evidence: the scope suite inside `tests/db/veh-ownership.test.ts`.

## JSON schema (schema_version 1)

```json
{
  "schema_version": 1,
  "allowed_actions": ["approve_quotation", "receive_vehicle"]
}
```

Validation rules (all enforced in the database):

| Rule                                            | Enforcement                     | SQLSTATE |
| ----------------------------------------------- | ------------------------------- | -------- |
| Scope must be a JSON object                     | `veh.valid_authorization_scope` | 23514    |
| `schema_version` must be numeric (version 1)    | validator                       | 23514    |
| `allowed_actions` must be a non-empty array     | validator                       | 23514    |
| Every action from the approved taxonomy only    | validator                       | 23514    |
| Duplicate actions rejected                      | validator                       | 23514    |
| Unknown top-level keys rejected                 | validator                       | 23514    |
| Only `authorized_person` rows may carry a scope | `ck_*_scope_role`               | 23514    |
| A scope requires `granted_by`                   | `ck_*_scope_granted`            | 23514    |
| Scope and `granted_by` are immutable in place   | `org.guard_immutable_columns`   | 23514    |

## Approved action taxonomy (version 1)

- `approve_quotation`
- `approve_additional_work`
- `receive_vehicle`
- `receive_reports`
- `receive_invoices`
- `communicate_about_service`

Extending the taxonomy requires a forward migration replacing the validator (a
reviewed change), never an in-place data convention.

## Expiry, revocation, and change

- **Expiry comes from the relationship interval**: authorization is current
  only while `daterange(valid_from, valid_to, '[)')` contains the reference
  date. `veh.relationships_at(vehicle, date)` excludes ended rows — an
  end-dated authorization is no longer returned (proven in tests).
- **Revocation = closing the interval** (`valid_to` set once, close-only via
  `veh.guard_temporal_close`). There is no scope deletion; history is retained.
- **Changing a scope = new interval.** In-place scope updates are rejected by
  the immutable guard; the approved model is: close the current row, insert a
  new row with the new scope. This preserves who-was-authorized-when.

## Cross-tenant containment

`(tenant_id, vehicle_id)` and `(tenant_id, partner_id)` composite FKs make a
cross-tenant Vehicle or partner linkage a 23503; RLS confines reads/writes to
the session tenant; `granted_by` is a same-tenant user reference recorded for
attribution.

## Evidence

`veh.relationship_evidence` (append-only, server-stamped) links a relationship
to a same-tenant `shared.documents` row — no document payload is copied.

## What a scope does NOT do (Phase 1-17 boundary)

A stored scope **never grants application or database access by itself**:
partners are not principals, and no RLS policy or grant reads
`authorization_scope`. Phase 1-17 (service orchestration APIs) is the sole
enforcement point that may consult the scope when deciding whether a named
person may approve a quotation, receive the Vehicle, etc. Structural forgery
(scope on the wrong role, unapproved/duplicated actions, missing grantor,
in-place inflation) fails at the database as shown above; business-level misuse
of a validly-shaped scope is P1-17's authorization decision.
