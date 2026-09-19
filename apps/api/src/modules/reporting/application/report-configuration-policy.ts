import { AppFailure } from '@/server/errors/app-failure';
import type { ReportConfigurationRow } from '../data/report-catalogue-repository';
import type { ReportDatasetDefinition } from '../domain/report-datasets';
import { readReportParameterVocabulary } from '../domain/report-configuration';

const SCOPE_RANK: Readonly<Record<string, number>> = { branch: 1, company: 2, tenant: 3 };

/**
 * A tenant configuration can narrow a registered report, never widen it.
 *
 * P1-23's existing schema shape is { filters: { name: { type } } }. There is
 * no approved general JSON-schema evaluator. This understood allowlist is
 * executable; unfamiliar constraints fail closed rather than being discarded.
 * The schema default {} adds no restriction; filters: {} permits no filters.
 * Pagination is transport, not a report filter.
 *
 * The allowlist itself is NOT stated here. It is
 * `readReportParameterVocabulary` in the domain, and the version writer reads
 * the same function, so a schema this policy would refuse can no longer be
 * published in the first place. Two copies of a vocabulary is how a tenant ends
 * up holding a published definition every run of which is then refused.
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

  const vocabulary = readReportParameterVocabulary(row.parameter_schema);
  // Fails closed: a document the platform does not recognise is a restriction it
  // cannot evaluate, never an absent one.
  if (vocabulary.kind === 'unrecognised') deny();
  // The frozen publication contract accepts its default {}, with no allowlist.
  if (vocabulary.kind === 'unrestricted') return;
  const allowed = new Set<string>(vocabulary.names);
  if (Object.keys(filters).some((name) => !allowed.has(name))) deny();
}

function deny(): never {
  throw new AppFailure('ERR-IAM-001', {
    message: 'The tenant report configuration does not permit this selection.',
  });
}
