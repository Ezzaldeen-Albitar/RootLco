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
 * ## What P1-31 P-11 changed, and what it did not
 *
 * Execution arrived, and the binding it needed did NOT come from the schema —
 * it came from the Owner requirement that a report code binds to a
 * code-registered dataset (OWR-2026-09-06-A-12). So the paragraph above is still
 * an accurate account of `rpt`: there is still no data-source column, and this
 * module still does not invent one. `executable` is now `REPORT_DATASETS`
 * membership rather than a literal `false`, the catalogue merges the registered
 * baselines with the tenant's rows, and `application/report-run-service.ts` is
 * the only thing that runs anything. EXPORT generation is still absent
 * (prerequisite P-12), and `rpt.export` is still excluded.
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
import { pageRequest, type Page } from '@/server/db/pagination';
import { AppFailure } from '@/server/errors/app-failure';
import { REPORT_ORDERING } from '../data/report-catalogue-repository';
import type {
  ReportCatalogueRepository,
  ReportConfigurationRow,
} from '../data/report-catalogue-repository';
import {
  REPORT_DATASET_CODES,
  isReportDatasetCode,
  reportDataset,
  type ReportDatasetDefinition,
} from '../domain/report-datasets';

/** Where a definition came from. See `listPublished` for what each means. */
export type ReportDefinitionSource = 'platform' | 'tenant';

export interface ReportDefinitionView {
  readonly reportCode: string;
  readonly name: string;
  readonly scopeLevel: string;
  /**
   * The permission an EXPORT of this report requires — not the one to view it.
   *
   * NULL for a platform baseline, and that is a statement rather than a gap:
   * report export is prerequisite P-12 and `rpt.export` is deliberately excluded
   * from the provisioning bundle (change control CC-04), so naming a code here
   * would advertise an export path that does not exist. A tenant CONFIGURATION
   * row always carries one, because `export_permission_code` is a NOT NULL
   * foreign key into the permission catalogue.
   */
  readonly exportPermissionCode: string | null;
  readonly versionNumber: number | null;
  /** The allowlist of filters this report accepts. Empty when no version is published. */
  readonly parameterSchema: unknown;
  readonly publishedAt: string | null;
  readonly recordVersion: number;
  /**
   * Whether this code is bound to a registered dataset and can therefore be RUN
   * through `rpt.report-run` (P1-31 P-11).
   *
   * It was the literal `false` in P1-23, because the frozen `rpt` schema binds
   * no data source to a report code. It is now `REPORT_DATASETS` membership: true
   * for a code the engine has a dataset for, false for every other — including a
   * published tenant configuration whose code the platform does not implement,
   * which is a definition a client may read and must not offer to run.
   */
  readonly executable: boolean;
  /**
   * `platform` — a code-registered baseline the engine ships, visible to every
   * tenant with no configuration row behind it. `tenant` — a row this tenant
   * published in `rpt.report_configurations`.
   */
  readonly source: ReportDefinitionSource;
  /**
   * The i18n key for a platform baseline's title, or null for a tenant row.
   *
   * A key rather than a label, because a baseline has no operator who could have
   * named it and the platform must not ship an English string as though a tenant
   * had written it. A tenant row carries `name`, which is that operator's own
   * words, and no key.
   */
  readonly titleKey: string | null;
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
  executable: isReportDatasetCode(row.report_code),
  source: 'tenant',
  titleKey: null,
});

/**
 * A code-registered baseline, projected into the same view a tenant row is.
 *
 * `name` repeats the code because a baseline carries no operator-authored label
 * — see `titleKey`, which is what a client renders. `recordVersion` is 0 and
 * both version fields are null: there is no row, so there is nothing to
 * optimistically lock and no publication instant to report. A client that treats
 * `recordVersion` as an If-Match value for a platform entry is asking to
 * configure something the tenant has not configured, and 0 is the honest answer
 * to a question with no row behind it.
 */
