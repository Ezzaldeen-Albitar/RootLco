-- ============================================================================
-- P1-32-PRE-OD-FD8 (fix round 4) — no self-benefit from changing which price list
-- applies (Owner decision D8, ADR-023, approved 2026-09-30).
-- Owner module: quo (the D8 rule and the line snapshot), svc (who made a
--   price-list assignment)
--
-- Rollback classification: ROLLBACK-SAFE. Eight nullable or defaulted columns, one
--   CHECK, one new trigger function and its trigger; two functions re-issued under
--   their own names and signatures. Forward-only — the inverse at the foot of this
--   file is for a rehearsal copy only.
--
-- Purpose
--   D8: "Changing one's own threshold, role limit or price list never exempts one's
--   own quotation from approval. Provenance and snapshots are kept. There is no
--   sole-administrator exception."
--
--   svc.resolve_price picks the price list through svc.price_list_assignments: the
--   most specific active assignment covering the company, branch and customer class
--   wins. Nothing recorded who made an assignment, and the D8 basis looked only at
--   who set, changed or published the rule's amount. So a requester could point their
--   own branch at a cheaper list somebody else had published — with a threshold of
--   50, 90 off a price of 100 needs another person; the requester assigns a list
--   pricing the service at 10 to their branch and quotes at 10 with no discount —
--   and the customer got the same 90 off with nobody approving it. A sole
--   administrator could do exactly this.
--
--   FIX:
--     * svc.price_list_assignments records, from the session and never from the
--       writer, who made the assignment (assigned_by / assigned_at, stamped on
--       INSERT and never moved) and everyone who ever changed what it selects
--       afterwards — its list, company, branch, customer class, priority, dates,
--       status or deletion (assignment_changed_by, appended and never removed; a
--       save that changes none of them records nothing). The new trigger function
--       svc.stamp_price_list_assignment_provenance keeps both.
--     * quo.quotation_items records the customer class the line was priced for
--       (price_customer_class, written by the application exactly as it asked
--       svc.resolve_price) and snapshots, when the line is written, the assignment
--       that selected the list of the line's price rule (price_assignment_ref) with
--       who made it (price_assigned_by / price_assigned_at) and who had changed it
--       (price_assignment_changed_by). The assignment is chosen by
--       quo.snapshot_quotation_item_price_provenance with svc.resolve_price's own
--       filter and order, on the line's company, branch and customer class at the
--       transaction's date (the business date the application priced the line
--       on), among the assignments naming the list the rule belongs to — so it is
--       the assignment that resolved the price, and, should another person change
--       the assignments between the read of the price and the write of the line,
--       still the one that selects that list.
--     * quo.revision_self_change_basis counts a line as the requester's own price
--       also when the requester made, or ever changed, the assignment snapshotted
--       on it, and when the requester ever changed ANY price-list assignment of the
--       tenant and the revision has a line priced from a price rule: ending,
--       narrowing or re-prioritising a competing assignment changes which list
--       applies without being the assignment that won, and a moved assignment no
--       longer says where it was. No route changes an assignment today (the
--       application only creates them), so this clause guards direct writers; it
--       is wider than the change itself, which never grants more.
--   Through the basis, the fix round 3 rule applies: such a revision needs approval
--   by somebody else whatever its discount, zero included, at the application when
--   it is written and at the database when it is issued.
--
-- Existing rows
--   assigned_by / assigned_at are backfilled from created_by / created_at, and
--   assignment_changed_by from updated_by where a row was updated — the closest
--   evidence the rows hold, not a verified attribution — with the row-metadata
--   trigger disabled so no record_version, updated_by or updated_at moves (the new
--   trigger is created after the backfill); a failure rolls the disable back with
--   everything else. Existing quotation lines keep NULL in the five new columns, so
--   only the tenant-wide clause of the basis reaches them. No assignment, line or
--   request is written otherwise.
--
-- Security implications
--   No new table, role, grant, policy or SECURITY DEFINER. app_runtime keeps its
--   table-level INSERT/UPDATE on svc.price_list_assignments, and the trigger sets the
--   three stamp columns on every insert and update whoever writes. The new function
--   and the re-issued ones are SECURITY INVOKER with a locked search_path, and
--   EXECUTE is revoked from PUBLIC (CREATE OR REPLACE keeps the basis function's
--   ACL: EXECUTE for app_runtime only).
--
-- Dependencies
--   20260723092000 (svc.price_list_assignments, svc.resolve_price),
--   20261007090000 and 20261007100000 (the line snapshot and the D8 basis),
--   20261007120000 (a self-set price needs another person at any discount).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. svc.price_list_assignments — who made it, and who ever changed what it selects.
-- ----------------------------------------------------------------------------
ALTER TABLE svc.price_list_assignments
  ADD COLUMN assigned_by           uuid        NULL,
  ADD COLUMN assigned_at           timestamptz NULL,
  ADD COLUMN assignment_changed_by uuid[]      NOT NULL DEFAULT ARRAY[]::uuid[];
