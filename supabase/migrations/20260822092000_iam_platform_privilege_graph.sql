-- ============================================================================
-- Migration: platform privilege graph (PRE-P1-29 Wave B, slice B1)
--
-- Rollback classification: ROLLBACK-SAFE. Grants and policies only — no table,
--   no function, no trigger, no data. The down script REVOKEs every grant and
--   DROPs every policy named below, and the result is a role that can do
--   nothing, which is the state before this file ran. Reversing it disables the
--   control plane; it cannot corrupt or lose anything.
--
-- Specification: wave-b-control-plane-design-v2.md revision 4, sections 6 and 7
--                (migration M2). Merged as c081a019, reviewed head 0bb6d882.
--
-- Why this file is written the way it is
--   Three adversarial passes over the design found FIVE instances of one defect,
--   and every one of them was an UNDER-grant: a privilege the runtime path
--   genuinely needs that the design had not enumerated, because it reasoned at
--   the entry point rather than along the whole SECURITY INVOKER call chain.
--
--     B1  the audit writer's three helpers (iam.audit_mask/canonical/hash)
--     B2  the resolver's own read of iam.user_accounts
--     B3  a FOR UPDATE policy whose USING was reused as its check
--     4   org.change_tenant_status's `SELECT ... FOR UPDATE` on org.tenants
--     5   org.change_tenant_status's SECOND write, org.tenant_status_history,
--         left to a policy whose predicate the first write makes false
--
--   So this file is organised BY EXECUTION PATH rather than by object type, and
--   each path lists every link: entry function, called functions, trigger
--   functions, table privileges, and the row-level policy for each action. A
--   privilege with no stated caller does not belong here.
--
--   The repository's own privilege gate could not have caught any of the five:
--   scripts/ci/rls-matrix.mjs:236-237 short-circuits on `if (!granted)`, so it
--   detects OVER-granting and is structurally blind to under-granting, and it
--   tests table privileges only (:87, :221-224) so function grants are outside
--   it entirely. tests/db/platform-privilege-closure.test.ts is the compensating
--   control: it asserts REQUIRED -> PRESENT, the opposite direction.
--
-- Security implications
--   * app_platform receives NO privilege on any tenant business table. The one
--     identity read it holds is column-scoped to three columns of
--     iam.user_accounts and row-scoped to the operator's own row.
--   * Every policy carries a real predicate. There is no USING (true).
--   * The bootstrap window — `org.tenants.status = 'provisioning'` — is the
--     containment for every identity write. It closes on the tenant's first
--     legal transition, and the previous migration makes it impossible to
--     reopen.
--   * The lifecycle UPDATE policy carries an explicit WITH CHECK; without one a
--     FOR UPDATE policy reuses its USING as the check, which is how the design
--     admitted `provisioning` as a destination.
--   * No SECURITY DEFINER is introduced, and none is needed.
--   * app_platform is NOT granted membership in app_runtime, deliberately: the
--     delegation backstop exits early for a non-member (20260727090000:108-110),
--     so membership would silently change that function's behaviour.
--
-- Objects created
--   Grants and policies only. No table, no function, no trigger.
-- ============================================================================

-- ============================================================================
-- PATH 0 — context and authority resolution (design 5.2, 7.2)
--   Reached by: every path below, and by every policy predicate in this file.
-- ============================================================================

-- Context readers. iam.current_user_id() is reached on five paths: the resolver
-- below, org.provision_organization (20260717107000:121),
-- org.change_tenant_status (20260717101000:193), shared.touch_row_metadata
-- (0002_base_schemas.sql:195) fired by every row-metadata trigger, and
-- iam.stamp_user_status_history (20260718090000:238).
-- iam.current_tenant_id() is reached by every audit policy in PATH 4.
GRANT EXECUTE ON FUNCTION iam.current_user_id()   TO app_platform;
GRANT EXECUTE ON FUNCTION iam.current_tenant_id() TO app_platform;

-- WITHHELD, and the reasoning that once granted them is recorded because it was
-- wrong in an instructive way.
--
--   iam.allowed_company_ids() and iam.allowed_branch_ids() were granted here as
--   "B1-UG-002, found by execution". They were not. The 42501 that prompted it
--   came from a PROBE that called them directly; no sanctioned path does.
--   Verified against the catalogue rather than by reading: zero policies granted
--   to app_platform reference either helper, and no function app_platform may
--   execute mentions them. The 294 policies that DO use them live in business
--   schemas where this role holds nothing at all.
--
--   So the grant was over-grant dressed as a repair, and the mutation that
--   "proved" it revoked the grant and then called the helper directly — turning
--   red only its own probe. Withholding them is strictly narrower and makes the
--   C9 asymmetry unreachable by construction for the control plane: it cannot
--   ask what narrowing it carries, and no policy of its own would consult the
--   answer.

-- The resolver itself, evaluated as app_platform inside every policy below.
GRANT EXECUTE ON FUNCTION iam.has_platform_authority(text) TO app_platform;
GRANT EXECUTE ON FUNCTION iam.holds_any_platform_authority() TO app_platform;

