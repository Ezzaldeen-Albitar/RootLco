/**
 * Reception READ service (P1-27 remediation, executed by P1-18:
 * `P1-27-INT-010`, `-011`, `-015`, `-016`, `-017`, `-021`).
 *
 * Six read use cases over one visit and one branch board. Every id-addressed
 * read resolves the visit first and answers the uniform `ERR-RES-001` 404 when
 * it is absent, deleted, or in another tenant — possession of an id proves
 * nothing about the row behind it — and then re-authorizes against the row's
 * OWN company and branch (P1-18-A-01): the pre-handler check ran with no scope
 * to name, so `scope: 'branch'` is inert until this call makes it true. RLS
 * visibility is not authority — `app.branch_ids` is the permission-blind union
 * of every active grant.
 *
 * The branch list takes its scope from the validated query instead, because the
 * same pair travels as the route's `authorizationTarget` and the pre-handler
 * check has already decided against it.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  AUTHORIZATION_ORDERING,
  CONDITION_EVIDENCE_ORDERING,
  PARTY_ROLE_ORDERING,
  RECEPTION_HISTORY_ORDERING,
  RECEPTION_LIST_ORDERING,
  RECEIVING_EMPLOYEE_ORDERING,
  type AuthorizationEntry,
  type ConditionEvidenceEntry,
  type PartyRoleEntry,
  type ReceptionDetailRow,
  type ReceptionHistoryEntry,
  type ReceptionListEntry,
  type ReceivingEmployeeEntry,
  type ReceptionReadRepository,
  type ReceptionScopeRow,
} from '../data/reception-read-repository';

/** Cursor/limit pair every list read accepts, already schema-validated. */
export interface PageQuery {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export class ReceptionReadService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(private readonly reads: ReceptionReadRepository) {
    super();
  }

  /** Operation A. The ETag the route emits is this row's `recordVersion`. */
  async readReception(
    db: DbHandle,
    receptionVisitId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceptionDetailRow> {
    const detail = await this.reads.findReceptionDetail(db, receptionVisitId);
    if (!detail) {
      throw new AppFailure('ERR-RES-001', { message: 'Reception was not found' });
    }
    await authorizeScope({ companyId: detail.companyId, branchId: detail.branchId });
    return detail;
  }

  /** Operation B. Scope comes from the validated query — see the module header. */
  async listReceptions(
    db: DbHandle,
    query: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly vehicleId?: string | undefined;
    } & PageQuery
  ): Promise<Page<ReceptionListEntry>> {
    return this.reads.listReceptions(
      db,
      {
        companyId: query.companyId,
        branchId: query.branchId,
        status: query.status,
        vehicleId: query.vehicleId,
      },
      pageRequest(RECEPTION_LIST_ORDERING, query)
    );
  }

  /** Active IAM users who may receive custody in the requested branch. */
  async listReceivingEmployees(
    db: DbHandle,
    query: {
      readonly companyId: string;
      readonly branchId: string;
    } & PageQuery
  ): Promise<Page<ReceivingEmployeeEntry>> {
    return this.reads.listReceivingEmployees(
      db,
      query.companyId,
      query.branchId,
      pageRequest(RECEIVING_EMPLOYEE_ORDERING, query)
    );
  }

  /** Operation C. */
  async listPartyRoles(
    db: DbHandle,
    receptionVisitId: string,
    query: { readonly status?: 'active' | 'ended' | undefined } & PageQuery,
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<PartyRoleEntry>> {
    await this.requireVisit(db, receptionVisitId, authorizeScope);
    return this.reads.listPartyRoles(
      db,
      receptionVisitId,
      { status: query.status },
      pageRequest(PARTY_ROLE_ORDERING, query)
    );
  }

  /** Operation D. */
  async listAuthorizations(
    db: DbHandle,
    receptionVisitId: string,
    query: PageQuery,
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<AuthorizationEntry>> {
    await this.requireVisit(db, receptionVisitId, authorizeScope);
    return this.reads.listAuthorizations(
      db,
      receptionVisitId,
      pageRequest(AUTHORIZATION_ORDERING, query)
    );
  }

  /** Operation E. */
  async listConditionEvidence(
    db: DbHandle,
    receptionVisitId: string,
    query: { readonly kind?: string | undefined } & PageQuery,
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<ConditionEvidenceEntry>> {
    await this.requireVisit(db, receptionVisitId, authorizeScope);
    return this.reads.listConditionEvidence(
      db,
      receptionVisitId,
      { kind: query.kind },
      pageRequest(CONDITION_EVIDENCE_ORDERING, query)
    );
  }

  /** Operation F. */
  async listHistory(
    db: DbHandle,
    receptionVisitId: string,
    query: PageQuery,
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<ReceptionHistoryEntry>> {
    await this.requireVisit(db, receptionVisitId, authorizeScope);
    return this.reads.listHistory(
      db,
      receptionVisitId,
      pageRequest(RECEPTION_HISTORY_ORDERING, query)
    );
  }

  /**
   * The uniform 404 plus the deferred scope authorization, for every read
   * addressed by a visit id. No lock is taken — a read locks nothing.
   */
  private async requireVisit(
    db: DbHandle,
    receptionVisitId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceptionScopeRow> {
    const visit = await this.reads.requireLiveVisit(db, receptionVisitId);
    if (!visit) {
      throw new AppFailure('ERR-RES-001', { message: 'Reception was not found' });
    }
    await authorizeScope({ companyId: visit.companyId, branchId: visit.branchId });
    return visit;
  }
}
