/**
 * POST / GET /api/v1/jobs/{jobId}/evidence (PRE-P1-29-BR-07 — `INS-28`, Owner
 * requirement 12).
 *
 * A technician could not attach a photograph to the work they did. Evidence
 * binding existed for exactly two subjects — a diagnostic report and a customer
 * approval — and for nothing else.
 *
 * ## This route binds a version. It does NOT move bytes.
 *
 * The document is captured through the attachments chain that already ships —
 * authorize, register, link — and this route binds the resulting version to a
 * job. Two steps, deliberately not one: a single upload-and-bind would have to
 * hold `shared.document.manage` AND this job's authority in one declaration,
 * widening one of them, and it would put file bytes through a work-order route.
 *
 * **No second media subsystem is created here.** No upload route, no storage
 * call, no `connect-src` change. The browser never PUTs to the object store and
 * that is structural rather than preferential: `connect-src` is assembled in one
 * place and admits `'self'` and the API origin only, so a browser upload to a
 * storage origin is refused by policy. Admitting a third origin would be a change
 * to this product's security posture and is not this slice's to make.
 *
 * ## Two permissions, and a UI will hit the seam
 *
 * The WRITE costs `tech.labor.record` — the technician evidences the labour they
 * performed, in the same act, as the same person. Requiring `wo.job.manage` would
 * mean a technician cannot photograph their own work. The precedent is exact:
 * `dia.diagnostic-evidence-record` carries `dia.diagnostic.record`, not
 * `shared.document.manage`.
 *
 * The READ costs `wo.work_order.read`: evidence describes WORK, not a person —
 * unlike an assignment or a labour session, which is why those need
 * `tech.technician.read` (`T-05`).
 *
 * Attaching therefore needs `shared.document.manage` (to capture) AND
 * `tech.labor.record` (to bind). A caller holding one and not the other gets a
 * partial flow, and a screen must check both before offering the control.
 *
 * ## The response carries a REFERENCE, never a way in
 *
 * `documentVersionId` and no storage key, no URL, no checksum, no bytes
 * (`T-09`). A version id is resolved by the attachments module under its own
 * authorization; constructing a storage URL from it would make evidence readable
 * by reference and route around that check entirely.
 *
 * ## `pending` binds; `pending` does not download
 *
 * `EVIDENCE_REFUSED_STATES` refuses `rejected` and `quarantined` only. An
 * unscanned version may be bound, and its bytes still cannot be fetched until the
 * scan accepts them. Tightening this would make evidence capture fail
 * intermittently on scan latency — losing the photograph rather than delaying it.
 *
 * ## Binding is PERMANENT
 *
 * `wo.job_evidence` is append-only at the grant layer: no UPDATE, no DELETE, no
 * soft delete. Evidence cannot be unbound, so a mis-attached photograph is
 * permanent — the same property both shipped evidence tables have. A UI must
 * confirm before submitting and must say the record is permanent.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { MAX_EVIDENCE_TYPE, MAX_JOB_EVIDENCE_NOTE, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

/**
 * `evidenceType` is free text 1..64, mirroring the shipped columns on both
 * sibling evidence tables. There is deliberately NO enum: the vocabulary is a
 * convention the API recommends (`RECOMMENDED_EVIDENCE_TYPES`) and not an
 * invariant the database enforces, and declaring one here would make this table
 * disagree with the two it was transcribed from.
 *
 * `createdBy` is absent and `.strict()` refuses it — evidence whose author the
 * author chooses is not evidence.
 */
export const JobEvidenceCreateBody = z
  .object({
    documentVersionId: schemas.uuid,
    evidenceType: z.string().trim().min(1).max(MAX_EVIDENCE_TYPE),
    note: z.string().trim().min(1).max(MAX_JOB_EVIDENCE_NOTE).optional(),
  })
  .strict();

export const JOB_EVIDENCE_RECORD_OPERATION = defineOperation({
  id: 'wo.job-evidence-record',
  module: 'work-order',
  method: 'POST',
  path: '/jobs/{jobId}/evidence',
  summary: 'Bind a captured document version to a job as work evidence.',
  permissions: ['tech.labor.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.evidence_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    JOB_EVIDENCE_RECORD_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, JobEvidenceCreateBody);
      return {
        status: 201,
        body: await workOrderModule().jobBoard.recordJobEvidence(
          db,
          params.jobId,
          {
            documentVersionId: input.documentVersionId,
            evidenceType: input.evidenceType,
            note: input.note,
          },
          authorizeScope
        ),
      };
    },
    { params: raw, body }
  );
}

export const JOB_EVIDENCE_LIST_OPERATION = defineOperation({
  id: 'wo.job-evidence-list',
  module: 'work-order',
  method: 'GET',
  path: '/jobs/{jobId}/evidence',
  summary: 'List the work evidence bound to one job, oldest first.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    JOB_EVIDENCE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await workOrderModule().jobBoard.listJobEvidence(db, params.jobId, authorizeScope),
        },
      };
    },
    { params: raw }
  );
}
