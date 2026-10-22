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
import { crmModule } from '@/modules/crm';
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import {
  CUSTOMER_SEARCH_PERMISSION,
  toEntitySearchTerms,
  withoutCustomerArms,
} from '@/shared/text/search-terms';
import { callerHoldsPermissionAnywhere } from '@/server/auth/authorization';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { LocalDayPeriod } from '@/server/db/period';
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
import { receptionStatusesInGroup, type ReceptionStatusGroup } from '../domain/reception';

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

  /**
   * How many reception visits were opened in the period, across a branch set.
   *
   * Owner directive — the tenant dashboard. NO authorization is performed here,
   * deliberately: the caller has already evaluated `rec.reception.read` against
   * the company and every branch it passes, and RLS narrows the statement
   * underneath. A second, differently-shaped check would be a second definition
   * of scope — the argument `LaborReportPort` records on the other side of the
   * same dashboard.
   */
  async overviewVisitsOpened(
    db: DbHandle,
    scope: { readonly companyId: string; readonly branchIds: readonly string[] },
    period: LocalDayPeriod
  ): Promise<number> {
    return this.reads.overviewVisitsOpened(db, scope, period);
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
      /** Resolved by the route; `undefined` means every branch of the company. */
      readonly branchIds?: readonly string[] | undefined;
      readonly status?: string | undefined;
      /**
       * `open` or `finished` (Owner directive, P1-32-PRE-OD-UX). Resolved HERE
       * into the statuses it covers, because the vocabulary and its terminal
       * list belong to this module's domain — a route that expanded the group
       * itself would be a second copy of the frozen graph.
       */
      readonly statusGroup?: ReceptionStatusGroup | undefined;
      readonly vehicleId?: string | undefined;
      /** Inclusive bounds on the instant custody was accepted. */
      readonly from?: string | undefined;
      readonly to?: string | undefined;
      /** The raw free-text box; reduced here, once, by the shared rule. */
      readonly q?: string | undefined;
    } & PageQuery
  ): Promise<Page<ReceptionListEntry>> {
    const page = await this.reads.listReceptions(
      db,
      {
        companyId: query.companyId,
        branchIds: query.branchIds,
        status: query.status,
        statuses:
          query.statusGroup === undefined ? undefined : receptionStatusesInGroup(query.statusGroup),
        vehicleId: query.vehicleId,
        from: query.from,
        to: query.to,
        // Reduced in the APPLICATION layer rather than in the route, so every
        // caller of this service folds the box the same way.
        search: await searchTermsFor(db, query.q),
      },
      pageRequest(RECEPTION_LIST_ORDERING, query)
    );
    return { ...page, items: await nameCustomers(db, page.items) };
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

/**
 * Reduces the caller's box, with the customer arms switched off unless the
 * caller may read customers (Owner directive, P1-32-PRE-OD-UX).
 *
 * One statement, once per request, and only when a box was actually sent — a
 * list without `q` costs nothing. See `withoutCustomerArms` for the bound this
 * leaves and why the other three arms need no gate.
 */
async function searchTermsFor(db: DbHandle, q: string | undefined) {
  const terms = toEntitySearchTerms(q);
  if (!terms.present) return terms;
  return (await callerHoldsPermissionAnywhere(db, CUSTOMER_SEARCH_PERMISSION))
    ? terms
    : withoutCustomerArms(terms);
}

/**
 * Names the customer of every row on one page, in ONE additional statement
 * (Owner directive, P1-32-PRE-OD-UX).
 *
 * Batched deliberately: a board renders a page with a customer column, and a
 * per-row lookup is the N+1 every other enriched read in this repository was
 * written to avoid.
 *
 * Resolved through the CRM module's PUBLIC read rather than by joining
 * `crm.business_partners` in the reception statement. That read checks
 * `crm.customer.read` for itself and answers an EMPTY map to a caller who does
 * not hold it, so an unentitled caller keeps the role and loses only the name —
 * which is the same narrowing the work-order board applies to its technician
 * column, and it can never widen what the CRM permission model already decided.
 *
 * An id absent from the map is left `null` rather than failing the page: a
 * partner may be soft-deleted, merged away or outside this caller's reach, and
 * that is a sentence for the screen to say, not a reason to hide the other rows.
 */
async function nameCustomers(
  db: DbHandle,
  items: readonly ReceptionListEntry[]
): Promise<readonly ReceptionListEntry[]> {
  const partnerIds = [
    ...new Set(items.flatMap((item) => (item.customer === null ? [] : [item.customer.id]))),
  ];
  if (partnerIds.length === 0) return items;
  const identities = await crmModule().customerRead.resolveDisplayIdentities(db, partnerIds);
  return items.map((item) =>
    item.customer === null
      ? item
      : {
          ...item,
          customer: {
            id: item.customer.id,
            displayName: identities.get(item.customer.id)?.displayName ?? null,
          },
        }
  );
}
