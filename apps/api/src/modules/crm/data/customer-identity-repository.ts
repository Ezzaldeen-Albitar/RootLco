/**
 * CRM duplicate, merge, history, timeline, and vehicle-link repository
 * (Phase 1-16, P1-16-BE-013…018).
 *
 * `crm.partner_merges` is INSERT-only for `app_runtime`: a merge, once recorded,
 * is permanent evidence. The merged partner row is retained too — it is
 * redirected, never deleted — so a work order raised against the duplicate three
 * years ago still resolves to a real customer.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import type { OrderingContract } from '@/server/db/pagination';
import type { VehicleRelationshipRole } from '../domain/customer-identity';

/** Timeline ordering: newest first, id as the deterministic tie-break. */
export const TIMELINE_ORDERING: OrderingContract = {
  key: 'crm.timeline_events:occurred_at_desc',
  direction: 'desc',
};

/**
 * Duplicate-candidate queue ordering: most recently detected first.
 *
 * Not by score. A reviewer works a queue, and a queue that reorders itself as
 * scores land would move a row out from under them mid-decision; `detected_at`
 * is stable once written because the immutability trigger freezes the row's
 * detection facts. The score is on every row for the screen to rank within a
 * page.
 */
export const DUPLICATE_CANDIDATE_ORDERING: OrderingContract = {
  key: 'crm.duplicate_candidates:detected_at_desc',
  direction: 'desc',
};

/**
 * One candidate pair, with both customers' display names resolved.
 *
 * `matchBasis` is published, and that is safe by schema rather than by review:
 * `ck_duplicate_candidates_basis` calls `crm.jsonb_no_raw_value_keys`, which
 * rejects a `value`/`raw`/`national_id`/`tax`/`registration`/`date_of_birth` key
 * at any depth. So the basis can only ever carry which signals fired and how
 * heavily — which is precisely the field-level comparison evidence a reviewer
 * needs, and never the personal data that produced it.
 */
export interface DuplicateCandidateEntry {
  readonly id: string;
  readonly partnerIdA: string;
  readonly displayNameA: string | null;
  readonly partnerIdB: string;
  readonly displayNameB: string | null;
  /** `numeric` on the wire as a string. Never narrowed to a float. */
  readonly matchScore: string;
  readonly matchBasis: unknown;
  readonly status: string;
  readonly detectedAt: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
}

export interface DuplicateCandidateRow {
  readonly id: string;
  readonly partnerIdA: string;
  readonly partnerIdB: string;
  readonly matchScore: string;
  readonly status: string;
}

export interface ScoreInput {
  readonly displayName: string;
  readonly contactValues: readonly string[];
  readonly addressLines: readonly string[];
}

export interface TimelineEntry {
  readonly id: string;
  readonly eventType: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly actorId: string | null;
}

export interface HistoryEntry {
  readonly kind: 'status' | 'consent' | 'block' | 'merge';
  readonly id: string;
  readonly occurredAt: string;
  readonly summary: string;
}

export class CustomerIdentityRepository extends Repository {
  protected readonly module = 'crm';

  /** Live customer in the caller's tenant, with the fields the scorer needs. */
  async loadScoringProfile(db: DbHandle, customerId: string): Promise<ScoreInput | null> {
    const context = this.assertContext(db);
    const partner = await this.run<{ display_name: string }>(
      db,
      `SELECT display_name FROM crm.business_partners
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [context.principal.tenantId, customerId]
    );
    const row = partner.rows[0];
    if (!row) return null;

    const contacts = await this.run<{ normalized_value: string }>(
      db,
      `SELECT normalized_value FROM crm.contact_points
        WHERE tenant_id = $1 AND partner_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, customerId]
    );
    const addresses = await this.run<{ line1: string }>(
      db,
      `SELECT line1 FROM crm.addresses
        WHERE tenant_id = $1 AND partner_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, customerId]
    );
    return {
      displayName: row.display_name,
      contactValues: contacts.rows.map((c) => c.normalized_value),
      addressLines: addresses.rows.map((a) => a.line1.trim().toLowerCase()),
    };
  }

  /**
   * Other live customers that share at least one signal with `customerId`.
   *
   * Bounded and index-eligible: it will not walk the tenant. A comparison that
   * fires on nothing is not a candidate, so restricting the set to rows sharing
   * *something* loses no true positive the scorer would have kept.
   */
  async findComparablePartners(
    db: DbHandle,
    customerId: string,
    profile: ScoreInput,
    limit = 50
  ): Promise<readonly { id: string; profile: ScoreInput }[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT DISTINCT bp.id
         FROM crm.business_partners bp
         LEFT JOIN crm.contact_points cp
           ON cp.tenant_id = bp.tenant_id AND cp.partner_id = bp.id AND cp.deleted_at IS NULL
        WHERE bp.tenant_id = $1
          AND bp.id <> $2
          AND bp.deleted_at IS NULL
          AND bp.merged_into_id IS NULL
          AND (
            crm.normalize_name(bp.display_name) = crm.normalize_name($3)
            OR cp.normalized_value = ANY($4::text[])
          )
        LIMIT $5`,
      [
        context.principal.tenantId,
        customerId,
        profile.displayName,
        profile.contactValues.length > 0 ? profile.contactValues : [''],
        limit,
      ]
    );

