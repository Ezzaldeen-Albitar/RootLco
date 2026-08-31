-- ============================================================================
-- PRE-P1-29 Wave B — M3: the tenant-history emission model (§6.7).
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-TRANSITION for the `seq`
-- column only. The functions, triggers and index are droppable and lossless;
-- dropping `seq` destroys the append order of any history already written, which
-- nothing else records (`occurred_at` is not unique and not monotonic under
-- concurrency).
--
-- ## Why this file lands THIRD, before M2
--
-- Design §15 rule 2, the same reason M4 precedes it: M2 grants `INSERT` on
-- `org.tenant_status_history` to `app_platform`, and a database that has the
-- grant but not these triggers is a database where forged attribution is
-- possible. The stamp below is the only control that overwrites a caller's
-- `actor_id` and `occurred_at`; without it a grantee could attribute a
-- transition to an arbitrary account and backdate it. The guards land first.
--
-- ## The emission model, and the two mechanisms it deliberately does NOT use
--
-- History is written by an AFTER UPDATE trigger on `org.tenants` rather than by
-- an explicit INSERT inside `org.change_tenant_status`. That closes the gap the
-- function could not: a direct `UPDATE org.tenants SET status = …` by a role
-- holding the column grant previously changed status with NO history row at all.
-- Now every status change emits one, whatever performs it.
--
-- Two earlier designs for this are NOT here and must not return:
--
--   * `transition_version` — an independently maintained ordinal. It had no
--     writer on the genesis path. Replaced by `seq bigint GENERATED ALWAYS AS
--     IDENTITY`, which 23 migrations already use and which no writer ever names
--     in an INSERT column list, so `org.provision_organization` keeps its
--     unchanged five-column INSERT.
--   * `pg_trigger_depth()` as a provenance discriminator. It measures nesting,
--     not provenance, and appears zero times across the tree. Removed; the stamp
--     below is depth-independent and does the job the discriminator was invented
--     to do.
--
-- ## Trigger order is by NAME, and it is stated rather than inferred
--
-- Two BEFORE INSERT triggers fire on `org.tenant_status_history`. PostgreSQL
-- fires same-timing triggers in NAME order, so `…_coherence` runs before
-- `…_stamp` — matching the `wo` pair. Here the order is also immaterial, and
-- saying why is what makes it safe rather than lucky: coherence reads
-- `tenant_id`/`to_state`, the stamp writes `actor_id`/`occurred_at` and reads
-- neither. Neither depends on the other's result.
--
-- ## Stated residue, not hidden
--
-- A holder of the INSERT privilege can still write a PHANTOM PREDECESSOR — a
-- `from_state` that never occurred — but the row is attributed (the stamp),
-- unbackdatable (the stamp), tenant-pinned (the foreign key) and undeletable (no
-- DELETE privilege exists for any role). The mature `wo` precedent carries the
-- identical residue.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Append order, and genesis uniqueness. The column and its constraint come
--    first because the guard below reads them.
-- ----------------------------------------------------------------------------
ALTER TABLE org.tenant_status_history
  ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

COMMENT ON COLUMN org.tenant_status_history.seq IS
  'Append order. GENERATED ALWAYS AS IDENTITY, which no writer names in an INSERT column list — so org.provision_organization keeps its unchanged five-column INSERT. Not a version counter: occurred_at is not unique and not monotonic under concurrency, so this is the only total order the table has.';

-- One genesis row per tenant. A partial unique index, the pattern the tree
-- already uses 153 times.
CREATE UNIQUE INDEX uq_tenant_status_history_genesis
  ON org.tenant_status_history (tenant_id)
  WHERE from_state IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Coherence: a history row must agree with the tenant it describes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.guard_tenant_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT t.status INTO v_current FROM org.tenants t WHERE t.id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant % not found', NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the tenant current status %',
      NEW.to_state, v_current USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_tenant_status_coherence() IS
  'BEFORE INSERT on org.tenant_status_history: refuses a row whose to_state disagrees with the tenant it names. Runs SECURITY INVOKER, so the writing role needs SELECT on org.tenants AND a policy admitting it — a grant alone is not enough on a FORCE-RLS table.';

REVOKE EXECUTE ON FUNCTION org.guard_tenant_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_tenant_status_history_coherence
  BEFORE INSERT ON org.tenant_status_history
  FOR EACH ROW EXECUTE FUNCTION org.guard_tenant_status_coherence();

