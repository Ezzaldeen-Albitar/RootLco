/**
 * Inventory stock mutations (Phase 1-21, P1-21-BE-004…008, BE-012, BE-013, BE-015).
 *
 * Every method here runs inside the route handler's transaction, so the business
 * row, its audit record, and its outbox event share one commit. There is no
 * publish-after-commit path — that is precisely the window where a crash loses the
 * event.
 *
 * ## Where the guarantees live
 *
 * Negative stock, single-winner reservation, movement provenance, and the
 * return ceiling are all enforced by the protected `inv` schema — CHECK
 * constraints, the balance coherence guard, and the `FOR UPDATE` balance lock. This
 * service does **not** re-implement them, and deliberately never reads availability
 * and then writes based on the read: that is the race the lock exists to prevent.
 *
 * What it does own are the two rules the protected functions demonstrably do not
 * enforce (`P1-21-D-02` and `D-03`, each reproduced against a live database and
 * recorded in `docs/phase-1/phase-1-21/wave-1-contract-archaeology.md`): the
 * work-order lifecycle and reservation↔issue coherence. The third, the order in which
 * an issue releases its reservation (`D-01`), was fixed in `inv.issue_part` itself by
 * `20260917099000`. Since the same migration every reservation and issue for a work
 * order draws on an approved material requirement (P1-32-PRE-132), through
 * `MaterialDrawGovernor`.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type { InventoryRepository, StockLocationRow } from '../data/inventory-repository';
import { parseQuantity, refuseInventoryState, toDomainFailure } from './inventory-failures';
import { MaterialDrawGovernor } from './inventory-material-service';
import {
  Quantity,
  assertLegalMovementReference,
  assertQuarantineDestination,
  assertReservationMatchesIssue,
  assertWorkOrderAcceptsParts,
} from '../domain/inventory';

export interface ReservationView {
  readonly id: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: string;
  readonly expiresAt: string | null;
  readonly recordVersion: number;
  /**
   * The material request this reservation fulfills, when the draw was governed by a
   * material requirement; null for an ungoverned reservation.
   */
  readonly materialRequestId: string | null;
  /** True when an idempotent replay returned the reservation that already existed. */
  readonly replayed: boolean;
}

export interface IssueView {
  readonly id: string;
  readonly movementId: string;
  readonly workOrderId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly quantity: string;
  readonly reservationId: string | null;
  /** The material request the issue fulfilled; null for an ungoverned issue. */
  readonly materialRequestId: string | null;
}

export interface ReturnView {
  readonly id: string;
  readonly partIssueId: string;
  readonly quantity: string;
  readonly totalReturned: string;
  readonly issuedQuantity: string;
}

export interface DamageView {
  readonly id: string;
  readonly itemId: string;
  readonly fromLocationId: string;
  readonly quarantineLocationId: string;
  readonly quantity: string;
  readonly disposition: string;
}

export class InventoryStockService {
  private readonly governor: MaterialDrawGovernor;

  public constructor(private readonly repository: InventoryRepository) {
    this.governor = new MaterialDrawGovernor(repository);
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-004 / BE-013 — reservation and concurrent-reservation protection.
  // -------------------------------------------------------------------------

  /**
   * Reserves stock for a work order.
   *
   * The availability check is **not** performed here. `inv.reserve_stock` takes the
   * balance-row lock, expires stale reservations for the cell, re-reads `on_hand`
   * and the active-reservation sum inside that lock, and raises `23514` when the
   * request exceeds what is available. Checking first in application code would add
   * a read-then-write race and change nothing about the outcome.
   *
   * A work order, when named, must exist in the location's scope and be accepting
   * parts. `inv.stock_reservations.work_order_id` is nullable and the protected
   * function does not validate the state, so both checks are made here.
   */
  public async reserve(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly workOrderId?: string;
      readonly idempotencyKey?: string;
      readonly expiresAt?: string;
      readonly materialRequirementId?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<ReservationView> {
    const quantity = parseQuantity(input.quantity);
    const location = await this.requireSellableLocation(db, input.locationId);
    await authorizeScope({ companyId: location.companyId, branchId: location.branchId });
    await this.requireStockTrackedItem(db, input.itemId);

    if (input.materialRequirementId !== undefined && input.workOrderId === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A material requirement governs a draw for a work order; name the work order',
        safeDetails: { violations: [{ path: 'body.workOrderId', rule: 'required' }] },
      });
    }
    // P1-32-PRE-132: EVERY reservation for a work order is a draw on its approved
    // demand; one with no requirement covering the item is refused.
    let requirementId: string | null = null;
    if (input.workOrderId !== undefined) {
      await this.requireWorkOrderAcceptingParts(db, input.workOrderId, location);
      requirementId = await this.governor.resolve(db, {
        workOrderId: input.workOrderId,
        itemId: input.itemId,
        materialRequirementId: input.materialRequirementId,
      });
    }

    /**
     * A replay is detected BEFORE the call, not inferred after it.
     *
     * `inv.reserve_stock` resolves an existing key inside the balance lock and
     * returns the reservation that already exists — correct, but from the outside
     * indistinguishable from a fresh booking, so a retrying client could not tell
     * whether it had reserved stock twice. Looking the key up first makes the
     * difference reportable, and makes a same-key/different-quantity request a
     * conflict rather than a silent success under someone else's booking.
     */
    const existing =
      input.idempotencyKey === undefined
        ? null
        : await this.repository.readReservationByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      if (!Quantity.fromDatabase(existing.quantity, 'quantity').equals(quantity)) {
        throw new AppFailure('ERR-INT-001', {
          message:
            'This idempotency key already reserved a different quantity. Reuse a key only for ' +
            'an identical request.',
        });
      }
      if (existing.itemId !== input.itemId || existing.locationId !== input.locationId) {
        throw new AppFailure('ERR-INT-001', {
          message:
            'This idempotency key already reserved a different item or location. Reuse a key ' +
            'only for an identical request.',
        });
      }
      const link = await this.repository.readMaterialLinkForReservation(db, existing.id);
      return this.toReservationView(existing, true, link?.requestId ?? null);
    }

