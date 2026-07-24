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
  ('iam.login.view_all',       'iam', 'View all tenant login history',    'medium', '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-10 — Service Catalog & Pricing (svc)
  ('svc.service.manage',       'svc', 'Manage service catalog and versions',    'medium', '00000000-0000-4000-8000-000000000001'),
  ('svc.price.manage',         'svc', 'Manage price lists, rules, discounts',    'high',   '00000000-0000-4000-8000-000000000001'),
  ('svc.price.publish',        'svc', 'Publish immutable price-list versions',   'high',   '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-10 — Quotation & Approvals (quo)
  ('quo.quotation.manage',     'quo', 'Create and manage quotations/revisions',  'medium', '00000000-0000-4000-8000-000000000001'),
  ('quo.decision.record',      'quo', 'Record quotation item approval decisions', 'high',  '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-10 — Inventory & Stock (inv)
  ('inv.item.manage',          'inv', 'Manage item master, categories, UoM',     'medium', '00000000-0000-4000-8000-000000000001'),
  ('inv.stock.read',           'inv', 'Read stock balances and movements',       'low',    '00000000-0000-4000-8000-000000000001'),
  ('inv.stock.operate',        'inv', 'Post movements, reserve, issue, return',   'medium', '00000000-0000-4000-8000-000000000001'),
  ('inv.adjustment.approve',   'inv', 'Approve stock adjustments/opening batches','high',   '00000000-0000-4000-8000-000000000001'),
  ('inv.cost.view',            'inv', 'View item/purchase/adjustment cost',       'high',   '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-11 — Billing & Payment (sal)
  ('sal.invoice.manage',       'sal', 'Create and manage draft invoices',         'medium', '00000000-0000-4000-8000-000000000001'),
  ('sal.invoice.issue',        'sal', 'Issue invoices (allocate numbers)',         'high',   '00000000-0000-4000-8000-000000000001'),
  ('sal.payment.record',       'sal', 'Record receipts',                           'medium', '00000000-0000-4000-8000-000000000001'),
  ('sal.payment.allocate',     'sal', 'Allocate receipts to invoices',             'medium', '00000000-0000-4000-8000-000000000001'),
  ('sal.credit.manage',        'sal', 'Request and manage credit notes',           'high',   '00000000-0000-4000-8000-000000000001'),
  ('sal.reversal.approve',     'sal', 'Approve receipt reversals (dual control)',   'high',   '00000000-0000-4000-8000-000000000001'),
  ('sal.finance.view',         'sal', 'View financial amounts (invoices/receipts/events)', 'high', '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-11 — Delivery & Custody (sal)
  ('sal.delivery.manage',      'sal', 'Manage deliveries, receivers, signatures',  'medium', '00000000-0000-4000-8000-000000000001'),
  ('sal.delivery.complete',    'sal', 'Complete deliveries and close custody',      'high',   '00000000-0000-4000-8000-000000000001'),
  ('sal.delivery.view',        'sal', 'View delivery signatures/receiver evidence', 'high',   '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-11 — Warranty (wty)
  ('wty.policy.manage',        'wty', 'Manage warranty policies and coverage',      'medium', '00000000-0000-4000-8000-000000000001'),
  ('wty.warranty.issue',       'wty', 'Issue warranty records',                     'medium', '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-11 — Reporting configuration (rpt)
  ('rpt.report.configure',     'rpt', 'Manage report configurations',              'medium', '00000000-0000-4000-8000-000000000001'),
  ('rpt.export',               'rpt', 'Export report data (audited downstream)',    'high',   '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-15 — Shared services (shared). DBCR-P1-15-001. Two codes only, each
  -- naming one concrete capability. Template administration deliberately reuses
  -- the existing org.settings.manage: a message template is tenant configuration,
  -- and minting a second code for it would split one authority across two names.
  ('shared.document.manage',   'shared', 'Create document metadata, pre-acceptance versions and links', 'medium', '00000000-0000-4000-8000-000000000001'),
  ('shared.notification.send', 'shared', 'Enqueue outbound notifications',           'medium', '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-16 — CRM Backend (crm). DBCR-P1-16-001 enables runtime authorship of
  -- customer notes on shared.notes (SELECT-only before this change). One code,
  -- naming one concrete capability; the RLS write policies on shared.notes gate on it.
  ('crm.customer.note.write',  'crm', 'Author and edit customer notes',            'medium', '00000000-0000-4000-8000-000000000001'),
  ('crm.customer.read',        'crm', 'Search and read customers in the tenant',   'low',    '00000000-0000-4000-8000-000000000001'),
  ('crm.customer.create',      'crm', 'Create individual and company customers',   'medium', '00000000-0000-4000-8000-000000000001'),
  -- Contacts, addresses, and delivery preferences. Separated from consent below:
  -- editing a phone number is routine data maintenance, while a consent decision
  -- changes what the platform is permitted to do to a person.
  ('crm.customer.profile.write','crm','Maintain customer contacts, addresses, and preferences','medium','00000000-0000-4000-8000-000000000001'),
  ('crm.customer.consent.write','crm','Record customer consent decisions',         'high',   '00000000-0000-4000-8000-000000000001'),
  -- Alerts, tags, and lifecycle status: advisory or classifying records.
  ('crm.customer.governance.manage','crm','Manage customer alerts, tags, and lifecycle status','medium','00000000-0000-4000-8000-000000000001'),
  -- Restrictions get their own code: raising an alert and refusing to serve
  -- somebody are not the same authority.
  ('crm.customer.restriction.manage','crm','Impose and lift customer restrictions','high','00000000-0000-4000-8000-000000000001'),
  -- Duplicate scanning and reviewing are one authority: both are judgement
  -- about whether two records are the same person, and neither combines them.
  ('crm.customer.duplicate.review','crm','Scan for and review duplicate customer candidates','medium','00000000-0000-4000-8000-000000000001'),
  -- Merge is separate and higher: it is irreversible in practice.
  ('crm.customer.merge',       'crm', 'Merge a duplicate customer into a survivor','high',  '00000000-0000-4000-8000-000000000001'),
  ('crm.customer.vehicle.manage','crm','Link customers to vehicles',                'medium','00000000-0000-4000-8000-000000000001')
ON CONFLICT (permission_code) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] IAM permission catalog applied (idempotent): % permissions',
    (SELECT count(*) FROM iam.permissions);
END $$;
