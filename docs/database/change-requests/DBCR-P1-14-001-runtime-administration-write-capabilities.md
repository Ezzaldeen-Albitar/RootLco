# DBCR-P1-14-001 — Runtime administration write capabilities for identity, access and tenant settings

**Status:** **IMPLEMENTED — awaiting merge into protected `develop`** ·
**Migration:** [`20260726090000_iam_org_runtime_administration_capabilities.sql`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql) ·
**Raised:** 2026-07-22 · **Implemented:** 2026-07-22 ·
**Phase:** P1-14 (Authentication, Authorization, and Administration Backend) ·
**Classification:** **BLOCKING** — see §4 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical owner; recorded under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Affects:** protected `origin/develop` `8c8e0fa5a4093781c98ed9c2a40ebee5a7f7a74b`
(114 migrations), which is byte-identical to `origin/main` `8aebbe8`.

> **Relationship to DBCR-P1-13-001.** That change request found the same class of defect at
> foundation scale: the Release 2 baseline grants `app_runtime` SELECT only, so the four
> foundation primitives failed closed. It was remediated additively and is RESOLVED. This
> change request is the administration-scale instance of the same finding, measured
> independently against the post-remediation baseline. It does not reopen or amend
> DBCR-P1-13-001.

---

## 1. Summary

P1-14 delivers user invitation and activation, session issuance and revocation, failed-login
handling and account lock, role and permission administration, scope and approval-limit
administration, and tenant settings. Every one of those is a **write** against `iam` or `org`.

The protected baseline blocks all of them **twice over**:

1. `app_runtime` holds **SELECT only** on all thirteen administration tables. After
   DBCR-P1-13-001 the role holds exactly four INSERT capabilities — audit records, audit
   details, audit chain links, security events — plus the outbox and idempotency tables in
   `shared`. Nothing else in `iam` is writable, and in `org` only the structural tables are.
2. Those same thirteen tables carry **no INSERT, UPDATE or DELETE policy at all**. All
   seventeen `iam` tables are `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`,
   so a privilege on its own would still be refused, and a policy on its own would still be
   refused. Both layers must be addressed or neither has any effect.

| #   | P1-14 capability                               | Required object                                        | Grant to `app_runtime`  | Write policy |
| --- | ---------------------------------------------- | ------------------------------------------------------ | ----------------------- | ------------ |
| 1   | Invite a user; activate, lock, deactivate      | `iam.user_accounts`                                    | SELECT only             | **none**     |
| 2   | Record a lifecycle transition                  | `iam.user_status_history`, `iam.change_user_status(…)` | SELECT only; no EXECUTE | **none**     |
| 3   | Issue, idle-touch and revoke a session         | `iam.user_sessions`                                    | SELECT only             | **none**     |
| 4   | Record login success, failure, lockout, logout | `iam.login_audit`                                      | SELECT only             | **none**     |
| 5   | Create and update a role                       | `iam.roles`                                            | SELECT only             | **none**     |
| 6   | Assign, re-effect and remove a permission      | `iam.role_permissions`                                 | SELECT only             | **none**     |
| 7   | Grant and revoke a role                        | `iam.role_grants`                                      | SELECT only             | **none**     |
| 8   | Assign and withdraw a scope                    | `iam.grant_scopes`                                     | SELECT only             | **none**     |
| 9   | Create and close an approval limit             | `iam.approval_limits`                                  | SELECT only             | **none**     |
| 10  | Update tenant settings                         | `org.tenants`                                          | SELECT only             | **none**     |

**Not a defect, recorded to prevent a false positive:** `org.company_settings` and
`org.branch_settings` need nothing. Their frozen design makes every column immutable on UPDATE
(`tg_*_settings_immutable` guards `setting_value`, `value_type`, `version`, `effective_from`
and `record_version`), and `app_runtime` already holds INSERT with a scoped INSERT policy. A
settings change is therefore a new version row, not an edit, and that path already works. The
first draft of this change request listed them as blocked; executing the probe disproved it.

## 2. Evidence (executed, not inferred)

Measured against the live protected baseline: PostgreSQL 17, local Supabase stack, 114
migrations applied, connected as `rootlco_test_runtime` — a LOGIN role whose only privilege is
membership of `app_runtime`, which is the identity the application deploys with. Every probe
ran inside a transaction that was rolled back; nothing was committed.

