-- ============================================================================
-- Seed 04 — IAM permission catalog and baseline configurable roles (P1-04-DB-025)
--
-- Two idempotent, additive parts:
--   1. The PLATFORM permission catalog (iam.permissions) for the approved
--      Phase 1 domains — tenant-independent reference data.
--   2. Example baseline role definitions with their permission mappings, seeded
--      ONLY into the fictional "northwind_motors" test tenant. Tenant roles stay
--      configuration-led; these are illustrative templates, not a fixed policy.
--
-- Rules honoured: idempotent (re-runnable with no duplicates); stable additive
--   permission codes with risk levels; explicit allow effect; NO wildcard
--   permission; NO Benzene-specific role or assignment; NO real user; NO
--   password or credential; authorization is by permission, never role name.
-- ============================================================================

-- 1. Platform permission catalog (additive; safe to re-run) -------------------
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

-- 2. Baseline roles for the fictional test tenant (idempotent) ----------------
INSERT INTO iam.roles (tenant_id, role_code, name, is_system, created_by)
SELECT t.id, v.code, v.name, true, '00000000-0000-4000-8000-000000000001'::uuid
FROM (SELECT id FROM org.tenants WHERE tenant_code = 'northwind_motors') t
CROSS JOIN (VALUES
  ('platform_operator',   'Platform Operator'),
  ('tenant_administrator','Tenant Administrator'),
  ('branch_manager',      'Branch Manager'),
  ('receptionist',        'Receptionist'),
  ('technician',          'Technician'),
  ('cashier',             'Cashier')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM iam.roles r WHERE r.tenant_id = t.id AND r.role_code = v.code AND r.deleted_at IS NULL
);

-- 3. Baseline role → permission mappings (explicit allow; idempotent) ---------
INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
SELECT r.tenant_id, r.id, p.id, 'allow', '00000000-0000-4000-8000-000000000001'::uuid
FROM iam.roles r
JOIN org.tenants t ON t.id = r.tenant_id AND t.tenant_code = 'northwind_motors'
JOIN (VALUES
  ('platform_operator',   'org.tenant.read'),
  ('platform_operator',   'org.subscription.manage'),
  ('platform_operator',   'iam.audit.view'),
  ('tenant_administrator','org.company.manage'),
  ('tenant_administrator','org.branch.manage'),
  ('tenant_administrator','org.department.manage'),
  ('tenant_administrator','org.settings.manage'),
  ('tenant_administrator','org.tax.manage'),
  ('tenant_administrator','iam.user.manage'),
  ('tenant_administrator','iam.role.manage'),
  ('tenant_administrator','iam.grant.manage'),
  ('tenant_administrator','iam.approval.manage'),
  ('tenant_administrator','iam.audit.view'),
  ('tenant_administrator','iam.session.view_all'),
  ('tenant_administrator','iam.login.view_all'),
  ('branch_manager',      'org.branch.read'),
  ('branch_manager',      'org.department.manage'),
  ('branch_manager',      'iam.user.read'),
  ('receptionist',        'org.branch.read'),
  ('receptionist',        'iam.user.read'),
  ('technician',          'org.branch.read'),
  ('cashier',             'org.branch.read'),
  ('cashier',             'iam.approval.manage')
) AS m(role_code, perm_code) ON m.role_code = r.role_code
JOIN iam.permissions p ON p.permission_code = m.perm_code
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] IAM permission catalog + baseline roles applied (idempotent): % permissions',
    (SELECT count(*) FROM iam.permissions);
END $$;
