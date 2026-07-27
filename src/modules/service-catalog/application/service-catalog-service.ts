/**
 * Service-catalog reads and availability queries (Phase 1-20, P1-20-BE-001…003).
 *
 * Read-side of the catalog. It answers three questions the commercial layer asks
 * on every quotation line, and it answers them the same way every time:
 *
 *  1. what services exist for this tenant, filtered and paged;
 *  2. which published version covers a given date;
 *  3. whether a service may actually be sold at a branch on that date.
 *
 * (3) is the one that matters commercially, and it is deliberately a single
 * repository call rather than three application-level checks: a service is
 * sellable only when it is `active`, has a published version covering the date,
 * AND has an active availability row at that branch. Splitting those across
 * round-trips would let the answer change between them.
 */
import type { DbHandle } from '@/server/db/transaction';
import type { Page, PageRequest } from '@/server/db/pagination';
import { AppFailure } from '@/server/errors/app-failure';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type {
  BranchAvailabilityRow,
  LaborTimeRow,
  ServiceCatalogRepository,
  ServiceListFilter,
  ServiceRow,
  ServiceVersionRow,
} from '../data/service-catalog-repository';

/** A service as the API renders it. Carries no price — pricing is a separate module. */
export interface ServiceView {
  readonly id: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
}

/** A published version with its labour times, as used when pricing a line. */
export interface ServiceVersionView {
  readonly id: string;
  readonly serviceId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly laborTimes: readonly LaborTimeView[];
}

export interface LaborTimeView {
  readonly id: string;
  readonly laborCode: string | null;
  /** A decimal STRING in minutes — `numeric(10,2)`, never a float. */
  readonly standardMinutes: string;
  readonly unit: 'minutes';
  readonly skillRef: string | null;
  readonly status: string;
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

const toLaborView = (row: LaborTimeRow): LaborTimeView => ({
  id: row.id,
  laborCode: row.laborCode,
  standardMinutes: row.standardMinutes,
  unit: 'minutes',
  skillRef: row.skillRef,
  status: row.status,
});

export class ServiceCatalogService {
  public constructor(private readonly repository: ServiceCatalogRepository) {}

  /**
   * Lists services.
   *
   * The `availableAtBranchId` filter is authorized **before** it is used, not
   * after. A caller may only ask "what is available at branch X" for a branch
   * their grants actually cover; otherwise the filter itself becomes a probe that
   * reveals, by the difference between an empty and a non-empty page, whether a
   * branch exists and stocks a service. `scope: 'branch'` on the operation is
   * inert without this, because the route names no branch in its path
   * (P1-18-A-01).
   */
  public async list(
    db: DbHandle,
    filter: ServiceListFilter,
    request: PageRequest,
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<ServiceView>> {
    if (filter.availableAtBranchId !== undefined) {
      await authorizeScope({ branchId: filter.availableAtBranchId });
    } else {
      // No branch named: the read is tenant-wide catalog reference data, so the
      // declared permission is evaluated against the caller's own resolved scope.
      await authorizeScope({});
    }
    const page = await this.repository.listServices(db, filter, request);
    return { ...page, items: page.items.map(toServiceView) };
  }

  /** Reads one service, or `ERR-RES-001` when it is not visible to the caller. */
  public async detail(db: DbHandle, serviceId: string): Promise<ServiceView> {
    const row = await this.repository.findService(db, serviceId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', { message: `Service ${serviceId} is not visible` });
    }
    return toServiceView(row);
  }

  /**
   * The published version covering `asOf`, with its labour times.
   *
   * Returns `null` rather than throwing when no version covers the date: "this
   * service is not published on that day" is an ordinary commercial answer the
   * quotation layer must handle, not an exception.
   */
  public async publishedVersion(
    db: DbHandle,
    serviceId: string,
    asOf: string
  ): Promise<ServiceVersionView | null> {
    const version = await this.repository.findPublishedVersion(db, serviceId, asOf);
    if (version === null) return null;
    const labor = await this.repository.listLaborTimes(db, version.id);
    return toVersionView(version, labor);
  }

  /**
   * Whether the service may be sold at this branch on this date.
   *
   * The single authority for "can this go on a quotation line". Callers must not
   * reassemble it from parts.
   */
  public async isSellableAt(
    db: DbHandle,
    companyId: string,
    branchId: string,
    serviceId: string,
    asOf: string
  ): Promise<boolean> {
    return this.repository.isSellableAt(db, companyId, branchId, serviceId, asOf);
  }

  /** The availability row for a triple, or `null` when none has been recorded. */
  public async availability(
    db: DbHandle,
    companyId: string,
    branchId: string,
    serviceId: string
  ): Promise<BranchAvailabilityRow | null> {
    return this.repository.findAvailability(db, companyId, branchId, serviceId);
  }
}

function toVersionView(
  version: ServiceVersionRow,
  labor: readonly LaborTimeRow[]
): ServiceVersionView {
  return {
    id: version.id,
    serviceId: version.serviceId,
    versionNo: version.versionNo,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    status: version.status,
    laborTimes: labor.map(toLaborView),
  };
}
