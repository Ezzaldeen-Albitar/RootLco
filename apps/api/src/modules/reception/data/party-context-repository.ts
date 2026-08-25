/**
 * Reception party context — the dated projection the work-order surface reads
 * (PRE-P1-29-BR-05).
 *
 * ## Why this exists, and why it lives in `reception`
 *
 * A work order did not expose its customer. `WorkOrderDetail.workOrder` carried
 * ids and a lifecycle and nothing that answers a service advisor's first
 * question — _whose car is this_ — and **no customer column exists in any of the
 * 44 `wo`/`dia`/`tech`/`qms` tables**. The relationship is real and already
 * modelled, just on the other side of a module boundary:
 *
 *   wo.work_orders.reception_visit_id → rec.reception_visits
 *                                     → rec.reception_party_roles → crm.business_partners
 *
 * The work-order module therefore asks for it through a port rather than writing
 * `rec`/`crm` SQL inside its own repository, on the `OpenInventoryCommitments`
 * precedent — an inventory-owned type embedded in a work-order response, resolved
 * by inventory. The alternative that was rejected is a denormalised
 * `wo.work_orders.customer_id`: a migration, a backfill with no honest source,
 * and a second source of truth that disagrees with `rec.reception_party_roles`
 * the moment a role is corrected.
 *
 * That failure mode has a shipped precedent in the very table it would have been
 * added to. `wo.work_orders.parts_forward_state` is a CHECK-constrained column
 * that **nothing writes** (`INS-16`) — always `'none'`. A stale `customer_id`
 * would be worse: an inert value is merely useless, a wrong customer is a wrong
 * answer.
 *
 * ## Dating is the mechanism, not good behaviour
 *
 * `rec.reception_party_roles` is DATED: `valid_from`/`valid_to`, with
 * `tg_reception_party_roles_immutable` guarding `partner_id`,
 * `relationship_role` and `valid_from`. A correction writes a NEW row and dates
 * the old one out; it cannot mutate one. So a query reading `valid_to IS NULL`
 * returns **today's** answer, and a query reading as at a fixed instant returns
 * **that instant's** answer — and only the second keeps a closed work order
 * reporting the customer who actually brought the car.
 *
 * ## The reference instant is the work order's `opened_at`
 *
 * Server-derived, never client-supplied — a client as-at parameter would be an
 * oracle and a way to read a party role out of its window.
 *
 * `opened_at` rather than the visit's own `created_at`, and the difference
 * matters: a role recorded a few minutes into intake carries a `valid_from`
 * AFTER the visit row was created, so `valid_from <= visits.created_at` would be
 * false and the projection would report `null` for a visit that plainly has a
 * customer. `opened_at` is always at or after the roles were assigned (the work
 * order is created by converting the visit), it is fixed for the life of the
 * work order, and it is the instant at which that work order's customer was the
 * current one — which is exactly the question being asked.
 *
 * ## `service_requester`, and the response says so
 *
 * The reported role is `service_requester` — the party who brought the car and
 * asked for the work. `vehicle_owner` is a different question and may be a
 * different party, which is the whole reason the table carries a seven-value
 * taxonomy. The projection therefore returns `relationshipRole` alongside the
 * party: a consumer that renders a name without the role is making a claim the
 * data does not support.
 *
 * The seven values here are NOT the seven of `veh.vehicle_relationships` — only
 * `payer` and `service_requester` overlap (`C-04`). This projection reads
 * `rec.reception_party_roles` only, and must never fall back to the vehicle
 * relation: a response mixing two vocabularies under one field name publishes
 * incomparable values.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** The role this projection reports. Named in the response, never assumed. */
export const SERVICE_REQUESTER = 'service_requester';

/**
 * The customer of one work order, as at that work order's `opened_at`.
 *
 * `displayName` is the ONLY `crm.business_partners` column projected. No address,
 * no contact point, no tax id, no other vehicle, no other visit — a caller
 * wanting those still needs `crm.*`. The boundary is "the party of this visit at
 * the role named", and nothing wider.
 */
export interface WorkOrderPartyRow {
  readonly workOrderId: string;
  readonly partnerId: string;
  readonly displayName: string;
  readonly relationshipRole: string;
  /**
   * True when more than one party held the reported role at the reference
   * instant.
   *
   * `uq_reception_party_roles_active` is unique on (visit, partner, role), so two
   * DIFFERENT partners may legitimately hold `service_requester` at once. The
   * query returns the earliest `valid_from` deterministically and sets this, so a
   * consumer is told the answer is partial rather than being handed an arbitrary
   * one of two.
   */
  readonly hasAdditionalParties: boolean;
}

/** The vehicle of one work order, as the board needs to render it. */
export interface WorkOrderVehicleRow {
  readonly workOrderId: string;
  readonly vehicleId: string;
  readonly registrationPlate: string | null;
  readonly makeModel: string | null;
}

export class PartyContextRepository extends Repository {
  protected readonly module = 'reception';

