/**
 * Labour sessions (Phase 1-19, P1-19-BE-017…019).
 *
 * ## There is no pause column, and that is the schema's answer, not a shortcut
 *
 * `tech.labor_sessions` has `started_at` and `ended_at` and nothing else temporal. So
 * a PAUSE is: stop the open session, and transition the job to `paused` — whose
 * `reason_required` is true, which is why the reason for stopping lives in
 * `wo.job_status_history` rather than on the session. A RESUME is the mirror: move the
 * job back to `in_progress` and start a new session. Modelling a pause as a column
 * would have required a migration, and modelling it as a nullable `paused_at` would
 * have made "how long was this worked" ambiguous.
 *
 * The two halves are separate requests by design. They are separate FACTS —
 * "the clock stopped" and "the job is waiting" — with different permissions
 * (`tech.labor.record` versus `wo.job.transition`), and a technician may legitimately
 * stop their clock without changing the job's state at all, for example at the end of
 * a shift.
 *
 * ## One open session per technician is an EXCLUDE, not a lookup
 *
 * `ex_labor_sessions_overlap` covers `tstzrange(started_at, COALESCE(ended_at,
 * 'infinity'))`, and two infinite ranges always overlap — so "no overlapping
 * sessions" and "at most one open session" are the same constraint. It arrives as
 * `23P01` and is mapped, because a technician double-clocked onto two jobs is a
 * payroll and liability problem, not a 500.
 *
 * ## Scope comes from the technician profile
 *
 * `fk_labor_sessions_technician` and `fk_labor_sessions_job` both carry the composite
 * scope key, so a session's company and branch must equal BOTH the profile's and the
 * job's. Taking them from the profile — which this module owns — means a job in
 * another branch is refused by the foreign key rather than by this module reading
 * `wo.jobs`, which ADR-001 rule 3 prohibits.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import {
  LABOR_SESSION_ORDER,
  type LaborSessionRepository,
  type LaborSessionRow,
} from '../data/labor-session-repository';
import type { TechnicianCatalogRepository } from '../data/technician-catalog-repository';
import { assertLaborWindow } from '../domain/technician';

export interface LaborSessionView {
  readonly id: string;
  readonly technicianProfileId: string;
  readonly jobId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly source: string;
  readonly correctionOfId: string | null;
  readonly recordVersion: number;
}

/** The page a caller asked for, before the cursor is decoded. */
export interface SessionPageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

const toView = (row: LaborSessionRow): LaborSessionView => ({
  id: row.id,
  technicianProfileId: row.technicianProfileId,
  jobId: row.jobId,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
  source: row.source,
  correctionOfId: row.correctionOfId,
  recordVersion: row.recordVersion,
});

export class LaborSessionService extends ApplicationService {
  protected readonly module = 'technician';

  constructor(
    private readonly sessions: LaborSessionRepository,
    private readonly profiles: TechnicianCatalogRepository
  ) {
    super();
  }

  /** Starts a session. The clock is the server's. */
  async start(
    db: DbHandle,
    input: { readonly technicianProfileId: string; readonly jobId: string },
    authorizeScope?: ScopeAuthorizer
  ): Promise<LaborSessionView> {
    const profile = await this.profiles.profile(db, input.technicianProfileId);
    if (profile === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Technician ${input.technicianProfileId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: profile.companyId, branchId: profile.branchId });
    }
    if (!profile.isActive) {
      throw new AppFailure('ERR-TECH-001', {
        message: `Technician ${input.technicianProfileId} is not active`,
        safeDetails: {
          violations: [{ path: 'body.technicianProfileId', rule: 'profile-inactive' }],
        },
      });
    }

