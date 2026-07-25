/**
 * Vehicle search — application service (Phase 1-17, FR-VEH-001).
 *
 * The use case, one call deep: normalise the VIN through the shared normalizer
 * (there is no second VIN normalization implementation — `veh.normalize_vin`
 * parity is owned by `@/modules/shared-services`), turn edge-validated inputs into
 * the closed domain filter, resolve the page request against the frozen ordering
 * contract, and ask the repository. It opens no transaction (a read runs on the
 * pipeline-provided read handle), and the operation's permission
 * (`veh.vehicle.read`) was already enforced by the request pipeline before this
 * method runs.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import { normalizeVin } from '@/modules/shared-services';
import {
  VEHICLE_SEARCH_ORDERING,
  toVehicleSearchFilter,
  type VehicleSearchHit,
  type VehicleSearchInput,
} from '../domain/vehicle-search';
import type { VehicleSearchRepository } from '../data/vehicle-search-repository';

export type { VehicleSearchHit, VehicleSearchInput } from '../domain/vehicle-search';

export class VehicleSearchService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly vehicles: VehicleSearchRepository) {
    super();
  }

  async search(
    db: DbHandle,
    input: VehicleSearchInput,
    pageInput: { cursor?: string | undefined; limit?: number | undefined }
  ): Promise<Page<VehicleSearchHit>> {
    // Reuse the shared VIN normalizer, which mirrors veh.normalize_vin exactly.
    const vinNormalized = input.vin !== undefined ? normalizeVin(input.vin).normalized : null;
    const filter = toVehicleSearchFilter(input, vinNormalized);
    const page = pageRequest(VEHICLE_SEARCH_ORDERING, pageInput);
    return this.vehicles.search(db, page, filter);
  }
}