-- Its two reads. Without these the resolver raises insufficient_privilege at
-- executor start rather than answering false, and every policy that calls it
-- becomes unreachable rather than merely restrictive.
GRANT SELECT ON iam.platform_grants TO app_platform;

-- B1-UG-004, found by EXECUTION. org.tenant_has_recoverable_owner joins
-- iam.role_grants to iam.user_accounts on (id, tenant_id), so the column-scoped
-- read has to include tenant_id or the readiness check raises
-- "permission denied for table user_accounts" and every activation fails. The
-- fourth instance of the same class in this slice — and the column list is
-- exactly the shape that hides one, because three of the four columns were
-- already there.
GRANT SELECT (id, tenant_id, status, deleted_at) ON iam.user_accounts TO app_platform;

CREATE POLICY sel_user_accounts_platform_self ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (id = iam.current_user_id());

COMMENT ON POLICY sel_user_accounts_platform_self ON iam.user_accounts IS
  'The control-plane resolver''s existence-and-active test, and the ONLY read app_platform holds on an identity table outside a bootstrap window. One row — the operator''s own — and three columns, granted separately. It carries no tenant term so it resolves in both platform request shapes, including the one that runs before any tenant exists.';

-- ============================================================================
-- PATH 1 — organisation read (design 6.5)
--   Entry: a SELECT on org.tenants from the control plane.
-- ============================================================================

GRANT SELECT ON org.tenants TO app_platform;

-- Satisfiable by ANY platform authority, not only the read code: the lifecycle
-- path must read the row it is about to change, and the three codes are
-- deliberately separable (design 4.2). Written out rather than described.
CREATE POLICY sel_tenants_platform ON org.tenants
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.read')
    OR iam.has_platform_authority('platform.organization.lifecycle')
    OR iam.has_platform_authority('platform.organization.provision')
  );

COMMENT ON POLICY sel_tenants_platform ON org.tenants IS
  'Control-plane read of the tenant root, and nothing beneath it: an operator can see that a tenant exists and what state it is in, never its customers, vehicles or work. Satisfiable by any of the three platform codes because org.change_tenant_status opens with SELECT ... FOR UPDATE (20260717101000:199) — a lifecycle-only holder that could not read would receive no_data_found instead of acting.';

-- ============================================================================
-- PATH 2 — provisioning (design 6.2)
--   Entry:  org.provision_organization(jsonb, text), SECURITY INVOKER
--   Writes: ten tables, :132 :142 :158 :172 :187 :204 :214 :226 :242 :270
--   Reads:  the replay table, the plan catalogue, and four RETURNING targets
-- ============================================================================

GRANT EXECUTE ON FUNCTION org.provision_organization(jsonb, text) TO app_platform;

-- NO trigger-function EXECUTE grants here, and the rule that used to justify
-- them — "a role cannot fire a trigger it may not execute" — is false.
-- PostgreSQL checks EXECUTE on a trigger function at CREATE TRIGGER, not when
-- the trigger fires. The proof is in this database: org.stamp_tenant_status_history
-- and shared.guard_number_sequence_regression fire on every write app_platform
-- makes to their tables and app_platform holds EXECUTE on NEITHER. The grant set
-- could not have been derived from the rule it cited, since by that rule it was
-- also incomplete.
--
-- Functions called from inside a trigger's BODY are a different matter — those
-- ARE checked at runtime, which is what B1-UG-003 really was. Those grants stay.

-- --- the tenant root ---------------------------------------------------------
-- The platform role may only ever CREATE a tenant in the provisioning state.
-- It may never insert one that is already live.
GRANT INSERT ON org.tenants TO app_platform;

CREATE POLICY ins_tenants_platform_provisioning ON org.tenants
  FOR INSERT TO app_platform
  WITH CHECK (
    status = 'provisioning'
    AND iam.has_platform_authority('platform.organization.provision')
  );

COMMENT ON POLICY ins_tenants_platform_provisioning ON org.tenants IS
  'Provisioning creates a tenant in the provisioning state or not at all. This is the head of the bootstrap window: every identity write below is predicated on the tenant still being in it, and the window closes on the first legal transition.';

-- --- children of a tenant still inside the bootstrap window -------------------
GRANT INSERT ON org.tenant_status_history   TO app_platform;
-- No SELECT. It was added for the chain-coherence term and withdrawn with it.
-- (The lesson it taught is kept: a policy expression is evaluated with the
-- INVOKING role's privileges, so a WITH CHECK that reads a table the writer
-- cannot SELECT raises 42501 on EVERY write rather than refusing the bad ones.)
GRANT INSERT ON org.tenant_subscriptions    TO app_platform;
GRANT INSERT ON org.legal_companies         TO app_platform;
GRANT INSERT ON org.branches                TO app_platform;
GRANT INSERT ON org.company_settings        TO app_platform;
GRANT INSERT ON org.branch_settings         TO app_platform;
GRANT INSERT ON org.tenant_feature_overrides TO app_platform;
GRANT INSERT ON shared.number_sequences     TO app_platform;

