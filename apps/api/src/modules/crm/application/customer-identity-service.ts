/**
 * CRM duplicate detection, merge, history, timeline, and vehicle linkage —
 * application service (Phase 1-16, FR-CRM-003, FR-VEH-003, P1-16-BE-013…018).
 *
 * ## No path from a score to a merge
 *
 * Scanning produces candidates. A person reviews them. A merge is a third,
 * separately-permissioned operation that requires an approval reference. Three
 * steps, three decisions, and the machine makes none of them — because a merge
 * is irreversible in practice: the duplicate is redirected and read-only
 * afterwards, and no amount of regret un-merges two customers' histories.
 *
 * ## The merged customer is redirected, never deleted
 *
 * `merged_into_id` points at the survivor and the source row stays. A work
 * order raised against the duplicate three years ago still resolves to a real
 * customer, and the merge record itself is INSERT-only evidence of who decided
 * and under what approval.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import {
  DUPLICATE_CANDIDATE_ORDERING,
  TIMELINE_ORDERING,
  type CustomerIdentityRepository,
  type DuplicateCandidateEntry,
  type HistoryEntry,
  type ScoreInput,
  type TimelineEntry,
} from '../data/customer-identity-repository';
import {
  CANDIDATE_THRESHOLD,
  CustomerIdentityError,
  MATCH_SIGNALS,
  assertMergeable,
  orderPair,
  scorePair,
  type MatchSignalHit,
  type VehicleRelationshipRole,
} from '../domain/customer-identity';

export interface ScanResult {
  readonly customerId: string;
  readonly compared: number;
  readonly candidates: readonly { candidateId: string; otherId: string; score: number }[];
}

export interface ReviewResult {
  readonly candidateId: string;
  readonly status: string;
}

export interface MergeResult {
  readonly mergeId: string;
  readonly sourceId: string;
  readonly survivorId: string;
}

export interface VehicleLinkResult {
  readonly id: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly relationshipRole: string;
}

export class CustomerIdentityService extends ApplicationService {
  protected readonly module = 'crm';

  constructor(private readonly identity: CustomerIdentityRepository) {
    super();
  }

  /**
   * Scores this customer against comparable ones and records the candidates.
   *
   * Deterministic: the same data always yields the same score and the same
   * `match_basis`, so two runs a week apart are comparable and a reviewer can
   * see exactly which signals fired.
   */
  async scanForDuplicates(db: DbHandle, customerId: string): Promise<ScanResult> {
    const profile = await this.requireProfile(db, customerId);
    const others = await this.identity.findComparablePartners(db, customerId, profile);

    const candidates: { candidateId: string; otherId: string; score: number }[] = [];
    for (const other of others) {
      const hits = compareProfiles(profile, other.profile);
      const score = scorePair(hits);
      if (score < CANDIDATE_THRESHOLD) continue;

      const pair = orderPair(customerId, other.id);
      const recorded = await this.identity.upsertCandidate(db, pair, score, hits);
      candidates.push({ candidateId: recorded.id, otherId: other.id, score });
    }

    // A scan is a read that leaves a trail: it tells a later reader why a
    // candidate exists and who caused it to be evaluated.
    await appendAudit(db, {
      action: 'crm.customer.duplicates_scanned',
      entityType: 'crm.business_partner',
      entityId: customerId,
      details: [
        { field: 'compared', classification: 'public', value: String(others.length) },
        { field: 'candidates', classification: 'public', value: String(candidates.length) },
      ],
    });

    return { customerId, compared: others.length, candidates };
  }

  /**
   * Records a human decision on a candidate.
   *
   * Only `dismissed` is recordable. `merged` is set by the merge operation, so a
   * reviewer cannot mark a pair merged without one actually happening — which
   * would leave two live duplicates that the system believes were reconciled.
   */
  async reviewCandidate(
    db: DbHandle,
    candidateId: string,
    input: { decision: 'dismissed'; reason: string }
  ): Promise<ReviewResult> {
    const candidate = await this.identity.findCandidate(db, candidateId);
    if (!candidate) {
      throw new AppFailure('ERR-RES-001', { message: 'Duplicate candidate was not found' });
    }
    if (candidate.status !== 'open') {
      throw new AppFailure('ERR-RES-002', {
        message: `Candidate has already been ${candidate.status}`,
      });
    }

    const changed = await this.identity.reviewCandidate(db, candidateId, input.decision);
    if (changed === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The candidate was reviewed by someone else while this request was in flight',
      });
    }

    await appendAudit(db, {
      action: 'crm.customer.duplicate_reviewed',
      entityType: 'crm.duplicate_candidate',
      entityId: candidateId,
      details: [
        { field: 'status', classification: 'public', previousValue: 'open', value: input.decision },
        { field: 'reason', classification: 'internal', value: input.reason },
      ],
    });

    return { candidateId, status: input.decision };
  }

  /**
   * Merges `sourceId` into `survivorId` in one transaction.
   *
   * Order is dictated by the database: `crm.guard_business_partner_merge()`
   * validates the survivor is live and not itself merged, and refuses any update
   * to an already-merged partner. Recording the merge first means the evidence
   * exists before the state it explains.
   */
  async mergeCustomers(
    db: DbHandle,
    sourceId: string,
    input: { survivorId: string; approvalRef: string }
  ): Promise<MergeResult> {
    this.orFail(() => assertMergeable(sourceId, input.survivorId));

    const source = await this.identity.partnerState(db, sourceId);
    if (!source) {
      throw new AppFailure('ERR-RES-001', { message: 'Customer was not found' });
    }
    if (source.mergedIntoId !== null) {
      // Replay-safe: a second merge attempt on an already-merged customer is a
      // stable refusal, not a partial second merge.
      throw new AppFailure('ERR-RES-002', { message: 'Customer has already been merged' });
    }

    const survivor = await this.identity.partnerState(db, input.survivorId);
    if (!survivor) {
      // Same 404 as an unknown id: a cross-tenant survivor must not be
      // distinguishable from one that does not exist.
      throw new AppFailure('ERR-RES-001', { message: 'Survivor customer was not found' });
    }
    if (survivor.mergedIntoId !== null) {
      throw new AppFailure('ERR-RES-002', {
        message: 'The survivor is itself merged; merge into the surviving record instead',
      });
    }

    const mergeId = await this.identity.insertMerge(db, {
      sourceId,
      survivorId: input.survivorId,
      approvalRef: input.approvalRef,
      summary: { sourceLifecycle: source.lifecycleStatus },
    });
    if (!mergeId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Merge record was refused by policy' });
    }

    const redirected = await this.identity.redirectPartner(
      db,
      sourceId,
      input.survivorId,
      source.recordVersion
    );
    if (redirected === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The customer changed while this merge was in flight; retry',
      });
    }

    await appendAudit(db, {
      action: 'crm.customer.merged',
      entityType: 'crm.business_partner',
      entityId: sourceId,
      details: [
        { field: 'survivor_partner_id', classification: 'internal', value: input.survivorId },
        { field: 'approval_ref', classification: 'internal', value: input.approvalRef },
        {
          field: 'lifecycle_status',
          classification: 'public',
          previousValue: source.lifecycleStatus,
          value: 'merged',
        },
      ],
    });

    await publishEvent(db, {
      eventType: 'business-partner.merged',
      // The survivor is the aggregate: it is the record that continues to exist,
      // and it is what a consumer must re-read.
      aggregateId: input.survivorId,
      aggregateVersion: 1,
      producer: 'crm.customer-identity-service',
      payload: { survivorId: input.survivorId, sourceId, mergeId },
      eventKey: `business-partner.merged:${mergeId}`,
    });

    return { mergeId, sourceId, survivorId: input.survivorId };
  }

  /**
   * Reads the customer's governance history.
   *
   * Resolves through `partnerState` rather than the scoring profile, so a
   * **merged** customer is still readable. That is deliberate and it matters:
   * the moment you most need a duplicate's history is after it has been merged
   * away, when somebody is reconstructing what happened to it. The record is
   * retained precisely so it can be read.
   */
  async history(db: DbHandle, customerId: string, limit: number): Promise<readonly HistoryEntry[]> {
    await this.requireReadableCustomer(db, customerId);
    return this.identity.history(db, customerId, limit);
  }

  async timeline(
    db: DbHandle,
    customerId: string,
    pageInput: { cursor?: string | undefined; limit?: number | undefined }
  ): Promise<Page<TimelineEntry>> {
    // Same reasoning as `history`: a merged customer's timeline is still its
    // timeline, and hiding it would lose the record of how it got there.
    await this.requireReadableCustomer(db, customerId);
    return this.identity.timeline(db, customerId, pageRequest(TIMELINE_ORDERING, pageInput));
  }

  /**
   * The tenant's duplicate-candidate queue.
   *
   * No parent to resolve: this is a tenant-wide queue, not a sub-resource of one
   * customer, and RLS plus the explicit `tenant_id` predicate are what scope it.
   * A caller who supplies a `status` filters the queue; one who does not sees
   * every candidate including the dismissed and merged ones, because a reviewer
   * auditing past decisions needs to see them.
   */
  async listCandidates(
    db: DbHandle,
    input: {
      status?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    }
  ): Promise<Page<DuplicateCandidateEntry>> {
    return this.identity.listCandidates(
      db,
      pageRequest(DUPLICATE_CANDIDATE_ORDERING, input),
      input.status ?? null
    );
  }

  /**
   * Links a customer to a vehicle in a role.
   *
   * Both sides are resolved under the caller's tenant before anything is
   * written, so a relationship can never span two tenants — the composite FKs
   * would refuse it anyway, but a 404 is the honest answer and it does not
   * reveal that the id exists elsewhere.
   */
  async linkVehicle(
    db: DbHandle,
    customerId: string,
    input: { vehicleId: string; relationshipRole: VehicleRelationshipRole }
  ): Promise<VehicleLinkResult> {
    await this.requireProfile(db, customerId);
    const vehicle = await this.identity.findVehicle(db, input.vehicleId);
    if (!vehicle) {
      throw new AppFailure('ERR-RES-001', { message: 'Vehicle was not found' });
    }

    const existing = await this.identity.findOpenRelationship(
      db,
      customerId,
      input.vehicleId,
      input.relationshipRole
    );
    if (existing) {
      throw new AppFailure('ERR-RES-002', {
        message: 'This customer already holds that role for this vehicle',
      });
    }

    const id = await this.identity.insertRelationship(
      db,
      customerId,
      input.vehicleId,
      input.relationshipRole
    );
    if (!id) {
      throw new AppFailure('ERR-IAM-001', { message: 'Relationship was refused by policy' });
    }

    await appendAudit(db, {
      action: 'crm.customer.vehicle_linked',
      entityType: 'veh.vehicle_relationship',
      entityId: id,
      details: [
        { field: 'partner_id', classification: 'internal', value: customerId },
        { field: 'vehicle_id', classification: 'internal', value: input.vehicleId },
        { field: 'relationship_role', classification: 'public', value: input.relationshipRole },
      ],
    });

    return {
      id,
      customerId,
      vehicleId: input.vehicleId,
      relationshipRole: input.relationshipRole,
    };
  }

  /**
   * Resolves a customer that may be read, including a merged one.
   *
   * Still tenant-scoped and still excludes soft-deleted rows, so this is not a
   * weaker check — it is the *right* check for a read: a merged customer exists
   * and its record is retained on purpose.
   */
  private async requireReadableCustomer(db: DbHandle, customerId: string): Promise<void> {
    const state = await this.identity.partnerState(db, customerId);
    if (!state) {
      throw new AppFailure('ERR-RES-001', { message: 'Customer was not found' });
    }
  }

  private async requireProfile(db: DbHandle, customerId: string): Promise<ScoreInput> {
    const profile = await this.identity.loadScoringProfile(db, customerId);
    if (!profile) {
      throw new AppFailure('ERR-RES-001', { message: 'Customer was not found' });
    }
    return profile;
  }

  private orFail<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof CustomerIdentityError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: error.path, rule: error.rule }] },
        });
      }
      throw error;
    }
  }
}

/** Pure comparison: which signals fire between two profiles. */
function compareProfiles(left: ScoreInput, right: ScoreInput): readonly MatchSignalHit[] {
  const hits: MatchSignalHit[] = [];
  if (normalize(left.displayName) === normalize(right.displayName)) {
    hits.push({ signal: 'normalized_name', weight: MATCH_SIGNALS.normalized_name });
  }
  if (left.contactValues.some((value) => right.contactValues.includes(value))) {
    hits.push({ signal: 'contact_value', weight: MATCH_SIGNALS.contact_value });
  }
  if (left.addressLines.some((line) => right.addressLines.includes(line))) {
    hits.push({ signal: 'address_line', weight: MATCH_SIGNALS.address_line });
  }
  return hits;
}

/** Mirrors `crm.normalize_name` closely enough for an equality comparison. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