**2.1 — `app_runtime` write privileges across `iam` before this change:**

```sql
SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
 WHERE grantee = 'app_runtime' AND table_schema = 'iam'
 GROUP BY 1 ORDER BY 1;
-- approval_limits             SELECT
-- audit_integrity_links       INSERT,SELECT     <- DBCR-P1-13-001
-- audit_record_details        INSERT,SELECT     <- DBCR-P1-13-001
-- audit_records               INSERT,SELECT     <- DBCR-P1-13-001
-- grant_scopes                SELECT
-- login_audit                 SELECT
-- permissions                 SELECT
-- role_grants                 SELECT
-- role_permissions            SELECT
-- roles                       SELECT
-- security_events             INSERT,SELECT     <- DBCR-P1-13-001
-- sensitive_data_permissions  SELECT
-- user_accounts               SELECT
-- user_employee_links         SELECT
-- user_profiles               SELECT
-- user_sessions               SELECT
-- user_status_history         SELECT
```

**2.2 — policy coverage by command, before this change:**

```text
iam.approval_limits         SELECT(1)
iam.grant_scopes            SELECT(1)
iam.login_audit             SELECT(2)
iam.role_grants             SELECT(1)
iam.role_permissions        SELECT(1)
iam.roles                   SELECT(1)
iam.user_accounts           SELECT(1)
iam.user_sessions           SELECT(2)
iam.user_status_history     SELECT(1)
org.tenants                 SELECT(1)
-- no INSERT, UPDATE or DELETE policy exists on any of the above
-- all 17 iam tables: relrowsecurity = true AND relforcerowsecurity = true
```

**2.3 — the writes themselves, attempted as `rootlco_test_runtime`.** Twenty-two of
twenty-four probes failed with SQLSTATE **42501** (`insufficient_privilege`):

```text
BLOCKED 42501  INSERT iam.user_accounts          (invite)
BLOCKED 42501  UPDATE iam.user_accounts          (activate / lock / deactivate)
BLOCKED 42501  DELETE iam.user_accounts
BLOCKED 42501  INSERT iam.user_status_history
BLOCKED 42501  EXECUTE iam.change_user_status(...)
BLOCKED 42501  INSERT iam.user_sessions          (issue)
BLOCKED 42501  UPDATE iam.user_sessions          (revoke)
BLOCKED 42501  UPDATE iam.user_sessions          (idle touch last_seen_at)
BLOCKED 42501  INSERT iam.login_audit            (failed-login tracking)
BLOCKED 42501  INSERT iam.roles
BLOCKED 42501  UPDATE iam.roles
BLOCKED 42501  DELETE iam.roles
BLOCKED 42501  INSERT iam.role_permissions
BLOCKED 42501  DELETE iam.role_permissions
BLOCKED 42501  INSERT iam.role_grants
BLOCKED 42501  UPDATE iam.role_grants            (revoke)
BLOCKED 42501  INSERT iam.grant_scopes
BLOCKED 42501  DELETE iam.grant_scopes
BLOCKED 42501  INSERT iam.approval_limits
BLOCKED 42501  UPDATE iam.approval_limits
BLOCKED 42501  UPDATE org.tenants
BLOCKED 42501  UPDATE org.company_settings / org.branch_settings   (see §1 note — not a defect)
ALLOWED        SELECT iam.audit_records          (audit viewing already works)
ALLOWED        iam.audit_append(...)             (DBCR-P1-13-001 capability, intact)
```

**2.4 — what already works and needs nothing.** Recorded so the remediation stays minimum:
session validation and scope resolution (SELECT on `iam.user_accounts`, `iam.role_grants`,
`iam.grant_scopes`), permission evaluation (`iam.has_permission`), audit viewing
(`sel_audit_records_permitted`, gated on `iam.audit.view`), read-only administration
(user, role, grant, scope and approval-limit listings), and company/branch settings
versioning. None of those is touched by this change request.

## 3. Root cause

Not a schema defect and not an oversight in P1-04. The identity schema was designed for
exactly this surface: the tables, columns, constraints, lifecycle function, immutability
triggers, permission catalogue and permission-gated SELECT policies all exist and are
complete. `docs/phase-1/phase-1-4/identity-authorization-schema-design.md` states the boundary
explicitly — _"Runtime holds SELECT only; all writes are platform / Phase-1-14 operations"_ —
and lists login, session issuance and IdP integration as deferred, _"not hidden"_.

