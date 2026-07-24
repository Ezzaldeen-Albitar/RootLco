/**
 * `vehicle` module — public surface (Phase 1-17).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/vehicle/<anything>`. It exports behaviour
 * (composed services) and types/contract constants — never repositories, pools,
 * or SQL.
 *
 * The vehicle module composes the frozen `veh` database (Phase 1-7, consumed
 * unchanged) and the shared backend foundation (Phases 1-13/14/15). VIN
 * normalization is borrowed from the shared-services module through its public
 * surface (`@/modules/shared-services`) — vehicle does not own a VIN normalizer,
 * and re-implementing one would give the platform two ways to normalize a VIN that
 * could drift apart.
 */
import { composeModule } from '@/server/layering';
import { VehicleSearchRepository } from './data/vehicle-search-repository';
import { VehicleSearchService } from './application/vehicle-search-service';

export type { VehicleSearchHit, VehicleSearchInput } from './application/vehicle-search-service';
export {
  MAX_PLATE_FRAGMENT,
  MAX_VIN_FRAGMENT,
  POWERTRAIN_CATEGORIES,
  VEHICLE_LIFECYCLE_STATUSES,
  WORKSHOP_STATUSES,
  type PowertrainCategory,
  type VehicleLifecycleStatus,
  type WorkshopStatus,
} from './domain/vehicle-search';

/** Composition root: constructs the module's services once per process. */
export const vehicleModule = composeModule({
  module: 'vehicle',
  create: () => ({
    vehicleSearch: new VehicleSearchService(new VehicleSearchRepository()),
  }),
});
