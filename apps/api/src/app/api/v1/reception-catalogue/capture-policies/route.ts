/**
 * GET / POST /api/v1/reception-catalogue/capture-policies (Owner decision
 * FE-019, and the capture floor FE-012 depends on).
 *
 * ## The default is the ABSENCE of a rule
 *
 * FE-019 says supporting media for a refusal is optional by default and may
 * become mandatory by tenant, workflow or refusal type. That is implemented as
 * literally as it is written: `rec.guard_refusal_evidence_version()` looks for a
 * live rule and, finding none, requires nothing. No row is seeded, so a tenant
 * that never opens this endpoint is never blocked — refusal is not globally
 * media-dependent and cannot become so by accident.
 *
 * Raising the floor is an explicit act recorded here, keyed by
 * `(branch, requirement, refusal type)` with branch-and-type precedence. The
 * same precedence is applied by the guard, so what this endpoint reports as
 * required is what the database will actually enforce.
 *
 * ## Setting a rule retires the previous one rather than editing it
 *
 * The rule that applied at the time of a visit must stay readable. The four
 * partial unique indexes hold one LIVE rule per key and impose no limit on
 * retired ones, so the module retires and inserts inside one transaction — no
 * moment exists in which a key has two live rules or none. `rec.capture_policy_rules`
 * grants UPDATE on `retired_at` alone, so no other field of a published rule can
 * be rewritten by any path.
 *
 * Both operations cost `rec.catalogue.manage`, granted to nobody by default.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  CAPTURE_POLICY_REFUSAL_TYPES,
  CAPTURE_POLICY_REQUIREMENTS,
  MAX_CAPTURE_COUNT,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({}).strict();

const SetBody = z
  .object({
    requirementCode: z.enum(CAPTURE_POLICY_REQUIREMENTS),
    refusalType: z.enum(CAPTURE_POLICY_REFUSAL_TYPES).nullable().optional(),
    minCount: z.number().int().min(0).max(MAX_CAPTURE_COUNT),
    deviceCapturedAtRequired: z.boolean().optional(),
    witnessRequired: z.boolean().optional(),
    companyId: schemas.uuid.nullable().optional(),
    branchId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const CAPTURE_POLICY_LIST_OPERATION = defineOperation({
  id: 'rec.catalogue-capture-policy-list',
  module: 'reception',
  method: 'GET',
  path: '/reception-catalogue/capture-policies',
  summary: 'List the live reception capture policy rules of the caller tenant.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(CAPTURE_POLICY_LIST_OPERATION, request, async ({ db, request: raw }) => {
    parseOrFail(Query, Object.fromEntries(new URL(raw.url).searchParams), 'query');
    return { body: { policies: await receptionModule().receptionCapture.listCapturePolicies(db) } };
  });
}

export const CAPTURE_POLICY_SET_OPERATION = defineOperation({
  id: 'rec.catalogue-capture-policy-set',
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/capture-policies',
  summary: 'Set the live reception capture policy rule for one requirement.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.capture_policy.set',
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
    CAPTURE_POLICY_SET_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionCapture.setCapturePolicy(
        db,
        await parseJsonBody(raw, SetBody),
        authorizeScope
      ),
    }),
    { body }
  );
}