The gap is the deliberate consequence of that boundary: P1-04 stored and access-controlled the
shapes without claiming the runtime controls existed, and P1-14 is the phase that was always
going to have to request the write capability. This change request is that request.

## 4. Blocking classification

**BLOCKING for P1-14 Waves 3 through 8.** Without it:

- Wave 3 (login, logout, password reset) cannot persist a session or a login-audit row.
- Wave 4 (invitations and activation) cannot create or activate an application user.
- Wave 5 (failed-login, lock, idle timeout, revocation) has no writable counter, no writable
  lock transition and no writable session row.
- Wave 6 (role and permission administration) cannot write any of its four tables.
- Wave 7 (scope and approval-limit administration) cannot write either of its two.
- Wave 8 (user and organization administration) cannot change a user status or a tenant
  setting.

**Not blocking** for Wave 1 (provider adapter), Wave 2 (session validation and request
authentication), Wave 9 (audit viewing) or the read-only half of Wave 8. Those compose
capabilities that already exist and were confirmed working in §2.4.

The P1-14 owner gate stays **Pending** until this change request is RESOLVED against protected
`develop`.

## 5. Approved remediation

Additive grants and policies only. **No table, column, constraint, index, sequence, trigger or
function is created, altered or dropped**, and no existing function body is modified — so the
Release 2 structural baseline is unchanged and every earlier migration stays immutable.

**5.1 Privileges.** Table-level INSERT; **column-scoped UPDATE** wherever the frozen schema
does not already immobilise the sensitive columns, and belt-and-braces where it does. DELETE on
exactly two tables — `iam.role_permissions` and `iam.grant_scopes` — because withdrawing a
mapping or a scope is a genuine removal with no soft-delete column. Identity, roles, grants,
sessions, approval limits, login audit and status history are never destroyed from the request
path; they carry `deleted_at`, `status`, `revoked_at` or `effective_to` instead.

**5.2 Policies.** Nineteen, every one anchored on `tenant_id = iam.current_tenant_id()` and
gated on a permission that already exists in the frozen catalogue — `iam.user.manage`,
`iam.role.manage`, `iam.grant.manage`, `iam.approval.manage`, `org.settings.manage`. No
`USING (true)`, no `WITH CHECK (true)`. Session creation and login-audit writes are self-scoped
(`user_id = iam.current_user_id()`) rather than permission-gated, because requiring a
permission there would break login for ordinary users and would let whoever held it forge a
session for somebody else.

**5.3 Two escalation controls carried by the policies themselves.** These do more than scope a
row to a tenant; they put the delegation rule in the database, so a service-layer defect cannot
bypass it:

- `ins_role_permissions_delegable` / `upd_role_permissions_delegable` — an `allow` mapping may
  only be written by an administrator who **already holds that permission**. `deny` is
  unconditional, because a deny is de-escalation and a deny that could not be recorded would be
  a safety regression.
- `ins_role_grants_delegable` — a grant may only be issued when the issuer already holds
  **every** allow-permission the role confers.

Together: an administrator cannot mint authority they do not possess, directly or through a
role, for themselves or for anyone else.

**5.3a Two further controls, found by attacking the first draft.** Both were added before this
change request was submitted, and both have regression tests:

- **Revocation is terminal.** The first draft's session UPDATE policies would have allowed
  `revoked_at` to be set back to `NULL` — by an administrator, or by the session's own owner —
  resurrecting a revoked session. Both policies now carry `revoked_at IS NULL` in `USING`, so a
  revoked row is invisible to any further update. `WITH CHECK` deliberately does not repeat the
  test, because the revoking update is precisely the one that must be allowed to set it. Every
  legitimate update — idle touch, expiry, logout, forced revocation — targets a live session,
  so nothing is lost. This is the database-layer half of "locked and deactivated users cannot
  continue using an already-issued session".
- **The login-audit administrative arm is restricted to `lockout`.** The first draft let anyone
  holding `iam.user.manage` write any `event_type` against any principal — which would have
  allowed fabricating another user's `success`/`failure`/`logout` history in the very table
  that evidences authentication. An administrator now has exactly the one capability the design
  intended: recording that they locked an account. Automatic lockout after failed attempts is
  written by the failing principal itself and is already covered by the self arm.

