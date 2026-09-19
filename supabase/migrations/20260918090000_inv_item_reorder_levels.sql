-- ============================================================================
-- Phase: 1-32 (preparatory) — the level an item is allowed to fall to
-- Migration: inv.item_reorder_levels
-- Tasks: P1-32-PRE-170
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE. Nothing here is cited by a ledger row,
--   a document or an amount: the table is read by alert operations only and no
--   movement, invoice or adjustment references it. Forward-only all the same —
--   no down script.
--
-- Purpose
--   The `inv` schema could say what a branch HOLDS and could not say what it
--   OUGHT to hold. `inv.stock_balances` carries on-hand, reserved and the
--   generated available quantity, and every read over it answers "how much is
--   there". Nothing anywhere declared the quantity below which that answer is a
--   problem, so "low stock" was not a fact this platform could state — only a
--   number a reader had to judge for themselves, differently each time.
--
--   This table is that declaration, and it is DATA rather than a rule in code:
--   the level for a filter at a busy branch is not the level for the same filter
--   at a quiet one, and a threshold compiled into a query could not express the
--   difference without a release.
--
--     * ONE THRESHOLD, NOT TWO. `reorder_level_qty` is the minimum — equivalently
--       the reorder point — and there is exactly one of it. A separate "minimum"
--       and "reorder" pair would immediately raise the question which of the two
--       the low-stock read compares against, and any answer to that question
--       makes the other column decoration. `preferred_order_qty` is a different
--       kind of fact (how much to buy, not when) and is optional, because a
--       tenant that has not decided it must not be made to invent one.
--
--     * NARROWING, EXACTLY AS inv.item_sale_prices DOES IT. A row may name
--       nothing (every branch of every company), a company, a company and a
--       branch, or a company, a branch and a stock location. The pattern is
--       deliberately the one the selling price already uses — same NULL meaning,
--       same NULLS NOT DISTINCT unique signature, same most-specific-wins
--       resolution — so an operator learns one rule rather than two.
--
--     * A LOCATION ROW AND A BRANCH ROW ARE DIFFERENT ALERTS, NOT RIVALS. A row
--       naming a location is about that shelf; a row naming no location is about
--       the branch as a whole. They do not compete for one answer, so the
--       resolution key is (item, location) and not (item) — which is why the
--       unique index spans the location column too.
--
--     * QUANTITIES ARE EXACT. `numeric(12, 3)`, matching every other quantity in
--       this schema, so a level can be compared with a balance without a cast
--       that changes the value.
--
--     * RETIREMENT IS A STATE, NOT A DELETE. A retired level keeps its row and
--       its `record_version`, so the trail of what the branch once thought it
--       needed survives the day it changed its mind. The unique signature is
--       partial on `status = 'active'`, so retiring one frees the signature for
--       a replacement without either row being rewritten.
--
--   NOTHING HERE MOVES STOCK. The table has no movement, no balance and no
--   adjustment. It is read by alert operations and by nothing else.
--
-- Dependencies
--   inv.item_master, inv.stock_locations (20260723093000); org.tenants,
--   org.legal_companies, org.branches; iam.current_tenant_id,
--   iam.allowed_company_ids, iam.allowed_branch_ids; org.guard_immutable_columns;
--   shared.touch_row_metadata.
-- ============================================================================

