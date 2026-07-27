/**
 * `svc` catalog SQL (Phase 1-20, P1-20-BE-001…003).
 *
 * The only place service, category, version, labour-time and branch-availability
 * SQL is written. Pricing tables in the same schema belong to the `pricing`
 * module — the split is by aggregate, not by schema, and neither module reads the
 * other's tables.
 *
 * Two conventions this file follows without exception:
 *
 *  - **Every query carries an explicit `tenant_id` predicate** even though RLS
 *    already narrows. RLS is the guarantee; the predicate is the intent, and it
 *    keeps the plan on the tenant-leading composite indexes.
 *  - **`numeric` values are read as STRINGS.** `standard_minutes` is
 *    `numeric(10,2)`; `pg` returns OID 1700 as text and this repository never
 *    overrides that, because IEEE-754 cannot represent every value the column
 *    holds. The same rule money follows in `pricing`.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/** Services are listed newest-code-first by a stable, indexed key. */
export const SERVICE_ORDER: OrderingContract = Object.freeze({
  key: 'service_code',
  direction: 'asc',
});

export interface ServiceRow {
  readonly id: string;
  readonly serviceCategoryId: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly lifecycleStatus: string;
  readonly archivedAt: Date | null;
  readonly recordVersion: number;
}

export interface ServiceVersionRow {
  readonly id: string;
  readonly serviceId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly notes: string | null;
  readonly recordVersion: number;
}

export interface ServiceCategoryRow {
  readonly id: string;
  readonly parentCategoryId: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number | null;
  readonly status: string;
  readonly recordVersion: number;
}

/**
 * Availability carries its own `company_id`/`branch_id`.
 *
 * Not decoration: `/branch-service-availability/{id}` names no branch, so without
 * these columns a deferred `authorizeScope` would have nothing to narrow by and
 * `scope: 'branch'` would degrade to a scope-blind check (P1-18-A-01).
 */
export interface BranchAvailabilityRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly serviceId: string;
  readonly isAvailable: boolean;
  readonly status: string;
  readonly recordVersion: number;
}

export interface LaborTimeRow {
  readonly id: string;
  readonly serviceVersionId: string;
  readonly laborCode: string | null;
  /** `numeric(10,2)` — a STRING, never a float. */
  readonly standardMinutes: string;
  readonly skillRef: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface ServiceListFilter {
  readonly categoryId?: string | undefined;
  readonly lifecycleStatus?: string | undefined;
  /** Restricts to services available at this branch, via `branch_service_availability`. */
  readonly availableAtBranchId?: string | undefined;
  /** Restricts to services with a published version covering this date. */
  readonly effectiveOn?: string | undefined;
  /** Case-insensitive prefix match on code or name. */
  readonly search?: string | undefined;
}

/** Column list for an unaliased `svc.services` query. */
const SERVICE_COLUMNS = `id, service_category_id, service_code, name, description,
       lifecycle_status, archived_at, record_version`;

/** The same list under the `s` alias the list query uses. */
const SERVICE_COLUMNS_S = `s.id, s.service_category_id, s.service_code, s.name, s.description,
       s.lifecycle_status, s.archived_at, s.record_version`;

interface ServiceSql {
  readonly id: string;
  readonly service_category_id: string;
  readonly service_code: string;
  readonly name: string;
  readonly description: string | null;
  readonly lifecycle_status: string;
  readonly archived_at: Date | null;
  readonly record_version: number;
}

const toService = (row: ServiceSql): ServiceRow => ({
  id: row.id,
  serviceCategoryId: row.service_category_id,
  serviceCode: row.service_code,
  name: row.name,
  description: row.description,
  lifecycleStatus: row.lifecycle_status,
  archivedAt: row.archived_at,
  recordVersion: row.record_version,
});

/**
 * Escapes the three characters that are special to a `LIKE`/`ILIKE` pattern.
 *
 * The backslash must be escaped FIRST, otherwise the backslashes introduced for
 * `%` and `_` would themselves be escaped a second time and the pattern would
 * match a literal backslash instead. Paired with `ESCAPE '\'` at the call site.
 */
function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export class ServiceCatalogRepository extends Repository {
  protected readonly module = 'service-catalog';

  /**
   * Lists services for the caller's tenant.
   *
   * The branch filter is an `EXISTS` against `branch_service_availability` rather
   * than a join, so a service with an availability row does not multiply and the
   * result count is the service count. Ordering is `(service_code, id)` — a total
   * order backed by `uq_services_code`, so the keyset page is stable even when two
   * services share a name.
   */
  public async listServices(
    db: DbHandle,
    filter: ServiceListFilter,
    request: PageRequest
  ): Promise<Page<ServiceRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId];
    const clauses: string[] = [`s.tenant_id = $1`, `s.deleted_at IS NULL`];

