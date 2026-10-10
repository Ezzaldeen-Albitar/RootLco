/**
 * Translating the database's capacity refusal into a problem document.
 *
 * `org.assert_capacity_available` raises `check_violation` with a machine
 * readable message and a json DETAIL. Left alone, that arrives at the API
 * boundary as an unclassified driver error and becomes ERR-SYS-001 — a 500 in
 * the caller's face, an incident in the error monitor, and no way for an
 * administrator to learn which ceiling they reached. This function is the one
 * place that reads it.
 *
 * ## Why the check is a mapping and never a pre-check
 *
 * Asking "is there room?" before the INSERT and answering from the result would
 * be a second copy of the rule, and a copy that is wrong under concurrency: two
 * requests would both read room and both proceed. The database holds a
 * per-tenant advisory lock across the count and the write, so the refusal is the
 * authority and this function only gives it a name. Every writer therefore calls
 * the insert and maps what comes back.
 *
 * ## Why the DETAIL is parsed defensively
 *
 * The message is the contract; the DETAIL is the explanation. A refusal whose
 * DETAIL is missing or unparseable is still a refusal, so the code is still
 * ERR-CAP-001 and the response simply carries no `capacity` object. Throwing on
 * a malformed detail would turn a correct 409 into a 500.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { CapacityDetail } from '@/server/errors/app-failure';
import { SQLSTATE, isSqlState } from '@/server/db/repository';

/** The message `org.assert_capacity_available` raises when a ceiling is reached. */
export const CAPACITY_LIMIT_REACHED = 'capacity_limit_reached';
/** The message it raises when the organisation itself is not running. */
export const TENANT_NOT_ACTIVE = 'tenant_not_active';

function detailOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail?: unknown }).detail;
    return typeof detail === 'string' ? detail : undefined;
  }
  return undefined;
}

function messageOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function capacityDetail(error: unknown): CapacityDetail | undefined {
  const raw = detailOf(error);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { kind, limit, used } = parsed as Record<string, unknown>;
  if (typeof kind !== 'string') return undefined;
  if (typeof limit !== 'number' || typeof used !== 'number') return undefined;
  return { kind, limit, used };
}

/**
 * Re-throws a capacity refusal as its catalogued code, and every other error
 * unchanged.
 *
 * Declared as `never` so a caller can write `catch (error) { throwCapacityFailure(error); }`
 * and TypeScript still knows the catch block does not fall through.
 */
export function throwCapacityFailure(error: unknown): never {
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    const message = messageOf(error);
    if (message === CAPACITY_LIMIT_REACHED) {
      const capacity = capacityDetail(error);
      throw new AppFailure('ERR-CAP-001', {
        message: 'The active subscription plan permits no further capacity of this kind',
        ...(capacity === undefined ? {} : { safeDetails: { capacity } }),
        cause: error,
      });
    }
    if (message === TENANT_NOT_ACTIVE) {
      throw new AppFailure('ERR-CAP-002', {
        message: 'The organisation is not active, so it may not be grown',
        cause: error,
      });
    }
  }
  throw error;
}
