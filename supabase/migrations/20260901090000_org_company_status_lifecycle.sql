-- ============================================================================
-- PRE-P1-29 Wave C — the legal-company status lifecycle.
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-TRANSITION. Until a company
-- changes status the tree is empty and every object here drops cleanly, so the
-- rollback at the foot of this file restores the prior state exactly. Once a
-- transition has been recorded, dropping org.company_status_history destroys the
-- only record that it happened — the table is append-only and nothing else in
-- the database carries the same fact. The trigger on org.legal_companies is the
-- one object that touches a pre-existing table, and it is additive: dropping it
-- returns that table to exactly its Wave B state.
--
-- org.legal_companies.status has existed since 20260717103000 with a two-state
-- vocabulary and NO history and NO transition function. Companies were the only
-- level of the org hierarchy without one: tenants gained theirs in Wave B, and
-- branches have had org.branch_status_history plus org.change_branch_status
-- from the start. This migration closes that gap and nothing else.
--
-- ## What is transcribed, and from where
--
-- The DATA MODEL is the BRANCH precedent, column for column. Measured from the
-- live catalogue rather than from memory:
--
--   org.branch_status_history : id, tenant_id, branch_id, from_state, to_state,
--                               reason, actor_id, occurred_at, correlation_id
--
-- Nine columns, a surrogate primary key, a composite foreign key carrying the
-- tenant, three CHECKs, one covering index, RLS FORCED, two policies, and
-- INSERT+SELECT grants with no UPDATE and no DELETE.
--
-- The TENANT model is deliberately NOT copied. org.tenant_status_history has a
-- `seq` identity column and uq_tenant_status_history_genesis, both of which
-- exist to order and bound a FOUR-state graph with a genesis row. Companies are
-- two-state and have no genesis row, exactly as branches do not, so neither
-- object has anything to do here.
--
-- ## The stamp is the SHARED one
--
-- org.branch_status_history uses org.stamp_branch_history(), a schema-local
-- copy. Measured side by side, that function and shared.stamp_status_history()
-- have the same body to the character except for the noun in the error message:
-- both set actor_id := iam.current_user_id(), both raise check_violation when it
-- is NULL, both set occurred_at := now(). So the local copy is duplication, not
-- specialisation. Wave B moved tenants onto the shared function four days ago;
-- this migration does not mint a fourth near-identical stamp to be symmetrical
-- with a copy that should not have been made.
--
-- ## Why there is NO separate transition-graph guard
--
-- Wave B's M4 added org.guard_tenant_status_transition() because the tenant
-- graph is a real graph: four states with illegal edges between them
-- (active -> provisioning is refused; closed is terminal). A company has TWO
-- states. Every transition that is not a no-op is legal, so
-- ck_legal_companies_status IS the graph, and a BEFORE UPDATE guard restating it
-- could never fire on any input the CHECK admits.
--
-- Shipping one anyway would put an untestable object in the tree — a trigger
-- whose refusal branch is unreachable, and therefore a rule that cannot be
-- proven. What actually binds a raw writer here is the EMITTER below: an UPDATE
-- that changes status and has not published a reason raises. That is the
-- enforcement, and it is provable.
--
-- ## What a raw writer can and cannot do
--
--   UPDATE org.legal_companies SET status = 'inactive' WHERE ...
--     -> refused, unless app.status_reason is published in the transaction.
--        History is emitted by trigger, so bypassing the function does not
--        bypass the record.
--   UPDATE ... SET status = <not in the vocabulary>
--     -> refused by ck_legal_companies_status.
--   UPDATE ... SET status = <the value it already has>
--     -> permitted and silent. Nothing changed, so there is nothing to record.
--   INSERT INTO org.company_status_history ...
--     -> bounded by the coherence guard and the stamp: a row that disagrees with
--        the company's current status is refused, and a caller-supplied actor or
--        occurred_at is overwritten.
--
-- ## The residual this migration does NOT close, stated rather than implied
--
-- Deactivating a company still gates nothing. org.guard_parent_company_live()
-- reads deleted_at and archived_at and never reads status — measured, the word
-- does not occur in its body — so a branch may still be created under an
-- inactive company, and no other object in the database reads the column. That
-- is exactly the posture branch 'inactive' already has, and the branch migration
-- records the same limitation in its own words. Making the guard status-aware is
-- a behaviour change to org.branches, not a company-history migration, and it is
-- left for a decision of its own rather than folded in here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The history table. Branch's shape, with company_id in place of branch_id.
-- ----------------------------------------------------------------------------
CREATE TABLE org.company_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  from_state     text,
  to_state       text        NOT NULL,
  reason         text        NOT NULL,
  -- NOT NULL, and never supplied by the caller: the BEFORE INSERT stamp fills it
  -- from the session before constraints are evaluated, so an INSERT that omits
  -- it succeeds and an INSERT that forges it is overwritten rather than refused.
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid,

  CONSTRAINT pk_company_status_history PRIMARY KEY (id),

  -- COMPOSITE, and that is the tenant-coherence control: the tenant travels
  -- through the foreign key, so a history row naming company X under tenant Y is
  -- structurally impossible rather than merely denied by a policy. The parent key
  -- uq_legal_companies_tenant_id_id already exists and is used by seventeen other
  -- child tables; nothing on the parent changes.
  CONSTRAINT fk_company_status_history_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,

  CONSTRAINT ck_company_status_history_state_change
    CHECK (from_state IS DISTINCT FROM to_state),

  -- The two-state vocabulary, identical to ck_legal_companies_status. from_state
  -- is nullable in the shape but is never NULL in practice: a company is created
  -- 'active' by column default and no genesis row is written, so every row here
  -- records a real transition from a real prior state.
  CONSTRAINT ck_company_status_history_states
    CHECK (
      to_state = ANY (ARRAY['active', 'inactive'])
      AND (from_state IS NULL OR from_state = ANY (ARRAY['active', 'inactive']))
    ),

  CONSTRAINT ck_company_status_history_reason_not_blank
    CHECK (btrim(reason) <> '')
);

