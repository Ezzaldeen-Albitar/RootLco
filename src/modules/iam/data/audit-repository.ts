/**
 * Audit-trail read access (P1-14, ADV-03 boundary).
 *
 * `iam.audit_records` is append-only, hash-chained, and readable only by a
 * principal holding `iam.audit.view` (`sel_audit_records_permitted`). This
 * repository reads it; nothing here writes it — `appendAudit()` in the
 * foundation is the only writer, and it goes through `iam.audit_append` so the
 * chain stays intact.
 *
 * ## Why the filter surface is an allow-list
 *
 * Audit search is the operation most tempting to make "flexible", and a flexible
 * audit search is a cross-tenant inference tool: an operator who can filter on
 * an arbitrary column can ask questions the RLS policy answers truthfully but
 * that the ADV-03 boundary never intended to expose. Every filter below is a
 * named parameter bound into a fixed statement. There is no expression language,
 * no dynamic column, and no free-text predicate.
 *
 * ## Why detail rows are read separately and only on request
 *
 * `iam.audit_record_details` holds the before/after values, already masked by
 * `iam.audit_mask` at write time for `restricted` and `secret` classifications.
 * Returning them on a list endpoint would make casual browsing a bulk export.
 * They are available on a single-record read, to a caller who additionally holds
 * `iam.sensitive.view`.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { OrderingContract, Page, PageRequest } from '@/server/db/pagination';
import { buildPage, keysetFragment } from '@/server/db/pagination';

export interface AuditRecordRow {
  readonly id: string;
  readonly seq: string;
  readonly actorId: string | null;
  readonly actorKind: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly correlationId: string | null;
  readonly requestRef: string | null;
  readonly occurredAt: string;
}

export interface AuditDetailRow {
  readonly fieldName: string;
  readonly oldValueMasked: string | null;
  readonly newValueMasked: string | null;
  readonly valueClassification: string;
}

/** Newest first, tie-broken by id so the order is total. */
export const AUDIT_ORDERING: OrderingContract = Object.freeze({
  key: 'iam.audit_records:occurred_at_desc',
  direction: 'desc',
});

/** Exactly the filters the audit view accepts. Anything else is not offered. */
export interface AuditFilters {
  readonly action?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly companyId?: string | undefined;
  readonly branchId?: string | undefined;
  /** Inclusive lower bound, ISO-8601. Required by the service. */
  readonly from: string;
  /** Exclusive upper bound, ISO-8601. Required by the service. */
  readonly to: string;
}

export class AuditRepository extends Repository {
  protected readonly module = 'iam';

  async listRecords(
    db: DbHandle,
    request: PageRequest,
    filters: AuditFilters
  ): Promise<Page<AuditRecordRow>> {
    const values: unknown[] = [db.context.principal.tenantId, filters.from, filters.to];
    let predicate = `WHERE tenant_id = $1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz`;

    const addFilter = (column: string, value: string | undefined): void => {
      if (value === undefined) return;
      values.push(value);
      // `column` is one of the literals below, never caller input.
      predicate += ` AND ${column} = $${values.length}`;
    };
    addFilter('action', filters.action);
    addFilter('entity_type', filters.entityType);
    addFilter('entity_id', filters.entityId);
    addFilter('actor_id', filters.actorId);
    addFilter('company_id', filters.companyId);
    addFilter('branch_id', filters.branchId);

    const keyset = keysetFragment(
      request,
      { sort: 'occurred_at', id: 'id' },
      AUDIT_ORDERING,
      values.length + 1
    );
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      seq: string;
      actor_id: string | null;
      actor_kind: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      company_id: string | null;
      branch_id: string | null;
      correlation_id: string | null;
      request_ref: string | null;
      occurred_at: string;
    }>(
      db,
      `SELECT id, seq::text AS seq, actor_id, actor_kind, action, entity_type, entity_id,
              company_id, branch_id, correlation_id, request_ref, occurred_at
         FROM iam.audit_records
        ${predicate} ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      values
    );

    const rows: AuditRecordRow[] = result.rows.map((row) => ({
      id: row.id,
      // `seq` is a bigint. It arrives as a string and stays one: coercing it to
      // a JavaScript number would lose precision above 2^53.
      seq: row.seq,
      actorId: row.actor_id,
      actorKind: row.actor_kind,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      companyId: row.company_id,
      branchId: row.branch_id,
      correlationId: row.correlation_id,
      requestRef: row.request_ref,
      occurredAt: row.occurred_at,
    }));

    return buildPage(rows, request, AUDIT_ORDERING, (row) => ({
      sortValue: row.occurredAt,
      id: row.id,
    }));
  }

  async findRecord(db: DbHandle, recordId: string): Promise<AuditRecordRow | null> {
    const row = await this.runOne<{
      id: string;
      seq: string;
      actor_id: string | null;
      actor_kind: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      company_id: string | null;
      branch_id: string | null;
      correlation_id: string | null;
      request_ref: string | null;
      occurred_at: string;
    }>(
      db,
      `SELECT id, seq::text AS seq, actor_id, actor_kind, action, entity_type, entity_id,
              company_id, branch_id, correlation_id, request_ref, occurred_at
         FROM iam.audit_records
        WHERE tenant_id = $1 AND id = $2`,
      [db.context.principal.tenantId, recordId]
    );
    return row
      ? {
          id: row.id,
          seq: row.seq,
          actorId: row.actor_id,
          actorKind: row.actor_kind,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          companyId: row.company_id,
          branchId: row.branch_id,
          correlationId: row.correlation_id,
          requestRef: row.request_ref,
          occurredAt: row.occurred_at,
        }
      : null;
  }

  /** Masked detail rows. Values were masked at write time, not here. */
  async listDetails(db: DbHandle, recordId: string): Promise<readonly AuditDetailRow[]> {
    const result = await this.run<{
      field_name: string;
      old_value_masked: string | null;
      new_value_masked: string | null;
      value_classification: string;
    }>(
      db,
      `SELECT field_name, old_value_masked, new_value_masked, value_classification
         FROM iam.audit_record_details
        WHERE tenant_id = $1 AND audit_record_id = $2
        ORDER BY field_name`,
      [db.context.principal.tenantId, recordId]
    );
    return result.rows.map((row) => ({
      fieldName: row.field_name,
      oldValueMasked: row.old_value_masked,
      newValueMasked: row.new_value_masked,
      valueClassification: row.value_classification,
    }));
  }
}
