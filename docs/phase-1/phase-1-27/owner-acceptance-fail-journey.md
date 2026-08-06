# Phase 1-27 — third Owner acceptance result: the integrated journey

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** P1-27 REMAINS OPEN · **Recorded:** 2026-08-06

---

## The result

```
OWNER ACCEPTANCE: FAIL
```

The Product Owner performed a third manual acceptance review and identified
missing core operational integration. **P1-27 remains open.** `P1-G27` is not
written. P1-28 has not started.

The previous handoff said that what P1-27 needed from there was "not more
engineering". **That was wrong, and it is withdrawn.** Engineering remains,
because the central operational journey is incomplete.

### The nine gaps, as the Owner stated them

| #   | Gap                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vehicle plate data is not sufficiently captured and integrated                                                                                                       |
| 2   | Vehicle reception photos and evidence are not sufficiently integrated                                                                                                |
| 3   | A Vehicle must be linked to a Customer                                                                                                                               |
| 4   | One Customer may have multiple Vehicles                                                                                                                              |
| 5   | The operator must select the correct Customer Vehicle before opening a repair order                                                                                  |
| 6   | A repair order must be opened directly against the selected Customer and Vehicle                                                                                     |
| 7   | Every Work Order must connect services, labour, technicians, departments, parts, external parts, quotations, approvals, accounting, payment, QA, rework and delivery |
| 8   | Customer, Vehicle and Work Order histories must be complete, connected and understandable                                                                            |
| 9   | The complete workshop journey must work as one integrated operational flow rather than disconnected screens                                                          |

## Protected state at the moment of this record

|            |                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `develop`  | `a56eeea0a10d56cd17827ec443dd5ecff40f8c0d` · tree `899d99104f277a9851403d307048e0b8aca543ad`             |
| `main`     | `f085d82001a43de51725707426d5c10eb134c004` · tree `fb7a511a08f2720ed6fa41a3272fbeb8346817e0` — untouched |
| Worktrees  | one, clean, `develop`                                                                                    |
| Migrations | 119 · migration 120 absent                                                                               |
| `P1-G27`   | absent                                                                                                   |
| P1-28      | no implementation; the only match is a Phase 1-8 boundaries document                                     |

Remediation branch: `remediation/p1-27-customer-vehicle-work-order-journey`,
based on that exact protected `develop`.

---

## The first archaeology finding, before any screen is designed

§23 of the instruction requires contract archaeology before implementation, and
the first two facts it produced change the shape of the whole remediation. Both
were read out of route modules and `docs/api/openapi.v1.json`, not inferred.

### There is no `POST /api/v1/work-orders`

`/api/v1/work-orders` publishes **GET only**. A work order is created by exactly
one operation:

```
POST /api/v1/receptions/{receptionId}/convert-to-work-order
     operation  rec.reception-convert-to-work-order
     permission rec.reception.convert
     scope      branch
     idempotent true          → Idempotency-Key required
     versionGuarded true      → If-Match MANDATORY (ERR-CON-002 when absent)
     body       {} strict, nullable
```

The route's own docblock explains why, and the reasoning is sound: the
conversion holds the reception-visit lock, answers a replay with the work order
it already created, and `uq_work_orders_ordinary_origin` — a partial unique
**index** on `(tenant, company, branch, reception_visit_id)` — is the database
backstop designed around that single path. A second creation path would not hold
that lock and two concurrent callers would race for the same index.

**This does not block the Owner's §6.** "Open repair order" from a Customer
profile or a Vehicle profile is still the right affordance; what it must drive is
`create reception → capture condition → approve → convert`. The work order
inherits its scope, its vehicle and its origin from the visit. What §6 cannot be
is a single form that inserts a work order directly, and no amount of Frontend
work changes that.

### Reception publishes eight operations, and every one is a POST

| operation                             | method | path                                     |
| ------------------------------------- | ------ | ---------------------------------------- |
| `rec.reception-create`                | POST   | `/receptions`                            |
| `rec.reception-approve`               | POST   | `/receptions/{id}/approve`               |
| `rec.reception-authorization`         | POST   | `/receptions/{id}/authorizations`        |
| `rec.reception-condition-evidence`    | POST   | `/receptions/{id}/condition-evidence`    |
| `rec.reception-convert-to-work-order` | POST   | `/receptions/{id}/convert-to-work-order` |
| `rec.reception-party-role`            | POST   | `/receptions/{id}/party-roles`           |
| `rec.reception-refusal`               | POST   | `/receptions/{id}/refusals`              |
| `rec.reception-signature`             | POST   | `/receptions/{id}/signatures`            |

