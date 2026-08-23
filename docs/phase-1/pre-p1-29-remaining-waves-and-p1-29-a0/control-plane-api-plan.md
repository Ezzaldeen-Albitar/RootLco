# Platform control plane — what develop has, and the context model a future one must use

**Slice B1 introduced the control-plane principal and it is not on `develop`.** Everything below
describes `develop` at `c081a019`. Where B1 changes a fact, that is stated rather than assumed.

**This document designs no operation.** It records the existing foundations and the constraints any
future control-plane API must satisfy.

## The operations a future control plane must eventually cover

tenant and company provisioning · subscription management · tenant lifecycle · initial Company
Owner bootstrap · platform operator authority · safe employee and account recovery · company status
changes · branch status changes · audit and event visibility.

## The four prohibitions that bound all of them

1. **No plaintext password recovery.** Recovery is a reset flow, never a disclosure.
2. **No hard-coded superadmin email**, and no principal identified by an address.
3. **No frontend-held platform authority.** Capability may reach the browser for _visibility_;
   authority may not.
4. **No bootstrap by weakening a check** (P-6). The bootstrap path must be a _narrower_ authority
   with a self-closing window, not a relaxed version of the normal one.

## The request-context rule, stated once

A future platform operation must prove **four** things from server-resolved state and never from
the request payload: who the platform principal is, which platform permissions they hold, which
tenant or company they are acting on, and which actor is written to audit.

**Never trusted:** an actor id in a request body, a client-supplied tenant id, or a raw UUID from
the frontend that the backend has not independently resolved and authorized.

---

## What exists today

### org.provision_organization(jsonb, text) — full signature and posture

**EXISTS BUT NOT USED.**

Two parameters, returns jsonb `{tenant_id, subscription_id, company_id, branch_id}`. Seven steps in ONE transaction (:131-252): tenant + `org.tenant_status_history` row; optional subscription resolved against an active `org.subscription_plans` version covering the requested start (:146-169); legal company; pilot branch; company/branch settings loops; tenant feature overrides; `shared.number_sequences` rows. Optional activation calls `org.change_tenant_status` (:255-261). The idempotency record is written in the SAME transaction (:270-272), so a failure at any step rolls back the key too. Gate at :105-118: same key + same md5 fingerprint replays the stored response and creates nothing; same key + different fingerprint raises `integrity_constraint_violation`. SECURITY posture: INVOKER, so the caller needs the underlying INSERT grants — `app_runtime` holds only SELECT on `org.tenants` (20260717101000:259), so both layers deny. `search_path` is the empty string, so every reference is schema-qualified. EXECUTE grants: none anywhere. Confirmed a second time by the later migration's own 'deliberately absent' list — 20260725090000_iam_shared_runtime_write_capabilities.sql:380 names `EXECUTE on … org.provision_organization` among what is NOT granted.

_Evidence:_ C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco-worktrees/pre-p1-29-planning/supabase/migrations/20260717107000_org_provisioning.sql:84-92 `CREATE OR REPLACE FUNCTION org.provision_organization(p_spec jsonb, p_idempotency_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$`; :281 `REVOKE EXECUTE ON FUNCTION org.provision_organization(jsonb, text) FROM PUBLIC;`; :282 comment `-- Deliberately granted to no application role.`

### Whether any route calls org.provision_organization

**MISSING.**

ZERO routes. Reachability is limited to a superuser-class out-of-band connection. tests/db/org-provisioning.test.ts:409 pins the denial: `it('a runtime session cannot execute the provisioning function (42501)')`. The frozen P1-29 preparation set states the same fact independently (p1-29-prep/docs/phase-1/phase-1-29/permission-matrix.md:269: 'has EXECUTE revoked from PUBLIC and is called by no route'), so there is no contradiction to resolve.

