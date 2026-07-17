-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: idempotency keys and atomic organization provisioning
-- Tasks: P1-03-DB-020, P1-03-DB-022 (and the Phase 1-2 deferred
--        shared.idempotency_keys pattern, promoted to a real table)
-- Owner module: shared (idempotency) / org (provisioning)
--
-- Purpose
--   One transaction that provisions a complete organization — tenant,
--   subscription, legal company, pilot branch, settings, feature overrides,
--   number-sequence configuration — with the Phase 1-2 idempotency pattern:
--   a failure at ANY step rolls back EVERYTHING including the idempotency
--   record; a retry of the same key+request returns the original result and
--   creates nothing; the same key with a conflicting request fails loudly.
--
-- Dependency
--   Every previous Phase 1-3 migration (the full hierarchy + FKs).
--
-- Rollback classification: ROLLBACK-SAFE while unused; the idempotency table
--   becomes evidence (roll-forward-only) once real provisioning has run.
--
-- Security implications
--   * Provisioning is a PLATFORM operation: org.provision_organization() is
--     SECURITY INVOKER and is granted to NO application role — a runtime
--     session lacks the underlying INSERT grants on org.tenants et al., so
--     both layers deny (abuse case: tenant self-provisioning).
--   * shared.idempotency_keys has RLS enabled AND forced with NO policies and
--     NO application grants: only BYPASSRLS platform connections touch it.
--   * The function contains NO tenant-specific logic: the pilot tenant is
--     pure DATA in a controlled seed package. Removing that package leaves no
--     schema or function trace (asserted by test and CI guard).
--   * request_fingerprint is md5 of the canonical jsonb text — collision
--     resistance is not a security property here, only accidental-reuse
--     detection; the key row, not the hash, is the authority.
--
-- Adaptation of the pinned Phase 1-2 idempotency pattern (documented):
--   the fixture pattern scoped keys by (tenant_id, key). Provisioning runs
--   BEFORE its tenant exists, so tenant_id is nullable here and the unique
--   scope is (tenant_id, operation, idempotency_key) with NULLS NOT DISTINCT
--   — platform-scope keys collide platform-wide, tenant-scope keys stay
--   per-tenant. Everything else (fingerprint match/conflict, response
--   snapshot, expiry-as-data) is the pattern unchanged.
--
-- Objects created
--   Tables:    shared.idempotency_keys
--   Functions: org.provision_organization()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.idempotency_keys — the Phase 1-2 pattern as a permanent table.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.idempotency_keys (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NULL,
  operation           text        NOT NULL,
  idempotency_key     text        NOT NULL,
  request_fingerprint text        NOT NULL,
  response_document   jsonb       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  expires_at          timestamptz NULL,

  CONSTRAINT pk_idempotency_keys PRIMARY KEY (id),
  CONSTRAINT fk_idempotency_keys_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT uq_idempotency_keys_scope
    UNIQUE NULLS NOT DISTINCT (tenant_id, operation, idempotency_key),
  CONSTRAINT ck_idempotency_keys_operation_format CHECK (operation ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_idempotency_keys_key_length
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 200)
);

COMMENT ON TABLE shared.idempotency_keys IS
  'Idempotency records (Phase 1-2 pattern promoted by P1-03-DB-022). A key row is written IN THE SAME TRANSACTION as the operation it records, so only completed operations ever own a key — failures roll the key back too. Same key + same fingerprint replays the stored response; same key + different fingerprint is a conflict. tenant_id is NULL for platform-scope operations (see the adaptation note in the migration header). expires_at is data; cleanup is a controlled retention job, never ad-hoc deletion. NO application role holds any grant or policy here.';

ALTER TABLE shared.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.idempotency_keys FORCE ROW LEVEL SECURITY;
-- No policies and no grants: platform connections only, denied twice for
-- every application role.

