/**
 * Vehicle relations — authorized parties and vehicle-centric relationship reads
 * (Phase 1-17, P1-17-BE-008, P1-17-BE-009).
 *
 * The vehicle module owns the *authorized-party* writer (an `authorized_person`
 * relationship with a bounded scope) — a fact CRM does not write — and exposes a
 * vehicle-centric read of the whole `veh.vehicle_relationships` table. It never
 * duplicates CRM's plain-link writer, and the overlap EXCLUDE means the two
 * modules can never create conflicting active relationships. An authorized party is
 * never treated as the legal owner.
 */
import { ApplicationService } from '@/server/layering';
// Cross-module composition through the PUBLIC surface, not a cross-schema join.
// `crm` imports nothing from `vehicle`, so there is no cycle; the reception
// module composes shared-services the same way.
import { crmModule } from '@/modules/crm';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, sqlState, SQLSTATE } from '@/server/db/repository';
import type {
  RelationshipHit,
  VehicleRelationsRepository,
} from '../data/vehicle-relations-repository';
import {
  RELATIONSHIP_ORDERING,
  VehicleRelationsError,
  normalizeEffectiveDate,
  toAuthorizedPartyPlan,
  type AuthorizedPartyInput,
} from '../domain/vehicle-relations';

export interface AuthorizedPartyResult {
  readonly vehicleId: string;
  readonly relationshipId: string;
}

type PageInput = { cursor?: string | undefined; limit?: number | undefined };

export class VehicleRelationsService extends ApplicationService {
  protected readonly module = 'vehicle';

  constructor(private readonly relations: VehicleRelationsRepository) {
    super();
  }

  async addAuthorizedParty(
    db: DbHandle,
    vehicleId: string,
    input: AuthorizedPartyInput
  ): Promise<AuthorizedPartyResult> {
    const plan = this.planOrFail(() => toAuthorizedPartyPlan(input));
    await this.requireWritableVehicle(db, vehicleId);

    let relationshipId: string | null;
    try {
      relationshipId = await this.relations.insertAuthorizedParty(db, { vehicleId, ...plan });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The customer was not found in this tenant',
          safeDetails: { violations: [{ path: 'body.partnerId', rule: 'unknown_reference' }] },
        });
      }
      if (sqlState(error) === '23P01') {
        throw new AppFailure('ERR-RES-002', {
          message: 'That customer is already an authorized party for this vehicle',
        });
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-VAL-001', { message: 'The authorization scope is not valid' });
      }
      throw error;
    }
    if (!relationshipId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Authorization was refused by policy' });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.authorized_party_added',
      entityType: 'veh.vehicle_relationship',
      entityId: relationshipId,
      details: [
        { field: 'vehicle_id', classification: 'internal', value: vehicleId },
        { field: 'partner_id', classification: 'internal', value: plan.partnerId },
        {
          field: 'allowed_actions',
          classification: 'public',
          value: plan.allowedActions.join(','),
        },
      ],
    });

    await publishEvent(db, {
      eventType: 'vehicle.relationship.changed',
      aggregateId: vehicleId,
      aggregateVersion: 1,
      producer: 'veh.vehicle-relations-service',
      payload: { vehicleId, changeKind: 'authorized_party_added' },
      eventKey: `vehicle.relationship.changed:authorized-add:${relationshipId}`,
    });

    return { vehicleId, relationshipId };
  }

  async retireAuthorizedParty(
    db: DbHandle,
    vehicleId: string,
    relationshipId: string,
    input: { effectiveDate?: string | null | undefined }
  ): Promise<AuthorizedPartyResult> {
    const effectiveDate = this.planOrFail(() => normalizeEffectiveDate(input.effectiveDate));

    const existing = await this.relations.findOpenAuthorizedParty(db, vehicleId, relationshipId);
    if (!existing) {
      throw new AppFailure('ERR-RES-001', { message: 'Authorized party was not found' });
    }

    let closed: number;
    try {
      closed = await this.relations.closeRelationship(db, relationshipId, effectiveDate);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The effective date must be after the authorization start',
          safeDetails: { violations: [{ path: 'body.effectiveDate', rule: 'out_of_range' }] },
        });
      }
      throw error;
    }
    if (closed === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The authorized party changed while this request was in flight; retry',
      });
    }

    await appendAudit(db, {
      action: 'veh.vehicle.authorized_party_retired',
      entityType: 'veh.vehicle_relationship',
      entityId: relationshipId,
      details: [{ field: 'vehicle_id', classification: 'internal', value: vehicleId }],
    });

    await publishEvent(db, {
      eventType: 'vehicle.relationship.changed',
      aggregateId: vehicleId,
      aggregateVersion: 1,
      producer: 'veh.vehicle-relations-service',
      payload: { vehicleId, changeKind: 'authorized_party_retired' },
      eventKey: `vehicle.relationship.changed:authorized-retire:${relationshipId}`,
    });

    return { vehicleId, relationshipId };
  }

  /**
   * A vehicle's parties, each named (`P1-27-INT-025`).
   *
   * ## Why the name is resolved here and not in the repository
   *
   * The read publishes `partner_id` and nothing else, so the relationships screen
   * rendered a uuid under a column headed with a person's name — against the
   * standing rule that no uuid is a normal label.
   *
   * The name lives in `crm.business_partners`. **No `veh` repository touches a
   * CRM table**, and adding the first cross-schema join inside a bug fix would
   * set a precedent that outlives the fix. So the vehicle module composes the CRM
   * module's PUBLIC surface instead — the same shape as the reception module
   * composing shared-services for its numbering. Modules talk through their
   * published services; schemas stay owned.
   *
   * ## One extra statement, not one per row
   *
   * `resolveDisplayIdentities` takes the whole page's ids at once. Resolving them
   * singly would be an N+1 against a bucket sized for one read per page.
   *
   * ## An unresolved partner is a sentence, not a failure
   *
   * A relationship may reference a partner this caller cannot see — soft-deleted,
   * merged away, or outside their scope. That id is simply absent from the map
   * and `partnerName` comes back `null`, which the screen renders as words. The
   * alternative — failing the whole list, or falling back to the uuid — either
   * hides six good rows because of one, or reintroduces the defect.
   */
  async listRelationships(
    db: DbHandle,
    vehicleId: string,
    page: PageInput
  ): Promise<Page<RelationshipHit>> {
    const result = await this.relations.listRelationships(
      db,
      vehicleId,
      pageRequest(RELATIONSHIP_ORDERING, page)
    );

    const identities = await crmModule().customerRead.resolveDisplayIdentities(
      db,
      result.items.map((item) => item.partnerId)
    );

    return {
      ...result,
      items: result.items.map((item) => {
        const identity = identities.get(item.partnerId);
        return {
          ...item,
          partnerName: identity?.displayName ?? null,
          partnerNumber: identity?.displayNumber ?? null,
          partnerType: identity?.partyType ?? null,
        };
      }),
    };
  }

  private async requireWritableVehicle(db: DbHandle, vehicleId: string): Promise<void> {
    const state = await this.relations.vehicleState(db, vehicleId);
    if (!state) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }
    if (state.lifecycleStatus === 'merged' || state.lifecycleStatus === 'scrapped') {
      throw new AppFailure('ERR-RES-002', {
        message: `Vehicle is ${state.lifecycleStatus} and cannot take a new authorized party`,
      });
    }
  }

  private planOrFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof VehicleRelationsError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}
