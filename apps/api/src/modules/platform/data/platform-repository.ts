/**
 * Control-plane repository (PRE-P1-29 Wave B).
 *
 * Every statement here runs on the PLATFORM connection, as `app_platform`, and
 * is bounded by that role's own privileges and policies — not by a tenant
 * predicate. That is the whole difference between this module and every other
 * one in the product: the reads deliberately cross the tenant boundary, and what
 * stops them going further is `iam.has_platform_authority` inside each policy.
 *
 * So there is no `tenant_id = iam.current_tenant_id()` predicate on the read
 * below, and its absence is a decision rather than an omission. `org.tenants`
 * carries `sel_tenants_platform`, whose `USING` is a disjunction of the three
 * platform authorities with no row term, so a holder reads every tenant row and
 * a non-holder reads none. Adding a tenant predicate here would make the
 * control-plane read return the operator's own tenant only, which is exactly the
 * capability §12.2 says does not exist today.
 *
 * The two writes are function calls, never direct DML. `org.provision_organization`
 * and `org.change_tenant_status` are both `SECURITY INVOKER`, so they execute
 * with `app_platform`'s privileges and RLS — the function is the sanctioned
 * path, not a privilege escalation around one.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface OrganizationRow {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
}

export class PlatformRepository extends Repository {
  protected readonly module = 'platform';

  /**
   * The organisation read (§6.5). Reads the tenant root and nothing beneath it.
   *
   * `tenantId` is optional: one registered operation serves both the collection
   * and a single named tenant, the shape `inv.stock-availability-read` already
   * uses. Omitting it lists; supplying it narrows to one row. Either way the
   * rows a caller can see are decided by `sel_tenants_platform`, not by this
   * predicate — an unauthorised caller gets an empty result rather than a
   * filtered one.
   */
  async listOrganizations(
    db: DbHandle,
    params: { readonly tenantId?: string; readonly limit: number }
  ): Promise<readonly OrganizationRow[]> {
    const rows = await this.run<{
      id: string;
      tenant_code: string;
      display_name: string;
      status: string;
      default_locale: string;
      default_timezone: string;
      created_at: string;
    }>(
      db,
      `SELECT t.id,
              t.tenant_code,
              t.display_name,
              t.status,
              t.default_locale,
              t.default_timezone,
              t.created_at
         FROM org.tenants t
        WHERE ($1::uuid IS NULL OR t.id = $1::uuid)
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $2`,
      [params.tenantId ?? null, params.limit]
    );

    return rows.rows.map((r) => ({
      id: r.id,
      tenantCode: r.tenant_code,
      displayName: r.display_name,
      status: r.status,
      defaultLocale: r.default_locale,
      defaultTimezone: r.default_timezone,
      createdAt: r.created_at,
    }));
  }

  /**
   * The sanctioned provisioning path (§6.2). One call, one transaction: the
   * function already performs tenant, history, subscription, company, branch,
   * settings, overrides, sequences and replay protection and rolls all of it
   * back on any failure.
   *
   * `tenant.activate` is NEVER set. That branch calls `org.change_tenant_status`
   * inside the same transaction, which would move the tenant out of
   * `provisioning` BEFORE the First-Owner bootstrap runs — closing the bootstrap
   * window inside the transaction that depends on it. Activation is a separate
   * later act under `platform.organization.lifecycle`.
   */
  async provisionOrganization(
    db: DbHandle,
    spec: Readonly<Record<string, unknown>>,
    idempotencyKey: string
  ): Promise<{ readonly tenantId: string }> {
    const row = await this.runOne<{ result: { tenant_id: string } }>(
      db,
      'SELECT org.provision_organization($1::jsonb, $2) AS result',
      [JSON.stringify(spec), idempotencyKey]
    );
    if (!row) throw new Error('provision_organization returned no row');
    return { tenantId: row.result.tenant_id };
  }

  /**
   * The lifecycle transition (§6.4).
   *
   * The graph is validated by M4's `BEFORE UPDATE` backstop and the history row
   * is written by M3's `AFTER UPDATE` emitter, so an illegal destination is
   * refused and a legal one is recorded whatever performs the write. The actor
   * is NOT passed from the request: `shared.stamp_status_history()` derives it
   * from `iam.current_user_id()`. A caller-supplied value must never become the
   * input to an authority predicate.
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
    await this.run(db, 'SELECT org.change_tenant_status($1::uuid, $2, $3, NULL, $4::uuid)', [
      params.tenantId,
      params.toState,
      params.reason,
      params.correlationId ?? null,
    ]);
  }
}
