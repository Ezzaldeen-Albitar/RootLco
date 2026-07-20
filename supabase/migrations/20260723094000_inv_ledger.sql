-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: inventory ledger — immutable movements, balances, reservations
-- Tasks: P1-10-DB (inv ledger); FR-INV-001/002/003, BR-INV-001/002
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   movements exist. Forward-only — no down script.
--
-- Purpose
--   The immutable stock ledger and its derived, coherence-guarded balances, plus
--   the atomic reservation primitive.
--     * inv.stock_movements — append-only (SELECT+INSERT only); signed_qty is
--       GENERATED from direction × quantity (sign cannot be decoupled); each row
--       consumes exactly one source (UNIQUE reference_kind, reference_id, direction).
--       Per-kind PROVENANCE is enforced in the operations migration (095000), once
--       the source tables exist — the constraints here are the trust root that a
--       raw INSERT cannot bypass.
--     * inv.stock_balances — on_hand/reserved/available per (item, location);
--       maintained only as a delta consistent with a just-posted movement/
--       reservation, and re-verified by a coherence guard (on_hand = Σ signed
--       movements; reserved = Σ ACTIVE reservations by status column only). A forged
--       or incoherent balance write fails 23514 (BR-INV-002 without SECURITY DEFINER).
--     * inv.stock_reservations — atomic reserve/release/consume/expire; the last-unit
--       race is serialized on the balance-row FOR UPDATE lock; idempotency spans the
--       whole reservation lifetime.
--
-- Design gate amendments: signed_qty GENERATED (C1/C2), status-only reservation
--   activeness + explicit expiry (H8), available>=0 via loss-time release (H9),
--   lifetime idempotency + in-lock resolution (H10), FOR UPDATE on every balance
--   writer (H14).
--
-- Dependencies
--   inv.item_master, inv.stock_locations; wo.work_orders; org.branches;
--   iam.current_tenant_id/current_user_id; shared.touch_row_metadata;
--   org.guard_immutable_columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. inv.stock_movements — immutable append-only ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_movements (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  item_id        uuid    NOT NULL,
  location_id    uuid    NOT NULL,
  movement_type  text    NOT NULL,
  direction      text    NOT NULL,
  quantity       numeric(12, 3) NOT NULL,
  signed_qty     numeric(12, 3) GENERATED ALWAYS AS (CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) STORED,
  reference_kind text    NOT NULL,
  reference_id   uuid    NOT NULL,
  occurred_at    timestamptz NOT NULL,
  actor_id       uuid    NOT NULL,
  correlation_id uuid    NULL,
  notes          text    NULL,
  seq            bigint  GENERATED ALWAYS AS IDENTITY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,

  CONSTRAINT pk_stock_movements PRIMARY KEY (id),
  CONSTRAINT fk_stock_movements_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_movements_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_movements_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_movements_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_movements_quantity CHECK (quantity > 0),
  CONSTRAINT ck_stock_movements_type CHECK (movement_type IN ('opening', 'issue', 'return', 'damage', 'adjustment')),
  CONSTRAINT ck_stock_movements_direction CHECK (direction IN ('in', 'out')),
  CONSTRAINT ck_stock_movements_type_direction CHECK (
    (movement_type IN ('opening', 'return') AND direction = 'in')
    OR (movement_type = 'issue' AND direction = 'out')
    OR (movement_type IN ('damage', 'adjustment'))),
  CONSTRAINT ck_stock_movements_reference_kind CHECK (reference_kind IN ('opening_line', 'part_issue', 'part_return', 'damage', 'adjustment')),
  CONSTRAINT ck_stock_movements_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
COMMENT ON TABLE inv.stock_movements IS 'Phase 1-10 immutable append-only stock ledger (BR-INV-002/FR-INV-003). signed_qty GENERATED from direction; each source consumed once (single-use unique). Per-kind provenance enforced in 095000.';
-- single-use: one movement per source per direction (damage uses two: out sellable, in quarantine).
CREATE UNIQUE INDEX uq_stock_movements_source ON inv.stock_movements (reference_kind, reference_id, direction);
CREATE INDEX ix_stock_movements_item_location ON inv.stock_movements (tenant_id, company_id, branch_id, item_id, location_id, occurred_at, seq);
CREATE INDEX ix_stock_movements_branch ON inv.stock_movements (tenant_id, company_id, branch_id);
CREATE INDEX ix_stock_movements_item ON inv.stock_movements (tenant_id, item_id);
CREATE INDEX ix_stock_movements_location ON inv.stock_movements (tenant_id, company_id, branch_id, location_id);
CREATE TRIGGER tg_stock_movements_stamp BEFORE INSERT ON inv.stock_movements
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();
ALTER TABLE inv.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_movements FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_movements_scope ON inv.stock_movements FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_movements_scope ON inv.stock_movements FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON inv.stock_movements TO app_runtime;
GRANT SELECT ON inv.stock_movements TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. inv.stock_balances — derived, coherence-guarded.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_balances (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  item_id        uuid    NOT NULL,
  location_id    uuid    NOT NULL,
  on_hand_qty    numeric(12, 3) NOT NULL DEFAULT 0,
  reserved_qty   numeric(12, 3) NOT NULL DEFAULT 0,
  available_qty  numeric(12, 3) GENERATED ALWAYS AS (on_hand_qty - reserved_qty) STORED,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,

  CONSTRAINT pk_stock_balances PRIMARY KEY (id),
  CONSTRAINT uq_stock_balances_cell UNIQUE (tenant_id, company_id, branch_id, item_id, location_id),
  CONSTRAINT fk_stock_balances_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_balances_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_balances_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_balances_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_balances_on_hand CHECK (on_hand_qty >= 0),
  CONSTRAINT ck_stock_balances_reserved CHECK (reserved_qty >= 0),
  CONSTRAINT ck_stock_balances_available CHECK (on_hand_qty - reserved_qty >= 0)
);
COMMENT ON TABLE inv.stock_balances IS 'Phase 1-10 movement-derived balance per (item, location). on_hand = Σ signed movements; reserved = Σ active reservations; available GENERATED. Coherence guard rejects any forged/incoherent write (23514).';
CREATE INDEX ix_stock_balances_item ON inv.stock_balances (tenant_id, item_id);
CREATE INDEX ix_stock_balances_location ON inv.stock_balances (tenant_id, company_id, branch_id, location_id);

CREATE OR REPLACE FUNCTION inv.guard_stock_balance_coherence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_movements numeric(12, 3); v_reserved numeric(12, 3);
BEGIN
  SELECT COALESCE(SUM(signed_qty), 0) INTO v_movements FROM inv.stock_movements
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id
      AND item_id = NEW.item_id AND location_id = NEW.location_id;
  IF NEW.on_hand_qty <> v_movements THEN
    RAISE EXCEPTION 'inv.stock_balances: on_hand_qty % does not equal the movement ledger sum %', NEW.on_hand_qty, v_movements USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO v_reserved FROM inv.stock_reservations
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id
      AND item_id = NEW.item_id AND location_id = NEW.location_id AND status = 'active';
  IF NEW.reserved_qty <> v_reserved THEN
    RAISE EXCEPTION 'inv.stock_balances: reserved_qty % does not equal the active reservation sum %', NEW.reserved_qty, v_reserved USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_balance_coherence() FROM PUBLIC;

CREATE TRIGGER tg_stock_balances_coherence BEFORE INSERT OR UPDATE ON inv.stock_balances
  FOR EACH ROW EXECUTE FUNCTION inv.guard_stock_balance_coherence();
CREATE TRIGGER tg_stock_balances_touch_metadata BEFORE UPDATE ON inv.stock_balances
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_balances_immutable BEFORE UPDATE ON inv.stock_balances
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'item_id', 'location_id', 'created_at', 'created_by');
ALTER TABLE inv.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_balances FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_balances_scope ON inv.stock_balances FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_balances_scope ON inv.stock_balances FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_balances_scope ON inv.stock_balances FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_balances TO app_runtime;
GRANT SELECT ON inv.stock_balances TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. inv.stock_reservations — atomic reservations.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_reservations (
  id              uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid    NOT NULL,
  company_id      uuid    NOT NULL,
  branch_id       uuid    NOT NULL,
  item_id         uuid    NOT NULL,
  location_id     uuid    NOT NULL,
  work_order_id   uuid    NULL,
  quantity        numeric(12, 3) NOT NULL,
  status          text    NOT NULL DEFAULT 'active',
  idempotency_key text    NULL,
  correlation_id  uuid    NULL,
  expires_at      timestamptz NULL,
  released_reason text    NULL,
  record_version  integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid    NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid    NULL,

  CONSTRAINT pk_stock_reservations PRIMARY KEY (id),
  CONSTRAINT uq_stock_reservations_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_stock_reservations_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_reservations_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_reservations_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_reservations_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_reservations_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id) REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_reservations_quantity CHECK (quantity > 0),
  CONSTRAINT ck_stock_reservations_status CHECK (status IN ('active', 'released', 'consumed', 'expired')),
  CONSTRAINT ck_stock_reservations_released_reason CHECK (released_reason IS NULL OR btrim(released_reason) <> '')
);
COMMENT ON TABLE inv.stock_reservations IS 'Phase 1-10 atomic stock reservations (FR-INV-002). Single-winner last-unit race via balance-row FOR UPDATE. Idempotency spans the whole lifetime. active is a status only (never time-derived).';
CREATE UNIQUE INDEX uq_stock_reservations_idempotency ON inv.stock_reservations (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_stock_reservations_cell_active ON inv.stock_reservations (tenant_id, company_id, branch_id, item_id, location_id) WHERE status = 'active';
CREATE INDEX ix_stock_reservations_item ON inv.stock_reservations (tenant_id, item_id);
CREATE INDEX ix_stock_reservations_location ON inv.stock_reservations (tenant_id, company_id, branch_id, location_id);
CREATE INDEX ix_stock_reservations_work_order ON inv.stock_reservations (tenant_id, company_id, branch_id, work_order_id);

CREATE OR REPLACE FUNCTION inv.guard_stock_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inv.stock_reservations: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_reservation_status() FROM PUBLIC;

CREATE TRIGGER tg_stock_reservations_status BEFORE UPDATE ON inv.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION inv.guard_stock_reservation_status();
CREATE TRIGGER tg_stock_reservations_touch_metadata BEFORE UPDATE ON inv.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_reservations_immutable BEFORE UPDATE ON inv.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'item_id', 'location_id', 'work_order_id', 'quantity', 'idempotency_key', 'created_at', 'created_by');
ALTER TABLE inv.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_reservations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_reservations_scope ON inv.stock_reservations FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_reservations_scope ON inv.stock_reservations FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_reservations_scope ON inv.stock_reservations FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_reservations TO app_runtime;
GRANT SELECT ON inv.stock_reservations TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. Ledger primitives (all SECURITY INVOKER; app_runtime executes them).
-- ----------------------------------------------------------------------------

