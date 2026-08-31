/**
 * GET / POST /api/v1/platform/organizations (PRE-P1-29 Wave B).
 *
 * The control plane. These are the only operations in the product that are not
 * inside a tenant, which is what the `platform` module prefix means.
 *
 * Both declare a `platform.` permission, and that prefix is load-bearing rather
 * than cosmetic: `authorization.ts` routes such a code to
 * `iam.has_platform_authority` instead of `iam.has_permission`. The tenant-bound
 * resolver CANNOT answer them — it returns false unless the acting principal
 * holds an active account in the current tenant, which a platform operator
 * creating that tenant does not have. Without that branch these routes would
 * answer 403 to every caller, permanently, while every structural gate stayed
 * green. That is `PC-1`, which this repository has already shipped once, and it
 * is why the proof for these operations asserts on the RESPONSE.
 *
 * `scope: 'tenant'` is declared knowingly and is behaviourally inert:
 * `ScopeRequirement` has no platform member, an omitted value defaults to
 * `'tenant'` anyway, and `requiresScopedEvaluation` returns false for it — so no
 * scoped evaluation runs and the platform branch sees the unscoped path.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { requireIdempotencyKey } from '@/server/http/idempotency';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One operation serves both the collection and a single named tenant, selected
 * by an optional query parameter — the shape `inv.stock-availability-read` and
 * `inv.inventory-reconciliation-read` already use. §6.5's two context shapes
 * ("platform-origin for a list, platform-on-target for one tenant") do not
 * require two registrations, and splitting them would publish two operations
 * where the contract declares one.
 */
const Query = z
  .object({
    tenantId: schemas.uuid.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

/**
 * The provisioning spec, in the shape `org.provision_organization` actually
 * reads — measured from its own `p_spec ->` accessors, not invented.
 *
 * `.strict()` at every level is a security control here, not tidiness. Two keys
 * the function honours are deliberately ABSENT from this schema, and `.strict()`
 * is what makes their absence enforceable rather than conventional:
 *
 *   `actor_id`   — the function derives the actor as
 *                  `COALESCE(iam.current_user_id(), p_spec ->> 'actor_id')`. The
 *                  session always resolves one here, so the fallback is
 *                  unreachable — but accepting the key would publish a
 *                  caller-supplied value into the attribution path, and a caller
 *                  value must never approach an authorization principal.
 *   `activate`   — forwarding it would call org.change_tenant_status INSIDE the
 *                  provisioning transaction, moving the tenant out of
 *                  `provisioning` before the First-Owner bootstrap runs and
 *                  closing the §6.3 window inside the transaction that depends
 *                  on it. Activation is a separate later act under
 *                  `platform.organization.lifecycle`.
 *
 * A request carrying either is refused at the boundary rather than silently
 * ignored, which is the difference between a rule and a habit.
 */
const ProvisionBody = z
  .object({
    tenant: z
      .object({
        code: z.string().min(2).max(63),
        display_name: z.string().min(1).max(200),
        locale: z.string().min(2).max(35),
        timezone: z.string().min(1).max(64),
      })
      .strict(),
    company: z
      .object({
        code: z.string().min(1).max(63),
        legal_name: z.string().min(1).max(200),
        base_currency: z.string().length(3),
        registration_number: z.string().max(100).optional(),
        tax_registration_number: z.string().max(100).optional(),
      })
      .strict(),
    branch: z
      .object({
        code: z.string().min(1).max(63),
        name: z.string().min(1).max(200),
        city: z.string().max(120).optional(),
        country_code: z.string().length(2).optional(),
        // NOT optional: org.branches.timezone_name is NOT NULL, so an omitted
        // value fails inside the function rather than at the boundary. Measured.
        timezone: z.string().min(1).max(64),
      })
      .strict(),
    subscription: z
      .object({
        plan_code: z.string().min(1).max(63),
        status: z.string().max(32).optional(),
        effective_from: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ORGANIZATION_READ_OPERATION = defineOperation({
  id: 'platform.organization-read',
  module: 'platform',
  method: 'GET',
  path: '/platform/organizations',
  summary: 'Read organizations from the control plane, optionally narrowed to one tenant.',
  permissions: ['platform.organization.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const ORGANIZATION_PROVISION_OPERATION = defineOperation({
  id: 'platform.organization-provision',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations',
  summary: 'Create a tenant with its first company and branch.',
  permissions: ['platform.organization.provision'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.tenant.provisioned',
  idempotent: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const query = parseOrFail(
    Query,
    searchParamsToObject(new URL(request.url).searchParams),
    'query'
  );
  return handleOperation(ORGANIZATION_READ_OPERATION, request, async ({ db }) => ({
    body: {
      items: await platformModule().organizations.read(db, {
        ...(query.tenantId !== undefined ? { tenantId: query.tenantId } : {}),
        limit: query.limit ?? 50,
      }),
    },
  }));
}

export async function POST(request: Request): Promise<Response> {
  return handleOperation(
    ORGANIZATION_PROVISION_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, ProvisionBody);
      // The framework already enforces the header for an `idempotent` operation
      // (route-handler.ts calls requireIdempotencyKey before the transaction opens),
      // so re-checking here would be a second, weaker copy of one rule. The value
      // is read only because org.provision_organization takes it as an argument.
      const idempotencyKey = requireIdempotencyKey(raw.headers);

      // `tenant.activate` is NEVER forwarded. That branch of
      // org.provision_organization calls org.change_tenant_status inside the
      // same transaction, moving the tenant out of `provisioning` BEFORE the
      // First-Owner bootstrap runs — closing the bootstrap window inside the
      // transaction that depends on it. Activation is a separate later act
      // under platform.organization.lifecycle.
      const result = await platformModule().organizations.provision(db, input, idempotencyKey);
      // successStatus is contract metadata that route-handler does not apply; the
      // route returns the status it declares, as every other 201 route does.
      return { status: 201, body: result };
    }
  );
}
