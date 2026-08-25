/**
 * GET /api/v1/jobs/{jobId}/inspection-templates (PRE-P1-29-BR-04).
 *
 * **This is the operation that makes the technician's screen possible.**
 *
 * It returns the tenant's `published` versions of `active` templates — exactly
 * the set `POST /jobs/{jobId}/inspections` will accept. Without it a technician
 * must be handed a `templateVersionId` from somewhere, which is `INS-04` in a
 * different costume: a required identifier with no shipped way to obtain it.
 *
 * ## Why `dia.diagnostic.record` and not `dia.diagnostic.read`
 *
 * Its only consumer is the act of opening an inspection, and that is the code
 * `dia.diagnostic-create` already requires. Anyone who may open an inspection may
 * see what they can open it against; nobody else needs to. Using the read code
 * would widen the audience for no consumer, and using `dia.catalogue.manage`
 * would mean a technician could not see the templates they are required to work
 * from.
 *
 * ## `scope: 'branch'` — the only one of the eight that is not tenant-scoped
 *
 * The other seven address the template library, which has no company or branch
 * column. This one is reached THROUGH a job, so it has a branch to evaluate, and
 * it is authorized against the job's own branch exactly as
 * `dia.diagnostic-create` and `dia.diagnostic-list` are.
 *
 * ## The two filters that are not decoration
 *
 * `t.status = 'active'` keeps a withdrawn template out of a technician's picker
 * while leaving every report already recorded against it fully readable, and
 * `v.status = 'published'` keeps a draft — whose items can still change — from
 * being pinned by a report that would then be reproducible only by accident.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

export const PUBLISHABLE_TEMPLATE_LIST_OPERATION = defineOperation({
  id: 'dia.template-version-list-publishable',
  module: 'diagnostics',
  method: 'GET',
  path: '/jobs/{jobId}/inspection-templates',
  summary: 'List the published template versions a job may open an inspection against.',
  permissions: ['dia.diagnostic.record'],
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
    PUBLISHABLE_TEMPLATE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await diagnosticsModule().templates.publishableForJob(
            db,
            params.jobId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
