-- =============================================================================
-- RootLco — FICTIONAL second tenant through the SAME generic provisioning path
-- (P1-03-DB-020). Class 2/3 generic test provisioning, local/CI only.
--
-- Purpose: prove the provisioning mechanism is generic — the pilot package is
-- pure data, not a special path. "Northwind Motors" is fictional; it holds no
-- real data and exists so isolation tests always have a second, seeded tenant.
-- Idempotent via the idempotency key.
-- =============================================================================

SELECT org.provision_organization(
  jsonb_build_object(
    'actor_id', '00000000-0000-4000-8000-000000000001',
    'tenant', jsonb_build_object(
      'code', 'northwind_motors',
      'display_name', 'Northwind Motors (fictional test tenant)',
      'locale', 'en',
      'timezone', 'UTC',
      'activate', true,
      'activation_reason', 'fictional test tenant activated for local development'
    ),
    'subscription', jsonb_build_object(
      'plan_code', 'pilot',
      'status', 'draft',
      'effective_from', '2026-07-01T00:00:00Z'
    ),
    'company', jsonb_build_object(
      'code', 'northwind_main',
      'legal_name', 'Northwind Motors Ltd (fictional)',
      'base_currency', 'USD'
    ),
    'branch', jsonb_build_object(
      'code', 'main',
      'name', 'Northwind Main Branch',
      'timezone', 'UTC'
    ),
    'sequences', jsonb_build_array(
      jsonb_build_object('code', 'org_document', 'prefix_template', 'DOC-', 'pad_width', 6)
    )
  ),
  'local-test-tenant-northwind-v1'
) AS northwind_provisioning_result;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] fictional test tenant provisioning applied (idempotent).';
END $$;
