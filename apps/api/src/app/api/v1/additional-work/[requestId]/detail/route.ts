/**
 * The RESTRICTED description of an additional-work request (Phase 1-19, P1-19-BE-006).
 *
 * `PUT` records or replaces it; `GET` reads it.
 *
 * ## Why this is a separate surface with its own permission
 *
 * `wo.additional_work_request_details` is 1:1 with the request, its `classification`
 * is CHECK-fixed to `restricted`, and all three of its policies —
 * `sel_/ins_/upd_additional_work_request_details_gated` — additionally require
 * `iam.has_permission('iam.sensitive.view')`. For a caller without that permission the
 * row does not exist, for reading OR writing.
 *
 * So folding it into the request would have broken twice over: the request list would
 * silently return nothing useful for an ordinary service advisor, and raising a request
 * with a description would fail at the second INSERT for anyone lacking the sensitive
 * permission — after the request itself had already been written in the same
 * transaction.
 *
 * Both operations therefore declare `iam.sensitive.view` ALONGSIDE the functional
 * permission. `defineOperation` treats a permission list as a conjunction, so the
 * declaration is a real second requirement and not documentation: a caller holding
 * `wo.work_order.read` alone is refused at the pipeline, before any row is read, and
 * the RLS policy is defence in depth behind that. The two controls are tested
 * separately, because they fail differently and only one of them is the control.
 *
 * ## Replaceable, because the schema says so
 *
 * `tg_additional_work_request_details_immutable` freezes the scope columns, the
 * request link, the classification and the creation stamps — but not the description —
 * and the migration grants UPDATE. A customer-facing text that could never be
 * corrected would be the worse contract, so `PUT` creates or replaces through the
 * partial unique index on live rows.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_RESTRICTED_DESCRIPTION, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid });

export const Body = z
  .object({ description: z.string().trim().min(1).max(MAX_RESTRICTED_DESCRIPTION) })
  .strict();

export const ADDITIONAL_WORK_DETAIL_RECORD_OPERATION = defineOperation({
  id: 'wo.additional-work-detail-record',
  module: 'work-order',
  method: 'PUT',
  path: '/additional-work/{requestId}/detail',
  summary: 'Record or replace the restricted customer-facing description.',
  permissions: ['wo.additional_work.request', 'iam.sensitive.view'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.additional_work.detail_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ADDITIONAL_WORK_DETAIL_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const detail = await workOrderModule().additionalWork.writeDetail(
        db,
        params.requestId,
        { description: parsed.description },
        authorizeScope
      );
      return { status: 200, body: detail, recordVersion: detail.recordVersion };
    },
    { params: raw, body }
  );
}

export const ADDITIONAL_WORK_DETAIL_READ_OPERATION = defineOperation({
  id: 'wo.additional-work-detail-read',
  module: 'work-order',
  method: 'GET',
  path: '/additional-work/{requestId}/detail',
  summary: 'Read the restricted customer-facing description.',
  permissions: ['wo.work_order.read', 'iam.sensitive.view'],
  scope: 'branch',
  // A read of `restricted` data is audited as SECURITY rather than left unrecorded.
  // Every other read in this module is `none`, and that is right for work-order state;
  // it is not right for the one table the platform gates behind `iam.sensitive.view`,
  // where who looked is itself the fact worth keeping.
  auditClass: 'security',
  auditAction: 'wo.additional_work.detail_read',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    ADDITIONAL_WORK_DETAIL_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await workOrderModule().additionalWork.detail(db, params.requestId, authorizeScope),
      };
    },
    { params: raw }
  );
}
