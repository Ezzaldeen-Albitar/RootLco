/**
 * Service-catalog mutations (Phase 1-20, P1-20-BE-001, P1-20-BE-002).
 *
 * The write half of the catalog: create a service, edit it, publish one of its
 * versions, and decide whether a branch offers it. The read half is
 * `ServiceCatalogService`, and the split is not cosmetic — a catalog read is
 * `svc.service.read` and low risk, every write here is `svc.service.manage` and
 * changes what the whole tenant is allowed to sell.
 *
 * ## Three invariants the protected schema owns, and this service does not restate
 *
 *  - **`service_code` is immutable.** `tg_services_immutable` freezes it with
 *    `tenant_id`, `created_at` and `created_by`. `updateService` has no parameter
 *    for it, so there is no code path that could try.
 *  - **`archived` is terminal.** `svc.guard_service_lifecycle` refuses
 *    `archived → anything`, and sets `archived_at` on the way in so
 *    `ck_services_archived_at` holds. This service refuses *every* write to an
 *    archived service first, which is stronger than the trigger and gives the
 *    caller `ERR-TRN-001` naming the state instead of a `check_violation` from
 *    four layers down.
 *  - **Version succession is forward-only.** `svc.publish_service_version` closes
 *    the currently open published version at the new `effective_from` and refuses
 *    a date at or before that version's own start;
 *    `ex_service_versions_no_published_overlap` is the gist backstop. Publication
 *    here is one call to that function — reimplementing succession would create a
 *    second definition that can disagree with the one that actually runs, and the
 *    disagreement would surface as a service effective on the wrong day rather
 *    than as an error.
 *
 * ## Why a write is authorized tenant-wide, except the availability one
 *
 * `svc.services` and `svc.service_versions` carry no `company_id` and no
 * `branch_id`. A service is tenant-wide reference data, so creating, editing or
 * publishing one is a tenant-wide act with no scope target to authorize — and an
 * operation with an empty target degrades to the scope-blind `iam.has_permission`
 * whatever scope it declares (P1-18-A-01). The routes therefore demand
 * `svc.service.manage` granted tenant-wide, the same control
 * `svc.price-list-version-publish` uses for the same reason.
 *
 * `svc.branch_service_availability` is the exception and carries both columns, so
 * that one operation is genuinely `scope: 'branch'` and is authorized against the
 * pair it is given.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import type {
  BranchAvailabilityRow,
  ServiceCatalogRepository,
  ServiceCategoryRow,
  ServiceRow,
  ServiceVersionRow,
} from '../data/service-catalog-repository';
import type { ActivationState, ServiceLifecycleState } from '../domain/service-catalog';
import type {
  ServiceCategoryView,
  ServiceVersionView,
  ServiceView,
} from './service-catalog-service';

/** A branch availability row as the API renders it. */
export interface BranchAvailabilityView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly serviceId: string;
  readonly isAvailable: boolean;
  readonly status: string;
  readonly recordVersion: number;
}

/** A published service version as the API renders it. */
export interface PublishedVersionView {
  readonly id: string;
  readonly serviceId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface CreateVersionInput {
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | undefined;
  readonly notes?: string | undefined;
}

export interface CreateCategoryInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly parentCategoryId?: string | undefined;
  readonly sortOrder?: number | undefined;
}

export interface CreateServiceInput {
  readonly serviceCategoryId: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly description?: string | undefined;
}

/**
 * A partial edit.
 *
 * `description` distinguishes absent from `null`: absent leaves the column alone,
 * `null` clears it. `ck_services_desc_not_blank` accepts NULL and refuses `''`, so
 * the two are not interchangeable and an "empty string means clear" convention
 * would be a CHECK violation rather than a clear.
 *
 * There is no `serviceCode`. See the class comment.
 */
export interface UpdateServiceInput {
  readonly serviceCategoryId?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly lifecycleStatus?: ServiceLifecycleState | undefined;
  readonly expectedVersion: number;
}

export interface SetAvailabilityInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly isAvailable: boolean;
  readonly status?: ActivationState | undefined;
}

