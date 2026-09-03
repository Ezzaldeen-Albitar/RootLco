/**
 * The diagnostic-type catalogue read (P1-29 `W5`).
 *
 * `dia.diagnostic_types` has existed since P1-09 and has been READ by the
 * diagnostics module since P1-19 — `diagnosticTypeByCode` resolves a code when
 * a template is created — but no operation ever published the set. A screen
 * that authors a template or renders a report needs the vocabulary the tenant
 * is configured with, and until this service the only way to learn it was to
 * guess a code and be refused.
 *
 * ## It publishes the SET, not a decision
 *
 * The rows come back with their `status`, both `active` and `inactive`. A
 * catalogue that filtered to `active` would be right for a picker and wrong for
 * a report typed against a type the tenant has since retired — that report
 * still exists, and its type still needs a name. Filtering is the caller's
 * choice and the `status` field is what makes it possible. The enforcement
 * question — may THIS code be used for a NEW template — is still answered by
 * `diagnosticTypeByCode`, which keeps its `active` filter; this read decides
 * nothing.
 *
 * ## Tenant shadows platform, exactly as the repository already resolves it
 *
 * Dual-scope: a tenant row of the same code REPLACES the platform row rather
 * than joining it, which is the predicate `diagnosticTypeByCode` and every
 * `wo` catalogue read use. A list that showed both would offer a choice the
 * write path does not honour.
 *
 * ## No content is seeded, and this service does not pretend otherwise
 *
 * The platform seed holds no diagnostic type. Approved vocabulary is an Owner
 * input; until it exists this read answers an empty set, which is the truth
 * and not a defect.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type { DiagnosticsRepository, DiagnosticTypeRow } from '../data/diagnostics-repository';

/** One diagnostic type as the caller tenant sees it, tenant shadowing platform. */
export interface DiagnosticTypeView {
  readonly id: string;
  readonly scope: 'platform' | 'tenant';
  readonly code: string;
  readonly name: string;
  readonly status: 'active' | 'inactive';
  readonly recordVersion: number;
}

const toView = (row: DiagnosticTypeRow): DiagnosticTypeView => ({
  id: row.id,
  scope: row.scope,
  code: row.code,
  name: row.name,
  status: row.status,
  recordVersion: row.recordVersion,
});

export class DiagnosticCatalogService extends ApplicationService {
  protected readonly module = 'diagnostics';

  constructor(private readonly repository: DiagnosticsRepository) {
    super();
  }

  /** Every diagnostic type visible to the caller tenant, ordered by code. */
  async diagnosticTypes(db: DbHandle): Promise<readonly DiagnosticTypeView[]> {
    return (await this.repository.listDiagnosticTypes(db)).map(toView);
  }
}
