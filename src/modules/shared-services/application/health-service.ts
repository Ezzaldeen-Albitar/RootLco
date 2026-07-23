/**
 * Versioned health projections (P1-15).
 *
 * `/api/health` is untouched: it is asserted to return exactly seven keys, it is
 * the container healthcheck in `docker-compose.yml` (`curl -fsS`, which fails on
 * any non-2xx), and changing its shape would break a probe to gain nothing. The
 * P1-15 endpoints live at new versioned paths and are *projections* of the
 * signals P1-13 already computes.
 *
 * ## Liveness answers one question and touches nothing
 *
 * "Is this process running?" — no database, no provider, no configuration read,
 * no write. A liveness probe that touches the database restarts a healthy
 * process every time the database hiccups, which converts a brief dependency
 * blip into a rolling outage.
 *
 * ## Readiness reports a verdict, never a topology
 *
 * `foundationReadiness()` returns rich internal detail — including the database
 * **role name** it is connected as. That is exactly right for an operator
 * reading a log and exactly wrong for an HTTP response that is routinely
 * unauthenticated and reachable from a load balancer's network. So this
 * projection keeps the check *names* and the boolean verdicts, and drops every
 * `detail`. No role, no host, no bucket, no database name, no driver message,
 * and no stack trace can reach the response, because none of them is copied into
 * it in the first place.
 *
 * The probe is also **bounded**: `READINESS_TIMEOUT_MS` caps the whole thing, so
 * a hanging dependency yields a fast `unavailable` instead of holding a
 * connection until the balancer's own timeout fires.
 */
import { foundationReadiness, type ReadinessState } from '@/server/health/readiness';
import { metrics, METRICS } from '@/server/observability/metrics';
import { backendConfig } from '@/server/config/backend-config';

/** Liveness payload. Deliberately tiny and deliberately constant-shaped. */
export interface LivenessReport {
  readonly status: 'alive';
  /** Seconds this process has been running. Not a clock, not a hostname. */
  readonly uptimeSeconds: number;
}

export interface ReadinessProjection {
  readonly status: ReadinessState;
  /** Check name plus verdict. Never a detail string. */
  readonly checks: readonly { readonly name: string; readonly ok: boolean }[];
}

export class HealthService {
  /** No I/O at all. Safe to call at any rate. */
  liveness(): LivenessReport {
    return { status: 'alive', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /**
   * Readiness, bounded and stripped.
   *
   * A timeout is reported as `unavailable` with a single `readiness.timeout`
   * check rather than as an error: a probe that throws produces a 500 whose body
   * is a problem document, and a load balancer reading it learns more about the
   * failure than it needs to.
   */
  async readiness(probeTenantId: string): Promise<ReadinessProjection> {
    const config = backendConfig();
    const startedAt = performance.now();

    let timer: NodeJS.Timeout | undefined;
    try {
      const report = await Promise.race([
        foundationReadiness(probeTenantId),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), config.READINESS_TIMEOUT_MS);
        }),
      ]);

      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (report === 'timeout') {
        metrics().increment(METRICS.readinessCheckCount, { result: 'timeout' });
        metrics().observe(METRICS.readinessCheckDuration, durationMs, { result: 'timeout' });
        return { status: 'unavailable', checks: [{ name: 'readiness.timeout', ok: false }] };
      }

      metrics().increment(METRICS.readinessCheckCount, { result: report.state });
      metrics().observe(METRICS.readinessCheckDuration, durationMs, { result: report.state });
      return {
        status: report.state,
        // Names and booleans only. `detail` is dropped, not summarised.
        checks: report.checks.map((check) => ({ name: check.name, ok: check.ok })),
      };
    } catch {
      metrics().increment(METRICS.readinessCheckCount, { result: 'error' });
      return { status: 'unavailable', checks: [{ name: 'readiness.error', ok: false }] };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
