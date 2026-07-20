-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: the Work Order master (originating from a Phase 1-8 reception visit)
-- Tasks: P1-09-DB-003 (WO master), DB-004 (reception origin), DB-005 (state graph)
-- Owner module: wo
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   work orders exist (they are the operational record). Forward-only.
--
-- Purpose
--   wo.work_orders is the repair job of record. Every work order ORIGINATES from
--   exactly one Phase 1-8 reception visit (branch-scoped composite FK); its Vehicle
--   is resolved THROUGH the visit and mirrored under a hard coherence lock (never
--   re-copied editably; design F13). Reception preconditions are enforced at insert
--   (design §6): the visit must be authorized/converted, with accepted custody and
--   an approved authorization. The lifecycle is the configurable state graph
--   (wo.work_order_states / transitions): a transition is valid only if an active
--   edge exists; terminal states are frozen (BR-WO-002 backstop). A second ORDINARY
--   work order per reception origin is blocked; a rework work order reuses the
--   original visit. The closure gate (blockers B1..B6) is added in a later migration
--   once its child tables exist.
--
-- Dependencies
--   org.branches; rec.reception_visits / custody_history / authorizations;
--   veh.vehicles; wo.work_order_states / work_order_transitions;
--   iam.current_tenant_id/allowed_*; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Objects created
--   Tables:    wo.work_orders
--   Functions: wo.guard_work_order_refs(), wo.guard_work_order_transition()
--   Triggers:  tg_work_orders_refs, tg_work_orders_transition,
--              tg_work_orders_immutable, tg_work_orders_touch_metadata
--   Policies:  sel/ins/upd_work_orders_scope
-- ============================================================================

CREATE TABLE wo.work_orders (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  reception_visit_id  uuid    NOT NULL,
  vehicle_id          uuid    NOT NULL,
  kind                text    NOT NULL DEFAULT 'ordinary',
  state               text    NOT NULL DEFAULT 'draft',
  parts_forward_state text    NOT NULL DEFAULT 'none',
  display_number      text    NULL,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_work_orders PRIMARY KEY (id),
  CONSTRAINT uq_work_orders_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_work_orders_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_work_orders_reception_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_work_orders_vehicle
    FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_work_orders_kind CHECK (kind IN ('ordinary', 'rework')),
  CONSTRAINT ck_work_orders_parts_forward_state
    CHECK (parts_forward_state IN ('none', 'requested', 'reserved_elsewhere')),
  CONSTRAINT ck_work_orders_state_format CHECK (state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_work_orders_display_number_not_blank
    CHECK (display_number IS NULL OR btrim(display_number) <> '')
);
COMMENT ON TABLE wo.work_orders IS
  'Phase 1-9 Work Order master (P1-09-DB-003). Originates from exactly one Phase 1-8 reception visit (branch-scoped composite FK); Vehicle resolved through the visit and coherence-locked. kind ordinary|rework; a second ordinary WO per reception origin is blocked. State graph is configurable; terminal states frozen (BR-WO-002). parts_forward_state is a P1-10/P1-11 forward contract (no reservation enforced here).';
COMMENT ON COLUMN wo.work_orders.parts_forward_state IS
  'Forward contract for downstream parts reservation (P1-10/P1-11). none|requested|reserved_elsewhere. No stock reservation is enforced in Phase 1-9.';

-- One ORDINARY work order per reception origin (a rework WO reuses the visit).
CREATE UNIQUE INDEX uq_work_orders_ordinary_origin
  ON wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id)
  WHERE kind = 'ordinary' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_work_orders_active_display_number
  ON wo.work_orders (tenant_id, display_number)
  WHERE display_number IS NOT NULL AND deleted_at IS NULL;
-- Non-partial FK-covering indexes.
CREATE INDEX ix_work_orders_reception_visit
  ON wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_work_orders_vehicle ON wo.work_orders (tenant_id, vehicle_id);
CREATE INDEX ix_work_orders_open_by_branch
  ON wo.work_orders (tenant_id, company_id, branch_id, state) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Reference + precondition guard (BEFORE INSERT/UPDATE).
--   * Vehicle coherence: vehicle_id must equal the reception visit's Vehicle
--     (INSERT and UPDATE — vehicle_id is also in the immutable list, F13).
--   * INSERT preconditions: the visit is authorized/converted, has accepted
--     custody, and an approved authorization; and the initial state is non-terminal
--     (F6 — a WO cannot be born closed/terminal).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wo.guard_work_order_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_visit_vehicle uuid;
  v_visit_status  text;
  v_is_terminal   boolean;