    let opened: LaborSessionRow;
    try {
      opened = await this.sessions.open(db, {
        companyId: profile.companyId,
        branchId: profile.branchId,
        technicianProfileId: input.technicianProfileId,
        jobId: input.jobId,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.exclusionViolation)) {
        // The technician already has an open session. Two open sessions would put one
        // person on two jobs at once, which is a payroll and liability problem rather
        // than a 500.
        throw new AppFailure('ERR-TECH-001', {
          message: `Technician ${input.technicianProfileId} already has an open labour session`,
          cause: error,
          safeDetails: {
            violations: [{ path: 'body.technicianProfileId', rule: 'session-already-open' }],
          },
        });
      }
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        // The job is not in this technician's company and branch, or does not exist.
        // Both answer the same 404: the caller learns only that this pairing is not
        // one they may create.
        throw new AppFailure('ERR-RES-001', {
          message: `Job ${input.jobId} is not visible in this technician's scope`,
          cause: error,
        });
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // `tech.guard_labor_session`: the job's state does not allow labour, the
        // parent work order is terminal, or the start is outside the backdating
        // window.
        throw new AppFailure('ERR-TRN-001', {
          message: `Job ${input.jobId} does not accept labour right now`,
          cause: error,
        });
      }
      throw error;
    }

    await this.auditSession(db, 'tech.labor.session_started', profile, opened);
    await this.publishSession(db, profile, opened, 'started');
    return toView(opened);
  }

  /** Stops an open session. */
  async stop(
    db: DbHandle,
    sessionId: string,
    input: { readonly expectedVersion: number },
    authorizeScope?: ScopeAuthorizer
  ): Promise<LaborSessionView> {
    const locked = await this.requireOpenSession(
      db,
      sessionId,
      input.expectedVersion,
      authorizeScope
    );
    const closed = await this.sessions.close(db, sessionId, input.expectedVersion);
    if (!closed) {
      throw new AppFailure('ERR-CON-001', {
        message: `Labour session ${sessionId} was modified by another request`,
      });
    }
    // Read back: `ended_at` was stamped by the database, so the row is the only
    // honest source for it.
    const after = await this.sessions.lock(db, sessionId);
    const view = after ?? locked;
    await this.auditSession(
      db,
      'tech.labor.session_stopped',
      { companyId: locked.companyId, branchId: locked.branchId },
      view
    );
    await this.publishSession(
      db,
      { companyId: locked.companyId, branchId: locked.branchId },
      view,
      'stopped'
    );
    return toView(view);
  }

  /**
   * Corrects a session's window.
   *
   * The original is not edited — `tech.correct_labor_session` soft-deletes it and
   * inserts a linked replacement — so the corrected hours and the hours they replaced
   * both survive. A correction is a higher authority than recording
   * (`tech.labor.correct`, risk `high` in the seeded catalog) precisely because it
   * rewrites what a technician was paid for.
   */
  async correct(
    db: DbHandle,
    sessionId: string,
    input: {
      readonly startedAt: Date;
      readonly endedAt: Date;
      readonly reason: string;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<LaborSessionView> {
    const locked = await this.sessions.lock(db, sessionId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Labour session ${sessionId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    if (locked.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Labour session ${sessionId} was modified by another request`,
      });
    }
    // A correction states a complete window, so it must be a real one. The domain
    // check reports the ordering failure before the database does.
    assertLaborWindow(input.startedAt, input.endedAt);

    let correctionId: string;
    try {
      correctionId = await this.sessions.correct(db, {
        originalId: sessionId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        reason: input.reason,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.exclusionViolation)) {
        throw new AppFailure('ERR-TECH-001', {
          message: 'The corrected window overlaps another session for this technician',
          cause: error,
          safeDetails: { violations: [{ path: 'body.startedAt', rule: 'window-overlaps' }] },
        });
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message: 'The correction was refused by the labour guard',
          cause: error,
        });
      }
      throw error;
    }

    const created = await this.sessions.lock(db, correctionId);
    if (created === null) {
      throw new AppFailure('ERR-SYS-001', { message: 'the correction row is not readable' });
    }
    await appendAudit(db, {
      action: 'tech.labor.session_corrected',
      entityType: 'tech.labor_session',
      entityId: correctionId,
      companyId: locked.companyId,
      branchId: locked.branchId,
      details: [
        { field: 'correction_of_id', classification: 'internal', value: sessionId },
        {
          field: 'started_at',
          classification: 'internal',
          previousValue: locked.startedAt.toISOString(),
          value: created.startedAt.toISOString(),
        },
        {
          field: 'ended_at',
          classification: 'internal',
          previousValue: locked.endedAt === null ? null : locked.endedAt.toISOString(),
          value: created.endedAt === null ? null : created.endedAt.toISOString(),
        },
        { field: 'reason', classification: 'internal', value: input.reason },
      ],
    });
    await this.publishSession(
      db,
      { companyId: locked.companyId, branchId: locked.branchId },
      created,
      'corrected'
    );
    return toView(created);
  }

  /** One keyset page of a job's labour log. */
  async forJob(
    db: DbHandle,
    jobId: string,
    page: SessionPageInput
  ): Promise<Page<LaborSessionView>> {
    const rows = await this.sessions.pageForJob(db, jobId, pageRequest(LABOR_SESSION_ORDER, page));
    return { ...rows, items: rows.items.map(toView) };
  }

  private async requireOpenSession(
    db: DbHandle,
    sessionId: string,
    expectedVersion: number,
    authorizeScope?: ScopeAuthorizer
  ): Promise<LaborSessionRow> {
    const locked = await this.sessions.lock(db, sessionId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Labour session ${sessionId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    if (locked.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Labour session ${sessionId} was modified by another request`,
      });
    }
    if (locked.endedAt !== null) {
      // `ended_at` is write-once in the guard, so an attempt to stop a stopped
      // session must be refused here rather than reaching the trigger as a rewrite.
      throw new AppFailure('ERR-TRN-001', {
        message: `Labour session ${sessionId} is already stopped`,
      });
    }
    return locked;
  }

  private async auditSession(
    db: DbHandle,
    action: string,
    scope: { readonly companyId: string; readonly branchId: string },
    row: LaborSessionRow
  ): Promise<void> {
    await appendAudit(db, {
      action,
      entityType: 'tech.labor_session',
      entityId: row.id,
      companyId: scope.companyId,
      branchId: scope.branchId,
      details: [
        { field: 'job_id', classification: 'internal', value: row.jobId },
        {
          field: 'technician_profile_id',
          classification: 'internal',
          value: row.technicianProfileId,
        },
        { field: 'started_at', classification: 'internal', value: row.startedAt.toISOString() },
        ...(row.endedAt === null
          ? []
          : [
              {
                field: 'ended_at',
                classification: 'internal' as const,
                value: row.endedAt.toISOString(),
              },
            ]),
      ],
    });
  }

  private async publishSession(
    db: DbHandle,
    scope: { readonly companyId: string; readonly branchId: string },
    row: LaborSessionRow,
    change: 'started' | 'stopped' | 'corrected'
  ): Promise<void> {
    await publishEvent(db, {
      eventType: 'labor.session-changed',
      aggregateId: row.id,
      aggregateVersion: row.recordVersion,
      // Owner `tech` here, unlike the job events: `tech.labor_session` IS the
      // aggregate and this module writes it, so the producer prefix matches.
      producer: 'tech.labor-session-service',
      companyId: scope.companyId,
      branchId: scope.branchId,
      payload: {
        laborSessionId: row.id,
        jobId: row.jobId,
        technicianProfileId: row.technicianProfileId,
        change,
      },
      // One event per transition of one session, so the key carries both the change
      // and the version: a start and its stop are different facts about the same row.
      eventKey: `labor.session-changed:${row.id}:${change}`,
    });
  }
}
