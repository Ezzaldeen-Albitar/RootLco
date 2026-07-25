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
  ('crm.customer.vehicle.manage','crm','Link customers to vehicles',                'medium','00000000-0000-4000-8000-000000000001'),
  -- Phase 1-17 (veh) — Vehicle Backend. Reading the vehicle master and its safe
  -- projection. Restricted identifiers (chassis/engine number) remain gated by the
  -- existing iam.sensitive.view capability, not a second read code.
  ('veh.vehicle.read',         'veh', 'Search and read vehicles in the caller tenant','low',   '00000000-0000-4000-8000-000000000001'),
  -- Create and edit the vehicle master (draft creation + descriptive edits),
  -- including plate assignment and the EV profile — all "maintain the vehicle
  -- master" registration data. Lifecycle status, merge, ownership, and
  -- relationship changes are separate, higher capabilities.
  ('veh.vehicle.manage',       'veh', 'Create and edit vehicles in the caller tenant','medium','00000000-0000-4000-8000-000000000001'),
  -- Merge is separate and higher: it is irreversible in practice (the source is
  -- frozen and redirected to the survivor), so it carries its own high-risk code.
  ('veh.vehicle.merge',        'veh', 'Merge a duplicate vehicle into a survivor',    'high',  '00000000-0000-4000-8000-000000000001'),
  -- Scanning for and reviewing duplicate candidates are one authority: both are
  -- judgement about whether two records are the same vehicle, and neither combines
  -- them (that is the separate, higher veh.vehicle.merge).
  ('veh.vehicle.duplicate.review','veh','Scan for and review duplicate vehicle candidates','medium','00000000-0000-4000-8000-000000000001'),
  -- Party associations that change who is bound to a vehicle: ownership transfer and
  -- authorized parties. Grouped because both answer "who is associated with this
  -- vehicle and in what role", and both emit vehicle.relationship.changed.
  ('veh.vehicle.relationship.manage','veh','Transfer vehicle ownership and manage authorized parties','medium','00000000-0000-4000-8000-000000000001'),
  -- Recording odometer readings and corrections. Its own code because a correction
  -- can lower the effective odometer, which is more sensitive than a plain read.
  ('veh.vehicle.odometer.record','veh','Record vehicle odometer readings and corrections','medium','00000000-0000-4000-8000-000000000001'),
  -- Lifecycle/workshop status transitions (activate, deactivate, scrap, workshop
  -- moves). Separate from veh.vehicle.manage so descriptive editing does not carry
  -- the power to scrap or deactivate a vehicle (least privilege; mirrors CRM's
  -- crm.customer.governance.manage split from profile editing).
  ('veh.vehicle.status.manage','veh','Change vehicle lifecycle and workshop status','medium','00000000-0000-4000-8000-000000000001'),
  -- Phase 1-18 (apt) - Appointment Backend. Booking an appointment and moving its
  -- confirmed window are one authority: both answer "when is this vehicle expected".
  -- No read code is registered because P1-18 exposes no appointment read operation;
  -- an unused permission is configuration that cannot be tested.
  ('apt.appointment.manage',   'apt', 'Create and reschedule appointments in the caller scope','medium','00000000-0000-4000-8000-000000000001'),
  -- Terminal lifecycle outcomes are separated from booking, mirroring the
  -- veh.vehicle.status.manage split: scheduling a visit must not carry the power to
  -- close one against the customer. Cancellation and no-show are distinct business
  -- facts but one authority, because both end the appointment.
  ('apt.appointment.lifecycle.manage','apt','Cancel an appointment or record a no-show','medium','00000000-0000-4000-8000-000000000001'),
  -- Phase 1-18 (rec) - Vehicle Reception Backend. Opening a reception accepts
  -- physical custody of a customer's vehicle, so it is its own capability and never
  -- implied by a catalog or read permission.
  ('rec.reception.manage',     'rec', 'Open a reception visit and accept vehicle custody','medium','00000000-0000-4000-8000-000000000001'),
  -- Who is present and in what role. Separate because party roles decide whose
  -- instruction the workshop may act on; owner, driver, payer and authorized
  -- receiver are never interchangeable.
  ('rec.reception.party.manage','rec','Assign and close dated party roles on a reception','medium','00000000-0000-4000-8000-000000000001'),
  -- Recording the authorization decision that opens work. Its own high-risk code:
  -- this is the evidence the workshop relies on to justify touching the vehicle.
  ('rec.reception.authorization.verify','rec','Verify and record reception authorization decisions','high','00000000-0000-4000-8000-000000000001'),
  -- Pre-service condition evidence (complaints, inspection findings, damage marks,
  -- contents, warning lights, leaks). One code: all are append-only observations
  -- captured at the same moment by the same person.
  ('rec.reception.evidence.manage','rec','Record pre-service condition evidence on a reception','medium','00000000-0000-4000-8000-000000000001'),
  -- Signature and refusal capture. Separate from general evidence because these
  -- record what a party personally acknowledged or personally declined, and a
  -- fabricated one is a materially different harm from a wrong damage mark.
  ('rec.reception.signature.manage','rec','Capture reception signatures and refusals','high','00000000-0000-4000-8000-000000000001'),
  -- Approving a reception releases it for work. High risk and deliberately not
  -- implied by evidence capture, so the person who records the condition is not
  -- automatically the person who approves it.
  ('rec.reception.approve',    'rec', 'Approve a reception visit for work',           'high',  '00000000-0000-4000-8000-000000000001'),
  -- Conversion creates the work order that all downstream cost attaches to. Its own
  -- high-risk code, never implied by approval.
  ('rec.reception.convert',    'rec', 'Convert an approved reception into a work order','high',  '00000000-0000-4000-8000-000000000001')
ON CONFLICT (permission_code) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] IAM permission catalog applied (idempotent): % permissions',
    (SELECT count(*) FROM iam.permissions);
END $$;
