# P1-16 / P1-17 remediation — the duplicate-candidate review queues

**Classification:** Confidential — Commercial Product and Pilot Planning

**Finding closed:** `P1-27-INT-005` · **Owning phases:** P1-16 (CRM) and P1-17
(Vehicle) · **Branch:** `remediation/p1-16-17-duplicate-candidate-reads`

---

## 1. What was wrong

Both modules could **record a scan** and **record a decision**, and neither could
**list what was waiting**.

```
customers/{customerId}/duplicate-scans     POST
customer-duplicates/{candidateId}/review   POST
customers/{customerId}/merge               POST

vehicles/{vehicleId}/duplicate-scans       POST
vehicle-duplicates/{candidateId}/review    POST
vehicles/{vehicleId}/merge                 POST
```

Six operations, all POST. A review screen's only way to see its own queue was to
POST a scan — a **privileged write that emits an audit record** — so merely
_opening_ the queue would have written to the audit trail every time. And a
re-scan is not a read: it is a fresh detection pass whose results depend on the
data at that instant.

This blocks the review half of `P1-27-FE-016` and `P1-27-FE-028` **independently
of `P1-OD-017`**. The open decision governs whether a _merge action_ may be
offered; it says nothing about whether a reviewer can see the queue.

## 2. What was added

| operation                    | method | path                   | permission                      |
| ---------------------------- | ------ | ---------------------- | ------------------------------- |
| `crm.duplicate-list`         | GET    | `/customer-duplicates` | `crm.customer.duplicate.review` |
| `veh.vehicle-duplicate-list` | GET    | `/vehicle-duplicates`  | `veh.vehicle.duplicate.review`  |

Registry: **236 → 238**. No new permission code, no migration, no change to any
existing write.

## 3. The four decisions worth stating

### 3.1 Tenant-wide, not nested under one of the pair

A candidate is a _pair_. Nesting the queue under one of its two members would
make the same row reachable by two paths, and would force a reviewer to already
know a customer before they could find out it might be a duplicate. RLS and the
explicit `tenant_id` predicate are what scope it.

### 3.2 Seeing the queue and acting on it are one authority

Both reads carry the existing `*.duplicate.review` permission rather than a new
read code. The seed already describes that permission as "Scan for and review
duplicate … candidates", and a reviewer who could not read the queue could not
review. **Merge is separate and higher, and neither of these routes offers it.**

### 3.3 No status filter means _every_ status

A caller who passes `?status=open` filters the queue. A caller who passes nothing
gets `dismissed` and `merged` candidates too, because a reviewer auditing past
decisions needs them. Defaulting to `open` would hide them and make the default
look like the whole truth.

### 3.4 `match_basis` is published, and the database is what makes that safe

Both tables constrain their basis by CHECK:

- `crm.jsonb_no_raw_value_keys` rejects a `value`, `raw`, `raw_value`,
  `national_id`, `tax`, `registration` or `date_of_birth` key **at any depth**.
- `veh.valid_match_basis` admits only `basis`, `classification`, `weight` and
  `evidence`; restricts `basis` to a closed vocabulary; refuses to let a
  vin/plate/identifier collision be classified below `restricted`; and runs
  `veh.jsonb_no_raw_values` over any evidence object.

So a reviewer learns that two vehicles **collided on their VIN** without either
VIN being disclosed. That distinction is the whole point of a review screen: you
must know the signal to judge the pair, and you do not need the value to do it.

The vehicle pair is labelled by `display_number` — the non-sensitive business key
— never by VIN, keeping the projection consistent with
`domain/vehicle-search.ts`.

## 4. How it was verified

14 backend tests against the real database
(`tests/backend/p1-16-17-duplicate-candidate-reads.test.ts`), all passing.

Two assertions are worth naming because they are the ones a weaker suite would
have got wrong:

**The queue is a read — measured as a delta.** The audit-record count is taken
before and after the two calls and the difference asserted to be zero.
`expect(count).toBe(0)` would pass against a database that already had audit rows
and would prove nothing about what the calls did.

**The `match_basis` guarantee is proven to still bite.** The suite attempts to
insert a candidate whose basis carries a raw value and asserts the **write is
refused**, rather than only asserting the projection came back clean. A
projection test alone passes against a schema that has quietly stopped enforcing
the constraint — which is exactly the state in which publishing `matchBasis`
would become a disclosure.

Plus: 401 and 403 on both queues, a cross-tenant candidate unreachable through
every query form, a status outside the schema vocabulary refused, an unknown
query parameter refused, and both registrations asserted against the runtime's
own operation object (`auditClass: 'none'`, not `idempotent`).

Full local suite green: **1601 unit + 1813 backend tests**, `lint`, `typecheck`,
`format:check`, `verify:contracts`, `verify:inventories`, `security:all`.

## 5. What this does not do

It does not offer a merge action, and it does not resolve `P1-OD-017`. It makes
the _review_ half of FE-016 and FE-028 buildable; the merge action stays blocked
by §13 of the P1-27 execution prompt until the Owner resolves that decision.
