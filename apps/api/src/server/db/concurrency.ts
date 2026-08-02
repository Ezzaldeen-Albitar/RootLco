/**
 * Optimistic concurrency (P1-13-BE-013).
 *
 * Every versioned table in the Release 2 schema carries `record_version integer
 * NOT NULL DEFAULT 1`. The contract is:
 *
 *   UPDATE … SET …, record_version = record_version + 1
 *    WHERE id = $id AND tenant_id = $tenant AND record_version = $expected
 *
 * If zero rows are affected the caller's version was stale (or the row is out of
 * scope) and the update is rejected with `ERR-CON-001`. The predicate and the
 * increment are in one statement, so there is no read-modify-write window: two
 * concurrent updaters with the same expected version cannot both succeed, and
 * the version increments exactly once per successful update.
 *
 * A stale version and an out-of-scope row are deliberately indistinguishable —
 * reporting "wrong version" only when the row exists would leak existence.
 */
import { AppFailure } from '../errors/app-failure';

/** Header carrying the expected record version. */
export const IF_MATCH_HEADER = 'if-match';

/**
 * Parses `If-Match`. Accepts a bare integer and the quoted ETag form `"7"`, both
 * of which appear in real clients; anything else is a client contract error.
 */
export function parseIfMatch(headers: Headers, required: boolean): number | null {
  const raw = headers.get(IF_MATCH_HEADER);
  if (!raw) {
    if (!required) return null;
    throw new AppFailure('ERR-CON-002', {
      message: 'If-Match header is required for this operation',
    });
  }
  const trimmed = raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = Number(trimmed);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppFailure('ERR-CON-002', {
      message: 'If-Match must be a positive integer record version',
    });
  }
  return version;
}

/** Formats a record version as an ETag for the response. */
export function toETag(recordVersion: number): string {
  return `"${recordVersion}"`;
}

/**
 * Converts an update's row count into a decision.
 *
 * Call immediately after a version-guarded UPDATE. Zero rows always means
 * conflict — never "not found", because distinguishing them leaks existence.
 */
export function assertVersionMatched(rowCount: number | null): void {
  if ((rowCount ?? 0) === 0) {
    throw new AppFailure('ERR-CON-001', {
      message: 'Record version did not match, or the row is outside the caller scope',
    });
  }
}

/**
 * Builds the version-guard fragment for an UPDATE. Column names are code
 * constants, values are always bound.
 */
export function versionGuardFragment(startParamIndex: number): {
  setClause: string;
  predicate: string;
} {
  return {
    setClause: 'record_version = record_version + 1',
    predicate: `record_version = $${startParamIndex}`,
  };
}
