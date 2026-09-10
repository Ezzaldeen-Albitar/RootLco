/**
 * POST /api/v1/report-configurations/{configurationId}/versions (Phase 1-31, P-11).
 *
 * Creates the next DRAFT version of a report configuration, carrying the
 * `parameter_schema` that version declares.
 *
 * ## Why this is NOT version-guarded
 *
 * Creating a draft does not mutate the configuration, and there is no prior
 * version of the thing being created to guard — an `If-Match` here would be a
 * token about a row the request does not change. The two live "create the next
 * draft version of a parent" operations agree: `svc.service-version-create` and
 * `dia.template-version-create`. Concurrency protection stays where it earns its
 * keep, on the publication beside this route, which decides which definition is in
 * force.
 *
 * The write still takes `FOR UPDATE` on the configuration, because
 * `uq_report_configuration_versions_number` makes `version_number` unique per
 * configuration and two concurrent creates must not compute the same next number.
 * That is a lock for the correctness of the insert, not an optimistic guard
 * against a lost update.
 *
 * ## Why a draft may be created against a published configuration
 *
 * `uq_report_configuration_versions_published` is partial on
 * `status = 'published'`, so drafts sit beside the live version freely — which is
 * the point of a draft. The succession boundary is decided at publication, not
 * here.
 *
 * ## `parameterSchema` — bounded in SHAPE, undecided in VOCABULARY
 *
 * The frozen schema constrains the column in no way at all: `parameter_schema` is
 * `jsonb NOT NULL DEFAULT '{}'` with no CHECK, no domain and no trigger over its
 * content. This route bounds the shape, because a `jsonb` column a TENANT writes
 * is otherwise a row size the tenant chooses, and validates NOTHING about what the
 * keys mean. What a filter key means is part of the report definition the Owner
 * has not approved (decision **D-4**), and validating a vocabulary here would be
 * inventing the report.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import {
  MAX_PARAMETER_SCHEMA_BYTES,
  MAX_PARAMETER_SCHEMA_KEYS,
  reportingModule,
} from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ configurationId: schemas.uuid }).strict();

/**
 * The declared filter allowlist of one version.
 *
 * A JSON OBJECT: `z.record` refuses an array, a null and a scalar, which matters
 * because `jsonb` would accept all three and `ReportDefinitionView.parameterSchema`
 * is published to clients that expect a keyed document.
 *
 * Three bounds, each stated rather than inherited. At most
 * `MAX_PARAMETER_SCHEMA_KEYS` top-level keys, because a filter allowlist is
 * authored by a person. Every key non-empty and at most 120 characters, so a key
 * is nameable. And at most `MAX_PARAMETER_SCHEMA_BYTES` in the UTF-8 encoding of
 * the serialized document — measured in BYTES rather than characters, because a
 * multi-byte character costs the column bytes, and measured on the serialization
 * that is actually stored rather than on the request text, which may be formatted
 * any way at all.
 *
 * The bound is the LAST refinement so a document that fails two rules is reported
 * against the more specific one.
 */
const ParameterSchema = z
  .record(z.string().trim().min(1).max(120), z.unknown())
  .refine((value) => Object.keys(value).length <= MAX_PARAMETER_SCHEMA_KEYS, {
    message: `parameterSchema may declare at most ${String(MAX_PARAMETER_SCHEMA_KEYS)} top-level keys`,
  })
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= MAX_PARAMETER_SCHEMA_BYTES,
    {
      message: `parameterSchema must serialise to at most ${String(MAX_PARAMETER_SCHEMA_BYTES)} bytes`,
    }
  );

/**
 * Create body.
 *
 * It refuses `id`, `versionNumber` and `status`. The number is computed by the
 * database from the versions that exist, so a caller choosing it could only
 * collide or skip; `status` is refused because a version born `published` would
 * enter the catalogue in the same act that created it, with nobody having read it
 * back, and publication is its own authority-bearing command.
 *
 * `parameterSchema` may be omitted, and an omitted one is the empty object the
 * column already defaults to — a version that declares no filters, which is a
 * legitimate definition rather than an unfinished one.
 */
export const CreateVersionBody = z.object({ parameterSchema: ParameterSchema.optional() }).strict();

export const REPORT_CONFIGURATION_VERSION_CREATE_OPERATION = defineOperation({
  id: 'rpt.report-configuration-version-create',
  successStatus: 201,
  module: 'reporting',
  method: 'POST',
  path: '/report-configurations/{configurationId}/versions',
  summary: 'Create the next draft version of a report configuration.',
  permissions: ['rpt.report.configure'],
  // `tenant`: the version table carries a tenant and its parent configuration and
  // no company or branch at all. The authority is re-checked tenant-wide in the
  // handler, because a declared scope with no target is inert (P1-18-A-01).
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rpt.report_configuration.version_created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ configurationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REPORT_CONFIGURATION_VERSION_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(CreateVersionBody, body, 'body');
      if (!(await callerHoldsPermissionTenantWide(db, 'rpt.report.configure'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A report configuration belongs to the whole tenant, so drafting a version ' +
            'of one requires rpt.report.configure granted tenant-wide.',
        });
      }
      const created = await reportingModule().configurations.createVersion(
        db,
        params.configurationId,
        parsed.parameterSchema ?? {}
      );
      // The ETag is the VERSION's own counter, which is what the publish command's
      // `If-Match` expects. The configuration carries a different one and the detail
      // read publishes that.
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