    const profiles: { id: string; profile: ScoreInput }[] = [];
    for (const row of result.rows) {
      const other = await this.loadScoringProfile(db, row.id);
      if (other) profiles.push({ id: row.id, profile: other });
    }
    return profiles;
  }

  /**
   * Records one candidate pair, once.
   *
   * A candidate's `match_score` and `match_basis` are **immutable by schema**
   * (`tg_duplicate_candidates_immutable` freezes them the moment the pair is
   * first detected). So a re-scan must never rewrite them: the score is the
   * score *at detection*, and a candidate already on a reviewer's desk is not
   * silently re-scored underneath them. When the pair already has a candidate —
   * in **any** status — this returns it untouched. `score`/`basis` are used only
   * for the INSERT of a brand-new pair.
   *
   * This first looks the pair up across every status rather than relying on
   * `ON CONFLICT`: `uq_duplicate_candidates_open` is partial (`WHERE status =
   * 'open'`), so an upsert on it would see only open rows and would happily
   * insert a *second* candidate for a pair a human already dismissed — quietly
   * re-raising a decision somebody made. The lookup is what makes a dismissal
   * stick across re-scans, and what keeps a re-scan from writing the illegal
   * immutable-column UPDATE that would raise `check_violation` and 500 the whole
   * scan whenever the recomputed score differed from the frozen one.
   */
  async upsertCandidate(
    db: DbHandle,
    pair: { a: string; b: string },
    score: number,
    basis: readonly { signal: string; weight: number }[]
  ): Promise<{ id: string; created: boolean }> {
    const context = this.assertContext(db);
    const existing = await this.run<{ id: string }>(
      db,
      `SELECT id FROM crm.duplicate_candidates
        WHERE tenant_id = $1 AND partner_id_a = $2 AND partner_id_b = $3
        ORDER BY detected_at DESC LIMIT 1`,
      [context.principal.tenantId, pair.a, pair.b]
    );
    const found = existing.rows[0];
    if (found) {
      // Already recorded (open or reviewed). The frozen score stands; a re-scan
      // neither reopens a dismissal nor rewrites an immutable score column.
      return { id: found.id, created: false };
    }

    const inserted = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.duplicate_candidates
         (tenant_id, partner_id_a, partner_id_b, match_score, match_basis, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        pair.a,
        pair.b,
        score.toFixed(4),
        JSON.stringify(basis),
        context.principal.userId,
      ]
    );
    return { id: inserted.rows[0]?.id ?? '', created: true };
  }

  /**
   * The tenant's duplicate-candidate queue, newest detection first.
   *
   * There was no read for this at all (`P1-27-INT-005`). A review screen could
   * only see candidates by POSTing a scan — a privileged write that emits an
   * audit record — so opening the queue would have written to the audit trail
   * every time, and re-scanning is not a read.
   *
   * Both partners are LEFT JOINed for their display names because a queue of
   * uuid pairs is not reviewable. The join is soft: a customer soft-deleted or
   * merged after the pair was detected yields a null name beside a live id,
   * which is the honest state — the candidate really does still reference it,
   * and hiding the row would hide a decision somebody still owes.
   */
  async listCandidates(
    db: DbHandle,
    page: PageRequest,
    status: string | null
  ): Promise<Page<DuplicateCandidateEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, status];
    const keyset = keysetFragment(
      page,
      { sort: 'c.detected_at', id: 'c.id' },
      DUPLICATE_CANDIDATE_ORDERING,
      3
    );
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      partner_id_a: string;
      display_name_a: string | null;
      partner_id_b: string;
      display_name_b: string | null;
      match_score: string;
      match_basis: unknown;
      status: string;
      detected_at: Date;
      detected_at_cursor: string;
      reviewed_by: string | null;
      reviewed_at: Date | null;
    }>(
      db,
      // `$2 IS NULL OR status = $2` rather than an assembled predicate: the
      // filter is one bound parameter either way, so no branch of this statement
      // is built from caller input. `ix_duplicate_candidates_status` is
      // (tenant_id, status), so the filtered form is index-eligible; the
      // ordering is a sort over that narrowed set, which is a performance
      // characteristic and not a correctness one.
      `SELECT c.id, c.partner_id_a, a.display_name AS display_name_a,
              c.partner_id_b, b.display_name AS display_name_b,
              c.match_score, c.match_basis, c.status, c.detected_at,
              ${cursorTimestamp('c.detected_at')} AS detected_at_cursor,
              c.reviewed_by, c.reviewed_at
         FROM crm.duplicate_candidates c
         LEFT JOIN crm.business_partners a
                ON a.tenant_id = c.tenant_id AND a.id = c.partner_id_a
         LEFT JOIN crm.business_partners b
                ON b.tenant_id = c.tenant_id AND b.id = c.partner_id_b
        WHERE c.tenant_id = $1
          AND ($2::text IS NULL OR c.status = $2) ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    // The cursor key is the MICROSECOND rendering, not the published millisecond
    // one (`P1-27-INT-006`). A duplicate scan stamps its whole batch with one
    // `transaction_timestamp()`, so a millisecond cursor here does not merely
    // risk losing the tail of a page — it loses it every time.
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        partnerIdA: row.partner_id_a,
        displayNameA: row.display_name_a,
        partnerIdB: row.partner_id_b,
        displayNameB: row.display_name_b,
        // `numeric` arrives as a string and stays one. A match score is a decimal
        // the database froze at detection; parsing it to a float here would let a
        // rounding artefact change which of two candidates a reviewer sees first.
        matchScore: row.match_score,
        matchBasis: row.match_basis,
        status: row.status,
        detectedAt: row.detected_at.toISOString(),
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at === null ? null : row.reviewed_at.toISOString(),
      },
      sortValue: row.detected_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, DUPLICATE_CANDIDATE_ORDERING);
  }

  async findCandidate(db: DbHandle, candidateId: string): Promise<DuplicateCandidateRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      partner_id_a: string;
      partner_id_b: string;
      match_score: string;
      status: string;
    }>(
      db,
      `SELECT id, partner_id_a, partner_id_b, match_score, status
         FROM crm.duplicate_candidates WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, candidateId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          partnerIdA: row.partner_id_a,
          partnerIdB: row.partner_id_b,
          matchScore: row.match_score,
          status: row.status,
        }
      : null;
  }

  /** Records the review decision. Only moves a candidate out of `open`. */
  async reviewCandidate(db: DbHandle, candidateId: string, status: string): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE crm.duplicate_candidates
          SET status = $3, reviewed_by = $4, reviewed_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'open'`,
      [context.principal.tenantId, candidateId, status, context.principal.userId]
    );
    return result.rowCount ?? 0;
  }

  /** Appends the permanent merge record. `merged_by`/`merged_at` are server-stamped. */
  async insertMerge(
    db: DbHandle,
    input: { sourceId: string; survivorId: string; approvalRef: string; summary: unknown }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.partner_merges
         (tenant_id, source_partner_id, survivor_partner_id, merge_summary, approval_ref,
          merged_by, correlation_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.sourceId,
        input.survivorId,
        JSON.stringify(input.summary),
        input.approvalRef,
        context.principal.userId,
        context.correlationId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Redirects the source at the survivor under optimistic concurrency. */
  async redirectPartner(
    db: DbHandle,
    sourceId: string,
    survivorId: string,
    expectedVersion: number
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE crm.business_partners
          SET lifecycle_status = 'merged', merged_into_id = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3
          AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [context.principal.tenantId, sourceId, expectedVersion, survivorId]
    );
    return result.rowCount ?? 0;
  }

  async partnerState(
    db: DbHandle,
    customerId: string
  ): Promise<{
    lifecycleStatus: string;
    recordVersion: number;
    mergedIntoId: string | null;
  } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      lifecycle_status: string;
      record_version: number;
      merged_into_id: string | null;
    }>(
      db,
      `SELECT lifecycle_status, record_version, merged_into_id
         FROM crm.business_partners
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, customerId]
    );
    const row = result.rows[0];
    return row
      ? {
          lifecycleStatus: row.lifecycle_status,
          recordVersion: row.record_version,
          mergedIntoId: row.merged_into_id,
        }
      : null;
  }

  /** Keyset page of the customer timeline, newest first. */
  async timeline(
    db: DbHandle,
    customerId: string,
    page: PageRequest
  ): Promise<Page<TimelineEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(page, { sort: 'occurred_at', id: 'id' }, TIMELINE_ORDERING, 3);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      event_type: string;
      title: string;
      occurred_at: Date;
      occurred_at_cursor: string;
      actor_id: string | null;
    }>(
      db,
      `SELECT id, event_type, title, occurred_at,
              ${cursorTimestamp('occurred_at')} AS occurred_at_cursor,
              actor_id
         FROM crm.timeline_events
        WHERE tenant_id = $1 AND partner_id = $2 ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    // `P1-27-INT-006`. A timeline is written by triggers, so one transaction
    // routinely emits several events sharing `occurred_at` to the microsecond —
    // the file's own docblock says so. A millisecond cursor drops whichever of
    // them fall after a page boundary.
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        eventType: row.event_type,
        title: row.title,
        occurredAt: row.occurred_at.toISOString(),
        actorId: row.actor_id,
      },
      sortValue: row.occurred_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, TIMELINE_ORDERING);
  }

  /**
   * The customer's governance history, assembled from the four append-only
   * sources that record decisions about them.
   *
   * A projection, not a table: the sources are the evidence, and copying them
   * into a fifth place would create something that could disagree with them.
   * Bounded by `limit` and ordered deterministically.
   */
  async history(db: DbHandle, customerId: string, limit: number): Promise<readonly HistoryEntry[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      kind: string;
      id: string;
      occurred_at: Date;
      summary: string;
    }>(
      db,
      `SELECT * FROM (
         SELECT 'status'::text AS kind, h.id, h.occurred_at,
                (coalesce(h.from_state, 'none') || ' -> ' || h.to_state) AS summary
           FROM crm.partner_status_history h
          WHERE h.tenant_id = $1 AND h.partner_id = $2
         UNION ALL
         SELECT 'consent'::text, c.id, c.effective_at,
                (c.consent_kind || '/' || c.channel || '/' || c.purpose || ': ' || c.status)
           FROM crm.consent_history c
          WHERE c.tenant_id = $1 AND c.partner_id = $2
         UNION ALL
         SELECT 'block'::text, b.id, b.occurred_at, b.action
           FROM crm.customer_block_history b
          WHERE b.tenant_id = $1 AND b.partner_id = $2
         UNION ALL
         SELECT 'merge'::text, m.id, m.merged_at,
                ('merged into ' || m.survivor_partner_id::text)
           FROM crm.partner_merges m
          WHERE m.tenant_id = $1 AND m.source_partner_id = $2
       ) entries
       ORDER BY occurred_at DESC, id DESC
       LIMIT $3`,
      [context.principal.tenantId, customerId, limit]
    );
    return result.rows.map((row) => ({
      kind: row.kind as HistoryEntry['kind'],
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      summary: row.summary,
    }));
  }

  /** A live vehicle in the caller's tenant, or `null`. */
  async findVehicle(db: DbHandle, vehicleId: string): Promise<{ id: string } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM veh.vehicles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, vehicleId]
    );
    return result.rows[0] ?? null;
  }

  /** An open relationship of the same role between this pair, if one exists. */
  async findOpenRelationship(
    db: DbHandle,
    customerId: string,
    vehicleId: string,
    role: VehicleRelationshipRole
  ): Promise<{ id: string } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM veh.vehicle_relationships
        WHERE tenant_id = $1 AND partner_id = $2 AND vehicle_id = $3
          AND relationship_role = $4 AND valid_to IS NULL`,
      [context.principal.tenantId, customerId, vehicleId, role]
    );
    return result.rows[0] ?? null;
  }

  async insertRelationship(
    db: DbHandle,
    customerId: string,
    vehicleId: string,
    role: VehicleRelationshipRole
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO veh.vehicle_relationships
         (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, created_by)
       VALUES ($1, $2, $3, $4, current_date, $5)
       RETURNING id`,
      [context.principal.tenantId, vehicleId, customerId, role, context.principal.userId]
    );
    return result.rows[0]?.id ?? null;
  }
}
