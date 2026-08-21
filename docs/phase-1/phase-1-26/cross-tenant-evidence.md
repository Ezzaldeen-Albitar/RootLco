# Phase 1-26 — cross-tenant evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

P1-26 recorded cross-tenant behaviour as **not proven**: the Database tier proves
RLS, but nothing had established that a real signed-in session cannot reach
another workspace through the running API. It needed two live tenants, and the
no-fake-data policy forbade creating them. Local synthetic fixtures are now
authorised, so this is measurable rather than argued.

---

## 1. The setup

|                    | Tenant A                      | Tenant B                   |
| ------------------ | ----------------------------- | -------------------------- |
| Name               | CRM Owner Acceptance Tenant   | CRM Isolation Tenant B     |
| Code               | `acceptance_a`                | `acceptance_b`             |
| Company / branch   | `acceptance_co_a` / `main`    | `acceptance_co_b` / `main` |
| Operators          | 4                             | 1                          |
| Owner's membership | administrator, 14 permissions | **none**                   |

Tenant B is populated. It exists for one purpose: so that "cannot see it" is a
statement about authorization rather than about an empty database.

## 2. The mistake the first version made, and why it matters

The first version of this test drove the API through `page.request`, assuming
the browser's session cookie would authenticate it.

**It does not, and must not.** The session cookie belongs to the _web_ origin and
is `httpOnly` precisely so the browser never holds a bearer token. Every probe
therefore returned **401 for want of an `Authorization` header** — and the test
passed, while proving nothing whatsoever about tenancy.

That is the difference between _"was refused"_ and _"was refused **because** it
belongs to another tenant"_, and only the second one is isolation. It was caught
by the control case failing: the same mechanism could not read Tenant A either.

The suite now signs in for a **real bearer token**, the same way the web tier
obtains one, and probes with it.

## 3. What is asserted

### With a real Tenant A bearer token

| Probe                                            | Required | Result |
| ------------------------------------------------ | -------- | ------ |
| `GET /api/v1/iam/users/{Tenant B user}`          | not 200  | pass   |
| `GET /api/v1/org/companies/{Company B}/settings` | not 200  | pass   |
| `GET /api/v1/org/branches/{Branch B}/settings`   | not 200  | pass   |
| Each refusal is 401, 403 or 404                  | yes      | pass   |
| No refusal names Tenant B                        | yes      | pass   |
| No refusal echoes a Tenant B identifier          | yes      | pass   |

### The control — without it, everything above would also pass against an API that refuses everything

| Probe                                          | Required | Result |
| ---------------------------------------------- | -------- | ------ |
| `GET /api/v1/auth/session` with the same token | **200**  | pass   |
| `GET /api/v1/iam/users` with the same token    | **200**  | pass   |

### In the browser, with a real session

| Check                                                                           | Result |
| ------------------------------------------------------------------------------- | ------ |
| Tenant B is named on no Tenant A screen (organization, users, roles, audit log) | pass   |
| No Tenant B identifier appears on any of them                                   | pass   |
| A Tenant B `companyId` in the query string is **sent** and changes nothing      | pass   |
| Neither Company B nor Branch B appears as a result of it                        | pass   |

### And the anonymous control

| Check                                  | Result  |
| -------------------------------------- | ------- |
| The same endpoint with no token at all | not 200 |

## 4. Why scope manipulation cannot work here

Scope is resolved by the Backend from the bearer token on every request. A query
parameter is a _request_, not a decision. The URL test asserts the parameter was
actually transmitted — otherwise it would be measuring a no-op — and then that
nothing from Tenant B came back.

## 5. What this does not prove

This is one tenant pair on one local database. It does not replace the Database
tier's RLS matrix, which remains the authority on row-level enforcement, and it
does not exercise company- or branch-level scoping inside a single tenant beyond
the branch-scoped reader used for permission-denial evidence.

It proves one specific thing that was previously unproven: **a real authenticated
session, driving the real API, cannot read another tenant's records** — and the
control proves that statement is not vacuous.
