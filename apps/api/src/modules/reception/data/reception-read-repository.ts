/**
 * Reception READ repository (P1-27 remediation, executed by P1-18:
 * `P1-27-INT-010`, `-011`, `-015`, `-016`, `-017`, `-021`).
 *
 * The reception domain published eight operations and every one was a POST.
 * The two version-guarded commands (`rec.reception-approve`,
 * `rec.reception-convert-to-work-order`) demand `If-Match`, and the only source
 * of a visit's `recordVersion` was the response of a write the caller had just
 * performed — so a visit was reachable in exactly one unbroken session and in
 * no other circumstance. These reads are that fix: the detail publishes the
 * version as an ETag, and every projection an operator needs to resume a visit
 * exists here.
 *
 * Rules applied throughout (the shipped read conventions):
 *
 *  - ids are returned for navigation, never as the visible label — every id is
 *    paired with a label column drawn from a real table;
 *  - `numeric`/`bigint` are rendered `::text` and STAY strings — no JS float
 *    arithmetic on money, coordinates, charge levels or sequence numbers;
 *  - timestamps leave as millisecond ISO via `.toISOString()` at this boundary,
 *    while every timestamptz CURSOR is minted by `cursorTimestamp()` at
 *    microsecond precision (`P1-27-INT-006`: a JS `Date` cursor silently skips
 *    rows that share the boundary row's millisecond);
 *  - every statement carries an explicit `tenant_id = $1` predicate in addition
 *    to RLS — defence in depth, the predicate is the intent;
 *  - the restricted narrative tables (`rec.complaint_details`,
 *    `rec.vehicle_content_details`) are NEVER selected. Both carry a SELECT
 *    policy requiring `iam.sensitive.view`; excluding them means this read needs
 *    no second permission code and no `auditClass: 'security'`. Publishing them
 *    is a recorded open question, not an oversight.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import type { ReceptionStatus } from '../domain/reception';

/** Renders a nullable timestamptz as millisecond ISO, or null. */
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Millisecond-ISO rendering INSIDE SQL, for timestamps that travel through a
 * jsonb payload. Matches `.toISOString()` exactly, so a field is formatted the
 * same whether it crossed the boundary as a column or inside a document.
 */
const ISO_MS = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ---------------------------------------------------------------------------
// Ordering contracts — one per list, non-transferable by construction.
// ---------------------------------------------------------------------------

export const RECEPTION_LIST_ORDERING: OrderingContract = {
  key: 'rec.reception_visits:custody_accepted_at_desc',
  direction: 'desc',
};
export const RECEIVING_EMPLOYEE_ORDERING: OrderingContract = {
  key: 'rec.receiving_employees:display_name_asc',
  direction: 'asc',
};
export const PARTY_ROLE_ORDERING: OrderingContract = {
  key: 'rec.reception_party_roles:valid_from_desc',
  direction: 'desc',
};
export const AUTHORIZATION_ORDERING: OrderingContract = {
  key: 'rec.reception_authorizations:occurred_at_desc',
  direction: 'desc',
};
export const CONDITION_EVIDENCE_ORDERING: OrderingContract = {
  key: 'rec.condition_evidence:recorded_at_desc',
  direction: 'desc',
};
export const RECEPTION_HISTORY_ORDERING: OrderingContract = {
  key: 'rec.reception_history:occurred_at_desc',
  direction: 'desc',
};

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** The scope facts an id-addressed read authorizes against (P1-18-A-01). */
export interface ReceptionScopeRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
}

