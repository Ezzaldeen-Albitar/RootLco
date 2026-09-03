/**
 * POST /api/v1/receptions/{receptionId}/condition-evidence (Phase 1-18,
 * P1-18-BE-011…P1-18-BE-015).
 *
 * One endpoint, eight kinds of pre-service condition evidence, expressed as a
 * discriminated union: canonical Field 23 allocates a single route for the whole
 * category, and the shape a caller must send is decided by `kind` rather than by
 * which of thirty optional fields they happened to fill in.
 *
 * Signature and refusal are deliberately NOT members. They record what a party
 * personally acknowledged or declined, they carry their own permission, and folding
 * them in here would make them reachable by a caller who holds only evidence-capture
 * authority.
 *
 * Every vocabulary below comes from the module's own constants so it cannot drift
 * from the frozen CHECK it mirrors. Three coded values — `map_type`,
 * `observed_state`, `leak_type` — have a CHECK but no published constant, so they
 * stay bounded strings here and the database decides membership; typing their
 * members out by hand would be a second copy that can rot without anything failing.
 *
 * A body is accepted for a *live* visit only, and the parents a finding or a mark
 * hangs off must belong to this visit. Both are the module's calls, not this route's.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SEVERITIES,
  DAMAGE_MARK_TYPES,
  EVIDENCE_KINDS,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  LEAK_SEVERITIES,
  MAX_COMPLAINT_TEXT,
  MAX_CONTENT_QUANTITY,
  MAX_COORD,
  MAX_DECLARED_VALUE,
  MAX_ITEM_DESCRIPTION,
  MAX_LOCATION,
  MAX_MAP_TYPE,
  MAX_NOTE,
  MAX_ZONE,
  MIN_COORD,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ receptionId: schemas.uuid });

/** What the customer reported, in their own words. Stored `restricted`. */
const Complaint = z
  .object({
    kind: z.literal('complaint'),
    category: z.enum(COMPLAINT_CATEGORIES),
    severity: z.enum(COMPLAINT_SEVERITIES).optional(),
    complaintText: z.string().min(1).max(MAX_COMPLAINT_TEXT),
    reportedByPartnerId: schemas.uuid.nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
  })
  .strict();

/** Opens an inspection header. Findings hang off it and it starts `in_progress`. */
const Inspection = z.object({ kind: z.literal('inspection'), inspectorId: schemas.uuid }).strict();

/** What staff observed. A separate table from a complaint, and never promoted into one. */
const ConditionItem = z
  .object({
    kind: z.literal('condition_item'),
    inspectionId: schemas.uuid,
    findingCategory: z.enum(FINDING_CATEGORIES),
    vehicleZone: z.string().min(1).max(MAX_ZONE),
    severity: z.enum(FINDING_SEVERITIES).optional(),
    findingNote: z.string().min(1).max(MAX_NOTE).nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
  })
  .strict();

/**
 * Binds the visit to a map template and the exact version it was drawn on, so a
 * later revision becomes a new map and the marks already placed never move.
 */
const DamageMap = z
  .object({
    kind: z.literal('damage_map'),
    documentId: schemas.uuid,
    documentVersionId: schemas.uuid,
    mapType: z.string().min(1).max(MAX_MAP_TYPE),
    perspective: z.string().min(1).max(MAX_MAP_TYPE).nullable().optional(),
    /*
     * The MANAGED template revision (Owner decision FE-012), REQUIRED.
     *
     * It was optional, with the reasoning that the shipped contract should not
     * be withdrawn and that "when present the database requires it" to be a live
     * revision of an active slot. The second half was true and the first half
     * made it irrelevant: `rec.guard_damage_map_template_binding()` opened with
     * `IF NEW.damage_map_template_version_id IS NULL THEN RETURN NEW`, so a
     * caller that simply omitted the field was admitted with the whole FE-012
     * rule unevaluated — and the shipped web client omitted it.
     *
     * Measured on the running API before DBCR-P1-28-001: a NEW visit binding a
     * RETIRED template's document/version pair answered 201 without this field
     * and 422 with it. An optional field guarding a mandatory invariant is not a
     * smaller contract, it is an unenforced one.
     *
     * Required HERE as well as in the database so the refusal is a named 422 on
     * the field rather than a trigger exception surfacing as a 500, and
     * `nullable()` is gone for the same reason: an explicit null was the same
     * omission wearing different clothes.
     */
    damageMapTemplateVersionId: schemas.uuid,
  })
  .strict();

