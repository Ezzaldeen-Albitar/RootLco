-- =============================================================================
-- RootLco — CONTROLLED PILOT PROVISIONING PACKAGE (Class 3, seed standard §3.3)
-- Benzene Vehicle Services — first customer, first subscribed tenant, first
-- pilot. P1-03-DB-020.
--
-- THIS IS THE ONLY EXECUTABLE FILE IN THE REPOSITORY THAT MAY NAME BENZENE.
-- Benzene is a customer and configuration data — never the software owner and
-- never hard-coded in schema, functions, policies, migrations, or generic
-- tests (ADR-008/ADR-009). Removing this file leaves no schema or function
-- trace, which the test suite and CI guard assert.
--
-- It instantiates the SAME generic path every tenant uses:
-- org.provision_organization(). Idempotent by construction — the idempotency
-- key makes a re-run replay the stored result and create nothing.
--
-- PENDING CONFIGURATION (recorded, not invented — see the provisioning
-- register in docs/phase-1/phase-1-3/organization-schema-design.md):
--   * legal registration numbers: UNKNOWN → NULL
--   * official Arabic legal name rendering: pending owner confirmation
--   * base currency JOD and timezone Asia/Amman: DRAFT pilot configuration,
--     pending owner confirmation
--   * subscription: DRAFT status against the generic pilot plan
--   * settings/feature overrides: none approved yet → none seeded
-- =============================================================================

-- The generic pilot plan is platform catalogue data (not Benzene-specific):
-- any pilot tenant may be assigned to it. Idempotent guarded insert (plan_code
-- alone is not unique — only overlapping ACTIVE versions are excluded).
INSERT INTO org.subscription_plans
  (plan_code, name, description, entitlement_document, capacity_limits,
   status, effective_from, created_by)
SELECT
  'pilot', 'Pilot Plan',
  'Generic pilot-phase plan. No billing, no pricing; entitlements deliberately empty until owner decisions exist.',
  '{}'::jsonb, '{}'::jsonb, 'active', '2026-01-01T00:00:00Z',
  '00000000-0000-4000-8000-000000000001'
WHERE NOT EXISTS (
  SELECT 1 FROM org.subscription_plans WHERE plan_code = 'pilot' AND status = 'active'
);

SELECT org.provision_organization(
  jsonb_build_object(
    'actor_id', '00000000-0000-4000-8000-000000000001',
    'tenant', jsonb_build_object(
      'code', 'benzene_vehicle_services',
      'display_name', 'Benzene Vehicle Services',
      'locale', 'ar',
      'timezone', 'Asia/Amman',
      'activate', true,
      'activation_reason', 'pilot tenant activated for local development and testing'
    ),
    'subscription', jsonb_build_object(
      'plan_code', 'pilot',
      'status', 'draft',
      'effective_from', '2026-07-01T00:00:00Z'
    ),
    'company', jsonb_build_object(
      'code', 'benzene_main',
      'legal_name', 'Benzene Vehicle Services',
      'base_currency', 'JOD'
    ),
    'branch', jsonb_build_object(
      'code', 'main',
      'name', 'Benzene Pilot Branch',
      'timezone', 'Asia/Amman',
      'country_code', 'JO',
      'city', 'Amman'
    ),
    'sequences', jsonb_build_array(
      jsonb_build_object('code', 'org_document', 'prefix_template', 'DOC-', 'pad_width', 6)
    )
  ),
  'benzene-pilot-provisioning-v1'
) AS benzene_provisioning_result;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] Benzene pilot provisioning package applied (idempotent).';
END $$;
