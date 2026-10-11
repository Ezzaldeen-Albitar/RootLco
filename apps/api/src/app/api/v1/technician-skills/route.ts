/**
 * GET /api/v1/technician-skills (`P1-32-PRE-OD-ADM2B`).
 *
 * The skill vocabulary a technician can be given. `tech.technician-skill-set`
 * takes a `skillId` in its path and a `skillLevelId` in its body, and until this
 * read nothing published either: the eligibility service read the catalogue for
 * its own decisions and no operation exposed it, so an administrator could only
 * set a skill by pasting a reference they had no way to learn.
 *
 * ## One read for both halves of a holding
 *
 * A holding is a skill AT a level, and the set command needs both ids. The two
 * catalogues are small, tenant-wide reference data and are always chosen
 * together, so they are answered together rather than as two reads a screen must
 * always issue in pairs.
 *
 * ## Tenant-wide, under RLS
 *
 * `tech.skills` and `tech.skill_levels` are dual-scope catalogues with RLS
 * enabled and forced: a caller sees the platform rows and their own tenant's,
 * a tenant row shadowing the platform row of the same code, and never another
 * tenant's. Only ACTIVE rows are answered — the set command refuses an inactive
 * one, so offering it would offer a choice that cannot be made.
 *
 * `tech.technician.read` is the code: choosing a skill to give someone is reading
 * the vocabulary, the precedent `inv.item-category-list` sets for its catalogue.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const TECHNICIAN_SKILL_LIST_OPERATION = defineOperation({
  id: 'tech.skill-list',
  module: 'technician',
  method: 'GET',
  path: '/technician-skills',
  summary: 'List the active skills and proficiency levels a technician can be given.',
  permissions: ['tech.technician.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(TECHNICIAN_SKILL_LIST_OPERATION, request, async ({ db }) => ({
    body: await technicianModule().roster.skillCatalogue(db),
  }));
}
