-- ============================================================================
-- Phase: 1-18 — Appointment & Reception Backend
-- Migration: release the reception visit's one-open-visit-per-Vehicle index when
--            custody of the Vehicle has actually been released
-- Change request: DBCR-P1-18-001
-- Owner module: rec
--
-- Rollback classification: ROLL-FORWARD-ONLY once any Vehicle has been received
--   a second time. The structural inverse is given at the end of this file, but
--   restoring the old predicate FAILS on any Vehicle legitimately received more
--   than once — which is the entire point of the change. Recorded in
--   docs/database/change-requests/DBCR-P1-18-001-rec-custody-release-visit-marker.md.
--
-- Purpose
--   `uq_reception_visits_open_vehicle` exists to enforce a true operational fact:
--   a Vehicle cannot be in the custody of two open visits at once. Its predicate
--   spells that as four reception statuses:
--
--     WHERE reception_status IN ('opened','inspecting','authorized','converted')
--       AND deleted_at IS NULL
--
--   and its own comment states the intent — "Terminal visits
--   (closed_without_work/refused) do not block a later visit."
--
--   `converted` is also terminal. `rec.guard_reception_transition()` gives it no
--   outgoing edge and `TERMINAL_RECEPTION_STATUSES` lists it beside the other
--   two. It is the one terminal state the SUCCESSFUL path reaches: a visit that
--   becomes a work order ends its life in `converted`. So the comment names two
--   of the three terminal states and the predicate retains the third, and the
--   effect is that the normal, correct completion of a reception permanently
--   forbids that Vehicle from ever being received again in that tenant.
--
--   Reproduced against a live database, inside a rolled-back transaction, driven
--   by `rec.accept_check_in` (the production primitive) rather than a raw INSERT:
--
--     visit 1 reached `converted`  -- the normal, successful path
--     visit 2 REFUSED — SQLSTATE 23505  uq_reception_visits_open_vehicle
--     control: after `closed_without_work`, a second check-in IS allowed
--     escape:  `converted` cannot be left —
--              invalid reception transition converted -> closed_without_work
--
--   The control is what identifies the defect precisely: the table, the guard
--   trigger and the check-in primitive all behave as designed. The single fault
--   is `converted` sitting in the predicate. And because `converted` is frozen,
--   there is no operational escape — no operator, support engineer or screen can
--   recover the Vehicle. Every returning customer is a permanent 23505.
--   Recorded as P1-27-INT-013 (Critical).
--
--   The fix is NOT to drop `converted` from the predicate. While the work order
--   is open the Vehicle is physically in the workshop and a second reception must
--   still be refused; `converted` is doing real work for that whole period. What
--   the predicate should test is custody, which is exactly what the index was
--   always for. Custody release is already a first-class, exactly-once fact:
--   `rec.custody_history.to_state = 'released'`, backstopped by
--   `uq_custody_history_released` and written by `sal.complete_delivery` when the
--   Vehicle is handed back.
--
--   A partial index cannot reference another table, so that fact is denormalised
--   onto the visit as `custody_released_at`, maintained by a trigger on the
--   custody ledger and guarded so that it can only ever be set when the ledger
--   row genuinely exists. The predicate then reads: this Vehicle is blocked while
--   a visit holds it and is free once custody has been released.
--
-- Dependencies
--   20260721097000 (rec.reception_visits and uq_reception_visits_open_vehicle),
--   20260721105000 (rec.custody_history and uq_custody_history_accepted),
--   20260724094000 (uq_custody_history_released and sal.complete_delivery),
--   0002 (shared.touch_row_metadata, org.guard_immutable_columns).
--
-- Security implications
--   * `custody_released_at` is NOT freely writable in effect: a dedicated guard
--     refuses it at INSERT, refuses any change once set, refuses clearing it, and
--     refuses setting it unless a matching `released` custody row exists inside
--     the caller's own RLS view. app_runtime's existing table-level UPDATE grant
--     therefore confers no ability to release the index by assertion.
--   * The maintainer is SECURITY INVOKER, so RLS applies to it exactly as to the
--     caller, and it RAISEs rather than silently skipping when it matches no row.
--   * No new grant, role, policy, permission code or table is created.
--
-- Objects created
--   Columns:   rec.reception_visits.custody_released_at
--   Functions: rec.guard_custody_release_marker(), rec.apply_custody_release()
--   Triggers:  tg_reception_visits_custody_release_marker,
--              tg_custody_history_apply_release
--   Indexes:   uq_reception_visits_open_vehicle (replaced)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The custody-release marker
-- ----------------------------------------------------------------------------
ALTER TABLE rec.reception_visits
  ADD COLUMN custody_released_at timestamptz NULL;

COMMENT ON COLUMN rec.reception_visits.custody_released_at IS
  'When custody of the Vehicle was released back to the customer, denormalised from the exactly-once rec.custody_history row with to_state = ''released'' (a partial index cannot reference another table). NULL means the workshop still holds the Vehicle. Maintained only by tg_custody_history_apply_release and guarded by tg_reception_visits_custody_release_marker; set-once, never cleared. Feeds uq_reception_visits_open_vehicle (P1-27-INT-013).';

-- Backfill from the ledger, which is the authority. Performed BEFORE the guard
-- and the new index exist so that neither can observe a half-built state. On a
-- database with no released custody this is a no-op; it is written for the one
-- that has some.
UPDATE rec.reception_visits v
   SET custody_released_at = r.released_at
  FROM (
    SELECT reception_visit_id, min(occurred_at) AS released_at
      FROM rec.custody_history
     WHERE to_state = 'released'
     GROUP BY reception_visit_id
  ) r
 WHERE r.reception_visit_id = v.id
   AND v.custody_released_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. The guard — the marker is evidence, not an assertion