_Evidence:_ `grep -rn "provision_organization|provisionOrganization" apps/` returns exactly one hit and it is a comment: apps/api/src/modules/quality/application/rework-service.ts:263. No route.ts, no repository, no service issues the call. The only executable call site in the repo is the operator script scripts/db/provision-organization.mjs:138-141, which connects as `user: process.env.DB_USER ?? 'postgres'` (:93) and refuses unless `ROOTLCO_ENV` is exactly `local-pilot` or `production-pilot` (:76-81).

### Database roles created by the migrations — app_runtime

**EXISTS AND LOAD-BEARING.**

The runtime application archetype. Non-owner, no BYPASSRLS, no DDL; every privilege is an explicit per-object grant issued by the migration that creates the object. It is the role every `TO app_runtime` RLS policy addresses. NOLOGIN — it is assumed by membership (tests grant it to `rootlco_test_runtime`, tests/db/helpers.ts:116).

_Evidence:_ supabase/migrations/0002_base_schemas.sql:62-65 `CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`; :73 role comment; :78 `GRANT USAGE ON SCHEMA org, iam, shared, crm, veh TO app_runtime, app_readonly;`

### Database roles created by the migrations — app_readonly

**EXISTS AND LOAD-BEARING.**

SELECT-only support/diagnostics archetype. 20260725090000:380 records that the runtime-write-capabilities migration granted it nothing at all.

_Evidence:_ supabase/migrations/0002_base_schemas.sql:66-69 `CREATE ROLE app_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`; :74 role comment 'Read-only support role archetype. Non-owner, no BYPASSRLS, SELECT-only grants.'

### Database roles created by the migrations — app_worker

**EXISTS AND LOAD-BEARING.**

Asynchronous infrastructure worker. Its enumerated worker-table RLS policies deliberately span all tenants, which is why it is a separate role rather than a grant on app_runtime. USAGE on only `shared` and `iam` — narrower than the other two archetypes. That is the complete list: `grep -rn 'CREATE ROLE' supabase/` returns exactly these three sites and nothing in supabase/seeds/.

_Evidence:_ supabase/migrations/20260718106000_shared_event_outbox.sql:63-68 `CREATE ROLE app_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`; role comment immediately after; then `GRANT USAGE ON SCHEMA shared, iam TO app_worker;` and `GRANT EXECUTE ON FUNCTION iam.current_user_id() TO app_worker;`

### A fourth (platform) database role on develop

**MISSING.**

Slice B1's `app_platform` is not in this tree — as expected, B1 is unmerged. Two consequences for a future control plane, both measurable here: (a) there is no role today whose privilege envelope could execute `org.provision_organization`, so the function is unreachable from any application connection by construction; (b) `rls-matrix.mjs` would not check a fourth role at all — it iterates `RUNTIME_ROLES`, so a role absent from that array is verified by nothing.

_Evidence:_ `grep -rn "app_platform" --include=*.sql --include=*.ts --include=*.mjs supabase/ apps/ scripts/ tests/` returns zero hits. scripts/ci/rls-matrix.mjs:81-84 hard-codes exactly three roles in `RUNTIME_ROLES` (`app_runtime`, `app_readonly`, `app_worker`) and drives the matrix from that list at :219 and :302.

### Roles created outside the migrations (login roles)

**EXISTS AND LOAD-BEARING.**

No migration creates a LOGIN role. The archetypes are NOLOGIN and are always reached through membership. docs/database/role-and-grant-standard.md:63-68 tabulates the same three archetypes plus `postgres` as the migration/owner role, and :184-191 documents the Supabase-managed roles (`postgres` has BYPASSRLS, `service_role` has BYPASSRLS) which the migrations never modify.

_Evidence:_ tests/db/helpers.ts:93-118 creates four LOGIN roles idempotently — `rootlco_test_runtime` (:37), `rootlco_test_readonly` (:39), `rootlco_test_worker` (:41), `rootlco_test_owner` (:43) — then `GRANT app_runtime/app_readonly/app_worker TO …` (:116-118). scripts/dev/owner-acceptance/create-owner-account.mjs:372-379 creates `ACCEPTANCE_DB_LOGIN` and grants it `app_runtime`.

### Request context — the four session settings written per transaction