-- Leading columns cover fk_company_status_history_company, which is what keeps
-- the measured zero-unindexed-foreign-key property of these schemas.
CREATE INDEX ix_company_status_history_tenant_company_occurred
  ON org.company_status_history (tenant_id, company_id, occurred_at);

COMMENT ON TABLE org.company_status_history IS
  'Append-only record of every legal-company status transition. Written by the org.emit_company_status_history trigger on org.legal_companies rather than by any caller, so a direct UPDATE of the column records itself. Attribution is server-derived by shared.stamp_status_history(); the reason is published as a transaction-local GUC by org.change_company_status. Note that company status gates nothing else in the database today: org.guard_parent_company_live() reads deleted_at and archived_at only, so an inactive company can still receive new branches. That is the branch precedent''s posture too, and it is recorded here rather than implied.';

-- ----------------------------------------------------------------------------
-- 2. Row security. FORCED, so the table owner is bound by its own policies.
-- ----------------------------------------------------------------------------
ALTER TABLE org.company_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.company_status_history FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_company_status_history_tenant ON org.company_status_history
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY ins_company_status_history_tenant ON org.company_status_history
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- APPEND-ONLY AT THE GRANT LAYER. SELECT and INSERT and nothing else, matching
-- org.branch_status_history exactly. No UPDATE or DELETE policy is written,
-- deliberately: writing a policy for a verb no role holds would suggest the verb
-- is reachable. app_platform is granted nothing at all — a control-plane
-- operator provisions companies but does not run their lifecycle, which is a
-- tenant-scoped act.
GRANT SELECT, INSERT ON org.company_status_history TO app_runtime;
GRANT SELECT ON org.company_status_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. The coherence guard.
--
-- The branch precedent has none, and its absence is a hole: a caller holding
-- INSERT can write a history row claiming a transition that never happened.
-- Wave B closed that hole for tenants with org.guard_tenant_status_coherence,
-- and this is that function with the noun changed. Copying the NEWER of two
-- precedents where they disagree is the point — transcribing branch faithfully
-- would mean reproducing a defect on purpose.
--
-- It is SECURITY INVOKER, so the inserting role must be able to SELECT the
-- parent company. sel_legal_companies_tenant narrows by iam.allowed_company_ids(),
-- so a session scoped away from the company gets foreign_key_violation from here
-- rather than no_data_found from the function: the same denial by a different
-- path, which is a surface worth knowing about rather than a leak.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.guard_company_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT c.status INTO v_current
  FROM org.legal_companies c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company % not found in this scope', NEW.company_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the company current status %',
      NEW.to_state, v_current USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Same-timing triggers fire in NAME order, so `coherence` runs before `stamp`
-- ('c' < 's'). That matches every measured coherence/stamp pair in the tree. The
-- two are independent in fact — the guard reads neither actor_id nor
-- occurred_at — but the ordering is fixed rather than left to chance.
-- EXECUTE is REVOKED from PUBLIC before the trigger is attached. PostgreSQL
-- grants EXECUTE on a new function to PUBLIC by default, so without this every
-- role in the database -- app_worker, app_readonly, anon -- could call it
-- directly. A trigger does not need the grant: it executes as the statement's
-- user against the function's owner privileges regardless. Measured against the
-- precedents, which all carry {postgres=X} and nothing else.
REVOKE EXECUTE ON FUNCTION org.guard_company_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_company_status_history_coherence
  BEFORE INSERT ON org.company_status_history
  FOR EACH ROW EXECUTE FUNCTION org.guard_company_status_coherence();

CREATE TRIGGER tg_company_status_history_stamp
  BEFORE INSERT ON org.company_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

