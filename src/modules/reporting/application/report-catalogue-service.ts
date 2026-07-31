/**
 * Report catalogue (P1-23).
 *
 * ## What this phase implements, and the limitation it records instead of hiding
 *
 * The frozen `rpt` schema describes reports as tenant configuration: a
 * `report_code`, a name, a scope level, a per-report export permission, and a
 * versioned `parameter_schema` that is the allowlist of filters the report
 * accepts.
 *
 * It contains **no binding from a report code to a data source** — no query, no
 * table, no module reference. So there is nothing in the approved contracts
 * that says what `report_code = 'x'` should SELECT, and inventing one would
 * mean inventing a business report definition the Product Owner has not
 * approved. Report EXECUTION and EXPORT GENERATION are therefore not
 * implemented in P1-23, and this service exposes the catalogue and the
 * definitions instead.
 *
 * That is a recorded limitation, not a silent gap: the read below returns the
 * parameter schema and the export permission a future execution surface will
 * need, so the contract a caller programs against does not change when
 * execution arrives.
 *
 * Export AUTHORIZATION already exists from P1-15 (`shared.export-authorize`,
 * guarded by `rpt.export`) and is not duplicated here.
 *
 * ## Permission separation is projected, never assumed
 *
 * `export_permission_code` is a foreign key into the permission catalogue, so a
 * caller who may VIEW a report is not thereby allowed to EXPORT it. The view
 * reports which permission an export would require, which is what lets a client
 * present the distinction rather than discovering it through a denial.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import type {
  ReportCatalogueRepository,
  ReportConfigurationRow,
} from '../data/report-catalogue-repository';

export interface ReportDefinitionView {
  readonly reportCode: string;
  readonly name: string;
  readonly scopeLevel: string;
  /** The permission an EXPORT of this report requires — not the one to view it. */
  readonly exportPermissionCode: string;
  readonly versionNumber: number | null;
  /** The allowlist of filters this report accepts. Empty when no version is published. */
  readonly parameterSchema: unknown;
  readonly publishedAt: string | null;
  readonly recordVersion: number;
  /**
   * Always false in P1-23. The approved contracts bind no data source to a
   * report code, so nothing can be executed yet; a client must not infer that a
   * definition it can read is a report it can run.
   */
  readonly executable: false;
}

const toView = (row: ReportConfigurationRow): ReportDefinitionView => ({
  reportCode: row.report_code,
  name: row.name,
  scopeLevel: row.scope_level,
  exportPermissionCode: row.export_permission_code,
  versionNumber: row.version_number,
  parameterSchema: row.parameter_schema ?? {},
  publishedAt: row.published_at === null ? null : row.published_at.toISOString(),
  recordVersion: row.record_version,
  executable: false,
});

export class ReportCatalogueService extends ApplicationService {
  protected readonly module = 'reporting';

  constructor(private readonly repository: ReportCatalogueRepository) {
    super();
  }

  async listPublished(
    db: DbHandle
  ): Promise<{ readonly reports: readonly ReportDefinitionView[] }> {
    const rows = await this.repository.listPublished(db);
    return { reports: rows.map(toView) };
  }

  async readByCode(db: DbHandle, reportCode: string): Promise<ReportDefinitionView> {
    const row = await this.repository.findPublishedByCode(db, reportCode);
    if (row === null) {
      // A draft, an archived report, another tenant's report and a code that
      // never existed all answer identically. The catalogue must not be usable
      // to discover which report codes a tenant has configured.
      throw new AppFailure('ERR-RPT-001', { message: 'Report not found.' });
    }
    return toView(row);
  }
}
