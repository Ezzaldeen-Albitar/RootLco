/**
 * /api/v1/discount-thresholds/{companyId} — a company's discount approval
 * threshold (P1-32-PRE-OD-DISC-01).
 *
 * `GET` reads the threshold new discount requests in that company are measured
 * against, where it comes from (the company's own version, the organisation-wide
 * default, or nothing — in which case every discount needs approval), and the
 * company's recent versions.
 *
 * `POST` records the NEXT version. A threshold is never edited in place: the current
 * version is retired and the new one applies to requests made from today on. A
 * discount already asked for keeps the version it was measured against, so raising
 * the threshold does not approve it and lowering it does not undo an approval.
 *
 * ## What cannot be set here
 *
 * Whether the person who asks for a discount may approve it. They may not, ever, and
 * there is no field for it — `maker_approver_distinct` is a legacy column nothing
 * reads, and the body is `.strict()`, so a request that tries to send it is refused.
 * Nor the permission an approver needs: a new version carries the one of the version
 * it replaces.
 *
 * ## If-Match
 *
 * REQUIRED, and it carries the threshold setting's `recordVersion` from the read:
 * `1` while the company has recorded no version, and the latest version number plus
 * one afterwards. It is also the ETag of both methods. A stale value is
 * `ERR-CON-001`, so a first write proves it saw "nothing set yet" and a later one
 * proves it saw the version it replaces.
 *
 * ## Scope
 *
 * The company in the path is the authorization target on both methods, so a caller
 * holding the pricing permission in another company only is refused.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { AppFailure } from '@/server/errors/app-failure';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { THRESHOLD_KINDS, pricingModule } from '@/modules/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ companyId: schemas.uuid }).strict();

export const Body = z
  .object({
    thresholdKind: z.enum(THRESHOLD_KINDS),
    /** `numeric(18,4)`: an amount in `currency`, or a percentage (0–100) of the line. */
    thresholdValue: z
      .string()
      .regex(
        /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,4})?$/,
        'must be a non-negative decimal with at most 4 decimal places'
      ),
    /** ISO 4217 code. Required for an amount, refused for a percentage. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be a three-letter currency code')
      .optional(),
  })
  .strict();

export const DISCOUNT_THRESHOLD_READ_OPERATION = defineOperation({
  id: 'svc.discount-threshold-read',
  module: 'pricing',
  method: 'GET',
  path: '/discount-thresholds/{companyId}',
  summary: "Read a company's discount approval threshold, its source and its recent versions.",
  permissions: ['svc.price.read'],
  scope: 'company',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export const DISCOUNT_THRESHOLD_SET_OPERATION = defineOperation({
  id: 'svc.discount-threshold-set',
  successStatus: 201,
  module: 'pricing',
  method: 'POST',
  path: '/discount-thresholds/{companyId}',
  summary: "Record the next version of a company's discount approval threshold.",
  permissions: ['svc.price.manage'],
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'svc.discount_threshold.versioned',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ companyId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    DISCOUNT_THRESHOLD_READ_OPERATION,
    request,
    async ({ db }) => {
      const view = await pricingModule().thresholds.read(db, params.companyId);
      return { body: view, recordVersion: view.recordVersion };
    },
    // The company is a CLAIM checked against the caller's grants, never the scope
    // itself: `narrowScope()` rejects one the caller does not hold.
    { params, authorizationTarget: { companyId: params.companyId } }
  );
}

export async function POST(
  request: Request,
  route: { params: Promise<{ companyId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DISCOUNT_THRESHOLD_SET_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const view = await pricingModule().thresholds.set(
        db,
        {
          companyId: params.companyId,
          thresholdKind: parsed.thresholdKind,
          thresholdValue: parsed.thresholdValue,
          ...(parsed.currency === undefined ? {} : { currency: parsed.currency }),
        },
        expectedVersion
      );
      return { status: 201, body: view, recordVersion: view.recordVersion };
    },
    { params, body, authorizationTarget: { companyId: params.companyId } }
  );
}
