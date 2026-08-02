/**
 * Additional-work requests on a work order (Phase 1-19, P1-19-BE-006).
 *
 * `POST` raises one; `GET` lists them.
 *
 * ## The body carries a SAFE summary and no customer-facing description
 *
 * `wo.additional_work_request_details` — the restricted 1:1 description — is gated at
 * the database by `iam.has_permission('iam.sensitive.view')` on SELECT, INSERT and
 * UPDATE alike. Accepting it here would make raising a request impossible for every
 * service advisor who does not hold that permission, because the INSERT policy would
 * refuse the second write after the first had already committed in the same
 * transaction. So the description has its own operation and its own permission pair,
 * and this one takes only the summary.
 *
 * ## Provenance is required, and both origins together are allowed
 *
 * At least one of `originatingJobId` and `originatingFindingId` must be present. That
 * is this layer's rule — both columns are nullable — and it exists because additional
 * work whose provenance is unrecorded cannot be traced to what discovered it.
 * Supplying both is accepted rather than refused: a finding is discovered while
 * working a job, so naming both is more informative and nothing in the schema treats
 * them as alternatives.
 *
 * The job must belong to THIS work order — `fk_additional_work_requests_job` pins the
 * branch, not the order — and the finding must resolve, through the `diagnostics`
 * module, to a report on this same work order. `originating_finding_id` has NO foreign
 * key at all, so that read is the only thing standing between it and an arbitrary
 * uuid.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REQUEST_SUMMARY, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

const Body = z
  .object({
    originatingJobId: schemas.uuid.optional(),
    originatingFindingId: schemas.uuid.optional(),
    summary: z.string().trim().min(1).max(MAX_REQUEST_SUMMARY),
    /**
     * Defaults to `true` in the service, not here, because the default is a rule
     * rather than a shape: the safe reading of silence is that a vehicle should not
     * leave with discovered work undone. `is_required` is immutable after insert.
     */
    isRequired: z.boolean().optional(),
  })
  .strict();

export const ADDITIONAL_WORK_REQUEST_OPERATION = defineOperation({
  id: 'wo.additional-work-request',
  module: 'work-order',
  method: 'POST',
  path: '/work-orders/{workOrderId}/additional-work',
  summary: 'Raise an additional-work request against a work order.',
  permissions: ['wo.additional_work.request'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.additional_work.requested',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ADDITIONAL_WORK_REQUEST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const raised = await workOrderModule().additionalWork.raise(
        db,
        params.workOrderId,
        {
          originatingJobId: parsed.originatingJobId,
          originatingFindingId: parsed.originatingFindingId,
          summary: parsed.summary,
          isRequired: parsed.isRequired,
        },
        authorizeScope
      );
      return { status: 201, body: raised, recordVersion: raised.recordVersion };
    },
    { params: raw, body }
  );
}

export const ADDITIONAL_WORK_LIST_OPERATION = defineOperation({
  id: 'wo.additional-work-list',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}/additional-work',
  summary: 'List the additional-work requests of a work order.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    ADDITIONAL_WORK_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await workOrderModule().additionalWork.list(
            db,
            params.workOrderId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
