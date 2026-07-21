/**
 * Runtime privilege preflight (P1-13-SEC-002, DBCR-P1-13-001).
 *
 * The Release 2 database is frozen, and P1-12 measured its grant surface. The
 * backend foundation needs four *write* capabilities that the current grant set
 * does not give the `app_runtime` archetype:
 *
 *   - append an audit record  (`iam.audit_append`  — EXECUTE: owner only)
 *   - write a domain event    (`shared.event_outbox`     — INSERT: app_worker only)
 *   - store an idempotency key(`shared.idempotency_keys` — no app-role grant, no policy)
 *   - record a security event (`iam.security_events`     — SELECT only)
 *
 * That gap is raised as **DBCR-P1-13-001**, not patched here: P1-13 must not
 * add or modify a migration (phase scope, and the migration-immutability CI gate).
 *
 * This module turns the gap from an assumption into a *measurement*. It asks
 * PostgreSQL what the current connection may actually do, so:
 *
 *  - the change request carries executed evidence rather than a reading of a
 *    migration file;
 *  - the foundation services fail closed with a precise message instead of a
 *    bare `42501` from three layers down;
 *  - the day the change request is approved and applied, the same preflight
 *    turns green with no application change.
 *
 * **Failing closed matters more than working.** A foundation that "degrades
 * gracefully" by skipping the audit append would produce state changes with no
 * evidence — worse than refusing the command.
 */
import type { DbHandle } from './transaction';

/** The write capabilities the foundation needs beyond the frozen SELECT surface. */
export const FOUNDATION_CAPABILITIES = [
  'audit.append',
  'outbox.publish',
  'idempotency.store',
  'security-event.record',
] as const;

export type FoundationCapability = (typeof FOUNDATION_CAPABILITIES)[number];

export interface CapabilityReport {
  readonly capability: FoundationCapability;
  readonly available: boolean;
  /** The exact privilege that was probed, for the change-request evidence. */
  readonly probe: string;
}

export interface PrivilegePreflight {
  /** The database role the connection is currently running as. */
  readonly currentRole: string;
  /** True only when the role has no BYPASSRLS attribute (P1-13-SEC-002). */
  readonly bypassRlsAbsent: boolean;
  readonly capabilities: readonly CapabilityReport[];
  /** Capabilities that are missing. Empty means the CR has been applied. */
  readonly missing: readonly FoundationCapability[];
}

const PROBES: Readonly<Record<FoundationCapability, { sql: string; probe: string }>> = {
  'audit.append': {
    probe: "has_function_privilege(current_user, 'iam.audit_append(...)', 'EXECUTE')",
    sql: `SELECT COALESCE(
            (SELECT has_function_privilege(current_user, p.oid, 'EXECUTE')
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'iam' AND p.proname = 'audit_append' LIMIT 1), false) AS ok`,
  },
  'outbox.publish': {
    probe: "has_table_privilege(current_user, 'shared.event_outbox', 'INSERT')",
    sql: `SELECT has_table_privilege(current_user, 'shared.event_outbox', 'INSERT') AS ok`,
  },
  'idempotency.store': {
    probe: "has_table_privilege(current_user, 'shared.idempotency_keys', 'INSERT')",
    sql: `SELECT has_table_privilege(current_user, 'shared.idempotency_keys', 'INSERT') AS ok`,
  },
  'security-event.record': {
    probe: "has_table_privilege(current_user, 'iam.security_events', 'INSERT')",
    sql: `SELECT has_table_privilege(current_user, 'iam.security_events', 'INSERT') AS ok`,
  },
};

/**
 * Measures what the current connection may do. Read-only: it issues only
 * `has_*_privilege` probes and a `pg_roles` lookup, so it is safe to run at boot
 * and inside a read-only transaction.
 */
export async function preflightPrivileges(db: DbHandle): Promise<PrivilegePreflight> {
  const roleResult = await db.query<{ role: string; bypassrls: boolean }>(
    `SELECT current_user AS role,
            COALESCE((SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user), false)
              AS bypassrls`
  );
  const role = roleResult.rows[0]?.role ?? 'unknown';
  const bypassRls = roleResult.rows[0]?.bypassrls ?? false;

  const capabilities: CapabilityReport[] = [];
  for (const capability of FOUNDATION_CAPABILITIES) {
    const definition = PROBES[capability];
    const result = await db.query<{ ok: boolean }>(definition.sql);
    capabilities.push({
      capability,
      available: result.rows[0]?.ok === true,
      probe: definition.probe,
    });
  }

  return {
    currentRole: role,
    bypassRlsAbsent: !bypassRls,
    capabilities,
    missing: capabilities.filter((entry) => !entry.available).map((entry) => entry.capability),
  };
}

/**
 * Cached per process so request paths do not re-probe on every call. The grant
 * surface changes only by migration, i.e. by a deployment.
 */
let cached: PrivilegePreflight | undefined;

export async function foundationCapabilities(db: DbHandle): Promise<PrivilegePreflight> {
  if (!cached) cached = await preflightPrivileges(db);
  return cached;
}

export function __resetCapabilitiesForTests(): void {
  cached = undefined;
}
