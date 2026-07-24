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
import { VehicleWriteRepository } from './data/vehicle-write-repository';
import { VehicleWriteService } from './application/vehicle-write-service';
import { VehicleIdentityRepository } from './data/vehicle-identity-repository';
import { VehicleIdentityService } from './application/vehicle-identity-service';
import { VehicleRegistrationRepository } from './data/vehicle-registration-repository';
import { VehicleRegistrationService } from './application/vehicle-registration-service';
import { VehicleRelationsRepository } from './data/vehicle-relations-repository';
import { VehicleRelationsService } from './application/vehicle-relations-service';

export type { VehicleSearchHit, VehicleSearchInput } from './application/vehicle-search-service';
export type { CreatedVehicle, UpdatedVehicle } from './application/vehicle-write-service';
export type { MergeResult, ScanResult, ReviewResult } from './application/vehicle-identity-service';
export type {
  PlateAssigned,
  OwnershipTransferred,
} from './application/vehicle-registration-service';
export type { AuthorizedPartyResult } from './application/vehicle-relations-service';
export {
  AUTHORIZED_ACTIONS,
  VEHICLE_RELATIONSHIP_ROLES,
  type AuthorizedAction,
  type VehicleRelationshipRole,
} from './domain/vehicle-relations';
export type { VehicleCreateInput, VehicleUpdateInput } from './domain/vehicle-write';
export {
  DUPLICATE_DECISIONS,
  MAX_APPROVAL_REF,
  MAX_REASON,
  MIN_REASON,
  type DuplicateDecision,
} from './domain/vehicle-identity';
export {
  MAX_PLATE_RAW,
  MAX_TRANSFER_REASON,
  OWNERSHIP_KINDS,
  type OwnershipKind,
} from './domain/vehicle-registration';
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
export {
  MAX_COLOR,
  MAX_DISPLAY_NUMBER,
  MAX_VIN_INPUT,
  MODEL_YEAR_MAX,
  MODEL_YEAR_MIN,
} from './domain/vehicle-write';

/** Composition root: constructs the module's services once per process. */
export const vehicleModule = composeModule({
  module: 'vehicle',
  create: () => ({
    vehicleSearch: new VehicleSearchService(new VehicleSearchRepository()),
    vehicleWrite: new VehicleWriteService(new VehicleWriteRepository()),
    vehicleIdentity: new VehicleIdentityService(new VehicleIdentityRepository()),
    vehicleRegistration: new VehicleRegistrationService(new VehicleRegistrationRepository()),
    vehicleRelations: new VehicleRelationsService(new VehicleRelationsRepository()),
  }),
});
