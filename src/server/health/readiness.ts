/**
 * Health and readiness signals (P1-13-DO-002, load-balancer readiness).
 *
 * The distinction is the whole point, and getting it wrong is how a rolling
 * deploy drops traffic:
 *
 *  - **Liveness** — "is this process alive?" A live-but-not-ready instance must
 *    NOT be restarted; it is starting up or draining.
 *  - **Readiness** — "should a load balancer send this instance work?" Readiness
 *    goes false first during shutdown, so the balancer stops sending requests
 *    before the process stops accepting them.
 *
 * The web role and the worker role report separately because they scale, fail,
 * and drain independently — a worker that cannot reach the queue must leave the
 * rotation without taking the web tier with it.
 *
 * No HTTP route is added here: `/api/health` (Phase 1-1) remains the container
 * probe, and the phase plan assigns the richer health endpoints to Phase 1-15.
 * These functions are the signal; wiring them to routes is that phase's work.
 */
import { withReadOnlyTransaction } from '../db/transaction';
import { buildRequestContext } from '../context/request-context';
import { preflightPrivileges } from '../db/capabilities';
import { newCorrelationId } from '../observability/correlation';
import { workerQuery } from '../worker/worker-db';
import { queueHealth } from '../worker/outbox-worker';

export type ReadinessState = 'ready' | 'degraded' | 'unavailable';

export interface ReadinessReport {
  readonly role: 'web' | 'worker';
  readonly state: ReadinessState;
  /** Machine-readable reasons. Never a raw driver message. */
  readonly checks: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly detail?: string;
  }[];
}

/**
 * Web-role readiness: the database answers, the connection role is not a
 * BYPASSRLS role, and the foundation's write capabilities are reported.
 *
 * A missing write capability is **degraded, not unavailable**: reads work, and
 * taking the whole tier out of rotation for a grant gap would turn a documented
 * change request into an outage.
 */
export async function foundationReadiness(probeTenantId: string): Promise<ReadinessReport> {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  try {
    const context = buildRequestContext({
      correlationId: newCorrelationId(),
      principal: { userId: probeTenantId, tenantId: probeTenantId },
      operation: 'platform.readiness',
      module: 'platform',
    });

    const preflight = await withReadOnlyTransaction(context, (db) => preflightPrivileges(db));

    checks.push({ name: 'database.reachable', ok: true });
    checks.push({
      name: 'database.role.no-bypassrls',
      ok: preflight.bypassRlsAbsent,
      detail: preflight.currentRole,
    });
    for (const capability of preflight.capabilities) {
      checks.push({ name: `capability.${capability.capability}`, ok: capability.available });
    }

    const blocking = checks.filter((check) => !check.ok && check.name.startsWith('database.'));
    const degraded = checks.some((check) => !check.ok);
    return {
      role: 'web',
      state: blocking.length > 0 ? 'unavailable' : degraded ? 'degraded' : 'ready',
      checks,
    };
  } catch {
    // Never surface the driver message: readiness output is frequently public.
    return {
      role: 'web',
      state: 'unavailable',
      checks: [...checks, { name: 'database.reachable', ok: false }],
    };
  }
}

/**
 * Worker-role readiness: the queue is reachable and the worker loop is claiming.
 * Queue depth and dead letters are reported but do not by themselves make the
 * worker unready — a deep queue means "work to do", not "broken".
 */
export async function workerReadiness(isRunning: boolean): Promise<ReadinessReport> {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  try {
    const health = await queueHealth({ query: workerQuery });
    checks.push({ name: 'queue.reachable', ok: true });
    checks.push({ name: 'worker.loop.running', ok: isRunning });
    checks.push({
      name: 'queue.depth',
      ok: true,
      detail: `${health.depth} pending/claimed, oldest ${health.oldestAgeSeconds}s`,
    });
    checks.push({
      name: 'queue.dead-letters',
      ok: health.deadLetterCount === 0,
      detail: String(health.deadLetterCount),
    });
    return {
      role: 'worker',
      state: isRunning ? (health.deadLetterCount === 0 ? 'ready' : 'degraded') : 'unavailable',
      checks,
    };
  } catch {
    return {
      role: 'worker',
      state: 'unavailable',
      checks: [...checks, { name: 'queue.reachable', ok: false }],
    };
  }
}
