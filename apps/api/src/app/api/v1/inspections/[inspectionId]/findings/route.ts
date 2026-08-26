/**
 * POST /api/v1/inspections/{inspectionId}/findings (Phase 1-19, P1-19-BE-010).
 *
 * Records one diagnostic finding — the thing the whole report exists to produce.
 *
 * `severity` and `disposition` are the CHECK vocabularies verbatim, and they answer
 * different questions: severity is how bad it is (`info` … `critical`), disposition is
 * what should be done about it (`monitor`, `repair_recommended`, `repair_required`,
 * `no_action`). Nothing in the schema ties them, and nothing here does either — a
 * `critical` finding with `no_action` is a legitimate record of a fault outside this
 * workshop's remit.
 *
 * ## A finding is the anchor of the phase's real provenance chain
 *
 * `wo.additional_work_requests.originating_finding_id` points HERE, and Wave 6
 * resolves it through this module rather than trusting it, because that column carries
 * no foreign key. A request naming only a finding also derives its originating job
 * from the finding's report, so the unapproved-work execution gate applies to work
 * discovered by a diagnostic exactly as it does to work discovered by hand.
 *
 * The reverse link the phase brief asks for — recommendation → additional work — does
 * not exist: `dia.recommendations` has no `finding_id` and nothing references a
 * recommendation. Recorded as a reconciliation rather than invented.
 *
 * An optional `templateItemId` must belong to the report's PINNED version, for the
 * same reason it must on an item result: `fk_findings_item` is `(tenant_id,
 * template_item_id)` and names no version at all.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  FINDING_DISPOSITIONS,
  FINDING_SEVERITIES,
  MAX_FINDING_DESCRIPTION,
  diagnosticsModule,
} from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

export const Body = z
  .object({
    templateItemId: schemas.uuid.optional(),
    severity: z.enum(FINDING_SEVERITIES),
    disposition: z.enum(FINDING_DISPOSITIONS),
    description: z.string().trim().min(1).max(MAX_FINDING_DESCRIPTION),
  })
  .strict();

export const DIAGNOSTIC_FINDING_OPERATION = defineOperation({
  id: 'dia.diagnostic-finding-record',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/findings',
  summary: 'Record a diagnostic finding with its severity and disposition.',
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
    DIAGNOSTIC_FINDING_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const finding = await diagnosticsModule().reports.recordFinding(
        db,
        params.inspectionId,
        {
          templateItemId: parsed.templateItemId,
          severity: parsed.severity,
          disposition: parsed.disposition,
          description: parsed.description,
        },
        authorizeScope
      );
      return { status: 201, body: finding, recordVersion: finding.recordVersion };
    },
    { params: raw, body }
  );
}
