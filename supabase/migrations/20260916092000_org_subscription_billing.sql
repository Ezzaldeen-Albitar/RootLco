-- ============================================================================
-- P1-32-PRE-024 — Owner-recorded subscription charges and receipts.
-- Owner module: org
--
-- Rollback classification: ROLL-FORWARD-ONLY. Both tables are financial
--   evidence of what the Platform Owner charged an organisation and what that
--   organisation paid. Receipts are append-only by construction. No down
--   script: dropping either table destroys the only record there is.
--
-- WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT
--   This is PLATFORM revenue: the subscription fee the Platform Owner invoices
--   an organisation for using the product. It is not, and must never be
--   conflated with, TENANT revenue — the money a workshop takes from its own
--   customers, which lives in sal.invoices / sal.payments under app_runtime and
--   is none of the Platform Owner's business.
--
--   The separation is enforced, not described:
--     * these tables live in `org`, beside the tenant and its subscription,
--       never in `sal`;
--     * app_runtime receives NO grant of any kind on either of them, so no
--       tenant-facing route can read or write them even by accident;
--     * app_platform receives no grant on sal.* and gains none here.
--
--   It is also not an accounting system. There is no ledger, no tax treatment,
--   no dunning, no payment gateway and no automatic charge generation. An
--   operator RECORDS a charge that was agreed and RECORDS a receipt that
--   arrived. Every row is an act somebody performed and can be asked about.
--
-- Money
--   numeric(18,4), exact, never float. `pg` returns numeric as a string and the
--   application keeps it a string from the driver to the wire. Outstanding
--   balances are computed in SQL numeric, never in JavaScript.
--
-- Settlement is a TRIGGER, not application logic
--   A charge becomes `settled` when the receipts against it reach its amount.
--   Putting that in the service would mean two writers (the receipt operation
--   and any future one) could disagree about when a charge is paid. The
--   database is the single writer of that fact.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. org.subscription_charges
-- ----------------------------------------------------------------------------
CREATE TABLE org.subscription_charges (
  id              uuid           NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid           NOT NULL,
  subscription_id uuid           NULL,
  amount          numeric(18, 4) NOT NULL,
  currency_code   text           NOT NULL,
  due_on          date           NOT NULL,
  description     text           NOT NULL,
  status          text           NOT NULL DEFAULT 'open',
  void_reason     text           NULL,
  record_version  integer        NOT NULL DEFAULT 1,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  created_by      uuid           NOT NULL,
  updated_at      timestamptz    NULL,
  updated_by      uuid           NULL,

  CONSTRAINT pk_subscription_charges PRIMARY KEY (id),
  CONSTRAINT fk_subscription_charges_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_charges_subscription
    FOREIGN KEY (subscription_id) REFERENCES org.tenant_subscriptions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_charges_currency
    FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_subscription_charges_amount_positive CHECK (amount > 0),
  CONSTRAINT ck_subscription_charges_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_subscription_charges_status CHECK (status IN ('open', 'settled', 'void')),
  -- A void charge carries its justification or it is not a void charge; a live
  -- one carries none. Both directions, so neither can drift.
  CONSTRAINT ck_subscription_charges_void_reason
    CHECK ((status = 'void') = (void_reason IS NOT NULL AND btrim(void_reason) <> ''))
);

COMMENT ON TABLE org.subscription_charges IS
  'PLATFORM revenue: a subscription fee the Platform Owner recorded against an organisation (P1-32-PRE-024). Tenant-owned by tenant_id with RLS forced, but NOT tenant-facing — app_runtime holds no grant here, because this is money the tenant owes the Platform Owner rather than money its own customers owe it. Never conflate with sal.invoices. No ledger, no tax treatment, no gateway: an operator records an agreed charge.';
COMMENT ON COLUMN org.subscription_charges.status IS
  'open | settled | void. `settled` is written ONLY by tg_subscription_charges_settle when the receipts reach the amount; `void` only by the void operation, which must supply a reason.';
COMMENT ON COLUMN org.subscription_charges.subscription_id IS
  'The assignment the charge is for, when it is for one. Nullable: a one-off charge (a migration fee, a correction) belongs to the organisation rather than to a period.';

CREATE INDEX ix_subscription_charges_tenant_id_created_at
  ON org.subscription_charges (tenant_id, created_at DESC, id DESC);
CREATE INDEX ix_subscription_charges_status_currency
  ON org.subscription_charges (status, currency_code);
-- Leading-column indexes for the two foreign keys the indexes above do not
-- lead with (P1-03-DB-017).
CREATE INDEX ix_subscription_charges_subscription_id
  ON org.subscription_charges (subscription_id);
CREATE INDEX ix_subscription_charges_currency_code
  ON org.subscription_charges (currency_code);

