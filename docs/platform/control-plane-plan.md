# RootLco Platform Control Plane — architecture and phase plan

**Classification:** Confidential — Commercial Product and Pilot Planning
**Status:** PLAN ONLY. Nothing in this document is implemented. It is not a
claim about the product; it is a proposal to be scoped, numbered and gated.

RootLco — Root Link Company — is the vendor. **CRM** is the product (a working
name). Benzene is a configurable pilot tenant and must never be hard-coded as
the product, the platform owner, the only tenant, or a default.

---

## 1. The boundary that must never blur

Two administration levels, two security boundaries.

|               | Tenant Administration                                                                                    | RootLco Platform Control Plane                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Used by       | the subscribed company's administrators                                                                  | RootLco staff only                                                                                      |
| Owns          | company profile, branches, employees, roles, permissions, numbering, taxes, currencies, languages, audit | tenants, subscriptions, plans, pricing, seats, renewals, suspension, support operations, platform audit |
| Route         | `/{locale}/administration/**`                                                                            | `/{locale}/platform/**` under a `(platform)` group                                                      |
| Permissions   | tenant permission catalogue                                                                              | a **separate** platform catalogue                                                                       |
| Audit         | tenant audit                                                                                             | **separate** platform audit categories                                                                  |
| Eventual host | the product domain                                                                                       | `admin.<approved-product-domain>`                                                                       |

**A tenant administrator is never a platform administrator.** The Control Plane
is not reachable through any tenant permission, and no tenant permission code
may grant it. Enforcement is server-side; the route boundary is a convenience,
not a control.

`apps/web/src/app/[locale]/(platform)/platform/**` for the Frontend. **Never
inside `apps/api`** — that workspace is Backend-only and a gate enforces it.

## 2. What already exists (measured, not assumed)

Worth stating precisely, because the gap is smaller in the database than it
looks and much larger in the API than it looks.

**Exists in the database and works:**
`org.feature_flags`, `org.subscription_plans` (versioned, effective-dated,
JSONB entitlements validated against the flag register, with a `gist EXCLUDE`
preventing overlapping active versions), `org.tenant_subscriptions` (one
resolvable active assignment per tenant per instant),
`org.tenant_feature_overrides`, and a working resolver
`org.resolve_feature_enabled` implementing override → plan entitlement →
platform default. `org.tenants.status` exists as
`provisioning | active | suspended | closed`.

**Does not exist anywhere:**
Any money — no price, currency, amount, seat count, billing period, payment
instrument or usage meter on any table. No membership relation (one identity →
at most one tenant, enforced by a global unique index). No email-domain or
organisation-discovery concept. No platform permission catalogue. No support
session model.

**Exists but is inert:**
The feature-flag entitlement middleware is wired into the route pipeline and
**no operation declares a flag**, so it never runs. `org.tenants.status` is
enforced nowhere. `capacity_limits` is validated on write and read by nothing.

That last group matters most: the seams are built and unused. The commercial
work is less "invent an entitlement system" and more "give the one that exists
money, seats, and teeth".

## 3. Domain model (proposed)

```
Plan ──< PlanVersion ──< PlanEntitlement
                │
Tenant ──< Subscription >── PlanVersion
   │            ├── SubscriptionPeriod (start, end, interval)
   │            ├── SeatAllocation (purchased, assigned, available)
   │            ├── Discount (percentage | fixed | promotional)
   │            └── SubscriptionEvent (append-only)
   ├──< PlatformNote (commercial | internal)
   └──< SupportSession (scope, reason, expiry, consent, approval)

PlatformUser ──< PlatformRoleGrant >── PlatformRole
PlatformAuditRecord (actor, target, action, before, after, reason, correlation)
```

**Money is never a float.** Decimal strings and ISO 4217 codes, calculated
server-side, with inputs and outputs both recorded so a quotation can be
re-derived. JavaScript floating-point arithmetic must not touch a canonical
amount — the repository already has this rule for the garage's own money and it
applies here identically.

## 4. Subscription lifecycle

`draft → trial → active → expiring-soon → past-due → expired → suspended`
with `cancelled`, `reactivation-pending` and `reactivated` as branches, and
`grace` as a **configurable** state whose use is an open decision.

Enforcement points, all server-side:

- authentication (is the tenant suspended or closed?)
- request authorization (is the subscription active for this operation?)
- feature entitlement (does the plan include this capability?)
- seat validity (is this user occupying a purchased seat?)
- export and file access (governed by the post-expiry data policy)
- background jobs (a job must not do what a request may not)

**Expiry stops operation; it never destroys data.** The tenant is preserved, the
renewal screen is reachable, and expired credentials must never be reported as
invalid credentials.

## 5. Seat lifecycle

Purchased, assigned, available; over-allocation prevented at assignment;
deactivation releases a seat; effective dates and an audit trail on every
change. Reducing seats below assigned is a policy decision, not a silent
truncation.

