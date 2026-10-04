-- ============================================================================
-- P1-32-PRE-OD-REF — the control plane may READ the three reference registers.
-- Owner module: shared (privileges and policies only)
--
-- Rollback classification: ROLLBACK-SAFE. Three grants and three policies.
--   No object is created or destroyed and no row is touched, so revoking the
--   three privileges and dropping the three policies returns app_platform to
--   exactly the reach it had before. The exact inverse is given at the foot of
--   this file.
--
-- Purpose
--   The Platform Owner Console provisions an organisation and grows one that is
--   already running: it writes a tenant's default language and time zone, a
--   company's base currency and a branch's time zone. Every one of those columns
--   is a foreign key into shared.languages, shared.timezones or
--   shared.currencies, yet app_platform could not read any of the three. The
--   console therefore offered free-text boxes, and an operator learned that a
--   code was unknown only after the database refused it.
--
--   With this grant the new read operation platform.reference-values-read lists
--   the ACTIVE rows of the three registers to the console, which offers them as
--   selects. The registers hold no tenant data and are already readable by
--   app_runtime and app_readonly through sel_*_all; the policies below say the
--   same thing for app_platform, which is why their predicate is `true`.
--
-- THIS REVERSES A RECORDED DECISION
--   20260916091000_org_subscription_commerce.sql (the comment beneath
--   upd_subscription_plans_platform) records that no grant on shared.currencies
--   was made because "no platform path reads the currency register directly".
--   That was true then and is no longer true: the console now reads all three
--   registers to offer them as choices. The reason the foreign-key checks
--   worked without the grant — an RI check runs with the referenced table
--   owner's rights — is unchanged; this migration does not depend on it.
--
-- What is NOT granted
--   No INSERT, UPDATE or DELETE on any of the three tables, for app_platform or
--   any other application role. Reference rows remain maintained by the
--   declared seed supabase/seeds/01_reference_data.sql and by the migration
--   role only. No row is added here.
--
-- Precedent: 20260916096000_platform_organization_growth.sql grants
--   app_platform SELECT on shared.number_sequences beside a dedicated
--   sel_number_sequences_platform_manage policy, with the inverse at its foot.
-- ============================================================================

GRANT SELECT ON shared.currencies TO app_platform;
GRANT SELECT ON shared.timezones  TO app_platform;
GRANT SELECT ON shared.languages  TO app_platform;

CREATE POLICY sel_currencies_platform ON shared.currencies
  FOR SELECT TO app_platform
  USING (true);

CREATE POLICY sel_timezones_platform ON shared.timezones
  FOR SELECT TO app_platform
  USING (true);

CREATE POLICY sel_languages_platform ON shared.languages
  FOR SELECT TO app_platform
  USING (true);

COMMENT ON POLICY sel_currencies_platform ON shared.currencies IS
  'The control plane reads the currency register to offer a company base currency as a choice (platform.reference-values-read). Reference data, not tenant-pivoted, exactly as sel_currencies_all. SELECT only — no write grant and no write policy exists for app_platform.';

COMMENT ON POLICY sel_timezones_platform ON shared.timezones IS
  'The control plane reads the time-zone register to offer a tenant and branch time zone as a choice (platform.reference-values-read). Reference data, not tenant-pivoted, exactly as sel_timezones_all. SELECT only — no write grant and no write policy exists for app_platform.';

COMMENT ON POLICY sel_languages_platform ON shared.languages IS
  'The control plane reads the language register to offer a tenant default language as a choice (platform.reference-values-read). Reference data, not tenant-pivoted, exactly as sel_languages_all. SELECT only — no write grant and no write policy exists for app_platform.';

-- ----------------------------------------------------------------------------
-- Exact inverse (ROLLBACK-SAFE — nothing here writes data)
--
--   DROP POLICY sel_languages_platform ON shared.languages;
--   DROP POLICY sel_timezones_platform ON shared.timezones;
--   DROP POLICY sel_currencies_platform ON shared.currencies;
--   REVOKE SELECT ON shared.languages FROM app_platform;
--   REVOKE SELECT ON shared.timezones FROM app_platform;
--   REVOKE SELECT ON shared.currencies FROM app_platform;
-- ----------------------------------------------------------------------------