BEGIN
  SELECT vehicle_id, reception_status INTO v_visit_vehicle, v_visit_status
  FROM rec.reception_visits
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = NEW.reception_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reception visit % is not visible in this scope', NEW.reception_visit_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_visit_vehicle IS DISTINCT FROM NEW.vehicle_id THEN
    RAISE EXCEPTION 'work order Vehicle % does not match reception visit Vehicle %',
      NEW.vehicle_id, v_visit_vehicle USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Reception origin must be authorized (or already converted).
    IF v_visit_status NOT IN ('authorized', 'converted') THEN
      RAISE EXCEPTION 'reception visit % must be authorized or converted (is %) before a work order originates',
        NEW.reception_visit_id, v_visit_status USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM rec.authorizations a
      WHERE a.tenant_id = NEW.tenant_id AND a.company_id = NEW.company_id
        AND a.branch_id = NEW.branch_id AND a.reception_visit_id = NEW.reception_visit_id
        AND a.decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'reception visit % has no approved authorization', NEW.reception_visit_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM rec.custody_history ch
      WHERE ch.tenant_id = NEW.tenant_id AND ch.company_id = NEW.company_id
        AND ch.branch_id = NEW.branch_id AND ch.reception_visit_id = NEW.reception_visit_id
        AND ch.to_state = 'accepted'
    ) THEN
      RAISE EXCEPTION 'reception visit % has no accepted custody', NEW.reception_visit_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- F6: a work order may not be created directly in a terminal state.
    SELECT is_terminal INTO v_is_terminal FROM wo.work_order_states
    WHERE code = NEW.state AND (scope = 'platform' OR tenant_id = NEW.tenant_id)
      AND status = 'active' AND deleted_at IS NULL
    ORDER BY (scope = 'tenant') DESC LIMIT 1;
    IF v_is_terminal IS NULL THEN
      RAISE EXCEPTION 'work order initial state % is not a defined active state', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_is_terminal THEN
      RAISE EXCEPTION 'work order cannot be created in terminal state %', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_work_order_refs() IS
  'BEFORE INSERT/UPDATE on wo.work_orders: Vehicle-vs-visit coherence (always); at INSERT enforces reception authorized/converted + approved authorization + accepted custody and a non-terminal initial state (F6). SECURITY INVOKER (caller RLS).';
REVOKE EXECUTE ON FUNCTION wo.guard_work_order_refs() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Transition guard (BEFORE UPDATE OF state).
--   * Terminal-freeze: no outbound transition from a terminal state, regardless of
--     any configured edge (BR-WO-002 backstop; design F1.4).
--   * Graph: an ACTIVE edge (platform or own-tenant) for (OLD.state,NEW.state) must
--     exist; the target state must be defined and active.
--   * Reason: if the edge or target state requires a reason, app.status_reason must
--     be set.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wo.guard_work_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_old_terminal boolean;
  v_target_active boolean;
  v_target_reason boolean;
  v_edge_reason   boolean;
  v_reason        text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  SELECT is_terminal INTO v_old_terminal FROM wo.work_order_states
  WHERE code = OLD.state AND (scope = 'platform' OR tenant_id = NEW.tenant_id)
    AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_old_terminal THEN
    RAISE EXCEPTION 'work order state % is terminal; no transition is permitted (BR-WO-002)', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT (status = 'active'), reason_required INTO v_target_active, v_target_reason
  FROM wo.work_order_states
  WHERE code = NEW.state AND (scope = 'platform' OR tenant_id = NEW.tenant_id)
    AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_target_active IS NULL THEN
    RAISE EXCEPTION 'work order target state % is not a defined state', NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_target_active THEN
    RAISE EXCEPTION 'work order target state % is inactive', NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT requires_reason INTO v_edge_reason FROM wo.work_order_transitions
  WHERE from_state = OLD.state AND to_state = NEW.state AND is_active
    AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_edge_reason IS NULL THEN
    RAISE EXCEPTION 'no active work-order transition % -> % in the approved graph', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF (v_edge_reason OR v_target_reason) AND v_reason IS NULL THEN
    RAISE EXCEPTION 'work-order transition % -> % requires a reason (set app.status_reason)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_work_order_transition() IS
  'BEFORE UPDATE OF state on wo.work_orders: terminal-freeze (BR-WO-002), configurable-graph edge validity (active, visible), and reason enforcement. SECURITY INVOKER.';
REVOKE EXECUTE ON FUNCTION wo.guard_work_order_transition() FROM PUBLIC;

CREATE TRIGGER tg_work_orders_refs
  BEFORE INSERT OR UPDATE OF reception_visit_id, vehicle_id, state ON wo.work_orders
  FOR EACH ROW EXECUTE FUNCTION wo.guard_work_order_refs();
CREATE TRIGGER tg_work_orders_transition
  BEFORE UPDATE OF state ON wo.work_orders
  FOR EACH ROW EXECUTE FUNCTION wo.guard_work_order_transition();
CREATE TRIGGER tg_work_orders_immutable
  BEFORE UPDATE ON wo.work_orders
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'vehicle_id', 'kind',
    'opened_at', 'created_at', 'created_by');
CREATE TRIGGER tg_work_orders_touch_metadata
  BEFORE UPDATE ON wo.work_orders
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE wo.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.work_orders FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_work_orders_scope ON wo.work_orders FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_work_orders_scope ON wo.work_orders FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_work_orders_scope ON wo.work_orders FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.work_orders TO app_runtime;
GRANT SELECT ON wo.work_orders TO app_readonly;