/** Coordinates are fractions of the map, so a mark survives any rendering size. */
const DamageMark = z
  .object({
    kind: z.literal('damage_mark'),
    damageMapId: schemas.uuid,
    markType: z.enum(DAMAGE_MARK_TYPES),
    vehicleZone: z.string().min(1).max(MAX_ZONE),
    coordX: z.number().min(MIN_COORD).max(MAX_COORD),
    coordY: z.number().min(MIN_COORD).max(MAX_COORD),
    note: z.string().min(1).max(MAX_NOTE).nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
  })
  .strict();

/** What the customer left in the vehicle. The description is stored `restricted`. */
const Contents = z
  .object({
    kind: z.literal('contents'),
    itemDescription: z.string().min(1).max(MAX_ITEM_DESCRIPTION),
    // Both ceilings come from the module, which takes them from the columns:
    // `quantity` is `integer` and `declared_value` is `numeric(14, 2)`, and a
    // value past either is `22003` from PostgreSQL — a 500 — rather than a named
    // field. Bounded here as well as in the module for the same reason `coordX`
    // is: the schema is what tells a caller the shape before they send it.
    quantity: z.number().int().positive().max(MAX_CONTENT_QUANTITY).optional(),
    location: z.string().min(1).max(MAX_LOCATION).nullable().optional(),
    // Non-negative, and only meaningful with a currency —
    // `ck_vehicle_content_details_currency` refuses a currency without a value.
    declaredValue: z.number().nonnegative().max(MAX_DECLARED_VALUE).nullable().optional(),
    declaredCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    declaredByPartnerId: schemas.uuid.nullable().optional(),
    witnessedByEmployeeId: schemas.uuid.nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
  })
  .strict();

/** One dashboard lamp. The same code is observed once per visit, not stacked. */
const WarningLight = z
  .object({
    kind: z.literal('warning_light'),
    warningLightCodeId: schemas.uuid,
    observedState: z.string().min(1).max(MAX_MAP_TYPE).optional(),
    note: z.string().min(1).max(MAX_NOTE).nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
  })
  .strict();

/** One visible leak, recorded as observed. No cause and no fault is asserted. */
const Leak = z
  .object({
    kind: z.literal('leak'),
    leakType: z.string().min(1).max(MAX_MAP_TYPE),
    vehicleZone: z.string().min(1).max(MAX_ZONE),
    severity: z.enum(LEAK_SEVERITIES).optional(),
    note: z.string().min(1).max(MAX_NOTE).nullable().optional(),
    evidenceDocumentId: schemas.uuid.nullable().optional(),
  })
  .strict();

export const Body = z.discriminatedUnion('kind', [
  Complaint,
  Inspection,
  ConditionItem,
  DamageMap,
  DamageMark,
  Contents,
  WarningLight,
  Leak,
]);

export const RECEPTION_CONDITION_EVIDENCE_OPERATION = defineOperation({
  id: 'rec.reception-condition-evidence',
  successStatus: 201,
  module: 'reception',
  method: 'POST',
  path: '/receptions/{receptionId}/condition-evidence',
  summary: 'Append one piece of pre-service condition evidence to a reception visit.',
  permissions: ['rec.reception.evidence.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.evidence_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_CONDITION_EVIDENCE_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionEvidence.recordConditionEvidence(
        db,
        params.receptionId,
        await parseJsonBody(raw, Body),
        // Re-authorized against the LOCKED visit's branch, not this request:
        // `scope: 'branch'` is inert without a target (P1-18-A-01).
        authorizeScope
      ),
    }),
    { params, body }
  );
}

// ---------------------------------------------------------------------------
// GET — the pre-service condition evidence of one visit (P1-27 remediation
// executed by P1-18, `P1-27-INT-017`). One keyset page over the eight
// NON-RESTRICTED evidence relations, mirroring the POST's discriminated union,
// with an optional `kind` filter over the same eight literals. The restricted
// narrative tables (`rec.complaint_details`, `rec.vehicle_content_details`) are
// never selected — they stay behind `iam.sensitive.view` at the row, and this
// read needs no second permission code because it never touches them.
// ---------------------------------------------------------------------------

const ListQuery = z
  .object({
    kind: z.enum(EVIDENCE_KINDS).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const RECEPTION_CONDITION_EVIDENCE_LIST_OPERATION = defineOperation({
  id: 'rec.reception-condition-evidence-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/condition-evidence',
  summary: 'List the pre-service condition evidence recorded on a reception visit.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    RECEPTION_CONDITION_EVIDENCE_LIST_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const path = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        ListQuery,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await receptionModule().receptionRead.listConditionEvidence(
          db,
          path.receptionId,
          query,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
