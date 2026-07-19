-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: foreign-key index coverage (conform to P1-03-DB-017)
-- Tasks: P1-06-DB-022 (index review — reconciled to the enforced repo standard)
-- Owner module: crm
--
-- Rollback classification: fully ROLLBACK-SAFE / roll-forward-safe. Index-only
--   changes (create + partial->full replacement); no data, schema, or grant
--   change. Indexes may be dropped or recreated at any time.
--
-- Purpose
--   The repo-wide standard P1-03-DB-017 — enforced by
--   tests/db/org-security.test.ts ("every FK in a module schema has an index
--   whose leading columns cover it") — requires every foreign key in a module
--   schema to be backed by a NON-PARTIAL index whose leading columns are exactly
--   the FK columns. Seventeen crm FKs were not covered: several composite/single
--   reference FKs had no supporting index, and the three profile `_ref` indexes
--   were PARTIAL (WHERE ref IS NOT NULL), which the standard does not accept.
--   This reconciles the Wave-5 DB-022 review (which had accepted low-cardinality
--   FKs without an index) to the enforced standard by adding the covering
--   indexes and making the three `_ref` indexes non-partial.
--
--   A single (tenant_id, partner_id) index covers both the `_partner` and
--   `_tenant` FKs on customer_alerts and partner_sensitive_attributes (the
--   standard matches the FK columns against the index's leading columns as a
--   set, so a 2-column index covers both the 2-column and the 1-column FK).
--
-- Objects created/changed  (index-only)
--   Recreated non-partial: ix_company_profiles_registration,
--     ix_company_profiles_tax, ix_individual_profiles_national_id,
--     ix_business_partners_merged_into
--   New: ix_communication_log_outbound_message,
--     ix_communication_preferences_locale, ix_company_profiles_partner_type,
--     ix_consent_history_contact_point, ix_consent_history_evidence,
--     ix_customer_alerts_partner, ix_customer_block_history_restriction,
--     ix_customer_credit_profiles_currency, ix_individual_profiles_locale,
--     ix_individual_profiles_partner_type, ix_partner_sensitive_attributes_partner
-- ============================================================================

-- 1. Make the three profile reference-pointer indexes non-partial so they
--    satisfy P1-03-DB-017 (they previously excluded NULL rows with a WHERE).
DROP INDEX crm.ix_company_profiles_registration;
CREATE INDEX ix_company_profiles_registration
  ON crm.company_profiles (tenant_id, partner_id, registration_ref);

DROP INDEX crm.ix_company_profiles_tax;
CREATE INDEX ix_company_profiles_tax
  ON crm.company_profiles (tenant_id, partner_id, tax_ref);

DROP INDEX crm.ix_individual_profiles_national_id;
CREATE INDEX ix_individual_profiles_national_id
  ON crm.individual_profiles (tenant_id, partner_id, national_id_ref);

-- 2. Composite / same-partner FK support indexes.
--    merged_into already had a PARTIAL index (WHERE merged_into_id IS NOT NULL),
--    which the standard does not accept; replace it with a non-partial one.
DROP INDEX crm.ix_business_partners_merged_into;
CREATE INDEX ix_business_partners_merged_into
  ON crm.business_partners (tenant_id, merged_into_id);

CREATE INDEX ix_communication_log_outbound_message
  ON crm.communication_log (tenant_id, outbound_message_id);

CREATE INDEX ix_company_profiles_partner_type
  ON crm.company_profiles (tenant_id, partner_id, party_type);

CREATE INDEX ix_individual_profiles_partner_type
  ON crm.individual_profiles (tenant_id, partner_id, party_type);

CREATE INDEX ix_consent_history_contact_point
  ON crm.consent_history (tenant_id, partner_id, contact_point_id);

CREATE INDEX ix_consent_history_evidence
  ON crm.consent_history (tenant_id, evidence_document_id);

CREATE INDEX ix_customer_block_history_restriction
  ON crm.customer_block_history (tenant_id, partner_id, restriction_id);

-- 3. One (tenant_id, partner_id) index covers both the _partner and _tenant FKs.
CREATE INDEX ix_customer_alerts_partner
  ON crm.customer_alerts (tenant_id, partner_id);

CREATE INDEX ix_partner_sensitive_attributes_partner
  ON crm.partner_sensitive_attributes (tenant_id, partner_id);

-- 4. Single-column reference FK support indexes.
CREATE INDEX ix_communication_preferences_locale
  ON crm.communication_preferences (preferred_locale);

CREATE INDEX ix_individual_profiles_locale
  ON crm.individual_profiles (preferred_locale);

CREATE INDEX ix_customer_credit_profiles_currency
  ON crm.customer_credit_profiles (currency_code);
