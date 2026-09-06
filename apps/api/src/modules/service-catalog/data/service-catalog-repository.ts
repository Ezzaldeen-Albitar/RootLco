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

/**
 * Categories are listed by `code` — the only column that is both unique per tenant
 * and immutable (`uq_service_categories_code`, `tg_service_categories_immutable`),
 * so a keyset page cannot repeat or skip a row because someone renamed a category
 * mid-listing. `name` is neither.
 *
 * The key is the QUALIFIED `<schema>.<table>:<column>_<direction>` form the
 * `OrderingContract` docblock documents and 54 of the 57 live contracts use.
 * `SERVICE_ORDER` above is one of the three unqualified outliers; it is not the
 * convention and is deliberately not copied here.
 */
export const SERVICE_CATEGORY_ORDER: OrderingContract = Object.freeze({
  key: 'svc.service_categories:code_asc',
  direction: 'asc',
});

/** Column list for an unaliased `svc.service_categories` query. */
const CATEGORY_COLUMNS = `id, parent_category_id, code, name, description,
       sort_order, status, record_version`;

interface ServiceCategorySql {
  readonly id: string;
  readonly parent_category_id: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sort_order: number | null;
  readonly status: string;
  readonly record_version: number;
}

/**
 * `sort_order` stays a NUMBER. It is `integer`, not `numeric`, so the
 * decimal-string rule this file states for `standard_minutes` does not reach it —
 * rendering it as a string would imply a precision the column does not have.
 */
