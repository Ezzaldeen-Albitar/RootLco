/**
 * Diagnostic reports on a job (Phase 1-19, P1-19-BE-009).
 *
 * `POST` creates one; `GET` lists a job's revisions.
 *
 * ## The path says `inspections`, the model says `dia.diagnostic_reports`
 *
 * The approved API vocabulary is `inspections`, and the protected schema's is
 * `dia.diagnostic_reports` / `dia.inspection_templates`. Both are kept: the URL
 * preserves the contract other phases were written against, and every identifier
 * inside this phase names the real table. Renaming the table was never available —
 * the schema is frozen — and renaming the route would have broken a published path
 * for a cosmetic gain.
 *
 * ## What creation pins, and what it derives
 *
 * The caller names a template VERSION, and it must be `published`:
 * `dia.guard_diagnostic_report_refs` refuses anything else, and
 * `dia.guard_template_item_frozen` keeps a published version's items immutable — so
 * the questions a report was asked can never change afterwards. The refusal
 * distinguishes `draft` from `retired`, which the guard's single `check_violation`
 * cannot.
 *
 * The diagnostic TYPE is not accepted: it is joined from the template the version
 * belongs to, so a report's type can never disagree with what it pins.
 *
 * The revision number is server-assigned. `dia.diagnostic_reports.revision_number`
 * carries only `CHECK (> 0)` and has NO unique index behind it, so it is protected by
 * an advisory lock alone — accepted limitation `P1-19-A-02`, and the reason nothing
 * here claims guaranteed monotonicity.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });
export const Body = z.object({ templateVersionId: schemas.uuid }).strict();

export const DIAGNOSTIC_CREATE_OPERATION = defineOperation({
  id: 'dia.diagnostic-create',
  module: 'diagnostics',
  method: 'POST',
  path: '/jobs/{jobId}/inspections',
  summary: 'Open a diagnostic report on a job against a published template version.',
  permissions: ['dia.diagnostic.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'dia.diagnostic.created',
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
    DIAGNOSTIC_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const report = await diagnosticsModule().reports.create(
        db,
        params.jobId,
        { templateVersionId: parsed.templateVersionId },
        authorizeScope
      );
      return { status: 201, body: report, recordVersion: report.recordVersion };
    },
    { params: raw, body }
  );
}

export const DIAGNOSTIC_LIST_OPERATION = defineOperation({
  id: 'dia.diagnostic-list',
  module: 'diagnostics',
  method: 'GET',
  path: '/jobs/{jobId}/inspections',
  summary: 'List the diagnostic reports of a job, newest revision first.',
  permissions: ['dia.diagnostic.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    DIAGNOSTIC_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: { items: await diagnosticsModule().reports.forJob(db, params.jobId, authorizeScope) },
      };
    },
    { params: raw }
  );
}