COMMENT ON COLUMN svc.price_list_assignments.assigned_by IS
  'Who made this assignment (P1-32-PRE-OD-FD8 fix round 4, ADR-023 D8): the signed-in person, stamped by svc.stamp_price_list_assignment_provenance on insert and never moved, whatever the writer supplied. NULL when nobody was signed in. Rows written before migration 20261007130000 carry created_by.';
COMMENT ON COLUMN svc.price_list_assignments.assigned_at IS
  'When assigned_by made the assignment (P1-32-PRE-OD-FD8 fix round 4).';
COMMENT ON COLUMN svc.price_list_assignments.assignment_changed_by IS
  'Everyone who ever changed what this assignment selects — its price list, company, branch, customer class, priority, dates, status or deletion — after it was made (P1-32-PRE-OD-FD8 fix round 4, ADR-023 D8): appended from the signed-in person by svc.stamp_price_list_assignment_provenance, never removed, and empty on insert whatever the writer supplied. A save that changes none of them records nothing. Rows updated before migration 20261007130000 carry their updated_by.';

ALTER TABLE svc.price_list_assignments DISABLE TRIGGER tg_price_list_assignments_touch_metadata;
UPDATE svc.price_list_assignments
   SET assigned_by = created_by,
       assigned_at = created_at,
       assignment_changed_by = CASE WHEN updated_by IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[updated_by] END;
ALTER TABLE svc.price_list_assignments ENABLE TRIGGER tg_price_list_assignments_touch_metadata;

CREATE OR REPLACE FUNCTION svc.stamp_price_list_assignment_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.assigned_by := iam.current_user_id();
    NEW.assigned_at := now();
    NEW.assignment_changed_by := ARRAY[]::uuid[];
    RETURN NEW;
  END IF;
  NEW.assigned_by := OLD.assigned_by;
  NEW.assigned_at := OLD.assigned_at;
  NEW.assignment_changed_by := OLD.assignment_changed_by;
  IF NEW.price_list_id IS DISTINCT FROM OLD.price_list_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.customer_class IS DISTINCT FROM OLD.customer_class
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    v_actor := iam.current_user_id();
    IF v_actor IS NOT NULL AND NOT (v_actor = ANY (OLD.assignment_changed_by)) THEN
      NEW.assignment_changed_by := OLD.assignment_changed_by || v_actor;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION svc.stamp_price_list_assignment_provenance() IS
  'BEFORE INSERT OR UPDATE on svc.price_list_assignments (P1-32-PRE-OD-FD8 fix round 4, ADR-023 D8): stamps assigned_by/assigned_at from the session on insert and keeps them; keeps assignment_changed_by append-only — empty on insert, the previous value on every update, and the signed-in person appended when what the assignment selects changes.';
REVOKE EXECUTE ON FUNCTION svc.stamp_price_list_assignment_provenance() FROM PUBLIC;

CREATE TRIGGER tg_price_list_assignments_provenance
  BEFORE INSERT OR UPDATE ON svc.price_list_assignments
  FOR EACH ROW EXECUTE FUNCTION svc.stamp_price_list_assignment_provenance();

-- ----------------------------------------------------------------------------
-- 2. quo.quotation_items — the customer class priced for, and the assignment snapshot.
-- ----------------------------------------------------------------------------
ALTER TABLE quo.quotation_items
  ADD COLUMN price_customer_class        text        NULL,
  ADD COLUMN price_assignment_ref        uuid        NULL,
  ADD COLUMN price_assigned_by           uuid        NULL,
  ADD COLUMN price_assigned_at           timestamptz NULL,
  ADD COLUMN price_assignment_changed_by uuid[]      NULL,
  ADD CONSTRAINT ck_quotation_items_price_customer_class
    CHECK (price_customer_class IS NULL OR price_customer_class ~ '^[a-z][a-z0-9_]{1,62}$');
