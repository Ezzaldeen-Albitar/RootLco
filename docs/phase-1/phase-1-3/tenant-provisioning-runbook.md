# Tenant Provisioning Runbook (Phase 1-3)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 · **Date:** 2026-07-17 · **Tasks:** P1-03-DB-020/022, P1-03-DOC-003 ·
**Validation status:** **self-validated** — executed end-to-end by
Eng. Ezzaldeen Al-Bitar on 2026-07-17 (evidence register §5). **No second engineer
has executed it**; it is written to be executable by one, and stays self-validated
until an independent execution occurs.

> **Phase 1-5 forward correction (2026-07-18):** automatic tenant seeds were
> removed. The approved operational path is the controlled JSON package plus
> `scripts/db/provision-organization.mjs`, governed by
> [the pilot provisioning runbook](../../database/pilot-provisioning-runbook.md).
> It never runs in `[db.seed]`, CI, local reset, or application startup.

## What provisioning is (and is not) in this phase

Provisioning creates one complete organization — tenant, initial status history,
draft subscription, legal company, pilot branch, optional settings/overrides, and
number-sequence configuration — in **one database transaction** through
`org.provision_organization(spec jsonb, idempotency_key text)`. When this runbook was
written there was **no backend API**: execution was a platform operation on a
BYPASSRLS/admin connection (local: the `postgres` connection). Application roles cannot
execute the function directly and cannot touch `shared.idempotency_keys` — both proven
by tests.

> **Since P1-29 W9 (2026-09-02):** the sanctioned production path is the backend
> operation `platform.organization-provision`, run by a platform operator holding
> `platform.organization.provision`. It calls the same function AND performs the
> First-Owner bootstrap in the same transaction (account, `first_owner`,
> `tenant_administrator`, grants), and activates the tenant only after that — see
> `docs/phase-1/phase-1-29/w9-owner-bootstrap.md`. The package-driven CLI below remains a
> privileged local-pilot mechanism only. Its `tenant.activate: true` activates INSIDE the
> function, before any administrator exists, which the product flow never does; a tenant
> created that way holds no usable administrator and the bootstrap window is already closed.
> The first platform operator is established by `scripts/platform/genesis-platform-operator.mjs`.

## Prerequisites

1. Local stack up: `npm run supabase:start` (or CI service container).
2. All migrations applied to a clean database, followed by the declared
   structural seeds: `npm run db:apply-migrations` then
   `npm run validate:seed-state`.
3. Reference data present (`shared.currencies/timezones/languages`) — the
   reference seed provides it; a spec referencing a missing currency/timezone
   fails the whole transaction by FK (that is the designed behaviour).
4. An **active** subscription-plan version covering the requested start
   (`org.subscription_plans`), if the spec assigns a subscription.

## The spec document

```jsonc
{
  "actor_id": "<uuid>",              // required if no session user context
  "tenant": {
    "code": "<immutable snake_case>",// unique platform-wide
    "display_name": "…",
    "locale": "en|ar|…",             // FK shared.languages
    "timezone": "UTC|…",             // FK shared.timezones
    "activate": true,                // optional; runs the atomic transition
    "activation_reason": "…"         // required when activate=true
  },
  "subscription": { "plan_code": "pilot", "status": "draft", "effective_from": "…" },
  "company": {
    "code": "…", "legal_name": "…", "base_currency": "JOD|USD|…",
    "registration_number": null,     // NEVER invent unknown facts — leave null
    "tax_registration_number": null
  },
  "branch": { "code": "main", "name": "…", "timezone": "…", "country_code": "JO", "city": "…" },
  "settings": { "company": [ { "key": "…", "value": …, "value_type": "string|number|boolean|json" } ], "branch": [] },
  "feature_overrides": [ { "flag_code": "…", "enabled": true, "reason": "…" } ],
  "sequences": [ { "code": "org_document", "prefix_template": "DOC-", "pad_width": 6 } ]
}
```

## Procedure

1. **Use the reviewed package idempotency key.** Re-running the unchanged
   package is safe: the stored response is replayed and nothing is created.
2. **Dry-run, confirm, then execute** with the generic CLI as specified in the
   current [pilot provisioning runbook](../../database/pilot-provisioning-runbook.md).
   A Class-3 package is a manually gated data artifact, never a seed file.
3. **Record the returned document** (`tenant_id`, `subscription_id`,
   `company_id`, `branch_id`) in the provisioning register
   ([organization-schema-design.md §5](./organization-schema-design.md)).
4. **Verify** (all as admin; runtime verification happens via the test suite):
   ```sql
   SELECT status FROM org.tenants WHERE tenant_code = '<code>';        -- expected state
   SELECT count(*) FROM org.tenant_status_history WHERE tenant_id = …; -- 1, or 2 if activated
   SELECT org.current_subscription_plan_id(now());                     -- as the tenant, via tests
   ```

## Failure and retry semantics (proven by injection tests)

| Situation                               | Behaviour                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Any step fails (bad FK, CHECK, EXCLUDE) | **Everything** rolls back, including the idempotency row — no partial tenant can exist |
| Retry after failure, corrected spec     | Starts clean (the key was rolled back)                                                 |
| Retry after success, same key + spec    | Returns the stored response byte-identically; zero new rows                            |
| Same key, DIFFERENT spec                | Raises `integrity_constraint_violation` (23000) — keys are never silently reused       |
| Two concurrent calls, same key          | One commits; the other fails on the unique key (or tenant_code) and its retry replays  |

## Rules that bind every package

- Unknown facts are **NULL or explicitly pending** — never invented (the pilot
  package is the reference example).
- No secrets in settings values, ever.
- One tenant per package; packages are version-controlled, reviewed artefacts.
- Do not migrate real operational customer data with this mechanism — that is a
  reserved owner decision (Standing Technical Authorization Policy §5).