**EXISTS AND LOAD-BEARING.**

Exactly four. All transaction-local (`is_local = true`), so they evaporate at COMMIT/ROLLBACK and cannot leak across a pooled connection. All bound as parameters — never interpolated — so a context value can never become SQL. Source: `RequestContext`, which `buildRequestContext` freezes and whose every identifier passes `assertUuid` (apps/api/src/server/context/request-context.ts:63-101; the regex at :63 pins version digit `[1-8]` and variant `[89ab]`). A `DbHandle` cannot be constructed without a context (transaction.ts:35-44, 60-65), so 'the repository forgot the tenant' is a compile error.

_Evidence:_ apps/api/src/server/db/transaction.ts:91-105 `applyContext()`: pairs `['app.tenant_id', context.principal.tenantId]`, `['app.user_id', context.principal.userId]`, then pushes `['app.company_ids', context.companyIds.join(',')]` and `['app.branch_ids', context.branchIds.join(',')]`; each is issued as `await client.query('SELECT set_config($1, $2, true)', [key, value])` (:103). Called at :139, after `BEGIN … READ WRITE|READ ONLY` (:127) and after the transaction-local `statement_timeout` (:135-138).

### Request context — where the values come from, and whether a request body can influence them

**EXISTS AND LOAD-BEARING.**

No identity or scope value is ever taken from a request. A client-supplied company/branch is a CLAIM checked against measured grants; a non-UUID is `ERR-VAL-001` (:125-129), an unheld id is a uniform `ERR-IAM-001` that never reveals existence. The tenant claim is a lookup key only: a malformed one is an authentication failure (`ERR-IAM-002`, :250-254) and a claim to another tenant simply finds no account. Session liveness is re-read from `iam.user_sessions` in the SAME read-only transaction using the DATABASE clock (:169-203), and revoked/hard-expired/idle-expired/unknown are all answered with one indistinguishable `ERR-IAM-002` (:298-305). `resolveScopeFor` also collapses an unrestricted grant to empty lists (:99-103) so a tenant-wide operator is not silently narrowed.

_Evidence:_ apps/api/src/server/context/resolve-context.ts:249-322. Bootstrap context carries only the claimed tenant (:259-264); inside `withReadOnlyTransaction` it first blanks the user slot — `SELECT set_config('app.user_id', '', true)` (:273) — then `resolveScopeFor` reads `iam.user_accounts` by `(identity_provider, provider_subject)` with `status='active' AND deleted_at IS NULL` (:61-72) and aggregates `iam.role_grants`/`iam.grant_scopes` for active, in-window grants (:74-91). `narrowScope` (:114-147) intersects the requested narrowing and THROWS `ERR-IAM-001` for anything outside it (:133-138) rather than dropping it. The requested narrowing itself is `RouteOptions.requestedScope` (apps/api/src/server/http/route-handler.ts:117, forwarded at :311).

### Request context — a fifth session setting that IS derived from a request body

**EXISTS AND LOAD-BEARING.**

This is the one session setting whose VALUE originates in a request document. It carries a free-text reason, never an identity, tenant, scope or permission, and it is bound as a parameter and cleared immediately after the statement so a second transition in the same request cannot inherit it. Reported here because 'no request body reaches session state' is not literally true on develop, and a control-plane design that repeats the claim verbatim would be overstating what the code does.

_Evidence:_ apps/api/src/modules/work-order/data/work-order-repository.ts:679 `await this.run(db, 'SELECT set_config($1, $2, true)', ['app.status_reason', reason ?? ''])` then cleared at :687; same pattern at :943/:951, apps/api/src/modules/reception/data/reception-repository.ts:235/:243, apps/api/src/modules/diagnostics/data/diagnostics-repository.ts:448/:456. Read by transition guards and history triggers, e.g. supabase/migrations/20260722096000_wo_status_history.sql:112 and 20260722095000_wo_work_orders.sql:190 (which RAISEs at :229 when a reason-required edge finds it unset).

### Request context — a sixth GUC that nine triggers read and nothing sets

