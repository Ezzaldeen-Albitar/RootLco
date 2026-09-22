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
import type {
  VehicleDetailRow,
  VehicleDisplayIdentity,
  VehicleReadRepository,
} from '../data/vehicle-read-repository';

export type { VehicleDetailRow, VehicleDisplayIdentity } from '../data/vehicle-read-repository';

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

  /**
   * How a set of cars is NAMED, for a module that holds vehicle ids and must not
   * print them (Owner directive, P1-32-PRE-OD-UX).
   *
   * Exposed on the module's PUBLIC surface so another module composes it rather
   * than joining `veh.vehicles` and `veh.plate_history` with its own SQL — the
   * precedent is `crmModule().customerRead.resolveDisplayIdentities`, which exists
   * for exactly the same reason one boundary over.
   *
   * Unlike `read` this does NOT throw for an id it cannot resolve: a row may
   * reference a vehicle that is soft-deleted or outside this caller's reach, and
   * that is a sentence for the screen to say rather than a request to fail.
   *
   * ## It narrows, and never widens
   *
   * The calling operations are gated on their OWN codes — `wty.warranty.read`, for
   * instance — not on `veh.vehicle.read`. So the registration is withheld from a
   * caller who does not hold the vehicle code: `plate` and `vin` come back null
   * and the statement does not read them at all.
   *
   * Both fields move TOGETHER and on that one code, because that is the rule
   * `veh.vehicle-search` already applies — it publishes `activePlate` and the
   * normalised `vin` side by side to every holder of `veh.vehicle.read`, with no
   * further narrowing between them. Splitting them here would give one tenant two
   * different answers about the same car on two screens.
   *
   * `makeModel` and `displayNumber` are NOT withheld, and that is a decision
   * rather than an omission. Neither is a registered identifier: the display
   * number is the tenant's own reference for a car it already let this caller
   * reach, and the make and model are catalogue labels. The shipped boards answer
   * the same way — `apt.appointment-list` and `rec.reception-list` both publish the
   * vehicle's display number to their own readers with no vehicle-side check — and
   * a row that named a car only by uuid is the defect these fields exist to
   * remove.
   *
   * One extra statement per page, plus the capability question, and only when
   * there is something to resolve.
   */
  async resolveDisplayIdentities(
    db: DbHandle,
    vehicleIds: readonly string[]
  ): Promise<ReadonlyMap<string, VehicleDisplayIdentity>> {
    if (vehicleIds.length === 0) return new Map();
    // Asked ONCE per call, not once per row: it is a property of the caller, and
    // it decides what the statement below reads.
    const mayReadPlateAndVin = await this.vehicles.mayReadVehicles(db);
    return this.vehicles.findDisplayIdentities(db, vehicleIds, mayReadPlateAndVin);
  }
}
