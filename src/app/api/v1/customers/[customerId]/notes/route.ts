/**
 * POST /api/v1/customers/{customerId}/notes (Phase 1-16, P1-16-BE-008).
 *
 * Consumes the capability DBCR-P1-16-001 granted: INSERT on `shared.notes`
 * under policies that pin `author_id = iam.current_user_id()` and
 * `entity_type = 'crm.business_partners'`. The route therefore cannot forge an
 * author or attach a note to a non-CRM entity, and there is no DELETE anywhere
 * — a note is retired, never erased.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, MAX_NOTE_BODY, NOTE_CLASSIFICATIONS, NOTE_VISIBILITIES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    body: z.string().min(1).max(MAX_NOTE_BODY),
    classification: z.enum(NOTE_CLASSIFICATIONS).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
  })
  .strict();

export const NOTE_ADD_OPERATION = defineOperation({
  id: 'crm.note-add',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/notes',
  summary: 'Author a note against a customer.',
  permissions: ['crm.customer.note.write'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.note_added',
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
    NOTE_ADD_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        status: 201,
        body: await crmModule().customerGovernance.addNote(db, params.customerId, {
          body: input.body,
          // Defaults match the column defaults: a note is internal unless the
          // author deliberately widens it.
          classification: input.classification ?? 'internal',
          visibility: input.visibility ?? 'internal',
        }),
      };
    },
    { params, body }
  );
}