## 6. Notifications

Configurable schedule — 30 / 14 / 7 / 3 / 1 days before expiry, on expiry, and
after — targeting the tenant owner, billing administrator and company
administrator, plus RootLco commercial staff where approved. **Not** every
employee: commercial detail is not operational information.

## 7. Support access — governed, never a super-admin shortcut

A Support Access Session records tenant, company, requested scope, reason,
operator, start, expiry, maximum duration, read-only or approved write scope,
customer consent state, approval state, a **visible banner in the tenant's own
interface**, a complete audit event, automatic expiry and manual termination.

Default: read-only, time-limited, narrowly scoped, reason required, audit
mandatory. Write access requires stronger approval.

**Never:** viewing or recovering an existing password, silent or permanent
impersonation, disabling audit, `BYPASSRLS` in a browser workflow, a shared
support credential, or a hidden session. A password reset is initiated through
the normal secure reset flow, old tokens are invalidated, and the action is
recorded — plaintext passwords are never displayed, stored or emailed.

## 8. Platform roles

Platform Owner · Commercial Administrator · Billing Administrator · Support
Administrator · Security Administrator · Read-only Auditor.

Least privilege. Not every RootLco employee is a Platform Owner. Platform audit
records are not editable by ordinary platform operators.

## 9. Proposed phase sequence

Each is a full cross-layer phase with its own gate. **The numbers below are
placeholders**: the repository's canonical plan owns phase numbering, and the
next available number must be read from it and authorised before any of these
is opened. Do not overwrite a planned phase.

- **Phase A — SaaS commercial domain and subscription Backend.** Money on
  plans, seats, billing intervals, discounts, lifecycle states, entitlement
  enforcement wired to real operations, notification scheduling. Turns the
  existing inert spine into an enforced one.
- **Phase B — Control Plane Backend.** Company provisioning (idempotent,
  transactional, retry-safe, with explicit rollback), commercial operations,
  support-access model, platform permission catalogue, platform audit.
- **Phase C — Control Plane Frontend.** Dashboard, companies, plans, pricing
  calculator, subscriptions, seats, support, audit — under `(platform)`.
- **Phase D — Billing and renewal automation.** Payment provider, invoices,
  receipts, failed payments, dunning, automatic renewal, reconciliation.

Multi-tenant membership (one human, several companies) is a **prerequisite of
the Login selector**, not of the Control Plane, and needs its own Database
phase — see `phase-1-26/login-identity-contract.md` §4.

## 10. Threat model — what must be true

Account discovery · email-domain misuse · cross-tenant access · platform-admin
escalation · subscription bypass · seat bypass · support impersonation ·
password-reset abuse · verification-override abuse · discount manipulation ·
extension abuse · audit deletion · export after expiry · RootLco staff access to
customer data · shared support credentials · stale support sessions.

Required properties: least privilege; deny by default; server-resolved tenant;
server-enforced subscription and entitlement; no plaintext password; no hidden
impersonation; complete audit; time-limited support with a reason; correlation
IDs; RLS always active; no `BYPASSRLS` in a browser path; no service-role key
in the browser.

**Email domain may assist onboarding. It must never grant membership.** A
domain can be shared, compromised, misconfigured, owned by a parent company,
used by contractors, or be a public provider. Authorization comes from a
verified invitation, an existing membership, or an approved verified-domain
enrolment policy — never from the string after the `@`.

## 11. Open decisions — commercial values are NOT invented here

| Decision                                                  | Status                              |
| --------------------------------------------------------- | ----------------------------------- |
| Default monthly and annual pricing                        | OPEN                                |
| Annual discount                                           | OPEN                                |
| Included seats, per-seat price, minimum and maximum seats | OPEN                                |
| Trial duration                                            | OPEN                                |
| Grace period, and whether one exists at all               | OPEN                                |
| Suspension timing after expiry                            | OPEN                                |
| Data retention after expiry                               | OPEN                                |
| Export permitted after expiry                             | OPEN                                |
| Reactivation rules                                        | OPEN                                |
| Proration                                                 | OPEN                                |
| Refund policy                                             | OPEN                                |
| Tax policy                                                | OPEN                                |
| Invoice / payment provider                                | OPEN                                |
| Renewal notification schedule                             | OPEN (architecture is configurable) |
| Support-access consent requirement                        | OPEN                                |
| Manual verification authority                             | OPEN                                |
| Manual extension authority                                | OPEN                                |

The architecture must be configuration-ready and decision-neutral: every value
above is data, not a constant in code.

## 12. Acceptance criteria for the plan itself

This document is complete when each phase above has a scope record, an owning
layer, an entry in the canonical plan, and an authorised number. It is **not**
evidence that anything is built. No Control Plane screen, route, permission,
table or operation exists today.
