/**
 * GET / POST /api/v1/delivery-checklist-templates (Phase 1-31, prerequisite P-9).
 *
 * The delivery handover checklist, as configuration. `GET` lists the templates the
 * caller can see; `POST` creates one, with its items, in one transaction.
 *
 * ## Why this exists at all — PPD-12
 *
 * `sal.delivery_checklist_templates` and its items landed in P1-11 with INSERT and
 * UPDATE grants and policies, and **no code anywhere in `apps/api` had ever written
 * either table**. The A0 preflight records the consequence: on a tenant provisioned
 * through the product the checklist is empty and permanently so, the handover
 * checklist screen (FE-004) has nothing to render, and the results read published by
 * P-4 answers for items no caller can create or enumerate. The backend suites seeded
 * these tables by admin SQL precisely because there was no other way.
 *
 * ## Why the collection is top-level and not nested under a delivery
 *
 * A template is company configuration and is addressed independently of any delivery:
 * `sal.delivery_records` carries no template reference at all, which is the same fact
 * that makes the completion gate company-wide. Nesting the configuration under the
 * resource that consumes it would invert the dependency, and there is no delivery to
 * nest it under while it is being authored. `/service-categories` is the sibling
 * precedent for a top-level configuration collection.
 *
 * ## No money
 *
 * Neither table has a `numeric` column. `sortOrder` is `integer` and is rendered as a
 * JSON number: the decimal-string rule this codebase applies to money exists because
 * `numeric` cannot survive IEEE-754, which does not apply to an `integer`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  CHECKLIST_CODE,
  MAX_ITEM_LABEL,
  MAX_SORT_ORDER,
  MAX_TEMPLATE_NAME,
  MIN_SORT_ORDER,
  deliveryModule,
} from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Query surface — a closed allow-list, pagination only.
 *
 * No company filter is offered, and that is deliberate rather than an omission: every
 * row carries its own `companyId`, `sel_delivery_checklist_templates_scope` already
 * narrows the set to the companies the caller's grants reach, and a filter that could
 * only ever narrow that further is a branch, a denial case and a coverage obligation
 * for no capability. `svc.service-category-list` states the same rule.
 */
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const CHECKLIST_TEMPLATE_LIST_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-list',
  module: 'delivery',
  method: 'GET',
  path: '/delivery-checklist-templates',
  summary: 'List the delivery checklist templates visible to the caller.',
  // The same code the rest of the delivery read seam declares, and the only
  // delivery READ code the catalogue seeds. NOT `sal.delivery.manage`: the person
  // who performs a handover must be able to read the checklist they are working
  // through, and requiring the write code would make the configuration invisible to
  // them. NOT `sal.delivery.read` either, which `navigation.ts` names and the seeded
  // catalogue does not define (RES-05, prerequisite P-8).
  permissions: ['sal.delivery.view'],
  // `tenant`, and this is the substantive scope decision on the READ side. The
  // table has a company and NO branch, so a company target would be satisfiable
  // only by a company-wide or unrestricted grant — which would deny the checklist
  // to a delivery officer scoped to one branch, the exact principal the handover
  // depends on. `sel_delivery_checklist_templates_scope` narrows by
  // `iam.allowed_company_ids()`, which includes the company of a branch-scoped
  // grant, so the caller sees its own companies' templates and no others. The
  // WRITES below re-authorize against the target company and do not rely on this.
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    CHECKLIST_TEMPLATE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(
        Query,
        searchParamsToObject(new URL(raw.url).searchParams),
        'query'
      );
      return {
        body: await deliveryModule().checklistTemplates.listTemplates(db, {
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    }
  );
}

/**
 * Create body — a closed allow-list.
 *
 * It refuses `id`, so a caller cannot choose a primary key, and refuses `status`, so
 * a template cannot be created already `inactive` — one that is offered nowhere while
 * its mandatory items still gate every handover in the company. The column defaults
 * to `active`.
 *
 * `companyId` is REQUIRED and is a claim, not a scope: the service authorizes it
 * against the caller's own grants before anything is written, and
 * `fk_delivery_checklist_templates_company` resolves it with the tenant taken from
 * the session context, so a company belonging to another tenant cannot be named into
 * existence here.
 *
 * `items` may be omitted, but when it is present it lands in the SAME transaction as
 * the header — a half-created checklist is not a state this surface can produce.
 */
export const CreateBody = z
  .object({
    companyId: schemas.uuid,
    templateCode: z
      .string()
      .regex(CHECKLIST_CODE, 'templateCode must match ^[a-z][a-z0-9_]{1,62}$'),
    name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME),
    items: z
      .array(
        z
          .object({
            itemCode: z
              .string()
              .regex(CHECKLIST_CODE, 'itemCode must match ^[a-z][a-z0-9_]{1,62}$'),
            label: z.string().trim().min(1).max(MAX_ITEM_LABEL),
            isMandatory: z.boolean().optional(),
            sortOrder: z.number().int().min(MIN_SORT_ORDER).max(MAX_SORT_ORDER).optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

export const CHECKLIST_TEMPLATE_CREATE_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-create',
  successStatus: 201,
  module: 'delivery',
  method: 'POST',
  path: '/delivery-checklist-templates',
  summary: 'Create a delivery checklist template, with its items, for one company.',
  // `sal.delivery.manage`. The catalogue seeds no delivery "configure" code and this
  // slice mints none: the repository rule, stated by `svc.service-category-create`,
  // is to reuse the module's manage code rather than add one the least-privilege
  // review did not approve.
  permissions: ['sal.delivery.manage'],
  // `company`, and the target is supplied by the SERVICE against the row's own
  // company once the body is validated — a declared scope is inert without a target
  // (P1-18-A-01), so the declaration alone decides nothing. The authority must be
  // company-wide because a mandatory item authored here blocks the handover of every
  // vehicle in every branch of that company: `sal.complete_delivery` counts mandatory
  // items by `(tenant, company)` across all templates, since a delivery record
  // carries no template reference.
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'sal.delivery_checklist_template.created',
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
    CHECKLIST_TEMPLATE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const created = await deliveryModule().checklistTemplates.createTemplate(
        db,
        {
          companyId: parsed.companyId,
          templateCode: parsed.templateCode,
          name: parsed.name,
          items: parsed.items ?? [],
        },
        authorizeScope
      );
      // The ETag is the TEMPLATE's version, which is what `If-Match` on the rename
      // and the status command expects. An item carries its own counter and is
      // fetched with the detail read.
      return { status: 201, body: created, recordVersion: created.template.recordVersion };
    },
    { body }
  );
}
