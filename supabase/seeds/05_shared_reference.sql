-- =============================================================================
-- Seed 05 — mandatory shared-service structural reference (P1-05 Increment M)
--
-- These five tenant-neutral retention classes are executable structure-as-data:
-- Increment D's eligibility function returns class_undefined without them.
-- operational identifies working records; evidence-audit identifies proof rows;
-- personal-data identifies privacy-governed records; temporary permits immediate
-- eligibility after its explicit expiry; immutable-financial-history is the sole
-- never-delete class. Owner/jurisdiction retention periods are not invented, so
-- every period is NULL except temporary = 0. No row is tenant or business data.
-- =============================================================================

INSERT INTO shared.retention_classes
  (class_code, description, min_retention_days, allows_deletion, created_by)
VALUES
  ('operational', 'Current working data whose configured retention is owner- and jurisdiction-defined.', NULL, true, '00000000-0000-4000-8000-000000000001'),
  ('evidence-audit', 'Evidence and audit records whose retention is owner- and jurisdiction-defined.', NULL, true, '00000000-0000-4000-8000-000000000001'),
  ('personal-data', 'Personal data governed by configured privacy and jurisdiction obligations.', NULL, true, '00000000-0000-4000-8000-000000000001'),
  ('temporary', 'Short-lived technical data eligible after its explicit expiry.', 0, true, '00000000-0000-4000-8000-000000000001'),
  ('immutable-financial-history', 'Issued financial history that is never eligible for deletion.', NULL, false, '00000000-0000-4000-8000-000000000001')
ON CONFLICT (class_code) DO NOTHING;
