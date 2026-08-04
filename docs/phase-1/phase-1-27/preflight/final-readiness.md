# Phase 1-27 — Final Readiness Gate

**Classification:** Confidential — Commercial Product and Pilot Planning

**Verdict: NOT READY — 14 / 16. The P1-27 feature branch was NOT created.**

Assessed against protected `develop` `9c1ef5e1df7c505f9a4e54e437f69523118842a1`,
`main` `f085d82001a43de51725707426d5c10eb134c004`.

---

## 1. The result in one paragraph

Fourteen conditions pass. Conditions 14 and 15 — the CRM and Vehicle contract
archaeology — are **complete as activities**, and what they found is that the
Backend read contracts P1-27 is scoped to consume **do not exist**. Thirteen of
the twenty-nine Frontend tasks have no operation that returns the data they are
required to display. Two more are blocked by an open decision the prompt itself
says must block them.

The gate exists to stop the branch being created anyway. It is doing its job.

## 2. What was verified, from source

Not inferred from documentation, and not taken from a report. Read out of
`apps/api/src/app/api/v1` directly.

### CRM customer sub-resources are WRITE-ONLY over HTTP

```
customers/[customerId]/addresses      POST
customers/[customerId]/contacts       POST
customers/[customerId]/consents       POST
customers/[customerId]/preferences    PUT
customers/[customerId]/notes          POST
customers/[customerId]/alerts         POST
customers/[customerId]/tags           POST
customers/[customerId]/restrictions   POST
customers/[customerId]/timeline       GET
customers/[customerId]/history        GET
```

Eight of the ten export **no GET**. And there is **no
`customers/[customerId]/route.ts` at all** — no operation anywhere in the
platform returns a single customer.

### Vehicle reads mostly exist; three do not

```
vehicles                              GET, POST
vehicles/[vehicleId]                  PATCH        <-- no GET
vehicles/[vehicleId]/documents        GET
vehicles/[vehicleId]/ev-profile       GET, POST
vehicles/[vehicleId]/history          GET
vehicles/[vehicleId]/odometer-readings GET, POST
vehicles/[vehicleId]/ownerships       GET, POST
vehicles/[vehicleId]/plates           GET, POST
vehicles/[vehicleId]/relationships    GET
vehicles/[vehicleId]/status           PATCH
```

The vehicle side is in much better shape. It is missing the vehicle detail read,
any media route, and any VIN validation contract.

## 3. Task readiness — 8 ready, 6 underspecified, 15 blocked

| verdict            | count | tasks                                                           |
| ------------------ | ----- | --------------------------------------------------------------- |
| **READY**          | 8     | FE-001, FE-002, FE-004, FE-005, FE-015, FE-022, FE-023, FE-024  |
| **UNDERSPECIFIED** | 6     | FE-003, FE-017, FE-018, FE-021, FE-025, FE-026                  |
| **BLOCKED**        | 15    | FE-006 … FE-014, FE-016, FE-019, FE-020, FE-027, FE-028, FE-029 |

Blocked, and why:

| task                        | needs                 | exists                       |
| --------------------------- | --------------------- | ---------------------------- |
| FE-006 customer profile     | `GET /customers/{id}` | **no route module at all**   |
| FE-007 contacts             | `GET …/contacts`      | POST only                    |
| FE-008 addresses            | `GET …/addresses`     | POST only                    |
| FE-009 preferences          | `GET …/preferences`   | PUT only                     |
| FE-010 consents             | `GET …/consents`      | POST only                    |
| FE-011 notes                | `GET …/notes`         | POST only                    |
| FE-012 alerts               | `GET …/alerts`        | POST only                    |
| FE-013 tags                 | `GET …/tags`          | POST only                    |
| FE-014 restrictions         | `GET …/restrictions`  | POST only                    |
| FE-019 vehicle profile      | `GET /vehicles/{id}`  | PATCH only                   |
| FE-020 VIN validation       | any VIN contract      | none anywhere                |
| FE-027 vehicle media        | a media route         | none — only `documents`      |
| FE-029 vehicle timeline     | a vehicle timeline    | none — only `history`        |
| FE-016, FE-028 merge review | P1-OD-017 resolved    | open; §13 forbids proceeding |

## 4. Why this cannot be worked around

Three rules in the execution prompt close every route round it, and each is
correct:

- **§8 — "Do not invent endpoints."** A profile screen cannot call an operation
  that does not exist.
- **§8 — "Mocks are test fixtures only. Mocks are not production-integration
  evidence."** Fifteen screens built on fixtures would look finished and prove
  nothing, which is the exact failure P1-26 was reopened for.
- **§7 — "No new Backend feature development is allowed inside the P1-27
  Frontend branch."** Adding roughly twenty read operations is not a defect fix;
  it is Backend feature work owned by P1-16 and P1-17.

Delivering the blocked screens would require breaking one of the three.

## 5. What is genuinely deliverable today

Eight tasks are READY against real contracts, and six more are underspecified
rather than blocked — mostly missing a reference list (countries, languages,
segments) or a response field, not a whole operation. That is a coherent, useful
slice: customer search and its results table, both creation forms, the customer
timeline, plate and odometer history, and the EV profile.

It is not the phase as scoped, and it should not be labelled as such.

## 6. Findings raised

| id              | subject                                                                                                                           | owning phase     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `P1-27-INT-001` | No customer detail read; no GET on eight CRM sub-resources                                                                        | **P1-16**        |
| `P1-27-INT-002` | No vehicle detail read; no media route; no VIN contract                                                                           | **P1-17**        |
| `P1-27-INT-003` | The web API client attaches `Idempotency-Key` on POST only, so every PUT to a status or preferences route fails 400 `ERR-INT-002` | P1-27 (Frontend) |
| `P1-27-INT-004` | `openapi.v1.json` publishes 200 for routes that return 201, and never publishes 400 or 404                                        | P1-16 / P1-17    |

`P1-27-INT-003` is the P1-26-F-015 defect class again — a declared idempotency
contract that no call site satisfies — and it is the one finding here that
belongs to the Frontend.

## 7. The decision this needs

This is an Owner decision because either answer is defensible and they change
what gets built:

**A — Authorise the Backend read contracts first.** A P1-16/P1-17 remediation
adds the missing read operations with their tests, OpenAPI and permissions;
P1-27 then proceeds as scoped, at 29/29. Correct, and slower.

**B — Rescope P1-27 to what has contracts.** Deliver the 8 ready and the 6
underspecified tasks now, and move the 15 blocked ones into the phase that
follows the Backend work. Faster, and honest about what it is.

**C — Something else.** The scope is yours.

What must not happen is P1-27 being opened at 29 tasks and reported as delivered
on fixtures.

---

**No feature branch was created. No implementation was started.** The gate is
`NOT READY` and the phase has not begun.
