/**
 * The quality facts another module's board needs about a page of work orders
 * (Owner directive, P1-32-PRE-OD-UX).
 *
 * ## Why this port exists
 *
 * `qms.*` is this module's schema (ADR-001 rule 3). The work-order board shows a
 * quality column and offers an `awaitingQuality` filter, and it read both by
 * naming `qms.quality_control_records` in its own SQL — which
 * `tests/foundation/p1-19-module-foundation.test.ts` refuses, and rightly: the
 * rule is about schema references from another module's data layer and not only
 * about TypeScript imports, because a second reader of a table is a second
 * definition of what the table MEANS. "The latest quality result" and "quality is
 * still pending" are this module's sentences to speak.
 *
 * ## Why a port rather than a method on `QualityControlService`
 *
 * The same reason `work-order-report-port.ts` and `labor-report-port.ts` exist:
 * the services on this module's surface carry the rules a quality decision must
 * pass — sign-off independence, finalisation freezing, the reopen refusal — and a
 * consumer that only wants to LABEL a row must not be routed through them. This
 * carries no rule at all. It answers two questions and writes nothing.
 *
 * ## Both answers are page-shaped
 *
 * `resultsFor` takes the ids of ONE page and returns a map; `idsAwaitingQuality`
 * takes one company and branch set and returns ids the caller binds as an array.
 * Neither is a per-row lookup, because the board renders a column and a per-row
 * lookup is the N+1 the whole projection exists to avoid.
 *
 * The second returns IDS and deliberately not a SQL fragment: handing a fragment
 * across the boundary would put a `qms.` reference back into the work-order query
 * under another name and defeat the rule while appearing to respect it.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type { QualityRepository } from '../data/quality-repository';

export class WorkOrderQualityPort extends ApplicationService {
  protected readonly module = 'quality';

  constructor(private readonly repository: QualityRepository) {
    super();
  }

  /**
   * The latest `overall_result` for each of the given work orders.
   *
   * A work order with no quality-control record at all is ABSENT from the map
   * rather than present with a null: "quality control was never opened" and
   * "quality control is pending" are different facts, and a map that collapsed
   * them would make the board unable to tell them apart.
   */
  async resultsFor(
    db: DbHandle,
    workOrderIds: readonly string[]
  ): Promise<ReadonlyMap<string, string>> {
    return this.repository.latestOverallResults(db, workOrderIds);
  }

  /**
   * The work orders in one scope whose quality control is still `pending`.
   *
   * `branchIds` of `undefined` means every branch of the company, which is the
   * same contract the board's own query uses, so the two narrow identically.
   */
  async idsAwaitingQuality(
    db: DbHandle,
    scope: { readonly companyId: string; readonly branchIds?: readonly string[] | undefined }
  ): Promise<readonly string[]> {
    return this.repository.workOrderIdsAwaitingQuality(db, scope);
  }
}
