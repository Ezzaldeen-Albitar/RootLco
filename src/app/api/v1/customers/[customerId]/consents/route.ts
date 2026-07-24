/**
 * POST /api/v1/customers/{customerId}/consents (Phase 1-16, FR-CRM-004,
 * BR-CRM-002, P1-16-BE-007).
 *
 * Records one consent decision. `POST` and never `PUT`: consent history is
 * append-only, and the sequence of decisions *is* the record. Overwriting the
 * previous decision would destroy the evidence that the customer once granted,
 * or once withdrew — which is exactly what a consent trail exists to preserve.
 *
 * The body carries no `effectiveAt` and no actor: `crm.guard_consent_insert()`
 * stamps both server-side, so a caller can neither back-date a grant to defeat a
 * later withdrawal nor attribute the decision to another user.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  crmModule,
  CONSENT_KINDS,
  CONTACT_CHANNELS,
  COMMUNICATION_PURPOSES,
  RECORDABLE_CONSENT_STATUSES,
} from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    consentKind: z.enum(CONSENT_KINDS),
    channel: z.enum(CONTACT_CHANNELS),
    purpose: z.enum(COMMUNICATION_PURPOSES),
    status: z.enum(RECORDABLE_CONSENT_STATUSES),
    /** How the decision reached us, e.g. a signed form or a phone call. */
    source: z.string().min(1).max(200).nullable().optional(),
    /** Must belong to this customer; the composite FK enforces it. */
    contactPointId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const CONSENT_RECORD_OPERATION = defineOperation({
  id: 'crm.consent-record',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/consents',
  summary: 'Record a customer consent decision.',
  permissions: ['crm.customer.consent.write'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.consent_changed',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    CONSENT_RECORD_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        status: 201,
        body: await crmModule().customerProfile.recordConsent(db, params.customerId, {
          consentKind: input.consentKind,
          channel: input.channel,
          purpose: input.purpose,
          status: input.status,
          source: input.source ?? null,
          contactPointId: input.contactPointId ?? null,
        }),
      };
    },
    { params, body }
  );
}