**MISSING CONTRACT.**

`applyContext` sets four GUCs and this is not one of them, so `current_setting(..., true)` returns NULL and the trigger writes NULL. Confirmed end-to-end at 20260722096000_wo_status_history.sql:111-119: `v_correlation` is declared from the unset GUC and inserted straight into `wo.work_order_status_history.correlation_id`. It fails silently (missing_ok = true), so every trigger-written history row on develop carries `correlation_id = NULL` while the migration comment at 20260721094000:170 states the value is 'captured from … app.correlation_id'. Repositories that write history rows explicitly, e.g. apps/api/src/modules/shared-services/data/transition-repository.ts:129, DO pass `context.correlationId` — so the correlation trail exists on the explicit-INSERT path and is absent on the trigger path.

_Evidence:_ `grep -rn "app.correlation_id" apps/` returns ZERO hits. It is read by nine migration trigger functions: 20260720095000_veh_vehicle_attribute_history.sql:92, 20260720102000_veh_vehicle_status_history.sql:151, 20260721094000_apt_appointment_status_history.sql:156, 20260721106000_rec_status_history_checkin.sql:134, 20260722096000_wo_status_history.sql:111, 20260722097000_wo_jobs.sql:292, 20260722102000_dia_reports.sql:261, 20260722104000_qms_quality_control.sql:262, 20260723096000_quo_quotations.sql:408 (all as `NULLIF(current_setting('app.correlation_id', true), '')::uuid`).

### Actor derivation — iam.current_user_id() and the stamping triggers

**EXISTS AND LOAD-BEARING.**

The stampers OVERWRITE whatever a caller supplied — transition-repository.ts:113-116 documents that `actor_id` is passed only because the column is NOT NULL and is then replaced from the session, 'which is what makes them unforgeable'. All are SECURITY INVOKER with `search_path = ''`, and no role holds EXECUTE on the trigger functions (PUBLIC default revoked, 0002:206). `iam.has_permission` denies on an unset context and on an invalid UUID rather than erroring (`EXCEPTION WHEN invalid_text_representation THEN RETURN false`), so the failure direction is denial.

_Evidence:_ supabase/migrations/0002_base_schemas.sql:118-126 `CREATE OR REPLACE FUNCTION iam.current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid; $$;`, EXECUTE revoked from PUBLIC then granted only to `app_runtime, app_readonly` (and to `app_worker` at 20260718106000). Stampers: `shared.touch_row_metadata()` (0002:189-196) sets `NEW.updated_by := iam.current_user_id()` and `NEW.record_version := OLD.record_version + 1`; `NEW.actor_id := iam.current_user_id()` at 20260717103000:269, 20260718090000:245, 20260718096000:76 (`shared.stamp_status_history`), 20260719105000:149.

### Actor derivation — audit writes

**EXISTS AND LOAD-BEARING.**

`audit.ts:92` is the ONLY call site of `iam.audit_append` in `apps/api/src` (every other hit is a comment or a capability probe string). The actor is therefore always the resolved principal. `p_actor` is a plain parameter, so the function itself would accept a forged actor from a caller that could build one — but the only caller binds from context.

_Evidence:_ apps/api/src/server/audit/audit.ts:89-118 calls `iam.audit_append(p_tenant => $1, p_actor => $2, …)` with `db.context.principal.tenantId` and `db.context.principal.userId` (:106-107) after `requireCapability(db, 'audit.append')` (:89). apps/api/src/server/audit/security-events.ts:60-72 inserts `iam.security_events` binding `db.context.principal.userId` as `actor_id`. The SQL side, supabase/migrations/20260718095000_iam_audit_subsystem.sql, is `iam.audit_append(p_tenant, p_actor, p_actor_kind, p_action, p_entity_type, p_entity_id, p_company, p_branch, p_correlation, p_request_ref, p_details) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`, serialising the per-tenant chain under `pg_advisory_xact_lock`.

### Actor derivation — search for an actor id taken from a request payload

**EXISTS AND LOAD-BEARING.**

