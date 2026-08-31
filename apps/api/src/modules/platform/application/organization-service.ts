/**
 * Control-plane organisation service (PRE-P1-29 Wave B).
 *
 * Thin by design. The invariants that matter here are enforced in the database —
 * the bootstrap window, the transition graph, the append-only history, the
 * authority predicate on every policy — so a service that re-implemented them in
 * TypeScript would create a second place for them to drift. What it does own is
 * the two things the database cannot see: the operation's request shape, and the
 * rule that no caller value ever becomes an authorization principal.
 */
import { appendAudit } from '@/server/audit/audit';
import type { DbHandle } from '@/server/db/transaction';
import type { OrganizationRow, PlatformRepository } from '../data/platform-repository';

export interface OrganizationView {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
}

/**
 * What provisioning returns to the caller.
 *
 * Named and exported rather than written inline, because it crosses the wire:
 * an anonymous return type is invisible to the generated client and to anyone
 * reading the contract. Deliberately just the identifier — the caller reads the
 * organisation back through platform.organization-read rather than being handed
 * a projection built at creation time, so there is exactly one shape describing
 * a tenant and it is the one the read publishes.
 */
export interface ProvisionedOrganization {
  readonly tenantId: string;
}

export class OrganizationService {
  constructor(private readonly repository: PlatformRepository) {}

  /** §6.5 — the tenant root and nothing beneath it. */
  async read(
    db: DbHandle,
    params: { readonly tenantId?: string; readonly limit: number }
  ): Promise<readonly OrganizationView[]> {
    const rows = await this.repository.listOrganizations(db, params);
    return rows.map(toView);
  }

  /** §6.2 — the sanctioned provisioning path, with activation deliberately unset. */
  async provision(
    db: DbHandle,
    spec: Readonly<Record<string, unknown>>,
    idempotencyKey: string
  ): Promise<ProvisionedOrganization> {
    const result = await this.repository.provisionOrganization(db, spec, idempotencyKey);

    // Both control-plane writes declare auditClass: 'privileged' with a named
    // action, and NEITHER is written by the pipeline: route-handler validates
    // the declaration against the controlled catalogue and stops there, so an
    // operation can declare a privileged class, pass every structural gate, and
    // append nothing for the life of the product. Measured on this very pair —
    // both wrote zero rows until these two calls existed.
    const tenant = (spec.tenant ?? {}) as Record<string, unknown>;
    await appendAudit(db, {
      action: 'org.tenant.provisioned',
      entityType: 'org.tenant',
      entityId: result.tenantId,
      details: [
        { field: 'tenant_code', classification: 'public', value: String(tenant.code ?? '') },
        {
          field: 'display_name',
          classification: 'public',
          value: String(tenant.display_name ?? ''),
        },
      ],
    });

    return result;
  }

  /**
   * §6.4 — the lifecycle transition.
   *
   * No actor is threaded through. The history row's `actor_id` is server-derived
   * by the shared stamp from `iam.current_user_id()`, which is also the value the
   * platform-authority predicate resolves from — so attribution and authority
   * come from the same trusted place and a request document cannot influence
   * either.
   */
  async changeStatus(
    db: DbHandle,
    params: {
      readonly tenantId: string;
      readonly toState: string;
      readonly reason: string;
      readonly correlationId?: string;
    }
  ): Promise<void> {
    await this.repository.changeStatus(db, params);

    // Appended AFTER the transition, so a refusal by the M4 graph guard leaves
    // no record of a change that did not happen. The reason is caller-supplied
    // justification rather than a system value, so it is classified 'internal'
    // — it is already stored verbatim in org.tenant_status_history, and the
    // audit trail should not be the more exposed of the two copies.
    await appendAudit(db, {
      action: 'org.tenant.status_changed',
      entityType: 'org.tenant',
      entityId: params.tenantId,
      details: [
        { field: 'to_status', classification: 'public', value: params.toState },
        { field: 'reason', classification: 'internal', value: params.reason },
      ],
    });
  }
}

function toView(row: OrganizationRow): OrganizationView {
  return {
    id: row.id,
    tenantCode: row.tenantCode,
    displayName: row.displayName,
    status: row.status,
    defaultLocale: row.defaultLocale,
    defaultTimezone: row.defaultTimezone,
    createdAt: row.createdAt,
  };
}
