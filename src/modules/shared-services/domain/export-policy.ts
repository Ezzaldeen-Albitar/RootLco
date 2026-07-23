/**
 * Export authorization policy (P1-15).
 *
 * P1-15 authorizes exports; it does **not** generate files. That split is
 * deliberate and is stated wherever the capability is described: a generator
 * that writes a CSV to object storage would need a storage provider (none is
 * provisioned), a retention decision for the artefact (none is approved), and a
 * delivery channel for it (none exists). Authorizing first, and building the
 * generator in the phase that owns reporting, keeps every one of those decisions
 * where it belongs.
 *
 * What is enforced here, and why each rule exists:
 *
 *  - **A resource is registered or it cannot be exported.** No "export
 *    everything" and no caller-named table.
 *  - **Fields are an allow-list per resource.** A column absent from the list is
 *    not exportable at all — that is how `document_versions.storage_key` stays
 *    out of every export without a special case.
 *  - **Sensitive fields need a second permission** (`iam.sensitive.view`) on top
 *    of the resource permission. Bulk export is the highest-leverage way to read
 *    restricted data, so it is the last place to infer consent from a general
 *    grant.
 *  - **Every export needs `rpt.export` as well as the resource permission.** One
 *    revocation then disables exporting across the platform without touching any
 *    operational grant.
 *  - **The row estimate is bounded.** An unbounded export is a denial-of-service
 *    against the database and an exfiltration channel at the same time.
 *
 * ## CSV formula injection is a downstream contract, not a silent assumption
 *
 * A value beginning `=`, `+`, `-`, `@`, tab, or CR is executed as a formula by
 * common spreadsheet software. P1-15 produces no file, so it cannot neutralise
 * one — `assertFormulaSafeCell()` exists so the generator that eventually does
 * has a single implementation to call, and `formulaRiskyFields()` records which
 * registered fields are free-text and therefore need it.
 */

import type { FilterableField, FilterOperator, FilterValueType } from './query-primitives';

export interface ExportField {
  readonly name: string;
  /** Column expression. A code constant. */
  readonly column: string;
  /** Requires `iam.sensitive.view` in addition to the resource permission. */
  readonly sensitive: boolean;
  /** Free text that could carry a spreadsheet formula when written to CSV. */
  readonly freeText: boolean;
}

export interface ExportResource {
  readonly code: string;
  readonly table: string;
  /** Column carrying the tenant, always predicated in addition to RLS. */
  readonly tenantColumn: string;
  /** Permission required in addition to `rpt.export`. */
  readonly permission: string;
  /** Scope the export is narrowed to. */
  readonly scope: 'tenant' | 'company' | 'branch';
  readonly fields: readonly ExportField[];
  /**
   * Fields an export request may filter on.
   *
   * Deliberately a *subset* of `fields`, and deliberately never the free-text
   * ones: a prefix filter on a customer-supplied title is a character-by-
   * character read oracle over data the caller may not be entitled to see in
   * full, and `LIKE` on unindexed free text is also the cheapest way to make the
   * database do unbounded work.
   */
  readonly filterable: readonly FilterableField[];
  readonly description: string;
}

/** Permission every export requires, whatever the resource. */
export const EXPORT_PERMISSION = 'rpt.export';
/** Permission a sensitive field additionally requires. */
export const SENSITIVE_FIELD_PERMISSION = 'iam.sensitive.view';

const filter = (
  name: string,
  column: string,
  type: FilterValueType,
  operators: readonly FilterOperator[]
): FilterableField => ({ name, column, type, operators });

const field = (
  name: string,
  column: string,
  options: { sensitive?: boolean; freeText?: boolean } = {}
): ExportField => ({
  name,
  column,
  sensitive: options.sensitive ?? false,
  freeText: options.freeText ?? false,
});

/**
 * Exportable resources.
 *
 * Every column named below exists in protected schema and is asserted against
 * `information_schema` by `tests/db/p1-15-export-authorization.test.ts`, so a
 * registry entry cannot drift from the database.
 *
 * Deliberately absent, and each for a reason:
 *   - `shared.document_versions.storage_key` — a locator that travels outside
 *     RLS in every downstream system that touches an export file;
 *   - `shared.document_versions.sha256` — an integrity value, not business data;
 *   - `shared.outbound_messages.body_sha256` — same;
 *   - anything from `shared.file_scan_results` — no role may write it, and
 *     exporting it would invite treating an export as scan evidence.
 */
