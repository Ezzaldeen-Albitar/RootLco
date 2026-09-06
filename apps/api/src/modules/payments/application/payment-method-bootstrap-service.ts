/**
 * The payment-method half of tenant provisioning (P1-30 corrective slice).
 *
 * A new organisation must be able to take money on the day it is created. The
 * schema has always required a tenant-local method row to do it —
 * `fk_receipts_method` resolves `(tenant_id, payment_method_id)` and a platform
 * row's `tenant_id` is NULL — and `assertPaymentMethodIsTenantScoped` has said so
 * in words since P1-22. Nothing wrote one. Measured on the local stack at
 * develop `029fc20d`: six tenants provisioned through the shipped control-plane
 * operation, zero tenant-scope payment methods between them.
 *
 * This service is the writer, and it is deliberately tiny:
 *
 *  - it owns no vocabulary — the codes are `TENANT_BOOTSTRAP_METHOD_CODES` and
 *    the labels and kinds are the seed's, copied row by row;
 *  - it takes no input — nothing about a request can reach it, so a caller can
 *    neither choose nor extend the set;
 *  - it re-implements no policy — the §6.3 window, the row term, the
 *    provisioning term and the authority term all live in
 *    `ins_payment_methods_platform_bootstrap`;
 *  - it makes exactly one decision: whether what the statement wrote is what the
 *    product requires, and it throws if it is not.
 *
 * That last decision is the whole reason a service exists rather than a bare
 * repository call. `app_platform` cannot read a tenant's methods back (the
 * SELECT policy admits platform rows only), so the affected-row count is the
 * only evidence there is. A shortfall means a canonical platform row was missing
 * or inactive when the tenant was created — a provisioning that would otherwise
 * COMMIT an organisation the product considers ready and which can record
 * nothing. Throwing here rolls the whole provisioning back: the two committed
 * states stay "no tenant" and "a tenant that works".
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { PlatformTargetHandle } from '@/server/db/transaction';
import type { PaymentMethodBootstrapRepository } from '../data/payment-method-bootstrap-repository';
import { TENANT_BOOTSTRAP_METHOD_CODES } from '../domain/payments';

export class PaymentMethodBootstrapService {
  constructor(private readonly repository: PaymentMethodBootstrapRepository) {}

  /**
   * Gives the tenant being provisioned its own copies of the canonical methods.
   *
   * @returns how many were written — for the provisioning audit record, which
   *   states the count rather than asserting the outcome a second time.
   */
  async provisionCanonicalMethods(db: PlatformTargetHandle): Promise<number> {
    const written = await this.repository.copyCanonicalMethods(db);
    const required = TENANT_BOOTSTRAP_METHOD_CODES.length;
    if (written !== required) {
      throw new AppFailure('ERR-SYS-001', {
        message:
          `Tenant provisioning wrote ${written} of the ${required} canonical payment methods ` +
          `(${TENANT_BOOTSTRAP_METHOD_CODES.join(', ')}). The platform catalogue in ` +
          'supabase/seeds/08_sal_payment_methods.sql must carry all of them, active and not ' +
          'withdrawn; an organisation without them could record no receipt, so the provisioning ' +
          'is refused rather than completed.',
      });
    }
    return written;
  }
}
