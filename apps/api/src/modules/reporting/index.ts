/**
 * `reporting` module — public surface (P1-23, extended by P1-31 P-11).
 *
 * The only legal import path for this module (ADR-001). Everything under
 * `application/`, `data/` and `domain/` is internal, and the module-boundary rule
 * fails the build for any other module that reaches past this file.
 *
 * Two services, and the split is deliberate. `catalogue` answers a caller who may
 * RUN a report: published definitions only, `executable: false` on every one,
 * gated by `rpt.report.read`. `configurations` is the AUTHORING surface published
 * by P1-31 prerequisite P-11: drafts, archived rows and every version of each,
 * gated by `rpt.report.configure`. A caller holding only the read code must not
 * see what the second one returns, which is why they are separate services with
 * separate authorities rather than one service with a flag.
 *
 * No repository is exported. Handing one out would let a caller run SQL under
 * this module's identity and skip the scope rules only the services apply.
 */
import { composeModule } from '@/server/layering';
import { ReportCatalogueRepository } from './data/report-catalogue-repository';
import { ReportCatalogueService } from './application/report-catalogue-service';
import { ReportConfigurationRepository } from './data/report-configuration-repository';
import { ReportConfigurationService } from './application/report-configuration-service';

export type { ReportDefinitionView } from './application/report-catalogue-service';
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

export const reportingModule = composeModule({
  module: 'reporting',
  create: () => ({
    catalogue: new ReportCatalogueService(new ReportCatalogueRepository()),
    configurations: new ReportConfigurationService(new ReportConfigurationRepository()),
  }),
});
