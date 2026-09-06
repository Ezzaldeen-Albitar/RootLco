/**
 * The tenant's own payment methods, written during provisioning (P1-30
 * corrective slice).
 *
 * One statement, run on the PLATFORM connection as `app_platform`, inside the
 * §6.3 platform-on-target window `withPlatformTarget` opens: `app.tenant_id` is
 * the tenant the same transaction has just created, and the handle names it too.
 * What admits the rows is `ins_payment_methods_platform_bootstrap`
 * (20260906090000) — five terms, none of which this code re-implements.
 *
 * ## Why it is a copy and not a literal
 *
 * The canonical vocabulary is a SEED —
 * `supabase/seeds/08_sal_payment_methods.sql`, the three ASM-14 / CON-04 rows —
 * and the labels and kinds belong to it. Restating them here would create a
 * second copy of a vocabulary that already has an owner, and the two would drift
 * silently the first time either changed. So the statement selects the platform
 * rows BY CODE (a server-owned constant, `TENANT_BOOTSTRAP_METHOD_CODES`) and
 * copies each row's own `kind` and `display_name` into the tenant row. The SET
 * is fixed by this application; the CONTENT of each member is the seed's.
 *
 * ## Why nothing is read back
 *
 * `sel_payment_methods_platform_canonical` admits PLATFORM rows only, so
 * `app_platform` cannot see a tenant's methods — not even the ones it has just
 * written. Measured live: `count(*) WHERE scope = 'tenant'` returns 0 on the
 * same connection immediately after `INSERT 0 3`. A `RETURNING` clause is a read
 * of the written row and would be refused, which is the same constraint the
 * First-Owner bootstrap works under and the same reason it generates its
 * identifiers rather than reading them back. The number of rows the statement
 * affected is therefore the only evidence available, and the service treats it
 * as the invariant.
 *
 * ## Why there is no ON CONFLICT
 *
 * The window opens only on a tenant this very transaction created and that is
 * still `provisioning`, so there is nothing to conflict with. A conflict would
 * mean the window opened on a tenant that already holds methods — an anomaly,
 * not a replay — and `uq_payment_methods_tenant_code` raising 23505 rolls the
 * whole provisioning back rather than silently leaving the tenant with fewer
 * methods than the product requires. `ON CONFLICT DO NOTHING` would convert that
 * anomaly into exactly the committed half-state the slice exists to make
 * impossible. Replay is handled where replay belongs: an idempotent retry of
 * `platform.organization-provision` is answered by the pipeline's stored
 * response and never reaches this statement.
 */
import { Repository } from '@/server/db/repository';
import type { PlatformTargetHandle } from '@/server/db/transaction';
import { TENANT_BOOTSTRAP_METHOD_CODES } from '../domain/payments';

export class PaymentMethodBootstrapRepository extends Repository {
  protected readonly module = 'payments';

  /**
   * Copies the canonical platform methods into the tenant being provisioned.
   *
   * @returns how many rows the statement wrote — the only fact available, and
   *   the one the service compares against the canonical set's size.
   */
  async copyCanonicalMethods(db: PlatformTargetHandle): Promise<number> {
    const result = await this.run(
      db,
      `INSERT INTO sal.payment_methods
         (scope, tenant_id, method_code, kind, display_name, created_by)
       SELECT 'tenant', $1, canonical.method_code, canonical.kind, canonical.display_name, $2
         FROM sal.payment_methods AS canonical
        WHERE canonical.scope = 'platform'
          AND canonical.status = 'active'
          AND canonical.deleted_at IS NULL
          AND canonical.method_code = ANY($3::text[])`,
      [
        db.targetTenantId,
        db.context.principal.userId,
        // A copy, because pg binds an array parameter by iterating it and the
        // frozen tuple is shared process-wide.
        [...TENANT_BOOTSTRAP_METHOD_CODES],
      ]
    );
    return result.rowCount ?? 0;
  }
}
