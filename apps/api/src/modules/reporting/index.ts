/**
 * `reporting` module — public surface (P1-23).
 *
 * The only legal import path for this module (ADR-001). Everything under
 * `application/` and `data/` is internal, and the module-boundary rule fails
 * the build for any other module that reaches past this file.
 *
 * No repository is exported. Handing one out would let a caller run SQL under
 * this module's identity and skip the scope rules only the service applies.
 */
import { composeModule } from '@/server/layering';
import { ReportCatalogueRepository } from './data/report-catalogue-repository';
import { ReportCatalogueService } from './application/report-catalogue-service';
import { ReportRunService } from './application/report-run-service';

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
  }),
});
