/**
 * Report catalogue reads (P1-23).
 *
 * Phase 1-11 froze the `rpt` schema and no phase had registered an operation
 * against it until now. The catalogue is TENANT CONFIGURATION —
 * `rpt.report_configurations` rows — not code, which is what keeps a pilot
 * tenant's report set out of branching logic.
 *
 * Two properties of the frozen schema decide this module's shape:
 *
 *   * `export_permission_code` is a foreign key to `iam.permissions`, so
 *     **export permission is per-report and separate from view permission**.
 *     That is a contract fact, not a design choice, and it is projected rather
 *     than reinvented.
 *   * there is **no data-source column**. Nothing in the schema binds a
 *     `report_code` to a query, table or module, so report EXECUTION has no
 *     contract to bind to. This repository therefore reads definitions and does
 *     not run anything — see the service for what that means for the phase.
 *
 * Only `published` configurations are visible. A draft is an unfinished
 * decision and an archived one is a withdrawn decision; neither is something a
 * caller should be able to run or export.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface ReportConfigurationRow {
  readonly id: string;
  readonly report_code: string;
  readonly name: string;
  readonly scope_level: string;
  readonly export_permission_code: string;
  readonly status: string;
  readonly record_version: number;
  readonly version_number: number | null;
  readonly parameter_schema: unknown;
  readonly published_at: Date | null;
}

const COLUMNS = `
  c.id, c.report_code, c.name, c.scope_level, c.export_permission_code,
  c.status, c.record_version,
  v.version_number, v.parameter_schema, v.published_at
`;

/**
 * The published version of each configuration, if one exists.
 *
 * A LATERAL rather than a plain join: a configuration may have many versions
 * and only the newest published one is the definition in force. A join would
 * multiply rows and a caller would see the same report several times.
 */
const PUBLISHED_VERSION = `
  LEFT JOIN LATERAL (
    SELECT version_number, parameter_schema, published_at
      FROM rpt.report_configuration_versions v2
     WHERE v2.tenant_id = c.tenant_id
       AND v2.report_configuration_id = c.id
       AND v2.status = 'published'
     ORDER BY v2.version_number DESC
     LIMIT 1
  ) v ON true
`;

export class ReportCatalogueRepository extends Repository {
  protected readonly module = 'reporting';

  /** Every published report definition in the caller's tenant, by code. */
  async listPublished(db: DbHandle): Promise<readonly ReportConfigurationRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<ReportConfigurationRow>(
      db,
      `SELECT ${COLUMNS}
         FROM rpt.report_configurations c
         ${PUBLISHED_VERSION}
        WHERE c.tenant_id = $1
          AND c.status = 'published'
          AND c.deleted_at IS NULL
        ORDER BY c.report_code ASC`,
      [context.principal.tenantId]
    );
    return result.rows;
  }

  /** One published report definition by its stable code. */
  async findPublishedByCode(
    db: DbHandle,
    reportCode: string
  ): Promise<ReportConfigurationRow | null> {
    const context = this.assertContext(db);
    return this.runOne<ReportConfigurationRow>(
      db,
      `SELECT ${COLUMNS}
         FROM rpt.report_configurations c
         ${PUBLISHED_VERSION}
        WHERE c.tenant_id = $1
          AND c.report_code = $2
          AND c.status = 'published'
          AND c.deleted_at IS NULL`,
      [context.principal.tenantId, reportCode]
    );
  }
}
