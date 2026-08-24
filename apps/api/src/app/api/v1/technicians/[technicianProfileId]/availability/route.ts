/**
 * POST /api/v1/technicians/{technicianProfileId}/availability (PRE-P1-29-BR-03).
 *
 * Records one availability or unavailability window — the rows
 * `tech.technician-availability` (`GET /technicians/available`) already reads and
 * `assertEligible` already consumes. Until now they could only arrive by seed or
 * by hand, so a shipped read answered from data no shipped write produced.
 *
 * ## Why the window is an INSTANT pair and the certification dates are not
 *
 * `available_from`/`available_to` are `timestamptz`: a shift starts at a time of
 * day, in a real zone, and `intervalCovers` compares instants. `{ offset: true }`
 * is therefore mandatory rather than decorative — a zoneless `2026-09-01T08:00:00`
 * would be read in the server's zone and silently shift the shift.
 *
 * ## Overlap is the database's answer, not a pre-check
 *
 * `ex_technician_availability_overlap` is a gist EXCLUDE over
 * `tstzrange(available_from, available_to)` per live technician. A read-then-write
 * pre-check would still lose to a concurrent insert; the service translates the
 * resulting `23P01` into `ERR-RES-002` with `rule: 'overlapping-window'` instead of
 * predicting it. The one rule the API does check first is `to > from`, because the
 * empty range the constraint would accept is a window that covers nothing.
 *
 * ## `availabilityKind` is required and has no default
 *
 * `available` and `unavailable` share a table and an overlap constraint, and they
 * mean opposite things to eligibility. Defaulting either way would let a typo book
 * absence as presence, so the caller must say which.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  AVAILABILITY_KINDS,
  MAX_UNAVAILABILITY_REASON,
  technicianModule,
} from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Params = z.object({ technicianProfileId: schemas.uuid });

export const Body = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    availabilityKind: z.enum(AVAILABILITY_KINDS),
    reason: z.string().trim().min(1).max(MAX_UNAVAILABILITY_REASON).optional(),
  })
  .strict();

export const TECHNICIAN_AVAILABILITY_RECORD_OPERATION = defineOperation({
  id: 'tech.technician-availability-record',
  module: 'technician',
  method: 'POST',
  path: '/technicians/{technicianProfileId}/availability',
  summary: 'Record one availability or unavailability window for a technician.',
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.availability_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TECHNICIAN_AVAILABILITY_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const created = await technicianModule().roster.recordAvailability(
        db,
        params.technicianProfileId,
        {
          availableFrom: new Date(parsed.from),
          availableTo: new Date(parsed.to),
          availabilityKind: parsed.availabilityKind,
          reason: parsed.reason,
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
