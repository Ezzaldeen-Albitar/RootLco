/**
 * Quality-control records on a work order (Phase 1-19, P1-19-BE-017).
 *
 * `POST` opens a pending record; `GET` lists them.
 *
 * ## A repeat check is a NEW record, and the schema is built for it
 *
 * There is no unique index on `qms.quality_control_records (work_order_id)`, so a work
 * order carries a SET of records rather than a current one — and closure blocker B5
 * reads that set: B5a fires on a `failed` record with no `passed` one, B5b on a
 * missing `passed` record when any mandatory check is configured. So a re-check after
 * a failure clears closure while the failure stays in the ledger, attributable to
 * whoever performed it. `qms.guard_qc_finalize` makes that the only possibility: a
 * finalized record's result, checker and time are frozen and cannot be edited into a
 * pass.
 *
 * Neither `checkerId` nor `finalizedAt` is accepted here or at finalization. Both are
 * stamped by the database from the session, so a pass can never be attributed to
 * someone who did not perform it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_QC_NOTE, qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });
export const Body = z
  .object({ notes: z.string().trim().min(1).max(MAX_QC_NOTE).optional() })
  .strict();

export const QC_RECORD_OPEN_OPERATION = defineOperation({
  id: 'qms.qc-record-open',
  module: 'quality',
  method: 'POST',
  path: '/work-orders/{workOrderId}/quality-controls',
  summary: 'Open a pending quality-control record on a work order.',
  permissions: ['qms.quality_control.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'qms.quality_control.opened',
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
    QC_RECORD_OPEN_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body ?? {}, 'body');
      const record = await qualityModule().qualityControl.open(
        db,
        params.workOrderId,
        { notes: parsed.notes },
        authorizeScope
      );
      return { status: 201, body: record, recordVersion: record.recordVersion };
    },
    { params: raw, body }
  );
}

export const QC_RECORD_LIST_OPERATION = defineOperation({
  id: 'qms.qc-record-list',
  module: 'quality',
  method: 'GET',
  path: '/work-orders/{workOrderId}/quality-controls',
  summary: 'List the quality-control records of a work order.',
  permissions: ['qms.quality_control.read'],
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
    QC_RECORD_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await qualityModule().qualityControl.forWorkOrder(
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
