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
  ('rec.reception.convert',    'rec', 'Convert an approved reception into a work order','high',  '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-19 (wo) - Work Order Backend. Reading a work order is separated from
  -- changing one because the board, the customer-facing status and the reception
  -- desk all need to see an order without any authority to move it.
  ('wo.work_order.read',       'wo', 'Read work orders, their jobs and their history',  'low',    '00000000-0000-4000-8000-000000000001'),
  -- Creating a work order commits the workshop to the job and is what all downstream
  -- cost attaches to, so it is its own capability and never implied by reading.
  ('wo.work_order.create',     'wo', 'Convert a reception visit into a work order',     'high',   '00000000-0000-4000-8000-000000000001'),
  -- Moving an order through its graph. Separate from closure: a service advisor who
  -- may park an order awaiting parts must not thereby be able to close it.
  ('wo.work_order.transition', 'wo', 'Move a work order through its configured states', 'medium', '00000000-0000-4000-8000-000000000001'),
  -- Closure is the one transition that ends the workshop's liability and freezes the
  -- record, and B1-B6 gate it. Its own high-risk code, never implied by transition.
  ('wo.work_order.close',      'wo', 'Close a work order once every closure condition is met', 'high', '00000000-0000-4000-8000-000000000001'),
  -- Jobs are the unit of work assigned to a technician. Managing them is distinct
  -- from moving the order that contains them.
  ('wo.job.manage',            'wo', 'Create and update jobs on a work order',          'medium', '00000000-0000-4000-8000-000000000001'),
  ('wo.job.transition',        'wo', 'Move a job through its configured states',        'medium', '00000000-0000-4000-8000-000000000001'),
  -- Service lines and required parts record demand. Deliberately NOT a stock
  -- capability: Phase 1-19 records what is needed and never reserves or issues it.
  ('wo.work_order.line.manage','wo', 'Record service lines and required-part demand',   'medium', '00000000-0000-4000-8000-000000000001'),
  -- Raising additional work is separated from approving it, because the person who
  -- finds more work is never automatically the person who commits the customer to it.
  ('wo.additional_work.request','wo','Raise an additional-work request',                'medium', '00000000-0000-4000-8000-000000000001'),
  ('wo.additional_work.approve','wo','Record a customer decision on additional work',   'high',   '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-19 (tech) - Technician Execution. Assignment decides who may touch the
  -- vehicle and is gated on skill, certification and availability.
  ('tech.assignment.manage',   'tech','Assign and reassign technicians to jobs',        'medium', '00000000-0000-4000-8000-000000000001'),
  -- Recording one's own labor. Low risk and widely held: every technician needs it.
  ('tech.labor.record',        'tech','Start, pause, resume and stop labor sessions',   'low',    '00000000-0000-4000-8000-000000000001'),
  -- Correcting a labor record rewrites the timesheet a payroll or warranty claim may
  -- rest on. It never edits the original - it writes a linked correction - but the
  -- authority to do it is separate from the authority to record labor.
  ('tech.labor.correct',       'tech','Record a linked correction to a labor session',  'high',   '00000000-0000-4000-8000-000000000001'),
  -- Reading technician skills, certifications and availability. Employment-derived
  -- data, so it is its own code rather than part of a general read.
  ('tech.technician.read',     'tech','Read technician profiles, eligibility and queues','low',   '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-19 (dia) - Diagnostics. Recording findings is distinct from completing a
  -- report, and completing is distinct from reviewing it.
  ('dia.diagnostic.record',    'dia', 'Create diagnostic reports and record their entries','medium','00000000-0000-4000-8000-000000000001'),
  ('dia.diagnostic.complete',  'dia', 'Complete a diagnostic report',                   'medium', '00000000-0000-4000-8000-000000000001'),
  -- Review is the independent check on a completed report. Separate code so the
  -- reviewer-separation policy has something to enforce against.
  ('dia.diagnostic.review',    'dia', 'Review a completed diagnostic report',           'high',   '00000000-0000-4000-8000-000000000001'),
  ('dia.diagnostic.read',      'dia', 'Read diagnostic reports and their evidence',     'low',    '00000000-0000-4000-8000-000000000001'),
  -- Phase 1-19 (qms) - Quality. Performing quality control is what stands between a
  -- vehicle and the customer, and a finalized result can never be edited.
  ('qms.quality_control.perform','qms','Perform and finalize quality control',          'high',   '00000000-0000-4000-8000-000000000001'),
  -- Rework records that the workshop got something wrong. Creating the linkage and
  -- independently signing it off are deliberately two codes: BR-QMS-001 requires the
  -- sign-off to come from someone other than whoever did the work.
  ('qms.rework.manage',        'qms', 'Create and resolve rework cases',                'high',   '00000000-0000-4000-8000-000000000001'),
  ('qms.rework.sign_off',      'qms', 'Independently sign off safety-critical rework',  'high',   '00000000-0000-4000-8000-000000000001'),
  ('qms.quality_control.read', 'qms', 'Read quality-control records and rework links',  'low',    '00000000-0000-4000-8000-000000000001')
ON CONFLICT (permission_code) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] IAM permission catalog applied (idempotent): % permissions',
    (SELECT count(*) FROM iam.permissions);
END $$;