TypeScript: ZERO paths take an actor id from a request payload for a write. The three non-context writes are worker paths binding the fixed system actor `00000000-0000-4000-8000-000000000001`. The one `actorId` that does arrive from a request is apps/api/src/app/api/v1/audit-events/route.ts:39 (`actorId: schemas.uuid.optional()`), and it is a READ FILTER — apps/api/src/modules/iam/data/audit-repository.ts:94 `addFilter('actor_id', filters.actorId)`. SQL: exactly two functions fall back to a caller-supplied actor when the session principal is empty. Neither is executable by any application role — `org.provision_organization` has no GRANT at all, and `org.change_tenant_status` is REVOKEd from PUBLIC (20260717101000:231) and granted to nobody (by contrast `org.change_branch_status`, which takes NO actor parameter, IS granted to `app_runtime` at 20260717103000:350). The fallback is exercised today only by superuser paths: tests/db/org-provisioning.test.ts:291 passes `actor_id: USER_A`, and supabase/packages/pilot-provisioning.package.json:13 carries `"actor_id": "00000000-0000-4000-8000-000000000001"`.

_Evidence:_ Scripted scan of every backtick SQL template in apps/api/src containing INSERT/UPDATE/audit_append and an actor-shaped column (`created_by|updated_by|actor_id|author_id|assigned_by|recorded_by|verified_by|approved_by|reviewed_by|requested_by|performed_by|issued_by|granted_by|revoked_by|closed_by|claimed_by|deleted_by|p_actor`): 130 templates examined, 3 whose surrounding argument list does not mention the resolved principal — apps/api/src/modules/shared-services/data/message-dispatch-repository.ts:183 (binds `SYSTEM_ACTOR`, a constant at :233), apps/api/src/server/worker/consumer-registry.ts:116 (binds `SYSTEM_ACTOR_ID`, constant at apps/api/src/server/worker/worker-db.ts:30), apps/api/src/server/worker/outbox-worker.ts:106 (same constant). SQL side: supabase/migrations/20260717107000_org_provisioning.sql:121 `v_actor := COALESCE(iam.current_user_id(), (p_spec ->> 'actor_id')::uuid);` and supabase/migrations/20260717101000_org_tenants.sql:193 `v_actor := COALESCE(iam.current_user_id(), p_actor_id);`.

### handleOperation ordering and what each step trusts

**EXISTS AND LOAD-BEARING.**

What each step trusts. (1) Pre-auth throttle trusts only `operation.id` and `resolveClientAddress` (:240-243), which reads a peer address from the platform or a configured trusted proxy — never a bare header. (2) Authentication trusts the provider-verified token via `sessionAuthenticator().authenticate(request)`; the default authenticator returns null so every operation fails closed (apps/api/src/server/context/principal.ts:21, 63). (3) Context resolution trusts NOTHING from the claims except as lookup keys — the account row, the grants and the session row are re-read from the database. (4) Authorization trusts the database: `evaluatePermissions` (apps/api/src/server/auth/authorization.ts:92-122) calls `iam.has_permission($1)` or, when a target names a company/branch, `iam.has_permission_in_scope($1,$2,$3,$4)`, inside the request transaction under the request's own GUCs; ALL declared codes must pass, deny precedence lives in SQL, an unset context returns false. Denial is a uniform `ERR-IAM-001` naming permission codes but never the resource (:150-156). (5) Entitlement runs AFTER authorization on purpose so an unauthorized caller cannot probe which features a tenant bought (apps/api/src/server/auth/entitlement.ts:16-18), and resolves `org.resolve_feature_enabled(flag, context.startedAt)` (:49-52), raising rather than quietly denying on an unregistered flag. (6) The handler receives an already-authorized `DbHandle` plus an `authorizeScope` callback wired to `requireScopedPermissions` (:357-358), which fails closed on an empty target so a row-addressed command re-evaluates with the row's own scope (P1-18-A-01). Note the public path (:408-437) has no context, no transaction, no database, and its `authorizeScope` throws by design.