CREATE TRIGGER tg_subscription_charges_touch_metadata
  BEFORE UPDATE ON org.subscription_charges
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_subscription_charges_immutable
  BEFORE UPDATE ON org.subscription_charges
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'subscription_id', 'amount', 'currency_code', 'due_on'
  );

-- ----------------------------------------------------------------------------
-- 2. org.subscription_receipts — append-only.
-- ----------------------------------------------------------------------------
CREATE TABLE org.subscription_receipts (
  id            uuid           NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid           NOT NULL,
  charge_id     uuid           NOT NULL,
  amount        numeric(18, 4) NOT NULL,
  currency_code text           NOT NULL,
  received_on   date           NOT NULL,
  reference     text           NULL,
  method        text           NOT NULL,
  notes         text           NULL,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  created_by    uuid           NOT NULL,

  CONSTRAINT pk_subscription_receipts PRIMARY KEY (id),
  CONSTRAINT fk_subscription_receipts_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_receipts_charge
    FOREIGN KEY (charge_id) REFERENCES org.subscription_charges (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_receipts_currency
    FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_subscription_receipts_amount_positive CHECK (amount > 0),
  CONSTRAINT ck_subscription_receipts_method_not_blank CHECK (btrim(method) <> ''),
  CONSTRAINT ck_subscription_receipts_reference_not_blank
    CHECK (reference IS NULL OR btrim(reference) <> '')
);

COMMENT ON TABLE org.subscription_receipts IS
  'Money the Platform Owner received against an org.subscription_charges row (P1-32-PRE-024). APPEND-ONLY: no role holds UPDATE or DELETE, and a correction is a further charge rather than an edit. app_runtime holds no grant — a tenant does not read the Platform Owner''s receipt book. Currency must equal the charge''s, enforced by trigger rather than by a foreign key because the rule compares two tables.';
COMMENT ON COLUMN org.subscription_receipts.method IS
  'How the money arrived, in the operator''s own words. Free text on purpose: settlement between the Platform Owner and an organisation is a commercial arrangement, not a payment-gateway vocabulary, and a closed list here would be invented rather than derived.';

CREATE INDEX ix_subscription_receipts_charge_id
  ON org.subscription_receipts (charge_id);
CREATE INDEX ix_subscription_receipts_currency_code
  ON org.subscription_receipts (currency_code);
CREATE INDEX ix_subscription_receipts_tenant_id_created_at
  ON org.subscription_receipts (tenant_id, created_at DESC, id DESC);

-- ----------------------------------------------------------------------------
-- 3. The receipt guard: coherence with the charge it is against.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.guard_subscription_receipt_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_charge RECORD;
BEGIN
  SELECT c.tenant_id, c.currency_code, c.status
    INTO v_charge
    FROM org.subscription_charges c
   WHERE c.id = NEW.charge_id;

  -- A row the caller cannot SELECT is a row it cannot receipt. Failing closed
  -- here matters: without the IF NOT FOUND branch a policy that hides the
  -- charge would leave v_charge NULL and every comparison below would be NULL,
  -- so the guard would silently admit the receipt.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription receipt references a charge that is not readable in this context'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM v_charge.tenant_id THEN
    RAISE EXCEPTION 'subscription receipt tenant does not match the charge tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.currency_code IS DISTINCT FROM v_charge.currency_code THEN
    RAISE EXCEPTION 'subscription receipt currency % does not match the charge currency %',
      NEW.currency_code, v_charge.currency_code
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_charge.status = 'void' THEN
    RAISE EXCEPTION 'a void subscription charge cannot be receipted'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_subscription_receipt_coherence() IS
  'BEFORE INSERT on org.subscription_receipts: the receipt belongs to the charge''s tenant, is denominated in the charge''s currency, and is not being recorded against a voided charge. Fails closed when the charge is unreadable.';

REVOKE EXECUTE ON FUNCTION org.guard_subscription_receipt_coherence() FROM PUBLIC;

CREATE TRIGGER tg_subscription_receipts_coherence
  BEFORE INSERT ON org.subscription_receipts
  FOR EACH ROW EXECUTE FUNCTION org.guard_subscription_receipt_coherence();

-- ----------------------------------------------------------------------------
-- 4. Settlement: the database decides when a charge is paid.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.settle_subscription_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_received numeric(18, 4);
BEGIN
  SELECT COALESCE(sum(r.amount), 0)
    INTO v_received
    FROM org.subscription_receipts r
   WHERE r.charge_id = NEW.charge_id;

  -- Exactly once: the predicate names the CURRENT status, so a second receipt
  -- against an already-settled charge updates nothing and the record_version
  -- does not drift.
  UPDATE org.subscription_charges c
     SET status = 'settled'
   WHERE c.id = NEW.charge_id
     AND c.status = 'open'
     AND v_received >= c.amount;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION org.settle_subscription_charge() IS
  'AFTER INSERT on org.subscription_receipts: marks the charge settled once the receipts recorded against it reach its amount. The sum is computed in SQL numeric — never in the application — and the UPDATE is guarded on status = ''open'' so it fires at most once per charge.';

REVOKE EXECUTE ON FUNCTION org.settle_subscription_charge() FROM PUBLIC;

CREATE TRIGGER tg_subscription_receipts_settle
  AFTER INSERT ON org.subscription_receipts
  FOR EACH ROW EXECUTE FUNCTION org.settle_subscription_charge();

-- ----------------------------------------------------------------------------
-- 5. The charge status graph.
--
--    Two legal transitions and no others: open -> settled (written only by the
--    settlement trigger above) and open -> void (written only by the void
--    operation, which the CHECK constraint forces to supply a reason). A
--    settled charge is terminal, and a void charge is terminal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.guard_subscription_charge_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'subscription charge is % and cannot change status', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('settled', 'void') THEN
      RAISE EXCEPTION 'subscription charge cannot move from open to %', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_subscription_charge_status() IS
  'BEFORE UPDATE on org.subscription_charges: open -> settled and open -> void are the only transitions. Settled and void are terminal, so a paid charge cannot be voided afterwards and a voided one cannot be revived.';

REVOKE EXECUTE ON FUNCTION org.guard_subscription_charge_status() FROM PUBLIC;

CREATE TRIGGER tg_subscription_charges_status_graph
  BEFORE UPDATE ON org.subscription_charges
  FOR EACH ROW EXECUTE FUNCTION org.guard_subscription_charge_status();

-- ----------------------------------------------------------------------------
-- 6. RLS. Forced on both, and app_runtime is granted nothing.
-- ----------------------------------------------------------------------------
ALTER TABLE org.subscription_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.subscription_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE org.subscription_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.subscription_receipts FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON org.subscription_charges TO app_platform;
GRANT UPDATE (status, void_reason) ON org.subscription_charges TO app_platform;
GRANT SELECT, INSERT ON org.subscription_receipts TO app_platform;

CREATE POLICY sel_subscription_charges_platform ON org.subscription_charges
  FOR SELECT TO app_platform
  USING (
       iam.has_platform_authority('platform.billing.read')
    OR iam.has_platform_authority('platform.billing.manage')
    OR iam.has_platform_authority('platform.statistics.read')
  );

CREATE POLICY ins_subscription_charges_platform ON org.subscription_charges
  FOR INSERT TO app_platform
  WITH CHECK (
    status = 'open'
    AND iam.has_platform_authority('platform.billing.manage')
  );

CREATE POLICY upd_subscription_charges_platform ON org.subscription_charges
  FOR UPDATE TO app_platform
  USING (iam.has_platform_authority('platform.billing.manage'))
  WITH CHECK (iam.has_platform_authority('platform.billing.manage'));

COMMENT ON POLICY ins_subscription_charges_platform ON org.subscription_charges IS
  'A charge is only ever CREATED open. Settlement and voiding are updates, each with its own guard, so no caller can insert a row that is already paid.';

CREATE POLICY sel_subscription_receipts_platform ON org.subscription_receipts
  FOR SELECT TO app_platform
  USING (
       iam.has_platform_authority('platform.billing.read')
    OR iam.has_platform_authority('platform.billing.manage')
    OR iam.has_platform_authority('platform.statistics.read')
  );

CREATE POLICY ins_subscription_receipts_platform ON org.subscription_receipts
  FOR INSERT TO app_platform
  WITH CHECK (iam.has_platform_authority('platform.billing.manage'));

COMMENT ON POLICY sel_subscription_receipts_platform ON org.subscription_receipts IS
  'The Platform Owner reads its own receipt book. There is deliberately no UPDATE or DELETE policy and no such grant: the table is append-only.';

-- ----------------------------------------------------------------------------
-- 7. shared.idempotency_keys — the three billing writes.
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
CREATE POLICY ins_idempotency_keys_platform_billing ON shared.idempotency_keys
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND operation IN (
      'platform_charge_record',
      'platform_charge_void',
      'platform_receipt_record'
    )
    AND iam.has_platform_authority('platform.billing.manage')
  );

CREATE POLICY sel_idempotency_keys_platform_billing ON shared.idempotency_keys
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND operation IN (
      'platform_charge_record',
      'platform_charge_void',
      'platform_receipt_record'
    )
    AND iam.has_platform_authority('platform.billing.manage')
  );

DO $$
BEGIN
  RAISE NOTICE '[RootLco] Subscription billing applied: 2 tables, 3 functions, 5 triggers, 7 policies.';
END $$;