    if (filter.categoryId !== undefined) {
      values.push(filter.categoryId);
      clauses.push(`s.service_category_id = $${values.length}`);
    }
    if (filter.lifecycleStatus !== undefined) {
      values.push(filter.lifecycleStatus);
      clauses.push(`s.lifecycle_status = $${values.length}`);
    }
    if (filter.search !== undefined) {
      // The term is ESCAPED, not merely parameterised. Binding a value stops SQL
      // injection but does nothing about LIKE metacharacters: a bound `%` is still
      // a wildcard in the pattern, so a search for `%` would return the entire
      // catalog and a search for a literal `_` would match any character. Both are
      // wrong answers to the question the caller asked.
      values.push(`${escapeLikeTerm(filter.search)}%`);
      clauses.push(
        `(s.service_code ILIKE $${values.length} ESCAPE '\\'` +
          ` OR s.name ILIKE $${values.length} ESCAPE '\\')`
      );
    }
    if (filter.availableAtBranchId !== undefined) {
      values.push(filter.availableAtBranchId);
      clauses.push(`EXISTS (
        SELECT 1 FROM svc.branch_service_availability a
         WHERE a.tenant_id = s.tenant_id AND a.service_id = s.id
           AND a.branch_id = $${values.length}
           AND a.is_available AND a.status = 'active' AND a.deleted_at IS NULL)`);
    }
    if (filter.effectiveOn !== undefined) {
      values.push(filter.effectiveOn);
      clauses.push(`EXISTS (
        SELECT 1 FROM svc.service_versions v
         WHERE v.tenant_id = s.tenant_id AND v.service_id = s.id
           AND v.status = 'published' AND v.deleted_at IS NULL
           AND v.effective_from <= $${values.length}::date
           AND (v.effective_to IS NULL OR v.effective_to > $${values.length}::date))`);
    }