_Evidence:_ apps/api/src/server/http/route-handler.ts:190-405. Correlation normalised :196-199. Policy resolved INSIDE the try :214 (moved there because `policyFor` throwing above it produced unhandled 500s — P1-27-INT-113, :206-213). Pre-auth throttle :276-281. Public short-circuit `return await handlePublic(...)` :297. Authenticate :300-303. Resolve context :305-312. Post-auth throttle :314-321. `If-Match` :323, `Idempotency-Key` :324, fingerprint bound to the RESOLVED context :328-338. `withTransaction` opens at :341; `requirePermissions(db, operation, options.authorizationTarget ?? {})` :342; `if (operation.featureFlag) await requireFeature(db, operation.featureFlag)` :343; handler `execute` :345-359; idempotency wrapper :363-368.

### Rate-limit policies available for reuse

**AVAILABLE.**

Five, and the key union is compile-enforced at the declaration site (operation-registry.ts:81) precisely because a `string` type let six operations declare an unregistered `'standard-read'` and 500 on every request. Declaration is OPTIONAL, so declaring nothing means no limit at all. `policyFor` (route-handler.ts:151-182) returns a non-public operation's declared policy verbatim; for a public operation it KEEPS a sessionless declared policy and otherwise substitutes `public-probe`. A policy keyed on `ip` is skipped for a public operation only when the policy is NOT `securityRelevant` and no client address resolved (:270-274) — `auth-adjacent` never gets that exemption. Only `auth-adjacent` and `public-probe` have key material that exists without a tenant or user, and only `auth-adjacent` is security-relevant.

_Evidence:_ apps/api/src/server/http/rate-limit.ts, `const POLICIES = Object.freeze({ … } satisfies Readonly<Record<string, RateLimitPolicy>>)` at :129-189, exported as `RATE_LIMIT_POLICIES` at :200 and typed as `RateLimitPolicyName = keyof typeof POLICIES` at :198. The five: `auth-adjacent` :130 (10/60_000ms, keyBy ['operation','ip'], securityRelevant TRUE); `expensive-read` :140 (30/min, ['operation','tenant','user'], false); `standard-command` :150 (120/min, ['operation','tenant','user'], false); `public-probe` :168 (120/min, ['operation','ip'], false); `low-risk-metadata` :179 (600/min, ['operation','tenant'], false).

### Identifier validation — schemas.uuid and the strict query parsing

**AVAILABLE BUT NEEDS ADAPTER.**

What is actually enforced: shape and format at the edge, with 286 `.strict()` usages across apps/api/src so an unknown BODY field is normally a 422. The gap a control plane inherits: the four non-strict query schemas are precisely the IAM/audit surfaces — the closest existing analogue to a control plane — so an unknown query parameter there is silently discarded rather than refused. Second gap, and the one §11 names: `schemas.uuid` (Zod) and the context validator (request-context.ts:63, `[1-8]` version digit and `[89ab]` variant, and no nil-UUID allowance) are NOT the same acceptance set, so a value can clear address validation and then fail context construction — which surfaces as an internal error where a validation refusal belongs. Also note validation.ts:222 defines a SECOND, looser UUID regex (`[0-9a-fA-F]` throughout, no version or variant pin) used to read a company/branch authorization target out of a not-yet-validated body.

_Evidence:_ apps/api/src/server/http/validation.ts:194 `uuid: z.string().uuid()` (zod declared `^4.3.6` in apps/api/package.json:34 and package-lock.json:25). Applied as `const Params = z.object({ vehicleId: schemas.uuid })` at apps/api/src/app/api/v1/vehicles/[vehicleId]/route.ts:44. Failures become `ERR-VAL-001` with path + Zod issue code only, never the value (validation.ts:61-68, 16-22). Query parsing: `searchParamsToObject` (:139-165) builds a NULL-PROTOTYPE object via `Object.fromEntries` + `setPrototypeOf(…, null)`, omits a `__proto__` key rather than storing or throwing on it, and is deliberately TOTAL because eight routes call it lexically before `handleOperation` (:112-118). `parseJsonBody` (:173-186) rejects a non-JSON content type as `ERR-REQ-001`. Strictness measured: of the 51 query schemas parsed through `parseOrFail(X, searchParamsToObject(...))`, 47 are `.strict()` and 4 are not — apps/api/src/app/api/v1/audit-events/route.ts:31-43, apps/api/src/app/api/v1/iam/users/route.ts:23-29, apps/api/src/app/api/v1/iam/roles/route.ts:24-27, apps/api/src/app/api/v1/iam/approval-limits/route.ts:30-33 (all four verified by reading them).

