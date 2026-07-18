-- ============================================================================
-- Seed 04 — IAM permission catalog (P1-04-DB-025)
--
-- The PLATFORM permission catalog for the approved Phase 1 domains is
-- tenant-independent structural reference data. Tenant roles and mappings are
-- provisioning-time, tenant-scoped configuration; their six-role baseline shape
-- is proven with ephemeral fixtures in iam-seeds.test.ts. Phase 1-5 forward
-- correction to P1-04-DB-025 traceability (2026-07-18).
--
-- Idempotent and additive; stable permission codes with risk levels; no wildcard
-- permission, tenant role, user, password, or credential. Authorization is by
-- permission, never role name.
-- ============================================================================

INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by) VALUES
  ('org.tenant.read',          'org', 'Read tenant profile',              'low',    '00000000-0000-4000-8000-000000000001'),
  ('org.company.read',         'org', 'Read legal companies',             'low',    '00000000-0000-4000-8000-000000000001'),
  ('org.company.manage',       'org', 'Create and update companies',      'medium', '00000000-0000-4000-8000-000000000001'),
  ('org.branch.read',          'org', 'Read branches',                    'low',    '00000000-0000-4000-8000-000000000001'),
  ('org.branch.manage',        'org', 'Create and update branches',       'medium', '00000000-0000-4000-8000-000000000001'),
  ('org.department.manage',    'org', 'Manage departments/structure',     'medium', '00000000-0000-4000-8000-000000000001'),
  ('org.settings.manage',      'org', 'Manage company/branch settings',   'high',   '00000000-0000-4000-8000-000000000001'),
  ('org.tax.manage',           'org', 'Manage tax classes and rates',     'high',   '00000000-0000-4000-8000-000000000001'),
  ('org.subscription.manage',  'org', 'Manage tenant subscriptions',      'high',   '00000000-0000-4000-8000-000000000001'),
  ('iam.user.read',            'iam', 'Read user directory',              'low',    '00000000-0000-4000-8000-000000000001'),
  ('iam.user.manage',          'iam', 'Provision and lifecycle users',    'high',   '00000000-0000-4000-8000-000000000001'),
  ('iam.role.read',            'iam', 'Read roles and mappings',          'low',    '00000000-0000-4000-8000-000000000001'),
  ('iam.role.manage',          'iam', 'Create and update roles',          'high',   '00000000-0000-4000-8000-000000000001'),
  ('iam.grant.manage',         'iam', 'Grant and revoke roles',           'high',   '00000000-0000-4000-8000-000000000001'),
  ('iam.approval.manage',      'iam', 'Manage approval limits',           'high',   '00000000-0000-4000-8000-000000000001'),
  ('iam.sensitive.view',       'iam', 'View sensitive/restricted data',   'high',   '00000000-0000-4000-8000-000000000001'),
  ('iam.audit.view',           'iam', 'Read the audit trail',             'medium', '00000000-0000-4000-8000-000000000001'),
  ('iam.session.view_all',     'iam', 'View all tenant sessions',         'medium', '00000000-0000-4000-8000-000000000001'),
  ('iam.login.view_all',       'iam', 'View all tenant login history',    'medium', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (permission_code) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] IAM permission catalog applied (idempotent): % permissions',
    (SELECT count(*) FROM iam.permissions);
END $$;
