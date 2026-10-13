/**
 * GET / POST /api/v1/report-configurations (Phase 1-31, prerequisite **P-11**).
 *
 * The tenant's report DEFINITIONS, as configuration. `GET` lists every one of them
 * whatever its status; `POST` creates a draft.
 *
 * ## Why this exists at all
 *
 * `rpt.report_configurations` and `rpt.report_configuration_versions` landed in
 * P1-11 with `INSERT` and `UPDATE` grants and policies, and **no code anywhere in
 * `apps/api` had ever written either table**. P1-23 shipped the two READS over
 * them — `rpt.report-catalogue` and `rpt.report-read` — and both filter on
 * `status = 'published'`, so the only rows they could return were rows nothing
 * could create: every tenant's report catalogue was empty and permanently so. The
 * `rpt.report.configure` code the catalogue has seeded since P1-08 was declared by
 * NO operation and named by NO row-level-security predicate, and the P1-23
 * repository names it in a comment as the authority for "writes through
 * `rpt.report.configure`" that did not exist.
 *
 * ## Why this collection is top-level and names no company
 *
 * Because the TABLE names none. `rpt.report_configurations` has a `tenant_id` and
 * no `company_id` and no `branch_id`; `sel_report_configurations_scope` is
 * `tenant_id = iam.current_tenant_id()` with no other term. A definition is the
 * tenant's, and `scope_level` — `branch`, `company` or `tenant` — describes how
 * wide the FIGURES a report answers with may be, not who owns the definition.
 *
 * ## Why every operation here declares the CONFIGURE code, reads included
 *
 * This surface exposes DRAFTS, ARCHIVED definitions and every VERSION of each. A
 * `rpt.report.read` holder sees published definitions through `/reports`, which is
 * the whole of what that code was minted for; gating this list on it would publish
 * the tenant's unfinished and withdrawn decisions to everyone who may open a
 * report. That is a departure from the P-9 and P-10 seams beside it, where the
 * read code and the write code differ, and it is a departure because the rows are
 * different rows.
 *
 * ## No money
 *
 * `rpt` has no monetary column of any kind. `versionNumber` and `recordVersion`
 * are counters and are JSON numbers, which is what every counter in this codebase
 * is; the decimal-string rule exists because `numeric` cannot survive IEEE-754,
 * and there is no `numeric` column anywhere in this schema.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import {
  MAX_REPORT_NAME,
  REPORT_CODE_FORMAT,
  REPORT_CONFIGURATION_STATUSES,
  REPORT_SCOPE_LEVELS,
  reportingModule,
} from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Query surface — a closed allow-list: one filter and pagination.
 *
 * `status` is offered because it is the narrowing an authoring screen genuinely
 * needs: "what is live" and "what am I still drafting" are the two questions the
 * list answers. It is OPTIONAL and the list is UNFILTERED by default, because a
 * configuration list that hid archived rows would make the restore command
 * unreachable — the trap `apt.catalogue-source-channel-status-set` records for its
 * own catalogue.
 *
 * No `reportCode` filter is offered. `uq_report_configurations_code` makes the
 * code unique per tenant, so a filter on it is a detail read wearing a list's
 * clothes, and this seam already has a detail read.
 */
