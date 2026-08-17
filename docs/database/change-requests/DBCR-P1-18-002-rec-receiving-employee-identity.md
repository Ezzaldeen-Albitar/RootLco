# DBCR-P1-18-002 — the receiving employee is a real, eligible IAM identity

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-18 — Appointment & Reception Backend (executed under P1-28) ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review.**

- **Decision:** Owner decision `FE-007` — `receiving_employee` means the selected ACTIVE IAM user
  who actually accepted custody of the vehicle
- **Gap closed:** `G-EMP` (backend half). The product half — a screen that shows the name — is a
  separate frontend obligation and remains open
- **Migration:** `supabase/migrations/20260815093000_rec_receiving_employee_identity.sql` (the 121st)
- **Seed change:** one permission code, `rec.reception.receiving_employee.assign_any`, mapped to no
  role
- **Executable proof:** `tests/db/rec-receiving-employee-identity.test.ts` (database) and the FE-007
  block of `tests/backend/p1-18-reception-create.test.ts` (API)
- **Rollback classification:** **ROLL-FORWARD-ONLY** once any visit exists. Dropping the snapshot
  column destroys the custody evidence the change exists to create, and dropping the foreign key
  readmits the arbitrary uuid it exists to forbid

---

## 1. The defect

`rec.reception_visits.receiving_employee_id` was declared `uuid NOT NULL` and carried **no foreign
key**. Nothing anywhere required it to name an account, an employee, a live user, or even a row.
The column therefore recorded a CLAIM about who took the keys, and the platform had no way to
distinguish a true one from a typed one.

The consequence was visible in the frontend long before it was named here.
`apps/web/src/features/receptions/check-in/receiving-employee.ts` carries a whole four-state
vocabulary — `named`, `denied`, `unresolved`, `unavailable` — whose `unresolved` case exists solely
because, quoting its own docblock, `receiving_employee_id` has no foreign key and "an identifier
naming no account is a state the database permits". The UI was correctly written to survive a
custody record that named nobody. This change removes the state instead.

## 2. What the migration establishes

| rule                                       | mechanism                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| a real IAM reference                       | `fk_reception_visits_receiving_employee (tenant_id, receiving_employee_id)` → `iam.user_accounts (tenant_id, id)`                                     |
| same tenant, structurally                  | the key is COMPOSITE on `tenant_id`, so a foreign-tenant id cannot satisfy it                                                                         |
| active at the moment of reception          | `rec.stamp_receiving_employee_identity()` — `status = 'active' AND deleted_at IS NULL`                                                                |
| operational standing                       | the same guard — at least one live role grant in the tenant                                                                                           |
| branch eligibility                         | the same guard — a live grant whose scope covers the visit's company/branch                                                                           |
| cross-branch only by explicit authority    | failing branch eligibility, `iam.has_permission_in_scope('rec.reception.receiving_employee.assign_any', company, branch)` evaluated against the ACTOR |
| a historical name that cannot be rewritten | `receiving_employee_display_name`, stamped by the guard and listed in `tg_reception_visits_immutable`                                                 |

The composite foreign key is valid because `iam.user_accounts` already carries
`CONSTRAINT uq_user_accounts_tenant_id UNIQUE (tenant_id, id)`.

## 3. Why the guard is in the database

The application is not the authority. A job, a future service, a support session or a psql prompt
writes through the same trigger; a rule enforced only in TypeScript is a rule every other writer
skips. This is the same reasoning that put the one-open-visit invariant and the reception state
graph in the database rather than in `reception-service.ts`.

The trigger is `SECURITY INVOKER` with an empty `search_path`, so every lookup it performs runs
under the caller's RLS. A cross-tenant identifier is therefore invisible to the guard before the
foreign key is ever consulted — two independent refusals, neither depending on the other.

## 4. The cross-branch authority, and what it does NOT widen

The Owner allowed cross-branch selection and required it to be explicitly authorized. That is a new
permission code rather than an extra power folded into `rec.reception.manage`, which every
receptionist holds.

