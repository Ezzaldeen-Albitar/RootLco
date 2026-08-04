/**
 * Vehicle detail READ service (P1-17 remediation, `P1-27-INT-002`).
 *
 * One use case, one call deep: resolve the vehicle under the caller's tenant or
 * answer `ERR-RES-001`. An unknown id, a soft-deleted vehicle and a vehicle in
 * another tenant all produce the identical 404, so the operation cannot be used
 * to test whether an id exists somewhere else.
 *
 * It opens no transaction — a read runs on the pipeline's read handle — and the
 * operation's permission (`veh.vehicle.read`) was already enforced by the request
 * pipeline before this method runs.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { VehicleDetailRow, VehicleReadRepository } from '../data/vehicle-read-repository';

export type { VehicleDetailRow } from '../data/vehicle-read-repository';

export class VehicleReadService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly vehicles: VehicleReadRepository) {
    super();
  }

  async read(db: DbHandle, vehicleId: string): Promise<VehicleDetailRow> {
    const vehicle = await this.vehicles.findVehicleDetail(db, vehicleId);
    if (!vehicle) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    return vehicle;
  }
}
