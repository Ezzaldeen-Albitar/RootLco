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

export type { ReportDefinitionView } from './application/report-catalogue-service';

export const reportingModule = composeModule({
  module: 'reporting',
  create: () => ({
    catalogue: new ReportCatalogueService(new ReportCatalogueRepository()),
  }),
});
