-- ============================================================================
-- P1-30 corrective slice — the two privileges tenant provisioning needs to give
-- a new organisation its own recordable payment methods.
--
-- Rollback classification: NON-DESTRUCTIVE. Two policies, one schema USAGE grant
-- and one table GRANT; no object is created or destroyed and no row is touched.
-- Revoking the four returns app_platform to what 20260902130000 left it.
--
-- ## The defect this closes
--
-- `fk_receipts_method` is (tenant_id, payment_method_id) -> sal.payment_methods
-- (tenant_id, id). A PLATFORM row's tenant_id is NULL and both referencing
-- columns on sal.receipts are NOT NULL, so a platform method can never be cited
-- by a receipt — the schema says so and sal.payment_methods' own domain rule
-- (assertPaymentMethodIsTenantScoped) says so in words: "the tenant must be
-- provisioned with its own method row". Nothing did. Measured on the local
-- stack at develop 029fc20d: six tenants provisioned through the shipped
-- control-plane operation, ZERO tenant-scope payment methods, and a direct
-- INSERT of a receipt citing the platform `cash` row refused with
--   fk_receipts_method ... Key (tenant_id, payment_method_id)=(985028aa-…,
--   3a30e300-…) is not present in table "payment_methods".
-- Every one of those organisations can read the payments experience and record
-- nothing. That is a missed realisation of the P1-11 seed obligation
-- (ASM-14 / CON-04: cash, card terminal, bank transfer), not new product scope.
--
-- ## Why the fix is a privilege and not a schema change
--
-- The integrity is correct and is NOT weakened here: the composite foreign key
-- stands, a platform row still cannot be cited, and no receipt may reach across
-- a tenant boundary. What was missing is that no writer ever created the tenant's
-- own copies. The organisation-provisioning transaction is the only place that
-- can: it already opens the §6.3 platform-on-target window (withPlatformTarget)
-- in which `app.tenant_id` IS the tenant the same transaction just created, and
-- every §6.3 policy binds the written row to iam.current_tenant_id().
-- `app_platform` simply held no privilege on the `sal` schema at all —
-- has_schema_privilege('app_platform','sal','USAGE') was false — so the write
-- was impossible rather than merely unwritten.
--
-- ## The two policies, and how narrow each is
--
-- Both were built on the live server BEFORE being written here, and the five
-- containment negatives below were each observed refusing:
--
--   N1  app_platform cannot SEE a tenant's methods — not even the rows it has
--       just written (count 0 immediately after INSERT 0 3). The SELECT policy
--       admits PLATFORM rows only, which is the tenant-neutral catalogue this
--       bootstrap copies from and nothing else. No RETURNING is therefore
--       possible, exactly as for the First-Owner bootstrap (20260831093000).
--   N2  an INSERT for a tenant that is not `provisioning` is refused.
--   N3  a `platform`-scope row is refused: the control plane may not extend the
--       canonical catalogue, only copy from it.
--   N4  an INSERT naming a DIFFERENT provisioning tenant than the session's is
--       refused — the row term is load-bearing for exactly the reason
--       20260831093000 states, since the other two terms are row-independent.
--   N5  an actor without `platform.organization.provision` is refused.
--
-- `kind IN (…)` restates ck_payment_methods_kind inside the policy on purpose:
-- the check constraint is what the table admits, and this is what the CONTROL
-- PLANE may write. A future tenant-facing method administration surface would
-- run as app_runtime under ins_payment_methods_tenant, which is untouched here.
--
-- Nothing widens app_runtime. app_platform gains no UPDATE and no DELETE, so it
-- cannot alter or withdraw a method after the window closes, and it still holds
-- nothing else anywhere in `sal`.
-- ============================================================================

GRANT USAGE ON SCHEMA sal TO app_platform;
GRANT SELECT, INSERT ON sal.payment_methods TO app_platform;

CREATE POLICY sel_payment_methods_platform_canonical ON sal.payment_methods
  FOR SELECT TO app_platform
  USING (
    scope = 'platform'
    AND deleted_at IS NULL
    AND iam.has_platform_authority('platform.organization.provision')
  );

COMMENT ON POLICY sel_payment_methods_platform_canonical ON sal.payment_methods IS
  'P1-30 corrective slice: the PLATFORM catalogue read tenant provisioning copies from, admitted only to a platform login holding platform.organization.provision. Deliberately platform-scope only — app_platform can read no tenant''s methods, including the rows it writes, so the bootstrap asserts on the affected-row count rather than reading back.';

CREATE POLICY ins_payment_methods_platform_bootstrap ON sal.payment_methods
  FOR INSERT TO app_platform
  WITH CHECK (
    scope = 'tenant'
    AND tenant_id = iam.current_tenant_id()
    AND EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
    AND status = 'active'
    AND deleted_at IS NULL
    AND kind IN ('cash', 'card_terminal', 'bank_transfer')
  );

COMMENT ON POLICY ins_payment_methods_platform_bootstrap ON sal.payment_methods IS
  'P1-30 corrective slice: the tenant-local canonical payment methods (ASM-14 cash/card_terminal/bank_transfer) written inside the §6.3 provisioning window. Five terms, each observed refusing on the live server: tenant scope, the row''s tenant matching the session''s, that tenant still provisioning, the acting operator holding platform.organization.provision, and the canonical active vocabulary. No UPDATE or DELETE is granted, so the control plane cannot alter or withdraw a method afterwards.';

-- Rollback: DROP POLICY ins_payment_methods_platform_bootstrap ON sal.payment_methods;
--           DROP POLICY sel_payment_methods_platform_canonical ON sal.payment_methods;
--           REVOKE SELECT, INSERT ON sal.payment_methods FROM app_platform;
--           REVOKE USAGE ON SCHEMA sal FROM app_platform;