-- Ensure a balance row exists and return it locked FOR UPDATE.
CREATE OR REPLACE FUNCTION inv.lock_stock_balance(p_tenant uuid, p_company uuid, p_branch uuid, p_item uuid, p_location uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Create the (coherent, zero) balance row ONLY when truly absent — a fresh cell
  -- has no movements, so on_hand/reserved = 0 satisfies the coherence guard. Using
  -- ON CONFLICT DO NOTHING would fire the BEFORE INSERT coherence trigger on the
  -- proposed zero row even when the real row already holds stock, so avoid it.
  IF NOT EXISTS (
    SELECT 1 FROM inv.stock_balances
    WHERE tenant_id = p_tenant AND company_id = p_company AND branch_id = p_branch AND item_id = p_item AND location_id = p_location
  ) THEN
    BEGIN
      INSERT INTO inv.stock_balances (tenant_id, company_id, branch_id, item_id, location_id, created_by)
        VALUES (p_tenant, p_company, p_branch, p_item, p_location, iam.current_user_id());
    EXCEPTION WHEN unique_violation THEN
      NULL; -- a concurrent creator won the race; we lock its row below
    END;
  END IF;
  PERFORM 1 FROM inv.stock_balances
    WHERE tenant_id = p_tenant AND company_id = p_company AND branch_id = p_branch AND item_id = p_item AND location_id = p_location
    FOR UPDATE;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.lock_stock_balance(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.lock_stock_balance(uuid, uuid, uuid, uuid, uuid) TO app_runtime;

-- Post a movement and apply the consistent on_hand delta under the balance lock.
CREATE OR REPLACE FUNCTION inv.post_stock_movement(
  p_item uuid, p_location uuid, p_type text, p_direction text, p_qty numeric,
  p_ref_kind text, p_ref_id uuid, p_correlation uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_co uuid; v_br uuid; v_mid uuid; v_signed numeric(12, 3);
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.post_stock_movement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT company_id, branch_id INTO v_co, v_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_location;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock location % not found in tenant', p_location USING ERRCODE = 'foreign_key_violation'; END IF;
  PERFORM inv.lock_stock_balance(v_tenant, v_co, v_br, p_item, p_location);
  INSERT INTO inv.stock_movements (tenant_id, company_id, branch_id, item_id, location_id, movement_type, direction, quantity, reference_kind, reference_id, occurred_at, actor_id, correlation_id, notes, created_by)
    VALUES (v_tenant, v_co, v_br, p_item, p_location, p_type, p_direction, p_qty, p_ref_kind, p_ref_id, now(), iam.current_user_id(), p_correlation, p_notes, iam.current_user_id())
    RETURNING id, signed_qty INTO v_mid, v_signed;
  UPDATE inv.stock_balances SET on_hand_qty = on_hand_qty + v_signed
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = p_item AND location_id = p_location;
  RETURN v_mid;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.post_stock_movement(uuid, uuid, text, text, numeric, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.post_stock_movement(uuid, uuid, text, text, numeric, text, uuid, uuid, text) TO app_runtime;

-- Reconcile a cell's reserved_qty to the active-reservation sum under the caller's lock.
CREATE OR REPLACE FUNCTION inv.sync_reserved(p_tenant uuid, p_company uuid, p_branch uuid, p_item uuid, p_location uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_reserved numeric(12, 3);
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO v_reserved FROM inv.stock_reservations
    WHERE tenant_id = p_tenant AND company_id = p_company AND branch_id = p_branch AND item_id = p_item AND location_id = p_location AND status = 'active';
  UPDATE inv.stock_balances SET reserved_qty = v_reserved
    WHERE tenant_id = p_tenant AND company_id = p_company AND branch_id = p_branch AND item_id = p_item AND location_id = p_location;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.sync_reserved(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.sync_reserved(uuid, uuid, uuid, uuid, uuid) TO app_runtime;

-- Atomic reservation (single-winner last-unit race; lifetime idempotency).
CREATE OR REPLACE FUNCTION inv.reserve_stock(
  p_item uuid, p_location uuid, p_qty numeric, p_work_order uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_co uuid; v_br uuid;
        v_onhand numeric(12, 3); v_reserved numeric(12, 3); v_existing uuid; v_res uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.reserve_stock requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'reservation quantity must be positive' USING ERRCODE = 'check_violation'; END IF;
  SELECT company_id, branch_id INTO v_co, v_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_location;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock location % not found in tenant', p_location USING ERRCODE = 'foreign_key_violation'; END IF;
  PERFORM inv.lock_stock_balance(v_tenant, v_co, v_br, p_item, p_location);
  -- idempotency: in-lock resolution (return the existing reservation on replay)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM inv.stock_reservations WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  -- opportunistic expiry of stale active reservations for this cell
  UPDATE inv.stock_reservations SET status = 'expired', released_reason = 'expired'
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = p_item AND location_id = p_location
      AND status = 'active' AND expires_at IS NOT NULL AND expires_at < now();
  SELECT on_hand_qty INTO v_onhand FROM inv.stock_balances
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = p_item AND location_id = p_location;
  SELECT COALESCE(SUM(quantity), 0) INTO v_reserved FROM inv.stock_reservations
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = p_item AND location_id = p_location AND status = 'active';
  IF p_qty > v_onhand - v_reserved THEN
    RAISE EXCEPTION 'insufficient available stock (requested %, available %)', p_qty, v_onhand - v_reserved USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO inv.stock_reservations (tenant_id, company_id, branch_id, item_id, location_id, work_order_id, quantity, status, idempotency_key, expires_at, correlation_id, created_by)
    VALUES (v_tenant, v_co, v_br, p_item, p_location, p_work_order, p_qty, 'active', p_idempotency_key, p_expires_at, p_correlation, iam.current_user_id())
    RETURNING id INTO v_res;
  PERFORM inv.sync_reserved(v_tenant, v_co, v_br, p_item, p_location);
  RETURN v_res;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.reserve_stock(uuid, uuid, numeric, uuid, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.reserve_stock(uuid, uuid, numeric, uuid, text, timestamptz, uuid) TO app_runtime;

-- Release / consume / expire.
CREATE OR REPLACE FUNCTION inv.release_reservation(p_reservation_id uuid, p_reason text DEFAULT 'released')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.stock_reservations%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO r FROM inv.stock_reservations WHERE tenant_id = v_tenant AND id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation % not found', p_reservation_id USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status <> 'active' THEN RETURN; END IF;
  PERFORM inv.lock_stock_balance(v_tenant, r.company_id, r.branch_id, r.item_id, r.location_id);
  UPDATE inv.stock_reservations SET status = 'released', released_reason = p_reason WHERE tenant_id = v_tenant AND id = p_reservation_id;
  PERFORM inv.sync_reserved(v_tenant, r.company_id, r.branch_id, r.item_id, r.location_id);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.release_reservation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.release_reservation(uuid, text) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.consume_reservation(p_reservation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.stock_reservations%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO r FROM inv.stock_reservations WHERE tenant_id = v_tenant AND id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation % not found', p_reservation_id USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'reservation % is % and cannot be consumed', p_reservation_id, r.status USING ERRCODE = 'check_violation'; END IF;
  PERFORM inv.lock_stock_balance(v_tenant, r.company_id, r.branch_id, r.item_id, r.location_id);
  UPDATE inv.stock_reservations SET status = 'consumed' WHERE tenant_id = v_tenant AND id = p_reservation_id;
  PERFORM inv.sync_reserved(v_tenant, r.company_id, r.branch_id, r.item_id, r.location_id);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.consume_reservation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.consume_reservation(uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.expire_reservations(p_item uuid DEFAULT NULL, p_location uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_count int := 0; v_batch int := 0; cell RECORD;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  FOR cell IN
    SELECT DISTINCT company_id, branch_id, item_id, location_id FROM inv.stock_reservations
    WHERE tenant_id = v_tenant AND status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
      AND (p_item IS NULL OR item_id = p_item) AND (p_location IS NULL OR location_id = p_location)
  LOOP
    PERFORM inv.lock_stock_balance(v_tenant, cell.company_id, cell.branch_id, cell.item_id, cell.location_id);
    UPDATE inv.stock_reservations SET status = 'expired', released_reason = 'expired'
      WHERE tenant_id = v_tenant AND company_id = cell.company_id AND branch_id = cell.branch_id
        AND item_id = cell.item_id AND location_id = cell.location_id AND status = 'active' AND expires_at IS NOT NULL AND expires_at < now();
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_count := v_count + v_batch;
    PERFORM inv.sync_reserved(v_tenant, cell.company_id, cell.branch_id, cell.item_id, cell.location_id);
  END LOOP;
  RETURN v_count;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.expire_reservations(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.expire_reservations(uuid, uuid) TO app_runtime;
