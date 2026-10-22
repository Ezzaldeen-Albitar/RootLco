-- ============================================================================
-- P1-32-PRE-023 — subscription commerce: priced plans and an assignment trail.
-- Owner module: org
--
-- Rollback classification: ROLL-FORWARD-ONLY. org.tenant_subscription_events is
--   append-only and becomes the only record of WHY a tenant moved between
--   plans — the subscription rows carry the state, never the reason. Dropping
--   it would destroy evidence. The four columns added to org.subscription_plans
--   are nullable and additive; no down script is offered for either half,
--   because a partial rollback would leave the events table referencing plan
--   versions whose price had been erased.
--
-- Purpose
--   org.subscription_plans has existed since P1-03 as a CAPABILITY document: a
--   plan code, an entitlement map of feature flags, a capacity map, and an
--   effective interval. It carries no price, no term and no display name,
--   and its own table comment says so in as many words ("NO billing, charging,
--   or production pricing exists or is implied"). The Platform Owner Console
--   needs all three to administer a subscription, so they are added here as
--   NULLABLE columns: a plan that predates this migration keeps working, and a
--   priced plan is one an operator has deliberately configured.
--
--   PRICES ARE CONFIGURED, NEVER SEEDED. No seed in this repository writes a
--   plan row and none is added. Every value in these columns arrives through
--   platform.plan-create / platform.plan-update, recorded and audited.
--
--   The second half is the trail. org.tenant_subscriptions records WHAT a
--   tenant holds at an instant — the EXCLUDE constraint guarantees at most one
--   active assignment covers any point in time — but a renewal and a downgrade
--   are indistinguishable afterwards: both are a closed row and a new one. The
--   event table names the act and carries the justification, which is what an
--   operator is actually asked for six months later.
--
-- Money
--   numeric(18,4), never float, and the application layer keeps it a decimal
--   STRING end to end (`pg` returns numeric as text). Scale 4 rather than 2
--   because shared.currencies.minor_unit runs to 4 and a plan price must be
--   expressible in every currency the platform admits.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. org.subscription_plans — the commercial columns.
-- ----------------------------------------------------------------------------
ALTER TABLE org.subscription_plans
  ADD COLUMN list_price    numeric(18, 4) NULL,
  ADD COLUMN currency_code text           NULL,
  ADD COLUMN term_months   integer        NULL,
  ADD COLUMN display_name  text           NULL;

ALTER TABLE org.subscription_plans
  ADD CONSTRAINT ck_subscription_plans_list_price_non_negative
    CHECK (list_price IS NULL OR list_price >= 0),
  ADD CONSTRAINT ck_subscription_plans_term_months_positive
    CHECK (term_months IS NULL OR term_months > 0),
  ADD CONSTRAINT ck_subscription_plans_display_name_not_blank
    CHECK (display_name IS NULL OR btrim(display_name) <> ''),
  -- A price without a currency is not a price. The pair moves together or not
  -- at all; neither half alone is admitted.
  ADD CONSTRAINT ck_subscription_plans_price_has_currency
    CHECK ((list_price IS NULL) = (currency_code IS NULL)),
  ADD CONSTRAINT fk_subscription_plans_currency
    FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT;

-- Every foreign key carries a leading-column index (P1-03-DB-017).
CREATE INDEX ix_subscription_plans_currency_code
  ON org.subscription_plans (currency_code);

COMMENT ON COLUMN org.subscription_plans.list_price IS
  'What the Platform Owner charges for one term of this plan version, exact numeric, never float. NULL on a plan that has not been priced. Configured through platform.plan-create / platform.plan-update; no seed writes it.';
COMMENT ON COLUMN org.subscription_plans.currency_code IS
  'ISO 4217 code the list price is denominated in, from shared.currencies. NULL exactly when list_price is NULL.';
COMMENT ON COLUMN org.subscription_plans.term_months IS
  'Default billing term of this plan version in whole months. A multi-year contract is expressed as 24 or 36 rather than as a separate plan.';
COMMENT ON COLUMN org.subscription_plans.display_name IS
  'Customer-facing name. Distinct from `name`, which is the administrative label the catalogue was created with and which is referenced by existing rows.';

-- ----------------------------------------------------------------------------
-- 2. org.tenant_subscription_events — the append-only assignment trail.
-- ----------------------------------------------------------------------------
CREATE TABLE org.tenant_subscription_events (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  subscription_id uuid        NOT NULL,
  event_kind      text        NOT NULL,
  from_plan_id    uuid        NULL,
  to_plan_id      uuid        NULL,
  effective_from  date        NOT NULL,
  effective_to    date        NULL,
  reason          text        NOT NULL,
  actor_id        uuid        NULL,
  correlation_id  uuid        NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,

  CONSTRAINT pk_tenant_subscription_events PRIMARY KEY (id),
  CONSTRAINT fk_tenant_subscription_events_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_subscription_events_subscription
    FOREIGN KEY (subscription_id) REFERENCES org.tenant_subscriptions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_subscription_events_from_plan
    FOREIGN KEY (from_plan_id) REFERENCES org.subscription_plans (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_subscription_events_to_plan
    FOREIGN KEY (to_plan_id) REFERENCES org.subscription_plans (id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_subscription_events_kind
    CHECK (event_kind IN (
      'assigned', 'renewed', 'upgraded', 'downgraded',
      'cancelled', 'suspended', 'reactivated'
    )),
  CONSTRAINT ck_tenant_subscription_events_reason_not_blank
    CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_tenant_subscription_events_interval
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE org.tenant_subscription_events IS
  'Append-only record of every act performed on a tenant subscription (P1-32-PRE-023). Tenant-owned: tenant_id NOT NULL, RLS forced. org.tenant_subscriptions holds the STATE; this table holds the ACT and its justification, which the state cannot express — a renewal and a downgrade both close one row and open another. No UPDATE and no DELETE privilege is granted to any role: a correction is a further event, never an edit.';
COMMENT ON COLUMN org.tenant_subscription_events.event_kind IS
  'assigned | renewed | upgraded | downgraded | cancelled | suspended | reactivated. The last two are written by the tenant lifecycle transition, not by a subscription operation.';
COMMENT ON COLUMN org.tenant_subscription_events.reason IS
  'The operator''s justification, mandatory and non-blank. Stored verbatim; the audit record carries it as `internal`.';
COMMENT ON COLUMN org.tenant_subscription_events.from_plan_id IS
  'The plan version in force before the act, when there was one. NULL on the first assignment and on a lifecycle event that changes no plan.';

CREATE INDEX ix_tenant_subscription_events_tenant_id_created_at
  ON org.tenant_subscription_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX ix_tenant_subscription_events_subscription_id
  ON org.tenant_subscription_events (subscription_id);
CREATE INDEX ix_tenant_subscription_events_from_plan_id
  ON org.tenant_subscription_events (from_plan_id);
CREATE INDEX ix_tenant_subscription_events_to_plan_id
  ON org.tenant_subscription_events (to_plan_id);

ALTER TABLE org.tenant_subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.tenant_subscription_events FORCE ROW LEVEL SECURITY;

-- The tenant's own administrators read their own history and write nothing.
GRANT SELECT ON org.tenant_subscription_events TO app_runtime;

CREATE POLICY sel_tenant_subscription_events_tenant ON org.tenant_subscription_events
  FOR SELECT TO app_runtime
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_tenant_subscription_events_tenant ON org.tenant_subscription_events IS
  'A tenant reads its own subscription history. Read only: no application role holds INSERT, UPDATE or DELETE here, because a subscription is administered by the Platform Owner and never by its subject.';

GRANT SELECT, INSERT ON org.tenant_subscription_events TO app_platform;

CREATE POLICY sel_tenant_subscription_events_platform ON org.tenant_subscription_events
  FOR SELECT TO app_platform
  USING (
       iam.has_platform_authority('platform.organization.read')
    OR iam.has_platform_authority('platform.subscription.manage')
    -- The lifecycle writer must be able to read back the row it appends:
    -- `INSERT ... RETURNING` is checked against the SELECT policy, so without
    -- this term a lifecycle-only operator's suspension would fail on its own
    -- event. Narrowed to the two kinds that writer produces.
    OR (
      event_kind IN ('suspended', 'reactivated')
      AND iam.has_platform_authority('platform.organization.lifecycle')
    )
  );

CREATE POLICY ins_tenant_subscription_events_platform ON org.tenant_subscription_events
  FOR INSERT TO app_platform
  WITH CHECK (
       iam.has_platform_authority('platform.subscription.manage')
    -- The lifecycle transition writes `suspended` / `reactivated` from the same
    -- operation that moves the tenant, and that operation's authority is the
    -- lifecycle one. Without this term a suspension would write a status row
    -- and no event, so the trail would silently omit exactly the acts an
    -- operator most needs to explain.
    OR (
      event_kind IN ('suspended', 'reactivated')
      AND iam.has_platform_authority('platform.organization.lifecycle')
    )
  );

COMMENT ON POLICY ins_tenant_subscription_events_platform ON org.tenant_subscription_events IS
  'Append by the Platform Owner. Two authorities for two producers: subscription administration writes the plan events, and the tenant lifecycle transition writes suspended/reactivated under its own authority.';

-- ----------------------------------------------------------------------------
-- 3. org.subscription_plans — the write graph for the plan catalogue.
--
--    plan_code is ABSENT from the UPDATE grant. That is the enforceable half of
--    the rule tg_subscription_plans_immutable already states: the trigger
--    raises on a changed plan_code, and withholding the column privilege means
--    the statement is refused before the trigger is reached.
-- ----------------------------------------------------------------------------
GRANT INSERT ON org.subscription_plans TO app_platform;
GRANT UPDATE (
  name, description, entitlement_document, capacity_limits, status,
  effective_from, effective_to, list_price, currency_code, term_months,
  display_name
) ON org.subscription_plans TO app_platform;

CREATE POLICY ins_subscription_plans_platform ON org.subscription_plans
  FOR INSERT TO app_platform
  WITH CHECK (iam.has_platform_authority('platform.subscription.manage'));

CREATE POLICY upd_subscription_plans_platform ON org.subscription_plans
  FOR UPDATE TO app_platform
  USING (iam.has_platform_authority('platform.subscription.manage'))
  WITH CHECK (iam.has_platform_authority('platform.subscription.manage'));

COMMENT ON POLICY upd_subscription_plans_platform ON org.subscription_plans IS
  'Plan administration. Both USING and WITH CHECK are stated: a FOR UPDATE policy with only USING reuses it as the check, which would be a second, implicit rule rather than a written one. plan_code is unreachable — it is not in the column grant.';

-- The plan catalogue has no tenant column and app_runtime already reads the
-- published rows; nothing about that changes here. No grant on shared.currencies
-- is made: a foreign-key check runs with the referenced table owner's rights,
-- and no platform path reads the currency register directly.

-- org.validate_plan_documents() is SECURITY INVOKER and checks every
-- entitlement key against org.feature_flags, so the writing role must be able
-- to READ the flag register or every plan write fails with 42501. Measured: the
-- first plan-create against this graph answered 500 "permission denied for
-- table feature_flags". The policy is gated on the plan authority, and it fails
-- CLOSED in the direction that matters — a caller who could not see the flags
-- would have every entitlement key refused as unregistered, never admitted.
GRANT SELECT ON org.feature_flags TO app_platform;

CREATE POLICY sel_feature_flags_platform ON org.feature_flags
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.subscription.manage'));

-- ----------------------------------------------------------------------------
-- 4. org.tenant_subscriptions — assignment for a tenant in ANY state.
--
--    ins_tenant_subscriptions_platform (Wave B) admits a row only while the
--    parent tenant is `provisioning`, which is correct for the ONE row
--    provisioning writes and useless for every later assignment. This policy
--    sits beside it under the subscription authority with no window term.
--
--    UPDATE is (status, effective_to) and nothing else: tenant_id and plan_id
--    are frozen by tg_tenant_subscriptions_immutable, and effective_from must
--    not move because the EXCLUDE constraint is what makes point-in-time
--    resolution deterministic.
-- ----------------------------------------------------------------------------
GRANT UPDATE (status, effective_to) ON org.tenant_subscriptions TO app_platform;

CREATE POLICY ins_tenant_subscriptions_platform_admin ON org.tenant_subscriptions
  FOR INSERT TO app_platform
  WITH CHECK (iam.has_platform_authority('platform.subscription.manage'));

CREATE POLICY upd_tenant_subscriptions_platform_admin ON org.tenant_subscriptions
  FOR UPDATE TO app_platform
  USING (iam.has_platform_authority('platform.subscription.manage'))
  WITH CHECK (iam.has_platform_authority('platform.subscription.manage'));

COMMENT ON POLICY ins_tenant_subscriptions_platform_admin ON org.tenant_subscriptions IS
  'Subscription assignment outside the bootstrap window. Beside ins_tenant_subscriptions_platform, which admits the single row org.provision_organization writes while the tenant is provisioning.';

-- ----------------------------------------------------------------------------
-- 5. shared.idempotency_keys — the four subscription writes.
--
--    Measured on Wave B and restated here because it is the trap: the HTTP
--    idempotency layer stores its replay record in shared.idempotency_keys with
--    tenant_id = the operator's HOME tenant and operation = the operation id
--    with its dots and hyphens folded to underscores. The only app_platform
--    policies on that table (ins/sel_idempotency_keys_platform) name exactly
--    ONE operation, `platform_organization_provision`. Every other idempotent
--    control-plane operation is refused by RLS before its handler runs and
--    answers ERR-INT-002 on every call, while every structural gate stays green.
--    So each new idempotent operation is named here, beside the authority that
--    may invoke it, and nothing broader is admitted: the home-tenant row term
--    stays, and no operation name is matched by pattern.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_idempotency_keys_platform_subscription ON shared.idempotency_keys
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND operation IN (
      'platform_plan_create',
      'platform_plan_update',
      'platform_subscription_assign',
      'platform_subscription_cancel'
    )
    AND iam.has_platform_authority('platform.subscription.manage')
  );

CREATE POLICY sel_idempotency_keys_platform_subscription ON shared.idempotency_keys
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND operation IN (
      'platform_plan_create',
      'platform_plan_update',
      'platform_subscription_assign',
      'platform_subscription_cancel'
    )
    AND iam.has_platform_authority('platform.subscription.manage')
  );

DO $$
BEGIN
  RAISE NOTICE '[RootLco] Subscription commerce applied: 1 table, 4 plan columns, 9 policies.';
END $$;