### What §11 of the wave-b design says about identifier validation

**AVAILABLE.**

§11 closes finding C8 by reuse plus one deliberate deviation: it does NOT reuse `schemas.uuid` as-is, it requires a control-plane validator whose acceptance set equals `request-context.ts:63`. That is the only place in the design where an existing shared schema is knowingly not reused, and the stated reason is the mismatch above. The design also asserts as fact that zod's `.uuid()` is broader than the context regex — see unknowns; that specific comparison cannot be executed in this worktree.

_Evidence:_ docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-design-v2.md:658-684. Key sentences: ':662-666' request context validates the PRINCIPAL's identifiers, not a target named in the address, and the context readers cast without a handler so a malformed value surfaces a database error; ':668-674' every control-plane address parameter and every target identifier in a request document is validated with `validation.ts:194` BEFORE any context is installed and before any statement is issued, failing as `validation.ts:61-66`; ':676-680' 'the address validator and the context validator do not accept the same strings … the installed zod's `.uuid()` is broader — so a value can pass address validation and then be rejected when the context is built, producing an internal error where a validation refusal belongs. Control-plane routes use a validator that matches `request-context.ts:63` exactly'; ':682-684' a well-formed identifier naming an unreachable target produces a non-disclosing refusal identical to 'does not exist', so the control plane does not become an existence oracle.

### Operations declared without a permission (public: true)

**EXISTS AND LOAD-BEARING.**

Six of 305. `defineOperation` makes this the loud path, not the quiet default: a non-public operation with zero permission codes throws at import (apps/api/src/server/auth/operation-registry.ts:135-141), a public operation with no `publicReason` throws (:142-146), and a public operation that ALSO declares permissions throws (:147-151). All six carry a written `publicReason`. Note the two health probes DECLARE `low-risk-metadata`, which is keyed on tenant — `policyFor` therefore substitutes `public-probe` at runtime (route-handler.ts:175-181), while the four `iam.auth-*` operations keep `auth-adjacent` because it is already sessionless. That substitution can only make a public route more throttled, never less.

_Evidence:_ Exactly six, all under apps/api/src/app: auth/login/route.ts:52 (`iam.auth-login`, POST /auth/login, `auth-adjacent`); auth/logout/route.ts:44 (`iam.auth-logout`, POST /auth/logout, `auth-adjacent`); auth/password-reset/route.ts:39 (`iam.auth-password-reset`, POST /auth/password-reset, `auth-adjacent`); auth/password-reset/completion/route.ts:40 (`iam.auth-password-reset-completion`, POST /auth/password-reset/completion, `auth-adjacent`); health/live/route.ts:29 (`shared.health-live`, GET /health/live, declares `low-risk-metadata`); health/ready/route.ts:42 (`shared.health-ready`, GET /health/ready, declares `low-risk-metadata`). Total registered: 305 `defineOperation({` calls across 249 route.ts files.

---

## Unknowns — what could not be settled, and what would settle it

