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

-- =============================================================================
-- P1-OD-025 platform evidence categories.
--
-- Structural reference, on the same argument as the retention classes above and
-- the work-order state graph: the reception guards enforce AGAINST these rows by
-- category_code, so a reception cannot record evidence without them. Platform
-- scope only (tenant_id NULL); a tenant row with the same code overrides one
-- through the existing dual-scope resolution. No row here is tenant or business
-- data, and no-fake-data.test.ts separately holds the tenant-scoped half empty.
-- =============================================================================

INSERT INTO shared.document_categories (
  id, scope, tenant_id, category_code, name, description,
  allowed_content_types, max_size_bytes, default_classification,
  default_retention_class, status, created_by,
  business_link_purpose, device_capture_timestamp_required
)
VALUES
  ('d1500000-0000-4000-8000-000000000001','platform',NULL,'reception_exterior','Reception exterior','Exterior reception evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',true),
  ('d1500000-0000-4000-8000-000000000002','platform',NULL,'reception_dashboard','Reception dashboard','Dashboard and odometer evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',true),
  ('d1500000-0000-4000-8000-000000000003','platform',NULL,'reception_vin','Reception VIN','VIN evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','identity_document',true),
  ('d1500000-0000-4000-8000-000000000004','platform',NULL,'reception_damage','Reception damage','Damage evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',true),
  ('d1500000-0000-4000-8000-000000000005','platform',NULL,'reception_signature','Reception signature','Drawn or uploaded signature evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','signature',true),
  ('d1500000-0000-4000-8000-000000000006','platform',NULL,'reception_refusal_evidence','Reception refusal evidence','Optional refusal supporting evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','evidence',true),
  ('d1500000-0000-4000-8000-000000000007','platform',NULL,'reception_damage_map_template','Reception damage-map template','Versioned damage-map template image',ARRAY['image/jpeg','image/png','image/webp'],10485760,'internal','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',false)
ON CONFLICT DO NOTHING;