-- ----------------------------------------------------------------------------
-- 4. The emitter — the object that makes history unbypassable.
--
-- History is written HERE and nowhere else. org.change_company_status performs
-- the UPDATE and publishes the reason; it does not insert. That is Wave B's M3
-- arrangement and it is what separates this from the branch precedent, where the
-- function owns the INSERT and a direct UPDATE therefore leaves no trace at all.
--
-- The reason arrives as a transaction-local GUC rather than as an argument
-- because a trigger has no arguments. An UPDATE that changes status without one
-- raises, which is precisely the bypass refusal.
--
-- Never reads app.user_id: attribution is the stamp's business, from
-- iam.current_user_id(), so a caller cannot publish an actor for itself.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.emit_company_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  v_reason      text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'a company status change requires app.status_reason in the session context'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO org.company_status_history
      (tenant_id, company_id, from_state, to_state, reason, correlation_id)
    VALUES
      (NEW.tenant_id, NEW.id, OLD.status, NEW.status, v_reason, v_correlation);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION org.emit_company_status_history() FROM PUBLIC;

CREATE TRIGGER tg_legal_companies_status_history
  AFTER UPDATE ON org.legal_companies
  FOR EACH ROW EXECUTE FUNCTION org.emit_company_status_history();

-- ----------------------------------------------------------------------------
-- 5. The sanctioned transition.
--
-- Adapted from org.change_branch_status, which is the tenant-scoped precedent:
-- same four parameters, same refusal order, same SECURITY INVOKER with an empty
-- search_path, same EXECUTE grant to app_runtime. It differs in one respect,
-- and only one: it publishes the reason and performs the UPDATE instead of
-- writing the history row itself, because the emitter owns that now.
--
-- No actor parameter, on purpose. org.change_branch_status has none either, and
-- Wave B kept p_actor_id on org.change_tenant_status only for signature
-- compatibility while explicitly refusing to bind it. A new function inherits
-- no such obligation, so the parameter simply does not exist and a caller has
-- nowhere to put an actor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.change_company_status(
  p_company_id     uuid,
  p_to_state       text,
  p_reason         text,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_from text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'company status transition requires a reason'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_to_state NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'invalid company status %', p_to_state USING ERRCODE = 'check_violation';
  END IF;

  -- The actor is NOT read here. The stamp resolves it when the emitter inserts,
  -- and it raises when the session carries none — so the check exists once, in
  -- the object that depends on it, rather than twice in two places that can drift.

  -- RLS applies to this read: another tenant's company is simply not found.
  SELECT c.status INTO v_from
  FROM org.legal_companies c
  WHERE c.id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company % does not exist in this scope', p_company_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_from = p_to_state THEN
    RAISE EXCEPTION 'company % is already %', p_company_id, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Published BEFORE the UPDATE, because the AFTER UPDATE emitter reads them.
  -- Transaction-local (the third argument is true), so they evaporate at COMMIT
  -- or ROLLBACK and cannot leak into an unrelated statement on a pooled
  -- connection.
  PERFORM set_config('app.status_reason', p_reason, true);
  PERFORM set_config('app.correlation_id', coalesce(p_correlation_id::text, ''), true);

  UPDATE org.legal_companies SET status = p_to_state WHERE id = p_company_id;

  -- Cleared so a LATER unrelated status UPDATE in the same transaction cannot
  -- silently inherit this reason. Wave B does the same for tenants.
  PERFORM set_config('app.status_reason', '', true);
  PERFORM set_config('app.correlation_id', '', true);
END;
$$;

-- REVOKE BEFORE GRANT, and the order is not cosmetic: granting to app_runtime
-- leaves the default PUBLIC entry in place, so the ACL reads
-- {=X/postgres, postgres=X, app_runtime=X} and every role still holds EXECUTE.
-- org.change_branch_status carries {postgres=X, app_runtime=X}; this matches it.
REVOKE EXECUTE ON FUNCTION org.change_company_status(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.change_company_status(uuid, text, text, uuid) TO app_runtime;

COMMENT ON FUNCTION org.change_company_status(uuid, text, text, uuid) IS
  'Atomic legal-company status transition over the two-state vocabulary. Locks the row, refuses a blank reason, an unknown destination and a no-op, publishes the reason and correlation id as transaction-local GUCs, and performs the UPDATE. History is written by the org.emit_company_status_history trigger rather than by this function, so a direct UPDATE of the column is recorded too and an UPDATE that publishes no reason is refused. The actor is never a parameter: shared.stamp_status_history() derives it from the session.';

-- ============================================================================
-- Exact rollback:
--   DROP FUNCTION org.change_company_status(uuid, text, text, uuid);
--   DROP TRIGGER tg_legal_companies_status_history ON org.legal_companies;
--   DROP FUNCTION org.emit_company_status_history();
--   DROP TABLE org.company_status_history;          -- takes its triggers with it
--   DROP FUNCTION org.guard_company_status_coherence();
-- Nothing on org.legal_companies is altered by this migration except the added
-- AFTER UPDATE trigger, so the rollback restores the prior state exactly.
-- ============================================================================
