# Vehicle Ownership-Transfer Visibility Matrix (P1-07-SEC-001)

Governing rule:

> **Service history follows the Vehicle. Private party data remains governed by
> the CRM/Party domain.**

This matrix formalizes the EXECUTABLE crown-jewel proof — it is not schema
inspection. The enforcing tests run through **runtime-role connections**
(`app_runtime`, NOBYPASSRLS):

- `tests/db/veh-ownership.test.ts` — crown-jewel suite: `veh` carries no
  prior-owner PII column; no `veh` routine reads a CRM PII table (live `prosrc`
  scan); the new owner reads approved Vehicle history but the prior owner's
  restricted CRM identifier returns **0 rows** without `iam.sensitive.view`;
  cross-tenant reads return nothing.
- `tests/db/veh-isolation.test.ts` — auto-enumerating two-tenant isolation +
  no-context default-deny over every veh table.
- `tests/db/veh-identifiers.test.ts` — the restricted-row permission gate on
  Vehicle identifiers (read AND write).
- `tests/db/crm-isolation.test.ts` — the CRM-side sensitive gate is per-tenant.

## How the database models "actors"

Phase 1 has no party-facing principals: a partner (owner, driver, fleet
operator, authorized person, service requester) is **data**, not a login. At the
database layer every access is decided by exactly three factors:

1. **Tenant context** (`iam.current_tenant_id()` via RLS on every table),
2. **IAM permission** (`iam.has_permission('iam.sensitive.view')` for
   restricted rows; Vehicle-module permissions arrive with the P1-15/17 APIs),
3. **Schema separation** (`veh` stores opaque `partner_id` references ONLY —
   never contact points, addresses, identifiers, consent, credit, or
   communication content).

Actor rows below therefore collapse onto those mechanisms; the API layer
(P1-15/1-17) narrows further but can never widen what RLS denies.

## Matrix

Legend: ✔ visible · ✖ denied · P = only with `iam.sensitive.view` in the SAME
tenant · n/a = actor has no database session in Phase 1 (data-only party).

| Actor                                                                                        | Vehicle identity / display # | VIN | Plate history | Mechanical history | EV/battery | Odometer | Alerts | Ownership partner UUID | Relationships + evidence metadata | Prior-owner CRM contact/address    | Prior-owner restricted identifiers                                          | Prior-owner consent / credit / comm-log / notes / restrictions / non-vehicle alerts |
| -------------------------------------------------------------------------------------------- | ---------------------------- | --- | ------------- | ------------------ | ---------- | -------- | ------ | ---------------------- | --------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Current registered owner (party)                                                             | n/a                          | n/a | n/a           | n/a                | n/a        | n/a      | n/a    | n/a                    | n/a                               | n/a                                | n/a                                                                         | n/a                                                                                 |
| Previous registered owner (party)                                                            | n/a                          | n/a | n/a           | n/a                | n/a        | n/a      | n/a    | n/a                    | n/a                               | n/a                                | n/a                                                                         | n/a                                                                                 |
| Beneficial owner / fleet operator / driver / authorized person / service requester (parties) | n/a                          | n/a | n/a           | n/a                | n/a        | n/a      | n/a    | n/a                    | n/a                               | n/a                                | n/a                                                                         | n/a                                                                                 |
| Tenant employee WITH Vehicle read (runtime, tenant context)                                  | ✔                            | ✔   | ✔             | ✔                  | ✔          | ✔        | ✔      | ✔ (opaque UUID)        | ✔                                 | ✖ (CRM RLS + CRM permission model) | P                                                                           | ✖ (CRM-governed; Vehicle permission grants nothing)                                 |
| Tenant employee WITHOUT Vehicle permission                                                   | ✔*                           | ✔*  | ✔*            | ✔*                 | ✔*         | ✔*       | ✔*     | ✔*                     | ✔*                                | ✖                                  | ✖                                                                           | ✖                                                                                   |
| Actor WITH `iam.sensitive.view` (same tenant)                                                | ✔                            | ✔   | ✔             | ✔                  | ✔          | ✔        | ✔      | ✔                      | ✔                                 | per CRM matrix                     | P (both veh restricted identifiers AND crm restricted identifiers)          | per CRM matrix                                                                      |
| Actor WITHOUT `iam.sensitive.view`                                                           | ✔                            | ✔   | ✔             | ✔                  | ✔          | ✔        | ✔      | ✔                      | ✔                                 | ✖                                  | ✖ (0 rows — proven)                                                         | ✖                                                                                   |
| Cross-tenant actor                                                                           | ✖                            | ✖   | ✖             | ✖                  | ✖          | ✖        | ✖      | ✖                      | ✖                                 | ✖                                  | ✖ (a same-named permission in tenant B grants nothing in tenant A — proven) | ✖                                                                                   |
| No-context session                                                                           | ✖                            | ✖   | ✖             | ✖                  | ✖          | ✖        | ✖      | ✖                      | ✖                                 | ✖                                  | ✖                                                                           | ✖                                                                                   |

\* Phase-1 note (honest limitation): fine-grained Vehicle-module read
permissions are a P1-15/17 API responsibility. At the DB layer, any
authenticated runtime session **in the tenant** can read non-restricted veh
rows; the restricted classification gate (`iam.sensitive.view`) is the only
intra-tenant read differentiation Phase 1-7 enforces. This matches the CRM
(P1-06) posture exactly.

## The five proven privacy invariants

| #   | Invariant                                                  | Executable evidence                                                                                                             |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vehicle permission does not imply CRM-sensitive permission | crown-jewel: restricted `crm.partner_identifiers` row returns 0 rows for a veh-reading user without `iam.sensitive.view`        |
| 2   | New owner sees approved Vehicle-domain history             | crown-jewel: ownership/plate/mechanical/odometer reads succeed post-transfer                                                    |
| 3   | New owner gains no prior-owner CRM-private data            | crown-jewel: contact/identifier reads return 0 rows; `veh.owner_at` returns an opaque uuid only                                 |
| 4   | No prior-owner PII is copied into `veh`                    | crown-jewel: live `information_schema` column-name sweep + `p.prosrc` scan — no veh routine touches a CRM PII table             |
| 5   | Resolvers do not bypass CRM RLS                            | `veh-security.test.ts`: zero SECURITY DEFINER routines, locked `search_path`, no PUBLIC execute; resolvers are SECURITY INVOKER |

## Ownership compatibility matrix (BR-VEH-002 storage rule)

| Concurrent combination (same Vehicle, overlapping interval) | Allowed? | Enforced by                               |
| ----------------------------------------------------------- | -------- | ----------------------------------------- |
| registered_owner + registered_owner                         | ✖        | `ex_ownership_history_registered` (23P01) |
| registered_owner + beneficial                               | ✔        | design (distinct kinds)                   |
| registered_owner + fleet                                    | ✔        | design                                    |
| beneficial + fleet                                          | ✔        | design                                    |
| Same partner, same kind, overlapping                        | ✖        | `ex_ownership_history_same_role` (23P01)  |