    // A work-order reservation is a draw on its approved demand: the database opens a
    // material request on the requirement and reserves against it under the
    // requirement lock, and refuses anything the allowance does not cover. Nothing
    // is reserved and no request remains when it refuses.
    let reservationId: string;
    let materialRequestId: string | null = null;
    if (requirementId !== null) {
      const drawn = await this.governor.draw(
        db,
        { requirementId, itemId: input.itemId, quantity: quantity.toString() },
        (nested, requestId) =>
          this.repository.reserveMaterialRequest(nested, {
            requestId,
            locationId: input.locationId,
            quantity: quantity.toString(),
            idempotencyKey: input.idempotencyKey ?? null,
            expiresAt: input.expiresAt ?? null,
          }),
        'Reservation'
      );
      reservationId = drawn.result.id;
      materialRequestId = drawn.requestId;
    } else {
      try {
        const created = await this.repository.reserveStock(db, {
          itemId: input.itemId,
          locationId: input.locationId,
          quantity: quantity.toString(),
          idempotencyKey: input.idempotencyKey ?? null,
          expiresAt: input.expiresAt ?? null,
          correlationId: db.context.correlationId,
        });
        reservationId = created.id;
      } catch (error) {
        toDomainFailure(error, 'Reservation');
      }
    }

    const reservation = await this.repository.readReservation(db, reservationId);
    if (!reservation) {
      throw new AppFailure('ERR-SYS-001', { message: 'Reservation vanished after creation' });
    }

    await appendAudit(db, {
      action: 'inv.stock.reserved',
      entityType: 'inv.stock_reservation',
      entityId: reservation.id,
      companyId: reservation.companyId,
      branchId: reservation.branchId,
      requestRef: 'inv.stock-reservation-create',
      details: [
        { field: 'itemId', classification: 'internal', value: reservation.itemId },
        { field: 'locationId', classification: 'internal', value: reservation.locationId },
        { field: 'quantity', classification: 'internal', value: reservation.quantity },
        { field: 'workOrderId', classification: 'internal', value: reservation.workOrderId },
        { field: 'materialRequestId', classification: 'internal', value: materialRequestId },
      ],
    });

    await publishEvent(db, {
      eventType: 'stock.reserved',
      aggregateId: reservation.id,
      aggregateVersion: reservation.recordVersion,
      producer: 'inventory.inventory-stock-service',
      companyId: reservation.companyId,
      branchId: reservation.branchId,
      // The reservation id keys the event, so a producer that retries its own
      // command cannot emit the same event twice.
      eventKey: `stock.reserved:${reservation.id}`,
      payload: {
        reservationId: reservation.id,
        itemId: reservation.itemId,
        locationId: reservation.locationId,
        workOrderId: reservation.workOrderId,
        quantity: reservation.quantity,
      },
    });

    return this.toReservationView(reservation, false, materialRequestId);
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-005 — reservation release.
  // -------------------------------------------------------------------------

