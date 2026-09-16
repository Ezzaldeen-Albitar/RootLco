-- ============================================================================
-- Owner directive — subscription capacity enforcement for the organisation
-- Tasks: P1-32-PRE-030, P1-32-PRE-031
-- Owner module: org
--
-- Rollback classification: ROLLBACK-SAFE. Every object here is a function, a
--   trigger, a policy or a grant. Nothing is written, moved or destroyed, so
--   dropping the five functions, the three triggers and the three policies and
--   revoking the one privilege returns the database to exactly its previous
--   state. The exact inverse is given at the foot of this file.
--
-- Purpose
--   org.subscription_plans.capacity_limits has existed since 20260717102000
--   and NOTHING has ever read it. A plan could declare a ceiling on companies,
--   branches or user seats and every one of those ceilings was decoration: the
--   column was validated on write (org.validate_plan_documents) and then never
--   consulted again, by the database or by the application. This migration is
--   the reader, and it puts the rule at the last line of defence rather than in
--   a service method that a second writer could bypass.
--
-- Dependencies
--   20260717101000 (org.tenants), 20260717102000 (org.subscription_plans,
--   org.tenant_subscriptions and the point-in-time resolution rule),
--   20260717103000 (org.legal_companies, org.branches and their RLS),
--   20260718090000 (iam.user_accounts), 20260718097000 (iam.has_permission,
--   iam.current_tenant_id, iam.allowed_company_ids, iam.allowed_branch_ids),
--   20260726090000 (the runtime administration policies this one ANDs with).
--
-- ## The limit keys
--
--   capacity_limits is an OPEN jsonb object: org.validate_plan_documents
--   accepts any key whose value is a non-negative number and constrains the
--   key names not at all. Three keys are therefore given meaning HERE and
--   nowhere else — `max_companies`, `max_branches`, `max_users` — and a key
--   this file does not name stays inert, exactly as every key was before.
--   An ABSENT key means unlimited. It does not mean zero, and the distinction
--   is load-bearing: every plan version that exists today carries no key at
--   all, so reading absence as zero would stop the platform dead.
--
-- ## Why the serialisation is an advisory lock and not SELECT ... FOR UPDATE
--
--   The obvious concurrency control is a row lock on org.tenants. It does not
--   work here, and the reason was measured rather than assumed: PostgreSQL
--   applies the UPDATE policies to `SELECT ... FOR UPDATE` as well as the
--   SELECT policies, and the only UPDATE policy on org.tenants is
--   upd_tenants_settings, whose USING term requires
--   iam.has_permission('org.settings.manage'). An administrator holding
--   org.company.manage and not org.settings.manage therefore locks NOTHING and
--   the statement returns zero rows — a silent failure that looks like a
--   missing tenant. A per-tenant advisory transaction lock is subject to
--   neither RLS nor a column grant, releases at COMMIT or ROLLBACK, and is the
--   pattern this repository already uses for exactly this shape of guard —
--   iam.audit_append, svc.service_categories and inv.item_categories all take
--   a per-tenant pg_advisory_xact_lock for the same reason.
--
-- ## Why the counts are trustworthy under SECURITY INVOKER
--
--   Every function here is SECURITY INVOKER — no SECURITY DEFINER is
--   introduced — so the counts run under the caller's own RLS.
--   sel_user_accounts_tenant is tenant-scoped and nothing narrows it, so the
--   seat count is exact for every session. sel_legal_companies_tenant and
--   sel_branches_scope additionally narrow by iam.allowed_company_ids() and
--   iam.allowed_branch_ids(), so a SCOPED session would count only its own
--   subset and could walk past a ceiling it cannot see. That is closed at the
--   gate rather than in the count: the two RESTRICTIVE INSERT policies below
--   admit only a session with NO company and NO branch narrowing, so every
--   session that can reach the insert counts the whole tenant. Creating a
--   legal entity or a branch is a tenant-structural act and a company-scoped
--   administrator has no scope over the thing they would be creating, so the
--   term is a correct rule in its own right as well as the thing that makes
--   the arithmetic honest.
--
-- ## Why the policies are RESTRICTIVE
--
--   ins_legal_companies_tenant and ins_branches_scope are PERMISSIVE and carry
--   no permission term at all. A second PERMISSIVE policy would OR with them
--   and constrain nothing — it would WIDEN the surface while appearing to
--   narrow it. RESTRICTIVE policies AND, which is the only way to add a
--   requirement to a table that already admits the write.
--
-- ## The provisioning exemption
--
--   org.provision_organization creates the tenant, its company and its pilot
--   branch in one transaction, and the tenant is `provisioning` for all of it
--   (activation, when it is requested at all, is the last step). A tenant in
--   `provisioning` is therefore exempt: the capacity rule applies to a live
--   organisation growing, not to one being born. Everything else is refused
--   with `tenant_not_active`, so a suspended or closed organisation cannot
--   quietly add capacity while its subscription is not running.
--
-- ## The numbering authority that comes with a branch
--
--   Every human-facing document number comes from shared.next_display_number,
--   which refuses `no_data_found` when no row is configured for
--   (tenant, company, branch, code) — and three of the eight registered runs
--   (invoice, quotation, receipt) are configured PER BRANCH. Until now the only
--   writer of those rows was the provisioning bootstrap running as app_platform
--   under ins_number_sequences_platform, whose predicate requires the tenant to
--   be `provisioning`. A branch created after that moment would therefore be a
--   branch that cannot issue an invoice, quote a job, or receipt a payment, and
--   no request could fix it. Section 7 gives app_runtime the narrowest INSERT
--   that closes it: tenant-scoped, gated on org.branch.manage, and only for a
--   row naming a company and a branch that exist together in this tenant.
--
-- Objects created
--   Functions: org.capacity_limit(), org.capacity_used(),
--              org.capacity_usage(), org.assert_capacity_available(),
--              org.enforce_capacity()
--   Triggers:  tg_legal_companies_capacity, tg_branches_capacity,
--              tg_user_accounts_capacity
--   Policies:  ins_legal_companies_capacity_authority (RESTRICTIVE),
--              ins_branches_capacity_authority (RESTRICTIVE),
--              ins_number_sequences_branch_authority
--   Grants:    INSERT on shared.number_sequences to app_runtime
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. org.capacity_limit — the ceiling, or NULL for unlimited.
--
--    Resolution repeats the predicate of org.current_subscription_plan_id
--    rather than calling it, and the difference is the tenant: that function
--    takes its tenant from iam.current_tenant_id() and nothing else, which is
--    correct for a request-path read and unusable from a trigger that must
--    answer for the tenant of the ROW being written. The predicate itself is
--    transcribed unchanged — status = 'active' and the effective range covering
--    the instant — so the two resolve the same assignment, and the EXCLUDE
--    constraint ex_tenant_subscriptions_no_active_overlap still guarantees at
--    most one row matches.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.capacity_limit(p_tenant uuid, p_kind text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_limit numeric;
BEGIN
  IF p_kind NOT IN ('companies', 'branches', 'users') THEN
    RAISE EXCEPTION 'unknown capacity kind %', p_kind USING ERRCODE = 'check_violation';
  END IF;

  SELECT (p.capacity_limits ->> ('max_' || p_kind))::numeric
    INTO v_limit
    FROM org.tenant_subscriptions s
    JOIN org.subscription_plans p ON p.id = s.plan_id
   WHERE s.tenant_id = p_tenant
     AND s.status = 'active'
     AND pg_catalog.tstzrange(s.effective_from, s.effective_to, '[)') @> pg_catalog.now();

  -- No assignment, or an assignment whose plan names no key for this kind:
  -- both are unlimited. Absence is never zero.
  IF v_limit IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.floor(v_limit)::integer;
END;
$$;

COMMENT ON FUNCTION org.capacity_limit(uuid, text) IS
  'The subscription ceiling on companies, branches or user seats for one tenant at now(), or NULL when the plan declares none — NULL is UNLIMITED and an absent key is never read as zero. Reads capacity_limits -> max_<kind> of the active plan version resolved by the same predicate org.current_subscription_plan_id uses, taking the tenant as an argument because a trigger must answer for the tenant of the row being written rather than for the session. SECURITY INVOKER and STABLE: a session resolves only the assignment sel_tenant_subscriptions_tenant lets it see.';

REVOKE EXECUTE ON FUNCTION org.capacity_limit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.capacity_limit(uuid, text) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 2. org.capacity_used — what the tenant is consuming right now.
--
--    Soft-deleted rows are free, and so is anything that is not `active` on the
--    org side: a deactivated company or branch is a record of something that
--    once ran, not a live unit of capacity. On the identity side a seat is
--    consumed by `invited` and `active` accounts — an invitation that has not
--    been accepted still holds the place it was issued for, while `locked` and
--    `archived` accounts do not, the first because it is a suspended principal
--    and the second because it is terminal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.capacity_used(p_tenant uuid, p_kind text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_used integer;
BEGIN
  IF p_kind = 'companies' THEN
    SELECT pg_catalog.count(*) INTO v_used
      FROM org.legal_companies c
     WHERE c.tenant_id = p_tenant AND c.deleted_at IS NULL AND c.status = 'active';
  ELSIF p_kind = 'branches' THEN
    SELECT pg_catalog.count(*) INTO v_used
      FROM org.branches b
     WHERE b.tenant_id = p_tenant AND b.deleted_at IS NULL AND b.status = 'active';
  ELSIF p_kind = 'users' THEN
    SELECT pg_catalog.count(*) INTO v_used
      FROM iam.user_accounts u
     WHERE u.tenant_id = p_tenant AND u.deleted_at IS NULL
       AND u.status IN ('invited', 'active');
  ELSE
    RAISE EXCEPTION 'unknown capacity kind %', p_kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_used;
END;
$$;

COMMENT ON FUNCTION org.capacity_used(uuid, text) IS
  'Live consumption of one capacity kind for one tenant: active non-deleted legal companies, active non-deleted branches, or user accounts in a seat-holding status (invited or active — locked and archived hold no seat). SECURITY INVOKER, so the count is taken under the caller''s own RLS; the RESTRICTIVE insert policies added with this migration are what keep a company- or branch-narrowed session out of the write path, so every session that can reach the enforcement counts the whole tenant.';

REVOKE EXECUTE ON FUNCTION org.capacity_used(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.capacity_used(uuid, text) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 3. org.capacity_usage — the whole picture, in one document.
--
--    The shape is fixed and is a published contract: the tenant-side capacity
--    read and the platform console both call this function by name, and a
--    limit is `null` rather than absent so a caller never has to distinguish
--    "unlimited" from "the key was dropped".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.capacity_usage(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'companies', pg_catalog.jsonb_build_object(
      'used',  org.capacity_used(p_tenant, 'companies'),
      'limit', org.capacity_limit(p_tenant, 'companies')),
    'branches', pg_catalog.jsonb_build_object(
      'used',  org.capacity_used(p_tenant, 'branches'),
      'limit', org.capacity_limit(p_tenant, 'branches')),
    'users', pg_catalog.jsonb_build_object(
      'used',  org.capacity_used(p_tenant, 'users'),
      'limit', org.capacity_limit(p_tenant, 'users'))
  );
$$;

COMMENT ON FUNCTION org.capacity_usage(uuid) IS
  'Companies, branches and user seats for one tenant as {"companies":{"used":n,"limit":m|null},...}. The key set and the null-means-unlimited convention are a published contract: the tenant capacity read and the platform console both call this function by name and neither may be made to guess. SECURITY INVOKER — a session sees the usage its own RLS admits.';

REVOKE EXECUTE ON FUNCTION org.capacity_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.capacity_usage(uuid) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 4. org.assert_capacity_available — the refusal.
--
--    Raised as check_violation with a MACHINE-READABLE message and a json
--    DETAIL, because the service layer maps SQLSTATE plus message to a problem
--    code and the screen has to be able to say WHICH ceiling was reached and
--    what it is. A prose-only error would arrive at the API as an unclassified
--    23514 and leave the caller with nothing to render.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.assert_capacity_available(p_tenant uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_limit  integer;
  v_used   integer;
BEGIN
  -- Serialises every capacity decision for this tenant. Two transactions each
  -- adding the last branch queue here, so the second one counts the first one's
  -- row and is refused instead of both reading the same pre-insert total.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('org.capacity:' || p_tenant::text));

  SELECT t.status INTO v_status FROM org.tenants t WHERE t.id = p_tenant;
  IF NOT FOUND THEN
    -- The row is invisible or absent. The foreign key on the table being
    -- written produces the canonical error; nothing to add here.
    RETURN;
  END IF;

  -- A tenant being provisioned is exempt: org.provision_organization creates
  -- the tenant, its company and its pilot branch in one transaction and the
  -- tenant is `provisioning` throughout.
  IF v_status = 'provisioning' THEN
    RETURN;
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'tenant_not_active'
      USING ERRCODE = 'check_violation',
            DETAIL  = pg_catalog.json_build_object('status', v_status)::text;
  END IF;

  v_limit := org.capacity_limit(p_tenant, p_kind);
  IF v_limit IS NULL THEN
    RETURN;                                  -- no ceiling declared: unlimited
  END IF;

  v_used := org.capacity_used(p_tenant, p_kind);
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'capacity_limit_reached'
      USING ERRCODE = 'check_violation',
            DETAIL  = pg_catalog.json_build_object(
                        'kind', p_kind, 'limit', v_limit, 'used', v_used)::text;
  END IF;
END;
$$;

COMMENT ON FUNCTION org.assert_capacity_available(uuid, text) IS
  'Refuses one more unit of a capacity kind for a tenant. Takes a per-tenant advisory transaction lock first, so two concurrent creations of the last permitted unit serialise and the second is refused. A tenant in `provisioning` is exempt (that is the state org.provision_organization runs in); any other non-active status raises `tenant_not_active`; a reached ceiling raises `capacity_limit_reached` with a json DETAIL naming kind, limit and used so the service can answer with a problem document the screen can render. SECURITY INVOKER; both errors are check_violation.';

REVOKE EXECUTE ON FUNCTION org.assert_capacity_available(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.assert_capacity_available(uuid, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 5. org.enforce_capacity — the trigger wrapper.
--
--    On the TABLE rather than in a service method on purpose: the invitation
--    path, the two new creation operations and any writer a later phase adds
--    all pass through here, so the seat ceiling cannot be missed by a new call
--    site that forgot to ask.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.enforce_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM org.assert_capacity_available(NEW.tenant_id, TG_ARGV[0]);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.enforce_capacity() IS
  'BEFORE INSERT trigger wrapper: calls org.assert_capacity_available for the tenant of the row being written, with the capacity kind given as the trigger argument. Lives on the table rather than in an application service so that every writer — the two organisation creation operations, the invitation path, and anything a later phase adds — is covered without asking.';

REVOKE EXECUTE ON FUNCTION org.enforce_capacity() FROM PUBLIC;

CREATE TRIGGER tg_legal_companies_capacity
  BEFORE INSERT ON org.legal_companies
  FOR EACH ROW EXECUTE FUNCTION org.enforce_capacity('companies');

CREATE TRIGGER tg_branches_capacity
  BEFORE INSERT ON org.branches
  FOR EACH ROW EXECUTE FUNCTION org.enforce_capacity('branches');

CREATE TRIGGER tg_user_accounts_capacity
  BEFORE INSERT ON iam.user_accounts
  FOR EACH ROW EXECUTE FUNCTION org.enforce_capacity('users');

-- ----------------------------------------------------------------------------
-- 6. The creation authority, as RESTRICTIVE policies.
--
--    Two terms, each doing work the other cannot:
--
--      * the permission term is what finally makes org.company.manage and
--        org.branch.manage mean something at the database. Both codes have been
--        seeded since P1-04 and until now neither gated a single write here —
--        ins_legal_companies_tenant and ins_branches_scope ask only for the
--        tenant.
--      * the unrestricted term is what makes the capacity count above exact.
--        A company- or branch-narrowed session sees a subset of its own
--        organisation, so it would count a subset and could walk past a ceiling
--        it cannot see. It is also the right rule on its own terms: a session
--        scoped to one company has no scope over a company or a branch that
--        does not exist yet.
--
--    TO app_runtime only. The platform and owner connections that run
--    provisioning are untouched, as is app_worker, which holds no INSERT here.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_legal_companies_capacity_authority ON org.legal_companies
  AS RESTRICTIVE
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('org.company.manage')
    AND iam.allowed_company_ids() IS NULL
  );

COMMENT ON POLICY ins_legal_companies_capacity_authority ON org.legal_companies IS
  'RESTRICTIVE so it ANDs with ins_legal_companies_tenant rather than ORing with it: a second permissive policy on a table that already admits the write would widen the surface while appearing to narrow it. Requires org.company.manage — the first write in the product that code has ever gated — and an UNNARROWED session, which is what makes org.capacity_used count the whole tenant under the caller''s own RLS instead of the subset a scoped session can see.';

CREATE POLICY ins_branches_capacity_authority ON org.branches
  AS RESTRICTIVE
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('org.branch.manage')
    AND iam.allowed_company_ids() IS NULL
    AND iam.allowed_branch_ids() IS NULL
  );

COMMENT ON POLICY ins_branches_capacity_authority ON org.branches IS
  'RESTRICTIVE, for the reason given on the legal-company policy. Requires org.branch.manage and a session narrowed by neither company nor branch: the branch ceiling is tenant-wide, so a session that can see only one company''s branches would count only those and could exceed a limit it cannot observe.';

-- ----------------------------------------------------------------------------
-- 7. The numbering rows a new branch owes.
--
--    app_runtime held SELECT on shared.number_sequences and nothing else, and
--    the single INSERT policy on the table requires platform authority AND a
--    tenant in `provisioning`. That is correct for the provisioning bootstrap
--    and useless afterwards: a branch created on a live tenant would carry no
--    invoice, quotation or receipt sequence, and shared.next_display_number
--    refuses rather than degrading, so the first invoice issued in that branch
--    would fail with an error no caller could act on.
--
--    The grant below is INSERT only — no UPDATE, no DELETE — and the policy
--    narrows it four ways: the tenant must be the session's own, the actor must
--    hold org.branch.manage, the row must name BOTH a company and a branch (so
--    this can never mint the tenant-wide runs, which stay platform-only), and
--    that company/branch pair must actually exist together in this tenant. The
--    prefix, width and reset rule are deliberately not constrained here: they
--    are an operator's configuration, and upd_number_sequences_tenant already
--    contemplates a tenant changing them.
-- ----------------------------------------------------------------------------
GRANT INSERT ON shared.number_sequences TO app_runtime;

CREATE POLICY ins_number_sequences_branch_authority ON shared.number_sequences
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('org.branch.manage')
    AND company_id IS NOT NULL
    AND branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org.branches b
       WHERE b.tenant_id = shared.number_sequences.tenant_id
         AND b.company_id = shared.number_sequences.company_id
         AND b.id = shared.number_sequences.branch_id
    )
  );

COMMENT ON POLICY ins_number_sequences_branch_authority ON shared.number_sequences IS
  'Lets a tenant administrator holding org.branch.manage create the per-branch numbering runs a NEW branch owes. ins_number_sequences_platform cannot: it requires platform authority and a tenant still in `provisioning`, which is the state a branch created after provisioning is not in. Deliberately cannot mint a tenant-wide run — company_id and branch_id are both required NOT NULL — and cannot name a pair that is not a real branch of this tenant.';

-- ----------------------------------------------------------------------------
-- Exact inverse (ROLLBACK-SAFE — nothing here writes data)
--
--   DROP POLICY ins_number_sequences_branch_authority ON shared.number_sequences;
--   REVOKE INSERT ON shared.number_sequences FROM app_runtime;
--   DROP POLICY ins_branches_capacity_authority ON org.branches;
--   DROP POLICY ins_legal_companies_capacity_authority ON org.legal_companies;
--   DROP TRIGGER tg_user_accounts_capacity ON iam.user_accounts;
--   DROP TRIGGER tg_branches_capacity ON org.branches;
--   DROP TRIGGER tg_legal_companies_capacity ON org.legal_companies;
--   DROP FUNCTION org.enforce_capacity();
--   DROP FUNCTION org.assert_capacity_available(uuid, text);
--   DROP FUNCTION org.capacity_usage(uuid);
--   DROP FUNCTION org.capacity_used(uuid, text);
--   DROP FUNCTION org.capacity_limit(uuid, text);
-- ----------------------------------------------------------------------------
