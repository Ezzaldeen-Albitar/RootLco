-- ============================================================================
-- Seed 07 — Inventory units of measure (P1-10)
--
-- PLATFORM-scope, tenant-neutral structural reference: a stock quantity or
-- movement is meaningless without a unit, so the platform ships a base set of
-- generic units. Tenants may add their own tenant-scope units on top. This is
-- structural reference (like shared.currencies), NOT business data — no service,
-- price, item, quantity, or customer data is seeded here.
--
-- Idempotent and additive. Platform rows only (scope = 'platform', tenant NULL),
-- stamped with the reserved platform-system actor.
-- ============================================================================

INSERT INTO inv.units_of_measure (scope, tenant_id, code, name, dimension, created_by) VALUES
  ('platform', NULL, 'each',         'Each',          'count',  '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'piece',        'Piece',         'count',  '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'set',          'Set',           'count',  '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'pair',         'Pair',          'count',  '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'hour',         'Hour',          'time',   '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'litre',        'Litre',         'volume', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'millilitre',   'Millilitre',    'volume', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'kilogram',     'Kilogram',      'mass',   '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'gram',         'Gram',          'mass',   '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'metre',        'Metre',         'length', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'centimetre',   'Centimetre',    'length', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'square_metre', 'Square metre',  'area',   '00000000-0000-4000-8000-000000000001')
ON CONFLICT (code) WHERE scope = 'platform' AND deleted_at IS NULL DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] inv units of measure applied (idempotent): % platform units',
    (SELECT count(*) FROM inv.units_of_measure WHERE scope = 'platform');
END $$;