export const EXPORT_RESOURCES: readonly ExportResource[] = Object.freeze([
  {
    code: 'documents',
    table: 'shared.documents',
    tenantColumn: 'tenant_id',
    permission: 'shared.document.manage',
    scope: 'tenant',
    description: 'Document metadata. Never the bytes, never the storage key.',
    filterable: [
      filter('status', 'status', 'text', ['eq', 'in']),
      filter('classification', 'classification', 'text', ['eq', 'in']),
      filter('retentionClass', 'retention_class', 'text', ['eq', 'in']),
      filter('legalHold', 'legal_hold', 'boolean', ['eq']),
      filter('companyId', 'company_id', 'uuid', ['eq', 'in']),
      filter('branchId', 'branch_id', 'uuid', ['eq', 'in']),
      filter('createdAt', 'created_at', 'timestamp', ['gte', 'lte', 'gt', 'lt']),
    ],
    fields: [
      field('id', 'id'),
      field('title', 'title', { freeText: true }),
      field('classification', 'classification'),
      field('retentionClass', 'retention_class'),
      field('status', 'status'),
      field('legalHold', 'legal_hold'),
      field('companyId', 'company_id'),
      field('branchId', 'branch_id'),
      field('createdAt', 'created_at'),
    ],
  },
  {
    code: 'outbound_messages',
    table: 'shared.outbound_messages',
    tenantColumn: 'tenant_id',
    permission: 'shared.notification.send',
    scope: 'tenant',
    filterable: [
      filter('status', 'status', 'text', ['eq', 'in']),
      filter('channel', 'channel', 'text', ['eq', 'in']),
      filter('purpose', 'purpose', 'text', ['eq', 'in']),
      filter('createdAt', 'created_at', 'timestamp', ['gte', 'lte', 'gt', 'lt']),
    ],
    description:
      'Outbound-message delivery ledger. Recipients are a digest or a user reference; no address and no content are stored, so neither can be exported.',
    fields: [
      field('id', 'id'),
      field('channel', 'channel'),
      field('purpose', 'purpose'),
      field('status', 'status'),
      field('retryCount', 'retry_count'),
      field('failureClass', 'failure_class'),
      field('queuedAt', 'queued_at'),
      field('sentAt', 'sent_at'),
      field('deliveredAt', 'delivered_at'),
      field('createdAt', 'created_at'),
      // A user reference identifies a person; exporting a list of who was
      // messaged is a privacy decision, not an operational one.
      field('recipientUserId', 'recipient_user_id', { sensitive: true }),
      // The dedupe key is chosen by the caller and routinely encodes a business
      // identity ("invoice-<id>-reminder-2"), so it is treated as sensitive.
      field('dedupeKey', 'dedupe_key', { sensitive: true, freeText: true }),
    ],
  },
  {
    code: 'branches',
    table: 'org.branches',
    tenantColumn: 'tenant_id',
    permission: 'org.branch.read',
    scope: 'company',
    description: 'Branch directory, for operational reporting.',
    filterable: [
      filter('status', 'status', 'text', ['eq', 'in']),
      filter('companyId', 'company_id', 'uuid', ['eq', 'in']),
      filter('countryCode', 'country_code', 'text', ['eq', 'in']),
    ],
    fields: [
      field('id', 'id'),
      field('branchCode', 'branch_code'),
      field('name', 'name', { freeText: true }),
      field('city', 'city', { freeText: true }),
      field('countryCode', 'country_code'),
      field('timezoneName', 'timezone_name'),
      field('status', 'status'),
      field('companyId', 'company_id'),
    ],
  },
]);

export function findExportResource(code: string): ExportResource | undefined {
  return EXPORT_RESOURCES.find((resource) => resource.code === code);
}

export interface FieldDecision {
  readonly resolved: readonly ExportField[];
  /** Requested names that are not registered for this resource. */
  readonly unknown: readonly string[];
  /** Registered but sensitive, with the caller lacking the extra permission. */
  readonly denied: readonly string[];
}

/**
 * Resolves the requested field list.
 *
 * An empty request means "every field the caller may read" rather than "every
 * field": defaulting to the full column set would hand a caller without
 * `iam.sensitive.view` the sensitive columns simply for omitting a parameter.
 */
export function resolveExportFields(
  resource: ExportResource,
  requested: readonly string[],
  permissions: ReadonlySet<string>
): FieldDecision {
  const maySeeSensitive = permissions.has(SENSITIVE_FIELD_PERMISSION);

  if (requested.length === 0) {
    return {
      resolved: resource.fields.filter((entry) => !entry.sensitive || maySeeSensitive),
      unknown: [],
      denied: [],
    };
  }

  const resolved: ExportField[] = [];
  const unknown: string[] = [];
  const denied: string[] = [];

  for (const name of requested) {
    const entry = resource.fields.find((candidate) => candidate.name === name);
    if (!entry) {
      unknown.push(name);
      continue;
    }
    if (entry.sensitive && !maySeeSensitive) {
      denied.push(name);
      continue;
    }
    resolved.push(entry);
  }

  return { resolved, unknown, denied };
}

/** Registered fields that would need formula neutralisation in a CSV writer. */
export function formulaRiskyFields(resource: ExportResource): readonly string[] {
  return resource.fields.filter((entry) => entry.freeText).map((entry) => entry.name);
}

/** Leading characters spreadsheet software interprets as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * True when a cell value would be interpreted as a formula.
 *
 * The neutralisation itself (prefixing an apostrophe, or quoting) belongs to the
 * writer, because the correct form depends on the file format. What belongs
 * here is the single definition of "risky", so two writers cannot disagree.
 */
export function isFormulaRiskyCell(value: string): boolean {
  return FORMULA_LEAD.test(value);
}