    const keyset = keysetFragment(
      request,
      { sort: 's.service_code', id: 's.id' },
      SERVICE_ORDER,
      values.length + 1
    );
    const rows = await this.run<ServiceSql>(
      db,
      `SELECT ${SERVICE_COLUMNS_S}
         FROM svc.services s
        WHERE ${clauses.join(' AND ')} ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPage(rows.rows.map(toService), request, SERVICE_ORDER, (row) => ({
      sortValue: row.serviceCode,
      id: row.id,
    }));
  }

  /** Reads one service by id, or null when it is outside the caller's tenant. */
  public async findService(db: DbHandle, serviceId: string): Promise<ServiceRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ServiceSql>(
      db,
      `SELECT ${SERVICE_COLUMNS} FROM svc.services
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, serviceId]
    );
    return row ? toService(row) : null;
  }

  /** Locks a service row for a state-changing command. */
  public async lockService(db: DbHandle, serviceId: string): Promise<ServiceRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ServiceSql>(
      db,
      `SELECT ${SERVICE_COLUMNS} FROM svc.services
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, serviceId]
    );
    return row ? toService(row) : null;
  }

  public async findCategory(db: DbHandle, categoryId: string): Promise<ServiceCategoryRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      parent_category_id: string | null;
      code: string;
      name: string;
      description: string | null;
      sort_order: number | null;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, parent_category_id, code, name, description, sort_order, status, record_version
         FROM svc.service_categories
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, categoryId]
    );
    return row
      ? {
          id: row.id,
          parentCategoryId: row.parent_category_id,
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: row.sort_order,
          status: row.status,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Reads the published version covering `asOf`, if any.
   *
   * The half-open comparison mirrors the gist EXCLUDE's `[)` range exactly, so a
   * version ending on a date does not cover that date.
   */
  public async findPublishedVersion(
    db: DbHandle,
    serviceId: string,
    asOf: string
  ): Promise<ServiceVersionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      service_id: string;
      version_no: number;
      effective_from: string;
      effective_to: string | null;
      status: string;
      notes: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, service_id, version_no, effective_from, effective_to, status, notes, record_version
         FROM svc.service_versions
        WHERE tenant_id = $1 AND service_id = $2 AND status = 'published' AND deleted_at IS NULL
          AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to > $3::date)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [context.principal.tenantId, serviceId, asOf]
    );
    return row
      ? {
          id: row.id,
          serviceId: row.service_id,
          versionNo: row.version_no,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          status: row.status,
          notes: row.notes,
          recordVersion: row.record_version,
        }
      : null;
  }

  /** Standard labour times attached to a service version. */
  public async listLaborTimes(
    db: DbHandle,
    serviceVersionId: string
  ): Promise<readonly LaborTimeRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      service_version_id: string;
      labor_code: string | null;
      standard_minutes: string;
      skill_ref: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, service_version_id, labor_code, standard_minutes, skill_ref, status, record_version
         FROM svc.standard_labor_times
        WHERE tenant_id = $1 AND service_version_id = $2 AND deleted_at IS NULL
        ORDER BY labor_code NULLS FIRST, id`,
      [context.principal.tenantId, serviceVersionId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      serviceVersionId: row.service_version_id,
      laborCode: row.labor_code,
      standardMinutes: row.standard_minutes,
      skillRef: row.skill_ref,
      status: row.status,
      recordVersion: row.record_version,
    }));
  }

  /** Reads the single availability row for a `(company, branch, service)` triple. */
  public async findAvailability(
    db: DbHandle,
    companyId: string,
    branchId: string,
    serviceId: string
  ): Promise<BranchAvailabilityRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      service_id: string;
      is_available: boolean;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, branch_id, service_id, is_available, status, record_version
         FROM svc.branch_service_availability
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND service_id = $4
          AND deleted_at IS NULL`,
      [context.principal.tenantId, companyId, branchId, serviceId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          serviceId: row.service_id,
          isAvailable: row.is_available,
          status: row.status,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * True when the service may be sold at this branch on this date.
   *
   * Both halves matter and they come from different tables: the service needs a
   * published version covering the date, and the branch needs an active,
   * available row. A service with no availability row is **not** available —
   * absence is a denial, not a default, because `svc.guard_branch_availability_service_active`
   * only constrains rows that exist.
   */
  public async isSellableAt(
    db: DbHandle,
    companyId: string,
    branchId: string,
    serviceId: string,
    asOf: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ ok: boolean }>(
      db,
      `SELECT (
         EXISTS (SELECT 1 FROM svc.branch_service_availability a
                  WHERE a.tenant_id = $1 AND a.company_id = $2 AND a.branch_id = $3
                    AND a.service_id = $4 AND a.is_available AND a.status = 'active'
                    AND a.deleted_at IS NULL)
         AND EXISTS (SELECT 1 FROM svc.service_versions v
                  WHERE v.tenant_id = $1 AND v.service_id = $4 AND v.status = 'published'
                    AND v.deleted_at IS NULL
                    AND v.effective_from <= $5::date
                    AND (v.effective_to IS NULL OR v.effective_to > $5::date))
         AND EXISTS (SELECT 1 FROM svc.services s
                  WHERE s.tenant_id = $1 AND s.id = $4 AND s.lifecycle_status = 'active'
                    AND s.deleted_at IS NULL)
       ) AS ok`,
      [context.principal.tenantId, companyId, branchId, serviceId, asOf]
    );
    return row?.ok === true;
  }
}
