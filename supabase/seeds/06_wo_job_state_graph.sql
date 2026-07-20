-- =============================================================================
-- RootLco — Phase 1-9 platform Work Order + Job state graph (structural reference)
--
-- WHY THIS IS STRUCTURAL, NOT BUSINESS DATA
--   The Work Order and Job transition guards enforce every state change against
--   an ACTIVE row in wo.work_order_states / wo.work_order_transitions (and the job
--   equivalents). Without a platform default graph, no work order could transition
--   at all — the executable behaviour of the module truly requires these rows. They
--   are tenant-NEUTRAL generic lifecycle definitions (no tenant id, no customer,
--   Vehicle, or operational data), exactly the "technically mandatory generic
--   definitions" the no-fake-data policy permits. A tenant may EXTEND the graph
--   with its own non-terminal routing states; terminal/closed/cancellation states
--   remain platform-governed (migration CHECK).
--
-- RULES: platform scope only (tenant_id NULL); idempotent (ON CONFLICT DO NOTHING
--   against the partial platform-code / platform-edge unique indexes); NO business
--   data; no tenant hard-coding.
-- =============================================================================

-- Platform actor for seeds (the reserved system UUID; not a real user).
-- ----------------------------------------------------------------------------
-- Work Order states.
-- ----------------------------------------------------------------------------
INSERT INTO wo.work_order_states
  (scope, code, name, is_terminal, is_closed, is_cancellation, reason_required,
   allows_jobs, allows_labor, allows_additional_work, requires_qc, is_reopenable, created_by)
VALUES
  ('platform', 'draft',             'Draft',             false, false, false, false, false, false, false, false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'open',              'Open',              false, false, false, false, true,  true,  true,  false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress',       'In Progress',       false, false, false, false, true,  true,  true,  false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'awaiting_parts',    'Awaiting Parts',    false, false, false, true,  true,  false, true,  false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'awaiting_customer', 'Awaiting Customer', false, false, false, true,  false, false, true,  false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'qc_pending',        'QC Pending',        false, false, false, false, false, false, false, true,  false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'ready_to_close',    'Ready to Close',    false, false, false, false, false, false, false, true,  false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'closed',            'Closed',            true,  true,  false, false, false, false, false, false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'cancelled',         'Cancelled',         true,  true,  true,  true,  false, false, false, false, false, '00000000-0000-4000-8000-000000000001')
ON CONFLICT (code) WHERE scope = 'platform' AND deleted_at IS NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- Work Order transitions.
-- ----------------------------------------------------------------------------
INSERT INTO wo.work_order_transitions (scope, from_state, to_state, requires_reason, created_by)
VALUES
  ('platform', 'draft',             'open',              false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'open',              'in_progress',       false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress',       'awaiting_parts',    true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'awaiting_parts',    'in_progress',       false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress',       'awaiting_customer', true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'awaiting_customer', 'in_progress',       false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress',       'qc_pending',        false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'qc_pending',        'in_progress',       true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'qc_pending',        'ready_to_close',    false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'ready_to_close',    'closed',            false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'draft',             'cancelled',         true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'open',              'cancelled',         true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress',       'cancelled',         true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'awaiting_parts',    'cancelled',         true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'awaiting_customer', 'cancelled',         true,  '00000000-0000-4000-8000-000000000001')
ON CONFLICT (from_state, to_state) WHERE scope = 'platform' AND deleted_at IS NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- Job states.
-- ----------------------------------------------------------------------------
INSERT INTO wo.job_states
  (scope, code, name, is_terminal, reason_required, assignment_required, labor_allowed, closure_eligible, created_by)
VALUES
  ('platform', 'planned',     'Planned',     false, false, false, false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'assigned',    'Assigned',    false, false, true,  true,  false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress', 'In Progress', false, false, true,  true,  false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'paused',      'Paused',      false, true,  true,  false, false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'completed',   'Completed',   true,  false, false, false, true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'cancelled',   'Cancelled',   true,  true,  false, false, true,  '00000000-0000-4000-8000-000000000001')
ON CONFLICT (code) WHERE scope = 'platform' AND deleted_at IS NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- Job transitions.
-- ----------------------------------------------------------------------------
INSERT INTO wo.job_transitions (scope, from_state, to_state, requires_reason, created_by)
VALUES
  ('platform', 'planned',     'assigned',    false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'assigned',    'in_progress', false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress', 'paused',      true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'paused',      'in_progress', false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'paused',      'assigned',    true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress', 'completed',   false, '00000000-0000-4000-8000-000000000001'),
  ('platform', 'planned',     'cancelled',   true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'assigned',    'cancelled',   true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'in_progress', 'cancelled',   true,  '00000000-0000-4000-8000-000000000001'),
  ('platform', 'paused',      'cancelled',   true,  '00000000-0000-4000-8000-000000000001')
ON CONFLICT (from_state, to_state) WHERE scope = 'platform' AND deleted_at IS NULL DO NOTHING;