const toServiceView = (row: ServiceRow): ServiceView => ({
  id: row.id,
  serviceCode: row.serviceCode,
  name: row.name,
  description: row.description,
  categoryId: row.serviceCategoryId,
  lifecycleStatus: row.lifecycleStatus,
  recordVersion: row.recordVersion,
});

const toAvailabilityView = (row: BranchAvailabilityRow): BranchAvailabilityView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  serviceId: row.serviceId,
  isAvailable: row.isAvailable,
  status: row.status,
  recordVersion: row.recordVersion,
});

export class ServiceCatalogWriteService extends ApplicationService {
  protected readonly module = 'service-catalog';

  public constructor(private readonly repository: ServiceCatalogRepository) {
    super();
  }

  /**
   * Creates a service.
   *
   * The category is checked before the insert rather than left to
   * `fk_services_category`, because a foreign-key violation cannot say *which*
   * reference was wrong once more than one exists, and an unknown category is
   * ordinary bad input rather than a server fault. The foreign key still fires if
   * the row disappears between the two statements — that race is the database's to
   * settle, and it is mapped rather than surfaced as a 500.
   */
  /**
   * Creates a service category.
   *
   * This exists because `svc.service-create` cannot be called without one and
   * nothing in the shipped product could write the table: on a tenant created
   * through the API the taxonomy was empty and permanently so, which made the
   * whole commercial chain unreachable (A0 F-02, seam S-02).
   *
   * The parent is checked before the insert for the same reason `create` checks
   * the category — `fk_service_categories_parent` cannot say WHICH reference was
   * wrong, and an unknown parent is ordinary bad input rather than a server
   * fault. An INACTIVE parent is refused too: filing a live category under a
   * retired branch of the taxonomy produces a subtree nothing can be sold from.
   *
   * Cycles are NOT re-checked here. `tg_service_categories_no_cycle` holds a
   * per-tenant advisory lock and is the only correct place for that test — a
   * check in application code would race with a concurrent re-parent and could
   * only ever be advisory.
   */
  public async createCategory(
    db: DbHandle,
    input: CreateCategoryInput
  ): Promise<ServiceCategoryView> {
    if (input.parentCategoryId !== undefined) {
      const parent = await this.repository.findCategory(db, input.parentCategoryId);
      if (parent === null) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Service category ${input.parentCategoryId} is not visible`,
          safeDetails: {
            violations: [{ path: 'body.parentCategoryId', rule: 'unknown_category' }],
          },
        });
      }
      if (parent.status !== 'active') {
        throw new AppFailure('ERR-VAL-001', {
          message: `Service category ${parent.code} is ${parent.status}`,
          safeDetails: {
            violations: [{ path: 'body.parentCategoryId', rule: 'inactive_category' }],
          },
        });
      }
    }

    let created: ServiceCategoryRow;
    try {
      created = await this.repository.insertCategory(db, {
        parentCategoryId: input.parentCategoryId ?? null,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? null,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        // `uq_service_categories_code` is `(tenant_id, code) WHERE deleted_at IS NULL`,
        // and `tg_service_categories_immutable` freezes `code` afterwards — so a
        // duplicate is not something a later edit can repair, exactly as for a service.
        throw new AppFailure('ERR-CON-001', {
          message: `A service category with code "${input.code}" already exists`,
          safeDetails: { violations: [{ path: 'body.code', rule: 'duplicate_code' }] },
        });
      }
      if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Service category ${String(input.parentCategoryId)} is not visible`,
          safeDetails: {
            violations: [{ path: 'body.parentCategoryId', rule: 'unknown_category' }],
          },
        });
      }
      throw cause;
    }

    await appendAudit(db, {
      action: 'svc.service_category.updated',
      entityType: 'svc.service_category',
      entityId: created.id,
      details: [
        { field: 'change', classification: 'public', value: 'created' },
        { field: 'code', classification: 'internal', value: created.code },
        { field: 'name', classification: 'internal', value: created.name },
        { field: 'status', classification: 'public', value: created.status },
      ],
    });

    return {
      id: created.id,
      code: created.code,
      name: created.name,
      description: created.description,
      parentCategoryId: created.parentCategoryId,
      sortOrder: created.sortOrder,
      status: created.status,
      recordVersion: created.recordVersion,
    };
  }

  /**
   * Creates a DRAFT version for a service.
   *
   * `svc.service-version-publish` requires a draft, and nothing in the shipped
   * product could create one: the A0 preflight found every `INSERT INTO
   * svc.service_versions` in the tree to be a test fixture writing through an
   * RLS-bypassing admin pool. So no service created through the API could ever
   * become sellable, and `isSellableAt` answered false for all of them — which
   * is why every quotation line was refused (A0 F-02, seam S-03).
   *
   * The service is LOCKED rather than merely read. `version_no` is unique per
   * `(tenant, service)`, so two concurrent creates must not both compute the
   * same next number; the lock serialises them and the repository's sub-select
   * makes the computation atomic regardless.
   *
   * The archived refusal is the same one `requireLockedService` states, but this
   * operation is not version-guarded so it cannot use that helper: there is no
   * `expectedVersion` to compare. Creating a draft does not mutate the service
   * row, so there is no lost-update to guard against — the succession decision
   * happens at publication, which IS guarded.
   */
  public async createVersion(
    db: DbHandle,
    serviceId: string,
    input: CreateVersionInput
  ): Promise<ServiceVersionView> {
    const service = await this.repository.lockService(db, serviceId);
    if (service === null) {
      throw new AppFailure('ERR-RES-001', { message: `Service ${serviceId} is not visible` });
    }
    if (service.lifecycleStatus === 'archived') {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Service ${service.serviceCode} is archived. Archiving is terminal: an archived ` +
          'service cannot be edited, reactivated, or given a new version.',
      });
    }

    const created = await this.repository.insertServiceVersion(db, {
      serviceId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      notes: input.notes ?? null,
    });

    await appendAudit(db, {
      action: 'svc.service_version.drafted',
      entityType: 'svc.service_version',
      entityId: created.id,
      details: [
        { field: 'serviceId', classification: 'internal', value: serviceId },
        { field: 'versionNo', classification: 'public', value: String(created.versionNo) },
        { field: 'effectiveFrom', classification: 'internal', value: created.effectiveFrom },
        { field: 'status', classification: 'public', value: created.status },
      ],
    });

    return {
      id: created.id,
      serviceId: created.serviceId,
      versionNo: created.versionNo,
      effectiveFrom: created.effectiveFrom,
      effectiveTo: created.effectiveTo,
      status: created.status,
      laborTimes: [],
    };
  }

  public async create(db: DbHandle, input: CreateServiceInput): Promise<ServiceView> {
    const category = await this.repository.findCategory(db, input.serviceCategoryId);
    if (category === null) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Service category ${input.serviceCategoryId} is not visible`,
        safeDetails: { violations: [{ path: 'body.serviceCategoryId', rule: 'unknown_category' }] },
      });
    }
    if (category.status !== 'active') {
      throw new AppFailure('ERR-VAL-001', {
        message: `Service category ${category.code} is ${category.status}`,
        safeDetails: {
          violations: [{ path: 'body.serviceCategoryId', rule: 'inactive_category' }],
        },
      });
    }

    let created: ServiceRow;
    try {
      created = await this.repository.insertService(db, {
        serviceCategoryId: input.serviceCategoryId,
        serviceCode: input.serviceCode,
        name: input.name,
        description: input.description ?? null,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        // `uq_services_code` is `(tenant_id, service_code) WHERE deleted_at IS NULL`.
        // A duplicate is a conflict the caller resolves by choosing another code, not
        // a server fault — and the code is immutable afterwards, so getting it wrong
        // here is not something an update can repair.
        throw new AppFailure('ERR-CON-001', {
          message: `A service with code "${input.serviceCode}" already exists`,
          safeDetails: { violations: [{ path: 'body.serviceCode', rule: 'duplicate_code' }] },
        });
      }
      if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Service category ${input.serviceCategoryId} is not visible`,
          safeDetails: {
            violations: [{ path: 'body.serviceCategoryId', rule: 'unknown_category' }],
          },
        });
      }
      throw cause;
    }

    await appendAudit(db, {
      action: 'svc.service.updated',
      entityType: 'svc.service',
      entityId: created.id,
      details: [
        // `change` is what lets an auditor tell a creation from an edit: one action
        // code covers both, because `svc.service.updated` is the only catalog action
        // the controlled catalog defines for a service row.
        { field: 'change', classification: 'public', value: 'created' },
        { field: 'serviceCode', classification: 'internal', value: created.serviceCode },
        { field: 'name', classification: 'internal', value: created.name },
        { field: 'serviceCategoryId', classification: 'internal', value: category.id },
        { field: 'lifecycleStatus', classification: 'public', value: created.lifecycleStatus },
      ],
    });
    return toServiceView(created);
  }

  /**
   * Applies a partial edit under optimistic concurrency.
   *
   * The lock is taken before the version is compared, so a concurrent edit either
   * waits or loses on `record_version` — never interleaves. The archived check runs
   * against the LOCKED row for the same reason: reading the lifecycle before taking
   * the lock would let a service be archived between the check and the write.
   */
  public async update(
    db: DbHandle,
    serviceId: string,
    input: UpdateServiceInput
  ): Promise<ServiceView> {
    const service = await this.requireLockedService(db, serviceId, input.expectedVersion);

    if (input.serviceCategoryId !== undefined) {
      const category = await this.repository.findCategory(db, input.serviceCategoryId);
      if (category === null || category.status !== 'active') {
        throw new AppFailure('ERR-VAL-001', {
          message: `Service category ${input.serviceCategoryId} is not an active category`,
          safeDetails: {
            violations: [{ path: 'body.serviceCategoryId', rule: 'unknown_category' }],
          },
        });
      }
    }

    const updated = await this.repository.updateService(db, service.id, {
      serviceCategoryId: input.serviceCategoryId,
      name: input.name,
      description: input.description,
      lifecycleStatus: input.lifecycleStatus,
    });

    /**
     * The audit names the COLUMNS that moved and their old and new values.
     *
     * `name` and `description` are `internal` rather than `public`: a service name is
     * what the tenant sells and appears on a customer's quotation, which is not a
     * secret but is not open reference data either. `lifecycleStatus` is `public`
     * because archiving is the fact an operator needs to find later, and masking it
     * would make the one irreversible change in this method the hardest to trace.
     */
    const details: {
      field: string;
      classification: 'public' | 'internal';
      previousValue?: string | null;
      value: string | null;
    }[] = [{ field: 'change', classification: 'public', value: 'updated' }];
    if (input.name !== undefined) {
      details.push({
        field: 'name',
        classification: 'internal',
        previousValue: service.name,
        value: updated.name,
      });
    }
    if (input.description !== undefined) {
      details.push({
        field: 'description',
        classification: 'internal',
        previousValue: service.description,
        value: updated.description,
      });
    }
    if (input.serviceCategoryId !== undefined) {
      details.push({
        field: 'serviceCategoryId',
        classification: 'internal',
        previousValue: service.serviceCategoryId,
        value: updated.serviceCategoryId,
      });
    }
    if (input.lifecycleStatus !== undefined) {
      details.push({
        field: 'lifecycleStatus',
        classification: 'public',
        previousValue: service.lifecycleStatus,
        value: updated.lifecycleStatus,
      });
    }

    await appendAudit(db, {
      action: 'svc.service.updated',
      entityType: 'svc.service',
      entityId: updated.id,
      details,
    });
    return toServiceView(updated);
  }

  /**
   * Publishes a draft version of a service.
   *
   * `expectedVersion` guards the SERVICE, not the version: the service is the row a
   * concurrent editor moves, and `svc.publish_service_version` takes its lock first,
   * so guarding it is what makes "publish the version of the service I was looking
   * at" mean something. A published version has no editable state left to guard —
   * `svc.guard_service_version_freeze` allows only `published → archived`.
   */
  public async publishVersion(
    db: DbHandle,
    serviceId: string,
    versionId: string,
    input: { effectiveFrom: string; expectedVersion: number }
  ): Promise<PublishedVersionView> {
    const service = await this.requireLockedService(db, serviceId, input.expectedVersion);
    const version = await this.requireDraftVersion(db, service.id, versionId);

    try {
      await this.repository.publishServiceVersion(db, {
        serviceId: service.id,
        versionId: version.id,
        effectiveFrom: input.effectiveFrom,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.checkViolation)) {
        // The function's own refusal: an `effective_from` at or before the currently
        // open published version's start. That is forward-only succession, and the
        // caller fixes it by choosing a later date — so it names the field rather
        // than arriving as a 500.
        throw new AppFailure('ERR-VAL-001', {
          message:
            'effectiveFrom must be strictly after the currently published version’s ' +
            'effective_from; service version succession is forward-only',
          safeDetails: { violations: [{ path: 'body.effectiveFrom', rule: 'not_forward_only' }] },
          cause,
        });
      }
      if (isSqlState(cause, SQLSTATE.exclusionViolation)) {
        // `ex_service_versions_no_published_overlap` — the gist backstop behind the
        // function. Reaching it means two publications raced past the service lock,
        // which is a conflict the caller can retry, not bad input.
        throw new AppFailure('ERR-CON-001', {
          message: 'Another published version already covers that date range',
          cause,
        });
      }
      throw cause;
    }

    // Re-read, so the response, the audit record and the event carry what the
    // function decided — including the `effective_from` it wrote, which overwrites
    // the provisional date the draft was created with.
    const published = await this.repository.findServiceVersion(db, version.id);
    if (published === null || published.status !== 'published') {
      throw new AppFailure('ERR-SYS-001', { message: `Version ${version.id} was not published` });
    }

    await appendAudit(db, {
      action: 'svc.service_version.published',
      entityType: 'svc.service_version',
      entityId: published.id,
      details: [
        { field: 'serviceId', classification: 'internal', value: service.id },
        { field: 'serviceCode', classification: 'internal', value: service.serviceCode },
        { field: 'versionNo', classification: 'public', value: String(published.versionNo) },
        { field: 'effectiveFrom', classification: 'public', value: published.effectiveFrom },
      ],
    });

    await publishEvent(db, {
      eventType: 'service.published',
      aggregateId: published.id,
      aggregateVersion: published.recordVersion,
      // The producer's leading segment must equal the catalog owner of the event,
      // which `buildEventEnvelope` enforces. It is the MODULE name.
      producer: 'service-catalog.service-catalog-write-service',
      payload: {
        serviceId: service.id,
        serviceCode: service.serviceCode,
        versionId: published.id,
        versionNo: published.versionNo,
        effectiveFrom: published.effectiveFrom,
      },
      // A version reaches `published` at most once — the freeze guard allows only
      // `published → archived` afterwards — so the key needs no version and a retry
      // collides rather than announcing the same publication twice.
      eventKey: `service.published:${published.id}`,
    });

    return {
      id: published.id,
      serviceId: published.serviceId,
      versionNo: published.versionNo,
      effectiveFrom: published.effectiveFrom,
      effectiveTo: published.effectiveTo,
      status: published.status,
      recordVersion: published.recordVersion,
    };
  }

  /**
   * Records whether a branch offers a service.
   *
   * There is exactly one live row per `(company, branch, service)` —
   * `uq_branch_service_availability_service` — so this is a state change, not an
   * addition to a history, and the schema has no effective-date columns to schedule
   * one with (P1-20-A-01). The prior state is read under the service's lock and
   * recorded in the audit detail, which is the only place the transition is
   * preserved.
   *
   * The service lock is what makes read-then-write safe: two concurrent requests for
   * the same service serialize on it, so neither can observe the absence the other is
   * about to fill and collide on the unique index.
   */
  public async setAvailability(
    db: DbHandle,
    serviceId: string,
    input: SetAvailabilityInput
  ): Promise<BranchAvailabilityView> {
    const service = await this.repository.lockService(db, serviceId);
    if (service === null) {
      throw new AppFailure('ERR-RES-001', { message: `Service ${serviceId} is not visible` });
    }

    /**
     * The branch must belong to the company it was named with.
     *
     * `iam.has_permission_in_scope` is disjunctive across grant rows, so a caller
     * pairing their own branch with another company's id passes the scope check on the
     * branch row alone. `fk_branch_service_availability_branch` would refuse the write
     * afterwards — but only after the request was authorized, and as a 500-shaped
     * driver error rather than a field-level refusal.
     */
    const coherent = await this.repository.branchBelongsToCompany(
      db,
      input.companyId,
      input.branchId
    );
    if (!coherent) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Branch ${input.branchId} does not belong to company ${input.companyId}`,
        safeDetails: { violations: [{ path: 'body.branchId', rule: 'branch_company_mismatch' }] },
      });
    }

    const isAvailable = input.isAvailable;
    const status = input.status ?? 'active';
    if (isAvailable && service.lifecycleStatus === 'archived') {
      // `svc.guard_branch_availability_service_active` refuses exactly this. Mirrored
      // so the caller learns which of the two inputs is the problem; WITHDRAWING
      // availability from an archived service stays possible, which is the operation
      // an operator retiring a service actually needs.
      throw new AppFailure('ERR-TRN-001', {
        message: `Service ${service.serviceCode} is archived and cannot be made available`,
      });
    }

    const existing = await this.repository.findAvailability(
      db,
      input.companyId,
      input.branchId,
      service.id
    );
    const row =
      existing === null
        ? await this.repository.insertAvailability(db, {
            companyId: input.companyId,
            branchId: input.branchId,
            serviceId: service.id,
            isAvailable,
            status,
          })
        : await this.repository.updateAvailability(db, existing.id, { isAvailable, status });

    await appendAudit(db, {
      action: 'svc.branch_availability.changed',
      entityType: 'svc.branch_service_availability',
      entityId: row.id,
      // The scope columns are on the record, not only in the details: this is the one
      // catalog write with a company and a branch, and filing it tenant-wide would put
      // it outside every scoped audit read.
      companyId: input.companyId,
      branchId: input.branchId,
      details: [
        { field: 'serviceId', classification: 'internal', value: service.id },
        { field: 'serviceCode', classification: 'internal', value: service.serviceCode },
        {
          field: 'isAvailable',
          classification: 'public',
          previousValue: existing === null ? null : String(existing.isAvailable),
          value: String(row.isAvailable),
        },
        {
          field: 'status',
          classification: 'public',
          previousValue: existing === null ? null : existing.status,
          value: row.status,
        },
      ],
    });
    return toAvailabilityView(row);
  }

  // ---- internals -----------------------------------------------------------

  /**
   * The service, locked, at the expected version, and not archived.
   *
   * The archived check is here rather than in each caller because it is the same
   * refusal every time and it is the one this phase must not get wrong: `archived` is
   * terminal, so an archived service accepts no edit, no reactivation and no new
   * published version. `svc.guard_service_lifecycle` only refuses the transition OUT
   * of `archived` — a rename of an archived service would pass the trigger — so this
   * check is doing work the database does not.
   */
  private async requireLockedService(
    db: DbHandle,
    serviceId: string,
    expectedVersion: number
  ): Promise<ServiceRow> {
    const service = await this.repository.lockService(db, serviceId);
    if (service === null) {
      throw new AppFailure('ERR-RES-001', { message: `Service ${serviceId} is not visible` });
    }
    if (service.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Service ${serviceId} was modified by another request`,
      });
    }
    if (service.lifecycleStatus === 'archived') {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Service ${service.serviceCode} is archived. Archiving is terminal: an archived ` +
          'service cannot be edited, reactivated, or given a new published version.',
      });
    }
    return service;
  }

  /**
   * The version, proven to belong to THIS service and to still be a draft.
   *
   * Both halves matter. A version id from another service would otherwise be
   * published under this service's lock and `svc.publish_service_version` would then
   * refuse it with a foreign-key error that reads like missing data; and a non-draft
   * version is already frozen by `svc.guard_service_version_freeze`.
   */
  private async requireDraftVersion(
    db: DbHandle,
    serviceId: string,
    versionId: string
  ): Promise<ServiceVersionRow> {
    const version = await this.repository.findServiceVersion(db, versionId);
    if (version === null || version.serviceId !== serviceId) {
      throw new AppFailure('ERR-RES-001', {
        message: `Version ${versionId} does not belong to service ${serviceId}`,
      });
    }
    if (version.status !== 'draft') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Version ${version.versionNo} is ${version.status}; only a draft may be published`,
      });
    }
    return version;
  }
}