-- ----------------------------------------------------------------------------
-- 2. Atomic organization provisioning (P1-03-DB-022).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.provision_organization(
  p_spec            jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_fingerprint     text;
  v_existing        shared.idempotency_keys%ROWTYPE;
  v_actor           uuid;
  v_tenant_id       uuid;
  v_plan_id         uuid;
  v_subscription_id uuid;
  v_company_id      uuid;
  v_branch_id       uuid;
  v_item            jsonb;
  v_response        jsonb;
BEGIN
  -- ---- Idempotency gate -----------------------------------------------------
  v_fingerprint := md5(p_spec::text);
  SELECT * INTO v_existing
  FROM shared.idempotency_keys
  WHERE tenant_id IS NULL
    AND operation = 'org_provisioning'
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint = v_fingerprint THEN
      RETURN v_existing.response_document;      -- safe replay, creates nothing
    END IF;
    RAISE EXCEPTION 'idempotency key % was already used with a DIFFERENT request', p_idempotency_key
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- ---- Validation (explicit, before any write) ------------------------------
  v_actor := COALESCE(iam.current_user_id(), (p_spec ->> 'actor_id')::uuid);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'provisioning requires an actor (session context or spec.actor_id)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_spec -> 'tenant' IS NULL OR p_spec -> 'company' IS NULL OR p_spec -> 'branch' IS NULL THEN
    RAISE EXCEPTION 'provisioning spec must contain tenant, company and branch documents'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---- 1/7 tenant (+ initial history row) -----------------------------------
  INSERT INTO org.tenants (tenant_code, display_name, default_locale, default_timezone, created_by)
  VALUES (
    p_spec -> 'tenant' ->> 'code',
    p_spec -> 'tenant' ->> 'display_name',
    p_spec -> 'tenant' ->> 'locale',
    p_spec -> 'tenant' ->> 'timezone',
    v_actor
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO org.tenant_status_history (tenant_id, from_state, to_state, reason, actor_id)
  VALUES (v_tenant_id, NULL, 'provisioning', 'organization provisioning started', v_actor);

  -- ---- 2/7 subscription -----------------------------------------------------
  IF p_spec -> 'subscription' IS NOT NULL THEN
    SELECT p.id INTO v_plan_id
    FROM org.subscription_plans p
    WHERE p.plan_code = p_spec -> 'subscription' ->> 'plan_code'
      AND p.status = 'active'
      AND tstzrange(p.effective_from, p.effective_to, '[)')
          @> COALESCE((p_spec -> 'subscription' ->> 'effective_from')::timestamptz, now());
    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'no active plan version % covers the requested start',
        p_spec -> 'subscription' ->> 'plan_code'
        USING ERRCODE = 'no_data_found';
    END IF;
    INSERT INTO org.tenant_subscriptions
      (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
    VALUES (
      v_tenant_id,
      v_plan_id,
      COALESCE(p_spec -> 'subscription' ->> 'status', 'draft'),
      COALESCE((p_spec -> 'subscription' ->> 'effective_from')::timestamptz, now()),
      v_actor,
      v_actor
    )
    RETURNING id INTO v_subscription_id;
  END IF;

  -- ---- 3/7 legal company ----------------------------------------------------
  INSERT INTO org.legal_companies
    (tenant_id, company_code, legal_name, base_currency_code,
     registration_number, tax_registration_number, created_by)
  VALUES (
    v_tenant_id,
    p_spec -> 'company' ->> 'code',
    p_spec -> 'company' ->> 'legal_name',
    p_spec -> 'company' ->> 'base_currency',
    p_spec -> 'company' ->> 'registration_number',
    p_spec -> 'company' ->> 'tax_registration_number',
    v_actor
  )
  RETURNING id INTO v_company_id;

  -- ---- 4/7 pilot branch -----------------------------------------------------
  INSERT INTO org.branches
    (tenant_id, company_id, branch_code, name, timezone_name, country_code, city, created_by)
  VALUES (
    v_tenant_id,
    v_company_id,
    p_spec -> 'branch' ->> 'code',
    p_spec -> 'branch' ->> 'name',
    p_spec -> 'branch' ->> 'timezone',
    p_spec -> 'branch' ->> 'country_code',
    p_spec -> 'branch' ->> 'city',
    v_actor
  )
  RETURNING id INTO v_branch_id;

  -- ---- 5/7 settings ---------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_spec -> 'settings' -> 'company', '[]'::jsonb))
  LOOP
    INSERT INTO org.company_settings
      (tenant_id, company_id, setting_key, setting_value, value_type, is_sensitive, version, created_by)
    VALUES (
      v_tenant_id, v_company_id,
      v_item ->> 'key', v_item -> 'value', v_item ->> 'value_type',
      COALESCE((v_item ->> 'is_sensitive')::boolean, false), 1, v_actor
    );
  END LOOP;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_spec -> 'settings' -> 'branch', '[]'::jsonb))
  LOOP
    INSERT INTO org.branch_settings
      (tenant_id, company_id, branch_id, setting_key, setting_value, value_type, is_sensitive, version, created_by)
    VALUES (
      v_tenant_id, v_company_id, v_branch_id,
      v_item ->> 'key', v_item -> 'value', v_item ->> 'value_type',
      COALESCE((v_item ->> 'is_sensitive')::boolean, false), 1, v_actor
    );
  END LOOP;

  -- ---- 6/7 feature overrides ------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_spec -> 'feature_overrides', '[]'::jsonb))
  LOOP
    INSERT INTO org.tenant_feature_overrides
      (tenant_id, flag_code, enabled, reason, effective_from, effective_to, created_by)
    VALUES (
      v_tenant_id,
      v_item ->> 'flag_code',
      (v_item ->> 'enabled')::boolean,
      v_item ->> 'reason',
      COALESCE((v_item ->> 'effective_from')::timestamptz, now()),
      (v_item ->> 'effective_to')::timestamptz,
      v_actor
    );
  END LOOP;

  -- ---- 7/7 number-sequence configuration ------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_spec -> 'sequences', '[]'::jsonb))
  LOOP
    INSERT INTO shared.number_sequences
      (tenant_id, sequence_code, prefix_template, pad_width, period_reset_rule, created_by)
    VALUES (
      v_tenant_id,
      v_item ->> 'code',
      COALESCE(v_item ->> 'prefix_template', ''),
      COALESCE((v_item ->> 'pad_width')::integer, 6),
      COALESCE(v_item ->> 'period_reset_rule', 'never'),
      v_actor
    );
  END LOOP;

  -- ---- optional activation --------------------------------------------------
  IF COALESCE((p_spec -> 'tenant' ->> 'activate')::boolean, false) THEN
    PERFORM org.change_tenant_status(
      v_tenant_id, 'active',
      COALESCE(p_spec -> 'tenant' ->> 'activation_reason', 'activated at provisioning'),
      v_actor
    );
  END IF;

  -- ---- idempotency record: SAME transaction as everything above -------------
  v_response := jsonb_build_object(
    'tenant_id', v_tenant_id,
    'subscription_id', v_subscription_id,
    'company_id', v_company_id,
    'branch_id', v_branch_id
  );
  INSERT INTO shared.idempotency_keys
    (tenant_id, operation, idempotency_key, request_fingerprint, response_document, created_by)
  VALUES (NULL, 'org_provisioning', p_idempotency_key, v_fingerprint, v_response, v_actor);

  RETURN v_response;
END;
$$;

COMMENT ON FUNCTION org.provision_organization(jsonb, text) IS
  'Atomic organization provisioning (P1-03-DB-022): tenant + history + subscription + company + branch + settings + overrides + sequences + idempotency record in ONE transaction. A failure at any step rolls back everything INCLUDING the idempotency row, so no partially provisioned tenant can exist and a corrected retry starts clean. Same key + same fingerprint replays the stored response and creates nothing; same key + different fingerprint raises integrity_constraint_violation. SECURITY INVOKER, granted to no application role: provisioning is a platform operation (controlled seed packages and, later, the Phase 1-14 backend). Contains ZERO tenant-specific logic — pilot data lives only in its controlled seed package.';

REVOKE EXECUTE ON FUNCTION org.provision_organization(jsonb, text) FROM PUBLIC;
-- Deliberately granted to no application role.
