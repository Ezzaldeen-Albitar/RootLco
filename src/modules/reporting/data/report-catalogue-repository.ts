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
import {
  buildPage,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/**
 * By report code, ascending.
 *
 * `uq_report_configurations_code` makes `report_code` unique per tenant, so it
 * is a total ordering by itself — the keyset still carries the id because
 * `keysetFragment` takes both, but the tie-break can never actually be needed
 * here. Code order is also the only stable order a caller can predict:
 * `published_at` moves whenever a new version is published.
 */
export const REPORT_ORDERING: OrderingContract = {
  key: 'rpt.report_configurations:report_code_asc',
  direction: 'asc',
};

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

  /**
   * A page of published report definitions in the caller's tenant, by code.
   *
   * PAGINATED, unlike `shared.export-catalogue`, and the difference is not
   * stylistic. That catalogue returns a static in-code array and is bounded by
   * construction; this one reads `rpt.report_configurations`, a table a tenant
   * writes through `rpt.report.configure`. An unbounded SELECT over a
   * tenant-controlled table is a response whose size the tenant chooses.
   *
   * `report_code` is unique per tenant, so it is a total ordering on its own and
   * the keyset needs no id tie-break — unlike the notification list, where two
   * messages can share a `created_at`.
   */
  async listPublished(db: DbHandle, request: PageRequest): Promise<Page<ReportConfigurationRow>> {
    const context = this.assertContext(db);
    const keyset = keysetFragment(
      request,
      { sort: 'c.report_code', id: 'c.id' },
      REPORT_ORDERING,
      2
    );
    const result = await this.run<ReportConfigurationRow>(
      db,
      `SELECT ${COLUMNS}
         FROM rpt.report_configurations c
         ${PUBLISHED_VERSION}
        WHERE c.tenant_id = $1
          AND c.status = 'published'
          AND c.deleted_at IS NULL
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [context.principal.tenantId, ...keyset.values]
    );
    return buildPage(result.rows, request, REPORT_ORDERING, (row) => ({
      sortValue: row.report_code,
      id: row.id,
    }));
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
