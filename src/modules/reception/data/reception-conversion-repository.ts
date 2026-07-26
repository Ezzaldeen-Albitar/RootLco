/**
 * Reception-to-work-order conversion repository (Phase 1-18, P1-18-BE-019).
 *
 * The only place `wo.work_orders` SQL is written in this module, and it writes
 * exactly one minimal work order: the six required columns plus the allocated
 * display number. `kind`, `state`, `parts_forward_state`, and `opened_at` are
 * left to their frozen defaults, because choosing them here would be this module
 * deciding how work is organised — which is Phase 1-19's contract, not
 * reception's. No job, service line, part, or assignment is created.
 *
 * Exactly-once conversion rests on three things, in order:
 *
 *  1. the caller locks the reception visit and refuses a non-`authorized` state,
 *     so two concurrent attempts serialise and the second sees `converted`;
 *  2. `workOrderForVisit` reads the existing work order inside that lock, so a
 *     replay returns the first result instead of creating a second one;
 *  3. `uq_work_orders_ordinary_origin` — unique on
 *     (tenant, company, branch, reception_visit_id) where `kind = 'ordinary'` and
 *     the row is live — is the database's own backstop, surfacing a second
 *     ordinary work order for the same visit as 23505 rather than accepting it.
 *
 * `wo.guard_work_order_refs` holds the preconditions (visit visible and
 * authorized or converted, vehicle coherent, custody accepted, an approved
 * authorization present, initial state non-terminal). None of them is
 * re-implemented here.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** The work order a conversion either found or created. */
export interface WorkOrderRow {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly state: string;
}

export class ReceptionConversionRepository extends Repository {
  protected readonly module = 'reception';

  /**
   * The live ORDINARY work order already converted from this visit, or null.
   *
   * The predicate list matches `uq_work_orders_ordinary_origin` exactly —
   * `kind = 'ordinary'` and `deleted_at IS NULL` — because this read is the
   * application half of the same exactly-once rule the index enforces, and a
   * read that is broader than the constraint answers a question the constraint
   * never asked. Once P1-19 creates a rework order carrying the same
   * `reception_visit_id`, dropping `kind` here would make a still-`authorized`
   * reception report itself as already converted and never convert at all.
   */
  async workOrderForVisit(db: DbHandle, receptionVisitId: string): Promise<WorkOrderRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string; display_number: string | null; state: string }>(
      db,
      `SELECT id, display_number, state
         FROM wo.work_orders
        WHERE tenant_id = $1 AND reception_visit_id = $2
          AND kind = 'ordinary' AND deleted_at IS NULL
        LIMIT 1`,
      [context.principal.tenantId, receptionVisitId]
    );
    const row = result.rows[0];
    return row ? { id: row.id, displayNumber: row.display_number, state: row.state } : null;
  }

  /** Creates the minimal work order. Returns it as the database stored it. */
  async insertWorkOrder(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly receptionVisitId: string;
      readonly vehicleId: string;
      readonly displayNumber: string | null;
    }
  ): Promise<WorkOrderRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string; display_number: string | null; state: string }>(
      db,
      `INSERT INTO wo.work_orders
         (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id,
          display_number, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, display_number, state`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.vehicleId,
        input.displayNumber,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    return row ? { id: row.id, displayNumber: row.display_number, state: row.state } : null;
  }
}
