-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: consumer processing claims and durable sanitized error records
-- Tasks: P1-05-DB-012, P1-05-DB-013, P1-05-SEC-003 (remainder)
-- Owner module: shared
--
-- Purpose
--   processed_events is the append-only atomic-claim registry used by event
--   consumers to ensure a side effect is performed at most once. error_records
--   persists sanitized operational failures, including failures that occur
--   before tenant context is known, and provides a guarded triage lifecycle.
--
-- Dependencies
--   Phase 1-3 org.tenants / org.legal_companies / org.branches, Phase 1-4
--   iam.current_user_id(), shared.touch_row_metadata(), and
--   org.guard_immutable_columns(), plus the app_worker archetype introduced by
--   migration 20260718106000.
--
-- Rollback classification: ROLLBACK-SAFE while both tables are empty;
--   roll-forward-only once populated because processed claims prevent duplicate
--   side effects and error rows are durable operational evidence.
--
-- Security implications
--   * app_worker is reused unchanged. It receives only SELECT/INSERT on
--     processed_events and SELECT/INSERT/UPDATE on error_records. DELETE is
--     absent on both; app_runtime/app_readonly receive no grant or policy.
--   * Both tables FORCE RLS. Their wkr_* policies deliberately span all tenants
--     for the constrained infrastructure worker and do not grant BYPASSRLS.
--   * processed_events is append-only. A failed claim remains claimed and blocks
--     reprocessing; operator intervention is deliberately deferred to a later
--     phase.
--   * error context must be a JSON object. A recursive trigger rejects sensitive
--     keys at any nesting depth and JWT/AWS-access-key-shaped string values.
--   * Error identity/context is immutable after INSERT. Only the guarded status
--     and resolution fields are caller-mutable; metadata is server-maintained.
--
-- Objects created
--   Tables:    shared.processed_events, shared.error_records
--   Functions: shared.guard_error_context_sanitized(),
--              shared.guard_error_record_lifecycle()
--   Triggers:  tg_error_records_context_sanitized,
--              tg_error_records_guard_lifecycle,
--              tg_error_records_immutable,
--              tg_error_records_touch_metadata
--   Policies:  wkr_processed_events_all, wkr_error_records_all
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.processed_events — append-only consumer atomic-claim registry.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.processed_events (
  consumer_code text        NOT NULL,
  event_id      uuid        NOT NULL,
  tenant_id     uuid        NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  outcome       text        NOT NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,

  CONSTRAINT pk_processed_events PRIMARY KEY (consumer_code, event_id),
  CONSTRAINT fk_processed_events_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_processed_events_consumer_code_format
    CHECK (consumer_code ~ '^[a-z][a-z0-9_.]{1,62}$'),
  CONSTRAINT ck_processed_events_outcome
    CHECK (outcome IN ('applied', 'skipped', 'failed')),
  CONSTRAINT ck_processed_events_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE shared.processed_events IS
  'Append-only event-consumer atomic-claim registry. The consumer MUST claim with INSERT ... ON CONFLICT DO NOTHING RETURNING and perform the side effect ONLY when that statement returns a row. tenant_id is nullable BY DESIGN because platform consumers process platform-scope work. This is DISTINCT from shared.idempotency_keys: processed_events prevents repeated consumer side effects, while idempotency_keys supports request-response replay; their purposes do not duplicate. An outcome of failed still owns the claim and blocks reprocessing; operator intervention is a later-phase concern.';
COMMENT ON COLUMN shared.processed_events.consumer_code IS
  'Stable machine-readable identity of the independently idempotent consumer.';
COMMENT ON COLUMN shared.processed_events.event_id IS
  'Opaque event identity claimed exactly once for this consumer_code.';
COMMENT ON COLUMN shared.processed_events.tenant_id IS
  'Nullable BY DESIGN: platform consumers may claim platform-scope work that has no tenant.';
COMMENT ON COLUMN shared.processed_events.outcome IS
  'applied | skipped | failed. Every value is terminal for this claim; failed blocks automatic reprocessing.';
COMMENT ON COLUMN shared.processed_events.metadata IS
  'Non-secret consumer result metadata, constrained to a JSON object.';

CREATE INDEX ix_processed_events_tenant
  ON shared.processed_events (tenant_id);

-- ----------------------------------------------------------------------------
-- 2. shared.error_records — durable sanitized operational-error evidence.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.error_records (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NULL,
  company_id     uuid        NULL,
  branch_id      uuid        NULL,
  error_code     text        NOT NULL,
  source         text        NOT NULL,
  operation      text        NOT NULL,
  severity       text        NOT NULL,
  retryable      boolean     NOT NULL,
  correlation_id uuid        NULL,
  context        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'open',
  resolved_at    timestamptz NULL,
  resolved_by    uuid        NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_error_records PRIMARY KEY (id),
  CONSTRAINT fk_error_records_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_error_records_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_error_records_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_error_records_platform_scope
    CHECK (tenant_id IS NOT NULL OR (company_id IS NULL AND branch_id IS NULL)),
  CONSTRAINT ck_error_records_branch_requires_company
    CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT ck_error_records_error_code_format
    CHECK (error_code ~ '^[a-z][a-z0-9_.]{1,62}$'),
  CONSTRAINT ck_error_records_source_format
    CHECK (source ~ '^[a-z][a-z0-9_.]{1,62}$'),
  CONSTRAINT ck_error_records_operation_not_blank CHECK (btrim(operation) <> ''),
  CONSTRAINT ck_error_records_severity
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT ck_error_records_context_object CHECK (jsonb_typeof(context) = 'object'),
  CONSTRAINT ck_error_records_status
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  CONSTRAINT ck_error_records_resolution_pair CHECK (
    (status = 'resolved') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

COMMENT ON TABLE shared.error_records IS
  'Durable sanitized operational-error record. tenant_id is nullable BY DESIGN for errors raised before tenant context exists; company/branch scope is therefore forbidden when tenant_id is NULL. app_worker has deliberate all-tenant SELECT/INSERT/UPDATE for triage, while runtime/readonly have no access. Rows start open, may move open→acknowledged→resolved or open→resolved, and resolved is terminal.';
COMMENT ON COLUMN shared.error_records.tenant_id IS
  'Nullable BY DESIGN for failures raised before a tenant context can be established.';
COMMENT ON COLUMN shared.error_records.operation IS
  'Non-blank human-readable operation description; it must not contain credentials or raw secret material.';
COMMENT ON COLUMN shared.error_records.context IS
  'Sanitized JSON-object diagnostic context. Sensitive key names and JWT/AWS-key-shaped string values are rejected recursively.';
COMMENT ON COLUMN shared.error_records.resolved_by IS
  'Resolver attribution. Deliberately a plain UUID with no composite user FK because error_records may have tenant_id NULL before tenant context exists; indexed for attribution queries.';

-- Every FK has a non-partial leading-column cover. tenant/status is also the
-- required triage path; resolved_by is indexed despite deliberately having no FK.
CREATE INDEX ix_error_records_tenant_status
  ON shared.error_records (tenant_id, status);
CREATE INDEX ix_error_records_company
  ON shared.error_records (tenant_id, company_id);
CREATE INDEX ix_error_records_branch
  ON shared.error_records (tenant_id, company_id, branch_id);
CREATE INDEX ix_error_records_resolved_by
  ON shared.error_records (resolved_by);

-- ----------------------------------------------------------------------------
-- 3. Error context and lifecycle guards. Functions precede their triggers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_error_context_sanitized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_bad_key text;
  v_bad_value text;
BEGIN
  WITH RECURSIVE json_nodes(key_name, node_value) AS (
    VALUES (NULL::text, NEW.context)
    UNION ALL
    SELECT child.key_name, child.node_value
    FROM json_nodes AS parent
    CROSS JOIN LATERAL (
      SELECT object_item.key AS key_name, object_item.value AS node_value
      FROM jsonb_each(
        CASE
          WHEN jsonb_typeof(parent.node_value) = 'object' THEN parent.node_value
          ELSE '{}'::jsonb
        END
      ) AS object_item
      UNION ALL
      SELECT NULL::text, array_item.value
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(parent.node_value) = 'array' THEN parent.node_value
          ELSE '[]'::jsonb
        END
      ) AS array_item
    ) AS child
  )
  SELECT key_name
    INTO v_bad_key
  FROM json_nodes
  WHERE key_name ~* '(password|passwd|secret|token|authorization|api_key|apikey|private_key|credential|cookie|session)'
  LIMIT 1;

  IF v_bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'error context contains forbidden sensitive key: %', v_bad_key
      USING ERRCODE = 'check_violation';
  END IF;

  WITH RECURSIVE json_nodes(node_value) AS (
    VALUES (NEW.context)
    UNION ALL
    SELECT child.node_value
    FROM json_nodes AS parent
    CROSS JOIN LATERAL (
      SELECT object_item.value AS node_value
      FROM jsonb_each(
        CASE
          WHEN jsonb_typeof(parent.node_value) = 'object' THEN parent.node_value
          ELSE '{}'::jsonb
        END
      ) AS object_item
      UNION ALL
      SELECT array_item.value
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(parent.node_value) = 'array' THEN parent.node_value
          ELSE '[]'::jsonb
        END
      ) AS array_item
    ) AS child
  )
  SELECT node_value #>> '{}'
    INTO v_bad_value
  FROM json_nodes
  WHERE jsonb_typeof(node_value) = 'string'
    AND (
      (node_value #>> '{}') ~ 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
      OR (node_value #>> '{}') ~ 'AKIA[0-9A-Z]{16}'
    )
  LIMIT 1;

  IF v_bad_value IS NOT NULL THEN
    RAISE EXCEPTION 'error context contains a credential-shaped string value'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_error_context_sanitized() IS
  'BEFORE INSERT OR UPDATE recursive JSON guard for shared.error_records. Rejects sensitive key names at every object depth, including objects nested in arrays, and rejects string values containing JWT/AWS-access-key-shaped substrings (SQLSTATE 23514).';

REVOKE EXECUTE ON FUNCTION shared.guard_error_context_sanitized() FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.guard_error_record_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open'
       OR NEW.resolved_at IS NOT NULL
       OR NEW.resolved_by IS NOT NULL THEN
      RAISE EXCEPTION 'error record must start open with NULL resolution stamps'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'resolved error record is terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = OLD.status THEN
    IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by THEN
      RAISE EXCEPTION 'resolution fields may change only when resolving an error record'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
    RAISE EXCEPTION 'resolved_at is server-controlled'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'open' AND NEW.status = 'acknowledged' THEN
    IF NEW.resolved_by IS DISTINCT FROM OLD.resolved_by THEN
      RAISE EXCEPTION 'acknowledging an error record cannot set resolved_by'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status IN ('open', 'acknowledged') AND NEW.status = 'resolved' THEN
    IF NEW.resolved_by IS NULL THEN
      RAISE EXCEPTION 'resolving an error record requires resolved_by'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.resolved_at := now();
  ELSE
    RAISE EXCEPTION 'invalid error record transition: % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_error_record_lifecycle() IS
  'Combined BEFORE INSERT/UPDATE lifecycle guard. INSERT requires open with NULL resolution stamps. UPDATE permits open→acknowledged→resolved and open→resolved, requires resolved_by, server-stamps resolved_at, and makes resolved terminal.';

REVOKE EXECUTE ON FUNCTION shared.guard_error_record_lifecycle() FROM PUBLIC;

CREATE TRIGGER tg_error_records_context_sanitized
  BEFORE INSERT OR UPDATE ON shared.error_records
  FOR EACH ROW EXECUTE FUNCTION shared.guard_error_context_sanitized();
CREATE TRIGGER tg_error_records_guard_lifecycle
  BEFORE INSERT OR UPDATE ON shared.error_records
  FOR EACH ROW EXECUTE FUNCTION shared.guard_error_record_lifecycle();
CREATE TRIGGER tg_error_records_immutable
  BEFORE UPDATE ON shared.error_records
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'id', 'tenant_id', 'company_id', 'branch_id', 'error_code', 'source',
    'operation', 'severity', 'retryable', 'correlation_id', 'context',
    'occurred_at', 'record_version', 'created_at', 'created_by', 'updated_at',
    'updated_by');
CREATE TRIGGER tg_error_records_touch_metadata
  BEFORE UPDATE ON shared.error_records
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- ----------------------------------------------------------------------------
-- 4. RLS and grants — exact all-tenant worker surface; zero runtime surface.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.processed_events FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.error_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.error_records FORCE ROW LEVEL SECURITY;

CREATE POLICY wkr_processed_events_all ON shared.processed_events
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY wkr_processed_events_all ON shared.processed_events IS
  'Infrastructure worker policy: deliberate all-tenant/platform claim visibility and insertion for this enumerated registry. Grants still prohibit UPDATE/DELETE; runtime/readonly have no policy or grant.';

CREATE POLICY wkr_error_records_all ON shared.error_records
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY wkr_error_records_all ON shared.error_records IS
  'Infrastructure worker policy: deliberate all-tenant/platform error visibility and triage writes for this enumerated table. Grants prohibit DELETE; runtime/readonly have no policy or grant.';

GRANT SELECT, INSERT ON shared.processed_events TO app_worker;
GRANT SELECT, INSERT, UPDATE ON shared.error_records TO app_worker;

-- Deliberately absent: UPDATE/DELETE on processed_events; DELETE on
-- error_records; every privilege and policy for app_runtime/app_readonly.