export interface ReceptionDetailRow {
  readonly id: string;
  /** The human label. Nullable in the schema — an unprovisioned tenant allocates none. */
  readonly displayNumber: string | null;
  readonly receptionStatus: ReceptionStatus;
  /** Derived from the XOR origin (`ck_reception_visits_one_origin`). */
  readonly origin: 'appointment' | 'walk_in';
  readonly appointmentId: string | null;
  readonly walkInId: string | null;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  /** Id only; whether the detail should publish the reading is an open question. */
  readonly odometerReadingId: string | null;
  readonly fuelLevelId: string | null;
  readonly fuelLevelName: string | null;
  /** `numeric(5,2)` — a string, never a JS float. */
  readonly evSocPercent: string | null;
  readonly receivingEmployeeId: string;
  /** Immutable reception-time snapshot, not the account's current mutable name. */
  readonly receivingEmployeeDisplayName: string;
  readonly custodyAcceptedAt: string;
  /** `null` means the workshop still holds the vehicle. */
  readonly custodyReleasedAt: string | null;
  /** The ETag, and the `If-Match` value the guarded commands demand. */
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface ReceptionListEntry {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly receptionStatus: ReceptionStatus;
  readonly origin: 'appointment' | 'walk_in';
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly custodyAcceptedAt: string;
  readonly custodyReleasedAt: string | null;
  /** Per row, because the guarded writes are addressed from the list. */
  readonly recordVersion: number;
}

/** A currently selectable IAM identity for one reception branch. */
export interface ReceivingEmployeeEntry {
  readonly id: string;
  readonly displayName: string;
}

export interface PartyRoleEntry {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerDisplayName: string | null;
  readonly partnerDisplayNumber: string | null;
  readonly relationshipRole: string;
  readonly validFrom: string;
  /** `null` = still active. */
  readonly validTo: string | null;
  readonly assignmentSource: string | null;
  readonly recordVersion: number;
}

export interface AuthorizationEntry {
  /** Which table the row came from. */
  readonly kind: 'authorization' | 'refusal';
  readonly id: string;
  readonly partnerId: string;
  readonly partnerDisplayName: string | null;
  /** `null` for a refusal. */
  readonly authorizingRole: string | null;
  /** A refusal projects the literal `'declined'`. */
  readonly decision: 'approved' | 'declined';
  /** `null` for a refusal. */
  readonly channel: string | null;
  readonly authorizedScope: Record<string, unknown> | null;
  readonly evidenceDocumentId: string | null;
  readonly occurredAt: string;
  /**
   * True when this row is the partner's CURRENT decision — the latest across
   * BOTH tables. This is what makes the read tell the truth rather than
   * "has ever approved".
   */
  readonly isStanding: boolean;
}

/** One evidence row: common envelope + the per-kind payload, flattened. */
export interface ConditionEvidenceEntry {
  readonly kind: string;
  readonly id: string;
  readonly recordedAt: string;
  readonly evidenceDocumentId: string | null;
  readonly [field: string]: unknown;
}

export interface ReceptionHistoryEntry {
  readonly kind: 'status' | 'custody';
  readonly id: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly occurredAt: string;
  /** `bigint` — a string, and it survives values beyond MAX_SAFE_INTEGER. */
  readonly seq: string;
  readonly correlationId: string | null;
  readonly receivingPartnerId: string | null;
  readonly receivingPartnerDisplayName: string | null;
  readonly releasingPartnerId: string | null;
  readonly releasingPartnerDisplayName: string | null;
  readonly evidenceDocumentId: string | null;
}

export interface ReceptionListFilter {
  readonly companyId: string;
  readonly branchId: string;
  readonly status?: string | undefined;
  readonly vehicleId?: string | undefined;
}

export class ReceptionReadRepository extends Repository {
  protected readonly module = 'reception';

