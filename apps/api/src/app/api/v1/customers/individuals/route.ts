/**
 * POST /api/v1/customers/individuals — create an individual customer
 * (Phase 1-16, FR-CRM-001, P1-16-BE-002).
 *
 * The party type comes from the **path**, never the body: this route creates
 * individuals and nothing else, so no request can talk the service into
 * attaching a company profile to an individual partner.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { crmModule, CREATABLE_LIFECYCLE_STATUSES, MAX_PERSON_NAME } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Body = z
  .object({
    givenName: z.string().min(1).max(MAX_PERSON_NAME),
    familyName: z.string().min(1).max(MAX_PERSON_NAME),
    /** Must be a registered platform language; the FK is the authority. */
    preferredLocale: z.string().min(2).max(10).nullable().optional(),
    lifecycleStatus: z.enum(CREATABLE_LIFECYCLE_STATUSES).optional(),
  })
  .strict();

export const INDIVIDUAL_CREATE_OPERATION = defineOperation({
  id: 'crm.individual-create',
  module: 'crm',
  method: 'POST',
  path: '/customers/individuals',
  summary: 'Create an individual customer.',
  permissions: ['crm.customer.create'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    INDIVIDUAL_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerCreation.createIndividual(db, await parseJsonBody(raw, Body)),
    }),
    { body }
  );
}