COMMENT ON COLUMN quo.quotation_items.price_customer_class IS
  'The customer class a service line was priced for — the class the application passed to svc.resolve_price (P1-32-PRE-OD-FD8 fix round 4, ADR-023 D8). NULL for no class, for a part line, and for lines written before migration 20261007130000.';
COMMENT ON COLUMN quo.quotation_items.price_assignment_ref IS
  'The svc.price_list_assignments row that selected the price list of this line''s price rule when the line was written (P1-32-PRE-OD-FD8 fix round 4, ADR-023 D8): chosen by quo.snapshot_quotation_item_price_provenance with svc.resolve_price''s filter and order, among the assignments naming the rule''s list. A writer''s value is ignored. NULL for a line with no price rule, when no assignment names the rule''s list, and for lines written before migration 20261007130000.';
COMMENT ON COLUMN quo.quotation_items.price_assigned_by IS
  'Who had made the assignment named by price_assignment_ref, copied when the line was written (P1-32-PRE-OD-FD8 fix round 4); a later change to the assignment does not move it.';
COMMENT ON COLUMN quo.quotation_items.price_assigned_at IS
  'When price_assigned_by had made the assignment (P1-32-PRE-OD-FD8 fix round 4).';
COMMENT ON COLUMN quo.quotation_items.price_assignment_changed_by IS
  'Everyone who had changed the assignment named by price_assignment_ref, copied when the line was written (P1-32-PRE-OD-FD8 fix round 4); a later change does not move it.';

-- Copied from the sources the line names, whatever the writer supplied; kept while
-- the line keeps its source and its customer class.
CREATE OR REPLACE FUNCTION quo.snapshot_quotation_item_price_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_list uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.price_rule_ref IS NOT DISTINCT FROM OLD.price_rule_ref
     AND NEW.item_sale_price_ref IS NOT DISTINCT FROM OLD.item_sale_price_ref
     AND NEW.price_customer_class IS NOT DISTINCT FROM OLD.price_customer_class THEN
    NEW.price_changed_by := OLD.price_changed_by;
    NEW.price_changed_at := OLD.price_changed_at;
    NEW.price_published_by := OLD.price_published_by;
    NEW.price_published_at := OLD.price_published_at;
    NEW.price_amount_set_by := OLD.price_amount_set_by;
    NEW.price_amount_set_at := OLD.price_amount_set_at;
    NEW.price_assignment_ref := OLD.price_assignment_ref;
    NEW.price_assigned_by := OLD.price_assigned_by;
    NEW.price_assigned_at := OLD.price_assigned_at;
    NEW.price_assignment_changed_by := OLD.price_assignment_changed_by;
    RETURN NEW;
  END IF;
  NEW.price_changed_by := NULL;
  NEW.price_changed_at := NULL;
  NEW.price_published_by := NULL;
  NEW.price_published_at := NULL;
  NEW.price_amount_set_by := NULL;
  NEW.price_amount_set_at := NULL;
  NEW.price_assignment_ref := NULL;
  NEW.price_assigned_by := NULL;
  NEW.price_assigned_at := NULL;
  NEW.price_assignment_changed_by := NULL;
  IF NEW.price_rule_ref IS NOT NULL THEN
    SELECT r.price_changed_by, r.price_changed_at, v.published_by, v.published_at,
           r.amount_set_by, r.amount_set_at, v.price_list_id
      INTO NEW.price_changed_by, NEW.price_changed_at, NEW.price_published_by, NEW.price_published_at,
           NEW.price_amount_set_by, NEW.price_amount_set_at, v_list
      FROM svc.price_rules r
      JOIN svc.price_list_versions v
        ON v.tenant_id = r.tenant_id AND v.id = r.price_list_version_id
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.price_rule_ref;
    -- The assignment that selected the rule's list: svc.resolve_price's filter and
    -- order, on the line's context at the transaction's date, among the assignments
    -- naming that list.
    IF v_list IS NOT NULL THEN
      SELECT a.id, a.assigned_by, a.assigned_at, a.assignment_changed_by
        INTO NEW.price_assignment_ref, NEW.price_assigned_by, NEW.price_assigned_at,
             NEW.price_assignment_changed_by
        FROM svc.price_list_assignments a
       WHERE a.tenant_id = NEW.tenant_id AND a.price_list_id = v_list
         AND a.status = 'active' AND a.deleted_at IS NULL
         AND a.effective_from <= current_date
         AND (a.effective_to IS NULL OR a.effective_to > current_date)
         AND (a.company_id IS NULL OR a.company_id = NEW.company_id)
         AND (a.branch_id IS NULL OR a.branch_id = NEW.branch_id)
         AND (a.customer_class IS NULL OR a.customer_class = NEW.price_customer_class)
       ORDER BY (CASE WHEN a.branch_id IS NOT NULL THEN 4 ELSE 0 END
               + CASE WHEN a.company_id IS NOT NULL THEN 2 ELSE 0 END
               + CASE WHEN a.customer_class IS NOT NULL THEN 1 ELSE 0 END) DESC, a.priority DESC, a.id
       LIMIT 1;
    END IF;
  ELSIF NEW.item_sale_price_ref IS NOT NULL THEN
    SELECT p.price_changed_by, p.price_changed_at, p.amount_set_by, p.amount_set_at
      INTO NEW.price_changed_by, NEW.price_changed_at, NEW.price_amount_set_by, NEW.price_amount_set_at
      FROM inv.item_sale_prices p
     WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.item_sale_price_ref;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.snapshot_quotation_item_price_provenance() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. The D8 basis: a line is the requester's own price when they made or changed