  /**
   * The live visit's scope facts, or null. NOT `FOR UPDATE`: a read locks
   * nothing. The service turns null into the uniform 404 and authorizes
   * against the returned company and branch (P1-18-A-01).
   */
  async requireLiveVisit(
    db: DbHandle,
    receptionVisitId: string
  ): Promise<ReceptionScopeRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string; company_id: string; branch_id: string }>(
      db,
      `SELECT id, company_id, branch_id
         FROM rec.reception_visits
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, receptionVisitId]
    );
    const row = result.rows[0];
    return row ? { id: row.id, companyId: row.company_id, branchId: row.branch_id } : null;
  }

  /** Operation A — the full detail row, or null. */
  async findReceptionDetail(
    db: DbHandle,
    receptionVisitId: string
  ): Promise<ReceptionDetailRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      display_number: string | null;
      reception_status: ReceptionStatus;
      appointment_id: string | null;
      walk_in_id: string | null;
      company_id: string;
      branch_id: string;
      vehicle_id: string;
      vehicle_display_number: string | null;
      odometer_reading_id: string | null;
      fuel_level_id: string | null;
      fuel_level_name: string | null;
      ev_soc_percent: string | null;
      receiving_employee_id: string;
      receiving_employee_display_name: string;
      custody_accepted_at: Date;
      custody_released_at: Date | null;
      record_version: number;
      created_at: Date;
      updated_at: Date | null;
    }>(
      db,
      `SELECT rv.id, rv.display_number, rv.reception_status, rv.appointment_id, rv.walk_in_id,
              rv.company_id, rv.branch_id, rv.vehicle_id,
              v.display_number AS vehicle_display_number,
              rv.odometer_reading_id, rv.fuel_level_id,
              fl.name AS fuel_level_name,
              rv.ev_soc_percent::text AS ev_soc_percent,
              rv.receiving_employee_id, rv.receiving_employee_display_name,
              rv.custody_accepted_at, rv.custody_released_at,
              rv.record_version, rv.created_at, rv.updated_at
         FROM rec.reception_visits rv
         LEFT JOIN veh.vehicles v ON v.tenant_id = rv.tenant_id AND v.id = rv.vehicle_id
         LEFT JOIN rec.fuel_levels fl ON fl.id = rv.fuel_level_id
        WHERE rv.tenant_id = $1 AND rv.id = $2 AND rv.deleted_at IS NULL`,
      [context.principal.tenantId, receptionVisitId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      displayNumber: row.display_number,
      receptionStatus: row.reception_status,
      origin: row.appointment_id !== null ? 'appointment' : 'walk_in',
      appointmentId: row.appointment_id,
      walkInId: row.walk_in_id,
      companyId: row.company_id,
      branchId: row.branch_id,
      vehicleId: row.vehicle_id,
      vehicleDisplayNumber: row.vehicle_display_number,
      odometerReadingId: row.odometer_reading_id,
      fuelLevelId: row.fuel_level_id,
      fuelLevelName: row.fuel_level_name,
      evSocPercent: row.ev_soc_percent,
      receivingEmployeeId: row.receiving_employee_id,
      receivingEmployeeDisplayName: row.receiving_employee_display_name,
      custodyAcceptedAt: row.custody_accepted_at.toISOString(),
      custodyReleasedAt: iso(row.custody_released_at),
      recordVersion: row.record_version,
      createdAt: row.created_at.toISOString(),
      updatedAt: iso(row.updated_at),
    };
  }

  /**
   * Active same-tenant IAM users with a live grant that covers the requested
   * company/branch. This is intentionally the same predicate enforced by
   * `rec.stamp_receiving_employee_identity()`: a picker must never offer an id
   * that the authoritative insert guard will reject.
   */
  async listReceivingEmployees(
    db: DbHandle,
    companyId: string,
    branchId: string,
    page: PageRequest
  ): Promise<Page<ReceivingEmployeeEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, companyId, branchId];
    const keyset = keysetFragment(
      page,
      { sort: 'account.display_name', id: 'account.id' },
      RECEIVING_EMPLOYEE_ORDERING,
      values.length + 1
    );
    const result = await this.run<{ id: string; display_name: string }>(
      db,
      `SELECT account.id, account.display_name
         FROM iam.user_accounts AS account
        WHERE account.tenant_id = $1
          AND account.status = 'active'
          AND account.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM iam.role_grants AS grant_row
             WHERE grant_row.tenant_id = account.tenant_id
               AND grant_row.user_id = account.id
               AND grant_row.status = 'active'
               AND grant_row.valid_from <= now()
               AND (grant_row.valid_to IS NULL OR grant_row.valid_to > now())
               AND (
                 grant_row.scope_mode = 'unrestricted'
                 OR EXISTS (
                   SELECT 1
                     FROM iam.grant_scopes AS grant_scope
                    WHERE grant_scope.tenant_id = grant_row.tenant_id
                      AND grant_scope.grant_id = grant_row.id
                      AND (
                        (grant_scope.scope_type = 'company' AND grant_scope.company_id = $2)
                        OR (grant_scope.scope_type = 'branch'
                          AND grant_scope.company_id = $2 AND grant_scope.branch_id = $3)
                        OR (grant_scope.scope_type = 'department'
                          AND grant_scope.company_id = $2 AND grant_scope.branch_id = $3)
                      )
                 )
               )
          )
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: { id: row.id, displayName: row.display_name },
        sortValue: row.display_name,
        id: row.id,
      })),
      page,
      RECEIVING_EMPLOYEE_ORDERING
    );
  }

  /**
   * Operation B — one branch's visits, most recently received first.
   *
   * Company and branch are REQUIRED filter columns rather than conveniences:
   * RLS narrows to `app.branch_ids`, the permission-blind union of every active
   * grant, so the route passes the same pair as the `authorizationTarget` and
   * the permission is evaluated against the branch actually being read.
   *
   * Filters are bound as `($n::type IS NULL OR col = $n)` so no predicate is
   * assembled from input and the keyset parameter index is fixed.
   */
  async listReceptions(
    db: DbHandle,
    filter: ReceptionListFilter,
    page: PageRequest
  ): Promise<Page<ReceptionListEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
      filter.vehicleId ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 'rv.custody_accepted_at', id: 'rv.id' },
      RECEPTION_LIST_ORDERING,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      display_number: string | null;
      reception_status: ReceptionStatus;
      appointment_id: string | null;
      vehicle_id: string;
      vehicle_display_number: string | null;
      custody_accepted_at: Date;
      custody_released_at: Date | null;
      record_version: number;
      custody_accepted_at_cursor: string;
    }>(
      db,
      `SELECT rv.id, rv.display_number, rv.reception_status, rv.appointment_id,
              rv.vehicle_id, v.display_number AS vehicle_display_number,
              rv.custody_accepted_at, rv.custody_released_at, rv.record_version,
              ${cursorTimestamp('rv.custody_accepted_at')} AS custody_accepted_at_cursor
         FROM rec.reception_visits rv
         LEFT JOIN veh.vehicles v ON v.tenant_id = rv.tenant_id AND v.id = rv.vehicle_id
        WHERE rv.tenant_id = $1 AND rv.company_id = $2 AND rv.branch_id = $3
          AND rv.deleted_at IS NULL
          AND ($4::text IS NULL OR rv.reception_status = $4)
          AND ($5::uuid IS NULL OR rv.vehicle_id = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          displayNumber: row.display_number,
          receptionStatus: row.reception_status,
          origin: (row.appointment_id !== null ? 'appointment' : 'walk_in') as
            'appointment' | 'walk_in',
          vehicleId: row.vehicle_id,
          vehicleDisplayNumber: row.vehicle_display_number,
          custodyAcceptedAt: row.custody_accepted_at.toISOString(),
          custodyReleasedAt: iso(row.custody_released_at),
          recordVersion: row.record_version,
        },
        sortValue: row.custody_accepted_at_cursor,
        id: row.id,
      })),
      page,
      RECEPTION_LIST_ORDERING
    );
  }

  /** Operation C — the dated party roles of one visit, newest interval first. */
  async listPartyRoles(
    db: DbHandle,
    receptionVisitId: string,
    filter: { readonly status?: 'active' | 'ended' | undefined },
    page: PageRequest
  ): Promise<Page<PartyRoleEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, receptionVisitId, filter.status ?? null];
    const keyset = keysetFragment(
      page,
      { sort: 'pr.valid_from', id: 'pr.id' },
      PARTY_ROLE_ORDERING,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      partner_id: string;
      partner_display_name: string | null;
      partner_display_number: string | null;
      relationship_role: string;
      valid_from: Date;
      valid_to: Date | null;
      assignment_source: string | null;
      record_version: number;
      valid_from_cursor: string;
    }>(
      db,
      `SELECT pr.id, pr.partner_id,
              bp.display_name AS partner_display_name,
              bp.display_number AS partner_display_number,
              pr.relationship_role, pr.valid_from, pr.valid_to, pr.assignment_source,
              pr.record_version,
              ${cursorTimestamp('pr.valid_from')} AS valid_from_cursor
         FROM rec.reception_party_roles pr
         LEFT JOIN crm.business_partners bp
           ON bp.tenant_id = pr.tenant_id AND bp.id = pr.partner_id
        WHERE pr.tenant_id = $1 AND pr.reception_visit_id = $2 AND pr.deleted_at IS NULL
          AND ($3::text IS NULL
               OR ($3 = 'active' AND pr.valid_to IS NULL)
               OR ($3 = 'ended' AND pr.valid_to IS NOT NULL))
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          partnerId: row.partner_id,
          partnerDisplayName: row.partner_display_name,
          partnerDisplayNumber: row.partner_display_number,
          relationshipRole: row.relationship_role,
          validFrom: row.valid_from.toISOString(),
          validTo: iso(row.valid_to),
          assignmentSource: row.assignment_source,
          recordVersion: row.record_version,
        },
        sortValue: row.valid_from_cursor,
        id: row.id,
      })),
      page,
      PARTY_ROLE_ORDERING
    );
  }

  /**
   * Operation D — the authorization decisions AND authorization refusals of one
   * visit, newest first.
   *
   * The two-table UNION is mandatory, mirroring `standingAuthorizations`:
   * `rec.refusals` with `refusal_type = 'authorization'` is a second, cheaper
   * way for a party to say no, and reading only `rec.authorizations` reports a
   * withdrawn approval as consent — the defect that method exists to prevent.
   *
   * `is_standing` is computed over the WHOLE union in an inner subquery, before
   * the keyset predicate applies: computing it over one page would report a
   * superseded decision as standing whenever the newer row is on an earlier page.
   */
  async listAuthorizations(
    db: DbHandle,
    receptionVisitId: string,
    page: PageRequest
  ): Promise<Page<AuthorizationEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, receptionVisitId];
    const keyset = keysetFragment(
      page,
      { sort: 's.occurred_at', id: 's.id' },
      AUTHORIZATION_ORDERING,
      values.length + 1
    );
    const result = await this.run<{
      kind: 'authorization' | 'refusal';
      id: string;
      partner_id: string;
      partner_display_name: string | null;
      authorizing_role: string | null;
      decision: 'approved' | 'declined';
      channel: string | null;
      authorized_scope: Record<string, unknown> | null;
      evidence_document_id: string | null;
      occurred_at: Date;
      is_standing: boolean;
      occurred_at_cursor: string;
    }>(
      db,
      `SELECT s.kind, s.id, s.partner_id,
              bp.display_name AS partner_display_name,
              s.authorizing_role, s.decision, s.channel, s.authorized_scope,
              s.evidence_document_id, s.occurred_at, s.is_standing,
              ${cursorTimestamp('s.occurred_at')} AS occurred_at_cursor
         FROM (
           SELECT u.*,
                  row_number() OVER (
                    PARTITION BY u.partner_id
                    ORDER BY u.occurred_at DESC, u.created_at DESC, u.id DESC
                  ) = 1 AS is_standing
             FROM (
               SELECT 'authorization'::text AS kind, a.id, a.partner_id,
                      a.authorizing_role, a.decision, a.channel, a.authorized_scope,
                      a.evidence_document_id, a.occurred_at, a.created_at
                 FROM rec.authorizations a
                WHERE a.tenant_id = $1 AND a.reception_visit_id = $2
               UNION ALL
               SELECT 'refusal'::text AS kind, r.id, r.refusing_partner_id AS partner_id,
                      NULL::text AS authorizing_role, 'declined'::text AS decision,
                      NULL::text AS channel, NULL::jsonb AS authorized_scope,
                      r.evidence_document_id, r.occurred_at, r.created_at
                 FROM rec.refusals r
                WHERE r.tenant_id = $1 AND r.reception_visit_id = $2
                  AND r.refusal_type = 'authorization'
                  AND r.refusing_partner_id IS NOT NULL
             ) u
         ) s
         LEFT JOIN crm.business_partners bp ON bp.tenant_id = $1 AND bp.id = s.partner_id
        WHERE true ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          kind: row.kind,
          id: row.id,
          partnerId: row.partner_id,
          partnerDisplayName: row.partner_display_name,
          authorizingRole: row.authorizing_role,
          decision: row.decision,
          channel: row.channel,
          authorizedScope: row.authorized_scope,
          evidenceDocumentId: row.evidence_document_id,
          occurredAt: row.occurred_at.toISOString(),
          isStanding: row.is_standing,
        },
        sortValue: row.occurred_at_cursor,
        id: row.id,
      })),
      page,
      AUTHORIZATION_ORDERING
    );
  }

  /**
   * Operation E — one keyset page over a UNION of the eight NON-RESTRICTED
   * evidence relations, mirroring the write's discriminated union.
   *
   * The per-kind payload travels as a jsonb document built in SQL with the
   * published camelCase keys and `::text`-rendered numerics, then is flattened
   * into the item. One paginated union rather than eight per-kind reads,
   * because eight calls per screen in one `expensive-read` bucket is the exact
   * fan-out the customer-detail rationale exists to avoid.
   *
   * `rec.complaint_details` and `rec.vehicle_content_details` are EXCLUDED —
   * see the module header. The complaint row's category/severity travel; the
   * customer's own words do not.
   */
  async listConditionEvidence(
    db: DbHandle,
    receptionVisitId: string,
    filter: { readonly kind?: string | undefined },
    page: PageRequest
  ): Promise<Page<ConditionEvidenceEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, receptionVisitId, filter.kind ?? null];
    const keyset = keysetFragment(
      page,
      { sort: 'e.recorded_at', id: 'e.id' },
      CONDITION_EVIDENCE_ORDERING,
      values.length + 1
    );
    const result = await this.run<{
      kind: string;
      id: string;
      recorded_at: Date;
      evidence_document_id: string | null;
      payload: Record<string, unknown>;
      recorded_at_cursor: string;
    }>(
      db,
      `SELECT e.kind, e.id, e.recorded_at, e.evidence_document_id, e.payload,
              ${cursorTimestamp('e.recorded_at')} AS recorded_at_cursor
         FROM (
           SELECT 'complaint'::text AS kind, c.id, c.created_at AS recorded_at,
                  c.evidence_document_id,
                  jsonb_build_object(
                    'category', c.category,
                    'severity', c.severity,
                    'reportedByPartnerId', c.reported_by_partner_id,
                    'reportedByPartnerDisplayName', bp.display_name
                  ) AS payload
             FROM rec.complaints c
             LEFT JOIN crm.business_partners bp
               ON bp.tenant_id = c.tenant_id AND bp.id = c.reported_by_partner_id
            WHERE c.tenant_id = $1 AND c.reception_visit_id = $2 AND c.deleted_at IS NULL
           UNION ALL
           SELECT 'inspection'::text, vi.id, vi.created_at, NULL::uuid,
                  jsonb_build_object(
                    'inspectorId', vi.inspector_id,
                    'inspectionStatus', vi.inspection_status,
                    'startedAt', ${ISO_MS('vi.started_at')},
                    'completedAt', ${ISO_MS('vi.completed_at')}
                  )
             FROM rec.visual_inspections vi
            WHERE vi.tenant_id = $1 AND vi.reception_visit_id = $2 AND vi.deleted_at IS NULL
           UNION ALL
           SELECT 'condition_item'::text, ci.id, ci.created_at, ci.evidence_document_id,
                  jsonb_build_object(
                    'inspectionId', ci.inspection_id,
                    'findingCategory', ci.finding_category,
                    'vehicleZone', ci.vehicle_zone,
                    'severity', ci.severity,
                    'findingNote', ci.finding_note,
                    'correctionOf', ci.correction_of
                  )
             FROM rec.condition_items ci
             JOIN rec.visual_inspections vi2
               ON vi2.tenant_id = ci.tenant_id AND vi2.company_id = ci.company_id
              AND vi2.branch_id = ci.branch_id AND vi2.id = ci.inspection_id
            WHERE ci.tenant_id = $1 AND vi2.reception_visit_id = $2 AND ci.deleted_at IS NULL
           UNION ALL
           SELECT 'damage_map'::text, dm.id, dm.created_at, NULL::uuid,
                  jsonb_build_object(
                    'documentId', dm.document_id,
                    'documentVersionId', dm.document_version_id,
                    'mapType', dm.map_type,
                    'perspective', dm.perspective
                  )
             FROM rec.damage_maps dm
            WHERE dm.tenant_id = $1 AND dm.reception_visit_id = $2 AND dm.deleted_at IS NULL
           UNION ALL
           SELECT 'damage_mark'::text, dk.id, dk.created_at, dk.evidence_document_id,
                  jsonb_build_object(
                    'damageMapId', dk.damage_map_id,
                    'markType', dk.mark_type,
                    'vehicleZone', dk.vehicle_zone,
                    'coordX', dk.coord_x::text,
                    'coordY', dk.coord_y::text,
                    'note', dk.note
                  )
             FROM rec.damage_marks dk
             JOIN rec.damage_maps dm2
               ON dm2.tenant_id = dk.tenant_id AND dm2.company_id = dk.company_id
              AND dm2.branch_id = dk.branch_id AND dm2.id = dk.damage_map_id
            WHERE dk.tenant_id = $1 AND dm2.reception_visit_id = $2 AND dk.deleted_at IS NULL
           UNION ALL
           SELECT 'contents'::text, vc.id, vc.created_at, vc.evidence_document_id,
                  jsonb_build_object(
                    'quantity', vc.quantity,
                    'location', vc.location
                  )
             FROM rec.vehicle_contents vc
            WHERE vc.tenant_id = $1 AND vc.reception_visit_id = $2 AND vc.deleted_at IS NULL
           UNION ALL
           SELECT 'warning_light'::text, wl.id, wl.created_at, wl.evidence_document_id,
                  jsonb_build_object(
                    'warningLightCodeId', wl.warning_light_code_id,
                    'warningLightCode', wc.code,
                    'warningLightName', wc.name,
                    'observedState', wl.observed_state,
                    'note', wl.note
                  )
             FROM rec.warning_light_observations wl
             LEFT JOIN rec.warning_light_codes wc ON wc.id = wl.warning_light_code_id
            WHERE wl.tenant_id = $1 AND wl.reception_visit_id = $2 AND wl.deleted_at IS NULL
           UNION ALL
           SELECT 'leak'::text, lo.id, lo.created_at, lo.evidence_document_id,
                  jsonb_build_object(
                    'leakType', lo.leak_type,
                    'vehicleZone', lo.vehicle_zone,
                    'severity', lo.severity,
                    'note', lo.note
                  )
             FROM rec.leak_observations lo
            WHERE lo.tenant_id = $1 AND lo.reception_visit_id = $2 AND lo.deleted_at IS NULL
         ) e
        WHERE ($3::text IS NULL OR e.kind = $3) ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          kind: row.kind,
          id: row.id,
          recordedAt: row.recorded_at.toISOString(),
          evidenceDocumentId: row.evidence_document_id,
          ...row.payload,
        } as ConditionEvidenceEntry,
        sortValue: row.recorded_at_cursor,
        id: row.id,
      })),
      page,
      CONDITION_EVIDENCE_ORDERING
    );
  }

  /**
   * Operation F — the status and custody ledgers of one visit, newest first.
   *
   * The first read path `rec.custody_history` has ever had. The tie-break is
   * `id` (uuid), NOT `seq`: `decodeCursor` rejects a non-uuid tie-breaker
   * platform-wide (P1-15-SR-013), and `(occurred_at, id)` is still a total
   * order, which is what keeps the page stable. `seq` still travels — as a
   * string, because it is a bigint.
   */
  async listHistory(
    db: DbHandle,
    receptionVisitId: string,
    page: PageRequest
  ): Promise<Page<ReceptionHistoryEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, receptionVisitId];
    const keyset = keysetFragment(
      page,
      { sort: 'h.occurred_at', id: 'h.id' },
      RECEPTION_HISTORY_ORDERING,
      values.length + 1
    );
    const result = await this.run<{
      kind: 'status' | 'custody';
      id: string;
      from_state: string | null;
      to_state: string;
      reason: string | null;
      actor_id: string;
      occurred_at: Date;
      seq: string;
      correlation_id: string | null;
      receiving_partner_id: string | null;
      receiving_partner_display_name: string | null;
      releasing_partner_id: string | null;
      releasing_partner_display_name: string | null;
      evidence_document_id: string | null;
      occurred_at_cursor: string;
    }>(
      db,
      `SELECT h.kind, h.id, h.from_state, h.to_state, h.reason, h.actor_id,
              h.occurred_at, h.seq, h.correlation_id,
              h.receiving_partner_id, rbp.display_name AS receiving_partner_display_name,
              h.releasing_partner_id, lbp.display_name AS releasing_partner_display_name,
              h.evidence_document_id,
              ${cursorTimestamp('h.occurred_at')} AS occurred_at_cursor
         FROM (
           SELECT 'status'::text AS kind, sh.id, sh.from_state, sh.to_state, sh.reason,
                  sh.actor_id, sh.occurred_at, sh.seq::text AS seq, sh.correlation_id,
                  NULL::uuid AS receiving_partner_id, NULL::uuid AS releasing_partner_id,
                  NULL::uuid AS evidence_document_id
             FROM rec.reception_status_history sh
            WHERE sh.tenant_id = $1 AND sh.reception_visit_id = $2
           UNION ALL
           SELECT 'custody'::text, ch.id, ch.from_state, ch.to_state, ch.reason,
                  ch.actor_id, ch.occurred_at, ch.seq::text, ch.correlation_id,
                  ch.receiving_partner_id, ch.releasing_partner_id, ch.evidence_document_id
             FROM rec.custody_history ch
            WHERE ch.tenant_id = $1 AND ch.reception_visit_id = $2
         ) h
         LEFT JOIN crm.business_partners rbp
           ON rbp.tenant_id = $1 AND rbp.id = h.receiving_partner_id
         LEFT JOIN crm.business_partners lbp
           ON lbp.tenant_id = $1 AND lbp.id = h.releasing_partner_id
        WHERE true ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          kind: row.kind,
          id: row.id,
          fromState: row.from_state,
          toState: row.to_state,
          reason: row.reason,
          actorId: row.actor_id,
          occurredAt: row.occurred_at.toISOString(),
          seq: row.seq,
          correlationId: row.correlation_id,
          receivingPartnerId: row.receiving_partner_id,
          receivingPartnerDisplayName: row.receiving_partner_display_name,
          releasingPartnerId: row.releasing_partner_id,
          releasingPartnerDisplayName: row.releasing_partner_display_name,
          evidenceDocumentId: row.evidence_document_id,
        },
        sortValue: row.occurred_at_cursor,
        id: row.id,
      })),
      page,
      RECEPTION_HISTORY_ORDERING
    );
  }
}
