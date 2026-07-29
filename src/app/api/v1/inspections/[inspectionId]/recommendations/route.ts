/**
 * POST /api/v1/inspections/{inspectionId}/recommendations (Phase 1-19, P1-19-BE-012).
 *
 * Records one advisory outcome of a diagnostic report.
 *
 * ## The finding link the brief asks for does not exist, and is not invented
 *
 * `dia.recommendations` carries ONLY `diagnostic_report_id`. There is no `finding_id`
 * column anywhere in the protected schema, so a recommendation cannot be tied to the
 * finding that prompted it. Adding one would be this phase changing a frozen schema,
 * and a nullable free-text stand-in would be worse: it would read like provenance
 * while enforcing nothing.
 *
 * The provenance chain the schema DOES support runs the other way and is already
 * built: `wo.additional_work_requests.originating_finding_id` links additional work to
 * a FINDING, and Wave 6 resolves it through this module's `findingOrigin`. So
 * "recommendation → additional work" is recorded as a reconciliation, and
 * "finding → additional work" is what the platform actually enforces.
 *
 * Nothing here prices anything. `priority` is a triage signal — `low`, `medium`,
 * `high` — and quotation and pricing are Phase 1-20.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  MAX_RECOMMENDATION,
  RECOMMENDATION_PRIORITIES,
  diagnosticsModule,
} from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

const Body = z
  .object({
    recommendation: z.string().trim().min(1).max(MAX_RECOMMENDATION),
    priority: z.enum(RECOMMENDATION_PRIORITIES).optional(),
  })
  .strict();

export const DIAGNOSTIC_RECOMMENDATION_OPERATION = defineOperation({
  id: 'dia.diagnostic-recommendation-record',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/recommendations',
  summary: 'Record an advisory recommendation on a diagnostic report.',
  permissions: ['dia.diagnostic.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'dia.diagnostic.entry_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ inspectionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DIAGNOSTIC_RECOMMENDATION_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const recommendation = await diagnosticsModule().reports.recordRecommendation(
        db,
        params.inspectionId,
        { recommendation: parsed.recommendation, priority: parsed.priority },
        authorizeScope
      );
      return { status: 201, body: recommendation, recordVersion: recommendation.recordVersion };
    },
    { params: raw, body }
  );
}
