/**
 * Audit viewing (P1-14, ADV-03 boundary).
 *
 * Reading the audit trail is itself a privileged act, so it is audited — a
 * reviewer must be able to see who read the record of who did what. That
 * produces one audit record per privileged read, which is the intended cost.
 *
 * Three bounds keep the endpoint from becoming a bulk-export tool:
 *
 *  - **a date range is mandatory and bounded.** An unbounded range plus cursor
 *    paging is a full export with extra steps;
 *  - **the page size is capped** by the foundation's `MAX_PAGE_SIZE`;
 *  - **the filter set is a fixed allow-list**, bound as parameters — there is no
 *    expression language and no dynamic column.
 *
 * Export as a feature is explicitly out of scope and no endpoint offers it.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page, type PageRequest } from '@/server/db/pagination';
import { appendAudit } from '@/server/audit/audit';
import {
  AUDIT_ORDERING,
  AuditRepository,
  type AuditDetailRow,
  type AuditFilters,
  type AuditRecordRow,
} from '../data/audit-repository';
import { AuthorizationRepository } from '../data/authorization-repository';

/** Longest range a single query may cover. */
const MAX_RANGE_DAYS = 92;

export interface AuditRecordView extends AuditRecordRow {
  readonly details?: readonly AuditDetailRow[];
}

export class AuditViewService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(
    private readonly audit: AuditRepository,
    private readonly authorization: AuthorizationRepository
  ) {
    super();
  }

  /**
   * Validates and normalises the requested window.
   *
   * Both bounds are required. Defaulting the range would make the most expensive
   * possible query the one a caller gets by supplying nothing.
   */
  private resolveRange(from: string, to: string): { from: string; to: string } {
    const start = Date.parse(from);
    const end = Date.parse(to);
    const violation = (rule: string): never => {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The audit date range is not valid',
        safeDetails: { violations: [{ path: 'query.from', rule }] },
      });
    };
    if (!Number.isFinite(start) || !Number.isFinite(end)) violation('invalid_timestamp');
    if (end <= start) violation('end_not_after_start');
    if (end - start > MAX_RANGE_DAYS * 86_400_000) violation('range_too_wide');
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
  }

  /** Raw page inputs, for the same boundary reason as the other list services. */
  async list(
    db: DbHandle,
    page: { cursor?: string | undefined; limit?: number | undefined },
    input: Omit<AuditFilters, 'from' | 'to'> & { from: string; to: string }
  ): Promise<Page<AuditRecordRow>> {
    const range = this.resolveRange(input.from, input.to);
    const context = this.contextOf(db);
    const request: PageRequest = pageRequest(AUDIT_ORDERING, page);

    const result = await this.audit.listRecords(db, request, { ...input, ...range });

    // Audited *after* the read, so a refused read is not recorded as a
    // successful one. The record names the window and the result size, never the
    // records returned — an audit record that copies the audit trail is a second
    // copy of it.
    await appendAudit(db, {
      action: 'iam.audit.viewed',
      entityType: 'iam.audit_record',
      entityId: null,
      requestRef: context.operation,
      details: [
        { field: 'range_from', classification: 'internal', value: range.from },
        { field: 'range_to', classification: 'internal', value: range.to },
        { field: 'returned', classification: 'internal', value: String(result.items.length) },
      ],
    });

    return result;
  }

  /**
   * Reads one record, with its masked details when the caller additionally holds
   * `iam.sensitive.view`.
   *
   * The values were masked by `iam.audit_mask` at **write** time for `restricted`
   * and `secret` classifications, so this is not a place where a mistake could
   * un-mask something: the unmasked value was never stored.
   */
  async detail(db: DbHandle, recordId: string): Promise<AuditRecordView> {
    const record = await this.audit.findRecord(db, recordId);
    if (!record) {
      throw new AppFailure('ERR-RES-001', { message: 'Audit record not found in this tenant' });
    }

    const permissions = await this.authorization.effectivePermissionsOfCaller(db);
    const details = permissions.has('iam.sensitive.view')
      ? await this.audit.listDetails(db, recordId)
      : undefined;

    await appendAudit(db, {
      action: 'iam.audit.viewed',
      entityType: 'iam.audit_record',
      entityId: recordId,
      details: [
        {
          field: 'detail_rows_returned',
          classification: 'internal',
          value: details ? String(details.length) : '0',
        },
      ],
    });

    return { ...record, ...(details ? { details } : {}) };
  }
}