--    the assignment that selected its list, or changed any assignment.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quo.revision_self_change_basis(p_revision uuid, p_person uuid)
RETURNS TABLE (own_policy boolean, own_price boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT
    p_person IS NOT NULL AND EXISTS (
      SELECT 1
        FROM quo.quotation_revisions r
        JOIN quo.quotations q
          ON q.tenant_id = r.tenant_id AND q.id = r.quotation_id
        JOIN svc.pricing_approval_policies p
          ON p.tenant_id = q.tenant_id AND p.id = q.discount_policy_id
         AND p.version_no = q.discount_policy_version_no
       WHERE r.id = p_revision
         AND q.discount_policy_pinned_at IS NOT NULL
         AND p.set_by = p_person),
    p_person IS NOT NULL AND (
      EXISTS (
        SELECT 1
          FROM quo.quotation_items i
         WHERE i.quotation_revision_id = p_revision
           AND i.deleted_at IS NULL
           AND (i.price_amount_set_by = p_person
                OR i.price_changed_by = p_person
                OR i.price_published_by = p_person
                OR i.price_assigned_by = p_person
                OR p_person = ANY (i.price_assignment_changed_by)))
      OR EXISTS (
        SELECT 1
          FROM quo.quotation_items i
          JOIN svc.price_list_assignments a
            ON a.tenant_id = i.tenant_id
         WHERE i.quotation_revision_id = p_revision
           AND i.deleted_at IS NULL
           AND i.price_rule_ref IS NOT NULL
           AND p_person = ANY (a.assignment_changed_by)));
$$;
COMMENT ON FUNCTION quo.revision_self_change_basis(uuid, uuid) IS
  'D8 (P1-32-PRE-OD-FD8): whether p_person recorded the discount policy version the revision''s quotation is held to (own_policy), or — when the line was written — had set the amount of, last changed, or published the price of any live line of the revision, or had made or changed the price-list assignment that selected its list; or has ever changed any price-list assignment of the tenant while the revision has a line priced from a price rule (own_price). A revision whose requester set a price it uses needs approval by somebody else whatever its discount; one whose requester set the threshold, for any discount.';

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only)
--
--   Re-run, as written in 20261007100000, its quo.revision_self_change_basis (with its
--   COMMENT) and quo.snapshot_quotation_item_price_provenance; then
--   ALTER TABLE quo.quotation_items DROP CONSTRAINT ck_quotation_items_price_customer_class,
--     DROP COLUMN price_assignment_changed_by, DROP COLUMN price_assigned_at,
--     DROP COLUMN price_assigned_by, DROP COLUMN price_assignment_ref,
--     DROP COLUMN price_customer_class;
--   DROP TRIGGER tg_price_list_assignments_provenance ON svc.price_list_assignments;
--   DROP FUNCTION svc.stamp_price_list_assignment_provenance();
--   ALTER TABLE svc.price_list_assignments DROP COLUMN assignment_changed_by,
--     DROP COLUMN assigned_at, DROP COLUMN assigned_by;
-- ----------------------------------------------------------------------------
