/**
 * PUT / DELETE /api/v1/technicians/{technicianProfileId}/skills/{skillId} (PRE-P1-29-BR-03).
 *
 * ## PUT, because the relation is one level per skill
 *
 * `uq_technician_skills_profile_skill` is unique on
 * `(tenant, company, branch, technician_profile_id, skill_id) WHERE deleted_at IS NULL`,
 * so re-sending SETS the level rather than accumulating a second row. That is the
 * `dia.diagnostic-item-result` shape — a PUT that records or replaces — and reusing
 * it keeps one idiom in the domain. `skill_id` is named by the immutability guard,
 * so the replacement path moves the LEVEL of the existing row.
 *
 * ## No version guard, and that is a property of the addressing rather than a gap
 *
 * The pair `(profile, skill)` identifies at most one live row by construction, and
 * the aggregate read returns skills without a `recordVersion` — so a client has no
 * version to send. A PUT that is idempotent in the level it names does not need one:
 * two concurrent PUTs of the same level agree, and two of different levels are a
 * last-writer-wins the caller can see in the response.
 *
 * ## The catalogue check the foreign keys cannot make
 *
 * `fk_technician_skills_skill` and `fk_technician_skills_level` are SINGLE-column,
 * because a platform catalogue row carries `tenant_id IS NULL` and cannot
 * participate in the composite. The database therefore cannot prove the tenant may
 * reference the row, and this is the one place in the slice where that is true. The
 * service checks `scope = 'platform' OR tenant_id = current tenant` before writing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Params = z.object({
  technicianProfileId: schemas.uuid,
  skillId: schemas.uuid,
});

export const Body = z.object({ skillLevelId: schemas.uuid }).strict();

/**
 * Each declaration sits immediately before ITS OWN handler. See the note in
 * `app/api/v1/technicians/route.ts`: `scripts/p1-19-endpoint-inventory.mjs`
 * reads the text between one `defineOperation` and the next to decide whether a
 * `scope: 'branch'` claim is enforced, so stacking declarations makes the first
 * read as inert and credits the second with a handler it does not own.
 */
export const TECHNICIAN_SKILL_SET_OPERATION = defineOperation({
  id: 'tech.technician-skill-set',
  module: 'technician',
  method: 'PUT',
  path: '/technicians/{technicianProfileId}/skills/{skillId}',
  summary: 'Record or replace a technician’s proficiency level in one skill.',
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.skill_set',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string; skillId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TECHNICIAN_SKILL_SET_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      return {
        body: await technicianModule().roster.setSkill(
          db,
          params.technicianProfileId,
          params.skillId,
          parsed.skillLevelId,
          authorizeScope
        ),
      };
    },
    { params: raw, body }
  );
}

export const TECHNICIAN_SKILL_WITHDRAW_OPERATION = defineOperation({
  id: 'tech.technician-skill-withdraw',
  module: 'technician',
  method: 'DELETE',
  path: '/technicians/{technicianProfileId}/skills/{skillId}',
  summary: 'Withdraw a technician’s skill. Soft delete: the eligibility history stays readable.',
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.skill_withdrawn',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function DELETE(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string; skillId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    TECHNICIAN_SKILL_WITHDRAW_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await technicianModule().roster.withdrawSkill(
          db,
          params.technicianProfileId,
          params.skillId,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
