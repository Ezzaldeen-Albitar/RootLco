-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: transactional event outbox and constrained worker archetype
-- Tasks: P1-05-DB-011, P1-05-SEC-003 (partial — payload security), P1-05-QA-004
-- Owner module: shared
--
-- Purpose
--   event_outbox persists tenant-scoped integration-event envelopes in the
--   transaction that commits the originating business change. Atomic invoker
--   functions claim due/stale work, publish it, or schedule/dead-letter a
--   failed attempt without exposing a read-then-write claim race.
--
-- Dependencies
--   Phase 1-3 org.tenants / org.legal_companies / org.branches, Phase 1-4
--   iam.current_user_id(), and the Phase 1-2 role/grant foundation.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure and a
--   NOLOGIN role only); roll-forward-only once outbox rows exist because they
--   are durable delivery obligations. Recorded in
--   docs/database/phase-1-5-migration-classification.md.
--
-- Security implications
--   * app_worker is a deliberately constrained NOLOGIN infrastructure
--     archetype: no superuser, database/role creation, replication, object
--     ownership, or RLS-bypass capability. A later phase supplies any actual
--     LOGIN credential; this migration creates no standing worker credential.
--   * app_worker receives only USAGE on shared/iam, EXECUTE on the context
--     reader required by later worker-table metadata triggers, SELECT/INSERT/
--     UPDATE (never DELETE) on this table, and EXECUTE on the three controlled
--     outbox routines. PUBLIC execute is revoked from every new routine.
--   * The wkr_event_outbox_all policy intentionally gives app_worker ALL-TENANT
--     row visibility (USING true / WITH CHECK true). This is an infrastructure
--     dispatch capability, not tenant-session access and not BYPASSRLS. It is
--     deliberately limited to the enumerated worker table; app_runtime and
--     app_readonly receive zero grant and zero policy on the table/functions.
--   * FORCE RLS remains enabled. A compromised worker login could observe or
--     mutate every tenant's outbox envelope through its granted verbs, so its
--     future credential must be backend-only, tightly held, and monitored.
--     DELETE and DDL remain structurally unavailable, and lifecycle CHECKs plus
--     the INSERT guard reject malformed direct writes.
--   * Claiming is one UPDATE over locked SKIP-LOCKED candidates. Completion and
--     failure are each one claimant-bound conditional UPDATE, preventing a
--     different worker from finalizing a claim. Returned claim rows are
--     explicitly unordered and callers must not infer dispatch order.
--   * payload/headers must be JSON objects. Event identity is tenant-unique;
--     company/branch scope is enforced by composite FKs and a branch can never
--     exist without its company scope.
--
-- Objects created
--   Role:      app_worker
--   Table:     shared.event_outbox
--   Functions: shared.guard_event_outbox_initial_state(),
--              shared.claim_outbox_events(text, integer, interval),
--              shared.complete_outbox_event(uuid, text),
--              shared.fail_outbox_event(uuid, text, text, interval, integer)
--   Trigger:   tg_event_outbox_guard_initial_state
--   Policy:    wkr_event_outbox_all
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Worker role archetype — cluster-wide and replay-safe, mirroring 0002.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

COMMENT ON ROLE app_worker IS
  'Asynchronous infrastructure-worker role archetype. NOLOGIN, non-owner, no BYPASSRLS or DDL. Holds only explicit per-object worker grants; its enumerated worker-table RLS policies deliberately span all tenants. See docs/database/role-and-grant-standard.md.';

GRANT USAGE ON SCHEMA shared, iam TO app_worker;
GRANT EXECUTE ON FUNCTION iam.current_user_id() TO app_worker;

