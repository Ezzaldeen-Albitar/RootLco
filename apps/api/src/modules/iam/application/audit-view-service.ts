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
 *
 * ## Who did it, by name (`P1-32-PRE-OD-ADM6`, route-checklist prerequisite 10)
 *
 * `iam.audit_records` stores an `actor_id` and no name, so the audit screen
 * printed a uuid in the column headed "who". Both reads now name the actor —
 * and, where the record is about a user account, the account it is about —
 * resolved in the same read through the module's own identity directory:
 *
 *  - **one lookup per page**, never one per row: the ids of the whole page go
 *    to `resolveDisplayIdentities` together (one capability check and one
 *    tenant-scoped statement);
 *  - **only for a caller who may read users.** The audit read is guarded by
 *    `iam.audit.view`; naming everybody to every holder of that code would
 *    publish a staff directory it does not grant. Without `iam.user.read` both
 *    names are `null` and the identifiers stay, exactly as before;
 *  - **only inside the caller's tenant.** The directory's statement is bound to
 *    the principal's tenant, so an id belonging to another organisation is
 *    never named — it resolves to `null` like any id that cannot be named.
 *
 * Both names are REQUIRED and nullable on the published type, so a read that
 * forgot to resolve cannot satisfy it. The fields are additive: `actorId`,
 * `actorKind` and `entityId` are unchanged on the wire.
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
import type { IdentityDirectoryService } from './identity-directory-service';

/** Longest range a single query may cover. */
const MAX_RANGE_DAYS = 92;

/** The entity type every user-account audit record is written under. */
const USER_ACCOUNT_ENTITY = 'iam.user_account';

/**
 * An audit record with its people named. `null` means "not named for this
 * caller": no actor, an actor this caller may not have named, or an id outside
 * the caller's tenant. `subjectDisplayName` is set only for a record about a
 * user account (`entityType` `iam.user_account`).
 */
export interface NamedAuditRecord extends AuditRecordRow {
  readonly actorDisplayName: string | null;
  readonly subjectDisplayName: string | null;
}

export interface AuditRecordView extends NamedAuditRecord {
  readonly details?: readonly AuditDetailRow[];
}

export class AuditViewService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(
    private readonly audit: AuditRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly directory: IdentityDirectoryService
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

  /**
   * Names the actor, and a user-account subject, of every record handed in —
   * with ONE directory lookup for all of them. The directory checks
   * `iam.user.read` itself and answers an empty map without it.
   */
  private async nameRecords(
    db: DbHandle,
    records: readonly AuditRecordRow[]
  ): Promise<NamedAuditRecord[]> {
    const subjectOf = (record: AuditRecordRow): string | null =>
      record.entityType === USER_ACCOUNT_ENTITY ? record.entityId : null;
    const ids = new Set<string>();
    for (const record of records) {
      if (record.actorId !== null) ids.add(record.actorId);
      const subject = subjectOf(record);
      if (subject !== null) ids.add(subject);
    }
    const names = await this.directory.resolveDisplayIdentities(db, [...ids]);
    const nameOf = (id: string | null): string | null =>
      id === null ? null : (names.get(id)?.displayName ?? null);
    return records.map((record) => ({
      ...record,
      actorDisplayName: nameOf(record.actorId),
      subjectDisplayName: nameOf(subjectOf(record)),
    }));
  }

  /** Raw page inputs, for the same boundary reason as the other list services. */
  async list(
    db: DbHandle,
    page: { cursor?: string | undefined; limit?: number | undefined },
    input: Omit<AuditFilters, 'from' | 'to'> & { from: string; to: string }
  ): Promise<Page<NamedAuditRecord>> {
    const range = this.resolveRange(input.from, input.to);
    const context = this.contextOf(db);
    const request: PageRequest = pageRequest(AUDIT_ORDERING, page);

    const result = await this.audit.listRecords(db, request, { ...input, ...range });
    const items = await this.nameRecords(db, result.items);

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

    return { ...result, items };
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

    const [named] = await this.nameRecords(db, [record]);
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

    return {
      ...(named ?? { ...record, actorDisplayName: null, subjectDisplayName: null }),
      ...(details ? { details } : {}),
    };
  }
}
