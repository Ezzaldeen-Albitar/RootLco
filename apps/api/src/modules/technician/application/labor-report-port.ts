/**
 * The technician module's REPORTING port (P1-31 prerequisite P-11, slice 2).
 *
 * ## Why a port and not a query in the reporting module
 *
 * `tech.*` is private to this module (ADR-001 rule 3; `index.ts` says so and the
 * boundary checker enforces it), so the SQL that selects and totals labour
 * sessions lives here and the reporting module asks for the answer. That is the
 * same shape as `WorkOrderReportPort` on the other side of the same report, and
 * as `laborSessionPort`, which this module already exposes so the job board can
 * render an open-session column without reading `tech.` itself.
 *
 * ## Why a separate class rather than a method on `LaborSessionService`
 *
 * A cross-module consumer should depend on the ONE thing it needs. `LaborSessionService`
 * starts, stops and corrects sessions; handing the whole service to the reporting
 * module under a second name would hand it three writes it must never perform. This
 * class holds a single read.
 *
 * ## It performs NO authorization
 *
 * Deliberately, and stated so it is not mistaken for an omission. The caller —
 * `ReportRunService` — has already evaluated the dataset's declared read codes
 * against the company and branch it passes here, at the run operation's branch
 * scope, and RLS narrows the statements underneath. A second, differently-shaped
 * check here would be a second definition of scope.
 *
 * ## The technician's NAME is resolved, and may legitimately be absent
 *
 * This module holds no names. `tech.technician_profiles` carries `user_id` and
 * nothing human-readable, so a label comes from `iamDirectory().directory
 * .resolveDisplayIdentities` — the same surface the vehicle module's actor
 * naming uses, and for the same reason: `iamDirectory()` constructs no identity
 * provider, so a report run cannot be turned into an `ERR-SYS-001` by an unset
 * provider variable.
 *
 * That directory NARROWS and never widens: a caller without `iam.user.read` gets
 * an EMPTY map, so the label is `null` and the profile id is published beside it
 * either way. A null label is therefore a real state — "this caller may not be
 * told who that is" — and not a missing value. It is rendered, never invented,
 * which is the treatment slice 1 gives an absent customer.
 */
import { ApplicationService } from '@/server/layering';
import { iamDirectory } from '@/modules/iam';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  LABOR_SESSION_ORDER,
  type LaborReportFilter,
  type LaborSessionRepository,
} from '../data/labor-session-repository';
import type { SessionPageInput } from './labor-session-service';

/** One contributing session, as the reporting module publishes it. */
export interface LaborSessionReportEntry {
  readonly sessionId: string;
  readonly technicianProfileId: string;
  /** Null when this caller may not be told the technician's name. */
  readonly technicianName: string | null;
  readonly jobId: string;
  /** The session's START, an ISO-8601 instant, exactly as every other read publishes one. */
  readonly startedAt: string;
  /** WHOLE seconds, as an integer string. */
  readonly durationSeconds: string;
  /** `manual`, `timer` or `correction` — the column's whole CHECK-constrained vocabulary. */
  readonly source: string;
}

/** One technician's recorded duration over the WHOLE selection. */
export interface TechnicianLaborTotal {
  readonly technicianProfileId: string;
  readonly technicianName: string | null;
  /** WHOLE seconds, as an integer string: the sum of the same per-row expression. */
  readonly durationSeconds: string;
}

export interface TechnicianLaborTotals {
  /**
   * Every technician who has a contributing session in the period, and only
   * those.
   *
   * Unlike the work-order status counts, there is no zero row for a technician
   * who logged nothing. The two cases are not alike: a work-order STATE is a
   * catalogue entry, and "no order is awaiting parts" is an answer; a technician
   * with no recorded hours is a roster question, and a report that listed every
   * profile at zero would be reporting on the roster rather than on the labour —
   * and would read as an attendance record, which D-4 says this is not.
   */
  readonly totals: readonly TechnicianLaborTotal[];
  /** One keyset page of the selection the totals were computed over. */
  readonly sessions: Page<LaborSessionReportEntry>;
}

export class LaborReportPort extends ApplicationService {
  protected readonly module = 'technician';

  constructor(private readonly repository: LaborSessionRepository) {
    super();
  }

  /**
   * The branch's recorded labour in a period: a page of sessions and every
   * technician's total over the whole selection.
   *
   * The ordering contract is the labour log's own, `LABOR_SESSION_ORDER` —
   * newest start first, id tie-break. Reused rather than reinvented because it is
   * the SAME ordering over the SAME table, and a second contract key for one
   * ordering would mean a cursor that is valid in one read and rejected in the
   * other for no reason a caller could discover.
   *
   * The names for the page and for the totals are resolved in ONE statement over
   * the union of their user ids. Two calls would be two round trips for one
   * answer, and could disagree if a caller's capability changed between them.
   */
  async laborTotals(
    db: DbHandle,
    filter: LaborReportFilter,
    page: SessionPageInput
  ): Promise<TechnicianLaborTotals> {
    const report = await this.repository.laborReport(
      db,
      filter,
      // The cursor decode stays behind this surface, for the reason
      // `WorkOrderReportPort` states: a consumer that decoded the cursor itself
      // would be validating it against a contract it had to guess.
      pageRequest(LABOR_SESSION_ORDER, page)
    );

    const userIds = [
      ...report.totals.map((row) => row.technicianUserId),
      ...report.page.items.map((row) => row.technicianUserId),
    ];
    const identities = await iamDirectory().directory.resolveDisplayIdentities(db, userIds);
    const nameOf = (userId: string): string | null => identities.get(userId)?.displayName ?? null;

    return {
      totals: report.totals.map((row) => ({
        technicianProfileId: row.technicianProfileId,
        technicianName: nameOf(row.technicianUserId),
        durationSeconds: row.durationSeconds,
      })),
      sessions: {
        ...report.page,
        items: report.page.items.map((row) => ({
          sessionId: row.id,
          technicianProfileId: row.technicianProfileId,
          technicianName: nameOf(row.technicianUserId),
          jobId: row.jobId,
          startedAt: row.startedAt.toISOString(),
          durationSeconds: row.durationSeconds,
          source: row.source,
        })),
      },
    };
  }
}
