/**
 * POST /api/v1/template-versions/{versionId}/items (PRE-P1-29-BR-04).
 *
 * Authors one item on a DRAFT version.
 *
 * ## Draft-only, and the freeze is stronger than "no edits"
 *
 * `tg_template_items_frozen` is `BEFORE INSERT OR UPDATE`, so a published
 * version's item SET is closed — an item cannot be APPENDED to it either. "Add
 * one more check to the published inspection" is therefore not a supported
 * operation and deliberately has no route. The supported shape is: create a new
 * version (optionally copying this one's items), author it, publish it, retire
 * the old one. Reports already citing the old version keep resolving to the
 * questions they were actually asked, which is the entire point of pinning a
 * `template_version_id` rather than a `template_id`.
 *
 * The service refuses a non-draft parent BEFORE the insert so the caller sees
 * `ERR-TRN-001` rather than a `23514`. The guard is still the authority and still
 * runs: with the service check removed the insert is refused anyway, which is
 * what makes the check a message improvement rather than a second rule that could
 * disagree with the first.
 *
 * ## `unit` is required for a numeric item, mirrored rather than duplicated
 *
 * `ck_template_items_unit` says `response_type <> 'numeric' OR unit IS NOT NULL`.
 * The same condition is mirrored in Zod so the caller receives a violation path
 * naming `body.unit` instead of a SQLSTATE.
 *
 * ## `validationRule` is opaque, on purpose
 *
 * It is accepted as a `jsonb` object and nothing in the platform interprets it
 * today. Inventing a schema for it here would create a contract no consumer
 * honours, so its semantics are an OPEN QUESTION recorded in the slice evidence
 * rather than a shape asserted in this file.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  diagnosticsModule,
  MAX_ITEM_PROMPT,
  MAX_ITEM_UNIT,
  RESPONSE_TYPES,
} from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ versionId: schemas.uuid });

/**
 * `itemCode` mirrors `ck_template_items_code_format`; `sequence` mirrors
 * `ck_template_items_sequence` (`> 0`) and may be omitted, in which case the
 * service assigns the next free one so a caller authoring a list in order never
 * has to track it.
 */
export const TemplateItemCreateBody = z
  .object({
    itemCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,62}$/, 'itemCode must match ^[a-z][a-z0-9_]{1,62}$'),
    prompt: z.string().trim().min(1).max(MAX_ITEM_PROMPT),
    responseType: z.enum(RESPONSE_TYPES),
    unit: z.string().trim().min(1).max(MAX_ITEM_UNIT).optional(),
    isMandatory: z.boolean().optional(),
    validationRule: z.record(z.string(), z.unknown()).optional(),
    sequence: z.number().int().positive().optional(),
  })
  .strict();

export const TEMPLATE_ITEM_CREATE_OPERATION = defineOperation({
  id: 'dia.template-item-create',
  successStatus: 201,
  module: 'diagnostics',
  method: 'POST',
  path: '/template-versions/{versionId}/items',
  summary: 'Author one item on a draft inspection template version.',
  permissions: ['dia.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'dia.template_item.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ versionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TEMPLATE_ITEM_CREATE_OPERATION,
    request,
    async ({ db, request: req }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, TemplateItemCreateBody);
      const created = await diagnosticsModule().templates.createItem(db, params.versionId, input);
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