  /**
   * Resolves the customer of every work order in one statement.
   *
   * **Batched deliberately.** The board renders a page of work orders with a
   * customer column, and a per-row lookup would make that page an N+1 — the
   * defect the client-side chain was rejected for in the first place. One
   * statement for the whole page, whatever its size.
   *
   * `LATERAL` rather than a window function so the per-work-order ordering and
   * the "is there more than one" count are computed together, on the visit and
   * instant that work order actually names.
   *
   * Every hop carries `tenant_id` explicitly in addition to RLS: defence in
   * depth, and the predicate is the intent. `fk_reception_party_roles_partner`
   * is `(tenant_id, partner_id)`, so a cross-tenant partner does not exist to be
   * reached; the explicit predicate says so at the point of the read rather than
   * leaving it to be inferred.
   */
  async partiesForWorkOrders(
    db: DbHandle,
    workOrders: readonly { readonly id: string; readonly receptionVisitId: string; readonly openedAt: Date }[]
  ): Promise<readonly WorkOrderPartyRow[]> {
    if (workOrders.length === 0) return [];
    const context = this.assertContext(db);
    const result = await this.run<{
      work_order_id: string;
      partner_id: string;
      display_name: string;
      relationship_role: string;
      party_count: string;
    }>(
      db,
      `WITH asked(work_order_id, reception_visit_id, reference_at) AS (
         SELECT * FROM unnest($2::uuid[], $3::uuid[], $4::timestamptz[])
       )
       SELECT a.work_order_id, p.partner_id, p.display_name, p.relationship_role,
              p.party_count::text AS party_count
         FROM asked a
         CROSS JOIN LATERAL (
           SELECT r.partner_id,
                  bp.display_name,
                  r.relationship_role,
                  count(*) OVER () AS party_count
             FROM rec.reception_party_roles r
             JOIN crm.business_partners bp
               ON bp.tenant_id = r.tenant_id AND bp.id = r.partner_id
                                             AND bp.deleted_at IS NULL
            WHERE r.tenant_id = $1
              AND r.reception_visit_id = a.reception_visit_id
              AND r.relationship_role = $5
              AND r.deleted_at IS NULL
              AND r.valid_from <= a.reference_at
              AND (r.valid_to IS NULL OR r.valid_to > a.reference_at)
            ORDER BY r.valid_from ASC, r.partner_id ASC
            LIMIT 1
         ) p`,
      [
        context.principal.tenantId,
        workOrders.map((entry) => entry.id),
        workOrders.map((entry) => entry.receptionVisitId),
        workOrders.map((entry) => entry.openedAt.toISOString()),
        // Bound rather than spliced. It is a module constant with no caller
        // influence, so this is not an injection fix — it is the repository's
        // standing convention, and a literal inside the SQL would be the one
        // place a reader has to stop and prove that for themselves.
        SERVICE_REQUESTER,
      ]
    );
    return result.rows.map((row) => ({
      workOrderId: row.work_order_id,
      partnerId: row.partner_id,
      displayName: row.display_name,
      relationshipRole: row.relationship_role,
      hasAdditionalParties: Number(row.party_count) > 1,
    }));
  }

  /**
   * The vehicle block, batched for the same reason.
   *
   * **`veh.vehicles.workshop_status` is deliberately NOT projected.** A scan of
   * every non-catalogue function body matches only three `veh` triggers —
   * nothing in `wo`/`dia`/`tech`/`qms` maintains it (`INS-39`) — so publishing it
   * on a work-order response would display a field this domain never updates,
   * beside a lifecycle it does.
   *
   * The plate is the one CURRENT at the reference instant, from `veh.plate_history`,
   * which is dated exactly as the party roles are: a re-plated vehicle keeps
   * showing the plate a historical work order was opened against.
   */
  async vehiclesForWorkOrders(
    db: DbHandle,
    workOrders: readonly { readonly id: string; readonly vehicleId: string; readonly openedAt: Date }[]
  ): Promise<readonly WorkOrderVehicleRow[]> {
    if (workOrders.length === 0) return [];
    const context = this.assertContext(db);
    const result = await this.run<{
      work_order_id: string;
      vehicle_id: string;
      registration_plate: string | null;
      make_model: string | null;
    }>(
      db,
      `WITH asked(work_order_id, vehicle_id, reference_at) AS (
         SELECT * FROM unnest($2::uuid[], $3::uuid[], $4::timestamptz[])
       )
       SELECT a.work_order_id,
              a.vehicle_id,
              (SELECT ph.plate_raw
                 FROM veh.plate_history ph
                WHERE ph.tenant_id = $1 AND ph.vehicle_id = a.vehicle_id
                  AND ph.valid_from <= a.reference_at
                  AND (ph.valid_to IS NULL OR ph.valid_to > a.reference_at)
                ORDER BY ph.valid_from DESC
                LIMIT 1) AS registration_plate,
              NULLIF(btrim(concat_ws(' ', mk.name, md.name)), '') AS make_model
         FROM asked a
         LEFT JOIN veh.vehicles v
           ON v.tenant_id = $1 AND v.id = a.vehicle_id AND v.deleted_at IS NULL
         LEFT JOIN veh.makes mk  ON mk.id = v.make_id
         LEFT JOIN veh.models md ON md.id = v.model_id`,
      [
        context.principal.tenantId,
        workOrders.map((entry) => entry.id),
        workOrders.map((entry) => entry.vehicleId),
        workOrders.map((entry) => entry.openedAt.toISOString()),
      ]
    );
    return result.rows.map((row) => ({
      workOrderId: row.work_order_id,
      vehicleId: row.vehicle_id,
      registrationPlate: row.registration_plate,
      makeModel: row.make_model,
    }));
  }
}