CREATE POLICY ins_tenant_subscriptions_platform ON org.tenant_subscriptions
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = tenant_subscriptions.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_legal_companies_platform ON org.legal_companies
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = legal_companies.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_branches_platform ON org.branches
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = branches.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_company_settings_platform ON org.company_settings
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = company_settings.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_branch_settings_platform ON org.branch_settings
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = branch_settings.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_tenant_feature_overrides_platform ON org.tenant_feature_overrides
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = tenant_feature_overrides.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_number_sequences_platform ON shared.number_sequences
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = number_sequences.tenant_id AND t.status = 'provisioning'));

-- The status-history insert performed BY PROVISIONING. It is separate from the
-- lifecycle one in PATH 3 for a reason the design learned the hard way: on the
-- provisioning path the tenant row is inserted first and is still
-- `provisioning` when its history row lands, and on the lifecycle path it is
-- not. One predicate cannot serve both.
CREATE POLICY ins_tenant_status_history_platform_provisioning ON org.tenant_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND to_state = 'provisioning'
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = tenant_status_history.tenant_id AND t.status = 'provisioning')
  );

-- --- reads the provisioning body performs ------------------------------------
-- RETURNING is evaluated against the SELECT policy, so four of these are reads
-- precisely because they are writes.
GRANT SELECT ON org.legal_companies      TO app_platform;
GRANT SELECT ON org.branches             TO app_platform;
GRANT SELECT ON org.tenant_subscriptions TO app_platform;
GRANT SELECT ON org.subscription_plans   TO app_platform;

-- These three carried NO authority term. Their only gate was the row property
-- "the tenant is still provisioning", and the reachability of THAT depended on
-- sel_tenants_platform, whose floor is platform.organization.read — so a
-- read-only operator could read every provisioning tenant's legal name,
-- registration number and tax registration number. A containment that lives in
-- another table's policy is a containment nobody reviewing this file can see.
CREATE POLICY sel_legal_companies_platform ON org.legal_companies
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = legal_companies.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY sel_branches_platform ON org.branches
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = branches.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY sel_tenant_subscriptions_platform ON org.tenant_subscriptions
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = tenant_subscriptions.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY sel_subscription_plans_platform ON org.subscription_plans
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.provision'));

-- --- replay protection --------------------------------------------------------
-- Narrow on BOTH axes: the tenant column absent AND the operation name fixed.
-- app_platform must not be able to read or write any tenant's replay records.
GRANT SELECT, INSERT ON shared.idempotency_keys TO app_platform;

-- Both axes below are properties of the ROW. They narrow WHICH rows and say
-- nothing about WHO, so on their own a zero-authority platform session could
-- read every platform provisioning response ever stored — each carries the
-- tenant, company, branch and subscription ids of a real organisation — and
-- could plant a key that makes a later legitimate call replay a document it
-- chose. The authority conjunct is what makes them about the caller too.
CREATE POLICY sel_idempotency_keys_platform ON shared.idempotency_keys
  FOR SELECT TO app_platform
  USING (
    tenant_id IS NULL
    AND operation = 'org_provisioning'
    AND iam.has_platform_authority('platform.organization.provision')
  );
CREATE POLICY ins_idempotency_keys_platform ON shared.idempotency_keys
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id IS NULL
    AND operation = 'org_provisioning'
    AND iam.has_platform_authority('platform.organization.provision')
  );

COMMENT ON POLICY sel_idempotency_keys_platform ON shared.idempotency_keys IS
  'Platform-scope replay rows only — the tenant column absent AND the operation fixed. The runtime''s own policies read tenant_id = iam.current_tenant_id(), which is never true for a platform row, so provisioning could not use replay protection at all without this pair; and the operation predicate stops the control plane reading any tenant''s replay history.';

-- ============================================================================
-- PATH 3 — tenant lifecycle (design 6.4)
--   Entry:  org.change_tenant_status(...), SECURITY INVOKER
--   Body:   SELECT ... FOR UPDATE (:199), UPDATE (:219), INSERT history (:221)
--   The three statements need three different privileges, and the design
--   enumerated only the middle one until the fourth and fifth review findings.
-- ============================================================================

GRANT EXECUTE ON FUNCTION org.change_tenant_status(uuid, text, text, uuid, uuid) TO app_platform;

-- B1-UG-003, found by EXECUTION and the one EXECUTE on this path that is real.
-- org.guard_tenant_status_transition is a TRIGGER function, so app_platform does
-- not need EXECUTE on it to fire it — but the guard's BODY calls
-- org.tenant_has_recoverable_owner as an ordinary function call, and THAT is
-- checked at runtime. Without it every lifecycle transition fails 42501
-- "permission denied for function tenant_has_recoverable_owner", naming a
-- function the caller never wrote down.
GRANT EXECUTE ON FUNCTION org.tenant_has_recoverable_owner(uuid)   TO app_platform;

-- The status column only, in the shape the repository already uses for a
-- column-scoped grant (20260726090000:174) — noting that grant deliberately
-- WITHHOLDS status, so this is a new privilege and not a precedent for itself.
GRANT UPDATE (status) ON org.tenants TO app_platform;

