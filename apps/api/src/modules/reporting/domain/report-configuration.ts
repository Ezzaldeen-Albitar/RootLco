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
 * this bound is the SIZE half of what the surface owes, and it is now the outer
 * of two: `readReportParameterVocabulary` below decides what the keys may MEAN.
 *
 * The size bound is kept even though the vocabulary admits at most one top-level
 * key, because it is the cheap refusal. A 16 KiB document is rejected on its size
 * without the vocabulary reader ever walking it, and a bound that only fires
 * ahead of a stricter rule is still the bound that decides how much of a tenant's
 * document this process handles.
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

/**
 * The report parameter vocabulary — the ONE definition of it in this codebase.
 *
 * `rpt.report_configuration_versions.parameter_schema` is `jsonb NOT NULL
 * DEFAULT '{}'` with no constraint of any kind over its content, so what a
 * schema MEANS is decided in code or nowhere. It was decided in code twice, in
 * opposite directions, and this module exists to make that impossible: the
 * version WRITER accepted any bounded JSON object while the report ENGINE
 * refused everything outside this allowlist. An administrator could therefore
 * publish a schema that every run of the report would then refuse, and nothing
 * told them so. Both sides now read this function, so neither can drift.
 *
 * The four names are the four the engine implements, and each carries the type
 * the engine parses the supplied value as. Adding a fifth is a change to the
 * engine and to this list in the same commit, which is the point of one list.
 *
 * `companyId` and `branchId` are uuid; `from` and `to` are date. Pagination is
 * transport and is not a report filter, so no cursor or limit name appears here.
 */
export const REPORT_FILTER_TYPES = {
  companyId: 'uuid',
  branchId: 'uuid',
  from: 'date',
  to: 'date',
} as const;

export type ReportFilterName = keyof typeof REPORT_FILTER_TYPES;

/** The filter names a schema may declare, in the order this module states them. */
export const REPORT_FILTER_NAMES = Object.keys(REPORT_FILTER_TYPES) as readonly ReportFilterName[];

/**
 * What one `parameter_schema` document means.
 *
 * Three outcomes and not two, because the empty object and the empty allowlist
 * are DIFFERENT documents that a boolean would flatten together:
 *
 * - `unrestricted` — `{}`, the column's own default. A version that declares no
 *   filters at all, which places no restriction on a run. This is the shape
 *   every version created without a `parameterSchema` carries, so it must be
 *   the permissive one or the default would forbid what it defaults to.
 * - `allowlist` — `{ filters: { … } }`. The run may supply the named filters and
 *   no others. `names` MAY be empty: `{ filters: {} }` is a well-formed document
 *   that permits nothing, and the caller decides what to do about it. The engine
 *   honours it; the writer refuses it.
 * - `unrecognised` — anything else. `reason` says which rule was broken without
 *   quoting the submitted document, because a refusal is displayed and logged
 *   and must not carry a tenant's input into either.
 *
 * Fails closed by construction: a document this function does not recognise is
 * never treated as an empty restriction.
 */
export type ReportParameterVocabulary =
  | { readonly kind: 'unrestricted' }
  | { readonly kind: 'allowlist'; readonly names: readonly ReportFilterName[] }
  | { readonly kind: 'unrecognised'; readonly reason: string };

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a `parameter_schema` document against the vocabulary above. */
export function readReportParameterVocabulary(schema: unknown): ReportParameterVocabulary {
  if (!isJsonObject(schema)) {
    return { kind: 'unrecognised', reason: 'it is not a JSON object' };
  }
  if (Object.keys(schema).some((key) => key !== 'filters')) {
    return { kind: 'unrecognised', reason: 'it declares a top-level key other than filters' };
  }
  if (Object.keys(schema).length === 0) return { kind: 'unrestricted' };
  if (!isJsonObject(schema.filters)) {
    return { kind: 'unrecognised', reason: 'filters is not a JSON object' };
  }
  const names: ReportFilterName[] = [];
  for (const [name, rule] of Object.entries(schema.filters)) {
    if (!Object.hasOwn(REPORT_FILTER_TYPES, name)) {
      return { kind: 'unrecognised', reason: 'it names a filter this platform does not implement' };
    }
    if (!isJsonObject(rule) || Object.keys(rule).some((key) => key !== 'type')) {
      return {
        kind: 'unrecognised',
        reason: 'a filter rule declares something other than exactly one key, type',
      };
    }
    if (rule.type !== REPORT_FILTER_TYPES[name as ReportFilterName]) {
      return {
        kind: 'unrecognised',
        reason: 'a filter declares a type the platform does not read it as',
      };
    }
    names.push(name as ReportFilterName);
  }
  return { kind: 'allowlist', names };
}
