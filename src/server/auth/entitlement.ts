/**
 * Feature-entitlement middleware (P1-13-BE-014, BR-TEN-001).
 *
 * Entitlement is resolved by `org.resolve_feature_enabled(flag, at)`, which
 * applies the documented precedence — tenant override, then the plan effective
 * at the given instant, then the platform default — and raises rather than
 * returning false for an unregistered flag. That last property is the one worth
 * protecting: a typo'd flag code must not silently disable a feature, and it
 * must not silently *enable* one either.
 *
 * `at` defaults to the request's start time, so a command is evaluated against
 * the entitlement effective when it was issued, not when it happened to reach
 * the database. That is BR-TEN-001, and it matters for a request that queues
 * behind a slow transaction across a plan boundary.
 *
 * Entitlement runs **after** authorization. A caller who is not permitted must
 * not learn which features a tenant has bought — running it first would leak
 * subscription shape to an unauthorized caller.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';
import { contextLogFields } from '../context/request-context';
import { log } from '../observability/logger';
import { metrics, METRICS } from '../observability/metrics';
import { sqlState } from '../db/repository';

/** SQLSTATE raised by `org.resolve_feature_enabled` for an unknown flag. */
const NO_DATA_FOUND = 'P0002';

export class UnregisteredFeatureFlagError extends Error {
  public override readonly name = 'UnregisteredFeatureFlagError';
  constructor(flagCode: string) {
    super(`Feature flag "${flagCode}" is not registered in org.feature_flags`);
  }
}

/**
 * Resolves whether a flag is enabled for the request's tenant.
 *
 * Throws `UnregisteredFeatureFlagError` for an unknown flag — a configuration
 * defect, surfaced as `ERR-SYS-001` at the boundary, never as a quiet denial.
 */
export async function isFeatureEnabled(
  db: DbHandle,
  flagCode: string,
  at?: Date
): Promise<boolean> {
  try {
    const result = await db.query<{ enabled: boolean }>(
      'SELECT org.resolve_feature_enabled($1, $2) AS enabled',
      [flagCode, at ?? db.context.startedAt]
    );
    return result.rows[0]?.enabled === true;
  } catch (error) {
    if (sqlState(error) === NO_DATA_FOUND) {
      throw new UnregisteredFeatureFlagError(flagCode);
    }
    throw error;
  }
}

/**
 * Enforces entitlement, throwing `ERR-TEN-001` before the handler body runs.
 * The denial does not name the flag: flag codes are internal product shape, and
 * probing them is a documented abuse case (P1-13-SEC-005).
 */
export async function requireFeature(db: DbHandle, flagCode: string, at?: Date): Promise<void> {
  const enabled = await isFeatureEnabled(db, flagCode, at);
  if (enabled) return;

  metrics().increment(METRICS.errorCount, { code: 'ERR-TEN-001' });
  log.warn('Feature not entitled', {
    ...contextLogFields(db.context),
    result: 'denied',
    errorCode: 'ERR-TEN-001',
    // The flag code is logged (operator-facing) but never returned (caller-facing).
    context: { flagCode },
  });

  throw new AppFailure('ERR-TEN-001', {
    message: `Tenant is not entitled to feature "${flagCode}"`,
  });
}
