import { AppFailure } from '@/server/errors/app-failure';
import type { ReportConfigurationRow } from '../data/report-catalogue-repository';
import type { ReportDatasetDefinition } from '../domain/report-datasets';

const SCOPE_RANK: Readonly<Record<string, number>> = { branch: 1, company: 2, tenant: 3 };
const FILTER_TYPES: Readonly<Record<string, string>> = {
  companyId: 'uuid',
  branchId: 'uuid',
  from: 'date',
  to: 'date',
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A tenant configuration can narrow a registered report, never widen it.
 *
 * P1-23's existing schema shape is { filters: { name: { type } } }. There is
 * no approved general JSON-schema evaluator. The merged configuration writer
 * bounds object shape but defers vocabulary. This understood allowlist is
 * executable; unfamiliar constraints fail closed rather than being discarded.
 * The schema default {} adds no restriction; filters: {} permits no filters.
 * Pagination is transport, not a report filter.
 */
export function assertReportConfiguration(
  row: ReportConfigurationRow | null,
  definition: ReportDatasetDefinition,
  filters: Readonly<Record<string, string>>
): void {
  if (row === null) return;
  if (row.status !== 'published' || row.version_number === null) {
    throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
  }
  const ceiling = SCOPE_RANK[row.scope_level];
  const scope = SCOPE_RANK[definition.scope];
  if (ceiling === undefined || scope === undefined || scope > ceiling) deny();

  const schema = row.parameter_schema;
  if (!object(schema) || Object.keys(schema).some((key) => key !== 'filters')) deny();
  // The frozen publication contract accepts its default {}, with no allowlist.
  if (Object.keys(schema).length === 0) return;
  if (!object(schema.filters)) deny();
  const allowed = schema.filters;
  for (const [name, rule] of Object.entries(allowed)) {
    if (
      !Object.hasOwn(FILTER_TYPES, name) ||
      !object(rule) ||
      Object.keys(rule).some((key) => key !== 'type') ||
      rule.type !== FILTER_TYPES[name]
    ) {
      deny();
    }
  }
  if (Object.keys(filters).some((name) => !Object.hasOwn(allowed, name))) deny();
}

function deny(): never {
  throw new AppFailure('ERR-IAM-001', {
    message: 'The tenant report configuration does not permit this selection.',
  });
}
