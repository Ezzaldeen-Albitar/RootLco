-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: platform feature definitions, subscription plans, tenant
--            subscriptions, and point-in-time plan resolution
-- Tasks: P1-03-DB-003, P1-03-DB-004, P1-03-DB-015 (platform definitions only —
--        tenant overrides arrive with the settings migration)
-- Owner module: org
--
-- Purpose
--   The subscription foundation: platform-level feature definitions, versioned
--   effective-dated subscription plans whose entitlement documents are
--   validated against the feature register, and per-tenant subscription
--   assignments with non-overlapping effective intervals and deterministic
--   point-in-time resolution.
--
-- Dependency
--   20260717101000_org_tenants.sql (org.tenants, org.guard_immutable_columns)
--   and 0001 (btree_gist for the EXCLUDE constraints).
--
-- Rollback classification: ROLLBACK-SAFE while no subscription row exists;
--   roll-forward-only once a tenant subscription is assigned (dropping plan or
--   assignment history destroys entitlement evidence).
--
-- Security implications
--   * org.feature_flags and org.subscription_plans are PLATFORM tables: no
--     application role holds any write grant or write policy (denied twice).
--     Tenants cannot modify platform definitions — abuse case "feature-flag
--     override abuse"/"platform-table modification" is closed at both layers.
--   * Draft plans are administrative data and are NOT visible to application
--     roles: the SELECT policy exposes only non-draft plans. A tenant sees the
--     catalogue it can be subscribed to, never work-in-progress.
--   * org.tenant_subscriptions is tenant-owned: SELECT is tenant-scoped via
--     the server-resolved context; no write grant/policy exists for
--     application roles (assignment is a platform operation in this phase).
--   * No billing, charging, or pricing implementation exists here. Plans
--     carry entitlements and capacity documents only.
--
-- JSONB justification (documented per P1-03-DB-003)
--   entitlement_document and capacity_limits are jsonb because they are
--   OPEN-SCHEMA platform configuration: the set of feature codes grows with
--   the product, and modelling one column (or one row) per feature would
--   force a migration for every new feature. The trade-off (no per-key SQL
--   typing) is contained by a validation trigger that enforces: object shape,
--   every entitlement key exists in org.feature_flags, every entitlement
--   value is boolean, and every capacity value is a non-negative number.
--   These documents are read whole at resolution time — no per-key indexing
--   need exists in this phase, so no GIN index is created (indexes are added
--   when a real query path needs them, per the index standard).
--
-- Objects created
--   Tables:    org.feature_flags, org.subscription_plans,
--              org.tenant_subscriptions
--   Functions: org.validate_plan_documents(),
--              org.current_subscription_plan_id()
--   Triggers:  tg_feature_flags_touch_metadata, tg_feature_flags_immutable,
--              tg_subscription_plans_touch_metadata,
--              tg_subscription_plans_immutable,
--              tg_subscription_plans_validate_documents,
--              tg_tenant_subscriptions_touch_metadata,
--              tg_tenant_subscriptions_immutable
--   Policies:  sel_feature_flags_all, sel_subscription_plans_published,
--              sel_tenant_subscriptions_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. org.feature_flags — platform feature definitions (P1-03-DB-015).
-- ----------------------------------------------------------------------------
CREATE TABLE org.feature_flags (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  flag_code       text        NOT NULL,
  name            text        NOT NULL,
  description     text        NULL,
  default_enabled boolean     NOT NULL DEFAULT false,
  status          text        NOT NULL DEFAULT 'active',
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,

  CONSTRAINT pk_feature_flags PRIMARY KEY (id),
  CONSTRAINT uq_feature_flags_flag_code UNIQUE (flag_code),
  CONSTRAINT ck_feature_flags_code_format CHECK (flag_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_feature_flags_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_feature_flags_status CHECK (status IN ('active', 'deprecated'))
);

COMMENT ON TABLE org.feature_flags IS
  'PLATFORM feature definitions (P1-03-DB-015). Not tenant-owned — no tenant_id by design (platform-global register, documented exception to the tenant-column rule). Tenants read definitions but can never modify them (no write grant, no write policy). Tenant-specific behaviour is expressed via org.tenant_feature_overrides, never by editing the definition. No frontend toggle implementation exists in this phase.';
COMMENT ON COLUMN org.feature_flags.default_enabled IS
  'Platform default when neither the tenant''s plan entitlement nor a tenant override says otherwise. Resolution precedence (override > plan entitlement > this default) is implemented with the overrides table in the settings migration.';

CREATE TRIGGER tg_feature_flags_touch_metadata
  BEFORE UPDATE ON org.feature_flags
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_feature_flags_immutable
  BEFORE UPDATE ON org.feature_flags
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('flag_code');

-- ----------------------------------------------------------------------------
-- 2. org.subscription_plans — versioned, effective-dated (P1-03-DB-003).
-- ----------------------------------------------------------------------------
CREATE TABLE org.subscription_plans (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  plan_code            text        NOT NULL,
  name                 text        NOT NULL,
  description          text        NULL,
  entitlement_document jsonb       NOT NULL DEFAULT '{}'::jsonb,
  capacity_limits      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status               text        NOT NULL DEFAULT 'draft',
  effective_from       timestamptz NOT NULL,
  effective_to         timestamptz NULL,
  record_version       integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NULL,
  updated_by           uuid        NULL,

  CONSTRAINT pk_subscription_plans PRIMARY KEY (id),
  CONSTRAINT ck_subscription_plans_code_format CHECK (plan_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_subscription_plans_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_subscription_plans_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT ck_subscription_plans_effective_interval
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Overlapping ACTIVE versions of the same plan_code are rejected. Draft and
  -- retired versions may coexist freely (drafting the next version while the
  -- current one runs is the normal workflow).
  CONSTRAINT ex_subscription_plans_no_active_overlap
    EXCLUDE USING gist (
      plan_code WITH =,
      tstzrange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (status = 'active')
);

COMMENT ON TABLE org.subscription_plans IS
  'PLATFORM subscription-plan versions (P1-03-DB-003). Not tenant-owned — no tenant_id by design (platform catalogue, documented exception). Effective-dated: one plan_code may have many versions, but active versions may not overlap (EXCLUDE, btree_gist). Entitlement and capacity documents are jsonb validated against org.feature_flags by trigger — see the migration header for the JSONB justification. Draft versions are administrative data hidden from application roles. NO billing, charging, or production pricing exists or is implied.';

CREATE TRIGGER tg_subscription_plans_touch_metadata
  BEFORE UPDATE ON org.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_subscription_plans_immutable
  BEFORE UPDATE ON org.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('plan_code');

-- Entitlement/capacity validation: real, enforced, tested.
CREATE OR REPLACE FUNCTION org.validate_plan_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_key   text;
  v_type  text;
BEGIN
  IF jsonb_typeof(NEW.entitlement_document) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'subscription_plans.entitlement_document must be a JSON object'
      USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(NEW.capacity_limits) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'subscription_plans.capacity_limits must be a JSON object'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_key, v_type IN
    SELECT key, jsonb_typeof(value) FROM jsonb_each(NEW.entitlement_document)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM org.feature_flags f WHERE f.flag_code = v_key) THEN
      RAISE EXCEPTION 'entitlement key % is not a registered feature flag', v_key
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_type IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'entitlement value for % must be boolean, got %', v_key, v_type
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOR v_key, v_type IN
    SELECT key, jsonb_typeof(value) FROM jsonb_each(NEW.capacity_limits)
  LOOP
    IF v_type IS DISTINCT FROM 'number'
       OR (NEW.capacity_limits ->> v_key)::numeric < 0 THEN
      RAISE EXCEPTION 'capacity limit % must be a non-negative number', v_key
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.validate_plan_documents() IS
  'BEFORE INSERT/UPDATE trigger on org.subscription_plans: entitlement_document must be an object whose keys are registered flag_codes and whose values are booleans; capacity_limits must be an object of non-negative numbers. The containment for the open-schema jsonb trade-off (P1-03-DB-003).';

REVOKE EXECUTE ON FUNCTION org.validate_plan_documents() FROM PUBLIC;

CREATE TRIGGER tg_subscription_plans_validate_documents
  BEFORE INSERT OR UPDATE ON org.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION org.validate_plan_documents();

-- ----------------------------------------------------------------------------
-- 3. org.tenant_subscriptions — assignment history (P1-03-DB-004).
-- ----------------------------------------------------------------------------
CREATE TABLE org.tenant_subscriptions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  plan_id        uuid        NOT NULL,
  status         text        NOT NULL DEFAULT 'draft',
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz NULL,
  assigned_by    uuid        NOT NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_tenant_subscriptions PRIMARY KEY (id),
  CONSTRAINT fk_tenant_subscriptions_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_subscriptions_plan
    FOREIGN KEY (plan_id) REFERENCES org.subscription_plans (id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_subscriptions_status
    CHECK (status IN ('draft', 'active', 'cancelled', 'expired')),
  CONSTRAINT ck_tenant_subscriptions_effective_interval
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Exactly one ACTIVE assignment resolvable at any instant per tenant.
  CONSTRAINT ex_tenant_subscriptions_no_active_overlap
    EXCLUDE USING gist (
      tenant_id WITH =,
      tstzrange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (status = 'active')
);

COMMENT ON TABLE org.tenant_subscriptions IS
  'Per-tenant subscription assignments (P1-03-DB-004). Tenant-owned (tenant_id NOT NULL, RLS forced, tenant-scoped SELECT). Assignment HISTORY is preserved: prior assignments are never overwritten — a change is a new row, an ending is effective_to/status, never a DELETE. Active assignments cannot overlap per tenant (EXCLUDE), which is what makes point-in-time resolution deterministic. Assignment is a platform operation in this phase: application roles hold no write grant and no write policy. No billing logic exists.';

CREATE INDEX ix_tenant_subscriptions_tenant_id_effective_from
  ON org.tenant_subscriptions (tenant_id, effective_from);
CREATE INDEX ix_tenant_subscriptions_plan_id
  ON org.tenant_subscriptions (plan_id);

CREATE TRIGGER tg_tenant_subscriptions_touch_metadata
  BEFORE UPDATE ON org.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_tenant_subscriptions_immutable
  BEFORE UPDATE ON org.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'plan_id');

-- ----------------------------------------------------------------------------
-- 4. Deterministic point-in-time plan resolution (P1-03-DB-004).
--    SECURITY INVOKER + STABLE: runs with the caller's RLS, so a tenant can
--    only ever resolve its own subscription. The EXCLUDE constraint guarantees
--    at most one active assignment covers any instant — resolution is
--    deterministic by construction, not by ORDER BY luck.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.current_subscription_plan_id(
  p_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT s.plan_id
  FROM org.tenant_subscriptions s
  WHERE s.tenant_id = iam.current_tenant_id()
    AND s.status = 'active'
    AND tstzrange(s.effective_from, s.effective_to, '[)') @> p_at;
$$;

COMMENT ON FUNCTION org.current_subscription_plan_id(timestamptz) IS
  'Resolves the tenant''s active plan at an instant (P1-03-DB-004). Tenant comes ONLY from the server-resolved context; NULL context resolves nothing. At most one row can match (EXCLUDE constraint), so the result is deterministic. Returns NULL when no active assignment covers the instant.';

REVOKE EXECUTE ON FUNCTION org.current_subscription_plan_id(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.current_subscription_plan_id(timestamptz)
  TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security — enabled AND forced on all three.
-- ----------------------------------------------------------------------------
ALTER TABLE org.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.feature_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE org.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.subscription_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE org.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.tenant_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_feature_flags_all ON org.feature_flags
  FOR SELECT TO app_runtime, app_readonly
  USING (true);

-- Draft plans are administrative work-in-progress: not exposed.
CREATE POLICY sel_subscription_plans_published ON org.subscription_plans
  FOR SELECT TO app_runtime, app_readonly
  USING (status <> 'draft');

CREATE POLICY sel_tenant_subscriptions_tenant ON org.tenant_subscriptions
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_subscription_plans_published ON org.subscription_plans IS
  'Application roles see only non-draft plan versions. Draft versions are platform administrative data (P1-03-DB-003 / abuse case: platform-table exposure).';

-- ----------------------------------------------------------------------------
-- 6. Grants — SELECT only. All writes are platform operations in this phase.
-- ----------------------------------------------------------------------------
GRANT SELECT ON org.feature_flags TO app_runtime, app_readonly;
GRANT SELECT ON org.subscription_plans TO app_runtime, app_readonly;
GRANT SELECT ON org.tenant_subscriptions TO app_runtime, app_readonly;