  /**
   * Releases a reservation.
   *
   * `inv.release_reservation` returns without acting when the reservation is
   * already terminal, so a duplicate release is idempotent rather than an error —
   * which is what a retrying client needs. The response reports the state that
   * resulted, so a caller can tell a fresh release from a no-op.
   */
  public async release(
    db: DbHandle,
    reservationId: string,
    reason: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReservationView> {
    // LOCKED, not merely read. `inv.release_reservation` no-ops on an already
    // terminal reservation, so deciding "did this call change anything" from an
    // unlocked read is racy: a concurrent issue could consume the reservation between
    // the read and the call, and this method would then record an audit entry and
    // publish an event for a release that never happened — telling consumers the
    // quantity returned to available when it had in fact left through an `out`
    // movement. The lock makes the pre-read and the release one atomic decision, and
    // it also serialises two concurrent releases so the second cannot collide on
    // `uq_event_outbox_event_key` and abort a transaction the route promises is safe.
    const before = await this.repository.lockReservation(db, reservationId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Reservation ${reservationId} was not found`,
      });
    }
    // The reservation names its own company and branch, so the deferred check has a
    // concrete target and evaluates with `iam.has_permission_in_scope`. Without it
    // `scope: 'branch'` would be inert on a route addressed only by id.
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });

    const wasActive = before.status === 'active';
    // A reservation that fulfills an open material request is released by finishing
    // the request, which releases it explicitly AND stops its remainder counting
    // against the allowance. Releasing the reservation alone would leave the units
    // committed to the job with nothing held on the shelf for them.
    const link = await this.repository.readMaterialLinkForReservation(db, reservationId);
    try {
      if (wasActive && link !== null && link.requestStatus === 'open') {
        await this.repository.finishMaterialRequest(db, {
          requestId: link.requestId,
          outcome: link.hasIssue ? 'closed' : 'cancelled',
          reason,
        });
      } else {
        await this.repository.releaseReservation(db, reservationId, reason);
      }
    } catch (error) {
      toDomainFailure(error, 'Reservation release');
    }

    const after = await this.repository.readReservation(db, reservationId);
    if (!after) {
      throw new AppFailure('ERR-SYS-001', { message: 'Reservation vanished after release' });
    }

    // Audit and event only for a release that actually changed something. Emitting
    // them for a no-op would make the trail claim a state change that never
    // happened, and would let a retry loop inflate the outbox.
    if (wasActive) {
      await appendAudit(db, {
        action: 'inv.stock.reservation_released',
        entityType: 'inv.stock_reservation',
        entityId: after.id,
        companyId: after.companyId,
        branchId: after.branchId,
        requestRef: 'inv.stock-reservation-release',
        details: [
          {
            field: 'status',
            classification: 'internal',
            previousValue: 'active',
            value: after.status,
          },
          { field: 'reason', classification: 'internal', value: reason },
          { field: 'quantity', classification: 'internal', value: after.quantity },
        ],
      });
      await publishEvent(db, {
        eventType: 'stock.reservation.released',
        aggregateId: after.id,
        aggregateVersion: after.recordVersion,
        producer: 'inventory.inventory-stock-service',
        companyId: after.companyId,
        branchId: after.branchId,
        eventKey: `stock.reservation.released:${after.id}`,
        payload: {
          reservationId: after.id,
          itemId: after.itemId,
          locationId: after.locationId,
          quantity: after.quantity,
          reason,
        },
      });
    }

    return this.toReservationView(after, !wasActive, link?.requestId ?? null);
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-006 — issue to work order.
  // -------------------------------------------------------------------------

  /**
   * Issues stock to a work order.
   *
   * Three checks the protected function does not make happen here first: the work
   * order must be accepting parts (`D-02`), the reservation must belong to this
   * item, location, and work order (`D-03`), and the location must be in the work
   * order's own company and branch. The issue itself is a draw on an approved
   * material requirement, performed by `inv.issue_material_request`.
   */
  public async issue(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly reservationId?: string;
      readonly requiredPartRef?: string;
      readonly materialRequirementId?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<IssueView> {
    const quantity = parseQuantity(input.quantity);
    assertLegalMovementReference('issue', 'part_issue', 'out');

    const location = await this.requireSellableLocation(db, input.locationId);
    await authorizeScope({ companyId: location.companyId, branchId: location.branchId });
    await this.requireStockTrackedItem(db, input.itemId);
    await this.requireWorkOrderAcceptingParts(db, input.workOrderId, location);

    if (input.reservationId !== undefined) {
      const reservation = await this.repository.readReservation(db, input.reservationId);
      if (!reservation) {
        throw new AppFailure('ERR-RES-001', {
          message: `Reservation ${input.reservationId} was not found`,
        });
      }
      try {
        assertReservationMatchesIssue(reservation, {
          itemId: input.itemId,
          locationId: input.locationId,
          workOrderId: input.workOrderId,
        });
      } catch (error) {
        toDomainFailure(error, 'Issue');
      }
      /**
       * An issue may not exceed what the reservation actually holds.
       *
       * `inv.consume_reservation` releases the reservation in full whatever the
       * issued quantity, so issuing 10 against a reservation of 2 would free 2 and
       * take 10 from stock — legal to the constraints only if 8 more were
       * unreserved, which turns a reservation into a suggestion.
       */
      if (quantity.isGreaterThan(Quantity.fromDatabase(reservation.quantity, 'quantity'))) {
        refuseInventoryState(
          'stock_issue_exceeds_reservation',
          `Issue quantity ${quantity.toString()} exceeds the reserved ` +
            `${reservation.quantity}; reserve more or issue the reserved amount`,
          { path: 'body.quantity' }
        );
      }
    }

    // P1-32-PRE-132: EVERY issue to a work order draws on a material request. An issue
    // against a reservation that already fulfills an open request draws on THAT request:
    // its units were measured against the allowance when they were reserved, and
    // counting them again would spend the allowance twice. Any other issue opens a
    // request of its own on the requirement it names. The database performs both
    // under the requirement lock and refuses whatever the allowance does not cover;
    // the request is then closed, so what it asked for and did not issue stops
    // counting, by an act rather than a filter.
    const reservationLink =
      input.reservationId === undefined
        ? null
        : await this.repository.readMaterialLinkForReservation(db, input.reservationId);
    const issueOn = async (nested: DbHandle, requestId: string) => {
      const result = await this.repository.issuePart(nested, {
        requestId,
        locationId: input.locationId,
        quantity: quantity.toString(),
        reservationId: input.reservationId ?? null,
        requiredPartRef: input.requiredPartRef ?? null,
      });
      await this.repository.finishMaterialRequest(nested, {
        requestId,
        outcome: 'closed',
        reason: null,
      });
      return result;
    };

    let issued: { issueId: string; movementId: string };
    let materialRequestId: string;
    if (reservationLink !== null && reservationLink.requestStatus === 'open') {
      if (
        input.materialRequirementId !== undefined &&
        input.materialRequirementId !== reservationLink.requirementId
      ) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The reservation was drawn on a different material requirement',
          safeDetails: {
            violations: [{ path: 'body.materialRequirementId', rule: 'other_requirement' }],
          },
        });
      }
      materialRequestId = reservationLink.requestId;
      issued = await this.governor.drawOnRequest(
        db,
        {
          requirementId: reservationLink.requirementId,
          itemId: input.itemId,
          quantity: quantity.toString(),
        },
        (nested) => issueOn(nested, reservationLink.requestId),
        'Part issue'
      );
    } else {
      const requirementId = await this.governor.resolve(db, {
        workOrderId: input.workOrderId,
        itemId: input.itemId,
        materialRequirementId: input.materialRequirementId,
      });
      const drawn = await this.governor.draw(
        db,
        { requirementId, itemId: input.itemId, quantity: quantity.toString() },
        issueOn,
        'Part issue'
      );
      materialRequestId = drawn.requestId;
      issued = drawn.result;
    }

    await appendAudit(db, {
      action: 'inv.part.issued',
      entityType: 'inv.part_issue',
      entityId: issued.issueId,
      companyId: location.companyId,
      branchId: location.branchId,
      requestRef: 'inv.stock-issue-create',
      details: [
        { field: 'workOrderId', classification: 'internal', value: input.workOrderId },
        { field: 'itemId', classification: 'internal', value: input.itemId },
        { field: 'locationId', classification: 'internal', value: input.locationId },
        { field: 'quantity', classification: 'internal', value: quantity.toString() },
        {
          field: 'reservationId',
          classification: 'internal',
          value: input.reservationId ?? null,
        },
        { field: 'materialRequestId', classification: 'internal', value: materialRequestId },
      ],
    });

    await this.publishMovementPosted(db, {
      movementId: issued.movementId,
      companyId: location.companyId,
      branchId: location.branchId,
      itemId: input.itemId,
      locationId: input.locationId,
      movementType: 'issue',
      direction: 'out',
      quantity: quantity.toString(),
      referenceKind: 'part_issue',
      referenceId: issued.issueId,
    });

    return {
      id: issued.issueId,
      movementId: issued.movementId,
      workOrderId: input.workOrderId,
      itemId: input.itemId,
      locationId: input.locationId,
      companyId: location.companyId,
      branchId: location.branchId,
      quantity: quantity.toString(),
      reservationId: input.reservationId ?? null,
      materialRequestId,
    };
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-007 — return from work order.
  // -------------------------------------------------------------------------

  /**
   * Returns a previously issued part.
   *
   * The return is addressed by the **issue** it reverses, which is what makes
   * "returning another work order's issue" unrepresentable rather than merely
   * refused: there is no parameter in which to name a different work order.
   * `Σ returns ≤ issued` is enforced by `inv.return_part` under a row lock and again
   * by `inv.guard_part_return_ceiling` at the constraint layer; the pre-check here
   * exists to give a readable message, not to be the guarantee.
   */
  public async returnPart(
    db: DbHandle,
    input: {
      readonly partIssueId: string;
      readonly quantity: string;
      readonly reason?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<ReturnView> {
    const quantity = parseQuantity(input.quantity);
    assertLegalMovementReference('return', 'part_return', 'in');

    const issue = await this.repository.readPartIssue(db, input.partIssueId);
    if (!issue) {
      throw new AppFailure('ERR-RES-001', {
        message: `Part issue ${input.partIssueId} was not found`,
      });
    }
    await authorizeScope({ companyId: issue.companyId, branchId: issue.branchId });

    const issued = Quantity.fromDatabase(issue.quantity, 'issuedQuantity');
    const already = Quantity.fromDatabase(issue.returnedQty, 'returnedQuantity');
    if (already.plus(quantity).isGreaterThan(issued)) {
      refuseInventoryState(
        'stock_return_exceeds_issue',
        `Return of ${quantity.toString()} would exceed the issued ${issued.toString()} ` +
          `(${already.toString()} already returned)`,
        { path: 'body.quantity' }
      );
    }

    let returned: { returnId: string };
    try {
      returned = await this.repository.returnPart(db, {
        partIssueId: input.partIssueId,
        quantity: quantity.toString(),
        reason: input.reason ?? null,
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      toDomainFailure(error, 'Part return');
    }

    // The `in` leg is published, like the issue's `out` leg. A consumer projecting
    // availability from `stock.movement.posted` would otherwise see stock leave on
    // every issue and never come back — a monotonically diverging projection, which
    // is the availability inflation this phase exists to prevent.
    await this.publishPostedMovements(db, 'part_return', returned.returnId);

    await appendAudit(db, {
      action: 'inv.part.returned',
      entityType: 'inv.part_return',
      entityId: returned.returnId,
      companyId: issue.companyId,
      branchId: issue.branchId,
      requestRef: 'inv.stock-return-create',
      details: [
        { field: 'partIssueId', classification: 'internal', value: input.partIssueId },
        { field: 'itemId', classification: 'internal', value: issue.itemId },
        { field: 'quantity', classification: 'internal', value: quantity.toString() },
        {
          field: 'totalReturned',
          classification: 'internal',
          previousValue: already.toString(),
          value: already.plus(quantity).toString(),
        },
      ],
    });

    return {
      id: returned.returnId,
      partIssueId: input.partIssueId,
      quantity: quantity.toString(),
      totalReturned: already.plus(quantity).toString(),
      issuedQuantity: issued.toString(),
    };
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-008 — damaged return.
  // -------------------------------------------------------------------------

  /**
   * Records damaged stock and moves it into quarantine.
   *
   * `ck_damaged_stock_locations` only requires the two locations to differ, so
   * without `assertQuarantineDestination` a "damaged" unit could be moved to
   * another sellable location and stay available — the exact availability inflation
   * this task must prevent. `inv.record_damage` then frees conflicting reservations
   * at the source before reducing `on_hand`, so `available` cannot go negative.
   */
  public async recordDamage(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly fromLocationId: string;
      readonly quarantineLocationId: string;
      readonly quantity: string;
      readonly reason: string;
      readonly disposition: string;
      readonly responsiblePartyRef?: string;
      readonly evidenceRef?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<DamageView> {
    const quantity = parseQuantity(input.quantity);
    assertLegalMovementReference('damage', 'damage', 'out');
    assertLegalMovementReference('damage', 'damage', 'in');

    const from = await this.requireLocation(db, input.fromLocationId);
    const quarantine = await this.requireLocation(db, input.quarantineLocationId);
    await authorizeScope({ companyId: from.companyId, branchId: from.branchId });

    // Both legs post movements, so both locations must be in one branch — otherwise
    // damage would move stock across a branch boundary that no transfer primitive
    // exists to represent.
    if (from.companyId !== quarantine.companyId || from.branchId !== quarantine.branchId) {
      refuseInventoryState(
        'stock_damage_other_branch',
        'Damage must stay inside one branch; the two locations are in different branches',
        { path: 'body.quarantineLocationId' }
      );
    }
    try {
      assertQuarantineDestination(from, quarantine);
    } catch (error) {
      toDomainFailure(error, 'Damage');
    }
    await this.requireStockTrackedItem(db, input.itemId);

    /**
     * The reservations this damage is about to destroy, captured BEFORE the call.
     *
     * `inv.record_damage` calls `inv.free_reservations_for_loss`, which releases
     * WHOLE reservation rows newest-first until the freed quantity covers the loss —
     * it never releases part of one. So damaging `0.001` of a cell whose stock is
     * fully reserved releases the entire reservation, and a caller holding only
     * `inv.stock.operate` could destroy another work order's guaranteed part and
     * immediately reserve it. The release granularity belongs to the protected
     * function and cannot be changed without a migration; what belongs here is
     * refusing the disproportionate case and attributing the rest.
     */
    const reservationsBefore = await this.repository.activeReservationsAt(
      db,
      input.itemId,
      input.fromLocationId
    );

    let damage: { damageId: string };
    try {
      damage = await this.repository.recordDamage(db, {
        itemId: input.itemId,
        fromLocationId: input.fromLocationId,
        quarantineLocationId: input.quarantineLocationId,
        quantity: quantity.toString(),
        reason: input.reason,
        disposition: input.disposition,
        responsiblePartyRef: input.responsiblePartyRef ?? null,
        evidenceRef: input.evidenceRef ?? null,
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      toDomainFailure(error, 'Damage record');
    }

    /**
     * Attribute — and bound — the collateral releases.
     *
     * Anything that was active before and is no longer active was released by
     * `inv.free_reservations_for_loss`, because nothing else in this transaction
     * touches those rows. Two things then happen that did not before:
     *
     *  - the total released quantity is compared against the damage. Releasing more
     *    than was damaged means whole rows were sacrificed for a fraction of their
     *    quantity, so the command is REFUSED and the transaction rolls back — the
     *    operator must release the reservation deliberately first. Without this a
     *    0.001-unit damage silently voids a 10.000-unit reservation.
     *  - each genuine release is audited and published exactly as the `/release`
     *    route does, so the same state change is attributable however it was caused.
     *    Otherwise a consumer keeps a phantom `active` reservation forever.
     */
    if (reservationsBefore.length > 0) {
      const freed: (typeof reservationsBefore)[number][] = [];
      let freedQuantity = Quantity.ZERO;
      for (const reservation of reservationsBefore) {
        const after = await this.repository.readReservation(db, reservation.id);
        if (after && after.status === 'active') continue;
        freed.push(reservation);
        freedQuantity = freedQuantity.plus(Quantity.fromDatabase(reservation.quantity, 'quantity'));
      }
      if (freedQuantity.isGreaterThan(quantity)) {
        refuseInventoryState(
          'stock_damage_releases_reservations',
          `Recording ${quantity.toString()} damaged would release reservations totalling ` +
            `${freedQuantity.toString()}, because a reservation is released whole. Release the ` +
            'affected reservations deliberately, then record the damage.'
        );
      }
      for (const reservation of freed) {
        await appendAudit(db, {
          action: 'inv.stock.reservation_released',
          entityType: 'inv.stock_reservation',
          entityId: reservation.id,
          companyId: reservation.companyId,
          branchId: reservation.branchId,
          requestRef: 'inv.damaged-stock-create',
          details: [
            {
              field: 'status',
              classification: 'internal',
              previousValue: 'active',
              value: 'released',
            },
            { field: 'reason', classification: 'internal', value: 'stock_loss' },
            { field: 'quantity', classification: 'internal', value: reservation.quantity },
            { field: 'damageId', classification: 'internal', value: damage.damageId },
          ],
        });
        await publishEvent(db, {
          eventType: 'stock.reservation.released',
          aggregateId: reservation.id,
          aggregateVersion: reservation.recordVersion,
          producer: 'inventory.inventory-stock-service',
          companyId: reservation.companyId,
          branchId: reservation.branchId,
          eventKey: `stock.reservation.released:${reservation.id}`,
          payload: {
            reservationId: reservation.id,
            itemId: reservation.itemId,
            locationId: reservation.locationId,
            quantity: reservation.quantity,
            reason: 'stock_loss',
          },
        });
      }
    }

    // Both legs — `out` of the sellable cell and `in` to quarantine — are published.
    await this.publishPostedMovements(db, 'damage', damage.damageId);

    await appendAudit(db, {
      action: 'inv.stock.damaged',
      entityType: 'inv.damaged_stock',
      entityId: damage.damageId,
      companyId: from.companyId,
      branchId: from.branchId,
      requestRef: 'inv.damaged-stock-create',
      details: [
        { field: 'itemId', classification: 'internal', value: input.itemId },
        { field: 'fromLocationId', classification: 'internal', value: input.fromLocationId },
        {
          field: 'quarantineLocationId',
          classification: 'internal',
          value: input.quarantineLocationId,
        },
        { field: 'quantity', classification: 'internal', value: quantity.toString() },
        { field: 'disposition', classification: 'internal', value: input.disposition },
        { field: 'reason', classification: 'internal', value: input.reason },
      ],
    });

    return {
      id: damage.damageId,
      itemId: input.itemId,
      fromLocationId: input.fromLocationId,
      quarantineLocationId: input.quarantineLocationId,
      quantity: quantity.toString(),
      disposition: input.disposition,
    };
  }

  // -------------------------------------------------------------------------
  // P1-32-PRE-111 — the counter sale's stock leg (the port `billing` calls).
  // -------------------------------------------------------------------------

  /**
   * Posts the `sale`/`out` movement of every line of a counter sale that has just
   * been issued, in the caller's transaction.
   *
   * This is the ONLY way an invoice moves stock, and it is here rather than in
   * `billing` because a module that is not this one may not write `inv`. The
   * argument is a list of invoice LINE ids: `inv.post_counter_sale_line` reads the
   * item, the cell and the quantity from the line itself, checks availability
   * inside the balance-row lock, and posts through `inv.post_stock_movement` — so
   * nothing a caller passes can redirect a posting or sell more than is there.
   *
   * Exactly once, structurally: `uq_stock_movements_source` is UNIQUE on
   * (reference_kind, reference_id, direction), so a second call for one line is
   * refused by the index rather than by a code path that could be skipped. The
   * caller's own replay guard — `issueInvoice` short-circuits on an already-issued
   * invoice — means that index is a backstop and not the routine path.
   *
   * No audit record: the act being audited is the ISSUANCE, and `billing` writes
   * `sal.invoice.issued` for it. A second record here would report one event twice
   * under two names. The movements are published as `stock.movement.posted`, which
   * is what a consumer projecting availability needs.
   */
  public async postCounterSaleLines(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly invoiceLineIds: readonly string[];
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<readonly string[]> {
    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });
    assertLegalMovementReference('sale', 'invoice_line', 'out');

    const movementIds: string[] = [];
    for (const invoiceLineId of input.invoiceLineIds) {
      try {
        movementIds.push(await this.repository.postCounterSaleLine(db, invoiceLineId));
      } catch (error) {
        toDomainFailure(error, 'Counter sale');
      }
      await this.publishPostedMovements(db, 'invoice_line', invoiceLineId);
    }
    return movementIds;
  }

  // -------------------------------------------------------------------------
  // Shared preconditions.
  // -------------------------------------------------------------------------

  public async requireLocation(db: DbHandle, locationId: string): Promise<StockLocationRow> {
    const location = await this.repository.readLocation(db, locationId);
    if (!location) {
      throw new AppFailure('ERR-RES-001', {
        message: `Stock location ${locationId} was not found`,
      });
    }
    if (location.status !== 'active') {
      refuseInventoryState(
        'stock_location_not_active',
        `Stock location ${location.locationCode} is ${location.status}`,
        { path: 'body.locationId' }
      );
    }
    return location;
  }

  /**
   * A location whose stock may be reserved or issued.
   *
   * Quarantine is excluded, and this is the control that makes the damage path mean
   * anything. `inv.record_damage` moves damaged units OUT of a sellable location and
   * IN to a quarantine one, so they leave sellable availability structurally — but
   * the units still exist as a balance in the quarantine cell, and nothing in the
   * protected schema stops a reservation or an issue naming that cell. Without this,
   * a damaged part can be reserved and fitted to a customer's vehicle, and because
   * `/stock-availability` excludes quarantine by default the drawdown would not even
   * appear in the operator's view. Measured before the fix: damage 201, reserve from
   * quarantine 201, issue from quarantine 201.
   *
   * Quarantined stock leaves through the approved disposition path —
   * `inv.stock_adjustments` and `inv.approve_adjustment`, which need
   * `inv.adjustment.approve` and a second person — not through `inv.stock.operate`.
   */
  public async requireSellableLocation(
    db: DbHandle,
    locationId: string
  ): Promise<StockLocationRow> {
    const location = await this.requireLocation(db, locationId);
    if (location.locationType === 'quarantine') {
      refuseInventoryState(
        'stock_location_quarantine',
        `Stock location ${location.locationCode} is a quarantine location; damaged stock ` +
          'cannot be reserved or issued. Dispose of it through an approved adjustment.',
        { path: 'body.locationId' }
      );
    }
    // Transit for the same reason quarantine is excluded: the quantity there belongs
    // to a transfer under way, and reserving or issuing it would take a part out of a
    // delivery that has not arrived at either end.
    if (location.locationType === 'transit') {
      refuseInventoryState(
        'stock_location_transit',
        `Stock location ${location.locationCode} holds transfers in transit; that stock ` +
          'cannot be reserved or issued until the transfer is received.',
        { path: 'body.locationId' }
      );
    }
    return location;
  }

  /**
   * Refuses an item that stock cannot be held against.
   *
   * `is_stock_tracked` is a flag on `inv.item_master` with no constraint tying it to
   * the ledger, so a balance could otherwise be built for a service-like item whose
   * quantity means nothing. An archived item is refused for the same reason its
   * lifecycle is terminal.
   */
  public async requireStockTrackedItem(db: DbHandle, itemId: string): Promise<void> {
    const item = await this.repository.readItem(db, itemId);
    if (!item) {
      throw new AppFailure('ERR-RES-001', { message: `Item ${itemId} was not found` });
    }
    if (item.lifecycleStatus !== 'active') {
      refuseInventoryState(
        'stock_item_archived',
        `Item ${item.sku} is archived and cannot take stock movements`,
        { path: 'body.itemId' }
      );
    }
    if (!item.isStockTracked) {
      refuseInventoryState('stock_item_not_tracked', `Item ${item.sku} is not stock-tracked`, {
        path: 'body.itemId',
      });
    }
  }

  /**
   * Locks the work order and refuses one that cannot receive parts.
   *
   * The lock is what makes the check meaningful under concurrency: without it a
   * transition could close the work order between this check and the issue. The
   * branch comparison closes the other half — a work order in branch B1 must not
   * consume stock from a location in B2, which the protected function permits
   * because it derives scope from the location alone.
   */
  private async requireWorkOrderAcceptingParts(
    db: DbHandle,
    workOrderId: string,
    location: StockLocationRow
  ): Promise<void> {
    const state = await this.repository.lockWorkOrderState(db, workOrderId);
    if (!state) {
      throw new AppFailure('ERR-RES-001', {
        message: `Work order ${workOrderId} was not found`,
      });
    }
    if (state.companyId !== location.companyId || state.branchId !== location.branchId) {
      refuseInventoryState(
        'stock_work_order_other_branch',
        `Work order ${workOrderId} is in a different branch from stock location ` +
          `${location.locationCode}`,
        { path: 'body.workOrderId' }
      );
    }
    try {
      assertWorkOrderAcceptsParts(state);
    } catch (error) {
      toDomainFailure(error, 'Work order');
    }
  }

  /**
   * Publishes `stock.movement.posted` for every movement a protected function wrote.
   *
   * `inv.return_part`, `inv.record_damage` and `inv.approve_opening_batch` return the
   * business row's id rather than the movement id, which is why this resolves the
   * movements from the reference. The event catalog states that one
   * `stock.movement.posted` describes issue, return, damage and opening postings so a
   * consumer need not subscribe to four names — and for a while only the issue path
   * honoured that. This is what makes the statement true.
   */
  public async publishPostedMovements(
    db: DbHandle,
    referenceKind: string,
    referenceId: string
  ): Promise<void> {
    const movements = await this.repository.findMovementsForReference(
      db,
      referenceKind,
      referenceId
    );
    for (const movement of movements) {
      await this.publishMovementPosted(db, {
        movementId: movement.id,
        companyId: movement.companyId,
        branchId: movement.branchId,
        itemId: movement.itemId,
        locationId: movement.locationId,
        movementType: movement.movementType,
        direction: movement.direction,
        quantity: movement.quantity,
        referenceKind,
        referenceId,
      });
    }
  }

  private async publishMovementPosted(
    db: DbHandle,
    input: {
      readonly movementId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly movementType: string;
      readonly direction: string;
      readonly quantity: string;
      readonly referenceKind: string;
      readonly referenceId: string;
    }
  ): Promise<void> {
    await publishEvent(db, {
      eventType: 'stock.movement.posted',
      aggregateId: input.movementId,
      // A movement is append-only and never revised, so its aggregate version is
      // permanently 1. Claiming anything else would imply a mutable ledger.
      aggregateVersion: 1,
      producer: 'inventory.inventory-stock-service',
      companyId: input.companyId,
      branchId: input.branchId,
      eventKey: `stock.movement.posted:${input.movementId}`,
      payload: {
        movementId: input.movementId,
        itemId: input.itemId,
        locationId: input.locationId,
        movementType: input.movementType,
        direction: input.direction,
        quantity: input.quantity,
        reference: { kind: input.referenceKind, id: input.referenceId },
      },
    });
  }

  private toReservationView(
    row: {
      readonly id: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId: string | null;
      readonly quantity: string;
      readonly status: string;
      readonly expiresAt: Date | null;
      readonly recordVersion: number;
    },
    replayed: boolean,
    materialRequestId: string | null
  ): ReservationView {
    return {
      id: row.id,
      itemId: row.itemId,
      locationId: row.locationId,
      companyId: row.companyId,
      branchId: row.branchId,
      workOrderId: row.workOrderId,
      quantity: row.quantity,
      status: row.status,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      recordVersion: row.recordVersion,
      materialRequestId,
      replayed,
    };
  }
}