-- USING selects the rows this operator may act on; WITH CHECK constrains what
-- they may become. Both are required: a FOR UPDATE policy with only a USING
-- clause reuses it as the check, and `provisioning` would pass.
-- The tenant term is not decoration here, it is what makes the statement and
-- the readiness check agree about which tenant they are talking about.
--
-- Readiness is evaluated for NEW.id, and every read it performs is gated on
-- tenant_id = iam.current_tenant_id(). Without the same term on the UPDATE, a
-- lifecycle operator whose app.tenant_id is unset or points elsewhere passes the
-- policy, reaches the guard, and is refused with a message asserting the tenant
-- has no administrator — when what is actually true is that the SESSION could
-- not see one. That is the third recurrence of the B1-UG-005 shape and the
-- second refusal in this file that would have said something untrue.
--
-- It closes a second thing the file did not name. Without a tenant term this
-- single privilege reaches the whole estate: one UPDATE ... WHERE status =
-- 'active' would suspend every tenant in the database, and the backstop
-- deliberately does not require a history row, so it would do it with no
-- attribution at all. The history INSERT policy carries the tenant term; the
-- status UPDATE did not, so the audited half was narrow and the unaudited half
-- was not.
CREATE POLICY upd_tenants_platform_lifecycle ON org.tenants
  FOR UPDATE TO app_platform
  USING (
    id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.lifecycle')
  )
  WITH CHECK (
    id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.lifecycle')
    AND status IN ('active', 'suspended', 'closed')
  );

COMMENT ON POLICY upd_tenants_platform_lifecycle ON org.tenants IS
  'Control-plane lifecycle. The WITH CHECK refuses `provisioning` as a destination, so the bootstrap window cannot be reopened by an UPDATE; org.guard_tenant_status_transition enforces the full graph for every writer as the backstop behind it. The destination list alone is NOT the graph — closed -> active passes this check and is refused by the trigger.';

-- The SECOND write. §6.2's child predicate cannot serve it: the UPDATE two
-- statements earlier has already moved the parent out of `provisioning`, so
-- that predicate is false for EVERY lifecycle transition.
-- Two terms, where there used to be one, and the first is weaker than it looks.
--
-- The tenant term is app.tenant_id, which a platform session SETS ITSELF — the
-- file says so at the audit policies and it is no less true here. So it does not
-- stop a lifecycle holder reaching another tenant; it makes the reach explicit,
-- one tenant per statement, and it is the term the authority conjunct is scoped
-- against. Real containment on this surface is the AUTHORITY, not the tenant.
-- And the coherence term,
-- because without it the row need not describe a transition that happened:
-- org.change_tenant_status writes history AFTER the UPDATE (20260717101000:219,
-- :221), so on the sanctioned path the tenant already carries to_state by the
-- time this policy is evaluated, while a fabricated row inserted in its own
-- transaction does not. The sibling provisioning policy has carried exactly this
-- shape from the start; its absence here was an asymmetry, not a necessity.
CREATE POLICY ins_tenant_status_history_platform_lifecycle ON org.tenant_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.lifecycle')
    AND to_state IN ('active', 'suspended', 'closed')
    -- The destination must be where the tenant ACTUALLY is.
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = tenant_status_history.tenant_id
                   AND t.status = tenant_status_history.to_state)
    --
    -- A THIRD term was tried here and WITHDRAWN, which is worth recording because
    -- the reasoning for it was sound and the term was still wrong.
    --
    -- It required from_state to equal the destination of the tenant's most
    -- recent history row, so the row had to continue the chain. That closes a
    -- real residual — a lifecycle operator can still append a redundant edge
    -- whose destination is where the tenant already is. But the chain head has
    -- to be CHOSEN, and there is nothing to choose it by: occurred_at is stamped
    -- now(), which is the TRANSACTION timestamp, so two transitions in one
    -- transaction tie, and the tie-break falls to a random gen_random_uuid().
    -- Roughly half of such transactions would pick the wrong predecessor, fail
    -- the check, and roll the whole transition back — permanently, since the ids
    -- never change. A tenant with no history at all was worse: the subquery
    -- returns NULL, the check is never TRUE, and its first transition is
    -- impossible.
    --
    -- Refusing a truthful transition to block a redundant one is the wrong
    -- trade. The residual is bounded and is stated rather than hidden: a
    -- lifecycle operator can write a history row for a tenant whose destination
    -- matches that tenant's real current state. It cannot misrepresent where the
    -- tenant IS, it cannot write for another tenant it has not selected, and
    -- org.stamp_tenant_status_history records who did it.
  );

COMMENT ON POLICY ins_tenant_status_history_platform_lifecycle ON org.tenant_status_history IS
  'The history half of a lifecycle transition. A SEPARATE policy from the provisioning one, because org.change_tenant_status updates the parent (20260717101000:219) BEFORE inserting the history row (:221) — so the provisioning predicate, which requires the parent to still be `provisioning`, is false for every transition the graph permits. This was the fifth under-grant the design review found, and it is why the two paths carry two policies.';

-- ============================================================================
-- PATH 4 — audit (design 7)
--   Entry: iam.audit_append(...), SECURITY INVOKER, whose body performs three
--   inserts, two read-backs and a chain read, and calls three helpers.
-- ============================================================================