**5.4 What the remediation deliberately does not do.** No role is created; no role attribute
changes; no ownership moves; no schema USAGE is granted; `app_readonly` and `app_worker` gain
nothing; the permission catalogue (`iam.permissions`) stays read-only, so a tenant
administrator may map permission codes but never invent them;
`iam.sensitive_data_permissions`, `iam.user_profiles` and `iam.user_employee_links` are
untouched because they are outside the P1-14 administration scope; `org.tenants` gains UPDATE
only, never INSERT or DELETE.

**5.5 Bootstrap boundary — deliberate, documented, not a defect.** No policy here can create
the **first** administrator of a tenant: with no user accounts, nobody holds `iam.user.manage`,
so `ins_user_accounts_admin` matches nothing. Tenant provisioning stays an owner/operator
capability (ADR-008, `scripts/db/provision-organization.mjs`) and is intentionally not a
request-path capability. P1-14 must not work around this by weakening the policy.

## 6. Verification

`tests/db/p1-14-runtime-administration-capabilities.test.ts` — **60 tests, all passing**.
Every "it works" assertion runs on `rootlco_test_runtime`; the admin connection provisions
fixtures and reads back only, and is never evidence about runtime behaviour.

| Group                               | Tests | What it proves                                                                                                                                |
| ----------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Capabilities now work               | 11    | Each of the ten blocked capabilities in §1 succeeds for a permitted administrator, and revocation is terminal                                 |
| Every capability is gated           | 11    | Refused without the gating permission, with no context, and for a locked principal; the administrative login-audit arm accepts only `lockout` |
| No capability crosses a tenant      | 4     | Tenant B's fully-permitted administrator cannot insert into, update, or scope anything in tenant A                                            |
| The delegation rule                 | 6     | Cannot map an unheld allow-permission, cannot self-escalate, cannot flip a deny to allow, cannot grant an over-broad role                     |
| System roles                        | 4     | A system role cannot be updated, re-mapped, unmapped, or created from the request path                                                        |
| Withheld capabilities stay withheld | 16    | No DELETE on identity/roles/grants/sessions/audit/history; catalogue not writable; identity and amounts not re-pointable                      |
| Other archetypes gained nothing     | 3     | `app_readonly` and `app_worker` refused; all three archetypes still NOLOGIN, non-superuser, NOBYPASSRLS, owning nothing                       |
| Only grants and policies changed    | 5     | Zero SECURITY DEFINER; every `iam` table still FORCE RLS; no new schema USAGE; no unconditional write policy                                  |

Two denial shapes are asserted deliberately. An INSERT refused by a policy or a missing
privilege raises 42501; an UPDATE or DELETE refused by a policy's `USING` clause matches **no
rows and raises nothing**, so those assert `rowCount === 0`. Expecting an error there would
have passed silently against a policy that did not exist at all.

**Verified negative result during design.** The two delegation policies call
`iam.has_permission`, which itself reads `iam.role_permissions` and `iam.role_grants` — the
same tables the policies are attached to. PostgreSQL policy recursion was the principal
technical risk in this design. It was tested rather than assumed: the INSERT/UPDATE policies
and the SELECT policies are distinct, the inner read resolves under
`sel_role_permissions_tenant` and terminates, and no recursion error occurs. All six
delegation tests pass.

## 7. Rollback

ROLLBACK-SAFE. Grants and policies only; no data is written, moved or destroyed. The exact
inverse is given at the end of the migration file. Recorded in
[`phase-1-14-migration-classification.md`](../../phase-1/phase-1-14/phase-1-14-migration-classification.md).

## 8. Governance

Raised, implemented and self-reviewed under the Standing Technical Authorization and Solo
Developer Review policies. This is owner-authorized technical self-review and must never be
described as an independent third-party audit.

The remediation is delivered as a **separate pull request**, not folded into the P1-14 feature
branch — the same governance path taken for DBCR-P1-13-001 (PR #51). The P1-14 feature work
begins only after this change request is merged into protected `develop` by the owner.

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The
work was reviewed under the Standing Technical Authorization and Solo Developer Review
policies.
