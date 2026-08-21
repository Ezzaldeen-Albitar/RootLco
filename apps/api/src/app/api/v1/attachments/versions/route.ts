/**
 * POST /api/v1/attachments/versions (P1-15).
 *
 * Registers an uploaded object as a **pending** version. It cannot register an
 * accepted one: `shared.guard_document_version_initial_state()` refuses any
 * other initial status, and acceptance additionally needs a clean scan record
 * that no application role may write.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    uploadToken: z.string().min(1).max(1024),
    /** Optional cross-check against the token. Disagreement is refused. */
    documentId: z.string().uuid().nullable().optional(),
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteSize: z.number().int().positive(),
    capturedAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const ATTACHMENT_VERSION_REGISTER_OPERATION = defineOperation({
  id: 'shared.attachment-version-register',
  module: 'shared-services',
  method: 'POST',
  path: '/attachments/versions',
  summary: 'Register an uploaded object as a pending document version.',
  permissions: ['shared.document.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.document.version_registered',
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
    ATTACHMENT_VERSION_REGISTER_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        status: 201,
        body: await sharedServicesModule().attachments.registerVersionAndScan(db, {
          uploadToken: input.uploadToken,
          documentId: input.documentId ?? null,
          checksumSha256: input.checksumSha256,
          byteSize: input.byteSize,
          capturedAt: input.capturedAt ?? null,
        }),
      };
    },
    { body }
  );
}