GRANT EXECUTE ON FUNCTION
  iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb)
  TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_mask(text, text)  TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid)   TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_hash(bytea, text) TO app_platform;

GRANT INSERT, SELECT ON iam.audit_records         TO app_platform;
GRANT INSERT, SELECT ON iam.audit_record_details  TO app_platform;
GRANT INSERT, SELECT ON iam.audit_integrity_links TO app_platform;

-- Each carries an AUTHORITY term as well as the tenant term. Without one these
-- six were the only B1 policies reachable by a platform session holding no
-- platform grant whatsoever: iam.current_tenant_id() returns whatever the
-- session put in app.tenant_id, so a zero-authority connection could have named
-- any tenant and appended a chain-valid record to it. The runtime's equivalents
-- are gated by the tenant term alone, but the runtime cannot choose its tenant —
-- the control plane can, which is exactly why it needs the extra conjunct.
-- The actor term is what makes provenance a DATABASE fact for the control
-- plane. iam.audit_append writes its p_actor argument verbatim
-- (20260725090000:199-204) and never consults the session, so the writer itself
-- cannot bind the actor — but the POLICY can, because it sees the finished row.
--
-- A wrapper function was the obvious alternative and does not work here: it
-- would have to be SECURITY INVOKER like everything else in this repository, so
-- revoking EXECUTE on the generic writer to force callers through it would
-- revoke it from the wrapper's own body too. Constraining the ROW needs no new
-- abstraction, no definer rights, and cannot be bypassed by calling the writer
-- directly — which is why app_platform KEEPS its EXECUTE on iam.audit_append
-- and still cannot forge an actor.
--
-- app_runtime's own audit semantics are untouched.
-- The authority term is the ACTING codes, not "any platform grant". For a
-- platform session app.tenant_id is a SELECTOR, not a narrowing — the session
-- chooses it — so the tenant conjunct contributes no containment here and the
-- authority conjunct is the whole gate. Gating on holds_any_platform_authority()
-- therefore let an operator holding only platform.organization.read, catalogued
-- medium risk, append a chain-valid record to ANY tenant's audit trail. Writing
-- audit is a consequence of provisioning or of a lifecycle change, and of
-- nothing else.
CREATE POLICY ins_audit_records_platform ON iam.audit_records
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.has_platform_authority('platform.organization.provision')
      OR iam.has_platform_authority('platform.organization.lifecycle'))
    AND actor_id = iam.current_user_id()
    -- seq is pinned HERE as well as on the chain link, and the first attempt at
    -- this pinned only the link. Both tables carry a caller-supplied seq and a
    -- UNIQUE (tenant_id, seq) — uq_audit_records_tenant_seq at 20260718095000:67
    -- is the one an attacker actually collides with — so pinning one of the two
    -- left the permanent audit denial fully reachable while the comment beside
    -- it claimed otherwise.
    --
    -- Derived from the LINKS table, not from this one. iam.audit_append computes
    -- a single v_seq as COALESCE(max(seq),0)+1 over iam.audit_integrity_links —
    -- "the chain is the sequence authority" — and writes that same value into
    -- both rows. Pinning this column to max(audit_records.seq)+1 would look
    -- right and would break the sanctioned path, because a record that is never
    -- chained advances this table's maximum and not the chain's.
    AND seq = (
      SELECT COALESCE(max(l.seq), 0) + 1 FROM iam.audit_integrity_links l
       WHERE l.tenant_id = audit_records.tenant_id
    )
    -- And the row cannot be backdated. iam.audit_append writes now()
    -- (20260725090000, the audit_records INSERT), which is the transaction
    -- timestamp, so pinning to now() accepts the sanctioned path exactly and
    -- refuses any other value. B1 added a stamp trigger to
    -- org.tenant_status_history for precisely this reason — "so a caller holding
    -- a direct INSERT cannot backdate a transition" — and in the same slice
    -- granted INSERT on this column of a table that carries no triggers at all.
    AND occurred_at = now()
  );

-- The child rows carry the actor term TRANSITIVELY, by requiring a parent this
-- session authored and has not yet chained. Without that they were bound only by
-- tenant and authority, and a foreign-key check bypasses row-level security — so
-- fabricated field-changes could be attached to a COMMITTED record belonging to a
-- tenant employee, and rendered under that employee's name. The parent term is
-- the actor binding reaching the table the actor column is not on.
CREATE POLICY ins_audit_record_details_platform ON iam.audit_record_details
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    -- Stated, not inherited. The parent EXISTS below implies authority was held
    -- WHEN THE PARENT WAS WRITTEN, which is not the same as holding it now — a
    -- revoked operator could still have finished a chain it started. The comment
    -- above this block claimed all three policies carried an authority term and
    -- only one of them did.
    AND (iam.has_platform_authority('platform.organization.provision')
      OR iam.has_platform_authority('platform.organization.lifecycle'))
    AND EXISTS (
      SELECT 1 FROM iam.audit_records r
       WHERE r.id = audit_record_details.audit_record_id
         AND r.tenant_id = audit_record_details.tenant_id
         AND r.actor_id = iam.current_user_id()
         AND NOT EXISTS (SELECT 1 FROM iam.audit_integrity_links l
                          WHERE l.audit_record_id = r.id)
    )
  );