CREATE TABLE inv.item_reorder_levels (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  item_id             uuid NOT NULL,
  -- NULL company means every company of the tenant; NULL branch means every
  -- branch of the named company; NULL location means the named branch taken as a
  -- whole rather than one shelf in it.
  company_id          uuid NULL,
  branch_id           uuid NULL,
  location_id         uuid NULL,
  reorder_level_qty   numeric(12, 3) NOT NULL,
  preferred_order_qty numeric(12, 3) NULL,
  status              text NOT NULL DEFAULT 'active',
  retired_at          timestamptz NULL,
  retired_by          uuid NULL,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid NULL,

  CONSTRAINT pk_item_reorder_levels PRIMARY KEY (id),
  CONSTRAINT uq_item_reorder_levels_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_item_reorder_levels_tenant FOREIGN KEY (tenant_id)
    REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_reorder_levels_item FOREIGN KEY (tenant_id, item_id)
    REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_reorder_levels_company FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_reorder_levels_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_reorder_levels_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id)
    REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  -- Zero is a legitimate level: "tell me the moment this runs out". A negative
  -- one is not a level at all.
  CONSTRAINT ck_item_reorder_levels_quantity CHECK (reorder_level_qty >= 0),
  -- An order of nothing is not an order. NULL is how "not decided" is said.
  CONSTRAINT ck_item_reorder_levels_preferred CHECK (preferred_order_qty IS NULL OR preferred_order_qty > 0),
  CONSTRAINT ck_item_reorder_levels_status CHECK (status IN ('active', 'retired')),
  CONSTRAINT ck_item_reorder_levels_retired CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  CONSTRAINT ck_item_reorder_levels_retired_by CHECK (retired_at IS NULL OR retired_by IS NOT NULL),
  -- A branch row must name its company and a location row must name its branch:
  -- both foreign keys span the wider scope, and a level narrowed to a branch
  -- whose company is unknown could not be resolved against a balance.
  CONSTRAINT ck_item_reorder_levels_branch_needs_company CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT ck_item_reorder_levels_location_needs_branch CHECK (location_id IS NULL OR branch_id IS NOT NULL)
);
COMMENT ON TABLE inv.item_reorder_levels IS 'The quantity at or below which an item counts as low, optionally narrowed to a company, a branch and a stock location, with an optional preferred order quantity. One ACTIVE row per (tenant, item, company, branch, location) — uq_item_reorder_levels_signature, NULLS NOT DISTINCT — so resolution is deterministic without a tie-break. Read by the low-stock alert and by nothing else; it moves no stock and holds no money.';
COMMENT ON COLUMN inv.item_reorder_levels.company_id IS 'NULL applies the level to every company of the tenant.';
COMMENT ON COLUMN inv.item_reorder_levels.branch_id IS 'NULL applies the level to every branch of the named company.';
COMMENT ON COLUMN inv.item_reorder_levels.location_id IS 'NULL makes the level about the branch as a whole; a named location makes it about that location only. The two are different alerts, not rivals.';
COMMENT ON COLUMN inv.item_reorder_levels.reorder_level_qty IS 'The minimum, equivalently the reorder point: available stock at or below this quantity is low. Zero means "tell me when it runs out".';
COMMENT ON COLUMN inv.item_reorder_levels.preferred_order_qty IS 'How much the tenant prefers to order when the level is reached. NULL means undecided — never a default quantity nobody chose.';

CREATE UNIQUE INDEX uq_item_reorder_levels_signature
  ON inv.item_reorder_levels (tenant_id, item_id, company_id, branch_id, location_id) NULLS NOT DISTINCT
  WHERE status = 'active';
CREATE INDEX ix_item_reorder_levels_item ON inv.item_reorder_levels (tenant_id, item_id);
CREATE INDEX ix_item_reorder_levels_company ON inv.item_reorder_levels (tenant_id, company_id);
CREATE INDEX ix_item_reorder_levels_branch ON inv.item_reorder_levels (tenant_id, company_id, branch_id);
CREATE INDEX ix_item_reorder_levels_location ON inv.item_reorder_levels (tenant_id, company_id, branch_id, location_id);
CREATE INDEX ix_item_reorder_levels_status ON inv.item_reorder_levels (tenant_id, status, item_id);

CREATE TRIGGER tg_item_reorder_levels_touch_metadata BEFORE UPDATE ON inv.item_reorder_levels
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
-- The narrowing columns are frozen. Moving a live level from one branch to
-- another would silently re-target an alert somebody is already acting on, and
-- the honest way to say "not here, there" is to retire one row and set another.
CREATE TRIGGER tg_item_reorder_levels_immutable BEFORE UPDATE ON inv.item_reorder_levels
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'item_id', 'company_id', 'branch_id', 'location_id', 'created_at', 'created_by');

ALTER TABLE inv.item_reorder_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_reorder_levels FORCE  ROW LEVEL SECURITY;
-- Readable tenant-wide, exactly like inv.item_sale_prices and for the same
-- reason: a tenant-wide row (company NULL) is the level that actually applies at
-- every branch, so a company predicate on SELECT would hide the level a branch is
-- being measured against. The WRITE policies narrow, so a session scoped to one
-- company can neither create nor alter another company's level.
CREATE POLICY sel_item_reorder_levels_tenant ON inv.item_reorder_levels FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_item_reorder_levels_scope ON inv.item_reorder_levels FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (company_id IS NULL OR iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (branch_id IS NULL OR iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_item_reorder_levels_scope ON inv.item_reorder_levels FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (company_id IS NULL OR iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (branch_id IS NULL OR iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (company_id IS NULL OR iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (branch_id IS NULL OR iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON inv.item_reorder_levels TO app_runtime;
GRANT SELECT ON inv.item_reorder_levels TO app_readonly;