const toServiceCategory = (row: ServiceCategorySql): ServiceCategoryRow => ({
  id: row.id,
  parentCategoryId: row.parent_category_id,
  code: row.code,
  name: row.name,
  description: row.description,
  sortOrder: row.sort_order,
  status: row.status,
  recordVersion: row.record_version,
});

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

  /** Reads one category by id, or null when it is outside the caller's tenant. */
  public async findCategory(db: DbHandle, categoryId: string): Promise<ServiceCategoryRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ServiceCategorySql>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM svc.service_categories
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, categoryId]
    );
    return row ? toServiceCategory(row) : null;
  }

  /**
   * Lists the tenant's service taxonomy.
   *
   * Soft-deleted rows are excluded by the predicate and `deleted_at` is never
   * projected — the same rule `findCategory` and `findService` follow. `status`
   * IS projected, and that is load-bearing rather than incidental: a category
   * that is `inactive` cannot carry a new service (`svc.service-create` refuses
   * it with `inactive_category`), so a picker that could not see the status
   * would offer choices the very next call rejects.
   */
  public async listServiceCategories(
    db: DbHandle,
    request: PageRequest
  ): Promise<Page<ServiceCategoryRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId];
    const keyset = keysetFragment(
      request,
      { sort: 'c.code', id: 'c.id' },
      SERVICE_CATEGORY_ORDER,
      values.length + 1
    );
    const rows = await this.run<ServiceCategorySql>(
      db,
      `SELECT c.id, c.parent_category_id, c.code, c.name, c.description,
              c.sort_order, c.status, c.record_version
         FROM svc.service_categories c
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPage(rows.rows.map(toServiceCategory), request, SERVICE_CATEGORY_ORDER, (row) => ({
      sortValue: row.code,
      id: row.id,
    }));
  }

  /**
   * Inserts a category.
   *
   * `tenant_id` comes from the request context and never from the caller, and
   * `created_by` from the authenticated principal — the same two bindings
   * `insertService` makes. `status` is not a parameter: the column defaults to
   * `active`, and offering a choice here would let a caller create a category
   * that nothing may be filed under, which `svc.service-create` would then
   * refuse.
   */
  public async insertCategory(
    db: DbHandle,
    input: {
      parentCategoryId: string | null;
      code: string;
      name: string;
      description: string | null;
      sortOrder: number | null;
    }
  ): Promise<ServiceCategoryRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ServiceCategorySql>(
      db,
      `INSERT INTO svc.service_categories
         (tenant_id, parent_category_id, code, name, description, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${CATEGORY_COLUMNS}`,
      [
        context.principal.tenantId,
        input.parentCategoryId,
        input.code,
        input.name,
        input.description,
        input.sortOrder,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('service-catalog: category insert returned no row');
    return toServiceCategory(row);
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

  /**
   * Standard labour times attached to a service version (P1-20-BE-003).
   *
   * Attached to the VERSION, not the service, which is what makes a published
   * standard time stable: `svc.service_versions` is the immutable unit, so a revised
   * labour standard is a new version rather than an edit under work already estimated
   * against the old one.
   *
   * `standard_minutes` is `numeric(10,2)` and is returned as a decimal STRING for the
   * same reason every amount in this phase is — a float cannot represent every value
   * the column holds, and this one is multiplied by a labour rate downstream.
   */
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

  /**
   * Reads the single availability row for a `(company, branch, service)` triple
   * (P1-20-BE-002).
   *
   * `null` means NO row, which is not the same as `is_available = false`: an absent
   * row is an unconfigured branch and a present false row is a deliberate withdrawal.
   * Both refuse a sale, and the caller can tell an operator which one it is.
   */
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
   * Whether `branchId` is a live branch of `companyId` in the caller's tenant.
   *
   * `svc.branch_service_availability` DOES have `fk_branch_service_availability_branch`
   * on `(tenant_id, company_id, branch_id)`, so an incoherent pair cannot be stored —
   * but the foreign key fires AFTER the route has already authorized the pair, and
   * `iam.has_permission_in_scope` is **disjunctive** across grant rows: a caller naming
   * their own branch with someone else's company satisfies the permission check on the
   * branch row alone. Refusing the pair before the scope check is what stops that
   * request being authorized at all, and it turns a foreign-key violation into a 422
   * naming the field.
   *
   * `pricing` has an identical predicate. It is duplicated rather than imported because
   * ADR-001 rule 3 makes a module's tables private, and `org.branches` is read here for
   * the same reason `pricing` reads it — an organizational containment fact, not an
   * authorization decision. RLS narrows it to the caller's tenant.
   */
  public async branchBelongsToCompany(
    db: DbHandle,
    companyId: string,
    branchId: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ ok: boolean }>(
      db,
      `SELECT EXISTS (
         SELECT 1 FROM org.branches b
          WHERE b.tenant_id = $1 AND b.company_id = $2 AND b.id = $3
            AND b.deleted_at IS NULL
       ) AS ok`,
      [context.principal.tenantId, companyId, branchId]
    );
    return row?.ok === true;
  }

  /**
   * Creates a service.
   *
   * `service_code` is written once and never again: `tg_services_immutable` freezes it
   * alongside `tenant_id`, `created_at` and `created_by`, so the code chosen here
   * identifies this service for the rest of its life. `lifecycle_status` is always
   * `'active'` — `ck_services_archived_at` ties `archived` to a non-null `archived_at`,
   * which `svc.guard_service_lifecycle` sets on the transition, so creating a service
   * already archived is not a state this schema can express and no parameter offers it.
   */
  public async insertService(
    db: DbHandle,
    input: {
      serviceCategoryId: string;
      serviceCode: string;
      name: string;
      description: string | null;
    }
  ): Promise<ServiceRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ServiceSql>(
      db,
      `INSERT INTO svc.services
         (tenant_id, service_category_id, service_code, name, description,
          lifecycle_status, created_by)
       VALUES ($1,$2,$3,$4,$5,'active',$6)
       RETURNING ${SERVICE_COLUMNS}`,
      [
        context.principal.tenantId,
        input.serviceCategoryId,
        input.serviceCode,
        input.name,
        input.description,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('service-catalog: service insert returned no row');
    return toService(row);
  }

  /**
   * Applies a partial edit to a service.
   *
   * The SET list is assembled from the fields the caller actually sent, so an absent
   * field is left untouched and a `null` description clears it — which the two are not
   * interchangeable for: `ck_services_desc_not_blank` accepts NULL and refuses `''`.
   *
   * `service_code` has no branch here at all. Omitting it from this method is the
   * structural half of the immutability promise; `tg_services_immutable` is the
   * database's half, and the route's `.strict()` schema is the one that tells a caller
   * naming it that the field does not exist rather than silently discarding it.
   */
  public async updateService(
    db: DbHandle,
    serviceId: string,
    patch: {
      serviceCategoryId?: string | undefined;
      name?: string | undefined;
      /** Present means "write it"; `null` clears the column. */
      description?: string | null | undefined;
      lifecycleStatus?: string | undefined;
    }
  ): Promise<ServiceRow> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, serviceId];
    const sets: string[] = [];
    if (patch.serviceCategoryId !== undefined) {
      values.push(patch.serviceCategoryId);
      sets.push(`service_category_id = $${values.length}`);
    }
    if (patch.name !== undefined) {
      values.push(patch.name);
      sets.push(`name = $${values.length}`);
    }
    if (patch.description !== undefined) {
      values.push(patch.description);
      sets.push(`description = $${values.length}`);
    }
    if (patch.lifecycleStatus !== undefined) {
      values.push(patch.lifecycleStatus);
      sets.push(`lifecycle_status = $${values.length}`);
    }
    if (sets.length === 0) {
      // Unreachable through the route, which refuses an empty patch with a 422 naming
      // the body. Guarded anyway because an UPDATE with an empty SET list is a syntax
      // error, and a syntax error is the least informative way to learn this.
      throw new Error('service-catalog: updateService called with no fields');
    }
    const row = await this.runOne<ServiceSql>(
      db,
      `UPDATE svc.services SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING ${SERVICE_COLUMNS}`,
      values
    );
    if (row === null) throw new Error('service-catalog: service update returned no row');
    return toService(row);
  }

  /** Reads one service version by id, whatever its status. */
  public async findServiceVersion(
    db: DbHandle,
    versionId: string
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
      `SELECT id, service_id, version_no, effective_from::text AS effective_from,
              effective_to::text AS effective_to, status, notes, record_version
         FROM svc.service_versions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, versionId]
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

  /**
   * Inserts a DRAFT version for a service.
   *
   * `version_no` is computed in the same statement as the insert, not read and
   * then written: `uq_service_versions_no` is `(tenant_id, service_id,
   * version_no)`, so two concurrent creates that both read the same maximum
   * would collide. The caller holds `FOR UPDATE` on the service row, which
   * serialises them, and this sub-select makes the computation atomic even if a
   * future caller forgets that lock.
   *
   * No overlap check: `ex_service_versions_no_published_overlap` is
   * `WHERE (status = 'published' AND deleted_at IS NULL)`, so drafts may overlap
   * each other and the currently published one freely. That is the point of a
   * draft — the succession boundary is decided at publication by
   * `svc.publish_service_version`, not here.
   */
  public async insertServiceVersion(
    db: DbHandle,
    input: {
      serviceId: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      notes: string | null;
    }
  ): Promise<ServiceVersionRow> {
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
      `INSERT INTO svc.service_versions
         (tenant_id, service_id, version_no, effective_from, effective_to, notes, created_by)
       VALUES (
         $1, $2,
         (SELECT COALESCE(MAX(v.version_no), 0) + 1
            FROM svc.service_versions v
           WHERE v.tenant_id = $1 AND v.service_id = $2),
         $3::date, $4::date, $5, $6)
       RETURNING id, service_id, version_no, effective_from::text AS effective_from,
                 effective_to::text AS effective_to, status, notes, record_version`,
      [
        context.principal.tenantId,
        input.serviceId,
        input.effectiveFrom,
        input.effectiveTo,
        input.notes,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('service-catalog: service version insert returned no row');
    return {
      id: row.id,
      serviceId: row.service_id,
      versionNo: row.version_no,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      status: row.status,
      notes: row.notes,
      recordVersion: row.record_version,
    };
  }

  /**
   * Publishes a draft version through `svc.publish_service_version`.
   *
   * The function locks the service, refuses a version that is not this service's,
   * refuses a non-draft version, refuses an `effective_from` at or before the currently
   * open published version's own start, closes that version's `effective_to` at the new
   * date, and publishes. Forward-only succession and the
   * `ex_service_versions_no_published_overlap` gist backstop are therefore the
   * database's, and nothing here restates either — a second implementation of
   * succession could disagree with the one that actually runs, and the disagreement
   * would surface as a service silently effective on the wrong day.
   */
  public async publishServiceVersion(
    db: DbHandle,
    input: { serviceId: string; versionId: string; effectiveFrom: string }
  ): Promise<void> {
    await this.run(db, `SELECT svc.publish_service_version($1, $2, $3::date)`, [
      input.serviceId,
      input.versionId,
      input.effectiveFrom,
    ]);
  }

  /**
   * Records the first availability row for a `(company, branch, service)` triple.
   *
   * `uq_branch_service_availability_service` permits exactly one live row per triple, so
   * this is only ever reached under the service's `FOR UPDATE` lock after
   * `findAvailability` returned null. The lock is what makes "read then insert or
   * update" safe here rather than an upsert: two concurrent requests for the same
   * service serialize on the service row, so neither can observe the absence the other
   * is about to fill.
   */
  public async insertAvailability(
    db: DbHandle,
    input: {
      companyId: string;
      branchId: string;
      serviceId: string;
      isAvailable: boolean;
      status: string;
    }
  ): Promise<BranchAvailabilityRow> {
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
      `INSERT INTO svc.branch_service_availability
         (tenant_id, company_id, branch_id, service_id, is_available, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, company_id, branch_id, service_id, is_available, status, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.serviceId,
        input.isAvailable,
        input.status,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('service-catalog: availability insert returned no row');
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      serviceId: row.service_id,
      isAvailable: row.is_available,
      status: row.status,
      recordVersion: row.record_version,
    };
  }

  /**
   * Changes the state of an existing availability row.
   *
   * Only the two state columns are written. `tg_branch_service_availability_immutable`
   * freezes the triple itself, so an availability row cannot be re-pointed at another
   * branch or another service — which is why this takes the row's id and no scope
   * parameters: the scope it was authorized against is the scope it keeps.
   */
  public async updateAvailability(
    db: DbHandle,
    availabilityId: string,
    input: { isAvailable: boolean; status: string }
  ): Promise<BranchAvailabilityRow> {
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
      `UPDATE svc.branch_service_availability
          SET is_available = $3, status = $4
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id, company_id, branch_id, service_id, is_available, status, record_version`,
      [context.principal.tenantId, availabilityId, input.isAvailable, input.status]
    );
    if (row === null) throw new Error('service-catalog: availability update returned no row');
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      serviceId: row.service_id,
      isAvailable: row.is_available,
      status: row.status,
      recordVersion: row.record_version,
    };
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