const baselineView = (definition: ReportDatasetDefinition): ReportDefinitionView => ({
  reportCode: definition.code,
  name: definition.code,
  scopeLevel: definition.scope,
  exportPermissionCode: null,
  versionNumber: null,
  parameterSchema: { parameters: definition.parameterSchema },
  publishedAt: null,
  recordVersion: 0,
  executable: true,
  source: 'platform',
  titleKey: definition.titleKey,
});

export class ReportCatalogueService extends ApplicationService {
  protected readonly module = 'reporting';

  constructor(private readonly repository: ReportCatalogueRepository) {
    super();
  }

  /**
   * A page of published definitions.
   *
   * Paginated because `rpt.report_configurations` is a table the TENANT writes,
   * so an unbounded read would let a tenant choose the response size. The
   * existing `shared.export-catalogue` returns a static in-code array and is
   * bounded by construction; this one is not, and the difference is what decided
   * the shape.
   *
   * ## The MERGE, and the decision behind it (P1-31 P-11)
   *
   * The page carries two kinds of entry. Code-registered baselines come first,
   * marked `source: 'platform'`; the tenant's own published rows follow in the
   * `report_code` order this catalogue has always used, marked
   * `source: 'tenant'`. A tenant row whose code is registered SUPPRESSES the
   * baseline entry and is returned in its own place, carrying that tenant's
   * scope, export permission and parameter schema. An unpublished or archived
   * row also suppresses fallback, but is not returned. A configuration row is
   * **customization of a report the platform implements, not a precondition for
   * it existing**.
   *
   * That rule is an engineering decision, recorded in
   * `docs/phase-1/phase-1-31/report-engine-seam.md` as **OPEN to Owner
   * override**. The alternative — a report is invisible until an operator
   * configures it — is defensible and would mean every tenant must configure
   * four rows before any report works, which `rpt.report_configurations` has no
   * seed for and no writer until P-11's remaining slice lands.
   *
   * Baselines are emitted on the FIRST page only (no cursor). They are bounded by
   * the source tree rather than by tenant data, so they cannot make a page
   * unbounded; and the suppression is decided by a single bounded lookup over the
   * registered codes, so a tenant row sitting on a later page still hides its
   * baseline. What a caller must NOT assume is that the page is sorted by code
   * throughout: it is baselines, then codes ascending.
   */
  async listPublished(
    db: DbHandle,
    query: { readonly limit?: number | undefined; readonly cursor?: string | undefined }
  ): Promise<Page<ReportDefinitionView>> {
    const request = pageRequest(REPORT_ORDERING, query);
    const page = await this.repository.listPublished(db, request);
    const rows = page.items.map(toView);
    // Baselines belong to the FIRST page only. See the docblock above.
    if (request.cursor !== null) return { ...page, items: rows };

    const configured = new Set(
      (await this.repository.findByCodes(db, REPORT_DATASET_CODES)).map((row) => row.report_code)
    );
    const baselines = REPORT_DATASET_CODES.filter((code) => !configured.has(code)).map((code) =>
      baselineView(reportDataset(code))
    );
    return { ...page, items: [...baselines, ...rows] };
  }

  /**
   * One definition by code — a tenant's published configuration, or the
   * code-registered baseline only when no live configuration row exists.
   * Unpublished and archived tenant rows answer `ERR-RES-001`.
   *
   * The precedence is the same as the list's and states the same rule: a
   * configuration row is CUSTOMIZATION of a report the platform already
   * implements, so a tenant that has configured nothing can still read (and run)
   * `work_orders_by_status`, and one that has configured it sees its own scope,
   * export permission and filter allowlist.
   */
  async readByCode(db: DbHandle, reportCode: string): Promise<ReportDefinitionView> {
    const row = await this.repository.findByCode(db, reportCode);
    if (row?.status === 'published') return toView(row);
    if (row === null && isReportDatasetCode(reportCode)) {
      return baselineView(reportDataset(reportCode));
    }
    // A draft, an archived report, another tenant's report and a code that
    // never existed all answer identically. The catalogue must not be usable
    // to discover which report codes a tenant has configured.
    throw new AppFailure('ERR-RES-001', { message: 'Report not found.' });
  }
}
