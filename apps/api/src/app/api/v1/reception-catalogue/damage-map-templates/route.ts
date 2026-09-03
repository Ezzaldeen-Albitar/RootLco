/**
 * GET / POST /api/v1/reception-catalogue/damage-map-templates (Owner decision
 * FE-012).
 *
 * ## Template administration is not a receptionist function
 *
 * Both operations cost `rec.catalogue.manage`, the same code the other reception
 * configuration catalogues use, and no capture permission implies it. Which
 * diagram every operator in the workshop draws damage on is a configuration
 * decision with a long tail — every mark ever placed is anchored to the revision
 * that was live when it was drawn — so the authority to change it is separated
 * from the authority to use it.
 *
 * The pickers a receptionist actually needs are NOT here: the bindable templates
 * for one visit's branch are part of that visit's capture contract, at
 * `GET /receptions/{receptionId}/evidence-bindings`, behind `rec.reception.read`.
 * That split is what keeps `rec.catalogue.manage` meaningful.
 *
 * ## Creating a slot creates nothing to draw on
 *
 * A slot has no bindable geometry until a revision is published against it
 * (`.../{templateId}/versions`), and a revision needs an ACCEPTED document in
 * the `reception_damage_map_template` category linked to the slot. Zero rows
 * ship: the no-fake-data policy is permanent, and what a tenant's templates
 * contain is the operator's decision, never a seed.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { DAMAGE_MAP_TYPES, MAX_TEMPLATE_PERSPECTIVE, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `companyId` and `branchId` travel together or not at all — the tenant-wide
 * form is both absent. `ck_damage_map_templates_scope` says the same thing, and
 * the module reports half a pair as a 422 naming the field.
 */
export const CreateBody = z
  .object({
    mapType: z.enum(DAMAGE_MAP_TYPES),
    perspective: z.string().min(1).max(MAX_TEMPLATE_PERSPECTIVE).nullable().optional(),
    companyId: schemas.uuid.nullable().optional(),
    branchId: schemas.uuid.nullable().optional(),
  })
  .strict();

const Query = z.object({}).strict();

export const DAMAGE_MAP_TEMPLATE_LIST_OPERATION = defineOperation({
  id: 'rec.catalogue-damage-map-template-list',
  module: 'reception',
  method: 'GET',
  path: '/reception-catalogue/damage-map-templates',
  summary: 'List every damage-map template of the caller tenant, retired ones included.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    DAMAGE_MAP_TEMPLATE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => {
      parseOrFail(Query, Object.fromEntries(new URL(raw.url).searchParams), 'query');
      return {
        body: {
          templates: await receptionModule().receptionCapture.listTemplatesForManagement(db),
        },
      };
    }
  );
}

export const DAMAGE_MAP_TEMPLATE_CREATE_OPERATION = defineOperation({
  id: 'rec.catalogue-damage-map-template-create',
  successStatus: 201,
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/damage-map-templates',
  summary: 'Create a damage-map template slot for the caller tenant or one of its branches.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.damage_map_template.created',
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
    DAMAGE_MAP_TEMPLATE_CREATE_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionCapture.createTemplate(
        db,
        await parseJsonBody(raw, CreateBody),
        // A branch-scoped slot is re-authorized against ITS OWN branch inside
        // the module: `scope: 'tenant'` has no branch to evaluate here.
        authorizeScope
      ),
    }),
    { body }
  );
}
