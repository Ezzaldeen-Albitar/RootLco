/**
 * Platform statistics, operational health and the operator's own audit trail
 * (P1-32-PRE-025/026).
 *
 * ## Statistics are computed, never cached, never estimated
 *
 * Every figure is one SQL aggregate over the live tables, read inside the
 * request's transaction. There is no materialised summary to go stale and no
 * sampling. `generatedAt` is when this process produced the document and `asOf`
 * is the database's own `now()` for the same transaction — two clocks, stated
 * separately, because a console that shows one timestamp invites the reader to
 * assume they are the same.
 *
 * ## Operational health reuses the existing probes
 *
 * `foundationReadiness` and `queueHealth` are the functions the readiness
 * endpoint and the worker already use; calling them rather than re-deriving
 * their checks means the console and the load balancer can never disagree about
 * whether the platform is healthy. Both are wrapped: a health probe that throws
 * must degrade the HEALTH section, not fail the whole statistics read, because
 * the moment the queue is unreachable is exactly the moment an operator opens
 * this screen.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { type Page, pageRequest } from '@/server/db/pagination';
import { foundationReadiness } from '@/server/health/readiness';
import { queueHealth } from '@/server/worker/outbox-worker';
import { workerQuery } from '@/server/worker/worker-db';
import {
  type CapacityAlertRow,
  type CountByKey,
  type InsightRepository,
  PLATFORM_AUDIT_ORDERING,
  type PlatformAuditRow,
  type RevenueByCurrencyRow,
  type SubscriptionHorizon,
} from '../data/insight-repository';

/** The widest window the audit search accepts, matching `iam.audit-event-list`. */
export const MAX_AUDIT_WINDOW_DAYS = 92;
const DAY_MS = 86_400_000;

/** Operational health, from the same probes the platform already runs. */
export interface OperationalHealthView {
  /** `ready` | `degraded` | `unavailable`, from `foundationReadiness`. */
  readonly readiness: string;
  readonly readinessChecks: readonly { readonly name: string; readonly ok: boolean }[];
  readonly outbox: {
    /** False when the worker connection could not be reached at all. */
    readonly reachable: boolean;
    /** Events waiting or claimed. Counts only; no payload is ever read here. */
    readonly undelivered: number | null;
    readonly deadLettered: number | null;
    readonly oldestPendingAgeSeconds: number | null;
  };
}

/** What `platform.statistics-read` publishes. */
export interface PlatformStatisticsView {
  /** When this process produced the document (ISO-8601). */
  readonly generatedAt: string;
  /** The database's own `now()` the figures were read at (ISO-8601). */
  readonly asOf: string;
  readonly tenantsByStatus: readonly CountByKey[];
  readonly activeCompanies: number;
  readonly activeBranches: number;
  readonly activeUserAccounts: number;
  readonly subscriptions: SubscriptionHorizon;
  readonly capacityAlerts: readonly CapacityAlertRow[];
  /**
   * Platform revenue per currency. Every amount is a decimal string, and
   * `projectedRenewalValue` is a planning figure — not a receivable.
   */
  readonly revenueByCurrency: readonly RevenueByCurrencyRow[];
  readonly health: OperationalHealthView;
}

export class InsightService {
  constructor(private readonly insight: InsightRepository) {}

  async statistics(db: DbHandle): Promise<PlatformStatisticsView> {
    const generatedAt = new Date().toISOString();
    const asOf = await this.insight.readDatabaseNow(db);

    // Sequential on purpose: one connection, and `pg` deprecates overlapping
    // queries on a single client.
    const tenantsByStatus = await this.insight.countTenantsByStatus(db);
    const entities = await this.insight.countPlatformEntities(db);
    const subscriptions = await this.insight.summariseSubscriptions(db);
    const capacityAlerts = await this.insight.listCapacityAlerts(db);
    const revenueByCurrency = await this.insight.summariseRevenue(db);

    return {
      generatedAt,
      asOf,
      tenantsByStatus,
      activeCompanies: entities.activeCompanies,
      activeBranches: entities.activeBranches,
      activeUserAccounts: entities.activeUserAccounts,
      subscriptions,
      capacityAlerts,
      revenueByCurrency,
      health: await this.health(db),
    };
  }

  /**
   * The operator's own audit trail.
   *
   * `from` and `to` are mandatory and the window is capped at 92 days, for the
   * reason `iam.audit-event-list` gives: a default range would make the most
   * expensive query the one a caller gets by asking for nothing.
   */
  async searchAudit(
    db: DbHandle,
    filters: {
      readonly from: string;
      readonly to: string;
      readonly action?: string | undefined;
      readonly actorId?: string | undefined;
      readonly targetTenantId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined }
  ): Promise<Page<PlatformAuditRow>> {
    const from = Date.parse(filters.from);
    const to = Date.parse(filters.to);
    if (to < from) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The end of the audit window must not precede its start',
        safeDetails: { violations: [{ path: 'query.to', rule: 'before_from' }] },
      });
    }
    if (to - from > MAX_AUDIT_WINDOW_DAYS * DAY_MS) {
      throw new AppFailure('ERR-VAL-001', {
        message: `The audit window may not exceed ${MAX_AUDIT_WINDOW_DAYS} days`,
        safeDetails: { violations: [{ path: 'query.to', rule: 'window_too_wide' }] },
      });
    }
    return this.insight.searchAuditRecords(db, filters, pageRequest(PLATFORM_AUDIT_ORDERING, page));
  }

  /**
   * Operational health from the platform's own probes.
   *
   * The readiness probe is keyed by the operator's HOME tenant: it needs a
   * tenant to build a context for its privilege preflight, and the home tenant
   * is the one this principal legitimately belongs to. No request value reaches
   * it.
   */
  private async health(db: DbHandle): Promise<OperationalHealthView> {
    let readiness = 'unavailable';
    let readinessChecks: readonly { name: string; ok: boolean }[] = [];
    try {
      const report = await foundationReadiness(db.context.principal.tenantId);
      readiness = report.state;
      readinessChecks = report.checks.map((check) => ({ name: check.name, ok: check.ok }));
    } catch {
      // foundationReadiness already swallows its own failures; this is the
      // belt for a failure in building the probe itself.
    }

    try {
      const queue = await queueHealth({ query: workerQuery });
      return {
        readiness,
        readinessChecks,
        outbox: {
          reachable: true,
          undelivered: queue.depth,
          deadLettered: queue.deadLetterCount,
          oldestPendingAgeSeconds: queue.oldestAgeSeconds,
        },
      };
    } catch {
      // The worker connection is separately configured and may be absent in an
      // environment that runs no worker. That is reported as unreachable, with
      // nulls rather than zeros: zero would claim the queue is empty, which is a
      // statement nobody measured.
      return {
        readiness,
        readinessChecks,
        outbox: {
          reachable: false,
          undelivered: null,
          deadLettered: null,
          oldestPendingAgeSeconds: null,
        },
      };
    }
  }
}
