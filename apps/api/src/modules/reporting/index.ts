/**
 * `reporting` module — public surface (P1-23, extended by P1-31 P-11).
 *
 * The only legal import path for this module (ADR-001). Everything under
 * `application/`, `data/` and `domain/` is internal, and the module-boundary rule
 * fails the build for any other module that reaches past this file.
 *
 * Three services, and the split is deliberate. `catalogue` answers a caller who may
 * RUN a report: published definitions only, `executable: false` on every one,
 * gated by `rpt.report.read`. `configurations` is the AUTHORING surface published
 * by P1-31 prerequisite P-11: drafts, archived rows and every version of each,
 * gated by `rpt.report.configure`. A caller holding only the read code must not
 * see what the second one returns, which is why they are separate services with
 * separate authorities rather than one service with a flag. `runs` EXECUTES a
 * published definition against a dataset and is gated by `rpt.report.run`; it is
 * separate again because running a report reads tenant business rows, which
 * neither of the other two ever touch.
 *
 * No repository is exported. Handing one out would let a caller run SQL under
 * this module's identity and skip the scope rules only the services apply.
 */
import { composeModule } from '@/server/layering';
import { ReportCatalogueRepository } from './data/report-catalogue-repository';
import { ReportCatalogueService } from './application/report-catalogue-service';
import { ReportRunService } from './application/report-run-service';
import { ReportConfigurationRepository } from './data/report-configuration-repository';
import { ReportConfigurationService } from './application/report-configuration-service';

export type {
  ReportDefinitionSource,
  ReportDefinitionView,
} from './application/report-catalogue-service';
export type {
  ReportCellView,
  ReportColumnView,
  ReportPeriodView,
  ReportRowView,
  ReportRunInput,
  ReportRunView,
  ReportStateCountView,
} from './application/report-run-service';
export type {
  ReportConfigurationDetailView,
  ReportConfigurationListView,
  ReportConfigurationSummaryView,
  ReportConfigurationVersionView,
} from './application/report-configuration-service';

export {
  MAX_PARAMETER_SCHEMA_BYTES,
  MAX_PARAMETER_SCHEMA_KEYS,
  MAX_REPORT_NAME,
  REPORT_CODE_FORMAT,
  REPORT_CONFIGURATION_STATUSES,
  REPORT_SCOPE_LEVELS,
  REPORT_VERSION_STATUSES,
} from './domain/report-configuration';
export type {
  ReportConfigurationStatus,
  ReportScopeLevel,
  ReportVersionStatus,
} from './domain/report-configuration';
/**
 * The dataset registry's TYPES and its read-only accessors (P1-31 P-11).
 *
 * Exported because the registry is the module's contract with the rest of the
 * platform — a route validates a report code against it, and the P1-24 register
 * and the seam record are written from it. The resolvers are NOT exported: they
 * take a `DbHandle` and live in the application layer, which is exactly the
 * separation the domain layer's database-free rule (`B5`) requires.
 */
export {
  REPORT_DATASETS,
  REPORT_DATASET_CODES,
  isReportDatasetCode,
  reportDataset,
  type ReportColumnDefinition,
  type ReportColumnKind,
  type ReportDatasetCode,
  type ReportDatasetDefinition,
  type ReportParameterDefinition,
} from './domain/report-datasets';

export const reportingModule = composeModule({
  module: 'reporting',
  create: () => ({
    catalogue: new ReportCatalogueService(new ReportCatalogueRepository()),
    // Tenant restrictions come from rpt; dataset rows remain behind wo's port.
    runs: new ReportRunService(new ReportCatalogueRepository()),
    configurations: new ReportConfigurationService(new ReportConfigurationRepository()),
  }),
});
