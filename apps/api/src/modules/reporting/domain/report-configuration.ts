/**
 * The report-configuration vocabulary, as the frozen `rpt` schema defines it
 * (P1-31 prerequisite **P-11**).
 *
 * Every value here is a transcription of a CHECK constraint or a column bound in
 * `supabase/migrations/20260724096000_rpt_reporting.sql`, and nothing here is a
 * business rule this slice invented. The distinction matters: the schema is the
 * authority, these constants exist so a caller is told which field is wrong
 * instead of receiving a bare `23514` naming a constraint four layers down, and
 * the constraint still runs.
 *
 * This file holds no state and touches no database. `domain/**` may not import
 * `server/db` and may not import `pg`; a rule that needs a row receives it as an
 * argument from the application service.
 */

/**
 * `ck_report_configurations_code`: `^[a-z][a-z0-9_]{1,62}$`.
 *
 * Two to sixty-three characters, lower snake, opening on a letter. It is the
 * stable identity a report is addressed by — `rpt.report-read` resolves a
 * definition by this code and not by id — and `tg_report_configurations_immutable`
 * freezes it, so a mistyped code is not repairable by an edit.
 */
export const REPORT_CODE_FORMAT = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * `ck_report_configurations_scope`: how wide the figures a report answers with
 * are allowed to be.
 *
 * It is DATA rather than an authorization decision on this surface: no operation
 * published by P-11 reads it, because P-11 publishes no engine. `rpt.saved_filters`
 * carries `ck_saved_filters_scope_within_report`, which is where the value acquires
 * its enforcement — a saved filter may not be wider than the report it belongs to.
 */
export const REPORT_SCOPE_LEVELS = ['branch', 'company', 'tenant'] as const;
export type ReportScopeLevel = (typeof REPORT_SCOPE_LEVELS)[number];

/**
 * `ck_report_configurations_status`.
 *
 * `published` is what `rpt.report-catalogue` and `rpt.report-read` filter on, so
 * this vocabulary is the switch that decides whether a definition is visible to a
 * `rpt.report.read` holder at all. `archived` is a WITHDRAWN decision and `draft`
 * an unfinished one; both are visible only through this administration surface.
 */
export const REPORT_CONFIGURATION_STATUSES = ['draft', 'published', 'archived'] as const;
export type ReportConfigurationStatus = (typeof REPORT_CONFIGURATION_STATUSES)[number];

/**
 * `ck_report_configuration_versions_status`. A version has TWO states and not
 * three: there is no archived version, because `rpt.guard_report_version_freeze`
 * makes a published one immutable in every column that describes it.
 */
export const REPORT_VERSION_STATUSES = ['draft', 'published'] as const;
export type ReportVersionStatus = (typeof REPORT_VERSION_STATUSES)[number];

/**
 * The longest report name this surface accepts.
 *
 * `rpt.report_configurations.name` is unbounded `text`, so this is a decision of
 * the surface rather than a transcription, and it is stated as one. An unbounded
 * name is a request whose size the caller chooses; 200 characters is the bound
 * every other tenant-authored name in this codebase carries.
 */
export const MAX_REPORT_NAME = 200;

/**
 * The most top-level keys a `parameter_schema` may declare.
 *
 * `parameter_schema` is `jsonb NOT NULL DEFAULT '{}'` and the frozen schema
 * constrains its CONTENT in no way at all — no CHECK, no domain, no trigger. So
 * the only honest thing this surface can do is bound the SHAPE and record that
 * the VOCABULARY is undecided: what a key means, and which filters a report
 * accepts, belongs with the engine and the Owner decision D-4 that must precede
 * it. Validating a vocabulary here would be inventing the report definitions
 * nobody has approved.
 *
 * Sixty-four is a bound on a filter allowlist a person authors, not on a data
 * structure a machine generates.
 */
export const MAX_PARAMETER_SCHEMA_KEYS = 64;

/**
 * The most bytes a serialized `parameter_schema` may occupy: 16 KiB.
 *
 * `jsonb` would accept a document orders of magnitude larger, and this table is
 * one a TENANT writes — so without a bound the row size, and every response that
 * carries it, is a number the tenant chooses. Measured on the UTF-8 encoding of
 * the canonical JSON rather than on the string length, because a multi-byte
 * character costs the column bytes and not characters.
 */
export const MAX_PARAMETER_SCHEMA_BYTES = 16 * 1024;