-- seq is caller-supplied: bigint, no default, no identity, no trigger, and the
-- only CHECK is that it is positive. iam.audit_append computes the next link as
-- COALESCE(max(seq),0)+1, so a single planted row carrying max(bigint) makes
-- every FUTURE append for that tenant fail 22003 — permanently, for app_runtime
-- too, with no DELETE privilege anywhere to undo it. Constraining seq to the
-- value the writer would itself compute makes the planted row unrepresentable.
CREATE POLICY ins_audit_integrity_links_platform ON iam.audit_integrity_links
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.has_platform_authority('platform.organization.provision')
      OR iam.has_platform_authority('platform.organization.lifecycle'))
    AND EXISTS (
      SELECT 1 FROM iam.audit_records r
       WHERE r.id = audit_integrity_links.audit_record_id
         AND r.tenant_id = audit_integrity_links.tenant_id
         AND r.actor_id = iam.current_user_id()
    )
    AND seq = (
      SELECT COALESCE(max(l.seq), 0) + 1 FROM iam.audit_integrity_links l
       WHERE l.tenant_id = audit_integrity_links.tenant_id
    )
  );

-- Writer-scoped reads, mirroring the runtime's: a record with no chain link yet
-- is the row being written, and after COMMIT it is never any row. Committed
-- audit CONTENT stays behind iam.audit.view for every role — but see the chain
-- policy below, which is deliberately not writer-scoped.
--
-- All three name the two WRITE codes rather than holds_any_platform_authority().
-- These are reads the writer performs, so the authority that justifies them is
-- the authority to write; leaving them on "any platform grant" kept, on the read
-- side, exactly the breadth the write side was rewritten to remove.
CREATE POLICY sel_audit_records_platform_unlinked ON iam.audit_records
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.has_platform_authority('platform.organization.provision')
      OR iam.has_platform_authority('platform.organization.lifecycle'))
    AND NOT EXISTS (SELECT 1 FROM iam.audit_integrity_links l
                     WHERE l.audit_record_id = iam.audit_records.id)
  );
CREATE POLICY sel_audit_record_details_platform_unlinked ON iam.audit_record_details
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.has_platform_authority('platform.organization.provision')
      OR iam.has_platform_authority('platform.organization.lifecycle'))
    AND NOT EXISTS (SELECT 1 FROM iam.audit_integrity_links l
                     WHERE l.audit_record_id = iam.audit_record_details.audit_record_id)
  );
-- NOT unlinked-scoped, and it cannot be: iam.audit_append hashes onto the
-- PREVIOUS link, which is by definition committed. So unlike the two policies
-- above, this one does expose committed chain metadata — seq and the two hashes,
-- never any event content — for a tenant the session names. Stated plainly here
-- because the comment that used to follow claimed the opposite for all three.
-- It mirrors sel_audit_integrity_links_chain, which app_runtime has held since
-- 20260725090000, with an authority conjunct app_runtime's does not carry.
CREATE POLICY sel_audit_integrity_links_platform_chain ON iam.audit_integrity_links
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.has_platform_authority('platform.organization.provision')
      OR iam.has_platform_authority('platform.organization.lifecycle'))
  );

COMMENT ON POLICY sel_audit_records_platform_unlinked ON iam.audit_records IS
  'Writer-scoped read, NOT an audit-history read: exposes only a record with no chain link, which inside iam.audit_append is the row under construction and after COMMIT is never any row. No UPDATE or DELETE privilege exists on any audit table for any role, so the platform principal can append its own event and read it back, and can never amend or remove one — its own included.';

-- ============================================================================
-- PATH 5 — initial Owner bootstrap (design 6.3)
--   Every write is predicated on BOTH the bootstrap window and the provisioning
--   authority. The window closes on the tenant's first legal transition, so
--   this reach is self-limiting with no second mechanism to remember.
-- ============================================================================

-- Only the one called from inside a trigger BODY. The three trigger functions
-- themselves — iam.stamp_user_status_history, iam.enforce_scoped_grant_has_scope
-- and iam.enforce_grant_delegation_within_authority — fire without EXECUTE, as
-- every shipped app_runtime write path already demonstrates.
GRANT EXECUTE ON FUNCTION iam.grant_delegation_within_authority(uuid) TO app_platform;

GRANT INSERT ON iam.user_accounts       TO app_platform;
GRANT INSERT ON iam.user_status_history TO app_platform;
GRANT INSERT ON iam.roles               TO app_platform;
GRANT INSERT ON iam.role_permissions    TO app_platform;
GRANT INSERT ON iam.role_grants             TO app_platform;
-- SELECT is COLUMN-SCOPED. Four readers touch this table as app_platform — the
-- readiness predicate, the deferred trigger tg_role_grants_require_scope, the
-- delegation backstop, and the bootstrap read-back — and between them they use
-- eight of its seventeen columns. The nine withheld are grant administration
-- metadata (granted_by, approval_ref, revoke_reason, revoked_at, revoked_by and
-- the record/audit columns): the control plane has no question that needs them,
-- and they are the columns that say WHO did what inside a tenant.
GRANT SELECT (id, tenant_id, user_id, role_id, scope_mode, status, valid_from, valid_to)
  ON iam.role_grants TO app_platform;
