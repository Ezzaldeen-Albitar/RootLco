/**
 * Job assignments (Phase 1-19, P1-19-BE-013…014).
 *
 * `POST` opens one, `GET` returns the full append-only history. There is no PUT and
 * no DELETE: an assignment is ended by stamping `valid_to` through
 * `POST /assignments/{assignmentId}/end`, and the row survives, because the set of
 * rows for a job IS the record of who worked it.
 *
 * ## The window is required
 *
 * Availability is a real eligibility criterion, and there is no honest default
 * window to evaluate it against: `coveredByUnion` refuses a zero-length window by
 * contract, and inventing a duration would fabricate a schedule the assigner never
 * stated. So `window` is mandatory and both bounds must carry an offset — a
 * timezone-less wall-clock string names no instant, which is the P1-17 odometer
 * lesson applied here.
 *
 * ## Required skills and certifications are supplied, not stored
 *
 * The protected schema holds no per-job requirement: there is no
 * `wo.job_required_skills` table and nothing on `wo.jobs`. So the requirement comes
 * from the assigner, is evaluated at assignment time against
 * `tech.technician_skills` / `tech.technician_certifications` / availability, and
 * cannot be re-checked afterwards. That is a recorded reconciliation, not an
 * oversight — inventing a table would be this phase editing a frozen schema.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { ASSIGNMENT_ROLES, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ jobId: schemas.uuid });

export const Body = z
  .object({
    technicianProfileId: schemas.uuid,
    assignmentRole: z.enum(ASSIGNMENT_ROLES).optional(),
    requiredSkills: z
      .array(
        z
          .object({
            skillCode: z.string().min(1).max(64),
            // The rank is a position in `tech.skill_levels`, so it is a positive
            // integer; a level the tenant has not defined simply matches nothing.
            minimumRank: z.number().int().min(1).max(1000),
          })
          .strict()
      )
      .max(20)
      .optional(),
    requiredCertificationCodes: z.array(z.string().min(1).max(64)).max(20).optional(),
    window: z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      })
      .strict(),
    // No `reason` here, deliberately. An earlier version of this schema accepted one and
    // the service never read it: the body is `.strict()`, so a caller sending `reason`
    // got a 201 and reasonably concluded it had been stored, when it had been discarded.
    //
    // `wo.job_assignments.reason` is about ENDING an assignment.
    // `ck_job_assignments_end_reason` is `valid_to IS NULL OR (reason IS NOT NULL AND
    // btrim(reason) <> '')` — it makes a reason MANDATORY once `valid_to` is stamped and
    // says nothing about a live row, so the column would in fact accept one here. That is
    // the argument for removing the field rather than wiring it: the write path that has
    // a use for a reason is `POST /assignments/{id}/end`, and a reason recorded at
    // assignment time would sit in the column that a later ending is required to fill,
    // making the ending's own reason ambiguous.
    //
    // Accepting a field and ignoring it is worse than rejecting it: the rejection is
    // information, the silence is a lie.
  })
  .strict();

export const JOB_ASSIGNMENT_CREATE_OPERATION = defineOperation({
  id: 'wo.job-assignment-create',
  successStatus: 201,
  module: 'work-order',
  method: 'POST',
  path: '/jobs/{jobId}/assignments',
  summary: 'Assign a technician to a job.',
  permissions: ['tech.assignment.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'wo.job.assigned',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    JOB_ASSIGNMENT_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const from = new Date(parsed.window.from);
      const to = new Date(parsed.window.to);
      const assignment = await workOrderModule().jobAssignments.assign(
        db,
        params.jobId,
        {
          technicianProfileId: parsed.technicianProfileId,
          assignmentRole: parsed.assignmentRole,
          requiredSkills: parsed.requiredSkills,
          requiredCertificationCodes: parsed.requiredCertificationCodes,
          window: { from, to },
        },
        authorizeScope
      );
      return { status: 201, body: assignment, recordVersion: assignment.recordVersion };
    },
    { params: raw, body }
  );
}

export const JOB_ASSIGNMENT_LIST_OPERATION = defineOperation({
  id: 'wo.job-assignment-list',
  module: 'work-order',
  method: 'GET',
  path: '/jobs/{jobId}/assignments',
  summary: 'Read the append-only assignment history of a job.',
  // `tech.technician.read`, not `wo.work_order.read`: an assignment names a member
  // of staff, and who worked a vehicle is employee-derived data rather than
  // work-order data. A caller who may read the board is not thereby entitled to the
  // roster.
  permissions: ['tech.technician.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    JOB_ASSIGNMENT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await workOrderModule().jobAssignments.assignments(
            db,
            params.jobId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