It widens exactly one thing: WHICH BRANCH the employee may be drawn from. It does **not** waive
the lifecycle rule (a locked, archived or soft-deleted account is refused for the administrator
exactly as for anyone else), it does **not** waive the tenant boundary, and it does **not** admit
an account with no live grant anywhere — such an account belongs to no branch, so there is no
branch to reach ACROSS to, and a custodian with no operational standing is precisely the record
this change exists to stop. Each of those three is a separate assertion in the database suite.

The code is declared by **no operation**, deliberately. There is no "cross-branch check-in"
endpoint to gate; the decision is taken inside the insert, where a direct writer cannot step around
it. It is seeded into the platform catalogue and mapped to no role, so on a replayed database it
exists and is held by nobody.

## 5. The picker

`GET /api/v1/reception-catalogue/receiving-employees` publishes the same predicate the guard
enforces, so the screen cannot offer an id the write will refuse. It is gated by
`rec.reception.manage` — the capability that opens a visit — rather than `rec.reception.read`,
which the board and the cashier hold and which has no business enumerating staff. It discloses
strictly less than the `iam.user-list` call the check-in screen used before it, and it does **not**
grow for an actor holding the cross-branch authority: reaching into another branch stays a
deliberate act against the user directory, not a list silently widening under a permission the
operator cannot see.

## 6. Backfill, and the refusal that is a feature

Existing rows are backfilled from the exact same-tenant account id, and the migration RAISES if any
row is left dangling. Guessing an employee, or substituting the actor, would falsify custody
history on records a customer has already signed — so the migration stops and names the count
instead. Business tables ship empty, so on a replayed database the backfill touches nothing.

## 7. Blast radius

| registry / document                                       | change                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/db/foundation.test.ts`                             | `rec.stamp_receiving_employee_identity` and `tg_reception_visits_receiving_employee` added to the approved lists                                          |
| `tests/db/helpers.ts`                                     | `USER_A` / `USER_B` are now REAL accounts with live grants — the reception database suites used them as an arbitrary uuid, which FE-007 no longer permits |
| `docs/database/data-dictionary.md`                        | the new column                                                                                                                                            |
| `docs/database/apt-rec-personal-data-classification.json` | the same column, `internal`, not searchable                                                                                                               |
| `.github/ci-baselines/schema-baseline.json`               | `migrationCount` 120 → 121, `permissionCount` 109 → 110, `functions` 516 → 517, `triggers` 543 → 544                                                      |

**`schemaHash` is NOT updated and is known to be stale.** It is a measurement, not a derivation,
and the branch that produced this migration had no database it was permitted to touch — the single
local stack is shared with concurrent Owner-acceptance work. It must be re-measured with
`npm run validate:schema-inventory -- --hash-only` against a database carrying this migration and
committed before the migration-replay job can pass. A hash invented from a diff would be a false
claim wearing the shape of a measurement.

## 8. Security analysis

- **No new grant, role, policy, table or index privilege.** One new permission CODE, held by nobody.
- One new function, `SECURITY INVOKER` — `security_definer` in the structural baseline is unmoved.
- The snapshot cannot be supplied by a caller (the create body is `.strict()` and has no such
  field) and cannot be changed afterwards (`tg_reception_visits_immutable`), so the historical name
  is neither forgeable at write time nor editable later.
- The guard fails closed: an unresolved account, an unresolved permission code and an unset request
  context all resolve to refusal, never to an allow.
- No data-loss path. The migration adds a column and backfills it; nothing is dropped or rewritten
  except the immutable-column trigger's own argument list, which gains one entry.

## 9. What this change does NOT do

It introduces **no HR or workforce master**. The identity is the IAM account and nothing else; there
is no employee register, no department, and no second source of truth about people. That was an
explicit constraint of the Owner decision.

It does not change the frontend. The check-in screen still selects from `iam.user-list` and the two
read-back surfaces still resolve the name through `iam.user-detail` rather than reading the snapshot
this migration now guarantees. `G-EMP` is closed as a DATA gap and remains open as a PRODUCT gap.

## 10. Governance

Delivered on branch `remediation/p1-18-receiving-employee-identity` from protected `origin/develop`,
as a pull request into `develop`, gated by the same hosted CI as every other change. Nothing reaches
protected `develop` outside the approved pull-request and hosted-CI flow. No dependency scanning,
malware scanning, production monitoring, or independent review exists or is claimed.
