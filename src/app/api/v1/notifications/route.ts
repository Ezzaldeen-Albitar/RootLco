/**
 * POST /api/v1/notifications (P1-15).
 *
 * Enqueues an outbound message from an approved template version. Nothing is
 * delivered here and no provider is contacted: the durable outcome is one
 * `shared.outbound_messages` row in `pending`, and delivery belongs to the
 * worker on a different database role.
 *
 * `recipientRef` is a UUID by schema, not by convention. An address cannot pass
 * validation, which is what removes arbitrary-destination sending and recipient
 * header injection from the threat model rather than filtering for them.
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
    /** The frozen contract's wider union is accepted and then refused by policy. */
    channel: z.enum(['email', 'sms', 'whatsapp', 'in_app']),
    templateVersionId: z.string().uuid(),
    locale: z.string().min(2).max(10),
    dedupeKey: z.string().min(8).max(200),
    recipientRef: z.string().uuid(),
    variables: z.record(z.string(), z.string()).default({}),
    consentEvaluation: z
      .object({
        granted: z.boolean(),
        consentRecordId: z.string().max(200).nullable(),
        evaluatedAt: z.coerce.date(),
      })
      .strict(),
    companyId: z.string().uuid().nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const NOTIFICATION_ENQUEUE_OPERATION = defineOperation({
  id: 'shared.notification-enqueue',
  module: 'shared-services',
  method: 'POST',
  path: '/notifications',
  summary: 'Enqueue an outbound message from an approved template version.',
  permissions: ['shared.notification.send'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.notification.enqueued',
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
    NOTIFICATION_ENQUEUE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      // `queueMessage`, not `queueMessageWithRendering`: the rendered content is
      // transient and must not cross the HTTP boundary.
      const queued = await sharedServicesModule().notifications.queueMessage(db, {
        channel: input.channel,
        templateVersionId: input.templateVersionId,
        locale: input.locale,
        dedupeKey: input.dedupeKey,
        recipientRef: input.recipientRef,
        variables: input.variables,
        consentEvaluation: {
          granted: input.consentEvaluation.granted,
          consentRecordId: input.consentEvaluation.consentRecordId,
          evaluatedAt: input.consentEvaluation.evaluatedAt,
        },
        companyId: input.companyId ?? null,
        branchId: input.branchId ?? null,
      });
      return { status: queued.deduplicated ? 200 : 202, body: queued };
    },
    { body }
  );
}