const ListQuery = z
  .object({
    status: z.enum(REPORT_CONFIGURATION_STATUSES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const REPORT_CONFIGURATION_LIST_OPERATION = defineOperation({
  id: 'rpt.report-configuration-list',
  module: 'reporting',
  method: 'GET',
  path: '/report-configurations',
  summary: 'List the report configurations of the tenant, in every status.',
  // `rpt.report.configure`, and NOT `rpt.report.read`. This list shows drafts and
  // archived definitions — decisions that are unfinished and decisions that were
  // withdrawn — which the catalogue deliberately hides from a report reader. The
  // code has been seeded since P1-08 and is declared here for the first time;
  // nothing is minted.
  permissions: ['rpt.report.configure'],
  // `tenant`: the table has no company and no branch, and the RLS predicate is the
  // tenant alone. The handler re-checks the authority tenant-wide, because a
  // declared scope with no target is inert (P1-18-A-01).
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    REPORT_CONFIGURATION_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(
        ListQuery,
        searchParamsToObject(new URL(raw.url).searchParams),
        'query'
      );
      /**
       * The list shows the whole tenant's definitions and no row carries a company
       * or a branch, so there is no scope target and the pre-handler check degrades
       * to the scope-blind `iam.has_permission` whatever this operation declares
       * (P1-18-A-01). Without this, an actor granted `rpt.report.configure` in one
       * branch would read every draft and every withdrawn definition in the tenant.
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'rpt.report.configure'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A report configuration belongs to the whole tenant, so listing the ' +
            'tenant’s definitions requires rpt.report.configure granted tenant-wide.',
        });
      }
      return {
        body: await reportingModule().configurations.listConfigurations(
          db,
          { ...(query.status === undefined ? {} : { status: query.status }) },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          }
        ),
      };
    }
  );
}

/**
 * Create body — a closed allow-list.
 *
 * It refuses `id`, so a caller cannot choose a primary key. It refuses `status`,
 * so a definition cannot be created already `published` — visible in
 * `/reports` before anyone has read it back — nor already `archived`. It refuses
 * `ownerUserId`, which the service takes from the session: the column is a claim
 * about who authored the row, and a caller that could set it could author on
 * someone else's behalf.
 *
 * `exportPermissionCode` is REQUIRED, because `rpt.report_configurations.export_permission_code`
 * is `NOT NULL` with no default. It is a claim checked by
 * `fk_report_configurations_permission` against the platform permission
 * catalogue, and it names the permission an EXPORT of this report would require —
 * never the permission to view it. That separation is a contract fact of the
 * frozen schema and is projected rather than reinvented.
 *
 * `reportCode` mirrors `ck_report_configurations_code` so a malformed code is a
 * 422 naming the field rather than a `23514` naming a constraint; the CHECK is
 * still the authority. It is frozen by `tg_report_configurations_immutable` once
 * written, so a wrong one is not repairable by an edit.
 */
export const CreateBody = z
  .object({
    reportCode: z
      .string()
      .regex(REPORT_CODE_FORMAT, 'reportCode must match ^[a-z][a-z0-9_]{1,62}$'),
    name: z.string().trim().min(1).max(MAX_REPORT_NAME),
    scopeLevel: z.enum(REPORT_SCOPE_LEVELS),
    exportPermissionCode: z.string().trim().min(1).max(120),
  })
  .strict();

export const REPORT_CONFIGURATION_CREATE_OPERATION = defineOperation({
  id: 'rpt.report-configuration-create',
  successStatus: 201,
  module: 'reporting',
  method: 'POST',
  path: '/report-configurations',
  summary: 'Create a draft report configuration for the tenant.',
  permissions: ['rpt.report.configure'],
  // `tenant`, and re-authorized tenant-wide by the handler for the reason above:
  // there is no company or branch on the row to narrow against.
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rpt.report_configuration.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REPORT_CONFIGURATION_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      /**
       * Authoring a definition is a TENANT-WIDE act: the row has no company and no
       * branch, `uq_report_configurations_code` consumes the report code for the
       * whole tenant, and `tg_report_configurations_immutable` then freezes it. A
       * declared scope with no target is inert (P1-18-A-01), so without this a
       * branch-scoped holder could consume a tenant-wide code permanently.
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'rpt.report.configure'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A report configuration belongs to the whole tenant, so creating one ' +
            'requires rpt.report.configure granted tenant-wide.',
        });
      }
      const created = await reportingModule().configurations.createConfiguration(db, {
        reportCode: parsed.reportCode,
        name: parsed.name,
        scopeLevel: parsed.scopeLevel,
        exportPermissionCode: parsed.exportPermissionCode,
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