- The exact acceptance set of `z.string().uuid()` at zod 4.3.6 — whether it accepts the nil UUID, and which version/variant digits it admits relative to the `[1-8]`/`[89ab]` regex at request-context.ts:63. `node_modules` is absent from this worktree, so the assertion in wave-b §11:676-680 could not be executed here. Settled by: in an installed tree, `node -e "const{z}=require('zod');for(const v of ['00000000-0000-0000-0000-000000000000','0189a5d0-0000-9000-c000-000000000000']) console.log(v, z.string().uuid().safeParse(v).success)"`, and printing the compiled regex.
- Which database role the API actually connects as at runtime. apps/api/src/server/db/pool.ts:67-71 builds the pool from `backendConfig().DATABASE_URL` and nothing in the tree pins the role in that URL; the only evidence that it is an `app_runtime` member is the dev script scripts/dev/owner-acceptance/create-owner-account.mjs:379. Settled by: reading the deployed `DATABASE_URL` / env contract and running `SELECT current_user, pg_has_role(current_user,'app_runtime','member')` on the live connection.
- Whether the 12 route files that call `searchParamsToObject` outside the `parseOrFail(Query, searchParamsToObject(...))` shape validate their query strictly. My measurement covered only the 51 schemas matching that shape (47 strict / 4 not). The others (e.g. apps/api/src/app/api/v1/appointments/route.ts, receptions/route.ts, reports/route.ts, jobs/[jobId]/history/route.ts) hoist `const raw = searchParamsToObject(...)` above `handleOperation` and parse inside. Settled by: reading those 12 files, or by a gate that asserts every query schema is `.strict()`.
- Whether `app.correlation_id` never being set is a deliberate deferral or an unnoticed gap. Nine trigger functions read it; nothing in `apps/` writes it. No ADR, test, or comment found in this tree that states the intent either way. Settled by: a DB test asserting `correlation_id IS NOT NULL` on a trigger-written history row after a real request, or an explicit note in the database architecture doc.
- What slice B1 actually adds — `app_platform`, the platform authority relation, and the three `platform.organization.*` permission codes are all absent from this tree, so nothing here can confirm or refute the design's claims about them. The frozen P1-29 preparation set independently records B1 as unmerged and unused by P1-29 (p1-29-prep/docs/phase-1/phase-1-29/permission-matrix.md:61, :287-292; blocker-register.md:244). Settled by: reading the B1 branch, or by B1 merging into develop.
- Whether a fourth database role would be verified by anything. scripts/ci/rls-matrix.mjs:81-84 hard-codes three roles and iterates that array (:219, :302); I did not trace every other gate, so I cannot state that NO gate would see a fourth role — only that the RLS matrix would not. Settled by: grepping the full scripts/ci and tests/db surface for role enumeration, and adding a deliberate mutation (a fourth role with an over-broad grant) to see which gate goes red.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- The 20260717107000 migration header and the wave-b design describe the SAME line with opposite risk postures. The header's 'Security implications' block (:22-34) argues provisioning is safe because the function is SECURITY INVOKER and granted to no application role, and names 'tenant self-provisioning' as the abuse case — it says nothing about the `(p_spec ->> 'actor_id')` fallback at :121. wave-b-control-plane-design-v2.md:517-522 treats that same line as a named defect (C5): 'Leave the session principal empty and the request document becomes the authority on who acted.' Both are in this tree
- rate-limit.ts:159 states `public-probe` is 'The only policy an unauthenticated (public: true) operation may use', but neither health probe declares it — both declare `low-risk-metadata` (health/live:35, health/ready:49) and rely on `policyFor` to substitute. Read literally the comment is contradicted by every public operation in the repository; read as a statement about the ENFORCED policy it is true for the probes and false for the four `iam.auth-*` routes, which keep `auth-adjacent`. The doc sentence does not distinguish declared from enforced.
- docs/database/role-and-grant-standard.md:63-68 presents `postgres` as a role 'archetype' in the same table as the three migration-created roles, and :167 separately says the migrations create `app_runtime`, `app_readonly` (0002) and `app_worker` (Increment G). A reader asking 'how many roles do the migrations create' gets three from :167 and could read four from the table. The migrations themselves are unambiguous: three CREATE ROLE sites.
- The migration comment at 20260721094000:170 states that reason and correlation are 'captured from app.status_reason / app.correlation_id GUCs'. The first half is implemented; the second GUC is set by nothing in `apps/`. The comment describes an intended contract, not the shipped behaviour, and does not say which.
