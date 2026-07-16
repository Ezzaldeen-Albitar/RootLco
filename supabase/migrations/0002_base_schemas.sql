-- ============================================================================
-- Migration 0002 — module schemas, database roles, grant foundation, and the
-- transaction-scoped session-context contract (P1-02-DB-018, P1-02-SEC-002,
-- P1-02-SEC-003).
--
-- Phase 1-2 foundation ONLY. This migration creates NO business tables.
-- Domain tables (tenants, companies, branches, users, customers, vehicles,
-- appointments, inspections, quotations, work orders, inventory, invoices,
-- payments) belong to Phase 1-3 and later, after the Database Standards Gate.
--
-- Forward-only. Rollback classification: roll-forward-only (schemas and roles
-- become load-bearing the moment later migrations reference them).
-- Standards: docs/database/database-architecture.md,
--            docs/database/role-and-grant-standard.md,
--            docs/database/rls-standard.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Module schemas (modular monolith: one module, one schema; a module never
--    mutates another module's private tables directly — cross-module changes go
--    through controlled functions/services/documented interfaces).
--    `public` is NOT an application schema and must not accumulate objects.
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS org;    -- Organization structure module (tenants, companies, branches — tables arrive in Phase 1-3)
CREATE SCHEMA IF NOT EXISTS iam;    -- Identity and access module (context contract now; users/memberships arrive in Phase 1-4)
CREATE SCHEMA IF NOT EXISTS shared; -- Cross-module shared primitives ONLY (number sequences, future idempotency keys)
CREATE SCHEMA IF NOT EXISTS crm;    -- CRM module namespace (RESERVED — no tables before Phase 1-5 per plan)
CREATE SCHEMA IF NOT EXISTS veh;    -- Vehicle module namespace (RESERVED — no tables before its phase)

COMMENT ON SCHEMA org    IS 'Organization structure module. Owner: org module. Business tables arrive in Phase 1-3; none may exist in Phase 1-2.';
COMMENT ON SCHEMA iam    IS 'Identity and access module. Phase 1-2 holds only the transaction-scoped context helper functions; IAM tables arrive in Phase 1-4.';
COMMENT ON SCHEMA shared IS 'Cross-module shared primitives only (e.g. number sequences). A table belongs here only if no single module owns it.';
COMMENT ON SCHEMA crm    IS 'CRM module namespace. RESERVED in Phase 1-2 — intentionally empty.';
COMMENT ON SCHEMA veh    IS 'Vehicle module namespace. RESERVED in Phase 1-2 — intentionally empty.';

-- Harden `public`: it must not become an uncontrolled dumping ground.
-- (PostgreSQL 15+ already revokes CREATE from PUBLIC; made explicit so the
-- posture survives environment differences and is visible in review.)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. Database role archetypes (P1-02-SEC-003).
--
--    app_runtime  — the future runtime application role. NOT a superuser, does
--                   NOT own schemas or tables, has NO BYPASSRLS, cannot ALTER
--                   schemas/tables, cannot disable RLS. Receives only the
--                   narrow per-object grants each migration states explicitly.
--    app_readonly — read-only support/diagnostics role, same restrictions,
--                   SELECT-only grants.
--
--    Both are NOLOGIN archetypes: they are assumed via SET ROLE (tests) or
--    granted to a login role (later phases). Roles are cluster-wide, so
--    creation is guarded to keep the migration replayable.
--
--    Supabase-managed roles (postgres, authenticated, anon, service_role,
--    supabase_admin, …) are NOT modified here; their real, inspected
--    attributes and limits are documented in
--    docs/database/role-and-grant-standard.md.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

COMMENT ON ROLE app_runtime  IS 'Runtime application role archetype. Non-owner, no BYPASSRLS, no DDL. Every privilege is an explicit per-object grant. See docs/database/role-and-grant-standard.md.';
COMMENT ON ROLE app_readonly IS 'Read-only support role archetype. Non-owner, no BYPASSRLS, SELECT-only grants.';

-- Grant foundation: schema USAGE only. Table/function privileges are granted
-- per object by the migration that creates the object — never wholesale.
GRANT USAGE ON SCHEMA org, iam, shared, crm, veh TO app_runtime, app_readonly;

