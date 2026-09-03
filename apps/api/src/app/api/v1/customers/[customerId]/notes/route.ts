/**
 * GET/POST /api/v1/customers/{customerId}/notes (Phase 1-16, P1-16-BE-008;
 * GET added by the P1-16 remediation for `P1-27-INT-001`).
 *
 * POST consumes the capability DBCR-P1-16-001 granted: INSERT on `shared.notes`
 * under policies that pin `author_id = iam.current_user_id()` and
 * `entity_type = 'crm.business_partners'`. The route therefore cannot forge an
 * author or attach a note to a non-CRM entity, and there is no DELETE anywhere
 * — a note is retired, never erased.
 *
 * GET returns the customer's live notes as a keyset page, newest first. It
 * carries one field no other list here has: `includesRestricted`.
 * `sel_notes_tenant` hides `restricted` and `secret` notes from a caller without
 * `iam.sensitive.view`, and hides them SILENTLY — the list is simply shorter. A
 * screen that could not tell the difference would state "this customer has three
 * notes" and be wrong. The flag says whether the caller holds the capability; it
 * deliberately does not say how many notes were withheld, because that count is
 * itself information about restricted material.
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
import { crmModule, MAX_NOTE_BODY, NOTE_CLASSIFICATIONS, NOTE_VISIBILITIES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();
export const Body = z
  .object({
    body: z.string().min(1).max(MAX_NOTE_BODY),
    classification: z.enum(NOTE_CLASSIFICATIONS).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
  })
  .strict();

export const NOTE_LIST_OPERATION = defineOperation({
  id: 'crm.note-list',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}/notes',
  summary: 'List a customer’s notes, newest first.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  // `none`, not `security`, even though the relation is classification-gated. The
  // gate is in `sel_notes_tenant`, so a caller without `iam.sensitive.view` never
  // reaches restricted material to be recorded as having read it — and auditing
  // every routine note read would bury the reads that matter.
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const NOTE_ADD_OPERATION = defineOperation({
  id: 'crm.note-add',
  successStatus: 201,
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

export async function GET(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    NOTE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await crmModule().customerRead.listNotes(
        db,
        params.customerId,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    }),
    { params }
  );
}

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
