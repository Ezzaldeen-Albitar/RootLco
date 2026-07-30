/**
 * /api/v1/payment-methods — the payment methods a receipt may cite (P1-22-BE-009).
 *
 * ## Why this exists at all, when it stores nothing and mutates nothing
 *
 * `sal.record_receipt` takes a `payment_method_id`. Without a way to discover one,
 * payment recording is unreachable — so this is the difference between a usable API
 * and a decorative one, which is the opposite of the read this phase was warned not to
 * ship.
 *
 * ## Scope is `tenant`, and that is forced by the table
 *
 * `sal.payment_methods` has no `company_id` and no `branch_id` column at all. Its RLS
 * SELECT policy is `(scope = 'platform' OR tenant_id = iam.current_tenant_id())`, so
 * platform rows are visible to every tenant. Declaring `branch` here would be a claim
 * the schema cannot support, and `authorizeScope` would have nothing coherent to check.
 *
 * ## The trap this endpoint must not hide
 *
 * The three seeded platform methods — `cash`, `card_terminal`, `bank_transfer` — are
 * **visible to every tenant and citable by no receipt at all**. `fk_receipts_method`
 * resolves `(tenant_id, payment_method_id)` against `sal.payment_methods (tenant_id,
 * id)`, and `ck_payment_methods_scope_tenant` forces a platform row's `tenant_id` to be
 * NULL — under MATCH SIMPLE the referencing columns are both NOT NULL, so no NULL
 * tenant can satisfy a concrete one. Recording against a platform method raises
 * `23503`, which reads as "that method does not exist" about a method the caller can
 * see in this very list.
 *
 * So the projection carries `recordable` per row rather than leaving the caller to
 * discover the FK the hard way. An operator provisions tenant-scoped method rows;
 * `tests/db/p1-11-helpers.ts` records the same conclusion beside the fixture method it
 * has to create for exactly this reason.
 *
 * `recordable` is about SCOPE, not about activeness: the query already filters
 * `status = 'active' AND deleted_at IS NULL`, so an inactive or withdrawn method is
 * absent from the list entirely rather than present and unselectable. A platform row IS
 * returned though — unrecordable but visible — because a tenant with no method of a
 * given kind needs to see that the platform defines one and its own row is missing,
 * which is a provisioning action this phase cannot perform.
 *
 * No amount, no currency and no credential is involved on this path.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { paymentsModule } from '@/modules/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PAYMENT_METHOD_LIST_OPERATION = defineOperation({
  id: 'sal.payment-method-list',
  module: 'payments',
  method: 'GET',
  path: '/payment-methods',
  summary: 'List the active payment methods visible to this tenant.',
  // The recording authority, not `sal.finance.view`: this is a reference list with no
  // amount on it, and requiring the finance permission to discover a method id would
  // gate a catalogue behind a money permission.
  permissions: ['sal.payment.record'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PAYMENT_METHOD_LIST_OPERATION, request, async ({ db }) => {
    return { body: { items: await paymentsModule().reads.listPaymentMethods(db) } };
  });
}
