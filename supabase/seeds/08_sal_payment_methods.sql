-- ============================================================================
-- Seed 08 — Sales payment methods (P1-11)
--
-- PLATFORM-scope, tenant-neutral structural reference: a receipt is meaningless
-- without a payment method, so the platform ships the three allowed methods
-- (ASM-14 / CON-04: cash, card terminal, bank transfer). NO online payment
-- gateway/settlement method. Tenants may add their own tenant-scope methods on
-- top. This is structural reference (like inv.units_of_measure), NOT business
-- data — no invoice, receipt, amount, or customer data is seeded here.
--
-- Idempotent and additive. Platform rows only (scope = 'platform', tenant NULL),
-- stamped with the reserved platform-system actor.
-- ============================================================================

INSERT INTO sal.payment_methods (scope, tenant_id, method_code, kind, display_name, created_by) VALUES
  ('platform', NULL, 'cash',          'cash',          'Cash',          '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'card_terminal', 'card_terminal', 'Card terminal', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'bank_transfer', 'bank_transfer', 'Bank transfer', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (method_code) WHERE scope = 'platform' AND deleted_at IS NULL DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] sal payment methods applied (idempotent): % platform methods',
    (SELECT count(*) FROM sal.payment_methods WHERE scope = 'platform');
END $$;
