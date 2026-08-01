/**
 * GET /api/v1/technicians/available (Phase 1-19, P1-19-BE-016).
 *
 * Ranks a branch's active technicians against one requirement, and reports EVERY
 * candidate with its verdict rather than only the eligible ones. An assigner looking
 * at an empty list learns nothing; a list saying "these four are free, and this one's
 * high-voltage certification expired" is what lets them act.
 *
 * ## Company and branch are required because they are the authorization target
 *
 * `scope: 'branch'` is inert without a target — `requiresScopedEvaluation` returns
 * false on an empty one whatever the declaration says, and `app.branch_ids` is the
 * permission-blind union of every active grant (P1-18-A-01). Naming the pair lets it
 * be passed through `scopeTargetOption`, so the permission is evaluated by
 * `iam.has_permission_in_scope` against the branch whose roster is being read. A
 * roster is employee-derived data; being able to read one branch's is not being able
 * to read another's.
 *
 * ## The window is required, and the skill encoding is explicit
 *
 * Availability is evaluated against the UNION of the technician's intervals, which
 * needs a real window: `coveredByUnion` refuses a zero-length one by contract, and
 * inventing a duration would fabricate a schedule the caller never stated. Skills are
 * `code:minimumRank` pairs, comma-separated, because a query string has no natural
 * shape for a list of objects and a documented encoding is better than a body on a
 * GET.
 *
 * The candidate set is capped and the cap is REPORTED (`truncatedAt`). A silently
 * truncated roster that looked complete would be worse than none — an assigner would
 * conclude nobody is available when someone is.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bounded candidate set. Each candidate costs a fixed number of queries. */
const MAX_CANDIDATES = 50;

const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    /** `code:minimumRank`, comma-separated. e.g. `brakes:20,hybrid:10`. */
    skills: z
      .string()
      .regex(
        /^[a-z0-9_.-]{1,64}:\d{1,4}(,[a-z0-9_.-]{1,64}:\d{1,4})*$/i,
        'must be code:rank pairs separated by commas'
      )
      .optional(),
    /** Certification codes, comma-separated. */
    certifications: z
      .string()
      .regex(/^[a-z0-9_.-]{1,64}(,[a-z0-9_.-]{1,64})*$/i, 'must be codes separated by commas')
      .optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const TECHNICIAN_AVAILABLE_OPERATION = defineOperation({
  id: 'tech.technician-available',
  module: 'technician',
  method: 'GET',
  path: '/technicians/available',
  summary: 'Rank a branch’s technicians against a skill, certification and time requirement.',
  permissions: ['tech.technician.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    TECHNICIAN_AVAILABLE_OPERATION,
    request,
    async ({ db }) => {
      const query = parseOrFail(Query, raw, 'query');
      const skills = (query.skills ?? '')
        .split(',')
        .filter((entry) => entry.length > 0)
        .map((entry) => {
          const [skillCode, rank] = entry.split(':');
          return { skillCode: skillCode ?? '', minimumRank: Number(rank) };
        });
      const certificationCodes = (query.certifications ?? '')
        .split(',')
        .filter((entry) => entry.length > 0);
      return {
        body: await technicianModule().eligibility.candidates(
          db,
          {
            skills,
            certificationCodes,
            from: new Date(query.from),
            to: new Date(query.to),
            companyId: query.companyId,
            branchId: query.branchId,
          },
          new Date(),
          Math.min(query.limit ?? MAX_CANDIDATES, MAX_CANDIDATES)
        ),
      };
    },
    scopeTargetOption(raw)
  );
}
