/**
 * POST /api/v1/customers/companies — create an organization customer
 * (Phase 1-16, FR-CRM-002, P1-16-BE-003).
 *
 * The organization counterpart of `/customers/individuals`. Same operation
 * permission and same audit action, because both record the same business fact;
 * the two differ only in which profile table the customer's identity lands in,
 * and that is decided by the path rather than by a body field.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { crmModule, CREATABLE_LIFECYCLE_STATUSES, MAX_COMPANY_NAME } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Body = z
  .object({
    legalName: z.string().min(1).max(MAX_COMPANY_NAME),
    /** Brand the company trades under. Stored, but never the search identity. */
    tradeName: z.string().min(1).max(MAX_COMPANY_NAME).nullable().optional(),
    lifecycleStatus: z.enum(CREATABLE_LIFECYCLE_STATUSES).optional(),
  })
  .strict();

export const COMPANY_CREATE_OPERATION = defineOperation({
  id: 'crm.company-create',
  successStatus: 201,
  module: 'crm',
  method: 'POST',
  path: '/customers/companies',
  summary: 'Create an organization customer.',
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
    COMPANY_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerCreation.createCompany(db, await parseJsonBody(raw, Body)),
    }),
    { body }
  );
}
