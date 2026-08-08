/**
 * Vehicle history and document reachability — application service (Phase 1-17,
 * P1-17-BE-011, P1-17-BE-012).
 *
 * Both are reads. The attribute-change history is a keyset page of the append-only
 * ledger. The document list returns only the ids of documents reachable from the
 * vehicle through live shared links — no storage key, no bytes; linking itself is
 * the shared attachments operation, not this module's.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { VehicleHistoryRepository } from '../data/vehicle-history-repository';
import {
  VEHICLE_DOCUMENT_ENTITY_TYPE,
  VEHICLE_HISTORY_ORDERING,
  type VehicleHistoryHit,
} from '../domain/vehicle-history';
import { nameActors, type WithActor } from './actor-identity';

export interface VehicleDocuments {
  readonly vehicleId: string;
  /** Ids of documents reachable from this vehicle. No storage key, no bytes. */
  readonly documentIds: readonly string[];
}

type PageInput = { cursor?: string | undefined; limit?: number | undefined };

export class VehicleHistoryService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly history: VehicleHistoryRepository) {
    super();
  }

  /**
   * The attribute-change ledger, each row attributed to a **named** person
   * (`P1-27-INT-026`).
   *
   * The repository publishes `actor_id` and nothing else, so the history screen
   * printed a uuid under a column headed "who". `nameActors` resolves the whole
   * page through the IAM module's provider-free public surface in one statement;
   * see that file for why the join is not written here, why `iamDirectory()` is
   * used rather than `iamModule()`, and why an unresolvable actor is a sentence
   * rather than a failure.
   */
  async listHistory(
    db: DbHandle,
    vehicleId: string,
    page: PageInput
  ): Promise<Page<WithActor<VehicleHistoryHit>>> {
    return nameActors(
      db,
      await this.history.listHistory(db, vehicleId, pageRequest(VEHICLE_HISTORY_ORDERING, page))
    );
  }

  async listDocuments(db: DbHandle, vehicleId: string): Promise<VehicleDocuments> {
    // A clean 404 for an unknown or cross-tenant vehicle, rather than an empty list
    // that cannot be told apart from "linked to nothing".
    if (!(await this.history.vehicleExists(db, vehicleId))) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    const documentIds = await this.history.linkedDocumentIds(
      db,
      vehicleId,
      VEHICLE_DOCUMENT_ENTITY_TYPE
    );
    return { vehicleId, documentIds };
  }
}
