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
import { AppFailure } from '@/server/errors/app-failure';
import { type DbHandle, withPlatformTarget } from '@/server/db/transaction';
import { type FirstOwnerInput, iamModule } from '@/modules/iam';
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
  /** The first human principal of the tenant (P1-29 W9). */
  readonly ownerAccountId: string;
  /** `first_owner` — the narrow bootstrap IAM authority (frozen B7). */
  readonly firstOwnerRoleId: string;
  /** `tenant_administrator` — the tenant's ordinary administration role. */
  readonly tenantAdministratorRoleId: string;
  /** True when the request asked for activation and the tenant is now `active`. */
  readonly activated: boolean;
}

/** What provisioning takes beyond the organisation spec: the Owner, and whether to activate. */
export interface ProvisionCommand {
  readonly spec: Readonly<Record<string, unknown>>;
  readonly owner: FirstOwnerInput;
  readonly activate: boolean;
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

  /**
   * §6.2 + §6.3 — the sanctioned provisioning path, both halves in ONE
   * transaction (P1-29 W9):
   *
   *  1. the organisation: `org.provision_organization` writes tenant, history,
   *     subscription, company, branch, settings, overrides, sequences and the
   *     replay record — with `tenant.activate` NEVER forwarded, so the tenant
   *     is `provisioning` and the §6.3 window is open;
   *  2. the platform-on-target window, derived from what step 1 returned and
   *     never from the request: the First-Owner bootstrap writes the account,
   *     `first_owner`, `tenant_administrator`, their mappings and grants;
   *  3. the audit record, inside the same window, so the new tenant's own
   *     trail carries its genesis with the identifiers the bootstrap produced;
   *  4. only then, and only when asked, activation through the same function
   *     the lifecycle operation uses — AFTER a usable administrator exists.
   *
   * Any refusal at any step throws, and the transaction the route opened rolls
   * back all four. The committed states are therefore exactly two: nothing, or
   * a tenant with its administrator (active if requested).
   *
   * Activation needs the lifecycle authority as well as the provisioning one,
   * because `upd_tenants_platform` is predicated on it. That is checked BEFORE
   * the first write, so a caller who cannot activate is refused with nothing
   * created rather than after a rolled-back tenant.
   */
  async provision(
    db: DbHandle,
    command: ProvisionCommand,
    idempotencyKey: string
  ): Promise<ProvisionedOrganization> {
    if (command.activate) {
      await this.requireLifecycleAuthority(db);
    }

    // The Owner's identity and profile ride inside the spec so the function's
    // own replay fingerprint (md5 of the whole document) covers them: the same
    // key with a different Owner is a different request at BOTH layers.
    const spec = {
      ...command.spec,
      owner: { email: command.owner.email, display_name: command.owner.displayName },
    };
    const created = await this.repository.provisionOrganization(db, spec, idempotencyKey);

    const tenant = (command.spec.tenant ?? {}) as Record<string, unknown>;
    const bootstrap = await withPlatformTarget(db, created.tenantId, async (target) => {
      const owner = await iamModule().tenantBootstrap.bootstrapFirstOwner(target, command.owner);

      // Both control-plane writes declare auditClass: 'privileged' with a named
      // action, and NEITHER is written by the pipeline: route-handler validates
      // the declaration against the controlled catalogue and stops there, so an
      // operation can declare a privileged class, pass every structural gate,
      // and append nothing for the life of the product. Measured on this very
      // pair — both wrote zero rows until these calls existed. The record is
      // written in the TARGET tenant's context: it is that tenant's genesis.
      // Identifiers only — no credential, token or secret ever reaches it.
      await appendAudit(target, {
        action: 'org.tenant.provisioned',
        entityType: 'org.tenant',
        entityId: created.tenantId,
        details: [
          { field: 'tenant_code', classification: 'public', value: String(tenant.code ?? '') },
          {
            field: 'display_name',
            classification: 'public',
            value: String(tenant.display_name ?? ''),
          },
          { field: 'owner_account_id', classification: 'internal', value: owner.ownerAccountId },
          {
            field: 'first_owner_role_id',
            classification: 'internal',
            value: owner.firstOwnerRoleId,
          },
          {
            field: 'tenant_administrator_role_id',
            classification: 'internal',
            value: owner.tenantAdministratorRoleId,
          },
          { field: 'activated', classification: 'public', value: String(command.activate) },
        ],
      });
      return owner;
    });

    if (command.activate) {
      await this.repository.changeStatus(db, {
        tenantId: created.tenantId,
        toState: 'active',
        reason: 'activated at provisioning, after the first-owner bootstrap',
        correlationId: db.context.correlationId,
      });
    }

    return {
      tenantId: created.tenantId,
      ownerAccountId: bootstrap.ownerAccountId,
      firstOwnerRoleId: bootstrap.firstOwnerRoleId,
      tenantAdministratorRoleId: bootstrap.tenantAdministratorRoleId,
      activated: command.activate,
    };
  }

  /** The lifecycle predicate, asked of the database before anything is written. */
  private async requireLifecycleAuthority(db: DbHandle): Promise<void> {
    const held = await this.repository.holdsPlatformAuthority(
      db,
      'platform.organization.lifecycle'
    );
    if (!held) {
      throw new AppFailure('ERR-IAM-001', {
        message:
          'Activation at provisioning requires platform.organization.lifecycle; provision without `activate` or activate later',
      });
    }
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
