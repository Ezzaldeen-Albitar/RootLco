-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: attach the deferred organizational foreign keys to
--            shared.number_sequences
-- Tasks: P1-03-DB-016 (organizational number-sequence configuration)
-- Owner module: shared (table) / org (referenced hierarchy)
--
-- Purpose
--   Pays the debt Phase 1-2 recorded openly: shared.number_sequences was
--   created before org.* existed, so its scope columns had no foreign keys
--   (recorded in the table COMMENT, the naming standard, and the data
--   dictionary). The org hierarchy now exists — the composite FKs land here,
--   making sequence scope STRUCTURAL like every other org reference.
--
-- Dependency
--   0003 (the table), 20260717103000 (companies/branches composite keys).
--
-- Rollback classification: ROLLBACK-SAFE (dropping constraints/indexes loses
--   no data). Recorded in docs/database/phase-1-3-migration-classification.md.
--
-- Security implications
--   * A sequence row can no longer name a tenant, company, or branch that
--     does not exist or belongs to another tenant — the abuse case "sequence
--     enumeration/misconfiguration across tenants" is closed structurally.
--   * MATCH SIMPLE semantics (PostgreSQL default) keep tenant-wide sequences
--     legal: NULL company/branch skips the composite check, exactly the
--     Phase 1-2 scope model (branch requires company via the existing CHECK).
--   * No behavioural change to allocation: shared.next_display_number() is
--     untouched; concurrency behaviour remains the Phase 1-2 proven one.
--
-- Code governance note (P1-03-DB-016, full register in
-- docs/phase-1/phase-1-3/organization-schema-design.md):
--   tenant/company/branch/department/warehouse/location/cost-centre codes are
--   USER-SUPPLIED at creation, IMMUTABLE afterwards (trigger-guarded);
--   human-facing document numbers are GENERATED via shared
--   number sequences and are never edited; sequence configurations are
--   provisioning data (idempotent, per tenant, never global, never
--   pilot-specific).
--
-- Objects created: three FK constraints + two child-side support indexes.
-- ============================================================================

ALTER TABLE shared.number_sequences
  ADD CONSTRAINT fk_number_sequences_tenant
  FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT;

ALTER TABLE shared.number_sequences
  ADD CONSTRAINT fk_number_sequences_company
  FOREIGN KEY (tenant_id, company_id)
  REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE shared.number_sequences
  ADD CONSTRAINT fk_number_sequences_branch
  FOREIGN KEY (tenant_id, company_id, branch_id)
  REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT;

-- Child-side FK support (RESTRICT enforcement scans the child when a parent
-- row is deleted). The scope-unique constraint already leads with tenant_id;
-- these cover the company/branch paths for non-NULL scopes only.
CREATE INDEX ix_number_sequences_tenant_company
  ON shared.number_sequences (tenant_id, company_id)
  WHERE company_id IS NOT NULL;
CREATE INDEX ix_number_sequences_tenant_company_branch
  ON shared.number_sequences (tenant_id, company_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- The table's honest note about missing FKs is now history — update it.
COMMENT ON TABLE shared.number_sequences IS
  'Tenant-scoped display-number sequences (P1-02-DB-004/019; org FKs added by P1-03-DB-016). Provisioned by configuration at tenant onboarding; allocated via shared.next_display_number(). No global cross-tenant sequence exists. Scope is structural since Phase 1-3: tenant_id → org.tenants, (tenant_id, company_id) → org.legal_companies, (tenant_id, company_id, branch_id) → org.branches (MATCH SIMPLE keeps tenant-wide sequences legal).';
