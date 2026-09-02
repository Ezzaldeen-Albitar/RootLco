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
 * reads — measured from its own `p_spec ->` accessors, not invented — plus the
 * two members P1-29 W9 added: the Owner, and whether to activate.
 *
 * `.strict()` at every level is a security control here, not tidiness. Keys
 * the function honours are deliberately ABSENT from this schema, and `.strict()`
 * is what makes their absence enforceable rather than conventional:
 *
 *   `actor_id`        — the function derives the actor as
 *                       `COALESCE(iam.current_user_id(), p_spec ->> 'actor_id')`.
 *                       The session always resolves one here, so the fallback
 *                       is unreachable — but accepting the key would publish a
 *                       caller-supplied value into the attribution path, and a
 *                       caller value must never approach an authorization
 *                       principal.
 *   `tenant.activate` — forwarding it would call org.change_tenant_status
 *                       INSIDE org.provision_organization, moving the tenant
 *                       out of `provisioning` BEFORE the First-Owner bootstrap
 *                       runs and closing the §6.3 window inside the transaction
 *                       that depends on it. The top-level `activate` below is
 *                       honoured by the service AFTER the bootstrap, through
 *                       the lifecycle function, in the same transaction.
 *
 * `owner` carries identity and profile inputs only — an address, a display
 * name, an optional allow-listed return destination for the invitation link.
 * There is no `roleCodes`, no `permissions`, no `tenantId`, no `userId`: the
 * roles and their sets are server-owned constants, the target tenant is the
 * one this transaction creates, and attribution is the session's. A request
 * carrying any of them is refused at the boundary rather than silently
 * ignored, which is the difference between a rule and a habit.
 */
const OwnerBody = z
  .object({
    email: z.string().min(3).max(320),
    displayName: z.string().min(1).max(200),
    redirectTo: z.string().url().max(2048).optional(),
  })
  .strict();

const ProvisionBody = z
  .object({
    owner: OwnerBody,
    activate: z.boolean().optional(),
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
  summary:
    'Create a tenant with its first company, branch and First Owner, optionally activating it.',
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
  // The raw body is handed to the pipeline so the idempotency fingerprint
  // binds it: the same key with a different document is a conflict, not a
  // replay. Before P1-29 W9 the body was not bound here, so a reused key
  // replayed the stored tenant whatever the second request said (measured).
  const body = await request
    .clone()
    .json()
    .catch(() => null);
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

      // `tenant.activate` is NEVER forwarded to org.provision_organization —
      // that branch would close the bootstrap window inside the transaction
      // that depends on it. The top-level `activate` is applied by the service
      // AFTER the First-Owner bootstrap, in the same transaction.
      const { owner, activate, ...spec } = input;
      const result = await platformModule().organizations.provision(
        db,
        {
          spec,
          owner: {
            email: owner.email,
            displayName: owner.displayName,
            ...(owner.redirectTo !== undefined ? { redirectTo: owner.redirectTo } : {}),
          },
          activate: activate === true,
        },
        idempotencyKey
      );
      // successStatus is contract metadata that route-handler does not apply; the
      // route returns the status it declares, as every other 201 route does.
      return { status: 201, body: result };
    },
    { body }
  );
}
