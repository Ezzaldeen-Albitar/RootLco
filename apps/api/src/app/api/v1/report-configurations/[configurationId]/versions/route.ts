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
 * ## `parameterSchema` — bounded in SHAPE and in VOCABULARY
 *
 * The frozen schema constrains the column in no way at all: `parameter_schema` is
 * `jsonb NOT NULL DEFAULT '{}'` with no CHECK, no domain and no trigger over its
 * content. This route bounds the shape, because a `jsonb` column a TENANT writes
 * is otherwise a row size the tenant chooses.
 *
 * Shape alone was not enough. Owner decision **D-4** released the report engine,
 * and the engine reads a published `parameter_schema` through
 * `readReportParameterVocabulary`, refusing a run whose schema it does not
 * recognise. While this route accepted any bounded JSON object, an administrator
 * could publish a definition every run of which was then refused — a report
 * locked by its own configuration, with nothing at authoring time saying so. So
 * the route now reads the SAME function the engine reads, and a schema that
 * would be refused at run time is refused here, where the person who wrote it is
 * present to correct it.
 *
 * `{ filters: {} }` is refused rather than accepted, and that is a decision
 * rather than a transcription. It is a well-formed document, and the engine
 * honours it exactly — an allowlist permitting no filter at all. But `{}`
 * already means "place no restriction", so nobody reaches for the empty
 * allowlist to say that; they reach for it believing it says the same thing, and
 * publishing it would instead narrow the report to nothing. Refusing it names
 * the ambiguity at the only moment a person can resolve it. The ENGINE's
 * treatment is untouched: a version published before this rule existed still
 * behaves exactly as it did.
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
  readReportParameterVocabulary,
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

/**
 * Refuses a `parameterSchema` the report engine would not recognise.
 *
 * Stated as an explicit failure rather than a Zod refinement because the MESSAGE
 * is the whole point of the rule. `parseOrFail` maps a refinement to a path and
 * the stable code `custom`, deliberately dropping the text so no validation
 * error can echo a submitted value — correct for that mapping, and useless for a
 * refusal whose job is to tell an administrator which vocabulary exists.
 *
 * No part of the submitted document is quoted back. `reason` names the RULE that
 * was broken and the message names the vocabulary, so the refusal is actionable
 * without carrying tenant input into a log or onto a screen.
 */
function assertParameterVocabulary(schema: Record<string, unknown>): void {
  const vocabulary = readReportParameterVocabulary(schema);
  if (vocabulary.kind === 'unrecognised') {
    throw new AppFailure('ERR-VAL-001', {
      message:
        `The parameter schema was refused because ${vocabulary.reason}. ` +
        'A report parameter schema is either an empty object, which places no ' +
        'restriction on a run, or an object holding one key, filters, naming any ' +
        'of companyId with type uuid, branchId with type uuid, from with type ' +
        'date and to with type date. Each named filter declares exactly one key, ' +
        'type. A schema outside that vocabulary is refused by the report engine ' +
        'on every run, so it is refused here instead.',
      safeDetails: { violations: [{ path: 'body.parameterSchema', rule: 'report_vocabulary' }] },
    });
  }
  if (vocabulary.kind === 'allowlist' && vocabulary.names.length === 0) {
    throw new AppFailure('ERR-VAL-001', {
      message:
        'The parameter schema declares filters with nothing inside it, which is ' +
        'an allowlist permitting no filter at all. A version published with it ' +
        'would refuse every run of the report. Send an empty object, or omit the ' +
        'parameter schema, to place no restriction on a run; name the filters the ' +
        'report may be narrowed by to restrict one.',
      safeDetails: {
        violations: [{ path: 'body.parameterSchema', rule: 'empty_filter_allowlist' }],
      },
    });
  }
}

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
      assertParameterVocabulary(parsed.parameterSchema ?? {});
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