GRANT INSERT, SELECT ON iam.grant_scopes TO app_platform;

-- The permission catalogue is platform reference data with no tenant column;
-- mapping the Owner role to permission CODES means resolving each to its row,
-- because iam.role_permissions.permission_id is a surrogate key
-- (20260718091000:125, :138).
GRANT SELECT ON iam.permissions TO app_platform;
-- All THREE codes, not just provision. The readiness predicate joins
-- iam.permissions and runs SECURITY INVOKER as the writing role, so a
-- lifecycle-only operator saw zero permission rows, the join yielded nothing,
-- and the predicate answered false for EVERY tenant — making activation and
-- reactivation structurally impossible for the very role that owns them, while
-- reporting the refusal as "nobody could recover its administration", which was
-- not true. It also silently coupled two codes the design keeps separate.
--
-- The catalogue is reference data: 115 rows naming what the product can do, the
-- same list the documentation publishes. Widening the read to the disjunction
-- sel_tenants_platform already uses gives away nothing.
CREATE POLICY sel_permissions_platform ON iam.permissions
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.read')
    OR iam.has_platform_authority('platform.organization.provision')
    OR iam.has_platform_authority('platform.organization.lifecycle')
  );

CREATE POLICY ins_user_accounts_platform_bootstrap ON iam.user_accounts
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = user_accounts.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_user_status_history_platform_bootstrap ON iam.user_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = user_status_history.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_roles_platform_bootstrap ON iam.roles
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = roles.tenant_id AND t.status = 'provisioning')
  );
-- The NOT EXISTS arm is the one that matters. Without it a bootstrap could map
-- a platform.* code into a tenant role. That would confer no platform authority
-- — iam.has_platform_authority reads iam.platform_grants and never
-- iam.role_permissions — but it would make iam.has_permission('platform.…')
-- answer true for a tenant user, which is a trap laid for any future route that
-- reaches for the wrong resolver. Refuse it at the source instead.
CREATE POLICY ins_role_permissions_platform_bootstrap ON iam.role_permissions
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = role_permissions.tenant_id AND t.status = 'provisioning')
    AND NOT EXISTS (SELECT 1 FROM iam.permissions p
                     WHERE p.id = role_permissions.permission_id
                       AND p.permission_code LIKE 'platform.%')
  );
CREATE POLICY ins_role_grants_platform_bootstrap ON iam.role_grants
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = role_grants.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_grant_scopes_platform_bootstrap ON iam.grant_scopes
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = grant_scopes.tenant_id AND t.status = 'provisioning')
  );

-- B1-UG-001, found by EXECUTION and not by review: every bootstrap write is
-- read back. `INSERT ... RETURNING id` is evaluated against the SELECT policy,
-- and the bootstrap needs each id it creates — the account to grant a role to,
-- the role to map permissions onto. With only the write policies a plain INSERT
-- succeeds and the same INSERT with RETURNING fails 42501, which is the most
-- misleading shape this defect class has produced so far.
--
-- These are permissive policies alongside sel_user_accounts_platform_self, so
-- they ADD the window-scoped read rather than widening the operator self-read.
-- Each closes with the window: once the tenant leaves `provisioning`, the
-- control plane can no longer read that tenant's identity rows at all.
GRANT SELECT ON iam.roles            TO app_platform;
GRANT SELECT ON iam.role_permissions TO app_platform;
GRANT SELECT ON iam.user_status_history TO app_platform;

CREATE POLICY sel_user_accounts_platform_bootstrap ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = user_accounts.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY sel_roles_platform_bootstrap ON iam.roles
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = roles.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY sel_role_permissions_platform_bootstrap ON iam.role_permissions
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = role_permissions.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY sel_user_status_history_platform_bootstrap ON iam.user_status_history
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = user_status_history.tenant_id AND t.status = 'provisioning')
  );

COMMENT ON POLICY sel_user_accounts_platform_bootstrap ON iam.user_accounts IS
  'The read-back half of the Owner bootstrap (B1-UG-001). Scoped to a tenant still inside its provisioning window, so it closes on the first legal transition and the control plane holds no standing read on any live tenant''s identity rows. Separate from sel_user_accounts_platform_self, which is the resolver''s own-row read and carries no tenant term.';

