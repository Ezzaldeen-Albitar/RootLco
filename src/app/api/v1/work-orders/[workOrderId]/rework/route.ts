/**
 * Rework cases against a closed work order (Phase 1-19, P1-19-BE-019).
 *
 * `POST` opens a rework work order and links it to the closed original, in ONE
 * transaction. `GET` lists the rework cases raised against this order.
 *
 * ## This is the second — and last — path that inserts a work order
 *
 * Wave 4 concluded that reception's conversion is the only creation path, and that was
 * about the ORDINARY path: an ordinary order originates from an authorized visit, and
 * a second insert would not be the one the reception lock and
 * `uq_work_orders_ordinary_origin` were designed around.
 *
 * A REWORK order originates from a CLOSED work order, which reception cannot observe.
 * `wo.work_orders.kind = 'rework'` exists for it, and two schema facts show it was
 * designed for rather than tolerated: `wo.guard_work_order_refs` precondition 3 admits
 * a `converted` visit, and `uq_work_orders_ordinary_origin` is PARTIAL on
 * `kind = 'ordinary'`. Without this path `qms.rework_links` is unreachable and closure
 * blocker B6 can never fire, because nothing in the platform can produce its subject.
 *
 * The insert itself lives in the `work-order` module, which owns `wo.work_orders`; the
 * link is written here. Both land in one transaction, so a rework order can never
 * exist without the link that explains it.
 *
 * ## What the original must be
 *
 * CLOSED and NOT a cancellation. `qms.guard_rework_link_coherence` reads
 * `wo.work_order_states.is_closed`, which is the floor — but the seeded `cancelled`
 * row carries `is_closed = true` as well as `is_cancellation = true`, so the database
 * on its own would accept a rework against an abandoned order. The service refuses
 * that: rework corrects work that was DONE badly, and a cancelled order had nothing
 * certified or released to correct.
 *
 * An earlier version of this file asserted the opposite — "cancelled is terminal and
 * not closed" — in five places at once, and was simply wrong about the seed.
 *
 * ## BR-QMS-001 starts here
 *
 * `ck_rework_links_safety_lead` makes a lead technician mandatory when
 * `isSafetyCritical`, and `ck_rework_links_signoff_distinct` will later refuse a
 * sign-off by that same technician — a CHECK, not a trigger. The lead is frozen by
 * `org.guard_immutable_columns`, so it cannot be swapped afterwards to make a
 * signature legal. Until the sign-off exists, B6 blocks the rework order's own closure.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_CORRECTIVE_ACTION, MAX_ROOT_CAUSE, qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

const Body = z
  .object({
    rootCause: z.string().trim().min(1).max(MAX_ROOT_CAUSE),
    correctiveAction: z.string().trim().min(1).max(MAX_CORRECTIVE_ACTION),
    // Nullable in the schema and optional here: who was responsible is not always
    // known when the case is opened, and a mandatory field would invite a placeholder.
    responsibility: z.string().trim().min(1).max(MAX_ROOT_CAUSE).optional(),
    /** A `tech.technician_profiles` id, not a user id — the roster is what matters. */
    leadTechnicianId: schemas.uuid.optional(),
    isSafetyCritical: z.boolean().optional(),
  })
  .strict();

export const REWORK_CREATE_OPERATION = defineOperation({
  id: 'qms.rework-create',
  module: 'quality',
  method: 'POST',
  path: '/work-orders/{workOrderId}/rework',
  summary: 'Open a rework work order against a closed original and link the two.',
  permissions: ['qms.rework.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'qms.rework.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REWORK_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const created = await qualityModule().rework.create(
        db,
        params.workOrderId,
        {
          rootCause: parsed.rootCause,
          correctiveAction: parsed.correctiveAction,
          responsibility: parsed.responsibility,
          leadTechnicianId: parsed.leadTechnicianId,
          isSafetyCritical: parsed.isSafetyCritical,
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.link.recordVersion };
    },
    { params: raw, body }
  );
}

export const REWORK_LIST_OPERATION = defineOperation({
  id: 'qms.rework-list',
  module: 'quality',
  method: 'GET',
  path: '/work-orders/{workOrderId}/rework',
  summary: 'List the rework cases raised against a work order.',
  permissions: ['qms.quality_control.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REWORK_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await qualityModule().rework.forOriginal(db, params.workOrderId, authorizeScope),
        },
      };
    },
    { params: raw }
  );
}