**There is not one GET.** No reception detail. No reception list. No read of a
vehicle's or a customer's visits.

Two of those eight are `versionGuarded`, and `If-Match` is mandatory on both.
The only way a client can obtain a reception visit's `recordVersion` is from the
response of an operation it just performed: `rec.reception-create` returns one,
`rec.reception-approve` returns one, `convert-to-work-order` consumes one and
returns the work order.

**So the reception chain is reachable in exactly one unbroken session, and in no
other circumstance.** If the operator closes the browser, if the connection
drops between capture and approval, if a second employee has to continue the
visit, or if anyone needs to find a reception opened this morning — there is no
operation that returns the visit, and therefore no way to obtain the version that
`approve` and `convert` both require. The visit becomes unreachable and the
vehicle stays in custody with no path forward.

That is the Owner's gap 9 — "disconnected screens rather than one integrated
operational flow" — stated as a contract fact rather than as a design opinion.
It is also the same failure shape this phase has now met three times: a
`versionGuarded` operation whose version has no published source
(`P1-22`'s delivery eligibility), and ten `idempotent` operations no call site
could satisfy (`P1-26-F-015`).

### A customer can be linked to a vehicle, and the link cannot be read back

This is the Owner's gaps 3, 4 and 5, and it is not a Frontend omission.

The customer↔vehicle relationship publishes in exactly one direction:

| operation                             | method | path                                                            | direction                       |
| ------------------------------------- | ------ | --------------------------------------------------------------- | ------------------------------- |
| `crm.vehicle-link`                    | POST   | `/customers/{customerId}/vehicles`                              | write                           |
| `veh.vehicle-authorized-party-add`    | POST   | `/vehicles/{vehicleId}/authorized-parties`                      | write                           |
| `veh.vehicle-authorized-party-retire` | POST   | `/vehicles/{id}/authorized-parties/{relationshipId}/retirement` | write                           |
| `veh.vehicle-relationship-list`       | GET    | `/vehicles/{vehicleId}/relationships`                           | **read, from the VEHICLE side** |

`/customers/{customerId}/vehicles` publishes **POST only**. Eleven reads exist
under `/customers/` — addresses, alerts, consents, contacts, history, notes,
preferences, restrictions, tags, timeline — and **not one of them is vehicles**.

So the platform can record that a customer owns a vehicle and can never answer
"which vehicles does this customer have?". The only read runs the other way:
given a vehicle, list its parties.

§4 requires a dedicated Vehicles section on the Customer profile. §5 requires the
operator to see that customer's vehicles and select one before a repair order is
opened. Against today's contracts the only way to build either is to enumerate
every vehicle in the tenant and read each one's relationships — an N+1 sweep over
a rate-limited surface that cannot be paginated correctly and gets slower as the
workshop succeeds.

**The P1-27 Frontend could not have built a Customer Vehicles section however
carefully it was written.** The read does not exist.

## Integration findings opened by this record

Continuing from `P1-27-INT-009`, the highest previously allocated.

| id              | finding                                                                                                                                                                                                                                                                                                                                             | owning Backend phase | severity | blocks           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- | ---------------- |
| `P1-27-INT-010` | No reception **detail** read. `rec.reception-approve` and `rec.reception-convert-to-work-order` are both `versionGuarded` with mandatory `If-Match`, and no operation publishes a visit's `recordVersion` except the two writes that also consume it. A reception cannot be resumed, handed over, or recovered.                                     | P1-18                | **High** | Waves C, D, E    |
| `P1-27-INT-011` | No reception **list** read. An operator cannot see open receptions, and a vehicle or customer cannot show its visits.                                                                                                                                                                                                                               | P1-18                | **High** | Waves D, E, P, Q |
| `P1-27-INT-012` | **No read lists a customer's vehicles.** `crm.vehicle-link` writes the relationship at `POST /customers/{customerId}/vehicles`; that path publishes no GET, and the only relationship read runs from the vehicle side. The Owner's §4 Vehicles section and §5 vehicle selector cannot be built without an N+1 sweep of every vehicle in the tenant. | P1-16                | **High** | Waves A, D, E    |

Further findings will be added by the archaeology now running across the
remaining eleven domains. Each will be closed the way §2 requires — its own
focused Backend remediation branch with authorization, OpenAPI, Zod validation,
audit, correlation and tests, merged through protected `develop` — and never
inside this Frontend branch.

## What this record does not do

It does not close P1-27, does not create `P1-G27`, and does not begin P1-28.
Closure requires the Product Owner to test the application and return
`OWNER ACCEPTANCE: PASS`. Silence is not Pass, and neither is any other message.
