-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: resolve the Phase 1-9 forward references (service/item/quotation)
-- Tasks: P1-10-DB (forward-FK completion); P1-09 -> P1-10 structural contract
-- Owner module: wo (additive; resolves opaque refs to new P1-10 catalogs)
--
-- Rollback classification: roll-forward-only.
--
-- Purpose
--   Phase 1-9 stored three opaque uuid forward references (no FK, no CHECK) because
--   their target tables did not exist yet (docs/phase-1/phase-1-9/p1-10-structural-
--   contract.md). Now that P1-10 provides the catalogs, this ADDITIVE migration
--   resolves them with composite foreign keys. All are MATCH SIMPLE: a NULL ref
--   stays unenforced (opaque/unresolved is still valid), so no existing Phase 1-9
--   row is orphaned and every Phase 1-9 suite stays green. No merged migration is
--   edited (forward-only, per docs/database/migration-standard.md §2).
--
--   Note: wo.jobs carries no service reference — services attach at the service-line
--   level (wo.work_order_service_lines.service_ref), reconciling the instruction's
--   "work_job.service_id" (no such column exists).
--
-- Dependencies
--   wo.work_order_service_lines, wo.required_parts, wo.customer_approvals (P1-09);
--   svc.services, inv.item_master, quo.quotation_revisions (P1-10).
-- ============================================================================

-- Service line -> service catalog (tenant-scoped).
ALTER TABLE wo.work_order_service_lines
  ADD CONSTRAINT fk_work_order_service_lines_service
  FOREIGN KEY (tenant_id, service_ref) REFERENCES svc.services (tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX ix_work_order_service_lines_service_ref ON wo.work_order_service_lines (tenant_id, service_ref);

-- Required part -> item master (tenant-scoped).
ALTER TABLE wo.required_parts
  ADD CONSTRAINT fk_required_parts_item
  FOREIGN KEY (tenant_id, item_ref) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX ix_required_parts_item_ref ON wo.required_parts (tenant_id, item_ref);

-- Customer approval -> the exact quotation revision (full branch scope).
ALTER TABLE wo.customer_approvals
  ADD CONSTRAINT fk_customer_approvals_quotation_revision
  FOREIGN KEY (tenant_id, company_id, branch_id, quotation_revision_ref)
  REFERENCES quo.quotation_revisions (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT;
CREATE INDEX ix_customer_approvals_quotation_revision_ref ON wo.customer_approvals (tenant_id, company_id, branch_id, quotation_revision_ref);