-- ----------------------------------------------------------------------------
-- Without this, app_runtime's table-level UPDATE grant would let request code
-- set custody_released_at directly and free the Vehicle without any handover
-- ever happening. The marker is therefore admitted only when the custody ledger
-- already carries the corresponding release, and only once.
CREATE OR REPLACE FUNCTION rec.guard_custody_release_marker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A visit is created at the moment the workshop TAKES custody; it cannot be
    -- born already released. rec.accept_check_in writes the 'accepted' ledger row.
    IF NEW.custody_released_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new reception visit cannot already have released custody'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.custody_released_at IS NOT DISTINCT FROM OLD.custody_released_at THEN
    RETURN NEW;
  END IF;

  IF OLD.custody_released_at IS NOT NULL THEN
    RAISE EXCEPTION 'custody release is recorded once and cannot be changed or cleared'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM rec.custody_history h
     WHERE h.tenant_id = NEW.tenant_id
       AND h.company_id = NEW.company_id
       AND h.branch_id = NEW.branch_id
       AND h.reception_visit_id = NEW.id
       AND h.to_state = 'released'
  ) THEN
    RAISE EXCEPTION 'custody release for visit % requires a released custody record', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_custody_release_marker() IS
  'BEFORE INSERT OR UPDATE OF custody_released_at on rec.reception_visits: the marker cannot be set at creation, cannot be changed or cleared once set, and can only be set when a matching rec.custody_history release row is visible to the caller. Makes the marker evidence of a handover rather than an assertion by request code.';
REVOKE EXECUTE ON FUNCTION rec.guard_custody_release_marker() FROM PUBLIC;

CREATE TRIGGER tg_reception_visits_custody_release_marker
  BEFORE INSERT OR UPDATE OF custody_released_at ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION rec.guard_custody_release_marker();

-- ----------------------------------------------------------------------------
-- 3. The maintainer — the ledger drives the marker
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.apply_custody_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE rec.reception_visits
     SET custody_released_at = NEW.occurred_at
   WHERE tenant_id = NEW.tenant_id
     AND company_id = NEW.company_id
     AND branch_id = NEW.branch_id
     AND id = NEW.reception_visit_id
     AND custody_released_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- uq_custody_history_released already makes a second release impossible, so
  -- the only way to match no row here is a caller whose RLS scope excludes the
  -- visit it just released. Failing loudly is deliberate: silently leaving the
  -- marker unset would recreate P1-27-INT-013 for that Vehicle, and a defect
  -- that reappears only under a scope mismatch is the hardest kind to find.
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'custody release for visit % updated no visit in scope', NEW.reception_visit_id
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION rec.apply_custody_release() IS
  'AFTER INSERT ON rec.custody_history WHEN to_state = ''released'': stamps rec.reception_visits.custody_released_at from the ledger row, releasing uq_reception_visits_open_vehicle so the Vehicle can be received again. RAISEs rather than silently skipping when no visit is in scope.';
REVOKE EXECUTE ON FUNCTION rec.apply_custody_release() FROM PUBLIC;

CREATE TRIGGER tg_custody_history_apply_release
  AFTER INSERT ON rec.custody_history
  FOR EACH ROW WHEN (NEW.to_state = 'released')
  EXECUTE FUNCTION rec.apply_custody_release();

-- ----------------------------------------------------------------------------
-- 4. The index, restated as what it always meant
-- ----------------------------------------------------------------------------
DROP INDEX rec.uq_reception_visits_open_vehicle;

-- One visit may HOLD a Vehicle at a time. `converted` stays in the predicate —
-- a Vehicle under an open work order is still in the workshop — but the visit
-- stops blocking once custody has been released back to the customer. Terminal
-- visits that never took the Vehicle to work (closed_without_work / refused)
-- are outside the status list and never blocked, exactly as before.
CREATE UNIQUE INDEX uq_reception_visits_open_vehicle
  ON rec.reception_visits (tenant_id, vehicle_id)
  WHERE reception_status IN ('opened', 'inspecting', 'authorized', 'converted')
    AND custody_released_at IS NULL
    AND deleted_at IS NULL;

COMMENT ON INDEX rec.uq_reception_visits_open_vehicle IS
  'One visit may hold a Vehicle at a time (custody cannot be in two places). Released visits, and terminal visits that never took the Vehicle to work, do not block a later visit. Before P1-27-INT-013 the predicate tested reception_status alone, and because `converted` is terminal a Vehicle could be received exactly once in its lifetime.';

-- ============================================================================
-- Structural inverse (see the rollback classification above — restoring the old
-- predicate FAILS on any Vehicle legitimately received more than once):
--
--   DROP TRIGGER tg_custody_history_apply_release ON rec.custody_history;
--   DROP TRIGGER tg_reception_visits_custody_release_marker ON rec.reception_visits;
--   DROP FUNCTION rec.apply_custody_release();
--   DROP FUNCTION rec.guard_custody_release_marker();
--   DROP INDEX rec.uq_reception_visits_open_vehicle;
--   CREATE UNIQUE INDEX uq_reception_visits_open_vehicle
--     ON rec.reception_visits (tenant_id, vehicle_id)
--     WHERE reception_status IN ('opened','inspecting','authorized','converted')
--       AND deleted_at IS NULL;
--   ALTER TABLE rec.reception_visits DROP COLUMN custody_released_at;
-- ============================================================================
