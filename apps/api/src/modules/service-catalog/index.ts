/**
 * `service-catalog` module — public surface (Phase 1-20).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/service-catalog`.
 * The boundary checker and the ESLint rule both reject
 * `@/modules/service-catalog/<anything>`.
 *
 * ## What this module owns
 *
 * The catalog half of the `svc` schema: `services`, `service_categories`,
 * `service_versions`, `standard_labor_times`, and `branch_service_availability`.
 * The pricing half of the same schema — price lists, versions, rules,
 * assignments, discount rules, approval policies — belongs to `@/modules/pricing`.
 *
 * The split is by **aggregate**, not by schema. A service and its price change
 * for different reasons, under different permissions (`svc.service.manage` vs
 * `svc.price.manage`), and never in the same transaction. Putting them in one
 * module would make that separation a convention; putting them in two makes it
 * a boundary the checker enforces.
 *
 * ## What this module deliberately does not do
 *
 * It never returns a price. `ServiceView` has no amount field, and no query here
 * reads `svc.price_rules`. A caller that needs a price asks `@/modules/pricing`,
 * which is where the deterministic selection and the currency rules live.
 */
import { composeModule } from '@/server/layering';
import { ServiceCatalogRepository } from './data/service-catalog-repository';
import { ServiceCatalogService } from './application/service-catalog-service';
import { ServiceCatalogWriteService } from './application/service-catalog-write-service';

export type {
  BranchAvailabilityRow,
  LaborTimeRow,
  ServiceCategoryRow,
  ServiceListFilter,
  ServiceRow,
  ServiceVersionRow,
} from './data/service-catalog-repository';

export type {
  LaborTimeView,
  ServiceVersionView,
  ServiceView,
} from './application/service-catalog-service';

export type {
  BranchAvailabilityView,
  CreateServiceInput,
  PublishedVersionView,
  SetAvailabilityInput,
  UpdateServiceInput,
} from './application/service-catalog-write-service';

export {
  ACTIVATION_STATES,
  EXTERNAL_CODE,
  INTERNAL_CODE,
  LABOR_TIME_UNIT,
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_NOTES,
  SERVICE_LIFECYCLE_STATES,
  SERVICE_VERSION_STATES,
  ServiceCatalogRuleError,
  assertEffectiveRange,
  assertVersionEditable,
  type ActivationState,
  type ServiceLifecycleState,
  type ServiceVersionState,
} from './domain/service-catalog';

/**
 * Composition root: constructs the module's services once per process.
 *
 * Reads and writes are two services over ONE repository, not two repositories. The
 * split is by authority — `svc.service.read` versus `svc.service.manage`, and a
 * write additionally requires that grant to be tenant-wide — while the SQL for a
 * table belongs in one place, because two files writing `svc.services` is how a
 * tenant predicate ends up on one query and not the other.
 */
export const serviceCatalogModule = composeModule({
  module: 'service-catalog',
  create: () => {
    const repository = new ServiceCatalogRepository();
    return {
      services: new ServiceCatalogService(repository),
      catalogWrites: new ServiceCatalogWriteService(repository),
    };
  },
});
