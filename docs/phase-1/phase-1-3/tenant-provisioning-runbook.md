# Tenant Provisioning Runbook (Phase 1-3)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 · **Date:** 2026-07-17 · **Tasks:** P1-03-DB-020/022, P1-03-DOC-003 ·
**Validation status:** **self-validated** — executed end-to-end by
Eng. Ezzaldeen Al-Bitar on 2026-07-17 (evidence register §5). **No second engineer
has executed it**; it is written to be executable by one, and stays self-validated
until an independent execution occurs.

## What provisioning is (and is not) in this phase

Provisioning creates one complete organization — tenant, initial status history,
draft subscription, legal company, pilot branch, optional settings/overrides, and
number-sequence configuration — in **one database transaction** through
`org.provision_organization(spec jsonb, idempotency_key text)`. There is **no
backend API**: execution is a platform operation on a BYPASSRLS/admin connection
(local: the `postgres` connection; production paths do not exist yet). Application
roles cannot execute it and cannot touch `shared.idempotency_keys` — both proven
by tests.

## Prerequisites

1. Local stack up: `npm run supabase:start` (or CI service container).
2. All migrations applied to a clean database: `npm run supabase:reset`
   (this also runs the seed pipeline, including the two example packages).
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

1. **Choose an idempotency key** — stable per provisioning intent, e.g.
   `<tenant_code>-provisioning-v1`. Re-running with the same key + same spec is
   always safe (replays the stored result, creates nothing).
2. **Execute** on an admin connection:
   ```sql
   SELECT org.provision_organization('<spec jsonb>'::jsonb, '<key>');
   ```
   For a repeatable package, commit it as a seed file modeled on
   `supabase/seeds/03_local_test_tenant.sql` (fictional example) or
   `supabase/seeds/02_benzene_pilot_provisioning.sql` (the controlled pilot
   package — the ONLY executable file that may name the pilot).
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
