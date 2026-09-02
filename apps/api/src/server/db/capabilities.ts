/**
 * Runtime privilege preflight (P1-13-SEC-002, DBCR-P1-13-001).
 *
 * The backend foundation needs four *write* capabilities beyond the Release 2
 * baseline's SELECT-only surface:
 *
 *   - append an audit record   (`iam.audit_append`        — EXECUTE)
 *   - write a domain event     (`shared.event_outbox`     — INSERT)
 *   - store an idempotency key (`shared.idempotency_keys` — INSERT)
 *   - record a security event  (`iam.security_events`     — INSERT)
 *
 * The baseline granted none of them to `app_runtime`; **DBCR-P1-13-001** and its
 * migration (`20260725090000_iam_shared_runtime_write_capabilities.sql`) grant
 * all four, tenant-scoped, with no UPDATE and no DELETE.
 *
 * This module exists because "the migration is applied" is a claim about a
 * deployment, not a property of the code. It asks PostgreSQL what the current
 * connection may actually do, so:
 *
 *  - the grant surface is a *measurement* rather than an assumption, on every
 *    environment the application boots in;
 *  - a connection opened as the wrong role fails closed with a precise message
 *    instead of a bare `42501` from three layers down.
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
/**
 * One preflight per CONNECTION, not per process. The control-plane pool acts
 * as `app_platform`, whose capability matrix is narrower than `app_runtime`'s
 * (no outbox, no runtime idempotency), and both pools live in one process. A
 * single cached preflight let whichever connection ran first answer for the
 * other: measured in P1-29 W9, a provisioning request primed the cache with
 * the platform role and every tenant write that followed was refused for a
 * capability the runtime role plainly holds.
 */
const cached = new Map<'primary' | 'platform', PrivilegePreflight>();

export async function foundationCapabilities(db: DbHandle): Promise<PrivilegePreflight> {
  const connection = db.connection ?? 'primary';
  const known = cached.get(connection);
  if (known) return known;
  const preflight = await preflightPrivileges(db);
  cached.set(connection, preflight);
  return preflight;
}

export function __resetCapabilitiesForTests(): void {
  cached.clear();
}