-- ----------------------------------------------------------------------------
-- 3. Attribution. Reuses the shared stamp already attached to 13 tables; no new
--    function, and it is depth-independent.
-- ----------------------------------------------------------------------------
CREATE TRIGGER tg_tenant_status_history_stamp
  BEFORE INSERT ON org.tenant_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

-- ----------------------------------------------------------------------------
-- 4. The emitter. Unqualified AFTER UPDATE, matching the wo precedent: a
--    narrowed `AFTER UPDATE OF status` fires only when status is named in the
--    SET list, so a BEFORE trigger that sets NEW.status would commit the change
--    with zero history rows.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.emit_tenant_status_history()
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
      RAISE EXCEPTION 'a tenant status change requires app.status_reason in the session context'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO org.tenant_status_history
      (tenant_id, from_state, to_state, reason, correlation_id)
    VALUES
      (NEW.id, OLD.status, NEW.status, v_reason, v_correlation);
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION org.emit_tenant_status_history() IS
  'AFTER UPDATE trigger on org.tenants: writes one append-only history row when status actually changes, whatever performed the change — including a direct UPDATE that bypasses org.change_tenant_status. reason and correlation_id come from transaction-local GUCs (app.status_reason / app.correlation_id), which are DATA. actor_id is NOT taken from any caller value: the stamp derives it from iam.current_user_id(). A caller-supplied value must never become the input to an authority predicate.';

REVOKE EXECUTE ON FUNCTION org.emit_tenant_status_history() FROM PUBLIC;

CREATE TRIGGER tg_tenants_status_history
  AFTER UPDATE ON org.tenants
  FOR EACH ROW EXECUTE FUNCTION org.emit_tenant_status_history();

-- ----------------------------------------------------------------------------
-- 5. The function loses its explicit INSERT: the emitter now owns history, and
--    two writers would produce two rows. It publishes the reason and the
--    correlation id — both DATA — and does NOT publish app.user_id, which is
--    AUTHORITY and is the input to every platform-authority predicate. The
--    p_actor_id parameter is retained for signature compatibility and is
--    deliberately not bound into the history row (§8).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.change_tenant_status(
  p_tenant_id      uuid,
  p_to_state       text,
  p_reason         text,
  p_actor_id       uuid DEFAULT NULL,
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
  SELECT status INTO v_from FROM org.tenants WHERE id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant % does not exist', p_tenant_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_from = p_to_state THEN
    RAISE EXCEPTION 'tenant % is already %', p_tenant_id, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'a tenant status change requires a reason'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The graph is validated by M4's BEFORE UPDATE backstop, which fires on the
  -- statement below and refuses an illegal transition for every writer, not
  -- only for callers of this function. Duplicating it here would put the same
  -- rule in two places and let them drift.

  PERFORM set_config('app.status_reason', p_reason, true);
  PERFORM set_config('app.correlation_id', coalesce(p_correlation_id::text, ''), true);

  UPDATE org.tenants SET status = p_to_state WHERE id = p_tenant_id;

  -- History is written by tg_tenants_status_history. No INSERT here: two
  -- writers would produce two rows for one transition.

  PERFORM set_config('app.status_reason', '', true);
END;
$$;

COMMENT ON FUNCTION org.change_tenant_status(uuid, text, text, uuid, uuid) IS
  'Atomic tenant lifecycle transition. Locks the row, refuses a no-op and a blank reason, publishes the reason and correlation id as transaction-local GUCs, and performs the status UPDATE. The graph is enforced by M4 backstop trigger and history by the M3 emitter, so a direct UPDATE by any grantee gets both. p_actor_id is retained for signature compatibility and is NOT bound into the history row: attribution is server-derived by shared.stamp_status_history().';

REVOKE EXECUTE ON FUNCTION org.change_tenant_status(uuid, text, text, uuid, uuid) FROM PUBLIC;

-- ============================================================================
-- Exact rollback (destroys append order once history exists):
--
--   CREATE OR REPLACE FUNCTION org.change_tenant_status(...)  -- prior body
--   DROP TRIGGER tg_tenants_status_history ON org.tenants;
--   DROP FUNCTION org.emit_tenant_status_history();
--   DROP TRIGGER tg_tenant_status_history_stamp ON org.tenant_status_history;
--   DROP TRIGGER tg_tenant_status_history_coherence ON org.tenant_status_history;
--   DROP FUNCTION org.guard_tenant_status_coherence();
--   DROP INDEX org.uq_tenant_status_history_genesis;
--   ALTER TABLE org.tenant_status_history DROP COLUMN seq;
-- ============================================================================