-- Deliberately ABSENT (default deny):
--   * no GRANT ALL anywhere;
--   * no ALTER DEFAULT PRIVILEGES blanket grants;
--   * no table privileges (none exist yet);
--   * no CREATE on any schema for either role.

-- ----------------------------------------------------------------------------
-- 3. Transaction-scoped session-context contract (P1-02-SEC-002).
--
--    The application sets, INSIDE a transaction, using transaction-local
--    set_config(..., true) semantics:
--
--      app.tenant_id    — single UUID       (required for tenant-scoped work)
--      app.company_ids  — comma-separated UUID list (optional narrowing)
--      app.branch_ids   — comma-separated UUID list (optional narrowing)
--      app.user_id      — single UUID       (actor attribution)
--
--    These values are resolved SERVER-SIDE from the authenticated session by
--    the application layer. Client-supplied tenant/company/branch identifiers
--    are validation inputs only and are NEVER written into this context —
--    knowledge of an ID never grants access (see docs/database/rls-standard.md).
--
--    The helpers below only READ that context. They are STABLE (same value for
--    every row in a statement), SECURITY INVOKER, and hardened with an empty
--    search_path. They contain no IAM business logic — membership tables and
--    context RESOLUTION are Phase 1-4 and are not implemented here.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION iam.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION iam.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION iam.allowed_company_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- NULL means "no company narrowing was set" (tenant scope only).
  -- An empty string is treated the same as unset.
  SELECT CASE
    WHEN NULLIF(current_setting('app.company_ids', true), '') IS NULL THEN NULL
    ELSE string_to_array(current_setting('app.company_ids', true), ',')::uuid[]
  END;
$$;

CREATE OR REPLACE FUNCTION iam.allowed_branch_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.branch_ids', true), '') IS NULL THEN NULL
    ELSE string_to_array(current_setting('app.branch_ids', true), ',')::uuid[]
  END;
$$;

COMMENT ON FUNCTION iam.current_tenant_id()   IS 'Reads app.tenant_id from the transaction-local context. NULL when unset — RLS policies comparing against NULL match no rows (default deny).';
COMMENT ON FUNCTION iam.current_user_id()     IS 'Reads app.user_id (actor attribution) from the transaction-local context.';
COMMENT ON FUNCTION iam.allowed_company_ids() IS 'Reads app.company_ids (comma-separated UUIDs). NULL = no company narrowing set.';
COMMENT ON FUNCTION iam.allowed_branch_ids()  IS 'Reads app.branch_ids (comma-separated UUIDs). NULL = no branch narrowing set.';

-- PostgreSQL grants EXECUTE on every new function to PUBLIC by default, which
-- would make any explicit grant below meaningless. Revoke the default first —
-- privileges on these functions exist ONLY as the explicit grants that follow.
REVOKE EXECUTE ON FUNCTION
  iam.current_tenant_id(),
  iam.current_user_id(),
  iam.allowed_company_ids(),
  iam.allowed_branch_ids()
FROM PUBLIC;

-- Context readers expose only what the session itself set; they are granted to
-- the application archetypes and to nothing else.
GRANT EXECUTE ON FUNCTION
  iam.current_tenant_id(),
  iam.current_user_id(),
  iam.allowed_company_ids(),
  iam.allowed_branch_ids()
TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 4. Shared row-metadata trigger (base metadata standard, P1-02-DB-006).
--    Reusable BEFORE UPDATE trigger: stamps updated_at/updated_by and advances
--    record_version deterministically (always OLD.record_version + 1, so a
--    caller cannot skip or replay versions). Attached per table by the
--    migration that creates the table.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.touch_row_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := iam.current_user_id();
  NEW.record_version := OLD.record_version + 1;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.touch_row_metadata() IS 'BEFORE UPDATE trigger: sets updated_at/updated_by and advances record_version by exactly 1. Part of the base metadata standard (docs/database/database-architecture.md).';

-- Trigger functions are invoked by triggers, not by callers: no role needs (or
-- receives) EXECUTE. Revoke the PostgreSQL PUBLIC default so that stays true.
REVOKE EXECUTE ON FUNCTION shared.touch_row_metadata() FROM PUBLIC;