-- ----------------------------------------------------------------------------
-- 2. shared.event_outbox — durable tenant-scoped event envelope.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.event_outbox (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NULL,
  branch_id      uuid        NULL,
  event_key      text        NOT NULL,
  event_type     text        NOT NULL,
  aggregate_type text        NOT NULL,
  aggregate_id   uuid        NOT NULL,
  schema_version integer     NOT NULL,
  aggregate_version bigint   NOT NULL,
  producer       text        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,
  causation_id   uuid        NULL,
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  headers        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'pending',
  available_at   timestamptz NOT NULL DEFAULT now(),
  attempt_count  integer     NOT NULL DEFAULT 0,
  claimed_at     timestamptz NULL,
  claimed_by     text        NULL,
  published_at   timestamptz NULL,
  last_error     text        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,

  CONSTRAINT pk_event_outbox PRIMARY KEY (id),
  CONSTRAINT uq_event_outbox_event_key UNIQUE (tenant_id, event_key),
  CONSTRAINT fk_event_outbox_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_outbox_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_outbox_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_event_outbox_branch_requires_company
    CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT ck_event_outbox_event_key
    CHECK (btrim(event_key) <> '' AND char_length(event_key) <= 255),
  CONSTRAINT ck_event_outbox_event_type_format
    CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  CONSTRAINT ck_event_outbox_aggregate_type_format
    CHECK (aggregate_type ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  CONSTRAINT ck_event_outbox_schema_version CHECK (schema_version >= 1),
  CONSTRAINT ck_event_outbox_aggregate_version CHECK (aggregate_version >= 1),
  CONSTRAINT ck_event_outbox_producer_format
    CHECK (producer ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  CONSTRAINT ck_event_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ck_event_outbox_headers_object CHECK (jsonb_typeof(headers) = 'object'),
  CONSTRAINT ck_event_outbox_status
    CHECK (status IN ('pending', 'claimed', 'published', 'dead_letter')),
  CONSTRAINT ck_event_outbox_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_event_outbox_claim_pair CHECK (
    (status = 'claimed') = (claimed_at IS NOT NULL AND claimed_by IS NOT NULL)
  ),
  CONSTRAINT ck_event_outbox_publish_pair CHECK (
    (status = 'published') = (published_at IS NOT NULL)
  ),
  CONSTRAINT ck_event_outbox_dead_letter_error CHECK (
    status <> 'dead_letter'
    OR (last_error IS NOT NULL AND btrim(last_error) <> '')
  ),
  CONSTRAINT ck_event_outbox_last_error_not_blank
    CHECK (last_error IS NULL OR btrim(last_error) <> '')
);

COMMENT ON TABLE shared.event_outbox IS
  'Tenant-owned transactional integration-event envelope. event_key is unique per tenant. app_worker deliberately has all-tenant SELECT/INSERT/UPDATE through wkr_event_outbox_all so infrastructure dispatch is independent of a user tenant session; app_runtime/app_readonly have no access. Claims use SKIP LOCKED, retries are due-time gated, terminal rows are never claimable, and DELETE is not a worker capability.';
COMMENT ON COLUMN shared.event_outbox.event_key IS
  'Caller-supplied idempotent event identity, unique within one tenant.';
COMMENT ON COLUMN shared.event_outbox.aggregate_id IS
  'Opaque UUID of the originating aggregate. aggregate_type identifies its logical kind; no generic cross-domain FK is possible.';
COMMENT ON COLUMN shared.event_outbox.schema_version IS
  'Payload contract version used by consumers to interpret this event.';
COMMENT ON COLUMN shared.event_outbox.aggregate_version IS
  'Optimistic-concurrency version of the source aggregate when this event occurred.';
COMMENT ON COLUMN shared.event_outbox.payload IS
  'Integration-event payload; constrained to a JSON object. Producers must exclude credentials and secrets.';
COMMENT ON COLUMN shared.event_outbox.headers IS
  'Transport-neutral metadata; constrained to a JSON object and not an authorization surface.';
COMMENT ON COLUMN shared.event_outbox.claimed_by IS
  'Validated worker claimant token. Ownership of a claim is required to complete or fail it.';
COMMENT ON COLUMN shared.event_outbox.last_error IS
  'Sanitized non-secret failure summary. Mandatory for dead-letter rows; raw stack traces and credentials are forbidden.';

CREATE INDEX ix_event_outbox_company
  ON shared.event_outbox (tenant_id, company_id);
CREATE INDEX ix_event_outbox_branch
  ON shared.event_outbox (tenant_id, company_id, branch_id);
CREATE INDEX ix_event_outbox_claimable
  ON shared.event_outbox (status, available_at, claimed_at, occurred_at, id);

-- ----------------------------------------------------------------------------
-- 3. Initial-state guard. Direct INSERT cannot forge a lifecycle state even if
--    it supplies a CHECK-consistent set of stamps.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_event_outbox_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'pending'
     OR NEW.attempt_count <> 0
     OR NEW.claimed_at IS NOT NULL
     OR NEW.claimed_by IS NOT NULL
     OR NEW.published_at IS NOT NULL
     OR NEW.last_error IS NOT NULL THEN
    RAISE EXCEPTION 'event outbox row must start pending, unstamped, without error, and with attempt_count zero'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_event_outbox_initial_state() IS
  'BEFORE INSERT guard for shared.event_outbox. Requires pending, attempt_count zero, and NULL claim/publish/error lifecycle fields.';

REVOKE EXECUTE ON FUNCTION shared.guard_event_outbox_initial_state() FROM PUBLIC;

CREATE TRIGGER tg_event_outbox_guard_initial_state
  BEFORE INSERT ON shared.event_outbox
  FOR EACH ROW EXECUTE FUNCTION shared.guard_event_outbox_initial_state();

-- ----------------------------------------------------------------------------
-- 4. Atomic worker lifecycle functions. All validate the claimant token.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.claim_outbox_events(
  p_claimant text,
  p_limit integer,
  p_lease interval DEFAULT '5 minutes'
)
RETURNS SETOF shared.event_outbox
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_claimant IS NULL OR p_claimant !~ '^[a-z][a-z0-9_.-]{1,62}$' THEN
    RAISE EXCEPTION 'invalid outbox claimant format'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'outbox claim limit must be positive'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_lease IS NULL OR p_lease <= interval '0 seconds' THEN
    RAISE EXCEPTION 'outbox claim lease must be positive'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- RETURNING order is deliberately unspecified. Consumers must treat this as
  -- an unordered claimed set, even though candidate selection is deterministic.
  RETURN QUERY
  UPDATE shared.event_outbox AS o
     SET status = 'claimed',
         claimed_at = now(),
         claimed_by = p_claimant,
         attempt_count = o.attempt_count + 1
    FROM (
      SELECT candidate.id
      FROM shared.event_outbox AS candidate
      WHERE (candidate.status = 'pending' AND candidate.available_at <= now())
         OR (candidate.status = 'claimed' AND candidate.claimed_at < now() - p_lease)
      ORDER BY candidate.available_at, candidate.occurred_at, candidate.id
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    ) AS eligible
   WHERE o.id = eligible.id
  RETURNING o.*;
END;
$$;

COMMENT ON FUNCTION shared.claim_outbox_events(text, integer, interval) IS
  'Atomically claims up to p_limit due-pending or stale-claimed rows using FOR UPDATE SKIP LOCKED, increments attempt_count, and returns an UNORDERED set. SECURITY INVOKER; app_worker only.';

REVOKE EXECUTE ON FUNCTION shared.claim_outbox_events(text, integer, interval) FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.complete_outbox_event(p_id uuid, p_claimant text)
RETURNS shared.event_outbox
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row shared.event_outbox;
BEGIN
  IF p_claimant IS NULL OR p_claimant !~ '^[a-z][a-z0-9_.-]{1,62}$' THEN
    RAISE EXCEPTION 'invalid outbox claimant format'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE shared.event_outbox
     SET status = 'published',
         published_at = now(),
         claimed_at = NULL,
         claimed_by = NULL
   WHERE id = p_id
     AND status = 'claimed'
     AND claimed_by = p_claimant
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outbox event % is not claimed by %', p_id, p_claimant;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION shared.complete_outbox_event(uuid, text) IS
  'Publishes exactly one row only when claimed by p_claimant, atomically stamps published_at and clears claim fields; raises when no claimant-bound row is updated. SECURITY INVOKER; app_worker only.';

REVOKE EXECUTE ON FUNCTION shared.complete_outbox_event(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.fail_outbox_event(
  p_id uuid,
  p_claimant text,
  p_error text,
  p_retry_in interval,
  p_max_attempts integer
)
RETURNS shared.event_outbox
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row shared.event_outbox;
BEGIN
  IF p_claimant IS NULL OR p_claimant !~ '^[a-z][a-z0-9_.-]{1,62}$' THEN
    RAISE EXCEPTION 'invalid outbox claimant format'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_error IS NULL OR btrim(p_error) = '' THEN
    RAISE EXCEPTION 'outbox failure error must not be blank'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_retry_in IS NULL OR p_retry_in < interval '0 seconds' THEN
    RAISE EXCEPTION 'outbox retry interval must not be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'outbox max attempts must be positive'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE shared.event_outbox
     SET status = CASE
                    WHEN attempt_count >= p_max_attempts THEN 'dead_letter'
                    ELSE 'pending'
                  END,
         available_at = CASE
                          WHEN attempt_count >= p_max_attempts THEN available_at
                          ELSE now() + p_retry_in
                        END,
         claimed_at = NULL,
         claimed_by = NULL,
         last_error = p_error
   WHERE id = p_id
     AND status = 'claimed'
     AND claimed_by = p_claimant
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outbox event % is not claimed by %', p_id, p_claimant;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION shared.fail_outbox_event(uuid, text, text, interval, integer) IS
  'Fails exactly one row only when claimed by p_claimant. Below p_max_attempts it returns the row to pending at now()+p_retry_in; at/above the maximum it dead-letters it. Both paths clear claim fields and retain a sanitized last_error. SECURITY INVOKER; app_worker only.';

REVOKE EXECUTE ON FUNCTION shared.fail_outbox_event(uuid, text, text, interval, integer) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 5. RLS and grants — deliberate all-tenant worker surface, no runtime surface.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.event_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY wkr_event_outbox_all ON shared.event_outbox
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY wkr_event_outbox_all ON shared.event_outbox IS
  'Infrastructure worker policy: deliberate all-tenant visibility/write coverage for the enumerated outbox table. app_worker is constrained and non-bypassing; app_runtime/app_readonly have no policy or grant.';

GRANT SELECT, INSERT, UPDATE ON shared.event_outbox TO app_worker;
GRANT EXECUTE ON FUNCTION shared.claim_outbox_events(text, integer, interval) TO app_worker;
GRANT EXECUTE ON FUNCTION shared.complete_outbox_event(uuid, text) TO app_worker;
GRANT EXECUTE ON FUNCTION shared.fail_outbox_event(uuid, text, text, interval, integer)
  TO app_worker;

-- Deliberately absent: DELETE for app_worker; every privilege and policy for
-- app_runtime/app_readonly; CREATE/ownership/BYPASSRLS for every application role.
