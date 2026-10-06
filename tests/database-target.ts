/**
 * The database target for the `test:db`, `test:backend` and `test:db-fixture`
 * tiers, resolved by the one shared resolver in `scripts/lib/db-target.mjs`.
 *
 * A typed wrapper, not a second rule: every decision — explicit port, agreeing
 * sources, the local acceptance database refused without its forward-apply
 * authorisation — is made there. A test helper that read `DB_PORT` itself with
 * a fallback would be the silent default that rule exists to remove, and
 * `tests/ci/db-target-contract.test.ts` fails if one does.
 *
 * Resolution throws, so a suite pointed at nothing, at two things, or at the
 * acceptance database stops at import with the reason, before any connection.
 */
import { resolveDatabaseTarget } from '../scripts/lib/db-target.mjs';

export interface TestDatabaseTarget {
  readonly host: string;
  readonly port: number;
}

export function resolveTestDatabaseTarget(consumer: string): TestDatabaseTarget {
  const { host, port } = resolveDatabaseTarget({ consumer });
  return { host, port };
}
