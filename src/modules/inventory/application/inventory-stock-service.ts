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
 * What it does own are the three rules the protected functions demonstrably do not
 * enforce (`P1-21-D-01…D-03`, each reproduced against a live database and recorded
 * in `docs/phase-1/phase-1-21/wave-1-contract-archaeology.md`): the order in which
 * an issue releases its reservation, the work-order lifecycle, and
 * reservation↔issue coherence.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type { InventoryRepository, StockLocationRow } from '../data/inventory-repository';
import {
  InventoryRuleError,
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

/**
 * Translates the protected schema's refusals into the controlled error catalog.
 *
 * The SQLSTATE is the contract, not the message text: `23514` from
 * `ck_stock_balances_available` and `23514` from `inv.reserve_stock` are the same
 * class of answer — the database refused because the invariant would break — and a
 * caller needs `ERR-TRN-001` for both. Constraint names and SQL are never echoed.
 */
function toDomainFailure(error: unknown, what: string): never {
  if (error instanceof InventoryRuleError) {
    throw new AppFailure('ERR-TRN-001', { message: error.message });
  }
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a stock invariant`,
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names an item, location, or work order that does not exist in scope`,
    });
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    throw new AppFailure('ERR-INT-001', {
      message: `${what} has already been recorded`,
    });
  }
  throw error;
}

/**
 * Parses a quantity and maps a domain refusal onto the error catalog.
 *
 * The parse and the postable check BOTH throw `InventoryRuleError`, and an
 * unmapped domain error surfaces as `ERR-SYS-001` — a 500 that tells a caller its
 * request broke the server when in fact the server refused it. The Zod schema
 * catches most malformed shapes at the edge, but not every one: `"0"` is a
 * well-formed decimal string and only the `> 0` rule refuses it, so this wrapper is
 * the difference between a 409 and a 500 for the zero case.
 */
function parseQuantity(raw: string, field = 'quantity'): Quantity {
  try {
    return Quantity.parse(raw, field).assertPostable(field);
  } catch (error) {
    if (error instanceof InventoryRuleError) {
      throw new AppFailure('ERR-VAL-001', {
        message: error.message,
        safeDetails: { violations: [{ path: `body.${field}`, rule: 'custom' }] },
      });
    }
    throw error;
  }
}

export class InventoryStockService {
  public constructor(private readonly repository: InventoryRepository) {}

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
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<ReservationView> {
    const quantity = parseQuantity(input.quantity);
    const location = await this.requireLocation(db, input.locationId);
    await authorizeScope({ companyId: location.companyId, branchId: location.branchId });
    await this.requireStockTrackedItem(db, input.itemId);

    if (input.workOrderId !== undefined) {
      await this.requireWorkOrderAcceptingParts(db, input.workOrderId, location);
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
      return this.toReservationView(existing, true);
    }

    let reservationId: string;
    try {
      const created = await this.repository.reserveStock(db, {
        itemId: input.itemId,
        locationId: input.locationId,
        quantity: quantity.toString(),
        workOrderId: input.workOrderId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        expiresAt: input.expiresAt ?? null,
        correlationId: db.context.correlationId,
      });
      reservationId = created.id;
    } catch (error) {
      toDomainFailure(error, 'Reservation');
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

    return this.toReservationView(reservation, false);
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
    const before = await this.repository.readReservation(db, reservationId);
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
    try {
      await this.repository.releaseReservation(db, reservationId, reason);
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

    return this.toReservationView(after, !wasActive);
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
   * order's own company and branch. The repository then performs the issue in the
   * only order the constraints permit (`D-01`).
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
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<IssueView> {
    const quantity = parseQuantity(input.quantity);
    assertLegalMovementReference('issue', 'part_issue', 'out');

    const location = await this.requireLocation(db, input.locationId);
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
        throw new AppFailure('ERR-TRN-001', {
          message:
            `Issue quantity ${quantity.toString()} exceeds the reserved ` +
            `${reservation.quantity}; reserve more or issue the reserved amount`,
        });
      }
    }

    let issued: { issueId: string; movementId: string };
    try {
      issued = await this.repository.issuePart(db, {
        workOrderId: input.workOrderId,
        companyId: location.companyId,
        branchId: location.branchId,
        itemId: input.itemId,
        locationId: input.locationId,
        quantity: quantity.toString(),
        reservationId: input.reservationId ?? null,
        requiredPartRef: input.requiredPartRef ?? null,
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      toDomainFailure(error, 'Part issue');
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
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Return of ${quantity.toString()} would exceed the issued ${issued.toString()} ` +
          `(${already.toString()} already returned)`,
      });
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
      throw new AppFailure('ERR-TRN-001', {
        message: 'Damage must stay inside one branch; the two locations are in different branches',
      });
    }
    try {
      assertQuarantineDestination(from, quarantine);
    } catch (error) {
      toDomainFailure(error, 'Damage');
    }
    await this.requireStockTrackedItem(db, input.itemId);

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
  // Shared preconditions.
  // -------------------------------------------------------------------------

  private async requireLocation(db: DbHandle, locationId: string): Promise<StockLocationRow> {
    const location = await this.repository.readLocation(db, locationId);
    if (!location) {
      throw new AppFailure('ERR-RES-001', {
        message: `Stock location ${locationId} was not found`,
      });
    }
    if (location.status !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Stock location ${location.locationCode} is ${location.status}`,
      });
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
  private async requireStockTrackedItem(db: DbHandle, itemId: string): Promise<void> {
    const item = await this.repository.readItem(db, itemId);
    if (!item) {
      throw new AppFailure('ERR-RES-001', { message: `Item ${itemId} was not found` });
    }
    if (item.lifecycleStatus !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Item ${item.sku} is archived and cannot take stock movements`,
      });
    }
    if (!item.isStockTracked) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Item ${item.sku} is not stock-tracked`,
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
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Work order ${workOrderId} is in a different branch from stock location ` +
          `${location.locationCode}`,
      });
    }
    try {
      assertWorkOrderAcceptsParts(state);
    } catch (error) {
      toDomainFailure(error, 'Work order');
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
    replayed: boolean
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
      replayed,
    };
  }
}