-- Reads the deferred constraint triggers perform as the writing role.
-- tg_role_grants_require_scope reads iam.role_grants unconditionally
-- (20260718092000:183-184), so a write-only grant aborts the bootstrap at
-- COMMIT rather than at the statement — the hardest kind of failure to trace.
-- B1-UG-005, found by EXECUTION and only by the reactivation case.
--
--   org.tenant_has_recoverable_owner is SECURITY INVOKER, so its two reads
--   happen under row-level security as the writing role. The bootstrap policies
--   below are window-scoped, so at REACTIVATION — when the tenant is suspended,
--   not provisioning — app_platform cannot see the grant, readiness answers
--   false, and a legitimate suspended -> active is refused.
--
--   The failure direction was safe (a refusal, not a widening), which is exactly
--   why only a positive control caught it: every negative case still passed.
--
--   These two policies are deliberately NARROWER than they look. They are gated
--   on the lifecycle authority — the authority that is about to change the
--   tenant state — and the column grants above already restrict what can be
--   read: on iam.user_accounts, four columns and no email, name or provider
--   subject. They expose whether a tenant is administrable, which is precisely
--   the question the operator is entitled to ask before activating it.
--   Every one of these carries the TENANT term. Without it a lifecycle holder
--   had a standing read of every role grant and every administrator account in
--   the entire estate, in every tenant state — which is not what "readiness at
--   activation time" needs and not what the comment below used to claim. The
--   readiness question is always asked about the tenant being acted on, and for
--   a platform session that tenant is the session's own context.
CREATE POLICY sel_role_grants_platform_lifecycle ON iam.role_grants
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.lifecycle')
  );
CREATE POLICY sel_user_accounts_platform_lifecycle ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.lifecycle')
    AND EXISTS (
      SELECT 1 FROM iam.role_grants g
       WHERE g.user_id = user_accounts.id
         AND g.tenant_id = user_accounts.tenant_id
         AND g.status = 'active'
    )
  );

-- The readiness predicate no longer stops at "a grant exists". It asks whether
-- the grant CONFERS anything — which means joining iam.roles, iam.role_permissions
-- and iam.permissions — and those three reads happen as the writing role too. The
-- bootstrap policies above are window-scoped, so outside the window they answer
-- nothing and reactivation would be refused for a tenant that is perfectly
-- administrable. This is the B1-UG-005 shape a second time, caught in design
-- rather than by running, because the predicate changed under it.
-- No sel_roles_platform_lifecycle. It was added when the readiness predicate
-- joined iam.roles to filter soft-deleted ones; removing that join to stay
-- faithful to iam.has_permission removed the only reader, and a policy nothing
-- reads is reach nobody can justify.
CREATE POLICY sel_role_permissions_platform_lifecycle ON iam.role_permissions
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.lifecycle')
  );

COMMENT ON POLICY sel_user_accounts_platform_lifecycle ON iam.user_accounts IS
  'Scoped to accounts that actually HOLD an active grant, which is narrower than it first looks and is load-bearing twice over. It keeps the control plane away from every ordinary employee record — only administrators are visible, and only four columns of them — and it deliberately does NOT cover a freshly created Owner account, whose grant does not exist yet. That second property is what keeps the B1-UG-001 mutation diagnostic: without it this policy would OR with the bootstrap read and silently make that regression irreproducible.';

COMMENT ON POLICY sel_role_grants_platform_lifecycle ON iam.role_grants IS
  'Readiness at activation time. org.tenant_has_recoverable_owner runs as the writing role, and the bootstrap read is window-scoped — so without this a suspended tenant looks unadministrable to the control plane even when it is not, and reactivation is refused. Gated on the lifecycle authority AND on the session tenant: the question is always about the tenant being acted on, and an earlier revision that omitted the tenant term granted a standing read of every grant in every tenant.';

CREATE POLICY sel_role_grants_platform_bootstrap ON iam.role_grants
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = role_grants.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY sel_grant_scopes_platform_bootstrap ON iam.grant_scopes
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = grant_scopes.tenant_id AND t.status = 'provisioning')
  );

COMMENT ON POLICY ins_role_grants_platform_bootstrap ON iam.role_grants IS
  'The initial Owner grant, and the reason the delegation backstop is not this path''s containment: iam.grant_delegation_within_authority returns true unconditionally for a caller that is not an app_runtime member (20260727090000:108-110), which app_platform deliberately is not. Containment is the conjunction here — platform authority AND the tenant still inside its bootstrap window — and the window closes on the tenant''s first legal transition, which the previous migration makes impossible to reverse.';

-- ============================================================================
-- Deliberately absent, named rather than merely omitted.
--
--   Not granted to app_platform anywhere above: BYPASSRLS; ownership of any
--   object; UPDATE or DELETE on ANY table except the single column-scoped
--   UPDATE (status) on org.tenants; TRUNCATE, REFERENCES or TRIGGER on any
--   table; any privilege on a tenant BUSINESS table (crm, veh, apt, rec, wo,
--   tech, dia, qms, svc, quo, inv, sal, wty, rpt) — none appears in this file;
--   EXECUTE on iam.audit_verify_chain, iam.change_user_status,
--   iam.has_permission, iam.has_permission_in_scope, org.change_branch_status,
--   shared.claim_outbox_events, shared.complete_outbox_event or
--   shared.fail_outbox_event; any access to shared.event_outbox,
--   shared.processed_events, shared.error_records or iam.security_events; and
--   any INSERT, UPDATE or DELETE on iam.platform_grants — establishing platform
--   authority stays an out-of-band act, which is what makes tenant-side
--   escalation structurally impossible rather than merely forbidden.
--
--   A list of withholdings is what makes a later over-grant visible. The
--   over-grant direction is checked by scripts/ci/rls-matrix.mjs; the
--   under-grant direction, which is where all five design defects lived, is
--   checked by tests/db/platform-privilege-closure.test.ts.
-- ============================================================================
